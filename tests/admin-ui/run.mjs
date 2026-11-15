// Admin page in a real browser against a mock GitHub.   Run:  node tests/admin-ui/run.mjs [screenshot-folder]
//
// Needs playwright-core and its Chromium (not a dependency of this repo): set PLAYWRIGHT_CORE to its folder, or keep the
// Sub-account Builder repo next to this one (../ghl-subaccount-builder/node_modules/playwright-core). Without it, this suite is skipped.
// Serves the repo folder locally, mocks api.github.com (tests/admin-ui/mock-github.mjs), lock.json and libsodium. Writes nothing in the repo.
//
// Checks (v1.13): unlock + token; moving between screens never asks for the password again (New firm → All firms, Edit mapping
// → All firms, the browser Back / Forward buttons, a reload), Lock and 30 minutes idle do; the simple home (strip, All / Needs
// attention, Show test firms, search, a row = name, status + reason link, leads, Dashboard ↗ + Details →, row click); the Details
// panel (Overview / Performance / Setup, hash links, Esc and ✕, every old row field and button reachable, not-in-pipeline names
// decrypted in the browser from a saved or typed passphrase, Banner commit, Delete type-to-confirm); the top bar, bell and
// What's new; New firm (both options; app path: refusal, app missing → plain error, Retry, one dispatch per try, one passphrase,
// nothing secret in inputs); Edit mapping (chips, Save at the top, unchanged save byte-identical); no contact names or IDs in
// anything written; AA contrast and no sideways scroll at 390 px; screenshots at 1440 + 390, light + dark.

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { createMockGitHub } from './mock-github.mjs';
import { encryptJSON } from '../../scripts/kpi-core.mjs';

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

// The newest version in CHANGELOG.md (What's new opens that card).
const LATEST = (await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8')).match(/^## v(\d+\.\d+\.\d+)/m)[1];
// LFMP's real 90-day lead count changes with every sync: read it from the repo instead of hard-coding it.
const LFMP_LEADS90 = JSON.parse(await readFile(join(ROOT, 'firms/lfmp/data/kpis.json'), 'utf8')).periods.last90.current.totalLeads;

// Fixture for "lead not in a pipeline": LFMP's encrypted details, made here with a test passphrase (the real file stays untouched).
const NIP_PASS = 'fixture-passphrase-lfmp';
const NIP = [{ contactId: 'cFixture0001', name: 'Jordan Fixture', email: 'jordan@example.test', phone: '+15550000001', createdAt: new Date(Date.now() - 3 * 864e5).toISOString(), via: 'Chat widget' },
  { contactId: 'cFixture0002', name: 'Unnamed', email: 'noname@example.test', phone: '+15550000002', createdAt: new Date(Date.now() - 5 * 864e5).toISOString(), via: 'Texted in' },
  { contactId: 'cFixtureOld9', name: 'Old Fixture', email: null, phone: null, createdAt: new Date(Date.now() - 60 * 864e5).toISOString(), via: 'Form' }];
const NIP_ENV = JSON.stringify(await encryptJSON({ generatedAt: new Date().toISOString(), notInPipeline: NIP, leads: [] }, NIP_PASS, 1000));

const server = createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^\/+/, '');
  const f = join(ROOT, p.endsWith('/') || p === '' ? `${p}index.html` : p);
  try { const b = await readFile(f); res.writeHead(200, { 'Content-Type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const BASE = `${ORIGIN}/admin/?repo=peejayedz/leadpro-kpi`;

let failed = 0, passed = 0;
const check = (v, what) => { if (v) { passed++; console.log(`✓ ${what}`); } else { failed++; console.log(`✗ ${what}`); } };
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

// LFMP gets 2 "not in a pipeline" contacts in the last 30 days (as in the live data) whatever the repo files say.
async function withNip(G) {
  const k = JSON.parse(await G.fileText('firms/lfmp/data/kpis.json'));
  k.periods.last30.current.notInPipeline = 2;
  G.M.overlay.set('firms/lfmp/data/kpis.json', JSON.stringify(k, null, 2) + '\n');
  return G;
}
async function wire(page, G) {
  page.on('pageerror', e => { failed++; console.log(`✗ page error: ${e.message}`); });
  // The libsodium stub can't match the real file's SRI hash: drop the integrity attribute for cdnjs in this test only.
  await page.addInitScript(() => { const d = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'integrity'); Object.defineProperty(HTMLScriptElement.prototype, 'integrity', { set(v) { if (!String(this.src).includes('cdnjs.cloudflare.com')) d.set.call(this, v); }, get() { return d.get.call(this); } }); });
  await page.route('**/admin/lock.json*', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(LOCK) }));
  await page.route('**/admin/lfmp-lock.json*', r => r.fulfill({ status: 404, body: 'not found' }));   // this suite tests the page's own lock (one login: tests/one-login + builder tests/e2e/one-login.mjs)
  await page.route('**/firms/lfmp/data/details.enc.json*', r => r.fulfill({ contentType: 'application/json', body: NIP_ENV }));
  await page.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'text/javascript', body: SODIUM_STUB }));
  await page.route('https://api.github.com/**', async r => {
    const q = r.request();
    const { status, json } = await G.handle(q.method(), q.url(), q.postData());
    await r.fulfill({ status, contentType: 'application/json', body: json === null ? '' : JSON.stringify(json) });
  });
}
const unlocked = page => page.waitForFunction(() => !document.getElementById('appView').hidden && document.querySelector('#syncTimes')?.textContent.includes('Next'));
async function unlock(page) {
  await page.waitForSelector('#lockPw:visible');
  await page.fill('#lockPw', PASSWORD); await page.click('#lockGo');
  await page.waitForSelector('#tokenIn:visible, #appView:not([hidden])');
  if (await page.isVisible('#tokenIn')) { await page.fill('#tokenIn', 'github_pat_test_token_for_mock'); await page.click('#tokenGo'); }
  await unlocked(page);
}
async function openPage(G, { width = 1440, height = 900, scheme = 'dark', hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await wire(page, G);
  await page.goto(BASE + hash);
  await unlock(page);
  if (!hash || hash === '#/') await page.waitForSelector('.firm');
  await page.waitForTimeout(400);
  return { ctx, page };
}
const shot = async (page, name, full = !/^(whatsnew|bell|details|perf|setup)/.test(name)) => { if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: full }); } };
// WCAG AA: every visible text element on screen against its nearest opaque background (4.5:1; 3:1 for large text).
const contrastFailures = (page, root = 'body') => page.evaluate(root => {
  const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c; } return rgb(getComputedStyle(document.body).backgroundColor); };
  const out = [];
  for (const el of document.querySelectorAll(`${root} *`)) {
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') continue;
    if (!['SVG', 'svg', 'path', 'INPUT', 'SELECT', 'OPTION'].includes(el.tagName) && ![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.6 || el.closest('[disabled]')) continue;
    const a = lum(rgb(cs.color)), b = lum(bgOf(el)), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(cs.fontSize), large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) out.push(`${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)}`);
  }
  return [...new Set(out)].slice(0, 12);
}, root);
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const slugs = page => page.$$eval('.firm', els => els.map(e => e.dataset.slug));
const lockShown = page => page.isVisible('#lockView');
const hashIs = page => page.evaluate(() => location.hash);
const panelOpen = page => page.isVisible('#dPanel');

