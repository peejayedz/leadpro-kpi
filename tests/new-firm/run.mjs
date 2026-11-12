// New firm from the builder.   Run:  node tests/new-firm/run.mjs [filter]   (Node 20+, no dependencies)
//
// scripts/new-firm.mjs and scripts/ghl-menu.mjs against a mock GHL, in a temp copy of the repo:
// the plan (new / resume / a Private Integration firm left alone / name clash), the snapshot preset
// (names → stage ids), the auto-guess + "Review mapping" when a stage is missing or the snapshot is
// unknown, waiting for the app (late, never), a double start making one firm, the menu link (created,
// already there, list failed, no token, blocked calls, passphrase never printed), and the workflow
// guardrails. Writes nothing in the repo.

import { readFile, writeFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planFirm, buildConfig, presetFor, loadPresets } from '../../scripts/new-firm.mjs';
import { guardMenu, menuBody } from '../../scripts/ghl-menu.mjs';
import { guessMapping } from '../../admin/mapping.mjs';
import { reviewIssues } from '../../scripts/keeper-status.mjs';
import { describeIssue } from '../../scripts/sync-status.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const only = process.argv[2] || '';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, what) => { if (!v) throw new Error(what); };

const LOC = 'bZ8sYUlHFufn3rH3TXip', SNAP = '2wuNIU3FfXTzuQKGjNw5', PASS = 'amber-otter-quill-raven#9';
const ACME = ['Stage 1: Web Lead', 'Stage 2: Phone lead', 'Stage 3: Lead Contacted?', 'Stage 4: Lead Qualified?', 'Stage 5: Booked Consultation', 'Stage 6: Consultation Showed - Agreement Sent', 'Stage 7: Consultation Showed - Lead Rejected', 'Stage 8: Consultation Showed - Lead Referred', 'Stage 9: Consultation Showed - Lead Thinking', 'Stage 10: Consultation No Show', 'Stage 11: Agreement Signed', 'Stage 12: Referred Lead Accepted?'];
const idOf = n => `stg-${ACME.indexOf(n) + 1}-id`;
const discovery = (names = ACME, loc = LOC) => ({ generatedAt: new Date().toISOString(), slug: 'zz-test-2', locationId: loc, locationName: 'ZZ TEST 2', scopes: { ok: [], missing: [], unchecked: [] },
  pipelines: [{ id: 'pipe-lead', name: 'Lead Stages', stages: names.map((n, i) => ({ id: ACME.includes(n) ? idOf(n) : `renamed-${i}`, name: n })) }], calendars: [], customFields: [] });
const template = JSON.parse(await readFile(join(ROOT, 'firms/_template/config.json'), 'utf8'));
const realIndex = JSON.parse(await readFile(join(ROOT, 'firms/index.json'), 'utf8'));
const INPUT = { name: 'ZZ TEST 2', locationId: LOC, slug: 'zz-test-2', practiceArea: 'Personal Injury', timezone: 'America/New_York', snapshotId: SNAP };

// ---------- plan ----------
test('Plan: new firm; same location set up from the builder → resume; Private Integration firm → left alone; name clash → refused', () => {
  eq(planFirm({ index: realIndex, ...INPUT }), { mode: 'new', slug: 'zz-test-2', key: 'ZZ_TEST_2' }, 'new');
  const withApp = [...realIndex, { slug: 'zz-test-2', secretKey: 'ZZ_TEST_2', locationId: LOC, tokenSource: 'app' }];
  eq(planFirm({ index: withApp, ...INPUT, slug: 'zz-test-2-x' }).mode, 'resume', 'resume (whatever slug the builder sent)');
  eq(planFirm({ index: withApp, ...INPUT, slug: 'zz-test-2-x' }).slug, 'zz-test-2', 'resume keeps the firm\'s own slug');
  const m = planFirm({ index: realIndex, ...INPUT, locationId: 'INZKoa3nu45xtcZB0Yuq', slug: 'whatever' });
  eq([m.mode, m.slug], ['other-token', 'mahdavi'], 'Mahdavi untouched');
  ok(planFirm({ index: realIndex, ...INPUT, slug: 'mahdavi' }).error, 'slug clash refused');
  ok(planFirm({ index: realIndex, ...INPUT, locationId: 'short' }).error, 'bad location refused');
  ok(planFirm({ index: realIndex, ...INPUT, slug: 'Bad Slug' }).error, 'bad slug refused');
});

