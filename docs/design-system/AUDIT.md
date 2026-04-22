# TicketLens Design System — Extraction Audit

**Date:** 2026-04-21
**Scope:** Landing page (`site/index.html`) + Console (`ticketlens-api/resources/`)
**Method:** `ui-ux-pro-max` baseline rules + manual codebase scan following `impeccable/extract.md` Step 2 (identify patterns used 3+ times).
**Goal:** Produce a component-class CSS architecture (`tl-*` prefix) to reduce Tailwind inline repetition and isolate shared styling.
**Constraint:** Refactor preserves visuals and behavior. No new design decisions in this pass.

---

## 1. Repository State

| Surface | Files | Size | Style approach today |
|---------|-------|------|----------------------|
| Landing page | `site/index.html` (1 file) | 1,704 lines | Inline `<style>` (lines 15–789, 773 lines), two inline `<script>` blocks (793–800, 1490–1872, 391 lines combined). Already uses **semantic classes + CSS custom properties** — not utility-first. |
| Console | `ticketlens-api/resources/js/**/*.vue` | 24 files, 3,013 lines | Utility-first Tailwind 4 inline classes. 387 unique Tailwind tokens across files. `@theme` block in `resources/css/app.css` defines font only. 40 inline SVG icons. |

Landing page extraction is **purely mechanical** (move inline blocks to external files — classes already exist). Console is where the design-system work happens.

---

## 2. Design Tokens to Extract

All tokens go in `resources/css/tokens.css`, exposed via `@theme` in `app.css`. Names use the `--tl-` prefix.

### 2.1 Color — Surface

Derived from observed Tailwind usage:

| Token | Value | Tailwind equivalent | Usage |
|-------|-------|---------------------|-------|
| `--tl-bg` | `oklch(0.185 0.013 255)` | `bg-slate-950` | Page background (`ConsoleLayout` root) |
| `--tl-surface` | `oklch(0.225 0.014 255)` | `bg-slate-900` | Cards, sidebar, primary surfaces |
| `--tl-surface-2` | `oklch(0.275 0.015 255)` | `bg-slate-800` | Raised surfaces, chips, nav-active |
| `--tl-surface-3` | `oklch(0.325 0.015 255)` | `bg-slate-700` | Input backgrounds, pills |
| `--tl-border` | `oklch(0.28 0.014 255)` | `border-slate-800` | Default border |
| `--tl-border-strong` | `oklch(0.33 0.014 255)` | `border-slate-700` | Input borders |

### 2.2 Color — Text

| Token | Value | Tailwind equivalent |
|-------|-------|---------------------|
| `--tl-text` | `oklch(0.98 0 0)` | `text-white` |
| `--tl-text-primary` | `oklch(0.93 0.012 255)` | `text-slate-100` |
| `--tl-text-secondary` | `oklch(0.85 0.015 255)` | `text-slate-200` |
| `--tl-text-muted` | `oklch(0.72 0.018 255)` | `text-slate-400` |
| `--tl-text-subtle` | `oklch(0.62 0.018 255)` | `text-slate-500` |

### 2.3 Color — Brand / Semantic

| Token | Value | Tailwind | Use |
|-------|-------|----------|-----|
| `--tl-brand` | `oklch(0.55 0.18 275)` | `indigo-600` | Primary CTA background |
| `--tl-brand-hover` | `oklch(0.6 0.18 275)` | `indigo-500` | Primary CTA hover |
| `--tl-brand-soft` | `oklch(0.72 0.17 275)` | `indigo-400` | Logo text, links, progress bar |
| `--tl-brand-tint` | `oklch(0.72 0.17 275 / 0.10)` | `indigo-400/10` | Badge backgrounds |
| `--tl-warn` | `oklch(0.82 0.15 75)` | `amber-400/500` | Impersonation banner, warnings |
| `--tl-danger` | `oklch(0.68 0.19 25)` | `red-400` | Destructive actions |
| `--tl-success` | `oklch(0.72 0.17 155)` | `emerald-400` | Restore / positive actions |

> **Note:** Tailwind's `slate-*` scale maps cleanly to OKLCH values above. Using OKLCH keeps perceptual uniformity (per impeccable color-principles). Tailwind utilities continue to work — tokens are additive, not replacement.

### 2.4 Spacing (align to Tailwind 4pt grid)

Already provided by Tailwind's default spacing. No custom tokens needed unless we later want semantic names like `--tl-space-gutter`.

### 2.5 Radius

| Token | Value | Tailwind |
|-------|-------|----------|
| `--tl-radius-sm` | `0.25rem` | `rounded` |
| `--tl-radius` | `0.5rem` | `rounded-lg` |
| `--tl-radius-lg` | `0.75rem` | `rounded-xl` |
| `--tl-radius-full` | `9999px` | `rounded-full` |

