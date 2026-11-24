// v1.28.0 browser test: PBPCS as a Draft Medical & dental scorecard, Map pipelines, Edit mapping, New firm (Medical),
// Setup (Draft / Publish / counts only / Copy link blocked), the bell's "stages not mapped" notice, and the dashboard.
//   Run:  CHROMIUM_PATH=… node tests/care/ui.mjs [screenshot-folder]
// Same set-up as tests/admin-ui/run.mjs (real team-site /api/ server behind a stand-in for Cloudflare Access, mock GitHub).
// PBPCS's files exist only in the mock's memory (overlay): fixture data made by the REAL sync against a mock GHL with
// PBPCS's pipelines as PJ listed them and ~150 made-up people. Writes nothing in the repo.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMockGitHub } from '../admin-ui/mock-github.mjs';
import { startMock } from './mock-ghl.mjs';
import * as CC from '../../scripts/care-core.mjs';
import { quiet } from '../quiet-browser.mjs';   // FIX 10.0: no sound from test browsers

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHOTS = process.argv[2] || '';
const pwPath = process.env.PLAYWRIGHT_CORE || join(ROOT, '../ghl-subaccount-builder/node_modules/playwright-core');
if (!existsSync(join(pwPath, 'package.json'))) { console.log('Skipped: playwright-core not found.'); process.exit(0); }
const { chromium } = await import(pathToFileURL(join(pwPath, 'index.mjs')).href);
const { createTestAccess } = await import(pathToFileURL(join(ROOT, '../ghl-subaccount-builder/admin-site/lib/test-access.mjs')).href);
const EMAIL = 'pj@lawfirmmarketingpros.com', SLUG = 'palm-beach-plastic', LOC = 'ZccxN6Zevq1UkgUuOphV', PASS = 'fixture-passphrase-pbpcs';
const DAY = 864e5, jsonText = o => JSON.stringify(o, null, 2) + '\n';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.md': 'text/markdown', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

let failed = 0, passed = 0;
const check = (v, what, extra = '') => { if (v) { passed++; console.log(`✓ ${what}`); } else { failed++; console.log(`✗ ${what}${extra ? `\n    ${extra}` : ''}`); } };

// ---------- PBPCS fixture: pipelines (PJ's names, made-up ids) + ~150 people, synced by the real sync ----------
const PIPES = [
  ['Marketing Pipeline', ['New Lead', 'Attempting Contact', 'Connected / Qualifying', 'Closed – Lost']],
  ['Surgical Patients', ['Qualified', 'Consult Booked (In-person / Virtual)', 'Consult Completed', 'Quote Sent / Deciding', 'Deposit Paid / Surgery Scheduled', 'Surgery Completed']],
  ['BII / Explant', ['Qualified', 'Consult Booked (In-person / Virtual)', 'Consult Completed', 'Quote Sent / Deciding', 'Deposit Paid / Surgery Scheduled', 'Travel Confirmed', 'Surgery Completed']],
  ['Non-Surgical / Med Spa', ['Qualified', 'Appointment Booked', 'Treatment Completed', 'Rebook Due']],
  ['Post-Op & Retention', ['1-Week Check', '3-Month Check', 'Review Requested', 'Review Left', 'Referral / Next Procedure']],
];
const discovery = { generatedAt: new Date().toISOString(), slug: SLUG, locationId: LOC, locationName: 'Palm Beach Plastic and Cosmetic Surgery', scopes: { ok: [], missing: [], unchecked: [], tokenRejected: false },
  pipelines: PIPES.map(([name, stages], i) => ({ id: `pbP${i + 1}xxxxxxxxxxxx`, name, stages: stages.map((s, j) => ({ id: `pbP${i + 1}S${j + 1}-0000-4000-8000-000000000000`, name: s, position: j })) })), calendars: [], customFields: { contact: [], opportunity: [] } };
