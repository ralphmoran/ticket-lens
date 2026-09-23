import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maybeReportError } from '../lib/error-reporter.mjs';
import { loadErrorReportingConsent } from '../lib/profile-resolver.mjs';

describe('maybeReportError (49e)', () => {
  let configDir;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'ticketlens-'));
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
  });

  function fakeFetcher(calls) {
    return async (url, opts) => {
      calls.push({ url, opts });
      return { ok: true, status: 201 };
    };
  }

  // ---- consent: never-asked, interactive ----

  it('prompts once when consent was never asked, and sends when the user says yes', async () => {
    const calls = [];
    const promptFn = async () => true;

    await maybeReportError(new Error('boom'), 'note', {
      configDir,
      isInteractive: true,
      promptFn,
      fetcher: fakeFetcher(calls),
    });

    assert.equal(loadErrorReportingConsent(configDir), true);
    assert.equal(calls.length, 1);
  });

  it('prompts once, persists false, and does not send when the user says no', async () => {
    const calls = [];
    const promptFn = async () => false;

    await maybeReportError(new Error('boom'), 'note', {
      configDir,
      isInteractive: true,
      promptFn,
      fetcher: fakeFetcher(calls),
    });

    assert.equal(loadErrorReportingConsent(configDir), false);
    assert.equal(calls.length, 0);
  });

  // ---- prompt timeout (security review, 2026-09-23) — a timed-out prompt
  // is neither yes nor no, so it must never be persisted as a permanent
  // decision, unlike a real answer above.

  it('does not persist consent and does not send when promptFn times out (resolves null)', async () => {
    const calls = [];
    const promptFn = async () => null;

    await maybeReportError(new Error('boom'), 'note', {
      configDir,
      isInteractive: true,
      promptFn,
      fetcher: fakeFetcher(calls),
    });

    assert.equal(loadErrorReportingConsent(configDir), undefined);
    assert.equal(calls.length, 0);
  });

  it('asks again on the next error after a prompt timeout, unlike a real answer', async () => {
    const calls = [];
    let promptCount = 0;
    const promptFn = async () => { promptCount++; return null; };

    await maybeReportError(new Error('first'), 'note', { configDir, isInteractive: true, promptFn, fetcher: fakeFetcher(calls) });
    await maybeReportError(new Error('second'), 'note', { configDir, isInteractive: true, promptFn, fetcher: fakeFetcher(calls) });

    assert.equal(promptCount, 2);
  });

  it('passes promptTimeoutMs through to promptFn as opts.timeoutMs', async () => {
    let receivedOpts;
    const promptFn = async (question, opts) => { receivedOpts = opts; return true; };

    await maybeReportError(new Error('boom'), 'note', {
      configDir,
      isInteractive: true,
      promptFn,
      promptTimeoutMs: 12345,
      fetcher: fakeFetcher([]),
    });

    assert.equal(receivedOpts.timeoutMs, 12345);
  });

  // ---- consent: never-asked, NON-interactive — the MCP/CI safety gate ----

  it('never prompts and never sends when not interactive and consent is undecided', async () => {
    const calls = [];
    let promptCalled = false;
    const promptFn = async () => { promptCalled = true; return true; };

    await maybeReportError(new Error('boom'), 'note', {
      configDir,
      isInteractive: false,
      promptFn,
      fetcher: fakeFetcher(calls),
    });

    assert.equal(promptCalled, false);
    assert.equal(calls.length, 0);
    assert.equal(loadErrorReportingConsent(configDir), undefined);
  });

  // ---- consent: already decided ----

  it('sends without prompting when consent is already true', async () => {
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({ profiles: {}, errorReporting: true }));
    const calls = [];
    let promptCalled = false;
    const promptFn = async () => { promptCalled = true; return true; };

    await maybeReportError(new Error('boom'), 'note', {
      configDir,
      isInteractive: true,
      promptFn,
      fetcher: fakeFetcher(calls),
    });

    assert.equal(promptCalled, false);
    assert.equal(calls.length, 1);
  });

  it('does not send and does not prompt when consent is already false', async () => {
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({ profiles: {}, errorReporting: false }));
    const calls = [];
    let promptCalled = false;
    const promptFn = async () => { promptCalled = true; return true; };

    await maybeReportError(new Error('boom'), 'note', {
      configDir,
      isInteractive: true,
      promptFn,
      fetcher: fakeFetcher(calls),
    });

    assert.equal(promptCalled, false);
    assert.equal(calls.length, 0);
  });

  // ---- this also holds under non-interactive (MCP) once consent is already true ----

  it('sends without prompting under non-interactive when consent is already true', async () => {
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({ profiles: {}, errorReporting: true }));
    const calls = [];

    await maybeReportError(new Error('boom'), 'note', {
      configDir,
      isInteractive: false,
      promptFn: async () => { throw new Error('must not be called'); },
      fetcher: fakeFetcher(calls),
    });

    assert.equal(calls.length, 1);
  });

  // ---- secret scanning — client-side pre-check ----

  it('does not send when the error message contains a secret', async () => {
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({ profiles: {}, errorReporting: true }));
    const calls = [];

    await maybeReportError(new Error('Prod key is AKIAIOSFODNN7EXAMPLE'), 'note', {
      configDir,
      fetcher: fakeFetcher(calls),
    });

    assert.equal(calls.length, 0);
  });

  it('does not send when the stack trace contains a secret', async () => {
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({ profiles: {}, errorReporting: true }));
    const calls = [];
    const err = new Error('boom');
    err.stack = 'Error: boom\n    token=AKIAIOSFODNN7EXAMPLE';

    await maybeReportError(err, 'note', {
      configDir,
      fetcher: fakeFetcher(calls),
    });

    assert.equal(calls.length, 0);
  });

  // ---- payload shape ----

  it('sends cli_version/os/command/message/stack_trace as JSON', async () => {
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({ profiles: {}, errorReporting: true }));
    const calls = [];
    const err = new Error('ENOENT: missing file');
    err.stack = 'Error: ENOENT: missing file\n    at foo (bar.js:1)';

    await maybeReportError(err, 'note', {
      configDir,
      fetcher: fakeFetcher(calls),
    });

    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.command, 'note');
    assert.equal(body.message, 'ENOENT: missing file');
    assert.match(body.stack_trace, /at foo/);
    assert.ok(body.cli_version);
    assert.ok(body.os);
  });

  // Regression (2026-09-23): a real Error's own .stack — not a hand-crafted
  // one — has many "at fn (node:internal/...:L:C)" frames that false-
  // positived the full entropy scanner almost every line, silently dropping
  // nearly every real report. Caught by this test failing under node:test's
  // own real call stack, not by a synthetic 2-line fixture.
  it('sends a report built from a real, naturally-thrown error with no secret', async () => {
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({ profiles: {}, errorReporting: true }));
    const calls = [];

    function throwsDeep() { throw new Error('a real crash'); }
    let realErr;
    try { throwsDeep(); } catch (e) { realErr = e; }

    await maybeReportError(realErr, 'note', { configDir, fetcher: fakeFetcher(calls) });

    assert.equal(calls.length, 1);
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.message, 'a real crash');
    assert.match(body.stack_trace, /throwsDeep/);
  });

  it('posts to <apiBase>/v1/reports', async () => {
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({ profiles: {}, errorReporting: true }));
    const calls = [];

    await maybeReportError(new Error('boom'), 'note', {
      configDir,
      fetcher: fakeFetcher(calls),
    });

    assert.match(calls[0].url, /\/v1\/reports$/);
  });

  // ---- best-effort: never throws ----

  it('never throws when the fetcher rejects', async () => {
    writeFileSync(join(configDir, 'profiles.json'), JSON.stringify({ profiles: {}, errorReporting: true }));

    await assert.doesNotReject(() => maybeReportError(new Error('boom'), 'note', {
      configDir,
      fetcher: async () => { throw new Error('network down'); },
    }));
  });

  it('never throws when promptFn rejects', async () => {
    await assert.doesNotReject(() => maybeReportError(new Error('boom'), 'note', {
      configDir,
      isInteractive: true,
      promptFn: async () => { throw new Error('stdin closed'); },
      fetcher: async () => ({ ok: true }),
    }));
  });
});
