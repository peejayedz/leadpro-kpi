// v1.44.0 (queue item 15): Change passphrase.   Run: node tests/pass/run.mjs   (no dependencies, no network)
// Re-lock with a check (and nothing written when a file doesn't open), roll back, the wait decisions, the firm plan (KPI firm
// and Reports-only client), the GHL menu URL update (only the firm's own links, same ids, only the URL; blocked otherwise).
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as PR from '../../scripts/pass-rotate.mjs';
import * as M from '../../scripts/ghl-menu.mjs';
import * as RC from '../../scripts/reports-core.mjs';
import { encryptJSON, decryptJSON } from '../../scripts/kpi-core.mjs';

let pass = 0, fail = 0;
const check = (ok, what, extra = '') => { if (ok) { pass++; console.log(`✓ ${what}`); } else { fail++; console.log(`✗ ${what}${extra ? `\n    ${extra}` : ''}`); } };
const OLD = 'old-made-up-pass-1111', NEW = 'ZZMARKER-new-made-up-pass-2222', ITER = 1000;
const tmp = await mkdtemp(join(tmpdir(), 'pass-'));
try {
  const root = `${tmp}/`;
  await mkdir(join(tmp, 'firms/acme/data'), { recursive: true });
  await writeFile(join(tmp, 'firms/index.json'), JSON.stringify([{ slug: 'acme', secretKey: 'ACME', locationId: 'Po7mOmrwAAslMJZAwIeA' }]));
  const details = { leads: [{ name: 'Made Up Person', phone: '555' }] }, report = { v: 2, slug: 'acme', calls: { t: 3 } };
  await writeFile(join(tmp, 'firms/acme/data/details.enc.json'), JSON.stringify(await encryptJSON(details, OLD, ITER)));
  await writeFile(join(tmp, RC.dataPath('acme')), JSON.stringify({ v: 2, generatedAt: 'x', enc: await encryptJSON(report, OLD, ITER) }));
  const changed = await PR.relock({ root, slug: 'acme', from: OLD, to: NEW, iter: ITER });
  check(changed.length === 2, 'both encrypted files re-locked (details.enc.json + reports.json)', changed.join(', '));
  const d = JSON.parse(await readFile(join(tmp, 'firms/acme/data/details.enc.json'), 'utf8')), r = JSON.parse(await readFile(join(tmp, RC.dataPath('acme')), 'utf8'));
  check(JSON.stringify(await decryptJSON(d, NEW)) === JSON.stringify(details) && JSON.stringify(await decryptJSON(r.enc, NEW)) === JSON.stringify(report), 'both open with the NEW passphrase');
  let oldOpens = false; try { await decryptJSON(d, OLD); oldOpens = true; } catch {} try { await decryptJSON(r.enc, OLD); oldOpens = true; } catch {}
  check(!oldOpens && r.v === 2 && r.generatedAt === 'x', 'neither opens with the old one; the reports wrapper is kept');
  const text = (await readFile(join(tmp, 'firms/acme/data/details.enc.json'), 'utf8')) + (await readFile(join(tmp, RC.dataPath('acme')), 'utf8'));
  check(!text.includes(NEW) && !text.includes('Made Up Person'), 'no passphrase and nothing in the clear in the files');
  // a file that doesn't open with "from": nothing is written (all or nothing)
  const before = await readFile(join(tmp, RC.dataPath('acme')), 'utf8');
  await writeFile(join(tmp, 'firms/acme/data/details.enc.json'), JSON.stringify(await encryptJSON(details, 'a-third-pass-3333', ITER)));
  let threw = false; try { await PR.relock({ root, slug: 'acme', from: NEW, to: OLD, iter: ITER }); } catch (e) { threw = /doesn't open/.test(e.message); }
  check(threw && (await readFile(join(tmp, RC.dataPath('acme')), 'utf8')) === before, 'a file that doesn\'t open with the current passphrase → refused, NOTHING written (reports.json untouched)');
  // rollback = re-lock back
  await writeFile(join(tmp, 'firms/acme/data/details.enc.json'), JSON.stringify(await encryptJSON(details, NEW, ITER)));
  await PR.relock({ root, slug: 'acme', from: NEW, to: OLD, iter: ITER });
  check(JSON.stringify(await decryptJSON(JSON.parse(await readFile(join(tmp, 'firms/acme/data/details.enc.json'), 'utf8')), OLD)) === JSON.stringify(details), 'roll back: the files open with the old passphrase again');
  // the wait decisions
  const D = PR.decide;
  check(D(null, 'r1') === 'wait' && D({ request: 'r1', state: 'encrypted' }, 'r1') === 'wait' && D({ request: 'r1', state: 'swapped' }, 'r1') === 'wait', 'wait while the Builder works');
  check(D({ request: 'r1', state: 'finished' }, 'r1') === 'done' && D({ request: 'r1', state: 'abort' }, 'r1') === 'back', 'finished → done · abort → roll back');
  check(D({ request: 'r1', state: 'swapped' }, 'r1', { timedOut: true }) === 'done-unconfirmed' && D({ request: 'r1', state: 'encrypted' }, 'r1', { timedOut: true }) === 'back' && D({ request: 'other', state: 'finished' }, 'r1', { timedOut: true }) === 'back', 'no answer: keep the new files only when the secret was already swapped; else roll back; another request never counts');
  // the plan: KPI firm / Reports-only client / unknown
  check(JSON.stringify(await PR.plan({ root, slug: 'acme' })) === JSON.stringify({ key: 'ACME', location: 'Po7mOmrwAAslMJZAwIeA' }), 'plan: a KPI firm');
  await mkdir(join(tmp, 'firms/solo'), { recursive: true });
  await writeFile(join(tmp, RC.configPath('solo')), JSON.stringify({ reportsOnly: { name: 'Solo', locationId: 'Zz9zZz9zZz9zZz9zZz9z', secretKey: 'SOLO' } }));
  check((await PR.plan({ root, slug: 'solo' })).key === 'SOLO' && (await PR.plan({ root, slug: 'nope' })).error, 'plan: a Reports-only client (item 13) works; an unknown slug is refused');
} finally { await rm(tmp, { recursive: true, force: true }); }

// ---------------------------------------------------------------- the GHL menu links (fake GHL)
const LOC = 'Po7mOmrwAAslMJZAwIeA', calls = [];
const links = [
  { id: 'kpi0link0id0aa00001', title: 'KPI Dashboard', url: `${M.PAGES}firms/acme/#k=${OLD}`, locations: [LOC], showToAllLocations: false, showOnCompany: false, showOnLocation: true, openMode: 'iframe' },
  { id: 'rep0link0id0aa00001', title: 'Reports', url: `${M.PAGES}firms/acme/reports.html#k=${OLD}`, locations: [LOC], showToAllLocations: false, showOnCompany: false, showOnLocation: true, openMode: 'iframe' },
  { id: 'oth0link0id0aa00001', title: 'KPI Dashboard', url: `${M.PAGES}firms/other/#k=x`, locations: ['Bb7mOmrwAAslMJZAwIeB'], showToAllLocations: false, showOnCompany: false },
];
globalThis.fetch = async (u, init = {}) => { calls.push({ m: init.method || 'GET', p: new URL(u).pathname, body: init.body ? JSON.parse(init.body) : null }); return new Response(JSON.stringify(init.method === 'PUT' ? { ok: true } : { customMenus: links }), { status: 200 }); };
const res = await M.updateLinkUrls({ token: 't', locationId: LOC, slug: 'acme', passphrase: NEW });
check(res.kpi === 'updated' && res.reports === 'updated', 'both of the firm\'s own links updated', JSON.stringify(res));
const puts = calls.filter(c => c.m === 'PUT');
check(JSON.stringify(puts.map(c => c.p)) === JSON.stringify(['/custom-menus/kpi0link0id0aa00001', '/custom-menus/rep0link0id0aa00001']), 'same link ids (PUT only those two)');
check(puts[0].body.url === M.kpiUrl('acme', NEW) && puts[1].body.url === M.reportsUrl('acme', NEW) && puts[0].body.title === 'KPI Dashboard' && puts[1].body.title === 'Reports' && puts.every(c => c.body.openMode === 'iframe' && c.body.locations.length === 1 && c.body.showToAllLocations === false), 'only the URL changes (same title, one sub-account, iframe)');
check(!JSON.stringify(res).includes(NEW), 'the result carries no passphrase');
calls.length = 0; links[0].url = `${M.PAGES}firms/acme/`; links.splice(1, 1);
const r2 = await M.updateLinkUrls({ token: 't', locationId: LOC, slug: 'acme', passphrase: NEW });
check(r2.kpi === 'skipped-no-passphrase' && r2.reports === 'none' && !calls.some(c => c.m === 'PUT'), 'a link without #k= is left alone; no Reports link = none; no PUT');
let blocked = 0;
for (const [b, chk] of [[{ ...M.menuBody({ locationId: LOC, url: M.kpiUrl('acme', NEW) }) }, null], [{ ...M.menuBody({ locationId: LOC, url: 'https://evil.example/' }) }, links[0]], [{ ...M.menuBody({ locationId: LOC, url: M.kpiUrl('acme', NEW) }), showToAllLocations: true }, links[0]]]) {
  try { M.guardMenu('PUT', '/custom-menus/kpi0link0id0aa00001', b, chk); } catch { blocked++; }
}
check(blocked === 3, 'the guard refuses a PUT that wasn\'t just checked, points elsewhere, or widens the link');
const yml = await readFile(new URL('../../.github/workflows/pass-rotate.yml', import.meta.url), 'utf8');
check(/group: sync/.test(yml) && /PASSPHRASE_NEW_\{0\}/.test(yml) && !/echo .*PASS/.test(yml), 'pass-rotate.yml: in the sync concurrency group; reads PASSPHRASE_<KEY> + PASSPHRASE_NEW_<KEY> by name; never echoes them');
console.log(`\n${pass} of ${pass + fail} passphrase tests pass.`);
process.exitCode = fail ? 1 : 0;
