/**
 * Feature 11 — Local scheduled triage: --save=FILE flag + local schedule mode
 * RED phase: all tests must fail until implementation is added.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run } from '../fetch-my-tickets.mjs';
import { runScheduleLocal } from '../lib/schedule-wizard.mjs';

let tmpDir;
before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'feature11-test-'));
  const profiles = {
    default: 'work',
    profiles: {
      work: { baseUrl: 'https://jira.example.com', auth: 'cloud', email: 'dev@a.com', triageStatuses: ['In Progress'] },
    },
  };
  writeFileSync(join(tmpDir, 'profiles.json'), JSON.stringify(profiles), 'utf8');
  writeFileSync(join(tmpDir, 'credentials.json'), JSON.stringify({ work: { apiToken: 'tok' } }), 'utf8');
});
after(() => rmSync(tmpDir, { recursive: true }));

const noopFetcher = async (url) => {
  if (url.includes('myself') || url.includes('rest/auth')) return { ok: true, json: async () => ({ accountId: 'u1', displayName: 'Dev', name: 'dev' }) };
  return { ok: true, json: async () => ({ issues: [], total: 0 }) };
};

describe('triage --save=FILE', () => {
  it('is accepted as a known flag (no unknown-flag error)', async () => {
    const outFile = join(tmpDir, 'output.txt');
    let stderrOut = '';
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { stderrOut += s; return true; };
    await run(['triage', `--save=${outFile}`, '--plain'], { env: {}, fetcher: noopFetcher, configDir: tmpDir, isLicensed: () => true, showUpgradePrompt: () => {}, print: () => {} });
    process.stderr.write = origWrite;
    assert.ok(!stderrOut.includes('Unknown flag: --save'), `stderr had: ${stderrOut}`);
  });

  it('writes triage output to the specified file', async () => {
    const outFile = join(tmpDir, 'saved-triage.txt');
    await run(['triage', `--save=${outFile}`, '--plain'], { env: {}, fetcher: noopFetcher, configDir: tmpDir, isLicensed: () => true, showUpgradePrompt: () => {}, print: () => {} });
    assert.ok(existsSync(outFile), `Expected file at ${outFile}`);
    const content = readFileSync(outFile, 'utf8');
    assert.ok(content.length > 0, 'Output file is empty');
  });

  it('creates parent directories if they do not exist', async () => {
    const outFile = join(tmpDir, 'nested', 'deep', 'output.txt');
    await run(['triage', `--save=${outFile}`, '--plain'], { env: {}, fetcher: noopFetcher, configDir: tmpDir, isLicensed: () => true, showUpgradePrompt: () => {}, print: () => {} });
    assert.ok(existsSync(outFile), `Expected file created at ${outFile}`);
  });

  it('rejects a path that is a directory (not a file)', async () => {
    let stderrOut = '';
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (s) => { stderrOut += s; return true; };
    await run(['triage', `--save=${tmpDir}`, '--plain'], { env: {}, fetcher: noopFetcher, configDir: tmpDir, isLicensed: () => true, showUpgradePrompt: () => {}, print: () => {} });
    process.stderr.write = origWrite;
    assert.ok(stderrOut.includes('Error') || process.exitCode === 1, `Expected error for directory path, stderr: ${stderrOut}`);
    process.exitCode = 0;
  });

  it('strips ANSI escape codes from saved file content', async () => {
    const outFile = join(tmpDir, 'stripped.txt');
    await run(['triage', `--save=${outFile}`], { env: {}, fetcher: noopFetcher, configDir: tmpDir, isLicensed: () => true, showUpgradePrompt: () => {}, print: () => {} });
    if (existsSync(outFile)) {
      const content = readFileSync(outFile, 'utf8');
      assert.ok(!/\x1b\[/.test(content), 'ANSI codes found in saved file');
    }
  });
});

describe('runScheduleLocal', () => {
  it('is a named export of schedule-wizard.mjs', () => {
    assert.equal(typeof runScheduleLocal, 'function');
  });

  it('writes a cron/LaunchAgent entry without requiring a cliToken', async () => {
    let jobWritten = null;
    const result = await runScheduleLocal({
      platform: 'linux',
      answers: { time: '07:30', outputFile: join(tmpDir, 'triage.log') },
      writeLocalJob: (content) => { jobWritten = content; },
      print: () => {},
    });
    assert.ok(result?.ok, 'Expected ok:true from runScheduleLocal');
    assert.ok(jobWritten !== null, 'writeLocalJob was not called');
  });

  it('includes --save=FILE in the cron line', async () => {
    const outFile = join(tmpDir, 'sched-output.txt');
    let jobWritten = null;
    await runScheduleLocal({
      platform: 'linux',
      answers: { time: '08:00', outputFile: outFile },
      writeLocalJob: (content) => { jobWritten = content; },
      print: () => {},
    });
    assert.ok(jobWritten?.includes(`--save=${outFile}`), `Expected --save in cron line, got: ${jobWritten}`);
  });

  it('does not call fetcher / make network requests', async () => {
    let fetched = false;
    await runScheduleLocal({
      platform: 'linux',
      answers: { time: '09:00', outputFile: join(tmpDir, 'out.txt') },
      fetcher: async () => { fetched = true; return {}; },
      writeLocalJob: () => {},
      print: () => {},
    });
    assert.ok(!fetched, 'runScheduleLocal made a network request — should be local-only');
  });
});

describe('triage --save=FILE — Pro gate', () => {
  it('exits 1 and shows upgrade prompt when unlicensed', async () => {
    const outFile = join(tmpDir, 'gated.txt');
    let upgraded = false;
    await run(['triage', `--save=${outFile}`, '--plain'], {
      env: {},
      fetcher: async () => ({ ok: true, json: async () => ({}) }),
      configDir: tmpDir,
      isLicensed: () => false,
      showUpgradePrompt: () => { upgraded = true; },
      print: () => {},
    });
    assert.ok(upgraded, 'showUpgradePrompt not called for unlicensed --save');
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });
});

describe('runScheduleLocal — input validation', () => {
  it('rejects outputFile with shell metacharacters', async () => {
    const { runScheduleLocal } = await import('../lib/schedule-wizard.mjs');
    const printed = [];
    const result = await runScheduleLocal({
      platform: 'linux',
      answers: { time: '08:00', outputFile: '/tmp/out;rm -rf /' },
      writeLocalJob: () => {},
      print: (s) => printed.push(s),
    });
    assert.ok(!result.ok, 'Expected ok:false for invalid path');
    assert.ok(printed.some(s => s.includes('Invalid')), `Expected error message, got: ${printed.join('')}`);
  });

  it('rejects out-of-range hour (25:00)', async () => {
    const { runScheduleLocal } = await import('../lib/schedule-wizard.mjs');
    const printed = [];
    const result = await runScheduleLocal({
      platform: 'linux',
      answers: { time: '25:00', outputFile: '/tmp/out.txt' },
      writeLocalJob: () => {},
      print: (s) => printed.push(s),
    });
    assert.ok(!result.ok, 'Expected ok:false for hour=25');
  });

  it('rejects out-of-range minute (08:61)', async () => {
    const { runScheduleLocal } = await import('../lib/schedule-wizard.mjs');
    const printed = [];
    const result = await runScheduleLocal({
      platform: 'linux',
      answers: { time: '08:61', outputFile: '/tmp/out.txt' },
      writeLocalJob: () => {},
      print: (s) => printed.push(s),
    });
    assert.ok(!result.ok, 'Expected ok:false for minute=61');
  });
});
