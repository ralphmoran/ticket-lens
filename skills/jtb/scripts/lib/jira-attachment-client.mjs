/**
 * Uploads a file to a Jira issue's attachments. Multipart/form-data, not
 * JSON — the one write in this codebase with a genuinely different request
 * shape from every other Jira write (comment/transition/assign/link/update/
 * create all send `Content-Type: application/json`). Reuses the same
 * guardedFetch/validateBaseUrl/buildAuthHeader SSRF/auth guards as every
 * other call in jira-client.mjs, imported rather than duplicated.
 */

import { guardedFetch, validateBaseUrl, buildAuthHeader, defaultLookupFor, validateResolvedHost } from './jira-client.mjs';

/**
 * @param {string} ticketKey
 * @param {{ filename: string, buffer: Buffer, mimeType: string }} file - from attachment-uploader.mjs's readAttachmentFile
 * @param {object} opts
 * @returns {Promise<{ id: string, filename: string, size: number, url: string|null }>}
 */
export async function uploadAttachment(ticketKey, file, opts = {}) {
  const { env = process.env, fetcher = globalThis.fetch, lookup = defaultLookupFor(fetcher), apiVersion = 2, timeoutMs = 30_000, allowPrivateIp = false } = opts;
  validateBaseUrl(env.JIRA_BASE_URL, allowPrivateIp);
  const baseUrl = env.JIRA_BASE_URL.replace(/\/$/, '');
  const url = `${baseUrl}/rest/api/${apiVersion}/issue/${encodeURIComponent(ticketKey)}/attachments`;

  const form = new FormData();
  form.append('file', new Blob([file.buffer], { type: file.mimeType }), file.filename);

  // No Content-Type header here — FormData sets its own multipart boundary.
  // Every other write in jira-client.mjs sets 'Content-Type': 'application/json';
  // copying that here would silently break the upload.
  const fetchOpts = {
    method: 'POST',
    headers: { ...buildAuthHeader(env), 'X-Atlassian-Token': 'no-check' },
    body: form,
  };
  if (timeoutMs) fetchOpts.signal = AbortSignal.timeout(timeoutMs);

  const response = await guardedFetch(url, fetchOpts, { fetcher, lookup, allowPrivateIp });
  if (!response.ok) {
    const err = new Error(`Jira API error ${response.status} attaching ${file.filename} to ${ticketKey}`);
    err.status = response.status;
    throw err;
  }
  const raw = await response.json();
  const uploaded = (Array.isArray(raw) ? raw[0] : raw) ?? {};
  return {
    id: uploaded.id,
    filename: uploaded.filename ?? file.filename,
    size: uploaded.size ?? file.buffer.length,
    url: uploaded.content ?? null,
  };
}

/**
 * Resolves the Media Services UUID for an already-uploaded attachment —
 * a completely different ID space from the classic attachment id above,
 * and required to embed the attachment as real inline media in an ADF
 * comment (see adf-converter.mjs's buildMediaNode). The only documented
 * way to get it: a manual-redirect GET on the attachment's content URL,
 * whose Location header points to
 * `https://api.media.atlassian.com/file/{UUID}/binary?token=...` — the
 * UUID is parsed out of that path without ever following the redirect
 * (no need to actually download the file just to discard it).
 *
 * Real-instance-verified against a live Jira Cloud site: the resulting
 * media node renders as a genuine inline thumbnail — see buildMediaNode's
 * doc comment for what was confirmed about the `collection` attribute.
 */
export async function resolveMediaId(contentUrl, opts = {}) {
  const { env = process.env, fetcher = globalThis.fetch, lookup = defaultLookupFor(fetcher), allowPrivateIp = false } = opts;
  await validateResolvedHost(new URL(contentUrl).hostname, lookup, allowPrivateIp);
  const response = await fetcher(contentUrl, { headers: buildAuthHeader(env), redirect: 'manual' });
  if (response.status < 300 || response.status >= 400) {
    throw new Error(`Expected a redirect resolving the media id for ${contentUrl}, got ${response.status}`);
  }
  const location = response.headers.get('location');
  if (!location) throw new Error(`Media content redirect for ${contentUrl} had no Location header`);
  const match = new URL(location).pathname.match(/\/file\/([^/]+)\/binary/);
  if (!match) throw new Error(`Could not parse a media uuid from redirect target for ${contentUrl}`);
  return match[1];
}
