import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanForLeaks } from '../../../../scripts/leak-scanner.mjs';

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'leak-scanner-test-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('scanForLeaks', () => {
  it('returns no violations for a clean tree', () => {
    writeFileSync(join(root, 'clean.mjs'), "export const x = 'PROJ-123';\n");
    assert.deepEqual(scanForLeaks(root, ['clean.mjs']), []);
  });

  it('reports the file and line number of a violation', () => {
    writeFileSync(join(root, 'dirty.mjs'), "// line 1\n// line 2\nconst t = 'ECNT-3888';\n");
    const violations = scanForLeaks(root, ['dirty.mjs']);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /^dirty\.mjs:3 —/);
  });

  it('detects bare ECNT with no trailing ticket number (not an English word, safe to match bare)', () => {
    writeFileSync(join(root, 'dirty.mjs'), 'Known creatable projects: CNV1, ECNT.\n');
    const violations = scanForLeaks(root, ['dirty.mjs']);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /Advent Jira ticket prefix/);
  });

  it('recurses into subdirectories for entries ending in "/"', () => {
    mkdirSync(join(root, 'lib', 'nested'), { recursive: true });
    writeFileSync(join(root, 'lib', 'nested', 'deep.mjs'), "const t = 'ASAP-42';\n");
    const violations = scanForLeaks(root, ['lib/']);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /^lib\/nested\/deep\.mjs:1 —/);
  });

  it('recurses into a directory entry even without a trailing "/" (detected via statSync, not string matching)', () => {
    mkdirSync(join(root, 'lib'));
    writeFileSync(join(root, 'lib', 'deep.mjs'), "const t = 'ASAP-42';\n");
    const violations = scanForLeaks(root, ['lib']);
    assert.equal(violations.length, 1);
  });

  it('does not match ASAP outside the ticket-key shape (ordinary English word)', () => {
    writeFileSync(join(root, 'prose.mjs'), '// reply asap please, this is not a ticket\n');
    assert.deepEqual(scanForLeaks(root, ['prose.mjs']), []);
  });

  it('matches ASAP only in the ticket-key shape', () => {
    writeFileSync(join(root, 'ticket.mjs'), "const t = 'ASAP-42';\n");
    const violations = scanForLeaks(root, ['ticket.mjs']);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /ASAP gateway ticket prefix/);
  });

  it('detects the pilot-client wrapper command name', () => {
    writeFileSync(join(root, 'a.mjs'), '// see advent-ticket for details\n');
    const violations = scanForLeaks(root, ['a.mjs']);
    assert.deepEqual(violations, ['a.mjs:1 — pilot-client wrapper command name (matched /advent-ticket/i)']);
  });

  it('does not double-report the lowercase wrapper command name as the bare employer name (case-sensitive)', () => {
    // The real wrapper command is lowercase kebab-case; the bare "Advent" pattern is
    // case-sensitive (proper-noun only) specifically so this common case reports once.
    writeFileSync(join(root, 'a.mjs'), '// see advent-ticket for details\n');
    const violations = scanForLeaks(root, ['a.mjs']);
    assert.equal(violations.length, 1);
  });

  it('detects the bare employer name as a capitalized proper noun', () => {
    writeFileSync(join(root, 'b.mjs'), '// built for Advent\n');
    const violations = scanForLeaks(root, ['b.mjs']);
    assert.deepEqual(violations, ['b.mjs:1 — employer name (matched /\\bAdvent\\b/)']);
  });

  it('does not flag lowercase "advent" as an ordinary English word', () => {
    writeFileSync(join(root, 'c.mjs'), '// the advent of AI-assisted development\n');
    assert.deepEqual(scanForLeaks(root, ['c.mjs']), []);
  });

  it('always scans README.md, LICENSE, and package.json even when absent from filesList', () => {
    writeFileSync(join(root, 'README.md'), 'Known creatable projects: ECNT-1.\n');
    writeFileSync(join(root, 'LICENSE'), 'MIT — ASAP-1\n');
    writeFileSync(join(root, 'package.json'), '{"name": "ECNT-1"}\n');
    const violations = scanForLeaks(root, []);
    assert.equal(violations.length, 3);
  });

  it('excludes exactly the given selfPath from the scan', () => {
    mkdirSync(join(root, 'scripts'));
    const selfFile = join(root, 'scripts', 'leak-scanner.mjs');
    writeFileSync(selfFile, 'const pattern = /ECNT-/i;\n');
    assert.deepEqual(scanForLeaks(root, ['scripts/'], selfFile), []);
  });

  it('does NOT exclude a different file that merely shares the same basename as the scanner module', () => {
    mkdirSync(join(root, 'other'));
    const decoy = join(root, 'other', 'leak-scanner.mjs');
    writeFileSync(decoy, 'const pattern = /ECNT-/i;\n');
    const realSelf = join(root, 'scripts', 'leak-scanner.mjs'); // does not exist — proves path-exact exclusion
    const violations = scanForLeaks(root, ['other/'], realSelf);
    assert.equal(violations.length, 1, 'a same-named file at a different path must still be scanned');
  });

  it('ignores a directory entry that does not exist', () => {
    assert.deepEqual(scanForLeaks(root, ['does-not-exist/']), []);
  });

  it('ignores a file entry that does not exist', () => {
    assert.deepEqual(scanForLeaks(root, ['does-not-exist.mjs']), []);
  });

  it('reports an unreadable file as a violation-shaped entry instead of throwing', () => {
    mkdirSync(join(root, 'lib'));
    symlinkSync('/nonexistent/target/path', join(root, 'lib', 'broken-link.mjs'));
    const violations = scanForLeaks(root, ['lib/']);
    assert.equal(violations.length, 1);
    assert.match(violations[0], /broken-link\.mjs — could not read file to scan for leaks/);
  });
});
