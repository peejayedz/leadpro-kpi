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
export const PHASES = { brightlocal: 1, callrail: 2, ga4: 3, searchConsole: 3, gbp: 3, googleAds: 4 };

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
// v1.39.0 (queue items 7–9): six sources. cfg.sources[key] = the linked account (ids + names only), {unused:true} when the
// client doesn't use it, or absent (not linked yet). cfg.published = the tabs a Live report shows its client; tabs linked
// later stay Draft until the team presses "Publish new tabs" (after Andy).
export const SOURCE_KEYS = ['brightlocal', 'callrail', 'ga4', 'searchConsole', 'gbp', 'googleAds'];
export const SOURCE_LABELS = { brightlocal: 'BrightLocal', callrail: 'CallRail', ga4: 'GA4', searchConsole: 'Search Console', gbp: 'Google Business', googleAds: 'Google Ads' };
// The client page's tabs in the approved order, and the source each needs.
export const TAB_ORDER = ['Overview', 'Calls', 'Website leads', 'Google Search', 'Website traffic', 'Google Business Profile', 'Rankings', 'Ads'];
export const TAB_SOURCES = { Overview: 'callrail', Calls: 'callrail', 'Website leads': 'callrail', 'Google Search': 'searchConsole', 'Website traffic': 'ga4', 'Google Business Profile': 'gbp', Rankings: 'brightlocal', Ads: 'googleAds' };
const ID = /^\d{1,12}$/;
export const validLocationId = v => ID.test(String(v ?? ''));
const clip = (v, n = 120) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
// One source's public value, checked. Returns null when it isn't valid.
export function sourceValue(key, v) {
  if (!v || typeof v !== 'object') return null;
  if (v.unused === true) return { unused: true };
  switch (key) {
    case 'brightlocal': return validLocationId(v.locationId) ? { locationId: String(v.locationId), rankReportId: String(v.rankReportId || '') } : null;
    case 'callrail': return /^[A-Za-z0-9_-]{3,64}$/.test(String(v.companyId || '')) && (!v.accountId || /^[A-Za-z0-9_-]{3,64}$/.test(String(v.accountId))) ? { ...(v.accountId ? { accountId: String(v.accountId) } : {}), companyId: String(v.companyId), companyName: clip(v.companyName ?? v.name), ...(v.accountName ? { accountName: clip(v.accountName) } : {}) } : null;   // NOTE 7.1: accountId + companyId (one account per firm)
    case 'ga4': { const id = String(v.propertyId || '').replace(/^properties\//, ''); return /^\d{3,15}$/.test(id) ? { propertyId: id, name: clip(v.name) } : null; }
    case 'searchConsole': return /^(sc-domain:[a-z0-9.-]+|https?:\/\/[^\s]+\/)$/i.test(String(v.siteUrl || '')) ? { siteUrl: String(v.siteUrl) } : null;
    case 'gbp': return /^locations\/\d{3,30}$/.test(String(v.locationName || '')) ? { locationName: String(v.locationName), title: clip(v.title) } : null;
    case 'googleAds': { const id = String(v.customerId || '').replace(/-/g, ''); return /^\d{10}$/.test(id) ? { customerId: id, name: clip(v.name) } : null; }
    default: return null;
  }
}
export const isLinked = (cfg, key) => { const v = cfg?.sources?.[key]; return !!(v && !v.unused && sourceValue(key, v)); };
export const linkedSources = cfg => SOURCE_KEYS.filter(k => isLinked(cfg, k));
export function newConfig({ slug, locationId, rankReportId = '', sources = null, by = '', at = new Date().toISOString() }) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug || '')) throw new Error('A KPI slug is needed.');
  const src = {};
  if (sources) { for (const [k, v] of Object.entries(sources)) { if (!SOURCE_KEYS.includes(k) || v == null) continue; const ok = sourceValue(k, v); if (!ok) throw new Error(`Check the ${SOURCE_LABELS[k]} pick.`); src[k] = ok; } }
  if (locationId != null && locationId !== '') { if (!validLocationId(locationId)) throw new Error('Pick a BrightLocal location.'); src.brightlocal = { locationId: String(locationId), rankReportId: String(rankReportId || '') }; }
  if (!SOURCE_KEYS.some(k => src[k] && !src[k].unused)) throw new Error('Link at least one source.');
  return { v: REPORTS_V, slug, enabled: true, status: 'draft', sources: src, createdAt: at, createdBy: by, updatedAt: at };
}
// Link (value), mark "Not used by this client" ({unused:true}) or unlink (null) one source.
export function withSource(cfg, key, value, at = new Date().toISOString()) {
  if (!SOURCE_KEYS.includes(key)) throw new Error(`Unknown source ${key}.`);
  const sources = { ...(cfg.sources || {}) };
  if (value == null) delete sources[key];
  else { const ok = sourceValue(key, value); if (!ok) throw new Error(`Check the ${SOURCE_LABELS[key]} pick.`); sources[key] = ok; }
  return { ...cfg, sources, updatedAt: at };
}
export function withBrightLocal(cfg, { locationId, rankReportId = '' }, at = new Date().toISOString()) {
  if (!validLocationId(locationId)) throw new Error('Pick a BrightLocal location.');
  return withSource(cfg, 'brightlocal', { locationId, rankReportId }, at);
}
export const withBuildRequest = (cfg, { id, by, at = new Date().toISOString() }) => ({ ...cfg, buildRequest: { id: String(id), by: String(by || '').slice(0, 60), at } });
// Going Live publishes every tab linked at that moment (what Andy reviewed). Running it again on a report that is already
// Live (the menu link re-added) keeps what was published: Draft tabs still need "Publish new tabs".
export const withLive = (cfg, { by, at = new Date().toISOString() }) => (cfg?.status === 'live'
  ? { ...cfg, published: publishedTabs(cfg) }
  : { ...cfg, status: 'live', liveAt: at, liveBy: String(by || '').slice(0, 60), published: tabsFor(cfg), publishedAt: at, publishedBy: String(by || '').slice(0, 60) });
