#!/usr/bin/env node

/**
 * CLI entry point: fetches a Jira ticket and outputs a TicketBrief to stdout.
 * Usage: node fetch-ticket.mjs TICKET-KEY [--depth=N] [--profile=NAME]
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractCodeReferences } from './lib/code-ref-parser.mjs';
import { assembleBrief } from './lib/brief-assembler.mjs';
import { styleBrief } from './lib/styled-assembler.mjs';
import { resolveConnection, loadProfiles, loadCredentials, saveProfile } from './lib/profile-resolver.mjs';
import { buildJiraEnv } from './lib/config.mjs';
import { resolveAdapter } from './lib/resolve-adapter.mjs';
import { createSession } from './lib/banner.mjs';
import { classifyError } from './lib/error-classifier.mjs';
import { promptProfileSelect, promptProfileMismatch, promptSwitchProfile, promptMultipleMatches } from './lib/profile-picker.mjs';
import { promptSelect } from './lib/select-prompt.mjs';
import { printFetchHelp } from './lib/help.mjs';
import { handleUnknownFlags } from './lib/arg-validator.mjs';
import { TICKET_KEY_PATTERN } from './lib/cli.mjs';
import { downloadAttachments } from './lib/attachment-downloader.mjs';
import { readBriefCache, writeBriefCache, briefCacheAge, BRIEF_TTL_MS } from './lib/brief-cache.mjs';
import { parseAge } from './lib/cache-manager.mjs';
import { createStyler } from './lib/ansi.mjs';
import { isLicensed, showUpgradePrompt, readLicense } from './lib/license.mjs';
import { detectVcs } from './lib/vcs-detector.mjs';
import { runComplianceCheck } from './lib/compliance-checker.mjs';
import { fetchRemoteLinks, buildAuthHeader } from './lib/jira-client.mjs';
import { fetchConfluencePage } from './lib/confluence-client.mjs';

/**
 * Get the local diff using spawn with explicit arg arrays (never shell interpolation).
 * @param {string} [cwd]
 * @returns {string|null}
 */
function getDiff(cwd = process.cwd()) {
  const vcsResult = detectVcs(cwd);
  const vcs = typeof vcsResult === 'string' ? vcsResult : vcsResult.type;
  if (vcs === 'none') return null;

  const commands = {
    git: ['git', ['diff', 'HEAD']],
    svn: ['svn', ['diff']],
    hg:  ['hg',  ['diff']],
  };
  const entry = commands[vcs];
  if (!entry) return null;
  const [cmd, args] = entry;

  const which = spawnSync('which', [cmd], { encoding: 'utf8' });
  if (which.status !== 0 || !which.stdout.trim()) return null;

  const result = spawnSync(which.stdout.trim(), args, { cwd, encoding: 'utf8', timeout: 10_000 });
  return result.status === 0 ? (result.stdout || null) : null;
}

/**
 * Append --check section (diff + instructions) to a brief string.
 * @param {string} brief
 * @param {object} opts  — may contain detectVcs and getDiff overrides
 * @returns {string}
 */
function applyCheck(brief, opts) {
  const vcsDetector = opts.detectVcs ?? ((cwd) => { const r = detectVcs(cwd); return typeof r === 'string' ? r : r.type; });
  const diffRunner  = opts.getDiff   ?? getDiff;
  const vcs = vcsDetector(process.cwd());

  if (vcs === 'none') {
    brief += '\n\n⚠  No VCS detected in this directory.\n   Claude Code will evaluate coverage using this session\'s context.\n';
    brief += '\n--- CHECK INSTRUCTIONS ---\n';
    brief += 'No diff available. Use session context, claude-mem, context7, or fs.stat() fallback to evaluate coverage.\n';
    return brief;
  }

  const diff = diffRunner(process.cwd());
  if (diff) brief += '\n\n--- DIFF ---\n' + diff;
  brief += '\n--- CHECK INSTRUCTIONS ---\n';
  brief += 'Identify acceptance criteria from the ticket above. Evaluate whether the diff covers each one.\n';
  brief += 'Report: ✔ FOUND (with file:line reference) or ✗ NOT FOUND. Show coverage percentage.\n';
  return brief;
}

function hasCloudConsent(configDir, profileName) {
  try {
    const data = JSON.parse(readFileSync(`${configDir}/profiles.json`, 'utf8'));
    return data.profiles?.[profileName]?.cloudSummarizeConsent === true;
  } catch { return false; }
}

function saveCloudConsent(configDir, profileName) {
  try {
    const config = loadProfiles(configDir);
    if (!config?.profiles[profileName]) return;
    saveProfile(profileName, { ...config.profiles[profileName], cloudSummarizeConsent: true }, null, configDir);
  } catch { /* non-fatal */ }
}

/**
 * Apply --summarize to a brief string.
 * Returns the modified brief, or null if the caller should exit (license gate / consent refused).
 */
