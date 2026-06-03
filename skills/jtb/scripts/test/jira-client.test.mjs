import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTicket, buildAuthHeader, fetchTicket, fetchCurrentUser, searchTickets, fetchStatuses, fetchRemoteLinks, parseStatusChangedAt } from '../lib/jira-client.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', '..', '..', '..', 'fixtures', 'jira-fixtures');
const cloudFixture = JSON.parse(readFileSync(join(fixturesDir, 'PROD-1234-cloud.json'), 'utf8'));
const serverFixture = JSON.parse(readFileSync(join(fixturesDir, 'PROD-1234-server.json'), 'utf8'));

describe('normalizeTicket', () => {
  it('extracts core fields from Cloud fixture JSON', () => {
    const result = normalizeTicket(cloudFixture);
    assert.equal(result.key, 'PROD-1234');
    assert.equal(result.summary, 'Fix payment validation on checkout');
    assert.equal(result.type, 'Bug');
    assert.equal(result.status, 'In Progress');
    assert.equal(result.priority, 'High');
    assert.equal(result.assignee, 'John Dev');
    assert.equal(result.reporter, 'Sarah QA');
    assert.ok(result.description.includes('payment validation'));
  });

  it('extracts comments with author, body, and date', () => {
    const result = normalizeTicket(cloudFixture);
    assert.equal(result.comments.length, 3);
    assert.equal(result.comments[0].author, 'Sarah QA');
    assert.ok(result.comments[0].body.includes('reproduce this consistently'));
    assert.equal(result.comments[0].created, '2026-02-26T09:15:00.000+0000');
  });

  it('extracts linked issues with direction, type, key, and status', () => {
    const result = normalizeTicket(cloudFixture);
    assert.equal(result.linkedIssues.length, 2);
    assert.deepStrictEqual(result.linkedIssues[0], {
      direction: 'outward',
      linkType: 'Blocks',
      key: 'PROD-1235',
      summary: 'Deploy payment hotfix to production',
      status: 'Blocked',
      type: 'Task',
    });
    assert.equal(result.linkedIssues[1].direction, 'inward');
    assert.equal(result.linkedIssues[1].key, 'PROD-1100');
  });

  it('extracts attachments with id, filename, mimeType, size, and content URL', () => {
    const result = normalizeTicket(cloudFixture);
    assert.equal(result.attachments.length, 2);
    assert.equal(result.attachments[0].filename, 'error-screenshot.png');
    assert.equal(result.attachments[0].mimeType, 'image/png');
    assert.equal(result.attachments[0].size, 245000);
    assert.ok(result.attachments[0].content.includes('error-screenshot.png'));
    assert.ok(result.attachments[0].id != null);
    assert.equal(result.attachments[1].filename, 'server-log.txt');
    assert.equal(result.attachments[1].mimeType, 'text/plain');
  });

  it('normalizeTicket — falls back to null for missing mimeType and content', () => {
    const raw = {
      key: 'T-1',
      fields: {
        summary: 'Test', issuetype: { name: 'Task' }, status: { name: 'Open' },
        attachment: [{ id: 'a1', filename: 'file.png', size: 100 }],
      },
    };
    const result = normalizeTicket(raw);
    assert.equal(result.attachments[0].mimeType, null);
    assert.equal(result.attachments[0].content, null);
  });

  it('handles missing optional fields gracefully', () => {
    const minimal = { key: 'TEST-1', fields: { summary: 'Minimal ticket', issuetype: { name: 'Task' }, status: { name: 'Open' } } };
    const result = normalizeTicket(minimal);
    assert.equal(result.key, 'TEST-1');
    assert.equal(result.assignee, null);
    assert.equal(result.reporter, null);
    assert.equal(result.priority, null);
    assert.equal(result.description, null);
    assert.deepStrictEqual(result.comments, []);
    assert.deepStrictEqual(result.linkedIssues, []);
    assert.deepStrictEqual(result.attachments, []);
    assert.deepStrictEqual(result.labels, []);
    assert.deepStrictEqual(result.components, []);
  });

  it('normalizes Server fixture JSON (name field instead of emailAddress)', () => {
    const result = normalizeTicket(serverFixture);
    assert.equal(result.key, 'PROD-1234');
    assert.equal(result.assignee, 'John Dev');
    assert.equal(result.comments[0].author, 'Sarah QA');
    assert.equal(result.comments.length, 3);
    assert.equal(result.linkedIssues.length, 2);
  });

  it('converts ADF description to plain text', () => {
    const adfTicket = {
      key: 'ADF-1',
      fields: {
        summary: 'ADF test',
        issuetype: { name: 'Task' },
        status: { name: 'Open' },
        description: {
          type: 'doc',
          version: 1,
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Description from ADF' }] },
          ],
        },
      },
    };
    const result = normalizeTicket(adfTicket);
    assert.equal(result.description, 'Description from ADF');
  });

  it('converts ADF comment body to plain text', () => {
    const adfTicket = {
      key: 'ADF-2',
      fields: {
        summary: 'ADF comments',
        issuetype: { name: 'Task' },
        status: { name: 'Open' },
        comment: {
          comments: [
            {
              author: { displayName: 'Dev' },
              body: {
                type: 'doc',
                version: 1,
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'Comment from ADF' }] },
                ],
              },
              created: '2026-03-06T10:00:00.000+0000',
            },
          ],
        },
      },
    };
    const result = normalizeTicket(adfTicket);
    assert.equal(result.comments[0].body, 'Comment from ADF');
  });

  it('keeps plain string description unchanged', () => {
    const result = normalizeTicket(cloudFixture);
    assert.equal(typeof result.description, 'string');
    assert.ok(result.description.includes('payment validation'));
  });
});

