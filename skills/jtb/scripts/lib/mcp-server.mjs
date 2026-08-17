/**
 * MCP (Model Context Protocol) stdio server — `ticketlens mcp`.
 *
 * A pure transport adapter: parses JSON-RPC 2.0 off stdin, translates
 * `tools/call` arguments into the exact args/dependency shape `runNoteAdd`/
 * `runRecall`/`runTicketComment`/`runTicketTransitionList`/
 * `runTicketTransition` already accept, and captures their human-readable
 * `stream` output into the JSON-RPC response instead of a real stream. Zero
 * new validation, licensing, or vault logic — every tool funnels through
 * the same functions the CLI's `note add`/`recall`/`comment`/`transition`
 * commands already use, so every existing gate (license, secret scan,
 * structural check, retry queue, cooldown, audit log) applies identically
 * here. Ticket-writing tools must never import an adapter directly — doing
 * so would fully bypass the Pro+ gate that lives in ticket-command.mjs.
 *
 * Per the MCP stdio transport spec, the server MUST NOT write anything to
 * stdout that isn't a valid MCP message — every wrapped function's output
 * is captured into a buffer and returned as the tool result, never piped
 * to the real stdout that also carries the JSON-RPC channel.
 */

import readline from 'node:readline';
import { DEFAULT_CONFIG_DIR, getVersion } from './config.mjs';
import { runDoctor } from './doctor-command.mjs';
import { runNoteAdd, runNotePatch, runNoteDelete } from './note-command.mjs';
import { runRecall } from './recall-command.mjs';
import { runTicketComment, runTicketTransitionList, runTicketTransition, runTicketAssign, runTicketDuplicates, runTicketLinkList, runTicketLink, runTicketUpdate, runTicketCreate } from './ticket-command.mjs';
import { run as runFetchTicket } from '../fetch-ticket.mjs';
import { run as runTriage } from '../fetch-my-tickets.mjs';
import { runStats } from './run-stats.mjs';
import { runIssueTypes } from './run-issue-types.mjs';
import { runHistory } from './run-history.mjs';
import { runCollisions } from './run-collisions.mjs';
import { TOOLS } from './mcp-tool-schemas.mjs';

const PROTOCOL_VERSION = '2025-11-25';


function jsonRpcResult(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n';
}

function jsonRpcError(id, code, message) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n';
}

/** Buffers stream.write() calls instead of touching a real stream. */
function capturingStream() {
  const parts = [];
  return {
    write(s) { parts.push(s); return true; },
    get text() { return parts.join(''); },
  };
}

/**
 * Deliberately v1-minimal — only the three flags with zero cost/AI-provider
 * implications (see the 49b scoping decision). If `--summarize`/`--handoff`/
 * `--budget=`/`--compliance`/`--template=` are ever added here, note that
 * their error/progress output inside fetch-ticket.mjs's bare-fetch path
 * (applySummarize/applyHandoff/budgetPruner.pruneBrief/showUpgradePrompt)
 * still writes to the real process.stderr, not the injected printErr —
 * unlike every path reachable through this function today. Thread printErr
 * through those call sites first, or their failures will silently collapse
 * to callFetch's generic 'fetch failed' instead of the real reason.
 */
function buildFetchArgs({ ticket, profile, depth }) {
  const args = [ticket];
  if (profile) args.push(`--profile=${profile}`);
  if (depth !== undefined) args.push(`--depth=${depth}`);
  return args;
}

/**
 * Shared by every dispatch that goes through fetch-ticket.mjs's `run()`
 * (currently `fetch`, `compliance`, `review`, `standup`, and `pr` — all but
 * `fetch` are subcommands of that same function). `run()` has no {ok} return value
 * (unlike every other wrapped function) — failure is signaled by mutating
 * process.exitCode, which is unsafe to read in a long-lived server (one
 * failed call would poison the whole process's exit code forever). Success
 * is instead determined by whether `print` ever received real content —
 * every success path (cache hit, fresh fetch, handoff, a printed report
 * regardless of pass/fail) calls it exactly once; every failure path
 * returns before reaching it. errCapture may contain informational
 * chatter (cache notice, download progress) even on success — only read
 * on the failure branch, where it carries the actual error message.
 */
