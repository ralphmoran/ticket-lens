import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseAge, getCacheEntries, getCacheSize, formatAge, run } from '../lib/cache-manager.mjs';

let tmpDir;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jtb-cache-test-'));
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeFile(configDir, ticketKey, filename, content = 'data', ageDays = 0) {
  const dir = path.join(configDir, 'cache', ticketKey);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, content);
  if (ageDays > 0) {
    const mtime = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
    fs.utimesSync(filePath, mtime, mtime);
  }
  return filePath;
}

function captureOutput() {
  const lines = [];
  return {
    write: (s) => lines.push(s),
    isTTY: false,
    get output() { return lines.join(''); },
  };
}

function noopStdin() {
  return { isTTY: false, setRawMode: () => {}, resume: () => {}, pause: () => {}, once: () => {} };
}

function makeProfiles(configDir, profiles) {
  fs.writeFileSync(
    path.join(configDir, 'profiles.json'),
    JSON.stringify({ profiles }, null, 2)
  );
}

// ─── parseAge ────────────────────────────────────────────────────────────────

describe('parseAge', () => {
  it('parses days', () => {
    assert.equal(parseAge('7d'), 7 * 24 * 60 * 60 * 1000);
  });

  it('parses months as 30 days', () => {
    assert.equal(parseAge('2m'), 2 * 30 * 24 * 60 * 60 * 1000);
  });

  it('parses years as 365 days', () => {
    assert.equal(parseAge('1y'), 365 * 24 * 60 * 60 * 1000);
  });

  it('returns null for invalid format', () => {
    assert.equal(parseAge('7'), null);
    assert.equal(parseAge('7w'), null);
    assert.equal(parseAge('abc'), null);
    assert.equal(parseAge(''), null);
    assert.equal(parseAge(null), null);
  });

  it('handles large numbers', () => {
    assert.equal(parseAge('365d'), 365 * 24 * 60 * 60 * 1000);
  });
});

// ─── getCacheEntries ─────────────────────────────────────────────────────────

describe('getCacheEntries', () => {
  it('returns empty array when cache dir does not exist', () => {
    assert.deepStrictEqual(getCacheEntries(tmpDir), []);
  });

  it('returns empty array when cache dir is empty', () => {
    fs.mkdirSync(path.join(tmpDir, 'cache'), { recursive: true });
    assert.deepStrictEqual(getCacheEntries(tmpDir), []);
  });

  it('returns entries for all tickets', () => {
    makeFile(tmpDir, 'PROJ-1', 'screenshot.png');
    makeFile(tmpDir, 'PROJ-2', 'spec.pdf');
    const entries = getCacheEntries(tmpDir);
    assert.equal(entries.length, 2);
    assert.ok(entries.some(e => e.ticketKey === 'PROJ-1' && e.filename === 'screenshot.png'));
    assert.ok(entries.some(e => e.ticketKey === 'PROJ-2' && e.filename === 'spec.pdf'));
  });

  it('filters by ticket key', () => {
    makeFile(tmpDir, 'PROJ-1', 'a.png');
    makeFile(tmpDir, 'PROJ-2', 'b.png');
    const entries = getCacheEntries(tmpDir, 'PROJ-1');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].ticketKey, 'PROJ-1');
  });

  it('returns empty array when ticket key has no cache', () => {
    const entries = getCacheEntries(tmpDir, 'PROJ-999');
    assert.deepStrictEqual(entries, []);
  });

  it('entry includes localPath, size, and mtimeMs', () => {
    makeFile(tmpDir, 'PROJ-1', 'file.txt', 'hello');
    const [entry] = getCacheEntries(tmpDir);
    assert.ok(entry.localPath.endsWith('file.txt'));
    assert.equal(entry.size, 5);
    assert.ok(typeof entry.mtimeMs === 'number');
  });

  it('handles multiple files in a single ticket dir', () => {
    makeFile(tmpDir, 'PROJ-1', 'a.png');
    makeFile(tmpDir, 'PROJ-1', 'b.pdf');
    makeFile(tmpDir, 'PROJ-1', 'c.txt');
    const entries = getCacheEntries(tmpDir, 'PROJ-1');
    assert.equal(entries.length, 3);
  });
});

