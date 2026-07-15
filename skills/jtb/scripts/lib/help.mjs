/**
 * Styled help output for TicketLens CLI.
 */

import { createStyler } from './ansi.mjs';
import { renderWordmark } from './wordmark.mjs';

export function printHelp({ stream = process.stdout } = {}) {
  const isTTY = stream.isTTY;
  const s = createStyler({ isTTY });

  // Column targets (visible chars):
  //   USAGE: command portion = 36, so descriptions always start at the same column
  //   OPTIONS: flag portion = 19, so descriptions always start at the same column
  //
  // Spaces after each item are computed as: target - visibleWidth(item)
  // ANSI codes (s.cyan, s.dim) add invisible bytes — they do NOT affect visible width.

  const lines = [
    '',
    `  ${s.bold('USAGE')}`,
    '',
    `    ${s.brand('tl')} ${s.dim('<anything>')}                       Shorthand for ${s.brand('ticketlens')}`,
    '',
    // Alignment targets (visible chars before description):
    //   Groups 1–2 (auth/setup):          column 40  (command portion ≤ 24)
    //   Group 3 (daily use):              column 42  (longest: "review [--branch=BRANCH]" = 39)
    //   Group 4 (account/maintenance):    column 43  (longest: "schedule [--stop|--status]" = 41)
    //   cloud-keys [add|remove|list|test] is an outlier at column 50 — kept with 2-space minimum.
    `    ${s.brand('ticketlens')} login                    Connect CLI to your TicketLens account`,
    `    ${s.brand('ticketlens')} logout                   Remove stored credentials`,
    `    ${s.brand('ticketlens')} sync                     Pull tracker profiles from the console`,
    '',
    `    ${s.brand('ticketlens')} init                     Configure connections locally`,
    `    ${s.brand('ticketlens')} switch                   Switch active profile`,
    `    ${s.brand('ticketlens')} config ${s.dim('[--profile=NAME]')}  Edit profile settings`,
    `    ${s.brand('ticketlens')} profiles                 List all configured profiles  ${s.dim('(alias: ls)')}`,
    '',
    `    ${s.brand('ticketlens')} ${s.dim('<TICKET-KEY>')} ${s.dim('[options]')}     Fetch a ticket brief`,
    `    ${s.brand('ticketlens')} get ${s.dim('<TICKET-KEY>')}           Same as above ${s.dim('(explicit alias)')}`,
    `    ${s.brand('ticketlens')} triage ${s.dim('[options]')}           Scan your assigned tickets`,
    `    ${s.brand('ticketlens')} collisions ${s.dim('[--json]')}        Show branch collisions with teammates  ${s.dim('[Team]')}`,
    `    ${s.brand('ticketlens')} review ${s.dim('[--branch=BRANCH]')}   Code-review context brief from current branch`,
    `    ${s.brand('ticketlens')} standup ${s.dim('[--since=N]')}        Standup summary from git log  ${s.dim('(last 24h by default)')}`,
    `    ${s.brand('ticketlens')} compliance ${s.dim('<TICKET-KEY>')}    Check requirements coverage  ${s.dim('[Pro/Free 3/mo]')}`,
    `    ${s.brand('ticketlens')} history ${s.dim('<TICKET-KEY>')}       Urgency timeline for a ticket  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} stats ${s.dim('[options]')}            Personal response-time metrics from local history`,
    `    ${s.brand('ticketlens')} note add ${s.dim('--title=... [--ticket=KEY]')}  Save a Recall note  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} recall ${s.dim('<query|TICKET-KEY>')}   Search your saved Recall notes  ${s.dim('[Pro]')}`,
    '',
    `    ${s.brand('ticketlens')} delete ${s.dim('<PROFILE-NAME>')}       Remove a profile`,
    `    ${s.brand('ticketlens')} activate ${s.dim('<KEY>')}              Activate a license key`,
    `    ${s.brand('ticketlens')} license                     Show license status`,
    `    ${s.brand('ticketlens')} cache ${s.dim('[size|clear]')}          Manage attachment cache  ${s.dim('(try cache --help)')}`,
    `    ${s.brand('ticketlens')} schedule ${s.dim('[--stop|--status]')}  Manage digest schedule  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} cloud-keys ${s.dim('[add|remove|list|test]')}  Manage your encrypted AI provider keys  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} update-skill ${s.dim('[--dry-run]')}    Update /jtb skill in Claude Code and other AI assistants`,
    '',
    `  ${s.bold('GLOBAL OPTIONS')}`,
    '',
    `    ${s.brand('--no-input')}          Force non-interactive behavior even in a terminal`,
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
    `    ${s.brand('--handoff')}          AI handoff brief from comment thread ${s.dim('(BYOK or --cloud) [Pro]')}`,
    `    ${s.brand('--cloud')}            Route AI request through TicketLens API ${s.dim('[Pro]')}`,
    `    ${s.brand('--provider')}=${s.dim('NAME')}    Force AI provider ${s.dim('(anthropic|openai|groq)')}`,
    `    ${s.brand('--template')}=${s.dim('SLUG')}    Apply a brief template ${s.dim('(full|quick|code-review, or custom [Team])')}`,
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
    `    ${s.brand('--project')}=${s.dim('PROJ')}     Filter by Jira project key  ${s.dim('[Team]')}`,
    `    ${s.brand('--label')}=${s.dim('X,Y')}        Filter by label(s)  ${s.dim('[Team]')}`,
    `    ${s.brand('--priority')}=${s.dim('LEVEL')}   Filter by priority  ${s.dim('(e.g. High, Blocker) [Team]')}`,
    `    ${s.brand('--export')}=${s.dim('FORMAT')}    Export results to file  ${s.dim('(csv|json) [Team]')}`,
    `    ${s.brand('--push')}             Push snapshot to Console queue  ${s.dim('[Team]')}`,
    `    ${s.brand('--share')}            Generate a 24h share URL  ${s.dim('(no login required) [Team]')}`,
    `    ${s.brand('--all')}              Triage all configured profiles at once  ${s.dim('[Pro]')}`,
    `    ${s.brand('--save')}=${s.dim('FILE')}        Save ANSI-stripped output to file  ${s.dim('[Pro]')}`,
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
    `    ${s.dim('BYOK AI keys')}  ${s.dim('(stored encrypted on your account):')}`,
    `    ${s.dim('               ')} ticketlens cloud-keys add groq ${s.dim('<key>')}`,
    `    ${s.dim('               ')} ticketlens cloud-keys add anthropic ${s.dim('<key>')}`,
    `    ${s.dim('               ')} ticketlens cloud-keys add openai ${s.dim('<key>')}`,
    `    ${s.dim('               ')} ${s.dim('Set default:')} ticketlens config set aiProvider ${s.dim('<anthropic|openai|groq>')}`,
    `    ${s.dim('               ')} ${s.dim('Or manage keys at:')} ${s.dim('Console → Admin → AI Settings')}`,
    '',
    '',
  ];

  stream.write(renderWordmark({ stream }) + lines.join('\n') + '\n');
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
    `    ${s.brand('--handoff')}          AI handoff brief from comment thread ${s.dim('(BYOK or --cloud) [Pro]')}`,
    `    ${s.brand('--cloud')}            Route AI request through TicketLens API ${s.dim('[Pro]')}`,
    `    ${s.brand('--provider')}=${s.dim('NAME')}    Force AI provider ${s.dim('(anthropic|openai|groq)')}`,
    `    ${s.brand('--template')}=${s.dim('SLUG')}    Apply a brief template ${s.dim('(full|quick|code-review, or custom [Team])')}`,
    `    ${s.brand('-h')}, ${s.brand('--help')}         Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens PROJ-123`,
    `    ${s.dim('$')} ticketlens PROJ-123 --depth=0`,
    `    ${s.dim('$')} ticketlens PROJ-123 --profile=acme --depth=2`,
    `    ${s.dim('$')} ticketlens PROJ-123 --handoff`,
    `    ${s.dim('$')} ticketlens PROJ-123 --handoff --cloud`,
    `    ${s.dim('$')} ticketlens PROJ-123 --summarize --provider=groq`,
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

export function printNoteHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('note add')} ${s.dim('--title="..." [--ticket=KEY] [--tags=a,b]')}  ${s.dim('[Pro]')}`,
    '',
    `  Save a short note about a ticket to your local Recall vault. ${s.dim('[Pro]')}`,
    `  Notes are saved at ${s.cyan('~/.ticketlens/recall/')} and matched into future ticket briefs.`,
    `  The note body is read from stdin.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--title')}=${s.dim('TEXT')}        Note title ${s.dim('(required)')}`,
    `    ${s.brand('--ticket')}=${s.dim('KEY')}        Ticket this note is about ${s.dim('(optional — omit for a general note)')}`,
    `    ${s.brand('--tags')}=${s.dim('a,b')}          Comma-separated tags`,
    `    ${s.brand('--include-attachments')}  Seed the note with text from this ticket's cached attachments`,
    `    ${s.brand('--plain')}       Plain confirmation, no color (default when piped)`,
    `    ${s.brand('-h')}, ${s.brand('--help')}        Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} echo "Retry needs exponential backoff" | ticketlens note add --title="Retry gotcha" --ticket=PROD-123 --tags=bug`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printRecallHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('recall')} ${s.dim('<query|TICKET-KEY>')}  ${s.dim('[Pro]')}`,
    '',
    `  Search your saved Recall notes. Local only — no network calls. ${s.dim('[Pro]')}`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--plain')}       Plain output, no color (default when piped)`,
    `    ${s.brand('--full')}        Print each matching note's full body content`,
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens recall PROD-123`,
    `    ${s.dim('$')} ticketlens recall "retry backoff"`,
    `    ${s.dim('$')} ticketlens recall PROD-123 --plain`,
    `    ${s.dim('$')} ticketlens recall PROD-123 --full`,
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
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('config set aiProvider')} ${s.dim('<anthropic|openai|groq>')}`,
    '',
    `  Edit settings for an existing profile using an interactive wizard.`,
    `  Without ${s.cyan('--profile')}, edits the currently active profile.`,
    '',
    `  Use ${s.cyan('config set aiProvider')} to set a persistent default AI provider`,
    `  for ${s.cyan('--summarize')} and ${s.cyan('--handoff')}. Overridden per-command with ${s.cyan('--provider=')}.`,
    '',
    `  ${s.bold('SUBCOMMANDS')}`,
    '',
    `    ${s.brand('set aiProvider')} ${s.dim('<PROVIDER>')}   Persist default AI provider`,
    `                            ${s.dim('anthropic')} = Claude Haiku ${s.dim('(paid)')}`,
    `                            ${s.dim('openai')}    = GPT-4o mini ${s.dim('(paid)')}`,
    `                            ${s.dim('groq')}      = Llama 3.1 ${s.dim('(free tier)')}`,
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
    `    ${s.dim('$')} ticketlens config set aiProvider groq`,
    `    ${s.dim('$')} ticketlens config set aiProvider anthropic`,
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
    `    ${s.brand('--project')}=${s.dim('PROJ')}     Filter by Jira project key  ${s.dim('[Team]')}`,
    `    ${s.brand('--label')}=${s.dim('X,Y')}        Filter by label(s)  ${s.dim('[Team]')}`,
    `    ${s.brand('--priority')}=${s.dim('LEVEL')}   Filter by priority  ${s.dim('(e.g. High, Blocker) [Team]')}`,
    `    ${s.brand('--export')}=${s.dim('FORMAT')}    Export results to file  ${s.dim('(csv|json) [Team]')}`,
    `    ${s.brand('--push')}             Push snapshot to Console queue  ${s.dim('[Team]')}`,
    `    ${s.brand('--share')}            Generate a 24h share URL  ${s.dim('(no login required) [Team]')}`,
    `    ${s.brand('--all')}              Triage all configured profiles at once  ${s.dim('[Pro]')}`,
    `    ${s.brand('--save')}=${s.dim('FILE')}        Save ANSI-stripped output to file  ${s.dim('[Pro]')}`,
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
    `    ${s.dim('$')} ticketlens triage --project=MYPROJ --priority=High`,
    `    ${s.dim('$')} ticketlens triage --label=Bug,P1`,
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

