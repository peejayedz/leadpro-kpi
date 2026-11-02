# LeadPro KPI Scorecards

One repo hosting the intake KPI dashboard for every Law Firm Marketing Pros law firm. Each firm's dashboard is synced from its GoHighLevel sub-account every 30 minutes by GitHub Actions and served by GitHub Pages.

- Firm dashboard: `https://peejayedz.github.io/leadpro-kpi/firms/<slug>/`
- GHL Custom Menu Link: `https://peejayedz.github.io/leadpro-kpi/firms/<slug>/#k=<passphrase>` (write `#` inside a passphrase as `%23`)
- Admin page (adds firms, edits mappings): `https://peejayedz.github.io/leadpro-kpi/admin/`

## Layout

```
app/dashboard.html          the shared dashboard page (reads the firm slug from the URL)
scripts/kpi-core.mjs        the only place KPIs are calculated (used by the page and the sync)
scripts/sync.mjs            syncs one firm: node scripts/sync.mjs <slug>
scripts/sync-all.mjs        local runs only: syncs firms/index.json (or one slug) with GHL_TOKEN from your shell
scripts/plan-matrix.mjs     builds the per-firm job list for sync.yml
scripts/discover.mjs        reads a firm's pipelines, stages, calendars and custom fields → firms/<slug>/discovery.json
scripts/firms.mjs           slug rules and secret names shared by the scripts
scripts/scope-check.mjs     the nine GHL scopes and the one-read-per-scope check (discover and sync)
scripts/sync-status.mjs     sync issue rules and wording, shared by the workflow and the admin page
scripts/update-status.mjs   after each sync run: updates status/sync-status.json
status/sync-status.json     written by the sync: per-firm OK / Held / Failed and open + resolved issues (no secrets or contact data)
firms/index.json            the firm list: [{ slug, secretKey, name, practiceArea, locationId, createdAt }]
firms/_defaults.json        shared settings for every firm (targets, notice, recommendedFocus, channels, attributionDisclaimer, qualification, speedToLead)
firms/_defaults/            optional practice-area defaults: <practice-area>.json, listed in index.json
firms/_template/            firm-specific config.json and index.html stub that every new firm starts from
firms/<slug>/index.html     tiny stub that loads app/dashboard.html
firms/<slug>/config.json    goals, stage mapping, ad spend, locationId, practiceArea (no secrets)
firms/<slug>/data/          written by the sync: kpis.json (numbers only) and details.enc.json (encrypted)
firms/<slug>/discovery.json written by the Discover workflow (names and ids only)
.github/workflows/sync.yml      every 30 min + Run workflow (optional slug; empty = all firms)
.github/workflows/discover.yml  Run workflow with slug + secretKey (and the location ID for a brand-new firm)
admin/index.html            admin page: firm list, New firm, Edit mapping, banner, delete
admin/lock.json             admin password verifier (written by scripts/set-admin-password.mjs; no password inside)
scripts/set-admin-password.mjs  sets the admin password (prompts in the terminal)
```

## Shared defaults

Each firm's effective config is built in three layers, by the sync and by the dashboard alike (`scripts/config-merge.mjs`):

1. `firms/_defaults.json`: settings every firm shares.
2. `firms/_defaults/<practice-area>.json`: optional, for one practice area (e.g. `personal-injury.json`). Only used when its name is listed in `firms/_defaults/index.json`.
3. `firms/<slug>/config.json`: the firm's own values (name, location, stages, pipelines, time zone…) and any overrides.

Objects merge key by key; arrays and plain values replace; `null` switches a default off (LFMP uses `"notice": { "show": false, "autoHide": null, "lowActivity": null }`). Change a target or a channel rule once in `_defaults.json` and every firm picks it up on its next sync.

## Slugs and secrets

A slug is the firm name in lowercase, letters, digits and hyphens only (`mahdavi`, `harrison-law-group`). `admin`, `app`, `scripts` and `_template` are reserved.

The dashboards' **Reload** button only shows the latest published data; syncs run every 30 minutes, and the admin page's **Re-sync** forces one for a single firm.

Each firm has a `secretKey` in `firms/index.json`: the slug in capitals, hyphens as underscores (`test-firm` → `TEST_FIRM`). It names the firm's two repository secrets (Settings → Secrets and variables → Actions):