// ─── getCacheSize ─────────────────────────────────────────────────────────────

describe('getCacheSize', () => {
  it('returns 0 when cache is empty', () => {
    assert.equal(getCacheSize(tmpDir), 0);
  });

  it('sums sizes of all files', () => {
    makeFile(tmpDir, 'PROJ-1', 'a.txt', 'hello');       // 5 bytes
    makeFile(tmpDir, 'PROJ-2', 'b.txt', 'world!!');     // 7 bytes
    assert.equal(getCacheSize(tmpDir), 12);
  });
});

// ─── formatAge ───────────────────────────────────────────────────────────────

describe('formatAge', () => {
  const now = Date.now();
  it('formats today', () => assert.equal(formatAge(now - 1000), 'today'));
  it('formats 1 day', () => assert.equal(formatAge(now - 1 * 24 * 60 * 60 * 1000), '1 day ago'));
  it('formats N days', () => assert.equal(formatAge(now - 5 * 24 * 60 * 60 * 1000), '5 days ago'));
  it('formats 1 month', () => assert.equal(formatAge(now - 30 * 24 * 60 * 60 * 1000), '1 month ago'));
  it('formats N months', () => assert.equal(formatAge(now - 60 * 24 * 60 * 60 * 1000), '2 months ago'));
  it('formats 1 year', () => assert.equal(formatAge(now - 365 * 24 * 60 * 60 * 1000), '1 year ago'));
  it('formats N years', () => assert.equal(formatAge(now - 730 * 24 * 60 * 60 * 1000), '2 years ago'));
});

// ─── cache size subcommand ───────────────────────────────────────────────────

describe('run — cache size', () => {
  it('reports empty cache', async () => {
    const out = captureOutput();
    await run(['size'], { configDir: tmpDir, stdout: out, stderr: out, stdin: noopStdin() });
    assert.ok(out.output.includes('No cached attachments found'));
  });

  it('reports total size and per-ticket breakdown', async () => {
    makeFile(tmpDir, 'PROJ-1', 'screenshot.png', 'x'.repeat(1024));
    makeFile(tmpDir, 'PROJ-2', 'spec.pdf', 'y'.repeat(2048));
    const out = captureOutput();
    await run(['size'], { configDir: tmpDir, stdout: out, stderr: out, stdin: noopStdin() });
    assert.ok(out.output.includes('PROJ-1'));
    assert.ok(out.output.includes('PROJ-2'));
    assert.ok(out.output.includes('3KB') || out.output.includes('3 KB') || out.output.match(/3[.,]\d+KB/));
  });
});

// ─── cache clear — age filtering ─────────────────────────────────────────────

