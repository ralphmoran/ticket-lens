# TicketLens — Product Roadmap

Iterations 1-2 are shipped. This roadmap tracks everything from Iteration 3 onward.

---

## Iteration 3 — Launch-Ready (Current)

Unblock Cloud users, make the repo presentable for public launch.

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 1 | ~~Bug~~ | ~~**Jira Cloud v3 API migration**~~ | Done. All endpoints support `apiVersion` option. Cloud profiles auto-select v3. Added ADF-to-text converter. | ~~Medium~~ |
| 2 | ~~Bug~~ | ~~**Jira Cloud v3 fetch endpoint**~~ | Done. `fetchTicket`, `fetchCurrentUser`, `fetchStatuses` all support v3 paths. | ~~Small~~ |
| 3 | Feature | **npm package (`ticketlens`)** | Publish to npm so users can `npx ticketlens PROJ-123` instead of cloning + symlinking. | Medium |
| 4 | Chore | **Polish README with GIF demos** | Record 3 GIFs: ticket fetch, triage scan, depth traversal. First impression for GitHub visitors. | Small |
| 5 | Chore | **CONTRIBUTING.md + issue templates** | Signals "this is a real project" and invites open-source contributors. | Small |
| 6 | Chore | **GitHub Discussions enabled** | Community Q&A channel without cluttering Issues. | Small |

### Known Issues Addressed
- ~~Jira Cloud v2 search API deprecated (410 Gone)~~ — resolved in items 1-2

---

## Iteration 4 — Widen the Funnel

Support more than just Jira. Each new tracker source multiplies TAM.

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 7 | Refactor | **Tracker adapter abstraction** | Refactor `jira-client.mjs` into a pluggable interface (`TrackerAdapter`) so new sources don't require forking the whole client. Must be done before adding GitHub/Linear. | Medium |
| 8 | Feature | **GitHub Issues as ticket source** | Huge OSS audience. Many devs use GH Issues, not Jira. Implement `GitHubAdapter`. | Medium |
| 9 | Feature | **Linear as ticket source** | Fast-growing among startups. Shows TicketLens isn't "just a Jira tool." Implement `LinearAdapter`. | Medium |
| 10 | Feature | **Confluence/wiki page fetching** | Tickets often reference Confluence pages for specs. Currently a dead end — fetch and include the page content in the brief. | Small |

---

## Iteration 5 — Compliance Check

The "did my code match the ticket?" feature. Primary conversion lever from Free to Pro.

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 11 | Feature | **Requirement extractor** | Parse acceptance criteria, bullet points, "should/must/given-when-then" statements from ticket description + comments. | Large |
| 12 | Feature | **Ticket-to-commit linker** | Find git/svn commits and branches associated with a ticket key. Build on existing `code-ref-parser.mjs` + VCS detection. | Medium |
| 13 | Feature | **Code diff analyzer** | Compare extracted requirements against actual code changes in linked commits. Map each requirement to FOUND/NOT FOUND. | Large |
| 14 | Feature | **`/jtb compliance TICKET` CLI** | Assemble the compliance report: requirements list, coverage percentage, missing items. | Medium |
| 15 | Feature | **Local usage tracking** | Count compliance checks locally to enforce the free-tier cap (3/month). Store count in `~/.ticketlens/usage.json`. | Small |

---

## Iteration 6 — TicketLens Cloud (Pro tier backend)

Build the SaaS layer. Cloud sync enables Pro billing ($8/mo).

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 16 | Feature | **Cloud API service** | Auth (email/password + OAuth), user accounts, encrypted storage endpoints. | Large |
| 17 | Feature | **E2EE client library** | Encrypt/decrypt briefs client-side before sync. User holds the key, TicketLens Cloud stores opaque blobs. | Large |
| 18 | Feature | **Brief sync (push/pull)** | CLI sends encrypted briefs to cloud, pulls on another machine. Conflict resolution: last-write-wins by timestamp. | Medium |
| 19 | Feature | **Triage history sync** | Persist triage results across machines. Enables "what did I triage last week?" | Medium |
| 20 | Feature | **Ticket-to-commit map sync** | Sync the implementation history built over time across machines. | Small |
| 21 | Feature | **Billing integration (Stripe)** | Pro subscription management, usage metering for compliance checks. | Medium |
| 22 | Feature | **Landing page + signup flow** | Marketing site: problem statement, demo GIFs, pricing table, signup/login. | Medium |

---

## Iteration 7 — Team Dashboard (Team tier)

