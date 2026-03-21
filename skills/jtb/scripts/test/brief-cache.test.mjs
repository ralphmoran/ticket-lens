import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  briefCachePath,
  readBriefCache,
  writeBriefCache,
  clearBriefCache,
  getBriefCacheEntries,
  briefCacheAge,
  BRIEF_TTL_MS,
} from '../lib/brief-cache.mjs';

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'tl-brief-cache-'));
}

const SAMPLE_TICKET = { key: 'PROJ-123', summary: 'Test ticket', description: 'Some desc', comments: [] };

describe('briefCachePath', () => {
  it('returns profile-scoped path', () => {
    const p = briefCachePath('PROJ-123', 'myteam', '/home/.ticketlens');
    assert.equal(p, '/home/.ticketlens/cache/myteam/PROJ-123/brief.json');
  });

  it('falls back to _default when no profile', () => {
    const p = briefCachePath('PROJ-123', null, '/home/.ticketlens');
    assert.equal(p, '/home/.ticketlens/cache/_default/PROJ-123/brief.json');
  });

  it('strips path traversal sequences from profileName', () => {
    const p = briefCachePath('PROJ-123', '../evil', '/home/.ticketlens');
    assert.ok(!p.includes('..'), `path must not contain .. but got: ${p}`);
  });

  it('strips path traversal sequences from ticketKey', () => {
    const p = briefCachePath('../evil/script.sh', 'myprofile', '/home/.ticketlens');
    assert.ok(!p.includes('..'), `path must not contain .. but got: ${p}`);
  });

  it('strips slashes from profileName', () => {
    const p = briefCachePath('PROJ-123', 'a/b', '/home/.ticketlens');
    assert.ok(!p.replace('/home/.ticketlens', '').includes('/a/b'), `path must not contain raw slash-separated segments: ${p}`);
  });
});

