<div align="center">

# TicketLens

<div align="center">
  <img src="https://img.shields.io/npm/v/ticketlens?style=flat-square&color=6c63ff&label=version" />
  <img src="https://img.shields.io/npm/dm/ticketlens?style=flat-square&color=06b6d4&label=downloads" />
  <img src="https://github.com/ralphmoran/ticket-lens/actions/workflows/test.yml/badge.svg?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" />
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen?style=flat-square" />
</div>

</div>

> Your AI assistant shouldn't need to read your tickets.

> Works alongside Atlassian MCP — Atlassian MCP writes the tickets; TicketLens tells you which ones need you right now.

<div align="center"><img src="docs/demos/fetch.gif" alt="ticketlens CNV1-2 demo" width="700" /></div>

---

## What is TicketLens?

TicketLens is a local-first Jira CLI that preprocesses ticket context on your machine and hands your AI tools a clean, compressed brief — instead of dumping raw Jira API JSON into your session. It supports Jira Cloud, Server, and Data Center, works with any AI tool that accepts text, and runs independently of any AI session.

Zero npm dependencies. Node.js built-ins only.

---

## Why TicketLens?

- **Privacy** — ticket content never leaves your machine; no cloud relay, no data sent to Anthropic or anyone else
- **60–80% token savings** — structured briefs instead of verbose Jira JSON; 4-hour cache by default
- **Scriptable** — standard CLI output: pipe to cron, git hooks, CI/CD, or any LLM tool
- **Multi-profile** — connect multiple Jira instances simultaneously; auto-route by ticket prefix or project path
- **Attachments included** — images, PDFs, and text files downloaded locally; Claude Code reads them as context
- **Confluence pages** — linked Confluence pages fetched and included in the brief automatically (Jira only)

---

## Quick Start

```bash
npm install -g ticketlens
ticketlens init          # Guided setup: Jira, GitHub Issues, or Linear — connection test included
ticketlens CNV1-2        # Fetch a ticket brief
ticketlens triage        # Scan your assigned tickets
```

Or without installing:

```bash
npx ticketlens init
npx ticketlens CNV1-2
```

**Prerequisites:** Node.js >=20

---

## Demos

<div align="center"><img src="docs/demos/triage.gif" alt="ticketlens triage demo" width="700" /></div>

---

## Commands

### Setup

| Command | Description |
|---------|-------------|
| `ticketlens init` | Guided wizard — Jira, GitHub Issues, or Linear — live connection test, optional settings |
| `ticketlens switch` | Arrow-key panel to switch between configured profiles |
| `ticketlens config [--profile=NAME]` | Edit any field on an existing profile — always re-validates the connection |
| `ticketlens profiles` | List all configured profiles (alias: `ticketlens ls`) |
| `ticketlens delete <NAME>` | Remove a profile and its credentials (prompts `y/N` in TTY; use `--yes` in scripts/CI) |

`init` collects: profile name, tracker type (Jira / GitHub Issues / Linear), URL or workspace, credentials (masked), and optional ticket prefixes, project paths, and triage statuses. On connection failure, a retry menu lets you fix credentials, URL, or skip — all inputs pre-populated. `config` is tracker-aware and always re-validates the connection after edits.

`config` uses merge semantics: new ticket prefixes and triage statuses are added to existing lists, never replaced. Partial matching resolves `QA` to `QA Testing` if that's the status in your Jira.

---

### Fetch a ticket

