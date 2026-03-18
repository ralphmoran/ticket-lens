/**
 * Reusable raw-mode selector primitive and simple promptSelect helper.
 * Used by profile-picker.mjs, profile-switcher.mjs, and init-wizard.mjs.
 */

import { createStyler } from './ansi.mjs';

/**
 * Low-level raw-mode selector. Handles stdin lifecycle, arrow keys, Enter/Esc.
 * Calls renderFn(selectedIndex) on each state change; renderFn must write its
 * output to the stream and return the number of lines written.
 *
 * @param {object} opts
 * @param {number} opts.count
 * @param {number} [opts.initialIndex=0]
 * @param {(index: number) => number} opts.renderFn
 * @param {NodeJS.WriteStream} [opts.stream=process.stderr]
 * @returns {Promise<number|null>} selected index, or null if cancelled
 */
export function runRawSelect({ count, initialIndex = 0, renderFn, stream = process.stderr }) {
  if (!stream.isTTY || !process.stdin.setRawMode) return Promise.resolve(null);

  let selected = initialIndex;
  let lineCount = 0;

  function erase() {
    for (let i = 0; i < lineCount; i++) stream.write('\x1b[A\r\x1b[2K');
  }

  function render() {
    erase();
    lineCount = renderFn(selected);
  }

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    function cleanup() {
      stream.write('\x1b[?25h');
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener('data', onData);
    }

    function onData(buf) {
      const key = buf.toString();
      if (key === '\x03' || key === '\x1b' || key === 'q' || key === 'Q') {
        cleanup(); erase(); resolve(null); return;
      }
      if (key === '\x1b[A' && selected > 0) { selected--; render(); return; }
      if (key === '\x1b[B' && selected < count - 1) { selected++; render(); return; }
      if (key === '\r' || key === '\n') { cleanup(); erase(); resolve(selected); return; }
    }

    stream.write('\x1b[?25l');
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    lineCount = renderFn(selected);
  });
}

/**
 * Simple arrow-key list selector with ❯ marker and optional sublabels.
 *
 * @param {Array<{label: string, sublabel?: string}>} items
 * @param {object} [opts]
 * @param {number} [opts.initialIndex=0]
 * @param {string} [opts.hint]
 * @param {NodeJS.WriteStream} [opts.stream]
 * @returns {Promise<number|null>}
 */
export function promptSelect(items, opts = {}) {
  const {
    stream = process.stderr,
    hint = '↑/↓ select   Enter confirm   Esc cancel',
    initialIndex = 0,
  } = opts;

  const s = createStyler({ isTTY: stream.isTTY });

  if (!stream.isTTY || !process.stdin.setRawMode) {
    for (const item of items) stream.write(`    ${s.cyan('›')} ${item.label}\n`);
    return Promise.resolve(null);
  }

  function renderFn(selected) {
    const lines = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const isSelected = i === selected;
      const marker = isSelected ? s.cyan('❯') : ' ';
      const label = isSelected ? s.bold(s.cyan(item.label)) : item.label;
      lines.push(`    ${marker} ${label}`);
      if (item.sublabel) lines.push(`      ${s.dim(item.sublabel)}`);
    }
    lines.push('');
    lines.push(`  ${s.dim(hint)}`);
    stream.write(lines.join('\n') + '\n');
    return lines.length;
  }

  return runRawSelect({ count: items.length, initialIndex, renderFn, stream });
}
