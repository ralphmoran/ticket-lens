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
export const CLI_TOKEN_HMAC_SALT = 'tl-tok-v1';
// Shorter than license.mjs's 30-day GRACE_DAYS — a team seat being removed is a
// security action by the manager, not a billing lapse, so the offline window a
// revoked member's stale local access can survive on should be tighter.
const TEAM_TIER_GRACE_DAYS = 7;
const MS_PER_DAY = 86400000;

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
// Signed with a machine-bound HMAC so `tier`/`syncedAt`/`freshMark` can't be
// hand-edited in the file to escalate or extend entitlement. A missing or
// invalid signature is treated as no tier at all (falls back to free) rather
// than trusted — self-heals on the next `tl login`/`tl sync`, both of which
// re-write and re-sign it. A file with no `syncedAt` (written before this
// grace-period check existed) is rejected outright for the same reason,
// rather than treated as permanently fresh.
//
// TEAM_TIER_GRACE_DAYS bounds how long a synced team-seat tier stays valid without
// a fresh login/sync — mirrors license.mjs's offline GRACE_DAYS so a team member
// removed server-side can't keep local access indefinitely just by never syncing.
//
// `freshMark` is a monotonic high-water mark of the latest wall-clock time this
// file has ever been read at without a detected rollback. It is ratcheted forward
// (never backward) on every honest read and is rejected if the clock now reads
// earlier than it — closing the realistic attack of rolling the OS clock back
// once, after a team seat is revoked, to keep `syncedAt` looking fresh forever.
// It does NOT close every variant: an attacker who fakes the clock from the very
// first read after a real sync, before any honest freshMark is ever recorded past
// that point, is not caught — that is an inherent limit of any offline,
// network-free grace period (the same residual gap license.json's GRACE_DAYS has
// always had), not something this mechanism claims to solve.
export function readCliTokenTier(configDir = DEFAULT_CONFIG_DIR) {
  const p = cliTokenPath(configDir);
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, 'utf8'));
    if (
      typeof data.tier !== 'string' ||
      typeof data.tierSig !== 'string' ||
      typeof data.syncedAt !== 'string' ||
      typeof data.freshMark !== 'string'
    ) {
      return null;
    }
    const secret = readMachineSecret(configDir);
    if (!secret) return null;
    const signed = { tier: data.tier, syncedAt: data.syncedAt, freshMark: data.freshMark };
    if (!verifyHmac(data.tierSig, signed, `${CLI_TOKEN_HMAC_SALT}:${secret}`)) return null;

    // An unparseable syncedAt gives NaN — rejected on its own line rather than
    // leaning on NaN quietly failing the grace-period comparison below.
    const syncedAtMs = new Date(data.syncedAt).getTime();
    if (Number.isNaN(syncedAtMs)) return null;

    const daysSinceSync = (Date.now() - syncedAtMs) / MS_PER_DAY;
    if (daysSinceSync > TEAM_TIER_GRACE_DAYS) return null;

    const freshMarkMs = new Date(data.freshMark).getTime();
    if (Number.isNaN(freshMarkMs)) return null;

    const nowMs = Date.now();
    if (nowMs < freshMarkMs) return null;

    if (nowMs > freshMarkMs) {
      // Best-effort ratchet — wrapped so a disk-write failure (full disk,
      // permissions changed mid-session) can't turn an otherwise-valid read
      // into a null; the mark simply stays where it was for next time.
      try {
        writeFreshMark(p, data, secret, nowMs);
      } catch {
        // ignore — ratcheting forward is an optimization, not a correctness requirement
      }
    }

    return data.tier;
  } catch {
    return null;
  }
}

function writeFreshMark(p, data, secret, nowMs) {
  const freshMark = new Date(nowMs).toISOString();
  const signed = { tier: data.tier, syncedAt: data.syncedAt, freshMark };
  const tierSig = signHmac(signed, `${CLI_TOKEN_HMAC_SALT}:${secret}`);
  const payload = { token: data.token, ...signed, tierSig };
  writeFileSync(p, JSON.stringify(payload, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  chmodSync(p, 0o600);
}

export function saveCliToken(token, configDir = DEFAULT_CONFIG_DIR, tier = undefined) {
  mkdirSync(configDir, { recursive: true });
  const p = cliTokenPath(configDir);
  let payload = { token };
  if (tier !== undefined) {
    const secret = readOrCreateMachineSecret(configDir);
    const syncedAt = new Date().toISOString();
    // A real login/sync is itself a trusted checkpoint (it round-tripped to the
    // server), so freshMark resets to "now" here rather than only ratcheting —
    // unlike a local read, this is not attacker-reachable without valid credentials.
    const freshMark = syncedAt;
    const tierSig = signHmac({ tier, syncedAt, freshMark }, `${CLI_TOKEN_HMAC_SALT}:${secret}`);
    payload = { token, tier, syncedAt, freshMark, tierSig };
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
