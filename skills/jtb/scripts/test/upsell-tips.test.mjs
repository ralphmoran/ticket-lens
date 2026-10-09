import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SUMMARIZE_TIP } from '../lib/upsell-tips.mjs';

describe('SUMMARIZE_TIP', () => {
  it('points at --summarize and names the Pro tier', () => {
    assert.match(SUMMARIZE_TIP, /--summarize/);
    assert.match(SUMMARIZE_TIP, /\(Pro\)/);
  });

  it('never hardcodes a price; the plan price lives in the API config', () => {
    assert.doesNotMatch(SUMMARIZE_TIP, /\$\s?\d/);
  });
});