async function callFetchTicketRun(buildArgsFn, args, { configDir, runFetchTicketFn }, fallbackErrorText) {
  const capture = capturingStream();
  const errCapture = capturingStream();
  await runFetchTicketFn(buildArgsFn(args), {
    configDir,
    env: process.env,
    fetcher: globalThis.fetch,
    print: capture.write,
    printErr: errCapture.write,
  });
  if (capture.text) {
    return { content: [{ type: 'text', text: capture.text }] };
  }
  return { isError: true, content: [{ type: 'text', text: errCapture.text || fallbackErrorText }] };
}

async function callFetch(args, deps) {
  if (!args.ticket) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: ticket' }] };
  }
  return callFetchTicketRun(buildFetchArgs, args, deps, 'fetch failed');
}

/**
 * Deliberately excludes --push/--share — those sync/share a snapshot as a
 * human-collaboration side effect (Console notification queue, shareable
 * link), not "what needs attention" read value. See the 49b scoping memory.
 */
function buildTriageArgs({ profile, stale, status, sort, save, all, digest, assignee, sprint, export: exportFormat, project, label, priority }) {
  const args = ['--plain'];
  if (profile) args.push(`--profile=${profile}`);
  if (stale !== undefined) args.push(`--stale=${stale}`);
  if (Array.isArray(status) && status.length > 0) args.push(`--status=${status.join(',')}`);
  if (sort) args.push(`--sort=${sort}`);
  if (save) args.push(`--save=${save}`);
  if (all === true) args.push('--all');
  if (digest === true) args.push('--digest');
  if (assignee) args.push(`--assignee=${assignee}`);
  if (sprint) args.push(`--sprint=${sprint}`);
  if (exportFormat) args.push(`--export=${exportFormat}`);
  if (project) args.push(`--project=${project}`);
  if (Array.isArray(label) && label.length > 0) args.push(`--label=${label.join(',')}`);
  if (priority) args.push(`--priority=${priority}`);
  return args;
}

/**
 * runTriage has the same no-{ok}-return architecture as runFetchTicket —
 * success is "did print receive the summary," failure is whatever landed in
 * the injected stream. One deliberate exception: `--digest` delivers to the
 * backend and prints NOTHING to `print` on success (locked by
 * fetch-my-tickets.test.mjs's own "stdout should be empty" test) — an empty
 * capture there means delivery succeeded, not that it failed. Only a gate
 * rejection (Pro license, captured in `stream`) or a thrown delivery error
 * (caught below) signal an actual digest failure.
 */
async function callTriage(args, { configDir, runTriageFn }) {
  const capture = capturingStream();
  const errCapture = capturingStream();
  try {
    await runTriageFn(buildTriageArgs(args), {
      configDir,
      env: process.env,
      fetcher: globalThis.fetch,
      print: capture.write,
      stream: errCapture,
    });
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: err.message }] };
  }
  if (args.digest === true) {
    if (errCapture.text) {
      return { isError: true, content: [{ type: 'text', text: errCapture.text }] };
    }
    return { content: [{ type: 'text', text: 'Digest delivered.' }] };
  }
  if (capture.text) {
    return { content: [{ type: 'text', text: capture.text }] };
  }
  return { isError: true, content: [{ type: 'text', text: errCapture.text || 'triage failed' }] };
}

/**
 * `compliance` is a subcommand of the same fetch-ticket.mjs `run()` that
 * `callFetch` already wraps — reuses `runFetchTicketFn`, no new dependency
 * or import. See fetch-ticket.mjs's `compliance` dispatch block (thread
 * printErr through it before this tool existed — see the fetch tool's own
 * shipping notes for why that treatment was deferred per-tool).
 */
function buildComplianceArgs({ ticket, profile }) {
  const args = ['compliance', ticket];
  if (profile) args.push(`--profile=${profile}`);
  return args;
}