// The tabs this config can show (linked sources only), in the approved order.
export const tabsFor = cfg => TAB_ORDER.filter(t => isLinked(cfg, TAB_SOURCES[t]));
// What a Live report already shows its client. A Live report from Phase 1 (no "published" yet) showed Rankings only.
export const publishedTabs = cfg => (Array.isArray(cfg?.published) ? cfg.published.filter(t => TAB_ORDER.includes(t)) : cfg?.status === 'live' ? ['Rankings'] : []);
// Linked tabs a Live report doesn't show its client yet (Draft until "Publish new tabs").
export const draftTabs = cfg => (cfg?.status === 'live' ? tabsFor(cfg).filter(t => !publishedTabs(cfg).includes(t)) : []);
// The tabs the client page shows: a whole-report Draft shows every linked tab (with the Draft banner, as in Phase 1);
// a Live report shows only its published tabs, or every linked tab with ?drafts=1 (the team's "Open report (with drafts)").
export const visibleTabs = (cfg, { drafts = false } = {}) => (!cfg?.enabled ? [] : cfg.status !== 'live' || drafts ? tabsFor(cfg) : tabsFor(cfg).filter(t => publishedTabs(cfg).includes(t)));
export const withPublished = (cfg, { tabs = tabsFor(cfg), by = '', at = new Date().toISOString() } = {}) => ({ ...cfg, published: TAB_ORDER.filter(t => tabs.includes(t)), publishedAt: at, publishedBy: String(by || '').slice(0, 60) });
// The nightly list: every config that is enabled and has at least one linked source.
export const pullable = cfg => !!(cfg && cfg.enabled && linkedSources(cfg).length);
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

