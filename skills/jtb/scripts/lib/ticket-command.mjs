/**
 * Implements `tl comment` and `tl transition`. Both are Pro+-gated writes to
 * the underlying tracker (Jira/GitHub/Linear), consistent with the rest of
 * the Recall/MCP family. `transition` is split into two functions from the
 * start — list (read-only discovery) and execute (requires a resolved
 * --target + --confirm) — rather than one function branching internally,
 * so each independently matches the established runX(cmdArgs, deps) -> {ok}
 * single-decision shape. `--confirm` is a behavioral nudge and audit trail,
 * not a hard security guarantee — framed that way deliberately, not oversold.
 */

import os from 'node:os';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { isLicensed, showUpgradePrompt } from './license.mjs';
import { resolveConnection, findProfilesByPrefix } from './profile-resolver.mjs';
import { resolveAdapter } from './resolve-adapter.mjs';
import { claimAction, releaseAction } from './ticket-action-cooldown.mjs';
import { logAction } from './ticket-action-log.mjs';
import { readMetadataCache, writeMetadataCache, isFresh, SINGLE_PROJECT_TTL_MS, mergeAssignableUsers, normalizeAssigneeQuery } from './ticket-metadata-cache.mjs';
import { detectProjectOrTypeError, enrichCreateFailure } from './ticket-create-enrichment.mjs';
import { enrichUpdateFailure } from './ticket-update-enrichment.mjs';
import { TICKET_KEY_PATTERN, normalizeTicketKey } from './cli.mjs';
import { scoreCandidates } from './duplicate-scorer.mjs';
import { MAX_ATTACHMENTS } from './attachment-uploader.mjs';
import { createStyler } from './ansi.mjs';

