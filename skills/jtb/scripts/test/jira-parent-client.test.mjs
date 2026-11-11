import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchEpicLinkFieldId, fetchParentInfo, setIssueParent } from '../lib/jira-parent-client.mjs';

const ENV = { JIRA_BASE_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'user@example.com', JIRA_API_TOKEN: 'tok' };
const EPIC_LINK_SCHEMA = 'com.pyxis.greenhopper.jira:gh-epic-link';

function capturingFetcher(body = {}, status = 200) {
  const calls = [];
  const fetcher = async (url, opts = {}) => {
    calls.push({ url, method: opts.method ?? 'GET', body: opts.body ? JSON.parse(opts.body) : undefined });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetcher, calls };
}

describe('fetchEpicLinkFieldId', () => {
  it('returns the id of the field whose schema is the Epic Link custom type', async () => {
    const { fetcher, calls } = capturingFetcher([
      { id: 'summary', name: 'Summary' },
      { id: 'customfield_10014', name: 'Epic Link', schema: { custom: EPIC_LINK_SCHEMA } },
    ]);
    assert.equal(await fetchEpicLinkFieldId({ env: ENV, fetcher, apiVersion: 2 }), 'customfield_10014');
    assert.match(calls[0].url, /\/rest\/api\/2\/field$/);
  });

  it('matches the schema type before the display name — a renamed field is still found', async () => {
    const { fetcher } = capturingFetcher([{ id: 'customfield_10100', name: 'Initiative', schema: { custom: EPIC_LINK_SCHEMA } }]);
    assert.equal(await fetchEpicLinkFieldId({ env: ENV, fetcher }), 'customfield_10100');
  });

  it('falls back to the exact name "Epic Link" when the schema is absent', async () => {
    const { fetcher } = capturingFetcher([{ id: 'customfield_10200', name: 'Epic Link' }]);
    assert.equal(await fetchEpicLinkFieldId({ env: ENV, fetcher }), 'customfield_10200');
  });

  it('returns null when the instance has no Epic Link field', async () => {
    const { fetcher } = capturingFetcher([{ id: 'summary', name: 'Summary' }, { id: 'customfield_1', name: 'Epic Name' }]);
    assert.equal(await fetchEpicLinkFieldId({ env: ENV, fetcher }), null);
  });

  it('returns null for a non-array body instead of throwing', async () => {
    const { fetcher } = capturingFetcher({ unexpected: true });
    assert.equal(await fetchEpicLinkFieldId({ env: ENV, fetcher }), null);
  });

  it('surfaces a non-OK response with its status', async () => {
    const { fetcher } = capturingFetcher({}, 403);
    await assert.rejects(() => fetchEpicLinkFieldId({ env: ENV, fetcher }), (err) => err.status === 403);
  });

  it('goes through the SSRF guard', async () => {
    const badEnv = { ...ENV, JIRA_BASE_URL: 'https://169.254.169.254' };
    await assert.rejects(() => fetchEpicLinkFieldId({ env: badEnv, fetcher: async () => ({ ok: true, json: async () => [] }) }), /blocked/);
  });
});

describe('fetchParentInfo', () => {
  it('Cloud (v3): asks only for issuetype and parent, reads the parent key', async () => {
    const { fetcher, calls } = capturingFetcher({ key: 'PROJ-5', fields: { issuetype: { name: 'Task', subtask: false }, parent: { key: 'PROJ-1' } } });
    const info = await fetchParentInfo('PROJ-5', { env: ENV, fetcher, apiVersion: 3 });
    assert.deepEqual(info, { key: 'PROJ-5', type: 'Task', isSubtask: false, parentKey: 'PROJ-1' });
    assert.match(calls[0].url, /\/rest\/api\/3\/issue\/PROJ-5\?fields=issuetype%2Cparent$/);
  });

  it('Cloud: no parent means parentKey null', async () => {
    const { fetcher } = capturingFetcher({ key: 'PROJ-5', fields: { issuetype: { name: 'Task' } } });
    assert.equal((await fetchParentInfo('PROJ-5', { env: ENV, fetcher, apiVersion: 3 })).parentKey, null);
  });

  it('flags a sub-task from issuetype.subtask', async () => {
    const { fetcher } = capturingFetcher({ key: 'PROJ-6', fields: { issuetype: { name: 'Sub-task', subtask: true }, parent: { key: 'PROJ-5' } } });
    assert.equal((await fetchParentInfo('PROJ-6', { env: ENV, fetcher, apiVersion: 3 })).isSubtask, true);
  });

  it('Server/DC (v2): requests the Epic Link field and reads the epic key from it', async () => {
    const { fetcher, calls } = capturingFetcher({ key: 'PROJ-5', fields: { issuetype: { name: 'Story' }, customfield_10014: 'PROJ-1' } });
    const info = await fetchParentInfo('PROJ-5', { env: ENV, fetcher, apiVersion: 2, epicLinkFieldId: 'customfield_10014' });
    assert.equal(info.parentKey, 'PROJ-1');
    assert.match(calls[0].url, /fields=issuetype%2Cparent%2Ccustomfield_10014$/);
  });

  it('Server/DC: an empty Epic Link field means parentKey null', async () => {
    const { fetcher } = capturingFetcher({ key: 'PROJ-5', fields: { issuetype: { name: 'Story' }, customfield_10014: null } });
    assert.equal((await fetchParentInfo('PROJ-5', { env: ENV, fetcher, apiVersion: 2, epicLinkFieldId: 'customfield_10014' })).parentKey, null);
  });

  it('Server/DC: a sub-task keeps its real parent task out of the epic slot', async () => {
    const { fetcher } = capturingFetcher({ key: 'PROJ-6', fields: { issuetype: { name: 'Sub-task', subtask: true }, parent: { key: 'PROJ-5' } } });
    assert.equal((await fetchParentInfo('PROJ-6', { env: ENV, fetcher, apiVersion: 2, epicLinkFieldId: 'customfield_10014' })).parentKey, null);
  });

  it('surfaces a non-OK response with its status', async () => {
    const { fetcher } = capturingFetcher({}, 404);
    await assert.rejects(() => fetchParentInfo('PROJ-404', { env: ENV, fetcher, apiVersion: 3 }), (err) => err.status === 404);
  });

  it('encodes the key into the path', async () => {
    const { fetcher, calls } = capturingFetcher({ key: 'X-1', fields: {} });
    await fetchParentInfo('PROJ-1/../../x', { env: ENV, fetcher, apiVersion: 3 });
    assert.doesNotMatch(calls[0].url, /\/issue\/PROJ-1\/\.\./);
  });
});

