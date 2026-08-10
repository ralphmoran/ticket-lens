/**
 * CLI authentication token — stored locally, never transmitted except to the
 * TicketLens API. The server stores only the sha256 hash; this file holds the
 * plaintext so the CLI can use it as a Bearer token.
 */

import { readFileSync, writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { readMachineSecret, readOrCreateMachineSecret, signHmac, verifyHmac } from './machine-secret.mjs';

const TOKEN_FILE = 'cli-token.json';
// Distinct from license.mjs's LICENSE_HMAC_SALT so a license.json signature
// can never be replayed as a valid cli-token.json tier signature, or vice versa.
const CLI_TOKEN_HMAC_SALT = 'tl-tok-v1';

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
//
// Signed with a machine-bound HMAC so `tier` can't be hand-edited in the file
// to escalate entitlement. A missing or invalid signature is treated as no
// tier at all (falls back to free) rather than trusted — self-heals on the
// next `tl login`/`tl sync`, both of which re-write and re-sign it.
export function readCliTokenTier(configDir = DEFAULT_CONFIG_DIR) {
  const p = cliTokenPath(configDir);
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    if (typeof data.tier !== 'string' || typeof data.tierSig !== 'string') return null;
    const secret = readMachineSecret(configDir);
    if (!secret) return null;
    return verifyHmac(data.tierSig, { tier: data.tier }, `${CLI_TOKEN_HMAC_SALT}:${secret}`)
      ? data.tier
      : null;
  } catch {
    return null;
  }
}

export function saveCliToken(token, configDir = DEFAULT_CONFIG_DIR, tier = undefined) {
  mkdirSync(configDir, { recursive: true });
  const p = cliTokenPath(configDir);
  let payload = { token };
  if (tier !== undefined) {
    const secret = readOrCreateMachineSecret(configDir);
    const tierSig = signHmac({ tier }, `${CLI_TOKEN_HMAC_SALT}:${secret}`);
    payload = { token, tier, tierSig };
  }
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
