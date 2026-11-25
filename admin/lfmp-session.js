// LFMP tools sign-in (v2, Google only). Replaces lfmp-login.js (shared password + browser vault), 16 Nov 2026.
// Keep the three copies byte-identical: ghl-subaccount-builder page/, leadpro-kpi admin/, automation-review admin/.
//
// The tools run only on lfmp-admin.pages.dev, behind Cloudflare Access (Google sign-in). There is no password and no key
// in the browser: the GitHub token, the Review admin key and the remembered KPI passphrases live on the team site's
// server (/api/, admin-site/lib/api.mjs in the builder repo), which checks the Google sign-in on every call.
//   const me = await startSession();            // { email, name, first, lastSignIn } or sends you to /signin/
//   const r = await ghFetch('GET', '/repos/…')  // a Response with GitHub's status and body (allow-listed calls only)
//   await api('review', { action, … })          // other /api/ calls; throws ApiError on a refusal
//   signOut()                                   // Cloudflare Access logout (ends the Google sign-in for all three tools)
//                                               // → /signin/?out=1 "You've been signed out."
//   paintMe(me)                                 // fills [data-me] (name), [data-me-email], [data-me-last] ("Last signed in …")
//   openTeamSignins()                           // the ⋯ → Team sign-ins dialog (any [data-act="signins"] opens it)

import * as DN from './lfmp-done.js';   // v2.10.0 Done moments (popup + sound + voice; Classic = off); v2.11.0 On / Off
export const TOOLS = [
  { id: 'builder', name: 'Builder', path: '/ghl-subaccount-builder-page/' },
  { id: 'kpi', name: 'Scorecards', path: '/leadpro-kpi/admin/' },
  { id: 'review', name: 'Review', path: '/automation-review/admin/' },
];
export const SIGNIN = '/signin/';
export const LOGOUT = '/cdn-cgi/access/logout';   // Cloudflare Access logout (ends the Access session)
export const SIGNED_OUT = '/signin/?out=1';
const API_BASE = '/api/';
// v2.4.1: the greeting reads the other two tools' counts with their greet-count modules, which can bring a second copy of
// this file (their own folder's lfmp-session.js) into the page. Only the first copy on a page adds the page-wide listeners.
const FIRST_COPY = typeof document !== 'undefined' && !globalThis.__lfmpShellListeners && (globalThis.__lfmpShellListeners = true);

// Left over from the password login (v1.x): the vault (GitHub token + Review key, sealed), the session key, lock and
// guard markers, the Review page's admin key copy, the old per-page tokens, the remembered-passphrase vault and the
// typed "Created by" name. Removed on every page load: nothing secret stays in the browser.
export const LEGACY_LOCAL = ['lfmp-vault', 'lfmp-lock-at', 'lfmp-login-guard', 'ar_admin_key', 'sab-gh-token', 'leadpro-admin-gh-token', 'leadpro-admin-firm-pass', 'sab-created-by'];
export const LEGACY_SESSION = ['lfmp-session', 'leadpro-admin-session'];
export function clearLegacy() {
  for (const k of LEGACY_LOCAL) { try { localStorage.removeItem(k); } catch {} }
  for (const k of LEGACY_SESSION) { try { sessionStorage.removeItem(k); } catch {} }
}

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; }
}

let leaving = false;
export function toSignIn() {
  if (leaving) return;
  leaving = true;
  location.assign(`${SIGNIN}?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
}
// Sign out: Cloudflare Access logout on this site (that response ends the Access session and clears its cookie), then
// /signin/?out=1 ("You've been signed out. See you next shift."). Not the team-domain logout as well: live (17 Nov) it
// answered "Failed to log out." right after this one, because the session was already gone.
// v2.4.1: a deliberate Sign out forgets "greeted today", so signing back in plays the greeting again (even the same day).
// Only here: an expired session (toSignIn), Cloudflare renewing it, reloads and tool switches keep the mark.
export async function signOut() {
  clearLegacy(); forgetGreetingDay(); leaving = true;
  try { await fetch(LOGOUT, { credentials: 'same-origin', redirect: 'manual', cache: 'no-store' }); } catch {}
  location.assign(SIGNED_OUT);
}

// "Sun 16 Nov, 11:37 PM" in the viewer's own time zone.
export function fmtSignIn(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute} ${p.dayPeriod}`;
}
export function lastSignInText(me) {
  return me && me.lastSignIn ? `Last signed in ${fmtSignIn(me.lastSignIn)}` : 'First sign-in on record';
}
export function paintMe(me, root = document) {
  for (const el of root.querySelectorAll('[data-me]')) el.textContent = me.name || me.email;
  for (const el of root.querySelectorAll('[data-me-email]')) el.textContent = me.email;
  for (const el of root.querySelectorAll('[data-me-last]')) {
    el.textContent = lastSignInText(me);
    el.title = me.lastSignIn ? new Date(me.lastSignIn).toString() : 'No earlier sign-in in the last 90 days';
  }
}

// ⋯ → Team sign-ins: everyone who signed in in the last 90 days (name, email, last sign-in, sign-ins in 30 days).
// v2.7.0: a browser that blocks site storage throws on the localStorage read itself; every default store goes through this
export const safeStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// The Team sign-ins body. v2.11.0 (queue item 10): when the answer carries changes: [{ who, what, at }] (the Builder's
// Reports key changes: who saved / replaced / removed which key, never a value), a second small table "Reports key changes
// (last 90 days)" goes under the people; missing or empty = nothing extra (KPI admin / Review admin unchanged).
export function signinsHtml({ people = [], changes = [] } = {}) {
  const ppl = Array.isArray(people) ? people : [], ch = (Array.isArray(changes) ? changes : []).slice(0, 50);
  const changesHtml = ch.length ? `<p class="ey lfmp-signins-sub" style="margin:22px 0 8px">Reports key changes (last 90 days)</p><table class="lfmp-signins lfmp-keychanges"><thead><tr><th scope="col">Who</th><th scope="col">What</th><th scope="col">When</th></tr></thead><tbody>${ch.map(c => `<tr><td data-l="Who"><b>${escH(c?.who)}</b></td><td data-l="What">${escH(c?.what)}</td><td data-l="When">${escH(fmtSignIn(c?.at))}</td></tr>`).join('')}</tbody></table>` : '';
  return `<div class="lfmp-dlg-b">${ppl.length ? `<table class="lfmp-signins"><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Last sign-in</th><th scope="col">Sign-ins (30 days)</th></tr></thead><tbody>${ppl.map(p => `<tr><td data-l="Name"><b>${escH(p.name)}</b></td><td data-l="Email">${escH(p.email)}</td><td data-l="Last sign-in">${escH(fmtSignIn(p.last))}</td><td data-l="Sign-ins (30 days)">${Number(p.count30) || 0}</td></tr>`).join('')}</tbody></table>` : '<p class="mut">No sign-ins recorded yet.</p>'}${changesHtml}<p class="mut lfmp-dlg-note">Google sign-ins to the LFMP tools in the last 90 days. Kept on the team site only, never in a repo.</p></div>`;
}
export async function openTeamSignins() {
  let d = document.getElementById('lfmpSignins');
  if (!d) {
    d = document.createElement('dialog');
    d.id = 'lfmpSignins'; d.className = 'lfmp-dlg'; d.setAttribute('aria-labelledby', 'lfmpSigninsTitle');
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-lfmp-close]')) d.close(); });
    document.body.append(d);
  }
  const head = `<div class="lfmp-dlg-h"><div><p class="ey">Team</p><h2 id="lfmpSigninsTitle">Team sign-ins</h2></div><button class="btn" type="button" data-lfmp-close aria-label="Close">Close</button></div>`;
  d.innerHTML = `${head}<p class="mut lfmp-dlg-b">Loading…</p>`;
  if (!d.open) d.showModal();
  try {
    d.innerHTML = `${head}${signinsHtml(await api('signins'))}`;
  } catch (e) {
    d.innerHTML = `${head}<p class="lfmp-dlg-b lfmp-err" role="alert">${escH(e.message || "Couldn't load the sign-ins.")}</p>`;
  }
  d.querySelector('[data-lfmp-close]')?.focus();
}
if (FIRST_COPY) document.addEventListener('click', e => { if (e.target.closest?.('[data-act="signins"]')) openTeamSignins(); });

// One POST to /api/<name>. redirect: 'manual' so an expired Google sign-in (Access answers with a redirect to its login
// page) shows up as "signed out" instead of a confusing network error.
async function post(name, body) {
  let r;
  try {
    // v2.3.0: through lfmpFetch, so the gold line under the top bar shows while any request is in flight
    r = await lfmpFetch(`${API_BASE}${name}`, { method: 'POST', redirect: 'manual', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body ?? {}) });
  } catch { throw new ApiError(0, 'network', "Couldn't reach the LFMP tools site. Check your internet connection."); }
  if (r.type === 'opaqueredirect' || (r.status >= 300 && r.status < 400)) { toSignIn(); throw new ApiError(401, 'not_signed_in', 'Your Google sign-in ended. Sign in again.'); }
  return r;
}
// The server's own refusals carry X-LFMP-Error (GitHub's answers never do). 401 = signed out → the sign-in page.
async function refusal(r) {
  const code = r.headers.get('X-LFMP-Error');
  if (!code) return null;
  let msg = '';
  try { msg = (await r.json()).message || ''; } catch {}
  if (r.status === 401) toSignIn();
  return new ApiError(r.status, code, msg || `Refused (${code}).`);
}

export async function api(name, body) {
  const r = await post(name, body);
  const e = await refusal(r);
  if (e) throw e;
  if (!r.ok) throw new ApiError(r.status, 'http', `The LFMP tools site answered ${r.status}.`);
  return r.json();
}

// GitHub through the team site: same status codes and bodies as api.github.com, so the tools' error handling is unchanged.
// raw: true asks for a file's text (contents API).
export async function ghFetch(method, path, body, { raw = false } = {}) {
  const r = await post('gh', { method, path, ...(body != null ? { body } : {}), ...(raw ? { raw: true } : {}) });
  const e = await refusal(r);
  if (e) throw e;
  return r;
}

let mePromise = null;
export function startSession() {
  clearLegacy();
  return (mePromise ||= api('me').catch(e => { mePromise = null; throw e; }));
}

