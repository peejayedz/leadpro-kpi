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

// Page head: title + summary (desktop), search (always), segmented filter. segs: [{ key, label, phone, red, amber }]
// red = something is an alert, amber = only notices (the same colours as the KPI bell). The search icon is the same
// SVG magnifier on desktop and phone (v1.16.0; was a "⌕" character on desktop).
export function pageHeadHtml({ title, summary = '', search = {}, segs = [], active }) {
  const tone = s => (s.red ? 'lv-red' : s.amber ? 'lv-amber' : '');
  const seg = s => `<button type="button" class="lv-hit" data-lv-seg="${escH(s.key)}" aria-pressed="${s.key === active}">${tone(s) ? `<span class="${tone(s)}">` : ''}<span class="lv-d">${escH(s.label)}</span><span class="lv-p">${escH(s.phone ?? s.label)}</span>${tone(s) ? '</span>' : ''}</button>`;
  return `<div class="lv-hrow"><div class="lv-d"><h1 class="lv-h1">${escH(title)}</h1><div class="lv-sum" data-lv-sum>${escH(summary)}</div></div>
<label class="lv-search lv-hit">${SEARCH_ICON}<input type="search" id="${escH(search.id || 'lvSearch')}" placeholder="${escH(search.placeholder || 'Search')}" value="${escH(search.value || '')}" autocomplete="off" spellcheck="false" aria-label="${escH(search.placeholder || 'Search')}"></label></div>
${segs.length ? `<div class="lv-seg" role="group" aria-label="Filter">${segs.map(seg).join('')}</div>` : ''}`;
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
export const nameKey = name => displayName(name).replace(/^the\s+/i, '').toLowerCase();
export const byName = get => (a, b) => nameKey(get(a)).localeCompare(nameKey(get(b)), 'en', { sensitivity: 'base', numeric: true }) || String(get(a)).localeCompare(String(get(b)));
// The Builder's client records (private repo, records/<id>.json) through the team site, read only:
// [{ id, name, locationId, reviewCode, kpiSlug, linkSent }]. Never throws: any failure = [] (tools keep their own names).
let recordsPromise = null;
export function loadBuilderRecords({ fresh = false } = {}) {
  if (recordsPromise && !fresh) return recordsPromise;
  const REPO = '/repos/peejayedz/ghl-subaccount-builder';
  recordsPromise = (async () => {
    try {
      const r = await ghFetch('GET', `${REPO}/contents/records?ref=main`);
      if (!r.ok) return [];
      const files = (await r.json()).filter(f => f && f.type === 'file' && /^[a-z0-9-]{1,60}\.json$/.test(f.name));
      const recs = await Promise.all(files.map(f => ghFetch('GET', `${REPO}/contents/records/${f.name}?ref=main`, null, { raw: true })
        .then(x => (x.ok ? x.text() : null)).then(t => (t ? JSON.parse(t) : null)).catch(() => null)));
      return recs.filter(x => x && x.id && x.businessName).map(x => ({ id: x.id, name: displayName(x.businessName), locationId: x.locationId || '',
        reviewCode: x.review?.code || '', kpiSlug: x.kpi?.slug || '', linkSent: x.review?.linkSent || null }));
    } catch { return []; }
  })();
  return recordsPromise;
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
if (hasDoc()) document.addEventListener('click', e => { if (e.target.closest?.('.lv-bz, .lv-bz-dim')) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
function autoSettle(j) {
  clearTimeout(j.t);
  j.t = setTimeout(() => { if (j.n) return; if (autoJob === j) autoJob = null; j.bad ? j.bz.fail() : j.bz.done(j.w.done); }, AUTO_SETTLE_MS);
}
if (hasDoc()) document.addEventListener('click', e => {
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
