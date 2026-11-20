// The GHL "KPI Dashboard" custom menu link for ONE new firm (new-firm.yml, step "Menu link").
//
// SAFETY: the only GHL write this repo makes besides the app's token calls. Allowed:
//   GET  /custom-menus/...            (to see whether the link already exists)
//   POST /custom-menus/               ONLY with title "KPI Dashboard", showOnCompany false,
//                                     showOnLocation true, showToAllLocations false, exactly one
//                                     location, openMode "iframe" (v1.30.0: GHL's value for "Open link within the current
//                                     window as an embedded page", PJ's SOP; was "new_tab"), and a URL on this repo's Pages site.
//   DELETE /custom-menus/<id>        ONLY its exact reversal (v1.28.0, remove-firm.yml): a link removeMenuLink() has
//                                     just read and checked is ours (title "KPI Dashboard", this one sub-account only,
//                                     URL = this firm's dashboard). Anything else is refused before a request is sent.
// No update, nothing for any other sub-account. tests/new-firm and tests/remove-firm check this.
// v1.30.0: the new link's id (GHL's answer, or read back with a GET) is kept with the firm (config.menuLink.id, not secret)
// for the agency Custom CSS rule (scripts/menu-css.mjs). readMenuLinkId() = a GET only, for links made before v1.30.0.
// Token: GHL_MENU_TOKEN = an agency Private Integration with custom-menu-link.write (+ .readonly) only.
// The URL holds the dashboard passphrase: it is never printed.

import { validMenuId } from './menu-css.mjs';

export const GHL_API = () => process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';
export const MENU_TITLE = 'KPI Dashboard';
export const PAGES = 'https://dashboard.lawfirmmarketingpros.com/leadpro-kpi/';   // v1.16.0: was peejayedz.github.io (old links still redirect)
const LOC_RE = /^[A-Za-z0-9]{15,30}$/;

export function menuBody({ locationId, url }) {
  return {
    title: MENU_TITLE, url, icon: { name: 'chart-line', fontFamily: 'fas' },
    showOnCompany: false, showOnLocation: true, showToAllLocations: false, locations: [locationId],
    openMode: 'iframe', userRole: 'all',
  };
}

// The link removeMenuLink() may delete: exactly what ensureMenuLink() creates, for this firm.
export const isOurLink = (m, { locationId, slug }) => !!m && String(m.title || '').trim() === MENU_TITLE && m.showToAllLocations !== true && m.showOnCompany !== true
  && Array.isArray(m.locations) && m.locations.length === 1 && m.locations[0] === locationId
  && typeof m.url === 'string' && m.url.startsWith(`${PAGES}firms/${slug}/`) && /^[A-Za-z0-9-]{10,40}$/.test(String(m.id || m._id || ''));

export function guardMenu(method, path, body, checked = null) {
  const m = String(method).toUpperCase(), p = String(path).split('?')[0];
  if (m === 'GET' && /^\/custom-menus\/?$/.test(p)) return;
  if (m === 'DELETE') {
    const id = (/^\/custom-menus\/([A-Za-z0-9-]{10,40})$/.exec(p) || [])[1];
    if (id && checked && String(checked.id || checked._id) === id && !body) return;
    throw new Error('Blocked: only the firm\'s own "KPI Dashboard" link, just checked, may be removed.');
  }
  if (m === 'POST' && /^\/custom-menus\/?$/.test(p)) {
    const ok = body && body.title === MENU_TITLE && body.showOnCompany === false && body.showOnLocation === true && body.showToAllLocations === false
      && Array.isArray(body.locations) && body.locations.length === 1 && LOC_RE.test(body.locations[0]) && body.openMode === 'iframe'
      && typeof body.url === 'string' && body.url.startsWith(`${PAGES}firms/`);
    if (ok) return;
    throw new Error('Blocked: a menu link must be "KPI Dashboard", for exactly one sub-account, opening inside GHL (iframe), pointing at a LeadPro dashboard.');
  }
  throw new Error(`Blocked: the menu-link step may not call ${m} ${p.replace(/[A-Za-z0-9]{15,}/g, ':id')} on GHL.`);
}

