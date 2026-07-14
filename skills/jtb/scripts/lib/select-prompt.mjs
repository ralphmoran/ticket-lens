/**
 * Reusable raw-mode selector primitives: single-select and multi-select.
 * Used by profile-picker.mjs, profile-switcher.mjs, init-wizard.mjs,
 * config-wizard.mjs, and wizard-pickers.mjs.
 */

import { createStyler } from './ansi.mjs';
import { flushStdin } from './prompt-helpers.mjs';

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
 * @param {NodeJS.ReadStream} [opts.stdin=process.stdin] injectable for tests
 * @param {(key: string, index: number) => 'veto'|boolean} [opts.onKey]
 *   Hook for extra keys. Called for Enter before submit — return 'veto' to
 *   swallow it and keep the selector open. For any other unhandled key,
 *   return truthy to re-render. Falsy = key ignored.
 * @returns {Promise<number|null>} selected index, or null if cancelled
 */
export function runRawSelect({ count, initialIndex = 0, renderFn, stream = process.stderr, stdin = process.stdin, onKey }) {
  if (!stream.isTTY || !stdin.setRawMode) return Promise.resolve(null);

  let selected = initialIndex;
  let lineCount = 0;

  function erase() {
    for (let i = 0; i < lineCount; i++) stream.write('\x1b[A\r\x1b[2K');
  }

  function render() {
    erase();
    lineCount = renderFn(selected);
  }

  stream.write('\x1b[?25l');
  return flushStdin(stdin).then(() => new Promise((resolve) => {
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
      if (key === '\r' || key === '\n') {
        if (onKey && onKey(key, selected) === 'veto') { render(); return; }
        cleanup(); erase(); resolve(selected); return;
      }
      if (onKey && onKey(key, selected)) { render(); return; }
    }

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    lineCount = renderFn(selected);
  }));
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
      const marker = isSelected ? s.blue('❯') : ' ';
      const label = isSelected ? s.bold(s.blue(item.label)) : item.label;
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

/**
 * Arrow-key multi-select with checkboxes and a scrolling viewport.
 * Space toggles the highlighted row, `a` toggles all, Enter confirms,
 * Esc cancels (returns null — callers treat that as "enter manually").
 *
 * @param {Array<{label: string}>} items
 * @param {object} [opts]
 * @param {number[]} [opts.initialSelected=[]] pre-checked item indices
 * @param {number} [opts.minSelected=0] Enter is vetoed below this count
 * @param {number} [opts.maxVisible=10] viewport height for long lists
 * @param {string} [opts.hint]
 * @param {NodeJS.WriteStream} [opts.stream]
 * @param {NodeJS.ReadStream} [opts.stdin] injectable for tests
 * @returns {Promise<number[]|null>} checked indices in list order, or null if cancelled
 */
export function promptMultiSelect(items, opts = {}) {
  const {
    stream = process.stderr,
    stdin = process.stdin,
    hint = '↑/↓ move   Space toggle   a all   Enter confirm   Esc manual entry',
    initialSelected = [],
    minSelected = 0,
    maxVisible = 10,
  } = opts;

  const s = createStyler({ isTTY: stream.isTTY });

  if (!stream.isTTY || !stdin.setRawMode) {
    for (const item of items) stream.write(`    ${s.cyan('›')} ${item.label}\n`);
    return Promise.resolve(null);
  }

  const checked = new Set(initialSelected.filter(i => i >= 0 && i < items.length));
  let scrollTop = 0;
  let flash = '';

  function renderFn(selected) {
    if (selected >= scrollTop + maxVisible) scrollTop = selected - maxVisible + 1;
    if (selected < scrollTop) scrollTop = selected;
    const visibleEnd = Math.min(scrollTop + maxVisible, items.length);

    const lines = [];
    for (let i = scrollTop; i < visibleEnd; i++) {
      const isSelected = i === selected;
      const marker = isSelected ? s.blue('❯') : ' ';
      const box = checked.has(i) ? s.green('◉') : s.dim('○');
      const label = isSelected ? s.bold(s.blue(items[i].label)) : items[i].label;
      lines.push(`    ${marker} ${box} ${label}`);
    }
    if (items.length > maxVisible) {
      lines.push(`      ${s.dim(`${scrollTop + 1}-${visibleEnd} of ${items.length}`)}`);
    }
    lines.push('');
    lines.push(`  ${s.dim(hint)}${flash ? '   ' + s.yellow(flash) : ''}`);
    stream.write(lines.join('\n') + '\n');
    return lines.length;
  }

  function onKey(key, selected) {
    if (key === ' ') {
      flash = '';
      if (checked.has(selected)) checked.delete(selected);
      else checked.add(selected);
      return true;
    }
    if (key === 'a' || key === 'A') {
      flash = '';
      if (checked.size === items.length) checked.clear();
      else for (let i = 0; i < items.length; i++) checked.add(i);
      return true;
    }
    if (key === '\r' || key === '\n') {
      if (checked.size < minSelected) {
        flash = `select at least ${minSelected}`;
        return 'veto';
      }
      return false;
    }
    return false;
  }

  return runRawSelect({ count: items.length, renderFn, stream, stdin, onKey })
    .then(result => (result === null ? null : [...checked].sort((a, b) => a - b)));
}
