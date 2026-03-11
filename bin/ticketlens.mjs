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

Fetch options:
  --depth=N          Traversal depth (0=target only, 1=+linked, 2=+linked-of-linked)
  --profile=NAME     Force a specific Jira profile

Triage options:
  --stale=N          Aging threshold in days (default: 5)
  --status=X,Y       Override statuses to scan
  --profile=NAME     Force a specific Jira profile

Global options:
  --help             Show this help
  --version          Show version

Examples:
  ticketlens PROJ-123
  ticketlens PROJ-123 --depth=0 --profile=myteam
  ticketlens triage --stale=3
  ticketlens triage --profile=acme

Setup:
  Configure profiles in ~/.ticketlens/profiles.json
  Or set env vars: JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN
`);
    break;
}
