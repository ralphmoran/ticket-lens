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

const GUMROAD_VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';

function extractTier(variants) {
  if (!variants) return 'pro';
  const lower = variants.toLowerCase();
  if (lower.includes('team')) return 'team';
  if (lower.includes('pro')) return 'pro';
  return 'pro';
}

export async function activateLicense(key, opts = {}) {
  const { configDir = DEFAULT_CONFIG_DIR, fetcher = globalThis.fetch, productId = 'ticketlens' } = opts;

  try {
    const res = await fetcher(GUMROAD_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `product_id=${encodeURIComponent(productId)}&license_key=${encodeURIComponent(key)}`,
    });

    const data = await res.json();

    if (!data.success) {
      return { success: false, error: data.message || 'Invalid license key.' };
    }

    const purchase = data.purchase;
    const tier = extractTier(purchase.variants);
    const isSubscriptionEnded = !!purchase.subscription_ended_at;

    const license = {
      key: purchase.license_key,
      tier,
      email: purchase.email,
      provider: 'gumroad',
      validatedAt: new Date().toISOString(),
      ...(isSubscriptionEnded ? { expiresAt: purchase.subscription_ended_at } : {}),
    };

    writeLicense(license, configDir);
    return { success: true, tier, email: purchase.email };
  } catch (err) {
    return { success: false, error: err.message };
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
