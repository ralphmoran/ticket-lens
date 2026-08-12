import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runMcpServer } from '../lib/mcp-server.mjs';

/**
 * Drives runMcpServer with fake stdin/stdout PassThrough streams: writes
 * each request as one JSON-RPC line, ends stdin, waits for the server to
 * finish (mirrors the spec's real lifecycle — client closes stdin to end
 * the session), then hands back every line the server wrote to "stdout".
 */
async function drive(requests, opts = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stdoutChunks = [];
  stdout.on('data', (chunk) => stdoutChunks.push(chunk));

  const serverDone = runMcpServer({ stdin, stdout, ...opts });

  for (const req of requests) {
    stdin.write(JSON.stringify(req) + '\n');
  }
  stdin.end();

  await serverDone;
  const raw = Buffer.concat(stdoutChunks).toString('utf8');
  const lines = raw.split('\n').filter(Boolean);
  return { raw, lines, messages: lines.map((l) => JSON.parse(l)) };
}

function freshConfigDir() {
  return mkdtempSync(join(tmpdir(), 'ticketlens-mcp-'));
}

describe('mcp-server', () => {
  let configDir;
  beforeEach(() => { configDir = freshConfigDir(); });
  afterEach(() => { rmSync(configDir, { recursive: true, force: true }); });

  describe('stdout purity (protocol MUST — spec: server MUST NOT write anything to stdout that is not a valid MCP message)', () => {
    it('every line written to stdout is valid JSON with a jsonrpc field, for a full mixed session', async () => {
      const { lines } = await drive(
        [
          { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
          { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
          { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'recall_add', arguments: { title: 'x', body: 'y' } } },
        ],
        { configDir },
      );
      assert.ok(lines.length >= 3, 'must have produced at least one response per request');
      for (const line of lines) {
        const parsed = JSON.parse(line); // throws (test fails) if any line isn't valid JSON
        assert.equal(parsed.jsonrpc, '2.0');
      }
    });
  });

  describe('initialize', () => {
    it('returns protocolVersion, capabilities.tools, and serverInfo', async () => {
      const { messages } = await drive([{ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }], { configDir });
      const [msg] = messages;
      assert.equal(msg.id, 1);
      assert.equal(typeof msg.result.protocolVersion, 'string');
      assert.ok(msg.result.capabilities.tools, 'must advertise tools capability');
      assert.equal(typeof msg.result.serverInfo.name, 'string');
      assert.equal(typeof msg.result.serverInfo.version, 'string');
    });
  });

  describe('tools/list', () => {
    it('returns exactly fetch, recall_add, recall_search, ticket_comment, ticket_transition with valid JSON Schema params', async () => {
      const { messages } = await drive([{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }], { configDir });
      const names = messages[0].result.tools.map((t) => t.name).sort();
      assert.deepEqual(names, ['compliance', 'doctor', 'fetch', 'recall_add', 'recall_search', 'ticket_assign', 'ticket_comment', 'ticket_create', 'ticket_duplicates', 'ticket_link', 'ticket_transition', 'ticket_update', 'triage']);
      for (const tool of messages[0].result.tools) {
        assert.equal(tool.inputSchema.type, 'object');
        assert.ok(tool.inputSchema.properties, `${tool.name} must declare input properties`);
      }
    });

    it('L-8: ticket_update\'s description states the "at least one field required" precondition, matching the CLI help — previously only the CLI stated it', async () => {
      const { messages } = await drive([{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }], { configDir });
      const ticketUpdate = messages[0].result.tools.find((t) => t.name === 'ticket_update');
      assert.match(ticketUpdate.description, /at least one field is required/i);
    });

    it('recall_add\'s tags property guides the caller toward content-specific tags, not generic project/category labels', async () => {
      const { messages } = await drive([{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }], { configDir });
      const recallAdd = messages[0].result.tools.find((t) => t.name === 'recall_add');
      const tagsDesc = recallAdd.inputSchema.properties.tags.description;
      assert.ok(tagsDesc.length > 'Optional tags.'.length, 'must be more than a bare placeholder description');
      assert.match(tagsDesc, /content|body|specific/i);
    });

    it('L-12: recall_add\'s tags property also warns against tags that just restate the title or aren\'t traceable to the body', async () => {
      const { messages } = await drive([{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }], { configDir });
      const recallAdd = messages[0].result.tools.find((t) => t.name === 'recall_add');
      const tagsDesc = recallAdd.inputSchema.properties.tags.description;
      assert.match(tagsDesc, /restates? the title/i);
    });

    it('ticket_duplicates warns an empty result can be a false negative, not just that matches can be imprecise (M-11)', async () => {
      const { messages } = await drive([{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }], { configDir });
      const dup = messages[0].result.tools.find((t) => t.name === 'ticket_duplicates');
      assert.match(dup.description, /miss|not a guarantee/i);
    });
  });

  describe('tools/call fetch', () => {
    it('happy path: forwards ticket/profile/depth and returns a non-error result with the brief, without touching real stdout', async () => {
      let seen;
      const runFetchTicketFn = async (cmdArgs, opts) => {
        seen = cmdArgs;
        opts.print('PROJ-1: Login broken\n\nSteps to reproduce...\n');
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fetch', arguments: { ticket: 'PROJ-1', profile: 'work', depth: 2 } } }],
        { configDir, runFetchTicketFn },
      );
      assert.equal(messages[0].result.isError, undefined);
      assert.ok(messages[0].result.content[0].text.includes('Login broken'));
      assert.deepEqual(seen, ['PROJ-1', '--profile=work', '--depth=2']);
    });

    it('omits --profile and --depth when not given', async () => {
      let seen;
      const runFetchTicketFn = async (cmdArgs, opts) => {
        seen = cmdArgs;
        opts.print('brief\n');
      };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fetch', arguments: { ticket: 'PROJ-1' } } }],
        { configDir, runFetchTicketFn },
      );
      assert.deepEqual(seen, ['PROJ-1']);
    });

    it('missing ticket returns a JSON-RPC tool error without ever calling the real function', async () => {
      let called = false;
      const runFetchTicketFn = async () => { called = true; };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fetch', arguments: {} } }],
        { configDir, runFetchTicketFn },
      );
      assert.equal(called, false);
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /ticket/i);
    });

    it('a failure (print never receives the brief) maps to a JSON-RPC tool error carrying the printErr message', async () => {
      const runFetchTicketFn = async (cmdArgs, opts) => {
        opts.printErr('Error: "BAD" is not a valid ticket key. Expected format: PROJ-123\n');
        // print is never called — this is the real function's actual failure contract.
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fetch', arguments: { ticket: 'BAD' } } }],
        { configDir, runFetchTicketFn },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /not a valid ticket key/);
    });

    it('regression guard: informational printErr chatter alongside a real brief must NOT be misread as failure — runFetchTicket writes cache-hit/download-progress notices via printErr on every successful call, not just failures', async () => {
      const runFetchTicketFn = async (cmdArgs, opts) => {
        opts.printErr('  ○ PROJ-1 · from cache (2m)  ·  --no-cache to refresh\n\n');
        opts.printErr('Downloading 1 attachment…\n  ✓ 1 downloaded\n\n');
        opts.print('PROJ-1: Login broken\n\nSteps to reproduce...\n');
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'fetch', arguments: { ticket: 'PROJ-1' } } }],
        { configDir, runFetchTicketFn },
      );
      assert.equal(messages[0].result.isError, undefined);
      assert.ok(messages[0].result.content[0].text.includes('Login broken'));
    });
  });

  describe('tools/call compliance', () => {
    it('happy path: forwards ticket/profile as a compliance dispatch and returns a non-error result with the report, without touching real stdout', async () => {
      let seen;
      const runFetchTicketFn = async (cmdArgs, opts) => {
        seen = cmdArgs;
        opts.print('  Compliance Check — PROJ-1\n  Coverage: 90%\n');
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'compliance', arguments: { ticket: 'PROJ-1', profile: 'work' } } }],
        { configDir, runFetchTicketFn },
      );
      assert.equal(messages[0].result.isError, undefined);
      assert.ok(messages[0].result.content[0].text.includes('Coverage: 90%'));
      assert.deepEqual(seen, ['compliance', 'PROJ-1', '--profile=work']);
    });

    it('omits --profile when not given', async () => {
      let seen;
      const runFetchTicketFn = async (cmdArgs, opts) => {
        seen = cmdArgs;
        opts.print('report\n');
      };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'compliance', arguments: { ticket: 'PROJ-1' } } }],
        { configDir, runFetchTicketFn },
      );
      assert.deepEqual(seen, ['compliance', 'PROJ-1']);
    });

    it('missing ticket returns a JSON-RPC tool error without ever calling the real function', async () => {
      let called = false;
      const runFetchTicketFn = async () => { called = true; };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'compliance', arguments: {} } }],
        { configDir, runFetchTicketFn },
      );
      assert.equal(called, false);
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /ticket/i);
    });

    it('a failure (print never receives the report) maps to a JSON-RPC tool error carrying the printErr message', async () => {
      const runFetchTicketFn = async (cmdArgs, opts) => {
        opts.printErr('Error: No Jira credentials found. Run \'ticketlens init\' or set JIRA_BASE_URL + JIRA_API_TOKEN.\n');
        // print is never called — this is the real function's actual failure contract.
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'compliance', arguments: { ticket: 'PROJ-1' } } }],
        { configDir, runFetchTicketFn },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /No Jira credentials/);
    });

    it('a below-threshold coverage report is still a successful tool call — the CLI signals fail/pass via process.exitCode, which this tool never reads; the report content itself is what tells the caller coverage is low', async () => {
      const runFetchTicketFn = async (cmdArgs, opts) => {
        opts.print('  Compliance Check — PROJ-1\n  Coverage: 40%\n  Missing: error handling, retry logic\n');
        process.exitCode = 1; // real dispatch sets this on below-threshold; the MCP wrapper must not read it
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'compliance', arguments: { ticket: 'PROJ-1' } } }],
        { configDir, runFetchTicketFn },
      );
      process.exitCode = undefined;
      assert.equal(messages[0].result.isError, undefined);
      assert.ok(messages[0].result.content[0].text.includes('Coverage: 40%'));
    });

    it('the license/usage-gate case (no report printed) surfaces as isError with the upgrade-prompt text from printErr', async () => {
      const runFetchTicketFn = async (cmdArgs, opts) => {
        opts.printErr('  ◆ --compliance requires Pro\n  Upgrade: https://ticketlens.dev/upgrade\n');
        process.exitCode = 1;
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'compliance', arguments: { ticket: 'PROJ-1' } } }],
        { configDir, runFetchTicketFn },
      );
      process.exitCode = undefined;
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /requires Pro/);
    });
  });

  describe('tools/call triage', () => {
    it('happy path: forwards every field to CLI flags, always forcing --plain, and returns the summary', async () => {
      let seen;
      const runTriageFn = async (cmdArgs, opts) => {
        seen = cmdArgs;
        opts.print('3 tickets need attention\n');
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'triage', arguments: {
          profile: 'work', stale: 3, status: ['QA', 'Code Review'], sort: 'age',
          save: '/tmp/x.txt', all: true, digest: false,
          assignee: 'jane', sprint: 'Sprint 4', export: 'csv',
          project: 'PROJ', label: ['urgent', 'backend'], priority: 'High',
        } } }],
        { configDir, runTriageFn },
      );
      assert.equal(messages[0].result.isError, undefined);
      assert.ok(messages[0].result.content[0].text.includes('3 tickets need attention'));
      assert.deepEqual(seen, [
        '--plain', '--profile=work', '--stale=3', '--status=QA,Code Review', '--sort=age',
        '--save=/tmp/x.txt', '--all', '--assignee=jane', '--sprint=Sprint 4', '--export=csv',
        '--project=PROJ', '--label=urgent,backend', '--priority=High',
      ]);
    });

    it('omits every optional flag when not given, forwarding only --plain', async () => {
      let seen;
      const runTriageFn = async (cmdArgs, opts) => {
        seen = cmdArgs;
        opts.print('All clear\n');
      };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'triage', arguments: {} } }],
        { configDir, runTriageFn },
      );
      assert.deepEqual(seen, ['--plain']);
    });

    it('a failure (print never receives a summary) maps to a JSON-RPC tool error carrying the stream message', async () => {
      const runTriageFn = async (cmdArgs, opts) => {
        opts.stream.write('Error: Could not determine Jira profile.\n');
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'triage', arguments: {} } }],
        { configDir, runTriageFn },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /Could not determine Jira profile/);
    });

    it('a failure with nothing captured anywhere falls back to a generic error, never a false success', async () => {
      const runTriageFn = async () => {};
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'triage', arguments: {} } }],
        { configDir, runTriageFn },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /triage failed/);
    });

    it('a thrown error (e.g. from the digest deliverer) is caught and returned as a JSON-RPC tool error, not an internal error', async () => {
      const runTriageFn = async () => { throw new Error('Digest delivery failed: 503'); };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'triage', arguments: { digest: true } } }],
        { configDir, runTriageFn },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /Digest delivery failed/);
      assert.equal(messages[0].error, undefined, 'must be a normal tool result, not a JSON-RPC protocol-level error');
    });

    it('regression guard: --digest succeeds silently on stdout by design — empty print must NOT be misread as failure', async () => {
      const runTriageFn = async () => {
        // Real digest behavior: delivers to the backend, calls neither print nor stream on success.
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'triage', arguments: { digest: true } } }],
        { configDir, runTriageFn },
      );
      assert.equal(messages[0].result.isError, undefined);
      assert.match(messages[0].result.content[0].text, /Digest delivered/);
    });

    it('a --digest gate rejection (captured in stream, not print) still maps to isError, unlike the silent-success case', async () => {
      const runTriageFn = async (cmdArgs, opts) => {
        opts.stream.write('  ◆ --digest requires Pro\n');
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'triage', arguments: { digest: true } } }],
        { configDir, runTriageFn },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /--digest requires Pro/);
    });
  });

  describe('tools/call recall_add', () => {
    it('happy path: writes a note and returns a non-error result without touching real stdout', async () => {
      let written;
      const runNoteAddFn = async (cmdArgs, opts) => {
        written = { cmdArgs, opts };
        opts.stream.write('  Saved note "x" (fake-id.md)\n');
        return { written: true };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'recall_add', arguments: { title: 'A gotcha', ticket: 'PROJ-1', tags: ['a', 'b'], body: 'Body text.' } } }],
        { configDir, runNoteAddFn },
      );
      assert.equal(messages[0].result.isError, undefined);
      assert.ok(messages[0].result.content[0].text.includes('Saved note'));
      assert.ok(written.cmdArgs.includes('--title=A gotcha'));
      assert.ok(written.cmdArgs.includes('--ticket=PROJ-1'));
      assert.ok(written.cmdArgs.includes('--tags=a,b'));
    });

    it('unlicensed account: returns a JSON-RPC error result, not a thrown exception or success shape', async () => {
      const runNoteAddFn = async (cmdArgs, opts) => {
        opts.stream.write('Run `ticketlens activate` to unlock note add.\n');
        return { written: false };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'recall_add', arguments: { title: 'x', body: 'y' } } }],
        { configDir, runNoteAddFn },
      );
      assert.equal(messages[0].result.isError, true);
      assert.equal(messages[0].error, undefined, 'must be a tool-result error (isError), not a transport-level JSON-RPC error');
    });

    it('missing title returns a JSON-RPC tool error instead of saving a note titled the literal string "undefined"', async () => {
      let calledRealFn = false;
      const runNoteAddFn = async () => { calledRealFn = true; return { written: true }; };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'recall_add', arguments: { body: 'y' } } }],
        { configDir, runNoteAddFn },
      );
      assert.equal(calledRealFn, false, 'must reject before ever calling runNoteAdd — no "--title=undefined" may reach it');
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /title/i);
    });

    it('never falls through to defaultReadStdin — body comes from the tool call arguments only', async () => {
      let readStdinFnSeen;
      const runNoteAddFn = async (cmdArgs, opts) => {
        readStdinFnSeen = opts.readStdin;
        const body = await opts.readStdin();
        opts.stream.write(`got:${body}\n`);
        return { written: true };
      };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'recall_add', arguments: { title: 'x', body: 'exact body' } } }],
        { configDir, runNoteAddFn },
      );
      assert.equal(typeof readStdinFnSeen, 'function');
      assert.equal(await readStdinFnSeen(), 'exact body');
    });

    it('flag-shaped text in title cannot forge a second flag (--ticket=EVIL-999 stays literal)', async () => {
      let seenArgs;
      const runNoteAddFn = async (cmdArgs) => { seenArgs = cmdArgs; return { written: true }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'recall_add', arguments: { title: '--ticket=EVIL-999', body: 'y' } } }],
        { configDir, runNoteAddFn },
      );
      assert.equal(seenArgs.length, 1, 'the forged flag must not become a second array element');
      assert.equal(seenArgs[0], '--title=--ticket=EVIL-999');
    });
  });

  describe('tools/call doctor', () => {
    it('always requests JSON internally and returns the parsed report as text content', async () => {
      const runDoctorFn = async (args, opts) => {
        assert.ok(args.includes('--format=json'));
        opts.stream.write(JSON.stringify({ schemaVersion: 1, ok: true, checks: [], fixed: [], skipped: [] }));
        return { ok: true };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'doctor', arguments: {} } }],
        { configDir, runDoctorFn },
      );
      const result = messages[0].result;
      assert.equal(result.isError, undefined);
      const parsed = JSON.parse(result.content[0].text);
      assert.equal(parsed.ok, true);
    });

    it('passes fix:true through as --fix', async () => {
      let capturedArgs;
      const runDoctorFn = async (args, opts) => {
        capturedArgs = args;
        opts.stream.write('{}');
        return { ok: true };
      };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'doctor', arguments: { fix: true } } }],
        { configDir, runDoctorFn },
      );
      assert.ok(capturedArgs.includes('--fix'));
    });

    it('passes profile through as --profile=NAME', async () => {
      let capturedArgs;
      const runDoctorFn = async (args, opts) => {
        capturedArgs = args;
        opts.stream.write('{}');
        return { ok: true };
      };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'doctor', arguments: { profile: 'acme' } } }],
        { configDir, runDoctorFn },
      );
      assert.ok(capturedArgs.includes('--profile=acme'));
    });

    it('returns isError:false even when the report itself has ok:false — a diagnostic report is not a tool-call failure', async () => {
      const runDoctorFn = async (args, opts) => {
        opts.stream.write(JSON.stringify({ schemaVersion: 1, ok: false, checks: [], fixed: [], skipped: [] }));
        return { ok: false };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'doctor', arguments: {} } }],
        { configDir, runDoctorFn },
      );
      assert.equal(messages[0].result.isError, undefined);
    });

    it('with the REAL runDoctor (no stub), the report is fully captured as tool text content — nothing leaks past the capture and corrupts the JSON-RPC stdout channel', async () => {
      // runDoctor writes its final report to an `out` dependency (defaulting to
      // process.stdout) separately from `stream` (defaulting to process.stderr,
      // used only for --fix progress chatter). callDoctor MUST capture both into
      // the same buffer, or the real report would bypass the capture entirely —
      // this exercises the actual doctor-command.mjs, not a stub, to prove it.
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'doctor', arguments: {} } }],
        { configDir }, // no runDoctorFn override — uses the real runDoctor
      );
      assert.equal(messages.length, 1, 'exactly one JSON-RPC message on stdout — no leaked doctor output alongside it');
      const parsed = JSON.parse(messages[0].result.content[0].text);
      assert.equal(parsed.schemaVersion, 1);
      assert.equal(typeof parsed.ok, 'boolean');
    });
  });

  describe('tools/call recall_search', () => {
    it('happy path: returns search output without touching real stdout', async () => {
      const runRecallFn = async (cmdArgs, opts) => {
        opts.stream.write('1 result found.\n');
        return { ok: true };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'recall_search', arguments: { query: 'PROJ-1' } } }],
        { configDir, runRecallFn },
      );
      assert.equal(messages[0].result.isError, undefined);
      assert.ok(messages[0].result.content[0].text.includes('1 result found'));
    });

    it('unlicensed account: {ok:false} maps to a JSON-RPC tool error, not a success-shaped empty response', async () => {
      const runRecallFn = async (cmdArgs, opts) => {
        opts.errorStream.write('Run `ticketlens activate` to unlock recall.\n');
        return { ok: false };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'recall_search', arguments: { query: 'x' } } }],
        { configDir, runRecallFn },
      );
      assert.equal(messages[0].result.isError, true);
      assert.ok(messages[0].result.content[0].text.length > 0, 'must surface why it failed, not an empty error');
    });
  });

  describe('tools/call ticket_comment', () => {
    it('happy path: posts a comment and returns a non-error result without touching real stdout', async () => {
      let seen;
      const runTicketCommentFn = async (cmdArgs, opts) => {
        seen = { cmdArgs, opts };
        opts.stream.write('  Comment posted to PROJ-1\n');
        return { ok: true };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_comment', arguments: { ticket: 'PROJ-1', body: 'Looks good' } } }],
        { configDir, runTicketCommentFn },
      );
      assert.equal(messages[0].result.isError, undefined);
      assert.ok(messages[0].result.content[0].text.includes('Comment posted'));
      assert.deepEqual(seen.cmdArgs, ['PROJ-1', '--body=Looks good']);
    });

    it('missing ticket returns a JSON-RPC tool error without ever calling the real function', async () => {
      let called = false;
      const runTicketCommentFn = async () => { called = true; return { ok: true }; };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_comment', arguments: { body: 'y' } } }],
        { configDir, runTicketCommentFn },
      );
      assert.equal(called, false);
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /ticket/i);
    });

    it('missing body returns a JSON-RPC tool error without ever calling the real function', async () => {
      let called = false;
      const runTicketCommentFn = async () => { called = true; return { ok: true }; };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_comment', arguments: { ticket: 'PROJ-1' } } }],
        { configDir, runTicketCommentFn },
      );
      assert.equal(called, false);
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /body/i);
    });

    it('a body containing flag-shaped text cannot forge a second cmdArgs element', async () => {
      let seenArgs;
      const runTicketCommentFn = async (cmdArgs) => { seenArgs = cmdArgs; return { ok: true }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_comment', arguments: { ticket: 'PROJ-1', body: '--confirm --target=Done' } } }],
        { configDir, runTicketCommentFn },
      );
      assert.equal(seenArgs.length, 2);
      assert.equal(seenArgs[1], '--body=--confirm --target=Done');
    });

    it('a failed write ({ok:false}) maps to a JSON-RPC tool error', async () => {
      const runTicketCommentFn = async (cmdArgs, opts) => {
        opts.stream.write('  Failed to write to PROJ-1: boom\n');
        return { ok: false };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_comment', arguments: { ticket: 'PROJ-1', body: 'y' } } }],
        { configDir, runTicketCommentFn },
      );
      assert.equal(messages[0].result.isError, true);
    });

    it('threads a single attachments path through as --attach=', async () => {
      let seenArgs;
      const runTicketCommentFn = async (cmdArgs) => { seenArgs = cmdArgs; return { ok: true }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_comment', arguments: { ticket: 'PROJ-1', body: 'y', attachments: ['/tmp/shot.png'] } } }],
        { configDir, runTicketCommentFn },
      );
      assert.deepEqual(seenArgs, ['PROJ-1', '--body=y', '--attach=/tmp/shot.png']);
    });

    it('joins multiple attachments paths with a comma', async () => {
      let seenArgs;
      const runTicketCommentFn = async (cmdArgs) => { seenArgs = cmdArgs; return { ok: true }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_comment', arguments: { ticket: 'PROJ-1', body: 'y', attachments: ['/a.png', '/b.txt'] } } }],
        { configDir, runTicketCommentFn },
      );
      assert.deepEqual(seenArgs, ['PROJ-1', '--body=y', '--attach=/a.png,/b.txt']);
    });

    it('omits --attach entirely when attachments is not given — byte-identical to before this feature', async () => {
      let seenArgs;
      const runTicketCommentFn = async (cmdArgs) => { seenArgs = cmdArgs; return { ok: true }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_comment', arguments: { ticket: 'PROJ-1', body: 'y' } } }],
        { configDir, runTicketCommentFn },
      );
      assert.deepEqual(seenArgs, ['PROJ-1', '--body=y']);
    });
  });

  describe('tools/call ticket_transition', () => {
    it('no target dispatches to the read-only list function, never the executing one', async () => {
      let listCalled = false, executeCalled = false;
      const runTicketTransitionListFn = async (cmdArgs, opts) => {
        listCalled = true;
        opts.stream.write('  Valid transitions for PROJ-1:\n    - Done\n');
        return { ok: true, options: [{ id: '1', name: 'Done', to: 'Done' }] };
      };
      const runTicketTransitionFn = async () => { executeCalled = true; return { ok: true }; };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_transition', arguments: { ticket: 'PROJ-1' } } }],
        { configDir, runTicketTransitionListFn, runTicketTransitionFn },
      );
      assert.equal(listCalled, true);
      assert.equal(executeCalled, false);
      assert.equal(messages[0].result.isError, undefined);
      assert.ok(messages[0].result.content[0].text.includes('Done'));
    });

    it('target + confirm:true dispatches to the executing function with --confirm included', async () => {
      let seenArgs;
      const runTicketTransitionFn = async (cmdArgs, opts) => {
        seenArgs = cmdArgs;
        opts.stream.write('  PROJ-1 transitioned to "Done".\n');
        return { ok: true };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_transition', arguments: { ticket: 'PROJ-1', target: 'Done', confirm: true } } }],
        { configDir, runTicketTransitionFn },
      );
      assert.deepEqual(seenArgs, ['PROJ-1', '--target=Done', '--confirm']);
      assert.equal(messages[0].result.isError, undefined);
    });

    it('target without confirm:true still dispatches to the executing function, which itself refuses (no pre-empting at the MCP layer)', async () => {
      let seenArgs;
      const runTicketTransitionFn = async (cmdArgs, opts) => {
        seenArgs = cmdArgs;
        opts.stream.write('  Refusing to transition PROJ-1 to "Done" without --confirm.\n');
        return { ok: false };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_transition', arguments: { ticket: 'PROJ-1', target: 'Done' } } }],
        { configDir, runTicketTransitionFn },
      );
      assert.deepEqual(seenArgs, ['PROJ-1', '--target=Done']);
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /confirm/i);
    });

    it('missing ticket returns a JSON-RPC tool error without calling either function', async () => {
      let listCalled = false, executeCalled = false;
      const runTicketTransitionListFn = async () => { listCalled = true; return { ok: true }; };
      const runTicketTransitionFn = async () => { executeCalled = true; return { ok: true }; };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_transition', arguments: { target: 'Done', confirm: true } } }],
        { configDir, runTicketTransitionListFn, runTicketTransitionFn },
      );
      assert.equal(listCalled, false);
      assert.equal(executeCalled, false);
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /ticket/i);
    });

    it('confirm:false (falsy, not strictly true) is not forwarded as --confirm', async () => {
      let seenArgs;
      const runTicketTransitionFn = async (cmdArgs) => { seenArgs = cmdArgs; return { ok: false }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_transition', arguments: { ticket: 'PROJ-1', target: 'Done', confirm: false } } }],
        { configDir, runTicketTransitionFn },
      );
      assert.deepEqual(seenArgs, ['PROJ-1', '--target=Done']);
    });

    it('list mode passes cliHints:false so the underlying function prints MCP-shaped hints, not CLI flags', async () => {
      let seenOpts;
      const runTicketTransitionListFn = async (cmdArgs, opts) => { seenOpts = opts; return { ok: true, options: [] }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_transition', arguments: { ticket: 'PROJ-1' } } }],
        { configDir, runTicketTransitionListFn },
      );
      assert.equal(seenOpts.cliHints, false);
    });

    it('execute mode passes cliHints:false so a refusal is worded for the MCP caller, not a CLI user', async () => {
      let seenOpts;
      const runTicketTransitionFn = async (cmdArgs, opts) => { seenOpts = opts; return { ok: false }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_transition', arguments: { ticket: 'PROJ-1', target: 'Done' } } }],
        { configDir, runTicketTransitionFn },
      );
      assert.equal(seenOpts.cliHints, false);
    });
  });

  describe('tools/call ticket_assign', () => {
    it('happy path: assigns and returns a non-error result without touching real stdout', async () => {
      let seen;
      const runTicketAssignFn = async (cmdArgs, opts) => {
        seen = cmdArgs;
        opts.stream.write('  PROJ-1 assigned to Ralph Moran.\n');
        return { ok: true };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_assign', arguments: { ticket: 'PROJ-1', to: 'me' } } }],
        { configDir, runTicketAssignFn },
      );
      assert.equal(messages[0].result.isError, undefined);
      assert.ok(messages[0].result.content[0].text.includes('assigned to Ralph Moran'));
      assert.deepEqual(seen, ['PROJ-1', '--to=me']);
    });

    it('missing ticket returns a JSON-RPC tool error without ever calling the real function', async () => {
      let called = false;
      const runTicketAssignFn = async () => { called = true; return { ok: true }; };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_assign', arguments: { to: 'me' } } }],
        { configDir, runTicketAssignFn },
      );
      assert.equal(called, false);
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /ticket/i);
    });

    it('missing to returns a JSON-RPC tool error without ever calling the real function', async () => {
      let called = false;
      const runTicketAssignFn = async () => { called = true; return { ok: true }; };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_assign', arguments: { ticket: 'PROJ-1' } } }],
        { configDir, runTicketAssignFn },
      );
      assert.equal(called, false);
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /to/i);
    });

    it('a failed assign ({ok:false}) maps to a JSON-RPC tool error', async () => {
      const runTicketAssignFn = async (cmdArgs, opts) => {
        opts.stream.write('  Failed to write to PROJ-1: boom\n');
        return { ok: false };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_assign', arguments: { ticket: 'PROJ-1', to: 'me' } } }],
        { configDir, runTicketAssignFn },
      );
      assert.equal(messages[0].result.isError, true);
    });
  });

  describe('tools/call ticket_duplicates', () => {
    it('happy path: returns a non-error result with the threshold forwarded, without touching real stdout', async () => {
      let seen;
      const runTicketDuplicatesFn = async (cmdArgs, opts) => {
        seen = cmdArgs;
        opts.stream.write('  Possible duplicates of PROJ-1:\n    PROJ-9 (80% match) — Login broken\n');
        return { ok: true, results: [{ key: 'PROJ-9', summary: 'Login broken', score: 0.8 }] };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_duplicates', arguments: { ticket: 'PROJ-1', threshold: 0.5 } } }],
        { configDir, runTicketDuplicatesFn },
      );
      assert.equal(messages[0].result.isError, undefined);
      assert.ok(messages[0].result.content[0].text.includes('PROJ-9'));
      assert.deepEqual(seen, ['PROJ-1', '--threshold=0.5']);
    });

    it('omits --threshold when not given', async () => {
      let seen;
      const runTicketDuplicatesFn = async (cmdArgs, opts) => {
        seen = cmdArgs;
        opts.stream.write('  No likely duplicates found for PROJ-1.\n');
        return { ok: true, results: [] };
      };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_duplicates', arguments: { ticket: 'PROJ-1' } } }],
        { configDir, runTicketDuplicatesFn },
      );
      assert.deepEqual(seen, ['PROJ-1']);
    });

    it('missing ticket returns a JSON-RPC tool error without ever calling the real function', async () => {
      let called = false;
      const runTicketDuplicatesFn = async () => { called = true; return { ok: true, results: [] }; };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_duplicates', arguments: {} } }],
        { configDir, runTicketDuplicatesFn },
      );
      assert.equal(called, false);
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /ticket/i);
    });

    it('a failed search ({ok:false}) maps to a JSON-RPC tool error', async () => {
      const runTicketDuplicatesFn = async (cmdArgs, opts) => {
        opts.stream.write('  Error checking PROJ-1 for duplicates: boom\n');
        return { ok: false };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_duplicates', arguments: { ticket: 'PROJ-1' } } }],
        { configDir, runTicketDuplicatesFn },
      );
      assert.equal(messages[0].result.isError, true);
    });
  });

  describe('tools/call ticket_link', () => {
    it('no type dispatches to the read-only list function, never the executing one', async () => {
      let listCalled = false, executeCalled = false;
      const runTicketLinkListFn = async (cmdArgs, opts) => {
        listCalled = true;
        opts.stream.write('  Available link types for PROJ-1 → PROJ-2 (jira):\n    - Duplicate\n');
        return { ok: true, types: ['Duplicate'] };
      };
      const runTicketLinkFn = async () => { executeCalled = true; return { ok: true }; };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_link', arguments: { ticket: 'PROJ-1', target: 'PROJ-2' } } }],
        { configDir, runTicketLinkListFn, runTicketLinkFn },
      );
      assert.equal(listCalled, true);
      assert.equal(executeCalled, false);
      assert.equal(messages[0].result.isError, undefined);
      assert.ok(messages[0].result.content[0].text.includes('Duplicate'));
    });

    it('type + confirm:true dispatches to the executing function with --type and --confirm included', async () => {
      let seenArgs;
      const runTicketLinkFn = async (cmdArgs, opts) => {
        seenArgs = cmdArgs;
        opts.stream.write('  PROJ-1 linked to PROJ-2 as "Duplicate".\n');
        return { ok: true };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_link', arguments: { ticket: 'PROJ-1', target: 'PROJ-2', type: 'Duplicate', confirm: true } } }],
        { configDir, runTicketLinkFn },
      );
      assert.deepEqual(seenArgs, ['PROJ-1', 'PROJ-2', '--type=Duplicate', '--confirm']);
      assert.equal(messages[0].result.isError, undefined);
    });

    it('type without confirm:true still dispatches to the executing function, which itself refuses (no pre-empting at the MCP layer)', async () => {
      let seenArgs;
      const runTicketLinkFn = async (cmdArgs, opts) => {
        seenArgs = cmdArgs;
        opts.stream.write('  Refusing to link PROJ-1 to PROJ-2 as "Duplicate" without --confirm.\n');
        return { ok: false };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_link', arguments: { ticket: 'PROJ-1', target: 'PROJ-2', type: 'Duplicate' } } }],
        { configDir, runTicketLinkFn },
      );
      assert.deepEqual(seenArgs, ['PROJ-1', 'PROJ-2', '--type=Duplicate']);
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /confirm/i);
    });

    it('missing ticket returns a JSON-RPC tool error without calling either function', async () => {
      let listCalled = false, executeCalled = false;
      const runTicketLinkListFn = async () => { listCalled = true; return { ok: true }; };
      const runTicketLinkFn = async () => { executeCalled = true; return { ok: true }; };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_link', arguments: { target: 'PROJ-2' } } }],
        { configDir, runTicketLinkListFn, runTicketLinkFn },
      );
      assert.equal(listCalled, false);
      assert.equal(executeCalled, false);
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /ticket/i);
    });

    it('missing target returns a JSON-RPC tool error without calling either function', async () => {
      let listCalled = false, executeCalled = false;
      const runTicketLinkListFn = async () => { listCalled = true; return { ok: true }; };
      const runTicketLinkFn = async () => { executeCalled = true; return { ok: true }; };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_link', arguments: { ticket: 'PROJ-1' } } }],
        { configDir, runTicketLinkListFn, runTicketLinkFn },
      );
      assert.equal(listCalled, false);
      assert.equal(executeCalled, false);
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /target/i);
    });

    it('confirm:false (falsy, not strictly true) is not forwarded as --confirm', async () => {
      let seenArgs;
      const runTicketLinkFn = async (cmdArgs) => { seenArgs = cmdArgs; return { ok: false }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_link', arguments: { ticket: 'PROJ-1', target: 'PROJ-2', type: 'Duplicate', confirm: false } } }],
        { configDir, runTicketLinkFn },
      );
      assert.deepEqual(seenArgs, ['PROJ-1', 'PROJ-2', '--type=Duplicate']);
    });

    it('list mode passes cliHints:false so the underlying function prints MCP-shaped hints, not CLI flags', async () => {
      let seenOpts;
      const runTicketLinkListFn = async (cmdArgs, opts) => { seenOpts = opts; return { ok: true, types: [] }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_link', arguments: { ticket: 'PROJ-1', target: 'PROJ-2' } } }],
        { configDir, runTicketLinkListFn },
      );
      assert.equal(seenOpts.cliHints, false);
    });

    it('execute mode passes cliHints:false so a refusal is worded for the MCP caller, not a CLI user', async () => {
      let seenOpts;
      const runTicketLinkFn = async (cmdArgs, opts) => { seenOpts = opts; return { ok: false }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_link', arguments: { ticket: 'PROJ-1', target: 'PROJ-2', type: 'Duplicate' } } }],
        { configDir, runTicketLinkFn },
      );
      assert.equal(seenOpts.cliHints, false);
    });
  });

  describe('tools/call ticket_update', () => {
    it('builds cmdArgs from title/description/priority/addLabels/removeLabels — each a single opaque array element', async () => {
      let seenArgs;
      const runTicketUpdateFn = async (cmdArgs, opts) => {
        seenArgs = cmdArgs;
        opts.stream.write('  PROJ-1 updated: title.\n');
        return { ok: true };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_update', arguments: { ticket: 'PROJ-1', title: 'New title', description: 'New desc', priority: 'High', addLabels: ['urgent', 'backend'], removeLabels: ['stale'] } } }],
        { configDir, runTicketUpdateFn },
      );
      assert.deepEqual(seenArgs, ['PROJ-1', '--title=New title', '--description=New desc', '--priority=High', '--add-labels=urgent,backend', '--remove-labels=stale']);
      assert.equal(messages[0].result.isError, undefined);
    });

    it('omits flags for fields not given — no --title=undefined leaking through', async () => {
      let seenArgs;
      const runTicketUpdateFn = async (cmdArgs) => { seenArgs = cmdArgs; return { ok: true }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_update', arguments: { ticket: 'PROJ-1', title: 'Only this' } } }],
        { configDir, runTicketUpdateFn },
      );
      assert.deepEqual(seenArgs, ['PROJ-1', '--title=Only this']);
    });

    it('missing ticket returns a JSON-RPC tool error without calling runTicketUpdateFn', async () => {
      let called = false;
      const runTicketUpdateFn = async () => { called = true; return { ok: true }; };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_update', arguments: { title: 'x' } } }],
        { configDir, runTicketUpdateFn },
      );
      assert.equal(called, false);
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /ticket/i);
    });

    it('a partial-failure result (ok:false with some fields applied) is still surfaced as an MCP tool error, not silently ok', async () => {
      const runTicketUpdateFn = async (cmdArgs, opts) => {
        opts.stream.write('  PROJ-1 partially updated: title. Failed: addLabels (not found: bogus).\n');
        return { ok: false, applied: { title: true }, errors: { addLabels: { reason: 'not-found', missing: ['bogus'] } } };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_update', arguments: { ticket: 'PROJ-1', title: 'x', addLabels: ['bogus'] } } }],
        { configDir, runTicketUpdateFn },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /partially updated/);
    });
  });

  describe('tools/call ticket_create', () => {
    it('builds cmdArgs from project/type/summary/description — each a single opaque array element', async () => {
      let seenArgs;
      const runTicketCreateFn = async (cmdArgs, opts) => {
        seenArgs = cmdArgs;
        opts.stream.write('  Created PROJ-99 (https://example/PROJ-99)\n');
        return { ok: true, key: 'PROJ-99' };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_create', arguments: { project: 'PROJ', type: 'Task', summary: 'New title', description: 'New desc' } } }],
        { configDir, runTicketCreateFn },
      );
      assert.deepEqual(seenArgs, ['--project=PROJ', '--type=Task', '--summary=New title', '--description=New desc']);
      assert.equal(messages[0].result.isError, undefined);
    });

    it('omits flags for fields not given — no --project=undefined leaking through', async () => {
      let seenArgs;
      const runTicketCreateFn = async (cmdArgs) => { seenArgs = cmdArgs; return { ok: true, key: 'GH-1' }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_create', arguments: { summary: 'Only this' } } }],
        { configDir, runTicketCreateFn },
      );
      assert.deepEqual(seenArgs, ['--summary=Only this']);
    });

    it('threads attachments through as a comma-joined --attach=, appended last', async () => {
      let seenArgs;
      const runTicketCreateFn = async (cmdArgs) => { seenArgs = cmdArgs; return { ok: true, key: 'PROJ-99' }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_create', arguments: { project: 'PROJ', type: 'Task', summary: 'New', attachments: ['/a.png', '/b.png'] } } }],
        { configDir, runTicketCreateFn },
      );
      assert.deepEqual(seenArgs, ['--project=PROJ', '--type=Task', '--summary=New', '--attach=/a.png,/b.png']);
    });

    it('omits --attach entirely when attachments is not given — byte-identical to before this feature', async () => {
      let seenArgs;
      const runTicketCreateFn = async (cmdArgs) => { seenArgs = cmdArgs; return { ok: true, key: 'PROJ-99' }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_create', arguments: { project: 'PROJ', type: 'Task', summary: 'New' } } }],
        { configDir, runTicketCreateFn },
      );
      assert.deepEqual(seenArgs, ['--project=PROJ', '--type=Task', '--summary=New']);
    });

    it('passes profile through as --profile=NAME, appended last', async () => {
      let seenArgs;
      const runTicketCreateFn = async (cmdArgs) => { seenArgs = cmdArgs; return { ok: true, key: 'PROJ-99' }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_create', arguments: { project: 'PROJ', type: 'Task', summary: 'New', profile: 'acme' } } }],
        { configDir, runTicketCreateFn },
      );
      assert.deepEqual(seenArgs, ['--project=PROJ', '--type=Task', '--summary=New', '--profile=acme']);
    });

    it('omits --profile entirely when not given — byte-identical to before this feature', async () => {
      let seenArgs;
      const runTicketCreateFn = async (cmdArgs) => { seenArgs = cmdArgs; return { ok: true, key: 'PROJ-99' }; };
      await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_create', arguments: { project: 'PROJ', type: 'Task', summary: 'New' } } }],
        { configDir, runTicketCreateFn },
      );
      assert.deepEqual(seenArgs, ['--project=PROJ', '--type=Task', '--summary=New']);
    });

    it('missing summary returns a JSON-RPC tool error without calling runTicketCreateFn', async () => {
      let called = false;
      const runTicketCreateFn = async () => { called = true; return { ok: true }; };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_create', arguments: { project: 'PROJ' } } }],
        { configDir, runTicketCreateFn },
      );
      assert.equal(called, false);
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /summary/i);
    });

    it('a failed result (ok:false, e.g. missing --project for Jira) is surfaced as an MCP tool error', async () => {
      const runTicketCreateFn = async (cmdArgs, opts) => {
        opts.stream.write('  --project is required for Jira (project key).\n');
        return { ok: false };
      };
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_create', arguments: { summary: 'x' } } }],
        { configDir, runTicketCreateFn },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /--project is required/);
    });
  });

  describe('malformed input survival', () => {
    it('a bad JSON-RPC line produces an error response and a following valid message still gets served', async () => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const chunks = [];
      stdout.on('data', (c) => chunks.push(c));
      const done = runMcpServer({ stdin, stdout, configDir });
      stdin.write('{"jsonrpc": not-json,,,\n');
      stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
      stdin.end();
      await done;
      const lines = Buffer.concat(chunks).toString('utf8').split('\n').filter(Boolean);
      const messages = lines.map((l) => JSON.parse(l));
      assert.equal(messages.length, 2, 'both the parse-error response and the valid tools/list response must appear');
      assert.ok(messages[0].error, 'first message must be a JSON-RPC error for the malformed line');
      assert.equal(messages[1].id, 2);
      assert.deepEqual(messages[1].result.tools.map((t) => t.name).sort(), ['compliance', 'doctor', 'fetch', 'recall_add', 'recall_search', 'ticket_assign', 'ticket_comment', 'ticket_create', 'ticket_duplicates', 'ticket_link', 'ticket_transition', 'ticket_update', 'triage']);
    });

    it('a syntactically-valid-but-non-object JSON line (e.g. bare "null") does not crash the server or drop later messages', async () => {
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const chunks = [];
      stdout.on('data', (c) => chunks.push(c));
      const done = runMcpServer({ stdin, stdout, configDir });
      stdin.write('null\n');
      stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
      stdin.end();
      await done; // must resolve, not hang or reject
      const lines = Buffer.concat(chunks).toString('utf8').split('\n').filter(Boolean);
      const messages = lines.map((l) => JSON.parse(l));
      assert.equal(messages.length, 2);
      assert.ok(messages[0].error, 'a non-object payload must produce a JSON-RPC error, not crash the process');
      assert.equal(messages[1].id, 2, 'the following valid message must still be served');
    });
  });

  describe('serialized dispatch (no unbounded concurrency)', () => {
    it('processes rapid-fire messages one at a time, in order — never more than one in flight', async () => {
      let inFlight = 0;
      let maxInFlight = 0;
      const order = [];
      const runRecallFn = async (cmdArgs, opts) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        order.push(cmdArgs[0]);
        inFlight--;
        opts.stream.write('ok\n');
        return { ok: true };
      };
      const requests = [1, 2, 3, 4].map((n) => ({
        jsonrpc: '2.0', id: n, method: 'tools/call', params: { name: 'recall_search', arguments: { query: `q${n}` } },
      }));
      await drive(requests, { configDir, runRecallFn });
      assert.equal(maxInFlight, 1, 'no more than one tools/call may be in flight at a time');
      assert.deepEqual(order, ['q1', 'q2', 'q3', 'q4'], 'must resolve in the order received');
    });
  });

  describe('unknown method', () => {
    it('returns a JSON-RPC error for an unrecognized method, not a crash', async () => {
      const { messages } = await drive([{ jsonrpc: '2.0', id: 1, method: 'not/a/real/method', params: {} }], { configDir });
      assert.ok(messages[0].error, 'unknown method must produce a JSON-RPC error response');
    });
  });

  describe('end-to-end against the real (unmocked) runNoteAdd/runRecall', () => {
    it('recall_add: unlicensed configDir is rejected by the real license gate and writes nothing to the vault', async () => {
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'recall_add', arguments: { title: 'x', body: 'y' } } }],
        { configDir },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /pro/i);
      assert.equal(existsSync(join(configDir, 'recall')), false, 'a rejected note must never touch the vault');
    });

    it('recall_search: unlicensed configDir is rejected by the real license gate', async () => {
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'recall_search', arguments: { query: 'x' } } }],
        { configDir },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /pro/i);
    });

    it('ticket_comment: unlicensed configDir is rejected by the real license gate, never reaching the network', async () => {
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_comment', arguments: { ticket: 'PROJ-1', body: 'y' } } }],
        { configDir },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /pro/i);
    });

    it('ticket_transition: unlicensed configDir is rejected by the real license gate (list mode)', async () => {
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_transition', arguments: { ticket: 'PROJ-1' } } }],
        { configDir },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /pro/i);
    });

    it('ticket_assign: unlicensed configDir is rejected by the real license gate, never reaching the network', async () => {
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_assign', arguments: { ticket: 'PROJ-1', to: 'me' } } }],
        { configDir },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /pro/i);
    });

    it('ticket_duplicates: unlicensed configDir is rejected by the real license gate, never reaching the network', async () => {
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_duplicates', arguments: { ticket: 'PROJ-1' } } }],
        { configDir },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /pro/i);
    });

    it('ticket_link: unlicensed configDir is rejected by the real license gate (list mode), never reaching the network', async () => {
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_link', arguments: { ticket: 'PROJ-1', target: 'PROJ-2' } } }],
        { configDir },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /pro/i);
    });

    it('ticket_update: unlicensed configDir is rejected by the real license gate, never reaching the network', async () => {
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_update', arguments: { ticket: 'PROJ-1', title: 'x' } } }],
        { configDir },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /pro/i);
    });

    it('ticket_create: unlicensed configDir is rejected by the real license gate, never reaching the network', async () => {
      const { messages } = await drive(
        [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'ticket_create', arguments: { project: 'PROJ', type: 'Task', summary: 'x' } } }],
        { configDir },
      );
      assert.equal(messages[0].result.isError, true);
      assert.match(messages[0].result.content[0].text, /pro/i);
    });
  });
});
