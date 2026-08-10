import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readMachineSecret, readOrCreateMachineSecret, signHmac, verifyHmac } from '../lib/machine-secret.mjs';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tl-machine-secret-'));
}

describe('readMachineSecret', () => {
  it('returns null when no secret file exists', () => {
    const dir = tmpDir();
    try {
      assert.equal(readMachineSecret(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for a corrupted secret file', () => {
    const dir = tmpDir();
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'license-hmac-secret.json'), '{broken');
      assert.equal(readMachineSecret(dir), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readOrCreateMachineSecret', () => {
  it('creates a 64-char hex secret on first call', () => {
    const dir = tmpDir();
    try {
      const secret = readOrCreateMachineSecret(dir);
      assert.equal(secret.length, 64);
      assert.match(secret, /^[0-9a-f]{64}$/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns the same secret on subsequent calls', () => {
    const dir = tmpDir();
    try {
      const first = readOrCreateMachineSecret(dir);
      const second = readOrCreateMachineSecret(dir);
      assert.equal(first, second);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes the secret file with mode 0o600', () => {
    const dir = tmpDir();
    try {
      readOrCreateMachineSecret(dir);
      const mode = fs.statSync(path.join(dir, 'license-hmac-secret.json')).mode & 0o777;
      assert.equal(mode, 0o600, `secret file must be chmod 600, got ${mode.toString(8)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates the config directory if it does not exist', () => {
    const dir = path.join(os.tmpdir(), `tl-machine-secret-noexist-${Date.now()}`);
    try {
      const secret = readOrCreateMachineSecret(dir);
      assert.equal(secret.length, 64);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('signHmac / verifyHmac', () => {
  it('verifies a signature produced by signHmac with the same key', () => {
    const sig = signHmac({ tier: 'pro' }, 'key-123');
    assert.equal(verifyHmac(sig, { tier: 'pro' }, 'key-123'), true);
  });

  it('rejects a signature verified with a different key', () => {
    const sig = signHmac({ tier: 'pro' }, 'key-123');
    assert.equal(verifyHmac(sig, { tier: 'pro' }, 'key-456'), false);
  });

  it('rejects a signature when the payload was tampered after signing', () => {
    const sig = signHmac({ tier: 'pro' }, 'key-123');
    assert.equal(verifyHmac(sig, { tier: 'team' }, 'key-123'), false);
  });

  it('rejects a malformed (non-hex) signature without throwing', () => {
    assert.doesNotThrow(() => verifyHmac('not-hex-and-wrong-length', { tier: 'pro' }, 'key-123'));
    assert.equal(verifyHmac('not-hex-and-wrong-length', { tier: 'pro' }, 'key-123'), false);
  });
});
