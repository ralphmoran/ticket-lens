import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { fetchTeamJiraConfig, checkTeamJiraConfigUpdate, applyTeamConfigOnLogin } from '../lib/team-jira-sync.mjs';

let _seq = 0;
function makeTmpDir() {
  const dir = join(tmpdir(), `tl-team-jira-test-${Date.now()}-${++_seq}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}
function writeToken(dir, token) {
  writeFileSync(join(dir, 'cli-token.json'), JSON.stringify({ token }), { encoding: 'utf8', mode: 0o600 });
}
function writeMeta(dir, data) {
  writeFileSync(join(dir, 'team-jira-meta.json'), JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
}
function writeProfiles(dir, profiles) {
  writeFileSync(join(dir, 'profiles.json'), JSON.stringify({ profiles }), { encoding: 'utf8', mode: 0o600 });
}
function readProfiles(dir) {
  const p = join(dir, 'profiles.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).profiles : null;
}

const VALID_TOKEN = 'tl_' + 't'.repeat(40);

describe('fetchTeamJiraConfig', () => {
  it('returns error shape on HTTP 403 without throwing', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);

    const fakeFetch = async () => ({
      status: 403,
      ok: false,
      json: async () => ({ error: 'Insufficient license tier.' }),
    });

    const result = await fetchTeamJiraConfig({ configDir: dir, fetcher: fakeFetch });

    assert.ok(result.error, 'should return error shape, not throw');
    assert.strictEqual(result.error, 'http-403');
  });

  it('returns error shape on HTTP 404 without throwing', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);

    const fakeFetch = async () => ({
      status: 404,
      ok: false,
      json: async () => ({ message: 'Not Found.' }),
    });

    const result = await fetchTeamJiraConfig({ configDir: dir, fetcher: fakeFetch });

    assert.ok(result.error, 'should return error shape, not throw');
    assert.strictEqual(result.error, 'http-404');
  });

  it('returns error shape when no CLI token is saved', async () => {
    const dir = makeTmpDir();

    const fakeFetch = async () => ({ status: 200, ok: true, json: async () => ({}) });

    const result = await fetchTeamJiraConfig({ configDir: dir, fetcher: fakeFetch });

    assert.ok(result.error, 'should return error shape when no token');
    assert.strictEqual(result.error, 'no-token');
  });
});

describe('applyTeamConfigOnLogin', () => {
  it('writes profile and full meta on success', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);

    const updatedAt = '2026-06-22T10:00:00.000Z';
    const fakeFetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        group_name: 'acme-team', jira_base_url: 'https://acme.atlassian.net',
        auth_type: 'cloud', prefixes: ['ACME', 'OPS'], project_paths: ['/code'],
        triage_statuses: ['In Progress'], updated_at: updatedAt,
      }),
    });

    const result = await applyTeamConfigOnLogin({ configDir: dir, fetcher: fakeFetch });

    assert.strictEqual(result.ok, true, 'should return ok:true on success');
    assert.strictEqual(result.groupName, 'acme-team');
    assert.strictEqual(result.authType, 'cloud');

    const profiles = readProfiles(dir);
    assert.ok(profiles?.['acme-team'], 'profile should be written');
    assert.strictEqual(profiles['acme-team'].baseUrl, 'https://acme.atlassian.net');
    assert.deepStrictEqual(profiles['acme-team'].ticketPrefixes, ['ACME', 'OPS']);

    const metaRaw = readFileSync(join(dir, 'team-jira-meta.json'), 'utf8');
    const meta = JSON.parse(metaRaw);
    assert.strictEqual(meta.updated_at, updatedAt, 'meta should store updated_at');
    assert.strictEqual(meta.jira_base_url, 'https://acme.atlassian.net', 'meta should store jira_base_url for change detection');
    assert.strictEqual(meta.auth_type, 'cloud', 'meta should store auth_type for change detection');
  });

  it('returns ok:false on error without throwing', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);

    const fakeFetch = async () => ({ status: 403, ok: false, json: async () => ({}) });

    const result = await applyTeamConfigOnLogin({ configDir: dir, fetcher: fakeFetch });

    assert.strictEqual(result.ok, false, 'should return ok:false on 403');
    assert.ok(!result.groupName, 'no groupName on error');
  });

  it('returns ok:false for invalid group_name', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);

    const fakeFetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        group_name: '__proto__', jira_base_url: 'https://acme.atlassian.net',
        auth_type: 'cloud', updated_at: '2026-06-22T12:00:00.000Z',
      }),
    });

    const result = await applyTeamConfigOnLogin({ configDir: dir, fetcher: fakeFetch });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'invalid-group-name');
  });

  it('returns ok:false when meta write fails', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);
    mkdirSync(join(dir, 'team-jira-meta.json'));

    const fakeFetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        group_name: 'acme-team', jira_base_url: 'https://acme.atlassian.net',
        auth_type: 'cloud', updated_at: '2026-06-22T12:00:00.000Z',
      }),
    });

    const result = await applyTeamConfigOnLogin({ configDir: dir, fetcher: fakeFetch });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'meta-write-failed');
  });
});

describe('checkTeamJiraConfigUpdate', () => {
  it('does not overwrite local profile when server returns 403', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);

    const existingProfiles = {
      'acme-team': { baseUrl: 'https://original.atlassian.net', auth: 'cloud' },
    };
    writeProfiles(dir, existingProfiles);
    writeMeta(dir, { group_name: 'acme-team', updated_at: '2026-06-01T10:00:00Z' });

    const fakeFetch = async () => ({
      status: 403,
      ok: false,
      json: async () => ({ error: 'Insufficient license tier.' }),
    });

    const result = await checkTeamJiraConfigUpdate({ configDir: dir, fetcher: fakeFetch });

    assert.strictEqual(result.updated, false, 'should not report update on 403');

    const profiles = readProfiles(dir);
    assert.deepStrictEqual(profiles, existingProfiles, 'existing profile must be unchanged after 403');
  });

  it('does not overwrite local profile when server returns 404 (config deleted)', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);

    const existingProfiles = {
      'acme-team': { baseUrl: 'https://original.atlassian.net', auth: 'cloud' },
    };
    writeProfiles(dir, existingProfiles);
    writeMeta(dir, { group_name: 'acme-team', updated_at: '2026-06-01T10:00:00Z' });

    const fakeFetch = async () => ({
      status: 404,
      ok: false,
      json: async () => ({ message: 'Not Found.' }),
    });

    const result = await checkTeamJiraConfigUpdate({ configDir: dir, fetcher: fakeFetch });

    assert.strictEqual(result.updated, false);
    assert.strictEqual(result.deleted, true, 'should signal config deletion');

    const profiles = readProfiles(dir);
    assert.deepStrictEqual(profiles, existingProfiles, 'existing profile must be unchanged after 404');
  });

  it('applies config and writes full meta on updated_at change', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);
    writeMeta(dir, { group_name: 'acme-team', updated_at: '2026-06-01T00:00:00.000Z' });

    const newDate = '2026-06-22T12:00:00.000Z';
    const fakeFetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        group_name: 'acme-team', jira_base_url: 'https://acme.atlassian.net',
        auth_type: 'cloud', prefixes: ['ACME'], project_paths: [], triage_statuses: [],
        updated_at: newDate,
      }),
    });

    const result = await checkTeamJiraConfigUpdate({ configDir: dir, fetcher: fakeFetch });

    assert.strictEqual(result.updated, true, 'should report update when updated_at changed');
    assert.ok(result.banner && result.banner.includes('updated'), 'should include "updated" in banner');
    assert.strictEqual(result.groupName, 'acme-team');

    const profiles = readProfiles(dir);
    assert.ok(profiles?.['acme-team'], 'profile should be written');
    assert.strictEqual(profiles['acme-team'].baseUrl, 'https://acme.atlassian.net');

    const metaRaw = readFileSync(join(dir, 'team-jira-meta.json'), 'utf8');
    const meta = JSON.parse(metaRaw);
    assert.strictEqual(meta.jira_base_url, 'https://acme.atlassian.net', 'meta must include jira_base_url for change detection');
    assert.strictEqual(meta.auth_type, 'cloud', 'meta must include auth_type for change detection');
  });

  it('returns updated=false and no banner when updated_at unchanged', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);

    const existingProfiles = {
      'acme-team': { baseUrl: 'https://acme.atlassian.net', auth: 'cloud' },
    };
    writeProfiles(dir, existingProfiles);
    const knownDate = '2026-06-10T08:00:00Z';
    writeMeta(dir, { group_name: 'acme-team', updated_at: knownDate });

    const fakeFetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        group_name:      'acme-team',
        jira_base_url:   'https://acme.atlassian.net',
        auth_type:       'cloud',
        prefixes:        null,
        project_paths:   null,
        triage_statuses: null,
        updated_at:      knownDate,
      }),
    });

    const result = await checkTeamJiraConfigUpdate({ configDir: dir, fetcher: fakeFetch });

    assert.strictEqual(result.updated, false, 'same updated_at → no update');
    assert.ok(!result.banner, 'should not produce banner when nothing changed');
  });

  it('returns error for empty group_name', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);

    const fakeFetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        group_name: '', jira_base_url: 'https://acme.atlassian.net',
        auth_type: 'cloud', updated_at: '2026-06-22T12:00:00.000Z',
      }),
    });

    const result = await checkTeamJiraConfigUpdate({ configDir: dir, fetcher: fakeFetch });

    assert.strictEqual(result.updated, false);
    assert.strictEqual(result.error, 'invalid-group-name');
  });

  it('returns error for dangerous group_name like __proto__', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);

    const fakeFetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        group_name: '__proto__', jira_base_url: 'https://acme.atlassian.net',
        auth_type: 'cloud', updated_at: '2026-06-22T12:00:00.000Z',
      }),
    });

    const result = await checkTeamJiraConfigUpdate({ configDir: dir, fetcher: fakeFetch });

    assert.strictEqual(result.updated, false);
    assert.strictEqual(result.error, 'invalid-group-name');
  });

  it('returns error when meta write fails', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);
    mkdirSync(join(dir, 'team-jira-meta.json'));

    const fakeFetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        group_name: 'acme-team', jira_base_url: 'https://acme.atlassian.net',
        auth_type: 'cloud', updated_at: '2026-06-22T12:00:00.000Z',
      }),
    });

    const result = await checkTeamJiraConfigUpdate({ configDir: dir, fetcher: fakeFetch });

    assert.strictEqual(result.updated, false);
    assert.strictEqual(result.error, 'meta-write-failed');
  });
});

describe('team-jira-sync — allowPrivateIp trust flag (VPN-gated on-prem Jira)', () => {
  it('never reads allow_private_ip (or any key-name variant) from the server response — a synced account cannot grant itself trust', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);
    writeMeta(dir, { group_name: 'acme-team', updated_at: '2026-06-01T00:00:00.000Z' });

    const fakeFetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        group_name: 'acme-team', jira_base_url: 'https://acme.atlassian.net',
        auth_type: 'cloud', updated_at: '2026-06-22T12:00:00.000Z',
        // A compromised or malicious API response attempting to smuggle trust in under every plausible key name.
        allow_private_ip: true,
        allowPrivateIp: true,
        allow_private_ips: true,
      }),
    });

    const result = await checkTeamJiraConfigUpdate({ configDir: dir, fetcher: fakeFetch });
    assert.strictEqual(result.updated, true);

    const profiles = readProfiles(dir);
    assert.strictEqual(profiles['acme-team'].allowPrivateIp, undefined, 'server data must never grant allowPrivateIp on a fresh profile');
  });

  it('carries forward allowPrivateIp:true from the existing LOCAL profile when a sync updates it WITHOUT changing the host', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);
    writeProfiles(dir, {
      'acme-team': { baseUrl: 'https://acme.atlassian.net', auth: 'cloud', allowPrivateIp: true },
    });
    writeMeta(dir, { group_name: 'acme-team', updated_at: '2026-06-01T00:00:00.000Z' });

    const fakeFetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        group_name: 'acme-team', jira_base_url: 'https://acme.atlassian.net',
        auth_type: 'cloud', prefixes: ['ACME'], updated_at: '2026-06-22T12:00:00.000Z',
      }),
    });

    const result = await checkTeamJiraConfigUpdate({ configDir: dir, fetcher: fakeFetch });
    assert.strictEqual(result.updated, true);

    const profiles = readProfiles(dir);
    assert.strictEqual(profiles['acme-team'].baseUrl, 'https://acme.atlassian.net', 'new server data must still apply');
    assert.strictEqual(profiles['acme-team'].allowPrivateIp, true, 'locally-granted trust must survive a sync when the host is unchanged');
  });

  it('does NOT carry forward allowPrivateIp when a sync changes the host — trust is scoped to the exact hostname it was granted for', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);
    writeProfiles(dir, {
      'acme-team': { baseUrl: 'https://old.atlassian.net', auth: 'cloud', allowPrivateIp: true },
    });
    writeMeta(dir, { group_name: 'acme-team', updated_at: '2026-06-01T00:00:00.000Z' });

    const fakeFetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        // A compromised/malicious sync (or a legitimate re-point) changes the host — the OLD trust
        // grant must never silently apply to this NEW, unconfirmed host.
        group_name: 'acme-team', jira_base_url: 'https://acme.atlassian.net',
        auth_type: 'cloud', updated_at: '2026-06-22T12:00:00.000Z',
      }),
    });

    const result = await checkTeamJiraConfigUpdate({ configDir: dir, fetcher: fakeFetch });
    assert.strictEqual(result.updated, true);

    const profiles = readProfiles(dir);
    assert.strictEqual(profiles['acme-team'].baseUrl, 'https://acme.atlassian.net', 'new server data must still apply');
    assert.strictEqual(profiles['acme-team'].allowPrivateIp, undefined, 'trust for the OLD host must not silently transfer to a NEW, unconfirmed host');
  });

  it('does not set allowPrivateIp on a brand-new profile with no prior local trust', async () => {
    const dir = makeTmpDir();
    writeToken(dir, VALID_TOKEN);

    const fakeFetch = async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        group_name: 'acme-team', jira_base_url: 'https://acme.atlassian.net',
        auth_type: 'cloud', updated_at: '2026-06-22T12:00:00.000Z',
      }),
    });

    const result = await applyTeamConfigOnLogin({ configDir: dir, fetcher: fakeFetch });
    assert.strictEqual(result.ok, true);

    const profiles = readProfiles(dir);
    assert.strictEqual(profiles['acme-team'].allowPrivateIp, undefined);
  });
});
