import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { findOnPath, checkAliasStatus } from '../lib/alias-status.mjs';

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tl-alias-status-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeDir(name) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeExecutable(dir, name) {
  const full = join(dir, name);
  writeFileSync(full, '#!/usr/bin/env node\n');
  chmodSync(full, 0o755);
  return full;
}

describe('findOnPath', () => {
  it('returns the first match across multiple PATH dirs (POSIX)', () => {
    const dirA = makeDir('bin-a');
    const dirB = makeDir('bin-b');
    // 'tl' only exists in dirB — must be found even though dirA is scanned first.
    const expected = makeExecutable(dirB, 'tl');

    const found = findOnPath('tl', {
      env: { PATH: [dirA, dirB].join(':') },
      platform: 'darwin',
    });

    assert.equal(found, expected);
  });

  it('prefers the earlier PATH dir when both contain a match', () => {
    const dirA = makeDir('bin-a');
    const dirB = makeDir('bin-b');
    const expected = makeExecutable(dirA, 'tl');
    makeExecutable(dirB, 'tl');

    const found = findOnPath('tl', {
      env: { PATH: [dirA, dirB].join(':') },
      platform: 'linux',
    });

    assert.equal(found, expected);
  });

  it('returns null when nothing matches', () => {
    const dirA = makeDir('bin-a');
    const found = findOnPath('tl', { env: { PATH: dirA }, platform: 'darwin' });
    assert.equal(found, null);
  });

  it('never throws when a PATH entry does not exist on disk', () => {
    const missingDir = join(root, 'does-not-exist');
    assert.doesNotThrow(() => {
      findOnPath('tl', { env: { PATH: missingDir }, platform: 'darwin' });
    });
  });

  it('never throws on an empty PATH', () => {
    assert.doesNotThrow(() => {
      const found = findOnPath('tl', { env: { PATH: '' }, platform: 'darwin' });
      assert.equal(found, null);
    });
  });

  it('resolves win32 PATHEXT candidates using the ; delimiter', () => {
    const dirA = makeDir('bin-a');
    const expected = makeExecutable(dirA, 'tl.CMD');

    const found = findOnPath('tl', {
      env: { PATH: dirA, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
      platform: 'win32',
    });

    assert.equal(found, expected);
  });

  it('win32: bare binName (no extension) also matches', () => {
    const dirA = makeDir('bin-a');
    const expected = makeExecutable(dirA, 'tl');

    const found = findOnPath('tl', {
      env: { PATH: dirA, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
      platform: 'win32',
    });

    assert.equal(found, expected);
  });
});

describe('checkAliasStatus', () => {
  it('returns active when tl resolves to the same file as selfBinPath', () => {
    const dir = makeDir('bin');
    const selfBinPath = makeExecutable(dir, 'ticketlens');
    symlinkSync(selfBinPath, join(dir, 'tl'));

    const status = checkAliasStatus({
      selfBinPath,
      env: { PATH: dir },
      platform: 'darwin',
    });

    assert.deepEqual(status, { status: 'active' });
  });

  it('returns shadowed with foreignPath when tl resolves elsewhere', () => {
    const ourDir = makeDir('our-bin');
    const foreignDir = makeDir('foreign-bin');
    const selfBinPath = makeExecutable(ourDir, 'ticketlens');
    const foreignTl = makeExecutable(foreignDir, 'tl');

    const status = checkAliasStatus({
      selfBinPath,
      env: { PATH: foreignDir },
      platform: 'darwin',
    });

    assert.equal(status.status, 'shadowed');
    assert.equal(status.foreignPath, foreignTl);
  });

  it('returns missing when tl is not on PATH at all', () => {
    const dir = makeDir('bin');
    const selfBinPath = makeExecutable(dir, 'ticketlens');

    const status = checkAliasStatus({
      selfBinPath,
      env: { PATH: join(root, 'empty') },
      platform: 'darwin',
    });

    assert.deepEqual(status, { status: 'missing' });
  });

  it('never throws — degrades to missing on a bad selfBinPath', () => {
    assert.doesNotThrow(() => {
      const status = checkAliasStatus({
        selfBinPath: join(root, 'nonexistent-self'),
        env: { PATH: root },
        platform: 'darwin',
      });
      assert.equal(status.status, 'missing');
    });
  });

  describe('win32', () => {
    it('returns active when tl.cmd and ticketlens.cmd share the same shim directory', () => {
      // Mirrors real npm topology: both bins from one package land in the
      // same global shim dir. selfBinPath (node_modules internal target)
      // must NOT be what active/shadowed is decided against on win32.
      const shimDir = makeDir('npm-shims');
      makeExecutable(shimDir, 'tl.CMD');
      makeExecutable(shimDir, 'ticketlens.CMD');
      const selfBinPath = makeExecutable(makeDir('node_modules/ticketlens/bin'), 'ticketlens.mjs');

      const status = checkAliasStatus({
        selfBinPath,
        env: { PATH: shimDir, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
        platform: 'win32',
      });

      assert.deepEqual(status, { status: 'active' });
    });

    it('returns shadowed when tl.cmd resolves to a different directory than ticketlens.cmd', () => {
      const ourShimDir = makeDir('npm-shims');
      const foreignDir = makeDir('teal-install');
      makeExecutable(ourShimDir, 'ticketlens.CMD');
      const foreignTl = makeExecutable(foreignDir, 'tl.CMD');
      const selfBinPath = makeExecutable(makeDir('node_modules/ticketlens/bin'), 'ticketlens.mjs');

      const status = checkAliasStatus({
        selfBinPath,
        env: { PATH: [foreignDir, ourShimDir].join(';'), PATHEXT: '.COM;.EXE;.BAT;.CMD' },
        platform: 'win32',
      });

      assert.equal(status.status, 'shadowed');
      assert.equal(status.foreignPath, foreignTl);
    });

    it('returns shadowed (not active) when tl.cmd is found but no ticketlens shim exists alongside it', () => {
      const dir = makeDir('mystery-tl');
      const foreignTl = makeExecutable(dir, 'tl.CMD');
      const selfBinPath = makeExecutable(makeDir('node_modules/ticketlens/bin'), 'ticketlens.mjs');

      const status = checkAliasStatus({
        selfBinPath,
        env: { PATH: dir, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
        platform: 'win32',
      });

      assert.equal(status.status, 'shadowed');
      assert.equal(status.foreignPath, foreignTl);
    });
  });
});
