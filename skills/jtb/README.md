# /jtb — Jira TicketBrief for Claude Code

Fetches a Jira ticket's full context and assembles a structured brief for implementation planning.

## Quick Start

```bash
ticketlens init    # Guided setup — configure your Jira connection
ticketlens PROJ-123
ticketlens triage
```

## Setup

### Option A: Guided wizard (Recommended)

Run the interactive setup wizard:

```bash
ticketlens init
```

The wizard walks you through each step:

1. **Profile name** — a short identifier, e.g. `work`, `acme`, `client`
2. **Jira URL** — suggestions are offered based on your profile name:
   - `https://acme.atlassian.net` (Cloud)
   - `https://jira.acme.com` (Server/DC)
   - Or type a different URL — bare hostnames (`jira.company.com`) are accepted and auto-probed (`https://` first, then `http://`)
3. **Auth type** — auto-detected from the URL you chose:
   - `*.atlassian.net` → Jira Cloud detected, uses email + API token (no manual selection needed)
   - Any other URL → choose between PAT (Server/DC 8.14+) or Basic auth (username + password)
4. **Credentials** — email/username and token/password (masked input). Pre-populated on retry so you only change what's wrong.
5. **Connection test** — live spinner; shows `● Connected` on success or a classified error with actionable hints on failure. On failure, an arrow-key menu offers four options:

   | Option | Use when |
   |--------|----------|
   | **Retry** | VPN just connected, network hiccup |
   | **Edit credentials** | Token or email typo — fields pre-populated |
   | **Edit from URL** | Wrong URL or auth type — re-prompts from URL step |
   | **Skip** | Give up on this profile |
6. **Optional settings** — all skippable with Enter:
   - **Ticket prefixes** (e.g. `PROJ,OPS`) — enables auto-routing: `PROJ-123` resolves to this profile
   - **Project paths** (e.g. `~/projects/myapp`) — enables cwd-based auto-detection. If a path doesn't exist, you're offered to create it.
   - **Triage statuses** (default: `In Progress, Code Review, QA`) — validated live against your Jira instance. Case mismatches are auto-corrected (e.g. `"In progress"` → `"In Progress"`).
7. **Add another?** — repeat the full flow for each Jira instance
8. **Select active profile** — arrow-key panel if you configured multiple profiles
9. **Quick start panel** — command reference on completion

On success, config is written to:
- `~/.ticketlens/profiles.json`
- `~/.ticketlens/credentials.json` (chmod 600)

Profiles are only written on a **successful connection test** — a failed or cancelled test leaves your config untouched.

#### Cancelling `ticketlens init`

| Step | Key | Result |
|------|-----|--------|
| Any text prompt (name, URL, email) | `Ctrl+C` | Exits cleanly, cursor restored |
| URL / auth type selector | `Esc` or `q` | Shows "Cancelled.", exits gracefully |
| Token / password prompt | `Ctrl+C` | Exits cleanly, cursor restored |
| Connection test (spinner) | `Ctrl+C` | Spinner stopped, cursor restored, exits cleanly |
| "Configure another connection?" | `Ctrl+C` | Exits cleanly |
| Final profile selector | `Esc` or `q` | Skips setting a default, wizard completes |

### Option B: Manual profiles

Create `~/.ticketlens/profiles.json`:

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

Create `~/.ticketlens/credentials.json` (chmod 600):

```json
{
  "myteam": { "apiToken": "your-cloud-api-token" },
  "client": { "pat": "your-server-pat" }
}
```

Tickets are auto-routed by prefix: `PROJ-42` uses "myteam", `CLI-10` uses "client".

#### Profile Fields

| Field | Required | Used By | Description |
|-------|----------|---------|-------------|
| `baseUrl` | Yes | both | Jira instance URL |
| `auth` | Yes | both | `"cloud"` (Basic email+token) or `"server"` (Bearer PAT) or `"basic"` (Basic user+password for pre-8.14 Server) |
| `email` | Yes | both | Atlassian email (Cloud) or username (Server) |
| `ticketPrefixes` | No | `/jtb` fetch | Array of Jira project keys; enables auto-routing `PROJ-123` to this profile |
| `projectPaths` | No | `/jtb triage` | Array of local paths — triage auto-selects profile when your cwd is inside one of these |
| `triageStatuses` | No | `/jtb triage` | Array of Jira statuses to scan (default: `["In Progress", "Code Review", "QA"]`) |

#### Credentials Fields

| Field | When to use | Description |
|-------|-------------|-------------|
| `apiToken` | Jira Cloud | API token from https://id.atlassian.com/manage-profile/security/api-tokens |
| `pat` | Jira Server/DC 8.14+ | Personal Access Token from Jira profile settings |

For Jira Server older than 8.14 (no PAT support), use `apiToken` with the user's password and set `auth: "basic"` in the profile.

### Option C: Environment Variables

For single-account setups, env vars still work:

```bash
# Jira Cloud
export JIRA_BASE_URL="https://yourteam.atlassian.net"
export JIRA_EMAIL="you@example.com"
export JIRA_API_TOKEN="your-token"

# Jira Server / Data Center
export JIRA_BASE_URL="https://jira.yourcompany.com"
export JIRA_PAT="your-personal-access-token"
```

