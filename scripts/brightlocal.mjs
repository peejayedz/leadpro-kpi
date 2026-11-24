// v1.37.0 LeadPro Reports, Phase 1: the ONE place that talks to BrightLocal (official Manage Account API, Local Rank
// Tracker = "lsrc"). Used by the nightly pull (scripts/reports-pull.mjs, GitHub Actions) and by the team site's
// /api/reports/catalog (Builder admin-site/lib/reports-catalog.mjs, Cloudflare). Plain fetch + Web Crypto only, so it runs
// in both. READ ONLY: no call here adds, edits, runs or deletes a report (running a report costs credits; reading is free).
//
// Auth (BrightLocal's API: key + optional signature): api-key always; when a secret is set, also expires (now + 30 min)
// and sig = base64(HMAC-SHA1(api-key + expires, secret)). Secrets (names only): BRIGHTLOCAL_API_KEY, BRIGHTLOCAL_API_SECRET.
//
// Endpoints (v2 under https://tools.brightlocal.com/seo-tools/api). PHASE 0.5 (needs the real key): check that these
// return the NEW Local Rank Tracker report for location 3839215 and match the 31 Oct numbers; the field names read
// below are kept in one function each (readLocations / readReports / readResults / readHistory) so a difference is a
// one-place fix. The test fixtures (tests/reports/fixtures/) are built in this shape from the 31 Oct report.
//   GET /v2/clients-and-locations/locations/search?q=   locations (id, name, url, city, region)
//   GET /v2/lsrc/get-all?location-id=                  the location's rank reports (campaign_id, name, last run)
//   GET /v2/lsrc/results/get?campaign-id=              the latest run: keywords, ranks per search engine, last rank, volume
//   GET /v2/lsrc/history/get?campaign-id=              one row per run: date + average positions

export const BL_BASE = 'https://tools.brightlocal.com/seo-tools/api';
export const ENGINES = { desktop: 'google', mobile: 'google-mobile', localFinder: 'google-local' };

const b64 = buf => { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); };
export async function signature(key, secret, expires) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  return b64(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${key}${expires}`)));
}

export class BrightLocalError extends Error {
  constructor(message, { status = 0, kind = 'api' } = {}) { super(message); this.status = status; this.kind = kind; }
}

// client({ key, secret, fetch, now }) → { locations(q), reports(locationId), results(campaignId), history(campaignId), stats }
// v1.41.0 (queue item 12): stats.requests counts every request this client sent (a trial key allows 1,000 in total; the
// nightly writes its count to status/reports-status.json, the team site counts its own in KV). locations() reads every page
// when BrightLocal's answer says there are more (no cap here; the team site sorts the whole list).
export function client({ key, secret = '', fetch: f = globalThis.fetch, now = () => Date.now(), base = BL_BASE } = {}) {
  if (!key) throw new BrightLocalError('BrightLocal key not set yet', { kind: 'no_key' });
  const stats = { requests: 0 };
  async function get(path, params = {}) {
    const q = new URLSearchParams({ 'api-key': key, ...params });
    if (secret) { const expires = String(Math.floor(now() / 1000) + 1800); q.set('expires', expires); q.set('sig', await signature(key, secret, expires)); }
    let r;
    stats.requests++;
    try { r = await f(`${base}${path}?${q}`, { headers: { Accept: 'application/json' } }); }
    catch (e) { throw new BrightLocalError(`BrightLocal didn't answer (${e.message})`, { kind: 'network' }); }
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    if (r.status === 401 || r.status === 403) throw new BrightLocalError('BrightLocal refused the key (check BRIGHTLOCAL_API_KEY / BRIGHTLOCAL_API_SECRET)', { status: r.status, kind: 'auth' });
    if (!r.ok) throw new BrightLocalError(`BrightLocal answered ${r.status}`, { status: r.status, kind: r.status >= 500 ? 'server' : 'api' });
    if (!j || j.success === false) throw new BrightLocalError(`BrightLocal said no: ${errText(j) || 'no details'}`, { status: r.status, kind: 'api' });
    return j.response ?? j;
  }
  return {
    locations: async (q = '') => {
      const first = await get('/v2/clients-and-locations/locations/search', { q }), out = readLocations(first);
      for (let page = 2, pages = pagesOf(first); page <= Math.min(pages, MAX_PAGES); page++) out.push(...readLocations(await get('/v2/clients-and-locations/locations/search', { q, page: String(page) })));
      return out;
    },
    reports: async locationId => readReports(await get('/v2/lsrc/get-all', { 'location-id': String(locationId) })),
    results: async campaignId => readResults(await get('/v2/lsrc/results/get', { 'campaign-id': String(campaignId) })),
    history: async campaignId => readHistory(await get('/v2/lsrc/history/get', { 'campaign-id': String(campaignId) })),
    stats,
  };
}
// More pages only when the answer says so (total_pages / pages / last_page); BrightLocal's location search usually answers
// with every match at once. MAX_PAGES keeps a wrong answer from looping.
export const MAX_PAGES = 20;
export const pagesOf = resp => { const n = Number(resp?.total_pages ?? resp?.pages ?? resp?.last_page ?? resp?.meta?.total_pages ?? 1); return Number.isFinite(n) && n > 1 ? Math.floor(n) : 1; };
const errText = j => { const e = j?.errors || j?.error; return typeof e === 'string' ? e : e && typeof e === 'object' ? Object.values(e).flat().join('; ') : ''; };
const num = v => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const rank = v => { const n = num(v); return n && n > 0 ? n : null; };   // 0 / "" / null = not found

