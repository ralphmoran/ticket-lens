/**
 * Jira REST API client supporting Cloud and Server/Data Center.
 * Normalizes responses into a consistent shape.
 */

export function normalizeTicket(raw) {
  const f = raw.fields;
  return {
    key: raw.key,
    summary: f.summary,
    type: f.issuetype?.name ?? null,
    status: f.status?.name ?? null,
    priority: f.priority?.name ?? null,
    assignee: f.assignee?.displayName ?? null,
    reporter: f.reporter?.displayName ?? null,
    description: f.description ?? null,
    created: f.created ?? null,
    updated: f.updated ?? null,
    labels: f.labels ?? [],
    components: (f.components ?? []).map(c => c.name),
    comments: (f.comment?.comments ?? []).map(c => ({
      author: c.author?.displayName ?? c.author?.name ?? null,
      body: c.body,
      created: c.created,
    })),
    linkedIssues: (f.issuelinks ?? []).map(link => {
      const direction = link.outwardIssue ? 'outward' : 'inward';
      const issue = link.outwardIssue ?? link.inwardIssue;
      return {
        direction,
        linkType: link.type.name,
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status?.name ?? null,
        type: issue.fields.issuetype?.name ?? null,
      };
    }),
    attachments: (f.attachment ?? []).map(a => ({
      filename: a.filename,
      size: a.size,
    })),
  };
}

export function buildAuthHeader(env) {
  if (env.JIRA_PAT) {
    return { Authorization: `Bearer ${env.JIRA_PAT}` };
  }
  const encoded = Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64');
  return { Authorization: `Basic ${encoded}` };
}

export async function fetchTicket(ticketKey, opts = {}) {
  const { env = process.env, fetcher = globalThis.fetch, depth = 1, _visited = new Set(), _currentDepth = 0 } = opts;
  const baseUrl = env.JIRA_BASE_URL.replace(/\/$/, '');
  const headers = { ...buildAuthHeader(env), 'Content-Type': 'application/json' };

  const url = `${baseUrl}/rest/api/2/issue/${ticketKey}`;
  const response = await fetcher(url, { headers });

  if (!response.ok) {
    throw new Error(`Jira API error ${response.status} (${response.statusText}) fetching ${ticketKey}`);
  }

  const raw = await response.json();
  const ticket = normalizeTicket(raw);
  _visited.add(ticketKey);

  if (_currentDepth < depth) {
    const linkedKeys = ticket.linkedIssues
      .map(l => l.key)
      .filter(k => !_visited.has(k));

    const MAX_TICKETS = 15;
    ticket.linkedTicketDetails = [];

    for (const linkedKey of linkedKeys) {
      if (_visited.size >= MAX_TICKETS) break;
      const linkedTicket = await fetchTicket(linkedKey, {
        env, fetcher, depth, _visited, _currentDepth: _currentDepth + 1,
      });
      ticket.linkedTicketDetails.push(linkedTicket);
    }
  }

  return ticket;
}
