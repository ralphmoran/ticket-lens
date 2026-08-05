import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProfilesSetTeam } from '../lib/profile-set-team.mjs';
import { saveTeams } from '../lib/profile-resolver.mjs';

function fakeStream() {
  const chunks = [];
  const s = { write: chunk => chunks.push(chunk) };
  s.isTTY = false;
  Object.defineProperty(s, 'text', { get: () => chunks.join('') });
  return s;
}

describe('runProfilesSetTeam', () => {
  let configDir;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'ticketlens-set-team-'));
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({
      profiles: {
        advent: {
          baseUrl: 'https://jira.adventresources.com',
          auth: 'basic',
          email: 'ralphm',
          ticketPrefixes: ['ADV', 'ASAP'],
        },
      },
      default: 'advent',
    }, null, 2), { mode: 0o600 });
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  function readProfiles() {
    return JSON.parse(readFileSync(join(configDir, 'profiles.json'), 'utf8'));
  }

  it('sets recallTeam on the profile while preserving every existing field', () => {
    const stream = fakeStream();
    runProfilesSetTeam('advent', "Team Manager's Team", { configDir, stream });

    const saved = readProfiles().profiles.advent;
    assert.equal(saved.recallTeam, "Team Manager's Team");
    assert.equal(saved.baseUrl, 'https://jira.adventresources.com');
    assert.equal(saved.auth, 'basic');
    assert.equal(saved.email, 'ralphm');
    assert.deepEqual(saved.ticketPrefixes, ['ADV', 'ASAP']);
  });

  it('errors clearly and writes nothing when the profile does not exist', () => {
    const stream = fakeStream();
    const before = readProfiles();

    runProfilesSetTeam('nonexistent', 'Some Team', { configDir, stream });

    assert.match(stream.text, /No profile named "nonexistent"/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    assert.deepEqual(readProfiles(), before);
  });

  it('warns but still saves when the local teams list has never been synced', () => {
    const stream = fakeStream();
    runProfilesSetTeam('advent', "Team Manager's Team", { configDir, stream });

    assert.match(stream.text, /ticketlens sync/);
    assert.equal(readProfiles().profiles.advent.recallTeam, "Team Manager's Team");
  });

  it('warns but still saves when the name does not match any synced team', () => {
    saveTeams([{ id: 1, name: "Rafael's Team", role: 'owner' }], configDir);
    const stream = fakeStream();

    runProfilesSetTeam('advent', 'Typo Team', { configDir, stream });

    assert.match(stream.text, /isn't one of your synced teams/);
    assert.equal(readProfiles().profiles.advent.recallTeam, 'Typo Team');
  });

  it('does not warn when the name matches a synced team', () => {
    saveTeams([{ id: 1, name: "Team Manager's Team", role: 'member' }], configDir);
    const stream = fakeStream();

    runProfilesSetTeam('advent', "Team Manager's Team", { configDir, stream });

    assert.doesNotMatch(stream.text, /isn't one of your synced teams/);
    assert.doesNotMatch(stream.text, /ticketlens sync/);
    assert.match(stream.text, /✔/);
  });
});