// ---------- presets + mapping ----------
test('Preset: both template snapshots use "ACME Lead Stages"; other snapshots have none', async () => {
  const presets = await loadPresets(join(ROOT, 'firms/_presets/'));
  eq(presetFor('2wuNIU3FfXTzuQKGjNw5', presets)?.name, 'ACME Lead Stages', '[IN USE] LFMP Template');
  eq(presetFor('AnVc2m4Qj7GC3tgQNr9U', presets)?.name, 'ACME Lead Stages', 'Law Firm [Template]');
  eq(presetFor('somethingElse0000001', presets), null, 'unknown');
  // The preset says the same as the admin page's ACME auto-guess for these stage names.
  const g = guessMapping(ACME), p = presets[0];
  for (const k of Object.keys(p.stages)) eq([...p.stages[k]].sort(), [...g[k]].sort(), `preset ${k} = ACME guess`);
  eq([...p.turnedAway.stages].sort(), [...g.turnedAway].sort(), 'turned away');
});

test('Preset mapping: names checked against Discover and saved as stage ids (no review flag)', async () => {
  const preset = presetFor(SNAP, await loadPresets(join(ROOT, 'firms/_presets/')));
  const { config, review } = buildConfig({ template, discovery: discovery(), preset, ...INPUT });
  eq(review, null, 'no review');
  eq(config.stageMatch, 'id', 'id mode');
  eq(config.pipelines, ['Lead Stages'], 'pipeline');
  eq(config.stages.contacted, [idOf('Stage 3: Lead Contacted?')], 'contacted');
  eq(config.stages.consultHeld.length, 4, 'consult held');
  eq(config.stages.signed, [idOf('Stage 11: Agreement Signed')], 'signed');
  eq(config.turnedAway.reasonLabels[idOf('Stage 12: Referred Lead Accepted?')], 'Referred out, accepted', 'labels by id');
  eq(config.turnedAway.tagPrefix, 'turned away:', 'template turnedAway kept');
  eq([config.locationId, config.locationName, config.timezone, config.practiceArea], [LOC, 'ZZ TEST 2', 'America/New_York', 'Personal Injury'], 'firm fields');
  ok(!('mappingReview' in config), 'no flag');
});

test('Missing stage (renamed in GHL): auto-guess by name + "Review mapping"', async () => {
  const preset = presetFor(SNAP, await loadPresets(join(ROOT, 'firms/_presets/')));
  const names = ACME.map(n => (n === 'Stage 11: Agreement Signed' ? 'Stage 11: Retainer Done' : n));
  const { config, review } = buildConfig({ template, discovery: discovery(names), preset, ...INPUT });
  eq(review?.reason, 'missing-stages', 'review');
  eq(config.mappingReview.missing, 1, 'one missing');
  ok(config.stageMatch !== 'id', 'names, not ids');
  ok(config.stages.contacted.includes('Stage 3: Lead Contacted?'), 'guess still maps the rest');
  const iss = reviewIssues([{ slug: 'zz-test-2' }], { 'zz-test-2': config });
  eq(iss.map(i => i.kind), ['mapping-review'], 'bell');
  const d = describeIssue(iss[0], {});
  ok(d.title === 'Review mapping' && d.actions.includes('map'), 'bell text + Edit mapping button');
});

test('Unknown snapshot: auto-guess + "Review mapping"', () => {
  const { config, review } = buildConfig({ template, discovery: discovery(), preset: null, ...INPUT, snapshotId: 'other' });
  eq(review?.reason, 'unknown-snapshot', 'review');
  ok(config.stages.signed.includes('Stage 11: Agreement Signed'), 'guessed');
  eq(reviewIssues([{ slug: 'x' }], { x: config })[0].detail, 'unknown-snapshot', 'bell detail');
});

test('Admin Edit mapping clears the flag; the other firms have none', async () => {
  const admin = await readFile(join(ROOT, 'admin/index.html'), 'utf8');
  ok(/const next = applyMapping\(c, m\); delete next\.mappingReview;/.test(admin), 'save clears mappingReview');
  for (const f of realIndex) ok(!JSON.parse(await readFile(join(ROOT, `firms/${f.slug}/config.json`), 'utf8')).mappingReview, `${f.slug} has no flag`);
});

