import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createJiraAdapter } from '../lib/adapters/jira-adapter.mjs';

const CONN = {
  baseUrl: 'https://jira.example.com',
  auth: 'pat',
  pat: 'tok',
};

const privateLookup = async () => [{ address: '10.61.20.32', family: 4 }];

function jsonFetcher(body = {}) {
  return async () => ({ ok: true, status: 200, json: async () => body });
}

describe('createJiraAdapter — allowPrivateIp threading (VPN-gated on-prem Jira trust exception)', () => {
  it('threads conn.allowPrivateIp into fetchCurrentUser', async () => {
    const adapter = createJiraAdapter({ ...CONN, allowPrivateIp: true }, { fetcher: jsonFetcher({ accountId: 'x' }) });
    await assert.doesNotReject(() => adapter.fetchCurrentUser({ lookup: privateLookup }));
  });

  it('threads conn.allowPrivateIp into fetchTicket', async () => {
    const adapter = createJiraAdapter({ ...CONN, allowPrivateIp: true }, {
      fetcher: jsonFetcher({ key: 'TEST-1', fields: { summary: 'x', status: { name: 'Open' }, issuetype: { name: 'Bug' } } }),
    });
    await assert.doesNotReject(() => adapter.fetchTicket('TEST-1', { lookup: privateLookup }));
  });

  it('threads conn.allowPrivateIp into searchTickets', async () => {
    const adapter = createJiraAdapter({ ...CONN, allowPrivateIp: true }, { fetcher: jsonFetcher({ issues: [] }) });
    await assert.doesNotReject(() => adapter.searchTickets('project = TEST', { lookup: privateLookup }));
  });

  it('threads conn.allowPrivateIp into fetchStatuses', async () => {
    const adapter = createJiraAdapter({ ...CONN, allowPrivateIp: true }, { fetcher: jsonFetcher([]) });
    await assert.doesNotReject(() => adapter.fetchStatuses({ lookup: privateLookup }));
  });

  it('still blocks a private-IP-resolving host by default when conn.allowPrivateIp is unset (regression)', async () => {
    const adapter = createJiraAdapter({ ...CONN }, { fetcher: jsonFetcher({ accountId: 'x' }) });
    await assert.rejects(() => adapter.fetchCurrentUser({ lookup: privateLookup }), /blocked address/);
  });

  it('threads conn.allowPrivateIp into addComment', async () => {
    const adapter = createJiraAdapter({ ...CONN, allowPrivateIp: true }, { fetcher: jsonFetcher({ id: '10', self: 'x' }) });
    await assert.doesNotReject(() => adapter.addComment('TEST-1', 'hi', { lookup: privateLookup }));
  });

  it('threads conn.allowPrivateIp into getTransitions', async () => {
    const adapter = createJiraAdapter({ ...CONN, allowPrivateIp: true }, { fetcher: jsonFetcher({ transitions: [] }) });
    await assert.doesNotReject(() => adapter.getTransitions('TEST-1', { lookup: privateLookup }));
  });

  it('threads conn.allowPrivateIp into transition', async () => {
    let calls = 0;
    const fetcher = async (_url, opts) => {
      calls += 1;
      if (calls === 1) return { ok: true, status: 200, json: async () => ({ transitions: [{ id: '5', name: 'Done', to: { name: 'Done' } }] }) };
      return { ok: true, status: 204, json: async () => ({}) };
    };
    const adapter = createJiraAdapter({ ...CONN, allowPrivateIp: true }, { fetcher });
    await assert.doesNotReject(() => adapter.transition('TEST-1', 'Done', { lookup: privateLookup }));
  });
});

describe('createJiraAdapter — addComment', () => {
  it('delegates to postComment with the bound env/apiVersion', async () => {
    let captured;
    const fetcher = async (url, opts) => { captured = { url, opts }; return { ok: true, status: 200, json: async () => ({ id: '99', self: 'https://jira.example.com/rest/api/2/issue/10/comment/99' }) }; };
    const adapter = createJiraAdapter(CONN, { fetcher });
    const result = await adapter.addComment('TEST-1', 'a plain comment');
    assert.match(captured.url, /\/issue\/TEST-1\/comment$/);
    assert.equal(result.id, '99');
  });
});

