// Admin page in a real browser against a mock GitHub.   Run:  node tests/admin-ui/run.mjs [screenshot-folder]
//
// Needs playwright-core and its Chromium (not a dependency of this repo): set PLAYWRIGHT_CORE to its folder, or keep the
// Sub-account Builder repo next to this one (../ghl-subaccount-builder/node_modules/playwright-core). Without it, this suite is skipped.
// Serves the repo folder locally and runs the team site's REAL /api/ server (../ghl-subaccount-builder/admin-site/lib/api.mjs)
// behind a stand-in for Cloudflare Access (test-access.mjs), with GitHub = tests/admin-ui/mock-github.mjs. Also mocks libsodium.
// Writes nothing in the repo.
//
// Checks (v1.16, Google sign-in): signed in → the page opens with the Google name + Sign out, no password or token screen,
// nothing secret in browser storage; signed out → /signin/; Sign out → Access logout; remembered passphrases on the server
// (remember / forget / stale / not set up / New firm saves it); the server never refused a call the page made.
// Earlier checks kept: moving between screens (New firm → All firms, Edit mapping → All firms, the browser Back / Forward
// buttons, a reload); the simple home (strip, All / Needs
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
import { createMockGitHub } from './mock-github.mjs';
import { encryptJSON } from '../../scripts/kpi-core.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHOTS = process.argv[2] || '';
const pwPath = process.env.PLAYWRIGHT_CORE || join(ROOT, '../ghl-subaccount-builder/node_modules/playwright-core');
if (!existsSync(join(pwPath, 'package.json'))) { console.log(`Skipped: playwright-core not found (${pwPath}). Set PLAYWRIGHT_CORE.`); process.exit(0); }
const { chromium } = await import(pathToFileURL(join(pwPath, 'index.mjs')).href);
// The team site's server + a stand-in for Cloudflare Access (from the builder repo, next to this one).
const accessPath = process.env.TEST_ACCESS || join(ROOT, '../ghl-subaccount-builder/admin-site/lib/test-access.mjs');
if (!existsSync(accessPath)) { console.log(`Skipped: the team site's server (test-access.mjs) not found (${accessPath}). Set TEST_ACCESS.`); process.exit(0); }
const { createTestAccess, TEST_TOKEN, TEST_REVIEW_KEY } = await import(pathToFileURL(accessPath).href);

const EMAIL = 'pj@lawfirmmarketingpros.com';
const ACCESS = createTestAccess({ names: { [EMAIL]: 'PJ Drozo' } });
// Swapped per test: who Access says is signed in (null = signed out), the server's settings, and GitHub (the mock).
const T = { email: EMAIL, env: ACCESS.env(), G: null, deps: null };
function useGitHub(G) {
  T.G = G;
  T.deps = ACCESS.deps({ githubApi: 'https://github.test', github: async (method, path, body) => {
    const { status, json } = await G.handle(method, `https://api.github.com${path}`, body === undefined ? null : JSON.stringify(body));
    return { status, body: json === null ? '' : JSON.stringify(json) };
  } });
  return G;
}
const refusals = () => T.deps.logs.filter(l => l.api === 'refused' || l.api === 'error');
const SODIUM_STUB = `window.sodium = { ready: Promise.resolve(), from_string: s => new TextEncoder().encode(s),
  from_base64: b => Uint8Array.from(atob(b), c => c.charCodeAt(0)), to_base64: u => btoa(String.fromCharCode(...u)),
  crypto_box_seal: (m, pk) => Uint8Array.from([0xEE, ...m]) };`;
const unseal = b => { const u = Buffer.from(b, 'base64'); return u[0] === 0xEE ? u.subarray(1).toString('utf8') : null; };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };

// The newest version in CHANGELOG.md (What's new opens that card).
const LATEST = (await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8')).match(/^## v(\d+\.\d+\.\d+)/m)[1];
// LFMP's real 90-day lead count changes with every sync: read it from the repo instead of hard-coding it.
const LFMP_LEADS90 = JSON.parse(await readFile(join(ROOT, 'firms/lfmp/data/kpis.json'), 'utf8')).periods.last90.current.totalLeads;
// v1.28.0: the real firms come from firms/index.json (a new real firm, e.g. Boca Dental on 18 Nov, no longer breaks the
// counts). Test firms = the admin's rule. Expected order = slug order, which matches A–Z by shown name for these firms.
const INDEX = JSON.parse(await readFile(join(ROOT, 'firms/index.json'), 'utf8'));
const isTestFirm = f => /(^|[-\s])test\b|^zz[-\s]/i.test(f.slug) || /\btest\b|^zz\b/i.test(f.name || '');
const REAL = INDEX.filter(f => !isTestFirm(f)).map(f => f.slug).sort(), ALL = INDEX.map(f => f.slug).sort(), NREAL = REAL.length;

// Fixture for "lead not in a pipeline": LFMP's encrypted details, made here with a test passphrase (the real file stays untouched).
const NIP_PASS = 'fixture-passphrase-lfmp';
const NIP = [{ contactId: 'cFixture0001', name: 'Jordan Fixture', email: 'jordan@example.test', phone: '+15550000001', createdAt: new Date(Date.now() - 3 * 864e5).toISOString(), via: 'Chat widget' },
  { contactId: 'cFixture0002', name: 'Unnamed', email: 'noname@example.test', phone: '+15550000002', createdAt: new Date(Date.now() - 5 * 864e5).toISOString(), via: 'Texted in' },
  { contactId: 'cFixtureOld9', name: 'Old Fixture', email: null, phone: null, createdAt: new Date(Date.now() - 60 * 864e5).toISOString(), via: 'Form' }];
const NIP_ENV = JSON.stringify(await encryptJSON({ generatedAt: new Date().toISOString(), notInPipeline: NIP, leads: [] }, NIP_PASS, 1000));

const server = createServer(async (req, res) => {
  if (new URL(req.url, 'http://x').pathname.startsWith('/api/')) return ACCESS.serve(req, res, { env: T.env, deps: T.deps, email: T.email });
  // Cloudflare Access: this site's logout (Sign out calls it before the team-wide logout)
  if (req.url.startsWith('/cdn-cgi/access/logout')) { T.logouts = (T.logouts || 0) + 1; res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><title>Logged out</title>'); }
  if (req.url.startsWith('/signin/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><title>Sign in</title><h1 id="sgTitle">Sign in (stand-in)</h1>'); }
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
  useGitHub(G);
  const k = JSON.parse(await G.fileText('firms/lfmp/data/kpis.json'));
  k.periods.last30.current.notInPipeline = 2;
  G.M.overlay.set('firms/lfmp/data/kpis.json', JSON.stringify(k, null, 2) + '\n');
  return G;
}
async function wire(page, G) {
  page.on('pageerror', e => { failed++; console.log(`✗ page error: ${e.message}`); });
  // The libsodium stub can't match the real file's SRI hash: drop the integrity attribute for cdnjs in this test only.
  await page.addInitScript(() => { const d = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'integrity'); Object.defineProperty(HTMLScriptElement.prototype, 'integrity', { set(v) { if (!String(this.src).includes('cdnjs.cloudflare.com')) d.set.call(this, v); }, get() { return d.get.call(this); } }); });
  await page.route('**/firms/lfmp/data/details.enc.json*', r => r.fulfill({ contentType: 'application/json', body: NIP_ENV }));
  await page.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'text/javascript', body: SODIUM_STUB }));
  // Nothing may go to GitHub from the browser any more: the server does it.
  await page.route('https://api.github.com/**', r => { failed++; console.log(`✗ the page called GitHub directly: ${r.request().method()} ${r.request().url()}`); return r.abort(); });
  void G;
}
// v2 shell: signed in = the app is showing with the shell's top bar; on the firm list, once the summary has its numbers.
const unlocked = page => page.waitForFunction(() => !document.getElementById('appView').hidden && document.querySelector('[data-lv-top]')
  && (!document.querySelector('#screen.kpi-list') || / · /.test(document.querySelector('#screen [data-lv-sum]')?.textContent || '')));
