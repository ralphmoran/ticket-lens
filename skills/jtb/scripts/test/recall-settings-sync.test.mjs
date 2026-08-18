import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readEffectiveRecallSettings,
  fetchRecallSettings,
  getEffectiveRecallSettings,
  DEFAULT_RECALL_SETTINGS,
  RECALL_SETTINGS_BOUNDS,
} from '../lib/recall-settings-sync.mjs';
import { hashToken } from '../lib/recall-sync.mjs';

function freshConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tl-recall-settings-test-'));
}

function writeCache(configDir, values, { tokenHash = hashToken('tl_key'), fetchedAt = new Date().toISOString() } = {}) {
  fs.writeFileSync(path.join(configDir, 'recall-settings-cache.json'), JSON.stringify({ values, tokenHash, fetchedAt }));
}

// ---------------------------------------------------------------------------
// readEffectiveRecallSettings — local-only fallback, never touches the network
// ---------------------------------------------------------------------------

describe('readEffectiveRecallSettings', () => {
  it('returns platform defaults when there is no cliToken, even if a cache file exists', () => {
    const configDir = freshConfigDir();
    writeCache(configDir, { ...DEFAULT_RECALL_SETTINGS, max_queue_size: 999 });
    assert.deepEqual(readEffectiveRecallSettings(configDir), DEFAULT_RECALL_SETTINGS);
  });

  it('returns platform defaults when no cache file exists', () => {
    const configDir = freshConfigDir();
    assert.deepEqual(readEffectiveRecallSettings(configDir, { cliToken: 'tl_key' }), DEFAULT_RECALL_SETTINGS);
  });

  it('returns platform defaults when the cache file is corrupt JSON', () => {
    const configDir = freshConfigDir();
    fs.writeFileSync(path.join(configDir, 'recall-settings-cache.json'), '{not json');
    assert.deepEqual(readEffectiveRecallSettings(configDir, { cliToken: 'tl_key' }), DEFAULT_RECALL_SETTINGS);
  });

  it('returns a cached team override within bounds as-is when cliToken matches the cache', () => {
    const configDir = freshConfigDir();
    const override = { flush_cooldown_ms: 300_000, timeout_ms: 8_000, max_queue_size: 50, max_entry_age_ms: 604_800_000, recall_strictness: 'strict' };
    writeCache(configDir, override, { tokenHash: hashToken('tl_key') });
    assert.deepEqual(readEffectiveRecallSettings(configDir, { cliToken: 'tl_key' }), override);
  });

  it('falls back to the default recall_strictness when the cache value is not a recognized level', () => {
    const configDir = freshConfigDir();
    writeCache(configDir, { ...DEFAULT_RECALL_SETTINGS, recall_strictness: 'bogus' });
    const effective = readEffectiveRecallSettings(configDir, { cliToken: 'tl_key' });
    assert.equal(effective.recall_strictness, 'balanced');
  });

  it('returns platform defaults — not the cache — when the cache belongs to a different account', () => {
    const configDir = freshConfigDir();
    writeCache(configDir, { ...DEFAULT_RECALL_SETTINGS, max_queue_size: 999 }, { tokenHash: hashToken('old_account') });
    assert.deepEqual(readEffectiveRecallSettings(configDir, { cliToken: 'new_account' }), DEFAULT_RECALL_SETTINGS);
  });

  it('clamps a cached value above the max bound — defense in depth even against our own backend/cache file', () => {
    const configDir = freshConfigDir();
    writeCache(configDir, { ...DEFAULT_RECALL_SETTINGS, flush_cooldown_ms: 999_999_999_999 });
    const effective = readEffectiveRecallSettings(configDir, { cliToken: 'tl_key' });
    assert.equal(effective.flush_cooldown_ms, RECALL_SETTINGS_BOUNDS.flush_cooldown_ms[1]);
  });

  it('clamps a cached value below the min bound', () => {
    const configDir = freshConfigDir();
    writeCache(configDir, { ...DEFAULT_RECALL_SETTINGS, timeout_ms: 1 });
    const effective = readEffectiveRecallSettings(configDir, { cliToken: 'tl_key' });
    assert.equal(effective.timeout_ms, RECALL_SETTINGS_BOUNDS.timeout_ms[0]);
  });

  it('falls back to the platform default for a field that is missing or non-numeric in the cache, without rejecting the whole file', () => {
    const configDir = freshConfigDir();
    writeCache(configDir, { flush_cooldown_ms: 'not-a-number', max_queue_size: 50 });
    const effective = readEffectiveRecallSettings(configDir, { cliToken: 'tl_key' });
    assert.equal(effective.flush_cooldown_ms, DEFAULT_RECALL_SETTINGS.flush_cooldown_ms);
    assert.equal(effective.max_queue_size, 50);
  });
});

// ---------------------------------------------------------------------------
// fetchRecallSettings
// ---------------------------------------------------------------------------

