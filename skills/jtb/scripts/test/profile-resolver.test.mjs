import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConnection, resolveProfile, resolveProfileByPath, findProfilesByPrefix, loadProfiles, loadCredentials, saveDefault, saveProfile, deleteProfile, invalidateProfilesCache, saveTeams, loadTeams, saveProfileRecallTeamId, loadProfileRecallTeamId, saveProfileRecallStrictness, normalizeRecallStrictness, resolveEffectiveRecallStrictness, RECALL_STRICTNESS_LEVELS, DEFAULT_RECALL_STRICTNESS, resolveRecallStrictnessTarget } from '../lib/profile-resolver.mjs';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { hashToken } from '../lib/recall-sync.mjs';

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
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify(profiles), { mode: 0o600 });
    writeFileSync(join(configDir, 'credentials.json'), JSON.stringify(creds), { mode: 0o600 });
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

    it('carries allowPrivateIp:true from a profile marked as a trusted VPN-gated on-prem connection', () => {
      const trustedProfiles = {
        profiles: {
          ...sampleProfiles.profiles,
          forge: { ...sampleProfiles.profiles.forge, allowPrivateIp: true },
        },
        default: sampleProfiles.default,
      };
      writeConfig(trustedProfiles);
      const result = resolveConnection('PROD-1234', { configDir });
      assert.equal(result.allowPrivateIp, true);
    });

    it('defaults allowPrivateIp to false when the profile never set it (regression)', () => {
      writeConfig();
      const result = resolveConnection('CNV1-3', { configDir });
      assert.equal(result.allowPrivateIp, false);
    });

    it('does not set allowPrivateIp when falling back to env vars (out of scope for env-var users)', () => {
      const env = { JIRA_BASE_URL: 'https://fallback.atlassian.net', JIRA_PAT: 'tok' };
      const result = resolveConnection('ANY-123', { env, configDir: '/tmp/nonexistent-ticketlens' });
      assert.equal(result.allowPrivateIp, undefined);
    });

    it('carries recallStrictness from a profile that set it', () => {
      const withStrictness = {
        profiles: {
          ...sampleProfiles.profiles,
          corenexus: { ...sampleProfiles.profiles.corenexus, recallStrictness: 'strict' },
        },
        default: sampleProfiles.default,
      };
      writeConfig(withStrictness);
      const result = resolveConnection('CNV1-3', { configDir });
      assert.equal(result.recallStrictness, 'strict');
    });

    it('defaults recallStrictness to balanced when the profile never set it', () => {
      writeConfig();
      const result = resolveConnection('CNV1-3', { configDir });
      assert.equal(result.recallStrictness, 'balanced');
    });

    it('normalizes an invalid stored recallStrictness value to balanced', () => {
      const corrupted = {
        profiles: {
          ...sampleProfiles.profiles,
          corenexus: { ...sampleProfiles.profiles.corenexus, recallStrictness: 'yolo' },
        },
        default: sampleProfiles.default,
      };
      writeConfig(corrupted);
      const result = resolveConnection('CNV1-3', { configDir });
      assert.equal(result.recallStrictness, 'balanced');
    });

    it('does not set recallStrictness when falling back to env vars', () => {
      const env = { JIRA_BASE_URL: 'https://fallback.atlassian.net', JIRA_PAT: 'tok' };
      const result = resolveConnection('ANY-123', { env, configDir: '/tmp/nonexistent-ticketlens' });
      assert.equal(result.recallStrictness, undefined);
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

    it('returns null when profiles.json is corrupt JSON', () => {
      writeFileSync(join(configDir, 'profiles.json'), 'NOT_VALID_JSON');
      invalidateProfilesCache(configDir);
      assert.equal(loadProfiles(configDir), null);
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

  describe('findProfilesByPrefix', () => {
    it('returns the single profile whose ticketPrefixes includes the prefix', () => {
      writeConfig();
      assert.deepEqual(findProfilesByPrefix('PROD', configDir), ['forge']);
    });

    it('returns an empty array when no profile is registered for the prefix — a genuinely new project', () => {
      writeConfig();
      assert.deepEqual(findProfilesByPrefix('UNKNOWN', configDir), []);
    });

    it('returns every matching profile when more than one owns the same prefix', () => {
      const profiles = {
        profiles: {
          a: { baseUrl: 'https://a.atlassian.net', ticketPrefixes: ['SHARED'] },
          b: { baseUrl: 'https://b.atlassian.net', ticketPrefixes: ['SHARED'] },
        },
      };
      writeConfig(profiles, { a: { apiToken: 'x' }, b: { apiToken: 'y' } });
      assert.deepEqual(findProfilesByPrefix('SHARED', configDir).sort(), ['a', 'b']);
    });

    it('returns an empty array when no config exists', () => {
      assert.deepEqual(findProfilesByPrefix('ANY', '/tmp/nonexistent'), []);
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

  describe('saveTeams / loadTeams', () => {
    it('writes the team list to profiles.json', () => {
      writeConfig();
      saveTeams([{ id: 1, name: "Team Manager's Team", role: 'member' }], configDir);
      assert.deepEqual(loadTeams(configDir), [{ id: 1, name: "Team Manager's Team", role: 'member' }]);
    });

    it('preserves existing profiles and default when writing teams', () => {
      writeConfig();
      saveTeams([{ id: 11, name: "Rafael's Team", role: 'owner' }], configDir);
      const config = loadProfiles(configDir);
      assert.ok(config.profiles['corenexus']);
      assert.equal(config.default, 'corenexus');
    });

    it('creates profiles.json if it does not exist', () => {
      saveTeams([{ id: 1, name: 'Solo', role: 'owner' }], configDir);
      assert.deepEqual(loadTeams(configDir), [{ id: 1, name: 'Solo', role: 'owner' }]);
    });

    it('writes profiles.json with mode 0o600', () => {
      saveTeams([], configDir);
      const mode = statSync(join(configDir, 'profiles.json')).mode & 0o777;
      assert.equal(mode, 0o600);
    });

    it('loadTeams returns an empty array when profiles.json has no teams key', () => {
      writeConfig();
      assert.deepEqual(loadTeams(configDir), []);
    });

    it('loadTeams returns an empty array when profiles.json does not exist', () => {
      assert.deepEqual(loadTeams(configDir), []);
    });

    it('overwrites a previously saved team list rather than appending', () => {
      writeConfig();
      saveTeams([{ id: 1, name: 'Old', role: 'owner' }], configDir);
      saveTeams([{ id: 2, name: 'New', role: 'member' }], configDir);
      assert.deepEqual(loadTeams(configDir), [{ id: 2, name: 'New', role: 'member' }]);
    });

    it('sanitizes a team name containing terminal escape sequences before persisting — team names are server-controlled, attacker-influenceable data', () => {
      saveTeams([{ id: 1, name: 'Evil\x1b[2J\x1b]0;pwned\x07Team', role: 'member' }], configDir);
      const saved = loadTeams(configDir)[0];
      assert.ok(!saved.name.includes('\x1b'));
      assert.ok(!saved.name.includes('\x07'));
    });
  });

  describe('saveProfileRecallTeamId / loadProfileRecallTeamId', () => {
    it('writes recallTeamId to credentials.json under the profile, not profiles.json', () => {
      writeConfig();
      saveProfileRecallTeamId('corenexus', 1, configDir);
      assert.equal(loadProfileRecallTeamId('corenexus', configDir), 1);
      const profilesOnDisk = loadProfiles(configDir);
      assert.equal(profilesOnDisk.profiles.corenexus.recallTeamId, undefined, 'must not leak into profiles.json');
    });

    it('preserves existing apiToken/pat on the same profile when setting recallTeamId', () => {
      writeConfig();
      saveProfileRecallTeamId('corenexus', 1, configDir);
      const creds = loadCredentials(configDir);
      assert.equal(creds.corenexus.apiToken, 'token-corenexus');
      assert.equal(creds.corenexus.recallTeamId, 1);
    });

    it('preserves recallTeamId when a later saveProfile call updates the same profile', () => {
      writeConfig();
      saveProfileRecallTeamId('corenexus', 1, configDir);
      saveProfile('corenexus', sampleProfiles.profiles.corenexus, { apiToken: 'token-corenexus' }, configDir);
      assert.equal(loadProfileRecallTeamId('corenexus', configDir), 1);
    });

    it('switching a profile from apiToken auth to pat auth clears the stale apiToken, but still preserves recallTeamId', () => {
      writeConfig();
      saveProfileRecallTeamId('corenexus', 1, configDir);
      saveProfile('corenexus', { ...sampleProfiles.profiles.corenexus, auth: 'pat' }, { pat: 'new-pat-token' }, configDir);

      const creds = loadCredentials(configDir);
      assert.equal(creds.corenexus.pat, 'new-pat-token');
      assert.equal(creds.corenexus.apiToken, undefined, 'the stale apiToken must not survive an auth-type switch to pat');
      assert.equal(loadProfileRecallTeamId('corenexus', configDir), 1);
    });

    it('switching a profile from pat auth back to apiToken auth clears the stale pat', () => {
      saveProfile('work', { baseUrl: 'https://a.example.com', auth: 'pat' }, { pat: 'old-pat' }, configDir);
      saveProfile('work', { baseUrl: 'https://a.example.com', auth: 'cloud' }, { apiToken: 'new-token' }, configDir);

      const creds = loadCredentials(configDir);
      assert.equal(creds.work.apiToken, 'new-token');
      assert.equal(creds.work.pat, undefined, 'the stale pat must not survive an auth-type switch to apiToken');
    });

    it('creates credentials.json if it does not exist', () => {
      saveProfileRecallTeamId('newprofile', 5, configDir);
      assert.equal(loadProfileRecallTeamId('newprofile', configDir), 5);
    });

    it('writes credentials.json with mode 0o600', () => {
      saveProfileRecallTeamId('secure', 1, configDir);
      const mode = statSync(join(configDir, 'credentials.json')).mode & 0o777;
      assert.equal(mode, 0o600);
    });

    it('loadProfileRecallTeamId returns null when unset', () => {
      writeConfig();
      assert.equal(loadProfileRecallTeamId('corenexus', configDir), null);
    });

    it('loadProfileRecallTeamId returns null for an unknown profile', () => {
      assert.equal(loadProfileRecallTeamId('nonexistent', configDir), null);
    });
  });

  describe('normalizeRecallStrictness', () => {
    it('passes through each valid level unchanged', () => {
      for (const level of RECALL_STRICTNESS_LEVELS) {
        assert.equal(normalizeRecallStrictness(level), level);
      }
    });

    it('defaults to balanced for undefined', () => {
      assert.equal(normalizeRecallStrictness(undefined), DEFAULT_RECALL_STRICTNESS);
    });

    it('defaults to balanced for an unrecognized string', () => {
      assert.equal(normalizeRecallStrictness('aggressive'), DEFAULT_RECALL_STRICTNESS);
    });

    it('defaults to balanced for non-string garbage', () => {
      assert.equal(normalizeRecallStrictness(42), DEFAULT_RECALL_STRICTNESS);
      assert.equal(normalizeRecallStrictness(null), DEFAULT_RECALL_STRICTNESS);
    });

    it('RECALL_STRICTNESS_LEVELS is exactly the three named levels', () => {
      assert.deepEqual(RECALL_STRICTNESS_LEVELS, ['loose', 'balanced', 'strict']);
    });

    it('re-exports the same array identity as recall-strictness.mjs, the single source of truth', async () => {
      const leaf = await import('../lib/recall-strictness.mjs');
      assert.equal(RECALL_STRICTNESS_LEVELS, leaf.RECALL_STRICTNESS_LEVELS);
      assert.equal(DEFAULT_RECALL_STRICTNESS, leaf.DEFAULT_RECALL_STRICTNESS);
    });
  });

  describe('resolveEffectiveRecallStrictness (backlog #20)', () => {
    function writeSettingsCache(dir, values, { tokenHash = hashToken('tl_key'), fetchedAt = new Date().toISOString() } = {}) {
      writeFileSync(join(dir, 'recall-settings-cache.json'), JSON.stringify({ values, tokenHash, fetchedAt }));
    }

    it('an explicit local profile override always wins over a cached team default', () => {
      writeSettingsCache(configDir, { recall_strictness: 'loose' });
      const result = resolveEffectiveRecallStrictness({
        profile: { recallStrictness: 'strict' }, configDir, cliToken: 'tl_key',
      });
      assert.equal(result, 'strict');
    });

    it('falls back to the cached team default when the profile has no override', () => {
      writeSettingsCache(configDir, { recall_strictness: 'loose' });
      const result = resolveEffectiveRecallStrictness({
        profile: { baseUrl: 'https://x.atlassian.net' }, configDir, cliToken: 'tl_key',
      });
      assert.equal(result, 'loose');
    });

    it('falls back to platform default (balanced) when neither the profile nor the cache has a value', () => {
      const result = resolveEffectiveRecallStrictness({ profile: {}, configDir, cliToken: 'tl_key' });
      assert.equal(result, DEFAULT_RECALL_STRICTNESS);
    });

    it('treats an unrecognized profile.recallStrictness as no override, not a crash — falls through to the cache', () => {
      writeSettingsCache(configDir, { recall_strictness: 'strict' });
      const result = resolveEffectiveRecallStrictness({
        profile: { recallStrictness: 'aggressive' }, configDir, cliToken: 'tl_key',
      });
      assert.equal(result, 'strict');
    });

    it('never trusts a cache written under a different account', () => {
      writeSettingsCache(configDir, { recall_strictness: 'strict' }, { tokenHash: hashToken('old_account') });
      const result = resolveEffectiveRecallStrictness({
        profile: {}, configDir, cliToken: 'new_account',
      });
      assert.equal(result, DEFAULT_RECALL_STRICTNESS);
    });

    it('is fully synchronous and network-free — safe for the Stop hook', () => {
      // resolveEffectiveRecallStrictness has no async keyword and returns a
      // plain string, not a Promise — this is a compile-time/type-level
      // guarantee, not just a runtime one.
      const result = resolveEffectiveRecallStrictness({ profile: {}, configDir, cliToken: 'tl_key' });
      assert.equal(typeof result, 'string');
    });
  });

  describe('saveProfileRecallStrictness', () => {
    let configDir;

    beforeEach(() => {
      configDir = mkdtempSync(join(tmpdir(), 'ticketlens-'));
      writeFileSync(join(configDir, 'profiles.json'), JSON.stringify(sampleProfiles, null, 2));
    });

    afterEach(() => {
      rmSync(configDir, { recursive: true, force: true });
    });

    it('writes recallStrictness onto an existing profile', () => {
      saveProfileRecallStrictness('corenexus', 'strict', configDir);
      const saved = JSON.parse(readFileSync(join(configDir, 'profiles.json'), 'utf8'));
      assert.equal(saved.profiles.corenexus.recallStrictness, 'strict');
    });

    it('never clobbers other fields on the same profile', () => {
      saveProfileRecallStrictness('corenexus', 'loose', configDir);
      const saved = JSON.parse(readFileSync(join(configDir, 'profiles.json'), 'utf8'));
      assert.equal(saved.profiles.corenexus.baseUrl, sampleProfiles.profiles.corenexus.baseUrl);
      assert.deepEqual(saved.profiles.corenexus.ticketPrefixes, sampleProfiles.profiles.corenexus.ticketPrefixes);
    });

    it('does not affect other profiles', () => {
      saveProfileRecallStrictness('corenexus', 'strict', configDir);
      const saved = JSON.parse(readFileSync(join(configDir, 'profiles.json'), 'utf8'));
      assert.equal(saved.profiles.acme.recallStrictness, undefined);
    });

    it('throws for an unknown profile', () => {
      assert.throws(() => saveProfileRecallStrictness('nonexistent', 'strict', configDir), /Unknown profile/);
    });

    it('invalidates the profiles cache so a subsequent loadProfiles sees the new value', () => {
      saveProfileRecallStrictness('corenexus', 'strict', configDir);
      const reloaded = loadProfiles(configDir);
      assert.equal(reloaded.profiles.corenexus.recallStrictness, 'strict');
    });
  });

  describe('resolveRecallStrictnessTarget', () => {
    let configDir;

    beforeEach(() => {
      configDir = mkdtempSync(join(tmpdir(), 'ticketlens-'));
      writeFileSync(join(configDir, 'profiles.json'), JSON.stringify(sampleProfiles, null, 2));
    });

    afterEach(() => {
      rmSync(configDir, { recursive: true, force: true });
    });

    it('resolves to the explicit --profile when given and valid', () => {
      const result = resolveRecallStrictnessTarget({ value: 'strict', explicitProfileName: 'acme', configDir });
      assert.deepEqual(result, { ok: true, profileName: 'acme', value: 'strict' });
    });

    it('falls back to the default profile when no explicit profile is given', () => {
      const result = resolveRecallStrictnessTarget({ value: 'loose', configDir });
      assert.deepEqual(result, { ok: true, profileName: 'corenexus', value: 'loose' });
    });

    it('fails with missing-value when no level is given', () => {
      const result = resolveRecallStrictnessTarget({ value: undefined, configDir });
      assert.deepEqual(result, { ok: false, reason: 'missing-value' });
    });

    it('fails with invalid-level for an unrecognized level', () => {
      const result = resolveRecallStrictnessTarget({ value: 'aggressive', configDir });
      assert.deepEqual(result, { ok: false, reason: 'invalid-level', value: 'aggressive' });
    });

    it('fails with no-profile when the explicit profile does not exist', () => {
      const result = resolveRecallStrictnessTarget({ value: 'strict', explicitProfileName: 'ghost', configDir });
      assert.deepEqual(result, { ok: false, reason: 'no-profile' });
    });

    it('fails with no-profile when no profile and no default resolve', () => {
      const noDefault = { profiles: sampleProfiles.profiles };
      writeFileSync(join(configDir, 'profiles.json'), JSON.stringify(noDefault, null, 2));
      const result = resolveRecallStrictnessTarget({ value: 'strict', configDir });
      assert.deepEqual(result, { ok: false, reason: 'no-profile' });
    });

    it('fails with no-profile when no profiles.json exists at all', () => {
      const result = resolveRecallStrictnessTarget({ value: 'strict', configDir: join(configDir, 'nonexistent') });
      assert.deepEqual(result, { ok: false, reason: 'no-profile' });
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
