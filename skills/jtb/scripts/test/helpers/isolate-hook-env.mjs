import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Loopback + closed port: detached children fail instantly and can never reach a real backend.
const UNREACHABLE_API_URL = 'http://127.0.0.1:1';

// Detached children can't be awaited; give late ones time to finish before the dir is removed,
// or they recreate it (privateTmpDir() mkdirs recursively) and leave debris behind.
const CHILD_SETTLE_MS = 500;

/**
 * Hook tests run the real Stop hook, which spawns detached auto-capture children.
 * Un-isolated, those children append to the machine-wide auto-capture.log and call the
 * real TICKETLENS_API_URL backend with fake tokens — fabricating "Unauthorized" noise
 * (backlog #33). Points TMPDIR + TICKETLENS_API_URL at throwaway values for this
 * process and every child it spawns; returns an async restore function.
 */
export function isolateHookEnv() {
  const previous = { TMPDIR: process.env.TMPDIR, TICKETLENS_API_URL: process.env.TICKETLENS_API_URL };
  const isolatedTmp = mkdtempSync(join(tmpdir(), 'ticketlens-test-tmp-'));
  process.env.TMPDIR = isolatedTmp;
  process.env.TICKETLENS_API_URL = UNREACHABLE_API_URL;

  return async function restoreHookEnv() {
    await new Promise(resolve => setTimeout(resolve, CHILD_SETTLE_MS));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    // Retries cover a late child writing mid-delete (ENOTEMPTY) on a loaded machine.
    rmSync(isolatedTmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
}