describe('run — cache clear age filtering', () => {
  it('deletes all files when no filter', async () => {
    makeFile(tmpDir, 'PROJ-1', 'a.png');
    makeFile(tmpDir, 'PROJ-2', 'b.pdf');
    const out = captureOutput();
    await run(['clear', '--yes'], { configDir: tmpDir, stdout: out, stderr: out, stdin: noopStdin() });
    assert.equal(getCacheEntries(tmpDir).length, 0);
  });

  it('deletes only files older than threshold', async () => {
    makeFile(tmpDir, 'PROJ-1', 'old.png', 'x', 10);  // 10 days old
    makeFile(tmpDir, 'PROJ-2', 'new.png', 'x', 1);   // 1 day old
    const out = captureOutput();
    await run(['clear', '--older-than=7d', '--yes'], { configDir: tmpDir, stdout: out, stderr: out, stdin: noopStdin() });
    const remaining = getCacheEntries(tmpDir);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].filename, 'new.png');
  });

  it('deletes only files for specified ticket key', async () => {
    makeFile(tmpDir, 'PROJ-1', 'a.png');
    makeFile(tmpDir, 'PROJ-2', 'b.png');
    const out = captureOutput();
    await run(['clear', 'PROJ-1', '--yes'], { configDir: tmpDir, stdout: out, stderr: out, stdin: noopStdin() });
    const remaining = getCacheEntries(tmpDir);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].ticketKey, 'PROJ-2');
  });

  it('combines ticket key and age filter', async () => {
    makeFile(tmpDir, 'PROJ-1', 'old.png', 'x', 10);
    makeFile(tmpDir, 'PROJ-1', 'new.png', 'x', 1);
    makeFile(tmpDir, 'PROJ-2', 'old.pdf', 'x', 10);  // different ticket, should not be touched
    const out = captureOutput();
    await run(['clear', 'PROJ-1', '--older-than=7d', '--yes'], { configDir: tmpDir, stdout: out, stderr: out, stdin: noopStdin() });
    const remaining = getCacheEntries(tmpDir);
    assert.equal(remaining.length, 2);  // PROJ-1/new.png + PROJ-2/old.pdf
    assert.ok(remaining.some(e => e.ticketKey === 'PROJ-1' && e.filename === 'new.png'));
    assert.ok(remaining.some(e => e.ticketKey === 'PROJ-2'));
  });

  it('reports no matches when nothing meets the filter', async () => {
    makeFile(tmpDir, 'PROJ-1', 'new.png', 'x', 1);
    const out = captureOutput();
    await run(['clear', '--older-than=7d', '--yes'], { configDir: tmpDir, stdout: out, stderr: out, stdin: noopStdin() });
    assert.ok(out.output.includes('No cached files'));
    assert.equal(getCacheEntries(tmpDir).length, 1);
  });

  it('reports error for invalid --older-than value', async () => {
    const out = captureOutput();
    const err = captureOutput();
    await run(['clear', '--older-than=bad'], { configDir: tmpDir, stdout: out, stderr: err, stdin: noopStdin() });
    assert.ok(err.output.includes('Invalid'));
    assert.equal(process.exitCode, 1);
    process.exitCode = 0; // reset
  });

  it('removes empty ticket dir after clearing all its files', async () => {
    makeFile(tmpDir, 'PROJ-1', 'only.png');
    await run(['clear', 'PROJ-1', '--yes'], { configDir: tmpDir, stdout: captureOutput(), stderr: captureOutput(), stdin: noopStdin() });
    assert.ok(!fs.existsSync(path.join(tmpDir, 'cache', 'PROJ-1')));
  });

  it('skips confirmation when --yes flag is present', async () => {
    makeFile(tmpDir, 'PROJ-1', 'a.png');
    let stdinUsed = false;
    const fakeStdin = { isTTY: true, setRawMode: () => { stdinUsed = true; }, resume: () => {}, pause: () => {}, once: () => {} };
    await run(['clear', '--yes'], { configDir: tmpDir, stdout: captureOutput(), stderr: captureOutput(), stdin: fakeStdin });
    assert.equal(stdinUsed, false);
  });

  it('reports how many files were deleted and size freed', async () => {
    makeFile(tmpDir, 'PROJ-1', 'a.png', 'x'.repeat(500));
    makeFile(tmpDir, 'PROJ-1', 'b.pdf', 'y'.repeat(500));
    const out = captureOutput();
    await run(['clear', '--yes'], { configDir: tmpDir, stdout: out, stderr: out, stdin: noopStdin() });
    assert.ok(out.output.includes('Deleted 2 files'));
  });
});

// ─── profile-aware size ───────────────────────────────────────────────────────

describe('run — cache size with profiles', () => {
  it('shows profile name in size output when profiles.json is present', async () => {
    makeProfiles(tmpDir, {
      work:  { ticketPrefixes: ['PROJ'] },
      advent: { ticketPrefixes: ['ECNT'] },
    });
    makeFile(tmpDir, 'PROJ-1', 'a.png', 'x'.repeat(100));
    makeFile(tmpDir, 'ECNT-1', 'b.png', 'y'.repeat(200));
    const out = captureOutput();
    await run(['size'], { configDir: tmpDir, stdout: out, stderr: out, stdin: noopStdin() });
    assert.ok(out.output.includes('work'),   'should show work profile');
    assert.ok(out.output.includes('advent'), 'should show advent profile');
    assert.ok(out.output.includes('PROJ-1'), 'should list PROJ-1 under work');
    assert.ok(out.output.includes('ECNT-1'), 'should list ECNT-1 under advent');
  });

  it('groups unconfigured ticket keys separately', async () => {
    makeProfiles(tmpDir, {
      work: { ticketPrefixes: ['PROJ'] },
    });
    makeFile(tmpDir, 'PROJ-1', 'a.png');
    makeFile(tmpDir, 'UNKNOWN-99', 'b.png');
    const out = captureOutput();
    await run(['size'], { configDir: tmpDir, stdout: out, stderr: out, stdin: noopStdin() });
    assert.ok(out.output.includes('work'));
    assert.ok(out.output.includes('unconfigured'));
    assert.ok(out.output.includes('UNKNOWN-99'));
  });
});

