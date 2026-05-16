/**
 * ticketlens init — Interactive setup wizard.
 * Guides the user through configuring one or more Jira profiles.
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync } from 'node:fs';
import { createStyler } from './ansi.mjs';
import { createSession } from './banner.mjs';
import { classifyError } from './error-classifier.mjs';
import { fetchCurrentUser, fetchStatuses } from './jira-client.mjs';
import { loadProfiles, saveProfile, saveDefault } from './profile-resolver.mjs';
import { resolveAdapter } from './resolve-adapter.mjs';
import { promptSelect } from './select-prompt.mjs';
import { runSwitch } from './profile-switcher.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { visLen, SERVER_AUTH_TYPES, promptText, promptSecret, promptYN } from './prompt-helpers.mjs';

const RETRY_OPTIONS = [
  { label: 'Retry',             sublabel: 'Try again — same credentials (e.g. VPN just connected)', value: 'retry' },
  { label: 'Edit credentials',  sublabel: 'Change email / token',                                   value: 'creds' },
  { label: 'Edit from URL',     sublabel: 'Change URL, auth type, or credentials',                  value: 'url'   },
  { label: 'Skip this profile', sublabel: 'Abandon — move to next step',                            value: 'skip'  },
];

// ── Protocol probe ────────────────────────────────────────────────────────────
// When the user types a bare hostname (no https:// or http://), try https first
// then http. Any HTTP response (even 401) means the server is reachable there.

async function probeProtocol(host, { stream, s }) {
  for (const scheme of ['https', 'http']) {
    const url = `${scheme}://${host}`;
    stream.write(`  ${s.dim(`○ Probing ${url}...`)}\n`);
    try {
      await globalThis.fetch(`${url}/rest/api/2/serverInfo`, {
        signal: AbortSignal.timeout(5000),
      });
      stream.write('\x1b[A\r\x1b[2K');
      stream.write(`  ${s.green('✔')} Using ${url}\n`);
      return url;
    } catch {
      stream.write('\x1b[A\r\x1b[2K');
    }
  }
  // Both unreachable — default to https and let the connection test surface the error
  const fallback = `https://${host}`;
  stream.write(`  ${s.yellow('~')} Could not probe server — will try ${fallback}\n`);
  return fallback;
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export async function run({ configDir = DEFAULT_CONFIG_DIR } = {}) {
  const stream = process.stderr;
  const s = createStyler({ isTTY: stream.isTTY });

  // Ensure cursor is restored and stdin is clean on Ctrl+C at any point
  function onSigint() {
    stream.write('\x1b[?25h'); // restore cursor
    if (process.stdin.isRaw) process.stdin.setRawMode(false);
    stream.write('\n');
    process.exit(130);
  }
  process.on('SIGINT', onSigint);

  try {
    await _run({ configDir, stream, s });
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

async function _run({ configDir, stream, s }) {
  // Welcome box
  const headerLines = [
    `${s.bold(s.cyan('◆ TicketLens'))} — Setup Wizard`,
    `${s.dim("Let's configure your tracker connection.")}`,
  ];
  const innerWidth = headerLines.reduce((max, l) => Math.max(max, visLen(l)), 0) + 4;
  const bc = s.cyan;
  stream.write('\n');
  stream.write(bc('╭' + '─'.repeat(innerWidth) + '╮') + '\n');
  for (const line of headerLines) {
    const pad = innerWidth - visLen(line) - 1;
    stream.write(bc('│') + ' ' + line + ' '.repeat(Math.max(0, pad)) + bc('│') + '\n');
  }
  stream.write(bc('╰' + '─'.repeat(innerWidth) + '╯') + '\n');

  let addedCount = 0;
  let addAnother = true;

  while (addAnother) {
    stream.write('\n');

    // ── Profile name ──────────────────────────────────────────────────────────
    const profileName = await promptText(s.dim('Profile name') + s.dim('  (e.g. work, acme):'), {
      stream,
      validate: (v) => {
        if (!v) return 'Profile name cannot be empty.';
        if (!/^[a-z0-9_-]+$/.test(v)) return 'Use lowercase letters, numbers, hyphens, and underscores only.';
        const current = loadProfiles(configDir);
        if (current && current.profiles[v]) return `Profile "${v}" already exists. Choose a different name.`;
        return null;
      },
    });

    // ── Tracker type ──────────────────────────────────────────────────────────
    const TRACKER_TYPES = [
      { label: 'Jira',   sublabel: 'Jira Cloud, Server, or Data Center', value: 'jira'   },
      { label: 'GitHub', sublabel: 'GitHub Issues (github.com)',          value: 'github' },
      { label: 'Linear', sublabel: 'Linear (linear.app)',                 value: 'linear' },
    ];
    stream.write(`\n  ${s.dim('Tracker type:')}\n\n`);
    const trackerIndex = await promptSelect(TRACKER_TYPES, { stream, hint: '↑/↓ select   Enter confirm' });
    if (trackerIndex === null) {
      stream.write(`  ${s.dim('Cancelled.')}\n`);
      addAnother = await promptYN('Configure another connection?', { stream });
      continue;
    }
    const trackerType = TRACKER_TYPES[trackerIndex].value;
    stream.write(`  ${s.green('✔')} ${TRACKER_TYPES[trackerIndex].label}\n`);

    let connected = false;

    if (trackerType === 'github') {
      let ghUrl = '', ghToken = '';

      githubLoop: while (true) {
        stream.write(`\n  ${s.dim('Repository URL')}\n\n`);
        const typed = await promptText(
          s.dim('Repo URL') + s.dim('  (e.g. https://github.com/acme/widgets):'),
          {
            stream,
            defaultValue: ghUrl,
            validate: (v) => {
              if (!v) return 'URL cannot be empty.';
              if (!/github\.com\/[^/]+\/[^/]+/.test(v)) return 'Must be a GitHub repo URL — e.g. https://github.com/acme/widgets';
              return null;
            },
          }
        );
        ghUrl = typed.replace(/\/$/, '');
        stream.write(`  ${s.green('✔')} ${ghUrl}\n`);

        const tokenHint = ghToken ? s.dim('  [keep existing]') : '';
        ghToken = await promptSecret(
          s.dim('Personal access token') + tokenHint + s.dim(':'),
          { stream, existingValue: ghToken }
        );

        const ghConn = { baseUrl: ghUrl, apiToken: ghToken, ticketPrefixes: ['GH'] };
        const ghSession = createSession({ baseUrl: ghUrl, profileName }, { stream });
        stream.write('\n');
        ghSession.spin('Testing connection...');

        try {
          const ghAdapter = resolveAdapter(ghConn);
          await ghAdapter.fetchCurrentUser();
          ghSession.connected();
          connected = true;
          break githubLoop;
        } catch (err) {
          ghSession.failed();
          const classified = classifyError(err, { baseUrl: ghUrl, profileName });
          ghSession.footer(classified.message, 'error', classified.hint);
        }

        const GH_RETRY = [
          { label: 'Retry',      sublabel: 'Try again — same credentials', value: 'retry' },
          { label: 'Edit token', sublabel: 'Change personal access token', value: 'creds' },
          { label: 'Edit URL',   sublabel: 'Change repository URL',        value: 'url'   },
          { label: 'Skip',       sublabel: 'Abandon — move to next step',  value: 'skip'  },
        ];
        stream.write(`\n  ${s.dim('What would you like to do?')}\n\n`);
        const ghRetryIndex = await promptSelect(GH_RETRY, { stream, hint: '↑/↓ select   Enter confirm' });
        if (ghRetryIndex === null || GH_RETRY[ghRetryIndex].value === 'skip') break githubLoop;
        if (GH_RETRY[ghRetryIndex].value === 'url') continue githubLoop;
        const rHint = ghToken ? s.dim('  [keep existing]') : '';
        ghToken = await promptSecret(
          s.dim('Personal access token') + rHint + s.dim(':'),
          { stream, existingValue: ghToken }
        );
      }

      if (connected) {
        stream.write(`\n  ${s.dim('──── Optional  (press Enter to skip) ────')}\n\n`);

        const prefixRaw = await promptText(s.dim('Key prefix') + s.dim('  [GH]:'), { stream });
        const ticketPrefixes = prefixRaw
          ? prefixRaw.split(',').map(v => v.trim().toUpperCase()).filter(Boolean)
          : ['GH'];

        const home = homedir();
        const cwd = process.cwd();
        const cwdDisplay = cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;
        const pathInput = await promptText(
          s.dim('Project path') + s.dim(`  [${cwdDisplay}]:`), { stream }
        );
        const rawPath = (pathInput.trim() || cwdDisplay).replace(/\/+$/, '');
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

        const profileData = {
          baseUrl: ghUrl,
          auth: 'github',
          ticketPrefixes,
          ...(projectPaths.length > 0 ? { projectPaths } : {}),
        };
        saveProfile(profileName, profileData, { apiToken: ghToken }, configDir);
        addedCount++;
        stream.write(`\n  ${s.green('✔')} Profile ${s.bold(s.cyan(`"${profileName}"`))} saved.\n`);
      }
    }

    if (trackerType === 'linear') {
      let linToken = '';

      linearLoop: while (true) {
        const tokenHint = linToken ? s.dim('  [keep existing]') : '';
        linToken = await promptSecret(
          s.dim('Linear API key') + tokenHint + s.dim(':'),
          { stream, existingValue: linToken }
        );

        const linConn = { baseUrl: 'https://linear.app', apiToken: linToken };
        const linSession = createSession({ baseUrl: 'https://linear.app', profileName }, { stream });
        stream.write('\n');
        linSession.spin('Testing connection...');

        try {
          const linAdapter = resolveAdapter(linConn);
          await linAdapter.fetchCurrentUser();
          linSession.connected();
          connected = true;
          break linearLoop;
        } catch (err) {
          linSession.failed();
          const classified = classifyError(err, { baseUrl: 'https://linear.app', profileName });
          linSession.footer(classified.message, 'error', classified.hint);
        }

        const LIN_RETRY = [
          { label: 'Retry',     sublabel: 'Try again — same key',          value: 'retry' },
          { label: 'Edit key',  sublabel: 'Change API key',                 value: 'creds' },
          { label: 'Skip',      sublabel: 'Abandon — move to next step',    value: 'skip'  },
        ];
        stream.write(`\n  ${s.dim('What would you like to do?')}\n\n`);
        const linRetryIndex = await promptSelect(LIN_RETRY, { stream, hint: '↑/↓ select   Enter confirm' });
        if (linRetryIndex === null || LIN_RETRY[linRetryIndex].value === 'skip') break linearLoop;
        const lHint = linToken ? s.dim('  [keep existing]') : '';
        linToken = await promptSecret(
          s.dim('Linear API key') + lHint + s.dim(':'),
          { stream, existingValue: linToken }
        );
      }

      if (connected) {
        stream.write(`\n  ${s.dim('──── Optional  (press Enter to skip) ────')}\n\n`);

        const prefixRaw = await promptText(s.dim('Team identifier') + s.dim('  (e.g. ENG):'), { stream });
        const ticketPrefixes = prefixRaw
          ? prefixRaw.split(',').map(v => v.trim().toUpperCase()).filter(Boolean)
          : [];

        const home = homedir();
        const cwd = process.cwd();
        const cwdDisplay = cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;
        const pathInput = await promptText(
          s.dim('Project path') + s.dim(`  [${cwdDisplay}]:`), { stream }
        );
        const rawPath = (pathInput.trim() || cwdDisplay).replace(/\/+$/, '');
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

        const profileData = {
          baseUrl: 'https://linear.app',
          auth: 'linear',
          ...(ticketPrefixes.length > 0 ? { ticketPrefixes } : {}),
          ...(projectPaths.length > 0 ? { projectPaths } : {}),
        };
        saveProfile(profileName, profileData, { apiToken: linToken }, configDir);
        addedCount++;
        stream.write(`\n  ${s.green('✔')} Profile ${s.bold(s.cyan(`"${profileName}"`))} saved.\n`);
      }
    }

    if (trackerType === 'jira') {
    // ── Setup loop — URL → auth → credentials → test → retry ─────────────────
    //
    // startFrom controls which step to resume from on each iteration:
    //   'url'   — re-prompt URL + auth type, then fall through to creds
    //   'creds' — re-prompt email/token (pre-populated), then test
    //   'retry' — skip all prompts, rebuild env from current values, test immediately
    let baseUrl = '', authType = '', email = '', token = '';
    let env = {}, apiVersion = 2;
    let startFrom = 'url';

    setupLoop: while (true) {
      // ── URL + auth type ────────────────────────────────────────────────────
      if (startFrom === 'url') {
        stream.write(`\n  ${s.dim('Jira URL:')}\n\n`);
        const urlSuggestions = [
          { label: `https://${profileName}.atlassian.net`, sublabel: 'Cloud · atlassian.net', value: `https://${profileName}.atlassian.net` },
          { label: `https://jira.${profileName}.com`,      sublabel: 'Server/DC · self-hosted', value: `https://jira.${profileName}.com` },
          { label: 'Enter a different URL…',               sublabel: 'Type your own',           value: null },
        ];
        const urlIndex = await promptSelect(urlSuggestions, { stream, hint: '↑/↓ select   Enter confirm' });
        if (urlIndex === null) {
          stream.write(`  ${s.dim('Cancelled.')}\n`);
          break setupLoop;
        }
        let rawUrl;
        if (urlSuggestions[urlIndex].value === null) {
          stream.write('\n');
          const typed = await promptText(
            s.dim('Jira URL') + s.dim('  (e.g. jira.company.com or https://jira.company.com):'),
            {
              stream,
              defaultValue: baseUrl, // pre-fill with previously typed URL if any
              validate: (v) => (v ? null : 'URL cannot be empty.'),
            }
          );
          // Auto-detect protocol when the user omits it
          if (!/^https?:\/\//i.test(typed)) {
            rawUrl = await probeProtocol(typed.replace(/\/$/, ''), { stream, s });
          } else {
            rawUrl = typed;
            stream.write(`  ${s.green('✔')} ${rawUrl}\n`);
          }
        } else {
          rawUrl = urlSuggestions[urlIndex].value;
          stream.write(`  ${s.green('✔')} ${rawUrl}\n`);
        }
        baseUrl = rawUrl.replace(/\/$/, '');

        const isCloud = /\.atlassian\.net(\/|$)/i.test(baseUrl);
        if (isCloud) {
          authType = 'cloud';
          stream.write(`\n  ${s.green('✔')} Jira Cloud detected — using email + API token\n\n`);
        } else {
          stream.write(`\n  ${s.dim('Auth type:')}\n\n`);
          const serverAuthIndex = await promptSelect(SERVER_AUTH_TYPES, {
            stream,
            hint: '↑/↓ select   Enter confirm',
          });
          if (serverAuthIndex === null) {
            stream.write(`  ${s.dim('Cancelled.')}\n`);
            break setupLoop;
          }
          authType = SERVER_AUTH_TYPES[serverAuthIndex].value;
          stream.write(`  ${s.green('✔')} ${SERVER_AUTH_TYPES[serverAuthIndex].label}\n\n`);
        }
        startFrom = 'creds';
      }

      // ── Email / username + token / password ────────────────────────────────
      // Pre-populated from previous attempt — Enter keeps the existing value.
      if (startFrom === 'creds') {
        if (authType === 'cloud' || authType === 'basic') {
          const emailHint = email ? s.dim(`  [current: ${email}]`) : '';
          const emailLabel = (authType === 'cloud' ? s.dim('Email') : s.dim('Username')) + emailHint + s.dim(':');
          email = await promptText(emailLabel, {
            stream,
            defaultValue: email,
            validate: (v) => {
              if (!v) return 'Cannot be empty.';
              if (authType === 'cloud' && !v.includes('@')) return 'Enter a valid email address.';
              return null;
            },
          });
        }
        const tokenHint = token ? s.dim('  [keep existing]') : '';
        const tokenLabel = (authType === 'cloud'
          ? s.dim('API token')
          : authType === 'pat'
            ? s.dim('Personal access token')
            : s.dim('Password')) + tokenHint + s.dim(':');
        token = await promptSecret(tokenLabel, { stream, existingValue: token });
      }

      // ── Test connection ────────────────────────────────────────────────────
      env = {
        JIRA_BASE_URL: baseUrl,
        JIRA_EMAIL: email,
        JIRA_API_TOKEN: authType !== 'pat' ? token : '',
        JIRA_PAT: authType === 'pat' ? token : '',
      };
      apiVersion = authType === 'cloud' ? 3 : 2;

      const session = createSession({
        baseUrl,
        profileName,
        email: email || undefined,
        pat: authType === 'pat' ? token : undefined,
      }, { stream });

      stream.write('\n');
      session.spin('Testing connection...');

      try {
        await fetchCurrentUser({ env, apiVersion });
        session.connected();
        connected = true;
        break setupLoop;
      } catch (err) {
        session.failed();
        const classified = classifyError(err, { baseUrl, profileName });
        session.footer(classified.message, 'error', classified.hint);
      }

      // ── Retry options ──────────────────────────────────────────────────────
      stream.write(`\n  ${s.dim('What would you like to do?')}\n\n`);
      const retryIndex = await promptSelect(RETRY_OPTIONS, { stream, hint: '↑/↓ select   Enter confirm' });
      if (retryIndex === null || RETRY_OPTIONS[retryIndex].value === 'skip') break setupLoop;
      startFrom = RETRY_OPTIONS[retryIndex].value;
    }

    if (connected) {
      // ── Optional settings ───────────────────────────────────────────────────
      stream.write(`\n  ${s.dim('──── Optional  (press Enter to skip) ────')}\n\n`);

      // Ticket prefixes
      const prefixInput = await promptText(
        s.dim('Ticket prefixes') + s.dim('  (e.g. PROJ,OPS):'), { stream }
      );
      const ticketPrefixes = prefixInput
        ? prefixInput.split(',').map(v => v.trim().toUpperCase()).filter(Boolean)
        : [];

      // Project path (single — used for auto-profile detection from cwd)
      const home = homedir();
      const cwd = process.cwd();
      const cwdDisplay = cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;
      const pathInput = await promptText(
        s.dim('Project path') + s.dim(`  [${cwdDisplay}]:`), { stream }
      );
      const rawPath = (pathInput.trim() || cwdDisplay).replace(/\/+$/, '');
      const projectPaths = [];
      if (rawPath) {
        const expanded = rawPath.startsWith('~')
          ? join(home, rawPath.slice(1))
          : rawPath;
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

      // Triage statuses — validate against Jira's actual status names
      const DEFAULT_TRIAGE = 'In Progress, Code Review, QA';
      const statusInput = await promptText(
        s.dim('Triage statuses') + s.dim(`  [default: ${DEFAULT_TRIAGE}]:`), { stream }
      );
      let triageStatuses = statusInput
        ? statusInput.split(',').map(v => v.trim()).filter(Boolean)
        : DEFAULT_TRIAGE.split(',').map(v => v.trim());

      stream.write(`  ${s.dim('Validating statuses...')}\n`);
      try {
        const available = await fetchStatuses({ env, apiVersion });
        const lowerMap = new Map(available.map(n => [n.toLowerCase(), n]));
        stream.write('\x1b[A\r\x1b[2K'); // clear "Validating..." line
        const corrected = [];
        let hasIssues = false;
        for (const name of triageStatuses) {
          if (available.includes(name)) {
            corrected.push(name);
          } else {
            const match = lowerMap.get(name.toLowerCase());
            if (match) {
              stream.write(`  ${s.yellow('~')} ${s.dim(name)}  →  ${s.cyan(match)}\n`);
              corrected.push(match);
              hasIssues = true;
            } else {
              stream.write(`  ${s.red('✖')} ${name}  ${s.dim('(not found in this Jira instance)')}\n`);
              hasIssues = true;
            }
          }
        }
        if (!hasIssues) {
          stream.write(`  ${s.green('✔')} Statuses validated\n`);
        } else if (corrected.length > 0) {
          stream.write(`  ${s.dim('Using:')} ${corrected.map(n => s.cyan(n)).join(s.dim(', '))}\n`);
        }
        triageStatuses = corrected;
      } catch {
        stream.write('\x1b[A\r\x1b[2K'); // clear silently if Jira call fails
      }

      // ── Save ──────────────────────────────────────────────────────────────
      const profileData = {
        baseUrl,
        auth: authType,
        ...(email ? { email } : {}),
        ...(ticketPrefixes.length > 0 ? { ticketPrefixes } : {}),
        ...(projectPaths.length > 0 ? { projectPaths } : {}),
        triageStatuses,
      };
      const credData = authType === 'pat' ? { pat: token } : { apiToken: token };
      saveProfile(profileName, profileData, credData, configDir);
      addedCount++;
      stream.write(`\n  ${s.green('✔')} Profile ${s.bold(s.cyan(`"${profileName}"`))} saved.\n`);
    }
    } // end if jira

    addAnother = await promptYN('Configure another connection?', { stream });
  }

  if (addedCount === 0) {
    stream.write(`\n  ${s.dim('No profiles saved. Run')} ${s.cyan('ticketlens init')} ${s.dim('to try again.')}\n\n`);
    return;
  }

  // ── Select active profile ─────────────────────────────────────────────────
  const finalConfig = loadProfiles(configDir);
  const allNames = finalConfig ? Object.keys(finalConfig.profiles) : [];

  if (allNames.length === 1) {
    await saveDefault(allNames[0], configDir);
  } else if (allNames.length > 1) {
    stream.write(`\n  ${s.dim('Select your active profile:')}\n\n`);
    await runSwitch({ configDir, stream, testConnection: false });
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  const profileWord = addedCount === 1 ? '1 profile' : `${addedCount} profiles`;
  stream.write(`\n  ${s.green('✔')} ${profileWord} configured.\n\n`);

  // Quick-start panel
  const cmds = [
    ['ticketlens triage',   'Scan your assigned tickets'],
    ['ticketlens <TICKET-KEY>', 'Fetch a specific ticket'],
    ['ticketlens switch',   'Switch active profile'],
    ['ticketlens --help',   'Full command reference'],
  ];
  const cmdWidth = cmds.reduce((max, [c]) => Math.max(max, c.length), 0);
  const cmdRows = cmds.map(([cmd, desc]) =>
    `  ${s.bold(s.cyan(cmd.padEnd(cmdWidth)))}   ${s.dim(desc)}`
  );
  const QTITLE = ' Quick start ';
  const contentWidth = cmdRows.reduce((max, r) => Math.max(max, visLen(r)), 0);
  const qWidth = Math.max(contentWidth + 2, QTITLE.length + 4);
  const qPad = (r) => ' ' + r + ' '.repeat(Math.max(0, qWidth - visLen(r) - 1));
  const qTitleFill = qWidth - 1 - QTITLE.length;
  stream.write(bc('╭') + bc('─') + s.bold(s.cyan(QTITLE)) + bc('─'.repeat(Math.max(0, qTitleFill))) + bc('╮') + '\n');
  stream.write(bc('│') + qPad('') + bc('│') + '\n');
  for (const r of cmdRows) stream.write(bc('│') + qPad(r) + bc('│') + '\n');
  stream.write(bc('│') + qPad('') + bc('│') + '\n');
  stream.write(bc('╰') + bc('─'.repeat(qWidth)) + bc('╯') + '\n\n');
}
