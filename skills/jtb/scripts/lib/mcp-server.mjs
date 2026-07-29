/**
 * MCP (Model Context Protocol) stdio server — `ticketlens mcp`.
 *
 * A pure transport adapter: parses JSON-RPC 2.0 off stdin, translates
 * `tools/call` arguments into the exact args/dependency shape `runNoteAdd`/
 * `runRecall` already accept, and captures their human-readable `stream`
 * output into the JSON-RPC response instead of a real stream. Zero new
 * validation, licensing, or vault logic — both tools funnel through the
 * same functions the CLI's `note add`/`recall` commands already use, so
 * every existing gate (license, secret scan, structural check, retry
 * queue) applies identically here.
 *
 * Per the MCP stdio transport spec, the server MUST NOT write anything to
 * stdout that isn't a valid MCP message — every wrapped function's output
 * is captured into a buffer and returned as the tool result, never piped
 * to the real stdout that also carries the JSON-RPC channel.
 */

import readline from 'node:readline';
import { DEFAULT_CONFIG_DIR, getVersion } from './config.mjs';
import { runNoteAdd } from './note-command.mjs';
import { runRecall } from './recall-command.mjs';

const PROTOCOL_VERSION = '2025-11-25';

const TOOLS = [
  {
    name: 'recall_add',
    description: 'Save a Recall note — a gotcha, root cause, or non-obvious decision learned this session. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short one-line title.' },
        ticket: { type: 'string', description: 'Optional ticket key, e.g. PROJ-123.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags.' },
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

async function handleToolsCall(params, deps) {
  const { name, arguments: args = {} } = params ?? {};
  if (name === 'recall_add') return callRecallAdd(args, deps);
  if (name === 'recall_search') return callRecallSearch(args, deps);
  return { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
}

async function handleMessage(raw, { configDir, runNoteAddFn, runRecallFn }) {
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
      const result = await handleToolsCall(params, { configDir, runNoteAddFn, runRecallFn });
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
  runNoteAddFn = runNoteAdd,
  runRecallFn = runRecall,
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
      const response = await handleMessage(line, { configDir, runNoteAddFn, runRecallFn });
      if (response) stdout.write(response);
    }).catch(() => {});
  });

  return new Promise((resolve) => {
    rl.on('close', () => { queue.then(resolve); });
  });
}
