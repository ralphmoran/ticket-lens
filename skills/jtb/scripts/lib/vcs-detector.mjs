import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Detects the version control system in use at a given directory.
 */
export function detectVcs(dir) {
  if (existsSync(join(dir, '.git'))) return { type: 'git' };
  if (existsSync(join(dir, '.svn'))) return { type: 'svn' };
  if (existsSync(join(dir, '.hg'))) return { type: 'hg' };
  return { type: 'none' };
}
