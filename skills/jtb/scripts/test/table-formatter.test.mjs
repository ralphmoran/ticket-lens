import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatTable } from '../lib/table-formatter.mjs';

describe('formatTable', () => {
  it('pads columns to equal width', () => {
    const result = formatTable(
      ['Name', 'Age'],
      [['Alice', '30'], ['Bob', '7']],
    );
    const lines = result.split('\n');
    // All data lines should have same length
    assert.equal(lines[0].length, lines[2].length);
    assert.equal(lines[2].length, lines[3].length);
  });

  it('renders header separator line', () => {
    const result = formatTable(
      ['A', 'B'],
      [['x', 'y']],
    );
    const lines = result.split('\n');
    // Second line is separator (dashes)
    assert.ok(lines[1].includes('─'), 'Separator should use box-drawing chars');
  });

  it('handles empty rows', () => {
    const result = formatTable(['Col'], []);
    const lines = result.split('\n').filter(Boolean);
    assert.equal(lines.length, 2); // header + separator only
  });

  it('truncates long values to maxWidth', () => {
    const longVal = 'A'.repeat(100);
    const result = formatTable(
      ['Val'],
      [[longVal]],
      { maxWidths: { 0: 20 } },
    );
    assert.ok(!result.includes('A'.repeat(100)), 'Should not contain full string');
    assert.ok(result.includes('...'), 'Should truncate with ellipsis');
  });

  it('aligns multi-row table correctly', () => {
    const result = formatTable(
      ['#', 'Ticket', 'Summary'],
      [['1', 'PROJ-1', 'Short'], ['10', 'PROJ-200', 'Longer summary here']],
    );
    const lines = result.split('\n').filter(Boolean);
    // Row lines should all be same length
    assert.equal(lines[0].length, lines[2].length);
    assert.equal(lines[2].length, lines[3].length);
  });

  it('aligns columns correctly when a cell contains ANSI escape sequences', () => {
    // Simulate a styled flag cell like s.red('[NEEDS RESPONSE]')
    const styledFlag = '\x1b[31m[NEEDS RESPONSE]\x1b[39m'; // 16 visible chars + 10 invisible
    const result = formatTable(
      ['#', 'Flag', 'Ticket'],
      [
        ['1', styledFlag, 'ASAP-2745'],
        ['2', '[AGING]',  'ASAP-2800'],
      ],
    );
    const lines = result.split('\n');
    // Strip ANSI from all lines before measuring — every non-separator row must be same visible length
    const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    const visLens = lines.map(l => stripAnsi(l).length);
    // Header and both data rows must have the same visible width
    assert.equal(visLens[0], visLens[2], 'Header and first data row should have equal visible width');
    assert.equal(visLens[2], visLens[3], 'Both data rows should have equal visible width');
  });

  it('does not truncate ANSI-styled cells based on raw length', () => {
    // A styled cell whose raw length exceeds maxWidth but visible length does not
    const styledShort = '\x1b[31m[NR]\x1b[39m'; // 4 visible chars, 14 raw chars
    const result = formatTable(
      ['Flag'],
      [[styledShort]],
      { maxWidths: { 0: 10 } }, // visible 4 < max 10, should NOT truncate
    );
    // The styled content should survive intact (not end with '...')
    assert.ok(!result.includes('...'), 'Should not truncate a cell whose visible length is within maxWidth');
    assert.ok(result.includes('[NR]'), 'Styled cell content should be present');
  });
});
