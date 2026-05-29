/**
 * Background npm update check.
 * Caches the latest published version in ~/.ticketlens/update-check.json with a 24h TTL.
 * Never blocks the CLI — all failures are silently swallowed.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG_DIR, getVersion } from './config.mjs';

export const UPDATE_CHECK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const REGISTRY_URL = 'https://registry.npmjs.org/ticketlens/latest';
const CHECK_FILE = 'update-check.json';

/** Path to the update-check cache file. */
function checkFilePath(configDir) {
  return join(configDir, CHECK_FILE);
}

/**
 * Returns the cached latestVersion string if the cache is present and within TTL,
 * or null otherwise.
 */
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

export function readUpdateCheck(configDir = DEFAULT_CONFIG_DIR) {
  try {
    const data = JSON.parse(readFileSync(checkFilePath(configDir), 'utf8'));
    if (!data?.checkedAt || typeof data.latestVersion !== 'string') return null;
    if (!SEMVER_RE.test(data.latestVersion)) return null;
    if (Date.now() - new Date(data.checkedAt).getTime() > UPDATE_CHECK_TTL_MS) return null;
    return data.latestVersion;
  } catch {
    return null;
  }
}

/**
 * Writes { checkedAt, latestVersion } to the cache file. Non-fatal.
 */
export function writeUpdateCheck(configDir = DEFAULT_CONFIG_DIR, latestVersion) {
  try {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      checkFilePath(configDir),
      JSON.stringify({ checkedAt: new Date().toISOString(), latestVersion }),
      { mode: 0o644 },
    );
  } catch {
    // non-fatal
  }
}

/**
 * Returns true when latest is strictly greater than current.
 * Strips leading 'v' from both before comparing.
 */
export function isNewer(latest, current) {
  const parse = v => v.replace(/^v/, '').split('.').map(Number);
  const [la, lb, lc] = parse(latest);
  const [ca, cb, cc] = parse(current);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

/**
 * Fetches the latest version from the npm registry.
 * Returns the version string, or null on any failure.
 */
export async function fetchLatestVersion({ fetcher = globalThis.fetch } = {}) {
  try {
    const res = await fetcher(REGISTRY_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget: checks if the cache is expired and, if so, fetches the latest
 * version from npm and writes it to the cache. Errors are silently swallowed.
 * Call at CLI startup; never await.
 */
export function checkForUpdate({ configDir = DEFAULT_CONFIG_DIR, fetcher = globalThis.fetch } = {}) {
  if (readUpdateCheck(configDir) !== null) return Promise.resolve();
  return fetchLatestVersion({ fetcher })
    .then(v => { if (v) writeUpdateCheck(configDir, v); })
    .catch(() => {});
}

/**
 * Returns the cached latestVersion string if it is newer than the current installed
 * version, or null if no update is available or the cache is absent/expired.
 */
export function getUpdateHint({ configDir = DEFAULT_CONFIG_DIR, currentVersion = getVersion() } = {}) {
  const latest = readUpdateCheck(configDir);
  if (!latest) return null;
  return isNewer(latest, currentVersion) ? latest : null;
}