async function call(method, path, { token, body, checked, secrets = [] } = {}) {
  guardMenu(method, path, body, checked);
  let res;
  try {
    res = await fetch(GHL_API() + path, { method, headers: { Accept: 'application/json', Version: 'v3', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) { const err = new Error(`couldn't reach GHL (${e.cause?.code || 'network'})`); err.status = 0; throw err; }
  let data = {}; try { data = await res.json(); } catch {}
  if (!res.ok) { const err = new Error(`GHL ${method} /custom-menus failed (${res.status})`); err.status = res.status; err.ghl = ghlMessage(data, secrets); throw err; }
  return data;
}

// v1.32.1: GHL's own words for a refusal (e.g. 422 {"message":["openMode must be …"]}), safe to log and to show in the
// popup: links and the dashboard passphrase (raw or URL-encoded) are cut out, one line, at most 300 characters.
export function ghlMessage(data, secrets = []) {
  const parts = [data?.message, data?.error, data?.msg].flat().filter(x => typeof x === 'string' && x.trim());
  let s = [...new Set(parts)].join('; ');
  for (const v of secrets.filter(x => typeof x === 'string' && x.length >= 4)) for (const f of [v, encodeURIComponent(v)]) s = s.split(f).join('[hidden]');
  s = s.replace(/https?:\/\/\S+/gi, '[link]').replace(/#k=\S*/g, '[hidden]').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.length > 300 ? `${s.slice(0, 297)}…` : s;
}

// v1.32.1: the plain-words reason for a result that isn't created / exists (menu-link.yml log, the status file, the popups).
export function menuReason(result, ghl = '') {
  const code = Number((/^failed:(\d+)$/.exec(result || '') || [])[1]);
  if (result === 'skipped-no-token') return 'GHL_MENU_TOKEN isn\'t set, so nothing was sent to GHL.';
  if (result === 'skipped-list-failed') return 'GHL didn\'t let us read the existing menu links, so nothing was sent (a duplicate couldn\'t be ruled out).';
  if (result === 'failed:input') return 'The firm\'s location ID, slug or passphrase is missing or not valid, so nothing was sent to GHL.';
  if (code === 401 || code === 403) return `GHL refused the menu token${ghl ? `: ${ghl}` : ''} (${code}). GHL_MENU_TOKEN may have expired or lost the custom-menu-link.write scope.`;
  if (code === 0 || result === 'failed:0') return 'Couldn\'t reach GHL. Nothing was added; try again in a few minutes.';
  if (code >= 500) return `GHL had a server error${ghl ? `: ${ghl}` : ''} (${code}). Nothing was added; try again in a few minutes.`;
  if (code) return ghl ? `GHL refused the link: ${ghl} (${code}).` : `GHL refused the link (${code}) and gave no reason.`;
  return `The link wasn't added (${result || 'unknown'}).`;
}

const listOf = list => list?.customMenus || list?.items || list?.menus || (Array.isArray(list) ? list : []);
const idOf = m => String(m?.id || m?._id || '');
// A "KPI Dashboard" link shown on this sub-account (ours or made by hand): the same test ensureMenuLink() has always used.
const kpiLinkHere = (m, locationId) => String(m.title || '').trim().toLowerCase() === MENU_TITLE.toLowerCase()
  && (m.showToAllLocations || (Array.isArray(m.locations) && m.locations.includes(locationId)));
// The id to keep for the CSS rule: the link must be shown on this one sub-account only (a link for every sub-account
// would move the item everywhere; its rule isn't ours to give).
const keepId = (m, locationId) => (m && kpiLinkHere(m, locationId) && m.showToAllLocations !== true && Array.isArray(m.locations)
  && m.locations.length === 1 && validMenuId(idOf(m))) ? idOf(m) : null;

// Returns { result, id, ghl? }. ghl (v1.32.1): GHL's own words when the POST is refused (ghlMessage). result: 'created' | 'exists' | 'skipped-no-token' | 'skipped-list-failed' | 'failed:<status>'.
// id: the link's GHL id when known (from the POST answer, or read back with one GET; null if it can't be found).
// Lists first: a "KPI Dashboard" link already shown on this sub-account means nothing is created.
export async function ensureMenuLink({ token, locationId, slug, passphrase }) {
  if (!token) return { result: 'skipped-no-token', id: null };
  if (!LOC_RE.test(locationId || '') || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug || '') || !passphrase) return { result: 'failed:input', id: null };
  let list;
  try { list = await call('GET', '/custom-menus/', { token }); }
  catch { return { result: 'skipped-list-failed', id: null }; }   // can't prove there's no link already: don't risk a duplicate
  const here = listOf(list).find(m => kpiLinkHere(m, locationId));
  if (here) return { result: 'exists', id: keepId(here, locationId) };
  const url = `${PAGES}firms/${slug}/#k=${encodeURIComponent(passphrase)}`;
  let made;
  try { made = await call('POST', '/custom-menus/', { token, body: menuBody({ locationId, url }), secrets: [passphrase, url] }); }
  catch (e) { return { result: `failed:${e.status ?? 0}`, id: null, ghl: e.ghl || '' }; }
  const m = made?.customMenu || made;
  if (validMenuId(idOf(m))) return { result: 'created', id: idOf(m) };
  // No id in GHL's answer: read it back (GET only). A failed read leaves the id unknown; the link itself is made.
  try { return { result: 'created', id: keepId(listOf(await call('GET', '/custom-menus/', { token })).find(x => kpiLinkHere(x, locationId)), locationId) }; }
  catch { return { result: 'created', id: null }; }
}

// v1.30.0 "Show CSS rule" for a firm whose link was made before v1.30.0: a GET only (guardMenu allows nothing else here).
// Returns { result: 'found' | 'none' | 'not-single' | 'skipped-no-token' | 'skipped-list-failed' | 'failed:input', id }.
// 'not-single': a "KPI Dashboard" link is there but not for this one sub-account only (no rule given).
export async function readMenuLinkId({ token, locationId }) {
  if (!token) return { result: 'skipped-no-token', id: null };
  if (!LOC_RE.test(locationId || '')) return { result: 'failed:input', id: null };
  let list;
  try { list = await call('GET', '/custom-menus/', { token }); }
  catch { return { result: 'skipped-list-failed', id: null }; }
  const here = listOf(list).filter(m => kpiLinkHere(m, locationId));
  if (!here.length) return { result: 'none', id: null };
  const id = here.map(m => keepId(m, locationId)).find(Boolean) || null;
  return id ? { result: 'found', id } : { result: 'not-single', id: null };
}

// v1.28.0: the exact reversal, for remove-firm.yml (a LIVE firm only). Lists, finds this firm's own "KPI Dashboard" link
// (isOurLink) and deletes that one link. Returns 'removed' | 'none' (nothing of ours there) | 'skipped-no-token' |
// 'skipped-list-failed' | 'failed:<status>'. A "KPI Dashboard" link that isn't exactly ours is left alone ('none').
export async function removeMenuLink({ token, locationId, slug }) {
  if (!token) return 'skipped-no-token';
  if (!LOC_RE.test(locationId || '') || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug || '')) return 'failed:input';
  let list;
  try { list = await call('GET', '/custom-menus/', { token }); }
  catch { return 'skipped-list-failed'; }
  const ours = listOf(list).find(m => isOurLink(m, { locationId, slug }));
  if (!ours) return 'none';
  try { await call('DELETE', `/custom-menus/${ours.id || ours._id}`, { token, checked: ours }); return 'removed'; }
  catch (e) { return `failed:${e.status ?? 0}`; }
}
