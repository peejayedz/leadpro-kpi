// Admin page in a real browser against a mock GitHub.   Run:  node tests/admin-ui/run.mjs [screenshot-folder]
//
// Needs playwright-core and its Chromium (not a dependency of this repo): set PLAYWRIGHT_CORE to its folder, or keep the
// Sub-account Builder repo next to this one (../ghl-subaccount-builder/node_modules/playwright-core). Without it, this suite is skipped.
// Serves the repo folder locally, mocks api.github.com (tests/admin-ui/mock-github.mjs), lock.json and libsodium. Writes nothing in the repo.
//
// Checks: unlock + token, the firm list (stat strip, filters, search, ⋯ menu, Banner commit, Delete type-to-confirm), the top bar
// (theme Auto · Light · Dark + saved choice, version chip dot, ⋯ menu), the bell, What's new (cards, filter, technical details),
// Esc closing every panel, New firm (both options; app path: existing location refused, app missing → plain error, Retry →
// finished with one dispatch per try, one passphrase, nothing secret in dispatch inputs), Edit mapping (chips, Save at the top,
// an unchanged save writes config.json byte-identical), no sideways scroll at 390 px, and screenshots at 1440 + 390, light + dark.

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { createMockGitHub } from './mock-github.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHOTS = process.argv[2] || '';
const pwPath = process.env.PLAYWRIGHT_CORE || join(ROOT, '../ghl-subaccount-builder/node_modules/playwright-core');
if (!existsSync(join(pwPath, 'package.json'))) { console.log(`Skipped: playwright-core not found (${pwPath}). Set PLAYWRIGHT_CORE.`); process.exit(0); }
const { chromium } = await import(pathToFileURL(join(pwPath, 'index.mjs')).href);

const PASSWORD = 'test password for the mock';
const salt = randomBytes(16), iterations = 100000;
const LOCK = { salt: salt.toString('base64'), iterations, verifier: pbkdf2Sync(PASSWORD, salt, iterations, 64, 'sha256').subarray(0, 32).toString('base64') };
const SODIUM_STUB = `window.sodium = { ready: Promise.resolve(), from_string: s => new TextEncoder().encode(s),
  from_base64: b => Uint8Array.from(atob(b), c => c.charCodeAt(0)), to_base64: u => btoa(String.fromCharCode(...u)),
  crypto_box_seal: (m, pk) => Uint8Array.from([0xEE, ...m]) };`;
const unseal = b => { const u = Buffer.from(b, 'base64'); return u[0] === 0xEE ? u.subarray(1).toString('utf8') : null; };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };

