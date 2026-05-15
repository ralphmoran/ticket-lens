import { fetchTicket, fetchCurrentUser, searchTickets, fetchStatuses } from '../jira-client.mjs';
import { buildJiraEnv } from '../config.mjs';

/**
 * Returns a tracker adapter backed by the Jira REST API.
 * Binds connection credentials so callers never touch jira-client directly.
 */
export function createJiraAdapter(conn, { fetcher = globalThis.fetch } = {}) {
  const env = buildJiraEnv(conn);
  const apiVersion = conn.auth === 'cloud' ? 3 : 2;

  return {
    type: 'jira',
    fetchTicket: (key, opts = {}) => fetchTicket(key, { env, fetcher, apiVersion, ...opts }),
    fetchCurrentUser: (opts = {}) => fetchCurrentUser({ env, fetcher, apiVersion, ...opts }),
    searchTickets: (query, opts = {}) => searchTickets(query, { env, fetcher, apiVersion, ...opts }),
    fetchStatuses: (opts = {}) => fetchStatuses({ env, fetcher, apiVersion, ...opts }),
  };
}
