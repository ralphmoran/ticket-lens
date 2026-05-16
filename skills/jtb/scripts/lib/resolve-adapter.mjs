import { createJiraAdapter } from './adapters/jira-adapter.mjs';
import { createGitHubAdapter } from './adapters/github-adapter.mjs';
import { createLinearAdapter } from './adapters/linear-adapter.mjs';

/**
 * Detects the tracker type from a baseUrl string.
 * @param {string|null|undefined} baseUrl
 * @returns {'jira'|'github'|'linear'}
 */
export function detectTrackerType(baseUrl) {
  if (!baseUrl) return 'jira';
  const lower = baseUrl.toLowerCase();
  if (lower.includes('github.com')) return 'github';
  if (lower.includes('linear.app')) return 'linear';
  return 'jira';
}

/**
 * Instantiates the correct tracker adapter for a resolved connection.
 * @param {{ baseUrl: string, auth?: string, email?: string, apiToken?: string, pat?: string }} conn
 * @param {{ fetcher?: Function }} [opts]
 * @returns {{ type: string, fetchTicket: Function, fetchCurrentUser: Function, searchTickets: Function, fetchStatuses: Function }}
 */
export function resolveAdapter(conn, opts = {}) {
  const type = detectTrackerType(conn?.baseUrl);
  if (type === 'jira') return createJiraAdapter(conn, opts);
  if (type === 'github') return createGitHubAdapter(conn, opts);
  if (type === 'linear') return createLinearAdapter(conn, opts);
  throw new Error(`Tracker type '${type}' is not yet supported. Supported: jira, github, linear.`);
}
