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

describe('runDoctor — --fix mode', () => {
  it('revalidates a stale license, re-checks it, and reports it in fixed[] when now green', async () => {
    const stream = fakeStream();
    let revalidated = false;
    let recheckCount = 0;
    const checkLicenseFreshnessFn = () => {
      recheckCount++;
      return recheckCount === 1
        ? { id: 'license-freshness', label: 'License freshness', ok: false, message: 'stale', hint: null, fixable: true }
        : { id: 'license-freshness', label: 'License freshness', ok: true, message: 'fresh', hint: null, fixable: false };
    };
    const revalidateLicenseFn = async () => { revalidated = true; return { success: true }; };
    const result = await runDoctor(['--fix'], {
      stream, revalidateLicenseFn,
      ...allOkChecks({ checkLicenseFreshnessFn }),
    });
    assert.equal(revalidated, true);
    assert.equal(result.ok, true);
    assert.match(stream.text, /Fixed:.*license-freshness/s);
  });

  it('deletes exactly the corrupt cache entries reported by checkCacheHealth, nothing else', async () => {
    const stream = fakeStream();
    const deleted = [];
    const unlinkFn = (p) => deleted.push(p);
    let recheckCount = 0;
    const corruptEntry = { ticketKey: 'ACME-1', filename: 'bad.png', localPath: '/x/bad.png', size: 0 };
    const checkCacheHealthFn = () => {
      recheckCount++;
      return recheckCount === 1
        ? { id: 'cache-health', label: 'Attachment cache', ok: false, message: '1 corrupt', hint: null, fixable: true, corruptEntries: [corruptEntry] }
        : { id: 'cache-health', label: 'Attachment cache', ok: true, message: 'clean', hint: null, fixable: false, corruptEntries: [] };
    };
    const result = await runDoctor(['--fix'], {
      stream, unlinkFn,
      ...allOkChecks({ checkCacheHealthFn }),
    });
    assert.deepEqual(deleted, ['/x/bad.png']);
    assert.equal(result.ok, true);
  });

  it('flushes a pending recall queue when logged in, re-checks it, and reports it fixed', async () => {
    const stream = fakeStream();
    let flushed = false;
    let recheckCount = 0;
    const checkRecallQueueFn = () => {
      recheckCount++;
      return recheckCount === 1
        ? { id: 'recall-queue', label: 'Recall sync queue', ok: false, message: '2 pending', hint: null, fixable: true }
        : { id: 'recall-queue', label: 'Recall sync queue', ok: true, message: 'clear', hint: null, fixable: false };
    };
    const flushQueueFn = async () => { flushed = true; return { flushed: 2, remaining: 0 }; };
    const readCliTokenFn = () => 'a-real-token';
    const result = await runDoctor(['--fix'], {
      stream, flushQueueFn, readCliTokenFn,
      ...allOkChecks({ checkRecallQueueFn }),
    });
    assert.equal(flushed, true);
    assert.equal(result.ok, true);
    assert.match(stream.text, /Fixed:.*recall-queue/s);
  });

  it('skips the queue flush (does not call flushQueue) when not logged in, and reports it in skipped[]', async () => {
    const stream = fakeStream();
    let flushed = false;
    const checkRecallQueueFn = () => ({ id: 'recall-queue', label: 'Recall sync queue', ok: false, message: '2 pending', hint: null, fixable: true });
    const flushQueueFn = async () => { flushed = true; return { flushed: 2, remaining: 0 }; };
    const readCliTokenFn = () => null;
    const result = await runDoctor(['--fix', '--format=json'], {
      stream, flushQueueFn, readCliTokenFn,
      ...allOkChecks({ checkRecallQueueFn }),
    });
    assert.equal(flushed, false);
    assert.equal(result.ok, false);
    const parsed = JSON.parse(stream.text);
    assert.deepEqual(parsed.skipped, [{ id: 'recall-queue', reason: 'Not logged in — run `ticketlens login` first.' }]);
  });

  it('applies fixes in license → cache → queue order', async () => {
    const stream = fakeStream();
    const order = [];
    const revalidateLicenseFn = async () => { order.push('license'); return { success: true }; };
    const unlinkFn = () => { order.push('cache'); };
    const flushQueueFn = async () => { order.push('queue'); return { flushed: 1, remaining: 0 }; };
    const failing = (id, label) => () => ({ id, label, ok: false, message: 'x', hint: null, fixable: true, corruptEntries: id === 'cache-health' ? [{ localPath: '/x' }] : undefined });
    await runDoctor(['--fix'], {
      stream, revalidateLicenseFn, unlinkFn, flushQueueFn,
      readCliTokenFn: () => 'tok',
      ...allOkChecks({
        checkLicenseFreshnessFn: failing('license-freshness', 'License freshness'),
        checkCacheHealthFn: failing('cache-health', 'Attachment cache'),
        checkRecallQueueFn: failing('recall-queue', 'Recall sync queue'),
      }),
    });
    assert.deepEqual(order, ['license', 'cache', 'queue']);
  });

  it('does not attempt a fix for a check that is failing but not fixable (e.g. connectivity)', async () => {
    const stream = fakeStream();
    const checkConnectivityFn = async () => ({ id: 'connectivity', label: 'Tracker connectivity', ok: false, message: 'down', hint: null, fixable: false });
    const result = await runDoctor(['--fix', '--format=json'], {
      stream, ...allOkChecks({ checkConnectivityFn }),
    });
    const parsed = JSON.parse(stream.text);
    assert.deepEqual(parsed.fixed, []);
    assert.deepEqual(parsed.skipped, []);
    assert.equal(result.ok, false);
  });

  it('--fix --profile=X reports cache-health in fixed[] when X has corrupt entries that are fixed, even if an unrelated profile has unrelated corruption', async () => {
    const stream = fakeStream();
    const deleted = [];
    const unlinkFn = (p) => deleted.push(p);
    let checkCacheHealthCallCount = 0;
    let seenProfileNames = [];
    const checkCacheHealthFn = (opts) => {
      checkCacheHealthCallCount++;
      seenProfileNames.push(opts.profileName);
      // First call (initial check) for profile='acme': has 1 corrupt entry
      if (checkCacheHealthCallCount === 1) {
        return { id: 'cache-health', label: 'Attachment cache', ok: false, message: '1 corrupt', hint: null, fixable: true, corruptEntries: [{ ticketKey: 'ACME-1', filename: 'bad.png', localPath: '/cache/acme/bad.png', size: 0 }] };
      }
      // Recheck for profile='acme' after deletion: should be clean (the one corrupt entry was deleted)
      if (checkCacheHealthCallCount === 2 && opts.profileName === 'acme') {
        return { id: 'cache-health', label: 'Attachment cache', ok: true, message: 'clean', hint: null, fixable: false, corruptEntries: [] };
      }
      // Fallback (shouldn't be called in this test)
      return { id: 'cache-health', label: 'Attachment cache', ok: true, message: 'ok', hint: null, fixable: false, corruptEntries: [] };
    };
    const result = await runDoctor(['--fix', '--profile=acme', '--format=json'], {
      stream, unlinkFn,
      ...allOkChecks({ checkCacheHealthFn }),
    });
    assert.deepEqual(deleted, ['/cache/acme/bad.png']);
    assert.deepEqual(seenProfileNames, ['acme', 'acme']);
    const parsed = JSON.parse(stream.text);
    assert.deepEqual(parsed.fixed, ['cache-health']);
    assert.equal(result.ok, true);
  });

  it('--fix --format=json with a failing fixable license-freshness check produces valid JSON without interleaved status messages', async () => {
    const stream = fakeStream();
    let recheckCount = 0;
    const checkLicenseFreshnessFn = () => {
      recheckCount++;
      return recheckCount === 1
        ? { id: 'license-freshness', label: 'License freshness', ok: false, message: 'stale', hint: null, fixable: true }
        : { id: 'license-freshness', label: 'License freshness', ok: true, message: 'fresh', hint: null, fixable: false };
    };
    const revalidateLicenseFn = async () => ({ success: true });
    const result = await runDoctor(['--fix', '--format=json'], {
      stream, revalidateLicenseFn,
      ...allOkChecks({ checkLicenseFreshnessFn }),
    });
    // Should be able to parse the entire stream as JSON without error (no interleaved "Revalidating license..." text)
    const parsed = JSON.parse(stream.text);
    assert.deepEqual(parsed.fixed, ['license-freshness']);
    assert.equal(result.ok, true);
  });

  it('--fix --format=json with a failing fixable recall-queue check produces valid JSON without interleaved status messages', async () => {
    const stream = fakeStream();
    let recheckCount = 0;
    const checkRecallQueueFn = () => {
      recheckCount++;
      return recheckCount === 1
        ? { id: 'recall-queue', label: 'Recall sync queue', ok: false, message: '3 pending', hint: null, fixable: true }
        : { id: 'recall-queue', label: 'Recall sync queue', ok: true, message: 'clear', hint: null, fixable: false };
    };
    const flushQueueFn = async () => ({ flushed: 3, remaining: 0 });
    const readCliTokenFn = () => 'auth-token';
    const result = await runDoctor(['--fix', '--format=json'], {
      stream, flushQueueFn, readCliTokenFn,
      ...allOkChecks({ checkRecallQueueFn }),
    });
    // Should be able to parse the entire stream as JSON without error (no interleaved "Flushing recall queue..." text)
    const parsed = JSON.parse(stream.text);
    assert.deepEqual(parsed.fixed, ['recall-queue']);
    assert.equal(result.ok, true);
  });
});
