/**
 * Diagnostic script for interactive-list.mjs rendering overflow.
 *
 * Simulates render() logic with fake data (8 needs-response + 13 aging = 21 tickets)
 * and a 24x120 terminal to count output lines and check for overflow.
 */

// ─── Minimal stubs ────────────────────────────────────────────────────────────

const ESCAPE_RE = /\x1b\[[0-9;]*m|\x1b\]8;[^\x07]*\x07/g;
const visLen = (str) => str.replace(ESCAPE_RE, '').length;

function padRight(str, len) {
  const pad = Math.max(0, len - visLen(str));
  return str + ' '.repeat(pad);
}

function clipToWidth(str, maxCols) {
  if (!maxCols || visLen(str) <= maxCols) return str;
  let visible = 0;
  let i = 0;
  while (i < str.length && visible < maxCols) {
    if (str[i] === '\x1b' && str[i + 1] === '[') {
      const end = str.indexOf('m', i);
      if (end !== -1) { i = end + 1; continue; }
    }
    if (str[i] === '\x1b' && str[i + 1] === ']') {
      const end = str.indexOf('\x07', i);
      if (end !== -1) { i = end + 1; continue; }
    }
    visible++;
    i++;
  }
  return str.slice(0, i) + '\x1b[0m';
}

const COL = { flag: 1, key: 12, title: 55, status: 14, from: 14, when: 8, detail: 55 };

// ─── Fake data ─────────────────────────────────────────────────────────────────

function makeTicket(urgency, i) {
  return {
    ticketKey: `FAKE-${100 + i}`,
    summary: `Fake ticket number ${i} with a moderately long title here`,
    status: 'In Progress',
    urgency,
    lastComment: urgency === 'needs-response' ? {
      author: 'Alice',
      created: new Date(Date.now() - 3600_000).toISOString(),
      body: 'Please update the ticket with latest findings.',
    } : null,
    daysSinceUpdate: urgency === 'aging' ? 7 : null,
  };
}

const needsResponse = Array.from({ length: 8 }, (_, i) => makeTicket('needs-response', i));
const aging = Array.from({ length: 13 }, (_, i) => makeTicket('aging', 100 + i));
const items = [...needsResponse, ...aging];

// ─── Reproduce render() line-counting logic ────────────────────────────────────

const TERM_ROWS = 24;
const TERM_COLS = 120;

const lines = [];

// Title line
lines.push(`BOLD: ${items.length} tickets need attention (8 need response, 13 aging)`);
// Blank
lines.push('');
// Legend line 1 (needs-response always present)
lines.push(' [red dot] needs response');
// Legend line 2 (aging always present)
lines.push(' [yellow dot] aging');
// Blank
lines.push('');

// Column header + separator (buildHeaderLines returns 2 lines)
const hdr = `  ${padRight('', COL.flag)}   ${padRight('Ticket', COL.key)}   ${padRight('Title', COL.title)}   ${padRight('Status', COL.status)}   ${padRight('From', COL.from)}   ${padRight('When', COL.when)}   Detail`;
const sep = `  ${'\u2500'.repeat(COL.flag)}   ${'\u2500'.repeat(COL.key)}   ${'\u2500'.repeat(COL.title)}   ${'\u2500'.repeat(COL.status)}   ${'\u2500'.repeat(COL.from)}   ${'\u2500'.repeat(COL.when)}   ${'\u2500'.repeat(COL.detail)}`;
lines.push(hdr);
lines.push(sep);

const headerLines = lines.length;
const footerLines = 2;

// ─── Scroll indicator decision (same logic as render()) ───────────────────────
const scrollIndicatorLine = items.length > (TERM_ROWS - headerLines - footerLines - 1) ? 1 : 0;
const availableRows = TERM_ROWS - headerLines - footerLines - scrollIndicatorLine - 1;
const maxVisible = Math.max(1, availableRows);

console.log('');
console.log('=== Header line breakdown ===');
console.log('  title line:              1');
console.log('  blank after title:       1');
console.log('  legend line (response):  1');
console.log('  legend line (aging):     1');
console.log('  blank after legend:      1');
console.log('  col header:              1');
console.log('  separator:               1');
console.log('                          ---');
console.log(`  headerLines total:       ${headerLines}  (expected: 7)`);

console.log('');
console.log('=== Separator line Unicode check ===');
const sepRaw = '\u2500'.repeat(5);
const sepVisLen = visLen(sepRaw);
console.log(`  visLen("─────") = ${sepVisLen}  (expected: 5)`);
console.log(`  Each ─ counts as ${sepVisLen / 5} visible char(s)  (expected: 1)`);