describe('writeBriefCache + readBriefCache', () => {
  it('round-trips ticket data', () => {
    const dir = makeTmpDir();
    try {
      writeBriefCache('PROJ-123', 'work', 1, SAMPLE_TICKET, dir);
      const result = readBriefCache('PROJ-123', 'work', 1, dir);
      assert.ok(result !== null);
      assert.deepEqual(result.ticket, SAMPLE_TICKET);
      assert.equal(result.cachedDepth, 1);
      assert.ok(result.fetchedAt);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null on cache miss', () => {
    const dir = makeTmpDir();
    try {
      const result = readBriefCache('PROJ-999', 'work', 1, dir);
      assert.equal(result, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when cached depth < requested depth', () => {
    const dir = makeTmpDir();
    try {
      writeBriefCache('PROJ-123', 'work', 0, SAMPLE_TICKET, dir);
      const result = readBriefCache('PROJ-123', 'work', 1, dir);
      assert.equal(result, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('serves cache when cached depth > requested depth', () => {
    const dir = makeTmpDir();
    try {
      writeBriefCache('PROJ-123', 'work', 2, SAMPLE_TICKET, dir);
      const result = readBriefCache('PROJ-123', 'work', 1, dir);
      assert.ok(result !== null);
      assert.equal(result.cachedDepth, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when TTL is exceeded', () => {
    const dir = makeTmpDir();
    try {
      writeBriefCache('PROJ-123', 'work', 1, SAMPLE_TICKET, dir);
      // Overwrite with an expired fetchedAt
      const filePath = briefCachePath('PROJ-123', 'work', dir);
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      data.fetchedAt = new Date(Date.now() - BRIEF_TTL_MS - 1000).toISOString();
      writeFileSync(filePath, JSON.stringify(data));
      const result = readBriefCache('PROJ-123', 'work', 1, dir);
      assert.equal(result, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deletes the file when TTL is exceeded (lazy eviction)', () => {
    const dir = makeTmpDir();
    try {
      writeBriefCache('PROJ-123', 'work', 1, SAMPLE_TICKET, dir);
      const filePath = briefCachePath('PROJ-123', 'work', dir);
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      data.fetchedAt = new Date(Date.now() - BRIEF_TTL_MS - 1000).toISOString();
      writeFileSync(filePath, JSON.stringify(data));
      assert.ok(existsSync(filePath), 'file should exist before read');
      readBriefCache('PROJ-123', 'work', 1, dir);
      assert.ok(!existsSync(filePath), 'file should be deleted after expired read');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('respects a custom ttlMs — serves cache within custom window', () => {
    const dir = makeTmpDir();
    try {
      writeBriefCache('PROJ-123', 'work', 1, SAMPLE_TICKET, dir);
      // Set fetchedAt to 2 days ago
      const filePath = briefCachePath('PROJ-123', 'work', dir);
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      data.fetchedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      writeFileSync(filePath, JSON.stringify(data));
      // With 7-day TTL it should still hit
      const customTtl = 7 * 24 * 60 * 60 * 1000;
      const result = readBriefCache('PROJ-123', 'work', 1, dir, customTtl);
      assert.ok(result !== null);
      assert.deepEqual(result.ticket, SAMPLE_TICKET);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('respects a custom ttlMs — misses cache when beyond custom window', () => {
    const dir = makeTmpDir();
    try {
      writeBriefCache('PROJ-123', 'work', 1, SAMPLE_TICKET, dir);
      // Set fetchedAt to 10 days ago
      const filePath = briefCachePath('PROJ-123', 'work', dir);
      const data = JSON.parse(readFileSync(filePath, 'utf8'));
      data.fetchedAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      writeFileSync(filePath, JSON.stringify(data));
      // With 7-day TTL it should miss
      const customTtl = 7 * 24 * 60 * 60 * 1000;
      const result = readBriefCache('PROJ-123', 'work', 1, dir, customTtl);
      assert.equal(result, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('handles malformed JSON gracefully', () => {
    const dir = makeTmpDir();
    try {
      const filePath = briefCachePath('PROJ-123', 'work', dir);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, 'NOT JSON');
      const result = readBriefCache('PROJ-123', 'work', 1, dir);
      assert.equal(result, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('clearBriefCache', () => {
  it('removes the brief.json file', () => {
    const dir = makeTmpDir();
    try {
      writeBriefCache('PROJ-123', 'work', 1, SAMPLE_TICKET, dir);
      const filePath = briefCachePath('PROJ-123', 'work', dir);
      assert.ok(existsSync(filePath));
      clearBriefCache('PROJ-123', 'work', dir);
      assert.ok(!existsSync(filePath));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op when file does not exist', () => {
    const dir = makeTmpDir();
    try {
      assert.doesNotThrow(() => clearBriefCache('PROJ-999', 'work', dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('getBriefCacheEntries', () => {
  it('returns entries for all profiles', () => {
    const dir = makeTmpDir();
    try {
      writeBriefCache('PROJ-123', 'work', 1, SAMPLE_TICKET, dir);
      writeBriefCache('ACME-456', 'client', 0, SAMPLE_TICKET, dir);
      const entries = getBriefCacheEntries(dir);
      assert.equal(entries.length, 2);
      const keys = entries.map(e => e.ticketKey).sort();
      assert.deepEqual(keys, ['ACME-456', 'PROJ-123']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty array when cache dir does not exist', () => {
    const entries = getBriefCacheEntries('/nonexistent/path');
    assert.deepEqual(entries, []);
  });

  it('each entry includes profileName, ticketKey, fetchedAt, depth', () => {
    const dir = makeTmpDir();
    try {
      writeBriefCache('PROJ-123', 'myteam', 2, SAMPLE_TICKET, dir);
      const entries = getBriefCacheEntries(dir);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].profileName, 'myteam');
      assert.equal(entries[0].ticketKey, 'PROJ-123');
      assert.equal(entries[0].depth, 2);
      assert.ok(entries[0].fetchedAt);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('briefCacheAge', () => {
  it('returns "just now" for very recent timestamps', () => {
    const result = briefCacheAge(new Date().toISOString());
    assert.equal(result, 'just now');
  });

  it('returns minutes for recent timestamps', () => {
    const ts = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    assert.equal(briefCacheAge(ts), '15m ago');
  });

  it('returns hours for older timestamps', () => {
    const ts = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    assert.equal(briefCacheAge(ts), '3h ago');
  });

  it('returns days for very old timestamps', () => {
    const ts = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(briefCacheAge(ts), '2d ago');
  });
});
