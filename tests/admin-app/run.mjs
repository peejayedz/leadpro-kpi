// Admin page → New firm → "Use the LeadPro app".   Run:  node tests/admin-app/run.mjs [filter]   (Node 20+, no dependencies)
//
// admin/app-path.mjs against a mock GitHub (firm list, secrets, new-firm.yml runs and their jobs, sync):
// a clean run, the app missing (plain error), a double Create (one dispatch, one firm), a location that already
// has a firm (refused, nothing written), Retry finishing only what's missing (first sync only; never a second
// passphrase), a run already going in another tab (followed, not started again), and nothing secret in any
// step text, log, dispatch input or run title. Writes nothing.

import { createAppRun, chooseSlug, errorFor, STEP_ERRORS, presetChoices } from '../../admin/app-path.mjs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const only = process.argv[2] || '';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, what) => { if (!v) throw new Error(what); };

const PASS = 'amber-otter-quill-raven';
const LOC = 'TestLoc000000000001';
const CTX = { name: 'Smith & Jones Law', locationId: LOC, practiceArea: 'Family Law', timezone: 'America/Chicago', snapshotId: 'snap-acme', passphrase: PASS };
const PI_FIRMS = [
  { slug: 'mahdavi', secretKey: 'MAHDAVI', name: 'The Mahdavi Law Firm', locationId: 'INZKoa3nu45xtcZB0Yuq' },
  { slug: 'emery-law-office', secretKey: 'EMERY_LAW_OFFICE', name: 'Emery Law Office', locationId: 'l68l8TvqZyERd5q1zdlj' },
];

// A mock GitHub. outcome: 'ok' | 'app-missing' | 'sync-fails' | 'sync-fails-once'
function mockGitHub({ outcome = 'ok', index = PI_FIRMS, secrets = [] } = {}) {
  const M = { index: structuredClone(index), secrets: new Map(secrets.map(s => [s, 'x'])), runs: [], dispatches: [], syncs: 0, configs: {}, kpis: new Set(), log: [], putCalls: [] };
  const JOBS = ['prepare', 'token', 'setup', 'first-sync', 'menu-link'];
  const advance = run => {
    // Every poll moves the run one job further.
    run.tick++;
    const n = run.tick;
    run.jobs = JOBS.map((name, i) => {
      if (i + 1 < n) return { name, status: 'completed', conclusion: 'success', steps: [] };
      if (i + 1 === n) return { name, status: 'in_progress', conclusion: null, steps: name === 'prepare' ? [{ name: 'Wait for the app on the sub-account', status: 'in_progress' }] : [] };
      return { name, status: 'queued', conclusion: null, steps: [] };
    });
    const fail = (i, step) => { run.jobs[i] = { name: JOBS[i], status: 'completed', conclusion: 'failure', steps: [{ name: step, conclusion: 'failure' }] }; for (let k = i + 1; k < JOBS.length; k++) run.jobs[k] = { name: JOBS[k], status: 'completed', conclusion: 'skipped', steps: [] }; run.status = 'completed'; run.conclusion = 'failure'; };
    if (outcome === 'app-missing' && n >= 2) return fail(0, 'Wait for the app on the sub-account');
    if (n >= 4 && !M.index.some(f => f.slug === run.inputs.slug)) {   // the setup job writes the firm (once)
      M.index.push({ slug: run.inputs.slug, secretKey: run.inputs.slug.toUpperCase().replace(/-/g, '_'), name: run.inputs.name, locationId: run.inputs.location, tokenSource: 'app' });
      M.configs[run.inputs.slug] = { locationId: run.inputs.location };
    }
    if ((outcome === 'sync-fails' || (outcome === 'sync-fails-once' && M.syncs === 0)) && n >= 5) { M.syncs++; return fail(3, 'First sync'); }
    if (n >= 6) { M.kpis.add(run.inputs.slug); M.configs[run.inputs.slug].menuLink = { status: 'created' }; run.jobs.forEach(j => Object.assign(j, { status: 'completed', conclusion: 'success' })); run.status = 'completed'; run.conclusion = 'success'; }
  };
  const deps = {
    readIndex: async () => structuredClone(M.index),
    secretExists: async name => M.secrets.has(name),
    putPassphrase: async (key, value) => { M.putCalls.push(key); M.secrets.set(`PASSPHRASE_${key}`, value); },
    dispatchNewFirm: async inputs => { M.dispatches.push(structuredClone(inputs)); M.runs.push({ id: M.runs.length + 1, display_title: `New firm ${inputs.slug} [${inputs.request}]`, status: 'queued', conclusion: null, html_url: `https://github.example/run/${M.runs.length + 1}`, inputs, tick: 0, jobs: [] }); return Date.now(); },
    listNewFirmRuns: async () => M.runs.map(({ id, display_title, status, conclusion, html_url }) => ({ id, display_title, status, conclusion, html_url })),
    getRun: async id => { const r = M.runs.find(x => x.id === id); if (r.status !== 'completed') { r.status = 'in_progress'; advance(r); } return { id: r.id, display_title: r.display_title, status: r.status, conclusion: r.conclusion, html_url: r.html_url }; },
    getJobs: async id => ({ jobs: structuredClone(M.runs.find(x => x.id === id).jobs) }),
    readConfig: async slug => structuredClone(M.configs[slug] || null),
    hasKpis: async slug => M.kpis.has(slug),
    runSync: async (slug, say) => { say('Syncing…'); M.syncs++; if (outcome === 'sync-fails') throw new Error('run failed'); M.kpis.add(slug); M.configs[slug].menuLink ||= { status: 'created' }; },
    newRequestId: (() => { let n = 0; return () => `req${++n}`; })(),
    sleep: async () => {}, pollMs: 0,
    onStep: (k, st, d) => M.log.push(`${k}:${st}:${d ?? ''}`),
    onRun: url => M.log.push(`run:${url}`),
  };
  return { M, deps };
}
const noSecret = (M, extra = []) => {
  const all = [...M.log, ...extra, JSON.stringify(M.dispatches), JSON.stringify(M.runs.map(r => r.display_title)), JSON.stringify(M.index), JSON.stringify(M.configs)].join('\n');
  ok(!all.includes(PASS), 'the passphrase appears in a log, step text, dispatch, run title or file');
};