describe('buildAuthHeader', () => {
  it('builds Basic auth header for Cloud (email + token)', () => {
    const env = { JIRA_EMAIL: 'john@example.com', JIRA_API_TOKEN: 'mytoken123' };
    const result = buildAuthHeader(env);
    const expected = 'Basic ' + Buffer.from('john@example.com:mytoken123').toString('base64');
    assert.equal(result.Authorization, expected);
  });

  it('builds Bearer auth header for Server (PAT)', () => {
    const env = { JIRA_PAT: 'server-pat-token' };
    const result = buildAuthHeader(env);
    assert.equal(result.Authorization, 'Bearer server-pat-token');
  });
});

describe('fetchTicket', () => {
  it('throws descriptive error on HTTP 401', async () => {
    const mockFetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized' });
    await assert.rejects(
      () => fetchTicket('PROD-1234', {
        env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'bad' },
        fetcher: mockFetch,
      }),
      (err) => {
        assert.ok(err.message.includes('401'));
        assert.ok(err.message.includes('PROD-1234'));
        assert.ok(!err.message.includes('Unauthorized'), 'statusText must not appear in error message');
        return true;
      }
    );
  });

  it('throws descriptive error on HTTP 404', async () => {
    const mockFetch = async () => ({ ok: false, status: 404, statusText: 'Not Found' });
    await assert.rejects(
      () => fetchTicket('PROD-9999', {
        env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
        fetcher: mockFetch,
      }),
      (err) => {
        assert.ok(err.message.includes('404'));
        assert.ok(err.message.includes('PROD-9999'));
        return true;
      }
    );
  });

  it('depth 0: fetches only the target ticket, no linked details', async () => {
    const calls = [];
    const mockFetch = async (url) => {
      calls.push(url);
      return { ok: true, json: async () => cloudFixture };
    };
    const result = await fetchTicket('PROD-1234', {
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
      depth: 0,
    });
    assert.equal(calls.length, 1);
    assert.equal(result.linkedTicketDetails, undefined);
  });

  it('depth 1: fetches target + linked tickets with full details', async () => {
    const linkedFixture = { key: 'PROD-1235', fields: { summary: 'Deploy hotfix', issuetype: { name: 'Task' }, status: { name: 'Blocked' }, comment: { comments: [{ author: { displayName: 'PM' }, body: 'Please expedite', created: '2026-03-01T10:00:00.000+0000' }] } } };
    const calls = [];
    const mockFetch = async (url) => {
      calls.push(url);
      if (url.includes('PROD-1235')) return { ok: true, json: async () => linkedFixture };
      if (url.includes('PROD-1100')) return { ok: true, json: async () => ({ key: 'PROD-1100', fields: { summary: 'Refactor cart', issuetype: { name: 'Story' }, status: { name: 'Done' } } }) };
      return { ok: true, json: async () => cloudFixture };
    };
    const result = await fetchTicket('PROD-1234', {
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
      depth: 1,
    });
    assert.equal(calls.length, 3); // target + 2 linked
    assert.equal(result.linkedTicketDetails.length, 2);
    assert.equal(result.linkedTicketDetails[0].key, 'PROD-1235');
    assert.equal(result.linkedTicketDetails[0].comments.length, 1);
    assert.equal(result.linkedTicketDetails[0].comments[0].body, 'Please expedite');
  });

  it('hard cap: stops at 15 total tickets regardless of depth', async () => {
    let callCount = 0;
    const makeTicket = (key, linkedKeys) => ({
      key,
      fields: {
        summary: `Ticket ${key}`,
        issuetype: { name: 'Task' },
        status: { name: 'Open' },
        issuelinks: linkedKeys.map(k => ({
          type: { name: 'Relates', inward: 'relates to', outward: 'relates to' },
          outwardIssue: { key: k, fields: { summary: `Ticket ${k}`, status: { name: 'Open' }, issuetype: { name: 'Task' } } },
        })),
      },
    });
    // Root links to 20 tickets
    const linkedKeys = Array.from({ length: 20 }, (_, i) => `T-${i + 1}`);
    const mockFetch = async (url) => {
      callCount++;
      const key = url.split('/').pop();
      if (key === 'ROOT') return { ok: true, json: async () => makeTicket('ROOT', linkedKeys) };
      return { ok: true, json: async () => makeTicket(key, []) };
    };
    const result = await fetchTicket('ROOT', {
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
      depth: 1,
    });
    assert.ok(callCount <= 15, `Made ${callCount} API calls, expected <= 15`);
  });

  it('uses v3 endpoint when apiVersion is 3', async () => {
    let capturedUrl = '';
    const mockFetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => cloudFixture };
    };
    await fetchTicket('PROD-1234', {
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
      depth: 0,
      apiVersion: 3,
    });
    assert.ok(capturedUrl.includes('/rest/api/3/issue/PROD-1234'), `Expected v3 URL, got: ${capturedUrl}`);
  });

  it('defaults to v2 endpoint for fetchTicket', async () => {
    let capturedUrl = '';
    const mockFetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => cloudFixture };
    };
    await fetchTicket('PROD-1234', {
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
      depth: 0,
    });
    assert.ok(capturedUrl.includes('/rest/api/2/issue/PROD-1234'));
  });

  it('tracks visited keys to avoid circular references', async () => {
    const calls = [];
    // A links to B, B links back to A
    const ticketA = { key: 'A-1', fields: { summary: 'A', issuetype: { name: 'Task' }, status: { name: 'Open' }, issuelinks: [{ type: { name: 'Relates', inward: 'relates to', outward: 'relates to' }, outwardIssue: { key: 'B-1', fields: { summary: 'B', status: { name: 'Open' }, issuetype: { name: 'Task' } } } }] } };
    const ticketB = { key: 'B-1', fields: { summary: 'B', issuetype: { name: 'Task' }, status: { name: 'Open' }, issuelinks: [{ type: { name: 'Relates', inward: 'relates to', outward: 'relates to' }, outwardIssue: { key: 'A-1', fields: { summary: 'A', status: { name: 'Open' }, issuetype: { name: 'Task' } } } }] } };
    const mockFetch = async (url) => {
      calls.push(url);
      if (url.includes('B-1')) return { ok: true, json: async () => ticketB };
      return { ok: true, json: async () => ticketA };
    };
    const result = await fetchTicket('A-1', {
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
      depth: 2,
    });
    assert.equal(calls.length, 2); // A-1 then B-1, no re-fetch of A-1
  });

  it('fetches all sibling linked tickets at depth=1', async () => {
    // ROOT links to A, B, C — all should be fetched
    const makeSimple = (key) => ({
      key,
      fields: { summary: key, issuetype: { name: 'Task' }, status: { name: 'Open' }, issuelinks: [] },
    });
    const root = {
      key: 'ROOT',
      fields: {
        summary: 'Root', issuetype: { name: 'Task' }, status: { name: 'Open' },
        issuelinks: ['A-1', 'B-1', 'C-1'].map(k => ({
          type: { name: 'Relates', inward: 'relates to', outward: 'relates to' },
          outwardIssue: { key: k, fields: { summary: k, status: { name: 'Open' }, issuetype: { name: 'Task' } } },
        })),
      },
    };
    const fetched = new Set();
    const mockFetch = async (url) => {
      const key = url.split('/').pop();
      fetched.add(key);
      if (key === 'ROOT') return { ok: true, json: async () => root };
      return { ok: true, json: async () => makeSimple(key) };
    };
    const result = await fetchTicket('ROOT', {
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
      depth: 1,
    });
    assert.equal(result.linkedTicketDetails.length, 3, 'all 3 siblings must be fetched');
    assert.ok(fetched.has('A-1') && fetched.has('B-1') && fetched.has('C-1'));
  });

  it('does not fetch the same ticket twice when it appears in multiple sibling link lists', async () => {
    // ROOT → [A, B]; A → [B, C]. B appears in both ROOT's and A's linked list.
    const makeWithLinks = (key, links) => ({
      key,
      fields: {
        summary: key, issuetype: { name: 'Task' }, status: { name: 'Open' },
        issuelinks: links.map(k => ({
          type: { name: 'Relates', inward: 'relates to', outward: 'relates to' },
          outwardIssue: { key: k, fields: { summary: k, status: { name: 'Open' }, issuetype: { name: 'Task' } } },
        })),
      },
    });
    const fetchCounts = {};
    const mockFetch = async (url) => {
      const key = url.split('/').pop();
      fetchCounts[key] = (fetchCounts[key] || 0) + 1;
      if (key === 'ROOT') return { ok: true, json: async () => makeWithLinks('ROOT', ['A-1', 'B-1']) };
      if (key === 'A-1') return { ok: true, json: async () => makeWithLinks('A-1', ['B-1', 'C-1']) };
      return { ok: true, json: async () => makeWithLinks(key, []) };
    };
    await fetchTicket('ROOT', {
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
      depth: 2,
    });
    assert.equal(fetchCounts['B-1'], 1, 'B-1 appears in two link lists but must only be fetched once');
  });

  it('sets err.status on HTTP error', async () => {
    const mockFetch = async () => ({ ok: false, status: 404, statusText: 'Not Found' });
    await assert.rejects(
      () => fetchTicket('PROD-9999', {
        env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
        fetcher: mockFetch,
      }),
      (err) => {
        assert.equal(err.status, 404, 'fetchTicket must set err.status for error-classifier routing');
        return true;
      }
    );
  });
});

