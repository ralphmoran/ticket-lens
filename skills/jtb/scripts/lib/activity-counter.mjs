/**
 * Best-effort CLI activity counter — tracks fetch, triage, and invocation
 * counts between pushes. Stored in ~/.ticketlens/activity.json.
 *
 * fetch_count/triage_run_count are tracked per profile (data.byProfile), since
 * they're always incremented at a point where a resolved profile is known and
 * a push (`readAndResetActivity`) reports them for one specific profile — a
 * push under profile A must never bundle in runs that actually happened under
 * profile B (L-6, 2026-08-01 audit). Every other field (invocations, commands,
 * drafts_kept, drafts_deleted, briefs_with_recall_injection) stays flat/global:
 * they're incremented from bin/ticketlens.mjs before any command has resolved a
 * profile at all (many commands, e.g. `license`/`cache`, have no profile concept
 * whatsoever), so there's no meaningful profile to bucket them under.
 *
 * Intentional limitations (acceptable for a UX metric, NOT suitable for billing):
 *
 * - Not transactional: if a push succeeds server-side but the network returns
 *   an error, counters are not reset and will be included in the next push
 *   (double-counting one session's activity is acceptable).
 *
 * - Not safe for concurrent processes: increment() is a read-modify-write with
 *   no file lock. Two simultaneous CLI invocations will race and the last write
 *   wins, silently dropping one count. This is rare in normal developer usage
 *   and acceptable given the zero-npm-deps constraint. Do not rely on these
 *   counters for exact accuracy.
 */

import fs from 'node:fs';
import path from 'node:path';

const ACTIVITY_FILE = 'activity.json';
const EMPTY_PROFILE_BUCKET = { fetch_count: 0, triage_run_count: 0 };

function read(configDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(configDir, ACTIVITY_FILE), 'utf8'));
  } catch {
    return { byProfile: {}, invocations: 0, commands: {}, drafts_kept: 0, drafts_deleted: 0, briefs_with_recall_injection: 0 };
  }
}

function write(configDir, data) {
  try {
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, ACTIVITY_FILE),
      JSON.stringify(data, null, 2),
      'utf8',
    );
  } catch {
    // Non-fatal — activity tracking is best-effort
  }
}

function increment(configDir, field) {
  const data = read(configDir);
  data[field] = (data[field] ?? 0) + 1;
  write(configDir, data);
  return data[field];
}

/**
 * @param {string} configDir
 * @param {string} profile
 * @param {'fetch_count'|'triage_run_count'} field
 */
function incrementProfileField(configDir, profile, field) {
  const data = read(configDir);
  if (!data.byProfile) data.byProfile = {};
  if (!data.byProfile[profile]) data.byProfile[profile] = { ...EMPTY_PROFILE_BUCKET };
  const bucket = data.byProfile[profile];
  bucket[field] = (bucket[field] ?? 0) + 1;
  write(configDir, data);
}

export function incrementFetch(configDir, profile) {
  incrementProfileField(configDir, profile, 'fetch_count');
}

export function incrementTriageRun(configDir, profile) {
  incrementProfileField(configDir, profile, 'triage_run_count');
}

export function incrementInvocation(configDir) {
  increment(configDir, 'invocations');
}

export function incrementDraftKept(configDir) {
  increment(configDir, 'drafts_kept');
}

export function incrementDraftDeleted(configDir) {
  increment(configDir, 'drafts_deleted');
}

/**
 * @param {string} configDir
 * @returns {number} the new running count, so callers can decide whether to fire the pulse prompt
 */
export function incrementBriefWithRecall(configDir) {
  return increment(configDir, 'briefs_with_recall_injection');
}

const PULSE_INTERVAL = 25;

/**
 * @param {number} briefsWithRecallCount
 * @returns {boolean} true on exact multiples of 25 (never for 0)
 */
