import { fetchTicket, fetchCurrentUser, searchTickets, fetchStatuses, fetchProjects, fetchIssueTypes, postComment, getTransitions, postTransition, assignIssue, escapeJql, getIssueLinkTypes, postIssueLink, updateIssue, createIssue, DEFAULT_SEARCH_FIELDS } from '../jira-client.mjs';
import { uploadAttachment, resolveMediaId } from '../jira-attachment-client.mjs';
import { readAttachments } from '../attachment-uploader.mjs';
import { buildMediaNode } from '../adf-converter.mjs';
import { buildJiraEnv } from '../config.mjs';
import { tokenize } from '../duplicate-scorer.mjs';

/**
 * Finds the option in a fresh transitions list matching a caller-given
 * target — by id (exact) or by name/to-name (case-insensitive). Never
 * trusts a caller-supplied id without confirming it's still a real,
 * currently-valid option for this exact issue right now.
 */
// Jira's `text ~ "..."` operator behaves like phrase/proximity matching, not
// "contains these words" — a single literal phrase over ~40-70 chars silently
// stops matching. Same cap GitHub's findCandidates uses for the same reason
// (tokenize + OR significant terms instead of sending one long phrase).
const CANDIDATE_TERM_LIMIT = 8;
const CANDIDATE_SEARCH_FIELDS = `${DEFAULT_SEARCH_FIELDS},description`;

function resolveTransitionTarget(options, target) {
  const t = String(target).toLowerCase();
  return options.find(o => o.id === String(target) || o.name.toLowerCase() === t || (o.to ?? '').toLowerCase() === t);
}

/**
 * Returns a tracker adapter backed by the Jira REST API.
 * Binds connection credentials so callers never touch jira-client directly.
 */
