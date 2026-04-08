# TicketLens Console — Design Spec
**Date:** 2026-04-07  
**Status:** Approved  
**Phase:** C (Frontend Dashboard)

---

## 1. Overview

**TicketLens Console** is a single web application serving two audiences — the operator (admin) and paying clients — through one URL. What each user sees is determined entirely by a bitwise permission bitmask resolved at login. There is no separate admin URL or app.

**Tagline (client-facing):** *"See what your CLI is saving you — and control it from anywhere."*

The Console makes CLI savings legible to managers who approve budgets. CLI sells to developers; Console sells to the people who pay for them.

---

## 2. Repository & Tech Stack

| Concern | Decision |
|---|---|
| Repo | `ticketlens-api` (same Laravel 11 app) |
| Frontend | Inertia.js + Vue 3 (`<script setup>`) |
| Styling | Tailwind CSS v4 (already installed) |
| Build | Vite 8 (already configured) |
| Auth | Laravel Sanctum (session-based for Inertia) |
| Existing CLI API | `/v1/...` routes untouched — CLI consumers unaffected |
| Landing page | `site/index.html` in `ticket-lens` repo — pure static HTML, unchanged |

Inertia.js eliminates a separate API layer for the frontend. The Console is controller-driven from Laravel, sharing models and services with the existing CLI backend.

---

## 3. Permission System

### 3.1 Bitmask Table

```php
// app/Enums/Permission.php (PHP) — mirrored in resources/js/permissions.ts
const SCHEDULES        = 1 << 0;  //   1
const DIGESTS          = 1 << 1;  //   2
const SUMMARIZE        = 1 << 2;  //   4
const COMPLIANCE       = 1 << 3;  //   8
const EXPORT           = 1 << 4;  //  16
const MULTI_ACCOUNT    = 1 << 5;  //  32
const SAVINGS_ANALYTICS = 1 << 6; //  64
const ADMIN_USERS      = 1 << 7;  // 128
const ADMIN_LICENSES   = 1 << 8;  // 256
const ADMIN_REVENUE    = 1 << 9;  // 512
```

Adding a new module requires no migration — define a new constant, guard the route and component. Done.

### 3.2 Tier Composites (constants only, never stored in DB)

```php
const TIER_FREE       = SAVINGS_ANALYTICS;                            //  64
const TIER_PRO        = SCHEDULES|DIGESTS|SUMMARIZE|SAVINGS_ANALYTICS; //  71
const TIER_TEAM       = TIER_PRO|COMPLIANCE|EXPORT|MULTI_ACCOUNT;     // 127
const TIER_ENTERPRISE = TIER_TEAM;                                    // 127 + custom overrides
const ADMIN_MASK      = ADMIN_USERS|ADMIN_LICENSES|ADMIN_REVENUE;     // 896
```

### 3.3 Data Model

```sql
users
  id, email, password, tier ENUM('free','pro','team','enterprise'),
  permissions INT UNSIGNED DEFAULT 0,   -- individual grants/overrides
  remember_token, created_at, updated_at

groups
  id, name, permissions INT UNSIGNED DEFAULT 0,
  created_at, updated_at

group_user
  user_id FK users.id,
  group_id FK groups.id

licenses
  id, user_id FK users.id,
  lemon_key VARCHAR(255) UNIQUE,
  status ENUM('active','cancelled','expired','paused'),
  expires_at NULLABLE TIMESTAMP,
  created_at, updated_at
```

No `user_permissions` join table. Individual overrides live on `users.permissions` directly.

### 3.4 Effective Permissions

Resolved on the backend at auth time, returned in every `/auth/me` response:

```php
// app/Services/PermissionService.php
public function effective(User $user): int
{
    return $user->groups->reduce(
        fn(int $carry, Group $g) => $carry | $g->permissions,
        $user->permissions
    );
}
```

The frontend receives `effectivePermissions` as an integer and never performs group resolution.

### 3.5 Frontend Permission Check

```ts
// resources/js/composables/usePermissions.ts
import { PERMISSIONS } from '@/permissions'

export const usePermissions = (user: AuthUser) => ({
    can: (bit: number): boolean => (user.effectivePermissions & bit) !== 0,
})

// Route guard
if (!can(PERMISSIONS.SCHEDULES)) router.visit('/upgrade')

// Component conditional
<RevenuePanel v-if="can(PERMISSIONS.ADMIN_REVENUE)" />
```

### 3.6 Tier Upgrade Flow (LemonSqueezy Webhook)

```
POST /webhooks/lemonsqueezy
  1. Verify HMAC-SHA256 signature — reject if invalid (403)
  2. Find user via licenses.lemon_key
  3. Map webhook event type to tier string and TIER_* constant
  4. users.permissions = (current & ADMIN_MASK) | TIER_MAP[new_tier]
       └─ preserves admin bits; replaces tier bits (prevents tier creep on downgrade)
  5. users.tier = new_tier
  6. Dispatch UserTierUpgraded event → invalidates permission cache (if Redis cache added)
  7. Return 200
```

---

## 4. Route Structure

All Console routes are under `/console`, guarded by `auth` + Inertia middleware.

