import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHubAdapter, normalizeGitHubIssue, parseGitHubRepo } from '../../lib/adapters/github-adapter.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const RAW_ISSUE = {
  number: 42,
  title: 'Fix the widget',
  state: 'open',
  body: 'Widget breaks on scroll.',
  user: { login: 'alice' },
  assignee: { login: 'bob' },
  assignees: [{ login: 'bob' }],
  labels: [{ name: 'bug' }, { name: 'priority-high' }],
  created_at: '2024-01-15T10:00:00Z',
  updated_at: '2024-01-16T12:00:00Z',
};

const RAW_COMMENTS = [
  {
    user: { login: 'carol' },
    body: 'Confirmed on Firefox.',
    created_at: '2024-01-15T11:00:00Z',
  },
  {
    user: { login: 'bob' },
    body: 'Working on it.',
    created_at: '2024-01-15T14:00:00Z',
  },
];

const CONN = {
  baseUrl: 'https://github.com/acme/widgets',
  apiToken: 'ghp_test_token',
  ticketPrefixes: ['WGT'],
};

function makeIssueResponse(issue = RAW_ISSUE, status = 200) {
  return { ok: status < 400, status, json: async () => issue };
}

function makeCommentsResponse(comments = RAW_COMMENTS, status = 200) {
  return { ok: status < 400, status, json: async () => comments };
}

// ---------------------------------------------------------------------------
// parseGitHubRepo
// ---------------------------------------------------------------------------
describe('parseGitHubRepo', () => {
  it('extracts owner and repo from standard URL', () => {
    const { owner, repo } = parseGitHubRepo('https://github.com/acme/widgets');
    assert.equal(owner, 'acme');
    assert.equal(repo, 'widgets');
  });

  it('handles trailing slash', () => {
    const { owner, repo } = parseGitHubRepo('https://github.com/acme/widgets/');
    assert.equal(owner, 'acme');
    assert.equal(repo, 'widgets');
  });

  it('throws when repo path is missing', () => {
    assert.throws(() => parseGitHubRepo('https://github.com'), /OWNER\/REPO/);
  });

  it('throws when only owner is present', () => {
    assert.throws(() => parseGitHubRepo('https://github.com/acme'), /OWNER\/REPO/);
  });

  it('throws on invalid URL', () => {
    assert.throws(() => parseGitHubRepo('not-a-url'), /Invalid/i);
  });
});

// ---------------------------------------------------------------------------
// normalizeGitHubIssue
// ---------------------------------------------------------------------------
describe('normalizeGitHubIssue', () => {
  it('maps key using prefix and issue number', () => {
    const t = normalizeGitHubIssue(RAW_ISSUE, [], 'WGT');
    assert.equal(t.key, 'WGT-42');
  });

  it('defaults key prefix to GH', () => {
    const t = normalizeGitHubIssue(RAW_ISSUE, []);
    assert.equal(t.key, 'GH-42');
  });

  it('maps summary to title', () => {
    const t = normalizeGitHubIssue(RAW_ISSUE, []);
    assert.equal(t.summary, 'Fix the widget');
  });

  it('maps type to Issue', () => {
    const t = normalizeGitHubIssue(RAW_ISSUE, []);
    assert.equal(t.type, 'Issue');
  });

  it('maps status to GitHub state', () => {
    const t = normalizeGitHubIssue(RAW_ISSUE, []);
    assert.equal(t.status, 'open');
  });

  it('maps priority to null (GitHub has none)', () => {
    const t = normalizeGitHubIssue(RAW_ISSUE, []);
    assert.equal(t.priority, null);
  });

  it('maps assignee from first assignees entry', () => {
    const t = normalizeGitHubIssue(RAW_ISSUE, []);
    assert.equal(t.assignee, 'bob');
  });

  it('maps reporter from user.login', () => {
    const t = normalizeGitHubIssue(RAW_ISSUE, []);
    assert.equal(t.reporter, 'alice');
  });

  it('maps description from body', () => {
    const t = normalizeGitHubIssue(RAW_ISSUE, []);
    assert.equal(t.description, 'Widget breaks on scroll.');
  });

  it('maps null body to null description', () => {
    const t = normalizeGitHubIssue({ ...RAW_ISSUE, body: null }, []);
    assert.equal(t.description, null);
  });

  it('maps labels array', () => {
    const t = normalizeGitHubIssue(RAW_ISSUE, []);
    assert.deepEqual(t.labels, ['bug', 'priority-high']);
  });

  it('maps components to empty array', () => {
    const t = normalizeGitHubIssue(RAW_ISSUE, []);
    assert.deepEqual(t.components, []);
  });

  it('maps linkedIssues to empty array', () => {
    const t = normalizeGitHubIssue(RAW_ISSUE, []);
    assert.deepEqual(t.linkedIssues, []);
  });

  it('maps attachments to empty array', () => {
    const t = normalizeGitHubIssue(RAW_ISSUE, []);
    assert.deepEqual(t.attachments, []);
  });

  it('maps comments array', () => {
    const t = normalizeGitHubIssue(RAW_ISSUE, RAW_COMMENTS);
    assert.equal(t.comments.length, 2);
    assert.equal(t.comments[0].author, 'carol');
    assert.equal(t.comments[0].body, 'Confirmed on Firefox.');
    assert.equal(t.comments[0].created, '2024-01-15T11:00:00Z');
  });

  it('handles missing assignee gracefully', () => {
    const t = normalizeGitHubIssue({ ...RAW_ISSUE, assignee: null, assignees: [] }, []);
    assert.equal(t.assignee, null);
  });
});

