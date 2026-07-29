import { fetchTicket, fetchCurrentUser, searchTickets, fetchStatuses, postComment, getTransitions, postTransition, assignIssue } from '../jira-client.mjs';
import { buildJiraEnv } from '../config.mjs';

/**
 * Finds the option in a fresh transitions list matching a caller-given
 * target — by id (exact) or by name/to-name (case-insensitive). Never
 * trusts a caller-supplied id without confirming it's still a real,
 * currently-valid option for this exact issue right now.
 */
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
  };
}
