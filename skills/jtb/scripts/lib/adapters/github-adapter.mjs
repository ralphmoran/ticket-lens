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
 * Classifies a non-OK GitHub write response per GitHub's documented rules
 * (docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api):
 * secondary limits surface via `retry-after` when present; primary limits
 * are exhaustion of `x-ratelimit-remaining` with no `retry-after`. The two
 * need different backoff — conflating them under one "rate limited" error
 * would tell a caller to wait 60s when the real reset might be much later.
 */
function classifyGitHubWriteFailure(response) {
  if (response.status !== 403 && response.status !== 429) {
    return { kind: 'error', status: response.status };
  }
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    return { kind: 'secondary-rate-limit', retryAfterSeconds: Number(retryAfter) };
  }
  if (response.headers.get('x-ratelimit-remaining') === '0') {
    return { kind: 'primary-rate-limit', resetAt: Number(response.headers.get('x-ratelimit-reset')) };
  }
  return { kind: 'secondary-rate-limit', retryAfterSeconds: 60 };
}

async function throwGitHubWriteError(response, action, key) {
  const classification = classifyGitHubWriteFailure(response);
  const err = new Error(`GitHub API error ${response.status} ${action} ${key}`);
  err.status = response.status;
  err.rateLimit = classification.kind !== 'error' ? classification : undefined;
  try { err.details = await response.json(); } catch { /* body not JSON */ }
  throw err;
}

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
      return { displayName: raw.name || raw.login, email: raw.email ?? null, login: raw.login };
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

    async addComment(key, body, opts = {}) {
      const number = parseInt(key.split('-').pop(), 10);
      const res = await fetcher(`${GITHUB_API}/repos/${owner}/${repo}/issues/${number}/comments`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) await throwGitHubWriteError(res, 'commenting on', key);
      const raw = await res.json();
      return { id: String(raw.id), url: raw.html_url ?? null };
    },

    /**
     * GitHub issues have exactly one valid opposite state — not a
     * discoverable workflow like Jira. Reports it in the same
     * {id, name, to} shape as Jira's getTransitions for a uniform
     * cross-tracker adapter contract.
     */
    async getTransitions(key, opts = {}) {
      const ticket = await this.fetchTicket(key, opts);
      return ticket.status === 'open'
        ? [{ id: 'closed', name: 'Close issue', to: 'closed' }]
        : [{ id: 'open', name: 'Reopen issue', to: 'open' }];
    },

    async transition(key, target, opts = {}) {
      const ticket = await this.fetchTicket(key, opts);
      const t = String(target).toLowerCase();
      if (t === ticket.status) {
        return { executed: false, reason: 'already-in-target-state', options: await this.getTransitions(key, opts) };
      }
      const options = await this.getTransitions(key, opts);
      const match = options.find(o => o.id === t || o.name.toLowerCase() === t || o.to === t);
      if (!match) {
        return { executed: false, reason: 'not-found', options };
      }
      const number = parseInt(key.split('-').pop(), 10);
      const res = await fetcher(`${GITHUB_API}/repos/${owner}/${repo}/issues/${number}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: match.to }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) await throwGitHubWriteError(res, 'transitioning', key);
      return { executed: true, to: match.to };
    },

    /**
     * Self-assign only — GitHub's assignees field is an array, but this
     * always replaces it with exactly the caller, mirroring the other
     * adapters' self-assign scope (arbitrary-user assignment deferred).
     */
    async assignToSelf(key, opts = {}) {
      const me = await this.fetchCurrentUser(opts);
      if (!me.login) {
        throw new Error(`Cannot determine current user's login — GitHub did not return it for this connection.`);
      }
      const number = parseInt(key.split('-').pop(), 10);
      const res = await fetcher(`${GITHUB_API}/repos/${owner}/${repo}/issues/${number}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignees: [me.login] }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) await throwGitHubWriteError(res, 'assigning', key);
      return { assignee: me.displayName ?? me.login };
    },
  };
}
