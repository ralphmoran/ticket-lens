import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { promptSelect, promptMultiSelect, runRawSelect } from '../lib/select-prompt.mjs';

function mockStream(isTTY = false) {
  const chunks = [];
  const s = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); },
  });
  s.isTTY = isTTY;
  s.columns = 80;
  s._chunks = chunks;
  s.output = () => chunks.join('');
  return s;
}

// Fake stdin — EventEmitter with the raw-mode surface runRawSelect touches.
// Lacks .read() on purpose: flushStdin() short-circuits and resolves immediately.
function fakeStdin() {
  const ee = new EventEmitter();
  ee.isRaw = false;
  ee.setRawMode = (v) => { ee.isRaw = v; return ee; };
  ee.resume = () => {};
  ee.pause = () => {};
  ee.setEncoding = () => {};
  return ee;
}

// Waits for the selector to attach its data listener, then delivers each key
// with an event-loop tick between — mirrors real one-chunk-per-keystroke input.
async function send(stdin, keys) {
  while (stdin.listenerCount('data') === 0) await new Promise(r => setImmediate(r));
  for (const k of keys) {
    stdin.emit('data', Buffer.from(k));
    await new Promise(r => setImmediate(r));
  }
}

const UP = '\x1b[A';
const DOWN = '\x1b[B';
const ENTER = '\r';
const ESC = '\x1b';
const SPACE = ' ';

describe('runRawSelect', () => {
  it('returns null immediately on non-TTY stream', async () => {
    const stream = mockStream(false);
    const result = await runRawSelect({ count: 3, renderFn: () => 0, stream });
    assert.equal(result, null);
  });

  it('returns null when setRawMode is unavailable', async () => {
    const stream = mockStream(true);
    const origSetRawMode = process.stdin.setRawMode;
    try {
      process.stdin.setRawMode = undefined;
      const result = await runRawSelect({ count: 3, renderFn: () => 0, stream });
      assert.equal(result, null);
    } finally {
      process.stdin.setRawMode = origSetRawMode;
    }
  });

  it('resolves selected index on Enter with injected stdin', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = runRawSelect({ count: 3, renderFn: () => 0, stream, stdin });
    await send(stdin, [DOWN, ENTER]);
    assert.equal(await p, 1);
  });

  it('resolves null on Esc', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = runRawSelect({ count: 3, renderFn: () => 0, stream, stdin });
    await send(stdin, [ESC]);
    assert.equal(await p, null);
  });

  it('onKey veto on Enter keeps the selector open', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    let vetoed = false;
    const p = runRawSelect({
      count: 2,
      renderFn: () => 0,
      stream,
      stdin,
      onKey: (key) => {
        if (key === ENTER && !vetoed) { vetoed = true; return 'veto'; }
        return false;
      },
    });
    await send(stdin, [ENTER, ENTER]); // first vetoed, second submits
    assert.equal(await p, 0);
    assert.ok(vetoed, 'onKey should have vetoed the first Enter');
  });

  it('onKey truthy return triggers re-render', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    let renders = 0;
    const p = runRawSelect({
      count: 2,
      renderFn: () => { renders++; return 0; },
      stream,
      stdin,
      onKey: (key) => key === SPACE,
    });
    await send(stdin, [SPACE, ENTER]);
    await p;
    assert.ok(renders >= 2, `space should re-render (got ${renders} renders)`);
  });
});

