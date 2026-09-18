/**
 * Implements `ticketlens worklog` and the `ticket_worklog` MCP tool: logs time
 * against one or many tickets. Jira-only (GitHub/Linear have no worklog API),
 * always as the authenticated user, Pro-gated like every ticket write.
 *
 * Time entries feed billing/payroll and have no delete path here, so the shape
 * is deliberately stricter than ticket_comment:
 *  - every entry is validated and resolved BEFORE any write — a typo in entry
 *    3 never leaves entries 1–2 logged;
 *  - nothing is written without an explicit confirm (a preview is shown);
 *  - runtime failures are reported per ticket, with what already landed named
 *    so a retry never repeats it; a rate-limit or 401 halts the batch; and
 *    local bookkeeping failing after a landed write never reads as failure
 *    (a retry would double the time).
 * Jira has no public bulk-worklog endpoint, so a batch is sequential POSTs.
 */

import os from 'node:os';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { isLicensed } from './license.mjs';
import { resolveConnection } from './profile-resolver.mjs';
import { resolveAdapter } from './resolve-adapter.mjs';
import { checkCooldown, recordAction } from './ticket-action-cooldown.mjs';
import { logAction } from './ticket-action-log.mjs';
import { TICKET_KEY_PATTERN, normalizeTicketKey } from './cli.mjs';
import { createStyler, sanitizeUntrustedText } from './ansi.mjs';
import { parseFlag, requireLicense, resolveTicketAdapter, formatWriteFailure, classifyWriteFailure } from './ticket-command.mjs';
import { parseDuration, parseStarted, formatDuration } from './worklog-duration.mjs';

export const MAX_WORKLOG_ENTRIES = 20;
/** One call may log at most a day's worth in total — the per-entry 24h cap alone allows 20 x 24h. */
export const MAX_WORKLOG_TOTAL_SECONDS = 86_400;
export const MAX_COMMENT_CHARS = 2000;
/**
 * A timed-out or 5xx write may have landed. The 10s double-fire debounce is far
 * too short to stop a retry of that — minutes, until the user has checked Jira.
 */
const UNCONFIRMED_WINDOW_MS = 10 * 60 * 1000;
const USAGE = 'Usage: ticketlens worklog KEY=DURATION [KEY=DURATION ...] [--comment="..."] [--started=ISO] [--profile=NAME] --confirm\n';
const COMMENT_PREVIEW_CHARS = 60;

const invalid = (error) => ({ error });
const refused = (reason) => ({ ok: false, reason, results: [] });
const fromResult = (result, valueKey) => (result.ok ? { value: result[valueKey] } : invalid(result.error));

function parseTicket(raw) {
  if (typeof raw !== 'string') return invalid('"ticket" must be a string like PROJ-123.');
  const key = normalizeTicketKey(raw.trim());
  if (!TICKET_KEY_PATTERN.test(key)) return invalid(`${JSON.stringify(raw)} is not a valid ticket key.`);
  // Jira numbers never have leading zeros; PROJ-01 would slip past duplicate/cooldown checks keyed on PROJ-1.
  if (/-0\d/.test(key)) return invalid(`${JSON.stringify(raw)} has a leading zero in its number — did you mean ${key.replace(/-0+(?=\d)/, '-')}?`);
  return { value: key };
}

function parseComment(raw) {
  if (raw === undefined || raw === null || raw === '') return { value: undefined };
  if (typeof raw !== 'string') return invalid('"comment" must be a string.');
  return raw.length <= MAX_COMMENT_CHARS ? { value: raw } : invalid(`"comment" is ${raw.length} characters — at most ${MAX_COMMENT_CHARS}.`);
}

/** @returns {{ item?: object, errors?: string[] }} */
function parseEntry(raw, index, now) {
  const label = `Entry ${index + 1}`;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { errors: [`${label}: expected an object with "ticket" and "time".`] };
  }
  const parts = {
    ticket: parseTicket(raw.ticket),
    seconds: fromResult(parseDuration(raw.time), 'seconds'),
    started: fromResult(parseStarted(raw.started ?? undefined, { now }), 'started'),
    comment: parseComment(raw.comment),
  };
  const errors = Object.values(parts).filter(p => p.error).map(p => `${label}: ${p.error}`);
  if (errors.length) return { errors };
  return { item: { ticket: parts.ticket.value, seconds: parts.seconds.value, started: parts.started.value, comment: parts.comment.value } };
}

