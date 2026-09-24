/**
 * Project/issue-type metadata cache for `ticketlens create` and
 * `ticketlens issue-types` — stores what this profile has actually
 * confirmed it can create against (real project keys, real Jira issue
 * types per project). Two access patterns share this file with two
 * different freshness bars: a full scan (`issue-types` with no
 * `--project`) trusts data for METADATA_TTL_MS (7 days); a targeted
 * single-project lookup (`issue-types --project=KEY`, or the reactive
 * create-failure enrichment path) is "on purpose" and trusts data for
 * the shorter SINGLE_PROJECT_TTL_MS (3 days) instead — tracked via its
 * own per-project `issueTypesFetchedAt[KEY]` timestamp, independent of
 * the whole-file `fetchedAt`/`projectsFetchedAt` markers a full scan uses.
 * Callers own the freshness decision (this module just persists whatever
 * timestamps they pass); `fetchedAt` alone still gates this file's own
 * read-side garbage collection (deleted once older than the ttlMs param).
 *
 * Path:   ~/.ticketlens/cache/PROFILE/ticket-metadata.json
 * Format: {
 *   fetchedAt,            // bumped on every write — GC liveness marker only
 *   projectsFetchedAt,    // set only by a full project-list scan
 *   projects: [{key, name}],
 *   issueTypesByProject:  {KEY: [{id, name}]},
 *   issueTypesFetchedAt:  {KEY: iso timestamp}  // per-project, either access pattern
 *   assignableUsersByProject:  {KEY: {normalizedQuery: [{accountId, displayName}]}},
 *   assignableUsersFetchedAt:  {KEY: {normalizedQuery: iso timestamp}},
 *   prioritiesByProject:  {KEY: [{id, name}]},
 *   prioritiesFetchedAt:  {KEY: iso timestamp},
 *   labelsByTeam:  {TEAM_ID: [{id, name}]},
 *   labelsFetchedAt:  {TEAM_ID: iso timestamp}
 * }
 *
 * assignableUsersByProject/assignableUsersFetchedAt (ROADMAP 61) share this
 * file rather than a new one — same profile-scoped Jira-lookup cache, same
 * 3-day freshness bar as a single-project issue-types lookup. Nested one
 * level deeper than issueTypesByProject because Jira's own
 * `user/assignable/search` has no "list everyone" mode (query is required
 * unless accountId is given) — there is no per-project roster to cache,
 * only per-(project, query) result pages, each with its own clock.
 *
 * prioritiesByProject/prioritiesFetchedAt (Backlog #34/ROADMAP 57 follow-up)
 * are per-project like issueTypesByProject, not global — confirmed live
 * against both a Cloud instance (corenexus) and a Server/DC instance
 * (advent) that priority schemes are project-scoped, not instance-wide.
 * Reactive-enrichment-only, same 3-day SINGLE_PROJECT_TTL_MS bar, same
 * design as issue-types: never blocks a write, only enriches the error
 * message after Jira's own 400.
 *
 * labelsByTeam/labelsFetchedAt is Linear-only — Linear requires labels to
 * pre-exist as real objects (unlike Jira's freeform labels), and its own
 * `updateFields` re-fetches the full team label list via GraphQL on every
 * single call with no caching. Keyed by team id (Linear's label scope),
 * same 3-day freshness bar.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

export const METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — full project-list scan
export const SINGLE_PROJECT_TTL_MS = 3 * 24 * 60 * 60 * 1000; // 3 days — targeted, "on purpose" lookup

/**
 * Shared freshness check for a single stored timestamp — used by both
 * `issue-types --project=KEY` and the reactive create-failure enrichment
 * path, so the two "on purpose, single project" access patterns can't
 * silently drift onto different freshness logic over time.
 */
export function isFresh(isoTimestamp, ttlMs) {
  if (!isoTimestamp) return false;
  const age = Date.now() - new Date(isoTimestamp).getTime();
  return !isNaN(age) && age <= ttlMs;
}

