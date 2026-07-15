/**
 * Implements `tl recall <query|TICKET-KEY>` — a read-only local search over
 * saved Recall notes. No network calls.
 */

import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { TICKET_KEY_PATTERN } from './cli.mjs';
import { isLicensed, showUpgradePrompt } from './license.mjs';
import { listDigests } from './recall-vault.mjs';

/**
 * @param {string[]} cmdArgs
 * @returns {Promise<{ ok: boolean }>}
 */
export async function runRecall(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stdout,
  errorStream = process.stderr,
  isLicensedFn = isLicensed,
  listDigestsFn = listDigests,
} = {}) {
  if (!isLicensedFn('pro', configDir)) {
    showUpgradePrompt('pro', 'ticketlens recall', { stream: errorStream });
    return { ok: false };
  }

  const arg = cmdArgs.find(a => !a.startsWith('-'));
  if (!arg) {
    stream.write('Usage: ticketlens recall <query|TICKET-KEY>\n');
    return { ok: false };
  }

  const filter = TICKET_KEY_PATTERN.test(arg) ? { ticketKey: arg } : { query: arg };
  const results = listDigestsFn(filter, { configDir });

  if (results.length === 0) {
    stream.write('No matching notes found.\n');
    return { ok: true };
  }

  for (const digest of results) {
    const ticketList = digest.tickets?.length ? ` (${digest.tickets.join(', ')})` : '';
    stream.write(`${digest.title}${ticketList} — ${digest.created.split('T')[0]}\n`);
  }
  return { ok: true };
}
