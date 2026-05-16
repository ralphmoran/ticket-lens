import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateState, pickPort, startLocalServer } from '../lib/browser-login.mjs';

// ── generateState ──────────────────────────────────────────────────────────

describe('generateState', () => {
  it('returns a 32-character hex string', () => {
    const state = generateState();
    assert.match(state, /^[0-9a-f]{32}$/);
  });

  it('returns unique values on each call', () => {
    const states = new Set(Array.from({ length: 20 }, generateState));
    assert.equal(states.size, 20);
  });
});

// ── pickPort ───────────────────────────────────────────────────────────────

describe('pickPort', () => {
  it('returns a number in the ephemeral range', () => {
    for (let i = 0; i < 50; i++) {
      const port = pickPort();
      assert.ok(port >= 49152 && port <= 65535, `port ${port} out of range`);
    }
  });

  it('returns integer values', () => {
    assert.equal(pickPort() % 1, 0);
  });
});

// ── startLocalServer ───────────────────────────────────────────────────────

describe('startLocalServer', () => {
  // Pick an OS-assigned port to avoid conflicts in CI
  const getTestPort = () => new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on('error', reject);
  });

  it('resolves with the token when state matches', async () => {
    const port  = await getTestPort();
    const state = generateState();

    const tokenPromise = startLocalServer(port, state, 5000);

    // Simulate the backend redirect arriving at the CLI server
    await fetch(`http://127.0.0.1:${port}/callback?token=tl_testtoken1234567890abcdefghijk&state=${state}`);

    const token = await tokenPromise;
    assert.equal(token, 'tl_testtoken1234567890abcdefghijk');
  });

  it('rejects when state does not match', async () => {
    const port  = await getTestPort();
    const state = generateState();

    const tokenPromise = startLocalServer(port, state, 5000);
    // Attach handler before triggering rejection to avoid unhandledRejection warning
    const assertion = assert.rejects(tokenPromise, /state mismatch/i);

    await fetch(`http://127.0.0.1:${port}/callback?token=tl_testtoken1234567890abcdefghijk&state=wrongstate`);

    await assertion;
  });

  it('rejects on timeout', async () => {
    const port  = await getTestPort();
    const state = generateState();

    await assert.rejects(
      startLocalServer(port, state, 50), // 50ms timeout
      /timed out/i,
    );
  });

  it('rejects when token is missing from callback', async () => {
    const port  = await getTestPort();
    const state = generateState();

    const tokenPromise = startLocalServer(port, state, 5000);
    const assertion    = assert.rejects(tokenPromise, /invalid token/i);

    await fetch(`http://127.0.0.1:${port}/callback?state=${state}`);

    await assertion;
  });

  it('ignores requests to paths other than /callback', async () => {
    const port  = await getTestPort();
    const state = generateState();

    const tokenPromise = startLocalServer(port, state, 5000);

    // Favicon request (browsers often fire this) — must be ignored
    await fetch(`http://127.0.0.1:${port}/favicon.ico`).catch(() => {});

    // Now send the real callback
    await fetch(`http://127.0.0.1:${port}/callback?token=tl_testtoken1234567890abcdefghijk&state=${state}`);

    const token = await tokenPromise;
    assert.equal(token, 'tl_testtoken1234567890abcdefghijk');
  });

  it('returns 200 HTML on successful callback', async () => {
    const port  = await getTestPort();
    const state = generateState();

    const tokenPromise = startLocalServer(port, state, 5000);

    const res = await fetch(`http://127.0.0.1:${port}/callback?token=tl_testtoken1234567890abcdefghijk&state=${state}`);
    assert.equal(res.status, 200);

    const body = await res.text();
    assert.ok(body.includes('close this tab'));

    await tokenPromise;
  });

  it('returns 400 on state mismatch response', async () => {
    const port  = await getTestPort();
    const state = generateState();

    const tokenPromise = startLocalServer(port, state, 5000);
    const silenced     = tokenPromise.catch(() => {});

    const res = await fetch(`http://127.0.0.1:${port}/callback?token=tl_tok&state=wrongstate`);
    assert.equal(res.status, 400);

    await silenced;
  });
});
