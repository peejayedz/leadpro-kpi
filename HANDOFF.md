# LeadPro KPI: handoff notes

The README is the full reference and CHANGELOG.md the history. This file covers where the work stands and what to know before changing things.

## v1.35.0 "How we fill this in for you" + matched-word tags + shared shell 2.8.0 (queue item 2; with Builder v1.29.0 + Review admin v1.15.2): pushed 21 Nov 2026
- **What it is:** CHANGELOG v1.35.0. `admin/map-how.mjs` (the explainer: care + law versions, the "Showing:" line, remembered open / closed in `lfmp-map-how`), `scripts/care-core.mjs` `guessMatch()` (guessBucket + the matched text: "Guessed: “Deposit”"; never saved), `admin/mapping.mjs` `mappingSource()` (saved / preset / guessed). The words follow the code's rules; `tests/map-how/run.mjs` checks every example against them. New firm's working bar shows "… · N of 7 steps".
- **No change to counting or saving:** law-identical "All 6 law firms: identical numbers"; mapping 7/7; buildPipelineMap output unchanged.
- **Open (item 4):** `tests/care/ui.mjs` 3 "Save" checks + a later crash (same on HEAD before this); "last saved <date>" on the Showing line needs `mappingSavedAt` (PJ chose to add it in item 4).

## v1.34.0 The real WPP logo (queue item 1b, PJ's option B; with Review admin v1.15.1 + Builder v1.28.1): pushed 21 Nov 2026
- **What it is:** CHANGELOG v1.34.0. A WPP dashboard's agency mark is the real full-colour logo as `<img>`: `brand/wpp-logo.png` (light), `brand/wpp-logo-dark.png` (dark: only "WEB" white), 36 px / 30 px on a phone, no chip, alt "Web Promotion Partners", following Auto / Light / Dark. `brand/wpp-logo-mask.png` is no longer used by the dashboard (kept). LFMP dashboards: pixel-identical (Mahdavi, LFMP, Dumas checked at 1440 / 390, light / dark).
- **Push order:** KPI → automation-review → Builder (the Builder push deploys the team site). Live check: Boca's dashboard light + dark.

## v1.33.0 LFMP / WPP everywhere (shared shell 2.7.0, with Builder v1.27.0 + Review admin v1.15.0): LIVE 21 Nov 2026 (KPI `d8b772e5` → Review `8516c96` → Builder `301a7bc`; admin-site cd8c61e7868f9430 = a clean build of those commits). Live check (PJ's Chrome, every write blocked in the page): brand menu on Clients (8 · LFMP 7 · WPP 1, rows start with the brand), WPP → Boca only on Clients, then Scorecards and Reviews opened on WPP (one setting), back to All; Builder ZZ TEST 2 → Client details → Agency → Change → WPP → Save → the confirm (PJ's wording) → Cancel: nothing sent, record still LFMP; no console errors. Boca Dental's dashboard after the 17:37 UTC sync (kpis.json "agency": "WPP"): WPP logo next to LeadPro (blue / white in dark), footer "LeadPro · Web Promotion Partners", no LFMP name on the page, 1440 + 390, light + dark, no page errors.
- **What it is:** CHANGELOG v1.33.0. Scorecards brand filter ("All clients ▾"; phone: one Filter button + sheet, badge, chips, red Needs attention chip; summary / placeholder / counts / empty state follow; rows start with the brand on "All clients"; one setting for the three tools on this device). Brand = the Builder record (KPI slug or location), no record = LFMP.
- **Dashboard (client-facing):** `config.json` `"agency": "WPP"` → the sync writes `"agency": "WPP"` into `kpis.json` → WPP logo next to LeadPro (mask: blue in light, white in dark), footer "LeadPro · Web Promotion Partners", Draft banner "reviewed by Web Promotion Partners". LFMP firms: no key anywhere, dashboards pixel-identical (Mahdavi, Dumas, Emery, Hedayati, LFMP · 1440 + 390 · light + dark: 20/20; one Mahdavi frame differed once and was identical on 3 re-runs = render timing). The Builder writes `"agency"` when a client's agency is changed (Client details → Agency).
- **Boca Dental:** `firms/boca-dental/config.json` `"agency": "WPP"` is in this push: its dashboard shows the WPP logo after the first sync after the push (to check live).
- **Tests (21 Nov, local):** admin-ui 331/331 + brand checks; shell 47/47 (x3 repos, byte-identical); care + agency sync (WPP → key, LFMP / none → no key); law-identical 6/6; new-firm 26/26; status 30/30; every other node suite as before (alerts 18/19 and pipeline 11/12 were already failing before this work).

## v1.32.2 Add to GHL menu works with the in-GHL link: LIVE 20 Nov 2026 (`f2866031`). GHL needs `allowCamera` / `allowMicrophone` booleans with `openMode: "iframe"` (its docs say optional; Boca got 422 "allowCamera must be a boolean; allowMicrophone must be a boolean", found with v1.32.1). Both `false`; the guard requires them. Boca Dental: menu link created (id `93865fae-fd84-453b-b263-147080863a5f`), live (`ef73382c`); CSS rule (first given with -92; live with -91, see below) given to PJ (paste in Agency → Settings → Company → White Label → Custom CSS). **21 Nov, PJ pasted the rule and saved; checked read-only in Boca's sub-account (app.lawfirmmarketingpros.com, location cUGbQORfR3Qp9nnzcgft, "Boca Dental" on screen):** "KPI Dashboard" opens inside GHL (`/custom-menu-link/93865fae-…`, the dashboard in an iframe with the WPP logo) ✓. **Order NOT applied (OPEN):** the link computes `order: 50` and sits at the bottom of the menu (after App Marketplace), not at -92. The agency Custom CSS GHL serves to the sub-account (1006 characters, also after a reload) has the other firms' -92…-99 rules but no `#\39 3865fae…` line, so the save didn't reach it yet (not saved, saved elsewhere, or GHL still serving an older copy). Next: PJ checks the rule is in Agency → Settings → Company → White Label → Custom CSS and saved, then re-check. Nothing was changed in GHL during the check. **FIXED 21 Nov: Boca = order -91 (not -92).** PJ pasted Boca's line at the end of the agency Custom CSS and saved, with -91: `#\39 3865fae-fd84-453b-b263-147080863a5f { order: -91 !important; }`. Re-checked read-only in Boca's sub-account (location cUGbQORfR3Qp9nnzcgft, "Boca Dental" on screen): the served Custom CSS (now 1109 characters) has the line; the menu reads Dashboard (-100) · Contacts (-99) · Opportunities (-98) · LeadPro Training (-96) · **KPI Dashboard (-91)**, then Launchpad and the rest; it opens inside GHL (checked earlier the same day). Nothing changed in GHL. Note for later: KPI admin's "Show CSS rule" still gives -92 (menu-css.mjs MENU_ORDER); Boca's live rule is -91 by PJ's choice.

