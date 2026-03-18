import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import { promptSelect, runRawSelect } from '../lib/select-prompt.mjs';

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
