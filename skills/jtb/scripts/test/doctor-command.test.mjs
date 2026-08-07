import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runDoctor } from '../lib/doctor-command.mjs';

function fakeStream() {
  const lines = [];
  return { write: (s) => { lines.push(s); return true; }, isTTY: false, get text() { return lines.join(''); } };
}

function fakeTTYStream() {
  const lines = [];
  return { write: (s) => { lines.push(s); return true; }, isTTY: true, get text() { return lines.join(''); } };
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
    const out = fakeStream();
    const result = await runDoctor([], { stream, out, ...allOkChecks() });
    assert.equal(result.ok, true);
    assert.match(out.text, /Profile configuration/);
    assert.match(out.text, /License freshness/);
    assert.match(out.text, /Tracker connectivity/);
    assert.match(out.text, /Attachment cache/);
    assert.match(out.text, /Recall sync queue/);
  });

  it('returns ok:false when any check fails, and prints its hint', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    const overrides = allOkChecks({
      checkProfileConfigFn: () => ({ id: 'profile-config', label: 'Profile configuration', ok: false, message: 'No profile configured.', hint: 'Run `ticketlens init`.', fixable: false }),
    });
    const result = await runDoctor([], { stream, out, ...overrides });
    assert.equal(result.ok, false);
    assert.match(out.text, /No profile configured/);
    assert.match(out.text, /Run `ticketlens init`/);
  });

  it('--format=json prints the exact schemaVersion 1 shape and never includes corruptEntries', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    await runDoctor(['--format=json'], { stream, out, ...allOkChecks() });
    const parsed = JSON.parse(out.text);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.checks.length, 5);
    for (const check of parsed.checks) {
      assert.deepEqual(Object.keys(check).sort(), ['fixable', 'hint', 'id', 'label', 'message', 'ok']);
    }
    assert.deepEqual(parsed.fixed, []);
    assert.deepEqual(parsed.skipped, []);
  });

  it('writes the report to `out` (stdout), never to `stream` (stderr) — the JSON output must be pipeable', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    await runDoctor(['--format=json'], { stream, out, ...allOkChecks() });
    assert.equal(stream.text, '', 'no report bytes should land on the stderr-style stream');
    assert.doesNotThrow(() => JSON.parse(out.text), 'the full report must parse cleanly from out alone');
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
    await runDoctor(['--profile=acme'], { stream: fakeStream(), out: fakeStream(), ...overrides });
    assert.equal(seen.profileConfig, 'acme');
    assert.equal(seen.connectivity, 'acme');
    assert.equal(seen.cache, 'acme');
    assert.equal(seen.license, false);
    assert.equal(seen.queue, false);
  });
});

