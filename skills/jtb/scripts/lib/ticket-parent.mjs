/**
 * Implements `ticketlens parent` and the `ticket_parent` MCP tool: sets one epic
 * (parent) on many tickets at once. Jira and Linear; GitHub has no parent and is
 * refused. Pro-gated like every ticket write.
 *
 * Same shape as ticket-worklog.mjs, minus its double-write machinery: setting a
 * parent is idempotent, so a repeat changes nothing and needs no cooldown.
 *  - everything is validated and read BEFORE any write — a sub-task or a missing
 *    ticket in the list never leaves the others half-done;
 *  - nothing is written without an explicit confirm (a preview is shown);
 *  - a write failure is reported per ticket and the batch carries on; a rate
 *    limit or 401 halts it;
 *  - every write is read back, since a 204 is not proof of what the tracker stored.
 * The epic's own connection is used for every child.
 */

import os from 'node:os';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { isLicensed } from './license.mjs';
import { resolveConnection } from './profile-resolver.mjs';
import { resolveAdapter } from './resolve-adapter.mjs';
import { logAction } from './ticket-action-log.mjs';
import { createStyler, sanitizeUntrustedText } from './ansi.mjs';
import { parseFlag, requireLicense, resolveTicketAdapter, formatWriteFailure, classifyWriteFailure } from './ticket-command.mjs';
import { TICKET_KEY_PATTERN } from './cli.mjs';
import { parseTicket, flagErrors } from './ticket-worklog.mjs';

export const MAX_PARENT_CHILDREN = 50;
const READ_CONCURRENCY = 5;
const MAX_ERROR_CHARS = 200;
const USAGE = 'Usage: ticketlens parent EPIC-KEY CHILD-KEY [CHILD-KEY ...] [--profile=NAME] --confirm\n';
const VALUE_FLAGS = ['profile'];

const refused = (reason) => ({ ok: false, reason, results: [] });
/** Tracker text is untrusted: strip terminal control characters, keep it to one short line. */
const safe = (text, max = MAX_ERROR_CHARS) => sanitizeUntrustedText(String(text ?? '').replace(/\s+/g, ' ')).slice(0, max);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function parseEpic(raw) {
  if (typeof raw !== 'string') return { error: `Epic ${JSON.stringify(raw) ?? '(missing)'} is not a valid ticket key.` };
  const parsed = parseTicket(raw);
  return parsed.error ? { error: `Epic: ${parsed.error}` } : parsed;
}

/** @returns {{ epic: string, children: string[] } | null} validated keys, or null after writing every problem */
function parseInput(epicRaw, childrenRaw, stream) {
  if (!Array.isArray(childrenRaw) || childrenRaw.length === 0) {
    stream.write('  Provide at least one child ticket.\n');
    return null;
  }
  if (childrenRaw.length > MAX_PARENT_CHILDREN) {
    stream.write(`  Too many children (${childrenRaw.length}) — at most ${MAX_PARENT_CHILDREN} per call.\n`);
    return null;
  }
  const epic = parseEpic(epicRaw);
  const errors = epic.error ? [epic.error] : [];
  const seen = new Set();
  const children = childrenRaw.map((raw, index) => {
    const label = `Child ${index + 1}`;
    const parsed = parseTicket(raw);
    if (parsed.error) { errors.push(`${label}: ${parsed.error}`); return null; }
    if (parsed.value === epic.value) errors.push(`${label}: ${parsed.value} is the epic itself.`);
    else if (seen.has(parsed.value)) errors.push(`${label}: ${parsed.value} appears more than once.`);
    seen.add(parsed.value);
    return parsed.value;
  });
  if (errors.length) {
    stream.write(errors.map(e => `  ${e}\n`).join(''));
    return null;
  }
  return { epic: epic.value, children };
}

