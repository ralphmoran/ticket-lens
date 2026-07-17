/**
 * Pushes locally-authored Recall notes to the team backend and pulls
 * teammates' notes into the local vault. Modeled on triage-push.mjs's
 * auth/timeout/error-handling shape, with two deliberate differences:
 *
 * - Push failures here are reported to the user (via `warn`), not silently
 *   swallowed — a note the user thinks synced to the team must never fail
 *   quietly the way an ephemeral triage snapshot push can.
 * - Pull checks its local TTL state BEFORE touching the network at all, and
 *   takes a caller-supplied `timeoutMs` rather than a fixed 15s: a brief
 *   fetch (passive, must feel instant) needs a short timeout with a silent
 *   skip-on-miss fallback, while `tl recall` (user explicitly waiting) can
 *   afford the same 15s triage-push.mjs uses.
 */

import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { apiBase, warnIfInsecure } from './api-utils.mjs';
import { upsertPulledNote, rebuildIndex, deleteNote } from './recall-vault.mjs';
import { red, yellow, dim, cyan } from './ansi.mjs';

const PUSH_PATH = '/v1/recall/push';
const PULL_PATH = '/v1/recall/pull';
export const RECALL_PULL_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours, matches BRIEF_TTL_MS
export const RECALL_ENTITLEMENT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours — entitlement changes are owner-driven and rare
const PULL_STATE_FILE = 'recall-pull-state.json';
const ENTITLEMENT_STATE_FILE = 'recall-entitlement-state.json';

function pullStatePath(configDir) {
  return path.join(configDir, PULL_STATE_FILE);
}

function readLastPulledAt(configDir) {
  try {
    return JSON.parse(fs.readFileSync(pullStatePath(configDir), 'utf8')).lastPulledAt ?? null;
  } catch {
    return null;
  }
}

function writeLastPulledAt(configDir, isoTimestamp) {
  try {
    fs.writeFileSync(pullStatePath(configDir), JSON.stringify({ lastPulledAt: isoTimestamp }), 'utf8');
  } catch {
    // Non-fatal — worst case the next pull re-fetches everything again.
  }
}

function entitlementCachePath(configDir) {
  return path.join(configDir, ENTITLEMENT_STATE_FILE);
}

function readEntitlementCheckedAt(configDir) {
  try {
    return JSON.parse(fs.readFileSync(entitlementCachePath(configDir), 'utf8')).checkedAt ?? null;
  } catch {
    return null;
  }
}

function writeEntitlementCheckedAt(configDir, isoTimestamp) {
  try {
    fs.writeFileSync(entitlementCachePath(configDir), JSON.stringify({ checkedAt: isoTimestamp }), 'utf8');
  } catch {
    // Non-fatal — worst case the next save warns again instead of staying silent.
  }
}

/**
 * POSTs one locally-authored note to the team backend.
 *
 * @param {object}   note
 * @param {object}   opts
 * @param {string}   [opts.cliToken]
 * @param {string}   [opts.configDir]
 * @param {number}   [opts.timeoutMs]
 * @param {Function} [opts.fetcher]
 * @param {Function} [opts.warn] - failure output (default: process.stderr.write)
 * @returns {Promise<{ ok: boolean, status?: number }>}
 */
