/**
 * `ticketlens search` / `ticket_search` — read-only Jira search (backlog #72).
 *
 * Two modes, never mixed: raw JQL (`--jql`, sent to Jira untouched) or plain terms
 * (every term must match, optionally scoped by `--project`). Free tier, Jira only.
 */
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { resolveConnection } from './profile-resolver.mjs';
import { resolveAdapter } from './resolve-adapter.mjs';
import { escapeJql } from './jira-client.mjs';
import { singleLine } from './ticket-brief-fields.mjs';
import { createStyler } from './ansi.mjs';
import { parseFlag, resolveTicketAdapter } from './ticket-command.mjs';

export const SEARCH_RESULT_CAP = 25;

const SEARCH_FIELDS = 'summary,status,assignee,issuetype,updated';
const PROJECT_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,49}$/;
const USAGE = [
  'Usage: ticketlens search TERM... [--project=KEY[,KEY]] [--profile=NAME]',
  '       ticketlens search --jql="project = PROJ AND text ~ \\"login\\" ORDER BY created DESC" [--profile=NAME]',
].join('\n');

const LEADING_NOT_OPERATORS = /^[-!]+/;

/** Jira reads a leading "-" or "!" in a text term as NOT; a backslash makes it a plain character. */
function escapeTerm(term) {
  return escapeJql(term).replace(LEADING_NOT_OPERATORS, run => [...run].map(c => `\\\\${c}`).join(''));
}

/** Terms are quoted and escaped; project keys are validated by the caller. */
export function buildTermsJql(terms, projects = []) {
  const scope = projects.length ? `project in (${projects.map(p => `"${escapeJql(p)}"`).join(', ')}) AND ` : '';
  const text = terms.map(t => `text ~ "${escapeTerm(t)}"`).join(' AND ');
  return `${scope}${text} ORDER BY updated DESC`;
}

const KNOWN_FLAGS = ['jql', 'project', 'profile'];

/**
 * Accepts `--flag=value` and `--flag value`; any other dash argument is an error, never a term.
 * A bare `--` ends option parsing: everything after it is a term, so `-- -test` searches "-test".
 */
function parseArgv(cmdArgs) {
  const flags = {};
  const terms = [];
  for (let i = 0; i < cmdArgs.length; i++) {
    const arg = cmdArgs[i];
    if (arg === '--') { terms.push(...cmdArgs.slice(i + 1)); break; }
    if (!arg.startsWith('-')) { terms.push(arg); continue; }
    const match = /^--([a-z]+)(?:=([\s\S]*))?$/.exec(arg);
    if (!match || !KNOWN_FLAGS.includes(match[1])) {
      const shown = singleLine(arg, 40);
      return { error: `Unknown option: ${shown}. Try --help, or to search for it: ticketlens search -- ${shown}` };
    }
    if (match[2] !== undefined) flags[match[1]] = match[2];
    else if (i + 1 < cmdArgs.length && cmdArgs[i + 1] !== '--') flags[match[1]] = cmdArgs[++i];
    else return { error: `Option --${match[1]} needs a value.` };
  }
  const projects = flags.project ? flags.project.split(',').map(p => p.trim()).filter(Boolean) : [];
  return { query: { jql: flags.jql, terms, projects, profile: flags.profile } };
}

function validateQuery({ jql, terms, projects }) {
  if (jql !== undefined && terms.length) return 'Use either plain terms or --jql, not both.';
  if (jql !== undefined && projects.length) return 'Put the project in the JQL itself; --project only scopes plain terms.';
  if (jql === undefined && terms.length === 0) return USAGE;
  const badKey = projects.find(p => !PROJECT_KEY_PATTERN.test(p));
  if (badKey) return `Not a valid project key: "${singleLine(badKey, 60)}".`;
  return null;
}

