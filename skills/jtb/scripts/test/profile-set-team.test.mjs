import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProfilesSetTeam } from '../lib/profile-set-team.mjs';
import { saveTeams, loadProfileRecallTeamId } from '../lib/profile-resolver.mjs';

function fakeStream({ isTTY = false } = {}) {
  const chunks = [];
  const s = { write: chunk => chunks.push(chunk) };
  s.isTTY = isTTY;
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
    writeFileSync(join(configDir, 'credentials.json'), JSON.stringify({
      advent: { apiToken: 'existing-token' },
    }, null, 2), { mode: 0o600 });
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  it('errors clearly when the profile does not exist', async () => {
    const stream = fakeStream();
    await runProfilesSetTeam('nonexistent', 'Some Team', { configDir, stream });

    assert.match(stream.text, /No profile named "nonexistent"/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });

  it('errors clearly when there are no synced teams at all', async () => {
    const stream = fakeStream();
    await runProfilesSetTeam('advent', "Team Manager's Team", { configDir, stream });

    assert.match(stream.text, /No synced teams found/);
    assert.match(stream.text, /ticketlens sync/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    assert.equal(loadProfileRecallTeamId('advent', configDir), null);
  });

  it('resolves an exact team name to its id and stores it in credentials.json', async () => {
    saveTeams([{ id: 1, name: "Team Manager's Team", role: 'member' }, { id: 11, name: "Rafael's Team", role: 'owner' }], configDir);
    const stream = fakeStream();

    await runProfilesSetTeam('advent', "Team Manager's Team", { configDir, stream });

    assert.equal(loadProfileRecallTeamId('advent', configDir), 1);
    assert.match(stream.text, /✔/);
    assert.match(stream.text, /Team Manager's Team/);
  });

  it('preserves the existing apiToken when setting recallTeamId', async () => {
    saveTeams([{ id: 1, name: "Team Manager's Team", role: 'member' }], configDir);
    await runProfilesSetTeam('advent', "Team Manager's Team", { configDir, stream: fakeStream() });

    const creds = JSON.parse(readFileSync(join(configDir, 'credentials.json'), 'utf8'));
    assert.equal(creds.advent.apiToken, 'existing-token');
    assert.equal(creds.advent.recallTeamId, 1);
  });

  it('a name with no exact match errors and suggests the closest synced team, without writing anything', async () => {
    saveTeams([{ id: 1, name: "Team Manager's Team", role: 'member' }], configDir);
    const stream = fakeStream();

    await runProfilesSetTeam('advent', "Team Managers Team", { configDir, stream });

    assert.match(stream.text, /isn't one of your synced teams/);
    assert.match(stream.text, /Did you mean/);
    assert.match(stream.text, /Team Manager's Team/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    assert.equal(loadProfileRecallTeamId('advent', configDir), null);
  });

  it('a name with no close match errors without a suggestion', async () => {
    saveTeams([{ id: 1, name: "Team Manager's Team", role: 'member' }], configDir);
    const stream = fakeStream();

    await runProfilesSetTeam('advent', 'Completely Unrelated Name', { configDir, stream });

    assert.doesNotMatch(stream.text, /Did you mean/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });

  it('with no team name and no TTY, lists the synced teams and errors instead of hanging', async () => {
    saveTeams([{ id: 1, name: "Team Manager's Team", role: 'member' }, { id: 11, name: "Rafael's Team", role: 'owner' }], configDir);
    const stream = fakeStream({ isTTY: false });

    await runProfilesSetTeam('advent', undefined, { configDir, stream });

    assert.match(stream.text, /No team specified/);
    assert.match(stream.text, /Team Manager's Team/);
    assert.match(stream.text, /Rafael's Team/);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    assert.equal(loadProfileRecallTeamId('advent', configDir), null);
  });

  it('with no team name and a TTY, shows an interactive picker and stores the selected team', async () => {
    saveTeams([{ id: 1, name: "Team Manager's Team", role: 'member' }, { id: 11, name: "Rafael's Team", role: 'owner' }], configDir);
    const stream = fakeStream({ isTTY: true });
    let capturedItems;
    const promptSelectFn = async (items) => { capturedItems = items; return 1; };

    await runProfilesSetTeam('advent', undefined, { configDir, stream, promptSelectFn });

    assert.equal(capturedItems.length, 2);
    assert.equal(loadProfileRecallTeamId('advent', configDir), 11);
    assert.match(stream.text, /Rafael's Team/);
  });

  it('cancelling the picker (Esc) writes nothing and does not error', async () => {
    saveTeams([{ id: 1, name: "Team Manager's Team", role: 'member' }], configDir);
    const stream = fakeStream({ isTTY: true });
    const promptSelectFn = async () => null;

    await runProfilesSetTeam('advent', undefined, { configDir, stream, promptSelectFn });

    assert.match(stream.text, /Cancelled/);
    assert.equal(loadProfileRecallTeamId('advent', configDir), null);
    assert.notEqual(process.exitCode, 1);
  });
});
