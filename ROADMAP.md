# TicketLens — Product Roadmap (Solopreneur Edition)

Optimized for one developer: revenue before infrastructure, validate before building.

Iterations 1-2 are shipped. This roadmap tracks everything from Iteration 3 onward.

---

## Phase A — Launch & Validate (Weeks 1-4)

Get the product in front of people. Measure demand before building premium features.

### Iteration 3 — Launch-Ready (Current)

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 1 | ~~Bug~~ | ~~**Jira Cloud v3 API migration**~~ | Done. Cloud profiles auto-select v3. ADF-to-text converter added. | ~~Medium~~ |
| 2 | ~~Bug~~ | ~~**Jira Cloud v3 fetch endpoint**~~ | Done. All endpoints support v3 paths. | ~~Small~~ |
| 3 | ~~Feature~~ | ~~**npm package (`ticketlens`)**~~ | Done. CLI entry point with `ticketlens PROJ-123` and `ticketlens triage`. Published as npm package. | ~~Medium~~ |
| 4 | ~~Enhancement~~ | ~~**CLI output UX polish**~~ | Done. Session banner (version/profile/server/user in colored box), spinner inside banner, connection status (green/red dot), error classifier with VPN-aware hints, error footer boxes, colored legend (● needs-response / ● aging), interactive triage navigator (arrow keys + Enter to open in browser), profile picker on typo, `--help` with styled output. Zero new deps. (Note: `--project` was repurposed as a JQL project filter in v0.7.0 — Feature 15.) | ~~Small~~ |
| 4a | ~~Feature~~ | ~~**`ticketlens init` setup wizard**~~ | Done. Interactive wizard: profile name → URL (with suggestions) → auth auto-detected from URL (cloud = email+token; server/dc = PAT or Basic) → live connection test (spinner → ● / ●). Optional settings: ticket prefixes and triage statuses picked from live-fetched multi-select lists (v0.12.0 — projects/statuses of the connected instance, defaults pre-checked, free-text + live validation fallback), project paths (existence check + create offer). Loops on `Configure another? y/N`. Final step: profile switcher panel → quick-start panel. Zero new deps. | ~~Medium~~ |
| 4b | ~~Feature~~ | ~~**`ticketlens switch` — profile switcher**~~ | Done. Titled panel (`╭─ Profile ───╮`) with arrow-key selection. Profile name + dim hostname per row. Active profile marked with green `● active` badge. Selecting active profile is a no-op. On switch: spinner → updates `profiles.json` default → error footer on failure. Triggered by `ticketlens switch` subcommand or `p` hotkey during triage. `select-prompt.mjs`, `profile-switcher.mjs`, `saveDefault()` in profile-resolver. | ~~Small~~ |
| 4c | ~~Feature~~ | ~~**`ticketlens config` — full profile editor**~~ | Done. Edit any profile setting without re-running init. Connection section: URL (bare hostnames auto-prefixed https://), auth type (selector pre-positioned on current), email/token (pre-populated; Enter keeps existing). Connection test + retry menu (Retry/Edit credentials/Edit from URL/Skip) if any connection field changes. Optional section: prefixes, paths, triage statuses. v0.12.0: prefixes/statuses edited via live-fetched multi-select pickers, current values pre-selected — **replace semantics** (deselect removes; entries missing from the server flagged "not on server"). Free-text fallback (non-TTY, fetch failure, Esc) keeps the original **merge semantics** — new entries added, never replacing — with partial matching: `QA` → `QA Testing`. `ticketlens config [--profile=NAME]`. | ~~Medium~~ |
| 4d | ~~Enhancement~~ | ~~**Connection retry on `ticketlens init` failure**~~ | Done. When connection test fails during init, an arrow-key menu offers four options: Retry (same credentials), Edit credentials (re-prompt email/token, pre-populated), Edit from URL (restart from URL picker), Skip (abandon profile). All prompts pre-populated on retry so the user only fixes what's wrong. | ~~Small~~ |
| 4e | ~~Enhancement~~ | ~~**Auto HTTP/HTTPS detection for custom URLs**~~ | Done. When the user types a bare hostname (no protocol), `probeProtocol()` tries `https://` first, then `http://`, showing a `○ Probing...` spinner. Any HTTP response (even 401) confirms the server. Falls back to `https://` if both unreachable. Applies in both `ticketlens init` and `ticketlens config`. | ~~Small~~ |
| 5 | Chore | **Polish README with GIF demos** | Record 3 GIFs: ticket fetch, triage scan, depth traversal. First impression for GitHub visitors. | Small |
| 6 | Chore | **CONTRIBUTING.md + issue templates** | Signals "this is a real project" and invites open-source contributors. | Small |
| 7 | Chore | **GitHub Discussions enabled** | Community Q&A channel without cluttering Issues. | Small |

**Launch checklist:**
- [ ] Post on Hacker News (Show HN)
- [ ] Post on Reddit r/programming + r/ExperiencedDevs
- [ ] Dev.to launch article
- [ ] Tweet thread with demo GIFs
- [ ] Share in relevant Discord/Slack communities

**Validation signals to watch:**
- GitHub stars (target: 100 in first week)
- npm weekly downloads
- GitHub issues/discussions (are people actually using it?)
- Anyone asking for features you'd charge for?

### Known Issues Addressed
- ~~Jira Cloud v2 search API deprecated (410 Gone)~~ — resolved in items 1-2

---

## Phase A.5 — Website & First Sale (Week 3-5)

Static landing page + LemonSqueezy checkout overlay + first B2B pitch. No backend. One weekend build, hard constraint.

### Iteration 3.5 — Sales-Ready Website + Pilot Client Pitch

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| A1 | ~~Feature~~ | ~~**Triage by assignee (`--assignee`)**~~ | Done (b7683a7). `ticketlens triage --assignee="Jane Dev"` — JQL uses `assignee = "NAME"` instead of `currentUser()`. Team-gated. Scoring uses effective user for correct attention detection. JQL-injection safe via `escapeJql()`. | ~~Small~~ |
| A2 | ~~Feature~~ | ~~**Triage by sprint (`--sprint`)**~~ | Done (b7683a7). `ticketlens triage --sprint="Sprint 12"` — appends `AND sprint = "NAME"` to JQL. Team-gated. Combinable with `--assignee`. | ~~Small~~ |
| A3 | Chore | **Static landing page** | Single page on Cloudflare Pages: hero + demo GIF, pricing table, security/data statement, ToS/Privacy, LemonSqueezy overlay checkout, "Contact for Team pricing" CTA. One weekend max. | Small |
| A4 | Chore | **Pilot client pitch** | Live demo on client's Jira + website link + trial license keys. Validate Team-tier willingness, procurement process, seat count. | Small |

**Pilot client pitch checklist:**
- [ ] Informal conversation with decision-maker (validate interest before building)
- [x] Ship `--assignee` and `--sprint` flags
- [ ] Deploy landing page with pricing + checkout
- [ ] Formal pitch: live demo + website + trial keys

---

## Phase B — Monetize Without Infrastructure (Months 2-4)

Premium features that run 100% locally. No backend needed. License key via LemonSqueezy (Merchant of Record, $0 infra cost).

### Iteration 4 — Premium CLI Features (Pro tier, $9/mo)

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 8 | ~~Feature~~ | ~~**License key system**~~ | Done. LemonSqueezy API activation + validation. `~/.ticketlens/license.json` with tier hierarchy, expiry, revalidation. CLI: `ticketlens activate <KEY>`, `ticketlens license`. 27 tests. | ~~Small~~ |
| 9 | ~~Feature~~ | ~~**Multi-project triage**~~ | Done. `ticketlens triage --all` fetches all configured profiles in parallel with a live per-profile status block (⠋→✔/✗), merges output into a single view labelled by profile. Pro-gated. | ~~Small~~ |
| 10 | ~~Feature~~ | ~~**Custom attention rules**~~ | Done. `attentionRules` array in profile config. `match` keys: priority, label, status, keyPrefix. `action`: force-urgent (bumps to needs-response) or ignore (excludes from output). First match wins. Pro-gated. | ~~Medium~~ |
| 11 | ~~Feature~~ | ~~**Scheduled triage (cron)**~~ | Done. `ticketlens triage --save=FILE` writes ANSI-stripped output to a file. `ticketlens schedule --local` (auto-detected when no CLI token) creates a cron/LaunchAgent entry using `--save=FILE` — no Console auth required. Pro-gated. | ~~Small~~ |
| 12 | ~~Feature~~ | ~~**Ticket history tracking**~~ | Done. `ticketlens history TICKET-KEY` reads daily snapshots from `~/.ticketlens/triage-history/`, renders a chronological timeline with urgency, status, reason, and bounce detection (urgency changed on consecutive days). Pro-gated. | ~~Medium~~ |
| 12a | ~~Feature~~ | ~~**Recall P1 — single-player notes**~~ | Done. `ticketlens note add` saves a short markdown note (body from stdin) to a local vault at `~/.ticketlens/recall/<PREFIX>/`; `ticketlens recall <query\|TICKET-KEY>` searches it. Notes matching the current ticket auto-inject into future `ticketlens PROJ-123` briefs under a `## Recall` section, delimited as reference-only (never treated as instructions), with an unverified badge. Secret/PII scan rejects a note outright on save (never silently redacts) — checks title, tags, and body together. Local usage counters (drafts kept/dropped, briefs with a Recall injection) plus an occasional y/n/skip pulse prompt feed the go/no-go decision for P3 (team sync). Zero backend, zero new deps. Pro-gated at every entry point: `note add`, `recall`, and the brief-injection path itself. | ~~Large~~ |
| 12b | ~~Feature~~ | ~~**Recall P2 — ephemeral gap-diffing**~~ | Done. At brief time, `ticketlens PROJ-123` now diffs candidate requirements extracted from linked tickets (existing depth 0/1/2 traversal, max 15) and from the ticket's own downloaded attachments against the ticket's own description. Anything not already covered renders under a new `## Gaps` section, cited by source (linked ticket key or attachment filename), evidence-only phrasing — never an instruction. Nothing persisted; recomputed fresh on every brief. Reuses `requirement-extractor.mjs`/`diff-analyzer.mjs` (already shipped for `--compliance`/`review`) — zero new deps. Pruned before Recall when `--budget=` is tight (most speculative content, cut first). Pro-gated, same entry point as Recall injection. | ~~Medium~~ |
| 12c | ~~Feature~~ | ~~**Recall P3 — team sync**~~ | Done. `note add` background-pushes each note to the team's shared pool (`POST /v1/recall/push`) when a CLI token is present; `recall` pulls the team's notes first (TTL-cached, 4h) before searching locally. Manager-only verify flow promotes a note to trusted at `console/admin/recall` (`RecallController`, `Recall.vue`) — IDOR-safe, group-scoped. Entitlement is **not** hardcoded to any tier: a new `Permission::Recall` bit is owner-assignable per-tier via `console/owner/tiers` or per-client via `console/owner/clients/<id>` Feature Access, so it can be turned on/off dynamically without a code change. Design supports both SaaS-hosted (this cycle) and a future self-hosted backend behind the same push/pull contract. Renamed all "digest" terminology to "notes"/"recall" throughout the CLI internals (`recall-vault.mjs`, `recall-matcher.mjs`) to avoid confusion with the unrelated Slack/Teams digest-schedule feature. Zero new CLI deps. | ~~Large~~ |
| 12d | ~~Feature~~ | ~~**Recall P3.1 — Console delete + nav + dispatch rule**~~ | Done. `console/admin/recall` gained a sidebar entry (hidden for the owner's own un-impersonated session — reachable only by impersonating a client, matching every other client-scoped admin page), an expand-in-place body view so a verifier can read a note before deciding (previously title/tags/status only), and a manager-only Delete action. Deletion is soft (`RecallNote` gained `SoftDeletes`) and propagates: `GET /v1/recall/pull`'s response gained a `deleted: [{external_id, tickets}]` tombstone array, and the CLI's `pullNotes()` removes the matching local file in O(1) (same `resolvePrefix`+`external_id` path resolution as `upsertPulledNote`, no directory scan). A re-push of a previously-deleted `external_id` restores the row and resets status to `unverified` rather than silently colliding with the `(group_id, external_id)` unique constraint. `SKILL.md`'s Recall guidance rewritten: a concrete 3-part "when to capture" rule replacing "if you learned something," plus harness-conditional async/background dispatch guidance for the `note add` call. Zero new CLI deps. | ~~Medium~~ |
| 12e | ~~Fix~~ | ~~**Recall P3 review backlog — 2 deferred findings**~~ | Done. `ComplianceRequest::rules()`'s `ticketKey` regex widened to `/^[A-Z][A-Z0-9]+-\d+$/` (was `/^[A-Z]+-\d+$/`), matching `PushRequest.php` and the CLI's own `TICKET_KEY_PATTERN` — digit-prefixed keys like `CNV1-2` now validate. `pushNote()` in `recall-sync.mjs` gained a 24h TTL-cached "not entitled" marker (`recall-entitlement-state.json`, sibling to the existing pull-state cache): a non-entitled account's `note add` now warns once, then stays silent for 24h instead of repeating on every save; the "No team found" 403 reason is deliberately excluded from caching and stays noisy every call. Zero new deps. | ~~Small~~ |
| 12f | ~~Feature~~ | ~~**Recall push resilience — offline retry queue**~~ | Done. A team push failing for a transient reason (network error, timeout, 5xx) no longer gets a one-shot "saved locally only" warning and nothing else — the note is queued in `recall-pending.json` (`recall-queue.mjs`) and retried automatically, at most once every 15 minutes, whenever `note add` or `recall` next talks to the network. `ticketlens recall sync` flushes on demand. Session-expired (401) and not-entitled (403) failures are deliberately never queued — retrying those can't succeed without the user acting. Each queued entry is tagged with a hash of the account token that queued it, so a later account switch never flushes a note under the wrong login; the queue is capped at 200 entries and expires entries after 30 days (measured from first-queued, not last-retried, so a perpetually-failing entry can't stay alive forever by retrying its own clock). Zero new deps. | ~~Medium~~ |

### Iteration 5 — Premium CLI Features (Team tier, $19/seat/mo)

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 15 | ~~Feature~~ | ~~**Triage by project (`--project`)**~~ | Done (v0.7.0). `ticketlens triage --project=PROJ` adds `AND project = "PROJ"` to the JQL query. Replaces the old `--profile` alias. Team-gated. | ~~Small~~ |
| 16 | ~~Feature~~ | ~~**Triage by label/priority (`--label`, `--priority`)**~~ | Done (v0.7.0). `--label=Bug,P1` adds `labels IN (...)` clause; `--priority=High` adds `priority = "High"`. Team-gated. JQL-injection safe. | ~~Small~~ |
| 17 | ~~Feature~~ | ~~**Triage export (CSV/JSON)**~~ | Done. `ticketlens triage --export=csv` and `--export=json` write scored triage results to a timestamped file. Team-gated. | ~~Small~~ |
| 18 | ~~Feature~~ | ~~**Brief templates**~~ | Done (v0.9.3). `--template=SLUG` CLI flag; 3 system templates (full, quick, code-review); Console Admin → Brief Templates CRUD (Pro/Team); custom templates scoped to team group; API group-scope fix. | ~~Medium~~ |
| 19 | ~~Feature~~ | ~~**Response time metrics — CLI**~~ | Done (v0.8.0). `ticketlens stats` subcommand: avg/median response time, clear rate, triage run count, week-over-week trend, urgency breakdown. `--days=N` (Pro ≤30), `--format=json`. Inline footer auto-appended to `ticketlens triage` output when ≥2 snapshots exist and a meaningful metric is available. | ~~Medium~~ |
| 19c | ~~Feature~~ | ~~**Response time metrics — Console**~~ | Done. Console `/console/admin/stats` page: 30-day urgency trend (line chart, chart.js), team snapshot stacked bar chart, sortable team comparison table. PushController changed to daily-dedup INSERT with 90-day pruning — history now accumulates per push. `last_comment_at` added to push payload for future response-time precision. Response-time trend shows placeholder until 30d of history exists (TODO: compute from `last_comment_at`). CLI: `ticket-payload.mjs` enriched. Backend: `StatsController`, migration (index), route, nav. 726 API tests / 1277 CLI tests. | ~~Medium~~ |
| 19d | ~~Feature~~ | ~~**Stale status detection**~~ | Done (v0.9.0, CLI; fcd4bad+4d59dcd, API). Three-layer feature fully shipped and live-tested. (1) CLI — changelog parsing in `jira-client.mjs`, stale rule application in `attention-scorer.mjs`, `GET /v1/statuses` + `GET /v1/profiles` merge verified. (2) Backend — `workflow_rules` table (type='stale'), `StatusCacheController`, `ProfileSyncController` merges team rule into profile when no user override, `EvaluateAlertsJob` stale alert type, Stats page stale band. (3) Console — `/console/admin/rules` Workflow Rules page: amber card layout, two-column form, staged status chips, toggle auto-saves via `PATCH /console/admin/rules/stale/toggle`, `useConfirm` modal on delete. API proxy: `/v1/` routes on `api.ticketlens.test` (not `ticketlens.test`). 19 RulesController tests, 61 assertions. Establishes Console lifecycle rules engine — SLA/priority escalation follow same pattern. | ~~Large~~ |
| ~~20~~ | ~~Feature~~ | ~~**Live Console Events (SSE)**~~ | Done. SSE endpoint `GET /console/events` (Pro+ tier, session-cookie auth, Redis Streams `XREAD BLOCK 25s`). `SseEventService::publish()` fire-and-forget called in `RulesController` (`rule.changed`) and `PushController` (`triage.pushed`). Frontend: Pinia `useEventsStore`, `useServerEvents()` composable (EventSource lifecycle, tier-gated, auto-reconnect on drop), wired in `ConsoleLayout`. UI reactions: `TlToastStack` (auto-dismiss 5s, both event types mapped to messages) + `TlRuleBanner` (dismissible persistent banner on `rule.changed`) mounted in `ConsoleLayout`; `Queue.vue` and `Rules.vue` auto-reload on their respective events via `router.reload({ preserveScroll: true })`. 11 new tests (`SseUiReactionsTest` + `SseUiLockTest`). | ~~Medium~~ |

*Note: #13 (`--assignee`) and #14 (`--sprint`) moved to Iteration 3.5 for pilot client pitch.*

---

## Phase B.5 — Compliance Check (Month 3-5)

The killer premium feature. Primary conversion lever from Free to Pro.

### Iteration 6 — Compliance Check

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 20 | ~~Feature~~ | ~~**Requirement extractor**~~ | Done. Parses acceptance criteria, bullet points, "should/must/given-when-then" from ticket description + comments. | ~~Large~~ |
| 21 | ~~Feature~~ | ~~**Ticket-to-commit linker**~~ | Done. Finds git/svn commits and branches associated with a ticket key. Built on code-ref-parser + VCS detection. | ~~Medium~~ |
| 22 | ~~Feature~~ | ~~**Code diff analyzer**~~ | Done. Compares extracted requirements against actual code changes in linked commits. Maps each requirement to FOUND/NOT FOUND. | ~~Large~~ |
| 23 | ~~Feature~~ | ~~**`/jtb compliance TICKET` CLI**~~ | Done. Assembles the compliance report: requirements list, coverage percentage, missing items. | ~~Medium~~ |
| 24 | ~~Feature~~ | ~~**Local usage tracking**~~ | Done. Counts compliance checks locally to enforce the free-tier cap (3/month). Stored in `~/.ticketlens/usage.json`. | ~~Small~~ |

**Pricing**: Free tier gets 3 compliance checks/month. Pro ($9/mo) gets unlimited. This is the primary conversion lever — devs hit the cap and realize it's worth $9.

---

## Phase B.7 — Safety Net (Pro CLI)

All CLI-only, $0 infrastructure. Runs before or alongside Phase C. Six Pro tier features where the manual version simply does not happen in practice.

**Tier philosophy reframe:**
- Free = everything local. Me, now, one ticket.
- Pro = individual mistake prevention. The free tier tells you the truth when you ask it. Pro tells you when you forgot to ask.
- Team = shared intelligence. Work that crosses people, time, and systems.

### Iteration B.7 — Safety Net CLI Features

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| B7-1 | ~~Feature~~ | ~~**Spec drift detection**~~ | Done. Scheduled re-fetch of tickets linked to open branches. Alerts via stderr when acceptance criteria, scope, or status changed since last read. | ~~Medium~~ |
| B7-2 | ~~Feature~~ | ~~**Git hook compliance gate**~~ | Done. `ticketlens install-hooks` installs a pre-push hook that runs compliance check. Blocks push if coverage < configurable threshold (default: 80%). Shell-injection hardened. | ~~Medium~~ |
| B7-3 | ~~Feature~~ | ~~**Ticket-to-PR assembler**~~ | Done. `ticketlens pr TICKET-KEY` outputs a PR description template: requirements list, compliance coverage %, linked commits, acceptance criteria status. Pipe or paste into GitHub/GitLab. | ~~Medium~~ |
| B7-4 | ~~Feature~~ | ~~**Token budget optimizer**~~ | Done. `ticketlens TICKET-KEY --budget 4000` prunes low-value content (old status comments, duplicate fields) to fit the target window. Reports what was dropped and why. | ~~Low–Medium~~ |
| B7-5 | ~~Feature~~ | ~~**Compliance ledger**~~ | Done. Append-only local log: `ticket-key → commit-SHA → author → timestamp → coverage %`. Exportable as signed JSON or CSV. SOC 2 / ISO 27001 / HIPAA audit trail without sending data anywhere. | ~~Small–Medium~~ |
| B7-6 | ~~Feature~~ | ~~**Stale delta report**~~ | Done. Upgrades scheduled digest from snapshot to diff. Shows what got *worse* since yesterday: regressed tickets, unanswered comments, staleness crossings. | ~~Medium~~ |

**Strategic priority:** B7-2 (git hook gate) is the path to must-have status. Once compliance runs pre-push, removing TicketLens breaks the pipeline — same category as linters.

---

## VALIDATION GATE

**Stop here and assess before continuing.** Ask yourself:

- Do I have 50+ paying Pro users?
- Do I have 10+ teams asking for the dashboard?
- Is revenue covering my time investment?
- What are the top 3 feature requests from paying users?

If yes to the first two: proceed to Phase C.
If no: iterate on Phase B features, double down on marketing, or pivot.

---

## Phase C — Infrastructure (Month 6+, only if demand is proven)

Build the cloud backend and web dashboard ONLY when paying users demand it.

### Phase C.0 — Console Foundation ✅ Complete

Laravel 11 + Inertia.js + Vue 3 + Tailwind v4. Built in parallel with Phase B.7 to unblock team-tier features at the validation gate.

| # | Type | Feature | Detail |
|---|------|---------|--------|
| C0-1 | ~~Feature~~ | ~~**Console architecture**~~ | Done. Laravel 11 + Inertia.js + Vue 3 + Tailwind v4 + Vite. Sail-based local dev, nginx reverse proxy, GitHub Actions CI. |
| C0-2 | ~~Feature~~ | ~~**TlIcon + tl-* design system**~~ | Done. All 7 phases shipped: token palette, component classes (buttons, cards, nav, tables, forms, badges, typography, layout, tabs), Lucide icon library, consistent disabled/hover/focus states, global cursor rules. |
| C0-3 | ~~Feature~~ | ~~**Owner control panel**~~ | Done. is_owner flag + IsOwner middleware; client CRUD (create/suspend/restore/delete); AuditLog + AuditService (filterable, 10/page default); feature grants + auto-revoke; user impersonation with amber banner; all owner routes at `/console/owner/*`. |
| C0-4 | ~~Feature~~ | ~~**Team management**~~ | Done. Admin Members (invite/remove/promote) + Admin Seats panels with seat-limit enforcement. Owner Teams panel (list + detail view). |
| C0-5 | ~~Feature~~ | ~~**Schedules management**~~ | Done. Search-before-display (no results until query typed), inline client-side validation, create/delete schedules from Console. Owner account bypasses license check. |
| C0-6 | ~~Feature~~ | ~~**Licenses panel**~~ | Done. Owner can view, issue, and set expiry for licenses from the Console. Human-readable dates + expiry warnings. |
| C0-7 | ~~Feature~~ | ~~**UI polish**~~ | Done. Icons on all Console buttons via TlIcon, inline validation on all forms before backend requests, cursor-pointer globally, disabled button opacity + not-allowed cursor, no-op nav clicks on active section, responsive collapsible sidebar. |
| C0-8 | ~~Feature~~ | ~~**Browser-based CLI login**~~ | Done (v0.1.7). `ticketlens login` opens the Console authorize page in the default browser. User approves, Console redirects to a one-shot localhost callback server in the CLI with the token. Cancel returns `error=access_denied` so the CLI exits cleanly (exit 0) instead of timing out. `--manual` flag preserves the paste flow for CI/headless. Backend: `GET/POST /console/auth/cli` (Blade view, not Inertia) + `CliAuthController`. CLI: `browser-login.mjs` with `startLocalServer`, `openBrowser`, `browserLogin`. 13 unit tests. |
| C0-9 | ~~Feature~~ | ~~**Account Settings — Profile redesign**~~ | Done. `/console/account` rebuilt from a read-only summary into a real editable page: name/phone form (`phone` new nullable column on `users`), in-page password change (`Hash::check` current password, `Hash::make` new), and a resurfaced CLI-token generate/revoke UI (backend already existed, was never rendered). Fixed a pre-existing bug found along the way: `HandleInertiaRequests`'s shared `flash` prop never forwarded the `success` session key, so every controller's `->with('success', ...)` message (6 controllers, including this one's own `revokeCliToken`) was silently dropped before ever reaching the browser — now fixed for all of them. `UserAvatar.vue` gained an optional `size` prop (`lg` for the profile banner), default preserves all 9 existing call sites unchanged. Notification Settings and Triage Rules were both considered for this page and deliberately excluded — both are group/team-scoped data (`AlertSetting`, `WorkflowRule`), not personal; Triage Rules instead planned as an extension of the existing `/console/admin/rules` page. Zero new deps. |

---

### Iteration 7 — TicketLens Cloud (Pro tier backend)

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 25 | Feature | **Cloud API service** | Auth (email/password + OAuth), user accounts, encrypted storage endpoints. | Large |
| 26 | Feature | **E2EE client library** | Encrypt/decrypt briefs client-side before sync. User holds the key, TicketLens Cloud stores opaque blobs. | Large |
| 27 | Feature | **Brief sync (push/pull)** | CLI sends encrypted briefs to cloud, pulls on another machine. Conflict resolution: last-write-wins. | Medium |
| 28 | Feature | **Triage history sync** | Persist triage results across machines. "What did I triage last week?" | Medium |
| 29 | Feature | **Billing migration (Stripe)** | Move from LemonSqueezy to Stripe only if fees justify it at 500+ users. | Medium |
| 30 | ~~Feature~~ | ~~**Landing page + signup flow**~~ | Moved to Phase A.5 (Iteration 3.5). Static landing page ships before first sale. | ~~Medium~~ |

### Iteration 8 — Team Dashboard (Team tier)

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 31 | Feature | ~~**Dev view — Attention Queue**~~ | Auto-refreshing triage in browser. Personal ticket queue + compliance status. **DONE (2026-05-11) — backend+console 59c07bf, CLI `--push` shipped.** | Large |
| 32 | Feature | ~~**Lead view — Team Health**~~ | Tickets needing response (trend), bottlenecks by status, workload per dev. **DONE (2026-05-12) — commit 3f018f4.** | Large |
| 33 | Feature | ~~**Manager view — Process Metrics**~~ | Ticket age distribution, status-flow heatmap, response-latency buckets, compliance coverage. Proxy metrics from snapshot data. **DONE (2026-05-12) — commit 94fffae, 19 tests, owner bypass via EnsureTeamManager.** | Large |
| 34 | Feature | ~~**Team management**~~ | Invite members, assign roles (dev/lead/manager), manage seats. **DONE (2026-05-12) — lead role (`TeamViewHealth` bit 1024), `EnsureTeamLead` middleware, Team Health accessible to leads + managers, Process Metrics manager-only. Role badges + toggle in Members panel.** | Medium |
| 35 | Feature | **Team billing (Stripe)** | Per-seat subscription, seat add/remove, invoicing. | Medium |
| C-T1 | ~~Feature~~ | ~~**Handoff brief (`--handoff`)**~~ | Done (v0.1.21). `ticketlens TICKET-KEY --handoff` generates an AI-powered handoff brief from the ticket's comment thread: what was attempted, current blockers, open questions, and a recommendation. BYOK (Anthropic/OpenAI/Groq) or `--cloud`. Pro-gated. v0.1.24: added Groq free-tier BYOK, AI provider selection, `--provider=` flag. v0.1.25: both `--handoff` and `--summarize` now pass full ticket context to AI — description, Confluence pages, and text-readable attachments (`.txt`, `.md`, `.log`, `.csv`, `.json`, etc., capped at 4 KB/file, 12 KB total). Known limitations: screenshots, PDFs, and Office docs are binary and cannot be parsed without a library (zero-dependency constraint); multimodal image support is a future consideration. 1021 tests. | ~~Small–Medium~~ |
| C-T2 | ~~Feature~~ | ~~**Shareable triage snapshot**~~ | Done (v0.1.27). `ticketlens triage --share` generates a signed URL (24h TTL, browser-readable, no login required for recipient). CLI posts snapshot to `/v1/triage/share`, backend writes a UUID share token + expiry; public page at `/s/{token}` renders ticket list as plain HTML — zero JS for recipients. `--share` failure is non-fatal to triage output. 17 new backend tests, 19 new CLI tests (incl. 2 integration tests for interactive-mode fallthrough fix). 1040 CLI tests, 625 backend tests. | ~~Medium~~ |
| C-T3 | ~~Feature~~ | ~~**Standup/PR generator**~~ | Done (v0.1.20). `ticketlens standup` scans `git log --since` (default 24h), groups commits by ticket key, optionally fetches ticket summaries via a Jira profile, and outputs a standup brief or PR body. `--since=N` (hours) or git date string. `--format=standup\|pr`. `--plain` for piping. Typo detection for all flags. PR format: bold keys, inline-code SHAs, commit count, fallback note when no ticket refs. 958 tests. | ~~Medium~~ |
| C-T3b | ~~Feature~~ | ~~**JTB skill auto-update (`ticketlens update-skill`)**~~ | Done (v0.2.0). `ticketlens update-skill` copies the latest `SKILL.md` to all detected AI assistant command directories (`~/.claude/commands/jtb.md`, `~/.claude-work/commands/jtb.md`, `~/.gemini/commands/jtb.md`, `~/.copilot-cli/commands/jtb.md`). Supports `--dry-run`, `--path=DIR`, `--quiet`. `postinstall` script runs automatically on `npm install -g ticketlens` — dual-account and multi-provider setups updated in one shot. `skills/jtb/SKILL.md` added to `package.json` files array (was missing — bug fixed). SKILL.md versioned with `<!-- jtb-skill-version: X.Y.Z -->` comment matching `package.json`. v0.2.1: `getVersion()` in `config.mjs` now uses `realpathSync` to resolve symlinks explicitly before navigating to `package.json` — banner always shows the correct version regardless of Node.js version or how the script is invoked. | ~~Small~~ |
| C-T4 | ~~Feature~~ | ~~**Parallel collision detection**~~ | Done (v0.3.1). `ticketlens collisions` — compares your current branch's changed files against teammates' recent branches (within 7 days), reports each overlap as a collision with branch names, linked tickets, and shared file paths. `ticketlens triage --push` now automatically captures and sends git_branches (branch name, base, linked tickets, changed files). New CLI modules: branch-scanner.mjs (19 tests), collision-reporter.mjs (18 tests), run-collisions.mjs (11 tests). New backend: `GET /v1/triage/collisions` + `git_branches` JSON column on `triage_snapshots` + CollisionsController + CollisionsControllerTest (16 tests). 1096 CLI tests, 646 backend tests. | ~~High~~ |
| C-T5 | ~~Feature~~ | ~~**Team compliance analytics**~~ | Done (v0.4.0). Pro-tier `--push` now reads the local compliance ledger and enriches each snapshot with `compliance_status` (pass/gap) and `compliance_coverage`. New Console page `/console/admin/compliance-analytics` (Team+): gap-rate by project prefix (bar chart), gap-rate by ticket status, weekly trend table, summary cards (tickets checked, overall gap rate, avg coverage). Owner picker lets the owner view any team's data. 90-day rolling window. 20 backend tests (666 total). 1112 CLI tests. | ~~Medium~~ |
| C-T7 | ~~Feature~~ | ~~**Per-user BYOK AI providers**~~ | Done (v0.9.5–v0.9.7). Each user stores their own encrypted AI provider keys (Groq, Anthropic, OpenAI) in the backend. `AiService` iterates providers in priority order with per-provider timeout and fallback. New Console Admin page `/console/admin/ai`. New CLI `ticketlens cloud-keys` subcommand. `/v1/summarize` and `/v1/compliance` moved to `auth.cli` (CLI token Bearer). v0.9.7 polish: consent prompt now shows actual API URL + primary provider fetched from backend, styled with ANSI, default Y; AI summary cached in `brief.json` alongside brief — repeat `--summarize` runs served from cache, `--no-cache` forces fresh AI call. 1376 CLI tests, 687 backend tests. | ~~Large~~ |
| C-T6 | Feature | **Team-scoped Analytics view (Admin)** | **Backlog.** The current `/console/analytics` page shows per-user AI token savings and call counts from `usage_logs` (Pro+). Team managers have no visibility into their team's aggregate AI usage. Scope: (1) New `/console/admin/analytics` page (Team+) — aggregate token savings, total AI calls, and per-member breakdown (who uses `--summarize`/`--handoff` the most, tokens saved per member, calls over time). (2) Reuse `usage_logs` grouped by `user_id` filtered to team members. (3) Owner picker so the owner can inspect any team. (4) "No data yet" empty state with a nudge to run `ticketlens TICKET-KEY --summarize --cloud`. No new database changes required — `usage_logs` already captures user_id, action, tokens, timestamp. | Small–Medium |
| C-T8 | Feature | **`ticketlens whoami`** | **Backlog.** Single command showing the user's full local identity in one shot: Console account email (decoded from the stored CLI token), active Jira profile name + server URL, and license tier. Closes the gap where `ticketlens license` shows tier but email is null, and `ticketlens triage` shows profile/server but not account email. CLI-only, no new backend endpoint needed — CLI token payload already contains the email. Output: plain single-panel box, machine-readable with `--format=json`. Free tier. | Small |
| C-T9 | ~~Feature~~ | ~~**Shared team Jira config**~~ | Done (v0.9.19). Pro+ team managers set Jira URL, auth type, prefixes, project paths, and triage statuses once via Console `/console/admin/jira`; all team members inherit the non-secret config automatically — each member still provides their own Jira credentials. Three CLI flows: (1) `ticketlens login` auto-fetches and applies team config on first login (`applyTeamConfigOnLogin`); (2) `ticketlens TICKET-KEY` (and any fetch) silently checks `updated_at` and shows a banner if config changed — security lever: manager changes or blanks URL to cut Jira access; (3) `ticketlens sync` force-pulls and shows a banner if config was updated or deleted. Fallback: if team config deleted/blanked, CLI retains local credentials. Backend: `team_jira_configs` table (group_id unique FK, jira_base_url, auth_type, prefixes/project_paths/triage_statuses as JSON, timestamps), `GET /v1/team/config` (Pro+, rate-limited 30 req/min), `PUT/DELETE /console/admin/jira` (manager+). CLI module: `team-jira-sync.mjs` (fetchTeamJiraConfig, checkTeamJiraConfigUpdate, applyTeamConfigOnLogin). 9 CLI module tests, 13 API/Console tests. | Medium |

### Iteration 9 — Slack/Teams Alerts

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 36 | ~~Feature~~ | ~~**Slack app (OAuth + bot)**~~ | OAuth 2.0 install to workspace, per-team channel configuration, "Test connection" button posts a verification message to the selected channel. `SlackService` (buildAuthUrl, exchangeCode, fetchChannels, postMessage), `SlackIntegration` model, encrypted state for cross-domain callback, `POST /integrations/test` endpoint. **DONE (2026-05-13) — commits 54fe991+.** Polish (2026-05-14): OAuth opens in a popup window (`useOAuthPopup` composable, reusable for future integrations) so the user never leaves the console — popup closes automatically via `postMessage` + `window.close()` after callback redirects to same-origin `/console/oauth-close`. Fixed `back()` session-poisoning bug (popup shares PHP session; explicit redirects in `saveChannel`/`disconnect` prevent the oauth-popup Blade view appearing in an Inertia modal). Test connection error banner now shows actionable, human-readable messages mapped from Slack error codes (e.g. `not_in_channel` → "invite @TicketLens to the channel"). — commits be36141, d313713, current. | ~~Medium~~ |
| 37 | ~~Feature~~ | ~~**Needs-response alert**~~ | `EvaluateAlertsJob` evaluates `needs-response` flag from TriageSnapshot, posts to Slack channel with configurable cooldown (default 4h), deduplicates via `sent_alert_logs`. `AlertSetting` per-group toggle + cooldown input. Custom alert rules DM specific Slack users (`custom_alert_rules` table, `SlackService::fetchMembers` + `postDm`). Manager/owner UI at `/console/admin/alerts` with member picker. **DONE (2026-05-14) — commits e763561, 8053317.** | ~~Small~~ |
| 38 | ~~Feature~~ | ~~**Aging ticket alert**~~ | Same job evaluates `aging` flag with configurable cooldown (default 24h). Toggle + cooldown input in same Alerts UI. Custom rules share same per-rule cooldown scoping. **DONE (2026-05-14) — commits e763561, 8053317.** | ~~Small~~ |
| 39 | ~~Feature~~ | ~~**Compliance gap alert**~~ | `compliance_gap_enabled` + `compliance_gap_cooldown_hours` added to `alert_settings`. `EvaluateAlertsJob` second loop detects `status=done` + `compliance_status=gap`, posts to Slack channel with 24h default cooldown, deduplicates via `sent_alert_logs`. Custom rule DMs via `compliance_gap` alert type. Toggle + cooldown row added to Alerts UI alongside existing channel alerts. **DONE (2026-05-15).** | ~~Small~~ |
| 40 | ~~Feature~~ | ~~**Weekly team digest**~~ | `SendSlackDigestJob` dispatched every minute by scheduler, builds team summary (total/needs-response/aging/compliance-gaps/top 3 aging). `SlackDigestSchedule` per-group with timezone-aware `isDue()`. `AlertsController` CRUD for digest schedules. Dedicated `/console/admin/digests` Console page (`DigestsController` + `Digests.vue`) with full schedule management (add/toggle/delete/test), extracted from Alerts page. Nav entry added to ConsoleLayout. **DONE (2026-05-21) — API commits.** | ~~Medium~~ |
| 41 | Feature | **Microsoft Teams integration** | Same alert set for Teams-first orgs. | Medium |

---

## Phase D — Expansion (Month 12+, only if business justifies it)

Build only what paying customers or market demand requires.

### Iteration 10 — Multi-Tracker Support

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 42 | Refactor | ~~**Tracker adapter abstraction**~~ | Done. Pluggable interface so new sources don't fork the whole client. | Medium |
| 43 | Feature | ~~**GitHub Issues as ticket source**~~ | Done. Large OSS audience. `GitHubAdapter` + `ticketlens init` GitHub branch (repo URL → PAT → test → prefix → save). | Medium |
| 44 | Feature | ~~**Linear as ticket source**~~ | Done (v0.1.11). `LinearAdapter` backed by Linear GraphQL API. `ticketlens init` → Linear branch: prompts for API key (sent without Bearer prefix), live connection test, optional prefix/path, saves `auth: linear` profile. `ticketlens config` is now tracker-aware: shows correct URL label, skips Jira-only auth/email prompts, uses Linear adapter for connection test and status validation. Always runs connection test on profile edit. 823 tests. | Medium |
| 45 | Feature | ~~**Confluence/wiki page fetching**~~ | Done (v0.1.14). Fetches Confluence pages referenced via Jira Remote Links API (`application.type === com.atlassian.confluence`). New `confluence-client.mjs`: URL parsing (Cloud `/wiki/spaces/.../pages/{id}` + Server `?pageId={id}`), HTML-to-text, `fetchConfluencePage`. `fetchRemoteLinks` added to `jira-client.mjs`. Origin-validated before forwarding auth (SSRF guard), capped at 10 pages, non-fatal. "Confluence Pages" section rendered in both brief and styled assemblers. Skipped for GitHub/Linear profiles and with `--no-attachments`. 944 tests. | Small |

### Iteration 11 — Platform Features

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 46 | ~~Feature~~ | ~~**"TicketLens for PRs"**~~ | Done (v0.1.18). `ticketlens review` assembles a code-review context brief from the current branch: extracts linked ticket keys from the branch name and commit messages, fetches each via the configured profile, and outputs a structured brief (branch, changed files, ticket context). Styled ANSI output on TTY. `--branch=BRANCH` (or `--base=BRANCH` alias) sets the base; auto-detects `main`/`master`/`develop`. Flag validation with typo detection (`--branch-main` → `--branch=main`). Spinner for sync and async phases. Warns when head = base. 904 tests. | ~~Large~~ |
| 47 | Feature | **Public API** | REST API for third-party integrations, webhooks. | Large |
| 48 | Feature | **AI ticket summarization** | LLM-powered summary of long ticket threads. | Medium |
| 49 | Feature | **AI priority recommendations** | Suggest what to work on next based on urgency + deadlines. | Medium |

### Iteration 12 — Enterprise

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 50 | Feature | **Azure DevOps source** | Enterprise TAM expansion. | Medium |
| 51 | Feature | **ServiceNow source** | Large enterprise ITSM market. | Medium |
| 52 | Feature | **SSO (SAML/OIDC)** | Enterprise auth requirement. | Medium |
| 53 | Feature | **Self-hosted deployment** | Docker/Helm for regulated industries. | Large |

---

## Parked / Revisit Later

| Feature | Status | Notes |
|---------|--------|-------|
| **waitingStatuses filter** | Rolled back (Iteration 2) | May revisit after real-world triage usage data. |
| **IDE Plugins (VS Code, JetBrains, Neovim)** | Deferred | Huge effort for a solopreneur. Let community build these after the CLI is established. Consider bounties or plugin grants. |
| **Jira ticket create/update (CRUD)** | Rejected | Saturated market (jira-cli 5K stars, free). Dilutes read-side positioning. Recommend jira-cli as complement instead. |

---

## Solopreneur Decision Framework

Before building any feature, ask:

1. **Does it generate revenue?** If no, is it required for a feature that does?
2. **Does it need infrastructure?** If yes, can I defer it and build a local-only version first?
3. **Are paying users asking for it?** If no, don't build it yet.
4. **Can I ship it in < 1 week?** If no, can I break it into smaller pieces?

---

## Critical Path

```
Phase A:   Launch ✓
Phase A.5: Website + Pilot Client ✓
Phase B:   Premium CLI (license, schedules, digests, compliance ✓)
Phase B.5: Compliance check ✓
Phase B.7: Safety Net — spec drift, git hooks, PR assembler,
           token budget, ledger, stale delta  ✅ complete
           |
    ===== VALIDATION GATE =====
    50+ paying Pro? 10+ teams? Revenue covering time?
           |
Phase C:   Console + Team Intelligence
             ├─ C0 Foundation: admin backend, auth, owner panel, teams, schedules,
             │  licenses, audit log, TlIcon + tl-* design system ✅ complete
             └─ Customer features: Iter. 7–9 (cloud sync, team dashboard, Slack) ⏳ post-validation gate
Phase D:   Multi-tracker + Enterprise
```

---

## Pricing Tiers

| | Free | Pro ($9/mo) | Team ($19/seat/mo) | Enterprise (contact us) |
|--|------|------------|-------------------|-----------|
| CLI fetch + triage | Yes | Yes | Yes | Yes |
| Compliance check | 3/month | Unlimited | Unlimited | Unlimited |
| AI ticket summary | No | Yes | Yes | Yes |
| Configurable cache TTL | No | Yes | Yes | Yes |
| --depth=2 (full graph) | Yes | Yes | Yes | Yes |
| Scheduled triage digest | No | Yes | Yes | Yes |
| Multi-project triage | No | Yes | Yes | Yes |
| Custom attention rules | No | Yes | Yes | Yes |
| Ticket history tracking | No | Yes | Yes | Yes |
| Spec drift detection | No | Yes | Yes | Yes |
| Git hook compliance gate | No | Yes | Yes | Yes |
| Ticket-to-PR assembler (`ticketlens pr`) | No | Yes | Yes | Yes |
| Token budget optimizer (`--budget N`) | No | Yes | Yes | Yes |
| Compliance ledger (audit trail) | No | Yes | Yes | Yes |
| Stale delta report (diff, not snapshot) | No | Yes | Yes | Yes |
| `--assignee` flag | No | No | Yes | Yes |
| `--sprint` flag | No | No | Yes | Yes |
| `--project`/`--label`/`--priority` | No | No | Yes | Yes |
| Triage export (CSV/JSON) | No | No | Yes | Yes |
| Team triage dashboard | No | No | Yes | Yes |
| Slack/Teams alerts | No | No | Yes | Yes |
| Brief templates | No | No | Yes | Yes |
| Response time metrics | No | No | Yes | Yes |
| Parallel collision detection | No | No | Yes | Yes |
| Standup/PR generator (`ticketlens standup`) | Yes | Yes | Yes | Yes |
| Handoff brief (`--handoff`) | No | Yes | Yes | Yes |
| Shareable triage snapshot (`--share`) | No | No | Yes | Yes |
| Team compliance analytics | No | No | Yes | Yes |
| Team-scoped Analytics view (Admin) | No | No | Yes | Yes |
| BYOK AI providers (cloud AI with own key) | Yes | Yes | Yes | Yes |
| Cloud sync (E2EE) | No | Phase C | Phase C | Phase C |
| SSO + audit logs | No | No | No | Phase D |
| Self-hosted | No | No | No | Phase D |

**Phase B revenue (no infra):** Pro at $9/mo ($84/yr) + Team at $19/seat/mo ($180/seat/yr), gated by license key via LemonSqueezy (Merchant of Record). Annual billing default (20% off). Static landing page on Cloudflare Pages ($0). LemonSqueezy handles checkout, tax, invoicing, and customer portal.

---

## Summary

| Phase | Iterations | Items | Timeline | Revenue |
|-------|-----------|-------|----------|---------|
| A | 3 | 7 | Weeks 1-4 | $0 (validation) |
| A.5 | 3.5 | 4 | Weeks 3-5 | First B2B sale |
| B | 4-5 | 10 | Months 2-4 | Pro + Team revenue, $0 infra cost |
| B.5 | 6 | 5 | Months 3-5 | Primary Pro conversion lever ✅ complete |
| B.7 | B.7 | 6 | Months 4-6 | Safety Net Pro features ✅ complete |
| **GATE** | | | | **50+ Pro, 10+ Teams?** |
| C.0 | — | 7 | — | Console foundation ✅ complete (built in parallel with B.7) |
| C | 7-9 | 17 | Months 6-10 | SaaS revenue, hosting costs begin — customer features pending validation gate |
| D | 10-12 | 12 | Month 12+ | Enterprise + multi-tracker |
| Parked | — | 2 | — | — |
| **Total** | | **57** | | |
