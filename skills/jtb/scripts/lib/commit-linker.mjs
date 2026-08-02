import { spawnSync } from 'node:child_process';
import { detectBase } from './branch-scanner.mjs';

const TICKET_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;
const SPAWN_OPTS = { encoding: 'utf8', timeout: 10_000 };

function run(execFn, cmd, args, cwd) {
  const result = execFn(cmd, args, { ...SPAWN_OPTS, cwd });
  return result.status === 0 ? (result.stdout || '') : null;
}

// `git diff HEAD` alone is empty on any clean tree, so it sees nothing once
// work is committed — the exact state a post-commit pre-push hook always
// runs in. Diffing against the branch's merge-base instead (single-ref form:
// merge-base tree vs. the current working directory) captures everything
// since the branch point, committed or not, regardless of when it's invoked.
function computeDiff(execFn, cwd) {
  const base = detectBase(execFn, cwd);
  if (base) {
    const mergeBase = run(execFn, 'git', ['merge-base', 'HEAD', base], cwd)?.trim();
    if (mergeBase) {
      return run(execFn, 'git', ['diff', mergeBase], cwd);
    }
  }
  return run(execFn, 'git', ['diff', 'HEAD'], cwd);
}

export function findLinkedCommits(ticketKey, opts = {}) {
  if (!TICKET_KEY_RE.test(ticketKey)) {
    throw new Error(`Invalid ticket key: ${ticketKey}`);
  }

  const execFn = opts.execFn ?? spawnSync;
  const cwd    = opts.cwd    ?? process.cwd();

  // git log: last 100 commits, one line each
  const logOut = run(execFn, 'git', ['log', '--oneline', '-100', '--all'], cwd) ?? '';
  const commits = logOut
    .split('\n')
    .filter(line => line.includes(ticketKey))
    .map(line => line.trim())
    .filter(Boolean);

  // git branch: all local + remote branches
  const branchOut = run(execFn, 'git', ['branch', '--all'], cwd) ?? '';
  const branches = branchOut
    .split('\n')
    .map(line => line.replace(/^\*?\s+/, '').trim())
    .filter(name => name.includes(ticketKey));

  const diffOut = computeDiff(execFn, cwd);

  return {
    commits,
    branches,
    diff: diffOut || null,
  };
}
