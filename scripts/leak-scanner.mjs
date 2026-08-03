import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This module's own resolved path — its BANNED_PATTERNS regex literals
// necessarily contain the banned substrings as source text, so it must
// exclude itself from any scan or it would permanently flag itself as a
// leak. Exposed as a parameter (not hardcoded in scanForLeaks) so tests can
// verify the exclusion is path-exact, not a basename match that could also
// skip an unrelated shipped file that happens to share this name.
const SELF_PATH = resolve(fileURLToPath(import.meta.url));

// Files npm ships in every tarball regardless of package.json's `files`
// list (npm always includes these three, unconditionally).
export const ALWAYS_SHIPPED = ['package.json', 'README.md', 'LICENSE'];

export const BANNED_PATTERNS = [
  // Not an English word — safe to match bare, without requiring the "-NNNN" suffix.
  { name: 'Advent Jira ticket prefix', pattern: /\bECNT\b/i },
  // "ASAP" is ordinary English; only match the ticket-key shape to avoid false positives.
  { name: 'ASAP gateway ticket prefix', pattern: /\bASAP-\d+\b/i },
  { name: 'pilot-client wrapper command name', pattern: /advent-ticket/i },
  // Case-sensitive: "Advent" (proper noun, the employer) vs. lowercase "advent"
  // (ordinary word, e.g. "the advent of AI-assisted development").
  { name: 'employer name', pattern: /\bAdvent\b/ },
];

function isDirEntry(absPath, entry) {
  return entry.endsWith('/') || statSync(absPath).isDirectory();
}

function collectFiles(root, entry) {
  const absPath = join(root, entry);
  if (!existsSync(absPath)) return [];
  if (!isDirEntry(absPath, entry)) return [absPath];

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

function findViolations(root, absPath) {
  const relPath = relative(root, absPath);
  let content;
  try {
    content = readFileSync(absPath, 'utf8');
  } catch (err) {
    return [`${relPath} — could not read file to scan for leaks: ${err.message}`];
  }

  const violations = [];
  content.split('\n').forEach((line, index) => {
    for (const { name, pattern } of BANNED_PATTERNS) {
      if (pattern.test(line)) {
        violations.push(`${relPath}:${index + 1} — ${name} (matched ${pattern})`);
      }
    }
  });

  return violations;
}

/**
 * Scans every file npm actually ships — package.json's `files` list plus
 * the README/LICENSE/package.json npm always includes regardless of `files`
 * — for employer/pilot-client identifying patterns.
 * @param {string} root  absolute path to the package root
 * @param {string[]} filesList  package.json's `files` array
 * @param {string} [selfPath]  path to exclude from the scan (defaults to this module's own path)
 * @returns {string[]} violation descriptions ("path:line — name (matched /re/)"), empty if clean
 */
export function scanForLeaks(root, filesList, selfPath = SELF_PATH) {
  const entries = [...new Set([...filesList, ...ALWAYS_SHIPPED])];

  return entries
    .flatMap(entry => collectFiles(root, entry))
    .filter(absPath => resolve(absPath) !== resolve(selfPath))
    .flatMap(absPath => findViolations(root, absPath));
}
