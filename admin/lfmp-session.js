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

export const TOOLS = [
  { id: 'builder', name: 'Builder', path: '/ghl-subaccount-builder-page/' },
  { id: 'kpi', name: 'Scorecards', path: '/leadpro-kpi/admin/' },
  { id: 'review', name: 'Review', path: '/automation-review/admin/' },
];
export const SIGNIN = '/signin/';
export const LOGOUT = '/cdn-cgi/access/logout';   // Cloudflare Access logout (ends the Access session)
export const SIGNED_OUT = '/signin/?out=1';
const API_BASE = '/api/';

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
export async function signOut() {
  clearLegacy(); leaving = true;
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
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
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
    const { people } = await api('signins');
    d.innerHTML = `${head}<div class="lfmp-dlg-b">${people.length ? `<table class="lfmp-signins"><thead><tr><th scope="col">Name</th><th scope="col">Email</th><th scope="col">Last sign-in</th><th scope="col">Sign-ins (30 days)</th></tr></thead><tbody>${people.map(p => `<tr><td data-l="Name"><b>${escH(p.name)}</b></td><td data-l="Email">${escH(p.email)}</td><td data-l="Last sign-in">${escH(fmtSignIn(p.last))}</td><td data-l="Sign-ins (30 days)">${Number(p.count30) || 0}</td></tr>`).join('')}</tbody></table>` : '<p class="mut">No sign-ins recorded yet.</p>'}<p class="mut lfmp-dlg-note">Google sign-ins to the LFMP tools in the last 90 days. Kept on the team site only, never in a repo.</p></div>`;
  } catch (e) {
    d.innerHTML = `${head}<p class="lfmp-dlg-b lfmp-err" role="alert">${escH(e.message || "Couldn't load the sign-ins.")}</p>`;
  }
  d.querySelector('[data-lfmp-close]')?.focus();
}
if (typeof document !== 'undefined') document.addEventListener('click', e => { if (e.target.closest?.('[data-act="signins"]')) openTeamSignins(); });

