// v1.37.0 LeadPro Reports: the client page (app/reports.html through a firm stub) in a real browser.
//   Run:  CHROMIUM_PATH=… node tests/reports/ui.mjs [screenshot-folder] [preview-report.html] [preview-report-full.html]
// Two test firms are served next to the real files (nothing is written into firms/): a Draft LFMP firm and a Live WPP
// firm, each with reports.json encrypted from the fixtures. With a preview path, the approved preview is shot at the same
// sizes (preview-<size>-<scheme>.png) for the side-by-side.
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as RC from '../../scripts/reports-core.mjs';
import * as RP from '../../scripts/reports-pull.mjs';
import { quiet } from '../quiet-browser.mjs';   // FIX 10.0: no sound from test browsers

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHOTS = process.argv[2] || '', PREVIEW = process.argv[3] || '';
const pwPath = process.env.PLAYWRIGHT_CORE || join(ROOT, '../ghl-subaccount-builder/node_modules/playwright-core');
if (!existsSync(join(pwPath, 'package.json'))) { console.log('Skipped: playwright-core not found.'); process.exit(0); }
const { chromium } = await import(pathToFileURL(join(pwPath, 'index.mjs')).href);
let pass = 0, fail = 0;
const check = (ok, what, extra = '') => { if (ok) { pass++; console.log(`✓ ${what}`); } else { fail++; console.log(`✗ ${what}${extra ? `\n    ${extra}` : ''}`); } };

