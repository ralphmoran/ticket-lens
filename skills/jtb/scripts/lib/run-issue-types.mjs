import { DEFAULT_CONFIG_DIR, timeAgo } from './config.mjs';
import { resolveConnection } from './profile-resolver.mjs';
import { resolveAdapter } from './resolve-adapter.mjs';
import { readMetadataCache, writeMetadataCache, METADATA_TTL_MS, SINGLE_PROJECT_TTL_MS, isFresh, mergeProjectIssueTypes } from './ticket-metadata-cache.mjs';
import { createStyler } from './ansi.mjs';
import { handleUnknownFlags } from './arg-validator.mjs';
import { printIssueTypesHelp } from './help.mjs';
import { formatTable } from './table-formatter.mjs';

// A cache hit must cover every project it lists — a cache seeded only by
// ticket-create-enrichment.mjs's reactive path (one project at a time, on a
// create failure) can have projects with no recorded issue types yet. Showing
// that as "the" answer would silently omit the rest of the profile's projects.
// Recency is checked per-project (not just the whole file's own GC marker) —
// a project's entry can be older than the file itself if only OTHER projects
// were refreshed since (e.g. by an intervening --project=KEY fetch). A cache
// written before issueTypesFetchedAt/projectsFetchedAt existed has neither
// field, so isFresh(undefined, ...) correctly treats it as stale — one live
// full scan repopulates both, then reuse resumes as normal.
function isCacheComplete(cached) {
  if (!cached || cached.projects.length === 0) return false;
  if (!isFresh(cached.projectsFetchedAt, METADATA_TTL_MS)) return false;
  return cached.projects.every(p => {
    const types = cached.issueTypesByProject[p.key];
    if (!types || types.length === 0) return false;
    return isFresh(cached.issueTypesFetchedAt?.[p.key], METADATA_TTL_MS);
  });
}

function render({ print, format, projects, issueTypesByProject, fetchedAt, cached, ttlLabel }) {
  if (format === 'json') {
    print(JSON.stringify({ projects, issueTypesByProject, fetchedAt, cached }, null, 2) + '\n');
    return;
  }

  const s = createStyler({ isTTY: process.stdout.isTTY });

  if (projects.length === 0) {
    print(`\n  ${s.dim('No creatable projects found for this profile.')}\n\n`);
    return;
  }

  const rows = projects.map(p => {
    const types = issueTypesByProject[p.key] || [];
    return [p.key, types.length ? types.map(t => t.name).join(', ') : s.dim('(none)')];
  });

  print('\n');
  print(formatTable(['Project', 'Issue Types'], rows) + '\n');
  print(`\n  ${s.dim(cached
    ? `Cached ${timeAgo(fetchedAt)} — pass --refresh to force a live fetch.`
    : `Fetched live and cached for ${ttlLabel}.`)}\n\n`);
}

/**
 * A targeted `--project=KEY` lookup — "on purpose," so it trusts a shorter
 * SINGLE_PROJECT_TTL_MS (3d) than a full scan's 7d, and merge-writes just
 * this one project into the shared cache instead of replacing it (same
 * read-merge-write pattern ticket-create-enrichment.mjs already uses for
 * its own single-project reactive path). No display name is available
 * without the full project-list scan, so `name` is honestly null rather
 * than guessed.
 */
async function runSingleProject({ print, warn, format, projectKey, forceRefresh, adapter, profileName, configDir, readMetadataCacheFn, writeMetadataCacheFn }) {
  const cached = !forceRefresh ? readMetadataCacheFn(profileName, configDir) : null;
  const cachedTypes = cached?.issueTypesByProject?.[projectKey];

  if (cachedTypes?.length && isFresh(cached.issueTypesFetchedAt?.[projectKey], SINGLE_PROJECT_TTL_MS)) {
    render({
      print, format,
      projects: [{ key: projectKey, name: null }],
      issueTypesByProject: { [projectKey]: cachedTypes },
      fetchedAt: cached.issueTypesFetchedAt[projectKey],
      cached: true,
    });
    return { ok: true };
  }

  let types;
  try {
    types = await adapter.listIssueTypes(projectKey);
  } catch (err) {
    warn(`  Could not fetch issue types: ${err.message}\n`);
    process.exitCode = 1;
    return { ok: false };
  }

  const now = new Date().toISOString();
  const { issueTypesByProject, issueTypesFetchedAt } = mergeProjectIssueTypes(cached, projectKey, types, now);

  writeMetadataCacheFn(profileName, {
    projects: cached?.projects ?? [],
    issueTypesByProject,
    issueTypesFetchedAt,
    projectsFetchedAt: cached?.projectsFetchedAt ?? null,
  }, configDir);

  render({
    print, format,
    projects: [{ key: projectKey, name: null }],
    issueTypesByProject: { [projectKey]: types },
    fetchedAt: now,
    cached: false,
    ttlLabel: '3 days',
  });
  return { ok: true };
}

