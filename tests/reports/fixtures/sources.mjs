// v1.39.0 test fixtures for CallRail + Google (queue items 7–9). A fake fetch that answers like the real APIs, built from
// per-day number tables. Nothing here calls the network.
//   Mahdavi, Aug 3–9 2026 = REAL CallRail totals: 107 calls (week before 83), 40 first-time, 93 answered, 14 missed;
//   sources GBP 69 · Ads 18 · organic 8 · direct 5; 1 form, 0 first-time. Search Console / GA4 / Business Profile numbers
//   are the preview's SAMPLE numbers. Sample Firm A: the preview's sample calls + Google Ads (spend $1,490, 8 conversions,
//   201 clicks, 3 campaigns). Every other day (back to 400 days) is made up but fixed; every id is made up.
//   Each CallRail call row carries a made-up caller name, number and recording link, so the tests can prove none of it is kept.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as RC from '../../../scripts/reports-core.mjs';

const FX = fileURLToPath(new URL('./', import.meta.url));
export const THROUGH = '2026-08-09';
export const NOW = new Date('2026-08-10T06:00:00Z');   // 2:00 AM ET, Aug 10 → last full day Aug 9
export const PII = { name: 'Jane Q Testcaller', phone: '+17135550123', recording: 'https://app.callrail.com/calls/CALzzz/recording', form: 'my-secret-message@example.com' };
export const IDS = {
  mahdavi: { crAccount: 'ACC8f00a1b2c3d4', crCompany: 'COM8f1a2b3c', ga4: '310000001', sc: 'sc-domain:mahdavilawfirm.com', gbp: 'locations/1000000000000000001', site: 'https://mahdavilawfirm.com/' },
  sample: { crAccount: 'ACC5a5a5a5a5a5a', crCompany: 'COM5a5a5a5a', ga4: '310000002', sc: 'https://samplefirma.com/', gbp: 'locations/1000000000000000002', ads: '1234567890', site: 'https://samplefirma.com/' },
  lost: { ga4: '310000099', ads: '9999999999' },
  mcc: '5550001111',
};

// a fixed pseudo-random 0..1 from a string (made-up days look natural but never change)
const rnd = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return ((h >>> 0) % 10000) / 10000; };
// split a total over weights into whole numbers that add up exactly
export function allocate(total, weights) {
  const W = weights.reduce((a, b) => a + b, 0) || 1, raw = weights.map(w => total * w / W), out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
  return out;
}
const days7 = from => RC.dayList(from, RC.addDays(from, 6));

// ---------------------------------------------------------------- the per-day tables
// calls: day → { t, a, f, s: { gbp, ads, organic, direct, other } }
function callTable({ week, prevWeek, base }) {
  const out = {};
  for (const d of RC.dayList(RC.addDays(THROUGH, -419), THROUGH)) {
    const t = Math.round(base * (0.6 + rnd(`t${d}`) * 0.8) * ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay()) ? 0.45 : 1));
    const a = Math.round(t * 0.86), f = Math.round(t * 0.36), s = allocate(t, [62, 17, 8, 5, 0]);
    out[d] = { t, a, f, s: { gbp: s[0], ads: s[1], organic: s[2], direct: s[3], other: s[4] } };
  }
  for (const [from, w] of [[RC.addDays(THROUGH, -6), week], [RC.addDays(THROUGH, -13), prevWeek]]) {
    const ds = days7(from), a = allocate(w.a, w.day), f = allocate(w.f, w.day);
    // the week's calls by source, dealt out in order over the days (each day's split adds up to its total)
    const pool = ['gbp', 'ads', 'organic', 'direct', 'other'].flatMap(k => Array(w.src[k] || 0).fill(k));
    let at = 0;
    ds.forEach((d, i) => { const s = { gbp: 0, ads: 0, organic: 0, direct: 0, other: 0 }; for (let j = 0; j < w.day[i]; j++) s[pool[at + j]]++; at += w.day[i]; out[d] = { t: w.day[i], a: Math.min(a[i], w.day[i]), f: Math.min(f[i], w.day[i]), s }; });
  }
  return out;
}
const MAHDAVI_CALLS = callTable({ base: 12,
  week: { day: [24, 18, 19, 22, 13, 7, 4], a: 93, f: 40, src: { gbp: 69, ads: 18, organic: 8, direct: 5, other: 7 } },
  prevWeek: { day: [16, 14, 15, 13, 11, 8, 6], a: 75, f: 29, src: { gbp: 54, ads: 15, organic: 9, direct: 5, other: 0 } } });
