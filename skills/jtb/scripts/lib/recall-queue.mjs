/**
 * Local retry queue for Recall notes whose push to the team backend failed
 * for a transient reason (network error, timeout, or 5xx). A note is never
 * lost — it's already safe in the local vault (recall-vault.mjs) before this
 * module ever sees it; this only tracks the separate, best-effort intent to
 * also sync it to the team.
 *
 * Retry classification happens once, at the moment the original push fails
 * (isRetryableFailure) — 401/403/other-4xx are deliberately excluded: a
 * stale session or a doomed payload will never succeed by retrying, and
 * pushNote already warns the user about those synchronously.
 *
 * Growth is bounded two independent ways: a hard cap on entry count, and an
 * age-based expiry keyed off firstQueuedAt (not failedAt, which refreshes on
 * every retry attempt and would otherwise let a perpetually-failing entry
 * live forever).
 *
 * enqueueNote/flushQueue do read-modify-write on the queue file with no file
 * lock — same tradeoff already accepted by recall-pull-state.json and
 * recall-entitlement-state.json in recall-sync.mjs. Two concurrent CLI
 * invocations racing this file can lose one writer's update. Bounded,
 * accepted risk: this queue is a retry-intent cache, not the source of truth
 * (the note itself is already safe in the vault before it ever reaches here)
 * — not worth a lock for a low-frequency, single-user CLI tool.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { writeFileAtomically } from './recall-vault.mjs';
import { pushNote, hashToken } from './recall-sync.mjs';

const QUEUE_FILE = 'recall-pending.json';
const FLUSH_STATE_FILE = 'recall-flush-state.json';

export const MAX_QUEUE_SIZE = 200;
export const MAX_ENTRY_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const AUTO_FLUSH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function queuePath(configDir) {
  return path.join(configDir, QUEUE_FILE);
}

function flushStatePath(configDir) {
  return path.join(configDir, FLUSH_STATE_FILE);
}

/**
 * @param {string} configDir
 * @returns {Array<{id: string, notePayload: object, tokenHash: string, firstQueuedAt: string, failedAt: string, attempts: number}>}
 */
