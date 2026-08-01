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
    `    ${s.brand('ticketlens')} install-hooks ${s.dim('[--uninstall]')}  Git pre-push compliance gate`,
    `    ${s.brand('ticketlens')} pr ${s.dim('<TICKET-KEY>')}             Assemble a PR description from ticket context`,
    `    ${s.brand('ticketlens')} ledger ${s.dim('[--format=json|csv]')}  Export your signed usage ledger  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} history ${s.dim('<TICKET-KEY>')}       Urgency timeline for a ticket  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} stats ${s.dim('[options]')}            Personal response-time metrics from local history`,
    `    ${s.brand('ticketlens')} note add ${s.dim('--title=... [--ticket=KEY]')}  Save a Recall note  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} note delete ${s.dim('--id=... [--ticket=KEY]')}  Remove a note from your local vault  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} recall ${s.dim('<query|TICKET-KEY>')}   Search your saved Recall notes  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} recall sync                 Retry any notes stuck in the local queue  ${s.dim('[Team+]')}`,
    `    ${s.brand('ticketlens')} recall settings             Show effective retry-queue settings, fetched live  ${s.dim('[Team+]')}`,
    `    ${s.brand('ticketlens')} mcp                         Start the MCP stdio server (Recall + ticket writes)  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} comment ${s.dim('<TICKET-KEY> --body=...')}  Post a comment to the tracker  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} transition ${s.dim('<TICKET-KEY> [--target=... --confirm]')}  Move ticket status  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} assign ${s.dim('<TICKET-KEY> --to=me')}      Assign a ticket to yourself  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} duplicates ${s.dim('<TICKET-KEY> [--threshold=N]')}  Find likely duplicate tickets  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} link ${s.dim('<SOURCE> <TARGET> [--type=... --confirm]')}  Link two tickets  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} update ${s.dim('<TICKET-KEY> [--title=... --description=... --priority=... --add-labels=... --remove-labels=...]')}  Update fields  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} create ${s.dim('--project=... [--type=...] --summary=... [--description=...]')}  Create a new ticket  ${s.dim('[Pro]')}`,
    '',
    `    ${s.brand('ticketlens')} delete ${s.dim('<PROFILE-NAME>')}       Remove a profile`,
    `    ${s.brand('ticketlens')} activate ${s.dim('<KEY>')}              Activate a license key`,
    `    ${s.brand('ticketlens')} license                     Show license status`,
    `    ${s.brand('ticketlens')} cache ${s.dim('[size|clear]')}          Manage attachment cache  ${s.dim('(try cache --help)')}`,
    `    ${s.brand('ticketlens')} schedule ${s.dim('[--stop|--status|--local]')}  Manage digest schedule  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} cloud-keys ${s.dim('[add|remove|list|test]')}  Manage your encrypted AI provider keys  ${s.dim('[Pro]')}`,
    `    ${s.brand('ticketlens')} update-skill ${s.dim('[--dry-run]')}    Update /jtb skill in Claude Code and other AI assistants`,
    '',
    `  ${s.bold('GLOBAL OPTIONS')}`,
    '',
    `    ${s.brand('--no-input')}          Force non-interactive behavior even in a terminal`,
    `    ${s.brand('-v')}, ${s.brand('--version')}       Show version and exit ${s.dim('(same as ticketlens version)')}`,
    `    ${s.brand('clear')}               Alias for ${s.brand('cache clear')}`,
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
    `    ${s.brand('--budget')}=${s.dim('N')}         Trim brief to fit a token budget  ${s.dim('[Pro]')}`,
    '',
    `  ${s.bold('TRIAGE OPTIONS')}`,
    '',
    // visible widths: "--profile=NAME"=14, "--stale=N"=9, "--status=X,Y"=12,
    // "--assignee=NAME"=15, "--sprint=NAME"=13, "--static"=8, "--plain"=7  →  target=19
    `    ${s.brand('--profile')}=${s.dim('NAME')}     Use a specific Jira profile`,
    `    ${s.brand('--stale')}=${s.dim('N')}          Aging threshold in days ${s.dim('(default: 5)')}`,
    `    ${s.brand('--sort')}=${s.dim('ORDER')}       Sort order ${s.dim('(priority|urgency, default: urgency)')}`,
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
    `    ${s.brand('--styled')}           Force ANSI-styled table output`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens login                   ${s.dim('# first-time setup')}`,
    `    ${s.dim('$')} ticketlens sync                    ${s.dim('# pull connections from console')}`,
    `    ${s.dim('$')} ticketlens PROJ-123`,
    `    ${s.dim('$')} ticketlens get PROJ-123 --depth=0 --profile=myteam`,
    `    ${s.dim('$')} ticketlens triage`,
    `    ${s.dim('$')} ticketlens triage --profile=acme --stale=3`,
    `    ${s.dim('$')} ticketlens triage --sort=priority`,
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
    `    ${s.brand('--budget')}=${s.dim('N')}         Trim brief to fit a token budget  ${s.dim('[Pro]')}`,
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

export function printHistoryHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('history')} ${s.dim('TICKET-KEY')}  ${s.dim('[Pro]')}`,
    '',
    `  Show this ticket's urgency timeline from your local triage history — ${s.dim('[Pro]')}`,
    `  every prior triage scan that surfaced it, with the urgency level and reason`,
    `  computed at that point in time. Read-only, entirely local — no network call.`,
    '',
    `  ${s.bold('ARGUMENTS')}`,
    '',
    `    ${s.brand('TICKET-KEY')}   The ticket to show history for ${s.dim('(required)')}`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens history PROJ-123`,
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
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('schedule')} ${s.dim('[--stop|--status|--local]')}  ${s.dim('[Pro]')}`,
    '',
    `  Set up a recurring digest email with your triage results. ${s.dim('[Pro]')}`,
    `  Runs an interactive wizard to configure day, time, and timezone.`,
    `  Without Console login, falls back to local-only scheduling automatically —`,
    `  no interactive wizard, no digest email, just a cron/LaunchAgent entry that`,
    `  writes triage output to a file.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--stop')}        Cancel the active digest schedule`,
    `    ${s.brand('--status')}      Show current schedule configuration`,
    `    ${s.brand('--time')}=${s.dim('HH:MM')}  Pre-fill delivery/run time ${s.dim('(skips the interactive prompt)')}`,
    `    ${s.brand('--email')}=${s.dim('ADDR')}  Pre-fill delivery email ${s.dim('(Console-backed wizard only)')}`,
    `    ${s.brand('--timezone')}=${s.dim('TZ')}  Pre-fill timezone ${s.dim('(Console-backed wizard only)')}`,
    `    ${s.brand('--local')}       Local-only cron/LaunchAgent, no Console auth ${s.dim('(auto-detected when logged out)')}`,
    `    ${s.brand('--save')}=${s.dim('FILE')}   Output file for local mode ${s.dim('(required with --local)')}`,
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens schedule`,
    `    ${s.dim('$')} ticketlens schedule --status`,
    `    ${s.dim('$')} ticketlens schedule --stop`,
    `    ${s.dim('$')} ticketlens schedule --local --time=07:00 --save=./triage.txt`,
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
    `  ${s.bold('ticketlens note patch')} ${s.dim('--id="..." [--ticket=KEY]')}  ${s.dim('[Pro]')}`,
    '',
    `  Overwrites an existing note's body with a better draft, read from stdin.`,
    `  Internal mechanism used by the jtb skill's note quality loop inside a Claude`,
    `  Code session — not typically invoked by hand. Every note it writes gets the`,
    `  same structural and secret-scan checks ${s.brand('note add')} applies to user input.`,
    '',
    `  ${s.bold('ticketlens note delete')} ${s.dim('--id="..." [--ticket=KEY] [--yes]')}  ${s.dim('[Pro]')}`,
    '',
    `  Removes a note from your local vault. Local only — if this note was already`,
    `  pushed to a team, teammates who pulled it keep their copy; deleting it there`,
    `  too is a manager action from the Console (Admin > Recall). In TTY mode,`,
    `  prompts for confirmation before deleting. Pass ${s.cyan('--yes')} (or ${s.cyan('-y')}) to skip the prompt.`,
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
    `  Search your saved Recall notes. ${s.dim('[Pro]')}`,
    `  Works fully offline if you have no team. Logged in with team sync enabled,`,
    `  pulls the team's notes fresh before every search.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--plain')}       Plain output, no color (default when piped)`,
    `    ${s.brand('--full')}        Print each matching note's full body content`,
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('COMMANDS')}`,
    '',
    `    ${s.brand('sync')}          Manually retry any team-synced notes stuck in the local retry queue ${s.dim('[Team+, requires login]')}`,
    `    ${s.brand('settings')}      Show effective retry-queue settings (cooldown, timeout, queue limits) ${s.dim('[Team+]')}`,
    '',
    `  ${s.dim('Team+ = included on Team/Enterprise; available on Pro as a separate Recall add-on.')}`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens recall PROD-123`,
    `    ${s.dim('$')} ticketlens recall "retry backoff"`,
    `    ${s.dim('$')} ticketlens recall PROD-123 --plain`,
    `    ${s.dim('$')} ticketlens recall PROD-123 --full`,
    `    ${s.dim('$')} ticketlens recall sync`,
    `    ${s.dim('$')} ticketlens recall settings`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printMcpHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('mcp')}  ${s.dim('[Pro]')}`,
    '',
    `  Start an MCP (Model Context Protocol) stdio server exposing Recall and`,
    `  ticket writes as native tools — ${s.cyan('recall_add')}, ${s.cyan('recall_search')}, ${s.cyan('ticket_comment')},`,
    `  ${s.cyan('ticket_transition')}, ${s.cyan('ticket_assign')}, ${s.cyan('ticket_duplicates')}, ${s.cyan('ticket_link')}, ${s.cyan('ticket_update')}, ${s.cyan('ticket_create')} — for any`,
    `  MCP-compatible AI harness, not just Claude Code. Thin adapter over the same`,
    `  code as ${s.cyan('note add')}/${s.cyan('recall')}/${s.cyan('comment')}/${s.cyan('transition')}/${s.cyan('assign')}/${s.cyan('duplicates')}/${s.cyan('link')}/${s.cyan('update')}/${s.cyan('create')} above:`,
    `  same Pro gate, same local vault/tracker writes, same team sync. ${s.cyan('ticket_transition')} is`,
    `  destructive when called with \`target\`+\`confirm: true\`; ${s.cyan('ticket_assign')} is currently`,
    `  self-assign only; ${s.cyan('ticket_duplicates')} is read-only; ${s.cyan('ticket_link')} on GitHub closes the`,
    `  source issue as a duplicate — different semantics than Jira/Linear's relationship-only`,
    `  add; ${s.cyan('ticket_update')} has no priority field on GitHub and can partially succeed;`,
    `  ${s.cyan('ticket_create')} has no ticket key to target — --profile/the default profile picks the`,
    `  tracker, and it fabricates a real item, the highest blast radius of this family.`,
    `  Long-running — exits when the client closes stdin.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('COMMANDS')}`,
    '',
    `    ${s.brand('install')}       Register "ticketlens mcp" into the current project's .mcp.json`,
    '',
    `  ${s.dim('install is ungated — writes the registration for anyone; the tools it')}`,
    `  ${s.dim('points at still require Pro at call time, same as note add/recall.')}`,
    '',
    `  ${s.bold('HARNESS CONFIG')}`,
    '',
    `    ${s.dim('{ "command": "ticketlens", "args": ["mcp"] }')}`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens mcp`,
    `    ${s.dim('$')} ticketlens mcp install`,
    `    ${s.dim('$')} ticketlens mcp install --dry-run`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printCommentHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('comment')} ${s.dim('TICKET-KEY --body="..." [--attach=path1,path2]')}  ${s.dim('[Pro]')}`,
    '',
    `  Post a comment directly to the ticket in its tracker (Jira/GitHub/Linear). ${s.dim('[Pro]')}`,
    `  Writes to the real tracker — this is not a local Recall note.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--body')}=${s.dim('TEXT')}      Comment body ${s.dim('(required)')}`,
    `    ${s.brand('--attach')}=${s.dim('PATHS')}   Comma-separated local file paths to attach ${s.dim('(optional)')}`,
    `                    Images render as an inline thumbnail on Jira and Linear.`,
    `                    Not supported on GitHub — no attachment upload API exists there.`,
    `    ${s.brand('--profile')}=${s.dim('NAME')}   Connection profile to use ${s.dim('(optional)')}`,
    `    ${s.brand('-h')}, ${s.brand('--help')}     Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens comment PROD-123 --body="Looks good, merging."`,
    `    ${s.dim('$')} ticketlens comment PROD-123 --body="See screenshot" --attach=./bug.png`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printTransitionHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('transition')} ${s.dim('TICKET-KEY [--target="..." --confirm]')}  ${s.dim('[Pro]')}`,
    '',
    `  Move a ticket to a new status in its tracker (Jira/GitHub/Linear). ${s.dim('[Pro]')}`,
    `  Called with just a ticket key, lists the tracker's current valid options`,
    `  without changing anything. Add ${s.brand('--target')} and ${s.brand('--confirm')} together to execute.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--target')}=${s.dim('NAME')}  Target status/transition name ${s.dim('(from the list, case-insensitive)')}`,
    `    ${s.brand('--confirm')}     Required alongside --target to actually execute`,
    `    ${s.brand('--profile')}=${s.dim('NAME')} Connection profile to use ${s.dim('(optional)')}`,
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens transition PROD-123`,
    `    ${s.dim('$')} ticketlens transition PROD-123 --target="Done" --confirm`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printAssignHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('assign')} ${s.dim('TICKET-KEY --to=me')}  ${s.dim('[Pro]')}`,
    '',
    `  Assign a ticket to yourself directly in its tracker (Jira/GitHub/Linear). ${s.dim('[Pro]')}`,
    `  Self-assign only for now — ${s.brand('--to')} must be ${s.brand('me')}. Assigning to someone else`,
    `  isn't supported yet.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--to')}=${s.dim('me')}       Required — only "me" is currently supported`,
    `    ${s.brand('--profile')}=${s.dim('NAME')} Connection profile to use ${s.dim('(optional)')}`,
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens assign PROD-123 --to=me`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printDuplicatesHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('duplicates')} ${s.dim('TICKET-KEY [--threshold=0.35]')}  ${s.dim('[Pro]')}`,
    '',
    `  Find likely duplicate tickets in the same project (Jira/GitHub/Linear). ${s.dim('[Pro]')}`,
    `  Read-only — lists possible matches, never links or changes anything.`,
    `  No tracker scores similarity server-side, so ranking happens locally`,
    `  from title/description overlap. Not exact — treat it as a nudge to check.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--threshold')}=${s.dim('N')}   Minimum match score 0–1 to report ${s.dim('(default 0.35)')}`,
    `    ${s.brand('--profile')}=${s.dim('NAME')} Connection profile to use ${s.dim('(optional)')}`,
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens duplicates PROD-123`,
    `    ${s.dim('$')} ticketlens duplicates PROD-123 --threshold=0.5`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printLinkHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('link')} ${s.dim('SOURCE-KEY TARGET-KEY [--type="..." --confirm]')}  ${s.dim('[Pro]')}`,
    '',
    `  Link two tickets in their tracker (Jira/GitHub/Linear). ${s.dim('[Pro]')}`,
    `  Called with just SOURCE and TARGET, lists the tracker's current valid`,
    `  link types without changing anything. Add ${s.brand('--type')} and ${s.brand('--confirm')} together to execute.`,
    '',
    `  ${s.bold('Direction matters')}: SOURCE "types" TARGET — e.g. \`link A B --type=Duplicate\` means`,
    `  A duplicates B, not the other way around.`,
    '',
    `  ${s.bold('GitHub is different')}: it has no generic link relationship. Linking on a`,
    `  GitHub-tracked ticket CLOSES SOURCE as a duplicate of TARGET — a state`,
    `  change, not just a relationship add like Jira/Linear.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--type')}=${s.dim('NAME')}    Link type ${s.dim('(from the list, case-insensitive; GitHub only supports "duplicate")')}`,
    `    ${s.brand('--confirm')}     Required alongside --type to actually execute`,
    `    ${s.brand('--profile')}=${s.dim('NAME')} Connection profile to use ${s.dim('(optional)')}`,
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens link PROD-123 PROD-456`,
    `    ${s.dim('$')} ticketlens link PROD-123 PROD-456 --type="Duplicate" --confirm`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printUpdateHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('update')} ${s.dim('TICKET-KEY [--title=...] [--description=...] [--add-labels=a,b] [--remove-labels=c] [--priority=...]')}  ${s.dim('[Pro]')}`,
    '',
    `  Update a narrow, named field set on a ticket (Jira/GitHub/Linear). ${s.dim('[Pro]')}`,
    `  At least one field is required. Labels are add/remove, never a wholesale`,
    `  replace — an unnamed label is left alone, not dropped.`,
    '',
    `  ${s.bold('GitHub has no priority field')}: passing ${s.brand('--priority')} against a GitHub-tracked`,
    `  ticket is refused up front rather than silently ignored.`,
    '',
    `  A write can partially succeed (e.g. title updates but a label doesn't`,
    `  resolve) — the result always reports exactly what landed.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--title')}=${s.dim('TEXT')}         New title/summary`,
    `    ${s.brand('--description')}=${s.dim('TEXT')}   New description`,
    `    ${s.brand('--add-labels')}=${s.dim('a,b')}      Labels to add ${s.dim('(comma-separated)')}`,
    `    ${s.brand('--remove-labels')}=${s.dim('c')}     Labels to remove ${s.dim('(comma-separated)')}`,
    `    ${s.brand('--priority')}=${s.dim('NAME')}       New priority ${s.dim('(not supported on GitHub)')}`,
    `    ${s.brand('--profile')}=${s.dim('NAME')}        Connection profile to use ${s.dim('(optional)')}`,
    `    ${s.brand('-h')}, ${s.brand('--help')}          Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens update PROD-123 --title="Fix login on mobile"`,
    `    ${s.dim('$')} ticketlens update PROD-123 --add-labels=urgent,backend --remove-labels=stale`,
    `    ${s.dim('$')} ticketlens update PROD-123 --priority="High"`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printCreateHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('create')} ${s.dim('--project=... [--type=...] --summary=... [--description=...]')}  ${s.dim('[Pro]')}`,
    '',
    `  Create a new ticket in a tracker (Jira/GitHub/Linear) with a fixed minimal`,
    `  field set — no arbitrary custom fields. ${s.dim('[Pro]')} Unlike every other ticket-write`,
    `  command, there is no existing ticket to operate on — the target tracker is`,
    `  picked by ${s.brand('--profile')} (or your default profile), not a ticket key.`,
    '',
    `  ${s.bold('--project is tracker-specific')}: the Jira project key or Linear team key.`,
    `  Required for Jira/Linear. GitHub ignores it — its target repo is already`,
    `  fixed by the profile.`,
    '',
    `  ${s.bold('--type is Jira-only')}: the issue type, e.g. "Task" or "Bug". Required for`,
    `  Jira. GitHub/Linear have no equivalent concept and ignore it if given.`,
    '',
    `  This is the highest-blast-radius command in the ticket-write family — a bad`,
    `  ${s.brand('--project')}/${s.brand('--type')} fabricates a real, hard-to-walk-back item in a live tracker.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--project')}=${s.dim('KEY')}     Project key (Jira) or team key (Linear) ${s.dim('(required, except GitHub)')}`,
    `    ${s.brand('--type')}=${s.dim('NAME')}       Issue type ${s.dim('(Jira only, required there)')}`,
    `    ${s.brand('--summary')}=${s.dim('TEXT')}    Ticket title/summary ${s.dim('(required)')}`,
    `    ${s.brand('--description')}=${s.dim('TEXT')}  Ticket description`,
    `    ${s.brand('--attach')}=${s.dim('PATHS')}    Comma-separated local file paths to attach, uploaded after creation`,
    `                    ${s.dim('(optional)')}. Not supported on GitHub — no attachment upload API exists there.`,
    `    ${s.brand('--profile')}=${s.dim('NAME')}     Connection profile to use ${s.dim('(optional)')}`,
    `    ${s.brand('-h')}, ${s.brand('--help')}       Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens create --project=PROD --type="Task" --summary="Fix login on mobile"`,
    `    ${s.dim('$')} ticketlens create --project=ENG --summary="New Linear issue" --profile=linear-team`,
    `    ${s.dim('$')} ticketlens create --project=PROD --type="Bug" --summary="Broken layout" --attach=./screenshot.png`,
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
    `    ${s.brand('--sort')}=${s.dim('ORDER')}       Sort order ${s.dim('(priority|urgency, default: urgency)')}`,
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
    `    ${s.dim('$')} ticketlens triage --sort=priority`,
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

