// v1.37.0 LeadPro Reports: the "Reports" GHL menu link (scripts/ghl-menu.mjs ensureReportsLink / removeReportsLink,
// scripts/reports-menu.mjs planReports, menu-link.yml kind). Fake GHL only.   Run: node tests/reports/menu.mjs
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as M from '../../scripts/ghl-menu.mjs';
import { planReports } from '../../scripts/reports-menu.mjs';
import * as RC from '../../scripts/reports-core.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let pass = 0, fail = 0;
const check = (ok, what, extra = '') => { if (ok) { pass++; console.log(`✓ ${what}`); } else { fail++; console.log(`✗ ${what}${extra ? `\n    ${extra}` : ''}`); } };
const LOC = 'INZKoa3nu45xtcZB0Yuq', OTHER = 'pBNZKHAEHetHe3AVJ7GH';
function fakeGhl(links = []) {
  const calls = [];
  globalThis.fetch = async (url, o = {}) => {
    const u = new URL(url), method = o.method || 'GET', body = o.body ? JSON.parse(o.body) : null; calls.push({ method, path: u.pathname, body });
    if (method === 'GET') return new Response(JSON.stringify({ customMenus: links }));
    if (method === 'POST') return new Response(JSON.stringify({ customMenu: { ...body, id: 'rep0link0id0aa000001' } }));
    if (method === 'DELETE') return new Response('{}');
    return new Response('{}', { status: 400 });
  };
  return calls;
}
const kpiLink = { id: 'kpi0link0id0aa00001', title: 'KPI Dashboard', url: `${M.PAGES}firms/mahdavi/#k=x`, locations: [LOC], showToAllLocations: false, showOnCompany: false };
const repLink = { id: 'rep0link0id0aa00001', title: 'Reports', url: `${M.PAGES}firms/mahdavi/reports.html#k=x`, locations: [LOC], showToAllLocations: false, showOnCompany: false };

// create
{ const calls = fakeGhl([kpiLink]);
  const r = await M.ensureReportsLink({ token: 't', locationId: LOC, slug: 'mahdavi', passphrase: 'pass #1' });
  const post = calls.find(c => c.method === 'POST');
  check(r.result === 'created' && r.id === 'rep0link0id0aa000001', 'Add to GHL menu: creates "Reports" (KPI Dashboard already there is not a duplicate)');
  check(post && post.body.title === 'Reports' && post.body.openMode === 'iframe' && post.body.allowCamera === false && post.body.allowMicrophone === false && post.body.showOnCompany === false && post.body.showToAllLocations === false && post.body.locations.length === 1 && post.body.locations[0] === LOC,
    'the link: "Reports", this one sub-account, opens inside GHL, camera / microphone false');
  check(post.body.url === `${M.PAGES}firms/mahdavi/reports.html#k=pass%20%231`, 'URL = the firm\'s reports.html with its KPI passphrase (URL-encoded, # → %23)');
  check(calls.filter(c => c.method !== 'GET').length === 1, 'one POST, nothing else written'); }
{ const calls = fakeGhl([kpiLink, repLink]);
  const r = await M.ensureReportsLink({ token: 't', locationId: LOC, slug: 'mahdavi', passphrase: 'p' });
  check(r.result === 'exists' && !calls.some(c => c.method === 'POST'), 'a "Reports" link already there → nothing created'); }
{ const calls = fakeGhl([]);
  check((await M.ensureReportsLink({ token: '', locationId: LOC, slug: 'mahdavi', passphrase: 'p' })).result === 'skipped-no-token' && !calls.length, 'no GHL_MENU_TOKEN → nothing sent');
  check((await M.ensureReportsLink({ token: 't', locationId: 'bad', slug: 'mahdavi', passphrase: 'p' })).result === 'failed:input' && !calls.length, 'bad location → nothing sent'); }
