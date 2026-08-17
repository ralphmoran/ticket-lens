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

// A candidate containing an unstripped '(', ')', '[', or ']' reads as code
// syntax (an array/list literal element, or a function-call argument — e.g.
// "['compliance', '--help']" or "matches(x)") rather than a secret fragment.
// Consulted ONLY from looksLikeCodeSyntax below, which downgrades a matching
// high-entropy candidate to a warning — deliberately NOT wired into
// isLabelWord (backlog #14 residual, code review caught this on the first
// pass): making a bracket-bearing token a hard isLabelWord stop would end a
// joinedChunkRuns run there unconditionally, the same way GIT_REFERENCE_WORD_RE/
// isHyphenatedWordCompound/looksLikeFilenameReference already do — but unlike
// those, a bracket character is trivial for an attacker to insert anywhere
// ("a(b"), and doing so would fully and SILENTLY stop a genuine fragmented
// secret split around it from ever being reassembled for the entropy check
// (confirmed live: a real 36-char secret split into two 18-char halves around
// a bare "a(b" separator went from rejected:true to a fully silent
// rejected:false/warnings:[] once isLabelWord treated brackets as a stop).
// The downgrade-only design below avoids that: the join still happens (a
// bracket-bearing token is ordinary, never a label word), so any joined
// candidate spanning real secret content still trips the entropy check —
// and since that joined candidate necessarily still contains the bracket
// character too, looksLikeCodeSyntax downgrades it to a WARNING rather than
// silently exempting it, unlike the fully-silent gap the hard-wall version
// would have reopened.
const CODE_SYNTAX_RE = /[()[\]]/;

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

// Shared between CODE_FILENAME_RE below and FILENAME_REFERENCE_RE further
// down, the same way WHITESPACE_CLASS is shared across the whitespace
// regexes above — one definition so the two can't silently drift apart.
const CODE_EXTENSION_ALTERNATION = 'php|m?js|tsx?|jsx|py|rb|java|go|rs|vue|s?css|md|json|ya?ml|sh';

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
//
// Stem allows hyphens (this project's own file-naming convention —
// "recall-nudge-stop.mjs", "secret-scanner.mjs") captured as group 1, so
// looksLikeCodeFilename can judge a kebab-case stem the same way
// isHyphenatedWordCompound already judges one elsewhere in this file (see
// its call below) — a real multi-word filename reads as short, plausible
// segments, not one long random run.
const CODE_FILENAME_RE = new RegExp(`^([A-Za-z][A-Za-z-]*)\\.(${CODE_EXTENSION_ALTERNATION})$`, 'i');

// A hyphenated-stem filename (this project's own file-naming convention —
// "secret-scanner.mjs", "note-command.mjs") optionally followed by a
// directly-attached possessive apostrophe-s ("note-command.mjs's") stops a
// joinedChunkRuns run the same way any other label word does (see
// isLabelWord below). Deliberately a SEPARATE regex from CODE_FILENAME_RE
// above rather than a loosened version of it: CODE_FILENAME_RE feeds
// looksLikeCodeFilename's downgrade-a-reject-to-a-warning path and is
// guarded by hasInternalCaseSwitch specifically so a random single-case
// string plus a fake extension can't be silently waved through (see its
// docstring) — loosening that guard is out of scope here and unnecessary:
// this regex only ever stops a *run*, it never exempts a token from the
// standalone entropy check (every token stays in the flat `tokens` array
// in scanForSecrets regardless of isLabelWord), so it cannot itself bypass
// detection the way a change to CODE_FILENAME_RE could.
//
// Known accepted gap, same class as isLabelWord's ordinary-word and
// hyphenated-compound allowances below: a deliberate attacker could append
// a fake ".mjs" (optionally + "'s") to the first half of a fragmented
// secret specifically to stop the join here. Not a new exposure — this
// file already accepts that an ordinary word or short hyphenated compound
// can be used the same way (see isLabelWord's "Known accepted gap"
// comment). HARD_REJECT_PATTERNS are unaffected either way: that pass uses
// stopAtLabelWords:false and also checks the raw combined/despacedCombined
// text regardless of any token's label-word status.
const FILENAME_REFERENCE_RE = new RegExp(`^[A-Za-z][A-Za-z-]*\\.(${CODE_EXTENSION_ALTERNATION})('s)?$`, 'i');

// Underscore-delimited segments (Zend-1-style PHP class names — a common
// legacy naming convention, e.g. "Acme_Http_ClientFactory",
// "Zend_Http_Client") are letters-only per segment, no digit support (same
// convention as CODE_FILENAME_RE's stem). Deliberately does NOT require
// isHyphenatedWordCompound's "no internal case switch" guard: that guard
// exists there to keep base64-shaped content from posing as a lowercase-
// English hyphenated compound, but PascalCase segments ARE the real,
// expected positive signal for a class name ("ClientFactory",
// "SaleSystem") — requiring their absence would reject the exact
// legitimate shape this exists to recognize. See
// looksLikeCodeIdentifierOrPath's own comment for how this stays
// downgrade-only despite that asymmetry.
const UNDERSCORE_COMPOUND_RE = /^[A-Za-z]+(_[A-Za-z]+)+$/;