describe('createJiraAdapter — getTransitions', () => {
  it('returns the normalized transitions list', async () => {
    const adapter = createJiraAdapter(CONN, { fetcher: jsonFetcher({ transitions: [{ id: '11', name: 'Start', to: { name: 'In Progress' } }] }) });
    const options = await adapter.getTransitions('TEST-1');
    assert.deepEqual(options, [{ id: '11', name: 'Start', to: 'In Progress' }]);
  });
});

describe('createJiraAdapter — transition', () => {
  it('resolves target by name against fresh discovery, then executes', async () => {
    const calls = [];
    const fetcher = async (url, opts) => {
      calls.push({ url, method: opts.method ?? 'GET', body: opts.body });
      if (!opts.method) return { ok: true, status: 200, json: async () => ({ transitions: [{ id: '21', name: 'Close Issue', to: { name: 'Closed' } }] }) };
      return { ok: true, status: 204, json: async () => ({}) };
    };
    const adapter = createJiraAdapter(CONN, { fetcher });
    const result = await adapter.transition('TEST-1', 'closed');
    assert.equal(result.executed, true);
    assert.equal(result.to, 'Closed');
    assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(calls[1].body), { transition: { id: '21' } });
  });

  it('returns executed:false with options when target does not match any current transition', async () => {
    const adapter = createJiraAdapter(CONN, { fetcher: jsonFetcher({ transitions: [{ id: '21', name: 'Close Issue', to: { name: 'Closed' } }] }) });
    const result = await adapter.transition('TEST-1', 'nonexistent-status');
    assert.equal(result.executed, false);
    assert.equal(result.reason, 'not-found');
    assert.equal(result.options.length, 1);
  });

  it('never POSTs when the target does not resolve (no accidental mutation on bad input)', async () => {
    let postCalled = false;
    const fetcher = async (_url, opts) => {
      if (opts.method === 'POST') postCalled = true;
      return { ok: true, status: 200, json: async () => ({ transitions: [{ id: '21', name: 'Close Issue', to: { name: 'Closed' } }] }) };
    };
    const adapter = createJiraAdapter(CONN, { fetcher });
    await adapter.transition('TEST-1', 'nope');
    assert.equal(postCalled, false);
  });
});

describe('createJiraAdapter — assignToSelf', () => {
  it('uses accountId for Cloud (apiVersion 3)', async () => {
    let captured;
    const fetcher = async (url, opts) => {
      captured = { url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined };
      if (!opts.method) return { ok: true, status: 200, json: async () => ({ accountId: 'acc-1', name: null, displayName: 'Alice', emailAddress: 'a@x.com' }) };
      return { ok: true, status: 204 };
    };
    const adapter = createJiraAdapter({ ...CONN, auth: 'cloud' }, { fetcher });
    const result = await adapter.assignToSelf('TEST-1');
    assert.deepEqual(captured.body, { accountId: 'acc-1' });
    assert.match(captured.url, /\/assignee$/);
    assert.equal(result.assignee, 'Alice');
  });

  it('uses name for Server/DC (apiVersion 2)', async () => {
    let captured;
    const fetcher = async (url, opts) => {
      captured = { body: opts.body ? JSON.parse(opts.body) : undefined };
      if (!opts.method) return { ok: true, status: 200, json: async () => ({ accountId: null, name: 'jdoe', displayName: 'John Doe', emailAddress: null }) };
      return { ok: true, status: 204 };
    };
    const adapter = createJiraAdapter(CONN, { fetcher });
    await adapter.assignToSelf('TEST-1');
    assert.deepEqual(captured.body, { name: 'jdoe' });
  });

  it('refuses to assign when accountId is null on Cloud (apiVersion 3) — never sends a null identity that Jira would treat as unassign', async () => {
    let putCalled = false;
    const fetcher = async (_url, opts) => {
      if (opts.method === 'PUT') putCalled = true;
      if (!opts.method) return { ok: true, status: 200, json: async () => ({ accountId: null, name: null, displayName: 'Alice', emailAddress: null }) };
      return { ok: true, status: 204 };
    };
    const adapter = createJiraAdapter({ ...CONN, auth: 'cloud' }, { fetcher });
    await assert.rejects(() => adapter.assignToSelf('TEST-1'), /accountId/);
    assert.equal(putCalled, false);
  });

  it('refuses to assign when name is null on Server/DC (apiVersion 2) — never sends a null identity that Jira would treat as unassign', async () => {
    let putCalled = false;
    const fetcher = async (_url, opts) => {
      if (opts.method === 'PUT') putCalled = true;
      if (!opts.method) return { ok: true, status: 200, json: async () => ({ accountId: null, name: null, displayName: 'Alice', emailAddress: null }) };
      return { ok: true, status: 204 };
    };
    const adapter = createJiraAdapter(CONN, { fetcher });
    await assert.rejects(() => adapter.assignToSelf('TEST-1'), /name/);
    assert.equal(putCalled, false);
  });

  it('threads conn.allowPrivateIp into assignToSelf', async () => {
    const fetcher = async (_url, opts) => {
      if (!opts.method) return { ok: true, status: 200, json: async () => ({ accountId: null, name: 'jdoe' }) };
      return { ok: true, status: 204 };
    };
    const adapter = createJiraAdapter({ ...CONN, allowPrivateIp: true }, { fetcher });
    await assert.doesNotReject(() => adapter.assignToSelf('TEST-1', { lookup: privateLookup }));
  });
});

