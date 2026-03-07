# /jtb — Jira TicketBrief for Claude Code

Fetches a Jira ticket's full context and assembles a structured brief for implementation planning.

## Quick Start

```bash
# 1. Set environment variables (or use profiles — see below)
export JIRA_BASE_URL="https://yourteam.atlassian.net"
export JIRA_EMAIL="you@example.com"
export JIRA_API_TOKEN="your-api-token"

# 2. Use in Claude Code
/jtb CNV1-3
/jtb triage
```

## Setup

### Option A: Multi-Account Profiles (Recommended)

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
| `ticketPrefixes` | Yes | `/jtb` fetch | Array of Jira project keys this profile handles |
| `projectPaths` | No | `/jtb triage` | Array of local paths — triage auto-selects profile when your cwd is inside one of these |
| `triageStatuses` | No | `/jtb triage` | Array of Jira statuses to scan (default: `["In Progress", "Code Review", "QA"]`) |

#### Credentials Fields

| Field | When to use | Description |
|-------|-------------|-------------|
| `apiToken` | Jira Cloud | API token from https://id.atlassian.com/manage-profile/security/api-tokens |
| `pat` | Jira Server/DC 8.14+ | Personal Access Token from Jira profile settings |

For Jira Server older than 8.14 (no PAT support), use `apiToken` with the user's password and set `auth: "basic"` in the profile.

### Option B: Environment Variables

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

Bot comments (Jira Automation, Jenkins, etc.) are automatically skipped. SVN/Git commit bots are recognized — if the commit author matches your username, it counts as your response.

If the configured statuses don't exist in your Jira instance, triage will fetch available statuses and suggest dev-relevant ones to add to your profile config.

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
