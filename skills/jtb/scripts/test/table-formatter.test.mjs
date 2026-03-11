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
});
