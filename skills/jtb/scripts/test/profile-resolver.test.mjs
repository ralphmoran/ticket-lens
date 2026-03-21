import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConnection, resolveProfile, resolveProfileByPath, loadProfiles, saveDefault, saveProfile } from '../lib/profile-resolver.mjs';
import { readFileSync, existsSync, statSync } from 'node:fs';

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
    forge: {
      baseUrl: 'https://jira.forge.com',
      auth: 'server',
      ticketPrefixes: ['PROD'],
    },
  },
  default: 'corenexus',
};

const sampleCreds = {
  corenexus: { apiToken: 'token-corenexus' },
  acme: { apiToken: 'token-acme' },
  forge: { pat: 'pat-forge' },
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
      assert.equal(result.profileName, 'forge');
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
      // CNV1 would match corenexus, but --profile=forge overrides
      const result = resolveConnection('CNV1-3', { configDir, profileName: 'forge' });
      assert.equal(result.profileName, 'forge');
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

    it('returns auth type from cloud profile', () => {
      writeConfig();
      const result = resolveConnection('CNV1-3', { configDir });
      assert.equal(result.auth, 'cloud');
    });

    it('returns auth type from server profile', () => {
      writeConfig();
      const result = resolveConnection('PROD-1234', { configDir });
      assert.equal(result.auth, 'server');
      assert.equal(result.profileName, 'forge');
    });

    it('returns auth as null when falling back to env vars', () => {
      const env = {
        JIRA_BASE_URL: 'https://fallback.atlassian.net',
        JIRA_PAT: 'tok',
      };
      const result = resolveConnection('ANY-123', { env, configDir: '/tmp/nonexistent-ticketlens' });
      assert.equal(result.auth, null);
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

  describe('resolveProfileByPath', () => {
    it('returns profile when cwd matches a projectPaths entry', () => {
      const profiles = {
        profiles: {
          proj: { baseUrl: 'https://proj.atlassian.net', auth: 'cloud', email: 'a@a.com', projectPaths: ['/home/dev/projects/myapp'] },
        },
        default: 'proj',
      };
      writeConfig(profiles, { proj: { apiToken: 'tok' } });
      const result = resolveProfileByPath('/home/dev/projects/myapp/src', configDir);
      assert.equal(result.name, 'proj');
    });

    it('returns null when cwd does not match any projectPaths', () => {
      const profiles = {
        profiles: {
          proj: { baseUrl: 'https://proj.atlassian.net', auth: 'cloud', email: 'a@a.com', projectPaths: ['/home/dev/projects/myapp'] },
        },
        default: 'proj',
      };
      writeConfig(profiles, { proj: { apiToken: 'tok' } });
      const result = resolveProfileByPath('/tmp/random', configDir);
      assert.equal(result, null);
    });

    it('returns null when no projectPaths configured', () => {
      writeConfig(); // sampleProfiles has no projectPaths
      const result = resolveProfileByPath('/home/dev/anywhere', configDir);
      assert.equal(result, null);
    });

    it('longest path wins when cwd matches multiple profiles', () => {
      const profiles = {
        profiles: {
          broad: { baseUrl: 'https://broad.atlassian.net', auth: 'cloud', email: 'a@a.com', projectPaths: ['/home/dev'] },
          specific: { baseUrl: 'https://specific.atlassian.net', auth: 'cloud', email: 'b@b.com', projectPaths: ['/home/dev/projects/myapp'] },
        },
      };
      writeConfig(profiles, { broad: { apiToken: 'tok1' }, specific: { apiToken: 'tok2' } });
      const result = resolveProfileByPath('/home/dev/projects/myapp/src', configDir);
      assert.equal(result.name, 'specific');
    });
  });

  describe('resolveProfile with cwd', () => {
    it('uses project path match when no ticket key provided', () => {
      const profiles = {
        profiles: {
          proj: { baseUrl: 'https://proj.atlassian.net', auth: 'cloud', email: 'a@a.com', projectPaths: ['/home/dev/myapp'] },
          other: { baseUrl: 'https://other.atlassian.net', auth: 'cloud', email: 'b@b.com' },
        },
        default: 'other',
      };
      writeConfig(profiles, { proj: { apiToken: 'tok1' }, other: { apiToken: 'tok2' } });
      const result = resolveProfile(null, { configDir, cwd: '/home/dev/myapp/src' });
      assert.equal(result.name, 'proj');
    });

    it('falls to default when cwd does not match and no ticket key', () => {
      const profiles = {
        profiles: {
          proj: { baseUrl: 'https://proj.atlassian.net', auth: 'cloud', email: 'a@a.com', projectPaths: ['/home/dev/myapp'] },
          fallback: { baseUrl: 'https://fallback.atlassian.net', auth: 'cloud', email: 'b@b.com' },
        },
        default: 'fallback',
      };
      writeConfig(profiles, { proj: { apiToken: 'tok1' }, fallback: { apiToken: 'tok2' } });
      const result = resolveProfile(null, { configDir, cwd: '/tmp/random' });
      assert.equal(result.name, 'fallback');
    });
  });

  describe('saveDefault', () => {
    it('writes the default profile name to profiles.json', () => {
      writeConfig();
      saveDefault('acme', configDir);
      const config = loadProfiles(configDir);
      assert.equal(config.default, 'acme');
    });

    it('preserves existing profiles when updating default', () => {
      writeConfig();
      saveDefault('forge', configDir);
      const config = loadProfiles(configDir);
      assert.deepEqual(Object.keys(config.profiles), ['corenexus', 'acme', 'forge']);
      assert.equal(config.default, 'forge');
    });

    it('creates profiles.json if it does not exist', () => {
      saveDefault('newprofile', configDir);
      const config = loadProfiles(configDir);
      assert.equal(config.default, 'newprofile');
    });
  });

  describe('saveProfile', () => {
    it('writes a new profile to profiles.json', () => {
      writeConfig();
      saveProfile('newco', { baseUrl: 'https://newco.atlassian.net', auth: 'cloud', email: 'dev@newco.com' }, { apiToken: 'tok-new' }, configDir);
      const config = loadProfiles(configDir);
      assert.ok(config.profiles['newco']);
      assert.equal(config.profiles['newco'].baseUrl, 'https://newco.atlassian.net');
    });

    it('writes credentials to credentials.json', () => {
      saveProfile('myco', { baseUrl: 'https://myco.atlassian.net', auth: 'cloud', email: 'a@myco.com' }, { apiToken: 'sec-token' }, configDir);
      const credsPath = join(configDir, 'credentials.json');
      assert.ok(existsSync(credsPath));
      const creds = JSON.parse(readFileSync(credsPath, 'utf8'));
      assert.equal(creds['myco'].apiToken, 'sec-token');
    });

    it('sets credentials.json to mode 0o600', () => {
      saveProfile('secure', { baseUrl: 'https://s.atlassian.net', auth: 'cloud', email: 'a@b.com' }, { apiToken: 'tok' }, configDir);
      const credsPath = join(configDir, 'credentials.json');
      const mode = statSync(credsPath).mode & 0o777;
      assert.equal(mode, 0o600);
    });

    it('does not write credentials.json when credData is empty', () => {
      saveProfile('nocred', { baseUrl: 'https://n.atlassian.net', auth: 'pat' }, {}, configDir);
      const credsPath = join(configDir, 'credentials.json');
      assert.ok(!existsSync(credsPath));
    });

    it('preserves existing profiles when adding a new one', () => {
      writeConfig();
      saveProfile('extra', { baseUrl: 'https://extra.atlassian.net', auth: 'cloud', email: 'x@x.com' }, { apiToken: 'tok-x' }, configDir);
      const config = loadProfiles(configDir);
      assert.ok(config.profiles['corenexus']);
      assert.ok(config.profiles['extra']);
    });

    it('creates the configDir if it does not exist', () => {
      const newDir = join(configDir, 'subdir', 'ticketlens');
      saveProfile('brand-new', { baseUrl: 'https://b.atlassian.net', auth: 'cloud', email: 'b@b.com' }, { apiToken: 't' }, newDir);
      const config = loadProfiles(newDir);
      assert.ok(config.profiles['brand-new']);
    });

    it('writes profiles.json with mode 0o600', () => {
      saveProfile('sec-test', { baseUrl: 'https://s.atlassian.net', auth: 'cloud', email: 'sec@s.com' }, {}, configDir);
      const mode = statSync(join(configDir, 'profiles.json')).mode & 0o777;
      assert.equal(mode, 0o600, `profiles.json must be chmod 600, got ${mode.toString(8)}`);
    });
  });

  describe('saveDefault', () => {
    it('writes profiles.json with mode 0o600', () => {
      writeConfig();
      saveDefault('corenexus', configDir);
      const mode = statSync(join(configDir, 'profiles.json')).mode & 0o777;
      assert.equal(mode, 0o600, `profiles.json must be chmod 600 after saveDefault, got ${mode.toString(8)}`);
    });
  });
});
