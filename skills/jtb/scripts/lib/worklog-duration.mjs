/**
 * Duration and start-time parsing for worklogs. Jira's own `timeSpent` string
 * treats `d`/`w` as instance-configured (a "day" is whatever the admin set) and
 * is mutually exclusive with `timeSpentSeconds`, so durations are parsed here
 * into exact seconds — hours and minutes only, deterministic on every instance.
 */

/** A single worklog above a full day is far more likely a typo (`90h` for `90m`) than real. */
export const MAX_WORKLOG_SECONDS = 86_400;

/** Tolerance for a `started` slightly ahead of this machine's clock. */
export const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

/** Older than this is far more likely a year typo (2016 for 2026) than a real backfill. */
export const MAX_PAST_MS = 365 * 24 * 60 * 60 * 1000;

const DURATION_PATTERN = /^(?:(\d{1,4})h)?(?:(\d{1,4})m)?$/;
const DAYS_OR_WEEKS_PATTERN = /\d[dw]/;
const STARTED_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}/;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const fail = (error) => ({ ok: false, error });

/**
 * @param {unknown} input - e.g. "1h30m", "1h 30m", "90m"
 * @returns {{ ok: true, seconds: number } | { ok: false, error: string }}
 */
export function parseDuration(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return fail('Duration is required, e.g. "1h30m" or "45m".');
  }
  const compact = input.replace(/\s+/g, '').toLowerCase();
  if (DAYS_OR_WEEKS_PATTERN.test(compact)) {
    return fail(`Days and weeks are not supported — Jira defines them per instance. Express ${JSON.stringify(input)} in hours, e.g. "8h".`);
  }
  const match = DURATION_PATTERN.exec(compact);
  if (!match) {
    return fail(`Invalid duration ${JSON.stringify(input)} — use hours and minutes, e.g. "1h30m" or "90m".`);
  }
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60;
  if (seconds <= 0) return fail('Duration must be greater than zero.');
  if (seconds > MAX_WORKLOG_SECONDS) return fail(`Duration ${JSON.stringify(input)} exceeds the 24h per-entry limit.`);
  return { ok: true, seconds };
}

/** @param {number} seconds - a positive multiple of 60 */
export function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return [hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean).join(' ') || '0m';
}

/** Jira rejects `Z` and `+00:00` here — only the `+0000` form is accepted. */
export function toJiraDateTime(date) {
  return date.toISOString().replace('Z', '+0000');
}

/** Rejects an out-of-range day (2026-02-30) that `Date` would silently roll into the next month. */
function hasValidDay(year, month, day) {
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * @param {unknown} input - ISO 8601 with a time component; omitted means now.
 *   A timestamp with no offset is read as this machine's local time.
 * @param {{ now?: () => number }} [opts]
 * @returns {{ ok: true, started: string } | { ok: false, error: string }}
 */
export function parseStarted(input, { now = () => Date.now() } = {}) {
  if (input === undefined) return { ok: true, started: toJiraDateTime(new Date(now())) };

  const invalid = fail(`Invalid started value ${JSON.stringify(input)} — use ISO 8601, e.g. "2026-09-18T10:00:00-07:00".`);
  if (typeof input !== 'string') return invalid;

  const trimmed = input.trim();
  if (DATE_ONLY_PATTERN.test(trimmed)) {
    return fail('Started needs a time, not just a date — e.g. "2026-09-18T10:00:00-07:00".');
  }
  const match = STARTED_PATTERN.exec(trimmed);
  const ms = Date.parse(trimmed);
  if (!match || Number.isNaN(ms) || !hasValidDay(Number(match[1]), Number(match[2]), Number(match[3]))) return invalid;
  if (ms > now() + MAX_FUTURE_SKEW_MS) return fail('Started is in the future — worklogs record time already spent.');
  if (ms < now() - MAX_PAST_MS) return fail('Started is older than a year — check the year. Backfilling that far is not supported here.');
  return { ok: true, started: toJiraDateTime(new Date(ms)) };
}