describe('fetchCurrentUser', () => {
  it('returns normalized user object from Cloud response', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        accountId: 'abc-123',
        name: null,
        displayName: 'John Dev',
        emailAddress: 'john@example.com',
      }),
    });
    const result = await fetchCurrentUser({
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
    });
    assert.equal(result.accountId, 'abc-123');
    assert.equal(result.displayName, 'John Dev');
    assert.equal(result.emailAddress, 'john@example.com');
  });

  it('returns normalized user object from Server response', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({
        name: 'jdev',
        displayName: 'John Dev',
      }),
    });
    const result = await fetchCurrentUser({
      env: { JIRA_BASE_URL: 'https://jira.server.com', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
    });
    assert.equal(result.name, 'jdev');
    assert.equal(result.displayName, 'John Dev');
    assert.equal(result.accountId, null);
  });

  it('throws on HTTP error', async () => {
    const mockFetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized' });
    await assert.rejects(
      () => fetchCurrentUser({
        env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'bad' },
        fetcher: mockFetch,
      }),
      (err) => {
        assert.ok(err.message.includes('401'));
        assert.ok(!err.message.includes('Unauthorized'), 'statusText must not appear in error message');
        return true;
      }
    );
  });

  it('uses v3 endpoint when apiVersion is 3', async () => {
    let capturedUrl = '';
    const mockFetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ accountId: 'abc', displayName: 'Dev' }) };
    };
    await fetchCurrentUser({
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
      apiVersion: 3,
    });
    assert.ok(capturedUrl.includes('/rest/api/3/myself'), `Expected v3 URL, got: ${capturedUrl}`);
  });

  it('sets err.status on HTTP error', async () => {
    const mockFetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized' });
    await assert.rejects(
      () => fetchCurrentUser({
        env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'bad' },
        fetcher: mockFetch,
      }),
      (err) => {
        assert.equal(err.status, 401, 'fetchCurrentUser must set err.status for error-classifier routing');
        return true;
      }
    );
  });
});

