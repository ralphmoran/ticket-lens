/**
 * Jira REST API client supporting Cloud and Server/Data Center.
 * Normalizes responses into a consistent shape.
 * Supports v2 (Server/DC) and v3 (Cloud) API versions.
 */

import { adfToText } from './adf-converter.mjs';
import { lookup as dnsLookup } from 'node:dns/promises';

function toText(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  return adfToText(value);
}

/**
 * Extracts the active sprint name from customfield_10020.
 * Cloud v3: array of sprint objects — prefers active, falls back to last.
 * Server v2: serialized Java string — extracts via name= regex.
 */
function parseSprint(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    const sprint = value.find(s => s.state === 'active') ?? value[value.length - 1];
    return sprint?.name ?? null;
  }
  if (typeof value === 'string') {
    const m = value.match(/name=([^,\]]+)/);
    return m ? m[1].trim() : null;
  }
  return null;
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
    sprint: parseSprint(f.customfield_10020),
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

// RFC-1918 + link-local + loopback + localhost + IPv6 ULA/link-local + CGN NAT
// blocked to prevent SSRF. Each pattern matches the FULL CIDR range, not a
// single literal value — a narrower match (e.g. exact "fc00:") lets addresses
// elsewhere in the same reserved block sail through (audit 2026-07-07 §4.1
// code-review remediation).
const BLOCKED_PATTERNS = [
  /^127\./,                                  // 127.0.0.0/8 loopback
  /^10\./,                                   // 10.0.0.0/8 RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./,               // 172.16.0.0/12 RFC1918
  /^192\.168\./,                             // 192.168.0.0/16 RFC1918
  /^169\.254\./,                             // 169.254.0.0/16 link-local + cloud metadata
  /^0\./,                                    // 0.0.0.0/8 "this network"
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // 100.64.0.0/10 Carrier-Grade NAT
  /^::1$/,                                   // IPv6 loopback
  /^::ffff:/i,                               // IPv4-mapped IPv6
  /^f[cd][0-9a-f]{2}:/i,                     // fc00::/7 Unique Local Address (covers real-world fd00::/8)
  /^fe[89ab][0-9a-f]:/i,                     // fe80::/10 link-local
  /^localhost$/i,
];

