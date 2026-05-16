/**
 * ticketlens sync — Pull tracker profile shapes from the TicketLens console.
 *
 * Credentials are NEVER synced — they stay on the local machine.
 * Server wins on all non-credential fields (shape, prefixes, URLs, etc.).
 */

import { readCliToken } from './cli-auth.mjs';
import {
  loadProfiles,
  loadCredentials,
  saveProfile,
  invalidateProfilesCache,
} from './profile-resolver.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

const DEFAULT_API_BASE = 'https://api.ticketlens.app';

export const getApiBase     = () => process.env.TICKETLENS_API_URL ?? DEFAULT_API_BASE;
// Strip the api. subdomain to get the console base URL (e.g. api.ticketlens.app → ticketlens.app)
export const getConsoleBase = () => getApiBase().replace('://api.', '://');

/**
 * Convert a server profile (snake_case) to the CLI profile shape (camelCase).
 * Returns { name, profileData } — no credential fields.
 */
export function serverToCliProfile(serverProfile) {
  const p = serverProfile;
  const profileData = {
    baseUrl: p.base_url,
    auth: p.auth_method,
    ...(p.email                    ? { email: p.email }                       : {}),
    ...(p.ticket_prefixes?.length  ? { ticketPrefixes: p.ticket_prefixes }    : {}),
    ...(p.project_paths?.length    ? { projectPaths: p.project_paths }        : {}),
    ...(p.triage_statuses?.length  ? { triageStatuses: p.triage_statuses }    : {}),
  };
  return { name: p.name, profileData };
}

/**
 * Determine whether a profile is missing the credentials it needs to function.
 */
export function profileNeedsCredentials(profileData, creds) {
  if (!creds) return true;
  const auth = profileData.auth;
  if (auth === 'pat')    return !creds.pat;
  return !creds.apiToken; // cloud, basic, github all use apiToken
}

/**
 * Sync tracker profile shapes from the TicketLens console API.
 *
 * @param {object} [opts]
 * @param {string}   [opts.configDir]
 * @param {Function} [opts.fetcher]   — injectable for tests
 *
 * @returns {Promise<
 *   | { error: 'no-token' | 'unauthorized' | string }
 *   | { added: string[], updated: string[], unchanged: string[], needsCredentials: string[] }
 * >}
 */
export async function syncProfiles({
  configDir = DEFAULT_CONFIG_DIR,
  fetcher = globalThis.fetch,
} = {}) {
  const token = readCliToken(configDir);
  if (!token) return { error: 'no-token' };

  let res;
  try {
    res = await fetcher(`${getApiBase()}/v1/profiles`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    return { error: err.name === 'TimeoutError' ? 'timeout' : `network: ${err.message}` };
  }

  if (res.status === 401) return { error: 'unauthorized' };
  if (!res.ok) return { error: `http-${res.status}` };

  let json;
  try { json = await res.json(); } catch { return { error: 'invalid-json' }; }

  const remoteProfiles = Array.isArray(json?.profiles) ? json.profiles : [];
  const localConfig  = loadProfiles(configDir) || { profiles: {} };
  const localCreds   = loadCredentials(configDir);

  const added            = [];
  const updated          = [];
  const unchanged        = [];
  const needsCredentials = [];

  for (const remote of remoteProfiles) {
    const { name, profileData } = serverToCliProfile(remote);
    const existing = localConfig.profiles[name];

    if (!existing) {
      saveProfile(name, profileData, {}, configDir);
      added.push(name);
    } else if (JSON.stringify(existing) !== JSON.stringify(profileData)) {
      saveProfile(name, profileData, {}, configDir);
      updated.push(name);
    } else {
      unchanged.push(name);
    }

    if (profileNeedsCredentials(profileData, localCreds[name])) {
      needsCredentials.push(name);
    }
  }

  if (added.length > 0 || updated.length > 0) {
    invalidateProfilesCache(configDir);
  }

  return { added, updated, unchanged, needsCredentials };
}
