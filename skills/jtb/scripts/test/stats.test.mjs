import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runStats } from '../lib/run-stats.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnap(dateStr, profile, configDir, tickets = []) {
  const dir = join(configDir, 'triage-history', dateStr);
  mkdirSync(dir, { recursive: true });
  const snap = { captured_at: `${dateStr}T12:00:00Z`, tickets };
  writeFileSync(join(dir, `${profile}.json`), JSON.stringify(snap));
}

function makeTicket(key, urgency, commentCreated) {
  return {
    ticketKey: key,
    summary: `Summary ${key}`,
    status: 'In Progress',
    urgency,
    reason: 'test',
    lastComment: commentCreated ? { created: commentCreated } : null,
    daysSinceUpdate: 2,
  };
}

function captureOutput() {
  let stdout = '';
  let stderr = '';
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (s) => { stdout += s; return true; };
  process.stderr.write = (s) => { stderr += s; return true; };
  const restore = () => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    process.exitCode = undefined;
  };
  return { get stdout() { return stdout; }, get stderr() { return stderr; }, restore };
}

function setupConfig(configDir) {
  writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({
    profiles: {
      testprofile: {
        baseUrl: 'https://test.atlassian.net',
        auth: 'cloud',
        email: 'john@example.com',
      },
    },
    default: 'testprofile',
  }));
}

// ---------------------------------------------------------------------------
// Lock: computeResponseMetrics return shape is stable (not modified by runStats)
// ---------------------------------------------------------------------------

