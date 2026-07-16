import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runRecall } from '../lib/recall-command.mjs';

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
});
