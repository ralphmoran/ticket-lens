import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { groupCommitsByTicket, assembleStandup, styleStandupMd, VALID_STANDUP_FLAG } from '../lib/standup-assembler.mjs';
import { createStyler } from '../lib/ansi.mjs';

describe('groupCommitsByTicket', () => {
  it('returns empty map for empty input', () => {
    const groups = groupCommitsByTicket([]);
    assert.equal(groups.size, 0);
  });

  it('groups commit under its ticket key', () => {
    const groups = groupCommitsByTicket(['abc1234 feat: PROJ-123 add login']);
    assert.ok(groups.has('PROJ-123'));
    assert.deepEqual(groups.get('PROJ-123'), ['abc1234 feat: PROJ-123 add login']);
  });

  it('groups commit under __no_key__ when no ticket key present', () => {
    const groups = groupCommitsByTicket(['abc1234 chore: bump deps']);
    assert.ok(groups.has('__no_key__'));
    assert.equal(groups.get('__no_key__').length, 1);
  });

  it('groups multiple commits under the same ticket key', () => {
    const groups = groupCommitsByTicket([
      'abc1234 feat: PROJ-123 add login',
      'def5678 test: PROJ-123 login tests',
    ]);
    assert.equal(groups.get('PROJ-123').length, 2);
  });

  it('assigns commit to all ticket keys it references', () => {
    const groups = groupCommitsByTicket(['abc1234 feat: PROJ-123 and PROJ-456 linked']);
    assert.ok(groups.has('PROJ-123'));
    assert.ok(groups.has('PROJ-456'));
  });

  it('deduplicates: same commit referencing same key twice appears once', () => {
    const groups = groupCommitsByTicket(['abc1234 feat: PROJ-123 PROJ-123 duplicate mention']);
    assert.equal(groups.get('PROJ-123').length, 1);
  });

  it('filters empty and whitespace-only lines', () => {
    const groups = groupCommitsByTicket(['', '   ', 'abc1234 feat: PROJ-123 add login']);
    assert.equal(groups.size, 1);
    assert.ok(groups.has('PROJ-123'));
  });

  it('handles mixed keyed and unkeyed commits', () => {
    const groups = groupCommitsByTicket([
      'abc1234 feat: PROJ-123 add login',
      'def5678 chore: bump deps',
    ]);
    assert.ok(groups.has('PROJ-123'));
    assert.ok(groups.has('__no_key__'));
  });
});

describe('assembleStandup — standup format', () => {
  it('returns a "No commits" message for empty groups', () => {
    const md = assembleStandup(new Map(), [], { since: '24', format: 'standup' });
    assert.ok(md.includes('No commits'), `Expected "No commits". Got: "${md}"`);
  });

  it('includes ticket key as bold heading', () => {
    const groups = new Map([['PROJ-123', ['abc1234 feat: PROJ-123 add login']]]);
    const md = assembleStandup(groups, [], { format: 'standup' });
    assert.ok(md.includes('**PROJ-123**'), `Expected **PROJ-123** in standup output`);
  });

  it('includes ticket summary when ticket data provided', () => {
    const groups = new Map([['PROJ-123', ['abc1234 feat: PROJ-123 add login']]]);
    const tickets = [{ key: 'PROJ-123', fields: { summary: 'Add login flow' } }];
    const md = assembleStandup(groups, tickets, { format: 'standup' });
    assert.ok(md.includes('Add login flow'), `Expected ticket summary in output`);
  });

  it('shows commit count in heading', () => {
    const groups = new Map([['PROJ-123', ['abc1234 commit 1', 'def5678 commit 2']]]);
    const md = assembleStandup(groups, [], { format: 'standup' });
    assert.ok(md.includes('2 commits'), `Expected "2 commits". Got: "${md}"`);
  });

  it('uses singular "commit" for one commit', () => {
    const groups = new Map([['PROJ-123', ['abc1234 only one']]]);
    const md = assembleStandup(groups, [], { format: 'standup' });
    assert.ok(md.includes('1 commit)'), `Expected "1 commit)". Got: "${md}"`);
    assert.ok(!md.includes('1 commits'), 'Should not say "1 commits"');
  });

  it('groups no-key commits under [No ticket key] section', () => {
    const groups = new Map([
      ['PROJ-123', ['abc1234 feat: PROJ-123']],
      ['__no_key__', ['def5678 chore: bump deps']],
    ]);
    const md = assembleStandup(groups, [], { format: 'standup' });
    assert.ok(md.includes('[No ticket key]'), `Expected [No ticket key] section. Got: "${md}"`);
    assert.ok(md.includes('chore: bump deps'), `Expected no-key commit in output`);
  });

  it('includes the standup date header', () => {
    const groups = new Map([['PROJ-123', ['abc1234 feat: PROJ-123']]]);
    const md = assembleStandup(groups, [], { format: 'standup' });
    assert.ok(md.startsWith('## Standup'), `Expected "## Standup" header. Got start: "${md.slice(0, 30)}"`);
  });

  it('defaults to standup format when format option omitted', () => {
    const groups = new Map([['PROJ-123', ['abc1234 feat: PROJ-123']]]);
    const md = assembleStandup(groups, []);
    assert.ok(md.includes('## Standup'));
  });

  it('uses singular "hour" for since=1 in empty-commit message', () => {
    const md = assembleStandup(new Map(), [], { since: '1', format: 'standup' });
    assert.ok(md.includes('1 hour.'), `Expected "1 hour." not "1 hours.". Got: "${md}"`);
    assert.ok(!md.includes('1 hours'), 'Should not say "1 hours"');
  });

  it('uses clean phrasing for non-numeric since values in empty-commit message', () => {
    const md = assembleStandup(new Map(), [], { since: 'yesterday', format: 'standup' });
    assert.ok(md.includes('yesterday.'), `Expected "yesterday." in output. Got: "${md}"`);
    assert.ok(!md.includes('yesterday hours'), 'Should not say "yesterday hours"');
  });

  it('throws for unknown format value', () => {
    const groups = new Map([['PROJ-123', ['abc1234 feat: PROJ-123']]]);
    assert.throws(
      () => assembleStandup(groups, [], { format: 'invalid' }),
      /Unknown standup format/
    );
  });

  it('indents each commit with two spaces', () => {
    const groups = new Map([['PROJ-123', ['abc1234 feat: PROJ-123 add login']]]);
    const md = assembleStandup(groups, [], { format: 'standup' });
    assert.ok(md.includes('  abc1234 feat: PROJ-123 add login'), `Expected indented commit. Got: "${md}"`);
  });
});

