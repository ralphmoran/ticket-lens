#!/usr/bin/env node

/**
 * CLI entry point: scans assigned tickets and surfaces what needs attention.
 * Usage: node fetch-my-tickets.mjs [--stale=N] [--status=X,Y] [--profile=NAME]
 */

import { scoreAttention, sortByUrgency } from './lib/attention-scorer.mjs';
import { assembleTriageSummary } from './lib/brief-assembler.mjs';
import { styleTriageSummary } from './lib/styled-assembler.mjs';
import { resolveConnection, loadProfiles, saveProfile } from './lib/profile-resolver.mjs';
import { resolveAdapter } from './lib/resolve-adapter.mjs';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { createSpinner } from './lib/spinner.mjs';
import { createSession } from './lib/banner.mjs';
import { classifyError } from './lib/error-classifier.mjs';
import { runInteractiveList } from './lib/interactive-list.mjs';
import { promptProfileSelect } from './lib/profile-picker.mjs';
import { printTriageHelp } from './lib/help.mjs';
import { handleUnknownFlags } from './lib/arg-validator.mjs';
import { isLicensed, showUpgradePrompt, revalidateIfStale } from './lib/license.mjs';
import { readCliToken } from './lib/cli-auth.mjs';
import { apiBase } from './lib/api-utils.mjs';
import { stripAnsi, bold, cyan, dim, red, green } from './lib/ansi.mjs';

const DEFAULT_STATUSES = ['In Progress', 'Code Review', 'QA'];

async function defaultDigestDeliverer(payload, { cliToken } = {}) {
  const res = await fetch(`${apiBase()}/v1/digest/deliver`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cliToken}`,
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Digest delivery failed: ${res.status}`);
  return true;
}

