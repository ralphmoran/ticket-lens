# Jira TicketBrief (JTB) — User Guide

A Claude Code skill that fetches a Jira ticket's full context and produces a structured implementation brief. Works with Jira Cloud and Jira Server/Data Center. Supports Git, SVN, and Mercurial repositories.

---

## Table of Contents

- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Output Format](#output-format)
- [Depth Traversal](#depth-traversal)
- [Code Reference Extraction](#code-reference-extraction)
- [VCS Enrichment](#vcs-enrichment)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)
- [Roadmap: /jtb check](#roadmap-jtb-check)
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
    ├── fetch-ticket.mjs            # CLI entry point
    ├── lib/
    │   ├── jira-client.mjs         # Jira REST API client
    │   ├── code-ref-parser.mjs     # Code reference extraction
    │   ├── vcs-detector.mjs        # VCS detection
    │   ├── brief-assembler.mjs     # Markdown output assembly
    │   └── profile-resolver.mjs    # Multi-account profile resolution
    └── test/
        ├── code-ref-parser.test.mjs
        ├── vcs-detector.test.mjs
        ├── jira-client.test.mjs
        ├── brief-assembler.test.mjs
        ├── profile-resolver.test.mjs
        └── fetch-ticket.test.mjs
```

---

## Configuration

### Multi-Account Profiles (Recommended)

Profiles let you work with multiple Jira instances. Tickets are automatically routed to the right account based on their prefix.

#### 1. Create `~/.ticketlens/profiles.json`

```json
{
  "profiles": {
    "myteam": {
      "baseUrl": "https://myteam.atlassian.net",
      "auth": "cloud",
      "email": "you@example.com",
      "ticketPrefixes": ["PROJ", "OPS"]
    },
    "client": {
      "baseUrl": "https://jira.client.com",
      "auth": "server",
      "ticketPrefixes": ["CLI"]
    }
  },
  "default": "myteam"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `baseUrl` | Yes | Jira instance URL |
| `auth` | Yes | `"cloud"` (Basic) or `"server"` (Bearer PAT) |
| `email` | Cloud only | Your Atlassian email |
| `ticketPrefixes` | Yes | Array of Jira project keys this profile handles |

#### 2. Create `~/.ticketlens/credentials.json`

```json
{
  "myteam": { "apiToken": "your-cloud-api-token" },
  "client": { "pat": "your-server-pat" }
}
```

Secure this file: `chmod 600 ~/.ticketlens/credentials.json`

For Cloud accounts, generate tokens at https://id.atlassian.com/manage-profile/security/api-tokens. For Server/DC, create a PAT in your Jira profile settings.

#### Resolution Order

When you run `/jtb PROJ-42`, the profile is resolved in this order:

1. **`--profile` flag** — explicit override (`/jtb PROJ-42 --profile=client`)
2. **Prefix match** — ticket prefix `PROJ` matches "myteam" profile
3. **Default profile** — falls back to the `"default"` profile if no prefix matches
4. **Environment variables** — falls back to `JIRA_BASE_URL` / `JIRA_PAT` / `JIRA_EMAIL` + `JIRA_API_TOKEN`

If a prefix matches multiple profiles, a warning is emitted and the first match is used.

#### Adding a New Account

1. Add a profile entry to `~/.ticketlens/profiles.json` with the project's ticket prefixes
2. Add matching credentials to `~/.ticketlens/credentials.json`
3. Test: `node ~/.agents/skills/jtb/scripts/fetch-ticket.mjs NEWPROJ-1 --depth=0`

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
| 0 | Success — TicketBrief printed to stdout |
| 1 | Error — missing args, missing env vars, or API failure (details on stderr) |

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
User types: /jtb PROD-1234
              │
              ▼
    SKILL.md (orchestrator — runs in Claude)
      │  1. Validate env vars
      │  2. Run fetch script ──────────────────┐
      │                                         ▼
      │                          fetch-ticket.mjs (Node.js CLI)
      │                            ├─ jira-client.mjs    → Jira REST API
      │                            ├─ code-ref-parser.mjs → regex extraction
      │                            └─ brief-assembler.mjs → markdown output
      │                                         │
      │  3. Receive TicketBrief on stdout ◄─────┘
      │  4. Detect VCS (vcs-detector.mjs logic)
      │  5. Run VCS enrichment commands
      │  6. Resolve file paths and class names in repo
      │  7. Enter plan mode with full context
      ▼
    Claude plans the implementation
```

**Design principle**: Node.js handles Jira API calls and text parsing (testable, deterministic). Claude handles VCS commands and file lookups (needs actual repo access).

### Key Modules

**jira-client.mjs**
- `normalizeTicket(raw)` — normalizes Jira API response into a consistent shape
- `buildAuthHeader(env)` — returns Basic or Bearer auth header
- `fetchTicket(key, opts)` — fetches ticket with depth traversal. Accepts an injectable `fetcher` for testing.

**code-ref-parser.mjs**
- Individual extractors: `extractFilePaths()`, `extractMethodNames()`, `extractClassNames()`, `extractShas()`, `extractSvnRevisions()`, `extractBranches()`, `extractNamespaces()`
- Combined: `extractCodeReferences(text)` returns all categories in one object

**brief-assembler.mjs**
- `assembleBrief(ticket, codeRefs)` — produces ordered markdown from normalized ticket data

**profile-resolver.mjs**
- `loadProfiles(configDir)` — loads `~/.ticketlens/profiles.json`
- `resolveProfile(ticketKey, opts)` — matches ticket prefix to profile
- `resolveConnection(ticketKey, opts)` — full resolution: profile → env var fallback, returns `{ baseUrl, email, apiToken, pat, source, profileName }`

**vcs-detector.mjs**
- `detectVcs(dir)` — checks for `.git/`, `.svn/`, `.hg/` directories

---

## Troubleshooting

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

### No linked tickets showing

- Confirm tickets are linked in Jira (not just mentioned in comments)
- Links must be Jira issue links (Blocks, Relates, etc.), not just text references
- Check you're using `--depth=1` or higher

### Empty code references section

This is normal if the ticket text doesn't contain file paths, class names, SHAs, or other code references. The section is omitted when empty.

---

## Roadmap: /jtb check

The next iteration adds a ticket attention scanner:

```
/jtb check                    # Check all your tickets needing attention
/jtb check --status=CR,QA     # Filter by status
```

**What it does**: Scans your assigned Jira tickets and flags ones that need attention:

- **Needs response**: Someone commented after your last comment (CR reviewer, QA tester)
- **Aging**: Ticket stuck in same status for too long with no activity

**Output**:
```markdown
## Tickets Needing Your Attention (3 found)

### Needs Response
- **PROD-1234** Fix payment validation — @sarah (QA) commented 2h ago:
  "Found edge case with empty cart, see screenshot"

### Aging (no activity > 3 days)
- **PROD-1050** Update API docs — In CR for 5 days, no reviewer comments
```

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
| `jira-client.test.mjs` | jira-client | 14 |
| `brief-assembler.test.mjs` | brief-assembler | 8 |
| `profile-resolver.test.mjs` | profile-resolver | 13 |
| `fetch-ticket.test.mjs` | fetch-ticket (integration) | 5 |
| **Total** | | **56** |

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
- **Injectable I/O**: `fetchTicket()` accepts a `fetcher` parameter for testing without hitting Jira.
- **TDD**: Every feature was built test-first with red-green-refactor.
- **VCS-agnostic**: Works with Git, SVN, Hg, or no VCS at all.
- **Graceful degradation**: Missing fields, empty sections, and no-VCS scenarios all handled cleanly.
