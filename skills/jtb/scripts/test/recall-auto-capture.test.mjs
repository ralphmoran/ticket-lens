import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAutoCapture } from '../../hooks/recall-auto-capture.mjs';
import { privateTmpDir } from '../../hooks/recall-nudge-lib.mjs';

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
});
