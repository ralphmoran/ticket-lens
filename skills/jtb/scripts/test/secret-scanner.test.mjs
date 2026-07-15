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
});

describe('scanForSecrets — regression: unlabeled hex secret in backticks with no context word is rejected', () => {
  test('exact reviewer repro: backtick-wrapped hex with only unrelated surrounding prose is rejected', () => {
    const result = scanForSecrets({ title: 'x', tags: [], body: '`9f8e7d6c5b4a3928170615243f3e2d1c`' });
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