export function printReviewHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('review')} ${s.dim('[--branch=BRANCH] [--profile=NAME]')}`,
    '',
    `  Assemble a code-review context brief from your current branch.`,
    `  Extracts linked ticket keys from the branch name and commit messages,`,
    `  fetches each ticket, and outputs a markdown brief for AI-assisted review.`,
    '',
    `  Requirements coverage analysis against the diff is available on ${s.dim('[Pro]')}.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--branch')}=${s.dim('BRANCH')}   Compare against this branch ${s.dim('(default: auto-detect main/master/develop)')}`,
    `    ${s.brand('--base')}=${s.dim('BRANCH')}     Alias for ${s.dim('--branch')}`,
    `    ${s.brand('--profile')}=${s.dim('NAME')}  Use a specific tracker profile for ticket fetching`,
    `    ${s.brand('-h')}, ${s.brand('--help')}       Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens review`,
    `    ${s.dim('$')} ticketlens review --branch=main`,
    `    ${s.dim('$')} ticketlens review --branch=main --profile=myteam`,
    `    ${s.dim('$')} ticketlens review --branch=main | pbcopy ${s.dim('# copy brief to clipboard')}`,
    '',
    `  ${s.bold('OUTPUT SECTIONS')}`,
    '',
    `    Branch, Changed files, Ticket context`,
    `    Requirements coverage ${s.dim('[Pro]')}, Review focus ${s.dim('[Pro]')}`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printUpdateSkillHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('update-skill')} ${s.dim('[--dry-run] [--path=DIR] [--quiet]')}`,
    '',
    `  Copy the latest /jtb SKILL.md into every detected AI assistant command directory.`,
    `  Runs automatically on ${s.dim('npm install -g ticketlens')} for existing installs.`,
    '',
    `  ${s.bold('SUPPORTED ASSISTANTS')}`,
    '',
    `    Claude Code         ${s.dim('~/.claude/commands/jtb.md')}`,
    `    Claude Code (work)  ${s.dim('~/.claude-work/commands/jtb.md')}`,
    `    Gemini CLI          ${s.dim('~/.gemini/commands/jtb.md')}`,
    `    Copilot CLI         ${s.dim('~/.copilot-cli/commands/jtb.md')}`,
    '',
    `  Only targets where ${s.dim('jtb.md')} already exists are updated. Use ${s.dim('--path')} to install`,
    `  into a new location (the directory must exist).`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--dry-run')}          Show what would change without writing any files`,
    `    ${s.brand('--path')}=${s.dim('DIR')}       Write to a specific commands directory instead`,
    `    ${s.brand('--quiet')}            Suppress all output except errors`,
    `    ${s.brand('-h')}, ${s.brand('--help')}      Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens update-skill`,
    `    ${s.dim('$')} ticketlens update-skill --dry-run`,
    `    ${s.dim('$')} ticketlens update-skill --path=~/.config/my-ai/commands`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printCollisionsHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('collisions')} ${s.dim('[--json] [--plain]')}`,
    '',
    `  Show branches where your changed files overlap with a teammate's.`,
    `  Reads the most recent snapshot pushed by you and each teammate (within 7 days).`,
    `  Requires a ${s.bold('Team')} license and at least one teammate in your group.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--json')}     Output raw JSON array of collision objects`,
    `    ${s.brand('--plain')}    Plain text output ${s.dim('(no ANSI colour)')}`,
    `    ${s.brand('-h')}, ${s.brand('--help')}  Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens collisions`,
    `    ${s.dim('$')} ticketlens collisions --json`,
    `    ${s.dim('$')} ticketlens collisions --plain`,
    '',
    `  ${s.bold('NOTES')}`,
    '',
    `    Branch data is captured automatically when you run ${s.brand('ticketlens triage --push')}.`,
    `    Snapshots older than 7 days are ignored.`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printStatsHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('stats')} ${s.dim('[--days=N] [--format=plain|json] [--profile=NAME]')}`,
    '',
    `  Show response-time and triage-cadence metrics from your local triage history.`,
    `  Reads daily snapshots captured by ${s.brand('ticketlens triage --push')} or the CLI.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    // visible widths: "--days=N"=8, "--format=plain"=14, "--format=json"=13,
    // "--profile=NAME"=14, "-h, --help"=10  →  target col = 19
    `    ${s.brand('--days')}=${s.dim('N')}           Lookback window in days  ${s.dim('(default: 7, Free max: 7, Pro max: 30)')}`,
    `    ${s.brand('--format')}=${s.dim('plain')}     Human-readable table  ${s.dim('(default)')}`,
    `    ${s.brand('--format')}=${s.dim('json')}      JSON output for scripting/piping`,
    `    ${s.brand('--profile')}=${s.dim('NAME')}     Use a specific tracker profile`,
    `    ${s.brand('-h')}, ${s.brand('--help')}         Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens stats`,
    `    ${s.dim('$')} ticketlens stats --days=14             ${s.dim('# Pro only')}`,
    `    ${s.dim('$')} ticketlens stats --format=json | jq .`,
    `    ${s.dim('$')} ticketlens stats --profile=myteam`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printStandupHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('standup')} ${s.dim('[--since=N] [--format=standup|pr] [--profile=NAME] [--plain]')}`,
    '',
    `  Generate a standup summary or PR body from your recent git commits.`,
    `  Reads git log for the last 24 hours, groups commits by ticket key,`,
    `  and optionally enriches output with ticket summaries via a Jira profile.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--since')}=${s.dim('N')}          Look back N hours  ${s.dim('(default: 24)')}`,
    `                       Also accepts git date strings: ${s.dim('--since=yesterday')}, ${s.dim('--since=2024-01-15')}`,
    `    ${s.brand('--format')}=${s.dim('standup')}   Bullet list grouped by ticket  ${s.dim('(default)')}`,
    `    ${s.brand('--format')}=${s.dim('pr')}        PR body: "What changed" + commit list`,
    `    ${s.brand('--profile')}=${s.dim('NAME')}  Use a specific tracker profile to fetch ticket summaries`,
    `    ${s.brand('--plain')}           Plain markdown output ${s.dim('(no ANSI colour)')}`,
    `    ${s.brand('-h')}, ${s.brand('--help')}      Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens standup`,
    `    ${s.dim('$')} ticketlens standup --since=48`,
    `    ${s.dim('$')} ticketlens standup --format=pr`,
    `    ${s.dim('$')} ticketlens standup --profile=myteam`,
    `    ${s.dim('$')} ticketlens standup --plain | pbcopy  ${s.dim('# copy standup to clipboard')}`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printCloudKeysHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('cloud-keys')} ${s.dim('<subcommand> [options]')}`,
    '',
    `  Manage per-account AI provider keys stored encrypted on the TicketLens backend.`,
    `  Requires ${s.bold('ticketlens login')}. Keys are scoped to your account and never shared.`,
    '',
    `  ${s.bold('SUBCOMMANDS')}`,
    '',
    `    ${s.brand('list')}                          List configured providers`,
    `    ${s.brand('add')} ${s.dim('<provider> <key>')}         Add or replace an API key`,
    `    ${s.brand('remove')} ${s.dim('<provider>')}            Remove a provider's key`,
    `    ${s.brand('test')} ${s.dim('<provider>')}              Send a test request through the provider`,
    `    ${s.brand('priority')} ${s.dim('<provider> <N>')}      Set priority (lower = tried first)`,
    `    ${s.brand('timeout')} ${s.dim('<provider> <seconds>')} Set per-request timeout`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--timeout')}=${s.dim('N')}   Timeout in seconds when adding a key  ${s.dim('(default: 5)')}`,
    `    ${s.brand('-h')}, ${s.brand('--help')}  Show this help`,
    '',
    `  ${s.bold('PROVIDERS')}`,
    '',
    `    groq        Llama 3.x — free tier at ${s.dim('console.groq.com')}`,
    `    anthropic   Claude — ${s.dim('console.anthropic.com')}`,
    `    openai      GPT-4o — ${s.dim('platform.openai.com')}`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens cloud-keys list`,
    `    ${s.dim('$')} ticketlens cloud-keys add groq gsk_xxxxxxxxxxxxxxxxxxxx`,
    `    ${s.dim('$')} ticketlens cloud-keys add groq gsk_xxx --timeout=10`,
    `    ${s.dim('$')} ticketlens cloud-keys test groq`,
    `    ${s.dim('$')} ticketlens cloud-keys remove groq`,
    `    ${s.dim('$')} ticketlens cloud-keys priority groq 1`,
    `    ${s.dim('$')} ticketlens cloud-keys timeout anthropic 15`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}
