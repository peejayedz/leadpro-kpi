// v1.37.0 LeadPro Reports, Phase 1: the nightly BrightLocal pull (.github/workflows/reports.yml), in three steps like sync.yml.
//
//   node scripts/reports-pull.mjs plan     which firms: every firms/<slug>/reports-config.json that is enabled and has a
//                                          BrightLocal location (nightly / manual), or only the ones with a new "Build now"
//                                          request (push of a reports-config.json). No BRIGHTLOCAL_API_KEY → nothing, one
//                                          clear log line, no alert. Writes GITHUB_OUTPUT matrix / count.
//   node scripts/reports-pull.mjs pull     one firm (SLUG): BrightLocal → numbers → firms/<slug>/reports.json encrypted with
//                                          the firm's KPI passphrase (PASSPHRASE, same scheme as details.enc.json) into
//                                          OUT_DIR/<slug>/, and a result file (RESULT_FILE). Logs peak memory.
//   node scripts/reports-pull.mjs finish   copies every firm's reports.json into firms/, updates status/reports-status.json
//                                          (public: time, ok, keyword count, error kind + short reason, request id, run link).
//
// READ ONLY toward BrightLocal (scripts/brightlocal.mjs). Nothing here touches GHL.
//
// v1.39.0 (queue items 7–9): six sources. Each linked source whose credentials are set is read (BrightLocal, CallRail =
// scripts/callrail.mjs, Search Console / GA4 / Business Profile / Google Ads = scripts/google.mjs), the new days are merged
// into the stored numbers (400 days by day; history stays) and written back encrypted. Sources without credentials are
// skipped with one log line. Numbers only. status/reports-status.json gets per-source health (firms[slug].sources).

import { readFile, writeFile, mkdir, appendFile, readdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client, BrightLocalError } from './brightlocal.mjs';
import { reportsOnlyValue, ownCallrail, ownCallrailName, pullable, wantsBuild, buildReport, configPath, dataPath, STATUS_PATH, SOURCE_KEYS, SOURCE_LABELS, linkedSources, REPORTS_V2, throughOf, pullWindow, mergeDays, dayList, addDays, asV2 } from './reports-core.mjs';
import { client as callrail, CallRailError } from './callrail.mjs';
import { saClient, oauthClient, hostOf } from './google.mjs';
export { reportsIssues } from './reports-core.mjs';
import { encryptJSON, decryptJSON } from './kpi-core.mjs';

export const STATUS_FILE = STATUS_PATH;
export const emptyReportsStatus = () => ({ version: 1, updatedAt: null, firms: {} });
const readJSON = async (p, fallback = null) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };
const secretKeyOf = slug => slug.toUpperCase().replace(/-/g, '_');

