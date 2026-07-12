import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { flushStdin } from '../lib/prompt-helpers.mjs';

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
