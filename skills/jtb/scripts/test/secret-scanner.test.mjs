import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { scanForSecrets } from '../lib/secret-scanner.mjs';

describe('scanForSecrets — clean input', () => {
  test('plain note text is not rejected and has no warnings', () => {
    const result = scanForSecrets({ title: 'Fix login retry', tags: ['auth'], body: 'The retry loop needed a backoff.' });
    assert.equal(result.rejected, false);
    assert.deepEqual(result.reasons, []);
    assert.deepEqual(result.warnings, []);
  });

  test('a long ordinary word does not falsely trigger the random-string check', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'internationalization and responsibility are long but ordinary words.' });
    assert.equal(result.rejected, false);
  });

  test('a git commit SHA does not falsely trigger the random-string check', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'Fixed in commit 4f9a7c2d8e1b6a3f9c0d5e2a7b8c1d4e6f9a0b3c.' });
    assert.equal(result.rejected, false);
  });

  test('a Jira ticket key does not falsely trigger the random-string check', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'See PROD-123456 for background.' });
    assert.equal(result.rejected, false);
  });
});

describe('scanForSecrets — hex-shaped secrets (regression: git-SHA exemption was too broad)', () => {
  test('a bare, unlabeled hex-shaped secret is rejected — same shape as many real hex-encoded tokens', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: '9f8e7d6c5b4a3928170615243f3e2d1c' });
    assert.equal(result.rejected, true);
  });

  test('a hex string explicitly labeled as a commit is still allowed through', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'Fixed in commit 4f9a7c2d8e1b6a3f9c0d5e2a7b8c1d4e6f9a0b3c.' });
    assert.equal(result.rejected, false);
  });

  test('a hex string wrapped in backticks and labeled as a commit is still allowed through', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'The fix is in commit `4f9a7c2d8e1b6a3f9c0d5e2a7b8c1d4e6f9a0b3c`.' });
    assert.equal(result.rejected, false);
  });

  test('regression: backtick-fencing alone (no commit/sha/rev context word) is NOT enough to exempt a hex string — it is the exact shape a hex-encoded secret written inline would take', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'See `4f9a7c2d8e1b6a3f9c0d5e2a7b8c1d4e6f9a0b3c` for details.' });
    assert.equal(result.rejected, true);
  });
});

describe('scanForSecrets — regression: secrets split by inserted whitespace', () => {
  test('an AWS access key split by a single space is still rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'AKIA IOSFODNN7EXAMPLE' });
    assert.equal(result.rejected, true);
  });

  test('an API key split by a tab is still rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'sk-abcdefghijklmnop\tqrstuvwxyz123456' });
    assert.equal(result.rejected, true);
  });

  test('a long random-looking string split by a newline is still rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'Q7x!kP2z@Lm9#Wf4$Rt6&\nYb3*Nc8^Vd1' });
    assert.equal(result.rejected, true);
  });

  test('a Stripe-style secret key (no dedicated hard-reject pattern) split by a space is still rejected via entropy', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'sk_live_51 H8Yg2eZvKY' });
    assert.equal(result.rejected, true);
  });

  test('an ordinary label word next to a real secret does not stop the secret from being caught', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'Fixed in commit 4f9a7c2d8e1b6a3f9c0d5e2a7b8c1d4e6f9a0b3c and the key is AKIA IOSFODNN7EXAMPLE.' });
    assert.equal(result.rejected, true);
  });

  test('an email next to an ordinary word is not falsely joined into a rejection', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'Ask jsmith@example.com about this.' });
    assert.equal(result.rejected, false);
  });

  test('regression: a base64 secret split on an all-letters boundary (e.g. an editor soft-wrap) is still rejected', () => {
    // RFC 7617 example Basic-auth credential, "Aladdin:opensesame" base64-encoded,
    // wrapped exactly where both halves happen to contain only letters.
    const result = scanForSecrets({ title: 'x', tags: [], body: 'Authorization: Basic QWxhZGRpbjpv\nZW5TZXNhbWU=' });
    assert.equal(result.rejected, true);
  });

  test('known accepted gap: a secret deliberately split around a genuine dictionary word is not caught — documented in isLabelWord, not a silent regression', () => {
    const secret = 'k3f9x7q2z8p1m6w4y0j5h2n9v3t8s1r7d4c6b0a2e5f9x1q7z3';
    const unsplit = scanForSecrets({ title: 'x', tags: [], body: secret });
    assert.equal(unsplit.rejected, true, 'sanity check: the unsplit secret is caught');
    const evaded = scanForSecrets({ title: 'x', tags: [], body: `${secret.slice(0, 18)} wall ${secret.slice(18, 36)} wall ${secret.slice(36)}` });
    assert.equal(evaded.rejected, false, 'documents the known gap — see isLabelWord doc comment for why this is accepted, not fixed');
  });

  test('L-2 regression: a low-entropy API-key-shaped secret, split by a space and immediately preceded by an ordinary word, is still rejected', () => {
    // Low-entropy on purpose (heavily repeated character) so this can only be
    // caught by the exact-shape hard-reject pattern, never by the entropy
    // layer — isolates the word-boundary-anchor bug from the (unrelated,
    // already-passing) entropy-based detection covered by the tests above.
    // Before the fix: fully despacing the whole note glued "the" directly
    // onto "sk-", killing the pattern's leading \b so it silently missed.
    const result = scanForSecrets({ title: 'x', tags: [], body: 'the sk- AAAAAAAAAAAAAAAAAAAAAAAA1 key' });
    assert.equal(result.rejected, true);
    assert.ok(result.reasons.some(r => /API key/.test(r)));
  });

  test('L-2 regression: same bug shape for the GitHub-token pattern, the other \\b-anchored hard-reject rule', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'token ghp_ AAAAAAAAAAAAAAAAAAAAAAAA1 here' });
    assert.equal(result.rejected, true);
    assert.ok(result.reasons.some(r => /GitHub token/.test(r)));
  });

  // Caught in code review of the L-2 fix above: bounding the rejoin to
  // MAX_JOINED_CHUNKS (borrowed from the entropy heuristic, where an
  // unbounded join risks false positives on prose — a concern that doesn't
  // apply to an exact-shape hard-reject pattern) silently dropped the
  // original unbounded coverage for a secret fragmented wider than that
  // window. An unbounded fallback check restores it.
  test('a hard-reject secret split into more pieces than the bounded rejoin window (one character per token) is still rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'A K I A 1 2 3 4 5 6 7 8 9 0 A B C D E F G H' });
    assert.equal(result.rejected, true);
    assert.ok(result.reasons.some(r => /AWS access key/.test(r)));
  });
});

