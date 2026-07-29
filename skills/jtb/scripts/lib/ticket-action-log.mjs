/**
 * Append-only forensic audit trail for ticket writes (comment/transition).
 * Every entry is JSON-serialized on its own line — comment bodies are
 * attacker/AI-controlled free text, and a raw newline embedded in one could
 * otherwise forge a fake extra log line (same bug class already fixed once
 * in this codebase for brief section filenames). JSON.stringify escapes
 * embedded newlines as \n within the string, so one JSON.parse per line
 * always recovers exactly one real entry.
 *
 * Deliberately a separate file from ticket-action-cooldown.mjs — this one
 * only ever grows and is never read on the hot path of a write attempt, so
 * its O(n) full-file nature doesn't matter to normal command latency.
 *
 * ticketKey is validated by the caller (ticket-command.mjs, via
 * TICKET_KEY_PATTERN) before it ever reaches here — this module re-validates
 * defensively since a log line is a place a malformed key could otherwise do
 * real damage (path traversal has no surface here since the log file path
 * never incorporates ticketKey, but a stray literal newline inside an
 * unvalidated key would reintroduce exactly the forgeable-line risk this
 * file exists to prevent).
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { TICKET_KEY_PATTERN } from './cli.mjs';

const LOG_FILE = 'ticket-action-log.jsonl';

function logPath(configDir) {
  return path.join(configDir, LOG_FILE);
}

/**
 * @param {{ ticketKey: string, action: 'comment'|'transition', actor: string, tracker: string, detail?: object }} entry
 * @param {{ configDir?: string, now?: () => Date }} [opts]
 */
export function logAction({ ticketKey, action, actor, tracker, detail = {} }, {
  configDir = DEFAULT_CONFIG_DIR,
  now = () => new Date(),
} = {}) {
  if (!TICKET_KEY_PATTERN.test(ticketKey)) {
    throw new Error(`Refusing to log malformed ticket key: ${JSON.stringify(ticketKey)}`);
  }
  const line = JSON.stringify({ ticketKey, action, actor, tracker, detail, at: now().toISOString() });
  fs.appendFileSync(logPath(configDir), line + '\n', 'utf8');
}

/**
 * @param {string} [configDir]
 * @returns {object[]} parsed entries, oldest first — a corrupt individual
 *   line is skipped rather than failing the whole read, since this is an
 *   append-only historical record and one bad line must not hide the rest.
 */
export function readActionLog(configDir = DEFAULT_CONFIG_DIR) {
  let raw;
  try {
    raw = fs.readFileSync(logPath(configDir), 'utf8');
  } catch {
    return [];
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // Skip a corrupt line — never let one bad append hide the rest of the trail.
    }
  }
  return entries;
}
