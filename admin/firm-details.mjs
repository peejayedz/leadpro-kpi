// Admin page v1.13: what the firm list and the Details panel show. Pure functions (no DOM, no fetch), tested by
// tests/admin-details/run.mjs. Reads only what the page already has: the bell's issues and the PUBLIC kpis.json.
import { sentBaseKey } from '../scripts/kpi-core.mjs';
import { isCare, wordsFor, practiceTypeOf, FUNNEL } from '../scripts/care-core.mjs';
import { byName } from './lfmp-session.js';

// ---------- needs attention ----------
// Order = how urgent. Short labels go on the firm row ("… →"); the Details panel shows the full text and the fix.
const ORDER = ['failed', 'app-missing', 'app-token', 'stale', 'needs-mapping', 'nodata', 'incomplete', 'held', 'unmapped', 'mapping-review', 'not-in-pipeline'];
const SHORT = {
  failed: 'Sync failed', 'app-missing': 'App not on the sub-account', 'app-token': 'Token problem', stale: 'No recent sync',
  nodata: 'No data yet', incomplete: 'Numbers may be incomplete', held: 'Holding previous numbers', 'mapping-review': 'Review mapping',
  'needs-mapping': 'Needs mapping', unmapped: 'Stages not mapped',   // v1.28.0
};
// Kinds that mean the numbers aren't syncing cleanly (the strip's "N sync problems").
export const SYNC_PROBLEMS = new Set(['failed', 'app-missing', 'app-token', 'stale', 'nodata']);

// ---------- one colour per meaning (v1.25.0, PJ 18 Nov) ----------
// red = ALERT: the numbers stopped updating or will, and someone has to act (sync failed, app missing, token problem, no
//   recent sync, no sync at all, SYNC_CHAIN off, chain stopped, token keeper failed / reconnect / not running).
// amber = NOTICE: the numbers still update, worth a look (holding previous numbers, may be incomplete, review mapping,
//   no data yet, leads not in a pipeline). Anything new or unknown is an alert (safer).
// The bell's items, the firm row's status dot and number, the details' boxes and the "Needs attention" filter all use this.
export const NOTICE_KINDS = new Set(['held', 'incomplete', 'mapping-review', 'nodata', 'not-in-pipeline', 'needs-mapping', 'unmapped']);
export const severity = kind => (NOTICE_KINDS.has(kind) ? 'notice' : 'alert');
export const isAlert = kind => severity(kind) === 'alert';

// ---------- leads trend on the firm row (v1.25.0; coverage rule v1.26.0) ----------
// Last 90 days vs the 90 days before (days 91–180), both already in the synced kpis.json (periods.last90.current /
// .previous.totalLeads). null = no trend: the row keeps "leads · 90 days".
// v1.26.0 (PJ, 19 Nov): a trend ONLY when the 90 days before are fully covered by this firm's synced data, i.e. the
// firm's scorecard started (firms/index.json `createdAt`, when the firm was added and first synced) at or before the
// start of days 91–180 (periods.last90.from − 90 days). Before that, the "previous" number is whatever happened to be in
// the firm's GHL pipeline before it was onboarded (Mahdavi: 11 leads, LFMP: 0), so a % from it means nothing (Mahdavi
// "▲ 809%"). No start date → not covered. A previous of 0 → no trend (never "▲ from 0").
// → { dir: 'up' | 'down' | 'same', text: '▲ 12%' | '▼ 8%' | '— same', label } (label = words for screen readers)
const DAY_MS = 864e5;
const msOf = v => (typeof v === 'number' ? v : Date.parse(v));
export function trendCovered(k, since) {
  const from = msOf(k?.periods?.last90?.from), start = msOf(since);
  return Number.isFinite(from) && Number.isFinite(start) && start <= from - 90 * DAY_MS;
}
export function leadTrend(k, { since } = {}) {
  const cur = k?.periods?.last90?.current?.totalLeads, prev = k?.periods?.last90?.previous?.totalLeads;
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || !trendCovered(k, since)) return null;
  if (prev === 0) return null;
  if (cur === prev) return { dir: 'same', text: '— same', label: 'the same as the 90 days before' };
  const pct = Math.round(Math.abs(cur - prev) / prev * 100);
  if (pct === 0) return { dir: 'same', text: '— same', label: 'about the same as the 90 days before' };
  return cur > prev ? { dir: 'up', text: `▲ ${pct}%`, label: `up ${pct}% on the 90 days before` } : { dir: 'down', text: `▼ ${pct}%`, label: `down ${pct}% on the 90 days before` };
}
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- firm list order (v1.26.0) ----------
// A–Z by the name shown (fname: Builder record name > index.json name, through displayName), case-insensitive, a leading
// "The " ignored (shared byName). Same in every filter and in search results, desktop and phone; the status dots and the
// filter counts still show what is urgent, only the order changed.
export const sortFirms = (list, nameOf) => [...list].sort(byName(nameOf));

