# Phase 1 — Memory Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stale project memory with accurate current state and Atlassian MCP competitive intelligence.

**Architecture:** Four atomic file operations: write two new topic files, prune the MEMORY.md index, delete one obsolete file. Manager executes directly — no subagents required.

**Tech Stack:** File system only. Memory dir: `~/.claude/projects/-Users-admin-Desktop-personal-solopreneur/memory/`

---

### Task 1: Write `project_state.md`

**Files:**
- Create: `~/.claude/projects/-Users-admin-Desktop-personal-solopreneur/memory/project_state.md`

- [ ] **Step 1: Write the file**

```markdown
---
name: TicketLens Project State
description: Current verified completion status of all TicketLens features and subsystems — no history, state only
type: project
---

## CLI — ~/Desktop/Projects/ticket-lens/

- **534 tests passing**, 0 failures
- Git: `main` at `2075581` (next sprint spec added)
- Mintlify docs: `https://www.mintlify.com/ralphmoran/ticket-lens`
- npm package: `ticketlens`

## Backend — ~/Desktop/Projects/ticketlens-api/

- **39 tests passing**, 0 failures
- 5 endpoints: POST/GET/DELETE `/v1/schedule`, POST `/v1/digest/deliver`, POST `/v1/summarize`
- Docker Sail: mysql:8.4, redis:alpine, mailpit:latest
- Tagged `track2-backend-complete`
- Deployment guide: `docs/setup-and-deployment.md`
- **No CI pipeline yet** (pending Phase 2)

## Feature Completion Map

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
| 17 | Backend: schedule CRUD + digest delivery + summarize | ✅ Done |
| — | `ticketlens delete <profile>` | ✅ Done — `bin/ticketlens.mjs:130` |
| — | `lib/config.mjs` DRY extraction | ✅ Done — all shared utils in `lib/config.mjs` |
| — | `loadProfiles()` module-level cache | ✅ Done — `_profilesCache` Map in `profile-resolver.mjs:40` |
| — | Node engines version gap (`>=18` vs CI `20+22`) | ❌ Pending — 1-line fix |
| — | Backend CI pipeline | ❌ Pending |
| — | Mintlify docs alignment audit | ❌ Pending |
| — | Atlassian MCP competitive positioning | ❌ Pending |
| B.5 | Compliance check (Free 3/month + Pro unlimited + BYOK) | ❌ Pending — Phase 3 |
| C | Frontend dashboard | ❌ Phase C — after validation gate |

## Pending Items (ordered by priority)

1. **Node engines fix** — `package.json` `engines.node` `>=18` → `>=20`
2. **Backend CI** — GitHub Actions for `ticketlens-api/`
3. **Atlassian MCP competitive positioning** — landing page, STRATEGY.md, README
4. **Mintlify docs alignment** — verify every documented command vs code
5. **Compliance check** — requirement-extractor, commit-linker, diff-analyzer, usage-tracker, CLI flag, backend endpoint (30+ tests)
```

- [ ] **Step 2: Verify file exists**

```bash
ls -la ~/.claude/projects/-Users-admin-Desktop-personal-solopreneur/memory/project_state.md
```

---

### Task 2: Write `project_competitive.md`

**Files:**
- Create: `~/.claude/projects/-Users-admin-Desktop-personal-solopreneur/memory/project_competitive.md`

- [ ] **Step 1: Write the file**

```markdown
---
name: TicketLens Competitive Landscape
description: Atlassian MCP plugin analysis and TicketLens positioning strategy
type: project
---

## Atlassian MCP Plugin

- **Official Atlassian plugin** for Claude Code. 46,149 installations. OAuth 2.1, cloud-only.
- Skills: `/spec-to-backlog`, `/capture-tasks-from-meeting-notes`, `/generate-status-report`, `/triage-issue`, `/search-company-knowledge`
- Write operations: Create Jira issues, create Confluence pages, bulk import
- Read operations: JQL search, CQL search, page fetch
- Data flow: Your Jira → `mcp.atlassian.com` → Claude API (data transits Atlassian's cloud)

## What Atlassian MCP Cannot Do

- No triage queue ("what needs my attention right now")
- No VCS/commit linking (ticket ↔ code ↔ PR)
- No compliance check (requirements vs actual code changes)
- No Jira Server or Data Center support (cloud-only OAuth)
- No local-first / air-gap mode
- No scheduled digest
- No token-efficient brief assembly (passes raw API responses)
- No BYOK path (all data transits Atlassian + Anthropic)

## Positioning Statement

**"Atlassian MCP writes your tickets. TicketLens tells you which ones need you right now."**

They are complementary, not competitive. A developer can and should use both.
TicketLens is the triage and analysis layer; Atlassian MCP is the creation layer.

## Key Differentiators

- Local-first privacy (no data relay)
- Jira Server/DC support (not cloud-only)
- VCS linking (ticket ↔ commit ↔ PR)
- Compliance check (requirements vs code diff)
- Token efficiency (60-80% smaller briefs vs raw API)
- Scheduled digest (Pro)

## Required Updates (pending)

1. `site/index.html` — add FAQ: "Does TicketLens compete with Atlassian's official Claude plugin?"
2. `STRATEGY.md` — add Atlassian MCP to competitive landscape section
3. `README.md` — add one-liner in positioning section
```

- [ ] **Step 2: Verify file exists**

```bash
ls -la ~/.claude/projects/-Users-admin-Desktop-personal-solopreneur/memory/project_competitive.md
```

---

### Task 3: Prune MEMORY.md index

**Files:**
- Modify: `~/.claude/projects/-Users-admin-Desktop-personal-solopreneur/memory/MEMORY.md`

- [ ] **Step 1: Read MEMORY.md current state**

Read the file and identify lines to remove or update:
- Remove pointer to `sprint5_manual_tests.md` (file being deleted in Task 4)
- Update "Pending Work Plan" entry to note it is superseded by `project_state.md`
- Add pointers to new files: `project_state.md` and `project_competitive.md`
- Keep total under 180 lines

- [ ] **Step 2: Add new index entries for new topic files**

In MEMORY.md, under the Project Context section, add:

```markdown
- [Project State](project_state.md) — Verified feature completion map + pending items (updated 2026-03-30)
- [Competitive Landscape](project_competitive.md) — Atlassian MCP analysis + positioning statement
```

And remove or update the sprint5_manual_tests entry:
```markdown
~~- [Sprint 5 manual tests](sprint5_manual_tests.md) — Commands to verify default timeout, TimeoutError styling~~
```
(Delete the line entirely)

- [ ] **Step 3: Verify line count**

```bash
wc -l ~/.claude/projects/-Users-admin-Desktop-personal-solopreneur/memory/MEMORY.md
```

Expected: output shows a number ≤ 180.

---

### Task 4: Delete stale file

**Files:**
- Delete: `~/.claude/projects/-Users-admin-Desktop-personal-solopreneur/memory/sprint5_manual_tests.md`

- [ ] **Step 1: Delete the file**

```bash
rm ~/.claude/projects/-Users-admin-Desktop-personal-solopreneur/memory/sprint5_manual_tests.md
```

- [ ] **Step 2: Verify deleted**

```bash
ls ~/.claude/projects/-Users-admin-Desktop-personal-solopreneur/memory/sprint5_manual_tests.md 2>&1
```

Expected: `No such file or directory`
