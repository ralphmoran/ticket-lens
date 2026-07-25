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
    let text;
    try {
      const entry = JSON.parse(line);
      // Transcript entries vary by role/type; flatten whatever text exists.
      text = JSON.stringify(entry);
    } catch {
      continue;
    }
    if (TICKET_KEY_RE.test(text)) result.sawTicketKey = true;
    if (RECALL_FLAG_RE.test(text)) result.sawRecallFlag = true;
    if (NOTE_ADD_RE.test(text)) result.sawNoteAdd = true;
  }

  return result;
}
