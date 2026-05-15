/**
 * Resolves Jira connection config from profiles or env vars.
 * Resolution order: --profile flag → ticket prefix match → default profile → env vars
 */

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

/** Simple Levenshtein distance for "did you mean" suggestions. */
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => i);
  for (let j = 1; j <= n; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i];
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1]);
      prev = tmp;
    }
  }
  return dp[m];
}

function findClosest(input, candidates) {
  if (candidates.length === 0) return null;
  const lower = input.toLowerCase();
  let best = null;
  let bestDist = Infinity;
  for (const c of candidates) {
    const d = levenshtein(lower, c.toLowerCase());
    if (d < bestDist) { bestDist = d; best = c; }
  }
  // Only suggest if reasonably close (within half the input length + 2)
  return bestDist <= Math.floor(input.length / 2) + 2 ? best : null;
}

// Module-level cache keyed by configDir — avoids redundant readFileSync+JSON.parse per run.
// Invalidated automatically by every write function.
const _profilesCache = new Map();
const _credentialsCache = new Map();

export function invalidateProfilesCache(configDir = DEFAULT_CONFIG_DIR) {
  _profilesCache.delete(configDir);
  _credentialsCache.delete(configDir);
}

export function saveDefault(name, configDir = DEFAULT_CONFIG_DIR) {
  const profilesPath = join(configDir, 'profiles.json');
  const config = loadProfiles(configDir) || { profiles: {} };
  config.default = name;
  writeFileSync(profilesPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  chmodSync(profilesPath, 0o600);
  invalidateProfilesCache(configDir);
}

export function saveProfile(name, profileData, credData, configDir = DEFAULT_CONFIG_DIR) {
  mkdirSync(configDir, { recursive: true });
  const profilesPath = join(configDir, 'profiles.json');
  const config = loadProfiles(configDir) || { profiles: {} };
  config.profiles[name] = profileData;
  writeFileSync(profilesPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  chmodSync(profilesPath, 0o600);
  if (credData && Object.keys(credData).length > 0) {
    const credPath = join(configDir, 'credentials.json');
    const creds = loadCredentials(configDir);
    creds[name] = credData;
    writeFileSync(credPath, JSON.stringify(creds, null, 2) + '\n', 'utf8');
    chmodSync(credPath, 0o600);
  }
  invalidateProfilesCache(configDir);
}

export function deleteProfile(name, configDir = DEFAULT_CONFIG_DIR) {
  const profilesPath = join(configDir, 'profiles.json');
  const config = loadProfiles(configDir);
  if (!config?.profiles[name]) return { deleted: false, reason: 'not-found' };

  delete config.profiles[name];
  if (config.default === name) delete config.default;

  writeFileSync(profilesPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
  chmodSync(profilesPath, 0o600);

  // Remove credentials entry
  const credPath = join(configDir, 'credentials.json');
  if (existsSync(credPath)) {
    const creds = loadCredentials(configDir);
    if (creds[name]) {
      delete creds[name];
      writeFileSync(credPath, JSON.stringify(creds, null, 2) + '\n', 'utf8');
      chmodSync(credPath, 0o600);
    }
  }

  invalidateProfilesCache(configDir);
  return { deleted: true };
}

export function loadProfiles(configDir = DEFAULT_CONFIG_DIR) {
  if (_profilesCache.has(configDir)) return _profilesCache.get(configDir);
  const profilesPath = join(configDir, 'profiles.json');
  if (!existsSync(profilesPath)) return null;
  const data = JSON.parse(readFileSync(profilesPath, 'utf8'));
  _profilesCache.set(configDir, data);
  return data;
}

export function loadCredentials(configDir = DEFAULT_CONFIG_DIR) {
  if (_credentialsCache.has(configDir)) return _credentialsCache.get(configDir);
  const credPath = join(configDir, 'credentials.json');
  if (!existsSync(credPath)) {
    _credentialsCache.set(configDir, {});
    return {};
  }
  const data = JSON.parse(readFileSync(credPath, 'utf8'));
  _credentialsCache.set(configDir, data);
  return data;
}

export function expandTilde(p) {
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

export function resolveProfileByPath(cwd, configDir = DEFAULT_CONFIG_DIR) {
  const config = loadProfiles(configDir);
  if (!config) return null;

  let bestMatch = null;
  let bestLen = 0;

  for (const [name, profile] of Object.entries(config.profiles)) {
    if (!profile.projectPaths) continue;
    for (const p of profile.projectPaths) {
      const expanded = expandTilde(p);
      if (cwd.startsWith(expanded) && expanded.length > bestLen) {
        bestMatch = { name, ...profile };
        bestLen = expanded.length;
      }
    }
  }

  return bestMatch;
}

export function resolveProfile(ticketKey, opts = {}) {
  const { profileName, configDir = DEFAULT_CONFIG_DIR, cwd } = opts;
  const config = loadProfiles(configDir);
  if (!config) return null;

  // 1. Explicit --profile flag
  if (profileName && config.profiles[profileName]) {
    return { name: profileName, ...config.profiles[profileName] };
  }

  // 1b. Profile name given but not found — suggest closest match
  if (profileName) {
    const available = Object.keys(config.profiles);
    const suggestion = findClosest(profileName, available);
    if (opts.onProfileNotFound) {
      opts.onProfileNotFound({ profileName, suggestion, available });
    }
    return null;
  }

  // 2. Match ticket prefix (skip if no ticket key)
  if (ticketKey) {
    const prefix = ticketKey.split('-')[0];
    const matches = [];
    for (const [name, profile] of Object.entries(config.profiles)) {
      if (profile.ticketPrefixes?.includes(prefix)) {
        matches.push({ name, ...profile });
      }
    }
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      const warning = `Warning: Prefix "${prefix}" matches multiple profiles: ${matches.map(m => m.name).join(', ')}. Using ${matches[0].name}. Use --profile=NAME to override.`;
      if (opts.onWarning) opts.onWarning(warning);
      return matches[0];
    }
  }

  // 3. Project path match
  if (cwd) {
    const pathMatch = resolveProfileByPath(cwd, configDir);
    if (pathMatch) return pathMatch;
  }

  // 4. Default profile
  if (config.default && config.profiles[config.default]) {
    return { name: config.default, ...config.profiles[config.default] };
  }

  return null;
}

export function resolveConnection(ticketKey, opts = {}) {
  const { env = process.env, configDir = DEFAULT_CONFIG_DIR, profileName, onWarning, onProfileNotFound, cwd } = opts;

  const profile = resolveProfile(ticketKey, { profileName, configDir, onWarning, onProfileNotFound, cwd });

  if (profile) {
    const creds = loadCredentials(configDir);
    const profileCreds = creds[profile.name] || {};
    return {
      baseUrl: profile.baseUrl,
      auth: profile.auth || null,
      email: profile.email || null,
      apiToken: profileCreds.apiToken || null,
      pat: profileCreds.pat || null,
      triageStatuses: profile.triageStatuses || null,
      ticketPrefixes: profile.ticketPrefixes || null,
      source: 'profile',
      profileName: profile.name,
    };
  }

  // Explicit --profile was given but not found — don't fall back to env vars
  if (profileName) {
    return { baseUrl: null, source: 'profile-not-found', profileName };
  }

  // Fall back to env vars
  return {
    baseUrl: env.JIRA_BASE_URL || null,
    auth: null,
    email: env.JIRA_EMAIL || null,
    apiToken: env.JIRA_API_TOKEN || null,
    pat: env.JIRA_PAT || null,
    source: 'env',
  };
}
