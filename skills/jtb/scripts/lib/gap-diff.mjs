/**
 * Ephemeral cross-ticket gap-diffing. At brief time, extracts candidate
 * requirements from a ticket's linked tickets (existing depth-traversal,
 * already capped at 15 by jira-client.mjs) and from the ticket's own
 * downloaded attachments, then flags anything not already reflected in the
 * ticket's own description. Nothing here is persisted — every call
 * recomputes from data already attached to the ticket object.
 */

import { extractRequirements } from './requirement-extractor.mjs';
import { analyzeDiff } from './diff-analyzer.mjs';
import { readTextAttachments } from './handoff-assembler.mjs';

function normalizeRequirement(requirement) {
  return requirement.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Flattens a ticket's linkedTicketDetails tree (any depth) into a single
 * list. Guards against a cyclic or malformed graph — a linked ticket that
 * points back into the tree (or at the root ticket itself) must not cause
 * infinite recursion.
 */
function flattenLinked(ticket, seen = new Set([ticket.key])) {
  const out = [];
  for (const linked of ticket.linkedTicketDetails ?? []) {
    if (seen.has(linked.key)) continue;
    seen.add(linked.key);
    out.push(linked);
    out.push(...flattenLinked(linked, seen));
  }
  return out;
}

function isUncovered(requirement, currentDescription) {
  const { results } = analyzeDiff([requirement], currentDescription);
  return results[0]?.status === 'NOT_FOUND';
}

/**
 * @param {object} ticket
 * @returns {{ requirement: string, sourceType: 'ticket'|'attachment', sourceKey: string, sourceSummary?: string }[]}
 */
export function computeGaps(ticket) {
  const currentDescription = ticket.description ?? '';
  const seenRequirements = new Set();
  const gaps = [];

  const addGap = (requirement, sourceType, sourceKey, sourceSummary) => {
    const normalized = normalizeRequirement(requirement);
    if (seenRequirements.has(normalized)) return;
    if (!isUncovered(requirement, currentDescription)) return;
    seenRequirements.add(normalized);
    gaps.push({ requirement, sourceType, sourceKey, sourceSummary });
  };

  for (const linked of flattenLinked(ticket)) {
    for (const requirement of extractRequirements(linked.description ?? '')) {
      addGap(requirement, 'ticket', linked.key, linked.summary);
    }
  }

  for (const { filename, content } of readTextAttachments(ticket.localAttachments)) {
    for (const requirement of extractRequirements(content)) {
      addGap(requirement, 'attachment', filename, undefined);
    }
  }

  return gaps;
}
