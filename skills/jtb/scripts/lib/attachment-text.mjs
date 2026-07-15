/**
 * Pulls plain text out of an already-downloaded ticket attachment, so a
 * Recall note can be seeded from it. Only handles formats that are already
 * plain text: .txt, .md, .csv, .json. Everything else (PDFs, images, office
 * documents) returns null — reading those needs a vision/OCR step, which is
 * out of scope here.
 */

import fs from 'node:fs';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.csv']);

/**
 * @param {string} localPath - path to an already-cached attachment file
 * @returns {string|null}
 */
export function extractText(localPath) {
  const ext = path.extname(localPath).toLowerCase();
  if (!TEXT_EXTENSIONS.has(ext) && ext !== '.json') return null;

  let raw;
  try {
    raw = fs.readFileSync(localPath, 'utf8');
  } catch {
    return null;
  }

  if (ext !== '.json') return raw;

  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw; // malformed JSON — still useful as raw text
  }
}
