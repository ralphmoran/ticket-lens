import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runScheduleWizard, runScheduleStop, runScheduleStatus, buildPlist, buildCronLine } from '../lib/schedule-wizard.mjs';

describe('buildPlist', () => {
  it('generates valid plist with correct hour and minute', () => {
    const plist = buildPlist({ hour: 7, minute: 30, ticketlensBin: '/usr/local/bin/ticketlens' });
    assert.ok(plist.includes('<integer>7</integer>'), 'hour missing');
    assert.ok(plist.includes('<integer>30</integer>'), 'minute missing');
    assert.ok(plist.includes('/usr/local/bin/ticketlens'), 'bin path missing');
    assert.ok(plist.includes('io.ticketlens.digest'), 'label missing');
    assert.ok(plist.includes('triage'), 'triage command missing');
    assert.ok(plist.includes('--digest'), '--digest flag missing');
  });

  it('rejects non-numeric hour', () => {
    assert.throws(() => buildPlist({ hour: NaN, minute: 0, ticketlensBin: '/usr/bin/ticketlens' }));
  });
});

describe('buildCronLine', () => {
  it('generates cron line for given time', () => {
    const line = buildCronLine({ hour: 7, minute: 0, ticketlensBin: '/usr/local/bin/ticketlens' });
    assert.equal(line, '0 7 * * * /usr/local/bin/ticketlens triage --digest >> /tmp/ticketlens-digest.log 2>&1');
  });

  it('pads minute with zero in cron line', () => {
    const line = buildCronLine({ hour: 8, minute: 5, ticketlensBin: '/usr/local/bin/ticketlens' });
    assert.ok(line.startsWith('5 8 * * *'));
  });
});

describe('runScheduleWizard', () => {
  let tmpDir;
  before(() => { tmpDir = mkdtempSync(join(tmpdir(), 'schedule-test-')); });
  after(() => { rmSync(tmpDir, { recursive: true }); });

  it('registers schedule with backend and returns ok:true with full payload', async () => {
    const calls = [];
    const result = await runScheduleWizard({
      answers: { time: '07:00', email: 'dev@example.com', timezone: 'America/New_York' },
      fetcher: async (url, opts) => {
        calls.push({ url, body: JSON.parse(opts.body) });
        return { ok: true, json: async () => ({ scheduled: true, nextDelivery: '2026-03-29T11:00:00Z' }) };
      },
      cliToken: 'tl_lic-test',
      configDir: tmpDir,
      platform: 'darwin',
      writeLocalJob: () => {},
    });
    // result.ok must be true — bin/ticketlens.mjs gates on this exact field
    assert.strictEqual(result.ok, true);
    // API data fields must be forwarded so the caller can display them
    assert.strictEqual(result.scheduled, true);
    assert.strictEqual(result.nextDelivery, '2026-03-29T11:00:00Z');
    // request payload
    assert.equal(calls[0].body.email, 'dev@example.com');
    assert.equal(calls[0].body.deliverAt, '07:00');
    assert.ok(calls[0].url.includes('/v1/schedule'));
  });

  it('returns { ok: false, status: 401 } and prints session-expired message on 401', async () => {
    const printed = [];
    const result = await runScheduleWizard({
      answers: { time: '07:00', email: 'dev@example.com', timezone: 'UTC' },
      fetcher: async () => ({ ok: false, status: 401, json: async () => ({}) }),
      cliToken: 'tl_bad',
      configDir: tmpDir,
      platform: 'darwin',
      writeLocalJob: () => {},
      print: s => printed.push(s),
    });
    assert.deepEqual(result, { ok: false, status: 401 });
    assert.ok(printed.some(s => s.includes('ticketlens login')));
  });

  it('returns { ok: false } and prints warning on network error', async () => {
    const printed = [];
    const result = await runScheduleWizard({
      answers: { time: '07:00', email: 'dev@example.com', timezone: 'UTC' },
      fetcher: async () => { throw new Error('ENOTFOUND'); },
      cliToken: 'tl_bad',
      configDir: tmpDir,
      platform: 'darwin',
      writeLocalJob: () => {},
      print: s => printed.push(s),
    });
    assert.deepEqual(result, { ok: false });
    assert.ok(printed.some(s => s.includes('network error')));
  });

  it('calls writeLocalJob with plist content on darwin', async () => {
    const written = [];
    await runScheduleWizard({
      answers: { time: '07:00', email: 'dev@example.com', timezone: 'UTC' },
      fetcher: async () => ({ ok: true, json: async () => ({ scheduled: true, nextDelivery: '' }) }),
      cliToken: 'tl_lic',
      configDir: tmpDir,
      platform: 'darwin',
      writeLocalJob: (content, platform) => written.push({ content, platform }),
    });
    assert.equal(written[0].platform, 'darwin');
    assert.ok(written[0].content.includes('io.ticketlens.digest'));
  });
});

