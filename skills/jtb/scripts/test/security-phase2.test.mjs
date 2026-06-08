import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateBaseUrl } from '../lib/jira-client.mjs';
import { downloadAttachments } from '../lib/attachment-downloader.mjs';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';

// ── H3: validateBaseUrl ───────────────────────────────────────────────────────

describe('validateBaseUrl', () => {
  it('accepts valid HTTPS URLs', () => {
    assert.doesNotThrow(() => validateBaseUrl('https://company.atlassian.net'));
    assert.doesNotThrow(() => validateBaseUrl('https://jira.example.com/'));
    assert.doesNotThrow(() => validateBaseUrl('https://jira.example.com:8443'));
  });

  it('rejects http:// URLs', () => {
    assert.throws(
      () => validateBaseUrl('http://jira.example.com'),
      /must use HTTPS/,
    );
  });

  it('rejects invalid URLs', () => {
    assert.throws(() => validateBaseUrl('not-a-url'), /not a valid URL/);
    assert.throws(() => validateBaseUrl(''), /not a valid URL/);
  });

  it('rejects 127.x loopback', () => {
    assert.throws(() => validateBaseUrl('https://127.0.0.1'), /blocked/);
    assert.throws(() => validateBaseUrl('https://127.0.0.2:8080'), /blocked/);
  });

  it('rejects RFC-1918 10.x range', () => {
    assert.throws(() => validateBaseUrl('https://10.0.0.1'), /blocked/);
    assert.throws(() => validateBaseUrl('https://10.255.255.255'), /blocked/);
  });

  it('rejects RFC-1918 172.16-31.x range', () => {
    assert.throws(() => validateBaseUrl('https://172.16.0.1'), /blocked/);
    assert.throws(() => validateBaseUrl('https://172.31.0.1'), /blocked/);
    // Outside range should NOT be blocked
    assert.doesNotThrow(() => validateBaseUrl('https://172.32.0.1'));
  });

  it('rejects RFC-1918 192.168.x.x range', () => {
    assert.throws(() => validateBaseUrl('https://192.168.1.1'), /blocked/);
  });

  it('rejects link-local 169.254.x.x (AWS metadata endpoint)', () => {
    assert.throws(() => validateBaseUrl('https://169.254.169.254'), /blocked/);
  });

  it('rejects IPv6 loopback ::1', () => {
    assert.throws(() => validateBaseUrl('https://[::1]'), /blocked/);
  });

  it('rejects localhost hostname', () => {
    assert.throws(() => validateBaseUrl('https://localhost'), /blocked/);
    assert.throws(() => validateBaseUrl('https://LOCALHOST'), /blocked/);
  });

  it('rejects 0.0.0.0 (all-interfaces)', () => {
    assert.throws(() => validateBaseUrl('https://0.0.0.0'), /blocked/);
  });

  it('rejects IPv4-mapped IPv6 addresses', () => {
    // ::ffff:127.0.0.1 — IPv4-mapped loopback
    assert.throws(() => validateBaseUrl('https://[::ffff:127.0.0.1]'), /blocked/);
    assert.throws(() => validateBaseUrl('https://[::ffff:192.168.1.1]'), /blocked/);
  });
});

// ── H4: attachment downloader — redirect: 'error' blocks mid-flight redirects ─

describe('attachment-downloader redirect protection', () => {
  const ENV = { JIRA_BASE_URL: 'https://j.example.com', JIRA_PAT: 'token' };

  it('blocks fetcher redirect to cross-origin by propagating fetch error', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tl-test-'));
    const ticket = {
      key: 'PROJ-1',
      attachments: [{ filename: 'a.txt', content: 'https://j.example.com/secure/attachment/1/a.txt', size: 10, mimeType: 'text/plain' }],
    };

    // Simulate what a real fetch does when redirect:'error' is set and a redirect occurs.
    const fetcher = async (_url, opts) => {
      assert.strictEqual(opts.redirect, 'error', 'redirect option must be "error"');
      // Simulate a redirect response (TypeError in native fetch with redirect:'error')
      throw new TypeError('Failed to fetch: redirect not allowed');
    };

    const results = await downloadAttachments(ticket, { env: ENV, fetcher, configDir: tmpDir });
    assert.strictEqual(results[0].error, 'Failed to fetch: redirect not allowed');
    assert.strictEqual(results[0].skipReason, 'error');
  });

  it('passes redirect:error option to fetcher on normal download', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tl-test-'));
    const ticket = {
      key: 'PROJ-2',
      attachments: [{ filename: 'b.txt', content: 'https://j.example.com/secure/attachment/2/b.txt', size: 10, mimeType: 'text/plain' }],
    };

    let capturedOpts = null;
    const fetcher = async (_url, opts) => {
      capturedOpts = opts;
      return { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(4) };
    };

    await downloadAttachments(ticket, { env: ENV, fetcher, configDir: tmpDir });
    assert.strictEqual(capturedOpts?.redirect, 'error');
  });
});