// Slash-delimited path segments (a namespace-shaped filesystem/class path —
// "acme/library/Billing/Client/Http/Adapter/Fetch/", optionally trailing-
// slash-terminated). Allows digits per segment (real
// directory/namespace segments routinely do — "v2", "api2"), unlike the
// underscore shape above — a deliberate, narrower convention than mixing
// delimiters within one candidate would need.
const SLASH_PATH_RE = /^[A-Za-z0-9]+(\/[A-Za-z0-9]+)+\/?$/;

// PHP static method/property/const access (Class_Name::method,
// Class_Name::CONST), optionally prefixed by a leading backslash (PHP's
// fully-qualified global-namespace form — stripEdgePunctuation does not
// strip a LEADING backslash, only the trailing/leading punctuation in
// EDGE_PUNCTUATION_RE's class). The class part reuses the same shape as
// UNDERSCORE_COMPOUND_RE but allows a bare (non-underscore) class name too
// — real code has both ("Zend_Http_Client::GET" and "Router::dispatch").
// Found live: backlog #17's ORIGINAL bug report repro included this exact
// class+member shape (`Advent_Http_ClientFactory::clientForJson`,
// `Zend_Http_Client::GET`), but the first fix only covered the bare class
// name in isolation — the embedded "::member" broke UNDERSCORE_COMPOUND_RE's
// match (colons aren't letters/underscores) and no other exemption applied.
const STATIC_REFERENCE_RE = /^\\?([A-Za-z]+(?:_[A-Za-z]+)*)::([A-Za-z_][A-Za-z0-9_]*)$/;

/**
 * Downgrade-only, same never-exempt treatment as looksLikeCodeFilename and
 * looksLikeCodeSyntax below: true for a candidate shaped like a multi-segment
 * code identifier (underscore-delimited PHP/Zend-1-style class name), a
 * namespace/filesystem path (slash-delimited), or a PHP static method/const
 * reference (Class_Name::member, see STATIC_REFERENCE_RE), each segment
 * capped at MAX_COMPOUND_SEGMENT_LENGTH so a long random run can't pose as
 * one "segment" — same cap isHyphenatedWordCompound already uses. Backlog
 * #17: isLabelWord's ordinary-word branch only matches letters-only tokens
 * with no separator at all, and neither existing downgrade path below
 * requires a file extension or bracket/paren — so a standalone identifier,
 * path, or static reference like the three shapes above had no exemption
 * path whatsoever, unlike a hyphenated compound or a dotted filename.
 *
 * A disguised real secret matching any of the three shapes still surfaces
 * as a warning, never a silent pass — see the security regression tests
 * alongside this function's own tests for all three shapes.
 *
 * Known accepted gap (security review, backlog #17): unlike
 * isHyphenatedWordCompound, this has no whole-token case-switch guard (see
 * UNDERSCORE_COMPOUND_RE's own comment for why one can't be added without
 * rejecting the real Zend_Http_Client-shaped identifiers this exists to
 * recognize) — so a uniform-case (all-upper or all-lower) letters-only
 * secret needs only ONE underscore, slash, or "::" inserted to downgrade
 * from a full reject to a warning, no camouflage (fake extension, case
 * pattern) required. Still never a silent pass — always a warning — so
 * this is the same class of trade-off as CODE_SYNTAX_RE's even less-
 * constrained downgrade above (any bracket/paren, no shape requirement at
 * all), not a new exposure.
 */
function looksLikeCodeIdentifierOrPath(rawToken) {
  const stripped = stripEdgePunctuation(rawToken);
  if (UNDERSCORE_COMPOUND_RE.test(stripped)) {
    return stripped.split('_').every(segment => segment.length <= MAX_COMPOUND_SEGMENT_LENGTH);
  }
  if (SLASH_PATH_RE.test(stripped)) {
    return stripped.split('/').filter(Boolean).every(segment => segment.length <= MAX_COMPOUND_SEGMENT_LENGTH);
  }
  const staticRefMatch = stripped.match(STATIC_REFERENCE_RE);
  if (staticRefMatch) {
    const classSegmentsWithinCap = staticRefMatch[1].split('_').every(segment => segment.length <= MAX_COMPOUND_SEGMENT_LENGTH);
    const memberWithinCap = staticRefMatch[2].length <= MAX_COMPOUND_SEGMENT_LENGTH;
    return classSegmentsWithinCap && memberWithinCap;
  }
  return false;
}

