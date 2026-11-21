// v1.37.0 LeadPro Reports, Phase 1 (BrightLocal Rankings). Pure functions, no I/O: the nightly pull (reports-pull.mjs),
// the client page (app/reports.html), the team site (Builder reports.js, via /leadpro-kpi/scripts/) and the tests use them.
//
// Files per firm (leadpro-kpi):
//   firms/<slug>/reports-config.json  PUBLIC, written by the Builder's Reports tab: which BrightLocal location / rank
//                                     report, Draft or Live, the menu link, the last "Build now" request. No numbers.
//   firms/<slug>/reports.json         the numbers, ENCRYPTED with the firm's KPI passphrase (kpi-core encryptJSON); the
//                                     public part is only { v, generatedAt, enc }.
//   firms/<slug>/reports.html         stub that loads app/reports.html (like index.html loads the dashboard)
//   status/reports-status.json        PUBLIC run status of every firm for the team site and the bell: time, ok, keyword
//                                     count, error kind + short reason, request id (scripts/reports-pull.mjs finish).

export const REPORTS_V = 1;
export const configPath = slug => `firms/${slug}/reports-config.json`;
export const dataPath = slug => `firms/${slug}/reports.json`;
export const stubPath = slug => `firms/${slug}/reports.html`;
export const STATUS_PATH = 'status/reports-status.json';
export const NIGHTLY = { cronUtc: '0 7 * * *', label: '2:00 AM ET' };   // 07:00 UTC = 2:00 AM EST (3:00 AM in summer time)
export const PHASES = { brightlocal: 1, callrail: 2, ga4: 3, searchConsole: 3, googleAds: 4 };

// The stub: same pattern as firms/<slug>/index.html (KPI dashboard).
export const STUB_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>LeadPro Reports</title>
</head>
<body>
<!-- Firm stub: loads the shared report page (app/reports.html). It reads this firm's slug from the URL path and loads
     ./reports-config.json, ./reports.json (encrypted) and ./data/kpis.json (brand) from here. -->
<p id="stubMsg" style="font:14px system-ui,sans-serif;color:#666;padding:24px">Loading…</p>
<script>
var page = '../../app/reports.html';   // the shared report page (two folders up from firms/<slug>/)
fetch(page, { cache: 'no-store' })
  .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
  .then(html => { document.open(); document.write(html); document.close(); })
  .catch(e => { document.getElementById('stubMsg').textContent = 'Could not load the report (' + e.message + '). Please refresh.'; });
