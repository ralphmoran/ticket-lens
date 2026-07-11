import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStyler } from '../lib/ansi.mjs';
import { printQuickStart } from '../lib/quick-start-panel.mjs';

function fakeStream() {
  const chunks = [];
  return { write: chunk => chunks.push(chunk), get text() { return chunks.join(''); } };
}

describe('printQuickStart', () => {
  it('renders without throwing (regression lock for the previously-undefined bc reference)', () => {
    const stream = fakeStream();
    const s = createStyler({ isTTY: false });
    assert.doesNotThrow(() => printQuickStart({ stream, s }));
  });

  it('includes all four quick-start commands', () => {
    const stream = fakeStream();
    const s = createStyler({ isTTY: false });
    printQuickStart({ stream, s });
    assert.ok(stream.text.includes('ticketlens triage'));
    assert.ok(stream.text.includes('ticketlens <TICKET-KEY>'));
    assert.ok(stream.text.includes('ticketlens switch'));
    assert.ok(stream.text.includes('ticketlens --help'));
  });

  it('renders a well-formed box on a TTY stream (border lines present)', () => {
    const stream = fakeStream();
    const s = createStyler({ isTTY: true });
    printQuickStart({ stream, s });
    assert.ok(stream.text.includes('╭'));
    assert.ok(stream.text.includes('╰'));
  });
});
