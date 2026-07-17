import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runNoteAdd, runNotePatch } from '../lib/note-command.mjs';

function makeStream({ isTTY = false } = {}) {
  const lines = [];
  return { write: (s) => lines.push(s), lines, isTTY };
}

function baseDeps(overrides = {}) {
  return {
    configDir: '/fake/config',
    stream: makeStream(),
    readStdin: async () => 'Body text.',
    isLicensedFn: () => true,
    checkNoteStructureFn: () => ({ rejected: false, reason: null }),
    scanForSecretsFn: () => ({ rejected: false, reasons: [], warnings: [] }),
    writeNoteFn: () => ({ id: 'note-1.md', path: '/fake/config/recall/PROD/note-1.md' }),
    incrementDraftKeptFn: () => {},
    incrementDraftDeletedFn: () => {},
    author: 'ralph',
    listAttachmentsFn: () => [],
    extractTextFn: () => null,
    ...overrides,
  };
}

describe('runNoteAdd — license gate fires before anything else', () => {
  test('unlicensed: never reads stdin, never writes, shows upgrade prompt', async () => {
    let stdinCalls = 0;
    let writeCalls = 0;
    const deps = baseDeps({
      isLicensedFn: () => false,
      readStdin: async () => { stdinCalls++; return 'x'; },
      writeNoteFn: () => { writeCalls++; return { id: 'x', path: 'x' }; },
    });
    const result = await runNoteAdd(['--title=x', '--ticket=PROD-1'], deps);
    assert.equal(result.written, false);
    assert.equal(stdinCalls, 0);
    assert.equal(writeCalls, 0);
  });
});

describe('runNoteAdd — usage validation', () => {
  test('missing --title shows usage and does not write', async () => {
    const deps = baseDeps();
    const result = await runNoteAdd(['--ticket=PROD-1'], deps);
    assert.equal(result.written, false);
    assert.match(deps.stream.lines.join(''), /Usage/i);
  });
});