export function shouldPromptPulse(briefsWithRecallCount) {
  return briefsWithRecallCount > 0 && briefsWithRecallCount % PULSE_INTERVAL === 0;
}

const MAX_PULSES = 20;

/**
 * Records a response to the "is Recall pulling its weight?" pulse prompt.
 * Kept separate from the counters readAndResetActivity manages — pulses are
 * a local log for the founder to review, not a count that gets pushed and
 * zeroed out.
 *
 * @param {string} configDir
 * @param {'y'|'n'|'skip'} response
 */
export function recordPulseResponse(configDir, response) {
  const data = read(configDir);
  if (!data.pulses) data.pulses = [];
  data.pulses.push({ ts: new Date().toISOString(), response });
  data.pulses = data.pulses.slice(-MAX_PULSES);
  write(configDir, data);
}

/**
 * Records one invocation of a named command, plus each --flag present in
 * flagArgs. Flag values are stripped so "--depth=2" tracks as "--depth".
 *
 * @param {string}   configDir
 * @param {string}   command   - e.g. "triage", "fetch"
 * @param {string[]} flagArgs  - the raw args passed to the command
 */
export function incrementCommand(configDir, command, flagArgs = []) {
  const data = read(configDir);
  if (!data.commands) data.commands = {};
  if (!data.commands[command]) data.commands[command] = { count: 0 };

  data.commands[command].count += 1;

  for (const arg of flagArgs) {
    if (!arg.startsWith('-')) continue;
    const flag = arg.replace(/=.*$/, '');
    data.commands[command][flag] = (data.commands[command][flag] ?? 0) + 1;
  }

  write(configDir, data);
}

/**
 * Accumulates estimated tokens saved for a named command.
 * Called from fetch-ticket.mjs after assembling the brief.
 * Best-effort — swallows write errors like all other counters.
 *
 * @param {string} configDir
 * @param {string} command   - e.g. "fetch"
 * @param {number} tokens    - estimated tokens saved (brief.length / 4)
 */
export function recordTokensSaved(configDir, command, tokens) {
  const data = read(configDir);
  if (!data.commands) data.commands = {};
  if (!data.commands[command]) data.commands[command] = { count: 0 };
  data.commands[command].tokens_saved = (data.commands[command].tokens_saved ?? 0) + tokens;
  write(configDir, data);
}

/**
 * Returns the current counters and resets them to zero. Call only after a
 * confirmed successful push, for the exact profile that push was for.
 *
 * fetch_count/triage_run_count are scoped to the given profile — only that
 * profile's bucket is read and reset, so a push for profile A never bundles
 * in (or clears) runs that happened under a different profile B. Every other
 * field stays global, same as before: reset regardless of which profile
 * triggered this push (see the module doc comment for why).
 *
 * @param {string} configDir
 * @param {string} profile
 * @returns {{ fetch_count: number, triage_run_count: number, invocations: number, commands: object }}
 */
export function readAndResetActivity(configDir, profile) {
  const data = read(configDir);
  const profileBucket = data.byProfile?.[profile] ?? EMPTY_PROFILE_BUCKET;
  const snapshot = {
    fetch_count:                  profileBucket.fetch_count         ?? 0,
    triage_run_count:             profileBucket.triage_run_count    ?? 0,
    invocations:                  data.invocations                  ?? 0,
    commands:                     data.commands                     ?? {},
    drafts_kept:                  data.drafts_kept                  ?? 0,
    drafts_deleted:               data.drafts_deleted               ?? 0,
    briefs_with_recall_injection: data.briefs_with_recall_injection ?? 0,
  };
  const byProfile = { ...(data.byProfile ?? {}) };
  delete byProfile[profile];
  write(configDir, {
    byProfile, invocations: 0, commands: {},
    drafts_kept: 0, drafts_deleted: 0, briefs_with_recall_injection: 0,
    ...(data.pulses ? { pulses: data.pulses } : {}),
  });
  return snapshot;
}
