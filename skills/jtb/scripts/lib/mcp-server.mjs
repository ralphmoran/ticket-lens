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
import { runNoteAdd } from './note-command.mjs';
import { runRecall } from './recall-command.mjs';
import { runTicketComment, runTicketTransitionList, runTicketTransition, runTicketAssign, runTicketDuplicates, runTicketLinkList, runTicketLink, runTicketUpdate, runTicketCreate } from './ticket-command.mjs';
import { run as runFetchTicket } from '../fetch-ticket.mjs';
import { run as runTriage } from '../fetch-my-tickets.mjs';

const PROTOCOL_VERSION = '2025-11-25';

const TOOLS = [
  {
    name: 'fetch',
    description: 'Fetch a ticket\'s full context brief (Jira/GitHub/Linear) — description, comments, linked tickets, code references, attachments. The core read action; free tier. Not a discovery tool — requires a known ticket key.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Ticket key, e.g. PROJ-123.' },
        profile: { type: 'string', description: 'Connection profile to target, overriding folder-based inference and the default profile.' },
        depth: { type: 'number', description: 'How many hops of linked tickets to traverse. Defaults to 1 (direct links only). 0 disables traversal.' },
      },
      required: ['ticket'],
    },
  },
  {
    name: 'triage',
    description: 'Scan assigned tickets and surface what needs attention — replies owed, aging tickets, stale-status tickets. The base scan is free tier; some options require a TicketLens Pro or Team license.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'string', description: 'Connection profile to target, overriding folder-based inference and the default profile.' },
        stale: { type: 'number', description: 'Days before an untouched ticket counts as aging. Defaults to 5.' },
        status: { type: 'array', items: { type: 'string' }, description: 'Statuses to include, overriding the profile default / built-in defaults (In Progress, Code Review, QA).' },
        sort: { type: 'string', description: 'Sort order for results, overriding the profile default.' },
        save: { type: 'string', description: 'Write the plain-text summary to this local file path instead of (in addition to) returning it. Requires a TicketLens Pro license.' },
        all: { type: 'boolean', description: 'Triage every configured profile, not just the resolved one. Requires a TicketLens Pro license.' },
        digest: { type: 'boolean', description: 'Deliver the scored results to the digest backend instead of returning them as text — on success, no summary is returned, only a delivery confirmation. Requires a TicketLens Pro license.' },
        assignee: { type: 'string', description: 'View another user\'s tickets instead of your own. Requires a TicketLens Team license.' },
        sprint: { type: 'string', description: 'Scope to a named sprint. Requires a TicketLens Team license.' },
        export: { type: 'string', enum: ['csv', 'json'], description: 'Write results to a file in this format instead of returning the summary text, returning the written file path instead. Requires a TicketLens Team license.' },
        project: { type: 'string', description: 'Scope to a project/team key. Requires a TicketLens Team license.' },
        label: { type: 'array', items: { type: 'string' }, description: 'Scope to one or more labels. Requires a TicketLens Team license.' },
        priority: { type: 'string', description: 'Scope to a priority name, e.g. "High". Requires a TicketLens Team license.' },
      },
    },
  },
  {
    name: 'compliance',
    description: 'Check a ticket\'s acceptance-criteria coverage against the current git diff — extracts requirements from the ticket description, matches them against code changes, and reports a coverage percentage plus what\'s missing. Read-only; the same check `ticketlens install-hooks` runs automatically. Free tier: 3 checks per month; TicketLens Pro removes the limit.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Ticket key, e.g. PROJ-123.' },
        profile: { type: 'string', description: 'Connection profile to target, overriding folder-based inference and the default profile.' },
      },
      required: ['ticket'],
    },
  },
  {
    name: 'doctor',
    description: 'Diagnose common TicketLens problems: profile configuration, license freshness, tracker connectivity, attachment cache health, MCP registration, and the Recall sync queue. Always returns structured JSON. Free tier, fully unrestricted — including fix.',
    inputSchema: {
      type: 'object',
      properties: {
        fix: { type: 'boolean', description: 'Attempt safe, non-destructive repairs for failing checks.' },
        profile: { type: 'string', description: 'Scope profile/connectivity/cache checks to one profile.' },
      },
    },
  },
  {
    name: 'recall_add',
    description: 'Save a Recall note — a gotcha, root cause, or non-obvious decision learned this session. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short one-line title.' },
        ticket: { type: 'string', description: 'Optional ticket key, e.g. PROJ-123.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags derived from this note\'s actual content — the specific technology, error type, root cause, or affected component (e.g. "retry-backoff", "null-pointer", "auth-middleware"). Never the project name or a generic category word like "gotcha" or "bug" — those provide no search signal to someone else looking for this note later. A tag that just restates the title in different words, or one you cannot trace to a specific sentence in the body, gives that same zero signal — if you cannot point to the exact phrase that justifies it, drop it.' },
        body: { type: 'string', description: 'The note body — one or more paragraphs.' },
      },
      required: ['title', 'body'],
    },
  },
  {
    name: 'recall_search',
    description: 'Search saved Recall notes by free-text query or ticket key. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text query or a ticket key like PROJ-123.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'ticket_comment',
    description: 'Post a comment to a ticket in its tracker (Jira/GitHub/Linear). Destructive — writes directly to the live tracker, not a local Recall note. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Ticket key, e.g. PROJ-123.' },
        body: { type: 'string', description: 'Comment body.' },
        attachments: { type: 'array', items: { type: 'string' }, description: 'Local file paths to attach — images render as a real inline thumbnail in the posted comment on both Jira (Cloud and Server/Data Center) and Linear. Not supported on GitHub — no PAT-compatible upload API exists there.' },
      },
      required: ['ticket', 'body'],
    },
  },
  {
    name: 'ticket_transition',
    description: 'List or execute a ticket status transition in its tracker (Jira/GitHub/Linear). Called with only `ticket`, lists the tracker\'s current valid options without changing anything. Destructive when `target` and `confirm: true` are both given — requires confirmation and writes directly to the live tracker. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Ticket key, e.g. PROJ-123.' },
        target: { type: 'string', description: 'Target status/transition name. Omit to just list the tracker\'s current valid options.' },
        confirm: { type: 'boolean', description: 'Must be true, alongside `target`, to actually execute the transition — a nudge and audit trail, not just a formality.' },
      },
      required: ['ticket'],
    },
  },
  {
    name: 'ticket_assign',
    description: 'Assign a ticket to yourself in its tracker (Jira/GitHub/Linear). Self-assign only — assigning to someone else is not supported yet. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Ticket key, e.g. PROJ-123.' },
        to: { type: 'string', description: 'Who to assign to — currently only "me" is accepted.' },
      },
      required: ['ticket', 'to'],
    },
  },
  {
    name: 'ticket_duplicates',
    description: 'Find likely duplicate tickets in the same project (Jira/GitHub/Linear). Read-only — never links or changes anything. On Jira, any ticket already linked as a "Duplicate" is always included first (a confirmed relationship, not a guess); everything else comes from a local, approximate title/description overlap score, since no tracker scores similarity server-side. That scorer can miss real duplicates as easily as it over-matches, so an empty result means none were found, not a guarantee that none exist. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Ticket key, e.g. PROJ-123.' },
        threshold: { type: 'number', description: 'Minimum match score 0-1 to report. Defaults to 0.35.' },
      },
      required: ['ticket'],
    },
  },
  {
    name: 'ticket_link',
    description: 'List or execute a link between two tickets in their tracker (Jira/GitHub/Linear). Called with only `ticket`/`target`, lists the tracker\'s current valid link types without changing anything. Destructive when `type` and `confirm: true` are both given — writes directly to the live tracker. Direction matters: `ticket` "types" `target` (e.g. ticket duplicates target). On GitHub, executing CLOSES `ticket` as a duplicate of `target` — a state change, not just a relationship add like Jira/Linear. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Source ticket key, e.g. PROJ-123 — the one that "types" target.' },
        target: { type: 'string', description: 'Target ticket key, e.g. PROJ-456.' },
        type: { type: 'string', description: 'Link type name (from the list). Omit to just list the tracker\'s current valid options. GitHub only supports "duplicate".' },
        confirm: { type: 'boolean', description: 'Must be true, alongside `type`, to actually execute the link — a nudge and audit trail, not just a formality.' },
      },
      required: ['ticket', 'target'],
    },
  },
  {
    name: 'ticket_update',
    description: 'Update a narrow, named field set on a ticket in its tracker (Jira/GitHub/Linear) — title, description, labels, priority. At least one field is required. Labels are add/remove, never a wholesale replace: an unnamed existing label is left alone. No discovery step and no confirm required — these are reversible metadata edits, not workflow-state changes. GitHub has no priority field; passing `priority` for a GitHub-tracked ticket is refused. A call can partially succeed (e.g. title updates but a label does not resolve) — the result reports exactly what landed. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Ticket key, e.g. PROJ-123.' },
        title: { type: 'string', description: 'New title/summary. Omit to leave unchanged.' },
        description: { type: 'string', description: 'New description. Omit to leave unchanged.' },
        addLabels: { type: 'array', items: { type: 'string' }, description: 'Labels to add. Existing labels not named here are left alone.' },
        removeLabels: { type: 'array', items: { type: 'string' }, description: 'Labels to remove.' },
        priority: { type: 'string', description: 'New priority name, e.g. "High". Not supported on GitHub.' },
      },
      required: ['ticket'],
    },
  },
  {
    name: 'ticket_create',
    description: 'Create a new ticket in a tracker (Jira/GitHub/Linear) with a fixed minimal field set — no arbitrary custom fields. Architecturally unlike every other ticket-write tool: there is no existing ticket to target, so the target tracker/project is picked by the connection profile rather than a ticket key. `project` is the Jira project key or Linear team key — required for both, ignored on GitHub (its repo is fixed by the profile). `type` is the Jira issue type — required for Jira only, ignored elsewhere. Highest blast radius of the ticket-write family: a bad project/type fabricates a real, hard-to-walk-back item in a live tracker. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Jira project key or Linear team key. Required for Jira/Linear; ignored on GitHub.' },
        type: { type: 'string', description: 'Jira issue type, e.g. "Task" or "Bug". Required for Jira only; ignored on GitHub/Linear.' },
        summary: { type: 'string', description: 'Ticket title/summary.' },
        description: { type: 'string', description: 'Ticket description. Omit for none.' },
        attachments: { type: 'array', items: { type: 'string' }, description: 'Local file paths to attach, uploaded after the ticket is created. On Linear the image is automatically linked into the description. On Jira it becomes a real, visible attachment on the issue, but is not embedded inline in the initial description (use ticket_comment afterward for an inline thumbnail). Not supported on GitHub.' },
        profile: { type: 'string', description: 'Connection profile to target, overriding folder-based inference and the default profile. Use this when `project` belongs to a profile other than the one auto-resolved from the current working directory.' },
      },
      required: ['summary'],
    },
  },
];

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
 * (currently `fetch` and `compliance` — `compliance` is just another
 * subcommand of that same function). `run()` has no {ok} return value
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
 * Builds runNoteAdd's cmdArgs array. Each `--flag=value` MUST stay a single,
 * discrete array element — runNoteAdd's parseFlag matches per-element via
 * startsWith/includes, which is only safe as long as this array is never
 * joined into a string and re-split/re-tokenized. A title/body containing
 * `--ticket=EVIL-999` stays inert precisely because it's never anything
 * but one opaque array element.
 */
