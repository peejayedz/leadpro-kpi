// v1.28.0: Remove scorecard (remove-firm.yml / scripts/remove-firm.mjs), Add to GHL menu (menu-link.yml / new-firm.mjs
// menu-plan + go-live) and the menu link's exact reversal (ghl-menu.mjs removeMenuLink).
//   Run:  node tests/remove-firm/run.mjs   (Node 20+, no dependencies)
// Never touches a real firm: every command runs against a temp copy of a made-up firm list (RF_ROOT), a fake `gh` that
// only records what it was asked, and a mock GHL. Prints ✓/✗; exits 1 on any failure.
import { readFile, writeFile, mkdir, mkdtemp, rm, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { planRemove } from '../../scripts/remove-firm.mjs';
import { planMenu } from '../../scripts/new-firm.mjs';
import { guardMenu, removeMenuLink, isOurLink, PAGES } from '../../scripts/ghl-menu.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let fails = 0;
const ok = (v, label, extra = '') => { console.log(`${v ? '✓' : '✗'} ${label}${!v && extra ? `\n    ${extra}` : ''}`); if (!v) fails++; };
const jsonText = o => JSON.stringify(o, null, 2) + '\n';
const LOC = 'TestLocation000000A1', LOC2 = 'OtherLocation00000B2';

const INDEX = [
  { slug: 'law-old', secretKey: 'LAW_OLD', name: 'Old Law Firm', locationId: 'LawOldLocation0000001' },                                  // law, no Builder record
  { slug: 'law-new', secretKey: 'LAW_NEW', name: 'New Law Firm', locationId: 'LawNewLocation0000001', createdBy: 'builder', status: 'draft' },
  { slug: 'clinic', secretKey: 'CLINIC', name: 'Test Clinic', locationId: LOC, createdBy: 'builder', practiceType: 'medical', status: 'draft' },
  { slug: 'clinic-live', secretKey: 'CLINIC_LIVE', name: 'Live Clinic', locationId: LOC2, createdBy: 'builder', practiceType: 'medical' },
  { slug: 'clinic-map', secretKey: 'CLINIC_MAP', name: 'Unmapped Clinic', locationId: 'MapLocation000000001', createdBy: 'builder', practiceType: 'medical', status: 'needsMapping' },
];
const CFG = {
  'law-old': { locationId: 'LawOldLocation0000001' }, 'law-new': { locationId: 'LawNewLocation0000001' },
  clinic: { locationId: LOC, practiceType: 'medical' }, 'clinic-live': { locationId: LOC2, practiceType: 'medical', menuLink: { status: 'created' } },
  'clinic-map': { locationId: 'MapLocation000000001', practiceType: 'medical' },
};

// ---------- 1. plan (pure) ----------
{
  const p = (slug, confirm) => planRemove({ index: INDEX, config: CFG[slug], slug, confirm });
  ok(!planRemove({ index: INDEX, config: null, slug: 'nobody' }).ok, 'remove: an unknown slug is refused');
  ok(!planRemove({ index: INDEX, config: null, slug: '../x' }).ok, 'remove: a bad slug is refused');
  ok(!p('law-old').ok && /no Builder record/.test(p('law-old').reason), 'remove: a law firm with no Builder record is refused');
  ok(!p('law-old', 'law').ok && p('law-old', 'law-old').ok, 'remove: … unless confirm equals the slug exactly');
  ok(p('law-new').ok && p('clinic').ok && p('clinic-map').ok, 'remove: Builder-made firms (law Draft, Medical Draft, Needs mapping) are allowed');
  ok(p('clinic-live').live === true && p('clinic').live === false && p('law-new').live === false, 'remove: only a live firm with its menu link counts as live (its link is removed too)');
}
{
  ok(planMenu({ index: INDEX, slug: 'clinic' }).key === 'CLINIC', 'menu: a Draft can be added to its GHL menu');
  ok(/mapped/.test(planMenu({ index: INDEX, slug: 'clinic-map' }).error || ''), 'menu: a firm that still needs mapping is refused');
  ok(/already live/.test(planMenu({ index: INDEX, slug: 'clinic-live' }).error || ''), 'menu: a live firm is refused (nothing to add)');
  ok(/isn't in the firm list/.test(planMenu({ index: INDEX, slug: 'nobody' }).error || ''), 'menu: an unknown slug is refused');
}

// ---------- 2. commands against a temp repo + fake gh ----------
async function tempRepo() {
  const dir = await mkdtemp(join(tmpdir(), 'lpk-rm-'));
  await mkdir(join(dir, 'firms'), { recursive: true });
  await writeFile(join(dir, 'firms/index.json'), jsonText(INDEX));
  for (const f of INDEX) { await mkdir(join(dir, 'firms', f.slug, 'data'), { recursive: true }); await writeFile(join(dir, 'firms', f.slug, 'config.json'), jsonText(CFG[f.slug])); await writeFile(join(dir, 'firms', f.slug, 'data/kpis.json'), '{}\n'); }
  const log = join(dir, 'gh-calls.txt'), bin = join(dir, 'fake-gh');
  await writeFile(bin, `#!/bin/sh\necho "$@" >> "${log}"\nexit 0\n`); await chmod(bin, 0o755);
  return { dir, log, bin };
}
const cmd = (T, c, env = {}) => run(process.execPath, [join(ROOT, 'scripts/remove-firm.mjs'), c], { env: { ...process.env, RF_ROOT: T.dir, RF_GH_BIN: T.bin, GITHUB_REPOSITORY: 'test/repo', SECRETS_TOKEN: 'x', GITHUB_OUTPUT: join(T.dir, 'out.txt'), ...env } }).then(r => ({ code: 0, out: r.stdout }), e => ({ code: e.code, out: `${e.stdout}${e.stderr}` }));
{
  const T = await tempRepo();
  try {
    const refused = await cmd(T, 'files', { RF_SLUG: 'law-old' });
    ok(refused.code === 1 && existsSync(join(T.dir, 'firms/law-old/config.json')), 'files: a law firm with no Builder record is NOT removed (the files step checks again)');
    const plan = await cmd(T, 'plan', { RF_SLUG: 'clinic' });
    ok(plan.code === 0 && /live=no/.test(await readFile(join(T.dir, 'out.txt'), 'utf8')), 'plan: Draft clinic → not live (no GHL change)');
    const files = await cmd(T, 'files', { RF_SLUG: 'clinic', RF_BY: 'PJ', RF_MENU: 'none' });
    const idx = JSON.parse(await readFile(join(T.dir, 'firms/index.json'), 'utf8')), log = JSON.parse(await readFile(join(T.dir, 'status/removed.json'), 'utf8'));
    ok(files.code === 0 && !existsSync(join(T.dir, 'firms/clinic')) && !idx.some(f => f.slug === 'clinic') && idx.length === INDEX.length - 1, 'files: firms/clinic/ and its list row are gone; every other firm untouched');
    ok(log.removed[0].slug === 'clinic' && log.removed[0].by === 'PJ' && log.removed[0].name === 'Test Clinic' && !/token|pass/i.test(JSON.stringify(log)), 'files: logged in status/removed.json (slug, name, time, by; nothing secret)');
    const sec = await cmd(T, 'secrets', { RF_SLUG: 'clinic' });
    const calls = (await readFile(T.log, 'utf8')).trim().split('\n');
    ok(sec.code === 0 && calls.length === 2 && calls[0] === 'secret delete GHL_TOKEN_CLINIC --repo test/repo' && calls[1] === 'secret delete PASSPHRASE_CLINIC --repo test/repo', `secrets: exactly GHL_TOKEN_CLINIC and PASSPHRASE_CLINIC deleted (${calls.join(' | ')})`);
    ok(!/[A-Za-z0-9]{30,}/.test(sec.out), 'secrets: no secret value in the log');
    const unknown = await cmd(T, 'plan', { RF_SLUG: 'clinic' });
    ok(unknown.code === 1 && /isn't in the firm list/.test(unknown.out), 'plan: the same slug again → refused (already removed)');
  } finally { await rm(T.dir, { recursive: true, force: true }); }
}
{
  // go-live only once the menu link is there
  const T = await tempRepo();
  const nf = (c, env) => run(process.execPath, [join(ROOT, 'scripts/new-firm.mjs'), c], { cwd: T.dir, env: { ...process.env, NF_SLUG: 'clinic', ...env } }).then(() => 0, e => e.code);
  try {
    // new-firm.mjs reads ROOT from its own folder: run it from a temp copy of scripts/
    await mkdir(join(T.dir, 'scripts'), { recursive: true });
    for (const f of ['new-firm.mjs', 'firms.mjs', 'config-merge.mjs', 'care-core.mjs', 'ghl-menu.mjs']) await writeFile(join(T.dir, 'scripts', f), await readFile(join(ROOT, 'scripts', f)));
    await mkdir(join(T.dir, 'admin'), { recursive: true }); await writeFile(join(T.dir, 'admin/mapping.mjs'), await readFile(join(ROOT, 'admin/mapping.mjs')));
    const goLive = () => run(process.execPath, [join(T.dir, 'scripts/new-firm.mjs'), 'go-live'], { env: { ...process.env, NF_SLUG: 'clinic' } }).then(() => 0, e => e.code);
    ok(await goLive() === 1 && JSON.parse(await readFile(join(T.dir, 'firms/index.json'), 'utf8')).find(f => f.slug === 'clinic').status === 'draft', 'go-live: no menu link → stays a Draft');
    await writeFile(join(T.dir, 'firms/clinic/config.json'), jsonText({ ...CFG.clinic, menuLink: { status: 'created' } }));
    ok(await goLive() === 0 && !JSON.parse(await readFile(join(T.dir, 'firms/index.json'), 'utf8')).find(f => f.slug === 'clinic').status, 'go-live: menu link created → live (Draft status removed)');
    void nf;
  } finally { await rm(T.dir, { recursive: true, force: true }); }
}

// ---------- 3. the GHL menu link's exact reversal ----------
{
  const url = slug => `${PAGES}firms/${slug}/#k=x`;
  const ours = { id: 'menu0000000001', title: 'KPI Dashboard', locations: [LOC], showToAllLocations: false, showOnCompany: false, url: url('clinic') };
  ok(isOurLink(ours, { locationId: LOC, slug: 'clinic' }), 'menu link: ours = "KPI Dashboard", this sub-account only, this firm\'s dashboard');
  ok(!isOurLink({ ...ours, showToAllLocations: true }, { locationId: LOC, slug: 'clinic' }) && !isOurLink({ ...ours, locations: [LOC, LOC2] }, { locationId: LOC, slug: 'clinic' })
    && !isOurLink({ ...ours, url: url('other') }, { locationId: LOC, slug: 'clinic' }) && !isOurLink({ ...ours, title: 'KPI dashboard (old)' }, { locationId: LOC, slug: 'clinic' }), 'menu link: all-sub-accounts, shared, another firm\'s or renamed links are not ours');
  let threw = false; try { guardMenu('DELETE', '/custom-menus/menu0000000001', null); } catch { threw = true; }
  ok(threw, 'guard: DELETE without a checked link is blocked before any request');
  threw = false; try { guardMenu('DELETE', '/custom-menus/menu0000000002', null, ours); } catch { threw = true; }
  ok(threw, 'guard: DELETE of a different id than the checked one is blocked');
  threw = false; try { guardMenu('PUT', '/custom-menus/menu0000000001', {}); } catch { threw = true; }
  ok(threw, 'guard: updates are still blocked');
  // mock GHL: our link + a foreign one
  const hits = [];
  const srv = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (req.method === 'GET') return res.end(JSON.stringify({ customMenus: [{ ...ours }, { id: 'menu0000000009', title: 'KPI Dashboard', locations: [LOC2], showToAllLocations: false, url: url('clinic-live') }, { id: 'menu0000000003', title: 'Help', locations: [LOC], url: 'https://x.test' }] }));
    res.end('{}');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.GHL_API_BASE = `http://127.0.0.1:${srv.address().port}`;
  try {
    ok(await removeMenuLink({ token: 't', locationId: LOC, slug: 'clinic' }) === 'removed' && hits.filter(h => h.startsWith('DELETE')).join() === 'DELETE /custom-menus/menu0000000001', `removeMenuLink: deletes only this firm's link (${hits.join(' · ')})`);
    hits.length = 0;
    ok(await removeMenuLink({ token: 't', locationId: LOC, slug: 'nobody' }) === 'none' && !hits.some(h => h.startsWith('DELETE')), 'removeMenuLink: nothing of ours → nothing deleted');
    ok(await removeMenuLink({ token: '', locationId: LOC, slug: 'clinic' }) === 'skipped-no-token', 'removeMenuLink: no token → skipped (and said so)');
  } finally { srv.close(); delete process.env.GHL_API_BASE; }
}

// ---------- 4. the workflows ----------
{
  const rm = await readFile(join(ROOT, '.github/workflows/remove-firm.yml'), 'utf8');
  const order = ['remove-firm.mjs plan', 'remove-firm.mjs menu', 'remove-firm.mjs files', 'remove-firm.mjs secrets', 'remove-firm.mjs notify'].map(s => rm.indexOf(s));
  ok(order.every((v, i) => v > 0 && (!i || v > order[i - 1])), 'remove-firm.yml: plan → menu → files (+ commit) → secrets → Slack');
  ok(/if: steps\.plan\.outputs\.live == 'yes'/.test(rm), 'remove-firm.yml: the GHL step runs only for a live firm');
  ok(/group: new-firm\n  cancel-in-progress: false/.test(rm), 'remove-firm.yml: never at the same time as a new firm, never cancelled half-way');
  ok(/git commit -m "Remove firm \$RF_SLUG \(\$\{RF_BY:-someone\} via Builder\)"/.test(rm), 'remove-firm.yml: commits "Remove firm <slug> (<name> via Builder)"');
  ok(!/echo[^\n]*(TOKEN|PASS|SECRET)/.test(rm), 'remove-firm.yml: nothing secret echoed');
  const ml = await readFile(join(ROOT, '.github/workflows/menu-link.yml'), 'utf8');
  ok(/new-firm\.mjs menu-plan/.test(ml) && /new-firm\.mjs menu\n/.test(ml) && /new-firm\.mjs go-live/.test(ml) && !/discover|sync\.yml|wait-app|token-keeper/.test(ml), 'menu-link.yml: only the menu-link step (+ the Draft check and go-live), nothing else');
  const nfy = await readFile(join(ROOT, '.github/workflows/new-firm.yml'), 'utf8');
  ok(/if: needs\.setup\.outputs\.status == 'live'/.test(nfy), 'new-firm.yml: the setup skips the menu link for a Draft (every new scorecard)');
}

console.log(fails ? `\n${fails} failed` : '\nAll remove / menu tests passed');
process.exit(fails ? 1 : 0);
