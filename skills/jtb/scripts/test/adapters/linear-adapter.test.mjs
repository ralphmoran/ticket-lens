import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLinearAdapter, normalizeLinearIssue } from '../../lib/adapters/linear-adapter.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const RAW_NODE = {
  identifier: 'ENG-42',
  title: 'Fix the widget',
  description: 'Widget breaks on scroll.',
  state: { name: 'In Progress' },
  priority: 2,
  assignee: { name: 'Bob Smith', email: 'bob@example.com' },
  creator: { name: 'Alice Jones', email: 'alice@example.com' },
  createdAt: '2024-01-15T10:00:00.000Z',
  updatedAt: '2024-01-16T12:00:00.000Z',
  labels: { nodes: [{ name: 'bug' }, { name: 'priority-high' }] },
  comments: {
    nodes: [
      { user: { name: 'Carol', email: 'carol@example.com' }, body: 'Confirmed on Firefox.', createdAt: '2024-01-15T11:00:00.000Z' },
      { user: { name: 'Bob Smith', email: 'bob@example.com' }, body: 'Working on it.', createdAt: '2024-01-15T14:00:00.000Z' },
    ],
  },
};

const CONN = { baseUrl: 'https://linear.app/ticketlens', apiToken: 'lin_api_test_token' };

const LINEAR_API = 'https://api.linear.app/graphql';

function makeResponse(data, status = 200) {
  return { ok: status < 400, status, statusText: status === 200 ? 'OK' : 'Error', json: async () => ({ data }) };
}

function makeErrorResponse(status) {
  return { ok: false, status, statusText: 'Unauthorized', json: async () => ({}), text: async () => '' };
}

// ---------------------------------------------------------------------------
// normalizeLinearIssue
// ---------------------------------------------------------------------------
describe('normalizeLinearIssue', () => {
  it('maps key from identifier', () => {
    assert.equal(normalizeLinearIssue(RAW_NODE).key, 'ENG-42');
  });

  it('maps summary to title', () => {
    assert.equal(normalizeLinearIssue(RAW_NODE).summary, 'Fix the widget');
  });

  it('maps type to Issue', () => {
    assert.equal(normalizeLinearIssue(RAW_NODE).type, 'Issue');
  });

  it('maps status from state.name', () => {
    assert.equal(normalizeLinearIssue(RAW_NODE).status, 'In Progress');
  });

  it('maps null state to null status', () => {
    assert.equal(normalizeLinearIssue({ ...RAW_NODE, state: null }).status, null);
  });

  it('maps priority 2 to High', () => {
    assert.equal(normalizeLinearIssue(RAW_NODE).priority, 'High');
  });

  it('maps priority 1 to Urgent', () => {
    assert.equal(normalizeLinearIssue({ ...RAW_NODE, priority: 1 }).priority, 'Urgent');
  });

  it('maps priority 3 to Medium', () => {
    assert.equal(normalizeLinearIssue({ ...RAW_NODE, priority: 3 }).priority, 'Medium');
  });

  it('maps priority 4 to Low', () => {
    assert.equal(normalizeLinearIssue({ ...RAW_NODE, priority: 4 }).priority, 'Low');
  });

  it('maps priority 0 (no priority) to null', () => {
    assert.equal(normalizeLinearIssue({ ...RAW_NODE, priority: 0 }).priority, null);
  });

  it('maps assignee from name', () => {
    assert.equal(normalizeLinearIssue(RAW_NODE).assignee, 'Bob Smith');
  });

  it('maps null assignee to null', () => {
    assert.equal(normalizeLinearIssue({ ...RAW_NODE, assignee: null }).assignee, null);
  });

  it('maps reporter from creator name', () => {
    assert.equal(normalizeLinearIssue(RAW_NODE).reporter, 'Alice Jones');
  });

  it('maps null creator to null reporter', () => {
    assert.equal(normalizeLinearIssue({ ...RAW_NODE, creator: null }).reporter, null);
  });

  it('maps description', () => {
    assert.equal(normalizeLinearIssue(RAW_NODE).description, 'Widget breaks on scroll.');
  });

  it('maps null description to null', () => {
    assert.equal(normalizeLinearIssue({ ...RAW_NODE, description: null }).description, null);
  });

  it('maps createdAt', () => {
    assert.equal(normalizeLinearIssue(RAW_NODE).created, '2024-01-15T10:00:00.000Z');
  });

  it('maps updatedAt', () => {
    assert.equal(normalizeLinearIssue(RAW_NODE).updated, '2024-01-16T12:00:00.000Z');
  });

  it('maps labels from nodes array', () => {
    assert.deepEqual(normalizeLinearIssue(RAW_NODE).labels, ['bug', 'priority-high']);
  });

  it('handles missing labels gracefully', () => {
    assert.deepEqual(normalizeLinearIssue({ ...RAW_NODE, labels: null }).labels, []);
  });

  it('maps components to empty array', () => {
    assert.deepEqual(normalizeLinearIssue(RAW_NODE).components, []);
  });

  it('maps linkedIssues to empty array', () => {
    assert.deepEqual(normalizeLinearIssue(RAW_NODE).linkedIssues, []);
  });

  it('maps attachments to empty array', () => {
    assert.deepEqual(normalizeLinearIssue(RAW_NODE).attachments, []);
  });

  it('maps comments array', () => {
    const t = normalizeLinearIssue(RAW_NODE);
    assert.equal(t.comments.length, 2);
    assert.equal(t.comments[0].author, 'Carol');
    assert.equal(t.comments[0].body, 'Confirmed on Firefox.');
    assert.equal(t.comments[0].created, '2024-01-15T11:00:00.000Z');
  });

  it('maps comment authorName from user.name', () => {
    const t = normalizeLinearIssue(RAW_NODE);
    assert.equal(t.comments[0].authorName, 'Carol');
  });

  it('maps comment authorAccountId to null', () => {
    const t = normalizeLinearIssue(RAW_NODE);
    assert.equal(t.comments[0].authorAccountId, null);
  });

  it('handles missing comments gracefully', () => {
    assert.deepEqual(normalizeLinearIssue({ ...RAW_NODE, comments: null }).comments, []);
  });
});

