/**
 * POST scored triage snapshot to the TicketLens API.
 * All errors are caught — push failure must never break triage output.
 */

import { readLedger } from './ledger.mjs';
import { isLicensed } from './license.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
import { apiBase, warnIfInsecure } from './api-utils.mjs';
import { buildTicketPayload } from './ticket-payload.mjs';

const PUSH_PATH = '/v1/triage/push';

// Derive console queue URL from API base:
//   http://api.ticketlens.test      → http://ticketlens.test/console/queue
//   https://api.ticketlens.com      → https://app.ticketlens.com/console/queue
export function queueUrl(base) {
  const noApi = base.replace(/^(https?:\/\/)api\./, '$1');
  const consoleBase = /ticketlens\.com/.test(noApi)
    ? noApi.replace('://', '://app.')
    : noApi;
  return consoleBase + '/console/queue';
}

/**
 * POST the scored triage snapshot to the TicketLens API.
 *
 * @param {object}   opts
 * @param {object[]} [opts.sorted]       - Scored tickets from attention-scorer
 * @param {Map}      [opts.rawTicketMap] - Map<key, normalizedTicket>
 * @param {string}   [opts.profile]      - Resolved profile name (max 100 chars)
 * @param {string}   [opts.baseUrl]      - Jira base URL for URL construction
 * @param {string}   [opts.cliToken]     - CLI session token for the API
 * @param {string}   [opts.capturedAt]   - ISO 8601 timestamp (defaults to now)
 * @param {Array}    [opts.gitBranches]  - Branch metadata from scanCurrentBranch (null = not in git repo)
 * @param {Function} [opts.fetcher]      - Injectable fetch (default: globalThis.fetch)
 * @param {Function} [opts.print]        - Output fn (default: process.stdout.write)
 * @returns {Promise<{ ok: boolean, status?: number }>}
 */
export async function pushTriageSnapshot({
  sorted = [],
  rawTicketMap = new Map(),
  profile,
  baseUrl,
  cliToken,
  capturedAt,
  gitBranches,
  fetcher = globalThis.fetch,
  print = (s) => process.stdout.write(s),
  warn = (s) => process.stderr.write(s),
  readLedgerFn = readLedger,
  isLicensedFn = isLicensed,
  configDir = DEFAULT_CONFIG_DIR,
} = {}) {
  warnIfInsecure(apiBase(), warn);
  if (!cliToken) {
    print('✗ --push requires Console access. Run ticketlens login first.\n');
    return { ok: false };
  }

  let tickets = sorted.map(t => buildTicketPayload(t, rawTicketMap, baseUrl));

  if (isLicensedFn('pro', configDir)) {
    try {
      const latestByKey = new Map();
      for (const entry of readLedgerFn({ configDir })) {
        const prev = latestByKey.get(entry.ticketKey);
        if (!prev || entry.ts > prev.ts) latestByKey.set(entry.ticketKey, entry);
      }
      tickets = tickets.map(t => {
        const entry = latestByKey.get(t.key);
        if (!entry) return t;
        return {
          ...t,
          compliance_coverage: entry.coverage ?? null,
          compliance_status: (entry.missing?.length ?? 0) === 0 ? 'pass' : 'gap',
        };
      });
    } catch {
      // non-fatal — ledger errors must not break triage push
    }
  }

  const payload = {
    profile: String(profile ?? 'default').slice(0, 100),
    captured_at: capturedAt ?? new Date().toISOString(),
    tickets,
    ...(gitBranches != null && { git_branches: gitBranches }),
  };

  try {
    const res = await fetcher(`${apiBase()}${PUSH_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cliToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      print(`✓ Queue updated — view at ${queueUrl(apiBase())}\n`);
      return { ok: true, status: res.status };
    }

    if (res.status === 401) {
      print('✗ Session expired. Run ticketlens login to reconnect.\n');
      return { ok: false, status: res.status };
    }

    if (res.status === 403) {
      print('✗ --push requires a Team license\n');
      return { ok: false, status: res.status };
    }

    print(`⚠ Push failed (${res.status}) — triage output unaffected\n`);
    return { ok: false, status: res.status };
  } catch {
    print('⚠ Push failed (network error) — triage output unaffected\n');
    return { ok: false };
  }
}
