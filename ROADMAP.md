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
| 3 | Feature | **npm package (`ticketlens`)** | Publish to npm so users can `npx ticketlens PROJ-123` instead of cloning + symlinking. | Medium |
| 4 | Chore | **Polish README with GIF demos** | Record 3 GIFs: ticket fetch, triage scan, depth traversal. First impression for GitHub visitors. | Small |
| 5 | Chore | **CONTRIBUTING.md + issue templates** | Signals "this is a real project" and invites open-source contributors. | Small |
| 6 | Chore | **GitHub Discussions enabled** | Community Q&A channel without cluttering Issues. | Small |

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

## Phase B — Monetize Without Infrastructure (Months 2-4)

Premium features that run 100% locally. No backend needed. License key via Gumroad/LemonSqueezy ($0 infra cost).

### Iteration 4 — Premium CLI Features (Pro tier, $8/mo)

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 7 | Feature | **License key system** | `~/.ticketlens/license.json` with key validation. Buy on Gumroad/LemonSqueezy, paste key. No backend needed. | Small |
| 8 | Feature | **Multi-project triage** | Triage across ALL profiles at once in a combined view. Devs working across repos need this daily. | Small |
| 9 | Feature | **Custom attention rules** | User-defined scoring rules in profile config (e.g. "P1 bugs always urgent", "ignore tickets with label=backlog"). | Medium |
| 10 | Feature | **Scheduled triage (cron)** | Auto-run triage on a schedule, save results to file. Morning triage without remembering to run the command. | Small |
| 11 | Feature | **Ticket history tracking** | Track ticket state over time locally. "This ticket has bounced between CR and Dev 3 times." Stored in `~/.ticketlens/history/`. | Medium |

### Iteration 5 — Premium CLI Features (Team tier, $15/seat/mo)

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 12 | Feature | **Triage by assignee (`--assignee`)** | Triage another dev's tickets. Managers check any team member's queue. JQL change, runs locally. | Small |
| 13 | Feature | **Triage by sprint (`--sprint`)** | Triage all tickets in a sprint regardless of assignee. Full sprint visibility. | Small |
| 14 | Feature | **Triage by project (`--project`)** | Scope triage to a specific Jira project, not just statuses. | Small |
| 15 | Feature | **Triage by label/priority (`--label`, `--priority`)** | Filter triage to specific labels or priority levels (e.g. only P1/P2). | Small |
| 16 | Feature | **Triage export (CSV/JSON)** | Export triage results for standups, reports, or piping into other tools. | Small |
| 17 | Feature | **Brief templates** | Custom output formats per team/project. Configure in profile which sections to include, field ordering, etc. | Small |
| 18 | Feature | **Response time metrics** | "Your avg response time this week: 4.2 hours." Computed from local triage history. | Medium |

---

## Phase B.5 — Compliance Check (Month 3-5)

The killer premium feature. Primary conversion lever from Free to Pro.

### Iteration 6 — Compliance Check

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 19 | Feature | **Requirement extractor** | Parse acceptance criteria, bullet points, "should/must/given-when-then" from ticket description + comments. | Large |
| 20 | Feature | **Ticket-to-commit linker** | Find git/svn commits and branches associated with a ticket key. Build on existing code-ref-parser + VCS detection. | Medium |
| 21 | Feature | **Code diff analyzer** | Compare extracted requirements against actual code changes in linked commits. Map each requirement to FOUND/NOT FOUND. | Large |
| 22 | Feature | **`/jtb compliance TICKET` CLI** | Assemble the compliance report: requirements list, coverage percentage, missing items. | Medium |
| 23 | Feature | **Local usage tracking** | Count compliance checks locally to enforce the free-tier cap (3/month). Store count in `~/.ticketlens/usage.json`. | Small |

**Pricing**: Free tier gets 3 compliance checks/month. Pro ($8/mo) gets unlimited. This is the primary conversion lever — devs hit the cap and realize it's worth $8.

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
| 24 | Feature | **Cloud API service** | Auth (email/password + OAuth), user accounts, encrypted storage endpoints. | Large |
| 25 | Feature | **E2EE client library** | Encrypt/decrypt briefs client-side before sync. User holds the key, TicketLens Cloud stores opaque blobs. | Large |
| 26 | Feature | **Brief sync (push/pull)** | CLI sends encrypted briefs to cloud, pulls on another machine. Conflict resolution: last-write-wins. | Medium |
| 27 | Feature | **Triage history sync** | Persist triage results across machines. "What did I triage last week?" | Medium |
| 28 | Feature | **Billing migration (Stripe)** | Move from Gumroad/LemonSqueezy to Stripe for subscription management + usage metering. | Medium |
| 29 | Feature | **Landing page + signup flow** | Marketing site: problem statement, demo GIFs, pricing table, signup/login. | Medium |

### Iteration 8 — Team Dashboard (Team tier)

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 30 | Feature | **Dev view — Attention Queue** | Auto-refreshing triage in browser. Personal ticket queue + compliance status. | Large |
| 31 | Feature | **Lead view — Team Health** | Tickets needing response (trend), bottlenecks by status, workload per dev. | Large |
| 32 | Feature | **Manager view — Process Metrics** | Time to first commit, QA bounce-back rate, compliance gap trends. | Large |
| 33 | Feature | **Team management** | Invite members, assign roles (dev/lead/manager), manage seats. | Medium |
| 34 | Feature | **Team billing (Stripe)** | Per-seat subscription, seat add/remove, invoicing. | Medium |