describe('lock: computeResponseMetrics shape unchanged', () => {
  it('returns the expected keys from computeResponseMetrics', async () => {
    const { computeResponseMetrics } = await import('../lib/triage-history.mjs');
    const configDir = mkdtempSync(join(tmpdir(), 'stats-lock-'));
    try {
      const result = computeResponseMetrics('test', { days: 7, configDir });
      assert.ok('avgResponseHours' in result, 'missing avgResponseHours');
      assert.ok('medianResponseHours' in result, 'missing medianResponseHours');
      assert.ok('clearRate' in result, 'missing clearRate');
      assert.ok('triageRunCount' in result, 'missing triageRunCount');
      assert.ok('currentUrgency' in result, 'missing currentUrgency');
      assert.ok('windowDays' in result, 'missing windowDays');
      assert.ok('trendHours' in result, 'missing trendHours');
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('returns triageRunCount=0 and null metrics when no snapshots exist', async () => {
    const { computeResponseMetrics } = await import('../lib/triage-history.mjs');
    const configDir = mkdtempSync(join(tmpdir(), 'stats-lock-empty-'));
    try {
      const result = computeResponseMetrics('nobody', { days: 7, configDir });
      assert.equal(result.triageRunCount, 0);
      assert.equal(result.avgResponseHours, null);
      assert.equal(result.clearRate, null);
      assert.equal(result.currentUrgency, null);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runStats: --help
// ---------------------------------------------------------------------------

describe('runStats --help', () => {
  it('prints help text and returns without error', async () => {
    const out = captureOutput();
    try {
      await runStats(['--help'], {});
      assert.ok(
        out.stdout.includes('ticketlens stats') || out.stdout.includes('stats'),
        `Expected help text, got: ${out.stdout}`,
      );
      assert.equal(process.exitCode, undefined);
    } finally {
      out.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// runStats: unknown flag
// ---------------------------------------------------------------------------

describe('runStats unknown flag', () => {
  it('sets exitCode=1 on unknown flag', async () => {
    const out = captureOutput();
    try {
      await runStats(['--bogus-flag=xyz'], {});
      assert.equal(process.exitCode, 1, 'Expected exitCode=1 for unknown flag');
    } finally {
      out.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// runStats: --days validation
// ---------------------------------------------------------------------------

describe('runStats --days validation', () => {
  it('sets exitCode=1 when --days=0 is passed', async () => {
    const out = captureOutput();
    try {
      await runStats(['--days=0'], {});
      assert.equal(process.exitCode, 1);
    } finally {
      out.restore();
    }
  });

  it('sets exitCode=1 when --days=31 is passed', async () => {
    const out = captureOutput();
    try {
      await runStats(['--days=31'], {});
      assert.equal(process.exitCode, 1);
    } finally {
      out.restore();
    }
  });

  it('sets exitCode=1 when --days=abc is passed', async () => {
    const out = captureOutput();
    try {
      await runStats(['--days=abc'], {});
      assert.equal(process.exitCode, 1);
    } finally {
      out.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// runStats: --format validation
// ---------------------------------------------------------------------------

describe('runStats --format validation', () => {
  it('sets exitCode=1 when --format=xml is passed', async () => {
    const out = captureOutput();
    try {
      await runStats(['--format=xml'], {});
      assert.equal(process.exitCode, 1);
    } finally {
      out.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// runStats: no history
// ---------------------------------------------------------------------------

describe('runStats with no history', () => {
  it('prints no-history message when no snapshots exist', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'stats-nohist-'));
    let output = '';
    try {
      setupConfig(configDir);
      await runStats(['--profile=testprofile'], {
        configDir,
        print: (s) => { output += s; },
        isLicensed: () => true,
      });
      assert.ok(
        output.includes('No triage history') || output.includes('no history') || output.includes('at least'),
        `Expected no-history message, got: ${output}`,
      );
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runStats: with history
// ---------------------------------------------------------------------------

describe('runStats with history', () => {
  it('prints avg response time and clear rate when snapshots exist', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'stats-hist-'));
    let output = '';
    try {
      setupConfig(configDir);
      // Day 1: ticket needs-response
      makeSnap('2026-05-24', 'testprofile', configDir, [
        makeTicket('PROJ-1', 'needs-response', '2026-05-24T08:00:00Z'),
      ]);
      // Day 2: ticket cleared within 24h
      makeSnap('2026-05-25', 'testprofile', configDir, [
        makeTicket('PROJ-1', 'clear', null),
      ]);
      await runStats(['--profile=testprofile', '--days=7'], {
        configDir,
        print: (s) => { output += s; },
        isLicensed: () => true,
        metricsCalculator: () => ({
          avgResponseHours: 4.0, medianResponseHours: 4.0, clearRate: 1.0,
          triageRunCount: 2, currentUrgency: null, windowDays: 7, trendHours: null,
        }),
      });
      assert.ok(output.includes('Triage runs') || output.includes('4.0'), `Expected metrics output, got: ${output}`);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('outputs valid JSON when --format=json', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'stats-json-'));
    let output = '';
    try {
      setupConfig(configDir);
      await runStats(['--profile=testprofile', '--format=json'], {
        configDir,
        print: (s) => { output += s; },
        isLicensed: () => true,
        metricsCalculator: () => ({
          avgResponseHours: 4.2,
          medianResponseHours: 2.8,
          clearRate: 0.73,
          triageRunCount: 5,
          currentUrgency: { needsResponse: 2, aging: 1, clear: 8 },
          windowDays: 7,
          trendHours: -0.5,
        }),
      });
      const parsed = JSON.parse(output);
      assert.equal(typeof parsed.avgResponseHours, 'number');
      assert.equal(typeof parsed.triageRunCount, 'number');
      assert.ok('clearRate' in parsed);
      assert.ok('profile' in parsed);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('JSON output includes all metric fields', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'stats-json-fields-'));
    let output = '';
    try {
      setupConfig(configDir);
      await runStats(['--profile=testprofile', '--format=json'], {
        configDir,
        print: (s) => { output += s; },
        isLicensed: () => true,
        metricsCalculator: () => ({
          avgResponseHours: 3.1,
          medianResponseHours: 2.0,
          clearRate: 0.8,
          triageRunCount: 4,
          currentUrgency: { needsResponse: 0, aging: 2, clear: 5 },
          windowDays: 7,
          trendHours: 1.2,
        }),
      });
      const parsed = JSON.parse(output);
      const expectedKeys = ['profile', 'windowDays', 'avgResponseHours', 'medianResponseHours', 'clearRate', 'triageRunCount', 'trendHours'];
      for (const key of expectedKeys) {
        assert.ok(key in parsed, `Missing key: ${key}`);
      }
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runStats: tier gate (Free → cap days at 7)
// ---------------------------------------------------------------------------

describe('runStats tier gate', () => {
  it('Free user: --days=20 silently caps to 7 (no error)', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'stats-tier-'));
    let capturedDays = null;
    let output = '';
    try {
      setupConfig(configDir);
      await runStats(['--profile=testprofile', '--days=20'], {
        configDir,
        print: (s) => { output += s; },
        isLicensed: () => false,
        metricsCalculator: (_profile, opts) => {
          capturedDays = opts.days;
          return { avgResponseHours: null, medianResponseHours: null, clearRate: null, triageRunCount: 0, currentUrgency: null, windowDays: opts.days, trendHours: null };
        },
      });
      assert.equal(process.exitCode, undefined, 'Free tier capping should not set exitCode=1');
      assert.equal(capturedDays, 7, `Expected days capped to 7, got: ${capturedDays}`);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('Pro user: --days=20 passes through unchanged', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'stats-tier-pro-'));
    let capturedDays = null;
    let output = '';
    try {
      setupConfig(configDir);
      await runStats(['--profile=testprofile', '--days=20'], {
        configDir,
        print: (s) => { output += s; },
        isLicensed: () => true,
        metricsCalculator: (_profile, opts) => {
          capturedDays = opts.days;
          return { avgResponseHours: null, medianResponseHours: null, clearRate: null, triageRunCount: 0, currentUrgency: null, windowDays: opts.days, trendHours: null };
        },
      });
      assert.equal(capturedDays, 20, `Expected days=20, got: ${capturedDays}`);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('Free user: --days=7 (at cap) passes through unchanged', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'stats-tier-exact-'));
    let capturedDays = null;
    let output = '';
    try {
      setupConfig(configDir);
      await runStats(['--profile=testprofile', '--days=7'], {
        configDir,
        print: (s) => { output += s; },
        isLicensed: () => false,
        metricsCalculator: (_profile, opts) => {
          capturedDays = opts.days;
          return { avgResponseHours: null, medianResponseHours: null, clearRate: null, triageRunCount: 0, currentUrgency: null, windowDays: opts.days, trendHours: null };
        },
      });
      assert.equal(capturedDays, 7);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runStats: profile resolution
// ---------------------------------------------------------------------------

describe('runStats profile resolution', () => {
  it('uses default profile from profiles.json when --profile not passed', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'stats-profile-'));
    let usedProfile = null;
    let output = '';
    try {
      setupConfig(configDir);
      await runStats([], {
        configDir,
        print: (s) => { output += s; },
        isLicensed: () => true,
        metricsCalculator: (profile, opts) => {
          usedProfile = profile;
          return { avgResponseHours: null, medianResponseHours: null, clearRate: null, triageRunCount: 0, currentUrgency: null, windowDays: opts.days, trendHours: null };
        },
      });
      assert.equal(usedProfile, 'testprofile', `Expected default profile 'testprofile', got: ${usedProfile}`);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('uses fallback "default" when no profiles.json exists', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'stats-noprofile-'));
    let usedProfile = null;
    let output = '';
    try {
      await runStats([], {
        configDir,
        print: (s) => { output += s; },
        isLicensed: () => true,
        metricsCalculator: (profile, opts) => {
          usedProfile = profile;
          return { avgResponseHours: null, medianResponseHours: null, clearRate: null, triageRunCount: 0, currentUrgency: null, windowDays: opts.days, trendHours: null };
        },
      });
      assert.equal(typeof usedProfile, 'string', 'Expected a string profile name');
      assert.ok(usedProfile.length > 0, 'Expected non-empty profile name');
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('uses --profile=NAME when explicitly passed', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'stats-explicit-profile-'));
    let usedProfile = null;
    let output = '';
    try {
      await runStats(['--profile=myteam'], {
        configDir,
        print: (s) => { output += s; },
        isLicensed: () => true,
        metricsCalculator: (profile, opts) => {
          usedProfile = profile;
          return { avgResponseHours: null, medianResponseHours: null, clearRate: null, triageRunCount: 0, currentUrgency: null, windowDays: opts.days, trendHours: null };
        },
      });
      assert.equal(usedProfile, 'myteam');
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// runStats: plain output content
// ---------------------------------------------------------------------------

describe('runStats plain output content', () => {
  it('output includes triage run count', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'stats-output-'));
    let output = '';
    try {
      setupConfig(configDir);
      await runStats(['--profile=testprofile', '--format=plain'], {
        configDir,
        print: (s) => { output += s; },
        isLicensed: () => true,
        metricsCalculator: () => ({
          avgResponseHours: 3.5,
          medianResponseHours: 2.0,
          clearRate: 0.8,
          triageRunCount: 5,
          currentUrgency: { needsResponse: 1, aging: 0, clear: 4 },
          windowDays: 7,
          trendHours: -0.5,
        }),
      });
      assert.ok(output.includes('5'), `Expected triage run count 5 in output, got: ${output}`);
      assert.ok(output.includes('3.5') || output.includes('3.'), `Expected avg response time in output, got: ${output}`);
      assert.ok(output.includes('80%') || output.includes('0.8') || output.includes('8'), `Expected clear rate in output, got: ${output}`);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('output includes current urgency breakdown when currentUrgency is present', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'stats-urgency-'));
    let output = '';
    try {
      setupConfig(configDir);
      await runStats(['--profile=testprofile', '--format=plain'], {
        configDir,
        print: (s) => { output += s; },
        isLicensed: () => true,
        metricsCalculator: () => ({
          avgResponseHours: 2.0,
          medianResponseHours: 1.5,
          clearRate: 1.0,
          triageRunCount: 3,
          currentUrgency: { needsResponse: 2, aging: 1, clear: 5 },
          windowDays: 7,
          trendHours: null,
        }),
      });
      assert.ok(output.includes('needs-response') || output.includes('needs'), `Expected urgency section, got: ${output}`);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('shows downtrend when trendHours is negative', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'stats-trend-down-'));
    let output = '';
    try {
      setupConfig(configDir);
      await runStats(['--profile=testprofile', '--format=plain'], {
        configDir,
        print: (s) => { output += s; },
        isLicensed: () => true,
        metricsCalculator: () => ({
          avgResponseHours: 2.0,
          medianResponseHours: 1.5,
          clearRate: 0.9,
          triageRunCount: 4,
          currentUrgency: null,
          windowDays: 7,
          trendHours: -1.5,
        }),
      });
      assert.ok(output.includes('↓') || output.includes('-1.5') || output.includes('1.5'), `Expected downtrend indicator, got: ${output}`);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('shows uptrend when trendHours is positive', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'stats-trend-up-'));
    let output = '';
    try {
      setupConfig(configDir);
      await runStats(['--profile=testprofile', '--format=plain'], {
        configDir,
        print: (s) => { output += s; },
        isLicensed: () => true,
        metricsCalculator: () => ({
          avgResponseHours: 5.0,
          medianResponseHours: 4.0,
          clearRate: 0.5,
          triageRunCount: 3,
          currentUrgency: null,
          windowDays: 7,
          trendHours: 2.0,
        }),
      });
      assert.ok(output.includes('↑') || output.includes('+2.0') || output.includes('2.0'), `Expected uptrend indicator, got: ${output}`);
    } finally {
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});
