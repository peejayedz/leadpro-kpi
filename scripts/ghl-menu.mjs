// The GHL "KPI Dashboard" custom menu link for ONE new firm (new-firm.yml, step "Menu link").
//
// SAFETY: the only GHL write this repo makes besides the app's token calls. Allowed:
//   GET  /custom-menus/...            (to see whether the link already exists)
//   POST /custom-menus/               ONLY with title "KPI Dashboard", showOnCompany false,
//                                     showOnLocation true, showToAllLocations false, exactly one
//                                     location, openMode "new_tab", and a URL on this repo's Pages site.
//   DELETE /custom-menus/<id>        ONLY its exact reversal (v1.28.0, remove-firm.yml): a link removeMenuLink() has
//                                     just read and checked is ours (title "KPI Dashboard", this one sub-account only,
//                                     URL = this firm's dashboard). Anything else is refused before a request is sent.
// No update, nothing for any other sub-account. tests/new-firm and tests/remove-firm check this.
// Token: GHL_MENU_TOKEN = an agency Private Integration with custom-menu-link.write (+ .readonly) only.
// The URL holds the dashboard passphrase: it is never printed.

export const GHL_API = () => process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';
export const MENU_TITLE = 'KPI Dashboard';
export const PAGES = 'https://dashboard.lawfirmmarketingpros.com/leadpro-kpi/';   // v1.16.0: was peejayedz.github.io (old links still redirect)
const LOC_RE = /^[A-Za-z0-9]{15,30}$/;

export function menuBody({ locationId, url }) {
  return {
    title: MENU_TITLE, url, icon: { name: 'chart-line', fontFamily: 'fas' },
    showOnCompany: false, showOnLocation: true, showToAllLocations: false, locations: [locationId],
    openMode: 'new_tab', userRole: 'all',
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
      && Array.isArray(body.locations) && body.locations.length === 1 && LOC_RE.test(body.locations[0]) && body.openMode === 'new_tab'
      && typeof body.url === 'string' && body.url.startsWith(`${PAGES}firms/`);
    if (ok) return;
    throw new Error('Blocked: a menu link must be "KPI Dashboard", for exactly one sub-account, opening in a new tab, pointing at a LeadPro dashboard.');
  }
  throw new Error(`Blocked: the menu-link step may not call ${m} ${p.replace(/[A-Za-z0-9]{15,}/g, ':id')} on GHL.`);
}

async function call(method, path, { token, body, checked } = {}) {
  guardMenu(method, path, body, checked);
  let res;
  try {
    res = await fetch(GHL_API() + path, { method, headers: { Accept: 'application/json', Version: 'v3', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  } catch (e) { const err = new Error(`couldn't reach GHL (${e.cause?.code || 'network'})`); err.status = 0; throw err; }
  let data = {}; try { data = await res.json(); } catch {}
  if (!res.ok) { const err = new Error(`GHL ${method} /custom-menus failed (${res.status})`); err.status = res.status; throw err; }
  return data;
}

// Returns 'created' | 'exists' | 'skipped-no-token' | 'skipped-list-failed' | 'failed:<status>'.
// Lists first: a "KPI Dashboard" link already shown on this sub-account means nothing is created.
export async function ensureMenuLink({ token, locationId, slug, passphrase }) {
  if (!token) return 'skipped-no-token';
  if (!LOC_RE.test(locationId || '') || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug || '') || !passphrase) return 'failed:input';
  let list;
  try { list = await call('GET', '/custom-menus/', { token }); }
  catch { return 'skipped-list-failed'; }   // can't prove there's no link already: don't risk a duplicate
  const items = list.customMenus || list.items || list.menus || (Array.isArray(list) ? list : []);
  const here = items.some(m => String(m.title || '').trim().toLowerCase() === MENU_TITLE.toLowerCase()
    && (m.showToAllLocations || (Array.isArray(m.locations) && m.locations.includes(locationId))));
  if (here) return 'exists';
  const url = `${PAGES}firms/${slug}/#k=${encodeURIComponent(passphrase)}`;
  try { await call('POST', '/custom-menus/', { token, body: menuBody({ locationId, url }) }); return 'created'; }
  catch (e) { return `failed:${e.status ?? 0}`; }
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
  const items = list.customMenus || list.items || list.menus || (Array.isArray(list) ? list : []);
  const ours = items.find(m => isOurLink(m, { locationId, slug }));
  if (!ours) return 'none';
  try { await call('DELETE', `/custom-menus/${ours.id || ours._id}`, { token, checked: ours }); return 'removed'; }
  catch (e) { return `failed:${e.status ?? 0}`; }
}
