/**
 * Failure-message enrichment for `ticket_update`'s priority field —
 * reactive only, never runs on the success path. Same structure as
 * ticket-create-enrichment.mjs's project/issuetype enrichment; kept as a
 * separate file (not merged into that one) since the two enrich different
 * fields for a different write and share no state beyond the cache module.
 */

import { SINGLE_PROJECT_TTL_MS, isFresh, mergeProjectPriorities } from './ticket-metadata-cache.mjs';

/**
 * Detects whether an update failure is shaped like a bad priority name —
 * the only case this enrichment applies to. Jira surfaces this via its
 * own real `err.details.errors.priority` key, confirmed by direct
 * observation against a live Cloud instance (corenexus) and a live
 * Server/DC instance (advent) on 2026-09-24. Anything else (rate limits,
 * network errors, generic 4xx/5xx, a title/description/label failure)
 * returns false — enrichment never applies there.
 */
export function detectPriorityError(err) {
  return Boolean(err?.details?.errors && 'priority' in err.details.errors);
}

/**
 * Best-effort failure-message enrichment for ticket_update's priority
 * field — reactive only, never runs on the success path or for a
 * non-priority failure. Reuses a cached per-project priority listing when
 * fresh (no extra network call); refreshes it when missing/stale. A
 * refresh failure is swallowed entirely and nothing is written to the
 * cache: this can only ever make an error message MORE informative, never
 * introduce a new way for ticketlens update to fail or a new way to
 * poison the cache. Jira-only — GitHub has no priority field (refused
 * upstream in ticket-command.mjs) and Linear already returns a structured,
 * local `{reason:'not-found', options}` error with no network round trip.
 *
 * Freshness is keyed on the timestamp existing, not on the cached array
 * having entries — a project with no priority-capable issue type at all
 * genuinely caches `[]`, and `[].length` is falsy, so gating on length
 * would re-walk every issue type (adapter.listPriorities' own sequential
 * per-type loop) on every single subsequent failed update, forever,
 * never respecting SINGLE_PROJECT_TTL_MS. Caught in code review before
 * shipping — the sibling ticket-create-enrichment.mjs has this same
 * length-gated pattern for issueTypesByProject, not fixed here since its
 * refresh is a single call, not a sequential loop.
 */
export async function enrichUpdateFailure(err, { adapter, projectKey, profileName, configDir, readMetadataCacheFn, writeMetadataCacheFn }) {
  if (!detectPriorityError(err) || adapter.type !== 'jira' || !projectKey) return '';

  let cached = readMetadataCacheFn(profileName, configDir);
  const hasFreshPriorities = cached?.prioritiesByProject?.[projectKey] !== undefined
    && isFresh(cached?.prioritiesFetchedAt?.[projectKey], SINGLE_PROJECT_TTL_MS);

  if (!hasFreshPriorities) {
    try {
      const { prioritiesByProject, prioritiesFetchedAt } = mergeProjectPriorities(cached, projectKey, await adapter.listPriorities(projectKey));
      cached = { ...cached, prioritiesByProject, prioritiesFetchedAt };
      writeMetadataCacheFn(profileName, cached, configDir);
    } catch {
      return '';
    }
  }

  const priorities = cached?.prioritiesByProject?.[projectKey];
  if (!priorities?.length) return '';
  return `  Known priorities for ${projectKey}: ${priorities.map(p => p.name).join(', ')}.\n`;
}