try {
  const G = await withNip(createMockGitHub({ root: ROOT }));
  let { ctx, page } = await openPage(G);

  // ---------------- home ----------------
  check(JSON.stringify(await slugs(page)) === '["mahdavi","lfmp","hedayati-law-group-p-c","emery-law-office"]', `home: the 4 firms, test firms hidden (${(await slugs(page)).join(', ')})`);
  const strip = (await page.textContent('#statStrip')).replace(/\s+/g, ' ');
  check(/4 firms/i.test(strip) && /(All synced \d|sync problem)/i.test(strip) && /needs attention/i.test(strip) && !/leads · 90/i.test(strip) && !/outside a pipeline/i.test(strip), `strip: ${strip}`);
  check(JSON.stringify(await page.$$eval('#firmFilters [data-filter]', b => b.map(x => x.dataset.filter))) === '["all","attention"]', 'filters: All · Needs attention only');
  const lf = (await page.textContent('.firm[data-slug="lfmp"]')).replace(/\s+/g, ' ');
  check(/Needs attention/.test(lf) && /2 leads not in a pipeline/.test(lf) && new RegExp(`(^|\\D)${LFMP_LEADS90}\\s*leads · 90 days`).test(lf) && /leads · 90 days/.test(lf), `LFMP row: needs attention + reason + leads (${lf.slice(0, 120)})`);
  check(await page.$eval('.firm[data-slug="lfmp"] [data-details]:not(.reason)', e => e.classList.contains('p')) && !(await page.$eval('.firm[data-slug="mahdavi"] [data-details]', e => e.classList.contains('p'))), 'Details is gold only on the firm that needs attention');
  check(/OK/.test(await page.textContent('.firm[data-slug="mahdavi"] .fstate')) && /Synced/.test(await page.textContent('.firm[data-slug="mahdavi"] .fstate')), 'Mahdavi: OK · Synced <time>');
  check(await page.$$eval('.firm[data-slug="mahdavi"] .acts .btn', b => b.map(x => x.textContent.trim().replace(/\s+/g, ' ')).join('|')) === 'Dashboard ↗|Details', 'row has two buttons: Dashboard ↗ and Details →');
  await shot(page, 'list_1440_dark_main');
  await page.check('#showTests');
  check((await slugs(page)).includes('zz-test-2') && /5 firms/.test(await page.textContent('#statStrip')), 'Show test firms adds ZZ TEST 2');
  await page.reload(); await unlocked(page); await page.waitForSelector('.firm');
  check(!(await lockShown(page)) && (await slugs(page)).includes('zz-test-2'), 'reload: still unlocked, Show test firms remembered');
  await page.uncheck('#showTests');
  await page.click('[data-filter-att]');
  check(await page.getAttribute('[data-filter="attention"]', 'aria-pressed') === 'true' && (await slugs(page)).includes('lfmp') && !(await slugs(page)).includes('mahdavi'), `"needs attention →" in the strip sets the filter (${(await slugs(page)).join(', ')})`);
  await page.click('[data-filter="all"]');
  await page.fill('#firmSearch', 'emery');
  check(JSON.stringify(await slugs(page)) === '["emery-law-office"]', 'search by name');
  await page.fill('#firmSearch', 'hedayati-law');
  check((await slugs(page)).length === 1, 'search by slug');
  await page.fill('#firmSearch', 'nothing-matches-this');
  check(await page.isVisible('[data-clear-filter]'), 'empty search shows "Show all firms"');
  await page.click('[data-clear-filter]');
  check((await slugs(page)).length === 4, 'Show all firms clears the search');

  // ---------------- Details: Overview ----------------
  await page.click('.firm[data-slug="lfmp"] .reason');
  await page.waitForSelector('#dPanel:not([hidden]) .dpbody');
  check(await hashIs(page) === '#/firm/lfmp', `reason link opens Details with a hash (${await hashIs(page)})`);
  const head = (await page.textContent('#dPanel .dphead')).replace(/\s+/g, ' ');
  check(/Law Firm Marketing Pros/i.test(head) && /GHL:/.test(head), `header: name, practice area, GHL name (${head.trim()})`);
  check(await page.isVisible('#dPanel [data-reason="not-in-pipeline"]') && /2 leads not in a pipeline/.test(await page.textContent('#dPanel .abox')), 'needs-attention box first, with the reason');
  check(await page.isVisible('#nipPass') && await page.isVisible('#nipRemember') && !(await page.isChecked('#nipRemember')), 'no saved passphrase: unlock form with "Remember on this computer" (off by default)');
  const firstKid = await page.$eval('#nipList', el => { const k = el.firstElementChild; const a = k?.querySelector('a'); return { cls: k?.className, btn: a?.classList.contains('btn') && !a.classList.contains('p'), text: a?.textContent.trim(), beforeForm: !!(k && el.querySelector('form') && (k.compareDocumentPosition(el.querySelector('form')) & 4)) }; });
  check(firstKid.btn && firstKid.text === 'Open Contacts in GHL ↗' && firstKid.beforeForm, `"Open Contacts in GHL ↗" is an outlined button, first, before the passphrase box (${JSON.stringify(firstKid)})`);
  check(/Remember on this computer/.test(await page.textContent('#nipList .nipform')), 'Remember checkbox sits with Unlock');
  await page.fill('#nipPass', 'wrong passphrase'); await page.press('#nipPass', 'Enter');
  await page.waitForFunction(() => /didn't work/.test(document.querySelector('#nipList')?.textContent || ''));
  check(true, 'wrong passphrase → plain error');
  await page.fill('#nipPass', NIP_PASS); await page.press('#nipPass', 'Enter');
  await page.waitForSelector('#nipList .nip li');
  const nipRows = await page.$$eval('#nipList .nip li', l => l.map(x => ({ name: x.querySelector('.nname')?.textContent, t: x.textContent.replace(/\s+/g, ' '), href: x.querySelector('a.nopen')?.href })));
  const URL1 = 'https://app.lawfirmmarketingpros.com/v2/location/sQ2VSMkR7cLHb46Wdemi/contacts/detail/';
  check(nipRows.length === 2 && nipRows[0].name === 'Jordan Fixture' && /jordan@example\.test/.test(nipRows[0].t) && /\+15550000001/.test(nipRows[0].t) && /Chat/.test(nipRows[0].t) && nipRows[0].href === `${URL1}cFixture0001`, `row: name, email, phone, source, date, Open in GHL ↗ (${nipRows[0]?.t?.trim()} → ${nipRows[0]?.href})`);
  check(nipRows[1].name === 'noname@example.test' && /\(no name\)/.test(nipRows[1].t) && /\+15550000002/.test(nipRows[1].t) && /Text/.test(nipRows[1].t) && !/Unknown|Unnamed/.test(nipRows[1].t) && nipRows[1].href === `${URL1}cFixture0002`, `no name: the email stands in, never "Unknown" (${nipRows[1]?.t?.trim()})`);
  check(await page.isVisible('#nipList > .nipopen a.btn'), 'after unlock: Open Contacts in GHL ↗ still first, each row has its own Open in GHL ↗');
  check(await page.evaluate(() => !JSON.stringify(localStorage).includes('Jordan') && !JSON.stringify(sessionStorage).includes('Jordan') && !JSON.stringify(localStorage).includes('example.test') && !JSON.stringify(localStorage).includes('fixture-passphrase') && localStorage.getItem('leadpro-admin-firm-pass') === null), 'not remembered: nothing about the contacts or the passphrase saved in the browser');
  await shot(page, 'details_overview_names_1440_dark');
  await shot(page, 'details_overview_1440_dark');
  const ov = (await page.innerText('#dPanel')).replace(/\s+/g, ' ');
  for (const [what, re] of [['Status + last update', /Status OK|Status Holding|Status Last sync/], ['Leads (90 days)', new RegExp(`Leads ${LFMP_LEADS90} in the last 90 days`)], ['Not in a pipeline (30 days)', /Not in a pipeline 2 new contacts · 30 days/], ['Slug', /Slug lfmp/], ['Connection', /Connection Private Integration token/], ['Banner', /Banner (On|Off)/]])
    check(new RegExp(re.source, 'i').test(ov), `Overview info: ${what}`);
  const acts = await page.$$eval('#dPanel .dpacts > *', b => b.map(x => `${x.textContent.trim()}${x.classList.contains('p') ? ' (gold)' : ''}`));
  check(JSON.stringify(acts) === JSON.stringify(['Open dashboard ↗ (gold)', 'Re-sync', 'Edit mapping']), `Overview actions: Open dashboard ↗ (gold), Re-sync, Edit mapping (${acts.join(' · ')})`);
  await page.keyboard.press('Escape');
  check(!(await panelOpen(page)) && await hashIs(page) === '#/', 'Esc closes Details and the hash');
  await page.click('.firm[data-slug="mahdavi"] .fname');
  await page.waitForSelector('#dPanel:not([hidden])');
  check(await hashIs(page) === '#/firm/mahdavi', 'clicking a row opens Details');
  check(/Nothing needs attention/.test(await page.textContent('#dPanel')), 'OK firm: no attention box');
  await page.click('[data-dp-close]');
  check(!(await panelOpen(page)), '✕ closes Details');
  await page.goBack(); await page.waitForSelector('#dPanel:not([hidden])');
  check(!(await lockShown(page)) && await hashIs(page) === '#/firm/mahdavi', 'Back reopens the Details (no password)');
  await page.goBack(); await page.waitForFunction(() => document.getElementById('dPanel').hidden);
  check(!(await lockShown(page)), 'Back again: firm list, still unlocked');

  // ---------------- Details: Setup (Copy GHL menu link lives here since v1.13.1) ----------------
  await page.click('.firm[data-slug="emery-law-office"] [data-details]');
  await page.waitForSelector('#dPanel:not([hidden])');
  check(!(await page.$('#dPanel [data-f="link"]')), 'Overview has no copy-link button');
  await page.click('[data-dp-tab="performance"]'); await page.waitForSelector('#dPanel .tiles, #dPanel .perfhead');
  check(!(await page.$('#dPanel [data-f="link"]')), 'Performance has no copy-link button');
  await page.click('[data-dp-tab="setup"]');
  await page.waitForSelector('#dPanel .dset');
  check(await hashIs(page) === '#/firm/emery-law-office/setup', 'Setup tab has its own hash');
  const st = (await page.innerText('#dPanel')).replace(/\s+/g, ' ');
  check(/Stage mapping/i.test(st) && /Location ID l68l8TvqZyERd5q1zdlj/i.test(st) && /GHL_TOKEN_EMERY_LAW_OFFICE/.test(st) && /Update token/i.test(st) && /Testing banner/i.test(st) && /Delete firm/i.test(st), 'Setup: mapping, connection (location, secrets, Update token), banner, delete');
  const secs = await page.$$eval('#dPanel .dset .lbl', h => h.map(x => x.textContent.trim()));
  const mi = secs.findIndex(s => /GHL menu link/i.test(s));
  check(mi > 0 && /Connection/i.test(secs[mi - 1]) && /Testing banner/i.test(secs[mi + 1]), `Setup: "GHL menu link" between Connection and Testing banner (${secs.join(' · ')})`);
  check(/The scorecard link to paste into the sub-account's Custom Menu Link\./.test(await page.textContent('#dPanel [data-sec="menu-link"]')) && /^Copy GHL menu link$/.test((await page.textContent('#dPanel [data-sec="menu-link"] [data-f="link"]')).trim()), 'Setup: "Copy GHL menu link" + helper line');
  check(!/Copy GHL link\b/.test(await page.content()), 'old name "Copy GHL link" is gone');
  await page.click('#dPanel [data-sec="menu-link"] [data-f="link"]');
  check(/Custom Menu Link/.test(await page.textContent('#dlg')) && /Copy GHL menu link/.test(await page.textContent('#dlg h3')), 'dialog: Copy GHL menu link, with the helper wording');
  await page.fill('#dlgPass', 'some-pass phrase#1'); await page.click('#dlgOk');
  check(/#k=some-pass%20phrase%231$/.test(await page.evaluate(() => navigator.clipboard.readText())), 'Copy GHL menu link: URL-encoded passphrase on the clipboard');
  check(await page.isVisible('#dPanel [data-sec="menu-link"] [data-f="link"] + .copied') && /Copied/.test(await page.textContent('#dPanel [data-sec="menu-link"] .copied')), '"Copied" shows right next to the clicked button');
  check(!/Copied/.test(await page.textContent('#dPanel .dpmsg')) && !/Copied/.test(await page.textContent('.firm[data-slug="emery-law-office"] .fstatus')), '"Copied" is not in the message line or on the firm row');
  { const cfc = await contrastFailures(page, '#dPanel [data-sec="menu-link"]'); check(!cfc.length, `"Copied" passes AA contrast${cfc.length ? `: ${cfc.join(' | ')}` : ''}`); }
  await shot(page, 'setup_copied_1440_dark');
  await page.waitForFunction(() => !document.querySelector('#dPanel .copied'), null, { timeout: 7000 });
  check(true, '"Copied" goes away after a few seconds');
  await shot(page, 'setup_1440_dark');
  const before = await G.fileText('firms/emery-law-office/config.json');
  await page.click('#dPanel [data-f="banner"]');
  await page.waitForFunction(() => /Saved/.test(document.querySelector('#dPanel .dpmsg')?.textContent || ''));
  const bc = G.M.commits.at(-1);
  check(bc && bc.files.length === 1 && bc.files[0].path === 'firms/emery-law-office/config.json', `Banner: one commit of config.json only (${bc?.message})`);
  const cfgA = JSON.parse(before), cfgB = JSON.parse(bc.files[0].content);
  delete cfgA.notice; delete cfgB.notice;
  check(JSON.stringify(cfgA) === JSON.stringify(cfgB), 'Banner changed only notice.show');
  check(/Banner (on|off) · turn/.test(await page.textContent('#dPanel [data-f="banner"]')), 'Banner button repainted');
  G.M.overlay.delete('firms/emery-law-office/config.json');
  await page.click('#dPanel [data-f="delete"]');
  await page.click('#dlgOk');
  check(/Type emery-law-office exactly/.test(await page.textContent('#dlgErr')), 'Delete needs the slug typed');
  await page.keyboard.press('Escape');
  check(await page.isHidden('#ovl') && await panelOpen(page), 'Esc closes the dialog first, Details stays');
  check(G.M.secretDeletes.length === 0, 'nothing deleted');
  check(await page.isVisible('#dPanel [data-f="token"]'), 'Private Integration firm: Update token in Setup');

  // ---------------- Details: Performance (hash link, same numbers as kpis.json) ----------------
  await page.goto(BASE + '#/firm/mahdavi/performance');
  await page.waitForSelector('#dPanel .tiles');
  check(!(await lockShown(page)), 'opening a link in this tab: no password (session)');
  const K = JSON.parse(await G.fileText('firms/mahdavi/data/kpis.json'));
  const tileVals = async () => page.$$eval('#dPanel .tile', t => t.map(x => ({ l: x.querySelector('.tl').textContent, v: x.querySelector('.tv').textContent, s: x.querySelector('.ts').textContent })));
  let tiles = await tileVals();
  const c30 = K.periods.last30.current;
  check(tiles.length === 4 && tiles[0].v === String(c30.totalLeads) && tiles[3].v === String(c30.signed), `Performance 30 days: New leads ${tiles[0].v}, Signed ${tiles[3].v} (kpis.json: ${c30.totalLeads}, ${c30.signed})`);
  check(tiles[2].l === 'Qualified', 'Mahdavi hides consult steps: third tile shows Qualified');
  const frows = await page.$$eval('#dPanel .frow', r => r.map(x => [x.querySelector('.fl').textContent, Number(x.querySelector('.fv').textContent)]));
  check(JSON.stringify(frows) === JSON.stringify(c30.funnel.map(r => [r[0], r[1]])), `funnel = kpis.json funnel (${frows.map(r => r.join(' ')).join(', ')})`);
  check(await page.isVisible('#dPanel .gw .good') && await page.isVisible('#dPanel .gw .bad'), 'Going well / Needs attention');
  check(await page.isVisible('#dPanel .dpacts a.btn.p') && /Open full client dashboard/.test(await page.textContent('#dPanel .dpacts')), 'Open full client dashboard ↗');
  await shot(page, 'perf_1440_dark');
  await page.click('[data-perf="last7"]');
  tiles = await tileVals();
  check(tiles[0].v === String(K.periods.last7.current.totalLeads) && /vs prior 7 days/.test(tiles[0].s), `7 days: ${tiles[0].v} ${tiles[0].s}`);
  await page.click('[data-perf="last90"]');
  check((await tileVals())[0].v === String(K.periods.last90.current.totalLeads), '90 days');
  await page.click('[data-perf="last30"]');
  await page.click('[data-dp-tab="overview"]');
  check(await hashIs(page) === '#/firm/mahdavi', 'Overview tab hash');

  // ---------------- no re-login: New firm / Edit mapping → All firms, Back / Forward, reload ----------------
  await page.keyboard.press('Escape');
  await page.click('#newFirmBtn'); await page.waitForSelector('#nfForm');
  check(await hashIs(page) === '#/new', 'New firm has its own hash');
  await page.click('#backBtn'); await page.waitForSelector('.firm');
  check(!(await lockShown(page)), 'New firm → All firms: no password');
  await page.click('#newFirmBtn'); await page.waitForSelector('#nfForm');
  await page.goBack(); await page.waitForSelector('.firm');
  check(!(await lockShown(page)) && !(await page.isVisible('#nfForm')), 'New firm → browser Back: firm list, no password');
  await page.goForward(); await page.waitForSelector('#nfForm');
  check(!(await lockShown(page)), 'Forward: New firm again, no password');
  await page.click('#nfCancel'); await page.waitForSelector('.firm');
  check(!(await lockShown(page)), 'Cancel: firm list, no password');
  await page.click('.firm[data-slug="hedayati-law-group-p-c"] [data-details]'); await page.waitForSelector('#dPanel:not([hidden])');
  await page.click('#dPanel .dpacts [data-f="map"]'); await page.waitForSelector('#emSave');
  check(await hashIs(page) === '#/map/hedayati-law-group-p-c' && !(await panelOpen(page)), 'Details → Edit mapping (own hash, panel closed)');
  await page.goBack(); await page.waitForSelector('#dPanel:not([hidden])');
  check(!(await lockShown(page)), 'Edit mapping → Back: Details again, no password');
  await page.click('#dPanel .dpacts [data-f="map"]'); await page.waitForSelector('#emSave');
  await page.click('#backBtn'); await page.waitForSelector('.firm');
  check(!(await lockShown(page)), 'Edit mapping → All firms: no password');
  await page.click('.top .mark'); await page.waitForSelector('.firm');
  check(!(await lockShown(page)), 'LFMP mark / KPI admin link: in-page, no password');
  await page.reload(); await page.waitForSelector('.firm');
  check(!(await lockShown(page)), 'reload: still unlocked');
  check(await page.evaluate(() => { const s = sessionStorage.getItem('leadpro-admin-session'); return !!s && !s.includes('github_pat') && !s.includes('test password'); }), 'session keeps the unlock key only (no token, no password)');
  check(await page.evaluate(() => !String(localStorage.getItem('leadpro-admin-gh-token')).includes('github_pat')), 'the GitHub token stays encrypted in localStorage');

  // saved dashboard passphrase (as the client dashboard stores it) → names show without typing
  await page.evaluate(p => localStorage.setItem('lfmp-pass-lfmp', p), NIP_PASS);
  await page.goto(BASE + '#/firm/lfmp'); await page.waitForSelector('#nipList .nip li');
  check(/Jordan Fixture/.test(await page.textContent('#nipList')) && !/Old Fixture/.test(await page.textContent('#nipList')), 'saved passphrase: list shows without typing (last 30 days only)');
  await page.evaluate(() => localStorage.removeItem('lfmp-pass-lfmp'));

  // "Remember on this computer": sealed with the admin key, names show straight away next time; idle lock keeps it
  await page.reload(); await page.waitForSelector('#nipPass');
  await page.fill('#nipPass', NIP_PASS); await page.check('#nipRemember'); await page.press('#nipPass', 'Enter');
  await page.waitForSelector('#nipList .nip li');
  const vault = await page.evaluate(() => localStorage.getItem('leadpro-admin-firm-pass'));
  check(!!vault && JSON.parse(vault).alg === 'AES-GCM' && !vault.includes(NIP_PASS) && !vault.includes('lfmp') && !/Jordan|example\.test/.test(vault), 'remembered: stored AES-GCM encrypted (no passphrase, slug or contact in the clear)');
  await page.reload(); await page.waitForSelector('#nipList .nip li');
  check(/Jordan Fixture/.test(await page.textContent('#nipList')) && !(await page.$('#nipPass')), 'remembered: names show straight away after a reload, no typing');
  await page.evaluate(() => { const s = JSON.parse(sessionStorage.getItem('leadpro-admin-session')); s.t = Date.now() - 31 * 60e3; sessionStorage.setItem('leadpro-admin-session', JSON.stringify(s)); });
  await page.reload(); await page.waitForSelector('#lockPw:visible');
  check(await page.evaluate(() => !!localStorage.getItem('leadpro-admin-firm-pass')), 'idle lock keeps the remembered passphrase (still encrypted)');
  await unlock(page); await page.goto(BASE + '#/firm/lfmp'); await page.waitForSelector('#nipList .nip li');
  check(/Jordan Fixture/.test(await page.textContent('#nipList')), 'next unlock: names show straight away');
  // a remembered passphrase that stops working (firm passphrase changed) is forgotten, with a plain message
  const goodVault = await page.evaluate(() => localStorage.getItem('leadpro-admin-firm-pass'));
  await page.route('**/firms/lfmp/data/details.enc.json*', async r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(await encryptJSON({ notInPipeline: NIP }, 'a-changed-passphrase', 1000)) }));
  await page.reload(); await page.waitForFunction(() => /no longer works/.test(document.querySelector('#nipList')?.textContent || ''));
  check(await page.evaluate(() => localStorage.getItem('leadpro-admin-firm-pass') === null), 'remembered passphrase that no longer works: forgotten, "type the current one"');
  await page.unroute('**/firms/lfmp/data/details.enc.json*');
  await page.route('**/firms/lfmp/data/details.enc.json*', r => r.fulfill({ contentType: 'application/json', body: NIP_ENV }));
  await page.evaluate(v => localStorage.setItem('leadpro-admin-firm-pass', v), goodVault);
  await page.reload(); await page.waitForSelector('#nipList .nip li');

  // Lock and idle end the session
  await page.keyboard.press('Escape');
  await page.click('[data-menu="topMenu"]'); await page.click('#topMenu [data-act="lock"]');
  check(await lockShown(page) && await page.evaluate(() => sessionStorage.getItem('leadpro-admin-session') === null), 'Lock: lock screen, session cleared');
  check(await page.evaluate(() => localStorage.getItem('leadpro-admin-firm-pass') === null && !!localStorage.getItem('leadpro-admin-gh-token')), 'Lock clears remembered passphrases (the encrypted GitHub token stays)');
  await page.reload(); await page.waitForSelector('#lockPw:visible');
  check(await lockShown(page), 'after Lock, a reload asks for the password');
  await unlock(page); await page.waitForSelector('.firm');
  await page.evaluate(() => { const s = JSON.parse(sessionStorage.getItem('leadpro-admin-session')); s.t = Date.now() - 31 * 60e3; sessionStorage.setItem('leadpro-admin-session', JSON.stringify(s)); });
  await page.reload(); await page.waitForSelector('#lockPw:visible');
  check(await lockShown(page), '30 minutes idle: the password is asked again');
  await unlock(page); await page.waitForSelector('.firm');
  await page.evaluate(() => { const s = JSON.parse(sessionStorage.getItem('leadpro-admin-session')); s.t = Date.now() - 31 * 60e3; sessionStorage.setItem('leadpro-admin-session', JSON.stringify(s)); });
  await page.mouse.click(5, 5); await page.waitForSelector('#lockPw:visible', { timeout: 5000 });
  check(/30 minutes/.test(await page.textContent('#lockErr')), 'idle while open: locks on the next click, says why');
  await unlock(page); await page.waitForSelector('.firm');

  // Forget token also clears remembered passphrases
  await page.goto(BASE + '#/firm/lfmp'); await page.waitForSelector('#nipPass');
  await page.fill('#nipPass', NIP_PASS); await page.check('#nipRemember'); await page.press('#nipPass', 'Enter'); await page.waitForSelector('#nipList .nip li');
  check(await page.evaluate(() => !!localStorage.getItem('leadpro-admin-firm-pass')), 'remembered again (before Forget token)');
  await page.keyboard.press('Escape');
  await page.click('[data-menu="topMenu"]'); await page.click('#topMenu [data-act="forget"]'); await page.click('#dlgOk');
  await page.waitForSelector('#tokenIn:visible');
  check(await page.evaluate(() => localStorage.getItem('leadpro-admin-firm-pass') === null && localStorage.getItem('leadpro-admin-gh-token') === null), 'Forget token clears the token and remembered passphrases');
  await page.fill('#tokenIn', 'github_pat_test_token_for_mock'); await page.click('#tokenGo'); await page.waitForSelector('.firm');

  // ---------------- top bar, bell, What's new ----------------
  await page.click('[data-menu="topMenu"]');
  check(await page.isVisible('#topMenu [data-act="lock"]') && await page.isVisible('#topMenu [data-act="forget"]'), 'top ⋯ has Forget token and Lock');
  await page.keyboard.press('Escape');
  check(await page.isHidden('#topMenu'), 'Esc closes the top menu');
  await page.click('#bellBtn');
  check(await page.isVisible('#nPanel'), 'bell panel opens');
  await shot(page, 'bell_1440_dark');
  const goFirm = await page.$('#nPanel [data-n="firm"][data-slug="lfmp"]');
  if (goFirm) { await goFirm.click(); await page.waitForSelector('#dPanel:not([hidden])'); check(await hashIs(page) === '#/firm/lfmp', 'bell "Go to firm" opens its Details'); await page.keyboard.press('Escape'); }
  else { await page.keyboard.press('Escape'); check(await page.isHidden('#nPanel'), 'Esc closes the bell panel'); }
  check(await page.isVisible('#newsDot'), 'version chip shows the gold dot (unseen)');
  await page.click('#newsBtn');
  await page.waitForSelector('.vcard');
  const cards = await page.$$eval('.vcard', els => els.map(e => ({ open: e.open, v: e.querySelector('.vt b').textContent })));
  check(cards[0].v === `v${LATEST}` && cards[0].open && cards.slice(1).every(c => !c.open), `newest card (${cards[0].v}) open, older collapsed`);
  await page.click('.vcard[open] [data-tech]');
  check(await page.isVisible('.vcard[open] .tech'), 'Technical details shows the developer text');
  await shot(page, 'whatsnew_1440_dark');
  await page.keyboard.press('Escape');
  check(await page.isHidden('#newsPanel') && await page.isHidden('#newsDot'), 'Esc closes What\'s new; dot cleared');
  await page.click('[data-theme-set="light"]');
  check(await page.evaluate(() => document.documentElement.dataset.theme === 'light' && localStorage.getItem('lfmp-theme') === 'light'), 'Light: data-theme + saved lfmp-theme');
  await page.reload(); await page.waitForSelector('.firm');
  check(await page.evaluate(() => document.documentElement.dataset.theme === 'light'), 'Light remembered after reload');
  await page.click('[data-theme-set="auto"]');
  check(await page.evaluate(() => !document.documentElement.hasAttribute('data-theme') && localStorage.getItem('lfmp-theme') === null), 'Auto: follows the system, nothing saved');

  // ---------------- New firm: both options; app path ----------------
  await page.click('#newFirmBtn');
  await page.waitForSelector('#nfForm');
  await page.waitForFunction(() => document.querySelector('#nfPreset option')?.textContent.includes('ACME'));
  check(await page.isChecked('input[name="nfMode"][value="app"]') && await page.isHidden('#nfTok'), 'Use the LeadPro app is the default (no token field)');
  await page.check('input[name="nfMode"][value="pi"]');
  check(await page.isVisible('#nfTok') && await page.$$eval('.scopelist li', l => l.length) === 9 && await page.$$eval('[data-copy-scope]', l => l.length) === 9, 'PI option: token field + 9 scopes with copy buttons');
  await page.check('input[name="nfMode"][value="app"]');
  await page.fill('#nfName', 'Emery Again');
  await page.fill('#nfLoc', 'l68l8TvqZyERd5q1zdlj');
  await page.click('#nfCreate');
  check(/already has a firm: Emery Law Office/.test(await page.textContent('#nfErr')) && G.M.secretPuts.length === 0 && G.M.dispatches.filter(d => d.workflow !== 'sync.yml').length === 0, 'location with a firm refused, nothing written');
  G.M.scenario = 'app-missing';
  await page.fill('#nfName', 'Smith & Jones Law');
  await page.fill('#nfLoc', 'TestLoc000000000001');
  const pass = await page.inputValue('#nfPass');
  await page.dblclick('#nfCreate');
  await page.waitForSelector('#appSteps .step.fail', { timeout: 60000 });
  const err = await page.textContent('#appSteps .step.fail .errbox');
  check(/LeadPro Connector app isn't on this sub-account/.test(err) && !/Error:|undefined|stack/.test(err), `app missing → plain error: ${err}`);
  check(G.M.dispatches.filter(d => d.workflow === 'new-firm.yml').length === 1, 'double click → one dispatch');
  check(G.M.secretPuts.length === 1 && G.M.secretPuts[0].name === 'PASSPHRASE_SMITH_AND_JONES_LAW' && unseal(G.M.secretPuts[0].value) === pass, 'one passphrase secret, sealed, the one in the form');
  await shot(page, 'newfirm_app_error_1440_dark');
  G.M.scenario = 'ok';
  await page.click('#appRetry');
  await page.waitForSelector('.success', { timeout: 90000 });
  check(G.M.dispatches.filter(d => d.workflow === 'new-firm.yml').length === 2 && G.M.secretPuts.length === 1, 'Retry → started once more, passphrase kept');
  const di = G.M.dispatches.filter(d => d.workflow === 'new-firm.yml').map(d => d.inputs);
  check(di.every(i => JSON.stringify(Object.keys(i).sort()) === '["location","name","practice_area","request","slug","snapshot_id","timezone"]') && !JSON.stringify(di).includes(pass), 'dispatch inputs: the builder\'s non-secret set, no passphrase');
  check(JSON.parse(await G.fileText('firms/index.json')).filter(f => f.locationId === 'TestLoc000000000001').length === 1, 'one firm in the list');
  check(!(await page.textContent('#runHost')).includes(pass), 'the passphrase is not shown in the progress text');
  await page.click('#toList');
  await page.waitForSelector('.firm[data-slug="smith-and-jones-law"]');
  check(!(await lockShown(page)) && /Added Smith/.test(await page.textContent('.listmsg')), 'Back to all firms after a new firm: listed, no password');

  // ---------------- Edit mapping ----------------
  const cfgBefore = await G.fileText('firms/mahdavi/config.json');
  await page.goto(BASE + '#/map/mahdavi');
  await page.waitForSelector('.opt');
  check(await page.isVisible('#emSave') && await page.isEnabled('#emSave'), 'Edit mapping by link: Save mapping at the top');
  const chip = await page.$eval('.opt[aria-pressed="true"]', e => ({ text: e.textContent, full: e.dataset.stage }));
  check(chip.text.length <= chip.full.length, `stage chip "${chip.text}" (full name kept: "${chip.full}")`);
  await page.click('#emSave');
  if (/anyway/i.test(await page.textContent('#emSave'))) { check(/No stage picked for/.test(await page.textContent('#emWarn')), 'empty steps warn before saving'); await page.click('#emSave'); }
  await page.waitForFunction(() => /Saved the mapping/.test(document.querySelector('.okmsg')?.textContent || ''), null, { timeout: 60000 });
  const mc = G.M.commits.find(c => /stage mapping for The Mahdavi/.test(c.message));
  check(mc && mc.files.length === 1 && mc.files[0].content === cfgBefore, 'unchanged save writes config.json byte-identical');
  check(await hashIs(page) === '#/' && !(await lockShown(page)), 'after saving: firm list (#/), no password');
  G.M.overlay.delete('firms/mahdavi/config.json');

  // nothing written anywhere holds a contact name or ID
  const written = JSON.stringify([...G.M.overlay.entries()].filter(([p]) => p !== 'firms/lfmp/data/kpis.json')) + JSON.stringify(G.M.commits) + JSON.stringify(G.M.dispatches);
  check(!/Jordan|cFixture|Old Fixture/.test(written), 'no contact names or IDs in any commit, file or workflow input');
  await ctx.close();

  // ---------------- screenshots + layout: 1440 and 390, light and dark ----------------
  for (const [w, h, scheme] of [[1440, 900, 'dark'], [1440, 900, 'light'], [390, 844, 'dark'], [390, 844, 'light']]) {
    const G2 = await withNip(createMockGitHub({ root: ROOT }));
    ({ ctx, page } = await openPage(G2, { width: w, height: h, scheme }));
    const tag = `${w}_${scheme}`;
    check(await noSideScroll(page), `${tag}: list has no sideways scroll`);
    let cf = await contrastFailures(page); check(!cf.length, `${tag}: list passes AA contrast${cf.length ? `: ${cf.join(' | ')}` : ''}`);
    await shot(page, `list_${tag}`);
    if (w === 390) {
      const box = await page.$eval('.firm[data-slug="lfmp"]', e => { const r = e.getBoundingClientRect(); return { w: r.width }; });
      check(box.w <= 390 - 30 && await page.$$eval('.firm[data-slug="lfmp"] .acts .btn', b => b.every(x => x.getBoundingClientRect().height >= 44)), '390: firm card with two big buttons');
    }
    await page.click('.firm[data-slug="lfmp"] [data-details]:not(.reason)'); await page.waitForSelector('#dPanel:not([hidden]) .dpbody');
    await page.waitForSelector('#nipPass');
    check(await noSideScroll(page), `${tag}: Details (before unlock) has no sideways scroll`);
    let cfl = await contrastFailures(page, '#dPanel'); check(!cfl.length, `${tag}: Details before unlock passes AA contrast${cfl.length ? `: ${cfl.join(' | ')}` : ''}`);
    await shot(page, `details_overview_locked_${tag}`);
    await page.fill('#nipPass', NIP_PASS); await page.press('#nipPass', 'Enter'); await page.waitForSelector('#nipList .nip li');
    if (w === 390) check(await page.$eval('#dPanel', e => { const r = e.getBoundingClientRect(); return r.left === 0 && Math.round(r.width) === 390; }), '390: Details is full screen');
    check(await noSideScroll(page), `${tag}: Details has no sideways scroll`);
    cf = await contrastFailures(page, '#dPanel'); check(!cf.length, `${tag}: Details Overview passes AA contrast${cf.length ? `: ${cf.join(' | ')}` : ''}`);
    await shot(page, `details_overview_${tag}`);
    await page.click('[data-dp-tab="performance"]'); await page.waitForSelector('#dPanel .tiles');
    cf = await contrastFailures(page, '#dPanel'); check(!cf.length, `${tag}: Performance passes AA contrast${cf.length ? `: ${cf.join(' | ')}` : ''}`);
    await shot(page, `perf_${tag}`);
    if (w === 390) { await page.$eval('#dPanel', e => { e.scrollTop = e.scrollHeight; }); await shot(page, `perf_${tag}_bottom`); }
    await page.click('[data-dp-tab="setup"]'); await page.waitForSelector('#dPanel .dset');
    cf = await contrastFailures(page, '#dPanel'); check(!cf.length, `${tag}: Setup passes AA contrast${cf.length ? `: ${cf.join(' | ')}` : ''}`);
    await shot(page, `setup_${tag}`);
    await page.keyboard.press('Escape');
    check(!(await panelOpen(page)), `${tag}: Esc closes Details`);
    await page.click('#newsBtn'); await page.waitForSelector('.vcard');
    cf = await contrastFailures(page); check(!cf.length, `${tag}: What's new passes AA contrast${cf.length ? `: ${cf.join(' | ')}` : ''}`);
    await shot(page, `whatsnew_${tag}`);
    await page.keyboard.press('Escape');
    await page.click('#newFirmBtn'); await page.waitForSelector('#nfForm');
    await page.waitForFunction(() => document.querySelector('#nfPreset option')?.textContent.includes('ACME'));
    check(await noSideScroll(page), `${tag}: New firm has no sideways scroll`);
    cf = await contrastFailures(page); check(!cf.length, `${tag}: New firm passes AA contrast${cf.length ? `: ${cf.join(' | ')}` : ''}`);
    await shot(page, `newfirm_app_${tag}`);
    await page.check('input[name="nfMode"][value="pi"]');
    await shot(page, `newfirm_pi_${tag}`);
    await page.click('#backBtn'); await page.waitForSelector('.firm');
    check(!(await lockShown(page)), `${tag}: New firm → All firms without the password`);
    await page.goto(BASE + '#/map/zz-test-2'); await page.waitForSelector('.opt');
    check(await noSideScroll(page), `${tag}: Edit mapping has no sideways scroll`);
    cf = await contrastFailures(page); check(!cf.length, `${tag}: Edit mapping passes AA contrast${cf.length ? `: ${cf.join(' | ')}` : ''}`);
    await shot(page, `editmapping_${tag}`);
    await ctx.close();
  }
} catch (e) { failed++; console.log(`✗ ${e.stack || e.message}`); }
finally { await browser.close(); server.close(); }
console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nAll ${passed} admin UI checks passed`);
process.exitCode = failed ? 1 : 0;
