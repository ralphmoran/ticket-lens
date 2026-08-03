/**
 * Implements `tl recall <query|TICKET-KEY>` — a search over saved Recall
 * notes, local-first. When logged in, always pulls the team vault fresh
 * before searching (ttlMs: 0, bypassing the TTL cache entirely) — the user
 * is explicitly waiting on this command, so a manager's Console verify/
 * delete action is visible on this very invocation, not up to 4h later.
 * The full request timeout applies here — unlike the passive brief-fetch
 * pull path (fetch-ticket.mjs), which deliberately keeps its short timeout
 * and TTL cache since it runs on nearly every command, not just this one.
 * A pull failure never blocks the local search from returning results.
 */

import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { TICKET_KEY_PATTERN } from './cli.mjs';
import { isLicensed, showUpgradePrompt } from './license.mjs';
import { listNotes } from './recall-vault.mjs';
import { readCliToken } from './cli-auth.mjs';
import { pullNotes } from './recall-sync.mjs';
import { maybeAutoFlush, flushQueue, readQueue } from './recall-queue.mjs';
import { getEffectiveRecallSettings } from './recall-settings-sync.mjs';
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
  maybeAutoFlushFn = maybeAutoFlush,
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
    await pullNotesFn({ cliToken, configDir, ttlMs: 0 });
    await maybeAutoFlushFn({ cliToken, configDir });
  }

  const filter = TICKET_KEY_PATTERN.test(arg) ? { ticketKey: arg } : { query: arg };
  const results = listNotesFn(filter, { configDir });

  const styled = !cmdArgs.includes('--plain') && !!stream.isTTY;
  const full = cmdArgs.includes('--full');
  stream.write(styleRecallResults(results, { styled, full }) + '\n');
  return { ok: true };
}

/**
 * Implements `tl recall sync` — manually flushes the local retry queue
 * (notes whose team push previously failed for a transient reason). Unlike
 * the auto-flush attempted from `runRecall`/`note add`, this is an explicit
 * user action, so failures are reported visibly rather than staying silent.
 *
 * @param {string[]} cmdArgs
 * @returns {Promise<{ ok: boolean }>}
 */
export async function runRecallSync(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stdout,
  isLicensedFn = isLicensed,
  readCliTokenFn = readCliToken,
  readQueueFn = readQueue,
  flushQueueFn = flushQueue,
} = {}) {
  if (!isLicensedFn('pro', configDir)) {
    showUpgradePrompt('pro', 'ticketlens recall', { stream });
    return { ok: false };
  }

  const cliToken = readCliTokenFn(configDir);
  if (!cliToken) {
    stream.write('Not logged in — run `ticketlens login` first.\n');
    return { ok: false };
  }

  if (readQueueFn(configDir).length === 0) {
    stream.write('Nothing to sync.\n');
    return { ok: true };
  }

  const { flushed, remaining } = await flushQueueFn({ cliToken, configDir, warn: (s) => stream.write(s) });
  stream.write(`Synced ${flushed} note(s). ${remaining} still pending.\n`);
  return { ok: true };
}

/**
 * Implements `tl recall settings` — read-only display of the effective
 * Recall queue settings (flush cooldown, per-request timeout, max queue
 * size, max entry age). Management happens in Console (console/admin/recall,
 * manager-only); this fetches live so it always reflects the manager's
 * latest saved value, falling back to the last-known cache/platform default
 * if offline.
 *
 * @param {string[]} cmdArgs
 * @returns {Promise<{ ok: boolean }>}
 */
export async function runRecallSettings(cmdArgs, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stdout,
  isLicensedFn = isLicensed,
  readCliTokenFn = readCliToken,
  getEffectiveRecallSettingsFn = getEffectiveRecallSettings,
} = {}) {
  if (!isLicensedFn('pro', configDir)) {
    showUpgradePrompt('pro', 'ticketlens recall', { stream });
    return { ok: false };
  }

  const cliToken = readCliTokenFn(configDir);
  const settings = await getEffectiveRecallSettingsFn({ cliToken, configDir });
  const source = cliToken ? 'your team manager (or platform default if unset)' : 'platform default — log in to pick up a team override';

  stream.write(`  Retry cooldown:      ${settings.flush_cooldown_ms / 60_000} min\n`);
  stream.write(`  Per-request timeout: ${settings.timeout_ms / 1_000} sec\n`);
  stream.write(`  Max queued notes:    ${settings.max_queue_size}\n`);
  stream.write(`  Queued note expiry:  ${settings.max_entry_age_ms / 86_400_000} days\n`);
  stream.write(`  Source: ${source}\n`);
  return { ok: true };
}