// ---------------------------------------------------------------------------
// createGitHubAdapter — type and shape
// ---------------------------------------------------------------------------
describe('createGitHubAdapter', () => {
  it('returns type github', () => {
    const adapter = createGitHubAdapter(CONN, { fetcher: async () => {} });
    assert.equal(adapter.type, 'github');
  });

  it('exposes all four methods', () => {
    const adapter = createGitHubAdapter(CONN, { fetcher: async () => {} });
    assert.equal(typeof adapter.fetchTicket, 'function');
    assert.equal(typeof adapter.fetchCurrentUser, 'function');
    assert.equal(typeof adapter.searchTickets, 'function');
    assert.equal(typeof adapter.fetchStatuses, 'function');
  });

  it('throws when baseUrl has no repo path', () => {
    assert.throws(
      () => createGitHubAdapter({ ...CONN, baseUrl: 'https://github.com' }),
      /OWNER\/REPO/,
    );
  });
});

// ---------------------------------------------------------------------------
// fetchTicket
// ---------------------------------------------------------------------------
describe('fetchTicket', () => {
  it('fetches issue and comments and returns normalized ticket', async () => {
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      if (url.endsWith('/comments')) return makeCommentsResponse();
      return makeIssueResponse();
    };
    const adapter = createGitHubAdapter(CONN, { fetcher });
    const ticket = await adapter.fetchTicket('WGT-42');
    assert.equal(ticket.key, 'WGT-42');
    assert.equal(ticket.summary, 'Fix the widget');
    assert.equal(ticket.comments.length, 2);
  });

  it('calls the correct GitHub API URL', async () => {
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      if (url.endsWith('/comments')) return makeCommentsResponse([]);
      return makeIssueResponse();
    };
    const adapter = createGitHubAdapter(CONN, { fetcher });
    await adapter.fetchTicket('WGT-42');
    assert.ok(calls.some(u => u.includes('/repos/acme/widgets/issues/42')), `expected issue URL, got: ${calls}`);
    assert.ok(calls.some(u => u.endsWith('/comments')), `expected comments URL, got: ${calls}`);
  });

  it('sends Authorization header with token', async () => {
    let capturedAuth;
    const fetcher = async (url, opts) => {
      capturedAuth = opts?.headers?.Authorization;
      if (url.endsWith('/comments')) return makeCommentsResponse([]);
      return makeIssueResponse();
    };
    const adapter = createGitHubAdapter(CONN, { fetcher });
    await adapter.fetchTicket('WGT-42');
    assert.equal(capturedAuth, 'Bearer ghp_test_token');
  });

  it('throws on non-OK issue response', async () => {
    const fetcher = async (url) => {
      if (url.endsWith('/comments')) return makeCommentsResponse([], 200);
      return makeIssueResponse(RAW_ISSUE, 404);
    };
    const adapter = createGitHubAdapter(CONN, { fetcher });
    await assert.rejects(adapter.fetchTicket('WGT-99'), /GitHub API error 404/);
  });

  it('uses empty comments array when comments fetch fails', async () => {
    const fetcher = async (url) => {
      if (url.endsWith('/comments')) return makeCommentsResponse([], 403);
      return makeIssueResponse();
    };
    const adapter = createGitHubAdapter(CONN, { fetcher });
    const ticket = await adapter.fetchTicket('WGT-42');
    assert.deepEqual(ticket.comments, []);
  });

  it('extracts issue number from multi-word prefix key', async () => {
    const calls = [];
    const fetcher = async (url) => {
      calls.push(url);
      if (url.endsWith('/comments')) return makeCommentsResponse([]);
      return makeIssueResponse();
    };
    const conn = { ...CONN, ticketPrefixes: ['ACME'] };
    const adapter = createGitHubAdapter(conn, { fetcher });
    await adapter.fetchTicket('ACME-42');
    assert.ok(calls.some(u => u.includes('/issues/42')));
  });
});

