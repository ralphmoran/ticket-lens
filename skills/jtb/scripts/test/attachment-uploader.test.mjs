import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readAttachmentFile, readAttachments, MAX_ATTACHMENTS, MAX_FILE_BYTES, MAX_TOTAL_BYTES } from '../lib/attachment-uploader.mjs';

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jtb-upload-test-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFixture(name, content = 'hello') {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, content);
  return p;
}

// ─── readAttachmentFile ─────────────────────────────────────────────────────

describe('readAttachmentFile', () => {
  it('reads a small text file and reports its size, filename, and mime type', () => {
    const p = writeFixture('notes.txt', 'hello world');
    const result = readAttachmentFile(p);
    assert.equal(result.error, undefined);
    assert.equal(result.filename, 'notes.txt');
    assert.equal(result.mimeType, 'text/plain');
    assert.equal(result.size, 11);
    assert.equal(result.buffer.toString(), 'hello world');
  });

  it('detects an image mime type from the extension', () => {
    const p = writeFixture('screenshot.png', 'fake-png-bytes');
    const result = readAttachmentFile(p);
    assert.equal(result.mimeType, 'image/png');
  });

  it('falls back to application/octet-stream for an unknown extension', () => {
    const p = writeFixture('archive.xyz', 'binary-ish');
    const result = readAttachmentFile(p);
    assert.equal(result.mimeType, 'application/octet-stream');
  });

  it('sanitizes a filename with unsafe characters, preserving the extension', () => {
    const p = writeFixture('weird name!@#.png', 'x');
    const result = readAttachmentFile(p);
    assert.equal(result.filename, 'weird_name___.png');
  });

  it('returns a not-found error for a missing path', () => {
    const result = readAttachmentFile(path.join(tmpDir, 'nope.png'));
    assert.equal(result.error, 'not-found');
    assert.equal(result.path, path.join(tmpDir, 'nope.png'));
  });

  it('returns a not-a-file error for a directory path', () => {
    const dirPath = path.join(tmpDir, 'subdir');
    fs.mkdirSync(dirPath);
    const result = readAttachmentFile(dirPath);
    assert.equal(result.error, 'not-a-file');
  });

  it('returns an empty error for a zero-byte file', () => {
    const p = writeFixture('empty.txt', '');
    const result = readAttachmentFile(p);
    assert.equal(result.error, 'empty');
  });

  it('returns a too-large error without reading the file into memory when it exceeds the cap', () => {
    const p = path.join(tmpDir, 'huge.bin');
    // Sparse file — allocates a hole, not real disk/memory, but stat.size
    // reports the full logical size, which is all readAttachmentFile needs
    // to reject it before ever calling readFileSync.
    const fd = fs.openSync(p, 'w');
    fs.ftruncateSync(fd, MAX_FILE_BYTES + 1);
    fs.closeSync(fd);
    const result = readAttachmentFile(p);
    assert.equal(result.error, 'too-large');
    assert.equal(result.buffer, undefined);
  });
});

// ─── readAttachments ────────────────────────────────────────────────────────

describe('readAttachments', () => {
  it('reads multiple valid paths, each marked ok', () => {
    const a = writeFixture('a.txt', 'a');
    const b = writeFixture('b.png', 'b');
    const { files, droppedCount } = readAttachments([a, b]);
    assert.equal(files.length, 2);
    assert.ok(files.every(f => f.ok));
    assert.equal(droppedCount, 0);
  });

  it('marks a failed path as not-ok without aborting the rest', () => {
    const a = writeFixture('a.txt', 'a');
    const missing = path.join(tmpDir, 'missing.png');
    const { files } = readAttachments([a, missing]);
    assert.equal(files[0].ok, true);
    assert.equal(files[1].ok, false);
    assert.equal(files[1].error, 'not-found');
  });

  it('caps at MAX_ATTACHMENTS and reports how many were dropped', () => {
    const paths = Array.from({ length: MAX_ATTACHMENTS + 3 }, (_, i) => writeFixture(`f${i}.txt`, 'x'));
    const { files, droppedCount } = readAttachments(paths);
    assert.equal(files.length, MAX_ATTACHMENTS);
    assert.equal(droppedCount, 3);
  });

  it('returns an empty result for an empty input array', () => {
    const { files, droppedCount } = readAttachments([]);
    assert.deepEqual(files, []);
    assert.equal(droppedCount, 0);
  });

  it('rejects a file that would push the running total over MAX_TOTAL_BYTES, without reading it', () => {
    // Enough files, each safely under the per-file cap, that their sum
    // crosses the aggregate cap — the aggregate check is what trips here,
    // not the per-file one.
    const perFileSize = Math.floor(MAX_FILE_BYTES * 0.9);
    const filesNeeded = Math.floor(MAX_TOTAL_BYTES / perFileSize) + 1; // N fit exactly; the (N+1)th tips the aggregate over
    const paths = [];
    for (let i = 0; i < filesNeeded; i++) {
      const p = path.join(tmpDir, `f${i}.bin`);
      const fd = fs.openSync(p, 'w');
      fs.ftruncateSync(fd, perFileSize);
      fs.closeSync(fd);
      paths.push(p);
    }

    const { files } = readAttachments(paths);
    const lastIndex = files.length - 1;
    assert.ok(files.slice(0, lastIndex).every(f => f.ok), 'every file before the aggregate cap trips must still succeed');
    assert.equal(files[lastIndex].ok, false);
    assert.equal(files[lastIndex].error, 'total-size-exceeded');
    assert.equal(files[lastIndex].buffer, undefined);
  });

  it('does not count a too-large or missing file toward the running total', () => {
    const huge = path.join(tmpDir, 'huge.bin');
    const fd = fs.openSync(huge, 'w');
    fs.ftruncateSync(fd, MAX_FILE_BYTES + 1);
    fs.closeSync(fd);
    const small = writeFixture('small.txt', 'x');
    const { files } = readAttachments([huge, small]);
    assert.equal(files[0].error, 'too-large');
    assert.equal(files[1].ok, true);
  });
});