describe('promptSelect', () => {
  const items = [
    { label: 'Cloud  (email + API token)', sublabel: 'Jira Cloud' },
    { label: 'Server / PAT', sublabel: 'Jira Server 8.14+' },
    { label: 'Server / Basic', sublabel: 'Older versions' },
  ];

  it('returns null on non-TTY stream', async () => {
    const stream = mockStream(false);
    const result = await promptSelect(items, { stream });
    assert.equal(result, null);
  });

  it('lists all items to the stream on non-TTY', async () => {
    const stream = mockStream(false);
    await promptSelect(items, { stream });
    const out = stream.output();
    assert.ok(out.includes('Cloud  (email + API token)'), 'should list first item');
    assert.ok(out.includes('Server / PAT'), 'should list second item');
    assert.ok(out.includes('Server / Basic'), 'should list third item');
  });

  it('accepts custom hint text', async () => {
    const stream = mockStream(false);
    await promptSelect(items, { stream, hint: 'custom hint text' });
    // Non-TTY doesn't show hints — just verify no crash
    assert.equal(typeof stream.output(), 'string');
  });
});

describe('promptMultiSelect', () => {
  const items = [
    { label: 'ALPHA — Alpha Project' },
    { label: 'BETA — Beta Project' },
    { label: 'GAMMA — Gamma Project' },
  ];

  it('returns null on non-TTY stream', async () => {
    const stream = mockStream(false);
    const result = await promptMultiSelect(items, { stream });
    assert.equal(result, null);
  });

  it('Space toggles, Enter returns checked indices in order', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = promptMultiSelect(items, { stream, stdin });
    await send(stdin, [SPACE, DOWN, DOWN, SPACE, ENTER]);
    assert.deepEqual(await p, [0, 2]);
  });

  it('Enter with nothing checked returns empty array when minSelected is 0', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = promptMultiSelect(items, { stream, stdin });
    await send(stdin, [ENTER]);
    assert.deepEqual(await p, []);
  });

  it('initialSelected pre-checks items', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = promptMultiSelect(items, { stream, stdin, initialSelected: [1] });
    await send(stdin, [ENTER]);
    assert.deepEqual(await p, [1]);
  });

  it('deselecting a pre-checked item removes it', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = promptMultiSelect(items, { stream, stdin, initialSelected: [0, 1] });
    await send(stdin, [DOWN, SPACE, ENTER]); // uncheck index 1
    assert.deepEqual(await p, [0]);
  });

  it('a toggles all on, then all off', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = promptMultiSelect(items, { stream, stdin });
    await send(stdin, ['a', ENTER]);
    assert.deepEqual(await p, [0, 1, 2]);

    const stdin2 = fakeStdin();
    const p2 = promptMultiSelect(items, { stream, stdin: stdin2, initialSelected: [0, 1, 2] });
    await send(stdin2, ['a', ENTER]);
    assert.deepEqual(await p2, []);
  });

  it('minSelected vetoes Enter until enough are checked', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = promptMultiSelect(items, { stream, stdin, minSelected: 1 });
    await send(stdin, [ENTER, SPACE, ENTER]); // bare Enter vetoed, then check + confirm
    assert.deepEqual(await p, [0]);
    assert.ok(stream.output().includes('at least 1'), 'veto should flash a hint');
  });

  it('Esc returns null', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = promptMultiSelect(items, { stream, stdin, initialSelected: [0] });
    await send(stdin, [ESC]);
    assert.equal(await p, null);
  });

  it('scrolls long lists inside a viewport', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ label: `ITEM-${i}` }));
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = promptMultiSelect(many, { stream, stdin, maxVisible: 5 });
    await send(stdin, [DOWN, DOWN, DOWN, DOWN, DOWN, ENTER]); // move past the viewport
    await p;
    const out = stream.output();
    assert.ok(out.includes('1-5 of 15'), 'initial window indicator expected');
    assert.ok(out.includes('2-6 of 15'), 'window should slide after moving past last visible row');
  });

  it('cursor movement stays clamped to list bounds', async () => {
    const stream = mockStream(true);
    const stdin = fakeStdin();
    const p = promptMultiSelect(items, { stream, stdin });
    await send(stdin, [UP, UP, DOWN, DOWN, DOWN, DOWN, SPACE, ENTER]); // over-scroll both ends
    assert.deepEqual(await p, [2], 'cursor should clamp at last item');
  });
});
