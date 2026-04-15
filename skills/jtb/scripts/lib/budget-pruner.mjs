/**
 * Token Budget Optimizer — prune a TicketBrief markdown string to fit within
 * a token budget. Operates on the plain (non-ANSI) brief string.
 *
 * Pruning priority order:
 *   1. Remove individual comment blocks older than 30 days
 *   2. Remove the entire ## Attachments section
 *   3. Truncate ## Description to first 500 chars
 *   4. Remove comment bodies from ## Linked Tickets, keep key+summary lines
 */

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Estimate token count for a string using the 4-chars-per-token heuristic.
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Split a brief string into sections keyed by their `## Heading` marker.
 * Returns an array of { heading: string|null, content: string } objects.
 * The first element (before the first ## heading) has heading === null.
 *
 * @param {string} brief
 * @returns {Array<{ heading: string|null, content: string }>}
 */
function splitSections(brief) {
  const lines = brief.split('\n');
  const sections = [];
  let current = { heading: null, lines: [] };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      sections.push(current);
      current = { heading: line.slice(3).trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections.map(s => ({ heading: s.heading, content: s.lines.join('\n') }));
}

/**
 * Join sections back into a brief string.
 * @param {Array<{ heading: string|null, content: string }>} sections
 * @returns {string}
 */
function joinSections(sections) {
  return sections.map(s => s.content).join('\n');
}

/**
 * Parse an individual comment block's date from the heading line.
 * Expects format: `### **Author Name** (YYYY-MM-DD)`
 * Returns a Date or null if unparseable.
 *
 * @param {string} block
 * @returns {Date|null}
 */
function parseCommentDate(block) {
  const match = block.match(/###\s+\*\*[^*]+\*\*\s+\((\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  return new Date(match[1] + 'T00:00:00.000Z');
}

/**
 * Split the Comments section content into individual comment blocks.
 * Blocks are separated by `---`.
 *
 * @param {string} sectionContent - full section content including the `## Comments` heading line
 * @returns {string[]} array of individual comment block strings (may include leading ---\n\n)
 */
function splitCommentBlocks(sectionContent) {
  // Strip the heading line (first line: "## Comments")
  const withoutHeading = sectionContent.replace(/^## Comments\n\n?/, '');
  return withoutHeading.split(/\n\n---\n\n/);
}

/**
 * Determine the bare minimum token count for a brief (key + summary line only).
 * This is the first two non-empty lines of the brief.
 *
 * @param {string} brief
 * @returns {number}
 */
function bareMinimumTokens(brief) {
  const nonEmpty = brief.split('\n').filter(l => l.trim().length > 0);
  const minText = nonEmpty.slice(0, 2).join('\n');
  return estimateTokens(minText);
}

/**
 * Prune a TicketBrief markdown string to fit within a token budget.
 *
 * @param {string} brief - assembled brief string (plain text, no ANSI)
 * @param {object} [opts]
 * @param {number} [opts.budget] - token limit (integer)
 * @param {object} [opts.stream] - writable stream (default process.stderr)
 * @param {Date}   [opts.now]   - reference Date for age calculations (default new Date())
 * @returns {{ pruned: string, dropped: string[], finalTokens: number }}
 */
export function pruneBrief(brief, { budget, stream, now } = {}) {
  const streamOut = stream ?? process.stderr;
  const nowDate   = now ?? new Date();

  // No budget specified — return unchanged
  if (budget == null) {
    return { pruned: brief, dropped: [], finalTokens: estimateTokens(brief) };
  }

  const currentTokens = estimateTokens(brief);

  // Already within budget — return unchanged
  if (currentTokens <= budget) {
    return { pruned: brief, dropped: [], finalTokens: currentTokens };
  }

  // Check bare minimum guard
  const minTokens = bareMinimumTokens(brief);
  if (budget < minTokens) {
    streamOut.write(`  \u26a0  Budget ${budget} too small \u2014 returning full brief. Minimum is ~${minTokens} tokens.\n`);
    return { pruned: brief, dropped: [], finalTokens: currentTokens };
  }

  const dropped = [];
  let sections = splitSections(brief);

  // ── Priority 1: Remove old comments (> 30 days) ────────────────────────────
  const commentIdx = sections.findIndex(s => s.heading === 'Comments');
  if (commentIdx !== -1 && estimateTokens(joinSections(sections)) > budget) {
    const commentsSection = sections[commentIdx];
    const blocks = splitCommentBlocks(commentsSection.content);
    const keptBlocks = [];
    let removedCount = 0;
    let removedChars = 0;

    for (const block of blocks) {
      if (!block.trim()) continue;
      const date = parseCommentDate(block);
      const isOld = date && (nowDate - date) > THIRTY_DAYS_MS;
      if (isOld) {
        removedCount++;
        removedChars += block.length;
      } else {
        keptBlocks.push(block);
      }
    }

    if (removedCount > 0) {
      dropped.push(`${removedCount} old comment${removedCount !== 1 ? 's' : ''} (\u2212${estimateTokens(' '.repeat(removedChars))}t)`);
      if (keptBlocks.length > 0) {
        commentsSection.content = `## Comments\n\n${keptBlocks.join('\n\n---\n\n')}`;
      } else {
        // Remove the entire Comments section
        sections.splice(commentIdx, 1);
      }
    }
  }

  // ── Priority 2: Remove Attachments section ─────────────────────────────────
  if (estimateTokens(joinSections(sections)) > budget) {
    const attIdx = sections.findIndex(s => s.heading === 'Attachments');
    if (attIdx !== -1) {
      const attContent = sections[attIdx].content;
      const attTokens = estimateTokens(attContent);
      // Count attachment lines (lines starting with "- ")
      const attLines = attContent.split('\n').filter(l => l.trim().startsWith('- ')).length;
      dropped.push(`${attLines} attachment${attLines !== 1 ? 's' : ''} (\u2212${attTokens}t)`);
      sections.splice(attIdx, 1);
    }
  }

  // ── Priority 3: Truncate Description to 500 chars ─────────────────────────
  if (estimateTokens(joinSections(sections)) > budget) {
    const descIdx = sections.findIndex(s => s.heading === 'Description');
    if (descIdx !== -1) {
      const descSection = sections[descIdx];
      // Content after the heading line + blank line
      const headingPart = '## Description\n\n';
      const body = descSection.content.slice(headingPart.length);
      if (body.length > 500) {
        const oldTokens = estimateTokens(body);
        const truncated = body.slice(0, 500);
        const newBody = truncated + '\n\u2026[truncated]';
        descSection.content = headingPart + newBody;
        const savedTokens = oldTokens - estimateTokens(newBody);
        dropped.push(`description truncated (\u2212${savedTokens}t)`);
      }
    }
  }

  // ── Priority 4: Remove linked ticket comment bodies ────────────────────────
  if (estimateTokens(joinSections(sections)) > budget) {
    const ltIdx = sections.findIndex(s => s.heading === 'Linked Tickets');
    if (ltIdx !== -1) {
      const ltSection = sections[ltIdx];
      const oldTokens = estimateTokens(ltSection.content);

      // For each linked ticket block, keep only the ### heading line and the
      // **Type:** | **Status:** meta line (first two non-empty lines per block).
      const headingLine = '## Linked Tickets';
      const withoutHeading = ltSection.content.slice(ltSection.content.indexOf('\n') + 1).replace(/^\n/, '');
      const ltBlocks = withoutHeading.split(/\n\n---\n\n/);

      const prunedBlocks = ltBlocks.map(block => {
        if (!block.trim()) return block;
        const lines = block.split('\n');
        // Keep the ### KEY: summary heading line + the meta line
        const kept = lines.filter((l, i) => {
          if (i === 0) return true; // ### heading
          if (l.startsWith('**Type:**')) return true; // meta line
          return false;
        });
        return kept.join('\n');
      });

      ltSection.content = `${headingLine}\n\n${prunedBlocks.join('\n\n---\n\n')}`;
      const saved = oldTokens - estimateTokens(ltSection.content);
      if (saved > 0) {
        dropped.push(`linked ticket comment bodies removed (\u2212${saved}t)`);
      }
    }
  }

  const finalBrief = joinSections(sections);
  const finalTokens = estimateTokens(finalBrief);

  // ── Write drop report to stream ────────────────────────────────────────────
  if (dropped.length > 0) {
    const pruneList = dropped.join(', ');
    streamOut.write(`  \u25cb Budget: ${budget} tokens. Pruned: ${pruneList}\n`);
    streamOut.write(`  \u25cb Final estimate: ${finalTokens} tokens\n`);
  }

  return { pruned: finalBrief, dropped, finalTokens };
}