export function parseFlag(cmdArgs, name) {
  return cmdArgs.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function parseAttachPaths(cmdArgs) {
  const raw = parseFlag(cmdArgs, 'attach');
  return raw ? raw.split(',').map(p => p.trim()).filter(Boolean) : [];
}

/**
 * Best-effort release of a claimAction cooldown claim (Backlog #34/ROADMAP
 * 57) — releaseAction can itself throw (lock contention, same as any
 * withLock caller in ticket-action-cooldown.mjs). A release is always
 * called while already reporting some other outcome (a write failure, a
 * refusal, an executed:false result); letting a lock-contention error
 * replace that outcome would be strictly worse than just leaving the claim
 * in place a few seconds longer — it expires on its own. Same "best
 * effort — the claim expires by itself" reasoning already applied to
 * ticket-worklog.mjs's own releaseClaim helper, DRY'd here across every
 * write in this family instead of duplicated per function.
 */
export function safeRelease(releaseActionFn, ticketKey, action, configDir) {
  try { releaseActionFn(ticketKey, action, { configDir }); } catch { /* best effort — the claim expires by itself */ }
}

/**
 * claimAction can itself throw — lock contention on the same 2s deadline
 * as any other withLock caller in ticket-action-cooldown.mjs. Left
 * unguarded, that throw would fall through to the outer CLI/MCP error
 * handler and be misreported as a real failure (and could trip the
 * opt-in error-reporting pipeline) for what is actually correct, benign
 * contention — the write is still safely refused either way, but the
 * graceful "Skipped" UX this whole family is built around would be lost.
 * Same guard ticket-worklog.mjs's own claimOrSkip already has; returns a
 * `lockError` string instead of a boolean flag so each call site can
 * fold it into its existing skip-message wording without a second
 * lookup. Caught in code review before shipping — not exercised by the
 * original 4-way live concurrency trial, which stayed under the 2s
 * deadline.
 */
export function safeClaim(claimActionFn, ticketKey, action, configDir) {
  try {
    return claimActionFn(ticketKey, action, { configDir });
  } catch (err) {
    return { claimed: false, remainingMs: 0, lockError: err.message };
  }
}

/**
 * GitHub has no PAT-compatible public API for uploading issue/comment
 * assets (confirmed via research — the only upload endpoint requires a
 * browser session, not a token). Refused before the adapter is ever
 * called, same pattern already used for GitHub's --priority refusal in
 * ticket_update, rather than silently no-op-ing.
 */
function refuseGithubAttachments(adapter, attachPaths, stream) {
  if (!attachPaths.length || adapter.type !== 'github') return false;
  stream.write('  Note: GitHub does not support file attachments via the API — no supported way to upload issue/comment assets exists. Continuing without --attach.\n');
  return true;
}

function formatAttachSummary(attachResult, s) {
  if (!attachResult) return '';
  const lines = [];
  for (const u of attachResult.uploaded) lines.push(`  ${s.green('✔')} Attached ${s.bold(u.filename)}${u.url ? ` (${u.url})` : ''}\n`);
  for (const e of attachResult.errors) lines.push(`  Failed to attach ${e.path}: ${e.message}\n`);
  if (attachResult.droppedCount > 0) lines.push(`  ${attachResult.droppedCount} attachment(s) dropped — exceeds the ${MAX_ATTACHMENTS}-file limit per call.\n`);
  return lines.join('');
}

/**
 * Distinguishes retryable/terminal/rate-limited write failures so CLI and
 * MCP callers get the same actionable signal instead of a generic catch —
 * mirrors recall-queue.mjs's isRetryableFailure/pushNote pairing. Never
 * auto-retries a timeout itself: a timed-out write may have already landed
 * server-side, unlike Recall's idempotent-by-external_id notes.
 *
 * @param {Error & { status?: number, rateLimit?: object }} err
 * @returns {{ kind: 'rate-limited'|'network-or-timeout'|'server-error'|'terminal', [key: string]: unknown }}
 */
export function classifyWriteFailure(err) {
  if (err?.rateLimit) {
    return { kind: 'rate-limited', detail: err.rateLimit };
  }
  if (err?.status === undefined) {
    return { kind: 'network-or-timeout' };
  }
  if (err.status >= 500) {
    return { kind: 'server-error', status: err.status };
  }
  return { kind: 'terminal', status: err.status, details: err.details };
}

export function formatWriteFailure(ticketKey, err) {
  const classification = classifyWriteFailure(err);
  switch (classification.kind) {
    case 'rate-limited': {
      const wait = classification.detail.retryAfterSeconds ?? null;
      return wait
        ? `  Rate limited by the tracker — retry ${ticketKey} after ~${wait}s.\n`
        : `  Rate limited by the tracker — try ${ticketKey} again later.\n`;
    }
    case 'network-or-timeout':
      return `  Network error or timeout writing to ${ticketKey} — not retried automatically (a timed-out write may have already landed). Check the ticket before retrying.\n`;
    case 'server-error':
      return `  Tracker returned a server error (${classification.status}) for ${ticketKey}. Try again later.\n`;
    default:
      return `  Failed to write to ${ticketKey}: ${err.message}\n`;
  }
}

/**
 * Read-path counterpart to formatWriteFailure — reuses the same
 * classification (rate-limit/timeout/server-error metadata is real and
 * worth keeping, not specific to writes) but with read-appropriate wording,
 * parameterized by what's being checked (e.g. "for duplicates", "for link
 * options") since neither duplicates nor link-list ever writes anything.
 */
function formatReadFailure(ticketKey, err, actionPhrase) {
  const classification = classifyWriteFailure(err);
  switch (classification.kind) {
    case 'rate-limited': {
      const wait = classification.detail.retryAfterSeconds ?? null;
      return wait
        ? `  Rate limited by the tracker — retry checking ${ticketKey} ${actionPhrase} after ~${wait}s.\n`
        : `  Rate limited by the tracker — try checking ${ticketKey} ${actionPhrase} again later.\n`;
    }
    case 'network-or-timeout':
      return `  Network error or timeout checking ${ticketKey} ${actionPhrase}. Try again.\n`;
    case 'server-error':
      return `  Tracker returned a server error (${classification.status}) checking ${ticketKey} ${actionPhrase}. Try again later.\n`;
    default:
      return `  Error checking ${ticketKey} ${actionPhrase}: ${err.message}\n`;
  }
}

function formatDuplicatesFailure(ticketKey, err) {
  return formatReadFailure(ticketKey, err, 'for duplicates');
}

/**
 * Match-confidence color tier for a duplicates result: ≥70% reads as a strong
 * signal, 50-69% as worth a look, below that as a weak, low-confidence nudge.
 * Exported standalone so the boundary values are pinned by a direct test
 * rather than reverse-engineered from real Jaccard scores in a fixture.
 */
export function matchColor(pct, s) {
  if (pct >= 70) return s.green;
  if (pct >= 50) return s.yellow;
  return s.dim;
}

function formatLinkListFailure(ticketKey, err) {
  return formatReadFailure(ticketKey, err, 'for link options');
}

/**
 * Create-path counterpart to formatWriteFailure — same classification, but
 * there is no ticket key to interpolate (creation never happened).
 */
function formatCreateFailure(err) {
  const classification = classifyWriteFailure(err);
  switch (classification.kind) {
    case 'rate-limited': {
      const wait = classification.detail.retryAfterSeconds ?? null;
      return wait
        ? `  Rate limited by the tracker — retry creating the ticket after ~${wait}s.\n`
        : `  Rate limited by the tracker — try creating the ticket again later.\n`;
    }
    case 'network-or-timeout':
      return `  Network error or timeout creating the ticket — not retried automatically (a timed-out write may have already landed; check the tracker before retrying).\n`;
    case 'server-error':
      return `  Tracker returned a server error (${classification.status}) creating the ticket. Try again later.\n`;
    default:
      return `  Failed to create the ticket: ${err.message}\n`;
  }
}

/**
 * Adapter error shapes for updateFields genuinely differ per tracker: a
 * thrown Error (Jira/atomic-call failures, GitHub's shared title/description
 * PATCH, GitHub's addLabels call), a { reason: 'not-found', missing/options }
 * descriptor (Linear's pre-flight label/priority resolution), or a
 * label -> Error map (GitHub's per-label DELETE loop, since each removal is
 * independent and can fail differently). Never assume a single shape.
 */
function formatFieldError(field, info) {
  if (info instanceof Error) return `${field} (${info.message})`;
  if (info?.reason === 'not-found') {
    const list = info.missing ?? info.options ?? [];
    return `${field} (not found${list.length ? `: ${list.join(', ')}` : ''})`;
  }
  const perLabel = Object.entries(info ?? {}).map(([label, err]) => `${label}: ${err.message}`).join(', ');
  return `${field} (${perLabel})`;
}

function describeAppliedFields(applied) {
  const parts = [];
  if (applied.title) parts.push('title');
  if (applied.description) parts.push('description');
  if (applied.priority) parts.push(`priority=${applied.priority}`);
  if (applied.addLabels?.length) parts.push(`+labels(${applied.addLabels.join(', ')})`);
  if (applied.removeLabels?.length) parts.push(`-labels(${applied.removeLabels.join(', ')})`);
  return parts.join(', ');
}

function formatUpdateResult(ticketKey, { applied, errors }, s) {
  const appliedText = describeAppliedFields(applied);
  const errorText = Object.entries(errors).map(([field, info]) => formatFieldError(field, info)).join('; ');
  // Success/partial get the styled brand+bold key; total failure stays plain,
  // consistent with every other refusal/error message in this file (e.g. the
  // GitHub-priority-refusal line just above in runTicketUpdate).
  if (appliedText && !errorText) return `  ${s.green('✔')} ${s.brand(s.bold(ticketKey))} updated: ${s.bold(appliedText)}.\n`;
  if (appliedText && errorText) return `  ${s.yellow('~')} ${s.brand(s.bold(ticketKey))} partially updated: ${s.bold(appliedText)}. Failed: ${errorText}.\n`;
  return `  Nothing updated on ${ticketKey}. Failed: ${errorText}.\n`;
}

export function requireLicense(isLicensedFn, configDir, commandName, stream) {
  if (isLicensedFn('pro', configDir)) return true;
  showUpgradePrompt('pro', commandName, { stream });
  return false;
}

function requireTicketKey(cmdArgs, usage, stream) {
  const ticketKey = cmdArgs[0];
  if (!ticketKey || ticketKey.startsWith('--')) {
    stream.write(usage);
    return null;
  }
  const normalized = normalizeTicketKey(ticketKey);
  if (!TICKET_KEY_PATTERN.test(normalized)) {
    stream.write(usage);
    return null;
  }
  if (normalized !== ticketKey) normalizeTicketKey(ticketKey, { stream });
  return normalized;
}

/**
 * `ticketKey` is undefined for ticket_create — there is no existing ticket to
 * prefix-match a connection from, so resolution falls through to --profile,
 * the folder-based `cwd` match, or the default profile (resolveConnectionFn
 * already handles a falsy ticketKey by skipping prefix matching, see
 * profile-resolver.mjs). `cwd` is always the running process's own — every
 * ticket-write command runs synchronously within a single CLI/MCP-server
 * invocation, so there is never a separate "caller's cwd" to thread through.
 *
 * Returns `{ adapter, conn }` (not just the adapter) so callers that need to
 * cross-check the resolved connection's identity — currently only
 * `runTicketCreate`'s profile/project mismatch safety net — have it without
 * re-resolving.
 */
export function resolveTicketAdapter(ticketKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream }) {
  const profileName = parseFlag(cmdArgs, 'profile');
  const conn = resolveConnectionFn(ticketKey, {
    configDir,
    profileName,
    cwd: process.cwd(),
    onWarning: (msg) => stream.write(`  ⚠ ${msg}\n`),
  });
  if (!conn.baseUrl) {
    stream.write(ticketKey
      ? `  No connection configured for ${ticketKey}. Run \`ticketlens init\`.\n`
      : `  No connection configured. Run \`ticketlens init\` or pass --profile=NAME.\n`);
    return null;
  }
  return { adapter: resolveAdapterFn(conn), conn };
}

/**
 * @param {string[]} cmdArgs - [ticketKey, ...flags], e.g. ["PROJ-1", '--body=Looks good']
 * @returns {Promise<{ ok: boolean }>}
 */
