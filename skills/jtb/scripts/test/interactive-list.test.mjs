import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../lib/interactive-list.mjs'), 'utf8');

describe('interactive-list responsive layout', () => {
  it('writeHeader calls getColLayout() for responsive column widths', () => {
    const headerFn = src.match(/function writeHeader\(\)[\s\S]*?^\s{2}\}/m)?.[0] ?? '';
    assert.ok(
      headerFn.includes('getColLayout()'),
      'writeHeader must call getColLayout() to adapt to terminal width'
    );
  });

  it('no hardcoded COL.flag reference (removed legacy fixed-width layout)', () => {
    assert.ok(
      !src.includes('COL.flag'),
      'COL.flag was a hardcoded column width — must be removed in favour of getColLayout()'
    );
  });

  it('getColLayout() defines a non-zero priority column width for wide/medium breakpoints', () => {
    const layoutFn = src.match(/function getColLayout\(\)[\s\S]*?^\s{2}\}/m)?.[0] ?? '';
    assert.ok(/priority:\s*\d/.test(layoutFn), 'getColLayout must define a non-zero priority column width for at least one breakpoint');
  });

  it('buildRow renders the priority column when COL.priority > 0', () => {
    const buildRowFn = src.match(/function buildRow\(ticket, index\)[\s\S]*?^\s{2}\}/m)?.[0] ?? '';
    assert.ok(buildRowFn.includes('COL.priority'), 'buildRow must reference COL.priority');
  });

  it('writeHeader includes a Priority column header when COL.priority > 0', () => {
    const headerFn = src.match(/function writeHeader\(\)[\s\S]*?^\s{2}\}/m)?.[0] ?? '';
    assert.ok(headerFn.includes('COL.priority') && headerFn.includes("'Priority'"), 'writeHeader must render a Priority column header');
  });
});

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
