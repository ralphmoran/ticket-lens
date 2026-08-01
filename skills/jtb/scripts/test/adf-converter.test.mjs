import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { adfToText, textToAdf, buildMediaNode, appendNodesToAdf } from '../lib/adf-converter.mjs';

describe('adfToText', () => {
  it('returns plain string unchanged', () => {
    assert.equal(adfToText('Hello world'), 'Hello world');
  });

  it('returns empty string for null/undefined', () => {
    assert.equal(adfToText(null), '');
    assert.equal(adfToText(undefined), '');
  });

  it('extracts text from simple ADF paragraph', () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello world' },
          ],
        },
      ],
    };
    assert.equal(adfToText(adf), 'Hello world');
  });

  it('concatenates text nodes within a paragraph', () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello ' },
            { type: 'text', text: 'world', marks: [{ type: 'strong' }] },
          ],
        },
      ],
    };
    assert.equal(adfToText(adf), 'Hello world');
  });

  it('separates multiple paragraphs with newlines', () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First paragraph.' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second paragraph.' }],
        },
      ],
    };
    assert.equal(adfToText(adf), 'First paragraph.\n\nSecond paragraph.');
  });

  it('handles heading nodes', () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'My Heading' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Body text.' }],
        },
      ],
    };
    const result = adfToText(adf);
    assert.ok(result.includes('My Heading'));
    assert.ok(result.includes('Body text.'));
  });

  it('handles bulletList and listItem nodes', () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Item one' }] },
              ],
            },
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Item two' }] },
              ],
            },
          ],
        },
      ],
    };
    const result = adfToText(adf);
    assert.ok(result.includes('Item one'));
    assert.ok(result.includes('Item two'));
  });

  it('handles codeBlock nodes', () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'javascript' },
          content: [{ type: 'text', text: 'const x = 1;' }],
        },
      ],
    };
    assert.equal(adfToText(adf), 'const x = 1;');
  });

  it('handles inlineCard (link) nodes', () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            { type: 'inlineCard', attrs: { url: 'https://example.com/page' } },
          ],
        },
      ],
    };
    const result = adfToText(adf);
    assert.ok(result.includes('https://example.com/page'));
  });

  it('handles mention nodes', () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'mention', attrs: { text: '@John Dev' } },
            { type: 'text', text: ' please review' },
          ],
        },
      ],
    };
    const result = adfToText(adf);
    assert.ok(result.includes('@John Dev'));
    assert.ok(result.includes('please review'));
  });

  it('handles empty doc with no content', () => {
    const adf = { type: 'doc', version: 1, content: [] };
    assert.equal(adfToText(adf), '');
  });

  it('handles nested structures (table, panel, blockquote)', () => {
    const adf = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Quoted text' }] },
          ],
        },
      ],
    };
    assert.ok(adfToText(adf).includes('Quoted text'));
  });

  it('returns empty string for object without type=doc', () => {
    assert.equal(adfToText({ random: 'object' }), '');
  });
});

describe('buildMediaNode', () => {
  it('builds a mediaSingle+media node with type:file, the given id, and collection', () => {
    const node = buildMediaNode('5399f134-e823-4504-afbd-0874a0227dc9', 'CNV1-24');
    assert.deepEqual(node, {
      type: 'mediaSingle',
      attrs: { layout: 'center' },
      content: [{ type: 'media', attrs: { type: 'file', id: '5399f134-e823-4504-afbd-0874a0227dc9', collection: 'CNV1-24' } }],
    });
  });
});

describe('appendNodesToAdf', () => {
  it('appends extra block nodes after the existing text content', () => {
    const doc = textToAdf('Looks good');
    const mediaNode = buildMediaNode('uuid-1', 'CNV1-24');
    const result = appendNodesToAdf(doc, [mediaNode]);
    assert.equal(result.content.length, 2);
    assert.equal(result.content[0].type, 'paragraph');
    assert.equal(result.content[1], mediaNode);
  });

  it('does not mutate the original doc', () => {
    const doc = textToAdf('Looks good');
    const originalLength = doc.content.length;
    appendNodesToAdf(doc, [buildMediaNode('uuid-1', 'CNV1-24')]);
    assert.equal(doc.content.length, originalLength);
  });
});