// ---------------------------------------------------------------------------
// fetchCurrentUser
// ---------------------------------------------------------------------------
describe('fetchCurrentUser', () => {
  it('returns displayName and email', async () => {
    const fetcher = async () => ({
      ok: true,
      json: async () => ({ login: 'alice', name: 'Alice Smith', email: 'alice@example.com' }),
    });
    const adapter = createGitHubAdapter(CONN, { fetcher });
    const user = await adapter.fetchCurrentUser();
    assert.equal(user.displayName, 'Alice Smith');
    assert.equal(user.email, 'alice@example.com');
  });

  it('also returns login — the real username needed for assignment, not just a display label', async () => {
    const fetcher = async () => ({
      ok: true,
      json: async () => ({ login: 'alice', name: 'Alice Smith', email: 'alice@example.com' }),
    });
    const adapter = createGitHubAdapter(CONN, { fetcher });
    const user = await adapter.fetchCurrentUser();
    assert.equal(user.login, 'alice');
  });

  it('falls back to login when name is null', async () => {
    const fetcher = async () => ({
      ok: true,
      json: async () => ({ login: 'alice', name: null, email: null }),
    });
    const adapter = createGitHubAdapter(CONN, { fetcher });
    const user = await adapter.fetchCurrentUser();
    assert.equal(user.displayName, 'alice');
    assert.equal(user.email, null);
  });

  it('throws on non-OK response', async () => {
    const fetcher = async () => ({ ok: false, status: 401 });
    const adapter = createGitHubAdapter(CONN, { fetcher });
    await assert.rejects(adapter.fetchCurrentUser(), /GitHub API error 401/);
  });
});

// ---------------------------------------------------------------------------
// searchTickets
// ---------------------------------------------------------------------------
describe('searchTickets', () => {
  it('returns normalized tickets from open assigned issues', async () => {
    const fetcher = async () => ({
      ok: true,
      json: async () => [RAW_ISSUE, { ...RAW_ISSUE, number: 43, title: 'Another bug' }],
    });
    const adapter = createGitHubAdapter(CONN, { fetcher });
    const tickets = await adapter.searchTickets('assignee = currentUser()');
    assert.equal(tickets.length, 2);
    assert.equal(tickets[0].key, 'WGT-42');
    assert.equal(tickets[1].key, 'WGT-43');
  });

  it('returns empty array when no issues', async () => {
    const fetcher = async () => ({ ok: true, json: async () => [] });
    const adapter = createGitHubAdapter(CONN, { fetcher });
    const tickets = await adapter.searchTickets('');
    assert.deepEqual(tickets, []);
  });

  it('calls correct API endpoint', async () => {
    let capturedUrl;
    const fetcher = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => [] };
    };
    const adapter = createGitHubAdapter(CONN, { fetcher });
    await adapter.searchTickets('');
    assert.ok(capturedUrl.includes('/repos/acme/widgets/issues'), `unexpected URL: ${capturedUrl}`);
    assert.ok(capturedUrl.includes('assignee=me'), `expected assignee=me, got: ${capturedUrl}`);
  });

  it('throws on non-OK response', async () => {
    const fetcher = async () => ({ ok: false, status: 403 });
    const adapter = createGitHubAdapter(CONN, { fetcher });
    await assert.rejects(adapter.searchTickets(''), /GitHub API error 403/);
  });
});

// ---------------------------------------------------------------------------
// fetchStatuses
// ---------------------------------------------------------------------------
describe('fetchStatuses', () => {
  it('returns open and closed', async () => {
    const adapter = createGitHubAdapter(CONN, { fetcher: async () => {} });
    const statuses = await adapter.fetchStatuses();
    assert.deepEqual(statuses, ['open', 'closed']);
  });
});

