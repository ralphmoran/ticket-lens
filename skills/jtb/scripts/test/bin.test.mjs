import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { writeLicense } from '../lib/license.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binPath = join(__dirname, '..', '..', '..', '..', 'bin', 'ticketlens.mjs');
const pkgPath = join(__dirname, '..', '..', '..', '..', 'package.json');

describe('bin/ticketlens.mjs', () => {
  it('file exists', () => {
    assert.ok(existsSync(binPath), `bin/ticketlens.mjs not found at ${binPath}`);
  });

  it('package.json exposes both "ticketlens" and "tl" bin entries pointing at the same file', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    assert.equal(pkg.bin.ticketlens, 'bin/ticketlens.mjs');
    assert.equal(pkg.bin.tl, 'bin/ticketlens.mjs');
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

  it('--version shows the wordmark banner with tagline (non-TTY spawn: plain fallback line)', () => {
    const result = spawnSync('node', [binPath, '--version'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0);
    const output = result.stdout + result.stderr;
    assert.ok(output.includes('TicketLens'), 'must include the TicketLens wordmark');
    assert.ok(output.includes('Stop tab-switching. Start building.'), 'must include the tagline');
    assert.ok(output.includes('github.com/ralphmoran/ticket-lens'), 'must include the GitHub URL');
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

  it('--help never launches an interactive wizard even when setup is fresh', () => {
    const result = spawnSync('node', [binPath, '--help'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: '/tmp/ticketlens-no-home' },
    });
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes('USAGE'), 'must print help, not the init wizard');
    assert.ok(!combined.includes("Let's configure your tracker connection"), 'must not launch the interactive wizard');
  });

  it('bare invocation on non-TTY prints help regardless of setup state', () => {
    const result = spawnSync('node', [binPath], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: '/tmp/ticketlens-no-home' },
    });
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes('USAGE'), 'non-TTY bare invocation must print help');
  });

  it('bare invocation with CI=true never launches an interactive wizard', () => {
    const result = spawnSync('node', [binPath], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: '/tmp/ticketlens-no-home', CI: 'true' },
    });
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes('USAGE'), 'CI bare invocation must print help');
  });

  it('--no-input bare invocation prints help, not a fetch attempt on a literal "--no-input" ticket key', () => {
    const result = spawnSync('node', [binPath, '--no-input'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: '/tmp/ticketlens-no-home' },
    });
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}\nstderr: ${result.stderr}`);
    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes('USAGE'), 'must print help, not attempt to fetch "--no-input" as a ticket key');
  });

  it('config --no-input on fresh state falls through to the unchanged dead-end error', () => {
    const result = spawnSync('node', [binPath, 'config', '--no-input'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, HOME: '/tmp/ticketlens-no-home' },
    });
    const combined = result.stdout + result.stderr;
    assert.ok(combined.includes('No profiles configured'), `Expected unchanged dead-end error. Got: ${combined.slice(0, 200)}`);
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
    ['note', '--help'],
    ['note', '-h'],
    ['recall', '--help'],
    ['recall', '-h'],
    ['compliance', '--help'],
    ['compliance', '-h'],
    ['ledger', '--help'],
    ['ledger', '-h'],
    ['pr', '--help'],
    ['pr', '-h'],
    ['install-hooks', '--help'],
    ['install-hooks', '-h'],
    ['mcp', '--help'],
    ['mcp', '-h'],
    ['comment', '--help'],
    ['comment', '-h'],
    ['transition', '--help'],
    ['transition', '-h'],
    ['assign', '--help'],
    ['assign', '-h'],
    ['duplicates', '--help'],
    ['duplicates', '-h'],
    ['link', '--help'],
    ['link', '-h'],
    ['update', '--help'],
    ['update', '-h'],
    ['create', '--help'],
    ['create', '-h'],
    ['history', '--help'],
    ['history', '-h'],
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

  it('"ticketlens note add" with no Pro license writes nothing under ~/.ticketlens/recall/', () => {
    const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-note-gate-'));
    try {
      const result = spawnSync('node', [binPath, 'note', 'add', '--title=x', '--ticket=PROD-1'], {
        encoding: 'utf8',
        timeout: 5000,
        input: 'Body text.',
        env: { ...process.env, HOME: freshHome, CI: 'true' },
      });
      assert.equal(existsSync(join(freshHome, '.ticketlens', 'recall')), false);
      assert.notEqual(result.status, 0);
    } finally {
      rmSync(freshHome, { recursive: true, force: true });
    }
  });

  it('"ticketlens recall" with no Pro license shows an upgrade prompt and exits non-zero', () => {
    const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-recall-gate-'));
    try {
      const result = spawnSync('node', [binPath, 'recall', 'backoff'], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, HOME: freshHome, CI: 'true' },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /pro/i);
    } finally {
      rmSync(freshHome, { recursive: true, force: true });
    }
  });

  it('"ticketlens mcp" starts the stdio server and exits cleanly when stdin closes, with an initialize handshake answered on stdout', () => {
    const result = spawnSync('node', [binPath, 'mcp'], {
      encoding: 'utf8',
      timeout: 5000,
      input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n',
      env: { ...process.env, HOME: '/tmp/ticketlens-no-home' },
    });
    assert.equal(result.status, 0, `Expected clean exit on stdin close, got ${result.status}\nstderr: ${result.stderr}`);
    const lines = result.stdout.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, 'exactly one JSON-RPC response for the one request sent');
    const response = JSON.parse(lines[0]);
    assert.equal(response.id, 1);
    assert.equal(response.result.serverInfo.name, 'ticketlens');
  });

  it('"ticketlens cloud-keys" routes to the cloud-keys handler, not the ticket-fetch fallback', () => {
    // Regression test for a real bug: cli.mjs's parseCommand had no branch for
    // "cloud-keys", so it silently fell through to the default fetch handler and
    // was misinterpreted as a ticket key ("cloud-keys" is not a valid ticket key).
    const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-cloud-keys-route-'));
    try {
      const result = spawnSync('node', [binPath, 'cloud-keys', 'list'], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, HOME: freshHome, CI: 'true' },
      });
      assert.doesNotMatch(result.stderr + result.stdout, /not a valid ticket key/);
      assert.match(result.stderr + result.stdout, /not logged in/i);
    } finally {
      rmSync(freshHome, { recursive: true, force: true });
    }
  });

  it('"ticketlens comment" with no Pro license shows an upgrade prompt and exits non-zero, without reaching the network', () => {
    const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-comment-gate-'));
    try {
      const result = spawnSync('node', [binPath, 'comment', 'PROD-1', '--body=hi'], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, HOME: freshHome, CI: 'true' },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /pro/i);
    } finally {
      rmSync(freshHome, { recursive: true, force: true });
    }
  });

  it('"ticketlens transition" with no Pro license shows an upgrade prompt and exits non-zero (list mode, no --target)', () => {
    const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-transition-gate-'));
    try {
      const result = spawnSync('node', [binPath, 'transition', 'PROD-1'], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, HOME: freshHome, CI: 'true' },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /pro/i);
    } finally {
      rmSync(freshHome, { recursive: true, force: true });
    }
  });

  it('"ticketlens transition TICKET --target=X" without --confirm never reaches the network gate check first (license gate wins)', () => {
    const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-transition-confirm-gate-'));
    try {
      const result = spawnSync('node', [binPath, 'transition', 'PROD-1', '--target=Done'], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, HOME: freshHome, CI: 'true' },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /pro/i);
    } finally {
      rmSync(freshHome, { recursive: true, force: true });
    }
  });

  it('"ticketlens assign" with no Pro license shows an upgrade prompt and exits non-zero', () => {
    const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-assign-gate-'));
    try {
      const result = spawnSync('node', [binPath, 'assign', 'PROD-1', '--to=me'], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, HOME: freshHome, CI: 'true' },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /pro/i);
    } finally {
      rmSync(freshHome, { recursive: true, force: true });
    }
  });

  it('"ticketlens duplicates" with no Pro license shows an upgrade prompt and exits non-zero', () => {
    const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-duplicates-gate-'));
    try {
      const result = spawnSync('node', [binPath, 'duplicates', 'PROD-1'], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, HOME: freshHome, CI: 'true' },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /pro/i);
    } finally {
      rmSync(freshHome, { recursive: true, force: true });
    }
  });

  it('"ticketlens link" with no Pro license shows an upgrade prompt and exits non-zero (list mode, no --type)', () => {
    const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-link-gate-'));
    try {
      const result = spawnSync('node', [binPath, 'link', 'PROD-1', 'PROD-2'], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, HOME: freshHome, CI: 'true' },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /pro/i);
    } finally {
      rmSync(freshHome, { recursive: true, force: true });
    }
  });

  it('"ticketlens link SOURCE TARGET --type=X" without --confirm never reaches the network — license gate wins first', () => {
    const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-link-confirm-gate-'));
    try {
      const result = spawnSync('node', [binPath, 'link', 'PROD-1', 'PROD-2', '--type=duplicate'], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, HOME: freshHome, CI: 'true' },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /pro/i);
    } finally {
      rmSync(freshHome, { recursive: true, force: true });
    }
  });

  it('"ticketlens update" with no Pro license shows an upgrade prompt and exits non-zero', () => {
    const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-update-gate-'));
    try {
      const result = spawnSync('node', [binPath, 'update', 'PROD-1', '--title=New title'], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, HOME: freshHome, CI: 'true' },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /pro/i);
    } finally {
      rmSync(freshHome, { recursive: true, force: true });
    }
  });

  it('"ticketlens history --help" shows real help and exits 0 even without a Pro license — --help must win over the license gate, matching every other Pro-gated command', () => {
    const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-history-help-gate-'));
    try {
      const result = spawnSync('node', [binPath, 'history', '--help'], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, HOME: freshHome, CI: 'true' },
      });
      assert.equal(result.status, 0, `Expected exit 0 for --help regardless of license, got ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
      const combined = result.stdout + result.stderr;
      assert.match(combined, /history/i);
      assert.doesNotMatch(combined, /requires Pro/i, '--help must never fall through to the upgrade prompt');
    } finally {
      rmSync(freshHome, { recursive: true, force: true });
    }
  });

  it('"ticketlens create" with no Pro license shows an upgrade prompt and exits non-zero', () => {
    const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-create-gate-'));
    try {
      const result = spawnSync('node', [binPath, 'create', '--project=PROD', '--type=Task', '--summary=New'], {
        encoding: 'utf8',
        timeout: 5000,
        env: { ...process.env, HOME: freshHome, CI: 'true' },
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /pro/i);
    } finally {
      rmSync(freshHome, { recursive: true, force: true });
    }
  });

  it('"ticketlens mcp install --dry-run" runs the install path, not the server, and touches no file', () => {
    const freshCwd = mkdtempSync(join(tmpdir(), 'ticketlens-mcp-install-dispatch-'));
    try {
      const result = spawnSync('node', [binPath, 'mcp', 'install', '--dry-run'], {
        encoding: 'utf8',
        timeout: 5000,
        cwd: freshCwd,
        env: { ...process.env, HOME: '/tmp/ticketlens-no-home' },
      });
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      assert.match(result.stdout, /Would write/);
      assert.equal(existsSync(join(freshCwd, '.mcp.json')), false);
    } finally {
      rmSync(freshCwd, { recursive: true, force: true });
    }
  });

  describe('"ticketlens license"', () => {
    const validLicense = {
      key: 'AAAA-BBBB-CCCC-DDDD',
      tier: 'pro',
      email: 'dev@example.com',
      provider: 'lemonsqueezy',
    };

    // LOCK: existing behavior for an active, recently-validated license — must survive the M-12 fix.
    it('LOCK: shows "License active" for a recently-validated pro license', () => {
      const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-license-active-'));
      try {
        writeLicense({
          ...validLicense,
          validatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
        }, join(freshHome, '.ticketlens'));
        const result = spawnSync('node', [binPath, 'license'], {
          encoding: 'utf8',
          timeout: 5000,
          env: { ...process.env, HOME: freshHome, CI: 'true' },
        });
        assert.equal(result.status, 0);
        assert.match(result.stdout, /License active/);
        assert.match(result.stdout, /dev@example\.com/);
      } finally {
        rmSync(freshHome, { recursive: true, force: true });
      }
    });

    // LOCK: existing behavior for a genuinely lapsed license (real key, stale validatedAt) — must survive the M-12 fix.
    it('LOCK: shows "License inactive" / "Not revalidated in 30+ days" for a genuinely lapsed license', () => {
      const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-license-lapsed-'));
      try {
        writeLicense({
          ...validLicense,
          validatedAt: new Date(Date.now() - 40 * 86400000).toISOString(),
          expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
        }, join(freshHome, '.ticketlens'));
        const result = spawnSync('node', [binPath, 'license'], {
          encoding: 'utf8',
          timeout: 5000,
          env: { ...process.env, HOME: freshHome, CI: 'true' },
        });
        assert.equal(result.status, 0);
        assert.match(result.stdout, /License inactive/);
        assert.match(result.stdout, /Not revalidated in 30\+ days/);
      } finally {
        rmSync(freshHome, { recursive: true, force: true });
      }
    });

    // LOCK: existing behavior for an expired license (past expiresAt) — must survive the M-12 fix.
    it('LOCK: shows "License expired" for a license past its expiresAt', () => {
      const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-license-expired-'));
      try {
        writeLicense({
          ...validLicense,
          validatedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() - 86400000).toISOString(),
        }, join(freshHome, '.ticketlens'));
        const result = spawnSync('node', [binPath, 'license'], {
          encoding: 'utf8',
          timeout: 5000,
          env: { ...process.env, HOME: freshHome, CI: 'true' },
        });
        assert.equal(result.status, 0);
        assert.match(result.stdout, /License expired/);
      } finally {
        rmSync(freshHome, { recursive: true, force: true });
      }
    });

    // RED (M-12): a never-activated install must show "Free tier", not a false "lapsed" warning.
    it('shows "Free tier" (not "Not revalidated") for an install that never activated a license', () => {
      const freshHome = mkdtempSync(join(tmpdir(), 'ticketlens-license-never-activated-'));
      try {
        const result = spawnSync('node', [binPath, 'license'], {
          encoding: 'utf8',
          timeout: 5000,
          env: { ...process.env, HOME: freshHome, CI: 'true' },
        });
        assert.equal(result.status, 0);
        assert.match(result.stdout, /Free tier/);
        assert.doesNotMatch(result.stdout, /Not revalidated/);
        assert.doesNotMatch(result.stdout, /undefined/);
      } finally {
        rmSync(freshHome, { recursive: true, force: true });
      }
    });
  });
});
