/**
 * Shared helpers for the Recall nudge hooks (recall-nudge-post-tool.mjs,
 * recall-nudge-stop.mjs). Both read the same Claude Code hook stdin JSON
 * and the same session transcript — kept in one place so the detection
 * logic can't drift between the two hooks.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TICKET_KEY_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/;
export const RECALL_FLAG_RE = /🔖\s*Recall-flag:/;
export const NOTE_ADD_RE = /\bticketlens\s+note\s+add\b|\/jtb\s+note\b/;

export function readStdinJson() {
  const raw = fs.readFileSync(0, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function statePath(sessionId) {
  return path.join(os.tmpdir(), `ticketlens-recall-nudge-${sessionId || 'unknown'}.json`);
}

export function readState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(statePath(sessionId), 'utf8'));
  } catch {
    return { ticketToolCalls: 0, lastNudgeAt: 0 };
  }
}

export function writeState(sessionId, state) {
  try {
    fs.writeFileSync(statePath(sessionId), JSON.stringify(state));
  } catch { /* best-effort — a lost nudge counter is not worth failing the hook over */ }
}

/**
 * Reads the transcript (JSONL) and returns simple booleans about what
 * happened this session. Best-effort: any read/parse failure returns all
 * false rather than throwing — a broken transcript must never block Claude.
 *
 * Deliberately narrow about WHERE each pattern is allowed to match — jtb's
 * own SKILL.md instructions contain the literal strings "🔖 Recall-flag:"
 * and "ticketlens note add" as examples. Matching against the whole raw
 * entry (as an earlier version of this function did) means loading the
 * skill at all permanently false-positives both checks: sawRecallFlag gets
 * stuck true (silently disabling the mid-session nudge, since it thinks
 * Claude just flagged something every time) and sawNoteAdd gets stuck true
 * (silently disabling the Stop-hook check, since it thinks a note was
 * already added). Only count a real assistant-authored text block for the
 * flag, and only a real executed Bash command for note-add.
 */
export function scanTranscript(transcriptPath) {
  const result = { sawTicketKey: false, sawRecallFlag: false, sawNoteAdd: false };
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  } catch {
    return result;
  }

  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // Ticket-key detection stays broad (whole entry, any role) — it's only
    // the weaker "did ticket work happen at all" signal, and a rare false
    // positive here just means an extra harmless once-per-session check.
    if (TICKET_KEY_RE.test(JSON.stringify(entry))) result.sawTicketKey = true;

    if (entry.type !== 'assistant') continue;
    const blocks = entry.message?.content;
    if (!Array.isArray(blocks)) continue;

    for (const block of blocks) {
      if (block.type === 'text' && RECALL_FLAG_RE.test(block.text ?? '')) {
        result.sawRecallFlag = true;
      }
      if (block.type === 'tool_use' && block.name === 'Bash' && NOTE_ADD_RE.test(block.input?.command ?? '')) {
        result.sawNoteAdd = true;
      }
    }
  }

  return result;
}
