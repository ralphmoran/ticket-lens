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
    // Use a comment from 1 day ago so it stays within any default staleDays threshold
    const recentDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const searchResult = makeSearchResult([
      makeRawTicket('PROD-100', {
        comments: [{
          author: { displayName: 'Sarah QA', accountId: 'user-456', name: 'sqauser' },
          body: 'Please review this PR',
          created: recentDate,
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

  it('suggests ticketlens init when no profile and no env vars are configured', async () => {
    const out = captureOutput();
    try {
      await run([], {}, undefined, '/tmp/nonexistent-ticketlens');
      assert.ok(
        out.stderr.includes('ticketlens init'),
        `Expected stderr to mention 'ticketlens init', got: ${out.stderr}`
      );
    } finally {
      out.restore();
    }
  });

  it('--project alias hint does not say "not a valid flag" (friendly wording)', async () => {
    const configDir = setupConfig();
    const mockFetch = async (url) => {
      if (url.includes('/myself')) return { ok: true, json: async () => myselfResponse };
      if (url.includes('/search')) return { ok: true, json: async () => makeSearchResult([]) };
      return { ok: false, status: 404, statusText: 'Not Found' };
    };

    const out = captureOutput();
    try {
      await run(['--project=testprofile'], {}, mockFetch, configDir);
      assert.ok(
        !out.stderr.includes('not a valid flag'),
        `hint must not say "not a valid flag", got: ${out.stderr}`
      );
      assert.ok(
        out.stderr.includes('alias') || out.stderr.includes('recognized'),
        `hint must confirm --project is recognized as an alias, got: ${out.stderr}`
      );
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('--project alias hint is shown exactly once when profile is not found (no infinite loop)', async () => {
    // Uses a real config dir but with an unknown profile name — exercises the
    // "profile not found → exit with error" path. The hint must appear once only.
    const configDir = setupConfig();
    const out = captureOutput();
    try {
      await run(['--project=nonexistent-profile-xyz'], {}, undefined, configDir);
      const hintCount = (out.stderr.match(/recognized as alias/g) || []).length;
      assert.equal(hintCount, 1, `hint must appear exactly once, got ${hintCount} occurrences`);
      assert.equal(process.exitCode, 1, 'must exit with code 1 when profile is not found');
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('issues fetchCurrentUser and searchTickets concurrently (both in-flight at the same time)', async () => {
    const configDir = setupConfig();
    let inFlight = 0;
    let maxInFlight = 0;

    const mockFetch = async (url) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(r => setImmediate(r)); // yield to event loop so both can start
      inFlight--;
      if (url.includes('/myself')) return { ok: true, json: async () => myselfResponse };
      if (url.includes('/search')) return { ok: true, json: async () => makeSearchResult([]) };
      return { ok: false, status: 404, statusText: 'Not Found' };
    };

    const out = captureOutput();
    try {
      await run([], {}, mockFetch, configDir);
      assert.ok(
        maxInFlight >= 2,
        `Expected fetchCurrentUser + searchTickets to run concurrently, but max in-flight was ${maxInFlight}`
      );
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('escapes double-quotes in status values to prevent JQL injection', async () => {
    const configDir = setupConfig();
    let capturedJql = '';

    const mockFetch = async (url) => {
      if (url.includes('/myself')) return { ok: true, json: async () => myselfResponse };
      if (url.includes('/search')) {
        capturedJql = new URL(url).searchParams.get('jql') || '';
        return { ok: true, json: async () => makeSearchResult([]) };
      }
      return { ok: false, status: 404, statusText: 'Not Found' };
    };

    const out = captureOutput();
    try {
      // Status name contains an embedded double-quote — classic JQL injection attempt
      await run(['--status=Normal,Bad"Status'], {}, mockFetch, configDir);
      // The raw unescaped quote must not appear as a JQL string terminator
      assert.ok(
        !capturedJql.match(/"Bad"Status/),
        `raw unescaped " in status must not appear in JQL, got: ${capturedJql}`
      );
      // The escaped form must be present instead
      assert.ok(
        capturedJql.includes('\\"'),
        `embedded " must be escaped as \\" in JQL, got: ${capturedJql}`
      );
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('errors and suggests closest flag when an unknown flag is passed', async () => {
    const configDir = setupConfig();
    const out = captureOutput();
    try {
      // --state=5 is a typo of --stale=5; the command must stop, not continue
      await run(['--state=5'], {}, undefined, configDir);
      assert.ok(
        out.stderr.includes('--state'),
        `should mention the unknown flag --state, got: ${out.stderr}`
      );
      assert.ok(
        out.stderr.includes('--stale'),
        `should suggest --stale as the closest match, got: ${out.stderr}`
      );
      assert.equal(process.exitCode, 1, 'must exit with code 1 so the command does not continue');
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('--assignee flag uses assignee name in JQL instead of currentUser()', async () => {
    const configDir = setupConfig();
    // Write a team license so the flag is not gated
    writeFileSync(join(configDir, 'license.json'), JSON.stringify({ tier: 'team', key: 'test-key' }));
    let capturedJql = '';

    const mockFetch = async (url) => {
      if (url.includes('/myself')) return { ok: true, json: async () => myselfResponse };
      if (url.includes('/search')) {
        capturedJql = new URL(url).searchParams.get('jql') || '';
        return { ok: true, json: async () => makeSearchResult([]) };
      }
      return { ok: false, status: 404, statusText: 'Not Found' };
    };

    const out = captureOutput();
    try {
      await run(['--assignee=Jane Dev'], {}, mockFetch, configDir);
      assert.ok(capturedJql.includes('Jane Dev'), `JQL must include the assignee name, got: ${capturedJql}`);
      assert.ok(!capturedJql.includes('currentUser()'), `JQL must not use currentUser() when --assignee is set, got: ${capturedJql}`);
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('--sprint flag appends sprint clause to JQL', async () => {
    const configDir = setupConfig();
    writeFileSync(join(configDir, 'license.json'), JSON.stringify({ tier: 'team', key: 'test-key' }));
    let capturedJql = '';

    const mockFetch = async (url) => {
      if (url.includes('/myself')) return { ok: true, json: async () => myselfResponse };
      if (url.includes('/search')) {
        capturedJql = new URL(url).searchParams.get('jql') || '';
        return { ok: true, json: async () => makeSearchResult([]) };
      }
      return { ok: false, status: 404, statusText: 'Not Found' };
    };

    const out = captureOutput();
    try {
      await run(['--sprint=Sprint 12'], {}, mockFetch, configDir);
      assert.ok(capturedJql.includes('sprint'), `JQL must include sprint clause, got: ${capturedJql}`);
      assert.ok(capturedJql.includes('Sprint 12'), `JQL must include sprint name, got: ${capturedJql}`);
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('--assignee and --sprint together produce correct combined JQL', async () => {
    const configDir = setupConfig();
    writeFileSync(join(configDir, 'license.json'), JSON.stringify({ tier: 'team', key: 'test-key' }));
    let capturedJql = '';

    const mockFetch = async (url) => {
      if (url.includes('/myself')) return { ok: true, json: async () => myselfResponse };
      if (url.includes('/search')) {
        capturedJql = new URL(url).searchParams.get('jql') || '';
        return { ok: true, json: async () => makeSearchResult([]) };
      }
      return { ok: false, status: 404, statusText: 'Not Found' };
    };

    const out = captureOutput();
    try {
      await run(['--assignee=Jane Dev', '--sprint=Sprint 12'], {}, mockFetch, configDir);
      assert.ok(capturedJql.includes('Jane Dev'), `JQL must include assignee name, got: ${capturedJql}`);
      assert.ok(capturedJql.includes('Sprint 12'), `JQL must include sprint name, got: ${capturedJql}`);
      assert.ok(!capturedJql.includes('currentUser()'), `JQL must not use currentUser(), got: ${capturedJql}`);
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('--assignee is blocked without a Team license', async () => {
    const configDir = setupConfig();
    // No license.json → free tier

    const out = captureOutput();
    try {
      await run(['--assignee=Jane Dev'], {}, undefined, configDir);
      assert.ok(out.stderr.includes('Team'), `must mention Team tier requirement, got: ${out.stderr}`);
      assert.equal(process.exitCode, 1, 'must exit with code 1 when license is insufficient');
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('--sprint is blocked without a Team license', async () => {
    const configDir = setupConfig();
    // No license.json → free tier

    const out = captureOutput();
    try {
      await run(['--sprint=Sprint 12'], {}, undefined, configDir);
      assert.ok(out.stderr.includes('Team'), `must mention Team tier requirement, got: ${out.stderr}`);
      assert.equal(process.exitCode, 1, 'must exit with code 1 when license is insufficient');
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('--assignee escapes embedded double-quotes for JQL safety', async () => {
    const configDir = setupConfig();
    writeFileSync(join(configDir, 'license.json'), JSON.stringify({ tier: 'team', key: 'test-key' }));
    let capturedJql = '';

    const mockFetch = async (url) => {
      if (url.includes('/myself')) return { ok: true, json: async () => myselfResponse };
      if (url.includes('/search')) {
        capturedJql = new URL(url).searchParams.get('jql') || '';
        return { ok: true, json: async () => makeSearchResult([]) };
      }
      return { ok: false, status: 404, statusText: 'Not Found' };
    };

    const out = captureOutput();
    try {
      await run(['--assignee=Bad"Name'], {}, mockFetch, configDir);
      assert.ok(!capturedJql.match(/"Bad"Name/), `raw unescaped " must not appear in JQL, got: ${capturedJql}`);
      assert.ok(capturedJql.includes('\\"'), `embedded " must be escaped as \\" in JQL, got: ${capturedJql}`);
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('--assignee and --sprint are recognized as valid flags (no unknown flag warning)', async () => {
    const configDir = setupConfig();
    writeFileSync(join(configDir, 'license.json'), JSON.stringify({ tier: 'team', key: 'test-key' }));
    const mockFetch = async (url) => {
      if (url.includes('/myself')) return { ok: true, json: async () => myselfResponse };
      if (url.includes('/search')) return { ok: true, json: async () => makeSearchResult([]) };
      return { ok: false, status: 404, statusText: 'Not Found' };
    };

    const out = captureOutput();
    try {
      await run(['--assignee=Jane Dev', '--sprint=Sprint 12'], {}, mockFetch, configDir);
      assert.ok(!out.stderr.includes('Unknown flag'), `--assignee and --sprint must not trigger unknown flag warning, got: ${out.stderr}`);
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('does not warn about recognized flags', async () => {
    const configDir = setupConfig();
    const mockFetch = async (url) => {
      if (url.includes('/myself')) return { ok: true, json: async () => myselfResponse };
      if (url.includes('/search')) return { ok: true, json: async () => makeSearchResult([]) };
      return { ok: false, status: 404, statusText: 'Not Found' };
    };

    const out = captureOutput();
    try {
      await run(['--stale=3', '--plain'], {}, mockFetch, configDir);
      assert.ok(
        !out.stderr.includes('Unknown flag'),
        `known flags must not trigger a warning, got: ${out.stderr}`
      );
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
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

const mockEnv = {
  JIRA_BASE_URL: 'https://test.atlassian.net',
  JIRA_EMAIL: 'john@example.com',
  JIRA_API_TOKEN: 'test-token',
};

const mockFetcher = async (url) => {
  if (url.includes('/myself')) return { ok: true, json: async () => myselfResponse };
  if (url.includes('/search')) return { ok: true, json: async () => makeSearchResult([]) };
  return { ok: false, status: 404, statusText: 'Not Found' };
};

describe('triage --export', () => {
  it('calls exportTriage with csv format when --export=csv provided', async () => {
    const exported = [];
    const out = captureOutput();
    try {
      await run(['triage', '--export=csv'], {
        env: mockEnv,
        fetcher: mockFetcher,
        exporter: ({ format }) => { exported.push(format); return '/tmp/test.csv'; },
        isLicensed: () => true,
      });
      assert.deepEqual(exported, ['csv']);
    } finally {
      out.restore();
    }
  });

  it('calls exportTriage with json format when --export=json provided', async () => {
    const exported = [];
    const out = captureOutput();
    try {
      await run(['triage', '--export=json'], {
        env: mockEnv,
        fetcher: mockFetcher,
        exporter: ({ format }) => { exported.push(format); return '/tmp/test.json'; },
        isLicensed: () => true,
      });
      assert.deepEqual(exported, ['json']);
    } finally {
      out.restore();
    }
  });

  it('shows upgrade prompt when --export used without Team license', async () => {
    const prompts = [];
    const out = captureOutput();
    try {
      await run(['triage', '--export=csv'], {
        env: mockEnv,
        fetcher: mockFetcher,
        isLicensed: () => false,
        showUpgradePrompt: (tier, flag) => prompts.push({ tier, flag }),
      });
      assert.equal(prompts.length, 1);
      assert.equal(prompts[0].tier, 'team');
    } finally {
      out.restore();
    }
  });

  it('prints export path to stdout after writing', async () => {
    const output = [];
    const out = captureOutput();
    try {
      await run(['triage', '--export=csv'], {
        env: mockEnv,
        fetcher: mockFetcher,
        exporter: () => '/tmp/export.csv',
        isLicensed: () => true,
        print: (msg) => output.push(msg),
      });
      assert.ok(output.some(m => m.includes('/tmp/export.csv')));
    } finally {
      out.restore();
    }
  });
});
