import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, jaccardSimilarity, scoreCandidates } from '../lib/duplicate-scorer.mjs';

describe('tokenize', () => {
  it('lowercases, strips punctuation, and splits on whitespace', () => {
    assert.deepEqual(tokenize('Login button is Broken!'), ['login', 'button', 'broken']);
  });

  it('drops built-in stopwords', () => {
    assert.deepEqual(tokenize('the button is not working'), ['button', 'working']);
  });

  it('drops tokens shorter than 2 chars', () => {
    assert.deepEqual(tokenize('a b cd e'), ['cd']);
  });

  it('returns an empty array for empty or null input', () => {
    assert.deepEqual(tokenize(''), []);
    assert.deepEqual(tokenize(null), []);
    assert.deepEqual(tokenize(undefined), []);
  });

  it('de-duplicates repeated tokens', () => {
    assert.deepEqual(tokenize('login login button'), ['login', 'button']);
  });
});

describe('jaccardSimilarity', () => {
  it('returns 1 for identical token sets', () => {
    assert.equal(jaccardSimilarity(['login', 'button'], ['login', 'button']), 1);
  });

  it('returns 0 for disjoint token sets', () => {
    assert.equal(jaccardSimilarity(['login', 'button'], ['export', 'csv']), 0);
  });

  it('returns 0 when both sets are empty (no false-positive full match)', () => {
    assert.equal(jaccardSimilarity([], []), 0);
  });

  it('computes intersection-over-union for partial overlap', () => {
    // {login,button} ∩ {login,broken} = {login} (1); ∪ = {login,button,broken} (3)
    assert.equal(jaccardSimilarity(['login', 'button'], ['login', 'broken']), 1 / 3);
  });
});

describe('scoreCandidates', () => {
  const source = { summary: 'Login button is broken on mobile', description: 'Tapping login does nothing on iOS Safari' };

  it('scores title higher than description via weighting, ranks best match first', () => {
    const candidates = [
      { key: 'A-1', summary: 'Export CSV fails silently', description: 'no relation at all' },
      { key: 'A-2', summary: 'Login button broken on mobile Safari', description: 'unrelated body text here' },
    ];
    const results = scoreCandidates(source, candidates, { threshold: 0.1 });
    assert.equal(results[0].key, 'A-2');
    assert.ok(results[0].score > 0.1);
  });

  it('excludes candidates scoring below the threshold', () => {
    const candidates = [{ key: 'A-3', summary: 'Completely unrelated export feature', description: 'nothing shared' }];
    const results = scoreCandidates(source, candidates, { threshold: 0.9 });
    assert.deepEqual(results, []);
  });

  it('never includes a candidate whose key matches the source (self-match guard)', () => {
    const candidates = [{ key: 'SELF-1', summary: 'Login button is broken on mobile', description: 'Tapping login does nothing on iOS Safari' }];
    const results = scoreCandidates({ ...source, key: 'SELF-1' }, candidates, { threshold: 0.1 });
    assert.deepEqual(results, []);
  });

  it('returns an empty array when candidates is empty', () => {
    assert.deepEqual(scoreCandidates(source, [], { threshold: 0.1 }), []);
  });

  it('caps results at the given limit, highest score first', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      key: `A-${i}`,
      summary: 'Login button is broken on mobile',
      description: 'Tapping login does nothing on iOS Safari',
    }));
    const results = scoreCandidates(source, candidates, { threshold: 0.1, limit: 3 });
    assert.equal(results.length, 3);
  });
});