// One POST to /api/<name>. redirect: 'manual' so an expired Google sign-in (Access answers with a redirect to its login
// page) shows up as "signed out" instead of a confusing network error.
async function post(name, body) {
  let r;
  try {
    r = await fetch(`${API_BASE}${name}`, { method: 'POST', redirect: 'manual', credentials: 'same-origin', cache: 'no-store',
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
export const SHELL_TOOLS = [
  { id: 'builder', label: 'Clients', title: 'Clients', path: '/ghl-subaccount-builder-page/', plus: 'New sub-account',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/></svg>' },
  { id: 'kpi', label: 'Scorecards', title: 'Scorecards', path: '/leadpro-kpi/admin/', plus: 'New firm',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 20V11M12 20V5M18 20v-6"/></svg>' },
  { id: 'review', label: 'Reviews', title: 'Reviews', path: '/automation-review/admin/', plus: null,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>' },
];
export const ME_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>';
export const SEARCH_ICON = '<svg class="lv-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>';
export const PHONE_MAX = 879.98;   // phone layout below 880px (same as lfmp-ui.css)
export const THEMES = [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']];
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
const bellHtml = n => `<span class="lv-bellwrap" data-lv-bellwrap><button type="button" class="lv-bell lv-hit" data-lv="bell" aria-haspopup="dialog" aria-expanded="false" aria-label="Sync issues${n ? `: ${n}` : ''}"><span class="lv-bi" aria-hidden="true">🔔</span><b class="lv-badge" data-lv-badge${n ? '' : ' hidden'}>${Number(n) || 0}</b></button></span>`;

// Desktop top bar: icon + LFMP · Clients / Scorecards / Reviews · [bell] · gold + · name + Last signed in · avatar · Sign out
export function topBarHtml(cfg) {
  const t = toolOf(cfg.tool), me = cfg.me || {};
  return `<header class="lv-top" data-lv-top>
  <a class="lv-mk" href="${t.path}" data-lv-home aria-label="LFMP · ${escH(t.label)}"><i></i><i></i><i></i></a><a class="lv-brand" href="${t.path}" data-lv-home>LFMP</a>
  <nav class="lv-nav" aria-label="LFMP tools">${SHELL_TOOLS.map(x => `<a href="${x.path}"${x.id === t.id ? ' aria-current="page" data-lv-home' : ''}>${x.label}</a>`).join('')}</nav>
  <div class="lv-rt">${cfg.bell ? bellHtml(cfg.bellCount) : ''}${cfg.plus ? `<button type="button" class="lv-plus" data-lv="plus">+ ${escH(cfg.plus.label || t.plus)}</button>` : ''}
    <div class="lv-who"><div><div class="lv-n" data-me>${escH(me.name || me.email || '')}</div><div class="lv-l" data-me-last>${escH(lastSignInText(me))}</div></div>
      <span class="lv-avwrap"><button type="button" class="lv-avbtn" data-lv="me" aria-haspopup="menu" aria-expanded="false" aria-label="Your menu: theme, test clients, refresh, team, what's new">${avHtml(me, cfg.newsDot)}</button><div class="lv-pop" data-lv-pop role="menu" aria-label="Your menu" tabindex="-1" hidden></div></span></div>
    <button type="button" class="lv-so" data-lv="signout">Sign out</button></div>
</header>`;
}

// Phone top bar: band · icon · TITLE · [bell] · gold round + · avatar (the avatar opens Me)
export function phoneBarHtml(cfg, title) {
  const t = toolOf(cfg.tool);
  const plus = cfg.plus && !cfg.meScreen ? `<button type="button" class="lv-pplus lv-hit" data-lv="plus" aria-label="${escH(cfg.plus.label || t.plus)}">+</button>` : '';
  return `<div class="lv-ptop"${cfg.meScreen ? '' : ' data-lv-ptop'}><div class="lv-band"></div><div class="lv-bb"><a class="lv-mk lv-hit" href="${t.path}" data-lv-home aria-label="LFMP · ${escH(t.label)}"><i></i><i></i><i></i></a><h2${cfg.meScreen ? '' : ' data-lv-title'}>${escH(title ?? t.title)}</h2><div class="lv-ic">${cfg.bell && !cfg.meScreen ? bellHtml(cfg.bellCount) : ''}${plus}<button type="button" class="lv-avbtn lv-hit" data-lv="me" aria-label="Me: theme, test clients, refresh, team, what's new">${avHtml(cfg.me, cfg.newsDot)}</button></div></div></div>`;
}

// Bottom tabs: Clients · Scorecards · Reviews · Me (gold = where you are)
export function tabsHtml(cfg, meOpen = false) {
  return `<nav class="lv-tabs" data-lv-tabs aria-label="LFMP tools">${SHELL_TOOLS.map(x => `<a class="lv-tab" href="${x.path}"${x.id === cfg.tool ? `${meOpen ? '' : ' aria-current="page"'} data-lv-home` : ''}>${x.icon}${x.label}</a>`).join('')}<button type="button" class="lv-tab" data-lv="metab"${meOpen ? ' aria-current="page"' : ''}>${ME_ICON}Me</button></nav>`;
}

// The Me content (same on the desktop popover and the phone Me screen).
export function meHtml(cfg, st = {}) {
  const me = cfg.me || {};
  const theme = st.theme || 'auto';
  const row = (lv, label, value = '', more = '') => `<button type="button" class="lv-mi" data-lv="${lv}" role="menuitem"${more}><span>${escH(label)}</span><span class="lv-v">${value}</span></button>`;
  return `<div class="lv-me-who">${avHtml(me, false)}<div><div class="lv-n">${escH(me.name || me.email || '')}</div><div class="lv-l">${escH(lastSignInText(me))}</div></div></div>
<p class="lv-gl">Settings</p><div class="lv-mlist">
  <div class="lv-mi" role="presentation"><span id="lvThemeL">Theme</span><div class="lv-sw" role="group" aria-labelledby="lvThemeL">${THEMES.map(([k, l]) => `<button type="button" class="lv-hit" data-lv="theme" data-v="${k}" aria-pressed="${k === theme}">${l}</button>`).join('')}</div></div>
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

// Page head: title + summary (desktop), search (always), segmented filter. segs: [{ key, label, phone, red }]
export function pageHeadHtml({ title, summary = '', search = {}, segs = [], active }) {
  const seg = s => `<button type="button" class="lv-hit" data-lv-seg="${escH(s.key)}" aria-pressed="${s.key === active}">${s.red ? `<span class="lv-red">` : ''}<span class="lv-d">${escH(s.label)}</span><span class="lv-p">${escH(s.phone ?? s.label)}</span>${s.red ? '</span>' : ''}</button>`;
  return `<div class="lv-hrow"><div class="lv-d"><h1 class="lv-h1">${escH(title)}</h1><div class="lv-sum" data-lv-sum>${escH(summary)}</div></div>
<label class="lv-search lv-hit"><span class="lv-p">${SEARCH_ICON}</span><span class="lv-d lv-sg" aria-hidden="true">⌕ &nbsp;</span><input type="search" id="${escH(search.id || 'lvSearch')}" placeholder="${escH(search.placeholder || 'Search')}" value="${escH(search.value || '')}" autocomplete="off" spellcheck="false" aria-label="${escH(search.placeholder || 'Search')}"></label></div>
${segs.length ? `<div class="lv-seg" role="group" aria-label="Filter">${segs.map(seg).join('')}</div>` : ''}`;
}

// One list row. cells: desktop columns after the name (HTML strings); phone: phoneRight (default: the first cell) + ›.
export function rowHtml({ name, sub = '', subPhone, cells = [], phoneRight, open = 'Open ›', attrs = '', label }) {
  const subP = subPhone ?? sub;
  const subHtml = subP === sub ? (sub ? `<div class="lv-mt">${escH(sub)}</div>` : '')
    : `${sub ? `<div class="lv-mt lv-d">${escH(sub)}</div>` : ''}${subP ? `<div class="lv-mt lv-p">${escH(subP)}</div>` : ''}`;
  return `<div class="lv-row" role="button" tabindex="0" aria-label="${escH(label || `Open ${name}`)}" ${attrs}><div class="lv-c0"><div class="lv-nm">${escH(name)}</div>${subHtml}</div>${cells.map(c => `<div class="lv-c">${c}</div>`).join('')}${open ? `<div class="lv-c lv-op">${escH(open)}</div>` : ''}<div class="lv-c lv-pr">${phoneRight ?? cells[0] ?? ''}</div><span class="lv-chev" aria-hidden="true">›</span></div>`;
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
export function loadingHtml(what = 'clients') {
  const t = `Loading ${escH(what)}`;
  return `<div class="lv-load" role="status" aria-label="${t}…" data-lv-loading><span class="lv-load-mk" aria-hidden="true"><i></i><i></i><i></i></span><span class="lv-load-t" aria-hidden="true">${t}<span class="lv-dots"></span></span></div>`;
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
if (typeof document !== 'undefined') document.addEventListener('pointerdown', () => { if (PM.size) panelFinish(); }, true);

// Mount the shell on a page. root: the app container (the desktop top bar goes first inside it).
export function mountShell(cfg) {
  const doc = document, html = doc.documentElement, root = cfg.root || doc.body;
  html.classList.add('lfmp-v2');
  const st = { theme: getTheme(), showTests: !!cfg.showTests?.on, updated: cfg.updated || '', newsDot: !!cfg.newsDot, bell: Number(cfg.bellCount) || 0, meOpen: false };
  const full = () => ({ ...cfg, newsDot: st.newsDot, bellCount: st.bell });
  doc.querySelectorAll('[data-lv-top],[data-lv-ptop],[data-lv-tabs],[data-lv-me]').forEach(n => n.remove());
  root.insertAdjacentHTML('afterbegin', topBarHtml(full()) + phoneBarHtml(full()));
  doc.body.insertAdjacentHTML('beforeend', `${tabsHtml(cfg)}<div class="lv-mescreen" data-lv-me role="dialog" aria-label="Me" tabindex="-1" hidden></div>`);
  doc.body.classList.add('lv-has-tabs');
  const $$ = s => [...doc.querySelectorAll(s)];
  const pop = doc.querySelector('[data-lv-pop]'), scr = doc.querySelector('[data-lv-me]');
  const isPhone = () => matchMedia(`(max-width:${PHONE_MAX}px)`).matches;
  const paintMe = () => {
    if (pop && !pop.hidden) pop.innerHTML = meHtml(cfg, st);
    if (!scr.hidden) scr.innerHTML = phoneBarHtml({ ...full(), meScreen: true, plus: null, bell: false }, 'Me') + meHtml(cfg, st);
  };
  const setTabs = () => { const old = doc.querySelector('[data-lv-tabs]'); old.outerHTML = tabsHtml(cfg, st.meOpen); };
  const closeMe = () => {
    if (pop && !pop.hidden) { pop.hidden = true; $$('.lv-top [data-lv="me"]').forEach(b => b.setAttribute('aria-expanded', 'false')); }
    if (!scr.hidden) { scr.hidden = true; st.meOpen = false; doc.body.classList.remove('lv-me-open'); setTabs(); }
  };
  const openMe = () => {
    // focus moves into Me (the container, so no ring shows on a tap; Tab then walks its items)
    if (isPhone()) { scr.hidden = false; st.meOpen = true; doc.body.classList.add('lv-me-open'); paintMe(); setTabs(); scr.scrollTop = 0; scr.focus({ preventScroll: true }); }
    else { pop.hidden = false; paintMe(); $$('.lv-top [data-lv="me"]').forEach(b => b.setAttribute('aria-expanded', 'true')); pop.focus(); }
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
    if (!b) { if (pop && !pop.hidden && !e.target.closest('.lv-avwrap')) closeMe(); return; }
    const a = b.dataset.lv;
    if (a === 'me') { if (isPhone()) { st.meOpen ? closeMe() : openMe(); } else (pop.hidden ? openMe() : closeMe()); }
    else if (a === 'metab') { st.meOpen ? closeMe() : openMe(); }
    else if (a === 'plus') { closeMe(); cfg.plus?.onClick?.(e); }
    else if (a === 'bell') { closeMe(); cfg.bell?.onClick?.(b, e); }
    else if (a === 'signout') { signOut(); }
    else if (a === 'theme') { st.theme = setTheme(b.dataset.v); paintMe(); doc.querySelector(`[data-lv="theme"][data-v="${st.theme}"]`)?.focus(); }
    else if (a === 'tests') { st.showTests = !st.showTests; paintMe(); doc.querySelector('[data-lv="tests"]')?.focus(); cfg.showTests?.onChange?.(st.showTests); }
    else if (a === 'refresh') { cfg.onRefresh?.(); }
    else if (a === 'signins') { closeMe(); openTeamSignins(); }
    else if (a === 'news') { closeMe(); cfg.onNews?.(); }
    else if (a === 'install') { closeMe(); install(); }
  };
  doc.addEventListener('click', onClick);
  const onKey = e => {
    if (e.key === 'Escape' && (!pop.hidden || !scr.hidden)) { closeMe(); doc.querySelector(isPhone() ? '[data-lv-ptop] [data-lv="me"]' : '[data-lv-top] [data-lv="me"]')?.focus(); return; }
    // list rows are role="button": Enter / Space open them like a click
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('lv-row')) { e.preventDefault(); e.target.click(); }
  };
  doc.addEventListener('keydown', onKey);
  const api = {
    cfg, st, openMe, closeMe, isPhone, install,
    setBell(n) { st.bell = Number(n) || 0; $$('[data-lv-badge]').forEach(x => { x.textContent = st.bell; x.hidden = !st.bell; }); $$('[data-lv="bell"]').forEach(x => x.setAttribute('aria-label', `Sync issues${st.bell ? `: ${st.bell}` : ''}`)); },
    setUpdated(t) { if ((t || '') === st.updated) return; st.updated = t || ''; paintMe(); },
    // the "new" dot is only on the What's new row inside Me (no dot on the avatar: not in the reference)
    setNewsDot(on) { st.newsDot = !!on; paintMe(); },
    setShowTests(v) { st.showTests = !!v; paintMe(); },
    setTitle(t) { $$('[data-lv-title]').forEach(h => { h.textContent = t; }); },
    bellWrap() { return doc.querySelector(isPhone() ? '[data-lv-ptop] [data-lv-bellwrap]' : '[data-lv-top] [data-lv-bellwrap]'); },
    destroy() { doc.removeEventListener('click', onClick); doc.removeEventListener('keydown', onKey); },
  };
  return api;
}
