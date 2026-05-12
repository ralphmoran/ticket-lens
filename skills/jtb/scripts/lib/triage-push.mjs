/**
 * POST scored triage snapshot to the TicketLens API.
 * All errors are caught — push failure must never break triage output.
 */

const PUSH_PATH = '/v1/triage/push';
// Local dev: http://ticketlens.test — production override via TICKETLENS_API_URL env var
const DEFAULT_API_BASE = 'http://ticketlens.test';

function apiBase() {
  return process.env?.TICKETLENS_API_URL ?? DEFAULT_API_BASE;
}

// Derive console queue URL from API base:
//   http://ticketlens.test          → http://ticketlens.test/console/queue
//   https://api.ticketlens.com      → https://app.ticketlens.com/console/queue
function queueUrl(base) {
  return base.replace(/^(https?:\/\/)api\./, '$1app.') + '/console/queue';
}

function buildTicketPayload(scored, rawMap, baseUrl) {
  const raw = rawMap?.get(scored.ticketKey);
  return {
    key: scored.ticketKey,
    summary: scored.summary ?? null,
    status: scored.status ?? null,
    assignee: raw?.assignee ?? null,
    attention_score: null,
    flags: scored.urgency === 'clear' ? [] : [scored.urgency],
    compliance_coverage: null,
    compliance_status: 'unknown',
    url: baseUrl ? `${baseUrl}/browse/${scored.ticketKey}` : null,
    last_updated: raw?.updated ?? null,
  };
}

/**
 * POST the scored triage snapshot to the TicketLens API.
 *
 * @param {object}   opts
 * @param {object[]} [opts.sorted]       - Scored tickets from attention-scorer
 * @param {Map}      [opts.rawTicketMap] - Map<key, normalizedTicket>
 * @param {string}   [opts.profile]      - Resolved profile name (max 100 chars)
 * @param {string}   [opts.baseUrl]      - Jira base URL for URL construction
 * @param {string}   [opts.licenseKey]   - Bearer token for the API
 * @param {string}   [opts.capturedAt]   - ISO 8601 timestamp (defaults to now)
 * @param {Function} [opts.fetcher]      - Injectable fetch (default: globalThis.fetch)
 * @param {Function} [opts.print]        - Output fn (default: process.stdout.write)
 * @returns {Promise<{ ok: boolean, status?: number }>}
 */
export async function pushTriageSnapshot({
  sorted = [],
  rawTicketMap = new Map(),
  profile,
  baseUrl,
  licenseKey,
  capturedAt,
  fetcher = globalThis.fetch,
  print = (s) => process.stdout.write(s),
} = {}) {
  if (!licenseKey) {
    print('✗ --push requires an active Team license (ticketlens activate <key>)\n');
    return { ok: false };
  }

  const payload = {
    profile: String(profile ?? 'default').slice(0, 100),
    captured_at: capturedAt ?? new Date().toISOString(),
    tickets: sorted.map(t => buildTicketPayload(t, rawTicketMap, baseUrl)),
  };

  try {
    const res = await fetcher(`${apiBase()}${PUSH_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${licenseKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      print(`✓ Queue updated — view at ${queueUrl(apiBase())}\n`);
      return { ok: true, status: res.status };
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
