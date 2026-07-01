import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { createStyler } from './ansi.mjs';
import { siteBase } from './api-utils.mjs';

// Mixed into the HMAC key so that knowing the license key alone is not sufficient
// to forge a valid signature — an attacker also needs this constant from the source.
export const LICENSE_HMAC_SALT = 'tl-lic-v1';
export const LICENSE_TIERS = { free: 0, pro: 1, team: 2 };
const LICENSE_FILE = 'license.json';
const LICENSE_SECRET_FILE = 'license-hmac-secret.json';
const REVALIDATION_DAYS = 7;   // attempt background revalidation after this many days
const GRACE_DAYS = 30;          // treat license as invalid if not revalidated within this window
const MS_PER_DAY = 86400000;
const upgradeUrl = () => `${siteBase()}/#pricing`;

const ANSI_RE_LIC = /\x1b\[[0-9;]*m|\x1b\]8;[^\x07]*\x07/g;
const visLen = (s) => s.replace(ANSI_RE_LIC, '').length;
function padInner(str, width) {
  return str + ' '.repeat(Math.max(0, width - visLen(str)));
}

function readHmacSecret(configDir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(configDir, LICENSE_SECRET_FILE), 'utf8'));
    return typeof data.secret === 'string' && data.secret.length === 64 ? data.secret : null;
  } catch {
    return null;
  }
}

