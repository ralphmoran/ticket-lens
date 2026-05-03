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
| 4 | ~~Enhancement~~ | ~~**CLI output UX polish**~~ | Done. Session banner (version/profile/server/user in colored box), spinner inside banner, connection status (green/red dot), error classifier with VPN-aware hints, error footer boxes, colored legend (● needs-response / ● aging), interactive triage navigator (arrow keys + Enter to open in browser), profile picker on typo, `--help` with styled output, `--project` alias for `--profile`. Zero new deps. | ~~Small~~ |
| 4a | ~~Feature~~ | ~~**`ticketlens init` setup wizard**~~ | Done. Interactive wizard: profile name → URL (with suggestions) → auth auto-detected from URL (cloud = email+token; server/dc = PAT or Basic) → live connection test (spinner → ● / ●). Optional settings: ticket prefixes, project paths (existence check + create offer), triage statuses (validated live with case-insensitive correction). Loops on `Configure another? y/N`. Final step: profile switcher panel → quick-start panel. Zero new deps. | ~~Medium~~ |
| 4b | ~~Feature~~ | ~~**`ticketlens switch` — profile switcher**~~ | Done. Titled panel (`╭─ Profile ───╮`) with arrow-key selection. Profile name + dim hostname per row. Active profile marked with green `● active` badge. Selecting active profile is a no-op. On switch: spinner → updates `profiles.json` default → error footer on failure. Triggered by `ticketlens switch` subcommand or `p` hotkey during triage. `select-prompt.mjs`, `profile-switcher.mjs`, `saveDefault()` in profile-resolver. | ~~Small~~ |
| 4c | ~~Feature~~ | ~~**`ticketlens config` — full profile editor**~~ | Done. Edit any profile setting without re-running init. Connection section: URL (bare hostnames auto-prefixed https://), auth type (selector pre-positioned on current), email/token (pre-populated; Enter keeps existing). Connection test + retry menu (Retry/Edit credentials/Edit from URL/Skip) if any connection field changes. Optional section: prefixes, paths, triage statuses. Statuses use **merge semantics** — new entries added to existing list, never replacing it. Partial matching: `QA` → `QA Testing`. `ticketlens config [--profile=NAME]`. | ~~Medium~~ |
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
| A1 | Feature | **Triage by assignee (`--assignee`)** | Triage another dev's tickets. Managers check any team member's queue. JQL change, runs locally. Pulled forward for Team-tier value. | Small |
| A2 | Feature | **Triage by sprint (`--sprint`)** | Triage all tickets in a sprint regardless of assignee. Full sprint visibility. Pulled forward for Team-tier value. | Small |
| A3 | Chore | **Static landing page** | Single page on Cloudflare Pages: hero + demo GIF, pricing table, security/data statement, ToS/Privacy, LemonSqueezy overlay checkout, "Contact for Team pricing" CTA. One weekend max. | Small |
| A4 | Chore | **Pilot client pitch** | Live demo on client's Jira + website link + trial license keys. Validate Team-tier willingness, procurement process, seat count. | Small |

**Pilot client pitch checklist:**
- [ ] Informal conversation with decision-maker (validate interest before building)
- [ ] Ship `--assignee` and `--sprint` flags
- [ ] Deploy landing page with pricing + checkout
- [ ] Formal pitch: live demo + website + trial keys

---

## Phase B — Monetize Without Infrastructure (Months 2-4)

Premium features that run 100% locally. No backend needed. License key via LemonSqueezy (Merchant of Record, $0 infra cost).

### Iteration 4 — Premium CLI Features (Pro tier, $8/mo)

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 8 | ~~Feature~~ | ~~**License key system**~~ | Done. LemonSqueezy API activation + validation. `~/.ticketlens/license.json` with tier hierarchy, expiry, revalidation. CLI: `ticketlens activate <KEY>`, `ticketlens license`. 27 tests. | ~~Small~~ |
| 9 | Feature | **Multi-project triage** | Triage across ALL profiles at once in a combined view. Devs working across repos need this daily. Deprioritized — not a deal-closer for first sale. | Small |
| 10 | Feature | **Custom attention rules** | User-defined scoring rules in profile config (e.g. "P1 bugs always urgent", "ignore tickets with label=backlog"). | Medium |
| 11 | Feature | **Scheduled triage (cron)** | Auto-run triage on a schedule, save results to file. Morning triage without remembering to run the command. | Small |
| 12 | Feature | **Ticket history tracking** | Track ticket state over time locally. "This ticket has bounced between CR and Dev 3 times." Stored in `~/.ticketlens/history/`. | Medium |

### Iteration 5 — Premium CLI Features (Team tier, $15/seat/mo)

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 15 | Feature | **Triage by project (`--project`)** | Scope triage to a specific Jira project, not just statuses. | Small |
| 16 | Feature | **Triage by label/priority (`--label`, `--priority`)** | Filter triage to specific labels or priority levels (e.g. only P1/P2). | Small |
| 17 | Feature | **Triage export (CSV/JSON)** | Export triage results for standups, reports, or piping into other tools. | Small |
| 18 | Feature | **Brief templates** | Custom output formats per team/project. Configure in profile which sections to include, field ordering, etc. | Small |
| 19 | Feature | **Response time metrics** | "Your avg response time this week: 4.2 hours." Computed from local triage history. | Medium |

*Note: #13 (`--assignee`) and #14 (`--sprint`) moved to Iteration 3.5 for pilot client pitch.*

---

## Phase B.5 — Compliance Check (Month 3-5)

The killer premium feature. Primary conversion lever from Free to Pro.

### Iteration 6 — Compliance Check

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 20 | Feature | **Requirement extractor** | Parse acceptance criteria, bullet points, "should/must/given-when-then" from ticket description + comments. | Large |
| 21 | Feature | **Ticket-to-commit linker** | Find git/svn commits and branches associated with a ticket key. Build on existing code-ref-parser + VCS detection. | Medium |
| 22 | Feature | **Code diff analyzer** | Compare extracted requirements against actual code changes in linked commits. Map each requirement to FOUND/NOT FOUND. | Large |
| 23 | Feature | **`/jtb compliance TICKET` CLI** | Assemble the compliance report: requirements list, coverage percentage, missing items. | Medium |
| 24 | Feature | **Local usage tracking** | Count compliance checks locally to enforce the free-tier cap (3/month). Store count in `~/.ticketlens/usage.json`. | Small |

**Pricing**: Free tier gets 3 compliance checks/month. Pro ($8/mo) gets unlimited. This is the primary conversion lever — devs hit the cap and realize it's worth $8.

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
| B7-1 | Feature | **Spec drift detection** | Scheduled re-fetch of tickets linked to your open branches. Alerts via stderr (or daily email if digest enabled) when acceptance criteria, scope, or status changed since you last read it. The manual version requires remembering to re-read every ticket mid-sprint — nobody does this. | Medium |
| B7-2 | Feature | **Git hook compliance gate** | `ticketlens install-hooks` installs a pre-push hook that runs compliance check against the branch's linked ticket. Blocks push if coverage < configurable threshold (default: 80%). One-time setup. Makes TicketLens uncancellable — removing it breaks the pipeline. | Medium |
| B7-3 | Feature | **Ticket-to-PR assembler** | `ticketlens pr TICKET-KEY` outputs a PR description template: requirements list, compliance coverage percentage, linked commits, acceptance criteria status. Pipe or paste into GitHub/GitLab. Maps the ticket against what was actually built, not just what the ticket said. | Medium |
| B7-4 | Feature | **Token budget optimizer** | `ticketlens TICKET-KEY --budget 4000` runs a metadata-only prefetch to estimate token cost of the full graph, then prunes low-value content (old status comments, duplicate fields) to fit the target window. Reports what was dropped and why. | Low–Medium |
| B7-5 | Feature | **Compliance ledger** | Append-only local log: `ticket-key → commit-SHA → author → timestamp → coverage %`. Exportable as signed JSON or CSV. Satisfies SOC 2, ISO 27001, HIPAA audit trail requirements without sending data anywhere. | Small–Medium |
| B7-6 | Feature | **Stale delta report** | Upgrades the existing scheduled digest from snapshot to diff. Shows what got *worse* since yesterday: tickets that regressed, gained unanswered comments, crossed staleness threshold. The stored triage history is the moat — nobody else has it. | Medium |

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
| 31 | Feature | **Dev view — Attention Queue** | Auto-refreshing triage in browser. Personal ticket queue + compliance status. | Large |
| 32 | Feature | **Lead view — Team Health** | Tickets needing response (trend), bottlenecks by status, workload per dev. | Large |
| 33 | Feature | **Manager view — Process Metrics** | Time to first commit, QA bounce-back rate, compliance gap trends. | Large |
| 34 | Feature | **Team management** | Invite members, assign roles (dev/lead/manager), manage seats. | Medium |
| 35 | Feature | **Team billing (Stripe)** | Per-seat subscription, seat add/remove, invoicing. | Medium |
| C-T1 | Feature | **Handoff brief (`--handoff`)** | `ticketlens TICKET-KEY --handoff` generates a structured one-pager from comment history: what was attempted, current blockers, open questions. CLI flag + console view. Eliminates blind starts when tickets change hands. | Small–Medium |
| C-T2 | Feature | **Shareable triage snapshot** | `ticketlens triage --share` generates a signed URL (24h TTL, browser-readable, no login required for recipient). Paste into Slack before standup. Recipient needs zero setup — the asymmetry is the product. | Medium |
| C-T3 | Feature | **Standup/PR generator** | `ticketlens standup` reads git log (last 24h), matches commits to ticket keys, generates standup summary or PR body. BYOK for the AI generation step. Team leads buy seats for the whole team because the output benefits their visibility. | Medium |
| C-T4 | Feature | **Parallel collision detection** | Surfaces when two teammates have open branches touching overlapping file paths, based on git blame + ticket scope. Requires cross-seat ticket data — meaningless for solo devs. | High |
| C-T5 | Feature | **Team compliance analytics** | Aggregate gap patterns across team tickets over time: "cart validation tickets have a 40% gap rate." Process failure map, not individual blame. Console view. Data only TicketLens has — computed from compliance check history. | Medium |

### Iteration 9 — Slack/Teams Alerts

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 36 | Feature | **Slack app (OAuth + bot)** | Install to workspace, configure target channel per team. | Medium |
| 37 | Feature | **Needs-response alert** | Push when someone comments on a dev's ticket, no reply in 2+ hours. | Small |
| 38 | Feature | **Aging ticket alert** | Push when ticket sits in CR/QA beyond threshold. | Small |
| 39 | Feature | **Compliance gap alert** | Push when ticket moves to Done with incomplete requirements. | Small |
| 40 | Feature | **Weekly team digest** | Monday morning summary to team channel. | Medium |
| 41 | Feature | **Microsoft Teams integration** | Same alert set for Teams-first orgs. | Medium |

---

## Phase D — Expansion (Month 12+, only if business justifies it)

Build only what paying customers or market demand requires.

### Iteration 10 — Multi-Tracker Support

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 42 | Refactor | **Tracker adapter abstraction** | Pluggable interface so new sources don't fork the whole client. | Medium |
| 43 | Feature | **GitHub Issues as ticket source** | Large OSS audience. Implement `GitHubAdapter`. | Medium |
| 44 | Feature | **Linear as ticket source** | Startup audience. Implement `LinearAdapter`. | Medium |
| 45 | Feature | **Confluence/wiki page fetching** | Fetch referenced Confluence pages and include in brief. | Small |

### Iteration 11 — Platform Features

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 46 | Feature | **"TicketLens for PRs"** | Context-assembly for code review: PR + linked tickets + diff + compliance. | Large |
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
           token budget, ledger, stale delta  ← NEW
           |
    ===== VALIDATION GATE =====
    50+ paying Pro? 10+ teams? Revenue covering time?
           |
Phase C:   Console + Team Intelligence
             ├─ Foundation: admin backend, auth, owner panel, TlIcon, tl-* design system ✅ complete
             └─ Customer features: Iter. 7–9 (cloud sync, team dashboard, Slack) ⏳ post-validation gate
Phase D:   Multi-tracker + Enterprise
```

---

## Pricing Tiers

| | Free | Pro ($8/mo) | Team ($15/seat/mo) | Enterprise (custom) |
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
| Standup/PR generator (`ticketlens standup`) | No | No | Yes | Yes |
| Handoff brief (`--handoff`) | No | No | Yes | Yes |
| Shareable triage snapshot (`--share`) | No | No | Yes | Yes |
| Team compliance analytics | No | No | Yes | Yes |
| Cloud sync (E2EE) | No | Phase C | Phase C | Phase C |
| SSO + audit logs | No | No | No | Phase D |
| Self-hosted | No | No | No | Phase D |

**Phase B revenue (no infra):** Pro at $8/mo + Team at $15/seat/mo, gated by license key via LemonSqueezy (Merchant of Record). Static landing page on Cloudflare Pages ($0). LemonSqueezy handles checkout, tax, invoicing, and customer portal.

---

## Summary

| Phase | Iterations | Items | Timeline | Revenue |
|-------|-----------|-------|----------|---------|
| A | 3 | 7 | Weeks 1-4 | $0 (validation) |
| A.5 | 3.5 | 4 | Weeks 3-5 | First B2B sale |
| B | 4-5 | 10 | Months 2-4 | Pro + Team revenue, $0 infra cost |
| B.5 | 6 | 5 | Months 3-5 | Primary Pro conversion lever |
| B.7 | B.7 | 6 | Months 4-6 | Safety Net Pro features |
| **GATE** | | | | **50+ Pro, 10+ Teams?** |
| C | 7-9 | 17 | Months 6-10 | SaaS revenue, hosting costs begin — foundation complete, customer features pending |
| D | 10-12 | 12 | Month 12+ | Enterprise + multi-tracker |
| Parked | — | 2 | — | — |
| **Total** | | **57** | | |
