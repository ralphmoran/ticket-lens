import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkNoteStructure, checkWordCount, WORD_LIMITS } from '../lib/note-structural-check.mjs';

describe('checkNoteStructure — empty or whitespace-only body', () => {
  test('rejects an empty body', () => {
    const result = checkNoteStructure({ body: '' });
    assert.equal(result.rejected, true);
    assert.match(result.reason, /empty/i);
  });

  test('rejects a whitespace-only body', () => {
    const result = checkNoteStructure({ body: '   \n\t  ' });
    assert.equal(result.rejected, true);
    assert.match(result.reason, /empty/i);
  });
});

describe('checkNoteStructure — placeholder bodies', () => {
  const placeholders = ['todo', 'TODO', 'test', 'n/a', 'na', 'tbd', 'wip', 'placeholder', 'xxx', 'asdf', 'fixme', 'fix me', '.', '-'];
  for (const p of placeholders) {
    test(`rejects the placeholder body "${p}"`, () => {
      const result = checkNoteStructure({ body: p });
      assert.equal(result.rejected, true);
      assert.match(result.reason, /placeholder/i);
    });
  }

  test('placeholder match ignores surrounding whitespace', () => {
    const result = checkNoteStructure({ body: '  todo  ' });
    assert.equal(result.rejected, true);
  });
});

describe('checkNoteStructure — too-short body', () => {
  test('rejects a body under 10 characters that is not an exact placeholder match', () => {
    const result = checkNoteStructure({ body: 'short' });
    assert.equal(result.rejected, true);
    assert.match(result.reason, /short|minimum/i);
  });
});

describe('checkNoteStructure — accepts real content', () => {
  test('accepts a normal note body', () => {
    const result = checkNoteStructure({ body: 'Refresh tokens expire silently after 30 days without a warning event.' });
    assert.equal(result.rejected, false);
    assert.equal(result.reason, null);
  });

  test('accepts the existing test suite default fixture body unchanged (regression lock)', () => {
    const result = checkNoteStructure({ body: 'Body text.' });
    assert.equal(result.rejected, false);
  });

  test('does not evaluate title or ticket — only body is in scope', () => {
    const result = checkNoteStructure({ body: 'A perfectly fine note body with real content in it.' });
    assert.equal(result.rejected, false);
  });
});

describe('WORD_LIMITS — strictness scale (backlog #18)', () => {
  test('exposes the three strictness levels mapped to their word ceiling', () => {
    assert.deepEqual(WORD_LIMITS, { strict: 20, balanced: 30, loose: 50 });
  });
});

function words(n) {
  return Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
}

describe('checkWordCount — under and at the limit', () => {
  test('a body under the limit produces no warning', () => {
    const result = checkWordCount({ body: words(10) }, { maxWords: 30 });
    assert.deepEqual(result.warnings, []);
  });

  test('a body exactly at the limit produces no warning (boundary is inclusive)', () => {
    const result = checkWordCount({ body: words(30) }, { maxWords: 30 });
    assert.deepEqual(result.warnings, []);
  });

  test('an empty body produces no warning', () => {
    const result = checkWordCount({ body: '' }, { maxWords: 30 });
    assert.deepEqual(result.warnings, []);
  });

  test('a whitespace-only body produces no warning', () => {
    const result = checkWordCount({ body: '   \n\t  ' }, { maxWords: 30 });
    assert.deepEqual(result.warnings, []);
  });

  test('an omitted title/body defaults to empty and produces no warning', () => {
    const result = checkWordCount({}, { maxWords: 30 });
    assert.deepEqual(result.warnings, []);
  });
});

describe('checkWordCount — over the limit', () => {
  test('a body one word over the limit produces exactly one warning, mentioning the count and the limit', () => {
    const result = checkWordCount({ body: words(31) }, { maxWords: 30 });
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /\bbody\b/i);
    assert.match(result.warnings[0], /31/);
    assert.match(result.warnings[0], /30/);
  });

  test('a title over the limit produces exactly one warning, mentioning "title"', () => {
    const result = checkWordCount({ title: words(31) }, { maxWords: 30 });
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /\btitle\b/i);
  });

  test('title and body both over the limit produce two independent warnings', () => {
    const result = checkWordCount({ title: words(25), body: words(40) }, { maxWords: 20 });
    assert.equal(result.warnings.length, 2);
  });

  test('multiple internal spaces and newlines collapse to a single word-count boundary, not inflating the count', () => {
    const spaced = words(30).replace(/ /g, '   \n  ');
    const result = checkWordCount({ body: spaced }, { maxWords: 30 });
    assert.deepEqual(result.warnings, []);
  });

  test('defaults maxWords to WORD_LIMITS.balanced when no strictness option is given', () => {
    const result = checkWordCount({ body: words(31) });
    assert.equal(result.warnings.length, 1);
  });
});