/** Runs `fn` over `items` with a small concurrency cap; results keep the input order. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function readInfo(adapter, key) {
  try {
    return { key, info: await adapter.getParentInfo(key) };
  } catch (err) {
    return { key, error: safe(err?.message) };
  }
}

/** @returns {{ epic: string, infos: Map<string, object> } | null} the epic's canonical key and per-child info, or null after writing every problem */
async function readAll(adapter, epic, children, stream) {
  const reads = await mapLimit([epic, ...children], READ_CONCURRENCY, (key) => readInfo(adapter, key));
  const [epicRead, ...childReads] = reads;
  const problems = [];
  if (epicRead.error) problems.push(`Epic ${epic} could not be read: ${epicRead.error}.`);
  else if (epicRead.info.isSubtask) problems.push(`Epic ${epic} is a sub-task — a sub-task cannot hold children.`);
  for (const read of childReads) {
    if (read.error) problems.push(`${read.key} could not be read: ${read.error}.`);
    else if (read.info.isSubtask) problems.push(`${read.key} is a sub-task — sub-tasks cannot be put under an epic.`);
  }
  if (problems.length) {
    stream.write(problems.map(p => `  ${p}\n`).join(''));
    return null;
  }
  // A moved or renamed epic comes back under its new key; children report that key as their parent.
  // The key is tracker text: only a well-formed one replaces what the user typed.
  const canonical = TICKET_KEY_PATTERN.test(epicRead.info.key) ? epicRead.info.key : epic;
  return { epic: canonical, infos: new Map(childReads.map(read => [read.key, read.info])) };
}

function writePreview(epic, children, infos, { stream, cliHints }) {
  const s = createStyler({ isTTY: stream.isTTY });
  stream.write(`  Would set ${s.brand(s.bold(safe(epic)))} as the parent of ${plural(children.length, 'ticket')}:\n\n`);
  for (const key of children) {
    const info = infos.get(key);
    const current = info.parentKey === epic
      ? `already under ${safe(epic)} — skipped`
      : (info.parentKey ? `currently under ${safe(info.parentKey)}` : 'no parent');
    const type = info.type ? `${safe(info.type, 40)}  ` : '';
    stream.write(`    ${s.brand(s.bold(key))}  ${type}${current}\n`);
  }
  stream.write(cliHints
    ? `\n  Refusing to write without --confirm. Re-run with --confirm once you've reviewed the list.\n`
    : `\n  Refusing to write without confirm: true. Call again with confirm: true once you've reviewed the list.\n`);
}

/** Runs after the write landed — a failure here must never be reported as a failed write. */
function audit(child, epic, { adapter, configDir, logActionFn, actor, stream, infos, source }) {
  const detail = { parentKey: epic, previousParentKey: infos.get(child)?.parentKey ?? null, source };
  try {
    logActionFn({ ticketKey: child, action: 'parent', actor, tracker: adapter.type, detail }, { configDir });
  } catch (err) {
    stream.write(`  ${child} updated, but the local audit record failed: ${safe(err?.message)}.\n`);
  }
}

/** What the tracker actually stored — a 204 alone does not prove it. */
async function verify(child, epic, { adapter, stream }) {
  let stored;
  try {
    stored = (await adapter.getParentInfo(child)).parentKey;
  } catch (err) {
    stream.write(`  ${child} was written, but reading it back failed: ${safe(err?.message)}. Check it in the tracker.\n`);
    return false;
  }
  if (stored === epic) return true;
  stream.write(`  ${child} was written, but the tracker shows ${stored ? `parent ${safe(stored)}` : 'no parent'} (expected ${safe(epic)}). Check it in the tracker.\n`);
  return false;
}

async function setOne(child, epic, ctx) {
  const { adapter, stream } = ctx;
  let result;
  try {
    result = await adapter.setParent(child, epic);
  } catch (err) {
    stream.write(`  ${safe(formatWriteFailure(child, err).trim(), 400)}\n`);
    const { kind } = classifyWriteFailure(err);
    return { ticket: child, status: 'failed', error: safe(err?.message), kind, httpStatus: err?.status };
  }
  if (!result.executed) {
    stream.write(`  Not set on ${child} — ${safe(result.reason)}.\n`);
    return { ticket: child, status: 'failed', error: safe(result.reason) };
  }
  audit(child, epic, ctx);
  if (!(await verify(child, epic, ctx))) return { ticket: child, status: 'unverified' };
  const s = createStyler({ isTTY: stream.isTTY });
  stream.write(`  ${s.green('✔')} ${s.brand(s.bold(child))} now under ${s.brand(s.bold(safe(epic)))}\n`);
  return { ticket: child, status: 'set' };
}

/** A rate limit or a 401 fails every remaining write the same way — stop instead of firing doomed PUTs. */
function haltReason(result) {
  if (result.kind === 'rate-limited' || result.httpStatus === 429) return 'a tracker rate limit';
  if (result.httpStatus === 401) return 'an authentication failure (401)';
  return null;
}

async function setAll(pending, epic, ctx) {
  const results = [];
  let haltedBy = null;
  for (const child of pending) {
    if (haltedBy) {
      ctx.stream.write(`  ${child} not attempted — the batch stopped after ${haltedBy}.\n`);
      results.push({ ticket: child, status: 'skipped', reason: 'batch-halted' });
      continue;
    }
    const result = await setOne(child, epic, ctx);
    results.push(result);
    haltedBy = haltReason(result);
  }
  return results;
}

