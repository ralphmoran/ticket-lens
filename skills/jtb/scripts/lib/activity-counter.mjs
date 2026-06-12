/**
 * Best-effort CLI activity counter — tracks fetch, triage, and invocation
 * counts between pushes. Stored in ~/.ticketlens/activity.json.
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

function read(configDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(configDir, ACTIVITY_FILE), 'utf8'));
  } catch {
    return { fetch_count: 0, triage_run_count: 0, invocations: 0, commands: {} };
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
}

export function incrementFetch(configDir) {
  increment(configDir, 'fetch_count');
}

export function incrementTriageRun(configDir) {
  increment(configDir, 'triage_run_count');
}

export function incrementInvocation(configDir) {
  increment(configDir, 'invocations');
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
 * Returns the current counters and resets them to zero.
 * Call only after a confirmed successful push.
 *
 * @param {string} configDir
 * @returns {{ fetch_count: number, triage_run_count: number, invocations: number, commands: object }}
 */
export function readAndResetActivity(configDir) {
  const data = read(configDir);
  const snapshot = {
    fetch_count:      data.fetch_count      ?? 0,
    triage_run_count: data.triage_run_count ?? 0,
    invocations:      data.invocations      ?? 0,
    commands:         data.commands         ?? {},
  };
  write(configDir, { fetch_count: 0, triage_run_count: 0, invocations: 0, commands: {} });
  return snapshot;
}
