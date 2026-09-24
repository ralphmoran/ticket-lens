import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPriorityError, enrichUpdateFailure } from '../lib/ticket-update-enrichment.mjs';

function fakeAdapter(overrides = {}) {
  return {
    type: 'jira',
    listPriorities: async () => ([{ id: '1', name: 'Highest' }]),
    ...overrides,
  };
}

describe('detectPriorityError', () => {
  test('detects a Jira priority-shaped 400 (err.details.errors.priority)', () => {
    const err = Object.assign(new Error('x'), { details: { errors: { priority: 'bad' } } });
    assert.equal(detectPriorityError(err), true);
  });

  test('matches the real error shape observed live against corenexus (Cloud) and advent (Server/DC), 2026-09-24', () => {
    const err = Object.assign(new Error('x'), {
      status: 400,
      details: { errorMessages: [], errors: { priority: 'Specify the Priority (name) in the string format' } },
    });
    assert.equal(detectPriorityError(err), true);
  });

  test('returns false for a generic 400 with unrelated error fields', () => {
    const err = Object.assign(new Error('x'), { details: { errors: { summary: 'is required' } } });
    assert.equal(detectPriorityError(err), false);
  });

  test('returns false for a rate-limited failure (no .details at all)', () => {
    const err = Object.assign(new Error('x'), { rateLimit: { kind: 'secondary-rate-limit', retryAfterSeconds: 30 } });
    assert.equal(detectPriorityError(err), false);
  });

  test('returns false for a plain network error', () => {
    assert.equal(detectPriorityError(new Error('fetch failed')), false);
  });
});

