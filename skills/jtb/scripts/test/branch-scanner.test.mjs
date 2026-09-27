import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanCurrentBranch } from '../lib/branch-scanner.mjs';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a spawnSync-compatible mock. Responses keyed by args joined with spaces.
 * Partial prefix matching: first key whose value is a prefix of the actual args key wins.
 */
function makeGitExecFn({
  branch     = 'feat/PROJ-123-checkout',
  base       = 'origin/main',
  diffFiles  = ['src/checkout.js', 'src/payment.js'],
  logLines   = ['abc1234 feat: PROJ-123 checkout flow', 'def5678 fix: typo'],
  branchFail = false,
} = {}) {
  return (_cmd, args, _opts) => {
    const key = args.join(' ');

    if (key === 'rev-parse --abbrev-ref HEAD') {
      if (branchFail) return { status: 1, stdout: '', stderr: '' };
      return { status: 0, stdout: branch + '\n', stderr: '' };
    }

    if (key.startsWith('rev-parse --verify')) {
      const candidate = args[2];
      return candidate === base
        ? { status: 0, stdout: 'abc123\n', stderr: '' }
        : { status: 1, stdout: '',         stderr: '' };
    }

    if (key.startsWith('diff --name-only')) {
      return { status: 0, stdout: diffFiles.join('\n') + (diffFiles.length ? '\n' : ''), stderr: '' };
    }

    if (key.startsWith('log --oneline')) {
      return { status: 0, stdout: logLines.join('\n'), stderr: '' };
    }

    return { status: 1, stdout: '', stderr: 'unknown command' };
  };
}

// ── No git repo ───────────────────────────────────────────────────────────────

describe('scanCurrentBranch — no git repo', () => {
  it('does not call diff/log when rev-parse fails (short-circuits on the real error)', () => {
    const calledCommands = [];
    const execFn = (cmd, args, opts) => {
      calledCommands.push(args[0]);
      return makeGitExecFn({ branchFail: true })(cmd, args, opts);
    };
    scanCurrentBranch({ cwd: '/tmp', execFn });
    assert.deepEqual(calledCommands, ['rev-parse']);
  });
});

// ── Subdirectory (backlog #45) ─────────────────────────────────────────────────

describe('scanCurrentBranch — run from a repo subdirectory', () => {
  it('returns real branch data when invoked from a subdirectory of a git repo', () => {
    // Backlog #45: a cwd-relative `.git` check used to return null here.
    const result = scanCurrentBranch({
      cwd: '/repo/src/nested/dir',
      execFn: makeGitExecFn({ branch: 'feat/PROJ-9-subdir' }),
    });
    assert.ok(result, 'expected a result when run from a subdirectory of a real repo');
    assert.equal(result[0].branch, 'feat/PROJ-9-subdir');
  });

  it('threads the subdirectory cwd through to every git invocation, not process.cwd()', () => {
    // A cwd-ignoring mock can't detect a dropped cwd (backlog #27 bug class).
    const seenCwds = [];
    const execFn = (cmd, args, opts) => {
      seenCwds.push(opts.cwd);
      return makeGitExecFn({ branch: 'feat/PROJ-9-subdir' })(cmd, args, opts);
    };
    scanCurrentBranch({ cwd: '/repo/src/nested/dir', execFn });
    assert.ok(seenCwds.length > 0, 'expected at least one git invocation');
    assert.ok(seenCwds.every(c => c === '/repo/src/nested/dir'), `all calls must use the passed cwd, got: ${seenCwds}`);
  });
});

// ── Detached HEAD ─────────────────────────────────────────────────────────────

describe('scanCurrentBranch — detached HEAD', () => {
  it('returns null when branch name is HEAD', () => {
    const result = scanCurrentBranch({
      execFn: makeGitExecFn({ branch: 'HEAD' }),
    });
    assert.equal(result, null);
  });

  it('returns null when rev-parse fails', () => {
    const result = scanCurrentBranch({
      execFn: makeGitExecFn({ branchFail: true }),
    });
    assert.equal(result, null);
  });
});

// ── Normal branch ─────────────────────────────────────────────────────────────

