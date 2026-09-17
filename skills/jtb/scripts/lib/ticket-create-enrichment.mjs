/**
 * Failure-message enrichment for `ticket_create` — reactive only, never
 * runs on the success path. Extracted from ticket-command.mjs to keep that
 * file under the project's 800-line cap and to isolate a self-contained
 * concern (project/issuetype cache read-through-and-refresh) from the rest
 * of ticket-command.mjs's routing logic.
 */

import { SINGLE_PROJECT_TTL_MS, isFresh, mergeProjectIssueTypes } from './ticket-metadata-cache.mjs';

/**
 * Detects whether a create failure is shaped like a project/issuetype
 * mismatch — the only case cache-refresh enrichment applies to. Jira
 * surfaces this via its own real `err.details.errors.{project,issuetype}`
 * keys (confirmed by direct observation against a live instance during
 * ticket_create's own launch verification); Linear's client-side
 * team-resolution failure is marked with `err.code` instead of
 * message-sniffed. Anything else (rate limits, network errors, generic
 * 4xx/5xx) returns null — enrichment never applies there.
 */
export function detectProjectOrTypeError(err) {
  if (err?.code === 'PROJECT_NOT_FOUND') return { project: true, type: false };
  const errors = err?.details?.errors;
  if (!errors) return null;
  const project = 'project' in errors;
  const type = 'issuetype' in errors;
  return (project || type) ? { project, type } : null;
}

/**
 * Best-effort failure-message enrichment for ticket_create — reactive
 * only, never runs on the success path or for a non-project/type failure.
 * Reuses a cached project/issue-type listing when fresh (no extra network
 * call); refreshes it when missing/stale. A refresh failure is swallowed
 * entirely and nothing is written to the cache: this can only ever make
 * an error message MORE informative, never introduce a new way for
 * ticketlens create to fail or a new way to poison the cache.
 */
export async function enrichCreateFailure(err, { adapter, project, profileName, configDir, readMetadataCacheFn, writeMetadataCacheFn }) {
  const shape = detectProjectOrTypeError(err);
  if (!shape || adapter.type === 'github') return '';

  let cached = readMetadataCacheFn(profileName, configDir);
  // Checked independently, not "cache present? skip entirely" — a cache
  // populated by an earlier *project* error has projects but no issue
  // types for this specific project, and vice versa. Treating any cache
  // hit as fully sufficient silently drops the other half of a later,
  // differently-shaped error's enrichment (caught via live-instance
  // testing, not by unit tests alone).
  //
  // This is a targeted, single-project fetch — "on purpose," same pattern
  // as `issue-types --project=KEY` — so issue-types presence alone isn't
  // enough: it must also be fresh within SINGLE_PROJECT_TTL_MS (3 days),
  // not the longer full-scan bar.
  const hasFreshIssueTypes = cached?.issueTypesByProject?.[project]?.length
    && isFresh(cached?.issueTypesFetchedAt?.[project], SINGLE_PROJECT_TTL_MS);
  const needsProjects = shape.project && !cached?.projects?.length;
  const needsIssueTypes = shape.type && adapter.type === 'jira' && project && !hasFreshIssueTypes;

  if (needsProjects || needsIssueTypes) {
    try {
      const projects = needsProjects ? await adapter.listCreatableProjects() : (cached?.projects ?? []);
      // Object.create(null), not {} — preserves any existing entries when
      // this pass only needed `projects`, not a new issue-type fetch. See
      // mergeProjectIssueTypes' own doc for why a null-prototype target
      // matters once `project` (an unvalidated CLI value) reaches a key.
      let issueTypesByProject = Object.assign(Object.create(null), cached?.issueTypesByProject ?? {});
      let issueTypesFetchedAt = Object.assign(Object.create(null), cached?.issueTypesFetchedAt ?? {});
      if (needsIssueTypes) {
        ({ issueTypesByProject, issueTypesFetchedAt } = mergeProjectIssueTypes(cached, project, await adapter.listIssueTypes(project)));
      }
      cached = {
        projects,
        issueTypesByProject,
        issueTypesFetchedAt,
        projectsFetchedAt: needsProjects ? new Date().toISOString() : (cached?.projectsFetchedAt ?? null),
      };
      writeMetadataCacheFn(profileName, cached, configDir);
    } catch {
      return '';
    }
  }

  if (!cached) return '';

  const parts = [];
  if (shape.project && cached.projects?.length) {
    parts.push(`  Known creatable projects: ${cached.projects.map(p => p.key).join(', ')}.\n`);
  }
  if (shape.type && project && cached.issueTypesByProject?.[project]?.length) {
    parts.push(`  Known issue types for ${project}: ${cached.issueTypesByProject[project].map(t => t.name).join(', ')}.\n`);
  }
  return parts.join('');
}
