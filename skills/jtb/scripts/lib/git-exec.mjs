/**
 * Shared spawnSync-over-git wrapper. Extracted after code review on backlog
 * #27 found `pr-assembler.mjs`, `pr-opener.mjs`, `branch-scanner.mjs`, and
 * `commit-linker.mjs` each reimplementing this; the duplication is exactly
 * what let `pr-assembler.mjs`'s own `detectRemoteUrl` silently drop `cwd`.
 * `branch-scanner.mjs`/`commit-linker.mjs` are left untouched here — out of
 * this ticket's scope, no evidence either has the same bug.
 */

const SPAWN_OPTS = { encoding: 'utf8', timeout: 10_000 };

/**
 * @param {Function} execFn - spawnSync-compatible function
 * @param {string[]} args - args after "git", e.g. ['remote', 'get-url', 'origin']
 * @param {string} [cwd]
 * @returns {string|null} stdout on success, null on non-zero exit or a thrown error
 */
export function runGit(execFn, args, cwd) {
  try {
    const result = execFn('git', args, { ...SPAWN_OPTS, cwd });
    return result.status === 0 ? (result.stdout ?? '') : null;
  } catch {
    return null;
  }
}

/**
 * @param {Function} execFn
 * @param {string} [cwd]
 * @returns {string|null}
 */
export function detectRemoteUrl(execFn, cwd) {
  const out = runGit(execFn, ['remote', 'get-url', 'origin'], cwd);
  return out ? out.trim() : null;
}
