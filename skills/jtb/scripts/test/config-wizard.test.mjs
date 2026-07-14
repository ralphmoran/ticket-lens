import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Patch promptText and promptYN before importing the wizard
// so tests can inject controlled input without real stdin interaction
import { run } from '../lib/config-wizard.mjs';

function setupConfig(overrides = {}) {
  const configDir = mkdtempSync(join(tmpdir(), 'ticketlens-cfg-'));
  const profile = {
    baseUrl: 'https://test.atlassian.net',
    auth: 'cloud',
    email: 'dev@example.com',
    ticketPrefixes: ['PROJ'],
    projectPaths: ['/tmp'],
    triageStatuses: ['In Progress', 'Code Review'],
    ...overrides.profile,
  };
  writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({
    profiles: { testprofile: profile },
    default: 'testprofile',
    ...overrides.profilesJson,
  }));
  writeFileSync(join(configDir, 'credentials.json'), JSON.stringify({
    testprofile: { apiToken: 'tok' },
  }));
  return configDir;
}

function captureOutput() {
  let stderr = '';
  const origErr = process.stderr.write.bind(process.stderr);
  process.stderr.write = (s) => { stderr += s; return true; };
  const restore = () => {
    process.stderr.write = origErr;
    process.exitCode = undefined;
  };
  return { get stderr() { return stderr; }, restore };
}

describe('config-wizard', () => {
  it('exits with error when no profiles exist', async () => {
    const configDir = mkdtempSync(join(tmpdir(), 'ticketlens-empty-'));
    const out = captureOutput();
    try {
      await run({ configDir });
      assert.equal(process.exitCode, 1);
      assert.ok(out.stderr.includes('No profiles configured'));
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });

  it('exits with error when named profile not found', async () => {
    const configDir = setupConfig();
    const out = captureOutput();
    try {
      await run({ configDir, profileName: 'nonexistent' });
      assert.equal(process.exitCode, 1);
      assert.ok(out.stderr.includes('Profile "nonexistent" not found'));
      assert.ok(out.stderr.includes('testprofile'));
    } finally {
      out.restore();
      rmSync(configDir, { recursive: true, force: true });
    }
  });
});

// Interactive flows can't run end-to-end under the test runner (real stdin
// readline) — wiring is asserted at source level, picker behavior (replace
// semantics, stale-value preservation) lives in wizard-pickers.test.mjs.
describe('config-wizard picker wiring', () => {
  const libDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib');
  const configSrc = readFileSync(join(libDir, 'config-wizard.mjs'), 'utf8');
  const initSrc = readFileSync(join(libDir, 'init-wizard.mjs'), 'utf8');

  it('config-wizard uses live-fetched pickers with current values pre-selected', () => {
    assert.ok(configSrc.includes("from './wizard-pickers.mjs'"), 'must import wizard-pickers');
    assert.ok(/pickTicketPrefixes\(\{[\s\S]*?current: profile\.ticketPrefixes/.test(configSrc),
      'prefix picker must pre-select the profile’s current prefixes');
    assert.ok(/pickTriageStatuses\(\{[\s\S]*?current: currentStatuses/.test(configSrc),
      'status picker must pre-select the profile’s current statuses');
  });

  it('config-wizard keeps the free-text fallback path', () => {
    assert.ok(configSrc.includes('ticketPrefixes === null'), 'prefix fallback branch required');
    assert.ok(configSrc.includes('triageStatuses === null'), 'status fallback branch required');
  });

  it('config-wizard picker fetches carry the hostname-scoped trust flag', () => {
    const pickerCalls = configSrc.match(/fetch(Projects|Statuses)\(\{ env: jiraEnv[^)]*\)/g) || [];
    assert.ok(pickerCalls.length >= 2, 'both pickers must use the shared jiraEnv');
    for (const call of pickerCalls) {
      assert.ok(call.includes('allowPrivateIp: isTrustedForCurrentUrl()'),
        `SSRF trust must be evaluated per-hostname at call time: ${call}`);
    }
  });

  it('init-wizard uses pickers with the free-text fallback preserved', () => {
    assert.ok(initSrc.includes("from './wizard-pickers.mjs'"), 'must import wizard-pickers');
    assert.ok(initSrc.includes('ticketPrefixes === null'), 'prefix fallback branch required');
    assert.ok(initSrc.includes('triageStatuses === null'), 'status fallback branch required');
    assert.ok(/pickTriageStatuses\(\{[\s\S]*?preserveMissing: false/.test(initSrc),
      'init must not preserve stale defaults as phantom rows');
  });
});
