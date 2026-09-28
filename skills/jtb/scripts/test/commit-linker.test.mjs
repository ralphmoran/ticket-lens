import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findLinkedCommits } from '../lib/commit-linker.mjs';

/**
 * Keyed-dispatch git mock (matches the branch-scanner.test.mjs convention).
 * Responses are looked up by the joined args string, so tests don't have to
 * track call order/count as the base-detection step adds a variable number
 * of `rev-parse --verify` probes ahead of the diff call.
 */
function makeGitExecFn({
  logStdout    = '',
  branchStdout = '',
  base         = 'origin/main',   // which BASE_CANDIDATES entry exists; null = none exist
  mergeBaseSha = 'mb0123abc',     // result of `git merge-base HEAD <base>`; null = command fails
  diffStdout   = '',
  diffStatus   = 0,
} = {}) {
  return (_cmd, args, _opts) => {
    const key = args.join(' ');

    if (key.startsWith('log --oneline'))       return { status: 0, stdout: logStdout, stderr: '' };
    if (key === 'branch --all')                return { status: 0, stdout: branchStdout, stderr: '' };

    if (key.startsWith('rev-parse --verify')) {
      const candidate = args[2];
      return candidate === base
        ? { status: 0, stdout: 'sha\n', stderr: '' }
        : { status: 1, stdout: '',      stderr: '' };
    }

    if (key.startsWith('merge-base')) {
      return mergeBaseSha
        ? { status: 0, stdout: mergeBaseSha + '\n', stderr: '' }
        : { status: 1, stdout: '',                  stderr: '' };
    }

    if (key.startsWith('diff'))                return { status: diffStatus, stdout: diffStdout, stderr: '' };

    return { status: 1, stdout: '', stderr: 'unknown command' };
  };
}

/** Wraps an execFn to also record every call's joined args, for asserting exact git invocations. */
function withCallLog(execFn) {
  const calls = [];
  const wrapped = (cmd, args, opts) => {
    calls.push(args.join(' '));
    return execFn(cmd, args, opts);
  };
  return { execFn: wrapped, calls };
}

