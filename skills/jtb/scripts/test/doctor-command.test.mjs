import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runDoctor } from '../lib/doctor-command.mjs';
import { checkConnectivity } from '../lib/doctor-checks.mjs';
import { SPINNER_FRAMES } from '../lib/banner.mjs';

function fakeStream() {
  const lines = [];
  return { write: (s) => { lines.push(s); return true; }, isTTY: false, get text() { return lines.join(''); } };
}

function fakeTTYStream() {
  const lines = [];
  return { write: (s) => { lines.push(s); return true; }, isTTY: true, get text() { return lines.join(''); } };
}

function allOkChecks(overrides = {}) {
  return {
    checkProfileConfigFn: () => ({ id: 'profile-config', label: 'Profile configuration', ok: true, message: 'ok', hint: null, fixable: false }),
    checkLicenseFreshnessFn: () => ({ id: 'license-freshness', label: 'License freshness', ok: true, message: 'ok', hint: null, fixable: false }),
    checkConnectivityFn: async () => ({ id: 'connectivity', label: 'Tracker connectivity', ok: true, message: 'ok', hint: null, fixable: false }),
    checkCacheHealthFn: () => ({ id: 'cache-health', label: 'Attachment cache', ok: true, message: 'ok', hint: null, fixable: false, corruptEntries: [] }),
    checkRecallQueueFn: () => ({ id: 'recall-queue', label: 'Recall sync queue', ok: true, message: 'ok', hint: null, fixable: false }),
    checkMcpRegistrationFn: () => ({ id: 'mcp-registration', label: 'MCP registration', ok: true, message: 'ok', hint: null, fixable: false }),
    ...overrides,
  };
}