export async function runTicketComment(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  isLicensedFn = isLicensed,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
  claimActionFn = claimAction,
  releaseActionFn = releaseAction,
  logActionFn = logAction,
  actor = os.userInfo().username,
} = {}) {
  const usage = 'Usage: ticketlens comment TICKET-KEY --body="..." [--attach=path1,path2]\n';
  if (!requireLicense(isLicensedFn, configDir, 'ticketlens comment', stream)) return { ok: false };

  const ticketKey = requireTicketKey(cmdArgs, usage, stream);
  if (!ticketKey) return { ok: false };

  const body = parseFlag(cmdArgs, 'body');
  if (!body) {
    stream.write(usage);
    return { ok: false };
  }
  const attachPaths = parseAttachPaths(cmdArgs);

  const claim = safeClaim(claimActionFn, ticketKey, 'comment', configDir);
  if (!claim.claimed) {
    stream.write(claim.lockError
      ? `  ${ticketKey} not commented — could not take the cooldown lock (${claim.lockError}). Nothing was sent; safe to retry.\n`
      : `  Skipped — a comment was already posted to ${ticketKey} ${Math.ceil(claim.remainingMs / 1000)}s ago. Wait a moment before retrying.\n`);
    return { ok: false };
  }

  const resolved = resolveTicketAdapter(ticketKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!resolved) { safeRelease(releaseActionFn, ticketKey, 'comment', configDir); return { ok: false }; }
  const { adapter } = resolved;
  const s = createStyler({ isTTY: stream.isTTY });

  // Uploaded BEFORE the comment write so a tracker capable of inline
  // rendering (Jira Server/DC via wiki markup, Jira Cloud via a real ADF
  // media node, Linear via Markdown) can fold it into the same atomic
  // comment post rather than needing a second edit call. Inside the same
  // try/catch as addComment — every adapter's attachFiles is documented to
  // never throw (per-file errors are caught internally), but that is an
  // implicit contract, not something to leave an un-released claim on if
  // it were ever violated (caught in code review before shipping).
  let attachResult = null;
  try {
    if (attachPaths.length && !refuseGithubAttachments(adapter, attachPaths, stream)) {
      attachResult = await adapter.attachFiles(ticketKey, attachPaths);
    }
    const inlineSnippets = (attachResult?.uploaded ?? []).filter(a => a.inlineMarkup).map(a => a.inlineMarkup).join('\n\n');
    const finalBody = inlineSnippets ? `${body}\n\n${inlineSnippets}` : body;
    const extraAdfNodes = (attachResult?.uploaded ?? []).filter(a => a.adfMediaNode).map(a => a.adfMediaNode);
    const result = await adapter.addComment(ticketKey, finalBody, extraAdfNodes.length ? { extraAdfNodes } : {});
    // attachPaths (every path attempted, raw) plus attachedFilenames (what
    // actually landed) — a partial attach failure is reconstructable from
    // the difference between the two, not just silently absent from audit.
    logActionFn({ ticketKey, action: 'comment', actor, tracker: adapter.type, detail: { id: result.id, attachPaths, attachedFilenames: (attachResult?.uploaded ?? []).map(a => a.filename) } }, { configDir });
    stream.write(`  ${s.green('✔')} Comment posted to ${s.brand(s.bold(ticketKey))}${result.url ? ` (${result.url})` : ''}\n` + formatAttachSummary(attachResult, s));
    return { ok: true };
  } catch (err) {
    safeRelease(releaseActionFn, ticketKey, 'comment', configDir);
    // Attachments (if any) genuinely landed on the tracker before this
    // write was attempted — formatAttachSummary is still shown here so a
    // caller retrying the whole command doesn't blindly re-upload them.
    stream.write(formatWriteFailure(ticketKey, err) + formatAttachSummary(attachResult, s));
    return { ok: false };
  }
}

/**
 * Discovery only — never mutates. Lists the tracker's current valid
 * transition options for the ticket.
 *
 * @param {string[]} cmdArgs - [ticketKey]
 * @param {boolean} [cliHints] - true (default) prints CLI flag syntax
 *   (--target=, --confirm) in the hint; false prints MCP-shaped named-arg
 *   wording instead — set by mcp-server.mjs's ticket_transition call sites.
 * @returns {Promise<{ ok: boolean, options?: object[] }>}
 */
export async function runTicketTransitionList(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  isLicensedFn = isLicensed,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
  cliHints = true,
} = {}) {
  const usage = 'Usage: ticketlens transition TICKET-KEY [--target="..." --confirm]\n';
  if (!requireLicense(isLicensedFn, configDir, 'ticketlens transition', stream)) return { ok: false };

  const ticketKey = requireTicketKey(cmdArgs, usage, stream);
  if (!ticketKey) return { ok: false };

  const resolved = resolveTicketAdapter(ticketKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!resolved) return { ok: false };
  const { adapter } = resolved;

  try {
    const options = await adapter.getTransitions(ticketKey);
    const s = createStyler({ isTTY: stream.isTTY });
    if (options.length === 0) {
      stream.write(`  No valid transitions available for ${s.brand(s.bold(ticketKey))}.\n`);
      return { ok: true, options: [] };
    }
    stream.write(`  Valid transitions for ${s.brand(s.bold(ticketKey))}:\n\n`);
    for (const o of options) stream.write(`    ${s.brand('●')} ${o.name}\n`);
    stream.write(cliHints
      ? `\n  Run again with --target="<name>" --confirm to execute.\n`
      : `\n  Call again with target="<name>" and confirm: true to execute.\n`);
    return { ok: true, options };
  } catch (err) {
    stream.write(formatWriteFailure(ticketKey, err));
    return { ok: false };
  }
}

