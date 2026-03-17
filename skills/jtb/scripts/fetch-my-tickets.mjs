#!/usr/bin/env node

/**
 * CLI entry point: scans assigned tickets and surfaces what needs attention.
 * Usage: node fetch-my-tickets.mjs [--stale=N] [--status=X,Y] [--profile=NAME]
 */

import { fetchCurrentUser, searchTickets, fetchStatuses } from './lib/jira-client.mjs';
import { scoreAttention, sortByUrgency } from './lib/attention-scorer.mjs';
import { assembleTriageSummary } from './lib/brief-assembler.mjs';
import { styleTriageSummary } from './lib/styled-assembler.mjs';
import { resolveConnection } from './lib/profile-resolver.mjs';
import { createSpinner } from './lib/spinner.mjs';
import { createSession } from './lib/banner.mjs';
import { classifyError } from './lib/error-classifier.mjs';
import { runInteractiveList } from './lib/interactive-list.mjs';
import { promptProfileSelect } from './lib/profile-picker.mjs';
import { printTriageHelp } from './lib/help.mjs';

const DEFAULT_STATUSES = ['In Progress', 'Code Review', 'QA'];

export async function run(args, env = process.env, fetcher = globalThis.fetch, configDir = undefined) {
  if (args.includes('--help') || args.includes('-h')) {
    printTriageHelp();
    return;
  }
  const profileArg = args.find(a => a.startsWith('--profile=') || a.startsWith('--project='));
  if (profileArg && profileArg.startsWith('--project=')) {
    process.stderr.write(`Hint: --project is not a valid flag. Using --profile=${profileArg.split('=')[1]} instead.\n\n`);
  }
  const profileName = profileArg ? profileArg.split('=')[1] : undefined;

  const staleArg = args.find(a => a.startsWith('--stale='));
  const staleDays = staleArg ? parseInt(staleArg.split('=')[1], 10) : 5;

  const statusArg = args.find(a => a.startsWith('--status='));

  const cwd = process.cwd();
  let profileError = null;
  const conn = resolveConnection(null, {
    env,
    configDir,
    profileName,
    cwd,
    onWarning: (w) => process.stderr.write(w + '\n'),
    onProfileNotFound: (info) => { profileError = info; },
  });

  const hasAuth = conn.pat || (conn.email && conn.apiToken);
  if (!conn.baseUrl || !hasAuth) {
    if (profileError) {
      const picked = await promptProfileSelect(profileError);
      if (picked) {
        // Re-run with the selected profile
        const newArgs = args.filter(a => !a.startsWith('--profile='));
        newArgs.push(`--profile=${picked}`);
        return run(newArgs, env, fetcher, configDir);
      }
    } else {
      process.stderr.write(
        'Error: Could not determine Jira profile. Use --profile=NAME or add projectPaths to ~/.ticketlens/profiles.json\n'
      );
    }
    process.exitCode = 1;
    return;
  }

  const jiraEnv = {
    JIRA_BASE_URL: conn.baseUrl,
    ...(conn.pat ? { JIRA_PAT: conn.pat } : { JIRA_EMAIL: conn.email, JIRA_API_TOKEN: conn.apiToken }),
  };

  // Cloud profiles use v3 API (v2 search is deprecated/410), Server stays on v2
  const apiVersion = conn.auth === 'cloud' ? 3 : 2;

  // Status resolution: --status flag > profile triageStatuses > defaults
  const statuses = statusArg
    ? statusArg.split('=')[1].split(',').map(s => s.trim())
    : conn.triageStatuses || DEFAULT_STATUSES;

  const session = createSession(conn);
  session.spin(`Connecting to ${session.label}…`);

  let currentUser;
  try {
    currentUser = await fetchCurrentUser({ env: jiraEnv, fetcher, apiVersion });
  } catch (err) {
    const classified = classifyError(err, conn);
    session.failed();
    session.footer(classified.message, 'error', classified.hint);
    process.exitCode = 1;
    return;
  }

  session.connected();
  process.stderr.write('\n');

  const statusList = statuses.map(s => `"${s}"`).join(',');
  const jql = `assignee = currentUser() AND status IN (${statusList}) ORDER BY updated DESC`;

  const scanSpinner = createSpinner('Scanning tickets…');
  scanSpinner.start();

  let tickets;
  try {
    tickets = await searchTickets(jql, { env: jiraEnv, fetcher, apiVersion });
  } catch (err) {
    scanSpinner.stop();
    if (err.status === 400 && err.detail && /does not exist for the field 'status'/.test(err.detail)) {
      process.stderr.write(`\nInvalid status in triage config. Fetching available statuses from Jira...\n\n`);
      try {
        const available = await fetchStatuses({ env: jiraEnv, fetcher, apiVersion });
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
    const classified = classifyError(err, conn);
    session.footer(classified.message, 'error', classified.hint);
    process.exitCode = 1;
    return;
  }

  scanSpinner.stop();

  const scored = tickets.map(t => scoreAttention(t, currentUser, { staleDays }));
  const actionable = scored.filter(s => s.urgency !== 'clear');
  const sorted = sortByUrgency(actionable);

  // Interactive mode: TTY + not --plain + not --static
  const wantInteractive = process.stdout.isTTY && !args.includes('--plain') && !args.includes('--static');
  if (wantInteractive && process.stdin.setRawMode) {
    await runInteractiveList(sorted, { baseUrl: conn.baseUrl, staleDays, styled: true });
    return;
  }

  const useStyled = args.includes('--styled') || (!args.includes('--plain') && process.stdout.isTTY);
  const summary = useStyled
    ? styleTriageSummary(sorted, { styled: true, staleDays, baseUrl: conn.baseUrl })
    : assembleTriageSummary(sorted, { staleDays, baseUrl: conn.baseUrl });
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