/**
 * Uses the shared callFetchTicketRun — a below-threshold result is still a
 * successful check: `run()` prints the report (via `printFn`) before
 * evaluating the threshold, so a failing coverage percentage is real,
 * useful report content, not a tool failure. Only the license/usage-gate
 * case (`runComplianceCheck` returns null) skips the report print entirely
 * — that's the one path that surfaces as `isError`.
 */
async function callCompliance(args, deps) {
  if (!args.ticket) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: ticket' }] };
  }
  return callFetchTicketRun(buildComplianceArgs, args, deps, 'compliance check failed');
}

/**
 * `review`/`standup`/`pr` are all subcommands of the same fetch-ticket.mjs
 * `run()` that `callFetch`/`callCompliance` already wrap — reuse
 * `runFetchTicketFn`, no new dependency. Each subcommand's error/progress
 * paths (including makeSpinner's writes) were threaded through opts.printErr
 * as part of adding these tools — see fetch-ticket.mjs's `review`/`standup`/
 * `pr` dispatch blocks and makeSpinner's injectable {isTTY, write}.
 */
function buildReviewArgs({ base, branch, profile }) {
  const args = ['review'];
  if (base) args.push(`--base=${base}`);
  else if (branch) args.push(`--branch=${branch}`);
  if (profile) args.push(`--profile=${profile}`);
  return args;
}

async function callReview(args, deps) {
  return callFetchTicketRun(buildReviewArgs, args, deps, 'review failed');
}

function buildStandupArgs({ since, format, profile }) {
  const args = ['standup'];
  if (since !== undefined) args.push(`--since=${since}`);
  if (format) args.push(`--format=${format}`);
  if (profile) args.push(`--profile=${profile}`);
  return args;
}

async function callStandup(args, deps) {
  return callFetchTicketRun(buildStandupArgs, args, deps, 'standup failed');
}

function buildPrArgs({ ticket, profile }) {
  const args = ['pr', ticket];
  if (profile) args.push(`--profile=${profile}`);
  return args;
}

async function callPr(args, deps) {
  if (!args.ticket) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: ticket' }] };
  }
  return callFetchTicketRun(buildPrArgs, args, deps, 'pr failed');
}

/**
 * `ledger` is a subcommand of the same fetch-ticket.mjs `run()` that
 * `callFetch`/`callCompliance`/`callPr` already wrap — reuses `runFetchTicketFn`,
 * no new dependency. Unlike those, it has no `ticket`/`profile` argument — the
 * ledger is local and config-dir scoped, not per-ticket. Its two direct
 * `process.stderr` writes (the license-gate upgrade prompt and the
 * verify-signature note printed alongside a successful json export) were
 * threaded through opts.printErr as part of adding this tool.
 */
function buildLedgerArgs({ format }) {
  const args = ['ledger'];
  if (format) args.push(`--format=${format}`);
  return args;
}

async function callLedger(args, deps) {
  return callFetchTicketRun(buildLedgerArgs, args, deps, 'ledger export failed');
}

function buildDoctorArgs({ fix, profile }) {
  const args = ['--format=json'];
  if (fix === true) args.push('--fix');
  if (profile) args.push(`--profile=${profile}`);
  return args;
}

async function callDoctor(args, { configDir, runDoctorFn }) {
  const capture = capturingStream();
  // runDoctor writes its final report to `out` (stdout by default) and only
  // uses `stream` for --fix progress chatter — since this call always forces
  // --format=json (see buildDoctorArgs), the report is what we need here.
  // Both must be captured, not left to default: an uncaptured `out` would
  // write the JSON report straight to this process's real stdout, which is
  // the MCP JSON-RPC channel itself.
  await runDoctorFn(buildDoctorArgs(args), { configDir, stream: capture, out: capture });
  return { content: [{ type: 'text', text: capture.text }] };
}

