import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractConfluencePageId, htmlToText, fetchConfluencePage } from '../lib/confluence-client.mjs';

// ---------------------------------------------------------------------------
// extractConfluencePageId
// ---------------------------------------------------------------------------
describe('extractConfluencePageId', () => {
  it('parses Cloud URL with title segment', () => {
    assert.equal(
      extractConfluencePageId('https://example.atlassian.net/wiki/spaces/PROJ/pages/123456/Page+Title'),
      '123456',
    );
  });

  it('parses Cloud URL without title segment', () => {
    assert.equal(
      extractConfluencePageId('https://example.atlassian.net/wiki/spaces/PROJ/pages/123456'),
      '123456',
    );
  });

  it('parses Server viewpage.action URL', () => {
    assert.equal(
      extractConfluencePageId('https://confluence.example.com/pages/viewpage.action?pageId=789012'),
      '789012',
    );
  });

  it('parses Server URL with /confluence/ prefix', () => {
    assert.equal(
      extractConfluencePageId('https://example.com/confluence/pages/viewpage.action?pageId=555'),
      '555',
    );
  });

  it('returns null for non-Confluence URL', () => {
    assert.equal(extractConfluencePageId('https://example.com/some/other/page'), null);
  });

  it('returns null for Confluence space overview (no page ID)', () => {
    assert.equal(
      extractConfluencePageId('https://example.atlassian.net/wiki/spaces/PROJ/overview'),
      null,
    );
  });

  it('returns null for empty string', () => {
    assert.equal(extractConfluencePageId(''), null);
  });

  it('returns null for non-numeric path segment after /pages/', () => {
    assert.equal(
      extractConfluencePageId('https://example.atlassian.net/wiki/spaces/PROJ/pages/edit-v2/123456'),
      null,
    );
  });
});

// ---------------------------------------------------------------------------
// htmlToText
// ---------------------------------------------------------------------------
describe('htmlToText', () => {
  it('strips simple tags', () => {
    assert.equal(htmlToText('<p>Hello world</p>'), 'Hello world');
  });

  it('converts block-level tags to newlines', () => {
    const result = htmlToText('<p>First</p><p>Second</p>');
    assert.ok(result.includes('First'), result);
    assert.ok(result.includes('Second'), result);
    assert.ok(result.indexOf('First') < result.indexOf('Second'));
  });

  it('converts <br> to newline', () => {
    const result = htmlToText('Line one<br>Line two');
    assert.ok(result.includes('Line one'), result);
    assert.ok(result.includes('Line two'), result);
  });

  it('decodes &amp;', () => {
    assert.ok(htmlToText('A &amp; B').includes('A & B'));
  });

  it('decodes &lt; and &gt;', () => {
    const result = htmlToText('&lt;tag&gt;');
    assert.ok(result.includes('<tag>'));
  });

  it('decodes &quot;', () => {
    assert.ok(htmlToText('say &quot;hi&quot;').includes('"hi"'));
  });

  it('decodes &#160; (non-breaking space) to regular space', () => {
    assert.ok(htmlToText('a&#160;b').includes('a b'));
  });

  it('returns empty string for empty input', () => {
    assert.equal(htmlToText(''), '');
  });

  it('trims leading and trailing whitespace', () => {
    const result = htmlToText('  <p>  hello  </p>  ');
    assert.equal(result.trim(), 'hello');
  });
});

// ---------------------------------------------------------------------------
// fetchConfluencePage
// ---------------------------------------------------------------------------
describe('fetchConfluencePage', () => {
  const AUTH_HEADER = { Authorization: 'Basic dXNlcjp0b2s=' };

  it('returns {url, title, text} for Cloud page', async () => {
    const pageUrl = 'https://example.atlassian.net/wiki/spaces/PROJ/pages/123456/My+Page';
    const fetcher = async () => ({
      ok: true,
      json: async () => ({
        title: 'My Page',
        body: { view: { value: '<p>Page content here.</p>' } },
      }),
    });
    const result = await fetchConfluencePage(pageUrl, AUTH_HEADER, { fetcher });
    assert.equal(result.url, pageUrl);
    assert.equal(result.title, 'My Page');
    assert.ok(result.text.includes('Page content here.'), result.text);
  });

  it('calls the correct Confluence REST API URL for Cloud', async () => {
    let capturedUrl;
    const fetcher = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ title: 'T', body: { view: { value: '' } } }) };
    };
    await fetchConfluencePage(
      'https://example.atlassian.net/wiki/spaces/PROJ/pages/999/Title',
      AUTH_HEADER,
      { fetcher },
    );
    assert.ok(capturedUrl.includes('/wiki/rest/api/content/999'), `unexpected URL: ${capturedUrl}`);
    assert.ok(capturedUrl.includes('expand=body.view'), `missing expand: ${capturedUrl}`);
  });

  it('sends Authorization header', async () => {
    let capturedHeaders;
    const fetcher = async (_url, opts) => {
      capturedHeaders = opts?.headers;
      return { ok: true, json: async () => ({ title: 'T', body: { view: { value: '' } } }) };
    };
    await fetchConfluencePage(
      'https://example.atlassian.net/wiki/spaces/PROJ/pages/1/T',
      { Authorization: 'Basic abc' },
      { fetcher },
    );
    assert.equal(capturedHeaders?.Authorization, 'Basic abc');
  });

  it('returns null when page ID cannot be extracted', async () => {
    let fetchCalled = false;
    const fetcher = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };
    const result = await fetchConfluencePage(
      'https://example.atlassian.net/wiki/spaces/PROJ/overview',
      AUTH_HEADER,
      { fetcher },
    );
    assert.equal(result, null);
    assert.equal(fetchCalled, false, 'should not call fetcher when no page ID');
  });

  it('returns null on non-OK HTTP response', async () => {
    const fetcher = async () => ({ ok: false, status: 403, statusText: 'Forbidden' });
    const result = await fetchConfluencePage(
      'https://example.atlassian.net/wiki/spaces/PROJ/pages/123/T',
      AUTH_HEADER,
      { fetcher },
    );
    assert.equal(result, null);
  });

  it('returns null on fetch network error', async () => {
    const fetcher = async () => { throw new Error('Network error'); };
    const result = await fetchConfluencePage(
      'https://example.atlassian.net/wiki/spaces/PROJ/pages/123/T',
      AUTH_HEADER,
      { fetcher },
    );
    assert.equal(result, null);
  });
});
