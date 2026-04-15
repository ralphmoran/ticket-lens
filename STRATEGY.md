# TicketLens — Go-to-Market & Growth Strategy

## Executive Summary

TicketLens is a developer productivity tool that eliminates the context-switching tax of Jira research before implementation. It fetches ticket context, linked issues, comments, and code references — then maps them to the local codebase. The product sits at the intersection of two massive trends: **AI-assisted development** and **developer experience (DX) tooling**.

The strategy: launch as a free, open-source Claude Code skill, build community trust and distribution, then expand into a standalone product with premium features targeting individuals and teams.

**GitHub**: https://github.com/ralphmoran/ticket-lens

---

## 1. Market Analysis

### Problem Statement

Developers lose 15-30 minutes per ticket gathering context before writing a single line of code. They tab between Jira, source control, Slack, and their IDE — reassembling context that already exists but is scattered across tools.

### Target Market

| Segment | Size | Pain Level | Willingness to Pay |
|---------|------|------------|-------------------|
| Solo devs using Claude Code | ~50K (growing fast) | Medium | Low (OSS first) |
| Small engineering teams (2-10) | ~500K teams globally | High | Medium ($10-25/seat/mo) |
| Mid-market engineering orgs (10-100) | ~100K orgs | Very High | High ($25-50/seat/mo) |
| Enterprise (100+ devs) | ~20K orgs | Critical | Very High (custom pricing) |

### Competitive Landscape

| Competitor | What They Do | TicketLens Advantage |
|-----------|-------------|---------------------|
| Jira IDE plugins | Basic ticket view in IDE | Deep linked-ticket traversal, code ref extraction, triage scoring |
| Linear/Shortcut | Modern PM tools (not Jira) | TicketLens serves the massive Jira installed base (75%+ market) |
| AI code assistants (Copilot, Cursor) | Code generation | TicketLens handles the *research* phase these tools skip |
| Claude Code / AI assistants (direct Jira) | API calls, ticket creation, JQL | TicketLens: privacy (no data to Anthropic), 60–80% token savings, scriptable/pipeable, deterministic — complements rather than competes |
| Stepsize/Sleuth | Dev workflow analytics | TicketLens is action-oriented (what to work on now), not retrospective |

### Atlassian MCP (Official Claude Plugin)

