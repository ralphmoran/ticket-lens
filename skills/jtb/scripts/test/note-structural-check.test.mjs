import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkNoteStructure } from '../lib/note-structural-check.mjs';

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
