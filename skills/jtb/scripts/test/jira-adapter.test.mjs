import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

describe('createJiraAdapter — getLinkTypes', () => {
  it('returns just the type names — matches GitHub/Linear\'s plain-string shape so runTicketLinkList can render any tracker uniformly', async () => {
    const adapter = createJiraAdapter(CONN, {
      fetcher: jsonFetcher({
        issueLinkTypes: [
          { id: '1000', name: 'Duplicate', inward: 'Duplicated by', outward: 'Duplicates' },
          { id: '1010', name: 'Blocks', inward: 'Blocked by', outward: 'Blocks' },
        ],
      }),
    });
    const types = await adapter.getLinkTypes();
    assert.deepEqual(types, ['Duplicate', 'Blocks']);
  });

  it('threads conn.allowPrivateIp into getLinkTypes', async () => {
    const adapter = createJiraAdapter({ ...CONN, allowPrivateIp: true }, { fetcher: jsonFetcher({ issueLinkTypes: [] }) });
    await assert.doesNotReject(() => adapter.getLinkTypes({ lookup: privateLookup }));
  });
});

describe('createJiraAdapter — linkTo', () => {
  it('resolves the type name against a fresh live list, then POSTs with source as outward, target as inward', async () => {
    const calls = [];
    const fetcher = async (url, opts) => {
      calls.push({ url, method: opts.method, body: opts.body });
      if (!opts.method) return { ok: true, status: 200, json: async () => ({ issueLinkTypes: [{ id: '1000', name: 'Duplicate', inward: 'Duplicated by', outward: 'Duplicates' }] }) };
      return { ok: true, status: 204 };
    };
    const adapter = createJiraAdapter(CONN, { fetcher });
    const result = await adapter.linkTo('TEST-1', 'TEST-2', 'duplicate');
    assert.equal(calls.length, 2);
    assert.deepEqual(JSON.parse(calls[1].body), { type: { name: 'Duplicate' }, outwardIssue: { key: 'TEST-1' }, inwardIssue: { key: 'TEST-2' } });
    assert.match(calls[1].url, /\/issueLink$/);
    assert.deepEqual(result, { executed: true });
  });

  it('never trusts a caller-supplied type without confirming it against the fresh list — returns executed:false with options, no POST sent', async () => {
    let postCalled = false;
    const fetcher = async (_url, opts) => {
      if (opts.method === 'POST') postCalled = true;
      return { ok: true, status: 200, json: async () => ({ issueLinkTypes: [{ id: '1000', name: 'Duplicate', inward: 'Duplicated by', outward: 'Duplicates' }] }) };
    };
    const adapter = createJiraAdapter(CONN, { fetcher });
    const result = await adapter.linkTo('TEST-1', 'TEST-2', 'Bogus Type');
    assert.equal(result.executed, false);
    assert.equal(result.reason, 'not-found');
    assert.deepEqual(result.options, ['Duplicate']);
    assert.equal(postCalled, false);
  });

  it('threads conn.allowPrivateIp into linkTo', async () => {
    const fetcher = async (_url, opts) => {
      if (!opts.method) return { ok: true, status: 200, json: async () => ({ issueLinkTypes: [{ id: '1000', name: 'Duplicate' }] }) };
      return { ok: true, status: 204 };
    };
    const adapter = createJiraAdapter({ ...CONN, allowPrivateIp: true }, { fetcher });
    await assert.doesNotReject(() => adapter.linkTo('TEST-1', 'TEST-2', 'Duplicate', { lookup: privateLookup }));
  });
});

