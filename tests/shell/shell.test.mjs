// v2 SHELL tests (redesign v2, Nov 2026). This file is byte-identical in all three repos:
//   ghl-subaccount-builder/tests/unit/shell.test.mjs   (npm test)
//   leadpro-kpi/tests/shell/shell.test.mjs             (node tests/shell/shell.test.mjs)
//   automation-review/admin/tests/shell.test.mjs       (node admin/tests/shell.test.mjs)
// It finds the repo's lfmp-session.js / lfmp-ui.css itself. Part 1 is pure (no browser). Part 2 runs the shell in
// Chromium when playwright-core is found (the Builder's node_modules, or PLAYWRIGHT_CORE) and CHROMIUM_PATH if set.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = ['../../page', '../../admin', '..'].map(p => path.resolve(HERE, p)).find(d => fs.existsSync(path.join(d, 'lfmp-session.js')) && fs.existsSync(path.join(d, 'lfmp-ui.css')));
if (!DIR) throw new Error('lfmp-session.js not found next to this test');
const S = await import(pathToFileURL(path.join(DIR, 'lfmp-session.js')).href);
const CSS = fs.readFileSync(path.join(DIR, 'lfmp-ui.css'), 'utf8');
const V2 = CSS.slice(CSS.lastIndexOf('/*', CSS.indexOf('v2 SHELL')));
const me = { name: 'Pee Jay Edrozo', email: 'pj@example.com', lastSignIn: '2026-11-16T11:31:00Z' };
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- part 1: pure
test('the three copies of lfmp-session.js, lfmp-ui.css and this test are byte-identical', () => {
  let code = HERE; while (code !== path.dirname(code) && !fs.existsSync(path.join(code, 'ghl-subaccount-builder'))) code = path.dirname(code);
  const sets = [
    ['ghl-subaccount-builder/page', 'leadpro-kpi/admin', 'automation-review/admin'].map(d => path.join(code, d)),
  ];
  const tests = ['ghl-subaccount-builder/tests/unit/shell.test.mjs', 'leadpro-kpi/tests/shell/shell.test.mjs', 'automation-review/admin/tests/shell.test.mjs'].map(f => path.join(code, f));
  if (!sets[0].every(d => fs.existsSync(d))) return test.skip?.('the other two repos are not next to this one');
  const md5 = f => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
  for (const f of ['lfmp-session.js', 'lfmp-ui.css']) assert.equal(new Set(sets[0].map(d => md5(path.join(d, f)))).size, 1, `${f} differs between the three repos`);
  const there = tests.filter(f => fs.existsSync(f));
  assert.equal(new Set(there.map(md5)).size, 1, 'shell.test.mjs differs between the repos');
});

test('initials: first letters of the first two words (the reference shows PJ for Pee Jay Edrozo)', () => {
  assert.equal(S.initials(me), 'PJ');
  assert.equal(S.initials({ name: 'PJ Tester' }), 'PT');
  assert.equal(S.initials({ name: 'PJ', email: 'pj@x.com' }), 'PJ');   // the live Google name is just "PJ"
  assert.equal(S.initials({ name: 'Sam' }), 'S');
  assert.equal(S.initials({ email: 'sam@x.com' }), 'S');
  assert.equal(S.initials({}), '·');
});

test('three tools in the same order everywhere: Clients · Scorecards · Reviews', () => {
  assert.deepEqual(S.SHELL_TOOLS.map(t => [t.id, t.label, t.path, t.plus]), [
    ['builder', 'Clients', '/ghl-subaccount-builder-page/', 'New sub-account'], ['kpi', 'Scorecards', '/leadpro-kpi/admin/', 'New firm'], ['review', 'Reviews', '/automation-review/admin/', null]]);
});

test('desktop top bar: icon + LFMP · nav (current = this tool) · [bell] · gold + · name + Last signed in · avatar · Sign out', () => {
  for (const t of S.SHELL_TOOLS) {
    const h = S.topBarHtml({ tool: t.id, me, bell: t.id === 'kpi', bellCount: 3, plus: t.plus ? { label: t.plus } : null });
    assert.equal(text(h), `LFMP Clients Scorecards Reviews ${t.id === 'kpi' ? '🔔 3 ' : ''}${t.plus ? `+ ${t.plus} ` : ''}Pee Jay Edrozo ${S.lastSignInText(me)} PJ Sign out`);
    assert.equal((h.match(/aria-current="page"/g) || []).length, 1);
    assert.match(h, new RegExp(`<a href="${t.path}" aria-current="page" data-lv-home>${t.label}</a>`));
    assert.match(h, /class="lv-mk"[^>]*><i><\/i><i><\/i><i><\/i><\/a>/, 'the 3-block LFMP icon');
    assert.match(h, /data-lv="signout"/); assert.match(h, /data-lv="me"/);
  }
  const q = S.topBarHtml({ tool: 'kpi', me, bell: true, bellCount: 0 });
  assert.match(q, /data-lv-badge hidden>0</, 'no count = badge hidden');
});

