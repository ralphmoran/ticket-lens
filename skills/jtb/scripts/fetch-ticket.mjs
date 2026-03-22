#!/usr/bin/env node

/**
 * CLI entry point: fetches a Jira ticket and outputs a TicketBrief to stdout.
 * Usage: node fetch-ticket.mjs TICKET-KEY [--depth=N] [--profile=NAME]
 */

import { fetchTicket } from './lib/jira-client.mjs';
import { extractCodeReferences } from './lib/code-ref-parser.mjs';
import { assembleBrief } from './lib/brief-assembler.mjs';
import { styleBrief } from './lib/styled-assembler.mjs';
import { resolveConnection, loadProfiles } from './lib/profile-resolver.mjs';
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

const RETRY_OPTIONS = [
  { label: 'Retry',          sublabel: 'Try again — e.g. VPN just connected', value: 'retry'  },
  { label: 'Switch profile', sublabel: 'Use a different Jira profile',         value: 'switch' },
  { label: 'Cancel',         sublabel: '',                                      value: 'cancel' },
];

export async function run(args, env = process.env, fetcher = globalThis.fetch, configDir = undefined) {
  if (args.includes('--help') || args.includes('-h')) {
    printFetchHelp();
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
    ['--help', '-h', '--plain', '--styled', '--no-attachments', '--no-cache', '--profile=', '--depth='],
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

  // Build env-like object for jira-client compatibility
  const jiraEnv = {
    JIRA_BASE_URL: conn.baseUrl,
    ...(conn.pat ? { JIRA_PAT: conn.pat } : { JIRA_EMAIL: conn.email, JIRA_API_TOKEN: conn.apiToken }),
  };

  // Cloud profiles use v3 API (v2 search is deprecated/410), Server stays on v2
  const apiVersion = conn.auth === 'cloud' ? 3 : 2;

  const depthArg = args.find(a => a.startsWith('--depth='));
  const depth = depthArg ? parseInt(depthArg.split('=')[1], 10) : 1;
  const noCache = args.includes('--no-cache');

  // Resolve brief cache TTL: profile setting → default 4h
  const resolvedProfile = loadProfiles(configDir)?.profiles?.[conn.profileName];
  const ttlMs = (resolvedProfile?.cacheTtl ? parseAge(resolvedProfile.cacheTtl) : null) ?? BRIEF_TTL_MS;

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
      const brief = useStyled
        ? styleBrief(cached.ticket, codeRefs, { styled: true })
        : assembleBrief(cached.ticket, codeRefs);
      process.stdout.write(brief + '\n');
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
      ticket = await fetchTicket(ticketKey, { env: jiraEnv, fetcher, depth, apiVersion });
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

  // Save to brief cache for future requests
  if (!noCache) {
    writeBriefCache(ticketKey, conn.profileName, depth, ticket, configDir);
  }

  if (!args.includes('--no-attachments')) {
    const downloadable = (ticket.attachments ?? []).filter(a => a.content);
    if (downloadable.length > 0) {
      const noun = downloadable.length === 1 ? 'attachment' : 'attachments';
      process.stderr.write(`Downloading ${downloadable.length} ${noun}…\n`);
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
  const brief = useStyled
    ? styleBrief(ticket, codeRefs, { styled: true })
    : assembleBrief(ticket, codeRefs);
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
