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
const EDGE_PUNCTUATION_RE = /^[`'"(),.:]+|[`'"(),.:]+$/g;
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
// Real compound-word segments ("dual-store", "not-yet-configured") run short —
// capping segment length keeps a long random letters-only run from masquerading
// as one "segment" of a fake compound. See isHyphenatedWordCompound.
const MAX_COMPOUND_SEGMENT_LENGTH = 15;
const HYPHENATED_COMPOUND_RE = /^[A-Za-z]+(-[A-Za-z]+)+$/;

// U+200B (ZERO WIDTH SPACE) is added explicitly: despite the name, it does
// NOT carry the Unicode White_Space property (General_Category=Cf, not Zs),
// so it's excluded from JS's native \s (ECMA-262 WhiteSpace production) —
// the one gap backlog 1c/1d's U+FEFF handling didn't already cover for free,
// since \s does include U+FEFF. Without this, a secret split by U+200B stays
// as one unsplit token, invisible to the direct match, hardRejectRuns
// (nothing to rejoin), and despacedCombined (not stripped) alike — only
// entropy would catch it, and only by chance (backlog 1e). Shared as a
// fragment (not just inside the tokenize/despace regexes below) so the PEM
// entry in HARD_REJECT_PATTERNS stays in sync with it automatically —
// mirrors RecallSecretScanner.php's WHITESPACE_CLASS.
const WHITESPACE_CLASS = '[\\s\\u200B]';
const WHITESPACE_SPLIT_RE = new RegExp(WHITESPACE_CLASS + '+');
const WHITESPACE_STRIP_RE = new RegExp(WHITESPACE_CLASS + '+', 'g');

const HARD_REJECT_PATTERNS = [
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  // WHITESPACE_CLASS* (not a literal space) between segments: this is the
  // only entry with required internal spacing, and hardRejectRuns
  // (no-separator rejoin) and despacedCombined (whitespace stripped) both
  // destroy a literal space the same way they correctly neutralize
  // whitespace-splitting on every other pattern here — so a tab, extra
  // spaces, a newline, Unicode whitespace, or no separator at all bypassed
  // this entry until backlog 1d closed it, and U+200B specifically until
  // backlog 1e (see WHITESPACE_CLASS above). Built with `new RegExp` instead
  // of a literal so it reuses the exact same class as
  // WHITESPACE_SPLIT_RE/WHITESPACE_STRIP_RE — a literal duplicate here is
  // exactly how the /u flag itself drifted out of sync in backlog 1c.
  {
    name: 'private key block',
    re: new RegExp(
      `-----BEGIN${WHITESPACE_CLASS}*(RSA${WHITESPACE_CLASS}*|EC${WHITESPACE_CLASS}*|OPENSSH${WHITESPACE_CLASS}*|DSA${WHITESPACE_CLASS}*)?PRIVATE${WHITESPACE_CLASS}*KEY-----`,
    ),
  },
  { name: 'JSON Web Token (JWT)', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  { name: 'API key', re: /\b(sk-|gsk_)[A-Za-z0-9]{20,}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

// A letters-only token ending in a recognized source-file extension reads as
// high-entropy the same way a real secret does — a class name doubling as its
// filename is the common case, but a deliberately-renamed or accidentally
// letters-only secret (no digits, so the hard-reject patterns above don't
// apply either) would match this shape too and MUST NOT be silently waved
// through: security review confirmed a full-exemption version of this check
// was a deterministic bypass (append ".php" to any 20+ char letters-only
// secret and it passed clean). So this only ever downgrades a match to a
// warning, never removes it from the reject reasons — see the two
// independent checks against looksRandomCandidates in scanForSecrets below,
// not a shortcut inside looksRandom itself. A bare identifier with no
// extension (a method name, not a filename) isn't covered by this at all —
// that shape is indistinguishable from a base64 secret fragment either way.
const CODE_FILENAME_RE = /^[A-Za-z]+\.(php|m?js|tsx?|jsx|py|rb|java|go|rs|vue|s?css|md|json|ya?ml|sh)$/i;

function looksLikeCodeFilename(rawToken) {
  const stripped = stripEdgePunctuation(rawToken);
  const match = stripped.match(CODE_FILENAME_RE);
  // Requiring an internal case switch in the stem (the same signal used to
  // detect base64 content elsewhere in this file) means a genuinely random
  // single-case letter run plus a fake extension gets no special treatment
  // at all — only tokens that already look like a real PascalCase/camelCase
  // identifier reach the softer warning path below.
  return match !== null && hasInternalCaseSwitch(match[0]);
}

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
 * True for a letters-only, hyphen-delimited token whose segments are all
 * short enough to read as a real compound word ("dual-store", "REDIS-vs-PG",
 * "not-yet-configured") rather than a whitespace-split secret fragment. Only
 * consulted from isLabelWord, i.e. only affects the stopAtLabelWords:true
 * (generic-secret entropy) pass — joinedChunkRuns's stopAtLabelWords:false
 * pass, which is what HARD_REJECT_PATTERNS relies on to catch a whitespace-
 * split sk-/gsk_/AKIA/gh*_/eyJ/PEM-prefixed secret, never calls isLabelWord
 * at all, so this cannot weaken that protection (see the regression test
 * for exactly that shape, still passing after this change).
 *
 * The hasInternalCaseSwitch check matters the same way it does everywhere
 * else in this file that distinguishes base64 content from prose (see
 * isLabelWord's plain-word branch and looksLikeCodeFilename): without it, a
 * base64-shaped fragment like "zqXvbNmKl-PoIuYtR" reads as a "compound word"
 * purely because it happens to contain a hyphen, which would let it stop a
 * run the same way a real compound does — the same category of shape-based
 * exemption that made the code-filename bypass CRITICAL. Every real compound
 * tested (dual-store, REDIS-vs-PG, well-known, not-yet-configured, PROD-DB,
 * end-to-end, ...) has no internal case switch, so this costs nothing.
 */
function isHyphenatedWordCompound(token) {
  if (!HYPHENATED_COMPOUND_RE.test(token)) return false;
  if (hasInternalCaseSwitch(token)) return false;
  return token.split('-').every(segment => segment.length <= MAX_COMPOUND_SEGMENT_LENGTH);
}

/**
 * True for a token that stops a joined-chunk run: either a recognized git/
 * checksum label word ("commit", "sha256", "md5sum", ...), a hyphenated
 * compound word (see isHyphenatedWordCompound), or an ordinary English word
 * (letters only, optionally with an internal possessive/contraction
 * apostrophe — "relay's", "doesn't" — but no base64-style case switching).
 * Anything else — a fragment containing a digit or other symbol, or an
 * all-letter chunk that still reads as random content — stays eligible to
 * join, so a secret split by whitespace can still be reassembled for the
 * entropy check.
 *
 * The apostrophe allowance matters because without it, an ordinary possessive
 * next to another non-label token (e.g. a hyphenated compound: "relay's
 * decision-lookup") never gets a chance to stop the run — both fail to
 * qualify, so they concatenate into one artificial blob whose mixed
 * punctuation trips the entropy threshold. A real false positive, not a
 * hypothetical one (see the regression test below).
 *
 * Hyphenated compounds get the narrower isHyphenatedWordCompound allowance
 * rather than the full apostrophe treatment: a short prefix + hyphen + one
 * long unstructured letter-run (e.g. "sk-abcdefghijklmnop") still fails it —
 * one segment exceeds MAX_COMPOUND_SEGMENT_LENGTH — so it stays eligible to
 * join. This is belt-and-suspenders on top of the fact noted above that the
 * hard-reject pass doesn't consult isLabelWord in the first place. Accepted
 * trade-off: a hypothetical generic (non-hard-reject-shaped) secret that is
 * itself letters-only, hyphen-delimited, and short-segmented would no longer
 * bridge across a whitespace split via this path — no known real secret
 * generator produces that shape (base32/64/hex alphabets are digit-inclusive).
 *
 * Known accepted gap: this can't tell a genuine possessive from one an
 * attacker deliberately chose as a separator to defeat the scanner (e.g.
 * splitting a secret around "user's"). Closing that would require treating
 * ordinary prose words as joinable too, which in turn re-joins real sentence
 * text into false-positive "random" strings (verified empirically — see the
 * regression test for "PROD-123456 for background"). Entropy-based detection
 * is a safety net, not a cryptographic guarantee; the well-known secret
 * shapes in HARD_REJECT_PATTERNS are the layer that's whitespace-proof,
 * since they match a specific literal prefix — with one exception: the
 * private-key-block entry has two internal separator points (around the
 * optional algorithm word and before KEY), and a word inserted at either
 * one still defeats it, exactly as it did before backlog 1d's whitespace
 * fix (that fix closed whitespace-substitution/removal, not word
 * insertion — the same accepted-gap class as the possessive case above).
 */
function isLabelWord(token) {
  const stripped = stripEdgePunctuation(token);
  if (GIT_REFERENCE_WORD_RE.test(stripped)) return true;
  if (isHyphenatedWordCompound(stripped)) return true;
  return /^[A-Za-z]+(?:'[A-Za-z]+)*$/.test(stripped) && !hasInternalCaseSwitch(stripped);
}

/**
 * Rejoins runs of adjacent whitespace-separated tokens (no separator) so a secret
 * broken up by whitespace — accidental soft-wrap, or a deliberate space/tab/
 * newline inserted to dodge the scanner — still reads as one contiguous string.
 *
 * `stopAtLabelWords` (the default) ends a run at a label word (see isLabelWord),
 * so a real context word like "commit" can't glue onto an unrelated payload and
 * trip the entropy heuristic. Pass false for the HARD_REJECT_PATTERNS pass: those
 * match an exact literal prefix (AKIA, sk-, ghp_, eyJ, -----BEGIN) rather than
 * guessing from shape, so ordinary prose can't turn into a false positive there —
 * and a fixed secret prefix can itself look like an ordinary word to isLabelWord
 * ("AKIA" is indistinguishable from an acronym by that heuristic), which would
 * otherwise stop it from ever rejoining with a whitespace-split suffix.
 *
 * Either way a run only ever extends forward from its own start index, so a word
 * standing immediately *before* a secret is never glued onto it — that's what
 * keeps the leading \b anchor in the boundary-anchored patterns intact.
 *
 * @param {string[]} tokens
 * @param {{ stopAtLabelWords?: boolean }} [opts]
 * @returns {string[]}
 */
function joinedChunkRuns(tokens, { stopAtLabelWords = true } = {}) {
  const runs = [];
  for (let i = 0; i < tokens.length; i++) {
    if (stopAtLabelWords && isLabelWord(tokens[i])) continue;
    let joined = tokens[i];
    for (let j = i + 1; j < Math.min(tokens.length, i + MAX_JOINED_CHUNKS); j++) {
      if (stopAtLabelWords && isLabelWord(tokens[j])) break;
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

  // Each field is tokenized on its own, and joinedChunkRuns runs separately
  // per field, so a trailing tag word can never glue onto the next tag or
  // onto the body's first word (see Trigger 3 in
  // recall-secret-scanner-false-positives.md — tags echoing a phrase already
  // repeated in the body were false-positiving via exactly this cross-field
  // join). The hard-reject pass below intentionally keeps using the flat,
  // cross-field `tokens`/`combined`/`despacedCombined`: those patterns match
  // an exact literal prefix (AKIA, sk-, ghp_, eyJ, -----BEGIN), so joining
  // across a field boundary can't turn them into a false positive the way
  // entropy can.
  const fieldTokenGroups = [title, ...tags, body].map(field => field.split(WHITESPACE_SPLIT_RE).filter(Boolean));
  const tokens = fieldTokenGroups.flat();
  const candidates = [...tokens, ...fieldTokenGroups.flatMap(group => joinedChunkRuns(group))];

  // A known secret shape (AWS key, API key prefix, JWT, PEM block...) is recognized
  // by a specific literal prefix. Checked three ways, each catching what the
  // others miss:
  //   1. combined            — the unsplit occurrence.
  //   2. hardRejectRuns      — each individually rejoined run (bounded to
  //      MAX_JOINED_CHUNKS tokens), which keeps the leading \b anchor intact
  //      for the two boundary-anchored patterns (API key, GitHub token) —
  //      stripping whitespace from the whole note at once would instead glue
  //      an unrelated preceding word onto the secret's first character and
  //      kill that anchor. This is the primary, anchor-safe check.
  //   3. despacedCombined    — the whole note with all whitespace stripped,
  //      unbounded in length. A fallback for fragmentation wider than
  //      MAX_JOINED_CHUNKS tokens (e.g. a secret typed one character per
  //      token) that #2's bounded window can't reach. Reintroduces the same
  //      anchor risk #2 was built to avoid, but only as an additional check
  //      alongside #2, never instead of it — it can only add a detection
  //      that #1/#2 missed, never remove one they already caught.
  const despacedCombined = combined.replace(WHITESPACE_STRIP_RE, '');
  const hardRejectRuns = joinedChunkRuns(tokens, { stopAtLabelWords: false });
  for (const { name, re } of HARD_REJECT_PATTERNS) {
    if (re.test(combined) || hardRejectRuns.some(c => re.test(c)) || re.test(despacedCombined)) {
      reasons.push(`Looks like a${/^[aeiou]/i.test(name) ? 'n' : ''} ${name}.`);
    }
  }

  // A candidate containing a real email address is skipped: with ordinary words
  // now eligible to join (needed to catch e.g. "wall"-separated or base64-letter-
  // only split secrets), an email joined with an adjacent word can produce a long
  // mixed string with incidentally high entropy. Emails get their own warning
  // below — they're not secrets, so they shouldn't feed the random-string check.
  //
  // A code-filename-shaped candidate (looksLikeCodeFilename) is split out into
  // its own warning instead of a reject reason: security review found that
  // fully exempting this shape from the entropy check was a deterministic
  // bypass (append ".php" to any letters-only secret and it passed clean).
  // Downgrading to a warning — never silently dropping the signal — matches
  // how an email address is already handled below.
  const randomCandidates = candidates.filter(token => !EMAIL_RE.test(token) && looksRandom(token, combined));
  if (randomCandidates.some(token => !looksLikeCodeFilename(token))) {
    reasons.push('Contains a long, random-looking string that could be a secret.');
  }
  if (randomCandidates.some(token => looksLikeCodeFilename(token))) {
    warnings.push('Contains a code-filename-shaped token that also reads as high-entropy — double-check it is not a credential.');
  }

  if (EMAIL_RE.test(combined)) {
    warnings.push('Contains an email address.');
  }

  return { rejected: reasons.length > 0, reasons, warnings };
}
