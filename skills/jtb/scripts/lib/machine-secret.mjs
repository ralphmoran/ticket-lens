/**
 * Machine-bound secret used to HMAC-sign local trust files (license.json,
 * cli-token.json) so their contents can't be hand-edited without detection.
 * The secret never leaves the machine and is never sent to the server.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SECRET_FILE = 'license-hmac-secret.json';

export function readMachineSecret(configDir) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(configDir, SECRET_FILE), 'utf8'));
    return typeof data.secret === 'string' && data.secret.length === 64 ? data.secret : null;
  } catch {
    return null;
  }
}

export function readOrCreateMachineSecret(configDir) {
  const existing = readMachineSecret(configDir);
  if (existing) return existing;
  fs.mkdirSync(configDir, { recursive: true });
  const secret = crypto.randomBytes(32).toString('hex');
  const secretPath = path.join(configDir, SECRET_FILE);
  const tmp = `${secretPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ secret }), { encoding: 'utf8', mode: 0o600 });
  try {
    // Atomic on POSIX — if we lost a concurrent race, the winner's file stays
    fs.renameSync(tmp, secretPath);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* ignore cleanup failure */ }
  }
  // Read back: we may have lost the race; use whatever secret is on disk
  return readMachineSecret(configDir) ?? secret;
}

export function signHmac(payload, sigKey) {
  return crypto.createHmac('sha256', sigKey).update(JSON.stringify(payload)).digest('hex');
}

export function verifyHmac(sig, payload, sigKey) {
  const expected = signHmac(payload, sigKey);
  const sigBuf = Buffer.from(sig, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}
