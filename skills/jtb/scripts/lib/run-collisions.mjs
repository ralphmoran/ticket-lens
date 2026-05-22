import { readLicense } from './license.mjs';
import { formatCollisions } from './collision-reporter.mjs';

const COLLISIONS_PATH = '/v1/triage/collisions';
const DEFAULT_API_BASE = 'http://ticketlens.test';

function apiBase() {
  return process.env?.TICKETLENS_API_URL ?? DEFAULT_API_BASE;
}

/**
 * Fetches cross-team branch collision data from the TicketLens API and prints results.
 *
 * @param {string[]} args              CLI argument array (e.g. ['--json', '--plain'])
 * @param {object}   [opts]
 * @param {Function} [opts.fetcher]        Injectable fetch
 * @param {Function} [opts.print]          Output function
 * @param {Function} [opts.readLicenseFn]  Injectable license reader
 * @returns {Promise<{ ok: boolean, status?: number }>}
 */
export async function runCollisions(args = [], opts = {}) {
  const jsonFlag  = args.includes('--json');
  const plainFlag = args.includes('--plain');
  const fetcher        = opts.fetcher       ?? globalThis.fetch;
  const print          = opts.print         ?? ((s) => process.stdout.write(s));
  const readLicenseFn  = opts.readLicenseFn ?? (() => readLicense());

  const licenseKey = readLicenseFn()?.key ?? null;
  if (!licenseKey) {
    print('✗ collisions requires an active Team license (ticketlens activate <key>)\n');
    return { ok: false };
  }

  try {
    const res = await fetcher(`${apiBase()}${COLLISIONS_PATH}`, {
      headers: { Authorization: `Bearer ${licenseKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      if (res.status === 401) { print('✗ Invalid license key\n');              return { ok: false, status: 401 }; }
      if (res.status === 403) { print('✗ collisions requires a Team license\n'); return { ok: false, status: 403 }; }
      print(`⚠ Failed to fetch collisions (${res.status})\n`);
      return { ok: false, status: res.status };
    }

    const { collisions = [], message } = await res.json();

    if (message && collisions.length === 0) {
      print(message + '\n');
      return { ok: true };
    }

    print(formatCollisions(collisions, {
      json:   jsonFlag,
      plain:  plainFlag,
      isTTY:  process.stdout.isTTY ?? false,
    }));

    return { ok: true };
  } catch {
    print('⚠ Failed to fetch collisions (network error)\n');
    return { ok: false };
  }
}
