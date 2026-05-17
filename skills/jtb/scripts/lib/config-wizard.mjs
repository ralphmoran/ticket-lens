/**
 * ticketlens config — Edit settings for an existing profile.
 * Pre-populates every field with the current value; Enter keeps it unchanged.
 * Triage statuses use merge semantics: new entries are added, existing ones preserved.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import { createStyler } from './ansi.mjs';
import { createSession } from './banner.mjs';
import { classifyError } from './error-classifier.mjs';
import { fetchCurrentUser, fetchStatuses } from './jira-client.mjs';
import { resolveAdapter } from './resolve-adapter.mjs';
import { loadProfiles, loadCredentials, saveProfile } from './profile-resolver.mjs';
import { promptSelect } from './select-prompt.mjs';
import { parseAge } from './cache-manager.mjs';
import { DEFAULT_BRIEF_TTL } from './brief-cache.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { visLen, SERVER_AUTH_TYPES, promptText, promptSecret, promptYN } from './prompt-helpers.mjs';
import { isLicensed } from './license.mjs';

const RETRY_OPTIONS = [
  { label: 'Retry',             sublabel: 'Try again — same credentials (e.g. VPN just connected)', value: 'retry' },
  { label: 'Edit credentials',  sublabel: 'Change email / token',                                   value: 'creds' },
  { label: 'Edit from URL',     sublabel: 'Change URL, auth type, or credentials',                  value: 'url'   },
  { label: 'Skip',              sublabel: 'Abandon connection changes — no changes saved',           value: 'skip'  },
];

function getTrackerType(profile) {
  if (profile.auth === 'linear') return 'linear';
  if (profile.auth === 'github') return 'github';
  return 'jira';
}

function getUrlLabel(trackerType) {
  if (trackerType === 'linear') return 'Linear workspace URL';
  if (trackerType === 'github') return 'GitHub URL';
  return 'Jira URL';
}

function getTokenLabel(trackerType, auth) {
  if (trackerType === 'linear') return 'Linear API key';
  if (trackerType === 'github') return 'GitHub token';
  if (auth === 'cloud') return 'API token';
  if (auth === 'pat') return 'Personal access token';
  return 'Password';
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function run({ configDir = DEFAULT_CONFIG_DIR, profileName } = {}) {
  const stream = process.stderr;
  const s = createStyler({ isTTY: stream.isTTY });
  const bc = s.cyan;

  const config = loadProfiles(configDir);
  if (!config || Object.keys(config.profiles).length === 0) {
    stream.write(`  ${s.red('✖')} No profiles configured. Run ${s.cyan('ticketlens init')} first.\n`);
    process.exitCode = 1;
    return;
  }

  const target = profileName || config.default || Object.keys(config.profiles)[0];
  const profile = config.profiles[target];
  if (!profile) {
    stream.write(`  ${s.red('✖')} Profile "${target}" not found.\n`);
    const names = Object.keys(config.profiles);
    stream.write(`  ${s.dim('Available:')} ${names.map(n => s.cyan(n)).join(s.dim(', '))}\n`);
    process.exitCode = 1;
    return;
  }

  const creds = loadCredentials(configDir);
  const profileCreds = creds[target] || {};
  const hostname = (() => { try { return new URL(profile.baseUrl).hostname; } catch { return profile.baseUrl; } })();

  const trackerType = getTrackerType(profile);
  const isJira = trackerType === 'jira';
  const urlLabel = getUrlLabel(trackerType);

  // Header box
  const headerLines = [
    `Editing profile ${s.bold(s.cyan(`"${target}"`))}`,
    `${s.dim('Server:')}  ${hostname}`,
  ];
  const innerWidth = headerLines.reduce((max, l) => Math.max(max, visLen(l)), 0) + 4;
  stream.write('\n');
  stream.write(bc('╭' + '─'.repeat(innerWidth) + '╮') + '\n');
  for (const line of headerLines) {
    const pad = innerWidth - visLen(line) - 1;
    stream.write(bc('│') + ' ' + line + ' '.repeat(Math.max(0, pad)) + bc('│') + '\n');
  }
  stream.write(bc('╰' + '─'.repeat(innerWidth) + '╯') + '\n');

  // ── Connection ─────────────────────────────────────────────────────────────
  stream.write(`\n  ${s.dim('──── Connection ────')}\n\n`);

  // Working copies — mutated by the retry loop if the user edits
  let url  = profile.baseUrl;
  let auth = profile.auth;
  let email = profile.email || '';
  const existingToken = profileCreds.pat || profileCreds.apiToken || '';
  let token = existingToken;

  // ── URL ───────────────────────────────────────────────────────────────────
  const urlTyped = await promptText(
    s.dim(urlLabel) + s.dim(`  [current: ${profile.baseUrl}]:`),
    { stream, defaultValue: profile.baseUrl }
  );
  if (urlTyped !== profile.baseUrl) {
    url = /^https?:\/\//i.test(urlTyped)
      ? urlTyped.replace(/\/$/, '')
      : `https://${urlTyped.replace(/\/$/, '')}`;
    if (url !== urlTyped) stream.write(`  ${s.dim('○')} Interpreted as ${url}\n`);
  }

  // ── Auth type (Jira only) ─────────────────────────────────────────────────
  if (isJira) {
    const isCloud = /\.atlassian\.net(\/|$)/i.test(url);
    if (isCloud && auth !== 'cloud') {
      auth = 'cloud';
      stream.write(`  ${s.green('✔')} Jira Cloud detected — using email + API token\n`);
    } else if (!isCloud) {
      const currentIdx = SERVER_AUTH_TYPES.findIndex(a => a.value === auth);
      stream.write(`\n  ${s.dim('Auth type:')}\n\n`);
      const authIdx = await promptSelect(SERVER_AUTH_TYPES, {
        stream,
        hint: '↑/↓ select   Enter confirm',
        initialIndex: Math.max(0, currentIdx),
      });
      if (authIdx !== null) auth = SERVER_AUTH_TYPES[authIdx].value;
    }
  }

  // ── Email / username (Jira only) ──────────────────────────────────────────
  if (isJira && (auth === 'cloud' || auth === 'basic')) {
    const emailHint = email ? s.dim(`  [current: ${email}]`) : '';
    const emailLabel = (auth === 'cloud' ? s.dim('Email') : s.dim('Username')) + emailHint + s.dim(':');
    email = await promptText(emailLabel, {
      stream,
      defaultValue: email,
      validate: (v) => {
        if (!v) return 'Cannot be empty.';
        if (auth === 'cloud' && !v.includes('@')) return 'Enter a valid email address.';
        return null;
      },
    });
  }

  // ── Token / PAT / password / API key ─────────────────────────────────────
  const tokenHint = existingToken ? s.dim('  [keep existing]') : '';
  const tokenLabel = s.dim(getTokenLabel(trackerType, auth)) + tokenHint + s.dim(':');
  token = await promptSecret(tokenLabel, { stream, existingValue: existingToken });

  // ── Connection test (always) ──────────────────────────────────────────────
  let connected = false;
  let startFrom = 'test';

  setupLoop: while (true) {
    // Re-prompt URL + auth (on retry with 'url' option)
    if (startFrom === 'url') {
        stream.write('\n');
        const reTyped = await promptText(
          s.dim(urlLabel) + s.dim(`  [current: ${url}]:`),
          { stream, defaultValue: url }
        );
        if (reTyped !== url) {
          url = /^https?:\/\//i.test(reTyped)
            ? reTyped.replace(/\/$/, '')
            : `https://${reTyped.replace(/\/$/, '')}`;
          if (url !== reTyped) stream.write(`  ${s.dim('○')} Interpreted as ${url}\n`);
        }

        if (isJira) {
          const reCloud = /\.atlassian\.net(\/|$)/i.test(url);
          if (reCloud) {
            auth = 'cloud';
            stream.write(`  ${s.green('✔')} Jira Cloud detected — using email + API token\n\n`);
          } else if (auth === 'cloud') {
            stream.write(`\n  ${s.dim('Auth type:')}\n\n`);
            const idx = await promptSelect(SERVER_AUTH_TYPES, { stream, hint: '↑/↓ select   Enter confirm' });
            if (idx !== null) auth = SERVER_AUTH_TYPES[idx].value;
          }
        }
        startFrom = 'creds';
      }

      // Re-prompt email + token (pre-populated)
      if (startFrom === 'creds') {
        if (isJira && (auth === 'cloud' || auth === 'basic')) {
          const eHint = email ? s.dim(`  [current: ${email}]`) : '';
          const eLabel = (auth === 'cloud' ? s.dim('Email') : s.dim('Username')) + eHint + s.dim(':');
          email = await promptText(eLabel, {
            stream,
            defaultValue: email,
            validate: (v) => {
              if (!v) return 'Cannot be empty.';
              if (auth === 'cloud' && !v.includes('@')) return 'Enter a valid email address.';
              return null;
            },
          });
        }
        const tHint = token ? s.dim('  [keep existing]') : '';
        const tLabel = s.dim(getTokenLabel(trackerType, auth)) + tHint + s.dim(':');
        token = await promptSecret(tLabel, { stream, existingValue: token });
      }

      // Test connection
      const session = createSession(
        { baseUrl: url, profileName: target, email: email || undefined, pat: auth === 'pat' ? token : undefined },
        { stream },
      );
      stream.write('\n');
      session.spin('Testing connection...');

      try {
        if (isJira) {
          const testEnv = {
            JIRA_BASE_URL: url,
            JIRA_EMAIL: email,
            JIRA_API_TOKEN: auth !== 'pat' ? token : '',
            JIRA_PAT: auth === 'pat' ? token : '',
          };
          await fetchCurrentUser({ env: testEnv, apiVersion: auth === 'cloud' ? 3 : 2 });
        } else {
          await resolveAdapter({ baseUrl: url, auth: trackerType, apiToken: token }).fetchCurrentUser();
        }
        session.connected();
        connected = true;
        break setupLoop;
      } catch (err) {
        session.failed();
        const classified = classifyError(err, { baseUrl: url, profileName: target });
        session.footer(classified.message, 'error', classified.hint);
      }

      stream.write(`\n  ${s.dim('What would you like to do?')}\n\n`);
      const retryIdx = await promptSelect(RETRY_OPTIONS, { stream, hint: '↑/↓ select   Enter confirm' });
      if (retryIdx === null || RETRY_OPTIONS[retryIdx].value === 'skip') break setupLoop;
      startFrom = RETRY_OPTIONS[retryIdx].value;
    }

  if (!connected) {
    stream.write(`\n  ${s.yellow('○')} Connection changes discarded. ${s.dim('Run')} ${s.cyan('ticketlens config')} ${s.dim('again to retry.')}\n\n`);
    process.exitCode = 1;
    return;
  }

  // ── Optional settings ──────────────────────────────────────────────────────
  stream.write(`\n  ${s.dim('──── Optional ────')}\n\n`);

  // Ticket prefixes
  const curPrefixes = (profile.ticketPrefixes || []).join(', ');
  const prefixInput = await promptText(
    s.dim('Ticket prefixes') + s.dim(curPrefixes ? `  [current: ${curPrefixes}]:` : '  (e.g. PROJ,OPS — press Enter to skip):'),
    { stream }
  );
  const existing = new Set(profile.ticketPrefixes || []);
  if (prefixInput) {
    for (const v of prefixInput.split(',').map(v => v.trim().toUpperCase()).filter(Boolean)) {
      existing.add(v);
    }
  }
  const ticketPrefixes = [...existing];

  // Project path
  const home = homedir();
  const cwd = process.cwd();
  const cwdDisplay = cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;
  const curPath = (profile.projectPaths || [])[0] || '';
  const pathInput = await promptText(
    s.dim('Project path') + s.dim(curPath ? `  [current: ${curPath}]:` : `  [${cwdDisplay}]:`),
    { stream }
  );
  const rawPath = (pathInput.trim() || curPath || cwdDisplay).replace(/\/+$/, '');

  const projectPaths = [];
  if (rawPath) {
    const expanded = rawPath.startsWith('~') ? join(home, rawPath.slice(1)) : rawPath;
    if (existsSync(expanded)) {
      projectPaths.push(rawPath);
      stream.write(`  ${s.green('✔')} ${rawPath}\n`);
    } else {
      stream.write(`  ${s.yellow('○')} ${s.dim(rawPath)} — directory not found\n`);
      const doCreate = await promptYN(`Create ${rawPath}?`, { stream });
      if (doCreate) {
        try {
          mkdirSync(expanded, { recursive: true });
          projectPaths.push(rawPath);
          stream.write(`  ${s.green('✔')} Created\n`);
        } catch (mkErr) {
          stream.write(`  ${s.red('✖')} Could not create: ${mkErr.message}\n`);
        }
      }
    }
  }

  // ── Triage statuses (merge semantics) ────────────────────────────────────
  const currentStatuses = profile.triageStatuses?.length
    ? profile.triageStatuses
    : ['In Progress', 'Code Review', 'QA'];
  const curStatusesStr = currentStatuses.join(', ');

  const statusInput = await promptText(
    s.dim('Add triage statuses') + s.dim(`  [current: ${curStatusesStr} — Enter to keep]:`),
    { stream }
  );

  let triageStatuses = currentStatuses;

  if (statusInput) {
    const newEntries = statusInput.split(',').map(v => v.trim()).filter(Boolean);
    const existingLower = new Set(currentStatuses.map(n => n.toLowerCase()));
    const toValidate = newEntries.filter(n => !existingLower.has(n.toLowerCase()));

    if (toValidate.length > 0) {
      stream.write(`  ${s.dim('Validating new statuses...')}\n`);
      try {
        let available;
        if (isJira) {
          const validateEnv = {
            JIRA_BASE_URL: url,
            JIRA_EMAIL: email,
            JIRA_API_TOKEN: auth !== 'pat' ? token : '',
            JIRA_PAT: auth === 'pat' ? token : '',
          };
          available = await fetchStatuses({ env: validateEnv, apiVersion: auth === 'cloud' ? 3 : 2 });
        } else {
          available = await resolveAdapter({ baseUrl: url, auth: trackerType, apiToken: token }).fetchStatuses();
        }

        const lowerMap = new Map(available.map(n => [n.toLowerCase(), n]));
        stream.write('\x1b[A\r\x1b[2K');

        const toAdd = [];
        for (const name of toValidate) {
          if (available.includes(name)) {
            toAdd.push(name);
            stream.write(`  ${s.green('✔')} ${name}\n`);
          } else {
            const exact = lowerMap.get(name.toLowerCase());
            if (exact) {
              stream.write(`  ${s.yellow('~')} ${s.dim(name)}  →  ${s.cyan(exact)}\n`);
              toAdd.push(exact);
            } else {
              const partial = available.find(a =>
                a.toLowerCase().includes(name.toLowerCase()) ||
                name.toLowerCase().startsWith(a.toLowerCase().split(' ')[0])
              );
              if (partial) {
                stream.write(`  ${s.yellow('~')} ${s.dim(name)}  →  ${s.cyan(partial)}\n`);
                toAdd.push(partial);
              } else {
                stream.write(`  ${s.red('✖')} ${name}  ${s.dim('(not found — skipped)')}\n`);
              }
            }
          }
        }

        triageStatuses = [...currentStatuses, ...toAdd];
        if (toAdd.length > 0) {
          stream.write(`  ${s.dim('Updated list:')} ${triageStatuses.map(n => s.cyan(n)).join(s.dim(', '))}\n`);
        }
      } catch {
        stream.write('\x1b[A\r\x1b[2K');
        // Tracker unreachable — add without validation, deduped
        triageStatuses = [...currentStatuses, ...toValidate.filter(n => !existingLower.has(n.toLowerCase()))];
      }
    }
  }

  // ── Cache TTL (Pro feature) ───────────────────────────────────────────────
  let cacheTtl = DEFAULT_BRIEF_TTL;
  if (isLicensed('pro', configDir)) {
    const curTtl = profile.cacheTtl || DEFAULT_BRIEF_TTL;
    const ttlInput = await promptText(
      s.dim('Brief cache TTL') + s.dim(`  [current: ${curTtl} — e.g. 4h, 7d, 30d, 0 to disable — Enter to keep]:`),
      { stream, validate: (v) => {
        if (!v || v === curTtl) return null;
        if (v === '0') return null;
        return parseAge(v) === null ? 'Use a number followed by h, d, w, m, or y (e.g. 4h, 7d, 30d)' : null;
      } }
    );
    cacheTtl = ttlInput || curTtl;
  } else {
    stream.write(`  ${s.dim('○')} Brief cache TTL: ${s.dim('4h')}  ${s.dim('·')}  ${s.cyan('Pro')} ${s.dim('unlocks configurable TTL → ticketlens.dev/pricing')}\n`);
  }

  // ── Save ───────────────────────────────────────────────────────────────────
  const updated = { ...profile, baseUrl: url, auth, triageStatuses };
  if (email) updated.email = email;
  if (ticketPrefixes.length > 0) updated.ticketPrefixes = ticketPrefixes;
  else delete updated.ticketPrefixes;
  if (projectPaths.length > 0) updated.projectPaths = projectPaths;
  else delete updated.projectPaths;
  if (cacheTtl && cacheTtl !== DEFAULT_BRIEF_TTL) updated.cacheTtl = cacheTtl;
  else delete updated.cacheTtl;

  const credData = (token !== existingToken)
    ? (auth === 'pat' ? { pat: token } : { apiToken: token })
    : {};

  saveProfile(target, updated, credData, configDir);
  stream.write(`\n  ${s.green('✔')} Profile ${s.bold(s.cyan(`"${target}"`))} updated.\n\n`);
}
