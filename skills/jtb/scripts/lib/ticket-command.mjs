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
 * since "duplicates" never writes anything.
 */
function formatDuplicatesFailure(ticketKey, err) {
  const classification = classifyWriteFailure(err);
  switch (classification.kind) {
    case 'rate-limited': {
      const wait = classification.detail.retryAfterSeconds ?? null;
      return wait
        ? `  Rate limited by the tracker — retry checking ${ticketKey} after ~${wait}s.\n`
        : `  Rate limited by the tracker — try checking ${ticketKey} again later.\n`;
    }
    case 'network-or-timeout':
      return `  Network error or timeout checking ${ticketKey} for duplicates. Try again.\n`;
    case 'server-error':
      return `  Tracker returned a server error (${classification.status}) checking ${ticketKey} for duplicates. Try again later.\n`;
    default:
      return `  Error checking ${ticketKey} for duplicates: ${err.message}\n`;
  }
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

function resolveTicketAdapter(ticketKey, cmdArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream }) {
  const profileName = parseFlag(cmdArgs, 'profile');
  const conn = resolveConnectionFn(ticketKey, { configDir, profileName });
  if (!conn.baseUrl) {
    stream.write(`  No connection configured for ${ticketKey}. Run \`ticketlens init\`.\n`);
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