/**
 * Executes a transition. Requires both --target and --confirm — a target
 * without --confirm is treated as incomplete input, never silently executed.
 *
 * @param {string[]} cmdArgs - [ticketKey, '--target=...', '--confirm']
 * @param {boolean} [cliHints] - see runTicketTransitionList's cliHints doc
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function runTicketTransition(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  isLicensedFn = isLicensed,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
  claimActionFn = claimAction,
  releaseActionFn = releaseAction,
  logActionFn = logAction,
  actor = os.userInfo().username,
  cliHints = true,
} = {}) {
  const usage = 'Usage: ticketlens transition TICKET-KEY --target="..." --confirm\n';
  if (!requireLicense(isLicensedFn, configDir, 'ticketlens transition', stream)) return { ok: false };

  const ticketKey = requireTicketKey(cmdArgs, usage, stream);
  if (!ticketKey) return { ok: false };

  const target = parseFlag(cmdArgs, 'target');
  if (!target) {
    stream.write(usage);
    return { ok: false };
  }
  if (!cmdArgs.includes('--confirm')) {
    stream.write(cliHints
      ? `  Refusing to transition ${ticketKey} to "${target}" without --confirm. Re-run with --confirm once you've reviewed the target.\n`
      : `  Refusing to transition ${ticketKey} to "${target}" without confirm: true. Call again with confirm: true once you've reviewed the target.\n`);
    return { ok: false };
  }

  const claim = safeClaim(claimActionFn, ticketKey, 'transition', configDir);
  if (!claim.claimed) {
    stream.write(claim.lockError
      ? `  ${ticketKey} not transitioned — could not take the cooldown lock (${claim.lockError}). Nothing was sent; safe to retry.\n`
      : `  Skipped — ${ticketKey} was already transitioned ${Math.ceil(claim.remainingMs / 1000)}s ago. Wait a moment before retrying.\n`);
    return { ok: false };
  }

  const resolved = resolveTicketAdapter(ticketKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!resolved) { safeRelease(releaseActionFn, ticketKey, 'transition', configDir); return { ok: false }; }
  const { adapter } = resolved;

  try {
    const result = await adapter.transition(ticketKey, target);
    if (!result.executed) {
      safeRelease(releaseActionFn, ticketKey, 'transition', configDir);
      const optionsHint = result.options?.length ? ` Valid options: ${result.options.map(o => o.name).join(', ')}.` : '';
      stream.write(`  Not transitioned — ${result.reason}.${optionsHint}\n`);
      return { ok: false, reason: result.reason };
    }
    logActionFn({ ticketKey, action: 'transition', actor, tracker: adapter.type, detail: { to: result.to } }, { configDir });
    const s = createStyler({ isTTY: stream.isTTY });
    stream.write(`  ${s.green('✔')} ${s.brand(s.bold(ticketKey))} transitioned to ${s.bold(`"${result.to}"`)}.\n`);
    return { ok: true };
  } catch (err) {
    safeRelease(releaseActionFn, ticketKey, 'transition', configDir);
    stream.write(formatWriteFailure(ticketKey, err));
    return { ok: false };
  }
}

/**
 * Derives the project-key portion of a ticket key — used only to key the
 * local assignable-users cache, never for validation. Jira's own API stays
 * the source of truth for whether the ticket key is real; a ticket key
 * this can't parse just means caching is skipped, not a hard failure.
 */
function projectKeyFromTicket(ticketKey) {
  const hyphenIndex = ticketKey.lastIndexOf('-');
  return hyphenIndex > 0 ? ticketKey.slice(0, hyphenIndex) : null;
}

/**
 * Resolves a free-text `--to` query into assignable-user candidates,
 * checking the local cache (3-day TTL, per project+query — ROADMAP 61)
 * before calling the adapter. Read-only: never assigns, never touches
 * cooldown. Exported for direct unit testing, same convention as
 * `resolveTicketAdapter`.
 */
export async function resolveAssigneeCandidates(adapter, ticketKey, query, {
  profileName,
  configDir = DEFAULT_CONFIG_DIR,
  readMetadataCacheFn = readMetadataCache,
  writeMetadataCacheFn = writeMetadataCache,
} = {}) {
  const projectKey = projectKeyFromTicket(ticketKey);
  const cached = readMetadataCacheFn(profileName, configDir);

  if (projectKey) {
    const normalizedQuery = normalizeAssigneeQuery(query);
    const cachedCandidates = cached?.assignableUsersByProject?.[projectKey]?.[normalizedQuery];
    const cachedAt = cached?.assignableUsersFetchedAt?.[projectKey]?.[normalizedQuery];
    if (cachedCandidates && isFresh(cachedAt, SINGLE_PROJECT_TTL_MS)) {
      return cachedCandidates;
    }
  }

  const candidates = await adapter.searchAssignableUsers(ticketKey, query);

  if (projectKey) {
    const { assignableUsersByProject, assignableUsersFetchedAt } = mergeAssignableUsers(cached, projectKey, query, candidates);
    writeMetadataCacheFn(profileName, {
      projects: cached?.projects ?? [],
      issueTypesByProject: cached?.issueTypesByProject ?? {},
      issueTypesFetchedAt: cached?.issueTypesFetchedAt ?? {},
      projectsFetchedAt: cached?.projectsFetchedAt ?? null,
      assignableUsersByProject,
      assignableUsersFetchedAt,
    }, configDir);
  }

  return candidates;
}

/**
 * `--to=me` self-assigns immediately — unchanged fast path, no discovery,
 * no confirm. Any other `--to` resolves a real person first (ROADMAP 61,
 * extended to Server/DC by ROADMAP 65) and only executes when exactly one
 * candidate matches AND --confirm is given, mirroring `transition`'s
 * list-then-confirm shape — notifying a colleague deserves the same
 * reviewed-before-write gate as a workflow-state change.
 *
 * @param {string[]} cmdArgs - [ticketKey, '--to=me'] or [ticketKey, '--to=...', '--confirm']
 * @param {boolean} [cliHints] - see runTicketTransitionList's cliHints doc
 * @returns {Promise<{ ok: boolean }>}
 */
