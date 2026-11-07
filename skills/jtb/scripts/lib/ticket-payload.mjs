/**
 * Shared ticket payload builder used by triage-push and triage-share.
 */

// Console API limits for a pushed ticket (PushRequest.php: labels max 50, each
// max 100 characters). Jira allows far more, and one rejected ticket 422s the
// whole snapshot, so labels are capped before they are sent.
export const PUSH_MAX_LABELS = 50;
export const PUSH_MAX_LABEL_LENGTH = 100;

function pushLabels(raw) {
  if (!Array.isArray(raw?.labels)) return [];
  return raw.labels
    .filter(label => typeof label === 'string' && label !== '')
    .slice(0, PUSH_MAX_LABELS)
    .map(label => label.slice(0, PUSH_MAX_LABEL_LENGTH));
}

export function buildTicketPayload(scored, rawMap, baseUrl) {
  const raw = rawMap?.get(scored.ticketKey);
  return {
    key: scored.ticketKey,
    summary: scored.summary ?? null,
    status: scored.status ?? null,
    assignee: raw?.assignee ?? null,
    priority: raw?.priority ?? null,
    labels: pushLabels(raw),
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
