#!/usr/bin/env node
/**
 * Stop hook — end-of-session Recall check.
 *
 * Blocks (exit 2) at most ONCE per session — never traps the user in a
 * loop regardless of how Claude responds. Both cases below require jtb's
 * fetch to have actually run this session (backlog #15) — a ticket-key-
 * shaped string appearing incidentally (a doc, a code comment, a test
 * fixture) is not enough, matching SKILL.md's own capture-guidance scope.
 * Given that:
 *   1. Claude flagged something (🔖 Recall-flag:) but never called note add
 *      — a broken promise, the strongest signal something was missed.
 *   2. Ticket work happened all session with zero flags and zero notes
 *      — the weaker "did anything ever get considered?" catch.
 * Anything else (no fetch this session, or a note was already added) exits
 * clean — this must never be the reason a session can't end.
 *
 * The per-session_id "asked once" state (readState/writeState) cannot
 * survive a compaction/resume event — that hands this hook a brand-new
 * session_id, a blank dedup state, AND a blank transcript file, so a real
 * earlier capture becomes invisible. The cross-session lastCapture marker
 * (keyed by cwd, not session_id) is what actually bridges that boundary
 * for a genuine capture. The parallel lastNag marker (backlog #14) bridges
 * the same boundary for a DISMISSED nag: without it, a session that already
 * got its one nag and was told "genuinely nothing qualified" would nag
 * again after the next compaction/resume rollover, since that dismissal
 * was never recorded anywhere — only a real capture was.
 *
 * Which of the two cases above actually blocks is governed by the effective
 * recallStrictness — the active profile's own explicit config-set value, or
 * else the team's Console-set default (backlog #20), resolved entirely from
 * local state via resolveEffectiveRecallStrictness() so this hook never
 * touches the network. See recall-nudge-lib.mjs's shouldNag() doc comment
 * for the calibration and why strict doesn't widen this further.
 *
 * resolveProfile() below is given scanTranscript()'s matched ticket key (not
 * null), so it resolves by ticket-key prefix the same way the brief-injection
 * lever (resolveConnection(ticketKey, ...) in profile-resolver.mjs) does —
 * both levers now agree on which profile's recallStrictness applies for a
 * multi-profile user. When no ticket key was seen, or it matches no profile's
 * ticketPrefixes, this falls through to cwd/projectPaths then the default
 * profile, same as before (backlog #12, design spec §6).
 */

import { readStdinJson, readState, writeState, scanTranscript, hasRecentCapture, writeLastCaptureAt, hasRecentNag, writeLastNagAt, shouldNag } from './recall-nudge-lib.mjs';
import { resolveProfile, resolveEffectiveRecallStrictness } from '../scripts/lib/profile-resolver.mjs';
import { readCliToken } from '../scripts/lib/cli-auth.mjs';

const input = readStdinJson();
const sessionId = input?.session_id;
const transcriptPath = input?.transcript_path;
const cwd = input?.cwd ?? process.cwd();

if (!sessionId || !transcriptPath) process.exit(0);

const { sawFetch, sawRecallFlag, sawNoteAdd, ticketKey } = scanTranscript(transcriptPath);

// Refreshed on every check, independent of the once-per-session gate below —
// a capture that happens AFTER this session already nagged once must still
// update the marker, or a later session_id rollover would find it stale.
if (sawNoteAdd) writeLastCaptureAt(cwd, Date.now());

const state = readState(sessionId);
if (state.stopChecked) process.exit(0); // already asked once this session — respect the answer

const profile = resolveProfile(ticketKey, { cwd });
const cliToken = readCliToken();
const recallStrictness = resolveEffectiveRecallStrictness({ profile, cliToken });

if (!shouldNag({ sawFetch, sawRecallFlag, sawNoteAdd, recallStrictness })) {
  process.exit(0); // nothing this strictness level requires a capture for
}

if (hasRecentCapture(cwd)) {
  process.exit(0); // a real capture landed recently in this same directory, just under a different session_id
}

if (hasRecentNag(cwd)) {
  process.exit(0); // already nagged recently in this same directory, just under a different session_id — a compaction/resume rollover, not a fresh session (backlog #14)
}

state.stopChecked = true;
writeState(sessionId, state);
writeLastNagAt(cwd, Date.now());

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
