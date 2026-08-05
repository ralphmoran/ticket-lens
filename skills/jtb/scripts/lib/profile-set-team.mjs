/**
 * ticketlens profiles set-team — maps a local Jira profile to the Console
 * team its Recall notes should push/pull against. Stores the team's id in
 * credentials.json (not profiles.json) — this is a sensitive association
 * (which specific team a specific local profile/folder routes notes to),
 * distinct from the non-secret profile shape profiles.json already carries.
 * Resolved against the locally synced team list (refreshed by
 * `ticketlens login`/`ticketlens sync`) — no live network call here, but
 * never a blind write either: an unresolvable name errors instead of
 * storing an id that doesn't exist.
 */
import { createStyler } from './ansi.mjs';
import { loadProfiles, loadTeams, saveProfileRecallTeamId, findClosest } from './profile-resolver.mjs';
import { promptSelect } from './select-prompt.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';

export async function runProfilesSetTeam(profileName, teamName, {
  configDir = DEFAULT_CONFIG_DIR,
  stream = process.stderr,
  loadProfilesFn = loadProfiles,
  loadTeamsFn = loadTeams,
  saveProfileRecallTeamIdFn = saveProfileRecallTeamId,
  promptSelectFn = promptSelect,
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
    stream.write(`  ${s.red('✖')} No synced teams found. Run ${s.cyan('ticketlens sync')} first.\n`);
    process.exitCode = 1;
    return;
  }

  let team;
  if (teamName) {
    team = teams.find(t => t.name === teamName);
    if (!team) {
      const suggestion = findClosest(teamName, teams.map(t => t.name));
      stream.write(`  ${s.red('✖')} "${teamName}" isn't one of your synced teams.\n`);
      if (suggestion) stream.write(`  ${s.dim('Did you mean')} ${s.cyan(suggestion)}${s.dim('?')}\n`);
      process.exitCode = 1;
      return;
    }
  } else if (!stream.isTTY) {
    stream.write(`  ${s.red('✖')} No team specified. Pass a team name, or run this interactively to pick one:\n`);
    for (const t of teams) stream.write(`    ${s.cyan(t.name)} ${s.dim(`(${t.role})`)}\n`);
    process.exitCode = 1;
    return;
  } else {
    const items = teams.map(t => ({ label: t.name, sublabel: t.role }));
    const index = await promptSelectFn(items, { stream });
    if (index === null) {
      stream.write(`  ${s.dim('Cancelled.')}\n`);
      return;
    }
    team = teams[index];
  }

  saveProfileRecallTeamIdFn(profileName, team.id, configDir);
  stream.write(`  ${s.green('✔')} Recall notes captured under ${s.bold(s.cyan(profileName))} will target ${s.bold(s.cyan(team.name))}.\n`);
}
