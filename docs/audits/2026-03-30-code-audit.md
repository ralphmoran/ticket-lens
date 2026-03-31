# Code Audit — 2026-03-30

Scope: `config.mjs`, `fetch-ticket.mjs`, `fetch-my-tickets.mjs`, `profile-resolver.mjs`,
`bin/ticketlens.mjs`, `help.mjs`, `attachment-downloader.mjs`.

---

## DRY Violations

**jiraEnv construction — duplicated in two entry points**
- `fetch-ticket.mjs:272-274`
- `fetch-my-tickets.mjs:153-155`

Identical three-line block:
```js
const jiraEnv = {
  JIRA_BASE_URL: conn.baseUrl,
  ...(conn.pat ? { JIRA_PAT: conn.pat } : { JIRA_EMAIL: conn.email, JIRA_API_TOKEN: conn.apiToken }),
};
```
This should live in `profile-resolver.mjs` as `buildJiraEnv(conn)` and be imported by both callers.

**`--project=` alias normalization — duplicated in two entry points**
- `fetch-ticket.mjs:185-189`
- `fetch-my-tickets.mjs:66-69`

Same four lines (`find`, `write hint`, `map to --profile=`). Extract to a shared helper, e.g. `normalizeProjectAlias(args)` in `cli.mjs`.

**`apiVersion` derivation — duplicated in two entry points**
- `fetch-ticket.mjs:278`
- `fetch-my-tickets.mjs:159`

`const apiVersion = conn.auth === 'cloud' ? 3 : 2;` — belongs in `profile-resolver.mjs` alongside `resolveConnection`.

**`hasAuth` guard — duplicated in two entry points**
- `fetch-ticket.mjs:228`
- `fetch-my-tickets.mjs:132`

`const hasAuth = conn.pat || (conn.email && conn.apiToken);` — same expression, same check. Should be a utility on `conn` or exported from `profile-resolver.mjs`.

**Profile-not-found error path — structurally duplicated**
- `fetch-ticket.mjs:229-249`
- `fetch-my-tickets.mjs:133-151`

Both blocks handle `profileError` (prompt) and missing-config (write to stderr) with near-identical branching. Extracting a `handleMissingConnection(conn, profileError, configDir, opts)` helper would collapse both.

**`config.mjs` is incomplete as a shared-constants module**
Only exports `DEFAULT_CONFIG_DIR`, `getVersion()`, `timeAgo()`, `truncate()`, `stripCr()`.
The constants and helpers listed above (`buildJiraEnv`, `buildApiVersion`, `hasAuth`) were called out as candidates for extraction in the March 2026 consensus review (P2) and are still inline.

---

## Security Gaps

**`fetch-ticket.mjs:83` — `profiles.json` read via raw string path concatenation**
`hasCloudConsent` and `saveCloudConsent` build the path with template literal `${configDir}/profiles.json`
instead of `path.join(configDir, 'profiles.json')`. On POSIX this is functionally equivalent, but it is
inconsistent with every other path construction in the codebase (all use `join`) and is a minor hygiene
issue. If `configDir` ever ends with a slash (e.g. from an env var) the double-slash in the path could
behave unexpectedly on some runtimes.
- `fetch-ticket.mjs:83` (`hasCloudConsent`) — `${configDir}/profiles.json`
- `fetch-ticket.mjs:91` (`saveCloudConsent`) — `${configDir}/profiles.json`

**`fetch-ticket.mjs:81-97` — `hasCloudConsent`/`saveCloudConsent` are file-local, untested**
These two functions read and write `profiles.json` directly, bypassing the cache-invalidating
`saveProfile` write path. A successful `saveCloudConsent` write will not invalidate
`_profilesCache`, so the next `loadProfiles()` call in the same process will return a stale
object (missing the `cloudSummarizeConsent` flag). In practice this is unlikely to cause a
visible bug today (consent is written once and then the process continues), but it is a
correctness gap that will bite if the check is ever called twice in a session.