// ---------------------------------------------------------------------------
// createLinearAdapter — shape
// ---------------------------------------------------------------------------
describe('createLinearAdapter', () => {
  it('returns type linear', () => {
    const adapter = createLinearAdapter(CONN, { fetcher: async () => {} });
    assert.equal(adapter.type, 'linear');
  });

  it('exposes all four methods', () => {
    const adapter = createLinearAdapter(CONN, { fetcher: async () => {} });
    assert.equal(typeof adapter.fetchTicket, 'function');
    assert.equal(typeof adapter.fetchCurrentUser, 'function');
    assert.equal(typeof adapter.searchTickets, 'function');
    assert.equal(typeof adapter.fetchStatuses, 'function');
  });

  it('accepts pat as fallback for apiToken', () => {
    const adapter = createLinearAdapter({ ...CONN, apiToken: undefined, pat: 'lin_pat_xxx' }, { fetcher: async () => {} });
    assert.equal(adapter.type, 'linear');
  });
});

// ---------------------------------------------------------------------------
// fetchTicket
// ---------------------------------------------------------------------------
describe('fetchTicket', () => {
  it('returns normalized ticket for happy path', async () => {
    const fetcher = async () => makeResponse({ issues: { nodes: [RAW_NODE] } });
    const adapter = createLinearAdapter(CONN, { fetcher });
    const ticket = await adapter.fetchTicket('ENG-42');
    assert.equal(ticket.key, 'ENG-42');
    assert.equal(ticket.summary, 'Fix the widget');
    assert.equal(ticket.comments.length, 2);
  });

  it('sends POST to linear GraphQL endpoint', async () => {
    let capturedUrl, capturedMethod;
    const fetcher = async (url, opts) => {
      capturedUrl = url;
      capturedMethod = opts?.method;
      return makeResponse({ issues: { nodes: [RAW_NODE] } });
    };
    const adapter = createLinearAdapter(CONN, { fetcher });
    await adapter.fetchTicket('ENG-42');
    assert.equal(capturedUrl, LINEAR_API);
    assert.equal(capturedMethod, 'POST');
  });

  it('sends Authorization Bearer header', async () => {
    let capturedAuth;
    const fetcher = async (_, opts) => {
      capturedAuth = opts?.headers?.Authorization;
      return makeResponse({ issues: { nodes: [RAW_NODE] } });
    };
    const adapter = createLinearAdapter(CONN, { fetcher });
    await adapter.fetchTicket('ENG-42');
    assert.equal(capturedAuth, 'lin_api_test_token');
  });

  it('sends identifier as GraphQL variable', async () => {
    let capturedVariables;
    const fetcher = async (_, opts) => {
      capturedVariables = JSON.parse(opts.body).variables;
      return makeResponse({ issues: { nodes: [RAW_NODE] } });
    };
    const adapter = createLinearAdapter(CONN, { fetcher });
    await adapter.fetchTicket('ENG-42');
    assert.deepEqual(capturedVariables, { id: 'ENG-42' });
  });

  it('throws when issue not found (empty nodes)', async () => {
    const fetcher = async () => makeResponse({ issues: { nodes: [] } });
    const adapter = createLinearAdapter(CONN, { fetcher });
    await assert.rejects(adapter.fetchTicket('ENG-99'), /not found: ENG-99/);
  });

  it('throws on non-OK HTTP response', async () => {
    const fetcher = async () => makeErrorResponse(401);
    const adapter = createLinearAdapter(CONN, { fetcher });
    await assert.rejects(adapter.fetchTicket('ENG-42'), /Linear API error 401/);
  });

  it('throws on GraphQL errors array', async () => {
    const fetcher = async () => ({
      ok: true, status: 200,
      json: async () => ({ errors: [{ message: 'Not authenticated' }] }),
    });
    const adapter = createLinearAdapter(CONN, { fetcher });
    await assert.rejects(adapter.fetchTicket('ENG-42'), /Not authenticated/);
  });
});