function writeSummary(results, alreadyUnder, epic, stream) {
  const names = (pick) => results.filter(pick).map(r => r.ticket).join(', ');
  const unverified = names(r => r.status === 'unverified');
  const retry = names(r => r.status === 'failed' || r.status === 'skipped');
  stream.write(`\n  Set the parent on ${results.filter(r => r.status === 'set').length} of ${results.length} tickets.\n`);
  if (alreadyUnder.length) stream.write(`  Already under ${safe(epic)}: ${alreadyUnder.join(', ')}.\n`);
  if (unverified) stream.write(`  Written but not confirmed — check in the tracker: ${unverified}.\n`);
  if (retry) stream.write(`  Retry only: ${retry}.\n`);
}

/** Resolves the epic's adapter and refuses a tracker that cannot hold a parent. */
async function prepareAdapter(epic, { profile, configDir, resolveConnectionFn, resolveAdapterFn, stream }) {
  const resolved = resolveTicketAdapter(epic, profile ? [`--profile=${profile}`] : [], { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!resolved) return null;
  const { adapter } = resolved;
  if (typeof adapter.setParent !== 'function') {
    stream.write(`  Setting a parent is not supported on ${adapter.type}.\n`);
    return null;
  }
  let support;
  try {
    support = await adapter.checkParentSupport();
  } catch (err) {
    stream.write(`  Cannot check parent support: ${safe(err?.message)}.\n`);
    return null;
  }
  if (!support.supported) {
    stream.write(`  Cannot set a parent: ${safe(support.reason)}.\n`);
    return null;
  }
  return adapter;
}

/**
 * Core entry point, shared by the CLI parser below and the MCP tool.
 *
 * @param {string} epicKey
 * @param {string[]} childKeys
 * @param {{ confirm?: boolean, profile?: string, cliHints?: boolean }} [deps]
 * @returns {Promise<{ ok: boolean, reason?: string, results: object[] }>}
 */
export async function runTicketParentChildren(epicKey, childKeys, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  confirm = false,
  profile,
  cliHints = true,
  isLicensedFn = isLicensed,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
  logActionFn = logAction,
  actor = os.userInfo().username,
} = {}) {
  if (!requireLicense(isLicensedFn, configDir, 'ticketlens parent', stream)) return refused();

  const input = parseInput(epicKey, childKeys, stream);
  if (!input) return refused();
  const { epic, children } = input;

  const adapter = await prepareAdapter(epic, { profile, configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!adapter) return refused();

  const read = await readAll(adapter, epic, children, stream);
  if (!read) return refused();
  const { infos, epic: target } = read;

  const alreadyUnder = children.filter(key => infos.get(key).parentKey === target);
  const pending = children.filter(key => !alreadyUnder.includes(key));
  if (pending.length === 0) {
    stream.write(`  Nothing to change: ${plural(children.length, 'ticket')} already under ${safe(target)}.\n`);
    return { ok: true, results: alreadyUnder.map(ticket => ({ ticket, status: 'already' })) };
  }
  if (confirm !== true) {
    writePreview(target, children, infos, { stream, cliHints });
    return refused('confirm-required');
  }

  const results = await setAll(pending, target, { adapter, configDir, logActionFn, actor, stream, infos, source: cliHints ? 'cli' : 'mcp' });
  writeSummary(results, alreadyUnder, target, stream);
  const all = [...alreadyUnder.map(ticket => ({ ticket, status: 'already' })), ...results];
  return { ok: all.every(r => r.status === 'set' || r.status === 'already'), results: all };
}

/**
 * @param {string[]} cmdArgs - ['EPIC-1', 'KEY-1', 'KEY-2', '--profile=NAME', '--confirm']
 */
export async function runTicketParent(cmdArgs, { stream = process.stderr, ...deps } = {}) {
  const positional = cmdArgs.filter(a => !a.startsWith('--'));
  if (positional.length < 2) {
    stream.write(USAGE);
    return refused();
  }
  const errors = flagErrors(cmdArgs.filter(a => a.startsWith('--')), VALUE_FLAGS);
  if (errors.length) {
    stream.write(errors.map(e => `  ${e}\n`).join('') + USAGE);
    return refused();
  }
  const [epic, ...children] = positional;
  return runTicketParentChildren(epic, children, {
    ...deps,
    stream,
    confirm: cmdArgs.includes('--confirm'),
    profile: parseFlag(cmdArgs, 'profile'),
  });
}
