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

// ── H4: attachment downloader — SSRF protection via URL validation ────────────
// redirect:'error' was removed because Jira Cloud legitimate redirects to CDN/S3
// would break downloads. SSRF protection is enforced by validating the initial
// content URL against the configured Jira origin (H3, above) before fetch.

describe('attachment-downloader redirect protection', () => {
  const ENV = { JIRA_BASE_URL: 'https://j.example.com', JIRA_PAT: 'token' };

  it('SSRF guard: blocks cross-origin attachment URL before fetch is called', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'tl-test-'));
    const ticket = {
      key: 'PROJ-1',
      attachments: [{ filename: 'a.txt', content: 'https://evil.example.com/steal-creds', size: 10, mimeType: 'text/plain' }],
    };

    let fetchCalled = false;
    const fetcher = async () => { fetchCalled = true; return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; };

    const results = await downloadAttachments(ticket, { env: ENV, fetcher, configDir: tmpDir });
    assert.strictEqual(fetchCalled, false, 'fetcher must never be called for cross-origin URLs');
    assert.strictEqual(results[0].skipReason, 'ssrf-blocked');
  });

  it('allows same-origin attachment and does not set redirect:error', async () => {
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
    assert.notStrictEqual(capturedOpts?.redirect, 'error', 'redirect:error must not be set — Jira CDN redirects must be followable');
    assert.ok(capturedOpts?.headers?.Authorization, 'auth header sent to Jira origin');
  });
});