// remove: only our own Reports link
{ const otherLoc = { ...repLink, id: 'rep0link0id0aa00002', locations: [OTHER] };
  const calls = fakeGhl([kpiLink, otherLoc, repLink]);
  check(await M.removeReportsLink({ token: 't', locationId: LOC, slug: 'mahdavi' }) === 'removed', 'Remove reports (Live): removes the "Reports" link');
  const del = calls.filter(c => c.method === 'DELETE');
  check(del.length === 1 && del[0].path === '/custom-menus/rep0link0id0aa00001', 'exactly that link: never the KPI Dashboard link, never another sub-account\'s'); }
{ fakeGhl([kpiLink]); check(await M.removeReportsLink({ token: 't', locationId: LOC, slug: 'mahdavi' }) === 'none', 'no Reports link of ours → "none", the KPI link stays'); }
// guard: the KPI rules are unchanged, Reports only with its exact shape
let blocked = 0;
for (const b of [{ ...M.reportsMenuBody({ locationId: LOC, url: `${M.PAGES}firms/mahdavi/` }) }, { ...M.reportsMenuBody({ locationId: LOC, url: 'https://x.example/firms/mahdavi/reports.html' }) }, { ...M.reportsMenuBody({ locationId: LOC, url: `${M.PAGES}firms/mahdavi/reports.html` }), openMode: 'new_tab' }, { ...M.reportsMenuBody({ locationId: LOC, url: `${M.PAGES}firms/mahdavi/reports.html` }), allowCamera: true }]) { try { M.guardMenu('POST', '/custom-menus/', b); } catch { blocked++; } }
check(blocked === 4, 'guard: a "Reports" link with another URL, host, open mode or camera on is refused before sending');
let kpiOk = true; try { M.guardMenu('POST', '/custom-menus/', M.menuBody({ locationId: LOC, url: `${M.PAGES}firms/mahdavi/#k=x` })); } catch { kpiOk = false; }
check(kpiOk && M.MENU_TITLE === 'KPI Dashboard', 'the KPI Dashboard link is allowed exactly as before');

// planReports: the state checks before anything runs
const tmp = await mkdtemp(join(tmpdir(), 'reports-menu-')) + '/';
try {
  await mkdir(`${tmp}firms/mahdavi`, { recursive: true });
  await writeFile(`${tmp}firms/index.json`, JSON.stringify([{ slug: 'mahdavi', secretKey: 'MAHDAVI' }]));
  await writeFile(`${tmp}firms/mahdavi/config.json`, JSON.stringify({ locationId: LOC }));
  check(/no Reports set up/.test((await planReports({ root: tmp, slug: 'mahdavi', kind: 'reports' })).error), 'not set up → refused');
  await writeFile(`${tmp}${RC.configPath('mahdavi')}`, JSON.stringify(RC.newConfig({ slug: 'mahdavi', locationId: '3839215' })));
  const p = await planReports({ root: tmp, slug: 'mahdavi', kind: 'reports' });
  check(p.key === 'MAHDAVI' && p.location === LOC, 'Draft → Add to GHL menu goes ahead (key + location)');
  check(/Draft: the Builder removes it/.test((await planReports({ root: tmp, slug: 'mahdavi', kind: 'reports-remove' })).error), 'Remove of a Draft never goes to GHL');
  await writeFile(`${tmp}${RC.configPath('mahdavi')}`, JSON.stringify(RC.withLive(RC.newConfig({ slug: 'mahdavi', locationId: '3839215' }), { by: 'x' })));
  check(/already Live/.test((await planReports({ root: tmp, slug: 'mahdavi', kind: 'reports' })).error) && !(await planReports({ root: tmp, slug: 'mahdavi', kind: 'reports-remove' })).error, 'Live: no second link; Remove goes ahead');
} finally { await rm(tmp, { recursive: true, force: true }); }

const yml = await readFile(join(ROOT, '.github/workflows/menu-link.yml'), 'utf8');
check(/kind:\n\s+description: "kpi \(default\) · reports · reports-remove"\n\s+required: false\n\s+default: "kpi"/.test(yml), 'menu-link.yml: optional kind, default kpi');
check((yml.match(/if: env\.NF_KIND == 'kpi'/g) || []).length === 2 && /node scripts\/new-firm\.mjs menu$/m.test(yml) && /node scripts\/new-firm\.mjs go-live/.test(yml), 'the KPI steps run only for kind kpi, unchanged');
check(/else echo "Refused: unknown kind/.test(yml), 'an unknown kind is refused');
console.log(`\n${pass} of ${pass + fail} reports menu tests pass.`);
process.exitCode = fail ? 1 : 0;
