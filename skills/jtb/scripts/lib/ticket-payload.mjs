/**
 * Shared ticket payload builder used by triage-push and triage-share.
 */

export function buildTicketPayload(scored, rawMap, baseUrl) {
  const raw = rawMap?.get(scored.ticketKey);
  return {
    key: scored.ticketKey,
    summary: scored.summary ?? null,
    status: scored.status ?? null,
    assignee: raw?.assignee ?? null,
    attention_score: null,
    flags: scored.urgency === 'clear' ? [] : [scored.urgency],
    // last_comment_at feeds server-side response-time metrics (F19c).
    // null for custom-rule overrides (urgency forced without a real comment).
    last_comment_at: scored.lastComment?.created ?? null,
    compliance_coverage: null,
    compliance_status: 'unknown',
    url: baseUrl ? `${baseUrl}/browse/${scored.ticketKey}` : null,
    last_updated: raw?.updated ?? null,
  };
}
