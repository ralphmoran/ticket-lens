import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runTicketSearch, runTicketSearchQuery, SEARCH_RESULT_CAP } from '../lib/ticket-search.mjs';

const COMPLEX_JQL = 'project = PROJ AND (text ~ "PROJ-101" OR text ~ "PROJ-202" OR (text ~ "login" AND text ~ "acme")) ORDER BY created DESC';

function makeStream() {
  const lines = [];
  return { write: (s) => lines.push(s), lines };
}

function ticket(n, overrides = {}) {
  return { key: `PROJ-${n}`, summary: `Ticket number ${n}`, status: 'Open', assignee: 'Dana Lee', ...overrides };
}

function fakeJiraAdapter(searchTickets) {
  return { type: 'jira', searchTickets };
}

function baseDeps({ adapter = fakeJiraAdapter(async () => []), profileOf = () => 'main' } = {}) {
  return {
    configDir: '/fake/config',
    stream: makeStream(),
    resolveConnectionFn: (key, opts) => ({ baseUrl: 'https://jira.example.com', profileName: opts.profileName ?? profileOf(key) }),
    resolveAdapterFn: () => adapter,
  };
}

function capturingAdapter(issues = []) {
  const calls = [];
  const adapter = fakeJiraAdapter(async (jql, opts) => { calls.push({ jql, opts }); return issues; });
  return { adapter, calls };
}

describe('runTicketSearch — raw --jql', () => {
  test('sends a nested AND/OR query with ORDER BY to Jira byte-for-byte', async () => {
    const { adapter, calls } = capturingAdapter([ticket(1)]);
    const result = await runTicketSearch([`--jql=${COMPLEX_JQL}`], baseDeps({ adapter }));
    assert.equal(result.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].jql, COMPLEX_JQL);
  });

  test('asks Jira for one more than the cap so truncation is detectable', async () => {
    const { adapter, calls } = capturingAdapter();
    await runTicketSearch([`--jql=${COMPLEX_JQL}`], baseDeps({ adapter }));
    assert.equal(calls[0].opts.maxResults, SEARCH_RESULT_CAP + 1);
  });

  test('refuses --jql combined with plain terms', async () => {
    const deps = baseDeps();
    const result = await runTicketSearch(['xss', `--jql=${COMPLEX_JQL}`], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /either/i);
  });

  test('refuses --jql combined with --project', async () => {
    const deps = baseDeps();
    const result = await runTicketSearch([`--jql=${COMPLEX_JQL}`, '--project=PROJ'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /--project/);
  });

  test('refuses an empty --jql', async () => {
    const deps = baseDeps();
    const result = await runTicketSearch(['--jql='], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Usage/);
  });
});

