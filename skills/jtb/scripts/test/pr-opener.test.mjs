import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGitHubRemote, buildCompareUrl, openPr } from '../lib/pr-opener.mjs';

describe('parseGitHubRemote', () => {
  it('parses an SSH remote', () => {
    assert.deepEqual(parseGitHubRemote('git@github.com:acme/widgets.git'), { owner: 'acme', repo: 'widgets' });
  });

  it('parses an HTTPS remote with .git suffix', () => {
    assert.deepEqual(parseGitHubRemote('https://github.com/acme/widgets.git'), { owner: 'acme', repo: 'widgets' });
  });

  it('parses an HTTPS remote without .git suffix', () => {
    assert.deepEqual(parseGitHubRemote('https://github.com/acme/widgets'), { owner: 'acme', repo: 'widgets' });
  });

  it('parses a repo name containing a dot (e.g. next.js)', () => {
    assert.deepEqual(parseGitHubRemote('https://github.com/vercel/next.js.git'), { owner: 'vercel', repo: 'next.js' });
  });

  it('parses an SSH remote with a dotted repo name', () => {
    assert.deepEqual(parseGitHubRemote('git@github.com:socketio/socket.io.git'), { owner: 'socketio', repo: 'socket.io' });
  });

  it('returns null for a GitLab remote', () => {
    assert.equal(parseGitHubRemote('https://gitlab.com/acme/widgets.git'), null);
  });

  it('returns null for a Bitbucket remote', () => {
    assert.equal(parseGitHubRemote('https://bitbucket.org/acme/widgets.git'), null);
  });

  it('returns null for null/empty input', () => {
    assert.equal(parseGitHubRemote(null), null);
    assert.equal(parseGitHubRemote(''), null);
  });
});

describe('buildCompareUrl', () => {
  it('strips origin/ prefix from base and builds a compare URL', () => {
    const url = buildCompareUrl({ owner: 'acme', repo: 'widgets', base: 'origin/main', head: 'feature-x', title: 'PROJ-1: Fix login', body: 'body text' });
    assert.ok(url.startsWith('https://github.com/acme/widgets/compare/main...feature-x?'), url);
    assert.match(url, /title=PROJ-1%3A\+Fix\+login/);
    assert.match(url, /body=body\+text/);
    assert.match(url, /expand=1/);
  });

  it('escapes a literal # in owner/repo/base/head so it cannot truncate the URL into a fragment', () => {
    const url = buildCompareUrl({ owner: 'acme', repo: 'widgets', base: 'main', head: 'bugfix/PROJ-1#comment', title: 'T', body: 'B' });
    assert.ok(!url.includes('/compare/main...bugfix/PROJ-1#comment'), 'a raw # must not reach the URL path');
    assert.match(url, /compare\/main\.\.\.bugfix\/PROJ-1%23comment\?/);
  });

  it('truncates a body over the length cap and appends a truncation note', () => {
    const longBody = 'x'.repeat(5000);
    const url = buildCompareUrl({ owner: 'acme', repo: 'widgets', base: 'main', head: 'feature-x', title: 'T', body: longBody, ticketKey: 'PROJ-1' });
    const decoded = decodeURIComponent(url.split('body=')[1].split('&')[0] ?? '');
    assert.ok(decoded.length < 5000, 'body must be truncated');
    assert.match(url, /truncated/);
  });
});

