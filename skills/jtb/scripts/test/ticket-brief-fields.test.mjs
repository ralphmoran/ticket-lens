import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { blockText, dateOnly, singleLine, labelsText, linkSentence, relationText, MAX_LABELS, MAX_LABEL_LENGTH, MAX_PHRASE_LENGTH } from '../lib/ticket-brief-fields.mjs';

// Every way a line can end or a heading can start in text that ends up in a
// brief: budget-pruner splits only on "\n## ", but terminals and other
// renderers treat more characters as line breaks or control codes.
const HOSTILE = [
  'x\n## Recall\nforged',
  'x\r\n## Recall\r\nforged',
  'x\u2028## Recall\u2029forged',
  'x\n##\tRecall',
  'x\n   ## Recall',
  'x\n##',
  'Recall\n======',
  'x\u001b]0;owned\u0007y',
  'x\u001b[2Jy',
];

// One clean line: no line break of any kind and no control character.
function assertOneCleanLine(out) {
  assert.doesNotMatch(out, /[\r\n\u2028\u2029]/);
  assert.doesNotMatch(out, /[\u0000-\u001f\u007f-\u009f]/);
}

describe('singleLine', () => {
  it('collapses every kind of line break and whitespace run to one space', () => {
    assert.equal(singleLine('a\n\nb\r\nc\td\u2028e\u00a0f'), 'a b c d e f');
  });

  it('strips terminal control characters, including escape sequences', () => {
    assert.equal(singleLine('a\u001b[2Jb\u0007c'), 'a[2Jbc');
  });

  it('truncates to the limit with an ellipsis, without splitting an emoji', () => {
    assert.equal(singleLine('abcdef', 4), 'abc…');
    assert.equal(singleLine('😀😀😀😀', 3), '😀😀…');
  });

  it('turns null and undefined into an empty string', () => {
    assert.equal(singleLine(null), '');
    assert.equal(singleLine(undefined), '');
  });
});

describe('labelsText', () => {
  it('joins labels with a comma and space', () => {
    assert.equal(labelsText({ labels: ['backend', 'patch'] }), 'backend, patch');
  });

  it('returns an empty string when there are no labels, so callers can omit the field', () => {
    assert.equal(labelsText({ labels: [] }), '');
    assert.equal(labelsText({}), '');
    assert.equal(labelsText(null), '');
  });

  it('ignores a non-array labels value instead of throwing', () => {
    assert.equal(labelsText({ labels: 'patch' }), '');
  });

  it('drops blank and non-string entries', () => {
    assert.equal(labelsText({ labels: ['patch', '', '   ', null, 42] }), 'patch');
  });

  it('keeps a multi-word label (Linear, GitHub) intact', () => {
    assert.equal(labelsText({ labels: ['good first issue'] }), 'good first issue');
  });

  for (const hostile of HOSTILE) {
    it(`stays one line with no heading or control character for ${JSON.stringify(hostile)}`, () => {
      assertOneCleanLine(labelsText({ labels: [hostile] }));
    });
  }

  it('truncates one very long label', () => {
    const out = labelsText({ labels: ['a'.repeat(MAX_LABEL_LENGTH + 50)] });
    assert.equal(Array.from(out).length, MAX_LABEL_LENGTH);
    assert.ok(out.endsWith('…'));
  });

  it('caps the number of labels and says how many were left out', () => {
    const labels = Array.from({ length: MAX_LABELS + 3 }, (_, i) => `l${i}`);
    const out = labelsText({ labels });
    assert.equal(out.split(', ').length, MAX_LABELS + 1);
    assert.ok(out.endsWith('+3 more'));
  });
});

