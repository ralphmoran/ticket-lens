/**
 * Interactive profile picker for "profile not found" errors.
 * Shows the error message, then lets the user select a profile with arrow keys.
 * Falls back to static output on non-TTY.
 */

import { createStyler } from './ansi.mjs';

export function promptProfileSelect({ profileName, suggestion, available }, { stream = process.stderr } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const isTTY = stream.isTTY;

  // Static header (written once)
  stream.write('\n');
  stream.write(`  ${s.red('✖')} Profile ${s.bold(`"${profileName}"`)} not found.\n`);
  if (suggestion) {
    stream.write(`\n  ${s.dim('Did you mean?')}  ${s.cyan(suggestion)}\n`);
  }
  stream.write(`\n  ${s.dim('Select a profile:')}\n\n`);

  // Non-TTY: just list profiles and exit
  if (!isTTY || !process.stdin.setRawMode) {
    for (const name of available) {
      stream.write(`    ${s.cyan('›')} ${name}\n`);
    }
    stream.write('\n');
    return Promise.resolve(null);
  }

  // Interactive mode
  let selected = suggestion ? available.indexOf(suggestion) : 0;
  if (selected < 0) selected = 0;
  let dynamicLines = 0;

  function renderList() {
    // Erase previous dynamic lines
    for (let i = 0; i < dynamicLines; i++) {
      stream.write('\x1b[A\r\x1b[2K');
    }

    const lines = [];
    for (let i = 0; i < available.length; i++) {
      const marker = i === selected ? s.cyan('❯') : ' ';
      const label = i === selected ? s.bold(s.cyan(available[i])) : available[i];
      lines.push(`    ${marker} ${label}`);
    }
    lines.push('');
    lines.push(`  ${s.dim('↑/↓ select   Enter confirm   q/Esc cancel')}`);

    stream.write(lines.join('\n') + '\n');
    dynamicLines = lines.length;
  }

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;

    function cleanup() {
      stream.write('\x1b[?25h'); // show cursor
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
      stdin.removeListener('data', onData);
    }

    function onData(data) {
      const key = data.toString();

      if (key === '\x03' || key === '\x1b' || key === 'q' || key === 'Q') {
        cleanup();
        resolve(null);
        return;
      }

      if (key === '\x1b[A') { // Up
        if (selected > 0) { selected--; renderList(); }
        return;
      }

      if (key === '\x1b[B') { // Down
        if (selected < available.length - 1) { selected++; renderList(); }
        return;
      }

      if (key === '\r' || key === '\n') { // Enter
        cleanup();
        // Overwrite the list with the confirmed selection
        for (let i = 0; i < dynamicLines; i++) {
          stream.write('\x1b[A\r\x1b[2K');
        }
        stream.write(`  ${s.green('✔')} Using profile ${s.bold(s.cyan(available[selected]))}\n\n`);
        resolve(available[selected]);
        return;
      }
    }

    stream.write('\x1b[?25l'); // hide cursor
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    stdin.on('data', onData);

    renderList();
  });
}