function normalizeHostname(hostname) {
  return hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

/**
 * @param {string} url
 * @param {boolean} [allowPrivateIp] - skip the private/internal blocklist check
 *   for THIS hostname. Set only via explicit interactive user confirmation
 *   during setup, persisted per-profile — never from synced/network data
 *   (see team-jira-sync.mjs). HTTPS enforcement is never skippable.
 */
export function validateBaseUrl(url, allowPrivateIp = false) {
  let parsed;
  try { parsed = new URL(url); } catch {
    throw new Error(`JIRA_BASE_URL is not a valid URL: ${url}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`JIRA_BASE_URL must use HTTPS (got ${parsed.protocol})`);
  }
  if (allowPrivateIp) return;
  const hostname = normalizeHostname(parsed.hostname);
  if (BLOCKED_PATTERNS.some(re => re.test(hostname))) {
    const err = new Error(`JIRA_BASE_URL hostname is blocked (${hostname})`);
    err.code = 'PRIVATE_IP_BLOCKED';
    err.blockedHostname = hostname;
    err.blockedAddress = null;
    throw err;
  }
}

/**
 * Validates a redirect target URL: HTTPS + hostname not in the private/internal
 * blocklist. Shared by attachment-downloader (CDN redirect follow) — the API
 * client itself never follows redirects (see guardedFetch).
 */
export function isSafeRedirectUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== 'https:') return false;
  const hostname = normalizeHostname(parsed.hostname);
  return !BLOCKED_PATTERNS.some(re => re.test(hostname));
}

/**
 * Shared default for the `lookup` opt across every call site: the real DNS
 * resolver only when the caller is using the real fetch (production), null
 * for mocked fetchers (tests — no socket opens, nothing to protect).
 */
export function defaultLookupFor(fetcher) {
  return fetcher === globalThis.fetch ? dnsLookup : null;
}

// Per-lookup-fn DNS validation cache: WeakMap<lookupFn, Map<hostname, Promise<void>>>.
// Keying by the lookup function isolates test stubs from each other and from the
// real resolver, with zero reset hooks needed. Entries are deleted once their
// promise settles (see below) — this dedupes only genuinely concurrent lookups,
// never sequential ones.
const dnsValidationCaches = new WeakMap();

/**
 * DNS-rebinding guard: resolves `hostname` and rejects if ANY returned address
 * matches BLOCKED_PATTERNS. The upfront validateBaseUrl check only sees the
 * hostname *string*; a passing hostname can still resolve to 127.0.0.1 or
 * 169.254.169.254 at connect time. Fail-closed: resolver errors propagate.
 *
 * Cache entries are deleted as soon as their promise settles, so the cache
 * only dedupes calls that are truly in flight at the same instant (e.g. a
 * Promise.all fan-out over linked tickets) — it never lets a sequential call
 * reuse a stale verdict. A cache with no expiry would hand a DNS-rebinding
 * attacker the whole CLI run's wall-clock duration to flip the record after
 * the first (validated) resolution; this way each sequential call re-resolves.
 *
 * Known residual: TOCTOU between this lookup and fetch's own resolution within
 * a SINGLE call — a TTL-0 rebinder can still race that one connection. Full
 * IP-pinning needs a custom undici Agent, which would break the zero-dependency
 * constraint. This check raises the bar; it does not eliminate a single-call race.
 *
 * `lookup` is null when the fetcher is mocked (tests) — no socket opens, so
 * there is nothing to protect. Production always uses globalThis.fetch, which
 * always gets the real resolver (see defaultLookupFor).
 *
 * `allowPrivateIp` skips the lookup entirely (not just the block) when a
 * profile has an explicit, user-confirmed trust exception for this exact
 * hostname — set only during interactive setup, never from synced/network
 * data. Skipping the resolution outright (rather than resolving-then-
 * ignoring) avoids the DNS round-trip and sidesteps any question of how the
 * per-lookup-fn cache should key on a flag that no real caller varies
 * concurrently for the same hostname.
 */
export async function validateResolvedHost(hostname, lookup, allowPrivateIp = false) {
  if (!lookup || allowPrivateIp) return;
  let cache = dnsValidationCaches.get(lookup);
  if (!cache) {
    cache = new Map();
    dnsValidationCaches.set(lookup, cache);
  }
  if (!cache.has(hostname)) {
    const validation = (async () => {
      const addresses = await lookup(hostname, { all: true });
      for (const { address } of addresses) {
        if (BLOCKED_PATTERNS.some(re => re.test(address))) {
          const err = new Error(`Hostname ${hostname} resolves to a blocked address (${address}) — refusing to connect`);
          err.code = 'PRIVATE_IP_BLOCKED';
          err.blockedHostname = hostname;
          err.blockedAddress = address;
          throw err;
        }
      }
    })();
    validation.catch(() => {}).finally(() => cache.delete(hostname));
    cache.set(hostname, validation);
  }
  return cache.get(hostname);
}

/**
 * Single enforcement point for all Jira API calls:
 *  1. DNS-validate the target host (when a resolver is available).
 *  2. Force redirect:'manual' — call sites cannot forget or override it.
 *  3. Refuse ANY 3xx. A redirect on a REST endpoint means JIRA_BASE_URL is
 *     misconfigured, not normal Jira behavior. Refusing (instead of following)
 *     means credentials can never cross a redirect — this deliberately keeps
 *     fetch's own auth-strip protection irrelevant rather than overriding it.
 * Error message carries the redirect target's HOSTNAME only — Location values
 * can contain presigned tokens in path/query.
 */
export async function guardedFetch(url, fetchOpts, { fetcher, lookup, allowPrivateIp = false }) {
  await validateResolvedHost(new URL(url).hostname, lookup, allowPrivateIp);
  const response = await fetcher(url, { ...fetchOpts, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    let target = 'unknown host';
    const location = response.headers?.get?.('location');
    if (location) {
      try { target = new URL(location, url).hostname; } catch {}
    }
    const err = new Error(`Jira API redirected to ${target} — refusing to follow; check JIRA_BASE_URL`);
    err.status = response.status;
    throw err;
  }
  return response;
}

export function buildAuthHeader(env) {
  if (env.JIRA_PAT) {
    return { Authorization: `Bearer ${env.JIRA_PAT}` };
  }
  const encoded = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

export async function fetchCurrentUser(opts = {}) {
  const { env = process.env, fetcher = globalThis.fetch, lookup = defaultLookupFor(fetcher), apiVersion = 2, timeoutMs = 10_000, allowPrivateIp = false } = opts;
  validateBaseUrl(env.JIRA_BASE_URL, allowPrivateIp);
  const baseUrl = env.JIRA_BASE_URL.replace(/\/$/, '');
  const headers = { ...buildAuthHeader(env), 'Content-Type': 'application/json' };

  const url = `${baseUrl}/rest/api/${apiVersion}/myself`;
  const fetchOpts = { headers };
  if (timeoutMs) fetchOpts.signal = AbortSignal.timeout(timeoutMs);
  const response = await guardedFetch(url, fetchOpts, { fetcher, lookup, allowPrivateIp });

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
  const { env = process.env, fetcher = globalThis.fetch, lookup = defaultLookupFor(fetcher), apiVersion = 2, timeoutMs = 10_000, allowPrivateIp = false } = opts;
  validateBaseUrl(env.JIRA_BASE_URL, allowPrivateIp);
  const baseUrl = env.JIRA_BASE_URL.replace(/\/$/, '');
  const headers = { ...buildAuthHeader(env), 'Content-Type': 'application/json' };

  const url = `${baseUrl}/rest/api/${apiVersion}/status`;
  const fetchOpts = { headers };
  if (timeoutMs) fetchOpts.signal = AbortSignal.timeout(timeoutMs);
  const response = await guardedFetch(url, fetchOpts, { fetcher, lookup, allowPrivateIp });

  if (!response.ok) {
    const err = new Error(`Jira API error ${response.status} fetching statuses`);
    err.status = response.status;
    throw err;
  }

  const raw = await response.json();
  return [...new Set(raw.map(s => s.name))].sort();
}

export async function searchTickets(jql, opts = {}) {
  const { env = process.env, fetcher = globalThis.fetch, lookup = defaultLookupFor(fetcher), maxResults = 50, apiVersion = 2, timeoutMs = 10_000, expandChangelog = false, allowPrivateIp = false } = opts;
  validateBaseUrl(env.JIRA_BASE_URL, allowPrivateIp);
  const baseUrl = env.JIRA_BASE_URL.replace(/\/$/, '');
  const headers = { ...buildAuthHeader(env), 'Content-Type': 'application/json' };

  const fields = 'summary,status,assignee,priority,issuetype,comment,updated,statuscategorychangedate,created,customfield_10020';
  const params = new URLSearchParams({ jql, fields, maxResults: String(maxResults) });
  if (expandChangelog) params.set('expand', 'changelog');
  const endpoint = apiVersion >= 3 ? `/rest/api/3/search/jql` : `/rest/api/2/search`;
  const url = `${baseUrl}${endpoint}?${params}`;
  const fetchOpts = { headers };
  if (timeoutMs) fetchOpts.signal = AbortSignal.timeout(timeoutMs);
  const response = await guardedFetch(url, fetchOpts, { fetcher, lookup, allowPrivateIp });

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
  const { env = process.env, fetcher = globalThis.fetch, lookup = defaultLookupFor(fetcher), apiVersion = 2, timeoutMs = 10_000, allowPrivateIp = false } = opts;
  validateBaseUrl(env.JIRA_BASE_URL, allowPrivateIp);
  const baseUrl = env.JIRA_BASE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/rest/api/${apiVersion}/issue/${encodeURIComponent(ticketKey)}/remotelink`;

  const fetchOpts = { headers: { ...buildAuthHeader(env), 'Content-Type': 'application/json' } };
  if (timeoutMs) fetchOpts.signal = AbortSignal.timeout(timeoutMs);

  const response = await guardedFetch(url, fetchOpts, { fetcher, lookup, allowPrivateIp });
  if (!response.ok) return [];

  const raw = await response.json();
  return (raw ?? [])
    .filter(link => link.application?.type === 'com.atlassian.confluence')
    .map(link => ({ url: link.object.url, title: link.object.title ?? null }));
}

export async function fetchTicket(ticketKey, opts = {}) {
  const { env = process.env, fetcher = globalThis.fetch, lookup = defaultLookupFor(fetcher), depth = 1, apiVersion = 2, timeoutMs = 10_000, expandChangelog = false, allowPrivateIp = false, _visited = new Set(), _currentDepth = 0 } = opts;
  validateBaseUrl(env.JIRA_BASE_URL, allowPrivateIp);
  const baseUrl = env.JIRA_BASE_URL.replace(/\/$/, '');
  const headers = { ...buildAuthHeader(env), 'Content-Type': 'application/json' };

  const expand = expandChangelog ? '?expand=changelog' : '';
  const url = `${baseUrl}/rest/api/${apiVersion}/issue/${encodeURIComponent(ticketKey)}${expand}`;
  const fetchOpts = { headers };
  if (timeoutMs) fetchOpts.signal = AbortSignal.timeout(timeoutMs);
  const response = await guardedFetch(url, fetchOpts, { fetcher, lookup, allowPrivateIp });

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