const P = n => discovery.pipelines.find(p => p.name === n), S = (p, s) => P(p).stages.find(x => x.name === s).id;
let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const opps = []; let n = 0;
const at = d => new Date(Date.now() - d * DAY - 4 * 3600e3).toISOString();
const add = (cid, pipe, stage, d, extra = {}) => opps.push({ id: `pb${++n}`, contactId: cid, pipelineId: P(pipe).id, pipelineStageId: S(pipe, stage), status: 'open', monetaryValue: 0, createdAt: at(d), updatedAt: at(d), name: `Opp ${n}`, ...extra });
for (let i = 0; i < 150; i++) {
  const cid = `pbC${String(i).padStart(4, '0')}xxxxxxxxxxx`, d = 1 + Math.floor(rnd() * 110), r = rnd();
  if (r < 0.2) { add(cid, 'Marketing Pipeline', 'New Lead', d); continue; }
  if (r < 0.3) { add(cid, 'Marketing Pipeline', 'Attempting Contact', d, rnd() < 0.4 ? { status: 'abandoned' } : {}); continue; }
  if (r < 0.4) { add(cid, 'Marketing Pipeline', 'Closed – Lost', d, { status: 'lost' }); continue; }
  add(cid, 'Marketing Pipeline', 'Connected / Qualifying', d);
  const path = rnd(), pipe = path < 0.55 ? 'Surgical Patients' : path < 0.65 ? 'BII / Explant' : 'Non-Surgical / Med Spa';
  const steps = pipe === 'Non-Surgical / Med Spa' ? ['Qualified', 'Appointment Booked', 'Treatment Completed'] : ['Qualified', 'Consult Booked (In-person / Virtual)', 'Consult Completed', 'Quote Sent / Deciding', 'Deposit Paid / Surgery Scheduled', 'Surgery Completed'];
  let k = 0; while (k < steps.length - 1 && rnd() < 0.72) k++;
  const value = pipe === 'Non-Surgical / Med Spa' ? 300 + Math.floor(rnd() * 1700) : 8000 + Math.floor(rnd() * 17000);
  add(cid, pipe, steps[k], Math.max(1, d - 2), { monetaryValue: value });
  if (steps[k] === 'Surgery Completed' && rnd() < 0.6) add(cid, 'Post-Op & Retention', '1-Week Check', Math.max(1, d - 10));
}
const template = JSON.parse(await readFile(join(ROOT, 'firms/_template/config.json'), 'utf8'));
const preset = JSON.parse(await readFile(join(ROOT, 'firms/_presets/care/palm-beach-plastic.json'), 'utf8'));
const pipelineMap = CC.buildPipelineMap(CC.careInitialState({ discovery, config: {}, preset }));
const config = { ...template, locationName: 'Palm Beach Plastic and Cosmetic Surgery', practiceArea: 'Plastic & Cosmetic Surgery', locationId: LOC, title: '', timezone: 'America/New_York', practiceType: 'medical', countsOnly: true, pipelineMap };
const entry = { slug: SLUG, secretKey: 'PALM_BEACH_PLASTIC', name: 'Palm Beach Plastic and Cosmetic Surgery', practiceArea: 'Plastic & Cosmetic Surgery', locationId: LOC, createdAt: new Date(Date.now() - 2 * 3600e3).toISOString(), tokenSource: 'app', createdBy: 'admin', practiceType: 'medical', status: 'draft' };
const files = {};
{
  const tmp = await mkdtemp(join(tmpdir(), 'lpk-pbpcs-'));
  await cp(join(ROOT, 'scripts'), join(tmp, 'scripts'), { recursive: true });
  await mkdir(join(tmp, 'firms', SLUG), { recursive: true });
  await cp(join(ROOT, 'firms/_defaults.json'), join(tmp, 'firms/_defaults.json')); await cp(join(ROOT, 'firms/_defaults'), join(tmp, 'firms/_defaults'), { recursive: true });
  await writeFile(join(tmp, `firms/${SLUG}/config.json`), jsonText(config)); await writeFile(join(tmp, `firms/${SLUG}/discovery.json`), jsonText(discovery));
  await writeFile(join(tmp, 'firms/index.json'), jsonText([entry]));
  const mock = await startMock({ pipelines: discovery.pipelines, opps, events: [] });
  try { await run(process.execPath, [join(tmp, 'scripts/sync.mjs'), SLUG], { env: { ...process.env, GHL_API_BASE: mock.url, GHL_TOKEN: 'mock', DASHBOARD_PASSPHRASE: PASS, GHL_BACKOFF_MS: '10' } }); }
  finally { await mock.close(); }
  files[`firms/${SLUG}/data/kpis.json`] = await readFile(join(tmp, `firms/${SLUG}/data/kpis.json`), 'utf8');
  files[`firms/${SLUG}/data/details.enc.json`] = await readFile(join(tmp, `firms/${SLUG}/data/details.enc.json`), 'utf8');
  await rm(tmp, { recursive: true, force: true });
}
files[`firms/${SLUG}/config.json`] = jsonText(config);
files[`firms/${SLUG}/discovery.json`] = jsonText(discovery);
files[`firms/${SLUG}/index.html`] = await readFile(join(ROOT, 'firms/_template/index.html'), 'utf8');
const k30 = JSON.parse(files[`firms/${SLUG}/data/kpis.json`]).periods.last30.current;
console.log(`Fixture: ${opps.length} opportunities → last 30 days ${k30.enquiries} enquiries, ${k30.booked} consults booked, ${k30.yes} accepted, ${k30.done} completed, $${k30.value}`);

