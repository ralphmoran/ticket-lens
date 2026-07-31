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
import { resolveConnection } from './profile-resolver.mjs';
import { resolveAdapter } from './resolve-adapter.mjs';
import { checkCooldown, recordAction } from './ticket-action-cooldown.mjs';
import { logAction } from './ticket-action-log.mjs';
import { TICKET_KEY_PATTERN } from './cli.mjs';
import { scoreCandidates } from './duplicate-scorer.mjs';

function parseFlag(cmdArgs, name) {
  return cmdArgs.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
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

function formatWriteFailure(ticketKey, err) {
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

function formatUpdateResult(ticketKey, { applied, errors }) {
  const appliedText = describeAppliedFields(applied);
  const errorText = Object.entries(errors).map(([field, info]) => formatFieldError(field, info)).join('; ');
  if (appliedText && !errorText) return `  ${ticketKey} updated: ${appliedText}.\n`;
  if (appliedText && errorText) return `  ${ticketKey} partially updated: ${appliedText}. Failed: ${errorText}.\n`;
  return `  Nothing updated on ${ticketKey}. Failed: ${errorText}.\n`;
}

function requireLicense(isLicensedFn, configDir, commandName, stream) {
  if (isLicensedFn('pro', configDir)) return true;
  showUpgradePrompt('pro', commandName, { stream });
  return false;
}

function requireTicketKey(cmdArgs, usage, stream) {
  const ticketKey = cmdArgs[0];
  if (!ticketKey || ticketKey.startsWith('--') || !TICKET_KEY_PATTERN.test(ticketKey)) {
    stream.write(usage);
    return null;
  }
  return ticketKey;
}

/**
 * `ticketKey` is undefined for ticket_create — there is no existing ticket to
 * prefix-match a connection from, so resolution falls through to --profile
 * or the default profile (resolveConnectionFn already handles a falsy
 * ticketKey by skipping prefix matching, see profile-resolver.mjs).
 */
function resolveTicketAdapter(ticketKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream }) {
  const profileName = parseFlag(cmdArgs, 'profile');
  const conn = resolveConnectionFn(ticketKey, { configDir, profileName });
  if (!conn.baseUrl) {
    stream.write(ticketKey
      ? `  No connection configured for ${ticketKey}. Run \`ticketlens init\`.\n`
      : `  No connection configured. Run \`ticketlens init\` or pass --profile=NAME.\n`);
    return null;
  }
  return resolveAdapterFn(conn);
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
  checkCooldownFn = checkCooldown,
  recordActionFn = recordAction,
  logActionFn = logAction,
  actor = os.userInfo().username,
} = {}) {
  const usage = 'Usage: ticketlens comment TICKET-KEY --body="..."\n';
  if (!requireLicense(isLicensedFn, configDir, 'ticketlens comment', stream)) return { ok: false };

  const ticketKey = requireTicketKey(cmdArgs, usage, stream);
  if (!ticketKey) return { ok: false };

  const body = parseFlag(cmdArgs, 'body');
  if (!body) {
    stream.write(usage);
    return { ok: false };
  }

  const cooldown = checkCooldownFn(ticketKey, 'comment', { configDir });
  if (cooldown.active) {
    stream.write(`  Skipped — a comment was already posted to ${ticketKey} ${Math.ceil(cooldown.remainingMs / 1000)}s ago. Wait a moment before retrying.\n`);
    return { ok: false };
  }

  const adapter = resolveTicketAdapter(ticketKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!adapter) return { ok: false };

  try {
    const result = await adapter.addComment(ticketKey, body);
    recordActionFn(ticketKey, 'comment', { configDir });
    logActionFn({ ticketKey, action: 'comment', actor, tracker: adapter.type, detail: { id: result.id } }, { configDir });
    stream.write(`  Comment posted to ${ticketKey}${result.url ? ` (${result.url})` : ''}\n`);
    return { ok: true };
  } catch (err) {
    stream.write(formatWriteFailure(ticketKey, err));
    return { ok: false };
  }
}

/**
 * Discovery only — never mutates. Lists the tracker's current valid
 * transition options for the ticket.
 *
 * @param {string[]} cmdArgs - [ticketKey]
 * @returns {Promise<{ ok: boolean, options?: object[] }>}
 */
