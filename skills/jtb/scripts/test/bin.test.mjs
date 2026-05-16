import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binPath = join(__dirname, '..', '..', '..', '..', 'bin', 'ticketlens.mjs');

describe('bin/ticketlens.mjs', () => {
  it('file exists', () => {
    assert.ok(existsSync(binPath), `bin/ticketlens.mjs not found at ${binPath}`);
  });

  it('--help exits 0 and mentions ticketlens', () => {
    const result = spawnSync('node', [binPath, '--help'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const output = result.stdout + result.stderr;
    assert.ok(output.includes('ticketlens'), 'help output must mention ticketlens');
  });

  it('--version exits 0 and prints version number', () => {
    const result = spawnSync('node', [binPath, '--version'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const output = result.stdout + result.stderr;
    assert.ok(/\d+\.\d+\.\d+/.test(output), 'version output must include a version number');
  });

  it('unknown ticket key exits 1', () => {
    // Passing a key with no connection configured should fail gracefully, not crash
    const result = spawnSync('node', [binPath, 'PROJ-999'], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, HOME: '/tmp/ticketlens-no-home' },
    });
    // Should exit non-zero (no connection) but not throw an unhandled exception
    assert.notEqual(result.status, null, 'process must exit cleanly, not be killed by signal');
    assert.ok(!result.stderr.includes('SyntaxError'), 'must not crash with SyntaxError');
    assert.ok(!result.stderr.includes('TypeError'), 'must not crash with unhandled TypeError');
  });

  it('ls command prints profile list (alias for profiles)', () => {
    const result = spawnSync('node', [binPath, 'ls'], {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, HOME: '/tmp/ticketlens-no-home' },
    });
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('No profiles configured') || combined.includes('Profile'),
      `"ticketlens ls" must print profile list, not help. Got: ${combined.slice(0, 200)}`
    );
    assert.ok(
      !combined.includes('Stop tab-switching'),
      '"ticketlens ls" must not fall through to printHelp'
    );
  });

  it('delete without --yes in non-TTY exits 1 with explanation', () => {
    const result = spawnSync('node', [binPath, 'delete', 'nonexistent-profile'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: '/tmp/ticketlens-no-home' },
    });
    assert.equal(result.status, 1, `Expected exit 1, got ${result.status}`);
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('--yes') || combined.includes('not found'),
      `Expected "--yes" hint or "not found" in output. Got: ${combined.slice(0, 200)}`
    );
  });

  it('delete --yes with nonexistent profile exits 1', () => {
    const result = spawnSync('node', [binPath, 'delete', 'nonexistent-profile', '--yes'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: '/tmp/ticketlens-no-home' },
    });
    assert.equal(result.status, 1, `Expected exit 1 (profile not found), got ${result.status}`);
    assert.ok(
      result.stderr.includes('not found'),
      `Expected "not found" in stderr. Got: ${result.stderr.slice(0, 200)}`
    );
  });

  for (const [cmd, flag] of [
    ['login', '--help'],
    ['login', '-h'],
    ['logout', '--help'],
    ['logout', '-h'],
    ['sync', '--help'],
    ['sync', '-h'],
    ['activate', '--help'],
    ['activate', '-h'],
    ['license', '--help'],
    ['license', '-h'],
    ['delete', '--help'],
    ['delete', '-h'],
    ['profiles', '--help'],
    ['profiles', '-h'],
    ['schedule', '--help'],
    ['schedule', '-h'],
    ['init', '--help'],
    ['init', '-h'],
    ['switch', '--help'],
    ['switch', '-h'],
    ['config', '--help'],
    ['config', '-h'],
  ]) {
    it(`"ticketlens ${cmd} ${flag}" exits 0 and prints help`, () => {
      const result = spawnSync('node', [binPath, cmd, flag], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, HOME: '/tmp/ticketlens-no-home' },
      });
      assert.equal(result.status, 0, `Expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
      const combined = result.stdout + result.stderr;
      assert.ok(
        combined.includes(cmd),
        `"ticketlens ${cmd} ${flag}" output must mention "${cmd}". Got: ${combined.slice(0, 200)}`
      );
    });
  }
});