const ROW = '#firmRows .lv-row';
const rowOf = slug => `${ROW}[data-slug="${slug}"]`;
// Me (v1.29.0, shell 2.4.0): the initials open the name menu on desktop AND phone (the phone's Me tab = the Me screen)
const openMe = async page => { const bar = (await page.evaluate(() => innerWidth < 880)) ? '[data-lv-ptop]' : '[data-lv-top]'; await page.click(`${bar} [data-lv="me"]`); await page.waitForSelector(`${bar} [data-lv-pop]:not([hidden])`); return `${bar} [data-lv-pop]`; };
// the name + "Last signed in …" now live in that menu (the bar shows the initials only)
const menuWho = async (page, cls = '.lv-n') => { const m = await openMe(page); const t = (await page.textContent(`${m} .lv-mh ${cls}`)).trim(); await page.keyboard.press('Escape'); return t; };
const unlock = unlocked;   // Google sign-in happens before the page loads (Access): nothing to type
async function openPage(G, { width = 1440, height = 900, scheme = 'dark', hash = '' } = {}) {
  // Motion (Nov 2026): reduced motion here, so panels open/close at once and these checks see the end state; the slide itself is tested in ghl-subaccount-builder tests/e2e/motion.mjs.
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width, height }, colorScheme: scheme, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  await wire(page, G);
  await page.goto(BASE + hash);
  await unlock(page);
  if (!hash || hash === '#/') await page.waitForSelector(ROW);
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
    // the list's › chevron is an icon (WCAG non-text contrast, 3:1), like the bell and the other icons
    const size = parseFloat(cs.fontSize), large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700) || el.classList.contains('lv-chev');
    if (ratio < (large ? 3 : 4.5)) out.push(`${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)}`);
  }
  return [...new Set(out)].slice(0, 12);
}, root);
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const slugs = page => page.$$eval(ROW, els => els.map(e => e.dataset.slug));
// v1.26.0: A–Z by the shown name, case-insensitive, a leading "The " ignored (written here on its own, not taken from the page)
const shownNames = page => page.$$eval(`${ROW} .lv-nm`, els => els.map(e => e.textContent));
const azKey = s => String(s).replace(/\s+/g, ' ').trim().replace(/^the\s+/i, '').toLowerCase();
const isAZ = names => names.length > 0 && names.every((n, i) => !i || azKey(names[i - 1]).localeCompare(azKey(n), 'en', { sensitivity: 'base', numeric: true }) <= 0);
// "asked to sign in again": a password box anywhere, or the page left for the sign-in page
const lockShown = async page => /\/signin\//.test(page.url()) || !!(await page.$('#lgPw, #tokenIn, input[autocomplete="current-password"]'));
// nothing secret in browser storage: the server's keys, the GitHub token, the Review key, a dashboard passphrase
const storageClean = page => page.evaluate(bad => { const all = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }); return bad.every(b => !all.includes(b)); }, [TEST_TOKEN, TEST_REVIEW_KEY, T.env.PASS_KEY, NIP_PASS, 'github_pat']);
const kvPass = slug => T.env.KPI_PASS?.map.get(`pass:${slug}`) ?? null;
const hashIs = page => page.evaluate(() => location.hash);
const panelOpen = page => page.isVisible('#dPanel');

