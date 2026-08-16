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
    return {
      projects: [{ key: 'PROD', name: 'Product' }],
      issueTypesByProject: { PROD: [{ id: '1', name: 'Task' }] },
      fetchedAt: '2026-08-01T00:00:00.000Z',
    };
  }

  test('a complete cache is used without calling any adapter method', async () => {
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
    const opts = baseOpts({
      readMetadataCacheFn: () => ({
        projects: [{ key: 'PROD', name: 'Product' }, { key: 'INFRA', name: 'Infra' }],
        issueTypesByProject: { PROD: [{ id: '1', name: 'Task' }] }, // INFRA missing
        fetchedAt: '2026-08-01T00:00:00.000Z',
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
});