export async function runTicketAssign(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  isLicensedFn = isLicensed,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
  claimActionFn = claimAction,
  releaseActionFn = releaseAction,
  logActionFn = logAction,
  readMetadataCacheFn = readMetadataCache,
  writeMetadataCacheFn = writeMetadataCache,
  actor = os.userInfo().username,
  cliHints = true,
} = {}) {
  const usage = cliHints
    ? 'Usage: ticketlens assign TICKET-KEY --to=me | --to="name or email" --confirm\n'
    : 'Usage: assign requires ticket and to; a to other than "me" also needs confirm: true to execute.\n';
  if (!requireLicense(isLicensedFn, configDir, 'ticketlens assign', stream)) return { ok: false };

  const ticketKey = requireTicketKey(cmdArgs, usage, stream);
  if (!ticketKey) return { ok: false };

  const to = parseFlag(cmdArgs, 'to');
  if (!to) {
    stream.write(usage);
    return { ok: false };
  }

  if (to === 'me') {
    const claim = safeClaim(claimActionFn, ticketKey, 'assign', configDir);
    if (!claim.claimed) {
      stream.write(claim.lockError
        ? `  ${ticketKey} not assigned — could not take the cooldown lock (${claim.lockError}). Nothing was sent; safe to retry.\n`
        : `  Skipped — ${ticketKey} was already assigned ${Math.ceil(claim.remainingMs / 1000)}s ago. Wait a moment before retrying.\n`);
      return { ok: false };
    }

    const resolved = resolveTicketAdapter(ticketKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
    if (!resolved) { safeRelease(releaseActionFn, ticketKey, 'assign', configDir); return { ok: false }; }
    const { adapter } = resolved;

    try {
      const result = await adapter.assignToSelf(ticketKey);
      logActionFn({ ticketKey, action: 'assign', actor, tracker: adapter.type, detail: { assignee: result.assignee } }, { configDir });
      const s = createStyler({ isTTY: stream.isTTY });
      stream.write(`  ${s.green('✔')} ${s.brand(s.bold(ticketKey))} assigned to ${s.bold(result.assignee)}.\n`);
      return { ok: true };
    } catch (err) {
      safeRelease(releaseActionFn, ticketKey, 'assign', configDir);
      stream.write(formatWriteFailure(ticketKey, err));
      return { ok: false };
    }
  }

  const resolved = resolveTicketAdapter(ticketKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!resolved) return { ok: false };
  const { adapter, conn } = resolved;

  if (adapter.type !== 'jira') {
    stream.write(`  Assigning to another developer is Jira-only right now — ${adapter.type} is not supported.\n`);
    return { ok: false };
  }

  const s = createStyler({ isTTY: stream.isTTY });
  let candidates;
  try {
    candidates = await resolveAssigneeCandidates(adapter, ticketKey, to, { profileName: conn.profileName, configDir, readMetadataCacheFn, writeMetadataCacheFn });
  } catch (err) {
    stream.write(formatWriteFailure(ticketKey, err));
    return { ok: false };
  }

  if (candidates.length === 0) {
    stream.write(`  No assignable user found matching "${to}" for ${s.brand(s.bold(ticketKey))}.\n`);
    return { ok: false };
  }

  if (candidates.length > 1) {
    stream.write(`  ${candidates.length} users match "${to}" — narrow the query:\n\n`);
    for (const c of candidates) stream.write(`    ${s.brand('●')} ${c.displayName}  ${s.dim(c.accountId ?? c.name)}\n`);
    return { ok: false };
  }

  const [candidate] = candidates;

  if (!cmdArgs.includes('--confirm')) {
    stream.write(`  Match: ${s.bold(candidate.displayName)}  ${s.dim(candidate.accountId ?? candidate.name)}\n`);
    stream.write(cliHints
      ? `\n  Run again with --to="${to}" --confirm to execute.\n`
      : `\n  Call again with to="${to}" and confirm: true to execute.\n`);
    return { ok: false };
  }

  const claim = safeClaim(claimActionFn, ticketKey, 'assign', configDir);
  if (!claim.claimed) {
    stream.write(claim.lockError
      ? `  ${ticketKey} not assigned — could not take the cooldown lock (${claim.lockError}). Nothing was sent; safe to retry.\n`
      : `  Skipped — ${ticketKey} was already assigned ${Math.ceil(claim.remainingMs / 1000)}s ago. Wait a moment before retrying.\n`);
    return { ok: false };
  }

  try {
    await adapter.assignToUser(ticketKey, candidate);
    logActionFn({ ticketKey, action: 'assign', actor, tracker: adapter.type, detail: { assignee: candidate.displayName, accountId: candidate.accountId, name: candidate.name } }, { configDir });
    stream.write(`  ${s.green('✔')} ${s.brand(s.bold(ticketKey))} assigned to ${s.bold(candidate.displayName)}.\n`);
    return { ok: true };
  } catch (err) {
    safeRelease(releaseActionFn, ticketKey, 'assign', configDir);
    stream.write(formatWriteFailure(ticketKey, err));
    return { ok: false };
  }
}

/**
 * Read-only — no cooldown, no action-log entry. Nothing is mutated, so
 * there's nothing to debounce or audit, unlike comment/transition/assign.
 *
 * @param {string[]} cmdArgs - [ticketKey, ...flags], e.g. ["PROJ-1", '--threshold=0.4']
 * @returns {Promise<{ ok: boolean, results?: Array<{key: string, summary: string, score: number}> }>}
 */
export async function runTicketDuplicates(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  isLicensedFn = isLicensed,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
} = {}) {
  const usage = 'Usage: ticketlens duplicates TICKET-KEY [--threshold=0.35]\n';
  if (!requireLicense(isLicensedFn, configDir, 'ticketlens duplicates', stream)) return { ok: false };

  const ticketKey = requireTicketKey(cmdArgs, usage, stream);
  if (!ticketKey) return { ok: false };

  const thresholdArg = parseFlag(cmdArgs, 'threshold');
  let threshold;
  if (thresholdArg !== undefined) {
    threshold = Number(thresholdArg);
    if (Number.isNaN(threshold) || threshold < 0 || threshold > 1) {
      stream.write(`  --threshold must be a number between 0 and 1 (got "${thresholdArg}").\n`);
      return { ok: false };
    }
  }

  const resolved = resolveTicketAdapter(ticketKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!resolved) return { ok: false };
  const { adapter } = resolved;

  try {
    // depth: 0 — only the shallow linkedIssues list is needed (for explicit
    // Duplicate links, below); the default depth:1 would also recursively
    // fetch full details of every linked ticket just to discard them here.
    const source = await adapter.fetchTicket(ticketKey, { depth: 0 });
    const searchText = [source.summary, source.description].filter(Boolean).join(' ');
    const candidates = await adapter.findCandidates(searchText, ticketKey);
    const scoreOpts = threshold !== undefined ? { threshold } : {};
    const textMatches = scoreCandidates({ key: ticketKey, summary: source.summary, description: source.description }, candidates, scoreOpts);

    // A human already said these are duplicates — always include them,
    // regardless of --threshold, ahead of anything the local scorer finds.
    // Jira doesn't enforce uniqueness of link-type+target pairs, so the same
    // key could appear via two separately-typed "duplicate-ish" links —
    // de-duped against itself here, not just against textMatches below.
    const seenLinkedKeys = new Set();
    const linkedDuplicates = (source.linkedIssues ?? [])
      .filter(l => /duplicate/i.test(l.linkType))
      .filter(l => !seenLinkedKeys.has(l.key) && seenLinkedKeys.add(l.key))
      .map(l => ({ key: l.key, summary: l.summary, linked: true, linkPhrase: l.linkPhrase }));
    const linkedKeys = new Set(linkedDuplicates.map(l => l.key));
    const results = [...linkedDuplicates, ...textMatches.filter(r => !linkedKeys.has(r.key))];

    const s = createStyler({ isTTY: stream.isTTY });
    stream.write(`  ${s.brand(s.bold(ticketKey))}: ${s.bold(source.summary ?? '')}\n\n`);

    if (results.length === 0) {
      stream.write(`  No likely duplicates found (heuristic match only — not a guarantee none exist).\n`);
      return { ok: true, results: [] };
    }
    stream.write(`  Possible duplicates:\n\n`);
    for (const r of results) {
      if (r.linked) {
        stream.write(`    ${s.brand('●')} ${s.bold(r.key)} (${s.green(`Jira-linked — ${r.linkPhrase}`)}) — ${r.summary}\n`);
        continue;
      }
      const pct = Math.round(r.score * 100);
      const pctColor = matchColor(pct, s);
      stream.write(`    ${s.brand('●')} ${s.bold(r.key)} (${pctColor(`${pct}% match`)}) — ${r.summary}\n`);
    }
    return { ok: true, results };
  } catch (err) {
    stream.write(formatDuplicatesFailure(ticketKey, err));
    return { ok: false };
  }
}

/**
 * Discovery only — never mutates. Lists the tracker's current available
 * link types for sourceKey→targetKey. Jira's list is always fetched live
 * (per-instance customizable — never cached, same principle as
 * getTransitions). GitHub's "list" is really a single-item warning: its
 * only link action closes sourceKey as a duplicate of targetKey, a
 * materially louder operation than Jira/Linear's pure relationship-add,
 * so that asymmetry is surfaced here before a caller ever reaches --confirm.
 *
 * @param {string[]} cmdArgs - [sourceKey, targetKey]
 * @param {boolean} [cliHints] - see runTicketTransitionList's cliHints doc
 * @returns {Promise<{ ok: boolean, types?: (string|{name: string, inward: string, outward: string})[] }>}
 */
