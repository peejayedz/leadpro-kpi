// v1.37.0 LeadPro Reports, Phase 1.   Run: node tests/reports/run.mjs   (no dependencies, no network)
// BrightLocal adapter (fixtures in its v2 shape, built from the 31 Oct Mahdavi report), the numbers, the encryption,
// the nightly plan / pull / finish with and without the key, the bell issue, the location suggestion, the config files.
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as BL from '../../scripts/brightlocal.mjs';
import * as RC from '../../scripts/reports-core.mjs';
import * as RP from '../../scripts/reports-pull.mjs';
import { decryptJSON } from '../../scripts/kpi-core.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FX = join(ROOT, 'tests/reports/fixtures');
let pass = 0, fail = 0;
const check = (ok, what, extra = '') => { if (ok) { pass++; console.log(`✓ ${what}`); } else { fail++; console.log(`✗ ${what}${extra ? `\n    ${extra}` : ''}`); } };
const throwsKind = async (fn, kind) => { try { await fn(); return false; } catch (e) { return e.kind === kind; } };

// fixture "BrightLocal": answers the four GET endpoints from tests/reports/fixtures, records every call
function fakeBL({ status = 200, calls = [] } = {}) {
  const f = async url => {
    const u = new URL(url); calls.push(u);
    if (status !== 200) return new Response('{"success":false,"errors":{"api-key":"invalid"}}', { status });
    const p = u.pathname, q = u.searchParams;
    const file = p.endsWith('/locations/search') ? 'locations.json' : p.endsWith('/lsrc/get-all') ? (q.get('location-id') === '3839215' ? 'reports-3839215.json' : 'reports-empty.json')
      : p.endsWith('/lsrc/results/get') ? `results-${q.get('campaign-id')}.json` : p.endsWith('/lsrc/history/get') ? `history-${q.get('campaign-id')}.json` : null;
    if (!file) return new Response('not found', { status: 404 });
    return new Response(await readFile(join(FX, file), 'utf8'), { status: 200 });
  };
  f.calls = calls; return f;
}

// ---------------------------------------------------------------- adapter
check(await throwsKind(() => BL.client({ key: '' }), 'no_key'), 'no key → "BrightLocal key not set yet" (kind no_key), nothing is called');
{
  const f = fakeBL(); const c = BL.client({ key: 'test-key', fetch: f });
  const locs = await c.locations();
  check(locs.length === 4 && locs[0].id === '3839215' && locs[0].name === 'The Mahdavi Law Firm' && locs[0].city === 'Houston', 'locations: 4 (Mahdavi 3839215 first, made-up ids for the rest)');
  const reps = await c.reports('3839215');
  check(reps.length === 1 && reps[0].id === '1290417' && reps[0].keywords === 88, 'Mahdavi\'s Rank Tracker report (made-up campaign id), 88 keywords');
  check(f.calls.every(u => u.origin + u.pathname.replace(/\/v2\/.*/, '') === BL.BL_BASE && u.searchParams.get('api-key') === 'test-key' && !u.searchParams.has('sig')), 'every call: the official API base, api-key, GET only; no secret → no sig');
  check(f.calls.every(u => /\/v2\/(clients-and-locations\/locations\/search|lsrc\/(get-all|results\/get|history\/get))$/.test(u.pathname)), 'read-only endpoints only (no add / update / run / delete)');
}
{
  const f = fakeBL(); const c = BL.client({ key: 'k', secret: 's', fetch: f, now: () => 1_700_000_000_000 });
  await c.locations();
  const u = f.calls[0], exp = String(1_700_000_000 + 1800);
  check(u.searchParams.get('expires') === exp && u.searchParams.get('sig') === await BL.signature('k', 's', exp), 'with a secret: expires (+30 min) and sig = base64 HMAC-SHA1(key + expires)');
  check(await BL.signature('k', 's', exp) === 'AcTvjnPSLFjzpJDq7BybUIxLH7M=', 'signature: the value openssl gives (HMAC-SHA1 of "k1700001800" with "s", base64)');
}
// v1.41.0 (queue item 12): the request counter (a trial key = 1,000 requests in total) + every page of the location search
{
  const f = fakeBL(); const c = BL.client({ key: 'k', fetch: f });
  await c.locations(); await c.reports('3839215');
  check(c.stats.requests === 2 && f.calls.length === 2, 'stats.requests counts every request the client sent (2)');
  const pages = []; const pf = async url => { const u = new URL(url); pages.push(u.searchParams.get('page') || '1'); const n = Number(u.searchParams.get('page') || 1);
    return new Response(JSON.stringify({ success: true, response: { total_pages: 3, results: [{ 'location-id': 1000 + n, 'location-name': `Firm ${n}` }] } })); };
  const pc = BL.client({ key: 'k', fetch: pf }), all = await pc.locations('');
  check(all.length === 3 && pages.join(',') === '1,2,3' && pc.stats.requests === 3, 'locations: every page when the answer says total_pages (3 pages → 3 requests, no cap)');
  const one = BL.client({ key: 'k', fetch: async () => new Response(JSON.stringify({ success: true, response: { results: Array.from({ length: 1365 }, (_, i) => ({ 'location-id': 5000 + i, 'location-name': `Loc ${i}` })) } })) });
  check((await one.locations('')).length === 1365 && one.stats.requests === 1, 'locations: 1,365 in one answer = 1 request, all kept');
}
check(await throwsKind(() => BL.client({ key: 'bad', fetch: fakeBL({ status: 401 }) }).locations(), 'auth'), 'a refused key → kind auth');
check(await throwsKind(() => BL.client({ key: 'k', fetch: fakeBL({ status: 503 }) }).locations(), 'server'), 'BrightLocal 5xx → kind server');
check(await throwsKind(() => BL.client({ key: 'k', fetch: async () => { throw new Error('down'); } }).locations(), 'network'), 'no answer → kind network');