## v1.32.1 Add to GHL menu says why it failed: LIVE 20 Nov 2026 (`74fcd23d`; Builder v1.26.2 `274b893`; admin-site 280bb2764898c56d). GHL's refusal message (links + passphrase cut out) in the log, `status/menu-link-<slug>.json` and the popups (KPI admin + Builder KPI tab) instead of "GitHub stopped it".

## v1.32.0 Part 4: confirm first + Remove firm (shared shell 2.6.0): LIVE 20 Nov 2026 (push C: KPI `357a741` → Review `560b184` → Builder `3a8376b`; admin-site run 44694869949 green, "Changed: deploying admin-site 09587d87b3786cb8" = the local build). Live check (PJ's Chrome, signed in as the LFMP account, every non-GET call blocked in the page): KPI admin Edit mapping on ZZ TEST 2 → Re-read GHL opened the confirm (what happens / what does not), Cancel → closed, nothing dispatched; Builder ZZ TEST 2 → Review → Remove review package → red confirm (what goes / what is kept, Remove disabled until the name is typed) → Cancel → nothing sent, still Published; no console errors. Client pages: Mahdavi Link A (plans/ + plan.html) and Link B, Dumas Link A and Link B at 1440 + 390, light + dark: text identical and screenshots identical to before the push. Nothing removed on any client.
- **What it is:** CHANGELOG v1.32.0. New firm / Save mapping / Re-read GHL / Show CSS rule / Discard a half-made firm ask first. Remove firm (was Delete firm) = `remove-firm.yml` like the Builder's Remove scorecard (also the firm's own GHL menu link when live; logged in `status/removed.json` + Slack); the Builder record is noted.
- **Tests (20 Nov, local):** admin-ui 331/331, shell 44/44, every node suite.

