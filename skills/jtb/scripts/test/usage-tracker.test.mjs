import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkUsage, incrementUsage, FREE_LIMIT } from '../lib/usage-tracker.mjs';

function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-usage-test-'));
  return dir;
}

describe('FREE_LIMIT', () => {
  it('is 3', () => {
    assert.equal(FREE_LIMIT, 3);
  });
});

describe('checkUsage', () => {
  it('returns count=0 and canUse=true when no usage file exists', () => {
    const dir = tmpDir();
    const result = checkUsage(dir);
    assert.equal(result.count, 0);
    assert.equal(result.canUse, true);
    fs.rmSync(dir, { recursive: true });
  });

  it('returns correct count for current month', () => {
    const dir = tmpDir();
    const month = new Date().toISOString().slice(0, 7);
    fs.writeFileSync(
      path.join(dir, 'usage.json'),
      JSON.stringify({ compliance: { [month]: 2 } })
    );
    const result = checkUsage(dir);
    assert.equal(result.count, 2);
    assert.equal(result.canUse, true);
    assert.equal(result.month, month);
    fs.rmSync(dir, { recursive: true });
  });

  it('returns canUse=false when count equals FREE_LIMIT', () => {
    const dir = tmpDir();
    const month = new Date().toISOString().slice(0, 7);
    fs.writeFileSync(
      path.join(dir, 'usage.json'),
      JSON.stringify({ compliance: { [month]: 3 } })
    );
    const result = checkUsage(dir);
    assert.equal(result.canUse, false);
    fs.rmSync(dir, { recursive: true });
  });

  it('returns count=0 for a different month', () => {
    const dir = tmpDir();
    fs.writeFileSync(
      path.join(dir, 'usage.json'),
      JSON.stringify({ compliance: { '2025-01': 3 } })
    );
    const result = checkUsage(dir);
    assert.equal(result.count, 0);
    assert.equal(result.canUse, true);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('incrementUsage', () => {
  it('creates usage.json if it does not exist', () => {
    const dir = tmpDir();
    incrementUsage(dir);
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8'));
    const month = new Date().toISOString().slice(0, 7);
    assert.equal(data.compliance[month], 1);
    fs.rmSync(dir, { recursive: true });
  });

  it('increments existing count', () => {
    const dir = tmpDir();
    const month = new Date().toISOString().slice(0, 7);
    fs.writeFileSync(
      path.join(dir, 'usage.json'),
      JSON.stringify({ compliance: { [month]: 1 } })
    );
    incrementUsage(dir);
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8'));
    assert.equal(data.compliance[month], 2);
    fs.rmSync(dir, { recursive: true });
  });

  it('does not touch other months', () => {
    const dir = tmpDir();
    const month = new Date().toISOString().slice(0, 7);
    fs.writeFileSync(
      path.join(dir, 'usage.json'),
      JSON.stringify({ compliance: { '2025-01': 5, [month]: 0 } })
    );
    incrementUsage(dir);
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8'));
    assert.equal(data.compliance['2025-01'], 5);
    fs.rmSync(dir, { recursive: true });
  });
});
