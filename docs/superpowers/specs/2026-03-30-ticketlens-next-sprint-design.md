# TicketLens Next Sprint Design
**Date:** 2026-03-30
**Author:** Manager (Claude Code orchestrator)
**Status:** Pending user approval

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

---

## Goal

Consolidate all project history into a single private source of truth (MEMORY.md + topic files), produce a competitive positioning document for the Atlassian MCP plugin discovery, and execute the remaining TicketLens work items using a 9-agent parallel team with a manager-controlled quality gate.

## Architecture

Three sequential phases. Phase 1 must complete before Phase 2 launches. Phase 3 (compliance check) is the largest item and runs after Phase 2 is stable.

**Tech Stack:** Node.js 18+ CLI (zero runtime deps), Laravel 11 backend (PHP 8.5, Sail, Redis, MySQL, Mailpit), LemonSqueezy licensing, Anthropic/OpenAI BYOK, Mintlify docs.

---

## Current State (verified 2026-03-30)

### CLI — `~/Desktop/Projects/ticket-lens/`
- **534 tests passing**, 0 failures
- Git: `main` at `a4a3e03` (Track 2 merge)
- Mintlify docs live at `mintlify.com/ralphmoran/ticket-lens`

### Backend — `~/Desktop/Projects/ticketlens-api/`
- **39 tests passing**, 0 failures
- 5 endpoints: POST/GET/DELETE `/v1/schedule`, POST `/v1/digest/deliver`, POST `/v1/summarize`
- Docker Sail stack (mysql:8.4, redis, mailpit)
- Tagged `track2-backend-complete`
- Deployment guide: `docs/setup-and-deployment.md`
- **No CI pipeline yet**

### True Feature Completion Map

| Item | Feature | Status |
|------|---------|--------|
| 1 | Jira Cloud v3 API | ✅ Done |
| 2 | npm package (`ticketlens`) | ✅ Done |
| 3 | CLI UX polish (banner, spinner, navigator) | ✅ Done |
| 4a | `ticketlens init` wizard | ✅ Done |
| 4b | `ticketlens switch` | ✅ Done |
| 4c | `ticketlens config` editor | ✅ Done |
| 5 | README GIFs | ✅ Done |
| 6 | CI pipeline (CLI) | ✅ Done |
| 7 | License key system | ✅ Done |
| 8 | `--assignee` / `--sprint` flags | ✅ Done |
| 9 | Brief cache (4h TTL, lazy eviction) | ✅ Done |
| 10 | Configurable cache TTL (Pro) | ✅ Done |
| 11 | Attachment download (parallel, batches of 3) | ✅ Done |
| 12 | Security sprint (JQL injection, SSRF, timeouts, path traversal) | ✅ Done |
| 13 | `--check` flag (VCS diff + Claude Code context) | ✅ Done |
| 14 | `--summarize` (BYOK Anthropic/OpenAI + `--cloud`) | ✅ Done |
| 15 | `--digest` flag + schedule wizard (macOS/Linux cron) | ✅ Done |
| 16 | Triage export `--export=csv/json` (Team tier) | ✅ Done |
| 17 | Backend: schedule CRUD + digest delivery + summarize endpoint | ✅ Done |
| — | `ticketlens delete <profile>` | ✅ Done — `bin/ticketlens.mjs:130`, tested in `profile-resolver.test.mjs:347` |
| — | `lib/config.mjs` DRY extraction | ✅ Done — all shared utils already in `lib/config.mjs` |
| — | `loadProfiles()` module-level cache | ✅ Done — `_profilesCache` Map in `profile-resolver.mjs:40` |
| — | Node engines version gap (`>=18` vs CI `20+22`) | ❌ **Pending** — trivial 1-line fix |
| — | Backend CI pipeline | ❌ **Pending** |
| — | Mintlify docs alignment (delete command documented, not verified) | ❌ **Pending** |
| — | Atlassian MCP competitive positioning update | ❌ **Pending** |
| B.5 | Compliance check (Item 20-24 in roadmap) | ❌ **Pending — Phase B.5** |
| C | Frontend dashboard | ❌ **Phase C — after validation gate** |

