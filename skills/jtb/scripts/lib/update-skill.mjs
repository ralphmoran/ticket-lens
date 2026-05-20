/**
 * update-skill — copies SKILL.md to known AI assistant command directories.
 *
 * Usage:
 *   ticketlens update-skill                   # update all detected installs
 *   ticketlens update-skill --dry-run         # show what would change, no writes
 *   ticketlens update-skill --path=/some/dir  # write to a custom target directory
 *   ticketlens update-skill --quiet           # suppress non-error output
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_SRC = join(__dirname, '..', '..', 'SKILL.md');

const HOME = homedir();

const DEFAULT_TARGETS = [
  { label: 'Claude Code',        path: join(HOME, '.claude',      'commands') },
  { label: 'Claude Code (work)', path: join(HOME, '.claude-work', 'commands') },
  { label: 'Gemini CLI',         path: join(HOME, '.gemini',      'commands') },
  { label: 'Copilot CLI',        path: join(HOME, '.copilot-cli', 'commands') },
];

function skillVersion(filePath) {
  try {
    const line = readFileSync(filePath, 'utf8').split('\n')[0];
    const m = line.match(/jtb-skill-version:\s*([\d.]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export async function updateSkill(args = []) {
  const dryRun  = args.includes('--dry-run');
  const quiet   = args.includes('--quiet');
  const pathArg = args.find(a => a.startsWith('--path='));

  const log = (...msg) => { if (!quiet) process.stdout.write(msg.join(' ') + '\n'); };
  const err = (...msg) => process.stderr.write(msg.join(' ') + '\n');

  if (!existsSync(SKILL_SRC)) {
    err(`✖ SKILL.md not found at ${SKILL_SRC}`);
    err('  Reinstall TicketLens: npm install -g ticketlens@latest');
    process.exitCode = 1;
    return;
  }

  const srcVersion = skillVersion(SKILL_SRC) ?? 'unknown';
  if (dryRun) log(`Dry run — skill source: v${srcVersion} (${SKILL_SRC})\n`);

  let targets;
  if (pathArg) {
    const dir = pathArg.slice('--path='.length);
    targets = [{ label: 'Custom path', path: dir }];
  } else {
    targets = DEFAULT_TARGETS;
  }

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const { label, path: dir } of targets) {
    const dest = join(dir, 'jtb.md');

    if (!existsSync(dir)) { notFound++; continue; }
    if (!existsSync(dest)) { notFound++; continue; }

    const destVersion = skillVersion(dest);

    if (!dryRun && destVersion === srcVersion) {
      log(`  ✔ ${label}: already at v${srcVersion}`);
      skipped++;
      continue;
    }

    if (dryRun) {
      const fromVer = destVersion ?? 'unversioned';
      log(`  → ${label}: ${dest}`);
      log(`    ${fromVer} → ${srcVersion} (would update)`);
      continue;
    }

    try {
      copyFileSync(SKILL_SRC, dest);
      const fromVer = destVersion ?? 'unversioned';
      log(`  ✔ ${label}: updated v${fromVer} → v${srcVersion}`);
      updated++;
    } catch (copyErr) {
      err(`  ✖ ${label}: ${copyErr.message}`);
    }
  }

  if (!dryRun) {
    if (updated === 0 && notFound === targets.length) {
      log('\n  /jtb is not installed in any known AI assistant.');
      log('\n  To install for Claude Code:');
      log('    mkdir -p ~/.claude/commands');
      log(`    cp "${SKILL_SRC}" ~/.claude/commands/jtb.md`);
      log('\n  Then restart your Claude Code session and use /jtb TICKET-KEY.');
      return;
    }
    if (updated > 0) {
      log(`\n  ${updated} installation(s) updated to v${srcVersion}.`);
      log('  Restart your AI assistant session to pick up the new skill.');
    }
    if (skipped > 0 && !quiet) {
      log(`  ${skipped} installation(s) already up to date.`);
    }
  }
}
