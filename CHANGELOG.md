# Changelog

All notable changes to the LeadPro KPI scorecards: the dashboards, the scripts and the admin page.
Versions follow semantic versioning: MAJOR for changes that break existing firms, MINOR for new features, PATCH for fixes.
Every line is tagged **[client]** (shows on the dashboards, and in their "What's new") or **[internal]** (admin page, scripts, workflows).
Syncs and firm add/edit actions are not listed.

## v1.10.0 — 13 Nov 2026
- [internal] Token keeper (`tokens.yml`, `scripts/token-keeper.mjs`): firms marked `"tokenSource": "app"` get their GHL token from the private "LFMP LeadPro Connector" app instead of a pasted Private Integration token. Every hour and after each scheduled or chained sync, it mints a fresh sub-account token into the firm's existing `GHL_TOKEN_<KEY>`. It refreshes the agency token only when under 6 hours are left, and saves the new single-use refresh token before using anything new. One keeper runs at a time. Private Integration firms (Mahdavi, LFMP, Hedayati, Emery) are never touched, and `sync.yml` is unchanged.
- [internal] Admin bell: new issues for "Token keeper hasn't run" (3+ hours), "Re-connect the LeadPro Connector app", "Token keeper failed", "App not installed on this sub-account" and "Couldn't refresh this firm's app token", with a **Run token keeper** button. For app firms, a rejected token now points to the keeper instead of Fix in GHL / Update token.
- [internal] Admin firm list: each firm shows **Token: App** or **Token: Private Integration**.
- [internal] `status/token-keeper.json` (public): slugs, times, counts and short codes only.
- [internal] Tests: `node tests/keeper/run.mjs` (refresh due / not due, save before use, failed save, refused refresh, app missing, Private Integration firms never written, new firm, dry run, check mode, no secrets in logs or status).

