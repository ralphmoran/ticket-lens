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
import { activateLicense, checkLicense, revalidateIfStale, isLicensed, showUpgradePrompt, readLicense } from '../skills/jtb/scripts/lib/license.mjs';
import { deleteProfile, loadProfiles } from '../skills/jtb/scripts/lib/profile-resolver.mjs';
import { run as runCache } from '../skills/jtb/scripts/lib/cache-manager.mjs';
import { printHelp, printProfiles } from '../skills/jtb/scripts/lib/help.mjs';
import { createStyler } from '../skills/jtb/scripts/lib/ansi.mjs';

const args = process.argv.slice(2);
const { command, args: cmdArgs } = parseCommand(args);

// Fire-and-forget: silently refresh license.json at startup if >7 days since last validation
revalidateIfStale();

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
    const daysSinceVal = status.validatedAt
      ? (Date.now() - new Date(status.validatedAt)) / 86400000
      : Infinity;
    // Grace period: treat as inactive if not revalidated within 30 days
    const graceExpired = daysSinceVal > 30;
    process.stdout.write('\n');
    if (status.active && !graceExpired) {
      process.stdout.write(`  ${s.green('●')} ${s.bold('License active')}\n\n`);
      process.stdout.write(`  ${s.dim('Tier:')}       ${s.bold(s.cyan(status.tier))}\n`);
      process.stdout.write(`  ${s.dim('Email:')}      ${status.email}\n`);
      if (status.validatedAt) {
        const date = status.validatedAt.split('T')[0];
        process.stdout.write(`  ${s.dim('Validated:')}  ${date}\n`);
        if (daysSinceVal > 7) {
          const days = Math.floor(daysSinceVal);
          process.stdout.write(`  ${s.yellow('⚠')}  ${s.dim(`Revalidation pending — last checked ${days} day${days === 1 ? '' : 's'} ago`)}\n`);
          process.stdout.write(`     ${s.dim('Run:')} ticketlens activate ${s.dim('<KEY>')} ${s.dim('to refresh')}\n`);
        }
      }
    } else if (graceExpired) {
      process.stdout.write(`  ${s.red('●')} ${s.bold('License inactive')}\n\n`);
      process.stdout.write(`  ${s.dim('Tier:')}   ${s.bold(status.tier)}\n`);
      process.stdout.write(`  ${s.dim('Email:')}  ${status.email}\n\n`);
      process.stdout.write(`  ${s.dim('Not revalidated in 30+ days. Run:')} ticketlens activate ${s.dim('<KEY>')}\n`);
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
    printProfiles({ config, plain });
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

  case 'schedule': {
    const subCmd = cmdArgs[0];

    if (subCmd === '--stop') {
      const { runScheduleStop } = await import('../skills/jtb/scripts/lib/schedule-wizard.mjs');
      await runScheduleStop({ licenseKey: readLicense()?.key });
      break;
    }

    if (subCmd === '--status') {
      const { runScheduleStatus } = await import('../skills/jtb/scripts/lib/schedule-wizard.mjs');
      await runScheduleStatus({ licenseKey: readLicense()?.key });
      break;
    }

    if (!isLicensed('pro')) {
      showUpgradePrompt('pro', 'ticketlens schedule');
      process.exitCode = 1;
      break;
    }

    const { runScheduleWizard } = await import('../skills/jtb/scripts/lib/schedule-wizard.mjs');
    const { promptScheduleAnswers } = await import('../skills/jtb/scripts/lib/prompt-helpers.mjs');
    const answers = await promptScheduleAnswers(cmdArgs);
    const result = await runScheduleWizard({ answers, licenseKey: readLicense()?.key });

    process.stdout.write(`✔ Digest scheduled for ${answers.time} ${answers.timezone}\n`);
    process.stdout.write(`  Next delivery: ${result.nextDelivery}\n`);
    break;
  }

  case 'help':
  default:
    printHelp();
    break;
}
