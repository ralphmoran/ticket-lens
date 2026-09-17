import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runIssueTypes } from '../lib/run-issue-types.mjs';

function makeOutput() {
  const lines = [];
  return { write: (s) => lines.push(s), lines };
}

function jiraConn(overrides = {}) {
  return { baseUrl: 'https://acme.atlassian.net', profileName: 'default', ...overrides };
}

function jiraAdapter({ projects = [{ key: 'PROD', name: 'Product' }], typesByProject = {} } = {}) {
  return {
    type: 'jira',
    listCreatableProjects: async () => projects,
    listIssueTypes: async (key) => typesByProject[key] ?? [{ id: '1', name: 'Task' }, { id: '2', name: 'Bug' }],
  };
}

function baseOpts(overrides = {}) {
  const print = makeOutput();
  const warn = makeOutput();
  return {
    print: print.write,
    warn: warn.write,
    configDir: '/fake/config',
    resolveConnectionFn: () => jiraConn(),
    resolveAdapterFn: () => jiraAdapter(),
    readMetadataCacheFn: () => null,
    writeMetadataCacheFn: () => {},
    _print: print,
    _warn: warn,
    ...overrides,
  };
}

describe('runIssueTypes — --help', () => {
  test('exits without touching the network', async () => {
    let calls = 0;
    const opts = baseOpts({ resolveConnectionFn: () => { calls++; return jiraConn(); } });
    await runIssueTypes(['--help'], opts);
    assert.equal(calls, 0);
  });
});

describe('runIssueTypes — arg validation', () => {
  test('an unknown flag exits non-zero and never resolves a connection', async () => {
    let calls = 0;
    const opts = baseOpts({ resolveConnectionFn: () => { calls++; return jiraConn(); } });
    await runIssueTypes(['--bogus'], opts);
    assert.equal(process.exitCode, 1);
    assert.equal(calls, 0);
    process.exitCode = 0;
  });

  test('an invalid --format is rejected before resolving a connection', async () => {
    let calls = 0;
    const opts = baseOpts({ resolveConnectionFn: () => { calls++; return jiraConn(); } });
    await runIssueTypes(['--format=xml'], opts);
    assert.equal(process.exitCode, 1);
    assert.equal(calls, 0);
    process.exitCode = 0;
  });
});

describe('runIssueTypes — connection resolution', () => {
  test('no connection configured warns and exits non-zero', async () => {
    const opts = baseOpts({ resolveConnectionFn: () => ({ baseUrl: null }) });
    const result = await runIssueTypes([], opts);
    assert.equal(result.ok, false);
    assert.equal(process.exitCode, 1);
    assert.match(opts._warn.lines.join(''), /No connection configured/);
    process.exitCode = 0;
  });

  test('--profile is passed through to resolveConnectionFn', async () => {
    let capturedProfile;
    const opts = baseOpts({
      resolveConnectionFn: (ticketKey, o) => { capturedProfile = o.profileName; return jiraConn(); },
    });
    await runIssueTypes(['--profile=myteam'], opts);
    assert.equal(capturedProfile, 'myteam');
  });
});

describe('runIssueTypes — non-Jira trackers are rejected with a clear message', () => {
  test('a Linear connection warns and exits non-zero without calling any adapter method', async () => {
    let listCalls = 0;
    const opts = baseOpts({
      resolveAdapterFn: () => ({
        type: 'linear',
        listCreatableProjects: async () => { listCalls++; return []; },
      }),
    });
    const result = await runIssueTypes([], opts);
    assert.equal(result.ok, false);
    assert.equal(listCalls, 0);
    assert.match(opts._warn.lines.join(''), /not available.*linear/i);
    process.exitCode = 0;
  });

  test('a GitHub connection warns and exits non-zero', async () => {
    const opts = baseOpts({ resolveAdapterFn: () => ({ type: 'github' }) });
    const result = await runIssueTypes([], opts);
    assert.equal(result.ok, false);
    assert.match(opts._warn.lines.join(''), /not available.*github/i);
    process.exitCode = 0;
  });
});

