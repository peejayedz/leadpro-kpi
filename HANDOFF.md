# LeadPro KPI: handoff notes

The README is the full reference and CHANGELOG.md the history. This file covers where the work stands and what to know before changing things.

## v1.23.0 Redesign v2 admin: LIVE 17 Nov 2026 (`e90a85a`)

- **Live:** Pushed + team site deployed 17 Nov 2026 ~10:07 PM Manila (deploy run 44099661971, success). Live check on lfmp-admin.pages.dev, signed in, real data: Clients (2 test records), Scorecards (4 firms · all synced 10:07 PM) + bell top block (Sync every 30 min · last · next, Token keeper OK), Reviews (7 clients · 2 need you · All submissions ›); no sideways scroll, no console errors; the one-time "Update available" bar after the deploy cleared after one Refresh. Screenshots: `assets/images/2026-11-18_redesign-v2/live/`. Phone layout not seen live (Chrome window couldn't be resized and the site refuses framing); proven locally on real data with the same files (`…/real/`). **Follow-up, committed locally, NOT PUSHED:** avatar showed "P" live because the Google name is just "PJ"; shared `initials()` now keeps a one-word all-caps name of 2–3 letters ("PJ" → "PJ"); same file in all 3 repos.
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
