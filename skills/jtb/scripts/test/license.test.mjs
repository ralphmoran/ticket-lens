import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readLicense, writeLicense, isLicensed, activateLicense, revalidateLicense, checkLicense, LICENSE_TIERS } from '../lib/license.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-license-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const validLicense = {
  key: 'AAAA-BBBB-CCCC-DDDD',
  tier: 'pro',
  email: 'dev@example.com',
  validatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
  provider: 'lemonsqueezy',
};

describe('readLicense', () => {
  it('returns null when license.json does not exist', () => {
    const result = readLicense(tmpDir);
    assert.equal(result, null);
  });

  it('reads a valid license file', () => {
    fs.writeFileSync(path.join(tmpDir, 'license.json'), JSON.stringify(validLicense));
    const result = readLicense(tmpDir);
    assert.equal(result.key, 'AAAA-BBBB-CCCC-DDDD');
    assert.equal(result.tier, 'pro');
    assert.equal(result.email, 'dev@example.com');
  });

  it('returns null for corrupted JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'license.json'), '{broken');
    const result = readLicense(tmpDir);
    assert.equal(result, null);
  });
});

describe('writeLicense', () => {
  it('writes license data to license.json', () => {
    writeLicense(validLicense, tmpDir);
    const raw = fs.readFileSync(path.join(tmpDir, 'license.json'), 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.key, validLicense.key);
    assert.equal(parsed.tier, validLicense.tier);
  });

  it('creates config directory if it does not exist', () => {
    const nested = path.join(tmpDir, 'subdir');
    writeLicense(validLicense, nested);
    const raw = fs.readFileSync(path.join(nested, 'license.json'), 'utf8');
    assert.ok(raw.includes(validLicense.key));
  });

  it('overwrites existing license file', () => {
    writeLicense(validLicense, tmpDir);
    const updated = { ...validLicense, tier: 'team' };
    writeLicense(updated, tmpDir);
    const result = readLicense(tmpDir);
    assert.equal(result.tier, 'team');
  });
});

describe('isLicensed', () => {
  it('returns true for free tier without any license', () => {
    assert.equal(isLicensed('free', tmpDir), true);
  });

  it('returns false for pro tier without a license', () => {
    assert.equal(isLicensed('pro', tmpDir), false);
  });

  it('returns true for pro tier with valid pro license', () => {
    writeLicense(validLicense, tmpDir);
    assert.equal(isLicensed('pro', tmpDir), true);
  });

  it('returns true for pro tier with team license (higher tier)', () => {
    writeLicense({ ...validLicense, tier: 'team' }, tmpDir);
    assert.equal(isLicensed('pro', tmpDir), true);
  });

  it('returns false for team tier with pro license (lower tier)', () => {
    writeLicense(validLicense, tmpDir);
    assert.equal(isLicensed('team', tmpDir), false);
  });

  it('returns false when license is expired', () => {
    const expired = { ...validLicense, expiresAt: new Date(Date.now() - 86400000).toISOString() };
    writeLicense(expired, tmpDir);
    assert.equal(isLicensed('pro', tmpDir), false);
  });

  it('returns true when expiresAt is missing (lifetime license)', () => {
    const lifetime = { ...validLicense };
    delete lifetime.expiresAt;
    writeLicense(lifetime, tmpDir);
    assert.equal(isLicensed('pro', tmpDir), true);
  });
});

describe('LICENSE_TIERS', () => {
  it('defines tier hierarchy: free < pro < team', () => {
    assert.ok(LICENSE_TIERS.free < LICENSE_TIERS.pro);
    assert.ok(LICENSE_TIERS.pro < LICENSE_TIERS.team);
  });
});

