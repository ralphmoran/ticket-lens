import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Content-presence checks only — not a behavioral test. There is no way to
 * unit-test "does an AI actually choose a good tag from this guidance";
 * this only guards against the guidance being accidentally deleted, mangled,
 * or silently reverted to the old bare `--tags=a,b` example with no
 * quality instruction.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_MD = readFileSync(join(__dirname, '..', '..', 'SKILL.md'), 'utf8');

function dispatchSection() {
  const start = SKILL_MD.indexOf('How to dispatch the call');
  assert.ok(start !== -1, 'expected the "How to dispatch the call" section to still exist');
  return SKILL_MD.slice(start, start + 2000);
}

describe('SKILL.md — Recall tag-quality guidance', () => {
  it('instructs deriving tags from the note\'s actual content, not the project name or generic category words', () => {
    const section = dispatchSection();
    assert.match(section, /content|body/i);
    assert.match(section, /(never|not|don't).*(project name|generic)/i);
  });
});
