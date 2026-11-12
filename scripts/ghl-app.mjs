// GHL calls for the private Marketplace app "LFMP LeadPro Connector" (token keeper and new-firm).
//
// SAFETY: allows GET, and exactly two POSTs: /oauth/token (refresh the agency token) and
// /oauth/locationToken (mint a sub-account token). Neither changes anything in a GHL account.
// Anything else throws before a request is sent (tests/keeper checks this).
// Tokens and the client secret are passed in as arguments and never logged; error text has
// anything token-like blanked.

export const GHL_API = () => process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';
export const LFMP_COMPANY_ID = 'IYdknVhgm55IdmWsgm2t';
const ALLOWED_POST = /^\/oauth\/(token|locationToken)$/;

export class AppError extends Error {
  constructor(message, { status = 0, code = '' } = {}) { super(message); this.status = status; this.code = code; }
}
export const scrub = s => String(s ?? '').replace(/[A-Za-z0-9._~+/=-]{40,}/g, '[hidden]');
const safePath = p => String(p).split('?')[0].replace(/[A-Za-z0-9]{15,}/g, ':id');

export function guard(method, path) {
  const m = String(method).toUpperCase(), p = String(path).split('?')[0];
  if (m === 'GET' || (m === 'POST' && ALLOWED_POST.test(p))) return m;
  throw new AppError(`Blocked: the token keeper may not call ${m} ${safePath(path)} on GHL.`);
}

export async function app(method, path, { token, form, version = '2021-07-28' } = {}) {
  method = guard(method, path);
  const headers = { Accept: 'application/json', Version: version };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  let res, text;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await fetch(GHL_API() + path, { method, headers, body: form ? new URLSearchParams(form).toString() : undefined });
      text = await res.text();
    } catch (e) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
      throw new AppError(`Couldn't reach GHL (${e.cause?.code || 'network'}).`, { code: 'network' });
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
    break;
  }
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!res.ok) {
    const msg = Array.isArray(data.message) ? data.message.join('; ') : (data.error_description || data.message || data.error || '');
    throw new AppError(`GHL ${method} ${safePath(path)} failed (${res.status})${msg ? `: ${scrub(msg).slice(0, 160)}` : ''}`, { status: res.status, code: data.error || '' });
  }
  return data;
}

export const refreshAgency = ({ clientId, clientSecret, refreshToken }) => app('POST', '/oauth/token', {
  form: { client_id: clientId, client_secret: clientSecret, grant_type: 'refresh_token', refresh_token: refreshToken, user_type: 'Company' },
});

export const mintLocationToken = ({ agencyToken, locationId, companyId = LFMP_COMPANY_ID }) => app('POST', '/oauth/locationToken', {
  token: agencyToken, form: { companyId, locationId },
});

// Ids of the sub-accounts that have the app (current docs' path, then the older one).
export async function installedLocationIds({ agencyToken, appId, companyId = LFMP_COMPANY_ID }) {
  const ids = new Set(); let future = null;
  const paths = [{ path: '/oauth/installed-locations', version: 'v3', paged: 'token' }, { path: '/oauth/installedLocations', version: '2021-07-28', paged: 'skip' }];
  let use = null, pageToken = '', lastErr = null;
  for (let page = 0; page < 50; page++) {
    const qs = t => new URLSearchParams({ companyId, appId, isInstalled: 'true', ...(t.paged === 'skip' ? { limit: '100', skip: String(ids.size) } : { pageSize: '100', ...(pageToken ? { pageToken } : {}) }) });
    let data;
    for (const t of use ? [use] : paths) {
      try { data = await app('GET', `${t.path}?${qs(t)}`, { token: agencyToken, version: t.version }); use = t; break; }
      catch (e) { lastErr = e; if (use || ![400, 404, 422].includes(e.status)) throw e; }
    }
    if (!use) throw lastErr;
    const items = data.items || data.locations || [];
    for (const l of items) if (l.isInstalled !== false) ids.add(l._id || l.id);
    if (typeof data.installToFutureLocations === 'boolean') future = data.installToFutureLocations;
    pageToken = data.pagination?.nextPageToken || '';
    if (!(use.paged === 'skip' ? items.length === 100 : data.pagination?.hasNextPage && pageToken)) break;
  }
  return { ids, installToFutureLocations: future };
}

export const appIdFromClientId = id => String(id || '').split('-')[0];
