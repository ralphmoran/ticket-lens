import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildJiraEnv, getVersion, getPackageMeta, hostnameOf, timeAgo } from '../lib/config.mjs';

describe('getPackageMeta', () => {
  it('returns version matching getVersion()', () => {
    assert.equal(getPackageMeta().version, getVersion());
  });

  it('returns a non-empty author', () => {
    assert.ok(getPackageMeta().author.length > 0);
  });

  it('returns a repository string referencing ticket-lens', () => {
    assert.match(getPackageMeta().repository, /ticket-lens/);
  });
});

describe('buildJiraEnv', () => {
  it('uses PAT auth when conn.pat is set', () => {
    const env = buildJiraEnv({ baseUrl: 'https://jira.example.com', pat: 'my-pat' });
    assert.equal(env.JIRA_BASE_URL, 'https://jira.example.com');
    assert.equal(env.JIRA_PAT, 'my-pat');
    assert.equal(env.JIRA_EMAIL, undefined);
    assert.equal(env.JIRA_API_TOKEN, undefined);
  });

  it('uses basic auth when conn.pat is absent', () => {
    const env = buildJiraEnv({ baseUrl: 'https://jira.example.com', email: 'user@x.com', apiToken: 'tok' });
    assert.equal(env.JIRA_BASE_URL, 'https://jira.example.com');
    assert.equal(env.JIRA_EMAIL, 'user@x.com');
    assert.equal(env.JIRA_API_TOKEN, 'tok');
    assert.equal(env.JIRA_PAT, undefined);
  });
});

describe('hostnameOf', () => {
  it('extracts the hostname from a valid URL', () => {
    assert.equal(hostnameOf('https://jira.example.com/some/path'), 'jira.example.com');
  });

  it('returns null for an unparseable URL', () => {
    assert.equal(hostnameOf('not a url'), null);
  });

  it('returns null for an empty string', () => {
    assert.equal(hostnameOf(''), null);
  });

  it('distinguishes different hosts, including subdomain differences', () => {
    assert.notEqual(hostnameOf('https://a.example.com'), hostnameOf('https://b.example.com'));
  });
});

describe('timeAgo', () => {
  const FIXED_NOW = new Date('2026-07-31T12:00:00.000Z');
  const now = () => FIXED_NOW;

  it('returns empty string for a falsy input', () => {
    assert.equal(timeAgo(null), '');
    assert.equal(timeAgo(undefined), '');
    assert.equal(timeAgo(''), '');
  });

  it('under 1 hour: minutes ago', () => {
    assert.equal(timeAgo('2026-07-31T11:59:00.000Z', { now }), '1m ago');
    assert.equal(timeAgo('2026-07-31T11:30:00.000Z', { now }), '30m ago');
  });

  it('0 minutes elapsed: "0m ago", not empty or negative', () => {
    assert.equal(timeAgo('2026-07-31T12:00:00.000Z', { now }), '0m ago');
  });

  it('exactly 60 minutes rolls over to 1h ago, not 60m ago', () => {
    assert.equal(timeAgo('2026-07-31T11:00:00.000Z', { now }), '1h ago');
  });

  it('under 24 hours: hours ago', () => {
    assert.equal(timeAgo('2026-07-31T09:00:00.000Z', { now }), '3h ago');
    assert.equal(timeAgo('2026-07-30T13:00:00.000Z', { now }), '23h ago');
  });

  it('exactly 24 hours rolls over to 1d ago, not 24h ago', () => {
    assert.equal(timeAgo('2026-07-30T12:00:00.000Z', { now }), '1d ago');
  });

  it('24 hours or more: days ago, uncapped', () => {
    assert.equal(timeAgo('2026-07-28T12:00:00.000Z', { now }), '3d ago');
    assert.equal(timeAgo('2025-07-31T12:00:00.000Z', { now }), '365d ago');
  });

  it('defaults to the real wall clock when no now override is given — the existing, unchanged behavior for every current caller', () => {
    const justNow = new Date(Date.now() - 5 * 60_000).toISOString();
    assert.equal(timeAgo(justNow), '5m ago');
  });
});