async function applySummarize(brief, args, opts, configDir, conn, licensedFn, upgradeFn) {
  if (!licensedFn('pro', configDir)) {
    upgradeFn('pro', '--summarize');
    process.exitCode = 1;
    return null;
  }

  const mode = args.includes('--cloud') ? 'cloud' : 'byok';
  const profileName = conn.profileName ?? 'default';

  // Cloud consent check (skipped when summarizer is injected, e.g. tests)
  if (mode === 'cloud' && !opts.summarizer && !hasCloudConsent(configDir, profileName)) {
    let consentGiven = !process.stdin.isTTY;
    if (!consentGiven && process.stdout.isTTY) {
      process.stdout.write(
        '\n  Cloud summary sends your ticket content to api.ticketlens.dev for processing.\n' +
        '  TicketLens calls Claude and returns a summary. No data stored after the request.\n' +
        '  Proceed? (y/N) '
      );
      const rl = (await import('node:readline')).createInterface({ input: process.stdin, output: process.stdout });
      consentGiven = await new Promise(resolve => rl.question('', ans => { rl.close(); resolve(ans.trim().toLowerCase() === 'y'); }));
    }
    if (!consentGiven) { process.exitCode = 1; return null; }
    saveCloudConsent(configDir, profileName);
  }

  try {
    const summarizerFn = opts.summarizer ?? (async (sumOpts) => {
      const { summarize } = await import('./lib/summarizer.mjs');
      return summarize(sumOpts);
    });
    const credentials = opts.credentials ?? loadCredentials(configDir);
    const licenseKey = readLicense(configDir)?.key;
    const summary = await summarizerFn({ brief, mode, credentials, licenseKey });
    const divider = '─'.repeat(60);
    return brief + `\n\n${divider}\n─── AI Summary ${'─'.repeat(45)}\n${summary}\n${divider}\n`;
  } catch (err) {
    const onErrorFn = opts.onError ?? ((msg) => process.stderr.write(msg + '\n'));
    onErrorFn(`Could not generate summary: ${err.message}`);
    return brief;
  }
}

function makeSpinner(s) {
  if (!process.stderr.isTTY) return { update: () => {}, done: () => {} };
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i = 0, msg = 'Working…', finished = false;
  const id = setInterval(() => {
    process.stderr.write(`\r  ${s.brand(frames[i++ % frames.length])} ${s.dim(msg)}`);
  }, 80);
  return {
    update(m) { if (!finished) msg = m; },
    done() {
      if (finished) return;
      finished = true;
      clearInterval(id);
      process.stderr.write('\r\x1b[2K');
    },
  };
}

