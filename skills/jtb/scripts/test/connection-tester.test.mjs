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
});
