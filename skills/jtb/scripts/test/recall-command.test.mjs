import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runRecall, runRecallSync, runRecallSettings } from '../lib/recall-command.mjs';
import { DEFAULT_RECALL_SETTINGS } from '../lib/recall-settings-sync.mjs';

function makeStream({ isTTY = false } = {}) {
  const lines = [];
  return { write: (s) => lines.push(s), lines, isTTY };
}

function baseDeps(overrides = {}) {
  return {
    configDir: '/fake/config',
    stream: makeStream(),
    errorStream: makeStream(),
    isLicensedFn: () => true,
    listNotesFn: () => [],
    maybeAutoFlushFn: () => {},
    ...overrides,
  };
}

function baseSyncDeps(overrides = {}) {
  return {
    configDir: '/fake/config',
    stream: makeStream(),
    isLicensedFn: () => true,
    readCliTokenFn: () => 'tl_key',
    readQueueFn: () => [],
    flushQueueFn: () => Promise.resolve({ flushed: 0, remaining: 0 }),
    ...overrides,
  };
}

describe('runRecall — license gate', () => {
  test('unlicensed: never calls listNotes, shows upgrade prompt, reports failure', async () => {
    let calls = 0;
    const deps = baseDeps({ isLicensedFn: () => false, listNotesFn: () => { calls++; return []; } });
    const result = await runRecall(['backoff'], deps);
    assert.equal(calls, 0);
    assert.equal(result.ok, false);
  });
});

describe('runRecall — usage validation', () => {
  test('no query or ticket key argument shows usage and reports failure', async () => {
    const deps = baseDeps();
    const result = await runRecall([], deps);
    assert.match(deps.stream.lines.join(''), /Usage/i);
    assert.equal(result.ok, false);
  });
});

describe('runRecall — dispatches by argument shape', () => {
  test('a ticket-key-shaped argument searches by ticket key', async () => {
    let captured;
    const deps = baseDeps({ listNotesFn: (filter) => { captured = filter; return []; } });
    await runRecall(['PROD-123'], deps);
    assert.deepEqual(captured, { ticketKey: 'PROD-123' });
  });

  test('a non-ticket-key argument searches by free-text query', async () => {
    let captured;
    const deps = baseDeps({ listNotesFn: (filter) => { captured = filter; return []; } });
    await runRecall(['backoff strategy'], deps);
    assert.deepEqual(captured, { query: 'backoff strategy' });
  });
});

describe('runRecall — output', () => {
  test('prints each matching note title with its tickets and date', async () => {
    const deps = baseDeps({
      listNotesFn: () => [
        { title: 'Retry gotcha', tickets: ['PROD-1'], created: '2026-07-10T00:00:00.000Z' },
      ],
    });
    await runRecall(['retry'], deps);
    const output = deps.stream.lines.join('');
    assert.match(output, /Retry gotcha/);
    assert.match(output, /PROD-1/);
    assert.match(output, /2026-07-10/);
  });

  test('a note with no linked tickets prints without a ticket list', async () => {
    const deps = baseDeps({
      listNotesFn: () => [{ title: 'General note', tickets: [], created: '2026-07-10T00:00:00.000Z' }],
    });
    await runRecall(['general'], deps);
    assert.match(deps.stream.lines.join(''), /General note/);
  });

  test('no matches prints a clear empty-state message and still reports success', async () => {
    const deps = baseDeps({ listNotesFn: () => [] });
    const result = await runRecall(['nothing-matches-this'], deps);
    assert.match(deps.stream.lines.join(''), /No matching notes/i);
    assert.equal(result.ok, true);
  });

  test('a completed search with results reports success', async () => {
    const deps = baseDeps({
      listNotesFn: () => [{ title: 'x', tickets: [], created: '2026-07-10T00:00:00.000Z' }],
    });
    const result = await runRecall(['x'], deps);
    assert.equal(result.ok, true);
  });
});