// ---------------------------------------------------------------------------
// addComment
// ---------------------------------------------------------------------------
function noHeaders() { return { get: () => null }; }

describe('addComment', () => {
  it('posts to the issue comments endpoint and returns id/url', async () => {
    const calls = [];
    const fetcher = async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 201, headers: noHeaders(), json: async () => ({ id: 555, html_url: 'https://github.com/acme/widgets/issues/42#issuecomment-555' }) };
    };
    const adapter = createGitHubAdapter(CONN, { fetcher });
    const result = await adapter.addComment('WGT-42', 'looks good');
    assert.equal(calls[0].url, 'https://api.github.com/repos/acme/widgets/issues/42/comments');
    assert.equal(calls[0].opts.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].opts.body), { body: 'looks good' });
    assert.equal(result.id, '555');
  });

  it('throws with .status on non-OK response', async () => {
    const fetcher = async () => ({ ok: false, status: 404, headers: noHeaders(), json: async () => ({ message: 'Not Found' }) });
    const adapter = createGitHubAdapter(CONN, { fetcher });
    await assert.rejects(adapter.addComment('WGT-42', 'x'), (err) => err.status === 404);
  });

  it('classifies a primary rate limit (403, remaining=0, no retry-after)', async () => {
    const headers = { get: (k) => (k === 'x-ratelimit-remaining' ? '0' : k === 'x-ratelimit-reset' ? '1700000000' : null) };
    const fetcher = async () => ({ ok: false, status: 403, headers, json: async () => ({}) });
    const adapter = createGitHubAdapter(CONN, { fetcher });
    await assert.rejects(adapter.addComment('WGT-42', 'x'), (err) => err.rateLimit?.kind === 'primary-rate-limit' && err.rateLimit.resetAt === 1700000000);
  });

  it('classifies a secondary rate limit (403 with retry-after)', async () => {
    const headers = { get: (k) => (k === 'retry-after' ? '30' : null) };
    const fetcher = async () => ({ ok: false, status: 403, headers, json: async () => ({}) });
    const adapter = createGitHubAdapter(CONN, { fetcher });
    await assert.rejects(adapter.addComment('WGT-42', 'x'), (err) => err.rateLimit?.kind === 'secondary-rate-limit' && err.rateLimit.retryAfterSeconds === 30);
  });

  it('classifies a secondary rate limit with default backoff (403, no retry-after, remaining not 0)', async () => {
    const headers = { get: () => null };
    const fetcher = async () => ({ ok: false, status: 403, headers, json: async () => ({}) });
    const adapter = createGitHubAdapter(CONN, { fetcher });
    await assert.rejects(adapter.addComment('WGT-42', 'x'), (err) => err.rateLimit?.kind === 'secondary-rate-limit' && err.rateLimit.retryAfterSeconds === 60);
  });
});

// ---------------------------------------------------------------------------
// getTransitions / transition
// ---------------------------------------------------------------------------
describe('getTransitions', () => {
  it('offers "closed" when issue is open', async () => {
    const fetcher = async (url) => {
      if (url.endsWith('/comments')) return makeCommentsResponse([]);
      return makeIssueResponse({ ...RAW_ISSUE, state: 'open' });
    };
    const adapter = createGitHubAdapter(CONN, { fetcher });
    const options = await adapter.getTransitions('WGT-42');
    assert.deepEqual(options, [{ id: 'closed', name: 'Close issue', to: 'closed' }]);
  });

  it('offers "open" when issue is closed', async () => {
    const fetcher = async (url) => {
      if (url.endsWith('/comments')) return makeCommentsResponse([]);
      return makeIssueResponse({ ...RAW_ISSUE, state: 'closed' });
    };
    const adapter = createGitHubAdapter(CONN, { fetcher });
    const options = await adapter.getTransitions('WGT-42');
    assert.deepEqual(options, [{ id: 'open', name: 'Reopen issue', to: 'open' }]);
  });
});

