# LeadPro KPI: handoff notes

The README is the full reference and CHANGELOG.md the history. This file covers where the work stands and what to know before changing things.

## State (15 Nov 2026)

| Area | State |
|---|---|
| Client dashboards (`app/`, `firms/*`) | Live, unchanged since v1.9.0 (logo from v1.8.0). Their "What's new" reads only `[client]` lines. |
| Firms | Mahdavi, LFMP, Hedayati, Emery (Private Integration tokens) and ZZ TEST 2 (app token, test sub-account). |
| Sync | Every 30 min (cron 7,37 + sync chain). The bell on the admin page reports problems. |
| Token keeper | Hourly; mints app tokens for `tokenSource: "app"` firms only. |
| Admin page v1.12.0 | Redesigned (LFMP look) + "Use the LeadPro app" in New firm. Built and tested locally (STOP K1); **not pushed yet**. |

## Admin page v1.12.0 (KPI admin redesign)

- Files: `admin/index.html` (page + script), `admin/lfmp-ui.css` (shared with the builder: keep it generic and identical in both repos), `admin/admin.css`, `admin/fonts/` (+ `OFL.txt`), `admin/app-path.mjs` (app path), `admin/news.mjs` + `admin/whats-new.json` (What's new cards).
- **Every new version:** add its CHANGELOG lines (as always) and a plain entry in `admin/whats-new.json` (summary + new/improved/fixed items). Without one, the card falls back to wording made from the changelog.
- The app path writes only `PASSPHRASE_<KEY>` and starts `new-firm.yml` (a Retry may start `sync.yml`). It never touches Private Integration firms and refuses a location that already has a firm.
- No sub-account picker in New firm: the admin's GitHub token can't read the agency's sub-accounts, and this repo is public (no list may be stored in it). The location ID is pasted.
- Colour choices made for AA: light-mode gold buttons use dark text (#141108 on #a8741f = 4.65:1; white would be 4.05). Gold text in light mode uses #8a5d15. Light green/red text: #26754e / #b3392f.

## Open items

- STOP K2 (after PJ's OK): push, check the live admin page in both themes, one live app-path test on a test sub-account PJ chooses (or skip), then the project handoff update.
- The builder redesign will copy `admin/lfmp-ui.css` and `admin/fonts/` as they are.
