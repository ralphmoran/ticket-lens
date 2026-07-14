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
});