// ---------- "No recent sync" line on the firm row (v1.26.0) ----------
// "No successful sync for 45 min" / "for 3 h" / "for 2 days" (was "No successful sync in 3 hours 2 h ago": the bell's
// title plus the time since the issue started). Units as the bell's fmtMinutes: minutes under 2 h, hours under 2 days.
export function forDuration(now, iso) {
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60e3));
  return m < 120 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} days`;
}
export const staleLine = (now, lastGood) => `No successful sync for ${forDuration(now, lastGood)}`;

// k: the firm's kpis.json (or null). issues: every open bell issue (any firm). Returns the firm's reasons, most urgent first.
// v1.28.0: status = the firm's firms/index.json status. "needsMapping" replaces "No data yet" (it isn't synced until mapped).
export function firmReasons(slug, k, issues = [], { status = null } = {}) {
  const out = [];
  for (const i of issues) if (i.slug === slug && SHORT[i.kind] && !out.some(r => r.kind === i.kind)) out.push({ kind: i.kind, short: SHORT[i.kind], issue: i });
  if (status === 'needsMapping') out.push({ kind: 'needs-mapping', short: SHORT['needs-mapping'] });
  else if (!k && !out.some(r => r.kind === 'nodata')) out.push({ kind: 'nodata', short: SHORT.nodata });
  const np = k?.periods?.last30?.current?.notInPipeline;
  if (Number.isFinite(np) && np > 0) out.push({ kind: 'not-in-pipeline', short: `${plural(np, 'lead')} not in a pipeline`, count: np });
  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

// Contacts from the ENCRYPTED details file (records.notInPipeline), limited to the last `days` days, newest first.
// Each: { contactId, name, email, phone, createdAt, via, source }. They live only in the page's memory (never stored).
// No name → the email, then the phone, stands in (never "Unknown"); `named` says whether a real name was there.
const NO_NAME = new Set(['', 'unnamed', 'unknown', 'unknown caller']);
// How it came in, as the sync recorded it (scripts/not-in-pipeline.mjs), in short words. Anything else shows as recorded.
export const SOURCE_LABEL = {
  Form: 'Form', 'Facebook form': 'Form (Facebook)', Survey: 'Survey', 'Chat widget': 'Chat', 'Calendar booking': 'Booking',
  'Called in': 'Call', 'Texted in': 'Text', 'Emailed in': 'Email', 'Messaged in': 'Message', 'Google message': 'Google message', WhatsApp: 'WhatsApp',
};
const str = v => (v === null || v === undefined ? '' : String(v).trim());
export function notInPipelineList(records, now = Date.now(), days = 30) {
  const since = now - days * 864e5;
  return (Array.isArray(records?.notInPipeline) ? records.notInPipeline : [])
    .filter(c => c && c.contactId && Date.parse(c.createdAt) >= since)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map(c => {
      const email = str(c.email) || null, phone = str(c.phone) || null, raw = str(c.name);
      const named = !NO_NAME.has(raw.toLowerCase()) && raw !== email && raw !== phone;
      const via = str(c.via);
      return { contactId: String(c.contactId), name: named ? raw : email || phone || 'No name, email or phone', named, email, phone, createdAt: c.createdAt, via, source: SOURCE_LABEL[via] || via };
    });
}
export const ghlContactUrl = (base, loc, id) => `${base || 'https://app.lawfirmmarketingpros.com'}/v2/location/${encodeURIComponent(loc)}/contacts/detail/${encodeURIComponent(id)}`;

// ---------- performance ----------
// The goals the client dashboard scores in "Going well / Needs attention" (app/dashboard.html, GOALS). Keep the two
// identical; tests/admin-details/run.mjs compares them. [value key, label, goal key, lower is better, unit, sample key]
export const GOALS = [
  ['leadToSignedPct', 'Lead → signed', 'leadToSignedPct', false, '%', 'totalLeads'],
  ['speedToLeadAvgMin', 'Average wait for a first call', 'speedToLeadMin', true, ' min', 'speedMeasured'],
  ['within5Pct', 'Contacted within 5 minutes', 'within5Pct', false, '%', 'totalLeads'],
  ['contactRatePct', 'Contact rate', 'contactRatePct', false, '%', 'totalLeads'],
  ['bookRatePct', 'Qualified → consult booked', 'bookRatePct', false, '%', 'qualified'],
  ['showRatePct', 'Consult show rate', 'showRatePct', false, '%', 'bookedPast'],
  ['noShowPct', 'Consult no-show rate', 'noShowPct', true, '%', 'bookedPast'],
  ['sentRatePct', 'Agreements sent after consults', 'sentRatePct', false, '%', 'consultHeld'],
  ['signRatePct', 'Agreement → signed', 'signRatePct', false, '%', 'agreementSent'],
];
export const PERF_PERIODS = [['last7', '7 days', 7], ['last30', '30 days', 30], ['last90', '90 days', 90]];
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const fmtPct = v => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);

// kpis: the firm's public kpis.json. cfg: the firm's effective config (defaults + practice area + firm), for
// sentRateBase and minSample. Returns everything the Performance tab draws, or null when there's no data for the period.
// v1.28.0: Medical & dental / Other firms (their kpis.json periods hold the care summary from scripts/care-core.mjs).
function carePerfView(kpis, cfg, key) {
  const per = kpis?.periods?.[key], c = per?.current;
  if (!c) return null;
  const p = per.previous || null, t = kpis.targets || cfg.targets || {}, days = (PERF_PERIODS.find(x => x[0] === key) || [])[2] || 30;
  const MIN = cfg.minSample ?? 5, n = c.enquiries ?? c.totalLeads ?? 0, w = wordsFor(cfg), type = practiceTypeOf(cfg);
  const diff = p ? n - (p.enquiries ?? p.totalLeads ?? 0) : null;
  const usd = v => `$${Math.round(v || 0).toLocaleString('en-US')}`;
  const tiles = [
    { label: w.enquiries, value: String(n), sub: diff === null ? '' : `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff)} vs prior ${days} days` },
    { label: w.booked, value: String(c.booked ?? 0), sub: n ? `${fmtPct(pct(c.booked || 0, n))} of ${w.enquiries.toLowerCase()}` : '' },
    type === 'medical'
      ? { label: w.showRate, value: fmtPct(c.showRatePct), sub: t.showRatePct !== undefined ? `goal ${t.showRatePct}%` : '' }
      : { label: w.value, value: usd(c.value), sub: '' },
    { label: w.yes, value: String(c.yes ?? 0), sub: `${c.yesPct === null || c.yesPct === undefined ? '—' : `${Math.round(c.yesPct * 10) / 10}%`} of ${w.enquiries.toLowerCase()}` },
  ];
  const rows = FUNNEL[type].map(([wk, k]) => ({ label: w[wk], value: c[k] || 0 }));
  const top = Math.max(1, ...rows.map(r => r.value));
  const funnel = rows.map(r => ({ ...r, width: Math.round((r.value / top) * 1000) / 10 }));
  const good = [], bad = [];
  if (p && c.yes > (p.yes ?? 0)) good.push(`${c.yes} ${w.yes.toLowerCase()}, up from ${p.yes ?? 0} the prior ${days} days.`);
  const scored = type === 'medical' && c.showRatePct !== null && c.showRatePct !== undefined && t.showRatePct !== undefined && (c.booked ?? 0) >= MIN;
  if (scored) (c.showRatePct >= t.showRatePct ? good : bad).push(`${w.showRate} is ${Math.round(c.showRatePct)}%${c.showRatePct >= t.showRatePct ? `, above the ${t.showRatePct}% goal` : ` (goal ${t.showRatePct}%)`}.`);
  const pn = p?.enquiries ?? p?.totalLeads ?? 0;
  if (p && pn >= MIN && n < pn * 0.8) bad.push(`${w.enquiries} are down ${Math.round((1 - n / pn) * 100)}% vs the prior ${days} days (${n} vs ${pn}).`);
  const none = n === 0 ? `No new ${w.enquiries.toLowerCase()} in these dates.` : !scored ? 'Not enough data yet to judge any metric against its goal.' : null;
  return { tiles, funnel, good, bad, goodEmpty: none || 'No metric is above goal.', badEmpty: none || 'Nothing below goal.', asOf: kpis.generatedAt || null, care: true };
}

export function perfView(kpis, cfg = {}, key = 'last30') {
  if (isCare(cfg) || isCare(kpis)) return carePerfView(kpis, { ...cfg, practiceType: cfg.practiceType || kpis?.practiceType }, key);
  const per = kpis?.periods?.[key], c = per?.current;
  if (!c) return null;
  const p = per.previous || null, t = kpis.targets || cfg.targets || {}, days = (PERF_PERIODS.find(x => x[0] === key) || [])[2] || 30;
  const MIN = cfg.minSample ?? 5, n = c.totalLeads || 0;
  const steps = new Set((c.funnel || []).map(r => r[2]));
  const diff = p ? n - (p.totalLeads || 0) : null;
  const tiles = [
    { label: 'New leads', value: String(n), sub: diff === null ? '' : `${diff > 0 ? '+' : diff < 0 ? '−' : '±'}${Math.abs(diff)} vs prior ${days} days` },
    { label: 'Contacted in 5 min', value: fmtPct(c.within5Pct), sub: t.within5Pct !== undefined ? `goal ${t.within5Pct}%` : '' },
    steps.has('consultBooked')
      ? { label: 'Consults booked', value: String(c.consultBooked ?? 0), sub: n ? `${fmtPct(pct(c.consultBooked || 0, n))} of leads` : '' }
      : { label: 'Qualified', value: String(c.qualified ?? 0), sub: n ? `${fmtPct(pct(c.qualified || 0, n))} of leads` : '' },
    { label: 'Signed', value: String(c.signed ?? 0), sub: `${c.leadToSignedPct === null || c.leadToSignedPct === undefined ? '—' : `${Math.round(c.leadToSignedPct * 10) / 10}%`}${t.leadToSignedPct !== undefined ? ` · goal ${t.leadToSignedPct}%` : ''}` },
  ];
  const top = Math.max(1, ...(c.funnel || []).map(r => r[1] || 0));
  const funnel = (c.funnel || []).map(([label, value]) => ({ label, value: value || 0, width: Math.round(((value || 0) / top) * 1000) / 10 }));
  // Going well / Needs attention: the dashboard's rules (execSummary), on the same numbers.
  const goals = sentBaseKey(cfg) === 'qualified' ? GOALS.map(g => (g[0] === 'sentRatePct' ? ['sentRatePct', 'Agreements sent to qualified leads', 'sentRatePct', false, '%', 'qualified'] : g)) : GOALS;
  const val = (k, u) => (k === 'speedToLeadAvgMin' ? `${c[k]} min` : `${Math.round(c[k])}${u}`);
  const scored = goals.filter(([k, , gk, , , dk]) => c[k] !== null && c[k] !== undefined && t[gk] !== undefined && (c[dk] ?? 0) >= MIN)
    .map(([k, name, gk, low, u]) => ({ k, name, low, u, goal: t[gk], gap: low ? (t[gk] - c[k]) / Math.max(t[gk], 1) : (c[k] - t[gk]) / Math.max(t[gk], 1) }));
  const good = [], bad = [];
  if (p && c.signed > (p.signed ?? 0)) good.push(`${c.signed} new signed client${c.signed === 1 ? '' : 's'}, up from ${p.signed ?? 0} the prior ${days} days.`);
  for (const m of scored.filter(m => m.gap >= 0).sort((a, b) => b.gap - a.gap).slice(0, 3 - good.length)) good.push(`${m.name} is ${val(m.k, m.u)}, ${m.low ? 'within' : 'above'} the ${m.goal}${m.u} goal.`);
  for (const m of scored.filter(m => m.gap < 0).sort((a, b) => a.gap - b.gap).slice(0, 2)) bad.push(`${m.name} is ${val(m.k, m.u)} (goal ${m.goal}${m.u}).`);
  if (bad.length < 3 && p && p.totalLeads >= MIN && n < p.totalLeads * 0.8) bad.push(`Lead flow is down ${Math.round((1 - n / p.totalLeads) * 100)}% vs the prior ${days} days (${n} vs ${p.totalLeads}).`);
  const none = n === 0 ? 'No new leads in these dates.' : scored.length === 0 ? 'Not enough data yet to judge any metric against its goal.' : null;
  return { tiles, funnel, good, bad, goodEmpty: none || 'No metric is above goal.', badEmpty: none || 'Nothing below goal.', asOf: kpis.generatedAt || null };
}
