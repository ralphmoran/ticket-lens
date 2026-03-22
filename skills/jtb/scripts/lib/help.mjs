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

  // Column targets (visible chars):
  //   USAGE: command portion = 36, so descriptions always start at the same column
  //   OPTIONS: flag portion = 19, so descriptions always start at the same column
  //
  // Spaces after each item are computed as: target - visibleWidth(item)
  // ANSI codes (s.cyan, s.dim) add invisible bytes — they do NOT affect visible width.

  const lines = [
    '',
    `  ${s.bold(s.cyan('◆ TicketLens'))} ${s.dim(`v${v}`)}`,
    `  ${s.dim('Stop tab-switching. Start building.')}`,
    '',
    `  ${s.bold('USAGE')}`,
    '',
    // visible widths: "ticketlens init"=15, "switch"=17, "config [--profile=NAME]"=34,
    // "<TICKET-KEY> [options]"=33, "triage [options]"=27, "activate <KEY>"=25,
    // "license"=18, "cache [size|clear]"=29  →  target=36
    // Groups: Setup ─── Daily use ─── Account / Maintenance
    `    ${s.cyan('ticketlens')} init                     Configure Jira connections`,
    `    ${s.cyan('ticketlens')} switch                   Switch active profile`,
    `    ${s.cyan('ticketlens')} config ${s.dim('[--profile=NAME]')}  Edit profile settings`,
    '',
    `    ${s.cyan('ticketlens')} ${s.dim('<TICKET-KEY>')} ${s.dim('[options]')}   Fetch a ticket brief`,
    `    ${s.cyan('ticketlens')} get ${s.dim('<TICKET-KEY>')}         Same as above ${s.dim('(explicit alias)')}`,
    `    ${s.cyan('ticketlens')} triage ${s.dim('[options]')}         Scan your assigned tickets`,
    '',
    `    ${s.cyan('ticketlens')} delete ${s.dim('<PROFILE-NAME>')}     Remove a profile`,
    `    ${s.cyan('ticketlens')} activate ${s.dim('<KEY>')}           Activate a license key`,
    `    ${s.cyan('ticketlens')} license                  Show license status`,
    `    ${s.cyan('ticketlens')} cache ${s.dim('[size|clear]')}       Manage attachment cache  ${s.dim('(try cache --help)')}`,
    '',
    `  ${s.bold('FETCH OPTIONS')}`,
    '',
    // visible widths: "--profile=NAME"=14, "--depth=N"=9, "--plain"=7, "--styled"=8,
    // "--no-attachments"=16, "--no-cache"=10  →  target=19
    `    ${s.cyan('--profile')}=${s.dim('NAME')}     Use a specific Jira profile`,
    `    ${s.cyan('--depth')}=${s.dim('N')}          Traversal depth ${s.dim('(0=ticket only, 1=+linked, 2=deep)')}`,
    `    ${s.cyan('--plain')}            Plain markdown output ${s.dim('(for piping / LLM)')}`,
    `    ${s.cyan('--styled')}           Force ANSI-styled output`,
    `    ${s.cyan('--no-attachments')}   Skip downloading attachments`,
    `    ${s.cyan('--no-cache')}         Re-download attachments even if cached`,
    '',
    `  ${s.bold('TRIAGE OPTIONS')}`,
    '',
    // visible widths: "--profile=NAME"=14, "--stale=N"=9, "--status=X,Y"=12,
    // "--assignee=NAME"=15, "--sprint=NAME"=13, "--static"=8, "--plain"=7  →  target=19
    `    ${s.cyan('--profile')}=${s.dim('NAME')}     Use a specific Jira profile`,
    `    ${s.cyan('--stale')}=${s.dim('N')}          Aging threshold in days ${s.dim('(default: 5)')}`,
    `    ${s.cyan('--status')}=${s.dim('X,Y')}       Override statuses to scan`,
    `    ${s.cyan('--assignee')}=${s.dim('NAME')}    Triage another dev's tickets  ${s.dim('[Team]')}`,
    `    ${s.cyan('--sprint')}=${s.dim('NAME')}      Filter by sprint name  ${s.dim('[Team]')}`,
    `    ${s.cyan('--static')}           Static table output ${s.dim('(skip interactive mode)')}`,
    `    ${s.cyan('--plain')}            Plain markdown output ${s.dim('(for piping / LLM)')}`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens PROJ-123`,
    `    ${s.dim('$')} ticketlens get PROJ-123 --depth=0 --profile=myteam`,
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
    // visible widths: "--profile=NAME"=14, "--depth=N"=9, "--plain"=7, "--styled"=8,
    // "--no-attachments"=16, "--no-cache"=10, "-h, --help"=10  →  target=19
    `    ${s.cyan('--depth')}=${s.dim('N')}          Traversal depth ${s.dim('(default: 1)')}`,
    `                       ${s.dim('0 = target ticket only')}`,
    `                       ${s.dim('1 = + linked ticket details')}`,
    `                       ${s.dim('2 = + linked-of-linked')}`,
    `    ${s.cyan('--plain')}            Plain markdown output`,
    `    ${s.cyan('--styled')}           Force ANSI-styled output`,
    `    ${s.cyan('--no-attachments')}   Skip downloading attachments`,
    `    ${s.cyan('--no-cache')}         Re-download attachments even if cached`,
    `    ${s.cyan('-h')}, ${s.cyan('--help')}         Show this help`,
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
    // visible widths: "--profile=NAME"=14, "--stale=N"=9, "--status=X,Y"=12,
    // "--assignee=NAME"=15, "--sprint=NAME"=13, "--static"=8, "--plain"=7, "-h, --help"=10  →  target=19
    `    ${s.cyan('--profile')}=${s.dim('NAME')}     Use a specific Jira profile`,
    `    ${s.cyan('--stale')}=${s.dim('N')}          Aging threshold in days ${s.dim('(default: 5)')}`,
    `    ${s.cyan('--status')}=${s.dim('X,Y')}       Override statuses to scan`,
    `    ${s.cyan('--assignee')}=${s.dim('NAME')}    Triage another dev's tickets  ${s.dim('[Team]')}`,
    `    ${s.cyan('--sprint')}=${s.dim('NAME')}      Filter by sprint name  ${s.dim('[Team]')}`,
    `    ${s.cyan('--static')}           Static table output ${s.dim('(skip interactive mode)')}`,
    `    ${s.cyan('--plain')}            Plain markdown output`,
    `    ${s.cyan('-h')}, ${s.cyan('--help')}         Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens triage`,
    `    ${s.dim('$')} ticketlens triage --profile=acme`,
    `    ${s.dim('$')} ticketlens triage --stale=3 --status="Code Review,QA Testing"`,
    `    ${s.dim('$')} ticketlens triage --assignee="Jane Dev" --sprint="Sprint 12"`,
    `    ${s.dim('$')} ticketlens triage --static`,
    '',
    `  ${s.bold('INTERACTIVE MODE')}`,
    '',
    `    ${s.dim('↑/↓')}    Navigate tickets`,
    `    ${s.dim('Enter')}  Open ticket in browser`,
    `    ${s.dim('p')}      Switch profile`,
    `    ${s.dim('q/Esc')}  Exit`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}
