#!/usr/bin/env node

/**
 * TicketLens CLI — Developer toolkit for Jira ticket context.
 * Usage:
 *   ticketlens TICKET-KEY [--depth=N] [--profile=NAME]
 *   ticketlens triage [--stale=N] [--status=X,Y] [--profile=NAME]
 */

import { parseCommand } from '../skills/jtb/scripts/lib/cli.mjs';
import { renderWordmark } from '../skills/jtb/scripts/lib/wordmark.mjs';
import { run as runFetch } from '../skills/jtb/scripts/fetch-ticket.mjs';
import { run as runTriage } from '../skills/jtb/scripts/fetch-my-tickets.mjs';
import { run as runInit } from '../skills/jtb/scripts/lib/init-wizard.mjs';
import { runSwitch } from '../skills/jtb/scripts/lib/profile-switcher.mjs';
import { run as runConfig } from '../skills/jtb/scripts/lib/config-wizard.mjs';
import { activateLicense, checkLicense, revalidateIfStale, isLicensed, showUpgradePrompt, readLicense } from '../skills/jtb/scripts/lib/license.mjs';
import { deleteProfile, loadProfiles, saveCredentialKey } from '../skills/jtb/scripts/lib/profile-resolver.mjs';
import { run as runCache } from '../skills/jtb/scripts/lib/cache-manager.mjs';
import {
  printHelp, printProfiles,
  printLoginHelp, printLogoutHelp, printSyncHelp,
  printActivateHelp, printLicenseHelp, printDeleteHelp,
  printProfilesHelp, printScheduleHelp,
  printInitHelp, printSwitchHelp, printConfigHelp,
  printReviewHelp, printStandupHelp, printUpdateSkillHelp,
  printCollisionsHelp, printStatsHelp,
  printCloudKeysHelp,
} from '../skills/jtb/scripts/lib/help.mjs';
import { runStats } from '../skills/jtb/scripts/lib/run-stats.mjs';
import { createStyler } from '../skills/jtb/scripts/lib/ansi.mjs';
import { readCliToken, deleteCliToken } from '../skills/jtb/scripts/lib/cli-auth.mjs';
import { runLogin } from '../skills/jtb/scripts/lib/login-flow.mjs';
import { syncProfiles, reportSyncResult, getApiBase } from '../skills/jtb/scripts/lib/sync.mjs';
import { checkForUpdate, getUpdateHint } from '../skills/jtb/scripts/lib/update-check.mjs';
import { incrementInvocation, incrementCommand } from '../skills/jtb/scripts/lib/activity-counter.mjs';
import { DEFAULT_CONFIG_DIR } from '../skills/jtb/scripts/lib/config.mjs';
import { checkTeamJiraConfigUpdate } from '../skills/jtb/scripts/lib/team-jira-sync.mjs';

const TRACKED_COMMANDS = new Set([
  'triage', 'fetch', 'get', 'compliance', 'review', 'standup',
  'pr', 'ledger', 'stats', 'collisions', 'history', 'schedule',
  'brief', 'sync',
]);

const args = process.argv.slice(2);
const { command, args: cmdArgs } = parseCommand(args);

// Best-effort invocation counter — non-fatal
try { incrementInvocation(DEFAULT_CONFIG_DIR); } catch { /* non-fatal */ }

// Per-command + per-flag tracking — non-fatal
if (TRACKED_COMMANDS.has(command)) {
  try { incrementCommand(DEFAULT_CONFIG_DIR, command, cmdArgs); } catch { /* non-fatal */ }
}

// Fire-and-forget: silently refresh license.json at startup if >7 days since last validation
revalidateIfStale();
// Fire-and-forget: refresh the cached latest npm version once per 24h
checkForUpdate();

// Show a one-line update hint on stderr after the command exits (never blocks stdout)
process.on('exit', () => {
  try {
    const latest = getUpdateHint();
    if (!latest) return;
    const s = createStyler({ isTTY: process.stderr.isTTY });
    process.stderr.write(`\n${s.brand('◆')} Update available ${s.dim('→')} ${s.bold(s.cyan(latest))}  ${s.dim('npm install -g ticketlens')}\n`);
  } catch {
    // never let the update hint crash the process
  }
});

