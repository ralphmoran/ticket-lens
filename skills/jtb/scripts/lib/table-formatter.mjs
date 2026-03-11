/**
 * Plain-text table formatter for terminal output.
 * Uses box-drawing characters for clean rendering without a markdown parser.
 */

export function formatTable(headers, rows, opts = {}) {
  const { maxWidths = {} } = opts;

  // Apply truncation
  const truncate = (str, max) => {
    if (!max || str.length <= max) return str;
    return str.slice(0, max - 3) + '...';
  };

  const processedRows = rows.map(row =>
    row.map((cell, i) => truncate(String(cell ?? ''), maxWidths[i]))
  );
  const processedHeaders = headers.map((h, i) => truncate(String(h), maxWidths[i]));

  // Calculate column widths
  const colWidths = processedHeaders.map((h, i) => {
    const cellMax = processedRows.reduce((max, row) => Math.max(max, (row[i] || '').length), 0);
    return Math.max(h.length, cellMax);
  });

  const pad = (str, width) => str + ' '.repeat(Math.max(0, width - str.length));
  const formatRow = (cells) => '  ' + cells.map((c, i) => pad(String(c || ''), colWidths[i])).join('   ');

  const lines = [];
  lines.push(formatRow(processedHeaders));
  lines.push('  ' + colWidths.map(w => '─'.repeat(w)).join('   '));

  for (const row of processedRows) {
    lines.push(formatRow(row));
  }

  return lines.join('\n');
}
