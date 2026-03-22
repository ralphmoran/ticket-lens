import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { downloadAttachments, formatSize } from '../lib/attachment-downloader.mjs';

function toArrayBuffer(buf) {
  const ab = new ArrayBuffer(buf.length);
  new Uint8Array(ab).set(buf);
  return ab;
}

function makeFetcher(status = 200, body = Buffer.from('fakeimage')) {
  return async (_url, _opts) => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    arrayBuffer: async () => toArrayBuffer(body),
  });
}

function makeTicket(attachments = []) {
  return { key: 'TEST-1', attachments };
}

function makeAttachment(overrides = {}) {
  return {
    id: 'att-1',
    filename: 'screenshot.png',
    mimeType: 'image/png',
    size: 1024,
    content: 'https://jira.example.com/secure/attachment/att-1/screenshot.png',
    ...overrides,
  };
}

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jtb-test-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const ENV = { JIRA_BASE_URL: 'https://jira.example.com', JIRA_PAT: 'tok' };

// ─── Filtering ────────────────────────────────────────────────────────────────

describe('downloadAttachments — filtering', () => {
  it('returns empty array when ticket has no attachments', async () => {
    const result = await downloadAttachments(makeTicket([]), { env: ENV, fetcher: makeFetcher(), configDir: tmpDir });
    assert.deepStrictEqual(result, []);
  });

  it('returns empty array when no attachments have a content URL', async () => {
    const ticket = makeTicket([{ id: 'a1', filename: 'x.png', mimeType: 'image/png', size: 100, content: null }]);
    const result = await downloadAttachments(ticket, { env: ENV, fetcher: makeFetcher(), configDir: tmpDir });
    assert.deepStrictEqual(result, []);
  });

  it('processes all attachment types (images, PDFs, text, archives)', async () => {
    const attachments = [
      makeAttachment({ filename: 'shot.png', mimeType: 'image/png' }),
      makeAttachment({ filename: 'spec.pdf', mimeType: 'application/pdf', content: 'https://jira.example.com/spec.pdf' }),
      makeAttachment({ filename: 'log.txt', mimeType: 'text/plain', content: 'https://jira.example.com/log.txt' }),
      makeAttachment({ filename: 'data.zip', mimeType: 'application/zip', content: 'https://jira.example.com/data.zip' }),
    ];
    const result = await downloadAttachments(makeTicket(attachments), { env: ENV, fetcher: makeFetcher(), configDir: tmpDir });
    assert.equal(result.length, 4);
    assert.ok(result.every(r => r.localPath !== null));
  });
});

// ─── Size cap ────────────────────────────────────────────────────────────────

describe('downloadAttachments — size cap', () => {
  it('skips files over 10 MB', async () => {
    const ticket = makeTicket([makeAttachment({ size: 11 * 1024 * 1024 })]);
    const result = await downloadAttachments(ticket, { env: ENV, fetcher: makeFetcher(), configDir: tmpDir });
    assert.equal(result[0].skipReason, 'too-large');
    assert.equal(result[0].localPath, null);
  });

  it('downloads files exactly at 10 MB', async () => {
    const ticket = makeTicket([makeAttachment({ size: 10 * 1024 * 1024 })]);
    const result = await downloadAttachments(ticket, { env: ENV, fetcher: makeFetcher(), configDir: tmpDir });
    assert.equal(result[0].skipReason, null);
    assert.ok(result[0].localPath !== null);
  });
});

// ─── Cache ───────────────────────────────────────────────────────────────────

describe('downloadAttachments — cache', () => {
  it('skips download when file is already cached', async () => {
    const ticket = makeTicket([makeAttachment()]);
    const cacheDir = path.join(tmpDir, 'cache', 'TEST-1');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'screenshot.png'), 'cached');

    let fetchCalled = false;
    const fetcher = async () => { fetchCalled = true; return makeFetcher()(); };
    const result = await downloadAttachments(ticket, { env: ENV, fetcher, configDir: tmpDir });

    assert.equal(fetchCalled, false);
    assert.equal(result[0].skipReason, 'cached');
    assert.ok(result[0].localPath !== null);
  });

  it('re-downloads when noCache is true', async () => {
    const ticket = makeTicket([makeAttachment()]);
    const cacheDir = path.join(tmpDir, 'cache', 'TEST-1');
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, 'screenshot.png'), 'old-content');

    const result = await downloadAttachments(ticket, { env: ENV, fetcher: makeFetcher(), configDir: tmpDir, noCache: true });
    assert.equal(result[0].skipReason, null);
    assert.equal(result[0].skipped, false);
  });

  it('creates cache dir if it does not exist', async () => {
    const ticket = makeTicket([makeAttachment()]);
    const expectedDir = path.join(tmpDir, 'cache', 'TEST-1');
    assert.ok(!fs.existsSync(expectedDir));

    await downloadAttachments(ticket, { env: ENV, fetcher: makeFetcher(), configDir: tmpDir });
    assert.ok(fs.existsSync(expectedDir));
  });
});

// ─── Happy path ──────────────────────────────────────────────────────────────

