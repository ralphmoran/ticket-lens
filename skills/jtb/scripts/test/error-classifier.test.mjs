import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyError } from '../lib/error-classifier.mjs';

const conn = { baseUrl: 'https://jira.advent.com', profileName: 'advent' };

describe('classifyError', () => {
  it('classifies ENOTFOUND as DNS failure', () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ENOTFOUND' };
    const result = classifyError(err, conn);
    assert.ok(result.message.includes('DNS lookup failed'));
    assert.ok(result.message.includes('jira.advent.com'));
    assert.ok(result.hint.includes('VPN'));
  });

  it('classifies EAI_AGAIN as DNS failure', () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'EAI_AGAIN' };
    const result = classifyError(err, conn);
    assert.ok(result.message.includes('DNS lookup failed'));
  });

  it('classifies ECONNREFUSED as connection refused', () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ECONNREFUSED' };
    const result = classifyError(err, conn);
    assert.ok(result.message.includes('Connection refused'));
    assert.ok(result.hint.includes('running'));
  });

  it('classifies ECONNRESET as connection reset (VPN hint)', () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ECONNRESET' };
    const result = classifyError(err, conn);
    assert.ok(result.message.includes('was reset'));
    assert.ok(result.hint.includes('VPN'));
  });

  it('classifies ETIMEDOUT as timeout (VPN hint)', () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ETIMEDOUT' };
    const result = classifyError(err, conn);
    assert.ok(result.message.includes('timed out'));
    assert.ok(result.hint.includes('VPN'));
  });

  it('classifies SSL cert errors', () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' };
    const result = classifyError(err, conn);
    assert.ok(result.message.includes('SSL certificate'));
    assert.ok(result.hint.includes('certificate'));
  });

  it('classifies DEPTH_ZERO_SELF_SIGNED_CERT', () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' };
    const result = classifyError(err, conn);
    assert.ok(result.message.includes('SSL'));
  });

  it('classifies 401 as auth failure', () => {
    const err = new Error('Jira API error 401');
    err.status = 401;
    const result = classifyError(err, conn);
    assert.ok(result.message.includes('Authentication failed'));
    assert.ok(result.message.includes('advent'));
    assert.ok(result.hint.includes('credentials'));
  });

  it('classifies 403 as access denied', () => {
    const err = new Error('Jira API error 403');
    err.status = 403;
    const result = classifyError(err, conn);
    assert.ok(result.message.includes('Access denied'));
  });

  it('classifies 404 as not found', () => {
    const err = new Error('Jira API error 404');
    err.status = 404;
    const result = classifyError(err, conn);
    assert.ok(result.message.includes('Not found'));
    assert.ok(result.hint.includes('ticket key'));
  });

  it('classifies 429 as rate limited', () => {
    const err = new Error('Jira API error 429');
    err.status = 429;
    const result = classifyError(err, conn);
    assert.ok(result.message.includes('Rate limited'));
  });

  it('classifies 500+ as server error', () => {
    const err = new Error('Jira API error 502');
    err.status = 502;
    const result = classifyError(err, conn);
    assert.ok(result.message.includes('server error'));
    assert.ok(result.message.includes('502'));
  });

  it('classifies generic "fetch failed" with no cause', () => {
    const err = new TypeError('fetch failed');
    const result = classifyError(err, conn);
    assert.ok(result.message.includes('Could not reach'));
    assert.ok(result.hint.includes('VPN'));
  });

  it('falls back to original message for unknown errors', () => {
    const err = new Error('Something unexpected');
    const result = classifyError(err, conn);
    assert.equal(result.message, 'Something unexpected');
    assert.equal(result.hint, null);
  });

  it('uses hostname from baseUrl in messages', () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ENOTFOUND' };
    const result = classifyError(err, { baseUrl: 'https://custom.atlassian.net' });
    assert.ok(result.message.includes('custom.atlassian.net'));
  });

  it('handles missing conn gracefully', () => {
    const err = new TypeError('fetch failed');
    err.cause = { code: 'ENOTFOUND' };
    const result = classifyError(err);
    assert.ok(result.message.includes('the Jira server'));
  });

  it('classifies AbortSignal TimeoutError as connection timeout', () => {
    const cause = new DOMException('signal timed out', 'TimeoutError');
    const err = new TypeError('fetch aborted');
    err.cause = cause;
    const result = classifyError(err, conn);
    assert.ok(result.message.includes('timed out'), `expected "timed out" in: ${result.message}`);
    assert.ok(result.hint && result.hint.length > 0, 'hint should be non-empty');
  });

  it('classifies bare TimeoutError (no wrapper) as connection timeout', () => {
    const err = new DOMException('signal timed out', 'TimeoutError');
    const result = classifyError(err, conn);
    assert.ok(result.message.includes('timed out'), `expected "timed out" in: ${result.message}`);
  });
});
