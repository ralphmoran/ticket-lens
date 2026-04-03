import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDiff } from '../lib/diff-analyzer.mjs';

const SAMPLE_DIFF = `
diff --git a/src/payment.js b/src/payment.js
--- a/src/payment.js
+++ b/src/payment.js
@@ -1,5 +1,10 @@
+function validateEmail(email) {
+  return /^[^@]+@[^@]+$/.test(email);
+}
+
+function processPayment(amount, card) {
+  if (!validateEmail(card.email)) throw new Error('Invalid email');
+  return { success: true, amount };
+}
`;

describe('analyzeDiff', () => {
  it('returns empty results for empty requirements', () => {
    const result = analyzeDiff([], SAMPLE_DIFF);
    assert.deepStrictEqual(result.results, []);
    assert.equal(result.coveragePercent, 0);
  });

  it('marks requirement as FOUND when keywords appear in diff', () => {
    const result = analyzeDiff(['Must validate email format'], SAMPLE_DIFF);
    assert.equal(result.results[0].status, 'FOUND');
  });

  it('marks requirement as NOT_FOUND when no keywords match', () => {
    const result = analyzeDiff(['Must send SMS notification'], SAMPLE_DIFF);
    assert.equal(result.results[0].status, 'NOT_FOUND');
  });

  it('calculates coveragePercent correctly', () => {
    const reqs = [
      'Must validate email format',  // FOUND
      'Must send SMS notification',  // NOT_FOUND
    ];
    const result = analyzeDiff(reqs, SAMPLE_DIFF);
    assert.equal(result.coveragePercent, 50);
  });

  it('returns 0 coverage when diff is null', () => {
    const result = analyzeDiff(['Must validate email'], null);
    assert.equal(result.results[0].status, 'NOT_FOUND');
    assert.equal(result.coveragePercent, 0);
  });

  it('uses injected analyzerFn when provided', () => {
    const analyzerFn = (_req, _diff) => 'PARTIAL';
    const result = analyzeDiff(['Any requirement'], SAMPLE_DIFF, { analyzerFn });
    assert.equal(result.results[0].status, 'PARTIAL');
  });

  it('includes evidence string for FOUND results', () => {
    const result = analyzeDiff(['Must validate email format'], SAMPLE_DIFF);
    assert.equal(typeof result.results[0].evidence, 'string');
  });

  it('counts PARTIAL as 0.5 toward coverage', () => {
    const analyzerFn = (_req) => 'PARTIAL';
    const result = analyzeDiff(['req1', 'req2'], SAMPLE_DIFF, { analyzerFn });
    assert.equal(result.coveragePercent, 50);
  });
});
