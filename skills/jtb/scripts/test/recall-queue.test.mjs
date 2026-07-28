import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  isRetryableFailure,
  enqueueNote,
  flushQueue,
  maybeAutoFlush,
  readQueue,
  DEFAULT_MAX_QUEUE_SIZE as MAX_QUEUE_SIZE,
  DEFAULT_MAX_ENTRY_AGE_MS as MAX_ENTRY_AGE_MS,
  DEFAULT_AUTO_FLUSH_INTERVAL_MS as AUTO_FLUSH_INTERVAL_MS,
} from '../lib/recall-queue.mjs';
import { DEFAULT_RECALL_SETTINGS } from '../lib/recall-settings-sync.mjs';

function freshConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tl-recall-queue-test-'));
}

function hashToken(cliToken) {
  return createHash('sha256').update(cliToken).digest('hex');
}

// Deterministic, network-free stand-in for the real getEffectiveRecallSettings
// (which defaults to a live fetch) — every test that doesn't specifically
// exercise a Console-configured override uses this so it never depends on
// real network access.
const stubSettings = (overrides = {}) => async () => ({ ...DEFAULT_RECALL_SETTINGS, ...overrides });

const samplePayload = {
  external_id: '1700000000000-abcdef.md',
  title: 'Retry gotcha',
  tickets: ['PROD-1'],
  tags: ['bug'],
  author: 'ralph',
  sources: [],
  body: 'Needs exponential backoff.',
};

// ---------------------------------------------------------------------------
// isRetryableFailure — classification matrix
// ---------------------------------------------------------------------------

describe('isRetryableFailure', () => {
  it('classifies a network-error result (no status) as retryable', () => {
    assert.equal(isRetryableFailure({ ok: false }), true);
  });

  it('classifies a 500 as retryable', () => {
    assert.equal(isRetryableFailure({ ok: false, status: 500 }), true);
  });

  it('classifies a 503 as retryable', () => {
    assert.equal(isRetryableFailure({ ok: false, status: 503 }), true);
  });

  it('classifies a 401 (session expired) as NOT retryable — retrying a stale token cannot succeed', () => {
    assert.equal(isRetryableFailure({ ok: false, status: 401 }), false);
  });

  it('classifies a 403 (not entitled / no team) as NOT retryable — waits on user action, not connectivity', () => {
    assert.equal(isRetryableFailure({ ok: false, status: 403 }), false);
  });

  it('classifies a 422 (validation failure) as NOT retryable — a doomed payload would never succeed on retry', () => {
    assert.equal(isRetryableFailure({ ok: false, status: 422 }), false);
  });

  it('classifies a successful result as NOT retryable — nothing to retry', () => {
    assert.equal(isRetryableFailure({ ok: true, status: 200 }), false);
  });

  it('classifies pushNote\'s cached-entitlement skip (status: 403, skipped: true) as NOT retryable — regression guard: a shape with no status must never be confused with a network error', () => {
    assert.equal(isRetryableFailure({ ok: false, status: 403, skipped: true }), false);
  });
});

// ---------------------------------------------------------------------------
// enqueueNote
// ---------------------------------------------------------------------------

