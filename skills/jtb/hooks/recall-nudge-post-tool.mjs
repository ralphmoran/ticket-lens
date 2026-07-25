#!/usr/bin/env node
/**
 * PostToolUse hook (matcher: Bash) — mid-session Recall nudge.
 *
 * Non-blocking by design: this only prints an advisory reminder to stdout
 * every NUDGE_EVERY ticket-related Bash calls, and only if Claude hasn't
 * self-flagged a Recall-worthy insight (🔖 Recall-flag:) since the last one.
 * Never exits non-zero — a mid-session nudge must never interrupt real work.
 */

import { readStdinJson, statePath, readState, writeState, TICKET_KEY_RE, scanTranscript } from './recall-nudge-lib.mjs';

const NUDGE_EVERY = 8; // ticket-related Bash calls between nudges

const input = readStdinJson();
const command = input?.tool_input?.command ?? '';
const sessionId = input?.session_id;
const transcriptPath = input?.transcript_path;

if (!TICKET_KEY_RE.test(command) || !sessionId) {
  process.exit(0);
}

const state = readState(sessionId);
state.ticketToolCalls = (state.ticketToolCalls ?? 0) + 1;

// If Claude already self-flagged since we last reset, don't nag — reset the
// counter so the next nudge only fires after another full quiet stretch.
if (transcriptPath) {
  const { sawRecallFlag } = scanTranscript(transcriptPath);
  if (sawRecallFlag) {
    state.ticketToolCalls = 0;
    writeState(sessionId, state);
    process.exit(0);
  }
}

if (state.ticketToolCalls >= NUDGE_EVERY) {
  state.ticketToolCalls = 0;
  state.lastNudgeAt = Date.now();
  writeState(sessionId, state);
  process.stdout.write(
    'Reminder (not a request for action right now): if something non-obvious was ' +
    'confirmed in the last stretch of ticket work — a gotcha, a root cause, a ' +
    'decision with non-obvious rationale — capture it now via `ticketlens note add` ' +
    'per the jtb skill\'s Recall guidance, then keep going.\n',
  );
  process.exit(0);
}

writeState(sessionId, state);
process.exit(0);