describe('assembleStandup — pr format', () => {
  it('outputs "## What changed" header', () => {
    const groups = new Map([['PROJ-123', ['abc1234 feat: PROJ-123']]]);
    const md = assembleStandup(groups, [], { format: 'pr' });
    assert.ok(md.includes('## What changed'), `Expected "## What changed". Got: "${md}"`);
  });

  it('lists ticket keys with summaries when tickets provided', () => {
    const groups = new Map([['PROJ-123', ['abc1234 feat: PROJ-123']]]);
    const tickets = [{ key: 'PROJ-123', fields: { summary: 'Fix login' } }];
    const md = assembleStandup(groups, tickets, { format: 'pr' });
    assert.ok(md.includes('PROJ-123: Fix login'), `Expected "PROJ-123: Fix login". Got: "${md}"`);
  });

  it('lists ticket key alone when no ticket data available', () => {
    const groups = new Map([['PROJ-123', ['abc1234 feat: PROJ-123']]]);
    const md = assembleStandup(groups, [], { format: 'pr' });
    assert.ok(md.includes('- PROJ-123'), `Expected "- PROJ-123". Got: "${md}"`);
  });

  it('outputs "## Commits" section with all commits', () => {
    const groups = new Map([['PROJ-123', ['abc1234 feat: PROJ-123']]]);
    const md = assembleStandup(groups, [], { format: 'pr' });
    assert.ok(md.includes('## Commits'), `Expected "## Commits". Got: "${md}"`);
    assert.ok(md.includes('abc1234'), `Expected commit sha in output`);
  });

  it('deduplicates commits shared across ticket groups', () => {
    const sharedCommit = 'abc1234 feat: PROJ-123 and PROJ-456';
    const groups = new Map([
      ['PROJ-123', [sharedCommit]],
      ['PROJ-456', [sharedCommit]],
    ]);
    const md = assembleStandup(groups, [], { format: 'pr' });
    const count = (md.match(/abc1234/g) ?? []).length;
    assert.equal(count, 1, `Shared commit should appear once in ## Commits. Got count: ${count}`);
  });

  it('handles empty groups gracefully', () => {
    const md = assembleStandup(new Map(), [], { format: 'pr' });
    assert.ok(typeof md === 'string');
    assert.ok(md.includes('## What changed'));
  });
});

describe('VALID_STANDUP_FLAG', () => {
  it('accepts --since=24', () => assert.ok(VALID_STANDUP_FLAG.test('--since=24')));
  it('accepts --since=48', () => assert.ok(VALID_STANDUP_FLAG.test('--since=48')));
  it('accepts --since=2024-01-15', () => assert.ok(VALID_STANDUP_FLAG.test('--since=2024-01-15')));
  it('accepts --since=yesterday', () => assert.ok(VALID_STANDUP_FLAG.test('--since=yesterday')));
  it('accepts --format=standup', () => assert.ok(VALID_STANDUP_FLAG.test('--format=standup')));
  it('accepts --format=pr', () => assert.ok(VALID_STANDUP_FLAG.test('--format=pr')));
  it('accepts --profile=advent', () => assert.ok(VALID_STANDUP_FLAG.test('--profile=advent')));
  it('accepts --plain', () => assert.ok(VALID_STANDUP_FLAG.test('--plain')));
  it('rejects --format=invalid', () => assert.ok(!VALID_STANDUP_FLAG.test('--format=invalid')));
  it('rejects --since-24 (typo with dash)', () => assert.ok(!VALID_STANDUP_FLAG.test('--since-24')));
  it('rejects --unknown=foo', () => assert.ok(!VALID_STANDUP_FLAG.test('--unknown=foo')));
  it('rejects bare --format without value', () => assert.ok(!VALID_STANDUP_FLAG.test('--format')));
});

describe('styleStandupMd', () => {
  it('returns plain string unchanged when styler disabled', () => {
    const s = createStyler({ isTTY: false });
    const md = '## Standup — Mon\n\n**PROJ-123** (1 commit)\n  abc1234 feat: thing';
    assert.equal(styleStandupMd(md, s), md);
  });

  it('does not throw when styler is enabled', () => {
    const s = createStyler({ isTTY: true });
    const md = '## Standup — Mon\n\n**PROJ-123** (1 commit)\n  abc1234 feat: thing';
    assert.doesNotThrow(() => styleStandupMd(md, s));
  });

  it('returns a non-empty string when styling enabled', () => {
    const s = createStyler({ isTTY: true });
    const md = '## Standup — Mon\n\n**PROJ-123** (1 commit)\n  abc1234 feat: thing';
    const result = styleStandupMd(md, s);
    assert.ok(result.length > 0);
  });
});