describe('searchTickets', () => {
  it('constructs correct URL with JQL and normalizes results', async () => {
    let capturedUrl = '';
    const mockFetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({
          issues: [cloudFixture],
        }),
      };
    };
    const result = await searchTickets('assignee = currentUser()', {
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
    });
    assert.ok(capturedUrl.includes('/rest/api/2/search'));
    assert.ok(capturedUrl.includes('assignee'));
    assert.equal(result.length, 1);
    assert.equal(result[0].key, 'PROD-1234');
    assert.equal(result[0].summary, 'Fix payment validation on checkout');
  });

  it('uses v3 endpoint when apiVersion is 3', async () => {
    let capturedUrl = '';
    const mockFetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({ issues: [cloudFixture] }),
      };
    };
    await searchTickets('assignee = currentUser()', {
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
      apiVersion: 3,
    });
    assert.ok(capturedUrl.includes('/rest/api/3/search/jql'), `Expected v3 URL, got: ${capturedUrl}`);
    assert.ok(!capturedUrl.includes('/rest/api/2/'), 'Should not contain v2 path');
  });

  it('defaults to v2 endpoint when apiVersion not specified', async () => {
    let capturedUrl = '';
    const mockFetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ issues: [] }) };
    };
    await searchTickets('assignee = currentUser()', {
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
    });
    assert.ok(capturedUrl.includes('/rest/api/2/search'));
  });

  it('normalizes ADF description from v3 response', async () => {
    const v3Fixture = {
      key: 'PROJ-1',
      fields: {
        summary: 'Test ticket',
        issuetype: { name: 'Task' },
        status: { name: 'Open' },
        description: {
          type: 'doc',
          version: 1,
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'ADF description text' }] },
          ],
        },
        comment: {
          comments: [
            {
              author: { displayName: 'Alice' },
              body: {
                type: 'doc',
                version: 1,
                content: [
                  { type: 'paragraph', content: [{ type: 'text', text: 'ADF comment body' }] },
                ],
              },
              created: '2026-03-06T10:00:00.000+0000',
            },
          ],
        },
      },
    };
    const mockFetch = async () => ({ ok: true, json: async () => ({ issues: [v3Fixture] }) });
    const result = await searchTickets('test', {
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
      apiVersion: 3,
    });
    assert.equal(result[0].description, 'ADF description text');
    assert.equal(result[0].comments[0].body, 'ADF comment body');
  });

  it('returns empty array for no results', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({ issues: [] }),
    });
    const result = await searchTickets('assignee = nobody', {
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
    });
    assert.equal(result.length, 0);
  });

  it('throws on HTTP error with detail from response body', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ errorMessages: ["The value 'QA' does not exist for the field 'status'."] }),
    });
    await assert.rejects(
      () => searchTickets('bad jql', {
        env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
        fetcher: mockFetch,
      }),
      (err) => {
        assert.ok(err.message.includes('400'));
        assert.equal(err.status, 400);
        assert.ok(err.detail.includes('QA'));
        return true;
      }
    );
  });

  it('error message does not embed Jira errorMessages content', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ errorMessages: ["The value 'QA' does not exist for the field 'status'."] }),
    });
    await assert.rejects(
      () => searchTickets('bad jql', {
        env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
        fetcher: mockFetch,
      }),
      (err) => {
        assert.ok(!err.message.includes('does not exist'), 'Jira errorMessages must not be embedded in err.message');
        assert.equal(err.status, 400);
        assert.ok(err.detail.includes('QA'), 'detail should still carry Jira errorMessages for internal use');
        return true;
      }
    );
  });
});

