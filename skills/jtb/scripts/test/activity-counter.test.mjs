import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  incrementFetch,
  incrementTriageRun,
  incrementInvocation,
  readAndResetActivity,
} from '../lib/activity-counter.mjs';

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('incrementFetch', () => {
  it('increments fetch_count from zero', () => {
    incrementFetch(tmpDir);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.fetch_count, 1);
  });

  it('accumulates multiple increments', () => {
    incrementFetch(tmpDir);
    incrementFetch(tmpDir);
    incrementFetch(tmpDir);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.fetch_count, 3);
  });
});

describe('incrementTriageRun', () => {
  it('increments triage_run_count independently', () => {
    incrementFetch(tmpDir);
    incrementTriageRun(tmpDir);
    incrementTriageRun(tmpDir);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.fetch_count, 1);
    assert.equal(data.triage_run_count, 2);
  });
});

describe('incrementInvocation', () => {
  it('increments invocations independently', () => {
    incrementInvocation(tmpDir);
    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.invocations, 1);
    assert.equal(data.fetch_count, 0);
  });
});

describe('readAndResetActivity', () => {
  it('returns zeros when no file exists', () => {
    const result = readAndResetActivity(tmpDir);
    assert.deepStrictEqual(result, { fetch_count: 0, triage_run_count: 0, invocations: 0 });
  });

  it('returns accumulated counts', () => {
    incrementFetch(tmpDir);
    incrementFetch(tmpDir);
    incrementTriageRun(tmpDir);
    incrementInvocation(tmpDir);
    incrementInvocation(tmpDir);
    incrementInvocation(tmpDir);

    const result = readAndResetActivity(tmpDir);
    assert.equal(result.fetch_count, 2);
    assert.equal(result.triage_run_count, 1);
    assert.equal(result.invocations, 3);
  });

  it('resets counters to zero after read', () => {
    incrementFetch(tmpDir);
    incrementFetch(tmpDir);
    readAndResetActivity(tmpDir);

    const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'activity.json'), 'utf8'));
    assert.equal(data.fetch_count, 0);
    assert.equal(data.triage_run_count, 0);
    assert.equal(data.invocations, 0);
  });

  it('returns zero after reset — second call is clean', () => {
    incrementFetch(tmpDir);
    readAndResetActivity(tmpDir);
    const second = readAndResetActivity(tmpDir);
    assert.deepStrictEqual(second, { fetch_count: 0, triage_run_count: 0, invocations: 0 });
  });

  it('handles corrupt file gracefully — treats as zero', () => {
    fs.writeFileSync(path.join(tmpDir, 'activity.json'), 'not-json', 'utf8');
    const result = readAndResetActivity(tmpDir);
    assert.deepStrictEqual(result, { fetch_count: 0, triage_run_count: 0, invocations: 0 });
  });
});
