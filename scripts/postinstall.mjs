#!/usr/bin/env node
/**
 * Runs automatically after `npm install -g ticketlens`.
 * Copies the latest SKILL.md into every detected AI assistant command directory.
 * Silent on failure — never breaks the install.
 */

import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_SRC = join(__dirname, '..', 'skills', 'jtb', 'SKILL.md');

if (!existsSync(SKILL_SRC)) process.exit(0);

const HOME = homedir();

// Known command directories per AI assistant.
// Each entry: { label, path } — path must exist and contain jtb.md to be updated.
const TARGETS = [
  { label: 'Claude Code',        path: join(HOME, '.claude',      'commands', 'jtb.md') },
  { label: 'Claude Code (work)', path: join(HOME, '.claude-work', 'commands', 'jtb.md') },
  { label: 'Gemini CLI',         path: join(HOME, '.gemini',      'commands', 'jtb.md') },
  { label: 'Copilot CLI',        path: join(HOME, '.copilot-cli', 'commands', 'jtb.md') },
];

function skillVersion(filePath) {
  try {
    const line = readFileSync(filePath, 'utf8').split('\n')[0];
    const m = line.match(/jtb-skill-version:\s*([\d.]+)/);
    return m ? m[1] : 'unknown';
  } catch {
    return 'unknown';
  }
}

let updated = 0;
let skipped = 0;

for (const { label, path } of TARGETS) {
  if (!existsSync(path)) { skipped++; continue; }
  try {
    const before = skillVersion(path);
    copyFileSync(SKILL_SRC, path);
    const after = skillVersion(SKILL_SRC);
    if (before === after) {
      console.log(`  ✔ ${label}: already at v${after}`);
    } else {
      console.log(`  ✔ ${label}: updated v${before} → v${after}`);
    }
    updated++;
  } catch (err) {
    console.warn(`  ⚠ ${label}: could not update — ${err.message}`);
  }
}

if (updated === 0 && skipped === TARGETS.length) {
  console.log('  ℹ /jtb skill not installed in any known location.');
  console.log('    To install: ticketlens update-skill');
}
