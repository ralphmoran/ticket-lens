/**
 * Pure diagnostic check functions for `ticketlens doctor`. Each function
 * takes DI'd dependencies (matching the xFn = defaultX pattern used
 * throughout this codebase) and returns a normalized result:
 *   { id, label, ok, message, hint, fixable }
 * No stdout/stdin, no arg parsing — independently unit-testable in
 * isolation from CLI/MCP concerns.
 */

import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { resolveProfile, loadCredentials, loadProfiles } from './profile-resolver.mjs';
import { checkLicense, GRACE_DAYS } from './license.mjs';
import { resolveAdapter } from './resolve-adapter.mjs';
import { classifyError } from './error-classifier.mjs';
import { testConnections } from './connection-tester.mjs';
import { formatSize } from './attachment-downloader.mjs';
import { getCacheEntries, filterEntriesByProfile } from './cache-manager.mjs';

const NOOP_STREAM = { write: () => true };

export function checkProfileConfig({
  configDir = DEFAULT_CONFIG_DIR,
  profileName = null,
  cwd = process.cwd(),
  resolveProfileFn = resolveProfile,
  loadCredentialsFn = loadCredentials,
} = {}) {
  const profile = resolveProfileFn(null, { profileName, configDir, cwd });

  if (!profile) {
    return {
      id: 'profile-config', label: 'Profile configuration', ok: false,
      message: profileName ? `Profile "${profileName}" not found.` : 'No profile configured.',
      hint: profileName ? 'Run `ticketlens profiles` to see available profiles.' : 'Run `ticketlens init` to set up a profile.',
      fixable: false,
    };
  }

  if (!profile.baseUrl) {
    return {
      id: 'profile-config', label: 'Profile configuration', ok: false,
      message: `Profile "${profile.name}" has no baseUrl configured.`,
      hint: `Run \`ticketlens config --profile=${profile.name}\` to fix it.`,
      fixable: false,
    };
  }

  const creds = loadCredentialsFn(configDir)[profile.name] || {};
  if (!creds.apiToken && !creds.pat) {
    return {
      id: 'profile-config', label: 'Profile configuration', ok: false,
      message: `Profile "${profile.name}" has no credentials stored.`,
      hint: `Run \`ticketlens config --profile=${profile.name}\` to add an API token or PAT.`,
      fixable: false,
    };
  }

  return {
    id: 'profile-config', label: 'Profile configuration', ok: true,
    message: `Profile "${profile.name}" resolves with a baseUrl and stored credentials.`,
    hint: null, fixable: false,
  };
}

export function checkLicenseFreshness({
  configDir = DEFAULT_CONFIG_DIR,
  checkLicenseFn = checkLicense,
} = {}) {
  const status = checkLicenseFn(configDir);

  if (!status.key) {
    return {
      id: 'license-freshness', label: 'License freshness', ok: true,
      message: 'Free tier — no license to validate.', hint: null, fixable: false,
    };
  }

  if (status.expired) {
    return {
      id: 'license-freshness', label: 'License freshness', ok: false,
      message: 'License expired.',
      hint: 'Run `ticketlens activate <KEY>` to renew.', fixable: true,
    };
  }

  const daysSinceVal = status.validatedAt
    ? (Date.now() - new Date(status.validatedAt).getTime()) / 86400000
    : Infinity;

  if (daysSinceVal > GRACE_DAYS) {
    return {
      id: 'license-freshness', label: 'License freshness', ok: false,
      message: `Not revalidated in over ${GRACE_DAYS} days.`,
      hint: 'Run `ticketlens doctor --fix` to revalidate now.', fixable: true,
    };
  }

  return {
    id: 'license-freshness', label: 'License freshness', ok: true,
    message: `${status.tier} license active, last validated ${Math.floor(daysSinceVal)} day(s) ago.`,
    hint: null, fixable: false,
  };
}

export async function checkConnectivity({
  configDir = DEFAULT_CONFIG_DIR,
  profileName = null,
  cwd = process.cwd(),
  resolveProfileFn = resolveProfile,
  loadCredentialsFn = loadCredentials,
  resolveAdapterFn = resolveAdapter,
  classifyErrorFn = classifyError,
  testConnectionsFn = testConnections,
} = {}) {
  if (profileName) {
    const profile = resolveProfileFn(null, { profileName, configDir, cwd });
    if (!profile) {
      return {
        id: 'connectivity', label: 'Tracker connectivity', ok: false,
        message: `Profile "${profileName}" not found.`, hint: null, fixable: false,
      };
    }
    const creds = loadCredentialsFn(configDir)[profile.name] || {};
    const conn = {
      baseUrl: profile.baseUrl, auth: profile.auth, email: profile.email,
      apiToken: creds.apiToken, pat: creds.pat, allowPrivateIp: profile.allowPrivateIp,
    };
    try {
      await resolveAdapterFn(conn).fetchCurrentUser();
      return {
        id: 'connectivity', label: 'Tracker connectivity', ok: true,
        message: `Profile "${profile.name}" connected successfully.`, hint: null, fixable: false,
      };
    } catch (err) {
      const classified = classifyErrorFn(err, { baseUrl: conn.baseUrl, profileName: profile.name });
      return {
        id: 'connectivity', label: 'Tracker connectivity', ok: false,
        message: classified.message, hint: classified.hint, fixable: false,
      };
    }
  }

  const { results, failedCount } = await testConnectionsFn({ configDir, stream: NOOP_STREAM });
  if (results.length === 0) {
    return {
      id: 'connectivity', label: 'Tracker connectivity', ok: true,
      message: 'No profiles configured — nothing to test.', hint: null, fixable: false,
    };
  }
  const summary = results.map(r => r.ok ? `${r.name}: ok` : `${r.name}: ${r.error}`).join('; ');
  return {
    id: 'connectivity', label: 'Tracker connectivity',
    ok: failedCount === 0,
    message: failedCount === 0
      ? `All ${results.length} profile(s) connected successfully.`
      : `${failedCount}/${results.length} profile(s) failed to connect.`,
    hint: failedCount === 0 ? null : summary,
    fixable: false,
  };
}

export function checkCacheHealth({
  configDir = DEFAULT_CONFIG_DIR,
  profileName = null,
  getCacheEntriesFn = getCacheEntries,
  loadProfilesFn = loadProfiles,
  filterEntriesByProfileFn = filterEntriesByProfile,
} = {}) {
  let entries = getCacheEntriesFn(configDir);
  if (profileName) {
    entries = filterEntriesByProfileFn(entries, profileName, loadProfilesFn(configDir));
  }

  const corrupt = entries.filter(e => e.size === 0);
  if (corrupt.length === 0) {
    const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
    return {
      id: 'cache-health', label: 'Attachment cache', ok: true,
      message: `${entries.length} cached file(s), ${formatSize(totalSize)}, none corrupt.`,
      hint: null, fixable: false, corruptEntries: [],
    };
  }

  return {
    id: 'cache-health', label: 'Attachment cache', ok: false,
    message: `${corrupt.length} corrupt (0-byte) cached file(s) found.`,
    hint: 'Run `ticketlens doctor --fix` to remove them.',
    fixable: true, corruptEntries: corrupt,
  };
}
