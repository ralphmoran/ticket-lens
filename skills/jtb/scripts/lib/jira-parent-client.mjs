/**
 * Jira parent (epic) reads and writes — split from jira-client.mjs (at the
 * file-size cap) the same way jira-worklog-client.mjs is: it reuses the client's
 * own URL validation, auth header, and guardedFetch (SSRF/redirect guard).
 *
 * Two real mechanisms:
 *  - Cloud (v3): the unified `parent` field, `{ parent: { key } }`.
 *  - Server/DC (v2): the "Epic Link" custom field, set to the epic's key as a
 *    plain string. Its id differs per instance, so it is looked up by schema.
 */

import { buildAuthHeader, guardedFetch, validateBaseUrl, defaultLookupFor } from './jira-client.mjs';
import { summarizeJiraErrors, parseRetryAfterSeconds } from './jira-worklog-client.mjs';

const EPIC_LINK_SCHEMA = 'com.pyxis.greenhopper.jira:gh-epic-link';
const EPIC_LINK_NAME = 'Epic Link';
const EPIC_NAME_SCHEMA = 'com.pyxis.greenhopper.jira:gh-epic-label';
const EPIC_NAME_NAME = 'Epic Name';

function resolveRequest(opts) {
  const { env = process.env, fetcher = globalThis.fetch, lookup = defaultLookupFor(fetcher), apiVersion = 2, timeoutMs = 10_000, allowPrivateIp = false } = opts;
  validateBaseUrl(env.JIRA_BASE_URL, allowPrivateIp);
  return {
    baseUrl: env.JIRA_BASE_URL.replace(/\/$/, ''),
    headers: { ...buildAuthHeader(env), 'Content-Type': 'application/json' },
    guard: { fetcher, lookup, allowPrivateIp },
    apiVersion,
    timeoutMs,
  };
}

async function send(url, { method, body }, { headers, guard, timeoutMs }, failureLabel) {
  const fetchOpts = { method, headers };
  if (body !== undefined) fetchOpts.body = JSON.stringify(body);
  if (timeoutMs) fetchOpts.signal = AbortSignal.timeout(timeoutMs);
  const response = await guardedFetch(url, fetchOpts, guard);
  if (response.ok) return response;
  let details;
  try { details = await response.json(); } catch { /* body not JSON — fall through with no details */ }
  const reason = summarizeJiraErrors(details);
  const err = new Error(`Jira API error ${response.status} ${failureLabel}${reason ? `: ${reason}` : ''}`);
  err.status = response.status;
  err.details = details;
  if (response.status === 429) err.rateLimit = { retryAfterSeconds: parseRetryAfterSeconds(response.headers?.get?.('retry-after')) };
  throw err;
}

// A field id comes from the tracker and ends up as a key in a write body: only a real custom field id passes.
const CUSTOM_FIELD_ID = /^customfield_\d+$/;
const isCustomField = (f) => typeof f?.id === 'string' && CUSTOM_FIELD_ID.test(f.id);

/** Finds a custom field by schema type first (survives a rename), then by exact display name. */
function findFieldId(fields, schema, name) {
  return (fields.find(f => isCustomField(f) && f.schema?.custom === schema) ?? fields.find(f => isCustomField(f) && f.name === name))?.id ?? null;
}

/**
 * Ids of this instance's Epic Link and Epic Name custom fields, from one
 * request. Either is null when the instance has none (team-managed Cloud has
 * neither; company-managed Cloud and Server/DC have both).
 * @returns {Promise<{ epicLinkFieldId: string|null, epicNameFieldId: string|null }>}
 */
export async function fetchEpicFieldIds(opts = {}) {
  const req = resolveRequest(opts);
  const response = await send(`${req.baseUrl}/rest/api/${req.apiVersion}/field`, { method: 'GET' }, req, 'listing fields');
  const fields = await response.json();
  if (!Array.isArray(fields)) return { epicLinkFieldId: null, epicNameFieldId: null };
  return {
    epicLinkFieldId: findFieldId(fields, EPIC_LINK_SCHEMA, EPIC_LINK_NAME),
    epicNameFieldId: findFieldId(fields, EPIC_NAME_SCHEMA, EPIC_NAME_NAME),
  };
}

/** Id of this instance's Epic Link custom field, or null when it has none. */
export async function fetchEpicLinkFieldId(opts = {}) {
  return (await fetchEpicFieldIds(opts)).epicLinkFieldId;
}

/**
 * What the parent-setting flow needs to know about one issue: its type, whether
 * it is a sub-task, and the parent or epic it already sits under.
 * @returns {Promise<{ key: string, type: string|null, isSubtask: boolean, parentKey: string|null }>}
 */
export async function fetchParentInfo(ticketKey, opts = {}) {
  const req = resolveRequest(opts);
  const { epicLinkFieldId, epicNameFieldId } = opts;
  const fieldList = ['issuetype', 'parent', ...(req.apiVersion === 2 && epicLinkFieldId ? [epicLinkFieldId] : []), ...(epicNameFieldId ? [epicNameFieldId] : [])];
  const url = `${req.baseUrl}/rest/api/${req.apiVersion}/issue/${encodeURIComponent(ticketKey)}?fields=${encodeURIComponent(fieldList.join(','))}`;
  const response = await send(url, { method: 'GET' }, req, `fetching ${ticketKey}`);
  const raw = await response.json();
  const f = raw.fields ?? {};
  const isSubtask = f.issuetype?.subtask === true;
  // A sub-task's `parent` is its parent task, never an epic: keep it out of the epic slot on Server/DC.
  const parentKey = req.apiVersion === 3
    ? (f.parent?.key ?? null)
    : (!isSubtask && epicLinkFieldId && typeof f[epicLinkFieldId] === 'string' ? f[epicLinkFieldId] : null);
  // epicName is present only when this issue carries the field: null means it is there but empty,
  // while a key that is absent (a team-managed epic, a Story) means the issue has no Epic Name at all.
  const hasEpicName = Boolean(epicNameFieldId) && epicNameFieldId in f;
  return { key: raw.key ?? ticketKey, type: f.issuetype?.name ?? null, isSubtask, parentKey, ...(hasEpicName ? { epicName: f[epicNameFieldId] ?? null } : {}) };
}

/** Sets `childKey`'s parent (Cloud) or Epic Link (Server/DC) to `parentKey`. */
export async function setIssueParent(childKey, parentKey, opts = {}) {
  const { epicLinkFieldId } = opts;
  const req = resolveRequest(opts);
  if (req.apiVersion !== 3 && !epicLinkFieldId) {
    throw new Error('Cannot set an epic: this Jira has no "Epic Link" field.');
  }
  const fields = req.apiVersion === 3 ? { parent: { key: parentKey } } : { [epicLinkFieldId]: parentKey };
  const url = `${req.baseUrl}/rest/api/${req.apiVersion}/issue/${encodeURIComponent(childKey)}`;
  await send(url, { method: 'PUT', body: { fields } }, req, `setting the parent of ${childKey}`);
}
