import { tokenize } from '../duplicate-scorer.mjs';

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
    id: raw.id,
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

    /**
     * Candidate search for duplicate-ticket detection via GitHub's search
     * endpoint (distinct from the issues-list endpoint `searchTickets` uses,
     * which hardcodes "assigned to me" and ignores its query argument).
     * Excludes the source issue and returns unranked candidates —
     * duplicate-scorer.mjs does the actual similarity ranking.
     *
     * Never interpolates raw ticket text into `q` — GitHub parses the
     * decoded query with its own qualifier grammar (`repo:`, `org:`, `is:`,
     * etc, space-delimited), and multiple `repo:`/`org:` qualifiers are
     * OR'd together. A crafted title/description containing e.g.
     * `repo:otherorg/private-repo` would widen the search to a repo outside
     * this profile's scope — a confused-deputy query-injection, not just a
     * cosmetic bug. tokenize() strips all non-letter/digit characters
     * (including `:`), so no qualifier syntax survives into `q`, and its
     * cap keeps the query well under GitHub's search length limit.
     */
    async findCandidates(text, sourceKey, opts = {}) {
      const sourceNumber = parseInt(sourceKey.split('-').pop(), 10);
      const terms = tokenize(text).slice(0, 8).join(' ');
      const q = `repo:${owner}/${repo} is:issue ${terms}`;
      const url = `${GITHUB_API}/search/issues?q=${encodeURIComponent(q)}`;
      const res = await fetcher(url, { headers, signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000) });
      if (!res.ok) await throwGitHubWriteError(res, 'searching', sourceKey);
      const raw = await res.json();
      return raw.items
        .filter(item => item.number !== sourceNumber)
        .map(item => normalizeGitHubIssue(item, [], keyPrefix));
    },

    /**
     * GitHub has no generic link-type concept — "duplicate" (via closing
     * the source issue) is the only relationship it supports natively.
     */
    async getLinkTypes() {
      return ['duplicate'];
    },

    /**
     * GitHub's only real "link" action closes sourceKey as a duplicate of
     * targetKey — asymmetric and state-changing, unlike Jira/Linear's pure
     * relationship-add. Resolves targetKey's internal id via fetchTicket
     * (GitHub's duplicate_issue_id wants the internal id, not the
     * repo-local number).
     */
    async linkTo(sourceKey, targetKey, typeName, opts = {}) {
      if (typeName.toLowerCase() !== 'duplicate') {
        throw new Error(`GitHub only supports linking as a duplicate — got type "${typeName}".`);
      }
      const target = await this.fetchTicket(targetKey, opts);
      const sourceNumber = parseInt(sourceKey.split('-').pop(), 10);
      const res = await fetcher(`${GITHUB_API}/repos/${owner}/${repo}/issues/${sourceNumber}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'closed', state_reason: 'duplicate', duplicate_issue_id: target.id }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) await throwGitHubWriteError(res, 'linking', sourceKey);
      return { executed: true, closedAsDuplicateOf: targetKey };
    },

    /**
     * Unlike Jira/Linear's single atomic mutation, GitHub genuinely has no
     * one-call way to do this: title/description share a PATCH, but labels
     * use their own dedicated additive (POST) and per-label (DELETE)
     * endpoints — never the full-replace PUT, which would force an unsafe
     * read-then-write race. Each operation is independent and best-effort:
     * one failing must never prevent the others from being attempted, and
     * the caller needs to know exactly which fields actually landed.
     */
    async updateFields(key, { title, description, priority, addLabels, removeLabels } = {}, opts = {}) {
      if (priority !== undefined) {
        throw new Error('GitHub Issues have no native priority field — cannot update priority.');
      }
      const number = parseInt(key.split('-').pop(), 10);
      const signal = () => AbortSignal.timeout(opts.timeoutMs ?? 10_000);
      const applied = {};
      const errors = {};

      if (title !== undefined || description !== undefined) {
        try {
          const body = {};
          if (title !== undefined) body.title = title;
          if (description !== undefined) body.body = description;
          const res = await fetcher(`${GITHUB_API}/repos/${owner}/${repo}/issues/${number}`, {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: signal(),
          });
          if (!res.ok) await throwGitHubWriteError(res, 'updating', key);
          if (title !== undefined) applied.title = true;
          if (description !== undefined) applied.description = true;
        } catch (err) {
          if (title !== undefined) errors.title = err;
          if (description !== undefined) errors.description = err;
        }
      }

      if (addLabels?.length) {
        try {
          const res = await fetcher(`${GITHUB_API}/repos/${owner}/${repo}/issues/${number}/labels`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ labels: addLabels }),
            signal: signal(),
          });
          if (!res.ok) await throwGitHubWriteError(res, 'adding labels to', key);
          applied.addLabels = addLabels;
        } catch (err) {
          errors.addLabels = err;
        }
      }

      if (removeLabels?.length) {
        const removed = [];
        const removeErrors = {};
        for (const label of removeLabels) {
          try {
            const res = await fetcher(`${GITHUB_API}/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`, {
              method: 'DELETE',
              headers,
              signal: signal(),
            });
            // A 404 here means the label was already absent — the caller's
            // goal ("this label is gone") is already true, so this is
            // treated as success, not a failure to surface.
            if (!res.ok && res.status !== 404) await throwGitHubWriteError(res, 'removing a label from', key);
            removed.push(label);
          } catch (err) {
            removeErrors[label] = err;
          }
        }
        if (removed.length) applied.removeLabels = removed;
        if (Object.keys(removeErrors).length) errors.removeLabels = removeErrors;
      }

      return { applied, errors };
    },

    /**
     * `project`/`type` are ignored — GitHub has no such concepts here: the
     * target repo is fixed by the profile's baseUrl, and issues have no
     * type field in this MVP scope.
     */
    async createTicket({ summary, description } = {}, opts = {}) {
      const body = { title: summary };
      if (description !== undefined) body.body = description;
      const res = await fetcher(`${GITHUB_API}/repos/${owner}/${repo}/issues`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
      if (!res.ok) await throwGitHubWriteError(res, 'creating an issue in', `${owner}/${repo}`);
      const raw = await res.json();
      return { key: `${keyPrefix}-${raw.number}`, id: String(raw.id), url: raw.html_url ?? null };
    },
  };
}
