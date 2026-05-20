const INDENT = '        ';

/**
 * Formats a collision list from the /v1/triage/collisions API response.
 *
 * @param {object[]} collisions
 * @param {object}   [opts]
 * @param {boolean}  [opts.plain]  Suppress ANSI (forced when not TTY)
 * @param {boolean}  [opts.isTTY] Enable ANSI escape sequences
 * @param {boolean}  [opts.json]  Emit raw JSON instead of text
 * @returns {string}
 */
export function formatCollisions(collisions, { plain = false, isTTY = false, json = false } = {}) {
  if (json) return JSON.stringify(collisions, null, 2) + '\n';

  const useAnsi = isTTY && !plain;
  const warn = useAnsi ? '\x1b[33m⚠\x1b[0m' : '⚠';
  const ok   = useAnsi ? '\x1b[32m✓\x1b[0m' : '✓';
  const bold = useAnsi ? (s) => `\x1b[1m${s}\x1b[0m` : (s) => s;
  const dim  = useAnsi ? (s) => `\x1b[2m${s}\x1b[0m` : (s) => s;

  if (collisions.length === 0) {
    return `${ok} No branch collisions detected.\n`;
  }

  const n = collisions.length;
  const lines = [`${warn} ${bold(`${n} collision${n === 1 ? '' : 's'} detected`)}\n`];

  for (let i = 0; i < n; i++) {
    const c = collisions[i];
    const yourKeys  = c.your_tickets?.length  ? c.your_tickets.join(', ')  : '—';
    const theirKeys = c.their_tickets?.length ? c.their_tickets.join(', ') : '—';
    const count     = c.shared_files?.length ?? 0;

    lines.push(
      `  [${i + 1}] ${bold('You')} ${dim(`(${c.your_branch})`)} ↔ ${bold(c.teammate)} ${dim(`(${c.their_branch})`)}`,
      `      Tickets: ${yourKeys} ↔ ${theirKeys}`,
      `      Shared files (${count}):`,
      ...(c.shared_files ?? []).map(f => `${INDENT}${f}`),
      '',
    );
  }

  return lines.join('\n');
}