- **Installs:** 46,149 — **Auth:** OAuth 2.1 — **Scope:** Atlassian Cloud only
- **Skills:** `/spec-to-backlog`, `/capture-tasks-from-meeting-notes`, `/generate-status-report`, `/triage-issue`, `/search-company-knowledge`
- **Write operations:** Create Jira issues, Confluence pages, bulk import
- **Data flow:** Your Jira → `mcp.atlassian.com` → Claude API (data transits Atlassian's cloud)

**What it cannot do:**
- No local-first / air-gap mode — all data transits Atlassian's cloud (CVE-2026-27825: critical SSRF/RCE in Atlassian MCP server disclosed 2026)
- No triage queue ("what needs my attention right now")
- No VCS/commit linking (ticket ↔ code ↔ PR)
- No compliance check (requirements vs actual code changes)
- No Jira Server or Data Center support (cloud-only OAuth)
- No scheduled digest
- No token-efficient brief assembly (passes raw API responses)
- No BYOK path

**Verdict:** Complementary for cloud teams, but a security liability for Server/DC shops and regulated industries. TicketLens is the local-first alternative: no OAuth, no relay, no CVEs.

> "Atlassian MCP writes your tickets. TicketLens tells you which ones need you right now."

### Moat Potential

1. **Privacy architecture** — Local-first with metadata-only SaaS. Enterprise can't use Claude Code for ticket context (data goes to Anthropic). TicketLens passes security review in days, not weeks.
2. **Scriptability** — Standard CLI output enables automation AI assistants fundamentally cannot do: cron, pipes, git hooks, CI/CD integration.
3. **Token efficiency** — Preprocessed, compressed briefs vs raw API noise. For high-frequency teams, the economics favor TicketLens over AI-direct at scale.
4. **Integration depth** — Multi-instance Jira (Cloud + Server/DC), VCS-agnostic, zero npm dependencies.
5. **Claude Code ecosystem** — First-mover in the Claude Code skills marketplace; `/jtb` is the reference implementation.
6. **CI integration** — `ticketlens install-hooks` embeds compliance gate in pre-push and CI pipelines. Once in the pipeline, removal breaks the build — same category as linters and test runners. This is the path from "useful tool" to "infrastructure we can't remove."

---

## 2. Product Strategy

### Phase A: Launch & Validate (Weeks 1-4)

**Goal**: Get the product in front of people. Measure demand before building premium features.

Current state: 134 tests, clean architecture, multi-account support, Jira Cloud v3 migration complete, zero deps.

**Actions:**
- [x] Fix Jira Cloud v3 API migration (unblocks Cloud users)
- [ ] Publish `ticketlens` npm package for easy global install
- [ ] Polish README with GIF demos (ticket fetch, triage scan, depth traversal)
- [ ] CONTRIBUTING.md + issue templates + GitHub Discussions
- [ ] Launch: Hacker News, Reddit, Dev.to, Twitter, Discord/Slack communities

**Validation signals:** GitHub stars (100+ week 1), npm downloads, GitHub issues/discussions, feature requests for paid features.

### Phase B: Premium CLI — Revenue with $0 Infra (Months 2-4)

**Goal**: First revenue. Premium features that run 100% locally. No backend needed.

**Monetization**: License key via LemonSqueezy (Merchant of Record — handles tax, invoicing, customer portal). Key stored in `~/.ticketlens/license.json`, validated via LemonSqueezy API with offline grace period. Static landing page on Cloudflare Pages ($0 infra).

**Tier philosophy:**
- **Free** — Everything local. Me, now, one ticket. No limits on depth, fetch, or triage.
- **Pro ($8/mo)** — Individual mistake prevention. The free tier tells you the truth when you ask it. Pro tells you when you forgot to ask. Features: spec drift detection, git hook compliance gate, ticket-to-PR assembler, token budget optimizer, compliance ledger, stale delta report, AI summary (BYOK), configurable cache TTL, unlimited compliance checks, scheduled digest.
- **Team ($15/seat/mo)** — Shared intelligence. Work that crosses people, time, and systems. Adds: parallel collision detection, standup/PR generator, handoff brief, shareable triage snapshot, team compliance analytics, --assignee/--sprint flags, CSV/JSON export, seat management, console team panel.

Key principle: if a feature touches another human, persists state beyond a session, or integrates with a second system → Team tier. If it prevents individual mistakes without needing infrastructure → Pro tier.

### Phase B.5: Compliance Check — Killer Pro Feature (Months 3-5)

**Goal**: Primary conversion lever from Free to Pro.

Free tier gets 3 compliance checks/month. Pro gets unlimited. This is the cap that drives upgrades.

### VALIDATION GATE

**Stop and assess before building infrastructure:**
- 50+ paying Pro users?
- 10+ teams asking for the dashboard?
- Revenue covering time investment?

If yes: proceed to Phase C. If no: iterate on Phase B, double down on marketing, or pivot.

### Phase C: Infrastructure (Month 6+, only if demand is proven)

**Goal**: SaaS revenue. Build cloud backend and web dashboard ONLY when paying users demand it.

### Phase D: Expansion (Month 12+)

**Goal**: Multi-tracker support, enterprise features. Build only what paying customers require.

#### Pricing Tiers

| | Free | Pro ($8/mo) | Team ($15/seat/mo) | Enterprise |
|--|------|------------|-------------------|-----------|
| CLI fetch + triage | Yes | Yes | Yes | Yes |
| `--depth=2` (full graph) | Yes | Yes | Yes | Yes |
| Compliance check | 3/month | Unlimited | Unlimited | Unlimited |
| `--check` (VCS diff context) | Yes | Yes | Yes | Yes |
| 4h brief cache | Yes | Yes | Yes | Yes |
| Spec drift detection | No | Yes | Yes | Yes |
| Git hook compliance gate | No | Yes | Yes | Yes |
| Ticket-to-PR assembler | No | Yes | Yes | Yes |
| Token budget optimizer (`--budget N`) | No | Yes | Yes | Yes |
| Compliance ledger (audit trail) | No | Yes | Yes | Yes |
| Stale delta report | No | Yes | Yes | Yes |
| AI summary `--summarize` (BYOK) | No | Yes | Yes | Yes |
| Configurable cache TTL | No | Yes | Yes | Yes |
| Scheduled digest | No | Yes | Yes | Yes |
| Ticket history tracking | No | Yes | Yes | Yes |
| Console dashboard | No | Yes | Yes | Yes |
| Parallel collision detection | No | No | Yes | Yes |
| Standup/PR generator | No | No | Yes | Yes |
| Handoff brief (`--handoff`) | No | No | Yes | Yes |
| Shareable triage snapshot | No | No | Yes | Yes |
| Team compliance analytics | No | No | Yes | Yes |
| `--assignee` / `--sprint` flags | No | No | Yes | Yes |
| Triage export (CSV/JSON) | No | No | Yes | Yes |
| Team triage dashboard | No | No | Yes | Yes |
| Slack/Teams alerts | No | No | Yes | Yes |
| Cloud sync (E2EE) | No | Phase C | Phase C | Phase C |
| SSO + audit logs | No | No | No | Phase D |
| Self-hosted deployment | No | No | No | Phase D |

#### Pro Tier — Individual Cloud Sync

The individual Pro tier solves a real pain point: **"Your ticket research follows you across machines."**

What gets synced to TicketLens Cloud (E2EE — encrypted on device, TicketLens never sees plaintext):

| Synced Data | Value |
|-------------|-------|
| Cached ticket briefs | Switch from desktop to laptop, context is there |
| Triage history | "What did I triage last week?" without re-fetching |
| Code reference mappings | Which files you touched for which tickets |
| Ticket-to-commit links | Built over time, becomes your implementation history |

#### Compliance Check — "Did the code match the ticket?"

Compares ticket requirements against shipped code to verify implementation completeness.

```
/jtb compliance PROJ-123

Ticket Requirements:
  1. Add validation for empty cart         -> FOUND in src/CartService.php:42
  2. Return 400 error with message         -> FOUND in src/CartController.php:88
  3. Add unit test for edge case           -> NOT FOUND
  4. Update API docs                       -> NOT FOUND

Coverage: 2/4 requirements addressed (50%)
Missing: unit test, API docs update
```

How it works:
1. Parse ticket description + comments for requirements (acceptance criteria, bullet points, "should/must" statements)
2. Find commits/branches linked to the ticket
3. Diff the code changes against the extracted requirements
4. Report what's covered and what's missing

Who pays for this:
- **Individual devs**: "Did I miss anything before I move this to CR?"
- **Team leads**: "Is this ticket actually done or just moved to Done?"
- **QA**: "What should I test? What did the dev say they changed?"

Free tier gets 3 compliance checks/month (conversion lever — devs hit the cap and realize it's worth $8).

#### Team Dashboard — Three Views for Three Roles

**Developer daily view — "What should I work on right now?"**

```
My Attention Queue              Last refreshed: 2 min ago
---------------------------------------------------------
1. PROJ-123  Sarah left CR feedback       45 min ago
2. PROJ-456  QA rejected, needs fix       3 hours ago
3. PROJ-789  No activity for 6 days       stale

Compliance Status
---------------------------------------------------------
PROJ-100  In CR    3/3 requirements covered    READY
PROJ-200  In CR    2/4 requirements covered    GAPS FOUND
```

Always-on, auto-refreshing `/jtb triage` in a browser tab. Devs don't have to remember to run the command.

**Tech Lead CLI tools — "Check on any team member or sprint"**

```
/jtb triage --assignee=jacky        # Triage Jacky's tickets
/jtb triage --sprint="Sprint 5"     # Triage all tickets in a sprint
/jtb triage --assignee=alice --stale=3  # Alice's stale tickets
```

Premium (Team+): Free tier only triages your own tickets. `--assignee` and `--sprint` flags require a Team subscription. Gives leads and managers visibility into any team member's queue or an entire sprint without switching Jira accounts.

**Tech Lead weekly view — "Where is my team stuck?"**

```
Team Health                     This Week
---------------------------------------------------------
Tickets needing response:       7  (up from 3 last week)
Avg response time:              4.2 hours
Stale tickets (>5 days):        2
Compliance gaps found:          3 tickets shipped with gaps

Bottlenecks
---------------------------------------------------------
Code Review:    5 tickets waiting avg 2.3 days
QA:             3 tickets waiting avg 1.1 days
Blocked:        1 ticket (PROJ-500, waiting on API team)

Who's Overloaded
---------------------------------------------------------
Alice:  12 active tickets, 4 needing response
Bob:    6 active tickets, 0 needing response
Carol:  8 active tickets, 2 needing response
```

Value: The lead sees at a glance that Alice is drowning and Bob has capacity. Rebalance work before standup instead of discovering it during standup.

**Engineering Manager monthly view — "Is our process working?"**

```
March 2026
---------------------------------------------------------
Avg time from assignment to first commit:    1.2 days
Avg ticket research time saved:              22 min/ticket
Tickets shipped with compliance gaps:        8% (down from 15%)
Tickets that bounced back from QA:           12%
Team response time trend:                    improving
```

Value: Justifies the TicketLens subscription to their VP. "We reduced QA bounce-backs by 7% and cut research time by 22 minutes per ticket."

#### Slack/Teams Alerts — Actionable Signals Only

Every alert requires action. No "ticket updated" spam.

| Alert | When | Who Gets It |
|-------|------|-------------|
| "PROJ-123 needs your response" | Someone comments on your ticket, no reply in 2+ hours | Assigned dev |
| "PROJ-456 has been in CR for 3 days" | Ticket aging in review state | Assigned dev + reviewer |
| "PROJ-789 shipped with compliance gaps" | Ticket moved to Done but requirements not fully covered | Dev + lead |
| "Alice has 5 unresponded tickets" | Individual backlog growing | Lead (configurable) |
| Weekly digest | Monday morning summary | Whole team channel |

See [ROADMAP.md](ROADMAP.md) for the full iteration plan (54 features across 12 iterations).

---

## 3. Growth Channels

### Channel 1: Claude Code Ecosystem (Primary — Months 1-6)

**Why**: Claude Code users are the exact ICP. They're already in the terminal, already using AI for dev work, and already looking for skills to install.

**Tactics:**
- Be the first high-quality Jira skill in the Claude Code skill marketplace
- Get featured in Anthropic's Claude Code documentation/blog
- Cross-promote with other popular Claude Code skills
- Write "Building a Claude Code Skill" tutorial series (positions you as ecosystem expert)

**Expected CAC**: $0 (organic)
**Expected conversion**: 5-10% of Claude Code Jira users

### Channel 2: Content Marketing & SEO (Primary — Months 3-12)

**Why**: "Jira productivity", "developer workflow optimization" have high search volume and low competition.

**Content pillars:**
1. "Developer productivity" — how to reduce context-switching
2. "Jira power user" — advanced Jira workflows and automation
3. "AI-assisted development" — using AI tools for research, not just code generation
4. "Engineering management" — team ticket health and velocity metrics

**Target keywords:**
- "jira cli tool" (1.2K/mo, low competition)
- "jira developer productivity" (800/mo)
- "jira ticket context" (400/mo)
- "developer context switching" (2.1K/mo)

### Channel 3: Developer Communities (Secondary — Months 1-6)

**Platforms:**
- Hacker News (launch post + Show HN)
- Reddit: r/programming, r/devops, r/jira, r/ExperiencedDevs
- Dev.to / Hashnode articles
- Twitter/X developer community
- YouTube: short demo videos (< 3 min)

**Tactic**: Don't pitch. Share the problem and show the solution. "I was spending 30 minutes per ticket gathering context. Here's the tool I built to fix it."

### Channel 4: Viral Loops (Month 6+)

**Team-based virality:**
- When one dev on a team uses TicketLens, their ticket briefs are higher quality
- Others ask "how did you get all that context so fast?"
- Built-in "Powered by TicketLens" footer in shared briefs
- Referral: invite 3 teammates, unlock team dashboard free for a month

**Viral coefficient target**: K = 0.3 initially (each user brings 0.3 new users)

---

## 4. Positioning & Messaging

### One-liner
**"Your AI assistant shouldn't need to read your tickets."**

### Elevator pitch
TicketLens fetches Jira context locally, compresses it into structured briefs, and feeds it to your AI coding tools — without your ticket content ever leaving your machine. It's not a tab-switching fix; it's the data layer that makes AI-assisted development cheaper, faster, and privacy-safe.

### Positioning statement
For developers and teams using Jira with AI coding tools, TicketLens is the local-first data layer between Jira and your AI assistant. Unlike prompting your AI to fetch tickets directly (expensive, sends data to third parties, not scriptable), TicketLens preprocesses ticket context on-device, compresses it 60–80%, and delivers structured briefs to Claude Code, Cursor, or any AI tool — at a fraction of the token cost, with zero data leaving your machine.

### Key differentiators to emphasize
1. **Privacy-first** — Ticket content never leaves your machine. No data relay, no third-party servers. Open source — verify it yourself.
2. **AI amplifier** — `/jtb TICKET-KEY` gives your AI tool structured, compressed context at 60–80% fewer tokens than raw API calls.
3. **Scriptable automation** — Standard CLI: pipe, cron, git hooks, CI/CD. AI assistants can't be piped.
4. **Deterministic output** — Same structured output every run. Safe for automation and reporting.
5. **Works everywhere** — Jira Cloud, Server, DC. Zero npm dependencies. Any AI tool.

---

## 5. Launch Plan

### Pre-Launch (2 weeks before)

- [ ] Record 3 demo GIFs: ticket fetch, triage scan, depth traversal
- [ ] Write launch blog post: "I built a tool that saves me 30 min per Jira ticket"
- [ ] Set up landing page (simple, one-page: problem > demo > install)
- [ ] Set up GitHub repo with CONTRIBUTING.md, issue templates, discussions enabled
- [ ] Seed 5-10 GitHub issues for contributors to pick up
- [ ] Line up 3-5 beta testers to leave authentic GitHub stars/testimonials

### Launch Day

- [ ] Publish GitHub repo
- [ ] Post on Hacker News (Show HN)
- [ ] Post on Reddit r/programming + r/ExperiencedDevs
- [ ] Tweet thread with demo GIFs
- [ ] Dev.to launch article
- [ ] Share in relevant Discord/Slack communities

### Post-Launch (Weeks 1-4)

- [ ] Respond to every GitHub issue within 24 hours
- [ ] Ship 2-3 quick wins based on community feedback
- [ ] Write follow-up blog: "What happened when I launched TicketLens on HN"
- [ ] Reach out to dev tool newsletters for features
- [ ] Start tracking: GitHub stars, clones, active users (via opt-in telemetry)

---

## 6. Key Metrics & Milestones

### North Star Metric
**Weekly Active Users (WAU)** — developers who run at least one TicketLens command per week.

### Milestone Targets

| Milestone | Timeline | Target |
|-----------|----------|--------|
| GitHub launch | Month 1 | 100 stars, 50 clones |
| Community traction | Month 3 | 500 stars, 100 WAU |
| First paid users | Month 6 | 2,000 stars, 500 WAU, $1K MRR |
| Product-market fit | Month 9 | 5,000 stars, 1,000 WAU, $5K MRR |
| Growth inflection | Month 12 | 10,000 stars, 3,000 WAU, $25K MRR |

### Unit Economics Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| CAC (organic) | < $5 | Content + community driven |
| CAC (paid, later) | < $50 | Dev tool ads are expensive |
| LTV (team plan) | $540 | $15/seat x 3 seats avg x 12 months |
| LTV:CAC | > 10:1 | Organic-first model |
| Monthly churn | < 5% | Sticky once integrated into workflow |
| Free-to-paid conversion | 3-5% | Standard open-core conversion |

---

## 7. Privacy & Data Architecture

### Design Principle: Metadata-Only SaaS

TicketLens Cloud stores signals, not content. This is a core architectural decision and a competitive advantage.

```
Developer's machine (private)         TicketLens Cloud (paid)
---------------------------------     ---------------------------------
/jtb PROJ-123                         Receives:
  -> Fetches from Jira directly         - ticket key: PROJ-123
  -> Builds full brief locally          - urgency: needs-response
  -> Displays in terminal               - scored at: 2026-03-06T20:00Z
  -> OPTIONALLY sends metadata ->       - status: Code Review
                                        - stale days: 3

                                      Never receives:
                                        - ticket descriptions
                                        - comment bodies
                                        - code references
                                        - file paths
                                        - people's names (hashed IDs)
```

### What's Stored Where

| Feature | Data Type | Where It Lives | Encrypted? |
|---------|-----------|---------------|-----------|
| CLI fetch/triage | Full ticket content | Developer's machine only | N/A |
| Cloud sync (Pro) | Cached briefs | TicketLens Cloud | E2EE (client-side keys) |
| Team dashboard | Metadata + scores | TicketLens Cloud | At rest + transit |
| Compliance check | Requirements + coverage map | Developer's machine | N/A |
| Analytics | Aggregated counts, response times | TicketLens Cloud | At rest + transit |
| Slack alerts | Ticket key + signal type | Transient (not stored) | Transit |

### Why This Beats Competitors

Most dev tools (Stepsize, Sleuth, LinearB) require full Jira OAuth and store everything server-side.

| | Traditional SaaS | TicketLens |
|--|-----------------|------------|
| Jira data flows to | Their servers | Developer's machine directly |
| What they store | Everything | Metadata only (or E2EE briefs) |
| Works air-gapped | No | Yes (free tier) |
| SOC2/HIPAA feasible | Expensive (lots of sensitive data) | Simpler (minimal data surface) |
| Enterprise security review | Weeks | Days |

### Sales Pitch for Security-Conscious Teams

> "TicketLens runs on your developers' machines. It talks directly to YOUR Jira instance using YOUR existing credentials. Our cloud layer only sees metadata — ticket keys and urgency scores. We never see ticket content, comments, or code. The CLI is open-source — verify it yourself."

---

## 8. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|-----------|
| Jira loses market share to Linear/etc | Shrinks TAM | Medium | Build multi-tracker support early (Phase 4) |
| Claude Code doesn't grow as expected | Limits primary channel | Low | IDE plugins provide alternative distribution |
| Atlassian builds similar feature | Direct competition | Medium | Move fast, build community moat, multi-tracker support |
| Open-source stays free, no one pays | No revenue | Medium | Team features provide clear value beyond solo use |
| Enterprise security concerns | Blocks enterprise sales | High | Privacy-first architecture is already an advantage; add SOC2 later |

---

## 9. Immediate Next Steps (This Week)

1. ~~**Fix Jira Cloud v3 API**~~ — Done. Cloud profiles auto-select v3 API.
2. **Publish npm package** — `npx ticketlens PROJ-123` for easy global install
3. **Polish GitHub repo** — CONTRIBUTING.md, issue templates, discussions enabled, GIF demos in README
4. **Record demo GIFs** — 3 short GIFs showing the core workflow
5. **Draft HN launch post** — "Show HN: TicketLens — stop Jira tab-switching, start coding"

---

## Revenue Projection (Conservative)

| Month | WAU | Pro ($8/mo) | Teams | Avg Seats | Team MRR | Pro MRR | Total MRR |
|-------|-----|------------|-------|-----------|----------|---------|-----------|
| 3 | 100 | 0 | 0 | - | $0 | $0 | $0 |
| 6 | 500 | 30 | 10 | 3 | $450 | $240 | $690 |
| 9 | 1,000 | 80 | 30 | 4 | $1,800 | $640 | $2,440 |
| 12 | 3,000 | 200 | 80 | 5 | $6,000 | $1,600 | $7,600 |
| 18 | 8,000 | 500 | 200 | 6 | $18,000 | $4,000 | $22,000 |
| 24 | 15,000 | 1,200 | 500 | 8 | $60,000 | $9,600 | $69,600 |

These are conservative. Developer tools with genuine viral loops (team adoption) can grow much faster once they hit product-market fit. The compliance check free-tier cap (3/month) is expected to be the primary Pro conversion driver.

---

*Strategy authored in Growth Hacker mode. Review quarterly and adjust based on real user data.*