### 2.6 Shadow / Focus Ring

| Token | Definition |
|-------|------------|
| `--tl-ring-subtle` | `0 0 0 1px oklch(0.45 0.015 255)` — form input focus |
| `--tl-ring-brand` | `0 0 0 2px oklch(0.6 0.18 275)` — primary button focus |
| `--tl-shadow-lg` | `0 10px 15px -3px oklch(0 0 0 / 0.3)` — banner/modal |

### 2.7 Transitions

| Token | Value | Use |
|-------|-------|-----|
| `--tl-transition-fast` | `100ms ease-out` | Hover tints |
| `--tl-transition` | `150ms ease-out` | Color transitions, default |
| `--tl-transition-slow` | `200ms ease-out` | Layout/transform |

### 2.8 Z-index Scale (per ui-ux-pro-max rule)

| Token | Value | Use |
|-------|-------|-----|
| `--tl-z-base` | `10` | Cards |
| `--tl-z-nav` | `30` | Mobile header |
| `--tl-z-sidebar` | `40` | Sidebar backdrop |
| `--tl-z-overlay` | `50` | Sidebar |
| `--tl-z-banner` | `60` | Impersonation banner |

### 2.9 Typography — observed state

- Console: `Instrument Sans` (from `@theme` in `app.css`) + Tailwind's default mono for `font-mono`.
- Landing: `Plus Jakarta Sans` + `JetBrains Mono` (inline `<style>`).

> **Flag (not in scope):** Instrument Sans is listed in impeccable's `reflex_fonts_to_reject`. Changing it is a separate design decision — this refactor keeps current fonts intact.

---

## 3. Repeated Pattern Inventory (extraction candidates ≥3 uses)

### 3.1 Card primitives

| Pattern (Tailwind chain) | Count | Proposed class |
|--------------------------|-------|----------------|
| `bg-slate-900 border border-slate-800 rounded-xl p-5` | **15** | `tl-card` |
| `bg-slate-900 border border-slate-800 rounded-xl overflow-hidden` | **7** | `tl-card--flush` (modifier drops padding for tables/code blocks) |
| `bg-slate-900 border border-slate-800 rounded-xl p-6` | **5** | `tl-card tl-card--lg` |
| `bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-2` | **4** | `tl-card tl-card--sm tl-card--stack` |
| `bg-slate-900 border border-slate-800 rounded-xl p-12 flex flex-col items-center justify-center text-center` | **6** | `tl-empty-state` |

### 3.2 Typography primitives

| Pattern | Count | Proposed class |
|---------|-------|----------------|
| `text-xl font-semibold text-white` | **17** | `tl-heading` |
| `text-slate-400 text-sm mt-0.5` | **17** | `tl-subtext` |
| `text-xs font-medium text-slate-400 uppercase tracking-wider` + variants | **8+** | `tl-label` (variants: `tl-label--spaced` = with `mb-4`) |
| `text-slate-300 font-medium mb-1` | **6** | `tl-field-label` |
| `text-xs text-slate-500 mt-1` | **9** | `tl-hint` |
| `text-sm text-slate-400 mb-4` | **5** | `tl-lede` |

### 3.3 Table primitives

| Pattern | Count | Proposed class |
|---------|-------|----------------|
| `text-left px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider` | **12** | `tl-th` |
| `text-right px-5 py-3 text-xs font-medium text-slate-400 uppercase tracking-wider` | **6** | `tl-th tl-th--right` |
| `px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider` | **5** | `tl-th tl-th--muted` |
| `border-b border-slate-800 text-slate-400 text-xs uppercase tracking-wider` | **5** | `tl-thead` |
| `hover:bg-slate-800/30 transition-colors duration-100` | **4** | `tl-tr` (tbody row hover) |
| `divide-y divide-slate-800/60` | **4** | `tl-divide` |
| `px-4 py-8 text-center text-slate-500 text-sm` | **4** | `tl-td--empty` |

### 3.4 Form primitives

Observed 7 input/select variants all sharing: `bg-slate-800 border border-slate-700 rounded-lg px-3 py-{1.5|2} text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500`.

| Proposed class | Absorbed sub-patterns |
|----------------|----------------------|
| `tl-input` | `<input>` default size (py-2) + focus ring |
| `tl-input--sm` | py-1.5 variant |
| `tl-input--full` | adds `w-full` |
| `tl-select` | same as `tl-input` but for `<select>` (identical tokens today) |
| `tl-checkbox` | `w-4 h-4 rounded bg-slate-800 border-slate-700 text-indigo-600 focus:ring-1 focus:ring-slate-500` |

Another field pattern (larger, bolder): `w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-colors duration-150` (5 uses) → `tl-input--hero` (used on Login + primary forms).

