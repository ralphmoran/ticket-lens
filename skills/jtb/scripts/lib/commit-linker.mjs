import { spawnSync } from 'node:child_process';

const TICKET_KEY_RE = /^[A-Z]+-\d+$/;
const SPAWN_OPTS = { encoding: 'utf8', timeout: 10_000 };

function run(execFn, cmd, args, cwd) {
  const result = execFn(cmd, args, { ...SPAWN_OPTS, cwd });
  return result.status === 0 ? (result.stdout || '') : null;
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

  // git diff HEAD: current working diff
  const diffOut = run(execFn, 'git', ['diff', 'HEAD'], cwd);

  return {
    commits,
    branches,
    diff: diffOut || null,
  };
}