/**
 * Merges one project's issue types into an existing (possibly null) cached
 * map, returning a new { issueTypesByProject, issueTypesFetchedAt } pair —
 * shared by both single-project write paths (`issue-types --project=KEY`
 * and the reactive create-failure enrichment) so the null-prototype defense
 * below can't independently drift or regress between them.
 *
 * Object.create(null), not {} — projectKey is an unvalidated CLI value
 * reaching a key position; a plain {} lets "--project=__proto__" redirect
 * into the object's own prototype slot instead of creating a real entry.
 */
export function mergeProjectIssueTypes(cached, projectKey, types, fetchedAt = new Date().toISOString()) {
  const issueTypesByProject = Object.assign(Object.create(null), cached?.issueTypesByProject ?? {});
  issueTypesByProject[projectKey] = types;
  const issueTypesFetchedAt = Object.assign(Object.create(null), cached?.issueTypesFetchedAt ?? {});
  issueTypesFetchedAt[projectKey] = fetchedAt;
  return { issueTypesByProject, issueTypesFetchedAt };
}

/**
 * Trim + lowercase — the one normalization every assignable-users cache
 * read and write must agree on, so "Jane", " jane ", and "JANE" share one
 * cache entry instead of three.
 */
export function normalizeAssigneeQuery(query) {
  return String(query).trim().toLowerCase();
}

/**
 * Merges one (project, query) assignable-users search result into an
 * existing (possibly null) cached map — same shape and same
 * Object.create(null) defense as mergeProjectIssueTypes, one level deeper
 * since a project can have many independently-fresh cached queries. Both
 * projectKey and the normalized query are unvalidated values reaching a
 * key position.
 */
export function mergeAssignableUsers(cached, projectKey, query, candidates, fetchedAt = new Date().toISOString()) {
  const normalizedQuery = normalizeAssigneeQuery(query);

  const assignableUsersByProject = Object.assign(Object.create(null), cached?.assignableUsersByProject ?? {});
  const projectQueries = Object.assign(Object.create(null), assignableUsersByProject[projectKey] ?? {});
  projectQueries[normalizedQuery] = candidates;
  assignableUsersByProject[projectKey] = projectQueries;

  const assignableUsersFetchedAt = Object.assign(Object.create(null), cached?.assignableUsersFetchedAt ?? {});
  const projectQueryTimestamps = Object.assign(Object.create(null), assignableUsersFetchedAt[projectKey] ?? {});
  projectQueryTimestamps[normalizedQuery] = fetchedAt;
  assignableUsersFetchedAt[projectKey] = projectQueryTimestamps;

  return { assignableUsersByProject, assignableUsersFetchedAt };
}

/**
 * Merges one project's priority list into an existing (possibly null)
 * cached map — same shape and Object.create(null) defense as
 * mergeProjectIssueTypes, for the same reason (projectKey is an
 * unvalidated CLI/tracker value reaching a key position).
 */
export function mergeProjectPriorities(cached, projectKey, priorities, fetchedAt = new Date().toISOString()) {
  const prioritiesByProject = Object.assign(Object.create(null), cached?.prioritiesByProject ?? {});
  prioritiesByProject[projectKey] = priorities;
  const prioritiesFetchedAt = Object.assign(Object.create(null), cached?.prioritiesFetchedAt ?? {});
  prioritiesFetchedAt[projectKey] = fetchedAt;
  return { prioritiesByProject, prioritiesFetchedAt };
}

/**
 * Merges one team's label list into an existing (possibly null) cached
 * map — same shape and Object.create(null) defense as
 * mergeProjectIssueTypes; teamId is Linear's own UUID, not user-supplied,
 * but the same defensive pattern is kept for consistency with its siblings.
 */
export function mergeTeamLabels(cached, teamId, labels, fetchedAt = new Date().toISOString()) {
  const labelsByTeam = Object.assign(Object.create(null), cached?.labelsByTeam ?? {});
  labelsByTeam[teamId] = labels;
  const labelsFetchedAt = Object.assign(Object.create(null), cached?.labelsFetchedAt ?? {});
  labelsFetchedAt[teamId] = fetchedAt;
  return { labelsByTeam, labelsFetchedAt };
}

