/**
 * Interactive profile pickers.
 * - promptProfileSelect: "profile not found" error recovery.
 * - promptProfileMismatch: ticket prefix not configured in any profile.
 * Both fall back to static output on non-TTY.
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

/**
 * Prompts the user to choose between multiple profiles that all share the
 * same ticket prefix. Shown before the fetch attempt when ambiguity exists.
 *
 * @param {string} ticketKey   e.g. "PROJ-123"
 * @param {Array<{name:string, baseUrl:string|null}>} profiles  matching profiles
 * @param {{ stream?: NodeJS.WriteStream }} [opts]
 * @returns {Promise<string|null>}   chosen profile name, or null if cancelled
 */
export function promptMultipleMatches(ticketKey, profiles, { stream = process.stderr } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const prefix = ticketKey.split('-')[0];

  stream.write('\n');
  stream.write(`  ${s.yellow('⚡')}  ${s.bold(plural(profiles.length, 'profile'))} are configured for prefix ${s.bold(s.cyan(prefix))}.\n`);
  stream.write(`\n  ${s.dim(`Which one should handle ${ticketKey}?`)}\n\n`);

  if (!stream.isTTY || !process.stdin.setRawMode) {
    for (const p of profiles) {
      const sub = p.baseUrl ? `  ${s.dim(p.baseUrl)}` : '';
      stream.write(`    ${s.cyan('›')} ${p.name}${sub}\n`);
    }
    stream.write('\n');
    return Promise.resolve(null);
  }

  function renderFn(selected) {
    const lines = [];
    for (let i = 0; i < profiles.length; i++) {
      const p = profiles[i];
      const isSelected = i === selected;
      const marker = isSelected ? s.cyan('❯') : ' ';
      const label = isSelected ? s.bold(s.cyan(p.name)) : p.name;
      const sub = p.baseUrl ? `  ${s.dim(p.baseUrl)}` : '';
      lines.push(`    ${marker} ${label}${sub}`);
    }
    lines.push('');
    lines.push(`  ${s.dim('↑/↓ select   Enter confirm   Esc cancel')}`);
    stream.write(lines.join('\n') + '\n');
    return lines.length;
  }

  return runRawSelect({ count: profiles.length, initialIndex: 0, renderFn, stream })
    .then(index => {
      if (index === null) return null;
      const picked = profiles[index].name;
      stream.write(`  ${s.green('✔')} Using ${s.bold(s.cyan(picked))}\n\n`);
      return picked;
    });
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/**
 * Prompts the user to pick a profile when the ticket's prefix isn't
 * configured in any profile. The resolved profile is pre-selected.
 *
 * @param {string} ticketKey         e.g. "ECNT-3888"
 * @param {string} currentProfile    name of the auto-resolved profile
 * @param {Array<{name:string, baseUrl:string|null}>} profiles  all known profiles
 * @param {{ stream?: NodeJS.WriteStream }} [opts]
 * @returns {Promise<string|null>}   picked profile name, or null to keep current
 */
export function promptProfileMismatch(ticketKey, currentProfile, profiles, { stream = process.stderr } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const prefix = ticketKey.split('-')[0];

  stream.write('\n');
  stream.write(`  ${s.yellow('⚠')}  Prefix ${s.bold(s.cyan(prefix))} is not configured in any profile.\n`);
  stream.write(`  ${s.dim('Currently using:')} ${s.cyan(currentProfile)}\n`);
  stream.write(`\n  ${s.dim(`Which profile should handle ${ticketKey}?`)}\n\n`);

  if (!stream.isTTY || !process.stdin.setRawMode) {
    for (const p of profiles) {
      const sub = p.baseUrl ? `  ${s.dim(p.baseUrl)}` : '';
      stream.write(`    ${s.cyan('›')} ${p.name}${sub}\n`);
    }
    stream.write('\n');
    return Promise.resolve(null);
  }

  const initialIndex = Math.max(0, profiles.findIndex(p => p.name === currentProfile));

  function renderFn(selected) {
    const lines = [];
    for (let i = 0; i < profiles.length; i++) {
      const p = profiles[i];
      const isSelected = i === selected;
      const marker = isSelected ? s.cyan('❯') : ' ';
      const label = isSelected ? s.bold(s.cyan(p.name)) : p.name;
      const sub = p.baseUrl ? `  ${s.dim(p.baseUrl)}` : '';
      lines.push(`    ${marker} ${label}${sub}`);
    }
    lines.push('');
    lines.push(`  ${s.dim('↑/↓ select   Enter confirm   Esc keep current')}`);
    stream.write(lines.join('\n') + '\n');
    return lines.length;
  }

  return runRawSelect({ count: profiles.length, initialIndex, renderFn, stream })
    .then(index => {
      if (index === null) return null;
      const picked = profiles[index].name;
      if (picked === currentProfile) {
        stream.write(`  ${s.dim(`Continuing with ${s.cyan(picked)}`)}\n\n`);
      } else {
        stream.write(`  ${s.green('✔')} Using ${s.bold(s.cyan(picked))} for this fetch\n\n`);
      }
      return picked;
    });
}

/**
 * Simple profile selector for the connection-retry flow.
 * No prefix-warning header — just "switch to which profile?".
 *
 * @param {string} currentProfile
 * @param {Array<{name:string, baseUrl:string|null}>} profiles
 * @param {{ stream?: NodeJS.WriteStream }} [opts]
 * @returns {Promise<string|null>}
 */
export function promptSwitchProfile(currentProfile, profiles, { stream = process.stderr } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });

  stream.write(`\n  ${s.dim('Switch to which profile?')}\n\n`);

  if (!stream.isTTY || !process.stdin.setRawMode) {
    for (const p of profiles) {
      const sub = p.baseUrl ? `  ${s.dim(p.baseUrl)}` : '';
      stream.write(`    ${s.cyan('›')} ${p.name}${sub}\n`);
    }
    stream.write('\n');
    return Promise.resolve(null);
  }

  const initialIndex = Math.max(0, profiles.findIndex(p => p.name === currentProfile));

  function renderFn(selected) {
    const lines = [];
    for (let i = 0; i < profiles.length; i++) {
      const p = profiles[i];
      const isSelected = i === selected;
      const marker = isSelected ? s.cyan('❯') : ' ';
      const label = isSelected ? s.bold(s.cyan(p.name)) : p.name;
      const sub = p.baseUrl ? `  ${s.dim(p.baseUrl)}` : '';
      lines.push(`    ${marker} ${label}${sub}`);
    }
    lines.push('');
    lines.push(`  ${s.dim('↑/↓ select   Enter confirm   Esc cancel')}`);
    stream.write(lines.join('\n') + '\n');
    return lines.length;
  }

  return runRawSelect({ count: profiles.length, initialIndex, renderFn, stream })
    .then(index => {
      if (index === null) return null;
      const picked = profiles[index].name;
      stream.write(`  ${s.green('✔')} Switching to ${s.bold(s.cyan(picked))}\n\n`);
      return picked;
    });
}
