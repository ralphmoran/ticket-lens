import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkCooldown, recordAction, DEFAULT_COOLDOWN_MS } from '../lib/ticket-action-cooldown.mjs';

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