// Check whether clipToWidth wraps the separator
const longSep = '\u2500'.repeat(130);
const clipped = clipToWidth(longSep, TERM_COLS);
const clippedLen = visLen(clipped.replace('\x1b[0m', ''));
console.log(`  clipToWidth(─x130, 120) → visLen=${clippedLen}  (expected: 120, no wrapping)`);

console.log('');
console.log('=== Available rows calculation ===');
console.log(`  termRows:             ${TERM_ROWS}`);
console.log(`  headerLines:          ${headerLines}`);
console.log(`  footerLines:          ${footerLines}`);
console.log(`  scrollIndicatorLine:  ${scrollIndicatorLine}  (1 if items.length > termRows - headerLines - footerLines - 1)`);
console.log(`    threshold check:    ${items.length} > ${TERM_ROWS - headerLines - footerLines - 1} → ${items.length > (TERM_ROWS - headerLines - footerLines - 1)}`);
console.log(`  availableRows:        ${availableRows}  (termRows - headerLines - footerLines - scrollIndicatorLine - 1)`);
console.log(`  maxVisible:           ${maxVisible}`);

// Ticket rows rendered
const visibleEnd = Math.min(0 + maxVisible, items.length);
const ticketRowsRendered = visibleEnd - 0;

lines.push(...items.slice(0, ticketRowsRendered).map((_, i) => `[row ${i}]`));

// Scroll indicator (if overflow)
if (items.length > maxVisible) {
  lines.push(`  ... 1-${visibleEnd} of ${items.length}`);
}

// Footer
lines.push('');
lines.push(' arrows navigate | Enter open | q exit');

const totalLines = lines.length;
const overflows = totalLines > TERM_ROWS;

console.log('');
console.log('=== Line count totals ===');
console.log(`  header lines:          ${headerLines}`);
console.log(`  ticket rows rendered:  ${ticketRowsRendered}  (maxVisible capped at ${maxVisible})`);
console.log(`  scroll indicator:      ${items.length > maxVisible ? 1 : 0}`);
console.log(`  footer lines:          ${footerLines}`);
console.log(`  ---------------------------`);
console.log(`  TOTAL lines:           ${totalLines}`);
console.log(`  termRows:              ${TERM_ROWS}`);
console.log(`  OVERFLOWS:             ${overflows}`);

console.log('');
console.log('=== Diagnosis ===');
if (headerLines !== 7) {
  console.log(`  BUG: headerLines = ${headerLines}, expected 7. Header count mismatch causes wrong availableRows.`);
}
if (overflows) {
  console.log(`  BUG: total output lines (${totalLines}) exceeds terminal rows (${TERM_ROWS}). Header will be pushed off screen.`);
} else {
  console.log(`  OK: output fits within terminal (${totalLines} lines <= ${TERM_ROWS} rows).`);
}
if (availableRows !== 13) {
  console.log(`  NOTE: availableRows = ${availableRows}, expected 13 based on scenario description.`);
} else {
  console.log(`  OK: availableRows = ${availableRows} as expected.`);
}

// Extra: check the off-by-one — the trailing \n after clipped.join('\n')
// render() does: clipped.join('\n') + '\n'
// That means N lines → N newlines → the terminal sees N lines of content,
// but the cursor is on line N+1. With 24-row terminal, line 24 is the last
// visible line — the cursor on line 25 would scroll the screen by 1.
const terminalNewlines = totalLines; // join('\n') gives N-1 newlines, +1 from trailing = N
console.log('');
console.log('=== Trailing newline analysis ===');
console.log(`  clipped.join('\\n') + '\\n' with ${totalLines} lines emits ${totalLines} newlines total.`);
console.log(`  In a ${TERM_ROWS}-row terminal the last visible line is row ${TERM_ROWS}.`);
console.log(`  If output fills all ${TERM_ROWS} rows AND ends with \\n, the terminal scrolls 1 line → header pushed off.`);
const trailingScrollRisk = totalLines >= TERM_ROWS;
console.log(`  Trailing scroll risk: ${trailingScrollRisk} (totalLines ${totalLines} >= termRows ${TERM_ROWS})`);

// ─── Edge case sweep: vary terminal rows ──────────────────────────────────────

console.log('');
console.log('=== Edge case: vary terminal height (21 tickets, both legend lines) ===');
console.log('  rows | hdrLines | scrollInd | availRows | ticketRows | total | overflows | trailing scroll');
console.log('  -----|----------|-----------|-----------|------------|-------|-----------|----------------');

