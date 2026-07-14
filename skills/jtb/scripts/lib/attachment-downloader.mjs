/**
 * Downloads ticket attachments from Jira to a local cache directory.
 * Supports all file types; respects a per-file size cap.
 * Auth headers are required — Jira attachment URLs are not public.
 */

import fs from 'node:fs';
import path from 'node:path';
import { buildAuthHeader, isSafeRedirectUrl, validateResolvedHost, defaultLookupFor } from './jira-client.mjs';
import { DEFAULT_CONFIG_DIR } from './config.mjs';
const MAX_ATTACHMENTS = 20;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_REDIRECT_HOPS = 2;

/**
 * DNS-validates the initial URL, then follows any redirect chain manually,
 * re-validating (blocklist + DNS) EVERY hop — not just the first.
 * `redirect:'follow'` on the first hop's target would let that host issue a
 * second, unvalidated redirect straight through (audit 2026-07-07 §4.1
 * code-review remediation). Auth headers are only ever sent on the initial
 * request — every hop after that is auth-less, matching Jira Cloud's
 * presigned-URL CDN redirect model.
 *
 * `allowPrivateIp` only ever applies to the initial hop (the user's own
 * trusted Jira origin). A redirect target is server-controlled — a
 * categorically different trust domain — so it is never passed through,
 * regardless of the caller's trust level.
 */
async function followValidatedRedirects(initialUrl, fetcher, lookup, headers, allowPrivateIp = false) {
  let url = initialUrl;
  await validateResolvedHost(new URL(url).hostname, lookup, allowPrivateIp);
  let response = await fetcher(url, { headers, redirect: 'manual' });
  let hops = 0;
  while (response.status >= 300 && response.status < 400) {
    hops++;
    if (hops > MAX_REDIRECT_HOPS) {
      throw new Error(`Too many redirects (>${MAX_REDIRECT_HOPS}) following ${initialUrl}`);
    }
    const location = response.headers?.get?.('location');
    if (!location) throw new Error('Redirect without Location header');
    const redirectUrl = new URL(location, url).href;
    if (!isSafeRedirectUrl(redirectUrl)) {
      throw new Error(`Redirect to blocked host (${new URL(redirectUrl).hostname}) rejected`);
    }
    await validateResolvedHost(new URL(redirectUrl).hostname, lookup);
    url = redirectUrl;
    // Safe CDN/S3 redirect — follow without auth (presigned URLs are self-authorizing)
    response = await fetcher(url, { redirect: 'manual' });
  }
  return response;
}

/**
 * @param {object} ticket         Normalized ticket (from normalizeTicket)
 * @param {object} opts
 * @param {object} opts.env       Env-like object with JIRA_BASE_URL + auth vars
 * @param {Function} opts.fetcher fetch-compatible function (default: globalThis.fetch)
 * @param {string} opts.configDir Base config dir (default: ~/.ticketlens)
 * @param {boolean} opts.noCache  Force re-download even if cached (default: false)
 * @param {Function} opts.onProgress  Optional callback(msg: string) for progress lines
 * @param {boolean} opts.allowPrivateIp  Skip the private-IP DNS check on the initial hop only (default: false)
 *
 * @returns {Promise<Array<{filename, mimeType, size, localPath, skipped, skipReason, error}>>}
 */
export async function downloadAttachments(ticket, opts = {}) {
  const {
    env = process.env,
    fetcher = globalThis.fetch,
    lookup = defaultLookupFor(fetcher),
    configDir = DEFAULT_CONFIG_DIR,
    noCache = false,
    onProgress = null,
    allowPrivateIp = false,
  } = opts;

  const attachments = (ticket.attachments ?? []).filter(a => a.content);
  if (attachments.length === 0) return [];

  const cacheDir = path.join(configDir, 'cache', ticket.key);
  fs.mkdirSync(cacheDir, { recursive: true });

  const jiraOrigin = env.JIRA_BASE_URL ? new URL(env.JIRA_BASE_URL).origin : null;

  // Attachments beyond the limit are bulk-skipped
  const capped = attachments.slice(0, MAX_ATTACHMENTS);
  const limited = attachments.slice(MAX_ATTACHMENTS).map(a => makeResult(a, null, 'limit', null));

  // Pre-classify: resolve immediate results, collect pending downloads
  const results = new Array(capped.length);
  const pending = [];

  for (let i = 0; i < capped.length; i++) {
    const a = capped[i];

    if (a.size && a.size > MAX_FILE_BYTES) {
      onProgress?.(`  skipped   ${a.filename} (${formatSize(a.size)} — exceeds 10 MB limit)`);
      results[i] = makeResult(a, null, 'too-large', null);
      continue;
    }

    const localPath = path.join(cacheDir, sanitizeFilename(a.filename));

    if (!noCache && fs.existsSync(localPath)) {
      onProgress?.(`  cached    ${a.filename}`);
      results[i] = makeResult(a, localPath, 'cached', null);
      continue;
    }

    // SSRF protection: only send auth headers to the configured Jira origin
    let contentOrigin;
    try { contentOrigin = new URL(a.content).origin; } catch { contentOrigin = null; }
    if (!contentOrigin || contentOrigin !== jiraOrigin) {
      onProgress?.(`  blocked   ${a.filename} (cross-origin URL rejected)`);
      results[i] = makeResult(a, null, 'ssrf-blocked', null);
      continue;
    }

    pending.push({ a, localPath, i });
  }

  // Download pending attachments in parallel batches of 3
  const BATCH = 3;
  for (let b = 0; b < pending.length; b += BATCH) {
    await Promise.all(pending.slice(b, b + BATCH).map(async ({ a, localPath, i }) => {
      onProgress?.(`  download  ${a.filename}`);
      try {
        const headers = buildAuthHeader(env);
        const response = await followValidatedRedirects(a.content, fetcher, lookup, headers, allowPrivateIp);
        if (!response.ok) throw new Error(`HTTP ${response.status} (${response.statusText})`);
        const buffer = await response.arrayBuffer();
        fs.writeFileSync(localPath, Buffer.from(buffer));
        results[i] = makeResult(a, localPath, null, null);
      } catch (err) {
        process.stderr.write(`  warning: failed to download ${a.filename}: ${err.message}\n`);
        results[i] = makeResult(a, null, 'error', err.message);
      }
    }));
  }

  return [...results, ...limited];
}

export function formatSize(bytes) {
  if (!bytes) return '?';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function makeResult(attachment, localPath, skipReason, error) {
  return {
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    localPath,
    skipped: localPath === null || skipReason === 'cached',
    skipReason,
    error,
  };
}

function sanitizeFilename(filename) {
  // Strip directory components, replace unsafe chars, preserve extension
  return path.basename(filename).replace(/[^a-zA-Z0-9._\-]/g, '_');
}
