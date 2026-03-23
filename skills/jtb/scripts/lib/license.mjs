import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { createStyler } from './ansi.mjs';

export const LICENSE_TIERS = { free: 0, pro: 1, team: 2 };
const LICENSE_FILE = 'license.json';
const REVALIDATION_DAYS = 7;   // attempt background revalidation after this many days
const GRACE_DAYS = 30;          // treat license as invalid if not revalidated within this window
const UPGRADE_URL = 'https://ticketlens.dev/pricing';

const ANSI_RE_LIC = /\x1b\[[0-9;]*m|\x1b\]8;[^\x07]*\x07/g;
const visLen = (s) => s.replace(ANSI_RE_LIC, '').length;
function padInner(str, width) {
  return str + ' '.repeat(Math.max(0, width - visLen(str)));
}

export function readLicense(configDir = DEFAULT_CONFIG_DIR) {
  const filePath = path.join(configDir, LICENSE_FILE);
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const { sig, ...payload } = data;
    // Legacy unsigned files are trusted; will be re-signed on next write
    if (!sig) return payload;
    const expected = crypto.createHmac('sha256', payload.key || '')
      .update(JSON.stringify(payload)).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? payload : null;
  } catch {
    return null;
  }
}

export function writeLicense(data, configDir = DEFAULT_CONFIG_DIR) {
  fs.mkdirSync(configDir, { recursive: true });
  const filePath = path.join(configDir, LICENSE_FILE);
  const { sig: _, ...payload } = data; // strip any existing sig before re-signing
  const mac = crypto.createHmac('sha256', payload.key || '')
    .update(JSON.stringify(payload)).digest('hex');
  fs.writeFileSync(filePath, JSON.stringify({ ...payload, sig: mac }), 'utf8');
  fs.chmodSync(filePath, 0o600);
}

export function isLicensed(tier, configDir = DEFAULT_CONFIG_DIR) {
  const required = LICENSE_TIERS[tier] ?? 0;
  if (required === 0) return true;

  const license = readLicense(configDir);
  if (!license) return false;

  // Hard expiry — subscription cancelled, confirmed by server
  if (license.expiresAt && new Date(license.expiresAt) < new Date()) return false;

  // Offline grace period — reject if not revalidated within GRACE_DAYS
  if (license.validatedAt) {
    const daysSince = (Date.now() - new Date(license.validatedAt)) / 86400000;
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
  const daysSince = (Date.now() - new Date(license.validatedAt)) / 86400000;
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
  const upgradeLine = padInner(`  ${s.dim('Upgrade:')}  ${s.link(UPGRADE_URL, s.cyan(UPGRADE_URL))}`, W);
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
    const res = await fetcher(LEMONSQUEEZY_ACTIVATE_URL, {
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
    const res = await fetcher(LEMONSQUEEZY_VALIDATE_URL, {
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
