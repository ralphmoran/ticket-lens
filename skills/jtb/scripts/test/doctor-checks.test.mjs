import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkProfileConfig, checkLicenseFreshness, checkConnectivity, checkCacheHealth, checkRecallQueue, checkMcpRegistration, checkMcpHandshake } from '../lib/doctor-checks.mjs';

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

  it('includes each failed profile\'s classified hint (next step), not just its error, in the full-sweep summary', async () => {
    const testConnectionsFn = async () => ({
      results: [
        { name: 'acme', ok: false, error: 'DNS lookup failed for acme.atlassian.net', hint: 'Check your internet connection.' },
        { name: 'globex', ok: true },
      ],
      failedCount: 1,
    });
    const result = await checkConnectivity({ configDir, testConnectionsFn });
    assert.equal(result.ok, false);
    assert.match(result.hint, /DNS lookup failed for acme\.atlassian\.net/);
    assert.match(result.hint, /Check your internet connection\./);
  });

  it('puts each profile on its own line in the full-sweep summary — not crammed onto one semicolon-joined line', async () => {
    const testConnectionsFn = async () => ({
      results: [
        { name: 'corenexus', ok: true },
        { name: 'advent', ok: false, error: 'Connection timed out', hint: 'Check your VPN.' },
        { name: "Team Manager's Team", ok: false, error: 'Authentication failed', hint: 'Check your token.' },
      ],
      failedCount: 2,
    });
    const result = await checkConnectivity({ configDir, testConnectionsFn });
    const lines = result.hint.split('\n');
    assert.equal(lines.length, 3);
    assert.equal(lines[0], 'corenexus: ok');
    assert.equal(lines[1], 'advent: Connection timed out → Check your VPN.');
    assert.equal(lines[2], "Team Manager's Team: Authentication failed → Check your token.");
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

  it('full sweep forwards resolveAdapterFn to testConnections — a stubbed resolveAdapterFn must not fall through to a real network call', async () => {
    let seenResolveAdapterFn;
    const testConnectionsFn = async (opts) => {
      seenResolveAdapterFn = opts.resolveAdapterFn;
      return { results: [], failedCount: 0 };
    };
    const resolveAdapterFn = () => ({ fetchCurrentUser: async () => ({ displayName: 'Dev' }) });
    await checkConnectivity({ configDir, testConnectionsFn, resolveAdapterFn });
    assert.equal(seenResolveAdapterFn, resolveAdapterFn);
  });
});

describe('checkCacheHealth', () => {
  it('passes with a clear "No cached files." message when there are no cached files — never the bare formatSize(0) "?"', () => {
    const getCacheEntriesFn = () => [];
    const result = checkCacheHealth({ configDir, getCacheEntriesFn });
    assert.equal(result.id, 'cache-health');
    assert.equal(result.ok, true);
    assert.equal(result.message, 'No cached files.');
    assert.deepEqual(result.corruptEntries, []);
  });

  it('passes when all cached entries have non-zero size', () => {
    const getCacheEntriesFn = () => [
      { ticketKey: 'ACME-1', filename: 'a.png', localPath: '/x/a.png', size: 1024, mtimeMs: Date.now() },
    ];
    const result = checkCacheHealth({ configDir, getCacheEntriesFn });
    assert.equal(result.ok, true);
    assert.match(result.message, /1 cached file/);
  });

  it('fails and is fixable when a cached entry is 0 bytes, listing it in corruptEntries', () => {
    const getCacheEntriesFn = () => [
      { ticketKey: 'ACME-1', filename: 'good.png', localPath: '/x/good.png', size: 512, mtimeMs: Date.now() },
      { ticketKey: 'ACME-1', filename: 'bad.png', localPath: '/x/bad.png', size: 0, mtimeMs: Date.now() },
    ];
    const result = checkCacheHealth({ configDir, getCacheEntriesFn });
    assert.equal(result.ok, false);
    assert.equal(result.fixable, true);
    assert.equal(result.corruptEntries.length, 1);
    assert.equal(result.corruptEntries[0].filename, 'bad.png');
  });

  it('scopes entries to one profile when profileName is given', () => {
    const getCacheEntriesFn = () => [
      { ticketKey: 'ACME-1', filename: 'a.png', localPath: '/x/a.png', size: 100, mtimeMs: Date.now() },
      { ticketKey: 'GLBX-1', filename: 'b.png', localPath: '/x/b.png', size: 0, mtimeMs: Date.now() },
    ];
    const loadProfilesFn = () => ({ profiles: { acme: { ticketPrefixes: ['ACME'] } } });
    const filterEntriesByProfileFn = (entries, name) =>
      entries.filter(e => e.ticketKey.startsWith('ACME'));
    const result = checkCacheHealth({ configDir, profileName: 'acme', getCacheEntriesFn, loadProfilesFn, filterEntriesByProfileFn });
    // GLBX-1's 0-byte entry is filtered out by profile scope — only ACME-1 (healthy) remains.
    assert.equal(result.ok, true);
  });
});

