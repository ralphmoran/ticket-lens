import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { testMcpHandshake } from '../lib/mcp-handshake-checker.mjs';

function makeFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  const stdin = new EventEmitter();
  stdin.writes = [];
  stdin.write = function write(str) { this.writes.push(str); };
  child.stdin = stdin;
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

describe('testMcpHandshake', () => {
  it('resolves ok:true with the protocol version on a valid initialize response', async () => {
    let child;
    const spawnFn = () => { child = makeFakeChild(); return child; };
    const resultPromise = testMcpHandshake({ spawnFn, timeoutMs: 1000 });
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25', serverInfo: { name: 'ticketlens', version: '0.38.21' } },
    }) + '\n'));
    const result = await resultPromise;
    assert.deepEqual(result, { ok: true, protocolVersion: '2025-11-25' });
  });

  it('kills the child process after a successful handshake', async () => {
    let child;
    const spawnFn = () => { child = makeFakeChild(); return child; };
    const resultPromise = testMcpHandshake({ spawnFn, timeoutMs: 1000 });
    child.stdout.emit('data', Buffer.from(JSON.stringify({
      jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' },
    }) + '\n'));
    await resultPromise;
    assert.equal(child.killed, true);
  });

  it('writes a well-formed JSON-RPC initialize request to stdin', async () => {
    let child;
    const spawnFn = () => { child = makeFakeChild(); return child; };
    const resultPromise = testMcpHandshake({ spawnFn, timeoutMs: 1000 });
    assert.equal(child.stdin.writes.length, 1);
    const request = JSON.parse(child.stdin.writes[0]);
    assert.equal(request.jsonrpc, '2.0');
    assert.equal(request.id, 1);
    assert.equal(request.method, 'initialize');
    child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-11-25' } }) + '\n'));
    await resultPromise;
  });

  it('resolves ok:false reason:spawn-error when the child emits an error event (e.g. ENOENT)', async () => {
    let child;
    const spawnFn = () => { child = makeFakeChild(); return child; };
    const resultPromise = testMcpHandshake({ spawnFn, timeoutMs: 1000 });
    const enoent = Object.assign(new Error('spawn ticketlens ENOENT'), { code: 'ENOENT' });
    child.emit('error', enoent);
    const result = await resultPromise;
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'spawn-error');
    assert.equal(result.error, enoent);
  });

  it('resolves ok:false reason:spawn-error when spawnFn throws synchronously', async () => {
    const spawnFn = () => { throw new Error('boom'); };
    const result = await testMcpHandshake({ spawnFn, timeoutMs: 1000 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'spawn-error');
  });

  it('resolves ok:false reason:timeout when no response arrives before the deadline, and kills the child', async () => {
    let child;
    const spawnFn = () => { child = makeFakeChild(); return child; };
    const result = await testMcpHandshake({ spawnFn, timeoutMs: 20 });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'timeout');
    assert.equal(child.killed, true);
  });

  it('resolves ok:false reason:invalid-response when stdout emits a line that is not valid JSON', async () => {
    let child;
    const spawnFn = () => { child = makeFakeChild(); return child; };
    const resultPromise = testMcpHandshake({ spawnFn, timeoutMs: 1000 });
    child.stdout.emit('data', Buffer.from('not json at all\n'));
    const result = await resultPromise;
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-response');
  });

  it('resolves ok:false reason:invalid-response when the JSON-RPC response has no result.protocolVersion', async () => {
    let child;
    const spawnFn = () => { child = makeFakeChild(); return child; };
    const resultPromise = testMcpHandshake({ spawnFn, timeoutMs: 1000 });
    child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } }) + '\n'));
    const result = await resultPromise;
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-response');
  });

  it('resolves ok:false reason:invalid-response when the response id does not match the request id', async () => {
    let child;
    const spawnFn = () => { child = makeFakeChild(); return child; };
    const resultPromise = testMcpHandshake({ spawnFn, timeoutMs: 1000 });
    child.stdout.emit('data', Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 2, result: { protocolVersion: '2025-11-25' } }) + '\n'));
    const result = await resultPromise;
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'invalid-response');
  });
});