describe('runDoctor — checks-only mode', () => {
  it('returns ok:true and renders a checkmark line per check in plain format when everything passes', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    const result = await runDoctor([], { stream, out, ...allOkChecks() });
    assert.equal(result.ok, true);
    assert.match(out.text, /Profile configuration/);
    assert.match(out.text, /License freshness/);
    assert.match(out.text, /Tracker connectivity/);
    assert.match(out.text, /Attachment cache/);
    assert.match(out.text, /Recall sync queue/);
    assert.match(out.text, /MCP registration/);
  });

  it('returns ok:false when any check fails, and prints its hint', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    const overrides = allOkChecks({
      checkProfileConfigFn: () => ({ id: 'profile-config', label: 'Profile configuration', ok: false, message: 'No profile configured.', hint: 'Run `ticketlens init`.', fixable: false }),
    });
    const result = await runDoctor([], { stream, out, ...overrides });
    assert.equal(result.ok, false);
    assert.match(out.text, /No profile configured/);
    assert.match(out.text, /Run `ticketlens init`/);
  });

  it('--format=json prints the exact schemaVersion 1 shape and never includes corruptEntries', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    await runDoctor(['--format=json'], { stream, out, ...allOkChecks() });
    const parsed = JSON.parse(out.text);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.checks.length, 6);
    for (const check of parsed.checks) {
      assert.deepEqual(Object.keys(check).sort(), ['fixable', 'hint', 'id', 'label', 'message', 'ok']);
    }
    assert.deepEqual(parsed.fixed, []);
    assert.deepEqual(parsed.skipped, []);
  });

  it('writes the report to `out` (stdout), never to `stream` (stderr) — the JSON output must be pipeable', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    await runDoctor(['--format=json'], { stream, out, ...allOkChecks() });
    assert.equal(stream.text, '', 'no report bytes should land on the stderr-style stream');
    assert.doesNotThrow(() => JSON.parse(out.text), 'the full report must parse cleanly from out alone');
  });

  it('rejects an invalid --format value without running any checks', async () => {
    const stream = fakeStream();
    let called = false;
    const checkProfileConfigFn = () => { called = true; return { id: 'profile-config', ok: true, message: '', hint: null, fixable: false, label: '' }; };
    const result = await runDoctor(['--format=xml'], { stream, ...allOkChecks({ checkProfileConfigFn }) });
    assert.equal(result.ok, false);
    assert.equal(called, false);
    assert.match(stream.text, /--format must be plain or json/);
  });

  it('threads --profile=NAME into checkProfileConfig, checkConnectivity, and checkCacheHealth, but not checkLicenseFreshness or checkRecallQueue', async () => {
    const seen = {};
    const overrides = allOkChecks({
      checkProfileConfigFn: (opts) => { seen.profileConfig = opts.profileName; return { id: 'profile-config', label: '', ok: true, message: '', hint: null, fixable: false }; },
      checkConnectivityFn: async (opts) => { seen.connectivity = opts.profileName; return { id: 'connectivity', label: '', ok: true, message: '', hint: null, fixable: false }; },
      checkCacheHealthFn: (opts) => { seen.cache = opts.profileName; return { id: 'cache-health', label: '', ok: true, message: '', hint: null, fixable: false, corruptEntries: [] }; },
      checkLicenseFreshnessFn: (opts) => { seen.license = 'profileName' in opts; return { id: 'license-freshness', label: '', ok: true, message: '', hint: null, fixable: false }; },
      checkRecallQueueFn: (opts) => { seen.queue = 'profileName' in opts; return { id: 'recall-queue', label: '', ok: true, message: '', hint: null, fixable: false }; },
    });
    await runDoctor(['--profile=acme'], { stream: fakeStream(), out: fakeStream(), ...overrides });
    assert.equal(seen.profileConfig, 'acme');
    assert.equal(seen.connectivity, 'acme');
    assert.equal(seen.cache, 'acme');
    assert.equal(seen.license, false);
    assert.equal(seen.queue, false);
  });

  it('renders a multi-line hint (one row per profile) as separate indented lines, not one run-on line', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    const multiLineHint = "corenexus: ok\nadvent: Connection timed out → Check your VPN.\nTeam: Authentication failed → Check your token.";
    const overrides = allOkChecks({
      checkConnectivityFn: async () => ({
        id: 'connectivity', label: 'Tracker connectivity', ok: false,
        message: '2/3 profile(s) failed to connect.', hint: multiLineHint, fixable: false,
      }),
    });
    await runDoctor([], { stream, out, ...overrides });
    assert.match(out.text, /      corenexus: ok\n/);
    assert.match(out.text, /      advent: Connection timed out → Check your VPN\.\n/);
    assert.match(out.text, /      Team: Authentication failed → Check your token\.\n/);
  });

  it('end-to-end: the real checkConnectivity join(\'\\n\') output renders as ordered, separately-indented rows through the real renderPlain', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    const testConnectionsFn = async () => ({
      results: [
        { name: 'corenexus', ok: true },
        { name: 'advent', ok: false, error: 'Connection timed out', hint: 'Check your VPN.' },
        { name: 'teammanager', ok: false, error: 'Authentication failed', hint: 'Check your token.' },
      ],
      failedCount: 2,
    });
    const overrides = allOkChecks({
      checkConnectivityFn: (opts) => checkConnectivity({ ...opts, testConnectionsFn }),
    });
    await runDoctor([], { stream, out, ...overrides });

    const start = out.text.indexOf('Tracker connectivity');
    const rows = out.text.slice(start).split('\n').filter(l => l.trim());
    assert.equal(rows[1].trim(), 'corenexus: ok');
    assert.equal(rows[2].trim(), 'advent: Connection timed out → Check your VPN.');
    assert.equal(rows[3].trim(), 'teammanager: Authentication failed → Check your token.');
  });

  it('--format=json preserves an embedded multi-line hint losslessly (real checkConnectivity, multi-profile failure)', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    const testConnectionsFn = async () => ({
      results: [
        { name: 'corenexus', ok: true },
        { name: 'advent', ok: false, error: 'Connection timed out', hint: 'Check your VPN.' },
      ],
      failedCount: 1,
    });
    const overrides = allOkChecks({
      checkConnectivityFn: (opts) => checkConnectivity({ ...opts, testConnectionsFn }),
    });
    await runDoctor(['--format=json'], { stream, out, ...overrides });

    const parsed = JSON.parse(out.text);
    const connectivity = parsed.checks.find(c => c.id === 'connectivity');
    assert.equal(connectivity.hint, 'corenexus: ok\nadvent: Connection timed out → Check your VPN.');
    assert.equal(connectivity.hint.split('\n').length, 2);
  });
});