describe('downloadAttachments — happy path', () => {
  it('downloads file and writes it to localPath', async () => {
    const content = Buffer.from('PNG data here');
    const fetcher = async (_url, _opts) => ({ ok: true, status: 200, arrayBuffer: async () => toArrayBuffer(content) });
    const ticket = makeTicket([makeAttachment()]);
    const result = await downloadAttachments(ticket, { env: ENV, fetcher, configDir: tmpDir });

    assert.ok(fs.existsSync(result[0].localPath));
    assert.equal(fs.readFileSync(result[0].localPath).toString(), 'PNG data here');
  });

  it('sends PAT Authorization header', async () => {
    let capturedHeaders;
    const fetcher = async (_url, opts) => {
      capturedHeaders = opts.headers;
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('x').buffer };
    };
    // Content URL must share origin with JIRA_BASE_URL to pass SSRF guard
    const ticket = makeTicket([makeAttachment({ content: 'https://j.com/secure/att-1/file.png' })]);
    await downloadAttachments(ticket, { env: { JIRA_BASE_URL: 'https://j.com', JIRA_PAT: 'mytoken' }, fetcher, configDir: tmpDir });
    assert.equal(capturedHeaders.Authorization, 'Bearer mytoken');
  });

  it('sends Basic Authorization header', async () => {
    let capturedHeaders;
    const fetcher = async (_url, opts) => {
      capturedHeaders = opts.headers;
      return { ok: true, status: 200, arrayBuffer: async () => Buffer.from('x').buffer };
    };
    // Content URL must share origin with JIRA_BASE_URL to pass SSRF guard
    const ticket = makeTicket([makeAttachment({ content: 'https://j.com/secure/att-1/file.png' })]);
    await downloadAttachments(ticket, { env: { JIRA_BASE_URL: 'https://j.com', JIRA_EMAIL: 'user@example.com', JIRA_API_TOKEN: 'tok123' }, fetcher, configDir: tmpDir });
    const expected = 'Basic ' + Buffer.from('user@example.com:tok123').toString('base64');
    assert.equal(capturedHeaders.Authorization, expected);
  });

  it('sanitizes filename — strips directory traversal', async () => {
    const ticket = makeTicket([makeAttachment({ filename: '../../etc/passwd' })]);
    const result = await downloadAttachments(ticket, { env: ENV, fetcher: makeFetcher(), configDir: tmpDir });
    assert.ok(!result[0].localPath.includes('..'));
    assert.ok(result[0].localPath.endsWith('passwd'));
  });

  it('sanitizes filename — replaces spaces and special chars', async () => {
    const ticket = makeTicket([makeAttachment({ filename: 'my screenshot (1).png' })]);
    const result = await downloadAttachments(ticket, { env: ENV, fetcher: makeFetcher(), configDir: tmpDir });
    assert.ok(!result[0].localPath.includes(' '));
    assert.ok(result[0].localPath.endsWith('.png'));
  });

  it('result has skipped=false and error=null on success', async () => {
    const ticket = makeTicket([makeAttachment()]);
    const result = await downloadAttachments(ticket, { env: ENV, fetcher: makeFetcher(), configDir: tmpDir });
    assert.equal(result[0].skipped, false);
    assert.equal(result[0].error, null);
  });
});

// ─── Error handling ──────────────────────────────────────────────────────────

describe('downloadAttachments — error handling', () => {
  it('skips file on HTTP error without throwing', async () => {
    const ticket = makeTicket([makeAttachment()]);
    const result = await downloadAttachments(ticket, { env: ENV, fetcher: makeFetcher(403), configDir: tmpDir });
    assert.equal(result[0].skipReason, 'error');
    assert.ok(result[0].error.includes('403'));
    assert.equal(result[0].localPath, null);
  });

  it('skips file on network error without throwing', async () => {
    const ticket = makeTicket([makeAttachment()]);
    const fetcher = async () => { throw new Error('ECONNREFUSED'); };
    const result = await downloadAttachments(ticket, { env: ENV, fetcher, configDir: tmpDir });
    assert.equal(result[0].skipReason, 'error');
    assert.ok(result[0].error.includes('ECONNREFUSED'));
  });

  it('continues downloading remaining files after one failure', async () => {
    const attachments = [
      makeAttachment({ filename: 'fails.png', content: 'https://jira.example.com/fails.png' }),
      makeAttachment({ filename: 'works.png', content: 'https://jira.example.com/works.png' }),
    ];
    const fetcher = async (url) => {
      if (url.includes('fails')) return { ok: false, status: 500, statusText: 'Error', arrayBuffer: async () => toArrayBuffer(Buffer.from('')) };
      return { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer(Buffer.from('img')) };
    };
    const result = await downloadAttachments(makeTicket(attachments), { env: ENV, fetcher, configDir: tmpDir });
    assert.equal(result[0].skipReason, 'error');
    assert.equal(result[1].skipReason, null);
    assert.ok(result[1].localPath !== null);
  });
});

// ─── MAX_ATTACHMENTS limit ───────────────────────────────────────────────────