**`attachment-downloader.mjs:40` — `jiraOrigin` is `null` when `JIRA_BASE_URL` is missing**
When `env.JIRA_BASE_URL` is falsy, `jiraOrigin` is set to `null`. The SSRF check at line 70
(`contentOrigin !== jiraOrigin`) then compares a real origin string to `null` and correctly
blocks the download. However this is a silent block with no error logged to stderr at the
caller level — the ticket fetch will succeed but all attachments will be silently skipped with
`skipReason: 'ssrf-blocked'`. The downstream `onProgress` callback logs per-file but the
caller (`fetch-ticket.mjs:404`) only counts `!r.skipped`, so the user sees "0 downloaded"
with no indication of why. Not a security hole but a DX/debugging gap.

**`bin/ticketlens.mjs:149-164` — `delete` command raw-mode stdin not guarded against non-TTY pipe input**
When `process.stdin.isTTY` is false (e.g. `echo y | ticketlens delete myprofile`), the
`setRawMode` block is skipped entirely and the deletion proceeds without confirmation. This is
intentional for scripting, but it is undocumented and could be surprising in CI environments
where stdin is a pipe. No security risk in isolation, but worth noting given the irreversibility.

**`fetch-my-tickets.mjs:24-37` — `defaultDigestDeliverer` sends license key as Bearer token in clear**
The license key is read from disk and attached as `Authorization: Bearer ${licenseKey}`.
Since HTTPS is used (`api.ticketlens.dev`) this is acceptable in transit, but the key is read
raw from `license.json` (not hashed). The backend stores `sha256(key)` — if this endpoint
ever validates on the server side it will need to hash the key before comparing. Ensure the
backend's `/v1/digest/deliver` handler hashes the incoming Bearer token before lookup;
if it does not, a leaked `license.json` grants API access indefinitely.

---

## Test Coverage Holes

**`hasCloudConsent` / `saveCloudConsent` (fetch-ticket.mjs:81-97) — zero tests**
These functions are file-local and cannot be unit-tested without refactoring. The cloud
consent flow in `fetch-ticket.test.mjs` tests the `applySummarize` path but only via the
injected `opts.summarizer` bypass (which skips the consent prompt entirely). The TTY consent
branch and the `saveCloudConsent` write path have no test coverage.

**`getDiff` / `applyCheck` (fetch-ticket.mjs:34-79) — no dedicated unit tests**
`applyCheck` is exercised indirectly via integration-style tests that inject `opts.getDiff` and
`opts.detectVcs`, but the VCS-none branch (line 66-71) and the real `spawnSync` path inside
`getDiff` are not covered. The `which` subprocess fallback (`which.status !== 0`) is untested.

**`bin/ticketlens.mjs` — `delete` command has no integration test**
`bin.test.mjs` has 4 tests: file-exists, --help, --version, unknown-ticket-key. The `delete`,
`activate`, `license`, `schedule`, `profiles`, and `config` commands are untested at the bin
level. Given that `delete` is irreversible, a test for the not-found path and the
no-TTY/auto-confirm path would be high value.

**`fetch-my-tickets.mjs` — `defaultDigestDeliverer` untested**
The real network path (POST to `api.ticketlens.dev`) has no test. The `opts.digestDeliverer`
injection point exists and is used in tests, but a malformed payload or a non-ok HTTP status
from the real function would produce only `throw new Error(...)` with no classified output.

**`profile-resolver.mjs` — last-profile deletion not tested**
`deleteProfile` is well-covered for the common cases (remove profile, remove cred, clear
default, not-found). There is no test for deleting the only remaining profile, which leaves
`config.profiles` as an empty object `{}`. `loadProfiles` would then return `{ profiles: {} }`
and all resolution paths would fall through to env-var fallback. This is probably the intended
behavior but is unverified.

---

## Docs vs Code Drift

**`--no-cache` description is inaccurate in both help functions**
- `help.mjs:54` and `help.mjs:116`: `"Re-download attachments even if cached"`
- Actual behavior: `--no-cache` skips both the **brief cache** (avoids the Jira API cache) AND
  forces attachment re-download. The help text describes only the attachment side effect, omitting
  the more impactful brief-cache bypass. A user relying on the help text alone would not know
  that `--no-cache` forces a fresh API call.

