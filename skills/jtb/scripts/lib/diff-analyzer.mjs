/**
 * Maps a list of requirements to FOUND / NOT_FOUND / PARTIAL status
 * against a git diff string, using keyword heuristics.
 */

const STOP_WORDS = new Set([
  'the','a','an','is','are','be','was','were','been','being',
  'have','has','had','do','does','did','will','would','could','should',
  'may','might','must','shall','and','or','but','in','on','at','to',
  'for','of','with','by','from','as','it','its','that','this','these',
  'those','not','no','if','when','then','given','user','system','api',
]);

function keywords(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function defaultAnalyzer(requirement, diff) {
  if (!diff) return 'NOT_FOUND';
  const kws = keywords(requirement);
  if (kws.length === 0) return 'NOT_FOUND';
  const diffLower = diff.toLowerCase();
  const matched = kws.filter(k => diffLower.includes(k));
  if (matched.length === 0) return 'NOT_FOUND';
  if (matched.length >= 3 || matched.length >= kws.length * 0.6) return 'FOUND';
  return 'PARTIAL';
}

function defaultEvidence(requirement, diff) {
  if (!diff) return null;
  const kws = keywords(requirement);
  const lines = diff.split('\n');
  for (const kw of kws) {
    const match = lines.find(l => l.toLowerCase().includes(kw));
    if (match) return match.trim().slice(0, 80);
  }
  return null;
}

export function analyzeDiff(requirements, diff, opts = {}) {
  if (!requirements || requirements.length === 0) {
    return { results: [], coveragePercent: 0 };
  }

  const analyzerFn = opts.analyzerFn ?? defaultAnalyzer;

  const results = requirements.map(requirement => {
    const status   = analyzerFn(requirement, diff);
    const evidence = status !== 'NOT_FOUND' ? defaultEvidence(requirement, diff) : null;
    return { requirement, status, evidence };
  });

  const score = results.reduce((sum, r) => {
    if (r.status === 'FOUND')    return sum + 1;
    if (r.status === 'PARTIAL')  return sum + 0.5;
    return sum;
  }, 0);

  const coveragePercent = Math.round((score / results.length) * 100);

  return { results, coveragePercent };
}
