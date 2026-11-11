import { fetchTicket, fetchCurrentUser, searchTickets, fetchStatuses, fetchProjects, fetchIssueTypes, fetchProjectPriorities, postComment, getTransitions, postTransition, assignIssue, fetchAssignableUsers, escapeJql, getIssueLinkTypes, postIssueLink, updateIssue, createIssue, DEFAULT_SEARCH_FIELDS } from '../jira-client.mjs';
import { postWorklog } from '../jira-worklog-client.mjs';
import { fetchEpicFieldIds, fetchParentInfo, setIssueParent } from '../jira-parent-client.mjs';
import { uploadAttachment, resolveMediaId } from '../jira-attachment-client.mjs';
import { readAttachments } from '../attachment-uploader.mjs';
import { buildMediaNode } from '../adf-converter.mjs';
import { buildJiraEnv } from '../config.mjs';
import { tokenize } from '../duplicate-scorer.mjs';
import { relationText } from '../ticket-brief-fields.mjs';

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

// Jira's Epic Name field is single-line text capped at 255 characters.
const EPIC_NAME_MAX_CHARS = 255;
// Jira's 400 for a field the project does not have (team-managed project on a site that also has
// company-managed ones) names that field in `errors`. Nothing was written, so retrying without it is safe.
const rejectsField = (err, fieldId) => err?.status === 400 && Object.hasOwn(err.details?.errors ?? {}, fieldId);
const cleanEpicName = (text) => [...String(text ?? '')
  .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
  .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '') // zero-width and bidi controls can spoof what a name says
  .replace(/\s+/g, ' ')
  .trim()]
  .slice(0, EPIC_NAME_MAX_CHARS) // by code point, so an emoji is never cut in half
  .join('')
  .trim();

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

  // The instance's Epic Link and Epic Name field ids, looked up at most once per adapter.
  // A failed lookup is not remembered, so a retry can succeed.
  let epicFieldsLookup;
  const epicFields = (opts) => {
    epicFieldsLookup ??= fetchEpicFieldIds({ ...base, ...opts }).catch((err) => { epicFieldsLookup = undefined; throw err; });
    return epicFieldsLookup;
  };
  // Server/DC only: Cloud sets the parent through its own `parent` field.
  const epicLinkFieldId = async (opts) => (apiVersion === 3 ? null : (await epicFields(opts)).epicLinkFieldId);
  // For reads: a failed lookup means "no Epic Name", never a failed read.
  const epicNameFieldIdOrNull = async (opts) => {
    try { return (await epicFields(opts)).epicNameFieldId; } catch { return null; }
  };
  // For a create: only a definite "you cannot see the fields" (403/404) goes ahead without the name.
  // A timeout, 429, 5xx or 401 throws before anything is written, so a retry cannot leave a nameless epic.
  const epicNameFieldIdForCreate = async (opts) => {
    try { return (await epicFields(opts)).epicNameFieldId; } catch (err) {
      if (err?.status === 403 || err?.status === 404) return null;
      throw err;
    }
  };

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
     * read-only, never assigns. Cloud (v3) and Server/DC (v2) both use
     * `GET .../user/assignable/search`; `fetchAssignableUsers` is already
     * apiVersion-generic (ROADMAP 65) and normalizes both shapes into
     * {accountId, name, displayName} — Cloud populates accountId, Server/DC
     * populates name, this method just passes that through unmodified.
     * Caching (3-day TTL, per project+query) is the caller's job — same
     * split as `listIssueTypes`, which is also cache-agnostic here.
     */
    async searchAssignableUsers(key, query, opts = {}) {
      const users = await fetchAssignableUsers(key, query, { ...base, ...opts });
      return users.map(u => ({ accountId: u.accountId, name: u.name, displayName: u.displayName ?? u.name ?? u.accountId }));
    },

    /**
     * Executes an assignment to a resolved candidate (from
     * `searchAssignableUsers`) — same apiVersion field-resolution pattern
     * `assignToSelf` already uses: accountId for Cloud, name for Server/DC
     * (ROADMAP 65). Never sends a null identity field — Jira's PUT treats
     * that as "unassign", not an error (same reasoning as `assignToSelf`).
     */
    async assignToUser(key, candidate, opts = {}) {
      const field = apiVersion === 3 ? 'accountId' : 'name';
      const value = candidate[field];
      if (!value) {
        throw new Error(`Cannot resolve candidate's ${field} — Jira did not return it for this connection.`);
      }
      await assignIssue(key, { [field]: value }, { ...base, ...opts });
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
     * Reads a link back from Jira after linkTo() wrote it. What Jira stored is
     * ground truth, unlike the type list linkTo() resolved from: backlog #31's
     * link looked right in code and tests and was still stored backwards.
     * depth: 0 fetches only the source ticket, never the tickets it links to.
     * A failed read throws; the caller must not let that undo the write.
     * @returns {Promise<{ sentence: string } | null>} e.g. "PROJ-1 blocks PROJ-2",
     *   or null when no link of that type to targetKey (with a phrase) is found
     */
    async getStoredLink(sourceKey, targetKey, typeName, opts = {}) {
      const source = await fetchTicket(sourceKey, { ...base, ...opts, depth: 0 });
      const wanted = typeName.toLowerCase();
      // Every direction: a reverse link of the same type may already exist, and
      // showing only one of them could pass the wrong one off as the new link.
      const ofType = source.linkedIssues.filter(l => l.linkType?.toLowerCase() === wanted);
      const sentence = relationText({ key: sourceKey, linkedIssues: ofType }, { key: targetKey });
      return sentence ? { sentence } : null;
    },

    /**
     * Cloud always supports a parent. Server/DC supports one only through its
     * "Epic Link" field, so an instance without it is refused up front.
     */
    async checkParentSupport(opts = {}) {
      if (apiVersion === 3) return { supported: true };
      const id = await epicLinkFieldId(opts);
      return id ? { supported: true } : { supported: false, reason: 'this Jira has no "Epic Link" field' };
    },

    /** Type, sub-task flag and current parent/epic of one issue — read-only. */
    async getParentInfo(key, opts = {}) {
      // Only the epic itself is read for its name (`withEpicName`): children never pay for the lookup.
      const epicNameFieldId = opts.withEpicName ? await epicNameFieldIdOrNull(opts) : undefined;
      return fetchParentInfo(key, { ...base, ...opts, epicLinkFieldId: await epicLinkFieldId(opts), epicNameFieldId });
    },

    /**
     * Sets `parentKey` as the epic/parent of `childKey`. Idempotent: setting the
     * same parent twice changes nothing. Never sends a write Server/DC cannot
     * express — a missing Epic Link field is a refusal, not an error.
     */
    async setParent(childKey, parentKey, opts = {}) {
      const id = await epicLinkFieldId(opts);
      if (apiVersion !== 3 && !id) return { executed: false, reason: 'no-epic-link-field' };
      await setIssueParent(childKey, parentKey, { ...base, ...opts, epicLinkFieldId: id });
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
    async updateFields(key, { title, description, priority, addLabels, removeLabels, epicName } = {}, opts = {}) {
      const applied = {};
      const errors = {};
      let extraFields;
      if (epicName !== undefined) {
        // Not best-effort: the caller asked for this field, so a failed lookup must surface.
        const id = (await epicFields(opts)).epicNameFieldId;
        const name = cleanEpicName(epicName);
        if (!id) errors.epicName = { reason: 'not-supported' };
        else if (!name) errors.epicName = { reason: 'empty' };
        else extraFields = { [id]: name };
      }
      const hasNamedFields = title !== undefined || description !== undefined || priority !== undefined || addLabels?.length || removeLabels?.length;
      if (epicName !== undefined && !extraFields && !hasNamedFields) return { applied, errors };

      const write = (fields) => updateIssue(key, { summary: title, description, priority, addLabels, removeLabels, extraFields: fields }, { ...base, ...opts });
      try {
        await write(extraFields);
      } catch (err) {
        if (!extraFields || !rejectsField(err, Object.keys(extraFields)[0])) throw err;
        extraFields = undefined;
        errors.epicName = { reason: 'not-supported' };
        if (hasNamedFields) await write(undefined);
        else return { applied, errors };
      }
      if (title !== undefined) applied.title = true;
      if (description !== undefined) applied.description = true;
      if (priority !== undefined) applied.priority = priority;
      if (addLabels?.length) applied.addLabels = addLabels;
      if (removeLabels?.length) applied.removeLabels = removeLabels;
      if (extraFields) applied.epicName = Object.values(extraFields)[0];
      return { applied, errors };
    },

    /**
     * project/type are passed straight through — never pre-validated
     * client-side, same design choice already made for updateFields'
     * priority field. An invalid issuetype surfaces Jira's own 400.
     */
    async createTicket({ project, type, summary, description, epicName } = {}, opts = {}) {
      // Company-managed Jira keeps the epic's name in its own required-by-the-UI field; without it
      // Jira shows the epic's children as "unlabelled-KEY". Only an Epic (or an explicit
      // epicName, for localized type names) pays for the field lookup.
      const wantsEpicName = epicName !== undefined || /^epic$/i.test(type ?? '');
      const fieldId = wantsEpicName ? await epicNameFieldIdForCreate(opts) : null;
      const name = fieldId ? (cleanEpicName(epicName) || cleanEpicName(summary)) : '';
      const extraFields = name ? { [fieldId]: name } : undefined;
      const create = (fields) => createIssue({ project, type, summary, description, extraFields: fields }, { ...base, ...opts });
      let created;
      let nameSent = Boolean(extraFields);
      try {
        created = await create(extraFields);
      } catch (err) {
        if (!extraFields || !rejectsField(err, fieldId)) throw err;
        created = await create(undefined);
        nameSent = false;
      }
      if (nameSent) return { ...created, epicNameSet: true };
      return epicName !== undefined ? { ...created, epicNameSet: false } : created;
    },

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
      const { files, droppedCount, cap } = readAttachments(filePaths, opts.maxAttachments);
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
      return { uploaded, errors, droppedCount, cap };
    },
  };
}
