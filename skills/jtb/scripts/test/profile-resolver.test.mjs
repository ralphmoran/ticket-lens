import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConnection, resolveProfile, loadProfiles } from '../lib/profile-resolver.mjs';

const sampleProfiles = {
  profiles: {
    corenexus: {
      baseUrl: 'https://corenexus.atlassian.net',
      auth: 'cloud',
      email: 'ralph@example.com',
      ticketPrefixes: ['CNV1', 'CNV2'],
    },
    acme: {
      baseUrl: 'https://acme.atlassian.net',
      auth: 'cloud',
      email: 'ralph@acme.com',
      ticketPrefixes: ['ACME', 'OPS'],
    },
    acme: {
      baseUrl: 'https://jira.forge.com',
      auth: 'server',
      ticketPrefixes: ['ADV'],
    },
  },
  default: 'corenexus',
};

const sampleCreds = {
  corenexus: { apiToken: 'token-corenexus' },
  acme: { apiToken: 'token-acme' },
  acme: { pat: 'pat-forge' },
};

describe('profile-resolver', () => {
  let configDir;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'ticketlens-'));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  function writeConfig(profiles = sampleProfiles, creds = sampleCreds) {
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify(profiles));
    writeFileSync(join(configDir, 'credentials.json'), JSON.stringify(creds));
  }

  describe('resolveConnection', () => {
    it('falls back to env vars when no config file exists', () => {
      const env = {
        JIRA_BASE_URL: 'https://fallback.atlassian.net',
        JIRA_EMAIL: 'user@test.com',
        JIRA_API_TOKEN: 'env-token',
      };
      const result = resolveConnection('ANY-123', { env, configDir: '/tmp/nonexistent-ticketlens' });
      assert.equal(result.baseUrl, 'https://fallback.atlassian.net');
      assert.equal(result.email, 'user@test.com');
      assert.equal(result.apiToken, 'env-token');
      assert.equal(result.source, 'env');
    });

    it('resolves profile by ticket prefix auto-detection', () => {
      writeConfig();
      const result = resolveConnection('CNV1-3', { configDir });
      assert.equal(result.baseUrl, 'https://corenexus.atlassian.net');
      assert.equal(result.email, 'ralph@example.com');
      assert.equal(result.apiToken, 'token-corenexus');
      assert.equal(result.source, 'profile');
      assert.equal(result.profileName, 'corenexus');
    });

    it('resolves different profile by different prefix', () => {
      writeConfig();
      const result = resolveConnection('PROD-1234', { configDir });
      assert.equal(result.baseUrl, 'https://jira.forge.com');
      assert.equal(result.pat, 'pat-forge');
      assert.equal(result.profileName, 'acme');
    });

    it('resolves by explicit --profile flag override', () => {
      writeConfig();
      const result = resolveConnection('CNV1-3', { configDir, profileName: 'acme' });
      assert.equal(result.baseUrl, 'https://acme.atlassian.net');
      assert.equal(result.email, 'ralph@acme.com');
      assert.equal(result.apiToken, 'token-acme');
      assert.equal(result.profileName, 'acme');
    });

    it('explicit --profile takes priority over prefix match', () => {
      writeConfig();
      // CNV1 would match corenexus, but --profile=acme overrides
      const result = resolveConnection('CNV1-3', { configDir, profileName: 'acme' });
      assert.equal(result.profileName, 'acme');
      assert.equal(result.baseUrl, 'https://jira.forge.com');
    });

    it('falls back to default profile when prefix has no match', () => {
      writeConfig();
      const result = resolveConnection('UNKNOWN-99', { configDir });
      assert.equal(result.profileName, 'corenexus');
      assert.equal(result.source, 'profile');
    });

    it('warns when prefix matches multiple profiles', () => {
      const dupeProfiles = {
        profiles: {
          clientA: { baseUrl: 'https://a.atlassian.net', auth: 'cloud', email: 'a@a.com', ticketPrefixes: ['PROJ'] },
          clientB: { baseUrl: 'https://b.atlassian.net', auth: 'cloud', email: 'b@b.com', ticketPrefixes: ['PROJ'] },
        },
        default: 'clientA',
      };
      const dupeCreds = { clientA: { apiToken: 'tok-a' }, clientB: { apiToken: 'tok-b' } };
      writeConfig(dupeProfiles, dupeCreds);

      let warning = null;
      const result = resolveConnection('PROJ-10', { configDir, onWarning: (w) => { warning = w; } });
      assert.equal(result.profileName, 'clientA');
      assert.ok(warning.includes('multiple profiles'));
      assert.ok(warning.includes('PROJ'));
    });

    it('falls back to env vars when config exists but credentials file missing', () => {
      writeFileSync(join(configDir, 'profiles.json'), JSON.stringify(sampleProfiles));
      // No credentials.json
      const result = resolveConnection('CNV1-3', { configDir });
      assert.equal(result.source, 'profile');
      assert.equal(result.apiToken, null); // no creds file
    });
  });

  describe('loadProfiles', () => {
    it('returns null when no profiles.json exists', () => {
      assert.equal(loadProfiles('/tmp/nonexistent'), null);
    });

    it('returns parsed config when profiles.json exists', () => {
      writeConfig();
      const config = loadProfiles(configDir);
      assert.equal(config.default, 'corenexus');
      assert.ok(config.profiles.acme);
    });
  });

  describe('resolveProfile', () => {
    it('returns null when no config exists', () => {
      assert.equal(resolveProfile('ANY-1', { configDir: '/tmp/nonexistent' }), null);
    });

    it('matches second prefix in ticketPrefixes array', () => {
      writeConfig();
      const result = resolveProfile('CNV2-5', { configDir });
      assert.equal(result.name, 'corenexus');
    });

    it('matches OPS prefix to acme profile', () => {
      writeConfig();
      const result = resolveProfile('OPS-42', { configDir });
      assert.equal(result.name, 'acme');
    });
  });
});
