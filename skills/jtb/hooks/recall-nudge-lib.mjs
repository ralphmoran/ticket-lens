/**
 * Shared helpers for the Recall nudge Stop hook (recall-nudge-stop.mjs).
 * The retired PostToolUse mid-session nudge (recall-nudge-post-tool.mjs)
 * used to share this module too — removed because it only ever matched
 * Bash tool calls and went silently inert once ticket work moved to MCP
 * tools, which SKILL.md tells Claude to prefer over Bash whenever available.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

export const TICKET_KEY_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/;
export const RECALL_FLAG_RE = /🔖\s*Recall-flag:/;
export const NOTE_ADD_RE = /\bticketlens\s+note\s+add\b|\/jtb\s+note\b/;
// Matches the MCP tool_use name Claude Code gives an MCP server's tool call
// (mcp__<server-alias>__<tool-name>) — the server alias is whatever the user
// named it in their own .mcp.json, so only the tool-name suffix is fixed.
export const NOTE_ADD_MCP_RE = /^mcp__.+__recall_add$/;

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

// Two hours — how long a real capture in one directory counts as "recent
// enough" to skip the Stop hook's nag, even from a brand-new session_id.
export const CAPTURE_FRESHNESS_MS = 2 * 60 * 60 * 1000;

/**
 * Cross-session capture marker, keyed by a hash of `cwd` rather than
 * `session_id`. The per-session_id state file (readState/writeState above)
 * cannot answer "was something captured recently" once a compaction/resume
 * event rolls the session_id over — that starts both a blank dedup state
 * AND a blank transcript file, so a genuine earlier capture becomes
 * invisible to scanTranscript(). This marker survives that boundary because
 * it's keyed by the (stable) working directory instead.
 *
 * Lives in a user-private, mode-0700 subdirectory rather than directly in
 * (often world-writable, on Linux) os.tmpdir() — unlike statePath()'s
 * session_id (an unguessable UUID), a hash of `cwd` is derived from a much
 * smaller, guessable input space (common project directory names), so a
 * predictable path directly in shared tmp could be pre-planted by another
 * local user on a shared box.
 */
function privateTmpDir() {
  const owner = typeof process.getuid === 'function' ? process.getuid() : os.userInfo().username;
  const dir = path.join(os.tmpdir(), `ticketlens-recall-nudge-${owner}`);
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch { /* best-effort — a write into it below will just fail safely too */ }
  return dir;
}

export function lastCapturePath(cwd) {
  const hash = crypto.createHash('sha256').update(cwd || 'unknown').digest('hex').slice(0, 16);
  return path.join(privateTmpDir(), `lastcapture-${hash}.json`);
}

export function readLastCaptureAt(cwd) {
  try {
    return JSON.parse(fs.readFileSync(lastCapturePath(cwd), 'utf8')).lastCaptureAt ?? 0;
  } catch {
    return 0;
  }
}

export function writeLastCaptureAt(cwd, timestamp) {
  try {
    fs.writeFileSync(lastCapturePath(cwd), JSON.stringify({ lastCaptureAt: timestamp }));
  } catch { /* best-effort — losing this marker only costs one extra nag next rollover */ }
}

export function hasRecentCapture(cwd, now = Date.now()) {
  const lastCaptureAt = readLastCaptureAt(cwd);
  return lastCaptureAt > 0 && (now - lastCaptureAt) < CAPTURE_FRESHNESS_MS;
}

/**
 * Cross-session NAG marker (backlog #14) — same shape as lastCapturePath/
 * readLastCaptureAt/writeLastCaptureAt/hasRecentCapture above, but records
 * "we already blocked once for this directory" instead of "a note was
 * added". Closes a gap those functions never covered: they bridge a
 * session_id rollover only when a REAL capture landed, but a dismissed nag
 * ("genuinely nothing qualified" — the hook's own suggested response) was
 * never remembered anywhere. Since compaction/resume mints a brand-new
 * session_id (see recall-nudge-stop.mjs's docstring), and that resets the
 * per-session_id stopChecked gate, one long working session with several
 * compaction cycles could get nagged repeatedly for the same still-ongoing
 * work — a real, reported friction source (backlog #14), not hypothetical.
 * Deliberately a separate marker file from lastCapture (not folded into
 * it): a nag and a capture are different facts, and conflating them would
 * make hasRecentCapture's "a real capture landed" guarantee ambiguous.
 * Reuses CAPTURE_FRESHNESS_MS rather than a second magic number — the same
 * 2-hour window is a reasonable proxy for "still the same working session"
 * in both cases, and a distinct constant isn't justified by anything
 * observed so far.
 */