const SAMPLE_CALLS = callTable({ base: 8,
  week: { day: [13, 11, 12, 10, 9, 5, 4], a: 57, f: 25, src: { gbp: 38, ads: 14, organic: 7, direct: 5 } },
  prevWeek: { day: [11, 10, 11, 9, 8, 5, 4], a: 49, f: 23, src: { gbp: 35, ads: 12, organic: 7, direct: 4 } } });
// forms: day → { n, f }
function formTable(week) { const out = {}; for (const d of RC.dayList(RC.addDays(THROUGH, -419), THROUGH)) out[d] = { n: rnd(`f${d}`) < 0.12 ? 1 : 0, f: 0 }; days7(RC.addDays(THROUGH, -6)).forEach((d, i) => { out[d] = { n: week.n[i], f: week.f[i] }; }); return out; }
const MAHDAVI_FORMS = formTable({ n: [0, 0, 1, 0, 0, 0, 0], f: [0, 0, 0, 0, 0, 0, 0] });
const SAMPLE_FORMS = formTable({ n: [1, 0, 1, 0, 1, 0, 0], f: [1, 0, 1, 0, 0, 0, 0] });

// Search Console: day → { c, i, pos }
function scTable(week, prev) {
  const out = {};
  for (const d of RC.dayList(RC.addDays(THROUGH, -419), THROUGH)) { const c = Math.round(35 + rnd(`c${d}`) * 20); out[d] = { c, i: c * 38, pos: 14.2 }; }
  const ds = days7(RC.addDays(THROUGH, -6)), im = allocate(week.i, week.c);
  ds.forEach((d, i) => { out[d] = { c: week.c[i], i: im[i], pos: week.pos }; });
  const pd = days7(RC.addDays(THROUGH, -13)), pc = allocate(prev.c, [1, 1, 1, 1, 1, 0.7, 0.7]);
  pd.forEach((d, i) => { out[d] = { c: pc[i], i: pc[i] * 38, pos: 14.5 }; });
  return out;
}
const SC = scTable({ c: [52, 49, 55, 50, 44, 32, 30], i: 11900, pos: 14.2 }, { c: 294 });
export const SC_TOP = [['mahdavi law firm', 103, 1.2], ['rideshare accident lawyer houston', 16, 8.4], ['uber accident attorney houston', 9, 9.1], ['18 wheeler accident lawyer', 6, 14.6], ['houston injury lawyer', 5, 17.9],
  ...Array.from({ length: 20 }, (_, i) => [`houston accident query ${i + 6}`, 4 - Math.floor(i / 6), 20 + i])];
