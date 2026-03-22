import { createStyler } from './ansi.mjs';
import { spawn } from 'node:child_process';
import { runSwitch } from './profile-switcher.mjs';
import { timeAgo, truncate } from './config.mjs';

const ESCAPE_RE = /\x1b\[[0-9;]*m|\x1b\]8;[^\x07]*\x07/g;
const visLen = (str) => str.replace(ESCAPE_RE, '').length;

function padRight(str, len) {
  const pad = Math.max(0, len - visLen(str));
  return str + ' '.repeat(pad);
}

/** Truncate a string to maxCols visible characters, preserving ANSI sequences. */
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

export function runInteractiveList(tickets, opts = {}) {
  const { baseUrl, staleDays = 5, styled = true } = opts;
  const browseUrl = baseUrl ? baseUrl.replace(/\/$/, '') + '/browse/' : null;
  const s = createStyler({ forceColor: styled, noColor: !styled });

  const actionable = tickets.filter(t => t.urgency !== 'clear');
  if (actionable.length === 0) {
    process.stdout.write(s.green('All clear — no tickets need your attention right now.') + '\n');
    return Promise.resolve();
  }

  const needsResponse = actionable.filter(t => t.urgency === 'needs-response');
  const aging = actionable.filter(t => t.urgency === 'aging');
  const items = [...needsResponse, ...aging];

  let selectedIndex = 0;
  let scrollTop = 0;
  let dynamicLineCount = 0; // track how many lines the dynamic section used last render

  const COL = { flag: 1, key: 12, title: 55, status: 14, from: 14, when: 8, detail: 55 };

  function buildRow(ticket, index) {
    const isSelected = index === selectedIndex;
    const isNeedsResponse = ticket.urgency === 'needs-response';

    const dot = isNeedsResponse ? s.red('\u25cf') : s.yellow('\u25cf');
    const key = padRight(ticket.ticketKey, COL.key);
    const title = padRight(truncate(ticket.summary, COL.title), COL.title);
    const status = padRight(ticket.status, COL.status);

    let from, when, detail;
    if (isNeedsResponse) {
      from = padRight(ticket.lastComment?.author ?? 'Unknown', COL.from);
      when = padRight(ticket.lastComment ? timeAgo(ticket.lastComment.created) : '', COL.when);
      detail = ticket.lastComment?.body ? s.dim(truncate(ticket.lastComment.body, COL.detail)) : '';
    } else {
      const days = ticket.daysSinceUpdate ?? '?';
      from = padRight('', COL.from);
      when = padRight('', COL.when);
      detail = s.dim(`${days}d stale`);
    }

    const line = `  ${dot}   ${key}   ${title}   ${status}   ${from}   ${when}   ${detail}`;

    if (isSelected) {
      return `\x1b[7m${line}\x1b[27m`;
    }
    return line;
  }

  function writeHeader() {
    const lines = [];

    // Title
    const countParts = [];
    if (needsResponse.length > 0) countParts.push(`${needsResponse.length} need response`);
    if (aging.length > 0) countParts.push(`${aging.length} aging`);
    lines.push(s.bold(` ${items.length} tickets need attention`) + ` (${countParts.join(', ')})`);
    lines.push('');

    // Legend
    if (needsResponse.length > 0) lines.push(` ${s.red('\u25cf')} needs response`);
    if (aging.length > 0) lines.push(` ${s.yellow('\u25cf')} aging`);
    lines.push('');

    // Column headers + separator
    const hdr = `  ${padRight('', COL.flag)}   ${padRight('Ticket', COL.key)}   ${padRight('Title', COL.title)}   ${padRight('Status', COL.status)}   ${padRight('From', COL.from)}   ${padRight('When', COL.when)}   Detail`;
    const sep = `  ${'\u2500'.repeat(COL.flag)}   ${'\u2500'.repeat(COL.key)}   ${'\u2500'.repeat(COL.title)}   ${'\u2500'.repeat(COL.status)}   ${'\u2500'.repeat(COL.from)}   ${'\u2500'.repeat(COL.when)}   ${'\u2500'.repeat(COL.detail)}`;
    lines.push(s.dim(hdr));
    lines.push(s.dim(sep));

    const cols = process.stdout.columns || 120;
    process.stderr.write(lines.map(l => clipToWidth(l, cols)).join('\n') + '\n');
  }

  function renderDynamic() {
    const cols = process.stdout.columns || 120;
    const termRows = process.stdout.rows || 24;

    // Erase previous dynamic lines by moving up and clearing each line
    if (dynamicLineCount > 0) {
      // Move up dynamicLineCount lines, clearing each
      for (let i = 0; i < dynamicLineCount; i++) {
        process.stderr.write('\x1b[A'); // move up
      }
      // Now at the top of the dynamic section — erase from here down
      for (let i = 0; i < dynamicLineCount; i++) {
        process.stderr.write('\r\x1b[2K'); // erase line
        if (i < dynamicLineCount - 1) process.stderr.write('\x1b[B'); // move down
      }
      // Move back up to the start of the dynamic section
      for (let i = 0; i < dynamicLineCount - 1; i++) {
        process.stderr.write('\x1b[A');
      }
      process.stderr.write('\r');
    }

    // Build dynamic lines: data rows + scroll indicator + footer
    const lines = [];

    // Header section uses ~8-9 lines, but we don't need to know exactly —
    // we control how many data rows to show based on available space.
    // Use a conservative fixed header height estimate.
    const headerHeight = 8; // title + blank + legend1 + legend2 + blank + colhdr + sep + (written above)
    const footerHeight = 2; // blank + keybind hint
    const maxDataRows = Math.max(1, termRows - headerHeight - footerHeight - 1);

    const maxVisible = Math.min(maxDataRows, items.length);
    if (selectedIndex >= scrollTop + maxVisible) scrollTop = selectedIndex - maxVisible + 1;
    if (selectedIndex < scrollTop) scrollTop = selectedIndex;

    const visibleEnd = Math.min(scrollTop + maxVisible, items.length);
    for (let i = scrollTop; i < visibleEnd; i++) {
      lines.push(buildRow(items[i], i));
    }

    // Scroll indicator
    if (items.length > maxVisible) {
      const pos = `${scrollTop + 1}-${visibleEnd} of ${items.length}`;
      lines.push(s.dim(`  ... ${pos}`));
    }

    // Footer
    lines.push('');
    lines.push(s.dim(' \u2191/\u2193 navigate   Enter open in browser   p switch profile   q/Esc exit'));

    const clipped = lines.map(l => clipToWidth(l, cols));
    process.stderr.write(clipped.join('\n') + '\n');
    dynamicLineCount = clipped.length;
  }

  function openInBrowser(ticketKey) {
    if (!browseUrl) return;
    const url = browseUrl + ticketKey;
    try {
      const cmd = process.platform === 'darwin' ? 'open'
        : process.platform === 'win32' ? 'cmd'
        : 'xdg-open';
      const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.unref();
    } catch {
      // Silently ignore if open fails
    }
  }

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    function cleanup() {
      process.removeListener('SIGWINCH', onResize);
      process.stderr.write('\x1b[?25h'); // show cursor
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener('data', onData);
    }

    function exit() {
      cleanup();
      resolve();
    }

    function onData(data) {
      const key = data.toString();

      if (key === '\x03') { exit(); return; } // Ctrl+C
      if (key === 'q' || key === 'Q') { exit(); return; }
      if (key === '\x1b') { exit(); return; } // Escape

      if (key === '\x1b[A') { // Up
        if (selectedIndex > 0) { selectedIndex--; renderDynamic(); }
        return;
      }
      if (key === '\x1b[B') { // Down
        if (selectedIndex < items.length - 1) { selectedIndex++; renderDynamic(); }
        return;
      }
      if (key === '\r' || key === '\n') { // Enter
        openInBrowser(items[selectedIndex].ticketKey);
        return;
      }
      if (key === 'p' || key === 'P') { // Switch profile
        cleanup();
        runSwitch().then(switched => resolve(switched ? 'switch' : undefined));
        return;
      }
    }

    function onResize() { renderDynamic(); }

    // Hide cursor, write static header once, then render dynamic rows
    process.stderr.write('\x1b[?25l');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    process.on('SIGWINCH', onResize);

    writeHeader();
    renderDynamic();
  });
}