function escapeJql(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export async function run(args, envOrOpts = process.env, fetcher = globalThis.fetch, configDir = undefined) {
  // Support both legacy positional form run(args, env, fetcher, configDir)
  // and new opts-object form run(args, { env, fetcher, configDir, exporter, isLicensed, showUpgradePrompt, print })
  let env, opts;
  if (envOrOpts && typeof envOrOpts === 'object' && 'env' in envOrOpts) {
    opts = envOrOpts;
    env = opts.env ?? process.env;
    fetcher = opts.fetcher ?? globalThis.fetch;
    configDir = opts.configDir ?? undefined;
  } else {
    opts = {};
    env = envOrOpts;
  }

  // Strip leading 'triage' subcommand if present (when called via CLI router)
  if (args[0] === 'triage') args = args.slice(1);

  if (args.includes('--help') || args.includes('-h')) {
    printTriageHelp();
    return;
  }
  const profileArg = args.find(a => a.startsWith('--profile='));
  const profileName = profileArg ? profileArg.split('=')[1] : undefined;

  const validatedArgs = await handleUnknownFlags(
    args,
    ['--help', '-h', '--static', '--plain', '--styled', '--profile=', '--stale=', '--status=',
     '--assignee=', '--sprint=', '--export=', '--digest', '--push', '--share', '--all', '--save=',
     '--project=', '--label=', '--priority='],
    { hints: ['--depth=', '--no-attachments', '--no-cache'] }
  );
  if (validatedArgs === null) { process.exitCode = 1; return; }
  args = validatedArgs;

  // Fire-and-forget: silently refresh license.json if >7 days since last validation
  revalidateIfStale({ configDir, fetcher });

  const staleArg = args.find(a => a.startsWith('--stale='));
  const staleDays = staleArg ? parseInt(staleArg.split('=')[1], 10) : 5;

  const statusArg   = args.find(a => a.startsWith('--status='));
  const assigneeArg = args.find(a => a.startsWith('--assignee='));
  const sprintArg   = args.find(a => a.startsWith('--sprint='));
  const projectArg  = args.find(a => a.startsWith('--project='));
  const labelArg    = args.find(a => a.startsWith('--label='));
  const priorityArg = args.find(a => a.startsWith('--priority='));
  const exportArg = args.find(a => a.startsWith('--export='))?.split('=')[1] ?? null;
  const digestFlag = args.includes('--digest');
  const pushFlag = args.includes('--push');
  const shareFlag = args.includes('--share');
  const allFlag = args.includes('--all');
  const saveArg = args.find(a => a.startsWith('--save='))?.split('=').slice(1).join('=') ?? null;

  if (exportArg && exportArg !== 'csv' && exportArg !== 'json') {
    process.stderr.write(`Error: --export must be csv or json, got: ${exportArg}\n`);
    process.exitCode = 1;
    return;
  }

  const licensedFn = opts.isLicensed ?? isLicensed;
  const upgradeFn = opts.showUpgradePrompt ?? showUpgradePrompt;

  // --save=FILE: Pro gate + validate path is not a directory
  if (saveArg) {
    if (!licensedFn('pro', configDir)) {
      upgradeFn('pro', '--save');
      process.exitCode = 1;
      return;
    }
    const resolvedSave = resolvePath(saveArg);
    try {
      if (statSync(resolvedSave).isDirectory()) {
        process.stderr.write(`Error: --save path must be a file, not a directory: ${resolvedSave}\n`);
        process.exitCode = 1;
        return;
      }
    } catch { /* doesn't exist yet — ok */ }
  }

  // --project / --label / --priority: Team gate
  if (projectArg || labelArg || priorityArg) {
    if (!licensedFn('team', configDir)) {
      const flag = projectArg ? '--project' : labelArg ? '--label' : '--priority';
      upgradeFn('team', flag);
      process.exitCode = 1;
      return;
    }
  }

  // --all: triage all configured profiles in parallel with live status block
  if (allFlag) {
    if (!licensedFn('pro', configDir)) {
      upgradeFn('pro', '--all');
      process.exitCode = 1;
      return;
    }
    const profilesConfig = loadProfiles(configDir);
    const profileNames = profilesConfig?.profiles ? Object.keys(profilesConfig.profiles) : [];
    if (profileNames.length === 0) {
      process.stderr.write('Error: No profiles configured. Run `ticketlens init` first.\n');
      process.exitCode = 1;
      return;
    }

    const usePlain = args.includes('--plain');
    const printFn = opts.print ?? ((s) => process.stdout.write(s));
    const argsBase = args.filter(a => a !== '--all' && !a.startsWith('--profile='));
    // --static disables interactive mode in sub-runs (isTTY is still true but we're capturing output)
    const modeFlags = usePlain ? ['--plain'] : ['--styled', '--static'];
    const isTTY = process.stderr.isTTY;
    const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const COL = Math.max(...profileNames.map(n => n.length)) + 2;

    // Per-profile state
    const entries = profileNames.map(name => ({ name, state: 'pending', output: [], summary: '' }));

    const statusLine = (e, frame = 0) => {
      const nameCol = e.name.padEnd(COL);
      if (e.state === 'pending') return `  ${SPIN[frame % SPIN.length]} ${nameCol}${dim('fetching...')}`;
      if (e.state === 'done')    return `  ${green('✔')} ${nameCol}${dim(e.summary)}`;
      return                            `  ${red('✗')} ${nameCol}${dim('could not connect')}`;
    };

    // Suppress all sub-run stderr so banners/spinners don't corrupt the status block.
    // Status updates bypass suppression via `toStatus` which holds the original reference.
    const toStatus = isTTY ? process.stderr.write.bind(process.stderr) : null;
    if (isTTY) {
      process.stderr.write = () => true;  // silence sub-runs
      toStatus('\x1b[?25l');
      for (const e of entries) toStatus(statusLine(e) + '\n');
    }

    let frame = 0;
    const timer = isTTY ? setInterval(() => {
      frame++;
      toStatus(`\x1b[${entries.length}A`);
      for (const e of entries) toStatus(`\r\x1b[K${statusLine(e, frame)}\n`);
    }, 80) : null;

    await Promise.allSettled(entries.map((e, idx) =>
      run([...argsBase, `--profile=${e.name}`, ...modeFlags],
          { ...opts, env, fetcher, configDir, print: s => e.output.push(s) })
        .then(() => {
          const combined = e.output.join('');
          const m = combined.match(/(\d+) found/);
          entries[idx].state   = e.output.length === 0 ? 'error' : 'done';
          entries[idx].summary = m ? `${m[1]} ticket${m[1] === '1' ? '' : 's'}` : 'done';
        })
        .catch(() => { entries[idx].state = 'error'; })
    ));

    if (isTTY) {
      clearInterval(timer);
      toStatus(`\x1b[${entries.length}A`);
      for (const e of entries) toStatus(`\r\x1b[K${statusLine(e)}\n`);
      toStatus('\x1b[?25h\n');
      process.stderr.write = toStatus;  // restore
    }

    // Render results in profile order
    for (const e of entries) {
      printFn(usePlain
        ? `\n── ${e.name} ──\n`
        : `\n${dim('──')} ${bold(cyan(e.name))} ${dim('──')}\n`);

      if (e.output.length === 0) {
        const hint = `ticketlens triage --profile=${e.name}`;
        printFn(usePlain
          ? `  [could not connect — run: ${hint}]\n`
          : `  ${red('✗')} ${dim('Could not connect — run')} ${cyan(hint)} ${dim('for details')}\n`);
      } else {
        printFn(e.output.join(''));
      }
    }
    return;
  }

  // Team-tier gate: --assignee and --sprint require a Team license
  if ((assigneeArg || sprintArg) && !licensedFn('team', configDir)) {
    upgradeFn('team', assigneeArg ? '--assignee' : '--sprint');
    process.exitCode = 1;
    return;
  }

  // Team-tier gate: --export requires a Team license
  if (exportArg && !licensedFn('team', configDir)) {
    upgradeFn('team', '--export');
    process.exitCode = 1;
    return;
  }

  const assigneeName = assigneeArg ? assigneeArg.split('=').slice(1).join('=') : null;
  const sprintName   = sprintArg   ? sprintArg.split('=').slice(1).join('=')   : null;

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
        return run(newArgs, { ...opts, env, fetcher, configDir });
      }
    } else {
      const noProfiles = !loadProfiles(configDir)?.profiles;
      const msg = noProfiles
        ? 'Error: Could not determine Jira profile.\nRun `ticketlens init` to set up your connection.'
        : 'Error: Could not determine Jira profile. Use --profile=NAME or add projectPaths to ~/.ticketlens/profiles.json';
      process.stderr.write(msg + '\n');
    }
    process.exitCode = 1;
    return;
  }

  const adapter = resolveAdapter(conn, { fetcher });

  // Status resolution: --status flag > profile triageStatuses > defaults
  const statuses = statusArg
    ? statusArg.split('=')[1].split(',').map(s => s.trim())
    : conn.triageStatuses || DEFAULT_STATUSES;

  // Build JQL before any I/O — pure computation, no dependency on currentUser
  const statusList     = statuses.map(s => `"${escapeJql(s)}"`).join(',');
  const assigneeClause = assigneeName ? `assignee = "${escapeJql(assigneeName)}"` : `assignee = currentUser()`;
  const sprintClause   = sprintName   ? ` AND sprint = "${escapeJql(sprintName)}"` : '';
  const projectClause  = projectArg   ? ` AND project = "${escapeJql(projectArg.split('=')[1])}"` : '';
  const labelValues    = labelArg ? labelArg.split('=')[1].split(',').map(l => l.trim()).filter(Boolean) : [];
  const labelClause    = labelValues.length > 1
    ? ` AND labels IN (${labelValues.map(l => `"${escapeJql(l)}"`).join(',')})`
    : labelValues.length === 1 ? ` AND labels = "${escapeJql(labelValues[0])}"` : '';
  const priorityClause = priorityArg  ? ` AND priority = "${escapeJql(priorityArg.split('=')[1])}"` : '';
  const jql = `${assigneeClause} AND status IN (${statusList})${sprintClause}${projectClause}${labelClause}${priorityClause} ORDER BY updated DESC`;

  const session = createSession(conn);
  session.spin(`Connecting to ${session.label}…`);

  // Fire both requests concurrently — they are independent of each other
  const userPromise = adapter.fetchCurrentUser();
  const ticketsPromise = adapter.searchTickets(jql);

  let currentUser;
  try {
    currentUser = await userPromise;
  } catch (err) {
    ticketsPromise.catch(() => {}); // prevent unhandled rejection — we're bailing on the user request
    const classified = classifyError(err, conn);
    session.failed();
    session.footer(classified.message, 'error', classified.hint);
    process.exitCode = 1;
    return;
  }

  session.connected();
  process.stderr.write('\n');

  const scanSpinner = createSpinner('Scanning tickets…');
  scanSpinner.start();

  let tickets;
  try {
    tickets = await ticketsPromise;
  } catch (err) {
    scanSpinner.stop();
    if (err.status === 400 && err.detail && /does not exist for the field 'status'/.test(err.detail)) {
      const s = session.styler;
      const out = process.stderr;
      out.write(`\n  ${s.yellow('○')} Status mismatch — checking Jira...\n`);
      try {
        const available = await adapter.fetchStatuses();
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
              const existing = config.profiles[conn.profileName].triageStatuses || [];
              const merged = [...new Set([...existing, ...suggested])];
              const updated = { ...config.profiles[conn.profileName], triageStatuses: merged };
              saveProfile(conn.profileName, updated, {}, configDir);
              out.write(`  ${s.green('✔')} Profile updated. Rerunning...\n\n`);
              // Strip --status flag so the re-run uses the corrected profile statuses
              const rerunArgs = args.filter(a => !a.startsWith('--status='));
              return run(rerunArgs, { ...opts, env, fetcher, configDir });
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

  // When viewing another dev's tickets, score from their perspective (they need to respond)
  const effectiveUser = assigneeName
    ? { displayName: assigneeName, name: null, accountId: null, emailAddress: null }
    : currentUser;

  if (assigneeName) {
    process.stderr.write(`Viewing ${assigneeName}'s tickets\n\n`);
  }

  const scored = tickets.map(t => scoreAttention(t, effectiveUser, { staleDays, customRules: conn.attentionRules }));
  const actionable = scored.filter(s => s.urgency !== 'clear' && s.urgency !== 'ignore');
  const sorted = sortByUrgency(actionable);
  const rawTicketMap = new Map(tickets.map(t => [t.key, t]));

  // Always save a daily snapshot for history tracking (non-fatal)
  try {
    const { saveTriageSnapshot } = await import('./lib/triage-history.mjs');
    saveTriageSnapshot(scored, { profile: profileName ?? 'default', configDir });
  } catch { /* non-fatal */ }

  // --digest: POST scored results to the digest backend endpoint
  if (digestFlag) {
    if (!licensedFn('pro', configDir)) {
      upgradeFn('pro', '--digest');
      process.exitCode = 1;
      return;
    }
    const deliverer = opts.digestDeliverer ?? defaultDigestDeliverer;
    const digestCliToken = opts.cliToken ?? readCliToken(configDir) ?? null;

    // Triage history delta (non-fatal — snapshot already saved above)
    let delta = null;
    try {
      const { loadYesterdaySnapshot, diffSnapshots, buildDeltaSection } =
        await import('./lib/triage-history.mjs');
      const yesterday = loadYesterdaySnapshot({ profile: profileName ?? 'default', configDir });
      if (yesterday) {
        const deltas = diffSnapshots(sorted, yesterday.tickets);
        delta = buildDeltaSection(deltas) || null;
      }
    } catch { /* non-fatal — digest still sends */ }

    await deliverer({
      profile: profileName ?? 'default',
      staleDays,
      summary: (() => {
        let needsResponse = 0, aging = 0;
        for (const t of sorted) {
          if (t.urgency === 'needs-response') needsResponse++;
          else if (t.urgency === 'aging') aging++;
        }
        return { total: sorted.length, needsResponse, aging };
      })(),
      tickets: sorted,
      delta,
    }, { cliToken: digestCliToken });
    return;
  }

  // --export: write results to file instead of (or in addition to) printing
  if (exportArg) {
    const { exportTriage } = await import('./lib/triage-exporter.mjs');
    const exporterFn = opts.exporter ?? exportTriage;
    const outputPath = await Promise.resolve(exporterFn({ tickets: sorted, format: exportArg, profile: profileName ?? 'default', configDir }));
    const printFn = opts.print ?? ((msg) => process.stdout.write(msg + '\n'));
    printFn(`Export written to ${outputPath}`);
    return;
  }

  // push/share run first so their result is visible before (or instead of) the TUI
  if (pushFlag) {
    const { pushTriageSnapshot } = await import('./lib/triage-push.mjs');
    const { scanCurrentBranch } = await import('./lib/branch-scanner.mjs');
    const pushFn = opts.pushFn ?? pushTriageSnapshot;
    const scanFn = opts.scanFn ?? scanCurrentBranch;
    const cliToken = opts.cliToken ?? readCliToken(configDir) ?? null;
    const printFn = opts.print ?? ((s) => process.stdout.write(s));
    await pushFn({
      sorted,
      rawTicketMap,
      profile: profileName ?? 'default',
      baseUrl: conn.baseUrl,
      cliToken,
      gitBranches: scanFn(),
      fetcher,
      print: printFn,
    });
  }

  if (shareFlag) {
    const { shareTriageSnapshot } = await import('./lib/triage-share.mjs');
    const shareFn = opts.shareFn ?? shareTriageSnapshot;
    const cliToken = opts.cliToken ?? readCliToken(configDir) ?? null;
    const printFn = opts.print ?? ((s) => process.stdout.write(s));
    await shareFn({
      sorted,
      rawTicketMap,
      profile: profileName ?? 'default',
      baseUrl: conn.baseUrl,
      cliToken,
      fetcher,
      print: printFn,
    });
  }

  // Interactive mode: TTY + not --plain + not --static
  const wantInteractive = process.stdout.isTTY && !args.includes('--plain') && !args.includes('--static') && !saveArg;
  if (wantInteractive && process.stdin.setRawMode) {
    const result = await runInteractiveList(sorted, { baseUrl: conn.baseUrl, staleDays, styled: true });
    if (result === 'switch') {
      const cleanArgs = args.filter(a => !a.startsWith('--profile=') && !a.startsWith('--project='));
      return run(cleanArgs, { ...opts, env, fetcher, configDir });
    }
    return;
  }

  const useStyled = args.includes('--styled') || (!args.includes('--plain') && process.stdout.isTTY);
  const summary = useStyled
    ? styleTriageSummary(sorted, { styled: true, staleDays, baseUrl: conn.baseUrl })
    : assembleTriageSummary(sorted, { staleDays, baseUrl: conn.baseUrl });

  // --save=FILE: write ANSI-stripped output to file
  if (saveArg) {
    const resolvedSave = resolvePath(saveArg);
    mkdirSync(dirname(resolvedSave), { recursive: true });
    const plain = stripAnsi(summary);
    writeFileSync(resolvedSave, plain + '\n', 'utf8');
  }

  const printFn = opts.print ?? ((s) => process.stdout.write(s));
  printFn(summary + '\n');

  // Inline stats footer — shown when ≥2 triage runs exist (non-fatal)
  try {
    const metricsInjector = opts.metricsInjector;
    let metrics;
    if (metricsInjector) {
      metrics = metricsInjector();
    } else {
      const { computeResponseMetrics } = await import('./lib/triage-history.mjs');
      metrics = computeResponseMetrics(profileName ?? 'default', { days: 7, configDir });
    }
    // Only show footer when there's a meaningful metric to display
    const hasAvg = metrics && metrics.avgResponseHours !== null;
    const hasClearRate = metrics && metrics.clearRate !== null;
    if (metrics && metrics.triageRunCount >= 2 && (hasAvg || hasClearRate)) {
      const usePlain = args.includes('--plain') || !process.stdout.isTTY;
      const runs = metrics.triageRunCount;

      let part;
      if (hasAvg && hasClearRate) {
        part = `avg ${metrics.avgResponseHours.toFixed(1)}h response · ${Math.round(metrics.clearRate * 100)}% cleared within 24h (${runs} runs)`;
      } else if (hasAvg) {
        part = `avg ${metrics.avgResponseHours.toFixed(1)}h response (${runs} runs)`;
      } else {
        part = `${Math.round(metrics.clearRate * 100)}% cleared within 24h (${runs} runs)`;
      }

      if (usePlain) {
        printFn(`── This week: ${part} ──\n`);
      } else {
        const { dim, bold: boldFn, cyan } = await import('./lib/ansi.mjs');
        let styledPart;
        if (hasAvg && hasClearRate) {
          styledPart = `avg ${boldFn(cyan(metrics.avgResponseHours.toFixed(1) + 'h'))} response · ${boldFn(Math.round(metrics.clearRate * 100) + '%')} cleared within 24h (${runs} runs)`;
        } else if (hasAvg) {
          styledPart = `avg ${boldFn(cyan(metrics.avgResponseHours.toFixed(1) + 'h'))} response (${runs} runs)`;
        } else {
          styledPart = `${boldFn(Math.round(metrics.clearRate * 100) + '%')} cleared within 24h (${runs} runs)`;
        }
        printFn(`${dim('──')} This week: ${styledPart} ${dim('──')}\n`);
      }
    }
  } catch { /* non-fatal */ }
}

// Run if invoked directly
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''));
if (isMain) {
  run(process.argv.slice(2)).catch(err => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
  });
}