describe('enqueueNote', () => {
  it('appends a new entry with the payload, a hashed tokenHash, and zero attempts', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    const queue = readQueue(configDir);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, samplePayload.external_id);
    assert.deepEqual(queue[0].notePayload, samplePayload);
    assert.equal(queue[0].tokenHash, hashToken('tl_key'));
    assert.equal(queue[0].attempts, 0);
    assert.ok(queue[0].firstQueuedAt);
    assert.ok(queue[0].failedAt);
  });

  it('never persists the raw cliToken anywhere in the queue file', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_super_secret_key', getEffectiveRecallSettingsFn: stubSettings() });
    const raw = fs.readFileSync(path.join(configDir, 'recall-pending.json'), 'utf8');
    assert.equal(raw.includes('tl_super_secret_key'), false);
  });

  it('appends to an existing queue rather than overwriting it', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    await enqueueNote({ ...samplePayload, external_id: 'second.md' }, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    assert.equal(readQueue(configDir).length, 2);
  });

  it(`evicts the oldest entry and warns once when appending past the ${MAX_QUEUE_SIZE}-entry cap`, async () => {
    const configDir = freshConfigDir();
    const warnings = [];
    for (let i = 0; i < MAX_QUEUE_SIZE; i++) {
      await enqueueNote({ ...samplePayload, external_id: `note-${i}.md` }, { configDir, cliToken: 'tl_key', warn: (s) => warnings.push(s), getEffectiveRecallSettingsFn: stubSettings() });
    }
    assert.equal(readQueue(configDir).length, MAX_QUEUE_SIZE);
    await enqueueNote({ ...samplePayload, external_id: 'overflow.md' }, { configDir, cliToken: 'tl_key', warn: (s) => warnings.push(s), getEffectiveRecallSettingsFn: stubSettings() });
    const queue = readQueue(configDir);
    assert.equal(queue.length, MAX_QUEUE_SIZE);
    assert.equal(queue.some(e => e.id === 'note-0.md'), false, 'oldest entry should have been evicted');
    assert.equal(queue.some(e => e.id === 'overflow.md'), true);
    assert.equal(warnings.length, 1, 'exactly one warn for the eviction, not one per enqueue');
  });

  it(`purges entries older than the ${MAX_ENTRY_AGE_MS}ms age limit before appending, based on firstQueuedAt`, async () => {
    const configDir = freshConfigDir();
    const longAgo = Date.now() - MAX_ENTRY_AGE_MS - 1;
    fs.writeFileSync(
      path.join(configDir, 'recall-pending.json'),
      JSON.stringify([{
        id: 'stale.md',
        notePayload: samplePayload,
        tokenHash: hashToken('tl_key'),
        firstQueuedAt: new Date(longAgo).toISOString(),
        failedAt: new Date(longAgo).toISOString(),
        attempts: 3,
      }]),
    );
    await enqueueNote({ ...samplePayload, external_id: 'fresh.md' }, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    const queue = readQueue(configDir);
    assert.equal(queue.some(e => e.id === 'stale.md'), false);
    assert.equal(queue.some(e => e.id === 'fresh.md'), true);
  });

  it('does NOT expire an entry that keeps failing (failedAt keeps refreshing) if its firstQueuedAt is still within the age limit', async () => {
    const configDir = freshConfigDir();
    const recentlyFailed = Date.now() - 1000;
    const firstQueued = Date.now() - (MAX_ENTRY_AGE_MS - 60_000);
    fs.writeFileSync(
      path.join(configDir, 'recall-pending.json'),
      JSON.stringify([{
        id: 'still-alive.md',
        notePayload: samplePayload,
        tokenHash: hashToken('tl_key'),
        firstQueuedAt: new Date(firstQueued).toISOString(),
        failedAt: new Date(recentlyFailed).toISOString(),
        attempts: 50,
      }]),
    );
    await enqueueNote({ ...samplePayload, external_id: 'another.md' }, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    assert.equal(readQueue(configDir).some(e => e.id === 'still-alive.md'), true);
  });

  it('honors a Console-configured max_queue_size override via getEffectiveRecallSettingsFn, not the platform default', async () => {
    const configDir = freshConfigDir();
    const warnings = [];
    for (let i = 0; i < 3; i++) {
      await enqueueNote({ ...samplePayload, external_id: `note-${i}.md` }, {
        configDir, cliToken: 'tl_key', warn: (s) => warnings.push(s),
        getEffectiveRecallSettingsFn: stubSettings({ max_queue_size: 3 }),
      });
    }
    assert.equal(readQueue(configDir).length, 3);
    await enqueueNote({ ...samplePayload, external_id: 'overflow.md' }, {
      configDir, cliToken: 'tl_key', warn: (s) => warnings.push(s),
      getEffectiveRecallSettingsFn: stubSettings({ max_queue_size: 3 }),
    });
    const queue = readQueue(configDir);
    assert.equal(queue.length, 3);
    assert.equal(queue.some(e => e.id === 'note-0.md'), false, 'oldest entry evicted under the smaller team-configured cap');
    assert.equal(warnings.length, 1);
  });

  it('fetches settings via the injected cliToken so getEffectiveRecallSettingsFn receives it — regression guard for the account-scoped fallback', async () => {
    const configDir = freshConfigDir();
    let capturedCliToken;
    await enqueueNote(samplePayload, {
      configDir, cliToken: 'tl_key',
      getEffectiveRecallSettingsFn: async (opts) => { capturedCliToken = opts.cliToken; return DEFAULT_RECALL_SETTINGS; },
    });
    assert.equal(capturedCliToken, 'tl_key');
  });
});

