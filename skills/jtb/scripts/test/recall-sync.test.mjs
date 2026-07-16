import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pushNote, pullNotes } from '../lib/recall-sync.mjs';

function makeFetcher(status, body = {}) {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

const sampleNote = {
  external_id: '1700000000000-abcdef.md',
  title: 'Retry gotcha',
  tickets: ['PROD-1'],
  tags: ['bug'],
  author: 'ralph',
  sources: [],
  body: 'Needs exponential backoff.',
};

let configDir;

function freshConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tl-recall-sync-test-'));
}

// ---------------------------------------------------------------------------
// pushNote — no cliToken
// ---------------------------------------------------------------------------

describe('pushNote — no cliToken', () => {
  it('does not call fetcher and reports failure', async () => {
    let fetchCalled = false;
    const result = await pushNote(sampleNote, {
      cliToken: null,
      configDir: freshConfigDir(),
      fetcher: () => { fetchCalled = true; },
      warn: () => {},
    });
    assert.equal(fetchCalled, false);
    assert.equal(result.ok, false);
  });
});

// ---------------------------------------------------------------------------
// pushNote — HTTP outcomes
// ---------------------------------------------------------------------------

describe('pushNote — HTTP outcomes', () => {
  it('returns ok:true on 2xx and sends the note as JSON with a bearer header', async () => {
    let capturedUrl, capturedOpts;
    const fetcher = async (url, opts) => { capturedUrl = url; capturedOpts = opts; return { ok: true, status: 200, json: async () => ({}) }; };
    const result = await pushNote(sampleNote, { cliToken: 'tl_key', configDir: freshConfigDir(), fetcher, warn: () => {} });
    assert.equal(result.ok, true);
    assert.match(capturedUrl, /\/v1\/recall\/push$/);
    assert.equal(capturedOpts.headers.Authorization, 'Bearer tl_key');
    assert.equal(JSON.parse(capturedOpts.body).external_id, sampleNote.external_id);
  });

  it('sends Accept: application/json — without it, a Laravel validation failure 302-redirects instead of returning JSON, and fetch silently follows it into a false ok:true', async () => {
    let capturedOpts;
    const fetcher = async (url, opts) => { capturedOpts = opts; return { ok: true, status: 200, json: async () => ({}) }; };
    await pushNote(sampleNote, { cliToken: 'tl_key', configDir: freshConfigDir(), fetcher, warn: () => {} });
    assert.equal(capturedOpts.headers.Accept, 'application/json');
  });

  it('sets redirect: manual — an unexpected redirect must surface as a failure, never a silently-followed 200', async () => {
    let capturedOpts;
    const fetcher = async (url, opts) => { capturedOpts = opts; return { ok: true, status: 200, json: async () => ({}) }; };
    await pushNote(sampleNote, { cliToken: 'tl_key', configDir: freshConfigDir(), fetcher, warn: () => {} });
    assert.equal(capturedOpts.redirect, 'manual');
  });

  it('reports failure clearly (not silently) on 401 session expiry', async () => {
    const warnings = [];
    const result = await pushNote(sampleNote, { cliToken: 'tl_key', configDir: freshConfigDir(), fetcher: makeFetcher(401), warn: (s) => warnings.push(s) });
    assert.equal(result.ok, false);
    assert.ok(warnings.some(w => /session expired/i.test(w)));
  });

  it('reports failure clearly on 403 not-entitled', async () => {
    const warnings = [];
    const result = await pushNote(sampleNote, { cliToken: 'tl_key', configDir: freshConfigDir(), fetcher: makeFetcher(403, { error: 'Recall is not enabled for your account' }), warn: (s) => warnings.push(s) });
    assert.equal(result.ok, false);
    assert.ok(warnings.some(w => /plan doesn't include/i.test(w)), 'not-entitled 403 must say the plan/entitlement is the blocker');
  });

  it('reports a distinct message on 403 no-team — found via Local Live Test: the generic "plan doesn\'t include" message is actively misleading when a Pro user is simply not on any team yet', async () => {
    const warnings = [];
    const result = await pushNote(sampleNote, { cliToken: 'tl_key', configDir: freshConfigDir(), fetcher: makeFetcher(403, { error: 'No team found' }), warn: (s) => warnings.push(s) });
    assert.equal(result.ok, false);
    assert.ok(warnings.some(w => /team/i.test(w) && !/plan doesn't include/i.test(w)), 'no-team 403 must say the user has no team, not misattribute it to plan/entitlement');
  });

  it('falls back to the generic message on a 403 with no recognizable body (e.g. json() throws)', async () => {
    const warnings = [];
    const fetcher = async () => ({ ok: false, status: 403, json: async () => { throw new Error('not json'); } });
    const result = await pushNote(sampleNote, { cliToken: 'tl_key', configDir: freshConfigDir(), fetcher, warn: (s) => warnings.push(s) });
    assert.equal(result.ok, false);
    assert.ok(warnings.some(w => w.length > 0), 'must still warn even if the error body cannot be parsed');
  });

  it('reports failure clearly on a network error, never throws', async () => {
    const warnings = [];
    const fetcher = async () => { throw new Error('ECONNREFUSED'); };
    const result = await pushNote(sampleNote, { cliToken: 'tl_key', configDir: freshConfigDir(), fetcher, warn: (s) => warnings.push(s) });
    assert.equal(result.ok, false);
    assert.ok(warnings.some(w => w.length > 0), 'a network failure must produce a visible warning, not silence');
  });

  it('applies a request timeout', async () => {
    let capturedOpts;
    const fetcher = async (url, opts) => { capturedOpts = opts; return { ok: true, status: 200, json: async () => ({}) }; };
    await pushNote(sampleNote, { cliToken: 'tl_key', configDir: freshConfigDir(), fetcher, warn: () => {} });
    assert.ok(capturedOpts.signal instanceof AbortSignal);
  });
});

// ---------------------------------------------------------------------------
// pullNotes — no cliToken
// ---------------------------------------------------------------------------

describe('pullNotes — no cliToken', () => {
  it('does not call fetcher, returns without writing anything', async () => {
    let fetchCalled = false;
    const result = await pullNotes({ cliToken: null, configDir: freshConfigDir(), fetcher: () => { fetchCalled = true; } });
    assert.equal(fetchCalled, false);
    assert.equal(result.ok, false);
  });
});

// ---------------------------------------------------------------------------
// pullNotes — TTL gate (checked before any network cost)
// ---------------------------------------------------------------------------

describe('pullNotes — TTL gate', () => {
  it('skips the network call entirely when the last pull is within ttlMs', async () => {
    configDir = freshConfigDir();
    let fetchCalls = 0;
    const fetcher = async () => { fetchCalls++; return { ok: true, status: 200, json: async () => ({ notes: [] }) }; };
    await pullNotes({ cliToken: 'tl_key', configDir, fetcher, ttlMs: 4 * 60 * 60 * 1000 });
    assert.equal(fetchCalls, 1, 'first call always pulls (no prior state)');
    await pullNotes({ cliToken: 'tl_key', configDir, fetcher, ttlMs: 4 * 60 * 60 * 1000 });
    assert.equal(fetchCalls, 1, 'second call within TTL must not touch the network again');
  });

  it('pulls again once ttlMs has elapsed', async () => {
    configDir = freshConfigDir();
    let fetchCalls = 0;
    const fetcher = async () => { fetchCalls++; return { ok: true, status: 200, json: async () => ({ notes: [] }) }; };
    await pullNotes({ cliToken: 'tl_key', configDir, fetcher, ttlMs: 1 });
    await new Promise(r => setTimeout(r, 5));
    await pullNotes({ cliToken: 'tl_key', configDir, fetcher, ttlMs: 1 });
    assert.equal(fetchCalls, 2);
  });

  it('a ttlMs of 0 always forces a fresh pull', async () => {
    configDir = freshConfigDir();
    let fetchCalls = 0;
    const fetcher = async () => { fetchCalls++; return { ok: true, status: 200, json: async () => ({ notes: [] }) }; };
    await pullNotes({ cliToken: 'tl_key', configDir, fetcher, ttlMs: 0 });
    await pullNotes({ cliToken: 'tl_key', configDir, fetcher, ttlMs: 0 });
    assert.equal(fetchCalls, 2);
  });
});

// ---------------------------------------------------------------------------
// pullNotes — writes pulled notes locally
// ---------------------------------------------------------------------------

describe('pullNotes — writes results into the local vault', () => {
  it('writes each returned note via upsertPulledNote and rebuilds the index once per touched prefix, not per note', async () => {
    configDir = freshConfigDir();
    const upserted = [];
    const rebuilt = [];
    const fetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ notes: [
        { ...sampleNote, external_id: '1700000000001-aaaaaa.md', tickets: ['PROD-1'] },
        { ...sampleNote, external_id: '1700000000002-bbbbbb.md', tickets: ['PROD-2'] },
      ] }),
    });
    const result = await pullNotes({
      cliToken: 'tl_key',
      configDir,
      fetcher,
      upsertPulledNoteFn: (note) => { upserted.push(note.external_id); return { id: note.external_id, path: `/fake/PROD/${note.external_id}` }; },
      rebuildIndexFn: (prefix) => { rebuilt.push(prefix); },
    });
    assert.equal(result.ok, true);
    assert.equal(result.count, 2);
    assert.deepEqual(upserted, ['1700000000001-aaaaaa.md', '1700000000002-bbbbbb.md']);
    assert.equal(rebuilt.length, 1, 'both notes share the PROD prefix — one rebuild, not two');
  });

  it('one malformed note in the batch does not abort the rest of the pull', async () => {
    configDir = freshConfigDir();
    const upserted = [];
    const fetcher = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ notes: [
        { ...sampleNote, external_id: 'not-a-valid-id' },
        { ...sampleNote, external_id: '1700000000003-cccccc.md' },
      ] }),
    });
    const result = await pullNotes({
      cliToken: 'tl_key',
      configDir,
      fetcher,
      upsertPulledNoteFn: (note) => {
        if (note.external_id === 'not-a-valid-id') throw new Error('Invalid externalId');
        upserted.push(note.external_id);
        return { id: note.external_id, path: `/fake/PROD/${note.external_id}` };
      },
      rebuildIndexFn: () => {},
    });
    assert.equal(result.ok, true);
    assert.deepEqual(upserted, ['1700000000003-cccccc.md']);
  });
});

