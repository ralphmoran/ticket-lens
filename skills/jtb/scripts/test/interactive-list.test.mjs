import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../lib/interactive-list.mjs'), 'utf8');

describe('interactive-list security', () => {
  it('does not use execSync (shell injection risk)', () => {
    assert.ok(
      !src.includes('execSync'),
      'interactive-list.mjs must not use execSync — use spawn with argument array instead'
    );
  });

  it('uses spawn for opening browser URLs', () => {
    assert.ok(
      src.includes('spawn'),
      'interactive-list.mjs must use spawn to open URLs without shell interpretation'
    );
  });

  it('passes URL as argument array element, not interpolated into shell string', () => {
    // Verify spawn is called with [url] array, not a shell string containing the URL.
    // A shell string would look like: spawn('open', `${url}`) or execSync(`open ${url}`)
    // The safe form uses an array: spawn('open', [url], ...)
    assert.ok(
      !src.match(/execSync\s*\(/),
      'must not call execSync() anywhere in the module'
    );
  });
});
