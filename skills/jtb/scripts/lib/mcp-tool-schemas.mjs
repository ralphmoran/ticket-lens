/**
 * JSON-RPC `tools/list` schema definitions for every MCP tool `mcp-server.mjs`
 * exposes. Pure data — no logic, no imports — extracted out of mcp-server.mjs
 * to keep that file under the project's 800-line cap. Order here is the order
 * clients see in `tools/list`.
 */
export const TOOLS = [
  {
    name: 'fetch',
    description: 'Fetch a ticket\'s full context brief (Jira/GitHub/Linear) — description, comments, linked tickets, code references, attachments. The core read action; free tier. Not a discovery tool — requires a known ticket key.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Ticket key, e.g. PROJ-123.' },
        profile: { type: 'string', description: 'Connection profile to target, overriding folder-based inference and the default profile.' },
        depth: { type: 'number', description: 'How many hops of linked tickets to traverse. Defaults to 1 (direct links only). 0 disables traversal.' },
      },
      required: ['ticket'],
    },
  },
  {
    name: 'triage',
    description: 'Scan assigned tickets and surface what needs attention — replies owed, aging tickets, stale-status tickets. The base scan is free tier; some options require a TicketLens Pro or Team license.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'string', description: 'Connection profile to target, overriding folder-based inference and the default profile.' },
        stale: { type: 'number', description: 'Days before an untouched ticket counts as aging. Defaults to 5.' },
        status: { type: 'array', items: { type: 'string' }, description: 'Statuses to include, overriding the profile default / built-in defaults (In Progress, Code Review, QA).' },
        sort: { type: 'string', description: 'Sort order for results, overriding the profile default.' },
        save: { type: 'string', description: 'Write the plain-text summary to this local file path instead of (in addition to) returning it. Requires a TicketLens Pro license.' },
        all: { type: 'boolean', description: 'Triage every configured profile, not just the resolved one. Requires a TicketLens Pro license.' },
        digest: { type: 'boolean', description: 'Deliver the scored results to the digest backend instead of returning them as text — on success, no summary is returned, only a delivery confirmation. Requires a TicketLens Pro license.' },
        assignee: { type: 'string', description: 'View another user\'s tickets instead of your own. Requires a TicketLens Team license.' },
        sprint: { type: 'string', description: 'Scope to a named sprint. Requires a TicketLens Team license.' },
        export: { type: 'string', enum: ['csv', 'json'], description: 'Write results to a file in this format instead of returning the summary text, returning the written file path instead. Requires a TicketLens Team license.' },
        project: { type: 'string', description: 'Scope to a project/team key. Requires a TicketLens Team license.' },
        label: { type: 'array', items: { type: 'string' }, description: 'Scope to one or more labels. Requires a TicketLens Team license.' },
        priority: { type: 'string', description: 'Scope to a priority name, e.g. "High". Requires a TicketLens Team license.' },
      },
    },
  },
  {
    name: 'compliance',
    description: 'Check a ticket\'s acceptance-criteria coverage against the current git diff — extracts requirements from the ticket description, matches them against code changes, and reports a coverage percentage plus what\'s missing. Read-only; the same check `ticketlens install-hooks` runs automatically. Free tier: 3 checks per month; TicketLens Pro removes the limit.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Ticket key, e.g. PROJ-123.' },
        profile: { type: 'string', description: 'Connection profile to target, overriding folder-based inference and the default profile.' },
      },
      required: ['ticket'],
    },
  },
  {
    name: 'review',
    description: 'Assemble PR review context from the current git branch — changed files, linked-ticket summaries, and (Pro) a requirements-coverage / review-focus section extracted from the diff against acceptance criteria. Read-only; never modifies the tracker or the repo. Free tier gets branch info, changed files, and ticket context; TicketLens Pro adds the requirements-coverage and review-focus sections — same split as the `compliance` tool.',
    inputSchema: {
      type: 'object',
      properties: {
        base: { type: 'string', description: 'Base branch to diff against. Auto-detects main/master/develop when omitted. Alias of `branch` — if both are given, `base` wins.' },
        branch: { type: 'string', description: 'Alias for `base` — same effect, provided for parity with the CLI\'s `--branch=` flag.' },
        profile: { type: 'string', description: 'Connection profile to target, overriding folder-based inference and the default profile.' },
      },
    },
  },
  {
    name: 'standup',
    description: 'Summarize recent git commits grouped by linked ticket — a standup update or, with format:"pr", PR-body-style formatting. Read-only, fully free tier — no license gate on any option.',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: 'string', description: 'How far back to scan — an integer number of hours ("24") or a git-compatible date expression ("3 days ago"). Defaults to 24 hours.' },
        format: { type: 'string', enum: ['standup', 'pr'], description: 'Output shape: "standup" (default) groups commits under a per-ticket standup update; "pr" renders the same grouped commits as PR-body-style markdown.' },
        profile: { type: 'string', description: 'Connection profile to target, overriding folder-based inference and the default profile.' },
      },
    },
  },
  {
    name: 'pr',
    description: 'Assemble a ready-to-paste PR description for a ticket — what changed (from linked commits), linked tickets, and (if the ticket has acceptance criteria) a requirements-coverage section. Read-only. The requirements-coverage section reuses the same Free-tier 3-checks/month counter as the `compliance` tool — calling `pr` on a ticket with acceptance criteria counts against that shared monthly limit; TicketLens Pro removes the cap.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Ticket key, e.g. PROJ-123.' },
        profile: { type: 'string', description: 'Connection profile to target, overriding folder-based inference and the default profile.' },
      },
      required: ['ticket'],
    },
  },
  {
    name: 'stats',
    description: 'Show response-time and triage-cadence metrics from local triage history — average/median response time, clear rate, triage run count, current urgency breakdown. Read-only, entirely local — no network call. Free tier: 7-day lookback max; TicketLens Pro extends it to 30 days.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: { type: 'string', description: 'Connection profile to target, overriding folder-based inference and the default profile.' },
        days: { type: 'number', description: 'Lookback window in days. Defaults to 7. Free tier is silently capped at 7; TicketLens Pro allows up to 30.' },
        format: { type: 'string', enum: ['plain', 'json'], description: 'Output shape: "plain" (default) is a human-readable table; "json" is structured for scripting.' },
      },
    },
  },
  {
    name: 'history',
    description: 'Show a ticket\'s urgency timeline from local triage history — every prior triage scan that surfaced it, with the urgency level and reason computed at that point in time. Read-only, entirely local — no network call. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Ticket key, e.g. PROJ-123.' },
      },
      required: ['ticket'],
    },
  },
  {
    name: 'collisions',
    description: 'Show branches where your changed files overlap with a teammate\'s — compares your current branch against teammates\' recent branches (within 7 days) pushed via `ticketlens triage --push`. Requires `ticketlens login` (Console access) and a TicketLens Team license.',
    inputSchema: {
      type: 'object',
      properties: {
        json: { type: 'boolean', description: 'Return a raw JSON array of collision objects instead of a formatted report.' },
        plain: { type: 'boolean', description: 'Plain text output with no ANSI colour.' },
      },
    },
  },
  {
    name: 'doctor',
    description: 'Diagnose common TicketLens problems: profile configuration, license freshness, tracker connectivity, attachment cache health, MCP registration, and the Recall sync queue. Always returns structured JSON. Free tier, fully unrestricted — including fix.',
    inputSchema: {
      type: 'object',
      properties: {
        fix: { type: 'boolean', description: 'Attempt safe, non-destructive repairs for failing checks.' },
        profile: { type: 'string', description: 'Scope profile/connectivity/cache checks to one profile.' },
      },
    },
  },
  {
    name: 'recall_add',
    description: 'Save a Recall note — a gotcha, root cause, or non-obvious decision learned this session. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short one-line title.' },
        ticket: { type: 'string', description: 'Optional ticket key, e.g. PROJ-123.' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags derived from this note\'s actual content — the specific technology, error type, root cause, or affected component (e.g. "retry-backoff", "null-pointer", "auth-middleware"). Never the project name or a generic category word like "gotcha" or "bug" — those provide no search signal to someone else looking for this note later. A tag that just restates the title in different words, or one you cannot trace to a specific sentence in the body, gives that same zero signal — if you cannot point to the exact phrase that justifies it, drop it.' },
        body: { type: 'string', description: 'The note body — one or more paragraphs.' },
      },
      required: ['title', 'body'],
    },
  },
  {
    name: 'recall_search',
    description: 'Search saved Recall notes by free-text query or ticket key. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free-text query or a ticket key like PROJ-123.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'ticket_comment',
    description: 'Post a comment to a ticket in its tracker (Jira/GitHub/Linear). Destructive — writes directly to the live tracker, not a local Recall note. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Ticket key, e.g. PROJ-123.' },
        body: { type: 'string', description: 'Comment body.' },
        attachments: { type: 'array', items: { type: 'string' }, description: 'Local file paths to attach — images render as a real inline thumbnail in the posted comment on both Jira (Cloud and Server/Data Center) and Linear. Not supported on GitHub — no PAT-compatible upload API exists there.' },
      },
      required: ['ticket', 'body'],
    },
  },
  {
    name: 'ticket_transition',
    description: 'List or execute a ticket status transition in its tracker (Jira/GitHub/Linear). Called with only `ticket`, lists the tracker\'s current valid options without changing anything. Destructive when `target` and `confirm: true` are both given — requires confirmation and writes directly to the live tracker. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Ticket key, e.g. PROJ-123.' },
        target: { type: 'string', description: 'Target status/transition name. Omit to just list the tracker\'s current valid options.' },
        confirm: { type: 'boolean', description: 'Must be true, alongside `target`, to actually execute the transition — a nudge and audit trail, not just a formality.' },
      },
      required: ['ticket'],
    },
  },
  {
    name: 'ticket_assign',
    description: 'Assign a ticket to yourself in its tracker (Jira/GitHub/Linear). Self-assign only — assigning to someone else is not supported yet. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Ticket key, e.g. PROJ-123.' },
        to: { type: 'string', description: 'Who to assign to — currently only "me" is accepted.' },
      },
      required: ['ticket', 'to'],
    },
  },
  {
    name: 'ticket_duplicates',
    description: 'Find likely duplicate tickets in the same project (Jira/GitHub/Linear). Read-only — never links or changes anything. On Jira, any ticket already linked as a "Duplicate" is always included first (a confirmed relationship, not a guess); everything else comes from a local, approximate title/description overlap score, since no tracker scores similarity server-side. That scorer can miss real duplicates as easily as it over-matches, so an empty result means none were found, not a guarantee that none exist. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Ticket key, e.g. PROJ-123.' },
        threshold: { type: 'number', description: 'Minimum match score 0-1 to report. Defaults to 0.35.' },
      },
      required: ['ticket'],
    },
  },
  {
    name: 'ticket_link',
    description: 'List or execute a link between two tickets in their tracker (Jira/GitHub/Linear). Called with only `ticket`/`target`, lists the tracker\'s current valid link types without changing anything. Destructive when `type` and `confirm: true` are both given — writes directly to the live tracker. Direction matters: `ticket` "types" `target` (e.g. ticket duplicates target). On GitHub, executing CLOSES `ticket` as a duplicate of `target` — a state change, not just a relationship add like Jira/Linear. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Source ticket key, e.g. PROJ-123 — the one that "types" target.' },
        target: { type: 'string', description: 'Target ticket key, e.g. PROJ-456.' },
        type: { type: 'string', description: 'Link type name (from the list). Omit to just list the tracker\'s current valid options. GitHub only supports "duplicate".' },
        confirm: { type: 'boolean', description: 'Must be true, alongside `type`, to actually execute the link — a nudge and audit trail, not just a formality.' },
      },
      required: ['ticket', 'target'],
    },
  },
  {
    name: 'ticket_update',
    description: 'Update a narrow, named field set on a ticket in its tracker (Jira/GitHub/Linear) — title, description, labels, priority. At least one field is required. Labels are add/remove, never a wholesale replace: an unnamed existing label is left alone. No discovery step and no confirm required — these are reversible metadata edits, not workflow-state changes. GitHub has no priority field; passing `priority` for a GitHub-tracked ticket is refused. A call can partially succeed (e.g. title updates but a label does not resolve) — the result reports exactly what landed. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: { type: 'string', description: 'Ticket key, e.g. PROJ-123.' },
        title: { type: 'string', description: 'New title/summary. Omit to leave unchanged.' },
        description: { type: 'string', description: 'New description. Omit to leave unchanged.' },
        addLabels: { type: 'array', items: { type: 'string' }, description: 'Labels to add. Existing labels not named here are left alone.' },
        removeLabels: { type: 'array', items: { type: 'string' }, description: 'Labels to remove.' },
        priority: { type: 'string', description: 'New priority name, e.g. "High". Not supported on GitHub.' },
      },
      required: ['ticket'],
    },
  },
  {
    name: 'ticket_create',
    description: 'Create a new ticket in a tracker (Jira/GitHub/Linear) with a fixed minimal field set — no arbitrary custom fields. Architecturally unlike every other ticket-write tool: there is no existing ticket to target, so the target tracker/project is picked by the connection profile rather than a ticket key. `project` is the Jira project key or Linear team key — required for both, ignored on GitHub (its repo is fixed by the profile). `type` is the Jira issue type — required for Jira only, ignored elsewhere. Highest blast radius of the ticket-write family: a bad project/type fabricates a real, hard-to-walk-back item in a live tracker. Requires a TicketLens Pro license.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Jira project key or Linear team key. Required for Jira/Linear; ignored on GitHub.' },
        type: { type: 'string', description: 'Jira issue type, e.g. "Task" or "Bug". Required for Jira only; ignored on GitHub/Linear.' },
        summary: { type: 'string', description: 'Ticket title/summary.' },
        description: { type: 'string', description: 'Ticket description. Omit for none.' },
        attachments: { type: 'array', items: { type: 'string' }, description: 'Local file paths to attach, uploaded after the ticket is created. On Linear the image is automatically linked into the description. On Jira it becomes a real, visible attachment on the issue, but is not embedded inline in the initial description (use ticket_comment afterward for an inline thumbnail). Not supported on GitHub.' },
        profile: { type: 'string', description: 'Connection profile to target, overriding folder-based inference and the default profile. Use this when `project` belongs to a profile other than the one auto-resolved from the current working directory.' },
      },
      required: ['summary'],
    },
  },
];
