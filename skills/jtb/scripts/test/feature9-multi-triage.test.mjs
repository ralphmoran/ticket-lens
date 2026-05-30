/**
 * Feature 9 — triage --all: multi-profile triage
 * RED phase: all tests must fail until implementation is added.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../fetch-my-tickets.mjs';

function makeFetcher(ticketsByProfile) {
  return async (url) => {
    if (url.includes('/rest/api')) {
      const key = url.includes('profileA') ? 'profileA' : 'profileB';
      const tickets = ticketsByProfile[key] ?? [];
      return { ok: true, json: async () => ({ issues: tickets, total: tickets.length }) };
    }
    if (url.includes('/rest/auth') || url.includes('myself')) {
      return { ok: true, json: async () => ({ accountId: 'u1', displayName: 'Dev', name: 'dev' }) };
    }
    return { ok: true, json: async () => ({}) };
  };
}

let tmpDir;
before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'feature9-test-'));
  const profiles = {
    default: 'profileA',
    profiles: {
      profileA: { baseUrl: 'https://jira-a.example.com', auth: 'cloud', email: 'a@a.com', triageStatuses: ['In Progress'] },
      profileB: { baseUrl: 'https://jira-b.example.com', auth: 'cloud', email: 'b@b.com', triageStatuses: ['In Progress'] },
    },
  };
  writeFileSync(join(tmpDir, 'profiles.json'), JSON.stringify(profiles), 'utf8');
  writeFileSync(join(tmpDir, 'credentials.json'), JSON.stringify({
    profileA: { apiToken: 'tok-a' },
    profileB: { apiToken: 'tok-b' },
  }), 'utf8');
});
after(() => rmSync(tmpDir, { recursive: true }));

describe('triage --all', () => {
  it('is accepted as a known flag (no unknown-flag error written to stderr)', async () => {
    let stderrOut = '';
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { stderrOut += s; return true; };
    await run(['triage', '--all', '--plain'], { env: {}, fetcher: makeFetcher({}), configDir: tmpDir, isLicensed: () => true, showUpgradePrompt: () => {}, print: () => {} });
    process.stderr.write = origWrite;
    assert.ok(!stderrOut.includes('Unknown flag: --all'), `stderr contained Unknown flag: --all\n${stderrOut}`);
  });

  it('requires Pro license — exits 1 and shows upgrade prompt when unlicensed', async () => {
    let upgraded = false;
    await run(['triage', '--all', '--plain'], {
      env: {},
      fetcher: makeFetcher({}),
      configDir: tmpDir,
      isLicensed: () => false,
      showUpgradePrompt: () => { upgraded = true; },
      print: () => {},
    });
    assert.ok(upgraded, 'showUpgradePrompt was not called');
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });

  it('runs triage for each profile and merges output', async () => {
    const staleDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10 days ago → aging
    const ticketA = { key: 'PRJA-1', fields: { summary: 'Fix A', status: { name: 'In Progress' }, updated: staleDate, comment: { comments: [] } } };
    const ticketB = { key: 'PRJB-1', fields: { summary: 'Fix B', status: { name: 'In Progress' }, updated: staleDate, comment: { comments: [] } } };
    const output = [];
    await run(['triage', '--all', '--plain'], {
      env: {},
      fetcher: async (url, _init) => {
        const isA = url.includes('jira-a');
        const ticket = isA ? ticketA : ticketB;
        if (url.includes('myself') || url.includes('rest/auth')) return { ok: true, json: async () => ({ accountId: 'u1', displayName: 'Dev', name: 'dev' }) };
        return { ok: true, json: async () => ({ issues: [ticket], total: 1 }) };
      },
      configDir: tmpDir,
      isLicensed: () => true,
      showUpgradePrompt: () => {},
      print: (s) => output.push(s),
    });
    const combined = output.join('');
    assert.ok(combined.includes('PRJA-1') || combined.includes('PRJB-1'), `Expected merged output to contain tickets, got:\n${combined}`);
  });

  it('labels results by profile name in the output', async () => {
    const ticket = { key: 'PRJA-2', fields: { summary: 'Labelled', status: { name: 'In Progress' }, updated: new Date().toISOString(), comment: { comments: [] } } };
    const output = [];
    await run(['triage', '--all', '--plain'], {
      env: {},
      fetcher: async (url) => {
        if (url.includes('myself') || url.includes('rest/auth')) return { ok: true, json: async () => ({ accountId: 'u1', displayName: 'Dev', name: 'dev' }) };
        if (url.includes('jira-a')) return { ok: true, json: async () => ({ issues: [ticket], total: 1 }) };
        return { ok: true, json: async () => ({ issues: [], total: 0 }) };
      },
      configDir: tmpDir,
      isLicensed: () => true,
      showUpgradePrompt: () => {},
      print: (s) => output.push(s),
    });
    const combined = output.join('');
    assert.ok(combined.includes('profileA'), `Expected profile label in output, got:\n${combined}`);
  });

  it('handles a profile with zero tickets gracefully (no crash)', async () => {
    await assert.doesNotReject(async () => {
      await run(['triage', '--all', '--plain'], {
        env: {},
        fetcher: async (url) => {
          if (url.includes('myself') || url.includes('rest/auth')) return { ok: true, json: async () => ({ accountId: 'u1', displayName: 'Dev', name: 'dev' }) };
          return { ok: true, json: async () => ({ issues: [], total: 0 }) };
        },
        configDir: tmpDir,
        isLicensed: () => true,
        showUpgradePrompt: () => {},
        print: () => {},
      });
    });
  });
});