export async function runTicketTransitionList(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  isLicensedFn = isLicensed,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
} = {}) {
  const usage = 'Usage: ticketlens transition TICKET-KEY [--target="..." --confirm]\n';
  if (!requireLicense(isLicensedFn, configDir, 'ticketlens transition', stream)) return { ok: false };

  const ticketKey = requireTicketKey(cmdArgs, usage, stream);
  if (!ticketKey) return { ok: false };

  const adapter = resolveTicketAdapter(ticketKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!adapter) return { ok: false };

  try {
    const options = await adapter.getTransitions(ticketKey);
    if (options.length === 0) {
      stream.write(`  No valid transitions available for ${ticketKey}.\n`);
      return { ok: true, options: [] };
    }
    stream.write(`  Valid transitions for ${ticketKey}:\n`);
    for (const o of options) stream.write(`    - ${o.name}\n`);
    stream.write(`  Run again with --target="<name>" --confirm to execute.\n`);
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
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function runTicketTransition(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  isLicensedFn = isLicensed,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
  checkCooldownFn = checkCooldown,
  recordActionFn = recordAction,
  logActionFn = logAction,
  actor = os.userInfo().username,
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
    stream.write(`  Refusing to transition ${ticketKey} to "${target}" without --confirm. Re-run with --confirm once you've reviewed the target.\n`);
    return { ok: false };
  }

  const cooldown = checkCooldownFn(ticketKey, 'transition', { configDir });
  if (cooldown.active) {
    stream.write(`  Skipped — ${ticketKey} was already transitioned ${Math.ceil(cooldown.remainingMs / 1000)}s ago. Wait a moment before retrying.\n`);
    return { ok: false };
  }

  const adapter = resolveTicketAdapter(ticketKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!adapter) return { ok: false };

  try {
    const result = await adapter.transition(ticketKey, target);
    if (!result.executed) {
      const optionsHint = result.options?.length ? ` Valid options: ${result.options.map(o => o.name).join(', ')}.` : '';
      stream.write(`  Not transitioned — ${result.reason}.${optionsHint}\n`);
      return { ok: false, reason: result.reason };
    }
    recordActionFn(ticketKey, 'transition', { configDir });
    logActionFn({ ticketKey, action: 'transition', actor, tracker: adapter.type, detail: { to: result.to } }, { configDir });
    stream.write(`  ${ticketKey} transitioned to "${result.to}".\n`);
    return { ok: true };
  } catch (err) {
    stream.write(formatWriteFailure(ticketKey, err));
    return { ok: false };
  }
}

/**
 * Self-assign only — `--to` currently only accepts the literal "me".
 * Arbitrary-user assignment needs a per-tracker user-search step this
 * codebase doesn't have yet; kept as an explicit, rejected value now so
 * a future `--to=someone@else.com` doesn't silently redefine what a
 * bare/missing --to means today.
 *
 * @param {string[]} cmdArgs - [ticketKey, '--to=me']
 * @returns {Promise<{ ok: boolean }>}
 */
export async function runTicketAssign(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  isLicensedFn = isLicensed,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
  checkCooldownFn = checkCooldown,
  recordActionFn = recordAction,
  logActionFn = logAction,
  actor = os.userInfo().username,
} = {}) {
  const usage = 'Usage: ticketlens assign TICKET-KEY --to=me\n';
  if (!requireLicense(isLicensedFn, configDir, 'ticketlens assign', stream)) return { ok: false };

  const ticketKey = requireTicketKey(cmdArgs, usage, stream);
  if (!ticketKey) return { ok: false };

  const to = parseFlag(cmdArgs, 'to');
  if (to !== 'me') {
    stream.write(to ? `  --to="${to}" is not yet supported — only --to=me (self-assign) is available.\n` : usage);
    return { ok: false };
  }

  const cooldown = checkCooldownFn(ticketKey, 'assign', { configDir });
  if (cooldown.active) {
    stream.write(`  Skipped — ${ticketKey} was already assigned ${Math.ceil(cooldown.remainingMs / 1000)}s ago. Wait a moment before retrying.\n`);
    return { ok: false };
  }

  const adapter = resolveTicketAdapter(ticketKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!adapter) return { ok: false };

  try {
    const result = await adapter.assignToSelf(ticketKey);
    recordActionFn(ticketKey, 'assign', { configDir });
    logActionFn({ ticketKey, action: 'assign', actor, tracker: adapter.type, detail: { assignee: result.assignee } }, { configDir });
    stream.write(`  ${ticketKey} assigned to ${result.assignee}.\n`);
    return { ok: true };
  } catch (err) {
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

  const adapter = resolveTicketAdapter(ticketKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!adapter) return { ok: false };

  try {
    const source = await adapter.fetchTicket(ticketKey);
    const searchText = [source.summary, source.description].filter(Boolean).join(' ');
    const candidates = await adapter.findCandidates(searchText, ticketKey);
    const scoreOpts = threshold !== undefined ? { threshold } : {};
    const results = scoreCandidates({ key: ticketKey, summary: source.summary, description: source.description }, candidates, scoreOpts);

    if (results.length === 0) {
      stream.write(`  No likely duplicates found for ${ticketKey}.\n`);
      return { ok: true, results: [] };
    }
    stream.write(`  Possible duplicates of ${ticketKey}:\n`);
    for (const r of results) {
      stream.write(`    ${r.key} (${Math.round(r.score * 100)}% match) — ${r.summary}\n`);
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
 * @returns {Promise<{ ok: boolean, types?: string[] }>}
 */
export async function runTicketLinkList(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  isLicensedFn = isLicensed,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
} = {}) {
  const usage = 'Usage: ticketlens link SOURCE-KEY TARGET-KEY [--type="..." --confirm]\n';
  if (!requireLicense(isLicensedFn, configDir, 'ticketlens link', stream)) return { ok: false };

  const sourceKey = requireTicketKey(cmdArgs, usage, stream);
  if (!sourceKey) return { ok: false };
  const targetKey = requireTicketKey(cmdArgs.slice(1), usage, stream);
  if (!targetKey) return { ok: false };

  const adapter = resolveTicketAdapter(sourceKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!adapter) return { ok: false };

  try {
    const types = await adapter.getLinkTypes();
    if (types.length === 0) {
      stream.write(`  No link types available for ${sourceKey} → ${targetKey} on ${adapter.type}.\n`);
      return { ok: true, types: [] };
    }
    stream.write(`  Available link types for ${sourceKey} → ${targetKey} (${adapter.type}):\n`);
    for (const t of types) stream.write(`    - ${t}\n`);
    if (adapter.type === 'github') {
      stream.write(`  Note: GitHub has no generic link relationship — linking will CLOSE ${sourceKey} as a duplicate of ${targetKey}.\n`);
    }
    stream.write(`  Run again with --type="<name>" --confirm to execute — ${sourceKey} will be recorded as the one that "types" ${targetKey}.\n`);
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
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function runTicketLink(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  isLicensedFn = isLicensed,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
  checkCooldownFn = checkCooldown,
  recordActionFn = recordAction,
  logActionFn = logAction,
  actor = os.userInfo().username,
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
    stream.write(`  Refusing to link ${sourceKey} to ${targetKey} as "${type}" without --confirm. Re-run with --confirm once you've reviewed the target.\n`);
    return { ok: false };
  }

  const cooldownKey = `${sourceKey}:${targetKey}`;
  const cooldown = checkCooldownFn(cooldownKey, 'link', { configDir });
  if (cooldown.active) {
    stream.write(`  Skipped — ${sourceKey} was already linked to ${targetKey} ${Math.ceil(cooldown.remainingMs / 1000)}s ago. Wait a moment before retrying.\n`);
    return { ok: false };
  }

  const adapter = resolveTicketAdapter(sourceKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!adapter) return { ok: false };

  if (adapter.type === 'github' && type.toLowerCase() !== 'duplicate') {
    stream.write(`  GitHub only supports linking as a duplicate — no generic link types. Got type "${type}".\n`);
    return { ok: false };
  }
  if (adapter.type === 'github') {
    stream.write(`  Note: this will CLOSE ${sourceKey} as a duplicate of ${targetKey} on GitHub.\n`);
  }

  try {
    const result = await adapter.linkTo(sourceKey, targetKey, type);
    if (!result.executed) {
      const optionsHint = result.options?.length ? ` Valid options: ${result.options.join(', ')}.` : '';
      stream.write(`  Not linked — ${result.reason}.${optionsHint}\n`);
      return { ok: false, reason: result.reason };
    }
    recordActionFn(cooldownKey, 'link', { configDir });
    logActionFn({ ticketKey: sourceKey, action: 'link', actor, tracker: adapter.type, detail: { targetKey, type } }, { configDir });
    stream.write(
      adapter.type === 'github'
        ? `  ${sourceKey} closed as a duplicate of ${targetKey}.\n`
        : `  ${sourceKey} linked to ${targetKey} as "${type}".\n`,
    );
    return { ok: true };
  } catch (err) {
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
  checkCooldownFn = checkCooldown,
  recordActionFn = recordAction,
  logActionFn = logAction,
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

  const cooldown = checkCooldownFn(ticketKey, 'update', { configDir });
  if (cooldown.active) {
    stream.write(`  Skipped — ${ticketKey} was already updated ${Math.ceil(cooldown.remainingMs / 1000)}s ago. Wait a moment before retrying.\n`);
    return { ok: false };
  }

  const adapter = resolveTicketAdapter(ticketKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!adapter) return { ok: false };

  if (adapter.type === 'github' && priority !== undefined) {
    stream.write(`  GitHub Issues have no native priority field — cannot update priority on ${ticketKey}. Remove --priority and retry.\n`);
    return { ok: false };
  }

  try {
    const result = await adapter.updateFields(ticketKey, { title, description, priority, addLabels, removeLabels });
    const hasApplied = Object.keys(result.applied).length > 0;
    const hasErrors = Object.keys(result.errors).length > 0;

    if (hasApplied) {
      recordActionFn(ticketKey, 'update', { configDir });
      logActionFn({ ticketKey, action: 'update', actor, tracker: adapter.type, detail: { ...result.applied, failed: Object.keys(result.errors) } }, { configDir });
    }
    stream.write(formatUpdateResult(ticketKey, result));
    return hasErrors ? { ok: false, applied: result.applied, errors: result.errors } : { ok: true, applied: result.applied };
  } catch (err) {
    stream.write(formatWriteFailure(ticketKey, err));
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
  checkCooldownFn = checkCooldown,
  recordActionFn = recordAction,
  logActionFn = logAction,
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

  const adapter = resolveTicketAdapter(undefined, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!adapter) return { ok: false };

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

  // JSON-encoded, not naively colon-joined — project/type/summary are free
  // text that can themselves contain ":", which would let two genuinely
  // different tuples collide onto the same cooldown key.
  const cooldownKey = `create:${JSON.stringify([project ?? '', type ?? '', summary])}`;
  const cooldown = checkCooldownFn(cooldownKey, 'create', { configDir });
  if (cooldown.active) {
    stream.write(`  Skipped — a ticket with this summary was already created ${Math.ceil(cooldown.remainingMs / 1000)}s ago. Wait a moment before retrying.\n`);
    return { ok: false };
  }

  let result;
  try {
    result = await adapter.createTicket({ project, type, summary, description });
  } catch (err) {
    stream.write(formatCreateFailure(err));
    return { ok: false };
  }

  // The write already landed — a real, external, hard-to-walk-back ticket
  // now exists. From here on, nothing may report this as a failed write:
  // cooldown/audit bookkeeping is best-effort, never the reason a real
  // success gets mistaken for one (which risks a caller retrying and
  // fabricating a genuine duplicate).
  try {
    recordActionFn(cooldownKey, 'create', { configDir });
    logActionFn({ ticketKey: result.key, action: 'create', actor, tracker: adapter.type, detail: { project, type } }, { configDir });
  } catch (bookkeepingErr) {
    stream.write(`  Warning: ${result.key} was created but could not be logged: ${bookkeepingErr.message}\n`);
  }
  stream.write(`  Created ${result.key}${result.url ? ` (${result.url})` : ''}\n`);
  return { ok: true, key: result.key };
}
