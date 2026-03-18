/**
 * Interactive profile picker for "profile not found" errors.
 * Shows the error message, then lets the user select a profile with arrow keys.
 * Falls back to static output on non-TTY.
 */

import { createStyler } from './ansi.mjs';
import { runRawSelect } from './select-prompt.mjs';

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

  const initialIndex = suggestion ? Math.max(0, available.indexOf(suggestion)) : 0;

  function renderFn(selected) {
    const lines = [];
    for (let i = 0; i < available.length; i++) {
      const marker = i === selected ? s.cyan('❯') : ' ';
      const label = i === selected ? s.bold(s.cyan(available[i])) : available[i];
      lines.push(`    ${marker} ${label}`);
    }
    lines.push('');
    lines.push(`  ${s.dim('↑/↓ select   Enter confirm   q/Esc cancel')}`);
    stream.write(lines.join('\n') + '\n');
    return lines.length;
  }

  return runRawSelect({ count: available.length, initialIndex, renderFn, stream })
    .then(index => {
      if (index === null) return null;
      stream.write(`  ${s.green('✔')} Using profile ${s.bold(s.cyan(available[index]))}\n\n`);
      return available[index];
    });
}
