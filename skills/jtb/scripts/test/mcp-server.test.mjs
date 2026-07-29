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
    it('returns exactly recall_add, recall_search, ticket_comment, ticket_transition with valid JSON Schema params', async () => {
      const { messages } = await drive([{ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }], { configDir });
      const names = messages[0].result.tools.map((t) => t.name).sort();
      assert.deepEqual(names, ['recall_add', 'recall_search', 'ticket_comment', 'ticket_transition']);
      for (const tool of messages[0].result.tools) {
        assert.equal(tool.inputSchema.type, 'object');
        assert.ok(tool.inputSchema.properties, `${tool.name} must declare input properties`);
      }
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
      assert.deepEqual(messages[1].result.tools.map((t) => t.name).sort(), ['recall_add', 'recall_search', 'ticket_comment', 'ticket_transition']);
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
  });
});
