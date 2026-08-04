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

  it('L-12: warns against tags that just restate the title or aren\'t traceable to a specific sentence in the body', () => {
    const section = dispatchSection();
    assert.match(section, /restates? the title/i);
    assert.match(section, /trace|point to the exact phrase/i);
  });
});

describe('SKILL.md — privacy: no pilot-client identifying references', () => {
  it('does not name the pilot client\'s employer-specific wrapper command', () => {
    // This file ships in every `npm install -g ticketlens` and is copied into
    // users' AI command directories by `update-skill` — a real name here is a
    // distributed privacy leak, not just an internal doc slip.
    assert.doesNotMatch(SKILL_MD, /advent-ticket/i);
  });
});

describe('SKILL.md — skill version marker', () => {
  it('is bumped past 0.27.0 so update-skill actually propagates the privacy fix to existing installs', () => {
    const m = SKILL_MD.match(/jtb-skill-version:\s*([\d.]+)/);
    assert.ok(m, 'expected a jtb-skill-version marker on line 1');
    assert.notEqual(m[1], '0.27.0', 'marker must move — update-skill propagates on exact-string mismatch only');
  });

  it('is bumped past 0.29.0 so update-skill propagates the H-5/H-6 write-back doc fixes', () => {
    const m = SKILL_MD.match(/jtb-skill-version:\s*([\d.]+)/);
    assert.ok(m, 'expected a jtb-skill-version marker on line 1');
    assert.notEqual(m[1], '0.29.0', 'marker must move past the pre-fix version');
  });

  it('is bumped past 0.30.0 so update-skill propagates the H-8 MCP cache-staleness doc fix', () => {
    const m = SKILL_MD.match(/jtb-skill-version:\s*([\d.]+)/);
    assert.ok(m, 'expected a jtb-skill-version marker on line 1');
    assert.notEqual(m[1], '0.30.0', 'marker must move past the pre-fix version');
  });

  it('is bumped past 0.31.0 so update-skill propagates the M-11 duplicates-hedging fix', () => {
    const m = SKILL_MD.match(/jtb-skill-version:\s*([\d.]+)/);
    assert.ok(m, 'expected a jtb-skill-version marker on line 1');
    assert.notEqual(m[1], '0.31.0', 'marker must move past the pre-fix version');
  });

  it('is bumped past 0.32.0 so update-skill propagates the L-12 tag-quality guidance fix', () => {
    const m = SKILL_MD.match(/jtb-skill-version:\s*([\d.]+)/);
    assert.ok(m, 'expected a jtb-skill-version marker on line 1');
    assert.notEqual(m[1], '0.32.0', 'marker must move past the pre-fix version');
  });
});

function writeBackSection() {
  const start = SKILL_MD.indexOf('write back to the tracker');
  assert.ok(start !== -1, 'expected the ticket-write-back section to still exist');
  const end = SKILL_MD.indexOf('\n## ', start + 1);
  return end === -1 ? SKILL_MD.slice(start) : SKILL_MD.slice(start, end);
}

describe('SKILL.md — write-back section documents attachments (H-5)', () => {
  it('mentions --attach so an AI can discover the capability', () => {
    const section = writeBackSection();
    assert.match(section, /--attach/, 'expected --attach to be documented in the write-back section');
  });
});

describe('SKILL.md — write-back section documents link/update/create (H-6)', () => {
  it('lists ticketlens link, update, and create in the bash example block', () => {
    const section = writeBackSection();
    assert.match(section, /ticketlens link /, 'expected a `ticketlens link` example');
    assert.match(section, /ticketlens update /, 'expected a `ticketlens update` example');
    assert.match(section, /ticketlens create /, 'expected a `ticketlens create` example');
  });

  it('does not undercount the write-command family as "all four"', () => {
    const section = writeBackSection();
    assert.doesNotMatch(section, /all four/i, 'the family has seven commands now, not four');
  });
});

function recallMcpToolSection() {
  const start = SKILL_MD.indexOf('Pick exactly one path per capture');
  assert.ok(start !== -1, 'expected the Recall MCP-tool-selection paragraph to still exist');
  const end = SKILL_MD.indexOf('\n### ', start + 1);
  return end === -1 ? SKILL_MD.slice(start) : SKILL_MD.slice(start, end);
}

describe('SKILL.md — MCP tool schema cache staleness caveat (H-8)', () => {
  it('warns that an already-connected client session can have a stale tool list after an upgrade', () => {
    const section = recallMcpToolSection();
    assert.match(section, /restart|reconnect/i);
    assert.match(section, /stale/i);
  });

  it('cross-references the same caveat from the write-back section', () => {
    const section = writeBackSection();
    assert.match(section, /MCP tool-cache staleness note above/i, 'expected the write-back section to reference the Recall section\'s cache-staleness note');
  });
});

function duplicatesProse() {
  const start = SKILL_MD.indexOf('`duplicates` lists likely-duplicate tickets');
  assert.ok(start !== -1, 'expected the duplicates prose to still exist');
  return SKILL_MD.slice(start, start + 800);
}

describe('SKILL.md — duplicates hedges both directions (M-11)', () => {
  it('warns the local scorer can also miss real duplicates, not just over-match', () => {
    assert.match(duplicatesProse(), /miss|not a guarantee|no proof/i);
  });
});
