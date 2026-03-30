import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runScheduleWizard, buildPlist, buildCronLine } from '../lib/schedule-wizard.mjs';

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

  it('registers schedule with backend and returns scheduled true', async () => {
    const calls = [];
    const result = await runScheduleWizard({
      answers: { time: '07:00', email: 'dev@example.com', timezone: 'America/New_York' },
      fetcher: async (url, opts) => {
        calls.push({ url, body: JSON.parse(opts.body) });
        return { ok: true, json: async () => ({ scheduled: true, nextDelivery: '2026-03-29T11:00:00Z' }) };
      },
      licenseKey: 'lic-test',
      configDir: tmpDir,
      platform: 'darwin',
      writeLocalJob: () => {},
    });
    assert.equal(result.scheduled, true);
    assert.equal(calls[0].body.email, 'dev@example.com');
    assert.equal(calls[0].body.deliverAt, '07:00');
    assert.ok(calls[0].url.includes('/v1/schedule'));
  });

  it('throws on backend error', async () => {
    await assert.rejects(
      () => runScheduleWizard({
        answers: { time: '07:00', email: 'dev@example.com', timezone: 'UTC' },
        fetcher: async () => ({ ok: false, status: 401, json: async () => ({}) }),
        licenseKey: 'bad',
        configDir: tmpDir,
        platform: 'darwin',
        writeLocalJob: () => {},
      }),
      { message: /schedule api error 401/i }
    );
  });

  it('calls writeLocalJob with plist content on darwin', async () => {
    const written = [];
    await runScheduleWizard({
      answers: { time: '07:00', email: 'dev@example.com', timezone: 'UTC' },
      fetcher: async () => ({ ok: true, json: async () => ({ scheduled: true, nextDelivery: '' }) }),
      licenseKey: 'lic',
      configDir: tmpDir,
      platform: 'darwin',
      writeLocalJob: (content, platform) => written.push({ content, platform }),
    });
    assert.equal(written[0].platform, 'darwin');
    assert.ok(written[0].content.includes('io.ticketlens.digest'));
  });
});