export function printComplianceHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('compliance')} ${s.dim('<TICKET-KEY> [--profile=NAME]')}  ${s.dim('[Pro/Free 3/mo]')}`,
    '',
    `  Check your current branch's diff against the ticket's requirements.`,
    `  Extracts candidate requirements from the ticket description and diffs`,
    `  them against what the local git diff actually covers, reporting a`,
    `  coverage percentage and a list of uncovered items.`,
    '',
    `  Used internally by the pre-push hook installed via ${s.brand('ticketlens install-hooks')}`,
    `  (reads the threshold from ${s.dim('.ticketlens-hooks.json')}, default 80%).`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--profile')}=${s.dim('NAME')}  Use a specific Jira profile`,
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens compliance PROJ-123`,
    `    ${s.dim('$')} ticketlens compliance PROJ-123 --profile=myteam`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printLedgerHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('ledger')} ${s.dim('[--format=json|csv]')}  ${s.dim('[Pro]')}`,
    '',
    `  Export your local usage ledger — a signed, tamper-evident record of`,
    `  billable actions (AI calls, exports, etc). Verifiable offline via an`,
    `  HMAC-SHA256 signature over {records, exportedAt}, keyed at ledger-key.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--format')}=${s.dim('json')}   Full record export with signature ${s.dim('(default)')}`,
    `    ${s.brand('--format')}=${s.dim('csv')}    Flat CSV, no signature`,
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens ledger`,
    `    ${s.dim('$')} ticketlens ledger --format=csv`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printPrHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('pr')} ${s.dim('<TICKET-KEY> [--profile=NAME]')}`,
    '',
    `  Assemble a pull-request description from a ticket's context —`,
    `  summary, acceptance criteria, and linked issues, formatted as a`,
    `  ready-to-paste PR body.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--profile')}=${s.dim('NAME')}  Use a specific Jira profile`,
    `    ${s.brand('-h')}, ${s.brand('--help')}   Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens pr PROJ-123`,
    `    ${s.dim('$')} ticketlens pr PROJ-123 --profile=myteam`,
    '',
  ];
  stream.write(lines.join('\n') + '\n');
}

