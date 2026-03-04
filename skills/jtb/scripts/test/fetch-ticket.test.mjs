import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
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
      assert.ok(out.stderr.includes('Missing ticket ID'));
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
      assert.ok(out.stderr.includes('Using profile: testprofile'));
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
