# TicketLens

Developer toolkit that minimizes research time before implementation. Fetches Jira ticket context, linked issues, comments, and code references — then maps them to your local codebase.

## Contents

- [Quick Start](#quick-start)
- [Commands](#commands)
  - [ticketlens init — Setup wizard](#ticketlens-init--setup-wizard)
  - [ticketlens switch — Switch active profile](#ticketlens-switch--switch-active-profile)
  - [ticketlens config — Edit profile settings](#ticketlens-config--edit-profile-settings)
  - [ticketlens triage — Ticket attention scanner](#ticketlens-triage--ticket-attention-scanner)
  - [ticketlens cache — Attachment cache manager](#ticketlens-cache--attachment-cache-manager)
  - [/jtb — Jira TicketBrief for Claude Code](#jtb--jira-ticketbrief-for-claude-code)
- [Architecture](#architecture)
- [Running Tests](#running-tests)
- [Roadmap](#roadmap)
- [Known Issues](#known-issues)

---

## Quick Start

```bash
npm install -g ticketlens
ticketlens init          # Configure your Jira connection (guided wizard)
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

The wizard walks you through each step:

1. **Profile name** — short identifier: `work`, `acme`, `client`
2. **Jira URL** — suggestions based on your profile name are offered (e.g. `https://acme.atlassian.net` or `https://jira.acme.com`). Pick one or type your own. Bare hostnames (`jira.company.com`) are accepted — `https://` is probed first, then `http://`.
3. **Auth type** — auto-detected from your URL:
   - `*.atlassian.net` → Jira Cloud (email + API token, no prompt needed)
   - Any other URL → choose between PAT (Server/DC 8.14+) or Basic (username + password)
4. **Credentials** — email/username and token/password (masked input). Pre-populated on retry so you only fix what's wrong.
5. **Connection test** — live test with spinner; shows `● Connected` on success or a classified error with hints on failure. On failure, an arrow-key menu offers: **Retry** (VPN just connected), **Edit credentials** (token typo), **Edit from URL** (wrong URL), **Skip**.
6. **Optional settings** — skip any with Enter:
   - **Ticket prefixes** — e.g. `PROJ,OPS` — auto-routes `PROJ-123` to this profile
   - **Project paths** — e.g. `~/projects/myapp` — auto-activates this profile when working in that directory. Missing directories are offered for creation.
   - **Triage statuses** — Jira statuses to scan (default: `In Progress, Code Review, QA`). Validated live against your Jira instance — case mismatches are auto-corrected.
7. **Add another?** — repeat for each Jira instance
8. **Select active profile** — arrow-key panel if you configured more than one
9. **Quick start panel** — command reference shown on completion

Config is written to `~/.ticketlens/profiles.json` and `credentials.json` (chmod 600). Profiles are only saved on a successful connection test.

---

### ticketlens switch — Switch active profile

Switch between configured Jira connections without re-running init.

```bash
ticketlens switch
```

---

### ticketlens config — Edit profile settings

Edit any setting on an existing profile — connection details or optional fields — without re-running the full wizard.

```bash
ticketlens config                    # Edit the default profile
ticketlens config --profile=acme     # Edit a named profile
```

Every field is pre-populated with its current value. Press `Enter` to keep it unchanged.

**Connection section** (URL, auth type, email, token):
- URL accepts bare hostnames — `jira.company.com` is auto-prefixed with `https://`
- Auth type shows a selector pre-positioned on the current value
- Token shows `[keep existing]` — Enter keeps the stored credential
- Any change triggers a live connection test with the same retry options as `ticketlens init` (Retry / Edit credentials / Edit from URL / Skip)

**Optional section** (ticket prefixes, project paths, triage statuses):
- Triage statuses use **merge semantics** — typing new statuses *adds* them to the current list rather than replacing it. Partial matching applies: `QA` → `QA Testing`. Existing valid statuses are never removed by this prompt.

---

### ticketlens triage — Ticket attention scanner

Scans your assigned tickets and surfaces what needs attention.

```bash
ticketlens triage                        # Auto-detect profile from project path
ticketlens triage --stale=3              # Custom aging threshold (days, default: 5)
ticketlens triage --status=CR,QA         # Only check specific statuses
ticketlens triage --profile=acme         # Explicit profile override
```

Categorizes tickets as:
- **Needs response** — someone commented after you (reviewer, QA, PM waiting for reply)
- **Aging** — no activity for N+ days

In interactive mode (default on TTY):
- `↑/↓` navigate · `Enter` open in browser · `p` switch profile · `q/Esc` exit

**Status mismatch auto-fix:** If your configured statuses don't match Jira's (e.g. case difference: `"In progress"` vs `"In Progress"`), triage shows the diff and offers to update your profile automatically:

```
  ~ In progress  →  In Progress
  ~ QA           →  QA Testing

  Update "myprofile" with corrected statuses?  y/N
```

Confirming rewrites `triageStatuses` in your profile and reruns triage immediately.

---

### ticketlens cache — Attachment cache manager

Inspect and clean up locally cached Jira attachments downloaded by `/jtb`.

```bash
ticketlens cache size                          # Show total disk usage by ticket
ticketlens cache clear                         # Clear all cached attachments
ticketlens cache clear PROJ-123                # Clear one ticket's cache
ticketlens cache clear --older-than=7d         # Clear files older than 7 days
ticketlens cache clear --older-than=1m         # Clear files older than 1 month
ticketlens cache clear --older-than=1y         # Clear files older than 1 year
ticketlens cache clear PROJ-123 --older-than=7d  # Combine ticket + age filter
ticketlens cache clear --older-than=30d --yes  # Skip confirmation prompt
```

Age units: `d` = days, `m` = months (30d), `y` = years (365d).

Before deleting, `cache clear` always shows a summary of what will be removed — grouped by ticket key with file name, size, and download date — then prompts for confirmation. Pass `--yes` / `-y` to skip the prompt in scripts.

Files are cached at `~/.ticketlens/cache/TICKET-KEY/`. Empty ticket directories are automatically removed after their last file is deleted.

---

### /jtb — Jira TicketBrief for Claude Code

`/jtb` is a **Claude Code slash command**. It fetches a Jira ticket's full context — description, comments, linked issues, and code references — and drops a structured implementation brief directly into your Claude session.

> **Note:** `/jtb` requires [Claude Code](https://claude.ai/code). For standalone CLI usage without Claude Code, use `ticketlens` commands above.

#### Installing the Claude Code skill

**Step 1 — Install TicketLens** (if not already):

```bash
npm install -g ticketlens
ticketlens init   # configure your Jira connection
```

**Step 2 — Copy the skill file** to your Claude Code commands directory:

```bash
# Find where the package installed the skill file
SKILL=$(npm root -g)/ticketlens/skills/jtb/SKILL.md

# Install it as a Claude Code slash command
cp "$SKILL" ~/.claude/commands/jtb.md
```

Or if you cloned the repo directly:

```bash
cp /path/to/ticket-lens/skills/jtb/SKILL.md ~/.claude/commands/jtb.md
```

**Step 3 — Restart Claude Code** (or open a new session). The `/jtb` command is now available in any project.

#### Usage in Claude Code

```
/jtb PROJ-123                    # Fetch ticket + linked issues → enters plan mode
/jtb PROJ-123 --depth=0          # Target ticket only (fast)
/jtb PROJ-123 --depth=2          # Include linked-of-linked tickets
/jtb PROJ-123 --profile=acme     # Force a specific Jira profile
/jtb PROJ-123 --no-attachments   # Skip downloading attachments
/jtb PROJ-123 --no-cache         # Re-download attachments even if cached
/jtb triage                      # Scan your assigned tickets
```

#### Attachments

When you run `/jtb`, TicketLens automatically downloads all files attached to the ticket — screenshots, mockups, PDFs, logs, CSVs — and caches them locally at `~/.ticketlens/cache/TICKET-KEY/`.

The brief includes an `## Attachments` section listing each file's local path:

```
## Attachments

- `/Users/you/.ticketlens/cache/PROJ-123/error-screenshot.png` _(error-screenshot.png, 239KB)_
- `/Users/you/.ticketlens/cache/PROJ-123/spec.pdf` _(spec.pdf, 82KB)_
- `/Users/you/.ticketlens/cache/PROJ-123/server-log.txt` _(server-log.txt, 1KB)_
```

Claude Code reads each file as part of the ticket brief workflow (Step 2b):
- **Images** (PNG, JPEG, GIF, WebP, SVG) — loaded as multimodal visual context
- **PDFs** — text extracted and read
- **Text files** (TXT, CSV, MD, LOG) — read as plain text
- **Other files** (ZIP, DOCX, etc.) — noted as available at the listed path

Files over 10 MB are skipped with a note. Already-cached files are reused on repeat fetches. Use `--no-cache` to force a fresh download.

See [skills/jtb/README.md](skills/jtb/README.md) for full setup and usage docs.

---

## Architecture

- Zero npm dependencies — Node.js built-ins only
- Supports Jira Cloud and Jira Server/Data Center
- VCS-agnostic: Git, SVN, Mercurial
- All modules TDD with `node:test` + `node:assert`

## Running Tests

```bash
node --test skills/jtb/scripts/test/*.test.mjs
```

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full iteration plan.

**Iteration 3 — Complete:**
- ✅ Jira Cloud v3 API migration
- ✅ npm package (`ticketlens`)
- ✅ CLI UX polish — session banner, spinner, error classifier, interactive triage navigator, profile picker
- ✅ `ticketlens init` — guided setup wizard with URL suggestions, auth auto-detection, optional fields, live status validation, connection retry menu (Retry / Edit credentials / Edit from URL / Skip), pre-populated fields on retry
- ✅ Auto HTTP/HTTPS detection — bare hostnames auto-probed (`https://` first, then `http://`)
- ✅ `ticketlens switch` — titled panel profile switcher
- ✅ Triage status mismatch auto-fix — case-insensitive + partial matching + interactive profile update
- ✅ `p` hotkey during triage to switch profiles mid-session
- ✅ `ticketlens config` — full profile editor: URL, auth type, email, token (with connection test + retry), ticket prefixes, project paths, triage statuses (merge semantics + partial matching)
- ✅ Attachment download — images, PDFs, and all file types cached locally at `~/.ticketlens/cache/`; Claude Code reads them as visual/text context; `--no-attachments` / `--no-cache` flags
- ✅ `ticketlens cache` — inspect disk usage (`cache size`) and selectively clear cached attachments by ticket key and/or age (`--older-than=Nd/Nm/Ny`)

**Iteration 3.5 — Next:**
- README GIF demos (ticket fetch, triage scan)
- CI badge
- `--assignee` and `--sprint` flags (Team tier preview)
- Public launch: HN, Reddit, Dev.to

**Coming soon:**
- Compliance Check — compare ticket requirements against shipped code (primary Pro conversion lever)
- Multi-project triage, custom attention rules, scheduled triage (Pro tier)
- TicketLens Cloud — E2EE sync, web dashboard, Slack/Teams alerts (Phase C)
- GitHub Issues and Linear as ticket sources (Phase D)

## Known Issues

None at this time. Previous issues resolved:
- ~~Jira Cloud v2 API deprecation (410 Gone)~~ — Fixed in v3 API migration. Cloud profiles now auto-select `/rest/api/3/search/jql`.