/**
 * Shared by `stats` and `history` — both wrap a run*Fn taking {configDir,
 * print, warn} where a real report always reaches `print` on success and
 * every failure (validation error, license gate) reaches `warn`. Same
 * "did print receive text" success heuristic as callTriage, factored out
 * here the way callFetchTicketRun already factors it out for the
 * fetch/compliance/review/standup/pr family. NOT used by `collisions` —
 * see callCollisions for why that one needs the returned {ok} instead.
 */
async function callPrintWarnRun(buildArgsFn, args, { configDir, runFn }, fallbackErrorText) {
  const capture = capturingStream();
  const errCapture = capturingStream();
  await runFn(buildArgsFn(args), { configDir, print: capture.write, warn: errCapture.write });
  if (capture.text) {
    return { content: [{ type: 'text', text: capture.text }] };
  }
  return { isError: true, content: [{ type: 'text', text: errCapture.text || fallbackErrorText }] };
}

function buildStatsArgs({ profile, days, format }) {
  const args = [];
  if (profile) args.push(`--profile=${profile}`);
  if (days !== undefined) args.push(`--days=${days}`);
  if (format) args.push(`--format=${format}`);
  return args;
}

async function callStats(args, { configDir, runStatsFn }) {
  return callPrintWarnRun(buildStatsArgs, args, { configDir, runFn: runStatsFn }, 'stats failed');
}

function buildIssueTypesArgs({ profile, refresh, format }) {
  const args = [];
  if (profile) args.push(`--profile=${profile}`);
  if (refresh === true) args.push('--refresh');
  if (format) args.push(`--format=${format}`);
  return args;
}

async function callIssueTypes(args, { configDir, runIssueTypesFn }) {
  return callPrintWarnRun(buildIssueTypesArgs, args, { configDir, runFn: runIssueTypesFn }, 'issue-types failed');
}

function buildHistoryArgs({ ticket }) {
  return [ticket];
}

async function callHistory(args, { configDir, runHistoryFn }) {
  if (!args.ticket) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: ticket' }] };
  }
  return callPrintWarnRun(buildHistoryArgs, args, { configDir, runFn: runHistoryFn }, 'history failed');
}

function buildCollisionsArgs({ json, plain }) {
  const args = [];
  if (json === true) args.push('--json');
  if (plain === true) args.push('--plain');
  return args;
}

/**
 * Unlike every other read tool here, runCollisions writes its own failure
 * messages (no-token, 401, 403, network error) through `print`, not `warn` —
 * so the "did print receive text" heuristic used by callStats/callTriage
 * would misreport every one of those as a success. Uses the returned {ok}
 * instead, same as callTicketCreate.
 */
async function callCollisions(args, { configDir, runCollisionsFn }) {
  const capture = capturingStream();
  const errCapture = capturingStream();
  const { ok } = await runCollisionsFn(buildCollisionsArgs(args), { configDir, print: capture.write, warn: errCapture.write });
  const content = [{ type: 'text', text: capture.text }];
  return ok ? { content } : { isError: true, content };
}

/**
 * Builds runNoteAdd's cmdArgs array. Each `--flag=value` MUST stay a single,
 * discrete array element — runNoteAdd's parseFlag matches per-element via
 * startsWith/includes, which is only safe as long as this array is never
 * joined into a string and re-split/re-tokenized. A title/body containing
 * `--ticket=EVIL-999` stays inert precisely because it's never anything
 * but one opaque array element.
 */
function buildNoteAddArgs({ title, ticket, tags, attachments }) {
  const args = [`--title=${title}`];
  if (ticket) args.push(`--ticket=${ticket}`);
  if (Array.isArray(tags) && tags.length > 0) args.push(`--tags=${tags.join(',')}`);
  if (Array.isArray(attachments) && attachments.length > 0) args.push(`--attach=${attachments.join(',')}`);
  return args;
}

async function callRecallAdd(args, { configDir, runNoteAddFn }) {
  // runNoteAdd's own `if (!rawTitle)` guard only rejects an empty string —
  // `--title=${title}` with title===undefined template-stringifies to the
  // truthy 4-char string "undefined", which would pass that guard and get
  // persisted as a real note title. Reject before it ever reaches cmdArgs.
  if (!args.title) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: title' }] };
  }
  const capture = capturingStream();
  const { written } = await runNoteAddFn(buildNoteAddArgs(args), {
    configDir,
    stream: capture,
    readStdin: async () => args.body ?? '',
  });
  const content = [{ type: 'text', text: capture.text }];
  return written ? { content } : { isError: true, content };
}