// v1.39.0: the same match for every source's dropdown. list items are read with nameOf / urlOf; returns { id, score, why } or null.
export function suggestMatch(list, { name, website } = {}, { idOf = x => x.id, nameOf = x => x.name, urlOf = x => x.url || x.website || '' } = {}) {
  const h = host(website), n = norm(name);
  let best = null;
  for (const x of list || []) {
    const xn = norm(nameOf(x)), xh = host(String(urlOf(x) || '').replace(/^sc-domain:/, ''));
    const byWeb = !!(h && xh && xh === h), byName = !!(n && xn && (xn.includes(n) || n.includes(xn)));
    const score = (byWeb ? 2 : 0) + (byName ? 1 : 0);
    if (score && (!best || score > best.score)) best = { id: idOf(x), score, why: byWeb && byName ? `matched by name and website (${h})` : byWeb ? `matched by website (${h})` : 'matched by name' };
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
// One issue per firm whose last run failed as a whole (config, passphrase, crash), and v1.39.0 one per broken source
// (id reports:<slug>:<source>, so each alerts once when it starts, same rules as the KPI issues). "No key" is never an issue.
export const NO_ACCESS_HINT = { ga4: 'Ask the client to add the robot email as a Viewer in GA4.', searchConsole: 'Ask the client to add the robot email as a Restricted user in Search Console.',
  gbp: 'Check that LFMP\'s Google account still manages this Business Profile.', googleAds: 'Send a link request from LFMP\'s Google Ads manager account again.', callrail: 'Check the company in CallRail (removed, or the key lost access).', brightlocal: 'Check the location in BrightLocal.' };
export function reportsIssues(status, { firms = [] } = {}) {
  const name = slug => firms.find(f => f.slug === slug)?.name || slug;
  const out = [];
  for (const [slug, s] of Object.entries(status?.firms || {})) {
    if (!s) continue;
    const bad = Object.entries(s.sources || {}).filter(([, x]) => x && x.ok === false);
    for (const [k, x] of bad) {
      const what = x.kind === 'no_access' ? 'no access' : x.kind === 'gone' ? 'not found' : 'broken';
      out.push({ id: `reports:${slug}:${k}`, kind: 'reports', slug, source: k, firstSeen: x.firstFailedAt || x.at, lastSeen: x.at, category: x.kind || 'error', detail: `${x.message || ''}${x.kind === 'no_access' || x.kind === 'gone' ? ` ${NO_ACCESS_HINT[k] || ''}` : ''}`.trim(), runUrl: s.runUrl || '', title: `${name(slug)}: Reports · ${SOURCE_LABELS[k] || k} ${what}` });
    }
    if (s.ok === false && !bad.length) out.push({ id: `reports:${slug}`, kind: 'reports', slug, firstSeen: s.firstFailedAt || s.at, lastSeen: s.at, category: s.kind || 'error', detail: s.message || '', runUrl: s.runUrl || '', title: `${name(slug)}: Reports build failed` });
  }
  return out;
}

// ================================================================ v1.39.0 (queue items 7–9): calls, forms, search, traffic, profile, ads
// reports.json v2 (decrypted) holds per-day numbers for each linked source, 400 days, so the client page can show any range
// and its previous period:
//   { v: 2, slug, generatedAt, through: 'YYYY-MM-DD' (last full day, ET), site, location, rankings (Phase 1 object) | null,
//     calls:   { company: { id, name }, days: { d: { t, a, m, f, s: { gbp, ads, organic, direct, other } } }, forms: { d: { n, f } } } | null,
//     search:  { days: { d: { c, i, pi } }, top: [[query, clicks, position]] (≤ 25, last 90 days) } | null,
//     traffic: { days: { d: { s, u, dur, k } }, channels: { d: { group: sessions } }, hasKeyEvents } | null,
//     gbp:     { days: { d: { calls, dir, web, vs, vm } } } | null,
//     ads:     { currency, days: { d: { cost, clicks, impr, conv } }, campaigns: { d: { name: [cost, conv] } } } | null }
// Numbers only: no caller names / numbers / recordings / transcripts / form fields / messages exist in this object.
export const REPORTS_V2 = 2;
export const KEEP_DAYS = 400;
export const REPULL_DAYS = 5;   // each night re-reads the last few days (late calls, Google's 2–3 day lag fills in); older days stay as stored
export const SEARCH_LAG_DAYS = 2;
export const CALL_SOURCES = [['gbp', 'Google Business Profile'], ['ads', 'Google Ads'], ['organic', 'Google organic'], ['direct', 'Direct'], ['other', 'Other']];
export const RANGES = [['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['month', 'This month'], ['lastMonth', 'Last month']];
export const DEFAULT_RANGE = '30d';

const D = s => new Date(`${s}T12:00:00Z`);
export const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((D(b) - D(a)) / 864e5) + 1;
export const dayList = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out; };
// The last full day of data: the day before generatedAt, in New York time (the nightly runs at 2 AM ET).
export const throughOf = generatedAt => addDays(new Date(generatedAt).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), -1);

// A date range and its previous period. through = the last full day.
export function rangeFor(key, through) {
  const [y, m] = through.split('-').map(Number);
  const first = (yy, mm) => new Date(Date.UTC(yy, mm - 1, 1, 12)).toISOString().slice(0, 10);
  const last = (yy, mm) => new Date(Date.UTC(yy, mm, 0, 12)).toISOString().slice(0, 10);
  let from, to, prevFrom, prevTo;
  if (key === 'month') { from = first(y, m); to = through; const n = daysBetween(from, to); prevFrom = first(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1); prevTo = addDays(prevFrom, n - 1); const pl = last(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1); if (prevTo > pl) prevTo = pl; }
  else if (key === 'lastMonth') { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; from = first(py, pm); to = last(py, pm); const qy = pm === 1 ? py - 1 : py, qm = pm === 1 ? 12 : pm - 1; prevFrom = first(qy, qm); prevTo = last(qy, qm); }
  else { const n = { '7d': 7, '30d': 30, '90d': 90 }[key] || 30; to = through; from = addDays(to, -(n - 1)); prevTo = addDays(from, -1); prevFrom = addDays(prevTo, -(n - 1)); }
  return { key: RANGES.some(r => r[0] === key) ? key : DEFAULT_RANGE, from, to, prevFrom, prevTo, days: daysBetween(from, to) };
}
const fmtD = (s, year) => D(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' });
// "Aug 3 – Aug 9, 2026" (the date pill)
export const rangeLabel = r => (r.from.slice(0, 4) === r.to.slice(0, 4) ? `${fmtD(r.from)} – ${fmtD(r.to, true)}` : `${fmtD(r.from, true)} – ${fmtD(r.to, true)}`);
// Words for the period: "This week" / "the week before" for 7 days, otherwise the range's name.
export const periodWords = key => (key === '7d' ? { now: 'This week', before: 'the week before', legendNow: 'This week', legendBefore: 'Week before', lower: 'this week' }
  : key === 'month' ? { now: 'This month', before: 'the period before', legendNow: 'This month', legendBefore: 'Previous period', lower: 'this month' }
  : key === 'lastMonth' ? { now: 'Last month', before: 'the month before', legendNow: 'Last month', legendBefore: 'Month before', lower: 'last month' }
  : { now: RANGES.find(r => r[0] === key)?.[1] || 'This period', before: 'the period before', legendNow: 'This period', legendBefore: 'Previous period', lower: `in the ${(RANGES.find(r => r[0] === key)?.[1] || 'period').toLowerCase()}` });
// % change, rounded; null when there's nothing to compare with.
export const pct = (now, before) => (before ? Math.round((now - before) / before * 100) : null);

const sumOver = (days, from, to, f) => { let t = 0; for (const [d, v] of Object.entries(days || {})) if (d >= from && d <= to) t += f(v) || 0; return t; };
const series = (days, from, to, f) => dayList(from, to).map(d => (days?.[d] ? f(days[d]) || 0 : 0));

export function callsIn(calls, r) {
  if (!calls) return null;
  const one = (from, to) => {
    const s = Object.fromEntries(CALL_SOURCES.map(([k]) => [k, sumOver(calls.days, from, to, v => v.s?.[k])]));
    return { t: sumOver(calls.days, from, to, v => v.t), a: sumOver(calls.days, from, to, v => v.a), m: sumOver(calls.days, from, to, v => v.m), f: sumOver(calls.days, from, to, v => v.f), s,
      forms: sumOver(calls.forms, from, to, v => v.n), formsFirst: sumOver(calls.forms, from, to, v => v.f), daily: series(calls.days, from, to, v => v.t) };
  };
  const now = one(r.from, r.to), prev = one(r.prevFrom, r.prevTo);
  // sources with calls, biggest first; "Other" last
  const src = CALL_SOURCES.map(([k, l]) => [l, now.s[k], k]).filter(x => x[1] > 0).sort((a, b) => (a[2] === 'other') - (b[2] === 'other') || b[1] - a[1]);
  return { ...now, prev, src, chg: { t: pct(now.t, prev.t), f: pct(now.f, prev.f), a: pct(now.a, prev.a), m: pct(now.m, prev.m), forms: pct(now.forms, prev.forms) } };
}
export function searchIn(search, r) {
  if (!search) return null;
  const one = (from, to) => { const c = sumOver(search.days, from, to, v => v.c), i = sumOver(search.days, from, to, v => v.i), pi = sumOver(search.days, from, to, v => v.pi); return { c, i, pos: i ? Math.round(pi / i * 10) / 10 : null, ctr: i ? Math.round(c / i * 1000) / 10 : null, daily: series(search.days, from, to, v => v.c) }; };
  const now = one(r.from, r.to), prev = one(r.prevFrom, r.prevTo);
  return { ...now, prev, chg: { c: pct(now.c, prev.c), i: pct(now.i, prev.i) }, top: (search.top || []).slice(0, 25) };
}
export function trafficIn(traffic, r) {
  if (!traffic) return null;
  const one = (from, to) => { const s = sumOver(traffic.days, from, to, v => v.s); return { s, u: sumOver(traffic.days, from, to, v => v.u), dur: s ? Math.round(sumOver(traffic.days, from, to, v => v.dur) / s) : 0, k: sumOver(traffic.days, from, to, v => v.k), daily: series(traffic.days, from, to, v => v.s) }; };
  const now = one(r.from, r.to), prev = one(r.prevFrom, r.prevTo);
  const ch = {}; for (const [d, g] of Object.entries(traffic.channels || {})) if (d >= r.from && d <= r.to) for (const [k, v] of Object.entries(g)) ch[k] = (ch[k] || 0) + v;
  const channels = Object.entries(ch).map(([k, v]) => [channelLabel(k), v]).reduce((a, [k, v]) => { const x = a.find(y => y[0] === k); x ? (x[1] += v) : a.push([k, v]); return a; }, []).sort((a, b) => b[1] - a[1]);
  const google = (ch['Organic Search'] || 0) + (ch['Organic Maps'] || 0);   // "from Google" = Google search + Business Profile (unpaid), as the approved Overview
  return { ...now, prev, chg: { s: pct(now.s, prev.s) }, channels, hasKeyEvents: !!traffic.hasKeyEvents, leadRate: traffic.hasKeyEvents && now.s ? Math.round(now.k / now.s * 1000) / 10 : null, fromGoogle: now.s ? Math.round(google / now.s * 100) : 0 };
}
// GA4's channel groups in the report's words.
export const channelLabel = k => ({ 'Organic Search': 'Organic search', 'Paid Search': 'Paid search', Direct: 'Direct', Referral: 'Referral', 'Organic Social': 'Social', 'Paid Social': 'Social', 'Organic Maps': 'Google Business Profile', Email: 'Email', Unassigned: 'Other', '(other)': 'Other' }[k] || k);
export function gbpIn(gbp, r) {
  if (!gbp) return null;
  const one = (from, to) => { const o = { calls: sumOver(gbp.days, from, to, v => v.calls), dir: sumOver(gbp.days, from, to, v => v.dir), web: sumOver(gbp.days, from, to, v => v.web), vs: sumOver(gbp.days, from, to, v => v.vs), vm: sumOver(gbp.days, from, to, v => v.vm) }; o.actions = o.calls + o.dir + o.web; o.views = o.vs + o.vm; return o; };
  const now = one(r.from, r.to), prev = one(r.prevFrom, r.prevTo);
  return { ...now, prev, chg: { actions: pct(now.actions, prev.actions) } };
}
export function adsIn(ads, r) {
  if (!ads) return null;
  const one = (from, to) => { const cost = Math.round(sumOver(ads.days, from, to, v => v.cost) * 100) / 100, conv = Math.round(sumOver(ads.days, from, to, v => v.conv) * 100) / 100; return { cost, conv, clicks: sumOver(ads.days, from, to, v => v.clicks), impr: sumOver(ads.days, from, to, v => v.impr), cpl: conv > 0 ? cost / conv : null }; };
  const now = one(r.from, r.to), prev = one(r.prevFrom, r.prevTo);
  const camp = {}; for (const [d, g] of Object.entries(ads.campaigns || {})) if (d >= r.from && d <= r.to) for (const [k, [c, v]] of Object.entries(g)) { const x = camp[k] ||= [0, 0]; x[0] += c; x[1] += v; }
  const campaigns = Object.entries(camp).map(([k, [c, v]]) => ({ name: k, cost: Math.round(c * 100) / 100, conv: Math.round(v * 100) / 100, cpl: v > 0 ? c / v : null })).filter(c => c.cost > 0 || c.conv > 0).sort((a, b) => b.cost - a.cost);
  return { ...now, prev, currency: ads.currency || 'USD', campaigns, cplChange: now.cpl != null && prev.cpl != null ? Math.round(now.cpl - prev.cpl) : null };
}
// Money in the account's currency: USD → $1,490 (whole dollars, as the preview).
export const money = (v, currency = 'USD') => (v == null ? '–' : new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(Math.round(v)));

// Merge the new days into the stored ones: new days win; anything older than KEEP_DAYS before `through` is dropped.
export function mergeDays(old, fresh, through, keep = KEEP_DAYS) {
  const cut = addDays(through, -(keep - 1)), out = {};
  for (const src of [old || {}, fresh || {}]) for (const [d, v] of Object.entries(src)) if (d >= cut && d <= through) out[d] = v;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}
// The range a source must read tonight: everything (KEEP_DAYS) the first time, otherwise from its last stored day minus
// REPULL_DAYS (history stays as stored).
export function pullWindow(days, through, { lag = 0 } = {}) {
  const to = addDays(through, -lag), keys = Object.keys(days || {}).sort(), lastHave = keys.at(-1);
  const from = lastHave ? (addDays(lastHave, -REPULL_DAYS) < addDays(to, -(KEEP_DAYS - 1)) ? addDays(to, -(KEEP_DAYS - 1)) : addDays(lastHave, -REPULL_DAYS)) : addDays(to, -(KEEP_DAYS - 1));
  return { from: from > to ? to : from, to };
}
// An older (v1, rankings only) reports.json reads as v2.
export const asV2 = rep => (!rep ? null : rep.v >= 2 ? rep : { v: REPORTS_V2, slug: rep.slug, generatedAt: rep.generatedAt, through: throughOf(rep.generatedAt), site: '', location: rep.location || null, rankings: rep, calls: null, search: null, traffic: null, gbp: null, ads: null });
