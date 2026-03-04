/**
 * Extracts code references (file paths, methods, classes, SHAs, branches, etc.)
 * from Jira ticket text (descriptions, comments).
 */

export function extractFilePaths(text) {
  if (!text) return [];
  const pattern = /(?:^|[\s,;(])((?:\/|[a-zA-Z0-9_.-]+\/)[a-zA-Z0-9_.\/-]*\.[a-zA-Z0-9]+)/gm;
  const results = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    results.push(match[1]);
  }
  return [...new Set(results)];
}

export function extractMethodNames(text) {
  if (!text) return [];
  const pattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\(\)/g;
  const results = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    results.push(match[1]);
  }
  return [...new Set(results)];
}

export function extractClassNames(text) {
  if (!text) return [];
  // Matches PascalCase names (MyClass) and underscore-separated (Zend_Controller_Action)
  const pattern = /\b([A-Z][a-zA-Z0-9]*(?:_[A-Z][a-zA-Z0-9]*)+)\b/g;
  const results = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    results.push(match[1]);
  }
  return [...new Set(results)];
}

export function extractShas(text) {
  if (!text) return [];
  const results = [];
  // 40-char full SHAs first
  const fullPattern = /\b([0-9a-f]{40})\b/g;
  let match;
  while ((match = fullPattern.exec(text)) !== null) {
    results.push(match[1]);
  }
  // 7-char short SHAs (must contain at least one digit and one letter to avoid false positives)
  const shortPattern = /\b([0-9a-f]{7})\b/g;
  while ((match = shortPattern.exec(text)) !== null) {
    if (/[0-9]/.test(match[1]) && /[a-f]/.test(match[1])) {
      results.push(match[1]);
    }
  }
  return [...new Set(results)];
}

export function extractSvnRevisions(text) {
  if (!text) return [];
  const pattern = /\b(r\d+)\b/g;
  const results = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    results.push(match[1]);
  }
  return [...new Set(results)];
}

export function extractBranches(text) {
  if (!text) return [];
  const pattern = /\b((?:feature|bugfix|hotfix|release|fix)\/[a-zA-Z0-9_.-]+-[a-zA-Z0-9_.-]+(?:-[a-zA-Z0-9_.-]+)*)\b/g;
  const results = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
    results.push(match[1]);
  }
  return [...new Set(results)];
}

export function extractNamespaces(text) {
  if (!text) return [];
  const pattern = /\b([A-Z][a-zA-Z0-9]*(?:\\[A-Z][a-zA-Z0-9]*)+)\b/g;
  const results = [];
  let match;
  while ((match = pattern.exec(text)) !== null) {
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