```bash
ticketlens CNV1-2                  # Depth 1, styled output (default)
ticketlens get CNV1-2              # Same — explicit alias
ticketlens CNV1-2 --depth=0        # Target ticket only
ticketlens CNV1-2 --depth=1        # + linked ticket descriptions and comments
ticketlens CNV1-2 --depth=2        # + linked-of-linked (full graph)
ticketlens CNV1-2 --plain          # Plain markdown — pipe-safe, LLM-ready
ticketlens CNV1-2 --profile=acme   # Force a specific profile
ticketlens CNV1-2 --no-cache       # Bypass cache, re-fetch from Jira
ticketlens CNV1-2 --no-attachments # Skip attachment download and Confluence page fetching
ticketlens CNV1-2 --check          # Append local VCS diff + Claude Code review instructions
ticketlens CNV1-2 --compliance     # Check ticket requirements against local diff [Pro/Free 3/mo]
ticketlens CNV1-2 --summarize                  # AI summary via your own API key (BYOK) [Pro]
ticketlens CNV1-2 --summarize --provider=groq  # Force a specific AI provider [Pro]
ticketlens CNV1-2 --summarize --cloud          # AI summary routed through TicketLens API [Pro]
ticketlens CNV1-2 --handoff                    # AI handoff brief from comment thread (BYOK) [Pro]
ticketlens CNV1-2 --handoff --cloud            # AI handoff brief via TicketLens API [Pro]
```

| `--depth` | Scope |
|-----------|-------|
| `0` | Target ticket: description, comments, attachments, Confluence pages |
| `1` | + linked tickets: descriptions and comments _(default)_ |
| `2` | + linked-of-linked: key and summary only |

Max 15 tickets at any depth. Circular references handled automatically.

After the first fetch, ticket data is cached to `~/.ticketlens/cache/PROFILE/TICKET-KEY/brief.json` (4h TTL, depth-aware). A dim notice appears on stderr on cache hit:

```
  ○ CNV1-2 · from cache (12m ago)  ·  --no-cache to refresh
```

Attachments download to `~/.ticketlens/cache/TICKET-KEY/` (10 MB per-file cap). Claude Code reads images multimodally, extracts PDF text, and reads plain text files as context.

Confluence pages linked to the ticket via Jira Remote Links are fetched automatically and included as plain text in the brief (Jira profiles only, same-origin). Use `--no-attachments` to skip both attachments and Confluence pages.

---

### Triage

```bash
ticketlens triage                               # Scan assigned tickets — interactive
ticketlens triage --profile=acme               # Explicit profile
ticketlens triage --stale=3                    # Aging threshold: 3 days (default: 5)
ticketlens triage --status="Code Review,QA"    # Override statuses to scan
ticketlens triage --assignee="Jane Dev"        # Another dev's tickets [Team]
ticketlens triage --sprint="Sprint 12"         # Filter by sprint [Team]
ticketlens triage --export=csv                 # Export results to CSV [Team]
ticketlens triage --export=json                # Export results to JSON [Team]
ticketlens triage --push                       # Push snapshot to Console queue [Team]
ticketlens triage --digest                     # POST scored results to digest endpoint [Pro]
ticketlens triage --plain                      # Plain markdown — pipe to file or LLM
ticketlens triage --static                     # Static table, no interactive mode
```

| Badge | Category | Condition |
|-------|----------|-----------|
| `●` red | Needs response | Someone else commented within the last N days |
| `●` yellow | Aging | Last comment or update is N+ days old |

`--stale=N` controls both categories. Unanswered comments older than N days downgrade from "needs response" to "aging" automatically.

Interactive mode: `↑/↓` navigate, `Enter` open in browser, `p` switch profile, `q/Esc` exit. Columns adapt to terminal width.

Status mismatch auto-fix: if configured statuses don't match Jira's exact casing, triage shows a diff and offers to update your profile:

```
  ~ In progress  →  In Progress
  ~ QA           →  QA Testing

  Update "myteam" with corrected statuses?  y/N
```

Bot comments (Jira Automation, Jenkins, GitHub Actions) are automatically ignored.

---

### Review

```bash
ticketlens review                             # Assemble PR review context from current branch
ticketlens review --branch=main              # Compare against main (auto-detected by default)
ticketlens review --branch=develop           # Compare against a specific branch
ticketlens review --base=main                # Alias for --branch
ticketlens review --profile=acme             # Use a specific profile for ticket fetching
ticketlens review --branch=main | pbcopy     # Copy brief to clipboard
ticketlens review --branch=main | llm "What changed and why?"
ticketlens review --help                     # Review subcommand help
```

