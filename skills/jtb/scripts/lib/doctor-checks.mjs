/**
 * Pure diagnostic check functions for `ticketlens doctor`. Each function
 * takes DI'd dependencies (matching the xFn = defaultX pattern used
 * throughout this codebase) and returns a normalized result:
 *   { id, label, ok, message, hint, fixable }
 * No stdout/stdin, no arg parsing — independently unit-testable in
 * isolation from CLI/MCP concerns.
 */

import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { resolveProfile, loadCredentials } from './profile-resolver.mjs';

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
