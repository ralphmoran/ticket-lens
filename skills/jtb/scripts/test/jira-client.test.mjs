import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeTicket, buildAuthHeader, fetchTicket, fetchCurrentUser, searchTickets, fetchStatuses } from '../lib/jira-client.mjs';

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

  it('extracts attachments with filename and size', () => {
    const result = normalizeTicket(cloudFixture);
    assert.equal(result.attachments.length, 2);
    assert.deepStrictEqual(result.attachments[0], { filename: 'error-screenshot.png', size: 245000 });
    assert.deepStrictEqual(result.attachments[1], { filename: 'server-log.txt', size: 1200 });
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
        assert.ok(err.message.includes("does not exist"));
        assert.equal(err.status, 400);
        assert.ok(err.detail.includes('QA'));
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
        return true;
      }
    );
  });
});
