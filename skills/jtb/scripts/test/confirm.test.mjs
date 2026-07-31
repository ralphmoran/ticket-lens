import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmDestructive } from '../lib/confirm.mjs';

function makeStream() {
  const lines = [];
  return { lines, write: (s) => lines.push(s) };
}

function fakeInteractiveStdin(keypress) {
  let rawModeSet = null;
  let resumed = false;
  let paused = false;
  const listeners = {};
  return {
    isTTY: true,
    setRawMode: (v) => { rawModeSet = v; },
    resume: () => { resumed = true; },
    pause: () => { paused = true; },
    once: (event, cb) => { listeners[event] = cb; if (event === 'data') cb(Buffer.from(keypress)); },
    get rawModeSet() { return rawModeSet; },
    get resumed() { return resumed; },
    get paused() { return paused; },
  };
}

function nonTtyStdin() {
  return { isTTY: false, setRawMode: undefined, resume: () => {}, pause: () => {}, once: () => {} };
}

describe('confirmDestructive — forceYes bypass', () => {
  test('forceYes true never touches stdin, resolves true immediately', async () => {
    let stdinTouched = false;
    const stdin = { get isTTY() { stdinTouched = true; return true; } };
    const stream = makeStream();
    const result = await confirmDestructive('Delete X', { stdin, stream, forceYes: true });
    assert.equal(result, true);
    assert.equal(stdinTouched, false);
    assert.deepEqual(stream.lines, []);
  });
});

describe('confirmDestructive — non-interactive without forceYes', () => {
  test('refuses and writes a --yes hint, does not hang', async () => {
    const stream = makeStream();
    const result = await confirmDestructive('Delete X', { stdin: nonTtyStdin(), stream, forceYes: false });
    assert.equal(result, false);
    assert.match(stream.lines.join(''), /--yes/);
  });

  test('a TTY stdin without setRawMode is treated as non-interactive', async () => {
    const stream = makeStream();
    const stdin = { isTTY: true, setRawMode: undefined };
    const result = await confirmDestructive('Delete X', { stdin, stream, forceYes: false });
    assert.equal(result, false);
  });
});

describe('confirmDestructive — interactive TTY prompt', () => {
  test('typing y resolves true', async () => {
    const stream = makeStream();
    const stdin = fakeInteractiveStdin('y');
    const result = await confirmDestructive('Delete X', { stdin, stream, forceYes: false });
    assert.equal(result, true);
    assert.equal(stdin.rawModeSet, false); // cleaned up after the keypress
    assert.equal(stdin.resumed, true);
    assert.equal(stdin.paused, true);
  });

  test('typing Y (uppercase) resolves true', async () => {
    const stream = makeStream();
    const result = await confirmDestructive('Delete X', { stdin: fakeInteractiveStdin('Y'), stream, forceYes: false });
    assert.equal(result, true);
  });

  test('typing n resolves false', async () => {
    const stream = makeStream();
    const result = await confirmDestructive('Delete X', { stdin: fakeInteractiveStdin('n'), stream, forceYes: false });
    assert.equal(result, false);
  });

  test('pressing Enter with no other input resolves false (safe default)', async () => {
    const stream = makeStream();
    const result = await confirmDestructive('Delete X', { stdin: fakeInteractiveStdin('\r'), stream, forceYes: false });
    assert.equal(result, false);
  });

  test('any other key resolves false', async () => {
    const stream = makeStream();
    const result = await confirmDestructive('Delete X', { stdin: fakeInteractiveStdin('x'), stream, forceYes: false });
    assert.equal(result, false);
  });

  test('prompt text includes the action, the irreversibility warning, and y/N', async () => {
    const stream = makeStream();
    await confirmDestructive('Delete note abc123', { stdin: fakeInteractiveStdin('n'), stream, forceYes: false });
    const prompt = stream.lines[0];
    assert.match(prompt, /Delete note abc123/);
    assert.match(prompt, /cannot be restored/i);
    assert.match(prompt, /y\/N/);
  });
});