```
/                           → redirect to /console or /login
/login                      → auth: login page
/register                   → auth: register (if self-serve)
/console                    → redirect to /console/analytics

/console/analytics          → SAVINGS_ANALYTICS (64)
/console/schedules          → SCHEDULES (1)
/console/digests            → DIGESTS (2)
/console/summarize          → SUMMARIZE (4)
/console/compliance         → COMPLIANCE (8)
/console/account            → no bit required (all authenticated users)
/console/team               → MULTI_ACCOUNT (32)

/console/admin/clients      → ADMIN_USERS (128)
/console/admin/licenses     → ADMIN_LICENSES (256)
/console/admin/revenue      → ADMIN_REVENUE (512)

/webhooks/lemonsqueezy      → public POST, HMAC-verified
```

Route middleware enforces `HasPermission` per route. Unauthorized → redirect to `/upgrade` (client) or `/console` (insufficient admin bits).

---

## 5. Module Inventory

| Module | Free | Pro | Team | Enterprise | Admin |
|---|---|---|---|---|---|
| Savings Analytics | teaser | full | full | full | full |
| Schedules | — | ✅ | ✅ | ✅ | ✅ |
| Digest History | — | ✅ | ✅ | ✅ | ✅ |
| Summarize History | — | ✅ | ✅ | ✅ | ✅ |
| Compliance | — | ✅ | ✅ | ✅ | ✅ |
| Export CSV/JSON | — | — | ✅ | ✅ | ✅ |
| Team / Seat Mgmt | — | — | ✅ | ✅ | ✅ |
| Account / BYOK | ✅ | ✅ | ✅ | ✅ | ✅ |
| Admin: All Clients | — | — | — | — | ✅ |
| Admin: Licenses | — | — | — | — | ✅ |
| Admin: Revenue / MRR | — | — | — | — | ✅ |

**Free teaser:** Savings Analytics renders a preview chart with blurred/locked data and an upgrade CTA. This is the highest-ROI upgrade nudge — makes the CLI's token savings visible before the user commits to Pro.

---

## 6. Module Descriptions

### Client Modules

**Savings Analytics** — Tokens saved, estimated $ equivalent, activity trend chart. Primary upgrade driver (Free → Pro). Shows the CLI's invisible work in concrete numbers.

**Schedules** — Visual interface for `POST/GET/DELETE /v1/schedule`. Create digest schedules without the CLI wizard. Shows next run time, last run status.

**Digest History** — Past `POST /v1/digest/deliver` deliveries. Status, timestamp, preview of delivered content.

**Summarize History** — Cloud summarize calls (`POST /v1/summarize`). Useful for BYOK cost tracking.

**Compliance** — History of `POST /v1/compliance` checks. Per-ticket results, monthly usage counter vs. limit (Free: 3, Pro: unlimited).

**Account** — License key status, tier, renewal date. BYOK API key management (Anthropic/OpenAI). LemonSqueezy upgrade/downgrade link.

**Team / Seat Management** — Invite teammates, assign/revoke seats, rotate per-seat license keys. The gate that forces Pro → Team upgrades.

### Admin Modules

**Admin: All Clients** — Table of all registered users. Filter by tier, activity, license status. Per-row: impersonate, view usage, force tier change.

**Admin: Licenses** — Issue, revoke, extend license keys. Link keys to LemonSqueezy orders manually if needed.

**Admin: Revenue / MRR** — Landing view for the operator. MRR waterfall: new + expansion − contraction − churn = net new MRR. Second widget: "accounts at risk" (license expiring or no CLI activity in 14 days).

---

## 7. UX Direction

**Aesthetic:** Linear / Vercel — clean, modern SaaS. Not Salesforce.

- Generous whitespace
- Monospace font (`JetBrains Mono`, already used in landing page) for IDs, tokens, counts
- One primary action per view
- `cmd+k` command palette (later iteration)
- Same color palette as landing page (`--cta: #22C55E`, dark background)

The Console must feel like an extension of the CLI. A heavy dashboard would contradict the "token efficiency" brand promise.

**Admin landing state:** MRR waterfall prominently. Everything else (client list, license admin) one click away — not on the landing view.

---

## 8. Adding a New Module (2 Steps)

1. Add constant to `Permission.php` and `permissions.ts`: `CLOUD_BACKUP = 1 << 10 // 1024`
2. Guard the route (`HasPermission::class(Permission::CLOUD_BACKUP)`) and component (`v-if="can(PERMISSIONS.CLOUD_BACKUP)"`)

No migration required. Assign the bit to a tier constant or individual user: `user.permissions |= 1024`.

---

## 9. Out of Scope

- Mobile app
- Real-time websocket updates (future iteration)
- OAuth SSO (future)
- In-Console Jira ticket creation/editing (rejected — see `decision_no_jira_crud.md`)
- Dark/light mode toggle (dark-only, matching landing page)

---

## 10. Implementation Notes

- **UI/UX tooling:** Use `ui-ux-pro-max` skill before any component work. Use Chrome Devtools MCP server for visual inspection during design.
- **No Co-Authored-By** in commits (global git preference).
- **Test coverage:** 80% minimum. Feature tests for all permission-gated routes. Unit tests for `PermissionService`.
- **CLI API routes unchanged:** `/v1/...` endpoints are not touched. Console uses new Inertia controller routes.
