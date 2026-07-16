/**
 * Implements `tl recall <query|TICKET-KEY>` — a search over saved Recall
 * notes, local-first. When logged in, pulls the team vault down before
 * searching (the user is explicitly waiting on this command, so the full
 * request timeout applies here — unlike the passive brief-fetch pull path).
 * A pull failure never blocks the local search from returning results.
 */

import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { TICKET_KEY_PATTERN } from './cli.mjs';
import { isLicensed, showUpgradePrompt } from './license.mjs';
import { listNotes } from './recall-vault.mjs';
import { readCliToken } from './cli-auth.mjs';
import { pullNotes } from './recall-sync.mjs';
import { styleRecallResults } from './styled-assembler.mjs';

/**
 * @param {string[]} cmdArgs
 * @returns {Promise<{ ok: boolean }>}
 */
export async function runRecall(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stdout,
  errorStream = process.stderr,
  isLicensedFn = isLicensed,
  listNotesFn = listNotes,
  readCliTokenFn = readCliToken,
  pullNotesFn = pullNotes,
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

  const cliToken = readCliTokenFn(configDir);
  if (cliToken) {
    await pullNotesFn({
      cliToken,
      configDir,
      ...(cmdArgs.includes('--no-cache') && { ttlMs: 0 }),
    });
  }

  const filter = TICKET_KEY_PATTERN.test(arg) ? { ticketKey: arg } : { query: arg };
  const results = listNotesFn(filter, { configDir });

  const styled = !cmdArgs.includes('--plain') && stream.isTTY;
  const full = cmdArgs.includes('--full');
  stream.write(styleRecallResults(results, { styled, full }) + '\n');
  return { ok: true };
}
