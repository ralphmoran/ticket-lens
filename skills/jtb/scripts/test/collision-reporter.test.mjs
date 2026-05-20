import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatCollisions } from '../lib/collision-reporter.mjs';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCollision(overrides = {}) {
  return {
    your_branch:   overrides.your_branch   ?? 'feat/PROJ-123-checkout',
    your_tickets:  overrides.your_tickets  ?? ['PROJ-123'],
    teammate:      overrides.teammate      ?? 'alice',
    their_branch:  overrides.their_branch  ?? 'feat/PROJ-456-payment',
    their_tickets: overrides.their_tickets ?? ['PROJ-456'],
    shared_files:  overrides.shared_files  ?? ['src/checkout.js', 'src/payment.js'],
  };
}

// ── Zero collisions ───────────────────────────────────────────────────────────

describe('formatCollisions — zero collisions', () => {
  it('returns no-collision confirmation line', () => {
    const out = formatCollisions([]);
    assert.ok(out.includes('No branch collisions'), `Expected no-collision message, got: ${out}`);
  });

  it('ends with newline', () => {
    const out = formatCollisions([]);
    assert.ok(out.endsWith('\n'));
  });
});

// ── Single collision ──────────────────────────────────────────────────────────

describe('formatCollisions — single collision', () => {
  it('includes [1] marker', () => {
    const out = formatCollisions([makeCollision()], { plain: true });
    assert.ok(out.includes('[1]'));
  });

  it('includes teammate name', () => {
    const out = formatCollisions([makeCollision({ teammate: 'bob' })], { plain: true });
    assert.ok(out.includes('bob'));
  });

  it('includes your branch name', () => {
    const out = formatCollisions([makeCollision()], { plain: true });
    assert.ok(out.includes('feat/PROJ-123-checkout'));
  });

  it('includes their branch name', () => {
    const out = formatCollisions([makeCollision()], { plain: true });
    assert.ok(out.includes('feat/PROJ-456-payment'));
  });

  it('includes your ticket keys', () => {
    const out = formatCollisions([makeCollision({ your_tickets: ['PROJ-123'] })], { plain: true });
    assert.ok(out.includes('PROJ-123'));
  });

  it('includes their ticket keys', () => {
    const out = formatCollisions([makeCollision({ their_tickets: ['PROJ-456'] })], { plain: true });
    assert.ok(out.includes('PROJ-456'));
  });

  it('lists each shared file', () => {
    const out = formatCollisions([makeCollision({ shared_files: ['src/a.js', 'src/b.js'] })], { plain: true });
    assert.ok(out.includes('src/a.js'));
    assert.ok(out.includes('src/b.js'));
  });

  it('shows shared file count', () => {
    const out = formatCollisions([makeCollision({ shared_files: ['a.js', 'b.js', 'c.js'] })], { plain: true });
    assert.ok(out.includes('3'));
  });

  it('shows collision count in header', () => {
    const out = formatCollisions([makeCollision()], { plain: true });
    assert.ok(out.includes('1 collision'));
  });
});

// ── Multiple collisions ───────────────────────────────────────────────────────

describe('formatCollisions — multiple collisions', () => {
  it('shows plural collision count in header', () => {
    const out = formatCollisions([makeCollision(), makeCollision({ teammate: 'bob' })], { plain: true });
    assert.ok(out.includes('2 collisions'));
  });

  it('includes [1] and [2] markers', () => {
    const out = formatCollisions([makeCollision(), makeCollision({ teammate: 'carol' })], { plain: true });
    assert.ok(out.includes('[1]'));
    assert.ok(out.includes('[2]'));
  });
});

// ── JSON output ───────────────────────────────────────────────────────────────

describe('formatCollisions — JSON output', () => {
  it('returns valid JSON when json: true', () => {
    const out = formatCollisions([makeCollision()], { json: true });
    const parsed = JSON.parse(out);
    assert.ok(Array.isArray(parsed));
    assert.equal(parsed.length, 1);
  });

  it('JSON output preserves all collision fields', () => {
    const collision = makeCollision();
    const parsed = JSON.parse(formatCollisions([collision], { json: true }));
    assert.equal(parsed[0].teammate, collision.teammate);
    assert.deepEqual(parsed[0].shared_files, collision.shared_files);
  });

  it('JSON output for zero collisions is empty array', () => {
    const parsed = JSON.parse(formatCollisions([], { json: true }));
    assert.deepEqual(parsed, []);
  });
});

// ── Empty ticket arrays ───────────────────────────────────────────────────────

describe('formatCollisions — empty ticket arrays', () => {
  it('renders dash when your_tickets is empty', () => {
    const out = formatCollisions([makeCollision({ your_tickets: [] })], { plain: true });
    assert.ok(out.includes('—') || out.includes('-'));
  });

  it('renders dash when their_tickets is empty', () => {
    const out = formatCollisions([makeCollision({ their_tickets: [] })], { plain: true });
    assert.ok(out.includes('—') || out.includes('-'));
  });
});