describe('createJiraAdapter — updateFields', () => {
  it('maps title to summary and PUTs fields in one call, reporting every requested field as applied', async () => {
    let captured;
    const fetcher = async (url, opts) => { captured = { url, method: opts.method, body: JSON.parse(opts.body) }; return { ok: true, status: 204 }; };
    const adapter = createJiraAdapter(CONN, { fetcher });
    const result = await adapter.updateFields('TEST-1', { title: 'New title', priority: 'High' });
    assert.deepEqual(captured.body, { fields: { summary: 'New title', priority: { name: 'High' } } });
    assert.match(captured.url, /\/issue\/TEST-1$/);
    assert.deepEqual(result, { applied: { title: true, priority: 'High' }, errors: {} });
  });

  it('reports addLabels/removeLabels back verbatim on success', async () => {
    const adapter = createJiraAdapter(CONN, { fetcher: async () => ({ ok: true, status: 204 }) });
    const result = await adapter.updateFields('TEST-1', { addLabels: ['urgent'], removeLabels: ['stale'] });
    assert.deepEqual(result.applied, { addLabels: ['urgent'], removeLabels: ['stale'] });
  });

  it('propagates a write failure (single atomic PUT — no partial state to report)', async () => {
    const fetcher = async () => ({ ok: false, status: 400, json: async () => ({ errors: { priority: 'invalid' } }) });
    const adapter = createJiraAdapter(CONN, { fetcher });
    await assert.rejects(() => adapter.updateFields('TEST-1', { priority: 'Bogus' }), (err) => err.status === 400);
  });

  it('converts description to ADF on Cloud (apiVersion 3)', async () => {
    let captured;
    const fetcher = async (url, opts) => { captured = JSON.parse(opts.body); return { ok: true, status: 204 }; };
    const adapter = createJiraAdapter({ ...CONN, auth: 'cloud' }, { fetcher });
    await adapter.updateFields('TEST-1', { description: 'Cloud desc.' });
    assert.equal(captured.fields.description.type, 'doc');
  });

  it('threads conn.allowPrivateIp into updateFields', async () => {
    const adapter = createJiraAdapter({ ...CONN, allowPrivateIp: true }, { fetcher: async () => ({ ok: true, status: 204 }) });
    await assert.doesNotReject(() => adapter.updateFields('TEST-1', { title: 'x' }, { lookup: privateLookup }));
  });
});

describe('createJiraAdapter — createTicket', () => {
  it('POSTs project/type/summary and returns the new key/id/url', async () => {
    let captured;
    const fetcher = async (url, opts) => {
      captured = { url, method: opts.method, body: JSON.parse(opts.body) };
      return { ok: true, status: 201, json: async () => ({ id: '10001', key: 'TEST-99', self: 'https://jira.example.com/rest/api/2/issue/10001' }) };
    };
    const adapter = createJiraAdapter(CONN, { fetcher });
    const result = await adapter.createTicket({ project: 'TEST', type: 'Task', summary: 'New one' });
    assert.equal(captured.method, 'POST');
    assert.deepEqual(captured.body, { fields: { project: { key: 'TEST' }, issuetype: { name: 'Task' }, summary: 'New one' } });
    assert.match(captured.url, /\/issue$/);
    assert.deepEqual(result, { key: 'TEST-99', id: '10001', url: 'https://jira.example.com/rest/api/2/issue/10001' });
  });

  it('propagates a validation failure — issuetype is never pre-checked client-side', async () => {
    const fetcher = async () => ({ ok: false, status: 400, json: async () => ({ errors: { issuetype: 'invalid' } }) });
    const adapter = createJiraAdapter(CONN, { fetcher });
    await assert.rejects(() => adapter.createTicket({ project: 'TEST', type: 'Bogus', summary: 'x' }), (err) => err.status === 400);
  });

  it('converts description to ADF on Cloud (apiVersion 3)', async () => {
    let captured;
    const fetcher = async (url, opts) => { captured = JSON.parse(opts.body); return { ok: true, status: 201, json: async () => ({ id: '1', key: 'TEST-1', self: '' }) }; };
    const adapter = createJiraAdapter({ ...CONN, auth: 'cloud' }, { fetcher });
    await adapter.createTicket({ project: 'TEST', type: 'Task', summary: 'x', description: 'Cloud desc.' });
    assert.equal(captured.fields.description.type, 'doc');
  });

  it('threads conn.allowPrivateIp into createTicket', async () => {
    const adapter = createJiraAdapter({ ...CONN, allowPrivateIp: true }, { fetcher: async () => ({ ok: true, status: 201, json: async () => ({ id: '1', key: 'TEST-1', self: '' }) }) });
    await assert.doesNotReject(() => adapter.createTicket({ project: 'TEST', type: 'Task', summary: 'x' }, { lookup: privateLookup }));
  });
});

describe('createJiraAdapter — listCreatableProjects', () => {
  it('wraps fetchProjects unchanged', async () => {
    const fetcher = async () => ({ ok: true, status: 200, json: async () => [{ key: 'TEST', name: 'Test Project' }] });
    const adapter = createJiraAdapter(CONN, { fetcher });
    const result = await adapter.listCreatableProjects();
    assert.deepEqual(result, [{ key: 'TEST', name: 'Test Project' }]);
  });
});

describe('createJiraAdapter — listIssueTypes', () => {
  it('wraps fetchIssueTypes for the given project key', async () => {
    let capturedUrl;
    const fetcher = async (url) => { capturedUrl = url; return { ok: true, status: 200, json: async () => ({ values: [{ id: '1', name: 'Task' }] }) }; };
    const adapter = createJiraAdapter(CONN, { fetcher });
    const result = await adapter.listIssueTypes('TEST');
    assert.match(capturedUrl, /\/createmeta\/TEST\/issuetypes/);
    assert.deepEqual(result, [{ id: '1', name: 'Task' }]);
  });
});

