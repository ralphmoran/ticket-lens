# Phase 2 — Sprint Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Node engines version gap, create backend CI pipeline, update competitive positioning copy, and produce three research reports (code audit, docs audit, security threat model) in parallel.

**Architecture:** Five independent tasks deployable in parallel. Tasks 1-3 produce code/config changes. Tasks 4-6 produce written reports committed to `docs/`. Each task is self-contained and does not depend on the others.

**Tech Stack:** Node.js 20+ (CLI), GitHub Actions (CI), PHP 8.3 + Laravel 11 + SQLite (backend tests), plain HTML/Markdown (content edits).

---

## Repo paths

- CLI: `~/Desktop/Projects/ticket-lens/`
- Backend: `~/Desktop/Projects/ticketlens-api/`

---

### Task 1: Fix Node engines version gap

**Agent:** Senior Developer
**Files:**
- Modify: `~/Desktop/Projects/ticket-lens/package.json` (line 34)

- [ ] **Step 1: Verify current value**

```bash
grep '"node"' ~/Desktop/Projects/ticket-lens/package.json
```

Expected: `"node": ">=18.0.0"`

- [ ] **Step 2: Edit package.json**

Change line 34 from:
```json
    "node": ">=18.0.0"
```
to:
```json
    "node": ">=20.0.0"
```

- [ ] **Step 3: Verify CI already uses Node 20+22**

```bash
grep 'node-version' ~/Desktop/Projects/ticket-lens/.github/workflows/test.yml
```

Expected output contains `20` and `22` — no change needed to the workflow file.

- [ ] **Step 4: Run tests to confirm no regression**

```bash
cd ~/Desktop/Projects/ticket-lens && npm test 2>&1 | tail -5
```

Expected: `pass 534` (or higher), `fail 0`

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/Projects/ticket-lens
git add package.json
git commit -m "fix: require Node >=20 to match CI matrix"
```

---

### Task 2: Backend CI Pipeline

**Agent:** DevOps (deployment-engineer)
**Files:**
- Create: `~/Desktop/Projects/ticketlens-api/.github/workflows/test.yml`
- Modify: `~/Desktop/Projects/ticketlens-api/README.md` (add badge)

**Context:** Tests use SQLite (not MySQL) — see `phpunit.xml` `<env name="DB_DATABASE" value="testing"/>` and default connection `sqlite`. No service containers needed. PHP `^8.3` per `composer.json`.

- [ ] **Step 1: Create the workflow directory**

```bash
mkdir -p ~/Desktop/Projects/ticketlens-api/.github/workflows
```

- [ ] **Step 2: Write `.github/workflows/test.yml`**

```yaml
name: Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        php-version: ['8.3', '8.4']

    steps:
      - uses: actions/checkout@v4

      - name: Set up PHP ${{ matrix.php-version }}
        uses: shivammathur/setup-php@v2
        with:
          php-version: ${{ matrix.php-version }}
          extensions: sqlite3, pdo_sqlite, mbstring, xml, bcmath, curl
          coverage: none

      - name: Install dependencies
        run: composer install --no-interaction --prefer-dist --optimize-autoloader

      - name: Copy .env
        run: cp .env.example .env

      - name: Generate app key
        run: php artisan key:generate

      - name: Run migrations (SQLite)
        run: php artisan migrate --env=testing --force

      - name: Run tests
        run: php artisan test
```

- [ ] **Step 3: Verify `README.md` exists in ticketlens-api**

```bash
ls ~/Desktop/Projects/ticketlens-api/README.md
```

If it exists, proceed to add the badge. If not, create a minimal one:

```markdown
# ticketlens-api

