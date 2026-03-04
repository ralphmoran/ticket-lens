# /jtb — Jira TicketBrief for Claude Code

Fetches a Jira ticket's full context and assembles a structured brief for implementation planning.

## Quick Start

```bash
# 1. Set environment variables
export JIRA_BASE_URL="https://yourteam.atlassian.net"
export JIRA_EMAIL="you@example.com"
export JIRA_API_TOKEN="your-api-token"

# 2. Use in Claude Code
/jtb CNV1-3
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

Create `~/.ticketlens/credentials.json` (chmod 600):

```json
{
  "myteam": { "apiToken": "your-cloud-api-token" },
  "client": { "pat": "your-server-pat" }
}
```

Tickets are auto-routed by prefix: `PROJ-42` uses "myteam", `CLI-10` uses "client".

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

```bash
/jtb TICKET-KEY              # Fetch ticket + linked tickets (depth 1)
/jtb TICKET-KEY --depth=0    # Target ticket only (fast)
/jtb TICKET-KEY --depth=2    # Include linked-of-linked tickets
/jtb TICKET-KEY --profile=client  # Force a specific profile
```

### What it does

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
node ~/.agents/skills/jtb/scripts/fetch-ticket.mjs TICKET-KEY [--depth=N]
```

## Full Documentation

See [docs/USER_GUIDE.md](docs/USER_GUIDE.md) for architecture, output format, troubleshooting, and contributing guide.