// ---------------------------------------------------------------------------
// pullNotes — HTTP errors and timeout
// ---------------------------------------------------------------------------

describe('pullNotes — HTTP errors and timeout are non-fatal', () => {
  it('returns ok:false on 401, never throws', async () => {
    const result = await pullNotes({ cliToken: 'tl_key', configDir: freshConfigDir(), fetcher: makeFetcher(401) });
    assert.equal(result.ok, false);
  });

  it('returns ok:false on a network error, never throws', async () => {
    const fetcher = async () => { throw new Error('ECONNREFUSED'); };
    const result = await pullNotes({ cliToken: 'tl_key', configDir: freshConfigDir(), fetcher });
    assert.equal(result.ok, false);
  });

  it('accepts a caller-supplied short timeoutMs, separate from the default', async () => {
    let capturedOpts;
    const fetcher = async (url, opts) => { capturedOpts = opts; return { ok: true, status: 200, json: async () => ({ notes: [] }) }; };
    await pullNotes({ cliToken: 'tl_key', configDir: freshConfigDir(), fetcher, timeoutMs: 2000 });
    assert.ok(capturedOpts.signal instanceof AbortSignal);
  });

  it('sends Accept: application/json and redirect: manual, same rationale as pushNote', async () => {
    let capturedOpts;
    const fetcher = async (url, opts) => { capturedOpts = opts; return { ok: true, status: 200, json: async () => ({ notes: [] }) }; };
    await pullNotes({ cliToken: 'tl_key', configDir: freshConfigDir(), fetcher });
    assert.equal(capturedOpts.headers.Accept, 'application/json');
    assert.equal(capturedOpts.redirect, 'manual');
  });
});

// ---------------------------------------------------------------------------
// pullNotes — since-delta
// ---------------------------------------------------------------------------

describe('pullNotes — since-delta', () => {
  it('sends no since param on the very first pull', async () => {
    let capturedUrl;
    const fetcher = async (url) => { capturedUrl = url; return { ok: true, status: 200, json: async () => ({ notes: [] }) }; };
    await pullNotes({ cliToken: 'tl_key', configDir: freshConfigDir(), fetcher });
    assert.ok(!capturedUrl.includes('since='));
  });

  it('sends a since param matching the last successful pull on a later call', async () => {
    configDir = freshConfigDir();
    const urls = [];
    const fetcher = async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => ({ notes: [] }) }; };
    await pullNotes({ cliToken: 'tl_key', configDir, fetcher, ttlMs: 0 });
    await pullNotes({ cliToken: 'tl_key', configDir, fetcher, ttlMs: 0 });
    assert.ok(!urls[0].includes('since='));
    assert.ok(urls[1].includes('since='));
  });
});
