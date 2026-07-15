import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchDigests } from '../lib/recall-matcher.mjs';

const ticket = {
  key: 'PROD-123',
  summary: 'Login retry loop fails under load',
  description: 'The retry logic needs an exponential backoff strategy.',
};

describe('matchDigests', () => {
  test('a digest that lists this exact ticket key is matched, and scores highest', () => {
    const digests = [
      { title: 'Unrelated note', tags: [], tickets: [] },
      { title: 'About this exact ticket', tags: [], tickets: ['PROD-123'] },
    ];
    const results = matchDigests(ticket, digests);
    assert.equal(results[0].digest.title, 'About this exact ticket');
  });

  test('a digest whose tags overlap with the ticket text is matched', () => {
    const digests = [{ title: 'Backoff gotcha', tags: ['backoff'], tickets: [] }];
    const results = matchDigests(ticket, digests);
    assert.equal(results.length, 1);
  });

  test('a digest whose title shares words with the ticket summary is matched', () => {
    const digests = [{ title: 'Notes about retry loop behavior', tags: [], tickets: [] }];
    const results = matchDigests(ticket, digests);
    assert.equal(results.length, 1);
  });

  test('a digest with no overlap at all is not matched', () => {
    const digests = [{ title: 'Completely unrelated topic', tags: ['billing'], tickets: [] }];
    const results = matchDigests(ticket, digests);
    assert.equal(results.length, 0);
  });

  test('results are sorted with the strongest match first', () => {
    const digests = [
      { title: 'Weak match: retry', tags: [], tickets: [] },
      { title: 'Strong match — exact ticket', tags: [], tickets: ['PROD-123'] },
    ];
    const results = matchDigests(ticket, digests);
    assert.equal(results[0].digest.title, 'Strong match — exact ticket');
    assert.equal(results[0].score > results[1].score, true);
  });

  test('matching is case-insensitive', () => {
    const digests = [{ title: 'RETRY LOOP notes', tags: [], tickets: [] }];
    const results = matchDigests(ticket, digests);
    assert.equal(results.length, 1);
  });

  test('handles a ticket with no description without crashing', () => {
    const bareTicket = { key: 'PROD-1', summary: 'retry loop issue' };
    const digests = [{ title: 'retry loop notes', tags: [], tickets: [] }];
    assert.doesNotThrow(() => matchDigests(bareTicket, digests));
  });

  test('is a pure function — same input always gives the same output', () => {
    const digests = [{ title: 'retry loop notes', tags: [], tickets: ['PROD-123'] }];
    const first = matchDigests(ticket, digests);
    const second = matchDigests(ticket, digests);
    assert.deepEqual(first, second);
  });

  test('an empty digest list returns an empty result', () => {
    assert.deepEqual(matchDigests(ticket, []), []);
  });
});
