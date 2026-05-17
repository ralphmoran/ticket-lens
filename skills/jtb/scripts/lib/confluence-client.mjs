/**
 * Confluence REST API client.
 * Fetches page content for Confluence pages referenced in Jira remote links.
 */

/**
 * Extracts the numeric page ID from a Confluence page URL.
 * Supports Cloud (/wiki/spaces/{key}/pages/{id}) and Server (?pageId={id}).
 * Returns null when the ID cannot be determined.
 * @param {string} url
 * @returns {string|null}
 */
export function extractConfluencePageId(url) {
  if (!url) return null;

  const qpMatch = url.match(/[?&]pageId=(\d+)/);
  if (qpMatch) return qpMatch[1];

  const pathMatch = url.match(/\/wiki\/spaces\/[^/]+\/pages\/(\d+)(?:\/|$)/);
  if (pathMatch) return pathMatch[1];

  return null;
}

/**
 * Converts a Confluence view-body HTML string to plain text.
 * Uses simple regex-based transformation — no external dependencies.
 * @param {string} html
 * @returns {string}
 */
export function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<\/?(p|div|h[1-6]|li|tr|td|th|blockquote|pre)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#160;|&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Determines the Confluence REST API base path from a page URL.
 * Cloud: {origin}/wiki/rest/api/content/{pageId}
 * Server/DC without /wiki/: {origin}{/prefix}/rest/api/content/{pageId}
 * @param {string} pageUrl
 * @param {string} pageId
 * @returns {string}
 */
function buildApiUrl(pageUrl, pageId) {
  try {
    const parsed = new URL(pageUrl);
    if (parsed.pathname.includes('/wiki/')) {
      return `${parsed.origin}/wiki/rest/api/content/${pageId}?expand=body.view`;
    }
    const confluencePrefix = parsed.pathname.match(/^(\/confluence)\//);
    const prefix = confluencePrefix ? confluencePrefix[1] : '';
    return `${parsed.origin}${prefix}/rest/api/content/${pageId}?expand=body.view`;
  } catch {
    return null;
  }
}

/**
 * Fetches a Confluence page and returns its plain-text body.
 * Returns null on any error (non-OK response, network failure, unparseable URL).
 * @param {string} url - The Confluence page URL from the Jira remote link
 * @param {object} authHeader - Authorization header object, e.g. { Authorization: 'Basic ...' }
 * @param {{ fetcher?: Function, timeoutMs?: number }} [opts]
 * @returns {Promise<{url: string, title: string, text: string}|null>}
 */
export async function fetchConfluencePage(url, authHeader, opts = {}) {
  const { fetcher = globalThis.fetch, timeoutMs = 10_000 } = opts;

  const pageId = extractConfluencePageId(url);
  if (!pageId) return null;

  const apiUrl = buildApiUrl(url, pageId);
  if (!apiUrl) return null;

  const fetchOpts = { headers: { ...authHeader, 'Content-Type': 'application/json' } };
  if (timeoutMs) fetchOpts.signal = AbortSignal.timeout(timeoutMs);

  try {
    const response = await fetcher(apiUrl, fetchOpts);
    if (!response.ok) return null;

    const data = await response.json();
    return {
      url,
      title: data.title ?? null,
      text: htmlToText(data.body?.view?.value ?? ''),
    };
  } catch {
    return null;
  }
}