---

## Atlassian MCP Competitive Analysis

### What Atlassian MCP Does
Official Atlassian plugin for Claude Code. 46,149 installations. OAuth 2.1, cloud-only.

**Skills available:**
- `/spec-to-backlog` — converts specs into Jira Epics/Stories hierarchy
- `/capture-tasks-from-meeting-notes` — meeting notes → assigned tickets
- `/generate-status-report` — publishes status to Confluence
- `/triage-issue` — AI categorize/prioritize a single issue
- `/search-company-knowledge` — search across Jira + Confluence + Compass

**Write operations:** Create Jira issues, create Confluence pages, bulk import.
**Read operations:** JQL search, CQL search, page fetch.
**Data flow:** Your Jira → `mcp.atlassian.com` → Claude API (data transits Atlassian's cloud).

### What Atlassian MCP Cannot Do
- No triage queue ("what needs my attention right now")
- No VCS/commit linking (ticket ↔ code ↔ PR)
- No compliance check (requirements vs actual code changes)
- No Jira Server or Data Center support (cloud-only OAuth)
- No local-first / air-gap mode
- No scheduled digest
- No token-efficient brief assembly (passes raw API responses)
- No BYOK path (all data transits Atlassian + Anthropic)

### Positioning Statement
**"Atlassian MCP writes your tickets. TicketLens tells you which ones need you right now."**

They are complementary, not competitive. A developer can and should use both. TicketLens is the triage and analysis layer; Atlassian MCP is the creation layer.

### Required Updates
1. Landing page: add "Works alongside Atlassian MCP" FAQ entry
2. STRATEGY.md: add Atlassian MCP to competitive landscape section with above analysis
3. README: add a one-liner in the positioning section

---

## Agent Team Structure

| # | Agent | Persona | Phase | Responsibility |
|---|-------|---------|-------|----------------|
| 0 | **Manager** | This session | All | Provides all context, reviews outputs, controls gates, never loses context |
| 1 | **Auditor** | `octo:personas:code-reviewer` | 2 | Full codebase audit: verify true completion status, security gaps, test coverage, docs vs code drift |
| 2 | **UX** | `octo:personas:ux-researcher` | 2 | Mintlify docs alignment audit — every documented command vs actual code |
| 3 | **DevOps** | `octo:personas:deployment-engineer` | 2 | Backend CI pipeline + Node `engines` gap fix (`>=18` → `>=20`) |
| 4 | **Strategy** | `octo:personas:strategy-analyst` | 2 | Atlassian competitive update: landing page FAQ, STRATEGY.md, README |
| 5 | **Security** | `octo:personas:security-auditor` | 2→3 | Threat model for compliance check feature |
| 6 | **Architect** | `octo:personas:backend-architect` | 3 | Compliance check full system design using Security threat model |
| 7 | **Senior Dev** | `Senior Developer` | 2+3 | Node engines fix (Phase 2) + compliance check implementation (Phase 3, TDD, 30+ tests) |

---

## Phase 1 — Foundation (Manager executes directly)

Manager writes these files before Phase 2 launches. All Phase 2 agents receive the resulting source of truth in their prompts.

### Task 1.1 — Rewrite `project_state.md`
Replace stale `project_pending_work_plan.md` with accurate current state.

**File:** `~/.claude/projects/-Users-admin-Desktop-personal-solopreneur/memory/project_state.md`

**Content:**
- Full feature completion map (table above, verbatim)
- Backend status
- CLI test count (534) and backend test count (39)
- True pending items with correct priorities
- Mintlify docs URL
- No history narratives — state only

### Task 1.2 — Write `project_competitive.md`
New memory file capturing Atlassian MCP research.

**File:** `~/.claude/projects/-Users-admin-Desktop-personal-solopreneur/memory/project_competitive.md`

**Content:** Atlassian MCP section verbatim from this spec + positioning statement + required updates list.

### Task 1.3 — Prune `MEMORY.md` index
Rewrite to stay under 180 lines. Remove stale pointers, update existing entries, add pointers to new files.

**Delete:** `sprint5_manual_tests.md` (obsolete)

### Task 1.4 — Delete stale file
Remove `sprint5_manual_tests.md` from memory directory.

---

## Phase 2 — Parallel Sprint (all agents launch simultaneously)

All 7 agents run in parallel after Phase 1 completes. Manager dispatches all simultaneously. Each agent receives: this spec + the new `project_state.md` content + their specific task brief.

### Task 2.1 — Code Audit (Auditor)
**Agent:** `octo:personas:code-reviewer`
**Deliverable:** Written report covering:
- DRY violations remaining after Items 11+12 are done (look ahead)
- Any security gaps not caught in sprint 5
- Test coverage holes (files with < 80% test coverage by inspection)
- Docs vs code drift (Mintlify docs claims vs actual implementation)
- Specific verdict on `ticketlens delete` — is it a stub or fully implemented?

**Files to read:**
- `skills/jtb/scripts/lib/config.mjs` — current state
- `skills/jtb/scripts/fetch-ticket.mjs` — profile resolution, loadProfiles usage
- `skills/jtb/scripts/fetch-my-tickets.mjs` — loadProfiles usage
- `skills/jtb/scripts/lib/profile-resolver.mjs` — loadProfiles definition
- `skills/jtb/scripts/cli.mjs` — delete command handling
- `skills/jtb/scripts/lib/help.mjs` — does help mention delete?
- `bin/ticketlens.mjs` — entry point

### Task 2.3 — Mintlify Docs Alignment Audit (UX)
**Agent:** `octo:personas:ux-researcher`
**Deliverable:** Written audit report covering every command documented at `mintlify.com/ralphmoran/ticket-lens` vs actual implementation:
- List each documented command/flag with MATCH / MISMATCH / MISSING verdict against the code
- Flag any claims that don't match current behavior (e.g., flags that no longer exist, wrong syntax, missing commands)
- Include `ticketlens delete <profile>` — verify the confirmation prompt, active profile guard, and error messages are consistent with the CLI personality established in other commands
- Priority: identify anything a user would follow in the docs and fail

**Files to read:**
- `bin/ticketlens.mjs` — all subcommand routing
- `skills/jtb/scripts/lib/help.mjs` — all help text (ground truth for CLI personality)
- `skills/jtb/scripts/lib/profile-resolver.mjs` — `deleteProfile()` implementation

### Task 2.4 — Node Version Gap Fix (Senior Dev)
**Agent:** `Senior Developer`
**Deliverable:**
1. Fix `package.json` `engines` field: change `>=18` to `>=20` (matches CI matrix Node 20+22)
2. Confirm `.github/workflows/test.yml` already uses Node 20+22 matrix (no change needed if so)
3. Tests must still pass: 534/534

### Task 2.5 — Backend CI Pipeline (DevOps)
**Agent:** `octo:personas:deployment-engineer`
**Deliverable:** `.github/workflows/test.yml` in `ticketlens-api/` repo

**Requirements:**
- Trigger: push + PR to `main`
- PHP 8.2+ with required extensions
- MySQL 8.x service container
- Redis service container
- Run `php artisan migrate --env=testing`
- Run `php artisan test`
- Fail on any test failure
- Badge in `ticketlens-api/README.md`
- Mirror Node version matrix pattern from CLI CI (use matrix if multiple PHP versions)

### Task 2.6 — Competitive Positioning Update (Strategy)
**Agent:** `octo:personas:strategy-analyst`
**Deliverable:**
1. Edit `site/index.html` — add FAQ entry: "Does TicketLens compete with Atlassian's official Claude plugin?"
2. Edit `STRATEGY.md` — add Atlassian MCP to competitive landscape with the analysis from this spec
3. Edit `README.md` — add one-liner in positioning section

**Positioning to use (verbatim):**
> "Atlassian MCP writes your tickets. TicketLens tells you which ones need you right now."

**Key differentiators to highlight:** local-first privacy, Jira Server/DC support, VCS linking, compliance check, token efficiency (60-80% smaller briefs), scheduled digest.

### Task 2.7 — Compliance Check Threat Model (Security)
**Agent:** `octo:personas:security-auditor`
**Deliverable:** Threat model document for the compliance check feature (Phase B.5):

**Attack surfaces to model:**
- Free-tier usage cap (`~/.ticketlens/usage.json`) — can users bypass the 3/month limit?
- Server-side LLM call — prompt injection via Jira ticket content
- Ticket-to-commit linker — can malicious ticket content execute arbitrary shell commands via VCS detection?
- Local diff analysis — can a specially crafted commit message cause path traversal?
- BYOK key exposure in compliance check flow

**Files to read:**
- `skills/jtb/scripts/lib/code-ref-parser.mjs`
- `skills/jtb/scripts/lib/vcs-detector.mjs`
- `skills/jtb/scripts/lib/license.mjs`
- `skills/jtb/scripts/fetch-ticket.mjs` (how `--check` flag works — compliance will extend this)

---

## Phase 3 — Compliance Check (sequential, after Phase 2 auditor + security reports)

The largest remaining feature. Primary Free→Pro conversion lever. Server-side to prevent bypass.

### Architecture (designed by Architect agent using Security threat model)

**System design:**
- `lib/compliance-checker.mjs` — orchestrator
- `lib/requirement-extractor.mjs` — parse acceptance criteria from ticket (given/when/then, bullet points, "must/should" sentences)
- `lib/commit-linker.mjs` — find git commits/branches referencing ticket key (extends `code-ref-parser.mjs`)
- `lib/diff-analyzer.mjs` — compare requirements list against actual code diff, produce FOUND / NOT FOUND map
- `lib/usage-tracker.mjs` — read/write `~/.ticketlens/usage.json`, enforce 3/month free cap server-side

**CLI integration:**
- `ticketlens PROJ-123 --compliance` or `/jtb compliance PROJ-123`
- Output: requirements list with ✔ FOUND / ✖ NOT FOUND / ~ PARTIAL, coverage %, missing items
- Free tier: 3/month counter shown; on hit: styled upgrade prompt

**Server-side path:**
- Calls `POST api.ticketlens.dev/v1/compliance` (bypass-proof)
- Locally: BYOK path with Anthropic/OpenAI (same pattern as `--summarize`)
- Free tier cap enforced both client-side (UX) and server-side (authoritative)

**Tests:** minimum 30 new tests across all new modules.

### Task 3.1 — Architect designs compliance check system
**Agent:** `octo:personas:backend-architect`
**Input:** Security threat model from Task 2.7 + this spec
**Deliverable:** Detailed architecture doc:
- Final module list with interfaces
- Data flow diagram (text-based)
- Security mitigations for each threat identified
- API endpoint spec for `POST /v1/compliance`
- Acceptance criteria for each module

### Task 3.2 — Senior Dev implements compliance check
**Agent:** `Senior Developer`
**Input:** Architecture doc from Task 3.1
**Deliverable:** Full implementation, TDD, 534 → 564+ tests (30+ new), all passing.
**Order:** requirement-extractor → commit-linker → diff-analyzer → usage-tracker → compliance-checker orchestrator → CLI flag → SKILL.md update

---

## Manager Quality Gates

After each phase, Manager (this session) runs:
```bash
node --test 'skills/jtb/scripts/test/*.test.mjs'  # must stay green
git diff --stat                                     # review scope of changes
```

After Phase 2, Manager reviews:
- Auditor report for blockers before Phase 3
- Security threat model before Architect starts

After Phase 3:
- Full test suite + manual smoke test of `--compliance` flag
- Update MEMORY.md with new feature status

---

## Success Criteria

| Criterion | Target |
|-----------|--------|
| CLI tests | ≥ 564 (534 + 30 compliance) |
| Backend tests | ≥ 39 (no regression) |
| Node engines | `package.json` `engines.node` = `>=20.0.0` |
| Backend CI | GitHub Actions passing on `ticketlens-api` |
| Competitive positioning | Atlassian MCP addressed in landing page, STRATEGY.md, README |
| Mintlify docs | Every documented command verified against actual code |
| Compliance check | Free tier (3/month cap) + Pro (unlimited) + BYOK path |
| Memory | MEMORY.md ≤ 180 lines, `project_state.md` accurate, `project_competitive.md` written |
