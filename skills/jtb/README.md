# /jtb — Jira TicketBrief for Claude Code

Fetches a Jira ticket's full context and assembles a structured brief for implementation planning — directly inside your Claude Code session.

## Quick Start

```bash
npm install -g ticketlens
ticketlens init          # Configure your Jira connection
```

In Claude Code:

```
/jtb PROJ-123            # Fetch ticket brief → plan mode
/jtb triage              # Scan your assigned tickets
```

---

## Setup

### Option A — Guided wizard (Recommended)

```bash
ticketlens init
```

The wizard collects:

1. **Profile name** — short identifier: `work`, `acme`, `myteam`
2. **Jira URL** — suggestions offered based on your profile name (e.g. `https://acme.atlassian.net`, `https://jira.acme.com`). Bare hostnames like `jira.acme.com` are accepted — `https://` is probed first, then `http://`.
3. **Auth type** — auto-detected from your URL:
   - `*.atlassian.net` → Jira Cloud (email + API token)
   - Any other hostname → PAT (Server/DC 8.14+) or Basic auth (username + password)
4. **Credentials** — masked input; pre-populated on retry so you only fix what's wrong
5. **Live connection test** — shows `● Connected` or a classified error. On failure, a menu offers:

   | Option | When to use |
   |--------|-------------|
   | **Retry** | VPN just connected, network hiccup |
   | **Edit credentials** | Token or email typo — fields pre-populated |
   | **Edit from URL** | Wrong URL or auth type — re-prompts from URL step |
   | **Skip** | Abandon this profile |

6. **Optional settings** — all skippable with Enter:
   - **Ticket prefixes** — e.g. `PROJ,OPS` — auto-routes `PROJ-123` to this profile without `--profile`
   - **Project paths** — e.g. `~/projects/myapp` — auto-selects profile when your cwd is inside this directory
   - **Triage statuses** — Jira statuses to scan (default: `In Progress, Code Review, QA`). Validated live; case mismatches auto-corrected.
7. **Add another?** — repeat for each Jira instance
8. **Select active profile** — arrow-key panel (if more than one configured)
9. **Quick start panel** — command reference shown on completion

Config is written to:
- `~/.ticketlens/profiles.json`
- `~/.ticketlens/credentials.json` (chmod 600)

Profiles are only written on a **successful connection test**.

#### Cancelling `ticketlens init`

| Step | Key | Result |
|------|-----|--------|
| Any text prompt (name, URL, email) | `Ctrl+C` | Exits cleanly, cursor restored |
| URL / auth type selector | `Esc` or `q` | Shows "Cancelled.", exits |
| Token / password prompt | `Ctrl+C` | Exits cleanly |
| Connection test (spinner) | `Ctrl+C` | Spinner stopped, cursor restored, exits |
| "Configure another?" | `Ctrl+C` | Exits cleanly |
| Final profile selector | `Esc` or `q` | Skips default selection, wizard completes |

---

### Option B — Manual profiles

Create `~/.ticketlens/profiles.json`:

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

Create `~/.ticketlens/credentials.json` (chmod 600):

```json
{
  "myteam": { "apiToken": "your-atlassian-api-token" },
  "client":  { "pat": "your-jira-server-pat" }
}
```

With this setup:
- `ticketlens PROJ-123` → **myteam** (prefix `PROJ`)
- `ticketlens ACME-456` → **client** (prefix `ACME`)
- `ticketlens triage` inside `~/projects/myteam-app` → **myteam** (path match)

#### Profile fields

| Field | Required | Description |
|-------|----------|-------------|
| `baseUrl` | Yes | Jira instance URL |
| `auth` | Yes | `"cloud"` (email + API token) · `"server"` (Bearer PAT) · `"basic"` (username + password for pre-8.14 Server) |
| `email` | Yes | Atlassian email (Cloud) or username (Server) |
| `ticketPrefixes` | No | Array of project keys; enables auto-routing `PROJ-123` to this profile |
| `projectPaths` | No | Array of local paths; profile auto-selected when cwd is inside one of these |
| `triageStatuses` | No | Jira statuses to scan (default: `["In Progress", "Code Review", "QA"]`) |
| `cacheTtl` | No | How long fetched ticket briefs are cached locally (default: `"4h"`). Accepts: `4h`, `1d`, `7d`, `2w`, `30d`, `1y`, `0` (disable). Set via `ticketlens config`. |

