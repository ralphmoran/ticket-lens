import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { testConnections } from '../lib/connection-tester.mjs';

let configDir;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'tl-connection-tester-'));
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

function writeProfiles(dir, contents) {
  writeFileSync(join(dir, 'profiles.json'), JSON.stringify(contents), 'utf8');
}

function writeCredentials(dir, contents) {
  writeFileSync(join(dir, 'credentials.json'), JSON.stringify(contents), 'utf8');
}

function fakeStream() {
  return { write: () => {}, isTTY: false };
}

function capturingStream() {
  const lines = [];
  return { write: (s) => { lines.push(s); return true; }, isTTY: false, get text() { return lines.join(''); } };
}

function capturingTTYStream() {
  const lines = [];
  return { write: (s) => { lines.push(s); return true; }, isTTY: true, get text() { return lines.join(''); } };
}

describe('testConnections', () => {
  it('returns an empty result when no profiles exist', async () => {
    const result = await testConnections({ configDir, stream: fakeStream() });
    assert.deepEqual(result, { results: [], failedCount: 0 });
  });

  it('reports success for every reachable profile', async () => {
    writeProfiles(configDir, {
      profiles: {
        acme: { baseUrl: 'https://acme.atlassian.net', auth: 'cloud', email: 'dev@acme.com' },
        globex: { baseUrl: 'https://globex.atlassian.net', auth: 'cloud', email: 'dev@globex.com' },
      },
    });
    writeCredentials(configDir, {
      acme: { apiToken: 'tok1' },
      globex: { apiToken: 'tok2' },
    });

    const resolveAdapterFn = () => ({ fetchCurrentUser: async () => ({ displayName: 'Dev' }) });

    const result = await testConnections({ configDir, stream: fakeStream(), resolveAdapterFn });
    assert.equal(result.failedCount, 0);
    assert.deepEqual(result.results.map(r => [r.name, r.ok]).sort(), [['acme', true], ['globex', true]]);
  });

  it('reports failure with a classified message for an unreachable profile', async () => {
    writeProfiles(configDir, {
      profiles: { acme: { baseUrl: 'https://acme.atlassian.net', auth: 'cloud', email: 'dev@acme.com' } },
    });
    writeCredentials(configDir, { acme: { apiToken: 'bad-token' } });

    const resolveAdapterFn = () => ({ fetchCurrentUser: async () => { throw new Error('401 Unauthorized'); } });

    const result = await testConnections({ configDir, stream: fakeStream(), resolveAdapterFn });
    assert.equal(result.failedCount, 1);
    assert.equal(result.results[0].name, 'acme');
    assert.equal(result.results[0].ok, false);
    assert.ok(result.results[0].error);
  });

  it('carries the classified hint alongside the error on a failed profile', async () => {
    writeProfiles(configDir, {
      profiles: { acme: { baseUrl: 'https://acme.atlassian.net', auth: 'cloud', email: 'dev@acme.com' } },
    });
    writeCredentials(configDir, { acme: { apiToken: 'bad-token' } });

    const resolveAdapterFn = () => ({ fetchCurrentUser: async () => { const e = new Error('unauthorized'); e.status = 401; throw e; } });

    const result = await testConnections({ configDir, stream: fakeStream(), resolveAdapterFn });
    assert.equal(result.results[0].ok, false);
    assert.match(result.results[0].hint, /credentials may have expired/);
  });

  it('tests every profile independently — one failure does not stop the others', async () => {
    writeProfiles(configDir, {
      profiles: {
        acme: { baseUrl: 'https://acme.atlassian.net', auth: 'cloud', email: 'dev@acme.com' },
        globex: { baseUrl: 'https://globex.atlassian.net', auth: 'cloud', email: 'dev@globex.com' },
      },
    });
    writeCredentials(configDir, {
      acme: { apiToken: 'bad' },
      globex: { apiToken: 'good' },
    });

    const resolveAdapterFn = (conn) => ({
      fetchCurrentUser: async () => {
        if (conn.apiToken === 'bad') throw new Error('401 Unauthorized');
        return { displayName: 'Dev' };
      },
    });

    const result = await testConnections({ configDir, stream: fakeStream(), resolveAdapterFn });
    assert.equal(result.failedCount, 1);
    const byName = Object.fromEntries(result.results.map(r => [r.name, r.ok]));
    assert.equal(byName.acme, false);
    assert.equal(byName.globex, true);
  });

  it('is tracker-type agnostic — works for a GitHub-style profile', async () => {
    writeProfiles(configDir, {
      profiles: { ghrepo: { baseUrl: 'https://github.com/acme/widgets', auth: 'github' } },
    });
    writeCredentials(configDir, { ghrepo: { apiToken: 'ghp_abc' } });

    const resolveAdapterFn = () => ({ fetchCurrentUser: async () => ({ login: 'devuser' }) });

    const result = await testConnections({ configDir, stream: fakeStream(), resolveAdapterFn });
    assert.equal(result.failedCount, 0);
    assert.equal(result.results[0].name, 'ghrepo');
  });

  it('passes allowPrivateIp:true through to the conn object for a profile trusted for VPN-gated on-prem Jira', async () => {
    writeProfiles(configDir, {
      profiles: { forge: { baseUrl: 'https://jira.forge.com', auth: 'server', allowPrivateIp: true } },
    });
    writeCredentials(configDir, { forge: { pat: 'pat-forge' } });

    let capturedConn;
    const resolveAdapterFn = (conn) => { capturedConn = conn; return { fetchCurrentUser: async () => ({ displayName: 'Dev' }) }; };

    await testConnections({ configDir, stream: fakeStream(), resolveAdapterFn });
    assert.equal(capturedConn.allowPrivateIp, true);
  });

  it('reports "No credentials stored." for a profile with no apiToken/pat, without attempting a network call', async () => {
    writeProfiles(configDir, {
      profiles: { acme: { baseUrl: 'https://acme.atlassian.net', auth: 'cloud', email: 'dev@acme.com' } },
    });
    writeCredentials(configDir, {}); // no entry for acme at all

    let resolveAdapterCalled = false;
    const resolveAdapterFn = () => { resolveAdapterCalled = true; return { fetchCurrentUser: async () => ({ displayName: 'Dev' }) }; };

    const result = await testConnections({ configDir, stream: fakeStream(), resolveAdapterFn });
    assert.equal(resolveAdapterCalled, false, 'must not attempt a network call when there are no credentials to try');
    assert.equal(result.failedCount, 1);
    assert.equal(result.results[0].ok, false);
    assert.equal(result.results[0].error, 'No credentials stored.');
    assert.match(result.results[0].hint, /ticketlens config --profile=acme/);
  });

  it('still writes visible feedback to `stream` for a no-credentials profile — callers like onboarding.mjs that discard the return value and rely on stream output must not go silent', async () => {
    writeProfiles(configDir, {
      profiles: { acme: { baseUrl: 'https://acme.atlassian.net', auth: 'cloud' } },
    });
    writeCredentials(configDir, {});

    const stream = capturingStream();
    const resolveAdapterFn = () => ({ fetchCurrentUser: async () => ({ displayName: 'Dev' }) });
    await testConnections({ configDir, stream, resolveAdapterFn });

    assert.notEqual(stream.text, '', 'a no-credentials profile must still produce visible output');
    assert.match(stream.text, /No credentials stored\./);
    assert.match(stream.text, /ticketlens config --profile=acme/);
  });

  it('renders a real header + failed-status + footer box for a no-credentials profile on a TTY stream, with no leaked spinner interval', async () => {
    writeProfiles(configDir, {
      profiles: { acme: { baseUrl: 'https://acme.atlassian.net', auth: 'cloud' } },
    });
    writeCredentials(configDir, {});

    const stream = capturingTTYStream();
    const resolveAdapterFn = () => ({ fetchCurrentUser: async () => ({ displayName: 'Dev' }) });
    await testConnections({ configDir, stream, resolveAdapterFn });

    assert.match(stream.text, /Connection to .* failed\./, 'should show the same red failed-status line every other failure path renders');
    assert.match(stream.text, /No credentials stored\./);
    assert.match(stream.text, /ticketlens config --profile=acme/);
    // If the spinner interval leaked, a second render would still be queued —
    // give the event loop a turn past SPINNER_INTERVAL and confirm no more
    // output arrives.
    const lengthAfterCall = stream.text.length;
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(stream.text.length, lengthAfterCall, 'no further writes should occur — the spinner interval must be cleared, not left running');
  });

  it('does not confuse a profile with only a pat (no apiToken) for missing credentials', async () => {
    writeProfiles(configDir, {
      profiles: { forge: { baseUrl: 'https://jira.forge.com', auth: 'server' } },
    });
    writeCredentials(configDir, { forge: { pat: 'pat-forge' } });

    let resolveAdapterCalled = false;
    const resolveAdapterFn = () => { resolveAdapterCalled = true; return { fetchCurrentUser: async () => ({ displayName: 'Dev' }) }; };

    const result = await testConnections({ configDir, stream: fakeStream(), resolveAdapterFn });
    assert.equal(resolveAdapterCalled, true, 'a PAT alone counts as credentials and should still attempt the real call');
    assert.equal(result.results[0].ok, true);
  });

  it('does not set allowPrivateIp when the profile never granted trust (regression)', async () => {
    writeProfiles(configDir, {
      profiles: { acme: { baseUrl: 'https://acme.atlassian.net', auth: 'cloud', email: 'dev@acme.com' } },
    });
    writeCredentials(configDir, { acme: { apiToken: 'tok1' } });

    let capturedConn;
    const resolveAdapterFn = (conn) => { capturedConn = conn; return { fetchCurrentUser: async () => ({ displayName: 'Dev' }) }; };

    await testConnections({ configDir, stream: fakeStream(), resolveAdapterFn });
    assert.equal(capturedConn.allowPrivateIp, undefined);
  });
});