/**
 * Builds runNotePatch's cmdArgs array — same single-opaque-element reasoning
 * as buildNoteAddArgs above. `expectMtime` is optimistic-concurrency: a
 * caller that fetched a note via recall_search and wants to refine it
 * without racing a concurrent edit passes back the mtime it observed.
 */
function buildNotePatchArgs({ id, ticket, expectMtime }) {
  const args = [`--id=${id}`];
  if (ticket) args.push(`--ticket=${ticket}`);
  if (expectMtime !== undefined) args.push(`--expect-mtime=${expectMtime}`);
  return args;
}

async function callRecallUpdate(args, { configDir, runNotePatchFn }) {
  if (!args.id) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: id' }] };
  }
  if (!args.body) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: body' }] };
  }
  const capture = capturingStream();
  const { patched } = await runNotePatchFn(buildNotePatchArgs(args), {
    configDir,
    stream: capture,
    readStdin: async () => args.body,
  });
  const content = [{ type: 'text', text: capture.text }];
  return patched ? { content } : { isError: true, content };
}

/**
 * Builds runNoteDelete's cmdArgs array — same single-opaque-element reasoning
 * as buildNoteAddArgs above. Always passes `--yes`: runNoteDelete's own
 * confirmDestructive gate refuses outright in non-interactive mode (no real
 * TTY exists under the MCP transport to prompt against), so without it every
 * call would fail. The caller's `confirm: true` is enforced in callRecallDelete
 * below instead, before runNoteDeleteFn is ever reached — same nudge-and-audit
 * -trail spirit as ticket_transition/ticket_link, but deliberately a different
 * code path: those two defer the refusal to the wrapped CLI function, which
 * here would surface as that generic non-interactive error instead of a
 * dedicated one naming `confirm`.
 */
function buildNoteDeleteArgs({ id, ticket }) {
  const args = [`--id=${id}`];
  if (ticket) args.push(`--ticket=${ticket}`);
  args.push('--yes');
  return args;
}

async function callRecallDelete(args, { configDir, runNoteDeleteFn }) {
  if (!args.id) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: id' }] };
  }
  if (args.confirm !== true) {
    return { isError: true, content: [{ type: 'text', text: 'Deletion requires confirm: true — this cannot be restored.' }] };
  }
  const capture = capturingStream();
  const { deleted } = await runNoteDeleteFn(buildNoteDeleteArgs(args), { configDir, stream: capture });
  const content = [{ type: 'text', text: capture.text }];
  return deleted ? { content } : { isError: true, content };
}

async function callRecallSearch(args, { configDir, runRecallFn }) {
  const capture = capturingStream();
  const { ok } = await runRecallFn([args.query ?? ''], {
    configDir,
    stream: capture,
    errorStream: capture,
  });
  const content = [{ type: 'text', text: capture.text }];
  return ok ? { content } : { isError: true, content };
}

/**
 * `ticket`/`body` become single opaque cmdArgs elements (`--body=${body}`),
 * same reasoning as buildNoteAddArgs above — a body containing literal
 * `--confirm` or `--target=` text stays inert since parseFlag only matches
 * a whole array element via startsWith, never scans inside one.
 */
async function callTicketComment(args, { configDir, runTicketCommentFn }) {
  if (!args.ticket) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: ticket' }] };
  }
  if (!args.body) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: body' }] };
  }
  const cmdArgs = [args.ticket, `--body=${args.body}`];
  if (args.attachments?.length) cmdArgs.push(`--attach=${args.attachments.join(',')}`);
  const capture = capturingStream();
  const { ok } = await runTicketCommentFn(cmdArgs, { configDir, stream: capture });
  const content = [{ type: 'text', text: capture.text }];
  return ok ? { content } : { isError: true, content };
}

