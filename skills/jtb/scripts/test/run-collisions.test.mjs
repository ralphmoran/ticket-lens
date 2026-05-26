import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCollisions } from '../lib/run-collisions.mjs';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFetcher(status, body = {}) {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function makeCollision(overrides = {}) {
  return {
    your_branch:   'feat/PROJ-123',
    your_tickets:  ['PROJ-123'],
    teammate:      'alice',
    their_branch:  'feat/PROJ-456',
    their_tickets: ['PROJ-456'],
    shared_files:  ['src/checkout.js'],
    ...overrides,
  };
}

// ── No license key ────────────────────────────────────────────────────────────

describe('runCollisions — no license key', () => {
  it('prints error and returns ok:false when license is null', async () => {
    const lines = [];
    const result = await runCollisions([], {
      readLicenseFn: () => null,
      fetcher: makeFetcher(200),
      print: s => lines.push(s),
    });
    assert.ok(!result.ok);
    assert.ok(lines.some(l => l.includes('Team license')));
  });

  it('does not call fetcher without license', async () => {
    let called = false;
    await runCollisions([], {
      readLicenseFn: () => null,
      fetcher: async () => { called = true; return { ok: true, json: async () => ({}) }; },
      print: () => {},
    });
    assert.ok(!called);
  });
});

// ── Auth errors ───────────────────────────────────────────────────────────────

describe('runCollisions — auth errors', () => {
  it('prints error and returns ok:false on 401', async () => {
    const lines = [];
    const result = await runCollisions([], {
      readLicenseFn: () => ({ key: 'bad-key' }),
      fetcher: makeFetcher(401),
      print: s => lines.push(s),
    });
    assert.ok(!result.ok);
    assert.equal(result.status, 401);
  });

  it('prints Team license message on 403', async () => {
    const lines = [];
    const result = await runCollisions([], {
      readLicenseFn: () => ({ key: 'free-key' }),
      fetcher: makeFetcher(403),
      print: s => lines.push(s),
    });
    assert.ok(!result.ok);
    assert.equal(result.status, 403);
    assert.ok(lines.some(l => l.includes('Team license')));
  });
});

// ── Successful response ───────────────────────────────────────────────────────

describe('runCollisions — successful response', () => {
  it('returns ok:true on successful fetch', async () => {
    const result = await runCollisions([], {
      readLicenseFn: () => ({ key: 'team-key' }),
      fetcher: makeFetcher(200, { collisions: [] }),
      print: () => {},
    });
    assert.ok(result.ok);
  });

  it('prints no-collision message when collisions is empty', async () => {
    const lines = [];
    await runCollisions([], {
      readLicenseFn: () => ({ key: 'team-key' }),
      fetcher: makeFetcher(200, { collisions: [] }),
      print: s => lines.push(s),
    });
    assert.ok(lines.some(l => l.includes('No branch collisions')));
  });

  it('prints collision details when collisions returned', async () => {
    const lines = [];
    await runCollisions([], {
      readLicenseFn: () => ({ key: 'team-key' }),
      fetcher: makeFetcher(200, { collisions: [makeCollision()] }),
      print: s => lines.push(s),
    });
    assert.ok(lines.some(l => l.includes('alice') || l.includes('collision')));
  });

  it('prints message from API when collisions empty + message present', async () => {
    const lines = [];
    await runCollisions([], {
      readLicenseFn: () => ({ key: 'team-key' }),
      fetcher: makeFetcher(200, { collisions: [], message: 'No branch data found.' }),
      print: s => lines.push(s),
    });
    assert.ok(lines.some(l => l.includes('No branch data found.')));
  });
});

// ── --json flag ───────────────────────────────────────────────────────────────

describe('runCollisions — --json flag', () => {
  it('passes json flag to reporter', async () => {
    const lines = [];
    await runCollisions(['--json'], {
      readLicenseFn: () => ({ key: 'team-key' }),
      fetcher: makeFetcher(200, { collisions: [makeCollision()] }),
      print: s => lines.push(s),
    });
    const combined = lines.join('');
    JSON.parse(combined); // must be valid JSON, throws if not
  });
});

// ── Network error ─────────────────────────────────────────────────────────────

describe('runCollisions — network error', () => {
  it('returns ok:false on network error without throwing', async () => {
    const result = await runCollisions([], {
      readLicenseFn: () => ({ key: 'team-key' }),
      fetcher: async () => { throw new Error('ECONNREFUSED'); },
      print: () => {},
    });
    assert.ok(!result.ok);
  });

  it('prints warning on network error', async () => {
    const lines = [];
    await runCollisions([], {
      readLicenseFn: () => ({ key: 'team-key' }),
      fetcher: async () => { throw new Error('ECONNREFUSED'); },
      print: s => lines.push(s),
    });
    assert.ok(lines.some(l => l.includes('Failed') || l.includes('error')));
  });
});

describe('runCollisions — http warning (item 3)', () => {
  afterEach(() => { delete process.env.TICKETLENS_API_URL; });

  it('calls warn when TICKETLENS_API_URL is http:// with a non-local host', async () => {
    process.env.TICKETLENS_API_URL = 'http://prod.example.com';
    const warnings = [];
    await runCollisions([], {
      readLicenseFn: () => ({ key: 'k' }),
      fetcher: async () => ({ ok: true, json: async () => ({ collisions: [] }) }),
      print: () => {},
      warn: msg => warnings.push(msg),
    });
    assert.ok(warnings.length > 0, 'warn must be called for http:// non-local URL');
  });

  it('does NOT warn for http://ticketlens.test (local .test domain)', async () => {
    process.env.TICKETLENS_API_URL = 'http://ticketlens.test';
    const warnings = [];
    await runCollisions([], {
      readLicenseFn: () => ({ key: 'k' }),
      fetcher: async () => ({ ok: true, json: async () => ({ collisions: [] }) }),
      print: () => {},
      warn: msg => warnings.push(msg),
    });
    assert.equal(warnings.length, 0, 'no warning for .test local domain');
  });
});
