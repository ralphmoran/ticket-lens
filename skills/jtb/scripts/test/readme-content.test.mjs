import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Content-presence checks against the published README.md — not behavioral
 * tests. These guard the 2026-08-01 audit's M-7/M-8/M-9/M-11 findings against
 * silent regression (badge creeping back, TOC deleted again, etc.).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const README = readFileSync(join(__dirname, '..', '..', '..', '..', 'README.md'), 'utf8');

function section(headerText) {
  const start = README.indexOf(headerText);
  assert.ok(start !== -1, `expected to find "${headerText}" in README.md`);
  const end = README.indexOf('\n### ', start + 1);
  return end === -1 ? README.slice(start) : README.slice(start, end);
}

function proTierExampleBlock() {
  const sectionStart = README.indexOf('### Pro — $9/mo');
  assert.ok(sectionStart !== -1, 'expected the Pro tier section to still exist');
  const start = README.indexOf('```bash', sectionStart);
  assert.ok(start !== -1, 'expected a bash example block in the Pro tier section');
  const end = README.indexOf('```', start + 7);
  return README.slice(start, end);
}

describe('README — M-7 free commands are not mis-badged as Pro', () => {
  it('install-hooks is not badged [Pro] or described as requiring a license', () => {
    const installHooksLines = README.split('\n').filter((l) => l.includes('install-hooks'));
    assert.ok(installHooksLines.length > 0);
    for (const line of installHooksLines) {
      assert.doesNotMatch(line, /\[Pro\]/, `unexpected [Pro] badge: ${line}`);
    }
    assert.doesNotMatch(section('### Git Hook'), /Requires a Pro license/i);
  });

  it('ticketlens pr <TICKET-KEY> is not badged [Pro] or described as requiring a license', () => {
    const prLines = README.split('\n').filter((l) => /ticketlens pr </.test(l));
    assert.ok(prLines.length > 0);
    for (const line of prLines) {
      assert.doesNotMatch(line, /\[Pro\]/, `unexpected [Pro] badge: ${line}`);
    }
    assert.doesNotMatch(section('### PR Description'), /Requires a Pro license/i);
  });

  it('the Pro tier showcase\'s bash example no longer lists the free triage --stale flag', () => {
    assert.doesNotMatch(proTierExampleBlock(), /triage --stale/);
  });
});

const WRITE_BACK_HEADING = '### Comment, Transition, Assign, Duplicates, Link, Update, Create & Worklog';

describe('README — M-8 documents --attach for comment/create', () => {
  it('the write-back section mentions --attach', () => {
    assert.match(section(WRITE_BACK_HEADING), /--attach/);
  });
});

describe('README — worklog is documented (ROADMAP 56)', () => {
  it('the write-back section shows preview and --confirm examples and points at worklog --help', () => {
    const body = section(WRITE_BACK_HEADING);
    assert.match(body, /ticketlens worklog \S+=\S+ +#[^\n]*[Pp]review/);
    assert.match(body, /ticketlens worklog [^\n]*--confirm/);
    assert.match(body, /ticketlens worklog --help/);
  });

  it('states Jira-only, hours/minutes only, and the confirm-or-preview rule', () => {
    const body = section(WRITE_BACK_HEADING);
    assert.match(body, /no worklog API/i);
    assert.match(body, /hours and minutes only/i);
    assert.match(body, /Nothing is written without `--confirm`/);
  });

  it('the Contents TOC links to the renamed write-back heading', () => {
    assert.match(README, /\]\(#comment-transition-assign-duplicates-link-update-create--worklog\)/);
  });

  it('every command block that lists the write family also lists worklog --help or a worklog example', () => {
    assert.ok((README.match(/ticketlens worklog /g) ?? []).length >= 6, 'expected worklog in all three example blocks');
  });

  it('Recently shipped lists Worklog', () => {
    const start = README.indexOf('Recently shipped:');
    assert.notEqual(start, -1);
    assert.match(README.slice(start, start + 600), /\*\*Worklog\*\*/);
  });
});

describe('README — M-9 Contents TOC exists', () => {
  it('has a ## Contents section linking to Commands', () => {
    const start = README.indexOf('## Contents');
    assert.notEqual(start, -1, 'expected a ## Contents section');
    const end = README.indexOf('\n## ', start + 1);
    const toc = README.slice(start, end);
    assert.match(toc, /#commands/);
  });
});

describe('README — M-11 duplicates hedges both directions', () => {
  it('warns that an empty result is not a guaranteed absence, not just that matches can be imprecise', () => {
    const start = README.indexOf('`ticketlens duplicates` is read-only');
    assert.ok(start !== -1, 'expected the duplicates command prose to still exist');
    const prose = README.slice(start, start + 800);
    assert.match(prose, /miss|not a guarantee|not a confirmed absence/i);
  });
});