describe('fetchStatuses', () => {
  it('returns deduplicated sorted status names', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => [
        { name: 'In Progress' },
        { name: 'Done' },
        { name: 'In Progress' },
        { name: 'Code Review' },
      ],
    });
    const result = await fetchStatuses({
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
    });
    assert.deepStrictEqual(result, ['Code Review', 'Done', 'In Progress']);
  });

  it('throws on HTTP error', async () => {
    const mockFetch = async () => ({ ok: false, status: 401, statusText: 'Unauthorized' });
    await assert.rejects(
      () => fetchStatuses({
        env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'bad' },
        fetcher: mockFetch,
      }),
      (err) => {
        assert.ok(err.message.includes('401'));
        assert.ok(!err.message.includes('Unauthorized'), 'statusText must not appear in error message');
        return true;
      }
    );
  });

  it('uses v3 endpoint when apiVersion is 3', async () => {
    let capturedUrl = '';
    const mockFetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => [{ name: 'Open' }] };
    };
    await fetchStatuses({
      env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
      fetcher: mockFetch,
      apiVersion: 3,
    });
    assert.ok(capturedUrl.includes('/rest/api/3/status'), `Expected v3 URL, got: ${capturedUrl}`);
  });

  it('sets err.status on HTTP error', async () => {
    const mockFetch = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' });
    await assert.rejects(
      () => fetchStatuses({
        env: { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' },
        fetcher: mockFetch,
      }),
      (err) => {
        assert.equal(err.status, 500, 'fetchStatuses must set err.status for error-classifier routing');
        return true;
      }
    );
  });
});

