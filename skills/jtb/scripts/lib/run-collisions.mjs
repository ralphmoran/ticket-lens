import { readCliToken } from './cli-auth.mjs';
import { formatCollisions } from './collision-reporter.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

import { apiBase, warnIfInsecure } from './api-utils.mjs';

const COLLISIONS_PATH = '/v1/triage/collisions';

/**
 * Fetches cross-team branch collision data from the TicketLens API and prints results.
 *
 * @param {string[]} args              CLI argument array (e.g. ['--json', '--plain'])
 * @param {object}   [opts]
 * @param {Function} [opts.fetcher]          Injectable fetch
 * @param {Function} [opts.print]            Output function
 * @param {Function} [opts.readCliTokenFn]   Injectable CLI token reader
 * @param {string}   [opts.configDir]        Config directory override
 * @returns {Promise<{ ok: boolean, status?: number }>}
 */
export async function runCollisions(args = [], opts = {}) {
  const jsonFlag  = args.includes('--json');
  const plainFlag = args.includes('--plain');
  const fetcher        = opts.fetcher        ?? globalThis.fetch;
  const print          = opts.print          ?? ((s) => process.stdout.write(s));
  const warn           = opts.warn           ?? ((s) => process.stderr.write(s));
  const configDir      = opts.configDir      ?? DEFAULT_CONFIG_DIR;
  const readCliTokenFn = opts.readCliTokenFn ?? ((dir) => readCliToken(dir));
  warnIfInsecure(apiBase(), warn);

  const cliToken = readCliTokenFn(configDir) ?? null;
  if (!cliToken) {
    print('✗ collisions requires Console access. Run ticketlens login first.\n');
    return { ok: false };
  }

  try {
    const res = await fetcher(`${apiBase()}${COLLISIONS_PATH}`, {
      headers: { Authorization: `Bearer ${cliToken}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      if (res.status === 401) {
        print('✗ Session expired. Run ticketlens login to reconnect.\n');
        return { ok: false, status: 401 };
      }
      if (res.status === 403) {
        print('✗ collisions requires a Team license\n');
        return { ok: false, status: 403 };
      }
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