#### Credentials fields

| Field | When to use | Description |
|-------|-------------|-------------|
| `apiToken` | Jira Cloud | API token from `https://id.atlassian.com/manage-profile/security/api-tokens` |
| `pat` | Jira Server/DC 8.14+ | Personal Access Token from Jira → Profile → Personal Access Tokens |

For Jira Server older than 8.14 (no PAT support), use `apiToken` with your password and set `auth: "basic"`.

---

### Option C — Environment variables

For single-account setups or CI:

```bash
# Jira Cloud
export JIRA_BASE_URL="https://yourteam.atlassian.net"
export JIRA_EMAIL="you@example.com"
export JIRA_API_TOKEN="your-api-token"

# Jira Server / Data Center
export JIRA_BASE_URL="https://jira.yourcompany.com"
export JIRA_PAT="your-personal-access-token"
```

Env vars are checked last — profiles.json takes priority when present.

---

## Usage

### Fetch a ticket brief

```bash
# Via Claude Code slash command
/jtb PROJ-123                       # Fetch + plan mode (depth 1 default)
/jtb PROJ-123 --depth=0             # Target ticket only (fastest)
/jtb PROJ-123 --depth=2             # Deep: linked-of-linked
/jtb PROJ-123 --profile=client      # Force a specific profile
/jtb PROJ-123 --no-attachments      # Skip attachment download
/jtb PROJ-123 --no-cache            # Skip brief cache + force re-download attachments

# Via CLI directly
ticketlens PROJ-123
ticketlens get PROJ-123             # Explicit alias
ticketlens PROJ-123 --plain         # Plain markdown (pipe-safe, LLM-ready)
ticketlens PROJ-123 --plain > brief.md
```

The brief includes ticket metadata (type, status, priority, assignee, reporter, created date, updated date), description, comments, linked tickets, code references, and attachments.

### Depth levels

| `--depth` | What's fetched |
|-----------|----------------|
| `0` | Target ticket — description, comments, attachments |
| `1` | + linked tickets — descriptions and comments _(default)_ |
| `2` | + linked-of-linked — key and summary only |

Max 15 tickets regardless of depth. Circular references handled automatically.

### Triage — scan tickets needing attention

```bash
# Via Claude Code
/jtb triage
/jtb triage --profile=acme
/jtb triage --stale=3

# Via CLI
ticketlens triage
ticketlens triage --profile=acme
ticketlens triage --stale=3                             # Response window: 3 days
ticketlens triage --status="Code Review,QA Testing"     # Statuses to scan
ticketlens triage --static                              # No interactive mode
ticketlens triage --plain                               # Plain markdown output
```

**Categories:**

| Badge | Category | Condition |
|-------|----------|-----------|
| `●` red | **Needs response** | Someone else commented within the last N days |
| `●` yellow | **Aging** | Last activity or comment is N+ days old |

`--stale=N` controls **both** categories. A comment waiting for your reply is "needs response" only while it's within N days old. Once it ages past N days, the ticket automatically downgrades to "aging" — so your red list stays focused on genuinely recent requests.

**Interactive mode keys:** `↑/↓` navigate · `Enter` open in browser · `p` switch profile · `q/Esc` exit

Bot comments (Jira Automation, Jenkins, GitHub Actions, Bamboo, etc.) are automatically skipped. VCS commit bots (SVN/Git) are recognized — a commit by your username counts as your own response.

**Status mismatch auto-fix:**

```
  ~ In progress  →  In Progress
  ~ QA           →  QA Testing

  Update "myteam" with corrected statuses?  y/N
```

Confirming **merges** corrections into your profile's `triageStatuses` list (never replaces it) and reruns immediately.

---

### Edit profile settings

```bash
ticketlens config                    # Edit the active profile
ticketlens config --profile=acme     # Edit a specific profile
```

All fields pre-populated. Press `Enter` to keep any value unchanged.

**Optional fields behaviour:**

| Field | Behaviour |
|-------|-----------|
| Ticket prefixes | **Merge** — new entries are added to the existing list; Enter keeps current |
| Project paths | New paths validated; missing dirs offered for creation |
| Triage statuses | **Merge** — new entries added, existing ones never removed; partial matching (`QA` → `QA Testing`) |

---

### Profile resolution order