test('Clean run: one passphrase secret, one dispatch with non-secret inputs only, one firm, menu link created', async () => {
  const { M, deps } = mockGitHub();
  const r = createAppRun(deps);
  const done = await r.start(CTX);
  eq(done, { slug: 'smith-and-jones-law', key: 'SMITH_AND_JONES_LAW', review: 'none', menu: 'created' }, 'result');
  eq(M.putCalls, ['SMITH_AND_JONES_LAW'], 'passphrase saved once');
  eq(M.dispatches.length, 1, 'one dispatch');
  eq(Object.keys(M.dispatches[0]).sort(), ['location', 'name', 'practice_area', 'request', 'slug', 'snapshot_id', 'timezone'], 'inputs are the builder\'s non-secret set');
  eq(M.dispatches[0].snapshot_id, 'snap-acme', 'preset snapshot passed');
  eq(M.index.filter(f => f.locationId === LOC).length, 1, 'one firm');
  ok(M.log.includes('menu:ok:"KPI Dashboard" added to this sub-account\'s menu (opens in a new tab).'), 'menu step');
  noSecret(M);
});

test('App missing → plain error at "Check the LeadPro app", nothing in the firm list', async () => {
  const { M, deps } = mockGitHub({ outcome: 'app-missing' });
  const r = createAppRun(deps);
  let err = null; try { await r.start(CTX); } catch (e) { err = e; }
  ok(err, 'should fail');
  eq(err.step, 'app', 'failed step');
  eq(err.message, STEP_ERRORS['Wait for the app on the sub-account'], 'plain message');
  ok(!/\b(exit code|stack|Error:|undefined)\b/.test(err.message), 'no technical text');
  eq(M.index.some(f => f.locationId === LOC), false, 'no firm');
  noSecret(M, [err.message]);
});