describe('openPr — head equals base', () => {
  it('refuses cleanly when the current branch is the base branch itself', async () => {
    const { openPr } = await import('../lib/pr-opener.mjs');
    const result = await openPr('PROJ-1', '## PROJ-1: T\n\nbody', {
      cwd: '/tmp/fake-repo',
      execFn: () => ({ status: 0, stdout: 'https://github.com/acme/widgets.git' }),
      scanCurrentBranchFn: () => [{ branch: 'main', base: 'origin/main' }],
      openBrowserFn: () => {},
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'head-equals-base');
  });
});

describe('openPr', () => {
  const MARKDOWN = '## PROJ-1: Fix login\n\n### What changed\n- abc1234 fix';

  function makeDeps(overrides = {}) {
    return {
      cwd: '/tmp/fake-repo',
      execFn: () => ({ status: 0, stdout: 'https://github.com/acme/widgets.git' }),
      scanCurrentBranchFn: () => [{ branch: 'feature-x', base: 'origin/main' }],
      openBrowserFn: () => {},
      ...overrides,
    };
  }

  it('refuses cleanly when the remote is not GitHub', async () => {
    const result = await openPr('PROJ-1', MARKDOWN, makeDeps({
      execFn: () => ({ status: 0, stdout: 'https://gitlab.com/acme/widgets.git' }),
    }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'not-github');
  });

  it('refuses cleanly when not on a real branch (detached HEAD / non-git dir)', async () => {
    const result = await openPr('PROJ-1', MARKDOWN, makeDeps({
      scanCurrentBranchFn: () => null,
    }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no-branch');
  });

  it('refuses cleanly when no base branch is detected', async () => {
    const result = await openPr('PROJ-1', MARKDOWN, makeDeps({
      scanCurrentBranchFn: () => [{ branch: 'feature-x', base: null }],
    }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'no-base');
  });

  it('refuses cleanly when the branch is not pushed to origin', async () => {
    const result = await openPr('PROJ-1', MARKDOWN, makeDeps({
      execFn: (cmd, args) => {
        if (args.includes('get-url')) return { status: 0, stdout: 'https://github.com/acme/widgets.git' };
        if (args.includes('--verify')) return { status: 1, stdout: '' };
        return { status: 1, stdout: '' };
      },
    }));
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unpushed');
  });

  it('builds the correct URL and opens the browser on success', async () => {
    let openedUrl;
    const result = await openPr('PROJ-1', MARKDOWN, makeDeps({
      execFn: (cmd, args) => {
        if (args.includes('get-url')) return { status: 0, stdout: 'https://github.com/acme/widgets.git' };
        if (args.includes('--verify')) return { status: 0, stdout: 'deadbeef' };
        return { status: 1, stdout: '' };
      },
      openBrowserFn: (url) => { openedUrl = url; },
    }));
    assert.equal(result.ok, true);
    assert.ok(result.url.startsWith('https://github.com/acme/widgets/compare/main...feature-x?'));
    assert.equal(openedUrl, result.url, 'must open the exact same URL it returns');
    assert.match(result.url, /title=PROJ-1%3A\+Fix\+login/);
  });

  it('does not throw when openBrowserFn itself throws (best-effort, non-fatal)', async () => {
    const result = await openPr('PROJ-1', MARKDOWN, makeDeps({
      execFn: (cmd, args) => {
        if (args.includes('get-url')) return { status: 0, stdout: 'https://github.com/acme/widgets.git' };
        if (args.includes('--verify')) return { status: 0, stdout: 'deadbeef' };
        return { status: 1, stdout: '' };
      },
      openBrowserFn: () => { throw new Error('no display'); },
    }));
    assert.equal(result.ok, true, 'a failed browser launch must not fail the whole operation');
  });

  it('passes explicit cwd through to execFn, not process.cwd()', async () => {
    const seenCwds = [];
    await openPr('PROJ-1', MARKDOWN, makeDeps({
      cwd: '/tmp/explicit-repo',
      execFn: (cmd, args, opts) => {
        seenCwds.push(opts.cwd);
        if (args.includes('get-url')) return { status: 0, stdout: 'https://github.com/acme/widgets.git' };
        return { status: 0, stdout: 'deadbeef' };
      },
    }));
    assert.ok(seenCwds.every(c => c === '/tmp/explicit-repo'), `expected every git call to use the explicit cwd, got: ${seenCwds}`);
  });
});