describe('enrichUpdateFailure', () => {
  test('returns "" for a non-priority error — no cache read, no adapter calls', async () => {
    let readCalled = false, listCalled = false;
    const err = Object.assign(new Error('x'), { details: { errors: { title: 'bad' } } });
    const result = await enrichUpdateFailure(err, {
      adapter: fakeAdapter({ listPriorities: async () => { listCalled = true; return []; } }),
      projectKey: 'PROJ',
      profileName: 'work',
      configDir: '/fake',
      readMetadataCacheFn: () => { readCalled = true; return null; },
      writeMetadataCacheFn: () => {},
    });
    assert.equal(result, '');
    assert.equal(readCalled, false, 'must not even read the cache for an error shape that will never use it');
    assert.equal(listCalled, false);
  });

  test('returns "" for GitHub, even given a (nonsensical) priority-shaped error', async () => {
    let listCalled = false;
    const err = Object.assign(new Error('x'), { details: { errors: { priority: 'bad' } } });
    const result = await enrichUpdateFailure(err, {
      adapter: fakeAdapter({ type: 'github', listPriorities: async () => { listCalled = true; return []; } }),
      projectKey: 'PROJ',
      profileName: 'work',
      configDir: '/fake',
      readMetadataCacheFn: () => null,
      writeMetadataCacheFn: () => {},
    });
    assert.equal(result, '');
    assert.equal(listCalled, false);
  });

  test('returns "" for Linear — priority errors are already local/structured there, no network round trip needed', async () => {
    let listCalled = false;
    const err = Object.assign(new Error('x'), { details: { errors: { priority: 'bad' } } });
    const result = await enrichUpdateFailure(err, {
      adapter: fakeAdapter({ type: 'linear', listPriorities: async () => { listCalled = true; return []; } }),
      projectKey: 'ENG',
      profileName: 'linear-team',
      configDir: '/fake',
      readMetadataCacheFn: () => null,
      writeMetadataCacheFn: () => {},
    });
    assert.equal(result, '');
    assert.equal(listCalled, false);
  });

  test('returns "" without any adapter call when no projectKey can be resolved', async () => {
    let listCalled = false;
    const err = Object.assign(new Error('x'), { details: { errors: { priority: 'bad' } } });
    const result = await enrichUpdateFailure(err, {
      adapter: fakeAdapter({ listPriorities: async () => { listCalled = true; return []; } }),
      projectKey: undefined,
      profileName: 'work',
      configDir: '/fake',
      readMetadataCacheFn: () => null,
      writeMetadataCacheFn: () => {},
    });
    assert.equal(result, '');
    assert.equal(listCalled, false);
  });

  test('a fresh cache hit makes zero adapter calls', async () => {
    let listCalled = false;
    const now = new Date().toISOString();
    const err = Object.assign(new Error('x'), { details: { errors: { priority: 'bad' } } });
    const result = await enrichUpdateFailure(err, {
      adapter: fakeAdapter({ listPriorities: async () => { listCalled = true; return []; } }),
      projectKey: 'PROJ',
      profileName: 'work',
      configDir: '/fake',
      readMetadataCacheFn: () => ({
        prioritiesByProject: { PROJ: [{ id: '1', name: 'Highest' }, { id: '3', name: 'Medium' }] },
        prioritiesFetchedAt: { PROJ: now },
      }),
      writeMetadataCacheFn: () => {},
    });
    assert.equal(listCalled, false);
    assert.match(result, /Known priorities for PROJ: Highest, Medium/);
  });

  test('a stale priorities entry (older than 3 days) is refetched', async () => {
    let listCalled = false, written;
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    const err = Object.assign(new Error('x'), { details: { errors: { priority: 'bad' } } });
    const result = await enrichUpdateFailure(err, {
      adapter: fakeAdapter({ listPriorities: async () => { listCalled = true; return [{ id: '2', name: 'Low' }]; } }),
      projectKey: 'PROJ',
      profileName: 'work',
      configDir: '/fake',
      readMetadataCacheFn: () => ({
        prioritiesByProject: { PROJ: [{ id: '1', name: 'Highest' }] },
        prioritiesFetchedAt: { PROJ: fourDaysAgo },
      }),
      writeMetadataCacheFn: (profile, data) => { written = data; },
    });
    assert.equal(listCalled, true, 'a 4-day-old entry exceeds the 3-day bar, so it must be refetched');
    assert.match(result, /Known priorities for PROJ: Low/);
    assert.ok(written.prioritiesFetchedAt.PROJ);
  });

  test('when listPriorities throws mid-refresh, nothing is written to the cache and the result is ""', async () => {
    let writeCalled = false;
    const err = Object.assign(new Error('x'), { details: { errors: { priority: 'bad' } } });
    const result = await enrichUpdateFailure(err, {
      adapter: fakeAdapter({ listPriorities: async () => { throw new Error('network down mid-refresh'); } }),
      projectKey: 'PROJ',
      profileName: 'work',
      configDir: '/fake',
      readMetadataCacheFn: () => null,
      writeMetadataCacheFn: () => { writeCalled = true; },
    });
    assert.equal(result, '', 'the whole enrichment attempt must be discarded, not partially applied');
    assert.equal(writeCalled, false);
  });

  test('a fresh refetch that returns [] (no configured priorities) yields "" rather than an empty "Known priorities:" line', async () => {
    const err = Object.assign(new Error('x'), { details: { errors: { priority: 'bad' } } });
    const result = await enrichUpdateFailure(err, {
      adapter: fakeAdapter({ listPriorities: async () => [] }),
      projectKey: 'PROJ',
      profileName: 'work',
      configDir: '/fake',
      readMetadataCacheFn: () => null,
      writeMetadataCacheFn: () => {},
    });
    assert.equal(result, '');
  });

  test('a fresh cached [] (a project with no priority-capable issue type) is NOT re-walked — negative-cache gap, caught in code review', async () => {
    let listCalled = false;
    const now = new Date().toISOString();
    const err = Object.assign(new Error('x'), { details: { errors: { priority: 'bad' } } });
    const result = await enrichUpdateFailure(err, {
      adapter: fakeAdapter({ listPriorities: async () => { listCalled = true; return [{ id: '1', name: 'Highest' }]; } }),
      projectKey: 'PROJ',
      profileName: 'work',
      configDir: '/fake',
      readMetadataCacheFn: () => ({ prioritiesByProject: { PROJ: [] }, prioritiesFetchedAt: { PROJ: now } }),
      writeMetadataCacheFn: () => {},
    });
    assert.equal(listCalled, false, 'a fresh (even if empty) cache entry must short-circuit the sequential per-issue-type walk');
    assert.equal(result, '');
  });

  test('a STALE cached [] is still re-walked (the fix distinguishes fresh-empty from stale-empty, not "never refresh an empty result")', async () => {
    let listCalled = false;
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    const err = Object.assign(new Error('x'), { details: { errors: { priority: 'bad' } } });
    const result = await enrichUpdateFailure(err, {
      adapter: fakeAdapter({ listPriorities: async () => { listCalled = true; return [{ id: '1', name: 'Highest' }]; } }),
      projectKey: 'PROJ',
      profileName: 'work',
      configDir: '/fake',
      readMetadataCacheFn: () => ({ prioritiesByProject: { PROJ: [] }, prioritiesFetchedAt: { PROJ: fourDaysAgo } }),
      writeMetadataCacheFn: () => {},
    });
    assert.equal(listCalled, true, 'a stale entry, even an empty one, must still be refreshed');
    assert.match(result, /Known priorities for PROJ: Highest/);
  });
});