Extracts linked ticket keys from the branch name and commit messages, fetches each ticket via the configured profile, then assembles a structured brief: branch, changed files, and ticket context. On TTY, output is ANSI-styled with colored section headers, file paths, and coverage percentages.

`--branch=BRANCH` (or `--base=BRANCH`) sets the comparison base. Defaults to auto-detecting `main`, `master`, or `develop`.

Flag validation provides actionable hints:

```
✖ Unknown flag: --branch-main
  Did you mean --branch=main?
```

---

### Standup

```bash
ticketlens standup                            # Standup summary for the last 24 hours
ticketlens standup --since=48                 # Last 48 hours
ticketlens standup --since=yesterday          # Git date string
ticketlens standup --format=pr               # PR body format: "What changed" + commit list
ticketlens standup --profile=myteam          # Enrich with ticket summaries from Jira
ticketlens standup --plain                   # Plain markdown (no ANSI colour)
ticketlens standup --plain | pbcopy          # Copy standup to clipboard
ticketlens standup --help                    # Standup subcommand help
```

Scans `git log` for the configured window, extracts ticket keys from commit messages, and groups commits by ticket. Optionally fetches ticket summaries from your Jira profile to add context. Outputs a dated standup brief or a PR body depending on `--format`.

**`--format=standup` (default)**
```
## Standup — Mon, May 18, 2026

### Commits by ticket

**PROJ-123** — Fix payment validation (2 commits)
  abc1234 feat: PROJ-123 add payment validation check
  def5678 test: PROJ-123 payment validation tests

[No ticket key] (1 commit)
  jkl3456 chore: bump deps
```

**`--format=pr`** — paste directly into a GitHub/GitLab PR description
```
## What changed

- **PROJ-123** — Fix payment validation

## Commits (3)

- `abc1234` feat: PROJ-123 add payment validation check
- `def5678` test: PROJ-123 payment validation tests
- `jkl3456` chore: bump deps
```

When no commits reference a ticket key, `## What changed` shows `_No ticket references found in commits._` instead of a blank section.

---

### Cache

```bash
ticketlens cache size                          # Disk usage by profile and ticket
ticketlens cache size --profile=acme           # Filter to one profile
ticketlens cache clear                         # Interactive picker (TTY)
ticketlens clear                               # Alias for cache clear
ticketlens cache clear CNV1-2                  # Clear one ticket
ticketlens cache clear --older-than=7d         # Files older than 7 days
ticketlens cache clear --profile=acme          # One profile's files only
ticketlens cache clear --older-than=30d --yes  # Skip confirmation (CI/scripts)
```

Age units: `d` = days · `m` = months (30d) · `y` = years (365d)

Cache locations:
- Attachments: `~/.ticketlens/cache/TICKET-KEY/`
- Briefs: `~/.ticketlens/cache/PROFILE/TICKET-KEY/brief.json`

---

### Schedule

```bash
ticketlens schedule               # Interactive wizard — set digest time, timezone, profile [Pro]
ticketlens schedule --stop        # Cancel the scheduled digest
ticketlens schedule --status      # Show current schedule
```

Stores the schedule as a cron entry. Delivers your triage digest at the configured time without an open terminal. Requires a Pro license.

---

### Login

```bash
ticketlens login           # Open browser → authorize in Console → token saved automatically
ticketlens login --manual  # Paste a token instead (CI/headless environments)
```

`ticketlens login` opens the TicketLens Console in your default browser. Click **Authorize**, and the CLI receives your token via a one-shot localhost callback — no copy-pasting. Cancelling in the browser exits the CLI cleanly.

Use `--manual` when there is no GUI (CI runners, SSH sessions, containers).

---

### License