try {
  const G = await withNip(createMockGitHub({ root: ROOT }));

  // ---------------- Google sign-in (v1.16.0) ----------------
  {
    // old browser leftovers (the password login's vault, session key, Review key copy, remembered-passphrase vault) are wiped
    const c0 = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 } });
    const p0 = await c0.newPage(); await wire(p0, G);
    await p0.addInitScript(() => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('lfmp-vault', '{"v":1,"ct":"old"}'); localStorage.setItem('ar_admin_key', 'old-review-key'); localStorage.setItem('leadpro-admin-firm-pass', '{"ct":"x"}'); localStorage.setItem('lfmp-lock-at', '1'); sessionStorage.setItem('lfmp-session', '{"k":"x"}'); } });
    await p0.goto(BASE); await unlocked(p0); await p0.waitForSelector(ROW);
    check(await p0.evaluate(() => ['lfmp-vault', 'ar_admin_key', 'leadpro-admin-firm-pass', 'lfmp-lock-at'].every(k => localStorage.getItem(k) === null) && sessionStorage.getItem('lfmp-session') === null), 'old password-login leftovers removed from the browser on load');
    check(!(await p0.$('[data-lv-top] .lv-who, [data-lv-top] .lv-so')) && !/PJ Drozo|Sign out/.test(await p0.innerText('[data-lv-top]')) && await menuWho(p0) === 'PJ Drozo', 'top bar: no name, no Sign out (v1.29.0); the Google name is in the name menu');
    // v2 shell: one top bar (icon + LFMP · Clients / Scorecards / Reviews with Scorecards active · bell · + New firm · name · avatar · Sign out)
    const nav = await p0.$$eval('[data-lv-top] .lv-nav a', a => a.map(x => `${x.textContent}${x.getAttribute('aria-current') ? '*' : ''}`).join('|'));
    check(nav === 'Clients|Scorecards*|Reviews' && await p0.isVisible('[data-lv-top] .lv-brand') && await p0.isVisible('[data-lv-top] [data-lv="bell"]') && (await p0.textContent('[data-lv-top] [data-lv="plus"]')).trim() === '+ New firm' && (await p0.textContent('[data-lv-top] .lv-av')).trim().startsWith('PD'), `v2 shell top bar: ${nav}`);
    check(!(await p0.$('.toolchip, header.top, .foot, #statStrip, .strip')), 'old header, KPI chip, stats strip and footer are gone');
    // "Last signed in …" = the sign-in before this one (a second Google sign-in, then reload)
    check(await menuWho(p0, '.lv-l') === 'First sign-in on record', 'first sign-in: no earlier one');
    ACCESS.signIn(EMAIL); await p0.reload(); await unlocked(p0); await p0.waitForSelector(ROW);
    const LAST = /^Last signed in (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec), \d{1,2}:\d{2} (AM|PM)$/;
    { const l = await menuWho(p0, '.lv-l'); check(LAST.test(l), `name menu: ${l}`); }
    await shot(p0, 'topbar-signed-in_1440_light', false);
    let me0 = await openMe(p0); await p0.click(`${me0} [data-lv="signins"]`);
    await p0.waitForSelector('#lfmpSignins[open] .lfmp-signins');
    const row = (await p0.textContent('#lfmpSignins tbody tr')) || '';
    check(row.includes('PJ Drozo') && row.includes(EMAIL) && !(await p0.isVisible('[data-lv-top] [data-lv-pop]')), `Me → Team sign-ins: ${row}`);
    await shot(p0, 'team-signins_1440_light', false);
    await p0.keyboard.press('Escape'); check(!(await p0.$('#lfmpSignins[open]')), 'Esc closes Team sign-ins');
    check(!(await p0.$('#lgPw, #tokenIn, #tokenView, input[type="password"]:not(#nipPass)')), 'no password or token box anywhere');
    me0 = await openMe(p0);
    const meText = (await p0.innerText(me0)).replace(/\s+/g, ' ');
    check(/PJ Drozo/.test(meText) && /Last signed in/.test(meText) && await p0.isVisible(`${me0} [data-lv="signout"]`) && !/Lock|Forget token/.test(meText), 'Me: name, last sign-in and Sign out (no Lock, no Forget token)');
    // the name menu (v1.29.0): Theme · Show test clients · Refresh now · What's new + version · Team sign-ins · Install the app · Sign out
    const items = await p0.$$eval(`${me0} .lv-mi`, els => els.map(e => (e.firstElementChild || e).textContent.trim()));
    check(items.join('|') === "Theme|Show test clients|Refresh now|What's new|Team sign-ins|Install the app|Sign out" && /Theme Light Dark Auto/.test(meText) && new RegExp(`What's new v${LATEST.replace(/\./g, '\\.')}`).test(meText) && !(await p0.$(`${me0} .lv-gl`)), `name menu: the same items as every tool, no tool extras (${items.join(' · ')})`);
    await p0.keyboard.press('Escape');
    check(await p0.isHidden('[data-lv-top] [data-lv-pop]'), 'Esc closes Me');
    check(await storageClean(p0), 'nothing secret in localStorage / sessionStorage');
    const team = [], before = T.logouts || 0;
    await p0.route('https://lfmp.cloudflareaccess.com/cdn-cgi/access/logout*', r => { team.push(r.request().url()); const back = new URL(r.request().url()).searchParams.get('returnTo'); return r.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(back)})</script>` }); });
    { const m = await openMe(p0); await p0.click(`${m} [data-lv="signout"]`); } await p0.waitForURL('**/signin/?out=1');   // v1.29.0: Sign out is in the name menu
    check((T.logouts || 0) > before && team.length === 0, `Sign out → Access logout → /signin/?out=1, never the team-domain logout (${team})`);
    // signed out (Access sent no sign-in): the page goes to the sign-in page and remembers where it was
    T.email = null;
    await p0.goto(`${BASE}#/firm/lfmp`); await p0.waitForURL('**/signin/**');
    check(new URL(p0.url()).searchParams.get('next') === '/admin/?repo=peejayedz/leadpro-kpi#/firm/lfmp', `signed out → /signin/?next=… (${p0.url()})`);
    // a non-LFMP Google account: a plain message, nothing loaded
    T.email = 'someone@gmail.com';
    await p0.goto(BASE); await p0.waitForSelector('#setupView:not([hidden])');
    check(/lawfirmmarketingpros\.com/.test(await p0.textContent('#setupMsg')) && await p0.isHidden('#appView'), 'non-LFMP Google account: "Only @lawfirmmarketingpros.com…", nothing loaded');
    T.email = EMAIL;
    await c0.close();
    T.deps.logs.length = 0;   // the refusals above were on purpose
  }

  // ---------------- v1.29.0: the once-a-day greeting (shared shell 2.4.0; motion on here) ----------------
  for (const [w, h] of [[1440, 900], [390, 844]]) for (const scheme of ['dark', 'light']) {
    const tag = `${w}_${scheme}`, bar = w < 880 ? '[data-lv-ptop]' : '[data-lv-top]';
    const cg = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
    const pg = await cg.newPage(); await wire(pg, G);
    // the other two tools' last counts on this device (an hour ago); this page adds its own "scorecards need attention"
    await pg.addInitScript(() => { try { if (!localStorage.getItem('lfmp-counts')) localStorage.setItem('lfmp-counts', JSON.stringify({ reviews: { n: 2, at: Date.now() - 3600e3 }, clients: { n: 0, at: Date.now() - 3600e3 } })); localStorage.setItem('leadpro-admin-news-seen', '99.0.0'); } catch {} });
    await pg.goto(BASE); await unlocked(pg);
    await pg.waitForSelector('[data-lv-greet].play', { timeout: 8000 });
    const gt = (await pg.locator('[data-lv-greet]').innerText()).replace(/\s+/g, ' ');
    check(/GOOD (MORNING|AFTERNOON|EVENING),\s*PJ/.test(gt) && /TAP ANYWHERE TO SKIP/i.test(gt), `${tag}: greeting plays on the first load of the day (${gt.slice(0, 60)})`);
    await pg.waitForTimeout(1900);
    const st = await pg.$$eval('[data-lv-greet] .lv-gr-st > div', els => els.map(e => e.dataset.k));
    check(st.includes('reviews') && st.includes('clients'), `${tag}: the other tools' counts show (${st.join(', ')}); "scorecards" only if this list loaded in time`);
    if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await pg.screenshot({ path: join(SHOTS, `greeting-kpi_${tag}.png`) }); }
    await pg.mouse.click(w / 2, h / 2); await pg.waitForSelector('[data-lv-greet]', { state: 'detached', timeout: 1500 });
    check(true, `${tag}: a click skips it at once`);
    await pg.waitForSelector(ROW);
    const att = await pg.evaluate(() => JSON.parse(localStorage.getItem('lfmp-counts') || '{}').scorecards?.n);
    check(Number.isFinite(att), `${tag}: this page notes "scorecards need attention" for the other tools (${att})`);
    check(!/PJ Drozo|Sign out/.test(await pg.innerText(bar)), `${tag}: top bar has no name and no Sign out`);
    const m = await openMe(pg); if (SHOTS) await pg.screenshot({ path: join(SHOTS, `menu-kpi_${tag}.png`) });
    check(/PJ Drozo/.test(await pg.innerText(m)) && await pg.isVisible(`${m} [data-lv="signout"]`), `${tag}: the initials open the name menu (name, Sign out)`);
    await pg.keyboard.press('Escape'); check(await pg.isHidden(m), `${tag}: Esc closes it`);
    await pg.reload(); await unlocked(pg); await pg.waitForSelector(ROW); await pg.waitForTimeout(500);
    check(!(await pg.$('[data-lv-greet]')), `${tag}: same day, next load: no greeting`);
    await cg.close();
  }
  let { ctx, page } = await openPage(G);

  // ---------------- home ----------------
  // v1.26.0: A–Z by the shown name ("The Mahdavi Law Firm" under M), whatever index.json's order
  check(JSON.stringify(await slugs(page)) === JSON.stringify(REAL), `home: the ${NREAL} firms A–Z, test firms hidden (${(await slugs(page)).join(', ')})`);
  check(isAZ(await shownNames(page)), `home: A–Z by the shown name (${(await shownNames(page)).join(' | ')})`);
  // v1.26.0: a trend only when days 91–180 are covered by the firm's synced data; every firm started in Nov 2026 → none, never "from 0"
  { const smalls = await page.$$eval(`${ROW} .lv-c:not(.lv-pr) .lv-big small`, s => s.map(x => x.textContent.trim()));
    check(!(await page.$(`${ROW} [data-trend]`)) && !(await page.textContent('#firmRows')).includes('from 0') && smalls.every(t => /^leads? · 90 days$/.test(t)), `rows: no trend before the 90 days before are covered, never "from 0" (${smalls.join(' | ')})`); }
  const strip = (await page.textContent('#screen [data-lv-sum]')).replace(/\s+/g, ' ');
  // v1.27.0 (FIX 1): the summary uses the "Needs attention" filter's words and count
  { const attSeg = (await page.textContent('#screen [data-lv-seg="attention"]')).replace(/\s+/g, ' '), n = Number((attSeg.match(/(\d+)/) || [])[1] || 0);
    check(n ? strip === `${NREAL} firms · ${n} ${n === 1 ? 'needs' : 'need'} attention` : new RegExp(`^${NREAL} firms · all synced \\d{1,2}:\\d{2} (AM|PM)$`, 'i').test(strip), `summary line "${strip}" = filter "${attSeg}"`); }
  check((await page.textContent('#screen .lv-h1')).trim() === 'Scorecards' && await page.getAttribute('#firmSearch', 'placeholder') === `Search ${NREAL} firms`, `title "Scorecards" + "Search ${NREAL} firms" (real count)`);
  const segs = await page.$$eval('#screen [data-lv-seg]', b => b.map(x => `${x.dataset.lvSeg}=${x.querySelector('.lv-d').textContent}`).join('|'));
  check(new RegExp(`^all=All ${NREAL}\\|attention=Needs attention · \\d+\\|test=Test firms$`).test(segs), `filter: All ${NREAL} · Needs attention · n · Test firms (${segs})`);
  // v1.25.0: coloured only when n > 0: red if any firm has an alert, amber if they are all notices (same rule as the bell)
  { const t = await page.$eval('#screen [data-lv-seg="attention"]', b => (b.querySelector('.lv-red') ? 'red' : b.querySelector('.lv-amber') ? 'amber' : ''));
    const red = await page.$$eval('#firmRows .lv-row .lv-c [data-state="status"]', a => a.some(e => e.classList.contains('red')));
    check(/Needs attention · [1-9]/.test(segs) ? t === (red ? 'red' : 'amber') : t === '', `"Needs attention": red if any alert, amber if only notices, plain at 0 (${t || 'plain'})`); }
  const lf = (await page.textContent(rowOf('lfmp'))).replace(/\s+/g, ' ');
  check(/2 leads not in a pipeline/.test(lf) && new RegExp(`(^|\\D)${LFMP_LEADS90}\\s*leads · 90 days`).test(lf), `LFMP row: reason + leads (${lf.slice(0, 140)})`);
  check(await page.$eval(`${rowOf('lfmp')} .lv-c [data-state="status"]`, e => e.classList.contains('amber')), 'LFMP row: amber status (needs attention, not a sync failure)');
  check(/Synced \d{1,2}:\d{2} (AM|PM)/.test(await page.textContent(`${rowOf('mahdavi')} .lv-c [data-state="status"]`)) && await page.$eval(`${rowOf('mahdavi')} .lv-c [data-state="status"]`, e => e.classList.contains('green')), 'Mahdavi: green "Synced <time>"');
  check((await page.textContent(`${rowOf('mahdavi')} .lv-op`)).trim() === 'Open ›' && !(await page.$(`${rowOf('mahdavi')} a, ${rowOf('mahdavi')} button`)), 'row: Open › and no buttons (the whole row opens Details)');
  check(await page.$$eval(ROW, r => r.every(x => x.getBoundingClientRect().height >= 44)), 'rows are at least 44px tall');
  await shot(page, 'list_1440_dark_main');
  let mx = await openMe(page); await page.click(`${mx} [data-lv="tests"]`); await page.keyboard.press('Escape');
  check((await slugs(page)).includes('zz-test-2') && new RegExp(`^${ALL.length} firms`).test(await page.textContent('#screen [data-lv-sum]')), 'Me → Show test clients adds ZZ TEST 2');
  await page.reload(); await unlocked(page); await page.waitForSelector(ROW);
  check(!(await lockShown(page)) && (await slugs(page)).includes('zz-test-2'), 'reload: still unlocked, Show test clients remembered');
  check(JSON.stringify(await slugs(page)) === JSON.stringify(ALL), `All + test firms: A–Z (${(await slugs(page)).join(', ')})`);
  mx = await openMe(page); check(await page.getAttribute(`${mx} [data-lv="tests"]`, 'aria-checked') === 'true', 'Me shows the switch on'); await page.click(`${mx} [data-lv="tests"]`); await page.keyboard.press('Escape');
  await page.click('#screen [data-lv-seg="test"]');
  check(JSON.stringify(await slugs(page)) === '["zz-test-2"]', `Test filter: the test firms only, even with the switch off (${(await slugs(page)).join(', ')})`);
  await page.click('#screen [data-lv-seg="attention"]');
  check(await page.getAttribute('#screen [data-lv-seg="attention"]', 'aria-pressed') === 'true' && (await slugs(page)).includes('lfmp') && !(await slugs(page)).includes('mahdavi'), `Needs attention filter (${(await slugs(page)).join(', ')})`);
  check(isAZ(await shownNames(page)), `Needs attention: A–Z, not by urgency (${(await shownNames(page)).join(' | ')})`);
  await page.click('#screen [data-lv-seg="all"]');
  await page.fill('#firmSearch', 'law');
  check((await slugs(page)).length >= 3 && isAZ(await shownNames(page)), `search "law": results A–Z (${(await shownNames(page)).join(' | ')})`);
  await page.fill('#firmSearch', 'emery');
  check(JSON.stringify(await slugs(page)) === '["emery-law-office"]', 'search by name');
  await page.fill('#firmSearch', 'hedayati-law');
  check((await slugs(page)).length === 1, 'search by slug');
  await page.fill('#firmSearch', 'nothing-matches-this');
  check(await page.isVisible('[data-clear-filter]'), 'empty search shows "Show all firms"');
  await page.click('[data-clear-filter]');
  check((await slugs(page)).length === NREAL, 'Show all firms clears the search');

  // v1.26.0: a firm with no good sync for ~3 hours: "No successful sync for 3 h" on its row (desktop and phone), never "… in 3 hours 2 h ago"
  {
    const G3 = useGitHub(createMockGitHub({ root: ROOT }));
    const ago3h = new Date(Date.now() - 182 * 60e3).toISOString();
    const km = JSON.parse(await G3.fileText('firms/mahdavi/data/kpis.json')); km.generatedAt = ago3h; if (km.sync) km.sync.checkedAt = ago3h;
    G3.M.overlay.set('firms/mahdavi/data/kpis.json', JSON.stringify(km, null, 2) + '\n');
    const st = JSON.parse(await G3.fileText('status/sync-status.json')); st.firms.mahdavi.lastSuccessAt = ago3h; st.firms.mahdavi.lastAttemptAt = ago3h;
    G3.M.overlay.set('status/sync-status.json', JSON.stringify(st, null, 2) + '\n');
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const o = await openPage(G3, { width: w, height: h, scheme: 'light' });
      const sel = `${rowOf('mahdavi')} ${w === 390 ? '.lv-mt.lv-p' : '.lv-mt.lv-d'}`;
      const ok = await o.page.waitForFunction(s => /No successful sync for 3 h$/.test(document.querySelector(s)?.textContent || ''), sel, { timeout: 8000 }).then(() => true, () => false);
      const t = (await o.page.textContent(sel).catch(() => '')) || '';
      check(ok && !/ in \d+ hours|ago/.test(t), `${w}: stale row reads "No successful sync for 3 h" (${t})`);
      await shot(o.page, `list_stale_${w}_light`);
      await o.ctx.close();
    }
    useGitHub(G);
  }

  // ---------------- Details: Overview ----------------
  await page.click(`${rowOf('lfmp')} .lv-mt`);
  await page.waitForSelector('#dPanel:not([hidden]) .dpbody');
  check(await hashIs(page) === '#/firm/lfmp', `the row (its reason line) opens Details with a hash (${await hashIs(page)})`);
  check(await page.$eval(rowOf('lfmp'), r => r.hasAttribute('data-sel')), 'the open firm\'s row is marked');
  const head = (await page.textContent('#dPanel .dphead')).replace(/\s+/g, ' ');
  check(/Law Firm Marketing Pros/i.test(head) && /GHL:/.test(head), `header: name, practice area, GHL name (${head.trim()})`);
  check(await page.isVisible('#dPanel [data-reason="not-in-pipeline"]') && /2 leads not in a pipeline/.test(await page.textContent('#dPanel .abox')), 'needs-attention box first, with the reason');
  check(await page.isVisible('#nipPass') && await page.isVisible('#nipRemember') && !(await page.isChecked('#nipRemember')), 'no saved passphrase: unlock form with "Remember for the team" (off by default)');
  const firstKid = await page.$eval('#nipList', el => { const k = el.firstElementChild; const a = k?.querySelector('a'); return { cls: k?.className, btn: a?.classList.contains('btn') && !a.classList.contains('p'), text: a?.textContent.trim(), beforeForm: !!(k && el.querySelector('form') && (k.compareDocumentPosition(el.querySelector('form')) & 4)) }; });
  check(firstKid.btn && firstKid.text === 'Open Contacts in GHL ↗' && firstKid.beforeForm, `"Open Contacts in GHL ↗" is an outlined button, first, before the passphrase box (${JSON.stringify(firstKid)})`);
  check(/Remember for the team/.test(await page.textContent('#nipList .nipform')), 'Remember checkbox sits with Unlock');
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
  check(await page.evaluate(() => !JSON.stringify(localStorage).includes('Jordan') && !JSON.stringify(sessionStorage).includes('Jordan') && !JSON.stringify(localStorage).includes('example.test') && !JSON.stringify(localStorage).includes('fixture-passphrase') && localStorage.getItem('leadpro-admin-firm-pass') === null) && kvPass('lfmp') === null, 'not remembered: nothing about the contacts or the passphrase saved in the browser or on the server');
  await shot(page, 'details_overview_names_1440_dark');
  await shot(page, 'details_overview_1440_dark');
  const ov = (await page.innerText('#dPanel')).replace(/\s+/g, ' ');
  for (const [what, re] of [['Status + last update', /Status OK|Status Holding|Status Last sync/], ['Leads (90 days)', new RegExp(`Leads ${LFMP_LEADS90} in the last 90 days`)], ['Not in a pipeline (30 days)', /Not in a pipeline 2 new contacts · 30 days/], ['Slug', /Slug lfmp/], ['Connection', /Connection Private Integration token/], ['Banner', /Banner (On|Off)/]])
    check(new RegExp(re.source, 'i').test(ov), `Overview info: ${what}`);
  const acts = await page.$$eval('#dPanel .dpacts > *', b => b.map(x => `${x.textContent.trim()}${x.classList.contains('p') ? ' (gold)' : ''}`));
  check(JSON.stringify(acts) === JSON.stringify(['Open dashboard ↗ (gold)', 'Re-sync', 'Edit mapping']), `Overview actions: Open dashboard ↗ (gold), Re-sync, Edit mapping (${acts.join(' · ')})`);
  await page.keyboard.press('Escape');
  check(!(await panelOpen(page)) && await hashIs(page) === '#/', 'Esc closes Details and the hash');
  await page.click(`${rowOf('mahdavi')} .lv-nm`);
  await page.waitForSelector('#dPanel:not([hidden])');
  check(await hashIs(page) === '#/firm/mahdavi', 'clicking a row opens Details');
  check(/Nothing needs attention/.test(await page.textContent('#dPanel')), 'OK firm: no attention box');
  await page.click('#dPanel .xbtn[data-dp-close]');
  check(!(await panelOpen(page)), '✕ closes Details');
  await page.goBack(); await page.waitForSelector('#dPanel:not([hidden])');
  check(!(await lockShown(page)) && await hashIs(page) === '#/firm/mahdavi', 'Back reopens the Details (no password)');
  await page.goBack(); await page.waitForFunction(() => document.getElementById('dPanel').hidden);
  check(!(await lockShown(page)), 'Back again: firm list, still unlocked');

  // ---------------- Details: Setup (Copy GHL menu link lives here since v1.13.1) ----------------
  await page.click(rowOf('emery-law-office'));
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
  check(!/Copied/.test(await page.textContent('#dPanel .dpmsg')) && !/Copied/.test(await page.textContent(rowOf('emery-law-office'))), '"Copied" is not in the message line or on the firm row');
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
  await page.click('[data-lv-top] [data-lv="plus"]'); await page.waitForSelector('#nfForm');
  check(await hashIs(page) === '#/new', 'the gold + New firm opens New firm (own hash)');
  await page.click('#backBtn'); await page.waitForSelector(ROW);
  check(!(await lockShown(page)), 'New firm → All firms: no password');
  await page.click('[data-lv-top] [data-lv="plus"]'); await page.waitForSelector('#nfForm');
  await page.goBack(); await page.waitForSelector(ROW);
  check(!(await lockShown(page)) && !(await page.isVisible('#nfForm')), 'New firm → browser Back: firm list, no password');
  await page.goForward(); await page.waitForSelector('#nfForm');
  check(!(await lockShown(page)), 'Forward: New firm again, no password');
  await page.click('#nfCancel'); await page.waitForSelector(ROW);
  check(!(await lockShown(page)), 'Cancel: firm list, no password');
  await page.click(rowOf('hedayati-law-group-p-c')); await page.waitForSelector('#dPanel:not([hidden])');
  await page.click('#dPanel .dpacts [data-f="map"]'); await page.waitForSelector('#emSave');
  check(await hashIs(page) === '#/map/hedayati-law-group-p-c' && !(await panelOpen(page)), 'Details → Edit mapping (own hash, panel closed)');
  await page.goBack(); await page.waitForSelector('#dPanel:not([hidden])');
  check(!(await lockShown(page)), 'Edit mapping → Back: Details again, no password');
  await page.click('#dPanel .dpacts [data-f="map"]'); await page.waitForSelector('#emSave');
  await page.click('#backBtn'); await page.waitForSelector(ROW);
  check(!(await lockShown(page)), 'Edit mapping → All firms: no password');
  await page.click('[data-lv-top] [data-lv="plus"]'); await page.waitForSelector('#nfForm');
  await page.click('[data-lv-top] .lv-mk'); await page.waitForSelector(ROW);
  check(!(await lockShown(page)) && await hashIs(page) === '#/', 'LFMP icon: back to the firm list in-page, no password');
  await page.click('[data-lv-top] [data-lv="plus"]'); await page.waitForSelector('#nfForm');
  await page.click('[data-lv-top] .lv-nav a[aria-current="page"]'); await page.waitForSelector(ROW);
  check(!(await lockShown(page)) && await hashIs(page) === '#/', 'Scorecards in the top bar: firm list in-page, no reload');
  await page.reload(); await page.waitForSelector(ROW);
  check(!(await lockShown(page)), 'reload: still signed in');
  check(await storageClean(page) && await page.evaluate(() => localStorage.getItem('lfmp-vault') === null && sessionStorage.getItem('lfmp-session') === null), 'no vault, no session key, no token in the browser (the server holds them)');

  // saved dashboard passphrase (as the client dashboard stores it) → names show without typing
  await page.evaluate(p => localStorage.setItem('lfmp-pass-lfmp', p), NIP_PASS);
  await page.goto(BASE + '#/firm/lfmp'); await page.waitForSelector('#nipList .nip li');
  check(/Jordan Fixture/.test(await page.textContent('#nipList')) && !/Old Fixture/.test(await page.textContent('#nipList')), 'saved passphrase: list shows without typing (last 30 days only)');
  await page.evaluate(() => localStorage.removeItem('lfmp-pass-lfmp'));

  // "Remember for the team": saved encrypted on the team site's server; names show straight away next time, on any device
  await page.reload(); await page.waitForSelector('#nipPass');
  await page.fill('#nipPass', NIP_PASS); await page.check('#nipRemember'); await page.press('#nipPass', 'Enter');
  await page.waitForSelector('#nipList .nip li');
  const kv = kvPass('lfmp');
  check(!!kv && !kv.includes(NIP_PASS) && !/Jordan|example\.test/.test(kv) && JSON.parse(kv).by === EMAIL, 'remembered: stored on the server, encrypted (no passphrase or contact in the clear), with who saved it');
  check(await storageClean(page) && await page.evaluate(() => localStorage.getItem('leadpro-admin-firm-pass') === null), 'remembered: nothing about it in this browser');
  check(/remembered for the team/i.test(await page.textContent('#nipList')) && await page.isVisible('#nipList [data-nip-forget]'), 'Details says "remembered for the team" with Forget it');
  await shot(page, 'details_remembered_1440_dark');
  { // another person on another computer: opens without typing
    const c2 = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const p2 = await c2.newPage(); await wire(p2, G);
    T.email = 'ana.reyes@lawfirmmarketingpros.com';
    await p2.goto(BASE + '#/firm/lfmp'); await unlocked(p2); await p2.waitForSelector('#nipList .nip li');
    const nipOk = /Jordan Fixture/.test(await p2.textContent('#nipList')) && !(await p2.$('#nipPass'));
    await p2.keyboard.press('Escape'); await p2.waitForSelector('#dPanel', { state: 'hidden' });   // the details panel covers the initials
    check(nipOk && await menuWho(p2) === 'Ana', 'another team member, another browser: names show without typing');
    T.email = EMAIL; await c2.close();
  }
  await page.reload(); await page.waitForSelector('#nipList .nip li');
  check(/Jordan Fixture/.test(await page.textContent('#nipList')) && !(await page.$('#nipPass')), 'remembered: names show straight away after a reload, no typing');
  // a remembered passphrase that stops working (firm passphrase changed) is forgotten, with a plain message
  await page.route('**/firms/lfmp/data/details.enc.json*', async r => r.fulfill({ contentType: 'application/json', body: JSON.stringify(await encryptJSON({ notInPipeline: NIP }, 'a-changed-passphrase', 1000)) }));
  await page.reload(); await page.waitForFunction(() => /no longer works/.test(document.querySelector('#nipList')?.textContent || ''));
  check(kvPass('lfmp') === null, 'remembered passphrase that no longer works: forgotten on the server, "type the current one"');
  await page.unroute('**/firms/lfmp/data/details.enc.json*');
  await page.route('**/firms/lfmp/data/details.enc.json*', r => r.fulfill({ contentType: 'application/json', body: NIP_ENV }));
  // remember again, then Forget it
  await page.reload(); await page.waitForSelector('#nipPass');
  await page.fill('#nipPass', NIP_PASS); await page.check('#nipRemember'); await page.press('#nipPass', 'Enter'); await page.waitForSelector('#nipList [data-nip-forget]');
  await page.click('#nipList [data-nip-forget]'); await page.waitForFunction(() => /Forgotten for the team/.test(document.querySelector('#nipList')?.textContent || ''));
  check(kvPass('lfmp') === null && /Jordan Fixture/.test(await page.textContent('#nipList')), 'Forget it: removed on the server (the list stays open until you leave)');
  await page.reload(); await page.waitForSelector('#nipPass');
  check(true, 'after Forget it: the passphrase is asked again');
  // the server's passphrase store not set up (no KV / key): typing still works, a quiet note, no Remember box
  const envBefore = T.env; T.env = { ...envBefore, KPI_PASS: undefined };
  await page.reload(); await page.waitForSelector('#nipPass');
  check(!(await page.$('#nipRemember')) && /isn't set up on the team site/.test(await page.textContent('#nipList')), 'store not set up: no Remember box, quiet note');
  await page.fill('#nipPass', NIP_PASS); await page.press('#nipPass', 'Enter'); await page.waitForSelector('#nipList .nip li');
  check(true, 'store not set up: typing the passphrase still opens the names');
  T.env = envBefore;
  T.deps.logs.length = 0;   // the 503s above were on purpose

  // ---------------- top bar, bell, What's new ----------------
  await page.keyboard.press('Escape');
  let mm = await openMe(page);
  check(await page.isVisible(`${mm} [data-lv="signout"]`) && !/Lock|Forget token/.test(await page.innerText(mm)), 'Me has Sign out (no Lock, no Forget token)');
  await page.keyboard.press('Escape');
  check(await page.isHidden('[data-lv-top] [data-lv-pop]'), 'Esc closes Me');
  // bell: red count = new issues (same as the tab title); the panel hangs under the bell
  const badge = await page.$eval('[data-lv-top] [data-lv-badge]', b => ({ hidden: b.hidden, n: b.textContent, bg: getComputedStyle(b).backgroundColor }));
  const titleN = (await page.title()).match(/^\((\d+)\)/)?.[1] || '0';
  check((badge.hidden ? '0' : badge.n) === titleN && (badge.hidden || /rgb\((184, 50, 43|239, 90, 82)\)/.test(badge.bg)), `bell count ${badge.hidden ? 'hidden' : badge.n} = tab title (${titleN}), red`);
  await page.click('[data-lv-top] [data-lv="bell"]');
  check(await page.isVisible('#nPanel') && await page.$eval('#nPanel', p => !!p.closest('[data-lv-top] [data-lv-bellwrap]')) && await page.getAttribute('[data-lv-top] [data-lv="bell"]', 'aria-expanded') === 'true', 'bell panel opens under the top bar\'s bell');
  const sync = (await page.innerText('#nPanel #nSync')).replace(/\s+/g, ' ');
  check(/^Sync every 30 min · last \d{1,2}:\d{2} (AM|PM) · next \d{1,2}:\d{2} (AM|PM) Token keeper/.test(sync) && await page.$eval('#nPanel', p => p.querySelector('#nSync') === p.querySelector('.nhead').firstElementChild), `bell panel starts with the sync schedule + token keeper (were the top bar): ${sync}`);
  await shot(page, 'bell_1440_dark');
  const goFirm = await page.$('#nPanel [data-n="firm"][data-slug="lfmp"]');
  if (goFirm) { await goFirm.click(); await page.waitForSelector('#dPanel:not([hidden])'); check(await hashIs(page) === '#/firm/lfmp', 'bell "Go to firm" opens its Details'); await page.keyboard.press('Escape'); }
  else { await page.keyboard.press('Escape'); check(await page.isHidden('#nPanel'), 'Esc closes the bell panel'); }
  check(!(await page.$('[data-lv-top] [data-lv-dot], [data-lv-top] .lv-av .lv-dot')), 'no dot on the avatar (v2)');
  mm = await openMe(page);
  check(new RegExp(`What's new v${LATEST.replace(/\./g, '\\.')}`).test((await page.innerText(mm)).replace(/\s+/g, ' ')) && !!(await page.$(`${mm} .lv-ndot`)), 'Me → What\'s new shows the version and the dot');
  await page.click(`${mm} [data-lv="news"]`);
  await page.waitForSelector('.vcard');
  const cards = await page.$$eval('.vcard', els => els.map(e => ({ open: e.open, v: e.querySelector('.vt b').textContent })));
  check(cards[0].v === `v${LATEST}` && cards[0].open && cards.slice(1).every(c => !c.open), `newest card (${cards[0].v}) open, older collapsed`);
  await page.click('.vcard[open] [data-tech]');
  check(await page.isVisible('.vcard[open] .tech'), 'Technical details shows the developer text');
  check(await page.getAttribute('#newsPanel .newsrepo a', 'href') === 'https://github.com/peejayedz/leadpro-kpi' && /peejayedz\/leadpro-kpi/.test(await page.textContent('#newsPanel .newsrepo')), 'What\'s new ends with the repo link (was the page footer)');
  await shot(page, 'whatsnew_1440_dark');
  await page.keyboard.press('Escape');
  mm = await openMe(page);
  check(await page.isHidden('#newsPanel') && !(await page.$(`${mm} .lv-ndot`)), 'Esc closes What\'s new; Me\'s dot cleared');
  await page.keyboard.press('Escape');
  mm = await openMe(page); await page.click(`${mm} [data-lv="theme"][data-v="light"]`);
  check(await page.evaluate(() => document.documentElement.dataset.theme === 'light' && localStorage.getItem('lfmp-theme') === 'light'), 'Me → Light: data-theme + saved lfmp-theme');
  await page.reload(); await page.waitForSelector(ROW);
  check(await page.evaluate(() => document.documentElement.dataset.theme === 'light'), 'Light remembered after reload');
  mm = await openMe(page); await page.click(`${mm} [data-lv="theme"][data-v="auto"]`); await page.keyboard.press('Escape');
  check(await page.evaluate(() => !document.documentElement.hasAttribute('data-theme') && localStorage.getItem('lfmp-theme') === null), 'Me → Auto: follows the system, nothing saved');
  // Me → Refresh now: reloads the list in place and says when
  mm = await openMe(page); await page.click(`${mm} [data-lv="refresh"]`); await page.waitForSelector(ROW);
  mm = await openMe(page);
  check(/Refresh now updated \d{1,2}:\d{2} (AM|PM)/.test((await page.innerText(mm)).replace(/\s+/g, ' ')), 'Me → Refresh now reloads and shows "updated <time>"');
  await page.keyboard.press('Escape');

  // ---------------- New firm: both options; app path ----------------
  await page.click('[data-lv-top] [data-lv="plus"]');
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
  const remembered = await page.evaluate(async () => (await (await fetch('/api/kpi-pass', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"op":"get","slug":"smith-and-jones-law"}' })).json()).pass);
  check(remembered === pass && !kvPass('smith-and-jones-law').includes(pass), 'New firm: the new passphrase is remembered for the team automatically (encrypted on the server)');
  await shot(page, 'newfirm_app_error_1440_dark');
  G.M.scenario = 'ok';
  await page.click('#appRetry');
  await page.waitForSelector('.success', { timeout: 90000 });
  check(G.M.dispatches.filter(d => d.workflow === 'new-firm.yml').length === 2 && G.M.secretPuts.length === 1, 'Retry → started once more, passphrase kept');
  const di = G.M.dispatches.filter(d => d.workflow === 'new-firm.yml').map(d => d.inputs);
  check(di.every(i => JSON.stringify(Object.keys(i).sort()) === '["location","name","practice_area","request","slug","snapshot_id","timezone"]') && !JSON.stringify(di).includes(pass), 'dispatch inputs: the builder\'s non-secret set, no passphrase');
  check(JSON.parse(await G.fileText('firms/index.json')).filter(f => f.locationId === 'TestLoc000000000001').length === 1, 'one firm in the list');
  check(!(await page.textContent('#runHost')).includes(pass), 'the passphrase is not shown in the progress text');
  check(/is set up as a Draft/.test(await page.textContent('#appResult')) && !(await page.$('#ghlLinkOut')) && /Add to GHL menu/.test(await page.textContent('#appResult')), 'v1.28.0: a new law firm ends as a Draft: no GHL link to copy, "Add to GHL menu" after Andy\'s review');
  await page.click('#toList');
  await page.waitForSelector(rowOf('smith-and-jones-law'));
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
  check(G.M.commits.length > 0 && G.M.commits.every(c => /\n\nBy PJ \(LFMP tools\)$/.test(c.message) && !c.message.includes('@')), 'every commit to this public repo is signed with the first name only (added by the server), never an email');
  check(await storageClean(page), 'after everything: nothing secret in browser storage');
  { const r = refusals(); check(!r.length, `the server never refused a call this page made${r.length ? `: ${JSON.stringify(r.slice(0, 5))}` : ''}`); }
  await ctx.close();

  // ---------------- screenshots + layout: 1440 and 390, light and dark ----------------
  for (const [w, h, scheme] of [[1440, 900, 'dark'], [1440, 900, 'light'], [390, 844, 'dark'], [390, 844, 'light']]) {
    const G2 = await withNip(createMockGitHub({ root: ROOT }));
    ({ ctx, page } = await openPage(G2, { width: w, height: h, scheme }));
    const tag = `${w}_${scheme}`;
    check(await noSideScroll(page), `${tag}: list has no sideways scroll`);
    let cf = await contrastFailures(page); check(!cf.length, `${tag}: list passes AA contrast${cf.length ? `: ${cf.join(' | ')}` : ''}`);
    await shot(page, `list_${tag}`);
    check(JSON.stringify(await slugs(page)) === JSON.stringify(REAL) && isAZ(await shownNames(page)), `${tag}: list A–Z by the shown name (${(await shownNames(page)).join(' | ')})`);
    const me1 = await openMe(page);
    check(/PJ Drozo/.test(await page.textContent(me1)) && await page.isVisible(`${me1} [data-lv="signout"]`), `${tag}: Me shows the Google name and Sign out`);
    cf = await contrastFailures(page, me1); check(!cf.length, `${tag}: Me passes AA contrast${cf.length ? `: ${cf.join(' | ')}` : ''}`);
    await shot(page, `menu_${tag}`, false);
    check(/^(Last signed in|First sign-in on record)/.test((await page.textContent(`${me1} .lv-mh .lv-l`)).trim()), `${tag}: Me shows the last sign-in`);
    await page.click(`${me1} [data-lv="signins"]`); await page.waitForSelector('#lfmpSignins[open] .lfmp-signins');
    cf = await contrastFailures(page, '#lfmpSignins'); check(!cf.length && await noSideScroll(page), `${tag}: Team sign-ins passes AA contrast, no sideways scroll${cf.length ? `: ${cf.join(' | ')}` : ''}`);
    await shot(page, `team-signins_${tag}`, false);
    await page.keyboard.press('Escape');
    if (w !== 390) { cf = await contrastFailures(page, '[data-lv-top]'); check(!cf.length, `${tag}: top bar (+ New firm, initials) passes AA contrast${cf.length ? `: ${cf.join(' | ')}` : ''}`); if (SHOTS) await page.locator('[data-lv-top]').first().screenshot({ path: join(SHOTS, `topbar_${tag}.png`) }); }
    if (w === 390) {
      // phone: top bar = icon · SCORECARDS · bell · gold + · avatar; bottom tabs; no desktop top bar
      check(await page.isHidden('[data-lv-top]') && (await page.textContent('[data-lv-ptop] h2')).trim() === 'Scorecards' && await page.isVisible('[data-lv-ptop] [data-lv="bell"]') && await page.isVisible('[data-lv-ptop] [data-lv="plus"]'), '390: phone top bar (title, bell, +, avatar)');
      const tabs = await page.$$eval('[data-lv-tabs] .lv-tab', t => t.map(x => `${x.textContent.trim()}${x.getAttribute('aria-current') ? '*' : ''}`).join('|'));
      check(tabs === 'Clients|Scorecards*|Reviews|Me', `390: bottom tabs (${tabs})`);
      const small = await page.$$eval('[data-lv-ptop] button:not([data-lv-pop] *), [data-lv-tabs] .lv-tab, #screen [data-lv-seg], #screen .lv-search, #firmRows .lv-row', els => els.filter(e => { const r = e.getBoundingClientRect(), a = getComputedStyle(e, '::after'); const h = Math.max(r.height, a.content !== 'none' ? parseFloat(a.height) || 0 : 0), wd = Math.max(r.width, a.content !== 'none' ? parseFloat(a.width) || 0 : 0); return h < 44 || wd < 44; }).map(e => e.className || e.tagName));
      check(!small.length, `390: tap targets at least 44px${small.length ? `: ${small.join(', ')}` : ''}`);
      const box = await page.$eval(rowOf('lfmp'), e => { const r = e.getBoundingClientRect(); return { w: r.width, n: e.querySelector('.lv-pr .lv-big')?.textContent }; });
      check(box.w <= 390 - 30 && /leads · 90 d/.test(box.n || ''), `390: one list row with the leads number (${box.n})`);
      await page.click('[data-lv-ptop] [data-lv="bell"]');
      check(await page.isVisible('#nPanel') && await page.$eval('#nPanel', p => !!p.closest('[data-lv-ptop]')), '390: the bell panel opens from the phone bell');
      await page.keyboard.press('Escape');
    }
    await page.click(rowOf('lfmp')); await page.waitForSelector('#dPanel:not([hidden]) .dpbody');
    if (w === 390) check(await page.isVisible('#dPanel .dpback') && (await page.textContent('#dPanel .dpback')).includes('Scorecards') && await page.isHidden('#dPanel .xbtn'), '390: Details has "‹ Scorecards"');
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
    // v1.30.0: GHL menu link → Custom CSS rule. LFMP's link was made by hand (no id kept): "Show CSS rule" runs menu-css.yml
    // (GET only), then the rule shows with Copy and where to paste it. Plain words while it runs, never a raw status.
    {
      const sec = '#dPanel [data-sec="menu-link"]';
      await page.locator(`${sec} [data-css-rule]`).scrollIntoViewIfNeeded();
      check(await page.isVisible(`${sec} [data-f="cssread"]`) && !(await page.$(`${sec} pre`)), `${tag}: no id yet → "Show CSS rule"`);
      if (w === 1440 && scheme === 'dark') {   // the failure first: nothing found → plain words, nothing changed
        G2.M.menuCss = 'none';
        await page.click(`${sec} [data-f="cssread"]`);
        await page.waitForFunction(() => /Not found/.test(document.querySelector('#dPanel [data-msg]')?.textContent || ''), null, { timeout: 30000 });
        const msg = await page.textContent('#dPanel [data-msg]');
        check(/Nothing changed/.test(msg) && !/in_progress|queued|completed/.test(msg), `${tag}: no link found → plain words + Nothing changed (${msg.trim().slice(0, 90)})`);
        G2.M.menuCss = 'ok';
      }
      await page.click(`${sec} [data-f="cssread"]`);
      const during = await page.textContent('#dPanel [data-msg]').catch(() => '');
      check(!/in_progress|queued/.test(during), `${tag}: while reading, plain words (${during.trim().slice(0, 70)})`);
      await page.waitForSelector(`${sec} pre`, { timeout: 30000 });
      const rule = (await page.textContent(`${sec} pre`)).trim();
      check(rule === '/* KPI Dashboard · Law Firm Marketing Pros (LFMP) */\n#b7cc0202-aaaa-bbbb-cccc-000000000001 { order: -92 !important; }', `${tag}: the rule (letter start, as is): ${JSON.stringify(rule)}`);
      check((await page.textContent(sec)).includes('Paste into Agency → Settings → Company → White Label → Custom CSS, then Save.'), `${tag}: says where to paste it`);
      const d = G2.M.dispatches.filter(x => /menu-css/.test(x.workflow || x.path || JSON.stringify(x)));
      check(d.length >= 1 && G2.M.dispatches.every(x => !/menu-link/.test(JSON.stringify(x))), `${tag}: only menu-css.yml was started (no menu-link)`);
      await page.click(`${sec} [data-f="css"]`).catch(() => {});
      cf = await contrastFailures(page, '#dPanel'); check(!cf.length && await noSideScroll(page), `${tag}: Setup with the CSS rule passes AA contrast, no sideways scroll${cf.length ? `: ${cf.join(' | ')}` : ''}`);
      if (SHOTS) await page.locator(sec).screenshot({ path: join(SHOTS, `setup_css_${tag}.png`) });
    }
    await page.keyboard.press('Escape');
    check(!(await panelOpen(page)), `${tag}: Esc closes Details`);
    { const m2 = await openMe(page); await page.click(`${m2} [data-lv="news"]`); } await page.waitForSelector('.vcard');
    cf = await contrastFailures(page); check(!cf.length, `${tag}: What's new passes AA contrast${cf.length ? `: ${cf.join(' | ')}` : ''}`);
    await shot(page, `whatsnew_${tag}`);
    await page.keyboard.press('Escape');
    await page.click(w === 390 ? '[data-lv-ptop] [data-lv="plus"]' : '[data-lv-top] [data-lv="plus"]'); await page.waitForSelector('#nfForm');
    if (w === 390) check((await page.textContent('[data-lv-ptop] h2')).trim() === 'New firm', '390: the phone title says New firm');
    await page.waitForFunction(() => document.querySelector('#nfPreset option')?.textContent.includes('ACME'));
    check(await noSideScroll(page), `${tag}: New firm has no sideways scroll`);
    cf = await contrastFailures(page); check(!cf.length, `${tag}: New firm passes AA contrast${cf.length ? `: ${cf.join(' | ')}` : ''}`);
    await shot(page, `newfirm_app_${tag}`);
    await page.check('input[name="nfMode"][value="pi"]');
    await shot(page, `newfirm_pi_${tag}`);
    await page.click('#backBtn'); await page.waitForSelector(ROW);
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