// ---------------------------------------------------------------------------
// fetchCurrentUser
// ---------------------------------------------------------------------------
describe('fetchCurrentUser', () => {
  it('returns displayName (from name) and email', async () => {
    const fetcher = async () => makeResponse({
      viewer: { id: 'user-uuid-1', name: 'Alice Jones', email: 'alice@example.com' },
    });
    const adapter = createLinearAdapter(CONN, { fetcher });
    const user = await adapter.fetchCurrentUser();
    assert.equal(user.displayName, 'Alice Jones');
    assert.equal(user.email, 'alice@example.com');
  });

  it('also returns id — the internal UUID needed for assignment mutations, not just a display label', async () => {
    const fetcher = async () => makeResponse({
      viewer: { id: 'user-uuid-1', name: 'Alice Jones', email: 'alice@example.com' },
    });
    const adapter = createLinearAdapter(CONN, { fetcher });
    const user = await adapter.fetchCurrentUser();
    assert.equal(user.id, 'user-uuid-1');
  });

  it('throws on non-OK response', async () => {
    const fetcher = async () => makeErrorResponse(403);
    const adapter = createLinearAdapter(CONN, { fetcher });
    await assert.rejects(adapter.fetchCurrentUser(), /Linear API error 403/);
  });
});

// ---------------------------------------------------------------------------
// searchTickets
// ---------------------------------------------------------------------------
describe('searchTickets', () => {
  it('returns normalized tickets from assignedIssues', async () => {
    const fetcher = async () => makeResponse({
      viewer: {
        assignedIssues: {
          nodes: [RAW_NODE, { ...RAW_NODE, identifier: 'ENG-43', title: 'Another bug' }],
        },
      },
    });
    const adapter = createLinearAdapter(CONN, { fetcher });
    const tickets = await adapter.searchTickets('assignee = currentUser()');
    assert.equal(tickets.length, 2);
    assert.equal(tickets[0].key, 'ENG-42');
    assert.equal(tickets[1].key, 'ENG-43');
  });

  it('returns empty array when no assigned issues', async () => {
    const fetcher = async () => makeResponse({ viewer: { assignedIssues: { nodes: [] } } });
    const adapter = createLinearAdapter(CONN, { fetcher });
    const tickets = await adapter.searchTickets('');
    assert.deepEqual(tickets, []);
  });

  it('sends query containing assignedIssues', async () => {
    let capturedQuery;
    const fetcher = async (_, opts) => {
      capturedQuery = JSON.parse(opts.body).query;
      return makeResponse({ viewer: { assignedIssues: { nodes: [] } } });
    };
    const adapter = createLinearAdapter(CONN, { fetcher });
    await adapter.searchTickets('');
    assert.ok(capturedQuery.includes('assignedIssues'), `expected assignedIssues in query: ${capturedQuery}`);
  });

  it('throws on non-OK response', async () => {
    const fetcher = async () => makeErrorResponse(500);
    const adapter = createLinearAdapter(CONN, { fetcher });
    await assert.rejects(adapter.searchTickets(''), /Linear API error 500/);
  });
});