describe('request timeouts', () => {
  const ENV = { JIRA_BASE_URL: 'https://test.atlassian.net', JIRA_PAT: 'tok' };

  it('fetchCurrentUser passes AbortSignal to fetcher when timeoutMs is set', async () => {
    let capturedSignal;
    const spyFetch = async (_url, opts) => {
      capturedSignal = opts?.signal;
      return { ok: true, json: async () => ({ accountId: 'u1', displayName: 'Dev', name: 'dev', emailAddress: 'dev@x.com' }) };
    };
    await fetchCurrentUser({ env: ENV, fetcher: spyFetch, timeoutMs: 5000 });
    assert.ok(capturedSignal instanceof AbortSignal, 'fetchCurrentUser must pass AbortSignal to fetcher');
  });

  it('searchTickets passes AbortSignal to fetcher when timeoutMs is set', async () => {
    let capturedSignal;
    const spyFetch = async (_url, opts) => {
      capturedSignal = opts?.signal;
      return { ok: true, json: async () => ({ issues: [] }) };
    };
    await searchTickets('project = TEST', { env: ENV, fetcher: spyFetch, timeoutMs: 5000 });
    assert.ok(capturedSignal instanceof AbortSignal, 'searchTickets must pass AbortSignal to fetcher');
  });

  it('fetchStatuses passes AbortSignal to fetcher when timeoutMs is set', async () => {
    let capturedSignal;
    const spyFetch = async (_url, opts) => {
      capturedSignal = opts?.signal;
      return { ok: true, json: async () => [] };
    };
    await fetchStatuses({ env: ENV, fetcher: spyFetch, timeoutMs: 5000 });
    assert.ok(capturedSignal instanceof AbortSignal, 'fetchStatuses must pass AbortSignal to fetcher');
  });

  it('fetchCurrentUser works without timeoutMs (backward compatible)', async () => {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({ accountId: 'u1', displayName: 'Dev', name: 'dev', emailAddress: 'dev@x.com' }),
    });
    await assert.doesNotReject(() => fetchCurrentUser({ env: ENV, fetcher: mockFetch }));
  });

  it('fetchCurrentUser includes an AbortSignal by default (no explicit timeoutMs)', async () => {
    let capturedOpts;
    const spyFetch = async (_url, opts) => {
      capturedOpts = opts;
      return { ok: true, json: async () => ({ accountId: 'u1', displayName: 'Dev', name: 'dev', emailAddress: 'dev@x.com' }) };
    };
    await fetchCurrentUser({ env: ENV, fetcher: spyFetch });
    assert.ok(capturedOpts?.signal instanceof AbortSignal, 'must include AbortSignal even without explicit timeoutMs');
  });

  it('searchTickets includes an AbortSignal by default (no explicit timeoutMs)', async () => {
    let capturedOpts;
    const spyFetch = async (_url, opts) => {
      capturedOpts = opts;
      return { ok: true, json: async () => ({ issues: [] }) };
    };
    await searchTickets('project = TEST', { env: ENV, fetcher: spyFetch });
    assert.ok(capturedOpts?.signal instanceof AbortSignal, 'must include AbortSignal even without explicit timeoutMs');
  });

  it('fetchTicket includes an AbortSignal by default (no explicit timeoutMs)', async () => {
    let capturedOpts;
    const spyFetch = async (_url, opts) => {
      capturedOpts = opts;
      return { ok: true, json: async () => cloudFixture };
    };
    await fetchTicket('PROD-1234', { env: ENV, fetcher: spyFetch, depth: 0 });
    assert.ok(capturedOpts?.signal instanceof AbortSignal, 'must include AbortSignal even without explicit timeoutMs');
  });
});

// ---------------------------------------------------------------------------
// fetchRemoteLinks
// ---------------------------------------------------------------------------
describe('fetchRemoteLinks', () => {
  const ENV = { JIRA_BASE_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'user@example.com', JIRA_API_TOKEN: 'tok' };

  const CONFLUENCE_LINK = {
    id: 1,
    application: { type: 'com.atlassian.confluence', name: 'Confluence' },
    object: { url: 'https://example.atlassian.net/wiki/spaces/PROJ/pages/123456/Page+Title', title: 'Page Title' },
  };
  const NON_CONFLUENCE_LINK = {
    id: 2,
    application: { type: 'com.example.other', name: 'Other' },
    object: { url: 'https://example.com/other', title: 'Other Link' },
  };

  it('returns Confluence links from remote links API', async () => {
    const fetcher = async () => ({ ok: true, json: async () => [CONFLUENCE_LINK] });
    const links = await fetchRemoteLinks('PROJ-1', { env: ENV, fetcher });
    assert.equal(links.length, 1);
    assert.equal(links[0].url, CONFLUENCE_LINK.object.url);
    assert.equal(links[0].title, CONFLUENCE_LINK.object.title);
  });

  it('filters out non-Confluence remote links', async () => {
    const fetcher = async () => ({ ok: true, json: async () => [CONFLUENCE_LINK, NON_CONFLUENCE_LINK] });
    const links = await fetchRemoteLinks('PROJ-1', { env: ENV, fetcher });
    assert.equal(links.length, 1);
    assert.equal(links[0].url, CONFLUENCE_LINK.object.url);
  });

  it('returns empty array when no remote links', async () => {
    const fetcher = async () => ({ ok: true, json: async () => [] });
    const links = await fetchRemoteLinks('PROJ-1', { env: ENV, fetcher });
    assert.deepEqual(links, []);
  });

  it('calls the correct remotelink endpoint', async () => {
    let capturedUrl;
    const fetcher = async (url) => { capturedUrl = url; return { ok: true, json: async () => [] }; };
    await fetchRemoteLinks('PROJ-1', { env: ENV, fetcher });
    assert.ok(capturedUrl.includes('/rest/api/2/issue/PROJ-1/remotelink'), `unexpected URL: ${capturedUrl}`);
  });

  it('returns empty array on non-OK response', async () => {
    const fetcher = async () => ({ ok: false, status: 403, statusText: 'Forbidden' });
    const result = await fetchRemoteLinks('PROJ-1', { env: ENV, fetcher });
    assert.deepEqual(result, []);
  });
});

