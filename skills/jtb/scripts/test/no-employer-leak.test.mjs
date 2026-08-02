import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Content-presence check across every file npm actually ships (package.json's
 * `files` list), not just the two files a human happened to catch by hand
 * (CR-2 in SKILL.md, H-4 in profile-picker.mjs). A real employer/pilot-client
 * reference in any shipped file is a privacy leak distributed to every
 * `npm install -g ticketlens`. See docs/audits/2026-08-01-full-feature-audit.md.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..', '..');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

const BANNED_PATTERNS = [
  { name: 'Advent Jira ticket prefix', pattern: /ECNT-/i },
  { name: 'ASAP gateway ticket prefix', pattern: /ASAP-/i },
  { name: 'pilot-client wrapper command name', pattern: /advent-ticket/i },
  { name: 'employer name', pattern: /\badvent\b/i },
];

function collectFiles(entry) {
  const absPath = join(ROOT, entry);
  if (!entry.endsWith('/')) return [absPath];

  const files = [];
  const walk = (dir) => {
    for (const dirent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, dirent.name);
      if (dirent.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(absPath);
  return files;
}

function findViolations(absPath) {
  const relPath = relative(ROOT, absPath);
  const lines = readFileSync(absPath, 'utf8').split('\n');
  const violations = [];

  lines.forEach((line, index) => {
    for (const { name, pattern } of BANNED_PATTERNS) {
      if (pattern.test(line)) {
        violations.push(`${relPath}:${index + 1} — ${name} (matched ${pattern})`);
      }
    }
  });

  return violations;
}

describe('npm package contents — no employer/pilot-client leaks', () => {
  it('contains none of the banned employer-identifying patterns in any shipped file', () => {
    const shippedFiles = PKG.files.flatMap(collectFiles);
    const violations = shippedFiles.flatMap(findViolations);

    assert.deepEqual(violations, []);
  });
});
