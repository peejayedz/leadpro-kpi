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
firms/index.json            the firm list: [{ slug, secretKey, name, practiceArea, locationId, createdAt }]
firms/_template/            config.json and index.html stub that every new firm starts from
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

## Running a sync by hand

Actions → **Sync KPIs from GoHighLevel** → Run workflow. Enter a slug for one firm, or leave it empty for all. Each firm shows as its own `sync (<slug>)` job; a failing firm doesn't stop the others, the commit job lists ✓/✗ per firm, and the run is marked failed if any firm failed.

Locally: `GHL_TOKEN=… DASHBOARD_PASSPHRASE=… node scripts/sync-all.mjs <slug>`.

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

**GitHub token.** After unlocking, a device with no saved token asks for a fine-grained token: repository `leadpro-kpi` only, **Contents**, **Actions** and **Secrets** = Read and write. It's saved in this browser's localStorage under `leadpro-admin-gh-token`, encrypted with AES-GCM under a key derived from the admin password. "Forget token" removes it.

**What it does**

- **Firm list:** each firm's name, practice area, last sync and lead count, with Open dashboard, Copy GHL link (asks for the passphrase, never stores it), Re-sync, Edit mapping, Banner on/off and Delete (removes `firms/<slug>/`, the list entry and both secrets).
- **Create the GHL token helper** (in the New firm form): once the location ID is valid, a button opens that sub-account's Private Integrations page and another copies the integration name "LeadPro KPI Scorecard"; a checklist shows the nine scopes with GHL's names and keys.
- **Scope check:** `discover.mjs` makes one lightweight read per scope and records `scopes: { ok, missing, unchecked, tokenRejected }` in `discovery.json` (scope names only, no data). If any are missing, step 2 lists them by name with "Edit the integration in GHL and tick these; the token stays the same" and a **Re-check** button. If GHL refuses every check, it asks for a new token. Edit mapping shows the same warning.
- **New firm:** a form, then six steps with live progress: save the two secrets (sealed with the repo's public key, libsodium from cdnjs, pinned by SRI) → run Discover → map the stages → one commit with `config.json`, the stub and `firms/index.json` → first sync → links. A failed step can be retried; `firms/index.json` is only written in the commit step, so a failed run never leaves a half-made firm in the list. "Discard and clean up" removes whatever was created.
- **Edit mapping:** the same mapping panel against `discovery.json` (Re-read GHL refreshes it), then commits `config.json` and re-syncs.

The page finds the workflow run it started by its title (`run-name`: "Sync <slug>", "Discover <slug>") and stops waiting as soon as that run fails.
