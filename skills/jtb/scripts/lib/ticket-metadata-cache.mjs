/**
 * Project/issue-type metadata cache for `ticketlens create` — stores what
 * this profile has actually confirmed it can create against (real project
 * keys, real Jira issue types per project), refreshed only when a create
 * attempt fails with a project/issuetype-shaped error. Never populated on
 * the success path: that data only has value for enriching a failure
 * message, so fetching it on every create call "just in case" would waste
 * a network round-trip for the common case where the caller already got
 * project/type right.
 *
 * Path:   ~/.ticketlens/cache/PROFILE/ticket-metadata.json
 * Format: { fetchedAt, projects: [{key, name}], issueTypesByProject: {KEY: [{id, name}]} }
 * TTL:    24 hours (bypassed by an always-forced refresh from the caller
 *         after a project/issuetype error — see ticket-command.mjs)
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

export const METADATA_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Returns the absolute path to the ticket-metadata cache file for a profile.
 */
export function metadataCachePath(profileName, configDir = DEFAULT_CONFIG_DIR) {
  const safeProfile = (profileName || '_default').replace(/[^a-zA-Z0-9_\-]/g, '_');
  const resolvedDir = path.resolve(configDir);
  const result = path.join(resolvedDir, 'cache', safeProfile, 'ticket-metadata.json');
  // Defense-in-depth: ensure the final path cannot escape the config directory,
  // even if configDir itself is manipulated or the sanitization above is weakened.
  if (!result.startsWith(resolvedDir + path.sep)) {
    throw new Error(`Cache path escapes config directory: ${result}`);
  }
  return result;
}

/**
 * Reads cached project/issue-type metadata for a profile.
 * Returns null on cache miss, expired TTL, or corrupt JSON.
 *
 * @param {string|null} profileName
 * @param {string} [configDir]
 * @param {number} [ttlMs] - override TTL in ms; defaults to METADATA_TTL_MS (24h)
 * @returns {{ projects: {key:string,name:string}[], issueTypesByProject: object, fetchedAt: string } | null}
 */
export function readMetadataCache(profileName, configDir = DEFAULT_CONFIG_DIR, ttlMs = METADATA_TTL_MS) {
  const filePath = metadataCachePath(profileName, configDir);
  if (!fs.existsSync(filePath)) return null;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }

  const age = Date.now() - new Date(data.fetchedAt).getTime();
  if (isNaN(age) || age > ttlMs) {
    try { fs.unlinkSync(filePath); } catch { /* non-fatal */ }
    return null;
  }

  return {
    projects: data.projects ?? [],
    issueTypesByProject: data.issueTypesByProject ?? {},
    fetchedAt: data.fetchedAt,
  };
}

/**
 * Writes project/issue-type metadata to the cache. Non-fatal — a write
 * failure must never break the caller (an enrichment attempt after an
 * already-failed create).
 */
export function writeMetadataCache(profileName, { projects = [], issueTypesByProject = {} } = {}, configDir = DEFAULT_CONFIG_DIR) {
  const filePath = metadataCachePath(profileName, configDir);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ fetchedAt: new Date().toISOString(), projects, issueTypesByProject }));
  } catch {
    // Non-fatal
  }
}
