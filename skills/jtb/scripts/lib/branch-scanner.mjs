import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const TICKET_KEY_RE = /([A-Z][A-Z0-9]+-\d+)/g;
const SPAWN_OPTS = { encoding: 'utf8', timeout: 10_000 };
const MAX_FILES = 200;
const BASE_CANDIDATES = ['origin/main', 'origin/master', 'origin/develop', 'main', 'master'];

function run(execFn, args, cwd) {
  const result = execFn('git', args, { ...SPAWN_OPTS, cwd, stdio: 'pipe' });
  return result.status === 0 ? (result.stdout ?? '') : null;
}

function extractTicketKeys(text) {
  return [...new Set([...text.matchAll(TICKET_KEY_RE)].map(m => m[1]))];
}

function detectBase(execFn, cwd) {
  for (const candidate of BASE_CANDIDATES) {
    if (run(execFn, ['rev-parse', '--verify', candidate], cwd) !== null) return candidate;
  }
  return null;
}

/**
 * Scans the current git branch for changed files and linked ticket keys.
 *
 * @param {object}   [opts]
 * @param {string}   [opts.cwd]    Working directory (default: process.cwd())
 * @param {Function} [opts.execFn] spawnSync replacement (injectable for tests)
 * @param {Function} [opts.fsCheck] existsSync replacement (injectable for tests)
 * @returns {Array<{branch:string, base:string|null, tickets:string[], files:string[]}>|null}
 *   One-element array for the current branch, or null if not in a git repo / detached HEAD.
 */
export function scanCurrentBranch({ cwd = process.cwd(), execFn = spawnSync, fsCheck = existsSync } = {}) {
  if (!fsCheck(join(cwd, '.git'))) return null;

  const branch = run(execFn, ['rev-parse', '--abbrev-ref', 'HEAD'], cwd)?.trim();
  if (!branch || branch === 'HEAD') return null;

  const base = detectBase(execFn, cwd);

  let files = [];
  if (base) {
    const diffOut = run(execFn, ['diff', '--name-only', `${base}..HEAD`], cwd);
    if (diffOut) {
      files = diffOut.trim().split('\n').filter(Boolean).slice(0, MAX_FILES);
    }
  }

  const recentLog = run(execFn, ['log', '--oneline', '-20'], cwd) ?? '';
  const tickets = extractTicketKeys(`${branch} ${recentLog}`);

  return [{ branch, base, tickets, files }];
}