function readOrCreateHmacSecret(configDir) {
  const existing = readHmacSecret(configDir);
  if (existing) return existing;
  fs.mkdirSync(configDir, { recursive: true });
  const secret = crypto.randomBytes(32).toString('hex');
  const secretPath = path.join(configDir, LICENSE_SECRET_FILE);
  const tmp = `${secretPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ secret }), { encoding: 'utf8', mode: 0o600 });
  try {
    // Atomic on POSIX — if we lost a concurrent race, the winner's file stays
    fs.renameSync(tmp, secretPath);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* ignore cleanup failure */ }
  }
  // Read back: we may have lost the race; use whatever secret is on disk
  return readHmacSecret(configDir) ?? secret;
}

function verifyLicenseHmac(sig, payload, sigKey) {
  const expected = crypto.createHmac('sha256', sigKey)
    .update(JSON.stringify(payload)).digest('hex');
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export function readLicense(configDir = DEFAULT_CONFIG_DIR) {
  const filePath = path.join(configDir, LICENSE_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const { sig, ...payload } = data;
    // Legacy unsigned files are trusted; will be re-signed on next write
    if (!sig) return payload;

    const machineSecret = readHmacSecret(configDir);
    if (machineSecret) {
      // Machine secret present — only accept signatures made with it
      return verifyLicenseHmac(sig, payload, `${LICENSE_HMAC_SALT}:${machineSecret}`)
        ? payload : null;
    }

    // No secret file yet — fall back to legacy key-based HMAC (backward compat).
    // If valid, immediately re-sign with a machine secret to close the migration window.
    if (!verifyLicenseHmac(sig, payload, `${LICENSE_HMAC_SALT}:${payload.key || ''}`)) return null;
    try { writeLicense(payload, configDir); } catch { /* non-fatal — next call will retry */ }
    return payload;
  } catch {
    return null;
  }
}

export function writeLicense(data, configDir = DEFAULT_CONFIG_DIR) {
  fs.mkdirSync(configDir, { recursive: true });
  const filePath = path.join(configDir, LICENSE_FILE);
  const { sig: _, ...payload } = data; // strip any existing sig before re-signing
  const secret = readOrCreateHmacSecret(configDir);
  const mac = crypto.createHmac('sha256', `${LICENSE_HMAC_SALT}:${secret}`)
    .update(JSON.stringify(payload)).digest('hex');
  fs.writeFileSync(filePath, JSON.stringify({ ...payload, sig: mac }), { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

export function isLicensed(tier, configDir = DEFAULT_CONFIG_DIR) {
  const required = LICENSE_TIERS[tier] ?? 0;
  if (required === 0) return true;
  if (process.env.TICKETLENS_SKIP_LICENSE === 'true') return true;

  const license = readLicense(configDir);
  if (!license) return false;

  // Hard expiry — subscription cancelled, confirmed by server
  if (license.expiresAt && new Date(license.expiresAt) < new Date()) return false;

  // Offline grace period — reject if not revalidated within GRACE_DAYS
  if (license.validatedAt) {
    const daysSince = (Date.now() - new Date(license.validatedAt)) / MS_PER_DAY;
    if (daysSince > GRACE_DAYS) return false;
  }

  const actual = LICENSE_TIERS[license.tier] ?? 0;
  return actual >= required;
}

/**
 * Fire-and-forget background revalidation. Call at CLI startup; never awaited.
 * Silently updates license.json when the validation window has elapsed.
 */
export function revalidateIfStale(opts = {}) {
  const { configDir = DEFAULT_CONFIG_DIR, fetcher = globalThis.fetch } = opts;
  const license = readLicense(configDir);
  if (!license?.key || !license?.validatedAt) return;
  const daysSince = (Date.now() - new Date(license.validatedAt)) / MS_PER_DAY;
  if (daysSince < REVALIDATION_DAYS) return;
  revalidateLicense({ configDir, fetcher }).catch(() => {});
}

/**
 * Styled upsell prompt — written to stderr, never pollutes stdout.
 */
export function showUpgradePrompt(requiredTier, featureFlag, { stream = process.stderr } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const tier = requiredTier.charAt(0).toUpperCase() + requiredTier.slice(1);
  const W = 44; // inner width
  const bc = (t) => s.dim(t);

  const featureLine = padInner(` ${s.yellow('◆')} ${s.bold(featureFlag)} requires ${s.bold(s.cyan(tier))}`, W);
  const url = upgradeUrl();
  const upgradeLine = padInner(`  ${s.dim('Upgrade:')}  ${s.link(url, s.cyan(url))}`, W);
  const activateLine = padInner(`  ${s.dim('Or run:')}   ${s.dim('ticketlens activate <KEY>')}`, W);
  const blank = ' '.repeat(W);

  stream.write('\n');
  stream.write(`  ${bc('┌' + '─'.repeat(W) + '┐')}\n`);
  stream.write(`  ${bc('│')}${featureLine}${bc('│')}\n`);
  stream.write(`  ${bc('│')}${blank}${bc('│')}\n`);
  stream.write(`  ${bc('│')}${upgradeLine}${bc('│')}\n`);
  stream.write(`  ${bc('│')}${activateLine}${bc('│')}\n`);
  stream.write(`  ${bc('└' + '─'.repeat(W) + '┘')}\n`);
  stream.write('\n');
}

const LEMONSQUEEZY_ACTIVATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/activate';
const LEMONSQUEEZY_VALIDATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/validate';

function resolveLicenseUrl(action, fallback) {
  const base = process.env.TICKETLENS_API_URL;
  return base ? `${base.replace(/\/$/, '')}/v1/licenses/${action}` : fallback;
}

function resolveActivateUrl() {
  return resolveLicenseUrl('activate', LEMONSQUEEZY_ACTIVATE_URL);
}

function resolveValidateUrl() {
  return resolveLicenseUrl('validate', LEMONSQUEEZY_VALIDATE_URL);
}

function extractTier(meta) {
  if (!meta) return 'pro';
  const name = (meta.variant_name || meta.product_name || '').toLowerCase();
  if (name.includes('team')) return 'team';
  return 'pro';
}

export async function activateLicense(key, opts = {}) {
  const { configDir = DEFAULT_CONFIG_DIR, fetcher = globalThis.fetch, instanceName } = opts;
  const instance = instanceName || os.hostname();

  try {
    const res = await fetcher(resolveActivateUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ license_key: key, instance_name: instance }),
    });

    const data = await res.json();

    if (!data.activated && !data.valid) {
      return { success: false, error: data.error || data.message || 'Invalid license key.' };
    }

    const meta = data.meta || {};
    const tier = extractTier(meta);

    const license = {
      key: data.license_key?.key || key,
      tier,
      email: meta.customer_email || null,
      provider: 'lemonsqueezy',
      instanceId: data.instance?.id || null,
      validatedAt: new Date().toISOString(),
      ...(meta.ends_at ? { expiresAt: meta.ends_at } : {}),
    };

    writeLicense(license, configDir);
    return { success: true, tier, email: license.email };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function revalidateLicense(opts = {}) {
  const { configDir = DEFAULT_CONFIG_DIR, fetcher = globalThis.fetch, instanceName } = opts;
  const license = readLicense(configDir);
  if (!license) return { success: false, error: 'No license found.' };

  const instance = instanceName || os.hostname();

  try {
    const res = await fetcher(resolveValidateUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ license_key: license.key, instance_name: instance }),
    });

    const data = await res.json();

    if (!data.valid) {
      license.expiresAt = new Date().toISOString();
      writeLicense(license, configDir);
      return { success: false, error: 'License is no longer valid.' };
    }

    license.validatedAt = new Date().toISOString();
    if (data.meta?.ends_at) license.expiresAt = data.meta.ends_at;
    else delete license.expiresAt;
    writeLicense(license, configDir);
    return { success: true, tier: license.tier };
  } catch {
    return { success: true, tier: license.tier, cached: true };
  }
}

export function checkLicense(configDir = DEFAULT_CONFIG_DIR) {
  const license = readLicense(configDir);
  if (!license) return { tier: 'free', active: false };

  const expired = license.expiresAt ? new Date(license.expiresAt) < new Date() : false;

  return {
    tier: license.tier,
    active: !expired,
    expired,
    email: license.email,
    key: license.key,
    validatedAt: license.validatedAt,
  };
}