function findDuplicates(parsed) {
  const seen = new Set();
  const errors = [];
  parsed.forEach((p, index) => {
    if (!p.item) return;
    if (seen.has(p.item.ticket)) errors.push(`Entry ${index + 1}: ${p.item.ticket} appears more than once — one worklog per ticket per call.`);
    seen.add(p.item.ticket);
  });
  return errors;
}

function findTotalOverrun(parsed) {
  const total = parsed.reduce((sum, p) => sum + (p.item?.seconds ?? 0), 0);
  return total > MAX_WORKLOG_TOTAL_SECONDS ? [`Total time across entries is ${formatDuration(total)} — at most 24h per call. Split it across separate calls.`] : [];
}

/** @returns {object[] | null} validated items, or null after writing every error found */
function parseEntries(entries, { now, stream }) {
  if (!Array.isArray(entries) || entries.length === 0) {
    stream.write('  Provide at least one entry.\n');
    return null;
  }
  if (entries.length > MAX_WORKLOG_ENTRIES) {
    stream.write(`  Too many entries (${entries.length}) — at most ${MAX_WORKLOG_ENTRIES} per call.\n`);
    return null;
  }
  const parsed = entries.map((raw, index) => parseEntry(raw, index, now));
  const errors = [...parsed.flatMap(p => p.errors ?? []), ...findDuplicates(parsed), ...findTotalOverrun(parsed)];
  if (errors.length) {
    stream.write(errors.map(e => `  ${e}\n`).join(''));
    return null;
  }
  return parsed.map(p => p.item);
}

/** @returns {object[] | null} items with their adapter attached, or null after writing every problem */
/** Connection resolution warns once per entry; an identical line (a profile-ambiguity warning) is shown once. */
function onceStream(stream) {
  const seen = new Set();
  return { isTTY: stream.isTTY, write: (text) => (seen.has(text) ? true : (seen.add(text), stream.write(text))) };
}

function resolveItems(items, { profile, configDir, resolveConnectionFn, resolveAdapterFn, stream }) {
  const profileArgs = profile ? [`--profile=${profile}`] : [];
  const resolveStream = onceStream(stream);
  const resolved = items.map(item => {
    const found = resolveTicketAdapter(item.ticket, profileArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream: resolveStream });
    if (found && typeof found.adapter.logWork !== 'function') {
      stream.write(`  ${item.ticket}: worklogs are only supported on Jira — this ticket is on ${found.adapter.type}.\n`);
      return null;
    }
    return found && { ...item, adapter: found.adapter };
  });
  return resolved.includes(null) ? null : resolved;
}

function writePreview(items, { stream, cliHints }) {
  const s = createStyler({ isTTY: stream.isTTY });
  stream.write(`  Would log ${items.length} worklog${items.length === 1 ? '' : 's'}:\n\n`);
  for (const item of items) {
    const note = item.comment ? `  — ${sanitizeUntrustedText(item.comment.replace(/\s+/g, ' ')).slice(0, COMMENT_PREVIEW_CHARS)}` : '';
    stream.write(`    ${s.brand(s.bold(item.ticket))}  ${formatDuration(item.seconds)}  started ${item.started}${note}\n`);
  }
  stream.write(cliHints
    ? `\n  Refusing to log without --confirm. Re-run with --confirm once you've reviewed the entries.\n`
    : `\n  Refusing to log without confirm: true. Call again with confirm: true once you've reviewed the entries.\n`);
}

/**
 * Runs after the write already landed — a failure here must never be reported
 * as a failed write. Audit first (it is the record of billable time), each in
 * its own try so one failing never skips the other.
 */
function recordBookkeeping(item, result, { configDir, recordActionFn, logActionFn, actor, stream, source }) {
  const attempt = (label, fn) => {
    try { fn(); } catch (err) {
      stream.write(`  ${item.ticket} logged, but local ${label} record failed: ${sanitizeUntrustedText(String(err.message))}. Do not re-run — the time is already on the ticket.\n`);
    }
  };
  attempt('audit', () => logActionFn({
    ticketKey: item.ticket,
    action: 'worklog',
    actor,
    tracker: item.adapter.type,
    detail: { id: result.id, seconds: item.seconds, started: item.started, hasComment: item.comment !== undefined, source },
  }, { configDir }));
  attempt('cooldown', () => recordActionFn(item.ticket, 'worklog', { configDir }));
}