// ---------------------------------------------------------------- shape readers (Phase 0.5: check against the real API)
export function readLocations(resp) {
  const list = resp?.results || resp?.locations || [];
  return list.map(l => ({ id: String(l['location-id'] ?? l.location_id ?? l.id), name: String(l['location-name'] ?? l.location_name ?? l.name ?? ''),
    url: String(l.url ?? l.website ?? ''), city: String(l.city ?? l.locality ?? ''), region: String(l.region ?? l.state ?? ''), ref: String(l['location-reference'] ?? l.reference ?? '') }))
    .filter(l => l.id && l.id !== 'undefined');
}
export function readReports(resp) {
  const list = resp?.results || resp?.reports || [];
  return list.map(c => ({ id: String(c.campaign_id ?? c['campaign-id'] ?? c.id), name: String(c.name ?? ''), locationId: String(c.location_id ?? c['location-id'] ?? ''),
    lastRun: String(c.last_processed ?? c.last_run ?? ''), keywords: num(c.keyword_count ?? c.keywords_count), engines: String(c.search_engines ?? '').split(',').filter(Boolean),
    searchFrom: String(c.search_location ?? c.location ?? '') }))
    .filter(c => c.id && c.id !== 'undefined');
}
export function readResults(resp) {
  const r = resp?.result || resp;
  const rk = r?.rankings || {}, words = rk.keywords || Object.keys(rk.rankings || {}), info = rk.keywords_info || r?.keywords_info || {};
  const keywords = words.map(k => {
    const per = rk.rankings?.[k] || {};
    const top = e => (Array.isArray(per[e]) ? per[e][0] : per[e]) || {};
    const d = top(ENGINES.desktop), m = top(ENGINES.mobile), l = top(ENGINES.localFinder);
    return { k, vol: info[k]?.search_volume ?? info[k]?.volume ?? null, d: rank(d.rank), m: rank(m.rank), l: rank(l.rank),
      dLast: rank(d.last), mLast: rank(m.last), lLast: rank(l.last) };
  });
  const comp = r?.competitors || rk.competitors || null;
  return {
    campaignId: String(r?.campaign_id ?? ''), runAt: String(r?.last_processed ?? r?.run_date ?? ''), prevRunAt: String(r?.previous_processed ?? r?.previous_run ?? ''),
    searchFrom: String(r?.search_location ?? ''), keywords,
    summary: r?.summary ? { avg: num(r.summary.average_position), avgPrev: num(r.summary.previous_average_position), keywordChange: num(r.summary.keyword_change),
      positionalChange: num(r.summary.positional_change), mapPack: num(r.summary.map_pack_coverage), distribution: r.summary.rank_distribution || null } : null,
    competitors: Array.isArray(comp?.names) && comp.names.length ? { names: comp.names.map(String), ranks: comp.ranks || {} } : null,
  };
}
export function readHistory(resp) {
  const list = resp?.results || resp?.history || [];
  return list.map(h => ({ date: String(h.date ?? h.run_date ?? h.processed ?? '').slice(0, 10), avg: num(h.average_position),
    desktop: num(h[ENGINES.desktop]?.average_position ?? h.desktop), mobile: num(h[ENGINES.mobile]?.average_position ?? h.mobile),
    localFinder: num(h[ENGINES.localFinder]?.average_position ?? h.local_finder) }))
    .filter(h => /^\d{4}-\d{2}-\d{2}$/.test(h.date)).sort((a, b) => a.date.localeCompare(b.date));
}