describe('findLinkedCommits', () => {
  it('returns empty arrays when no commits reference the ticket key', () => {
    const execFn = makeGitExecFn({
      logStdout: 'abc1234 feat: unrelated change\ndef5678 fix: another thing\n',
      branchStdout: '  main\n  feature/unrelated\n',
    });
    const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });
    assert.deepStrictEqual(result.commits, []);
    assert.deepStrictEqual(result.branches, []);
  });

  it('finds commits referencing the ticket key', () => {
    const execFn = makeGitExecFn({
      logStdout: 'abc1234 feat: PROJ-123 add payment validation\ndef5678 fix: unrelated\n',
      branchStdout: '  main\n',
    });
    const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });
    assert.equal(result.commits.length, 1);
    assert.ok(result.commits[0].includes('PROJ-123'));
  });

  it('finds branches referencing the ticket key', () => {
    const execFn = makeGitExecFn({
      branchStdout: '  main\n  feature/PROJ-123-add-payment\n  remotes/origin/PROJ-123-fix\n',
    });
    const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });
    assert.equal(result.branches.length, 2);
  });

  it('rejects invalid ticket keys containing shell metacharacters', () => {
    assert.throws(
      () => findLinkedCommits('PROJ-123; rm -rf /', {}),
      /Invalid ticket key/
    );
  });

  it('rejects ticket keys not matching [A-Z]+-\\d+ format', () => {
    assert.throws(
      () => findLinkedCommits('proj123', {}),
      /Invalid ticket key/
    );
  });

  describe('diff computation', () => {
    it('diffs against the merge-base when a base branch is detected', () => {
      const { execFn, calls } = withCallLog(makeGitExecFn({
        base: 'origin/main',
        mergeBaseSha: 'mb0123abc',
        diffStdout: '+  const x = 1;\n-  const x = 0;\n',
      }));
      const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });

      assert.equal(result.diff, '+  const x = 1;\n-  const x = 0;\n');
      assert.ok(calls.includes('merge-base HEAD origin/main'), 'expected a merge-base lookup against the detected base');
      assert.ok(calls.includes('diff mb0123abc -- :(exclude,top)*.md'), 'expected a single-ref diff against the merge-base commit, excluding markdown');
      assert.ok(!calls.some(c => c.startsWith('diff HEAD')), 'must not fall back to git diff HEAD when a base was found');
    });

    it('still finds a committed change — the exact audit repro: HEAD-relative diff is empty on a clean tree, merge-base-relative diff is not', () => {
      // On a clean tree, `git diff HEAD` returns nothing (the old, broken behavior).
      // A merge-base-relative diff still sees everything committed since branching.
      const execFn = makeGitExecFn({
        base: 'origin/main',
        mergeBaseSha: 'mb0123abc',
        diffStdout: '+  const dryRun = true;\n',
      });
      const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });
      assert.ok(result.diff && result.diff.length > 0, 'committed work must still be visible after the fix');
    });

    it('falls back to git diff HEAD when no base branch is detected', () => {
      const { execFn, calls } = withCallLog(makeGitExecFn({
        base: null,
        diffStdout: '+  const x = 1;\n',
      }));
      const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });

      assert.equal(result.diff, '+  const x = 1;\n');
      assert.ok(calls.includes('diff HEAD -- :(exclude,top)*.md'));
      assert.ok(!calls.some(c => c.startsWith('merge-base')), 'must not attempt merge-base when no base was found');
    });

    it('falls back to git diff HEAD when the merge-base command fails', () => {
      const { execFn, calls } = withCallLog(makeGitExecFn({
        base: 'origin/main',
        mergeBaseSha: null,
        diffStdout: '+  const x = 1;\n',
      }));
      const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });

      assert.equal(result.diff, '+  const x = 1;\n');
      assert.ok(calls.includes('diff HEAD -- :(exclude,top)*.md'));
    });

    it('returns null diff when the fallback git diff HEAD also fails', () => {
      const execFn = makeGitExecFn({ base: null, diffStatus: 1 });
      const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });
      assert.equal(result.diff, null);
    });

    it('returns null diff when the merge-base diff produces no output', () => {
      const execFn = makeGitExecFn({ base: 'origin/main', mergeBaseSha: 'mb0123abc', diffStdout: '' });
      const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });
      assert.equal(result.diff, null);
    });
  });

  describe('diff computation — real git (audit repro)', () => {
    // Exercises the actual git binary via spawnSync (no execFn mock), reproducing
    // the audit's exact finding: a compliance check run from a pre-push hook
    // (i.e. after commit, on a clean tree) must still see the committed diff.
    // The old implementation (`git diff HEAD`) returned null here — every one
    // of the mocked tests above would have stayed green even with that bug,
    // since they all supply the diff output directly.
    let repoDir;

    function git(args) {
      const result = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8' });
      if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
      }
      return result.stdout;
    }

    beforeEach(() => {
      repoDir = mkdtempSync(join(tmpdir(), 'jtb-commit-linker-'));
      git(['init', '-q', '-b', 'main']);
      git(['config', 'user.email', 'test@example.com']);
      git(['config', 'user.name', 'Test']);
      writeFileSync(join(repoDir, 'README.md'), 'base\n');
      git(['add', '.']);
      git(['commit', '-q', '-m', 'base commit']);

      git(['checkout', '-q', '-b', 'PROJ-999-dry-run']);
      writeFileSync(join(repoDir, 'feature.js'), 'const dryRun = true;\n');
      git(['add', '.']);
      git(['commit', '-q', '-m', 'PROJ-999: add dry-run flag']);
    });

    afterEach(() => {
      rmSync(repoDir, { recursive: true, force: true });
    });

    it('sees a committed change on a clean tree — the exact audit repro', () => {
      const result = findLinkedCommits('PROJ-999', { cwd: repoDir });
      assert.ok(result.diff, 'diff must not be null on a clean tree after committing');
      assert.ok(result.diff.includes('dryRun'), 'diff must contain the committed change');
    });

    it('still sees the change when it is uncommitted', () => {
      writeFileSync(join(repoDir, 'feature2.js'), 'const another = true;\n');
      git(['add', '.']);
      const result = findLinkedCommits('PROJ-999', { cwd: repoDir });
      assert.ok(result.diff.includes('dryRun'), 'still sees prior committed work');
      assert.ok(result.diff.includes('another'), 'also sees the new uncommitted work');
    });

    it('excludes an unrelated uncommitted nested markdown edit from the diff — backlog #26b repro', () => {
      // Staged, not untracked: untracked files never appear in `git diff`
      // regardless of pathspec, so this would otherwise pass vacuously.
      mkdirSync(join(repoDir, 'docs'), { recursive: true });
      writeFileSync(join(repoDir, 'docs', 'backlog-notes.md'), 'unrelated backlog notes\n');
      git(['add', 'docs/backlog-notes.md']);
      const result = findLinkedCommits('PROJ-999', { cwd: repoDir });
      assert.ok(result.diff.includes('dryRun'), 'still sees the real committed work');
      assert.ok(!result.diff.includes('backlog-notes'), 'must not include the unrelated markdown file');
      assert.ok(!result.diff.includes('unrelated backlog notes'), 'must not include the unrelated file\'s content');
    });

    it('excludes an unrelated uncommitted top-level *.md edit from the diff', () => {
      // README.md is already tracked (committed in beforeEach) — this
      // exercises the modified-and-staged case, not an untracked new file.
      writeFileSync(join(repoDir, 'README.md'), 'unrelated changelog entry\n');
      git(['add', 'README.md']);
      const result = findLinkedCommits('PROJ-999', { cwd: repoDir });
      assert.ok(result.diff.includes('dryRun'), 'still sees the real committed work');
      assert.ok(!result.diff.includes('unrelated changelog entry'), 'must not include the unrelated *.md edit');
    });

    it('does NOT exclude a non-markdown file that legitimately lives under docs/ — real evidence must survive', () => {
      // Guards against widening the exclusion to docs/**, which would drop
      // real source (e.g. a docs site's own code) as a false negative.
      mkdirSync(join(repoDir, 'docs'), { recursive: true });
      writeFileSync(join(repoDir, 'docs', 'search-widget.js'), 'const searchWidget = true;\n');
      git(['add', 'docs/search-widget.js']);
      const result = findLinkedCommits('PROJ-999', { cwd: repoDir });
      assert.ok(result.diff.includes('searchWidget'), 'non-markdown docs/ source must remain visible as evidence');
    });

    it('excludes a repo-root markdown edit even when invoked from a subdirectory — code review HIGH', () => {
      // Without `top` pathspec magic, the exclusion resolves relative to
      // `cwd`, so repo-root docs would leak when run from a subdirectory.
      writeFileSync(join(repoDir, 'README.md'), 'unrelated changelog entry from a subdir invocation\n');
      git(['add', 'README.md']);
      mkdirSync(join(repoDir, 'sub', 'dir'), { recursive: true });
      const result = findLinkedCommits('PROJ-999', { cwd: join(repoDir, 'sub', 'dir') });
      assert.ok(result.diff.includes('dryRun'), 'still sees the real committed work from a subdirectory cwd');
      assert.ok(!result.diff.includes('unrelated changelog entry from a subdir invocation'), 'repo-root *.md must stay excluded regardless of cwd');
    });
  });
});
