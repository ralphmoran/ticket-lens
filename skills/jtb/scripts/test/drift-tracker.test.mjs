import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  readSnapshot,
  writeSnapshot,
  detectDrift,
  formatDriftWarning,
  getCurrentBranch,
} from '../lib/drift-tracker.mjs';

let tmpDir;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'drift-tracker-test-'));
});

after(() => {
  rmSync(tmpDir, { recursive: true });
});

// Minimal fs shim that delegates to real node:fs for mkdirSync/writeFileSync/readFileSync/existsSync
import * as realFs from 'node:fs';

function makeFs() {
  return realFs;
}

describe('readSnapshot', () => {
  it('returns null when file absent', () => {
    const result = readSnapshot('PROJ-001', {
      profile: 'default',
      configDir: tmpDir,
      fsModule: makeFs(),
    });
    assert.equal(result, null);
  });

  it('returns parsed object when file exists', () => {
    const profile = 'testprofile';
    const ticketKey = 'PROJ-002';
    const snapshotDir = join(tmpDir, 'drift', profile);
    mkdirSync(snapshotDir, { recursive: true });
    const data = { fetchedAt: '2026-01-01T00:00:00Z', status: 'In Progress', descriptionHash: 'abc', requirements: [] };
    writeFileSync(join(snapshotDir, `${ticketKey}.json`), JSON.stringify(data), 'utf8');

    const result = readSnapshot(ticketKey, {
      profile,
      configDir: tmpDir,
      fsModule: makeFs(),
    });
    assert.deepEqual(result, data);
  });
});

describe('writeSnapshot', () => {
  it('creates directory and file', () => {
    const profile = 'writetest';
    const ticketKey = 'PROJ-003';
    const ticket = {
      fields: {
        status: { name: 'To Do' },
        description: 'Must validate input',
      },
    };
    writeSnapshot(ticketKey, ticket, {
      profile,
      configDir: tmpDir,
      fsModule: makeFs(),
      branch: 'main',
    });
    const result = readSnapshot(ticketKey, { profile, configDir: tmpDir, fsModule: makeFs() });
    assert.ok(result !== null);
    assert.equal(result.status, 'To Do');
    assert.equal(result.branch, 'main');
    assert.ok(typeof result.descriptionHash === 'string');
    assert.ok(Array.isArray(result.requirements));
  });

  it('sanitizes profile name — rejects strings containing /', () => {
    assert.throws(
      () => writeSnapshot('PROJ-010', { fields: { status: { name: 'Open' }, description: '' } }, {
        profile: 'evil/hack',
        configDir: tmpDir,
        fsModule: makeFs(),
      }),
      /Invalid profile name/
    );
  });

  it('sanitizes profile name — rejects strings containing \\', () => {
    assert.throws(
      () => writeSnapshot('PROJ-011', { fields: { status: { name: 'Open' }, description: '' } }, {
        profile: 'evil\\hack',
        configDir: tmpDir,
        fsModule: makeFs(),
      }),
      /Invalid profile name/
    );
  });

  it('sanitizes profile name — rejects strings containing ..', () => {
    assert.throws(
      () => writeSnapshot('PROJ-012', { fields: { status: { name: 'Open' }, description: '' } }, {
        profile: '../evil',
        configDir: tmpDir,
        fsModule: makeFs(),
      }),
      /Invalid profile name/
    );
  });

  it('sanitizes ticket key — rejects path traversal', () => {
    assert.throws(
      () => writeSnapshot('../evil', { fields: { status: { name: 'Open' }, description: '' } }, {
        profile: 'safe',
        configDir: tmpDir,
        fsModule: makeFs(),
      }),
      /Invalid ticket key/
    );
  });
});

describe('detectDrift', () => {
  it('returns { drifted: false } when no prior snapshot (pass null as prior)', () => {
    const current = { status: 'In Progress', descriptionHash: 'abc', requirements: ['Must do X'] };
    const result = detectDrift(current, null);
    assert.equal(result.drifted, false);
    assert.deepEqual(result.changes, []);
  });

  it('returns { drifted: false } when fields identical', () => {
    const snap = { status: 'In Progress', descriptionHash: 'abc', requirements: ['Must do X'], fetchedAt: '2026-01-01', branch: 'main' };
    const current = { status: 'In Progress', descriptionHash: 'abc', requirements: ['Must do X'] };
    const result = detectDrift(current, snap);
    assert.equal(result.drifted, false);
    assert.deepEqual(result.changes, []);
  });

  it('returns { drifted: true, changes } when status changed', () => {
    const prior = { status: 'In Progress', descriptionHash: 'abc', requirements: [], fetchedAt: '2026-01-01', branch: 'main' };
    const current = { status: 'Done', descriptionHash: 'abc', requirements: [] };
    const result = detectDrift(current, prior);
    assert.equal(result.drifted, true);
    assert.ok(result.changes.some(c => c.includes('In Progress') && c.includes('Done')));
  });

  it('returns { drifted: true, changes } when descriptionHash changed', () => {
    const prior = { status: 'In Progress', descriptionHash: 'abc', requirements: [], fetchedAt: '2026-01-01', branch: 'main' };
    const current = { status: 'In Progress', descriptionHash: 'xyz', requirements: [] };
    const result = detectDrift(current, prior);
    assert.equal(result.drifted, true);
    assert.ok(result.changes.some(c => c.includes('description')));
  });

  it('returns { drifted: true, changes } when requirements array changed', () => {
    const prior = { status: 'In Progress', descriptionHash: 'abc', requirements: ['req1', 'req2'], fetchedAt: '2026-01-01', branch: 'main' };
    const current = { status: 'In Progress', descriptionHash: 'abc', requirements: ['req1', 'req2', 'req3'] };
    const result = detectDrift(current, prior);
    assert.equal(result.drifted, true);
    assert.ok(result.changes.some(c => c.includes('requirements') && c.includes('2') && c.includes('3')));
  });

  it('ignores fetchedAt and branch fields in comparison', () => {
    const prior = { status: 'In Progress', descriptionHash: 'abc', requirements: [], fetchedAt: '2026-01-01T00:00:00Z', branch: 'old-branch' };
    const current = { status: 'In Progress', descriptionHash: 'abc', requirements: [] };
    // Even though fetchedAt and branch differ, no drift detected for those fields
    const result = detectDrift(current, prior);
    assert.equal(result.drifted, false);
  });
});

describe('formatDriftWarning', () => {
  it('returns non-empty string containing the ticket key', () => {
    const result = formatDriftWarning('PROJ-999', ['status: "In Progress" \u2192 "Done"']);
    assert.ok(typeof result === 'string');
    assert.ok(result.length > 0);
    assert.ok(result.includes('PROJ-999'));
  });

  it('includes old and new status values in output', () => {
    const result = formatDriftWarning('PROJ-999', ['status: "In Progress" \u2192 "Done"']);
    assert.ok(result.includes('In Progress'));
    assert.ok(result.includes('Done'));
  });
});

describe('getCurrentBranch', () => {
  it('returns DETACHED when git output is HEAD', () => {
    const execFn = () => ({ status: 0, stdout: 'HEAD\n' });
    const result = getCurrentBranch({ execFn });
    assert.equal(result, 'DETACHED');
  });

  it('returns branch name string on normal HEAD', () => {
    const execFn = () => ({ status: 0, stdout: 'feat/my-branch\n' });
    const result = getCurrentBranch({ execFn });
    assert.equal(result, 'feat/my-branch');
  });
});