describe('fetchRecallSettings', () => {
  it('does not call fetcher and reports failure when there is no cliToken', async () => {
    let fetchCalled = false;
    const result = await fetchRecallSettings({ cliToken: null, fetcher: () => { fetchCalled = true; } });
    assert.equal(fetchCalled, false);
    assert.equal(result.ok, false);
  });

  it('sends a bearer header and returns ok:true with parsed values on 2xx', async () => {
    let capturedOpts;
    const fetcher = async (url, opts) => {
      capturedOpts = opts;
      return { ok: true, status: 200, json: async () => ({ flush_cooldown_ms: 600_000, timeout_ms: 5000, max_queue_size: 100, max_entry_age_ms: 1_000_000, is_override: true }) };
    };
    const result = await fetchRecallSettings({ cliToken: 'tl_key', fetcher });
    assert.equal(result.ok, true);
    assert.equal(result.isOverride, true);
    assert.equal(result.values.flush_cooldown_ms, 600_000);
    assert.equal(capturedOpts.headers.Authorization, 'Bearer tl_key');
    assert.equal(capturedOpts.redirect, 'manual');
  });

  it('returns ok:false on a non-2xx response', async () => {
    const result = await fetchRecallSettings({ cliToken: 'tl_key', fetcher: async () => ({ ok: false, status: 403 }) });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'http-403');
  });

  it('returns ok:false when the fetch itself throws (network error/timeout)', async () => {
    const result = await fetchRecallSettings({ cliToken: 'tl_key', fetcher: async () => { throw new Error('timed out'); } });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'network');
  });
});

// ---------------------------------------------------------------------------
// getEffectiveRecallSettings — the main entry point (live fetch, with fallback)
// ---------------------------------------------------------------------------

describe('getEffectiveRecallSettings', () => {
  it('returns local defaults without fetching when there is no cliToken', async () => {
    const configDir = freshConfigDir();
    let fetchCalled = false;
    const result = await getEffectiveRecallSettings({
      cliToken: null, configDir,
      fetchRecallSettingsFn: async () => { fetchCalled = true; return { ok: true, values: DEFAULT_RECALL_SETTINGS }; },
    });
    assert.equal(fetchCalled, false);
    assert.deepEqual(result, DEFAULT_RECALL_SETTINGS);
  });

  it('fetches live and returns the fetched values, even when a fresh cache already exists — the whole point is not trusting a cache', async () => {
    const configDir = freshConfigDir();
    writeCache(configDir, { ...DEFAULT_RECALL_SETTINGS, max_queue_size: 42 }, { fetchedAt: new Date().toISOString() });
    const result = await getEffectiveRecallSettings({
      cliToken: 'tl_key', configDir,
      fetchRecallSettingsFn: async () => ({ ok: true, values: { ...DEFAULT_RECALL_SETTINGS, max_queue_size: 999 } }),
    });
    assert.equal(result.max_queue_size, 999);
  });

  it('writes the freshly-fetched values to the local cache, tagged with the account, for future offline fallback', async () => {
    const configDir = freshConfigDir();
    await getEffectiveRecallSettings({
      cliToken: 'tl_key', configDir,
      fetchRecallSettingsFn: async () => ({ ok: true, values: { ...DEFAULT_RECALL_SETTINGS, max_queue_size: 77 } }),
    });
    assert.equal(readEffectiveRecallSettings(configDir, { cliToken: 'tl_key' }).max_queue_size, 77);
  });

  it('clamps a fetched value outside bounds — defense in depth even against our own backend', async () => {
    const result = await getEffectiveRecallSettings({
      cliToken: 'tl_key', configDir: freshConfigDir(),
      fetchRecallSettingsFn: async () => ({ ok: true, values: { ...DEFAULT_RECALL_SETTINGS, timeout_ms: 999_999 } }),
    });
    assert.equal(result.timeout_ms, RECALL_SETTINGS_BOUNDS.timeout_ms[1]);
  });

  it('falls back to the cached value when the live fetch fails', async () => {
    const configDir = freshConfigDir();
    writeCache(configDir, { ...DEFAULT_RECALL_SETTINGS, max_queue_size: 55 });
    const result = await getEffectiveRecallSettings({
      cliToken: 'tl_key', configDir,
      fetchRecallSettingsFn: async () => ({ ok: false, error: 'network' }),
    });
    assert.equal(result.max_queue_size, 55);
  });

  it('falls back to platform defaults when the live fetch fails and there is no cache yet', async () => {
    const result = await getEffectiveRecallSettings({
      cliToken: 'tl_key', configDir: freshConfigDir(),
      fetchRecallSettingsFn: async () => ({ ok: false, error: 'network' }),
    });
    assert.deepEqual(result, DEFAULT_RECALL_SETTINGS);
  });

  it('never falls back to a cache written under a different account', async () => {
    const configDir = freshConfigDir();
    writeCache(configDir, { ...DEFAULT_RECALL_SETTINGS, max_queue_size: 55 }, { tokenHash: hashToken('old_account') });
    const result = await getEffectiveRecallSettings({
      cliToken: 'new_account', configDir,
      fetchRecallSettingsFn: async () => ({ ok: false, error: 'network' }),
    });
    assert.deepEqual(result, DEFAULT_RECALL_SETTINGS);
  });
});