// ---------- servers ----------
const ACCESS = createTestAccess({ names: { [EMAIL]: 'PJ Drozo' } });
let G, deps;
function freshGitHub({ status = 'draft', drift = null } = {}) {
  G = createMockGitHub({ root: ROOT });
  G.M.careDiscovery = jsonText(discovery);
  for (const [p, t] of Object.entries(files)) G.M.overlay.set(p, t);
  const idx = JSON.parse(readIndexText);
  idx.push({ ...entry, ...(status ? { status } : {}) }); if (!status) delete idx[idx.length - 1].status;
  G.M.overlay.set('firms/index.json', jsonText(idx));
  if (drift) { const k = JSON.parse(files[`firms/${SLUG}/data/kpis.json`]); k.sync.drift = drift; G.M.overlay.set(`firms/${SLUG}/data/kpis.json`, jsonText(k)); }
  deps = ACCESS.deps({ githubApi: 'https://github.test', github: async (method, path, body) => {
    const { status: s, json } = await G.handle(method, `https://api.github.com${path}`, body === undefined ? null : JSON.stringify(body));
    return { status: s, body: json === null ? '' : JSON.stringify(json) };
  } });
}
const readIndexText = await readFile(join(ROOT, 'firms/index.json'), 'utf8');
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  if (path.startsWith('/api/')) return ACCESS.serve(req, res, { env: ACCESS.env(), deps, email: EMAIL });
  if (path.startsWith('/signin/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<!doctype html><title>Sign in</title>'); }
  let p = normalize(decodeURIComponent(path)).replace(/^\/+/, '');
  if (p.endsWith('/') || p === '') p += 'index.html';
  if (G?.M.overlay.has(p)) { res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'text/plain' }); return res.end(G.M.overlay.get(p)); }
  try { const b = await readFile(join(ROOT, p)); res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`, ADMIN = `${ORIGIN}/admin/?repo=peejayedz/leadpro-kpi`, DASH = `${ORIGIN}/firms/${SLUG}/`;
const browser = await quiet(await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--mute-audio'] }));
const SODIUM_STUB = `window.sodium = { ready: Promise.resolve(), from_string: s => new TextEncoder().encode(s), from_base64: b => Uint8Array.from(atob(b), c => c.charCodeAt(0)), to_base64: u => btoa(String.fromCharCode(...u)), crypto_box_seal: (m, pk) => Uint8Array.from([0xEE, ...m]) };`;
async function open(url, { width = 1440, height = 900, scheme = 'light', admin = true } = {}) {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width, height }, colorScheme: scheme, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  page.on('pageerror', e => { failed++; console.log(`✗ page error (${url.split('/').slice(3).join('/')}): ${e.message}`); });
  if (process.env.UI_DEBUG) { page.on('request', r => { if (r.url().includes('/api/')) console.log(`  req ${r.postData()?.slice(0, 140)}`); }); page.on('console', m => console.log(`  console: ${m.text().slice(0, 200)}`)); page.on('response', r => { if (r.url().includes('/api/')) r.text().then(t => console.log(`  api ${r.status()} ${r.request().postData()?.slice(0, 160)} → ${t.slice(0, 160)}`)).catch(() => {}); }); }
  await page.addInitScript(() => { const d = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'integrity'); Object.defineProperty(HTMLScriptElement.prototype, 'integrity', { set(v) { if (!String(this.src).includes('cdnjs.cloudflare.com')) d.set.call(this, v); }, get() { return d.get.call(this); } }); });
  await page.route('https://cdnjs.cloudflare.com/**', r => r.fulfill({ contentType: 'text/javascript', body: SODIUM_STUB }));
  await page.addInitScript(() => { try { localStorage.setItem('leadpro-admin-news-seen', '99.0.0'); if (!localStorage.getItem('lfmp-done')) localStorage.setItem('lfmp-done', JSON.stringify({ animation: 'classic' })); } catch {} });   // + v2.10.0: today's flow = Done moments Classic   // What's new card already seen (keeps it off the screenshots)
  await page.goto(url);
  if (admin) await page.waitForFunction(() => !document.getElementById('appView').hidden && document.querySelector('[data-lv-top]'));
  return { ctx, page };
}
// Since 20 Nov (Part 4) every save asks first (the confirm popup): answer it, like a person pressing the action
const answerConfirm = async page => { try { await page.waitForSelector('[data-lv-cf-shade] [data-lv-cf="ok"]', { timeout: 4000 }); await page.click('[data-lv-cf="ok"]'); } catch {} };
const shot = async (page, name, full = true) => { if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: full }); } };
const noSideScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const contrast = page => page.evaluate(() => {
  const rgb = s => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0.5) return c; } return rgb(getComputedStyle(document.body).backgroundColor); };
  const out = [];
  for (const el of document.querySelectorAll('#screen *, #app *, #exec *, #draftNote *')) {
    if (!el.offsetParent) continue;
    if (![...el.childNodes].some(x => x.nodeType === 3 && x.textContent.trim())) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.6 || el.closest('[disabled]') || el.closest('.off')) continue;
    const a = lum(rgb(cs.color)), b = lum(bgOf(el)), ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(cs.fontSize), large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) out.push(`${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 30)}" ${ratio.toFixed(2)}`);
  }
  return [...new Set(out)].slice(0, 8);
});
const SIZES = [['1440', 1440, 900], ['390', 390, 844]];
// Waits (in Node) until the mock has n commits and, optionally, a sync dispatch for the slug (max 20 s).
const until = async (fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 200)); } return false; };
const committed = (n = 1, sync = true) => until(() => G.M.commits.length >= n && (!sync || G.M.dispatches.some(d => d.workflow === 'sync.yml' && d.inputs?.slug === SLUG)));
const SCHEMES = ['light', 'dark'];