describe('findCandidates — duplicate-detection candidate search', () => {
  it('scopes the JQL to the ticket key\'s project and excludes the source key itself', async () => {
    let capturedUrl;
    const fetcher = async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ issues: [] }) };
    };
    const adapter = createJiraAdapter(CONN, { fetcher });
    await adapter.findCandidates('login button broken', 'TEST-42');
    const jql = decodeURIComponent(new URL(capturedUrl).searchParams.get('jql'));
    assert.match(jql, /project = "TEST"/);
    assert.match(jql, /key != "TEST-42"/);
    assert.match(jql, /text ~ "login button broken"/);
  });

  it('caps the search text before building the JQL so a long description cannot blow past URL/proxy length limits', async () => {
    let capturedUrl;
    const fetcher = async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ issues: [] }) };
    };
    const adapter = createJiraAdapter(CONN, { fetcher });
    const longText = 'x'.repeat(2000);
    await adapter.findCandidates(longText, 'TEST-1');
    const jql = decodeURIComponent(new URL(capturedUrl).searchParams.get('jql'));
    const match = jql.match(/text ~ "(x+)"/);
    assert.ok(match, 'expected a text ~ "..." clause');
    assert.ok(match[1].length <= 300, `search text should be capped, got ${match[1].length} chars`);
  });

  it('escapes double quotes in the search text so a crafted title cannot break out of the JQL string literal', async () => {
    let capturedUrl;
    const fetcher = async (url) => {
      capturedUrl = url;
      return { ok: true, status: 200, json: async () => ({ issues: [] }) };
    };
    const adapter = createJiraAdapter(CONN, { fetcher });
    await adapter.findCandidates('a" OR project = "OTHER', 'TEST-1');
    const jql = decodeURIComponent(new URL(capturedUrl).searchParams.get('jql'));
    assert.match(jql, /text ~ "a\\" OR project = \\"OTHER"/);
  });

  it('normalizes returned issues to the standard ticket shape', async () => {
    const fetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ issues: [{ key: 'TEST-7', fields: { summary: 'Login broken', status: { name: 'Open' }, issuetype: { name: 'Bug' } } }] }),
    });
    const adapter = createJiraAdapter(CONN, { fetcher });
    const results = await adapter.findCandidates('login', 'TEST-1');
    assert.equal(results[0].key, 'TEST-7');
    assert.equal(results[0].summary, 'Login broken');
  });

  it('threads conn.allowPrivateIp into findCandidates', async () => {
    const adapter = createJiraAdapter({ ...CONN, allowPrivateIp: true }, { fetcher: jsonFetcher({ issues: [] }) });
    await assert.doesNotReject(() => adapter.findCandidates('login', 'TEST-1', { lookup: privateLookup }));
  });

  it('rejects a sourceKey with no hyphen instead of silently deriving a wrong/empty project scope', async () => {
    const adapter = createJiraAdapter(CONN, { fetcher: jsonFetcher({ issues: [] }) });
    await assert.rejects(() => adapter.findCandidates('login', 'NOHYPHEN'), /project/);
  });
});
