# LeadPro KPI Scorecards

One repo hosting the intake KPI dashboard for every Law Firm Marketing Pros law firm. Each firm's dashboard is synced from its GoHighLevel sub-account every 30 minutes by GitHub Actions and served by GitHub Pages.

- Firm dashboard: `https://peejayedz.github.io/leadpro-kpi/firms/<slug>/`
- GHL Custom Menu Link: `https://peejayedz.github.io/leadpro-kpi/firms/<slug>/#k=<passphrase>` (write `#` inside a passphrase as `%23`)
- Admin page (adds firms, edits mappings): `https://peejayedz.github.io/leadpro-kpi/admin/` *(coming in Phase 3)*

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
admin/                      admin page (Phase 3)
```

## Slugs and secrets

A slug is the firm name in lowercase, letters, digits and hyphens only (`mahdavi`, `harrison-law-group`). `admin`, `app`, `scripts` and `_template` are reserved.

Each firm has a `secretKey` in `firms/index.json`: the slug in capitals, hyphens as underscores (`test-firm` → `TEST_FIRM`). It names the firm's two repository secrets (Settings → Secrets and variables → Actions):

| Secret | What it is |
| --- | --- |
| `GHL_TOKEN_<secretKey>` | read-only GHL Private Integration Token from that firm's sub-account (scopes below) |
| `PASSPHRASE_<secretKey>` | the firm's team passphrase that unlocks names, custom dates and drill-downs |
| `DISPATCH_TOKEN` | optional, one for the whole repo: fine-grained GitHub token, this repo only, **Actions: Read and write**. Enables the dashboards' Refresh button; stored only inside each firm's encrypted file. |

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