export function readQueue(configDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(queuePath(configDir), 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(configDir, entries) {
  writeFileAtomically(queuePath(configDir), JSON.stringify(entries));
}

function purgeExpired(entries, now) {
  return entries.filter(entry => now - new Date(entry.firstQueuedAt).getTime() <= MAX_ENTRY_AGE_MS);
}

/**
 * Decides whether a failed push is worth retrying later. Network errors and
 * timeouts (pushNote returns no `status` for these) and 5xx responses are
 * transient. 401 (session expired), 403 (not entitled / no team), and any
 * other 4xx (e.g. a validation failure) are not — retrying cannot fix them
 * without the user acting, or would just retry a payload that will never be
 * accepted.
 *
 * @param {{ ok: boolean, status?: number }} result
 * @returns {boolean}
 */
export function isRetryableFailure(result) {
  return !result.ok && (result.status === undefined || result.status >= 500);
}

/**
 * Queues a note for later retry after a transient push failure. Purges
 * expired entries first, then evicts the oldest entry (with a single warn)
 * if appending would exceed MAX_QUEUE_SIZE.
 *
 * @param {object}   notePayload - exact wire payload passed to pushNote
 * @param {object}   opts
 * @param {string}   opts.cliToken
 * @param {string}   [opts.configDir]
 * @param {() => number} [opts.now]
 * @param {Function} [opts.warn]
 */
export function enqueueNote(notePayload, {
  cliToken,
  configDir = DEFAULT_CONFIG_DIR,
  now = () => Date.now(),
  warn = (s) => process.stderr.write(s),
} = {}) {
  const nowMs = now();
  let entries = purgeExpired(readQueue(configDir), nowMs);

  if (entries.length >= MAX_QUEUE_SIZE) {
    entries = entries.slice(1);
    warn('  Recall queue full — dropped the oldest queued note to make room.\n');
  }

  const nowIso = new Date(nowMs).toISOString();
  entries.push({
    id: notePayload.external_id,
    notePayload,
    tokenHash: hashToken(cliToken),
    firstQueuedAt: nowIso,
    failedAt: nowIso,
    attempts: 0,
  });

  writeQueue(configDir, entries);
}

/**
 * Attempts to push every queued entry belonging to the current account
 * (matched by tokenHash). Entries queued under a different account are left
 * untouched — never attempted, never evicted by this pass. Expired entries
 * are purged first, regardless of tokenHash.
 *
 * @param {object}   opts
 * @param {string}   opts.cliToken
 * @param {string}   [opts.configDir]
 * @param {Function} [opts.pushNoteFn]
 * @param {Function} [opts.warn] - defaults to silent; callers doing a visible/manual sync should pass a real one
 * @param {() => number} [opts.now]
 * @returns {Promise<{ flushed: number, remaining: number }>}
 */
export async function flushQueue({
  cliToken,
  configDir = DEFAULT_CONFIG_DIR,
  pushNoteFn = pushNote,
  isRetryableFailureFn = isRetryableFailure,
  warn = () => {},
  now = () => Date.now(),
} = {}) {
  const nowMs = now();
  const currentHash = hashToken(cliToken);
  const entries = purgeExpired(readQueue(configDir), nowMs);

  let flushed = 0;
  const remaining = [];
  for (const entry of entries) {
    if (entry.tokenHash !== currentHash) {
      remaining.push(entry);
      continue;
    }

    const result = await pushNoteFn(entry.notePayload, { cliToken, configDir, warn });
    if (result.ok) {
      flushed++;
      continue;
    }

    // A retry can surface a DIFFERENT failure than the one that originally
    // queued this entry (e.g. the session expired between enqueue and this
    // attempt) — reclassify every time rather than trusting the original
    // enqueue decision, so a now-unrecoverable entry is dropped immediately
    // instead of silently retrying for up to MAX_ENTRY_AGE_MS.
    if (!isRetryableFailureFn(result)) continue;

    remaining.push({ ...entry, attempts: entry.attempts + 1, failedAt: new Date(nowMs).toISOString() });
  }

  writeQueue(configDir, remaining);
  return { flushed, remaining: remaining.length };
}

function readLastFlushAttemptAt(configDir) {
  try {
    return JSON.parse(fs.readFileSync(flushStatePath(configDir), 'utf8')).lastAttemptAt ?? null;
  } catch {
    return null;
  }
}

function writeLastFlushAttemptAt(configDir, isoTimestamp) {
  try {
    fs.writeFileSync(flushStatePath(configDir), JSON.stringify({ lastAttemptAt: isoTimestamp }), 'utf8');
  } catch {
    // Non-fatal — worst case the next command re-checks a moment sooner than the interval intends.
  }
}

/**
 * Time-gated background flush, attempted from the CLI's existing
 * Recall-touching entry points (note add's push, recall's pull) rather than
 * on every invocation — a no-op unless the queue is non-empty AND at least
 * AUTO_FLUSH_INTERVAL_MS has passed since the last attempt. The attempt
 * timestamp is recorded even on failure, so a down backend can't be hammered
 * once per command within the window.
 *
 * @param {object}   opts
 * @param {string}   opts.cliToken
 * @param {string}   [opts.configDir]
 * @param {() => number} [opts.now]
 * @param {Function} [opts.flushQueueFn]
 */
export async function maybeAutoFlush({
  cliToken,
  configDir = DEFAULT_CONFIG_DIR,
  now = () => Date.now(),
  flushQueueFn = flushQueue,
} = {}) {
  if (readQueue(configDir).length === 0) return;

  const lastAttemptAt = readLastFlushAttemptAt(configDir);
  const nowMs = now();
  if (lastAttemptAt && nowMs - new Date(lastAttemptAt).getTime() < AUTO_FLUSH_INTERVAL_MS) return;

  try {
    await flushQueueFn({ cliToken, configDir, now });
  } catch {
    // A down backend or a thrown network error must never crash the command
    // that opportunistically triggered this background attempt.
  } finally {
    writeLastFlushAttemptAt(configDir, new Date(nowMs).toISOString());
  }
}
