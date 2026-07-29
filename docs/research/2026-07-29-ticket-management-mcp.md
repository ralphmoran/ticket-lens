# Ticket Management for TicketLens's MCP Server — Research & Proposal

**Status:** Research complete. Not planned/approved for implementation. Resolves the "unscoped" state of [[project_ticket_crud_backlog_2026_07_27]] with a concrete, evidence-based proposal — scope still needs explicit user approval before any code is written.

**Origin:** User's own daily-workflow request (2026-07-27), reopening a 2026-03-12 rejection ("market saturated, dilutes read-side-intelligence positioning, recommend jira-cli instead"). Revisited now specifically in light of the shipped MCP server (`ticketlens mcp`, v0.22.0/v0.23.0) — the question isn't just "should TicketLens do ticket CRUD" anymore, it's "should ticket actions be exposed as MCP tools."

---

## 10-iteration research loop (scored, web-verified)

1. **4/10** — naive brainstorm: every CRUD verb (create, read, update, delete, assign, link, comment, transition, watch, label, attach). Unfiltered, no competitive check.
2. **6/10** — checked the real competitive bar. **jira-cli** (ankitpokhrel, 5.1K★, free OSS): create, multi-field edit, transition/move+comment, assign — mature, comprehensive, years of edge-case handling. **Atlassian's own official MCP server** (Rovo, GA Feb 2026, hosted at `mcp.atlassian.com`): 16 Jira tools — JQL search, read issues/metadata, create issues, edit fields, transition status, add comments, log work, bulk create/update. Critically: **no delete-issue tool** (and no delete-page tool for Confluence either) — explicitly documented as "a sensible blast-radius decision" by Atlassian itself. Strongest single piece of evidence in the whole research — the best-resourced possible competitor deliberately excludes delete.
3. **6.8/10** — re-examined TicketLens's actual wedge against that competitor: tracker-agnostic (Jira Server/DC + GitHub Issues + Linear, via adapters already built in this codebase) vs. Atlassian's Jira/Confluence/Bitbucket/Compass-only, **cloud-only** MCP (per existing `project_competitive.md`: "No Jira Server or Data Center support (cloud-only OAuth)"). A uniform ticket-action interface across trackers is something Atlassian's own tool structurally cannot be. That's the real differentiation — not feature-parity catch-up on Jira Cloud specifically.
4. **7.3/10** — tie actions to TicketLens's existing intelligence instead of shipping generic CRUD: a transition tool that runs the existing compliance check before allowing a move to Done/Resolved; an assign tool informed by existing collision-detection data. Directly answers the original rejection's "no habit loop, doesn't compound with existing value" concern.
5. **7.8/10** — ordered by the original rejection's strongest technical worry ("custom fields, workflow transitions, screen schemes = months of edge-case debugging"). Comment and transition (via each tracker's own transition/state metadata, never hardcoded workflow assumptions) are the lowest-complexity, lowest-risk actions. Arbitrary custom-field creation is the highest-complexity, highest-risk end. Proposed MVP order: **comment → transition** → assign → link → create (fixed minimal fields) → update (narrow named-field set only). Delete and arbitrary custom fields explicitly excluded from MVP.
6. **8.2/10** — tier fit: gate behind Pro+ (parallel to Recall/compliance), not Free. This is an "act," not "read faster" lever — addresses the original "weak conversion lever" concern directly.
7. **8.5/10** — MCP tool-design shape: separate granular tools (`ticket_comment`, `ticket_transition`, `ticket_assign`, `ticket_link`, `ticket_create`, `ticket_update`) rather than one dispatcher tool — matches Atlassian's own 16-discrete-tools precedent, keeps per-action tier-gating/audit-logging clean.
8. **8.8/10** — write actions hit a *live customer system*, categorically different from Phase 1's local-only Recall vault. Needs confirmation/`--dry-run` semantics by default (same convention already established by `note add`/`mcp install`), clear audit logging (ties into the already-shipped `AuditService`), and explicit rate-limit awareness — the Atlassian research itself flagged bulk writes burning through Jira's points-based quota fast.
9. **9.1/10** — security bar is higher than Phase 1's Recall tools precisely because of that last point: a tool that can mutate a customer's real tickets is a materially more attractive target for a poisoned/malicious instruction (2026 MCP tool-poisoning landscape, researched in Phase 1). Needs narrow, named parameter schemas per tool — never a raw-payload passthrough an AI could use to smuggle unintended field changes — and likely a Team-manager-configurable allowlist of which actions are even enabled, mirroring the existing Console permission-bit pattern.
10. **9.4/10 — STOP (cap reached).** Held short of 10 honestly: writing to a live external system is a higher, not fully eliminable risk class than Phase 1's local vault. Real production hardening (per-tracker adapter testing, rate-limit handling, confirmation UX) is still required before "planned" becomes "done."