describe('runDoctor — --mcp flag (MCP registration + handshake checks)', () => {
  it('always includes mcp-registration, even without --mcp', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    await runDoctor(['--format=json'], { stream, out, ...allOkChecks() });
    const parsed = JSON.parse(out.text);
    assert.ok(parsed.checks.find(c => c.id === 'mcp-registration'));
  });

  it('never calls checkMcpHandshakeFn when --mcp is not passed', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    let called = false;
    const checkMcpHandshakeFn = () => { called = true; return { id: 'mcp-handshake', label: 'MCP server handshake', ok: true, message: 'ok', hint: null, fixable: false }; };
    await runDoctor(['--format=json'], { stream, out, ...allOkChecks(), checkMcpHandshakeFn });
    assert.equal(called, false, 'the handshake check must never spawn a subprocess unless --mcp is explicitly passed');
    const parsed = JSON.parse(out.text);
    assert.equal(parsed.checks.find(c => c.id === 'mcp-handshake'), undefined);
    assert.equal(parsed.checks.length, 6);
  });

  it('includes mcp-handshake, calling checkMcpHandshakeFn, when --mcp is passed', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    let called = false;
    const checkMcpHandshakeFn = () => { called = true; return { id: 'mcp-handshake', label: 'MCP server handshake', ok: true, message: 'handshake ok', hint: null, fixable: false }; };
    await runDoctor(['--mcp', '--format=json'], { stream, out, ...allOkChecks(), checkMcpHandshakeFn });
    assert.equal(called, true);
    const parsed = JSON.parse(out.text);
    assert.ok(parsed.checks.find(c => c.id === 'mcp-handshake'));
    assert.equal(parsed.checks.length, 7);
  });
});

