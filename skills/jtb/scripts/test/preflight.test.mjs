import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkApiBase } from '../../../../scripts/preflight.mjs';

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