/**
 * Returns the absolute path to the ticket-metadata cache file for a profile.
 */
export function metadataCachePath(profileName, configDir = DEFAULT_CONFIG_DIR) {
  const safeProfile = (profileName || '_default').replace(/[^a-zA-Z0-9_\-]/g, '_');
  const resolvedDir = path.resolve(configDir);
  const result = path.join(resolvedDir, 'cache', safeProfile, 'ticket-metadata.json');
  // Defense-in-depth: ensure the final path cannot escape the config directory,
  // even if configDir itself is manipulated or the sanitization above is weakened.
  if (!result.startsWith(resolvedDir + path.sep)) {
    throw new Error(`Cache path escapes config directory: ${result}`);
  }
  return result;
}

/**
 * Reads cached project/issue-type metadata for a profile.
 * Returns null on cache miss, expired TTL, or corrupt JSON.
 *
 * @param {string|null} profileName
 * @param {string} [configDir]
 * @param {number} [ttlMs] - override TTL in ms for this file's own GC deletion; defaults to METADATA_TTL_MS (7d)
 * @returns {{ projects: {key:string,name:string}[], issueTypesByProject: object, issueTypesFetchedAt: object, assignableUsersByProject: object, assignableUsersFetchedAt: object, prioritiesByProject: object, prioritiesFetchedAt: object, labelsByTeam: object, labelsFetchedAt: object, projectsFetchedAt: string|null, fetchedAt: string } | null}
 */
export function readMetadataCache(profileName, configDir = DEFAULT_CONFIG_DIR, ttlMs = METADATA_TTL_MS) {
  const filePath = metadataCachePath(profileName, configDir);
  if (!fs.existsSync(filePath)) return null;

  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }

  const age = Date.now() - new Date(data.fetchedAt).getTime();
  if (isNaN(age) || age > ttlMs) {
    try { fs.unlinkSync(filePath); } catch { /* non-fatal */ }
    return null;
  }

  return {
    projects: data.projects ?? [],
    issueTypesByProject: data.issueTypesByProject ?? {},
    issueTypesFetchedAt: data.issueTypesFetchedAt ?? {},
    assignableUsersByProject: data.assignableUsersByProject ?? {},
    assignableUsersFetchedAt: data.assignableUsersFetchedAt ?? {},
    prioritiesByProject: data.prioritiesByProject ?? {},
    prioritiesFetchedAt: data.prioritiesFetchedAt ?? {},
    labelsByTeam: data.labelsByTeam ?? {},
    labelsFetchedAt: data.labelsFetchedAt ?? {},
    projectsFetchedAt: data.projectsFetchedAt ?? null,
    fetchedAt: data.fetchedAt,
  };
}

/**
 * Writes project/issue-type metadata to the cache. Non-fatal — a write
 * failure must never break the caller (an enrichment attempt after an
 * already-failed create). Callers own merge-before-write for partial
 * updates (e.g. a single-project fetch merging into an existing
 * multi-project cache) — this function persists exactly what it's given.
 */
export function writeMetadataCache(profileName, { projects = [], issueTypesByProject = {}, issueTypesFetchedAt = {}, assignableUsersByProject = {}, assignableUsersFetchedAt = {}, prioritiesByProject = {}, prioritiesFetchedAt = {}, labelsByTeam = {}, labelsFetchedAt = {}, projectsFetchedAt = null } = {}, configDir = DEFAULT_CONFIG_DIR) {
  const filePath = metadataCachePath(profileName, configDir);
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({
      fetchedAt: new Date().toISOString(),
      projectsFetchedAt,
      projects,
      issueTypesByProject,
      issueTypesFetchedAt,
      assignableUsersByProject,
      assignableUsersFetchedAt,
      prioritiesByProject,
      prioritiesFetchedAt,
      labelsByTeam,
      labelsFetchedAt,
    }));
  } catch {
    // Non-fatal
  }
}