## Proposed MCP tool list

| Tool | Action | Tier | Notes |
|---|---|---|---|
| `ticket_comment` | Add a comment | Pro+ | Lowest complexity/risk — first to build |
| `ticket_transition` | Move status via the tracker's own transition/state metadata | Pro+ | Optionally runs existing compliance check before a move to Done/Resolved |
| `ticket_assign` | Assign/reassign | Pro+ | Optionally cross-checks existing collision-detection data |
| `ticket_link` | Link two tickets (blocks/relates/duplicates) | Pro+ | |
| `ticket_create` | Create, fixed minimal field set (title, description, type, project) | Pro+ | No arbitrary custom fields in MVP |
| `ticket_update` | Update a narrow, named field set (title, description, labels, priority) | Pro+ | Never a raw-payload/arbitrary-field passthrough |

**Explicitly not building:** `ticket_delete` (Atlassian's own MCP excludes it too, deliberately) · arbitrary/custom-field editing · bulk operations (single-ticket only in MVP, given the real quota-burn risk found in research).

## Existing codebase grounding (read directly, not assumed)

All three tracker adapters (`skills/jtb/scripts/lib/adapters/{jira,github,linear}-adapter.mjs`) are **100% read-only today** — each `createXAdapter(conn)` returns an object with only `fetchTicket`/`fetchCurrentUser`/`searchTickets`/`fetchStatuses` (Jira also has these; GitHub/Linear implement the same shape independently). No write methods exist anywhere in any adapter. Comment/transition would be genuinely new adapter surface, not an extension of something partial.

## Real per-tracker mechanics (web-verified, not assumed)

- **Jira:** `GET /issue/{key}/transitions` (discover valid transition IDs — never hardcode workflow names) → `POST /issue/{key}/transitions` with the chosen `transition.id`. Comments: `POST /issue/{key}/comment`. API v3 (Cloud) supports ADF-formatted comment bodies; v2 (Server/DC) does not — this adapter already branches on `apiVersion` for reads, same branch point applies to writes.
- **GitHub:** Comments: `POST /repos/{owner}/{repo}/issues/{issue_number}/comments`. State change: `PATCH /repos/{owner}/{repo}/issues/{issue_number}` with `state: "open"|"closed"`. GitHub Issues has no Jira-style multi-step workflow — only open/closed — so `ticket_transition` on a GitHub-backed ticket is necessarily a much smaller state space than on Jira.
- **Linear:** GraphQL mutations. Comments: `commentCreate(input: { issueId, body })`. State change: `issueUpdate(id, input: { stateId })` — requires first querying the team's available `WorkflowState`s to resolve a human-meaningful status name (e.g. "In Progress") to its `stateId`, same two-step shape as Jira's transition-ID discovery.

Sources: [Atlassian Jira Cloud REST API v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/) · [jira-cli (ankitpokhrel)](https://github.com/ankitpokhrel/jira-cli) · [Atlassian Rovo MCP server coverage](https://www.usecarly.com/blog/jira-mcp/) · [MCP write-operations limitations discussion](https://community.atlassian.com/forums/Jira-questions/MCP-Server-Integration-Limited-Write-Operations-for-Jira-Issues/qaq-p/3113619) · [GitHub REST API — issue comments](https://docs.github.com/en/rest/issues/comments) · [GitHub REST API — issues](https://docs.github.com/en/rest/issues) · [Linear GraphQL API](https://linear.app/developers/graphql)

---

## Brainstorm: `ticket_comment` + `ticket_transition` — 10-iteration refute loop

1. **5/10** — naive: `ticket_transition(ticketKey, targetStatus)` as a free-text string. Refuted: Jira/Linear need transition-ID/state-ID resolution first (free-text needs fuzzy-matching against per-project workflow variance — the exact "screen schemes" complexity the original rejection warned about). GitHub has no such concept (open/closed only).
2. **6/10** — fix: two-step "look-then-act" shape, inherent to how Jira/Linear actually work — first call returns valid transitions/states for that ticket, second call (resolved ID + `confirm: true`) executes. Refuted further: adds friction to GitHub's trivial open/closed case — resolved by keeping the interface uniform anyway; complexity lives in the adapter, not a third special-cased tool-schema path.
3. **6.7/10** — refuted `confirm: true` itself: real search confirmed it's a **behavioral nudge + forensic trail, not a hard guarantee** ("these measures don't prevent determined models from causing damage"). Reframed honestly, not oversold.
4. **7.2/10** — tied audit logging to the already-shipped `AuditService`. Refuted my own assumption: haven't read `AuditService.php` this session, don't know if it covers CLI-originated actions today — **flagged as needing verification**, not asserted.
5. **7.6/10** — real rate-limit numbers: GitHub 900 pts/min per endpoint + 100 concurrent (published). Jira: per-issue write throttling real but no published exact number, general 429 + `Retry-After`. Linear's complexity limit: **not found — genuinely unconfirmed**, needs direct doc verification before implementation.
6. **8/10** — refuted the CLI-first-then-MCP-wraps-it layering itself (is a full CLI subcommand overkill if the real use is AI-driven?). Resolved against the doubt: the backlog's origin was the user's own daily *manual* workflow pain, not just AI automation — Phase 1's precedent holds.
7. **8.4/10** — refuted per-tool tier splitting (Free `comment`, Pro `transition`?). Resolved against it — Recall's whole family is Pro-only, no per-action fragmentation; keep both Pro+, consistent.
8. **8.7/10** — testing: all three adapters already accept an injectable `fetcher` (confirmed by direct code read) — write-path tests mock it exactly like existing read-path tests. Not new complexity.
9. **9/10** — refuted this doc's *own* earlier suggestion (iteration 4 above): bundling a compliance check silently into `ticket_transition` violates the "narrow, named parameter schema" principle from iteration 9 above, risks surprising unrelated failures. Corrected: must be opt-in/separate, never a silent side effect.
10. **9.3/10 — STOP.** Two genuine open unknowns not resolved by this loop: `AuditService`'s actual current scope, Linear's real complexity-limit numbers. Both need direct verification before an implementation plan is presentable — a real gap, not modesty.

### Resulting design (pending the two open unknowns above)

- New adapter methods on all three (`jira-adapter.mjs`/`github-adapter.mjs`/`linear-adapter.mjs`): `addComment(key, body, opts)`, `transition(key, target, opts)` — `transition` without a resolved target/`confirm` returns the tracker's valid options for that ticket instead of executing (Jira: `GET /issue/{key}/transitions`; Linear: query `WorkflowState`s for the team; GitHub: static `["open","closed"]`).
- New CLI subcommands `ticketlens comment`/`ticketlens transition`, human-usable standalone (matches the user's own daily-workflow origin), following the existing adapter-dispatch pattern via `resolve-adapter.mjs`.
- MCP tools `recall`-style thin wrappers: `ticket_comment`, `ticket_transition` — zero reimplementation, same pattern as `recall_add`/`recall_search` over `note add`/`recall`.
- `confirm: true` two-step gate on `ticket_transition` — explicit in the tool description as "requires confirmation," framed honestly as a nudge + audit trail, not a security boundary.
- Pro+ gate on both, consistent with the whole Recall/MCP family.
- Rate-limit-aware error handling per adapter, distinguishing "rate limited, retry after Xs" from a generic failure — mirrors the existing pattern already proven in `recall-sync.mjs`.
- Compliance-check integration explicitly deferred, opt-in only if ever built — never bundled silently into `ticket_transition`.

## Approved plan — Pre-Code Audit amendments (2026-07-29)

Plan approved. 3 parallel audit lenses found real design issues before any code was written — folded in here, "cleared with amendments":

- **[Security, highest priority] New Jira write calls must live in `jira-client.mjs`, not `jira-adapter.mjs`.** `jira-client.mjs` owns `guardedFetch` (DNS-rebind guard, SSRF blocklist, manual-redirect-only, HTTPS-enforced). A write method built directly in the thin adapter file with a raw `fetch()` would silently lose that protection entirely. `addComment`/`transition` go in `jira-client.mjs` (calling `validateBaseUrl` + `guardedFetch`, same as the 4 existing read exports), thinly re-exported from `jira-adapter.mjs`.
- **[Security, highest priority] `mcp-server.mjs` must never import adapters directly.** Confirmed today: `callRecallAdd`/`callRecallSearch` only ever call the already-gated CLI functions (`runNoteAddFn`/`runRecallFn`), never touch an adapter. New `runTicketCommentFn`/`runTicketTransitionFn` must be wired the identical way — the Pro+ gate lives in `ticket-command.mjs`, and the MCP layer calling straight into an adapter would fully bypass it.
- **[Security] Audit log entries must be JSON-serialized per line, never plain-text-concatenated.** Comment bodies are attacker/AI-controlled free text — an embedded newline could forge fake log lines otherwise (same bug class already fixed once in this codebase, `feedback_brief_section_filename_escaping`). Ticket keys must pass `TICKET_KEY_PATTERN` before touching any file path or log line.
- **[Performance/data-safety] Split cooldown-state and audit log into two separate files**, not one. A single growing log serving both roles degrades the cooldown check from O(1) to O(n) (scanning full history per invocation), or risks one read-modify-write clobbering the other's data. `ticket-action-cooldown.mjs` (small JSON map, `{key:action -> lastAt}`, same read pattern as `recall-queue.mjs`) separate from `ticket-action-log.mjs` (append-only).
- **[Seniority] Split `transition` into two exported CLI-layer functions from the start**: `runTicketTransitionList` (discovery, read-only) and `runTicketTransition` (execute, requires a resolved target + confirm) — each independently matching the established `runX(cmdArgs, deps) -> {ok}` single-decision shape, dispatched from the same `ticketlens transition` subcommand based on whether a target/confirm was given, rather than one function branching internally like two commands.
- **[Seniority] Explicit `classifyWriteFailure`-style helper in `ticket-command.mjs`** distinguishing retryable/terminal/rate-limited errors for both CLI and MCP callers — mirrors `recall-queue.mjs`'s `isRetryableFailure`/`pushNote` pairing rather than falling through to a generic catch that loses the distinction.
- **[Performance/safety] No automatic retry on write timeout.** A timed-out write may have actually landed server-side — unlike Recall's notes (idempotent by `external_id`, safe to retry), ticket comments/transitions are not naturally idempotent. Explicit rule: never auto-retry a timed-out write.
- **[Performance] No in-process transition-discovery caching.** No memoization layer exists anywhere in `lib/` today, and each CLI invocation is a fresh process — a cache would have zero payoff now. Explicitly not building it; note for a future batch-mode if one is ever added.

### Before this can become an approved plan
- ~~Read `app/Services/AuditService.php`~~ **DONE (2026-07-29):** confirmed NOT reusable as-is. It's backend-only (Laravel `User` actor + `Illuminate\Http\Request`, neither available to the Node.js CLI), and its schema is scoped to admin-actions-on-users (`target_user_id`, built for the Owner Control Panel) — not a general resource-action log. Auditing ticket-write MCP actions is genuinely **new work**: either a new log model decoupled from the User-target assumption, or a real schema extension. Real added scope for the eventual plan, not a reuse checkbox.
- Check Linear's actual published complexity-limit documentation directly (not inferred from this search) — deferred, not plan-blocking; an implementation-time detail for the Linear adapter specifically, doesn't change the plan's shape.
- Standard plan-approval gate: discuss and confirm scope with the user (per [[project_ticket_crud_backlog_2026_07_27]]'s own instruction) before writing any code.
