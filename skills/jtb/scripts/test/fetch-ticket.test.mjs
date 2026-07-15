import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { run } from '../fetch-ticket.mjs';
import { writeDigest } from '../lib/recall-vault.mjs';

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

  it('rejects invalid ticket key format with clear error', async () => {
    const out = captureOutput();
    try {
      await run(['not-a-ticket'], validEnv, undefined, NO_CONFIG);
      assert.ok(out.stderr.includes('not a valid ticket key'), `should reject invalid format, got: ${out.stderr}`);
      assert.ok(out.stderr.includes('PROJ-123'), 'should show expected format');
      assert.equal(process.exitCode, 1);
    } finally {
      out.restore();
    }
  });

  it('rejects lowercase ticket key', async () => {
    const out = captureOutput();
    try {
      await run(['proj-123'], validEnv, undefined, NO_CONFIG);
      assert.ok(out.stderr.includes('not a valid ticket key'), `should reject lowercase key, got: ${out.stderr}`);
      assert.equal(process.exitCode, 1);
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

  it('suggests ticketlens init when no profile and no env vars are configured', async () => {
    const out = captureOutput();
    try {
      await run(['PROD-1234'], {}, undefined, NO_CONFIG);
      assert.ok(
        out.stderr.includes('ticketlens init'),
        `Expected stderr to mention 'ticketlens init', got: ${out.stderr}`
      );
    } finally {
      out.restore();
    }
  });

  it('API failure outputs error to stderr and sets exit code 1', async () => {
    const mockFetch = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' });
    const out = captureOutput();
    try {
      await run(['PROD-1234', '--no-cache'], validEnv, mockFetch, NO_CONFIG);
      assert.ok(out.stderr.includes('500'));
      assert.equal(process.exitCode, 1);
    } finally {
      out.restore();
    }
  });

  it('connection failure in non-TTY exits without retry prompt', async () => {
    // Simulates a network error — non-TTY should exit with code 1, no menu shown
    const mockFetch = async () => { throw new Error('connect ECONNREFUSED'); };
    const out = captureOutput();
    try {
      await run(['PROD-1234', '--no-cache'], validEnv, mockFetch, NO_CONFIG);
      assert.equal(process.exitCode, 1);
      // No retry menu characters should appear — stderr is non-TTY
      assert.ok(!out.stderr.includes('Retry'), 'no retry menu in non-TTY');
    } finally {
      out.restore();
    }
  });

  it('uses first matching profile when multiple profiles share a prefix (non-TTY)', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ticketlens-'));
    // Both profiles have 'PROD' prefix — non-TTY skips picker, first match wins
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({
      profiles: {
        alpha: { baseUrl: 'https://alpha.atlassian.net', auth: 'cloud', email: 'a@test.com', ticketPrefixes: ['PROD'] },
        beta:  { baseUrl: 'https://beta.atlassian.net',  auth: 'cloud', email: 'b@test.com', ticketPrefixes: ['PROD'] },
      },
      default: 'alpha',
    }));
    writeFileSync(join(configDir, 'credentials.json'), JSON.stringify({
      alpha: { apiToken: 'token-a' },
      beta:  { apiToken: 'token-b' },
    }));

    const calls = [];
    const mockFetch = async (url, opts) => {
      calls.push(url);
      return { ok: true, json: async () => cloudFixture };
    };
    const out = captureOutput();
    try {
      // non-TTY → promptMultipleMatches not triggered → resolveConnection picks alpha (first)
      await run(['PROD-1234', '--depth=0'], {}, mockFetch, configDir);
      assert.ok(calls[0].startsWith('https://alpha.atlassian.net'), 'should use first matching profile in non-TTY');
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
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

  it('--depth=1 does not trigger upgrade prompt', async () => {
    const mockFetch = async () => ({ ok: true, json: async () => cloudFixture });
    const out = captureOutput();
    try {
      await run(['PROD-1234', '--depth=1'], validEnv, mockFetch, NO_CONFIG);
      // Depth 1 is free — should not show upgrade prompt
      assert.ok(!out.stderr.includes('requires Pro'), 'depth=1 must not trigger upgrade prompt');
    } finally {
      out.restore();
    }
  });
});

describe('Recall injection', () => {
  function withRecallConfigDir() {
    const configDir = mkdtempSync(join(tmpdir(), 'ticketlens-recall-'));
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({
      profiles: { work: { baseUrl: 'https://test.atlassian.net', auth: 'server', ticketPrefixes: ['PROD'] } },
      default: 'work',
    }));
    writeFileSync(join(configDir, 'credentials.json'), JSON.stringify({
      work: { pat: 'test-token' },
    }));
    return configDir;
  }

  function withProLicense(run) {
    const prev = process.env.TICKETLENS_SKIP_LICENSE;
    process.env.TICKETLENS_SKIP_LICENSE = 'true';
    return run().finally(() => {
      if (prev === undefined) delete process.env.TICKETLENS_SKIP_LICENSE;
      else process.env.TICKETLENS_SKIP_LICENSE = prev;
    });
  }

  it('a Pro user with a matching saved note sees it injected into the brief', async () => {
    const configDir = withRecallConfigDir();
    writeDigest(
      { title: 'Payment validation gotcha', ticketKeys: ['PROD-1234'], tags: [], author: 'ralph', body: 'Empty carts need a special case.' },
      { configDir },
    );
    const mockFetch = async () => ({ ok: true, json: async () => cloudFixture });
    const out = captureOutput();
    try {
      await withProLicense(() => run(['PROD-1234', '--depth=0', '--no-cache'], {}, mockFetch, configDir));
      assert.ok(out.stdout.includes('Recall'), `expected a Recall section, got: ${out.stdout.slice(0, 400)}`);
      assert.ok(out.stdout.includes('Payment validation gotcha'));
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('the same note also appears in styled (--styled) output', async () => {
    const configDir = withRecallConfigDir();
    writeDigest(
      { title: 'Payment validation gotcha', ticketKeys: ['PROD-1234'], tags: [], author: 'ralph', body: 'Empty carts need a special case.' },
      { configDir },
    );
    const mockFetch = async () => ({ ok: true, json: async () => cloudFixture });
    const out = captureOutput();
    try {
      await withProLicense(() => run(['PROD-1234', '--depth=0', '--no-cache', '--styled'], {}, mockFetch, configDir));
      assert.ok(out.stdout.includes('Recall'));
      assert.ok(out.stdout.includes('Payment validation gotcha'));
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('a non-Pro user never sees a saved note, even with an exact ticket match', async () => {
    const configDir = withRecallConfigDir();
    writeDigest(
      { title: 'Payment validation gotcha', ticketKeys: ['PROD-1234'], tags: [], author: 'ralph', body: 'Empty carts need a special case.' },
      { configDir },
    );
    const mockFetch = async () => ({ ok: true, json: async () => cloudFixture });
    const out = captureOutput();
    try {
      await run(['PROD-1234', '--depth=0', '--no-cache'], {}, mockFetch, configDir);
      assert.ok(!out.stdout.includes('Payment validation gotcha'));
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('a Recall-injected brief increments the briefs_with_recall_injection counter', async () => {
    const configDir = withRecallConfigDir();
    writeDigest(
      { title: 'Payment validation gotcha', ticketKeys: ['PROD-1234'], tags: [], author: 'ralph', body: 'Empty carts need a special case.' },
      { configDir },
    );
    const mockFetch = async () => ({ ok: true, json: async () => cloudFixture });
    const out = captureOutput();
    try {
      await withProLicense(() => run(['PROD-1234', '--depth=0', '--no-cache'], {}, mockFetch, configDir));
      const activity = JSON.parse(readFileSync(join(configDir, 'activity.json'), 'utf8'));
      assert.equal(activity.briefs_with_recall_injection, 1);
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('a ticket with no matching notes never renders a Recall section, even for a Pro user', async () => {
    const configDir = withRecallConfigDir();
    const mockFetch = async () => ({ ok: true, json: async () => cloudFixture });
    const out = captureOutput();
    try {
      await withProLicense(() => run(['PROD-1234', '--depth=0', '--no-cache'], {}, mockFetch, configDir));
      assert.ok(!out.stdout.includes('## Recall'));
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('more than 3 matching notes: only 3 are injected in full, plus a pointer to `ticketlens recall` for the rest', async () => {
    const configDir = withRecallConfigDir();
    for (let i = 1; i <= 5; i++) {
      writeDigest(
        { title: `Gotcha ${i}`, ticketKeys: ['PROD-1234'], tags: [], author: 'ralph', body: `Body ${i}.` },
        { configDir },
      );
    }
    const mockFetch = async () => ({ ok: true, json: async () => cloudFixture });
    const out = captureOutput();
    try {
      await withProLicense(() => run(['PROD-1234', '--depth=0', '--no-cache'], {}, mockFetch, configDir));
      const gotchaCount = (out.stdout.match(/Gotcha \d/g) ?? []).length;
      assert.equal(gotchaCount, 3, `expected exactly 3 notes injected in full, got: ${out.stdout}`);
      assert.match(out.stdout, /2 more Recall notes linked to PROD-1234/);
      assert.match(out.stdout, /ticketlens recall PROD-1234/);
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

describe('Gap-diff injection', () => {
  function withRecallConfigDir() {
    const configDir = mkdtempSync(join(tmpdir(), 'ticketlens-gapdiff-'));
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({
      profiles: { work: { baseUrl: 'https://test.atlassian.net', auth: 'server', ticketPrefixes: ['PROD'] } },
      default: 'work',
    }));
    writeFileSync(join(configDir, 'credentials.json'), JSON.stringify({
      work: { pat: 'test-token' },
    }));
    return configDir;
  }

  function withProLicense(run) {
    const prev = process.env.TICKETLENS_SKIP_LICENSE;
    process.env.TICKETLENS_SKIP_LICENSE = 'true';
    return run().finally(() => {
      if (prev === undefined) delete process.env.TICKETLENS_SKIP_LICENSE;
      else process.env.TICKETLENS_SKIP_LICENSE = prev;
    });
  }

  const stubGaps = [{ requirement: 'must support exponential backoff', sourceType: 'ticket', sourceKey: 'PROD-9', sourceSummary: 'Related work' }];
  const mockFetch = async () => ({ ok: true, json: async () => cloudFixture });

  it('a Pro user sees gaps injected into the brief when computeGaps returns entries', async () => {
    const configDir = withRecallConfigDir();
    const out = captureOutput();
    try {
      await withProLicense(() => run(
        ['PROD-1234', '--depth=0', '--no-cache'],
        { env: {}, fetcher: mockFetch, configDir, gapDiff: { computeGaps: () => stubGaps } },
      ));
      assert.ok(out.stdout.includes('## Gaps'), `expected a Gaps section, got: ${out.stdout.slice(0, 400)}`);
      assert.ok(out.stdout.includes('must support exponential backoff'));
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('the same gaps also appear in styled (--styled) output', async () => {
    const configDir = withRecallConfigDir();
    const out = captureOutput();
    try {
      await withProLicense(() => run(
        ['PROD-1234', '--depth=0', '--no-cache', '--styled'],
        { env: {}, fetcher: mockFetch, configDir, gapDiff: { computeGaps: () => stubGaps } },
      ));
      assert.ok(out.stdout.includes('Gaps'));
      assert.ok(out.stdout.includes('must support exponential backoff'));
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('a non-Pro user never sees a Gaps section, and computeGaps is never even called', async () => {
    const configDir = withRecallConfigDir();
    const out = captureOutput();
    try {
      await run(
        ['PROD-1234', '--depth=0', '--no-cache'],
        { env: {}, fetcher: mockFetch, configDir, gapDiff: { computeGaps: () => { throw new Error('must not be called for a non-Pro user'); } } },
      );
      assert.ok(!out.stdout.includes('## Gaps'));
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('an empty gaps array renders no Gaps section, even for a Pro user', async () => {
    const configDir = withRecallConfigDir();
    const out = captureOutput();
    try {
      await withProLicense(() => run(
        ['PROD-1234', '--depth=0', '--no-cache'],
        { env: {}, fetcher: mockFetch, configDir, gapDiff: { computeGaps: () => [] } },
      ));
      assert.ok(!out.stdout.includes('## Gaps'));
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('a throwing computeGaps does not abort the brief — output still renders without a Gaps section', async () => {
    const configDir = withRecallConfigDir();
    const out = captureOutput();
    try {
      await withProLicense(() => run(
        ['PROD-1234', '--depth=0', '--no-cache'],
        { env: {}, fetcher: mockFetch, configDir, gapDiff: { computeGaps: () => { throw new Error('boom'); } } },
      ));
      assert.ok(out.stdout.includes('# PROD-1234'), `brief must still render, got: ${out.stdout.slice(0, 300)}`);
      assert.ok(!out.stdout.includes('## Gaps'));
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

const mockEnv = {
  JIRA_BASE_URL: 'https://test.atlassian.net',
  JIRA_PAT: 'test-token',
};
const mockFetcher = async () => ({ ok: true, json: async () => cloudFixture });

describe('--check flag', () => {
  it('appends diff output to brief when git VCS detected', async () => {
    const output = [];
    await run(['PROJ-1', '--check'], {
      env: mockEnv,
      fetcher: mockFetcher,
      detectVcs: () => 'git',
      getDiff: () => 'diff --git a/foo.php b/foo.php\n+added line\n',
      print: (chunk) => output.push(chunk),
    });
    const combined = output.join('');
    assert.ok(combined.includes('--- DIFF ---'), 'DIFF section missing');
    assert.ok(combined.includes('+added line'), 'diff content missing');
  });

  it('appends diff output when svn VCS detected', async () => {
    const output = [];
    await run(['PROJ-1', '--check'], {
      env: mockEnv,
      fetcher: mockFetcher,
      detectVcs: () => 'svn',
      getDiff: () => 'Index: foo.php\n+added line\n',
      print: (chunk) => output.push(chunk),
    });
    assert.ok(output.join('').includes('+added line'));
  });

  it('prints no-VCS notice when vcs is none', async () => {
    const output = [];
    await run(['PROJ-1', '--check'], {
      env: mockEnv,
      fetcher: mockFetcher,
      detectVcs: () => 'none',
      getDiff: () => null,
      print: (chunk) => output.push(chunk),
    });
    assert.ok(output.join('').includes('No VCS detected'), 'no-VCS notice missing');
  });

  it('does not interpolate diff into any shell command', async () => {
    const maliciousDiff = 'diff\n; rm -rf /\n';
    const output = [];
    await run(['PROJ-1', '--check'], {
      env: mockEnv,
      fetcher: mockFetcher,
      detectVcs: () => 'git',
      getDiff: () => maliciousDiff,
      print: (chunk) => output.push(chunk),
    });
    assert.ok(output.join('').includes('; rm -rf /'));
  });
});

describe('--summarize flag', () => {
  it('appends AI Summary block when --summarize provided with byok credentials', async () => {
    const output = [];
    await run(['PROJ-1', '--summarize'], {
      env: mockEnv,
      fetcher: mockFetcher,
      credentials: { anthropicApiKey: 'sk-ant-test' },
      summarizer: async () => 'This ticket fixes cart validation. Key AC: return 400.',
      isLicensed: () => true,
      print: (chunk) => output.push(chunk),
    });
    const combined = output.join('');
    assert.ok(combined.includes('AI Summary'), 'AI Summary block missing');
    assert.ok(combined.includes('return 400'), 'summary content missing');
  });

  it('shows Pro upgrade prompt when not licensed', async () => {
    const prompts = [];
    await run(['PROJ-1', '--summarize'], {
      env: mockEnv,
      fetcher: mockFetcher,
      isLicensed: () => false,
      showUpgradePrompt: (tier, flag) => prompts.push({ tier, flag }),
    });
    process.exitCode = undefined;
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].tier, 'pro');
  });

  // RED: unlicensed --summarize must exit before any Jira API call is made
  // --no-cache forces the non-cache path so the Jira fetch runs before the license gate (F2 bug)
  it('RED: unlicensed --summarize exits before fetcher is called', async () => {
    let fetcherCalled = false;
    const trackingFetcher = async (...a) => { fetcherCalled = true; return mockFetcher(...a); };
    await run(['PROJ-1', '--summarize', '--no-cache'], {
      env: mockEnv,
      fetcher: trackingFetcher,
      isLicensed: () => false,
      showUpgradePrompt: () => {},
    });
    process.exitCode = undefined;
    assert.equal(fetcherCalled, false, 'fetcher must NOT be called for unlicensed --summarize');
  });

  it('uses cloud path when --summarize --cloud both present', async () => {
    const calls = [];
    await run(['PROJ-1', '--summarize', '--cloud'], {
      env: mockEnv,
      fetcher: mockFetcher,
      isLicensed: () => true,
      summarizer: async ({ mode }) => { calls.push(mode); return 'cloud summary'; },
      print: () => {},
    });
    assert.ok(calls.includes('cloud'));
  });

  it('shows styled error box when no API key configured for byok', async () => {
    const errors = [];
    await run(['PROJ-1', '--summarize'], {
      env: mockEnv,
      fetcher: mockFetcher,
      credentials: {},
      isLicensed: () => true,
      onError: (msg) => errors.push(msg),
      summarizer: async () => { throw new Error('No API key found. Add ANTHROPIC_API_KEY'); },
    });
    assert.ok(errors.some(e => e.includes('No API key')));
  });

  it('passes --provider= flag value to summarizer', async () => {
    const calls = [];
    await run(['PROJ-1', '--summarize', '--provider=groq'], {
      env: mockEnv,
      fetcher: mockFetcher,
      credentials: { groqApiKey: 'gsk_test' },
      isLicensed: () => true,
      summarizer: async ({ provider }) => { calls.push(provider); return 'groq summary'; },
      print: () => {},
    });
    assert.equal(calls[0], 'groq');
  });

  it('uses aiProvider from credentials when no --provider= flag', async () => {
    const calls = [];
    await run(['PROJ-1', '--summarize'], {
      env: mockEnv,
      fetcher: mockFetcher,
      credentials: { anthropicApiKey: 'sk-ant', aiProvider: 'anthropic' },
      isLicensed: () => true,
      summarizer: async ({ provider }) => { calls.push(provider); return 'anthropic summary'; },
      print: () => {},
    });
    assert.equal(calls[0], 'anthropic');
  });

  it('--provider= flag overrides aiProvider in credentials', async () => {
    const calls = [];
    await run(['PROJ-1', '--summarize', '--provider=groq'], {
      env: mockEnv,
      fetcher: mockFetcher,
      credentials: { anthropicApiKey: 'sk-ant', groqApiKey: 'gsk_test', aiProvider: 'anthropic' },
      isLicensed: () => true,
      summarizer: async ({ provider }) => { calls.push(provider); return 'groq summary'; },
      print: () => {},
    });
    assert.equal(calls[0], 'groq');
  });
});

describe('compliance subcommand', () => {
  const mockFetcher = async () => ({ ok: true, json: async () => cloudFixture });

  it('errors when no ticket key provided', async () => {
    const out = captureOutput();
    try {
      await run(['compliance'], validEnv, mockFetcher, NO_CONFIG);
      assert.equal(process.exitCode, 1);
      assert.ok(out.stderr.includes('requires a ticket key'));
    } finally {
      out.restore();
    }
  });

  it('errors on invalid ticket key format', async () => {
    const out = captureOutput();
    try {
      await run(['compliance', 'not-a-key'], validEnv, mockFetcher, NO_CONFIG);
      assert.equal(process.exitCode, 1);
      assert.ok(out.stderr.includes('not a valid ticket key'));
    } finally {
      out.restore();
    }
  });

  it('exits 1 with credential error when no Jira env vars set', async () => {
    const out = captureOutput();
    try {
      await run(['compliance', 'PROD-1234'], {}, mockFetcher, NO_CONFIG);
      assert.equal(process.exitCode, 1);
      assert.ok(out.stderr.includes('No Jira credentials'));
    } finally {
      out.restore();
    }
  });

  it('prints compliance report to stdout', async () => {
    const output = [];
    await run(['compliance', 'PROD-1234'], {
      env: validEnv,
      fetcher: mockFetcher,
      configDir: NO_CONFIG,
      print: (chunk) => output.push(chunk),
      runComplianceCheck: async () => ({ report: '  Compliance Check — PROD-1234\n  Coverage: 90%', coveragePercent: 90 }),
    });
    process.exitCode = undefined;
    const combined = output.join('');
    assert.ok(combined.includes('Compliance Check'));
    assert.ok(combined.includes('Coverage: 90%'));
  });

  it('exits 0 when coverage meets default threshold (80%)', async () => {
    await run(['compliance', 'PROD-1234'], {
      env: validEnv,
      fetcher: mockFetcher,
      configDir: NO_CONFIG,
      print: () => {},
      runComplianceCheck: async () => ({ report: '  Coverage: 80%', coveragePercent: 80 }),
    });
    assert.notEqual(process.exitCode, 1);
    process.exitCode = undefined;
  });

  it('exits 1 when coverage is below default threshold (80%)', async () => {
    await run(['compliance', 'PROD-1234'], {
      env: validEnv,
      fetcher: mockFetcher,
      configDir: NO_CONFIG,
      print: () => {},
      runComplianceCheck: async () => ({ report: '  Coverage: 50%', coveragePercent: 50 }),
    });
    assert.equal(process.exitCode, 1);
    process.exitCode = undefined;
  });

  it('exits 1 when runComplianceCheck returns null (license/usage gate)', async () => {
    await run(['compliance', 'PROD-1234'], {
      env: validEnv,
      fetcher: mockFetcher,
      configDir: NO_CONFIG,
      print: () => {},
      runComplianceCheck: async () => null,
    });
    assert.equal(process.exitCode, 1);
    process.exitCode = undefined;
  });

  it('exits 0 when no acceptance criteria found in ticket', async () => {
    await run(['compliance', 'PROD-1234'], {
      env: validEnv,
      fetcher: mockFetcher,
      configDir: NO_CONFIG,
      print: () => {},
      runComplianceCheck: async () => ({
        report: '  No acceptance criteria found in ticket description.',
        coveragePercent: 0,
        noCriteria: true,
      }),
    });
    assert.notEqual(process.exitCode, 1);
    process.exitCode = undefined;
  });

  it('reads threshold from .ticketlens-hooks.json and passes with custom threshold', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tl-compliance-'));
    writeFileSync(join(tmpDir, '.ticketlens-hooks.json'), JSON.stringify({ complianceThreshold: 60 }) + '\n');
    try {
      await run(['compliance', 'PROD-1234'], {
        env: validEnv,
        fetcher: mockFetcher,
        configDir: NO_CONFIG,
        cwdForHooks: tmpDir,
        print: () => {},
        // 65% is above 60% but below default 80% — should pass with custom threshold
        runComplianceCheck: async () => ({ report: '  Coverage: 65%', coveragePercent: 65 }),
      });
      assert.notEqual(process.exitCode, 1);
    } finally {
      process.exitCode = undefined;
      rmSync(tmpDir, { recursive: true });
    }
  });

  it('exits 1 when coverage below custom threshold from .ticketlens-hooks.json', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tl-compliance-'));
    writeFileSync(join(tmpDir, '.ticketlens-hooks.json'), JSON.stringify({ complianceThreshold: 90 }) + '\n');
    try {
      await run(['compliance', 'PROD-1234'], {
        env: validEnv,
        fetcher: mockFetcher,
        configDir: NO_CONFIG,
        cwdForHooks: tmpDir,
        print: () => {},
        runComplianceCheck: async () => ({ report: '  Coverage: 80%', coveragePercent: 80 }),
      });
      assert.equal(process.exitCode, 1);
    } finally {
      process.exitCode = undefined;
      rmSync(tmpDir, { recursive: true });
    }
  });
});

describe('pr subcommand', () => {
  const mockFetcher = async () => ({ ok: true, json: async () => cloudFixture });

  it('errors when no ticket key provided', async () => {
    const out = captureOutput();
    try {
      await run(['pr'], validEnv, mockFetcher, NO_CONFIG);
      assert.ok(out.stderr.includes('"pr" requires a ticket key'));
      assert.equal(process.exitCode, 1);
    } finally { out.restore(); }
  });

  it('errors on invalid ticket key format', async () => {
    const out = captureOutput();
    try {
      await run(['pr', 'not-a-key'], validEnv, mockFetcher, NO_CONFIG);
      assert.ok(out.stderr.includes('not a valid ticket key'));
      assert.equal(process.exitCode, 1);
    } finally { out.restore(); }
  });

  it('exits 1 with credential error when no Jira env vars set', async () => {
    const out = captureOutput();
    try {
      await run(['pr', 'PROD-1234'], {}, mockFetcher, NO_CONFIG);
      assert.ok(out.stderr.includes('No Jira credentials found'));
      assert.equal(process.exitCode, 1);
    } finally { out.restore(); }
  });

  it('prints markdown PR description to stdout using resolved env', async () => {
    const out = captureOutput();
    try {
      await run(['pr', 'PROD-1234'], validEnv, mockFetcher, NO_CONFIG);
      assert.ok(out.stdout.includes('PROD-1234'), 'output should include ticket key');
      assert.ok(out.stdout.includes('### What changed'), 'output should include What changed section');
      assert.equal(process.exitCode, undefined);
    } finally { out.restore(); }
  });

  it('uses alphanumeric project keys (CNV1-2 style)', async () => {
    const out = captureOutput();
    try {
      const fixture = { ...cloudFixture, key: 'CNV1-2' };
      const fetcher = async () => ({ ok: true, json: async () => fixture });
      await run(['pr', 'CNV1-2'], validEnv, fetcher, NO_CONFIG);
      assert.ok(out.stdout.includes('CNV1-2'), 'output should include alphanumeric ticket key');
    } finally { out.restore(); }
  });
});

// ---------------------------------------------------------------------------
// Confluence page fetching integration
// ---------------------------------------------------------------------------
describe('Confluence page fetching', () => {
  const CONFLUENCE_PAGE_URL = 'https://test.atlassian.net/wiki/spaces/PROJ/pages/999/Setup';
  const CONFLUENCE_PAGE_CONTENT = { title: 'Setup Guide', body: { view: { value: '<p>Install the tool first.</p>' } } };
  const REMOTE_LINKS_RESPONSE = [
    {
      application: { type: 'com.atlassian.confluence' },
      object: { url: CONFLUENCE_PAGE_URL, title: 'Setup Guide' },
    },
  ];

  function makeConfluenceFetcher({ remoteLinksOk = true } = {}) {
    return async (url) => {
      if (url.includes('/remotelink')) {
        if (!remoteLinksOk) return { ok: false, status: 403, statusText: 'Forbidden' };
        return { ok: true, json: async () => REMOTE_LINKS_RESPONSE };
      }
      if (url.includes('/wiki/rest/api/content/')) {
        return { ok: true, json: async () => CONFLUENCE_PAGE_CONTENT };
      }
      // Default: return the Jira ticket
      return { ok: true, json: async () => cloudFixture };
    };
  }

  it('includes Confluence Pages section in brief when remote links exist', async () => {
    const out = captureOutput();
    try {
      await run(['PROD-1234', '--plain', '--no-cache'], validEnv, makeConfluenceFetcher(), NO_CONFIG);
      assert.ok(out.stdout.includes('Confluence Pages'), `expected Confluence Pages section:\n${out.stdout}`);
      assert.ok(out.stdout.includes('Setup Guide'), `expected page title:\n${out.stdout}`);
      assert.ok(out.stdout.includes('Install the tool first.'), `expected page text:\n${out.stdout}`);
    } finally { out.restore(); }
  });

  it('still produces brief when remote links API returns 403', async () => {
    const out = captureOutput();
    try {
      await run(['PROD-1234', '--plain', '--no-cache'], validEnv, makeConfluenceFetcher({ remoteLinksOk: false }), NO_CONFIG);
      assert.ok(out.stdout.includes('PROD-1234'), `expected ticket key in brief:\n${out.stdout}`);
      assert.equal(process.exitCode, undefined);
    } finally { out.restore(); }
  });

  it('skips Confluence fetch when --no-attachments is passed', async () => {
    let remoteLinksCallCount = 0;
    const fetcher = async (url) => {
      if (url.includes('/remotelink')) { remoteLinksCallCount++; }
      return { ok: true, json: async () => cloudFixture };
    };
    const out = captureOutput();
    try {
      await run(['PROD-1234', '--plain', '--no-attachments'], validEnv, fetcher, NO_CONFIG);
      assert.equal(remoteLinksCallCount, 0, 'should not call remote links API with --no-attachments');
    } finally { out.restore(); }
  });

  it('skips Confluence pages whose origin does not match JIRA_BASE_URL', async () => {
    let confluencePageCallCount = 0;
    const crossOriginRemoteLinks = [
      {
        application: { type: 'com.atlassian.confluence' },
        object: { url: 'https://attacker.example.com/wiki/spaces/PROJ/pages/999/Setup', title: 'Evil Page' },
      },
    ];
    const fetcher = async (url) => {
      if (url.includes('/remotelink')) return { ok: true, json: async () => crossOriginRemoteLinks };
      if (url.includes('/wiki/rest/api/content/')) { confluencePageCallCount++; return { ok: true, json: async () => CONFLUENCE_PAGE_CONTENT }; }
      return { ok: true, json: async () => cloudFixture };
    };
    const out = captureOutput();
    try {
      await run(['PROD-1234', '--plain', '--no-cache'], validEnv, fetcher, NO_CONFIG);
      assert.equal(confluencePageCallCount, 0, 'should not fetch Confluence pages from a different origin');
      assert.ok(!out.stdout.includes('Evil Page'), 'should not render cross-origin page');
    } finally { out.restore(); }
  });
});

// ─── review dispatch ──────────────────────────────────────────────────────────

describe('review dispatch', () => {
  const mockExecFn = (cmd, args) => {
    if (args.includes('--verify')) return { status: 0, stdout: '' };  // any branch exists
    if (args.includes('--show-current')) return { status: 0, stdout: 'feat/PROJ-123-fix-login\n' };
    if (args.includes('--oneline')) return { status: 0, stdout: 'abc1234 feat: PROJ-123 add login\n' };
    if (args[0] === 'diff') return { status: 0, stdout: '+++ b/src/Auth.php\n+some code\n' };
    return { status: 1, stdout: '' };
  };

  it('calls assemblePrReviewFn with correct baseBranch, headBranch, and diff', async () => {
    let capturedOpts = null;
    const assemblePrReviewFn = async (o) => { capturedOpts = o; return '## PR Review Context\n'; };

    await run(['review'], {
      env: {},
      execFn: mockExecFn,
      assemblePrReviewFn,
      print: () => {},
    }, async () => ({ ok: false }), NO_CONFIG);
    assert.equal(capturedOpts.baseBranch, 'main', 'baseBranch should be auto-detected main');
    assert.equal(capturedOpts.headBranch, 'feat/PROJ-123-fix-login', 'headBranch from git');
    assert.ok(capturedOpts.diff.includes('src/Auth.php'), 'diff should be passed');
  });

  it('respects --base=develop override', async () => {
    let capturedBase = null;
    const assemblePrReviewFn = async (o) => { capturedBase = o.baseBranch; return '## PR Review Context\n'; };

    const execWithDevelop = (cmd, args) => {
      if (args.includes('--verify')) return { status: 0, stdout: '' };
      if (args.includes('--show-current')) return { status: 0, stdout: 'feat/PROJ-123\n' };
      if (args.includes('--oneline')) return { status: 0, stdout: '' };
      if (args[0] === 'diff') return { status: 0, stdout: '' };
      return { status: 1, stdout: '' };
    };

    await run(['review', '--base=develop'], {
      env: {},
      execFn: execWithDevelop,
      assemblePrReviewFn,
      print: () => {},
    }, async () => ({ ok: false }), NO_CONFIG);
    assert.equal(capturedBase, 'develop', '--base= flag should override auto-detect');
  });

  it('respects --branch=develop alias (same as --base=develop)', async () => {
    let capturedBase = null;
    const assemblePrReviewFn = async (o) => { capturedBase = o.baseBranch; return '## PR Review Context\n'; };

    const execWithDevelop = (cmd, args) => {
      if (args.includes('--verify')) return { status: 0, stdout: '' };
      if (args.includes('--show-current')) return { status: 0, stdout: 'feat/PROJ-123\n' };
      if (args.includes('--oneline')) return { status: 0, stdout: '' };
      if (args[0] === 'diff') return { status: 0, stdout: '' };
      return { status: 1, stdout: '' };
    };

    await run(['review', '--branch=develop'], {
      env: {},
      execFn: execWithDevelop,
      assemblePrReviewFn,
      print: () => {},
    }, async () => ({ ok: false }), NO_CONFIG);
    assert.equal(capturedBase, 'develop', '--branch= flag should work as alias for --base=');
  });

  it('prints assembled markdown to stdout via opts.print', async () => {
    let printed = '';
    const assemblePrReviewFn = async () => '## PR Review Context\n\nsome content';

    await run(['review'], {
      env: {},
      execFn: mockExecFn,
      assemblePrReviewFn,
      print: (chunk) => { printed += chunk; },
    }, async () => ({ ok: false }), NO_CONFIG);
    assert.ok(printed.includes('## PR Review Context'), 'output should include assembled markdown');
  });

  it('notes missing profile on stderr when ticket keys found but no credentials', async () => {
    const assemblePrReviewFn = async () => '## PR Review Context\n';
    let stderrOut = '';
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { stderrOut += s; return true; };
    try {
      await run(['review'], {
        env: {},
        configDir: NO_CONFIG,
        execFn: mockExecFn,
        assemblePrReviewFn,
        print: () => {},
      }, async () => ({ ok: false }));
      assert.ok(
        stderrOut.includes('no profile configured'),
        `Should note missing profile when ticket keys found but no credentials. Got: "${stderrOut}"`
      );
    } finally {
      process.stderr.write = origStderr;
    }
  });

  it('shows error and sets exitCode 1 when explicit --profile is not found', async () => {
    let stderrOut = '';
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { stderrOut += s; return true; };
    const origExitCode = process.exitCode;
    try {
      await run(['review', '--profile=nonexistent'], {
        env: {},
        configDir: NO_CONFIG,
        execFn: mockExecFn,
        print: () => {},
      }, async () => ({ ok: false }));
      assert.ok(
        stderrOut.includes('nonexistent') && stderrOut.includes('not found'),
        `Should show profile-not-found error. Got: "${stderrOut}"`
      );
      assert.strictEqual(process.exitCode, 1, 'Should set exitCode to 1');
    } finally {
      process.stderr.write = origStderr;
      process.exitCode = origExitCode;
    }
  });

  it('rejects unknown flags with error and exitCode 1', async () => {
    let stderrOut = '';
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { stderrOut += s; return true; };
    const origExitCode = process.exitCode;
    try {
      await run(['review', '--basessss=mmm'], {
        env: {},
        configDir: NO_CONFIG,
        execFn: mockExecFn,
        print: () => {},
      }, async () => ({ ok: false }));
      assert.ok(stderrOut.includes('Unknown flag'), `Should report unknown flag. Got: "${stderrOut}"`);
      assert.strictEqual(process.exitCode, 1);
    } finally {
      process.stderr.write = origStderr;
      process.exitCode = origExitCode;
    }
  });

  it('suggests correct syntax for --profile-NAME typo', async () => {
    let stderrOut = '';
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { stderrOut += s; return true; };
    const origExitCode = process.exitCode;
    try {
      await run(['review', '--profile-advent'], {
        env: {},
        configDir: NO_CONFIG,
        execFn: mockExecFn,
        print: () => {},
      }, async () => ({ ok: false }));
      assert.ok(stderrOut.includes('--profile=advent'), `Should suggest --profile=advent. Got: "${stderrOut}"`);
      assert.strictEqual(process.exitCode, 1);
    } finally {
      process.stderr.write = origStderr;
      process.exitCode = origExitCode;
    }
  });

  it('suggests correct syntax for --branch-NAME typo', async () => {
    let stderrOut = '';
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { stderrOut += s; return true; };
    const origExitCode = process.exitCode;
    try {
      await run(['review', '--branch-main'], {
        env: {},
        configDir: NO_CONFIG,
        execFn: mockExecFn,
        print: () => {},
      }, async () => ({ ok: false }));
      assert.ok(stderrOut.includes('--branch=main'), `Should suggest --branch=main. Got: "${stderrOut}"`);
      assert.strictEqual(process.exitCode, 1);
    } finally {
      process.stderr.write = origStderr;
      process.exitCode = origExitCode;
    }
  });

  it('rejects nonexistent explicit --base branch', async () => {
    let stderrOut = '';
    const origStderr = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { stderrOut += s; return true; };
    const origExitCode = process.exitCode;
    const noSuchBranchExec = (cmd, args) => {
      if (args.includes('--verify')) return { status: 1, stdout: '' };
      return { status: 0, stdout: '' };
    };
    try {
      await run(['review', '--base=ghost-branch'], {
        env: {},
        configDir: NO_CONFIG,
        execFn: noSuchBranchExec,
        print: () => {},
      }, async () => ({ ok: false }));
      assert.ok(stderrOut.includes('ghost-branch') && stderrOut.includes('not found'), `Should report branch not found. Got: "${stderrOut}"`);
      assert.strictEqual(process.exitCode, 1);
    } finally {
      process.stderr.write = origStderr;
      process.exitCode = origExitCode;
    }
  });

  it('passes empty tickets array when no ticket keys found in branch or commits', async () => {
    let capturedTickets = null;
    const assemblePrReviewFn = async (o) => { capturedTickets = o.tickets; return '## PR Review Context\n'; };

    const noTicketExec = (cmd, args) => {
      if (args.includes('--verify') && args.includes('main')) return { status: 0, stdout: '' };
      if (args.includes('--show-current')) return { status: 0, stdout: 'fix/no-ticket-ref\n' };
      if (args.includes('--oneline')) return { status: 0, stdout: 'abc1234 fix: some cleanup\n' };
      if (args[0] === 'diff') return { status: 0, stdout: '' };
      return { status: 1, stdout: '' };
    };

    await run(['review'], {
      env: {},
      execFn: noTicketExec,
      assemblePrReviewFn,
      print: () => {},
    }, async () => ({ ok: false }), NO_CONFIG);
    assert.deepEqual(capturedTickets, [], 'tickets should be empty when no keys found');
  });
});

// ─── standup dispatch ─────────────────────────────────────────────────────────

describe('standup dispatch', () => {
  const mockStandupExec = (cmd, args) => {
    if (args[0] === 'log') return { status: 0, stdout: 'abc1234 feat: PROJ-123 add login\ndef5678 chore: bump deps\n' };
    return { status: 1, stdout: '' };
  };

  it('calls assembleStandupFn with grouped commits and empty tickets', async () => {
    let capturedGroups = null;
    let capturedTickets = null;

    const assembleStandupFn = (groups, tickets, opts) => {
      capturedGroups = groups;
      capturedTickets = tickets;
      return '## Standup\n';
    };

    await run(['standup'], {
      env: {},
      execFn: mockStandupExec,
      assembleStandupFn,
      print: () => {},
    }, async () => ({ ok: false }), NO_CONFIG);

    assert.ok(capturedGroups instanceof Map, 'groups should be a Map');
    assert.ok(capturedGroups.has('PROJ-123'), 'should group PROJ-123 commits');
    assert.deepEqual(capturedTickets, [], 'tickets empty when no auth configured');
  });

  it('prints assembled markdown to stdout via opts.print', async () => {
    let printed = '';
    const assembleStandupFn = () => '## Standup — Mon\n\nsome content';

    await run(['standup'], {
      env: {},
      execFn: mockStandupExec,
      assembleStandupFn,
      print: (chunk) => { printed += chunk; },
    }, async () => ({ ok: false }), NO_CONFIG);

    assert.ok(printed.includes('## Standup'), `output should include standup markdown`);
  });

  it('rejects unknown flags with error and exitCode 1', async () => {
    let stderrOut = '';
    const orig = process.stderr.write;
    process.stderr.write = (s) => { stderrOut += s; };

    await run(['standup', '--badflags=foo'], {
      env: {},
      execFn: mockStandupExec,
      print: () => {},
    }, async () => ({ ok: false }), NO_CONFIG);

    process.stderr.write = orig;
    assert.equal(process.exitCode, 1);
    assert.ok(stderrOut.includes('Unknown flag'), `Should report unknown flag. Got: "${stderrOut}"`);
    process.exitCode = 0;
  });

  it('suggests --since=N for --since-N typo', async () => {
    let stderrOut = '';
    const orig = process.stderr.write;
    process.stderr.write = (s) => { stderrOut += s; };

    await run(['standup', '--since-48'], {
      env: {},
      execFn: mockStandupExec,
      print: () => {},
    }, async () => ({ ok: false }), NO_CONFIG);

    process.stderr.write = orig;
    assert.equal(process.exitCode, 1);
    assert.ok(stderrOut.includes('--since=48'), `Should suggest --since=48. Got: "${stderrOut}"`);
    process.exitCode = 0;
  });

  it('suggests --profile=NAME for --profile-NAME typo', async () => {
    let stderrOut = '';
    const orig = process.stderr.write;
    process.stderr.write = (s) => { stderrOut += s; };

    await run(['standup', '--profile-myteam'], {
      env: {},
      execFn: mockStandupExec,
      print: () => {},
    }, async () => ({ ok: false }), NO_CONFIG);

    process.stderr.write = orig;
    assert.equal(process.exitCode, 1);
    assert.ok(stderrOut.includes('--profile=myteam'), `Should suggest --profile=myteam. Got: "${stderrOut}"`);
    process.exitCode = 0;
  });

  it('shows error for invalid --format value', async () => {
    let stderrOut = '';
    const orig = process.stderr.write;
    process.stderr.write = (s) => { stderrOut += s; };

    await run(['standup', '--format=invalid'], {
      env: {},
      execFn: mockStandupExec,
      print: () => {},
    }, async () => ({ ok: false }), NO_CONFIG);

    process.stderr.write = orig;
    assert.equal(process.exitCode, 1);
    assert.ok(stderrOut.includes('Invalid --format'), `Should report invalid format. Got: "${stderrOut}"`);
    process.exitCode = 0;
  });

  it('passes --since value to assembleStandupFn opts.since', async () => {
    let capturedOpts = null;
    const assembleStandupFn = (groups, tickets, o) => { capturedOpts = o; return '## Standup\n'; };

    await run(['standup', '--since=48'], {
      env: {},
      execFn: mockStandupExec,
      assembleStandupFn,
      print: () => {},
    }, async () => ({ ok: false }), NO_CONFIG);

    assert.equal(capturedOpts?.since, '48', `Expected since=48. Got: ${capturedOpts?.since}`);
  });

  it('passes --format=pr to assembleStandupFn opts.format', async () => {
    let capturedOpts = null;
    const assembleStandupFn = (groups, tickets, o) => { capturedOpts = o; return '## What changed\n'; };

    await run(['standup', '--format=pr'], {
      env: {},
      execFn: mockStandupExec,
      assembleStandupFn,
      print: () => {},
    }, async () => ({ ok: false }), NO_CONFIG);

    assert.equal(capturedOpts?.format, 'pr', `Expected format=pr. Got: ${capturedOpts?.format}`);
  });
});

describe('--handoff flag', () => {
  it('produces handoff brief header when licensed', async () => {
    const output = [];
    await run(['PROD-1234', '--handoff'], {
      env: mockEnv,
      fetcher: mockFetcher,
      isLicensed: () => true,
      summarizer: async () => '### What was attempted\n- Tried fixing validateCart()\n\n### Current blockers\n- None identified\n\n### Open questions\n- None identified\n\n### Recommendation\nStart from validateCart().',
      print: (chunk) => output.push(chunk),
    });
    const combined = output.join('');
    assert.ok(combined.includes('## Handoff Brief — PROD-1234'), `Handoff header missing. Got: ${combined.slice(0, 200)}`);
  });

  it('includes AI body in handoff output', async () => {
    const output = [];
    await run(['PROD-1234', '--handoff'], {
      env: mockEnv,
      fetcher: mockFetcher,
      isLicensed: () => true,
      summarizer: async () => '### What was attempted\n- Implemented the fix',
      print: (chunk) => output.push(chunk),
    });
    assert.ok(output.join('').includes('Implemented the fix'));
  });

  it('does not include normal ticket brief sections when --handoff is set', async () => {
    const output = [];
    await run(['PROD-1234', '--handoff'], {
      env: mockEnv,
      fetcher: mockFetcher,
      isLicensed: () => true,
      summarizer: async () => '### What was attempted\n- Work done',
      print: (chunk) => output.push(chunk),
    });
    const combined = output.join('');
    assert.ok(!combined.includes('## Description'), `Normal brief must not appear with --handoff. Got: ${combined.slice(0, 200)}`);
  });

  it('shows Pro upgrade prompt when not licensed', async () => {
    const prompts = [];
    await run(['PROD-1234', '--handoff'], {
      env: mockEnv,
      fetcher: mockFetcher,
      isLicensed: () => false,
      showUpgradePrompt: (tier, flag) => prompts.push({ tier, flag }),
    });
    process.exitCode = undefined;
    assert.equal(prompts.length, 1, 'Expected exactly one upgrade prompt');
    assert.equal(prompts[0].tier, 'pro');
    assert.ok(prompts[0].flag.includes('handoff'));
  });

  // RED: unlicensed --handoff must exit before any Jira API call is made
  // --no-cache forces the non-cache path so the Jira fetch runs before the license gate (F2 bug)
  it('RED: unlicensed --handoff exits before fetcher is called', async () => {
    let fetcherCalled = false;
    const trackingFetcher = async (...a) => { fetcherCalled = true; return mockFetcher(...a); };
    await run(['PROD-1234', '--handoff', '--no-cache'], {
      env: mockEnv,
      fetcher: trackingFetcher,
      isLicensed: () => false,
      showUpgradePrompt: () => {},
    });
    process.exitCode = undefined;
    assert.equal(fetcherCalled, false, 'fetcher must NOT be called for unlicensed --handoff');
  });

  it('uses cloud mode when --handoff --cloud both present', async () => {
    const calls = [];
    await run(['PROD-1234', '--handoff', '--cloud'], {
      env: mockEnv,
      fetcher: mockFetcher,
      isLicensed: () => true,
      summarizer: async ({ mode }) => { calls.push(mode); return 'cloud handoff brief'; },
      print: () => {},
    });
    assert.ok(calls.includes('cloud'), `Expected cloud mode call. Got: ${JSON.stringify(calls)}`);
  });

  it('exits 1 when summarizer throws', async () => {
    const errors = [];
    await run(['PROD-1234', '--handoff'], {
      env: mockEnv,
      fetcher: mockFetcher,
      isLicensed: () => true,
      summarizer: async () => { throw new Error('No API key found. Add ANTHROPIC_API_KEY'); },
      onError: (msg) => errors.push(msg),
      print: () => {},
    });
    assert.equal(process.exitCode, 1);
    assert.ok(errors.some(e => e.includes('No API key')));
    process.exitCode = undefined;
  });

  it('passes HANDOFF_PROMPT to summarizer', async () => {
    let capturedPrompt = null;
    await run(['PROD-1234', '--handoff'], {
      env: mockEnv,
      fetcher: mockFetcher,
      isLicensed: () => true,
      summarizer: async (opts) => { capturedPrompt = opts.prompt ?? null; return 'ok'; },
      print: () => {},
    });
    assert.ok(capturedPrompt !== null, 'Expected prompt to be passed to summarizer');
    assert.ok(capturedPrompt.includes('What was attempted'), `Expected handoff prompt. Got: ${capturedPrompt?.slice(0, 80)}`);
  });

  it('does not trigger unknown-flag error for --handoff', async () => {
    let stderrOut = '';
    const orig = process.stderr.write;
    process.stderr.write = (s) => { stderrOut += s; };
    await run(['PROD-1234', '--handoff'], {
      env: mockEnv,
      fetcher: mockFetcher,
      isLicensed: () => true,
      summarizer: async () => 'ok',
      print: () => {},
    });
    process.stderr.write = orig;
    assert.ok(!stderrOut.includes('Unknown flag'), `--handoff must not trigger unknown-flag error. Got: ${stderrOut}`);
  });
});