// ---------------------------------------------------------------------------
// fetchStatuses
// ---------------------------------------------------------------------------
describe('fetchStatuses', () => {
  it('returns workflow state names', async () => {
    const fetcher = async () => makeResponse({
      workflowStates: { nodes: [{ name: 'Todo' }, { name: 'In Progress' }, { name: 'Done' }] },
    });
    const adapter = createLinearAdapter(CONN, { fetcher });
    const statuses = await adapter.fetchStatuses();
    assert.deepEqual(statuses, ['Todo', 'In Progress', 'Done']);
  });

  it('returns empty array when no workflow states', async () => {
    const fetcher = async () => makeResponse({ workflowStates: { nodes: [] } });
    const adapter = createLinearAdapter(CONN, { fetcher });
    const statuses = await adapter.fetchStatuses();
    assert.deepEqual(statuses, []);
  });
});

// ---------------------------------------------------------------------------
// addComment
// ---------------------------------------------------------------------------
const ISSUE_INFO = { id: 'issue-uuid-1', state: { id: 'state-in-progress', name: 'In Progress' }, team: { id: 'team-uuid-1' } };

function sequencedFetcher(responses) {
  let i = 0;
  return async () => responses[Math.min(i++, responses.length - 1)]();
}

describe('addComment', () => {
  it('resolves the identifier to an internal id, then mutates using that id (not the identifier string)', async () => {
    const calls = [];
    const fetcher = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body);
      if (calls.length === 1) return makeResponse({ issues: { nodes: [ISSUE_INFO] } });
      return makeResponse({ commentCreate: { success: true, comment: { id: 'comment-1', url: 'https://linear.app/x/issue/ENG-42#comment-1' } } });
    };
    const adapter = createLinearAdapter(CONN, { fetcher });
    const result = await adapter.addComment('ENG-42', 'looks good');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].variables.issueId, 'issue-uuid-1');
    assert.notEqual(calls[1].variables.issueId, 'ENG-42');
    assert.equal(result.id, 'comment-1');
  });

  it('throws when commentCreate reports success:false despite HTTP 200 and no GraphQL errors', async () => {
    const fetcher = sequencedFetcher([
      () => makeResponse({ issues: { nodes: [ISSUE_INFO] } }),
      () => makeResponse({ commentCreate: { success: false, comment: null } }),
    ]);
    const adapter = createLinearAdapter(CONN, { fetcher });
    await assert.rejects(adapter.addComment('ENG-42', 'x'), /success:false/);
  });

  it('throws when the issue identifier cannot be resolved', async () => {
    const fetcher = async () => makeResponse({ issues: { nodes: [] } });
    const adapter = createLinearAdapter(CONN, { fetcher });
    await assert.rejects(adapter.addComment('ENG-99', 'x'), /not found: ENG-99/);
  });
});

