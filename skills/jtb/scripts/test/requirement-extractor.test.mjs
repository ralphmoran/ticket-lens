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

  it('recognises plain-text AC header (from Jira Cloud ADF conversion)', () => {
    // adf-converter strips markdown # prefix — heading lands as plain text
    const text = `
      Acceptance Criteria

      - User can log in
      - Invalid token shows 401
    `;
    const result = extractRequirements(text);
    assert.ok(result.length >= 2, `expected ≥2 items, got ${result.length}`);
  });

  it('recognises Jira Server wiki-markup AC header (h1.–h6.)', () => {
    const text = `
      h2. Acceptance Criteria

      - File must be UTF-8 encoded
      - Duplicate keys must be rejected
    `;
    const result = extractRequirements(text);
    assert.ok(result.length >= 2, `expected ≥2 items, got ${result.length}`);
  });

  it('recognises AC header with trailing colon', () => {
    const text = `
      ## Acceptance Criteria:

      - Must return 200 on success
    `;
    const result = extractRequirements(text);
    assert.ok(result.length >= 1);
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

  it('extracts plain sentences under AC header (Jira Cloud ADF output — no list markers)', () => {
    // ADF converter strips heading markers; items are written as prose, not bullets.
    // This is the real-world format from CNV1-2.
    const text = `
Acceptance criteria

The dashboard should display all social media accounts
The form must allow picking an account and configuring credentials
    `;
    const result = extractRequirements(text);
    assert.ok(result.length >= 2, `expected ≥2 items, got ${result.length}`);
    assert.ok(result.some(r => r.includes('dashboard should display')));
    assert.ok(result.some(r => r.includes('form must allow')));
  });

  it('handles mixed bullets and plain sentences inside AC section', () => {
    const text = `
## Acceptance Criteria

- Must return 200 on success
Plain prose requirement without bullet
1. Numbered item as well
    `;
    const result = extractRequirements(text);
    assert.ok(result.length >= 3, `expected ≥3 items, got ${result.length}`);
    assert.ok(result.some(r => r.includes('Plain prose requirement')));
  });

  it('exits AC section on wiki-markup heading (h2. Next Section)', () => {
    const text = `
h2. Acceptance Criteria

- Must do X

h2. Notes

Implementation detail that is not a requirement
    `;
    const result = extractRequirements(text);
    assert.ok(result.some(r => r.includes('Must do X')));
    assert.ok(result.every(r => !r.includes('not a requirement')));
  });
});
