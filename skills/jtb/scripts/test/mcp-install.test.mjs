import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mcpInstall } from '../lib/mcp-install.mjs';

function freshDir() {
  return mkdtempSync(join(tmpdir(), 'ticketlens-mcp-install-'));
}

function silentStream() {
  const lines = [];
  return { write: (s) => { lines.push(s); return true; }, get text() { return lines.join(''); } };
}

describe('mcp-install', () => {
  let cwd;
  beforeEach(() => { cwd = freshDir(); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  it('no existing .mcp.json: creates one with the ticketlens entry', () => {
    const stream = silentStream();
    const result = mcpInstall({ cwd, stream, isLicensedFn: () => true });
    assert.equal(result.written, true);
    const written = JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8'));
    assert.deepEqual(written.mcpServers.ticketlens, { command: 'ticketlens', args: ['mcp'] });
  });

  it('existing .mcp.json with unrelated servers: preserves them exactly, adds ticketlens alongside', () => {
    const before = { mcpServers: { 'claude-flow': { command: 'npx', args: ['-y', 'x'], env: { A: '1' }, autoStart: false } } };
    writeFileSync(join(cwd, '.mcp.json'), JSON.stringify(before, null, 2) + '\n');
    const stream = silentStream();
    mcpInstall({ cwd, stream, isLicensedFn: () => true });
    const written = JSON.parse(readFileSync(join(cwd, '.mcp.json'), 'utf8'));
    assert.deepEqual(written.mcpServers['claude-flow'], before.mcpServers['claude-flow']);
    assert.deepEqual(written.mcpServers.ticketlens, { command: 'ticketlens', args: ['mcp'] });
  });

  it('malformed JSON: hard-fails, writes nothing, leaves the original content untouched', () => {
    const badContent = '{ this is not json,,,';
    writeFileSync(join(cwd, '.mcp.json'), badContent);
    const stream = silentStream();
    const result = mcpInstall({ cwd, stream, isLicensedFn: () => true });
    assert.equal(result.written, false);
    assert.match(stream.text, /not valid JSON/);
    assert.equal(readFileSync(join(cwd, '.mcp.json'), 'utf8'), badContent, 'original malformed content must survive untouched');
  });

  it('mcpServers present but wrong shape (a string): hard-fails, never coerces', () => {
    writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: 'not-an-object' }));
    const stream = silentStream();
    const result = mcpInstall({ cwd, stream, isLicensedFn: () => true });
    assert.equal(result.written, false);
    assert.match(stream.text, /"mcpServers".*not an object/);
  });

  for (const [label, content] of [
    ['a top-level array', '[1,2,3]'],
    ['a top-level null', 'null'],
    ['a top-level number', '5'],
    ['a top-level string', '"hello"'],
    ['a top-level boolean', 'true'],
  ]) {
    it(`.mcp.json is valid JSON but ${label}: hard-fails cleanly, never crashes, never silently no-ops`, () => {
      writeFileSync(join(cwd, '.mcp.json'), content);
      const stream = silentStream();
      const result = mcpInstall({ cwd, stream, isLicensedFn: () => true });
      assert.equal(result.written, false, 'must not report success for a document it did not actually modify');
      assert.match(stream.text, /not a JSON object/);
      assert.equal(readFileSync(join(cwd, '.mcp.json'), 'utf8'), content, 'original content must survive untouched');
    });
  }

  it('already has the correct ticketlens entry: idempotent, reports already-registered, no rewrite drift', () => {
    const stream1 = silentStream();
    mcpInstall({ cwd, stream: stream1, isLicensedFn: () => true });
    const firstWrite = readFileSync(join(cwd, '.mcp.json'), 'utf8');

    const stream2 = silentStream();
    const result2 = mcpInstall({ cwd, stream: stream2, isLicensedFn: () => true });
    assert.equal(result2.written, false);
    assert.equal(result2.alreadyCorrect, true);
    assert.match(stream2.text, /Already registered/);
    assert.equal(readFileSync(join(cwd, '.mcp.json'), 'utf8'), firstWrite, 're-running must not change the file at all');
  });

  it('--dry-run: prints the result, writes nothing, no .mcp.json created', () => {
    const stream = silentStream();
    const result = mcpInstall({ cwd, stream, isLicensedFn: () => true, dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(result.written, false);
    assert.equal(existsSync(join(cwd, '.mcp.json')), false);
    assert.match(stream.text, /Would write/);
  });

  it('unlicensed account gets an informational note; licensed account does not', () => {
    const streamUnlicensed = silentStream();
    mcpInstall({ cwd, stream: streamUnlicensed, isLicensedFn: () => false });
    assert.match(streamUnlicensed.text, /require a Pro license/);

    const cwd2 = freshDir();
    try {
      const streamLicensed = silentStream();
      mcpInstall({ cwd: cwd2, stream: streamLicensed, isLicensedFn: () => true });
      assert.doesNotMatch(streamLicensed.text, /require a Pro license/);
    } finally {
      rmSync(cwd2, { recursive: true, force: true });
    }
  });

  it('atomic write: no stray .tmp file remains after a successful write', () => {
    const stream = silentStream();
    mcpInstall({ cwd, stream, isLicensedFn: () => true });
    const leftoverTmp = readdirSync(cwd).filter(f => f.includes('.tmp'));
    assert.deepEqual(leftoverTmp, [], 'renameSync must consume the temp file, none left behind');
  });
});
