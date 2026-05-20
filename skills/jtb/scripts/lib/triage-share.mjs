/**
 * POST triage snapshot to /v1/triage/share and return a 24h signed URL.
 * Errors are non-fatal — share failure must never suppress triage output.
 */

const SHARE_PATH = '/v1/triage/share';
const DEFAULT_API_BASE = 'http://ticketlens.test';

function apiBase() {
  return process.env?.TICKETLENS_API_URL ?? DEFAULT_API_BASE;
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
 * @param {object}   opts
 * @param {object[]} [opts.sorted]       - Scored tickets
 * @param {Map}      [opts.rawTicketMap] - Map<key, normalizedTicket>
 * @param {string}   [opts.profile]      - Resolved profile name (max 100 chars)
 * @param {string}   [opts.baseUrl]      - Jira base URL
 * @param {string}   [opts.licenseKey]   - Bearer token
 * @param {string}   [opts.capturedAt]   - ISO 8601 timestamp
 * @param {Function} [opts.fetcher]      - Injectable fetch
 * @param {Function} [opts.print]        - Output fn
 * @returns {Promise<{ ok: boolean, status?: number }>}
 */
export async function shareTriageSnapshot({
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
    print('✗ --share requires an active Team license (ticketlens activate <key>)\n');
    return { ok: false };
  }

  const payload = {
    profile: String(profile ?? 'default').slice(0, 100),
    captured_at: capturedAt ?? new Date().toISOString(),
    tickets: sorted.map(t => buildTicketPayload(t, rawTicketMap, baseUrl)),
  };

  try {
    const res = await fetcher(`${apiBase()}${SHARE_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${licenseKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      print(`✓ Share link (expires in 24h):\n  ${data.url}\n`);
      return { ok: true, status: res.status };
    }

    if (res.status === 403) {
      print('✗ --share requires a Team license\n');
      return { ok: false, status: res.status };
    }

    print(`⚠ Share failed (${res.status}) — triage output unaffected\n`);
    return { ok: false, status: res.status };
  } catch {
    print('⚠ Share failed (network error) — triage output unaffected\n');
    return { ok: false };
  }
}
