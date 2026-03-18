/**
 * Styled help output for TicketLens CLI.
 */

import { readFileSync } from 'node:fs';
import { createStyler } from './ansi.mjs';

let _version;
function getVersion() {
  if (_version) return _version;
  try {
    const pkgPath = new URL('../../../../package.json', import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    _version = pkg.version || '0.0.0';
  } catch {
    _version = '0.0.0';
  }
  return _version;
}

export function printHelp({ stream = process.stdout } = {}) {
  const isTTY = stream.isTTY;
  const s = createStyler({ isTTY });
  const v = getVersion();

  const lines = [
    '',
    `  ${s.bold(s.cyan('◆ TicketLens'))} ${s.dim(`v${v}`)}`,
    `  ${s.dim('Stop tab-switching. Start building.')}`,
    '',
    `  ${s.bold('USAGE')}`,
    '',
    `    ${s.cyan('ticketlens')} init                             Configure Jira connections`,
    `    ${s.cyan('ticketlens')} switch                           Switch active profile`,
    `    ${s.cyan('ticketlens')} config ${s.dim('[--profile=NAME]')}         Edit profile settings`,
    `    ${s.cyan('ticketlens')} ${s.dim('<TICKET-KEY>')} ${s.dim('[options]')}      Fetch a ticket brief`,
    `    ${s.cyan('ticketlens')} triage ${s.dim('[options]')}              Scan your assigned tickets`,
    `    ${s.cyan('ticketlens')} activate ${s.dim('<KEY>')}                Activate a license key`,
    `    ${s.cyan('ticketlens')} license                          Show license status`,
    '',
    `  ${s.bold('FETCH OPTIONS')}`,
    '',
    `    ${s.cyan('--profile')}=${s.dim('NAME')}     Use a specific Jira profile`,
    `    ${s.cyan('--depth')}=${s.dim('N')}         Traversal depth ${s.dim('(0=ticket only, 1=+linked, 2=deep)')}`,
    `    ${s.cyan('--plain')}            Plain markdown output ${s.dim('(for piping / LLM)')}`,
    `    ${s.cyan('--styled')}           Force ANSI-styled output`,
    '',
    `  ${s.bold('TRIAGE OPTIONS')}`,
    '',
    `    ${s.cyan('--profile')}=${s.dim('NAME')}     Use a specific Jira profile`,
    `    ${s.cyan('--stale')}=${s.dim('N')}         Aging threshold in days ${s.dim('(default: 5)')}`,
    `    ${s.cyan('--status')}=${s.dim('X,Y')}      Override statuses to scan`,
    `    ${s.cyan('--static')}           Static table output ${s.dim('(skip interactive mode)')}`,
    `    ${s.cyan('--plain')}            Plain markdown output ${s.dim('(for piping / LLM)')}`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens PROJ-123`,
    `    ${s.dim('$')} ticketlens PROJ-123 --depth=0 --profile=myteam`,
    `    ${s.dim('$')} ticketlens triage`,
    `    ${s.dim('$')} ticketlens triage --profile=acme --stale=3`,
    `    ${s.dim('$')} ticketlens triage --static`,
    '',
    `  ${s.bold('CONFIGURATION')}`,
    '',
    `    ${s.dim('Profiles:')}     ~/.ticketlens/profiles.json`,
    `    ${s.dim('Credentials:')}  ~/.ticketlens/credentials.json`,
    `    ${s.dim('License:')}      ~/.ticketlens/license.json`,
    '',
    `    ${s.dim('Or use env vars:')} JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN`,
    '',
    `  ${s.dim('Docs & issues:')} ${s.cyan('https://github.com/ralphmoran/ticket-lens')}`,
    '',
  ];

  stream.write(lines.join('\n') + '\n');
}

export function printFetchHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.cyan('ticketlens'))} ${s.bold('<TICKET-KEY>')} ${s.dim('[options]')}`,
    '',
    `  Fetch a Jira ticket's full context: description, comments,`,
    `  linked issues, and code references.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.cyan('--profile')}=${s.dim('NAME')}     Use a specific Jira profile`,
    `    ${s.cyan('--depth')}=${s.dim('N')}         Traversal depth ${s.dim('(default: 1)')}`,
    `                       ${s.dim('0 = target ticket only')}`,
    `                       ${s.dim('1 = + linked ticket details')}`,
    `                       ${s.dim('2 = + linked-of-linked')}`,
    `    ${s.cyan('--plain')}            Plain markdown output`,
    `    ${s.cyan('--styled')}           Force ANSI-styled output`,
    `    ${s.cyan('-h')}, ${s.cyan('--help')}        Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens PROJ-123`,
    `    ${s.dim('$')} ticketlens PROJ-123 --depth=0`,
    `    ${s.dim('$')} ticketlens PROJ-123 --profile=acme --depth=2`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printTriageHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.cyan('ticketlens'))} ${s.bold('triage')} ${s.dim('[options]')}`,
    '',
    `  Scan your assigned Jira tickets and surface what needs attention.`,
    `  Opens an interactive navigator in TTY mode.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.cyan('--profile')}=${s.dim('NAME')}     Use a specific Jira profile`,
    `    ${s.cyan('--stale')}=${s.dim('N')}         Aging threshold in days ${s.dim('(default: 5)')}`,
    `    ${s.cyan('--status')}=${s.dim('X,Y')}      Override statuses to scan`,
    `    ${s.cyan('--static')}           Static table output ${s.dim('(skip interactive mode)')}`,
    `    ${s.cyan('--plain')}            Plain markdown output`,
    `    ${s.cyan('-h')}, ${s.cyan('--help')}        Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens triage`,
    `    ${s.dim('$')} ticketlens triage --profile=acme`,
    `    ${s.dim('$')} ticketlens triage --stale=3 --status="Code Review,QA Testing"`,
    `    ${s.dim('$')} ticketlens triage --static`,
    '',
    `  ${s.bold('INTERACTIVE MODE')}`,
    '',
    `    ${s.dim('↑/↓')}    Navigate tickets`,
    `    ${s.dim('Enter')}  Open ticket in browser`,
    `    ${s.dim('q/Esc')}  Exit`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}
