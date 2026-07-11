/**
 * Detects whether the CLI has been configured yet, from disk — no network, never throws.
 * "fresh" and "pending" are computed on every call rather than stored, so deleting
 * ~/.ticketlens naturally re-triggers onboarding with no stale flag to reset.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { loadProfiles, loadCredentials } from './profile-resolver.mjs';
import { readCliToken } from './cli-auth.mjs';

export function detectSetupState({ configDir = DEFAULT_CONFIG_DIR } = {}) {
  const loggedIn = readCliToken(configDir) !== null;

  // loadProfiles() collapses "file missing" and "file unparseable" to the same
  // null return — disambiguate here so a corrupt file surfaces as corrupt: true
  // instead of silently masquerading as a brand-new install.
  const profilesPath = join(configDir, 'profiles.json');
  const profilesFileExists = existsSync(profilesPath);
  const config = loadProfiles(configDir);
  const corrupt = profilesFileExists && config === null;

  const profileNames = config ? Object.keys(config.profiles || {}) : [];
  if (profileNames.length === 0) {
    return { status: 'fresh', profileCount: 0, missingCredentials: [], hasDefault: false, loggedIn, corrupt };
  }

  const creds = loadCredentials(configDir);
  const missingCredentials = profileNames.filter(name => !creds[name]);
  const hasDefault = profileNames.length === 1 || Boolean(config.default && config.profiles[config.default]);
  const status = missingCredentials.length > 0 || !hasDefault ? 'pending' : 'ready';

  return { status, profileCount: profileNames.length, missingCredentials, hasDefault, loggedIn, corrupt };
}
