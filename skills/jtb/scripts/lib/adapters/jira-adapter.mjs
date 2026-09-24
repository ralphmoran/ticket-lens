import { fetchTicket, fetchCurrentUser, searchTickets, fetchStatuses, fetchProjects, fetchIssueTypes, fetchProjectPriorities, postComment, getTransitions, postTransition, assignIssue, fetchAssignableUsers, escapeJql, getIssueLinkTypes, postIssueLink, updateIssue, createIssue, DEFAULT_SEARCH_FIELDS } from '../jira-client.mjs';
import { postWorklog } from '../jira-worklog-client.mjs';
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
    /**
     * Jira-only — GitHub and Linear have no worklog API, so their adapters
     * deliberately lack this method and ticket-worklog.mjs refuses them
     * before any write. Always logs as the authenticated user.
     */
    logWork: (key, entry, opts = {}) => postWorklog(key, entry, { ...base, ...opts }),
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
     * Resolves a free-text name/email into candidate assignable users —
     * read-only, never assigns. Cloud only (`apiVersion === 3`): Jira
     * Server/DC's equivalent endpoint semantics are unverified, so this
     * refuses rather than guess at request/response shape (ROADMAP 61).
     * Caching (3-day TTL, per project+query) is the caller's job — same
     * split as `listIssueTypes`, which is also cache-agnostic here.
     */
    async searchAssignableUsers(key, query, opts = {}) {
      if (apiVersion !== 3) {
        throw new Error('Assigning to another developer needs Jira Cloud — Server/DC is not supported yet.');
      }
      const users = await fetchAssignableUsers(key, query, { ...base, ...opts });
      return users.map(u => ({ accountId: u.accountId, displayName: u.displayName ?? u.name ?? u.accountId }));
    },

    /**
     * Executes an assignment to a resolved accountId — always Cloud
     * (`searchAssignableUsers` is the only path that produces one), so no
     * apiVersion branch is needed here the way `assignToSelf` has.
     */
    async assignToUser(key, accountId, opts = {}) {
      await assignIssue(key, { accountId }, { ...base, ...opts });
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
     * Returns name+inward+outward (backlog #31), not just the bare name:
     * a bare name forces the caller to guess which end gets which phrase,
     * which is exactly what produced 5 recurring "direction inverted"
     * reports despite linkTo()'s own outward/inward mapping being correct
     * and tested. GitHub/Linear keep returning plain strings — single
     * relation type, no phrase ambiguity there.
     */
    async getLinkTypes(opts = {}) {
      const types = await getIssueLinkTypes({ ...base, ...opts });
      return types.map(t => ({ name: t.name, inward: t.inward, outward: t.outward }));
    },

    /**
     * Always re-fetches link types fresh and resolves `typeName` against
     * them before executing — a caller can never blind-POST a stale or
     * guessed type name, same principle as transition().
     * sourceKey ends up performing the type's outward verb onto targetKey
     * (e.g. "sourceKey duplicates targetKey") — see postIssueLink's own
     * doc comment in jira-client.mjs for why its POST body's field names
     * don't map the way you'd guess from Jira's GET-response convention.
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
     * Real, currently-configured priority options for one project — used
     * only to enrich an `update` failure message, never to pre-validate
     * (see fetchProjectPriorities' own doc for why). Priority has no
     * dedicated list-per-project endpoint, so this walks the project's
     * issue types until one returns a non-empty priority list. NOT every
     * issue type has one: confirmed live against corenexus that a
     * team-managed project's Epic type has no `priority` field in its
     * field metadata at all (real fields returned: assignee, description,
     * labels, ... — priority absent), while its Task type does. An
     * earlier version picked types[0] unconditionally and silently
     * returned [] whenever that happened to be an Epic — caught by a live
     * CLI run against CNV1-34, not by any unit test (every unit test used
     * a hand-picked type). Stops at the first success rather than trying
     * every type, since priority is otherwise scheme-shared across a
     * project's types by Jira's default. Returns [] only once every type
     * has been tried — this can only ever make an error message less
     * informative, never a new way for `update` to fail.
     */
    async listPriorities(projectKey, opts = {}) {
      const types = await fetchIssueTypes(projectKey, { ...base, ...opts });
      for (const type of types) {
        const priorities = await fetchProjectPriorities(projectKey, type.id, { ...base, ...opts });
        if (priorities.length) return priorities;
      }
      return [];
    },

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