/** Tracker text is untrusted: strip terminal control characters per line, keeping the line structure. */
const safeLines = (text) => text.split('\n').map(sanitizeUntrustedText).join('\n');

/** Checked before every write: a recent worklog, or a recent write whose outcome is still unknown. */
function skipReason(item, { configDir, checkCooldownFn }) {
  const unconfirmed = checkCooldownFn(item.ticket, 'worklog-unconfirmed', { configDir, cooldownMs: UNCONFIRMED_WINDOW_MS });
  if (unconfirmed.active) {
    return `  Skipped ${item.ticket} — an earlier write to it ended without a confirmed result (timeout or server error) ${Math.ceil(unconfirmed.remainingMs / 60000)}m ago and may have already landed. Check the ticket in Jira before logging again.\n`;
  }
  const recent = checkCooldownFn(item.ticket, 'worklog', { configDir });
  if (recent.active) {
    return `  Skipped ${item.ticket} — a worklog was already logged ${Math.ceil(recent.remainingMs / 1000)}s ago and is not repeated. Check the ticket before logging again.\n`;
  }
  return null;
}

/** Timeout / 5xx: the POST may have landed. Leave a long cooldown and an audit line so a retry can't silently double-bill. */
function recordUnconfirmed(item, classification, { configDir, recordActionFn, logActionFn, actor, stream, source }) {
  if (classification.kind !== 'network-or-timeout' && classification.kind !== 'server-error') return;
  try {
    logActionFn({ ticketKey: item.ticket, action: 'worklog-unconfirmed', actor, tracker: item.adapter.type, detail: { seconds: item.seconds, started: item.started, kind: classification.kind, source } }, { configDir });
    recordActionFn(item.ticket, 'worklog-unconfirmed', { configDir });
  } catch (err) {
    stream.write(`  Could not record the unconfirmed write to ${item.ticket} locally: ${sanitizeUntrustedText(err.message)}.\n`);
  }
}

async function logOne(item, ctx) {
  const { stream } = ctx;
  const skip = skipReason(item, ctx);
  if (skip) {
    stream.write(skip);
    return { ticket: item.ticket, status: 'skipped', reason: 'cooldown' };
  }
  const entry = { timeSpentSeconds: item.seconds, started: item.started, ...(item.comment !== undefined && { comment: item.comment }) };
  let result;
  try {
    result = await item.adapter.logWork(item.ticket, entry);
  } catch (err) {
    const classification = classifyWriteFailure(err);
    stream.write(safeLines(formatWriteFailure(item.ticket, err)));
    recordUnconfirmed(item, classification, ctx);
    return { ticket: item.ticket, status: 'failed', error: sanitizeUntrustedText(String(err.message)), kind: classification.kind, httpStatus: err.status };
  }
  const s = createStyler({ isTTY: stream.isTTY });
  stream.write(`  ${s.green('✔')} ${s.brand(s.bold(item.ticket))} logged ${formatDuration(item.seconds)}${result.url ? ` (${sanitizeUntrustedText(result.url)})` : ''}\n`);
  recordBookkeeping(item, result, ctx);
  return { ticket: item.ticket, status: 'logged', id: result.id, seconds: item.seconds, url: result.url };
}

/** A rate limit or a 401 fails every remaining entry the same way — stop instead of firing doomed POSTs. */
function haltReason(result) {
  if (result.kind === 'rate-limited' || result.httpStatus === 429) return 'a tracker rate limit';
  if (result.httpStatus === 401) return 'an authentication failure (401)';
  return null;
}

/** Names what landed and what to retry, so a caller (often an AI) never re-sends a worklog that already went through. */
function writeBatchSummary(results, stream) {
  const logged = results.filter(r => r.status === 'logged').map(r => r.ticket);
  const pending = results.filter(r => r.status !== 'logged').map(r => r.ticket);
  stream.write(`\n  Logged ${logged.length} of ${results.length} worklogs.\n`);
  if (logged.length && pending.length) stream.write(`  Already logged (do not repeat): ${logged.join(', ')}.\n`);
  if (pending.length) stream.write(`  Retry only: ${pending.join(', ')}.\n`);
}

