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
  MAX_QUEUE_SIZE,
  MAX_ENTRY_AGE_MS,
  AUTO_FLUSH_INTERVAL_MS,
} from '../lib/recall-queue.mjs';

function freshConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tl-recall-queue-test-'));
}

function hashToken(cliToken) {
  return createHash('sha256').update(cliToken).digest('hex');
}

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
  it('appends a new entry with the payload, a hashed tokenHash, and zero attempts', () => {
    const configDir = freshConfigDir();
    enqueueNote(samplePayload, { configDir, cliToken: 'tl_key' });
    const queue = readQueue(configDir);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, samplePayload.external_id);
    assert.deepEqual(queue[0].notePayload, samplePayload);
    assert.equal(queue[0].tokenHash, hashToken('tl_key'));
    assert.equal(queue[0].attempts, 0);
    assert.ok(queue[0].firstQueuedAt);
    assert.ok(queue[0].failedAt);
  });

  it('never persists the raw cliToken anywhere in the queue file', () => {
    const configDir = freshConfigDir();
    enqueueNote(samplePayload, { configDir, cliToken: 'tl_super_secret_key' });
    const raw = fs.readFileSync(path.join(configDir, 'recall-pending.json'), 'utf8');
    assert.equal(raw.includes('tl_super_secret_key'), false);
  });

  it('appends to an existing queue rather than overwriting it', () => {
    const configDir = freshConfigDir();
    enqueueNote(samplePayload, { configDir, cliToken: 'tl_key' });
    enqueueNote({ ...samplePayload, external_id: 'second.md' }, { configDir, cliToken: 'tl_key' });
    assert.equal(readQueue(configDir).length, 2);
  });

  it(`evicts the oldest entry and warns once when appending past the ${MAX_QUEUE_SIZE}-entry cap`, () => {
    const configDir = freshConfigDir();
    const warnings = [];
    for (let i = 0; i < MAX_QUEUE_SIZE; i++) {
      enqueueNote({ ...samplePayload, external_id: `note-${i}.md` }, { configDir, cliToken: 'tl_key', warn: (s) => warnings.push(s) });
    }
    assert.equal(readQueue(configDir).length, MAX_QUEUE_SIZE);
    enqueueNote({ ...samplePayload, external_id: 'overflow.md' }, { configDir, cliToken: 'tl_key', warn: (s) => warnings.push(s) });
    const queue = readQueue(configDir);
    assert.equal(queue.length, MAX_QUEUE_SIZE);
    assert.equal(queue.some(e => e.id === 'note-0.md'), false, 'oldest entry should have been evicted');
    assert.equal(queue.some(e => e.id === 'overflow.md'), true);
    assert.equal(warnings.length, 1, 'exactly one warn for the eviction, not one per enqueue');
  });

  it(`purges entries older than the ${MAX_ENTRY_AGE_MS}ms age limit before appending, based on firstQueuedAt`, () => {
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
    enqueueNote({ ...samplePayload, external_id: 'fresh.md' }, { configDir, cliToken: 'tl_key' });
    const queue = readQueue(configDir);
    assert.equal(queue.some(e => e.id === 'stale.md'), false);
    assert.equal(queue.some(e => e.id === 'fresh.md'), true);
  });

  it('does NOT expire an entry that keeps failing (failedAt keeps refreshing) if its firstQueuedAt is still within the age limit', () => {
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
    enqueueNote({ ...samplePayload, external_id: 'another.md' }, { configDir, cliToken: 'tl_key' });
    assert.equal(readQueue(configDir).some(e => e.id === 'still-alive.md'), true);
  });
});

// ---------------------------------------------------------------------------
// flushQueue
// ---------------------------------------------------------------------------

