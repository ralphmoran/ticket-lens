import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkProfileConfig } from '../lib/doctor-checks.mjs';

let configDir;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'tl-doctor-checks-'));
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

function writeProfiles(dir, contents) {
  writeFileSync(join(dir, 'profiles.json'), JSON.stringify(contents), 'utf8');
}

function writeCredentials(dir, contents) {
  writeFileSync(join(dir, 'credentials.json'), JSON.stringify(contents), 'utf8');
}

describe('checkProfileConfig', () => {
  it('fails with "No profile configured" when profiles.json does not exist', () => {
    const result = checkProfileConfig({ configDir });
    assert.equal(result.id, 'profile-config');
    assert.equal(result.ok, false);
    assert.match(result.message, /No profile configured/);
    assert.equal(result.fixable, false);
  });

  it('fails when --profile=NAME does not match any configured profile', () => {
    writeProfiles(configDir, { profiles: { acme: { baseUrl: 'https://acme.atlassian.net' } } });
    const result = checkProfileConfig({ configDir, profileName: 'nope' });
    assert.equal(result.ok, false);
    assert.match(result.message, /"nope" not found/);
  });

  it('fails when the resolved profile has no baseUrl', () => {
    writeProfiles(configDir, { default: 'acme', profiles: { acme: {} } });
    writeCredentials(configDir, { acme: { apiToken: 'tok' } });
    const result = checkProfileConfig({ configDir });
    assert.equal(result.ok, false);
    assert.match(result.message, /no baseUrl/);
  });

  it('fails when the resolved profile has no stored credentials', () => {
    writeProfiles(configDir, { default: 'acme', profiles: { acme: { baseUrl: 'https://acme.atlassian.net' } } });
    const result = checkProfileConfig({ configDir });
    assert.equal(result.ok, false);
    assert.match(result.message, /no credentials/);
  });

  it('passes when the profile resolves with a baseUrl and an apiToken', () => {
    writeProfiles(configDir, { default: 'acme', profiles: { acme: { baseUrl: 'https://acme.atlassian.net' } } });
    writeCredentials(configDir, { acme: { apiToken: 'tok' } });
    const result = checkProfileConfig({ configDir });
    assert.equal(result.ok, true);
    assert.match(result.message, /"acme"/);
  });

  it('passes when the profile resolves with a baseUrl and a pat instead of an apiToken', () => {
    writeProfiles(configDir, { default: 'forge', profiles: { forge: { baseUrl: 'https://jira.forge.com', auth: 'server' } } });
    writeCredentials(configDir, { forge: { pat: 'pat-value' } });
    const result = checkProfileConfig({ configDir });
    assert.equal(result.ok, true);
  });

  it('resolves the explicitly-named profile over the configured default', () => {
    writeProfiles(configDir, {
      default: 'acme',
      profiles: {
        acme: { baseUrl: 'https://acme.atlassian.net' },
        globex: { baseUrl: 'https://globex.atlassian.net' },
      },
    });
    writeCredentials(configDir, { acme: { apiToken: 'a' }, globex: { apiToken: 'g' } });
    const result = checkProfileConfig({ configDir, profileName: 'globex' });
    assert.equal(result.ok, true);
    assert.match(result.message, /"globex"/);
  });
});
