// The GHL "KPI Dashboard" custom menu link for ONE new firm (new-firm.yml, step "Menu link").
//
// SAFETY: the only GHL write this repo makes besides the app's token calls. Allowed:
//   GET  /custom-menus/...            (to see whether the link already exists)
//   POST /custom-menus/               ONLY with title "KPI Dashboard", showOnCompany false,
//                                     showOnLocation true, showToAllLocations false, exactly one
//                                     location, openMode "new_tab", and a URL on this repo's Pages site.
// No update, no delete, nothing for any other sub-account. tests/new-firm checks this.
// Token: GHL_MENU_TOKEN = an agency Private Integration with custom-menu-link.write (+ .readonly) only.
// The URL holds the dashboard passphrase: it is never printed.

export const GHL_API = () => process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';
export const MENU_TITLE = 'KPI Dashboard';
export const PAGES = 'https://peejayedz.github.io/leadpro-kpi/';
const LOC_RE = /^[A-Za-z0-9]{15,30}$/;

export function menuBody({ locationId, url }) {
  return {
    title: MENU_TITLE, url, icon: { name: 'chart-line', fontFamily: 'fas' },
    showOnCompany: false, showOnLocation: true, showToAllLocations: false, locations: [locationId],
    openMode: 'new_tab', userRole: 'all',
  };
}

export function guardMenu(method, path, body) {
  const m = String(method).toUpperCase(), p = String(path).split('?')[0];
  if (m === 'GET' && /^\/custom-menus\/?$/.test(p)) return;
  if (m === 'POST' && /^\/custom-menus\/?$/.test(p)) {
    const ok = body && body.title === MENU_TITLE && body.showOnCompany === false && body.showOnLocation === true && body.showToAllLocations === false
      && Array.isArray(body.locations) && body.locations.length === 1 && LOC_RE.test(body.locations[0]) && body.openMode === 'new_tab'
      && typeof body.url === 'string' && body.url.startsWith(`${PAGES}firms/`);
    if (ok) return;
    throw new Error('Blocked: a menu link must be "KPI Dashboard", for exactly one sub-account, opening in a new tab, pointing at a LeadPro dashboard.');
  }
  throw new Error(`Blocked: the menu-link step may not call ${m} ${p.replace(/[A-Za-z0-9]{15,}/g, ':id')} on GHL.`);
}

async function call(method, path, { token, body } = {}) {
  guardMenu(method, path, body);
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
