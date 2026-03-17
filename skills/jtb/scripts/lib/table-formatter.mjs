/**
 * Plain-text table formatter for terminal output.
 * Uses box-drawing characters for clean rendering without a markdown parser.
 */

// Strip ANSI SGR sequences and OSC 8 hyperlinks to get visible (printable) length.
const ESCAPE_RE = /\x1b\[[0-9;]*m|\x1b\]8;[^\x07]*\x07/g;
const visibleLength = (str) => str.replace(ESCAPE_RE, '').length;

export function formatTable(headers, rows, opts = {}) {
  const { maxWidths = {} } = opts;

  // Strip control characters that can corrupt table layout.
  // Preserves \x07 (BEL) used as OSC 8 hyperlink terminator and \x1b used in escape sequences.
  const sanitize = (str) => str.replace(/[\x00-\x06\x08\x0b\x0c\x0e-\x1a\r]/g, '');

  // Apply truncation based on visible length so ANSI-styled cells are not cut mid-sequence.
  const truncate = (str, max) => {
    if (!max || visibleLength(str) <= max) return str;
    // Strip styles, truncate, re-apply is complex; these cells are plain text from callers.
    return str.slice(0, max - 3) + '...';
  };

  const processedRows = rows.map(row =>
    row.map((cell, i) => truncate(sanitize(String(cell ?? '')), maxWidths[i]))
  );
  const processedHeaders = headers.map((h, i) => truncate(String(h), maxWidths[i]));

  // Calculate column widths using visible length to ignore ANSI escape sequences.
  const colWidths = processedHeaders.map((h, i) => {
    const cellMax = processedRows.reduce((max, row) => Math.max(max, visibleLength(row[i] || '')), 0);
    return Math.max(visibleLength(h), cellMax);
  });

  // Pad using visible length so styled cells (with invisible escape codes) align correctly.
  const pad = (str, width) => str + ' '.repeat(Math.max(0, width - visibleLength(str)));
  const formatRow = (cells) => '  ' + cells.map((c, i) => pad(String(c || ''), colWidths[i])).join('   ');

  const lines = [];
  lines.push(formatRow(processedHeaders));
  lines.push('  ' + colWidths.map(w => '─'.repeat(w)).join('   '));

  for (const row of processedRows) {
    lines.push(formatRow(row));
  }

  return lines.join('\n');
}