test('Double Create (two clicks at once) → one dispatch, one passphrase, one firm', async () => {
  const { M, deps } = mockGitHub();
  const r = createAppRun(deps);
  const [a, b] = await Promise.all([r.start(CTX), r.start(CTX)]);
  eq(a, b, 'same result');
  eq(M.dispatches.length, 1, 'one dispatch');
  eq(M.putCalls.length, 1, 'one passphrase');
  eq(M.index.filter(f => f.locationId === LOC).length, 1, 'one firm');
});

test('Retry while the setup is still running on GitHub → follows that run, never starts a second one', async () => {
  const { M, deps } = mockGitHub();
  const slow = { ...deps, sleep: () => new Promise(r => setTimeout(r, 2)) };
  const first = createAppRun(slow);
  const p1 = first.start(CTX).catch(() => {});
  while (!M.dispatches.length) await new Promise(r => setTimeout(r, 1));
  // e.g. the page was left and the same firm is retried from a second run object with the saved state
  const second = createAppRun({ ...slow, readIndex: async () => structuredClone(M.index.filter(f => f.locationId !== LOC)) });
  Object.assign(second.state, { slug: 'smith-and-jones-law', passSaved: true });
  await Promise.all([p1, second.retry(CTX)]);
  eq(M.dispatches.length, 1, 'one dispatch');
  eq(M.putCalls.length, 1, 'one passphrase');
  eq(M.index.filter(f => f.locationId === LOC).length, 1, 'one firm');
});

test('A location that already has a firm is refused (Private Integration or app), nothing written', async () => {
  for (const firm of [PI_FIRMS[0], { slug: 'zz-test-2', secretKey: 'ZZ_TEST_2', name: 'ZZ TEST 2', locationId: 'bZ8sYUlHFufn3rH3TXip', tokenSource: 'app' }]) {
    const { M, deps } = mockGitHub({ index: [...PI_FIRMS, firm] });
    let err = null; try { await createAppRun(deps).start({ ...CTX, locationId: firm.locationId }); } catch (e) { err = e; }
    ok(err?.refused, `${firm.slug}: refused`);
    eq(err.step, 'check', 'at the check step');
    ok(err.message.includes(firm.slug), 'names the firm');
    eq([M.putCalls.length, M.dispatches.length], [0, 0], 'no secret, no dispatch');
  }
});

test('Slug clash with a firm or a leftover passphrase secret → next free name', async () => {
  eq(await chooseSlug('Mahdavi', async s => s === 'mahdavi'), 'mahdavi-2', 'firm');
  const { M, deps } = mockGitHub({ secrets: ['PASSPHRASE_SMITH_AND_JONES_LAW'] });
  const done = await createAppRun(deps).start(CTX);
  eq(done.slug, 'smith-and-jones-law-2', 'leftover secret skipped');
  ok(M.secrets.get('PASSPHRASE_SMITH_AND_JONES_LAW') === 'x', 'the leftover secret is never overwritten');
});

test('Retry after the first sync failed → only the sync runs again (no dispatch, no new passphrase)', async () => {
  const { M, deps } = mockGitHub({ outcome: 'sync-fails-once' });
  const r = createAppRun(deps);
  let err = null; try { await r.start(CTX); } catch (e) { err = e; }
  eq(err?.step, 'sync', 'first run fails at the sync');
  eq(M.index.filter(f => f.locationId === LOC).length, 1, 'firm saved by the setup job');
  const before = { d: M.dispatches.length, p: M.putCalls.length, s: M.syncs };
  M.log.length = 0;
  const done = await r.retry(CTX);
  eq(M.dispatches.length, before.d, 'no new dispatch');
  eq(M.putCalls.length, before.p, 'passphrase not made or saved again');
  eq(M.syncs, before.s + 1, 'one more sync');
  eq(done.menu, 'created', 'finished');
  ok(M.log.includes('setup:ok:Done earlier.'), 'earlier steps shown as done');
  eq(M.index.filter(f => f.locationId === LOC).length, 1, 'still one firm');
  noSecret(M);
});

