import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const LICENSE_TIERS = { free: 0, pro: 1, team: 2 };

const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.ticketlens');
const LICENSE_FILE = 'license.json';

export function readLicense(configDir = DEFAULT_CONFIG_DIR) {
  const filePath = path.join(configDir, LICENSE_FILE);
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeLicense(data, configDir = DEFAULT_CONFIG_DIR) {
  fs.mkdirSync(configDir, { recursive: true });
  const filePath = path.join(configDir, LICENSE_FILE);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export function isLicensed(tier, configDir = DEFAULT_CONFIG_DIR) {
  const required = LICENSE_TIERS[tier] ?? 0;
  if (required === 0) return true;

  const license = readLicense(configDir);
  if (!license) return false;

  if (license.expiresAt && new Date(license.expiresAt) < new Date()) return false;

  const actual = LICENSE_TIERS[license.tier] ?? 0;
  return actual >= required;
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