Laravel 11 backend for TicketLens — schedule CRUD, digest delivery, AI summarization.
```

- [ ] **Step 4: Add CI badge to README.md**

At the very top of `README.md`, add this line (replace `ralphmoran` if the GitHub org differs):

```markdown
![Tests](https://github.com/ralphmoran/ticketlens-api/actions/workflows/test.yml/badge.svg)
```

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/Projects/ticketlens-api
git add .github/workflows/test.yml README.md
git commit -m "ci: add GitHub Actions test pipeline (PHP 8.3/8.4, SQLite)"
```

---

### Task 3: Atlassian Competitive Positioning

**Agent:** Strategy Analyst
**Files:**
- Modify: `~/Desktop/Projects/ticket-lens/site/index.html`
- Modify: `~/Desktop/Projects/ticket-lens/STRATEGY.md`
- Modify: `~/Desktop/Projects/ticket-lens/README.md`

**Positioning to use verbatim:**
> "Atlassian MCP writes your tickets. TicketLens tells you which ones need you right now."

**Key differentiators:** local-first privacy, Jira Server/DC support, VCS linking, compliance check, token efficiency (60-80% smaller briefs), scheduled digest.

- [ ] **Step 1: Read each file before editing**

```bash
grep -n "FAQ\|faq\|compete\|atlassian\|Atlassian" ~/Desktop/Projects/ticket-lens/site/index.html | head -20
grep -n "FAQ\|faq\|compete\|atlassian\|Atlassian\|competitive\|Competitive" ~/Desktop/Projects/ticket-lens/STRATEGY.md | head -20
grep -n "position\|competitive\|Atlassian" ~/Desktop/Projects/ticket-lens/README.md | head -10
```

- [ ] **Step 2: Add FAQ entry to `site/index.html`**

Find the FAQ section (search for `<section` near `faq` or existing `<dt>` / `<details>` FAQ items). Add a new FAQ entry after the last existing FAQ item:

```html
<details>
  <summary>Does TicketLens compete with Atlassian's official Claude plugin?</summary>
  <p>
    No — they're complementary. Atlassian MCP is a creation tool: it writes tickets, generates Confluence pages,
    and imports backlogs. TicketLens is a triage and analysis tool: it tells you <em>which tickets need your
    attention right now</em>, links them to your code changes, and checks that your work actually covers
    the acceptance criteria.
  </p>
  <p>
    A developer can and should use both. Use Atlassian MCP to build out your backlog. Use TicketLens when
    you sit down to code.
  </p>
  <p>
    Additional differences: TicketLens works with Jira Server and Data Center (not just cloud), runs entirely
    locally (no data relay), supports scheduled digests, and assembles 60–80% smaller briefs than passing raw
    API responses.
  </p>
</details>
```

- [ ] **Step 3: Add Atlassian MCP section to `STRATEGY.md`**

Find the "Competitive Landscape" section (or "Competition" heading). Add after the last existing competitor entry:

```markdown
### Atlassian MCP (Official Claude Plugin)

- **Installs:** 46,149. **Auth:** OAuth 2.1. **Scope:** Atlassian Cloud only.
- **Skills:** `/spec-to-backlog`, `/capture-tasks-from-meeting-notes`, `/generate-status-report`,
  `/triage-issue`, `/search-company-knowledge`
- **Write operations:** Create Jira issues, create Confluence pages, bulk import
- **Data flow:** Your Jira → `mcp.atlassian.com` → Claude API (data transits Atlassian's cloud)

**What it cannot do:**
- No triage queue ("what needs my attention right now")
- No VCS/commit linking (ticket ↔ code ↔ PR)
- No compliance check (requirements vs actual code changes)
- No Jira Server or Data Center support
- No local-first / air-gap mode
- No scheduled digest
- No token-efficient brief assembly
- No BYOK path

**Verdict:** Complementary, not competitive. Atlassian MCP is the creation layer; TicketLens is the
triage and analysis layer. Positioning: *"Atlassian MCP writes your tickets. TicketLens tells you which
ones need you right now."*
```

- [ ] **Step 4: Add one-liner to `README.md`**

Find the section describing TicketLens positioning (near "Stop tab-switching" or similar intro). Add after the first paragraph or positioning statement:

```markdown
> Works alongside [Atlassian MCP](https://marketplace.atlassian.com/search?q=mcp) — they write the tickets; TicketLens tells you which ones need you right now.
```

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/Projects/ticket-lens
git add site/index.html STRATEGY.md README.md
git commit -m "docs: add Atlassian MCP competitive positioning"
```

---

### Task 4: Code Audit Report

**Agent:** Auditor (code-reviewer)
**Files:**
- Read: `skills/jtb/scripts/lib/config.mjs`
- Read: `skills/jtb/scripts/fetch-ticket.mjs`
- Read: `skills/jtb/scripts/fetch-my-tickets.mjs`
- Read: `skills/jtb/scripts/lib/profile-resolver.mjs`
- Read: `skills/jtb/scripts/lib/cli.mjs` (or `bin/ticketlens.mjs`)
- Read: `skills/jtb/scripts/lib/help.mjs`
- Read: `bin/ticketlens.mjs`
- Create: `docs/audits/2026-03-30-code-audit.md`

- [ ] **Step 1: Read all seven files listed above**

- [ ] **Step 2: Produce audit report**

Write `~/Desktop/Projects/ticket-lens/docs/audits/2026-03-30-code-audit.md` with these sections:

```markdown
# Code Audit — 2026-03-30

## DRY Violations
[List any remaining duplication after config.mjs extraction]

## Security Gaps
[Any issues not caught in prior sprints]

## Test Coverage Holes
[Files with insufficient test coverage by inspection]

## Docs vs Code Drift
[Claims in help.mjs or SKILL.md that don't match implementation]

## ticketlens delete — Verdict
[Is deleteProfile() fully implemented, called correctly, edge cases handled?]

## Summary
[Overall verdict with priority ranking]
```

- [ ] **Step 3: Commit report**

```bash
cd ~/Desktop/Projects/ticket-lens
mkdir -p docs/audits
git add docs/audits/2026-03-30-code-audit.md
git commit -m "docs: code audit report 2026-03-30"
```

---

### Task 5: Mintlify Docs Alignment Audit

**Agent:** UX (ux-researcher)
**Files:**
- Read: `bin/ticketlens.mjs`
- Read: `skills/jtb/scripts/lib/help.mjs`
- Read: `skills/jtb/scripts/lib/profile-resolver.mjs`
- Fetch: `https://www.mintlify.com/ralphmoran/ticket-lens` (and sub-pages)
- Create: `docs/audits/2026-03-30-mintlify-docs-audit.md`

- [ ] **Step 1: Read the three code files listed above**

- [ ] **Step 2: Fetch the Mintlify docs pages**

Fetch the root URL and navigate to each documented command page.

- [ ] **Step 3: Produce audit report**

Write `~/Desktop/Projects/ticket-lens/docs/audits/2026-03-30-mintlify-docs-audit.md` with these sections:

```markdown
# Mintlify Docs Alignment Audit — 2026-03-30

## Methodology
[Which pages were checked, which code files used as ground truth]

## Command Audit

| Command / Flag | Docs Says | Code Does | Verdict |
|---------------|-----------|-----------|---------|
| ticketlens init | ... | ... | MATCH / MISMATCH / MISSING |
[one row per command and flag]

## Critical Mismatches
[Items a user would follow and fail]

## Missing from Docs
[Commands/flags that exist in code but aren't documented]

## ticketlens delete — Docs vs Code
[Specific check: confirmation prompt, active profile guard, error messages]

## Recommendations
[Prioritized list of doc fixes]
```

- [ ] **Step 4: Commit report**

```bash
cd ~/Desktop/Projects/ticket-lens
git add docs/audits/2026-03-30-mintlify-docs-audit.md
git commit -m "docs: Mintlify alignment audit 2026-03-30"
```

---

### Task 6: Compliance Check Security Threat Model

**Agent:** Security (security-auditor)
**Files:**
- Read: `skills/jtb/scripts/lib/code-ref-parser.mjs`
- Read: `skills/jtb/scripts/lib/vcs-detector.mjs`
- Read: `skills/jtb/scripts/lib/license.mjs`
- Read: `skills/jtb/scripts/fetch-ticket.mjs` (how `--check` works)
- Create: `docs/security/2026-03-30-compliance-threat-model.md`

- [ ] **Step 1: Read all four files listed above**

- [ ] **Step 2: Produce threat model document**

Write `~/Desktop/Projects/ticket-lens/docs/security/2026-03-30-compliance-threat-model.md`:

```markdown
# Compliance Check — Security Threat Model

## Attack Surface 1: Usage Cap Bypass
**Asset:** `~/.ticketlens/usage.json` — 3/month free tier limit
**Threat:** User edits or deletes the file to reset the counter
**Mitigations to evaluate:**
- Server-side enforcement via `POST /v1/compliance` (authoritative cap)
- Client-side cap is UX only (not security boundary)
[Your analysis and recommended mitigations]

## Attack Surface 2: Prompt Injection via Ticket Content
**Asset:** LLM call with ticket description as user content
**Threat:** Malicious ticket content contains instructions that override the compliance analysis prompt
**Mitigations to evaluate:**
- System/user role separation in Anthropic/OpenAI API calls
- Input sanitization before prompt injection
[Your analysis]

## Attack Surface 3: VCS Command Injection
**Asset:** Commit linker runs `git log` with ticket key in search args
**Threat:** Ticket key contains shell metacharacters (e.g., `PROJ-123; rm -rf /`)
**Mitigations to evaluate:**
- Use `spawnSync` with explicit arg arrays (never shell interpolation) — already used in `--check` flag
- Ticket key validation (must match `/^[A-Z]+-\d+$/`)
[Your analysis]

## Attack Surface 4: Path Traversal via Commit Message
**Asset:** diff-analyzer reads git diff output
**Threat:** Crafted diff hunk header with `../` sequences could reference files outside repo
**Mitigations to evaluate:**
- diff is parsed as text, not as file paths to open
[Your analysis]

## Attack Surface 5: BYOK Key Exposure
**Asset:** `~/.ticketlens/credentials.json` — API keys for compliance BYOK path
**Threat:** Key logged, printed in error output, or sent to wrong endpoint
**Mitigations to evaluate:**
- Same credential loading pattern as `--summarize` (established safe path)
[Your analysis]

## Recommended Security Requirements
[Prioritized list for the architect and implementer]
```

- [ ] **Step 3: Commit document**

```bash
cd ~/Desktop/Projects/ticket-lens
mkdir -p docs/security
git add docs/security/2026-03-30-compliance-threat-model.md
git commit -m "docs: compliance check security threat model"
```
