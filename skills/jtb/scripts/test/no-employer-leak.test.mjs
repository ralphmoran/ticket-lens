import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanForLeaks } from '../../../../scripts/leak-scanner.mjs';

/**
 * Content-presence check across every file npm actually ships (package.json's
 * `files` list, plus README/LICENSE/package.json which npm always includes),
 * not just the two files a human happened to catch by hand (CR-2 in SKILL.md,
 * H-4 in profile-picker.mjs). A real employer/pilot-client reference in any
 * shipped file is a privacy leak distributed to every `npm install -g
 * ticketlens`. See docs/audits/2026-08-01-full-feature-audit.md.
 *
 * Scan logic lives in scripts/leak-scanner.mjs, shared with the
 * `checkForLeaks` preflight gate that runs before every real publish.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..', '..');
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

describe('npm package contents — no employer/pilot-client leaks', () => {
  it('contains none of the banned employer-identifying patterns in any shipped file', () => {
    assert.deepEqual(scanForLeaks(ROOT, PKG.files), []);
  });
});