/** Projects on different profiles live on different Jira sites; one call queries one site. */
function projectsShareProfile(projects, profile, { configDir, resolveConnectionFn }) {
  if (profile || projects.length < 2) return true;
  const names = new Set(projects.map(p => resolveConnectionFn(`${p}-1`, { configDir, cwd: process.cwd() }).profileName));
  return names.size === 1;
}

function writeResults(stream, tickets, truncated) {
  const s = createStyler({ isTTY: stream.isTTY });
  if (tickets.length === 0) {
    stream.write('  No tickets matched.\n');
    return;
  }
  for (const t of tickets) {
    const who = t.assignee ? ` — ${singleLine(t.assignee, 40)}` : '';
    stream.write(`  ${s.brand(s.bold(singleLine(t.key, 30)))}  [${singleLine(t.status ?? 'unknown', 30)}]  ${singleLine(t.summary, 120)}${who}\n`);
  }
  if (truncated) stream.write(`\n  More match than the ${SEARCH_RESULT_CAP} shown — refine the query.\n`);
}

/** Only a 400 means the query itself was bad; timeouts, 401s and refusals must not send the user rewriting JQL. */
function describeFailure(err) {
  const text = singleLine(err.detail || err.message, 300);
  if (err.status === 400) return `  Jira rejected the search (400): ${text}\n`;
  return `  Search failed${err.status ? ` (${err.status})` : ''}: ${text}\n`;
}

function siteOf(conn) {
  try { return new URL(conn.baseUrl).host; } catch { return String(conn.baseUrl); }
}

/**
 * Structured entry: terms and JQL arrive as data, so a term can never become a flag.
 * @param {{jql?: string, terms?: string[], projects?: string[], profile?: string}} query
 * @returns {Promise<{ ok: boolean, results?: object[] }>}
 */
export async function runTicketSearchQuery(query, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  resolveConnectionFn = resolveConnection,
  resolveAdapterFn = resolveAdapter,
} = {}) {
  const normalized = {
    jql: query.jql?.trim() ? query.jql : undefined,
    terms: (query.terms ?? []).map(t => t.trim()).filter(Boolean),
    projects: query.projects ?? [],
    profile: query.profile,
  };
  const problem = validateQuery(normalized);
  if (problem) {
    stream.write(`  ${problem}\n`);
    return { ok: false };
  }
  if (!projectsShareProfile(normalized.projects, normalized.profile, { configDir, resolveConnectionFn })) {
    stream.write('  Those projects live on different profiles. Search one profile at a time with --profile=NAME.\n');
    return { ok: false };
  }

  const profileArgs = normalized.profile ? [`--profile=${normalized.profile}`] : [];
  const routingKey = normalized.projects.length ? `${normalized.projects[0]}-1` : null;
  const resolved = resolveTicketAdapter(routingKey, profileArgs, { configDir, resolveConnectionFn, resolveAdapterFn, stream });
  if (!resolved) return { ok: false };
  if (resolved.adapter.type !== 'jira') {
    stream.write('  ticketlens search supports Jira only.\n');
    return { ok: false };
  }

  const jql = normalized.jql ?? buildTermsJql(normalized.terms, normalized.projects);
  stream.write(`  Jira: ${siteOf(resolved.conn)}\n`);
  try {
    const found = await resolved.adapter.searchTickets(jql, { maxResults: SEARCH_RESULT_CAP + 1, fields: SEARCH_FIELDS });
    const results = found.slice(0, SEARCH_RESULT_CAP);
    writeResults(stream, results, found.length > SEARCH_RESULT_CAP);
    return { ok: true, results };
  } catch (err) {
    stream.write(describeFailure(err));
    return { ok: false };
  }
}

/** @param {string[]} cmdArgs - e.g. ['xss', '--project=PROJ'] or ['--jql=project = PROJ ORDER BY created DESC'] */
export async function runTicketSearch(cmdArgs, deps = {}) {
  const { query, error } = parseArgv(cmdArgs);
  if (error) {
    (deps.stream ?? process.stderr).write(`  ${error}\n`);
    return { ok: false };
  }
  return runTicketSearchQuery(query, deps);
}