test('Retry after the app was missing → starts the setup again with the same name and saved passphrase', async () => {
  const { M, deps } = mockGitHub({ outcome: 'app-missing' });
  const r = createAppRun(deps);
  try { await r.start(CTX); } catch {}
  const slug = M.dispatches[0].slug;
  // The app shows up: GitHub's next run succeeds.
  const fixed = mockGitHub(); Object.assign(fixed.M, { index: M.index, secrets: M.secrets });
  const r2deps = { ...deps, ...['getRun', 'getJobs', 'dispatchNewFirm', 'listNewFirmRuns', 'readConfig', 'hasKpis'].reduce((o, k) => ({ ...o, [k]: fixed.deps[k] }), {}), readIndex: async () => structuredClone(fixed.M.index) };
  // The page keeps the run's state (slug, passphrase saved) across Retry; carry it over to the run with the new mock.
  const again = createAppRun(r2deps); Object.assign(again.state, { slug, passSaved: true });
  const done = await again.retry(CTX);
  eq(done.slug, slug, 'same slug');
  eq(fixed.M.dispatches.length, 1, 'one new dispatch');
  eq(fixed.M.dispatches[0].slug, slug, 'for the same firm');
  eq(M.putCalls.length, 1, 'passphrase saved only the first time');
});

test('errorFor: cancelled and unknown steps get plain words; the menu-link job never fails the setup', () => {
  eq(errorFor([{ name: 'token', conclusion: 'cancelled' }]).message, 'GitHub cancelled the setup. Retry is safe: it never creates the firm twice.', 'cancelled');
  ok(errorFor([{ name: 'setup', conclusion: 'failure', steps: [{ name: 'Something new', conclusion: 'failure' }] }]).message.startsWith('The setup stopped at "Something new"'), 'unknown');
  eq(errorFor([{ name: 'menu-link', conclusion: 'failure', steps: [] }]).step, 'menu', 'menu');
  for (const msg of Object.values(STEP_ERRORS)) ok(!/token=|pit-|PASSPHRASE_[A-Z]/.test(msg), 'no secret names or values in messages');
});

test('Presets: the ACME preset is offered with its first snapshot id', async () => {
  const p = JSON.parse(await readFile(`${ROOT}firms/_presets/acme-lead-stages.json`, 'utf8'));
  const c = presetChoices([p]);
  eq(c.length, 1, 'one choice'); eq(c[0].name, p.name, 'name'); eq(c[0].snapshotId, p.snapshots[0].id, 'snapshot id');
});

test('Admin page source: the passphrase only reaches putSecret; the app path dispatches only new-firm.yml and sync.yml', async () => {
  const src = await readFile(`${ROOT}admin/index.html`, 'utf8');
  ok(src.includes("from './app-path.mjs'"), 'page uses app-path.mjs');
  ok(!/console\.(log|info|debug)\([^)]*pass/i.test(src), 'no console logging of a passphrase');
  const block = src.slice(src.indexOf('// ---------- app path'), src.indexOf('// ---------- end app path'));
  ok(block.length > 100, 'app path block found');
  const dispatched = [...block.matchAll(/dispatch\('([^']+)'/g)].map(m => m[1]);
  ok(dispatched.every(w => ['new-firm.yml', 'sync.yml'].includes(w)), `only new-firm.yml / sync.yml (got ${dispatched})`);
});

let failed = 0;
for (const t of tests.filter(t => t.name.toLowerCase().includes(only.toLowerCase()))) {
  try { await t.fn(); console.log(`✓ ${t.name}`); }
  catch (e) { failed++; console.log(`✗ ${t.name}\n    ${e.message}`); }
}
console.log(failed ? `\n${failed} failed` : '\nAll admin app-path tests passed');
process.exitCode = failed ? 1 : 0;
