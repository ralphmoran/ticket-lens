/**
 * CLI authentication token — stored locally, never transmitted except to the
 * TicketLens API. The server stores only the sha256 hash; this file holds the
 * plaintext so the CLI can use it as a Bearer token.
 */

import { readFileSync, writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

const TOKEN_FILE = 'cli-token.json';

export function cliTokenPath(configDir = DEFAULT_CONFIG_DIR) {
  return join(configDir, TOKEN_FILE);
}

export function readCliToken(configDir = DEFAULT_CONFIG_DIR) {
  const p = cliTokenPath(configDir);
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return typeof data.token === 'string' ? data.token : null;
  } catch {
    return null;
  }
}

// Server-asserted tier (personal or team-seat) synced alongside the token on
// every login/sync — separate from the signed, offline license.json file.
// Lets team-invited members get Pro-equivalent CLI access without a personal
// TL- key, mirroring what the manager already pays for.
export function readCliTokenTier(configDir = DEFAULT_CONFIG_DIR) {
  const p = cliTokenPath(configDir);
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    return typeof data.tier === 'string' ? data.tier : null;
  } catch {
    return null;
  }
}

export function saveCliToken(token, configDir = DEFAULT_CONFIG_DIR, tier = undefined) {
  mkdirSync(configDir, { recursive: true });
  const p = cliTokenPath(configDir);
  const payload = tier === undefined ? { token } : { token, tier };
  writeFileSync(p, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  chmodSync(p, 0o600);
}

// Updates just the cached tier without touching the token — used by `tl sync`
// to keep entitlement fresh between logins.
export function saveCliTokenTier(tier, configDir = DEFAULT_CONFIG_DIR) {
  const token = readCliToken(configDir);
  if (!token) return;
  saveCliToken(token, configDir, tier);
}

export function deleteCliToken(configDir = DEFAULT_CONFIG_DIR) {
  const p = cliTokenPath(configDir);
  if (existsSync(p)) {
    writeFileSync(p, JSON.stringify({}, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    chmodSync(p, 0o600);
  }
}