describe('downloadAttachments — limit', () => {
  it('stops downloading after 20 attachments', async () => {
    const attachments = Array.from({ length: 25 }, (_, i) =>
      makeAttachment({ filename: `file-${i}.png`, content: `https://jira.example.com/file-${i}.png` })
    );
    const result = await downloadAttachments(makeTicket(attachments), { env: ENV, fetcher: makeFetcher(), configDir: tmpDir });
    assert.equal(result.length, 25);
    const downloaded = result.filter(r => r.localPath !== null);
    assert.equal(downloaded.length, 20);
  });

  it('marks excess attachments as skipReason=limit', async () => {
    const attachments = Array.from({ length: 22 }, (_, i) =>
      makeAttachment({ filename: `f-${i}.png`, content: `https://jira.example.com/f-${i}.png` })
    );
    const result = await downloadAttachments(makeTicket(attachments), { env: ENV, fetcher: makeFetcher(), configDir: tmpDir });
    const limitSkipped = result.filter(r => r.skipReason === 'limit');
    assert.equal(limitSkipped.length, 2);
  });
});

// ─── SSRF protection ─────────────────────────────────────────────────────────

describe('downloadAttachments — SSRF protection', () => {
  it('does not send auth headers to attachment URLs from a different origin', async () => {
    let capturedHeaders = null;
    const spyFetcher = async (_url, opts) => {
      capturedHeaders = opts?.headers ?? {};
      return { ok: true, statusText: 'OK', arrayBuffer: async () => new ArrayBuffer(4) };
    };
    const ticket = makeTicket([makeAttachment({ content: 'https://evil.com/steal-creds' })]);
    await downloadAttachments(ticket, { env: ENV, fetcher: spyFetcher, configDir: tmpDir });
    assert.ok(
      !capturedHeaders?.Authorization,
      'must NOT send Authorization header to a different origin'
    );
  });

  it('sends auth headers to attachment URLs from the same Jira origin', async () => {
    let capturedHeaders = null;
    const spyFetcher = async (_url, opts) => {
      capturedHeaders = opts?.headers ?? {};
      return { ok: true, statusText: 'OK', arrayBuffer: async () => new ArrayBuffer(4) };
    };
    const ticket = makeTicket([makeAttachment({ content: 'https://jira.example.com/secure/att-1/screenshot.png' })]);
    await downloadAttachments(ticket, { env: ENV, fetcher: spyFetcher, configDir: tmpDir });
    assert.ok(
      capturedHeaders?.Authorization,
      'must send Authorization header to the same Jira origin'
    );
  });

  it('marks cross-origin attachment as skipped with ssrf-blocked reason', async () => {
    const ticket = makeTicket([makeAttachment({ content: 'https://evil.com/file.png' })]);
    const result = await downloadAttachments(ticket, { env: ENV, fetcher: makeFetcher(), configDir: tmpDir });
    assert.equal(result.length, 1);
    assert.equal(result[0].skipReason, 'ssrf-blocked');
  });
});

// ─── Parallel downloads ──────────────────────────────────────────────────────

describe('downloadAttachments — parallel downloads', () => {
  it('runs up to 3 downloads concurrently within a batch', async () => {
    const attachments = Array.from({ length: 3 }, (_, i) =>
      makeAttachment({ filename: `p-${i}.png`, content: `https://jira.example.com/p-${i}.png` })
    );

    let concurrent = 0;
    let maxConcurrent = 0;
    const fetcher = async (_url) => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(res => setImmediate(res)); // yield so all 3 start before any resolves
      concurrent--;
      return { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer(Buffer.from('x')) };
    };

    await downloadAttachments(makeTicket(attachments), { env: ENV, fetcher, configDir: tmpDir });
    assert.equal(maxConcurrent, 3);
  });

  it('preserves result order when downloads complete out of order', async () => {
    const attachments = Array.from({ length: 4 }, (_, i) =>
      makeAttachment({ filename: `img-${i}.png`, content: `https://jira.example.com/img-${i}.png` })
    );

    // Later indices resolve faster (reverse completion order)
    const fetcher = async (url) => {
      const i = parseInt(url.match(/img-(\d+)/)[1]);
      await new Promise(res => setTimeout(res, (4 - i) * 10));
      return { ok: true, status: 200, arrayBuffer: async () => toArrayBuffer(Buffer.from(`d${i}`)) };
    };

    const result = await downloadAttachments(makeTicket(attachments), { env: ENV, fetcher, configDir: tmpDir });
    assert.equal(result.length, 4);
    for (let i = 0; i < 4; i++) {
      assert.ok(result[i].localPath?.endsWith(`img-${i}.png`), `result[${i}] should be img-${i}.png`);
    }
  });
});

// ─── formatSize ──────────────────────────────────────────────────────────────

describe('formatSize', () => {
  it('formats bytes', () => assert.equal(formatSize(512), '512B'));
  it('formats KB', () => assert.equal(formatSize(2048), '2KB'));
  it('formats MB', () => assert.equal(formatSize(1.5 * 1024 * 1024), '1.5MB'));
  it('returns ? for null', () => assert.equal(formatSize(null), '?'));
  it('returns ? for 0', () => assert.equal(formatSize(0), '?'));
});