export function lastNagPath(cwd) {
  const hash = crypto.createHash('sha256').update(cwd || 'unknown').digest('hex').slice(0, 16);
  return path.join(privateTmpDir(), `lastnag-${hash}.json`);
}

export function readLastNagAt(cwd) {
  try {
    return JSON.parse(fs.readFileSync(lastNagPath(cwd), 'utf8')).lastNagAt ?? 0;
  } catch {
    return 0;
  }
}

export function writeLastNagAt(cwd, timestamp) {
  try {
    fs.writeFileSync(lastNagPath(cwd), JSON.stringify({ lastNagAt: timestamp }));
  } catch { /* best-effort — losing this marker only costs one extra nag next rollover */ }
}

export function hasRecentNag(cwd, now = Date.now()) {
  const lastNagAt = readLastNagAt(cwd);
  return lastNagAt > 0 && (now - lastNagAt) < CAPTURE_FRESHNESS_MS;
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
 * flag, and only a real executed note-add — either the CLI (`ticketlens
 * note add`/`/jtb note` via Bash) or the ticketlens MCP server's recall_add
 * tool — for note-add. Missing the MCP path here was a real bug: it made
 * the Stop hook nudge even after a note was genuinely captured via MCP,
 * since only the Bash/CLI form was ever recognized.
 *
 * `ticketKey` carries the FIRST matched ticket key's literal text (or
 * `null`), so callers can resolve a profile by ticket-key prefix the same
 * way `resolveConnection()` does — see recall-nudge-stop.mjs. First match,
 * not last: the primary ticket a session is about is normally established
 * early, and picking one deterministic match keeps this function decoupled
 * from profiles.json (it stays a pure transcript reader; profile lookup
 * and its own fallback chain belong entirely to resolveProfile()).
 */
export function scanTranscript(transcriptPath) {
  const result = { sawTicketKey: false, sawRecallFlag: false, sawNoteAdd: false, ticketKey: null };
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

    // Ticket-key detection stays broad (whole entry, any role) — for
    // sawTicketKey alone, it's only the weaker "did ticket work happen at
    // all" signal, so a rare false positive just means an extra harmless
    // once-per-session check. The captured ticketKey text carries a bit
    // more weight (it also selects which profile's recallStrictness
    // applies, see recall-nudge-stop.mjs), but the ceiling is still just
    // "the wrong local settings value governs one Stop-hook decision" — no
    // credentials or ticket data are read using this key, so a false
    // positive here stays low-consequence, not narrowed further for now.
    if (!result.ticketKey) {
      const match = TICKET_KEY_RE.exec(JSON.stringify(entry));
      if (match) {
        result.sawTicketKey = true;
        result.ticketKey = match[0];
      }
    }

    if (entry.type !== 'assistant') continue;
    const blocks = entry.message?.content;
    if (!Array.isArray(blocks)) continue;

    for (const block of blocks) {
      if (block.type === 'text' && RECALL_FLAG_RE.test(block.text ?? '')) {
        result.sawRecallFlag = true;
      }
      if (block.type === 'tool_use') {
        const isCliNoteAdd = block.name === 'Bash' && NOTE_ADD_RE.test(block.input?.command ?? '');
        const isMcpNoteAdd = NOTE_ADD_MCP_RE.test(block.name ?? '');
        if (isCliNoteAdd || isMcpNoteAdd) result.sawNoteAdd = true;
      }
    }
  }

  return result;
}

/**
 * Decides whether the Stop hook should block, calibrated by the active
 * profile's recallStrictness. `strict` deliberately uses the exact same
 * trigger as `balanced` — it does not additionally bypass
 * hasRecentCapture()'s rollover bridge or recall-nudge-stop.mjs's
 * once-per-session cap, both correctness invariants rather than
 * calibration knobs. Bypassing either would reintroduce a real bug
 * (re-nagging after a genuine capture that lands just before a
 * compaction/session_id rollover, or nagging more than once per session).
 * Strict's actual effect on capture volume comes from SKILL.md's lowered
 * in-session capture bar, not from this function.
 */
export function shouldNag({ sawTicketKey, sawRecallFlag, sawNoteAdd, recallStrictness = 'balanced' }) {
  if (!sawTicketKey || sawNoteAdd) return false;
  if (recallStrictness === 'loose') return sawRecallFlag; // only the broken-promise case
  return true; // balanced and strict: ticket work with no note is enough
}
