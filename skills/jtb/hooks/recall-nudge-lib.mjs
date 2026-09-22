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
// Matches jtb's fetch: the CLI's bare/default ticket-key form ("ticketlens
// PROJ-123" or its "tl" bin alias), the "get" alias form, and the /jtb skill
// wrapper. Deliberately excludes an explicit "fetch" subcommand — there is
// no such subcommand; parseCommand() (cli.mjs) only special-cases "get" as
// an alias, so "ticketlens fetch PROJ-123" falls through to the catch-all
// with "fetch" itself still in argv and errors as an invalid ticket key
// (live-verified during code review) — matching it here would silently
// swallow a broken invocation as if a real fetch had happened. Also
// deliberately does not match any other tracked subcommand (triage/
// compliance/etc) — those are lowercase words and can never satisfy the
// uppercase ticket-key class required immediately after the command name.
export const FETCH_RE = /\bticketlens\s+(?:get\s+)?[A-Z][A-Z0-9]{1,9}-\d+\b|\btl\s+(?:get\s+)?[A-Z][A-Z0-9]{1,9}-\d+\b|\/jtb\s+(?:get\s+)?[A-Z][A-Z0-9]{1,9}-\d+\b/;
export const FETCH_MCP_RE = /^mcp__.+__fetch$/;
// Matches a real ticket-mutating CLI subcommand (comment/transition/assign/
// update, each confirmed in cli.mjs's parseCommand() to take TICKET-KEY as
// the immediate next positional arg, same shape FETCH_RE already assumes),
// across the ticketlens/tl/jtb invocation forms. Distinguishes real ticket
// work from a read-only fetch — backlog #24's 6th report: a pure multi-
// ticket status listing (fetch only, no mutation) still nagged, even though
// nothing about it could ever satisfy SKILL.md's own capture rule.
// These are the ONLY signals for sawMutatingAction. An Edit/Write tool call
// is deliberately not one (backlog #38/#24b): all three real false-positive
// nags were armed solely by the assistant writing memory files or scratch
// comment drafts, which are not ticket writes and can live anywhere, so no
// path filter can tell them apart from real source edits reliably.
export const MUTATING_ACTION_RE = /\bticketlens\s+(?:comment|transition|assign|update)\s+[A-Z][A-Z0-9]{1,9}-\d+\b|\btl\s+(?:comment|transition|assign|update)\s+[A-Z][A-Z0-9]{1,9}-\d+\b|\/jtb\s+(?:comment|transition|assign|update)\s+[A-Z][A-Z0-9]{1,9}-\d+\b/;
export const MUTATING_ACTION_MCP_RE = /^mcp__.+__(ticket_comment|ticket_transition|ticket_assign|ticket_update)$/;