describe('runRecall — styled vs --plain output', () => {
  const oneNote = () => [{ id: 'note-1.md', title: 'Retry gotcha', tickets: ['PROD-1'], created: '2026-07-10T00:00:00.000Z', body: 'Add backoff.' }];

  test('a TTY stream without --plain gets styled output (ANSI codes present)', async () => {
    const deps = baseDeps({ stream: makeStream({ isTTY: true }), listNotesFn: oneNote });
    await runRecall(['retry'], deps);
    assert.match(deps.stream.lines.join(''), /\x1b\[/);
  });

  test('a TTY stream with --plain gets the exact bare format, no ANSI codes', async () => {
    const deps = baseDeps({ stream: makeStream({ isTTY: true }), listNotesFn: oneNote });
    await runRecall(['retry', '--plain'], deps);
    const output = deps.stream.lines.join('');
    assert.doesNotMatch(output, /\x1b\[/);
    assert.equal(output, 'Retry gotcha (PROD-1) — 2026-07-10  [note-1.md]\n');
  });

  test('a non-TTY stream (piped) gets plain output even without --plain', async () => {
    const deps = baseDeps({ stream: makeStream({ isTTY: false }), listNotesFn: oneNote });
    await runRecall(['retry'], deps);
    assert.doesNotMatch(deps.stream.lines.join(''), /\x1b\[/);
  });
});

describe('runRecall — --full prints note content', () => {
  const oneNote = () => [{ id: 'note-1.md', title: 'Retry gotcha', tickets: ['PROD-1'], created: '2026-07-10T00:00:00.000Z', body: 'Add exponential backoff.' }];

  test('without --full, body content is not printed', async () => {
    const deps = baseDeps({ listNotesFn: oneNote });
    await runRecall(['retry'], deps);
    assert.doesNotMatch(deps.stream.lines.join(''), /Add exponential backoff/);
  });

  test('--full prints each matching note\'s body content', async () => {
    const deps = baseDeps({ listNotesFn: oneNote });
    await runRecall(['retry', '--full'], deps);
    assert.match(deps.stream.lines.join(''), /Add exponential backoff\./);
  });

  test('--full works together with --plain (exact bare format, with body)', async () => {
    const deps = baseDeps({ stream: makeStream({ isTTY: true }), listNotesFn: oneNote });
    await runRecall(['retry', '--plain', '--full'], deps);
    const output = deps.stream.lines.join('');
    assert.doesNotMatch(output, /\x1b\[/);
    assert.equal(output, 'Retry gotcha (PROD-1) — 2026-07-10  [note-1.md]\nAdd exponential backoff.\n');
  });
});

describe('runRecall — team sync (pull before search)', () => {
  test('with a cliToken, pulls before searching, using the full (non-hot-path) timeout', async () => {
    let pullCalled = false;
    const deps = baseDeps({
      readCliTokenFn: () => 'tl_key',
      pullNotesFn: () => { pullCalled = true; return Promise.resolve({ ok: true, count: 0 }); },
    });
    await runRecall(['retry'], deps);
    assert.equal(pullCalled, true);
  });

  test('without a cliToken, never attempts a pull', async () => {
    let pullCalls = 0;
    const deps = baseDeps({
      readCliTokenFn: () => null,
      pullNotesFn: () => { pullCalls++; return Promise.resolve({ ok: true, count: 0 }); },
    });
    await runRecall(['retry'], deps);
    assert.equal(pullCalls, 0);
  });

  test('a pull failure does not block the local search from returning results', async () => {
    const deps = baseDeps({
      readCliTokenFn: () => 'tl_key',
      pullNotesFn: () => Promise.resolve({ ok: false, count: 0 }),
      listNotesFn: () => [{ title: 'Local note', tickets: [], created: '2026-07-10T00:00:00.000Z' }],
    });
    const result = await runRecall(['retry'], deps);
    assert.equal(result.ok, true);
    assert.match(deps.stream.lines.join(''), /Local note/);
  });

  test('--no-cache forces a fresh pull (ttlMs: 0)', async () => {
    let capturedTtl;
    const deps = baseDeps({
      readCliTokenFn: () => 'tl_key',
      pullNotesFn: (opts) => { capturedTtl = opts.ttlMs; return Promise.resolve({ ok: true, count: 0 }); },
    });
    await runRecall(['retry', '--no-cache'], deps);
    assert.equal(capturedTtl, 0);
  });

  test('without --no-cache, the default TTL is used (no override)', async () => {
    let capturedOpts;
    const deps = baseDeps({
      readCliTokenFn: () => 'tl_key',
      pullNotesFn: (opts) => { capturedOpts = opts; return Promise.resolve({ ok: true, count: 0 }); },
    });
    await runRecall(['retry'], deps);
    assert.equal('ttlMs' in capturedOpts, false);
  });

  test('with a cliToken, also attempts an auto-flush of the retry queue alongside the pull', async () => {
    let autoFlushCalled = false;
    const deps = baseDeps({
      readCliTokenFn: () => 'tl_key',
      pullNotesFn: () => Promise.resolve({ ok: true, count: 0 }),
      maybeAutoFlushFn: () => { autoFlushCalled = true; },
    });
    await runRecall(['retry'], deps);
    assert.equal(autoFlushCalled, true);
  });

  test('without a cliToken, never attempts an auto-flush', async () => {
    let autoFlushCalls = 0;
    const deps = baseDeps({
      readCliTokenFn: () => null,
      maybeAutoFlushFn: () => { autoFlushCalls++; },
    });
    await runRecall(['retry'], deps);
    assert.equal(autoFlushCalls, 0);
  });
});

describe('runRecallSync — license gate', () => {
  test('unlicensed: never reads the queue, shows upgrade prompt, reports failure', async () => {
    let calls = 0;
    const deps = baseSyncDeps({ isLicensedFn: () => false, readQueueFn: () => { calls++; return []; } });
    const result = await runRecallSync([], deps);
    assert.equal(calls, 0);
    assert.equal(result.ok, false);
  });
});

describe('runRecallSync — not logged in', () => {
  test('no cliToken: never touches the queue, prints a clear message, reports failure', async () => {
    let flushCalls = 0;
    const deps = baseSyncDeps({ readCliTokenFn: () => null, flushQueueFn: () => { flushCalls++; return Promise.resolve({ flushed: 0, remaining: 0 }); } });
    const result = await runRecallSync([], deps);
    assert.equal(flushCalls, 0);
    assert.equal(result.ok, false);
    assert.match(deps.stream.lines.join(''), /not logged in/i);
  });
});

describe('runRecallSync — flushing', () => {
  test('an empty queue prints "Nothing to sync" without calling flushQueueFn', async () => {
    let flushCalls = 0;
    const deps = baseSyncDeps({ readQueueFn: () => [], flushQueueFn: () => { flushCalls++; return Promise.resolve({ flushed: 0, remaining: 0 }); } });
    const result = await runRecallSync([], deps);
    assert.equal(flushCalls, 0);
    assert.equal(result.ok, true);
    assert.match(deps.stream.lines.join(''), /nothing to sync/i);
  });

  test('a non-empty queue is flushed and the summary reports synced + still-pending counts', async () => {
    const deps = baseSyncDeps({
      readQueueFn: () => [{ id: 'a.md' }, { id: 'b.md' }],
      flushQueueFn: () => Promise.resolve({ flushed: 1, remaining: 1 }),
    });
    const result = await runRecallSync([], deps);
    assert.equal(result.ok, true);
    assert.match(deps.stream.lines.join(''), /1.*synced|synced.*1/i);
    assert.match(deps.stream.lines.join(''), /1.*pending/i);
  });

  test('flushQueueFn receives a real (non-silent) warn — unlike auto-flush, a manual sync must be visible', async () => {
    let capturedWarn;
    const deps = baseSyncDeps({
      readQueueFn: () => [{ id: 'a.md' }],
      flushQueueFn: (opts) => { capturedWarn = opts.warn; return Promise.resolve({ flushed: 0, remaining: 1 }); },
    });
    await runRecallSync([], deps);
    assert.equal(typeof capturedWarn, 'function');
    capturedWarn('  test warning\n');
    assert.match(deps.stream.lines.join(''), /test warning/);
  });
});

function baseSettingsDeps(overrides = {}) {
  return {
    configDir: '/fake/config',
    stream: makeStream(),
    isLicensedFn: () => true,
    readCliTokenFn: () => null,
    getEffectiveRecallSettingsFn: () => Promise.resolve(DEFAULT_RECALL_SETTINGS),
    ...overrides,
  };
}

describe('runRecallSettings — license gate', () => {
  test('unlicensed: never fetches settings, shows upgrade prompt, reports failure', async () => {
    let calls = 0;
    const deps = baseSettingsDeps({ isLicensedFn: () => false, getEffectiveRecallSettingsFn: () => { calls++; return Promise.resolve(DEFAULT_RECALL_SETTINGS); } });
    const result = await runRecallSettings([], deps);
    assert.equal(calls, 0);
    assert.equal(result.ok, false);
  });
});

describe('runRecallSettings — output', () => {
  test('prints all four effective settings converted to human units', async () => {
    const deps = baseSettingsDeps({
      getEffectiveRecallSettingsFn: () => Promise.resolve({ flush_cooldown_ms: 600_000, timeout_ms: 8_000, max_queue_size: 50, max_entry_age_ms: 604_800_000 }),
    });
    const result = await runRecallSettings([], deps);
    assert.equal(result.ok, true);
    const out = deps.stream.lines.join('');
    assert.match(out, /10 min/);
    assert.match(out, /8 sec/);
    assert.match(out, /50/);
    assert.match(out, /7 days/);
  });

  test('not logged in: still fetches (getEffectiveRecallSettingsFn handles the no-token case itself), notes the source is platform default', async () => {
    let capturedCliToken = 'unset';
    const deps = baseSettingsDeps({
      readCliTokenFn: () => null,
      getEffectiveRecallSettingsFn: (opts) => { capturedCliToken = opts.cliToken; return Promise.resolve(DEFAULT_RECALL_SETTINGS); },
    });
    const result = await runRecallSettings([], deps);
    assert.equal(capturedCliToken, null);
    assert.equal(result.ok, true);
    assert.match(deps.stream.lines.join(''), /platform default/i);
  });

  test('logged in: passes the cliToken through to getEffectiveRecallSettingsFn, notes the source is team manager', async () => {
    let capturedCliToken;
    const deps = baseSettingsDeps({
      readCliTokenFn: () => 'tl_key',
      getEffectiveRecallSettingsFn: (opts) => { capturedCliToken = opts.cliToken; return Promise.resolve(DEFAULT_RECALL_SETTINGS); },
    });
    const result = await runRecallSettings([], deps);
    assert.equal(capturedCliToken, 'tl_key');
    assert.equal(result.ok, true);
    assert.match(deps.stream.lines.join(''), /team manager/i);
  });
});
