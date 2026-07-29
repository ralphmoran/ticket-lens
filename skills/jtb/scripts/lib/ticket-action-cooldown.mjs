/**
 * Local debounce guard against accidentally firing the same ticket write
 * twice in quick succession (a flaky agent retry loop, a doubled CLI
 * invocation, a human hitting enter twice). This is not a security boundary
 * and not a notification-style cooldown — just enough of a window to catch a
 * true double-fire without blocking a deliberate follow-up action moments
 * later.
 *
 * Deliberately a separate file from ticket-action-log.mjs (the append-only
 * audit trail): this file is small and read on every write attempt, so it
 * must stay O(1) to check. A shared file would force scanning full history
 * per check, or risk one read-modify-write clobbering the other's data.
 * Same read-modify-write-no-lock tradeoff already accepted by
 * recall-queue.mjs for the same reason — low-frequency, single-user CLI.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { writeFileAtomically } from './recall-vault.mjs';

const COOLDOWN_FILE = 'ticket-action-cooldown.json';

/** Default debounce window: long enough to catch a true double-fire, short enough to never block a deliberate follow-up action. */
export const DEFAULT_COOLDOWN_MS = 10_000;

function cooldownPath(configDir) {
  return path.join(configDir, COOLDOWN_FILE);
}

function readCooldowns(configDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cooldownPath(configDir), 'utf8'));
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch {
    return {};
  }
}

function cooldownKey(ticketKey, action) {
  return `${ticketKey}:${action}`;
}

/**
 * @param {string} ticketKey
 * @param {string} action
 * @param {{ configDir?: string, cooldownMs?: number, now?: () => number }} [opts]
 * @returns {{ active: boolean, remainingMs: number }}
 */
export function checkCooldown(ticketKey, action, {
  configDir = DEFAULT_CONFIG_DIR,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  now = () => Date.now(),
} = {}) {
  const lastAt = readCooldowns(configDir)[cooldownKey(ticketKey, action)];
  if (!lastAt) return { active: false, remainingMs: 0 };

  const elapsed = now() - new Date(lastAt).getTime();
  const remainingMs = cooldownMs - elapsed;
  return remainingMs > 0 ? { active: true, remainingMs } : { active: false, remainingMs: 0 };
}

/**
 * @param {string} ticketKey
 * @param {string} action
 * @param {{ configDir?: string, now?: () => number }} [opts]
 */
export function recordAction(ticketKey, action, { configDir = DEFAULT_CONFIG_DIR, now = () => Date.now() } = {}) {
  const cooldowns = readCooldowns(configDir);
  cooldowns[cooldownKey(ticketKey, action)] = new Date(now()).toISOString();
  writeFileAtomically(cooldownPath(configDir), JSON.stringify(cooldowns));
}
