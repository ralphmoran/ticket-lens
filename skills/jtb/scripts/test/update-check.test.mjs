import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isNewer,
  readUpdateCheck,
  writeUpdateCheck,
  fetchLatestVersion,
  checkForUpdate,
  getUpdateHint,
  UPDATE_CHECK_TTL_MS,
} from '../lib/update-check.mjs';

// ---------------------------------------------------------------------------
// isNewer
// ---------------------------------------------------------------------------

describe('isNewer', () => {
  it('returns true when major is greater', () => assert.equal(isNewer('2.0.0', '1.9.9'), true));
  it('returns true when minor is greater', () => assert.equal(isNewer('1.2.0', '1.1.9'), true));
  it('returns true when patch is greater', () => assert.equal(isNewer('1.0.2', '1.0.1'), true));
  it('returns false when equal', () => assert.equal(isNewer('1.2.3', '1.2.3'), false));
  it('returns false when older', () => assert.equal(isNewer('0.9.9', '1.0.0'), false));
  it('strips leading v prefix', () => assert.equal(isNewer('v1.1.0', 'v1.0.9'), true));
});

// ---------------------------------------------------------------------------
// readUpdateCheck / writeUpdateCheck
// ---------------------------------------------------------------------------

describe('readUpdateCheck', () => {
  it('returns null when file does not exist', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-uc-'));
    try {
      assert.equal(readUpdateCheck(dir), null);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('returns null when checkedAt is beyond TTL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-uc-'));
    try {
      const expired = new Date(Date.now() - UPDATE_CHECK_TTL_MS - 1000).toISOString();
      writeUpdateCheck(dir, '9.9.9');
      // Overwrite with expired timestamp
      const path = join(dir, 'update-check.json');
      writeFileSync(path, JSON.stringify({ checkedAt: expired, latestVersion: '9.9.9' }));
      assert.equal(readUpdateCheck(dir), null);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('returns null when latestVersion is not a string', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-uc-'));
    try {
      writeFileSync(
        join(dir, 'update-check.json'),
        JSON.stringify({ checkedAt: new Date().toISOString(), latestVersion: 123 }),
      );
      assert.equal(readUpdateCheck(dir), null);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('returns null when latestVersion contains non-semver characters', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-uc-'));
    try {
      writeFileSync(
        join(dir, 'update-check.json'),
        JSON.stringify({ checkedAt: new Date().toISOString(), latestVersion: '1.0.0-beta.1' }),
      );
      assert.equal(readUpdateCheck(dir), null);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('returns latestVersion when fresh and within TTL', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-uc-'));
    try {
      writeUpdateCheck(dir, '5.0.0');
      const result = readUpdateCheck(dir);
      assert.equal(result, '5.0.0');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe('writeUpdateCheck', () => {
  it('is non-fatal when the directory does not exist', () => {
    assert.doesNotThrow(() => writeUpdateCheck('/nonexistent/path/that/does/not/exist', '1.0.0'));
  });
});

// ---------------------------------------------------------------------------
// fetchLatestVersion
// ---------------------------------------------------------------------------

describe('fetchLatestVersion', () => {
  it('extracts version from a 200 response', async () => {
    const fetcher = async () => ({
      ok: true,
      json: async () => ({ version: '3.1.4' }),
    });
    const result = await fetchLatestVersion({ fetcher });
    assert.equal(result, '3.1.4');
  });

  it('returns null on non-ok response', async () => {
    const fetcher = async () => ({ ok: false, json: async () => ({}) });
    const result = await fetchLatestVersion({ fetcher });
    assert.equal(result, null);
  });

  it('returns null when fetch throws', async () => {
    const fetcher = async () => { throw new Error('network failure'); };
    const result = await fetchLatestVersion({ fetcher });
    assert.equal(result, null);
  });
});

// ---------------------------------------------------------------------------
// checkForUpdate
// ---------------------------------------------------------------------------

describe('checkForUpdate', () => {
  it('fetches and writes when cache is expired', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-uc-'));
    try {
      let fetchCalled = false;
      const fetcher = async () => { fetchCalled = true; return { ok: true, json: async () => ({ version: '9.0.0' }) }; };
      await checkForUpdate({ configDir: dir, fetcher });
      assert.equal(fetchCalled, true);
      assert.equal(readUpdateCheck(dir), '9.0.0');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('skips fetch when cache is fresh', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-uc-'));
    try {
      writeUpdateCheck(dir, '8.0.0');
      let fetchCalled = false;
      const fetcher = async () => { fetchCalled = true; return { ok: true, json: async () => ({ version: '9.0.0' }) }; };
      await checkForUpdate({ configDir: dir, fetcher });
      assert.equal(fetchCalled, false);
      assert.equal(readUpdateCheck(dir), '8.0.0');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('swallows fetch errors silently', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-uc-'));
    try {
      const fetcher = async () => { throw new Error('timeout'); };
      await assert.doesNotReject(() => checkForUpdate({ configDir: dir, fetcher }));
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

// ---------------------------------------------------------------------------
// getUpdateHint
// ---------------------------------------------------------------------------

describe('getUpdateHint', () => {
  it('returns null when no cache file exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-uc-'));
    try {
      assert.equal(getUpdateHint({ configDir: dir, currentVersion: '1.0.0' }), null);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('returns null when cached version is not newer than current', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-uc-'));
    try {
      writeUpdateCheck(dir, '1.0.0');
      assert.equal(getUpdateHint({ configDir: dir, currentVersion: '1.0.0' }), null);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('returns the newer version string when an update is available', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tl-uc-'));
    try {
      writeUpdateCheck(dir, '2.0.0');
      assert.equal(getUpdateHint({ configDir: dir, currentVersion: '1.0.0' }), '2.0.0');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
