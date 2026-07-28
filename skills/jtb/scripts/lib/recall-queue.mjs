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
import { getEffectiveRecallSettings, DEFAULT_RECALL_SETTINGS } from './recall-settings-sync.mjs';

const QUEUE_FILE = 'recall-pending.json';
const FLUSH_STATE_FILE = 'recall-flush-state.json';

// Platform defaults — actual effective values now come from
// getEffectiveRecallSettings(), which is the manager's Console override for
// their team if one exists (fetched live), else these same numbers.
export const DEFAULT_MAX_QUEUE_SIZE = DEFAULT_RECALL_SETTINGS.max_queue_size;
export const DEFAULT_MAX_ENTRY_AGE_MS = DEFAULT_RECALL_SETTINGS.max_entry_age_ms;
export const DEFAULT_AUTO_FLUSH_INTERVAL_MS = DEFAULT_RECALL_SETTINGS.flush_cooldown_ms;

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

function purgeExpired(entries, now, maxEntryAgeMs) {
  return entries.filter(entry => now - new Date(entry.firstQueuedAt).getTime() <= maxEntryAgeMs);
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
 * if appending would exceed the effective max queue size (Console-managed
 * per team, fetched live — see recall-settings-sync.mjs). Async: a push just
 * failed, so one more short network call to get the current cap/expiry
 * doesn't change this path's performance characteristics.
 *
 * @param {object}   notePayload - exact wire payload passed to pushNote
 * @param {object}   opts
 * @param {string}   opts.cliToken
 * @param {string}   [opts.configDir]
 * @param {() => number} [opts.now]
 * @param {Function} [opts.warn]
 * @returns {Promise<void>}
 */
export async function enqueueNote(notePayload, {
  cliToken,
  configDir = DEFAULT_CONFIG_DIR,
  now = () => Date.now(),
  warn = (s) => process.stderr.write(s),
  getEffectiveRecallSettingsFn = getEffectiveRecallSettings,
} = {}) {
  const nowMs = now();
  const settings = await getEffectiveRecallSettingsFn({ cliToken, configDir });
  let entries = purgeExpired(readQueue(configDir), nowMs, settings.max_entry_age_ms);

  if (entries.length >= settings.max_queue_size) {
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
  timeoutMs,
  settings,
  getEffectiveRecallSettingsFn = getEffectiveRecallSettings,
} = {}) {
  const nowMs = now();
  const currentHash = hashToken(cliToken);
  // Only the age bound comes from settings here — timeoutMs is caller-supplied
  // or falls through to pushNote's own default. maybeAutoFlush (below) is the
  // one call site that maps the Console-configured timeout_ms onto this param;
  // runRecallSync's manual, user-initiated flush deliberately keeps a longer,
  // uncapped-by-this-setting timeout since the user is actively waiting.
  // `settings` is an optional already-fetched value — maybeAutoFlush passes
  // its own fetch through here so a single auto-flush attempt never fetches
  // settings twice; a direct/manual call (runRecallSync) has none yet, so
  // this fetches its own.
  const effectiveSettings = settings ?? await getEffectiveRecallSettingsFn({ cliToken, configDir });
  const entries = purgeExpired(readQueue(configDir), nowMs, effectiveSettings.max_entry_age_ms);

  let flushed = 0;
  const remaining = [];
  for (const entry of entries) {
    if (entry.tokenHash !== currentHash) {
      remaining.push(entry);
      continue;
    }

    const result = await pushNoteFn(entry.notePayload, {
      cliToken, configDir, warn, ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
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
 * Time-gated background flush. Called from every command's entry point
 * (bin/ticketlens.mjs), not just Recall-specific ones — a note added during
 * a burst of failures (e.g. a debugging session) would otherwise sit queued
 * until the user happens to run `note add`/`recall` again, or runs
 * `recall sync` by hand. A no-op unless the queue is non-empty AND at least
 * the effective flush cooldown (Console-managed per team, defaults to 15
 * minutes — see recall-settings-sync.mjs) has passed since the last attempt.
 * The interval is a single global cooldown, not per-entry, so a burst of
 * failures in one short window still only gets one automatic retry pass, by
 * design: this runs on every command now, so the next opportunity is never
 * far away, and the cooldown exists specifically to stop a down backend from
 * being hit by every single command in the meantime. The attempt timestamp is
 * recorded even on failure, so a down backend can't be hammered once per
 * command within the window.
 *
 * @param {object}   opts
 * @param {string}   opts.cliToken
 * @param {string}   [opts.configDir]
 * @param {() => number} [opts.now]
 * @param {Function} [opts.flushQueueFn]
 * @param {number}   [opts.timeoutMs] - per-request timeout, passed through to
 *   pushNote. Defaults to the effective settings' timeout_ms (Console-managed,
 *   defaults to 4s) — short, because this runs unconditionally on every
 *   command and must feel instant, not stall an unrelated command behind a
 *   slow network. Pass explicitly to override.
 * @returns {Promise<{flushed: number, remaining: number}|null>} null if skipped
 *   (empty queue or still cooling down) — distinguishes "nothing to report"
 *   from "attempted, flushed 0" for a caller that wants to print a summary.
 */
export async function maybeAutoFlush({
  cliToken,
  configDir = DEFAULT_CONFIG_DIR,
  now = () => Date.now(),
  flushQueueFn = flushQueue,
  timeoutMs,
  getEffectiveRecallSettingsFn = getEffectiveRecallSettings,
} = {}) {
  if (readQueue(configDir).length === 0) return null;

  // Fetched once here (live) and threaded through to flushQueueFn below —
  // flushQueue also needs max_entry_age_ms but must not fetch a second time
  // for what is, from the outside, a single "attempt a flush" decision.
  const settings = await getEffectiveRecallSettingsFn({ cliToken, configDir });
  const lastAttemptAt = readLastFlushAttemptAt(configDir);
  const nowMs = now();
  if (lastAttemptAt && nowMs - new Date(lastAttemptAt).getTime() < settings.flush_cooldown_ms) return null;

  const effectiveTimeoutMs = timeoutMs !== undefined ? timeoutMs : settings.timeout_ms;
  try {
    return await flushQueueFn({ cliToken, configDir, now, timeoutMs: effectiveTimeoutMs, settings });
  } catch {
    // A down backend or a thrown network error must never crash the command
    // that opportunistically triggered this background attempt.
    return null;
  } finally {
    writeLastFlushAttemptAt(configDir, new Date(nowMs).toISOString());
  }
}