switch (command) {
  case 'fetch': {
    // Flow 2: fire team config check concurrently; banner shown after brief output
    const _teamCheck = checkTeamJiraConfigUpdate().catch(() => null);
    runFetch(cmdArgs).then(async () => {
      const tcResult = await _teamCheck;
      if (tcResult?.banner) {
        const s = createStyler({ isTTY: process.stderr.isTTY });
        process.stderr.write(`\n  ${s.yellow('!')} ${tcResult.banner}\n`);
      } else if (tcResult?.deleted) {
        const s = createStyler({ isTTY: process.stderr.isTTY });
        process.stderr.write(`\n  ${s.yellow('!')} Team Jira config removed by manager — using local credentials.\n`);
      }
    }).catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;
  }

  case 'triage':
    runTriage(cmdArgs).catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;

  case 'collisions': {
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printCollisionsHelp(); break; }
    const { runCollisions } = await import('../skills/jtb/scripts/lib/run-collisions.mjs');
    runCollisions(cmdArgs).catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;
  }

  case 'history': {
    if (!isLicensed('pro')) { showUpgradePrompt('pro', 'ticketlens history'); break; }
    const ticketKey = cmdArgs[0];
    if (!ticketKey || ticketKey.startsWith('-')) {
      process.stderr.write('Usage: ticketlens history TICKET-KEY\n');
      process.exitCode = 1;
      break;
    }
    const { queryTicketHistory } = await import('../skills/jtb/scripts/lib/triage-history.mjs');
    const entries = queryTicketHistory(ticketKey);
    if (entries.length === 0) {
      process.stdout.write(`No triage history found for ${ticketKey}.\n`);
      break;
    }
    const hs = createStyler({ isTTY: process.stdout.isTTY });
    process.stdout.write(`\nHistory for ${hs.bold(ticketKey)} (${entries.length} entries)\n\n`);
    for (const e of entries) {
      const bounce = e.bounced ? hs.yellow(' ⟳ bounced') : '';
      const urg = e.urgency === 'needs-response' ? hs.red(e.urgency) : e.urgency === 'aging' ? hs.yellow(e.urgency) : hs.green(e.urgency);
      process.stdout.write(`  ${hs.dim(e.date)}  [${e.profile}]  ${urg}${bounce}  ${hs.dim(e.reason)}\n`);
    }
    process.stdout.write('\n');
    break;
  }

  case 'stats': {
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printStatsHelp(); break; }
    runStats(cmdArgs).catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;
  }

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

    if (cmdArgs[0] === 'set' && cmdArgs[1] === 'aiProvider') {
      const s = createStyler({ isTTY: process.stdout.isTTY });
      const value = cmdArgs[2];
      if (!value) {
        process.stderr.write(`${s.red('✖')} Missing value.\n  Usage: ticketlens config set aiProvider <anthropic|openai|groq>\n`);
        process.exitCode = 1;
        break;
      }
      const validProviders = ['anthropic', 'openai', 'groq'];
      if (!validProviders.includes(value)) {
        process.stderr.write(`${s.red('✖')} Unknown provider "${value}". Valid: ${validProviders.join(', ')}\n`);
        process.exitCode = 1;
        break;
      }
      saveCredentialKey('aiProvider', value);
      process.stdout.write(`  ${s.green('✔')} AI provider set to ${s.bold(s.cyan(value))}\n`);
      process.stdout.write(`  ${s.dim('Applied when running --summarize or --handoff without --provider=')}\n`);
      break;
    }

    const profileArg = cmdArgs.find(a => a.startsWith('--profile='));
    const profileName = profileArg ? profileArg.split('=')[1] : undefined;
    const isInteractive = process.stdin.isTTY && process.stdout.isTTY && !process.env.CI && !cmdArgs.includes('--no-input');

    (async () => {
      if (isInteractive) {
        const { detectSetupState } = await import('../skills/jtb/scripts/lib/setup-state.mjs');
        // Ready + no explicit --profile= honors the hub's own "Exit" sublabel
        // promise ("you can rerun this any time: ticketlens config"). An
        // explicit --profile= is a targeted, scriptable invocation — bypass
        // the hub and edit that profile directly, unchanged from today.
        if (detectSetupState().status !== 'ready' || !profileName) {
          const { run: runOnboarding } = await import('../skills/jtb/scripts/lib/onboarding.mjs');
          await runOnboarding({ stream: process.stderr });
          return;
        }
      }

      await runConfig({ profileName });
    })().catch(err => {
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
    }).catch(err => {
      process.stderr.write(`\n  ${s.red('✖')} Activation error: ${err.message}\n\n`);
      process.exitCode = 1;
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
        const cleanup = () => { process.stdin.setRawMode(false); process.stdin.pause(); };
        const onData = char => {
          process.stdin.removeListener('end', onEnd);
          cleanup();
          process.stderr.write('\n');
          if (char === '\x03') process.exit(0);
          res(char === 'y' || char === 'Y');
        };
        const onEnd = () => { process.stdin.removeListener('data', onData); cleanup(); res(false); };
        process.stdin.once('data', onData);
        process.stdin.once('end', onEnd);
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

  case 'version':
    process.stdout.write(renderWordmark({ stream: process.stdout }));
    break;

  case 'schedule': {
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printScheduleHelp(); break; }
    const subCmd = cmdArgs[0];

    if (subCmd === '--stop') {
      const { runScheduleStop } = await import('../skills/jtb/scripts/lib/schedule-wizard.mjs');
      await runScheduleStop({ cliToken: readCliToken() });
      break;
    }

    if (subCmd === '--status') {
      const { runScheduleStatus } = await import('../skills/jtb/scripts/lib/schedule-wizard.mjs');
      await runScheduleStatus({ cliToken: readCliToken() });
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
    const result = await runScheduleWizard({ answers, cliToken: readCliToken() });
    if (!result.ok) { process.exitCode = 1; break; }

    const s = createStyler({ isTTY: process.stdout.isTTY });
    process.stdout.write(`  ${s.green('✔')} ${s.bold('Digest scheduled')}\n\n`);
    process.stdout.write(`  ${s.dim('Time:         ')} ${s.cyan(answers.time)}  ${s.dim(answers.timezone)}\n`);
    process.stdout.write(`  ${s.dim('Email:        ')} ${answers.email}\n`);
    process.stdout.write(`  ${s.dim('Next delivery:')} ${s.cyan(result.nextDelivery)}\n`);
    process.stdout.write('\n');
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

  case 'review':
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printReviewHelp(); break; }
    runFetch(['review', ...cmdArgs]).catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;

  case 'standup':
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printStandupHelp(); break; }
    runFetch(['standup', ...cmdArgs]).catch(err => {
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

  case 'update-skill': {
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printUpdateSkillHelp(); break; }
    const { updateSkill } = await import('../skills/jtb/scripts/lib/update-skill.mjs');
    await updateSkill(cmdArgs);
    break;
  }

  case 'login': {
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printLoginHelp(); break; }

    const useManual = cmdArgs.includes('--manual');

    (async () => {
      await runLogin({ manual: useManual });
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

      process.stderr.write('\x1b[A\r\x1b[2K');
      reportSyncResult(result, { stream: process.stderr });
      if (result.error) {
        process.stderr.write('\n');
        process.exitCode = 1;
        return;
      }

      // Flow 3: also pull team Jira config update (Pro/Team); silently skipped for Free
      const tcSync = await checkTeamJiraConfigUpdate().catch(() => null);
      if (tcSync?.banner) {
        process.stderr.write(`\n  ${s.yellow('!')} ${tcSync.banner}\n`);
      } else if (tcSync?.deleted) {
        process.stderr.write(`\n  ${s.yellow('!')} Team Jira config removed by manager — using local credentials.\n`);
      }

      process.stderr.write('\n');
    })().catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;
  }

  case 'cloud-keys': {
    if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) { printCloudKeysHelp(); break; }

    const { listCloudKeys, addCloudKey, removeCloudKey, setPriority, setTimeout_, testCloudKey } =
      await import('../skills/jtb/scripts/lib/cloud-keys.mjs');

    const cliToken = readCliToken();
    if (!cliToken) {
      process.stderr.write('Not logged in. Run `ticketlens login` first.\n');
      process.exitCode = 1;
      break;
    }

    const apiBase = getApiBase();
    const cfg = { cliToken, apiBase };
    const s = createStyler({ isTTY: process.stderr.isTTY });
    const subCmd = cmdArgs[0];

    (async () => {
      if (!subCmd || subCmd === 'list') {
        const providers = await listCloudKeys(cfg);
        if (providers.length === 0) {
          process.stdout.write('No AI providers configured.\n');
          process.stdout.write(`Add one: ticketlens cloud-keys add <provider> <key>\n`);
          return;
        }
        for (const p of providers) {
          const status = p.enabled ? s.brand('on') : s.dim('off');
          process.stdout.write(
            `  ${p.provider.padEnd(12)} ${p.masked_key.padEnd(28)} priority=${p.priority}  timeout=${p.timeout_seconds}s  [${status}]\n`
          );
        }
        return;
      }

      if (subCmd === 'add') {
        const provider = cmdArgs[1];
        const apiKey   = cmdArgs[2];
        if (!provider || !apiKey) {
          process.stderr.write('Usage: ticketlens cloud-keys add <provider> <key> [--timeout=N]\n');
          process.exitCode = 1;
          return;
        }
        const timeoutArg = cmdArgs.find(a => a.startsWith('--timeout='));
        const timeout = timeoutArg ? parseInt(timeoutArg.split('=')[1], 10) : 5;
        await addCloudKey(cfg, provider, apiKey, timeout);
        process.stdout.write(`${s.brand('✓')} ${provider} key saved.\n`);
        return;
      }

      if (subCmd === 'remove') {
        const provider = cmdArgs[1];
        if (!provider) {
          process.stderr.write('Usage: ticketlens cloud-keys remove <provider>\n');
          process.exitCode = 1;
          return;
        }
        await removeCloudKey(cfg, provider);
        process.stdout.write(`${s.brand('✓')} ${provider} key removed.\n`);
        return;
      }

      if (subCmd === 'test') {
        const provider = cmdArgs[1];
        if (!provider) {
          process.stderr.write('Usage: ticketlens cloud-keys test <provider>\n');
          process.exitCode = 1;
          return;
        }
        process.stderr.write(`Testing ${provider}…\n`);
        const result = await testCloudKey(cfg, provider);
        if (result.ok) {
          process.stdout.write(`${s.brand('✓')} ${provider} responded: ${result.response}\n`);
        } else {
          process.stderr.write(`${s.dim('✗')} ${provider} error: ${result.error ?? 'unknown'}\n`);
          process.exitCode = 1;
        }
        return;
      }

      if (subCmd === 'priority') {
        const provider = cmdArgs[1];
        const priority = parseInt(cmdArgs[2], 10);
        if (!provider || isNaN(priority)) {
          process.stderr.write('Usage: ticketlens cloud-keys priority <provider> <N>\n');
          process.exitCode = 1;
          return;
        }
        await setPriority(cfg, provider, priority);
        process.stdout.write(`${s.brand('✓')} ${provider} priority set to ${priority}.\n`);
        return;
      }

      if (subCmd === 'timeout') {
        const provider = cmdArgs[1];
        const seconds  = parseInt(cmdArgs[2], 10);
        if (!provider || isNaN(seconds)) {
          process.stderr.write('Usage: ticketlens cloud-keys timeout <provider> <seconds>\n');
          process.exitCode = 1;
          return;
        }
        await setTimeout_(cfg, provider, seconds);
        process.stdout.write(`${s.brand('✓')} ${provider} timeout set to ${seconds}s.\n`);
        return;
      }

      process.stderr.write(`Unknown subcommand: ${subCmd}\n`);
      printCloudKeysHelp({ stream: process.stderr });
      process.exitCode = 1;
    })().catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;
  }

  case 'help':
  default: {
    const isInteractive = args.length === 0 && process.stdin.isTTY && process.stdout.isTTY && !process.env.CI;

    (async () => {
      if (isInteractive) {
        const { detectSetupState } = await import('../skills/jtb/scripts/lib/setup-state.mjs');
        if (detectSetupState().status !== 'ready') {
          const { run: runOnboarding } = await import('../skills/jtb/scripts/lib/onboarding.mjs');
          await runOnboarding({ stream: process.stderr });
          return;
        }
      }
      printHelp();
    })().catch(err => {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    });
    break;
  }
}