### Iteration 9 — Slack/Teams Alerts

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 35 | Feature | **Slack app (OAuth + bot)** | Install to workspace, configure target channel per team. | Medium |
| 36 | Feature | **Needs-response alert** | Push when someone comments on a dev's ticket, no reply in 2+ hours. | Small |
| 37 | Feature | **Aging ticket alert** | Push when ticket sits in CR/QA beyond threshold. | Small |
| 38 | Feature | **Compliance gap alert** | Push when ticket moves to Done with incomplete requirements. | Small |
| 39 | Feature | **Weekly team digest** | Monday morning summary to team channel. | Medium |
| 40 | Feature | **Microsoft Teams integration** | Same alert set for Teams-first orgs. | Medium |

---

## Phase D — Expansion (Month 12+, only if business justifies it)

Build only what paying customers or market demand requires.

### Iteration 10 — Multi-Tracker Support

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 41 | Refactor | **Tracker adapter abstraction** | Pluggable interface so new sources don't fork the whole client. | Medium |
| 42 | Feature | **GitHub Issues as ticket source** | Large OSS audience. Implement `GitHubAdapter`. | Medium |
| 43 | Feature | **Linear as ticket source** | Startup audience. Implement `LinearAdapter`. | Medium |
| 44 | Feature | **Confluence/wiki page fetching** | Fetch referenced Confluence pages and include in brief. | Small |

### Iteration 11 — Platform Features

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 45 | Feature | **"TicketLens for PRs"** | Context-assembly for code review: PR + linked tickets + diff + compliance. | Large |
| 46 | Feature | **Public API** | REST API for third-party integrations, webhooks. | Large |
| 47 | Feature | **AI ticket summarization** | LLM-powered summary of long ticket threads. | Medium |
| 48 | Feature | **AI priority recommendations** | Suggest what to work on next based on urgency + deadlines. | Medium |

### Iteration 12 — Enterprise

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 49 | Feature | **Azure DevOps source** | Enterprise TAM expansion. | Medium |
| 50 | Feature | **ServiceNow source** | Large enterprise ITSM market. | Medium |
| 51 | Feature | **SSO (SAML/OIDC)** | Enterprise auth requirement. | Medium |
| 52 | Feature | **Self-hosted deployment** | Docker/Helm for regulated industries. | Large |

---

## Parked / Revisit Later

| Feature | Status | Notes |
|---------|--------|-------|
| **waitingStatuses filter** | Rolled back (Iteration 2) | May revisit after real-world triage usage data. |
| **IDE Plugins (VS Code, JetBrains, Neovim)** | Deferred | Huge effort for a solopreneur. Let community build these after the CLI is established. Consider bounties or plugin grants. |

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
Phase A: Launch (Iteration 3)
    |
Phase B: Premium CLI — revenue with $0 infra (Iterations 4-5)
    |
Phase B.5: Compliance Check — killer Pro feature (Iteration 6)
    |
    ===== VALIDATION GATE =====
    50+ paying users? 10+ teams?
    |
Phase C: Cloud + Dashboard + Alerts (Iterations 7-9)
    |
Phase D: Multi-tracker + Enterprise (Iterations 10-12)
```

---

## Pricing Tiers

| | Free | Pro ($8/mo) | Team ($15/seat/mo) | Enterprise (custom) |
|--|------|------------|-------------------|-----------|
| CLI fetch + triage | Yes | Yes | Yes | Yes |
| Compliance check | 3/month | Unlimited | Unlimited | Unlimited |
| Multi-project triage | No | Yes | Yes | Yes |
| Custom attention rules | No | Yes | Yes | Yes |
| Scheduled triage | No | Yes | Yes | Yes |
| Ticket history tracking | No | Yes | Yes | Yes |
| `--assignee` flag | No | No | Yes | Yes |
| `--sprint` flag | No | No | Yes | Yes |
| `--project`/`--label`/`--priority` | No | No | Yes | Yes |
| Triage export (CSV/JSON) | No | No | Yes | Yes |
| Brief templates | No | No | Yes | Yes |
| Response time metrics | No | No | Yes | Yes |
| Cloud sync (E2EE) | No | Phase C | Phase C | Phase C |
| Web dashboard | No | Phase C | Phase C | Phase C |
| Slack/Teams alerts | No | No | Phase C | Phase C |
| SSO + audit logs | No | No | No | Phase D |
| Self-hosted | No | No | No | Phase D |

**Phase B revenue (no infra):** Pro at $8/mo + Team at $15/seat/mo, gated by license key via Gumroad/LemonSqueezy.

---

## Summary

| Phase | Iterations | Items | Timeline | Revenue |
|-------|-----------|-------|----------|---------|
| A | 3 | 6 | Weeks 1-4 | $0 (validation) |
| B | 4-5 | 12 | Months 2-4 | First revenue, $0 infra cost |
| B.5 | 6 | 5 | Months 3-5 | Primary Pro conversion lever |
| **GATE** | | | | **50+ Pro, 10+ Teams?** |
| C | 7-9 | 17 | Months 6-10 | SaaS revenue, hosting costs begin |
| D | 10-12 | 12 | Month 12+ | Enterprise + multi-tracker |
| Parked | — | 2 | — | — |
| **Total** | | **54** | | |