function styleReviewMd(md, s) {
  if (!s.enabled) return md;
  const lines = md.split('\n');
  const out = [];
  let section = '';

  for (const line of lines) {
    if (line === '## PR Review Context') {
      out.push('');
      out.push(`  ${s.brand(s.bold('◆  PR Review Context'))}`);
      out.push(`  ${s.dim('─'.repeat(50))}`);
      section = 'header';
      continue;
    }

    if (line.startsWith('### ')) {
      const title = line.slice(4);
      const fm = title.match(/^Changed files \((\d+)\)$/);
      if (fm) {
        out.push('');
        out.push(`  ${s.bold('Changed files')} ${s.dim('(')}${s.yellow(fm[1])}${s.dim(')')}`);
        section = 'changed-files';
        continue;
      }
      const icons = { Branch: '⎇  ', 'Ticket context': '◉  ', 'Requirements coverage': '✦  ', 'Review focus': '▲  ' };
      const icon = icons[title] ?? '';
      out.push('');
      out.push(`  ${s.bold(icon + title)}`);
      section = title.toLowerCase().replace(/\s+/g, '-');
      continue;
    }

    if (line.startsWith('#### ')) {
      const inner = line.slice(5);
      const covM = inner.match(/^([A-Z][A-Z0-9]+-\d+) \((\d+)%\)$/);
      if (covM) {
        const pct = parseInt(covM[2], 10);
        const pctFmt = pct >= 75 ? s.green(`${pct}%`) : pct >= 50 ? s.yellow(`${pct}%`) : s.red(`${pct}%`);
        out.push(`  ${s.cyan(s.bold(covM[1]))}  ${s.dim('coverage:')} ${pctFmt}`);
        continue;
      }
      const tkM = inner.match(/^([A-Z][A-Z0-9]+-\d+)[: —–-]+(.*)$/);
      if (tkM) {
        out.push('');
        out.push(`  ${s.cyan(s.bold(tkM[1]))}  ${s.dim(tkM[2].trim())}`);
        continue;
      }
      out.push(line);
      continue;
    }

    if (line.match(/^`[^`]+` → `[^`]+`$/)) {
      const [h, b] = line.split(' → ');
      out.push(`  ${s.cyan(h.replace(/`/g, ''))}  ${s.dim('→')}  ${s.dim(b.replace(/`/g, ''))}`);
      continue;
    }
    if (line.match(/^→ `[^`]+`$/)) {
      out.push(`  ${s.dim('(detached HEAD)')}  ${s.dim('→')}  ${s.dim(line.slice(4).replace(/`/g, ''))}`);
      continue;
    }

    if (line.startsWith('- ✔ ')) {
      const text = line.slice(4);
      const di = text.lastIndexOf(' — ');
      if (di > 0) out.push(`  ${s.green('✔')} ${text.slice(0, di)}${s.dim(' — ' + text.slice(di + 3))}`);
      else out.push(`  ${s.green('✔')} ${text}`);
      continue;
    }
    if (line.startsWith('- ✖ ')) { out.push(`  ${s.red('✖')} ${line.slice(4)}`); continue; }
    if (line.startsWith('- ~ '))  { out.push(`  ${s.yellow('~')} ${s.dim(line.slice(4))}`); continue; }

    if (line.startsWith('- ')) {
      out.push(section === 'changed-files'
        ? `  ${s.dim('·')} ${s.dim(line.slice(2))}`
        : `  ${s.dim('·')} ${line.slice(2)}`);
      continue;
    }

    if (line.startsWith('_') && line.endsWith('_') && line.length > 2) {
      const inner = line.slice(1, -1);
      if (inner.includes('No linked tickets found')) {
        out.push(`  ${s.yellow('○')}  ${s.dim(inner)}`);
      } else if (inner.includes('Requirements coverage analysis requires')) {
        out.push(`  ${s.yellow('⚡')} ${s.dim(inner)}`);
      } else if (inner.includes('Generated by TicketLens')) {
        out.push(s.dim(inner));
      } else {
        out.push(`  ${s.dim(inner)}`);
      }
      continue;
    }

    if (line === '---') { out.push(`  ${s.dim('─'.repeat(50))}`); continue; }

    out.push(line);
  }

  return out.join('\n');
}

const RETRY_OPTIONS = [
  { label: 'Retry',          sublabel: 'Try again — e.g. VPN just connected', value: 'retry'  },
  { label: 'Switch profile', sublabel: 'Use a different Jira profile',         value: 'switch' },
  { label: 'Cancel',         sublabel: '',                                      value: 'cancel' },
];

export async function run(args, envOrOpts = process.env, fetcher = globalThis.fetch, configDir = undefined) {
  // Support opts-object injection: run(args, { env, fetcher, configDir, detectVcs, getDiff, print })
  let env, opts;
  if (envOrOpts && typeof envOrOpts === 'object' && !Array.isArray(envOrOpts) && ('env' in envOrOpts || 'fetcher' in envOrOpts || 'print' in envOrOpts || 'detectVcs' in envOrOpts || 'getDiff' in envOrOpts)) {
    opts = envOrOpts;
    env = opts.env ?? process.env;
    fetcher = opts.fetcher ?? globalThis.fetch;
    configDir = opts.configDir ?? undefined;
  } else {
    opts = {};
    env = envOrOpts;
  }

  const printFn = opts.print ?? ((chunk) => process.stdout.write(chunk));

  if (args.includes('--help') || args.includes('-h')) {
    printFetchHelp();
    return;
  }

  // Early dispatch for non-ticket subcommands
  if (args[0] === 'install-hooks') {
    const { installHook } = await import('./lib/hook-installer.mjs');
    try {
      const result = await installHook({ cwd: process.cwd() });
      if (result.skipped) {
        process.stderr.write(`  Hook install skipped: ${result.reason}\n`);
      } else {
        process.stdout.write(`  Hook installed: ${result.path} (threshold: 80%)\n`);
      }
    } catch (err) {
      process.stderr.write(`  Error installing hook: ${err.message}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (args[0] === 'pr') {
    const { assemblePr } = await import('./lib/pr-assembler.mjs');
    const ticketKeyArg = args[1];
    if (!ticketKeyArg) {
      process.stderr.write('Error: "pr" requires a ticket key. Usage: ticketlens pr PROJ-123\n');
      process.exitCode = 1;
      return;
    }
    if (!TICKET_KEY_PATTERN.test(ticketKeyArg)) {
      process.stderr.write(`Error: "${ticketKeyArg}" is not a valid ticket key. Expected format: PROJ-123\n`);
      process.exitCode = 1;
      return;
    }
    const resolvedConfigDir = configDir ?? (await import('./lib/config.mjs')).DEFAULT_CONFIG_DIR;

    // Resolve connection (same pattern as compliance dispatch)
    const profileArgPr = args.find(a => a.startsWith('--profile='));
    const profileNamePr = profileArgPr ? profileArgPr.split('=')[1] : undefined;
    const connPr = resolveConnection(ticketKeyArg, {
      env,
      configDir: resolvedConfigDir,
      profileName: profileNamePr,
      cwd: process.cwd(),
      onWarning: (w) => process.stderr.write(w + '\n'),
      onProfileNotFound: () => {},
    });

    const hasAuthPr = connPr.pat || (connPr.email && connPr.apiToken);
    if (!connPr.baseUrl || !hasAuthPr) {
      process.stderr.write('Error: No Jira credentials found. Run \'ticketlens init\' or set JIRA_BASE_URL + JIRA_API_TOKEN.\n');
      process.exitCode = 1;
      return;
    }

    const adapterPr = resolveAdapter(connPr, { fetcher });

    try {
      const md = await assemblePr(ticketKeyArg, {
        configDir: resolvedConfigDir,
        fetchTicketFn: (key, fOpts = {}) => adapterPr.fetchTicket(key, fOpts),
      });
      printFn(md + '\n');
    } catch (err) {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exitCode = 1;
    }
    return;
  }

  if (args[0] === 'ledger') {
    const { exportLedger } = await import('./lib/ledger.mjs');
    const { isLicensed: isLic, showUpgradePrompt: showUpgrade } = await import('./lib/license.mjs');
    const resolvedConfigDir = configDir ?? (await import('./lib/config.mjs')).DEFAULT_CONFIG_DIR;
    if (!isLic('pro', resolvedConfigDir)) {
      showUpgrade('pro', 'ledger', { stream: process.stderr });
      process.exitCode = 1;
      return;
    }
    const formatArg = args.slice(1).find(a => a.startsWith('--format='));
    const format = formatArg ? formatArg.split('=')[1] : 'json';
    const result = exportLedger(format, { configDir: resolvedConfigDir });
    if (format === 'csv') {
      printFn(result + '\n');
    } else {
      printFn(JSON.stringify(result, null, 2) + '\n');
      process.stderr.write('  Verify signature: HMAC-SHA256 over {records, exportedAt} with key at ledger-key\n');
    }
    return;
  }

  if (args[0] === 'compliance') {
    const ticketKeyArg = args[1];
    if (!ticketKeyArg) {
      process.stderr.write('Error: "compliance" requires a ticket key. Usage: ticketlens compliance PROJ-123\n');
      process.exitCode = 1;
      return;
    }
    if (!TICKET_KEY_PATTERN.test(ticketKeyArg)) {
      process.stderr.write(`Error: "${ticketKeyArg}" is not a valid ticket key. Expected format: PROJ-123\n`);
      process.exitCode = 1;
      return;
    }

    const resolvedConfigDir = configDir ?? (await import('./lib/config.mjs')).DEFAULT_CONFIG_DIR;

    // Read threshold from .ticketlens-hooks.json (written by install-hooks); default 80%
    let threshold = 80;
    const cwdForHooks = opts.cwdForHooks ?? process.cwd();
    try {
      const hooksJson = JSON.parse(readFileSync(join(cwdForHooks, '.ticketlens-hooks.json'), 'utf8'));
      const t = Number(hooksJson.complianceThreshold);
      if (Number.isFinite(t)) threshold = Math.max(0, Math.min(100, t));
    } catch { /* absent or unreadable — use default */ }

    // Resolve Jira connection (non-interactive: hooks are non-TTY)
    const profileArgC = args.find(a => a.startsWith('--profile='));
    const profileNameC = profileArgC ? profileArgC.split('=')[1] : undefined;
    const connC = resolveConnection(ticketKeyArg, {
      env,
      configDir: resolvedConfigDir,
      profileName: profileNameC,
      cwd: process.cwd(),
      onWarning: (w) => process.stderr.write(w + '\n'),
      onProfileNotFound: () => {},
    });

    const hasAuthC = connC.pat || (connC.email && connC.apiToken);
    if (!connC.baseUrl || !hasAuthC) {
      process.stderr.write('Error: No Jira credentials found. Run \'ticketlens init\' or set JIRA_BASE_URL + JIRA_API_TOKEN.\n');
      process.exitCode = 1;
      return;
    }

    const adapterC = resolveAdapter(connC, { fetcher });

    let ticketC;
    try {
      ticketC = await adapterC.fetchTicket(ticketKeyArg, { depth: 0 });
    } catch (err) {
      process.stderr.write(`Error fetching ${ticketKeyArg}: ${err.message}\n`);
      process.exitCode = 1;
      return;
    }

    const allTextC = [ticketC.description, ...ticketC.comments.map(c => c.body)].filter(Boolean).join('\n');
    const codeRefsC = extractCodeReferences(allTextC);
    const briefC = assembleBrief(ticketC, codeRefsC);

    const complianceRunner = opts.runComplianceCheck ?? runComplianceCheck;
    const complianceResult = await complianceRunner({
      brief: briefC,
      ticketKey: ticketKeyArg,
      configDir: resolvedConfigDir,
    });

    if (complianceResult === null) {
      // License/usage gate — showUpgradePrompt already wrote to stderr
      process.exitCode = 1;
      return;
    }

    printFn(complianceResult.report + '\n');

    // No acceptance criteria in ticket → pass (nothing to fail on)
    if (complianceResult.noCriteria) {
      return;
    }

    if (complianceResult.coveragePercent < threshold) {
      process.exitCode = 1;
    }
    return;
  }

  if (args[0] === 'review') {
    const { assemblePrReview, extractTicketKeys } = await import('./lib/pr-review-assembler.mjs');
    const { analyzeDiff } = await import('./lib/diff-analyzer.mjs');
    const { extractRequirements } = await import('./lib/requirement-extractor.mjs');

    const resolvedConfigDir = configDir ?? (await import('./lib/config.mjs')).DEFAULT_CONFIG_DIR;
    const execFn = opts.execFn ?? spawnSync;
    const cwd = process.cwd();

    const sErr = createStyler({ isTTY: process.stderr.isTTY });
    const spinner = makeSpinner(sErr);

    // Resolve base branch: --base=BRANCH or auto-detect main/master/develop
    const baseArg = args.find(a => a.startsWith('--base='));
    let baseBranch = baseArg ? baseArg.split('=')[1] : null;

    spinner.update('Scanning branch…');

    if (!baseBranch) {
      for (const candidate of ['main', 'master', 'develop']) {
        const r = execFn('git', ['rev-parse', '--verify', candidate], { encoding: 'utf8', cwd, timeout: 5_000 });
        if (r.status === 0) { baseBranch = candidate; break; }
      }
      baseBranch = baseBranch ?? 'main';
    }

    const headResult = execFn('git', ['branch', '--show-current'], { encoding: 'utf8', cwd, timeout: 5_000 });
    const headBranch = headResult.status === 0 ? (headResult.stdout.trim() || null) : null;

    const logResult = execFn('git', ['log', '--oneline', `${baseBranch}..HEAD`], { encoding: 'utf8', cwd, timeout: 10_000 });
    const commitMessages = logResult.status === 0 ? (logResult.stdout ?? '') : '';

    const diffResult = execFn('git', ['diff', `${baseBranch}..HEAD`], { encoding: 'utf8', cwd, timeout: 30_000 });
    const diff = diffResult.status === 0 ? (diffResult.stdout || null) : null;

    const allText = [headBranch ?? '', commitMessages].join('\n');
    const ticketKeys = extractTicketKeys(allText);

    const profileArgR = args.find(a => a.startsWith('--profile='));
    const profileNameR = profileArgR ? profileArgR.split('=')[1] : undefined;

    // Validate explicit --profile exists before attempting any fetch
    if (profileNameR) {
      const profiles = loadProfiles(resolvedConfigDir);
      if (!profiles?.profiles?.[profileNameR]) {
        spinner.done();
        process.stderr.write(`${sErr.red('✖')} Profile "${profileNameR}" not found.\n`);
        const names = Object.keys(profiles?.profiles ?? {});
        if (names.length > 0) process.stderr.write(`  ${sErr.dim('Available:')} ${names.join(', ')}\n`);
        else process.stderr.write(`  Run ${sErr.cyan('ticketlens init')} to configure a profile.\n`);
        process.exitCode = 1;
        return;
      }
    }

    // Fetch tickets (best-effort — collect notes/warnings, write after spinner stops)
    const tickets = [];
    const stderrNotes = [];

    if (ticketKeys.length > 0) {
      spinner.update(`Fetching ticket context (${ticketKeys.length} key${ticketKeys.length > 1 ? 's' : ''})…`);
      const connR = resolveConnection(ticketKeys[0], {
        env,
        configDir: resolvedConfigDir,
        profileName: profileNameR,
        cwd,
        onWarning: () => {},
        onProfileNotFound: () => {},
      });
      const hasAuthR = connR.pat || (connR.email && connR.apiToken);
      if (connR.baseUrl && hasAuthR) {
        const adapterR = resolveAdapter(connR, { fetcher });
        for (const key of ticketKeys) {
          try {
            tickets.push(await adapterR.fetchTicket(key, { depth: 0 }));
          } catch (err) {
            stderrNotes.push(`  ${sErr.yellow('⚠')} ${key}: ${err.message ?? 'fetch failed'}`);
          }
        }
      } else {
        stderrNotes.push(
          `  ${sErr.yellow('○')} Found tickets [${ticketKeys.join(', ')}] but no profile configured. Run 'ticketlens init' to set up.`
        );
      }
    } else if (profileNameR) {
      stderrNotes.push(
        `  ${sErr.dim('Note:')} --profile=${profileNameR} specified but no ticket keys found in branch or commits.`
      );
    }

    spinner.done();
    for (const note of stderrNotes) process.stderr.write(note + '\n');

    const isLic = opts.isLicensedFn ?? ((tier) => isLicensed(tier, resolvedConfigDir));
    const assembleFn = opts.assemblePrReviewFn ?? assemblePrReview;

    const md = await assembleFn({
      diff,
      tickets,
      baseBranch,
      headBranch,
      isLicensedFn: isLic,
      analyzeDiffFn: analyzeDiff,
      extractRequirementsFn: extractRequirements,
    });

    const sOut = createStyler({ isTTY: process.stdout.isTTY });
    printFn((sOut.enabled ? styleReviewMd(md, sOut) : md) + '\n');
    return;
  }

  const ticketKey = args.find(a => !a.startsWith('--'));
  if (!ticketKey) {
    printFetchHelp({ stream: process.stderr });
    process.exitCode = 1;
    return;
  }
  if (!TICKET_KEY_PATTERN.test(ticketKey)) {
    process.stderr.write(`Error: "${ticketKey}" is not a valid ticket key. Expected format: PROJ-123\n`);
    process.exitCode = 1;
    return;
  }

  // Normalize --project= alias once at entry so all recursive calls only see --profile=
  const projectArg = args.find(a => a.startsWith('--project='));
  if (projectArg) {
    process.stderr.write(`Hint: --project recognized as alias for --profile=${projectArg.split('=')[1]}\n\n`);
    args = args.map(a => a.startsWith('--project=') ? `--profile=${a.split('=')[1]}` : a);
  }

  const profileArg = args.find(a => a.startsWith('--profile='));
  const profileName = profileArg ? profileArg.split('=')[1] : undefined;

  const validatedArgs = await handleUnknownFlags(
    args,
    ['--help', '-h', '--plain', '--styled', '--no-attachments', '--no-cache', '--profile=', '--depth=', '--check', '--summarize', '--cloud', '--compliance', '--budget='],
    { hints: ['--stale=', '--status=', '--static'] } // triage-only flags — shown as hints, not applied
  );
  if (validatedArgs === null) { process.exitCode = 1; return; }
  args = validatedArgs;

  // When multiple profiles share the same ticket prefix and we're in a TTY,
  // ask the user to choose rather than silently picking the first match.
  if (!profileName && process.stderr.isTTY && process.stdin.setRawMode) {
    const prefix = ticketKey.split('-')[0];
    const config = loadProfiles(configDir);
    const multiMatches = Object.entries(config?.profiles ?? {})
      .filter(([, p]) => p.ticketPrefixes?.includes(prefix))
      .map(([name, p]) => ({ name, baseUrl: p.baseUrl || null }));
    if (multiMatches.length > 1) {
      const picked = await promptMultipleMatches(ticketKey, multiMatches);
      if (!picked) { process.exitCode = 1; return; }
      const withProfile = [...args.filter(a => !a.startsWith('--profile=')), `--profile=${picked}`];
      return run(withProfile, env, fetcher, configDir);
    }
  }

  let profileError = null;
  const conn = resolveConnection(ticketKey, {
    env,
    configDir,
    profileName,
    cwd: process.cwd(),
    onWarning: (w) => process.stderr.write(w + '\n'),
    onProfileNotFound: (info) => { profileError = info; },
  });

  const hasAuth = conn.pat || (conn.email && conn.apiToken);
  if (!conn.baseUrl || !hasAuth) {
    if (profileError) {
      const picked = await promptProfileSelect(profileError);
      if (picked) {
        const newArgs = args.filter(a => !a.startsWith('--profile='));
        newArgs.push(`--profile=${picked}`);
        return run(newArgs, env, fetcher, configDir);
      }
    } else {
      const missing = [];
      if (!conn.baseUrl) missing.push('JIRA_BASE_URL');
      if (!hasAuth) missing.push('JIRA_PAT or (JIRA_EMAIL + JIRA_API_TOKEN)');
      const hint = conn.source === 'env'
        ? `Missing env vars: ${missing.join(', ')}`
        : `Missing config in profile "${conn.profileName}": ${missing.join(', ')}`;
      const noProfiles = !loadProfiles(configDir)?.profiles;
      const initHint = noProfiles ? '\nRun `ticketlens init` to set up your connection.' : '';
      process.stderr.write(`Error: ${hint}${initHint}\n`);
    }
    process.exitCode = 1;
    return;
  }

  // If no --profile was given and the resolved profile doesn't have this prefix
  // configured, prompt the user to pick the right profile.
  if (!profileName && conn.source === 'profile') {
    const prefix = ticketKey.split('-')[0];
    const config = loadProfiles(configDir);
    const resolvedProfile = config?.profiles[conn.profileName];
    if (!resolvedProfile?.ticketPrefixes?.includes(prefix)) {
      const allProfiles = Object.entries(config?.profiles ?? {})
        .map(([name, p]) => ({ name, baseUrl: p.baseUrl || null }));
      if (allProfiles.length > 1) {
        const picked = await promptProfileMismatch(ticketKey, conn.profileName, allProfiles);
        if (picked && picked !== conn.profileName) {
          const withProfile = [...args.filter(a => !a.startsWith('--profile=')), `--profile=${picked}`];
          return run(withProfile, env, fetcher, configDir);
        }
      }
    }
  }

  const adapter = resolveAdapter(conn, { fetcher });

  const depthArg = args.find(a => a.startsWith('--depth='));
  const depth = depthArg ? parseInt(depthArg.split('=')[1], 10) : 1;

  const licensedFn = opts.isLicensed ?? isLicensed;
  const upgradeFn = opts.showUpgradePrompt ?? showUpgradePrompt;

  const noCache = args.includes('--no-cache');

  // Resolve brief cache TTL: configurable for Pro tier only, else fixed 4h default
  const resolvedProfile = loadProfiles(configDir)?.profiles?.[conn.profileName];
  const ttlMs = (resolvedProfile?.cacheTtl && licensedFn('pro', configDir))
    ? (parseAge(resolvedProfile.cacheTtl) ?? BRIEF_TTL_MS)
    : BRIEF_TTL_MS;

  // ── Brief cache check ──────────────────────────────────────────────────────
  // Skip the Jira API call entirely if we have a fresh cached brief.
  if (!noCache) {
    const cached = readBriefCache(ticketKey, conn.profileName, depth, configDir, ttlMs);
    if (cached) {
      const s = createStyler({ isTTY: process.stderr.isTTY });
      const age = briefCacheAge(cached.fetchedAt);
      process.stderr.write(`  ${s.dim('○')} ${s.dim(`${ticketKey} · from cache (${age})  ·  --no-cache to refresh`)}\n\n`);

      const allText = [cached.ticket.description, ...cached.ticket.comments.map(c => c.body)].filter(Boolean).join('\n');
      const codeRefs = extractCodeReferences(allText);
      const useStyled = args.includes('--styled') || (!args.includes('--plain') && process.stdout.isTTY);

      // Apply --budget pruning on the plain brief before styling (Pro only).
      // When --budget is active, always output plain text (pruning operates on unescaped chars).
      let plainBrief = assembleBrief(cached.ticket, codeRefs);
      const budgetArgCached = args.find(a => a.startsWith('--budget='));
      if (budgetArgCached) {
        const budgetN = parseInt(budgetArgCached.split('=')[1], 10);
        if (licensedFn('pro', configDir)) {
          const budgetPruner = opts.budgetPruner ?? (await import('./lib/budget-pruner.mjs'));
          const result = budgetPruner.pruneBrief(plainBrief, { budget: budgetN, stream: process.stderr });
          plainBrief = result.pruned;
        } else {
          upgradeFn('pro', '--budget');
        }
      }
      let brief = (budgetArgCached && licensedFn('pro', configDir))
        ? plainBrief
        : (useStyled ? styleBrief(cached.ticket, codeRefs, { styled: true }) : plainBrief);

      if (args.includes('--check')) brief = applyCheck(brief, opts);

      if (args.includes('--summarize')) {
        brief = await applySummarize(brief, args, opts, configDir, conn, licensedFn, upgradeFn);
        if (brief === null) return;
      }

      if (args.includes('--compliance')) {
        const checkResult = await runComplianceCheck({
          brief,
          ticketKey,
          configDir,
        });
        if (checkResult === null) {
          process.exitCode = 1;
          return;
        } else {
          brief += '\n' + checkResult.report;
        }
      }

      printFn(brief + '\n');
      return;
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  const session = createSession(conn);

  // Load all profiles once for use in the switch-profile retry option.
  const allProfiles = Object.entries(loadProfiles(configDir)?.profiles ?? {})
    .map(([name, p]) => ({ name, baseUrl: p.baseUrl || null }));

  let ticket;
  let isRetry = false;
  while (true) {
    session.spin(isRetry ? `Retrying ${session.label}…` : `Connecting to ${session.label}…`);
    try {
      ticket = await adapter.fetchTicket(ticketKey, { depth });
      break;
    } catch (err) {
      const classified = classifyError(err, conn);
      session.failed();
      session.footer(classified.message, 'error', classified.hint);

      if (!process.stderr.isTTY || !process.stdin.setRawMode) {
        process.exitCode = 1;
        return;
      }

      process.stderr.write('\n');
      const retryIndex = await promptSelect(RETRY_OPTIONS, {
        stream: process.stderr,
        hint: '↑/↓ select   Enter confirm',
      });

      if (retryIndex === null || RETRY_OPTIONS[retryIndex].value === 'cancel') {
        process.exitCode = 1;
        return;
      }

      if (RETRY_OPTIONS[retryIndex].value === 'switch') {
        const picked = await promptSwitchProfile(conn.profileName, allProfiles);
        if (picked && picked !== conn.profileName) {
          const withProfile = [...args.filter(a => !a.startsWith('--profile=')), `--profile=${picked}`];
          return run(withProfile, env, fetcher, configDir);
        }
        // Cancelled switch — exit
        process.exitCode = 1;
        return;
      }

      // 'retry' — loop with updated spinner message
      isRetry = true;
      process.stderr.write('\n');
    }
  }
  session.connected();
  process.stderr.write('\n');

  // ── Confluence page fetching ───────────────────────────────────────────────
  // Fetch pages referenced via Jira Remote Links (Confluence-only, non-blocking).
  // Runs before cache write so cached briefs include the pages.
  ticket.confluencePages = [];
  if (adapter.type === 'jira' && !args.includes('--no-attachments')) {
    try {
      const jiraEnv = buildJiraEnv(conn);
      const authHeader = buildAuthHeader(jiraEnv);
      const apiVersion = conn.auth === 'cloud' ? 3 : 2;
      const jiraOrigin = new URL(jiraEnv.JIRA_BASE_URL).origin;
      const links = await fetchRemoteLinks(ticketKey, { env: jiraEnv, fetcher, apiVersion });
      const MAX_CONFLUENCE_PAGES = 10;
      const safeLinks = links
        .filter(l => { try { return new URL(l.url).origin === jiraOrigin; } catch { return false; } })
        .slice(0, MAX_CONFLUENCE_PAGES);
      if (safeLinks.length > 0) {
        const pages = await Promise.all(safeLinks.map(l => fetchConfluencePage(l.url, authHeader, { fetcher })));
        ticket.confluencePages = pages.filter(Boolean);
      }
    } catch { /* non-fatal — a broken remote links endpoint must not fail the brief */ }
  }
  // ──────────────────────────────────────────────────────────────────────────

  // Save to brief cache for future requests
  if (!noCache) {
    writeBriefCache(ticketKey, conn.profileName, depth, ticket, configDir);
  }

  // ── Spec drift detection ───────────────────────────────────────────────────
  try {
    const dtm = opts.driftTrackerModule ?? await import('./lib/drift-tracker.mjs');
    const branch = dtm.getCurrentBranch();
    if (branch !== '') {
      const { createHash } = await import('node:crypto');
      const resolvedConfigDir = configDir ?? (await import('./lib/config.mjs')).DEFAULT_CONFIG_DIR;
      const profileName = conn.profileName ?? 'default';
      const prior = dtm.readSnapshot(ticketKey, { profile: profileName, configDir: resolvedConfigDir });
      if (prior) {
        const desc = ticket.fields?.description ?? '';
        const { extractRequirements } = await import('./lib/requirement-extractor.mjs');
        const current = {
          status: ticket.fields?.status?.name ?? '',
          descriptionHash: createHash('sha256').update(desc).digest('hex'),
          requirements: extractRequirements(desc),
        };
        const result = dtm.detectDrift(current, prior);
        if (result.drifted) process.stderr.write(dtm.formatDriftWarning(ticketKey, result.changes));
      }
      dtm.writeSnapshot(ticketKey, ticket, { profile: profileName, configDir: resolvedConfigDir, branch });
    }
  } catch { /* drift errors are non-fatal */ }
  // ──────────────────────────────────────────────────────────────────────────

  if (!args.includes('--no-attachments')) {
    const downloadable = (ticket.attachments ?? []).filter(a => a.content);
    if (downloadable.length > 0) {
      const noun = downloadable.length === 1 ? 'attachment' : 'attachments';
      process.stderr.write(`Downloading ${downloadable.length} ${noun}…\n`);
      // attachment-downloader is Jira-specific — it needs raw auth headers from buildJiraEnv
      const jiraEnv = buildJiraEnv(conn);
      ticket.localAttachments = await downloadAttachments(ticket, {
        env: jiraEnv,
        fetcher,
        noCache: args.includes('--no-cache'),
        onProgress: (msg) => process.stderr.write(msg + '\n'),
      });
      const downloaded = ticket.localAttachments.filter(r => !r.skipped).length;
      const cached = ticket.localAttachments.filter(r => r.skipReason === 'cached').length;
      const parts = [];
      if (downloaded > 0) parts.push(`${downloaded} downloaded`);
      if (cached > 0) parts.push(`${cached} cached`);
      if (parts.length > 0) process.stderr.write(`  ✓ ${parts.join(', ')}\n`);
      process.stderr.write('\n');
    }
  }

  const allText = [ticket.description, ...ticket.comments.map(c => c.body)].filter(Boolean).join('\n');
  const codeRefs = extractCodeReferences(allText);

  const useStyled = args.includes('--styled') || (!args.includes('--plain') && process.stdout.isTTY);

  // Apply --budget pruning on the plain brief before styling (Pro only).
  // When --budget is active, always output plain text (pruning operates on unescaped chars).
  let plainOutput = assembleBrief(ticket, codeRefs);
  const budgetArg = args.find(a => a.startsWith('--budget='));
  if (budgetArg) {
    const budgetN = parseInt(budgetArg.split('=')[1], 10);
    if (licensedFn('pro', configDir)) {
      const budgetPruner = opts.budgetPruner ?? (await import('./lib/budget-pruner.mjs'));
      const result = budgetPruner.pruneBrief(plainOutput, { budget: budgetN, stream: process.stderr });
      plainOutput = result.pruned;
    } else {
      upgradeFn('pro', '--budget');
    }
  }
  let output = (budgetArg && licensedFn('pro', configDir))
    ? plainOutput
    : (useStyled ? styleBrief(ticket, codeRefs, { styled: true }) : plainOutput);

  if (args.includes('--check')) output = applyCheck(output, opts);

  if (args.includes('--summarize')) {
    output = await applySummarize(output, args, opts, configDir, conn, licensedFn, upgradeFn);
    if (output === null) return;
  }

  if (args.includes('--compliance')) {
    const checkResult = await runComplianceCheck({
      brief: output,
      ticketKey,
      configDir,
    });
    if (checkResult === null) {
      process.exitCode = 1;
      return;
    } else {
      output += '\n' + checkResult.report;
    }
  }

  printFn(output + '\n');

  // Contextual upsell: after a deep traversal with a substantial graph, nudge toward --summarize
  if (depth > 1 && !args.includes('--summarize') && (ticket.linked?.length ?? 0) >= 2) {
    const s = createStyler({ isTTY: process.stderr.isTTY });
    process.stderr.write(`  ${s.dim('○')} ${s.dim('Tip: large briefs compress further — `--summarize` condenses this to a single AI digest ($8/mo)')}\n`);
  }
}

// Run if invoked directly
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/.*\//, ''));
if (isMain) {
  run(process.argv.slice(2)).catch(err => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exitCode = 1;
  });
}