## v1.31.0 Part 2: working bar + Done popup (shared shell 2.5.0): LIVE 20 Nov 2026 (KPI `3e98f83` → Review `64bba24` → Builder `4def994`; admin-site run 44625556680 green, "Changed: deploying admin-site 89d244fbcc5a34e2" = the local build, 103 files). Live check (PJ's Chrome, signed in as the LFMP account): KPI admin Edit mapping on ZZ TEST 2 → Re-read GHL (read only) showed the cyclist + "Reading ZZ TEST 2's pipelines from GHL…" / "Asking GHL nicely for your pipelines…", then after 13 s the popup "Done: pipelines updated · Pipelines 1 · Stages 12 · no new stages · Close / Review mapping"; the bell badge 1 → its Recent jobs line; the Builder and Review admin load with their new bell (the same job listed); no console errors on any of the three
- **What it is:** CHANGELOG v1.31.0. `startJob()` in the shared shell: the cyclist bar (variation B) and the centred Done / Didn't work popup (PJ approved the side-by-side screenshots, 20 Nov), results kept on this browser (`lfmp-jobs`) and in the bell (KPI: a Recent jobs section in the sync-issues panel; its badge adds new results). KPI admin: Re-read GHL, Save mapping, Re-sync, Add to GHL menu, Show CSS rule, New firm. `follow()` never shows GitHub's raw words.
- **Push order:** KPI → Review admin → Builder (the Builder's push deploys the admin site).
- **Live check after the deploy (PJ, 20 Nov):** fingerprint = the local build; Re-read GHL on ZZ TEST 2 only (a test sub-account; GHL read only) shows the cyclist and the Done popup; a look at the Builder and Review admin; no console errors. Never run a job against a real client to test.
- **Tests (20 Nov, local):** admin-ui 324/324 (the stale-data failures cleared once syncs ran again), shell 42/42 (same file in the three repos), new-firm 23/23, pipelines-by-id 10/10 (the fixture now takes Mahdavi's saved ids off), law-identical 6/6, status, mapping, chain, messages, care, keeper, remove-firm, wording, one-login, admin-app.

## v1.30.1 Fix: save the pipeline ids a sync finds: LIVE 20 Nov 2026 (`f9ff3e7`; the next sync wrote pipelineIds for all 5 law firms, numbers unchanged)
- **Why:** the 19:37 UTC chain sync (run 44600169295, the first after v1.30.0) migrated every law firm ("Pipelines now counted by ID" for Mahdavi, LFMP, Emery, Hedayati, ZZ TEST 2), but the per-firm jobs only hand `data/` to the commit job, so `config.json` lost the ids. Counting is correct (names still match); a rename would still drop those four to "Pipeline not found". Dumas is safe (seeded).
- **Fix:** side file `PIPELINE_IDS_OUT/<slug>.json` → `scripts/apply-pipeline-ids.mjs` in the commit job (only `pipelineIds` + `pipelines`; skipped if Edit mapping changed them).
- **After the push:** the next sync's commit should show `pipelineIds` in the five law firms' `config.json` ("Pipeline ids for <slug>: saved" in the commit job log).

## v1.30.0 Menu link inside GHL + its CSS rule + pipelines by ID: LIVE 20 Nov 2026 (`265e273`, Builder `e176d24` after; admin-site 195f5a7b0ff76e55) (push A of 3; with Builder v1.24.0). Live check: the 19:37 UTC chain sync migrated every law firm with matching numbers, Dumas counted 64 leads; ids not saved, see v1.30.1.
- **What it is:** CHANGELOG v1.30.0. Part 1: Add to GHL menu uses `openMode: "iframe"` (guard refuses anything else), keeps the link id (`config.menuLink.id`), and KPI admin Setup / Builder KPI tab show the agency Custom CSS rule (order -92) with Copy; **Show CSS rule** = `menu-css.yml`, one GET then commits the id. Part 3: law firms count `config.pipelineIds`; first sync migrates names once; a missing pipeline = "Pipeline not found" (bell badge + Slack, Edit mapping; last numbers kept).
- **Dumas & Sanclemente:** config seeded with `pipelineIds` = `mklLxJVYxOavYUDBZ4MV` "Lead Stages" (PJ chose this, 20 Nov). It's the same pipeline, renamed 19 Nov (discovery.json history). Without it, the next sync would have raised "Pipeline not found".
- **Push order:** KPI first, then the Builder (its `assemble.mjs` copies the new `scripts/menu-css.mjs`; Builder first = a failed deploy, safely), then `gh workflow run admin-site.yml -R peejayedz/ghl-subaccount-builder`. The team-site server must be deployed for `menu-css.yml` to be allowed (`K_WF`).
- **After the push (read-only checks):** the next sync commits `pipelineIds` for Mahdavi, LFMP, Emery, Hedayati and ZZ TEST 2 ("Pipelines now counted by ID" in the log) with identical numbers. Show CSS rule on a live firm only if PJ asks (it commits the id; GET only in GHL). Never press Add to GHL menu on a real client to test.
- **Already open before this work (not changed):** the sync chain looked stopped on 19 Nov (last scheduled sync 11:29 UTC, last chain run 11:33; `SYNC_CHAIN` = on). That makes 6 `tests/admin-ui` list checks fail ("No successful sync for 6 h"); they fail the same on `origin/main`. `tests/pipeline/run.mjs` (1 check: "reads the 30-day count from kpis.json"), `tests/alerts/run.mjs` (1: "the alert list is the admin bell's list") and `tests/admin-details/run.mjs` (crashes on boca-dental's funnel) also fail on `origin/main`.
- **Open (Builder, pre-existing):** after Add to GHL menu, the KPI card's old setup step list still says "GHL menu link · Not added: Draft" in the same session (the card's note says Added). Push B (the shared done popup) replaces that display.
- **Tests (20 Nov, local):** new-firm 23/23, pipelines-by-id 8/8, law-identical (5 identical + Dumas intended), status 30/30, mapping 7/7, messages 17/17, chain 7/7, care, keeper 22/22, remove-firm, wording 7/7, one-login, admin-app; admin-ui 306 passed / 6 failed (the 6 above, same on origin/main); new CSS-rule checks pass at 1440 + 390, light + dark.

## v1.29.2 The greeting's numbers at once (shared shell 2.4.2): DEPLOYED 19 Nov 2026 (`3d4b9ca`; Review `b268957`, Builder `8ee757a` after; admin-site run 44496387224 green, admin-site c7bd791fc03d7012 = the local build)
- **Live check: PJ to test by Sign out → sign in.** No Chrome live check was run.
- **What it is:** see CHANGELOG v1.29.2 and the Builder HANDOFF v1.22.2. The team site's `/api/greet-counts` counts "Needs attention" with `admin/greet-count.mjs` `readCounts()` (hidden + shown) and keeps it in KV `KPI_PASS` key `greet:counts` (the passphrase list only reads `pass:` keys).
- **Push order:** KPI and Review first, the Builder last.

## v1.29.1 Greeting after Sign out + all three numbers (shared shell 2.4.1): LIVE 19 Nov 2026 (`f5b959c`; Review `67ad062`, Builder `8ae7acd`; admin-site run 44359509100, admin-site 4935c6c871b5ab14 = the local build)
- **Live check (read-only):** serves 1.29.1 (CHANGELOG + whats-new); fresh `readCount` = Needs attention filter = 2. Sign out not pressed.
- **OPEN:** this count's live read takes ~3.6 s (index + every firm's config/kpis + status + chain), past the greeting's ~1.35 s cut, so the other tools' greetings usually show the last known count (≤ 12 h). See the Builder HANDOFF v1.22.1 for the options.
- **What it is:** see CHANGELOG v1.29.1 (with Builder v1.22.1 and Review admin v1.12.1). Sign out clears "greeted today"; the greeting reads all three counts fresh. `admin/greet-count.mjs` = the "Needs attention" count + the bell's issues + `readCount()` (the same GitHub reads as the list and the bell, read only). It imports `firm-details.mjs`, which brings a second `lfmp-session.js` copy into the other tools' pages; shell 2.4.1 makes that copy add no page-wide listeners.
- **Own count:** now noted only after the bell's issues are read (`issuesRead`), so it equals the settled filter (before: the first paint could be lower, e.g. 1 → 2).
- **Push order:** KPI and Review first, the Builder last (its push deploys); see the Builder HANDOFF v1.22.1.
- **Tests (19 Nov, local):** mapping / messages / chain / status, `tests/shell/shell.test.mjs` 33/33, `tests/admin-ui/run.mjs` 287/287; cross-tool: Builder `tests/e2e/greet-fresh.mjs` 27/27.

## v1.29.0 Greeting + name menu (shared shell 2.4.0): LIVE 18 Nov 2026 14:54 UTC (`4e90349` + `8254d89`; Builder `87297c7` + `5449b77`, Review `7dc6f8b` + `4bbc014`; admin-site run 44329460367, "Changed: deploying admin-site 7674f3d040aacd3b")
- **What it is:** the once-a-day greeting (shared `lfmp-session.js` / `lfmp-ui.css` 2.4.0, byte-identical in the three repos). This page gives "scorecards need attention" (= the Needs attention filter) and notes it in localStorage `lfmp-counts` for the other two tools.
- **Top bar:** initials only. Name, Last signed in, Theme, What's new (now with this page's version), Team sign-ins, Install and Sign out are in the name menu under the initials (desktop and phone; the phone's Me tab still opens the Me screen).
- **Live check (read-only, PJ's Chrome):** no second greeting the same day; bar = bell · + New firm · initials; the menu is opaque, What's new v1.29.0. The noted count follows the filter as the bell's issues load (1 → 2). Sign out not pressed; the What's new card left unread for PJ.
- **Tests:** `node tests/shell/shell.test.mjs` (greeting + menu, with CHROMIUM_PATH); `node tests/admin-ui/run.mjs` (greeting × 4 sizes/themes, Sign out from the menu).

## v1.28.0 Non-law scorecards (PBPCS) + Draft first + Add to GHL menu + Remove: LIVE 18 Nov 2026 10:36 UTC (`3b70f9f` + `6f66175`, rebased onto the sync commits; Builder `a94dba5`; admin-site run 44287053647, fingerprint e145f2fe871e1b41 = the locally tested build). Pushed on "GO PUSH 1" (Claude (chat), delegated by PJ). Live check (read-only): KPI admin v1.28.0 + care.css, 5 firms A–Z, PBPCS not added yet (step 5 not run); Map pipelines on ZZ TEST 2 opens (12 stages, 10 pre-filled, Save blocked "2 to choose"), NOT saved
- **Push order:** KPI first, then the Builder (its `assemble.mjs` copies `scripts/care-core.mjs`; with the Builder first the deploy fails, safely), then `gh workflow run admin-site.yml -R peejayedz/ghl-subaccount-builder`. The team-site server (`/api`) must be deployed for Add to GHL menu / Remove / Stop to be allowed.
- **What it is:** `config.practiceType` (absent = law, unchanged) · `config.pipelineMap` by stage + pipeline id · people counting · `config.countsOnly` · `sync.drift` → bell notice + Slack · `firms/index.json` `status`: `needsMapping` / `draft` / absent = live · new workflows `menu-link.yml` (Draft → live, only the menu step) and `remove-firm.yml` (Builder's Remove scorecard). Details: CHANGELOG v1.28.0.
- **Law firms unchanged:** `node tests/care/law-identical.mjs` (needs `git fetch`; compares with `origin/main`): all 6 identical. New law firms are Drafts now (no automatic GHL menu link); existing live firms keep theirs.
- **PBPCS (step 5, NOT done; after the deploy, in the browser by Claude (chat) or PJ):** KPI admin → + New firm → Medical & dental → name "Palm Beach Plastic and Cosmetic Surgery", location `ZccxN6Zevq1UkgUuOphV`, "Use the LeadPro app" → it stops at "Needs mapping" (no sync, no menu link) → Map pipelines (pre-filled from `firms/_presets/care/palm-beach-plastic.json` = PJ's 18 Nov mapping; check every chip, names are matched with dashes/case ignored) → Save → Draft + first sync. Then list the opportunities whose name or source contains "test" for PJ (QUESTION in the notes file). Never "Add to GHL menu" before Andy approves.
- **Boca Dental:** PJ started its KPI setup on 18 Nov with the live (old) flow → a LAW firm "boca-dental" (guessed stages, "Review mapping", no GHL menu link recorded). After the deploy: Edit mapping → Medical & dental → map → Save switches it to people counting (its law mapping is kept). PJ decides.
- **Open:** light-mode `--ink-3` grey (funnel "% of …", "No metric is above goal") is 3.86:1 on white, below AA, on every dashboard (pre-existing, law too). Mahdavi's 3-section layout (`.stages.three`) doesn't stack on phones (pre-existing; non-law fixed with `.stages.three.care`). Ask PJ before changing law dashboards.
- **Tests:** `tests/care/run.mjs`, `tests/care/law-identical.mjs`, `tests/care/ui.mjs [shots]` (CHROMIUM_PATH), `tests/remove-firm/run.mjs`, plus every earlier suite.

## v1.26.0 + v1.27.0: LIVE 18 Nov 2026 07:09 UTC (`5ff3191` after a rebase onto 27 sync commits; deploy 44256607647, fingerprint 04ab155bfbfef86b; live check in the Builder HANDOFF v1.18.0: A–Z, "4 firms · 1 needs attention", no trends, Check now gold fill)

## v1.27.0 Busy states ("no silent clicks"): LIVE 18 Nov 2026 (with Builder v1.18.0, Review admin v1.11.0)

- Shared `lfmp-session.js` / `lfmp-ui.css` 2.3.0 (Builder HANDOFF v1.18.0): press feedback, gold fill on the pressed button, gold top line while any request runs (all `api()` / `ghFetch()` calls). Delete firm, Check scopes (Update token), Check now (bell) and Clean up use `busyButton`; other buttons that start a request (Re-sync, Sync all, Restart chain, Mark as seen, …) get it automatically. New firm keeps its own step view. Cache `lfmp-ui.css?v=2.3.0`, `admin.css?v=1.27.0`.
- **PJ, 19 Nov (replaces the 17 Nov decision):** the summary line uses the "Needs attention" filter's words and count: "4 firms · 2 need attention" (nothing to look at: "all synced 4:37 PM").

## v1.26.0 Firms A–Z, honest trend, stale wording, sticky details header: COMMITTED LOCALLY 19 Nov 2026 (overnight run Part 1, not pushed; with Builder v1.17.0, Review admin v1.10.0)

- **Trend rule:** "▲ / ▼ n%" only when days 91–180 are fully covered by synced data: firm `createdAt` (firms/index.json) ≤ `periods.last90.from` − 90 days; else just "leads · 90 days". No "from 0". Today no firm qualifies (all started Nov 2026), so no trend shows anywhere; the first appear ~180 days after each start.
- **809% vs ▼17% (PJ's question):** the ▼17% in the v1.25.0 notes came from the Builder test `polish.mjs`, which SET Mahdavi's days 91–180 to 120 as a fixture. The real file has 11 leads there (only opportunities already in GHL before onboarding on 2 Nov), so live showed 100 vs 11 = ▲809%; LFMP had 0 → "▲ from 0". Neither is a real comparison.
- A–Z list (shared `byName`), "No successful sync for 3 h" on the row (the Slack DM wording in `scripts/sync-status.mjs` is unchanged), What's new card only for x.Y.0, details header sticky (`.dpsticky`) with a shadow once scrolled. Shared `lfmp-session.js` has `byName`: deploy it with this version.

## v1.25.1 Fix: phone "No leads yet" size: LIVE 18 Nov 2026 (Builder `f42bdf6`, KPI `8d37f1d`, Review `5bcc965`; admin-site.yml run 44186335198 green, "Changed: deploying admin-site e41d91c8b689d668" = local build of the 3 pushed commits). Live at 390 px: "No leads yet" 13px muted, counts 22px (details: Builder HANDOFF v1.16.1)

## v1.25.0 Numbers with meaning + v2 pop-ups: LIVE 18 Nov 2026 (`a20b1cb`; deploy 44174855128, fingerprint e01ae930a42cd7e2; live check in the Builder HANDOFF v1.16.0)

- Live (real data): Mahdavi 100 "▲ 809%", LFMP 97 "▲ from 0", Hedayati / Emery "No leads yet"; "Needs attention · 1" amber (notice only); bell: no alerts, one amber notice; phone What's new panel above its shade. PJ approved `--amber-seg` #8a5f12.

- Full notes: Builder HANDOFF v1.16.0. Here: `admin/firm-details.mjs` `leadTrend(k)` (last 90 vs days 91–180 from `periods.last90.previous.totalLeads`, already in kpis.json) and `severity(kind)` / `NOTICE_KINDS` (red alert vs amber notice; `tests/admin-details` fails if a bell kind is missing from the lists).
- Row: 0 leads → muted "No leads yet"; trend on the small line ("leads · 90 days ▼ 19%"); no previous number → "leads · 90 days". Bell items, row, details boxes and the "Needs attention" filter use `severity`. Changes: "No recent sync" is red in the bell; "Review mapping" is amber in the bell.
- Names: Builder record's name (by kpi slug or location ID) via shared `loadBuilderRecords()`, loaded alongside the firm files; `fname(f)` for display, `f.name` stays for index.json and commit messages.
- Phone fix: What's new panel above its shade (`.drawer-shade#newsShade{z-index:45}` below 880px); was dimmed and closed on any tap since v1.23.0.
- Shared What's new card on first visit of v1.25.0 (`whats-new.json` "1.25.0" has `title` + `summary`). Cache `lfmp-ui.css?v=2.2.0`, `admin.css?v=1.25.0`.

## v1.24.0 Admin motion: LIVE 18 Nov 2026 (`87f0717`; with Builder v1.15.0 `b51e558`, Review admin v1.8.0)

- Shared shell (`admin/lfmp-session.js` + `admin/lfmp-ui.css`, byte-identical in the 3 repos; full notes in the Builder HANDOFF v1.15.0): firm list shows the LFMP loading mark + "Loading scorecards…" (summary empty) → list fades in; 20 s or a load error → the v2 error card with "Try again" (`renderList`). Details slide in/out (0.50 s / 0.40 s); ✕, Esc, ‹ Scorecards and a click on the dim close; "Unlocking the names…" uses the mark.
- **Behaviour change (PJ approved the spec 18 Nov):** the list now dims behind the open details on desktop; click the dim or ✕ before opening another firm. `admin.css` `.drawer-shade.dshade{z-index:43}` (was `display:none`; `.drawer-shade` alone has z-index 48 and would cover the panel).
- Live 18 Nov (deploy run 44149546862, fingerprint e43af2c48828ee28): `lfmp-ui.css?v=2.1.0`, `admin.css?v=1.24.0` served; slide, dim, close checked signed in. Tests: `tests/admin-ui/run.mjs` 243 (runs with reduced motion), shell test 16; the slide itself: Builder `tests/e2e/motion.mjs`.

## v1.23.0 Redesign v2 admin: LIVE 17 Nov 2026 (`e90a85a`)

- **Live:** Pushed + team site deployed 17 Nov 2026 ~10:07 PM Manila (deploy run 44099661971, success). Live check on lfmp-admin.pages.dev, signed in, real data: Clients (2 test records), Scorecards (4 firms · all synced 10:07 PM) + bell top block (Sync every 30 min · last · next, Token keeper OK), Reviews (7 clients · 2 need you · All submissions ›); no sideways scroll, no console errors; the one-time "Update available" bar after the deploy cleared after one Refresh. Screenshots: `assets/images/2026-11-18_redesign-v2/live/`. Phone layout not seen live (Chrome window couldn't be resized and the site refuses framing); proven locally on real data with the same files (`…/real/`). **Follow-up LIVE 17 Nov (deploy run 44108208698):** avatar showed "P" live because the Google name is just "PJ"; shared `initials()` now keeps a one-word all-caps name of 2–3 letters ("PJ" → "PJ"); same file in all 3 repos (Builder `3e93748`, KPI `f6c0fb0`, Review `91b722c`). Live: "PJ" in Clients, Scorecards and Reviews (`live/2026-11-18_live-avatar-pj.jpg`).
- **PJ 17 Nov:** summary keeps "N firms · N sync problem(s)" (the reference's "all synced" was wrong when a firm shows Sync failed).

- The admin page uses the shared v2 shell (Builder HANDOFF v1.13.0): `admin/lfmp-session.js` + `admin/lfmp-ui.css` are byte-identical copies of the Builder's `page/` files (copy, never edit); `tests/shell/shell.test.mjs` identical too.
- Moved: sync times + token keeper → top of the bell panel (always shown); repo link → foot of What's new; theme / test firms / Team sign-ins / Sign out → Me; + New firm → the gold +; stats strip → summary + "Needs attention · n" filter; row buttons → the whole row opens Details (Open dashboard ↗ there). New "Test firms" filter.
- Client dashboards (`app/`, `firms/`) and `admin/moved.html` unchanged. Tests: every suite + admin-ui 243.

## State (15 Nov 2026)

| Area | State |
|---|---|
| Client dashboards (`app/`, `firms/*`) | Live, unchanged since v1.9.0 (logo from v1.8.0). Their "What's new" reads only `[client]` lines. |
| Firms | Mahdavi, LFMP, Hedayati, Emery (Private Integration tokens) and ZZ TEST 2 (app token, test sub-account). |
| Sync | Every 30 min (cron 7,37 + sync chain). The bell on the admin page reports problems. |
| Token keeper | Hourly; mints app tokens for `tokenSource: "app"` firms only. |
| Admin page v1.14.0 | **Live** (4698019, 15 Nov): one login with the Builder + Review admin, red tool colour. v1.13.1 before it (commit 3507479, 15 Nov ~04:45 UTC). Not-in-pipeline rows with email/phone/source, Remember passphrase (encrypted), Copy GHL menu link moved to Setup, local "Copied". Admin files + tests + docs only. Built on v1.13.0 (9e3ed52: simple home + Details panel, no re-login between screens). |

## v1.22.0: Slack DMs to PJ: LIVE 17 Nov 2026 (`9080da6`; secret SLACK_WEBHOOK_URL set by PJ 17 Nov ~5:51 PM, Builder "Send test alert" run #1 logged "Slack: sent")

- **What:** KPI sync problems → one Slack DM when a bell issue starts, one "Resolved" DM when it clears (`scripts/kpi-alerts.mjs`, `alerts.yml`, state in `status/alerts.json`). A failed or stopped KPI setup from the Builder → one DM (`new-firm.yml` job `alert`, `scripts/setup-alert.mjs`). Part of PJ's Slack alerts (Builder v1.12.0 has the morning summary and the "Send test alert" workflow; the Review DMs are in Code.gs v11).
- **Same as the bell:** `bellIssues()` calls the admin page's functions with the same inputs and filters with `inBadge`. `tests/alerts/run.mjs` fails if the admin page's `refreshIssues` / `listed` / `kpiSummary` stop matching, so change both together.
- **Secret:** `SLACK_WEBHOOK_URL` (LIVE: set 17 Nov 2026 09:53Z; PJ's DM only; the same webhook as the Builder's secret and the Apps Script's `SLACK_DM_WEBHOOK_URL`). Without it nothing is sent and nothing fails; the DMs start (for anything still open) once it is set.
- **When it checks:** at the end of every sync (`sync.yml` job `alerts` starts `alerts.yml`), plus `:22` / `:52` as a backup. Concurrency `slack-alerts` (one at a time). Test DM: Actions → Slack alerts → Run workflow → test = yes.
- **Known behaviour (same as the bell):** "No successful sync in 45 min" for one firm appears when GitHub skips a slot and clears on the next good sync, so a skipped slot can mean one alert DM and one Resolved DM about 30 minutes apart.
- **Stop the DMs:** delete the `SLACK_WEBHOOK_URL` secret (or disable `alerts.yml` in Actions). Nothing else depends on them.

## v1.21.0: sync memory fix + "chain stopped" hold: LIVE 17 Nov 2026 (082da14)

- **Why:** LFMP's sync failed 5 times on 15–16 Nov with "JavaScript heap out of memory" (~2 GB). Its Email export returns ~6,300 mostly outbound campaign emails with full HTML bodies per pull, and the sync kept 2–3 full pulls of every channel in memory. Only ~55 inbound emails are used.
- **Fix:** `scripts/message-slim.mjs` keeps only the fields the KPIs read as each page arrives (the "STOP" opt-out check runs there, before the body is dropped). `sync.yml` runs the sync with `NODE_OPTIONS=--max-old-space-size=4096` as a margin. Each job's log ends with "Peak memory: N MB".
- **Proof the numbers didn't move:** `tests/slim-verify/run.mjs` ran the old sync against GHL through a recording proxy, then the new sync on the same recorded answers at a frozen clock, and compared kpis.json, the decrypted details and the sync result field by field. LFMP and Mahdavi: IDENTICAL; LFMP peak memory 1,652 MB → 449 MB. The workflow that runs it lived only on a temporary `verify/*` branch (deleted; `git show 17097ee:.github/workflows/verify-slim.yml`). Reuse it for any change that should not move the numbers.
- **First live sync on it (18:37 UTC, 16 Nov run 43930696750):** all 5 firms OK; LFMP 4 min 42 s, Email pulls 6,271 / 6,271, no errors or warnings. Bell afterwards: 0 alerts.
- **Bell:** "Sync chain stopped" is held only while the LAST sync run is queued or running on GitHub, and raised anyway after 2 hours (`chainAlive` in `scripts/sync-status.mjs`, tested in `tests/status`). On 16 Nov GitHub kept a queued sync waiting an hour (16:07 → 17:07 UTC), which raised "no successful sync in 45+ min" (correct) and "chain stopped" (wrong).
- **Not changed (checked):** GHL's export has no direction filter, so outbound campaign emails can't be skipped. It accepts `startDate`/`endDate` and `limit` up to 1,000. The 2–3 pulls per channel guard against GHL's changing subsets; with memory fixed they only cost time and calls. To cut them, first test `startDate` + bigger pages read-only with `diag-export.yml`.

## v1.20.0: Sign out button, Last signed in, Team sign-ins: 17 Nov 2026

- Sign out sits next to the name (`#whoChip`, phone: ⋯) and ends the Google sign-in for all three tools (`signOut()` in the shared `lfmp-session.js`: Cloudflare Access logout → `/signin/?out=1`; never the team-domain logout, which answered "Failed to log out." live). "Last signed in …" under the name (`[data-me-last]`); ⋯ → Team sign-ins. Sign-ins are kept on the team site's server only (KV, 90 days). admin-ui 220/220. Details: Builder HANDOFF v1.8.0.

## v1.19.0: Google sign-in only: LIVE 17 Nov 2026

- No admin password, vault or GitHub token in the browser. Cloudflare Access (Google) signs people in; `admin/lfmp-session.js` asks the team site's server (`/api/`, Builder repo `admin-site/lib/api.mjs`) who you are, and every GitHub call goes through `/api/gh` with the server's token and allow-list. The shared-password sections below (One login, sessions, `set-shared-password.mjs`, `lfmp-lock.json`) are history: those files were removed.
- **Passphrases:** stored on the server, encrypted (AES-GCM, Cloudflare KV `KPI_PASS`, key `PASS_KEY`), one per firm. New firm saves it automatically; Details → "Remember for the team" / "Forget it" for existing firms. On 17 Nov the store was empty (old passphrases lived in each browser's vault).
- **Commits** made from the admin say the first name only (public repo). Rollback: see the Builder HANDOFF v1.7.0.

## v1.17.0–v1.18.0: admin on the team site only: LIVE 16 Nov 2026

- The admin runs only at **https://lfmp-admin.pages.dev/leadpro-kpi/admin/** (Cloudflare Pages in PJ's account, behind Access / Google sign-in), deployed by the Builder repo's `admin-site.yml`.
  - That workflow copies `admin/` (without `moved.html`), the 7 browser modules in `scripts/` (changelog, config-merge, keeper-status, sync-status, not-in-pipeline, scope-check, kpi-core), `brand/` and `CHANGELOG.md`.
  - **After pushing admin files, run the deploy:** `gh workflow run admin-site.yml -R peejayedz/ghl-subaccount-builder`. The daily 07:23 UTC run catches anything missed.
  - Don't add an import from another folder without adding it to `KPI_MODULES` in the Builder's `scripts/admin-site/assemble.mjs`. The assemble refuses to deploy a missing file.
- On the team site, `DATA_ROOT` = `PAGES`: a firm's `details.enc.json` is read from the public site, which holds the live data.
- **Public address:** a first script in `admin/index.html` sends github.io / lawfirmmarketingpros.com visitors to `admin/moved.html`, the shared Moved screen. It's a byte-identical copy of the Builder's `admin-site/moved.html`, checked by the Builder unit test. Local tests (127.0.0.1) are unaffected.
- Commits `c925528` (v1.17.0), `3aeef16` (v1.18.0). Live check 16 Nov:
  - old addresses show Moved and the admin never starts there;
  - client dashboards byte-identical before/after;
  - PJ signed in and the admin works on the team site.

## v1.16.0: new address: LIVE 16 Nov 2026

- Admin and dashboards are served at `https://dashboard.lawfirmmarketingpros.com/leadpro-kpi/…` (custom domain of the user site `peejayedz.github.io`). Old `peejayedz.github.io/leadpro-kpi/…` links 301 there with `#k=` kept.
- Commit `c94fc5d`. Live: served files = pushed; admin sign-in screen at 1440/390 light/dark with no errors or failed requests; Mahdavi, LFMP and ZZ TEST 2 dashboards 200, and they load framed like GHL's Embedded Page.
- Admin `PAGES` = new address for owner peejayedz (Dashboard ↗, Copy GHL link, new-firm result). `scripts/ghl-menu.mjs` `PAGES` = new address: new firms get new-address menu links, and the guard accepts only that prefix.
- **Existing GHL menu links stay on the old address** (PJ, 16 Nov). Read 16 Nov: LFMP, Mahdavi and Emery are **Embedded Page**, ZZ TEST 2 is New tab; Hedayati has none.
- Cloudflare Access (Phase 6) will protect `/leadpro-kpi/admin/` only. `/leadpro-kpi/firms/…` stays public.
- Browser storage is per origin: remembered passphrases, the sealed GitHub token and the session must be set up again once on the new address.

## One login + tool colours: LIVE 15 Nov 2026

- **LIVE 15 Nov 2026:** leadpro-kpi `4698019`, automation-review `c5efbc8` (admin/ only), builder `1ec8cd9`, page repo `a09f070`. PJ set the shared password (the three `lfmp-lock.json` are identical, sha256 `2cd9ab56…`). PJ chose **option A**: a new tab asks once (sessionStorage); no localStorage key.
- **Live check (24/24, `assets/code/2026-11-15_one-login_live-check.mjs`):** deployed files = pushed files for all three tools; client pages (review index/plan/messages/config, KPI dashboard) unchanged live; the real sign-in on all three at 1440/390 light/dark (every file 200, fonts, no console errors); deployed code on the real site with a test lock + mocked GitHub/Apps Script: sign in once, KPI admin → Review → client Details (admin mode) → Back → Clients → KPI admin → Back with no password, Lock on the Builder locks the other two and removes `ar_admin_key`, client pages never read the vault. Screenshots: `assets/images/2026-11-15_one-login_live/`.
- **Not yet seen with PJ's own sign-in:** the real GitHub token in the vault, the real review ADMIN_KEY, and the real Sheet in the Review admin list. First steps for PJ: sign in, paste the GitHub token once (Builder or KPI admin), add the review admin key once on the Review page.
- **Page repo publish now also copies** `lfmp-login.js`, `lfmp-login.css`, `lfmp-lock.json` (as well as the v1.1.0 list). `page/brand/wpp-logo*.png` are not published (nothing loads them).

Builder v1.2.0 · KPI admin v1.14.0 · Automation Review admin v1.0.0 (new `automation-review/admin/`). Prompt: builder `Claude outputs/design-wc6/One_Login_Tool_Colours_Prompt.md`.

- **Shared files (keep byte-identical in builder `page/`, leadpro-kpi `admin/`, automation-review `admin/`):** `lfmp-login.js`, `lfmp-login.css`, `lfmp-ui.css` (+ `fonts/`), and `lfmp-lock.json` once PJ sets the password. `tests/one-login` checks the three copies match.
- **How it works:** `lfmp-lock.json` = { salt, 210k iterations, verifier }, written by `node scripts/set-shared-password.mjs` (leadpro-kpi; hidden prompt, also the reset). Vault = localStorage `lfmp-vault` (AES-GCM): `gh` (GitHub token for Builder + KPI admin) and `reviewKey` (Automation Review ADMIN_KEY). Session = sessionStorage `lfmp-session` (key only, 30 min idle). `lfmp-lock-at` = Lock in any tool/tab. `lfmp-login-guard` = wrong-password count + pause end (5 → 2 min). The old per-page locks were removed on 15 Nov (Builder v1.3.0, KPI admin v1.15.0, Review admin v1.1.1) after PJ signed in for real; without `lfmp-lock.json` every tool shows "Sign-in not ready".
- **Review admin (PJ chose, 15 Nov):** new page `automation-review/admin/`; client pages untouched. While unlocked it writes `ar_admin_key` (where index.html already looks), so "Details →" and "All submissions →" open the existing pages in admin mode; every lock removes it. Trade-off: those inner pages keep their own look (no LFMP top bar); the key sits in localStorage while unlocked (as before); an idle lock only removes it when an admin tool notices.
- **Colours:** band/chip/underline/headline accent per tool, in each page's own CSS (`--tool`, `--tool-ink`, `--bg`). Light text needs darker shades for AA: Builder `#8a5d15` (not `#a8741f`, 3.6:1) and Review `#1b746f` (not `#1f7f7a`, 4.29:1); bands/borders keep the spec colours. KPI page: every problem shows ✕ / ! + words.
- **Fixes on the way:** KPI admin Lock never ran its cleanup (calls were inside a comment); locking while a page was still loading showed "Couldn't unlock: …".
- **Tests (all green 15 Nov):** builder `tests/e2e/one-login.mjs` 47 (three tools on one local site, real Code.gs), builder unit 155, e2e 63, design 46, review 149/56/44, kpi 72, oauth 72; leadpro-kpi all suites incl. admin-ui 184 and `tests/one-login` 8. Screenshots: `assets/images/2026-11-15_one-login-tool-colours_v2/`. Logs: `assets/data/2026-11-15_one-login-test-logs/`.
- **Went live in this order:** (1) PJ runs `node scripts/set-shared-password.mjs` in leadpro-kpi (writes the 3 lock files). (2) Push leadpro-kpi, automation-review (admin/ only), builder + copy `page/lfmp-login.js`, `page/lfmp-login.css`, `page/lfmp-lock.json` with the other page files to the page repo. Ask PJ before each push. (3) PJ signs in, pastes the GitHub token once, adds the review admin key once on the Review page. (4) Live check: lock screens at 1440/390 light/dark, then PJ's own unlock across the three tools.
- **New tabs (decided, option A):** a tool opened in a new tab asks once; keep it that way unless PJ says otherwise.

## Admin page v1.13.1

- **Remembered passphrases:** `leadpro-admin-firm-pass` in localStorage = one AES-GCM blob `{ slug: passphrase }`, sealed with the same key as the GitHub token (`readPassVault` / `writePassVault` in `admin/index.html`). Lock (the ⋯ menu) and Forget token clear it; the idle lock doesn't. Order used to open a firm's details: typed → remembered → the client dashboard's `lfmp-pass-<slug>`. When the one-login vault is built, move this blob into it.
- **Contact rows** come from `notInPipelineList` (`admin/firm-details.mjs`): name, email, phone, `source` (short label from the sync's `via`), `named` (false → the email or phone stands in). Nothing new is written by the sync; email/phone/via were already in `details.enc.json`.
- **"Copied"** uses `flashCopied(btn)`: next to the clicked button only, 4 s. Don't route it through `firmSay` (that writes to the row and the panel).
- **Decided (PJ, 15 Nov):** the 30-minute idle lock keeps remembered passphrases; only Lock (by hand) and Forget token clear them.

## Release checks (v1.13.1, 15 Nov)

- Before push: all 11 suites pass (`tests/admin-details` 44 checks, `tests/admin-ui` 184 browser checks against a mock GitHub). No file changed in `app/`, `firms/`, `status/`, `brand/`, `scripts/` or `.github/`. Screenshots (1440 + 390, light + dark): `assets/images/2026-11-15_kpi-admin-v1.13.1/` in the LFMP workspace.
- Live (Pages build of 3507479): the deployed `admin/index.html`, `admin.css`, `firm-details.mjs` and `whats-new.json` are byte-identical to the commit; the real lock screen at 1440 and 390 in dark and light loads every file (200), both fonts, no console errors. The deployed code with a mock GitHub API, the repo's real public data and a fixture encrypted file passed 40 more checks in all four views: button order, rows with email/phone/source and the no-name fallback, Remember (encrypted, names straight away after a reload, cleared by Lock), Copy GHL menu link in Setup with "Copied" only by the button, gone after 4 s, no page errors, no sideways scroll. Screenshots in `…/2026-11-15_kpi-admin-v1.13.1/live/`; the check script is `assets/code/2026-11-15_kpi-admin-v1.13.1_live-check.mjs` in the LFMP workspace (`node <script> <path-to-leadpro-kpi> <shots-folder>`, needs CHROMIUM_PATH).
- **Not yet seen with PJ's own unlock:** the real GitHub API, and LFMP's real encrypted contacts (names, emails, phones). First real use of Remember is also on PJ's machine.

## Admin page v1.13.0 (simple home + Details panel)

- Files: `admin/firm-details.mjs` (needs-attention reasons, the not-in-pipeline list, Performance numbers and goal rules; pure, tested by `tests/admin-details`), `admin/index.html` (routing, session, list, panel), `admin/admin.css`. `admin/lfmp-ui.css` is unchanged (same hash as below).
- **Screens** switch in the page by URL hash: `#/`, `#/new`, `#/map/<slug>`, `#/firm/<slug>[/performance|/setup]`. Use `go(hash, flash)` to move between screens; never re-render a screen directly (that's what made Back leave the page).
- **Session:** after unlocking, the AES key that opens the saved GitHub token sits in sessionStorage (`leadpro-admin-session`, with a last-activity time). Lock, closing the tab, or 30 min without activity end it. Password and token are never stored in it.
- **Performance** reads `firms/<slug>/data/kpis.json` only. Its Going well / Needs attention copy the dashboard's `GOALS` and rules; `tests/admin-details` fails if `app/dashboard.html`'s `GOALS` change without this file.
- **Not in a pipeline:** names come from decrypting `details.enc.json` in the browser, with the passphrase the client dashboard saved on this device (`lfmp-pass-<slug>`) or one typed in the panel. Nothing new is written by the sync; the IDs were already in the encrypted file. Names stay in memory only.

## Release checks (v1.13.0, 15 Nov)

- All 11 suites pass (incl. new `tests/admin-details`, 38 checks) and 155 browser checks against a mock GitHub. The 69 client-side files are byte-identical before and after (`assets/docs/2026-11-15_kpi-admin-v1.13_client-hashes-*.sha256` in the LFMP workspace); the commit touches only `admin/`, `tests/`, README, CHANGELOG.
- Live: the deployed page (Pages build done, every file 200, fonts loaded, no console errors) checked at 1440 and 390 in light and dark: the real lock screen, plus the deployed code with a mock GitHub API reading the repo's real data (the real API needs PJ's password). New firm → All firms and Back stayed unlocked. Screenshots: `assets/images/2026-11-15_kpi-admin-v1.13/` (`live/` for the deployed page).
- **Not yet seen with PJ's own unlock:** the live page on the real GitHub API, and the "lead not in a pipeline" names from LFMP's real encrypted file.

## Admin page v1.12.0 (KPI admin redesign)

- Files: `admin/index.html` (page + script), `admin/lfmp-ui.css` (shared with the builder: keep it generic and identical in both repos), `admin/admin.css`, `admin/fonts/` (+ `OFL.txt`), `admin/app-path.mjs` (app path), `admin/news.mjs` + `admin/whats-new.json` (What's new cards).
- **Every new version:** add its CHANGELOG lines (as always) and a plain entry in `admin/whats-new.json` (summary + new/improved/fixed items). Without one, the card falls back to wording made from the changelog.
- The app path writes only `PASSPHRASE_<KEY>` and starts `new-firm.yml` (a Retry may start `sync.yml`). It never touches Private Integration firms and refuses a location that already has a firm.
- No sub-account picker in New firm: the admin's GitHub token can't read the agency's sub-accounts, and this repo is public (no list may be stored in it). The location ID is pasted.
- Colour choices made for AA: light-mode gold buttons use dark text (#141108 on #a8741f = 4.65:1; white would be 4.05). Gold text in light mode uses #8a5d15. Light green/red text: #26754e / #b3392f.

## Release checks (v1.12.0)

- **Before push (K1):** all 9 test suites pass, plus 95 browser checks against a mock GitHub (every control, AA contrast in both themes, no sideways scroll at 390 px). The 69 client-side files (`app/`, `firms/`, `status/`, `brand/`, `scripts/`, `.github/`) are byte-identical before and after. Screenshots and hash lists are in the LFMP workspace: `assets/images/2026-11-15_kpi-admin-k1/` and `assets/docs/2026-11-15_kpi-admin-k1_client-hashes-*.sha256`.
- **Live (K2), 14 Nov:**
  - The page loads in dark and light, with both self-hosted fonts and every file returning 200, and no console errors.
  - After PJ unlocked it, the firm list showed live data.
  - **Live app-path test (PJ chose the refusal test on ZZ TEST 2):** New firm → Use the LeadPro app with ZZ TEST 2's location (`bZ8sYUlHFufn3rH3TXip`) was refused: "This location already has a firm: ZZ TEST 2." Before/after checks on GitHub showed nothing written: 16 secrets with unchanged dates, no new-firm.yml run, `firms/index.json` and `firms/zz-test-2/config.json` unchanged.
- **Not yet proven live through the admin page:** a full app-path run. It uses the same `new-firm.yml` that the builder ran live on 13 Nov (ZZ TEST 2). The first real new firm made from the admin page is its first full live run; watch its steps.

## Open items

- The builder redesign will copy `admin/lfmp-ui.css` (sha256 `6e67f091ad94633c46af9cea39c199c62383a774279a984dbef35b86e4a890fb`) and `admin/fonts/` as they are.
- The dashboards' footer now shows v1.12.0 (it reads the latest version from CHANGELOG.md). Their What's new is unchanged because v1.12.0 is internal only.