export function readStdinJson() {
  const raw = fs.readFileSync(0, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// Sanitized so a session_id containing "../" (hard-test finding, backlog #38)
// can't make path.join collapse the fixed "ticketlens-recall-nudge-" prefix
// away and land the state file at an unrelated sibling path in os.tmpdir().
// session_id is normally an unguessable UUID from Claude Code, not
// attacker-controlled, but this is still external input — never trust it.
export function statePath(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^A-Za-z0-9_-]/g, '_');
  return path.join(os.tmpdir(), `ticketlens-recall-nudge-${safe}.json`);
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

// Two hours of IDLE time — how long a real capture in one directory counts as
// "recent enough" to skip the Stop hook's nag, even from a brand-new session_id.
// Sliding, not fixed: ongoing ticket work renews the marker (see
// recall-nudge-stop.mjs, backlog #24), so only a full idle window lets it lapse.
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
export function privateTmpDir() {
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
 * Cross-session/cross-turn AUTO-CAPTURE-ATTEMPT marker — same shape as
 * lastNagPath/hasRecentNag above, but throttles the autonomous background
 * spawn (recall-auto-capture.mjs) itself, independent of the sync nag below.
 * Needed because Stop fires on every turn-end, not once per session (see
 * recall-nudge-stop.mjs's own doc comment) — without this, a single
 * multi-turn session would spawn the background judge, and its AI-provider
 * spend, once per turn (code review, 2026-09-15). Written optimistically at
 * spawn time, before the child's own outcome is known — a failed/skipped
 * attempt still counts against the window, same accepted trade-off as
 * hasRecentNag's own doc comment above.
 */
export function lastAutoCaptureAttemptPath(cwd) {
  const hash = crypto.createHash('sha256').update(cwd || 'unknown').digest('hex').slice(0, 16);
  return path.join(privateTmpDir(), `lastautocapture-${hash}.json`);
}

export function readLastAutoCaptureAttemptAt(cwd) {
  try {
    return JSON.parse(fs.readFileSync(lastAutoCaptureAttemptPath(cwd), 'utf8')).lastAttemptAt ?? 0;
  } catch {
    return 0;
  }
}

export function writeLastAutoCaptureAttemptAt(cwd, timestamp) {
  try {
    fs.writeFileSync(lastAutoCaptureAttemptPath(cwd), JSON.stringify({ lastAttemptAt: timestamp }));
  } catch { /* best-effort — losing this marker only costs one extra spawn next window */ }
}

export function hasRecentAutoCaptureAttempt(cwd, now = Date.now()) {
  const lastAttemptAt = readLastAutoCaptureAttemptAt(cwd);
  return lastAttemptAt > 0 && (now - lastAttemptAt) < CAPTURE_FRESHNESS_MS;
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
 *
 * `sawFetch` (backlog #15) is deliberately narrower than `sawTicketKey`: it
 * only goes true when jtb's fetch tool actually ran (CLI or MCP form, same
 * dual-detection shape as sawNoteAdd below) — not merely when a ticket-key-
 * shaped string appears anywhere in the transcript. `sawTicketKey` false-
 * positived on any incidental match (a doc, a code comment, a test fixture
 * name like BETA-42), which is fine for its own low-stakes use (picking
 * which profile's settings apply) but was wrong as shouldNag()'s nag
 * precondition — SKILL.md's own capture guidance is scoped to "whenever
 * jtb's fetch was used," so the hook now checks the same thing it backstops.
 */
export function scanTranscript(transcriptPath) {
  const result = { sawTicketKey: false, sawRecallFlag: false, sawNoteAdd: false, sawFetch: false, sawMutatingAction: false, ticketKey: null };
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean);
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

    if (!entry || typeof entry !== 'object' || entry.type !== 'assistant') continue;
    const blocks = entry.message?.content;
    if (!Array.isArray(blocks)) continue;

    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue; // same guard as entry above — a null/primitive array element must not crash this (hard-test finding)
      if (block.type === 'text' && RECALL_FLAG_RE.test(block.text ?? '')) {
        result.sawRecallFlag = true;
      }
      if (block.type === 'tool_use') {
        const isCliNoteAdd = block.name === 'Bash' && NOTE_ADD_RE.test(block.input?.command ?? '');
        const isMcpNoteAdd = NOTE_ADD_MCP_RE.test(block.name ?? '');
        if (isCliNoteAdd || isMcpNoteAdd) result.sawNoteAdd = true;

        const isCliFetch = block.name === 'Bash' && FETCH_RE.test(block.input?.command ?? '');
        const isMcpFetch = FETCH_MCP_RE.test(block.name ?? '');
        if (isCliFetch || isMcpFetch) result.sawFetch = true;

        const isCliMutation = block.name === 'Bash' && MUTATING_ACTION_RE.test(block.input?.command ?? '');
        const isMcpMutation = MUTATING_ACTION_MCP_RE.test(block.name ?? '');
        if (isCliMutation || isMcpMutation) result.sawMutatingAction = true;
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
 *
 * Gated on `sawFetch`, not `sawTicketKey` (backlog #15) — including the
 * `sawRecallFlag` broken-promise case, which is why the gate is a blanket
 * `!sawFetch` check rather than per-branch: a flag can't legitimately fire
 * outside real ticket work, and this keeps the whole function's trigger
 * matching SKILL.md's own capture-guidance scope exactly ("unconditionally
 * whenever jtb's fetch was used"), instead of firing on any incidental
 * ticket-key-shaped string.
 *
 * Also gated on `sawMutatingAction` (backlog #24, 6th report) — a pure
 * read-only session (multi-ticket status listing, a report, a lookup) can
 * never satisfy SKILL.md's own 3-part capture rule ("generalizes beyond
 * this diff", "cost real effort to discover") no matter how many fetches
 * ran, so gating on `sawFetch` alone false-positived on exactly that shape.
 * Applies uniformly across all three strictness levels, same blanket
 * treatment as the `sawFetch` gate above — a session with zero mutation
 * has nothing any strictness level would ever ask to capture.
 */
export function shouldNag({ sawFetch, sawMutatingAction, sawRecallFlag, sawNoteAdd, recallStrictness = 'balanced' }) {
  if (!sawFetch || sawNoteAdd) return false;
  if (!sawMutatingAction) return false;
  if (recallStrictness === 'loose') return sawRecallFlag; // only the broken-promise case
  return true; // balanced and strict: a fetch with no note is enough
}

/**
 * Builds a bounded excerpt of this session's assistant-authored text, for
 * the autonomous background auto-capture path (recall-auto-capture.mjs) to
 * hand to the server-side capture-judgment prompt — same assistant-text-only
 * filter scanTranscript() already uses for sawRecallFlag, so this can never
 * leak a user's own pasted content (secrets, unrelated files) that only
 * ever appeared in a user-role transcript entry.
 *
 * Capped at 8000 chars, truncated from the START (keeps the END of the
 * session) — the final synthesized insight is far more likely to be near
 * the end of a session than the beginning, and an unbounded excerpt risks
 * an oversized request body for no benefit.
 *
 * Best-effort: any read/parse failure, or a session with no assistant text
 * at all, returns '' rather than throwing — this runs in a detached
 * background process with nothing watching for an unhandled rejection.
 */
export function buildCaptureExcerpt(transcriptPath) {
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').replace(/^\uFEFF/, '').split('\n').filter(Boolean);
  } catch {
    return '';
  }

  const texts = [];
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object' || entry.type !== 'assistant') continue;
    const blocks = entry.message?.content;
    if (!Array.isArray(blocks)) continue;
    for (const block of blocks) {
      if (!block || typeof block !== 'object') continue; // same guard as scanTranscript — a null/primitive array element must not crash this (hard-test finding)
      if (block.type === 'text' && block.text) texts.push(block.text);
    }
  }

  const joined = texts.join('\n\n');
  return joined.length > 8000 ? joined.slice(-8000) : joined;
}
