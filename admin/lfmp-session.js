// LFMP tools sign-in (v2, Google only). Replaces lfmp-login.js (shared password + browser vault), 16 Nov 2026.
// Keep the three copies byte-identical: ghl-subaccount-builder page/, leadpro-kpi admin/, automation-review admin/.
//
// The tools run only on lfmp-admin.pages.dev, behind Cloudflare Access (Google sign-in). There is no password and no key
// in the browser: the GitHub token, the Review admin key and the remembered KPI passphrases live on the team site's
// server (/api/, admin-site/lib/api.mjs in the builder repo), which checks the Google sign-in on every call.
//   const me = await startSession();            // { email, name, first } or sends you to /signin/
//   const r = await ghFetch('GET', '/repos/…')  // a Response with GitHub's status and body (allow-listed calls only)
//   await api('review', { action, … })          // other /api/ calls; throws ApiError on a refusal
//   signOut()                                   // Cloudflare Access logout (ends the Google sign-in for all three tools)

export const TOOLS = [
  { id: 'builder', name: 'Builder', path: '/ghl-subaccount-builder-page/' },
  { id: 'kpi', name: 'Scorecards', path: '/leadpro-kpi/admin/' },
  { id: 'review', name: 'Review', path: '/automation-review/admin/' },
];
export const SIGNIN = '/signin/';
export const LOGOUT = '/cdn-cgi/access/logout';
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
export function signOut() { clearLegacy(); leaving = true; location.assign(LOGOUT); }

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
