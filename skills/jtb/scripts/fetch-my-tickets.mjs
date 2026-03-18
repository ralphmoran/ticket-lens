#!/usr/bin/env node

/**
 * CLI entry point: scans assigned tickets and surfaces what needs attention.
 * Usage: node fetch-my-tickets.mjs [--stale=N] [--status=X,Y] [--profile=NAME]
 */

import { fetchCurrentUser, searchTickets, fetchStatuses } from './lib/jira-client.mjs';
import { scoreAttention, sortByUrgency } from './lib/attention-scorer.mjs';
import { assembleTriageSummary } from './lib/brief-assembler.mjs';
import { styleTriageSummary } from './lib/styled-assembler.mjs';
import { resolveConnection, loadProfiles, saveProfile } from './lib/profile-resolver.mjs';
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
      const s = session.styler;
      const out = process.stderr;
      out.write(`\n  ${s.yellow('○')} Status mismatch — checking Jira...\n`);
      try {
        const available = await fetchStatuses({ env: jiraEnv, fetcher, apiVersion });
        const lowerMap = new Map(available.map(n => [n.toLowerCase(), n]));

        // Map each configured status to its best match (exact → case-insensitive → partial)
        const mappings = statuses.map(name => {
          if (available.includes(name)) return { input: name, fix: name, ok: true };
          const caseMatch = lowerMap.get(name.toLowerCase());
          if (caseMatch) return { input: name, fix: caseMatch, ok: false };
          const partial = available.find(a =>
            a.toLowerCase().includes(name.toLowerCase()) ||
            name.toLowerCase().startsWith(a.toLowerCase().split(' ')[0])
          );
          return { input: name, fix: partial || null, ok: false };
        });

        out.write('\n');
        for (const m of mappings) {
          if (m.ok)       out.write(`  ${s.green('✔')} ${m.input}\n`);
          else if (m.fix) out.write(`  ${s.yellow('~')} ${s.dim(m.input)}  →  ${s.cyan(m.fix)}\n`);
          else            out.write(`  ${s.red('✖')} ${m.input}  ${s.dim('(not found in this Jira instance)')}\n`);
        }

        const suggested = mappings.filter(m => m.fix).map(m => m.fix);

        // On TTY: offer to auto-fix the profile and re-run
        if (suggested.length > 0 && conn.profileName && out.isTTY && process.stdin.setRawMode) {
          out.write(`\n  Update ${s.cyan(`"${conn.profileName}"`)} with corrected statuses?  ${s.dim('y/N')}  `);
          const answer = await new Promise(res => {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.setEncoding('utf8');
            process.stdin.once('data', char => {
              process.stdin.setRawMode(false);
              process.stdin.pause();
              out.write('\n');
              if (char === '\x03') process.exit(0);
              res(char === 'y' || char === 'Y');
            });
          });
          if (answer) {
            const config = loadProfiles(configDir);
            if (config?.profiles[conn.profileName]) {
              const updated = { ...config.profiles[conn.profileName], triageStatuses: suggested };
              saveProfile(conn.profileName, updated, {}, configDir);
              out.write(`  ${s.green('✔')} Profile updated. Rerunning...\n\n`);
              return run(args, env, fetcher, configDir);
            }
          }
        }

        // Fallback: show compact fix hint
        if (suggested.length > 0) {
          out.write(`\n  ${s.dim('Suggested fix for')} ~/.ticketlens/profiles.json ${s.dim(`→ "${conn.profileName || 'your-profile'}"`)}\n`);
          out.write(`  ${s.cyan('"triageStatuses"')}: ${JSON.stringify(suggested)}\n\n`);
          out.write(`  ${s.dim('Or:')} ticketlens triage --status=${suggested.join(',')}\n`);
        }
      } catch {
        out.write(`\n  ${s.dim('Could not fetch available statuses.')}\n`);
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
    const result = await runInteractiveList(sorted, { baseUrl: conn.baseUrl, staleDays, styled: true });
    if (result === 'switch') {
      const cleanArgs = args.filter(a => !a.startsWith('--profile=') && !a.startsWith('--project='));
      return run(cleanArgs, env, fetcher, configDir);
    }
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