// ---------------------------------------------------------------------------
// getTransitions
// ---------------------------------------------------------------------------
describe('getTransitions', () => {
  it('returns team-scoped states, excluding the current one', async () => {
    const fetcher = sequencedFetcher([
      () => makeResponse({ issues: { nodes: [ISSUE_INFO] } }),
      () => makeResponse({ workflowStates: { nodes: [
        { id: 'state-in-progress', name: 'In Progress' },
        { id: 'state-todo', name: 'Todo' },
        { id: 'state-done', name: 'Done' },
      ] } }),
    ]);
    const adapter = createLinearAdapter(CONN, { fetcher });
    const options = await adapter.getTransitions('ENG-42');
    assert.deepEqual(options, [
      { id: 'state-todo', name: 'Todo', to: 'Todo' },
      { id: 'state-done', name: 'Done', to: 'Done' },
    ]);
  });

  it('scopes the workflowStates query to the issue team id', async () => {
    const calls = [];
    const fetcher = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body);
      if (calls.length === 1) return makeResponse({ issues: { nodes: [ISSUE_INFO] } });
      return makeResponse({ workflowStates: { nodes: [] } });
    };
    const adapter = createLinearAdapter(CONN, { fetcher });
    await adapter.getTransitions('ENG-42');
    assert.equal(calls[1].variables.teamId, 'team-uuid-1');
  });
});

// ---------------------------------------------------------------------------
// transition
// ---------------------------------------------------------------------------
describe('transition', () => {
  const STATES = [
    { id: 'state-in-progress', name: 'In Progress' },
    { id: 'state-todo', name: 'Todo' },
    { id: 'state-done', name: 'Done' },
  ];

  it('resolves target by name, mutates using the resolved stateId, and reports success', async () => {
    const calls = [];
    const fetcher = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body);
      if (calls.length === 1) return makeResponse({ issues: { nodes: [ISSUE_INFO] } });
      if (calls.length === 2) return makeResponse({ workflowStates: { nodes: STATES } });
      return makeResponse({ issueUpdate: { success: true } });
    };
    const adapter = createLinearAdapter(CONN, { fetcher });
    const result = await adapter.transition('ENG-42', 'done');
    assert.deepEqual(result, { executed: true, to: 'Done' });
    assert.equal(calls[2].variables.stateId, 'state-done');
    assert.equal(calls[2].variables.id, 'issue-uuid-1');
  });

  it('returns executed:false with options when target does not resolve, without ever calling issueUpdate', async () => {
    let mutationCalled = false;
    const fetcher = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.query.includes('issueUpdate')) mutationCalled = true;
      if (body.query.includes('workflowStates')) return makeResponse({ workflowStates: { nodes: STATES } });
      return makeResponse({ issues: { nodes: [ISSUE_INFO] } });
    };
    const adapter = createLinearAdapter(CONN, { fetcher });
    const result = await adapter.transition('ENG-42', 'nonexistent-state');
    assert.equal(result.executed, false);
    assert.equal(result.reason, 'not-found');
    assert.equal(mutationCalled, false);
  });

  it('returns executed:false reason mutation-rejected when issueUpdate reports success:false (permission denial, no top-level errors)', async () => {
    const fetcher = sequencedFetcher([
      () => makeResponse({ issues: { nodes: [ISSUE_INFO] } }),
      () => makeResponse({ workflowStates: { nodes: STATES } }),
      () => makeResponse({ issueUpdate: { success: false } }),
    ]);
    const adapter = createLinearAdapter(CONN, { fetcher });
    const result = await adapter.transition('ENG-42', 'done');
    assert.equal(result.executed, false);
    assert.equal(result.reason, 'mutation-rejected');
  });
});