describe('flushQueue', () => {
  it('removes an entry on a successful push', async () => {
    const configDir = freshConfigDir();
    enqueueNote(samplePayload, { configDir, cliToken: 'tl_key' });
    const result = await flushQueue({ configDir, cliToken: 'tl_key', pushNoteFn: async () => ({ ok: true, status: 200 }) });
    assert.equal(result.flushed, 1);
    assert.equal(result.remaining, 0);
    assert.equal(readQueue(configDir).length, 0);
  });

  it('keeps an entry queued and increments attempts on a failed push', async () => {
    const configDir = freshConfigDir();
    enqueueNote(samplePayload, { configDir, cliToken: 'tl_key' });
    const result = await flushQueue({ configDir, cliToken: 'tl_key', pushNoteFn: async () => ({ ok: false }) });
    assert.equal(result.flushed, 0);
    assert.equal(result.remaining, 1);
    assert.equal(readQueue(configDir)[0].attempts, 1);
  });

  it('updates failedAt on a retry attempt but leaves firstQueuedAt untouched', async () => {
    const configDir = freshConfigDir();
    enqueueNote(samplePayload, { configDir, cliToken: 'tl_key' });
    const original = readQueue(configDir)[0];
    await new Promise(r => setTimeout(r, 5));
    await flushQueue({ configDir, cliToken: 'tl_key', pushNoteFn: async () => ({ ok: false }) });
    const updated = readQueue(configDir)[0];
    assert.equal(updated.firstQueuedAt, original.firstQueuedAt);
    assert.notEqual(updated.failedAt, original.failedAt);
  });

  it('skips (leaves untouched, does not attempt or evict) an entry queued under a different account', async () => {
    const configDir = freshConfigDir();
    enqueueNote(samplePayload, { configDir, cliToken: 'old_account_token' });
    let pushCalls = 0;
    const result = await flushQueue({ configDir, cliToken: 'new_account_token', pushNoteFn: async () => { pushCalls++; return { ok: true }; } });
    assert.equal(pushCalls, 0);
    assert.equal(result.flushed, 0);
    assert.equal(result.remaining, 1);
    assert.equal(readQueue(configDir).length, 1);
  });

  it('drops an entry immediately (no requeue) when a retry surfaces a non-retryable failure — e.g. the session expired between enqueue and this attempt', async () => {
    const configDir = freshConfigDir();
    enqueueNote(samplePayload, { configDir, cliToken: 'tl_key' });
    const result = await flushQueue({ configDir, cliToken: 'tl_key', pushNoteFn: async () => ({ ok: false, status: 401 }) });
    assert.equal(result.flushed, 0);
    assert.equal(result.remaining, 0);
    assert.equal(readQueue(configDir).length, 0);
  });

  it('reclassifies pushNote\'s cached-entitlement skip (status: 403, skipped: true) as non-retryable on retry, dropping it — regression guard matching isRetryableFailure', async () => {
    const configDir = freshConfigDir();
    enqueueNote(samplePayload, { configDir, cliToken: 'tl_key' });
    const result = await flushQueue({ configDir, cliToken: 'tl_key', pushNoteFn: async () => ({ ok: false, status: 403, skipped: true }) });
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
    await flushQueue({ configDir, cliToken: 'tl_key', pushNoteFn: async () => { pushCalls++; return { ok: true }; } });
    assert.equal(pushCalls, 0, 'an expired entry must never be attempted');
    assert.equal(readQueue(configDir).length, 0);
  });

  it('defaults to a silent warn (no output) when the caller does not supply one', async () => {
    const configDir = freshConfigDir();
    enqueueNote(samplePayload, { configDir, cliToken: 'tl_key' });
    await assert.doesNotReject(flushQueue({ configDir, cliToken: 'tl_key', pushNoteFn: async () => ({ ok: false }) }));
  });

  it('passes the caller-supplied warn through to pushNoteFn for a manual/visible sync', async () => {
    const configDir = freshConfigDir();
    enqueueNote(samplePayload, { configDir, cliToken: 'tl_key' });
    let capturedWarn;
    await flushQueue({
      configDir,
      cliToken: 'tl_key',
      warn: () => {},
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
    await maybeAutoFlush({ configDir, cliToken: 'tl_key', flushQueueFn: async () => { flushCalls++; return { flushed: 0, remaining: 0 }; } });
    assert.equal(flushCalls, 0);
  });

  it('flushes when the queue is non-empty and no flush has ever been attempted', async () => {
    const configDir = freshConfigDir();
    enqueueNote(samplePayload, { configDir, cliToken: 'tl_key' });
    let flushCalls = 0;
    await maybeAutoFlush({ configDir, cliToken: 'tl_key', flushQueueFn: async () => { flushCalls++; return { flushed: 1, remaining: 0 }; } });
    assert.equal(flushCalls, 1);
  });

  it(`skips flushing when less than ${AUTO_FLUSH_INTERVAL_MS}ms have passed since the last attempt`, async () => {
    const configDir = freshConfigDir();
    enqueueNote(samplePayload, { configDir, cliToken: 'tl_key' });
    fs.writeFileSync(path.join(configDir, 'recall-flush-state.json'), JSON.stringify({ lastAttemptAt: new Date().toISOString() }));
    let flushCalls = 0;
    await maybeAutoFlush({ configDir, cliToken: 'tl_key', flushQueueFn: async () => { flushCalls++; return { flushed: 0, remaining: 1 }; } });
    assert.equal(flushCalls, 0);
  });

  it(`flushes again once ${AUTO_FLUSH_INTERVAL_MS}ms have passed since the last attempt`, async () => {
    const configDir = freshConfigDir();
    enqueueNote(samplePayload, { configDir, cliToken: 'tl_key' });
    const longAgo = new Date(Date.now() - AUTO_FLUSH_INTERVAL_MS - 1).toISOString();
    fs.writeFileSync(path.join(configDir, 'recall-flush-state.json'), JSON.stringify({ lastAttemptAt: longAgo }));
    let flushCalls = 0;
    await maybeAutoFlush({ configDir, cliToken: 'tl_key', flushQueueFn: async () => { flushCalls++; return { flushed: 1, remaining: 0 }; } });
    assert.equal(flushCalls, 1);
  });

  it('records the attempt timestamp even when the flush fails, so a failing backend cannot be hammered every command within the window', async () => {
    const configDir = freshConfigDir();
    enqueueNote(samplePayload, { configDir, cliToken: 'tl_key' });
    await maybeAutoFlush({ configDir, cliToken: 'tl_key', flushQueueFn: async () => { throw new Error('network down'); } }).catch(() => {});
    const state = JSON.parse(fs.readFileSync(path.join(configDir, 'recall-flush-state.json'), 'utf8'));
    assert.ok(state.lastAttemptAt);
  });
});
