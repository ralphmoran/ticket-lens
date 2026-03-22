#!/usr/bin/env node

/**
 * TicketLens CLI — Developer toolkit for Jira ticket context.
 * Usage:
 *   ticketlens TICKET-KEY [--depth=N] [--profile=NAME]
 *   ticketlens triage [--stale=N] [--status=X,Y] [--profile=NAME]
 */

import { createRequire } from 'node:module';
import { parseCommand } from '../skills/jtb/scripts/lib/cli.mjs';
import { run as runFetch } from '../skills/jtb/scripts/fetch-ticket.mjs';
import { run as runTriage } from '../skills/jtb/scripts/fetch-my-tickets.mjs';
import { run as runInit } from '../skills/jtb/scripts/lib/init-wizard.mjs';
import { runSwitch } from '../skills/jtb/scripts/lib/profile-switcher.mjs';
import { run as runConfig } from '../skills/jtb/scripts/lib/config-wizard.mjs';
import { activateLicense, checkLicense } from '../skills/jtb/scripts/lib/license.mjs';
import { deleteProfile, loadProfiles, saveDefault } from '../skills/jtb/scripts/lib/profile-resolver.mjs';
import { promptSelect } from '../skills/jtb/scripts/lib/select-prompt.mjs';
import { run as runCache } from '../skills/jtb/scripts/lib/cache-manager.mjs';
import { printHelp, printProfiles } from '../skills/jtb/scripts/lib/help.mjs';
import { createStyler } from '../skills/jtb/scripts/lib/ansi.mjs';

const args = process.argv.slice(2);
const { command, args: cmdArgs } = parseCommand(args);