// ---------------------------------------------------------------- numbers (the 31 Oct report)
const c = BL.client({ key: 'k', fetch: fakeBL() });
const [locs, reps] = [await c.locations(), await c.reports('3839215')];
const results = await c.results(reps[0].id), history = await c.history(reps[0].id);
const R = RC.buildReport({ slug: 'mahdavi', location: locs[0], report: reps[0], results, history, now: new Date('2026-11-21T07:00:00Z') });
check(R.summary.avg === 20.7 && R.summary.avgPrev === 20.5 && R.summary.avgChange === 0.2, 'average position 20.7 (was 20.5: ▼ 0.2, worse)', JSON.stringify(R.summary));
check(R.summary.tracked === 88 && R.keywords.length === 88, '88 keywords tracked');
check(R.summary.top20 === 6, '6 keywords in the top 20 (any search)', String(R.summary.top20));
check(R.summary.movement.keyword === 1 && R.summary.movement.positional === 3 && R.summary.mapPack === 0, 'movement +1 / +3, map 3-pack 0%');
check(JSON.stringify(R.mix.bands) === JSON.stringify([['#1', 0], ['#2–5', 3], ['#6–10', 1], ['#11–20', 4], ['#21+ / not found', 80]]) && R.mix.from === 'brightlocal', 'positions mix = BrightLocal\'s distribution (0 · 3 · 1 · 4 · 80)');
check(JSON.stringify(RC.positionsMix(R.keywords, null).bands.map(b => b[1])) === JSON.stringify([0, 1, 0, 3, 84]), 'no distribution from the API → counted from desktop ranks (0 · 1 · 0 · 3 · 84)');
check(R.history.months.join(',') === 'May,Jun,Jul,Aug,Sep,Oct' && R.history.desktop.join(',') === '19.8,21.6,21.6,19.8,19.3,19.6' && R.history.localFinder.at(-1) === 19.8, '6-month history: May–Oct, desktop 19.8 … 19.6, Local Finder ends 19.8');
check(R.report.runAt === '2026-10-31' && R.report.prevRunAt === '2026-10-09' && R.report.checkedFrom === 'Houston, TX' && R.location.city === 'Houston, TX', 'run Oct 31 vs Oct 9, checked from Houston, TX');
check(R.competitors?.names.length === 3 && R.competitors.rows.length === 14 && JSON.stringify(R.competitors.rows[0]) === JSON.stringify(['rideshare accident attorney 77027', 4, null, null, 1]), 'competitors: 3 names, 14 rows ("You" = desktop rank)');
check(RC.buildReport({ slug: 'x', results: { ...results, competitors: null }, history }).competitors === null, 'no competitors from the API → null (the page hides the card)');
const prem = R.keywords.find(k => k.k === 'premises liability attorney 77027');
check(prem.l === 11 && prem.change === 3 && R.keywords.find(k => k.k === 'rideshare accident attorney 77027').d === 4, 'per keyword: ranks per search + change (premises liability 77027: Maps 11, ▲ 3)');
const flat = JSON.stringify(R);
check(!/@|\bphone\b|email/i.test(flat), 'numbers only: no contact data in the report');