/**
 * No `target` → discovery only, dispatched to the read-only list function —
 * never touches the mutating path. `target` present → dispatched to the
 * executing function, which itself still refuses without `confirm: true`
 * (the MCP layer doesn't pre-empt that check, so the same refusal message
 * a CLI user sees is what a calling AI harness sees too).
 */
async function callTicketTransition(args, { configDir, runTicketTransitionListFn, runTicketTransitionFn }) {
  if (!args.ticket) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: ticket' }] };
  }
  const capture = capturingStream();
  if (!args.target) {
    const { ok } = await runTicketTransitionListFn([args.ticket], { configDir, stream: capture, cliHints: false });
    const content = [{ type: 'text', text: capture.text }];
    return ok ? { content } : { isError: true, content };
  }
  const cmdArgs = [args.ticket, `--target=${args.target}`];
  if (args.confirm === true) cmdArgs.push('--confirm');
  const { ok } = await runTicketTransitionFn(cmdArgs, { configDir, stream: capture, cliHints: false });
  const content = [{ type: 'text', text: capture.text }];
  return ok ? { content } : { isError: true, content };
}

async function callTicketAssign(args, { configDir, runTicketAssignFn }) {
  if (!args.ticket) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: ticket' }] };
  }
  if (!args.to) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: to' }] };
  }
  const capture = capturingStream();
  const { ok } = await runTicketAssignFn([args.ticket, `--to=${args.to}`], { configDir, stream: capture });
  const content = [{ type: 'text', text: capture.text }];
  return ok ? { content } : { isError: true, content };
}

async function callTicketDuplicates(args, { configDir, runTicketDuplicatesFn }) {
  if (!args.ticket) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: ticket' }] };
  }
  const cmdArgs = [args.ticket];
  if (args.threshold !== undefined) cmdArgs.push(`--threshold=${args.threshold}`);
  const capture = capturingStream();
  const { ok } = await runTicketDuplicatesFn(cmdArgs, { configDir, stream: capture });
  const content = [{ type: 'text', text: capture.text }];
  return ok ? { content } : { isError: true, content };
}

/**
 * No `type` → discovery only, dispatched to the read-only list function —
 * never touches the mutating path. `type` present → dispatched to the
 * executing function, which itself still refuses without `confirm: true`
 * (the MCP layer doesn't pre-empt that check, same as ticket_transition).
 */
async function callTicketLink(args, { configDir, runTicketLinkListFn, runTicketLinkFn }) {
  if (!args.ticket) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: ticket' }] };
  }
  if (!args.target) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: target' }] };
  }
  const capture = capturingStream();
  if (!args.type) {
    const { ok } = await runTicketLinkListFn([args.ticket, args.target], { configDir, stream: capture, cliHints: false });
    const content = [{ type: 'text', text: capture.text }];
    return ok ? { content } : { isError: true, content };
  }
  const cmdArgs = [args.ticket, args.target, `--type=${args.type}`];
  if (args.confirm === true) cmdArgs.push('--confirm');
  const { ok } = await runTicketLinkFn(cmdArgs, { configDir, stream: capture, cliHints: false });
  const content = [{ type: 'text', text: capture.text }];
  return ok ? { content } : { isError: true, content };
}

/**
 * `title`/`description`/`priority` each become one opaque cmdArgs element,
 * same reasoning as buildNoteAddArgs/callTicketComment above. `addLabels`/
 * `removeLabels` arrive as arrays per the MCP schema and are comma-joined
 * into a single element (same convention buildNoteAddArgs already uses for
 * `tags`) — parsed back apart by ticket-command.mjs's existing split(',')
 * handling, never by re-splitting a string this function builds itself.
 */
