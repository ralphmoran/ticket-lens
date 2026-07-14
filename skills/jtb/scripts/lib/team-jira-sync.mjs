/**
 * Fetches and applies the team Jira config shared by the manager.
 * Non-secret fields only (URL, auth type, prefixes, project paths, triage statuses).
 * Each member stores their own Jira credentials locally.
 */

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCliToken } from './cli-auth.mjs';
import { saveProfile, loadProfiles } from './profile-resolver.mjs';
import { apiBase } from './api-utils.mjs';
import { DEFAULT_CONFIG_DIR, hostnameOf } from './config.mjs';

const META_FILE = 'team-jira-meta.json';

function metaPath(configDir) {
  return join(configDir, META_FILE);
}

function readMeta(configDir) {
  const p = metaPath(configDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeMeta(configDir, data) {
  writeFileSync(metaPath(configDir), JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
}

/**
 * Fetches GET /v1/team/config from the API.
 *
 * @param {object} opts
 * @param {string} [opts.configDir]
 * @param {Function} [opts.fetcher] - injectable fetch for testing
 * @returns {Promise<{error: string, [key: string]: any} | object>}
 */
export async function fetchTeamJiraConfig({ configDir = DEFAULT_CONFIG_DIR, fetcher = fetch } = {}) {
  const token = readCliToken(configDir);
  if (!token) return { error: 'no-token' };

  const url = `${apiBase()}/v1/team/config`;
  let res;
  try {
    res = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    return { error: 'network', message: e.message };
  }

  if (res.status === 403) return { error: 'http-403' };
  if (res.status === 404) return { error: 'http-404' };
  if (!res.ok) return { error: `http-${res.status}` };

  try {
    return await res.json();
  } catch (e) {
    return { error: 'parse', message: e.message };
  }
}

/**
 * Converts API team config response to a CLI profile data object.
 */
function teamConfigToCliProfile(apiData) {
  const profile = { baseUrl: apiData.jira_base_url, auth: apiData.auth_type };
  if (apiData.prefixes?.length)        profile.ticketPrefixes  = apiData.prefixes;
  if (apiData.project_paths?.length)   profile.projectPaths    = apiData.project_paths;
  if (apiData.triage_statuses?.length) profile.triageStatuses  = apiData.triage_statuses;
  return profile;
}

/**
 * Writes team config to the named profile without touching credentials.
 * Carries forward `allowPrivateIp` from the existing LOCAL profile only —
 * never from server data (see teamConfigToCliProfile) — and only when the
 * synced baseUrl resolves to the SAME hostname the trust was granted for.
 * A sync that changes the host (legitimate re-point, or a compromised/
 * malicious sync response) must never inherit trust for a different,
 * unconfirmed host — the member has to re-confirm via the wizard.
 * Returns { error, message } on failure — never throws.
 */
async function applyTeamJiraConfig(groupName, profileData, configDir) {
  try {
    const existing = loadProfiles(configDir)?.profiles?.[groupName];
    const sameHost = existing?.baseUrl && profileData.baseUrl &&
      hostnameOf(existing.baseUrl) === hostnameOf(profileData.baseUrl);
    const merged = (existing?.allowPrivateIp && sameHost)
      ? { ...profileData, allowPrivateIp: true }
      : profileData;
    await saveProfile(groupName, merged, null, configDir);
    return { ok: true };
  } catch (e) {
    return { error: 'save-failed', message: e.message };
  }
}

/**
 * Silently checks whether the team Jira config has changed since last fetch.
 * Applies the new config and returns a banner string if changed.
 * Never throws — always returns an object.
 *
 * @param {object} opts
 * @param {string} [opts.configDir]
 * @param {Function} [opts.fetcher]
 * @returns {Promise<{updated: boolean, deleted?: boolean, banner?: string, error?: string}>}
 */
export async function checkTeamJiraConfigUpdate({ configDir = DEFAULT_CONFIG_DIR, fetcher = fetch } = {}) {
  const apiData = await fetchTeamJiraConfig({ configDir, fetcher });

  if (apiData.error === 'http-403') return { updated: false };
  if (apiData.error === 'http-404') return { updated: false, deleted: true };
  if (apiData.error)               return { updated: false, error: apiData.error };

  const meta = readMeta(configDir);

  // No change since last fetch — skip silently
  if (meta?.updated_at && meta.updated_at === apiData.updated_at) {
    return { updated: false };
  }

  const groupName = String(apiData.group_name ?? '').trim().slice(0, 100);
  if (!groupName || /^(__proto__|constructor|prototype)$/.test(groupName)) {
    return { updated: false, error: 'invalid-group-name' };
  }
  const profileData = teamConfigToCliProfile(apiData);
  const applied     = await applyTeamJiraConfig(groupName, profileData, configDir);

  if (applied.error) return { updated: false, error: applied.error };

  try {
    writeMeta(configDir, {
      group_name:    groupName,
      updated_at:    apiData.updated_at,
      jira_base_url: apiData.jira_base_url,
      auth_type:     apiData.auth_type,
    });
  } catch {
    return { updated: false, error: 'meta-write-failed' };
  }

  const changedFields = [];
  if (meta?.jira_base_url && meta.jira_base_url !== apiData.jira_base_url) changedFields.push('Jira URL');
  if (meta?.auth_type      && meta.auth_type     !== apiData.auth_type)     changedFields.push('auth type');

  const detail = changedFields.length > 0
    ? ` (${changedFields.join(', ')} changed)`
    : '';

  const banner = `⚠ Team Jira config updated by manager (${apiData.updated_at})${detail}.`;

  return { updated: true, banner, groupName };
}

/**
 * Fetches team Jira config on first login and applies it.
 * Returns the group name so the caller can prompt for personal credentials.
 *
 * @param {object} opts
 * @param {string} [opts.configDir]
 * @param {Function} [opts.fetcher]
 * @returns {Promise<{ok: boolean, groupName?: string, error?: string}>}
 */
export async function applyTeamConfigOnLogin({ configDir = DEFAULT_CONFIG_DIR, fetcher = fetch } = {}) {
  const apiData = await fetchTeamJiraConfig({ configDir, fetcher });

  // Free tier / no token / network error — silently skip (not a blocker for login)
  if (apiData.error) return { ok: false, error: apiData.error };

  const groupName = String(apiData.group_name ?? '').trim().slice(0, 100);
  if (!groupName || /^(__proto__|constructor|prototype)$/.test(groupName)) {
    return { ok: false, error: 'invalid-group-name' };
  }
  const profileData = teamConfigToCliProfile(apiData);
  const applied     = await applyTeamJiraConfig(groupName, profileData, configDir);

  if (applied.error) return { ok: false, error: applied.error };

  try {
    writeMeta(configDir, {
      group_name:    groupName,
      updated_at:    apiData.updated_at,
      jira_base_url: apiData.jira_base_url,
      auth_type:     apiData.auth_type,
    });
  } catch {
    return { ok: false, error: 'meta-write-failed' };
  }

  return { ok: true, groupName, authType: apiData.auth_type };
}