```bash
ticketlens license                # Show tier and status
ticketlens activate <KEY>         # Activate a Pro or Team license
```

---

### /jtb — Jira TicketBrief for Claude Code

`/jtb` is a Claude Code slash command that fetches full ticket context and drops a structured implementation brief directly into your session, then enters plan mode.

> Requires [Claude Code](https://claude.ai/code). For standalone use, the `ticketlens` commands above work independently.

**Install:**

```bash
npm install -g ticketlens && ticketlens init
cp $(npm root -g)/ticketlens/skills/jtb/SKILL.md ~/.claude/commands/jtb.md
# Restart Claude Code, then:
# /jtb CNV1-2
```

**Usage in Claude Code:**

```
/jtb CNV1-2                    # Fetch ticket + linked issues → plan mode
/jtb CNV1-2 --depth=0          # Target ticket only (fast)
/jtb CNV1-2 --depth=2          # Deep: full linked-issue graph
/jtb CNV1-2 --profile=acme     # Force a specific profile
/jtb CNV1-2 --no-attachments   # Skip attachment download
/jtb CNV1-2 --no-cache         # Re-fetch from Jira
/jtb triage                    # Scan your assigned tickets
```

Attachments are listed in the brief as absolute paths. Claude Code reads images (multimodal), PDFs, and text files before planning. Files over 10 MB are skipped.

---

## All Examples

```bash
# ── Setup ────────────────────────────────────────────────────────────────────
ticketlens init                               # Guided wizard (recommended)
ticketlens switch                             # Switch between configured profiles
ticketlens config                             # Edit the active profile
ticketlens config --profile=acme             # Edit a specific profile
ticketlens config set aiProvider groq        # Set default AI provider (groq|openai|anthropic)
ticketlens profiles                           # List all configured profiles
ticketlens ls                                 # Alias for profiles
ticketlens profiles --plain                   # Tab-separated (scripts / pipes)
ticketlens delete <PROFILE-NAME>              # Remove a profile (prompts y/N in TTY)
ticketlens delete <PROFILE-NAME> --yes        # Remove without prompt (scripts/CI)

# ── Fetch a ticket brief ──────────────────────────────────────────────────────
ticketlens CNV1-2                            # Fetch with defaults (depth 1, styled)
ticketlens get CNV1-2                        # Explicit alias (same result)
ticketlens CNV1-2 --depth=0                  # Target ticket only — no linked issues
ticketlens CNV1-2 --depth=1                  # + linked ticket descriptions and comments
ticketlens CNV1-2 --depth=2                  # + linked-of-linked (full graph)
ticketlens CNV1-2 --profile=acme             # Force a specific Jira profile
ticketlens CNV1-2 --plain                    # Plain markdown — no color codes
ticketlens CNV1-2 --styled                   # Force ANSI color even when piping
ticketlens CNV1-2 --no-attachments           # Skip attachment download entirely
ticketlens CNV1-2 --no-cache                 # Skip brief cache + force re-download
ticketlens CNV1-2 --check                    # Append local VCS diff + Claude Code review instructions
ticketlens CNV1-2 --compliance               # Check ticket requirements against local diff [Pro/Free 3/mo]
ticketlens CNV1-2 --summarize                   # AI summary via your own API key (BYOK) [Pro]
ticketlens CNV1-2 --summarize --provider=groq   # Force Groq (Llama 3.1, free tier) [Pro]
ticketlens CNV1-2 --summarize --cloud           # AI summary via TicketLens API [Pro]
ticketlens CNV1-2 --handoff                     # AI handoff brief from comment thread (BYOK) [Pro]
ticketlens CNV1-2 --handoff --cloud             # AI handoff brief via TicketLens API [Pro]
ticketlens CNV1-2 --depth=2 --profile=acme --plain   # Combine flags freely

# Pipe plain output to clipboard, LLM, or file
ticketlens CNV1-2 --plain > brief.md
ticketlens CNV1-2 --plain | pbcopy
ticketlens CNV1-2 --plain | llm "Summarize this ticket in 3 bullets"

# ── Triage ────────────────────────────────────────────────────────────────────
ticketlens triage                             # Scan assigned tickets — interactive
ticketlens triage --profile=acme             # Explicit profile
ticketlens triage --stale=3                  # Needs-response window: 3 days (default: 5)
ticketlens triage --stale=10                 # More lenient — only flag very stale tickets
ticketlens triage --status="Code Review,QA Testing"  # Scan these statuses only
ticketlens triage --static                   # Static table output (no interactive mode)
ticketlens triage --plain                    # Plain markdown — pipe to LLM or file
ticketlens triage --assignee="Jane Dev"      # View another dev's tickets [Team]
ticketlens triage --sprint="Sprint 12"       # Filter by sprint name [Team]
ticketlens triage --assignee="Jane Dev" --sprint="Sprint 12"  # Combined [Team]
ticketlens triage --export=csv               # Export to CSV [Team]
ticketlens triage --export=json              # Export to JSON [Team]
ticketlens triage --push                     # Push snapshot to Console queue [Team]
ticketlens triage --digest                   # POST results to digest endpoint [Pro]
ticketlens triage --profile=acme --stale=3 --static          # Combine flags

# Pipe triage output
ticketlens triage --plain > my-tickets.md
ticketlens triage --plain | llm "Which ticket is most urgent and why?"

# ── PR Review ─────────────────────────────────────────────────────────────────
ticketlens review                             # Assemble PR review context from current branch
ticketlens review --branch=main              # Compare against main (auto-detected by default)
ticketlens review --branch=develop           # Compare against a specific branch
ticketlens review --base=main                # Alias for --branch
ticketlens review --profile=acme             # Use a specific profile for ticket fetching
ticketlens review --branch=main | pbcopy     # Copy brief to clipboard
ticketlens review --branch=main --profile=myteam  # Branch + profile combined
ticketlens review --help                     # Review subcommand help

# ── Standup ───────────────────────────────────────────────────────────────────
ticketlens standup                            # Standup summary for last 24 hours
ticketlens standup --since=48                 # Last 48 hours
ticketlens standup --since=yesterday          # Git date string
ticketlens standup --format=pr               # PR body: "What changed" + commit list
ticketlens standup --profile=myteam          # Enrich with Jira ticket summaries
ticketlens standup --plain | pbcopy          # Copy to clipboard
ticketlens standup --help                    # Standup subcommand help

# ── Cache management ──────────────────────────────────────────────────────────
ticketlens cache                              # Overview + subcommand hints
ticketlens cache --help                       # Detailed help
ticketlens cache size                         # Disk usage by profile and ticket
ticketlens cache size --profile=acme          # Filter to one profile only
ticketlens cache clear                        # Interactive picker (TTY)
ticketlens clear                              # Alias for cache clear
ticketlens cache clear CNV1-2                # Clear one ticket's cache
ticketlens cache clear --older-than=7d        # Files older than 7 days
ticketlens cache clear --older-than=1m        # Files older than 1 month
ticketlens cache clear --older-than=1y        # Files older than 1 year
ticketlens cache clear --profile=acme         # Only one profile's files
ticketlens cache clear CNV1-2 --older-than=7d            # Ticket + age filter
ticketlens cache clear --profile=acme --older-than=30d   # Profile + age filter
ticketlens cache clear --older-than=30d --yes            # Skip confirmation (CI/scripts)

# ── Schedule ─────────────────────────────────────────────────────────────────
ticketlens schedule                           # Interactive wizard — set time, timezone, profile [Pro]
ticketlens schedule --stop                    # Cancel the scheduled digest [Pro]
ticketlens schedule --status                  # Show current schedule [Pro]

# ── Login ─────────────────────────────────────────────────────────────────────
ticketlens login                              # Browser flow — opens Console, token saved automatically
ticketlens login --manual                     # Paste flow — for CI/headless environments

# ── License and account ────────────────────────────────────────────────────────
ticketlens license                            # Show license tier and status
ticketlens activate <LICENSE-KEY>             # Activate a license key

# ── Help and version ──────────────────────────────────────────────────────────
ticketlens --help                             # Main help
ticketlens --version                          # Show installed version
ticketlens CNV1-2 --help                     # Fetch subcommand help
ticketlens triage --help                      # Triage subcommand help
ticketlens review --help                      # Review subcommand help
ticketlens cache --help                       # Cache overview help
ticketlens cache size --help                  # Cache size help
ticketlens cache clear --help                 # Cache clear help
```

---

## Pro & Teams Features

Start free, upgrade when you need it — `ticketlens activate <key>`

### Pro — $8/mo

<div align="center">
  <img src="docs/demos/pro-triage.gif" alt="ticketlens --summarize AI summary demo" width="700" />
</div>

```bash
ticketlens CNV1-2 --summarize            # AI summary via your own API key (BYOK)
ticketlens CNV1-2 --summarize --cloud    # AI summary via TicketLens API (no local key needed)
ticketlens CNV1-2 --handoff              # AI handoff brief from the ticket's comment thread (BYOK)
ticketlens CNV1-2 --handoff --cloud      # AI handoff brief via TicketLens API
ticketlens CNV1-2 --compliance           # Check ticket requirements against local diff [Free 3/mo]
ticketlens triage --stale=3              # Custom stale threshold (default is 5)
ticketlens triage --digest               # POST scored triage results to digest endpoint
ticketlens schedule                      # Set up a scheduled daily digest
ticketlens activate YOUR-LICENSE-KEY     # Activate Pro license
```

**`--summarize`** generates a 3-sentence AI summary of the ticket. The AI receives the full ticket context: description, comments, linked Confluence pages, and any text-readable attachments.

**`--handoff`** synthesizes the ticket into a structured one-pager for the developer picking up the work. The AI receives the same full context and returns:

- **What was attempted** — concrete work already done
- **Current blockers** — unresolved issues
- **Open questions** — decisions not yet made
- **Recommendation** — where to start

**What the AI can read:**

| Content | Included |
|---|---|
| Description | ✅ Always |
| Comments | ✅ Always |
| Linked Confluence pages | ✅ Jira only, same-origin |
| Text files (`.txt`, `.md`, `.log`, `.csv`, `.json`, `.yaml`, etc.) | ✅ Up to 4 KB per file, 12 KB total |
| Screenshots (`.png`, `.jpg`, `.gif`, etc.) | ❌ Binary — images require multimodal API |
| PDFs | ❌ Binary — no parser included (zero-dependency) |
| Office documents (`.docx`, `.xlsx`) | ❌ Binary — no parser included |

Add one of the following to `~/.ticketlens/credentials.json` for BYOK, or use `--cloud` to route through the TicketLens API:

| Key | Provider | Cost |
|---|---|---|
| `anthropicApiKey` | Anthropic (Claude Haiku) | Paid |
| `openaiApiKey` | OpenAI (GPT-4o mini) | Paid |
| `groqApiKey` | Groq (Llama 3.1 8B) | **Free tier** — [console.groq.com](https://console.groq.com) |

**Selecting a provider:** By default, the first available key is used (Anthropic → OpenAI → Groq). To set a persistent default:

```bash
ticketlens config set aiProvider groq        # always use Groq
ticketlens config set aiProvider openai      # always use OpenAI
ticketlens config set aiProvider anthropic   # always use Anthropic
```

Override per-command with `--provider=`:

```bash
ticketlens CNV1-2 --summarize --provider=groq
ticketlens CNV1-2 --handoff --provider=openai
```

<div align="center">
  <img src="docs/demos/pro-triage.gif" alt="ticketlens triage --stale=3 demo" width="700" />
</div>

Pro also unlocks configurable brief cache TTL per profile — set `cacheTtl` to `4h`, `1d`, `7d`, `30d`, or `0` (disable) via `ticketlens config`. Free tier is fixed at 4h.

### Team — $15/seat/mo

<div align="center">
  <img src="docs/demos/teams-digest.gif" alt="ticketlens triage --plain digest pipeline demo" width="700" />
</div>

```bash
ticketlens triage --assignee="Jane Dev"        # View another dev's tickets
ticketlens triage --sprint="Sprint 12"         # Filter by sprint name
ticketlens triage --export=csv                 # Export triage to CSV for standups and reports
ticketlens triage --export=json                # Machine-readable export for dashboards
ticketlens triage --push                       # Push snapshot to the Console queue
```

`--push` syncs the scored snapshot to the TicketLens Console after each triage run. The queue page at `/console/queue` shows the latest snapshot for every team profile — no manual refresh needed.

Automate a morning digest with cron — no open terminal required:

```bash
0 9 * * 1-5 ticketlens triage --plain > ~/digest-$(date +%F).md
```

Multi-profile team workflows: each teammate runs `ticketlens init` with their own credentials; shared `ticketPrefixes` auto-route tickets to the right Jira instance.

---

## Multi-Profile Setup

Profiles live in `~/.ticketlens/profiles.json`:

```json
{
  "profiles": {
    "myteam": {
      "baseUrl": "https://myteam.atlassian.net",
      "auth": "cloud",
      "email": "you@myteam.com",
      "ticketPrefixes": ["PROJ", "OPS"],
      "projectPaths": ["~/projects/myteam-app"],
      "triageStatuses": ["In Progress", "Code Review", "QA Testing"]
    },
    "client": {
      "baseUrl": "https://jira.client.com",
      "auth": "server",
      "email": "yourname",
      "ticketPrefixes": ["ACME", "SHOP"],
      "projectPaths": ["~/projects/client-app"],
      "triageStatuses": ["In Progress", "In Development", "QA"]
    }
  }
}
```

Credentials in `~/.ticketlens/credentials.json` (chmod 600):

```json
{
  "myteam": { "apiToken": "your-atlassian-api-token" },
  "client":  { "pat": "your-jira-server-pat" }
}
```

**Profile resolution order:**

| Priority | Method | Example |
|----------|--------|---------|
| 1 | `--profile=NAME` flag | `ticketlens CNV1-2 --profile=client` |
| 2 | Ticket prefix match | `ticketlens CNV1-2` → prefix `PROJ` → `myteam` |
| 3 | Project path match | `triage` in `~/projects/myteam-app` → `myteam` |
| 4 | `config.default` field | Explicit default set via `ticketlens switch` |
| 5 | First profile in file | Fallback when `config.default` is absent |
| 6 | Environment variables | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` / `JIRA_PAT` |

---

## Running Tests

```bash
npm test
```

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full plan.

Recently shipped:
- **"TicketLens for PRs"** (`ticketlens review`) — assembles a code-review context brief from your current branch: extracts linked ticket keys from the branch name and commits, fetches each ticket, and outputs a structured brief with branch, changed files, and ticket context. Styled ANSI output, spinner, flag validation with typo hints, and base-branch safety check
- **Confluence pages** — linked Confluence pages fetched automatically and included in the brief; origin-validated, non-fatal, capped at 10 pages
- **Linear support** — `ticketlens init` → Linear; connects via GraphQL API key, fetches tickets, triage, and statuses
- **GitHub Issues support** — `ticketlens init` → GitHub Issues; PAT-based, same normalized ticket shape
- **Tracker-aware config** — `ticketlens config` shows the right labels and skips irrelevant prompts per tracker type; always re-validates the connection

---

## Contributing

Bug reports and feature requests welcome — open an issue on [GitHub](https://github.com/ralphmoran/ticket-lens/issues). For larger changes, open an issue first to discuss.

---

## License

[MIT](LICENSE) © Ralph Moran
