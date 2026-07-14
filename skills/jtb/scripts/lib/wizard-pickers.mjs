/**
 * Shared prefix/status picker steps for init-wizard.mjs and config-wizard.mjs.
 * Live-fetched multi-select over the connected Jira instance's projects and
 * statuses. Every picker returns string[] on confirm, or null when the picker
 * cannot run (non-TTY, fetch failure, empty server list) or the user hits Esc
 * — callers treat null as "use the legacy free-text prompt".
 */

import { createStyler } from './ansi.mjs';
import { promptMultiSelect } from './select-prompt.mjs';

export const DEFAULT_TRIAGE_STATUSES = ['In Progress', 'Code Review', 'QA'];

/**
 * Builds picker rows from server values plus the user's current selections.
 * Matching is case-insensitive; rows echo the server's canonical casing so a
 * confirm fixes case drift in the profile. Current values missing from the
 * server are appended as marked, pre-checked rows when preserveMissing is on
 * (edit flows — user data is never silently dropped) and skipped when off
 * (init flows — stale defaults are not user data).
 */
function buildRows({ serverValues, labels, current, preserveMissing, s }) {
  const values = [...serverValues];
  const rows = serverValues.map((v, i) => ({ label: labels[i] }));
  const serverLower = new Set(serverValues.map(v => v.toLowerCase()));

  const staleSeen = new Set(); // legacy free-text merge never deduped within itself
  for (const cur of current) {
    const lower = cur.toLowerCase();
    if (preserveMissing && !serverLower.has(lower) && !staleSeen.has(lower)) {
      staleSeen.add(lower);
      values.push(cur);
      rows.push({ label: `${cur}  ${s.dim('(not on server)')}` });
    }
  }

  const currentLower = new Set(current.map(c => c.toLowerCase()));
  const initialSelected = values
    .map((v, i) => (currentLower.has(v.toLowerCase()) ? i : -1))
    .filter(i => i >= 0);

  return { values, rows, initialSelected };
}

/**
 * Fetches via fetchFn behind a clearable progress line. Returns the list, or
 * null after printing a fallback warning (raw error details stay internal —
 * the connection already tested fine, so this is a transient/permission issue).
 */
async function fetchForPicker(fetchFn, { what, stream, s }) {
  stream.write(`  ${s.dim(`Fetching ${what}...`)}\n`);
  try {
    const list = await fetchFn();
    stream.write('\x1b[A\r\x1b[2K');
    return list;
  } catch {
    stream.write('\x1b[A\r\x1b[2K');
    stream.write(`  ${s.yellow('~')} Could not fetch ${what} — enter manually\n`);
    return null;
  }
}

function writeConfirmation(chosen, { stream, s }) {
  stream.write(`  ${s.green('✔')} ${chosen.length ? chosen.map(v => s.cyan(v)).join(s.dim(', ')) : s.dim('none')}\n`);
}

/**
 * Multi-select over the instance's projects; returns the chosen project keys.
 *
 * @param {object} opts
 * @param {() => Promise<Array<{key: string, name: string}>>} opts.fetchProjects
 *   pre-bound by the caller — env/apiVersion/allowPrivateIp trust stays there
 * @param {string[]} [opts.current=[]] pre-checked prefixes (edit flow)
 * @param {boolean} [opts.preserveMissing=true]
 * @returns {Promise<string[]|null>} chosen keys, or null → free-text fallback
 */
export async function pickTicketPrefixes({ fetchProjects, current = [], preserveMissing = true, stream = process.stderr, stdin = process.stdin } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  if (!stream.isTTY || !stdin.setRawMode) return null;

  const projects = await fetchForPicker(fetchProjects, { what: 'projects', stream, s });
  if (projects === null || projects.length === 0) return null;

  const { values, rows, initialSelected } = buildRows({
    serverValues: projects.map(p => p.key),
    labels: projects.map(p => (p.name ? `${p.key} ${s.dim('—')} ${p.name}` : p.key)),
    current,
    preserveMissing,
    s,
  });

  stream.write(`  ${s.dim('Ticket prefixes')}  ${s.dim('(projects on this instance)')}\n\n`);
  const picked = await promptMultiSelect(rows, { initialSelected, stream, stdin });
  if (picked === null) return null;

  const chosen = picked.map(i => values[i]);
  writeConfirmation(chosen, { stream, s });
  return chosen;
}

/**
 * Multi-select over the instance's status names; at least one required.
 *
 * @param {object} opts
 * @param {() => Promise<string[]>} opts.fetchStatuses pre-bound by the caller
 * @param {string[]} [opts.current=[]] pre-checked statuses
 * @param {boolean} [opts.preserveMissing=true]
 * @returns {Promise<string[]|null>} chosen names, or null → free-text fallback
 */
export async function pickTriageStatuses({ fetchStatuses, current = [], preserveMissing = true, stream = process.stderr, stdin = process.stdin } = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  if (!stream.isTTY || !stdin.setRawMode) return null;

  const available = await fetchForPicker(fetchStatuses, { what: 'statuses', stream, s });
  if (available === null || available.length === 0) return null;

  const { values, rows, initialSelected } = buildRows({
    serverValues: available,
    labels: available,
    current,
    preserveMissing,
    s,
  });

  stream.write(`  ${s.dim('Triage statuses')}  ${s.dim('(statuses on this instance)')}\n\n`);
  const picked = await promptMultiSelect(rows, { initialSelected, minSelected: 1, stream, stdin });
  if (picked === null) return null;

  const chosen = picked.map(i => values[i]);
  writeConfirmation(chosen, { stream, s });
  return chosen;
}
