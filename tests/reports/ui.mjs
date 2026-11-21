// v1.37.0 LeadPro Reports: the client page (app/reports.html through a firm stub) in a real browser.
//   Run:  CHROMIUM_PATH=… node tests/reports/ui.mjs [screenshot-folder] [preview-report.html]
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
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
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
  { const { ctx, page, errs } = await open('/firms/zz-report-draft/reports.html');
    check(await page.locator('.lock').count() === 1 && /same passphrase as your KPI dashboard/.test(await text(page, '.lock')), 'no passphrase → the lock card (same passphrase as the KPI dashboard)');
    check(!(await page.locator('#body').innerText()).match(/20\.7|rideshare/), 'nothing from the report shows while locked');
    await page.fill('#pass', PASS['zz-report-wpp']); await page.click('.lock button');
    await page.waitForSelector('.lock .err'); check(/didn't open this report/.test(await text(page, '.lock .err')), 'another firm\'s passphrase → "didn\'t open this report"');
    await page.fill('#pass', PASS['zz-report-draft']); await page.click('.lock button'); await page.waitForSelector('.r4');
    check(await page.evaluate(k => localStorage.getItem(k), 'lfmp-pass-zz-report-draft') === PASS['zz-report-draft'], 'the right passphrase unlocks and is remembered (lfmp-pass-<slug>, shared with the dashboard)');
    check(!errs.length, 'no page errors', errs.join(' | '));
    await ctx.close(); }

  // ---- #k= link key (as from the GHL menu link): unlocks, then scrubbed from the address bar
  { const { ctx, page } = await open(`/firms/zz-report-draft/reports.html#k=${encodeURIComponent(PASS['zz-report-draft'])}`);
    await page.waitForSelector('.r4'); check(!page.url().includes('#k='), '#k=… link key unlocks and is removed from the address bar'); await ctx.close(); }

  // ---- the report: every number, control and size
  for (const [w, h] of [[1440, 900], [390, 844]]) for (const scheme of ['light', 'dark']) {
    const tag = `${w}-${scheme}`;
    const { ctx, page, errs } = await open('/firms/zz-report-draft/reports.html', { w, h, scheme, saved: ['lfmp-pass-zz-report-draft', PASS['zz-report-draft']] });
    await page.waitForSelector('.r4');
    const tiles = await page.locator('.r4 .card').allInnerTexts();
    check(/Average Google position[\s\S]*20\.7[\s\S]*▼ 0\.2[\s\S]*Across 88 tracked keywords/.test(tiles[0]) && /6[\s\S]*of 88 tracked/.test(tiles[1]) && /\+1 \/ \+3/.test(tiles[2]) && /0%[\s\S]*Not in the map results yet/.test(tiles[3]), `${tag}: 4 tiles: 20.7 ▼ 0.2 · 6 of 88 · +1 / +3 · 0%`, tiles.join(' | '));
    check(await text(page, '#firm') === 'The Mahdavi Law Firm' && await text(page, '#sub') === 'LeadPro Reports · Houston, TX', `${tag}: header: firm name + "LeadPro Reports · Houston, TX"`);
    check(JSON.stringify(await page.locator('#tabs .tab').allInnerTexts()) === '["Rankings"]' && await page.locator('#tabs .tab.on').count() === 1, `${tag}: Phase 1: only the Rankings tab (gold underline)`);
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
  check(!outside.length, 'nothing loaded from outside the site (fonts aside)', outside.join(' | '));
} finally { await browser.close(); server.close(); await rm(tmp, { recursive: true, force: true }); }
console.log(`\n${pass} of ${pass + fail} report page checks passed.`);
process.exitCode = fail ? 1 : 0;
