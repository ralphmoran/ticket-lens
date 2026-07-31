import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectProjectOrTypeError, enrichCreateFailure } from '../lib/ticket-create-enrichment.mjs';

function fakeAdapter(overrides = {}) {
  return {
    type: 'jira',
    listCreatableProjects: async () => ([{ key: 'PROJ', name: 'Project' }]),
    listIssueTypes: async () => ([{ id: '1', name: 'Task' }]),
    ...overrides,
  };
}

describe('detectProjectOrTypeError', () => {
  test('detects a Jira project-shaped 400 (err.details.errors.project)', () => {
    const err = Object.assign(new Error('x'), { details: { errors: { project: 'bad' } } });
    assert.deepEqual(detectProjectOrTypeError(err), { project: true, type: false });
  });

  test('detects a Jira issuetype-shaped 400 (err.details.errors.issuetype)', () => {
    const err = Object.assign(new Error('x'), { details: { errors: { issuetype: 'bad' } } });
    assert.deepEqual(detectProjectOrTypeError(err), { project: false, type: true });
  });

  test('detects both simultaneously when both keys are present', () => {
    const err = Object.assign(new Error('x'), { details: { errors: { project: 'bad', issuetype: 'bad' } } });
    assert.deepEqual(detectProjectOrTypeError(err), { project: true, type: true });
  });

  test('detects a Linear PROJECT_NOT_FOUND error via err.code, not by parsing the message', () => {
    const err = Object.assign(new Error('some unrelated message text'), { code: 'PROJECT_NOT_FOUND' });
    assert.deepEqual(detectProjectOrTypeError(err), { project: true, type: false });
  });

  test('returns null for a generic 400 with unrelated error fields', () => {
    const err = Object.assign(new Error('x'), { details: { errors: { summary: 'is required' } } });
    assert.equal(detectProjectOrTypeError(err), null);
  });

  test('returns null for a rate-limited failure (no .details at all)', () => {
    const err = Object.assign(new Error('x'), { rateLimit: { kind: 'secondary-rate-limit', retryAfterSeconds: 30 } });
    assert.equal(detectProjectOrTypeError(err), null);
  });

  test('returns null for a plain network error', () => {
    assert.equal(detectProjectOrTypeError(new Error('fetch failed')), null);
  });
});

describe('enrichCreateFailure', () => {
  test('returns "" for a non-project/type error — no cache read, no adapter calls', async () => {
    let readCalled = false, listCalled = false;
    const err = Object.assign(new Error('x'), { status: 500 });
    const result = await enrichCreateFailure(err, {
      adapter: fakeAdapter({ listCreatableProjects: async () => { listCalled = true; return []; } }),
      project: 'PROJ',
      profileName: 'work',
      configDir: '/fake',
      readMetadataCacheFn: () => { readCalled = true; return null; },
      writeMetadataCacheFn: () => {},
    });
    assert.equal(result, '');
    assert.equal(readCalled, false, 'must not even read the cache for an error shape that will never use it');
    assert.equal(listCalled, false);
  });

  test('returns "" for GitHub, even given a (nonsensical) project-shaped error', async () => {
    let listCalled = false;
    const err = Object.assign(new Error('x'), { details: { errors: { project: 'bad' } } });
    const result = await enrichCreateFailure(err, {
      adapter: fakeAdapter({ type: 'github', listCreatableProjects: async () => { listCalled = true; return []; } }),
      project: 'PROJ',
      profileName: 'work',
      configDir: '/fake',
      readMetadataCacheFn: () => null,
      writeMetadataCacheFn: () => {},
    });
    assert.equal(result, '');
    assert.equal(listCalled, false);
  });

  test('a fresh cache hit for both projects and this project\'s issue types makes zero adapter calls', async () => {
    let anyCalled = false;
    const err = Object.assign(new Error('x'), { details: { errors: { project: 'bad', issuetype: 'bad' } } });
    const result = await enrichCreateFailure(err, {
      adapter: fakeAdapter({
        listCreatableProjects: async () => { anyCalled = true; return []; },
        listIssueTypes: async () => { anyCalled = true; return []; },
      }),
      project: 'PROJ',
      profileName: 'work',
      configDir: '/fake',
      readMetadataCacheFn: () => ({ projects: [{ key: 'PROJ', name: 'x' }], issueTypesByProject: { PROJ: [{ id: '1', name: 'Task' }] } }),
      writeMetadataCacheFn: () => {},
    });
    assert.equal(anyCalled, false);
    assert.match(result, /Known creatable projects: PROJ/);
    assert.match(result, /Known issue types for PROJ: Task/);
  });

  test('when listCreatableProjects succeeds but the sibling listIssueTypes throws, nothing is written to the cache (all-or-nothing, no partial state)', async () => {
    let writeCalled = false;
    const err = Object.assign(new Error('x'), { details: { errors: { project: 'bad', issuetype: 'bad' } } });
    const result = await enrichCreateFailure(err, {
      adapter: fakeAdapter({
        listCreatableProjects: async () => ([{ key: 'PROJ', name: 'x' }]),
        listIssueTypes: async () => { throw new Error('network down mid-refresh'); },
      }),
      project: 'PROJ',
      profileName: 'work',
      configDir: '/fake',
      readMetadataCacheFn: () => null,
      writeMetadataCacheFn: () => { writeCalled = true; },
    });
    assert.equal(result, '', 'the whole enrichment attempt must be discarded, not partially applied');
    assert.equal(writeCalled, false, 'a freshly-fetched projects list must never be persisted alone when its sibling fetch failed');
  });

  test('Linear (no listIssueTypes on the adapter at all) only ever fetches/reports projects, never attempts an issue-type call', async () => {
    let writtenData;
    const err = Object.assign(new Error('x'), { code: 'PROJECT_NOT_FOUND' });
    const result = await enrichCreateFailure(err, {
      adapter: fakeAdapter({ type: 'linear', listCreatableProjects: async () => ([{ key: 'ENG', name: 'Engineering' }]) }),
      project: 'BOGUS',
      profileName: 'linear-team',
      configDir: '/fake',
      readMetadataCacheFn: () => null,
      writeMetadataCacheFn: (profile, data) => { writtenData = data; },
    });
    assert.match(result, /Known creatable projects: ENG/);
    assert.deepEqual(Object.keys(writtenData.issueTypesByProject), []);
  });
});
