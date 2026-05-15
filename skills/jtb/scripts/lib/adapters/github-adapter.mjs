/**
 * Parses owner and repo from a GitHub profile baseUrl.
 * Expected format: https://github.com/OWNER/REPO
 */
export function parseGitHubRepo(baseUrl) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`Invalid GitHub baseUrl: ${baseUrl}`);
  }
  const parts = url.pathname.replace(/^\//, '').split('/').filter(Boolean);
  if (parts.length < 2) {
    throw new Error(
      `GitHub profile baseUrl must include owner and repo: https://github.com/OWNER/REPO (got: ${baseUrl})`,
    );
  }
  return { owner: parts[0], repo: parts[1] };
}

/**
 * Maps a raw GitHub issue + comments array to the normalized ticket shape.
 * @param {object} raw - GitHub issue object
 * @param {object[]} comments - GitHub issue comments array
 * @param {string} [keyPrefix] - prefix used to construct the ticket key (e.g. 'GH')
 */
export function normalizeGitHubIssue(raw, comments = [], keyPrefix = 'GH') {
  return {
    key: `${keyPrefix}-${raw.number}`,
    summary: raw.title,
    type: 'Issue',
    status: raw.state,
    priority: null,
    assignee: raw.assignees?.[0]?.login ?? raw.assignee?.login ?? null,
    reporter: raw.user?.login ?? null,
    description: raw.body ?? null,
    created: raw.created_at ?? null,
    updated: raw.updated_at ?? null,
    labels: (raw.labels ?? []).map(l => l.name),
    components: [],
    comments: comments.map(c => ({
      author: c.user?.login ?? null,
      authorAccountId: null,
      authorName: c.user?.login ?? null,
      body: c.body ?? '',
      created: c.created_at ?? null,
    })),
    linkedIssues: [],
    attachments: [],
  };
}

const GITHUB_API = 'https://api.github.com';

/**
 * Returns a tracker adapter backed by the GitHub Issues REST API.
 * Profile baseUrl must be https://github.com/OWNER/REPO.
 * Auth token stored as apiToken (or pat) in credentials.json.
 */
export function createGitHubAdapter(conn, { fetcher = globalThis.fetch } = {}) {
  const { owner, repo } = parseGitHubRepo(conn.baseUrl);
  const keyPrefix = conn.ticketPrefixes?.[0] ?? 'GH';
  const token = conn.apiToken || conn.pat;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  return {
    type: 'github',

    async fetchTicket(key, opts = {}) {
      const number = parseInt(key.split('-').pop(), 10);
      const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000);
      const [issueRes, commentsRes] = await Promise.all([
        fetcher(`${GITHUB_API}/repos/${owner}/${repo}/issues/${number}`, { headers, signal }),
        fetcher(`${GITHUB_API}/repos/${owner}/${repo}/issues/${number}/comments`, { headers, signal }),
      ]);
      if (!issueRes.ok) {
        throw new Error(`GitHub API error ${issueRes.status} (${issueRes.statusText}) fetching ${key}`);
      }
      const raw = await issueRes.json();
      const comments = commentsRes.ok ? await commentsRes.json() : [];
      return normalizeGitHubIssue(raw, comments, keyPrefix);
    },

    async fetchCurrentUser(opts = {}) {
      const res = await fetcher(`${GITHUB_API}/user`, {
        headers,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) throw new Error(`GitHub API error ${res.status} fetching current user`);
      const raw = await res.json();
      return { displayName: raw.name || raw.login, email: raw.email ?? null };
    },

    async searchTickets(_query, opts = {}) {
      const res = await fetcher(
        `${GITHUB_API}/repos/${owner}/${repo}/issues?state=open&assignee=me&per_page=50`,
        { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) },
      );
      if (!res.ok) throw new Error(`GitHub API error ${res.status} searching issues`);
      const raw = await res.json();
      return raw.map(issue => normalizeGitHubIssue(issue, [], keyPrefix));
    },

    async fetchStatuses() {
      return ['open', 'closed'];
    },
  };
}
