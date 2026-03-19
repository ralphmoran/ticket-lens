import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { run } from '../fetch-ticket.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '..', '..', '..', '..', 'fixtures', 'jira-fixtures');
const cloudFixture = JSON.parse(readFileSync(join(fixturesDir, 'PROD-1234-cloud.json'), 'utf8'));

const validEnv = {
  JIRA_BASE_URL: 'https://test.atlassian.net',
  JIRA_PAT: 'test-token',
};

// Use a nonexistent configDir so profile-resolver falls back to env vars
const NO_CONFIG = '/tmp/ticketlens-no-config';

function captureOutput() {
  let stdout = '';
  let stderr = '';
  const origWrite = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = (s) => { stdout += s; };
  process.stderr.write = (s) => { stderr += s; };
  const restore = () => {
    process.stdout.write = origWrite;
    process.stderr.write = origErr;
    process.exitCode = undefined;
  };
  return { get stdout() { return stdout; }, get stderr() { return stderr; }, restore };
}

describe('fetch-ticket integration', () => {
  it('full pipeline with mocked fetch produces valid TicketBrief on stdout', async () => {
    const mockFetch = async () => ({ ok: true, json: async () => cloudFixture });
    const out = captureOutput();
    try {
      await run(['PROD-1234', '--depth=0'], validEnv, mockFetch, NO_CONFIG);
      assert.ok(out.stdout.includes('# PROD-1234: Fix payment validation on checkout'));
      assert.ok(out.stdout.includes('## Description'));
      assert.ok(out.stdout.includes('## Comments'));
      assert.ok(out.stdout.includes('## Code References'));
      assert.ok(out.stdout.includes('`validateCart`'));
    } finally {
      out.restore();
    }
  });

  it('missing ticket ID outputs error to stderr and sets exit code 1', async () => {
    const out = captureOutput();
    try {
      await run([], validEnv, undefined, NO_CONFIG);
      assert.ok(out.stderr.includes('TICKET-KEY'), 'Should show help with usage info');
      assert.equal(process.exitCode, 1);
      assert.equal(out.stdout, '');
    } finally {
      out.restore();
    }
  });

  it('missing env vars outputs error to stderr and sets exit code 1', async () => {
    const out = captureOutput();
    try {
      await run(['PROD-1234'], {}, undefined, NO_CONFIG);
      assert.ok(out.stderr.includes('JIRA_BASE_URL'));
      assert.equal(process.exitCode, 1);
    } finally {
      out.restore();
    }
  });

  it('API failure outputs error to stderr and sets exit code 1', async () => {
    const mockFetch = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' });
    const out = captureOutput();
    try {
      await run(['PROD-1234'], validEnv, mockFetch, NO_CONFIG);
      assert.ok(out.stderr.includes('500'));
      assert.equal(process.exitCode, 1);
    } finally {
      out.restore();
    }
  });

  it('shows prefix mismatch warning when resolved profile lacks the ticket prefix', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ticketlens-'));
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({
      profiles: {
        profile1: { baseUrl: 'https://p1.atlassian.net', auth: 'cloud', email: 'a@test.com', ticketPrefixes: ['PROJ'] },
        profile2: { baseUrl: 'https://p2.atlassian.net', auth: 'cloud', email: 'b@test.com', ticketPrefixes: ['WORK'] },
      },
      default: 'profile1',
    }));
    writeFileSync(join(configDir, 'credentials.json'), JSON.stringify({
      profile1: { apiToken: 'token1' },
      profile2: { apiToken: 'token2' },
    }));

    const mockFetch = async () => ({ ok: true, json: async () => cloudFixture });
    const out = captureOutput();
    try {
      // ECNT is in neither profile's ticketPrefixes → mismatch prompt fires
      // non-TTY → returns null → fetch continues with profile1 (default)
      await run(['ECNT-100', '--depth=0'], {}, mockFetch, configDir);
      assert.ok(out.stderr.includes('ECNT'), 'mismatch warning should mention the unrecognised prefix');
      assert.ok(out.stderr.includes('profile1') || out.stderr.includes('profile2'),
        'mismatch warning should list available profiles');
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('skips prefix mismatch prompt when --profile flag is explicit', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ticketlens-'));
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({
      profiles: {
        profile1: { baseUrl: 'https://p1.atlassian.net', auth: 'cloud', email: 'a@test.com', ticketPrefixes: ['PROJ'] },
        profile2: { baseUrl: 'https://p2.atlassian.net', auth: 'cloud', email: 'b@test.com', ticketPrefixes: ['WORK'] },
      },
      default: 'profile1',
    }));
    writeFileSync(join(configDir, 'credentials.json'), JSON.stringify({
      profile1: { apiToken: 'token1' },
      profile2: { apiToken: 'token2' },
    }));

    const mockFetch = async () => ({ ok: true, json: async () => cloudFixture });
    const out = captureOutput();
    try {
      // --profile= is explicit → skip mismatch check entirely
      await run(['ECNT-100', '--depth=0', '--profile=profile1'], {}, mockFetch, configDir);
      assert.ok(!out.stderr.includes('not configured in any profile'),
        'no mismatch warning when --profile is explicit');
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('skips prefix mismatch prompt when only one profile is configured', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ticketlens-'));
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({
      profiles: {
        solo: { baseUrl: 'https://solo.atlassian.net', auth: 'cloud', email: 'a@test.com' },
      },
      default: 'solo',
    }));
    writeFileSync(join(configDir, 'credentials.json'), JSON.stringify({
      solo: { apiToken: 'token' },
    }));

    const mockFetch = async () => ({ ok: true, json: async () => cloudFixture });
    const out = captureOutput();
    try {
      await run(['ECNT-100', '--depth=0'], {}, mockFetch, configDir);
      assert.ok(!out.stderr.includes('not configured in any profile'),
        'no mismatch warning when there is only one profile');
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('uses profile when config exists and prefix matches', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ticketlens-'));
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({
      profiles: {
        testprofile: { baseUrl: 'https://profiled.atlassian.net', auth: 'cloud', email: 'p@test.com', ticketPrefixes: ['ADV'] },
      },
      default: 'testprofile',
    }));
    writeFileSync(join(configDir, 'credentials.json'), JSON.stringify({
      testprofile: { apiToken: 'profile-token' },
    }));

    const calls = [];
    const mockFetch = async (url, opts) => {
      calls.push({ url, auth: opts.headers.Authorization });
      return { ok: true, json: async () => cloudFixture };
    };
    const out = captureOutput();
    try {
      await run(['PROD-1234', '--depth=0'], {}, mockFetch, configDir);
      assert.ok(calls[0].url.startsWith('https://profiled.atlassian.net'));
      assert.ok(out.stderr.includes('testprofile'), 'Banner should include profile name');
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
