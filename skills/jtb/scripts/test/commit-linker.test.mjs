import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findLinkedCommits } from '../lib/commit-linker.mjs';

// Injectable execFn that simulates git output
function makeExecFn(responses) {
  let callCount = 0;
  return (cmd, args, opts) => {
    const response = responses[callCount++] ?? { status: 0, stdout: '' };
    return { status: response.status ?? 0, stdout: response.stdout ?? '', stderr: '' };
  };
}

describe('findLinkedCommits', () => {
  it('returns empty arrays when no commits reference the ticket key', () => {
    const execFn = makeExecFn([
      { stdout: 'abc1234 feat: unrelated change\ndef5678 fix: another thing\n' },
      { stdout: '  main\n  feature/unrelated\n' },
      { stdout: '' },
    ]);
    const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });
    assert.deepStrictEqual(result.commits, []);
    assert.deepStrictEqual(result.branches, []);
  });

  it('finds commits referencing the ticket key', () => {
    const execFn = makeExecFn([
      { stdout: 'abc1234 feat: PROJ-123 add payment validation\ndef5678 fix: unrelated\n' },
      { stdout: '  main\n' },
      { stdout: '' },
    ]);
    const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });
    assert.equal(result.commits.length, 1);
    assert.ok(result.commits[0].includes('PROJ-123'));
  });

  it('finds branches referencing the ticket key', () => {
    const execFn = makeExecFn([
      { stdout: '' },
      { stdout: '  main\n  feature/PROJ-123-add-payment\n  remotes/origin/PROJ-123-fix\n' },
      { stdout: '' },
    ]);
    const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });
    assert.equal(result.branches.length, 2);
  });

  it('returns diff when git diff produces output', () => {
    const execFn = makeExecFn([
      { stdout: '' },
      { stdout: '' },
      { stdout: '+  const x = 1;\n-  const x = 0;\n' },
    ]);
    const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });
    assert.ok(result.diff && result.diff.length > 0);
  });

  it('returns null diff when git diff fails', () => {
    const execFn = makeExecFn([
      { stdout: '' },
      { stdout: '' },
      { status: 1, stdout: '' },
    ]);
    const result = findLinkedCommits('PROJ-123', { execFn, cwd: '/tmp' });
    assert.equal(result.diff, null);
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
});