// GA4: day → { s, u, avg, k } and channels for the week
function gaTable(week, prev) {
  const out = {};
  for (const d of RC.dayList(RC.addDays(THROUGH, -419), THROUGH)) { const s = Math.round(110 + rnd(`s${d}`) * 50); out[d] = { s, u: Math.round(s * 0.78), avg: 102, k: Math.round(s * 0.035) }; }
  const ds = days7(RC.addDays(THROUGH, -6)), u = allocate(week.u, week.s), k = allocate(week.k, week.s);
  ds.forEach((d, i) => { out[d] = { s: week.s[i], u: u[i], avg: 102, k: k[i] }; });
  const pd = days7(RC.addDays(THROUGH, -13)), ps = allocate(prev.s, [1, 1, 1, 1, 1, 0.7, 0.7]);
  pd.forEach((d, i) => { out[d] = { s: ps[i], u: Math.round(ps[i] * 0.78), avg: 100, k: Math.round(ps[i] * 0.03) }; });
  return out;
}
const GA = gaTable({ s: [158, 149, 162, 151, 133, 98, 97], u: 739, k: 33 }, { s: 977 });
export const GA_CHANNELS = [['Organic Search', 493], ['Organic Maps', 180], ['Direct', 152], ['Paid Search', 85], ['Referral', 38]];
// Business Profile: day → { calls, dir, web, ds, ms, dm, mm }
function gbpTable(week, prevActions) {
  const out = {};
  for (const d of RC.dayList(RC.addDays(THROUGH, -419), THROUGH)) { const c = Math.round(12 + rnd(`g${d}`) * 8); out[d] = { calls: c, dir: Math.round(c * 0.35), web: Math.round(c * 0.18), ds: 120, ms: 190, dm: 70, mm: 120 }; }
  const ds = days7(RC.addDays(THROUGH, -6)), w = [1.2, 1.1, 1.15, 1.1, 1, 0.75, 0.7];
  const calls = allocate(week.calls, w), dir = allocate(week.dir, w), web = allocate(week.web, w), sd = allocate(Math.round(week.search * 0.38), w), sm = allocate(week.search - Math.round(week.search * 0.38), w), md = allocate(Math.round(week.maps * 0.35), w), mm = allocate(week.maps - Math.round(week.maps * 0.35), w);
  ds.forEach((d, i) => { out[d] = { calls: calls[i], dir: dir[i], web: web[i], ds: sd[i], ms: sm[i], dm: md[i], mm: mm[i] }; });
  const pd = days7(RC.addDays(THROUGH, -13)), pa = allocate(prevActions, w);
  pd.forEach((d, i) => { const c = Math.round(pa[i] * 0.65); out[d] = { calls: c, dir: Math.round(pa[i] * 0.23), web: pa[i] - c - Math.round(pa[i] * 0.23), ds: 120, ms: 190, dm: 70, mm: 120 }; });
  return out;
}
const GBP = gbpTable({ calls: 121, dir: 43, web: 22, search: 2191, maps: 1343 }, 168);
// Google Ads (Sample Firm A): day → campaign → [cost, clicks, impr, conv]
const CAMPAIGNS = [['Personal injury · city', 849, 4, 115], ['Car accidents', 402, 3, 54], ['Truck accidents', 239, 1, 32]];
function adsTable({ zero = false } = {}) {
  const out = {};
  for (const d of RC.dayList(RC.addDays(THROUGH, -419), THROUGH)) out[d] = Object.fromEntries(CAMPAIGNS.map(([n, c], j) => [n, [Math.round(c / 7 * (0.8 + rnd(`a${d}${j}`) * 0.4) * 100) / 100, 4, 90, zero ? 0 : rnd(`v${d}${j}`) < 0.15 ? 1 : 0]]));
  const ds = days7(RC.addDays(THROUGH, -6)), w = [1, 1, 1, 1, 1, 1, 1];
  for (const [nme, cost, conv, clicks] of CAMPAIGNS) { const cc = allocate(cost * 100, w), cv = allocate(zero ? 0 : conv, [3, 1, 2, 1, 1, 0, 0]), ck = allocate(clicks, w); ds.forEach((d, i) => { out[d][nme] = [cc[i] / 100, ck[i], ck[i] * 22, cv[i]]; }); }
  const pd = days7(RC.addDays(THROUGH, -13)), pcost = allocate(145600, w), pconv = allocate(zero ? 0 : 7, [2, 1, 1, 1, 1, 1, 0]);
  pd.forEach((d, i) => { out[d] = { 'Personal injury · city': [pcost[i] / 100, 28, 600, pconv[i]] }; });
  return out;
}
const ADS = adsTable(), ADS_ZERO = adsTable({ zero: true });

// CallRail accounts: [id, name, numeric_id, companies]
export const ACCOUNTS = [
  [IDS.mahdavi.crAccount, 'The Mahdavi Law Firm PLLC', 600164333, [[IDS.mahdavi.crCompany, 'The Mahdavi Law Firm']]],
  [IDS.sample.crAccount, 'Sample Firm A', 711222333, [[IDS.sample.crCompany, 'Sample Firm A'], ['COM5a5a5a5b', 'Sample Firm A · Spanish line']]],
  ['ACC0b0b0b0b0b0b', 'Emery Law Office', 822333444, [['COM0b0b0b0b', 'Emery Law Office']]],
];