function looksLikeCodeFilename(rawToken) {
  const stripped = stripEdgePunctuation(rawToken);
  const match = stripped.match(CODE_FILENAME_RE);
  if (match === null) return false;
  // Two independent ways a filename-shaped token reads as "structured, not
  // random" rather than a disguised secret: an internal case switch (the
  // same signal used to detect base64 content elsewhere in this file) is
  // the PascalCase/camelCase signal; isHyphenatedWordCompound (already
  // defined above, already reused this way for the join-stopping check) is
  // the kebab-case signal — this project's own actual file-naming
  // convention. A genuinely random single-case, non-hyphenated letter run
  // plus a fake extension satisfies neither and gets no special treatment
  // at all — only tokens that already look like a real filename (either
  // convention) reach the softer warning path below.
  return hasInternalCaseSwitch(match[0]) || isHyphenatedWordCompound(match[1]);
}

function looksLikeFilenameReference(strippedToken) {
  return FILENAME_REFERENCE_RE.test(strippedToken);
}

/**
 * True for a candidate — a raw token OR a joinedChunkRuns result — that
 * itself contains an unstripped '(', ')', '[', or ']': code syntax (a
 * function-call argument or array/list-literal element) rather than a secret
 * fragment. Deliberately NOT wired into isLabelWord/joinedChunkRuns (see
 * CODE_SYNTAX_RE's own comment for why that hard-wall approach reopened a
 * silent reassembly bypass) — instead this only downgrades a candidate that
 * ALREADY tripped looksRandom, same never-exempt treatment as
 * looksLikeCodeFilename below. Covers both backlog #14 residual shapes: a
 * token already 20+ chars on its own with no join needed (e.g.
 * "matches(['compliance'," — whitespace-split with no space after '(' or
 * '[', so it's one raw token from the very first split), and a joined run
 * that only crosses the entropy threshold once several bracket-literal
 * tokens glue together (e.g. "['compliance','--help','-h','debug']") — the
 * bracket character survives into the joined string either way, so this
 * still catches it. Fully exempting this shape would let a 20+ char secret
 * dodge rejection just by wrapping it in a fake "f(" / "[" — see the
 * security regression test alongside looksLikeCodeFilename's.
 */
function looksLikeCodeSyntax(rawToken) {
  return CODE_SYNTAX_RE.test(stripEdgePunctuation(rawToken));
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
 * compound word (see isHyphenatedWordCompound), a filename reference (see
 * FILENAME_REFERENCE_RE — "note-command.mjs", "note-command.mjs's"), or an
 * ordinary English word (letters only, optionally with an internal
 * possessive/contraction apostrophe — "relay's", "doesn't" — but no
 * base64-style case switching). Anything else — a fragment containing a
 * digit or other symbol, or an all-letter chunk that still reads as random
 * content — stays eligible to join, so a secret split by whitespace can
 * still be reassembled for the entropy check.
 *
 * Filename references (backlog #13) matter for the same reason the
 * apostrophe allowance below does: "note-command.mjs's runNoteAdd" is
 * ordinary engineering prose (a filename possessive next to an identifier),
 * but before this allowance neither token qualified as a label word — the
 * filename fails the ordinary-word branch (hyphen and period aren't
 * letters) and the identifier fails it too (camelCase has an internal case
 * switch, by design) — so they glued into one candidate that tripped the
 * entropy threshold. See FILENAME_REFERENCE_RE's own comment for why this
 * is scoped separately from CODE_FILENAME_RE/looksLikeCodeFilename and
 * cannot reopen that function's CRITICAL-bypass guard.
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
  if (looksLikeFilenameReference(stripped)) return true;
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
  if (
    randomCandidates.some(
      token => !looksLikeCodeFilename(token) && !looksLikeCodeSyntax(token) && !looksLikeCodeIdentifierOrPath(token),
    )
  ) {
    reasons.push('Contains a long, random-looking string that could be a secret.');
  }
  if (randomCandidates.some(token => looksLikeCodeFilename(token))) {
    warnings.push('Contains a code-filename-shaped token that also reads as high-entropy — double-check it is not a credential.');
  }
  if (randomCandidates.some(token => looksLikeCodeSyntax(token))) {
    warnings.push('Contains a code-syntax-shaped token (brackets or parentheses) that also reads as high-entropy — double-check it is not a credential.');
  }
  if (randomCandidates.some(token => looksLikeCodeIdentifierOrPath(token))) {
    warnings.push('Contains a code-identifier-or-path-shaped token that also reads as high-entropy — double-check it is not a credential.');
  }

  if (EMAIL_RE.test(combined)) {
    warnings.push('Contains an email address.');
  }

  return { rejected: reasons.length > 0, reasons, warnings };
}
