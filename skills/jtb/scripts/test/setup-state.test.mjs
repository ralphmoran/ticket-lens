import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectSetupState } from '../lib/setup-state.mjs';

let configDir;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), 'tl-setup-state-'));
});

afterEach(() => {
  rmSync(configDir, { recursive: true, force: true });
});

function writeProfiles(dir, contents) {
  writeFileSync(join(dir, 'profiles.json'), typeof contents === 'string' ? contents : JSON.stringify(contents), 'utf8');
}

function writeCredentials(dir, contents) {
  writeFileSync(join(dir, 'credentials.json'), typeof contents === 'string' ? contents : JSON.stringify(contents), 'utf8');
}

describe('detectSetupState', () => {
  it('is fresh when the config dir does not exist', () => {
    const missingDir = join(configDir, 'does-not-exist');
    const state = detectSetupState({ configDir: missingDir });
    assert.equal(state.status, 'fresh');
    assert.equal(state.profileCount, 0);
    assert.deepEqual(state.missingCredentials, []);
    assert.equal(state.hasDefault, false);
    assert.equal(state.corrupt, false);
  });

  it('is fresh when profiles.json has zero profiles', () => {
    writeProfiles(configDir, { profiles: {} });
    const state = detectSetupState({ configDir });
    assert.equal(state.status, 'fresh');
    assert.equal(state.profileCount, 0);
  });

  it('is pending when a profile is missing its credentials entry', () => {
    writeProfiles(configDir, { profiles: { acme: { baseUrl: 'https://acme.atlassian.net' } }, default: 'acme' });
    writeCredentials(configDir, {});
    const state = detectSetupState({ configDir });
    assert.equal(state.status, 'pending');
    assert.deepEqual(state.missingCredentials, ['acme']);
  });

  it('is pending when multiple profiles exist with no default set', () => {
    writeProfiles(configDir, {
      profiles: {
        acme: { baseUrl: 'https://acme.atlassian.net' },
        globex: { baseUrl: 'https://globex.atlassian.net' },
      },
    });
    writeCredentials(configDir, {
      acme: { apiToken: 'tok1' },
      globex: { apiToken: 'tok2' },
    });
    const state = detectSetupState({ configDir });
    assert.equal(state.status, 'pending');
    assert.equal(state.hasDefault, false);
    assert.deepEqual(state.missingCredentials, []);
  });

  it('is ready when the single profile has credentials (no explicit default needed)', () => {
    writeProfiles(configDir, { profiles: { acme: { baseUrl: 'https://acme.atlassian.net' } } });
    writeCredentials(configDir, { acme: { apiToken: 'tok1' } });
    const state = detectSetupState({ configDir });
    assert.equal(state.status, 'ready');
    assert.equal(state.hasDefault, true);
  });

  it('is ready when multiple profiles all have credentials and a default is set', () => {
    writeProfiles(configDir, {
      profiles: {
        acme: { baseUrl: 'https://acme.atlassian.net' },
        globex: { baseUrl: 'https://globex.atlassian.net' },
      },
      default: 'acme',
    });
    writeCredentials(configDir, {
      acme: { apiToken: 'tok1' },
      globex: { apiToken: 'tok2' },
    });
    const state = detectSetupState({ configDir });
    assert.equal(state.status, 'ready');
  });

  it('never throws and reports corrupt on unparseable profiles.json', () => {
    mkdirSync(configDir, { recursive: true });
    writeProfiles(configDir, '{ not valid json');
    let state;
    assert.doesNotThrow(() => { state = detectSetupState({ configDir }); });
    assert.equal(state.status, 'fresh');
    assert.equal(state.corrupt, true);
  });

  it('never throws on unparseable credentials.json', () => {
    writeProfiles(configDir, { profiles: { acme: { baseUrl: 'https://acme.atlassian.net' } } });
    writeCredentials(configDir, '{ not valid json');
    let state;
    assert.doesNotThrow(() => { state = detectSetupState({ configDir }); });
    assert.equal(state.status, 'pending');
    assert.deepEqual(state.missingCredentials, ['acme']);
  });

  it('reports loggedIn true when a CLI token file exists', () => {
    writeFileSync(join(configDir, 'cli-token.json'), JSON.stringify({ token: 'tl_abc123' }), 'utf8');
    const state = detectSetupState({ configDir });
    assert.equal(state.loggedIn, true);
  });

  it('reports loggedIn false when no CLI token file exists', () => {
    const state = detectSetupState({ configDir });
    assert.equal(state.loggedIn, false);
  });

  it('never gates status on loggedIn — local-only usage is never pending', () => {
    writeProfiles(configDir, { profiles: { acme: { baseUrl: 'https://acme.atlassian.net' } } });
    writeCredentials(configDir, { acme: { apiToken: 'tok1' } });
    const state = detectSetupState({ configDir });
    assert.equal(state.loggedIn, false);
    assert.equal(state.status, 'ready');
  });
});