describe('runNoteAdd — happy path', () => {
  test('clean note is written and drafts_kept is incremented', async () => {
    let kept = 0;
    const deps = baseDeps({ incrementDraftKeptFn: () => { kept++; } });
    const result = await runNoteAdd(['--title=Fix retry bug', '--ticket=PROD-1', '--tags=bug,auth'], deps);
    assert.equal(result.written, true);
    assert.equal(kept, 1);
  });

  test('regression: a TTY stream without --plain styles the save confirmation (green checkmark, blank line above)', async () => {
    const deps = baseDeps({ stream: makeStream({ isTTY: true }) });
    await runNoteAdd(['--title=x'], deps);
    const output = deps.stream.lines.join('');
    assert.match(output, /\x1b\[/, 'must contain ANSI color codes');
    assert.match(output, /^\n\s+.*✔/, 'must have a blank line above a checkmark');
  });

  test('regression: --plain reproduces the exact bare confirmation, no ANSI codes', async () => {
    const deps = baseDeps({ stream: makeStream({ isTTY: true }) });
    await runNoteAdd(['--title=x', '--plain'], deps);
    const output = deps.stream.lines.join('');
    assert.doesNotMatch(output, /\x1b\[/);
    assert.equal(output, '  Saved note "x" (note-1.md)\n');
  });

  test('a non-TTY stream (piped) gets the bare confirmation even without --plain', async () => {
    const deps = baseDeps({ stream: makeStream({ isTTY: false }) });
    await runNoteAdd(['--title=x'], deps);
    assert.doesNotMatch(deps.stream.lines.join(''), /\x1b\[/);
  });

  test('passes parsed --tags as a trimmed array to writeNote', async () => {
    let capturedTags;
    const deps = baseDeps({
      writeNoteFn: (note) => { capturedTags = note.tags; return { id: 'x', path: 'x' }; },
    });
    await runNoteAdd(['--title=x', '--tags= bug , auth '], deps);
    assert.deepEqual(capturedTags, ['bug', 'auth']);
  });

  test('passes --ticket as a one-item ticketKeys array', async () => {
    let capturedKeys;
    const deps = baseDeps({
      writeNoteFn: (note) => { capturedKeys = note.ticketKeys; return { id: 'x', path: 'x' }; },
    });
    await runNoteAdd(['--title=x', '--ticket=PROD-1'], deps);
    assert.deepEqual(capturedKeys, ['PROD-1']);
  });

  test('no --ticket means an empty ticketKeys array (general bucket)', async () => {
    let capturedKeys;
    const deps = baseDeps({
      writeNoteFn: (note) => { capturedKeys = note.ticketKeys; return { id: 'x', path: 'x' }; },
    });
    await runNoteAdd(['--title=x'], deps);
    assert.deepEqual(capturedKeys, []);
  });

  test('note body comes from stdin', async () => {
    let capturedBody;
    const deps = baseDeps({
      readStdin: async () => 'The actual note body from stdin.',
      writeNoteFn: (note) => { capturedBody = note.body; return { id: 'x', path: 'x' }; },
    });
    await runNoteAdd(['--title=x'], deps);
    assert.equal(capturedBody, 'The actual note body from stdin.');
  });
});

describe('runNoteAdd — secret scanner gate', () => {
  test('a rejected scan is never written, drafts_deleted is incremented, reason is shown', async () => {
    let deleted = 0;
    let writeCalls = 0;
    const deps = baseDeps({
      scanForSecretsFn: () => ({ rejected: true, reasons: ['Looks like an AWS access key.'], warnings: [] }),
      incrementDraftDeletedFn: () => { deleted++; },
      writeNoteFn: () => { writeCalls++; return { id: 'x', path: 'x' }; },
    });
    const result = await runNoteAdd(['--title=x'], deps);
    assert.equal(result.written, false);
    assert.equal(deleted, 1);
    assert.equal(writeCalls, 0);
    assert.match(deps.stream.lines.join(''), /AWS access key/);
  });

  test('a warning (e.g. email) does not block the write, but is shown', async () => {
    const deps = baseDeps({
      scanForSecretsFn: () => ({ rejected: false, reasons: [], warnings: ['Contains an email address.'] }),
    });
    const result = await runNoteAdd(['--title=x'], deps);
    assert.equal(result.written, true);
    assert.match(deps.stream.lines.join(''), /email address/);
  });

  test('the scanner is given title, tags, and body together', async () => {
    let captured;
    const deps = baseDeps({
      scanForSecretsFn: (input) => { captured = input; return { rejected: false, reasons: [], warnings: [] }; },
      readStdin: async () => 'body text',
    });
    await runNoteAdd(['--title=My title', '--tags=a,b'], deps);
    assert.equal(captured.title, 'My title');
    assert.deepEqual(captured.tags, ['a', 'b']);
    assert.equal(captured.body, 'body text');
  });
});

describe('runNoteAdd — structural check gate', () => {
  test('a rejected structural check is never written, is not scanned for secrets, reason is shown', async () => {
    let scanCalls = 0;
    let writeCalls = 0;
    const deps = baseDeps({
      checkNoteStructureFn: () => ({ rejected: true, reason: 'Note body is empty.' }),
      scanForSecretsFn: () => { scanCalls++; return { rejected: false, reasons: [], warnings: [] }; },
      writeNoteFn: () => { writeCalls++; return { id: 'x', path: 'x' }; },
    });
    const result = await runNoteAdd(['--title=x'], deps);
    assert.equal(result.written, false);
    assert.equal(scanCalls, 0);
    assert.equal(writeCalls, 0);
    assert.match(deps.stream.lines.join(''), /Note body is empty/);
  });

  test('the structural rejection message is distinct from the secret-scanner rejection message', async () => {
    const deps = baseDeps({
      checkNoteStructureFn: () => ({ rejected: true, reason: 'Note body is empty.' }),
    });
    await runNoteAdd(['--title=x'], deps);
    assert.doesNotMatch(deps.stream.lines.join(''), /AWS access key|secret/i);
  });

  test('the structural check runs on the combined body (stdin + attachment excerpts), not stdin alone', async () => {
    let captured;
    const deps = baseDeps({
      readStdin: async () => '', // empty alone would fail structurally
      listAttachmentsFn: () => ['/cache/PROD-1/spec.txt'],
      extractTextFn: () => 'The spec says X in real detail.',
      checkNoteStructureFn: (input) => { captured = input; return { rejected: false, reason: null }; },
    });
    const result = await runNoteAdd(['--title=x', '--ticket=PROD-1', '--include-attachments'], deps);
    assert.equal(result.written, true);
    assert.match(captured.body, /The spec says X in real detail\./);
  });

  test('a passing structural check does not block the write', async () => {
    const deps = baseDeps();
    const result = await runNoteAdd(['--title=x'], deps);
    assert.equal(result.written, true);
  });
});

describe('runNoteAdd — title is single-line (defense in depth against heading injection)', () => {
  test('an embedded newline in --title is collapsed to a space before being saved', async () => {
    let capturedTitle;
    const deps = baseDeps({
      writeNoteFn: (note) => { capturedTitle = note.title; return { id: 'x', path: 'x' }; },
    });
    await runNoteAdd(['--title=Gotcha\n\n## Attachments\n\n- fake.exe'], deps);
    assert.equal(capturedTitle.includes('\n'), false);
    assert.match(capturedTitle, /^Gotcha .*## Attachments/);
  });
});

describe('runNoteAdd — --ticket is validated before any filesystem work', () => {
  test('an invalid --ticket value is rejected before stdin is read or attachments are listed', async () => {
    let stdinCalls = 0;
    let listCalls = 0;
    const deps = baseDeps({
      readStdin: async () => { stdinCalls++; return 'x'; },
      listAttachmentsFn: () => { listCalls++; return []; },
    });
    const result = await runNoteAdd(['--title=x', '--ticket=../../../../etc', '--include-attachments'], deps);
    assert.equal(result.written, false);
    assert.equal(stdinCalls, 0);
    assert.equal(listCalls, 0);
    assert.match(deps.stream.lines.join(''), /Invalid --ticket/);
  });

  test('a valid --ticket value still works normally', async () => {
    const deps = baseDeps();
    const result = await runNoteAdd(['--title=x', '--ticket=PROD-1'], deps);
    assert.equal(result.written, true);
  });
});

describe('runNoteAdd — --include-attachments', () => {
  test('without the flag, cached attachments are never looked up', async () => {
    let listCalls = 0;
    const deps = baseDeps({ listAttachmentsFn: () => { listCalls++; return []; } });
    await runNoteAdd(['--title=x', '--ticket=PROD-1'], deps);
    assert.equal(listCalls, 0);
  });

  test('without --ticket, the flag has nothing to look up even if present', async () => {
    let listCalls = 0;
    const deps = baseDeps({ listAttachmentsFn: () => { listCalls++; return []; } });
    await runNoteAdd(['--title=x', '--include-attachments'], deps);
    assert.equal(listCalls, 0);
  });

  test('with the flag and a ticket, extracted attachment text is appended to the note body', async () => {
    let capturedBody;
    const deps = baseDeps({
      listAttachmentsFn: (configDir, ticketKey) => {
        assert.equal(ticketKey, 'PROD-1');
        return ['/cache/PROD-1/spec.txt'];
      },
      extractTextFn: (filePath) => filePath.endsWith('spec.txt') ? 'The spec says X.' : null,
      writeNoteFn: (note) => { capturedBody = note.body; return { id: 'x', path: 'x' }; },
    });
    await runNoteAdd(['--title=x', '--ticket=PROD-1', '--include-attachments'], deps);
    assert.match(capturedBody, /Body text\./);
    assert.match(capturedBody, /The spec says X\./);
    assert.match(capturedBody, /spec\.txt/);
  });

  test('an attachment that extractText cannot read is silently skipped, not included', async () => {
    let capturedBody;
    const deps = baseDeps({
      listAttachmentsFn: () => ['/cache/PROD-1/image.png'],
      extractTextFn: () => null,
      writeNoteFn: (note) => { capturedBody = note.body; return { id: 'x', path: 'x' }; },
    });
    await runNoteAdd(['--title=x', '--ticket=PROD-1', '--include-attachments'], deps);
    assert.equal(capturedBody, 'Body text.');
  });

  test('the combined body (including attachment excerpts) is what gets scanned for secrets', async () => {
    let captured;
    const deps = baseDeps({
      listAttachmentsFn: () => ['/cache/PROD-1/spec.txt'],
      extractTextFn: () => 'AKIAIOSFODNN7EXAMPLE',
      scanForSecretsFn: (input) => { captured = input; return { rejected: true, reasons: ['x'], warnings: [] }; },
    });
    await runNoteAdd(['--title=x', '--ticket=PROD-1', '--include-attachments'], deps);
    assert.match(captured.body, /AKIAIOSFODNN7EXAMPLE/);
  });
});

function basePatchDeps(overrides = {}) {
  return {
    configDir: '/fake/config',
    stream: makeStream(),
    readStdin: async () => 'Improved, actionable draft body.',
    isLicensedFn: () => true,
    checkNoteStructureFn: () => ({ rejected: false, reason: null }),
    scanForSecretsFn: () => ({ rejected: false, reasons: [], warnings: [] }),
    patchNoteBodyFn: () => ({ patched: true, path: '/fake/config/recall/PROD/note-1.md' }),
    ...overrides,
  };
}

describe('runNotePatch — license gate fires before anything else', () => {
  test('unlicensed: never reads stdin, never patches, shows upgrade prompt', async () => {
    let stdinCalls = 0;
    let patchCalls = 0;
    const deps = basePatchDeps({
      isLicensedFn: () => false,
      readStdin: async () => { stdinCalls++; return 'x'; },
      patchNoteBodyFn: () => { patchCalls++; return { patched: true, path: 'x' }; },
    });
    const result = await runNotePatch(['--id=note-1.md'], deps);
    assert.equal(result.patched, false);
    assert.equal(stdinCalls, 0);
    assert.equal(patchCalls, 0);
  });
});

describe('runNotePatch — usage validation', () => {
  test('missing --id shows usage and does not patch', async () => {
    const deps = basePatchDeps();
    const result = await runNotePatch([], deps);
    assert.equal(result.patched, false);
    assert.match(deps.stream.lines.join(''), /Usage/i);
  });

  test('an invalid --ticket value is rejected before stdin is read', async () => {
    let stdinCalls = 0;
    const deps = basePatchDeps({ readStdin: async () => { stdinCalls++; return 'x'; } });
    const result = await runNotePatch(['--id=note-1.md', '--ticket=../../../../etc'], deps);
    assert.equal(result.patched, false);
    assert.equal(stdinCalls, 0);
    assert.match(deps.stream.lines.join(''), /Invalid --ticket/);
  });
});

describe('runNotePatch — new body gets the same gates as note add', () => {
  test('a rejected structural check blocks the patch and is never passed to patchNoteBodyFn', async () => {
    let patchCalls = 0;
    const deps = basePatchDeps({
      checkNoteStructureFn: () => ({ rejected: true, reason: 'Note body is empty.' }),
      patchNoteBodyFn: () => { patchCalls++; return { patched: true, path: 'x' }; },
    });
    const result = await runNotePatch(['--id=note-1.md'], deps);
    assert.equal(result.patched, false);
    assert.equal(patchCalls, 0);
    assert.match(deps.stream.lines.join(''), /Note body is empty/);
  });

  test('a rejected secret scan blocks the patch', async () => {
    let patchCalls = 0;
    const deps = basePatchDeps({
      scanForSecretsFn: () => ({ rejected: true, reasons: ['Looks like an AWS access key.'], warnings: [] }),
      patchNoteBodyFn: () => { patchCalls++; return { patched: true, path: 'x' }; },
    });
    const result = await runNotePatch(['--id=note-1.md'], deps);
    assert.equal(result.patched, false);
    assert.equal(patchCalls, 0);
    assert.match(deps.stream.lines.join(''), /AWS access key/);
  });
});

describe('runNotePatch — delegates to patchNoteBodyFn with the right shape', () => {
  test('passes id, ticketKeys, and the new stdin body through', async () => {
    let captured;
    const deps = basePatchDeps({
      readStdin: async () => 'A genuinely improved note body.',
      patchNoteBodyFn: (note) => { captured = note; return { patched: true, path: 'x' }; },
    });
    await runNotePatch(['--id=note-1.md', '--ticket=PROD-1'], deps);
    assert.equal(captured.id, 'note-1.md');
    assert.deepEqual(captured.ticketKeys, ['PROD-1']);
    assert.equal(captured.body, 'A genuinely improved note body.');
  });

  test('no --ticket means an empty ticketKeys array', async () => {
    let captured;
    const deps = basePatchDeps({
      patchNoteBodyFn: (note) => { captured = note; return { patched: true, path: 'x' }; },
    });
    await runNotePatch(['--id=note-1.md'], deps);
    assert.deepEqual(captured.ticketKeys, []);
  });

  test('a successful patch is reported distinctly from a no-op', async () => {
    const deps = basePatchDeps({ patchNoteBodyFn: () => ({ patched: true, path: 'x' }) });
    const result = await runNotePatch(['--id=note-1.md'], deps);
    assert.equal(result.patched, true);
    assert.match(deps.stream.lines.join(''), /Updated/);
  });

  test('a no-op (note gone or changed since capture) is reported distinctly from success', async () => {
    const deps = basePatchDeps({ patchNoteBodyFn: () => ({ patched: false, path: null }) });
    const result = await runNotePatch(['--id=note-1.md'], deps);
    assert.equal(result.patched, false);
    assert.match(deps.stream.lines.join(''), /not updated/i);
  });

  test('--expect-mtime is parsed and passed through as a number', async () => {
    let captured;
    const deps = basePatchDeps({
      patchNoteBodyFn: (note) => { captured = note; return { patched: true, path: 'x' }; },
    });
    await runNotePatch(['--id=note-1.md', '--expect-mtime=1700000000000'], deps);
    assert.equal(captured.expectedMtimeMs, 1700000000000);
  });

  test('omitting --expect-mtime leaves it undefined — patch is unconditional', async () => {
    let captured;
    const deps = basePatchDeps({
      patchNoteBodyFn: (note) => { captured = note; return { patched: true, path: 'x' }; },
    });
    await runNotePatch(['--id=note-1.md'], deps);
    assert.equal(captured.expectedMtimeMs, undefined);
  });
});

describe('runNoteAdd — team sync (push after local write)', () => {
  test('with a cliToken, pushes the note carrying the same externalId as the local write, using the backend wire field names', async () => {
    let capturedNote;
    const deps = baseDeps({
      writeNoteFn: () => ({ id: 'note-1.md', path: '/fake/config/recall/PROD/note-1.md' }),
      readCliTokenFn: () => 'tl_key',
      pushNoteFn: (note) => { capturedNote = note; return Promise.resolve({ ok: true }); },
    });
    await runNoteAdd(['--title=Retry gotcha', '--ticket=PROD-1', '--tags=bug'], deps);
    // Field names must match PushRequest's validation rules (external_id, tickets) —
    // not the local vault's internal camelCase shape. A mismatch here means every
    // real push 422s against the live backend despite this test passing.
    assert.equal(capturedNote.external_id, 'note-1.md');
    assert.equal(capturedNote.title, 'Retry gotcha');
    assert.deepEqual(capturedNote.tickets, ['PROD-1']);
  });

  test('without a cliToken, never attempts a push', async () => {
    let pushCalls = 0;
    const deps = baseDeps({
      readCliTokenFn: () => null,
      pushNoteFn: () => { pushCalls++; return Promise.resolve({ ok: true }); },
    });
    const result = await runNoteAdd(['--title=x', '--ticket=PROD-1'], deps);
    assert.equal(result.written, true, 'local save still succeeds without a cliToken');
    assert.equal(pushCalls, 0);
  });

  test('a push failure does not affect the local save result', async () => {
    const deps = baseDeps({
      readCliTokenFn: () => 'tl_key',
      pushNoteFn: () => Promise.resolve({ ok: false }),
    });
    const result = await runNoteAdd(['--title=x', '--ticket=PROD-1'], deps);
    assert.equal(result.written, true);
  });

  test('the push warn callback writes to the same stream as the rest of the command', async () => {
    const deps = baseDeps({
      readCliTokenFn: () => 'tl_key',
      pushNoteFn: (note, { warn }) => { warn('  Could not sync note to your team.\n'); return Promise.resolve({ ok: false }); },
    });
    await runNoteAdd(['--title=x', '--ticket=PROD-1'], deps);
    assert.match(deps.stream.lines.join(''), /Could not sync note to your team/);
  });
});