// ── cliToken param and null guard tests ───────────────────────────────────────

describe('runScheduleWizard — cliToken param (new auth)', () => {
  let tmpDir2;
  before(() => { tmpDir2 = mkdtempSync(join(tmpdir(), 'schedule-clitoken-test-')); });
  after(() => { rmSync(tmpDir2, { recursive: true }); });

  it('sends Authorization: Bearer <cliToken> when cliToken provided', async () => {
    let capturedHeaders;
    await runScheduleWizard({
      answers: { time: '08:00', email: 'dev@example.com', timezone: 'UTC' },
      fetcher: async (url, opts) => {
        capturedHeaders = opts.headers;
        return { ok: true, json: async () => ({ scheduled: true, nextDelivery: '' }) };
      },
      cliToken: 'tl_schedule_token',
      configDir: tmpDir2,
      platform: 'darwin',
      writeLocalJob: () => {},
    });
    assert.equal(capturedHeaders.Authorization, 'Bearer tl_schedule_token');
  });

  it('returns { ok: false } and prints message when cliToken is null', async () => {
    const printed = [];
    const result = await runScheduleWizard({
      answers: { time: '08:00', email: 'dev@example.com', timezone: 'UTC' },
      fetcher: async () => { throw new Error('should not fetch'); },
      cliToken: null,
      configDir: tmpDir2,
      platform: 'darwin',
      writeLocalJob: () => {},
      print: s => printed.push(s),
    });
    assert.deepEqual(result, { ok: false });
    assert.ok(printed.some(s => s.includes('ticketlens login')), 'expected login hint in output');
  });

  it('returns { ok: false } and prints message when cliToken is undefined', async () => {
    const printed = [];
    const result = await runScheduleWizard({
      answers: { time: '08:00', email: 'dev@example.com', timezone: 'UTC' },
      fetcher: async () => { throw new Error('should not fetch'); },
      cliToken: undefined,
      configDir: tmpDir2,
      platform: 'darwin',
      writeLocalJob: () => {},
      print: s => printed.push(s),
    });
    assert.deepEqual(result, { ok: false });
    assert.ok(printed.some(s => s.includes('ticketlens login')));
  });
});

describe('runScheduleStop — null guard', () => {
  it('returns early and prints message when cliToken is null', async () => {
    const printed = [];
    await runScheduleStop({
      fetcher: async () => { throw new Error('should not fetch'); },
      cliToken: null,
      platform: 'darwin',
      print: s => printed.push(s),
    });
    assert.ok(printed.some(s => s.includes('ticketlens login')));
  });
});

describe('runScheduleStatus — null guard', () => {
  it('returns early and prints message when cliToken is null', async () => {
    const printed = [];
    await runScheduleStatus({
      fetcher: async () => { throw new Error('should not fetch'); },
      cliToken: null,
      print: s => printed.push(s),
    });
    assert.ok(printed.some(s => s.includes('ticketlens login')));
  });
});

// ── LOCK TESTS — pin cloud schedule flow before Feature 11 (local mode) ──

describe('schedule-wizard — cloud flow lock', () => {
  let tmpDirLock;
  before(() => { tmpDirLock = mkdtempSync(join(tmpdir(), 'schedule-lock-')); });
  after(() => rmSync(tmpDirLock, { recursive: true }));

  it('runScheduleWizard with valid cliToken still calls fetch with Authorization header', async () => {
    let capturedHeaders;
    const fetcher = async (_url, init) => {
      capturedHeaders = init?.headers;
      return { ok: true, json: async () => ({ id: 1, deliverAt: '08:00', timezone: 'UTC' }) };
    };
    await runScheduleWizard({
      fetcher,
      cliToken: 'tl_lic-locktest',
      configDir: tmpDirLock,
      platform: 'linux',
      answers: { time: '08:00', email: 'dev@example.com', timezone: 'UTC' },
      writeLocalJob: () => {},
      print: () => {},
    });
    assert.equal(capturedHeaders?.['Authorization'], 'Bearer tl_lic-locktest');
  });

  it('runScheduleStop is a named export', () => {
    assert.equal(typeof runScheduleStop, 'function');
  });

  it('runScheduleStatus is a named export', () => {
    assert.equal(typeof runScheduleStatus, 'function');
  });
});