function buildTicketUpdateArgs(args) {
  const cmdArgs = [args.ticket];
  if (args.title !== undefined) cmdArgs.push(`--title=${args.title}`);
  if (args.description !== undefined) cmdArgs.push(`--description=${args.description}`);
  if (args.priority !== undefined) cmdArgs.push(`--priority=${args.priority}`);
  if (Array.isArray(args.addLabels) && args.addLabels.length > 0) cmdArgs.push(`--add-labels=${args.addLabels.join(',')}`);
  if (Array.isArray(args.removeLabels) && args.removeLabels.length > 0) cmdArgs.push(`--remove-labels=${args.removeLabels.join(',')}`);
  return cmdArgs;
}

/**
 * No list-then-act split, unlike ticket_transition/ticket_link — update has
 * no discovery step, so there is exactly one dispatch path. Whether at
 * least one field was actually given is runTicketUpdateFn's own concern
 * (same "don't pre-empt the underlying command" principle as ticket_link's
 * --confirm check).
 */
async function callTicketUpdate(args, { configDir, runTicketUpdateFn }) {
  if (!args.ticket) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: ticket' }] };
  }
  const capture = capturingStream();
  const { ok } = await runTicketUpdateFn(buildTicketUpdateArgs(args), { configDir, stream: capture });
  const content = [{ type: 'text', text: capture.text }];
  return ok ? { content } : { isError: true, content };
}

/**
 * `project`/`type`/`description` each become one opaque cmdArgs element,
 * same reasoning as buildNoteAddArgs/callTicketComment above. Unlike every
 * other ticket-write tool, there is no `ticket` argument — creation has no
 * existing ticket to target.
 */
function buildTicketCreateArgs(args) {
  const cmdArgs = [];
  if (args.project !== undefined) cmdArgs.push(`--project=${args.project}`);
  if (args.type !== undefined) cmdArgs.push(`--type=${args.type}`);
  cmdArgs.push(`--summary=${args.summary}`);
  if (args.description !== undefined) cmdArgs.push(`--description=${args.description}`);
  if (args.attachments?.length) cmdArgs.push(`--attach=${args.attachments.join(',')}`);
  if (args.profile !== undefined) cmdArgs.push(`--profile=${args.profile}`);
  return cmdArgs;
}

async function callTicketCreate(args, { configDir, runTicketCreateFn }) {
  if (!args.summary) {
    return { isError: true, content: [{ type: 'text', text: 'Missing required argument: summary' }] };
  }
  const capture = capturingStream();
  const { ok } = await runTicketCreateFn(buildTicketCreateArgs(args), { configDir, stream: capture });
  const content = [{ type: 'text', text: capture.text }];
  return ok ? { content } : { isError: true, content };
}

async function handleToolsCall(params, deps) {
  const { name, arguments: args = {} } = params ?? {};
  if (name === 'fetch') return callFetch(args, deps);
  if (name === 'triage') return callTriage(args, deps);
  if (name === 'compliance') return callCompliance(args, deps);
  if (name === 'review') return callReview(args, deps);
  if (name === 'standup') return callStandup(args, deps);
  if (name === 'pr') return callPr(args, deps);
  if (name === 'ledger') return callLedger(args, deps);
  if (name === 'doctor') return callDoctor(args, deps);
  if (name === 'stats') return callStats(args, deps);
  if (name === 'issue_types') return callIssueTypes(args, deps);
  if (name === 'history') return callHistory(args, deps);
  if (name === 'collisions') return callCollisions(args, deps);
  if (name === 'recall_add') return callRecallAdd(args, deps);
  if (name === 'recall_update') return callRecallUpdate(args, deps);
  if (name === 'recall_delete') return callRecallDelete(args, deps);
  if (name === 'recall_search') return callRecallSearch(args, deps);
  if (name === 'ticket_comment') return callTicketComment(args, deps);
  if (name === 'ticket_transition') return callTicketTransition(args, deps);
  if (name === 'ticket_assign') return callTicketAssign(args, deps);
  if (name === 'ticket_duplicates') return callTicketDuplicates(args, deps);
  if (name === 'ticket_link') return callTicketLink(args, deps);
  if (name === 'ticket_update') return callTicketUpdate(args, deps);
  if (name === 'ticket_create') return callTicketCreate(args, deps);
  return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
}