export async function runTicketLinkList(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  isLicensedFn = isLicensed,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
  cliHints = true,
} = {}) {
  const usage = 'Usage: ticketlens link SOURCE-KEY TARGET-KEY [--type="..." --confirm]\n';
  if (!requireLicense(isLicensedFn, configDir, 'ticketlens link', stream)) return { ok: false };

  const sourceKey = requireTicketKey(cmdArgs, usage, stream);
  if (!sourceKey) return { ok: false };
  const targetKey = requireTicketKey(cmdArgs.slice(1), usage, stream);
  if (!targetKey) return { ok: false };

  const resolved = resolveTicketAdapter(sourceKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!resolved) return { ok: false };
  const { adapter } = resolved;

  try {
    const types = await adapter.getLinkTypes();
    const s = createStyler({ isTTY: stream.isTTY });
    if (types.length === 0) {
      stream.write(`  No link types available for ${s.brand(s.bold(sourceKey))} → ${s.brand(s.bold(targetKey))} on ${adapter.type}.\n`);
      return { ok: true, types: [] };
    }
    stream.write(`  Available link types for ${s.brand(s.bold(sourceKey))} → ${s.brand(s.bold(targetKey))} (${adapter.type}):\n\n`);
    for (const t of types) {
      // Backlog #31: a bare type name (e.g. "Blocks") hides which end gets
      // which phrase — show the real resulting sentence so the caller
      // doesn't have to guess direction. GitHub/Linear still hand back
      // plain strings (no inward/outward phrase pair to show).
      const line = typeof t === 'string' ? t : `${t.name} — ${sourceKey} ${t.outward ?? t.name} ${targetKey}`;
      stream.write(`    ${s.brand('●')} ${line}\n`);
    }
    stream.write('\n');
    if (adapter.type === 'github') {
      stream.write(`  Note: GitHub has no generic link relationship — linking will CLOSE ${sourceKey} as a duplicate of ${targetKey}.\n`);
    }
    stream.write(cliHints
      ? `  Run again with --type="<name>" --confirm to execute — ${sourceKey} will be recorded as the one that "types" ${targetKey}.\n`
      : `  Call again with type="<name>" and confirm: true to execute — ${sourceKey} will be recorded as the one that "types" ${targetKey}.\n`);
    return { ok: true, types };
  } catch (err) {
    stream.write(formatLinkListFailure(sourceKey, err));
    return { ok: false };
  }
}

/**
 * Executes a link. Requires both --type and --confirm — a type without
 * confirm is incomplete input, never silently executed. Cooldown is keyed
 * on the source:target pair (not sourceKey alone) so a second link to a
 * different target isn't blocked by the debounce window; the audit log
 * keeps ticketKey as the single valid sourceKey (logAction throws on
 * anything else) with targetKey/type carried in detail instead.
 *
 * @param {string[]} cmdArgs - [sourceKey, targetKey, '--type=...', '--confirm']
 * @param {boolean} [cliHints] - see runTicketTransitionList's cliHints doc
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function runTicketLink(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  isLicensedFn = isLicensed,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
  claimActionFn = claimAction,
  releaseActionFn = releaseAction,
  logActionFn = logAction,
  actor = os.userInfo().username,
  cliHints = true,
} = {}) {
  const usage = 'Usage: ticketlens link SOURCE-KEY TARGET-KEY --type="..." --confirm\n';
  if (!requireLicense(isLicensedFn, configDir, 'ticketlens link', stream)) return { ok: false };

  const sourceKey = requireTicketKey(cmdArgs, usage, stream);
  if (!sourceKey) return { ok: false };
  const targetKey = requireTicketKey(cmdArgs.slice(1), usage, stream);
  if (!targetKey) return { ok: false };

  const type = parseFlag(cmdArgs, 'type');
  if (!type) {
    stream.write(usage);
    return { ok: false };
  }
  if (!cmdArgs.includes('--confirm')) {
    stream.write(cliHints
      ? `  Refusing to link ${sourceKey} to ${targetKey} as "${type}" without --confirm. Re-run with --confirm once you've reviewed the target.\n`
      : `  Refusing to link ${sourceKey} to ${targetKey} as "${type}" without confirm: true. Call again with confirm: true once you've reviewed the target.\n`);
    return { ok: false };
  }

  const cooldownKey = `${sourceKey}:${targetKey}`;
  const claim = safeClaim(claimActionFn, cooldownKey, 'link', configDir);
  if (!claim.claimed) {
    stream.write(claim.lockError
      ? `  ${sourceKey} not linked — could not take the cooldown lock (${claim.lockError}). Nothing was sent; safe to retry.\n`
      : `  Skipped — ${sourceKey} was already linked to ${targetKey} ${Math.ceil(claim.remainingMs / 1000)}s ago. Wait a moment before retrying.\n`);
    return { ok: false };
  }

  const resolved = resolveTicketAdapter(sourceKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!resolved) { safeRelease(releaseActionFn, cooldownKey, 'link', configDir); return { ok: false }; }
  const { adapter } = resolved;

  if (adapter.type === 'github' && type.toLowerCase() !== 'duplicate') {
    safeRelease(releaseActionFn, cooldownKey, 'link', configDir);
    stream.write(`  GitHub only supports linking as a duplicate — no generic link types. Got type "${type}".\n`);
    return { ok: false };
  }
  if (adapter.type === 'github') {
    stream.write(`  Note: this will CLOSE ${sourceKey} as a duplicate of ${targetKey} on GitHub.\n`);
  }

  try {
    const result = await adapter.linkTo(sourceKey, targetKey, type);
    if (!result.executed) {
      safeRelease(releaseActionFn, cooldownKey, 'link', configDir);
      const optionsHint = result.options?.length ? ` Valid options: ${result.options.join(', ')}.` : '';
      stream.write(`  Not linked — ${result.reason}.${optionsHint}\n`);
      return { ok: false, reason: result.reason };
    }
    logActionFn({ ticketKey: sourceKey, action: 'link', actor, tracker: adapter.type, detail: { targetKey, type } }, { configDir });
    const s = createStyler({ isTTY: stream.isTTY });
    stream.write(
      adapter.type === 'github'
        ? `  ${s.green('✔')} ${s.brand(s.bold(sourceKey))} closed as a duplicate of ${s.brand(s.bold(targetKey))}.\n`
        : `  ${s.green('✔')} ${s.brand(s.bold(sourceKey))} linked to ${s.brand(s.bold(targetKey))} as ${s.bold(`"${type}"`)}.\n`,
    );
    return { ok: true };
  } catch (err) {
    safeRelease(releaseActionFn, cooldownKey, 'link', configDir);
    stream.write(formatWriteFailure(sourceKey, err));
    return { ok: false };
  }
}

/**
 * Updates a narrow, named field set (title, description, labels, priority).
 * No --confirm gate, unlike transition/link: those two have a list-then-act
 * discovery step that --confirm gates the boundary of; update has none
 * (priority validity surfaces the tracker's own error, same choice already
 * made for ticket_create's issuetype) and its edits are reversible metadata
 * changes with no workflow-state side effects — same risk tier as assign,
 * which also ships with no --confirm.
 *
 * updateFields' result shape genuinely differs by how atomic each tracker's
 * write is: Jira/Linear do it in one call and either fully succeed or throw
 * (caught below, same as every other write); GitHub's title/description and
 * label operations are independent HTTP calls, so it always returns
 * { applied, errors } even on total failure. Whatever DID apply is still
 * recorded/logged — a caller needs the cooldown to reflect a real partial
 * write, and the audit trail should show what actually changed even if not
 * everything did.
 *
 * @param {string[]} cmdArgs - [ticketKey, '--title=...', '--description=...', '--add-labels=a,b', '--remove-labels=c', '--priority=...']
 * @returns {Promise<{ ok: boolean, applied?: object, errors?: object }>}
 */
