import { tokenize } from '../duplicate-scorer.mjs';

const LINEAR_API = 'https://api.linear.app/graphql';

const PRIORITY_LABELS = { 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' };

const ISSUE_FIELDS = `
  identifier
  title
  description
  state { name }
  priority
  assignee { name email }
  creator { name email }
  createdAt
  updatedAt
  labels { nodes { name } }
  comments { nodes { body createdAt user { name email } } }
`;

/**
 * Maps a raw Linear GraphQL issue node to the normalized ticket shape.
 */
export function normalizeLinearIssue(raw) {
  return {
    key: raw.identifier,
    summary: raw.title,
    type: 'Issue',
    status: raw.state?.name ?? null,
    priority: PRIORITY_LABELS[raw.priority] ?? null,
    assignee: raw.assignee?.name ?? null,
    reporter: raw.creator?.name ?? null,
    description: raw.description ?? null,
    created: raw.createdAt ?? null,
    updated: raw.updatedAt ?? null,
    labels: (raw.labels?.nodes ?? []).map(l => l.name),
    components: [],
    comments: (raw.comments?.nodes ?? []).map(c => ({
      author: c.user?.name ?? null,
      authorAccountId: null,
      authorName: c.user?.name ?? null,
      body: c.body ?? '',
      created: c.createdAt ?? null,
    })),
    linkedIssues: [],
    attachments: [],
  };
}

async function gql(query, variables, { token, fetcher, signal }) {
  const res = await fetcher(LINEAR_API, {
    method: 'POST',
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(Object.keys(variables).length ? { query, variables } : { query }),
    signal,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Linear API error ${res.status} (${res.statusText})${detail ? ': ' + detail.slice(0, 300) : ''}`);
  }
  const { data, errors } = await res.json();
  if (errors?.length) throw new Error(`Linear GraphQL error: ${errors[0].message}`);
  return data;
}

/**
 * Resolves a human identifier (e.g. "ENG-123") to the issue's internal id
 * plus its current state and team — mutations require the UUID id, never
 * the identifier string (confirmed against Linear's own SDK docs).
 */
async function fetchIssueStateInfo(key, { token, fetcher, signal }) {
  const data = await gql(
    `query ($id: String!) {
      issues(filter: { identifier: { eq: $id } }, first: 1) {
        nodes { id state { id name } team { id } }
      }
    }`,
    { id: key },
    { token, fetcher, signal },
  );
  const node = data.issues?.nodes?.[0];
  if (!node) throw new Error(`Linear issue not found: ${key}`);
  return node;
}

async function fetchTeamWorkflowStates(teamId, { token, fetcher, signal }) {
  const data = await gql(
    `query ($teamId: ID!) {
      workflowStates(filter: { team: { id: { eq: $teamId } } }, first: 50) {
        nodes { id name }
      }
    }`,
    { teamId },
    { token, fetcher, signal },
  );
  return data.workflowStates?.nodes ?? [];
}

/**
 * Returns a tracker adapter backed by the Linear GraphQL API.
 * Profile baseUrl must contain linear.app. Auth token stored as apiToken in credentials.json.
 */
export function createLinearAdapter(conn, { fetcher = globalThis.fetch } = {}) {
  const token = conn.apiToken || conn.pat;

  return {
    type: 'linear',

    async fetchTicket(key, opts = {}) {
      const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
      const data = await gql(
        `query ($id: String!) {
          issues(filter: { identifier: { eq: $id } }, first: 1) {
            nodes { ${ISSUE_FIELDS} }
          }
        }`,
        { id: key },
        { token, fetcher, signal },
      );
      const node = data.issues?.nodes?.[0];
      if (!node) throw new Error(`Linear issue not found: ${key}`);
      return normalizeLinearIssue(node);
    },

    async fetchCurrentUser(opts = {}) {
      const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
      const data = await gql(
        `{ viewer { id name email } }`,
        {},
        { token, fetcher, signal },
      );
      const v = data.viewer;
      return { displayName: v.name, email: v.email ?? null, id: v.id };
    },

    async searchTickets(_query, opts = {}) {
      const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
      const data = await gql(
        `{
          viewer {
            assignedIssues(
              filter: { state: { type: { nin: ["completed", "cancelled"] } } }
              first: 50
            ) {
              nodes { ${ISSUE_FIELDS} }
            }
          }
        }`,
        {},
        { token, fetcher, signal },
      );
      return (data.viewer?.assignedIssues?.nodes ?? []).map(normalizeLinearIssue);
    },

    async fetchStatuses(opts = {}) {
      const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
      const data = await gql(
        `{ workflowStates(first: 50) { nodes { name } } }`,
        {},
        { token, fetcher, signal },
      );
      return (data.workflowStates?.nodes ?? []).map(s => s.name);
    },

    async addComment(key, body, opts = {}) {
      const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
      const { id: issueId } = await fetchIssueStateInfo(key, { token, fetcher, signal });
      const data = await gql(
        `mutation ($issueId: String!, $body: String!) {
          commentCreate(input: { issueId: $issueId, body: $body }) {
            success
            comment { id url }
          }
        }`,
        { issueId, body },
        { token, fetcher, signal },
      );
      if (!data.commentCreate?.success) {
        throw new Error(`Linear commentCreate reported success:false for ${key}`);
      }
      return { id: data.commentCreate.comment.id, url: data.commentCreate.comment.url ?? null };
    },

    /**
     * Scoped to the issue's own team — Linear's workflow states are
     * per-team, so an unscoped list would offer states from teams this
     * issue can never actually move into.
     */
    async getTransitions(key, opts = {}) {
      const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
      const info = await fetchIssueStateInfo(key, { token, fetcher, signal });
      const states = await fetchTeamWorkflowStates(info.team.id, { token, fetcher, signal });
      return states
        .filter(s => s.id !== info.state?.id)
        .map(s => ({ id: s.id, name: s.name, to: s.name }));
    },

    /**
     * Always re-resolves the issue's current state and team-scoped
     * options fresh before executing — a caller can never blind-mutate
     * with a stale stateId. Explicitly checks `success` on the mutation
     * payload: Linear can return HTTP 200 with no top-level GraphQL
     * `errors` and still report success:false (e.g. permission denial),
     * so absence of `errors` alone does not mean the mutation applied.
     */
    async transition(key, target, opts = {}) {
      const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
      const info = await fetchIssueStateInfo(key, { token, fetcher, signal });
      const states = await fetchTeamWorkflowStates(info.team.id, { token, fetcher, signal });
      const t = String(target).toLowerCase();
      const options = states
        .filter(s => s.id !== info.state?.id)
        .map(s => ({ id: s.id, name: s.name, to: s.name }));
      const match = options.find(o => o.id === String(target) || o.name.toLowerCase() === t);
      if (!match) {
        return { executed: false, reason: 'not-found', options };
      }
      const data = await gql(
        `mutation ($id: String!, $stateId: String!) {
          issueUpdate(id: $id, input: { stateId: $stateId }) {
            success
          }
        }`,
        { id: info.id, stateId: match.id },
        { token, fetcher, signal },
      );
      if (!data.issueUpdate?.success) {
        return { executed: false, reason: 'mutation-rejected', options };
      }
      return { executed: true, to: match.to };
    },

    /**
     * Self-assign only — arbitrary-user assignment would need a
     * user-search query this codebase doesn't have yet.
     */
    async assignToSelf(key, opts = {}) {
      const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
      const me = await this.fetchCurrentUser(opts);
      if (!me.id) {
        throw new Error(`Cannot determine current user's id — Linear did not return it for this connection.`);
      }
      const info = await fetchIssueStateInfo(key, { token, fetcher, signal });
      const data = await gql(
        `mutation ($id: String!, $assigneeId: String!) {
          issueUpdate(id: $id, input: { assigneeId: $assigneeId }) {
            success
          }
        }`,
        { id: info.id, assigneeId: me.id },
        { token, fetcher, signal },
      );
      if (!data.issueUpdate?.success) {
        throw new Error(`Linear issueUpdate reported success:false assigning ${key}`);
      }
      return { assignee: me.displayName ?? me.id };
    },

    /**
     * Candidate search for duplicate-ticket detection. Linear's `contains`/
     * `containsIgnoreCase` filters are literal substring matches, not
     * full-text search (confirmed — Linear has no built-in similarity
     * matching) — passing the whole source text as one substring filter
     * would almost never match anything. Instead ORs across the
     * significant tokens, ANDed with a team scope derived from the source
     * key's prefix. Ranking happens in duplicate-scorer.mjs.
     */
    async findCandidates(text, sourceKey, opts = {}) {
      const terms = tokenize(text).slice(0, 5);
      if (terms.length === 0) return [];
      const hyphenIndex = sourceKey.lastIndexOf('-');
      if (hyphenIndex < 1) {
        throw new Error(`Cannot derive a team key from "${sourceKey}" — expected TEAM-123.`);
      }
      const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
      const prefix = sourceKey.slice(0, hyphenIndex);
      const filter = {
        team: { key: { eq: prefix } },
        or: terms.map(term => ({ title: { containsIgnoreCase: term } })),
      };
      const data = await gql(
        `query ($filter: IssueFilter) {
          issues(filter: $filter, first: 50) {
            nodes { ${ISSUE_FIELDS} }
          }
        }`,
        { filter },
        { token, fetcher, signal },
      );
      return (data.issues?.nodes ?? [])
        .filter(node => node.identifier !== sourceKey)
        .map(normalizeLinearIssue);
    },
  };
}
