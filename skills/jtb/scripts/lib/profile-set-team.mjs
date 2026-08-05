/**
 * ticketlens profiles set-team — maps a local Jira profile to the Console
 * team its Recall notes should push/pull against. Validates the name
 * against the locally synced team list (no live network call — that list
 * is refreshed by `ticketlens login`/`ticketlens sync`), but never blocks
 * the write on a stale/missing list or a name mismatch: the hard check is
 * server-side at push/pull time (RecallTeamResolver), this is a local
 * convenience check only.
 */
import { createStyler } from './ansi.mjs';
import { loadProfiles, loadTeams, saveProfile } from './profile-resolver.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

export function runProfilesSetTeam(profileName, teamName, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  loadProfilesFn = loadProfiles,
  loadTeamsFn = loadTeams,
  saveProfileFn = saveProfile,
} = {}) {
  const s = createStyler({ isTTY: stream.isTTY });
  const config = loadProfilesFn(configDir);
  const profile = config?.profiles?.[profileName];

  if (!profile) {
    stream.write(`  ${s.red('✖')} No profile named "${profileName}". Run ${s.cyan('ticketlens profiles')} to see available profiles.\n`);
    process.exitCode = 1;
    return;
  }

  const teams = loadTeamsFn(configDir);
  if (teams.length === 0) {
    stream.write(`  ${s.yellow('⚠')} No synced teams found — run ${s.cyan('ticketlens sync')} first to validate this name.\n`);
  } else if (!teams.some(t => t.name === teamName)) {
    stream.write(`  ${s.yellow('⚠')} "${teamName}" isn't one of your synced teams — check spelling, or run ${s.cyan('ticketlens sync')} to refresh.\n`);
  }

  // Must merge, not replace — saveProfile() overwrites the whole profile object.
  saveProfileFn(profileName, { ...profile, recallTeam: teamName }, null, configDir);
  stream.write(`  ${s.green('✔')} Recall notes captured under ${s.bold(s.cyan(profileName))} will target ${s.bold(s.cyan(teamName))}.\n`);
}
