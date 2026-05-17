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
        `{ viewer { name email } }`,
        {},
        { token, fetcher, signal },
      );
      const v = data.viewer;
      return { displayName: v.name, email: v.email ?? null };
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
  };
}