// ---------------------------------------------------------------------------
// assignToSelf
// ---------------------------------------------------------------------------
describe('assignToSelf', () => {
  it('resolves the issue internal id and the viewer id, then mutates using both', async () => {
    const calls = [];
    const fetcher = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      calls.push(body);
      if (calls.length === 1) return makeResponse({ viewer: { id: 'user-uuid-1', name: 'Alice Jones', email: 'a@x.com' } });
      if (calls.length === 2) return makeResponse({ issues: { nodes: [ISSUE_INFO] } });
      return makeResponse({ issueUpdate: { success: true } });
    };
    const adapter = createLinearAdapter(CONN, { fetcher });
    const result = await adapter.assignToSelf('ENG-42');
    assert.equal(calls.length, 3);
    assert.equal(calls[2].variables.id, 'issue-uuid-1');
    assert.equal(calls[2].variables.assigneeId, 'user-uuid-1');
    assert.equal(result.assignee, 'Alice Jones');
  });

  it('throws when issueUpdate reports success:false', async () => {
    const fetcher = sequencedFetcher([
      () => makeResponse({ viewer: { id: 'user-uuid-1', name: 'Alice Jones', email: 'a@x.com' } }),
      () => makeResponse({ issues: { nodes: [ISSUE_INFO] } }),
      () => makeResponse({ issueUpdate: { success: false } }),
    ]);
    const adapter = createLinearAdapter(CONN, { fetcher });
    await assert.rejects(adapter.assignToSelf('ENG-42'), /success:false/);
  });

  it('refuses to assign when id is missing — never sends an incomplete assigneeId mutation', async () => {
    let mutationCalled = false;
    const fetcher = async (_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.query.includes('issueUpdate')) mutationCalled = true;
      return makeResponse({ viewer: { id: null, name: 'Alice Jones', email: 'a@x.com' } });
    };
    const adapter = createLinearAdapter(CONN, { fetcher });
    await assert.rejects(() => adapter.assignToSelf('ENG-42'), /id/);
    assert.equal(mutationCalled, false);
  });
});

// ---------------------------------------------------------------------------
// findCandidates
// ---------------------------------------------------------------------------
describe('findCandidates', () => {
  it('scopes the filter to the team derived from the source key prefix and ORs across tokenized terms', async () => {
    let capturedVariables;
    const fetcher = async (_url, opts) => {
      capturedVariables = JSON.parse(opts.body).variables;
      return makeResponse({ issues: { nodes: [] } });
    };
    const adapter = createLinearAdapter(CONN, { fetcher });
    await adapter.findCandidates('Login button broken', 'ENG-42');
    assert.equal(capturedVariables.filter.team.key.eq, 'ENG');
    const orTerms = capturedVariables.filter.or.map(f => f.title.containsIgnoreCase);
    assert.ok(orTerms.includes('login'));
    assert.ok(orTerms.includes('button'));
    assert.ok(orTerms.includes('broken'));
  });

  it('normalizes returned nodes and excludes the source issue by identifier', async () => {
    const fetcher = async () => makeResponse({
      issues: { nodes: [RAW_NODE, { ...RAW_NODE, identifier: 'ENG-43', title: 'Another bug' }] },
    });
    const adapter = createLinearAdapter(CONN, { fetcher });
    const results = await adapter.findCandidates('bug', 'ENG-42');
    assert.equal(results.length, 1);
    assert.equal(results[0].key, 'ENG-43');
  });

  it('returns an empty array without a network call when the text has no meaningful tokens', async () => {
    let called = false;
    const fetcher = async () => { called = true; return makeResponse({ issues: { nodes: [] } }); };
    const adapter = createLinearAdapter(CONN, { fetcher });
    const results = await adapter.findCandidates('a an the', 'ENG-42');
    assert.deepEqual(results, []);
    assert.equal(called, false);
  });

  it('throws on a non-ok response', async () => {
    const fetcher = async () => makeErrorResponse(401);
    const adapter = createLinearAdapter(CONN, { fetcher });
    await assert.rejects(adapter.findCandidates('login', 'ENG-42'));
  });

  it('rejects a sourceKey with no hyphen instead of silently deriving a wrong/empty team scope', async () => {
    let called = false;
    const fetcher = async () => { called = true; return makeResponse({ issues: { nodes: [] } }); };
    const adapter = createLinearAdapter(CONN, { fetcher });
    await assert.rejects(() => adapter.findCandidates('login', 'NOHYPHEN'), /team/);
    assert.equal(called, false);
  });
});
