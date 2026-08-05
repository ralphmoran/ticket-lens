import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkProfileConfig, checkLicenseFreshness, checkConnectivity } from '../lib/doctor-checks.mjs';

let configDir;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'tl-doctor-checks-'));
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

function writeProfiles(dir, contents) {
  writeFileSync(join(dir, 'profiles.json'), JSON.stringify(contents), 'utf8');
}

function writeCredentials(dir, contents) {
  writeFileSync(join(dir, 'credentials.json'), JSON.stringify(contents), 'utf8');
}

describe('checkProfileConfig', () => {
  it('fails with "No profile configured" when profiles.json does not exist', () => {
    const result = checkProfileConfig({ configDir });
    assert.equal(result.id, 'profile-config');
    assert.equal(result.ok, false);
    assert.match(result.message, /No profile configured/);
    assert.equal(result.fixable, false);
  });

  it('fails when --profile=NAME does not match any configured profile', () => {
    writeProfiles(configDir, { profiles: { acme: { baseUrl: 'https://acme.atlassian.net' } } });
    const result = checkProfileConfig({ configDir, profileName: 'nope' });
    assert.equal(result.ok, false);
    assert.match(result.message, /"nope" not found/);
  });

  it('fails when the resolved profile has no baseUrl', () => {
    writeProfiles(configDir, { default: 'acme', profiles: { acme: {} } });
    writeCredentials(configDir, { acme: { apiToken: 'tok' } });
    const result = checkProfileConfig({ configDir });
    assert.equal(result.ok, false);
    assert.match(result.message, /no baseUrl/);
  });

  it('fails when the resolved profile has no stored credentials', () => {
    writeProfiles(configDir, { default: 'acme', profiles: { acme: { baseUrl: 'https://acme.atlassian.net' } } });
    const result = checkProfileConfig({ configDir });
    assert.equal(result.ok, false);
    assert.match(result.message, /no credentials/);
  });

  it('passes when the profile resolves with a baseUrl and an apiToken', () => {
    writeProfiles(configDir, { default: 'acme', profiles: { acme: { baseUrl: 'https://acme.atlassian.net' } } });
    writeCredentials(configDir, { acme: { apiToken: 'tok' } });
    const result = checkProfileConfig({ configDir });
    assert.equal(result.ok, true);
    assert.match(result.message, /"acme"/);
  });

  it('passes when the profile resolves with a baseUrl and a pat instead of an apiToken', () => {
    writeProfiles(configDir, { default: 'forge', profiles: { forge: { baseUrl: 'https://jira.forge.com', auth: 'server' } } });
    writeCredentials(configDir, { forge: { pat: 'pat-value' } });
    const result = checkProfileConfig({ configDir });
    assert.equal(result.ok, true);
  });

  it('resolves the explicitly-named profile over the configured default', () => {
    writeProfiles(configDir, {
      default: 'acme',
      profiles: {
        acme: { baseUrl: 'https://acme.atlassian.net' },
        globex: { baseUrl: 'https://globex.atlassian.net' },
      },
    });
    writeCredentials(configDir, { acme: { apiToken: 'a' }, globex: { apiToken: 'g' } });
    const result = checkProfileConfig({ configDir, profileName: 'globex' });
    assert.equal(result.ok, true);
    assert.match(result.message, /"globex"/);
  });
});

