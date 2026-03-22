/**
 * Extracts code references (file paths, methods, classes, SHAs, branches, etc.)
 * from Jira ticket text (descriptions, comments).
 */

// Module-level constants — compiled once, reused across all calls
const RE_FILE_PATHS    = /(?:^|[\s,;(])((?:\/|[a-zA-Z0-9_.-]+\/)[a-zA-Z0-9_.\/-]*\.[a-zA-Z0-9]+)/gm;
const RE_METHODS       = /\b([a-zA-Z_][a-zA-Z0-9_]*)\(\)/g;
const RE_CLASSES       = /\b([A-Z][a-zA-Z0-9]*(?:_[A-Z][a-zA-Z0-9]*)+)\b/g;
const RE_SHA_FULL      = /\b([0-9a-f]{40})\b/g;
const RE_SHA_SHORT     = /\b([0-9a-f]{7})\b/g;
const RE_SHA_HAS_DIGIT = /[0-9]/;
const RE_SHA_HAS_ALPHA = /[a-f]/;
const RE_SVN           = /\b(r\d+)\b/g;
const RE_BRANCHES      = /\b((?:feature|bugfix|hotfix|release|fix)\/[a-zA-Z0-9_.-]+-[a-zA-Z0-9_.-]+(?:-[a-zA-Z0-9_.-]+)*)\b/g;
const RE_NAMESPACES    = /\b([A-Z][a-zA-Z0-9]*(?:\\[A-Z][a-zA-Z0-9]*)+)\b/g;

export function extractFilePaths(text) {
  if (!text) return [];
  const results = [];
  let match;
  RE_FILE_PATHS.lastIndex = 0;
  while ((match = RE_FILE_PATHS.exec(text)) !== null) {
    results.push(match[1]);
  }
  return [...new Set(results)];
}

export function extractMethodNames(text) {
  if (!text) return [];
  const results = [];
  let match;
  RE_METHODS.lastIndex = 0;
  while ((match = RE_METHODS.exec(text)) !== null) {
    results.push(match[1]);
  }
  return [...new Set(results)];
}

export function extractClassNames(text) {
  if (!text) return [];
  // Matches PascalCase names (MyClass) and underscore-separated (Zend_Controller_Action)
  const results = [];
  let match;
  RE_CLASSES.lastIndex = 0;
  while ((match = RE_CLASSES.exec(text)) !== null) {
    results.push(match[1]);
  }
  return [...new Set(results)];
}

export function extractShas(text) {
  if (!text) return [];
  const results = [];
  let match;
  RE_SHA_FULL.lastIndex = 0;
  while ((match = RE_SHA_FULL.exec(text)) !== null) {
    results.push(match[1]);
  }
  // 7-char short SHAs (must contain at least one digit and one letter to avoid false positives)
  RE_SHA_SHORT.lastIndex = 0;
  while ((match = RE_SHA_SHORT.exec(text)) !== null) {
    if (RE_SHA_HAS_DIGIT.test(match[1]) && RE_SHA_HAS_ALPHA.test(match[1])) {
      results.push(match[1]);
    }
  }
  return [...new Set(results)];
}

export function extractSvnRevisions(text) {
  if (!text) return [];
  const results = [];
  let match;
  RE_SVN.lastIndex = 0;
  while ((match = RE_SVN.exec(text)) !== null) {
    results.push(match[1]);
  }
  return [...new Set(results)];
}

export function extractBranches(text) {
  if (!text) return [];
  const results = [];
  let match;
  RE_BRANCHES.lastIndex = 0;
  while ((match = RE_BRANCHES.exec(text)) !== null) {
    results.push(match[1]);
  }
  return [...new Set(results)];
}

export function extractNamespaces(text) {
  if (!text) return [];
  const results = [];
  let match;
  RE_NAMESPACES.lastIndex = 0;
  while ((match = RE_NAMESPACES.exec(text)) !== null) {
    results.push(match[1]);
  }
  return [...new Set(results)];
}

export function extractCodeReferences(text) {
  return {
    filePaths: extractFilePaths(text),
    methods: extractMethodNames(text),
    classes: extractClassNames(text),
    shas: extractShas(text),
    svnRevisions: extractSvnRevisions(text),
    branches: extractBranches(text),
    namespaces: extractNamespaces(text),
  };
}