function buildNoteAddArgs({ title, ticket, tags }) {
  const args = [`--title=${title}`];
  if (ticket) args.push(`--ticket=${ticket}`);
  if (Array.isArray(tags) && tags.length > 0) args.push(`--tags=${tags.join(',')}`);
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
  if (name === 'doctor') return callDoctor(args, deps);
  if (name === 'recall_add') return callRecallAdd(args, deps);
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

async function handleMessage(raw, { configDir, runFetchTicketFn, runTriageFn, runDoctorFn, runNoteAddFn, runRecallFn, runTicketCommentFn, runTicketTransitionListFn, runTicketTransitionFn, runTicketAssignFn, runTicketDuplicatesFn, runTicketLinkListFn, runTicketLinkFn, runTicketUpdateFn, runTicketCreateFn }) {
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
      const result = await handleToolsCall(params, { configDir, runFetchTicketFn, runTriageFn, runDoctorFn, runNoteAddFn, runRecallFn, runTicketCommentFn, runTicketTransitionListFn, runTicketTransitionFn, runTicketAssignFn, runTicketDuplicatesFn, runTicketLinkListFn, runTicketLinkFn, runTicketUpdateFn, runTicketCreateFn });
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
  runNoteAddFn = runNoteAdd,
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
      const response = await handleMessage(line, { configDir, runFetchTicketFn, runTriageFn, runDoctorFn, runNoteAddFn, runRecallFn, runTicketCommentFn, runTicketTransitionListFn, runTicketTransitionFn, runTicketAssignFn, runTicketDuplicatesFn, runTicketLinkListFn, runTicketLinkFn, runTicketUpdateFn, runTicketCreateFn });
      if (response) stdout.write(response);
    }).catch(() => {});
  });

  return new Promise((resolve) => {
    rl.on('close', () => { queue.then(resolve); });
  });
}
