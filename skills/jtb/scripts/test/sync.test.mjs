import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { syncProfiles, serverToCliProfile, profileNeedsCredentials, getApiBase } from '../lib/sync.mjs';
import { saveCliToken } from '../lib/cli-auth.mjs';

// ── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;
function makeTmpDir(prefix) {
  const dir = join(tmpdir(), `tl-sync-test-${prefix}-${Date.now()}-${++_seq}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function fakeRes(status, body) {
  const bodyStr = JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => JSON.parse(bodyStr),
  };
}

function readProfiles(dir) {
  const p = join(dir, 'profiles.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

function writeCredentials(dir, creds) {
  writeFileSync(join(dir, 'credentials.json'), JSON.stringify(creds, null, 2), 'utf8');
}

const JIRA_PROFILE = {
  name: 'work',
  tracker_type: 'jira',
  base_url: 'https://acme.atlassian.net',
  auth_method: 'cloud',
  email: 'me@acme.com',
  ticket_prefixes: ['PROJ', 'OPS'],
  project_paths: ['/code/acme'],
  triage_statuses: ['In Progress'],
};

const GITHUB_PROFILE = {
  name: 'oss',
  tracker_type: 'github',
  base_url: 'https://github.com/acme/repo',
  auth_method: 'github',
  email: null,
  ticket_prefixes: ['GH'],
  project_paths: null,
  triage_statuses: null,
};

// ── Unit: serverToCliProfile ──────────────────────────────────────────────────

describe('serverToCliProfile', () => {
  it('maps Jira profile fields to CLI camelCase', () => {
    const { name, profileData } = serverToCliProfile(JIRA_PROFILE);
    assert.equal(name, 'work');
    assert.equal(profileData.baseUrl, 'https://acme.atlassian.net');
    assert.equal(profileData.auth, 'cloud');
    assert.equal(profileData.email, 'me@acme.com');
    assert.deepEqual(profileData.ticketPrefixes, ['PROJ', 'OPS']);
    assert.deepEqual(profileData.projectPaths, ['/code/acme']);
    assert.deepEqual(profileData.triageStatuses, ['In Progress']);
  });

  it('maps GitHub profile and omits null arrays', () => {
    const { name, profileData } = serverToCliProfile(GITHUB_PROFILE);
    assert.equal(name, 'oss');
    assert.equal(profileData.baseUrl, 'https://github.com/acme/repo');
    assert.equal(profileData.auth, 'github');
    assert.equal('email' in profileData, false);
    assert.deepEqual(profileData.ticketPrefixes, ['GH']);
    assert.equal('projectPaths' in profileData, false);
    assert.equal('triageStatuses' in profileData, false);
  });

  it('omits empty optional fields', () => {
    const { profileData } = serverToCliProfile({
      name: 'bare', tracker_type: 'jira', base_url: 'https://x.atlassian.net',
      auth_method: 'cloud', email: null, ticket_prefixes: [], project_paths: null, triage_statuses: null,
    });
    assert.equal('email' in profileData, false);
    assert.equal('ticketPrefixes' in profileData, false);
    assert.equal('projectPaths' in profileData, false);
    assert.equal('triageStatuses' in profileData, false);
  });
});

// ── Unit: profileNeedsCredentials ────────────────────────────────────────────

describe('profileNeedsCredentials', () => {
  it('returns true when creds is null', () => {
    assert.equal(profileNeedsCredentials({ auth: 'cloud' }, null), true);
  });

  it('returns true when creds object exists but apiToken missing (cloud)', () => {
    assert.equal(profileNeedsCredentials({ auth: 'cloud' }, {}), true);
  });

  it('returns false when apiToken present (cloud)', () => {
    assert.equal(profileNeedsCredentials({ auth: 'cloud' }, { apiToken: 'sk-xxx' }), false);
  });

  it('returns true when pat missing (pat auth)', () => {
    assert.equal(profileNeedsCredentials({ auth: 'pat' }, { apiToken: 'x' }), true);
  });

  it('returns false when pat present', () => {
    assert.equal(profileNeedsCredentials({ auth: 'pat' }, { pat: 'xxx' }), false);
  });

  it('returns false when apiToken present (github)', () => {
    assert.equal(profileNeedsCredentials({ auth: 'github' }, { apiToken: 'ghp_xxx' }), false);
  });
});

// ── Integration: syncProfiles ─────────────────────────────────────────────────

describe('syncProfiles', () => {
  let dir;
  beforeEach(() => {
    dir = makeTmpDir('sync');
    saveCliToken('tl_' + 'x'.repeat(40), dir);
  });
  after(() => { try { rmSync(dir, { recursive: true }); } catch {} });

  it('returns error:no-token when no token file exists', async () => {
    const emptyDir = makeTmpDir('no-token');
    try {
      const result = await syncProfiles({ configDir: emptyDir });
      assert.equal(result.error, 'no-token');
    } finally {
      rmSync(emptyDir, { recursive: true });
    }
  });

  it('returns error:unauthorized on 401', async () => {
    const result = await syncProfiles({
      configDir: dir,
      fetcher: async () => fakeRes(401, { error: 'Unauthorized' }),
    });
    assert.equal(result.error, 'unauthorized');
  });

  it('returns error:http-500 on server error', async () => {
    const result = await syncProfiles({
      configDir: dir,
      fetcher: async () => fakeRes(500, {}),
    });
    assert.equal(result.error, 'http-500');
  });

  it('returns error:timeout on network timeout', async () => {
    const result = await syncProfiles({
      configDir: dir,
      fetcher: async () => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; },
    });
    assert.equal(result.error, 'timeout');
  });

  it('returns empty arrays when server returns no profiles', async () => {
    const result = await syncProfiles({
      configDir: dir,
      fetcher: async () => fakeRes(200, { profiles: [] }),
    });
    assert.deepEqual(result, { added: [], updated: [], unchanged: [], needsCredentials: [] });
  });

  it('adds new profiles and marks needsCredentials when no local creds', async () => {
    const result = await syncProfiles({
      configDir: dir,
      fetcher: async () => fakeRes(200, { profiles: [JIRA_PROFILE] }),
    });
    assert.deepEqual(result.added, ['work']);
    assert.deepEqual(result.updated, []);
    assert.deepEqual(result.unchanged, []);
    assert.deepEqual(result.needsCredentials, ['work']);
  });

  it('marks profile as NOT needing credentials when creds exist', async () => {
    writeCredentials(dir, { work: { apiToken: 'sk-xxx' } });
    const result = await syncProfiles({
      configDir: dir,
      fetcher: async () => fakeRes(200, { profiles: [JIRA_PROFILE] }),
    });
    assert.deepEqual(result.needsCredentials, []);
  });

  it('writes profile shape to profiles.json', async () => {
    await syncProfiles({
      configDir: dir,
      fetcher: async () => fakeRes(200, { profiles: [JIRA_PROFILE] }),
    });
    const saved = readProfiles(dir);
    assert.equal(saved.profiles.work.baseUrl, 'https://acme.atlassian.net');
    assert.equal(saved.profiles.work.auth, 'cloud');
    assert.equal(saved.profiles.work.email, 'me@acme.com');
    assert.deepEqual(saved.profiles.work.ticketPrefixes, ['PROJ', 'OPS']);
  });

  it('does NOT write credentials.json when syncing', async () => {
    await syncProfiles({
      configDir: dir,
      fetcher: async () => fakeRes(200, { profiles: [JIRA_PROFILE] }),
    });
    assert.equal(existsSync(join(dir, 'credentials.json')), false);
  });

  it('preserves existing credentials when profile is updated', async () => {
    writeCredentials(dir, { work: { apiToken: 'existing-token' } });
    // First sync — add
    await syncProfiles({
      configDir: dir,
      fetcher: async () => fakeRes(200, { profiles: [JIRA_PROFILE] }),
    });
    // Second sync — different email → updated
    const modified = { ...JIRA_PROFILE, email: 'new@acme.com' };
    await syncProfiles({
      configDir: dir,
      fetcher: async () => fakeRes(200, { profiles: [modified] }),
    });
    // Credentials must survive both syncs
    const creds = JSON.parse(readFileSync(join(dir, 'credentials.json'), 'utf8'));
    assert.equal(creds.work.apiToken, 'existing-token');
  });

  it('reports updated when server profile differs from local', async () => {
    // First sync
    await syncProfiles({
      configDir: dir,
      fetcher: async () => fakeRes(200, { profiles: [JIRA_PROFILE] }),
    });
    // Second sync with changed base_url
    const modified = { ...JIRA_PROFILE, base_url: 'https://new.atlassian.net' };
    const result = await syncProfiles({
      configDir: dir,
      fetcher: async () => fakeRes(200, { profiles: [modified] }),
    });
    assert.deepEqual(result.updated, ['work']);
    assert.deepEqual(result.added, []);
  });

  it('reports unchanged when profile matches local', async () => {
    await syncProfiles({
      configDir: dir,
      fetcher: async () => fakeRes(200, { profiles: [JIRA_PROFILE] }),
    });
    const result = await syncProfiles({
      configDir: dir,
      fetcher: async () => fakeRes(200, { profiles: [JIRA_PROFILE] }),
    });
    assert.deepEqual(result.unchanged, ['work']);
    assert.deepEqual(result.added, []);
    assert.deepEqual(result.updated, []);
  });

  it('handles multiple profiles in one sync', async () => {
    const result = await syncProfiles({
      configDir: dir,
      fetcher: async () => fakeRes(200, { profiles: [JIRA_PROFILE, GITHUB_PROFILE] }),
    });
    assert.deepEqual(result.added.sort(), ['oss', 'work']);
    assert.deepEqual(result.needsCredentials.sort(), ['oss', 'work']);
  });

  it('sends Bearer token in Authorization header', async () => {
    let capturedAuth;
    await syncProfiles({
      configDir: dir,
      fetcher: async (url, opts) => {
        capturedAuth = opts?.headers?.Authorization;
        return fakeRes(200, { profiles: [] });
      },
    });
    assert.ok(capturedAuth?.startsWith('Bearer tl_'));
  });

  it('getApiBase returns TICKETLENS_API_URL when set', () => {
    const orig = process.env.TICKETLENS_API_URL;
    process.env.TICKETLENS_API_URL = 'http://ticketlens.test';
    assert.equal(getApiBase(), 'http://ticketlens.test');
    if (orig === undefined) delete process.env.TICKETLENS_API_URL;
    else process.env.TICKETLENS_API_URL = orig;
  });
});
