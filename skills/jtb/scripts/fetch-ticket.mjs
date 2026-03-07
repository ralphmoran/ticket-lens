#!/usr/bin/env node

/**
 * CLI entry point: fetches a Jira ticket and outputs a TicketBrief to stdout.
 * Usage: node fetch-ticket.mjs TICKET-KEY [--depth=N] [--profile=NAME]
 */

import { fetchTicket } from './lib/jira-client.mjs';
import { extractCodeReferences } from './lib/code-ref-parser.mjs';
import { assembleBrief } from './lib/brief-assembler.mjs';
import { resolveConnection } from './lib/profile-resolver.mjs';

export async function run(args, env = process.env, fetcher = globalThis.fetch, configDir = undefined) {
  const ticketKey = args.find(a => !a.startsWith('--'));
  if (!ticketKey) {
    process.stderr.write('Error: Missing ticket ID. Usage: fetch-ticket.mjs TICKET-KEY [--depth=N] [--profile=NAME]\n');
    process.exitCode = 1;
    return;
  }

  const profileArg = args.find(a => a.startsWith('--profile='));
  const profileName = profileArg ? profileArg.split('=')[1] : undefined;

  const conn = resolveConnection(ticketKey, {
    env,
    configDir,
    profileName,
    onWarning: (w) => process.stderr.write(w + '\n'),
  });

  const hasAuth = conn.pat || (conn.email && conn.apiToken);
  if (!conn.baseUrl || !hasAuth) {
    const missing = [];
    if (!conn.baseUrl) missing.push('JIRA_BASE_URL');
    if (!hasAuth) missing.push('JIRA_PAT or (JIRA_EMAIL + JIRA_API_TOKEN)');
    const hint = conn.source === 'env'
      ? `Missing env vars: ${missing.join(', ')}`
      : `Missing config in profile "${conn.profileName}": ${missing.join(', ')}`;
    process.stderr.write(`Error: ${hint}\n`);
    process.exitCode = 1;
    return;
  }

  // Build env-like object for jira-client compatibility
  const jiraEnv = {
    JIRA_BASE_URL: conn.baseUrl,
    ...(conn.pat ? { JIRA_PAT: conn.pat } : { JIRA_EMAIL: conn.email, JIRA_API_TOKEN: conn.apiToken }),
  };

  // Cloud profiles use v3 API (v2 search is deprecated/410), Server stays on v2
  const apiVersion = conn.auth === 'cloud' ? 3 : 2;

  if (conn.source === 'profile') {
    process.stderr.write(`Using profile: ${conn.profileName}\n`);
  }

  const depthArg = args.find(a => a.startsWith('--depth='));
  const depth = depthArg ? parseInt(depthArg.split('=')[1], 10) : 1;

  let ticket;
  try {
    ticket = await fetchTicket(ticketKey, { env: jiraEnv, fetcher, depth, apiVersion });
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
