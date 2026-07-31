import { tokenize } from '../duplicate-scorer.mjs';

const LINEAR_API = 'https://api.linear.app/graphql';

const PRIORITY_LABELS = { 1: 'Urgent', 2: 'High', 3: 'Medium', 4: 'Low' };

/** Linear's IssueRelationType enum — fixed schema-level values, confirmed via GraphQL introspection. */
const LINK_TYPES = ['blocks', 'duplicate', 'related'];

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

/** Splits a list of label names into those found in `byName` (with their resolved id) and those not. */
function resolveLabelNames(names, byName) {
  const resolved = [];
  const missing = [];
  for (const name of names) {
    const id = byName.get(name.toLowerCase());
    if (id) resolved.push({ id, name }); else missing.push(name);
  }
  return { resolved, missing };
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

    /** Fixed schema-level enum (confirmed via GraphQL introspection) — never per-instance configurable, unlike Jira's link types. */
    async getLinkTypes() {
      return LINK_TYPES;
    },

    /**
     * Validates typeName against the fixed enum before ever touching the
     * network — an invalid type must never reach gql(), which throws a
     * plain Error with no .status, and would otherwise be misclassified
     * as a network/timeout failure by classifyWriteFailure. Resolves both
     * issues' internal UUIDs via fetchIssueStateInfo — issueRelationCreate
     * needs the UUID, never the human identifier. Explicitly checks
     * `success`: Linear can return HTTP 200 with no top-level GraphQL
     * errors and still report success:false.
     */
    async linkTo(sourceKey, targetKey, typeName, opts = {}) {
      const normalizedType = typeName.toLowerCase();
      if (!LINK_TYPES.includes(normalizedType)) {
        return { executed: false, reason: 'not-found', options: LINK_TYPES };
      }
      const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
      const source = await fetchIssueStateInfo(sourceKey, { token, fetcher, signal });
      const target = await fetchIssueStateInfo(targetKey, { token, fetcher, signal });
      const data = await gql(
        `mutation ($issueId: String!, $relatedIssueId: String!, $type: IssueRelationType!) {
          issueRelationCreate(input: { issueId: $issueId, relatedIssueId: $relatedIssueId, type: $type }) {
            success
          }
        }`,
        { issueId: source.id, relatedIssueId: target.id, type: normalizedType },
        { token, fetcher, signal },
      );
      if (!data.issueRelationCreate?.success) {
        throw new Error(`Linear issueRelationCreate reported success:false linking ${sourceKey} to ${targetKey}`);
      }
      return { executed: true };
    },

    /**
     * Unlike Jira's freeform label strings, Linear's addedLabelIds/
     * removedLabelIds (IssueUpdateInput) take real label UUIDs and never
     * auto-create a missing one — a name must be resolved against the
     * issue's own team first (same shape as fetchTeamWorkflowStates).
     * Resolution failures (unknown label name, unresolvable priority name)
     * are collected into `errors` and simply excluded from the mutation
     * input rather than blocking it — whatever DID resolve still lands in
     * one atomic issueUpdate call. Empty input skips the mutation entirely
     * (nothing valid to send). Priority is accepted as a display name for
     * cross-tracker consistency and reverse-mapped via the same
     * PRIORITY_LABELS table normalizeLinearIssue already uses for reads.
     */
    async updateFields(key, { title, description, priority, addLabels, removeLabels } = {}, opts = {}) {
      const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
      const info = await fetchIssueStateInfo(key, { token, fetcher, signal });

      const input = {};
      const applied = {};
      const errors = {};

      if (title !== undefined) input.title = title;
      if (description !== undefined) input.description = description;

      let resolvedPriorityLabel;
      if (priority !== undefined) {
        const normalized = priority.trim().toLowerCase();
        if (normalized === 'none') {
          input.priority = 0;
          resolvedPriorityLabel = 'None';
        } else {
          const entry = Object.entries(PRIORITY_LABELS).find(([, label]) => label.toLowerCase() === normalized);
          if (entry) {
            input.priority = Number(entry[0]);
            resolvedPriorityLabel = entry[1];
          } else {
            errors.priority = { reason: 'not-found', options: ['None', ...Object.values(PRIORITY_LABELS)] };
          }
        }
      }

      let addLabelsResolved, addLabelsMissing, removeLabelsResolved, removeLabelsMissing;
      if (addLabels?.length || removeLabels?.length) {
        const labelData = await gql(
          `query ($teamId: ID!) { issueLabels(filter: { team: { id: { eq: $teamId } } }, first: 250) { nodes { id name } } }`,
          { teamId: info.team.id },
          { token, fetcher, signal },
        );
        const byName = new Map((labelData.issueLabels?.nodes ?? []).map(l => [l.name.toLowerCase(), l.id]));

        if (addLabels?.length) {
          ({ resolved: addLabelsResolved, missing: addLabelsMissing } = resolveLabelNames(addLabels, byName));
          if (addLabelsResolved.length) input.addedLabelIds = addLabelsResolved.map(l => l.id);
          if (addLabelsMissing.length) errors.addLabels = { reason: 'not-found', missing: addLabelsMissing };
        }
        if (removeLabels?.length) {
          ({ resolved: removeLabelsResolved, missing: removeLabelsMissing } = resolveLabelNames(removeLabels, byName));
          if (removeLabelsResolved.length) input.removedLabelIds = removeLabelsResolved.map(l => l.id);
          if (removeLabelsMissing.length) errors.removeLabels = { reason: 'not-found', missing: removeLabelsMissing };
        }
      }

      if (Object.keys(input).length === 0) {
        return { applied, errors };
      }

      const data = await gql(
        `mutation ($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`,
        { id: info.id, input },
        { token, fetcher, signal },
      );
      if (!data.issueUpdate?.success) {
        throw new Error(`Linear issueUpdate reported success:false updating ${key}`);
      }

      if (title !== undefined) applied.title = true;
      if (description !== undefined) applied.description = true;
      if (input.priority !== undefined) applied.priority = resolvedPriorityLabel;
      if (addLabelsResolved?.length) applied.addLabels = addLabelsResolved.map(l => l.name);
      if (removeLabelsResolved?.length) applied.removeLabels = removeLabelsResolved.map(l => l.name);

      return { applied, errors };
    },

    /**
     * `project` is the team's short key (e.g. "ENG") — mutations need the
     * UUID, never the key, so it's resolved via TeamFilter.key first
     * (confirmed against Linear's own official generated GraphQL schema).
     * No discovery call on an unresolvable key, same "surface a clear
     * terminal error" choice already made for Jira's issuetype — there is
     * no partial-creation concept here, unlike updateFields' best-effort
     * shape. `type` has no Linear equivalent and is intentionally ignored.
     */
    async createTicket({ project, summary, description } = {}, opts = {}) {
      const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
      const teamData = await gql(
        `query ($key: String!) { teams(filter: { key: { eq: $key } }, first: 1) { nodes { id } } }`,
        { key: project },
        { token, fetcher, signal },
      );
      const team = teamData.teams?.nodes?.[0];
      if (!team) {
        const err = new Error(`Linear team not found for project "${project}".`);
        // Marked, not message-sniffed — ticket-command.mjs's cache-refresh
        // enrichment needs a clean way to detect "the project/team didn't
        // resolve" without parsing this string.
        err.code = 'PROJECT_NOT_FOUND';
        throw err;
      }
      const input = { teamId: team.id, title: summary };
      if (description !== undefined) input.description = description;
      const data = await gql(
        `mutation ($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { identifier id url } } }`,
        { input },
        { token, fetcher, signal },
      );
      if (!data.issueCreate?.success) {
        throw new Error(`Linear issueCreate reported success:false creating an issue in team "${project}".`);
      }
      const issue = data.issueCreate.issue;
      return { key: issue.identifier, id: issue.id, url: issue.url ?? null };
    },

    /**
     * Real, currently-accessible teams for this token — unfiltered, used
     * only to enrich a ticket_create failure message with actual options
     * (Jira calls the equivalent concept "projects"; --project already
     * conflates the two at the CLI level, so the shape matches for a
     * uniform cache).
     */
    async listCreatableProjects(opts = {}) {
      const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
      const data = await gql(
        `query { teams(first: 250) { nodes { key name } } }`,
        {},
        { token, fetcher, signal },
      );
      return (data.teams?.nodes ?? []).map(t => ({ key: t.key, name: t.name }));
    },
  };
}
