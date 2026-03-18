import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../fetch-my-tickets.mjs';

const myselfResponse = {
  accountId: 'user-123',
  name: 'jdev',
  displayName: 'John Dev',
  emailAddress: 'john@example.com',
};

function makeSearchResult(tickets) {
  return { issues: tickets };
}

function makeRawTicket(key, overrides = {}) {
  return {
    key,
    fields: {
      summary: overrides.summary ?? `Ticket ${key}`,
      issuetype: { name: 'Task' },
      status: { name: overrides.status ?? 'In Progress' },
      priority: { name: 'Medium' },
      assignee: { displayName: 'John Dev', accountId: 'user-123' },
      updated: overrides.updated ?? '2026-03-05T10:00:00Z',
      comment: {
        comments: overrides.comments ?? [],
      },
      issuelinks: [],
      labels: [],
      components: [],
      attachment: [],
      ...overrides.fields,
    },
  };
}

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

function setupConfig() {
  const configDir = mkdtempSync(join(tmpdir(), 'ticketlens-'));
  writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({
    profiles: {
      testprofile: {
        baseUrl: 'https://test.atlassian.net',
        auth: 'cloud',
        email: 'john@example.com',
        ticketPrefixes: ['ADV'],
        projectPaths: ['/tmp/my-project'],
      },
    },
    default: 'testprofile',
  }));
  writeFileSync(join(configDir, 'credentials.json'), JSON.stringify({
    testprofile: { apiToken: 'test-token' },
  }));
  return configDir;
}

describe('fetch-my-tickets integration', () => {
  it('outputs triage summary with mocked fetch', async () => {
    const configDir = setupConfig();
    const searchResult = makeSearchResult([
      makeRawTicket('PROD-100', {
        comments: [{
          author: { displayName: 'Sarah QA', accountId: 'user-456', name: 'sqauser' },
          body: 'Please review this PR',
          created: '2026-03-05T10:00:00Z',
        }],
      }),
    ]);

    const mockFetch = async (url) => {
      if (url.includes('/myself')) return { ok: true, json: async () => myselfResponse };
      if (url.includes('/search')) return { ok: true, json: async () => searchResult };
      return { ok: false, status: 404, statusText: 'Not Found' };
    };

    const out = captureOutput();
    try {
      await run([], {}, mockFetch, configDir);
      assert.ok(out.stdout.includes('PROD-100'));
      assert.ok(out.stdout.includes('Needs Response'));
      assert.ok(out.stdout.includes('Sarah QA'));
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('constructs correct JQL from --stale and --status args', async () => {
    const configDir = setupConfig();
    let capturedUrl = '';

    const mockFetch = async (url) => {
      if (url.includes('/myself')) return { ok: true, json: async () => myselfResponse };
      if (url.includes('/search')) {
        capturedUrl = url;
        return { ok: true, json: async () => makeSearchResult([]) };
      }
      return { ok: false, status: 404, statusText: 'Not Found' };
    };

    const out = captureOutput();
    try {
      await run(['--stale=3', '--status=QA,CR'], {}, mockFetch, configDir);
      assert.ok(capturedUrl.includes('QA'));
      assert.ok(capturedUrl.includes('CR'));
      assert.ok(out.stdout.includes('All clear'));
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('errors when no profile can be resolved and no env vars', async () => {
    const out = captureOutput();
    try {
      await run([], {}, undefined, '/tmp/nonexistent-ticketlens');
      assert.ok(out.stderr.includes('Could not determine Jira profile'));
      assert.equal(process.exitCode, 1);
    } finally {
      out.restore();
    }
  });

  it('suggests valid statuses when search fails due to invalid status', async () => {
    const configDir = setupConfig();

    const mockFetch = async (url) => {
      if (url.includes('/myself')) return { ok: true, json: async () => myselfResponse };
      if (url.includes('/search')) {
        const err400 = {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({ errorMessages: ["The value 'QA' does not exist for the field 'status'."] }),
        };
        return err400;
      }
      if (url.includes('/status')) {
        return {
          ok: true,
          json: async () => [
            { name: 'In Progress' },
            { name: 'Code Review' },
            { name: 'QA Testing' },
            { name: 'Done' },
            { name: 'Blocked' },
          ],
        };
      }
      return { ok: false, status: 404, statusText: 'Not Found' };
    };

    const out = captureOutput();
    try {
      await run(['--status=In Progress,QA'], {}, mockFetch, configDir);
      assert.equal(process.exitCode, 1);
      assert.ok(out.stderr.includes('Status mismatch'), 'should report status mismatch');
      assert.ok(out.stderr.includes('QA'), 'should show the invalid status name');
      assert.ok(out.stderr.includes('QA Testing'), 'should suggest the corrected status');
      assert.ok(out.stderr.includes('triageStatuses'), 'should show the fix hint');
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