> **Bug flagged:** 13 of 18 `<input>` elements in the codebase lack any `focus:ring`. `tl-input` makes the focus ring mandatory — applying it fixes an accessibility gap (ui-ux-pro-max: `focus-states` CRITICAL rule).

### 3.5 Button primitives

No single button chain repeats 3+ verbatim, but **button families** are obvious:

| Family | Example markup | Count (approx) | Proposed class |
|--------|----------------|----------------|----------------|
| Primary (filled indigo) | `px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-40 transition` | 4+ | `tl-btn tl-btn--primary` (size modifier: `tl-btn--sm` for `text-xs py-1.5`) |
| Secondary (slate chip) | `px-3 py-1.5 rounded bg-slate-700 text-slate-200 hover:bg-slate-600 transition` | 3+ | `tl-btn tl-btn--secondary` |
| Ghost / text link | `text-xs text-{color}-400 hover:text-{color}-300 transition` | 8+ (color variants) | `tl-btn-ghost` with `--danger`, `--warn`, `--success`, `--brand` modifiers |
| Outlined chip (color-tinted) | `text-xs px-3 py-1.5 rounded bg-{color}-900/30 text-{color}-300 border border-{color}-800 hover:bg-{color}-900/60 transition` | 4+ (color variants) | `tl-chip-btn` with `--danger`, `--warn`, `--success` modifiers |
| Dismiss/neutral | `px-4 py-2 rounded-lg bg-slate-800 text-slate-200 text-sm hover:bg-slate-700 transition` | 3+ | `tl-btn tl-btn--neutral` |

### 3.6 Badge / status primitives

| Pattern | Count | Proposed class |
|---------|-------|----------------|
| `inline-flex items-center gap-1 text-xs font-medium text-indigo-400 bg-indigo-400/10 border border-indigo-400/20 px-2 py-0.5 rounded-full` | **4** | `tl-badge` + `--brand` color modifier |
| `w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block` | **4** | `tl-dot tl-dot--brand` |
| `w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block` | **4** | `tl-dot tl-dot--success` |
| `text-xs font-mono text-slate-200 bg-slate-800 px-2 py-0.5 rounded` | **6** | `tl-kbd` (code/keyboard chip) |
| `font-mono text-indigo-400 bg-slate-800 px-1.5 py-0.5 rounded` | **4** | `tl-kbd tl-kbd--brand` |

### 3.7 Layout primitives

| Pattern | Count | Proposed class |
|---------|-------|----------------|
| `px-4 sm:px-6 lg:px-8 py-8 max-w-6xl mx-auto` | **13** | `tl-page` (page container) |
| `flex items-center justify-between mb-4` | **10** | *Not extracted* — one-line utility, no cognitive benefit to aliasing |
| `bg-slate-900 border border-slate-800 rounded-xl overflow-hidden` + `hidden md:block` prefix | **4** | `tl-card--desktop-only` modifier |

**Decision:** Do NOT extract one-line flex utility chains. They are already the simplest expression. Extraction would add indirection without reducing cognitive load (violates KISS).

### 3.8 Nav / sidebar primitives (ConsoleLayout.vue only, internal reuse)

| Pattern | Count in file | Proposed class |
|---------|---------------|----------------|
| `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-150 cursor-pointer` + active/inactive state via `:class` | 2 (main nav + owner nav) | `tl-nav-link` + `tl-nav-link--active` / `tl-nav-link--owner` |
| `px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500` | 5+ (nav group headers) | `tl-nav-group-label` |

---

## 4. Icon Inventory (Phase 5 target)

**Total inline `<svg>` occurrences: 40** across 10 Vue files.

| File | Icons |
|------|-------|
| `Layouts/ConsoleLayout.vue` | 14 (nav icons + impersonation + logout + close + menu) |
| `Pages/Console/Analytics.vue` | 7 |
| `Pages/Console/Dashboard.vue` | 6 |
| `Pages/Auth/Login.vue` | 3 |
| `Pages/Console/Schedules.vue` | 2 |
| `Pages/Console/Upgrade.vue` | 1 |
| `Pages/Console/Team.vue` | 1 |
| `Pages/Console/Suspended.vue` | 1 |
| `Pages/Console/Summarize.vue` | 1 |
| `Pages/Console/Owner/Tiers/Index.vue` | 1 |

**Icon set:** Heroicons v2 outline, 24x24 viewBox, stroke-width 1.5 or 2 (two sizes observed). Per ui-ux-pro-max: "Use fixed viewBox (24x24) with w-6 h-6. Mix different icon sizes randomly" — ✗ currently.

### Proposed `TlIcon.vue` API

```vue
<TlIcon name="chart-bar" class="w-4 h-4" />
<TlIcon name="user-circle" class="w-5 h-5 shrink-0" />
```

### Icon name registry (derived from current usage)

