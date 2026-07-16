import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { matchNotes } from '../lib/recall-matcher.mjs';

const ticket = {
  key: 'PROD-123',
  summary: 'Login retry loop fails under load',
  description: 'The retry logic needs an exponential backoff strategy.',
};

describe('matchNotes', () => {
  test('a note that lists this exact ticket key is matched, and scores highest', () => {
    const notes = [
      { title: 'Unrelated note', tags: [], tickets: [] },
      { title: 'About this exact ticket', tags: [], tickets: ['PROD-123'] },
    ];
    const results = matchNotes(ticket, notes);
    assert.equal(results[0].note.title, 'About this exact ticket');
  });

  test('a note whose tags overlap with the ticket text is matched', () => {
    const notes = [{ title: 'Backoff gotcha', tags: ['backoff'], tickets: [] }];
    const results = matchNotes(ticket, notes);
    assert.equal(results.length, 1);
  });

  test('a note whose title shares words with the ticket summary is matched', () => {
    const notes = [{ title: 'Notes about retry loop behavior', tags: [], tickets: [] }];
    const results = matchNotes(ticket, notes);
    assert.equal(results.length, 1);
  });

  test('a note with no overlap at all is not matched', () => {
    const notes = [{ title: 'Completely unrelated topic', tags: ['billing'], tickets: [] }];
    const results = matchNotes(ticket, notes);
    assert.equal(results.length, 0);
  });

  test('results are sorted with the strongest match first', () => {
    const notes = [
      { title: 'Weak match: retry', tags: [], tickets: [] },
      { title: 'Strong match — exact ticket', tags: [], tickets: ['PROD-123'] },
    ];
    const results = matchNotes(ticket, notes);
    assert.equal(results[0].note.title, 'Strong match — exact ticket');
    assert.equal(results[0].score > results[1].score, true);
  });

  test('matching is case-insensitive', () => {
    const notes = [{ title: 'RETRY LOOP notes', tags: [], tickets: [] }];
    const results = matchNotes(ticket, notes);
    assert.equal(results.length, 1);
  });

  test('handles a ticket with no description without crashing', () => {
    const bareTicket = { key: 'PROD-1', summary: 'retry loop issue' };
    const notes = [{ title: 'retry loop notes', tags: [], tickets: [] }];
    assert.doesNotThrow(() => matchNotes(bareTicket, notes));
  });

  test('is a pure function — same input always gives the same output', () => {
    const notes = [{ title: 'retry loop notes', tags: [], tickets: ['PROD-123'] }];
    const first = matchNotes(ticket, notes);
    const second = matchNotes(ticket, notes);
    assert.deepEqual(first, second);
  });

  test('an empty note list returns an empty result', () => {
    assert.deepEqual(matchNotes(ticket, []), []);
  });
});
