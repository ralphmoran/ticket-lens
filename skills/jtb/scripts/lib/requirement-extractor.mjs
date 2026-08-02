/**
 * Extracts acceptance criteria / requirements from Jira ticket text.
 * Recognises: Given/When/Then, must/should/shall/ensure/verify bullets,
 * Acceptance Criteria sections, and numbered imperative items — both
 * newline-separated ("1. ..." / "1) ...") and inline enumerations flattened
 * into one paragraph ("... 1) foo 2) bar 3) baz"), as produced by Jira ADF.
 */

const RE_GWT           = /^\s*(given|when|then)\s+(.+)/i;
const RE_MUST_ITEM     = /^\s*[-*•]\s+((?:must|should|shall|ensure|verify)\b.+|.+(?:must|should|shall|ensure|verify).+)/i;
const RE_NUM_MUST      = /^\s*\d+[.)]\s+((?:must|should|shall|ensure|verify)\b.+|.+(?:must|should|shall|ensure|verify).+)/i;
const RE_AC_HEADER     = /^\s*(?:#+\s*|h[1-6]\.\s*)?acceptance criteria\s*:?\s*$/i;
const RE_HEADING       = /^\s*(?:#+|h[1-6]\.)\s+/i;
const RE_BULLET        = /^\s*[-*•]\s+(.+)/;
const RE_NUM_ITEM      = /^\s*\d+[.)]\s+(.+)/;
const RE_NUM_MARKER    = /^\s*(\d+)[.)]/;
// A numbered marker preceded by start-of-line or whitespace/punctuation — excludes
// things like "v1." or "2.1" where the digit is glued to a letter or another digit.
// Known limitation: doesn't catch mid-sentence prose like "item 1. Then item 2." —
// narrowing further risks new false negatives on genuine short list items.
const RE_INLINE_MARKER = /(?:^|(?<=[\s:;,]))(\d+)[.)]\s+/g;
// Headings that introduce a numbered list which is NOT acceptance criteria (e.g. bug
// repro steps) — a plain numbered list under one of these must never be extracted.
const RE_NON_AC_HEADER = /^\s*(?:#+\s*|h[1-6]\.\s*)?(?:steps to reproduce|repro(?:duction)? steps|how to reproduce)\s*:?\s*$/i;

// True if numbers is a run starting at 1 with no gaps or repeats (1,2,3,...).
// Shared by findValidNumberedRuns and splitInlineNumbered as the one signal both
// use to tell a genuine enumeration apart from stray numbers elsewhere in prose.
function isSequentialFrom1(numbers) {
  return numbers[0] === 1 && numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1);
}

// Finds line indices that form a genuine numbered enumeration outside any AC/non-AC
// section: 2+ consecutive numbered lines, sequential starting at 1. A single numbered
// line, or numbers that skip/repeat, are too weak a signal on their own (they're just
// as likely to be a "Steps to Reproduce" list, a version note, or an unrelated aside).
// Known limitation: a blank line between items breaks the run (items must be on
// strictly consecutive lines), so a list formatted with blank lines between items
// and no AC header is not recognised — narrower than the AC-header path, which does
// tolerate that (see the "plain sentences" fallback below).
function findValidNumberedRuns(lines) {
  const valid = new Set();
  let inAc = false;
  let inNonAc = false;
  let run = [];

  const flushRun = () => {
    if (run.length >= 2 && isSequentialFrom1(run.map(r => r.num))) {
      for (const r of run) valid.add(r.index);
    }
    run = [];
  };

  lines.forEach((line, index) => {
    if (RE_AC_HEADER.test(line)) { inAc = true; inNonAc = false; flushRun(); return; }
    if (RE_NON_AC_HEADER.test(line)) { inNonAc = true; inAc = false; flushRun(); return; }

    if ((inAc || inNonAc) && RE_HEADING.test(line)) { inAc = false; inNonAc = false; }

    if (inAc || inNonAc) { flushRun(); return; }

    const marker = RE_NUM_MARKER.exec(line);
    if (marker) { run.push({ index, num: Number(marker[1]) }); } else { flushRun(); }
  });
  flushRun();

  return valid;
}

// Splits a line on sequential inline numbered markers ("1) ... 2) ... 3) ...").
// Requires 2+ markers starting at 1 and incrementing by 1, so stray numbers
// elsewhere in prose (versions, dates, prices) don't get misread as a list.
function splitInlineNumbered(line) {
  const markers = [...line.matchAll(RE_INLINE_MARKER)];
  if (markers.length < 2) return [];

  const numbers = markers.map(m => Number(m[1]));
  if (!isSequentialFrom1(numbers)) return [];

  const items = [];
  for (let i = 0; i < markers.length; i++) {
    const start = markers[i].index + markers[i][0].length;
    const end = i + 1 < markers.length ? markers[i + 1].index : line.length;
    const item = line.slice(start, end).trim();
    if (item) items.push(item);
  }
  return items;
}

export function extractRequirements(text) {
  if (!text) return [];

  const lines = text.split('\n');
  const validNumberedLines = findValidNumberedRuns(lines);
  const results = [];
  let inAcSection = false;

  for (const [index, line] of lines.entries()) {
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

    const inlineItems = splitInlineNumbered(line);
    if (inlineItems.length > 0) { results.push(...inlineItems); continue; }

    if (inAcSection) {
      const bullet = RE_BULLET.exec(line);
      if (bullet) { results.push(bullet[1].trim()); continue; }
      const numItem = RE_NUM_ITEM.exec(line);
      if (numItem) { results.push(numItem[1].trim()); continue; }
      // Capture plain sentences — ADF paragraph nodes output as bare text (no list marker)
      const plain = line.trim();
      if (plain) { results.push(plain); continue; }
    }

    // Plain numbered enumeration outside an explicit AC section, no modal verb required —
    // only for a validated run (2+ sequential items, see findValidNumberedRuns)
    if (!inAcSection && validNumberedLines.has(index)) {
      const numItem = RE_NUM_ITEM.exec(line);
      if (numItem) { results.push(numItem[1].trim()); continue; }
    }
  }

  return [...new Set(results)];
}