## v1.9.0 — 12 Nov 2026
- [client] Funnel simplified for firms that sign on the first call.
- [internal] Stages can be listed by GHL stage id (`"stageMatch": "id"` in a firm's config), so renaming a stage in GHL can't break the mapping; names still work for every other firm. Edit mapping reads and saves ids for those firms, and the sync publishes the current names of id-listed stages (`stageNames` in `kpis.json`) so dashboards never show an id.
- [internal] Optional per-firm `hide` (`consultBooked`, `consultHeld`, `showRate`, `noShow`) and `sentRateBase: "qualified"`, both off by default. Mahdavi uses them: stages by id, consult steps hidden, agreements sent measured against qualified leads, Stage 6 renamed in GHL to "Agreement Sent – Awaiting Signature".
- [internal] Tests: the Mahdavi mapping fixture checks the new mapping, a simulated Stage 6 rename, hidden funnel steps, the sent-rate base and published stage names.

## v1.8.0 — 4 Nov 2026
- [client] LeadPro logo added; date line tidied.

## v1.7.1 — 3 Nov 2026
- [internal] Came-in-by breakdown for "New contacts not in pipeline": each sync logs, and writes to `status/sync-status.json` per firm, the last 30 and 90 days' counts by form, survey, chat widget, booking, inbound call, inbound SMS, inbound email and other, plus how many were left out as bulk-added, not typed lead or no inbound signal. The log also shows the first-touch medium of contacts counted only because they emailed in. Counts only; the status file accepts fixed keys and whole numbers only. No dashboard change.

## v1.7.0 — 3 Nov 2026
- [client] Under the New leads number: which pipeline it counts ("From your Lead Stages pipeline"). The New leads hover, the New leads row in "Where leads drop off", the "Lead → signed client" hover and "How this works" now explain that someone who called, texted or filled in a form but was never added to that pipeline isn't counted.
- [client] Hover explanations open with a tap on phones and tablets, and inside GoHighLevel.
- [internal] New contacts not in pipeline: each sync finds contacts created in the dates with no opportunity in any pipeline, typed lead, that came in by form, survey, chat widget or calendar booking (first-touch attribution) or called, texted or emailed in, leaving out bulk adds (5+ within 10 minutes). Rules in `scripts/not-in-pipeline.mjs` and `firms/_defaults.json` (`notInPipeline`).
- [internal] Admin page: each firm's 30-day count in the firm list, and an amber bell notice (not counted in the badge) with what to do when it's 1 or more.
- [internal] Client dashboard line under New leads with hover text and a "See who" list, behind `showNotInPipeline` in `firms/_defaults.json` (off; not turned on for any firm). The list lives only in `details.enc.json`; `kpis.json` and the run log get counts only.
- [internal] Tests: `node tests/pipeline/run.mjs` and `node tests/wording/run.mjs`.

## v1.6.1 — 3 Nov 2026
- [internal] Read-only diagnostic "Diagnose missing leads" (`diag-leads.yml`, `scripts/diag-leads.mjs`): opportunities by pipeline, new contacts with no opportunity (by source, type, attribution and tag), and inbound calls and messages from them. Counts only; writes and commits nothing.

## v1.6.0 — 2 Nov 2026
- [internal] Sync issues on the admin page: a bell with a count of new issues (also in the tab title) and a panel listing open issues newest first. Each one shows the firm, GHL sub-account and location ID (or System), what happened, first and last seen, how many syncs in a row, numbered steps, and Fix in GHL / Update token / Re-sync / View run on GitHub / Go to firm buttons. Issues clear when the next sync succeeds; Mark as seen removes one from the count. Recently resolved shows the last 20. Re-checks every 5 minutes. `SYNC_CHAIN` is read live (falls back to the value the last sync recorded).
- [internal] Issues covered: GHL token rejected or not set, token missing a scope (named), GHL server/network error, firm config error, unknown error, "may be incomplete" note, no successful sync in 45+ minutes (per firm and system-wide), `SYNC_CHAIN` off, sync chain stopped.
- [internal] Holding previous numbers shows as an amber notice in the panel and doesn't count in the badge or tab title; it counts once it becomes the published "may be incomplete" note.
- [internal] Update token checks the pasted token against GHL (all 9 scopes, for that firm's location) and replaces `GHL_TOKEN_<KEY>` only if every scope passes, then re-syncs. The token is masked and never logged or stored on the page.
- [internal] Firm rows show OK / Held / Failed and the GHL sub-account name (`discovery.json` now records `locationName`).
- [internal] The sync writes a result per firm and the commit job keeps `status/sync-status.json` (slugs, categories, scope names, timestamps, counts and run links only). A GHL 401/403 anywhere, even in an optional part, now stops the sync before publishing and names the missing scope. Per-firm jobs are named "Sync · <firm name>".
- [internal] Sync status tests: `node tests/status/run.mjs`. The chain tests also check that a failed sync still commits the other firms and starts the next link.

## v1.5.0 — 2 Nov 2026
- [client] The "Call and message numbers may be incomplete" note stays up until the counts are back near where they were, and clears after 24 hours at most.
- [internal] Sync chain: each scheduled or chained sync starts the next one at the following :07 or :37 (`sync-chain.yml`, `scripts/sync-chain.mjs`), because GitHub skips many scheduled runs. Admin Re-sync and manual runs don't chain; one chain at most; the 7,37 cron stays as backup. Repo variable `SYNC_CHAIN=off` stops it.
- [internal] Admin firm list: "Last updated" with date and time, and an "over 2 hours old" warning.
- [internal] Sync chain tests: `node tests/chain/run.mjs`.

## v1.4.0 — 2 Nov 2026
- [client] Missed calls, speed to first contact and contact rate no longer dip between updates when GoHighLevel returns only part of the call and message history. If an update still looks short after 90 minutes, the dashboard shows a "Call and message numbers may be incomplete" note.
- [internal] The sync pulls each message channel twice (three times if they disagree), combines the pulls, and carries earlier syncs' calls and replies forward in a message log inside `details.enc.json` (ids, channel, direction, status, duration and time only). An unreadable previous file starts fresh with a warning.
- [internal] A channel more than 10% (and at least 5) below the last sync holds the previous numbers for up to 3 syncs, then publishes flagged as incomplete. The admin page's firm list shows held and incomplete firms, Re-sync reports a hold, and it waits up to 8 minutes for a sync (pulling twice makes large firms slower).
- [internal] GHL server errors (5xx) and network errors are retried like rate limits; a page that keeps failing marks that channel incomplete instead of dropping it to zero; duplicate calls count once; paging stops only once a whole page is older than the window.
- [internal] Call and message tests: `node tests/messages/run.mjs`.

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