// ---------------------------------------------------------------- config + stub + suggestion
let bad = false; try { RC.newConfig({ slug: 'mahdavi', locationId: 'abc' }); } catch { bad = true; }
check(bad, 'a location id must be digits');
const cfg = RC.newConfig({ slug: 'mahdavi', locationId: '3839215', rankReportId: '1290417', by: 'PJ', at: '2026-11-21T10:00:00Z' });
check(cfg.status === 'draft' && cfg.enabled && RC.pullable(cfg) && cfg.sources.brightlocal.locationId === '3839215' && !('menuLink' in cfg), 'new config: Draft, enabled, pullable, no menu link');
check(!RC.wantsBuild(cfg, null) && RC.wantsBuild(RC.withBuildRequest(cfg, { id: 'r1', by: 'PJ' }), { request: 'r0' }) && !RC.wantsBuild(RC.withBuildRequest(cfg, { id: 'r1', by: 'PJ' }), { request: 'r1' }), 'Build now: wanted only when its request is newer than the last run');
check(RC.withLive(cfg, { by: 'PJ' }).status === 'live', 'Live after Add to GHL menu');
check(/var page = '\.\.\/\.\.\/app\/reports\.html';[^\n]*\nfetch\(page, /.test(RC.STUB_HTML) && /noindex/.test(RC.STUB_HTML), 'stub loads app/reports.html (noindex), like the dashboard stub');
check(RC.suggestLocation(locs, { name: 'The Mahdavi Law Firm', website: 'https://mahdavilawfirm.com' })?.why === 'matched by name and website (mahdavilawfirm.com)', 'suggested: matched by name and website');
check(RC.suggestLocation(locs, { name: 'Dumas & Sanclemente', website: 'https://www.dsinjury.com' })?.id === '4100231' && RC.suggestLocation(locs, { name: 'Nobody', website: 'x.com' }) === null, 'by name only; no match → nothing suggested');

// ---------------------------------------------------------------- plan / pull / finish (temp copy of a repo)
const tmp = await mkdtemp(join(tmpdir(), 'reports-'));
try {
  await mkdir(join(tmp, 'firms/mahdavi'), { recursive: true }); await mkdir(join(tmp, 'firms/lfmp'), { recursive: true }); await mkdir(join(tmp, 'firms/emery'), { recursive: true });
  await writeFile(join(tmp, 'firms/index.json'), JSON.stringify([{ slug: 'mahdavi', name: 'The Mahdavi Law Firm', secretKey: 'MAHDAVI' }, { slug: 'lfmp', name: 'LFMP', secretKey: 'LFMP' }, { slug: 'emery', name: 'Emery', secretKey: 'EMERY' }]));
  await writeFile(join(tmp, RC.configPath('mahdavi')), JSON.stringify(cfg));
  await writeFile(join(tmp, RC.configPath('emery')), JSON.stringify({ ...RC.newConfig({ slug: 'emery', locationId: '4100999' }), enabled: false }));
  const logs = []; const log = m => logs.push(m);
  check((await RP.plan({ root: tmp, hasKey: false, log })).length === 0 && /BrightLocal not set yet \(BRIGHTLOCAL_API_KEY\): skipped/.test(logs[0]) && /No report source is set up yet: nothing pulled/.test(logs.at(-1)), 'no key: plan is empty, one clear log line per source + one summary (no alert)', logs.join(' | '));
  const all = await RP.plan({ root: tmp, hasKey: true, log });
  check(JSON.stringify(all) === JSON.stringify([{ slug: 'mahdavi', name: 'The Mahdavi Law Firm', secretKey: 'MAHDAVI', request: '' }]), 'nightly: only firms with Reports enabled and a location (lfmp has none, emery is off)');
  check((await RP.plan({ root: tmp, hasKey: true, event: 'push', changed: [RC.configPath('mahdavi')], log })).length === 0, 'push without a Build now request (Save & build tonight) → waits for tonight');
  await writeFile(join(tmp, RC.configPath('mahdavi')), JSON.stringify(RC.withBuildRequest(cfg, { id: 'req-1', by: 'PJ' })));
  const push = await RP.plan({ root: tmp, hasKey: true, event: 'push', changed: [RC.configPath('mahdavi')], log });
  check(push.length === 1 && push[0].request === 'req-1', 'push with a new Build now request → builds that firm');
  check((await RP.plan({ root: tmp, hasKey: true, slug: 'lfmp', log })).length === 0, 'Run workflow with one slug → only that firm');

  const out = join(tmp, 'out');
  const ok = await RP.pull({ root: tmp, slug: 'mahdavi', key: 'k', pass: 'right horse battery', fetch: fakeBL(), outDir: out, log, now: new Date('2026-11-21T07:00:00Z') });
  check(ok.ok && ok.keywords === 88, 'pull: 88 keywords read');
  const file = JSON.parse(await readFile(join(out, 'mahdavi/reports.json'), 'utf8'));
  check(Object.keys(file).join(',') === 'v,generatedAt,enc' && file.enc.alg === 'AES-GCM-256/PBKDF2-SHA256' && !JSON.stringify(file).includes('rideshare'), 'reports.json: only { v, generatedAt, enc } in the clear (same scheme as details.enc.json)');
  const back = await decryptJSON(file.enc, 'right horse battery');
  check(back.v === 2 && back.rankings.summary.avg === 20.7 && back.rankings.summary.top20 === 6 && back.rankings.keywords.length === 88 && back.calls === null, 'encryption round trip with the firm\'s passphrase (v2: rankings + one slot per source)');
  let wrong = false; try { await decryptJSON(file.enc, 'another firms passphrase'); } catch { wrong = true; }
  check(wrong, 'another firm\'s passphrase can\'t read it');
  check(await throwsKind(() => RP.pull({ root: tmp, slug: 'mahdavi', key: 'k', pass: '', fetch: fakeBL(), outDir: out, log }), 'config'), 'no passphrase secret → config error (nothing written in the clear)');
  check(await throwsKind(() => RP.pull({ root: tmp, slug: 'emery', key: 'k', pass: 'x', fetch: fakeBL(), outDir: out, log }), 'config'), 'Reports off → config error');
  await writeFile(join(tmp, RC.configPath('lfmp')), JSON.stringify(RC.newConfig({ slug: 'lfmp', locationId: '4100502' })));
  const nr = await RP.pull({ root: tmp, slug: 'lfmp', key: 'k', pass: 'x', fetch: fakeBL(), outDir: out, log });
  check(!nr.ok && nr.sources.brightlocal.kind === 'no_report', 'a location without a Rank Tracker report → BrightLocal no_report (that source shows broken)');

  // v1.41.0 (queue item 12): per firm only get-all + results + history; the account-wide location search only for a firm with
  // no stored location and no name in its config
  check(ok.blRequests === 4, 'first pull with no stored location and no name in the config: get-all + results + history + 1 location search = 4 requests', String(ok.blRequests));
  const named = RC.withSource(cfg, 'brightlocal', { locationId: '3839215', rankReportId: '', locationName: 'The Mahdavi Law Firm', city: 'Houston, TX' });
  check(named.sources.brightlocal.locationName === 'The Mahdavi Law Firm' && named.sources.brightlocal.city === 'Houston, TX', 'config: the BrightLocal pick keeps the location name and city (public)');
  await writeFile(join(tmp, RC.configPath('mahdavi')), JSON.stringify(named));
  const f3 = fakeBL(); const ok3 = await RP.pull({ root: tmp, slug: 'mahdavi', key: 'k', pass: 'right horse battery', fetch: f3, outDir: join(tmp, 'out3'), log, now: new Date('2026-11-21T07:00:00Z') });
  check(ok3.ok && ok3.blRequests === 3 && !f3.calls.some(u => u.pathname.endsWith('/locations/search')), 'pull with the name in the config: exactly 3 requests (get-all, results, history), no location search', `${ok3.blRequests}`);
  const back3 = await decryptJSON(JSON.parse(await readFile(join(tmp, 'out3/mahdavi/reports.json'), 'utf8')).enc, 'right horse battery');
  check(back3.rankings.location?.name === 'The Mahdavi Law Firm', 'the report still names the location');
  await writeFile(join(tmp, RC.configPath('mahdavi')), JSON.stringify(RC.withBuildRequest(cfg, { id: 'req-1', by: 'PJ' })));
  const res = join(tmp, 'res'); await mkdir(res);
  await writeFile(join(res, 'mahdavi.json'), JSON.stringify(ok));
  await writeFile(join(res, 'lfmp.json'), JSON.stringify({ slug: 'lfmp', ok: false, kind: 'auth', message: 'BrightLocal refused the key' }));
  const st = await RP.finish({ root: tmp, matrix: [{ slug: 'mahdavi', request: 'req-1' }, { slug: 'lfmp' }], resultsDir: res, dataDir: out, runUrl: 'https://github.com/x/actions/runs/1', now: new Date('2026-11-21T07:01:00Z'), log });
  check(st.firms.mahdavi.ok && st.firms.mahdavi.keywords === 88 && st.firms.mahdavi.request === 'req-1' && (await readFile(join(tmp, RC.dataPath('mahdavi')), 'utf8')).includes('"enc"'), 'finish: reports.json copied in, status ok with 88 keywords and the request id');
  check(st.brightlocal?.requests === 4, 'finish: the nightly\'s BrightLocal requests are added to status.brightlocal.requests (4)', JSON.stringify(st.brightlocal));
  check(!st.firms.lfmp.ok && st.firms.lfmp.kind === 'auth' && st.firms.lfmp.firstFailedAt === '2026-11-21T07:01:00.000Z', 'finish: a failed firm keeps its kind, reason and first-failed time');
  const st2 = await RP.finish({ root: tmp, matrix: [{ slug: 'lfmp' }], resultsDir: join(tmp, 'none'), dataDir: out, now: new Date('2026-11-22T07:01:00Z'), log });
  check(st2.brightlocal?.requests === 4, 'finish: a run without BrightLocal requests keeps the total');
  check(st2.firms.lfmp.kind === 'crashed' && st2.firms.lfmp.firstFailedAt === '2026-11-21T07:01:00.000Z' && st2.firms.mahdavi.ok, 'finish: still failing keeps the first-failed time; other firms untouched');
  check(!RP.wantsBuild || RC.wantsBuild(RC.withBuildRequest(cfg, { id: 'req-1' }), st.firms.mahdavi) === false, 'after the run the same request isn\'t built again');
  const is = RC.reportsIssues(st2, { firms: [{ slug: 'lfmp', name: 'LFMP' }] });
  check(is.length === 1 && is[0].id === 'reports:lfmp' && is[0].kind === 'reports' && is[0].firstSeen === '2026-11-21T07:01:00.000Z' && is[0].title === 'LFMP: Reports build failed', 'bell / Slack issue: one per failed firm, since it first failed');
  check(RC.reportsIssues(null).length === 0, 'no status file yet → no issues');
  const statusText = await readFile(join(tmp, RP.STATUS_FILE), 'utf8');
  check(!/rideshare|20\.7|right horse/.test(statusText), 'status file: no numbers and no passphrase (public)');
} finally { await rm(tmp, { recursive: true, force: true }); }

// ---------------------------------------------------------------- the workflow
const yml = await readFile(join(ROOT, '.github/workflows/reports.yml'), 'utf8');
check(/cron: "0 7 \* \* \*"/.test(yml) && /paths: \["firms\/\*\/reports-config\.json"\]/.test(yml) && /workflow_dispatch:/.test(yml), 'reports.yml: nightly 07:00 UTC (2 AM ET), push of a reports-config.json (Build now), Run workflow');
check(/HAS_KEY: \$\{\{ secrets\.BRIGHTLOCAL_API_KEY != '' \}\}/.test(yml) && /BRIGHTLOCAL_API_SECRET: \$\{\{ secrets\.BRIGHTLOCAL_API_SECRET \}\}/.test(yml) && /PASSPHRASE: \$\{\{ secrets\[format\('PASSPHRASE_\{0\}', matrix\.firm\.secretKey\)\] \}\}/.test(yml), 'secrets by name: BRIGHTLOCAL_API_KEY, BRIGHTLOCAL_API_SECRET, each job only its own PASSPHRASE_<KEY>');
check(!/GHL_TOKEN|GHL_MENU_TOKEN/.test(yml), 'no GHL token in the reports workflow (nothing touches GHL)');
check(/git add firms\/\*\/reports\.json status\/reports-status\.json/.test(yml), 'commits only reports.json files and status/reports-status.json');
const page = await readFile(join(ROOT, 'app/reports.html'), 'utf8');
const preview = await readFile(join(ROOT, 'tests/reports/approved.css'), 'utf8').catch(() => null);
check(preview === null || page.includes(preview.trim()), 'app/reports.html carries the approved CSS unchanged (tests/reports/approved.css)');
check(!/fetch\([^)]*firms\/\$\{(?!SLUG)/.test(page) && /const FIRM = PATH_FIRM \? '\.\/'/.test(page) && /lfmp-pass-\$\{SLUG\}/.test(page), 'client page reads only its own firm\'s files; same saved passphrase as the dashboard');

await import('./sources.mjs').then(m => m.run({ check, throwsKind }));
console.log(`\n${pass} of ${pass + fail} reports tests pass.`);
process.exitCode = fail ? 1 : 0;