export function printInstallHooksHelp({ stream = process.stdout } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const lines = [
    '',
    `  ${s.bold(s.brand('ticketlens'))} ${s.bold('install-hooks')} ${s.dim('[--uninstall]')}`,
    '',
    `  Installs a git pre-push hook that blocks a push when this branch's`,
    `  compliance coverage (see ${s.brand('ticketlens compliance')}) is below 80%.`,
    `  Appends to an existing pre-push hook rather than overwriting it;`,
    `  calling it again is a no-op if already installed.`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--uninstall')}   Remove the hook, restoring any pre-existing pre-push content`,
    `    ${s.brand('-h')}, ${s.brand('--help')}     Show this help`,
    '',
    `  ${s.bold('EXAMPLES')}`,
    '',
    `    ${s.dim('$')} ticketlens install-hooks`,
    `    ${s.dim('$')} ticketlens install-hooks --uninstall`,
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
    `    ${s.brand('remove')} ${s.dim('<provider>')} ${s.dim('[--yes]')}   Remove a provider's key — prompts for confirmation`,
    `    ${s.brand('test')} ${s.dim('<provider>')}              Send a test request through the provider`,
    `    ${s.brand('priority')} ${s.dim('<provider> <N>')}      Set priority (lower = tried first)`,
    `    ${s.brand('timeout')} ${s.dim('<provider> <seconds>')} Set per-request timeout`,
    '',
    `  ${s.bold('OPTIONS')}`,
    '',
    `    ${s.brand('--timeout')}=${s.dim('N')}   Timeout in seconds when adding a key  ${s.dim('(default: 5)')}`,
    `    ${s.brand('--yes')}, ${s.brand('-y')}   Skip the confirmation prompt when removing a key`,
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
