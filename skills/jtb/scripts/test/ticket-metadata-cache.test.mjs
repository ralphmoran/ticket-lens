import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  metadataCachePath,
  readMetadataCache,
  writeMetadataCache,
  METADATA_TTL_MS,
} from '../lib/ticket-metadata-cache.mjs';

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), 'tl-ticket-metadata-cache-'));
}

describe('metadataCachePath', () => {
  it('returns profile-scoped path', () => {
    const p = metadataCachePath('myteam', '/home/.ticketlens');
    assert.equal(p, '/home/.ticketlens/cache/myteam/ticket-metadata.json');
  });

  it('falls back to _default when no profile', () => {
    const p = metadataCachePath(null, '/home/.ticketlens');
    assert.equal(p, '/home/.ticketlens/cache/_default/ticket-metadata.json');
  });

  it('strips path traversal sequences from profileName', () => {
    const p = metadataCachePath('../evil', '/home/.ticketlens');
    assert.ok(!p.includes('..'), `path must not contain .. but got: ${p}`);
  });

  it('strips slashes from profileName', () => {
    const p = metadataCachePath('a/b', '/home/.ticketlens');
    assert.ok(!p.replace('/home/.ticketlens', '').includes('/a/b'), `path must not contain raw slash-separated segments: ${p}`);
  });
});

describe('writeMetadataCache + readMetadataCache', () => {
  it('round-trips projects and issueTypesByProject', () => {
    const dir = makeTmpDir();
    try {
      writeMetadataCache('work', { projects: [{ key: 'CNV1', name: 'Corenexus v1.0' }], issueTypesByProject: { CNV1: [{ id: '10001', name: 'Task' }] } }, dir);
      const result = readMetadataCache('work', dir);
      assert.ok(result !== null);
      assert.deepEqual(result.projects, [{ key: 'CNV1', name: 'Corenexus v1.0' }]);
      assert.deepEqual(result.issueTypesByProject, { CNV1: [{ id: '10001', name: 'Task' }] });
      assert.ok(result.fetchedAt);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults projects/issueTypesByProject to empty when omitted (Linear has no issue types)', () => {
    const dir = makeTmpDir();
    try {
      writeMetadataCache('linear-team', { projects: [{ key: 'ENG', name: 'Engineering' }] }, dir);
      const result = readMetadataCache('linear-team', dir);
      assert.deepEqual(result.projects, [{ key: 'ENG', name: 'Engineering' }]);
      assert.deepEqual(result.issueTypesByProject, {});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null on cache miss', () => {
    const dir = makeTmpDir();
    try {
      const result = readMetadataCache('nonexistent-profile', dir);
      assert.equal(result, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null and deletes the file when TTL is exceeded', () => {
    const dir = makeTmpDir();
    try {
      const filePath = join(dir, 'cache', 'work', 'ticket-metadata.json');
      mkdirSync(dirname(filePath), { recursive: true });
      const stale = new Date(Date.now() - METADATA_TTL_MS - 1000).toISOString();
      writeFileSync(filePath, JSON.stringify({ fetchedAt: stale, projects: [{ key: 'CNV1', name: 'x' }], issueTypesByProject: {} }));

      const result = readMetadataCache('work', dir);
      assert.equal(result, null);
      assert.equal(existsSync(filePath), false, 'expired cache file should be deleted on read');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('respects a custom ttlMs override — a shorter override treats an entry as stale sooner than the 24h default would', () => {
    const dir = makeTmpDir();
    try {
      const filePath = join(dir, 'cache', 'work', 'ticket-metadata.json');
      mkdirSync(dirname(filePath), { recursive: true });
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      writeFileSync(filePath, JSON.stringify({ fetchedAt: oneHourAgo, projects: [{ key: 'CNV1', name: 'x' }], issueTypesByProject: {} }));

      assert.notEqual(readMetadataCache('work', dir), null, 'still fresh under the 24h default TTL');
      assert.equal(readMetadataCache('work', dir, 30 * 60 * 1000), null, 'stale under a 30-minute override, since it is 1 hour old');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null on corrupt JSON rather than throwing', () => {
    const dir = makeTmpDir();
    try {
      const filePath = join(dir, 'cache', 'work', 'ticket-metadata.json');
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, 'not json{{{');
      const result = readMetadataCache('work', dir);
      assert.equal(result, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('write is non-fatal on failure (e.g. unwritable directory)', () => {
    assert.doesNotThrow(() => {
      writeMetadataCache('work', { projects: [{ key: 'X', name: 'x' }] }, '/nonexistent-root-only-path/definitely-not-writable');
    });
  });
});