export async function runTicketUpdate(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  isLicensedFn = isLicensed,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
  claimActionFn = claimAction,
  releaseActionFn = releaseAction,
  logActionFn = logAction,
  readMetadataCacheFn = readMetadataCache,
  writeMetadataCacheFn = writeMetadataCache,
  actor = os.userInfo().username,
} = {}) {
  const usage = 'Usage: ticketlens update TICKET-KEY [--title="..."] [--description="..."] [--add-labels=a,b] [--remove-labels=c] [--priority="High"]\n';
  if (!requireLicense(isLicensedFn, configDir, 'ticketlens update', stream)) return { ok: false };

  const ticketKey = requireTicketKey(cmdArgs, usage, stream);
  if (!ticketKey) return { ok: false };

  const title = parseFlag(cmdArgs, 'title');
  const description = parseFlag(cmdArgs, 'description');
  const priority = parseFlag(cmdArgs, 'priority');
  const addLabelsArg = parseFlag(cmdArgs, 'add-labels');
  const removeLabelsArg = parseFlag(cmdArgs, 'remove-labels');
  const addLabels = addLabelsArg ? addLabelsArg.split(',').map(l => l.trim()).filter(Boolean) : undefined;
  const removeLabels = removeLabelsArg ? removeLabelsArg.split(',').map(l => l.trim()).filter(Boolean) : undefined;

  if (title === undefined && description === undefined && priority === undefined && !addLabels?.length && !removeLabels?.length) {
    stream.write(usage);
    return { ok: false };
  }

  const claim = safeClaim(claimActionFn, ticketKey, 'update', configDir);
  if (!claim.claimed) {
    stream.write(claim.lockError
      ? `  ${ticketKey} not updated — could not take the cooldown lock (${claim.lockError}). Nothing was sent; safe to retry.\n`
      : `  Skipped — ${ticketKey} was already updated ${Math.ceil(claim.remainingMs / 1000)}s ago. Wait a moment before retrying.\n`);
    return { ok: false };
  }

  const resolved = resolveTicketAdapter(ticketKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!resolved) { safeRelease(releaseActionFn, ticketKey, 'update', configDir); return { ok: false }; }
  const { adapter, conn } = resolved;

  if (adapter.type === 'github' && priority !== undefined) {
    safeRelease(releaseActionFn, ticketKey, 'update', configDir);
    stream.write(`  GitHub Issues have no native priority field — cannot update priority on ${ticketKey}. Remove --priority and retry.\n`);
    return { ok: false };
  }

  try {
    const result = await adapter.updateFields(ticketKey, { title, description, priority, addLabels, removeLabels }, { readMetadataCacheFn, writeMetadataCacheFn, profileName: conn.profileName, configDir });
    const hasApplied = Object.keys(result.applied).length > 0;
    const hasErrors = Object.keys(result.errors).length > 0;

    if (hasApplied) {
      logActionFn({ ticketKey, action: 'update', actor, tracker: adapter.type, detail: { ...result.applied, failed: Object.keys(result.errors) } }, { configDir });
    } else {
      // Nothing landed — release so a caller fixing the failed field(s) can
      // retry immediately, same "release on definite failure" rule as every
      // other write in this family. A partial success (hasApplied &&
      // hasErrors) deliberately keeps the claim armed, unchanged from the
      // old recordActionFn-only-when-hasApplied behavior.
      safeRelease(releaseActionFn, ticketKey, 'update', configDir);
    }
    stream.write(formatUpdateResult(ticketKey, result, createStyler({ isTTY: stream.isTTY })));
    return hasErrors ? { ok: false, applied: result.applied, errors: result.errors } : { ok: true, applied: result.applied };
  } catch (err) {
    safeRelease(releaseActionFn, ticketKey, 'update', configDir);
    const enrichment = await enrichUpdateFailure(err, { adapter, projectKey: projectKeyFromTicket(ticketKey), profileName: conn.profileName, configDir, readMetadataCacheFn, writeMetadataCacheFn });
    stream.write(formatWriteFailure(ticketKey, err) + enrichment);
    return { ok: false };
  }
}

/**
 * Creates a new ticket in the tracker (Jira/GitHub/Linear) — architecturally
 * unlike every other write in this family: there is no existing ticket key
 * to resolve a connection from, so --profile (or the default profile) picks
 * the target tracker instead of ticket-prefix matching. --project is the
 * project key (Jira) or team key (Linear) to create in — GitHub ignores it,
 * its target repo is fixed by the profile. --type (Jira issuetype) is
 * Jira-only; GitHub/Linear have no equivalent concept and ignore it with a
 * warning — unlike an extra --project on GitHub, which is dropped silently,
 * since a stray --type usually means the caller thought they were talking to
 * Jira and should hear otherwise. Highest blast radius of the whole write
 * family — a bad project/issuetype fabricates a real,
 * hard-to-walk-back item in a live tracker — so, unlike update/assign, the
 * cooldown key is derived from (project, type, summary) rather than a
 * ticket key, guarding against exactly the flaky-retry double-creation
 * scenario this whole mechanism exists to catch. No --confirm gate: same
 * "no discovery step, reversible-enough risk tier" reasoning already
 * applied to update/assign — the terminal errors below (missing --project/
 * --type, an unresolvable Linear team, a bad Jira issuetype) are the
 * safeguard, not a confirmation prompt.
 *
 * @param {string[]} cmdArgs - ['--project=...', '--type=...', '--summary=...', '--description=...', '--profile=...']
 * @returns {Promise<{ ok: boolean, key?: string }>}
 */
