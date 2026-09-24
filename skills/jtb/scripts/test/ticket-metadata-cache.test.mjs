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
  SINGLE_PROJECT_TTL_MS,
  isFresh,
  normalizeAssigneeQuery,
  mergeAssignableUsers,
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

  it('respects a custom ttlMs override — a shorter override treats an entry as stale sooner than the 7-day default would', () => {
    const dir = makeTmpDir();
    try {
      const filePath = join(dir, 'cache', 'work', 'ticket-metadata.json');
      mkdirSync(dirname(filePath), { recursive: true });
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      writeFileSync(filePath, JSON.stringify({ fetchedAt: oneHourAgo, projects: [{ key: 'CNV1', name: 'x' }], issueTypesByProject: {} }));

      assert.notEqual(readMetadataCache('work', dir), null, 'still fresh under the 7-day default TTL');
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

  it('round-trips issueTypesFetchedAt and projectsFetchedAt', () => {
    const dir = makeTmpDir();
    try {
      writeMetadataCache('work', {
        projects: [{ key: 'CNV1', name: 'Corenexus v1.0' }],
        issueTypesByProject: { CNV1: [{ id: '10001', name: 'Task' }] },
        issueTypesFetchedAt: { CNV1: '2026-09-01T00:00:00.000Z' },
        projectsFetchedAt: '2026-09-01T00:00:00.000Z',
      }, dir);
      const result = readMetadataCache('work', dir);
      assert.deepEqual(result.issueTypesFetchedAt, { CNV1: '2026-09-01T00:00:00.000Z' });
      assert.equal(result.projectsFetchedAt, '2026-09-01T00:00:00.000Z');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults issueTypesFetchedAt to {} and projectsFetchedAt to null when omitted (old cache file shape)', () => {
    const dir = makeTmpDir();
    try {
      writeMetadataCache('work', { projects: [{ key: 'CNV1', name: 'x' }], issueTypesByProject: {} }, dir);
      const result = readMetadataCache('work', dir);
      assert.deepEqual(result.issueTypesFetchedAt, {});
      assert.equal(result.projectsFetchedAt, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('SINGLE_PROJECT_TTL_MS', () => {
  it('is shorter than the full-scan METADATA_TTL_MS — a targeted project request expects fresher data', () => {
    assert.ok(SINGLE_PROJECT_TTL_MS < METADATA_TTL_MS);
    assert.equal(SINGLE_PROJECT_TTL_MS, 3 * 24 * 60 * 60 * 1000);
    assert.equal(METADATA_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  });
});

describe('normalizeAssigneeQuery', () => {
  it('trims and lowercases so "Jane", " jane ", and "JANE" share one cache entry', () => {
    assert.equal(normalizeAssigneeQuery('Jane'), 'jane');
    assert.equal(normalizeAssigneeQuery(' jane '), 'jane');
    assert.equal(normalizeAssigneeQuery('JANE'), 'jane');
  });
});

describe('mergeAssignableUsers', () => {
  it('adds a new project+query entry into an empty cache', () => {
    const { assignableUsersByProject, assignableUsersFetchedAt } = mergeAssignableUsers(null, 'PROJ', 'Jane', [{ accountId: 'acc-1', displayName: 'Jane Dev' }], '2026-09-23T00:00:00.000Z');
    assert.deepEqual(assignableUsersByProject.PROJ.jane, [{ accountId: 'acc-1', displayName: 'Jane Dev' }]);
    assert.equal(assignableUsersFetchedAt.PROJ.jane, '2026-09-23T00:00:00.000Z');
  });

  it('preserves an existing query under the same project when merging a different query', () => {
    const cached = mergeAssignableUsers(null, 'PROJ', 'jane', [{ accountId: 'acc-1', displayName: 'Jane Dev' }]);
    const merged = mergeAssignableUsers(cached, 'PROJ', 'john', [{ accountId: 'acc-2', displayName: 'John Doe' }]);
    assert.deepEqual(Object.keys(merged.assignableUsersByProject.PROJ).sort(), ['jane', 'john']);
  });

  it('preserves other projects entirely when merging a new project', () => {
    const cached = mergeAssignableUsers(null, 'PROJ', 'jane', [{ accountId: 'acc-1', displayName: 'Jane Dev' }]);
    const merged = mergeAssignableUsers(cached, 'OTHER', 'jane', [{ accountId: 'acc-9', displayName: 'Jane Other' }]);
    assert.deepEqual(merged.assignableUsersByProject.PROJ.jane, [{ accountId: 'acc-1', displayName: 'Jane Dev' }]);
    assert.deepEqual(merged.assignableUsersByProject.OTHER.jane, [{ accountId: 'acc-9', displayName: 'Jane Other' }]);
  });

  it('__proto__ as a projectKey is stored as a real own key, not redirected into the prototype chain', () => {
    const { assignableUsersByProject } = mergeAssignableUsers(null, '__proto__', 'jane', [{ accountId: 'x', displayName: 'y' }]);
    assert.ok(Object.prototype.hasOwnProperty.call(assignableUsersByProject, '__proto__'));
    assert.deepEqual(Object.getPrototypeOf({}), Object.prototype, 'the real Object.prototype must be untouched');
  });

  it('__proto__ as a query is stored as a real own key, not redirected into the prototype chain', () => {
    const { assignableUsersByProject } = mergeAssignableUsers(null, 'PROJ', '__proto__', [{ accountId: 'x', displayName: 'y' }]);
    assert.ok(Object.prototype.hasOwnProperty.call(assignableUsersByProject.PROJ, '__proto__'));
  });
});

describe('assignableUsersByProject/assignableUsersFetchedAt round-trip through read/writeMetadataCache', () => {
  it('round-trips through the cache file untouched', () => {
    const dir = makeTmpDir();
    try {
      const { assignableUsersByProject, assignableUsersFetchedAt } = mergeAssignableUsers(null, 'PROJ', 'jane', [{ accountId: 'acc-1', displayName: 'Jane Dev' }], '2026-09-23T00:00:00.000Z');
      writeMetadataCache('work', { assignableUsersByProject, assignableUsersFetchedAt }, dir);
      const result = readMetadataCache('work', dir);
      assert.deepEqual(result.assignableUsersByProject, { PROJ: { jane: [{ accountId: 'acc-1', displayName: 'Jane Dev' }] } });
      assert.deepEqual(result.assignableUsersFetchedAt, { PROJ: { jane: '2026-09-23T00:00:00.000Z' } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('defaults assignableUsersByProject/FetchedAt to {} when omitted — does not break reading an old cache file written before this feature', () => {
    const dir = makeTmpDir();
    try {
      writeMetadataCache('work', { projects: [{ key: 'CNV1', name: 'x' }], issueTypesByProject: {} }, dir);
      const result = readMetadataCache('work', dir);
      assert.deepEqual(result.assignableUsersByProject, {});
      assert.deepEqual(result.assignableUsersFetchedAt, {});
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('an assignable-users-only write preserves an existing issueTypesByProject entry untouched (LOCK — shared-file regression guard)', () => {
    const dir = makeTmpDir();
    try {
      writeMetadataCache('work', { projects: [{ key: 'PROJ', name: 'x' }], issueTypesByProject: { PROJ: [{ id: '1', name: 'Task' }] }, issueTypesFetchedAt: { PROJ: '2026-09-20T00:00:00.000Z' } }, dir);
      const cached = readMetadataCache('work', dir);
      const { assignableUsersByProject, assignableUsersFetchedAt } = mergeAssignableUsers(cached, 'PROJ', 'jane', [{ accountId: 'acc-1', displayName: 'Jane Dev' }]);
      writeMetadataCache('work', { ...cached, assignableUsersByProject, assignableUsersFetchedAt }, dir);
      const result = readMetadataCache('work', dir);
      assert.deepEqual(result.issueTypesByProject, { PROJ: [{ id: '1', name: 'Task' }] }, 'issue-types cache must survive an assignable-users write');
      assert.deepEqual(result.projects, [{ key: 'PROJ', name: 'x' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('isFresh treats a stale assignableUsersFetchedAt entry as expired, same as issueTypesFetchedAt', () => {
    const stale = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(isFresh(stale, SINGLE_PROJECT_TTL_MS), false);
    const fresh = new Date().toISOString();
    assert.equal(isFresh(fresh, SINGLE_PROJECT_TTL_MS), true);
  });
});