</script>
</body>
</html>
`;

// ---------------------------------------------------------------- config (public)
const ID = /^\d{1,12}$/;
export const validLocationId = v => ID.test(String(v ?? ''));
export function newConfig({ slug, locationId, rankReportId = '', by = '', at = new Date().toISOString() }) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug || '')) throw new Error('A KPI slug is needed.');
  if (!validLocationId(locationId)) throw new Error('Pick a BrightLocal location.');
  return { v: REPORTS_V, slug, enabled: true, status: 'draft', sources: { brightlocal: { locationId: String(locationId), rankReportId: String(rankReportId || '') } }, createdAt: at, createdBy: by, updatedAt: at };
}
export function withBrightLocal(cfg, { locationId, rankReportId = '' }, at = new Date().toISOString()) {
  if (!validLocationId(locationId)) throw new Error('Pick a BrightLocal location.');
  return { ...cfg, sources: { ...(cfg.sources || {}), brightlocal: { locationId: String(locationId), rankReportId: String(rankReportId || '') } }, updatedAt: at };
}
export const withBuildRequest = (cfg, { id, by, at = new Date().toISOString() }) => ({ ...cfg, buildRequest: { id: String(id), by: String(by || '').slice(0, 60), at } });
export const withLive = (cfg, { by, at = new Date().toISOString() }) => ({ ...cfg, status: 'live', liveAt: at, liveBy: String(by || '').slice(0, 60) });
// The nightly list: every config that is enabled and has a BrightLocal location.
export const pullable = cfg => !!(cfg && cfg.enabled && validLocationId(cfg.sources?.brightlocal?.locationId));
// A push run builds a firm only when its Build now request is newer than its last run.
export const wantsBuild = (cfg, status) => !!cfg?.buildRequest?.id && cfg.buildRequest.id !== status?.request;

// ---------------------------------------------------------------- suggest the BrightLocal location for a client
const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\b(the|pllc|llc|pc|p\.c|pa|p\.a|inc|law firm|law group|law office|esq)\b\.?/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const host = u => String(u || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
export function suggestLocation(locations, { name, website } = {}) {
  const h = host(website), n = norm(name);
  let best = null;
  for (const l of locations || []) {
    const byWeb = h && host(l.url) === h, byName = n && norm(l.name) && (norm(l.name).includes(n) || n.includes(norm(l.name)));
    const score = (byWeb ? 2 : 0) + (byName ? 1 : 0);
    if (score && (!best || score > best.score)) best = { id: l.id, score, why: byWeb && byName ? `matched by name and website (${h})` : byWeb ? `matched by website (${h})` : 'matched by name' };
  }
  return best;
}

// ---------------------------------------------------------------- numbers (what reports.json holds, decrypted)
export const MIX_BANDS = [['#1', 1, 1], ['#2–5', 2, 5], ['#6–10', 6, 10], ['#11–20', 11, 20], ['#21+ / not found', 21, Infinity]];
const r1 = n => (n == null ? null : Math.round(n * 10) / 10);
const inTop20 = k => [k.d, k.m, k.l].some(v => v != null && v <= 20);
const best = k => Math.min(...[k.d, k.m, k.l].map(v => v ?? Infinity));
// Positions mix (desktop): BrightLocal's own distribution when the API gives one, otherwise counted from desktop ranks.
export function positionsMix(keywords, distribution) {
  if (distribution && typeof distribution === 'object') {
    const keys = { '#1': ['1', 'pos_1'], '#2–5': ['2-5', 'pos_2_5'], '#6–10': ['6-10', 'pos_6_10'], '#11–20': ['11-20', 'pos_11_20'], '#21+ / not found': ['21+', 'not_found_or_21_plus'] };
    const out = MIX_BANDS.map(([l]) => [l, Number(keys[l].map(k => distribution[k]).find(v => v != null) ?? NaN)]);
    if (out.every(([, v]) => Number.isFinite(v))) return { bands: out, from: 'brightlocal' };
  }
  return { bands: MIX_BANDS.map(([l, lo, hi]) => [l, keywords.filter(k => (lo === 21 ? k.d == null || k.d >= 21 : k.d != null && k.d >= lo && k.d <= hi)).length]), from: 'counted' };
}
// The last 6 months of runs, averaged per month and per search (the chart).
export function monthly(history, months = 6) {
  const by = new Map();
  for (const h of history || []) { const m = h.date.slice(0, 7); if (!by.has(m)) by.set(m, []); by.get(m).push(h); }
  const keys = [...by.keys()].sort().slice(-months);
  const avg = (rows, f) => { const v = rows.map(x => x[f]).filter(x => x != null); return v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null; };
  const label = m => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return { months: keys.map(label), keys, desktop: keys.map(k => avg(by.get(k), 'desktop')), mobile: keys.map(k => avg(by.get(k), 'mobile')), localFinder: keys.map(k => avg(by.get(k), 'localFinder')) };
}
// One firm's report from what BrightLocal returned. Numbers only: no contact data exists in Rank Tracker.
export function buildReport({ slug, location, report, results, history, now = new Date() }) {
  const kw = (results?.keywords || []).map(k => {
    const ch = k.d != null && k.dLast != null ? k.dLast - k.d : k.l != null && k.lLast != null ? k.lLast - k.l : 0;
    return { k: k.k, vol: k.vol == null ? '' : String(k.vol), d: k.d, m: k.m, l: k.l, change: ch };
  });
  const hist = history || [], last = hist.at(-1), prev = hist.at(-2);
  const s = results?.summary || {};
  const avg = s.avg ?? last?.avg ?? null, avgPrev = s.avgPrev ?? prev?.avg ?? null;
  const moved = kw.filter(k => k.change).length ? { keyword: kw.filter(k => k.change > 0).length - kw.filter(k => k.change < 0).length, positional: kw.reduce((a, k) => a + k.change, 0) } : { keyword: 0, positional: 0 };
  const comp = results?.competitors;
  const youOf = k => kw.find(x => x.k === k)?.d ?? null;
  const competitors = comp ? { names: comp.names.slice(0, 3), rows: Object.entries(comp.ranks).map(([k, ranks]) => [k, youOf(k), ...comp.names.slice(0, 3).map((_, i) => (ranks?.[i] > 0 ? Number(ranks[i]) : null))]) } : null;
  return {
    v: REPORTS_V, slug, source: 'brightlocal', generatedAt: now.toISOString(),
    location: location ? { id: String(location.id), name: location.name || '', city: [location.city, location.region].filter(Boolean).join(', ') } : null,
    report: { id: String(report?.id || results?.campaignId || ''), name: report?.name || '', runAt: (results?.runAt || last?.date || '').slice(0, 10), prevRunAt: (results?.prevRunAt || prev?.date || '').slice(0, 10), checkedFrom: results?.searchFrom || report?.searchFrom || '' },
    summary: { avg: r1(avg), avgPrev: r1(avgPrev), avgChange: avg != null && avgPrev != null ? r1(avg - avgPrev) : null, tracked: kw.length, top20: kw.filter(inTop20).length,
      movement: { keyword: s.keywordChange ?? moved.keyword, positional: s.positionalChange ?? moved.positional }, mapPack: s.mapPack ?? (kw.length ? Math.round(kw.filter(k => k.l != null && k.l <= 3).length / kw.length * 100) : 0) },
    mix: positionsMix(kw, s.distribution),
    keywords: kw,
    competitors,
    history: monthly(hist),
  };
}
export const bestRank = best;

// ---------------------------------------------------------------- bell + Slack (same rules as the KPI issues: one DM when it starts)
// One issue per firm whose last run failed. "No key" is never an issue (nothing runs without the key).
export function reportsIssues(status, { firms = [] } = {}) {
  const name = slug => firms.find(f => f.slug === slug)?.name || slug;
  return Object.entries(status?.firms || {}).filter(([, s]) => s && s.ok === false)
    .map(([slug, s]) => ({ id: `reports:${slug}`, kind: 'reports', slug, firstSeen: s.firstFailedAt || s.at, lastSeen: s.at, category: s.kind || 'error', detail: s.message || '', runUrl: s.runUrl || '', title: `${name(slug)}: Reports build failed` }));
}
