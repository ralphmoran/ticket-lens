# Jira TicketBrief (JTB) — User Guide

A Claude Code skill that fetches a Jira ticket's full context and produces a structured implementation brief. Works with Jira Cloud and Jira Server/Data Center. Supports Git, SVN, and Mercurial repositories.

---

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Triage — Ticket Attention Scanner](#triage--ticket-attention-scanner)
- [Output Format](#output-format)
- [Depth Traversal](#depth-traversal)
- [Code Reference Extraction](#code-reference-extraction)
- [VCS Enrichment](#vcs-enrichment)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## Installation

The skill lives at `~/.agents/skills/jtb/`. No npm install required — it uses only Node.js built-in modules.

**Requirements:**
- Node.js 18+ (uses native `fetch` and `node:test`)
- A Jira Cloud or Jira Server/Data Center instance

### File Structure

```
~/.agents/skills/jtb/
├── SKILL.md                        # Claude Code skill definition
├── README.md                       # Quick reference
├── docs/
│   └── USER_GUIDE.md               # This file
└── scripts/
    ├── fetch-ticket.mjs            # CLI entry point (ticket fetch)
    ├── fetch-my-tickets.mjs        # CLI entry point (triage)
    ├── lib/
    │   ├── jira-client.mjs         # Jira REST API client
    │   ├── code-ref-parser.mjs     # Code reference extraction
    │   ├── vcs-detector.mjs        # VCS detection
    │   ├── brief-assembler.mjs     # Markdown output assembly
    │   ├── attention-scorer.mjs    # Ticket attention scoring logic
    │   └── profile-resolver.mjs    # Multi-account profile resolution
    └── test/
        ├── code-ref-parser.test.mjs
        ├── vcs-detector.test.mjs
        ├── jira-client.test.mjs
        ├── brief-assembler.test.mjs
        ├── attention-scorer.test.mjs
        ├── profile-resolver.test.mjs
        ├── fetch-ticket.test.mjs
        └── fetch-my-tickets.test.mjs
```

---

## Configuration

### Multi-Account Profiles (Recommended)

Profiles let you work with multiple Jira instances. Tickets are automatically routed to the right account based on their prefix (for fetch) or your current directory (for triage).

#### 1. Create `~/.ticketlens/profiles.json`

```json
{
  "profiles": {
    "myteam": {
      "baseUrl": "https://myteam.atlassian.net",
      "auth": "cloud",
      "email": "you@example.com",
      "ticketPrefixes": ["PROJ", "OPS"],
      "projectPaths": ["~/projects/myteam-app"],
      "triageStatuses": ["In Progress", "Code Review", "QA"]
    },
    "client": {
      "baseUrl": "https://jira.client.com",
      "auth": "server",
      "email": "username",
      "ticketPrefixes": ["CLI"],
      "projectPaths": ["~/projects/client-app"],
      "triageStatuses": ["In Progress", "In Development", "QA Testing"]
    }
  },
  "default": "myteam"
}
```

| Field | Required | Used By | Description |
|-------|----------|---------|-------------|
| `baseUrl` | Yes | both | Jira instance URL |
| `auth` | Yes | both | `"cloud"` (Basic email+token), `"server"` (Bearer PAT), or `"basic"` (Basic user+password for pre-8.14 Server) |
| `email` | Yes | both | Atlassian email (Cloud) or username (Server) |
| `ticketPrefixes` | Yes | fetch | Array of Jira project keys this profile handles |
| `projectPaths` | No | triage | Array of local paths — triage auto-selects profile when cwd is inside one |
| `triageStatuses` | No | triage | Jira statuses to scan (default: `["In Progress", "Code Review", "QA"]`) |

#### 2. Create `~/.ticketlens/credentials.json`

```json
{
  "myteam": { "apiToken": "your-cloud-api-token" },
  "client": { "pat": "your-server-pat" }
}
```

Secure this file: `chmod 600 ~/.ticketlens/credentials.json`

| Field | When to use | Description |
|-------|-------------|-------------|
| `apiToken` | Jira Cloud | API token from https://id.atlassian.com/manage-profile/security/api-tokens |
| `pat` | Jira Server/DC 8.14+ | Personal Access Token from Jira profile settings |

For Jira Server older than 8.14 (no PAT support), use `apiToken` with the user's password and set `auth: "basic"` in the profile.

#### Resolution Order

When you run `/jtb PROJ-42` or `/jtb triage`, the profile is resolved in this order:

1. **`--profile` flag** — explicit override (`/jtb PROJ-42 --profile=client`)
2. **Prefix match** — ticket prefix `PROJ` matches "myteam" profile (fetch only)
3. **Project path match** — cwd matches a profile's `projectPaths` entry (triage)
4. **Default profile** — falls back to the `"default"` profile if no match
5. **Environment variables** — falls back to `JIRA_BASE_URL` / `JIRA_PAT` / `JIRA_EMAIL` + `JIRA_API_TOKEN`

If a prefix matches multiple profiles, a warning is emitted and the first match is used.

#### Adding a New Account

1. Add a profile entry to `~/.ticketlens/profiles.json` with the project's ticket prefixes and paths
2. Add matching credentials to `~/.ticketlens/credentials.json`
3. Test fetch: `node ~/.agents/skills/jtb/scripts/fetch-ticket.mjs NEWPROJ-1 --depth=0`
4. Test triage: `node ~/.agents/skills/jtb/scripts/fetch-my-tickets.mjs --profile=newprofile`

### Environment Variables (Single Account)

For simpler setups, environment variables work without any config files:

```bash
# Jira Cloud
export JIRA_BASE_URL="https://yourteam.atlassian.net"
export JIRA_EMAIL="you@example.com"
export JIRA_API_TOKEN="your-api-token"

# Jira Server / Data Center
export JIRA_BASE_URL="https://jira.yourcompany.com"
export JIRA_PAT="your-personal-access-token"
```

### Auth Detection Logic

If `JIRA_PAT` is set (or profile has `pat`), Bearer auth is used (Server/DC). Otherwise, Basic auth with email + API token is used (Cloud).

---

## Usage

### In Claude Code

```
/jtb PROD-1234                  # Default depth 1
/jtb PROD-1234 --depth=0        # Fast mode, target only
/jtb PROD-1234 --depth=2        # Deep traversal
/jtb PROD-1234 --profile=client # Force a specific profile
```

### Standalone CLI

```bash
node ~/.agents/skills/jtb/scripts/fetch-ticket.mjs TICKET-KEY [--depth=N] [--profile=NAME]
```

Output goes to stdout (the TicketBrief markdown). Errors go to stderr with exit code 1.

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success — output printed to stdout |
| 1 | Error — missing args, missing env vars, or API failure (details on stderr) |

---

## Triage — Ticket Attention Scanner

Scans your assigned Jira tickets and surfaces ones needing your attention.

### Usage

```
/jtb triage                          # Auto-detect profile from cwd
/jtb triage --profile=acme         # Explicit profile
/jtb triage --stale=3                # 3-day aging threshold (default: 5)
/jtb triage --status=CR,QA           # Override statuses to scan
```

### Standalone CLI

```bash
node ~/.agents/skills/jtb/scripts/fetch-my-tickets.mjs [--stale=N] [--status=X,Y] [--profile=NAME]
```

### What it does

1. Resolves your Jira profile (via `--profile`, project path, or default)
2. Fetches your identity (`GET /rest/api/2/myself`)
3. Searches for tickets assigned to you in configured statuses
4. Scores each ticket for attention urgency
5. Outputs a markdown table sorted by urgency

### Urgency Levels

| Urgency | Meaning | How it's detected |
|---------|---------|-------------------|
| **Needs Response** | Someone is waiting for your reply | Last human comment is from someone other than you |
| **Aging** | Ticket is stalling | No activity for N+ days (configurable via `--stale`) |
| **Clear** | Nothing to do | You replied last and ticket is recently active (filtered from output) |

### Bot Comment Handling

Bot comments (Jira Automation, Jenkins, Bitbucket, etc.) are automatically skipped when determining the last human commenter. SVN/Git integration bots are special-cased: if the commit author matches your username, it counts as your response.

### Status Error Recovery

If configured statuses don't exist in your Jira instance, triage will:
1. Fetch all available statuses from Jira
2. Identify which configured statuses are invalid
3. Suggest dev-relevant statuses to add to your profile
4. Show all available statuses for reference

### Output Format

```markdown
## Tickets Needing Your Attention (6 found)

### Needs Response (4)

| # | Ticket | Summary | Status | From | When | Comment |
|---|--------|---------|--------|------|------|---------|
| 1 | PROJ-100 | Fix payment bug | Code Review | Sarah QA | 2h ago | Found edge case with empty cart |
| 2 | PROJ-200 | Refactor auth | In Progress | Mike Lead | 1d ago | Can we extract this? |

### Aging — no activity > 5 days (2)

| # | Ticket | Summary | Status | Stale |
|---|--------|---------|--------|-------|
| 1 | PROJ-300 | Update API docs | In Progress | 8d |

### Quick Links

1. PROJ-100: https://myteam.atlassian.net/browse/PROJ-100
2. PROJ-200: https://myteam.atlassian.net/browse/PROJ-200
3. PROJ-300: https://myteam.atlassian.net/browse/PROJ-300
```

When no tickets need attention: `"All clear — no tickets need your attention right now."`

---

## Output Format

The TicketBrief is structured markdown with these sections (empty sections are omitted):

```markdown
# TICKET-KEY: Summary

**Type:** Bug | **Status:** In Progress | **Priority:** High | **Assignee:** Name | **Reporter:** Name

## Description

The ticket description text...

## Comments

### **Author Name** (2026-02-26)

Comment body text...

---

### **Another Author** (2026-02-27)

Another comment...

## Linked Tickets

### LINKED-KEY: Linked ticket summary

**Type:** Task | **Status:** Blocked

Linked ticket description...

**Author** (2026-03-01): Comment on the linked ticket...

## Code References

**File Paths:** `/app/models/User.php`, `src/services/CartService.php`
**Methods:** `validateCart`, `processPayment`
**Classes:** `Payment_Validator`, `Zend_Controller_Action`
**Git SHAs:** `abc1234`, `9f8e7d6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e`
**SVN Revisions:** `r4521`
**Branches:** `feature/PROD-1234-fix-payment`
**Namespaces:** `Payment\Validator`, `App\Services\CartService`
```

---

## Depth Traversal

Controls how many levels of linked tickets are fetched.

| Depth | Target ticket | Linked tickets | Linked-of-linked |
|-------|--------------|----------------|------------------|
| 0 | Full (description, comments, attachments) | Not fetched | Not fetched |
| 1 (default) | Full | Description + comments | Not fetched |
| 2 | Full | Description + comments | Key + summary only |

### Safety Limits

- **Max 15 tickets** total regardless of depth setting
- **Circular reference protection**: visited ticket keys are tracked, no ticket is fetched twice
- **Token budget**: a typical depth-0 fetch produces ~500-1500 tokens; depth-1 varies based on linked ticket count

### When to use each depth

- **`--depth=0`**: Quick look at a single ticket. Good for tickets you already know the context of.
- **`--depth=1`** (default): Standard workflow. Linked tickets often contain critical context — CR feedback, QA notes, related implementation details.
- **`--depth=2`**: Deep exploration when you need to understand a cluster of related work. Watch token count.

---

## Code Reference Extraction

The parser scans ticket descriptions and comments to extract:

| Type | Pattern | Examples |
|------|---------|---------|
| File paths (absolute) | `/path/to/file.ext` | `/app/models/User.php` |
| File paths (relative) | `dir/file.ext` | `src/services/CartService.php` |
| Method names | `name()` | `validateCart()`, `getItems()` |
| Class names | `PascalCase_Underscore` | `Payment_Validator`, `Zend_Controller_Action` |
| Git SHAs (full) | 40 hex chars | `9f8e7d6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e` |
| Git SHAs (short) | 7 hex chars (mixed digits+letters) | `abc1234` |
| SVN revisions | `rNNNN` | `r4521` |
| Branch names | `prefix/ticket-name` | `feature/PROD-1234-fix-payment` |
| PHP namespaces | `Ns\SubNs\Class` | `Payment\Validator`, `App\Services\CartService` |

**URL filtering**: URLs (`https://...`) are not extracted as file paths.

**Deduplication**: All results are deduplicated.

---

## VCS Enrichment

When used through the SKILL.md orchestrator (via `/jtb`), Claude detects the VCS in your current directory and runs enrichment commands:

### Git
```bash
git log --all --grep="TICKET-KEY" --oneline --max-count=20
git branch -a | grep "TICKET-KEY"
```

### SVN
```bash
svn log --limit 50 | grep -A5 "TICKET-KEY"
svn ls ^/branches | grep "TICKET-KEY"
```

### Mercurial
```bash
hg log -k "TICKET-KEY" --limit 20
hg branches | grep "TICKET-KEY"
```

If no VCS is detected, this step is skipped. The skill still works without a VCS — you just don't get commit/branch context.

---

## Architecture

```
User types: /jtb PROD-1234            User types: /jtb triage
              │                                    │
              ▼                                    ▼
    SKILL.md (orchestrator)            fetch-my-tickets.mjs
      │  1. Run fetch script             1. resolveConnection()
      │  2. Receive TicketBrief          2. fetchCurrentUser()
      │  3. Detect VCS                   3. searchTickets(jql)
      │  4. Run VCS commands             4. scoreAttention() each
      │  5. Resolve code refs            5. sortByUrgency()
      │  6. Enter plan mode              6. assembleTriageSummary()
      ▼                                    ▼
    Claude plans implementation        Markdown table to stdout
```

**Design principle**: Node.js handles Jira API calls and text parsing (testable, deterministic). Claude handles VCS commands and file lookups (needs actual repo access).

### Key Modules

**jira-client.mjs**
- `normalizeTicket(raw)` — normalizes Jira API response into a consistent shape
- `buildAuthHeader(env)` — returns Basic or Bearer auth header
- `fetchTicket(key, opts)` — fetches ticket with depth traversal
- `fetchCurrentUser(opts)` — `GET /rest/api/2/myself`, returns user identity
- `searchTickets(jql, opts)` — `GET /rest/api/2/search`, returns normalized tickets
- `fetchStatuses(opts)` — `GET /rest/api/2/status`, returns available status names

**attention-scorer.mjs**
- `scoreAttention(ticket, currentUser, opts)` — returns `{ urgency, reason, lastComment }`
- `findLastEffectiveComment(comments, currentUser)` — walks backwards skipping bots, handles VCS commits
- `isBot(authorName)` — detects bot authors (Jira Automation, Jenkins, etc.)
- `isBotCommitByUser(comment, currentUser)` — detects SVN/Git commit bots with author matching
- `sortByUrgency(scores)` — needs-response first, then aging, then by recency

**code-ref-parser.mjs**
- Individual extractors: `extractFilePaths()`, `extractMethodNames()`, `extractClassNames()`, `extractShas()`, `extractSvnRevisions()`, `extractBranches()`, `extractNamespaces()`
- Combined: `extractCodeReferences(text)` returns all categories in one object

**brief-assembler.mjs**
- `assembleBrief(ticket, codeRefs)` — produces ordered markdown from normalized ticket data
- `assembleTriageSummary(scoredTickets, opts)` — produces triage markdown table with quick links

**profile-resolver.mjs**
- `loadProfiles(configDir)` — loads `~/.ticketlens/profiles.json`
- `resolveProfile(ticketKey, opts)` — matches ticket prefix or project path to profile
- `resolveProfileByPath(cwd, configDir)` — matches cwd against profile `projectPaths`
- `resolveConnection(ticketKey, opts)` — full resolution: profile → env var fallback

**vcs-detector.mjs**
- `detectVcs(dir)` — checks for `.git/`, `.svn/`, `.hg/` directories

---

## Troubleshooting

### "Could not determine Jira profile" error (triage)

Triage needs to know which Jira instance to use. Either:
- Use `--profile=NAME` flag
- Add `projectPaths` to your profile so triage can auto-detect from your cwd
- Set a `"default"` profile in `profiles.json`
- Set `JIRA_BASE_URL` + auth env vars

### "Invalid status" error (triage)

Different Jira instances use different status names. If triage reports invalid statuses, it will suggest valid ones. Add the correct statuses to your profile's `triageStatuses` array.

### "Missing env vars" or "Missing config in profile" error

**With profiles**: Ensure `~/.ticketlens/profiles.json` and `~/.ticketlens/credentials.json` both exist and the profile name matches between them. Verify the credentials file has the correct key (`apiToken` for cloud, `pat` for server).

**With env vars**: Ensure `JIRA_BASE_URL` is set and you have either `JIRA_PAT` (Server/DC) or both `JIRA_EMAIL` + `JIRA_API_TOKEN` (Cloud). If set in `~/.zshrc`, run `source ~/.zshrc`.

### Wrong profile selected

Use `--profile=NAME` to force a specific profile. Check that your `ticketPrefixes` arrays don't overlap across profiles. If they do, use `--profile` or reorder the profiles.

### 401 Unauthorized

- **Cloud**: Verify your email matches your Atlassian account and the API token is valid (not expired or revoked)
- **Server**: Verify the PAT has read permissions for the project

### 404 Not Found

- Check the ticket key is correct (case-sensitive, e.g., `PROD-1234` not `prod-1234`)
- Verify you have access to the project in Jira

### 410 Gone (Jira Cloud)

Atlassian has deprecated `/rest/api/2/search` on Cloud instances. This affects `/jtb triage` on Cloud. Migration to v3 API is planned. Jira Server/DC is unaffected.

### No linked tickets showing

- Confirm tickets are linked in Jira (not just mentioned in comments)
- Links must be Jira issue links (Blocks, Relates, etc.), not just text references
- Check you're using `--depth=1` or higher

### Empty code references section

This is normal if the ticket text doesn't contain file paths, class names, SHAs, or other code references. The section is omitted when empty.

---

## Contributing

### Running Tests

```bash
cd ~/.agents/skills/jtb
node --test scripts/test/*.test.mjs
```

All tests use `node:test` + `node:assert` with zero external dependencies.

### Test Structure

| Test file | Module | Tests |
|-----------|--------|-------|
| `code-ref-parser.test.mjs` | code-ref-parser | 12 |
| `vcs-detector.test.mjs` | vcs-detector | 4 |
| `jira-client.test.mjs` | jira-client | 25 |
| `brief-assembler.test.mjs` | brief-assembler | 11 |
| `attention-scorer.test.mjs` | attention-scorer | 27 |
| `profile-resolver.test.mjs` | profile-resolver | 20 |
| `fetch-ticket.test.mjs` | fetch-ticket (integration) | 5 |
| `fetch-my-tickets.test.mjs` | fetch-my-tickets (integration) | 4 |
| **Total** | | **108** |

### Test Fixtures

Jira API response fixtures are at:
```
~/Desktop/Projects/ticket-lens/fixtures/jira-fixtures/
├── PROD-1234-cloud.json     # Jira Cloud format
└── PROD-1234-server.json    # Jira Server format
```

### Adding a New Extractor

1. Add a failing test in `code-ref-parser.test.mjs`
2. Implement the function in `code-ref-parser.mjs`
3. Add it to `extractCodeReferences()`
4. Add the category to `brief-assembler.mjs` categories array
5. Run `node --test scripts/test/*.test.mjs` to verify

### Adding Support for a New VCS

1. Add a test in `vcs-detector.test.mjs` for the new marker directory
2. Add the check in `vcs-detector.mjs`
3. Add enrichment commands in `SKILL.md` under step 3

### Design Principles

- **Zero dependencies**: Only Node.js built-ins. No npm install needed.
- **Injectable I/O**: All API functions accept a `fetcher` parameter for testing without hitting Jira.
- **TDD**: Every feature was built test-first with red-green-refactor.
- **VCS-agnostic**: Works with Git, SVN, Hg, or no VCS at all.
- **Graceful degradation**: Missing fields, empty sections, and no-VCS scenarios all handled cleanly.
