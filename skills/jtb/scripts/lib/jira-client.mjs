/**
 * Jira REST API client supporting Cloud and Server/Data Center.
 * Normalizes responses into a consistent shape.
 * Supports v2 (Server/DC) and v3 (Cloud) API versions.
 */

import { adfToText } from './adf-converter.mjs';

function toText(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return adfToText(value);
}

/**
 * Returns the ISO date string when the ticket entered its current status,
 * derived from Jira's changelog history. Walks backwards (most recent first)
 * to find the last transition whose `toString` matches `currentStatus`.
 * Returns null when changelog is absent or has no matching transition.
 */
export function parseStatusChangedAt(changelog, currentStatus) {
  if (!changelog?.histories?.length || !currentStatus) return null;
  for (let i = changelog.histories.length - 1; i >= 0; i--) {
    const history = changelog.histories[i];
    const item = history.items?.find(it => it.field === 'status' && it.toString === currentStatus);
    if (item) return history.created ?? null;
  }
  return null;
}

export function normalizeTicket(raw) {
  const f = raw.fields;
  const currentStatus = f.status?.name ?? null;
  // statusChangedAt: when the ticket entered its current status.
  // Only populated when raw.changelog is present (i.e. ?expand=changelog was requested).
  // Falls back to ticket.created when changelog is present but no matching transition exists
  // (ticket was created in its current status and never transitioned away then back).
  const statusChangedAt = raw.changelog !== undefined
    ? (parseStatusChangedAt(raw.changelog, currentStatus) ?? (f.created ?? null))
    : null;
  return {
    key: raw.key,
    summary: f.summary,
    type: f.issuetype?.name ?? null,
    status: currentStatus,
    priority: f.priority?.name ?? null,
    assignee: f.assignee?.displayName ?? null,
    reporter: f.reporter?.displayName ?? null,
    description: toText(f.description),
    created: f.created ?? null,
    updated: f.updated ?? null,
    statusChangedAt,
    labels: f.labels ?? [],
    components: (f.components ?? []).map(c => c.name),
    comments: (f.comment?.comments ?? []).map(c => ({
      author: c.author?.displayName ?? c.author?.name ?? null,
      authorAccountId: c.author?.accountId ?? null,
      authorName: c.author?.name ?? null,
      body: toText(c.body),
      created: c.created,
    })),
    linkedIssues: (f.issuelinks ?? []).map(link => {
      const direction = link.outwardIssue ? 'outward' : 'inward';
      const issue = link.outwardIssue ?? link.inwardIssue;
      return {
        direction,
        linkType: link.type.name,
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status?.name ?? null,
        type: issue.fields.issuetype?.name ?? null,
      };
    }),
    attachments: (f.attachment ?? []).map(a => ({
      id: a.id ?? null,
      filename: a.filename,
      mimeType: a.mimeType ?? null,
      size: a.size,
      content: a.content ?? null,
    })),
  };
}

// RFC-1918 + link-local + loopback + localhost blocked to prevent SSRF.
const BLOCKED_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^::ffff:/i,
  /^fc00:/i,
  /^fe80:/i,
  /^localhost$/i,
];