/**
 * `ticketlens issue-types` — proactive counterpart to
 * ticket-create-enrichment.mjs's reactive cache-refresh: fetches every
 * creatable project and its Jira issue types ahead of a `ticketlens create`
 * attempt instead of only learning them from a failed create's error.
 * Writes through the same ticket-metadata-cache.mjs file/TTL that enrichment
 * reads, so a create failure right after this command is a pure cache hit.
 * `--project=KEY` narrows to a single project — see runSingleProject above.
 *
 * @param {string[]} args
 * @returns {Promise<{ ok: boolean }>}
 */
export async function runIssueTypes(args = [], opts = {}) {
  const print     = opts.print            ?? ((s) => process.stdout.write(s));
  const warn      = opts.warn             ?? ((s) => process.stderr.write(s));
  const configDir = opts.configDir        ?? DEFAULT_CONFIG_DIR;
  const resolveConnectionFn  = opts.resolveConnectionFn  ?? resolveConnection;
  const resolveAdapterFn     = opts.resolveAdapterFn     ?? resolveAdapter;
  const readMetadataCacheFn  = opts.readMetadataCacheFn  ?? readMetadataCache;
  const writeMetadataCacheFn = opts.writeMetadataCacheFn ?? writeMetadataCache;

  if (args.includes('--help') || args.includes('-h')) {
    printIssueTypesHelp();
    return { ok: true };
  }

  const validated = await handleUnknownFlags(
    args,
    ['--help', '-h', '--profile=', '--refresh', '--format=', '--project='],
    { hints: [] },
  );
  if (validated === null) { process.exitCode = 1; return { ok: false }; }

  const profileArg = args.find(a => a.startsWith('--profile='));
  const formatArg  = args.find(a => a.startsWith('--format='));
  const projectArg = args.find(a => a.startsWith('--project='));
  const forceRefresh = args.includes('--refresh');

  const format = formatArg ? formatArg.split('=')[1] : 'plain';
  if (format !== 'plain' && format !== 'json') {
    warn(`Error: --format must be plain or json, got: ${format}\n`);
    process.exitCode = 1;
    return { ok: false };
  }

  const projectKey = projectArg ? projectArg.split('=')[1] : undefined;
  if (projectArg && !projectKey) {
    warn('Error: --project requires a value, e.g. --project=PROJ\n');
    process.exitCode = 1;
    return { ok: false };
  }

  const explicitProfile = profileArg ? profileArg.split('=')[1] : undefined;
  const cwd = opts.cwd ?? process.cwd();
  const conn = resolveConnectionFn(null, {
    configDir,
    profileName: explicitProfile,
    cwd,
    onWarning: (msg) => warn(`  ⚠ ${msg}\n`),
  });
  if (!conn.baseUrl) {
    warn('  No connection configured. Run `ticketlens init` or pass --profile=NAME.\n');
    process.exitCode = 1;
    return { ok: false };
  }

  const adapter = resolveAdapterFn(conn);
  if (adapter.type !== 'jira') {
    warn(`  Issue types are not available for this tracker (${adapter.type}) — only Jira exposes per-project issue types.\n`);
    process.exitCode = 1;
    return { ok: false };
  }

  const profileName = conn.profileName ?? 'default';

  if (projectKey) {
    return runSingleProject({ print, warn, format, projectKey, forceRefresh, adapter, profileName, configDir, readMetadataCacheFn, writeMetadataCacheFn });
  }

  if (!forceRefresh) {
    const cached = readMetadataCacheFn(profileName, configDir);
    if (isCacheComplete(cached)) {
      render({ print, format, projects: cached.projects, issueTypesByProject: cached.issueTypesByProject, fetchedAt: cached.projectsFetchedAt, cached: true });
      return { ok: true };
    }
  }

  let projects, issueTypesByProject;
  try {
    projects = await adapter.listCreatableProjects();
    issueTypesByProject = Object.create(null);
    for (const p of projects) {
      issueTypesByProject[p.key] = await adapter.listIssueTypes(p.key);
    }
  } catch (err) {
    warn(`  Could not fetch issue types: ${err.message}\n`);
    process.exitCode = 1;
    return { ok: false };
  }

  const now = new Date().toISOString();
  const issueTypesFetchedAt = Object.create(null);
  for (const p of projects) issueTypesFetchedAt[p.key] = now;

  writeMetadataCacheFn(profileName, { projects, issueTypesByProject, issueTypesFetchedAt, projectsFetchedAt: now }, configDir);
  render({ print, format, projects, issueTypesByProject, fetchedAt: now, cached: false, ttlLabel: '7 days' });
  return { ok: true };
}
