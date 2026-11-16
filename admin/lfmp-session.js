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
export const LOGOUT = '/cdn-cgi/access/logout';                                   // this site's Access session
export const TEAM_LOGOUT = 'https://lfmp.cloudflareaccess.com/cdn-cgi/access/logout';   // the Google sign-in for every LFMP app
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
// Sign out: end this site's Access session (the cookie is cleared by that response), then the team-wide Access session,
// which sends the browser back to /signin/?out=1 ("You've been signed out. See you next shift.").
export async function signOut() {
  clearLegacy(); leaving = true;
  try { await fetch(LOGOUT, { credentials: 'same-origin', redirect: 'manual', cache: 'no-store' }); } catch {}
  location.assign(`${TEAM_LOGOUT}?returnTo=${encodeURIComponent(location.origin + SIGNED_OUT)}`);
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