// ─── profile-aware clear ──────────────────────────────────────────────────────

describe('run — cache clear with --profile', () => {
  it('--profile clears only tickets matching that profile\'s prefixes', async () => {
    makeProfiles(tmpDir, {
      work:   { ticketPrefixes: ['PROJ'] },
      advent: { ticketPrefixes: ['ECNT'] },
    });
    makeFile(tmpDir, 'PROJ-1', 'a.png');
    makeFile(tmpDir, 'ECNT-1', 'b.png');
    const out = captureOutput();
    await run(['clear', '--profile=work', '--yes'], { configDir: tmpDir, stdout: out, stderr: out, stdin: noopStdin() });
    const remaining = getCacheEntries(tmpDir);
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].ticketKey, 'ECNT-1', 'advent ticket should not be touched');
  });

  it('--profile and --older-than combine: only old files from that profile', async () => {
    makeProfiles(tmpDir, {
      work: { ticketPrefixes: ['PROJ'] },
    });
    makeFile(tmpDir, 'PROJ-1', 'old.png', 'x', 10);
    makeFile(tmpDir, 'PROJ-1', 'new.png', 'x', 1);
    makeFile(tmpDir, 'ECNT-1', 'old.png', 'x', 10);  // different profile — untouched
    const out = captureOutput();
    await run(['clear', '--profile=work', '--older-than=7d', '--yes'], { configDir: tmpDir, stdout: out, stderr: out, stdin: noopStdin() });
    const remaining = getCacheEntries(tmpDir);
    assert.equal(remaining.length, 2);
    assert.ok(remaining.some(e => e.ticketKey === 'PROJ-1' && e.filename === 'new.png'));
    assert.ok(remaining.some(e => e.ticketKey === 'ECNT-1'));
  });

  it('reports no matches when --profile has no tickets in cache', async () => {
    makeProfiles(tmpDir, {
      work: { ticketPrefixes: ['PROJ'] },
    });
    makeFile(tmpDir, 'ECNT-1', 'a.png');
    const out = captureOutput();
    await run(['clear', '--profile=work', '--yes'], { configDir: tmpDir, stdout: out, stderr: out, stdin: noopStdin() });
    assert.ok(out.output.includes('No cached files'));
    assert.equal(getCacheEntries(tmpDir).length, 1, 'ECNT-1 should survive');
  });

  it('skips profile picker in non-TTY mode and clears all with --yes', async () => {
    makeProfiles(tmpDir, {
      work:   { ticketPrefixes: ['PROJ'] },
      advent: { ticketPrefixes: ['ECNT'] },
    });
    makeFile(tmpDir, 'PROJ-1', 'a.png');
    makeFile(tmpDir, 'ECNT-1', 'b.png');
    const out = captureOutput();
    // non-TTY (isTTY:false) → profile picker not shown; --yes → no confirmation
    await run(['clear', '--yes'], { configDir: tmpDir, stdout: out, stderr: out, stdin: noopStdin() });
    assert.equal(getCacheEntries(tmpDir).length, 0, 'all files cleared');
    assert.ok(!out.output.includes('Which profile'), 'no picker output in non-TTY');
  });
});

// ─── cli routing ─────────────────────────────────────────────────────────────

describe('run — unknown subcommand', () => {
  it('writes error and sets exitCode for unknown subcommand', async () => {
    const err = captureOutput();
    await run(['bogus'], { configDir: tmpDir, stdout: captureOutput(), stderr: err, stdin: noopStdin() });
    assert.ok(err.output.includes('Unknown cache subcommand'));
    process.exitCode = 0;
  });
});