describe('scanForSecrets — regression: unlabeled hex secret in backticks with no context word is rejected', () => {
  test('exact reviewer repro: backtick-wrapped hex with only unrelated surrounding prose is rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: '`9f8e7d6c5b4a3928170615243f3e2d1c`' });
    assert.equal(result.rejected, true);
  });
});

describe('scanForSecrets — regression: possessive next to a hyphenated compound is not a secret', () => {
  test('exact live repro: "relay\'s decision-lookup" false-positived before the isLabelWord apostrophe fix', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: "the relay's decision-lookup query never returned them" });
    assert.equal(result.rejected, false);
  });

  test('the same phrase without the possessive apostrophe was always fine (control case)', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'the relays decision-lookup query never returned them' });
    assert.equal(result.rejected, false);
  });

  test('the possessive alone, unadjacent to any hyphenated token, was always fine (control case)', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: "test relay's decision" });
    assert.equal(result.rejected, false);
  });

  test('a whitespace-split API key whose letters-only half looks hyphen-compound-shaped is still rejected — the apostrophe fix must not extend to hyphens', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'sk-abcdefghijklmnop\tqrstuvwxyz123456' });
    assert.equal(result.rejected, true);
  });
});

describe('scanForSecrets — regression: two adjacent hyphenated compounds are not a secret (Trigger 5)', () => {
  test('exact live repro: "REDIS-vs-PG dual-store" false-positived (PROD-5554 triage, 2026-08-07)', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'the known REDIS-vs-PG dual-store gotcha strikes again' });
    assert.equal(result.rejected, false);
  });

  test('two ordinary lowercase compounds adjacent, no abbreviation involved (general case, not just the exact repro)', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'we hit a well-known edge-case yesterday' });
    assert.equal(result.rejected, false);
  });

  test('a hyphenated token with one oversized segment does not qualify as a compound, so a generic (non-hard-reject-shaped) secret split next to it is still caught by the entropy join', () => {
    // Neither half is 20+ chars alone, and neither matches any HARD_REJECT_PATTERNS
    // prefix — this isolates the entropy join specifically. "ab-cdefghijklmnopqr"
    // has a 17-char second segment, over MAX_COMPOUND_SEGMENT_LENGTH (15), so it
    // stays joinable instead of being misread as a compound word.
    const result = scanForSecrets({ title: 'x', tags: [], body: 'the ab-cdefghijklmnopqr Xy9zAb value leaked' });
    assert.equal(result.rejected, true);
  });

  test('security regression: a base64-shaped hyphenated fragment does not qualify as a compound word just because it contains a hyphen', () => {
    // Found by adversarial security review: without a case-switch guard, a
    // mixed-case fragment like "zqXvbNmKl-PoIuYtR" would read as a "compound
    // word" purely by shape (letters + hyphen + short segments) and stop the
    // entropy join — the same category of shape-based exemption that made
    // the code-filename bypass CRITICAL. No real compound word has an
    // internal case switch, so this costs nothing legitimate.
    const result = scanForSecrets({ title: 'x', tags: [], body: 'zqXvbNmKl-PoIuYtR eWqAsDfG-hJkLzXcV' });
    assert.equal(result.rejected, true);
  });
});

