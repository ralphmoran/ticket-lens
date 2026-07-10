import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderWordmark } from '../lib/wordmark.mjs';
import { getVersion } from '../lib/config.mjs';
import { stripAnsi } from '../lib/ansi.mjs';

function makeStream({ isTTY, columns } = {}) {
  return { isTTY, columns };
}

describe('renderWordmark', () => {
  it('TTY + wide terminal: renders the block-letter art plus metadata line', () => {
    const output = renderWordmark({ stream: makeStream({ isTTY: true, columns: 120 }) });
    const plain = stripAnsi(output);

    assert.ok(plain.includes('████████'), 'must include the block-art wordmark');
    assert.ok(plain.includes(`v${getVersion()}`), 'must include the current version');
    assert.ok(plain.includes('github.com/ralphmoran/ticket-lens'), 'must include the GitHub URL');
    assert.ok(plain.includes('npmjs.com/package/ticketlens'), 'must include the npm URL');
    assert.ok(plain.includes('ticketlens.app'), 'must include the website domain');
    assert.ok(plain.includes('Ralph Moran'), 'must include the author');
    assert.ok(plain.includes('Stop tab-switching. Start building.'), 'must include the tagline');
  });

  it('non-TTY fallback also includes the tagline', () => {
    const output = renderWordmark({ stream: makeStream({ isTTY: false }) });
    assert.ok(output.includes('Stop tab-switching. Start building.'));
  });

  it('TTY + wide terminal: each fact is on its own labeled line', () => {
    const output = renderWordmark({ stream: makeStream({ isTTY: true, columns: 120 }) });
    const plain = stripAnsi(output);

    assert.match(plain, new RegExp(`Version:\\s+v${getVersion()}`));
    assert.match(plain, /GitHub:\s+github\.com\/ralphmoran\/ticket-lens/);
    assert.match(plain, /npm:\s+npmjs\.com\/package\/ticketlens/);
    assert.match(plain, /Website:\s+ticketlens\.app/);
    assert.match(plain, /Author:\s+Ralph Moran/);
  });

  it('TTY + wide terminal: has a blank line above the block art', () => {
    const output = renderWordmark({ stream: makeStream({ isTTY: true, columns: 120 }) });
    const plain = stripAnsi(output);
    const firstArtLineIdx = plain.split('\n').findIndex((l) => l.includes('████████'));
    assert.ok(firstArtLineIdx > 0, 'block art must not be the first line');
    assert.equal(plain.split('\n')[firstArtLineIdx - 1], '', 'line immediately above the art must be blank');
  });

  it('TTY + wide terminal: every line stays within 80 visible columns', () => {
    const output = renderWordmark({ stream: makeStream({ isTTY: true, columns: 120 }) });
    const plain = stripAnsi(output);
    for (const line of plain.split('\n')) {
      assert.ok(line.length <= 80, `Line exceeds 80 cols (${line.length}): "${line}"`);
    }
  });

  it('non-TTY: falls back to a single plain line with the same facts', () => {
    const output = renderWordmark({ stream: makeStream({ isTTY: false }) });
    assert.equal(output.split('\n').filter(Boolean).length, 1, 'non-TTY output must be a single line');
    assert.ok(output.includes(`TicketLens v${getVersion()}`));
    assert.ok(output.includes('github.com/ralphmoran/ticket-lens'));
    assert.ok(output.includes('npmjs.com/package/ticketlens'));
    assert.ok(output.includes('ticketlens.app'));
    assert.ok(output.includes('Ralph Moran'));
  });

  it('TTY but narrow terminal (<79 cols): falls back to the plain one-liner', () => {
    const output = renderWordmark({ stream: makeStream({ isTTY: true, columns: 60 }) });
    assert.equal(output.split('\n').filter(Boolean).length, 1, 'narrow TTY must use the plain fallback');
    assert.ok(output.includes(`TicketLens v${getVersion()}`));
  });

  it('respects NO_COLOR: content unchanged but no ANSI escape codes', () => {
    const original = process.env.NO_COLOR;
    process.env.NO_COLOR = '1';
    try {
      const output = renderWordmark({ stream: makeStream({ isTTY: true, columns: 120 }) });
      assert.equal(output, stripAnsi(output), 'NO_COLOR=1 must produce zero ANSI escape codes');
      assert.ok(output.includes('████████'), 'content must still be present without color');
    } finally {
      if (original === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = original;
    }
  });
});
