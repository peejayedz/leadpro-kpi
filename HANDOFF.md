# LeadPro KPI: handoff notes

The README is the full reference and CHANGELOG.md the history. This file covers where the work stands and what to know before changing things.

## State (15 Nov 2026)

| Area | State |
|---|---|
| Client dashboards (`app/`, `firms/*`) | Live, unchanged since v1.9.0 (logo from v1.8.0). Their "What's new" reads only `[client]` lines. |
| Firms | Mahdavi, LFMP, Hedayati, Emery (Private Integration tokens) and ZZ TEST 2 (app token, test sub-account). |
| Sync | Every 30 min (cron 7,37 + sync chain). The bell on the admin page reports problems. |
| Token keeper | Hourly; mints app tokens for `tokenSource: "app"` firms only. |
| Admin page v1.12.0 | **Live** (commit 0c5be7f, 14 Nov 17:48 UTC). Redesigned (LFMP look) + "Use the LeadPro app" in New firm. |

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
