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
import { apiBase } from './api-utils.mjs';
import { createStyler } from './ansi.mjs';

export const getApiBase     = () => apiBase();
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
    ...(p.stale_rule               ? { staleRule: p.stale_rule }              : {}),
    ...(p.known_statuses?.length   ? { knownStatuses: p.known_statuses, statusesCachedAt: p.statuses_cached_at ?? null } : {}),
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

/**
 * Formats a syncProfiles() result to a stream. Shared by `ticketlens sync`
 * and the onboarding hub's "Console login" step so both report the same
 * added/updated/unchanged/needsCredentials/error detail instead of one of
 * them silently swallowing the result.
 *
 * @param {Awaited<ReturnType<typeof syncProfiles>>} result
 * @param {object} [opts]
 * @param {NodeJS.WriteStream} [opts.stream=process.stderr]
 */
export function reportSyncResult(result, { stream = process.stderr } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });

  if (result.error === 'no-token') {
    stream.write(`  ${s.red('✖')} Not logged in. Run ${s.cyan('ticketlens login')} first.\n`);
    return;
  }
  if (result.error === 'unauthorized') {
    stream.write(`  ${s.red('✖')} Token expired or revoked. Run ${s.cyan('ticketlens login')} to re-authenticate.\n`);
    return;
  }
  if (result.error) {
    stream.write(`  ${s.red('✖')} Sync failed: ${result.error}\n`);
    return;
  }

  const { added, updated, unchanged, needsCredentials } = result;
  const total = added.length + updated.length + unchanged.length;

  stream.write(`  ${s.green('✔')} Sync complete`);
  if (total === 0) {
    stream.write(` — no profiles on console yet.\n`);
  } else {
    stream.write(`\n`);
    if (added.length)     stream.write(`  ${s.dim('+')} ${added.length} added: ${added.map(n => s.cyan(n)).join(', ')}\n`);
    if (updated.length)   stream.write(`  ${s.dim('↑')} ${updated.length} updated: ${updated.map(n => s.cyan(n)).join(', ')}\n`);
    if (unchanged.length) stream.write(`  ${s.dim('○')} ${unchanged.length} unchanged\n`);
  }

  if (needsCredentials.length > 0) {
    stream.write(`\n  ${s.yellow('!')} These profiles need credentials before they can be used:\n`);
    for (const name of needsCredentials) {
      stream.write(`    ${s.dim('○')} ${s.cyan(name)} — run: ${s.bold(`ticketlens config --profile=${name}`)}\n`);
    }
  }
}
