import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { runLogin } from '../lib/login-flow.mjs';

function fakeStream() {
  const chunks = [];
  return { write: chunk => chunks.push(chunk), get text() { return chunks.join(''); } };
}

function okResponse() {
  return { ok: true, status: 200 };
}

describe('runLogin — manual flow', () => {
  it('rejects a token not starting with tl_ without calling fetch', async () => {
    const stream = fakeStream();
    const fetchFn = mock.fn(async () => okResponse());
    const originalExitCode = process.exitCode;

    await runLogin({
      manual: true,
      stream,
      promptSecretFn: async () => 'bad-token',
      fetchFn,
      saveCliTokenFn: () => { throw new Error('must not be called'); },
    });

    assert.equal(fetchFn.mock.callCount(), 0);
    assert.ok(stream.text.includes('must start with'));
    assert.equal(process.exitCode, 1);
    process.exitCode = originalExitCode;
  });

  it('saves the token and reports success on a valid tl_ token', async () => {
    const stream = fakeStream();
    let saved = null;
    const originalExitCode = process.exitCode;

    await runLogin({
      manual: true,
      stream,
      promptSecretFn: async () => 'tl_abc123',
      fetchFn: async () => okResponse(),
      saveCliTokenFn: token => { saved = token; },
      applyTeamConfigOnLoginFn: async () => null,
    });

    assert.equal(saved, 'tl_abc123');
    assert.ok(stream.text.includes('Logged in'));
    assert.equal(process.exitCode, originalExitCode);
  });
});

describe('runLogin — browser flow', () => {
  it('reports cancellation without treating it as an error (exit 0)', async () => {
    const stream = fakeStream();
    const originalExitCode = process.exitCode;

    await runLogin({
      manual: false,
      stream,
      browserLoginFn: async () => { throw new Error('Authorization cancelled'); },
    });

    assert.ok(stream.text.includes('Login cancelled'));
    assert.equal(process.exitCode, 0);
    process.exitCode = originalExitCode;
  });

  it('reports a non-cancellation browser error and suggests --manual, exit 1', async () => {
    const stream = fakeStream();
    const originalExitCode = process.exitCode;

    await runLogin({
      manual: false,
      stream,
      browserLoginFn: async () => { throw new Error('Authorization timed out after 120 seconds'); },
    });

    assert.ok(stream.text.includes('Authorization timed out'));
    assert.ok(stream.text.includes('--manual'));
    assert.equal(process.exitCode, 1);
    process.exitCode = originalExitCode;
  });

  it('verifies the token and saves it on success', async () => {
    const stream = fakeStream();
    let saved = null;
    const originalExitCode = process.exitCode;

    await runLogin({
      manual: false,
      stream,
      browserLoginFn: async () => 'tl_fromBrowser',
      fetchFn: async () => okResponse(),
      saveCliTokenFn: token => { saved = token; },
      applyTeamConfigOnLoginFn: async () => null,
    });

    assert.equal(saved, 'tl_fromBrowser');
    assert.ok(stream.text.includes('Logged in'));
    process.exitCode = originalExitCode;
  });
});

describe('runLogin — token verification (both flows)', () => {
  it('reports network failure without saving the token', async () => {
    const stream = fakeStream();
    const originalExitCode = process.exitCode;

    await runLogin({
      manual: false,
      stream,
      browserLoginFn: async () => 'tl_abc',
      fetchFn: async () => { throw new Error('network down'); },
      saveCliTokenFn: () => { throw new Error('must not be called'); },
    });

    assert.ok(stream.text.includes('Could not reach'));
    assert.equal(process.exitCode, 1);
    process.exitCode = originalExitCode;
  });

  it('reports invalid token on HTTP 401 without saving', async () => {
    const stream = fakeStream();
    const originalExitCode = process.exitCode;

    await runLogin({
      manual: false,
      stream,
      browserLoginFn: async () => 'tl_abc',
      fetchFn: async () => ({ ok: false, status: 401 }),
      saveCliTokenFn: () => { throw new Error('must not be called'); },
    });

    assert.ok(stream.text.includes('Invalid token'));
    assert.equal(process.exitCode, 1);
    process.exitCode = originalExitCode;
  });

  it('reports a non-2xx, non-401 server error without saving', async () => {
    const stream = fakeStream();
    const originalExitCode = process.exitCode;

    await runLogin({
      manual: false,
      stream,
      browserLoginFn: async () => 'tl_abc',
      fetchFn: async () => ({ ok: false, status: 503 }),
      saveCliTokenFn: () => { throw new Error('must not be called'); },
    });

    assert.ok(stream.text.includes('503'));
    assert.equal(process.exitCode, 1);
    process.exitCode = originalExitCode;
  });

  it('applies team Jira config on login when available', async () => {
    const stream = fakeStream();
    const originalExitCode = process.exitCode;

    await runLogin({
      manual: false,
      stream,
      browserLoginFn: async () => 'tl_abc',
      fetchFn: async () => okResponse(),
      saveCliTokenFn: () => {},
      applyTeamConfigOnLoginFn: async () => ({ ok: true, groupName: 'Acme Team' }),
    });

    assert.ok(stream.text.includes('Acme Team'));
    process.exitCode = originalExitCode;
  });

  it('never throws when applyTeamConfigOnLogin rejects', async () => {
    const stream = fakeStream();
    const originalExitCode = process.exitCode;

    await assert.doesNotReject(runLogin({
      manual: false,
      stream,
      browserLoginFn: async () => 'tl_abc',
      fetchFn: async () => okResponse(),
      saveCliTokenFn: () => {},
      applyTeamConfigOnLoginFn: async () => { throw new Error('boom'); },
    }));
    process.exitCode = originalExitCode;
  });
});
