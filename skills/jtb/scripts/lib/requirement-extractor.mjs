/**
 * Extracts acceptance criteria / requirements from Jira ticket text.
 * Recognises: Given/When/Then, must/should/shall/ensure/verify bullets,
 * Acceptance Criteria sections, and numbered imperative items.
 */

const RE_GWT        = /^\s*(given|when|then)\s+(.+)/i;
const RE_MUST_ITEM  = /^\s*[-*•]\s+((?:must|should|shall|ensure|verify)\b.+|.+(?:must|should|shall|ensure|verify).+)/i;
const RE_NUM_MUST   = /^\s*\d+\.\s+((?:must|should|shall|ensure|verify)\b.+|.+(?:must|should|shall|ensure|verify).+)/i;
const RE_AC_HEADER  = /^\s*#+\s*acceptance criteria\s*$/i;
const RE_BULLET     = /^\s*[-*•]\s+(.+)/;
const RE_NUM_ITEM   = /^\s*\d+\.\s+(.+)/;

export function extractRequirements(text) {
  if (!text) return [];

  const lines = text.split('\n');
  const results = [];
  let inAcSection = false;

  for (const line of lines) {
    // Given/When/Then
    const gwt = RE_GWT.exec(line);
    if (gwt) { results.push(line.trim()); continue; }

    // Acceptance Criteria section header
    if (RE_AC_HEADER.test(line)) { inAcSection = true; continue; }

    // Exit AC section on next heading
    if (inAcSection && /^\s*#+\s/.test(line) && !RE_AC_HEADER.test(line)) {
      inAcSection = false;
    }

    // must/should/shall in bullet
    const mustItem = RE_MUST_ITEM.exec(line);
    if (mustItem) { results.push(mustItem[1].trim()); continue; }

    // must/should/shall in numbered item
    const numMust = RE_NUM_MUST.exec(line);
    if (numMust) { results.push(numMust[1].trim()); continue; }

    // Inside AC section: capture all bullet and numbered items
    if (inAcSection) {
      const bullet = RE_BULLET.exec(line);
      if (bullet) { results.push(bullet[1].trim()); continue; }
      const numItem = RE_NUM_ITEM.exec(line);
      if (numItem) { results.push(numItem[1].trim()); continue; }
    }
  }

  return [...new Set(results)];
}
