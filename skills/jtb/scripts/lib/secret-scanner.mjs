/**
 * Checks note text for things that look like secrets before a Recall note
 * is saved. Blocks the save outright on a match — never saves a redacted
 * version. Email addresses only produce a warning, not a block, since
 * ticket authors/assignees legitimately show up in note text.
 *
 * Always scans title + tags + body together, so a secret pasted into the
 * title field can't slip through a scan that only looked at the body.
 */

// Upper bound covers SHA-256 (64 hex chars), not just git's SHA-1 (40).
const GIT_SHA_RE = /^[0-9a-f]{7,64}$/i;
const TICKET_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/;
const GIT_REFERENCE_WORD_RE = /\b(commit|sha\d*|revision|rev|digest|checksum|md5(sum)?|hash|fingerprint)\b/i;
const HASH_LABEL_PREFIX_RE = /^[a-z0-9]+:/i;
const EDGE_PUNCTUATION_RE = /^[`'"(),.]+|[`'"(),.]+$/g;
const MIN_RANDOM_TOKEN_LENGTH = 20;
// Hex-alphabet strings (16 symbols) top out near 4.0 bits/char by definition, so a
// threshold of 4.0 makes it nearly impossible to ever flag a hex-shaped secret.
// 3.75 sits above ordinary words/identifiers (~3.6 measured ceiling) and below
// hex-shaped random strings (~3.9-3.93 measured), without the git-SHA carve-out.
const ENTROPY_THRESHOLD = 3.75;
const REFERENCE_CONTEXT_WINDOW = 20;
// A secret broken across whitespace (soft-wrapped paste, or a stray space/tab/
// newline inserted to dodge the scanner) still gets caught: adjacent tokens get
// rejoined before checking. See isLabelWord for what stops a run — and the
// documented gap in inserting genuine dictionary words as separators.
const MAX_JOINED_CHUNKS = 4;

const HARD_REJECT_PATTERNS = [
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'private key block', re: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'JSON Web Token (JWT)', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'API key', re: /\b(sk-|gsk_)[A-Za-z0-9]{20,}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function shannonEntropy(token) {
  const counts = new Map();
  for (const ch of token) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / token.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function stripEdgePunctuation(token) {
  return token.replace(EDGE_PUNCTUATION_RE, '');
}

/**
 * A hex-shaped token only gets the "it's a git reference, not a secret" pass
 * when something nearby — before or after it, backtick-fenced or not — actually
 * labels it as one (a word like "commit"/"sha"/"revision"/"rev"). Backtick
 * fencing alone is NOT sufficient: that's exactly how people casually write
 * inline secrets in notes too ("here's the key: `<hex>`"), so it can't be
 * treated as proof of git-reference intent. An unlabeled hex string gets no
 * special treatment: it's exactly the shape of many real hex-encoded secrets
 * (API keys, session tokens, signing secrets).
 */
function isLabeledGitReference(rawToken, fullText) {
  const idx = fullText.indexOf(rawToken);
  if (idx === -1) return false;
  const before = fullText.slice(Math.max(0, idx - REFERENCE_CONTEXT_WINDOW), idx);
  const after = fullText.slice(idx + rawToken.length, idx + rawToken.length + REFERENCE_CONTEXT_WINDOW);
  return GIT_REFERENCE_WORD_RE.test(before) || GIT_REFERENCE_WORD_RE.test(after);
}

function looksRandom(rawToken, fullText) {
  const token = stripEdgePunctuation(rawToken);
  if (token.length < MIN_RANDOM_TOKEN_LENGTH) return false;
  if (TICKET_KEY_RE.test(token)) return false;

  // A "word:hexvalue" shape (sha256:<hex>, md5:<hex> — common for Docker image
  // digests and checksums) labels itself: no separate context token to look at.
  const prefixMatch = token.match(HASH_LABEL_PREFIX_RE);
  const selfLabeled = prefixMatch
    && GIT_REFERENCE_WORD_RE.test(prefixMatch[0])
    && GIT_SHA_RE.test(token.slice(prefixMatch[0].length));
  if (selfLabeled) return false;

  if (GIT_SHA_RE.test(token) && isLabeledGitReference(rawToken, fullText)) return false;
  return shannonEntropy(token) >= ENTROPY_THRESHOLD;
}

/**
 * A plain (letters-only) word only reads as ordinary English prose if it never
 * switches from lowercase to uppercase mid-word — real sentences don't do that,
 * but base64 content routinely does (e.g. "QWxhZGRpbjpv"). This lets a base64
 * secret that happens to soft-wrap on an all-letters boundary still be told
 * apart from a genuine word like "wall" or "about".
 */
function hasInternalCaseSwitch(token) {
  return /[a-z][A-Z]/.test(token);
}

/**
 * True for a token that stops a joined-chunk run: either a recognized git/
 * checksum label word ("commit", "sha256", "md5sum", ...), or an ordinary
 * English word (letters only, no base64-style case switching). Anything else —
 * a fragment containing a digit/symbol, or an all-letter chunk that still reads
 * as random content — stays eligible to join, so a secret split by whitespace
 * can still be reassembled for the entropy check.
 *
 * Known accepted gap: this can't tell a genuine dictionary word from one an
 * attacker deliberately chose as a separator to defeat the scanner (e.g.
 * splitting a secret around the word "wall"). Closing that would require
 * treating ordinary prose words as joinable too, which in turn re-joins real
 * sentence text into false-positive "random" strings (verified empirically —
 * see the regression test for "PROD-123456 for background"). Entropy-based
 * detection is a safety net, not a cryptographic guarantee; the well-known
 * secret shapes in HARD_REJECT_PATTERNS are the layer that's fully whitespace-
 * and word-insertion-proof, since they match a specific literal prefix.
 */
function isLabelWord(token) {
  const stripped = stripEdgePunctuation(token);
  if (GIT_REFERENCE_WORD_RE.test(stripped)) return true;
  return /^[A-Za-z]+$/.test(stripped) && !hasInternalCaseSwitch(stripped);
}

/**
 * Rejoins runs of adjacent whitespace-separated tokens (no separator) so a secret
 * broken up by whitespace — accidental soft-wrap, or a deliberate space/tab/
 * newline inserted to dodge the scanner — still reads as one contiguous string.
 * A run only stops at a label word (see isLabelWord), so a real context word
 * like "commit" can't glue onto an unrelated payload.
 *
 * @param {string[]} tokens
 * @returns {string[]}
 */
function joinedChunkRuns(tokens) {
  const runs = [];
  for (let i = 0; i < tokens.length; i++) {
    if (isLabelWord(tokens[i])) continue;
    let joined = tokens[i];
    for (let j = i + 1; j < Math.min(tokens.length, i + MAX_JOINED_CHUNKS); j++) {
      if (isLabelWord(tokens[j])) break;
      joined += tokens[j];
      runs.push(joined);
    }
  }
  return runs;
}

/**
 * @param {{ title?: string, tags?: string[], body?: string }} note
 * @returns {{ rejected: boolean, reasons: string[], warnings: string[] }}
 */
export function scanForSecrets({ title = '', tags = [], body = '' } = {}) {
  const combined = [title, ...tags, body].join('\n');
  const reasons = [];
  const warnings = [];

  // A known secret shape (AWS key, API key prefix, JWT, PEM block...) is recognized
  // by a specific literal prefix, so it's safe to also check a fully whitespace-
  // stripped variant of the text — a stray space/tab/newline dropped into the
  // secret (soft-wrap or deliberate evasion) can't hide it from its own shape.
  const despacedCombined = combined.replace(/\s+/g, '');
  for (const { name, re } of HARD_REJECT_PATTERNS) {
    if (re.test(combined) || re.test(despacedCombined)) {
      reasons.push(`Looks like a${/^[aeiou]/i.test(name) ? 'n' : ''} ${name}.`);
    }
  }

  const tokens = combined.split(/\s+/).filter(Boolean);
  const candidates = [...tokens, ...joinedChunkRuns(tokens)];
  // A candidate containing a real email address is skipped: with ordinary words
  // now eligible to join (needed to catch e.g. "wall"-separated or base64-letter-
  // only split secrets), an email joined with an adjacent word can produce a long
  // mixed string with incidentally high entropy. Emails get their own warning
  // below — they're not secrets, so they shouldn't feed the random-string check.
  if (candidates.some(token => !EMAIL_RE.test(token) && looksRandom(token, combined))) {
    reasons.push('Contains a long, random-looking string that could be a secret.');
  }

  if (EMAIL_RE.test(combined)) {
    warnings.push('Contains an email address.');
  }

  return { rejected: reasons.length > 0, reasons, warnings };
}