describe('runDoctor — progressive checklist loader', () => {
  it('shows an animated spinner + "Checking <label>…" line per check on stream, then writes that check\'s final row to out, in TTY plain mode', async () => {
    const stream = fakeTTYStream();
    const out = fakeStream();
    await runDoctor([], { stream, out, ...allOkChecks() });
    assert.match(stream.text, /Checking profile configuration…/);
    assert.match(stream.text, /Checking license freshness…/);
    assert.match(stream.text, /Checking tracker connectivity…/);
    assert.match(stream.text, /Checking attachment cache…/);
    assert.match(stream.text, /Checking recall sync queue…/);
    assert.match(stream.text, /Checking MCP registration…/);
    assert.ok(stream.text.includes(SPINNER_FRAMES[0]), 'should draw the first spinner frame');
    // Fast (synchronous) mock checks resolve before any spinner tick fires —
    // exactly one erase per check.
    const eraseCount = (stream.text.match(/\x1b\[A\r\x1b\[2K/g) || []).length;
    assert.equal(eraseCount, 6);
    // Each check's final row lands on `out`, not `stream` — appended, never erased.
    assert.match(out.text, /✔ Profile configuration: ok/);
    assert.match(out.text, /✔ License freshness: ok/);
    assert.match(out.text, /✔ Tracker connectivity: ok/);
    assert.match(out.text, /✔ Attachment cache: ok/);
    assert.match(out.text, /✔ Recall sync queue: ok/);
    assert.match(out.text, /✔ MCP registration: ok/);
  });

  it('renders "Checking MCP registration…" and "Checking MCP server handshake…" correctly — lowerFirst must not mangle a leading acronym', async () => {
    const stream = fakeTTYStream();
    const out = fakeStream();
    const checkMcpHandshakeFn = () => ({ id: 'mcp-handshake', label: 'MCP server handshake', ok: true, message: 'ok', hint: null, fixable: false });
    await runDoctor(['--mcp'], { stream, out, ...allOkChecks(), checkMcpHandshakeFn });
    assert.match(stream.text, /Checking MCP registration…/);
    assert.match(stream.text, /Checking MCP server handshake…/);
    assert.doesNotMatch(stream.text, /Checking mCP/);
  });

  it('hides the cursor before the first check and restores it after the last', async () => {
    const stream = fakeTTYStream();
    const out = fakeStream();
    await runDoctor([], { stream, out, ...allOkChecks() });
    assert.ok(stream.text.includes('\x1b[?25l'), 'should hide the cursor');
    assert.ok(stream.text.includes('\x1b[?25h'), 'should restore the cursor');
    assert.ok(stream.text.indexOf('\x1b[?25l') < stream.text.indexOf('\x1b[?25h'), 'hide must come before restore');
  });

  it('registers a SIGINT listener while progress is showing, and removes it afterward — Ctrl+C mid-check must not leave the cursor permanently hidden', async () => {
    const stream = fakeTTYStream();
    const out = fakeStream();
    const listenersBefore = process.listenerCount('SIGINT');
    let listenersDuringCheck;
    const checkConnectivityFn = async () => {
      listenersDuringCheck = process.listenerCount('SIGINT');
      return { id: 'connectivity', label: 'Tracker connectivity', ok: true, message: 'ok', hint: null, fixable: false };
    };
    await runDoctor([], { stream, out, ...allOkChecks({ checkConnectivityFn }) });
    assert.equal(listenersDuringCheck, listenersBefore + 1, 'a SIGINT listener should be registered while checks are running');
    assert.equal(process.listenerCount('SIGINT'), listenersBefore, 'the SIGINT listener must be removed once checks finish');
  });

  it('does not register a SIGINT listener when progress is not shown (non-TTY)', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    const listenersBefore = process.listenerCount('SIGINT');
    await runDoctor([], { stream, out, ...allOkChecks() });
    assert.equal(process.listenerCount('SIGINT'), listenersBefore);
  });

  it('cycles through multiple distinct spinner frames while a slow check is still running', async () => {
    const stream = fakeTTYStream();
    const out = fakeStream();
    const checkConnectivityFn = async () => {
      await new Promise((r) => setTimeout(r, 250));
      return { id: 'connectivity', label: 'Tracker connectivity', ok: true, message: 'ok', hint: null, fixable: false };
    };
    await runDoctor([], { stream, out, ...allOkChecks({ checkConnectivityFn }) });
    const framesSeen = SPINNER_FRAMES.filter((frame) => stream.text.includes(frame));
    assert.ok(framesSeen.length >= 2, `expected multiple distinct spinner frames while the slow check ran, saw ${framesSeen.length}`);
  });

  it("reveals each check's row on `out` incrementally — a later check can already see earlier checks' rows before it itself resolves", async () => {
    const stream = fakeTTYStream();
    const out = fakeStream();
    let snapshotWhenConnectivityStarts;
    const checkConnectivityFn = async () => {
      snapshotWhenConnectivityStarts = out.text;
      return { id: 'connectivity', label: 'Tracker connectivity', ok: true, message: 'ok', hint: null, fixable: false };
    };
    await runDoctor([], { stream, out, ...allOkChecks({ checkConnectivityFn }) });
    assert.match(snapshotWhenConnectivityStarts, /Profile configuration/);
    assert.match(snapshotWhenConnectivityStarts, /License freshness/);
    assert.doesNotMatch(snapshotWhenConnectivityStarts, /Tracker connectivity/, 'the running check\'s own row must not exist yet');
    assert.doesNotMatch(snapshotWhenConnectivityStarts, /Attachment cache/, 'later checks must not have run yet');
  });

  it('Option B: a check that gets fixed keeps its raw pre-fix row on out — only the trailing Fixed: line signals the repair, no row is rewritten', async () => {
    const stream = fakeTTYStream();
    const out = fakeStream();
    let recheckCount = 0;
    const checkLicenseFreshnessFn = () => {
      recheckCount++;
      return recheckCount === 1
        ? { id: 'license-freshness', label: 'License freshness', ok: false, message: 'Not revalidated in over 30 days.', hint: null, fixable: true }
        : { id: 'license-freshness', label: 'License freshness', ok: true, message: 'fresh', hint: null, fixable: false };
    };
    const revalidateLicenseFn = async () => ({ success: true });
    await runDoctor(['--fix'], {
      stream, out, revalidateLicenseFn,
      ...allOkChecks({ checkLicenseFreshnessFn }),
    });
    assert.match(out.text, /✖ License freshness: Not revalidated in over 30 days\./, 'the progressively-shown row must keep its raw pre-fix message');
    assert.doesNotMatch(out.text, /✔ License freshness: fresh/, 'the row must never be rewritten to the post-fix state');
    assert.match(out.text, /Fixed:.*license-freshness/s);
  });

  it('writes no progress bytes to stream when stream is not a TTY (piped)', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    await runDoctor([], { stream, out, ...allOkChecks() });
    assert.equal(stream.text, '');
  });

  it('writes no progress bytes to stream for --format=json even when stream is a TTY', async () => {
    const stream = fakeTTYStream();
    const out = fakeStream();
    await runDoctor(['--format=json'], { stream, out, ...allOkChecks() });
    assert.equal(stream.text, '');
  });

  it('progress lines never reach `out` — the fully-assembled report is byte-identical whether delivered progressively (TTY stream, non-TTY out) or as a single batch (non-TTY both)', async () => {
    const ttyStream = fakeTTYStream();
    const ttyOut = fakeStream();
    await runDoctor([], { stream: ttyStream, out: ttyOut, ...allOkChecks() });

    const plainStream = fakeStream();
    const plainOut = fakeStream();
    await runDoctor([], { stream: plainStream, out: plainOut, ...allOkChecks() });

    assert.equal(ttyOut.text, plainOut.text);
  });
});