// ---------------------------------------------------------------------------
// flushQueue
// ---------------------------------------------------------------------------

describe('flushQueue', () => {
  it('removes an entry on a successful push', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    const result = await flushQueue({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(), pushNoteFn: async () => ({ ok: true, status: 200 }) });
    assert.equal(result.flushed, 1);
    assert.equal(result.remaining, 0);
    assert.equal(readQueue(configDir).length, 0);
  });

  it('keeps an entry queued and increments attempts on a failed push', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    const result = await flushQueue({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(), pushNoteFn: async () => ({ ok: false }) });
    assert.equal(result.flushed, 0);
    assert.equal(result.remaining, 1);
    assert.equal(readQueue(configDir)[0].attempts, 1);
  });

  it('updates failedAt on a retry attempt but leaves firstQueuedAt untouched', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    const original = readQueue(configDir)[0];
    await new Promise(r => setTimeout(r, 5));
    await flushQueue({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(), pushNoteFn: async () => ({ ok: false }) });
    const updated = readQueue(configDir)[0];
    assert.equal(updated.firstQueuedAt, original.firstQueuedAt);
    assert.notEqual(updated.failedAt, original.failedAt);
  });

  it('passes a caller-supplied timeoutMs through to pushNoteFn', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    let captured;
    await flushQueue({
      configDir, cliToken: 'tl_key', timeoutMs: 4000, getEffectiveRecallSettingsFn: stubSettings(),
      pushNoteFn: async (payload, opts) => { captured = opts.timeoutMs; return { ok: true, status: 200 }; },
    });
    assert.equal(captured, 4000);
  });

  it('omitting timeoutMs leaves it undefined on the pushNoteFn call — pushNote falls back to its own default', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    let captured = 'unset';
    await flushQueue({
      configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(),
      pushNoteFn: async (payload, opts) => { captured = opts.timeoutMs; return { ok: true, status: 200 }; },
    });
    assert.equal(captured, undefined);
  });

  it('skips (leaves untouched, does not attempt or evict) an entry queued under a different account', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'old_account_token', getEffectiveRecallSettingsFn: stubSettings() });
    let pushCalls = 0;
    const result = await flushQueue({ configDir, cliToken: 'new_account_token', getEffectiveRecallSettingsFn: stubSettings(), pushNoteFn: async () => { pushCalls++; return { ok: true }; } });
    assert.equal(pushCalls, 0);
    assert.equal(result.flushed, 0);
    assert.equal(result.remaining, 1);
    assert.equal(readQueue(configDir).length, 1);
  });

  it('drops an entry immediately (no requeue) when a retry surfaces a non-retryable failure — e.g. the session expired between enqueue and this attempt', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    const result = await flushQueue({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(), pushNoteFn: async () => ({ ok: false, status: 401 }) });
    assert.equal(result.flushed, 0);
    assert.equal(result.remaining, 0);
    assert.equal(readQueue(configDir).length, 0);
  });

  it('reclassifies pushNote\'s cached-entitlement skip (status: 403, skipped: true) as non-retryable on retry, dropping it — regression guard matching isRetryableFailure', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    const result = await flushQueue({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(), pushNoteFn: async () => ({ ok: false, status: 403, skipped: true }) });
    assert.equal(result.remaining, 0);
    assert.equal(readQueue(configDir).length, 0);
  });

  it('purges expired entries (by firstQueuedAt) before attempting any push, regardless of tokenHash', async () => {
    const configDir = freshConfigDir();
    const longAgo = Date.now() - MAX_ENTRY_AGE_MS - 1;
    fs.writeFileSync(
      path.join(configDir, 'recall-pending.json'),
      JSON.stringify([{
        id: 'expired.md',
        notePayload: samplePayload,
        tokenHash: hashToken('tl_key'),
        firstQueuedAt: new Date(longAgo).toISOString(),
        failedAt: new Date(longAgo).toISOString(),
        attempts: 10,
      }]),
    );
    let pushCalls = 0;
    await flushQueue({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(), pushNoteFn: async () => { pushCalls++; return { ok: true }; } });
    assert.equal(pushCalls, 0, 'an expired entry must never be attempted');
    assert.equal(readQueue(configDir).length, 0);
  });

  it('honors a Console-configured max_entry_age_ms override via getEffectiveRecallSettingsFn when purging before a flush', async () => {
    const configDir = freshConfigDir();
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    fs.writeFileSync(
      path.join(configDir, 'recall-pending.json'),
      JSON.stringify([{
        id: 'aged-out-under-short-limit.md',
        notePayload: samplePayload,
        tokenHash: hashToken('tl_key'),
        firstQueuedAt: new Date(twoHoursAgo).toISOString(),
        failedAt: new Date(twoHoursAgo).toISOString(),
        attempts: 1,
      }]),
    );
    let pushCalls = 0;
    // Platform default is 30 days — this entry would normally still be attempted.
    // A team-configured 1-hour max age purges it first instead.
    await flushQueue({
      configDir, cliToken: 'tl_key',
      getEffectiveRecallSettingsFn: stubSettings({ max_entry_age_ms: 60 * 60 * 1000 }),
      pushNoteFn: async () => { pushCalls++; return { ok: true }; },
    });
    assert.equal(pushCalls, 0);
    assert.equal(readQueue(configDir).length, 0);
  });

  it('uses the caller-supplied settings param instead of fetching, when provided — maybeAutoFlush relies on this to avoid a double fetch', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    let fetchCalls = 0;
    const result = await flushQueue({
      configDir, cliToken: 'tl_key',
      settings: { ...DEFAULT_RECALL_SETTINGS },
      getEffectiveRecallSettingsFn: async () => { fetchCalls++; return DEFAULT_RECALL_SETTINGS; },
      pushNoteFn: async () => ({ ok: true, status: 200 }),
    });
    assert.equal(fetchCalls, 0);
    assert.equal(result.flushed, 1);
  });

  it('defaults to a silent warn (no output) when the caller does not supply one', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    await assert.doesNotReject(flushQueue({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(), pushNoteFn: async () => ({ ok: false }) }));
  });

  it('passes the caller-supplied warn through to pushNoteFn for a manual/visible sync', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    let capturedWarn;
    await flushQueue({
      configDir,
      cliToken: 'tl_key',
      warn: () => {},
      getEffectiveRecallSettingsFn: stubSettings(),
      pushNoteFn: async (note, opts) => { capturedWarn = opts.warn; return { ok: true }; },
    });
    assert.equal(typeof capturedWarn, 'function');
  });
});

