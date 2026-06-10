/**
 * Extracts acceptance criteria / requirements from Jira ticket text.
 * Recognises: Given/When/Then, must/should/shall/ensure/verify bullets,
 * Acceptance Criteria sections, and numbered imperative items.
 */

const RE_GWT        = /^\s*(given|when|then)\s+(.+)/i;
const RE_MUST_ITEM  = /^\s*[-*•]\s+((?:must|should|shall|ensure|verify)\b.+|.+(?:must|should|shall|ensure|verify).+)/i;
const RE_NUM_MUST   = /^\s*\d+\.\s+((?:must|should|shall|ensure|verify)\b.+|.+(?:must|should|shall|ensure|verify).+)/i;
const RE_AC_HEADER  = /^\s*(?:#+\s*|h[1-6]\.\s*)?acceptance criteria\s*:?\s*$/i;
const RE_HEADING    = /^\s*(?:#+|h[1-6]\.)\s+/i;
const RE_BULLET     = /^\s*[-*•]\s+(.+)/;
const RE_NUM_ITEM   = /^\s*\d+\.\s+(.+)/;

export function extractRequirements(text) {
  if (!text) return [];

  const lines = text.split('\n');
  const results = [];
  let inAcSection = false;

  for (const line of lines) {
    const gwt = RE_GWT.exec(line);
    if (gwt) { results.push(line.trim()); continue; }

    if (RE_AC_HEADER.test(line)) { inAcSection = true; continue; }

    // Exit on any explicit heading (markdown ## or wiki h2.) that is not the AC header
    if (inAcSection && RE_HEADING.test(line) && !RE_AC_HEADER.test(line)) {
      inAcSection = false;
    }

    const mustItem = RE_MUST_ITEM.exec(line);
    if (mustItem) { results.push(mustItem[1].trim()); continue; }

    const numMust = RE_NUM_MUST.exec(line);
    if (numMust) { results.push(numMust[1].trim()); continue; }

    if (inAcSection) {
      const bullet = RE_BULLET.exec(line);
      if (bullet) { results.push(bullet[1].trim()); continue; }
      const numItem = RE_NUM_ITEM.exec(line);
      if (numItem) { results.push(numItem[1].trim()); continue; }
      // Capture plain sentences — ADF paragraph nodes output as bare text (no list marker)
      const plain = line.trim();
      if (plain) { results.push(plain); continue; }
    }
  }

  return [...new Set(results)];
}