test('phone top bar: icon · TITLE · [bell] · gold round + · avatar', () => {
  const b = S.phoneBarHtml({ tool: 'builder', me, plus: { label: 'New sub-account' } });
  assert.equal(text(b), 'Clients + PJ');
  assert.match(b, /class="lv-pplus lv-hit" data-lv="plus" aria-label="New sub-account">\+</);
  assert.equal(text(S.phoneBarHtml({ tool: 'kpi', me, bell: true, bellCount: 1, plus: { label: 'New firm' } })), 'Scorecards 🔔 1 + PJ');
  assert.equal(text(S.phoneBarHtml({ tool: 'review', me })), 'Reviews PJ', 'Reviews: no bell, no +');
  assert.equal(text(S.phoneBarHtml({ tool: 'kpi', me, bell: true, plus: {}, meScreen: true }, 'Me')), 'Me PJ', 'the Me screen: title and avatar only');
});

test('bottom tabs: Clients · Scorecards · Reviews · Me; the current one is gold (aria-current); Me while Me is open', () => {
  const t = S.tabsHtml({ tool: 'kpi' });
  assert.equal(text(t), 'Clients Scorecards Reviews Me');
  assert.deepEqual([...t.matchAll(/href="([^"]+)"/g)].map(m => m[1]), S.SHELL_TOOLS.map(x => x.path));
  assert.match(t, /href="\/leadpro-kpi\/admin\/" aria-current="page" data-lv-home/);
  const m = S.tabsHtml({ tool: 'kpi' }, true);
  assert.match(m, /data-lv="metab" aria-current="page"/);
  assert.equal((m.match(/aria-current/g) || []).length, 1);
});

test('Me (identical in all three tools): avatar, name, Last signed in · SETTINGS · TEAM · red Sign out, in that order', () => {
  const h = S.meHtml({ tool: 'kpi', me, version: '1.23.0', showTests: { label: 'Show test clients' }, onRefresh() {},
    extras: { title: 'Scorecards', items: [{ label: 'Sync', value: 'every 30 min' }] } },   // extras are ignored: no tool-only section
    { theme: 'dark', showTests: true, updated: '4:57 PM', newsDot: true });
  assert.equal(text(h), `PJ Pee Jay Edrozo ${S.lastSignInText(me)} Settings Theme Auto Light Dark Show test clients Refresh now updated 4:57 PM Team Team sign-ins › What's new v1.23.0 › Install the app › Sign out`);
  assert.match(h, /data-v="dark" aria-pressed="true"/); assert.match(h, /data-v="auto" aria-pressed="false"/);
  assert.match(h, /role="switch" data-lv="tests" aria-labelledby="lvTestsL" aria-checked="true"/);
  assert.match(h, /data-lv="news" role="menuitem"><span>What&#39;s new<\/span><span class="lv-v"><span class="lv-ndot"/, 'unseen What\'s new: the dot is on its row');
  assert.match(h, /class="lv-mi out" data-lv="signout"/);
  for (const t of S.SHELL_TOOLS) assert.doesNotMatch(S.topBarHtml({ tool: t.id, me, newsDot: true }) + S.phoneBarHtml({ tool: t.id, me, newsDot: true }), /lv-dot|lv-ndot/, 'no dot on the avatar');
  const same = S.SHELL_TOOLS.map(t => S.meHtml({ tool: t.id, me, version: '1', showTests: {}, onRefresh() {} }, {}));
  assert.equal(new Set(same).size, 1, 'Me is the same in every tool');
  const plain = S.meHtml({ tool: 'review', me }, {});
  assert.equal(text(plain), `PJ Pee Jay Edrozo ${S.lastSignInText(me)} Settings Theme Auto Light Dark Team Team sign-ins › What's new › Install the app › Sign out`);
});

test('page head: title + summary (desktop), search, filter; the "Needs …" label is red only when asked', () => {
  const h = S.pageHeadHtml({ title: 'Clients', summary: '12 sub-accounts · 1 setting up', search: { id: 'q', placeholder: 'Search 12 clients' }, active: 'all',
    segs: [{ key: 'all', label: 'All 12', phone: 'All' }, { key: 'needs', label: 'Needs you · 1', red: true }, { key: 'done', label: 'Done · 0', phone: 'Done', red: false }] });
  assert.match(h, /<h1 class="lv-h1">Clients<\/h1>/); assert.match(h, /data-lv-sum>12 sub-accounts · 1 setting up</);
  assert.match(h, /id="q" placeholder="Search 12 clients"/);
  assert.match(h, /data-lv-seg="all" aria-pressed="true"><span class="lv-d">All 12<\/span><span class="lv-p">All<\/span>/);
  assert.equal((h.match(/lv-red/g) || []).length, 1);
  assert.match(h, /<label class="lv-search lv-hit">/, 'the whole search box (44px with its margin) focuses the input');
});

test('row: name + sub-line · cells · Open › (desktop) / phone right + ›; text is escaped', () => {
  const h = S.rowHtml({ name: 'Smith & <b>Jones</b>', sub: 'Family Law · KPI setup failed at step 6 of 9', subPhone: 'Family Law · KPI setup failed', cells: [S.statusHtml('red', 'Needs you'), S.squaresHtml(['red', '', ''])], attrs: 'data-rec="x"' });
  assert.match(h, /^<div class="lv-row" role="button" tabindex="0" aria-label="Open Smith &amp; &lt;b&gt;Jones&lt;\/b&gt;" data-rec="x">/);
  assert.match(h, /<div class="lv-mt lv-d">Family Law · KPI setup failed at step 6 of 9<\/div><div class="lv-mt lv-p">Family Law · KPI setup failed<\/div>/);
  assert.match(h, /<div class="lv-c lv-op">Open ›<\/div><div class="lv-c lv-pr"><span class="lv-st red"><b><\/b>Needs you<\/span><\/div><span class="lv-chev" aria-hidden="true">›<\/span>/);
  assert.match(S.squaresHtml(['green', '', 'blue']), /<i class="green"><\/i><i class="o"><\/i><i class="blue"><\/i><em>KPI · Review · Forms<\/em>/);
  assert.match(S.bigHtml('—', 'leads · 90 days', true), /lv-big red">—<small>leads · 90 days/);
});

// colour tokens (approved 17 Nov 2026: reference + PJ's AA fixes)
const tokens = block => Object.fromEntries([...block.matchAll(/--([a-z-]+):(#[0-9a-f]{6})/g)].map(m => [m[1], m[2]]));
const LIGHT = tokens(V2.slice(V2.indexOf(':root.lfmp-v2{'), V2.indexOf('}', V2.indexOf(':root.lfmp-v2{'))));
const DARK = tokens(V2.slice(V2.indexOf(':root.lfmp-v2[data-theme="dark"]{'), V2.indexOf('}', V2.indexOf(':root.lfmp-v2[data-theme="dark"]{'))));
test('colours: one neutral set + gold/red/blue/green/amber, light and dark (approved values)', () => {
  assert.deepEqual([LIGHT.bg, LIGHT.panel, LIGHT.line, LIGHT.gold, LIGHT['gold-ink'], LIGHT.mut, LIGHT.sub, LIGHT.chev, LIGHT.red, LIGHT.green, LIGHT.blue, LIGHT.amber, LIGHT.ink],
    ['#f6f5f2', '#ffffff', '#e6e2da', '#a8741f', '#8e621a', '#6b6861', '#6a6863', '#949494', '#b8322b', '#2e8a58', '#3c6fb5', '#c58a1c', '#151515']);
  assert.deepEqual([DARK.bg, DARK.panel, DARK.line, DARK.gold, DARK.mut, DARK.red, DARK.green, DARK.blue, DARK.amber, DARK.ink],
    ['#0e0e10', '#16161a', '#26262b', '#d9a64e', '#8f8e94', '#ef5a52', '#46b37f', '#7aa7e6', '#e0a43a', '#f2f1ee']);
  // the auto-dark block is the same as the forced-dark one
  const auto = tokens(V2.slice(V2.indexOf('@media (prefers-color-scheme:dark){:root.lfmp-v2'), V2.indexOf('}}', V2.indexOf('@media (prefers-color-scheme:dark){:root.lfmp-v2'))));
  assert.deepEqual(auto, DARK);
  // no other accent: the tools' old --acc is neutral ink
  assert.equal(LIGHT.acc, LIGHT.ink); assert.equal(DARK.acc, DARK.ink);
});

const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
test('AA contrast: every text pair the shell uses passes 4.5:1 (icons 3:1)', () => {
  for (const [T, name] of [[LIGHT, 'light'], [DARK, 'dark']]) {
    const pairs = [['ink', 'bg'], ['ink', 'panel'], ['mut', 'panel'], ['mut', 'bg'], ['mut', 'seg'], ['sub', 'seg'], ['sub', 'panel'], ['gold-ink', 'panel'], ['gold-ink', 'soft'], ['red', 'panel'], ['red', 'seg'], ['gold-on', 'gold'], ['ink', 'segon']];
    for (const [f, b] of pairs) assert.ok(ratio(T[f], T[b]) >= 4.5, `${name}: ${f} ${T[f]} on ${b} ${T[b]} = ${ratio(T[f], T[b]).toFixed(2)}`);
    assert.ok(ratio(T.chev, T.panel) >= 3, `${name}: chevron`);
  }
});

test('gold only on: + button, current tab/nav, top line, initials, on-switches', () => {
  const rules = [...V2.matchAll(/([^{}]+)\{([^{}]*var\(--gold[^{}]*)\}/g)].map(m => m[1].trim().replace(/^.*\*\/\s*/s, ''));
  const allowed = [/^\.lv-av$/, /^\.lv-top$/, /^\.lv-plus$/, /^\.lv-tg\[aria-checked="true"\]$/, /^\.lv-band$/, /^\.lv-pplus$/, /^\.lv-tab\[aria-current="page"\]( svg)?$/];
  assert.ok(rules.length >= 7);
  for (const r of rules) assert.ok(allowed.some(a => a.test(r)), `gold used on ${r}`);
});

test('scoped: v2 rules only touch pages with <html class="lfmp-v2"> or the shell\'s own .lv-* elements (sign-in / Moved pages unchanged)', () => {
  const body = V2.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
  const sels = [...body.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap(m => m[1].split(',').map(s => s.trim())).filter(Boolean);
  assert.ok(sels.length > 80);
  for (const s of sels) assert.ok(/^(:root\.lfmp-v2|\.lfmp-v2 |\.lv-|(body|div|a|button)\.lv-)/.test(s), `unscoped selector: ${s}`);
});

// ---------------------------------------------------------------- part 2: in a browser
const pwDir = process.env.PLAYWRIGHT_CORE || [path.resolve(HERE, '../../node_modules/playwright-core'), ...['../../../ghl-subaccount-builder', '../../ghl-subaccount-builder', '../../../../ghl-subaccount-builder'].map(p => path.resolve(HERE, p, 'node_modules/playwright-core'))].find(p => fs.existsSync(path.join(p, 'package.json')));
const tb = pwDir ? test : test.skip;
tb('in Chromium: Me items, bottom tabs, bell count, Sign out, Install the app, tap targets, no sideways scroll (390 + 1440)', { timeout: 120000 }, async () => {
  const { chromium } = createRequire(path.join(pwDir, 'package.json'))('./index.js');
  const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/lfmp-ui.css"></head><body><div id="app"><main class="lv-in" id="main"></main></div>
<script type="module">import * as S from '/lfmp-session.js'; const q = new URLSearchParams(location.search); window.log = [];
window.shell = S.mountShell({ tool: q.get('tool'), me: { name: 'Pee Jay Edrozo', email: 'pj@example.com', lastSignIn: '2026-11-16T11:31:00Z' }, root: document.getElementById('app'), version: '1.0.0',
 plus: q.get('tool') === 'review' ? null : { label: 'New', onClick: () => log.push('plus') }, bell: q.get('tool') === 'kpi' ? { onClick: () => log.push('bell') } : null,
 showTests: { on: false, onChange: v => log.push('tests:' + v) }, onRefresh: () => log.push('refresh'), onNews: () => log.push('news'), onHome: () => log.push('home'),
 newsDot: true });
document.getElementById('main').innerHTML = S.pageHeadHtml({ title: 'X', search: { placeholder: 'Search' }, segs: [{ key: 'a', label: 'All' }, { key: 'b', label: 'B' }], active: 'a' }) + '<div class="lv-list">' + S.rowHtml({ name: 'A', sub: 'b', cells: [S.statusHtml('green', 'All set')] }) + '</div>';
document.querySelector('.lv-row').addEventListener('click', () => log.push('row'));</script></body></html>`;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/' || u.pathname.endsWith('/admin/') || u.pathname.endsWith('-page/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
    if (u.pathname === '/lfmp-session.js' || u.pathname === '/lfmp-ui.css') { res.writeHead(200, { 'Content-Type': u.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' }); return res.end(fs.readFileSync(path.join(DIR, u.pathname.slice(1)))); }
    if (u.pathname === '/cdn-cgi/access/logout') { server.logouts = (server.logouts || 0) + 1; res.writeHead(200); return res.end(''); }
    if (u.pathname.startsWith('/signin/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<title>signed out</title>'); }
    if (u.pathname === '/api/signins') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ people: [{ name: 'PJ', email: 'pj@example.com', last: '2026-11-16T11:31:00Z', count30: 3 }] })); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    for (const [w, h] of [[390, 844], [1440, 900]]) {
      const phone = w < 880;
      for (const tool of ['builder', 'kpi', 'review']) {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        await page.goto(`${base}/?tool=${tool}`); await page.waitForSelector('.lv-row');
        const bar = phone ? '[data-lv-ptop]' : '[data-lv-top]', me = phone ? '[data-lv-me]' : '[data-lv-pop]';
        const log = () => page.evaluate(() => window.log.splice(0));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${tool} ${w}: no sideways scroll`);
        // + and bell
        assert.equal(await page.locator(`${bar} [data-lv="plus"]`).count(), tool === 'review' ? 0 : 1, `${tool}: + button`);
        assert.equal(await page.locator(`${bar} [data-lv="bell"]`).count(), tool === 'kpi' ? 1 : 0, `${tool}: bell`);
        if (tool !== 'review') { await page.click(`${bar} [data-lv="plus"]`); assert.deepEqual(await log(), ['plus']); }
        if (tool === 'kpi') {
          assert.equal(await page.isVisible(`${bar} [data-lv-badge]`), false, 'bell: no count = no badge');
          await page.evaluate(() => shell.setBell(2));
          assert.equal(await page.textContent(`${bar} [data-lv-badge]`), '2'); assert.equal(await page.isVisible(`${bar} [data-lv-badge]`), true);
          assert.equal(await page.getAttribute(`${bar} [data-lv="bell"]`, 'aria-label'), 'Sync issues: 2');
          assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(innerWidth < 880 ? '[data-lv-ptop] [data-lv-badge]' : '[data-lv-top] [data-lv-badge]')).backgroundColor), 'rgb(184, 50, 43)', 'red count');
          await page.click(`${bar} [data-lv="bell"]`); assert.deepEqual(await log(), ['bell']);
          await page.evaluate(() => shell.setBell(0)); assert.equal(await page.isVisible(`${bar} [data-lv-badge]`), false);
        }
        // Me: items in order, each one works
        await page.click(`${bar} [data-lv="me"]`); await page.waitForSelector(`${me}:not([hidden]) .lv-mlist`);
        const items = await page.locator(`${me} .lv-mi`).evaluateAll(els => els.map(e => (e.firstElementChild || e).textContent.trim()));
        assert.deepEqual(items, ['Theme', 'Show test clients', 'Refresh now', 'Team sign-ins', "What's new", 'Install the app', 'Sign out'], `${tool} ${w}: Me items`);
        assert.equal(await page.locator(`${bar} .lv-av [data-lv-dot], ${bar} .lv-av .lv-dot`).count(), 0, 'no dot on the avatar');
        assert.equal(await page.locator(`${me} [data-lv="news"] .lv-ndot`).count(), 1, 'the new dot is on the What\'s new row');
        if (phone) {
          assert.equal(await page.getAttribute('.lv-tabs [data-lv="metab"]', 'aria-current'), 'page', 'Me tab gold while open');
          // a tool's toast (z-index 70, like the Builder's What's new) never covers Me; the bottom tabs stay on top of Me
          const covered = await page.evaluate(() => {
            const t = document.createElement('div'); t.id = 'fakeToast'; t.style.cssText = 'position:fixed;left:0;right:0;bottom:90px;height:420px;z-index:70;background:red'; document.body.append(t);
            const at = el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); };
            const so = document.querySelector('[data-lv-me] [data-lv="signout"]'); so.scrollIntoView({ block: 'center' });
            const res = [at(so)?.closest('[data-lv="signout"]') === so, at(document.querySelector('.lv-tabs [data-lv="metab"]'))?.closest('[data-lv="metab"]') !== null];
            t.remove(); return res;
          });
          assert.deepEqual(covered, [true, true], 'Me above toasts, tabs above Me');
        }
        await page.click(`${me} [data-lv="theme"][data-v="dark"]`); assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
        await page.click(`${me} [data-lv="theme"][data-v="auto"]`); assert.equal(await page.getAttribute('html', 'data-theme'), null);
        await page.click(`${me} [data-lv="tests"]`); assert.equal(await page.getAttribute(`${me} [data-lv="tests"]`, 'aria-checked'), 'true');
        await page.click(`${me} [data-lv="refresh"]`); assert.deepEqual(await log(), ['tests:true', 'refresh']);
        if (phone) {   // tap targets ≥ 44px on phone (the visible control or its hit area)
          const small = await page.evaluate(() => [...document.querySelectorAll('[data-lv-ptop] button, [data-lv-ptop] a, .lv-tabs > *, [data-lv-me] button, [data-lv-me] a, .lv-seg button, .lv-search, .lv-row')].filter(e => e.offsetParent).map(e => {
            const r = e.getBoundingClientRect(), a = getComputedStyle(e, '::after'); const hit = e.classList.contains('lv-hit') ? [parseFloat(a.width), parseFloat(a.height)] : [0, 0];
            return [e.className || e.tagName, Math.max(r.width, hit[0]), Math.max(r.height, hit[1])]; }).filter(([, ww, hh]) => ww < 44 || hh < 44));
          assert.deepEqual(small, [], `${tool}: tap targets under 44px`);
        }
        await page.click(`${me} [data-lv="news"]`); assert.deepEqual(await log(), ['news']);
        assert.equal(await page.locator(`${me}:not([hidden])`).count(), 0, 'What\'s new closes Me');
        await page.click(`${bar} [data-lv="me"]`); await page.click(`${me} [data-lv="signins"]`);
        await page.waitForSelector('#lfmpSignins[open] .lfmp-signins'); await page.keyboard.press('Escape');
        await page.click(`${bar} [data-lv="me"]`); await page.click(`${me} [data-lv="install"]`);
        await page.waitForSelector('#lfmpInstall[open]'); assert.match(await page.textContent('#lfmpInstall'), /Install the app/); await page.keyboard.press('Escape');
        await page.evaluate(() => { window.LFMPApp = { openInstall: () => window.log.push('app-install') }; });
        await page.click(`${bar} [data-lv="me"]`); await page.click(`${me} [data-lv="install"]`); assert.deepEqual(await log(), ['app-install'], 'Install uses the app script when it is there');
        await page.click(`${bar} [data-lv="me"]`); await page.keyboard.press('Escape'); assert.equal(await page.locator(`${me}:not([hidden])`).count(), 0, 'Esc closes Me');
        // rows open with Enter too
        await page.focus('.lv-row'); await page.keyboard.press('Enter'); assert.deepEqual(await log(), ['row']);
        // home: this tool's own link goes home without a reload; another tool's tab/nav link navigates there
        await page.click(phone ? `.lv-tabs a[aria-current="page"]` : '.lv-nav a[aria-current="page"]'); assert.deepEqual(await log(), ['home']);
        const other = S.SHELL_TOOLS.find(t => t.id !== tool);
        await Promise.all([page.waitForURL(`${base}${other.path}`), page.click(phone ? `.lv-tabs a[href="${other.path}"]` : `.lv-nav a[href="${other.path}"]`)]);
        await page.goto(`${base}/?tool=${tool}`); await page.waitForSelector('.lv-row');
        // Sign out: Access logout, then /signin/?out=1
        const before = server.logouts || 0;
        if (phone) { await page.click(`${bar} [data-lv="me"]`); await page.click(`${me} [data-lv="signout"]`); } else await page.click('.lv-top .lv-so');
        await page.waitForURL(`${base}/signin/?out=1`); assert.equal(server.logouts, before + 1, 'Access logout called');
        await page.close();
      }
    }
  } finally { await browser.close(); server.close(); }
});
