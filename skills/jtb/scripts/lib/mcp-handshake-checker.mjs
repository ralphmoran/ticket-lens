/**
 * Spawns `ticketlens mcp` as a child process and speaks one round of the
 * MCP stdio JSON-RPC handshake to it — the same `initialize` request an AI
 * harness sends per the MCP stdio transport spec (see mcp-server.mjs's own
 * `initialize` handler). Pure diagnostic probe: the child is always killed
 * before this resolves, on every path (success, timeout, or error) — never
 * left running.
 */

import { spawn } from 'node:child_process';

export const DEFAULT_HANDSHAKE_TIMEOUT_MS = 5000;
const PROTOCOL_VERSION = '2025-11-25';

/**
 * @returns {Promise<{ok: boolean, reason?: 'spawn-error'|'timeout'|'invalid-response', error?: Error, protocolVersion?: string}>}
 */
export function testMcpHandshake({
  spawnFn = spawn,
  timeoutMs = DEFAULT_HANDSHAKE_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let buffer = '';
    let child;

    const settle = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child?.kill(); } catch { /* already exited */ }
      resolve(value);
    };

    const timer = setTimeout(() => settle({ ok: false, reason: 'timeout' }), timeoutMs);

    try {
      child = spawnFn('ticketlens', ['mcp'], { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      settle({ ok: false, reason: 'spawn-error', error });
      return;
    }

    child.on('error', (error) => settle({ ok: false, reason: 'spawn-error', error }));
    // A write can fail asynchronously (e.g. EPIPE if the child already died) —
    // an unhandled 'error' on a Writable stream crashes the process. The
    // child's own 'error'/'exit' already attributes the real failure reason;
    // this only needs to stop the crash, not settle a second time.
    child.stdin.on('error', () => {});

    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx === -1) return;
      const line = buffer.slice(0, newlineIdx);
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        settle({ ok: false, reason: 'invalid-response' });
        return;
      }
      if (msg?.id === 1 && msg.result?.protocolVersion) {
        settle({ ok: true, protocolVersion: msg.result.protocolVersion });
      } else {
        settle({ ok: false, reason: 'invalid-response' });
      }
    });

    const request = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'ticketlens-doctor', version: '1.0' },
      },
    }) + '\n';
    child.stdin.write(request);
  });
}
