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
import { syncProfiles, reportSyncResult } from './sync.mjs';
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

/**
 * Sub-menu shown when "Tracker connection" is selected and a default profile
 * already exists — disambiguates "edit what's there" from "add a new one"
 * instead of silently launching the add-a-profile wizard (which read as
 * "starting over" when it fired with no warning).
 *
 * @param {object} opts
 * @param {number} opts.profileCount
 * @param {string} opts.defaultProfileName
 */
export function buildTrackerSubmenuItems({ profileCount, defaultProfileName }) {
  const items = [
    {
      key: 'edit',
      label: 'Edit connection',
      sublabel: `Update URL, credentials, or settings for "${defaultProfileName}"`,
    },
    {
      key: 'add',
      label: 'Add another connection',
      sublabel: 'Configure a second profile',
    },
  ];

  if (profileCount > 1) {
    items.push({
      key: 'switch',
      label: 'Switch active profile',
      sublabel: `Currently: ${defaultProfileName}`,
    });
  }

  items.push({ key: 'back', label: 'Back', sublabel: null });

  return items;
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
    const config = loadProfiles(configDir);
    const profiles = config?.profiles || {};
    const defaultProfileName = config?.default || Object.keys(profiles)[0];
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
      if (!state.hasDefault) {
        await runSwitch({ configDir, stream });
      } else {
        // A default already exists — ask what "Tracker connection" means here
        // instead of silently launching the add-a-profile wizard, which read
        // as the whole flow starting over with no warning.
        const submenuItems = buildTrackerSubmenuItems({ profileCount: state.profileCount, defaultProfileName });
        const submenuMenuItems = submenuItems.map(i => ({ label: i.label, sublabel: i.sublabel }));
        stream.write(`\n  ${s.dim('Tracker connection')}\n`);
        const subIndex = await promptSelect(submenuMenuItems, { stream });
        const subSelected = subIndex === null ? null : submenuItems[subIndex];
        if (subSelected?.key === 'edit') {
          await runConfig({ configDir });
        } else if (subSelected?.key === 'add') {
          await runInit({ configDir, showBanner: false, showQuickStart: false });
        } else if (subSelected?.key === 'switch') {
          await runSwitch({ configDir, stream });
        }
        // null (Esc) or 'back' -> fall through to the main menu, no-op
      }
    } else if (selected.key === 'credentials') {
      if (state.missingCredentials.length > 0) {
        for (const profileName of state.missingCredentials) {
          await runConfig({ configDir, profileName });
        }
      } else {
        // Nothing missing — let them review/rotate the default profile's
        // token instead of silently doing nothing.
        await runConfig({ configDir });
      }
    } else if (selected.key === 'test-connections') {
      await testConnections({ configDir, stream });
    } else if (selected.key === 'ticket-prefixes') {
      await runConfig({ configDir });
    } else if (selected.key === 'console-login') {
      // The hub immediately follows up with its own sync prompt below —
      // login-flow's "run ticketlens sync later" hint would be redundant.
      await runLogin({ stream, showSyncHint: false });
      if (detectSetupState({ configDir }).loggedIn) {
        const doSync = await promptYN('Pull profiles from the console now?', { stream });
        if (doSync) {
          stream.write(`\n  ${s.dim('Syncing...')}\n`);
          const result = await syncProfiles({ configDir });
          stream.write('\x1b[A\r\x1b[2K');
          reportSyncResult(result, { stream });
        }
      }
    }
  }

  if (detectSetupState({ configDir }).status === 'ready') {
    printQuickStart({ stream, s });
  }
}