describe('scanForSecrets — checksum/digest label vocabulary (usability, not security)', () => {
  test('a sha256 Docker image digest (word:hex, no space) is allowed through', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'Image digest sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85' });
    assert.equal(result.rejected, false);
  });

  test('an md5sum labeled with a space before the hash is allowed through', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'md5sum abcdef0123456789abcdef0123456789' });
    assert.equal(result.rejected, false);
  });
});

describe('scanForSecrets — hard-reject shapes', () => {
  test('an AWS access key is rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'Key: AKIAIOSFODNN7EXAMPLE' });
    assert.equal(result.rejected, true);
    assert.match(result.reasons.join(' '), /AWS/i);
  });

  test('a JWT is rejected', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const result = scanForSecrets({ title: 'x', tags: [], body: `token=${jwt}` });
    assert.equal(result.rejected, true);
    assert.match(result.reasons.join(' '), /JWT|token/i);
  });

  test('a PEM private key block is rejected', () => {
    const body = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----';
    const result = scanForSecrets({ title: 'x', tags: [], body });
    assert.equal(result.rejected, true);
    assert.match(result.reasons.join(' '), /private key/i);
  });

  // ---- backlog 1d: PEM's literal-space pattern is bypassable by embedded whitespace ----

  test('a PEM header with a tab substituted for a space is still rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: '-----BEGIN\tRSA PRIVATE KEY-----' });
    assert.equal(result.rejected, true);
    assert.match(result.reasons.join(' '), /private key/i);
  });

  test('a PEM header with irregular multiple spaces is still rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: '-----BEGIN  RSA  PRIVATE  KEY-----' });
    assert.equal(result.rejected, true);
  });

  test('a PEM header split by newlines is still rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: '-----BEGIN\nRSA\nPRIVATE\nKEY-----' });
    assert.equal(result.rejected, true);
  });

  test('a PEM header with all whitespace removed is still rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: '-----BEGINRSAPRIVATEKEY-----' });
    assert.equal(result.rejected, true);
  });

  test('a PEM header with no algorithm word and a tab is still rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: '-----BEGIN\tPRIVATE KEY-----' });
    assert.equal(result.rejected, true);
  });

  test('a PEM header split by a BOM is still rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: '-----BEGIN﻿RSA PRIVATE KEY-----' });
    assert.equal(result.rejected, true);
  });

  test('a PEM header split by a Unicode non-breaking space is still rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: '-----BEGIN RSA PRIVATE KEY-----' });
    assert.equal(result.rejected, true);
  });

  test('an OpenAI/Anthropic-style API key is rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'export key sk-abcdefghijklmnopqrstuvwxyz123456' });
    assert.equal(result.rejected, true);
    assert.match(result.reasons.join(' '), /API key/i);
  });

  test('a Groq-style API key is rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'gsk_abcdefghijklmnopqrstuvwxyz123456' });
    assert.equal(result.rejected, true);
  });

  test('a GitHub token is rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'ghp_abcdefghijklmnopqrstuvwxyz1234567890' });
    assert.equal(result.rejected, true);
  });

  test('a long random-looking string is rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'Q7x!kP2z@Lm9#Wf4$Rt6&Yb3*Nc8^Vd1' });
    assert.equal(result.rejected, true);
    assert.match(result.reasons.join(' '), /random/i);
  });
});

describe('scanForSecrets — scans title and tags, not just body', () => {
  test('a secret in the title is rejected', () => {
    const result = scanForSecrets({ title: 'Key AKIAIOSFODNN7EXAMPLE', tags: [], body: 'clean body' });
    assert.equal(result.rejected, true);
  });

  test('a secret in a tag is rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: ['sk-abcdefghijklmnopqrstuvwxyz123456'], body: 'clean body' });
    assert.equal(result.rejected, true);
  });
});

