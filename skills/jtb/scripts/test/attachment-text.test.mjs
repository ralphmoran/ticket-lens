import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractText } from '../lib/attachment-text.mjs';

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-attach-text-test-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('extractText — supported plain-text formats', () => {
  test('reads a .txt file as-is', () => {
    const filePath = path.join(dir, 'notes.txt');
    fs.writeFileSync(filePath, 'Plain text content.');
    assert.equal(extractText(filePath), 'Plain text content.');
  });

  test('reads a .md file as-is', () => {
    const filePath = path.join(dir, 'notes.md');
    fs.writeFileSync(filePath, '# Heading\n\nBody.');
    assert.equal(extractText(filePath), '# Heading\n\nBody.');
  });

  test('reads a .csv file as-is', () => {
    const filePath = path.join(dir, 'data.csv');
    fs.writeFileSync(filePath, 'a,b,c\n1,2,3');
    assert.equal(extractText(filePath), 'a,b,c\n1,2,3');
  });

  test('reads valid .json and pretty-prints it', () => {
    const filePath = path.join(dir, 'data.json');
    fs.writeFileSync(filePath, '{"a":1,"b":2}');
    const result = extractText(filePath);
    assert.equal(result, JSON.stringify({ a: 1, b: 2 }, null, 2));
  });

  test('falls back to raw text for malformed .json rather than failing', () => {
    const filePath = path.join(dir, 'broken.json');
    fs.writeFileSync(filePath, '{not valid json');
    assert.equal(extractText(filePath), '{not valid json');
  });
});

describe('extractText — unsupported or missing input', () => {
  test('returns null for an unsupported file type (e.g. .pdf)', () => {
    const filePath = path.join(dir, 'doc.pdf');
    fs.writeFileSync(filePath, 'not real pdf bytes');
    assert.equal(extractText(filePath), null);
  });

  test('returns null for an image file', () => {
    const filePath = path.join(dir, 'photo.png');
    fs.writeFileSync(filePath, 'not real png bytes');
    assert.equal(extractText(filePath), null);
  });

  test('returns null for a path that does not exist, without throwing', () => {
    assert.doesNotThrow(() => {
      assert.equal(extractText(path.join(dir, 'missing.txt')), null);
    });
  });
});
