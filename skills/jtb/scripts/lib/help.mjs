/**
 * Styled help output for TicketLens CLI.
 */

import { createStyler } from './ansi.mjs';
import { getVersion } from './config.mjs';

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
    `  ${s.bold(s.brand('◆ TicketLens'))} ${s.dim(`v${v}`)}`,
    `  ${s.dim('Stop tab-switching. Start building.')}`,
    '',
    `  ${s.bold('USAGE')}`,
    '',
    // visible widths — target column = 36 visible chars for the command portion
    // Groups: Console sync ─── Setup ─── Daily use ─── Account / Maintenance
    `    ${s.brand('ticketlens')} login                    Connect CLI to your TicketLens account`,
    `    ${s.brand('ticketlens')} logout                   Remove stored credentials`,
    `    ${s.brand('ticketlens')} sync                     Pull tracker profiles from the console`,
    '',
    `    ${s.brand('ticketlens')} init                     Configure connections locally`,
    `    ${s.brand('ticketlens')} switch                   Switch active profile`,
    `    ${s.brand('ticketlens')} config ${s.dim('[--profile=NAME]')}  Edit profile settings`,
    `    ${s.brand('ticketlens')} profiles                 List all configured profiles  ${s.dim('(alias: ls)')}`,
    '',
    `    ${s.brand('ticketlens')} ${s.dim('<TICKET-KEY>')} ${s.dim('[options]')}   Fetch a ticket brief`,
    `    ${s.brand('ticketlens')} get ${s.dim('<TICKET-KEY>')}         Same as above ${s.dim('(explicit alias)')}`,
    `    ${s.brand('ticketlens')} triage ${s.dim('[options]')}         Scan your assigned tickets`,
    `    ${s.brand('ticketlens')} compliance ${s.dim('<TICKET-KEY>')}    Check requirements coverage  ${s.dim('[Pro/Free 3/mo]')}`,
    '',
    `    ${s.brand('ticketlens')} delete ${s.dim('<PROFILE-NAME>')}     Remove a profile`,
    `    ${s.brand('ticketlens')} activate ${s.dim('<KEY>')}           Activate a license key`,
    `    ${s.brand('ticketlens')} license                  Show license status`,
    `    ${s.brand('ticketlens')} cache ${s.dim('[size|clear]')}       Manage attachment cache  ${s.dim('(try cache --help)')}`,
    `    ${s.brand('ticketlens')} schedule ${s.dim('[--stop|--status]')} Manage digest schedule  ${s.dim('[Pro]')}`,
    '',
    `  ${s.bold('FETCH OPTIONS')}`,
    '',
    // visible widths: "--profile=NAME"=14, "--depth=N"=9, "--plain"=7, "--styled"=8,
    // "--no-attachments"=16, "--no-cache"=10  →  target=19
    `    ${s.brand('--profile')}=${s.dim('NAME')}     Use a specific Jira profile`,
    `    ${s.brand('--depth')}=${s.dim('N')}          Traversal depth ${s.dim('(0=ticket only, 1=+linked, 2=deep)')}`,
    `    ${s.brand('--plain')}            Plain markdown output ${s.dim('(for piping / LLM)')}`,
    `    ${s.brand('--styled')}           Force ANSI-styled output`,
    `    ${s.brand('--no-attachments')}   Skip downloading attachments`,
    `    ${s.brand('--no-cache')}         Re-download attachments even if cached`,
    `    ${s.brand('--check')}            Append VCS diff + review instructions for Claude Code`,
    `    ${s.brand('--compliance')}       Check ticket requirements against local diff  ${s.dim('[Pro/Free 3/mo]')}`,
    `    ${s.brand('--summarize')}        Generate AI summary ${s.dim('(BYOK or --cloud) [Pro]')}`,
    `    ${s.brand('--cloud')}            Route summary through TicketLens API ${s.dim('[Pro]')}`,
    '',
    `  ${s.bold('TRIAGE OPTIONS')}`,
    '',
    // visible widths: "--profile=NAME"=14, "--stale=N"=9, "--status=X,Y"=12,
    // "--assignee=NAME"=15, "--sprint=NAME"=13, "--static"=8, "--plain"=7  →  target=19
    `    ${s.brand('--profile')}=${s.dim('NAME')}     Use a specific Jira profile`,
    `    ${s.brand('--stale')}=${s.dim('N')}          Aging threshold in days ${s.dim('(default: 5)')}`,
    `    ${s.brand('--status')}=${s.dim('X,Y')}       Override statuses to scan`,
    `    ${s.brand('--assignee')}=${s.dim('NAME')}    Triage another dev's tickets  ${s.dim('[Team]')}`,
    `    ${s.brand('--sprint')}=${s.dim('NAME')}      Filter by sprint name  ${s.dim('[Team]')}`,
    `    ${s.brand('--export')}=${s.dim('FORMAT')}   Export results to file  ${s.dim('(csv|json) [Team]')}`,
    `    ${s.brand('--digest')}           POST scored results to digest endpoint  ${s.dim('[Pro]')}`,
    `    ${s.brand('--static')}           Static table output ${s.dim('(skip interactive mode)')}`,
    `    ${s.brand('--plain')}            Plain markdown output ${s.dim('(for piping / LLM)')}`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens login                   ${s.dim('# first-time setup')}`,
    `    ${s.dim('$')} ticketlens sync                    ${s.dim('# pull connections from console')}`,
    `    ${s.dim('$')} ticketlens PROJ-123`,
    `    ${s.dim('$')} ticketlens get PROJ-123 --depth=0 --profile=myteam`,
    `    ${s.dim('$')} ticketlens triage`,
    `    ${s.dim('$')} ticketlens triage --profile=acme --stale=3`,
    `    ${s.dim('$')} ticketlens triage --static`,
    '',
    `  ${s.bold('CONFIGURATION')}`,
    '',
    `    ${s.dim('CLI token:')}    ~/.ticketlens/cli-token  ${s.dim('(written by ticketlens login)')}`,
    `    ${s.dim('Profiles:')}     ~/.ticketlens/profiles.json`,
    `    ${s.dim('Credentials:')}  ~/.ticketlens/credentials.json`,
    `    ${s.dim('License:')}      ~/.ticketlens/license.json`,
    '',
    `    ${s.dim('Or use env vars:')} JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN`,
    `    ${s.dim('               ')} TICKETLENS_API_URL  ${s.dim('(override API host for local dev)')}`,
    '',
    '',
  ];

  stream.write(lines.join('\n') + '\n');
}

export function printFetchHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('<TICKET-KEY>')} ${s.dim('[options]')}`,
    '',
    `  Fetch a Jira ticket's full context: description, comments,`,
    `  linked issues, and code references.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--profile')}=${s.dim('NAME')}     Use a specific Jira profile`,
    // visible widths: "--profile=NAME"=14, "--depth=N"=9, "--plain"=7, "--styled"=8,
    // "--no-attachments"=16, "--no-cache"=10, "-h, --help"=10  →  target=19
    `    ${s.brand('--depth')}=${s.dim('N')}          Traversal depth ${s.dim('(default: 1)')}`,
    `                       ${s.dim('0 = target ticket only')}`,
    `                       ${s.dim('1 = + linked ticket details')}`,
    `                       ${s.dim('2 = + linked-of-linked')}`,
    `    ${s.brand('--plain')}            Plain markdown output`,
    `    ${s.brand('--styled')}           Force ANSI-styled output`,
    `    ${s.brand('--no-attachments')}   Skip downloading attachments`,
    `    ${s.brand('--no-cache')}         Re-download attachments even if cached`,
    `    ${s.brand('--check')}            Append VCS diff + review instructions for Claude Code`,
    `    ${s.brand('--compliance')}       Check ticket requirements against local diff  ${s.dim('[Pro/Free 3/mo]')}`,
    `    ${s.brand('--summarize')}        Generate AI summary ${s.dim('(BYOK or --cloud) [Pro]')}`,
    `    ${s.brand('--cloud')}            Route summary through TicketLens API ${s.dim('[Pro]')}`,
    `    ${s.brand('-h')}, ${s.brand('--help')}         Show this help`,
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