// ─── parseStatusChangedAt ──────────────────────────────────────────────────

describe('parseStatusChangedAt', () => {
  const makeHistory = (toString, created, field = 'status') => ({
    created,
    items: [{ field, from: '1', fromString: 'To Do', to: '2', toString }],
  });

  it('returns null when changelog is absent', () => {
    assert.strictEqual(parseStatusChangedAt(undefined, 'In Progress'), null);
  });

  it('returns null when changelog is null', () => {
    assert.strictEqual(parseStatusChangedAt(null, 'In Progress'), null);
  });

  it('returns null when changelog.histories is empty', () => {
    assert.strictEqual(parseStatusChangedAt({ histories: [] }, 'In Progress'), null);
  });

  it('returns null when no history item matches current status', () => {
    const changelog = { histories: [makeHistory('Done', '2026-01-10T10:00:00Z')] };
    assert.strictEqual(parseStatusChangedAt(changelog, 'In Progress'), null);
  });

  it('returns the created date of a matching status transition', () => {
    const changelog = { histories: [makeHistory('In Progress', '2026-01-15T09:00:00Z')] };
    assert.strictEqual(parseStatusChangedAt(changelog, 'In Progress'), '2026-01-15T09:00:00Z');
  });

  it('returns the MOST RECENT matching transition when multiple exist', () => {
    const changelog = {
      histories: [
        makeHistory('In Progress', '2026-01-05T09:00:00Z'),
        makeHistory('Done',        '2026-01-10T10:00:00Z'),
        makeHistory('In Progress', '2026-01-20T08:00:00Z'), // ← most recent re-entry
      ],
    };
    assert.strictEqual(parseStatusChangedAt(changelog, 'In Progress'), '2026-01-20T08:00:00Z');
  });

  it('ignores non-status field changes in history items', () => {
    const changelog = {
      histories: [
        { created: '2026-01-08T10:00:00Z', items: [{ field: 'assignee', from: null, fromString: null, to: 'u1', toString: 'In Progress' }] },
        makeHistory('In Progress', '2026-01-15T09:00:00Z'),
      ],
    };
    assert.strictEqual(parseStatusChangedAt(changelog, 'In Progress'), '2026-01-15T09:00:00Z');
  });

  it('returns null when currentStatus is null', () => {
    const changelog = { histories: [makeHistory('In Progress', '2026-01-15T09:00:00Z')] };
    assert.strictEqual(parseStatusChangedAt(changelog, null), null);
  });
});

// ─── normalizeTicket — statusChangedAt ────────────────────────────────────

describe('normalizeTicket — statusChangedAt', () => {
  it('is null when raw has no changelog', () => {
    const raw = JSON.parse(JSON.stringify(cloudFixture));
    delete raw.changelog;
    const result = normalizeTicket(raw);
    assert.strictEqual(result.statusChangedAt, null);
  });

  it('falls back to ticket.created when changelog.histories is empty (ticket never transitioned)', () => {
    const raw = { ...cloudFixture, changelog: { histories: [] } };
    const result = normalizeTicket(raw);
    // No transitions → ticket has been in current status since creation
    assert.strictEqual(result.statusChangedAt, cloudFixture.fields.created);
  });

  it('is set to transition created date when matching history exists', () => {
    const currentStatus = normalizeTicket(cloudFixture).status;
    const raw = {
      ...cloudFixture,
      changelog: {
        histories: [{
          created: '2026-03-01T12:00:00Z',
          items: [{ field: 'status', from: '1', fromString: 'To Do', to: '2', toString: currentStatus }],
        }],
      },
    };
    const result = normalizeTicket(raw);
    assert.strictEqual(result.statusChangedAt, '2026-03-01T12:00:00Z');
  });

  it('falls back to ticket.created when changelog present but no matching transition', () => {
    const raw = {
      ...cloudFixture,
      changelog: {
        histories: [{
          created: '2026-01-01T00:00:00Z',
          items: [{ field: 'status', from: '1', fromString: 'To Do', to: '99', toString: 'Done' }],
        }],
      },
    };
    const result = normalizeTicket(raw);
    // No matching transition for current status → falls back to ticket.created
    assert.strictEqual(result.statusChangedAt, cloudFixture.fields.created);
  });
});

