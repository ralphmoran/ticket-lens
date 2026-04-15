import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { generateHookScript, installHook } from '../lib/hook-installer.mjs';

// ── Tmp dir lifecycle ────────────────────────────────────────────────────────

let tmpDir;
before(() => { tmpDir = mkdtempSync(join(tmpdir(), 'hook-installer-test-')); });
after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

/** Create a fake git repo structure with .git/hooks/ inside a unique subdir. */
function makeFakeRepo(subdir) {
  const repoDir = join(tmpDir, subdir);
  const hooksDir = join(repoDir, '.git', 'hooks');
  mkdirSync(hooksDir, { recursive: true });
  return { repoDir, hooksDir };
}

// ── generateHookScript ────────────────────────────────────────────────────────

describe('generateHookScript', () => {
  it("returns a string starting with '#!/bin/sh'", () => {
    const script = generateHookScript();
    assert.ok(typeof script === 'string', 'should return a string');
    assert.ok(script.startsWith('#!/bin/sh'), "should start with '#!/bin/sh'");
  });

  it("contains 'git symbolic-ref HEAD'", () => {
    const script = generateHookScript();
    assert.ok(script.includes('git symbolic-ref HEAD'), "should contain 'git symbolic-ref HEAD'");
  });

  it("contains 'ticketlens compliance'", () => {
    const script = generateHookScript();
    assert.ok(script.includes('ticketlens compliance'), "should contain 'ticketlens compliance'");
  });

  it('contains the configured threshold value (80)', () => {
    const script = generateHookScript({ threshold: 80 });
    assert.ok(script.includes('80'), 'should contain threshold value 80');
  });
});

// ── installHook ───────────────────────────────────────────────────────────────

describe('installHook — creates pre-push file', () => {
  it('creates .git/hooks/pre-push file', () => {
    const { repoDir } = makeFakeRepo('creates-file');
    const result = installHook({ cwd: repoDir, threshold: 80, platform: 'linux' });
    assert.equal(result.installed, true, 'should return { installed: true }');
    const hookPath = join(repoDir, '.git', 'hooks', 'pre-push');
    assert.ok(
      (() => { try { readFileSync(hookPath); return true; } catch { return false; } })(),
      '.git/hooks/pre-push should exist'
    );
  });
});

describe('installHook — file mode', () => {
  it('sets file mode 0o755 (executable)', () => {
    const { repoDir } = makeFakeRepo('file-mode');
    installHook({ cwd: repoDir, threshold: 80, platform: 'linux' });
    const hookPath = join(repoDir, '.git', 'hooks', 'pre-push');
    const mode = statSync(hookPath).mode & 0o777;
    assert.equal(mode, 0o755, 'file mode should be 0o755');
  });
});

describe('installHook — .ticketlens-hooks.json', () => {
  it('creates .ticketlens-hooks.json in cwd with { complianceThreshold: 80 }', () => {
    const { repoDir } = makeFakeRepo('hooks-json');
    installHook({ cwd: repoDir, threshold: 80, platform: 'linux' });
    const configPath = join(repoDir, '.ticketlens-hooks.json');
    const data = JSON.parse(readFileSync(configPath, 'utf8'));
    assert.deepEqual(data, { complianceThreshold: 80 });
  });
});

describe('installHook — appends to existing hook', () => {
  it('appends to existing hook file rather than overwriting', () => {
    const { repoDir } = makeFakeRepo('append-existing');
    const hookPath = join(repoDir, '.git', 'hooks', 'pre-push');
    const existingContent = '#!/bin/sh\necho "existing hook"\n';
    writeFileSync(hookPath, existingContent, 'utf8');

    installHook({ cwd: repoDir, threshold: 80, platform: 'linux' });

    const content = readFileSync(hookPath, 'utf8');
    assert.ok(content.includes('existing hook'), 'existing hook content should be preserved');
    assert.ok(content.includes('ticketlens compliance'), 'ticketlens block should be appended');
  });
});

describe('installHook — idempotency', () => {
  it('calling twice does not duplicate the block', () => {
    const { repoDir } = makeFakeRepo('idempotent');
    installHook({ cwd: repoDir, threshold: 80, platform: 'linux' });
    installHook({ cwd: repoDir, threshold: 80, platform: 'linux' });

    const hookPath = join(repoDir, '.git', 'hooks', 'pre-push');
    const content = readFileSync(hookPath, 'utf8');

    // Count occurrences of the guard string
    const matches = content.split('# ticketlens-compliance-gate').length - 1;
    assert.equal(matches, 1, 'guard string should appear exactly once');
  });
});

describe('installHook — missing .git/hooks dir', () => {
  it('throws when .git/hooks/ dir does not exist', () => {
    const noGitDir = join(tmpDir, 'no-git-dir');
    mkdirSync(noGitDir, { recursive: true });

    assert.throws(
      () => installHook({ cwd: noGitDir, threshold: 80, platform: 'linux' }),
      (err) => err instanceof Error,
      'should throw an Error when .git/hooks/ does not exist'
    );
  });
});

describe('installHook — Windows skip', () => {
  it('on Windows (platform === "win32") skips and returns { skipped: true, reason }', () => {
    const { repoDir } = makeFakeRepo('windows-skip');
    const result = installHook({ cwd: repoDir, threshold: 80, platform: 'win32' });
    assert.equal(result.skipped, true, 'should return { skipped: true }');
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0, 'should include a reason string');
  });
});
