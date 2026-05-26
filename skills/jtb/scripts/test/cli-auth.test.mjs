import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readCliToken, saveCliToken, deleteCliToken } from '../lib/cli-auth.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tl-cli-auth-'));
}

describe('saveCliToken', () => {
  it('writes cli-token.json with mode 0o600', () => {
    const dir = tmpDir();
    try {
      saveCliToken('tok-abc123', dir);
      const mode = fs.statSync(path.join(dir, 'cli-token.json')).mode & 0o777;
      assert.equal(mode, 0o600, `cli-token.json must be chmod 600, got ${mode.toString(8)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates the config directory if it does not exist', () => {
    const dir = path.join(os.tmpdir(), `tl-cli-auth-noexist-${Date.now()}`);
    try {
      saveCliToken('tok-xyz', dir);
      assert.ok(fs.existsSync(path.join(dir, 'cli-token.json')));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readCliToken', () => {
  it('returns the stored token string', () => {
    const dir = tmpDir();
    try {
      saveCliToken('tok-abc123', dir);
      assert.equal(readCliToken(dir), 'tok-abc123');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when cli-token.json does not exist', () => {
    const dir = tmpDir();
    try {
      assert.equal(readCliToken(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for a corrupted cli-token.json', () => {
    const dir = tmpDir();
    try {
      fs.writeFileSync(path.join(dir, 'cli-token.json'), '{broken');
      assert.equal(readCliToken(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('deleteCliToken', () => {
  it('clears the token so readCliToken returns null', () => {
    const dir = tmpDir();
    try {
      saveCliToken('tok-to-delete', dir);
      deleteCliToken(dir);
      assert.equal(readCliToken(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does nothing when cli-token.json does not exist', () => {
    const dir = tmpDir();
    try {
      assert.doesNotThrow(() => deleteCliToken(dir));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