const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '');
  let f = join(ROOT, p.endsWith('/') || p === '' ? `${p}index.html` : p);
  try { const b = await readFile(f); res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/admin/?repo=peejayedz/leadpro-kpi`;

let failed = 0, passed = 0;
const check = (v, what) => { if (v) { passed++; console.log(`✓ ${what}`); } else { failed++; console.log(`✗ ${what}`); } };
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function openPage(G, { width = 1440, height = 900, scheme = 'dark' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', e => { failed++; console.log(`✗ page error: ${e.message}`); });
  // The libsodium stub can't match the real file's SRI hash: drop the integrity attribute for cdnjs in this test only.
  await page.addInitScript(() => { const d = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'integrity'); Object.defineProperty(HTMLScriptElement.prototype, 'integrity', { set(v) { if (!String(this.src).includes('cdnjs.cloudflare.com')) d.set.call(this, v); }, get() { return d.get.call(this); } }); });
  await page.route('**/admin/lock.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(LOCK) }));
  await page.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'text/javascript', body: SODIUM_STUB }));
  await page.route('https://api.github.com/**', async r => {
    const q = r.request();
    const { status, json } = await G.handle(q.method(), q.url(), q.postData());
    await r.fulfill({ status, contentType: 'application/json', body: json === null ? '' : JSON.stringify(json) });
  });
  await page.goto(BASE);
  await page.fill('#lockPw', PASSWORD); await page.click('#lockGo');
  await page.waitForSelector('#tokenIn:visible, #appView:not([hidden])');
  if (await page.isVisible('#tokenIn')) { await page.fill('#tokenIn', 'github_pat_test_token_for_mock'); await page.click('#tokenGo'); }
  await page.waitForSelector('.firm');
  await page.waitForFunction(() => document.querySelector('#syncTimes')?.textContent.includes('Next'));
  await page.waitForTimeout(400);
  return { ctx, page };
}
const shot = async (page, name) => { if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: !/^(whatsnew|bell|rowmenu)/.test(name) }); } };   // fixed panels: the viewport
// WCAG AA: every visible text element on screen against its nearest opaque background (4.5:1; 3:1 for large text).
const contrastFailures = page => page.evaluate(() => {
  const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c; } return rgb(getComputedStyle(document.body).backgroundColor); };
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    if (!['SVG', 'svg', 'path', 'INPUT', 'SELECT', 'OPTION'].includes(el.tagName) && ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.6 || el.closest('[disabled]')) continue;
    const a = lum(rgb(cs.color)), b = lum(bgOf(el)), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(cs.fontSize), large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) out.push(`${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)}`);
  }
  return [...new Set(out)].slice(0, 12);
});
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

try {
  // ---------------- list, top bar, bell, What's new (desktop dark) ----------------
  const G = createMockGitHub({ root: ROOT });
  let { ctx, page } = await openPage(G);
  const rows = await page.$$eval('.firm', els => els.length);
  check(rows === 5, `firm list shows the 5 firms (got ${rows})`);
  const strip = await page.textContent('#statStrip');
  check(/5 firms/i.test(strip) && /leads · 90 days/i.test(strip) && /outside a pipeline/i.test(strip), `stat strip: ${strip.replace(/\s+/g, ' ')}`);
  const mahdavi = await page.textContent('.firm[data-slug="mahdavi"]');
  check(/Token: Private Integration/.test(mahdavi) && /GHL:/.test(mahdavi) && /last 90 days/.test(mahdavi) && /Updated/.test(mahdavi), 'Mahdavi row keeps token, GHL name, leads, last updated');
  check(/Token: App/.test(await page.textContent('.firm[data-slug="zz-test-2"]')), 'ZZ TEST 2 shows Token: App');
  check(/Sync every 30 min/i.test(await page.textContent('#syncInfo')), `sync info: ${(await page.textContent('#syncInfo')).replace(/\s+/g, ' ')}`);
  await shot(page, 'list_1440_dark');

  for (const [f, expect] of [['app', ['zz-test-2']], ['pi', ['mahdavi', 'lfmp', 'hedayati-law-group-p-c', 'emery-law-office']], ['tests', ['zz-test-2']]]) {
    await page.click(`[data-filter="${f}"]`);
    const got = await page.$$eval('.firm', els => els.map(e => e.dataset.slug));
    check(JSON.stringify(got) === JSON.stringify(expect), `filter ${f}: ${got.join(', ')}`);
  }
  await page.click('[data-filter="attention"]');
  check(await page.$$eval('.firm', els => els.length) >= 0, 'filter Needs attention renders');
  await page.click('[data-filter="all"]');
  await page.fill('#firmSearch', 'emery');
  check(JSON.stringify(await page.$$eval('.firm', els => els.map(e => e.dataset.slug))) === '["emery-law-office"]', 'search by name');
  await page.fill('#firmSearch', 'hedayati-law');
  check(await page.$$eval('.firm', els => els.length) === 1, 'search by slug');
  await page.fill('#firmSearch', 'nothing-matches-this');
  check(await page.isVisible('[data-clear-filter]'), 'empty search shows "Show all firms"');
  await page.click('[data-clear-filter]');
  check(await page.$$eval('.firm', els => els.length) === 5, 'Show all firms clears the search');

  // ⋯ menu on a row: opens, Esc closes, Banner commits only config.json
  await page.click('.firm[data-slug="emery-law-office"] [data-menu]');
  check(await page.isVisible('#m-emery-law-office'), 'row ⋯ menu opens');
  await page.keyboard.press('Escape');
  check(!(await page.isVisible('#m-emery-law-office')), 'Esc closes the row menu');
  const before = await G.fileText('firms/emery-law-office/config.json');
  await page.click('.firm[data-slug="emery-law-office"] [data-menu]');
  await page.click('#m-emery-law-office [data-f="banner"]');
  await page.waitForFunction(() => /Saved/.test(document.querySelector('.firm[data-slug="emery-law-office"] .fstatus')?.textContent || ''));
  const bc = G.M.commits.at(-1);
  check(bc && bc.files.length === 1 && bc.files[0].path === 'firms/emery-law-office/config.json', `Banner: one commit of config.json only (${bc?.message})`);
  const cfgA = JSON.parse(before), cfgB = JSON.parse(bc.files[0].content);
  delete cfgA.notice; delete cfgB.notice;
  check(JSON.stringify(cfgA) === JSON.stringify(cfgB), 'Banner changed only notice.show');
  G.M.overlay.delete('firms/emery-law-office/config.json');   // back to the real file

  // Delete keeps type-to-confirm (cancelled)
  await page.click('.firm[data-slug="emery-law-office"] [data-menu]');
  await page.click('#m-emery-law-office [data-f="delete"]');
  await page.click('#dlgOk');
  check(/Type emery-law-office exactly/.test(await page.textContent('#dlgErr')), 'Delete needs the slug typed');
  await page.keyboard.press('Escape');
  check(await page.isHidden('#ovl'), 'Esc closes the dialog');
  check(G.M.secretDeletes.length === 0, 'nothing deleted');

  // Top-bar ⋯ menu
  await page.click('[data-menu="topMenu"]');
  check(await page.isVisible('#topMenu [data-act="lock"]') && await page.isVisible('#topMenu [data-act="forget"]'), 'top ⋯ has Forget token and Lock');
  await page.keyboard.press('Escape');
  check(await page.isHidden('#topMenu'), 'Esc closes the top menu');

  // Bell
  await page.click('#bellBtn');
  check(await page.isVisible('#nPanel'), 'bell panel opens');
  await shot(page, 'bell_1440_dark');
  await page.keyboard.press('Escape');
  check(await page.isHidden('#nPanel'), 'Esc closes the bell panel');

  // What's new
  check(await page.isVisible('#newsDot'), 'version chip shows the gold dot (unseen)');
  await page.click('#newsBtn');
  await page.waitForSelector('.vcard');
  const cards = await page.$$eval('.vcard', els => els.map(e => ({ open: e.open, v: e.querySelector('.vt b').textContent })));
  check(cards[0].open && cards.slice(1).every(c => !c.open), 'newest card open, older collapsed');
  check(await page.isVisible('.vcard .pill'), 'Latest pill');
  check(await page.$$eval('.vcard[open] .tag.tg-new, .vcard[open] .tag.tg-improved, .vcard[open] .tag.tg-fixed', els => els.length) > 0, 'NEW / IMPROVED / FIXED bullets');
  await page.click('.vcard[open] [data-tech]');
  check(await page.isVisible('.vcard[open] .tech'), 'Technical details shows the developer text');
  await shot(page, 'whatsnew_1440_dark');
  await page.click('[data-news-filter="client"]');
  const clientCards = await page.$$eval('.vcard', els => els.map(e => e.querySelector('.vt b').textContent));
  check(clientCards.length > 0 && await page.$$eval('.vbody .who', els => els.every(e => e.textContent === 'client')), `Client filter: ${clientCards.length} versions, client items only`);
  await page.click('[data-news-filter="all"]');
  await page.keyboard.press('Escape');
  check(await page.isHidden('#newsPanel'), 'Esc closes What\'s new');
  check(await page.isHidden('#newsDot'), 'dot cleared after opening');

  // Theme switch
  await page.click('[data-theme-set="light"]');
  check(await page.evaluate(() => document.documentElement.dataset.theme === 'light' && localStorage.getItem('lfmp-theme') === 'light'), 'Light: data-theme + saved lfmp-theme');
  await page.reload(); await page.fill('#lockPw', PASSWORD); await page.click('#lockGo'); await page.waitForSelector('.firm');
  check(await page.evaluate(() => document.documentElement.dataset.theme === 'light'), 'Light remembered after reload');
  await page.click('[data-theme-set="auto"]');
  check(await page.evaluate(() => !document.documentElement.hasAttribute('data-theme') && localStorage.getItem('lfmp-theme') === null), 'Auto: follows the system, nothing saved');

  // ---------------- New firm: both options; app path ----------------
  await page.click('#newFirmBtn');
  await page.waitForSelector('#nfForm');
  await page.waitForFunction(() => document.querySelector('#nfPreset option')?.textContent.includes('ACME'));
  check(await page.isChecked('input[name="nfMode"][value="app"]'), 'Use the LeadPro app is the default');
  check(await page.isHidden('#nfTok'), 'app option: no token field');
  await shot(page, 'newfirm_app_1440_dark');
  await page.check('input[name="nfMode"][value="pi"]');
  check(await page.isVisible('#nfTok') && await page.$$eval('.scopelist li', l => l.length) === 9, 'PI option: token field + 9 scopes');
  check(await page.$$eval('[data-copy-scope]', l => l.length) === 9, 'PI option: 9 copy buttons');
  await shot(page, 'newfirm_pi_1440_dark');
  await page.check('input[name="nfMode"][value="app"]');

  // existing location refused before anything is written
  await page.fill('#nfName', 'Emery Again');
  await page.fill('#nfLoc', 'l68l8TvqZyERd5q1zdlj');
  await page.click('#nfCreate');
  check(/already has a firm: Emery Law Office/.test(await page.textContent('#nfErr')), 'location with a firm refused');
  check(G.M.secretPuts.length === 0 && G.M.dispatches.length === 0, 'refusal wrote nothing');

  // app missing → plain error; Retry → done
  G.M.scenario = 'app-missing';
  await page.fill('#nfName', 'Smith & Jones Law');
  await page.fill('#nfLoc', 'TestLoc000000000001');
  const pass = await page.inputValue('#nfPass');
  await page.dblclick('#nfCreate');
  await page.waitForSelector('#appSteps .step.fail', { timeout: 60000 });
  const err = await page.textContent('#appSteps .step.fail .errbox');
  check(/LeadPro Connector app isn't on this sub-account/.test(err) && !/Error:|undefined|stack/.test(err), `app missing → plain error at "${await page.textContent('#appSteps .step.fail .t')}": ${err}`);
  check(G.M.dispatches.filter(d => d.workflow === 'new-firm.yml').length === 1, 'double click → one dispatch');
  check(G.M.secretPuts.length === 1 && G.M.secretPuts[0].name === 'PASSPHRASE_SMITH_AND_JONES_LAW' && unseal(G.M.secretPuts[0].value) === pass, 'one passphrase secret, sealed, the one in the form');
  await shot(page, 'newfirm_app_error_1440_dark');
  G.M.scenario = 'ok';
  await page.click('#appRetry');
  await page.waitForSelector('.success', { timeout: 90000 });
  check(G.M.dispatches.filter(d => d.workflow === 'new-firm.yml').length === 2, 'Retry → started the setup once more');
  check(G.M.secretPuts.length === 1, 'Retry kept the passphrase (not made again)');
  const di = G.M.dispatches.filter(d => d.workflow === 'new-firm.yml').map(d => d.inputs);
  check(di.every(i => JSON.stringify(Object.keys(i).sort()) === '["location","name","practice_area","request","slug","snapshot_id","timezone"]') && !JSON.stringify(di).includes(pass), 'dispatch inputs: the builder\'s non-secret set, no passphrase');
  check(di[0].snapshot_id === '2wuNIU3FfXTzuQKGjNw5', 'ACME preset snapshot passed');
  const idx = JSON.parse(await G.fileText('firms/index.json'));
  check(idx.filter(f => f.locationId === 'TestLoc000000000001').length === 1, 'one firm in the list');
  await shot(page, 'newfirm_app_done_1440_dark');
  const runText = await page.textContent('#runHost');
  check(!runText.includes(pass), 'the passphrase is not shown in the progress text');
  await page.click('#toList');
  await page.waitForSelector('.firm[data-slug="smith-and-jones-law"]');
  check(/Token: App/.test(await page.textContent('.firm[data-slug="smith-and-jones-law"]')), 'new firm listed with Token: App');

  // ---------------- Edit mapping ----------------
  const cfgBefore = await G.fileText('firms/mahdavi/config.json');
  await page.click('.firm[data-slug="mahdavi"] [data-f="map"]:visible');
  await page.waitForSelector('.opt');
  check(await page.isVisible('#emSave') && await page.isEnabled('#emSave'), 'Save mapping at the top');
  const chip = await page.$eval('.opt[aria-pressed="true"]', e => ({ text: e.textContent, full: e.dataset.stage }));
  check(chip.text.length <= chip.full.length, `stage chip "${chip.text}" (full name kept: "${chip.full}")`);
  await shot(page, 'editmapping_1440_dark');
  await page.click('#emSave');
  if (/anyway/i.test(await page.textContent('#emSave'))) {     // Mahdavi hides the consult steps, so the page warns once first
    check(/No stage picked for/.test(await page.textContent('#emWarn')), 'empty steps warn before saving (shown at the top)');
    await page.click('#emSave');
  }
  await page.waitForFunction(() => /Saved the mapping/.test(document.querySelector('.okmsg')?.textContent || ''), null, { timeout: 60000 });
  const mc = G.M.commits.find(c => /stage mapping for The Mahdavi/.test(c.message));
  check(mc && mc.files.length === 1 && mc.files[0].content === cfgBefore, 'unchanged save writes config.json byte-identical');
  G.M.overlay.delete('firms/mahdavi/config.json');
  await ctx.close();

  // ---------------- screenshots: light 1440, both themes at 390 ----------------
  for (const [w, h, scheme] of [[1440, 900, 'dark'], [1440, 900, 'light'], [390, 844, 'dark'], [390, 844, 'light']]) {
    const G2 = createMockGitHub({ root: ROOT });
    ({ ctx, page } = await openPage(G2, { width: w, height: h, scheme }));
    const tag = `${w}_${scheme}`;
    check(await noSideScroll(page), `${tag}: list has no sideways scroll`);
    let cf = await contrastFailures(page); check(!cf.length, `${tag}: list text passes AA contrast${cf.length ? `: ${cf.join(' | ')}` : ''}`);
    await shot(page, `list_${tag}`);
    if (w === 390) {
      check(await page.isHidden('.firm[data-slug="mahdavi"] .wide-only[data-f="sync"]'), '390: row shows Open dashboard + ⋯ only');
      await page.click('.firm[data-slug="mahdavi"] [data-menu]');
      check(await page.isVisible('#m-mahdavi [data-f="sync"]') && await page.isVisible('#m-mahdavi [data-f="delete"]'), '390: ⋯ holds Copy GHL link, Re-sync, Edit mapping, Banner, Delete');
      await shot(page, `rowmenu_${tag}`);
      await page.keyboard.press('Escape');
    }
    await page.click('#newsBtn'); await page.waitForSelector('.vcard');
    cf = await contrastFailures(page); check(!cf.length, `${tag}: What's new passes AA contrast${cf.length ? `: ${cf.join(' | ')}` : ''}`);
    await shot(page, `whatsnew_${tag}`);
    check(await noSideScroll(page), `${tag}: What's new has no sideways scroll`);
    await page.keyboard.press('Escape');
    await page.click('#newFirmBtn'); await page.waitForSelector('#nfForm');
    await page.waitForFunction(() => document.querySelector('#nfPreset option')?.textContent.includes('ACME'));
    check(await noSideScroll(page), `${tag}: New firm has no sideways scroll`);
    cf = await contrastFailures(page); check(!cf.length, `${tag}: New firm passes AA contrast${cf.length ? `: ${cf.join(' | ')}` : ''}`);
    await shot(page, `newfirm_app_${tag}`);
    await page.check('input[name="nfMode"][value="pi"]');
    await shot(page, `newfirm_pi_${tag}`);
    check(await noSideScroll(page), `${tag}: New firm (Private Integration) has no sideways scroll`);
    await page.click('#backBtn'); await page.waitForSelector('.firm');
    await page.click('.firm[data-slug="zz-test-2"] [data-menu]');
    if (w === 390) await page.click('#m-zz-test-2 [data-f="map"]'); else { await page.keyboard.press('Escape'); await page.click('.firm[data-slug="zz-test-2"] .wide-only[data-f="map"]'); }
    await page.waitForSelector('.opt');
    check(await noSideScroll(page), `${tag}: Edit mapping has no sideways scroll`);
    cf = await contrastFailures(page); check(!cf.length, `${tag}: Edit mapping passes AA contrast${cf.length ? `: ${cf.join(' | ')}` : ''}`);
    await shot(page, `editmapping_${tag}`);
    await ctx.close();
  }
} catch (e) { failed++; console.log(`✗ ${e.stack || e.message}`); }
finally { await browser.close(); server.close(); }
console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nAll ${passed} admin UI checks passed`);
process.exitCode = failed ? 1 : 0;
