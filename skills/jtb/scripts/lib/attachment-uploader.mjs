/**
 * Validates and reads local files for upload to a tracker (Jira attachment
 * API, Linear fileUpload). Shared across trackers — the read/validate step
 * is identical regardless of where the bytes end up.
 *
 * No path allowlist: the caller (a human, or an AI harness the human is
 * directing) is trusted to supply a legitimate path — the same trust
 * boundary already extended to every other free-text write field in this
 * ticket-write family (comment bodies, summaries). This was a deliberate,
 * reviewed choice, not an oversight — see the security-reviewer pass for
 * this feature.
 */

import fs from 'node:fs';
import path from 'node:path';
import { sanitizeFilename } from './attachment-downloader.mjs';

export const MAX_ATTACHMENTS = 20; // mirrors attachment-downloader.mjs's download-side cap
export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB — same
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB aggregate per call — bounds worst-case memory use across a whole batch

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.zip': 'application/zip',
};

function mimeTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Size is checked via a stat call BEFORE reading the file into memory — a
 * path to a huge file is rejected without ever buffering it.
 *
 * @returns {{ path: string, filename: string, buffer: Buffer, mimeType: string, size: number }
 *          | { path: string, error: 'not-found'|'not-a-file'|'empty'|'too-large' }}
 */
export function readAttachmentFile(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return { path: filePath, error: 'not-found' };
  }
  if (!stat.isFile()) return { path: filePath, error: 'not-a-file' };
  if (stat.size === 0) return { path: filePath, error: 'empty' };
  if (stat.size > MAX_FILE_BYTES) return { path: filePath, error: 'too-large' };

  return {
    path: filePath,
    filename: sanitizeFilename(path.basename(filePath)),
    buffer: fs.readFileSync(filePath),
    mimeType: mimeTypeFor(filePath),
    size: stat.size,
  };
}

/**
 * Reads a batch of paths, best-effort — one bad path never blocks the rest.
 * Paths beyond MAX_ATTACHMENTS are dropped and counted, not silently read.
 * A cheap pre-stat tracks the running total so a file that would push the
 * batch over MAX_TOTAL_BYTES is rejected without ever being buffered — same
 * "reject before read" principle as the per-file size cap. The pre-stat's
 * own errors are ignored here; readAttachmentFile below produces the real,
 * specific error (not-found/not-a-file/etc.) for those paths.
 *
 * @param {string[]} paths
 * @returns {{ files: Array<{ok: boolean} & (ReturnType<typeof readAttachmentFile>)>, droppedCount: number }}
 */
export function readAttachments(paths) {
  const capped = paths.slice(0, MAX_ATTACHMENTS);
  const files = [];
  let totalBytes = 0;
  for (const p of capped) {
    let precheckSize = 0;
    try { precheckSize = fs.statSync(p).size; } catch { /* handled below */ }
    if (precheckSize > 0 && totalBytes + precheckSize > MAX_TOTAL_BYTES) {
      files.push({ ok: false, path: p, error: 'total-size-exceeded' });
      continue;
    }
    const result = readAttachmentFile(p);
    if (!result.error) totalBytes += result.size;
    files.push({ ok: !result.error, ...result });
  }
  return { files, droppedCount: paths.length - capped.length };
}