// ─── searchTickets — expandChangelog opt ─────────────────────────────────

describe('searchTickets — expandChangelog opt', () => {
  const ENV = { JIRA_BASE_URL: 'https://jira.example.com', JIRA_EMAIL: 'u@e.com', JIRA_API_TOKEN: 'tok' };

  function makeFetcher(onUrl) {
    return async (url) => {
      onUrl(url);
      return {
        ok: true,
        json: async () => ({ issues: [] }),
      };
    };
  }

  it('does NOT include expand=changelog by default', async () => {
    let capturedUrl = '';
    await searchTickets('project = PROJ', { env: ENV, fetcher: makeFetcher(u => { capturedUrl = u; }) });
    assert.ok(!capturedUrl.includes('expand'), `should not include expand, got: ${capturedUrl}`);
  });

  it('includes expand=changelog when expandChangelog opt is true', async () => {
    let capturedUrl = '';
    await searchTickets('project = PROJ', { env: ENV, expandChangelog: true, fetcher: makeFetcher(u => { capturedUrl = u; }) });
    assert.ok(capturedUrl.includes('expand=changelog'), `expected expand=changelog in: ${capturedUrl}`);
  });
});

// ─── fetchTicket — expandChangelog opt ──────────────────────────────────

describe('fetchTicket — expandChangelog opt', () => {
  const ENV = { JIRA_BASE_URL: 'https://jira.example.com', JIRA_EMAIL: 'u@e.com', JIRA_API_TOKEN: 'tok' };

  function makeFetcher(onUrl) {
    return async (url) => {
      onUrl(url);
      return {
        ok: true,
        json: async () => ({ key: 'PROJ-1', fields: { summary: 'Test', status: { name: 'In Progress' }, issuetype: { name: 'Story' }, assignee: null, priority: null, reporter: null, description: null, created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z', labels: [], components: [], comment: { comments: [] }, issuelinks: [], attachment: [] } }),
      };
    };
  }

  it('does NOT include expand=changelog by default', async () => {
    let capturedUrl = '';
    await fetchTicket('PROJ-1', { env: ENV, fetcher: makeFetcher(u => { capturedUrl = u; }) });
    assert.ok(!capturedUrl.includes('expand'), `should not include expand, got: ${capturedUrl}`);
  });

  it('includes expand=changelog when expandChangelog opt is true', async () => {
    let capturedUrl = '';
    await fetchTicket('PROJ-1', { env: ENV, expandChangelog: true, fetcher: makeFetcher(u => { capturedUrl = u; }) });
    assert.ok(capturedUrl.includes('expand=changelog'), `expected expand=changelog in: ${capturedUrl}`);
  });

  it('does NOT propagate expandChangelog to linked ticket fetches', async () => {
    const capturedUrls = [];
    const fetcher = async (url) => {
      capturedUrls.push(url);
      return {
        ok: true,
        json: async () => ({
          key: capturedUrls.length === 1 ? 'PROJ-1' : 'PROJ-2',
          fields: {
            summary: 'Test', status: { name: 'In Progress' }, issuetype: { name: 'Story' },
            assignee: null, priority: null, reporter: null, description: null,
            created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z',
            labels: [], components: [], comment: { comments: [] }, attachment: [],
            issuelinks: capturedUrls.length === 1
              ? [{ type: { name: 'blocks' }, outwardIssue: { key: 'PROJ-2', fields: { summary: 'Linked', status: { name: 'Done' }, issuetype: { name: 'Task' } } } }]
              : [],
          },
        }),
      };
    };
    await fetchTicket('PROJ-1', { env: ENV, expandChangelog: true, depth: 1, fetcher });
    // Root ticket should have changelog expand
    assert.ok(capturedUrls[0].includes('expand=changelog'), `root should have expand, got: ${capturedUrls[0]}`);
    // Linked ticket must NOT have changelog expand
    if (capturedUrls.length > 1) {
      assert.ok(!capturedUrls[1].includes('expand'), `linked ticket should not have expand, got: ${capturedUrls[1]}`);
    }
  });
});
