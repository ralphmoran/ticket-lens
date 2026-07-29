/**
 * Zero-dependency duplicate-ticket scoring. No tracker (Jira/GitHub/Linear)
 * offers server-side similarity scoring — only exact/substring text filters —
 * so candidate ranking happens here via Jaccard set overlap on tokenized text.
 */

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'is', 'are',
  'this', 'that', 'with', 'as', 'at', 'by', 'from', 'it', 'be', 'was', 'were',
  'has', 'have', 'had', 'not', 'but', 'if', 'will', 'can', 'do', 'does',
]);

const TITLE_WEIGHT = 2;
const DESCRIPTION_WEIGHT = 1;
const DESCRIPTION_CHAR_LIMIT = 500;

/**
 * Lowercases, strips punctuation, drops stopwords and sub-2-char tokens,
 * and de-duplicates. Returns a plain array (order not significant — callers
 * treat it as a set).
 */
export function tokenize(text) {
  if (!text) return [];
  const words = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const seen = new Set();
  for (const w of words) {
    if (w.length >= 2 && !STOPWORDS.has(w)) seen.add(w);
  }
  return [...seen];
}

/**
 * Intersection-over-union. Two empty sets are defined as 0 similarity, not 1 —
 * an empty-vs-empty match is a lack of signal, not a confirmed duplicate.
 */
export function jaccardSimilarity(tokensA, tokensB) {
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function weightedScore(source, candidate) {
  const titleScore = jaccardSimilarity(tokenize(source.summary), tokenize(candidate.summary));
  const descScore = jaccardSimilarity(
    tokenize((source.description ?? '').slice(0, DESCRIPTION_CHAR_LIMIT)),
    tokenize((candidate.description ?? '').slice(0, DESCRIPTION_CHAR_LIMIT)),
  );
  return (titleScore * TITLE_WEIGHT + descScore * DESCRIPTION_WEIGHT) / (TITLE_WEIGHT + DESCRIPTION_WEIGHT);
}

/**
 * Ranks candidates against the source ticket, excludes the source itself
 * (defense-in-depth — callers already exclude it at the query level) and
 * anything below `threshold`, sorted highest score first, capped at `limit`.
 */
export function scoreCandidates(source, candidates, { threshold = 0.35, limit = 5 } = {}) {
  return candidates
    .filter(c => c.key !== source.key)
    .map(c => ({ key: c.key, summary: c.summary, score: weightedScore(source, c) }))
    .filter(c => c.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