describe('transition', () => {
  it('PATCHes state and returns executed:true on a valid target', async () => {
    const calls = [];
    const fetcher = async (url, opts) => {
      calls.push({ url, opts });
      if (url.endsWith('/comments')) return makeCommentsResponse([]);
      if (opts?.method === 'PATCH') return { ok: true, status: 200, headers: noHeaders(), json: async () => ({}) };
      return makeIssueResponse({ ...RAW_ISSUE, state: 'open' });
    };
    const adapter = createGitHubAdapter(CONN, { fetcher });
    const result = await adapter.transition('WGT-42', 'closed');
    assert.deepEqual(result, { executed: true, to: 'closed' });
    const patch = calls.find(c => c.opts?.method === 'PATCH');
    assert.deepEqual(JSON.parse(patch.opts.body), { state: 'closed' });
  });

  it('is idempotent — returns executed:false when already in target state, no PATCH sent', async () => {
    let patchCalled = false;
    const fetcher = async (url, opts) => {
      if (opts?.method === 'PATCH') patchCalled = true;
      if (url.endsWith('/comments')) return makeCommentsResponse([]);
      return makeIssueResponse({ ...RAW_ISSUE, state: 'open' });
    };
    const adapter = createGitHubAdapter(CONN, { fetcher });
    const result = await adapter.transition('WGT-42', 'open');
    assert.equal(result.executed, false);
    assert.equal(result.reason, 'already-in-target-state');
    assert.equal(patchCalled, false);
  });

  it('returns executed:false with reason not-found for an unresolvable target', async () => {
    let patchCalled = false;
    const fetcher = async (url, opts) => {
      if (opts?.method === 'PATCH') patchCalled = true;
      if (url.endsWith('/comments')) return makeCommentsResponse([]);
      return makeIssueResponse({ ...RAW_ISSUE, state: 'open' });
    };
    const adapter = createGitHubAdapter(CONN, { fetcher });
    const result = await adapter.transition('WGT-42', 'in-review');
    assert.equal(result.executed, false);
    assert.equal(result.reason, 'not-found');
    assert.equal(patchCalled, false);
  });

  it('throws with .status on a failed PATCH', async () => {
    const fetcher = async (url, opts) => {
      if (url.endsWith('/comments')) return makeCommentsResponse([]);
      if (opts?.method === 'PATCH') return { ok: false, status: 422, headers: noHeaders(), json: async () => ({ message: 'Unprocessable' }) };
      return makeIssueResponse({ ...RAW_ISSUE, state: 'open' });
    };
    const adapter = createGitHubAdapter(CONN, { fetcher });
    await assert.rejects(adapter.transition('WGT-42', 'closed'), (err) => err.status === 422);
  });
});

// ---------------------------------------------------------------------------
// assignToSelf
// ---------------------------------------------------------------------------
describe('assignToSelf', () => {
  it('PATCHes the issue with the current user login as sole assignee', async () => {
    const calls = [];
    const fetcher = async (url, opts) => {
      calls.push({ url, opts });
      if (url.endsWith('/user')) return { ok: true, json: async () => ({ login: 'alice', name: 'Alice Smith', email: 'alice@example.com' }) };
      return { ok: true, status: 200, headers: noHeaders(), json: async () => ({}) };
    };
    const adapter = createGitHubAdapter(CONN, { fetcher });
    const result = await adapter.assignToSelf('WGT-42');
    const patch = calls.find(c => c.opts?.method === 'PATCH');
    assert.equal(patch.url, 'https://api.github.com/repos/acme/widgets/issues/42');
    assert.deepEqual(JSON.parse(patch.opts.body), { assignees: ['alice'] });
    assert.equal(result.assignee, 'Alice Smith');
  });

  it('throws with .status on a failed PATCH', async () => {
    const fetcher = async (url, opts) => {
      if (url.endsWith('/user')) return { ok: true, json: async () => ({ login: 'alice' }) };
      return { ok: false, status: 422, headers: noHeaders(), json: async () => ({ message: 'Unprocessable' }) };
    };
    const adapter = createGitHubAdapter(CONN, { fetcher });
    await assert.rejects(adapter.assignToSelf('WGT-42'), (err) => err.status === 422);
  });

  it('refuses to assign when login is missing — never sends an incomplete assignees array', async () => {
    let patchCalled = false;
    const fetcher = async (url, opts) => {
      if (opts?.method === 'PATCH') patchCalled = true;
      if (url.endsWith('/user')) return { ok: true, json: async () => ({ login: null, name: 'Alice' }) };
      return { ok: true, status: 200, headers: noHeaders(), json: async () => ({}) };
    };
    const adapter = createGitHubAdapter(CONN, { fetcher });
    await assert.rejects(() => adapter.assignToSelf('WGT-42'), /login/);
    assert.equal(patchCalled, false);
  });
});