describe('runDoctor — progress indicator (ROADMAP 49f)', () => {
  it('writes a "Checking <label>…" line per check, then erases it, when stream is a TTY and format is plain', async () => {
    const stream = fakeTTYStream();
    const out = fakeStream();
    await runDoctor([], { stream, out, ...allOkChecks() });
    assert.match(stream.text, /Checking profile configuration…/);
    assert.match(stream.text, /Checking license freshness…/);
    assert.match(stream.text, /Checking tracker connectivity…/);
    assert.match(stream.text, /Checking attachment cache…/);
    assert.match(stream.text, /Checking recall sync queue…/);
    // Every running line is followed by its own erase sequence (cursor up, clear line).
    const eraseCount = (stream.text.match(/\x1b\[A\r\x1b\[2K/g) || []).length;
    assert.equal(eraseCount, 5);
  });

  it('writes no progress bytes to stream when stream is not a TTY (piped)', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    await runDoctor([], { stream, out, ...allOkChecks() });
    assert.equal(stream.text, '');
  });

  it('writes no progress bytes to stream for --format=json even when stream is a TTY', async () => {
    const stream = fakeTTYStream();
    const out = fakeStream();
    await runDoctor(['--format=json'], { stream, out, ...allOkChecks() });
    assert.equal(stream.text, '');
  });

  it('progress lines never reach `out` — the report stream stays byte-identical to non-progress runs', async () => {
    const ttyStream = fakeTTYStream();
    const ttyOut = fakeStream();
    await runDoctor([], { stream: ttyStream, out: ttyOut, ...allOkChecks() });

    const plainStream = fakeStream();
    const plainOut = fakeStream();
    await runDoctor([], { stream: plainStream, out: plainOut, ...allOkChecks() });

    assert.equal(ttyOut.text, plainOut.text);
  });
});

describe('runDoctor — --fix mode', () => {
  it('revalidates a stale license, re-checks it, and reports it in fixed[] when now green', async () => {
    const stream = fakeStream();
    const out = fakeStream();
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
      stream, out, revalidateLicenseFn,
      ...allOkChecks({ checkLicenseFreshnessFn }),
    });
    assert.equal(revalidated, true);
    assert.equal(result.ok, true);
    assert.match(out.text, /Fixed:.*license-freshness/s);
  });

  it('deletes exactly the corrupt cache entries reported by checkCacheHealth, nothing else', async () => {
    const stream = fakeStream();
    const out = fakeStream();
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
      stream, out, unlinkFn,
      ...allOkChecks({ checkCacheHealthFn }),
    });
    assert.deepEqual(deleted, ['/x/bad.png']);
    assert.equal(result.ok, true);
  });

  it('flushes a pending recall queue when logged in, re-checks it, and reports it fixed', async () => {
    const stream = fakeStream();
    const out = fakeStream();
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
      stream, out, flushQueueFn, readCliTokenFn,
      ...allOkChecks({ checkRecallQueueFn }),
    });
    assert.equal(flushed, true);
    assert.equal(result.ok, true);
    assert.match(out.text, /Fixed:.*recall-queue/s);
  });

  it('skips the queue flush (does not call flushQueue) when not logged in, and reports it in skipped[]', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    let flushed = false;
    const checkRecallQueueFn = () => ({ id: 'recall-queue', label: 'Recall sync queue', ok: false, message: '2 pending', hint: null, fixable: true });
    const flushQueueFn = async () => { flushed = true; return { flushed: 2, remaining: 0 }; };
    const readCliTokenFn = () => null;
    const result = await runDoctor(['--fix', '--format=json'], {
      stream, out, flushQueueFn, readCliTokenFn,
      ...allOkChecks({ checkRecallQueueFn }),
    });
    assert.equal(flushed, false);
    assert.equal(result.ok, false);
    const parsed = JSON.parse(out.text);
    assert.deepEqual(parsed.skipped, [{ id: 'recall-queue', reason: 'Not logged in — run `ticketlens login` first.' }]);
  });

  it('applies fixes in license → cache → queue order', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    const order = [];
    const revalidateLicenseFn = async () => { order.push('license'); return { success: true }; };
    const unlinkFn = () => { order.push('cache'); };
    const flushQueueFn = async () => { order.push('queue'); return { flushed: 1, remaining: 0 }; };
    const failing = (id, label) => () => ({ id, label, ok: false, message: 'x', hint: null, fixable: true, corruptEntries: id === 'cache-health' ? [{ localPath: '/x' }] : undefined });
    await runDoctor(['--fix'], {
      stream, out, revalidateLicenseFn, unlinkFn, flushQueueFn,
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
    const out = fakeStream();
    const checkConnectivityFn = async () => ({ id: 'connectivity', label: 'Tracker connectivity', ok: false, message: 'down', hint: null, fixable: false });
    const result = await runDoctor(['--fix', '--format=json'], {
      stream, out, ...allOkChecks({ checkConnectivityFn }),
    });
    const parsed = JSON.parse(out.text);
    assert.deepEqual(parsed.fixed, []);
    assert.deepEqual(parsed.skipped, []);
    assert.equal(result.ok, false);
  });

  it('--fix --profile=X reports cache-health in fixed[] when X has corrupt entries that are fixed, even if an unrelated profile has unrelated corruption', async () => {
    const stream = fakeStream();
    const out = fakeStream();
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
      stream, out, unlinkFn,
      ...allOkChecks({ checkCacheHealthFn }),
    });
    assert.deepEqual(deleted, ['/cache/acme/bad.png']);
    assert.deepEqual(seenProfileNames, ['acme', 'acme']);
    const parsed = JSON.parse(out.text);
    assert.deepEqual(parsed.fixed, ['cache-health']);
    assert.equal(result.ok, true);
  });

  it('--fix --format=json with a failing fixable license-freshness check produces valid JSON without interleaved status messages', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    let recheckCount = 0;
    const checkLicenseFreshnessFn = () => {
      recheckCount++;
      return recheckCount === 1
        ? { id: 'license-freshness', label: 'License freshness', ok: false, message: 'stale', hint: null, fixable: true }
        : { id: 'license-freshness', label: 'License freshness', ok: true, message: 'fresh', hint: null, fixable: false };
    };
    const revalidateLicenseFn = async () => ({ success: true });
    const result = await runDoctor(['--fix', '--format=json'], {
      stream, out, revalidateLicenseFn,
      ...allOkChecks({ checkLicenseFreshnessFn }),
    });
    // In --format=json mode, progress chatter ("Revalidating license...") is
    // suppressed entirely (it's gated on format === 'plain'), so `stream`
    // stays empty and the report on `out` is never at risk of interleaving.
    const parsed = JSON.parse(out.text);
    assert.deepEqual(parsed.fixed, ['license-freshness']);
    assert.equal(result.ok, true);
    assert.equal(stream.text, '');
  });

  it('--fix --format=json with a failing fixable recall-queue check produces valid JSON without interleaved status messages', async () => {
    const stream = fakeStream();
    const out = fakeStream();
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
      stream, out, flushQueueFn, readCliTokenFn,
      ...allOkChecks({ checkRecallQueueFn }),
    });
    // Same isolation guarantee as above, for the queue-flush progress message.
    const parsed = JSON.parse(out.text);
    assert.deepEqual(parsed.fixed, ['recall-queue']);
    assert.equal(result.ok, true);
    assert.equal(stream.text, '');
  });

  it('a partial-success fix (recheck still ok:false, but improved) updates the reported state without adding it to fixed[]', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    // Queue starts with 5 pending notes; flushQueue pushes 3, leaving 2 —
    // a real partial success. The recheck after the flush must be what gets
    // rendered, not the stale pre-fix "5 note(s) pending sync." message.
    let recheckCount = 0;
    const checkRecallQueueFn = () => {
      recheckCount++;
      return recheckCount === 1
        ? { id: 'recall-queue', label: 'Recall sync queue', ok: false, message: '5 note(s) pending sync.', hint: 'retry', fixable: true }
        : { id: 'recall-queue', label: 'Recall sync queue', ok: false, message: '2 note(s) pending sync.', hint: 'retry', fixable: true };
    };
    const flushQueueFn = async () => ({ flushed: 3, remaining: 2 });
    const readCliTokenFn = () => 'a-real-token';
    const result = await runDoctor(['--fix', '--format=json'], {
      stream, out, flushQueueFn, readCliTokenFn,
      ...allOkChecks({ checkRecallQueueFn }),
    });
    const parsed = JSON.parse(out.text);
    const queueCheck = parsed.checks.find(c => c.id === 'recall-queue');
    assert.equal(queueCheck.message, '2 note(s) pending sync.', 'must reflect the post-fix recheck, not the stale pre-fix count');
    assert.deepEqual(parsed.fixed, [], 'a still-failing recheck must never land in fixed[]');
    assert.equal(result.ok, false);
  });
});
