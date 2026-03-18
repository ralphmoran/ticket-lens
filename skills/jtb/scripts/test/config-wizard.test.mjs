import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