describe('checkLicenseFreshness', () => {
  it('passes with "Free tier" when no license key exists', () => {
    const checkLicenseFn = () => ({ tier: 'free', active: false });
    const result = checkLicenseFreshness({ checkLicenseFn });
    assert.equal(result.id, 'license-freshness');
    assert.equal(result.ok, true);
    assert.match(result.message, /Free tier/);
    assert.equal(result.fixable, false);
  });

  it('fails and is fixable when the license is hard-expired', () => {
    const checkLicenseFn = () => ({ tier: 'pro', expired: true, key: 'TL-1', validatedAt: new Date().toISOString() });
    const result = checkLicenseFreshness({ checkLicenseFn });
    assert.equal(result.ok, false);
    assert.equal(result.fixable, true);
    assert.match(result.message, /expired/);
  });

  it('fails and is fixable when validatedAt is older than GRACE_DAYS', () => {
    const staleDate = new Date(Date.now() - 31 * 86400000).toISOString();
    const checkLicenseFn = () => ({ tier: 'pro', expired: false, key: 'TL-1', validatedAt: staleDate });
    const result = checkLicenseFreshness({ checkLicenseFn });
    assert.equal(result.ok, false);
    assert.equal(result.fixable, true);
    assert.match(result.message, /30 days/);
  });

  it('passes when validatedAt is within GRACE_DAYS', () => {
    const freshDate = new Date(Date.now() - 2 * 86400000).toISOString();
    const checkLicenseFn = () => ({ tier: 'pro', expired: false, key: 'TL-1', validatedAt: freshDate });
    const result = checkLicenseFreshness({ checkLicenseFn });
    assert.equal(result.ok, true);
    assert.match(result.message, /pro/);
  });
});

describe('checkConnectivity', () => {
  it('passes with "nothing to test" when no profiles are configured (full sweep)', async () => {
    const testConnectionsFn = async () => ({ results: [], failedCount: 0 });
    const result = await checkConnectivity({ configDir, testConnectionsFn });
    assert.equal(result.id, 'connectivity');
    assert.equal(result.ok, true);
    assert.match(result.message, /nothing to test/i);
  });

  it('passes when every profile in the full sweep connects', async () => {
    const testConnectionsFn = async () => ({
      results: [{ name: 'acme', ok: true }, { name: 'globex', ok: true }],
      failedCount: 0,
    });
    const result = await checkConnectivity({ configDir, testConnectionsFn });
    assert.equal(result.ok, true);
    assert.match(result.message, /2 profile/);
  });

  it('fails when at least one profile in the full sweep fails to connect', async () => {
    const testConnectionsFn = async () => ({
      results: [{ name: 'acme', ok: false, error: 'Authentication failed for acme' }, { name: 'globex', ok: true }],
      failedCount: 1,
    });
    const result = await checkConnectivity({ configDir, testConnectionsFn });
    assert.equal(result.ok, false);
    assert.match(result.message, /1\/2/);
    assert.match(result.hint, /Authentication failed for acme/);
  });

  it('--profile= fast path fails with "not found" for an unknown profile, without calling testConnections', async () => {
    let sweepCalled = false;
    const testConnectionsFn = async () => { sweepCalled = true; return { results: [], failedCount: 0 }; };
    const result = await checkConnectivity({ configDir, profileName: 'nope', testConnectionsFn });
    assert.equal(result.ok, false);
    assert.match(result.message, /"nope" not found/);
    assert.equal(sweepCalled, false);
  });

  it('--profile= fast path connects directly via resolveAdapter, bypassing the all-profiles sweep', async () => {
    writeProfiles(configDir, { profiles: { acme: { baseUrl: 'https://acme.atlassian.net' } } });
    writeCredentials(configDir, { acme: { apiToken: 'tok' } });
    let sweepCalled = false;
    const testConnectionsFn = async () => { sweepCalled = true; return { results: [], failedCount: 0 }; };
    const resolveAdapterFn = () => ({ fetchCurrentUser: async () => ({ displayName: 'Dev' }) });
    const result = await checkConnectivity({ configDir, profileName: 'acme', testConnectionsFn, resolveAdapterFn });
    assert.equal(result.ok, true);
    assert.match(result.message, /"acme"/);
    assert.equal(sweepCalled, false);
  });

  it('--profile= fast path classifies a thrown fetchCurrentUser error via classifyError', async () => {
    writeProfiles(configDir, { profiles: { acme: { baseUrl: 'https://acme.atlassian.net' } } });
    writeCredentials(configDir, { acme: { apiToken: 'bad' } });
    const resolveAdapterFn = () => ({ fetchCurrentUser: async () => { const e = new Error('unauthorized'); e.status = 401; throw e; } });
    const result = await checkConnectivity({ configDir, profileName: 'acme', resolveAdapterFn });
    assert.equal(result.ok, false);
    assert.match(result.message, /Authentication failed/);
  });
});