// =====================================================================================================================
// v2 SHELL (redesign v2, Nov 2026). The top bar, the Me menu (desktop popover / phone screen), the bottom tabs and the
// list look are built here ONCE for all three tools, with the CSS in lfmp-ui.css (under <html class="lfmp-v2">).
//   const shell = mountShell({ tool: 'builder', me, root: appView, plus: { label: 'New sub-account', onClick },
//     version: '1.13.0', onNews, newsDot, onRefresh, showTests: { on: false, onChange }, onHome,   (Me is the same in all three tools)
//     bell: { onClick } });
//   shell.setBell(n) · shell.setUpdated('4:57 PM') · shell.setNewsDot(true) · shell.setShowTests(v) · shell.openMe()
//   pageHeadHtml({...}) · rowHtml({...}) build the page title, search, filter and list rows in the same look.
// The pure *Html functions return strings (unit-tested in tests: shell.test.mjs, identical in all three repos).
// =====================================================================================================================
// v2.12.0 (queue item 14): the Builder's Reports settings, from every tool's name menu / Me screen
export const REPORTS_SETTINGS_URL = '/ghl-subaccount-builder-page/#reports/settings';
const RS_COUNT_URL = '/api/reports/catalog?connected=1';   // a team-site function (names only, no call to any source)
export const RS_TOTAL = 5;
export const reportsSettingsValue = n => (Number.isInteger(n) ? `${n} of ${RS_TOTAL} connected ›` : '›');
export const SHELL_TOOLS = [
  { id: 'builder', label: 'Clients', title: 'Clients', path: '/ghl-subaccount-builder-page/', plus: 'New sub-account',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg>' },
  { id: 'kpi', label: 'Scorecards', title: 'Scorecards', path: '/leadpro-kpi/admin/', plus: 'New firm',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 20V11M12 20V5M18 20v-6"/></svg>' },
  { id: 'review', label: 'Reviews', title: 'Reviews', path: '/automation-review/admin/', plus: null,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>' },
  // v2.9.0 (LeadPro Reports, PJ 21 Nov): the 4th tool. It lives in the Builder page (#reports): the clients' report
  // connections; each client's editor is the Builder's Client details → Reports tab.
  { id: 'reports', label: 'Reports', title: 'Reports', path: '/ghl-subaccount-builder-page/#reports', plus: 'Add client',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20h16"/><path d="M6 16l4-5 3 3 5-7"/><path d="M15 7h3v3"/></svg>' },
];
export const ME_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>';
export const SEARCH_ICON = '<svg class="lv-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>';
export const PHONE_MAX = 879.98;   // phone layout below 880px (same as lfmp-ui.css)
export const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']];   // v2.4.0: the preview's order
export const esc = escH;
const toolOf = id => SHELL_TOOLS.find(t => t.id === id) || SHELL_TOOLS[0];

// "Pee Jay Edrozo" → "PJ", "PJ Tester" → "PT", a one-word name that is already initials ("PJ") → "PJ", "pj@x.com" → "P"
export function initials(me) {
  const words = String(me?.name || me?.email || '').replace(/@.*/, '').trim().split(/\s+/).filter(Boolean);
  if (me?.name && words.length === 1 && /^[A-Z]{2,3}$/.test(words[0])) return words[0].slice(0, 2);
  return words.slice(0, 2).map(w => w[0]).join('').toUpperCase() || '·';
}

// Theme: Auto = no data-theme and nothing saved (follows the system); Light / Dark saved under "lfmp-theme".
export function getTheme() {
  try { const t = localStorage.getItem('lfmp-theme'); return t === 'light' || t === 'dark' ? t : 'auto'; } catch { return 'auto'; }
}
export function setTheme(mode) {
  const m = mode === 'light' || mode === 'dark' ? mode : 'auto';
  try { if (m === 'auto') localStorage.removeItem('lfmp-theme'); else localStorage.setItem('lfmp-theme', m); } catch {}
  if (typeof document !== 'undefined') {
    if (m === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', m);
    document.dispatchEvent(new CustomEvent('lfmp-theme', { detail: m }));
  }
  return m;
}

const avHtml = me => `<span class="lv-av">${escH(initials(me))}</span>`;   // initials only (no dot: not in the reference)
const bellHtml = (n, label = 'Notifications') => `<span class="lv-bellwrap" data-lv-bellwrap><button type="button" class="lv-bell lv-hit" data-lv="bell" aria-haspopup="dialog" aria-expanded="false" aria-label="${escH(label)}${n ? `: ${n}` : ''}"><span class="lv-bi" aria-hidden="true">🔔</span><b class="lv-badge" data-lv-badge${n ? '' : ' hidden'}>${Number(n) || 0}</b></button></span>`;

// The initials circle + its menu (v2.4.0: the bar has no name and no Sign out; they are in this menu).
const avWrapHtml = (me, where) => `<span class="lv-avwrap" data-lv-avwrap="${where}"><button type="button" class="lv-avbtn${where === 'phone' ? ' lv-hit' : ''}" data-lv="me" aria-haspopup="menu" aria-expanded="false" aria-label="Your menu: name, theme, what's new, sign out">${avHtml(me)}</button><div class="lv-pop" data-lv-pop role="menu" aria-label="Your menu" tabindex="-1" hidden></div><span class="lv-mhint" data-lv-mhint aria-hidden="true" hidden>Your menu ›</span></span>`;

// Desktop top bar: icon + LFMP · Clients / Scorecards / Reviews / Reports · [bell] · gold + · initials (they open the name menu)
export function topBarHtml(cfg) {
  const t = toolOf(cfg.tool), me = cfg.me || {};
  return `<header class="lv-top" data-lv-top>
  <a class="lv-mk" href="${t.path}" data-lv-home aria-label="LFMP · ${escH(t.label)}"><i></i><i></i><i></i></a><a class="lv-brand" href="${t.path}" data-lv-home>LFMP</a>
  <nav class="lv-nav" aria-label="LFMP tools">${SHELL_TOOLS.map(x => `<a href="${x.path}"${x.id === t.id ? ' aria-current="page" data-lv-home' : ''}>${x.label}</a>`).join('')}</nav>
  <div class="lv-rt">${cfg.bell ? bellHtml(cfg.bellCount, cfg.bell.label) : ''}${cfg.plus ? `<button type="button" class="lv-plus" data-lv="plus">+ ${escH(cfg.plus.label || t.plus)}</button>` : ''}
    ${avWrapHtml(me, 'top')}</div>
</header>`;
}

// Phone top bar: band · icon · TITLE · [bell] · gold round + · initials (the same name menu as on desktop; the Me tab
// still opens the Me screen)
export function phoneBarHtml(cfg, title) {
  const t = toolOf(cfg.tool);
  const plus = cfg.plus && !cfg.meScreen ? `<button type="button" class="lv-pplus lv-hit" data-lv="plus" aria-label="${escH(cfg.plus.label || t.plus)}">+</button>` : '';
  const av = cfg.meScreen ? `<button type="button" class="lv-avbtn lv-hit" data-lv="me" aria-label="Close Me">${avHtml(cfg.me)}</button>` : avWrapHtml(cfg.me || {}, 'phone');
  return `<div class="lv-ptop"${cfg.meScreen ? '' : ' data-lv-ptop'}><div class="lv-band"></div><div class="lv-bb"><a class="lv-mk lv-hit" href="${t.path}" data-lv-home aria-label="LFMP · ${escH(t.label)}"><i></i><i></i><i></i></a><h2${cfg.meScreen ? '' : ' data-lv-title'}>${escH(title ?? t.title)}</h2><div class="lv-ic">${cfg.bell && !cfg.meScreen ? bellHtml(cfg.bellCount, cfg.bell.label) : ''}${plus}${av}</div></div></div>`;
}

// Bottom tabs: Clients · Scorecards · Reviews · Reports · Me (gold = where you are; v2.9.0: the five share the width)
export function tabsHtml(cfg, meOpen = false) {
  return `<nav class="lv-tabs" data-lv-tabs aria-label="LFMP tools">${SHELL_TOOLS.map(x => `<a class="lv-tab" href="${x.path}"${x.id === cfg.tool ? `${meOpen ? '' : ' aria-current="page"'} data-lv-home` : ''}>${x.icon}${x.label}</a>`).join('')}<button type="button" class="lv-tab" data-lv="metab"${meOpen ? ' aria-current="page"' : ''}>${ME_ICON}Me</button></nav>`;
}

// The Me content. compact (v2.4.0) = the name menu under the initials (desktop and phone, PJ's Greeting 1+9 preview):
// name + Last signed in · Theme · [test clients · Refresh] · What's new · Team sign-ins · [Install] · Sign out.
// Without compact = the phone Me screen (grouped, unchanged).
export function meHtml(cfg, st = {}, { compact = false } = {}) {
  const me = cfg.me || {};
  const theme = st.theme || 'auto';
  const row = (lv, label, value = '', more = '') => `<button type="button" class="lv-mi" data-lv="${lv}" role="menuitem"${more}><span>${escH(label)}</span><span class="lv-v">${value}</span></button>`;
  const ver = `${st.newsDot ? '<span class="lv-ndot" aria-label="new"></span>' : ''}${cfg.version ? `v${escH(String(cfg.version).replace(/^v/, ''))} ` : ''}›`;
  const themeRow = `<div class="lv-mi" role="presentation"><span id="lvThemeL${compact ? 'c' : ''}">Theme</span><div class="lv-sw" role="group" aria-labelledby="lvThemeL${compact ? 'c' : ''}">${THEMES.map(([k, l]) => `<button type="button" class="lv-hit" data-lv="theme" data-v="${k}" aria-pressed="${k === theme}">${l}</button>`).join('')}</div></div>`;
  const testsRow = cfg.showTests ? `<div class="lv-mi" role="presentation"><span id="lvTestsL${compact ? 'c' : ''}">${escH(cfg.showTests.label || 'Show test clients')}</span><button type="button" class="lv-tg lv-hit" role="switch" data-lv="tests" aria-labelledby="lvTestsL${compact ? 'c' : ''}" aria-checked="${!!st.showTests}"></button></div>` : '';
  // v2.10.0: Done moments (after Theme): "New popup · Sound + voice ›" / "Classic ›"; v2.11.0: "Off ›" when switched off
  const dn = st.done || DN.readDone(undefined, me);
  const doneRow = row('done', 'Done moments', `${escH(compact ? DN.doneRowShort(dn) : DN.doneRowValue(dn))} ›`);   // FIX 6.1: one line in the name menu
  // v2.12.0 (queue item 14): Reports settings, right under Done moments: "N of 5 connected ›" (agency keys set; a cheap count)
  const rsRow = cfg.reportsSettings === false ? '' : row('rsettings', 'Reports settings', escH(reportsSettingsValue(st.rs)));
  if (compact) {
    return `<div class="lv-mh">${avHtml(me)}<div><b class="lv-n">${escH(me.name || me.email || '')}</b><small class="lv-l">${escH(lastSignInText(me))}</small></div></div>
<div class="lv-mc">${themeRow}${doneRow}${rsRow}${testsRow}${cfg.onRefresh ? row('refresh', 'Refresh now', st.updated ? `updated ${escH(st.updated)}` : '') : ''}
  ${row('news', "What's new", ver)}${row('signins', 'Team sign-ins', '›')}${row('install', 'Install the app', '›')}
  <div class="lv-dv" role="separator"></div><button type="button" class="lv-mi out" data-lv="signout" role="menuitem">Sign out</button></div>`;
  }
  return `<div class="lv-me-who">${avHtml(me, false)}<div><div class="lv-n">${escH(me.name || me.email || '')}</div><div class="lv-l">${escH(lastSignInText(me))}</div></div></div>
<p class="lv-gl">Settings</p><div class="lv-mlist">
  <div class="lv-mi" role="presentation"><span id="lvThemeL">Theme</span><div class="lv-sw" role="group" aria-labelledby="lvThemeL">${THEMES.map(([k, l]) => `<button type="button" class="lv-hit" data-lv="theme" data-v="${k}" aria-pressed="${k === theme}">${l}</button>`).join('')}</div></div>
  ${doneRow}${rsRow}
  ${cfg.showTests ? `<div class="lv-mi" role="presentation"><span id="lvTestsL">${escH(cfg.showTests.label || 'Show test clients')}</span><button type="button" class="lv-tg lv-hit" role="switch" data-lv="tests" aria-labelledby="lvTestsL" aria-checked="${!!st.showTests}"></button></div>` : ''}
  ${cfg.onRefresh ? row('refresh', 'Refresh now', st.updated ? `updated ${escH(st.updated)}` : '') : ''}
</div>
<p class="lv-gl">Team</p><div class="lv-mlist">
  ${row('signins', 'Team sign-ins', '›')}
  ${row('news', "What's new", `${st.newsDot ? '<span class="lv-ndot" aria-label="new"></span>' : ''}${cfg.version ? `v${escH(String(cfg.version).replace(/^v/, ''))} ` : ''}›`)}
  ${row('install', 'Install the app', '›')}
</div>
<div class="lv-mlist lv-me-out"><button type="button" class="lv-mi out" data-lv="signout" role="menuitem">Sign out</button></div>`;
}

// Page head: title + summary (desktop), search (always), segmented filter. segs: [{ key, label, phone, red, amber }]
// red = something is an alert, amber = only notices (the same colours as the KPI bell). The search icon is the same
// SVG magnifier on desktop and phone (v1.16.0; was a "⌕" character on desktop).
export function pageHeadHtml({ title, summary = '', search = {}, segs = [], active, brand = null }) {
  const tone = s => (s.red ? 'lv-red' : s.amber ? 'lv-amber' : '');
  const seg = s => `<button type="button" class="lv-hit" data-lv-seg="${escH(s.key)}" aria-pressed="${s.key === active}">${tone(s) ? `<span class="${tone(s)}">` : ''}<span class="lv-d">${escH(s.label)}</span><span class="lv-p">${escH(s.phone ?? s.label)}</span>${tone(s) ? '</span>' : ''}</button>`;
  const box = `<label class="lv-search lv-hit">${SEARCH_ICON}<input type="search" id="${escH(search.id || 'lvSearch')}" placeholder="${escH(search.placeholder || 'Search')}" value="${escH(search.value || '')}" autocomplete="off" spellcheck="false" aria-label="${escH(search.placeholder || 'Search')}"></label>`;
  // v2.7.0: with brand ({ value, counts }) the search shares its row with the "All clients ▾" menu (desktop) and the one
  // "Filter" button (phone), and the active filters show as chips under it (phone).
  const srch = brand ? `<div class="lv-srow">${box}${brandMenuHtml(brand)}${filterBtnHtml({ brand: brand.value, active, segs })}</div>` : box;
  return `<div class="lv-hrow"><div class="lv-d"><h1 class="lv-h1">${escH(title)}</h1><div class="lv-sum" data-lv-sum>${escH(summary)}</div></div>
${srch}</div>
${brand ? filterChipsHtml({ brand: brand.value, active, segs }) : ''}${segs.length ? `<div class="lv-seg${brand ? ' lv-segb' : ''}" role="group" aria-label="Filter">${segs.map(seg).join('')}</div>` : ''}`;
}

// ---------------------------------------------------------------- brand: LFMP or WPP (v2.7.0, all three tools)
// Every client is LFMP or WPP: the Builder record's brand (Forms → Brand, Add existing client, Client details → Agency).
// A firm or review package with no Builder record is LFMP. brandFor() is the one lookup the three tools use, so they agree.
// The list filter (All clients / LFMP / WPP) is ONE setting for Clients, Scorecards and Reviews on this device
// (localStorage; storage blocked → All). The greeting and the bells always count every client.
export const BRANDS = ['LFMP', 'WPP'];
export const BRAND_NAMES = { LFMP: 'Law Firm Marketing Pros', WPP: 'Web Promotion Partners' };
export const brandOf = rec => (String(rec?.brand ?? '').trim().toUpperCase() === 'WPP' ? 'WPP' : 'LFMP');
// rows = loadBuilderRecords() rows; keys: any of { id, reviewCode, kpiSlug, locationId } of the tool's item
export function brandFor(rows, keys = {}) {
  const k = keys || {};
  const row = (rows || []).find(r => (k.id && r.id === k.id) || (k.reviewCode && r.reviewCode === k.reviewCode)
    || (k.kpiSlug && r.kpiSlug === k.kpiSlug) || (k.locationId && r.locationId === k.locationId));
  return row ? brandOf(row) : 'LFMP';
}
export const BRAND_KEY = 'lfmp-brand-filter';
const okBrand = v => (v === 'LFMP' || v === 'WPP' ? v : 'all');
export function getBrandFilter() { try { return okBrand(globalThis.localStorage?.getItem(BRAND_KEY)); } catch { return 'all'; } }
export function setBrandFilter(v) {
  const b = okBrand(v);
  try { if (b === 'all') globalThis.localStorage?.removeItem(BRAND_KEY); else globalThis.localStorage?.setItem(BRAND_KEY, b); } catch { /* blocked: this page only */ }
  return b;
}
// "WPP " / "LFMP " / "" for the summary, search placeholder and Show N: "1 WPP sub-account", "Search 1 WPP client"
export const brandWord = b => (b === 'LFMP' || b === 'WPP' ? `${b} ` : '');
// the row's grey line starts with the brand only when every brand is shown
export const brandSub = (brand, filter, sub) => (okBrand(filter) === 'all' ? [brand, sub].filter(Boolean).join(' · ') : sub);
// brand counts for the menu and the sheet: items = [{ brand }]
export const brandCounts = items => ({ all: (items || []).length, LFMP: (items || []).filter(x => x.brand !== 'WPP').length, WPP: (items || []).filter(x => x.brand === 'WPP').length });

const BRAND_OPTS = [['all', 'All clients'], ['LFMP', 'LFMP'], ['WPP', 'WPP']];
export const BRAND_HINT = 'Same choice on Clients, Scorecards and Reviews (this device).';
// Desktop: "All clients ▾" next to the search; open = its menu is showing
export function brandMenuHtml({ value = 'all', counts = {}, open = false }) {
  const v = okBrand(value);
  const btn = `<button type="button" class="lv-bf lv-hit${v !== 'all' ? ' on' : ''}" data-lv-bf aria-haspopup="menu" aria-expanded="${open}" aria-label="Clients: ${escH(v === 'all' ? 'All clients' : v)}"><span class="lv-bfdot" aria-hidden="true"></span>${escH(v === 'all' ? 'All clients' : v)}<span class="lv-car" aria-hidden="true">▾</span></button>`;
  const pop = open ? `<div class="lv-bfpop" role="menu" aria-label="Clients">${BRAND_OPTS.map(([k, l]) => `<button type="button" role="menuitemradio" aria-checked="${k === v}" data-lv-bfpick="${k}"><span class="lv-ck" aria-hidden="true">${k === v ? '✓' : ''}</span>${escH(l)}<span class="lv-n">${escH(counts[k] ?? 0)}</span></button>`).join('')}<div class="lv-bfhint">${escH(BRAND_HINT)}</div></div>` : '';
  return `<div class="lv-bfw" data-lv-bfw>${btn}${pop}</div>`;
}
const FILTER_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';
const segWord = s => String(s?.phone ?? s?.label ?? '').replace(/\s*·\s*\d+$/, '').replace(/\s+\d+$/, '').trim();
const segN = s => (Number.isFinite(s?.n) ? s.n : Number((/(\d+)\s*$/.exec(String(s?.label ?? '')) || [])[1] || 0));
const needsSeg = segs => (segs || []).find(s => s.needs || s.key === 'attention' || s.key === 'need');
// Phone: one Filter button (status + brand); the gold badge = how many filters are on
export function filterBtnHtml({ brand = 'all', active = 'all', segs = [] }) {
  const on = (okBrand(brand) !== 'all') + (!!segs.length && active !== (segs[0]?.key ?? 'all'));
  return `<button type="button" class="lv-fbtn lv-hit" data-lv-fbtn aria-haspopup="dialog" aria-label="Filter${on ? ` (${on} on)` : ''}">${FILTER_ICON}Filter${on ? `<span class="lv-fbd" aria-hidden="true">${on}</span>` : ''}</button>`;
}
// Phone: each active filter as a chip under the search (✕ clears it), plus the red "Needs you · N ›" shortcut
export function filterChipsHtml({ brand = 'all', active = 'all', segs = [] }) {
  const b = okBrand(brand), all = segs[0]?.key ?? 'all', cur = segs.find(s => s.key === active), ns = needsSeg(segs);
  const chips = [b !== 'all' ? `<button type="button" class="lv-hit" data-lv-clr="brand" aria-label="Clear ${escH(b)}">${escH(b)} <span aria-hidden="true">✕</span></button>` : '',
    cur && active !== all ? `<button type="button" class="lv-hit" data-lv-clr="status" aria-label="Clear ${escH(segWord(cur))}">${escH(segWord(cur))} <span aria-hidden="true">✕</span></button>` : '',
    ns && segN(ns) > 0 && active !== ns.key ? `<button type="button" class="lv-needs lv-hit" data-lv-needs="${escH(ns.key)}">${escH(segWord(ns))} · ${escH(segN(ns))} <span aria-hidden="true">›</span></button>` : ''].join('');
  return `<div class="lv-chips" data-lv-chips>${chips}</div>`;
}
// Phone: the Filter sheet. brands = brandCounts(all items); segs = the status filter for the brand picked in the sheet
export function filterSheetHtml({ brand = 'all', active = 'all', brands = {}, segs = [], showN = 0, noun = 'client' }) {
  const b = okBrand(brand), one = (attr, v, cur, label) => `<button type="button" data-${attr}="${escH(v)}" aria-pressed="${v === cur}">${escH(label)}</button>`;
  return `<div class="lv-fsh" data-lv-fclose></div><div class="lv-fsheet" role="dialog" aria-modal="true" aria-labelledby="lvFsT"><div class="lv-grab" aria-hidden="true"></div><h3 id="lvFsT">Filter</h3>
<div class="lv-fgl" id="lvFsB">Clients</div><div class="lv-seg" role="group" aria-labelledby="lvFsB">${BRAND_OPTS.map(([k, l]) => one('lv-fb', k, b, `${k === 'all' ? 'All' : l} · ${brands[k] ?? 0}`)).join('')}</div>
<div class="lv-fgl" id="lvFsS">Status</div><div class="lv-seg" role="group" aria-labelledby="lvFsS">${segs.map(s => one('lv-fs', s.key, active, `${segWord(s)} · ${segN(s)}`)).join('')}</div>
<div class="lv-facts"><button type="button" data-lv-freset>Reset</button><button type="button" class="p" data-lv-fapply>Show ${escH(showN)} ${escH(noun)}${showN === 1 ? '' : 's'}</button></div></div>`;
}
// Wires the brand menu, chips, Needs you chip and the phone sheet in host (once per host). o:
//   getBrand() / getStatus() → current; segsFor(brand) → the status segs (with counts) for that brand;
//   countFor(brand, status) → how many rows show; brands() → brandCounts(...); noun; onChange({ brand, status })
export function wireListFilter(host, o) {
  if (!host || host.__lvFilter) { if (host) host.__lvFilter = o; return; }
  host.__lvFilter = o;
  const O = () => host.__lvFilter;
  const set = (brand, status) => { const b = setBrandFilter(brand); O().onChange({ brand: b, status }); };
  const closeMenu = (focus = false) => { const w = host.querySelector('[data-lv-bfw]'); if (!w?.querySelector('.lv-bfpop')) return; w.outerHTML = brandMenuHtml({ value: O().getBrand(), counts: O().brands(), open: false }); if (focus) host.querySelector('[data-lv-bf]')?.focus(); };
  const openMenu = () => { const w = host.querySelector('[data-lv-bfw]'); if (!w) return; w.outerHTML = brandMenuHtml({ value: O().getBrand(), counts: O().brands(), open: true }); host.querySelector('[data-lv-bfpick][aria-checked="true"]')?.focus(); };
  host.addEventListener('click', e => {
    const t = e.target.closest('[data-lv-bf],[data-lv-bfpick],[data-lv-clr],[data-lv-needs],[data-lv-fbtn]'); if (!t) return;
    if (t.matches('[data-lv-bf]')) { if (t.getAttribute('aria-expanded') === 'true') closeMenu(true); else openMenu(); }
    else if (t.matches('[data-lv-bfpick]')) { const v = t.dataset.lvBfpick; closeMenu(); set(v, O().getStatus()); host.querySelector('[data-lv-bf]')?.focus(); }
    else if (t.matches('[data-lv-clr]')) { if (t.dataset.lvClr === 'brand') set('all', O().getStatus()); else set(O().getBrand(), O().segsFor(O().getBrand())[0]?.key ?? 'all'); }
    else if (t.matches('[data-lv-needs]')) set(O().getBrand(), t.dataset.lvNeeds);
    else if (t.matches('[data-lv-fbtn]')) openFilterSheet(O(), set, t);
  });
  host.addEventListener('keydown', e => {
    if (!host.querySelector('.lv-bfpop')) return;
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(true); return; }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const items = [...host.querySelectorAll('[data-lv-bfpick]')], i = items.indexOf(document.activeElement);
      e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
    }
  });
  document.addEventListener('click', e => { if (!e.target.closest?.('[data-lv-bfw]')) closeMenu(); }, true);
}
function openFilterSheet(o, set, opener) {
  document.querySelectorAll('.lv-fsheet,.lv-fsh').forEach(x => x.remove());
  let b = o.getBrand(), s = o.getStatus();
  const wrap = document.createElement('div'); wrap.className = 'lv-fwrap' + (reducedMotion() ? ' lv-nomo' : '');
  const paint = () => {
    const segs = o.segsFor(b); if (!segs.some(x => x.key === s)) s = segs[0]?.key ?? 'all';
    wrap.innerHTML = filterSheetHtml({ brand: b, active: s, brands: o.brands(), segs, showN: o.countFor(b, s), noun: o.noun || 'client' });
  };
  let pushed = false;
  const close = (back = true) => {
    wrap.remove(); document.removeEventListener('keydown', onKey, true); removeEventListener('popstate', onPop);
    if (back && pushed) { pushed = false; history.back(); }
    opener?.isConnected ? opener.focus() : document.querySelector('[data-lv-fbtn]')?.focus();
  };
  const onPop = () => { pushed = false; close(false); };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;   // focus stays in the sheet
    const f = [...wrap.querySelectorAll('button')].filter(x => !x.disabled); if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
  };
  wrap.addEventListener('click', e => {
    const t = e.target.closest('[data-lv-fb],[data-lv-fs],[data-lv-freset],[data-lv-fapply],[data-lv-fclose]'); if (!t) return;
    if (t.matches('[data-lv-fclose]')) return close();
    if (t.matches('[data-lv-fb]')) b = t.dataset.lvFb; else if (t.matches('[data-lv-fs]')) s = t.dataset.lvFs;
    else if (t.matches('[data-lv-freset]')) { b = 'all'; s = o.segsFor('all')[0]?.key ?? 'all'; }
    else if (t.matches('[data-lv-fapply]')) { close(); set(b, s); return; }
    const key = t.matches('[data-lv-fb]') ? `[data-lv-fb="${b}"]` : t.matches('[data-lv-fs]') ? `[data-lv-fs="${s}"]` : '[data-lv-freset]';
    paint(); wrap.querySelector(key)?.focus();
  });
  paint(); document.body.appendChild(wrap);
  try { history.pushState({ lvSheet: 1 }, ''); pushed = true; addEventListener('popstate', onPop); } catch { /* no history: Esc / outside still close */ }
  document.addEventListener('keydown', onKey, true);
  wrap.querySelector('[data-lv-fb][aria-pressed="true"]')?.focus();
}
// Repaint the list head in place (counts, brand, chips, summary, placeholder) without touching the search box's typing
export function updateListHead(host, opts) {
  const head = host?.querySelector('.lv-hrow'); if (!head) return;
  const t = document.createElement('template'); t.innerHTML = pageHeadHtml(opts);
  const swap = sel => { const n = t.content.querySelector(sel), o = host.querySelector(sel); if (n && o) o.replaceWith(n); };
  if (opts.brand) { if (!host.querySelector('[data-lv-bfw]')?.querySelector('.lv-bfpop')) swap('[data-lv-bfw]'); swap('[data-lv-fbtn]'); swap('[data-lv-chips]'); }
  swap('.lv-seg');
  const sum = host.querySelector('[data-lv-sum]'); if (sum && opts.summary !== undefined) sum.textContent = opts.summary;
  const inp = host.querySelector('.lv-search input');
  if (inp && opts.search?.placeholder) { inp.placeholder = opts.search.placeholder; if (!opts.search.keepLabel) inp.setAttribute('aria-label', opts.search.placeholder); }
}

// ---------------------------------------------------------------- client names (v1.16.0)
// One display name per client in all three tools: the Builder record's name when there is one, otherwise the tool's
// own name. Display only: files, codes and slugs never change. A company ending that lost its last dot gets it back
// ("Hedayati Law Group, P.C" → "Hedayati Law Group, P.C.", also P.A / L.L.C / P.L.L.C).
export function displayName(name) {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim();
  return s.replace(/(?:^|[\s,])((?:[A-Z]\.){1,3}[A-Z])$/, m => `${m}.`);
}
// v1.17.0: every list (Clients, Scorecards, Reviews) is A–Z by display name, case-insensitive, ignoring a leading
// "The " ("The Mahdavi Law Firm" sorts under M). Use: list.sort(byName(x => x.name)).
// ---------------------------------------------------------------- v2.12.0 (queue item 14): "NEW" on recently added clients
// A Builder record made by New client or Add existing client less than 7 days ago (its createdAt): a gold NEW pill after
// the name, "Added today / yesterday / Nov 25" first in the grey line, and pinned to the top of the list (newest first)
// within whatever the filter shows. Same answer in the four lists (Clients, Scorecards, Reviews, Reports): newInfo() looks
// the client up with the brandFor() keys.
export const NEW_DAYS = 7;
// ANSWER 14.1 (PJ): only clients added AFTER this release went live get the pill (both New client and Add existing client);
// anything added before the go-live time never does. NEW_SINCE = that go-live time (set when shell 2.12.0 was pushed).
export const NEW_SINCE = '2026-11-25T10:22:00.000Z';
const DAY = 864e5;
export function isNewClient(createdAt, now = Date.now(), since = NEW_SINCE) { const t = Date.parse(createdAt || ''); return Number.isFinite(t) && t >= Date.parse(since) && t <= now + 5 * 60e3 && now - t < NEW_DAYS * DAY; }
export function addedText(createdAt, now = Date.now()) {
  const t = new Date(createdAt || ''); if (Number.isNaN(t.getTime())) return '';
  const day = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(), n = Math.round((day(new Date(now)) - day(t)) / DAY);
  return n <= 0 ? 'Added today' : n === 1 ? 'Added yesterday' : `Added ${t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}
export function newInfo(rows, keys = {}, now = Date.now()) {
  const k = keys || {};
  const row = (rows || []).find(r => (k.id && r.id === k.id) || (k.reviewCode && r.reviewCode === k.reviewCode) || (k.kpiSlug && r.kpiSlug === k.kpiSlug) || (k.locationId && r.locationId === k.locationId));
  return row && isNewClient(row.createdAt, now) ? { isNew: true, createdAt: row.createdAt, added: addedText(row.createdAt, now) } : { isNew: false, createdAt: '', added: '' };
}
// New clients first (newest first), then the list's own order (A–Z). info(item) → newInfo(...) for that item.
export function newFirst(items, info) {
  const withI = items.map((x, i) => ({ x, i, n: info(x) }));
  return withI.sort((a, b) => (a.n.isNew === b.n.isNew ? (a.n.isNew ? String(b.n.createdAt).localeCompare(String(a.n.createdAt)) || a.i - b.i : a.i - b.i) : a.n.isNew ? -1 : 1)).map(w => w.x);
}
export const NEW_PILL = '<span class="lv-new">New</span>';
export const nameKey = name => displayName(name).replace(/^the\s+/i, '').toLowerCase();
export const byName = get => (a, b) => nameKey(get(a)).localeCompare(nameKey(get(b)), 'en', { sensitivity: 'base', numeric: true }) || String(get(a)).localeCompare(String(get(b)));
// The Builder's client records (private repo, records/<id>.json) through the team site, read only:
// [{ id, name, locationId, reviewCode, kpiSlug, linkSent, brand }] (v2.7.0: brand = 'LFMP' | 'WPP'). Never throws: any failure = [] (tools keep their own names).
let recordsPromise = null;
// v2.4.2: gh = another GitHub reader with the same answers (the team site's server passes its own for /api/greet-counts);
// such a read is never shared with the page's.
export function loadBuilderRecords({ fresh = false, gh = null } = {}) {
  if (gh) return readBuilderRecords(gh);
  if (recordsPromise && !fresh) return recordsPromise;
  recordsPromise = readBuilderRecords(ghFetch);
  return recordsPromise;
}
function readBuilderRecords(ghFetch) {
  const REPO = '/repos/peejayedz/ghl-subaccount-builder';
  return (async () => {
    try {
      const r = await ghFetch('GET', `${REPO}/contents/records?ref=main`);
      if (!r.ok) return [];
      const files = (await r.json()).filter(f => f && f.type === 'file' && /^[a-z0-9-]{1,60}\.json$/.test(f.name));
      const recs = await Promise.all(files.map(f => ghFetch('GET', `${REPO}/contents/records/${f.name}?ref=main`, null, { raw: true })
        .then(x => (x.ok ? x.text() : null)).then(t => (t ? JSON.parse(t) : null)).catch(() => null)));
      return recs.filter(x => x && x.id && x.businessName).map(x => ({ id: x.id, name: displayName(x.businessName), locationId: x.locationId || '',
        reviewCode: x.review?.code || '', kpiSlug: x.kpi?.slug || x.reports?.slug || '', linkSent: x.review?.linkSent || null, brand: brandOf(x), createdAt: x.createdAt || '' }));   // v2.12.0: createdAt (the NEW pill)
    } catch { return []; }
  })();
}

// ---------------------------------------------------------------- What's new card (v1.16.0, all three tools)
// Shown once per version, bottom right (phone: above the tabs): a rounded card, small gold dot + "What's new · v1.16.0",
// the title in sentence case, one short line, "See what's new" (gold) and "Got it" (like Sign out).
export function newsCardHtml({ version, title, line }) {
  const v = String(version || '').replace(/^v/, '');
  return `<aside class="lv-note" role="status" aria-live="polite" aria-label="What's new" data-lv-news>
<p class="lv-note-meta"><b class="lv-note-dot" aria-hidden="true"></b>What's new · v${escH(v)}</p>
${title ? `<p class="lv-note-t">${escH(title)}</p>` : ''}${line ? `<p class="lv-note-l">${escH(line)}</p>` : ''}
<div class="lv-note-b"><button type="button" class="lv-note-go" data-lv-news-go>See what's new</button><button type="button" class="lv-note-ok" data-lv-news-ok>Got it</button></div></aside>`;
}
// The card's one short line: the version's own "line" (or "summary"), else its first item, cut at a word near 120 chars.
export function newsLine(v) {
  const t = String(v?.line || v?.summary || v?.items?.[0]?.text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 120) return t;
  return `${t.slice(0, 118).replace(/\s+\S*$/, '')}…`;
}
// Mount it (replaces an open one). onSee: open the tool's What's new; onGot: mark this version seen. Returns close().
export function showNewsCard({ version, title, line, onSee, onGot }) {
  if (typeof document === 'undefined') return () => {};
  document.querySelector('[data-lv-news]')?.remove();
  document.body.insertAdjacentHTML('beforeend', newsCardHtml({ version, title, line }));
  const el = document.querySelector('[data-lv-news]');
  const close = () => el.remove();
  el.addEventListener('click', e => {
    if (e.target.closest('[data-lv-news-go]')) { close(); onGot?.(); onSee?.(); }
    else if (e.target.closest('[data-lv-news-ok]')) { close(); onGot?.(); }
  });
  return close;
}
export const hideNewsCard = () => { if (typeof document !== 'undefined') document.querySelector('[data-lv-news]')?.remove(); };

// One list row. cells: desktop columns after the name (HTML strings); phone: phoneRight (default: the first cell) + ›.
export function rowHtml({ name, sub = '', subPhone, cells = [], phoneRight, open = 'Open ›', attrs = '', label, isNew = false, added = '' }) {
  const subP = subPhone ?? sub;
  // v2.12.0: a new client's grey line starts with the gold "Added today" (first, so a phone never cuts it off)
  const ad = isNew && added ? `<span class="lv-added">${escH(added)}</span>` : '', line = t => (ad ? (t ? `${ad} · ${escH(t)}` : ad) : escH(t));
  const subHtml = subP === sub ? (sub || ad ? `<div class="lv-mt">${line(sub)}</div>` : '')
    : `${sub || ad ? `<div class="lv-mt lv-d">${line(sub)}</div>` : ''}${subP || ad ? `<div class="lv-mt lv-p">${line(subP)}</div>` : ''}`;
  return `<div class="lv-row${isNew ? ' lv-isnew' : ''}" role="button" tabindex="0" aria-label="${escH(label || `Open ${name}`)}${isNew ? ' (new)' : ''}" ${attrs}><div class="lv-c0"><div class="lv-nm">${isNew ? `<span class="lv-nmt">${escH(name)}</span>${NEW_PILL}` : escH(name)}</div>${subHtml}</div>${cells.map(c => `<div class="lv-c">${c}</div>`).join('')}${open ? `<div class="lv-c lv-op">${escH(open)}</div>` : ''}<div class="lv-c lv-pr">${phoneRight ?? cells[0] ?? ''}</div><span class="lv-chev" aria-hidden="true">›</span></div>`;
}
export const statusHtml = (tone, label) => `<span class="lv-st ${escH(tone)}"><b></b>${escH(label)}</span>`;
export const bigHtml = (n, small, red = false) => `<span class="lv-big${red ? ' red' : ''}">${escH(n)}<small>${escH(small)}</small></span>`;
export const squaresHtml = (tones, em = 'KPI · Review · Forms') => `<span class="lv-sq">${tones.map(t => `<i class="${t ? escH(t) : 'o'}"></i>`).join('')}<em>${escH(em)}</em></span>`;
export const sheetHeadHtml = (back, title = '') => `<div class="lv-sheet-h"><button type="button" class="lv-back" data-lv-back><span aria-hidden="true">‹</span>${escH(back)}</button>${title ? `<b class="lv-sheet-t">${escH(title)}</b>` : ''}</div>`;

// ---------------------------------------------------------------- motion (Nov 2026): loading mark + details panel
// PJ's previews "Claude outputs/LFMP_Loading_Preview.html" (option B) and "LFMP_Panel_Animation_Preview.html" (option A,
// 0.50 s). prefers-reduced-motion: no motion at all (the mark stands still, panels open and close at once).
export const reducedMotion = () => { try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
export const LOAD_LIMIT_MS = 20000;
export const LOAD_SLOW_TEXT = 'This is taking longer than 20 seconds. Check your connection, then try again.';
// The 3-block LFMP mark rising in a loop + "Loading clients…" (animated dots), centred where the list will be.
// v2.12.0 (queue item 14): a whole list / page load sits in the middle of the SCREEN (lv-load-page: fixed, centred, under
// the top bar and the tabs, clicks pass through); page: false = a small loader inside a card / panel (stays in place).
export function loadingHtml(what = 'clients', { page = true } = {}) {
  const t = `Loading ${escH(what)}`;
  return `<div class="lv-load${page ? ' lv-load-page' : ''}" role="status" aria-label="${t}…" data-lv-loading><span class="lv-load-mk" aria-hidden="true"><i></i><i></i><i></i></span><span class="lv-load-t" aria-hidden="true">${t}<span class="lv-dots"></span></span></div>`;
}
// Never spin forever: rejects after 20 s (error.code "slow"), so the tool shows its own error / Retry state.
export function withLoadLimit(promise, ms = LOAD_LIMIT_MS) {
  let t;
  const slow = new Promise((_, reject) => { t = setTimeout(() => reject(Object.assign(new Error(LOAD_SLOW_TEXT), { code: 'slow' })), ms); });
  return Promise.race([promise, slow]).finally(() => clearTimeout(t));
}
// The list couldn't load (or took over 20 s): a rounded card like the list, a small red dot + the message (sentence
// case) and a "Try again" button styled like Sign out. attrs = the tool's own retry hook (e.g. 'data-act="reload"').
export function loadErrorHtml(message, { attrs = '' } = {}) {
  return `<div class="lv-err" role="alert" data-lv-error><p class="lv-err-t"><b class="lv-err-dot" aria-hidden="true"></b><span>${escH(message)}</span></p><button type="button" class="lv-retry" data-lv-retry ${attrs}>Try again</button></div>`;
}
// The list fades in (0.3 s) when the data arrives.
export function fadeIn(el) {
  if (!el || reducedMotion()) return;
  el.classList.remove('lv-fadein'); void el.offsetWidth; el.classList.add('lv-fadein');
  setTimeout(() => el.classList.remove('lv-fadein'), 400);
}
// Details panel: slides in from the right (0.50 s, cubic-bezier(.16,1,.3,1)) while the shade dims (0.42 s); the content
// rises 6px into place from 0.22 s. Closing slides out (0.40 s, cubic-bezier(.4,0,1,1)). Input is never blocked: any
// pointer press while a panel moves finishes the move at once. Opening an already open panel only swaps its content.
const PM = new Map();   // panel -> { dir: 'in' | 'out', shade, t, done }
const pmEls = (panel, shade) => [panel, shade].filter(Boolean);
function pmEnd(panel, { cancelled = false } = {}) {
  const s = PM.get(panel); if (!s) return;
  clearTimeout(s.t); PM.delete(panel);
  panel.classList.remove('lv-pm-enter');
  if (!cancelled && s.done) s.done();
}
export function panelOpen(panel, shade) {
  if (!panel) return false;
  panel.classList.add('lv-pm'); shade?.classList.add('lv-pm-sh');
  const s = PM.get(panel);
  if (s?.dir === 'in') return false;                                   // already sliding in
  if (s?.dir === 'out') { pmEnd(panel, { cancelled: true }); pmEls(panel, shade).forEach(e => e.classList.add('lv-pm-on')); return false; }   // reopened while closing: slide back, keep the DOM
  if (panel.classList.contains('lv-pm-on')) return false;              // open: the caller just swaps the content
  if (reducedMotion()) { pmEls(panel, shade).forEach(e => e.classList.add('lv-pm-on')); return true; }
  pmEls(panel, shade).forEach(e => { e.classList.remove('lv-pm-on'); void e.offsetWidth; });
  panel.classList.add('lv-pm-enter');
  pmEls(panel, shade).forEach(e => e.classList.add('lv-pm-on'));
  PM.set(panel, { dir: 'in', shade, t: setTimeout(() => pmEnd(panel), 520) });
  return true;
}
// done() runs when the panel is out of sight (at once with reduced motion): hide it / empty it there.
export function panelClose(panel, shade, done) {
  if (!panel) { done?.(); return; }
  const s = PM.get(panel); if (s?.dir === 'out') { s.done = done; return; }
  if (s) pmEnd(panel, { cancelled: true });
  const shown = panel.classList.contains('lv-pm-on') && !panel.hidden;
  pmEls(panel, shade).forEach(e => e.classList.remove('lv-pm-on'));
  panel.classList.remove('lv-pm-enter');
  if (!shown || reducedMotion()) { done?.(); return; }
  PM.set(panel, { dir: 'out', shade, done, t: setTimeout(() => pmEnd(panel), 420) });
}
// Ends any move at once (same end state, done() runs now).
export function panelFinish(panel) {
  const list = panel ? [panel] : [...PM.keys()];
  for (const p of list) {
    const s = PM.get(p); if (!s) continue;
    pmEls(p, s.shade).forEach(e => e.classList.add('lv-pm-now'));
    pmEnd(p);
    requestAnimationFrame(() => pmEls(p, s.shade).forEach(e => e.classList.remove('lv-pm-now')));
  }
}
export const panelMoving = panel => (panel ? PM.has(panel) : PM.size > 0);
if (FIRST_COPY) document.addEventListener('pointerdown', () => { if (PM.size) panelFinish(); }, true);

// ---------------------------------------------------------------- busy states (v2.3.0, Nov 2026): no silent clicks
// PJ's previews "Claude outputs/LFMP_Busy_Options_v2.html" option 1 "Gold fill" (buttons), "LFMP_No_Silent_Clicks_Preview.html"
// (press feedback, top line) and "LFMP_Busy_States_Preview.html" (progress card for long jobs). Built once for all three tools:
//   busyButton(btn, 'Adding…', { ms }) → { done('✓ Added'), fail(), stop() }   the clicked button fills with gold (left → right)
//   areaLoading(el, 'Loading review…') → { done(), fail(msg, onRetry), pct(n) }  3px gold bar on the area's top edge + centred text
//   progressCard(el, { title, hint, typicalMs, steps: [[key, label]] }) → { step(key, state, detail), done(result, next), fail(msg, onRetry) }
//   lfmpFetch(url, init)  = fetch + the 3px gold line under the top bar while any request is in flight (api() / ghFetch() use it too)
// Every busy state shows only if the work isn't finished within BUSY_DELAY_MS (150 ms). Nothing finishes silently: ✓ / a
// fade-in / an error with Retry. Reduced motion: no animated fill; a solid gold outline + the action word; steps still tick.
export const BUSY_DELAY_MS = 150;
export const BUSY_DONE_MS = 1200;
export const LONG_NOTE_MS = 30000;
export const LONG_NOTE = 'Still working, usually under a minute. You can close this panel; you\'ll get a bell notice when it\'s done.';
// the 30 s note in the job's own typical time ("usually about 2 minutes" for Publish; "under a minute" up to 60 s)
export function longNote(typicalMs = 40000) {
  if (!(typicalMs > 60000)) return LONG_NOTE;
  return `Still working, usually ${fmtTypical(typicalMs).replace(/^Usually /, '')}. You can close this panel; you'll get a bell notice when it's done.`;
}
const hasDoc = () => typeof document !== 'undefined';

// ---- top-of-page line: 3px gold under the top bar while any request is in flight (after 150 ms)
let netCount = 0, netTimer = null, netEl = null;
function netPaint() {
  if (!hasDoc()) return;
  if (!netEl) { netEl = document.createElement('div'); netEl.className = 'lv-net'; netEl.setAttribute('aria-hidden', 'true'); netEl.dataset.lvNet = ''; document.body.append(netEl); }
  const bar = [...document.querySelectorAll('[data-lv-top],[data-lv-ptop]')].find(b => b.getBoundingClientRect().height);
  netEl.style.top = `${bar ? Math.max(0, bar.getBoundingClientRect().bottom - 3) : 0}px`;
  if (netCount > 0) { if (!netEl.classList.contains('on') && !netTimer) netTimer = setTimeout(() => { netTimer = null; if (netCount > 0) { netEl.classList.remove('end'); void netEl.offsetWidth; netEl.classList.add('on'); } }, BUSY_DELAY_MS); }
  else { clearTimeout(netTimer); netTimer = null; if (netEl.classList.contains('on')) { netEl.classList.add('end'); setTimeout(() => { if (!netCount) netEl.classList.remove('on', 'end'); }, 450); } }
}
export function trackRequest(promise) {
  netCount++; netPaint();
  if (autoPress && Date.now() - autoPress.t < AUTO_WINDOW_MS && !autoJob) autoStart(autoPress);
  const j = autoJob;
  if (j) { j.n++; clearTimeout(j.t); }
  const p = Promise.resolve(promise);
  p.then(r => { if (j && r && r.ok === false && r.status >= 400 && r.status !== 404) j.bad = true; }, () => { if (j) j.bad = true; });
  return p.finally(() => { netCount = Math.max(0, netCount - 1); netPaint(); if (j) { j.n--; if (!j.n) autoSettle(j); } });
}
// ---- automatic gold fill: a button press that starts a request (within 400 ms) gets busyButton until the requests it
// started (and any that follow within 300 ms) are done: "✓ Saved" etc. on success, the fill drains on failure.
// Not for: tabs, rows, filters, the shell (top bar / Me / phone tabs), Back / ✕, Try again, and buttons a tool runs itself
// (data-lv-manual, or whose label the tool changed in its own click handler, e.g. "Saving…").
const AUTO_WINDOW_MS = 400, AUTO_SETTLE_MS = 300;
const AUTO_SKIP = '.lv-bz,.lv-bz-dim,[role="tab"],[data-lv-manual],[data-lv-retry],[data-lv-back],[data-lv],.lv-plus,.xbtn,.dclose,[data-dtab],[data-lv-seg],summary';
const AUTO_SKIP_IN = '.lv-row,.lv-top,.lv-ptop,.lv-pop,.lv-mescreen,[data-lv-tabs],.lv-seg,.menu,[data-lv-manual]';
let autoPress = null, autoJob = null;
const VERB = [[/^(save|mark)/i, 'Saving…', '✓ Saved'], [/^add/i, 'Adding…', '✓ Added'], [/^(remove|forget)/i, 'Removing…', '✓ Removed'], [/^delete/i, 'Deleting…', '✓ Deleted'],
  [/^re-?sync|^sync/i, 'Syncing…', '✓ Started'], [/^refresh|^check|^re-?read/i, 'Refreshing…', '✓ Up to date'], [/^create|^make/i, 'Creating…', '✓ Created'], [/^(copy)/i, 'Copying…', '✓ Copied'],
  [/^link/i, 'Linking…', '✓ Linked'], [/^(look|find|search)/i, 'Searching…', '✓ Found'], [/^send|^request/i, 'Sending…', '✓ Sent'], [/^(update|change|edit|rename)/i, 'Saving…', '✓ Saved'],
  [/^(restart|start|run|retry)/i, 'Starting…', '✓ Started'], [/^publish/i, 'Publishing…', '✓ Published'], [/^(approve|use|keep|match|apply)/i, 'Saving…', '✓ Saved']];
export function busyWords(label) {
  const t = String(label || '').replace(/<[^>]*>/g, ' ').replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const v = VERB.find(([re]) => re.test(t));
  return v ? { word: v[1], done: v[2] } : { word: 'Working…', done: '✓ Done' };
}
function autoStart(p) {
  autoPress = null;
  const b = p.btn;
  if (!b.isConnected || b.innerHTML !== p.label || b.classList.contains('lv-bz')) return;   // the tool runs this button itself
  const w = b.dataset.busy ? { word: b.dataset.busy, done: b.dataset.done || '✓ Done' } : busyWords(p.label);
  autoJob = { n: 0, bad: false, t: null, w, bz: busyButton(b, w.word, { ms: Number(b.dataset.busyMs) || 1500, label: p.label, disable: false }) };
}
// No double submit, mouse or keyboard: a click on a busy button or a dimmed neighbour does nothing (registered before
// the tools' own click handlers, which listen on the bubble phase).
if (FIRST_COPY) document.addEventListener('click', e => { if (e.target.closest?.('.lv-bz, .lv-bz-dim')) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
function autoSettle(j) {
  clearTimeout(j.t);
  j.t = setTimeout(() => { if (j.n) return; if (autoJob === j) autoJob = null; j.bad ? j.bz.fail() : j.bz.done(j.w.done); }, AUTO_SETTLE_MS);
}
if (FIRST_COPY) document.addEventListener('click', e => {
  const b = e.target.closest?.('button, a.btn');
  autoPress = (!b || b.disabled || b.matches(AUTO_SKIP) || b.closest(AUTO_SKIP_IN)) ? null : { btn: b, label: b.innerHTML, t: Date.now() };
}, true);
export const requestsInFlight = () => netCount;
// The one fetch wrapper for the three tools (same arguments and answer as fetch).
export const lfmpFetch = (input, init) => trackRequest(fetch(input, init));

// ---- press feedback (CSS: :active scale .98 + a touch darker) needs nothing here.

// ---- buttons: option 1 "Gold fill"
// Pure markup (also used by tools that repaint while busy): the label stays for 150 ms, then the action word over a gold
// fill that eases to ~90% over `ms` (the real typical time of that action).
// The gold layer covers the button and is revealed left → right (clip-path); it carries its own near-black copy of the
// word, so the word reads on gold where filled and in the normal text colour where not yet filled.
export function busyInnerHtml(label, word) {
  return `<span class="lv-bz-idle">${label}</span><span class="lv-bz-word" aria-live="polite">${escH(word)}</span><span class="lv-bz-fill" aria-hidden="true"><span class="lv-bz-fw">${escH(word)}</span></span>`;
}
export function busyButton(btn, word, opts = {}) {
  const { ms = 1500, group } = opts;
  if (!btn) return { done() {}, fail() {}, stop() {} };
  // offsetWidth = the layout width (getBoundingClientRect would give the pressed, scaled .98 width)
  const old = opts.label ?? btn.innerHTML, w = btn.offsetWidth || btn.getBoundingClientRect().width;
  // No double submit: a busy button and its dimmed neighbours ignore clicks (the guard below, mouse and keyboard).
  // `disabled` is set only when asked (explicit calls) and only undone if this call set it, so a tool's own disabled
  // state is never overwritten.
  const useDisabled = opts.disable !== false, weDisabled = useDisabled && !btn.disabled;
  const box = group === undefined ? btn.parentElement : group;
  const others = box ? [...box.querySelectorAll('button, a.btn, [role="button"]')].filter(b => b !== btn && !b.classList.contains('lv-bz-dim')) : [];
  btn.style.width = `${Math.ceil(w)}px`;
  btn.style.setProperty('--lv-bz-ms', `${Math.max(300, ms)}ms`);
  btn.classList.add('lv-bz');
  btn.innerHTML = busyInnerHtml(old, word);
  if (weDisabled) btn.disabled = true;
  btn.setAttribute('aria-busy', 'true'); btn.setAttribute('aria-disabled', 'true');
  others.forEach(o => { o.classList.add('lv-bz-dim'); o.setAttribute('aria-disabled', 'true'); });
  // the card the button sits on gets a gold outline while it works (as the No Silent Clicks preview)
  const card = btn.closest('.card, .dsec, .rvwcard, .lv-card'); card?.classList.add('lv-work');
  let over = false;
  const restore = () => {
    card?.classList.remove('lv-work');
    others.forEach(o => { o.classList.remove('lv-bz-dim'); o.removeAttribute('aria-disabled'); });
    if (!btn.isConnected) return;
    // only put the label back if the button still shows the busy markup (a tool may have repainted it itself)
    const ours = !!btn.querySelector(':scope > .lv-bz-word');
    if (ours) btn.innerHTML = old;
    if (weDisabled && btn.disabled) btn.disabled = false;
    btn.removeAttribute('aria-disabled');
    btn.classList.remove('lv-bz', 'lv-bz-ok', 'lv-bz-bad'); btn.style.width = ''; btn.style.removeProperty('--lv-bz-ms');
    btn.removeAttribute('aria-busy');
  };
  // Safety net: if the tool puts its own label on the button (e.g. "Retry" after an error), the busy state ends at once,
  // so a button can never stay blocked.
  let mo = null;
  if (typeof MutationObserver !== 'undefined') {
    mo = new MutationObserver(() => { if (!btn.querySelector(':scope > .lv-bz-word')) { over = true; mo.disconnect(); restore(); } });
    mo.observe(btn, { childList: true });
  }
  const end = () => { mo?.disconnect(); };
  return {
    // success: snap to 100% + "✓ Added" for 1.2 s (shown even when the work took under 150 ms)
    done(text = '✓ Done') { if (over) return; over = true; btn.classList.add('lv-bz-ok'); btn.querySelectorAll('.lv-bz-word, .lv-bz-fw').forEach(x => { x.textContent = text; }); setTimeout(() => { end(); restore(); }, BUSY_DONE_MS); },
    // failure: the fill drains, the label comes back; the tool shows its error (with Retry)
    fail() { if (over) return; over = true; btn.classList.add('lv-bz-bad'); setTimeout(() => { end(); restore(); }, 420); },
    stop() { if (over) return; over = true; end(); restore(); }
  };
}
// Run fn with the button busy: done(okText) on success, fail() + rethrow on error.
export async function withBusy(btn, word, okText, fn, opts) {
  const b = busyButton(btn, word, opts);
  try { const r = await fn(); b.done(okText); return r; } catch (e) { b.fail(); throw e; }
}

// ---- an area (tab, panel section, Compare results, Refresh): 3px gold bar on its top edge + centred text.
// A % only when the job really reports progress (pct(n)); never a made-up number.
export function areaLoadingHtml(what) {
  return `<div class="lv-area" role="status" data-lv-area><span class="lv-area-bar" aria-hidden="true"><i></i></span><span class="lv-area-t"><b class="lv-area-pct" hidden></b><span>${escH(what)}</span></span></div>`;
}
export function areaLoading(el, what = 'Loading…') {
  if (!el) return { done() {}, fail() {}, pct() {} };
  el.classList.add('lv-area-host'); el.setAttribute('aria-busy', 'true');
  el.insertAdjacentHTML('beforeend', areaLoadingHtml(what));
  const ov = el.lastElementChild;
  const end = () => { ov.remove(); el.classList.remove('lv-area-host'); el.removeAttribute('aria-busy'); };
  return {
    pct(n) { const p = ov.querySelector('.lv-area-pct'); p.hidden = false; p.textContent = `${Math.max(0, Math.min(100, Math.round(n)))}%`; ov.querySelector('.lv-area-bar i').style.width = `${Math.max(0, Math.min(100, n))}%`; ov.classList.add('lv-area-real'); },
    done() { ov.classList.add('lv-area-done'); setTimeout(() => { end(); fadeIn(el.firstElementChild); }, 220); },
    fail(message, onRetry) { end(); el.insertAdjacentHTML('beforeend', loadErrorHtml(message)); const b = el.lastElementChild.querySelector('[data-lv-retry]'); if (onRetry) b.addEventListener('click', () => { el.lastElementChild.remove(); onRetry(); }, { once: true }); }
  };
}

// ---- long jobs: the progress card under the buttons (title, real typical time, real steps, the same gold bar)
export function fmtTypical(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `Usually about ${Math.max(5, Math.round(s / 5) * 5)} seconds`;
  const m = Math.round(s / 60);
  return `Usually about ${m} minute${m === 1 ? '' : 's'}`;
}
// st: { title, hint?, typicalMs, steps: [[key, label]], states: { key: 'run'|'ok'|'fail' }, details: { key: text }, long?, done?: {result, next}, error? }
export function progressCardHtml(st) {
  const stp = st.steps || [], states = st.states || {}, det = st.details || {};
  const items = stp.map(([k, label]) => { const s = states[k] || 'todo'; return `<li class="lv-pc-s ${s}" data-k="${escH(k)}"><span class="lv-pc-d" aria-hidden="true">${s === 'ok' ? '✓' : s === 'fail' ? '✕' : ''}</span><span>${escH(label)}${det[k] ? ` <span class="lv-pc-x">· ${escH(det[k])}</span>` : ''}</span></li>`; }).join('');
  const doneN = stp.filter(([k]) => states[k] === 'ok').length;
  const head = st.done ? `<p class="lv-pc-ok" role="status">✓ ${escH(st.done.result)}.${st.done.next ? ` Next: ${escH(st.done.next)}` : ''}</p>`
    : `<p class="lv-pc-t"><b>${escH(st.title)}</b><span>${escH(st.hint || fmtTypical(st.typicalMs || 40000))}</span></p>`;
  // st.elapsed (ms since the job started): a repaint carries on where it was (no restart, no second 150 ms wait)
  const el = Math.max(0, Number(st.elapsed) || 0), wait = !st.done && el < BUSY_DELAY_MS;
  return `<div class="lv-pc${st.done ? ' is-done' : ''}${st.error ? ' is-bad' : ''}${wait ? ' lv-pc-wait' : ''}" data-lv-pc role="group" aria-label="${escH(st.title)}"${wait ? ` style="--lv-pc-show:${BUSY_DELAY_MS - el}ms"` : ''}>${head}
    ${items ? `<ol class="lv-pc-steps">${items}</ol>` : ''}
    <span class="lv-pc-bar" aria-hidden="true"><i style="--lv-pc-ms:${Math.max(1000, st.typicalMs || 40000)}ms${el ? `;--lv-pc-delay:-${el}ms` : ''}${stp.length ? `;--lv-pc-min:${Math.round((doneN / stp.length) * 90)}%` : ''}"></i></span>
    ${(st.long || el >= LONG_NOTE_MS) && !st.done && !st.error ? `<p class="lv-pc-long" role="status">${escH(longNote(st.typicalMs))}</p>` : ''}</div>`;
}
export function progressCard(el, cfg) {
  const st = { states: {}, details: {}, ...cfg };
  let shown = false, timer = null, longT = null;
  const paint = () => { if (shown && el) { el.innerHTML = progressCardHtml(st); el.hidden = false; } };
  timer = setTimeout(() => { shown = true; paint(); }, BUSY_DELAY_MS);
  longT = setTimeout(() => { st.long = true; paint(); }, LONG_NOTE_MS);
  const stopT = () => { clearTimeout(timer); clearTimeout(longT); };
  return {
    state: st,
    step(key, state = 'run', detail) { st.states[key] = state; if (detail != null) st.details[key] = detail; if (state === 'run') for (const [k] of st.steps || []) { if (k === key) break; if (!st.states[k] || st.states[k] === 'run') st.states[k] = 'ok'; } paint(); },
    steps(states, details) { Object.assign(st.states, states || {}); Object.assign(st.details, details || {}); paint(); },
    done(result, next) { stopT(); for (const [k] of st.steps || []) if (st.states[k] !== 'fail') st.states[k] = 'ok'; st.done = { result, next }; shown = true; paint(); },
    fail(message, onRetry) { stopT(); st.error = message; if (!el) return; el.innerHTML = loadErrorHtml(message); el.hidden = false; const b = el.querySelector('[data-lv-retry]'); if (onRetry && b) b.addEventListener('click', () => onRetry(), { once: true }); },
    close() { stopT(); if (el) { el.innerHTML = ''; el.hidden = true; } }
  };
}

// =====================================================================================================================
// LONG JOBS (v2.5.0, Nov 2026): the working bar + the Done / Didn't work popup, one component for every long job in the
// three tools. PJ's previews "Claude outputs/LFMP_Working_Animation_Variations.html" variation B ("Commuter + witty
// lines") and "LFMP_Done_Card_Preview.html" (Working · Done · Didn't work · Came back later · Bell).
//   const job = startJob({ tool, kind, client, what, title, host, typicalMs, check })
//     kind    one of JOB_LINES' keys (the witty lines); client = the client's name (fills "<Client>" in the lines)
//     what    the job in a few words ("Re-read GHL"); title = the working line ("Reading X's pipelines from GHL…")
//     host    the element the working bar goes in (the card the button sits on), or a key: the bar then lives in
//             [data-lv-jobhost="<key>"] and moves back in by itself after the tool repaints that area; none = popup only
//     check   optional { repo, workflow, title, since } = the GitHub run it starts, so a job left behind (page closed, or
//             another tool) is finished when any of the three tools opens again ("Finished 4 min ago")
//   job.progress(0..1)   real progress when the job reports it (else the cyclist eases toward ~90%)
//   job.done({ title, lead, items: [[label, value]], next: { label, onClick } })   → green ✓ popup + bell
//   job.fail({ reason, nothingChanged, onRetry })                                  → red popup + bell
// While it runs: plain words + the gold bar with the cyclist (never a raw status). The popup stays until it's closed.
// Reduced motion: the plain gold bar, no cyclist, the first line only. Admin tools only: client pages never load this.
// Results are kept on this browser (localStorage "lfmp-jobs", PJ 20 Nov 2026), shared by the three tools.
// =====================================================================================================================
// One list of lines for every job (edit them here). "{client}" is replaced by the client's name.
export const JOB_LINES = {
  reread: ['Pedaling over to GHL…', 'Asking GHL nicely for your pipelines…', 'Counting your stages twice, just in case…', 'Legs burning. Nearly there…'],
  savemap: ['Tightening the bolts on your mapping…', 'Double-checking every stage…'],
  sync: ['Fetching the latest leads…', 'Rounding up the numbers…', 'Doing the math so you don\'t have to…'],
  create: ['Building {client}\'s new home in GHL…', 'Moving the furniture in (snapshot)…', 'Hanging the pictures…'],
  kpi: ['Lining up the numbers…', 'Wiring up {client}\'s dashboard…'],   // v2.8.0 (FIX 2.1): never the bar's own title
  menu: ['Hanging the KPI sign in GHL…'],
  review: ['Photocopying the workflows…', 'Reading the fine print in every email…'],
  publish: ['Delivering the new version to the client\'s page…', 'Wrapping it with a bow…'],
  remove: ['Tidying up…', 'Putting things back where they were…'],
  other: ['Pedaling…', 'Almost there…'],
};
export const JOB_SLOW_LINE = 'Uphill bit. Still pedaling.';
export const JOB_SLOW_MS = 60000, JOB_LINE_MS = 3000, JOB_TYPICAL_MS = 40000;
export const JOBS_KEY = 'lfmp-jobs', JOBS_KEEP = 30, JOBS_DAYS = 7, JOB_RESUME_MS = 2 * 3600e3;
export const jobLines = (kind, client = '') => (JOB_LINES[kind] || JOB_LINES.other).map(l => l.replace(/\{client\}/g, client || 'the client'));
// Where the cyclist is: real progress when known, else eases toward 90% (≈ 70% at the job's typical time).
export function jobPct({ elapsed, typicalMs = JOB_TYPICAL_MS, real = null }) {
  if (real != null && Number.isFinite(real)) return Math.max(0, Math.min(1, real));
  return 0.9 * (1 - Math.exp(-Math.max(0, elapsed) / Math.max(1000, typicalMs * 0.83)));
}
// The grey line under the title: rotates every ~3 s; one line for good once a job is past a minute.
export function jobLineAt(lines, elapsed) {
  if (elapsed >= JOB_SLOW_MS) return JOB_SLOW_LINE;
  return lines[Math.floor(Math.max(0, elapsed) / JOB_LINE_MS) % lines.length] || '';
}
export function agoText(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} hour${h === 1 ? '' : 's'} ago` : `${Math.round(h / 24)} day${h < 48 ? '' : 's'} ago`;
}

// ---- the job list on this browser (shared by the three tools)
const jobsStore = () => { try { return globalThis.localStorage || null; } catch { return null; } };
export function readJobs(store = jobsStore()) {
  try { const v = JSON.parse(store?.getItem(JOBS_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}
export function writeJobs(list, store = jobsStore(), now = Date.now()) {
  const keep = list.filter(j => now - (j.finishedAt || j.startedAt || 0) < JOBS_DAYS * 864e5).slice(-JOBS_KEEP);
  try { store?.setItem(JOBS_KEY, JSON.stringify(keep)); } catch {}
  if (hasDoc()) document.dispatchEvent(new CustomEvent('lfmp-jobs'));
  return keep;
}
export function patchJob(id, patch, store = jobsStore()) {
  const list = readJobs(store), j = list.find(x => x.id === id);
  if (!j) return null;
  Object.assign(j, typeof patch === 'function' ? patch(j) : patch);
  writeJobs(list, store);
  return j;
}
export const unseenJobs = (store = jobsStore()) => readJobs(store).filter(j => (j.status === 'done' || j.status === 'failed') && !j.seen);
export const runningJobs = (store = jobsStore()) => readJobs(store).filter(j => j.status === 'running');
const TOOL_PAGE = { builder: 'Clients', kpi: 'Scorecards', review: 'Reviews', reports: 'Reports' };   // v2.9.0: + Reports
// Which tool is in front (each shell notes it when it opens or comes back into view), for "while you were on Reviews".
export const JOBS_HERE_KEY = 'lfmp-here';
export function noteHere(tool, store = jobsStore()) { try { if (tool) store?.setItem(JOBS_HERE_KEY, tool); } catch {} }
const hereTool = (store = jobsStore()) => { try { return store?.getItem(JOBS_HERE_KEY) || ''; } catch { return ''; } };

// ---- the cyclist (inline SVG, ink + gold tokens; the same drawing as variation B)
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, parent) { const e = document.createElementNS(SVGNS, tag); for (const a in attrs) e.setAttribute(a, attrs[a]); parent?.appendChild(e); return e; }
function makeBike(host) {
  const s = svgEl('svg', { width: 53, height: 37, viewBox: '0 0 44 31', 'aria-hidden': 'true', focusable: 'false' }, host);
  const wheel = cx => { const g = svgEl('g', {}, s); svgEl('circle', { cx, cy: 24, r: 6.2, class: 'lv-jk-ink', 'stroke-width': 1.7 }, g); const sp = svgEl('g', {}, g); for (let i = 0; i < 3; i++) svgEl('line', { x1: cx - 6, y1: 24, x2: cx + 6, y2: 24, class: 'lv-jk-ink', 'stroke-width': 0.7, transform: `rotate(${i * 60} ${cx} 24)` }, sp); return sp; };
  const rw = wheel(9), fw = wheel(34);
  svgEl('path', { d: 'M9 24 L20 24 L16.5 12.5 Z M16.5 12.5 L30 12.5 L20 24 M30 12.5 L34 24 M29 12.5 L30.5 9.5 L33 9.5', class: 'lv-jk-gold', 'stroke-width': 1.8 }, s);
  svgEl('path', { d: 'M14.5 12 L19 12', class: 'lv-jk-ink', 'stroke-width': 2 }, s);
  const legB = svgEl('polyline', { class: 'lv-jk-ink', 'stroke-width': 2, opacity: 0.45 }, s);
  svgEl('path', { d: 'M16.5 10.5 L25 4.5 L31 9.5', class: 'lv-jk-ink', 'stroke-width': 2.1 }, s);
  svgEl('circle', { cx: 27, cy: 2.2, r: 2.6, class: 'lv-jk-inkf' }, s);
  const legF = svgEl('polyline', { class: 'lv-jk-ink', 'stroke-width': 2.1 }, s);
  const crank = svgEl('line', { class: 'lv-jk-ink', 'stroke-width': 1.4 }, s);
  const hip = [16.5, 10.5], c = [20, 24], R = 3.6, L1 = 8.6, L2 = 8.6;
  const leg = th => {
    const p = [c[0] + R * Math.cos(th), c[1] + R * Math.sin(th)];
    const dx = p[0] - hip[0], dy = p[1] - hip[1], d = Math.min(Math.hypot(dx, dy), L1 + L2 - 0.05);
    const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    const ux = dx / Math.hypot(dx, dy), uy = dy / Math.hypot(dx, dy), P = [hip[0] + a * ux, hip[1] + a * uy];
    const k1 = [P[0] + h * uy, P[1] - h * ux], k2 = [P[0] - h * uy, P[1] + h * ux], k = k1[0] > k2[0] ? k1 : k2;
    return `${hip} ${k} ${p}`;
  };
  return { w: 53, update(t, speed) {
    const th = t * speed * 7;
    legF.setAttribute('points', leg(th)); legB.setAttribute('points', leg(th + Math.PI));
    crank.setAttribute('x1', c[0] + R * Math.cos(th)); crank.setAttribute('y1', c[1] + R * Math.sin(th));
    crank.setAttribute('x2', c[0] - R * Math.cos(th)); crank.setAttribute('y2', c[1] - R * Math.sin(th));
    const r = (th * 57.3 * 1.3) % 360; rw.setAttribute('transform', `rotate(${r} 9 24)`); fw.setAttribute('transform', `rotate(${r} 34 24)`);
  } };
}

// ---- the working bar (markup: also used by tests and tools that repaint)
// The hint on the right: "usually under a minute", or the job's own typical time when it's longer ("usually about 2 minutes").
export const jobHint = typicalMs => { const m = Math.round((Number(typicalMs) || JOB_TYPICAL_MS) / 60000); return m <= 1 ? 'usually under a minute' : `usually about ${m} minutes`; };
export function workBarHtml({ title, hint = 'usually under a minute', line = '' }) {
  return `<div class="lv-job" data-lv-job role="status" aria-live="polite"><div class="lv-job-t"><b data-lv-job-title>${escH(title)}</b><span data-lv-job-hint data-base="${escH(hint)}">${escH(hint)}</span></div>
    <div class="lv-job-sub" data-lv-job-line>${escH(line)}</div>
    <div class="lv-job-track" aria-hidden="true"><div class="lv-job-bar"><i data-lv-job-fill></i></div></div></div>`;
}
// Mounts the bar in host and animates it. Returns { progress(p), finish(ok) → Promise (fills to 100% / stops), remove() }.
export const jobHostOf = key => (hasDoc() ? document.querySelector(`[data-lv-jobhost="${CSS.escape(key)}"]`) : null);
export function mountWorkBar(host, { title, hint, kind = 'other', client = '', typicalMs = JOB_TYPICAL_MS, t0 = Date.now() } = {}) {
  const key = typeof host === 'string' ? host : null;
  if (!hasDoc() || !host) return { progress() {}, finish: () => Promise.resolve(), remove() {}, el: null };
  // v2.8.0 (FIX 2.1): the line under the time is the job's rotating line, never a copy of the title
  const same = x => String(x || '').trim().toLowerCase(), all = jobLines(kind, client), lines = all.filter(l => same(l) !== same(title)).length ? all.filter(l => same(l) !== same(title)) : [JOB_LINES.other[0]], reduce = reducedMotion();
  const tpl = document.createElement('div'); tpl.innerHTML = workBarHtml({ title, hint: hint || jobHint(typicalMs), line: lines[0] });
  const el = tpl.firstElementChild;
  if (key) el.dataset.lvJobkey = key;
  // (re)attach: into the host element, or the current [data-lv-jobhost=key] (a repaint replaced the old one)
  const attach = () => {
    if (el.isConnected) return;
    const h = key ? jobHostOf(key) : host;
    if (!h) return;
    h.querySelectorAll(':scope > [data-lv-job]').forEach(x => { if (x !== el) x.parentNode.removeChild(x); });
    h.appendChild(el);
  };
  attach();
  const track = el.querySelector('.lv-job-track'), fill = el.querySelector('[data-lv-job-fill]'), sub = el.querySelector('[data-lv-job-line]');
  let real = null, raf = 0, timer = 0, gone = false, end = null, lineShown = lines[0], swap = 0;
  let rider = null, bike = null; const dusts = [];
  if (!reduce) {
    rider = document.createElement('div'); rider.className = 'lv-job-rider'; track.appendChild(rider); bike = makeBike(rider);
    for (let i = 0; i < 3; i++) { const d = document.createElement('div'); d.className = 'lv-job-dust'; track.appendChild(d); dusts.push(d); }
  } else el.classList.add('is-still');
  const pctNow = () => (end ? end.p : jobPct({ elapsed: Date.now() - t0, typicalMs, real }));
  const frame = ms => {
    if (gone) return;
    attach();
    const T = ms / 1000, W = track.clientWidth, p = pctNow();
    fill.style.width = `${(p * 100).toFixed(2)}%`;
    if (bike) {
      const x = Math.max(0, p * W - bike.w * 0.8);
      rider.style.transform = `translate(${x}px,${Math.sin(T * 14) * 0.4}px)`;
      bike.update(T, end ? 2.2 : 1.4);
      dusts.forEach((d, i) => { const ph = (T * 1.6 + i / 3) % 1; d.style.left = `${x - 2 - ph * 14}px`; d.style.width = `${6 - ph * 4}px`; d.style.bottom = `${5 + i * 3}px`; d.style.opacity = String((1 - ph) * 0.5); });
    }
    const want = jobLineAt(lines, Date.now() - t0);
    if (!reduce && want !== lineShown && !swap) {
      lineShown = want; sub.style.opacity = '0';
      swap = setTimeout(() => { swap = 0; if (!gone) { sub.textContent = want; sub.style.opacity = '1'; } }, 200);
    }
    raf = requestAnimationFrame(frame);
  };
  if (reduce) { const tick = () => { if (gone) return; attach(); fill.style.width = `${(pctNow() * 100).toFixed(2)}%`; }; tick(); timer = setInterval(tick, 500); }
  else raf = requestAnimationFrame(frame);
  const stop = () => { gone = true; cancelAnimationFrame(raf); clearInterval(timer); clearTimeout(swap); };
  return {
    el,
    progress(p) { real = p; },
    // ok: the gold fills to 100% (~0.45 s, the cyclist rides to the end); not ok: it stops where it is
    finish(ok = true) {
      if (gone) return Promise.resolve();
      if (!ok) { stop(); el.classList.add('is-bad'); return Promise.resolve(); }
      const from = pctNow(), t1 = Date.now();
      return new Promise(res => {
        if (reduce) { fill.style.width = '100%'; stop(); return res(); }
        end = { p: from };
        const step = () => { const k = Math.min(1, (Date.now() - t1) / 450); end.p = from + (1 - from) * (1 - (1 - k) ** 2); if (k < 1 && !gone) setTimeout(step, 16); else { stop(); fill.style.width = '100%'; res(); } };
        step();
      });
    },
    remove() { stop(); if (el.parentNode) el.parentNode.removeChild(el); },
  };
}

// ---- the popup (Done ✓ / Didn't work !), centred over a dimmed page; stays until Close / the next step / Try again
export function resultPopupHtml(r) {
  const ok = r.status !== 'failed';
  const items = ok && r.items?.length ? `<ul class="lv-res-list">${r.items.map(([k, v]) => `<li>${escH(k)}<span>${escH(v)}</span></li>`).join('')}</ul>` : '';
  const lead = ok ? (r.lead ? `<p>${escH(r.lead)}</p>` : '')
    : `<p>${escH(r.reason || 'Something went wrong.')}${typeof r.nothingChanged === 'string' && r.nothingChanged ? ` <b>Nothing changed:</b> ${escH(r.nothingChanged)}` : r.nothingChanged ? ' <b>Nothing changed.</b>' : ''}</p>`;
  const when = r.when ? `<span class="lv-res-when">${escH(r.when)}</span>` : '';
  const next = ok ? (r.next?.label ? `<button type="button" class="lv-res-pri" data-lv-res="next">${escH(r.next.label)}</button>` : '')
    : (r.retry ? `<button type="button" class="lv-res-pri" data-lv-res="retry">Try again</button>` : '');
  const close = `<button type="button" class="${!next && r.when ? 'lv-res-pri' : ''}" data-lv-res="close">${!next && r.when ? 'OK' : 'Close'}</button>`;
  return `<div class="lv-res-shade" data-lv-res-shade><div class="lv-res${ok ? '' : ' bad'}" role="alertdialog" aria-modal="true" aria-labelledby="lvResT" aria-describedby="lvResB" tabindex="-1">
    <div class="lv-res-ic" aria-hidden="true">${ok ? '✓' : '!'}</div><h3 id="lvResT">${escH(ok ? r.title || `Done: ${r.what || 'finished'}` : 'Didn\'t work')}</h3>
    <div id="lvResB">${lead}${items}${when}</div><div class="lv-res-bt">${close}${next}</div></div></div>`;
}
let resQueue = [], resOpen = null;
// Shows one result (queued if another is open). opts.onNext / opts.onRetry run after the popup closes.
export function showResult(r, opts) {
  const { onNext, onRetry, onClose } = opts || {};
  if (!hasDoc()) return;
  resQueue.push({ r, onNext, onRetry, onClose });
  if (!resOpen) nextResult();
}
function nextResult() {
  const it = resQueue.shift(); if (!it) { resOpen = null; return; }
  const prevFocus = document.activeElement;
  document.body.insertAdjacentHTML('beforeend', resultPopupHtml({ ...it.r, retry: !!it.onRetry }));
  const shade = document.body.lastElementChild, box = shade.querySelector('.lv-res');
  resOpen = shade; document.body.classList.add('lv-res-on');
  if (it.r.id) patchJob(it.r.id, { seen: true });
  const done = why => {
    shade.remove(); document.removeEventListener('keydown', onKey, true); document.body.classList.remove('lv-res-on');
    resOpen = null;
    try { prevFocus?.focus?.({ preventScroll: true }); } catch {}
    if (why === 'next') it.onNext?.(); else if (why === 'retry') it.onRetry?.(); else it.onClose?.();
    nextResult();
  };
  const onKey = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done('close'); return; }
    if (e.key === 'Tab') { const f = [...box.querySelectorAll('button')]; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
  };
  document.addEventListener('keydown', onKey, true);
  shade.addEventListener('click', e => { const b = e.target.closest('[data-lv-res]'); if (b) done(b.dataset.lvRes); });   // the dimmed page itself doesn't close it
  (box.querySelector('.lv-res-pri') || box.querySelector('button')).focus({ preventScroll: true });
}
export const resultOpen = () => !!resOpen;

// ---- one long job, start to finish
let jobSeq = 0;
export function startJob(o = {}) {
  const id = `j${Date.now().toString(36)}${(jobSeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const t0 = Date.now(), tool = o.tool || '';
  const entry = { id, tool, kind: o.kind || 'other', what: o.what || '', client: o.client || '', title: o.title || '', status: 'running', startedAt: t0,
    page: TOOL_PAGE[tool] || '', ...(o.check ? { check: { ...o.check, since: o.check.since || t0 } } : {}), ...(o.doneText ? { doneText: o.doneText } : {}) };
  writeJobs([...readJobs(), entry]);
  // v2.10.0 Done moments: a job started with moment: { tool, steps?, open?, workSub?, sub? } (Builder new client / Add existing
  // client, KPI admin New firm, Review admin package build) runs in the Done moments popup instead of the working bar, unless
  // the person's Animation is Classic (then exactly as before). Only on this browser: teammates never see or hear it.
  const M = o.moment && hasDoc() ? DN.openMoment({ tool: o.moment.tool || tool, client: o.client, steps: o.moment.steps, workSub: o.moment.workSub || (o.title ? `${o.title.replace(/…$/, '')}. You can hide this and keep working.` : undefined), sub: o.moment.sub, onOpen: o.moment.open, done: o.moment.done, mods: o.moment.mods }, { me: o.moment.me || null }) : null;
  const bar = o.host && !M ? mountWorkBar(o.host, { title: o.title || `${o.what || 'Working'}…`, hint: o.hint, kind: entry.kind, client: entry.client, typicalMs: o.typicalMs, t0 }) : null;
  let mp = 0, mLine = String(o.title || '').replace(/…$/, ''), mSteps = '';
  const mTick = () => M?.progress(mp, `${mLine}${mSteps}`);
  let over = false;
  const finishWith = async (status, r, cb) => {
    if (over) return; over = true;
    await bar?.finish(status === 'done');
    bar?.remove();
    const result = { ...r, status, what: entry.what, id, finishedAt: Date.now() };
    // v2.10.0: with the Done moments popup, success = the popup's finish (sound + voice; it waits if the tab is hidden), no
    // second result popup (the bell keeps the line, seen); a failure closes it and shows the usual Didn't work popup
    if (M) {
      if (status === 'done') { M.finish(); patchJob(id, { status, finishedAt: result.finishedAt, seen: true, result: { title: r.title, lead: r.lead, items: r.items, line: r.line, detail: r.detail } }); return; }
      M.fail();
    }
    const away = hasDoc() && document.visibilityState === 'hidden' ? hereTool() : '';
    patchJob(id, { status, finishedAt: result.finishedAt, ...(away ? { awayOn: away } : {}), result: { title: r.title, lead: r.lead, items: r.items, reason: r.reason, nothingChanged: r.nothingChanged, line: r.line, detail: r.detail } });
    if (cb?.onRetry) liveRetry.set(id, cb.onRetry);
    // shown now if this page is in front; otherwise it waits (visibilitychange / the next page load) as "Finished … ago"
    if (hasDoc() && document.visibilityState !== 'hidden') showResult(result, cb);
    else if (cb) pendingCbs.set(id, cb);
  };
  return {
    id, bar,
    moment: !!M,
    progress(p) { bar?.progress(p); mp = Math.max(mp, Number(p) || 0); mTick(); },
    line(title) { if (bar?.el) bar.el.querySelector('[data-lv-job-title]').textContent = title; mLine = String(title || '').replace(/…$/, ''); mTick(); },
    // v2.8.0 (one progress bar): the step count goes next to the time, "usually about 5 minutes · 6 of 9 steps"
    steps(done, total) { const h = bar?.el?.querySelector('[data-lv-job-hint]'); if (h) h.textContent = `${h.dataset.base}${total ? ` · ${done} of ${total} steps` : ''}`; mSteps = total ? ` · ${done} of ${total} steps` : ''; if (total) mp = Math.max(mp, done / total); mTick(); },
    // line / detail: the bell's one-line result ("Pipelines updated from GHL" · "12 stages · 1 new stage to map")
    done(r = {}) { return finishWith('done', { title: r.title || `Done: ${entry.what || 'finished'}`, lead: r.lead, items: r.items || [], next: r.next, line: r.line, detail: r.detail }, r.next?.onClick ? { onNext: r.next.onClick } : null); },
    fail(r = {}) { return finishWith('failed', { reason: r.reason || 'Something went wrong.', nothingChanged: r.nothingChanged || false, line: r.line, detail: r.detail }, r.onRetry ? { onRetry: r.onRetry } : null); },
    // the job ended without a result to show (cancelled by the user): no popup, nothing in the bell
    drop() { if (over) return; over = true; bar?.remove(); M?.fail(); writeJobs(readJobs().filter(j => j.id !== id)); },
  };
}
const pendingCbs = new Map(), liveRetry = new Map();   // liveRetry: "Try again" in the bell while the page that ran the job is open
export function retryJob(id) { const f = liveRetry.get(id); if (!f) return false; liveRetry.delete(id); f(); return true; }
// A finished job shown later (another tab was in front, the page was closed, another tool): "Finished 4 min ago, while you were on Reviews".
function laterResult(j, here) {
  const r = j.result || {};
  const away = Date.now() - (j.finishedAt || Date.now());
  const on = j.awayOn && j.awayOn !== j.tool ? j.awayOn : (here && j.tool && here !== j.tool ? here : '');
  const where = TOOL_PAGE[on] ? `, while you were on ${TOOL_PAGE[on]}` : '';
  return { ...r, status: j.status, what: j.what, id: j.id, title: r.title || `Done: ${j.what}`, when: away > 45000 ? `Finished ${agoText(away)}${where}` : '' };
}
export function showWaitingResults(tool) {
  for (const j of unseenJobs()) { const cb = pendingCbs.get(j.id); pendingCbs.delete(j.id); showResult(laterResult(j, tool), cb || {}); }
}
// Jobs this browser started and then left (page closed, reload, another tool): finished from their GitHub run, read only.
export async function resumeJobs({ gh = ghFetch, now = Date.now() } = {}) {
  for (const j of runningJobs()) {
    if (j.startedAt && now - j.startedAt > JOB_RESUME_MS) { patchJob(j.id, { status: 'failed', finishedAt: now, seen: true, result: { reason: 'It was started more than 2 hours ago and never reported back.' } }); continue; }
    if (!j.check?.repo || !j.check?.workflow || !j.check?.title) continue;
    if (Date.now() - j.startedAt < 15000) continue;   // the page that started it is probably still following it
    try {
      const r = await gh('GET', `/repos/${j.check.repo}/actions/workflows/${j.check.workflow}/runs?event=workflow_dispatch&per_page=20`);
      if (!r.ok) continue;
      const run = ((await r.json()).workflow_runs || []).find(x => x.display_title === j.check.title && Date.parse(x.created_at) >= (j.check.since || j.startedAt) - 60000);
      if (!run || run.status !== 'completed') continue;
      const ok = run.conclusion === 'success';
      patchJob(j.id, { status: ok ? 'done' : 'failed', finishedAt: Date.parse(run.updated_at) || now,
        result: ok ? { title: j.doneText?.title || `Done: ${j.what}`, lead: j.doneText?.lead || '' } : { reason: `GitHub stopped it (the run ended "${run.conclusion}"). Open the page and try again.` } });
    } catch {}
  }
}

// ---- the bell's "Recent jobs" (newest first). Builder and Review admin: the shell's own bell panel; KPI admin adds it
// to its sync-issues panel.
const clockOf = ms => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
export function jobLineOf(j) {
  const r = j.result || {};
  if (j.status === 'running') return `${j.what || 'Working'}…`;
  if (r.line) return r.line;
  if (j.status === 'failed') return `Didn't work: ${j.what}`;
  return String(r.title || `Done: ${j.what}`).replace(/^Done:\s*/, '').replace(/^./, c => c.toUpperCase());
}
export function jobsListHtml(list = readJobs(), now = Date.now()) {
  const items = list.filter(j => j.status !== 'running' || now - j.startedAt < JOB_RESUME_MS).slice().reverse().slice(0, 12);
  if (!items.length) return '<p class="lv-jobs-none">No recent jobs on this browser.</p>';
  return `<ul class="lv-jobs">${items.map((j, i) => {
    const st = j.status === 'running' ? 'run' : j.status === 'failed' ? 'bad' : 'ok';
    const when = j.status === 'running' ? `started ${clockOf(j.startedAt)}` : clockOf(j.finishedAt || now);
    const retry = j.status === 'failed' && liveRetry.has(j.id) ? ` · <button type="button" class="lv-jobs-retry" data-lv-jobretry="${escH(j.id)}">Try again</button>` : '';
    const sub = [j.client, j.result?.detail, when].filter(Boolean).map(escH).join(' · ');
    return `<li class="lv-jobs-it${i === 0 ? ' top' : ''}" data-lv-jobit="${escH(j.id)}"><span class="lv-jobs-d ${st}" aria-hidden="true"></span><div><b>${escH(jobLineOf(j))}</b><small>${sub}${retry}</small></div></li>`;
  }).join('')}</ul>`;
}
export const JOBS_BELL_KEY = 'lfmp-jobs-bell-at';
// Results that arrived since the bell was last opened (the badge counts them).
export function newJobResults(store = jobsStore()) {
  let at = 0; try { at = Number(store?.getItem(JOBS_BELL_KEY)) || 0; } catch {}
  return readJobs(store).filter(j => j.status !== 'running' && (j.finishedAt || 0) > at).length;
}
export function markJobsBellSeen(store = jobsStore(), now = Date.now()) { try { store?.setItem(JOBS_BELL_KEY, String(now)); } catch {} if (hasDoc()) document.dispatchEvent(new CustomEvent('lfmp-jobs')); }

// =====================================================================================================================
// CONFIRM FIRST (v2.6.0, Part 4): one small popup before anything that creates, publishes, sends or changes something
// outside the page, the same in the three tools. Quick read-only actions (Refresh, Copy, Open, filters) never ask.
//   const ok = await confirmAction({ title: 'Publish for Acme Law?', will: [['Client page', 'Link A / B show this version']],
//                                    wont: ['Nothing is sent to the client'], ok: 'Publish', danger, typeName, note })
//     will      [[where, what]]  exactly what happens and where (GitHub, GHL, Sheet, client page, this record…)
//     wont      [text]           what does NOT happen (e.g. "Nothing in GHL is deleted")
//     typeName  a name to type before the action button works (client-facing or data removals)
//     danger    red action button (removals)
// Cancel is the default (focused first; Esc and a click outside = Cancel): nothing runs. Resolves true / false.
// =====================================================================================================================
export const typedMatch = (typed, name) => String(typed || '').trim().replace(/\s+/g, ' ').toLowerCase() === String(name || '').trim().replace(/\s+/g, ' ').toLowerCase();
export function confirmHtml({ title, lead = '', will = [], wont = [], ok = 'OK', danger = false, typeName = '', note = '' }) {
  const row = ([where, what]) => `<li><b>${escH(where)}</b><span>${escH(what)}</span></li>`;
  return `<div class="lv-res-shade lv-cf-shade" data-lv-cf-shade><div class="lv-cf${danger ? ' danger' : ''}" role="dialog" aria-modal="true" aria-labelledby="lvCfT" tabindex="-1">
    <h3 id="lvCfT">${escH(title)}</h3>${lead ? `<p class="lv-cf-lead">${escH(lead)}</p>` : ''}
    ${will.length ? `<p class="lv-cf-h">${danger ? 'What goes' : 'What happens'}</p><ul class="lv-cf-list">${will.map(row).join('')}</ul>` : ''}
    ${wont.length ? `<p class="lv-cf-h">${danger ? 'What is kept' : 'What does not happen'}</p><ul class="lv-cf-list lv-cf-wont">${wont.map(t => `<li><span>${escH(t)}</span></li>`).join('')}</ul>` : ''}
    ${note ? `<p class="lv-cf-note">${escH(note)}</p>` : ''}
    ${typeName ? `<label class="lv-cf-type" for="lvCfIn"><span>Type <b>${escH(typeName)}</b> to confirm</span><input id="lvCfIn" type="text" autocomplete="off" spellcheck="false" placeholder="${escH(typeName)}"></label>` : ''}
    <div class="lv-res-bt"><button type="button" data-lv-cf="cancel">Cancel</button><button type="button" class="${danger ? 'lv-cf-red' : 'lv-res-pri'}" data-lv-cf="ok"${typeName ? ' disabled' : ''}>${escH(ok)}</button></div></div></div>`;
}
let cfOpen = null;
export const confirmOpen = () => !!cfOpen;
export function confirmAction(o = {}) {
  if (!hasDoc()) return Promise.resolve(false);
  if (cfOpen) return Promise.resolve(false);   // one question at a time
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    document.body.insertAdjacentHTML('beforeend', confirmHtml(o));
    const shade = document.body.lastElementChild, box = shade.querySelector('.lv-cf'), okBtn = box.querySelector('[data-lv-cf="ok"]'), inp = box.querySelector('#lvCfIn');
    cfOpen = shade; document.body.classList.add('lv-res-on');
    const end = yes => {
      if (!cfOpen) return;
      cfOpen = null; shade.parentNode?.removeChild(shade); document.removeEventListener('keydown', onKey, true); document.body.classList.remove('lv-res-on');
      try { prevFocus?.focus?.({ preventScroll: true }); } catch {}
      resolve(!!yes);
    };
    const onKey = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end(false); return; }
      if (e.key === 'Enter' && e.target === inp && !okBtn.disabled) { e.preventDefault(); end(true); return; }
      if (e.key === 'Tab') { const f = [...box.querySelectorAll('input,button:not([disabled])')]; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
    };
    document.addEventListener('keydown', onKey, true);
    if (inp) inp.addEventListener('input', () => { okBtn.disabled = !typedMatch(inp.value, o.typeName); });
    shade.addEventListener('click', e => {
      if (e.target === shade) { end(false); return; }   // a click outside = Cancel
      const b = e.target.closest('[data-lv-cf]'); if (!b || b.disabled) return;
      end(b.dataset.lvCf === 'ok' && (!o.typeName || typedMatch(inp?.value, o.typeName)));
    });
    (inp || box.querySelector('[data-lv-cf="cancel"]')).focus({ preventScroll: true });   // Cancel first (or the name to type)
  });
}

// =====================================================================================================================
// GREETING (v2.4.0, PJ's LFMP_Greeting_Final_1plus9.html). Once per person per day (their device's date), on the first
// page load of the day in any of the three tools: the page blurs behind a dark wash, the LFMP blocks drop in, the date,
// "GOOD AFTERNOON, PJ" letter by letter, a gold line, today's numbers count up, then it lifts away (~3.5 s). A click, tap
// or key ends it at once. Skipped with reduced motion, or when the day can't be remembered (storage blocked).
// Numbers: only the counts the tools already show (Reviews "Needs you", Scorecards "Needs attention", Clients "In
// progress"). A tool gives its own count (greet.count(): a promise). v2.4.1: when the greeting starts, the other two are
// read fresh at the same time (readOtherCount: that tool's greet-count module, the same reads and the same counting
// function as its filter, read only, through the team site). Whatever is in by the time the number row shows is used;
// a late or failed read falls back to the last count noted on this device (noteCount, 12 hours) or is left out. Every
// fresh count is noted, even a late one.
// =====================================================================================================================
export const GREET_DAY_KEY = 'lfmp-greet-day', GREET_COUNTS_KEY = 'lfmp-counts', MENU_HINT_KEY = 'lfmp-menu-hint-from';
export const GREET_WAIT_MS = 1000, GREET_MS = 3500, COUNT_FRESH_MS = 12 * 3600 * 1000, MENU_HINT_DAYS = 3;
export const GREET_KINDS = [   // [kind, tone, [label for 1, label otherwise (also under "All clear")]]
  ['reviews', 'r', ['review needs you', 'reviews need you']],
  ['scorecards', 'a', ['scorecard needs attention', 'scorecards need attention']],
  ['clients', '', ['client in progress', 'clients in progress']],
];
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const greetingFor = hour => (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
// The first name from the Google sign-in (the team site's "first"), else the same rule as the initials: "PJ" stays "PJ".
export function firstName(me) {
  if (me?.first) return String(me.first).trim();
  const words = String(me?.name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length) return words[0];
  const e = String(me?.email || '').replace(/@.*/, '').split(/[._-]+/)[0] || '';
  return e ? e[0].toUpperCase() + e.slice(1) : '';
}
// Should the greeting play now? Remembers today (first call of the day = true). Storage that throws = false (never plays).
export function claimGreetingDay(store = safeStorage(), now = new Date()) {
  try {
    if (!store) return false;
    const day = dayKey(now);
    if (store.getItem(GREET_DAY_KEY) === day) return false;
    store.setItem(GREET_DAY_KEY, day);
    return store.getItem(GREET_DAY_KEY) === day;
  } catch { return false; }
}
// v2.4.1: Sign out (only) forgets today's mark, so the next load after signing back in greets again.
export function forgetGreetingDay(store = safeStorage()) {
  try { store?.removeItem(GREET_DAY_KEY); } catch {}
}
// A tool notes its own count whenever its list loads, so the other two tools can show it in their greeting.
export function noteCount(kind, n, store = safeStorage(), now = Date.now()) {
  if (!GREET_KINDS.some(k => k[0] === kind) || !Number.isFinite(Number(n))) return;
  try { const all = JSON.parse(store.getItem(GREET_COUNTS_KEY) || '{}') || {}; all[kind] = { n: Number(n), at: now }; store.setItem(GREET_COUNTS_KEY, JSON.stringify(all)); } catch {}
}
export function cachedCounts(store = safeStorage(), now = Date.now()) {
  try {
    const all = JSON.parse(store.getItem(GREET_COUNTS_KEY) || '{}') || {}, out = {};
    for (const [k] of GREET_KINDS) { const c = all[k]; if (c && Number.isFinite(c.n) && now - c.at >= 0 && now - c.at < COUNT_FRESH_MS) out[k] = c.n; }
    return out;
  } catch { return {}; }
}
// v2.4.1: reads = one read or a list (each a function returning a promise of { reviews?, scorecards?, clients? }), all
// started at once. Resolves when all are in or after `wait` ms, whichever is first (never waits longer, never throws):
// the fresh counts over the cached ones. Every fresh count is noted for later, even one that comes in after `wait`.
// v2.4.2: server = the team site's answer (/api/greet-counts, readServerCounts), read at the same time. For each number:
// the team site's, unless a per-tool read came in first (fresher) → else the last known (≤ 12 h) → else left out.
// Resolves as soon as every number has an answer, or all reads are done, or at `wait`. A team-site number is noted only
// when no per-tool read beat it (it can be up to 10 minutes old).
const validN = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
export async function greetCounts(reads, { wait = GREET_WAIT_MS, store = safeStorage(), now = Date.now(), server = null } = {}) {
  const cached = cachedCounts(store, now), tool = {}, srv = {}, seq = { n: 0 };
  let wake = () => {};
  const allIn = () => GREET_KINDS.every(([k]) => k in tool || k in srv);
  const takeTool = o => { for (const [k] of GREET_KINDS) if (validN(o?.[k])) { tool[k] = { n: Number(o[k]), i: seq.n++ }; noteCount(k, tool[k].n, store); } if (allIn()) wake(); };
  const takeSrv = o => { for (const [k] of GREET_KINDS) if (validN(o?.[k])) { srv[k] = { n: Number(o[k]), i: seq.n++ }; if (!(k in tool)) noteCount(k, srv[k].n, store); } if (allIn()) wake(); };
  const run = (r, take) => Promise.resolve().then(() => (typeof r === 'function' ? r() : r)).then(take, () => {});
  const list = (Array.isArray(reads) ? reads : [reads]).filter(Boolean);
  const all = Promise.all([...list.map(r => run(r, takeTool)), ...(server ? [run(server, takeSrv)] : [])]);
  let timer;
  await Promise.race([all, new Promise(r => { wake = r; timer = setTimeout(r, wait); })]);
  clearTimeout(timer);
  const out = { ...cached };
  for (const [k] of GREET_KINDS) {
    const s = srv[k], t = tool[k];
    if (s && (!t || s.i < t.i)) out[k] = s.n; else if (t) out[k] = t.n;
  }
  return out;
}
// The team site's counts (/api/greet-counts: { counts: { clients: { hidden, shown, at }, … } }) → { clients: n, … },
// each by this browser's own "Show test clients" in that tool. Quiet: never sends anyone to sign in, never throws.
export const GREET_TESTS_KEYS = { clients: 'sab-show-tests', scorecards: 'leadpro-admin-tests', reviews: 'ar-admin-tests' };
export function pickServerCounts(res, store = safeStorage()) {
  const out = {};
  for (const [k] of GREET_KINDS) {
    const c = res?.counts?.[k]; if (!c) continue;
    let shown = false; try { shown = store?.getItem(GREET_TESTS_KEYS[k]) === '1'; } catch {}
    const v = shown ? c.shown : c.hidden; if (validN(v)) out[k] = Number(v);
  }
  return out;
}
export async function readServerCounts(store = safeStorage()) {
  const r = await lfmpFetch(`${API_BASE}greet-counts`, { method: 'POST', redirect: 'manual', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: '{}' });
  if (!r.ok) throw new Error(`greet-counts ${r.status}`);
  return pickServerCounts(await r.json(), store);
}
// v2.4.1: where each tool's count is read from (same team site). readCount gets the shell's own read helpers, so the
// module makes exactly the read-only calls its tool makes (GitHub and the review backend through /api/, never GHL).
export const GREET_SOURCES = { clients: '/ghl-subaccount-builder-page/greet-count.js', scorecards: '/leadpro-kpi/admin/greet-count.mjs', reviews: '/automation-review/admin/greet-count.mjs' };
export const TOOL_KIND = { builder: 'clients', kpi: 'scorecards', review: 'reviews' };
export function readOtherCount(kind) {
  return import(GREET_SOURCES[kind])
    .then(m => m.readCount({ ghFetch, api, loadBuilderRecords, store: safeStorage() }))
    .then(o => ({ [kind]: o?.[kind] }));
}
// The greeting's reads for a tool: its own count (from its own list load) + the other two, read fresh.
export function greetReads(tool, own, readOther = readOtherCount) {
  const mine = TOOL_KIND[tool];
  return [own, ...GREET_KINDS.map(([k]) => k).filter(k => k !== mine).map(k => () => readOther(k))].filter(Boolean);
}
const lettersHtml = (text, cls, from) => {
  let i = from;
  return String(text).split(' ').map(w => { const h = `<span class="lv-gr-wd">${[...w].map(c => `<span class="${cls}" style="--i:${i++}">${escH(c)}</span>`).join('')}</span>`; i++; return h; }).join(' ');
};
// Pure: the greeting's HTML. counts: { reviews, scorecards, clients } (missing = left out; 0 = green "All clear").
export function greetingHtml({ hour, date = new Date(), name = '', counts = {} }) {
  const hello = greetingFor(hour), head = `${hello.toUpperCase()},`;
  const eyebrow = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  // review FIX 3.1: "All clear" keeps the item's own label under it ("All clear · clients in progress")
  const items = GREET_KINDS.filter(([k]) => Number.isFinite(counts[k])).map(([k, tone, [one, many]]) => counts[k] === 0
    ? `<div class="ok" data-k="${k}"><em>All clear</em>${escH(many)}</div>`
    : `<div class="${tone}" data-k="${k}"><em data-to="${counts[k]}">0</em>${escH(counts[k] === 1 ? one : many)}</div>`).join('');
  return `<div class="lv-gr" data-lv-greet role="dialog" aria-modal="true" aria-label="${escH(`${hello}${name ? `, ${name}` : ''}`)}">
<div class="lv-gr-grp"><div class="lv-gr-mk" aria-hidden="true"><i></i><i></i><i></i></div><div class="lv-gr-eb">${escH(eyebrow)}</div>
<div class="lv-gr-gn" aria-hidden="true">${lettersHtml(head, 'l', 0)}${name ? ` <br class="lv-gr-br">${lettersHtml(name, 'l nm', head.length + 1)}` : ''}</div>
<div class="lv-gr-ul"></div>${items ? `<div class="lv-gr-st">${items}</div>` : ''}</div>
<div class="lv-gr-skip">Tap anywhere to skip</div></div>`;
}
// Plays it (if today is unclaimed). Resolves when it has gone (true = it played). Never blocks clicks after it ends.
// It starts at once (never waits for a number): with the counts remembered from the tools' last loads (12 h), and the
// fresh counts (reads: the tool's own + the other two, v2.4.1) join if they arrive before the number row shows
// (STATS_AT); later = the remembered one or left out. No spinner, no error. count = a single read (older callers).
export const STATS_AT = 1450;
export async function playGreeting({ me, count, reads = count, server = null, store = safeStorage(), now = new Date(), onEnd } = {}) {
  if (!hasDoc() || reducedMotion() || !claimGreetingDay(store, now)) return false;
  document.querySelector('[data-lv-greet]')?.remove();
  document.body.insertAdjacentHTML('beforeend', greetingHtml({ hour: now.getHours(), date: now, name: firstName(me), counts: cachedCounts(store, now.getTime()) }));
  const el = document.querySelector('[data-lv-greet]'), t0 = Date.now();
  // v2.10.0 Voice greeting (Done moments → Voice greeting On): the Done moments voice reads it out, once. Chrome speaks only
  // after a click / tap / key: right away if this page has had one, else on the first one while the greeting shows (the
  // tap-to-skip counts); never after it has ended. Independent of Animation (Classic doesn't turn it off).
  const ds = DN.readDone(store, me);
  let curCounts = cachedCounts(store, now.getTime()), spoken = false;
  const sayIt = () => { if (spoken || ds.greet !== 'on' || !el.isConnected || el.classList.contains('gone')) return; spoken = true; DN.speakText(ds, DN.greetVoiceText({ hour: now.getHours(), settings: ds, first: firstName(me), counts: curCounts })); };
  return new Promise(resolve => {
    let done = false;
    const timers = [];
    const finish = () => { if (done) return; done = true; timers.forEach(clearTimeout); document.removeEventListener('keydown', onKey, true); el.remove(); onEnd?.(); resolve(true); };
    const skip = e => { e?.preventDefault?.(); e?.stopPropagation?.(); if (done || el.classList.contains('out')) return; sayIt(); el.classList.add('out'); timers.push(setTimeout(finish, 420)); };
    const onKey = e => skip(e);
    el.addEventListener('pointerdown', skip); el.addEventListener('click', skip);
    document.addEventListener('keydown', onKey, true);
    // the numbers count up from 1.5 s (at most 5 steps, 200 ms apart)
    const countUp = () => { for (const n of el.querySelectorAll('[data-to]:not([data-up])')) {
      n.dataset.up = '1';
      const to = Number(n.dataset.to), steps = Math.min(to, 5);
      for (let s = 1; s <= steps; s++) timers.push(setTimeout(() => { n.textContent = String(Math.round((to * s) / steps)); }, Math.max(0, 1500 + s * 200 - (Date.now() - t0))));
    } };
    countUp();
    // the fresh counts that come in time (merged over the remembered ones)
    greetCounts(reads, { wait: Math.max(0, STATS_AT - 100), store, now: now.getTime(), server }).then(counts => {
      const late = Date.now() - t0;
      if (!done) curCounts = { ...curCounts, ...counts };   // v2.10.0: the voice says the freshest counts it has
      if (done || late > STATS_AT - 60) return;
      const t = document.createElement('template'); t.innerHTML = greetingHtml({ hour: now.getHours(), date: now, counts });
      const row = t.content.querySelector('.lv-gr-st'); if (!row) return;
      row.style.animationDelay = `${STATS_AT - late}ms`;
      const old = el.querySelector('.lv-gr-st');
      if (old) old.replaceWith(row); else el.querySelector('.lv-gr-ul')?.after(row);
      countUp();
    });
    requestAnimationFrame(() => el.classList.add('play'));
    if (ds.greet === 'on' && globalThis.navigator?.userActivation?.hasBeenActive) timers.push(setTimeout(sayIt, STATS_AT));   // v2.10.0
    timers.push(setTimeout(finish, GREET_MS));
  });
}
// "Your menu ›" under the initials for ~2 s after the greeting, only in the first 3 days after this release (per device).
export function menuHintDue(store = safeStorage(), now = new Date()) {
  try {
    let from = store.getItem(MENU_HINT_KEY);
    if (!from) { from = dayKey(now); store.setItem(MENU_HINT_KEY, from); }
    const [y, m, d] = from.split('-').map(Number), start = new Date(y, m - 1, d);
    return (new Date(now.getFullYear(), now.getMonth(), now.getDate()) - start) / 86400000 < MENU_HINT_DAYS;
  } catch { return false; }
}

// Mount the shell on a page. root: the app container (the desktop top bar goes first inside it).
export function mountShell(cfg) {
  const doc = document, html = doc.documentElement, root = cfg.root || doc.body;
  html.classList.add('lfmp-v2');
  // v2.5.0: every tool has a bell. A tool without its own (Builder, Review admin) gets the shell's: recent jobs.
  if (!cfg.bell) cfg = { ...cfg, bell: { jobs: true, label: 'Notifications' } };
  const st = { theme: getTheme(), showTests: !!cfg.showTests?.on, updated: cfg.updated || '', newsDot: !!cfg.newsDot, bell: Number(cfg.bellCount) || 0, meOpen: false, done: DN.readDone(undefined, cfg.me), rs: null };
  const bellTotal = () => st.bell + newJobResults();
  const full = () => ({ ...cfg, newsDot: st.newsDot, bellCount: bellTotal() });
  doc.querySelectorAll('[data-lv-top],[data-lv-ptop],[data-lv-tabs],[data-lv-me]').forEach(n => n.remove());
  root.insertAdjacentHTML('afterbegin', topBarHtml(full()) + phoneBarHtml(full()));
  doc.body.insertAdjacentHTML('beforeend', `${tabsHtml(cfg)}<div class="lv-mescreen" data-lv-me role="dialog" aria-label="Me" tabindex="-1" hidden></div>`);
  doc.body.classList.add('lv-has-tabs');
  const $$ = s => [...doc.querySelectorAll(s)];
  const scr = doc.querySelector('[data-lv-me]');
  const isPhone = () => matchMedia(`(max-width:${PHONE_MAX}px)`).matches;
  // v2.4.0: the initials open the name menu (a popover) on desktop AND phone; the phone's Me tab opens the Me screen
  const pops = () => $$('[data-lv-pop]');
  const openPop = () => pops().find(p => !p.hidden);
  const barSel = s => `${isPhone() ? '[data-lv-ptop]' : '[data-lv-top]'} ${s}`;
  const paintMe = () => {
    for (const p of pops()) if (!p.hidden) p.innerHTML = meHtml(cfg, st, { compact: true });
    if (!scr.hidden) scr.innerHTML = phoneBarHtml({ ...full(), meScreen: true, plus: null, bell: false }, 'Me') + meHtml(cfg, st);
  };
  const setTabs = () => { const old = doc.querySelector('[data-lv-tabs]'); old.outerHTML = tabsHtml(cfg, st.meOpen); };
  const meBtnOf = p => p?.closest('[data-lv-avwrap]')?.querySelector('[data-lv="me"]');
  const closePop = () => { for (const p of pops()) if (!p.hidden) { p.hidden = true; meBtnOf(p)?.setAttribute('aria-expanded', 'false'); } };
  const closeScreen = () => { if (!scr.hidden) { scr.hidden = true; st.meOpen = false; doc.body.classList.remove('lv-me-open'); setTabs(); } };
  const closeMe = () => { closePop(); closeScreen(); };
  const hideMenuHint = () => $$('[data-lv-mhint]').forEach(h => { h.hidden = true; h.classList.remove('show'); });
  const openPopFor = p => {
    if (!p) return;
    closeScreen(); hideMenuHint();
    p.hidden = false; paintMe(); meBtnOf(p)?.setAttribute('aria-expanded', 'true');
    p.focus({ preventScroll: true });   // focus moves into the menu (no ring on a tap; Tab then walks its items)
  };
  const openScreen = () => { closePop(); scr.hidden = false; st.meOpen = true; doc.body.classList.add('lv-me-open'); paintMe(); setTabs(); scr.scrollTop = 0; scr.focus({ preventScroll: true }); };
  const openMe = () => openPopFor(doc.querySelector(barSel('[data-lv-pop]')));   // the name menu on the bar that's showing
  // "Your menu ›" under the initials for ~2.6 s (after the greeting, first 3 days of this release)
  const showMenuHint = () => {
    const h = doc.querySelector(barSel('[data-lv-mhint]')); if (!h || openPop()) return;
    h.hidden = false; h.classList.add('show'); setTimeout(() => { h.hidden = true; h.classList.remove('show'); }, 2600);
  };
  const install = () => {
    if (window.LFMPApp?.openInstall) return window.LFMPApp.openInstall();
    let d = doc.getElementById('lfmpInstall'); d?.remove();
    d = doc.createElement('dialog'); d.className = 'lfmp-dlg'; d.id = 'lfmpInstall';
    d.innerHTML = `<div class="lfmp-dlg-h"><div><h2>Install the app</h2></div><button class="lfmp-out" type="button" data-lfmp-close>Close</button></div><p class="lfmp-dlg-b">Open the LFMP tools site (lfmp-admin.pages.dev) to install it: on an iPhone, Safari → Share → Add to Home Screen; on a Mac, Safari File → Add to Dock, or Chrome ⋮ → Cast, save and share → Install page as app.</p>`;
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-lfmp-close]')) d.close(); });
    doc.body.append(d); d.showModal();
  };
  const onClick = e => {
    // links back to this tool (LFMP icon, its own nav item / tab): close Me and let the tool go home without a reload
    const home = e.target.closest('[data-lv-home]');
    if (home && !e.metaKey && !e.ctrlKey && !e.shiftKey && (cfg.onHome || st.meOpen)) { e.preventDefault(); closeMe(); cfg.onHome?.(); return; }
    const b = e.target.closest('[data-lv]');
    if (!b) { if (openPop() && !e.target.closest('[data-lv-pop]')) closePop(); return; }   // a click outside closes the menu
    const a = b.dataset.lv;
    if (a === 'me') {
      if (b.closest('[data-lv-me]')) { closeScreen(); return; }   // the avatar on the Me screen closes it
      const p = b.closest('[data-lv-avwrap]')?.querySelector('[data-lv-pop]');
      if (p && !p.hidden) closePop(); else openPopFor(p);
    }
    else if (a === 'metab') { st.meOpen ? closeScreen() : openScreen(); }
    else if (a === 'plus') { closeMe(); cfg.plus?.onClick?.(e); }
    else if (a === 'bell') { closeMe(); if (cfg.bell?.jobs) toggleJobsPop(b); else cfg.bell?.onClick?.(b, e); }
    else if (a === 'signout') { signOut(); }
    else if (a === 'theme') { st.theme = setTheme(b.dataset.v); paintMe(); doc.querySelector(`[data-lv="theme"][data-v="${st.theme}"]`)?.focus(); }
    else if (a === 'tests') { st.showTests = !st.showTests; paintMe(); doc.querySelector('[data-lv="tests"]')?.focus(); cfg.showTests?.onChange?.(st.showTests); }
    else if (a === 'refresh') { cfg.onRefresh?.(); }
    else if (a === 'signins') { closeMe(); openTeamSignins(); }
    else if (a === 'news') { closeMe(); cfg.onNews?.(); }
    else if (a === 'install') { closeMe(); install(); }
    else if (a === 'rsettings') {   // v2.12.0: the Builder's Reports settings (from the KPI / Review admin: the team site's Builder)
      closeMe();
      if (cfg.tool === 'builder' && location.pathname.startsWith('/ghl-subaccount-builder-page/')) location.hash = '#reports/settings';
      else location.href = REPORTS_SETTINGS_URL;
    }
    else if (a === 'done') {   // v2.10.0: the Done moments settings (side panel; a full screen on a phone)
      closeMe();
      DN.openDonePanel({ me: cfg.me, onChange: s => { st.done = s; paintMe(); },
        greetSample: s => DN.greetVoiceText({ settings: s, first: firstName(cfg.me), counts: cachedCounts(safeStorage(), Date.now()) }) });
    }
  };
  // v2.5.0: the shell's own bell panel (Builder, Review admin): recent jobs on this browser
  const jobsPop = () => doc.querySelector('[data-lv-jobpop]');
  const closeJobsPop = () => { const p = jobsPop(); if (!p) return; p.parentNode.removeChild(p); $$('[data-lv="bell"]').forEach(x => x.setAttribute('aria-expanded', 'false')); };
  const toggleJobsPop = btn => {
    if (jobsPop()) { closeJobsPop(); return; }
    const wrap = btn.closest('[data-lv-bellwrap]');
    wrap.insertAdjacentHTML('beforeend', `<div class="lv-jobpop" data-lv-jobpop role="dialog" aria-label="Recent jobs" tabindex="-1">${jobsListHtml()}</div>`);
    btn.setAttribute('aria-expanded', 'true'); markJobsBellSeen(); jobsPop().focus({ preventScroll: true });
  };
  doc.addEventListener('click', e => {
    const rt = e.target.closest('[data-lv-jobretry]'); if (rt) { closeJobsPop(); retryJob(rt.dataset.lvJobretry); return; }
    if (jobsPop() && !e.target.closest('[data-lv-jobpop]') && !e.target.closest('[data-lv="bell"]')) closeJobsPop();
  });
  const paintBell = () => { const n = bellTotal(); $$('[data-lv-badge]').forEach(x => { x.textContent = n; x.hidden = !n; }); $$('[data-lv="bell"]').forEach(x => x.setAttribute('aria-label', `${cfg.bell?.label || 'Notifications'}${n ? `: ${n}` : ''}`)); const p = jobsPop(); if (p) p.innerHTML = jobsListHtml(); };
  doc.addEventListener('lfmp-jobs', paintBell);
  addEventListener('storage', e => { if (e.key === JOBS_KEY || e.key === JOBS_BELL_KEY) paintBell(); });
  // v2.12.0: "N of 5 connected" for the Reports settings row (one small read per page; any failure = just "›")
  if (cfg.reportsSettings !== false && typeof fetch === 'function') fetch(RS_COUNT_URL, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(r => (r.ok ? r.json() : null)).then(j => { if (Number.isInteger(j?.connected)) { st.rs = j.connected; paintMe(); } }).catch(() => {});
  noteHere(cfg.tool);
  doc.addEventListener('visibilitychange', () => { if (doc.visibilityState !== 'visible') return; noteHere(cfg.tool); if (!doc.querySelector('[data-lv-greet]')) showWaitingResults(cfg.tool); });
  doc.addEventListener('click', onClick);
  const onKey = e => {
    if (e.key === 'Escape' && jobsPop()) { closeJobsPop(); doc.querySelector(barSel('[data-lv="bell"]'))?.focus(); return; }
    if (e.key === 'Escape' && (openPop() || !scr.hidden)) { const btn = meBtnOf(openPop()) || doc.querySelector(barSel('[data-lv="me"]')); closeMe(); btn?.focus(); return; }
    // list rows are role="button": Enter / Space open them like a click
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('lv-row')) { e.preventDefault(); e.target.click(); }
  };
  doc.addEventListener('keydown', onKey);
  const api = {
    cfg, st, openMe, closeMe, isPhone, install,
    // v2.5.0: the badge = the tool's own count (KPI admin's sync issues) + job results since the bell was last opened
    setBell(n) { st.bell = Number(n) || 0; paintBell(); },
    paintBell,
    setUpdated(t) { if ((t || '') === st.updated) return; st.updated = t || ''; paintMe(); },
    // the "new" dot is only on the What's new row inside Me (no dot on the avatar: not in the reference)
    setNewsDot(on) { st.newsDot = !!on; paintMe(); },
    setShowTests(v) { st.showTests = !!v; paintMe(); },
    setTitle(t) { $$('[data-lv-title]').forEach(h => { h.textContent = t; }); },
    bellWrap() { return doc.querySelector(isPhone() ? '[data-lv-ptop] [data-lv-bellwrap]' : '[data-lv-top] [data-lv-bellwrap]'); },
    destroy() { doc.removeEventListener('click', onClick); doc.removeEventListener('keydown', onKey); },
    openScreen, showMenuHint,
  };
  // v2.4.0: the once-a-day greeting. cfg.greet: { count: () => Promise<{ reviews?, scorecards?, clients? }> } (the tool's
  // own count); greet: false = never (e.g. a reset / offline page). v2.4.1: the other two tools' counts are read fresh.
  api.greeting = cfg.greet === false ? Promise.resolve(false)
    : playGreeting({ me: cfg.me, reads: greetReads(cfg.tool, cfg.greet?.count, cfg.greet?.readOther), server: cfg.greet?.server || (() => readServerCounts()), onEnd: () => { if (menuHintDue()) showMenuHint(); } }).catch(() => false);
  // v2.5.0: results that finished while you were away (another tab, a closed page, another tool) show after the greeting;
  // jobs a closed page left running are finished from their GitHub run (read only).
  if (cfg.jobs !== false) api.greeting.then(() => { showWaitingResults(cfg.tool); return resumeJobs(); }).then(() => { paintBell(); showWaitingResults(cfg.tool); }).catch(() => {});
  paintBell();
  return api;
}
