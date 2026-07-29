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