describe('activateLicense', () => {
  function mockFetcher(response) {
    return async () => ({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body,
    });
  }

  it('stores license on successful LemonSqueezy activation', async () => {
    const fetcher = mockFetcher({
      ok: true,
      body: {
        activated: true,
        valid: true,
        license_key: { key: 'AAAA-BBBB-CCCC-DDDD' },
        instance: { id: 'inst-123' },
        meta: {
          variant_name: 'Pro',
          customer_email: 'dev@example.com',
          ends_at: null,
        },
      },
    });
    const result = await activateLicense('AAAA-BBBB-CCCC-DDDD', { configDir: tmpDir, fetcher, instanceName: 'test-host' });
    assert.equal(result.success, true);
    assert.equal(result.tier, 'pro');
    const stored = readLicense(tmpDir);
    assert.equal(stored.key, 'AAAA-BBBB-CCCC-DDDD');
    assert.equal(stored.tier, 'pro');
    assert.equal(stored.provider, 'lemonsqueezy');
    assert.equal(stored.instanceId, 'inst-123');
  });

  it('returns error for invalid license key', async () => {
    const fetcher = mockFetcher({
      ok: true,
      body: { activated: false, valid: false, error: 'That license does not exist.' },
    });
    const result = await activateLicense('INVALID-KEY', { configDir: tmpDir, fetcher, instanceName: 'test-host' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('does not exist'));
    assert.equal(readLicense(tmpDir), null);
  });

  it('returns error on network failure', async () => {
    const fetcher = async () => { throw new Error('Network timeout'); };
    const result = await activateLicense('AAAA-BBBB-CCCC-DDDD', { configDir: tmpDir, fetcher, instanceName: 'test-host' });
    assert.equal(result.success, false);
    assert.ok(result.error.includes('Network timeout'));
  });

  it('extracts team tier from variant_name', async () => {
    const fetcher = mockFetcher({
      ok: true,
      body: {
        activated: true,
        valid: true,
        license_key: { key: 'TEAM-KEY-1234' },
        instance: { id: 'inst-456' },
        meta: {
          variant_name: 'Team',
          customer_email: 'lead@company.com',
          ends_at: null,
        },
      },
    });
    const result = await activateLicense('TEAM-KEY-1234', { configDir: tmpDir, fetcher, instanceName: 'test-host' });
    assert.equal(result.tier, 'team');
  });

  it('defaults to pro tier when variant_name is empty', async () => {
    const fetcher = mockFetcher({
      ok: true,
      body: {
        activated: true,
        valid: true,
        license_key: { key: 'SOME-KEY' },
        instance: { id: 'inst-789' },
        meta: {
          variant_name: '',
          customer_email: 'dev@example.com',
          ends_at: null,
        },
      },
    });
    const result = await activateLicense('SOME-KEY', { configDir: tmpDir, fetcher, instanceName: 'test-host' });
    assert.equal(result.tier, 'pro');
  });

  it('stores expiresAt when subscription has end date', async () => {
    const endsAt = '2027-03-12T00:00:00Z';
    const fetcher = mockFetcher({
      ok: true,
      body: {
        activated: true,
        valid: true,
        license_key: { key: 'EXP-KEY' },
        instance: { id: 'inst-exp' },
        meta: { variant_name: 'Pro', customer_email: 'dev@example.com', ends_at: endsAt },
      },
    });
    const result = await activateLicense('EXP-KEY', { configDir: tmpDir, fetcher, instanceName: 'test-host' });
    assert.equal(result.success, true);
    const stored = readLicense(tmpDir);
    assert.equal(stored.expiresAt, endsAt);
  });
});

describe('revalidateLicense', () => {
  function mockFetcher(response) {
    return async () => ({
      ok: true,
      json: async () => response,
    });
  }

  it('updates validatedAt on successful revalidation', async () => {
    writeLicense({ ...validLicense, validatedAt: '2026-01-01T00:00:00Z' }, tmpDir);
    const fetcher = mockFetcher({ valid: true, meta: {} });
    const result = await revalidateLicense({ configDir: tmpDir, fetcher, instanceName: 'test-host' });
    assert.equal(result.success, true);
    const stored = readLicense(tmpDir);
    assert.notEqual(stored.validatedAt, '2026-01-01T00:00:00Z');
  });

  it('marks license expired when API says invalid', async () => {
    writeLicense(validLicense, tmpDir);
    const fetcher = mockFetcher({ valid: false });
    const result = await revalidateLicense({ configDir: tmpDir, fetcher, instanceName: 'test-host' });
    assert.equal(result.success, false);
    const stored = readLicense(tmpDir);
    assert.ok(stored.expiresAt);
  });

  it('returns cached success on network failure', async () => {
    writeLicense(validLicense, tmpDir);
    const fetcher = async () => { throw new Error('offline'); };
    const result = await revalidateLicense({ configDir: tmpDir, fetcher, instanceName: 'test-host' });
    assert.equal(result.success, true);
    assert.equal(result.cached, true);
  });

  it('returns error when no license exists', async () => {
    const fetcher = mockFetcher({ valid: true });
    const result = await revalidateLicense({ configDir: tmpDir, fetcher, instanceName: 'test-host' });
    assert.equal(result.success, false);
  });
});

describe('checkLicense', () => {
  it('returns free status when no license exists', () => {
    const status = checkLicense(tmpDir);
    assert.equal(status.tier, 'free');
    assert.equal(status.active, false);
  });

  it('returns active status for valid license', () => {
    writeLicense(validLicense, tmpDir);
    const status = checkLicense(tmpDir);
    assert.equal(status.tier, 'pro');
    assert.equal(status.active, true);
    assert.equal(status.email, 'dev@example.com');
  });

  it('returns expired status for expired license', () => {
    const expired = { ...validLicense, expiresAt: new Date(Date.now() - 86400000).toISOString() };
    writeLicense(expired, tmpDir);
    const status = checkLicense(tmpDir);
    assert.equal(status.tier, 'pro');
    assert.equal(status.active, false);
    assert.equal(status.expired, true);
  });
});