export async function runTicketCreate(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  isLicensedFn = isLicensed,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
  claimActionFn = claimAction,
  releaseActionFn = releaseAction,
  logActionFn = logAction,
  readMetadataCacheFn = readMetadataCache,
  writeMetadataCacheFn = writeMetadataCache,
  findProfilesByPrefixFn = findProfilesByPrefix,
  actor = os.userInfo().username,
} = {}) {
  const usage = 'Usage: ticketlens create --project=KEY --type="Task" --summary="..." [--description="..."] [--profile=NAME]\n';
  if (!requireLicense(isLicensedFn, configDir, 'ticketlens create', stream)) return { ok: false };

  const summary = parseFlag(cmdArgs, 'summary');
  if (!summary) {
    stream.write(usage);
    return { ok: false };
  }

  const project = parseFlag(cmdArgs, 'project');
  const type = parseFlag(cmdArgs, 'type');
  const description = parseFlag(cmdArgs, 'description');
  const attachPaths = parseAttachPaths(cmdArgs);

  const resolved = resolveTicketAdapter(undefined, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!resolved) return { ok: false };
  const { adapter, conn } = resolved;
  const s = createStyler({ isTTY: stream.isTTY });
  const attachRefused = refuseGithubAttachments(adapter, attachPaths, stream);

  if (adapter.type !== 'github' && !project) {
    stream.write(`  --project is required for ${adapter.type === 'jira' ? 'Jira (project key)' : 'Linear (team key)'}.\n`);
    return { ok: false };
  }
  if (adapter.type === 'jira' && !type) {
    stream.write(`  --type is required for Jira (issue type, e.g. "Task" or "Bug").\n`);
    return { ok: false };
  }
  if (adapter.type !== 'jira' && type !== undefined) {
    stream.write(`  Note: --type is ignored by ${adapter.type} — issue created without it.\n`);
  }

  // Highest-blast-radius write in the family: no ticket key exists yet to
  // prefix-match against, so a resolution that quietly lands on the wrong
  // profile (e.g. an unconfigured cwd falling to the default) fabricates a
  // real ticket on the wrong tracker before anyone notices. Only refuses
  // when a DIFFERENT profile is a known, better owner of this exact project
  // key — a genuinely new, not-yet-registered project proceeds untouched.
  // Skipped when the caller explicitly passed --profile=NAME: that is
  // deliberate, informed intent (the same trust resolveProfile() itself
  // already gives an explicit flag over every other signal), and this guard
  // must never be a dead end with no way to force a legitimate create through.
  if (adapter.type !== 'github' && project && conn.profileName && !parseFlag(cmdArgs, 'profile')) {
    const owningProfiles = findProfilesByPrefixFn(project, configDir);
    if (owningProfiles.length > 0 && !owningProfiles.includes(conn.profileName)) {
      stream.write(
        `  Project "${project}" is registered under profile "${owningProfiles[0]}", not the resolved profile ` +
        `"${conn.profileName}". Pass --profile=${owningProfiles[0]} to target the right tracker, or ` +
        `--profile=${conn.profileName} to confirm this is intentional.\n`,
      );
      return { ok: false };
    }
  }

  // JSON-encoded, not naively colon-joined — project/type/summary are free
  // text that can themselves contain ":", which would let two genuinely
  // different tuples collide onto the same cooldown key.
  const cooldownKey = `create:${JSON.stringify([project ?? '', type ?? '', summary])}`;
  const claim = safeClaim(claimActionFn, cooldownKey, 'create', configDir);
  if (!claim.claimed) {
    stream.write(claim.lockError
      ? `  Nothing was created — could not take the cooldown lock (${claim.lockError}). Safe to retry.\n`
      : `  Skipped — a ticket with this summary was already created ${Math.ceil(claim.remainingMs / 1000)}s ago. Wait a moment before retrying.\n`);
    return { ok: false };
  }

  let result;
  try {
    result = await adapter.createTicket({ project, type, summary, description });
  } catch (err) {
    // Definite failure — no ticket was created, so the claim is released to
    // let a corrected retry through immediately (Backlog #34/ROADMAP 57).
    safeRelease(releaseActionFn, cooldownKey, 'create', configDir);
    // profileName is only resolved when this failure is actually
    // project/issuetype-shaped — not on every failure, and never on the
    // success path — since it exists solely to scope the enrichment cache.
    let enrichment = '';
    if (detectProjectOrTypeError(err)) {
      const profileName = resolveConnectionFn(undefined, { configDir, profileName: parseFlag(cmdArgs, 'profile') }).profileName;
      enrichment = await enrichCreateFailure(err, { adapter, project, profileName, configDir, readMetadataCacheFn, writeMetadataCacheFn });
    }
    stream.write(formatCreateFailure(err) + enrichment);
    return { ok: false };
  }

  // The write already landed — a real, external, hard-to-walk-back ticket
  // now exists. From here on, nothing may report this as a failed write.
  // The cooldown claim was already recorded atomically at claim time above
  // (no separate recordActionFn call needed here); only the audit log is
  // best-effort — a logging failure must never make a real success look
  // like a failure (which risks a caller retrying and fabricating a
  // genuine duplicate).
  try {
    logActionFn({ ticketKey: result.key, action: 'create', actor, tracker: adapter.type, detail: { project, type } }, { configDir });
  } catch (bookkeepingErr) {
    stream.write(`  Warning: ${result.key} was created but could not be logged: ${bookkeepingErr.message}\n`);
  }

  // Attachments upload AFTER creation — Jira/Linear both need a real issue
  // key to attach to (Jira strictly; Linear's fileUpload doesn't, but the
  // same ordering is kept uniform across trackers for simplicity). The
  // ticket has already landed, so nothing in this block may ever cause
  // runTicketCreate to report the create itself as failed — wrapped in its
  // own try/catch, mirroring the bookkeeping block above.
  let attachResult = null;
  if (attachPaths.length && !attachRefused) {
    try {
      attachResult = await adapter.attachFiles(result.key, attachPaths);

      // Linear has no separate attachment list on an issue — unlike Jira's
      // classic attachment (real regardless of description text), an
      // uploaded Linear asset is only ever associated with the issue by
      // referencing its URL in a text field. Without this follow-up edit,
      // the file would be uploaded to Linear's storage but completely
      // orphaned from the ticket. Best-effort: if this edit fails, the
      // asset is still genuinely uploaded, just not linked — reported as
      // an error entry, not a lost/misreported create.
      const inlineSnippets = attachResult.uploaded.filter(a => a.inlineMarkup).map(a => a.inlineMarkup).join('\n\n');
      if (inlineSnippets && adapter.type === 'linear') {
        try {
          await adapter.updateFields(result.key, { description: description ? `${description}\n\n${inlineSnippets}` : inlineSnippets });
        } catch (linkErr) {
          attachResult = { ...attachResult, errors: [...attachResult.errors, { path: '(description update)', message: `uploaded but failed to link into the ticket description: ${linkErr.message}` }] };
        }
      }

      try {
        logActionFn({ ticketKey: result.key, action: 'create', actor, tracker: adapter.type, detail: { attachPaths, attachedFilenames: attachResult.uploaded.map(a => a.filename) } }, { configDir });
      } catch { /* best-effort, same as the primary bookkeeping above */ }
    } catch (attachErr) {
      stream.write(`  Warning: ${result.key} was created but attaching files failed: ${attachErr.message}\n`);
      attachResult = null;
    }
  }

  stream.write(`  ${s.green('✔')} Created ${s.brand(s.bold(result.key))}${result.url ? ` (${result.url})` : ''}\n` + formatAttachSummary(attachResult, s));
  return { ok: true, key: result.key };
}
