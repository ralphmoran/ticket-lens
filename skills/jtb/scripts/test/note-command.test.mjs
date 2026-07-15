import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { runNoteAdd } from '../lib/note-command.mjs';

function makeStream() {
  const lines = [];
  return { write: (s) => lines.push(s), lines };
}

function baseDeps(overrides = {}) {
  return {
    configDir: '/fake/config',
    stream: makeStream(),
    readStdin: async () => 'Body text.',
    isLicensedFn: () => true,
    scanForSecretsFn: () => ({ rejected: false, reasons: [], warnings: [] }),
    writeDigestFn: () => ({ id: 'note-1.md', path: '/fake/config/recall/PROD/note-1.md' }),
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
      writeDigestFn: () => { writeCalls++; return { id: 'x', path: 'x' }; },
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

  test('passes parsed --tags as a trimmed array to writeDigest', async () => {
    let capturedTags;
    const deps = baseDeps({
      writeDigestFn: (note) => { capturedTags = note.tags; return { id: 'x', path: 'x' }; },
    });
    await runNoteAdd(['--title=x', '--tags= bug , auth '], deps);
    assert.deepEqual(capturedTags, ['bug', 'auth']);
  });

  test('passes --ticket as a one-item ticketKeys array', async () => {
    let capturedKeys;
    const deps = baseDeps({
      writeDigestFn: (note) => { capturedKeys = note.ticketKeys; return { id: 'x', path: 'x' }; },
    });
    await runNoteAdd(['--title=x', '--ticket=PROD-1'], deps);
    assert.deepEqual(capturedKeys, ['PROD-1']);
  });

  test('no --ticket means an empty ticketKeys array (general bucket)', async () => {
    let capturedKeys;
    const deps = baseDeps({
      writeDigestFn: (note) => { capturedKeys = note.ticketKeys; return { id: 'x', path: 'x' }; },
    });
    await runNoteAdd(['--title=x'], deps);
    assert.deepEqual(capturedKeys, []);
  });

  test('note body comes from stdin', async () => {
    let capturedBody;
    const deps = baseDeps({
      readStdin: async () => 'The actual note body from stdin.',
      writeDigestFn: (note) => { capturedBody = note.body; return { id: 'x', path: 'x' }; },
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
      writeDigestFn: () => { writeCalls++; return { id: 'x', path: 'x' }; },
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

describe('runNoteAdd — title is single-line (defense in depth against heading injection)', () => {
  test('an embedded newline in --title is collapsed to a space before being saved', async () => {
    let capturedTitle;
    const deps = baseDeps({
      writeDigestFn: (note) => { capturedTitle = note.title; return { id: 'x', path: 'x' }; },
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
      writeDigestFn: (note) => { capturedBody = note.body; return { id: 'x', path: 'x' }; },
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
      writeDigestFn: (note) => { capturedBody = note.body; return { id: 'x', path: 'x' }; },
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
