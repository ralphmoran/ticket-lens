import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkCooldown, recordAction, claimAction, releaseAction, DEFAULT_COOLDOWN_MS } from '../lib/ticket-action-cooldown.mjs';

function freshConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tl-ticket-cooldown-test-'));
}

describe('checkCooldown', () => {
  it('is inactive when nothing has been recorded yet', () => {
    const configDir = freshConfigDir();
    const result = checkCooldown('PROJ-1', 'comment', { configDir });
    assert.equal(result.active, false);
    assert.equal(result.remainingMs, 0);
  });

  it('is active immediately after recordAction, within the cooldown window', () => {
    const configDir = freshConfigDir();
    let clock = 1_000_000;
    recordAction('PROJ-1', 'comment', { configDir, now: () => clock });
    const result = checkCooldown('PROJ-1', 'comment', { configDir, now: () => clock + 1000 });
    assert.equal(result.active, true);
    assert.ok(result.remainingMs > 0);
  });

  it('becomes inactive once the cooldown window has elapsed', () => {
    const configDir = freshConfigDir();
    let clock = 1_000_000;
    recordAction('PROJ-1', 'comment', { configDir, now: () => clock, cooldownMs: 5000 });
    const result = checkCooldown('PROJ-1', 'comment', { configDir, now: () => clock + 5001, cooldownMs: 5000 });
    assert.equal(result.active, false);
  });

  it('scopes the cooldown per ticket key — a different ticket is unaffected', () => {
    const configDir = freshConfigDir();
    recordAction('PROJ-1', 'comment', { configDir });
    const result = checkCooldown('PROJ-2', 'comment', { configDir });
    assert.equal(result.active, false);
  });

  it('scopes the cooldown per action — transition is unaffected by a comment cooldown', () => {
    const configDir = freshConfigDir();
    recordAction('PROJ-1', 'comment', { configDir });
    const result = checkCooldown('PROJ-1', 'transition', { configDir });
    assert.equal(result.active, false);
  });

  it('uses DEFAULT_COOLDOWN_MS when cooldownMs is not passed', () => {
    const configDir = freshConfigDir();
    let clock = 1_000_000;
    recordAction('PROJ-1', 'comment', { configDir, now: () => clock });
    const stillActive = checkCooldown('PROJ-1', 'comment', { configDir, now: () => clock + DEFAULT_COOLDOWN_MS - 1 });
    const expired = checkCooldown('PROJ-1', 'comment', { configDir, now: () => clock + DEFAULT_COOLDOWN_MS + 1 });
    assert.equal(stillActive.active, true);
    assert.equal(expired.active, false);
  });

  it('tolerates a missing or corrupt cooldown file', () => {
    const configDir = freshConfigDir();
    fs.writeFileSync(path.join(configDir, 'ticket-action-cooldown.json'), 'not json{{{');
    const result = checkCooldown('PROJ-1', 'comment', { configDir });
    assert.equal(result.active, false);
  });

  it('tolerates a top-level array in the cooldown file (defensive shape guard)', () => {
    const configDir = freshConfigDir();
    fs.writeFileSync(path.join(configDir, 'ticket-action-cooldown.json'), '[]');
    const result = checkCooldown('PROJ-1', 'comment', { configDir });
    assert.equal(result.active, false);
  });
});

describe('recordAction', () => {
  it('persists across separate checkCooldown calls (real file read, not just in-memory)', () => {
    const configDir = freshConfigDir();
    recordAction('PROJ-1', 'comment', { configDir });
    const first = checkCooldown('PROJ-1', 'comment', { configDir });
    const second = checkCooldown('PROJ-1', 'comment', { configDir });
    assert.equal(first.active, true);
    assert.equal(second.active, true);
  });

  it('does not clobber an unrelated ticket:action entry already on disk', () => {
    const configDir = freshConfigDir();
    recordAction('PROJ-1', 'comment', { configDir });
    recordAction('PROJ-2', 'transition', { configDir });
    assert.equal(checkCooldown('PROJ-1', 'comment', { configDir }).active, true);
    assert.equal(checkCooldown('PROJ-2', 'transition', { configDir }).active, true);
  });
});

