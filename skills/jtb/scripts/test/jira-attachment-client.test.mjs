import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { uploadAttachment, resolveMediaId } from '../lib/jira-attachment-client.mjs';

const ENV = { JIRA_BASE_URL: 'https://example.atlassian.net', JIRA_EMAIL: 'user@example.com', JIRA_API_TOKEN: 'tok' };

function makeFile(overrides = {}) {
  return {
    filename: 'screenshot.png',
    buffer: Buffer.from('fake-png-bytes'),
    mimeType: 'image/png',
    size: 14,
    ...overrides,
  };
}

describe('uploadAttachment', () => {
  it('POSTs multipart form data to the attachments endpoint with the file field', async () => {
    let captured;
    const fetcher = async (url, opts) => {
      captured = { url, opts };
      return { ok: true, json: async () => [{ id: '10001', filename: 'screenshot.png', size: 14, content: 'https://example.atlassian.net/secure/attachment/10001/screenshot.png' }] };
    };
    const result = await uploadAttachment('PROJ-1', makeFile(), { env: ENV, apiVersion: 3, fetcher });

    assert.ok(captured.url.includes('/rest/api/3/issue/PROJ-1/attachments'));
    assert.equal(captured.opts.method, 'POST');
    assert.ok(captured.opts.body instanceof FormData);
    const filePart = captured.opts.body.get('file');
    assert.equal(filePart.name, 'screenshot.png');
    assert.equal(result.id, '10001');
    assert.equal(result.filename, 'screenshot.png');
    assert.equal(result.url, 'https://example.atlassian.net/secure/attachment/10001/screenshot.png');
  });

  it('sends X-Atlassian-Token: no-check and never sets Content-Type manually (FormData must set its own boundary)', async () => {
    let captured;
    const fetcher = async (url, opts) => { captured = opts; return { ok: true, json: async () => [{ id: '1' }] }; };
    await uploadAttachment('PROJ-1', makeFile(), { env: ENV, fetcher });

    assert.equal(captured.headers['X-Atlassian-Token'], 'no-check');
    assert.equal('Content-Type' in captured.headers, false);
  });

  it('includes the auth header', async () => {
    let captured;
    const fetcher = async (url, opts) => { captured = opts; return { ok: true, json: async () => [{ id: '1' }] }; };
    await uploadAttachment('PROJ-1', makeFile(), { env: ENV, fetcher });

    assert.ok(captured.headers.Authorization.startsWith('Basic '));
  });

  it('throws with the response status on a non-OK response', async () => {
    const fetcher = async () => ({ ok: false, status: 413 });
    await assert.rejects(
      () => uploadAttachment('PROJ-1', makeFile(), { env: ENV, fetcher }),
      (err) => err.status === 413,
    );
  });

  it('uses the v2 (Server/DC) URL by default', async () => {
    let captured;
    const fetcher = async (url) => { captured = url; return { ok: true, json: async () => [{ id: '1' }] }; };
    await uploadAttachment('PROJ-1', makeFile(), { env: ENV, fetcher });
    assert.ok(captured.includes('/rest/api/2/issue/PROJ-1/attachments'));
  });
});

describe('resolveMediaId', () => {
  const contentUrl = 'https://example.atlassian.net/rest/api/3/attachment/content/10041';

  it('parses the media UUID out of the redirect Location header, without following it', async () => {
    let fetchCount = 0;
    const fetcher = async (url, opts) => {
      fetchCount++;
      assert.equal(opts.redirect, 'manual');
      return {
        status: 303,
        headers: { get: (h) => h === 'location' ? 'https://api.media.atlassian.com/file/5399f134-e823-4504-afbd-0874a0227dc9/binary?token=abc' : null },
      };
    };
    const result = await resolveMediaId(contentUrl, { env: ENV, fetcher });
    assert.equal(result, '5399f134-e823-4504-afbd-0874a0227dc9');
    assert.equal(fetchCount, 1, 'must not follow the redirect — only the Location header is needed');
  });

  it('throws when the response is not a redirect', async () => {
    const fetcher = async () => ({ status: 200, headers: { get: () => null } });
    await assert.rejects(() => resolveMediaId(contentUrl, { env: ENV, fetcher }), /redirect/i);
  });

  it('throws when the redirect has no Location header', async () => {
    const fetcher = async () => ({ status: 303, headers: { get: () => null } });
    await assert.rejects(() => resolveMediaId(contentUrl, { env: ENV, fetcher }), /Location/i);
  });

  it('throws when the redirect target has no parseable UUID', async () => {
    const fetcher = async () => ({ status: 303, headers: { get: () => 'https://api.media.atlassian.com/not-a-uuid-path' } });
    await assert.rejects(() => resolveMediaId(contentUrl, { env: ENV, fetcher }), /uuid/i);
  });

  it('sends the auth header', async () => {
    let capturedHeaders;
    const fetcher = async (url, opts) => {
      capturedHeaders = opts.headers;
      return { status: 303, headers: { get: (h) => h === 'location' ? 'https://api.media.atlassian.com/file/uuid-1/binary' : null } };
    };
    await resolveMediaId(contentUrl, { env: ENV, fetcher });
    assert.ok(capturedHeaders.Authorization.startsWith('Basic '));
  });
});