const ANSI_RE_HELP = /\x1b\[[0-9;]*m/g;
function padRightVis(str, len) {
  const vis = str.replace(ANSI_RE_HELP, '').length;
  return str + ' '.repeat(Math.max(0, len - vis));
}

export function printProfiles({ stream = process.stdout, config, plain = false } = {}) {
  const isTTY = !plain && stream.isTTY;
  const s = createStyler({ isTTY });
  const profiles = config?.profiles || {};
  const names = Object.keys(profiles);

  if (names.length === 0) {
    stream.write(`\n  No profiles configured.\n  Run ${s.cyan('ticketlens init')} to set one up.\n\n`);
    return;
  }

  // Active = explicitly set default, else first profile in file
  const active = config?.default || names[0];
  const defaultIsExplicit = !!config?.default;

  const getData = (name) => {
    const p = profiles[name];
    return {
      prefixes: (p.ticketPrefixes || []).join(', ') || '—',
      statuses: (p.triageStatuses || []).join(', ') || '—',
      url: p.baseUrl || '',
    };
  };

  if (plain) {
    for (const name of names) {
      const { url, prefixes, statuses } = getData(name);
      stream.write(`${name}\t${name === active ? 'active' : 'inactive'}\t${url}\t${prefixes}\t${statuses}\n`);
    }
    return;
  }

  const MAX_STATUS_W = 45;
  const nameW = Math.max('Profile'.length, ...names.map(n => n.length));
  const urlW = Math.max('URL'.length, ...names.map(n => getData(n).url.length));
  const prefW = Math.max('Prefixes'.length, ...names.map(n => getData(n).prefixes.length));

  // Header + separator (4 chars before name = 2 leading + indicator + space)
  const hdr = `    ${padRightVis('Profile', nameW + 2)}${padRightVis('URL', urlW + 2)}${padRightVis('Prefixes', prefW + 2)}Statuses`;
  const sep = `    ${'─'.repeat(nameW).padEnd(nameW + 2)}${'─'.repeat(urlW).padEnd(urlW + 2)}${'─'.repeat(prefW).padEnd(prefW + 2)}${'─'.repeat('Statuses'.length)}`;

  const lines = ['', s.dim(hdr), s.dim(sep)];

  for (const name of names) {
    const { url, prefixes, statuses } = getData(name);
    const isActive = name === active;
    const indicator = isActive ? s.green('●') : s.dim('○');
    const nameStyled = isActive ? s.bold(s.cyan(name)) : name;
    const statusDisplay = statuses.length > MAX_STATUS_W
      ? statuses.slice(0, MAX_STATUS_W - 1) + '…'
      : statuses;
    lines.push(
      `  ${indicator} ` +
      padRightVis(nameStyled, nameW + 2) +
      url.padEnd(urlW + 2) +
      prefixes.padEnd(prefW + 2) +
      statusDisplay
    );
  }
  lines.push('');

  const activeNote = defaultIsExplicit
    ? `${s.dim('Active:')} ${s.cyan(active)}`
    : `${s.dim('Active:')} ${s.cyan(active)} ${s.dim('(first — run ticketlens switch to set default)')}`;
  lines.push(`  ${activeNote}  ${s.dim('·  ticketlens switch  ·  ticketlens config --profile=NAME')}`);
  lines.push('');

  stream.write(lines.join('\n') + '\n');
}

export function printLoginHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('login')} ${s.dim('[--manual]')}`,
    '',
    `  Connect the CLI to your TicketLens account.`,
    `  Opens a browser window to authorize — no copy-pasting required.`,
    '',
    `  ${s.bold('HOW IT WORKS')}`,
    '',
    `    1. Run ${s.cyan('ticketlens login')} — your browser opens the authorize page`,
    `    2. Click ${s.bold('Authorize TicketLens CLI')} while logged in to the Console`,
    `    3. The terminal confirms login automatically`,
    `    4. Run ${s.cyan('ticketlens sync')} to pull your tracker connections`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--manual')}            Paste a token instead of using the browser`,
    `                       ${s.dim('Useful for CI, SSH sessions, or headless environments.')}`,
    `                       ${s.dim(`Generate a token at ${s.cyan('<console-url>/console/account')}`)}`,
    `    ${s.brand('-h')}, ${s.brand('--help')}         Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens login             ${s.dim('# opens browser (default)')}`,
    `    ${s.dim('$')} ticketlens login --manual     ${s.dim('# paste token (CI / headless)')}`,
    `    ${s.dim('$')} ticketlens sync               ${s.dim('# after login, pull connections')}`,
    '',
    `  ${s.bold('FILES')}`,
    '',
    `    ${s.dim('Token saved to:')}  ~/.ticketlens/cli-token  ${s.dim('(written by ticketlens login)')}`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printLogoutHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('logout')}`,
    '',
    `  Remove the stored CLI token, disconnecting this machine from your`,
    `  TicketLens account. Local profiles and credentials are kept intact.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens logout`,
    `    ${s.dim('$')} ticketlens login   ${s.dim('# re-authenticate')}`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printSyncHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('sync')}`,
    '',
    `  Pull tracker connections from the TicketLens console and write them`,
    `  to ${s.dim('~/.ticketlens/profiles.json')}. Requires ${s.cyan('ticketlens login')} first.`,
    '',
    `  Profiles that need credentials will be listed with a reminder to`,
    `  run ${s.cyan('ticketlens config --profile=NAME')} to add them.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens login`,
    `    ${s.dim('$')} ticketlens sync`,
    `    ${s.dim('$')} ticketlens profiles   ${s.dim('# verify pulled connections')}`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printActivateHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('activate')} ${s.dim('<LICENSE-KEY>')}`,
    '',
    `  Activate a Pro or Team license key to unlock paid features.`,
    `  Validates the key online and writes the result to ${s.dim('~/.ticketlens/license.json')}.`,
    '',
    `  ${s.bold('ARGUMENTS')}`,
    '',
    `    ${s.brand('<LICENSE-KEY>')}   Your LemonSqueezy license key`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('-h')}, ${s.brand('--help')}      Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens activate tl_abc123xxxx`,
    `    ${s.dim('$')} ticketlens license             ${s.dim('# verify activation')}`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printLicenseHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('license')}`,
    '',
    `  Show current license status: tier, email, and last validation date.`,
    `  License is re-validated automatically in the background every 7 days.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens license`,
    `    ${s.dim('$')} ticketlens activate ${s.dim('<KEY>')}   ${s.dim('# activate or renew')}`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printDeleteHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('delete')} ${s.dim('<PROFILE-NAME>')}`,
    '',
    `  Permanently remove a locally configured profile. In TTY mode, prompts`,
    `  for confirmation before deleting. Pass ${s.cyan('--yes')} to skip the prompt.`,
    '',
    `  ${s.bold('ARGUMENTS')}`,
    '',
    `    ${s.brand('<PROFILE-NAME>')}   Name of the profile to remove`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--yes')}, ${s.brand('-y')}     Skip confirmation prompt`,
    `    ${s.brand('-h')}, ${s.brand('--help')}    Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens delete myprofile`,
    `    ${s.dim('$')} ticketlens delete myprofile --yes`,
    `    ${s.dim('$')} ticketlens profiles                ${s.dim('# list remaining profiles')}`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printProfilesHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('profiles')} ${s.dim('[--plain]')}`,
    '',
    `  List all locally configured Jira profiles and their active status.`,
    `  Also available as ${s.cyan('ticketlens ls')}.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--plain')}          Tab-separated output ${s.dim('(for scripting)')}`,
    `    ${s.brand('-h')}, ${s.brand('--help')}     Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens profiles`,
    `    ${s.dim('$')} ticketlens ls`,
    `    ${s.dim('$')} ticketlens profiles --plain`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printScheduleHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('schedule')} ${s.dim('[--stop|--status]')}  ${s.dim('[Pro]')}`,
    '',
    `  Set up a recurring digest email with your triage results. ${s.dim('[Pro]')}`,
    `  Runs an interactive wizard to configure day, time, and timezone.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--stop')}        Cancel the active digest schedule`,
    `    ${s.brand('--status')}      Show current schedule configuration`,
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens schedule`,
    `    ${s.dim('$')} ticketlens schedule --status`,
    `    ${s.dim('$')} ticketlens schedule --stop`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printInitHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('init')}`,
    '',
    `  Configure a new Jira connection locally using an interactive wizard.`,
    `  Supports Jira Cloud ${s.dim('(Basic auth)')} and Jira Server/DC ${s.dim('(Bearer PAT or Basic)')}`,
    '',
    `  After setup, run ${s.cyan('ticketlens PROJ-123')} to fetch your first ticket.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens init`,
    `    ${s.dim('$')} ticketlens profiles   ${s.dim('# verify the new profile')}`,
    '',
    `  ${s.dim('Tip: use')} ${s.cyan('ticketlens sync')} ${s.dim('instead to pull connections from the console.')}`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printSwitchHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('switch')}`,
    '',
    `  Interactively select which profile is active by default.`,
    `  The chosen profile is used when no ${s.cyan('--profile')} flag is given.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens switch`,
    `    ${s.dim('$')} ticketlens profiles   ${s.dim('# confirm new active profile')}`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printConfigHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('config')} ${s.dim('[--profile=NAME]')}`,
    '',
    `  Edit settings for an existing profile using an interactive wizard.`,
    `  Without ${s.cyan('--profile')}, edits the currently active profile.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--profile')}=${s.dim('NAME')}   Profile to configure`,
    `    ${s.brand('-h')}, ${s.brand('--help')}      Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens config`,
    `    ${s.dim('$')} ticketlens config --profile=work`,
    `    ${s.dim('$')} ticketlens config --profile=acme`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printTriageHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('triage')} ${s.dim('[options]')}`,
    '',
    `  Scan your assigned Jira tickets and surface what needs attention.`,
    `  Opens an interactive navigator in TTY mode.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    // visible widths: "--profile=NAME"=14, "--stale=N"=9, "--status=X,Y"=12,
    // "--assignee=NAME"=15, "--sprint=NAME"=13, "--static"=8, "--plain"=7, "-h, --help"=10  →  target=19
    `    ${s.brand('--profile')}=${s.dim('NAME')}     Use a specific Jira profile`,
    `    ${s.brand('--stale')}=${s.dim('N')}          Aging threshold in days ${s.dim('(default: 5)')}`,
    `    ${s.brand('--status')}=${s.dim('X,Y')}       Override statuses to scan`,
    `    ${s.brand('--assignee')}=${s.dim('NAME')}    Triage another dev's tickets  ${s.dim('[Team]')}`,
    `    ${s.brand('--sprint')}=${s.dim('NAME')}      Filter by sprint name  ${s.dim('[Team]')}`,
    `    ${s.brand('--export')}=${s.dim('FORMAT')}    Export results to file  ${s.dim('(csv|json) [Team]')}`,
    `    ${s.brand('--digest')}           POST scored results to digest endpoint  ${s.dim('[Pro]')}`,
    `    ${s.brand('--static')}           Static table output ${s.dim('(skip interactive mode)')}`,
    `    ${s.brand('--plain')}            Plain markdown output`,
    `    ${s.brand('-h')}, ${s.brand('--help')}         Show this help`,
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
