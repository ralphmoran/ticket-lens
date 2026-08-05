import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runDoctor } from '../lib/doctor-command.mjs';

function fakeStream() {
  const lines = [];
  return { write: (s) => { lines.push(s); return true; }, isTTY: false, get text() { return lines.join(''); } };
}

function allOkChecks(overrides = {}) {
  return {
    checkProfileConfigFn: () => ({ id: 'profile-config', label: 'Profile configuration', ok: true, message: 'ok', hint: null, fixable: false }),
    checkLicenseFreshnessFn: () => ({ id: 'license-freshness', label: 'License freshness', ok: true, message: 'ok', hint: null, fixable: false }),
    checkConnectivityFn: async () => ({ id: 'connectivity', label: 'Tracker connectivity', ok: true, message: 'ok', hint: null, fixable: false }),
    checkCacheHealthFn: () => ({ id: 'cache-health', label: 'Attachment cache', ok: true, message: 'ok', hint: null, fixable: false, corruptEntries: [] }),
    checkRecallQueueFn: () => ({ id: 'recall-queue', label: 'Recall sync queue', ok: true, message: 'ok', hint: null, fixable: false }),
    ...overrides,
  };
}

describe('runDoctor — checks-only mode', () => {
  it('returns ok:true and renders a checkmark line per check in plain format when everything passes', async () => {
    const stream = fakeStream();
    const result = await runDoctor([], { stream, ...allOkChecks() });
    assert.equal(result.ok, true);
    assert.match(stream.text, /Profile configuration/);
    assert.match(stream.text, /License freshness/);
    assert.match(stream.text, /Tracker connectivity/);
    assert.match(stream.text, /Attachment cache/);
    assert.match(stream.text, /Recall sync queue/);
  });

  it('returns ok:false when any check fails, and prints its hint', async () => {
    const stream = fakeStream();
    const overrides = allOkChecks({
      checkProfileConfigFn: () => ({ id: 'profile-config', label: 'Profile configuration', ok: false, message: 'No profile configured.', hint: 'Run `ticketlens init`.', fixable: false }),
    });
    const result = await runDoctor([], { stream, ...overrides });
    assert.equal(result.ok, false);
    assert.match(stream.text, /No profile configured/);
    assert.match(stream.text, /Run `ticketlens init`/);
  });

  it('--format=json prints the exact schemaVersion 1 shape and never includes corruptEntries', async () => {
    const stream = fakeStream();
    await runDoctor(['--format=json'], { stream, ...allOkChecks() });
    const parsed = JSON.parse(stream.text);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.checks.length, 5);
    for (const check of parsed.checks) {
      assert.deepEqual(Object.keys(check).sort(), ['fixable', 'hint', 'id', 'label', 'message', 'ok']);
    }
    assert.deepEqual(parsed.fixed, []);
    assert.deepEqual(parsed.skipped, []);
  });

  it('rejects an invalid --format value without running any checks', async () => {
    const stream = fakeStream();
    let called = false;
    const checkProfileConfigFn = () => { called = true; return { id: 'profile-config', ok: true, message: '', hint: null, fixable: false, label: '' }; };
    const result = await runDoctor(['--format=xml'], { stream, ...allOkChecks({ checkProfileConfigFn }) });
    assert.equal(result.ok, false);
    assert.equal(called, false);
    assert.match(stream.text, /--format must be plain or json/);
  });

  it('threads --profile=NAME into checkProfileConfig, checkConnectivity, and checkCacheHealth, but not checkLicenseFreshness or checkRecallQueue', async () => {
    const seen = {};
    const overrides = allOkChecks({
      checkProfileConfigFn: (opts) => { seen.profileConfig = opts.profileName; return { id: 'profile-config', label: '', ok: true, message: '', hint: null, fixable: false }; },
      checkConnectivityFn: async (opts) => { seen.connectivity = opts.profileName; return { id: 'connectivity', label: '', ok: true, message: '', hint: null, fixable: false }; },
      checkCacheHealthFn: (opts) => { seen.cache = opts.profileName; return { id: 'cache-health', label: '', ok: true, message: '', hint: null, fixable: false, corruptEntries: [] }; },
      checkLicenseFreshnessFn: (opts) => { seen.license = 'profileName' in opts; return { id: 'license-freshness', label: '', ok: true, message: '', hint: null, fixable: false }; },
      checkRecallQueueFn: (opts) => { seen.queue = 'profileName' in opts; return { id: 'recall-queue', label: '', ok: true, message: '', hint: null, fixable: false }; },
    });
    await runDoctor(['--profile=acme'], { stream: fakeStream(), ...overrides });
    assert.equal(seen.profileConfig, 'acme');
    assert.equal(seen.connectivity, 'acme');
    assert.equal(seen.cache, 'acme');
    assert.equal(seen.license, false);
    assert.equal(seen.queue, false);
  });
});