describe('scanCurrentBranch — normal branch', () => {
  it('returns one-element array', () => {
    const result = scanCurrentBranch({
      execFn: makeGitExecFn(),
    });
    assert.ok(Array.isArray(result));
    assert.equal(result.length, 1);
  });

  it('includes the current branch name', () => {
    const result = scanCurrentBranch({
      execFn: makeGitExecFn({ branch: 'feat/PROJ-42-my-feature' }),
    });
    assert.equal(result[0].branch, 'feat/PROJ-42-my-feature');
  });

  it('includes the resolved base', () => {
    const result = scanCurrentBranch({
      execFn: makeGitExecFn({ base: 'origin/main' }),
    });
    assert.equal(result[0].base, 'origin/main');
  });

  it('includes changed files from diff', () => {
    const result = scanCurrentBranch({
      execFn: makeGitExecFn({ diffFiles: ['src/a.js', 'src/b.js'] }),
    });
    assert.deepEqual(result[0].files, ['src/a.js', 'src/b.js']);
  });

  it('diffs against merge-base (3-dot), not a direct 2-dot range — excludes commits main has that HEAD lacks (backlog #42)', () => {
    let capturedDiffArgs = null;
    const execFn = (cmd, args, opts) => {
      if (args[0] === 'diff') capturedDiffArgs = args;
      return makeGitExecFn()(cmd, args, opts);
    };
    scanCurrentBranch({ execFn });
    assert.ok(capturedDiffArgs, 'diff should have been invoked');
    const joined = capturedDiffArgs.join(' ');
    assert.ok(joined.includes('...'), `expected 3-dot merge-base diff, got: ${joined}`);
    assert.ok(!/[^.]\.\.[^.]/.test(joined), `expected no bare 2-dot range, got: ${joined}`);
  });

  it('includes ticket keys extracted from branch name', () => {
    const result = scanCurrentBranch({
      execFn: makeGitExecFn({ branch: 'feat/PROJ-123-checkout', logLines: [] }),
    });
    assert.ok(result[0].tickets.includes('PROJ-123'));
  });

  it('includes ticket keys extracted from recent commits', () => {
    const result = scanCurrentBranch({
      execFn: makeGitExecFn({
        branch: 'my-branch',
        logLines: ['abc1234 feat: MYAPP-456 fix payment'],
      }),
    });
    assert.ok(result[0].tickets.includes('MYAPP-456'));
  });

  it('deduplicates ticket keys', () => {
    const result = scanCurrentBranch({
      execFn: makeGitExecFn({
        branch: 'feat/PROJ-123-checkout',
        logLines: ['abc feat: PROJ-123 step one', 'def feat: PROJ-123 step two'],
      }),
    });
    const count = result[0].tickets.filter(k => k === 'PROJ-123').length;
    assert.equal(count, 1);
  });

  it('tickets is empty array when no keys found', () => {
    const result = scanCurrentBranch({
      execFn: makeGitExecFn({ branch: 'my-feature-branch', logLines: ['abc no ticket here'] }),
    });
    assert.deepEqual(result[0].tickets, []);
  });
});

// ── No base branch ────────────────────────────────────────────────────────────

describe('scanCurrentBranch — no base branch found', () => {
  it('base is null when none of the candidates exist', () => {
    const execFn = (_cmd, args, _opts) => {
      const key = args.join(' ');
      if (key === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: 'my-branch\n' };
      if (key.startsWith('rev-parse --verify'))  return { status: 1, stdout: '' };
      if (key.startsWith('log --oneline'))        return { status: 0, stdout: '' };
      return { status: 1, stdout: '' };
    };
    const result = scanCurrentBranch({ execFn });
    assert.equal(result[0].base, null);
  });

  it('files is empty array when no base branch', () => {
    const execFn = (_cmd, args, _opts) => {
      const key = args.join(' ');
      if (key === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: 'my-branch\n' };
      if (key.startsWith('rev-parse --verify'))  return { status: 1, stdout: '' };
      if (key.startsWith('log --oneline'))        return { status: 0, stdout: '' };
      return { status: 1, stdout: '' };
    };
    const result = scanCurrentBranch({ execFn });
    assert.deepEqual(result[0].files, []);
  });
});

// ── File count cap ────────────────────────────────────────────────────────────

describe('scanCurrentBranch — file count cap', () => {
  it('caps files at 200', () => {
    const bigDiff = Array.from({ length: 300 }, (_, i) => `src/file${i}.js`);
    const result = scanCurrentBranch({
      execFn: makeGitExecFn({ diffFiles: bigDiff }),
    });
    assert.equal(result[0].files.length, 200);
  });

  it('keeps first 200 files when over cap', () => {
    const bigDiff = Array.from({ length: 300 }, (_, i) => `src/file${i}.js`);
    const result = scanCurrentBranch({
      execFn: makeGitExecFn({ diffFiles: bigDiff }),
    });
    assert.equal(result[0].files[0],   'src/file0.js');
    assert.equal(result[0].files[199], 'src/file199.js');
  });
});

// ── Empty diff ────────────────────────────────────────────────────────────────

describe('scanCurrentBranch — empty diff', () => {
  it('files is empty array when diff returns nothing', () => {
    const result = scanCurrentBranch({
      execFn: makeGitExecFn({ diffFiles: [] }),
    });
    assert.deepEqual(result[0].files, []);
  });
});

// ── Base candidate priority ───────────────────────────────────────────────────

describe('scanCurrentBranch — base candidate priority', () => {
  it('prefers origin/main over origin/master', () => {
    const execFn = (_cmd, args, _opts) => {
      const key = args.join(' ');
      if (key === 'rev-parse --abbrev-ref HEAD') return { status: 0, stdout: 'feat/branch\n' };
      if (key === 'rev-parse --verify origin/main')   return { status: 0, stdout: 'abc\n' };
      if (key === 'rev-parse --verify origin/master') return { status: 0, stdout: 'def\n' };
      if (key.startsWith('diff'))                    return { status: 0, stdout: '' };
      if (key.startsWith('log'))                     return { status: 0, stdout: '' };
      return { status: 1, stdout: '' };
    };
    const result = scanCurrentBranch({ execFn });
    assert.equal(result[0].base, 'origin/main');
  });

  it('falls back to origin/master when origin/main missing', () => {
    const execFn = (_cmd, args, _opts) => {
      const key = args.join(' ');
      if (key === 'rev-parse --abbrev-ref HEAD')      return { status: 0, stdout: 'feat/branch\n' };
      if (key === 'rev-parse --verify origin/main')   return { status: 1, stdout: '' };
      if (key === 'rev-parse --verify origin/master') return { status: 0, stdout: 'def\n' };
      if (key.startsWith('diff'))                     return { status: 0, stdout: '' };
      if (key.startsWith('log'))                      return { status: 0, stdout: '' };
      return { status: 1, stdout: '' };
    };
    const result = scanCurrentBranch({ execFn });
    assert.equal(result[0].base, 'origin/master');
  });
});