describe('runTicketSearch — plain terms', () => {
  test('builds a project-scoped text query ordered by recency', async () => {
    const { adapter, calls } = capturingAdapter();
    await runTicketSearch(['xss', '--project=PROJ,CORE'], baseDeps({ adapter }));
    assert.equal(calls[0].jql, 'project in ("PROJ", "CORE") AND text ~ "xss" ORDER BY updated DESC');
  });

  test('requires every term to match', async () => {
    const { adapter, calls } = capturingAdapter();
    await runTicketSearch(['login', 'acme'], baseDeps({ adapter }));
    assert.equal(calls[0].jql, 'text ~ "login" AND text ~ "acme" ORDER BY updated DESC');
  });

  test('escapes quotes and backslashes in a term', async () => {
    const { adapter, calls } = capturingAdapter();
    await runTicketSearch(['a"b\\c'], baseDeps({ adapter }));
    assert.equal(calls[0].jql, 'text ~ "a\\"b\\\\c" ORDER BY updated DESC');
  });

  test('refuses a project key that could break out of the query', async () => {
    const deps = baseDeps();
    const result = await runTicketSearch(['xss', '--project=PROJ" OR 1=1'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /project key/i);
  });

  test('refuses a call with no terms and no --jql', async () => {
    const deps = baseDeps();
    const result = await runTicketSearch([], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Usage/);
  });

  test('refuses projects that live on different profiles', async () => {
    const deps = baseDeps({ profileOf: (key) => (key.startsWith('CORE') ? 'other' : 'main') });
    const result = await runTicketSearch(['xss', '--project=PROJ,CORE'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /--profile/);
  });
});

describe('runTicketSearch — tracker and connection', () => {
  test('refuses a non-Jira tracker', async () => {
    const deps = baseDeps({ adapter: { type: 'github', searchTickets: async () => [] } });
    const result = await runTicketSearch(['xss'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Jira only/);
  });

  test('reports a missing connection', async () => {
    const deps = { ...baseDeps(), resolveConnectionFn: () => ({ baseUrl: null }) };
    const result = await runTicketSearch(['xss'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /No connection configured/);
  });
});

describe('runTicketSearch — output', () => {
  test('prints key, status, assignee and summary per ticket', async () => {
    const deps = baseDeps({ adapter: fakeJiraAdapter(async () => [ticket(7)]) });
    const result = await runTicketSearch(['xss'], deps);
    const out = deps.stream.lines.join('');
    assert.equal(result.results.length, 1);
    assert.match(out, /PROJ-7/);
    assert.match(out, /Open/);
    assert.match(out, /Dana Lee/);
    assert.match(out, /Ticket number 7/);
  });

  test('says so when nothing matches', async () => {
    const deps = baseDeps();
    const result = await runTicketSearch(['xss'], deps);
    assert.equal(result.ok, true);
    assert.deepEqual(result.results, []);
    assert.match(deps.stream.lines.join(''), /No tickets matched/);
  });

  test('prints only the cap and warns when Jira returned more', async () => {
    const many = Array.from({ length: SEARCH_RESULT_CAP + 1 }, (_, i) => ticket(i + 1));
    const deps = baseDeps({ adapter: fakeJiraAdapter(async () => many) });
    const result = await runTicketSearch(['xss'], deps);
    assert.equal(result.results.length, SEARCH_RESULT_CAP);
    assert.doesNotMatch(deps.stream.lines.join(''), new RegExp(`PROJ-${SEARCH_RESULT_CAP + 1}\\b`));
    assert.match(deps.stream.lines.join(''), /more match/i);
  });

  test('a hostile summary cannot forge a line or inject escapes', async () => {
    const hostile = ticket(3, { summary: 'real\n  PROJ-999  [Done]  forged\u001b[31m' });
    const deps = baseDeps({ adapter: fakeJiraAdapter(async () => [hostile]) });
    await runTicketSearch(['xss'], deps);
    const out = deps.stream.lines.join('');
    assert.doesNotMatch(out, /\u001b/);
    assert.equal(out.split('\n').filter(l => l.includes('PROJ-999')).length, 1);
    assert.equal(out.split('\n').filter(l => /^\s+PROJ-999/.test(l)).length, 0);
  });

  test('shows Jira\'s own error text when the query is rejected', async () => {
    const err = Object.assign(new Error('Jira API error 400 searching tickets'), { status: 400, detail: "Field 'bogus' does not exist" });
    const deps = baseDeps({ adapter: fakeJiraAdapter(async () => { throw err; }) });
    const result = await runTicketSearch(['--jql=bogus = 1'], deps);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /Field 'bogus' does not exist/);
  });
});

describe('runTicketSearchQuery — structured entry for MCP', () => {
  test('a term that looks like a flag stays a term', async () => {
    const { adapter, calls } = capturingAdapter();
    await runTicketSearchQuery({ terms: ['--jql=project = SECRET'] }, baseDeps({ adapter }));
    assert.equal(calls[0].jql, 'text ~ "--jql=project = SECRET" ORDER BY updated DESC');
  });

  test('passes a jql string through untouched', async () => {
    const { adapter, calls } = capturingAdapter();
    await runTicketSearchQuery({ jql: COMPLEX_JQL }, baseDeps({ adapter }));
    assert.equal(calls[0].jql, COMPLEX_JQL);
  });
});

describe('runTicketSearch — argument parsing (review M1)', () => {
  test('accepts the space form of --project', async () => {
    const { adapter, calls } = capturingAdapter();
    await runTicketSearch(['--project', 'PROJ', 'xss'], baseDeps({ adapter }));
    assert.equal(calls[0].jql, 'project in ("PROJ") AND text ~ "xss" ORDER BY updated DESC');
  });

  test('accepts the space form of --jql', async () => {
    const { adapter, calls } = capturingAdapter();
    await runTicketSearch(['--jql', COMPLEX_JQL], baseDeps({ adapter }));
    assert.equal(calls[0].jql, COMPLEX_JQL);
  });

  test('rejects an unknown option instead of dropping it', async () => {
    const { adapter, calls } = capturingAdapter();
    const deps = baseDeps({ adapter });
    const result = await runTicketSearch(['xss', '--projcet=A'], deps);
    assert.equal(result.ok, false);
    assert.equal(calls.length, 0);
    assert.match(deps.stream.lines.join(''), /Unknown option/);
  });

  test('rejects a flag that is missing its value', async () => {
    const deps = baseDeps();
    const result = await runTicketSearch(['xss', '--project'], deps);
    assert.equal(result.ok, false);
  });
});

describe('runTicketSearchQuery — blank input (review M2)', () => {
  test('a blank jql beside real terms is treated as absent', async () => {
    const { adapter, calls } = capturingAdapter();
    await runTicketSearchQuery({ jql: '  ', terms: ['xss'] }, baseDeps({ adapter }));
    assert.equal(calls[0].jql, 'text ~ "xss" ORDER BY updated DESC');
  });

  test('blank terms are dropped, and all-blank terms are refused', async () => {
    const { adapter, calls } = capturingAdapter();
    await runTicketSearchQuery({ terms: ['', ' xss '] }, baseDeps({ adapter }));
    assert.equal(calls[0].jql, 'text ~ "xss" ORDER BY updated DESC');
    const deps = baseDeps({ adapter });
    const result = await runTicketSearchQuery({ terms: ['', '  '] }, deps);
    assert.equal(result.ok, false);
    assert.equal(calls.length, 1);
  });
});

describe('runTicketSearch — failure wording (review M4)', () => {
  test('a network failure is not reported as a rejected query', async () => {
    const deps = baseDeps({ adapter: fakeJiraAdapter(async () => { throw new Error('The operation was aborted due to timeout'); }) });
    const result = await runTicketSearch(['xss'], deps);
    const out = deps.stream.lines.join('');
    assert.equal(result.ok, false);
    assert.match(out, /Search failed/);
    assert.match(out, /timeout/);
    assert.doesNotMatch(out, /rejected/);
  });

  test('a 401 is not reported as a rejected query', async () => {
    const err = Object.assign(new Error('Jira API error 401 searching tickets'), { status: 401, detail: '' });
    const deps = baseDeps({ adapter: fakeJiraAdapter(async () => { throw err; }) });
    await runTicketSearch(['xss'], deps);
    assert.doesNotMatch(deps.stream.lines.join(''), /rejected/);
  });
});

describe('runTicketSearch — which site answered (review M5)', () => {
  test('names the Jira site in the output', async () => {
    const deps = baseDeps({ adapter: fakeJiraAdapter(async () => [ticket(1)]) });
    await runTicketSearch(['xss'], deps);
    assert.match(deps.stream.lines.join(''), /jira\.example\.com/);
  });

  test('passes --profile to connection resolution', async () => {
    const seen = [];
    const deps = { ...baseDeps(), resolveConnectionFn: (key, opts) => { seen.push({ key, profileName: opts.profileName }); return { baseUrl: 'https://jira.example.com' }; } };
    await runTicketSearch(['xss', '--profile=work'], deps);
    assert.equal(seen[0].profileName, 'work');
  });

  test('routes by the first project key', async () => {
    const seen = [];
    const deps = { ...baseDeps(), resolveConnectionFn: (key) => { seen.push(key); return { baseUrl: 'https://jira.example.com' }; } };
    await runTicketSearch(['xss', '--project=PROJ'], deps);
    assert.equal(seen[0], 'PROJ-1');
  });
});
