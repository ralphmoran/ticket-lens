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

  it('extracts inline numbered enumeration flattened into one ADF paragraph (H-2)', () => {
    // Real-world shape from CNV1-25: Jira ADF flattens a numbered list into one
    // paragraph with inline "1) ... 2) ... 3) ..." markers, no newlines between items.
    const text = 'Requirements for compliance-check testing: 1) Add a --dry-run flag to the sync command. 2) Log a warning when the dry-run flag is used without a valid profile. 3) Update the README with a dry-run usage example.';
    const result = extractRequirements(text);
    assert.equal(result.length, 3, `expected 3 items, got ${result.length}: ${JSON.stringify(result)}`);
    assert.ok(result.some(r => r.includes('Add a --dry-run flag')));
    assert.ok(result.some(r => r.includes('Log a warning')));
    assert.ok(result.some(r => r.includes('Update the README')));
  });

  it('extracts a plain newline-separated numbered list with no modal verb and no AC header (H-2)', () => {
    const text = `
1. Add a --dry-run flag to the sync command.
2. Log a warning when the dry-run flag is used without a valid profile.
3. Update the README with a dry-run usage example.
    `;
    const result = extractRequirements(text);
    assert.equal(result.length, 3, `expected 3 items, got ${result.length}: ${JSON.stringify(result)}`);
  });

  it('extracts a plain numbered list using ")" markers outside an AC header (H-2)', () => {
    const text = `
1) Add a --dry-run flag to the sync command.
2) Log a warning when the dry-run flag is used without a valid profile.
    `;
    const result = extractRequirements(text);
    assert.equal(result.length, 2, `expected 2 items, got ${result.length}: ${JSON.stringify(result)}`);
  });

  it('does not treat stray version-like numbers as an inline enumeration (H-2 false-positive guard)', () => {
    const text = 'We shipped v1. Then we shipped v2. Nothing here is a requirement list.';
    const result = extractRequirements(text);
    assert.deepStrictEqual(result, []);
  });

  it('does not treat a "Steps to Reproduce" numbered list as requirements (H-2 false-positive guard)', () => {
    const text = `
Steps to Reproduce:
1. Log in as an admin user
2. Navigate to the billing page
3. Click export
4. Observe the crash

Expected: no crash
Actual: 500 error
    `;
    const result = extractRequirements(text);
    assert.deepStrictEqual(result, []);
  });

  it('does not treat a single isolated numbered line outside an AC section as a requirement (H-2 false-positive guard)', () => {
    const text = 'See item 1. Some other unrelated sentence follows on the next paragraph.';
    const result = extractRequirements(text);
    assert.deepStrictEqual(result, []);
  });

  it('does not treat non-sequential numbered lines outside an AC section as requirements (H-2 false-positive guard)', () => {
    const text = `
1. First unrelated note
3. Second unrelated note, numbering skips 2
    `;
    const result = extractRequirements(text);
    assert.deepStrictEqual(result, []);
  });

  it('known limitation: a blank line between numbered items outside an AC section breaks the run', () => {
    // Documents current behavior (see findValidNumberedRuns) rather than asserting it's
    // desirable — items must be on strictly consecutive lines without an AC header.
    const text = `
1. Add a --dry-run flag to the sync command.

2. Log a warning when the dry-run flag is used without a valid profile.
    `;
    const result = extractRequirements(text);
    assert.deepStrictEqual(result, []);
  });
});
