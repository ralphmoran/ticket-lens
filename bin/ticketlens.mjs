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
import {
  printHelp, printProfiles,
  printLoginHelp, printLogoutHelp, printSyncHelp,
  printActivateHelp, printLicenseHelp, printDeleteHelp,
  printProfilesHelp, printScheduleHelp,
  printInitHelp, printSwitchHelp, printConfigHelp,
} from '../skills/jtb/scripts/lib/help.mjs';
import { createStyler } from '../skills/jtb/scripts/lib/ansi.mjs';
import { readCliToken, saveCliToken, deleteCliToken } from '../skills/jtb/scripts/lib/cli-auth.mjs';
import { browserLogin } from '../skills/jtb/scripts/lib/browser-login.mjs';
import { syncProfiles, getApiBase, getConsoleBase } from '../skills/jtb/scripts/lib/sync.mjs';
import { promptSecret, promptText } from '../skills/jtb/scripts/lib/prompt-helpers.mjs';

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
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printInitHelp(); break; }
    runInit().catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;

  case 'switch':
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printSwitchHelp(); break; }
    runSwitch().catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;

  case 'config': {
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printConfigHelp(); break; }
    const profileArg = cmdArgs.find(a => a.startsWith('--profile='));
    const profileName = profileArg ? profileArg.split('=')[1] : undefined;
    runConfig({ profileName }).catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;
  }

  case 'activate': {
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printActivateHelp(); break; }
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
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printLicenseHelp(); break; }
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
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printDeleteHelp(); break; }
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
    const forceYes = cmdArgs.includes('--yes') || cmdArgs.includes('-y');
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
    } else if (!forceYes) {
      process.stderr.write(`${s.red('✖')} Non-interactive mode: pass ${s.cyan('--yes')} to confirm deletion without a prompt.\n`);
      process.exitCode = 1;
      break;
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
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printProfilesHelp(); break; }
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
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printScheduleHelp(); break; }
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

  case 'install-hooks':
    runFetch(['install-hooks', ...cmdArgs]).catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;

  case 'pr':
    runFetch(['pr', ...cmdArgs]).catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;

  case 'ledger':
    runFetch(['ledger', ...cmdArgs]).catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;

  case 'compliance':
    runFetch(['compliance', ...cmdArgs]).catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;

  case 'login': {
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printLoginHelp(); break; }

    const useManual = cmdArgs.includes('--manual');

    (async () => {
      const s = createStyler({ isTTY: process.stderr.isTTY });

      let token;

      if (useManual) {
        // ── manual paste flow (CI / headless environments) ──────────────────
        process.stderr.write(`\n  ${s.bold('TicketLens Login')}\n`);
        process.stderr.write(`  ${s.dim('─'.repeat(44))}\n`);
        process.stderr.write(`  ${s.dim(`Generate a CLI token at ${s.cyan(`${getConsoleBase()}/console/account`)}`)}\n`);
        process.stderr.write(`  ${s.dim('then paste it below.')}\n\n`);

        token = await promptSecret(`CLI Token ${s.dim('(tl_…)')}:`, { stream: process.stderr });
        if (!token.startsWith('tl_')) {
          process.stderr.write(`  ${s.red('✖')} Token must start with ${s.dim('tl_')}\n`);
          process.exitCode = 1;
          return;
        }
      } else {
        // ── browser flow (default) ────────────────────────────────────────
        process.stderr.write(`\n  ${s.bold('TicketLens Login')}\n`);
        process.stderr.write(`  ${s.dim('─'.repeat(44))}\n`);
        process.stderr.write(`  Opening browser to authorize…\n\n`);
        process.stderr.write(`  ${s.dim('○ Waiting for authorization (120s)…')}\n`);

        try {
          token = await browserLogin();
        } catch (err) {
          process.stderr.write(`\x1b[A\r\x1b[2K  ${s.red('✖')} ${err.message}\n`);
          process.stderr.write(`\n  ${s.dim(`Try ${s.cyan('ticketlens login --manual')} to paste a token instead.`)}\n\n`);
          process.exitCode = 1;
          return;
        }
      }

      // ── verify token against API (both flows) ─────────────────────────
      process.stderr.write(`\n  ${s.dim('○ Verifying token…')}\n`);
      let res;
      try {
        res = await fetch(`${getApiBase()}/v1/profiles`, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        process.stderr.write(`\x1b[A\r\x1b[2K  ${s.red('✖')} Could not reach ${getApiBase()} — check your connection.\n`);
        process.exitCode = 1;
        return;
      }

      if (res.status === 401) {
        process.stderr.write(`\x1b[A\r\x1b[2K  ${s.red('✖')} Invalid token — check the value and try again.\n`);
        process.exitCode = 1;
        return;
      }
      if (!res.ok) {
        process.stderr.write(`\x1b[A\r\x1b[2K  ${s.red('✖')} Server returned ${res.status}. Try again later.\n`);
        process.exitCode = 1;
        return;
      }

      saveCliToken(token);
      process.stderr.write(`\x1b[A\r\x1b[2K  ${s.green('✔')} Logged in.\n`);
      process.stderr.write(`\n  Run ${s.cyan('ticketlens sync')} to pull your connections.\n\n`);
    })().catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;
  }

  case 'logout': {
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printLogoutHelp(); break; }
    const s = createStyler({ isTTY: process.stderr.isTTY });
    deleteCliToken();
    process.stderr.write(`  ${s.green('✔')} CLI token removed.\n`);
    break;
  }

  case 'sync': {
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printSyncHelp(); break; }
    (async () => {
      const s = createStyler({ isTTY: process.stderr.isTTY });
      process.stderr.write(`\n  ${s.dim('Syncing from TicketLens console…')}\n`);

      const result = await syncProfiles();

      if (result.error === 'no-token') {
        process.stderr.write(`\x1b[A\r\x1b[2K  ${s.red('✖')} Not logged in. Run ${s.cyan('ticketlens login')} first.\n\n`);
        process.exitCode = 1;
        return;
      }
      if (result.error === 'unauthorized') {
        process.stderr.write(`\x1b[A\r\x1b[2K  ${s.red('✖')} Token expired or revoked. Run ${s.cyan('ticketlens login')} to re-authenticate.\n\n`);
        process.exitCode = 1;
        return;
      }
      if (result.error) {
        process.stderr.write(`\x1b[A\r\x1b[2K  ${s.red('✖')} Sync failed: ${result.error}\n\n`);
        process.exitCode = 1;
        return;
      }

      const { added, updated, unchanged, needsCredentials } = result;
      const total = added.length + updated.length + unchanged.length;

      process.stderr.write(`\x1b[A\r\x1b[2K  ${s.green('✔')} Sync complete`);
      if (total === 0) {
        process.stderr.write(` — no profiles on console yet.\n`);
      } else {
        process.stderr.write(`\n`);
        if (added.length)     process.stderr.write(`  ${s.dim('+')} ${added.length} added: ${added.map(n => s.cyan(n)).join(', ')}\n`);
        if (updated.length)   process.stderr.write(`  ${s.dim('↑')} ${updated.length} updated: ${updated.map(n => s.cyan(n)).join(', ')}\n`);
        if (unchanged.length) process.stderr.write(`  ${s.dim('○')} ${unchanged.length} unchanged\n`);
      }

      if (needsCredentials.length > 0) {
        process.stderr.write(`\n  ${s.yellow('!')} These profiles need credentials before they can be used:\n`);
        for (const name of needsCredentials) {
          process.stderr.write(`    ${s.dim('○')} ${s.cyan(name)} — run: ${s.bold(`ticketlens config --profile=${name}`)}\n`);
        }
      }

      process.stderr.write('\n');
    })().catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;
  }

  case 'help':
  default:
    printHelp();
    break;
}