// ---------------------------------------------------------------- credentials (names only; values come from the env)
// v1.39.0: which sources can run tonight. A source without its credentials is skipped with one log line, never an alert.
export const CRED_NAMES = { brightlocal: ['BRIGHTLOCAL_API_KEY'], callrail: ['CALLRAIL_API_KEY'], ga4: ['GOOGLE_REPORTS_SA_JSON'], searchConsole: ['GOOGLE_REPORTS_SA_JSON'],
  gbp: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_GBP_REFRESH_TOKEN'], googleAds: ['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_MCC_ID'] };
export const credsFromEnv = env => ({
  brightlocal: env.BRIGHTLOCAL_API_KEY ? { key: env.BRIGHTLOCAL_API_KEY, secret: env.BRIGHTLOCAL_API_SECRET || '' } : null,
  callrail: env.CALLRAIL_API_KEY ? { key: env.CALLRAIL_API_KEY } : null,
  callrailOwn: env.CALLRAIL_OWN_KEY ? { key: env.CALLRAIL_OWN_KEY } : null,   // v1.40.0: this firm's own key (CALLRAIL_KEY_<SLUG>), if it has one
  sa: env.GOOGLE_REPORTS_SA_JSON || '',
  oauth: { clientId: env.GOOGLE_OAUTH_CLIENT_ID || '', clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET || '', gbpRefresh: env.GOOGLE_GBP_REFRESH_TOKEN || '', adsRefresh: env.GOOGLE_ADS_REFRESH_TOKEN || '', mccId: env.GOOGLE_ADS_MCC_ID || '' },
});
// The workflow passes HAS_<SOURCE>=true|false (it can't hand secrets to the plan job). HAS_KEY = BrightLocal (v1.37.0 name).
export const hasFromEnv = env => ({ brightlocal: env.HAS_KEY === 'true', callrail: env.HAS_CALLRAIL === 'true', ga4: env.HAS_GOOGLE_SA === 'true', searchConsole: env.HAS_GOOGLE_SA === 'true', gbp: env.HAS_GBP === 'true', googleAds: env.HAS_ADS === 'true' });
export const hasFromCreds = c => ({ brightlocal: !!c.brightlocal, callrail: !!c.callrail, ga4: !!c.sa, searchConsole: !!c.sa, gbp: !!(c.oauth?.clientId && c.oauth?.clientSecret && c.oauth?.gbpRefresh), googleAds: !!(c.oauth?.clientId && c.oauth?.clientSecret && c.oauth?.adsRefresh && c.oauth?.mccId) });

// ---------------------------------------------------------------- plan
// v1.42.0 (queue item 13): Reports-only clients (no KPI dashboard) aren't in firms/index.json; their reports-config.json says
// who they are (reportsOnly: name, locationId, secretKey). A slug that is also a KPI firm stays the KPI firm.
export async function reportsOnlyFirms(root = '.') {
  const kpi = new Set((await readJSON(join(root, 'firms/index.json'), [])).map(f => f.slug)), out = [];
  let names = []; try { names = await readdir(join(root, 'firms')); } catch {}
  for (const slug of names.sort()) {
    if (kpi.has(slug) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) continue;
    const cfg = await readJSON(join(root, configPath(slug)));
    const ro = reportsOnlyValue(cfg?.reportsOnly);
    if (ro) out.push({ slug, name: ro.name || slug, secretKey: ro.secretKey, locationId: ro.locationId, reportsOnly: true });
  }
  return out;
}
async function anyOwnCallrail(root) {
  for (const f of [...await readJSON(join(root, 'firms/index.json'), []), ...await reportsOnlyFirms(root)]) if (ownCallrail(await readJSON(join(root, configPath(f.slug))))) return true;
  return false;
}
export async function plan({ root = '.', event = 'schedule', slug = '', hasKey = false, has = null, changed = [], log = console.log }) {
  has ||= { brightlocal: !!hasKey };
  const ready = SOURCE_KEYS.filter(k => has[k]);
  for (const k of SOURCE_KEYS.filter(k => !has[k])) log(`${SOURCE_LABELS[k]} not set yet (${[...new Set(CRED_NAMES[k])].join(', ')}): skipped.`);
  if (!ready.length && !(await anyOwnCallrail(root))) { log('No report source is set up yet: nothing pulled. Add the secrets in Settings → Secrets and variables → Actions.'); return []; }
  const index = [...await readJSON(join(root, 'firms/index.json'), []), ...await reportsOnlyFirms(root)];
  const status = await readJSON(join(root, STATUS_FILE), emptyReportsStatus());
  const out = [];
  for (const f of index) {
    if (slug && f.slug !== slug) continue;
    if (event === 'push' && changed.length && !changed.includes(configPath(f.slug))) continue;
    const cfg = await readJSON(join(root, configPath(f.slug)));
    // v1.40.0: a firm with its own CallRail key runs even when the agency key isn't set (the pull job sees its own key)
    if (!pullable(cfg) || !linkedSources(cfg).some(k => has[k] || (k === 'callrail' && ownCallrail(cfg)))) continue;
    if (event === 'push' && !wantsBuild(cfg, status.firms?.[f.slug])) continue;   // a save without Build now waits for tonight
    out.push({ slug: f.slug, name: f.name || f.slug, secretKey: f.secretKey || secretKeyOf(f.slug), request: cfg.buildRequest?.id || '' });
  }
  log(out.length ? `Reports to build: ${out.map(x => x.slug).join(', ')}` : 'No reports to build.');
  return out;
}

// ---------------------------------------------------------------- pull (one firm)
// Reads every linked source whose credentials are set, merges the new days into the firm's stored reports.json (decrypted
// with its KPI passphrase; history stays), writes it encrypted again. One source failing keeps its stored numbers and
// shows as broken; the others still update.
export async function pull({ root = '.', slug, key, secret = '', creds = null, pass, fetch: f = globalThis.fetch, outDir, now = new Date(), log = console.log }) {
  creds ||= { brightlocal: key ? { key, secret } : null, callrail: null, sa: '', oauth: {} };
  const cfg = await readJSON(join(root, configPath(slug)));
  // v1.40.0: a firm marked "own CallRail key" uses only its own key (never the agency key) for CallRail
  if (ownCallrail(cfg)) creds = { ...creds, callrail: creds.callrailOwn || null };
  const has = hasFromCreds(creds);
  if (!pullable(cfg)) throw new BrightLocalError(`${slug}: Reports isn't set up (no linked source in ${configPath(slug)}).`, { kind: 'config' });
  if (!pass) throw new BrightLocalError(`${slug}: the firm's KPI passphrase (PASSPHRASE_${secretKeyOf(slug)}) isn't set, so the numbers can't be encrypted.`, { kind: 'config' });
  let old = null;
  const stored = await readJSON(join(root, dataPath(slug)));
  if (stored?.enc) { try { old = asV2(await decryptJSON(stored.enc, pass)); } catch { throw new BrightLocalError(`${slug}: the stored reports.json doesn't open with PASSPHRASE_${secretKeyOf(slug)} (was the passphrase changed?).`, { kind: 'config' }); } }
  const through = throughOf(now.toISOString());
  const rep = { v: REPORTS_V2, slug, generatedAt: now.toISOString(), through, site: old?.site || '', location: old?.location || null,
    rankings: old?.rankings || null, calls: old?.calls || null, search: old?.search || null, traffic: old?.traffic || null, gbp: old?.gbp || null, ads: old?.ads || null };
  const results = {};
  const linked = linkedSources(cfg);
  for (const k of linked) if (!has[k]) { results[k] = { ok: true, skipped: 'no_key' }; if (k === 'callrail' && ownCallrail(cfg)) log(`${slug}: the client's own CallRail key (${ownCallrailName(slug)}) isn't set: CallRail skipped.`); }
  // drop a source's numbers once it's unlinked or "Not used" (nothing stale stays readable)
  for (const [k, field] of [['brightlocal', 'rankings'], ['callrail', 'calls'], ['searchConsole', 'search'], ['ga4', 'traffic'], ['gbp', 'gbp'], ['googleAds', 'ads']]) if (!linked.includes(k)) rep[field] = null;
  const run = async (k, fn) => { if (!linked.includes(k) || !has[k]) return; try { await fn(); results[k] = { ok: true }; } catch (e) { results[k] = { ok: false, kind: e.kind || 'error', message: String(e.message || e).slice(0, 200) }; log(`::warning::${slug}: ${SOURCE_LABELS[k]}: ${results[k].message}`); } };

  let blRequests = 0;
  await run('brightlocal', async () => {
    const bl = client({ key: creds.brightlocal.key, secret: creds.brightlocal.secret || '', fetch: async (...a) => { blRequests++; return f(...a); } });
    const src = cfg.sources.brightlocal;
    const reports = await bl.reports(src.locationId);
    const report = (src.rankReportId && reports.find(r => r.id === String(src.rankReportId))) || reports[0];
    if (!report) throw new BrightLocalError(`BrightLocal has no Rank Tracker report for location ${src.locationId}.`, { kind: 'no_report' });
    const [res, history] = await Promise.all([bl.results(report.id), bl.history(report.id)]);
    // v1.41.0 (queue item 12): get-all + results + history only. The location's name / city come from the stored report or
    // the config (the Builder saves them); the whole-account location search runs only for a firm that has neither.
    let location = null;
    if (old?.location && String(old.location.id) === String(src.locationId)) location = old.location;
    else if (src.locationName) location = { id: String(src.locationId), name: src.locationName, city: src.city || '' };
    else { try { location = (await bl.locations('')).find(l => l.id === String(src.locationId)) || null; } catch {} }

    rep.rankings = buildReport({ slug, location, report, results: res, history, now });
    rep.location = rep.rankings.location || rep.location;
    log(`${slug}: ${rep.rankings.summary.tracked} keywords read from BrightLocal (report ${report.id}, run ${rep.rankings.report.runAt || 'unknown'}).`);
  });
  await run('callrail', async () => {
    const cr = callrail({ key: creds.callrail.key, fetch: f });
    const src = cfg.sources.callrail;
    let accountId = src.accountId;
    if (!accountId) { const c = (await cr.companies()).find(x => x.id === src.companyId); if (!c) throw new CallRailError(`CallRail company ${src.companyId} isn't there any more.`, { kind: 'gone' }); accountId = c.accountId; }
    const w = pullWindow(rep.calls?.days, through);
    const days = await cr.calls({ accountId, companyId: src.companyId, ...w }), forms = await cr.forms({ accountId, companyId: src.companyId, ...w });   // one after the other (rate limits)
    // days inside the window with no calls are real zeros: write them so a re-pulled day that lost its calls updates
    const zeroC = Object.fromEntries(dayList(w.from, w.to).map(d => [d, days[d] || { t: 0, a: 0, m: 0, f: 0, s: { gbp: 0, ads: 0, organic: 0, direct: 0, other: 0 } }]));
    const zeroF = Object.fromEntries(dayList(w.from, w.to).map(d => [d, forms[d] || { n: 0, f: 0 }]));
    rep.calls = { company: { id: src.companyId, name: src.companyName || '' }, days: mergeDays(rep.calls?.days, zeroC, through), forms: mergeDays(rep.calls?.forms, zeroF, through) };
    log(`${slug}: CallRail ${w.from} → ${w.to}: ${Object.values(days).reduce((a, x) => a + x.t, 0)} calls, ${Object.values(forms).reduce((a, x) => a + x.n, 0)} forms (counts only; ${cr.stats.requests} requests${cr.stats.retries ? `, ${cr.stats.retries} rate-limit waits` : ''}).`);
  });
  let sa = null;
  const robot = () => (sa ||= saClient({ saJson: creds.sa, fetch: f }));
  await run('searchConsole', async () => {
    const w = pullWindow(rep.search?.days, through);   // fresh data too (dataState all); the nightly re-read fills Google's 2–3 day lag
    const r = await robot().searchConsole({ siteUrl: cfg.sources.searchConsole.siteUrl, ...w, topFrom: addDays(w.to, -89) });
    rep.search = { days: mergeDays(rep.search?.days, r.days, through), top: r.top };
    rep.site ||= hostOf(cfg.sources.searchConsole.siteUrl);
    log(`${slug}: Search Console ${w.from} → ${w.to}: ${Object.keys(r.days).length} days, ${r.top.length} top searches.`);
  });
  await run('ga4', async () => {
    const w = pullWindow(rep.traffic?.days, through);
    const r = await robot().ga4({ propertyId: cfg.sources.ga4.propertyId, ...w });
    rep.traffic = { days: mergeDays(rep.traffic?.days, r.days, through), channels: mergeDays(rep.traffic?.channels, r.channels, through), hasKeyEvents: r.hasKeyEvents || !!rep.traffic?.hasKeyEvents };
    log(`${slug}: GA4 ${w.from} → ${w.to}: ${Object.keys(r.days).length} days.`);
  });
  let oa = null, ob = null;
  await run('gbp', async () => {
    oa ||= oauthClient({ clientId: creds.oauth.clientId, clientSecret: creds.oauth.clientSecret, refreshToken: creds.oauth.gbpRefresh, fetch: f });
    const w = pullWindow(rep.gbp?.days, through);
    const r = await oa.gbp({ locationName: cfg.sources.gbp.locationName, ...w });
    rep.gbp = { days: mergeDays(rep.gbp?.days, r, through) };
    log(`${slug}: Business Profile ${w.from} → ${w.to}: ${Object.keys(r).length} days.`);
  });
  await run('googleAds', async () => {
    ob ||= oauthClient({ clientId: creds.oauth.clientId, clientSecret: creds.oauth.clientSecret, refreshToken: creds.oauth.adsRefresh, fetch: f });
    const w = pullWindow(rep.ads?.days, through);
    const r = await ob.ads({ customerId: cfg.sources.googleAds.customerId, mccId: creds.oauth.mccId, ...w });
    rep.ads = { currency: r.currency, days: mergeDays(rep.ads?.days, r.days, through), campaigns: mergeDays(rep.ads?.campaigns, r.campaigns, through) };
    log(`${slug}: Google Ads ${w.from} → ${w.to}: ${Object.keys(r.days).length} days.`);
  });
  if (!rep.site && cfg.sources.callrail?.website) rep.site = hostOf(cfg.sources.callrail.website);
  const file = { v: REPORTS_V2, generatedAt: rep.generatedAt, enc: await encryptJSON(rep, pass) };
  await mkdir(join(outDir, slug), { recursive: true });
  await writeFile(join(outDir, slug, 'reports.json'), `${JSON.stringify(file)}\n`);
  const ok = Object.values(results).every(r => r.ok);
  return { slug, ok, sources: results, keywords: rep.rankings?.summary?.tracked ?? null, ...(blRequests ? { blRequests } : {}), ...(ok ? {} : { kind: 'source', message: Object.entries(results).filter(([, r]) => !r.ok).map(([k, r]) => `${SOURCE_LABELS[k]}: ${r.message}`).join(' · ').slice(0, 200) }) };
}

// ---------------------------------------------------------------- finish (one commit)
// A firm whose result exists keeps its new reports.json even when one source failed (the others updated; the failed one
// kept its stored numbers). Per-source health goes to status.firms[slug].sources[key].
export async function finish({ root = '.', matrix = [], resultsDir, dataDir, runUrl = '', now = new Date(), log = console.log }) {
  const prev = await readJSON(join(root, STATUS_FILE), emptyReportsStatus());
  const next = { ...emptyReportsStatus(), ...prev, firms: { ...(prev.firms || {}) } };
  const at = now.toISOString();
  for (const m of matrix) {
    const res = await readJSON(join(resultsDir, `${m.slug}.json`)) || { slug: m.slug, ok: false, kind: 'crashed', message: 'The job stopped before it wrote a result.' };
    const src = join(dataDir, m.slug, 'reports.json');
    let copied = false;
    if (res.sources) { try { await writeFile(join(root, dataPath(m.slug)), await readFile(src, 'utf8')); copied = true; } catch {} }
    const was = prev.firms?.[m.slug];
    const ok = !!(res.ok && copied);
    const sources = { ...(was?.sources || {}) };
    for (const [k, r] of Object.entries(res.sources || {})) {
      if (r.skipped) { sources[k] = { ok: true, skipped: r.skipped, at }; continue; }
      const w = was?.sources?.[k];
      sources[k] = r.ok ? { ok: true, at, lastOkAt: at } : { ok: false, at, kind: r.kind || 'error', message: String(r.message || '').slice(0, 200), firstFailedAt: w && w.ok === false ? w.firstFailedAt || w.at : at, ...(w?.lastOkAt ? { lastOkAt: w.lastOkAt } : {}) };
    }
    const failedWhole = !res.sources;   // config / passphrase / crash: nothing was written
    next.firms[m.slug] = { ok, at, ...(m.request ? { request: m.request } : was?.request ? { request: was.request } : {}),
      ...(ok ? { keywords: res.keywords ?? null, lastOkAt: at } : { kind: res.kind || 'error', message: String(res.message || 'Unknown error').slice(0, 200), firstFailedAt: was && !was.ok ? was.firstFailedAt || was.at : at, ...(was?.lastOkAt ? { lastOkAt: was.lastOkAt } : {}), ...(failedWhole ? { whole: true } : {}) }),
      ...(Object.keys(sources).length ? { sources } : {}), ...(runUrl ? { runUrl } : {}) };
    log(`${ok ? '✓' : '✗'} ${m.slug}${ok ? '' : ` (${next.firms[m.slug].kind}: ${next.firms[m.slug].message})`}`);
  }
  // v1.41.0 (queue item 12): every BrightLocal request the nightly sent, added up for good (numbers only). The team site
  // adds its own count (KV) to show "Trial key · N of 1,000 requests used" and pause its catalog reads at 800.
  let blAdd = 0;
  for (const m of matrix) { const res = await readJSON(join(resultsDir, `${m.slug}.json`)); blAdd += Number(res?.blRequests) || 0; }
  if (blAdd || prev.brightlocal) next.brightlocal = { requests: (Number(prev.brightlocal?.requests) || 0) + blAdd, at: blAdd ? at : prev.brightlocal?.at || at };
  next.updatedAt = at;
  await mkdir(join(root, 'status'), { recursive: true });
  await writeFile(join(root, STATUS_FILE), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

const peakMb = () => Math.round((process.resourceUsage().maxRSS || 0) / 1024);

async function main() {
  const cmd = process.argv[2], env = process.env;
  if (cmd === 'plan') {
    const changed = (env.CHANGED || '').split(/\s+/).filter(Boolean);
    const m = await plan({ event: env.EVENT || 'schedule', slug: env.SLUG || '', has: hasFromEnv(env), changed });
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `matrix=${JSON.stringify(m)}\ncount=${m.length}\n`);
    return;
  }
  if (cmd === 'pull') {
    const slug = env.SLUG, resultFile = env.RESULT_FILE;
    let res;
    try { res = await pull({ slug, creds: credsFromEnv(env), pass: env.PASSPHRASE, outDir: env.OUT_DIR || 'out' }); if (!res.ok) process.exitCode = 1; }
    catch (e) { res = { slug, ok: false, kind: e.kind || 'error', message: e.message }; console.error(`::error::${slug}: ${e.message}`); process.exitCode = 1; }
    console.log(`peak memory: ${peakMb()} MB`);
    if (resultFile) { await mkdir(join(resultFile, '..'), { recursive: true }); await writeFile(resultFile, JSON.stringify(res)); }
    return;
  }
  if (cmd === 'finish') {
    const matrix = JSON.parse(env.MATRIX || '[]');
    await finish({ matrix, resultsDir: env.RESULTS_DIR, dataDir: env.DATA_DIR, runUrl: env.RUN_URL || '' });
    console.log(`peak memory: ${peakMb()} MB`);
    return;
  }
  console.error('Use: node scripts/reports-pull.mjs plan | pull | finish'); process.exitCode = 2;
}
const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) await main();
