import { fetchTicket, fetchCurrentUser, searchTickets, fetchStatuses, postComment, getTransitions, postTransition, assignIssue, escapeJql, getIssueLinkTypes, postIssueLink } from '../jira-client.mjs';
import { buildJiraEnv } from '../config.mjs';

/**
 * Finds the option in a fresh transitions list matching a caller-given
 * target — by id (exact) or by name/to-name (case-insensitive). Never
 * trusts a caller-supplied id without confirming it's still a real,
 * currently-valid option for this exact issue right now.
 */
const SEARCH_TEXT_CHAR_LIMIT = 300;

function resolveTransitionTarget(options, target) {
  const t = String(target).toLowerCase();
  return options.find(o => o.id === String(target) || o.name.toLowerCase() === t || (o.to ?? '').toLowerCase() === t);
}

/**
 * Returns a tracker adapter backed by the Jira REST API.
 * Binds connection credentials so callers never touch jira-client directly.
 */
export function createJiraAdapter(conn, { fetcher = globalThis.fetch } = {}) {
  const env = buildJiraEnv(conn);
  const apiVersion = conn.auth === 'cloud' ? 3 : 2;
  const base = { env, fetcher, apiVersion, allowPrivateIp: conn.allowPrivateIp };

  return {
    type: 'jira',
    fetchTicket: (key, opts = {}) => fetchTicket(key, { ...base, ...opts }),
    fetchCurrentUser: (opts = {}) => fetchCurrentUser({ ...base, ...opts }),
    searchTickets: (query, opts = {}) => searchTickets(query, { ...base, ...opts }),
    fetchStatuses: (opts = {}) => fetchStatuses({ ...base, ...opts }),
    addComment: (key, body, opts = {}) => postComment(key, body, { ...base, ...opts }),
    getTransitions: (key, opts = {}) => getTransitions(key, { ...base, ...opts }),
    /**
     * Always re-fetches transitions fresh and resolves `target` against
     * them before executing — a caller can never blind-POST a stale or
     * guessed transition id, even if they try.
     */
    async transition(key, target, opts = {}) {
      const options = await getTransitions(key, { ...base, ...opts });
      const match = resolveTransitionTarget(options, target);
      if (!match) {
        return { executed: false, reason: 'not-found', options };
      }
      await postTransition(key, match.id, { ...base, ...opts });
      return { executed: true, to: match.to ?? match.name };
    },

    /**
     * Self-assign only — arbitrary-user assignment would need a
     * user-search API this codebase doesn't have yet. Reuses
     * fetchCurrentUser, which already returns both accountId (Cloud)
     * and name (Server/DC).
     */
    async assignToSelf(key, opts = {}) {
      const me = await fetchCurrentUser({ ...base, ...opts });
      const field = apiVersion === 3 ? 'accountId' : 'name';
      const value = me[field];
      // Jira's PUT /issue/{key}/assignee treats a null identity field as
      // "unassign", not an error — it returns 204 either way. Never send
      // it: that would silently unassign the ticket while this command
      // reports success.
      if (!value) {
        throw new Error(`Cannot determine current user's ${field} — Jira did not return it for this connection.`);
      }
      await assignIssue(key, { [field]: value }, { ...base, ...opts });
      return { assignee: me.displayName ?? value };
    },

    /**
     * Candidate search for duplicate-ticket detection. Scoped to the same
     * project as `sourceKey` (derived from its own prefix) and excludes it
     * from results. Jira has no server-side similarity scoring — this only
     * narrows the candidate pool; ranking happens in duplicate-scorer.mjs.
     */
    async findCandidates(text, sourceKey, opts = {}) {
      const hyphenIndex = sourceKey.lastIndexOf('-');
      if (hyphenIndex < 1) {
        throw new Error(`Cannot derive a project key from "${sourceKey}" — expected PROJECT-123.`);
      }
      const project = sourceKey.slice(0, hyphenIndex);
      const searchText = text.slice(0, SEARCH_TEXT_CHAR_LIMIT);
      const jql = `project = "${escapeJql(project)}" AND key != "${escapeJql(sourceKey)}" AND text ~ "${escapeJql(searchText)}" ORDER BY updated DESC`;
      return searchTickets(jql, { ...base, ...opts });
    },

    /**
     * Always fetched fresh — link type names are per-instance customizable
     * in Jira, same "never trust a stale list" principle as getTransitions.
     * Returns just names (matches GitHub/Linear's plain-string shape) so
     * runTicketLinkList can render any tracker's list uniformly.
     */
    async getLinkTypes(opts = {}) {
      const types = await getIssueLinkTypes({ ...base, ...opts });
      return types.map(t => t.name);
    },

    /**
     * Always re-fetches link types fresh and resolves `typeName` against
     * them before executing — a caller can never blind-POST a stale or
     * guessed type name, same principle as transition().
     * sourceKey is the outwardIssue, targetKey is the inwardIssue — direction matters.
     */
    async linkTo(sourceKey, targetKey, typeName, opts = {}) {
      const types = await getIssueLinkTypes({ ...base, ...opts });
      const match = types.find(t => t.name.toLowerCase() === typeName.toLowerCase());
      if (!match) {
        return { executed: false, reason: 'not-found', options: types.map(t => t.name) };
      }
      await postIssueLink(sourceKey, targetKey, match.name, { ...base, ...opts });
      return { executed: true };
    },
  };
}
