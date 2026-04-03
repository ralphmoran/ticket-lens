import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConnection, resolveProfile, resolveProfileByPath, loadProfiles, loadCredentials, saveDefault, saveProfile, deleteProfile, invalidateProfilesCache } from '../lib/profile-resolver.mjs';
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

  describe('deleteProfile', () => {
    it('removes profile from profiles.json', () => {
      writeConfig();
      deleteProfile('acme', configDir);
      const config = loadProfiles(configDir);
      assert.ok(!config.profiles.acme, 'acme must be removed');
      assert.ok(config.profiles.corenexus, 'other profiles must remain');
    });

    it('removes credential entry from credentials.json', () => {
      writeConfig();
      writeFileSync(join(configDir, 'credentials.json'), JSON.stringify({
        corenexus: { apiToken: 'token-a' },
        acme:      { apiToken: 'token-b' },
      }), 'utf8');
      deleteProfile('acme', configDir);
      const creds = JSON.parse(readFileSync(join(configDir, 'credentials.json'), 'utf8'));
      assert.ok(!creds.acme, 'acme credential must be removed');
      assert.ok(creds.corenexus, 'other credentials must remain');
    });

    it('clears default when deleting the default profile', () => {
      writeConfig(); // default is 'corenexus'
      deleteProfile('corenexus', configDir);
      const config = loadProfiles(configDir);
      assert.ok(!config.default, 'default must be cleared when its profile is deleted');
    });

    it('returns { deleted: false, reason: "not-found" } for unknown profile', () => {
      writeConfig();
      const result = deleteProfile('nonexistent', configDir);
      assert.deepEqual(result, { deleted: false, reason: 'not-found' });
    });

    it('returns { deleted: true } on success', () => {
      writeConfig();
      const result = deleteProfile('acme', configDir);
      assert.deepEqual(result, { deleted: true });
    });

    it('writes profiles.json with mode 0o600 after delete', () => {
      writeConfig();
      deleteProfile('acme', configDir);
      const mode = statSync(join(configDir, 'profiles.json')).mode & 0o777;
      assert.equal(mode, 0o600, `profiles.json must be chmod 600 after delete, got ${mode.toString(8)}`);
    });
  });
});

// ─── Cache memoization ────────────────────────────────────────────────────────

describe('loadProfiles — cache', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jtb-cache-'));
    invalidateProfilesCache(dir);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    invalidateProfilesCache(dir);
  });

  it('returns same object reference on repeated calls (cache hit)', () => {
    writeFileSync(join(dir, 'profiles.json'), JSON.stringify({ profiles: { x: { baseUrl: 'https://a.com' } } }));
    const first = loadProfiles(dir);
    const second = loadProfiles(dir);
    assert.strictEqual(first, second, 'repeated loadProfiles should return same cached object');
  });

  it('different configDirs are cached independently', () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'jtb-cache2-'));
    try {
      writeFileSync(join(dir, 'profiles.json'), JSON.stringify({ profiles: { a: { baseUrl: 'https://a.com' } } }));
      writeFileSync(join(dir2, 'profiles.json'), JSON.stringify({ profiles: { b: { baseUrl: 'https://b.com' } } }));
      const r1 = loadProfiles(dir);
      const r2 = loadProfiles(dir2);
      assert.ok(r1.profiles.a, 'dir should have profile a');
      assert.ok(r2.profiles.b, 'dir2 should have profile b');
      assert.ok(!r1.profiles.b, 'dir should not see dir2 profiles');
    } finally {
      rmSync(dir2, { recursive: true, force: true });
      invalidateProfilesCache(dir2);
    }
  });

  it('saveProfile invalidates cache — subsequent loadProfiles returns fresh data', () => {
    writeFileSync(join(dir, 'profiles.json'), JSON.stringify({ profiles: { old: { baseUrl: 'https://old.com' } } }));
    loadProfiles(dir); // prime cache
    saveProfile('new', { baseUrl: 'https://new.com' }, {}, dir);
    const fresh = loadProfiles(dir);
    assert.ok(fresh.profiles.new, 'loadProfiles must return newly saved profile after saveProfile');
  });

  it('saveDefault invalidates cache — subsequent loadProfiles returns updated default', () => {
    writeFileSync(join(dir, 'profiles.json'), JSON.stringify({ profiles: { p: { baseUrl: 'https://x.com' } } }));
    loadProfiles(dir); // prime cache
    saveDefault('p', dir);
    const fresh = loadProfiles(dir);
    assert.equal(fresh.default, 'p');
  });

  it('deleteProfile invalidates cache — deleted profile not visible after delete', () => {
    writeFileSync(join(dir, 'profiles.json'), JSON.stringify({ profiles: { gone: { baseUrl: 'https://gone.com' } } }));
    loadProfiles(dir); // prime cache
    deleteProfile('gone', dir);
    const fresh = loadProfiles(dir);
    assert.ok(!fresh?.profiles?.gone, 'deleted profile must not appear after deleteProfile');
  });
});

describe('loadCredentials — cache', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jtb-cred-'));
    invalidateProfilesCache(dir);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    invalidateProfilesCache(dir);
  });

  it('returns same object reference on repeated calls (cache hit)', () => {
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ p: { apiToken: 'tok' } }));
    const first = loadCredentials(dir);
    const second = loadCredentials(dir);
    assert.strictEqual(first, second);
  });

  it('saveProfile invalidates credentials cache', () => {
    writeFileSync(join(dir, 'profiles.json'), JSON.stringify({ profiles: {} }));
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify({}));
    loadCredentials(dir); // prime cache
    saveProfile('p', { baseUrl: 'https://x.com' }, { apiToken: 'new-tok' }, dir);
    const fresh = loadCredentials(dir);
    assert.equal(fresh.p.apiToken, 'new-tok');
  });

  it('saveProfile invalidates profiles cache — loadProfiles reflects update immediately', () => {
    writeFileSync(join(dir, 'profiles.json'), JSON.stringify({ profiles: { acme: { baseUrl: 'https://jira.example.com' } } }));
    invalidateProfilesCache(dir);

    const before = loadProfiles(dir);
    assert.equal(before.profiles.acme.cloudSummarizeConsent, undefined, 'consent should not exist yet');

    saveProfile('acme', { ...before.profiles.acme, cloudSummarizeConsent: true }, null, dir);

    const after = loadProfiles(dir);
    assert.equal(after.profiles.acme.cloudSummarizeConsent, true, 'cloudSummarizeConsent must be visible immediately after save');
  });
});