describe('runIssueTypes — live fetch (no usable cache)', () => {
  test('fetches every creatable project and its issue types, then writes the cache', async () => {
    let written;
    const opts = baseOpts({
      resolveAdapterFn: () => jiraAdapter({ projects: [{ key: 'PROD', name: 'Product' }, { key: 'INFRA', name: 'Infra' }] }),
      writeMetadataCacheFn: (profileName, data) => { written = { profileName, data }; },
    });
    const result = await runIssueTypes([], opts);
    assert.equal(result.ok, true);
    assert.equal(written.profileName, 'default');
    assert.deepEqual(written.data.projects.map(p => p.key), ['PROD', 'INFRA']);
    assert.deepEqual(written.data.issueTypesByProject.PROD.map(t => t.name), ['Task', 'Bug']);
    assert.deepEqual(written.data.issueTypesByProject.INFRA.map(t => t.name), ['Task', 'Bug']);
  });

  test('renders a plain-text table with project keys and comma-joined type names', async () => {
    const opts = baseOpts();
    await runIssueTypes([], opts);
    const output = opts._print.lines.join('');
    assert.match(output, /PROD/);
    assert.match(output, /Task, Bug/);
  });

  test('--format=json prints projects, issueTypesByProject, and fetchedAt', async () => {
    const opts = baseOpts();
    await runIssueTypes(['--format=json'], opts);
    const parsed = JSON.parse(opts._print.lines.join(''));
    assert.deepEqual(parsed.projects, [{ key: 'PROD', name: 'Product' }]);
    assert.deepEqual(parsed.issueTypesByProject.PROD.map(t => t.name), ['Task', 'Bug']);
    assert.ok(parsed.fetchedAt);
    assert.equal(parsed.cached, false);
  });

  test('a fetch error warns, exits non-zero, and never writes the cache', async () => {
    let writeCalls = 0;
    const opts = baseOpts({
      resolveAdapterFn: () => ({
        type: 'jira',
        listCreatableProjects: async () => { throw new Error('network timeout'); },
      }),
      writeMetadataCacheFn: () => { writeCalls++; },
    });
    const result = await runIssueTypes([], opts);
    assert.equal(result.ok, false);
    assert.equal(writeCalls, 0);
    assert.match(opts._warn.lines.join(''), /network timeout/);
    process.exitCode = 0;
  });
});

describe('runIssueTypes — cache reuse', () => {
  function completeCache() {
    const now = new Date().toISOString();
    return {
      projects: [{ key: 'PROD', name: 'Product' }],
      issueTypesByProject: { PROD: [{ id: '1', name: 'Task' }] },
      issueTypesFetchedAt: { PROD: now },
      projectsFetchedAt: now,
      fetchedAt: now,
    };
  }

  test('a complete, fresh cache is used without calling any adapter method', async () => {
    let listCalls = 0;
    const opts = baseOpts({
      readMetadataCacheFn: () => completeCache(),
      resolveAdapterFn: () => ({
        type: 'jira',
        listCreatableProjects: async () => { listCalls++; return []; },
        listIssueTypes: async () => { listCalls++; return []; },
      }),
    });
    const result = await runIssueTypes([], opts);
    assert.equal(result.ok, true);
    assert.equal(listCalls, 0);
    assert.match(opts._print.lines.join(''), /PROD/);
  });

  test('a cache written before issueTypesFetchedAt/projectsFetchedAt existed (old schema) is treated as stale, not complete', async () => {
    // Migration safety: a file from before this feature has neither field.
    // isFresh(undefined, ...) is false, so this must trigger a live fetch
    // rather than silently reusing possibly-ancient data forever.
    let listCalls = 0;
    const opts = baseOpts({
      readMetadataCacheFn: () => ({
        projects: [{ key: 'PROD', name: 'Product' }],
        issueTypesByProject: { PROD: [{ id: '1', name: 'Task' }] },
        fetchedAt: '2026-08-01T00:00:00.000Z',
      }),
      resolveAdapterFn: () => ({
        type: 'jira',
        listCreatableProjects: async () => { listCalls++; return [{ key: 'PROD', name: 'Product' }]; },
        listIssueTypes: async () => { listCalls++; return [{ id: '1', name: 'Task' }]; },
      }),
    });
    await runIssueTypes([], opts);
    assert.ok(listCalls > 0);
  });

  test('--refresh forces a live fetch even when a complete cache exists', async () => {
    let listCalls = 0;
    const opts = baseOpts({
      readMetadataCacheFn: () => completeCache(),
      resolveAdapterFn: () => ({
        type: 'jira',
        listCreatableProjects: async () => { listCalls++; return [{ key: 'PROD', name: 'Product' }]; },
        listIssueTypes: async () => { listCalls++; return [{ id: '1', name: 'Task' }]; },
      }),
    });
    await runIssueTypes(['--refresh'], opts);
    assert.equal(listCalls, 2);
  });

  test('a partial cache (a listed project with no recorded issue types) is treated as incomplete and triggers a live fetch', async () => {
    // Can happen when the only prior write came from the reactive
    // ticket_create failure path (ticket-create-enrichment.mjs), which only
    // ever populates one project at a time — never a reason to show a table
    // that silently omits the rest of the profile's projects.
    let listCalls = 0;
    const now = new Date().toISOString();
    const opts = baseOpts({
      readMetadataCacheFn: () => ({
        projects: [{ key: 'PROD', name: 'Product' }, { key: 'INFRA', name: 'Infra' }],
        issueTypesByProject: { PROD: [{ id: '1', name: 'Task' }] }, // INFRA missing
        issueTypesFetchedAt: { PROD: now },
        projectsFetchedAt: now,
        fetchedAt: now,
      }),
      resolveAdapterFn: () => ({
        type: 'jira',
        listCreatableProjects: async () => { listCalls++; return [{ key: 'PROD', name: 'Product' }, { key: 'INFRA', name: 'Infra' }]; },
        listIssueTypes: async () => { listCalls++; return [{ id: '1', name: 'Task' }]; },
      }),
    });
    await runIssueTypes([], opts);
    assert.ok(listCalls > 0);
  });

  test('a project whose issue-types entry is older than 7 days is treated as incomplete, even if the file itself survived GC', async () => {
    let listCalls = 0;
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const now = new Date().toISOString();
    const opts = baseOpts({
      readMetadataCacheFn: () => ({
        projects: [{ key: 'PROD', name: 'Product' }],
        issueTypesByProject: { PROD: [{ id: '1', name: 'Task' }] },
        issueTypesFetchedAt: { PROD: eightDaysAgo },
        projectsFetchedAt: now,
        fetchedAt: now,
      }),
      resolveAdapterFn: () => ({
        type: 'jira',
        listCreatableProjects: async () => { listCalls++; return [{ key: 'PROD', name: 'Product' }]; },
        listIssueTypes: async () => { listCalls++; return [{ id: '1', name: 'Task' }]; },
      }),
    });
    await runIssueTypes([], opts);
    assert.ok(listCalls > 0);
  });
});

