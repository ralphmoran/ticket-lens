/**
 * Triage history: save/load daily snapshots and compute delta reports.
 * Named exports only, no default export.
 * All I/O deps are injectable (fsModule, configDir, now).
 */

import * as defaultFs from 'node:fs';
import { join } from 'node:path';

const DEFAULT_CONFIG_DIR = join(
  process.env.HOME ?? process.env.USERPROFILE ?? '',
  '.ticketlens'
);

const URGENCY_ORDER = { 'needs-response': 0, 'aging': 1, 'clear': 2 };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function validateProfile(profile) {
  if (!profile || /[/\\]/.test(profile) || profile === '..' || profile.includes('..')) {
    throw new Error('Invalid profile name');
  }
}

function toDateString(date) {
  // Format as YYYY-MM-DD in local wall-clock date
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function snapshotPath(configDir, dateStr, profile) {
  return join(configDir, 'triage-history', dateStr, `${profile}.json`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save the current scored tickets as today's snapshot.
 *
 * @param {object[]} tickets - Array of scoreAttention() results
 * @param {object} opts
 * @param {string} opts.profile - Profile name (sanitized)
 * @param {string} [opts.configDir]
 * @param {object} [opts.fsModule] - Injectable fs (default: node:fs)
 * @param {Date}   [opts.now]     - Date for deterministic tests
 */
export function saveTriageSnapshot(tickets, {
  profile,
  configDir = DEFAULT_CONFIG_DIR,
  fsModule = defaultFs,
  now = new Date(),
} = {}) {
  validateProfile(profile);
  const dateStr = toDateString(now);
  const dir = join(configDir, 'triage-history', dateStr);
  fsModule.mkdirSync(dir, { recursive: true });
  const filePath = snapshotPath(configDir, dateStr, profile);
  fsModule.writeFileSync(filePath, JSON.stringify(tickets, null, 2), 'utf8');
}

/**
 * Load yesterday's snapshot, or null if none exists.
 *
 * @param {object} opts
 * @param {string} opts.profile
 * @param {string} [opts.configDir]
 * @param {object} [opts.fsModule]
 * @param {Date}   [opts.now]
 * @returns {object[]|null}
 */
export function loadYesterdaySnapshot({
  profile,
  configDir = DEFAULT_CONFIG_DIR,
  fsModule = defaultFs,
  now = new Date(),
} = {}) {
  validateProfile(profile);
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  const dateStr = toDateString(yest);
  const filePath = snapshotPath(configDir, dateStr, profile);
  try {
    const raw = fsModule.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Compare today's and yesterday's ticket arrays, returning only tickets that
 * worsened (urgency moved toward 'needs-response', new comment, or stale threshold crossed).
 *
 * Only tickets present in BOTH arrays are compared.
 *
 * @param {object[]} today     - Today's scored tickets
 * @param {object[]} yesterday - Yesterday's scored tickets
 * @returns {{ ticketKey: string, summary: string, changes: string[] }[]}
 */
export function diffSnapshots(today, yesterday) {
  const yesterdayMap = new Map(yesterday.map(t => [t.ticketKey, t]));
  const deltas = [];

  for (const t of today) {
    const y = yesterdayMap.get(t.ticketKey);
    if (!y) continue; // new ticket — skip

    const changes = [];

    // Urgency worsened
    const todayOrder = URGENCY_ORDER[t.urgency] ?? 2;
    const yesterdayOrder = URGENCY_ORDER[y.urgency] ?? 2;
    if (todayOrder < yesterdayOrder) {
      changes.push(`${y.urgency} \u2192 ${t.urgency}`);
    }

    // New comment (today has a comment with a different created timestamp)
    if (
      t.lastComment?.created &&
      t.lastComment.created !== y.lastComment?.created
    ) {
      changes.push('1 new comment');
    }

    // Stale threshold crossed: was <7 days, now >=7 days
    if (
      typeof t.daysSinceUpdate === 'number' &&
      typeof y.daysSinceUpdate === 'number' &&
      t.daysSinceUpdate >= 7 &&
      y.daysSinceUpdate < 7
    ) {
      changes.push(`stale threshold crossed (${t.daysSinceUpdate} days idle)`);
    }

    if (changes.length > 0) {
      deltas.push({ ticketKey: t.ticketKey, summary: t.summary, changes });
    }
  }

  return deltas;
}

/**
 * Render the delta section as a plain-text string for inclusion in the digest payload.
 *
 * @param {{ ticketKey: string, summary: string, changes: string[] }[]} deltas
 * @returns {string} Empty string when deltas is empty
 */
export function buildDeltaSection(deltas) {
  if (!deltas || deltas.length === 0) return '';

  const lines = ['\u2500\u2500 What got worse since yesterday \u2500\u2500'];

  for (const { ticketKey, changes } of deltas) {
    const changeStr = changes.join('  ');
    lines.push(`\u25bc ${ticketKey}  ${changeStr}`);
  }

  return lines.join('\n') + '\n';
}