export function createJiraAdapter(conn, { fetcher = globalThis.fetch } = {}) {
  const env = buildJiraEnv(conn);
  const apiVersion = conn.auth === 'cloud' ? 3 : 2;
  const base = { env, fetcher, apiVersion, allowPrivateIp: conn.allowPrivateIp };

  return {
    type: 'jira',
    fetchTicket: (key, opts = {}) => fetchTicket(key, { ...base, ...opts }),
    fetchCurrentUser: (opts = {}) => fetchCurrentUser({ ...base, ...opts }),
    searchTickets: (query, opts = {}) => searchTickets(query, { ...base, ...opts }),
    fetchStatuses: (opts = {}) => fetchStatuses({ ...base, ...opts }),
    addComment: (key, body, opts = {}) => postComment(key, body, { ...base, ...opts }),
    getTransitions: (key, opts = {}) => getTransitions(key, { ...base, ...opts }),
    /**
     * Always re-fetches transitions fresh and resolves `target` against
     * them before executing — a caller can never blind-POST a stale or
     * guessed transition id, even if they try.
     */
    async transition(key, target, opts = {}) {
      const options = await getTransitions(key, { ...base, ...opts });
      const match = resolveTransitionTarget(options, target);
      if (!match) {
        return { executed: false, reason: 'not-found', options };
      }
      await postTransition(key, match.id, { ...base, ...opts });
      return { executed: true, to: match.to ?? match.name };
    },

    /**
     * Self-assign only — arbitrary-user assignment would need a
     * user-search API this codebase doesn't have yet. Reuses
     * fetchCurrentUser, which already returns both accountId (Cloud)
     * and name (Server/DC).
     */
    async assignToSelf(key, opts = {}) {
      const me = await fetchCurrentUser({ ...base, ...opts });
      const field = apiVersion === 3 ? 'accountId' : 'name';
      const value = me[field];
      // Jira's PUT /issue/{key}/assignee treats a null identity field as
      // "unassign", not an error — it returns 204 either way. Never send
      // it: that would silently unassign the ticket while this command
      // reports success.
      if (!value) {
        throw new Error(`Cannot determine current user's ${field} — Jira did not return it for this connection.`);
      }
      await assignIssue(key, { [field]: value }, { ...base, ...opts });
      return { assignee: me.displayName ?? value };
    },

    /**
     * Candidate search for duplicate-ticket detection. Scoped to the same
     * project as `sourceKey` (derived from its own prefix) and excludes it
     * from results. Jira has no server-side similarity scoring — this only
     * narrows the candidate pool; ranking happens in duplicate-scorer.mjs.
     *
     * Tokenizes and ORs significant terms rather than sending one long
     * phrase — same pattern as github-adapter.mjs and linear-adapter.mjs's
     * findCandidates, both of which already do this (for a different
     * original reason on GitHub's side: query-injection, not this bug).
     * Requests `description` in addition to the default field list so
     * duplicate-scorer.mjs can score on summary+description as designed,
     * not silently degrade to summary-only.
     */
    async findCandidates(text, sourceKey, opts = {}) {
      const hyphenIndex = sourceKey.lastIndexOf('-');
      if (hyphenIndex < 1) {
        throw new Error(`Cannot derive a project key from "${sourceKey}" — expected PROJECT-123.`);
      }
      const terms = tokenize(text).slice(0, CANDIDATE_TERM_LIMIT);
      if (terms.length === 0) return [];
      const project = sourceKey.slice(0, hyphenIndex);
      const textClause = terms.map(term => `text ~ "${escapeJql(term)}"`).join(' OR ');
      const jql = `project = "${escapeJql(project)}" AND key != "${escapeJql(sourceKey)}" AND (${textClause}) ORDER BY updated DESC`;
      // fields is intentionally non-overridable here (unlike every other method's
      // {...base, ...opts} pattern) — candidate search always needs description to
      // score correctly, so a caller-supplied override would silently break scoring.
      return searchTickets(jql, { ...base, ...opts, fields: CANDIDATE_SEARCH_FIELDS });
    },

    /**
     * Always fetched fresh — link type names are per-instance customizable
     * in Jira, same "never trust a stale list" principle as getTransitions.
     * Returns just names (matches GitHub/Linear's plain-string shape) so
     * runTicketLinkList can render any tracker's list uniformly.
     */
    async getLinkTypes(opts = {}) {
      const types = await getIssueLinkTypes({ ...base, ...opts });
      return types.map(t => t.name);
    },

    /**
     * Always re-fetches link types fresh and resolves `typeName` against
     * them before executing — a caller can never blind-POST a stale or
     * guessed type name, same principle as transition().
     * sourceKey is the outwardIssue, targetKey is the inwardIssue — direction matters.
     */
    async linkTo(sourceKey, targetKey, typeName, opts = {}) {
      const types = await getIssueLinkTypes({ ...base, ...opts });
      const match = types.find(t => t.name.toLowerCase() === typeName.toLowerCase());
      if (!match) {
        return { executed: false, reason: 'not-found', options: types.map(t => t.name) };
      }
      await postIssueLink(sourceKey, targetKey, match.name, { ...base, ...opts });
      return { executed: true };
    },

    /**
     * Jira does this in a single atomic PUT (fields + update.labels in one
     * request, confirmed via Jira's own docs) — unlike GitHub, there is no
     * per-field partial-failure surface here: either the whole call
     * succeeds and every requested field is applied, or it throws and
     * ticket-command.mjs's existing formatWriteFailure handles it exactly
     * like every other write. Priority-name validity is not pre-checked —
     * an invalid name surfaces Jira's own 400 with details, same design
     * choice already made for ticket_create's issuetype field.
     */
    async updateFields(key, { title, description, priority, addLabels, removeLabels } = {}, opts = {}) {
      await updateIssue(key, { summary: title, description, priority, addLabels, removeLabels }, { ...base, ...opts });
      const applied = {};
      if (title !== undefined) applied.title = true;
      if (description !== undefined) applied.description = true;
      if (priority !== undefined) applied.priority = priority;
      if (addLabels?.length) applied.addLabels = addLabels;
      if (removeLabels?.length) applied.removeLabels = removeLabels;
      return { applied, errors: {} };
    },

    /**
     * project/type are passed straight through — never pre-validated
     * client-side, same design choice already made for updateFields'
     * priority field. An invalid issuetype surfaces Jira's own 400.
     */
    createTicket: ({ project, type, summary, description } = {}, opts = {}) =>
      createIssue({ project, type, summary, description }, { ...base, ...opts }),

    /**
     * Real, currently-creatable projects for this token — used to enrich a
     * ticket_create failure message with actual options, never to
     * pre-validate before writing.
     */
    listCreatableProjects: (opts = {}) => fetchProjects({ ...base, ...opts }),

    /** Real, currently-configured issue types for one project. */
    listIssueTypes: (projectKey, opts = {}) => fetchIssueTypes(projectKey, { ...base, ...opts }),

    /**
     * Best-effort, per-file: one bad path or one failed upload never blocks
     * the rest (same `{applied/uploaded, errors}` shape convention as
     * updateFields' GitHub label loop). Two different inline-thumbnail
     * mechanisms per apiVersion, both real:
     *  - Server/DC (v2, plain-string bodies): legacy wiki markup
     *    `!filename|thumbnail!`, resolved by filename — returned as
     *    `inlineMarkup`, a plain string the caller appends to body text.
     *  - Cloud (v3, ADF): a real `mediaSingle`/`media` ADF node — returned
     *    as `adfMediaNode`, an object the caller threads through
     *    `postComment`'s `extraAdfNodes`. Requires one extra call
     *    (`resolveMediaId`) to resolve the Media Services UUID; if that
     *    fails, `adfMediaNode` stays null — the classic attachment above
     *    already succeeded and is genuinely visible on the issue either
     *    way, so this failure is swallowed, not surfaced as an error.
     * Both are image-only; non-image files get neither.
     */
    async attachFiles(key, filePaths, opts = {}) {
      const { files, droppedCount } = readAttachments(filePaths);
      const uploaded = [];
      const errors = [];
      for (const f of files) {
        if (!f.ok) {
          errors.push({ path: f.path, message: f.error });
          continue;
        }
        try {
          const result = await uploadAttachment(key, f, { ...base, ...opts });
          const isImage = f.mimeType.startsWith('image/');
          let inlineMarkup = null;
          let adfMediaNode = null;
          if (isImage && apiVersion === 2) {
            inlineMarkup = `!${result.filename}|thumbnail!`;
          } else if (isImage && apiVersion === 3 && result.url) {
            try {
              const mediaId = await resolveMediaId(result.url, { ...base, ...opts });
              adfMediaNode = buildMediaNode(mediaId, key);
            } catch {
              // Enhancement only — see doc comment above.
            }
          }
          uploaded.push({ filename: result.filename, size: result.size, url: result.url, inlineMarkup, adfMediaNode });
        } catch (err) {
          errors.push({ path: f.path, message: err.message });
        }
      }
      return { uploaded, errors, droppedCount };
    },
  };
}