| Priority | Method | Example |
|----------|--------|---------|
| 1 | `--profile=NAME` flag | `ticketlens PROJ-123 --profile=client` |
| 2 | Ticket prefix match | `PROJ-123` → prefix `PROJ` → `myteam` |
| 3 | Project path match | cwd in `~/projects/client-app` → `client` |
| 4 | Default / first profile | First entry in `profiles.json` |
| 5 | Environment variables | `JIRA_BASE_URL`, `JIRA_EMAIL`, etc. |

**Multi-profile disambiguation:** If two profiles share a prefix, an arrow-key selector appears. The selected profile is correctly applied through any subsequent retries or switches — selecting a different profile always replaces the previous `--profile=` arg cleanly.

---

## Attachments

TicketLens downloads all files attached to the ticket to `~/.ticketlens/cache/TICKET-KEY/`:

```
## Attachments

- /Users/you/.ticketlens/cache/PROJ-123/design-mockup.png  (design-mockup.png, 312KB)
- /Users/you/.ticketlens/cache/PROJ-123/requirements.pdf   (requirements.pdf, 95KB)
- /Users/you/.ticketlens/cache/PROJ-123/error.log          (error.log, 4KB)
```

Claude Code reads each file as context before entering plan mode:

| File type | How Claude Code reads it |
|-----------|--------------------------|
| PNG, JPEG, GIF, WebP, SVG | Multimodal visual context |
| PDF | Text extracted and read |
| TXT, CSV, MD, LOG, JSON | Read as plain text |
| ZIP, DOCX, XLSX, etc. | Path noted — not read directly |

Files over **10 MB** are skipped with a note. Cached files are reused on repeat fetches.

```bash
ticketlens PROJ-123 --no-attachments   # Skip download entirely
ticketlens PROJ-123 --no-cache         # Skip brief cache + force re-download attachments
```

---

## Brief caching

After the first fetch, ticket data is saved locally and reused on repeat fetches, skipping the Jira API entirely:

```
  ○ PROJ-123 · from cache (12m ago)  ·  --no-cache to refresh
```

The cache is depth-aware: a cached depth-2 response satisfies a depth-1 or depth-0 request. Pass `--no-cache` to bypass and re-fetch from Jira.

**TTL is configurable per profile** — the default is 4 hours. When an expired file is read, it is **deleted automatically** (lazy eviction), so stale files never accumulate on disk. Set a longer window if you revisit tickets weeks or months later:

```bash
ticketlens config   # set "Brief cache TTL" in the Optional section
                    # accepted formats: 4h · 1d · 7d · 2w · 30d · 0 (disable)
```

`cache size` shows the TTL configured for each profile. `--no-cache` always bypasses regardless of TTL.

**Cache locations:**
- Attachments: `~/.ticketlens/cache/TICKET-KEY/`
- Brief cache: `~/.ticketlens/cache/PROFILE/TICKET-KEY/brief.json` (profile-scoped, configurable TTL)

---

## Cache management

```bash
ticketlens cache size                        # Disk usage — shows both attachment + brief cache
ticketlens cache size --profile=acme         # Filter to one profile
ticketlens cache clear                       # Interactive picker (removes both)
ticketlens clear                             # Shorthand alias
ticketlens cache clear PROJ-123             # Clear one ticket (attachments + brief)
ticketlens cache clear --older-than=7d       # Files older than 7 days
ticketlens cache clear --profile=acme        # Clear one profile's files
ticketlens cache clear --older-than=30d --yes   # No confirmation (scripts)
```

---

## CLI quick reference

```bash
ticketlens --help                    # Main help
ticketlens --version                 # Version
ticketlens PROJ-123 --help           # Fetch help
ticketlens triage --help             # Triage help
ticketlens cache --help              # Cache help
ticketlens cache size --help         # Cache size help
ticketlens cache clear --help        # Cache clear help
```

---

## Known Issues

None at this time. Previous issues resolved:
- ~~Jira Cloud v2 API deprecation (410 Gone)~~ — Fixed: Cloud profiles auto-select v3 endpoints.
- ~~Profile switch infinite loop~~ — Fixed: `--profile=` arg is replaced (not appended) on every re-run.
- ~~Status auto-fix replacing all statuses~~ — Fixed: Corrections are merged into the existing list.
- ~~`--stale` flag had no visible effect~~ — Fixed: Affects both "needs response" and "aging" categories.

## Full Documentation

See [README.md](../../README.md) in the repo root for the complete command reference, all examples, architecture details, and roadmap.
