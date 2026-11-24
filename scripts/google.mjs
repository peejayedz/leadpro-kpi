// v1.39.0 LeadPro Reports, Phases 3–4 (queue items 7–9): the ONE place that talks to Google. Used by the nightly pull
// (scripts/reports-pull.mjs, GitHub Actions, Node 20) and by the team site's /api/reports/catalog (Cloudflare Worker).
// Plain fetch + Web Crypto only (no Google SDK), so the same code runs in both. READ ONLY: every call reads; nothing is
// created, changed or deleted in any Google product.
//
// Two ways in:
//  1. The robot (service account) for GA4 + Search Console. Secret GOOGLE_REPORTS_SA_JSON = the key file's JSON. We sign a
//     JWT (RS256, Web Crypto) and swap it for an access token. Scopes analytics.readonly + webmasters.readonly. Clients add
//     the robot email (client_email in that JSON; not a secret) as a Viewer in GA4 and a Restricted user in Search Console.
//  2. LFMP's own Google account (OAuth refresh token) for Business Profile (scope business.manage; service accounts can't
//     manage profiles) and Google Ads (scope adwords, through LFMP's manager account = MCC). Secrets GOOGLE_OAUTH_CLIENT_ID,
//     GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_GBP_REFRESH_TOKEN, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_MCC_ID. The refresh tokens
//     come from the Builder's scripts/google-signin-once.mjs (never printed).
//
// Google Ads: since 10 Sept 2026 there is NO developer token; access belongs to the Google Cloud project (Test / Explorer /
// Basic / Standard). We never send a developer-token header. A project still on Test answers
// CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION → kind 'not_approved' ("Needs Basic access"). The API version is one constant.
//
// Errors: GoogleError with .kind = no_key | auth | no_access | not_approved (Ads project on Test) | not_approved_gbp
// (Business Profile API access not granted yet: quota 0) | gone | network | server | api. Messages never hold a token.

export const ADS_API_VERSION = 'v26';   // current major (released 14 Oct 2026; v26.2 = 11 Nov 2026). Change here only.
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SCOPES = { sa: ['https://www.googleapis.com/auth/analytics.readonly', 'https://www.googleapis.com/auth/webmasters.readonly'], gbp: 'https://www.googleapis.com/auth/business.manage', ads: 'https://www.googleapis.com/auth/adwords' };
export const URLS = {
  ga4Admin: 'https://analyticsadmin.googleapis.com/v1beta',
  ga4Data: 'https://analyticsdata.googleapis.com/v1beta',
  sc: 'https://www.googleapis.com/webmasters/v3',
  gbpAccounts: 'https://mybusinessaccountmanagement.googleapis.com/v1',
  gbpInfo: 'https://mybusinessbusinessinformation.googleapis.com/v1',
  gbpPerf: 'https://businessprofileperformance.googleapis.com/v1',
  ads: `https://googleads.googleapis.com/${ADS_API_VERSION}`,
};
export const GBP_METRICS = ['CALL_CLICKS', 'BUSINESS_DIRECTION_REQUESTS', 'WEBSITE_CLICKS', 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH', 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS'];

export class GoogleError extends Error {
  constructor(message, { status = 0, kind = 'api' } = {}) { super(message); this.status = status; this.kind = kind; }
}

// ---------------------------------------------------------------- the robot (service account)
export function parseSa(saJson) {
  if (!saJson) return null;
  try { const j = typeof saJson === 'string' ? JSON.parse(saJson) : saJson; return j && j.client_email && j.private_key ? j : null; } catch { return null; }
}
// The robot's email (not a secret) for the Settings card; '' when the JSON isn't set or isn't a key file.
export const robotEmail = saJson => parseSa(saJson)?.client_email || '';

