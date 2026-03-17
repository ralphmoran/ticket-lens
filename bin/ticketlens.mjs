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
import { activateLicense, checkLicense } from '../skills/jtb/scripts/lib/license.mjs';
import { printHelp } from '../skills/jtb/scripts/lib/help.mjs';

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

  case 'activate': {
    const key = cmdArgs.find(a => !a.startsWith('--'));
    if (!key) {
      process.stderr.write('Error: Missing license key. Usage: ticketlens activate <LICENSE-KEY>\n');
      process.exitCode = 1;
      break;
    }
    activateLicense(key).then(result => {
      if (result.success) {
        process.stdout.write(`License activated! Tier: ${result.tier}, Email: ${result.email}\n`);
      } else {
        process.stderr.write(`Activation failed: ${result.error}\n`);
        process.exitCode = 1;
      }
    });
    break;
  }

  case 'license': {
    const status = checkLicense();
    if (status.active) {
      process.stdout.write(`Tier: ${status.tier}\nEmail: ${status.email}\nStatus: active\nValidated: ${status.validatedAt}\n`);
    } else if (status.expired) {
      process.stdout.write(`Tier: ${status.tier}\nEmail: ${status.email}\nStatus: expired\nRenew at https://ticketlens.dev\n`);
    } else {
      process.stdout.write(`Tier: free\nActivate a license: ticketlens activate <LICENSE-KEY>\n`);
    }
    break;
  }

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