async function logAll(items, ctx) {
  const results = [];
  let haltedBy = null;
  for (const item of items) {
    if (haltedBy) {
      ctx.stream.write(`  ${item.ticket} not attempted — the batch stopped after ${haltedBy}. Run ${item.ticket} again later.\n`);
      results.push({ ticket: item.ticket, status: 'skipped', reason: 'batch-halted' });
      continue;
    }
    const result = await logOne(item, ctx);
    results.push(result);
    haltedBy = haltReason(result);
  }
  if (results.length > 1) writeBatchSummary(results, ctx.stream);
  return { ok: results.every(r => r.status === 'logged'), results };
}

/**
 * Core entry point, shared by the CLI parser below and the MCP tool (which
 * passes structured entries directly — a comment never round-trips through
 * an argv string).
 *
 * @param {Array<{ ticket: string, time: string, started?: string, comment?: string }>} entries
 * @param {{ confirm?: boolean, profile?: string, cliHints?: boolean }} [deps]
 * @returns {Promise<{ ok: boolean, reason?: string, results: object[] }>}
 */
export async function runTicketWorklogEntries(entries, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  confirm = false,
  profile,
  cliHints = true,
  isLicensedFn = isLicensed,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
  checkCooldownFn = checkCooldown,
  recordActionFn = recordAction,
  logActionFn = logAction,
  actor = os.userInfo().username,
  now = () => Date.now(),
} = {}) {
  if (!requireLicense(isLicensedFn, configDir, 'ticketlens worklog', stream)) return refused();

  const items = parseEntries(entries, { now, stream });
  if (!items) return refused();
  const resolved = resolveItems(items, { profile, configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!resolved) return refused();

  if (confirm !== true) {
    writePreview(resolved, { stream, cliHints });
    return refused('confirm-required');
  }
  return logAll(resolved, { configDir, checkCooldownFn, recordActionFn, logActionFn, actor, stream, source: cliHints ? 'cli' : 'mcp' });
}

function parsePair(arg) {
  const at = arg.indexOf('=');
  return at > 0 ? { ticket: arg.slice(0, at), time: arg.slice(at + 1) } : null;
}

const VALUE_FLAGS = ['comment', 'started', 'profile'];

/**
 * Refuses what parseFlag would silently ignore: a misspelled `--startd=` would
 * quietly bill "now", an empty `--started=` likewise, and a repeated flag would
 * silently keep only the first. Time entries are too costly to guess about.
 * @returns {string[]} one message per problem, empty when the flags are clean
 */
function flagErrors(flags) {
  const errors = [];
  const seen = new Set();
  for (const flag of flags) {
    const [name, ...rest] = flag.slice(2).split('=');
    const hasValue = flag.includes('=');
    if (flag === '--confirm') continue;
    if (!VALUE_FLAGS.includes(name) || !hasValue) {
      errors.push(`Unknown option ${hasValue ? `--${name}` : flag}${VALUE_FLAGS.includes(name) ? ` (use --${name}=VALUE)` : ''}.`);
    } else if (!rest.join('=')) {
      errors.push(`--${name} needs a value, e.g. --${name}=...`);
    } else if (seen.has(name)) {
      errors.push(`--${name} was given more than once.`);
    }
    seen.add(name);
  }
  return errors;
}

/**
 * @param {string[]} cmdArgs - ['PROJ-1=1h30m', 'PROJ-2=45m', '--comment=...', '--started=...', '--confirm']
 *   `--comment`/`--started` apply to every ticket; per-ticket values need the MCP tool.
 */
export async function runTicketWorklog(cmdArgs, { stream = process.stderr, ...deps } = {}) {
  const pairs = cmdArgs.filter(a => !a.startsWith('--')).map(parsePair);
  if (pairs.length === 0 || pairs.includes(null)) {
    stream.write(USAGE);
    return refused();
  }
  const errors = flagErrors(cmdArgs.filter(a => a.startsWith('--')));
  if (errors.length) {
    stream.write(errors.map(e => `  ${e}\n`).join('') + USAGE);
    return refused();
  }
  const shared = Object.fromEntries(['comment', 'started'].map(name => [name, parseFlag(cmdArgs, name)]).filter(([, value]) => value));
  return runTicketWorklogEntries(pairs.map(pair => ({ ...pair, ...shared })), {
    ...deps,
    stream,
    confirm: cmdArgs.includes('--confirm'),
    profile: parseFlag(cmdArgs, 'profile'),
  });
}