| Secret | What it is |
| --- | --- |
| `GHL_TOKEN_<secretKey>` | read-only GHL Private Integration Token from that firm's sub-account (scopes below) |
| `PASSPHRASE_<secretKey>` | the firm's team passphrase that unlocks names, custom dates and drill-downs |

e.g. `harrison-law-group` → `GHL_TOKEN_HARRISON_LAW_GROUP`, `PASSPHRASE_HARRISON_LAW_GROUP`.

`sync.yml` runs in three jobs: **plan** reads `firms/index.json` (or the one slug) into a list of `{ slug, secretKey }`; **sync** runs once per firm (`fail-fast: false`) and receives only that firm's `GHL_TOKEN_<secretKey>` and `PASSPHRASE_<secretKey>`, then uploads `firms/<slug>/data` as an artifact; **commit** downloads every firm's artifact and makes one commit. A secretKey must match its slug, so one firm can never borrow another's secrets. No script prints a secret.

## GHL Private Integration scopes (all read-only)

| Scope | Used for |
| --- | --- |
| `opportunities.readonly` | Leads, pipeline stages, won/lost status |
| `contacts.readonly` | Name, email, phone, tags, source, attribution |
| `users.readonly` | "Assigned to" names |
| `locations.readonly` | Location lookup |
| `locations/customFields.readonly` | Finding the custom field ids |
| `calendars.readonly` | Calendar names (which ones are consults) |
| `calendars/events.readonly` | Consult appointments, showed / no-show |
| `conversations.readonly` | Call log |
| `conversations/message.readonly` | Call direction and status, inbound replies |

## Privacy model

GitHub Pages sites are public, so:

- `firms/<slug>/data/kpis.json` holds **numbers only**. No names, emails or phones.
- `firms/<slug>/data/details.enc.json` holds contact-level records, **encrypted** with AES-256-GCM under a key derived from the firm's passphrase (PBKDF2-SHA256, 210k iterations).
- `firms/<slug>/discovery.json` holds pipeline, stage, calendar and custom-field names and ids only.
- Each dashboard remembers its own passphrase per device (`lfmp-pass-<slug>` in localStorage), so firms never share one.
- GHL tokens live only in Actions secrets.

## Calls and messages

Missed calls, missed calls not returned, speed to first contact, contacted within 5 minutes and part of "Contacted" come from GHL's conversation-message export (calls and inbound replies). That export is unreliable: the same request returns a different subset of messages from one pull to the next with no sign anything is missing, a long pull can stop early, and deep pages sometimes fail with HTTP 500. So the sync:

- **Pulls each channel twice**, a third time if the two disagree, and combines them by message id. Rate limits (429), GHL server errors (5xx) and network errors are retried per page; a channel GHL doesn't offer (a 4xx on the first page, e.g. Facebook on a sub-account without it) is skipped.
- **Carries earlier syncs forward.** Each sync keeps a message log inside `details.enc.json` and combines it with what GHL returned, so a call or reply seen once stays counted until it leaves the lookback window. The log holds only message and contact ids, channel, direction, status, call duration and time; no message bodies or subjects. It needs the firm's passphrase. If the previous file is missing or can't be decrypted (passphrase changed), the sync starts fresh from the current pull and logs a warning.
- **A call or message deleted in GHL stays counted until it leaves the 400-day window** (`lookbackDays`), because the sync can't tell a deleted message from one GHL left out of a pull.
- **Holds** a firm when a channel still comes in more than 10% (and at least 5 messages) below the last sync: `kpis.json` keeps the previous numbers and only its `sync` block changes (`holds`, `heldSince`, `reason`). After 3 holds in a row (about 90 minutes) the new numbers publish anyway with `sync.incomplete: true`, and the dashboard shows "Call and message numbers may be incomplete" until every channel is back within 10% (or 5) of its pre-hold count, or 24 hours have passed, whichever comes first. The admin page flags held and incomplete firms in the firm list.
- Logs per-channel counts (each pull, combined, carried forward) in the Action log. A held or incomplete sync shows as a warning on the run's summary page.

To look at the export itself: Actions → **Diagnose message export (read-only)** → Run workflow (manual only). It pulls each channel several times in a row and logs page-by-page counts, dates, timings and rate-limit headers; no message content or contact data.

