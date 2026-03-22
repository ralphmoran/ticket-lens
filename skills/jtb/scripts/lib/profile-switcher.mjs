/**
 * ticketlens switch — Titled panel profile switcher (Option B).
 * Used by `ticketlens switch` subcommand and as the final step in `ticketlens init`.
 */

import { createStyler } from './ansi.mjs';
import { fetchCurrentUser } from './jira-client.mjs';
import { classifyError } from './error-classifier.mjs';
import { loadProfiles, loadCredentials, saveDefault } from './profile-resolver.mjs';
import { runRawSelect } from './select-prompt.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const visLen = (str) => str.replace(ANSI_RE, '').length;
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Show the titled profile switcher panel and optionally test the connection on switch.
 *
 * @param {object} [opts]
 * @param {string} [opts.configDir]
 * @param {NodeJS.WriteStream} [opts.stream=process.stderr]
 * @param {boolean} [opts.testConnection=true] - false skips connection test (e.g. in init wizard)
 * @returns {Promise<string|null>} chosen profile name, or null if cancelled/failed
 */
export async function runSwitch({ configDir = DEFAULT_CONFIG_DIR, stream = process.stderr, testConnection = true } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const config = loadProfiles(configDir);

  if (!config || Object.keys(config.profiles).length === 0) {
    stream.write(`  ${s.red('✖')} No profiles configured. Run ${s.cyan('ticketlens init')} first.\n`);
    return null;
  }

  const names = Object.keys(config.profiles);
  const creds = loadCredentials(configDir);
  const currentDefault = config.default || names[0];
  const initialIndex = Math.max(0, names.indexOf(currentDefault));

  if (names.length === 1) {
    await saveDefault(names[0], configDir);
    stream.write(`  ${s.dim('Only one profile:')} ${s.bold(s.cyan(names[0]))}\n`);
    return names[0];
  }

  // Build rows: name + hostname + active badge state
  const rows = names.map(name => {
    const profile = config.profiles[name];
    let hostname = '';
    try { hostname = new URL(profile.baseUrl).hostname; } catch {}
    return { name, hostname, isActive: name === currentDefault };
  });

  // Compute box inner width to fit all rows cleanly
  const TITLE = ' Profile ';
  const contentWidth = rows.reduce((max, r) => {
    const nameRow = `  ❯ ${r.name}${r.isActive ? '  ● active' : ''}`.length + 2;
    const subRow = `    ${r.hostname}`.length + 2;
    return Math.max(max, nameRow, subRow);
  }, TITLE.length + 4);
  const innerWidth = Math.max(contentWidth, TITLE.length + 4);

  const bc = s.cyan;

  function padInner(line) {
    const pad = innerWidth - visLen(line) - 1;
    return ' ' + line + ' '.repeat(Math.max(0, pad));
  }

  // Full panel in renderFn so runRawSelect erases it cleanly on selection
  const titleFill = innerWidth - 1 - TITLE.length; // -1 for leading ─
  const topBorder = bc('╭') + bc('─') + s.bold(s.cyan(TITLE)) + bc('─'.repeat(Math.max(0, titleFill))) + bc('╮');

  function renderFn(selected) {
    const lines = [];
    lines.push(topBorder);
    lines.push(bc('│') + padInner('') + bc('│'));
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const isSelected = i === selected;
      const marker = isSelected ? s.cyan('❯') : ' ';
      const name = isSelected ? s.bold(s.cyan(row.name)) : row.name;
      const badge = row.isActive ? `  ${s.green('● active')}` : '';
      lines.push(bc('│') + padInner(`  ${marker} ${name}${badge}`) + bc('│'));
      lines.push(bc('│') + padInner(s.dim(`    ${row.hostname}`)) + bc('│'));
      lines.push(bc('│') + padInner('') + bc('│'));
    }
    lines.push(bc('╰') + bc('─'.repeat(innerWidth)) + bc('╯'));
    lines.push('');
    lines.push(`  ${s.dim('↑/↓ select   Enter switch   Esc back')}`);
    stream.write(lines.join('\n') + '\n');
    return lines.length;
  }

  const selectedIndex = await runRawSelect({ count: rows.length, initialIndex, renderFn, stream });
  if (selectedIndex === null) return null;

  const chosen = rows[selectedIndex];

  // No-op if the user selected the already-active profile
  if (chosen.name === currentDefault) {
    stream.write(`  ${s.dim('Already on')} ${s.bold(s.cyan(chosen.name))}.\n`);
    return chosen.name;
  }

  if (!testConnection) {
    await saveDefault(chosen.name, configDir);
    stream.write(`  ${s.green('✔')} Active profile set to ${s.bold(s.cyan(chosen.name))}\n`);
    return chosen.name;
  }

  // Test connection with inline spinner
  const profile = config.profiles[chosen.name];
  const profileCreds = creds[chosen.name] || {};
  const env = {
    JIRA_BASE_URL: profile.baseUrl,
    JIRA_EMAIL: profile.email || '',
    JIRA_API_TOKEN: profileCreds.apiToken || '',
    JIRA_PAT: profileCreds.pat || '',
  };
  const apiVersion = profile.auth === 'cloud' ? 3 : 2;

  let frame = 0;
  const spinLine = () => `  ${s.cyan(SPINNER_FRAMES[frame])} Connecting to ${s.bold(chosen.name)}...`;
  stream.write(spinLine() + '\n');
  const timer = setInterval(() => {
    frame = (frame + 1) % SPINNER_FRAMES.length;
    stream.write('\r\x1b[2K\x1b[A\r\x1b[2K');
    stream.write(spinLine() + '\n');
  }, 80);

  try {
    await fetchCurrentUser({ env, apiVersion });
    clearInterval(timer);
    stream.write('\r\x1b[2K\x1b[A\r\x1b[2K');
    await saveDefault(chosen.name, configDir);
    stream.write(`  ${s.green('✔')} Switched to ${s.bold(s.cyan(chosen.name))}\n`);
    return chosen.name;
  } catch (err) {
    clearInterval(timer);
    stream.write('\r\x1b[2K\x1b[A\r\x1b[2K');
    const classified = classifyError(err, { baseUrl: profile.baseUrl, profileName: chosen.name });
    stream.write(`  ${s.red('●')} Connection to ${chosen.name} failed.\n`);
    stream.write(`  ${s.dim(classified.message)}\n`);
    if (classified.hint) stream.write(`  ${s.dim(classified.hint)}\n`);
    return null;
  }
}