// ---------------------------------------------------------------------------
// maybeAutoFlush
// ---------------------------------------------------------------------------

describe('maybeAutoFlush', () => {
  it('does nothing when the queue is empty', async () => {
    const configDir = freshConfigDir();
    let flushCalls = 0;
    await maybeAutoFlush({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(), flushQueueFn: async () => { flushCalls++; return { flushed: 0, remaining: 0 }; } });
    assert.equal(flushCalls, 0);
  });

  it('does not fetch settings at all when the queue is empty — the empty-queue check must stay a pure local read', async () => {
    const configDir = freshConfigDir();
    let fetchCalls = 0;
    await maybeAutoFlush({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: async () => { fetchCalls++; return DEFAULT_RECALL_SETTINGS; } });
    assert.equal(fetchCalls, 0);
  });

  it('flushes when the queue is non-empty and no flush has ever been attempted', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    let flushCalls = 0;
    await maybeAutoFlush({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(), flushQueueFn: async () => { flushCalls++; return { flushed: 1, remaining: 0 }; } });
    assert.equal(flushCalls, 1);
  });

  it(`skips flushing when less than ${AUTO_FLUSH_INTERVAL_MS}ms have passed since the last attempt`, async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    fs.writeFileSync(path.join(configDir, 'recall-flush-state.json'), JSON.stringify({ lastAttemptAt: new Date().toISOString() }));
    let flushCalls = 0;
    await maybeAutoFlush({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(), flushQueueFn: async () => { flushCalls++; return { flushed: 0, remaining: 1 }; } });
    assert.equal(flushCalls, 0);
  });

  it(`flushes again once ${AUTO_FLUSH_INTERVAL_MS}ms have passed since the last attempt`, async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    const longAgo = new Date(Date.now() - AUTO_FLUSH_INTERVAL_MS - 1).toISOString();
    fs.writeFileSync(path.join(configDir, 'recall-flush-state.json'), JSON.stringify({ lastAttemptAt: longAgo }));
    let flushCalls = 0;
    await maybeAutoFlush({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(), flushQueueFn: async () => { flushCalls++; return { flushed: 1, remaining: 0 }; } });
    assert.equal(flushCalls, 1);
  });

  it('records the attempt timestamp even when the flush fails, so a failing backend cannot be hammered every command within the window', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    await maybeAutoFlush({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(), flushQueueFn: async () => { throw new Error('network down'); } }).catch(() => {});
    const state = JSON.parse(fs.readFileSync(path.join(configDir, 'recall-flush-state.json'), 'utf8'));
    assert.ok(state.lastAttemptAt);
  });

  it('returns null (not the flush result) when skipped for an empty queue — lets a caller distinguish "nothing to report" from "attempted, flushed 0"', async () => {
    const configDir = freshConfigDir();
    const result = await maybeAutoFlush({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(), flushQueueFn: async () => ({ flushed: 0, remaining: 0 }) });
    assert.equal(result, null);
  });

  it('returns null when skipped for the cooldown window', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    fs.writeFileSync(path.join(configDir, 'recall-flush-state.json'), JSON.stringify({ lastAttemptAt: new Date().toISOString() }));
    const result = await maybeAutoFlush({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(), flushQueueFn: async () => ({ flushed: 0, remaining: 1 }) });
    assert.equal(result, null);
  });

  it('returns the real flush result when it actually attempts', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    const result = await maybeAutoFlush({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(), flushQueueFn: async () => ({ flushed: 1, remaining: 0 }) });
    assert.deepEqual(result, { flushed: 1, remaining: 0 });
  });

  it('returns null (not throws) when the flush attempt itself throws', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    const result = await maybeAutoFlush({ configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(), flushQueueFn: async () => { throw new Error('network down'); } });
    assert.equal(result, null);
  });

  it('passes a caller-supplied timeoutMs through to flushQueueFn', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    let captured;
    await maybeAutoFlush({
      configDir, cliToken: 'tl_key', timeoutMs: 4000, getEffectiveRecallSettingsFn: stubSettings(),
      flushQueueFn: async (opts) => { captured = opts.timeoutMs; return { flushed: 1, remaining: 0 }; },
    });
    assert.equal(captured, 4000);
  });

  it('omitting timeoutMs defaults it to the effective settings\' timeout_ms — unlike flushQueue, maybeAutoFlush always runs on every command and must never let a slow request block one', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    let captured = 'unset';
    await maybeAutoFlush({
      configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings(),
      flushQueueFn: async (opts) => { captured = opts.timeoutMs; return { flushed: 1, remaining: 0 }; },
    });
    assert.equal(captured, DEFAULT_RECALL_SETTINGS.timeout_ms);
  });

  it('fetches settings live exactly once and threads the result into flushQueueFn — a Console-configured cooldown/timeout override takes effect without a code change, and without a duplicate fetch', async () => {
    const configDir = freshConfigDir();
    await enqueueNote(samplePayload, { configDir, cliToken: 'tl_key', getEffectiveRecallSettingsFn: stubSettings() });
    fs.writeFileSync(path.join(configDir, 'recall-flush-state.json'), JSON.stringify({ lastAttemptAt: new Date(Date.now() - 5000).toISOString() }));
    let fetchCalls = 0;
    let flushCalls = 0;
    let capturedTimeoutMs;
    let capturedSettings;
    // A 1s cooldown means the 5s-old lastAttemptAt is stale enough to flush again.
    await maybeAutoFlush({
      configDir, cliToken: 'tl_key',
      getEffectiveRecallSettingsFn: async () => { fetchCalls++; return { ...DEFAULT_RECALL_SETTINGS, flush_cooldown_ms: 1000, timeout_ms: 9999 }; },
      flushQueueFn: async (opts) => { flushCalls++; capturedTimeoutMs = opts.timeoutMs; capturedSettings = opts.settings; return { flushed: 1, remaining: 0 }; },
    });
    assert.equal(fetchCalls, 1);
    assert.equal(flushCalls, 1);
    assert.equal(capturedTimeoutMs, 9999);
    assert.equal(capturedSettings.flush_cooldown_ms, 1000);
  });
});
