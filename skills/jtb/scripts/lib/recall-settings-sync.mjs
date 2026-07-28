/**
 * Effective Recall queue settings (flush cooldown, per-request timeout, max
 * queue size, max entry age) — manager-controlled per team via the Console
 * (console/admin/recall).
 *
 * getEffectiveRecallSettings() fetches live at the moment a caller actually
 * needs a decision (queue non-empty, a push just failed, or an explicit `tl
 * recall settings`) — never on a background timer. Those moments are already
 * rare (recall-queue.mjs's callers all short-circuit on a local, network-free
 * read when there's nothing to do), so a manager's Console change is visible
 * on the very next command that matters, without adding network cost to the
 * overwhelming majority of commands that never touch this at all.
 *
 * A local cache (recall-settings-cache.json) exists only as an offline/
 * failure fallback — written on every successful fetch, read when a fetch
 * fails or there's no cliToken. Values from it are never trusted blindly,
 * even though they came from our own backend: they're re-clamped against the
 * same bounds the server enforces, so a corrupted cache file or a future
 * server bug can never push a CLI-side value (e.g. a near-zero cooldown)
 * outside safe range.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { apiBase } from './api-utils.mjs';
import { writeFileAtomically } from './recall-vault.mjs';
import { hashToken } from './recall-sync.mjs';

const SETTINGS_PATH = '/v1/recall/settings';
const CACHE_FILE = 'recall-settings-cache.json';

// Fixed, not manager-configurable — this timeout gates the fetch of the
// settings themselves, so it can't depend on a settings value that hasn't
// been fetched yet. Short: this fires only on already-rare paths, but must
// still never let a slow/down backend meaningfully stall those commands.
const FETCH_TIMEOUT_MS = 3_000;

// Platform defaults — must match RecallSettings::DEFAULTS in ticketlens-api.
export const DEFAULT_RECALL_SETTINGS = {
  flush_cooldown_ms: 900_000,       // 15 minutes
  timeout_ms: 4_000,                // 4 seconds
  max_queue_size: 200,
  max_entry_age_ms: 2_592_000_000,  // 30 days
};

// Inclusive [min, max] bounds — must match RecallSettings::BOUNDS in ticketlens-api.
export const RECALL_SETTINGS_BOUNDS = {
  flush_cooldown_ms: [60_000, 86_400_000],       // 1m .. 24h
  timeout_ms: [1_000, 30_000],                   // 1s .. 30s
  max_queue_size: [10, 2_000],
  max_entry_age_ms: [3_600_000, 7_776_000_000],  // 1h .. 90d
};

function cachePath(configDir) {
  return path.join(configDir, CACHE_FILE);
}

function clamp(field, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_RECALL_SETTINGS[field];
  const [min, max] = RECALL_SETTINGS_BOUNDS[field];
  return Math.min(Math.max(value, min), max);
}

/**
 * Local-only, synchronous fallback — used when there's no cliToken, or a live
 * fetch just failed. Requires cliToken to return a cached override at all: a
 * cache written under a different (or since-logged-out) account must never
 * silently apply to this one, so a tokenHash mismatch (or no token) falls
 * through to platform defaults rather than trusting stale/foreign data.
 *
 * @param {string} configDir
 * @param {object} [opts]
 * @param {string} [opts.cliToken]
 * @returns {{flush_cooldown_ms: number, timeout_ms: number, max_queue_size: number, max_entry_age_ms: number}}
 */
export function readEffectiveRecallSettings(configDir = DEFAULT_CONFIG_DIR, { cliToken } = {}) {
  if (!cliToken) return { ...DEFAULT_RECALL_SETTINGS };

  let cached;
  try {
    cached = JSON.parse(fs.readFileSync(cachePath(configDir), 'utf8'));
  } catch {
    return { ...DEFAULT_RECALL_SETTINGS };
  }
  if (!cached || typeof cached.values !== 'object' || cached.tokenHash !== hashToken(cliToken)) {
    return { ...DEFAULT_RECALL_SETTINGS };
  }

  const effective = {};
  for (const field of Object.keys(DEFAULT_RECALL_SETTINGS)) {
    effective[field] = clamp(field, cached.values[field]);
  }
  return effective;
}

/**
 * GET /v1/recall/settings. Returns {ok:false} on any network/parse failure —
 * callers fall back to readEffectiveRecallSettings' cached/default behavior.
 */
export async function fetchRecallSettings({
  cliToken,
  timeoutMs = FETCH_TIMEOUT_MS,
  fetcher = globalThis.fetch,
} = {}) {
  if (!cliToken) return { ok: false, error: 'no-token' };

  let res;
  try {
    res = await fetcher(`${apiBase()}${SETTINGS_PATH}`, {
      headers: { Authorization: `Bearer ${cliToken}`, Accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return { ok: false, error: 'network', message: e.message };
  }

  if (!res.ok) return { ok: false, error: `http-${res.status}` };

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, error: 'parse' };
  }

  return { ok: true, values: payload, isOverride: payload.is_override === true };
}

/**
 * The main entry point — fetches live so a manager's Console change is
 * visible immediately, falling back to the last-known-good local cache (or
 * platform defaults) on any failure so a network blip never blocks a retry
 * decision. Every successful fetch refreshes that fallback cache too, tagged
 * with a hash of cliToken so a later account switch never serves a stale
 * team's settings as a "fallback."
 *
 * @param {object} opts
 * @param {string} [opts.cliToken]
 * @param {string} [opts.configDir]
 * @param {() => number} [opts.now]
 * @param {Function} [opts.fetchRecallSettingsFn]
 * @returns {Promise<{flush_cooldown_ms: number, timeout_ms: number, max_queue_size: number, max_entry_age_ms: number}>}
 */
export async function getEffectiveRecallSettings({
  cliToken,
  configDir = DEFAULT_CONFIG_DIR,
  now = () => Date.now(),
  fetchRecallSettingsFn = fetchRecallSettings,
} = {}) {
  if (!cliToken) return readEffectiveRecallSettings(configDir);

  const result = await fetchRecallSettingsFn({ cliToken });
  if (!result.ok) return readEffectiveRecallSettings(configDir, { cliToken });

  writeFileAtomically(cachePath(configDir), JSON.stringify({
    values: result.values,
    tokenHash: hashToken(cliToken),
    fetchedAt: new Date(now()).toISOString(),
  }));

  const effective = {};
  for (const field of Object.keys(DEFAULT_RECALL_SETTINGS)) {
    effective[field] = clamp(field, result.values[field]);
  }
  return effective;
}
