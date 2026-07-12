import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { flushStdin } from '../lib/prompt-helpers.mjs';

describe('flushStdin', () => {
  it('drains every buffered chunk from stdin', () => {
    const queue = ['\r', null];
    const origRead = process.stdin.read;
    let calls = 0;
    try {
      process.stdin.read = () => { calls++; return queue.shift() ?? null; };
      flushStdin();
      assert.equal(calls, 2, 'should keep reading until read() returns null');
    } finally {
      process.stdin.read = origRead;
    }
  });

  it('is a no-op when nothing is buffered', () => {
    const origRead = process.stdin.read;
    let calls = 0;
    try {
      process.stdin.read = () => { calls++; return null; };
      flushStdin();
      assert.equal(calls, 1);
    } finally {
      process.stdin.read = origRead;
    }
  });

  it('does not throw when stdin.read is unavailable', () => {
    const origRead = process.stdin.read;
    try {
      process.stdin.read = undefined;
      assert.doesNotThrow(() => flushStdin());
    } finally {
      process.stdin.read = origRead;
    }
  });
});