Navigation: `chart-bar`, `user-circle`, `calendar`, `inbox`, `document-text`, `shield-check`, `users`, `user-group`, `key`, `currency-dollar`
Layout/controls: `menu`, `close`, `logout`, `warning-triangle`
Feature icons: `clock`, `refresh`, `arrow-right`, `check-circle`, `x-circle`, `lock-open`, `lock-closed`, `eye`, `eye-slash`, `spinner`, `sparkles`

Final list assembled during Phase 5 from actual files (≈24 unique paths; `d=` frequency shows most appear only once — consolidation value is **code reduction + single source of truth for stroke/size defaults**, not duplicate removal).

---

## 5. Anti-pattern Findings (per impeccable absolute_bans + common DO-NOTs)

| Location | Finding | Action |
|----------|---------|--------|
| `site/index.html:435` | `.feat-item.active { border-left: 2px solid var(--cta); }` — classic side-stripe accent (BAN 1) | **Out of scope for refactor.** Flag for separate design ticket. Do NOT change during extraction — would violate "preserve visuals" constraint. |
| `site/index.html:634–635` | `arch-track--out::after` / `::before` use `border-left: 7px` + `border-right: 7px` | **Legitimate CSS triangle arrows** (chevron markers on data-flow diagram), not side-stripe accents. Keep. |
| Console | No gradient text detected. | Clean. |
| Console | No `hover:scale` layout-shifting transforms. | Clean. |
| Console | No emoji icons used as UI icons. | Clean. |
| Console | 13 of 18 `<input>` elements lack `focus:ring`. | **Fix via `tl-input` class** — focus ring becomes default. Accessibility improvement within refactor scope (doesn't change visuals on focus, adds missing ones). |
| Console | Inconsistent icon sizes (`w-4 h-4`, `w-5 h-5`, `w-6 h-6`, `w-8 h-8`, `w-10 h-10`) | Keep variable sizes — `TlIcon` accepts a `class` prop, caller sets size. No rule against varied icon sizes when intentional. |

---

## 6. Proposed File Layout

### Landing page

```
site/
  index.html                 ← class-only markup + <link>/<script src>
  assets/
    styles.css               ← current inline <style> block (773 lines), verbatim
    app.js                   ← current inline <script> blocks concatenated (391 lines), verbatim
```

### Console

```
ticketlens-api/resources/
  css/
    app.css                  ← entry: @import tokens + components
    tokens.css               ← :root { --tl-* }
    components/
      buttons.css            ← @utility tl-btn, tl-btn--primary, tl-btn-ghost, tl-chip-btn
      cards.css              ← @utility tl-card, tl-card--lg, tl-card--sm, tl-empty-state
      nav.css                ← @utility tl-nav-link, tl-nav-group-label
      tables.css             ← @utility tl-th, tl-thead, tl-tr, tl-divide, tl-td--empty
      forms.css              ← @utility tl-input, tl-select, tl-checkbox, tl-field-label
      badges.css             ← @utility tl-badge, tl-dot, tl-kbd
      typography.css         ← @utility tl-heading, tl-subtext, tl-label, tl-hint, tl-lede
      layout.css             ← @utility tl-page
  js/
    components/
      TlIcon.vue             ← single <TlIcon name="..."/> consolidating 40 inline SVGs
```

---

## 7. Out of Scope (flagged for future tickets)

1. Landing page `feat-item.active` side-stripe border (impeccable BAN 1) — requires design-replacement decision.
2. Instrument Sans font replacement (impeccable reflex-reject list).
3. Console is dark-mode-only; no light-mode variants today. Not adding one.
4. Landing page already has light/dark theming via `[data-theme="light"]`. Preserved verbatim.
5. Any visual redesign (colors, spacing, typography, layout).

---

## 8. Success Criteria for Phases 2–7

- **Phase 2 (Landing):** Visual snapshot diff at 375px + 1440px = empty. DOM class list identical. Network shows `styles.css` + `app.js` loaded 200 OK.
- **Phase 3 (Tokens):** `npm run build` passes. Console renders identically (tokens defined but not yet consumed).
- **Phase 4 (Classes):** Same as Phase 3 — classes exist but unused. Build emits every `tl-*` name into `public/build/assets/*.css`.
- **Phase 5 (Icons):** Every page with icons rendered before/after. Console diff empty. `TlIcon.vue` is the only `<svg>` definition site for standard icons.
- **Phase 6 (Migrate):** Per page group, before/after screenshots + console/network diff empty. Inline utility chains removed where covered by `tl-*` class.
- **Phase 7 (Ship):** code-reviewer 0 CRITICAL/HIGH. No `tl-*` class is unused (every one has ≥1 consumer). Inline utility-chain count down ~40–50% on extracted pages.

---

**Review gate:** Approve this audit to proceed to Phase 2 (Landing page asset extraction). Changes to token values, class names, or extraction boundaries are easier to make here than later.
