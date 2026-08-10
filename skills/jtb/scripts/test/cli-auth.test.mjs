import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readCliToken, saveCliToken, saveCliTokenTier, readCliTokenTier, deleteCliToken } from '../lib/cli-auth.mjs';
import { writeLicense } from '../lib/license.mjs';

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

describe('readCliTokenTier', () => {
  it('returns the tier when signed by saveCliToken', () => {
    const dir = tmpDir();
    try {
      saveCliToken('tok-abc123', dir, 'team');
      assert.equal(readCliTokenTier(dir), 'team');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the tier when signed by saveCliTokenTier', () => {
    const dir = tmpDir();
    try {
      saveCliToken('tok-abc123', dir);
      saveCliTokenTier('pro', dir);
      assert.equal(readCliTokenTier(dir), 'pro');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when cli-token.json does not exist', () => {
    const dir = tmpDir();
    try {
      assert.equal(readCliTokenTier(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when no tier was ever saved (token-only file)', () => {
    const dir = tmpDir();
    try {
      saveCliToken('tok-abc123', dir);
      assert.equal(readCliTokenTier(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a hand-edited tier that was not re-signed — closes the spoofing bypass', () => {
    const dir = tmpDir();
    try {
      saveCliToken('tok-abc123', dir, 'free');
      const filePath = path.join(dir, 'cli-token.json');
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      raw.tier = 'team'; // tamper: elevate tier without re-signing
      fs.writeFileSync(filePath, JSON.stringify(raw));
      assert.equal(readCliTokenTier(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a legacy shape with tier but no tierSig — no unsigned-trust fallback', () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'cli-token.json'), JSON.stringify({ token: 'tok-abc123', tier: 'team' }));
      assert.equal(readCliTokenTier(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a forged tierSig signed with the wrong secret', () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'cli-token.json'),
        JSON.stringify({ token: 'tok-abc123', tier: 'team', tierSig: 'a'.repeat(64) })
      );
      assert.equal(readCliTokenTier(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects a real license.json signature replayed as tierSig — distinct salts prevent cross-file reuse', () => {
    const dir = tmpDir();
    try {
      // Same machine secret backs both files — the salt is what must keep them apart.
      writeLicense({ tier: 'team', key: 'TL-real' }, dir);
      const licenseSig = JSON.parse(fs.readFileSync(path.join(dir, 'license.json'), 'utf8')).sig;

      saveCliToken('tok-abc123', dir, 'team');
      const tokenPath = path.join(dir, 'cli-token.json');
      const raw = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));
      raw.tierSig = licenseSig; // replay a valid signature from the other file
      fs.writeFileSync(tokenPath, JSON.stringify(raw));

      assert.equal(readCliTokenTier(dir), null);
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