describe('runDoctor — --fix mode', () => {
  it('revalidates a stale license, re-checks it, and reports it in fixed[] when now green', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    let revalidated = false;
    let recheckCount = 0;
    const checkLicenseFreshnessFn = () => {
      recheckCount++;
      return recheckCount === 1
        ? { id: 'license-freshness', label: 'License freshness', ok: false, message: 'stale', hint: null, fixable: true }
        : { id: 'license-freshness', label: 'License freshness', ok: true, message: 'fresh', hint: null, fixable: false };
    };
    const revalidateLicenseFn = async () => { revalidated = true; return { success: true }; };
    const result = await runDoctor(['--fix'], {
      stream, out, revalidateLicenseFn,
      ...allOkChecks({ checkLicenseFreshnessFn }),
    });
    assert.equal(revalidated, true);
    assert.equal(result.ok, true);
    assert.match(out.text, /Fixed:.*license-freshness/s);
  });

  it('deletes exactly the corrupt cache entries reported by checkCacheHealth, nothing else', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    const deleted = [];
    const unlinkFn = (p) => deleted.push(p);
    let recheckCount = 0;
    const corruptEntry = { ticketKey: 'ACME-1', filename: 'bad.png', localPath: '/x/bad.png', size: 0 };
    const checkCacheHealthFn = () => {
      recheckCount++;
      return recheckCount === 1
        ? { id: 'cache-health', label: 'Attachment cache', ok: false, message: '1 corrupt', hint: null, fixable: true, corruptEntries: [corruptEntry] }
        : { id: 'cache-health', label: 'Attachment cache', ok: true, message: 'clean', hint: null, fixable: false, corruptEntries: [] };
    };
    const result = await runDoctor(['--fix'], {
      stream, out, unlinkFn,
      ...allOkChecks({ checkCacheHealthFn }),
    });
    assert.deepEqual(deleted, ['/x/bad.png']);
    assert.equal(result.ok, true);
  });

  it('flushes a pending recall queue when logged in, re-checks it, and reports it fixed', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    let flushed = false;
    let recheckCount = 0;
    const checkRecallQueueFn = () => {
      recheckCount++;
      return recheckCount === 1
        ? { id: 'recall-queue', label: 'Recall sync queue', ok: false, message: '2 pending', hint: null, fixable: true }
        : { id: 'recall-queue', label: 'Recall sync queue', ok: true, message: 'clear', hint: null, fixable: false };
    };
    const flushQueueFn = async () => { flushed = true; return { flushed: 2, remaining: 0 }; };
    const readCliTokenFn = () => 'a-real-token';
    const result = await runDoctor(['--fix'], {
      stream, out, flushQueueFn, readCliTokenFn,
      ...allOkChecks({ checkRecallQueueFn }),
    });
    assert.equal(flushed, true);
    assert.equal(result.ok, true);
    assert.match(out.text, /Fixed:.*recall-queue/s);
  });

  it('skips the queue flush (does not call flushQueue) when not logged in, and reports it in skipped[]', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    let flushed = false;
    const checkRecallQueueFn = () => ({ id: 'recall-queue', label: 'Recall sync queue', ok: false, message: '2 pending', hint: null, fixable: true });
    const flushQueueFn = async () => { flushed = true; return { flushed: 2, remaining: 0 }; };
    const readCliTokenFn = () => null;
    const result = await runDoctor(['--fix', '--format=json'], {
      stream, out, flushQueueFn, readCliTokenFn,
      ...allOkChecks({ checkRecallQueueFn }),
    });
    assert.equal(flushed, false);
    assert.equal(result.ok, false);
    const parsed = JSON.parse(out.text);
    assert.deepEqual(parsed.skipped, [{ id: 'recall-queue', reason: 'Not logged in — run `ticketlens login` first.' }]);
  });

  it('applies fixes in license → cache → queue order', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    const order = [];
    const revalidateLicenseFn = async () => { order.push('license'); return { success: true }; };
    const unlinkFn = () => { order.push('cache'); };
    const flushQueueFn = async () => { order.push('queue'); return { flushed: 1, remaining: 0 }; };
    const failing = (id, label) => () => ({ id, label, ok: false, message: 'x', hint: null, fixable: true, corruptEntries: id === 'cache-health' ? [{ localPath: '/x' }] : undefined });
    await runDoctor(['--fix'], {
      stream, out, revalidateLicenseFn, unlinkFn, flushQueueFn,
      readCliTokenFn: () => 'tok',
      ...allOkChecks({
        checkLicenseFreshnessFn: failing('license-freshness', 'License freshness'),
        checkCacheHealthFn: failing('cache-health', 'Attachment cache'),
        checkRecallQueueFn: failing('recall-queue', 'Recall sync queue'),
      }),
    });
    assert.deepEqual(order, ['license', 'cache', 'queue']);
  });

  it('registers ticketlens via mcpInstallFn when mcp-registration is failing and fixable, re-checks, and reports it fixed', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    let installed = false;
    let installedCwd;
    let recheckCount = 0;
    const mcpInstallFn = (opts) => { installed = true; installedCwd = opts.cwd; };
    const checkMcpRegistrationFn = () => {
      recheckCount++;
      return recheckCount === 1
        ? { id: 'mcp-registration', label: 'MCP registration', ok: false, message: 'not registered', hint: null, fixable: true }
        : { id: 'mcp-registration', label: 'MCP registration', ok: true, message: 'registered', hint: null, fixable: false };
    };
    const result = await runDoctor(['--fix'], {
      stream, out, cwd: '/fake/project', mcpInstallFn,
      ...allOkChecks({ checkMcpRegistrationFn }),
    });
    assert.equal(installed, true);
    assert.equal(installedCwd, '/fake/project');
    assert.equal(result.ok, true);
    assert.match(out.text, /Fixed:.*mcp-registration/s);
  });

  it('does not attempt a fix for mcp-registration when it is failing but not fixable (malformed .mcp.json)', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    let installed = false;
    const mcpInstallFn = () => { installed = true; };
    const checkMcpRegistrationFn = () => ({ id: 'mcp-registration', label: 'MCP registration', ok: false, message: 'malformed', hint: null, fixable: false });
    const result = await runDoctor(['--fix', '--format=json'], {
      stream, out, mcpInstallFn,
      ...allOkChecks({ checkMcpRegistrationFn }),
    });
    assert.equal(installed, false);
    const parsed = JSON.parse(out.text);
    assert.deepEqual(parsed.fixed, []);
    assert.equal(result.ok, false);
  });

  it('does not attempt a fix for a check that is failing but not fixable (e.g. connectivity)', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    const checkConnectivityFn = async () => ({ id: 'connectivity', label: 'Tracker connectivity', ok: false, message: 'down', hint: null, fixable: false });
    const result = await runDoctor(['--fix', '--format=json'], {
      stream, out, ...allOkChecks({ checkConnectivityFn }),
    });
    const parsed = JSON.parse(out.text);
    assert.deepEqual(parsed.fixed, []);
    assert.deepEqual(parsed.skipped, []);
    assert.equal(result.ok, false);
  });

  it('--fix --profile=X reports cache-health in fixed[] when X has corrupt entries that are fixed, even if an unrelated profile has unrelated corruption', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    const deleted = [];
    const unlinkFn = (p) => deleted.push(p);
    let checkCacheHealthCallCount = 0;
    let seenProfileNames = [];
    const checkCacheHealthFn = (opts) => {
      checkCacheHealthCallCount++;
      seenProfileNames.push(opts.profileName);
      // First call (initial check) for profile='acme': has 1 corrupt entry
      if (checkCacheHealthCallCount === 1) {
        return { id: 'cache-health', label: 'Attachment cache', ok: false, message: '1 corrupt', hint: null, fixable: true, corruptEntries: [{ ticketKey: 'ACME-1', filename: 'bad.png', localPath: '/cache/acme/bad.png', size: 0 }] };
      }
      // Recheck for profile='acme' after deletion: should be clean (the one corrupt entry was deleted)
      if (checkCacheHealthCallCount === 2 && opts.profileName === 'acme') {
        return { id: 'cache-health', label: 'Attachment cache', ok: true, message: 'clean', hint: null, fixable: false, corruptEntries: [] };
      }
      // Fallback (shouldn't be called in this test)
      return { id: 'cache-health', label: 'Attachment cache', ok: true, message: 'ok', hint: null, fixable: false, corruptEntries: [] };
    };
    const result = await runDoctor(['--fix', '--profile=acme', '--format=json'], {
      stream, out, unlinkFn,
      ...allOkChecks({ checkCacheHealthFn }),
    });
    assert.deepEqual(deleted, ['/cache/acme/bad.png']);
    assert.deepEqual(seenProfileNames, ['acme', 'acme']);
    const parsed = JSON.parse(out.text);
    assert.deepEqual(parsed.fixed, ['cache-health']);
    assert.equal(result.ok, true);
  });

  it('--fix --format=json with a failing fixable license-freshness check produces valid JSON without interleaved status messages', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    let recheckCount = 0;
    const checkLicenseFreshnessFn = () => {
      recheckCount++;
      return recheckCount === 1
        ? { id: 'license-freshness', label: 'License freshness', ok: false, message: 'stale', hint: null, fixable: true }
        : { id: 'license-freshness', label: 'License freshness', ok: true, message: 'fresh', hint: null, fixable: false };
    };
    const revalidateLicenseFn = async () => ({ success: true });
    const result = await runDoctor(['--fix', '--format=json'], {
      stream, out, revalidateLicenseFn,
      ...allOkChecks({ checkLicenseFreshnessFn }),
    });
    // In --format=json mode, progress chatter ("Revalidating license...") is
    // suppressed entirely (it's gated on format === 'plain'), so `stream`
    // stays empty and the report on `out` is never at risk of interleaving.
    const parsed = JSON.parse(out.text);
    assert.deepEqual(parsed.fixed, ['license-freshness']);
    assert.equal(result.ok, true);
    assert.equal(stream.text, '');
  });

  it('--fix --format=json with a failing fixable recall-queue check produces valid JSON without interleaved status messages', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    let recheckCount = 0;
    const checkRecallQueueFn = () => {
      recheckCount++;
      return recheckCount === 1
        ? { id: 'recall-queue', label: 'Recall sync queue', ok: false, message: '3 pending', hint: null, fixable: true }
        : { id: 'recall-queue', label: 'Recall sync queue', ok: true, message: 'clear', hint: null, fixable: false };
    };
    const flushQueueFn = async () => ({ flushed: 3, remaining: 0 });
    const readCliTokenFn = () => 'auth-token';
    const result = await runDoctor(['--fix', '--format=json'], {
      stream, out, flushQueueFn, readCliTokenFn,
      ...allOkChecks({ checkRecallQueueFn }),
    });
    // Same isolation guarantee as above, for the queue-flush progress message.
    const parsed = JSON.parse(out.text);
    assert.deepEqual(parsed.fixed, ['recall-queue']);
    assert.equal(result.ok, true);
    assert.equal(stream.text, '');
  });

  it('a partial-success fix (recheck still ok:false, but improved) updates the reported state without adding it to fixed[]', async () => {
    const stream = fakeStream();
    const out = fakeStream();
    // Queue starts with 5 pending notes; flushQueue pushes 3, leaving 2 —
    // a real partial success. The recheck after the flush must be what gets
    // rendered, not the stale pre-fix "5 note(s) pending sync." message.
    let recheckCount = 0;
    const checkRecallQueueFn = () => {
      recheckCount++;
      return recheckCount === 1
        ? { id: 'recall-queue', label: 'Recall sync queue', ok: false, message: '5 note(s) pending sync.', hint: 'retry', fixable: true }
        : { id: 'recall-queue', label: 'Recall sync queue', ok: false, message: '2 note(s) pending sync.', hint: 'retry', fixable: true };
    };
    const flushQueueFn = async () => ({ flushed: 3, remaining: 2 });
    const readCliTokenFn = () => 'a-real-token';
    const result = await runDoctor(['--fix', '--format=json'], {
      stream, out, flushQueueFn, readCliTokenFn,
      ...allOkChecks({ checkRecallQueueFn }),
    });
    const parsed = JSON.parse(out.text);
    const queueCheck = parsed.checks.find(c => c.id === 'recall-queue');
    assert.equal(queueCheck.message, '2 note(s) pending sync.', 'must reflect the post-fix recheck, not the stale pre-fix count');
    assert.deepEqual(parsed.fixed, [], 'a still-failing recheck must never land in fixed[]');
    assert.equal(result.ok, false);
  });
});
