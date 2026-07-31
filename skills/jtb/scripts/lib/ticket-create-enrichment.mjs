/**
 * Failure-message enrichment for `ticket_create` — reactive only, never
 * runs on the success path. Extracted from ticket-command.mjs to keep that
 * file under the project's 800-line cap and to isolate a self-contained
 * concern (project/issuetype cache read-through-and-refresh) from the rest
 * of ticket-command.mjs's routing logic.
 */

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
  const needsProjects = shape.project && !cached?.projects?.length;
  const needsIssueTypes = shape.type && adapter.type === 'jira' && project && !cached?.issueTypesByProject?.[project]?.length;

  if (needsProjects || needsIssueTypes) {
    try {
      const projects = needsProjects ? await adapter.listCreatableProjects() : (cached?.projects ?? []);
      // Object.create(null), not {} — `project` is an unvalidated CLI value
      // reaching this key position. On a plain {}, assigning to a key like
      // "__proto__" redirects into the object's own prototype slot instead
      // of creating a real entry, silently losing this project's cache
      // write. A null-prototype target has no such accessor to intercept.
      const issueTypesByProject = Object.assign(Object.create(null), cached?.issueTypesByProject ?? {});
      if (needsIssueTypes) {
        issueTypesByProject[project] = await adapter.listIssueTypes(project);
      }
      cached = { projects, issueTypesByProject };
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
