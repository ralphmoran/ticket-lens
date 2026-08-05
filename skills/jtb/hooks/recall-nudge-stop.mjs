#!/usr/bin/env node
/**
 * Stop hook — end-of-session Recall check.
 *
 * Blocks (exit 2) at most ONCE per session — never traps the user in a
 * loop regardless of how Claude responds. Two cases force a check:
 *   1. Claude flagged something (🔖 Recall-flag:) but never called note add
 *      — a broken promise, the strongest signal something was missed.
 *   2. Ticket work happened all session with zero flags and zero notes
 *      — the weaker "did anything ever get considered?" catch.
 * Anything else (no ticket work at all, or a note was already added) exits
 * clean — this must never be the reason a session can't end.
 *
 * The per-session_id "asked once" state (readState/writeState) cannot
 * survive a compaction/resume event — that hands this hook a brand-new
 * session_id, a blank dedup state, AND a blank transcript file, so a real
 * earlier capture becomes invisible. The cross-session lastCapture marker
 * (keyed by cwd, not session_id) is what actually bridges that boundary.
 */

import { readStdinJson, readState, writeState, scanTranscript, hasRecentCapture, writeLastCaptureAt } from './recall-nudge-lib.mjs';

const input = readStdinJson();
const sessionId = input?.session_id;
const transcriptPath = input?.transcript_path;
const cwd = input?.cwd ?? process.cwd();

if (!sessionId || !transcriptPath) process.exit(0);

const { sawTicketKey, sawRecallFlag, sawNoteAdd } = scanTranscript(transcriptPath);

// Refreshed on every check, independent of the once-per-session gate below —
// a capture that happens AFTER this session already nagged once must still
// update the marker, or a later session_id rollover would find it stale.
if (sawNoteAdd) writeLastCaptureAt(cwd, Date.now());

const state = readState(sessionId);
if (state.stopChecked) process.exit(0); // already asked once this session — respect the answer

if (!sawTicketKey || sawNoteAdd) {
  process.exit(0); // no ticket work, or already captured — nothing to force
}

if (hasRecentCapture(cwd)) {
  process.exit(0); // a real capture landed recently in this same directory, just under a different session_id
}

state.stopChecked = true;
writeState(sessionId, state);

if (sawRecallFlag) {
  process.stderr.write(
    'You flagged something as Recall-worthy (🔖 Recall-flag:) earlier this session but ' +
    'never called `ticketlens note add`. Do that now, or say explicitly why it turned ' +
    'out not to qualify — then you can finish.\n',
  );
} else {
  process.stderr.write(
    'This session touched ticket work but nothing was ever captured to Recall. If a ' +
    'non-obvious insight, gotcha, or decision came up, capture it now via ' +
    '`ticketlens note add`. If genuinely nothing qualified, just say so — then finish.\n',
  );
}
process.exit(2);