// ---- the two test firms (encrypted with the real pull code and the fixture BrightLocal)
const PASS = { 'zz-report-draft': 'draft firm passphrase 1', 'zz-report-wpp': 'wpp firm passphrase 2' };
const FX = join(ROOT, 'tests/reports/fixtures');
const fakeBL = async url => { const u = new URL(url), p = u.pathname, q = u.searchParams; const f = p.endsWith('search') ? 'locations.json' : p.endsWith('get-all') ? 'reports-3839215.json' : p.includes('results') ? `results-${q.get('campaign-id')}.json` : `history-${q.get('campaign-id')}.json`; return new Response(await readFile(join(FX, f), 'utf8')); };
const tmp = await mkdtemp(join(tmpdir(), 'reports-ui-'));
const virtual = new Map();
for (const [slug, status, agency] of [['zz-report-draft', 'draft', null], ['zz-report-wpp', 'live', 'WPP']]) {
  const cfg = { ...RC.newConfig({ slug, locationId: '3839215', rankReportId: '1290417', by: 'Test', at: '2026-11-21T10:00:00Z' }), status };
  await mkdir(join(tmp, 'firms', slug), { recursive: true });
  await (await import('node:fs/promises')).writeFile(join(tmp, RC.configPath(slug)), JSON.stringify(cfg));
  await RP.pull({ root: tmp, slug, key: 'k', pass: PASS[slug], fetch: fakeBL, outDir: join(tmp, 'out'), log: () => {}, now: new Date('2026-11-21T07:00:00Z') });
  virtual.set(`/firms/${slug}/reports-config.json`, JSON.stringify(cfg));
  virtual.set(`/firms/${slug}/reports.json`, await readFile(join(tmp, 'out', slug, 'reports.json'), 'utf8'));
  virtual.set(`/firms/${slug}/data/kpis.json`, JSON.stringify({ generatedAt: '2026-11-21T07:00:00Z', location: 'The Mahdavi Law Firm', ...(agency ? { agency } : {}) }));
  virtual.set(`/firms/${slug}/reports.html`, RC.STUB_HTML);
}
// v1.39.0: every source (fixtures/sources.mjs): Mahdavi (BrightLocal + CallRail + GA4 + Search Console + Business Profile,
// no Ads; Draft) and Sample Firm A (CallRail + Google + Ads), plus a Live firm whose newer tabs are still Draft.
const SRC = await import('./fixtures/sources.mjs');
const SA = await SRC.fakeServiceAccount();
Object.assign(PASS, { 'zz-report-mahdavi': 'mahdavi test pass 3', 'zz-report-sample': 'sample test pass 4', 'zz-report-pub': 'live published pass 5', 'zz-report-zero': 'zero conv pass 6' });
for (const [slug, mk, status, extra] of [['zz-report-mahdavi', SRC.configs.mahdavi, 'draft', {}], ['zz-report-sample', SRC.configs.sample, 'draft', {}], ['zz-report-pub', SRC.configs.mahdavi, 'live', { published: ['Rankings'] }], ['zz-report-zero', SRC.configs.sample, 'draft', {}]]) {
  const cfg = { ...mk(status), slug, ...extra };
  await mkdir(join(tmp, 'firms', slug), { recursive: true });
  await (await import('node:fs/promises')).writeFile(join(tmp, RC.configPath(slug)), JSON.stringify(cfg));
  await RP.pull({ root: tmp, slug, creds: SRC.allCreds(SA.json), pass: PASS[slug], fetch: SRC.fakeApis({ adsZero: slug === 'zz-report-zero' }), outDir: join(tmp, 'out'), log: () => {}, now: SRC.NOW });
  virtual.set(`/firms/${slug}/reports-config.json`, JSON.stringify(cfg));
  virtual.set(`/firms/${slug}/reports.json`, await readFile(join(tmp, 'out', slug, 'reports.json'), 'utf8'));
  virtual.set(`/firms/${slug}/data/kpis.json`, JSON.stringify({ location: slug.includes('sample') || slug.includes('zero') ? 'Sample Firm A' : 'The Mahdavi Law Firm' }));
  virtual.set(`/firms/${slug}/reports.html`, RC.STUB_HTML);
}
// v1.42.0 (queue item 13): one-source reports (Overview + that tab) and a Reports-only client (no KPI dashboard: no kpis.json,
// its name in reportsOnly, its own passphrase)
const SOLO = { 'zz-solo-callrail': 'callrail', 'zz-solo-bl': 'brightlocal', 'zz-solo-sc': 'searchConsole', 'zz-solo-ga4': 'ga4', 'zz-ro-callrail': 'callrail' };
for (const [slug, src] of Object.entries(SOLO)) {
  PASS[slug] = `${slug} made-up pass 7`;
  const full = SRC.configs.mahdavi('draft');
  const cfg = { ...RC.newConfig({ slug, sources: { [src]: full.sources[src] }, ...(slug.startsWith('zz-ro-') ? { reportsOnly: { name: 'Acme Law', locationId: 'Po7mOmrwAAslMJZAwIeA', secretKey: 'ZZ_RO_CALLRAIL' } } : {}), by: 'Test', at: '2026-11-25T10:00:00Z' }) };
  await mkdir(join(tmp, 'firms', slug), { recursive: true });
  await (await import('node:fs/promises')).writeFile(join(tmp, RC.configPath(slug)), JSON.stringify(cfg));
  await RP.pull({ root: tmp, slug, creds: SRC.allCreds(SA.json), pass: PASS[slug], fetch: SRC.fakeApis({}), outDir: join(tmp, 'out'), log: () => {}, now: SRC.NOW });
  virtual.set(`/firms/${slug}/reports-config.json`, JSON.stringify(cfg));
  virtual.set(`/firms/${slug}/reports.json`, await readFile(join(tmp, 'out', slug, 'reports.json'), 'utf8'));
  if (!slug.startsWith('zz-ro-')) virtual.set(`/firms/${slug}/data/kpis.json`, JSON.stringify({ location: 'The Mahdavi Law Firm' }));
  virtual.set(`/firms/${slug}/reports.html`, RC.STUB_HTML);
}
const PREVIEW_FULL = process.argv[4] || '';
if (PREVIEW_FULL) virtual.set('/__preview/report-full.html', await readFile(PREVIEW_FULL, 'utf8'));
// a firm with Reports set up but no build yet, and one without competitors
virtual.set('/firms/zz-report-new/reports-config.json', JSON.stringify(RC.newConfig({ slug: 'zz-report-new', locationId: '3839215' })));
virtual.set('/firms/zz-report-new/data/kpis.json', JSON.stringify({ location: 'New Firm' }));
virtual.set('/firms/zz-report-new/reports.html', RC.STUB_HTML);
if (PREVIEW) virtual.set('/__preview/report.html', await readFile(PREVIEW, 'utf8'));
const TYPES = { '.html': 'text/html', '.json': 'application/json', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/markdown' };
const server = createServer(async (req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (virtual.has(p)) { res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'text/plain' }); return res.end(virtual.get(p)); }
  const f = normalize(join(ROOT, p));
  if (!f.startsWith(ROOT) || !existsSync(f) || /\/firms\/zz-report/.test(p)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(await readFile(f));
}).listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await quiet(await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--mute-audio'] }));
const outside = [];
async function open(path, { w = 1440, h = 900, scheme = 'light', saved = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
  if (saved) await ctx.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch {} }, saved);
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => { if (!/fonts\.(googleapis|gstatic)\.com/.test(r.request().url())) outside.push(r.request().url()); r.abort(); });
  await page.goto(BASE + path); await page.waitForSelector('#body .card, #body .lock', { timeout: 15000 });
  return { ctx, page, errs };
}
const text = (page, sel) => page.locator(sel).first().innerText();
const shot = async (page, name, full = true) => { if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: full }); } };