describe('createJiraAdapter — attachFiles', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jtb-jira-attach-test-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  function writeFixture(name, content = 'x') {
    const p = path.join(tmpDir, name);
    fs.writeFileSync(p, content);
    return p;
  }

  it('uploads a file and returns Server/DC (v2) thumbnail markup for an image', async () => {
    const p = writeFixture('screenshot.png', 'fake-bytes');
    const fetcher = async () => ({ ok: true, json: async () => [{ id: '1', filename: 'screenshot.png', size: 10, content: 'https://jira.example.com/secure/attachment/1/screenshot.png' }] });
    const adapter = createJiraAdapter(CONN, { fetcher }); // CONN uses 'pat' auth -> apiVersion 2
    const result = await adapter.attachFiles('TEST-1', [p]);
    assert.equal(result.uploaded.length, 1);
    assert.equal(result.errors.length, 0);
    assert.equal(result.uploaded[0].inlineMarkup, '!screenshot.png|thumbnail!');
  });

  it('resolves a real ADF media node on Cloud (v3) via the content-redirect UUID technique', async () => {
    const p = writeFixture('screenshot.png', 'fake-bytes');
    let call = 0;
    const fetcher = async () => {
      call++;
      if (call === 1) return { ok: true, json: async () => [{ id: '1', filename: 'screenshot.png', size: 10, content: 'https://x/attachment/content/1' }] };
      return { status: 303, headers: { get: (h) => h === 'location' ? 'https://api.media.atlassian.com/file/uuid-abc/binary?token=t' : null } };
    };
    const adapter = createJiraAdapter({ ...CONN, auth: 'cloud' }, { fetcher });
    const result = await adapter.attachFiles('TEST-1', [p]);
    assert.equal(result.uploaded[0].inlineMarkup, null);
    assert.deepEqual(result.uploaded[0].adfMediaNode, {
      type: 'mediaSingle',
      attrs: { layout: 'center' },
      content: [{ type: 'media', attrs: { type: 'file', id: 'uuid-abc', collection: 'TEST-1' } }],
    });
  });

  it('falls back to no adfMediaNode on Cloud when media UUID resolution fails — the classic attachment still succeeded', async () => {
    const p = writeFixture('screenshot.png', 'fake-bytes');
    let call = 0;
    const fetcher = async () => {
      call++;
      if (call === 1) return { ok: true, json: async () => [{ id: '1', filename: 'screenshot.png', size: 10, content: 'https://x/attachment/content/1' }] };
      return { status: 500, headers: { get: () => null } };
    };
    const adapter = createJiraAdapter({ ...CONN, auth: 'cloud' }, { fetcher });
    const result = await adapter.attachFiles('TEST-1', [p]);
    assert.equal(result.errors.length, 0, 'the classic attachment upload succeeded — this is not an error');
    assert.equal(result.uploaded.length, 1);
    assert.equal(result.uploaded[0].adfMediaNode, null);
  });

  it('returns no inline markup for a non-image file even on Server/DC', async () => {
    const p = writeFixture('log.txt', 'plain text');
    const fetcher = async () => ({ ok: true, json: async () => [{ id: '1', filename: 'log.txt', size: 10, content: 'https://x/1' }] });
    const adapter = createJiraAdapter(CONN, { fetcher });
    const result = await adapter.attachFiles('TEST-1', [p]);
    assert.equal(result.uploaded[0].inlineMarkup, null);
  });

  it('reports a missing local path as an error without throwing', async () => {
    const fetcher = async () => { throw new Error('should not be called'); };
    const adapter = createJiraAdapter(CONN, { fetcher });
    const result = await adapter.attachFiles('TEST-1', [path.join(tmpDir, 'missing.png')]);
    assert.equal(result.uploaded.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].message, 'not-found');
  });

  it('reports an HTTP upload failure as an error, best-effort across multiple files', async () => {
    const good = writeFixture('a.png', 'good');
    const bad = writeFixture('b.png', 'bad');
    let call = 0;
    const fetcher = async () => {
      call++;
      if (call === 1) return { ok: true, json: async () => [{ id: '1', filename: 'a.png', size: 4, content: 'https://x/1' }] };
      return { ok: false, status: 413 };
    };
    const adapter = createJiraAdapter(CONN, { fetcher });
    const result = await adapter.attachFiles('TEST-1', [good, bad]);
    assert.equal(result.uploaded.length, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0].message, /413/);
  });
});