## Usage

### Fetch a ticket brief

```bash
/jtb TICKET-KEY              # Fetch ticket + linked tickets (depth 1)
/jtb TICKET-KEY --depth=0    # Target ticket only (fast)
/jtb TICKET-KEY --depth=2    # Include linked-of-linked tickets
/jtb TICKET-KEY --profile=client  # Force a specific profile
```

### Triage — scan tickets needing attention

```bash
/jtb triage                          # Auto-detect profile from cwd
/jtb triage --profile=acme         # Explicit profile
/jtb triage --stale=3                # Flag tickets with no activity for 3+ days (default: 5)
/jtb triage --status=CR,QA           # Override statuses to scan
```

Triage scans your assigned tickets and categorizes them:

- **Needs Response** — someone commented after you (reviewer, QA, PM waiting for your reply)
- **Aging** — no activity for N+ days (stalling)

**Interactive mode keys:** `↑/↓` navigate · `Enter` open in browser · `p` switch profile · `q/Esc` exit

Bot comments (Jira Automation, Jenkins, etc.) are automatically skipped. SVN/Git commit bots are recognized — if the commit author matches your username, it counts as your response.

**Status mismatch auto-fix:** If configured statuses don't exactly match your Jira instance (e.g. `"In progress"` vs `"In Progress"`, or `"QA"` vs `"QA Testing"`), triage shows a diff and offers to update your profile automatically:

```
  ~ In progress  →  In Progress
  ~ QA           →  QA Testing

  Update "myprofile" with corrected statuses?  y/N
```

Confirming rewrites `triageStatuses` in your profile and reruns triage immediately. Statuses are also validated at the end of `ticketlens init` before saving.

### Switch active profile

```bash
ticketlens switch
```

Opens a titled panel listing all configured profiles. The currently active profile is marked with a green `● active` badge. Use arrow keys to navigate, `Enter` to switch, `Esc` to cancel.

On switch: tests the connection live, then updates the active profile in `profiles.json`. Selecting the already-active profile is a no-op (instant dismiss, no reconnection).

### Edit profile settings

```bash
ticketlens config                    # Edit the default profile
ticketlens config --profile=acme     # Edit a named profile
```

Edits any setting on an existing profile. Every field is pre-populated with its current value — press `Enter` to keep it.

**Connection section:**

| Field | Behaviour |
|-------|-----------|
| Jira URL | Accepts bare hostnames; `https://` auto-prefixed |
| Auth type | Selector pre-positioned on current value |
| Email / Username | Pre-populated; Enter keeps it |
| Token / PAT / Password | Shows `[keep existing]`; Enter keeps stored credential |

If any connection field changes, a live connection test runs with the same retry menu as `ticketlens init`.

**Optional section:**

| Field | Behaviour |
|-------|-----------|
| Ticket prefixes | Full replacement; Enter keeps current |
| Project paths | Full replacement; new paths validated; missing dirs offered for creation |
| Triage statuses | **Merge** — new entries are *added* to the current list, never replacing it. Partial matching applies: `QA` → `QA Testing`. Invalid statuses with no match are skipped and reported. |

**Triage status merge example:**

```
  Add triage statuses  [current: In Progress, Code Review — Enter to keep]:  QA
    ~ QA  →  QA Testing
    Updated list: In Progress, Code Review, QA Testing
```

### Profile Resolution Order

| Priority | Method | Used when |
|----------|--------|-----------|
| 1 | `--profile=NAME` flag | Explicit override |
| 2 | Ticket prefix match | `/jtb PROJ-42` — prefix `PROJ` maps to a profile |
| 3 | Project path match | `/jtb triage` — cwd matches a profile's `projectPaths` |
| 4 | Default profile | `"default"` key in profiles.json |
| 5 | Environment variables | No config files, just env vars |

### What fetch does

1. Fetches the ticket from Jira (description, comments, attachments, links)
2. Fetches linked tickets with their comments (at depth 1)
3. Extracts code references (file paths, class names, methods, SHAs, branches)
4. Detects your VCS (Git/SVN/Hg) and finds related commits/branches
5. Resolves referenced files in your local repo
6. Enters plan mode with full context

### Depth levels

| Depth | What's fetched |
|-------|---------------|
| 0 | Target ticket only (description, comments, attachments) |
| 1 | Target + linked tickets with descriptions and comments |
| 2 | Target + linked + linked-of-linked (key + summary only) |

Max 15 tickets total regardless of depth. Circular references are handled automatically.

## CLI Usage (without Claude Code)

```bash
# Fetch a ticket
node ~/.agents/skills/jtb/scripts/fetch-ticket.mjs TICKET-KEY [--depth=N] [--profile=NAME]

# Triage
node ~/.agents/skills/jtb/scripts/fetch-my-tickets.mjs [--stale=N] [--status=X,Y] [--profile=NAME]
```

## Known Issues

None at this time. Previous issues resolved:
- ~~Jira Cloud v2 API deprecation (410 Gone)~~ — Fixed. Cloud profiles auto-select v3 API endpoints.

## Full Documentation

See [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for architecture, output format, troubleshooting, and contributing guide.