async function handleMessage(raw, deps) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return jsonRpcError(null, -32700, 'Parse error');
  }

  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
    return jsonRpcError(null, -32600, 'Invalid Request');
  }

  const { id, method, params } = msg;

  if (method === 'notifications/initialized') return null; // notification, no response

  if (method === 'initialize') {
    return jsonRpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'ticketlens', version: getVersion() },
    });
  }

  if (method === 'tools/list') {
    return jsonRpcResult(id, { tools: TOOLS });
  }

  if (method === 'tools/call') {
    try {
      const result = await handleToolsCall(params, deps);
      return jsonRpcResult(id, result);
    } catch (err) {
      return jsonRpcError(id ?? null, -32603, `Internal error: ${err.message}`);
    }
  }

  return jsonRpcError(id ?? null, -32601, `Method not found: ${method}`);
}

/**
 * Runs the stdio JSON-RPC loop until stdin closes (the client closing
 * stdin to end the session, per the stdio transport's lifecycle). Each
 * line is fully processed — awaited — before the next is handled: a
 * long-lived process (unlike the one-shot CLI) must not let a burst of
 * rapid messages spawn unbounded concurrent tool calls.
 */
export function runMcpServer({
  configDir = DEFAULT_CONFIG_DIR,
  stdin = process.stdin,
  stdout = process.stdout,
  runFetchTicketFn = runFetchTicket,
  runTriageFn = runTriage,
  runDoctorFn = runDoctor,
  runStatsFn = runStats,
  runIssueTypesFn = runIssueTypes,
  runHistoryFn = runHistory,
  runCollisionsFn = runCollisions,
  runNoteAddFn = runNoteAdd,
  runNotePatchFn = runNotePatch,
  runNoteDeleteFn = runNoteDelete,
  runRecallFn = runRecall,
  runTicketCommentFn = runTicketComment,
  runTicketTransitionListFn = runTicketTransitionList,
  runTicketTransitionFn = runTicketTransition,
  runTicketAssignFn = runTicketAssign,
  runTicketDuplicatesFn = runTicketDuplicates,
  runTicketLinkListFn = runTicketLinkList,
  runTicketLinkFn = runTicketLink,
  runTicketUpdateFn = runTicketUpdate,
  runTicketCreateFn = runTicketCreate,
} = {}) {
  // A client can disconnect mid-write (EPIPE) at any time on a long-lived
  // process — an unhandled 'error' event on either stream would otherwise
  // throw and crash the whole server via Node's default EventEmitter
  // behavior. Swallow here; the process ends naturally when stdin closes.
  stdin.on('error', () => {});
  stdout.on('error', () => {});

  // Assembled once and passed straight through handleMessage to handleToolsCall,
  // which is the only place the individual functions are read — so a new tool
  // needs its dependency named here and in the parameter list above, nowhere else.
  const deps = { configDir, runFetchTicketFn, runTriageFn, runDoctorFn, runStatsFn, runIssueTypesFn, runHistoryFn, runCollisionsFn, runNoteAddFn, runNotePatchFn, runNoteDeleteFn, runRecallFn, runTicketCommentFn, runTicketTransitionListFn, runTicketTransitionFn, runTicketAssignFn, runTicketDuplicatesFn, runTicketLinkListFn, runTicketLinkFn, runTicketUpdateFn, runTicketCreateFn };

  const rl = readline.createInterface({ input: stdin, terminal: false });
  let queue = Promise.resolve();

  rl.on('line', (line) => {
    if (!line.trim()) return;
    // .catch() here, not left to propagate: an unrejected chain would
    // otherwise poison every later .then() forever (one bad line kills
    // all subsequent messages) and leave `queue.then(resolve)` below
    // never resolving (a dropped rejection isn't a resolution) — the
    // server would hang on shutdown instead of exiting.
    queue = queue.then(async () => {
      const response = await handleMessage(line, deps);
      if (response) stdout.write(response);
    }).catch(() => {});
  });

  return new Promise((resolve) => {
    rl.on('close', () => { queue.then(resolve); });
  });
}