// ---------------------------------------------------------------- the fake fetch
const J = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const inRange = (d, from, to) => d >= from && d <= to;
const ymdObj = d => { const [year, month, day] = d.split('-').map(Number); return { year, month, day }; };
// opts: { calls: [], adsZero, gaNoKeyEvents, lost: { ga4, ads }, adsNotApproved, gbpNotApproved, callrailGone, perPage }
export function fakeApis(opts = {}) {
  const seen = [];
  const f = async (url, init = {}) => {
    const u = new URL(url), p = u.pathname, q = u.searchParams, body = init.body ? (typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : Object.fromEntries(new URLSearchParams(init.body))) : null;
    seen.push({ url: u, method: init.method || 'GET', headers: init.headers || {}, body });
    // BrightLocal (the Phase 1 fixtures)
    if (u.hostname === 'tools.brightlocal.com') { const file = p.endsWith('search') ? 'locations.json' : p.endsWith('get-all') ? (q.get('location-id') === '3839215' ? 'reports-3839215.json' : 'reports-empty.json') : p.includes('results') ? `results-${q.get('campaign-id')}.json` : `history-${q.get('campaign-id')}.json`; return new Response(await readFile(join(FX, file), 'utf8')); }
    // Google sign-in
    if (u.href === 'https://oauth2.googleapis.com/token') return J({ access_token: `ya29.test-${body.grant_type === 'refresh_token' ? 'user' : 'robot'}`, expires_in: 3600, token_type: 'Bearer' });
    // CallRail
    if (u.hostname === 'api.callrail.com') {
      if (!/^Token token="/.test(init.headers?.Authorization || '')) return J({ error: 'no key' }, 401);
      // NOTE 7.1: one account per law firm (3 here; Mahdavi = #600-164-333 with one company), /a.json paged 2 per page
      if (opts.rateLimitOnce && !f.limited) { f.limited = true; return new Response('{"error":"rate limit"}', { status: 429, headers: { 'Retry-After': '1' } }); }
      if (p === '/v3/a.json') { const all = ACCOUNTS.map(([id, name, num]) => ({ id, name, numeric_id: num })), page = Number(q.get('page') || 1); return J({ page, per_page: 2, total_pages: 2, accounts: all.slice((page - 1) * 2, page * 2) }); }
      const acc = /^\/v3\/a\/([^/]+)\//.exec(p)?.[1], A = ACCOUNTS.find(a => a[0] === acc);
      if (!A) return J({ error: 'Not found' }, 404);
      if (p.endsWith('/companies.json')) return J({ page: 1, total_pages: 1, companies: A[3].map(([id, name]) => ({ id, name, status: 'active' })) });
      const company = q.get('company_id');
      if (!A[3].some(c => c[0] === company)) return J({ error: 'Company not in this account' }, 404);
      if (opts.callrailGone && company === IDS.mahdavi.crCompany) return J({ error: 'Not found' }, 404);
      const T = company === IDS.mahdavi.crCompany ? [MAHDAVI_CALLS, MAHDAVI_FORMS] : company === IDS.sample.crCompany ? [SAMPLE_CALLS, SAMPLE_FORMS] : [{}, {}];
      const per = Number(opts.perPage || q.get('per_page') || 250), page = Number(q.get('page') || 1);
      if (p.endsWith('/calls.json')) {
        const rows = [];
        for (const [d, x] of Object.entries(T[0])) if (inRange(d, q.get('start_date'), q.get('end_date'))) {
          const src = Object.entries(x.s).flatMap(([k, v]) => Array(v).fill({ gbp: 'Google My Business', ads: 'Google Ads', organic: 'Google Organic', direct: 'Direct', other: 'Bing Organic' }[k]));
          for (let i = 0; i < x.t; i++) rows.push({ id: `CAL${d.replace(/-/g, '')}${i}`, start_time: `${d}T${String(8 + (i % 10)).padStart(2, '0')}:15:00.000-05:00`, answered: i < x.a, first_call: i < x.f, source: src[i] || 'Direct', customer_name: PII.name, customer_phone_number: PII.phone, recording: PII.recording, duration: 120 });
        }
        opts.calls?.push(...rows.slice((page - 1) * per, page * per));
        return J({ page, per_page: per, total_pages: Math.max(1, Math.ceil(rows.length / per)), total_records: rows.length, calls: rows.slice((page - 1) * per, page * per) });
      }
      if (p.endsWith('/form_submissions.json')) {
        const rows = [];
        for (const [d, x] of Object.entries(T[1])) if (inRange(d, q.get('start_date'), q.get('end_date'))) for (let i = 0; i < x.n; i++) rows.push({ id: `FRM${d}${i}`, submitted_at: `${d}T10:00:00.000-05:00`, first_form: i < x.f, form_data: { name: PII.name, phone: PII.phone, message: PII.form }, customer_name: PII.name });
        return J({ page, total_pages: Math.max(1, Math.ceil(rows.length / per)), form_submissions: rows.slice((page - 1) * per, page * per) });
      }
      return J({ error: 'not found' }, 404);
    }
    // GA4
    if (u.hostname === 'analyticsadmin.googleapis.com') return J({ accountSummaries: [{ displayName: 'Mahdavi Law', propertySummaries: [{ property: `properties/${IDS.mahdavi.ga4}`, displayName: 'mahdavilawfirm.com - GA4' }] }, { displayName: 'Sample Firm A', propertySummaries: [{ property: `properties/${IDS.sample.ga4}`, displayName: 'samplefirma.com' }] }] });
    if (u.hostname === 'analyticsdata.googleapis.com') {
      const prop = p.split('/')[3].split(':')[0];
      if (prop === IDS.lost.ga4 || opts.lost?.ga4 === prop) return J({ error: { code: 403, message: 'User does not have sufficient permissions for this property.', status: 'PERMISSION_DENIED' } }, 403);
      const [from, to] = [body.dateRanges[0].startDate, body.dateRanges[0].endDate];
      const ds = Object.entries(GA).filter(([d]) => inRange(d, from, to));
      if (body.dimensions.length === 1) return J({ rows: ds.map(([d, x]) => ({ dimensionValues: [{ value: d.replace(/-/g, '') }], metricValues: [x.s, x.u, x.avg, opts.gaNoKeyEvents ? 0 : x.k].map(v => ({ value: String(v) })) })) });
      const rows = [];
      for (const [d, x] of ds) { const split = d >= RC.addDays(THROUGH, -6) ? null : allocate(x.s, GA_CHANNELS.map(c => c[1])); const week = RC.dayList(RC.addDays(THROUGH, -6), THROUGH); const wi = week.indexOf(d);
        GA_CHANNELS.forEach(([ch, tot], j) => { const v = split ? split[j] : allocate(tot, GA[week[0]] ? week.map(w => GA[w].s) : [1])[wi]; rows.push({ dimensionValues: [{ value: d.replace(/-/g, '') }, { value: ch }], metricValues: [{ value: String(v) }] }); }); }
      return J({ rows });
    }
    // Search Console
    if (u.hostname === 'www.googleapis.com' && p === '/webmasters/v3/sites') return J({ siteEntry: [{ siteUrl: IDS.mahdavi.sc, permissionLevel: 'siteRestrictedUser' }, { siteUrl: IDS.sample.sc, permissionLevel: 'siteRestrictedUser' }, { siteUrl: 'https://nolonger.example/', permissionLevel: 'siteUnverifiedUser' }] });
    if (u.hostname === 'www.googleapis.com' && /searchAnalytics\/query$/.test(p)) {
      if (body.dimensions[0] === 'query') return J({ rows: SC_TOP.map(([k, c, pos]) => ({ keys: [k], clicks: c, impressions: c * 20, ctr: 0.05, position: pos })) });
      return J({ rows: Object.entries(SC).filter(([d]) => inRange(d, body.startDate, body.endDate)).map(([d, x]) => ({ keys: [d], clicks: x.c, impressions: x.i, ctr: x.c / x.i, position: x.pos })) });
    }
    // Business Profile
    const gbpNo = () => J({ error: { code: 429, message: "Quota exceeded for quota metric 'Requests' and limit 'Requests per minute' of service 'mybusinessbusinessinformation.googleapis.com'", status: 'RESOURCE_EXHAUSTED', details: [{ metadata: { quota_limit_value: '0' } }] } }, 429);
    if (u.hostname === 'mybusinessaccountmanagement.googleapis.com') return opts.gbpNotApproved ? gbpNo() : J({ accounts: [{ name: 'accounts/111', accountName: 'LFMP' }] });
    if (u.hostname === 'mybusinessbusinessinformation.googleapis.com') return opts.gbpNotApproved ? gbpNo() : J({ locations: [{ name: IDS.mahdavi.gbp, title: 'The Mahdavi Law Firm', websiteUri: 'https://mahdavilawfirm.com/' }, { name: IDS.sample.gbp, title: 'Sample Firm A', websiteUri: 'https://samplefirma.com/' }] });
    if (u.hostname === 'businessprofileperformance.googleapis.com') {
      if (opts.gbpNotApproved) return gbpNo();
      const from = `${q.get('dailyRange.start_date.year')}-${q.get('dailyRange.start_date.month').padStart(2, '0')}-${q.get('dailyRange.start_date.day').padStart(2, '0')}`, to = `${q.get('dailyRange.end_date.year')}-${q.get('dailyRange.end_date.month').padStart(2, '0')}-${q.get('dailyRange.end_date.day').padStart(2, '0')}`;
      const ds = Object.entries(GBP).filter(([d]) => inRange(d, from, to));
      const key = { CALL_CLICKS: 'calls', BUSINESS_DIRECTION_REQUESTS: 'dir', WEBSITE_CLICKS: 'web', BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: 'ds', BUSINESS_IMPRESSIONS_MOBILE_SEARCH: 'ms', BUSINESS_IMPRESSIONS_DESKTOP_MAPS: 'dm', BUSINESS_IMPRESSIONS_MOBILE_MAPS: 'mm' };
      return J({ multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: q.getAll('dailyMetrics').map(m => ({ dailyMetric: m, timeSeries: { datedValues: ds.map(([d, x]) => ({ date: ymdObj(d), ...(x[key[m]] ? { value: String(x[key[m]]) } : {}) })) } })) }] });
    }
    // Google Ads
    if (u.hostname === 'googleads.googleapis.com') {
      if (opts.adsNotApproved) return J([{ error: { code: 403, message: 'The caller does not have permission', status: 'PERMISSION_DENIED', details: [{ '@type': 'type.googleapis.com/google.ads.googleads.v26.errors.GoogleAdsFailure', errors: [{ errorCode: { authorizationError: 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION' }, message: 'The Google Cloud project is not approved for production access.' }] }] } }], 403);
      const cid = p.split('/')[3];
      if (cid === IDS.lost.ads || opts.lost?.ads === cid) return J([{ error: { code: 403, message: 'User doesn\'t have permission to access customer.', status: 'PERMISSION_DENIED', details: [{ errors: [{ errorCode: { authorizationError: 'USER_PERMISSION_DENIED' } }] }] } }], 403);
      if (cid === IDS.mcc) return J([{ results: [{ customerClient: { id: IDS.sample.ads, descriptiveName: 'Sample Firm A' } }, { customerClient: { id: '2223334444', descriptiveName: 'Emery Law Office' } }] }]);
      const m = /BETWEEN '([\d-]+)' AND '([\d-]+)'/.exec(body.query), T = opts.adsZero ? ADS_ZERO : ADS;
      const results = [];
      for (const [d, camps] of Object.entries(T)) if (inRange(d, m[1], m[2])) for (const [name, [cost, clicks, impr, conv]] of Object.entries(camps)) results.push({ segments: { date: d }, campaign: { name }, customer: { currencyCode: 'USD' }, metrics: { costMicros: String(Math.round(cost * 1e6)), clicks: String(clicks), impressions: String(impr), conversions: conv } });
      return J([{ results }]);
    }
    return J({ error: `no fixture for ${u.hostname}${p}` }, 404);
  };
  f.seen = seen;
  return f;
}

// A made-up service account key, generated for the test (never a real key).
export async function fakeServiceAccount() {
  const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
  let b = ''; for (const x of der) b += String.fromCharCode(x);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(b).match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  return { json: JSON.stringify({ type: 'service_account', project_id: 'lfmp-reporting-test', private_key_id: 'test-key-1', private_key: pem, client_email: 'leadpro-reports@lfmp-reporting-test.iam.gserviceaccount.com', token_uri: 'https://oauth2.googleapis.com/token' }), publicKey: kp.publicKey };
}

// The two test firms' configs.
export const configs = {
  mahdavi: (status = 'draft') => ({ ...RC.newConfig({ slug: 'mahdavi', at: '2026-08-01T10:00:00Z', by: 'Test', sources: {
    brightlocal: { locationId: '3839215', rankReportId: '1290417' }, callrail: { companyId: IDS.mahdavi.crCompany, companyName: 'The Mahdavi Law Firm', accountId: IDS.mahdavi.crAccount },
    ga4: { propertyId: IDS.mahdavi.ga4, name: 'mahdavilawfirm.com - GA4' }, searchConsole: { siteUrl: IDS.mahdavi.sc }, gbp: { locationName: IDS.mahdavi.gbp, title: 'The Mahdavi Law Firm' } } }), status }),
  sample: (status = 'draft') => ({ ...RC.newConfig({ slug: 'sample-firm-a', at: '2026-08-01T10:00:00Z', by: 'Test', sources: {
    callrail: { companyId: IDS.sample.crCompany, companyName: 'Sample Firm A', accountId: IDS.sample.crAccount }, ga4: { propertyId: IDS.sample.ga4, name: 'samplefirma.com' },
    searchConsole: { siteUrl: IDS.sample.sc }, gbp: { locationName: IDS.sample.gbp, title: 'Sample Firm A' }, googleAds: { customerId: IDS.sample.ads, name: 'Sample Firm A' } } }), status }),
};
export const allCreds = sa => ({ brightlocal: { key: 'k', secret: '' }, callrail: { key: 'cr-test-key' }, sa, oauth: { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'csecret', gbpRefresh: '1//gbp-refresh-test', adsRefresh: '1//ads-refresh-test', mccId: IDS.mcc } });