describe('checkRecallQueue', () => {
  it('passes when the queue is empty', () => {
    const readQueueFn = () => [];
    const result = checkRecallQueue({ configDir, readQueueFn });
    assert.equal(result.id, 'recall-queue');
    assert.equal(result.ok, true);
    assert.match(result.message, /No notes pending/);
    assert.equal(result.fixable, false);
  });

  it('fails and is fixable when the queue has any pending entries', () => {
    const readQueueFn = () => [{ id: 'n1' }, { id: 'n2' }];
    const result = checkRecallQueue({ configDir, readQueueFn });
    assert.equal(result.ok, false);
    assert.equal(result.fixable, true);
    assert.match(result.message, /2 note/);
  });
});

describe('checkMcpRegistration', () => {
  const cwd = '/fake/project';
  const configPath = join(cwd, '.mcp.json');
  const desired = { command: 'ticketlens', args: ['mcp'] };

  it('is fixable and reports no file found when .mcp.json does not exist', () => {
    const existsSyncFn = () => false;
    const readMcpConfigFn = () => ({ ok: true, config: {} });
    const result = checkMcpRegistration({ cwd, existsSyncFn, readMcpConfigFn });
    assert.equal(result.id, 'mcp-registration');
    assert.equal(result.ok, false);
    assert.match(result.message, /No \.mcp\.json file found/);
    assert.equal(result.fixable, true);
  });

  it('is not fixable when .mcp.json exists but is malformed', () => {
    const existsSyncFn = () => true;
    const readMcpConfigFn = () => ({ ok: false, reason: `${configPath} is not valid JSON — left untouched. Fix or remove it, then retry.` });
    const result = checkMcpRegistration({ cwd, existsSyncFn, readMcpConfigFn });
    assert.equal(result.ok, false);
    assert.equal(result.fixable, false);
    assert.match(result.message, /not valid JSON/);
  });

  it('is fixable and reports not registered when .mcp.json exists but has no ticketlens entry', () => {
    const existsSyncFn = () => true;
    const readMcpConfigFn = () => ({ ok: true, config: { mcpServers: {} } });
    const result = checkMcpRegistration({ cwd, existsSyncFn, readMcpConfigFn });
    assert.equal(result.ok, false);
    assert.equal(result.fixable, true);
    assert.match(result.message, /not registered/);
  });

  it('is fixable and reports not registered when the existing entry does not match the desired command/args', () => {
    const existsSyncFn = () => true;
    const readMcpConfigFn = () => ({ ok: true, config: { mcpServers: { ticketlens: { command: 'node', args: ['old.mjs'] } } } });
    const result = checkMcpRegistration({ cwd, existsSyncFn, readMcpConfigFn });
    assert.equal(result.ok, false);
    assert.equal(result.fixable, true);
  });

  it('passes when .mcp.json registers ticketlens with the correct command and args', () => {
    const existsSyncFn = () => true;
    const readMcpConfigFn = () => ({ ok: true, config: { mcpServers: { ticketlens: desired } } });
    const result = checkMcpRegistration({ cwd, existsSyncFn, readMcpConfigFn });
    assert.equal(result.ok, true);
    assert.equal(result.fixable, false);
    assert.equal(result.hint, null);
  });
});

describe('checkMcpHandshake', () => {
  it('passes and reports the protocol version on a successful handshake', async () => {
    const testMcpHandshakeFn = async () => ({ ok: true, protocolVersion: '2025-11-25' });
    const result = await checkMcpHandshake({ testMcpHandshakeFn });
    assert.equal(result.id, 'mcp-handshake');
    assert.equal(result.ok, true);
    assert.match(result.message, /2025-11-25/);
    assert.equal(result.fixable, false);
  });

  it('fails with a not-on-PATH hint when the child process could not be spawned', async () => {
    const testMcpHandshakeFn = async () => ({ ok: false, reason: 'spawn-error', error: new Error('ENOENT') });
    const result = await checkMcpHandshake({ testMcpHandshakeFn });
    assert.equal(result.ok, false);
    assert.equal(result.fixable, false);
    assert.match(result.hint, /PATH/);
  });

  it('fails with a timeout message including the configured timeout', async () => {
    const testMcpHandshakeFn = async (opts) => {
      assert.equal(opts.timeoutMs, 1234);
      return { ok: false, reason: 'timeout' };
    };
    const result = await checkMcpHandshake({ timeoutMs: 1234, testMcpHandshakeFn });
    assert.equal(result.ok, false);
    assert.match(result.message, /1234ms/);
  });

  it('fails with an invalid-response message when the server replied but not validly', async () => {
    const testMcpHandshakeFn = async () => ({ ok: false, reason: 'invalid-response' });
    const result = await checkMcpHandshake({ testMcpHandshakeFn });
    assert.equal(result.ok, false);
    assert.match(result.message, /not.*valid initialize result/);
  });
});
