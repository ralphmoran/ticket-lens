/**
 * Onboarding hub — banner + interactive menu composing the existing setup
 * wizards behind one entry point. buildMenuItems() is pure and exported
 * separately from the run() loop so it's unit-testable without a TTY (same
 * separation help.mjs/banner.mjs tests already rely on).
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStyler } from './ansi.mjs';
import { renderWordmark } from './wordmark.mjs';
import { printQuickStart } from './quick-start-panel.mjs';
import { promptSelect } from './select-prompt.mjs';
import { promptYN } from './prompt-helpers.mjs';
import { detectSetupState } from './setup-state.mjs';
import { checkAliasStatus } from './alias-status.mjs';
import { loadProfiles } from './profile-resolver.mjs';
import { run as runInit } from './init-wizard.mjs';
import { run as runConfig } from './config-wizard.mjs';
import { runSwitch } from './profile-switcher.mjs';
import { runLogin } from './login-flow.mjs';
import { syncProfiles } from './sync.mjs';
import { testConnections } from './connection-tester.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Same computation postinstall.mjs uses for its own OWN_BIN — 4 levels up
// from lib/ to the package root, then into bin/.
const SELF_BIN_PATH = join(__dirname, '..', '..', '..', '..', 'bin', 'ticketlens.mjs');

/**
 * @param {object} opts
 * @param {object} opts.state - detectSetupState() result
 * @param {object} opts.profiles - config.profiles (raw, for ticket-prefix data detectSetupState doesn't carry)
 * @param {{status: 'active'|'shadowed'|'missing', foreignPath?: string}} opts.aliasStatus - checkAliasStatus() result
 */
export function buildMenuItems({ state, profiles, aliasStatus }) {
  const profileNames = Object.keys(profiles || {});

  const trackerConnection = {
    key: 'tracker-connection',
    marker: state.profileCount > 0 ? '✔' : '○',
    label: 'Tracker connection',
    sublabel: state.profileCount > 0
      ? `${state.profileCount} profile${state.profileCount === 1 ? '' : 's'} configured`
      : 'not configured yet',
  };

  const credentialsComplete = state.profileCount > 0 && state.missingCredentials.length === 0;
  const credentials = {
    key: 'credentials',
    marker: credentialsComplete ? '✔' : '○',
    label: 'Credentials',
    sublabel: state.profileCount === 0
      ? 'no profiles yet'
      : state.missingCredentials.length > 0
        ? `${state.missingCredentials.length} profile${state.missingCredentials.length === 1 ? '' : 's'} need${state.missingCredentials.length === 1 ? 's' : ''} a token`
        : 'all profiles have credentials',
  };

  const testConnectionsItem = {
    key: 'test-connections',
    marker: '○',
    label: 'Test connections',
    sublabel: 'verify every profile',
  };

  const allPrefixes = [...new Set(profileNames.flatMap(name => profiles[name].ticketPrefixes || []))];
  const ticketPrefixes = {
    key: 'ticket-prefixes',
    marker: allPrefixes.length > 0 ? '✔' : '○',
    label: 'Ticket prefixes',
    sublabel: allPrefixes.length > 0 ? allPrefixes.join(', ') : 'not set',
  };

  const consoleLogin = {
    key: 'console-login',
    marker: state.loggedIn ? '✔' : '○',
    label: 'Console login (optional)',
    sublabel: 'sync profiles across machines',
    optional: true,
  };

  const exit = {
    key: 'exit',
    label: 'Exit',
    sublabel: 'you can rerun this any time: ticketlens config',
  };

  const tallyItems = [trackerConnection, credentials, ticketPrefixes, consoleLogin];
  const completedCount = tallyItems.filter(i => i.marker === '✔').length;
  const totalCount = tallyItems.length;

  const aliasWarning = aliasStatus?.status === 'shadowed' ? aliasStatus.foreignPath : null;

  return {
    items: [trackerConnection, credentials, testConnectionsItem, ticketPrefixes, consoleLogin, exit],
    completedCount,
    totalCount,
    aliasWarning,
  };
}

export async function run({ configDir = DEFAULT_CONFIG_DIR, stream = process.stderr } = {}) {
  // Same SIGINT hygiene as init-wizard.mjs:59-71 — restore cursor, exit raw mode.
  function onSigint() {
    stream.write('\x1b[?25h');
    if (process.stdin.isRaw) process.stdin.setRawMode(false);
    stream.write('\n');
    process.exit(130);
  }
  process.on('SIGINT', onSigint);

  try {
    await _run({ configDir, stream });
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

async function _run({ configDir, stream }) {
  const s = createStyler({ isTTY: stream.isTTY });

  stream.write(renderWordmark({ stream }));

  let state = detectSetupState({ configDir });

  // Fresh: exactly one meaningful action — drop straight into init, no menu noise.
  // Banner/quick-start suppressed — the hub already showed its own banner above,
  // and owns showing the quick-start panel exactly once after the menu loop exits.
  if (state.status === 'fresh') {
    await runInit({ configDir, showBanner: false, showQuickStart: false });
    state = detectSetupState({ configDir });
    if (state.status === 'fresh') return; // cancelled without saving anything — nothing more to offer
  }

  while (true) {
    state = detectSetupState({ configDir });
    const profiles = loadProfiles(configDir)?.profiles || {};
    const aliasStatus = checkAliasStatus({ selfBinPath: SELF_BIN_PATH });
    const { items, completedCount, totalCount, aliasWarning } = buildMenuItems({ state, profiles, aliasStatus });

    stream.write(`\n  ${s.dim(`Setup — ${completedCount} of ${totalCount} steps complete`)}\n`);
    if (aliasWarning) {
      stream.write(`  ${s.yellow('⚠')} ${s.dim(`'tl' on this machine points to ${aliasWarning} — use 'ticketlens' instead.`)}\n`);
    }

    const menuItems = items.map(i => ({
      label: i.marker ? `${i.marker} ${i.label}` : `  ${i.label}`,
      sublabel: i.sublabel,
    }));
    const selectedIndex = await promptSelect(menuItems, { stream });
    if (selectedIndex === null) break; // Ctrl+C/Esc — exit

    const selected = items[selectedIndex];
    if (selected.key === 'exit') break;

    if (selected.key === 'tracker-connection') {
      // Existing profiles with no default set can't be fixed by adding another
      // profile (init-wizard only offers the switch step right after an add) —
      // route to the switcher directly so this is actually resolvable.
      if (state.profileCount > 0 && !state.hasDefault) {
        await runSwitch({ configDir, stream });
      } else {
        await runInit({ configDir, showBanner: false, showQuickStart: false });
      }
    } else if (selected.key === 'credentials') {
      for (const profileName of state.missingCredentials) {
        await runConfig({ configDir, profileName });
      }
    } else if (selected.key === 'test-connections') {
      await testConnections({ configDir, stream });
    } else if (selected.key === 'ticket-prefixes') {
      await runConfig({ configDir });
    } else if (selected.key === 'console-login') {
      await runLogin({ stream });
      if (detectSetupState({ configDir }).loggedIn) {
        const doSync = await promptYN('Pull profiles from the console now?', { stream });
        if (doSync) {
          stream.write(`\n  ${s.dim('Syncing...')}\n`);
          await syncProfiles({ configDir });
        }
      }
    }
  }

  if (detectSetupState({ configDir }).status === 'ready') {
    printQuickStart({ stream, s });
  }
}