**`schedule` command absent from `printHelp()`**
- `bin/ticketlens.mjs` handles `case 'schedule'` with `--stop` and `--status` subcommands.
- `help.mjs:printHelp()` has no mention of `ticketlens schedule`, `ticketlens schedule --stop`,
  or `ticketlens schedule --status`. The command is Pro-gated but should appear in help output
  (even dimmed or with a `[Pro]` tag), consistent with how `--digest`, `--summarize`, and
  `--export` are documented.

**`printFetchHelp` does not mention brief cache**
- The fetch help (`help.mjs:95-130`) explains `--no-cache` only as an attachment control.
  There is no mention that a brief is cached for 4 hours by default or that `--no-cache`
  bypasses it. Users piping output to LLMs via `--plain` are the most likely to be confused
  by stale cached output.

**`resolveConnection` comment vs implementation — resolution order**
- `profile-resolver.mjs:1-3` comment: `"Resolution order: --profile flag → ticket prefix match → default profile → env vars"`
- Actual implementation: `--profile flag → ticket prefix match → project path match → default profile → env vars`
- Project path match (step 3) is missing from the module-level docstring.

---

## ticketlens delete — Verdict

`deleteProfile()` in `profile-resolver.mjs:76-100` is **fully implemented** for all documented
edge cases:

| Case | Handled |
|------|---------|
| Profile not found | Returns `{ deleted: false, reason: 'not-found' }` — line 79 |
| Deletes from `profiles.json` | Yes — line 81 |
| Clears `config.default` when deleting the default profile | Yes — line 82 |
| Removes credential entry from `credentials.json` | Yes — lines 88-95 |
| Writes both files with `chmod 600` | Yes — lines 85, 94 |
| Invalidates in-memory cache | Yes — line 98 |
| Returns `{ deleted: true }` on success | Yes — line 99 |

The bin-level `delete` handler (`bin/ticketlens.mjs:130-174`) adds:
- Missing-name guard with usage hint (line 133)
- Pre-flight existence check before prompting (line 139) — avoids raw-mode prompt on a name
  that would fail anyway
- Interactive `y/N` confirmation on TTY (line 147-164)

**One unhandled edge case:** deleting the last profile leaves `profiles.json` with
`{ profiles: {} }` and no `default`. The next `ticketlens` invocation will fall through to
env-var resolution and print a generic "Could not determine Jira profile" error rather than
the more helpful "`ticketlens init` to set up your connection" hint that is shown when
`profiles.json` does not exist. This is a UX gap, not a crash.

**No test for the last-profile case** (see Test Coverage Holes above).

---

## Summary

The audited files are production-quality in the security-critical paths: SSRF protection,
JQL injection escaping, path traversal sanitization, `chmod 600` on credential files, and
the `AbortSignal.timeout` coverage are all correctly implemented. The primary concerns are
concentrated in two areas.

**P1 — DRY violations create maintenance risk.** `jiraEnv` construction, `--project=` alias
normalization, `apiVersion` derivation, and `hasAuth` guard are each duplicated verbatim
across the two entry-point scripts. Any future change to auth logic (e.g. adding a new auth
type) must be applied in two places; the March 2026 `config.mjs` extraction P2 item should
be promoted to P1 given the number of duplicates still outstanding.

**P1 — Docs/code drift on `--no-cache` and missing `schedule` in help.** The `--no-cache`
description misleads users about its primary effect (brief cache bypass), and `ticketlens schedule`
is entirely absent from `printHelp()`. Both are user-visible gaps that undermine trust in the
documentation.

**P2 — Test coverage gaps** in `hasCloudConsent`/`saveCloudConsent`, the `delete` bin command,
`getDiff`/`applyCheck` edge cases, and the last-profile deletion scenario. None of these are
crash risks today, but they represent unverified behavior in irreversible or security-adjacent paths.
