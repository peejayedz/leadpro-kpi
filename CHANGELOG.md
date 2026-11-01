# Changelog

All notable changes to the LeadPro KPI scorecards: the dashboards, the scripts and the admin page.
Versions follow semantic versioning: MAJOR for changes that break existing firms, MINOR for new features, PATCH for fixes.
Every line is tagged **[client]** (shows on the dashboards, and in their "What's new") or **[internal]** (admin page, scripts, workflows).
Syncs and firm add/edit actions are not listed.

## v1.3.1 — 2 Nov 2026
- [internal] Read-only diagnostic for GHL's message export (`scripts/diag-export.mjs`, "Diagnose message export" workflow): pulls it several times in a row and logs page-by-page counts, dates, timings and rate-limit headers. No message content or contact data is logged.

## v1.3.0 — 2 Nov 2026
- [client] A lead in a "no show" stage (or tagged no show) now counts as a booked consult that was missed, so it shows under Consult booked and No-shows instead of being left out of both.
- [internal] Stage-mapping test suite (`node tests/mapping/run.mjs`): 7 fixtures (Mahdavi, LFMP, the ACME template and four made-up law firms) checked for pre-selection, an unchanged-save round trip and the funnel counts from a real sync against a mock GHL.
- [internal] New firm: every pipeline with at least 3 recognised funnel stages is pre-selected, so a firm with one intake pipeline per practice area keeps them all.
- [internal] Saving an unchanged mapping leaves config.json byte-identical (no empty keys added).
- [internal] The mapping logic moved to `admin/mapping.mjs`, shared by the admin page and the tests.

## v1.2.0 — 2 Nov 2026
- [client] "How this works" has a What's new section, and the dashboard footer shows the version number.
- [internal] CHANGELOG.md added; the admin page shows the full changelog in a What's new panel.

## v1.1.0 — 2 Nov 2026
- [internal] Shared defaults: targets, banner, recommended focus, channel rules, attribution note, qualification and speed-to-lead settings live once in `firms/_defaults.json`, with optional practice-area defaults in `firms/_defaults/`. Each firm's `config.json` keeps only its own values and overrides. Mahdavi, LFMP and the template were migrated with no change in their numbers.
- [internal] The admin page's banner switch and New firm write only firm-specific values.

## v1.0.0 — 2 Nov 2026
- [client] Every firm's scorecard now lives at its own address, `peejayedz.github.io/leadpro-kpi/firms/<firm>/`, and shows the firm's practice area under the title.
- [client] The "Refresh data" button is now **Reload**: it shows the latest data, and the dashboard updates from GoHighLevel every 30 minutes.
- [client] A saved passphrase is remembered separately for each firm, so one firm's dashboard never unlocks another's.
- [internal] One repo for every firm (`peejayedz/leadpro-kpi`): shared dashboard in `app/`, one folder per firm, `firms/index.json` firm list, sync every 30 minutes for all firms or one.
- [internal] Discover workflow reads a firm's pipelines, stages, calendars and custom fields into `discovery.json` (names and ids only).
- [internal] Mahdavi and LFMP migrated from their own repos; their numbers match the old dashboards.
- [internal] Admin page at `/leadpro-kpi/admin/`: password lock, encrypted GitHub token, firm list (open, copy GHL link, re-sync, edit mapping, banner on/off, delete) and a six-step New firm flow with stage mapping, retry and clean-up.
- [internal] Each firm's sync runs as its own job with only that firm's two secrets (`GHL_TOKEN_<KEY>`, `PASSPHRASE_<KEY>`); a firm's `secretKey` must match its slug. Replaces passing every secret at once, which GitHub flagged.
- [internal] Fixed single-firm syncs losing their data; a sync that loses data now fails instead of passing silently.
- [internal] New firm form has a "Create the GHL token" helper: a direct link to the sub-account's Private Integrations page, the integration name to copy, and the nine read-only scopes with GHL's on-screen names.
- [internal] Discover checks each of the nine scopes and the admin page names any that are missing, with a Re-check button.
- [internal] On-demand syncs come from the admin page's Re-sync; the dashboards no longer use a dispatch token.
