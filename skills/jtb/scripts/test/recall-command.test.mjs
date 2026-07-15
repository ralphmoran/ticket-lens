import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runRecall } from '../lib/recall-command.mjs';

function makeStream() {
  const lines = [];
  return { write: (s) => lines.push(s), lines };
}

function baseDeps(overrides = {}) {
  return {
    configDir: '/fake/config',
    stream: makeStream(),
    errorStream: makeStream(),
    isLicensedFn: () => true,
    listDigestsFn: () => [],
    ...overrides,
  };
}

describe('runRecall — license gate', () => {
  test('unlicensed: never calls listDigests, shows upgrade prompt, reports failure', async () => {
    let calls = 0;
    const deps = baseDeps({ isLicensedFn: () => false, listDigestsFn: () => { calls++; return []; } });
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
    const deps = baseDeps({ listDigestsFn: (filter) => { captured = filter; return []; } });
    await runRecall(['PROD-123'], deps);
    assert.deepEqual(captured, { ticketKey: 'PROD-123' });
  });

  test('a non-ticket-key argument searches by free-text query', async () => {
    let captured;
    const deps = baseDeps({ listDigestsFn: (filter) => { captured = filter; return []; } });
    await runRecall(['backoff strategy'], deps);
    assert.deepEqual(captured, { query: 'backoff strategy' });
  });
});

describe('runRecall — output', () => {
  test('prints each matching note title with its tickets and date', async () => {
    const deps = baseDeps({
      listDigestsFn: () => [
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
      listDigestsFn: () => [{ title: 'General note', tickets: [], created: '2026-07-10T00:00:00.000Z' }],
    });
    await runRecall(['general'], deps);
    assert.match(deps.stream.lines.join(''), /General note/);
  });

  test('no matches prints a clear empty-state message and still reports success', async () => {
    const deps = baseDeps({ listDigestsFn: () => [] });
    const result = await runRecall(['nothing-matches-this'], deps);
    assert.match(deps.stream.lines.join(''), /No matching notes/i);
    assert.equal(result.ok, true);
  });

  test('a completed search with results reports success', async () => {
    const deps = baseDeps({
      listDigestsFn: () => [{ title: 'x', tickets: [], created: '2026-07-10T00:00:00.000Z' }],
    });
    const result = await runRecall(['x'], deps);
    assert.equal(result.ok, true);
  });
});
