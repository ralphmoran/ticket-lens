/**
 * Jira worklog write — split from jira-client.mjs (which sits at the file-size
 * cap) the same way jira-attachment-client.mjs is: it reuses the client's own
 * URL validation, auth header, and guardedFetch (SSRF/redirect guard), never
 * its own copies.
 */

import { textToAdf } from './adf-converter.mjs';
import { sanitizeUntrustedText } from './ansi.mjs';
import { TICKET_KEY_PATTERN } from './cli.mjs';
import { buildAuthHeader, guardedFetch, validateBaseUrl, defaultLookupFor } from './jira-client.mjs';

/**
 * Jira's own 400 text (errorMessages + per-field errors), so "Time tracking is
 * disabled" or "You do not have permission to add worklog" reaches the caller
 * instead of a bare status. Defensive about shape — the body is external data,
 * so terminal control characters (an OSC 52 clipboard write, cursor movement)
 * are stripped before the text can reach a caller's terminal.
 */
function summarizeJiraErrors(details) {
  const messages = Array.isArray(details?.errorMessages) ? details.errorMessages : [];
  const fields = details?.errors && typeof details.errors === 'object' ? Object.entries(details.errors).map(([field, msg]) => `${field}: ${msg}`) : [];
  return sanitizeUntrustedText([...messages, ...fields].map(String).join('; ')).slice(0, 300);
}

/** Retry-After is delta-seconds or an HTTP date; only the former is usable as a wait, anything else is null. */
function parseRetryAfterSeconds(value) {
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds > 0 ? seconds : null;
}

/**
 * Adds a worklog to an issue, always as the authenticated user — Jira offers
 * no way to log on someone else's behalf. `timeSpentSeconds` (not Jira's
 * `timeSpent` string, whose `d`/`w` units are instance-configured) and
 * `started` (required by Jira on create, `+0000` offset form only) are
 * mandatory; both are checked before any network call. `comment` follows the
 * same v3-ADF / v2-plain-string split as postComment. Jira's own estimate and
 * watcher-notification defaults apply — deliberately not overridden here.
 */
export async function postWorklog(ticketKey, { timeSpentSeconds, started, comment } = {}, opts = {}) {
  if (typeof ticketKey !== 'string' || !TICKET_KEY_PATTERN.test(ticketKey)) {
    throw new TypeError('postWorklog: invalid ticket key — expected PROJ-123');
  }
  if (!Number.isInteger(timeSpentSeconds) || timeSpentSeconds <= 0) {
    throw new TypeError('postWorklog: timeSpentSeconds must be a positive integer');
  }
  if (typeof started !== 'string' || !started) {
    throw new TypeError('postWorklog: started is required — Jira rejects a worklog without it');
  }
  const { env = process.env, fetcher = globalThis.fetch, lookup = defaultLookupFor(fetcher), apiVersion = 2, timeoutMs = 10_000, allowPrivateIp = false } = opts;
  validateBaseUrl(env.JIRA_BASE_URL, allowPrivateIp);
  const baseUrl = env.JIRA_BASE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/rest/api/${apiVersion}/issue/${encodeURIComponent(ticketKey)}/worklog`;

  const payload = { timeSpentSeconds, started };
  if (comment !== undefined) payload.comment = apiVersion === 3 ? textToAdf(comment) : comment;
  const fetchOpts = {
    method: 'POST',
    headers: { ...buildAuthHeader(env), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
  if (timeoutMs) fetchOpts.signal = AbortSignal.timeout(timeoutMs);

  const response = await guardedFetch(url, fetchOpts, { fetcher, lookup, allowPrivateIp });
  if (!response.ok) {
    let details;
    try { details = await response.json(); } catch { /* body not JSON — fall through with no details */ }
    const summary = summarizeJiraErrors(details);
    const err = new Error(`Jira API error ${response.status} logging work on ${ticketKey}${summary ? `: ${summary}` : ''}`);
    err.status = response.status;
    err.details = details;
    if (response.status === 429) err.rateLimit = { retryAfterSeconds: parseRetryAfterSeconds(response.headers?.get?.('retry-after')) };
    throw err;
  }
  const raw = await response.json();
  // Jira-supplied, then printed and audit-logged by callers: only a plain numeric id is trusted.
  const id = /^\d+$/.test(String(raw.id)) ? String(raw.id) : undefined;
  return {
    id,
    timeSpent: typeof raw.timeSpent === 'string' ? sanitizeUntrustedText(raw.timeSpent) : undefined,
    url: `${baseUrl}/browse/${encodeURIComponent(ticketKey)}${id ? `?focusedWorklogId=${id}` : ''}`,
  };
}
