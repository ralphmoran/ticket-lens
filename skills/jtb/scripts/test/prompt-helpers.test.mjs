import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { flushStdin, promptRecallPulse } from '../lib/prompt-helpers.mjs';

function mockStdin({ paused = true, queue = [] } = {}) {
  const orig = {
    read: process.stdin.read,
    resume: process.stdin.resume,
    pause: process.stdin.pause,
    isPaused: process.stdin.isPaused,
  };
  const calls = { resume: 0, pause: 0 };
  const q = [...queue];
  process.stdin.read = () => q.shift() ?? null;
  process.stdin.resume = () => { calls.resume++; };
  process.stdin.pause = () => { calls.pause++; };
  process.stdin.isPaused = () => paused;
  return {
    calls,
    restore() {
      process.stdin.read = orig.read;
      process.stdin.resume = orig.resume;
      process.stdin.pause = orig.pause;
      process.stdin.isPaused = orig.isPaused;
    },
  };
}

describe('flushStdin', () => {
  it('resumes stdin, drains every pending chunk, then re-pauses if it was paused', async () => {
    const mock = mockStdin({ paused: true, queue: ['\r', null] });
    try {
      await flushStdin();
      assert.equal(mock.calls.resume, 1, 'should resume to let the fd poll fire');
      assert.equal(mock.calls.pause, 1, 'should restore paused state afterward');
    } finally {
      mock.restore();
    }
  });

  it('does not re-pause when stdin was already flowing', async () => {
    const mock = mockStdin({ paused: false, queue: [] });
    try {
      await flushStdin();
      assert.equal(mock.calls.pause, 0, 'should leave a flowing stream flowing');
    } finally {
      mock.restore();
    }
  });

  it('is a no-op when nothing is buffered', async () => {
    const mock = mockStdin({ paused: true, queue: [] });
    try {
      await assert.doesNotReject(() => flushStdin());
    } finally {
      mock.restore();
    }
  });

  it('does not throw when stdin.read/resume are unavailable', async () => {
    const orig = { read: process.stdin.read, resume: process.stdin.resume };
    try {
      process.stdin.read = undefined;
      process.stdin.resume = undefined;
      await assert.doesNotReject(() => flushStdin());
    } finally {
      process.stdin.read = orig.read;
      process.stdin.resume = orig.resume;
    }
  });
});

function mockRawStdin() {
  const orig = {
    read: process.stdin.read, resume: process.stdin.resume, pause: process.stdin.pause,
    isPaused: process.stdin.isPaused, setRawMode: process.stdin.setRawMode,
    setEncoding: process.stdin.setEncoding, on: process.stdin.on, removeListener: process.stdin.removeListener,
  };
  const emitter = new EventEmitter();
  process.stdin.read = () => null;
  process.stdin.resume = () => {};
  process.stdin.pause = () => {};
  process.stdin.isPaused = () => true;
  process.stdin.setRawMode = () => {};
  process.stdin.setEncoding = () => {};
  process.stdin.on = (...args) => emitter.on(...args);
  process.stdin.removeListener = (...args) => emitter.removeListener(...args);
  return {
    async sendKey(char) {
      // The prompt attaches its 'data' listener after flushStdin's internal
      // setImmediate tick — wait for that listener to exist before emitting,
      // otherwise the keypress fires into an empty room and the prompt hangs.
      while (emitter.listenerCount('data') === 0) {
        await new Promise(r => setImmediate(r));
      }
      emitter.emit('data', char);
    },
    restore() { Object.assign(process.stdin, orig); },
  };
}

describe('promptRecallPulse', () => {
  it('resolves "y" when the user presses y', async () => {
    const mock = mockRawStdin();
    try {
      const result = promptRecallPulse('Is Recall pulling its weight?', { stream: { write: () => {}, isTTY: false } });
      await mock.sendKey('y');
      assert.equal(await result, 'y');
    } finally {
      mock.restore();
    }
  });

  it('resolves "n" when the user presses n', async () => {
    const mock = mockRawStdin();
    try {
      const result = promptRecallPulse('q', { stream: { write: () => {}, isTTY: false } });
      await mock.sendKey('n');
      assert.equal(await result, 'n');
    } finally {
      mock.restore();
    }
  });

  it('resolves "skip" for any key that is not y or n', async () => {
    const mock = mockRawStdin();
    try {
      const result = promptRecallPulse('q', { stream: { write: () => {}, isTTY: false } });
      await mock.sendKey('s');
      assert.equal(await result, 'skip');
    } finally {
      mock.restore();
    }
  });

  it('treats uppercase Y/N the same as lowercase', async () => {
    const mock = mockRawStdin();
    try {
      const result = promptRecallPulse('q', { stream: { write: () => {}, isTTY: false } });
      await mock.sendKey('Y');
      assert.equal(await result, 'y');
    } finally {
      mock.restore();
    }
  });
});
