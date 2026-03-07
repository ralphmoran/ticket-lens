#!/usr/bin/env node

/**
 * CLI entry point: scans assigned tickets and surfaces what needs attention.
 * Usage: node fetch-my-tickets.mjs [--stale=N] [--status=X,Y] [--profile=NAME]
 */

import { fetchCurrentUser, searchTickets, fetchStatuses } from './lib/jira-client.mjs';
import { scoreAttention, sortByUrgency } from './lib/attention-scorer.mjs';
import { assembleTriageSummary } from './lib/brief-assembler.mjs';
import { resolveConnection } from './lib/profile-resolver.mjs';

const DEFAULT_STATUSES = ['In Progress', 'Code Review', 'QA'];

export async function run(args, env = process.env, fetcher = globalThis.fetch, configDir = undefined) {
  const profileArg = args.find(a => a.startsWith('--profile='));
  const profileName = profileArg ? profileArg.split('=')[1] : undefined;

  const staleArg = args.find(a => a.startsWith('--stale='));
  const staleDays = staleArg ? parseInt(staleArg.split('=')[1], 10) : 5;

  const statusArg = args.find(a => a.startsWith('--status='));

  const cwd = process.cwd();
  const conn = resolveConnection(null, {
    env,
    configDir,
    profileName,
    cwd,
    onWarning: (w) => process.stderr.write(w + '\n'),
  });

  const hasAuth = conn.pat || (conn.email && conn.apiToken);
  if (!conn.baseUrl || !hasAuth) {
    process.stderr.write(
      'Error: Could not determine Jira profile. Use --profile=NAME or add projectPaths to ~/.ticketlens/profiles.json\n'
    );
    process.exitCode = 1;
    return;
  }

  const jiraEnv = {
    JIRA_BASE_URL: conn.baseUrl,
    ...(conn.pat ? { JIRA_PAT: conn.pat } : { JIRA_EMAIL: conn.email, JIRA_API_TOKEN: conn.apiToken }),
  };

  // Status resolution: --status flag > profile triageStatuses > defaults
  const statuses = statusArg
    ? statusArg.split('=')[1].split(',').map(s => s.trim())
    : conn.triageStatuses || DEFAULT_STATUSES;

  if (conn.source === 'profile') {
    process.stderr.write(`Using profile: ${conn.profileName}\n`);
  }

  let currentUser;
  try {
    currentUser = await fetchCurrentUser({ env: jiraEnv, fetcher });
  } catch (err) {
    process.stderr.write(`Error fetching current user: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  const statusList = statuses.map(s => `"${s}"`).join(',');
  const jql = `assignee = currentUser() AND status IN (${statusList}) ORDER BY updated DESC`;

  let tickets;
  try {
    tickets = await searchTickets(jql, { env: jiraEnv, fetcher });
  } catch (err) {
    if (err.status === 400 && err.detail && /does not exist for the field 'status'/.test(err.detail)) {
      process.stderr.write(`\nInvalid status in triage config. Fetching available statuses from Jira...\n\n`);
      try {
        const available = await fetchStatuses({ env: jiraEnv, fetcher });
        const invalid = statuses.filter(s => !available.includes(s));
        const devLike = available.filter(s =>
          /progress|review|develop|test|qa|blocked|code/i.test(s)
        );

        if (invalid.length) {
          process.stderr.write(`Invalid statuses: ${invalid.map(s => `"${s}"`).join(', ')}\n\n`);
        }
        process.stderr.write(`Suggested dev-relevant statuses for this Jira instance:\n`);
        devLike.forEach(s => process.stderr.write(`  - ${s}\n`));

        process.stderr.write(`\nAll available statuses:\n`);
        available.forEach(s => process.stderr.write(`  - ${s}\n`));

        const profileRef = conn.profileName || 'your-profile';
        const suggested = JSON.stringify(devLike);
        process.stderr.write(`\nTo fix, add to ~/.ticketlens/profiles.json under "${profileRef}":\n`);
        process.stderr.write(`  "triageStatuses": ${suggested}\n\n`);
        process.stderr.write(`Or run with: /jtb triage --status=${devLike.join(',')}\n`);
      } catch (statusErr) {
        process.stderr.write(`Could not fetch statuses: ${statusErr.message}\n`);
      }
      process.exitCode = 1;
      return;
    }
    process.stderr.write(`Error searching tickets: ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  const scored = tickets.map(t => scoreAttention(t, currentUser, { staleDays }));
  const actionable = scored.filter(s => s.urgency !== 'clear');
  const sorted = sortByUrgency(actionable);

  const summary = assembleTriageSummary(sorted, { staleDays, baseUrl: conn.baseUrl });
  process.stdout.write(summary + '\n');
}

// Run if invoked directly
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''));
if (isMain) {
  run(process.argv.slice(2)).catch(err => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
  });
}
