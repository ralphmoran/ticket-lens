import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSpinner } from '../lib/spinner.mjs';

/** Fake writable stream that captures output. */
function fakeStream({ isTTY = true } = {}) {
  const chunks = [];
  return {
    isTTY,
    write(data) { chunks.push(data); return true; },
    chunks,
    output() { return chunks.join(''); },
  };
}

describe('createSpinner', () => {
  it('writes spinner frames to a TTY stream', async () => {
    const stream = fakeStream({ isTTY: true });
    const spinner = createSpinner('Loading…', { stream });
    spinner.start();
    // Let a few frames render
    await new Promise(r => setTimeout(r, 200));
    spinner.stop();
    const out = stream.output();
    assert.ok(out.includes('Loading…'), 'Should include the message');
    assert.ok(out.includes('⠋') || out.includes('⠙'), 'Should include spinner frames');
  });

  it('hides and restores cursor on TTY', async () => {
    const stream = fakeStream({ isTTY: true });
    const spinner = createSpinner('Test', { stream });
    spinner.start();
    await new Promise(r => setTimeout(r, 100));
    spinner.stop();
    const out = stream.output();
    assert.ok(out.includes('\x1b[?25l'), 'Should hide cursor on start');
    assert.ok(out.includes('\x1b[?25h'), 'Should restore cursor on stop');
  });

  it('does not write anything when stream is not a TTY', async () => {
    const stream = fakeStream({ isTTY: false });
    const spinner = createSpinner('Loading…', { stream });
    spinner.start();
    await new Promise(r => setTimeout(r, 100));
    spinner.stop();
    assert.equal(stream.chunks.length, 0, 'Should produce no output on non-TTY');
  });

  it('stop() is safe to call multiple times', () => {
    const stream = fakeStream({ isTTY: true });
    const spinner = createSpinner('Test', { stream });
    spinner.start();
    spinner.stop();
    spinner.stop(); // should not throw
  });

  it('stop() with finalMessage writes it to TTY', () => {
    const stream = fakeStream({ isTTY: true });
    const spinner = createSpinner('Test', { stream });
    spinner.start();
    spinner.stop('Done!');
    const out = stream.output();
    assert.ok(out.includes('Done!'), 'Should include final message');
  });

  it('stop() with finalMessage does not write on non-TTY', () => {
    const stream = fakeStream({ isTTY: false });
    const spinner = createSpinner('Test', { stream });
    spinner.start();
    spinner.stop('Done!');
    assert.equal(stream.chunks.length, 0);
  });

  it('update() changes the displayed message', async () => {
    const stream = fakeStream({ isTTY: true });
    const spinner = createSpinner('First', { stream });
    spinner.start();
    await new Promise(r => setTimeout(r, 100));
    spinner.update('Second');
    await new Promise(r => setTimeout(r, 100));
    spinner.stop();
    const out = stream.output();
    assert.ok(out.includes('First'), 'Should include initial message');
    assert.ok(out.includes('Second'), 'Should include updated message');
  });
});