describe('scanForSecrets — soft warnings (never reject)', () => {
  test('an email address triggers a warning, not a rejection', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'Ask jsmith@example.com about this.' });
    assert.equal(result.rejected, false);
    assert.match(result.warnings.join(' '), /email/i);
  });
});

describe('scanForSecrets — multiple issues', () => {
  test('reports one reason per distinct issue found', () => {
    const body = 'AKIAIOSFODNN7EXAMPLE and sk-abcdefghijklmnopqrstuvwxyz123456';
    const result = scanForSecrets({ title: 'x', tags: [], body });
    assert.equal(result.rejected, true);
    assert.equal(result.reasons.length >= 2, true);
  });
});

describe('scanForSecrets — regression: colon-suffixed label word must stop a joined-chunk run', () => {
  test('a colon-labeled sentence opener next to a ticket key is not falsely joined into a rejection', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'Generalizes: PROD-123456 and any sibling ticket touching this path should check it first.' });
    assert.equal(result.rejected, false);
  });

  test('a colon-labeled sentence opener next to ordinary prose is not falsely joined into a rejection', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'Generalizes: any future ticket that touches this path should check the same thing first.' });
    assert.equal(result.rejected, false);
  });
});

describe('scanForSecrets — regression: fields are scanned independently for the entropy/random-string check', () => {
  test('two tags that individually echo phrases repeated in the body do not falsely combine into a rejection', () => {
    const result = scanForSecrets({
      title: 'x',
      tags: ['credit-application', 'add-finance-source'],
      body: 'Credit Application flow now calls Add Finance Source correctly after the fix.',
    });
    assert.equal(result.rejected, false);
  });

  test('a secret split across the body by whitespace is still caught — per-field joining still works within one field', () => {
    const result = scanForSecrets({ title: 'x', tags: ['clean'], body: 'AKIA IOSFODNN7EXAMPLE' });
    assert.equal(result.rejected, true);
  });
});

describe('scanForSecrets — regression: bare code-identifier filenames are not secrets', () => {
  test('a PascalCase class-name-as-filename with a recognized source extension is not rejected, but does warn', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'RouteOneAutoEcontracting.php handles the integration.' });
    assert.equal(result.rejected, false);
    assert.match(result.warnings.join(' '), /code-filename-shaped/);
  });

  test('positive control: digits in the stem are NOT exempted — still a hard reject, not even a warning', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'Base64EncoderForV2Payloads123456789.php handles this.' });
    assert.equal(result.rejected, true);
  });

  test('known accepted gap: a bare camelCase method name with no file extension is still misread as random — same shape as a base64 secret fragment, documented not silently fixed', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'The fix calls generateDealJacketForTekionSubmission after validation succeeds every time.' });
    assert.equal(result.rejected, true, 'documents the known gap — see looksRandom doc comment for why a bare identifier without an extension cannot be safely distinguished from a base64 secret fragment');
  });

  test('security regression: a genuinely random letters-only secret disguised with a fake extension is downgraded to a warning, never silently exempted', () => {
    // Real secret shape (no digits, so HARD_REJECT_PATTERNS don't apply), just
    // wearing a ".php" suffix to probe the filename carve-out. Before the fix
    // this returned rejected:false with NO warning at all — a silent bypass.
    const result = scanForSecrets({ title: 'x', tags: [], body: 'XqZkTmWpLbNvRcYsHjFgAbCd.php was mentioned once.' });
    assert.equal(result.rejected, false);
    assert.match(result.warnings.join(' '), /code-filename-shaped/, 'must never pass through with zero trace, even though it is not hard-blocked');
  });

  test('security regression: a random letters-only token with NO internal case switch plus a fake extension gets no special treatment at all — full reject, not even a warning', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: 'xqzktmwplbnvrcyshjfgabcd.php was mentioned once.' });
    assert.equal(result.rejected, true);
  });
});

describe('scanForSecrets — documented accepted gap: entropy join no longer spans a field boundary', () => {
  test('a secret split exactly across a tag and the body is not caught by the entropy join — hard-reject shapes still are, this is entropy-only and deliberate', () => {
    // Trade-off accepted alongside the Trigger-3 field-boundary fix above:
    // splitting a generic (non-hard-reject-shaped) high-entropy secret across
    // two different fields no longer reassembles for the entropy check, only
    // within one field. See the per-field tokenization comment in
    // scanForSecrets. Pinned down here so it can't silently regress further
    // (or silently get "fixed" back) without this test being touched.
    const result = scanForSecrets({ title: 'x', tags: ['XqZkTmWpLbNv'], body: 'RcYsHjFgAbCdEfGh' });
    assert.equal(result.rejected, false);
  });
});
