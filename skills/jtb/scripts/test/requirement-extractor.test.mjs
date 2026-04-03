import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractRequirements } from '../lib/requirement-extractor.mjs';

describe('extractRequirements', () => {
  it('returns empty array for empty text', () => {
    assert.deepStrictEqual(extractRequirements(''), []);
    assert.deepStrictEqual(extractRequirements(null), []);
  });

  it('extracts Given/When/Then lines', () => {
    const text = `
      Given a logged-in user
      When they submit the form
      Then the record is saved
    `;
    const result = extractRequirements(text);
    assert.ok(result.some(r => r.includes('Given a logged-in user')));
    assert.ok(result.some(r => r.includes('When they submit the form')));
    assert.ok(result.some(r => r.includes('Then the record is saved')));
  });

  it('extracts bullet items with must/should/shall', () => {
    const text = `
      - The system must validate the email format
      - Users should receive a confirmation email
      - The API shall return 422 on invalid input
    `;
    const result = extractRequirements(text);
    assert.equal(result.length, 3);
    assert.ok(result.some(r => r.includes('validate the email')));
  });

  it('extracts numbered list items with must/should', () => {
    const text = `
      1. The form must not submit with empty fields
      2. Error messages should appear inline
    `;
    const result = extractRequirements(text);
    assert.equal(result.length, 2);
  });

  it('extracts items under Acceptance Criteria header', () => {
    const text = `
      ## Acceptance Criteria

      - User can log in with email+password
      - Incorrect password shows error
      - Session persists on page refresh
    `;
    const result = extractRequirements(text);
    assert.ok(result.length >= 3);
  });

  it('deduplicates identical requirements', () => {
    const text = `
      - Must validate email
      - Must validate email
    `;
    const result = extractRequirements(text);
    assert.equal(result.length, 1);
  });

  it('trims whitespace from extracted requirements', () => {
    const text = `  - The system must validate input  `;
    const result = extractRequirements(text);
    assert.equal(result[0], result[0].trim());
  });

  it('handles text with no recognizable requirements', () => {
    const text = 'This is a general ticket description with no requirements.';
    const result = extractRequirements(text);
    assert.ok(Array.isArray(result));
  });

  it('extracts Ensure/Verify imperative verbs in bullet items', () => {
    const text = `
      - Ensure the export file is UTF-8 encoded
      - Verify that duplicate keys are rejected
    `;
    const result = extractRequirements(text);
    assert.equal(result.length, 2);
  });

  it('extracts requirements from mixed content', () => {
    const text = `
      Background context here.

      ## Acceptance Criteria
      - Must do X
      - Should do Y

      Given the user is authenticated
      When they click submit
      Then the form is saved
    `;
    const result = extractRequirements(text);
    assert.ok(result.length >= 4);
  });
});