// ---------- commands in a temp repo, against a mock GHL ----------
async function makeRepo() {
  const tmp = await mkdtemp(join(tmpdir(), 'lpk-newfirm-'));
  for (const d of ['scripts', 'admin']) await cp(join(ROOT, d), join(tmp, d), { recursive: true });
  await mkdir(join(tmp, 'firms'), { recursive: true });
  for (const f of ['index.json', '_template', '_presets']) await cp(join(ROOT, 'firms', f), join(tmp, 'firms', f), { recursive: true });
  return tmp;
}
async function startMock(o = {}) {
  const calls = []; let polls = 0;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const u = new URL(req.url, 'http://x');
    calls.push({ method: req.method, path: u.pathname, body: body ? JSON.parse(body) : null, version: req.headers.version });
    const send = (s, j) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (u.pathname === '/oauth/installed-locations') { polls++; const has = o.appAfter !== undefined && polls > o.appAfter; return send(200, { items: [{ _id: 'other0000000000000001', isInstalled: true }, ...(has ? [{ _id: LOC, isInstalled: true }] : [])], pagination: { hasNextPage: false } }); }
    if (/^\/custom-menus\/?$/.test(u.pathname) && req.method === 'GET') return o.listFail ? send(403, { message: 'scope' }) : send(200, { customMenus: o.existing || [] });
    if (/^\/custom-menus\/?$/.test(u.pathname) && req.method === 'POST') return send(201, { customMenu: { id: 'menu1' } });
    send(404, {});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise(r => server.close(r)) };
}
const cmd = (tmp, name, env) => new Promise(r => execFile(process.execPath, [join(tmp, 'scripts/new-firm.mjs'), name], { env: { PATH: process.env.PATH, ...env }, cwd: tmp }, (e, out, err) => r({ code: e ? e.code : 0, out: out + err })));
const nfEnv = (m, extra = {}) => ({ GHL_API_BASE: m.url, NF_NAME: INPUT.name, NF_LOCATION: LOC, NF_SLUG: INPUT.slug, NF_PRACTICE: INPUT.practiceArea, NF_TIMEZONE: INPUT.timezone, NF_SNAPSHOT_ID: SNAP, ...extra });
const access = h => JSON.stringify({ access_token: 'AGENCY-ACCESS-'.padEnd(200, 'x'), expiresAt: new Date(Date.now() + h * 36e5).toISOString() });
async function withRepo(fn, mockOpt) { const tmp = await makeRepo(), m = await startMock(mockOpt); try { await fn(tmp, m); } finally { await m.close(); await rm(tmp, { recursive: true, force: true }); } }

test('Wait for the app: arrives on the 3rd check → OK', () => withRepo(async (tmp, m) => {
  const r = await cmd(tmp, 'wait-app', nfEnv(m, { GHL_APP_ACCESS: access(10), GHL_APP_CLIENT_ID: 'app1234567890-abcd', NEWFIRM_WAIT_MIN: '1', NEWFIRM_POLL_S: '0.05' }));
  eq(r.code, 0, `exit (${r.out})`); ok(/installed on the sub-account \(check 3\)/.test(r.out), 'third check');
}, { appAfter: 2 }));

