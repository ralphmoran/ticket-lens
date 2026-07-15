import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, serializeFrontmatter } from '../lib/frontmatter.mjs';

describe('serializeFrontmatter + parseFrontmatter — round trip', () => {
  test('plain scalar fields round-trip unchanged', () => {
    const data = { title: 'Fix login bug', author: 'ralph', created: '2026-07-14', status: 'unverified' };
    const text = serializeFrontmatter(data, 'Body text here.');
    const { data: parsed, body } = parseFrontmatter(text);
    assert.deepEqual(parsed, data);
    assert.equal(body, 'Body text here.');
  });

  test('array fields round-trip unchanged', () => {
    const data = { tickets: ['PROD-123', 'PROD-124'], tags: ['auth', 'bug'], sources: [] };
    const text = serializeFrontmatter(data, 'body');
    const { data: parsed } = parseFrontmatter(text);
    assert.deepEqual(parsed.tickets, ['PROD-123', 'PROD-124']);
    assert.deepEqual(parsed.tags, ['auth', 'bug']);
    assert.deepEqual(parsed.sources, []);
  });

  test('a value containing a colon round-trips correctly (gets quoted)', () => {
    const data = { title: 'Fix: timeout bug on retry' };
    const text = serializeFrontmatter(data, 'body');
    const { data: parsed } = parseFrontmatter(text);
    assert.equal(parsed.title, 'Fix: timeout bug on retry');
  });

  test('a value containing double quotes round-trips correctly', () => {
    const data = { title: 'The "gotcha" with retries' };
    const text = serializeFrontmatter(data, 'body');
    const { data: parsed } = parseFrontmatter(text);
    assert.equal(parsed.title, 'The "gotcha" with retries');
  });

  test('an array item containing a comma round-trips correctly (gets quoted)', () => {
    const data = { tags: ['bug, critical', 'auth'] };
    const text = serializeFrontmatter(data, 'body');
    const { data: parsed } = parseFrontmatter(text);
    assert.deepEqual(parsed.tags, ['bug, critical', 'auth']);
  });

  test('multi-line body is preserved exactly, including blank lines', () => {
    const body = 'Line one.\n\nLine two.\nLine three.';
    const text = serializeFrontmatter({ title: 'x' }, body);
    const { body: parsedBody } = parseFrontmatter(text);
    assert.equal(parsedBody, body);
  });

  test('a body containing a literal "---" line does not break parsing (only the first --- pair are the delimiters)', () => {
    const body = 'Before.\n\n---\n\nAfter.';
    const text = serializeFrontmatter({ title: 'x' }, body);
    const { body: parsedBody } = parseFrontmatter(text);
    assert.equal(parsedBody, body);
  });

  test('unicode in scalar values round-trips correctly', () => {
    const data = { title: 'Café ☕ note — em dash' };
    const text = serializeFrontmatter(data, 'body');
    const { data: parsed } = parseFrontmatter(text);
    assert.equal(parsed.title, 'Café ☕ note — em dash');
  });
});

describe('parseFrontmatter — malformed input', () => {
  test('text with no opening "---" has no frontmatter — whole text is body, data is empty', () => {
    const { data, body } = parseFrontmatter('Just a plain note, no frontmatter.');
    assert.deepEqual(data, {});
    assert.equal(body, 'Just a plain note, no frontmatter.');
  });

  test('text with an opening "---" but no closing "---" has no frontmatter — whole text is body', () => {
    const text = '---\ntitle: x\nBody without a closing delimiter.';
    const { data, body } = parseFrontmatter(text);
    assert.deepEqual(data, {});
    assert.equal(body, text);
  });

  test('empty string input returns empty data and empty body', () => {
    const { data, body } = parseFrontmatter('');
    assert.deepEqual(data, {});
    assert.equal(body, '');
  });

  test('frontmatter with no body after the closing delimiter returns an empty body', () => {
    const text = '---\ntitle: x\n---\n';
    const { data, body } = parseFrontmatter(text);
    assert.equal(data.title, 'x');
    assert.equal(body, '');
  });

  test('regression: a "__proto__" frontmatter key (hand-edited note) cannot pollute the parsed object\'s prototype', () => {
    const text = '---\ntitle: x\n__proto__: [polluted]\n---\nbody';
    const { data } = parseFrontmatter(text);
    assert.equal(data.title, 'x');
    assert.equal(Array.isArray(data), false);
    assert.equal(Object.getPrototypeOf(data), Object.prototype);
    assert.equal(({}).polluted, undefined);
  });
});

describe('serializeFrontmatter — output shape', () => {
  test('output starts and ends the frontmatter block with "---" lines', () => {
    const text = serializeFrontmatter({ title: 'x' }, 'body');
    const lines = text.split('\n');
    assert.equal(lines[0], '---');
    assert.equal(lines.indexOf('---', 1) > 0, true);
  });

  test('an empty array field serializes as "[]"', () => {
    const text = serializeFrontmatter({ tags: [] }, 'body');
    assert.match(text, /tags:\s*\[\]/);
  });
});