describe('setIssueParent', () => {
  it('Cloud (v3): PUTs fields.parent.key to the child', async () => {
    const { fetcher, calls } = capturingFetcher({}, 204);
    await setIssueParent('PROJ-5', 'PROJ-1', { env: ENV, fetcher, apiVersion: 3 });
    assert.equal(calls[0].method, 'PUT');
    assert.match(calls[0].url, /\/rest\/api\/3\/issue\/PROJ-5$/);
    assert.deepEqual(calls[0].body, { fields: { parent: { key: 'PROJ-1' } } });
  });

  it('Server/DC (v2): PUTs the epic key as a plain string under the Epic Link field id', async () => {
    const { fetcher, calls } = capturingFetcher({}, 204);
    await setIssueParent('PROJ-5', 'PROJ-1', { env: ENV, fetcher, apiVersion: 2, epicLinkFieldId: 'customfield_10014' });
    assert.deepEqual(calls[0].body, { fields: { customfield_10014: 'PROJ-1' } });
  });

  it('Server/DC without a field id refuses before any request', async () => {
    const { fetcher, calls } = capturingFetcher({}, 204);
    await assert.rejects(() => setIssueParent('PROJ-5', 'PROJ-1', { env: ENV, fetcher, apiVersion: 2 }), /Epic Link/);
    assert.equal(calls.length, 0);
  });

  it('surfaces Jira\'s own rejection with status and details', async () => {
    const { fetcher } = capturingFetcher({ errors: { parent: 'Given parent work item does not belong to appropriate hierarchy.' } }, 400);
    await assert.rejects(() => setIssueParent('PROJ-5', 'PROJ-1', { env: ENV, fetcher, apiVersion: 3 }), (err) => err.status === 400 && /hierarchy/.test(JSON.stringify(err.details)));
  });

  it('puts Jira\'s own reason in the error message, so the reader sees why', async () => {
    const { fetcher } = capturingFetcher({ errorMessages: ['Issue type cannot have an epic.'], errors: { [`customfield_10014`]: 'Epic Link is not valid.' } }, 400);
    await assert.rejects(() => setIssueParent('PROJ-5', 'PROJ-1', { env: ENV, fetcher, apiVersion: 2, epicLinkFieldId: 'customfield_10014' }), /400.*Issue type cannot have an epic.*Epic Link is not valid/);
  });

  it('a 429 carries the Retry-After wait so the caller can say how long to wait', async () => {
    const fetcher = async () => ({ ok: false, status: 429, headers: { get: (h) => (h === 'retry-after' ? '30' : null) }, json: async () => ({}) });
    await assert.rejects(() => setIssueParent('PROJ-5', 'PROJ-1', { env: ENV, fetcher, apiVersion: 3 }), (err) => err.status === 429 && err.rateLimit.retryAfterSeconds === 30);
  });

  it('strips terminal control characters from Jira\'s reason', async () => {
    const { fetcher } = capturingFetcher({ errorMessages: ['bad \u001b]52;c;ZXZpbA==\u0007 text'] }, 400);
    await assert.rejects(() => setIssueParent('PROJ-5', 'PROJ-1', { env: ENV, fetcher, apiVersion: 3 }), (err) => !/\u001b|\u0007/.test(err.message));
  });

  it('goes through the SSRF guard', async () => {
    const badEnv = { ...ENV, JIRA_BASE_URL: 'https://169.254.169.254' };
    await assert.rejects(() => setIssueParent('PROJ-5', 'PROJ-1', { env: badEnv, fetcher: async () => ({ ok: true, status: 204 }), apiVersion: 3 }), /blocked/);
  });
});