Web UI for team visibility. Primary revenue driver at $15/seat/mo.

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 23 | Feature | **Dev view — Attention Queue** | Auto-refreshing triage in browser. Shows personal ticket queue + compliance status per ticket. | Large |
| 24 | Feature | **Lead view — Team Health** | Tickets needing response (trend), avg response time, bottlenecks by status (CR/QA wait times), workload per dev (who's overloaded). | Large |
| 25 | Feature | **Manager view — Process Metrics** | Time from assignment to first commit, research time saved per ticket, QA bounce-back rate, compliance gap trends over time. | Large |
| 26 | Feature | **Team management** | Invite members via email, assign roles (dev/lead/manager), manage seats. | Medium |
| 27 | Feature | **Team billing (Stripe)** | Per-seat subscription, seat add/remove, invoicing. | Medium |

---

## Iteration 8 — Slack/Teams Alerts

Push actionable signals to where the team already communicates.

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 28 | Feature | **Slack app (OAuth + bot)** | Install to workspace, configure target channel per team. | Medium |
| 29 | Feature | **Needs-response alert** | Push when someone comments on a dev's ticket and no reply in 2+ hours. | Small |
| 30 | Feature | **Aging ticket alert** | Push when ticket sits in CR/QA beyond configurable threshold. | Small |
| 31 | Feature | **Compliance gap alert** | Push when ticket moves to Done but requirements coverage is incomplete. | Small |
| 32 | Feature | **Weekly team digest** | Monday morning summary posted to team channel: attention items, bottlenecks, wins. | Medium |
| 33 | Feature | **Microsoft Teams integration** | Same alert set for Teams-first organizations. | Medium |

---

## Iteration 9 — IDE Plugins

Meet devs where they already are. Not everyone uses Claude Code or the terminal.

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 34 | Feature | **VS Code extension** | Sidebar panel: ticket brief + triage for current branch. Click to open ticket. Compliance status inline. | Large |
| 35 | Feature | **JetBrains plugin** | Same for IntelliJ/PhpStorm/WebStorm/Rider family. | Large |
| 36 | Feature | **Neovim plugin** | Lua plugin for terminal-native devs. Telescope integration for ticket search. | Medium |

---

## Iteration 10 — Platform Expansion

Multi-tracker, public API, AI features. Full platform play.

| # | Type | Feature | Detail | Effort |
|---|------|---------|--------|--------|
| 37 | Feature | **Azure DevOps source** | Enterprise TAM expansion. Implement `AzureDevOpsAdapter`. | Medium |
| 38 | Feature | **ServiceNow source** | Large enterprise ITSM market. Implement `ServiceNowAdapter`. | Medium |
| 39 | Feature | **"TicketLens for PRs"** | Context-assembly for code review: PR description + linked tickets + diff summary + compliance check. | Large |
| 40 | Feature | **Public API** | REST API for third-party integrations, webhooks for real-time events, custom dashboard builders. | Large |
| 41 | Feature | **AI ticket summarization** | LLM-powered summary of long ticket threads. Condense 50 comments into key decisions + open questions. | Medium |
| 42 | Feature | **AI priority recommendations** | Suggest what to work on next based on urgency signals, deadline proximity, and team bottlenecks. | Medium |
| 43 | Feature | **SSO (SAML/OIDC)** | Enterprise auth requirement for regulated industries. | Medium |
| 44 | Feature | **Self-hosted deployment** | Docker image + Helm chart for on-prem deployment. Air-gapped support. | Large |

---

## Parked / Revisit Later

Features that were explored and deferred. May resurface based on user demand.

| Feature | Status | Notes |
|---------|--------|-------|
| **waitingStatuses filter** | Rolled back (Iteration 2) | Prototype distinguished "waiting on others" from "needs your action." User prefers threshold-based approach. May revisit after real-world usage data from triage. |

---

## Dependency Chain

The critical path through the iterations:

```
Iteration 3: v3 API fix + npm package
      |
Iteration 4: Tracker adapter abstraction -> GitHub/Linear sources
      |
Iteration 5: Compliance check (uses tracker + VCS)
      |
Iteration 6: Cloud backend (stores compliance results + briefs)
      |
Iteration 7: Team dashboard (consumes cloud data)
      |
Iteration 8: Slack alerts (triggered by dashboard signals)
```

Iterations 9 (IDE plugins) and 10 (platform expansion) can be parallelized and reordered based on user demand. IDE plugins can start as early as Iteration 5 since they only need the CLI layer.

---

## Summary

| Iteration | Theme | Items | Revenue Impact |
|-----------|-------|-------|---------------|
| 3 | Launch-Ready | 6 | Unblocks Cloud users (50% of TAM) |
| 4 | Widen the Funnel | 4 | GitHub/Linear users enter the funnel |
| 5 | Compliance Check | 5 | Free-to-Pro conversion lever (3/mo cap) |
| 6 | TicketLens Cloud | 7 | Pro tier revenue ($8/mo) |
| 7 | Team Dashboard | 5 | Team tier revenue ($15/seat/mo) |
| 8 | Slack/Teams Alerts | 6 | Team tier stickiness + expansion |
| 9 | IDE Plugins | 3 | Widens distribution beyond CLI |
| 10 | Platform Expansion | 8 | Enterprise tier + new markets |
| Parked | Deferred | 1 | - |
| **Total** | | **45** | |
