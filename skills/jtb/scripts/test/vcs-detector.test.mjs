import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectVcs } from '../lib/vcs-detector.mjs';

describe('detectVcs', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jtb-vcs-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects git repository', () => {
    mkdirSync(join(tempDir, '.git'));
    assert.deepStrictEqual(detectVcs(tempDir), { type: 'git' });
  });

  it('detects svn repository', () => {
    mkdirSync(join(tempDir, '.svn'));
    assert.deepStrictEqual(detectVcs(tempDir), { type: 'svn' });
  });

  it('detects hg repository', () => {
    mkdirSync(join(tempDir, '.hg'));
    assert.deepStrictEqual(detectVcs(tempDir), { type: 'hg' });
  });

  it('returns none when no VCS marker found', () => {
    assert.deepStrictEqual(detectVcs(tempDir), { type: 'none' });
  });
});
