import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkApiBase, checkForLeaks } from '../../../../scripts/preflight.mjs';

test('non-latest tag always passes regardless of URL', () => {
  for (const tag of ['beta', 'dev', 'next', 'canary']) {
    assert.equal(checkApiBase('http://ticketlens.test', tag).ok, true, `tag '${tag}' should skip check`);
  }
});

test('latest + ticketlens.test is blocked', () => {
  const result = checkApiBase('http://ticketlens.test', 'latest');
  assert.equal(result.ok, false);
  assert.match(result.reason, /local URL/);
});

test('latest + localhost is blocked', () => {
  assert.equal(checkApiBase('http://localhost:8000', 'latest').ok, false);
});

test('latest + 127.0.0.1 is blocked', () => {
  assert.equal(checkApiBase('http://127.0.0.1', 'latest').ok, false);
});

test('latest + localhost with port is blocked', () => {
  assert.equal(checkApiBase('http://localhost:3000', 'latest').ok, false);
});

test('latest + production HTTPS URL passes', () => {
  const result = checkApiBase('https://api.ticketlens.io', 'latest');
  assert.equal(result.ok, true);
});

test('latest + production HTTP URL passes (warnIfInsecure handles TLS elsewhere)', () => {
  const result = checkApiBase('http://api.ticketlens.io', 'latest');
  assert.equal(result.ok, true);
});

test('undefined tag (npm_config_tag unset) defaults to latest behavior', () => {
  assert.equal(checkApiBase('http://ticketlens.test', undefined).ok, false);
});

test('empty string tag (some CI environments) defaults to latest behavior', () => {
  assert.equal(checkApiBase('http://ticketlens.test', '').ok, false);
});

test('checkForLeaks: ok:true and a summary reason for a clean tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'preflight-leak-test-'));
  try {
    writeFileSync(join(root, 'clean.mjs'), "export const x = 'PROJ-123';\n");
    const result = checkForLeaks(root, ['clean.mjs']);
    assert.equal(result.ok, true);
    assert.match(result.reason, /no employer\/pilot-client leaks found/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checkForLeaks: ok:false with each violation listed in the reason', () => {
  const root = mkdtempSync(join(tmpdir(), 'preflight-leak-test-'));
  try {
    writeFileSync(join(root, 'dirty.mjs'), "const t = 'ECNT-3888';\n");
    const result = checkForLeaks(root, ['dirty.mjs']);
    assert.equal(result.ok, false);
    assert.match(result.reason, /Found 1 employer\/pilot-client leak/);
    assert.match(result.reason, /dirty\.mjs:1/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