try {
  // ---- locked: lock card, wrong passphrase, right passphrase (saved for the next visit)
  { const { ctx, page, errs } = await open('/firms/zz-report-draft/reports.html?tab=Rankings');   // v1.42.0: a BrightLocal-only report opens on Overview; these checks read the Rankings tab
    check(await page.locator('.lock').count() === 1 && /same passphrase as your KPI dashboard/.test(await text(page, '.lock')), 'no passphrase → the lock card (same passphrase as the KPI dashboard)');
    check(!(await page.locator('#body').innerText()).match(/20\.7|rideshare/), 'nothing from the report shows while locked');
    await page.fill('#pass', PASS['zz-report-wpp']); await page.click('.lock button');
    await page.waitForSelector('.lock .err'); check(/didn't open this report/.test(await text(page, '.lock .err')), 'another firm\'s passphrase → "didn\'t open this report"');
    await page.fill('#pass', PASS['zz-report-draft']); await page.click('.lock button'); await page.waitForSelector('.r4');
    check(await page.evaluate(k => localStorage.getItem(k), 'lfmp-pass-zz-report-draft') === PASS['zz-report-draft'], 'the right passphrase unlocks and is remembered (lfmp-pass-<slug>, shared with the dashboard)');
    check(!errs.length, 'no page errors', errs.join(' | '));
    await ctx.close(); }

  // ---- #k= link key (as from the GHL menu link): unlocks, then scrubbed from the address bar
  { const { ctx, page } = await open(`/firms/zz-report-draft/reports.html?tab=Rankings#k=${encodeURIComponent(PASS['zz-report-draft'])}`);
    await page.waitForSelector('.r4'); check(!page.url().includes('#k='), '#k=… link key unlocks and is removed from the address bar'); await ctx.close(); }

  // ---- the report: every number, control and size
  for (const [w, h] of [[1440, 900], [390, 844]]) for (const scheme of ['light', 'dark']) {
    const tag = `${w}-${scheme}`;
    const { ctx, page, errs } = await open('/firms/zz-report-draft/reports.html?tab=Rankings', { w, h, scheme, saved: ['lfmp-pass-zz-report-draft', PASS['zz-report-draft']] });
    await page.waitForSelector('.r4');
    const tiles = await page.locator('.r4 .card').allInnerTexts();
    check(/Average Google position[\s\S]*20\.7[\s\S]*▼ 0\.2[\s\S]*Across 88 tracked keywords/.test(tiles[0]) && /6[\s\S]*of 88 tracked/.test(tiles[1]) && /\+1 \/ \+3/.test(tiles[2]) && /0%[\s\S]*Not in the map results yet/.test(tiles[3]), `${tag}: 4 tiles: 20.7 ▼ 0.2 · 6 of 88 · +1 / +3 · 0%`, tiles.join(' | '));
    check(await text(page, '#firm') === 'The Mahdavi Law Firm' && await text(page, '#sub') === 'LeadPro Reports · Houston, TX', `${tag}: header: firm name + "LeadPro Reports · Houston, TX"`);
    check(JSON.stringify(await page.locator('#tabs .tab').allInnerTexts()) === '["Overview","Rankings"]' && (await text(page, '#tabs .tab.on')) === 'Rankings', `${tag}: only BrightLocal linked: Overview + Rankings (v1.42.0), Rankings open (gold underline)`);
    check(await page.locator('#draft').isVisible() && /Draft/.test(await text(page, '#draft')), `${tag}: Draft banner (not in the GHL menu yet)`);
    check(/BrightLocal Rank Tracker · Oct 31, 2026 vs Oct 9 · checked from Houston, TX/.test(await text(page, '.sec .l')), `${tag}: "BrightLocal Rank Tracker · Oct 31, 2026 vs Oct 9 · checked from Houston, TX"`);
    check(await page.locator('svg[aria-label="Average Google position by month"] polyline').count() === 3 && /May[\s\S]*Oct/.test(await page.locator('svg[aria-label="Average Google position by month"]').innerHTML()), `${tag}: average position by month: 3 lines, May–Oct`);
    check(/#2–5\s*3[\s\S]*#11–20\s*4[\s\S]*#21\+ \/ not found\s*80/.test(await text(page, '.r21 .card:nth-child(2)')), `${tag}: positions mix 0 · 3 · 1 · 4 · 80`);
    const rows = () => page.locator('.tbl').first().locator('table tr').count();
    check(await rows() === 7, `${tag}: keyword table: In top 20 → 6 rows`);
    await page.click('[data-top="0"]'); check(await rows() === 89, `${tag}: All 88 → 88 rows`);
    await page.fill('#q', 'premises'); check(await rows() === 7, `${tag}: search "premises" (All) → its 6 keywords`);
    await page.fill('#q', 'zzz'); check(/No keywords match/.test(await text(page, '.tbl table')), `${tag}: no match → "No keywords match."`);
    await page.fill('#q', ''); await page.click('[data-top="1"]');
    await page.click('th[data-s="kw"]'); const first = await page.locator('.tbl table tr:nth-child(2) td').first().innerText();
    check(first === 'Houston rideshare accident attorney', `${tag}: sort by keyword (A–Z)`, first);
    await page.click('th[data-s="d"]'); check(await page.locator('.tbl table tr:nth-child(2) td').first().innerText() === 'rideshare accident attorney 77027', `${tag}: sort by desktop rank (4 first)`);
    await page.click('th[data-s="vol"]');
    check(await page.locator('.sec h2', { hasText: 'You vs. competitors' }).count() === 1 && await page.locator('.tbl').nth(1).locator('tr').count() === 15, `${tag}: competitors: 14 keywords × 3 firms`);
    const cells = await page.locator('.tbl').nth(1).locator('tr').evaluateAll(trs => trs.map(tr => tr.children.length));
    check(cells.every(n => n === 5) && await page.locator('.tbl').nth(1).locator('table > :not(tbody):not(tr)').count() === 0 && await page.locator('.tbl').nth(1).locator('tr:nth-child(2) td:nth-child(5)').innerText() === '1', `${tag}: every competitor row: keyword · You · 3 firms, each rank in its own cell (Zehl #1 on the first row)`, cells.join(','));
    const foot = await text(page, 'footer');
    check(/LeadPro Reports · Data refreshed nightly · Last updated Nov 21, 2026, 2:00 AM ET/.test(foot) && !/Web Promotion Partners/.test(foot), `${tag}: footer "… Last updated Nov 21, 2026, 2:00 AM ET" (LFMP firm: no WPP)`, foot);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${tag}: no sideways scroll`);
    if (w === 390) check(await page.evaluate(() => getComputedStyle(document.querySelector('.r4')).gridTemplateColumns.split(' ').length === 2), '390: tiles in 2 columns (phone layout)');
    check(!errs.length, `${tag}: no page errors`, errs.join(' | '));
    await page.locator('#q').blur(); await shot(page, `client-report-${tag}`);
    await ctx.close();
    if (PREVIEW) { const p = await open('/__preview/report.html', { w, h, scheme }).catch(() => null); if (p) { await p.page.waitForSelector('.r4'); await shot(p.page, `preview-report-${tag}`); await p.ctx.close(); } }
  }

  // ---- Live WPP firm: no Draft banner, WPP logo + footer
  { const { ctx, page } = await open('/firms/zz-report-wpp/reports.html', { saved: ['lfmp-pass-zz-report-wpp', PASS['zz-report-wpp']] });
    await page.waitForSelector('.r4');
    check(!(await page.locator('#draft').isVisible()), 'Live: no Draft banner');
    check(/· Web Promotion Partners/.test(await text(page, 'footer')) && await page.locator('#agency.on').count() === 1 && /wpp-logo\.png/.test(await page.locator('#agency').getAttribute('src')), 'WPP firm: "· Web Promotion Partners" in the footer + the real WPP logo');
    await shot(page, 'client-report-wpp-live-1440-light', false);
    await ctx.close(); }
  // ---- set up, first build not done yet
  { const { ctx, page } = await open('/firms/zz-report-new/reports.html');
    check(/First report coming soon/.test(await text(page, '#body')), 'set up but not built yet → "First report coming soon" (no lock, nothing to unlock)'); await ctx.close(); }
  // ================================================================ v1.39.0: every tab (queue items 7–9)
  const RANGE7 = slug => [`lfmp-report-range-${slug}`, '7d'];
  async function openFirm(slug, { w = 1440, h = 900, scheme = 'light', range = '7d', qs = '' } = {}) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
    await ctx.addInitScript(([a, b, c, d]) => { try { localStorage.setItem(a, b); if (d) localStorage.setItem(c, d); } catch {} }, [`lfmp-pass-${slug}`, PASS[slug], `lfmp-report-range-${slug}`, range]);
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, r => { if (!/fonts\.(googleapis|gstatic)\.com/.test(r.request().url())) outside.push(r.request().url()); r.abort(); });
    await page.goto(`${BASE}/firms/${slug}/reports.html${qs}`); await page.waitForSelector('#body .card');
    return { ctx, page, errs };
  }
  const tabTo = async (page, t) => { await page.click(`#tabs [data-t="${t}"]`); await page.waitForSelector(`#tabs .tab.on[data-t="${t}"]`); };
  const tiles = page => page.locator('.r4').first().locator('.card').allInnerTexts();
  const flat = s => s.replace(/([^\s])([▲▼])/g, '$1 $2').replace(/\s+/g, ' ').trim();
  const PREV_TAB = { Overview: 'overview', Calls: 'calls', 'Website leads': 'leads', 'Google Search': 'search', 'Website traffic': 'traffic', 'Google Business Profile': 'gbp', Ads: 'ads' };
  for (const [w, h] of [[1440, 900], [390, 844]]) for (const scheme of ['light', 'dark']) {
    const tag = `${w}-${scheme}`;
    const { ctx, page, errs } = await openFirm('zz-report-mahdavi', { w, h, scheme });
    check(JSON.stringify(await page.locator('#tabs .tab').allInnerTexts()) === JSON.stringify(['Overview', 'Calls', 'Website leads', 'Google Search', 'Website traffic', 'Google Business Profile', 'Rankings']), `${tag}: Mahdavi: the 7 linked tabs, no Ads (not linked)`);
    check(await text(page, '#dtl') === 'Aug 3 – Aug 9, 2026' && await text(page, '#sub') === 'LeadPro Reports · Houston, TX', `${tag}: date pill "Aug 3 – Aug 9, 2026" (Last 7 days) + "LeadPro Reports · Houston, TX"`);
    // Overview
    check(flat(await text(page, '.sum h1')) === 'This week: 107 calls and 1 website form.', `${tag}: Overview headline "This week: 107 calls and 1 website form."`, await text(page, '.sum h1'));
    check(/Calls are up 29% on the week before\. Most came from your Google Business Profile\. 14 calls were missed; that's the main thing to fix\./.test(await text(page, '.sum p')), `${tag}: summary sentence (up 29%, GBP, 14 missed)`, await text(page, '.sum p'));
    const li = flat((await page.locator('.sum li').allInnerTexts()).join(' | '));
    check(/40 first-time callers, up 38%/.test(li) && /14 missed calls, up 75%/.test(li) && /#4 on Google for "rideshare accident attorney 77027"/.test(li), `${tag}: the 3 summary points (40 up 38% · 14 up 75% · #4 best keyword)`, li);
    let t = (await tiles(page)).map(flat);
    check(/Total calls CallRail 107 ▲ 29% vs 83 the week before/.test(t[0]) && /First-time callers CallRail 40 ▲ 38%/.test(t[1]) && /Answered CallRail 93 ▲ 24% 87% of calls answered/.test(t[2]) && /Missed CallRail 14 ▲ 75% 13% of calls missed/.test(t[3]), `${tag}: Overview tiles 107 / 40 / 93 / 14`, t.join(' | '));
    check(await page.locator('.r4').first().locator('.card').nth(3).locator('.chg.dn').count() === 1 && await page.locator('.r4').first().locator('.card').nth(0).locator('.chg.up').count() === 1, `${tag}: missed ▲ is red (worse), calls ▲ green`);
    check(/87%[\s\S]*Answered 93[\s\S]*Missed 14/.test(await text(page, '.r3 .card:nth-child(1)')), `${tag}: donut 87% answered (93 / 14)`);
    check(/Google Business Profile\s*69[\s\S]*Google Ads\s*18[\s\S]*Google organic\s*8[\s\S]*Direct\s*5[\s\S]*Other\s*7/.test(await text(page, '.r3 .card:nth-child(2)')), `${tag}: where calls came from: GBP 69 · Ads 18 · organic 8 · direct 5 · other 7`);
    check(await page.locator('svg[aria-label="Calls per day"] polyline').count() === 2 && await page.locator('svg[aria-label="Calls per day"] circle').count() === 7, `${tag}: calls per day: this week (7 points) + the week before`);
    const wg = flat(await page.locator('.sec', { hasText: 'Website & Google' }).locator('xpath=following-sibling::div[1]').innerText());
    check(/Google search clicks Search Console 312 ▲ 6% 11\.9k impressions 14\.2 avg position/.test(wg) && /Website visits GA4 948 ▼ 3% 71% from Google 1:42 avg time/.test(wg) && /Profile actions Google Business 186 ▲ 11% 121 calls 43 directions 22 site clicks/.test(wg) && /Google Ads Google Ads Not connected yet\. Calls from your ads still count on the Calls tab \(18 this week\)\./.test(wg), `${tag}: Website & Google: 312 · 948 · 186 · Ads "Not connected yet … (18 this week)"`, wg);
    check(/Average Google position BrightLocal 20\.7/.test(flat(await text(page, '.row.r3:nth-of-type(n)'))) || /20\.7/.test(await page.locator('.sec', { hasText: 'Google rankings' }).locator('xpath=following-sibling::div[1]').innerText()), `${tag}: Overview rankings section (BrightLocal linked)`);
    check(!errs.length, `${tag}: no page errors (Overview)`, errs.join(' | '));
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${tag}: Overview: no sideways scroll`);
    await shot(page, `client-overview-${tag}`);
    // Calls
    await tabTo(page, 'Calls');
    t = (await tiles(page)).map(flat);
    check(/107 ▲ 29% vs 83 the week before/.test(t[0]) && /93 ▲ 24% 87% of calls$/.test(t[2]) && /14 ▲ 75% 13% of calls$/.test(t[3]), `${tag}: Calls tiles`, t.join(' | '));
    const ch = await page.locator('svg[aria-label="Calls per day"]').evaluate(e => e.getBoundingClientRect().height);
    check(await page.locator('svg[aria-label="Calls per day"]').getAttribute('height') === '230' && (w > 760 ? Math.round(ch) === 230 : ch < 200 && ch > 100), `${tag}: Calls per day 230 px tall on desktop; scaled to the width on a phone (FIX 7.1: ${Math.round(ch)} px)`);
    if (w <= 760) check(await page.evaluate(() => [...document.querySelectorAll('svg.ln')].every(s => { const r = s.getBoundingClientRect(), vb = s.viewBox.baseVal; return Math.abs(r.height - r.width * vb.height / vb.width) < 2; })), `${tag}: every line chart keeps its shape (height follows width)`);
    const tb = flat(await text(page, '.r2 .tbl'));
    check(/Google Business Profile 69 64%/.test(tb) && /Other 7 7%/.test(tb) && /Total 107 100%/.test(tb), `${tag}: source detail table (69 · 64% … Total 107 · 100%)`, tb);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${tag}: Calls: no sideways scroll`);
    await shot(page, `client-calls-${tag}`);
    // Website leads
    await tabTo(page, 'Website leads');
    t = (await page.locator('.r3 .card').allInnerTexts()).map(flat);
    check(/Form submissions CallRail forms 1 From mahdavilawfirm\.com · 0 first-time/.test(t[0]) && /All leads this week 108 107 calls \+ 1 form/.test(t[1]) && /Want to see the people behind these\?/.test(await text(page, '.empty')), `${tag}: Website leads: 1 form · 108 leads · the "people behind these" card`, t.join(' | '));
    await shot(page, `client-leads-${tag}`);
    // Google Search
    await tabTo(page, 'Google Search');
    t = (await tiles(page)).map(flat);
    check(/Clicks Search Console 312 ▲ 6%/.test(t[0]) && /11,900/.test(t[1]) && /2\.6%/.test(t[2]) && /14\.2 Lower is better/.test(t[3]) && /about 2 days behind/.test(await text(page, '.sec .l')), `${tag}: Google Search 312 · 11,900 · 2.6% · 14.2, "about 2 days behind"`, t.join(' | '));
    check(await page.locator('.r21 .tbl tr').count() === 6 && /mahdavi law firm\s*103\s*1\.2/.test(await text(page, '.r21 .tbl')), `${tag}: top searches: 5 rows (mahdavi law firm 103 · 1.2)`);
    await page.click('#allQ'); check(await page.locator('.r21 .tbl tr').count() === 26, `${tag}: "All 25 searches" shows 25`); await page.click('#allQ');
    await shot(page, `client-search-${tag}`);
    // Website traffic
    await tabTo(page, 'Website traffic');
    t = (await tiles(page)).map(flat);
    check(/Visits GA4 948 ▼ 3%/.test(t[0]) && /739/.test(t[1]) && /1:42/.test(t[2]) && /Visits that became a lead GA4 3\.5%/.test(t[3]), `${tag}: Website traffic 948 · 739 · 1:42 · 3.5% (key events)`, t.join(' | '));
    check(/Organic search\s*493[\s\S]*Google Business Profile\s*180[\s\S]*Direct\s*152[\s\S]*Paid search\s*85[\s\S]*Referral\s*38/.test(await text(page, '.r21 .card:nth-child(2)')), `${tag}: where visitors came from 493 · 180 · 152 · 85 · 38`);
    await shot(page, `client-traffic-${tag}`);
    // Business Profile
    await tabTo(page, 'Google Business Profile');
    t = (await tiles(page)).map(flat);
    check(/186 ▲ 11%/.test(t[0]) && /121/.test(t[1]) && /43/.test(t[2]) && /22/.test(t[3]) && /3,534[\s\S]*2,191[\s\S]*on Google Search[\s\S]*1,343[\s\S]*on Google Maps/.test(await text(page, '.r2 .card:nth-child(2)')), `${tag}: Business Profile 186 · 121 · 43 · 22; views 3,534 (2,191 Search / 1,343 Maps)`, t.join(' | '));
    await shot(page, `client-gbp-${tag}`);
    check(!errs.length, `${tag}: no page errors (all tabs)`, errs.join(' | '));
    await ctx.close();
    // Sample Firm A: the Ads tab + the Overview cost-per-lead card
    { const { ctx: c2, page: p2, errs: e2 } = await openFirm('zz-report-sample', { w, h, scheme });
      check(JSON.stringify(await p2.locator('#tabs .tab').allInnerTexts()) === JSON.stringify(['Overview', 'Calls', 'Website leads', 'Google Search', 'Website traffic', 'Google Business Profile', 'Ads']), `${tag}: Sample Firm A: Ads tab (linked), no Rankings (not linked)`);
      const ov = flat(await p2.locator('.sec', { hasText: 'Website & Google' }).locator('xpath=following-sibling::div[1]').innerText());
      check(/Cost per lead \(ads\) Google Ads \$186 ▼ \$22 \$1,490 spent 8 ad leads/.test(ov), `${tag}: Overview "Cost per lead (ads)" $186 ▼ $22 · $1,490 spent · 8 ad leads`, ov);
      check(/#/.test(await text(p2, '.sum ul')) === false && /312 Google search clicks/.test(await text(p2, '.sum ul')), `${tag}: no rankings linked → the 3rd point is the search clicks`);
      await shot(p2, `client-overview-ads-${tag}`);
      await tabTo(p2, 'Ads');
      t = (await tiles(p2)).map(flat);
      check(/Spend Google Ads \$1,490/.test(t[0]) && /Leads from ads Google Ads 8/.test(t[1]) && /Cost per lead Google Ads \$186 ▼ \$22/.test(t[2]) && /Clicks Google Ads 201/.test(t[3]), `${tag}: Ads tiles $1,490 · 8 · $186 ▼ $22 · 201`, t.join(' | '));
      const camp = flat(await text(p2, '.tbl'));
      check(/Personal injury · city \$849 4 \$212/.test(camp) && /Car accidents \$402 3 \$134/.test(camp) && /Truck accidents \$239 1 \$239/.test(camp), `${tag}: campaigns $849/4/$212 · $402/3/$134 · $239/1/$239`, camp);
      check(!e2.length && await p2.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${tag}: Ads: no errors, no sideways scroll`, e2.join(' | '));
      await shot(p2, `client-ads-${tag}`);
      await c2.close(); }
    if (PREVIEW_FULL) for (const [tab, firm] of [['Overview', 'm'], ['Calls', 'm'], ['Website leads', 'm'], ['Google Search', 'm'], ['Website traffic', 'm'], ['Google Business Profile', 'm'], ['Ads', 'a'], ['Overview', 'a']]) {
      const c3 = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme }); const p3 = await c3.newPage();
      await p3.goto(`${BASE}/__preview/report-full.html?pv=0&firm=${firm}&tab=${encodeURIComponent(tab)}`); await p3.waitForSelector('#body .card');
      await shot(p3, `client-${PREV_TAB[tab]}${firm === 'a' && tab === 'Overview' ? '-ads' : ''}-${tag}-PREVIEW`); await c3.close();
    }
  }
  // the date picker: every range, "vs previous period", Escape, remembered per firm; Last 30 days = the sum of the fixture days
  { const { ctx, page } = await openFirm('zz-report-mahdavi', { range: '' });
    check(await text(page, '#dtl') === 'Jul 11 – Aug 9, 2026', 'default range: Last 30 days (Jul 11 – Aug 9, 2026)', await text(page, '#dtl'));
    const rep = await (await import('../../scripts/kpi-core.mjs')).decryptJSON(JSON.parse(virtual.get('/firms/zz-report-mahdavi/reports.json')).enc, PASS['zz-report-mahdavi']);
    const sum30 = RC.dayList('2026-07-11', '2026-08-09').reduce((a, d) => a + (rep.calls.days[d]?.t || 0), 0);
    check(flat(await text(page, '.sum h1')).startsWith(`Last 30 days: ${sum30} calls`), `Last 30 days = the sum of the fixture days (${sum30} calls)`, await text(page, '.sum h1'));
    await page.click('#dt'); check(await page.locator('#dtm').isVisible() && JSON.stringify(await page.locator('#dtm button').allInnerTexts()) === JSON.stringify(['Last 7 days', 'Last 30 days', 'Last 90 days', 'This month', 'Last month']), 'the date menu: Last 7 / 30 / 90 days · This month · Last month');
    await page.keyboard.press('Escape'); check(!(await page.locator('#dtm').isVisible()), 'Escape closes the date menu');
    for (const [k, label] of [['90d', 'May 12 – Aug 9, 2026'], ['month', 'Aug 1 – Aug 9, 2026'], ['lastMonth', 'Jul 1 – Jul 31, 2026'], ['7d', 'Aug 3 – Aug 9, 2026']]) { await page.click('#dt'); await page.click(`[data-range="${k}"]`); check(await text(page, '#dtl') === label, `range ${k} → "${label}"`, await text(page, '#dtl')); }
    check(await page.evaluate(() => localStorage.getItem('lfmp-report-range-zz-report-mahdavi')) === '7d', 'the range is remembered for this firm');
    await page.click('.sec .go[data-t="Website leads"]'); check(await page.locator('#tabs .tab.on').innerText() === 'Website leads', '"Open Website leads →" opens the tab');
    await ctx.close(); }
  // 0 conversions → "–"
  { const { ctx, page } = await openFirm('zz-report-zero'); await tabTo(page, 'Ads');
    const t = (await tiles(page)).map(flat);
    check(/Leads from ads Google Ads 0/.test(t[1]) && /Cost per lead Google Ads –/.test(t[2]) && /\$0|–/.test(await text(page, '.tbl')) && (await page.locator('.tbl tr td:nth-child(4)').allInnerTexts()).every(x => x === '–'), '0 conversions → cost per lead "–" (tile and every campaign)', t.join(' | '));
    await ctx.close(); }
  // Draft until Andy: a Live report shows its client only the published tabs; ?drafts=1 (the team) shows the rest under a Draft banner
  { const { ctx, page } = await openFirm('zz-report-pub');
    check(JSON.stringify(await page.locator('#tabs .tab').allInnerTexts()) === '["Rankings"]' && !(await page.locator('#draft').isVisible()), 'Live report: the client sees only its published tab (Rankings), no banner; new tabs stay hidden');
    await ctx.close(); }
  { const { ctx, page } = await openFirm('zz-report-pub', { qs: '?drafts=1' });
    check((await page.locator('#tabs .tab').count()) === 7 && await page.locator('#draft').isVisible() && /Draft tabs · Overview, Calls, Website leads, Google Search, Website traffic, Google Business Profile aren't visible to your client yet/.test(await text(page, '#draft')), '?drafts=1 (Open report with drafts): all 7 tabs + the Draft banner naming the draft tabs', await text(page, '#draft'));
    await shot(page, 'client-drafts-banner-1440-light', false);
    await ctx.close(); }
  // numbers only: nothing from a call row or form reaches the page
  { const { ctx, page } = await openFirm('zz-report-mahdavi');
    let all = ''; for (const tb of await page.locator('#tabs .tab').allInnerTexts()) { await tabTo(page, tb); all += await page.content(); }
    check(![SRC.PII.name, SRC.PII.phone, SRC.PII.recording, SRC.PII.form, '7135550123'].some(x => all.includes(x)), 'no caller name / number / recording / form field anywhere on the page (every tab)');
    await ctx.close(); }
  // ---- v1.42.0 (queue item 13): any single source is a report
  for (const [w, h] of [[1440, 900], [390, 844]]) for (const scheme of ['light', 'dark']) {
    const tag = `${w}-${scheme}`;
    for (const [slug, want, overviewHas, overviewHasNot] of [
      ['zz-solo-callrail', ['Overview', 'Calls', 'Website leads'], /Total calls[\s\S]*Website leads/, /Average Google position|Website &/],
      ['zz-solo-bl', ['Overview', 'Rankings'], /Google rankings[\s\S]*Average Google position[\s\S]*20\.7/, /Total calls|First-time callers|Website &|Google Ads/],
      ['zz-solo-sc', ['Overview', 'Google Search'], /Website &(amp;)? Google[\s\S]*Google search clicks/, /Total calls|First-time callers|Average Google position|Website visits|Google Ads/],
      ['zz-solo-ga4', ['Overview', 'Website traffic'], /Website visits/, /Total calls|First-time callers|Average Google position|Google search clicks|Google Ads/]]) {
      const { ctx, page, errs } = await open(`/firms/${slug}/reports.html`, { w, h, scheme, saved: [`lfmp-pass-${slug}`, PASS[slug]] });
      await page.waitForSelector('#body .sum, #body .row', { timeout: 15000 });
      const tabsNow = await page.locator('#tabs .tab').allInnerTexts(), body = await page.locator('#body').innerText();
      check(JSON.stringify(tabsNow) === JSON.stringify(want), `${tag} ${slug}: tabs ${want.join(' · ')}`, JSON.stringify(tabsNow));
      check(overviewHas.test(body) && !overviewHasNot.test(body), `${tag} ${slug}: Overview shows only what is linked (no empty call tiles)`, body.slice(0, 300).replace(/\s+/g, ' '));
      check(!/First numbers after tonight/.test(body) && await page.locator('#body .card .empty').count() === 0, `${tag} ${slug}: no empty section on Overview`);
      if (w === 1440 && scheme === 'light') await shot(page, `solo-${slug.slice(8)}-overview-${tag}`);
      if (w === 390) await shot(page, `solo-${slug.slice(8)}-overview-${tag}`);
      const second = want[1];
      await page.click(`#tabs .tab[data-t="${second}"]`); await page.waitForTimeout(150);
      check(!/First numbers after tonight/.test(await page.locator('#body').innerText()), `${tag} ${slug}: the ${second} tab has its numbers`);
      if (w === 1440 && scheme === 'light') await shot(page, `solo-${slug.slice(8)}-${second.toLowerCase().replace(/\s+/g, '-')}-${tag}`);
      check(!errs.length, `${tag} ${slug}: no page errors`, errs.join(' | '));
      await ctx.close();
    }
  }
  // a Reports-only client: its name from reportsOnly (no kpis.json), its own passphrase, the lock says so
  { const { ctx, page } = await open('/firms/zz-ro-callrail/reports.html');
    check(/passphrase your LFMP team gave you/.test(await text(page, '.lock')) && !/KPI dashboard/.test(await text(page, '.lock')), 'Reports-only client: the lock card doesn\'t mention a KPI dashboard');
    await page.fill('#pass', PASS['zz-ro-callrail']); await page.click('.lock button'); await page.waitForSelector('.r4');
    check(await text(page, '#firm') === 'Acme Law', 'Reports-only client: its name from its config (no kpis.json)');
    await shot(page, 'reports-only-client-1440-light');
    await ctx.close(); }
  check(!outside.length, 'nothing loaded from outside the site (fonts aside)', outside.join(' | '));
} finally { await browser.close(); server.close(); await rm(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} of ${pass + fail} report page checks passed.`);
process.exitCode = fail ? 1 : 0;