## Sync schedule and the sync chain

Syncs are meant to run every 30 minutes, at :07 and :37 UTC. GitHub skips many scheduled runs, so the cron is backed up by a **sync chain**: when a scheduled or chained sync ends, it starts `sync-chain.yml`, which waits for the next :07/:37 and starts "Sync all firms (chain)", unless a scheduled or chained sync already started for that slot. That run starts the chain again.

- Admin Re-syncs and manual "Run workflow" syncs never start the chain, so there is at most one. A newer waiting `sync-chain` run cancels an older one, and syncs themselves never run twice at once (concurrency group `sync`).
- **Stop the chain:** repo Settings → Secrets and variables → Actions → Variables → `SYNC_CHAIN` → set to `off` (or `gh variable set SYNC_CHAIN --body off`). The chain stops within one cycle (about 30 minutes) and the cron carries on alone.
- **Restart it:** set `SYNC_CHAIN` to `on`. The next scheduled sync restarts it, or run **Sync chain** from Actions to restart it straight away.
- The admin firm list shows when each firm was last updated, with a warning when it's more than 2 hours old.

## Running a sync by hand

Actions → **Sync KPIs from GoHighLevel** → Run workflow. Enter a slug for one firm, or leave it empty for all. Each firm shows as its own `Sync · <firm name>` job (so GitHub's failure emails name the firm); a failing firm doesn't stop the others, the commit job lists ✓/✗ per firm, and the run is marked failed if any firm failed.

Locally: `GHL_TOKEN=… DASHBOARD_PASSPHRASE=… node scripts/sync-all.mjs <slug>`.

## Sync issues: reading and fixing them

The admin page's **bell** (top right) shows sync problems without opening GitHub. A red badge counts open issues you haven't marked as seen, and the tab title shows the same count, e.g. "(2) LeadPro Admin". No badge means nothing new. The page checks again every 5 minutes while it's open, and when you come back to the tab.

**What counts as an issue**

| Issue | When | What to do |
|---|---|---|
| GHL token rejected | GHL refused the firm's token on every check (deleted, regenerated, revoked, or from another sub-account) | **Fix in GHL** → create or regenerate the "LeadPro KPI Scorecard" token → **Update token** (checks all 9 scopes first; replaces `GHL_TOKEN_<KEY>` only if they all pass, then re-syncs) |
| GHL token not set | The secret `GHL_TOKEN_<KEY>` is empty | Same as above |
| Token missing a scope | GHL refused part of the sync; the issue names the scope, e.g. View Calendars | **Fix in GHL** → edit the integration and tick that scope (the token stays the same) → **Re-sync** |
| GHL server or network error | GHL kept failing (5xx, rate limit, unreachable, unreadable) after 3 retries | Usually clears by itself. If it lasts over an hour, **Re-sync** and **View run on GitHub** |
| Firm config error | `config.json` missing or invalid, no location ID, or a wrong secret name in `firms/index.json` | Fix the file (Edit mapping rewrites `config.json`), then **Re-sync** |
| Sync failed (unknown error) | Anything else, e.g. a bug, or a job that was cancelled or timed out | **View run on GitHub**, **Re-sync** once; if it repeats, send the run link to whoever maintains the scorecards |
| Holding previous numbers (notice) | GHL returned clearly fewer calls/messages; hold n of 3. Shown as an amber notice in the panel, **not** counted in the badge or tab title | Nothing; it usually clears on the next sync |
| Dashboard shows the "may be incomplete" note | Published after 3 holds | Nothing; clears when counts recover, 24 hours at most |
| No successful sync in 45+ min (a firm) | The firm's last good sync is over 45 minutes old and it isn't already listed as failing | **Re-sync**; check the system issues |
| Sync chain is off | Repo variable `SYNC_CHAIN` is `off` | **Open variables** → set it to `on` → **Restart chain** |
| Sync chain has stopped | Chain on, but no link waiting and no chained sync running | **Restart chain** |
| No firm has synced in 45+ min | No firm's sync succeeded for 45 minutes (shown once, not per firm) | Fix chain issues first, then **Sync all firms now** |

**Reading an issue.** Click it to expand. It shows the firm, its GHL sub-account and location ID (or "System"), what happened in plain English, when it was first and last seen, how many syncs in a row it has happened, and numbered steps. The buttons are **Fix in GHL** (opens that sub-account's Private Integrations page), **Update token**, **Re-sync** (progress shows on the firm's row), **View run on GitHub** and **Go to firm** (scrolls to the firm's row and highlights it). Each firm's row also shows **OK**, **Held** or **Failed**, and a failing or stale firm has a **Details and fix** link.

**Clearing.** Issues clear by themselves when the firm's next sync succeeds; there's nothing to dismiss. **Mark as seen** (or **Mark all as seen**) removes an issue from the badge count. It stays listed until it's fixed, and comes back as new if the problem happens again later. "Seen" is remembered in that browser only. **Recently resolved** lists the last 20 resolved issues with when they were resolved and how long they lasted.

**How it works.** Every firm job writes a small result file: ok, or the failure's category. A failure that stops a sync never publishes partial numbers; the dashboard keeps its last good data. A 401/403 anywhere in the sync, even in an optional part, runs the nine-scope check to tell a rejected token from a missing scope and name it. The commit job turns the results and each firm's hold/incomplete flags into `status/sync-status.json`. One firm failing never stops the others from syncing and publishing, and the chain still starts the next link after a failed sync (unless `SYNC_CHAIN` is off). The admin page reads that file plus each firm's `kpis.json`, the `SYNC_CHAIN` variable (live; the admin GitHub token needs **Variables: Read-only**) and the chain's runs. If the variable can't be read, it falls back to the value the last sync recorded.

**Update token** sends the pasted token only to GHL's API (one read per scope for that firm's location, the same check as Discover) and, if all 9 scopes pass, to GitHub's Secrets API sealed with the repo's public key. It's typed into a masked field and is never logged, saved in the browser or shown again.

**Privacy.** `status/sync-status.json` is public, like the rest of the repo. It holds only firm slugs, statuses, categories and short codes from fixed lists (e.g. `token`/`rejected`, `ghl`/`server`, area `calendars`), GHL scope names, timestamps, counts, hold reasons in the form "Call 63 → 16", and GitHub run links. Everything is copied field by field from an allow-list (`cleanResult`/`updateStatus` in `scripts/sync-status.mjs`), so error text, tokens, passphrases, names, phone numbers, emails and message content can't reach it. `tests/status/run.mjs` checks this. Firm names and location IDs come from `firms/index.json`, and the sub-account name from `discovery.json` (`locationName`), both already public.

Client dashboards don't show any of this. They keep only the "may be incomplete" note.

## Mapping a firm's pipeline (`firms/<slug>/config.json`)

Run **Discover a firm's GHL setup** to (re)write `firms/<slug>/discovery.json`, then set:

- `pipelines`: pipeline(s) holding new-client deals. Empty = every pipeline.
- `stages`: which stage names mean contacted / qualified / consult booked / consult held / agreement sent / signed / no-show. A later step counts as every earlier step.
- `turnedAway.stages`, `reasonLabels`: stages that mean a lead was turned away, and the label shown for each.
- `booking.calendarKeywords`: a consult is an appointment on a calendar whose name contains one of these words. Empty = every calendar.
- `adSpend.monthly`: `{ "2026-10": 6200 }`, for cost per signed client.
- `targets`, `recommendedFocus`, `notice`: goals, advice and the testing banner.

Commit, then run the sync for that slug.

## Admin page

`https://peejayedz.github.io/leadpro-kpi/admin/` is a static page that manages this repo through the GitHub API.

**Password.** Run `node scripts/set-admin-password.mjs` in your own terminal. It asks for the password twice (typing hidden) and writes `admin/lock.json` = `{ salt, iterations, verifier }` (PBKDF2-SHA256, 210,000 iterations). Commit and push it. The password itself is never stored. Changing it makes every saved GitHub token unreadable, so each device asks for the token again.

**GitHub token.** After unlocking, a device with no saved token asks for a fine-grained token: repository `leadpro-kpi` only, **Contents**, **Actions** and **Secrets** = Read and write, and **Variables** = Read-only (for the sync-issue bell's `SYNC_CHAIN` check). It's saved in this browser's localStorage under `leadpro-admin-gh-token`, encrypted with AES-GCM under a key derived from the admin password. "Forget token" removes it.

**What it does**

- **Firm list:** each firm's name, OK / Held / Failed, practice area, GHL sub-account, last sync and lead count, with Open dashboard, Copy GHL link (asks for the passphrase, never stores it), Re-sync, Edit mapping, Banner on/off and Delete (removes `firms/<slug>/`, the list entry and both secrets).
- **Create the GHL token helper** (in the New firm form): once the location ID is valid, a button opens that sub-account's Private Integrations page and another copies the integration name "LeadPro KPI Scorecard"; a checklist shows the nine scopes with GHL's names and keys.
- **Scope check:** `discover.mjs` makes one lightweight read per scope and records `scopes: { ok, missing, unchecked, tokenRejected }` in `discovery.json` (scope names only, no data). If any are missing, step 2 lists them by name with "Edit the integration in GHL and tick these; the token stays the same" and a **Re-check** button. If GHL refuses every check, it asks for a new token. Edit mapping shows the same warning.
- **New firm:** a form, then six steps with live progress: save the two secrets (sealed with the repo's public key, libsodium from cdnjs, pinned by SRI) → run Discover → map the stages → one commit with `config.json`, the stub and `firms/index.json` → first sync → links. A failed step can be retried; `firms/index.json` is only written in the commit step, so a failed run never leaves a half-made firm in the list. "Discard and clean up" removes whatever was created.
- **Sync issues bell:** see "Sync issues: reading and fixing them" above.
- **Edit mapping:** the same mapping panel against `discovery.json` (Re-read GHL refreshes it), then commits `config.json` and re-syncs.

The page finds the workflow run it started by its title (`run-name`: "Sync <slug>", "Discover <slug>") and stops waiting as soon as that run fails.

## Changelog

`CHANGELOG.md` lists every change to the dashboard, scripts, workflows and admin page, newest first, as `## vX.Y.Z — D Mon YYYY` with lines tagged `[client]` or `[internal]` (semantic versions: MAJOR breaks existing firms, MINOR adds a feature, PATCH fixes). Add an entry in the same commit as the change. Syncs and firm add/edit actions don't get entries.

- The dashboard footer shows the latest version, and "How this works" lists the `[client]` entries under What's new.
- The admin page's **What's new** button shows everything.

## Tests

`node tests/mapping/run.mjs` (Node 20+, no install) checks the admin page's stage mapping against every fixture in `tests/mapping/fixtures/`:

- **Pre-selection:** what the mapping panel starts with (`admin/mapping.mjs`, the same code the page runs) against an expected answer written by hand. Mahdavi and LFMP use their live `discovery.json` and `config.json` and must match them exactly.
- **Round trip:** Edit mapping, then saving with no changes, must leave `config.json` byte-identical.
- **Funnel:** `scripts/sync.mjs` runs in a temp copy against a mock GHL (`tests/mapping/mock-ghl.mjs`) with one lead in every stage. Each funnel count, the no-shows and the turned-away reasons must match what the expected mapping implies.

`node tests/messages/run.mjs` runs the real sync against a mock GHL whose message export misbehaves the way the real one does (short pulls, 500s and 429s, a missing channel, duplicate ids, unordered pages) and checks that numbers don't dip, that holds keep the previous numbers and then publish, what the message log stores, and that an unreadable previous file starts fresh.

`node tests/chain/run.mjs` checks the sync chain: slot timing, when a slot counts as already covered, the script against a mock GitHub API, and that the workflows keep their guardrails (who chains, concurrency, `SYNC_CHAIN`, the backup cron, and that a failed sync still commits the other firms and starts the next link).

`node tests/status/run.mjs` runs the real sync against a mock GHL that fails in every way the bell reports (token rejected, missing scopes, server error, rate limit, unreachable, config errors, missing token secret, a crash) and checks the category, that nothing is published, and that the result file holds no secrets or contact data. It also checks how runs open and resolve issues, the system-wide states (chain off, chain stopped, no sync at all, stale firms), the wording and buttons for each issue type, and that nothing outside the allow-list reaches `status/sync-status.json`.

All three print their results and exit 1 on any failure. Run it after any change to the mapping panel, `kpi-core.mjs`, the sync or a firm's mapping (update that firm's fixture when its mapping changes on purpose). Add a fixture for any new pipeline style that should be recognised.