for (const rows of [20, 21, 22, 23, 24, 25, 30, 40]) {
  const hdrCount = 7;
  const ftCount = 2;
  const scrollInd = items.length > (rows - hdrCount - ftCount - 1) ? 1 : 0;
  const avail = rows - hdrCount - ftCount - scrollInd - 1;
  const maxVis = Math.max(1, avail);
  const ticketRows = Math.min(maxVis, items.length);
  const scrollIndicatorEmitted = items.length > maxVis ? 1 : 0;
  const total = hdrCount + ticketRows + scrollIndicatorEmitted + ftCount;
  const overflows = total > rows;
  const trailingRisk = total >= rows;
  console.log(`  ${String(rows).padStart(4)} | ${String(hdrCount).padStart(8)} | ${String(scrollInd).padStart(9)} | ${String(avail).padStart(9)} | ${String(ticketRows).padStart(10)} | ${String(total).padStart(5)} | ${String(overflows).padStart(9)} | ${trailingRisk}`);
}

// ─── Check: what if only ONE legend line (e.g. all needs-response, no aging) ──

console.log('');
console.log('=== Edge case: legend line count vs headerLines ===');
console.log('  With both urgency types present (default for 8+13): headerLines = 7');
console.log('  With only needs-response or only aging: headerLines = 6');
for (const [label, nrCount, agCount] of [
  ['8 nr + 0 ag', 8, 0],
  ['0 nr + 13 ag', 0, 13],
  ['1 nr + 1 ag', 1, 1],
  ['8 nr + 13 ag', 8, 13],
]) {
  const hdrLines = 2 + (nrCount > 0 ? 1 : 0) + (agCount > 0 ? 1 : 0) + 1 + 2;
  console.log(`  [${label}] → headerLines = ${hdrLines}`);
}

// ─── Root cause check: the -1 in availableRows ───────────────────────────────

console.log('');
console.log('=== Root cause candidate: the extra -1 in availableRows ===');
console.log('  Code: availableRows = termRows - headerLines - footerLines - scrollIndicatorLine - 1');
console.log('  The trailing -1 is load-bearing — prevents trailing newline from scrolling the screen.');
{
  const rows = 24; const hdr = 7; const ft = 2; const scrollInd = 1;
  const withExtra    = rows - hdr - ft - scrollInd - 1;
  const withoutExtra = rows - hdr - ft - scrollInd;
  const totalWith    = hdr + withExtra + 1 + ft;
  const totalWithout = hdr + withoutExtra + 1 + ft;
  console.log(`  With -1:    availableRows=${withExtra}, total=${totalWith}, trailing scroll? ${totalWith >= rows}`);
  console.log(`  Without -1: availableRows=${withoutExtra}, total=${totalWithout}, trailing scroll? ${totalWithout >= rows}`);
  console.log('  Without -1: total=24 lines + trailing \\n = terminal scrolls 1 row → title pushed off top.');
}

// ─── Real bug: resize without SIGWINCH ───────────────────────────────────────

console.log('');
console.log('=== Most likely actual bug: stale process.stdout.rows on resize ===');
console.log('  render() reads process.stdout.rows at call time — no SIGWINCH listener is wired up.');
console.log('  If the user resizes the terminal to be smaller AFTER the list renders, the next');
console.log('  render() call (triggered by a keypress) will use the new smaller rows value.');
console.log('  But the FIRST render uses whatever size the terminal was at launch.');
console.log('  If the terminal was launched small (e.g. 20 rows):');
{
  for (const rows of [20, 19, 18]) {
    const hdr = 7; const ft = 2;
    const scrollInd = items.length > (rows - hdr - ft - 1) ? 1 : 0;
    const avail = rows - hdr - ft - scrollInd - 1;
    const maxVis = Math.max(1, avail);
    const ticketRows = Math.min(maxVis, items.length);
    const scrollIndicatorEmitted = items.length > maxVis ? 1 : 0;
    const total = hdr + ticketRows + scrollIndicatorEmitted + ft;
    console.log(`    rows=${rows}: total=${total}, overflows? ${total > rows}, trailing scroll? ${total >= rows}`);
  }
}

console.log('');
console.log('=== Summary ===');
console.log('  The render() line-count math is correct and self-consistent for 24-row, 21-ticket case.');
console.log('  The extra -1 in availableRows is intentional and correct: prevents trailing \\n scroll.');
console.log('  No Unicode double-width issue with ─ (box-drawing char counts as 1 visible char).');
console.log('  Separator clipToWidth works correctly (no wrapping).');
console.log('  MOST LIKELY BUG CAUSE:');
console.log('    process.stdout.rows is stale — terminal was resized before the module read it,');
console.log('    or the initial render happened before the alternate screen was fully sized.');
console.log('  SECONDARY CANDIDATE:');
console.log('    ALT_SCREEN_ON is written BEFORE render() — the terminal may not have updated');
console.log('    process.stdout.rows to reflect the alt-screen dimensions by the time render() runs.');
console.log('  FIX: call process.stdout.rows INSIDE render() on each call (already done),');
console.log('    AND wire up a SIGWINCH listener to re-render on resize.');
console.log('');