try {
  // ================= dashboard (Draft, counts only) =================
  freshGitHub();
  for (const [w, width, height] of SIZES) for (const scheme of SCHEMES) {
    const { ctx, page } = await open(DASH, { width, height, scheme, admin: false });
    await page.waitForSelector('#app .hero');
    if (w === '1440' && scheme === 'light') {
      check(await page.isVisible('#draftNote .notice.draft') && await page.isVisible('#draftChip'), 'dashboard: Draft banner + Draft chip');
      const labels = await page.$$eval('#app .stage .label', els => els.map(e => e.textContent.trim()));
      check(JSON.stringify(labels) === JSON.stringify(['Patient enquiries', 'Consults booked', 'Show rate', 'Treatment accepted', 'Procedures completed', 'Value']), `dashboard: Medical metrics in order (no-show hidden: no no-show data) · ${labels.join(' · ')}`);
      const funnel = await page.$$eval('#app .funnel .frow > span:first-child', els => els.map(e => e.textContent.trim()));
      check(funnel.join('|') === 'Patient enquiries|Contacted|Consults booked|Consults attended|Treatment accepted|Procedures completed', `dashboard: funnel ${funnel.join(' → ')}`);
      check((await page.textContent('#app .hero .left .label')).trim() === 'Enquiry → treatment accepted', 'dashboard: hero "Enquiry → treatment accepted"');
      check(!/signed|agreement|law/i.test(await page.textContent('#app')), 'dashboard: no law-firm wording (signed, agreement)');
      const big = await page.textContent('#app .stage .metric .mv b');
      check(Number(big) === k30.enquiries, `dashboard: Patient enquiries = ${k30.enquiries} (last 30 days, from kpis.json)`);
      // How this works
      await page.click('#discMore').catch(() => {});
    }
    check(await noSideScroll(page), `dashboard ${w} ${scheme}: no sideways scroll`);
    // .pct (funnel "% of …") and .summary .none use --ink-3 (#7a8293 on white = 3.86:1): the SAME token every law-firm
    // dashboard uses today, so it's listed as an open item (pre-existing), not counted as a failure of this change.
    const all = await contrast(page), pre = all.filter(x => /^(SPAN\.pct|P\.none) /.test(x)), bad = all.filter(x => !pre.includes(x));
    check(!bad.length, `dashboard ${w} ${scheme}: AA contrast (new elements)`, bad.join('; '));
    if (pre.length) console.log(`  open (pre-existing, law dashboards too): ${pre.length} light-grey text item(s) at 3.86:1 (--ink-3)`);
    await shot(page, `dashboard-pbpcs-draft-${w}-${scheme}`);
    await ctx.close();
  }
  { // unlocked: counts-only drill-down
    const { ctx, page } = await open(`${DASH}#k=${encodeURIComponent(PASS)}`, { admin: false });
    await page.waitForSelector('#app .hero');
    await page.waitForFunction(() => /Lock details/.test(document.getElementById('lockBtn').textContent));
    check(true, 'dashboard: passphrase unlocks ("Lock details" for counts only)');
    await page.click('#app [data-drill="booked"]');
    await page.waitForSelector('#modal .dt');
    const head = await page.$$eval('#modal thead th', els => els.map(e => e.textContent.replace(/[↕▲▼]/g, '').trim()));
    check(head.join('|') === 'Pipeline|Where they are now|Step|Patients', `drill-down (counts only): ${head.join(' · ')}`);
    check(await page.isVisible('#modal a.mghl') && /\/v2\/location\/ZccxN6Zevq1UkgUuOphV\/opportunities\/list$/.test(await page.getAttribute('#modal a.mghl', 'href')), 'drill-down: "Open in GHL" goes to PBPCS opportunities');
    const sum = await page.textContent('#modal .msum');
    check(new RegExp(`^${k30.booked} patients?`).test(sum.trim()), `drill-down: "${sum.trim()}" (people, not rows)`);
    const txt = await page.textContent('#modal');
    check(!/@|\+1\d|Person |pbC0/.test(txt), 'drill-down: no names, emails, phones or contact ids');
    await shot(page, 'dashboard-pbpcs-drill-counts-only-1440-light', false);
    await page.click('#modal [data-close]');
    await page.click('#app .stage .metric[data-drill="showRate"]');
    await page.waitForSelector('#modal .dt');
    check(/out of \d+ consults booked/.test(await page.textContent('#modal .msum')), 'drill-down: Show rate says "out of N consults booked"');
    await ctx.close();
  }

  // ================= admin: list, Setup (Draft), Publish, counts only =================
  {
    const { ctx, page } = await open(ADMIN);
    await page.waitForSelector(`#firmRows .lv-row[data-slug="${SLUG}"]`);
    const sub = await page.textContent(`#firmRows .lv-row[data-slug="${SLUG}"] .lv-sb, #firmRows .lv-row[data-slug="${SLUG}"]`);
    check(/Medical & dental/.test(sub) && /Draft/.test(sub), 'firm list: PBPCS row says Medical & dental · Draft');
    await page.goto(`${ADMIN}#/firm/${SLUG}/setup`); await page.waitForSelector('#dPanel [data-sec="status"]');
    check(/Draft/.test(await page.textContent('#dPanel [data-sec="status"]')), 'Setup: Status = Draft, with Preview + Publish');
    check(await page.isDisabled('#dPanel [data-sec="menu-link"] button'), 'Setup: Copy GHL menu link is disabled while Draft');
    check(/Medical & dental/.test(await page.textContent('#dPanel')) && /Counts only/.test(await page.textContent('#dPanel')), 'Setup: practice type + Counts only shown');
    { const t = await page.textContent('#dPanel'); check(/Marketing Pipeline, Surgical Patients, BII \/ Explant, Non-Surgical \/ Med Spa/.test(t) && /Post-Op & Retention: all stages ignored/.test(t), 'Setup (review FIX 1.3): "Pipelines counted" = the dashboard\'s 4; Post-Op & Retention shown as all stages ignored'); }
    await shot(page, 'admin-setup-pbpcs-draft-1440-light', false);
    // Publish needs the tick
    await page.click('#dPanel [data-f="publish"]'); await page.waitForSelector('#dlgOk2');
    await page.click('#dlgOk'); check(/Tick the box/.test(await page.textContent('#dlgErr')), 'Publish: refused until "reviewed and approved" is ticked');
    await page.click('#dlgCancel');
    check(!G.M.commits.length, 'Publish cancelled: nothing written');
    // counts only toggle → one commit of config.json (countsOnly false) + a re-sync
    await page.click('#dPanel [data-f="counts"]');
    await committed(1);
    const cfgNow = JSON.parse(G.M.overlay.get(`firms/${SLUG}/config.json`));
    check(cfgNow.countsOnly === false && G.M.dispatches.some(d => d.workflow === 'sync.yml' && d.inputs?.slug === SLUG), 'Counts only toggle: config.json countsOnly → false, re-sync started');
    await ctx.close();
  }
  for (const [w, width, height] of SIZES) for (const scheme of SCHEMES) {   // Setup at 390 / dark
    if (w === '1440' && scheme === 'light') continue;
    freshGitHub();
    const { ctx, page } = await open(`${ADMIN}#/firm/${SLUG}/setup`, { width, height, scheme });
    await page.waitForSelector('#dPanel [data-sec="status"]'); await page.waitForTimeout(300);
    check(await noSideScroll(page), `Setup ${w} ${scheme}: no sideways scroll`);
    await shot(page, `admin-setup-pbpcs-draft-${w}-${scheme}`, false);
    await ctx.close();
  }
  { // Publish (ticked) → index.json status removed, re-sync
    freshGitHub();
    const { ctx, page } = await open(`${ADMIN}#/firm/${SLUG}/setup`);
    await page.waitForSelector('#dPanel [data-f="publish"]');
    await page.click('#dPanel [data-f="publish"]'); await page.check('#dlgOk2'); await page.click('#dlgOk');
    // v1.28.0: "Add to GHL menu" runs menu-link.yml (only the menu step); the mock clears the Draft status; then a re-sync
    await until(() => G.M.dispatches.some(d => d.workflow === 'sync.yml' && d.inputs?.slug === SLUG), 40000);
    const idx = JSON.parse(G.M.overlay.get('firms/index.json')).find(f => f.slug === SLUG);
    check(G.M.dispatches.filter(d => d.workflow === 'menu-link.yml' && d.inputs?.slug === SLUG).length === 1 && !G.M.commits.length, 'Add to GHL menu: one menu-link.yml run, nothing committed by the page');
    check(idx && !idx.status && G.M.dispatches.some(d => d.workflow === 'sync.yml'), 'Add to GHL menu: status cleared in firms/index.json (live), re-sync started', `idx=${JSON.stringify(idx)} commits=${G.M.commits.length} dispatches=${JSON.stringify(G.M.dispatches.map(d => d.workflow))} msg="${await page.textContent('#dPanel [data-msg]').catch(() => '')}"`);
    await page.waitForSelector('#dPanel [data-sec="menu-link"] [data-f="link"]', { timeout: 10000 }).catch(() => {});
    check(!!(await page.$('#dPanel [data-sec="menu-link"] [data-f="link"]')), 'after Publish: Copy GHL menu link is available');
    await ctx.close();
  }

  { // v1.32.1: GHL refuses the link → the Didn't work popup shows GHL's reason (from status/menu-link-<slug>.json), not "GitHub stopped it"
    freshGitHub();
    G.M.menuFail = 'GHL refused the link: openMode must be one of the following values: new_tab, current_tab (422).';
    const { ctx, page } = await open(`${ADMIN}#/firm/${SLUG}/setup`);
    await page.waitForSelector('#dPanel [data-f="publish"]');
    await page.click('#dPanel [data-f="publish"]'); await page.check('#dlgOk2'); await page.click('#dlgOk');
    await page.waitForSelector('.lv-res', { timeout: 40000 });
    const t = await page.textContent('.lv-res');
    check(/Didn't work/i.test(t) && t.includes(G.M.menuFail) && !/GitHub stopped it/.test(t), 'Add to GHL menu refused: the popup shows GHL\'s reason', t);
    const idx = JSON.parse(G.M.overlay.get('firms/index.json')).find(f => f.slug === SLUG);
    check(idx?.status === 'draft' && !G.M.dispatches.some(d => d.workflow === 'sync.yml') && !G.M.commits.length, 'refused: still a Draft, no re-sync, nothing committed by the page');
    await shot(page, 'admin-menu-refused-1440-light', false);
    await ctx.close();
  }

  // ================= Map pipelines (Needs mapping, pre-filled) =================
  for (const [w, width, height] of SIZES) for (const scheme of SCHEMES) {
    freshGitHub({ status: 'needsMapping' });
    const { ctx, page } = await open(`${ADMIN}#/map/${SLUG}`, { width, height, scheme });
    await page.waitForSelector('.caremap .cm-row');
    if (w === '1440' && scheme === 'light') {
      check((await page.textContent('#emTitle')).includes('pipelines'), 'Map pipelines: title "Map pipelines."');
      check(await page.isChecked('input[name="emType"][value="medical"]'), 'Map pipelines: practice type Medical & dental selected');
      const rows = await page.$$eval('.cm-row', els => els.length);
      check(rows === 26, `Map pipelines: 26 stages in 5 pipelines (${rows})`);
      const chosen = await page.$$eval('.cm-row', els => els.map(r => `${r.closest('.cm-pipe').querySelector('.cm-pn').textContent} · ${r.querySelector('.cm-sn').textContent} = ${r.querySelector('[aria-pressed="true"]')?.dataset.bucket || '—'}`));
      const want = Object.entries(preset.pipelines).flatMap(([p, ss]) => Object.entries(ss).map(([s, b]) => `${p} · ${s} = ${b}`));
      check(want.every(x => chosen.includes(x)), 'Map pipelines: every stage pre-filled with PJ\'s mapping', want.filter(x => !chosen.includes(x)).join('; '));
      check(/26 stages in 5 pipelines · 4 counted/.test(await page.textContent('.cm-sum')), 'Map pipelines header (review FIX 1.4): "26 stages in 5 pipelines · 4 counted"');
      check(/26 pre-filled/.test(await page.textContent('.cm-sum')) && (await page.$$('.cm-src')).length === 26, 'Map pipelines: each stage tagged "Pre-filled" until clicked');
      check(await page.isChecked('#cmCounts'), 'Map pipelines: Counts only ticked (Medical default)');
      await shot(page, `map-pipelines-pbpcs-${w}-${scheme}`);
      // change one chip: Rebook Due → Contacted, then back to Ignore
      const rebook = '.cm-pipe[data-pipe="pbP4xxxxxxxxxxxx"] .cm-row:last-child';
      await page.click(`${rebook} [data-bucket="contacted"]`);
      check(await page.getAttribute(`${rebook} [data-bucket="contacted"]`, 'aria-pressed') === 'true' && /25 pre-filled/.test(await page.textContent('.cm-sum')), 'Map pipelines: clicking a chip picks it and confirms that stage');
      await page.click(`${rebook} [data-bucket="ignore"]`);
      // untick a pipeline → its stages disappear; tick back
      await page.uncheck('[data-use="pbP5xxxxxxxxxxxx"]'); check(!(await page.$('.cm-pipe[data-pipe="pbP5xxxxxxxxxxxx"] .cm-row')), 'Map pipelines: unticking a pipeline leaves it out');
      await page.check('[data-use="pbP5xxxxxxxxxxxx"]');
      // switch to Law firm and back
      await page.click('label:has(input[name="emType"][value="law"])'); await page.waitForSelector('.map .mrow');
      check(/Edit/.test(await page.textContent('#emTitle')) && /Changing from/.test(await page.textContent('#emType')), 'practice type → Law firm: the law stage-mapping panel, with a "changing from" note');
      await page.click('label:has(input[name="emType"][value="medical"])'); await page.waitForSelector('.caremap .cm-row');
      // Save → config.json (pipelineMap by id) + index.json (needsMapping → draft) in ONE commit, then a sync
      await page.click('#emSave'); await answerConfirm(page);
      await committed(1);
      await page.waitForFunction(() => location.hash === '#/', null, { timeout: 20000 }).catch(() => {});
      // since 20 Nov (Part 2) the result is the Done popup, not a line on the list
      await page.waitForSelector('.lv-res', { timeout: 20000 }).catch(() => {});
      const res = await page.textContent('.lv-res').catch(() => '');
      check(/Done: mapping saved/.test(res) && /\(Draft\)/.test(res) && /Stages mapped\s*26/.test(res), `Save: back on the firm list with the Done popup "Done: mapping saved … (Draft)" (${res.replace(/\s+/g, ' ').slice(0, 90)})`);
      await page.click('[data-lv-res="close"]').catch(() => {});
      const cfg = JSON.parse(G.M.overlay.get(`firms/${SLUG}/config.json`)), row = JSON.parse(G.M.overlay.get('firms/index.json')).find(f => f.slug === SLUG);
      check(cfg.practiceType === 'medical' && Object.keys(cfg.pipelineMap.stages).length === 26 && cfg.pipelineMap.stages['pbP1S4-0000-4000-8000-000000000000']?.bucket === 'lost' && cfg.pipelineMap.stages['pbP1S4-0000-4000-8000-000000000000']?.name === 'Closed – Lost', 'Save: config.json pipelineMap by stage id (name kept), 26 stages');
      check(row.status === 'draft' && row.practiceType === 'medical', 'Save: firm list status Needs mapping → Draft', `row=${JSON.stringify(row)} status="${await page.textContent('#emStatus').catch(() => '')}" warn="${await page.textContent('#emWarn').catch(() => '')}" url=${page.url()}`);
      check(G.M.commits.length === 1 && G.M.dispatches.some(d => d.workflow === 'sync.yml' && d.inputs?.slug === SLUG), `Save: one commit (${G.M.commits.length}) + a sync started`);
    } else {
      check(await noSideScroll(page), `Map pipelines ${w} ${scheme}: no sideways scroll`);
      const bad = await contrast(page); check(!bad.length, `Map pipelines ${w} ${scheme}: AA contrast`, bad.join('; '));
      await shot(page, `map-pipelines-pbpcs-${w}-${scheme}`);
    }
    await ctx.close();
  }
  { // a stage with no bucket blocks Save
    freshGitHub({ status: 'needsMapping' });
    const d2 = JSON.parse(jsonText(discovery)); d2.pipelines[1].stages.push({ id: 'pbNEW-financing', name: 'Financing Pending', position: 9 });
    G.M.overlay.set(`firms/${SLUG}/discovery.json`, jsonText(d2));
    const { ctx, page } = await open(`${ADMIN}#/map/${SLUG}`);
    await page.waitForSelector('.cm-row.need');
    check(/1 to choose/.test(await page.textContent('.cm-sum')) && /Choose/.test(await page.textContent('.cm-row.need')), 'Map pipelines: a stage the name can\'t place is marked "Choose"');
    await page.click('#emSave'); await answerConfirm(page);
    check(/Choose a bucket for every stage/.test(await page.textContent('#emWarn')) && !G.M.commits.length, 'Map pipelines: Save is blocked while a stage has no bucket (nothing written)');
    await shot(page, 'map-pipelines-blocked-1440-light', false);
    await ctx.close();
  }
  // v1.35.0 (queue item 2): "How we fill this in for you": open the first time on a device, then remembered; the tag of a
  // guessed stage names the word that matched; Showing: on the law panel; 1440 + 390, light + dark.
  for (const [w, width, height] of SIZES) for (const scheme of SCHEMES) {
    freshGitHub({ status: 'needsMapping' });
    const d3 = JSON.parse(jsonText(discovery)); d3.pipelines[1].stages.push({ id: 'pbNEW-deposit', name: 'Deposit Received', position: 9 });
    G.M.overlay.set(`firms/${SLUG}/discovery.json`, jsonText(d3));
    const { ctx, page } = await open(`${ADMIN}#/map/${SLUG}`, { width, height, scheme });
    await page.waitForSelector('.caremap .cm-row');
    const tag = await page.textContent('.cm-row[aria-label$="Deposit Received"] .cm-src').catch(() => '');
    check(tag === 'Guessed: “Deposit”', `Map pipelines ${w} ${scheme}: a guessed stage's tag names the word ("${tag}")`);
    check(await page.$eval('details[data-mh]', d => d.open), `Map pipelines ${w} ${scheme}: the explainer is open the first time on a device`);
    const t = await page.textContent('details[data-mh]');
    check(/Kept from before/.test(t) && /Guessed from the name/.test(t) && /Left for you/.test(t) && /Words we look for/.test(t) && /first that fits wins/.test(t) && /1 patient = 1 count/.test(t), `Map pipelines ${w} ${scheme}: the three cards, the table, the order line and the facts`);
    check(await noSideScroll(page), `Map pipelines ${w} ${scheme}: no sideways scroll with the explainer open`);
    await page.locator('details[data-mh]').scrollIntoViewIfNeeded(); await shot(page, `map-how-care-${w}-${scheme}`, false);
    await page.locator('details[data-mh] > summary').click();
    await page.click('.cm-row[aria-label$="Deposit Received"] [data-bucket="yes"]');   // a redraw keeps it closed
    check(!(await page.$eval('details[data-mh]', d => d.open)) && !(await page.$('.cm-row[aria-label$="Deposit Received"] .cm-src')), `Map pipelines ${w} ${scheme}: closed stays closed after a redraw; the tag goes once a bucket is clicked`);
    await page.reload(); await page.waitForSelector('.caremap .cm-row');
    check(!(await page.$eval('details[data-mh]', d => d.open)), `Map pipelines ${w} ${scheme}: closed is remembered on this device`);
    await ctx.close();
  }
  for (const [w, width, height] of SIZES) for (const scheme of SCHEMES) {   // law panel: "Showing: your saved mapping" + the law explainer
    freshGitHub({ status: 'needsMapping' });
    const { ctx: c2, page } = await open(`${ADMIN}#/map/mahdavi`, { width, height, scheme });
    await page.waitForSelector('.map .mrow');
    check(/Showing: your saved mapping/.test(await page.textContent('.mh-showing')), `Edit mapping (law, Mahdavi) ${w} ${scheme}: "Showing: your saved mapping"`);
    const t = await page.textContent('details[data-mh]');
    check(/Saved mapping/.test(t) && /LFMP template/.test(t) && /Guessed from names/.test(t) && /one stage can count for more than one step/i.test(t) && /Consult calendars/.test(t), `Edit mapping (law) ${w} ${scheme}: the three cards, the table, the line and the facts`);
    check(await noSideScroll(page), `Edit mapping (law) ${w} ${scheme}: no sideways scroll`);
    await page.locator('.mh-showing').scrollIntoViewIfNeeded(); await shot(page, `map-how-law-${w}-${scheme}`, false);
    await c2.close();
  }
  { // storage blocked → closed
    const { ctx: c3, page: p3 } = await open(`${ADMIN}#/map/${SLUG}`);
    await p3.evaluate(() => { localStorage.removeItem('lfmp-map-how'); const g = Storage.prototype.getItem; Storage.prototype.getItem = function (k) { if (k === 'lfmp-map-how') throw new Error('blocked'); return g.call(this, k); }; });
    await p3.evaluate(() => document.querySelector('[data-use]')?.dispatchEvent(new Event('change')));   // a redraw with storage blocked
    await p3.waitForSelector('details[data-mh]');
    check(!(await p3.$eval('details[data-mh]', d => d.open)), 'storage blocked → the explainer is closed (no error)');
    await c3.close();
  }

  // ================= Edit mapping (mapped Draft firm; law firm) =================
  for (const [w, width, height] of SIZES) for (const scheme of SCHEMES) {
    freshGitHub();
    const d2 = JSON.parse(jsonText(discovery)); d2.pipelines[0].stages[0].name = 'New Inquiry';   // renamed in GHL since mapping
    G.M.overlay.set(`firms/${SLUG}/discovery.json`, jsonText(d2));
    const { ctx, page } = await open(`${ADMIN}#/map/${SLUG}`, { width, height, scheme });
    await page.waitForSelector('.caremap .cm-row');
    if (w === '1440' && scheme === 'light') {
      check(!(await page.$('.cm-src')) && !(await page.$('.cm-row.need')), 'Edit mapping (Draft firm): saved choices, nothing to confirm');
      check(/was “New Lead”/.test(await page.textContent('.cm-pipe')), 'Edit mapping: a stage renamed in GHL keeps its bucket, shown as was "New Lead"');
    }
    check(await noSideScroll(page), `Edit mapping ${w} ${scheme}: no sideways scroll`);
    await shot(page, `edit-mapping-pbpcs-${w}-${scheme}`);
    await ctx.close();
  }
  {
    freshGitHub();
    const { ctx, page } = await open(`${ADMIN}#/map/mahdavi`);
    await page.waitForSelector('.map .mrow');
    check(await page.isChecked('input[name="emType"][value="law"]') && /Edit/.test(await page.textContent('#emTitle')), 'Edit mapping (Mahdavi): Law firm selected, the usual panel');
    await page.click('#emSave'); await answerConfirm(page);
    await until(() => G.M.commits.length >= 1);
    await page.waitForFunction(() => location.hash === '#/', null, { timeout: 20000 }).catch(() => {});
    const before = await readFile(join(ROOT, 'firms/mahdavi/config.json'), 'utf8');
    const touched = G.M.commits.flatMap(c => c.files.map(f => f.path));
    check((G.M.overlay.get('firms/mahdavi/config.json') ?? before) === before && !touched.includes('firms/index.json'), `Edit mapping (Mahdavi): unchanged save keeps config.json byte-identical, firm list untouched (${touched.join(', ') || 'no files'})`);
    await shot(page, 'edit-mapping-mahdavi-law-1440-light', false);
    await ctx.close();
  }

  // ================= New firm: Medical & dental =================
  {
    freshGitHub();
    const { ctx, page } = await open(`${ADMIN}#/new`);
    await page.waitForSelector('#nfForm');
    await page.click('label:has(input[name="nfType"][value="medical"])');
    check(await page.isDisabled('input[name="nfMode"][value="pi"]') && await page.isVisible('#nfCountsWrap') && await page.isChecked('#nfCounts') && await page.isHidden('#nfAppOnly'), 'New firm (Medical): app only, no law preset, Counts only ticked');
    check(/Map pipelines/.test(await page.textContent('#nfNext')) && /Draft/.test(await page.textContent('#nfNext')), 'New firm (Medical): "What happens next" says Map pipelines, then a Draft');
    check((await page.$$eval('#nfArea option', o => o.map(x => x.textContent))).includes('Plastic & Cosmetic Surgery'), 'New firm (Medical): medical practice areas');
    await shot(page, 'new-firm-medical-1440-light');
    await page.fill('#nfName', 'Test Dental Clinic'); await page.fill('#nfLoc', 'TestDentalLoc000000A');
    await page.click('#nfCreate'); await answerConfirm(page);
    await page.waitForSelector('#appResult .success', { timeout: 30000 });
    const disp = G.M.dispatches.find(d => d.workflow === 'new-firm.yml');
    check(disp?.inputs?.practice_type === 'medical' && disp?.inputs?.counts_only === 'yes' && !disp?.inputs?.snapshot_id, 'New firm (Medical): new-firm.yml started with practice_type medical, counts_only yes, no preset');
    check(/needs its pipelines mapped/.test(await page.textContent('#appResult')) && !(await page.$('#ghlLinkOut')) && await page.isVisible('#appMap'), 'New firm (Medical): ends at "needs its pipelines mapped", no GHL link to copy, Map pipelines › button');
    await shot(page, 'new-firm-medical-done-1440-light');
    await page.click('[data-lv-res="close"]').catch(() => {});   // the Done popup sits over the page (this suite answers popups itself)
    await page.click('#appMap'); await page.waitForSelector('.caremap');
    check(/#\/map\//.test(page.url()), 'New firm → Map pipelines › opens the Map pipelines step');
    await ctx.close();
  }

  // ================= bell: stages not mapped =================
  {
    freshGitHub({ drift: { stages: 2, pipelinesNew: 1, pipelinesGone: 0 } });
    const { ctx, page } = await open(ADMIN);
    await page.waitForSelector(`#firmRows .lv-row[data-slug="${SLUG}"]`);
    await page.waitForTimeout(800);
    const rowTxt = await page.textContent(`#firmRows .lv-row[data-slug="${SLUG}"]`);
    check(/Stages not mapped/.test(rowTxt), 'firm list: amber "Stages not mapped"');
    await page.click('[data-lv-top] [data-lv="bell"]'); await page.waitForSelector('#nPanel [data-notice="unmapped"]');
    const t = await page.textContent('#nPanel [data-notice="unmapped"]');
    check(/^2 stages not mapped, 1 new pipeline · Palm Beach Plastic/.test(t.trim()) && /count nowhere/.test(t), `bell: amber notice "2 stages not mapped, 1 new pipeline · <firm>" (${t.trim().slice(0, 90)})`);
    check(!(await page.$$eval('#nPanel .issue .ititle', els => els.map(e => e.textContent))).some(x => /not mapped/.test(x)), 'bell: it\'s a notice, not counted as an issue in the badge');
    await page.click('#nPanel [data-notice="unmapped"] [data-n="map"]'); await page.waitForSelector('.caremap');
    check(/#\/map\/palm-beach-plastic/.test(page.url()), 'bell notice → Map pipelines opens that firm\'s Map pipelines');
    await shot(page, 'bell-unmapped-1440-light', false);
    await ctx.close();
  }
} catch (e) { failed++; console.log(`✗ crashed: ${e.stack}`); }
finally { await browser.close(); server.close(); }
console.log(`\n${failed ? `${failed} failed, ` : ''}${passed} passed`);
process.exit(failed ? 1 : 0);