const b64url = bytes => { let s = ''; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const enc = s => new TextEncoder().encode(s);
function pemToDer(pem) {
  const body = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(body); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
// RS256 JWT for the token endpoint (Google's "service account JWT bearer" flow).
export async function signJwt(sa, scopes, nowSec = Math.floor(Date.now() / 1000)) {
  const header = { alg: 'RS256', typ: 'JWT', ...(sa.private_key_id ? { kid: sa.private_key_id } : {}) };
  const claims = { iss: sa.client_email, scope: [].concat(scopes).join(' '), aud: sa.token_uri || TOKEN_URL, iat: nowSec, exp: nowSec + 3600 };
  const input = `${b64url(enc(JSON.stringify(header)))}.${b64url(enc(JSON.stringify(claims)))}`;
  let key;
  try { key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']); }
  catch { throw new GoogleError('GOOGLE_REPORTS_SA_JSON has no usable private key (download the key file again)', { kind: 'auth' }); }
  return `${input}.${b64url(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc(input)))}`;
}

async function tokenCall(f, body, what) {
  let r;
  try { r = await f(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() }); }
  catch (e) { throw new GoogleError(`Google sign-in didn't answer (${e.message})`, { kind: 'network' }); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const code = String(j.error || r.status);
    throw new GoogleError(code === 'invalid_grant' ? `${what}: Google no longer accepts the sign-in (run the sign-in again)` : `${what}: Google sign-in failed (${code})`, { status: r.status, kind: r.status >= 500 ? 'server' : 'auth' });
  }
  return j.access_token;
}

// One authorised JSON call. Google's error body → our kinds.
async function call(f, token, url, { method = 'GET', body, headers = {} } = {}) {
  let r;
  try { r = await f(url, { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
  catch (e) { throw new GoogleError(`Google didn't answer (${e.message})`, { kind: 'network' }); }
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  if (r.ok) return j ?? {};
  const raw = text.slice(0, 4000);
  const msg = (Array.isArray(j) ? j[0] : j)?.error?.message || `HTTP ${r.status}`;
  if (/CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION/.test(raw)) throw new GoogleError('The Google Cloud project has no Basic access to the Google Ads API yet', { status: r.status, kind: 'not_approved' });
  if (r.status === 429 && /quota_limit_value"?\s*:\s*"?0\b|limit of 0|quota.*\b0\b.*per minute/i.test(raw) && /mybusiness|businessprofile/i.test(url)) throw new GoogleError('Google hasn\'t approved Business Profile API access yet (quota 0)', { status: 429, kind: 'not_approved_gbp' });
  if (r.status === 401) throw new GoogleError('Google refused the sign-in', { status: 401, kind: 'auth' });
  if (r.status === 403 || /USER_PERMISSION_DENIED|CUSTOMER_NOT_ENABLED|PERMISSION_DENIED/.test(raw)) throw new GoogleError(`No access: ${clean(msg)}`, { status: r.status, kind: 'no_access' });
  if (r.status === 404 || /CUSTOMER_NOT_FOUND/.test(raw)) throw new GoogleError(`Not found: ${clean(msg)}`, { status: r.status, kind: 'gone' });
  throw new GoogleError(`Google answered ${r.status}: ${clean(msg)}`, { status: r.status, kind: r.status >= 500 || r.status === 429 ? 'server' : 'api' });
}
const clean = s => String(s || '').replace(/ya29\.[\w.-]+|1\/\/[\w.-]+/g, '[token]').replace(/\s+/g, ' ').slice(0, 180);
const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? 0 : Number(v));
const ymd = d => `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
const dashed = s => (/^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s);
const host = u => String(u || '').toLowerCase().replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];

// saClient({ saJson, fetch }) → GA4 + Search Console through the robot.
export function saClient({ saJson, fetch: f = globalThis.fetch, now = () => Date.now() } = {}) {
  const sa = parseSa(saJson);
  if (!sa) throw new GoogleError('Google not set up yet (GOOGLE_REPORTS_SA_JSON)', { kind: 'no_key' });
  let tok = null;
  const token = async () => (tok ||= await tokenCall(f, { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await signJwt(sa, SCOPES.sa, Math.floor(now() / 1000)) }, 'The robot account'));
  const get = async (url, o) => call(f, await token(), url, o);
  return {
    email: sa.client_email,
    // GA4 properties the robot can read: [{ id, name, account }]
    async ga4Properties() {
      const out = []; let pageToken = '';
      for (let i = 0; i < 20; i++) {
        const j = await get(`${URLS.ga4Admin}/accountSummaries?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
        for (const a of j.accountSummaries || []) for (const p of a.propertySummaries || []) out.push({ id: String(p.property || '').replace(/^properties\//, ''), name: String(p.displayName || ''), account: String(a.displayName || '') });
        if (!(pageToken = j.nextPageToken)) break;
      }
      return out.filter(p => p.id);
    },
    // Search Console sites the robot can read: [{ siteUrl, permission }]
    async scSites() {
      const j = await get(`${URLS.sc}/sites`);
      return (j.siteEntry || []).filter(s => s.permissionLevel && s.permissionLevel !== 'siteUnverifiedUser').map(s => ({ siteUrl: String(s.siteUrl), permission: String(s.permissionLevel) }));
    },
    // GA4 by day: { days: { 'YYYY-MM-DD': { s, u, dur, k } }, channels: { 'YYYY-MM-DD': { '<channel group>': sessions } }, hasKeyEvents }
    // dur = total seconds (averageSessionDuration × sessions) so any range averages right; k = key events.
    async ga4({ propertyId, from, to }) {
      const url = `${URLS.ga4Data}/properties/${encodeURIComponent(propertyId)}:runReport`;
      const a = await get(url, { method: 'POST', body: { dateRanges: [{ startDate: from, endDate: to }], dimensions: [{ name: 'date' }], metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'averageSessionDuration' }, { name: 'keyEvents' }], limit: 1000 } });
      const days = {};
      for (const r of a.rows || []) {
        const d = dashed(r.dimensionValues[0].value), [s, u, avg, k] = r.metricValues.map(m => num(m.value));
        days[d] = { s, u, dur: Math.round(avg * s), k };
      }
      const b = await get(url, { method: 'POST', body: { dateRanges: [{ startDate: from, endDate: to }], dimensions: [{ name: 'date' }, { name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }], limit: 20000 } });
      const channels = {};
      for (const r of b.rows || []) { const d = dashed(r.dimensionValues[0].value); (channels[d] ||= {})[r.dimensionValues[1].value || '(other)'] = num(r.metricValues[0].value); }
      return { days, channels, hasKeyEvents: Object.values(days).some(x => x.k > 0) };
    },
    // Search Console by day + the top 25 queries by clicks over the last 90 days (query text, clicks, position only).
    // days: { 'YYYY-MM-DD': { c, i, pi } }  (pi = position × impressions, so any range averages right)
    async searchConsole({ siteUrl, from, to, topFrom }) {
      const url = `${URLS.sc}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
      const a = await get(url, { method: 'POST', body: { startDate: from, endDate: to, dimensions: ['date'], rowLimit: 25000, dataState: 'all' } });
      const days = {};
      for (const r of a.rows || []) days[r.keys[0]] = { c: num(r.clicks), i: num(r.impressions), pi: Math.round(num(r.position) * num(r.impressions) * 10) / 10 };
      const b = await get(url, { method: 'POST', body: { startDate: topFrom, endDate: to, dimensions: ['query'], rowLimit: 25, dataState: 'all' } });
      const top = (b.rows || []).map(r => [String(r.keys[0]).slice(0, 120), num(r.clicks), Math.round(num(r.position) * 10) / 10]).sort((x, y) => y[1] - x[1]).slice(0, 25);
      return { days, top };
    },
  };
}

// oauthClient({ clientId, clientSecret, refreshToken }) → Business Profile + Google Ads through LFMP's own account.
export function oauthClient({ clientId, clientSecret, refreshToken, fetch: f = globalThis.fetch } = {}) {
  if (!clientId || !clientSecret) throw new GoogleError('Google sign-in not set up yet (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET)', { kind: 'no_key' });
  if (!refreshToken) throw new GoogleError('Needs sign-in (run scripts/google-signin-once.mjs)', { kind: 'no_signin' });
  let tok = null;
  const token = async () => (tok ||= await tokenCall(f, { grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }, 'LFMP\'s Google sign-in'));
  const get = async (url, o) => call(f, await token(), url, o);
  const adsSearch = async (customerId, mccId, query) => {
    const rows = [];
    const j = await get(`${URLS.ads}/customers/${String(customerId).replace(/-/g, '')}/googleAds:searchStream`, { method: 'POST', body: { query }, headers: { 'login-customer-id': String(mccId).replace(/-/g, '') } });
    for (const batch of Array.isArray(j) ? j : [j]) for (const r of batch.results || []) rows.push(r);
    return rows;
  };
  return {
    // Business Profile locations LFMP can manage: [{ name: 'locations/…', title, website, account }]
    async gbpLocations() {
      const acc = await get(`${URLS.gbpAccounts}/accounts?pageSize=20`);
      const out = [];
      for (const a of acc.accounts || []) {
        let pageToken = '';
        for (let i = 0; i < 20; i++) {
          const j = await get(`${URLS.gbpInfo}/${a.name}/locations?readMask=name,title,websiteUri&pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
          for (const l of j.locations || []) out.push({ name: String(l.name), title: String(l.title || ''), website: String(l.websiteUri || ''), account: String(a.accountName || '') });
          if (!(pageToken = j.nextPageToken)) break;
        }
      }
      return out;
    },
    // Business Profile per day: { 'YYYY-MM-DD': { calls, dir, web, vs, vm } } (vs = views on Search, vm = on Maps)
    async gbp({ locationName, from, to }) {
      const [fy, fm, fd] = from.split('-').map(Number), [ty, tm, td] = to.split('-').map(Number);
      const q = new URLSearchParams(); GBP_METRICS.forEach(m => q.append('dailyMetrics', m));
      Object.entries({ 'dailyRange.start_date.year': fy, 'dailyRange.start_date.month': fm, 'dailyRange.start_date.day': fd, 'dailyRange.end_date.year': ty, 'dailyRange.end_date.month': tm, 'dailyRange.end_date.day': td }).forEach(([k, v]) => q.set(k, String(v)));
      const j = await get(`${URLS.gbpPerf}/${locationName}:fetchMultiDailyMetricsTimeSeries?${q}`);
      const days = {};
      const field = { CALL_CLICKS: 'calls', BUSINESS_DIRECTION_REQUESTS: 'dir', WEBSITE_CLICKS: 'web', BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 'vs', BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 'vs', BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 'vm', BUSINESS_IMPRESSIONS_MOBILE_MAPS: 'vm' };
      for (const group of j.multiDailyMetricTimeSeries || []) for (const s of group.dailyMetricTimeSeries || []) {
        const k = field[s.dailyMetric]; if (!k) continue;
        for (const v of s.timeSeries?.datedValues || []) { const d = ymd(v.date); const x = days[d] ||= { calls: 0, dir: 0, web: 0, vs: 0, vm: 0 }; x[k] += num(v.value); }
      }
      return days;
    },
    // Client accounts under the MCC: [{ id, name }]
    async adsCustomers(mccId) {
      if (!/^\d{10}$/.test(String(mccId || '').replace(/-/g, ''))) throw new GoogleError('Google Ads not set up yet (GOOGLE_ADS_MCC_ID)', { kind: 'no_key' });
      const rows = await adsSearch(mccId, mccId, "SELECT customer_client.id, customer_client.descriptive_name FROM customer_client WHERE customer_client.manager = false AND customer_client.status = 'ENABLED'");
      return rows.map(r => ({ id: String(r.customerClient?.id ?? ''), name: String(r.customerClient?.descriptiveName ?? '') })).filter(a => a.id).sort((x, y) => x.name.localeCompare(y.name));
    },
    // Ads per day and per campaign: { currency, days: { d: { cost, clicks, impr, conv } }, campaigns: { d: { '<campaign name>': [cost, conv] } } }
    async ads({ customerId, mccId, from, to }) {
      const rows = await adsSearch(customerId, mccId, `SELECT segments.date, campaign.name, customer.currency_code, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${from}' AND '${to}'`);
      const days = {}, campaigns = {}; let currency = '';
      for (const r of rows) {
        const d = r.segments?.date; if (!d) continue;
        currency ||= r.customer?.currencyCode || '';
        const cost = num(r.metrics?.costMicros) / 1e6, conv = num(r.metrics?.conversions);
        const x = days[d] ||= { cost: 0, clicks: 0, impr: 0, conv: 0 };
        x.cost += cost; x.clicks += num(r.metrics?.clicks); x.impr += num(r.metrics?.impressions); x.conv += conv;
        const c = (campaigns[d] ||= {})[String(r.campaign?.name || 'Campaign').slice(0, 80)] ||= [0, 0];
        c[0] += cost; c[1] += conv;
      }
      for (const x of Object.values(days)) { x.cost = Math.round(x.cost * 100) / 100; x.conv = Math.round(x.conv * 100) / 100; }
      for (const d of Object.values(campaigns)) for (const c of Object.values(d)) { c[0] = Math.round(c[0] * 100) / 100; c[1] = Math.round(c[1] * 100) / 100; }
      return { currency: currency || 'USD', days, campaigns };
    },
  };
}

export const hostOf = host;
