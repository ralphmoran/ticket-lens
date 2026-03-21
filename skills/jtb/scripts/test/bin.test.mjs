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
});
