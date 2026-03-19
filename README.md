# TicketLens

**Stop tab-switching. Start building.**

TicketLens is a zero-dependency CLI that fetches full Jira ticket context — description, comments, linked issues, attachments, and code references — directly into your terminal or Claude Code session.

## Contents

- [Quick Start](#quick-start)
- [Commands](#commands)
  - [ticketlens init — Setup wizard](#ticketlens-init--setup-wizard)
  - [ticketlens switch — Switch active profile](#ticketlens-switch--switch-active-profile)
  - [ticketlens config — Edit profile settings](#ticketlens-config--edit-profile-settings)
  - [ticketlens TICKET-KEY — Fetch a ticket brief](#ticketlens-ticket-key--fetch-a-ticket-brief)
  - [ticketlens triage — Ticket attention scanner](#ticketlens-triage--ticket-attention-scanner)
  - [ticketlens cache — Cache manager](#ticketlens-cache--cache-manager)
  - [ticketlens license — License status](#ticketlens-license--license-status)
  - [/jtb — Jira TicketBrief for Claude Code](#jtb--jira-ticketbrief-for-claude-code)
- [All Examples](#all-examples)
- [Multi-Profile Setup](#multi-profile-setup)
- [Profile Resolution Order](#profile-resolution-order)
- [Architecture](#architecture)
- [Running Tests](#running-tests)
- [Roadmap](#roadmap)
- [Known Issues](#known-issues)

---

## Quick Start

```bash
npm install -g ticketlens
ticketlens init          # Guided setup wizard (Jira URL, auth, optional settings)
ticketlens PROJ-123      # Fetch a ticket brief
ticketlens triage        # Scan your assigned tickets
```

Or without installing:

```bash
npx ticketlens init
npx ticketlens PROJ-123
```

---

## Commands

### ticketlens init — Setup wizard

Interactive wizard that configures your Jira connection. Run this first.

```bash
ticketlens init
```

What the wizard collects:

1. **Profile name** — short identifier: `work`, `acme`, `myteam`
2. **Jira URL** — suggestions are offered (e.g. `https://acme.atlassian.net`, `https://jira.acme.com`). Bare hostnames like `jira.acme.com` are accepted — `https://` is probed first, then `http://`.
3. **Auth type** — auto-detected from the URL:
   - `*.atlassian.net` → Jira Cloud (email + API token)
   - Any other hostname → PAT (Server/DC 8.14+) or Basic auth (username + password)
4. **Credentials** — masked input; pre-populated on retry so you only fix what's wrong
5. **Live connection test** — shows `● Connected` or a classified error. On failure, a menu offers:
   - **Retry** — e.g. VPN just connected
   - **Edit credentials** — token or email typo
   - **Edit from URL** — wrong URL or auth type
   - **Skip**
6. **Optional settings** (all skippable with Enter):
   - **Ticket prefixes** — e.g. `PROJ,OPS` — auto-routes `PROJ-123` to this profile without needing `--profile`
   - **Project paths** — e.g. `~/projects/myapp` — auto-activates this profile when your terminal is in that directory
   - **Triage statuses** — Jira statuses to scan (default: `In Progress, Code Review, QA`). Validated live; case mismatches are auto-corrected.
7. **Add another?** — repeat for each Jira instance you have
8. **Select active profile** — arrow-key panel (if more than one configured)

Config is written to `~/.ticketlens/profiles.json` and `~/.ticketlens/credentials.json` (chmod 600). Profiles are only saved on a **successful connection test**.

---

### ticketlens switch — Switch active profile

Switch between configured Jira connections without re-running init.

```bash
ticketlens switch
```

Opens a titled arrow-key panel listing all configured profiles. The active profile has a green `● active` badge. Selecting a different profile tests the connection live and updates `profiles.json`.

---

### ticketlens config — Edit profile settings

Edit any setting on an existing profile without re-running the full wizard.

```bash
ticketlens config                    # Edit the default/active profile
ticketlens config --profile=acme     # Edit a specific profile by name
```

Every field is pre-populated with its current value — press `Enter` to keep it unchanged.

**Connection fields** (URL, auth type, email, token):
- Any change triggers a live connection test with the same retry menu as `ticketlens init`
- Token shows `[keep existing]` — Enter preserves the stored credential

**Optional fields:**
- **Ticket prefixes** — new entries are **merged** into the existing list (not replaced). Enter keeps the current list.
- **Project paths** — new paths are validated; missing directories are offered for creation
- **Triage statuses** — **merge semantics**: new entries are *added*, existing ones are never removed. Partial matching: typing `QA` resolves to `QA Testing` if that's the status in your Jira.

---

### ticketlens TICKET-KEY — Fetch a ticket brief

Fetch a ticket's full context: description, comments, linked issues, attachments, and code references.

```bash
ticketlens PROJ-123                  # Fetch with defaults (depth 1, styled output)
ticketlens get PROJ-123              # Same — "get" is an explicit alias
ticketlens PROJ-123 --depth=0        # Target ticket only (fastest)
ticketlens PROJ-123 --depth=1        # + linked ticket descriptions and comments
ticketlens PROJ-123 --depth=2        # + linked-of-linked tickets (thorough)
ticketlens PROJ-123 --profile=acme   # Use a specific profile
ticketlens PROJ-123 --plain          # Plain markdown (no ANSI — pipe-safe, LLM-ready)
ticketlens PROJ-123 --styled         # Force ANSI color even when piping
ticketlens PROJ-123 --no-attachments # Skip attachment download
ticketlens PROJ-123 --no-cache       # Skip brief cache + force re-download attachments
```

**Depth levels:**

| `--depth` | What's included |
|-----------|-----------------|
| `0` | Target ticket: description, comments, attachments |
| `1` | + linked tickets: descriptions and comments _(default)_ |
| `2` | + linked-of-linked: key and summary only |

Max 15 tickets fetched at any depth. Circular references are handled automatically.

**Brief caching:** After the first fetch, ticket data is cached locally and reused on repeat fetches, skipping the Jira API entirely. A dim notice appears on stderr:

```
  ○ PROJ-123 · from cache (12m ago)  ·  --no-cache to refresh
```

The cache is depth-aware: a cached depth-2 response satisfies a depth-1 or depth-0 request. Pass `--no-cache` to bypass and re-fetch from Jira.

The default TTL is **4 hours**. Set `cacheTtl` in your profile to fit your workflow — ticket reviews that happen weeks or months later benefit from a longer window:

```
ticketlens config   # set "Brief cache TTL" in the Optional section
                    # examples: 4h · 1d · 7d · 30d · 0 (disable)
```

**Multi-profile disambiguation:** When two profiles share a ticket prefix (e.g. both have `PROJ`), an arrow-key selector appears asking which Jira instance to use. Selecting one re-runs with `--profile=NAME`. Once a profile is selected, it is correctly applied even through connection failures and retries.

**On connection failure**, an arrow-key menu offers:
- **Retry** — try again after connecting VPN, etc.
- **Switch profile** — pick a different Jira instance and re-run cleanly
- **Cancel**

**Attachments** are downloaded automatically to `~/.ticketlens/cache/TICKET-KEY/` unless `--no-attachments` is passed. Claude Code reads images (multimodal), PDFs, and text files as part of the brief.

---

### ticketlens triage — Ticket attention scanner

Scans your assigned tickets and surfaces what needs attention.

```bash
ticketlens triage                                       # Auto-detect profile from cwd
ticketlens triage --profile=acme                        # Explicit profile
ticketlens triage --stale=3                             # Aging threshold: 3 days (default: 5)
ticketlens triage --status="Code Review,QA Testing"     # Override statuses to scan
ticketlens triage --static                              # Static table (no interactive mode)
ticketlens triage --plain                               # Plain markdown (for piping / LLM)
```

**Categories:**

| Badge | Category | Condition |
|-------|----------|-----------|
| `●` red | **Needs response** | Someone else commented within the last N days |
| `●` yellow | **Aging** | Last comment (by anyone) or last update is N+ days old |

The `--stale=N` threshold controls **both** categories: a comment waiting for your reply is "needs response" only if it arrived within N days. Once it's older than N days, it automatically downgrades to "aging" — so your urgency list stays focused on genuinely recent requests.

**Interactive mode** (default on TTY):
- `↑/↓` navigate — `Enter` open in browser — `p` switch profile — `q/Esc` exit

**Status mismatch auto-fix:** If configured statuses don't match Jira's (e.g. `"In progress"` vs `"In Progress"`, `"QA"` vs `"QA Testing"`), triage shows a diff and offers to update your profile automatically:

```
  ~ In progress  →  In Progress
  ~ QA           →  QA Testing

  Update "myteam" with corrected statuses?  y/N
```

Confirming **merges** the corrections into your existing `triageStatuses` list (never replaces it) and reruns triage without the `--status` flag so the updated profile is used.

Bot comments (Jira Automation, Jenkins, GitHub Actions, etc.) are automatically ignored. VCS commit bots (SVN/Git) are recognized — a commit by your username counts as your own response.

---

### ticketlens cache — Cache manager

Inspect and clean up locally cached ticket data: attachment files and ticket briefs.

```bash
ticketlens cache                               # Overview + subcommand hints
ticketlens cache --help                        # Detailed help

# Inspect disk usage
ticketlens cache size                          # Disk usage by profile and ticket
ticketlens cache size --profile=acme           # Filter to one profile
ticketlens cache size --help                   # Options

# Clear cached files
ticketlens cache clear                         # Interactive picker — choose by profile (TTY)
ticketlens clear                               # Shorthand alias for cache clear
ticketlens cache clear PROJ-123                # Clear one ticket
ticketlens cache clear --older-than=7d         # Files older than 7 days
ticketlens cache clear --older-than=1m         # Files older than 1 month
ticketlens cache clear --older-than=1y         # Files older than 1 year
ticketlens cache clear --profile=acme          # Only this profile's files
ticketlens cache clear PROJ-123 --older-than=7d            # Ticket + age filter
ticketlens cache clear --profile=acme --older-than=30d     # Profile + age filter
ticketlens cache clear --older-than=30d --yes              # Skip confirmation
ticketlens cache clear --help                  # Full options
```

Age units: `d` = days · `m` = months (30d) · `y` = years (365d)

Before deleting, `cache clear` shows a summary of what will be removed (grouped by profile and ticket) and prompts for confirmation. Pass `--yes` / `-y` to skip in scripts.

**Cache locations:**
- Attachments: `~/.ticketlens/cache/TICKET-KEY/` (shared across profiles)
- Brief cache: `~/.ticketlens/cache/PROFILE/TICKET-KEY/brief.json` (profile-scoped, configurable TTL)

`cache size` shows both sections, including the configured TTL per profile. `cache clear` removes both attachment files and brief cache entries for the affected tickets. Empty ticket directories are removed automatically.

---

### ticketlens license — License status

```bash
ticketlens license                # Show license tier and status
ticketlens activate <LICENSE-KEY> # Activate a license key
```

Output shows one of three states:

| State | Indicator | Details |
|-------|-----------|---------|
| **Free** | `● dim` | Unlock Pro features with a license key |
| **Active** | `● green` | Tier (pro/team), email, last validated date |
| **Expired** | `● yellow` | Tier, email, renewal instructions |

---

### /jtb — Jira TicketBrief for Claude Code

`/jtb` is a **Claude Code slash command**. It fetches full ticket context and drops a structured implementation brief directly into your Claude session, then enters plan mode.

> `/jtb` requires [Claude Code](https://claude.ai/code). For standalone CLI use, the `ticketlens` commands above work independently.

#### Installing the skill

```bash
# Step 1 — install TicketLens
npm install -g ticketlens
ticketlens init

# Step 2 — copy the skill file to Claude Code's commands directory
SKILL=$(npm root -g)/ticketlens/skills/jtb/SKILL.md
cp "$SKILL" ~/.claude/commands/jtb.md

# Step 3 — restart Claude Code (or open a new session)
```

If you cloned the repo directly:

```bash
cp /path/to/ticket-lens/skills/jtb/SKILL.md ~/.claude/commands/jtb.md
```

#### Using /jtb in Claude Code

```
/jtb PROJ-123                    # Fetch ticket + linked issues → plan mode
/jtb PROJ-123 --depth=0          # Target ticket only (fast)
/jtb PROJ-123 --depth=2          # Deep: linked-of-linked
/jtb PROJ-123 --profile=acme     # Force a specific Jira profile
/jtb PROJ-123 --no-attachments   # Skip attachment download
/jtb PROJ-123 --no-cache         # Re-download all attachments
/jtb triage                      # Scan your assigned tickets
```

#### Attachments in Claude Code

Attachments are downloaded to `~/.ticketlens/cache/TICKET-KEY/` and listed in the brief:

```
## Attachments

- /Users/you/.ticketlens/cache/PROJ-123/design-mockup.png  (design-mockup.png, 312KB)
- /Users/you/.ticketlens/cache/PROJ-123/spec.pdf           (spec.pdf, 95KB)
- /Users/you/.ticketlens/cache/PROJ-123/server.log         (server.log, 4KB)
```

Claude Code reads each file as context before planning:
- **Images** (PNG, JPEG, GIF, WebP, SVG) — multimodal visual context
- **PDFs** — text extracted and read
- **Text files** (TXT, CSV, MD, LOG) — read as plain text
- **Other files** (ZIP, DOCX) — noted as available at the listed path

Files over 10 MB are skipped. Cached files are reused on repeat fetches (`--no-cache` forces a fresh download).

---

## All Examples

Complete reference of every command and flag combination:

```bash
# ── First-time setup ─────────────────────────────────────────────────────────
ticketlens init                               # Guided wizard (recommended)
ticketlens switch                             # Switch between configured profiles
ticketlens config                             # Edit the active profile
ticketlens config --profile=acme              # Edit a specific profile

# ── Fetch a ticket brief ──────────────────────────────────────────────────────
ticketlens PROJ-123                           # Fetch with defaults (depth 1, styled)
ticketlens get PROJ-123                       # Explicit alias (same result)
ticketlens PROJ-123 --depth=0                 # Target ticket only — no linked issues
ticketlens PROJ-123 --depth=1                 # + linked ticket descriptions and comments
ticketlens PROJ-123 --depth=2                 # + linked-of-linked (deep scan)
ticketlens PROJ-123 --profile=acme            # Force a specific Jira profile
ticketlens PROJ-123 --plain                   # Plain markdown — no color codes
ticketlens PROJ-123 --styled                  # Force ANSI color even when piping
ticketlens PROJ-123 --no-attachments          # Skip attachment download entirely
ticketlens PROJ-123 --no-cache                # Skip brief cache + force re-download attachments
ticketlens PROJ-123 --depth=2 --profile=acme --plain    # Combine flags freely

# Pipe plain output to clipboard, LLM, or file
ticketlens PROJ-123 --plain > brief.md
ticketlens PROJ-123 --plain | pbcopy
ticketlens PROJ-123 --plain | llm "Summarize this ticket in 3 bullets"

# ── Triage ────────────────────────────────────────────────────────────────────
ticketlens triage                              # Scan assigned tickets — interactive
ticketlens triage --profile=acme              # Explicit profile
ticketlens triage --stale=3                   # Needs-response window: 3 days (default: 5)
ticketlens triage --stale=10                  # More lenient — only flag very stale tickets
ticketlens triage --status="Code Review,QA Testing"   # Scan these statuses only
ticketlens triage --static                    # Static table output (no interactive mode)
ticketlens triage --plain                     # Plain markdown — pipe to LLM or file
ticketlens triage --profile=acme --stale=3 --static   # Combine flags

# Pipe triage output
ticketlens triage --plain > my-tickets.md
ticketlens triage --plain | llm "Which ticket is most urgent and why?"

# ── Cache management ──────────────────────────────────────────────────────────
ticketlens cache                              # Show overview + subcommand hints
ticketlens cache --help                       # Detailed help

ticketlens cache size                         # Disk usage by profile and ticket
ticketlens cache size --profile=acme          # Filter to one profile only
ticketlens cache size --help                  # Options

ticketlens cache clear                        # Interactive picker (TTY)
ticketlens clear                              # Shorthand alias for cache clear
ticketlens cache clear PROJ-123              # Clear one ticket's cache
ticketlens cache clear --older-than=7d        # Files older than 7 days
ticketlens cache clear --older-than=1m        # Files older than 1 month
ticketlens cache clear --older-than=1y        # Files older than 1 year
ticketlens cache clear --profile=acme         # Only one profile's files
ticketlens cache clear PROJ-123 --older-than=7d          # Ticket + age filter
ticketlens cache clear --profile=acme --older-than=30d   # Profile + age filter
ticketlens cache clear --older-than=30d --yes            # Skip confirmation (CI/scripts)
ticketlens cache clear --help                 # Full options

# ── License ────────────────────────────────────────────────────────────────────
ticketlens license                            # Show license tier and status
ticketlens activate <LICENSE-KEY>             # Activate a license key

# ── Help and version ──────────────────────────────────────────────────────────
ticketlens --help                             # Main help
ticketlens --version                          # Show installed version

ticketlens PROJ-123 --help                    # Fetch subcommand help
ticketlens triage --help                      # Triage subcommand help
ticketlens cache --help                       # Cache overview help
ticketlens cache size --help                  # Cache size help
ticketlens cache clear --help                 # Cache clear help
```

---

## Multi-Profile Setup

TicketLens supports multiple Jira instances simultaneously. Profiles are stored in `~/.ticketlens/profiles.json`:

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

Credentials live separately in `~/.ticketlens/credentials.json` (chmod 600):

```json
{
  "myteam": { "apiToken": "your-atlassian-api-token" },
  "client":  { "pat": "your-jira-server-pat" }
}
```

With this setup:
- `ticketlens PROJ-123` → uses **myteam** (prefix match)
- `ticketlens ACME-456` → uses **client** (prefix match)
- Running `ticketlens triage` inside `~/projects/myteam-app` → uses **myteam** (path match)

---

## Profile Resolution Order

| Priority | Method | Example |
|----------|--------|---------|
| 1 | `--profile=NAME` flag | `ticketlens PROJ-123 --profile=client` |
| 2 | Ticket prefix match | `ticketlens PROJ-123` → prefix `PROJ` maps to `myteam` |
| 3 | Project path match | `ticketlens triage` in `~/projects/myteam-app` → `myteam` |
| 4 | Default / first profile | First entry in `profiles.json` |
| 5 | Environment variables | `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` / `JIRA_PAT` |

---

## Architecture

- **Zero npm dependencies** — Node.js built-ins only (`node:fs`, `node:path`, `node:http`)
- **Jira Cloud** (Basic auth email + API token, `/rest/api/3` endpoints, ADF body conversion)
- **Jira Server/DC** (Bearer PAT or Basic user + password, `/rest/api/2` endpoints)
- **VCS-agnostic** — detects `.git`, `.svn`, `.hg`; SVN commit bot comments recognized
- **All modules tested** with `node:test` + `node:assert/strict` (365 tests)

---

## Running Tests

```bash
node --test 'skills/jtb/scripts/test/*.test.mjs'
```

Expected output: all tests pass, zero failures.

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full feature plan.

**Iteration 3 — Complete:**
- ✅ Jira Cloud v3 API migration (ADF → plain text conversion)
- ✅ npm package (`ticketlens`) with `npx` support
- ✅ Session banner with spinner, connection status dot, error classifier
- ✅ `ticketlens init` — guided wizard: URL suggestions, auth auto-detection, live connection test, retry menu, optional settings, HTTP/HTTPS auto-probe
- ✅ `ticketlens switch` — titled panel profile switcher with live connection test
- ✅ `ticketlens config` — full profile editor with connection retry, prefix/status merge semantics
- ✅ `ticketlens triage` — interactive navigator, `p` hotkey, status mismatch auto-fix (merge, not replace), `--stale` applies to both needs-response and aging categories
- ✅ Attachment download — all file types cached locally; Claude Code reads images, PDFs, text
- ✅ `ticketlens cache` — `size` with `--profile` filter, `clear` with ticket/age/profile filters
- ✅ `ticketlens license` / `ticketlens activate` — styled license status display
- ✅ `get` alias — `ticketlens get PROJ-123` as explicit fetch alias
- ✅ `clear` shorthand — `ticketlens clear` as alias for `ticketlens cache clear`
- ✅ Profile switch fixed — `--profile=` arg correctly replaced on every re-run (was causing infinite loop)
- ✅ `--stale` fixed — unanswered comments older than N days now downgrade to "aging"
- ✅ Contextual `--help` — each subcommand shows its own focused help (not the main help)

**Iteration 3.5 — Next:**
- README GIF demos (ticket fetch, triage scan)
- CI badge
- `--assignee` and `--sprint` filter flags
- Public launch: HN, Reddit, Dev.to

**Coming soon:**
- Compliance Check — compare ticket requirements against shipped code (Pro conversion lever)
- Multi-project triage, custom attention rules, scheduled triage (Pro tier)
- TicketLens Cloud — E2EE sync, web dashboard, Slack/Teams alerts (Phase C)
- GitHub Issues and Linear support (Phase D)

---

## Known Issues

None at this time. Previous issues resolved:

- ~~Jira Cloud v2 API deprecation (410 Gone)~~ — Fixed: Cloud profiles auto-select `/rest/api/3`.
- ~~Profile switch infinite loop~~ — Fixed: `--profile=` arg is now replaced (not appended) on every re-run.
- ~~Status auto-fix infinite loop~~ — Fixed: Re-run after correction strips `--status` flag; profile statuses are merged (not replaced).
- ~~Config prefix replacement~~ — Fixed: Editing ticket prefixes merges new entries with existing ones.
- ~~`--stale` had no effect when all tickets had unanswered comments~~ — Fixed: Unanswered comments older than N days now downgrade to "aging".
- ~~`cache --help` showed main help~~ — Fixed: Subcommand `--help` flags route to each subcommand's own help.
