/**
 * Detects whether the `tl` shorthand resolves to this package's own
 * bin/ticketlens.mjs, a foreign binary shadowing it on PATH, or nothing.
 * Pure filesystem checks only — no subprocess spawning, no network.
 */

import { existsSync, accessSync, realpathSync, constants as fsConstants } from 'node:fs';
import { join, dirname } from 'node:path';

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/**
 * Scan PATH for the first executable matching binName. Never throws —
 * an unreadable or missing directory is skipped, not fatal.
 */
export function findOnPath(binName, { env = process.env, platform = process.platform } = {}) {
  const isWin = platform === 'win32';
  // PATH delimiter depends on the target platform, not the host running this
  // code — node:path's `delimiter` is host-bound and wrong when platform is
  // passed explicitly (e.g. testing win32 logic from a POSIX host).
  const dirs = (env.PATH || env.Path || '').split(isWin ? ';' : ':').filter(Boolean);
  const candidates = isWin
    ? [...(env.PATHEXT || DEFAULT_PATHEXT).split(';').map((ext) => binName + ext), binName]
    : [binName];

  for (const dir of dirs) {
    for (const name of candidates) {
      try {
        const full = join(dir, name);
        if (!existsSync(full)) continue;
        // POSIX: skip non-executable matches (a shell would too). Windows PATHEXT
        // already restricts candidates to executable extensions, so no check needed.
        if (!isWin) accessSync(full, fsConstants.X_OK);
        return full;
      } catch {
        continue;
      }
    }
  }
  return null;
}

/**
 * Compare where `tl` resolves against our own installed ticketlens binary.
 * POSIX: realpath comparison (npm bins are symlinks) against selfBinPath.
 * Windows: npm .cmd/.ps1 shims aren't real symlinks, and selfBinPath (the
 * package's internal target script under node_modules) lives in a different
 * directory than the shims themselves — comparing against it always reads
 * as foreign. Instead, npm always installs every bin entry from one package
 * into the same shim directory together, so confirm ownership by checking
 * whether a `ticketlens` shim sits alongside the found `tl` shim.
 */
export function checkAliasStatus({ selfBinPath, env = process.env, platform = process.platform } = {}) {
  try {
    const tlPath = findOnPath('tl', { env, platform });
    if (!tlPath) return { status: 'missing' };

    if (platform === 'win32') {
      const ticketlensPath = findOnPath('ticketlens', { env, platform });
      return ticketlensPath && dirname(tlPath) === dirname(ticketlensPath)
        ? { status: 'active' }
        : { status: 'shadowed', foreignPath: tlPath };
    }

    const resolvedTl = realpathSync(tlPath);
    const resolvedSelf = realpathSync(selfBinPath);
    return resolvedTl === resolvedSelf
      ? { status: 'active' }
      : { status: 'shadowed', foreignPath: tlPath };
  } catch {
    return { status: 'missing' };
  }
}