switch (command) {
  case 'fetch':
    runFetch(cmdArgs).catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;

  case 'triage':
    runTriage(cmdArgs).catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;

  case 'init':
    runInit().catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;

  case 'switch':
    runSwitch().catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;

  case 'config': {
    const profileArg = cmdArgs.find(a => a.startsWith('--profile='));
    const profileName = profileArg ? profileArg.split('=')[1] : undefined;
    runConfig({ profileName }).catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;
  }

  case 'activate': {
    const s = createStyler({ isTTY: process.stdout.isTTY });
    const key = cmdArgs.find(a => !a.startsWith('--'));
    if (!key) {
      process.stderr.write(`${s.red('✖')} Missing license key.\n  ${s.dim('Usage:')} ticketlens activate ${s.dim('<LICENSE-KEY>')}\n`);
      process.exitCode = 1;
      break;
    }
    activateLicense(key).then(result => {
      if (result.success) {
        process.stdout.write(`\n  ${s.green('✔')} License activated\n\n`);
        process.stdout.write(`  ${s.dim('Tier:')}   ${s.bold(s.cyan(result.tier))}\n`);
        process.stdout.write(`  ${s.dim('Email:')}  ${result.email}\n\n`);
      } else {
        process.stderr.write(`\n  ${s.red('✖')} Activation failed: ${result.error}\n\n`);
        process.exitCode = 1;
      }
    });
    break;
  }

  case 'license': {
    const s = createStyler({ isTTY: process.stdout.isTTY });
    const status = checkLicense();
    process.stdout.write('\n');
    if (status.active) {
      process.stdout.write(`  ${s.green('●')} ${s.bold('License active')}\n\n`);
      process.stdout.write(`  ${s.dim('Tier:')}       ${s.bold(s.cyan(status.tier))}\n`);
      process.stdout.write(`  ${s.dim('Email:')}      ${status.email}\n`);
      if (status.validatedAt) {
        const date = status.validatedAt.split('T')[0];
        process.stdout.write(`  ${s.dim('Validated:')}  ${date}\n`);
      }
    } else if (status.expired) {
      process.stdout.write(`  ${s.yellow('●')} ${s.bold('License expired')}\n\n`);
      process.stdout.write(`  ${s.dim('Tier:')}   ${s.bold(status.tier)}\n`);
      process.stdout.write(`  ${s.dim('Email:')}  ${status.email}\n\n`);
      process.stdout.write(`  ${s.dim('Renew:')}  ticketlens activate ${s.dim('<LICENSE-KEY>')}\n`);
    } else {
      process.stdout.write(`  ${s.dim('●')} ${s.bold('Free tier')}\n\n`);
      process.stdout.write(`  ${s.dim('Unlock Pro features with a license key:')}\n`);
      process.stdout.write(`    ${s.cyan('ticketlens activate')} ${s.dim('<LICENSE-KEY>')}\n`);
    }
    process.stdout.write('\n');
    break;
  }

  case 'delete': {
    const s = createStyler({ isTTY: process.stderr.isTTY });
    const profileName = cmdArgs.find(a => !a.startsWith('--'));
    if (!profileName) {
      process.stderr.write(`${s.red('✖')} Missing profile name.\n  ${s.dim('Usage:')} ticketlens delete ${s.dim('<PROFILE-NAME>')}\n`);
      process.exitCode = 1;
      break;
    }
    const profiles = loadProfiles();
    if (!profiles?.profiles[profileName]) {
      process.stderr.write(`${s.red('✖')} Profile "${profileName}" not found.\n`);
      const names = Object.keys(profiles?.profiles || {});
      if (names.length > 0) process.stderr.write(`  ${s.dim('Profiles:')} ${names.join(', ')}\n`);
      process.exitCode = 1;
      break;
    }
    // Confirmation prompt on TTY
    if (process.stdin.isTTY && process.stdin.setRawMode) {
      process.stderr.write(`  Delete profile ${s.cyan(s.bold(profileName))}? This cannot be undone.  ${s.dim('y/N')}  `);
      const answer = await new Promise(res => {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        process.stdin.once('data', char => {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stderr.write('\n');
          if (char === '\x03') process.exit(0);
          res(char === 'y' || char === 'Y');
        });
      });
      if (!answer) {
        process.stderr.write(`  ${s.dim('Cancelled.')}\n`);
        break;
      }
    }
    const result = deleteProfile(profileName);
    if (result.deleted) {
      process.stdout.write(`  ${s.green('✔')} Profile ${s.bold(profileName)} deleted.\n`);
    } else {
      process.stderr.write(`${s.red('✖')} Could not delete profile "${profileName}".\n`);
      process.exitCode = 1;
    }
    break;
  }

  case 'profiles': {
    const plain = cmdArgs.includes('--plain');
    const config = loadProfiles();
    const names = Object.keys(config?.profiles || {});

    // Non-TTY or --plain: static list, no interaction
    if (plain || !process.stdin.isTTY || !process.stdin.setRawMode) {
      printProfiles({ config, plain });
      break;
    }

    // TTY: interactive profile quick-launcher
    const s = createStyler({ isTTY: process.stderr.isTTY });

    if (names.length === 0) {
      printProfiles({ config });
      break;
    }

    // Step 1 — select profile (skip if only one)
    let selectedProfile;
    if (names.length === 1) {
      selectedProfile = names[0];
      process.stderr.write(`\n  ${s.dim('Profile:')} ${s.bold(s.cyan(selectedProfile))}\n`);
    } else {
      const active = config?.default || names[0];
      const profileItems = names.map(name => {
        const p = config.profiles[name];
        const activeTag = name === active ? '  ● active' : '';
        return { label: name, sublabel: (p.baseUrl || '') + activeTag };
      });

      process.stderr.write(`\n  ${s.dim('Select a profile:')}\n`);
      const profileIdx = await promptSelect(profileItems, {
        hint: '↑/↓ select   Enter confirm   Esc cancel',
      });
      if (profileIdx === null) break;
      selectedProfile = names[profileIdx];
    }

    // Step 2 — select action
    const ACTION_ITEMS = [
      { label: 'Triage',        sublabel: 'scan assigned tickets' },
      { label: 'Edit config',   sublabel: 'modify profile settings' },
      { label: 'Set as active', sublabel: 'make this the default profile' },
      { label: 'Cancel' },
    ];

    process.stderr.write(`\n  ${s.dim(`${s.cyan(selectedProfile)} — what do you want to do?`)}\n`);
    const actionIdx = await promptSelect(ACTION_ITEMS, {
      hint: '↑/↓ select   Enter confirm   Esc cancel',
    });
    if (actionIdx === null || actionIdx === 3) break;

    if (actionIdx === 0) {
      await runTriage([`--profile=${selectedProfile}`]).catch(err => {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exitCode = 1;
      });
    } else if (actionIdx === 1) {
      await runConfig({ profileName: selectedProfile }).catch(err => {
        process.stderr.write(`Error: ${err.message}\n`);
        process.exitCode = 1;
      });
    } else if (actionIdx === 2) {
      saveDefault(selectedProfile);
      process.stdout.write(`  ${s.green('✔')} ${s.bold(selectedProfile)} is now the active profile.\n`);
    }
    break;
  }

  case 'cache':
    runCache(cmdArgs).catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;

  case 'version': {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json');
    process.stdout.write(`ticketlens v${pkg.version}\n`);
    break;
  }

  case 'help':
  default:
    printHelp();
    break;
}