export async function pushNote(note, {
  cliToken,
  configDir = DEFAULT_CONFIG_DIR,
  timeoutMs = 15_000,
  ttlMs = RECALL_ENTITLEMENT_TTL_MS,
  fetcher = globalThis.fetch,
  warn = (s) => process.stderr.write(s),
  now = () => Date.now(),
} = {}) {
  if (!cliToken) {
    return { ok: false };
  }

  // A non-entitled account gets this same 403 on every save until the owner
  // flips the Recall grant — without this, the warning below repeats forever.
  const checkedAt = readEntitlementCheckedAt(configDir);
  if (checkedAt && now() - new Date(checkedAt).getTime() < ttlMs) {
    return { ok: false, skipped: true };
  }

  warnIfInsecure(apiBase(), warn);

  let res;
  try {
    res = await fetcher(`${apiBase()}${PUSH_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${cliToken}`,
      },
      body: JSON.stringify(note),
      // Without Accept: application/json, a Laravel validation failure 302-redirects
      // instead of returning JSON, and fetch's default redirect:'follow' silently
      // turns that into a followed 200 — a false "pushed" the user never sees fail.
      // 'manual' makes any unexpected redirect surface as a non-ok response instead.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    warn(`  ${yellow('⚠')} Could not sync note to your team (network error) — saved locally only.\n`);
    return { ok: false };
  }

  if (res.ok) {
    return { ok: true, status: res.status };
  }

  if (res.status === 401) {
    warn(`  ${red('✗')} Session expired — saved locally only.\n  ${dim('→ Run')} ${cyan('ticketlens login')} ${dim('to reconnect and sync it later.')}\n`);
    return { ok: false, status: res.status };
  }

  if (res.status === 403) {
    // Found via Local Live Test: a single generic "plan doesn't include this"
    // message was actively misleading for a real, valid state — a Pro user
    // entitled to Recall but not on any team yet (PushController's two
    // distinct 403 reasons: not entitled vs. no team). Matched against known
    // server-controlled strings rather than relaying the raw body verbatim.
    let reason;
    try { reason = (await res.json())?.error; } catch { /* fall through to the generic message below */ }
    if (reason === 'No team found') {
      // Deliberately never cached: joining a team is a fast, self-directed fix,
      // unlike entitlement (which waits on the owner) — the nudge stays useful.
      warn(`  ${yellow('⚠')} You're not on a team yet, so there's nowhere to sync this note — saved locally only.\n`);
    } else {
      warn(`  ${yellow('⚠')} Your plan doesn't include team Recall sync — saved locally only.\n`);
      writeEntitlementCheckedAt(configDir, new Date(now()).toISOString());
    }
    return { ok: false, status: res.status };
  }

  warn(`  ${yellow('⚠')} Could not sync note to your team (${res.status}) — saved locally only.\n`);
  return { ok: false, status: res.status };
}

/**
 * Pulls teammates' notes down and writes them into the local vault, honoring
 * a TTL checked before any network call. Every pulled note is written
 * through upsertPulledNote (which validates its own externalId/ticket key
 * before ever touching a file path); one malformed note never aborts the
 * rest of the batch. The vault index is rebuilt once per touched prefix
 * after the whole batch, not per note.
 *
 * @param {object}   opts
 * @param {string}   [opts.cliToken]
 * @param {string}   [opts.configDir]
 * @param {number}   [opts.ttlMs] - skip the network call if the last pull is more recent than this
 * @param {number}   [opts.timeoutMs] - request timeout; short for a passive/background pull, long for an explicit one
 * @param {Function} [opts.fetcher]
 * @param {Function} [opts.upsertPulledNoteFn]
 * @param {Function} [opts.rebuildIndexFn]
 * @param {() => number} [opts.now]
 * @returns {Promise<{ ok: boolean, skipped?: boolean, count: number }>}
 */
export async function pullNotes({
  cliToken,
  configDir = DEFAULT_CONFIG_DIR,
  ttlMs = RECALL_PULL_TTL_MS,
  timeoutMs = 15_000,
  fetcher = globalThis.fetch,
  upsertPulledNoteFn = upsertPulledNote,
  rebuildIndexFn = rebuildIndex,
  deleteNoteFn = deleteNote,
  now = () => Date.now(),
} = {}) {
  if (!cliToken) {
    return { ok: false, count: 0 };
  }

  const lastPulledAt = readLastPulledAt(configDir);
  if (lastPulledAt && now() - new Date(lastPulledAt).getTime() < ttlMs) {
    return { ok: true, skipped: true, count: 0 };
  }

  const url = new URL(`${apiBase()}${PULL_PATH}`);
  if (lastPulledAt) url.searchParams.set('since', lastPulledAt);

  let res;
  try {
    res = await fetcher(url.toString(), {
      headers: { 'Authorization': `Bearer ${cliToken}`, 'Accept': 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, count: 0 };
  }

  if (!res.ok) {
    return { ok: false, status: res.status, count: 0 };
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    return { ok: false, count: 0 };
  }

  const notes   = payload.notes ?? [];
  const deleted = payload.deleted ?? [];
  const touchedPrefixes = new Set();
  for (const remoteNote of notes) {
    try {
      const { path: notePath } = upsertPulledNoteFn(remoteNote, { configDir });
      touchedPrefixes.add(path.basename(path.dirname(notePath)));
    } catch {
      // One malformed remote note must never abort the rest of the pull.
    }
  }
  for (const tombstone of deleted) {
    try {
      const { deleted: wasDeleted, prefix } = deleteNoteFn(tombstone, { configDir });
      if (wasDeleted) touchedPrefixes.add(prefix);
    } catch {
      // Same policy as the upsert loop above: one malformed tombstone must
      // never abort the rest of the pull.
    }
  }
  for (const prefix of touchedPrefixes) rebuildIndexFn(prefix, { configDir });

  writeLastPulledAt(configDir, new Date(now()).toISOString());
  return { ok: true, count: notes.length };
}
