/**
 * Resolves Jira connection config from profiles or env vars.
 * Resolution order: --profile flag → ticket prefix match → default profile → env vars
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_CONFIG_DIR = join(homedir(), '.ticketlens');

export function loadProfiles(configDir = DEFAULT_CONFIG_DIR) {
  const profilesPath = join(configDir, 'profiles.json');
  if (!existsSync(profilesPath)) return null;
  return JSON.parse(readFileSync(profilesPath, 'utf8'));
}

export function loadCredentials(configDir = DEFAULT_CONFIG_DIR) {
  const credPath = join(configDir, 'credentials.json');
  if (!existsSync(credPath)) return {};
  return JSON.parse(readFileSync(credPath, 'utf8'));
}

export function resolveProfile(ticketKey, opts = {}) {
  const { profileName, configDir = DEFAULT_CONFIG_DIR } = opts;
  const config = loadProfiles(configDir);
  if (!config) return null;

  // 1. Explicit --profile flag
  if (profileName && config.profiles[profileName]) {
    return { name: profileName, ...config.profiles[profileName] };
  }

  // 2. Match ticket prefix
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

  // 3. Default profile
  if (config.default && config.profiles[config.default]) {
    return { name: config.default, ...config.profiles[config.default] };
  }

  return null;
}

export function resolveConnection(ticketKey, opts = {}) {
  const { env = process.env, configDir = DEFAULT_CONFIG_DIR, profileName, onWarning } = opts;

  const profile = resolveProfile(ticketKey, { profileName, configDir, onWarning });

  if (profile) {
    const creds = loadCredentials(configDir);
    const profileCreds = creds[profile.name] || {};
    return {
      baseUrl: profile.baseUrl,
      email: profile.email || null,
      apiToken: profileCreds.apiToken || null,
      pat: profileCreds.pat || null,
      source: 'profile',
      profileName: profile.name,
    };
  }

  // 4. Fall back to env vars
  return {
    baseUrl: env.JIRA_BASE_URL || null,
    email: env.JIRA_EMAIL || null,
    apiToken: env.JIRA_API_TOKEN || null,
    pat: env.JIRA_PAT || null,
    source: 'env',
  };
}