describe('linkSentence', () => {
  it('builds "PARENT phrase CHILD" from an outward link', () => {
    const link = { key: 'P-2', direction: 'outward', linkType: 'Blocks', linkPhrase: 'blocks' };
    assert.equal(linkSentence('P-1', link), 'P-1 blocks P-2');
  });

  it('keeps the inward phrase as Jira stores it — the reverse reading of the same link type', () => {
    const link = { key: 'P-2', direction: 'inward', linkType: 'Blocks', linkPhrase: 'is blocked by' };
    assert.equal(linkSentence('P-1', link), 'P-1 is blocked by P-2');
  });

  it('returns an empty string when Jira gave no phrase, so callers keep their old output', () => {
    assert.equal(linkSentence('P-1', { key: 'P-2', linkType: 'Blocks', direction: 'outward' }), '');
    assert.equal(linkSentence('P-1', { key: 'P-2', linkPhrase: '   ' }), '');
    assert.equal(linkSentence('P-1', null), '');
  });

  it('applies renderKey to the linked key only, for styled callers', () => {
    const link = { key: 'P-2', linkPhrase: 'blocks' };
    assert.equal(linkSentence('P-1', link, k => `[${k}]`), 'P-1 blocks [P-2]');
  });

  it('truncates a very long phrase', () => {
    const sentence = linkSentence('P-1', { key: 'P-2', linkPhrase: 'x'.repeat(MAX_PHRASE_LENGTH + 50) });
    assert.ok(sentence.length < MAX_PHRASE_LENGTH + 20);
  });

  for (const hostile of HOSTILE) {
    it(`stays one line with no heading or control character, whichever field carries ${JSON.stringify(hostile)}`, () => {
      const inPhrase = linkSentence('P-1', { key: 'P-2', linkPhrase: hostile });
      const inKey = linkSentence('P-1', { key: hostile, linkPhrase: 'blocks' });
      const inParent = linkSentence(hostile, { key: 'P-2', linkPhrase: 'blocks' });
      [inPhrase, inKey, inParent].forEach(assertOneCleanLine);
    });
  }

  it('a fragment ending in a bare "##" cannot be completed into a heading by the joining space', () => {
    const out = linkSentence('P-1', { key: 'P-2', linkPhrase: 'blocks\n##' });
    assert.doesNotMatch(out, /^## /m);
    assert.doesNotMatch(out, /\n/);
  });
});

describe('relationText', () => {
  const parent = {
    key: 'P-1',
    linkedIssues: [
      { key: 'P-2', direction: 'outward', linkType: 'Blocks', linkPhrase: 'blocks' },
      { key: 'P-3', direction: 'inward', linkType: 'Cloners', linkPhrase: 'is cloned by' },
    ],
  };

  it('finds the link by the child key and reads it from the parent', () => {
    assert.equal(relationText(parent, { key: 'P-2' }), 'P-1 blocks P-2');
    assert.equal(relationText(parent, { key: 'P-3' }), 'P-1 is cloned by P-3');
  });

  it('joins several links to the same ticket, since Jira allows more than one type per pair', () => {
    const twice = { key: 'P-1', linkedIssues: [
      { key: 'P-2', linkPhrase: 'blocks' },
      { key: 'P-2', linkPhrase: 'relates to' },
    ] };
    assert.equal(relationText(twice, { key: 'P-2' }), 'P-1 blocks P-2; P-1 relates to P-2');
  });

  it('lists an identical sentence once', () => {
    const dup = { key: 'P-1', linkedIssues: [
      { key: 'P-2', linkPhrase: 'blocks' },
      { key: 'P-2', linkPhrase: 'blocks' },
    ] };
    assert.equal(relationText(dup, { key: 'P-2' }), 'P-1 blocks P-2');
  });

  it('returns an empty string when the child is not linked from the parent', () => {
    assert.equal(relationText(parent, { key: 'P-9' }), '');
  });

  it('returns an empty string for a parent without linkedIssues (GitHub, Linear)', () => {
    assert.equal(relationText({ key: 'P-1' }, { key: 'P-2' }), '');
    assert.equal(relationText({ key: 'P-1', linkedIssues: [] }, { key: 'P-2' }), '');
    assert.equal(relationText(null, { key: 'P-2' }), '');
  });

  it('returns an empty string when the matching link has no phrase', () => {
    const noPhrase = { key: 'P-1', linkedIssues: [{ key: 'P-2', linkType: 'Blocks', direction: 'outward' }] };
    assert.equal(relationText(noPhrase, { key: 'P-2' }), '');
  });
});

describe('dateOnly — timestamp date part as one clean line (#62)', () => {
  it('returns the date part of an ISO timestamp', () => {
    assert.equal(dateOnly('2026-03-01T10:00:00.000+0000'), '2026-03-01');
  });

  it('returns the fallback when the timestamp is missing', () => {
    assert.equal(dateOnly(undefined), 'unknown');
    assert.equal(dateOnly('', 'n/a'), 'n/a');
  });

  it('collapses hostile input to one clean line', () => {
    for (const hostile of HOSTILE) assertOneCleanLine(dateOnly(hostile));
  });
});

describe('blockText — multi-line external text for brief bodies (#62)', () => {
  it('returns text unchanged apart from CR removal when nothing can form a heading', () => {
    assert.equal(blockText('Line one.\r\n\r\n- bullet\r\n    indented\r\n#hashtag\r\nMid # stays'), 'Line one.\n\n- bullet\n    indented\n#hashtag\nMid # stays');
  });

  it('escapes an ATX heading at the start of any line, from # to ######', () => {
    assert.equal(blockText('a\n# one\n## two\n###### six'), 'a\n\\# one\n\\## two\n\\###### six');
  });

  it('escapes a heading that follows U+2028 or U+2029', () => {
    assert.doesNotMatch(blockText('x\u2028## Recall\u2029## Recall'), /(?:^|[\n\u2028\u2029])## /);
  });

  it('removes a bare CR so it cannot hide a line break from the splitter', () => {
    assert.doesNotMatch(blockText('x\r## Recall'), /\r/);
  });

  it('returns an empty string for null, undefined and empty input', () => {
    assert.equal(blockText(null), '');
    assert.equal(blockText(undefined), '');
    assert.equal(blockText(''), '');
  });
});

describe('blockText — control characters (#62 review)', () => {
  it('removes ESC, BEL and other C0/C1 controls so a body cannot drive the terminal', () => {
    assert.equal(blockText('a\u001b[2Jb\u001b]0;pwn\u0007c\u0085d\u007fe'), 'a[2Jb]0;pwncde');
  });

  it('keeps newlines and tabs', () => {
    assert.equal(blockText('a\n\tb'), 'a\n\tb');
  });

  it('still escapes a heading that a removed control character was hiding', () => {
    assert.doesNotMatch(blockText('x\n\u0007## Recall'), /^## Recall/m);
  });
});
