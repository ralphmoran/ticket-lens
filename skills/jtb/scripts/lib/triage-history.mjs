/**
 * Triage history: save/load daily snapshots and compute delta reports.
 * Named exports only, no default export.
 * All I/O deps are injectable (fsModule, configDir, now).
 */

import * as defaultFs from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_CONFIG_DIR = join(homedir(), '.ticketlens');

const URGENCY_ORDER = { 'needs-response': 0, 'aging': 1, 'clear': 2 };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

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
  const envelope = { captured_at: now.toISOString(), tickets };
  fsModule.writeFileSync(filePath, JSON.stringify(envelope, null, 2), 'utf8');
}

/**
 * Load yesterday's snapshot, or null if none exists.
 *
 * @param {object} opts
 * @param {string} opts.profile
 * @param {string} [opts.configDir]
 * @param {object} [opts.fsModule]
 * @param {Date}   [opts.now]
 * @returns {{ captured_at: string|null, tickets: object[] }|null}
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
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { captured_at: null, tickets: parsed };
    return parsed;
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

/**
 * Query the full history for a single ticket key across all dated snapshots.
 *
 * Reads ~/.ticketlens/triage-history/YYYY-MM-DD/*.json, finds entries matching
 * the given ticketKey, and returns a chronologically sorted timeline.
 * Entries with urgency oscillating in the same direction on consecutive days
 * are flagged with `bounced: true`.
 *
 * @param {string} ticketKey
 * @param {object} [opts]
 * @param {string} [opts.configDir]
 * @param {object} [opts.fsModule]
 * @returns {{ date: string, profile: string, urgency: string, status: string, reason: string, bounced: boolean }[]}
 */
export function queryTicketHistory(ticketKey, {
  configDir = DEFAULT_CONFIG_DIR,
  fsModule = defaultFs,
} = {}) {
  const histDir = join(configDir, 'triage-history');
  if (!fsModule.existsSync(histDir)) return [];

  const dates = fsModule.readdirSync(histDir)
    .filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort(); // lexicographic = chronological for YYYY-MM-DD

  const entries = [];
  for (const date of dates) {
    const dayDir = join(histDir, date);
    let profileFiles;
    try {
      profileFiles = fsModule.readdirSync(dayDir).filter(f => f.endsWith('.json'));
    } catch {
      continue;
    }
    for (const file of profileFiles) {
      const profile = file.slice(0, -5); // strip .json
      let tickets;
      try {
        const raw = JSON.parse(fsModule.readFileSync(join(dayDir, file), 'utf8'));
        tickets = Array.isArray(raw) ? raw : (raw.tickets ?? []);
      } catch {
        continue;
      }
      const found = tickets.find(t => t.ticketKey === ticketKey);
      if (found) {
        entries.push({
          date,
          profile,
          urgency: found.urgency ?? 'unknown',
          status: found.status ?? '',
          reason: found.reason ?? '',
          bounced: false,
        });
      }
    }
  }

  // Detect bounces: flag entries where urgency changed direction on consecutive days
  for (let i = 1; i < entries.length; i++) {
    const prev = entries[i - 1];
    const cur = entries[i];
    if (cur.urgency !== prev.urgency && cur.profile === prev.profile) {
      cur.bounced = true;
    }
  }

  return entries;
}

/**
 * Load a snapshot file for an arbitrary date string. Returns { captured_at, tickets } or null.
 *
 * @param {string} dateStr - YYYY-MM-DD
 * @param {string} profile
 * @param {string} configDir
 * @param {object} fsModule
 * @returns {{ captured_at: string|null, tickets: object[] }|null}
 */
function loadSnapshotForDate(dateStr, profile, configDir, fsModule) {
  const filePath = snapshotPath(configDir, dateStr, profile);
  try {
    const parsed = JSON.parse(fsModule.readFileSync(filePath, 'utf8'));
    if (Array.isArray(parsed)) return { captured_at: null, tickets: parsed };
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Compute response-time and triage-cadence metrics from local triage history.
 *
 * A "response transition" is detected when a ticket appears as `needs-response`
 * in snapshot D and `clear` in snapshot D+1. Response time = captured_at of the
 * clear snapshot minus lastComment.created of the needs-response snapshot.
 *
 * @param {string} profile
 * @param {object} [opts]
 * @param {number} [opts.days=7]            Lookback window in calendar days
 * @param {string} [opts.configDir]
 * @param {object} [opts.fsModule]
 * @param {Date}   [opts.now]
 * @returns {{
 *   avgResponseHours: number|null,
 *   medianResponseHours: number|null,
 *   clearRate: number|null,
 *   triageRunCount: number,
 *   currentUrgency: { needsResponse: number, aging: number, clear: number }|null,
 *   windowDays: number,
 *   trendHours: number|null,
 * }}
 */
export function computeResponseMetrics(profile, {
  days = 7,
  configDir = DEFAULT_CONFIG_DIR,
  fsModule = defaultFs,
  now = new Date(),
} = {}) {
  validateProfile(profile);

  function windowSnapshots(offsetStart, count) {
    const snaps = [];
    for (let i = offsetStart + count - 1; i >= offsetStart; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = toDateString(d);
      const snap = loadSnapshotForDate(dateStr, profile, configDir, fsModule);
      if (snap) snaps.push({ dateStr, ...snap });
    }
    return snaps; // chronological order (oldest first)
  }

  function computeFromSnaps(snaps) {
    const durations = [];
    let transitions = 0;
    let fastTransitions = 0;

    for (let i = 0; i + 1 < snaps.length; i++) {
      const dayA = snaps[i];
      const dayB = snaps[i + 1];
      const mapA = new Map(dayA.tickets.map(t => [t.ticketKey, t]));

      for (const tb of dayB.tickets) {
        if (tb.urgency !== 'clear') continue;
        const ta = mapA.get(tb.ticketKey);
        if (!ta || ta.urgency !== 'needs-response') continue;

        transitions++;
        const commentCreated = ta.lastComment?.created;
        const clearedAt = dayB.captured_at;
        if (!commentCreated || !clearedAt) continue;

        const ms = new Date(clearedAt).getTime() - new Date(commentCreated).getTime();
        if (isNaN(ms) || ms < 0) continue;
        const hours = ms / 3_600_000;
        durations.push(hours);
        if (hours <= 24) fastTransitions++;
      }
    }

    return {
      avgResponseHours: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
      medianResponseHours: median(durations),
      clearRate: durations.length > 0 ? fastTransitions / durations.length : null,
      triageRunCount: snaps.length,
    };
  }

  const currentSnaps = windowSnapshots(0, days);
  const current = computeFromSnaps(currentSnaps);

  // Current urgency from the most recent snapshot
  const latest = currentSnaps[currentSnaps.length - 1] ?? null;
  const currentUrgency = latest
    ? {
        needsResponse: latest.tickets.filter(t => t.urgency === 'needs-response').length,
        aging:         latest.tickets.filter(t => t.urgency === 'aging').length,
        clear:         latest.tickets.filter(t => t.urgency === 'clear').length,
      }
    : null;

  // Trend: compare current window avg vs prior window avg
  const priorSnaps = windowSnapshots(days, days);
  const prior = computeFromSnaps(priorSnaps);
  const trendHours =
    current.avgResponseHours !== null && prior.avgResponseHours !== null
      ? current.avgResponseHours - prior.avgResponseHours
      : null;

  return {
    avgResponseHours: current.avgResponseHours,
    medianResponseHours: current.medianResponseHours,
    clearRate: current.clearRate,
    triageRunCount: current.triageRunCount,
    currentUrgency,
    windowDays: days,
    trendHours,
  };
}
