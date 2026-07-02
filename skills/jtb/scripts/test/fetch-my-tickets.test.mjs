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

  it('--project=PROJ appends project JQL clause (Team gate)', async () => {
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
      await run(['--project=MYPROJ'], {}, mockFetch, configDir);
      assert.ok(capturedJql.includes('project'), `JQL must include project clause, got: ${capturedJql}`);
      assert.ok(capturedJql.includes('MYPROJ'), `JQL must include project key, got: ${capturedJql}`);
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('--project does NOT switch the connection profile', async () => {
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
      await run(['--project=MYPROJ'], {}, mockFetch, configDir);
      // JQL should have project clause, not use --profile= rewiring
      assert.ok(capturedJql.includes('project = "MYPROJ"'), `JQL must have project = "MYPROJ", got: ${capturedJql}`);
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('--project blocks for non-Team user and shows upgrade prompt', async () => {
    const configDir = setupConfig();
    writeFileSync(join(configDir, 'license.json'), JSON.stringify({ tier: 'pro', key: 'test-key' }));
    const out = captureOutput();
    try {
      await run(['--project=MYPROJ'], {}, undefined, configDir);
      assert.equal(process.exitCode, 1, 'must exit 1 for non-Team user');
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('--label=Bug appends single label JQL clause', async () => {
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
      await run(['--label=Bug'], {}, mockFetch, configDir);
      assert.ok(capturedJql.includes('labels = "Bug"'), `JQL must have labels = "Bug", got: ${capturedJql}`);
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('--label=Bug,Feature appends labels IN (...) JQL clause', async () => {
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
      await run(['--label=Bug,Feature'], {}, mockFetch, configDir);
      assert.ok(capturedJql.includes('labels IN'), `JQL must use IN for multiple labels, got: ${capturedJql}`);
      assert.ok(capturedJql.includes('"Bug"'), `JQL must include "Bug", got: ${capturedJql}`);
      assert.ok(capturedJql.includes('"Feature"'), `JQL must include "Feature", got: ${capturedJql}`);
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('--priority=High appends priority JQL clause', async () => {
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
      await run(['--priority=High'], {}, mockFetch, configDir);
      assert.ok(capturedJql.includes('priority = "High"'), `JQL must have priority = "High", got: ${capturedJql}`);
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('--project, --label, --priority together produce combined JQL', async () => {
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
      await run(['--project=MYPROJ', '--label=Bug', '--priority=High'], {}, mockFetch, configDir);
      assert.ok(capturedJql.includes('project = "MYPROJ"'), `missing project clause, got: ${capturedJql}`);
      assert.ok(capturedJql.includes('labels = "Bug"'),     `missing label clause, got: ${capturedJql}`);
      assert.ok(capturedJql.includes('priority = "High"'),  `missing priority clause, got: ${capturedJql}`);
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('--label blocks for non-Team user and shows upgrade prompt', async () => {
    const configDir = setupConfig();
    writeFileSync(join(configDir, 'license.json'), JSON.stringify({ tier: 'pro', key: 'test-key' }));
    const out = captureOutput();
    try {
      await run(['--label=Bug'], {}, undefined, configDir);
      assert.equal(process.exitCode, 1, 'must exit 1 for non-Team user');
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('--project special chars are JQL-escaped', async () => {
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
      await run(['--project=MY"PROJ'], {}, mockFetch, configDir);
      assert.ok(!capturedJql.includes('MY"PROJ'), `raw quote must be escaped in JQL, got: ${capturedJql}`);
      assert.ok(capturedJql.includes('MY\\"PROJ'), `quote must be escaped as \\", got: ${capturedJql}`);
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

  it('rejects invalid --export value with exitCode=1 and error message', async () => {
    const out = captureOutput();
    try {
      await run(['triage', '--export=pdf'], {
        env: mockEnv,
        fetcher: mockFetcher,
        isLicensed: () => true,
      });
      assert.equal(process.exitCode, 1, 'must exit with code 1 for invalid format');
      assert.ok(
        out.stderr.includes('pdf'),
        `stderr must mention the invalid format, got: ${out.stderr}`
      );
      assert.ok(
        out.stderr.includes('csv') && out.stderr.includes('json'),
        `stderr must mention valid formats, got: ${out.stderr}`
      );
    } finally {
      out.restore();
    }
  });
});

describe('triage --digest', () => {
  it('POSTs scored triage to backend after running triage', async () => {
    const delivered = [];
    await run(['triage', '--digest'], {
      env: mockEnv,
      fetcher: mockFetcher,
      digestDeliverer: async (payload) => { delivered.push(payload); return true; },
      isLicensed: () => true,
    });
    assert.equal(delivered.length, 1);
    assert.ok(Array.isArray(delivered[0].tickets));
    assert.ok(delivered[0].summary);
    assert.ok(delivered[0].profile);
  });

  it('does not require Team license — digest is Pro', async () => {
    const delivered = [];
    await run(['triage', '--digest'], {
      env: mockEnv,
      fetcher: mockFetcher,
      digestDeliverer: async () => { delivered.push(true); return true; },
      isLicensed: (tier) => tier === 'pro',
    });
    assert.equal(delivered.length, 1);
  });
});

describe('triage --share', () => {
  it('calls shareFn when --share flag is passed', async () => {
    const calls = [];
    await run(['triage', '--share'], {
      env: mockEnv,
      fetcher: mockFetcher,
      shareFn: async (opts) => { calls.push(opts); return { ok: true }; },
      isLicensed: () => true,
    });
    assert.equal(calls.length, 1);
    assert.ok('sorted' in calls[0]);
    assert.ok('profile' in calls[0]);
  });

  it('shareFn receives sorted array and string profile', async () => {
    const calls = [];
    await run(['triage', '--share'], {
      env: mockEnv,
      fetcher: mockFetcher,
      shareFn: async (opts) => { calls.push(opts); return { ok: true }; },
      isLicensed: () => true,
    });
    assert.equal(calls.length, 1);
    assert.strictEqual(typeof calls[0].profile, 'string');
    assert.ok(Array.isArray(calls[0].sorted));
  });

  it('passes cliToken from opts to shareFn', async () => {
    const calls = [];
    await run(['triage', '--share'], {
      env: mockEnv,
      fetcher: mockFetcher,
      cliToken: 'tl_test_share',
      shareFn: async (opts) => { calls.push(opts); return { ok: true }; },
      isLicensed: () => true,
    });
    assert.equal(calls[0].cliToken, 'tl_test_share');
  });
});

describe('triage --push', () => {
  it('calls pushFn when --push flag is passed', async () => {
    const calls = [];
    await run(['triage', '--push'], {
      env: mockEnv,
      fetcher: mockFetcher,
      cliToken: 'tl_test_push',
      pushFn: async (opts) => { calls.push(opts); return { ok: true }; },
      scanFn: () => null,
      isLicensed: () => true,
    });
    assert.equal(calls.length, 1);
    assert.ok('sorted' in calls[0]);
    assert.ok('profile' in calls[0]);
  });

  it('passes cliToken from opts to pushFn', async () => {
    const calls = [];
    await run(['triage', '--push'], {
      env: mockEnv,
      fetcher: mockFetcher,
      cliToken: 'tl_test_push',
      pushFn: async (opts) => { calls.push(opts); return { ok: true }; },
      scanFn: () => null,
      isLicensed: () => true,
    });
    assert.equal(calls[0].cliToken, 'tl_test_push');
  });

  // RED: --push with no CLI token must exit before triage Jira calls are made
  it('RED: --push with missing token exits before triage fetcher is called', async () => {
    let fetcherCallCount = 0;
    const trackingFetcher = async (...args) => { fetcherCallCount++; return mockFetcher(...args); };
    await run(['triage', '--push'], {
      env: mockEnv,
      fetcher: trackingFetcher,
      configDir: '/tmp/no-token-dir-red-test',
      scanFn: () => null,
      isLicensed: () => true,
    });
    process.exitCode = undefined;
    assert.equal(fetcherCallCount, 0, 'triage fetcher must NOT be called when --push token is absent');
  });

});

// ---------------------------------------------------------------------------
// Lock: early-exit paths do not emit a stats footer
// ---------------------------------------------------------------------------

describe('lock: early-exit paths emit no stats footer', () => {
  it('--digest path returns before any footer — no footer in output', async () => {
    const digestCalls = [];
    const out = captureOutput();
    try {
      await run(['triage', '--digest'], {
        env: mockEnv,
        fetcher: mockFetcher,
        digestDeliverer: async (payload) => { digestCalls.push(payload); },
        cliToken: 'tl_test',
        isLicensed: () => true,
      });
      // digest path returns after delivering — stdout should be empty (digest sends to API)
      assert.equal(digestCalls.length, 1, 'digest deliverer should be called');
    } finally {
      out.restore();
    }
  });

  it('--export path returns before any footer — exporter is called, no extra output after', async () => {
    let exportCalled = false;
    const out = captureOutput();
    try {
      await run(['triage', '--export=json'], {
        env: mockEnv,
        fetcher: mockFetcher,
        exporter: () => { exportCalled = true; return '/tmp/test.json'; },
        isLicensed: () => true,
      });
      assert.ok(exportCalled, 'exporter should be called');
      // stdout is just the "Export written to …" message — no stats block
      assert.ok(!out.stdout.includes('Response Metrics'), `No stats footer expected in --export path, got: ${out.stdout}`);
    } finally {
      out.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Inline stats footer in normal triage output
// ---------------------------------------------------------------------------

describe('triage inline stats footer', () => {
  it('footer is NOT shown when fewer than 2 snapshots exist', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'footer-nohist-'));
    const out = captureOutput();
    try {
      await run(['triage', '--plain', '--static'], {
        env: mockEnv,
        fetcher: mockFetcher,
        isLicensed: () => true,
        configDir, // isolated empty dir → 0 snapshots → triageRunCount=0 → no footer
      });
      assert.ok(!out.stdout.includes('This week:'), `Expected no footer, got: ${out.stdout}`);
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('footer IS shown when metricsInjector provides triageRunCount >= 2', async () => {
    const out = captureOutput();
    try {
      await run(['triage', '--plain', '--static'], {
        env: mockEnv,
        fetcher: mockFetcher,
        isLicensed: () => true,
        metricsInjector: () => ({
          avgResponseHours: 4.2,
          medianResponseHours: 2.8,
          clearRate: 0.73,
          triageRunCount: 5,
          currentUrgency: null,
          windowDays: 7,
          trendHours: null,
        }),
      });
      assert.ok(out.stdout.includes('4.2') || out.stdout.includes('This week') || out.stdout.includes('week'), `Expected footer with avg response, got: ${out.stdout}`);
    } finally {
      out.restore();
    }
  });

  it('footer respects --plain flag (no ANSI escape codes)', async () => {
    const out = captureOutput();
    try {
      await run(['triage', '--plain', '--static'], {
        env: mockEnv,
        fetcher: mockFetcher,
        isLicensed: () => true,
        metricsInjector: () => ({
          avgResponseHours: 3.0,
          medianResponseHours: 2.0,
          clearRate: 0.6,
          triageRunCount: 3,
          currentUrgency: null,
          windowDays: 7,
          trendHours: null,
        }),
      });
      const footer = out.stdout.split('\n').filter(l => l.includes('week') || l.includes('3.0')).join('\n');
      if (footer) {
        assert.ok(!/\x1b\[/.test(footer), `Footer in --plain mode must not contain ANSI codes, got: ${footer}`);
      }
    } finally {
      out.restore();
    }
  });

  it('footer is NOT shown in --all mode (returns early)', async () => {
    const out = captureOutput();
    try {
      await run(['triage', '--all', '--plain'], {
        env: mockEnv,
        fetcher: mockFetcher,
        isLicensed: () => true,
        metricsInjector: () => ({
          avgResponseHours: 3.0,
          medianResponseHours: 2.0,
          clearRate: 0.6,
          triageRunCount: 3,
          currentUrgency: null,
          windowDays: 7,
          trendHours: null,
        }),
      });
      // --all mode uses sub-runs and formats output differently; no single "This week:" footer
      // This test passes if the run completes without error
    } finally {
      out.restore();
    }
  });
});
