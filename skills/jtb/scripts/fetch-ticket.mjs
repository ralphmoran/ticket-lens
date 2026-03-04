#!/usr/bin/env node

/**
 * CLI entry point: fetches a Jira ticket and outputs a TicketBrief to stdout.
 * Usage: node fetch-ticket.mjs TICKET-KEY [--depth=N]
 */

import { fetchTicket } from './lib/jira-client.mjs';
import { extractCodeReferences } from './lib/code-ref-parser.mjs';
import { assembleBrief } from './lib/brief-assembler.mjs';

export async function run(args, env = process.env, fetcher = globalThis.fetch) {
  const ticketKey = args.find(a => !a.startsWith('--'));
  if (!ticketKey) {
    process.stderr.write('Error: Missing ticket ID. Usage: fetch-ticket.mjs TICKET-KEY [--depth=N]\n');
    process.exitCode = 1;
    return;
  }

  const requiredVars = ['JIRA_BASE_URL'];
  const hasAuth = env.JIRA_PAT || (env.JIRA_EMAIL && env.JIRA_API_TOKEN);
  if (!env.JIRA_BASE_URL || !hasAuth) {
    const missing = [];
    if (!env.JIRA_BASE_URL) missing.push('JIRA_BASE_URL');
    if (!hasAuth) missing.push('JIRA_PAT or (JIRA_EMAIL + JIRA_API_TOKEN)');
    process.stderr.write(`Error: Missing env vars: ${missing.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  const depthArg = args.find(a => a.startsWith('--depth='));
  const depth = depthArg ? parseInt(depthArg.split('=')[1], 10) : 1;

  let ticket;
  try {
    ticket = await fetchTicket(ticketKey, { env, fetcher, depth });
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  const allText = [ticket.description, ...ticket.comments.map(c => c.body)].filter(Boolean).join('\n');
  const codeRefs = extractCodeReferences(allText);

  const brief = assembleBrief(ticket, codeRefs);
  process.stdout.write(brief + '\n');
}

// Run if invoked directly
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''));
if (isMain) {
  run(process.argv.slice(2)).catch(err => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
  });
}
