/**
 * Downloads ticket attachments from Jira to a local cache directory.
 * Supports all file types; respects a per-file size cap.
 * Auth headers are required — Jira attachment URLs are not public.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildAuthHeader } from './jira-client.mjs';

export const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.ticketlens');
const MAX_ATTACHMENTS = 20;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * @param {object} ticket         Normalized ticket (from normalizeTicket)
 * @param {object} opts
 * @param {object} opts.env       Env-like object with JIRA_BASE_URL + auth vars
 * @param {Function} opts.fetcher fetch-compatible function (default: globalThis.fetch)
 * @param {string} opts.configDir Base config dir (default: ~/.ticketlens)
 * @param {boolean} opts.noCache  Force re-download even if cached (default: false)
 * @param {Function} opts.onProgress  Optional callback(msg: string) for progress lines
 *
 * @returns {Promise<Array<{filename, mimeType, size, localPath, skipped, skipReason, error}>>}
 */
export async function downloadAttachments(ticket, opts = {}) {
  const {
    env = process.env,
    fetcher = globalThis.fetch,
    configDir = DEFAULT_CONFIG_DIR,
    noCache = false,
    onProgress = null,
  } = opts;

  const attachments = (ticket.attachments ?? []).filter(a => a.content);
  if (attachments.length === 0) return [];

  const cacheDir = path.join(configDir, 'cache', ticket.key);
  fs.mkdirSync(cacheDir, { recursive: true });

  const results = [];

  for (let i = 0; i < attachments.length; i++) {
    if (i >= MAX_ATTACHMENTS) {
      for (let j = i; j < attachments.length; j++) {
        results.push(makeResult(attachments[j], null, 'limit', null));
      }
      break;
    }

    const a = attachments[i];

    if (a.size && a.size > MAX_FILE_BYTES) {
      onProgress?.(`  skipped   ${a.filename} (${formatSize(a.size)} — exceeds 10 MB limit)`);
      results.push(makeResult(a, null, 'too-large', null));
      continue;
    }

    const localPath = path.join(cacheDir, sanitizeFilename(a.filename));

    if (!noCache && fs.existsSync(localPath)) {
      onProgress?.(`  cached    ${a.filename}`);
      results.push(makeResult(a, localPath, 'cached', null));
      continue;
    }

    onProgress?.(`  download  ${a.filename}`);

    try {
      const headers = buildAuthHeader(env);
      const response = await fetcher(a.content, { headers });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} (${response.statusText})`);
      }

      const buffer = await response.arrayBuffer();
      fs.writeFileSync(localPath, Buffer.from(buffer));

      results.push(makeResult(a, localPath, null, null));
    } catch (err) {
      process.stderr.write(`  warning: failed to download ${a.filename}: ${err.message}\n`);
      results.push(makeResult(a, null, 'error', err.message));
    }
  }

  return results;
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