export function validateBaseUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch {
    throw new Error(`JIRA_BASE_URL is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`JIRA_BASE_URL must use HTTPS (got ${parsed.protocol})`);
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  if (BLOCKED_PATTERNS.some(re => re.test(hostname))) {
    throw new Error(`JIRA_BASE_URL hostname is blocked (${hostname})`);
  }
}

export function buildAuthHeader(env) {
  if (env.JIRA_PAT) {
    return { Authorization: `Bearer ${env.JIRA_PAT}` };
  }
  const encoded = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

export async function fetchCurrentUser(opts = {}) {
  const { env = process.env, fetcher = globalThis.fetch, apiVersion = 2, timeoutMs = 10_000 } = opts;
  validateBaseUrl(env.JIRA_BASE_URL);
  const baseUrl = env.JIRA_BASE_URL.replace(/\/$/, '');
  const headers = { ...buildAuthHeader(env), 'Content-Type': 'application/json' };

  const url = `${baseUrl}/rest/api/${apiVersion}/myself`;
  const fetchOpts = { headers };
  if (timeoutMs) fetchOpts.signal = AbortSignal.timeout(timeoutMs);
  const response = await fetcher(url, fetchOpts);

  if (!response.ok) {
    const err = new Error(`Jira API error ${response.status} fetching current user`);
    err.status = response.status;
    throw err;
  }

  const raw = await response.json();
  return {
    accountId: raw.accountId ?? null,
    name: raw.name ?? null,
    displayName: raw.displayName ?? null,
    emailAddress: raw.emailAddress ?? null,
  };
}

export async function fetchStatuses(opts = {}) {
  const { env = process.env, fetcher = globalThis.fetch, apiVersion = 2, timeoutMs = 10_000 } = opts;
  validateBaseUrl(env.JIRA_BASE_URL);
  const baseUrl = env.JIRA_BASE_URL.replace(/\/$/, '');
  const headers = { ...buildAuthHeader(env), 'Content-Type': 'application/json' };

  const url = `${baseUrl}/rest/api/${apiVersion}/status`;
  const fetchOpts = { headers };
  if (timeoutMs) fetchOpts.signal = AbortSignal.timeout(timeoutMs);
  const response = await fetcher(url, fetchOpts);

  if (!response.ok) {
    const err = new Error(`Jira API error ${response.status} fetching statuses`);
    err.status = response.status;
    throw err;
  }

  const raw = await response.json();
  return [...new Set(raw.map(s => s.name))].sort();
}

export async function searchTickets(jql, opts = {}) {
  const { env = process.env, fetcher = globalThis.fetch, maxResults = 50, apiVersion = 2, timeoutMs = 10_000, expandChangelog = false } = opts;
  validateBaseUrl(env.JIRA_BASE_URL);
  const baseUrl = env.JIRA_BASE_URL.replace(/\/$/, '');
  const headers = { ...buildAuthHeader(env), 'Content-Type': 'application/json' };

  const fields = 'summary,status,assignee,priority,issuetype,comment,updated,statuscategorychangedate,created';
  const params = new URLSearchParams({ jql, fields, maxResults: String(maxResults) });
  if (expandChangelog) params.set('expand', 'changelog');
  const endpoint = apiVersion >= 3 ? `/rest/api/3/search/jql` : `/rest/api/2/search`;
  const url = `${baseUrl}${endpoint}?${params}`;
  const fetchOpts = { headers };
  if (timeoutMs) fetchOpts.signal = AbortSignal.timeout(timeoutMs);
  const response = await fetcher(url, fetchOpts);

  if (!response.ok) {
    let detail = '';
    try { const body = await response.json(); detail = (body.errorMessages || []).join('; '); } catch {}
    const err = new Error(`Jira API error ${response.status} searching tickets`);
    err.status = response.status;
    err.detail = detail;
    throw err;
  }

  const raw = await response.json();
  return (raw.issues ?? []).map(normalizeTicket);
}

export async function fetchRemoteLinks(ticketKey, opts = {}) {
  const { env = process.env, fetcher = globalThis.fetch, apiVersion = 2, timeoutMs = 10_000 } = opts;
  validateBaseUrl(env.JIRA_BASE_URL);
  const baseUrl = env.JIRA_BASE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/rest/api/${apiVersion}/issue/${encodeURIComponent(ticketKey)}/remotelink`;

  const fetchOpts = { headers: { ...buildAuthHeader(env), 'Content-Type': 'application/json' } };
  if (timeoutMs) fetchOpts.signal = AbortSignal.timeout(timeoutMs);

  const response = await fetcher(url, fetchOpts);
  if (!response.ok) return [];

  const raw = await response.json();
  return (raw ?? [])
    .filter(link => link.application?.type === 'com.atlassian.confluence')
    .map(link => ({ url: link.object.url, title: link.object.title ?? null }));
}

export async function fetchTicket(ticketKey, opts = {}) {
  const { env = process.env, fetcher = globalThis.fetch, depth = 1, apiVersion = 2, timeoutMs = 10_000, expandChangelog = false, _visited = new Set(), _currentDepth = 0 } = opts;
  validateBaseUrl(env.JIRA_BASE_URL);
  const baseUrl = env.JIRA_BASE_URL.replace(/\/$/, '');
  const headers = { ...buildAuthHeader(env), 'Content-Type': 'application/json' };

  const expand = expandChangelog ? '?expand=changelog' : '';
  const url = `${baseUrl}/rest/api/${apiVersion}/issue/${encodeURIComponent(ticketKey)}${expand}`;
  const fetchOpts = { headers };
  if (timeoutMs) fetchOpts.signal = AbortSignal.timeout(timeoutMs);
  const response = await fetcher(url, fetchOpts);

  if (!response.ok) {
    const err = new Error(`Jira API error ${response.status} fetching ${ticketKey}`);
    err.status = response.status;
    throw err;
  }

  const raw = await response.json();
  const ticket = normalizeTicket(raw);
  _visited.add(ticketKey);

  if (_currentDepth < depth) {
    const MAX_TICKETS = 15;
    const linkedKeys = ticket.linkedIssues
      .map(l => l.key)
      .filter(k => !_visited.has(k))
      .slice(0, Math.max(0, MAX_TICKETS - _visited.size));

    // Pre-mark all siblings before launching parallel fetches to prevent duplicate fetches
    // when the same key appears in multiple link lists at the same depth.
    linkedKeys.forEach(k => _visited.add(k));

    ticket.linkedTicketDetails = await Promise.all(
      // Linked tickets are context only — never scored, so skip changelog expansion for them.
      linkedKeys.map(k => fetchTicket(k, { ...opts, expandChangelog: false, _visited, _currentDepth: _currentDepth + 1 }))
    );
  }

  return ticket;
}