describe('claimAction / releaseAction — atomic check-and-set for writes that must never double-fire', () => {
  it('the first claim wins and the second is refused with the remaining window', () => {
    const configDir = freshConfigDir();
    const first = claimAction('PROJ-1', 'worklog', { configDir, now: () => 1_000 });
    const second = claimAction('PROJ-1', 'worklog', { configDir, now: () => 4_000 });
    assert.equal(first.claimed, true);
    assert.equal(second.claimed, false);
    assert.equal(second.remainingMs, DEFAULT_COOLDOWN_MS - 3_000);
  });

  it('a claim is visible to checkCooldown, like recordAction', () => {
    const configDir = freshConfigDir();
    claimAction('PROJ-1', 'worklog', { configDir, now: () => 1_000 });
    assert.equal(checkCooldown('PROJ-1', 'worklog', { configDir, now: () => 2_000 }).active, true);
  });

  it('claims are per ticket and per action', () => {
    const configDir = freshConfigDir();
    assert.equal(claimAction('PROJ-1', 'worklog', { configDir }).claimed, true);
    assert.equal(claimAction('PROJ-2', 'worklog', { configDir }).claimed, true);
    assert.equal(claimAction('PROJ-1', 'comment', { configDir }).claimed, true);
  });

  it('an expired claim can be taken again', () => {
    const configDir = freshConfigDir();
    claimAction('PROJ-1', 'worklog', { configDir, now: () => 1_000 });
    assert.equal(claimAction('PROJ-1', 'worklog', { configDir, now: () => 1_000 + DEFAULT_COOLDOWN_MS + 1 }).claimed, true);
  });

  it('releaseAction frees a claim so a corrected retry is not blocked after a definite failure', () => {
    const configDir = freshConfigDir();
    claimAction('PROJ-1', 'worklog', { configDir, now: () => 1_000 });
    releaseAction('PROJ-1', 'worklog', { configDir });
    assert.equal(claimAction('PROJ-1', 'worklog', { configDir, now: () => 1_500 }).claimed, true);
  });

  it('releaseAction on a key that was never claimed is a no-op, and leaves other keys alone', () => {
    const configDir = freshConfigDir();
    claimAction('PROJ-2', 'worklog', { configDir, now: () => 1_000 });
    releaseAction('PROJ-1', 'worklog', { configDir });
    assert.equal(checkCooldown('PROJ-2', 'worklog', { configDir, now: () => 1_500 }).active, true);
  });

  it('a stale lock file left by a crashed process is cleared, not waited on forever', () => {
    const configDir = freshConfigDir();
    const lock = path.join(configDir, 'ticket-action-cooldown.json.lock');
    fs.writeFileSync(lock, '');
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    assert.equal(claimAction('PROJ-1', 'worklog', { configDir }).claimed, true);
    assert.equal(fs.existsSync(lock), false, 'the lock must be released after a claim');
  });

  it('a lock held by a live process fails closed — throws instead of claiming without atomicity', () => {
    const configDir = freshConfigDir();
    fs.writeFileSync(path.join(configDir, 'ticket-action-cooldown.json.lock'), '');
    assert.throws(() => claimAction('PROJ-1', 'worklog', { configDir, lockWaitMs: 100 }), /lock/i);
  });

  it('REAL RACE: eight processes claiming the same ticket at once — exactly one wins (found by live break test 5)', async () => {
    const configDir = freshConfigDir();
    const libUrl = new URL('../lib/ticket-action-cooldown.mjs', import.meta.url).href;
    const script = `import { claimAction } from ${JSON.stringify(libUrl)}; process.stdout.write(String(claimAction('RACE-1', 'worklog', { configDir: ${JSON.stringify(configDir)} }).claimed));`;
    const runOne = () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      child.stdout.on('data', (d) => { out += d; });
      child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`child exited ${code}`))));
    });
    const results = await Promise.all(Array.from({ length: 8 }, runOne));
    assert.equal(results.filter((r) => r === 'true').length, 1, `claims: ${results.join(',')}`);
  });
});
