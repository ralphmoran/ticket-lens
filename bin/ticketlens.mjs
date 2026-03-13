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
    process.stdout.write(`TicketLens — Developer toolkit for Jira ticket context

Usage:
  ticketlens <TICKET-KEY> [options]    Fetch ticket brief
  ticketlens triage [options]          Scan assigned tickets for attention
  ticketlens activate <KEY>            Activate a license key
  ticketlens license                   Show current license status

Fetch options:
  --depth=N          Traversal depth (0=target only, 1=+linked, 2=+linked-of-linked)
  --profile=NAME     Force a specific Jira profile
  --styled           Force ANSI-styled output
  --plain            Force plain markdown output

Triage options:
  --stale=N          Aging threshold in days (default: 5)
  --status=X,Y       Override statuses to scan
  --profile=NAME     Force a specific Jira profile
  --styled           Force ANSI-styled output
  --plain            Force plain markdown output

Global options:
  --help             Show this help
  --version          Show version

Examples:
  ticketlens PROJ-123
  ticketlens PROJ-123 --depth=0 --profile=myteam
  ticketlens triage --stale=3
  ticketlens triage --profile=acme
  ticketlens activate AAAA-BBBB-CCCC-DDDD
  ticketlens license

Setup:
  Configure profiles in ~/.ticketlens/profiles.json
  Or set env vars: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
`);
    break;
}
