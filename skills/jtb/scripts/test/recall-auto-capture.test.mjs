import { describe, it, beforeEach, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { runAutoCapture } from '../../hooks/recall-auto-capture.mjs';
import { privateTmpDir, readLastCaptureAt } from '../../hooks/recall-nudge-lib.mjs';
import { isolateHookEnv } from './helpers/isolate-hook-env.mjs';

const AUTO_CAPTURE_SCRIPT_PATH = fileURLToPath(new URL('../../hooks/recall-auto-capture.mjs', import.meta.url));

// Isolated TMPDIR: this file's afterEach deletes auto-capture.log, which must never be the real one.
after(isolateHookEnv());

function deps(overrides = {}) {
  return {
    isLicensedFn: () => true,
    readCliTokenFn: () => 'cli-tok-test',
    buildCaptureExcerptFn: () => 'A real insight about the migration boundary.',
    autoCaptureFn: async () => ({ decision: 'skip' }),
    runNoteAddFn: async () => ({ written: true }),
    ...overrides,
  };
}

function readLog() {
  try {
    return readFileSync(join(privateTmpDir(), 'auto-capture.log'), 'utf8');
  } catch {
    return '';
  }
}

describe('runAutoCapture (backlog #24, D1 — autonomous background capture)', () => {
  let dir;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'auto-capture-test-')); });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    try { rmSync(join(privateTmpDir(), 'auto-capture.log')); } catch { /* not written this test — fine */ }
  });

  it('skips when not Pro-licensed, never calls autoCaptureFn or runNoteAddFn', async () => {
    let autoCaptureCalled = false;
    let runNoteAddCalled = false;
    const result = await runAutoCapture({
      transcriptPath: 'x', ticketKey: undefined, configDir: dir,
      ...deps({
        isLicensedFn: () => false,
        autoCaptureFn: async () => { autoCaptureCalled = true; return { decision: 'skip' }; },
        runNoteAddFn: async () => { runNoteAddCalled = true; return { written: true }; },
      }),
    });
    assert.equal(result.outcome, 'skipped');
    assert.equal(autoCaptureCalled, false);
    assert.equal(runNoteAddCalled, false);
  });

  it('skips when no CLI token (not logged in)', async () => {
    const result = await runAutoCapture({
      transcriptPath: 'x', configDir: dir,
      ...deps({ readCliTokenFn: () => null }),
    });
    assert.equal(result.outcome, 'skipped');
  });

  it('skips when the transcript excerpt is empty — nothing to judge', async () => {
    let autoCaptureCalled = false;
    const result = await runAutoCapture({
      transcriptPath: 'x', configDir: dir,
      ...deps({
        buildCaptureExcerptFn: () => '',
        autoCaptureFn: async () => { autoCaptureCalled = true; return { decision: 'skip' }; },
      }),
    });
    assert.equal(result.outcome, 'skipped');
    assert.equal(autoCaptureCalled, false);
  });

  it('does not call runNoteAddFn when the server decides skip', async () => {
    let runNoteAddCalled = false;
    const result = await runAutoCapture({
      transcriptPath: 'x', configDir: dir,
      ...deps({
        autoCaptureFn: async () => ({ decision: 'skip' }),
        runNoteAddFn: async () => { runNoteAddCalled = true; return { written: true }; },
      }),
    });
    assert.equal(result.outcome, 'skipped');
    assert.equal(runNoteAddCalled, false);
  });

  it('calls runNoteAddFn with correct cmdArgs and body via readStdin on a capture decision', async () => {
    let capturedArgs, capturedBody;
    const result = await runAutoCapture({
      transcriptPath: 'x', ticketKey: 'PROD-1234', configDir: dir,
      ...deps({
        autoCaptureFn: async () => ({ decision: 'capture', title: 'Migration boundary gotcha', body: 'The real body text.', tags: ['migration', 'sync'] }),
        runNoteAddFn: async (cmdArgs, opts) => {
          capturedArgs = cmdArgs;
          capturedBody = await opts.readStdin();
          return { written: true };
        },
      }),
    });
    assert.equal(result.outcome, 'captured');
    assert.ok(capturedArgs.includes('--title=Migration boundary gotcha'));
    assert.ok(capturedArgs.includes('--ticket=PROD-1234'));
    assert.ok(capturedArgs.includes('--tags=migration,sync'));
    assert.equal(capturedBody, 'The real body text.');
  });

  it('omits --ticket when no ticketKey was passed', async () => {
    let capturedArgs;
    await runAutoCapture({
      transcriptPath: 'x', ticketKey: undefined, configDir: dir,
      ...deps({
        autoCaptureFn: async () => ({ decision: 'capture', title: 'x', body: 'y', tags: [] }),
        runNoteAddFn: async (cmdArgs) => { capturedArgs = cmdArgs; return { written: true }; },
      }),
    });
    assert.ok(!capturedArgs.some(a => a.startsWith('--ticket=')));
  });

  it('strips a comma from an AI-returned tag before joining — a raw comma would silently fork into two tags downstream', async () => {
    let capturedArgs;
    await runAutoCapture({
      transcriptPath: 'x', configDir: dir,
      ...deps({
        autoCaptureFn: async () => ({ decision: 'capture', title: 'x', body: 'y', tags: ['retry,backoff', 'clean'] }),
        runNoteAddFn: async (cmdArgs) => { capturedArgs = cmdArgs; return { written: true }; },
      }),
    });
    assert.ok(capturedArgs.includes('--tags=retrybackoff,clean'));
  });

  it('omits --tags when the server returned no tags', async () => {
    let capturedArgs;
    await runAutoCapture({
      transcriptPath: 'x', configDir: dir,
      ...deps({
        autoCaptureFn: async () => ({ decision: 'capture', title: 'x', body: 'y' }),
        runNoteAddFn: async (cmdArgs) => { capturedArgs = cmdArgs; return { written: true }; },
      }),
    });
    assert.ok(!capturedArgs.some(a => a.startsWith('--tags=')));
  });

  it('a thrown error from autoCaptureFn is caught, logged, never escapes', async () => {
    await assert.doesNotReject(() => runAutoCapture({
      transcriptPath: 'x', configDir: dir,
      ...deps({ autoCaptureFn: async () => { throw new Error('network down'); } }),
    }));
  });

  it('reports outcome: error when autoCaptureFn throws', async () => {
    const result = await runAutoCapture({
      transcriptPath: 'x', configDir: dir,
      ...deps({ autoCaptureFn: async () => { throw new Error('network down'); } }),
    });
    assert.equal(result.outcome, 'error');
    assert.match(result.error, /network down/);
  });

  it('logs a line to the local debug log for every outcome (skip/capture/error)', async () => {
    await runAutoCapture({ transcriptPath: 'x', configDir: dir, ...deps({ isLicensedFn: () => false }) });
    const log = readLog();
    assert.match(log, /skipped: not licensed/);
  });

  it('logs a captured outcome with the note title', async () => {
    await runAutoCapture({
      transcriptPath: 'x', configDir: dir,
      ...deps({ autoCaptureFn: async () => ({ decision: 'capture', title: 'Migration boundary gotcha', body: 'y', tags: [] }) }),
    });
    const log = readLog();
    assert.match(log, /captured: Migration boundary gotcha/);
  });

  it('logs an error outcome with the error message', async () => {
    await runAutoCapture({
      transcriptPath: 'x', configDir: dir,
      ...deps({ autoCaptureFn: async () => { throw new Error('boom'); } }),
    });
    const log = readLog();
    assert.match(log, /error: boom/);
  });

  describe('backlog #44 gap — background success must mark the shared capture marker (sync Stop check was blind to it)', () => {
    it('calls writeLastCaptureAtFn with the given cwd on a captured outcome', async () => {
      let markedCwd, markedAt;
      const result = await runAutoCapture({
        transcriptPath: 'x', configDir: dir, cwd: '/some/project',
        ...deps({
          autoCaptureFn: async () => ({ decision: 'capture', title: 'x', body: 'y', tags: [] }),
          writeLastCaptureAtFn: (cwd, at) => { markedCwd = cwd; markedAt = at; },
        }),
      });
      assert.equal(result.outcome, 'captured');
      assert.equal(markedCwd, '/some/project');
      assert.equal(typeof markedAt, 'number');
    });

    it('does NOT mark the capture when runNoteAddFn reports written: false (not-written)', async () => {
      let markerCalled = false;
      const result = await runAutoCapture({
        transcriptPath: 'x', configDir: dir,
        ...deps({
          autoCaptureFn: async () => ({ decision: 'capture', title: 'x', body: 'y', tags: [] }),
          runNoteAddFn: async () => ({ written: false }),
          writeLastCaptureAtFn: () => { markerCalled = true; },
        }),
      });
      assert.equal(result.outcome, 'not-written');
      assert.equal(markerCalled, false);
    });

    it('does NOT mark the capture on a skip decision', async () => {
      let markerCalled = false;
      await runAutoCapture({
        transcriptPath: 'x', configDir: dir,
        ...deps({ writeLastCaptureAtFn: () => { markerCalled = true; } }),
      });
      assert.equal(markerCalled, false);
    });

    it('does NOT mark the capture when autoCaptureFn throws', async () => {
      let markerCalled = false;
      await runAutoCapture({
        transcriptPath: 'x', configDir: dir,
        ...deps({
          autoCaptureFn: async () => { throw new Error('network down'); },
          writeLastCaptureAtFn: () => { markerCalled = true; },
        }),
      });
      assert.equal(markerCalled, false);
    });

    it('does NOT mark the capture when unlicensed or logged out (skipped before ever judging)', async () => {
      let markerCalled = false;
      await runAutoCapture({
        transcriptPath: 'x', configDir: dir,
        ...deps({ isLicensedFn: () => false, writeLastCaptureAtFn: () => { markerCalled = true; } }),
      });
      assert.equal(markerCalled, false);
    });

    it('integration: a real captured outcome makes hasRecentCapture-backing readLastCaptureAt see it, using the real writeLastCaptureAt (no injected fn)', async () => {
      const cwd = mkdtempSync(join(tmpdir(), 'auto-capture-cwd-'));
      const before = Date.now();
      const result = await runAutoCapture({
        transcriptPath: 'x', configDir: dir, cwd,
        ...deps({ autoCaptureFn: async () => ({ decision: 'capture', title: 'x', body: 'y', tags: [] }) }),
      });
      assert.equal(result.outcome, 'captured');
      const markedAt = readLastCaptureAt(cwd);
      assert.ok(markedAt >= before, 'real marker file must reflect this capture, not a stale/missing value');
      rmSync(cwd, { recursive: true, force: true });
    });
  });

  describe('backlog #44 code review — real end-to-end argv→cwd plumbing (HARD TEST: real subprocess, real mock backend, hostile symlinked cwd)', () => {
    // Code review, round 2: the unit tests above call runAutoCapture() directly
    // with an explicit cwd, which never exercises the CLI entry point's own
    // `process.argv` destructuring (the exact lines the HIGH fix changed). This
    // spawns the real script as a real subprocess, through a real (though
    // stubbed) backend, to prove the argv-supplied cwd — not this process's own
    // process.cwd() — is what ends up in the marker file, even when that cwd
    // string itself is a symlink (the precise condition the HIGH finding named).
    let server, port, realDir, aliasDir, homeDir, transcriptPath;

    beforeEach(async () => {
      server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ decision: 'capture', title: 'E2E argv test capture', body: 'Real body text.', tags: ['e2e'] }));
        });
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = server.address().port;

      realDir = mkdtempSync(join(tmpdir(), 'auto-capture-e2e-real-'));
      // Deliberately hostile: a symlink alias for the cwd, one directory level
      // up so it can't collide with realDir's own name. Node's process.cwd()
      // resolves symlinks, so if the fix regressed to relying on that instead
      // of the argv-supplied string, this would resolve to realDir and the
      // marker would land under the wrong hash.
      aliasDir = join(tmpdir(), `auto-capture-e2e-alias-${Math.random().toString(36).slice(2)}`);
      symlinkSync(realDir, aliasDir);

      homeDir = mkdtempSync(join(tmpdir(), 'auto-capture-e2e-home-'));
      mkdirSync(join(homeDir, '.ticketlens'), { recursive: true });
      writeFileSync(join(homeDir, '.ticketlens', 'cli-token.json'), JSON.stringify({ token: 'tl_e2e_argv_test' }));

      // No separate TMPDIR override here: the child inherits this file's own
      // isolateHookEnv()-isolated TMPDIR via ...process.env below, which is
      // also where THIS process's own readLastCaptureAt() call looks — they
      // must agree, or the assertion would check the wrong directory.
      transcriptPath = join(realDir, 'transcript.jsonl');
      writeFileSync(transcriptPath, JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'A real, non-trivial insight about the migration boundary worth capturing.' }] },
      }) + '\n');
    });

    afterEach(async () => {
      await new Promise((resolve) => server.close(resolve));
      rmSync(realDir, { recursive: true, force: true });
      rmSync(aliasDir, { force: true }); // symlink itself, not its target
      rmSync(homeDir, { recursive: true, force: true });
      // The marker file this test writes lives under the file-level isolated
      // TMPDIR (see isolateHookEnv() at the top of this file), which that
      // helper's own after() hook removes entirely once the whole file is
      // done — nothing test-specific to clean up here.
    });

    it('HARD TEST: a real captured outcome through the real CLI entry marks the marker under the raw argv cwd, not the symlink-resolved path', async () => {
      // spawn (async), NOT spawnSync — the mock backend above runs in-process
      // on this same test's event loop; spawnSync blocks that loop for the
      // child's entire lifetime, so the child's request to 127.0.0.1 would
      // hang until its own 30s fetch timeout with nothing ever able to answer
      // it (confirmed: an earlier spawnSync version of this test hung for
      // exactly ~30s and failed for this exact reason).
      const child = spawn(process.execPath, [AUTO_CAPTURE_SCRIPT_PATH, transcriptPath, 'PROD-9999', aliasDir], {
        env: {
          ...process.env,
          HOME: homeDir,
          TICKETLENS_SKIP_LICENSE: 'true',
          TICKETLENS_API_URL: `http://127.0.0.1:${port}`,
        },
      });
      let stderr = '';
      child.stderr.on('data', (d) => { stderr += d; });
      const status = await new Promise((resolve) => child.on('close', resolve));
      assert.equal(status, 0, `child must exit cleanly, got stderr: ${stderr}`);
      const markedAt = readLastCaptureAt(aliasDir);
      assert.ok(markedAt > 0, 'marker must be written under the exact raw (unresolved) argv cwd string');
    });
  });

  describe('backlog #33 — attribute failures to a backend URL + status, log had neither', () => {
    let originalUrl;
    beforeEach(() => { originalUrl = process.env.TICKETLENS_API_URL; });
    afterEach(() => {
      if (originalUrl === undefined) delete process.env.TICKETLENS_API_URL;
      else process.env.TICKETLENS_API_URL = originalUrl;
    });

    it('includes the resolved API URL on a "not logged in" skip', async () => {
      process.env.TICKETLENS_API_URL = 'https://test-tunnel.ngrok-free.app';
      await runAutoCapture({
        transcriptPath: 'x', configDir: dir,
        ...deps({ readCliTokenFn: () => null }),
      });
      const log = readLog();
      assert.match(log, /skipped: not logged in.*api=https:\/\/test-tunnel\.ngrok-free\.app/);
    });

    it('includes the resolved API URL on an error outcome', async () => {
      process.env.TICKETLENS_API_URL = 'https://test-tunnel.ngrok-free.app';
      await runAutoCapture({
        transcriptPath: 'x', configDir: dir,
        ...deps({ autoCaptureFn: async () => { throw new Error('Unauthorized'); } }),
      });
      const log = readLog();
      assert.match(log, /error: Unauthorized.*api=https:\/\/test-tunnel\.ngrok-free\.app/);
    });

    it('includes the HTTP status on an error outcome when the thrown error carries one', async () => {
      await runAutoCapture({
        transcriptPath: 'x', configDir: dir,
        ...deps({
          autoCaptureFn: async () => {
            const err = new Error('Unauthorized');
            err.status = 401;
            throw err;
          },
        }),
      });
      const log = readLog();
      assert.match(log, /error: Unauthorized \(status=401\)/);
    });

    it('omits the status suffix when the thrown error carries none — e.g. a network failure', async () => {
      await runAutoCapture({
        transcriptPath: 'x', configDir: dir,
        ...deps({ autoCaptureFn: async () => { throw new Error('fetch failed'); } }),
      });
      const log = readLog();
      assert.match(log, /error: fetch failed(?! \(status=)/);
    });

    it('falls back to the default local API base when TICKETLENS_API_URL is unset', async () => {
      delete process.env.TICKETLENS_API_URL;
      await runAutoCapture({
        transcriptPath: 'x', configDir: dir,
        ...deps({ readCliTokenFn: () => null }),
      });
      const log = readLog();
      assert.match(log, /api=http:\/\/api\.ticketlens\.test/);
    });
  });
});