test('Wait for the app: never arrives → stops after the wait with a clear message', () => withRepo(async (tmp, m) => {
  const t0 = Date.now();
  const r = await cmd(tmp, 'wait-app', nfEnv(m, { GHL_APP_ACCESS: access(10), GHL_APP_CLIENT_ID: 'app1234567890-abcd', NEWFIRM_WAIT_MIN: '0.01', NEWFIRM_POLL_S: '0.1' }));
  eq(r.code, 2, 'exit 2'); ok(/still isn't installed/.test(r.out), 'message'); ok(Date.now() - t0 < 5000, 'stops on time');
}, {}));

test('Wait for the app: expired agency token → asks for the token keeper, no polling', () => withRepo(async (tmp, m) => {
  const r = await cmd(tmp, 'wait-app', nfEnv(m, { GHL_APP_ACCESS: access(-1), GHL_APP_CLIENT_ID: 'app1234567890-abcd' }));
  eq(r.code, 1, 'exit'); ok(/token keeper must run/.test(r.out), 'message'); eq(m.calls.length, 0, 'no GHL calls');
}, { appAfter: 0 }));

test('Write + double start: one firm, tokenSource "app", preset ids; a second start resumes and adds nothing', () => withRepo(async (tmp, m) => {
  const plan1 = await cmd(tmp, 'plan', nfEnv(m)); eq(plan1.code, 0, 'plan');
  await mkdir(join(tmp, 'firms/zz-test-2'), { recursive: true });
  await writeFile(join(tmp, 'firms/zz-test-2/discovery.json'), JSON.stringify(discovery()));
  const w1 = await cmd(tmp, 'write', nfEnv(m)); eq(w1.code, 0, `write (${w1.out})`);
  ok(/preset "ACME Lead Stages"/.test(w1.out), 'preset used');
  const idx = JSON.parse(await readFile(join(tmp, 'firms/index.json'), 'utf8'));
  const mine = idx.filter(f => f.locationId === LOC);
  eq(mine.length, 1, 'one entry'); eq([mine[0].tokenSource, mine[0].secretKey], ['app', 'ZZ_TEST_2'], 'entry');
  eq(idx.length, realIndex.length + 1, 'nothing else changed');
  for (const f of realIndex) eq(idx.find(x => x.slug === f.slug), f, `${f.slug} entry unchanged`);
  const cfg = JSON.parse(await readFile(join(tmp, 'firms/zz-test-2/config.json'), 'utf8'));
  eq(cfg.stageMatch, 'id', 'ids'); ok(await readFile(join(tmp, 'firms/zz-test-2/index.html'), 'utf8'), 'stub');
  // Second start for the same location (double click, or Retry)
  const env2 = nfEnv(m, { GITHUB_OUTPUT: join(tmp, 'out.txt') });
  await cmd(tmp, 'plan', env2);
  ok(/mode=resume/.test(await readFile(join(tmp, 'out.txt'), 'utf8')), 'second plan resumes');
  const w2 = await cmd(tmp, 'write', nfEnv(m)); eq(w2.code, 0, 'write again');
  eq(JSON.parse(await readFile(join(tmp, 'firms/index.json'), 'utf8')).filter(f => f.locationId === LOC).length, 1, 'still one entry');
}, {}));

test('Write refuses discovery for another location', () => withRepo(async (tmp, m) => {
  await mkdir(join(tmp, 'firms/zz-test-2'), { recursive: true });
  await writeFile(join(tmp, 'firms/zz-test-2/discovery.json'), JSON.stringify(discovery(ACME, 'someOtherLocation0001')));
  const r = await cmd(tmp, 'write', nfEnv(m)); eq(r.code, 1, 'refused');
  ok(!JSON.parse(await readFile(join(tmp, 'firms/index.json'), 'utf8')).some(f => f.slug === 'zz-test-2'), 'not added');
}, {}));

// ---------- menu link ----------
async function menuRun(mockOpt, extra = {}) {
  let res; await withRepo(async (tmp, m) => {
    await mkdir(join(tmp, 'firms/zz-test-2'), { recursive: true });
    await writeFile(join(tmp, 'firms/zz-test-2/config.json'), JSON.stringify({ locationId: LOC }));
    const out = join(tmp, 'out.txt');
    const r = await cmd(tmp, 'menu', nfEnv(m, { GHL_MENU_TOKEN: 'MENU-TOKEN-VALUE-123', NF_PASSPHRASE: PASS, GITHUB_OUTPUT: out, ...extra }));
    res = { ...r, calls: m.calls, outFile: await readFile(out, 'utf8').catch(() => ''), cfg: JSON.parse(await readFile(join(tmp, 'firms/zz-test-2/config.json'), 'utf8')) };
  }, mockOpt);
  return res;
}
const noLeak = r => { ok(!r.out.includes(PASS) && !r.out.includes(encodeURIComponent(PASS)) && !r.out.includes('MENU-TOKEN-VALUE'), 'passphrase or token printed'); };

test('Menu link: one "KPI Dashboard" link, this sub-account only, new tab; passphrase never printed', async () => {
  const r = await menuRun({});
  eq(r.code, 0, 'exit');
  const post = r.calls.filter(c => c.method === 'POST');
  eq(post.length, 1, 'one POST');
  eq(post[0].version, 'v3', 'Version v3');
  const b = post[0].body;
  eq([b.title, b.showOnCompany, b.showOnLocation, b.showToAllLocations, b.locations, b.openMode, b.userRole], ['KPI Dashboard', false, true, false, [LOC], 'new_tab', 'all'], 'body');
  eq(b.url, `https://peejayedz.github.io/leadpro-kpi/firms/zz-test-2/#k=${encodeURIComponent(PASS)}`, 'url (passphrase URL-encoded)');
  ok(/menu=created/.test(r.outFile), 'output'); eq(r.cfg.menuLink?.status, 'created', 'recorded in config (no URL)');
  ok(!JSON.stringify(r.cfg).includes('#k='), 'config holds no link with the passphrase');
  noLeak(r);
});

test('Menu link: already on this sub-account → nothing created', async () => {
  const r = await menuRun({ existing: [{ title: 'KPI Dashboard', locations: [LOC], showToAllLocations: false }] });
  eq(r.calls.filter(c => c.method === 'POST').length, 0, 'no POST'); ok(/menu=exists/.test(r.outFile), 'exists'); noLeak(r);
});

test('Menu link: can\'t list existing links → skipped (no duplicate risk); no token → skipped; setup never fails', async () => {
  const a = await menuRun({ listFail: true });
  eq(a.calls.filter(c => c.method === 'POST').length, 0, 'no POST'); ok(/skipped-list-failed/.test(a.outFile), 'skipped'); eq(a.code, 0, 'exit 0');
  const b = await menuRun({}, { GHL_MENU_TOKEN: '' });
  eq(b.calls.length, 0, 'no GHL calls'); ok(/skipped-no-token/.test(b.outFile), 'skipped'); eq(b.code, 0, 'exit 0'); noLeak(a); noLeak(b);
});

test('Menu guard: refuses every other write', () => {
  const good = menuBody({ locationId: LOC, url: 'https://peejayedz.github.io/leadpro-kpi/firms/x/#k=a' });
  guardMenu('POST', '/custom-menus/', good); guardMenu('GET', '/custom-menus/');
  const bad = [
    ['PUT', '/custom-menus/abc', good], ['DELETE', '/custom-menus/abc', null], ['PATCH', '/custom-menus/', good], ['POST', '/custom-menus/abc', good],
    ['POST', '/custom-menus/', { ...good, showToAllLocations: true }], ['POST', '/custom-menus/', { ...good, locations: [LOC, 'other0000000000000001'] }],
    ['POST', '/custom-menus/', { ...good, showOnCompany: true }], ['POST', '/custom-menus/', { ...good, title: 'Other' }], ['POST', '/custom-menus/', { ...good, openMode: 'iframe' }],
    ['POST', '/custom-menus/', { ...good, url: 'https://evil.example/' }], ['POST', '/locations/', good], ['GET', '/contacts/', null],
  ];
  for (const [m, p, b] of bad) { let threw = false; try { guardMenu(m, p, b); } catch (e) { threw = /Blocked/.test(e.message); } ok(threw, `${m} ${p} ${JSON.stringify(b)?.slice(0, 60)} allowed`); }
});

test('Repo: GHL writes only in ghl-app.mjs (/oauth token calls) and ghl-menu.mjs (/custom-menus); sync only reads', async () => {
  const { readdir } = await import('node:fs/promises');
  for (const f of (await readdir(join(ROOT, 'scripts'))).filter(f => f.endsWith('.mjs'))) {
    const t = await readFile(join(ROOT, 'scripts', f), 'utf8');
    if (f !== 'ghl-menu.mjs') ok(!/custom-menus/.test(t), `${f} mentions custom-menus`);
    for (const m of t.matchAll(/method:\s*'(POST|PUT|PATCH|DELETE)'[^\n]*|ghl\(\s*'[^']*',\s*\{\s*method:\s*'(POST|PUT|PATCH|DELETE)'/g)) {
      const line = m[0];
      ok(/\/contacts\/search/.test(t.slice(Math.max(0, m.index - 120), m.index + 40)) || f === 'sync-chain.mjs', `${f}: unexpected write ${line.slice(0, 60)}`);
    }
  }
});

// ---------- workflow ----------
test('new-firm.yml: non-secret inputs, one run at a time, no refresh, menu never fails setup, nothing echoed', async () => {
  const y = await readFile(join(ROOT, '.github/workflows/new-firm.yml'), 'utf8');
  const inputs = y.split('inputs:')[1].split('permissions:')[0];
  ok(!/pass|token|secret/i.test(inputs.replace(/description: .*/g, '')), 'no secret inputs');
  ok(/concurrency:\s*\n\s*group: new-firm\s*\n\s*cancel-in-progress: false/.test(y), 'one at a time');
  ok(/KEEPER_NO_REFRESH: "1"/.test(y) && /KEEPER_NO_STATUS: "1"/.test(y), 'token job never refreshes');
  ok(!/echo[^\n]*(PASS|TOKEN|SECRET)\b/.test(y.replace(/PASSPHRASE_\$\{\{ steps\.plan\.outputs\.key \}\} is empty/, '')), 'nothing secret echoed');
  ok(/run: node scripts\/new-firm\.mjs menu/.test(y), 'menu step');
  ok(/needs: \[prepare, first-sync\]/.test(y), 'menu after the first sync');
});

const results = [];
for (const t of tests) {
  if (only && !t.name.toLowerCase().includes(only.toLowerCase())) continue;
  const t0 = Date.now();
  try { await t.fn(); results.push({ name: t.name, pass: true, ms: Date.now() - t0 }); }
  catch (e) { results.push({ name: t.name, pass: false, error: e.message, ms: Date.now() - t0 }); }
}
console.log('\nNew firm tests\n');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${(r.ms / 1000).toFixed(1)} s)${r.error ? `\n      ${r.error}` : ''}`);
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed} of ${results.length} tests pass.`);
process.exit(failed ? 1 : 0);
