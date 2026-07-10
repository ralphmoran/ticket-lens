import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildJiraEnv, getVersion, getPackageMeta } from '../lib/config.mjs';

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