describe('runIssueTypes — --project=KEY (single-project lookup)', () => {
  test('skips the full project scan and only fetches the one project', async () => {
    let scanCalls = 0;
    let requestedKey;
    const opts = baseOpts({
      readMetadataCacheFn: () => null,
      resolveAdapterFn: () => ({
        type: 'jira',
        listCreatableProjects: async () => { scanCalls++; return []; },
        listIssueTypes: async (key) => { requestedKey = key; return [{ id: '1', name: 'Bug' }]; },
      }),
    });
    const result = await runIssueTypes(['--project=PROD'], opts);
    assert.equal(result.ok, true);
    assert.equal(scanCalls, 0);
    assert.equal(requestedKey, 'PROD');
  });

  test('renders a single-row table for just that project', async () => {
    const opts = baseOpts({
      readMetadataCacheFn: () => null,
      resolveAdapterFn: () => ({
        type: 'jira',
        listCreatableProjects: async () => [],
        listIssueTypes: async () => [{ id: '1', name: 'Bug' }, { id: '2', name: 'Story' }],
      }),
    });
    await runIssueTypes(['--project=PROD'], opts);
    const output = opts._print.lines.join('');
    assert.match(output, /PROD/);
    assert.match(output, /Bug, Story/);
    assert.match(output, /3 days/);
  });

  test('merge-writes just this project into the cache, preserving existing entries untouched', async () => {
    let written;
    const now = new Date().toISOString();
    const opts = baseOpts({
      readMetadataCacheFn: () => ({
        projects: [{ key: 'OTHER', name: 'Other' }],
        issueTypesByProject: { OTHER: [{ id: '9', name: 'Epic' }] },
        issueTypesFetchedAt: { OTHER: now },
        projectsFetchedAt: now,
        fetchedAt: now,
      }),
      resolveAdapterFn: () => ({
        type: 'jira',
        listCreatableProjects: async () => [],
        listIssueTypes: async () => [{ id: '1', name: 'Bug' }],
      }),
      writeMetadataCacheFn: (profileName, data) => { written = { profileName, data }; },
    });
    await runIssueTypes(['--project=PROD'], opts);
    assert.deepEqual(written.data.issueTypesByProject.OTHER.map(t => t.name), ['Epic'], 'untouched project preserved');
    assert.deepEqual(written.data.issueTypesByProject.PROD.map(t => t.name), ['Bug']);
    assert.ok(written.data.issueTypesFetchedAt.PROD);
    assert.equal(written.data.issueTypesFetchedAt.OTHER, now, 'untouched project timestamp preserved');
  });

  test('a fresh cached entry (within 3 days) is served from cache, no live fetch', async () => {
    let listCalls = 0;
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const opts = baseOpts({
      readMetadataCacheFn: () => ({
        projects: [],
        issueTypesByProject: { PROD: [{ id: '1', name: 'Bug' }] },
        issueTypesFetchedAt: { PROD: oneDayAgo },
        projectsFetchedAt: null,
        fetchedAt: oneDayAgo,
      }),
      resolveAdapterFn: () => ({
        type: 'jira',
        listCreatableProjects: async () => [],
        listIssueTypes: async () => { listCalls++; return []; },
      }),
    });
    const result = await runIssueTypes(['--project=PROD'], opts);
    assert.equal(result.ok, true);
    assert.equal(listCalls, 0);
    assert.match(opts._print.lines.join(''), /Bug/);
  });

  test('a stale cached entry (older than 3 days) triggers a live fetch even though it exists', async () => {
    let listCalls = 0;
    const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
    const opts = baseOpts({
      readMetadataCacheFn: () => ({
        projects: [],
        issueTypesByProject: { PROD: [{ id: '1', name: 'Bug' }] },
        issueTypesFetchedAt: { PROD: fourDaysAgo },
        projectsFetchedAt: null,
        fetchedAt: fourDaysAgo,
      }),
      resolveAdapterFn: () => ({
        type: 'jira',
        listCreatableProjects: async () => [],
        listIssueTypes: async () => { listCalls++; return [{ id: '1', name: 'Bug' }]; },
      }),
    });
    await runIssueTypes(['--project=PROD'], opts);
    assert.equal(listCalls, 1);
  });

  test('--refresh forces a live fetch even when a fresh cached entry exists', async () => {
    let listCalls = 0;
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const opts = baseOpts({
      readMetadataCacheFn: () => ({
        projects: [],
        issueTypesByProject: { PROD: [{ id: '1', name: 'Bug' }] },
        issueTypesFetchedAt: { PROD: oneDayAgo },
        projectsFetchedAt: null,
        fetchedAt: oneDayAgo,
      }),
      resolveAdapterFn: () => ({
        type: 'jira',
        listCreatableProjects: async () => [],
        listIssueTypes: async () => { listCalls++; return [{ id: '1', name: 'Bug' }]; },
      }),
    });
    await runIssueTypes(['--project=PROD', '--refresh'], opts);
    assert.equal(listCalls, 1);
  });

  test('a fetch error for an unknown project warns with the Jira error and never writes the cache', async () => {
    let writeCalls = 0;
    const opts = baseOpts({
      readMetadataCacheFn: () => null,
      resolveAdapterFn: () => ({
        type: 'jira',
        listCreatableProjects: async () => [],
        listIssueTypes: async () => { throw new Error('Jira API error 404 fetching issue types for BADKEY'); },
      }),
      writeMetadataCacheFn: () => { writeCalls++; },
    });
    const result = await runIssueTypes(['--project=BADKEY'], opts);
    assert.equal(result.ok, false);
    assert.equal(process.exitCode, 1);
    assert.equal(writeCalls, 0);
    assert.match(opts._warn.lines.join(''), /404/);
    process.exitCode = 0;
  });

  test('--project= with an empty value is rejected before resolving a connection', async () => {
    let calls = 0;
    const opts = baseOpts({ resolveConnectionFn: () => { calls++; return jiraConn(); } });
    await runIssueTypes(['--project='], opts);
    assert.equal(process.exitCode, 1);
    assert.equal(calls, 0);
    process.exitCode = 0;
  });

  test('--project=KEY with --format=json returns a single-entry projects array with name: null', async () => {
    const opts = baseOpts({
      readMetadataCacheFn: () => null,
      resolveAdapterFn: () => ({
        type: 'jira',
        listCreatableProjects: async () => [],
        listIssueTypes: async () => [{ id: '1', name: 'Bug' }],
      }),
    });
    await runIssueTypes(['--project=PROD', '--format=json'], opts);
    const parsed = JSON.parse(opts._print.lines.join(''));
    assert.deepEqual(parsed.projects, [{ key: 'PROD', name: null }]);
    assert.deepEqual(parsed.issueTypesByProject.PROD.map(t => t.name), ['Bug']);
    assert.equal(parsed.cached, false);
  });
});
