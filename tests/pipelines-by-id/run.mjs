// v1.30.0 law firms count pipelines by ID.   Run:  node tests/pipelines-by-id/run.mjs   (Node 20+, no dependencies)
//
// Real scripts/sync.mjs against tests/care/mock-ghl.mjs, in a temp copy of the repo, with Mahdavi's real config and
// discovery.json: the first sync migrates the counted names to ids (saved in config.json); a pipeline renamed in GHL keeps
// counting (identical numbers); a counted pipeline that's gone (or a name the migration can't find, e.g. Dumas on
// 19 Nov 2026) stops the sync with "Pipeline not found" (result category "pipeline", the last kpis.json kept, never 0);
// the bell + Slack text; Edit mapping keeps a renamed pipeline ticked. Writes nothing in the repo.

import { readFile, writeFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from '../care/mock-ghl.mjs';
import { resolvePipelines } from '../../scripts/pipelines.mjs';
import { updateStatus, describeIssue, openIssues, inBadge } from '../../scripts/sync-status.mjs';
import { startText } from '../../scripts/kpi-alerts.mjs';
import { initialState, buildMapping, applyMapping } from '../../admin/mapping.mjs';
import { applyPipelineIds } from '../../scripts/apply-pipeline-ids.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, what) => { if (!v) throw new Error(what); };
const readJSON = async p => JSON.parse(await readFile(p, 'utf8'));
const jsonText = o => JSON.stringify(o, null, 2) + '\n';

// Mahdavi's real config as it was before v1.30.0 (its saved ids taken off: this suite starts from "never migrated")
const CFG = (({ pipelineIds, ...c }) => c)(await readJSON(join(ROOT, 'firms/mahdavi/config.json')));
const DISC = await readJSON(join(ROOT, 'firms/mahdavi/discovery.json'));
const LEAD = DISC.pipelines.find(p => p.name === 'Lead Stages');
// a second pipeline that isn't counted: its opportunities must never be counted
const OTHER = { id: 'otherPipe0000000001', name: 'Onboarding', stages: [{ id: 'ob-1', name: 'Kick-off' }] };
const PIPES = [LEAD, OTHER];
const DAY = 864e5;
function opps() {
  const out = []; let n = 0; const now = Date.now();
  for (const p of PIPES) for (const s of p.stages) for (let k = 0; k < 3; k++) { n++; const at = new Date(now - (1 + (n * 7) % 80) * DAY).toISOString(); out.push({ id: `o${n}`, contactId: `c${n}`, pipelineId: p.id, pipelineStageId: s.id, status: ['open', 'won', 'lost'][n % 3], monetaryValue: 100 * n, createdAt: at, updatedAt: at, lastStageChangeAt: at, source: 'Web form', name: `Opp ${n}` }); }
  return out;
}
const OPPS = opps();
const leadOpps = OPPS.filter(o => o.pipelineId === LEAD.id).length;

async function repo(cfg) {
  const dir = await mkdtemp(join(tmpdir(), 'lpk-pid-'));
  await cp(join(ROOT, 'scripts'), join(dir, 'scripts'), { recursive: true });
  await cp(join(ROOT, 'firms/_defaults.json'), join(dir, 'firms/_defaults.json'));
  await cp(join(ROOT, 'firms/_defaults'), join(dir, 'firms/_defaults'), { recursive: true });
  await mkdir(join(dir, 'firms/fx'), { recursive: true });
  await writeFile(join(dir, 'firms/fx/config.json'), jsonText({ ...cfg, locationId: 'MOCKLOCATION0001' }));
  await writeFile(join(dir, 'firms/fx/discovery.json'), jsonText({ ...DISC, pipelines: PIPES }));
  await writeFile(join(dir, 'firms/index.json'), jsonText([{ slug: 'fx', secretKey: 'FX', name: 'Fx Law', locationId: 'MOCKLOCATION0001' }]));
  return dir;
}
async function sync(dir, mock, extraEnv = {}) {
  const resultFile = join(dir, 'result.json');
  await rm(resultFile, { force: true });
  let code = 0, out = '';
  try { const r = await run(process.execPath, [join(dir, 'scripts/sync.mjs'), 'fx'], { env: { PATH: process.env.PATH, GHL_API_BASE: mock.url, GHL_TOKEN: 'mock', DASHBOARD_PASSPHRASE: '', GHL_BACKOFF_MS: '5', SYNC_RESULT_FILE: resultFile, ...extraEnv }, maxBuffer: 64e6 }); out = r.stdout + r.stderr; }
  catch (e) { code = e.code || 1; out = (e.stdout || '') + (e.stderr || ''); }
  return { code, out, result: await readJSON(resultFile).catch(() => null), kpisText: await readFile(join(dir, 'firms/fx/data/kpis.json'), 'utf8').catch(() => null), cfg: await readJSON(join(dir, 'firms/fx/config.json')) };
}
const strip = t => { const x = JSON.parse(t); delete x.generatedAt; if (x.sync) delete x.sync.checkedAt; for (const p of Object.values(x.periods || {})) { delete p.from; delete p.to; } return JSON.stringify(x); };
const renamed = name => [{ ...LEAD, name }, OTHER];

test('First sync: names → ids saved once (config.pipelineIds), same numbers as by name', async () => {
  const dir = await repo(CFG), mock = await startMock({ pipelines: PIPES, opps: OPPS });
  try {
    const a = await sync(dir, mock);
    eq(a.code, 0, 'exit'); eq(a.result.ok, true, 'ok');
    eq(a.cfg.pipelineIds, [{ id: LEAD.id, name: 'Lead Stages' }], 'ids saved'); eq(a.cfg.pipelines, ['Lead Stages'], 'names kept');
    ok(/counted by ID/.test(a.out), 'log says so');
    const k = JSON.parse(a.kpisText); ok(k.periods.last90.current.totalLeads > 0 && k.periods.last90.current.totalLeads <= leadOpps, 'only the counted pipeline');
    // config.json otherwise unchanged (only the two keys)
    const rest = o => { const x = { ...o }; delete x.pipelineIds; delete x.pipelines; delete x.locationId; return x; };
    eq(rest(a.cfg), rest(CFG), 'nothing else in config.json changed');
    const b = await sync(dir, mock); eq(JSON.stringify(b.cfg), JSON.stringify(a.cfg), 'second sync: no more config changes');
  } finally { await mock.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Pipeline renamed in GHL: still counted by id, numbers identical, new name saved for display', async () => {
  const dir = await repo(CFG), mock = await startMock({ pipelines: PIPES, opps: OPPS });
  try {
    const a = await sync(dir, mock);
    mock.set({ pipelines: renamed('Intake (renamed)') });
    const b = await sync(dir, mock);
    eq(b.code, 0, 'exit'); eq(strip(b.kpisText), strip(a.kpisText), 'numbers identical after the rename');
    eq(b.cfg.pipelineIds, [{ id: LEAD.id, name: 'Intake (renamed)' }], 'id kept, name updated'); eq(b.cfg.pipelines, ['Intake (renamed)'], 'display name');
  } finally { await mock.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Counted pipeline gone: "Pipeline not found", last numbers kept (never 0), no config change', async () => {
  const dir = await repo(CFG), mock = await startMock({ pipelines: PIPES, opps: OPPS });
  try {
    const a = await sync(dir, mock);
    mock.set({ pipelines: [OTHER] });
    const b = await sync(dir, mock);
    eq(b.code, 1, 'exit 1'); eq([b.result.ok, b.result.category, b.result.detail, b.result.missing], [false, 'pipeline', 'not-found', 1], 'result');
    eq(b.kpisText, a.kpisText, 'kpis.json untouched'); eq(b.cfg, a.cfg, 'config untouched');
    ok(!JSON.stringify(b.result).includes('Lead Stages'), 'no names in the public result');
  } finally { await mock.close(); await rm(dir, { recursive: true, force: true }); }
});

test('Name the migration can\'t find (renamed before v1.30.0, like Dumas): "Pipeline not found", not 0 leads', async () => {
  const dir = await repo({ ...CFG, pipelines: ['GHL Build Out Stages (Andrew Cass)'] }), mock = await startMock({ pipelines: PIPES, opps: OPPS });
  try {
    const before = 'previous numbers'; await mkdir(join(dir, 'firms/fx/data'), { recursive: true }); await writeFile(join(dir, 'firms/fx/data/kpis.json'), before);
    const b = await sync(dir, mock);
    eq([b.code, b.result.category], [1, 'pipeline'], 'refused'); eq(b.kpisText, before, 'previous kpis.json kept'); ok(!b.cfg.pipelineIds, 'no ids saved');
  } finally { await mock.close(); await rm(dir, { recursive: true, force: true }); }
});

test('"Every pipeline" firms (config.pipelines []) are unchanged: no ids, every pipeline counted', async () => {
  const dir = await repo({ ...CFG, pipelines: [] }), mock = await startMock({ pipelines: PIPES, opps: OPPS });
  try {
    const a = await sync(dir, mock);
    eq(a.code, 0, 'exit'); ok(!a.cfg.pipelineIds, 'no ids'); eq(a.cfg.pipelines, [], 'still every pipeline');
  } finally { await mock.close(); await rm(dir, { recursive: true, force: true }); }
});

test('resolvePipelines: duplicate names count both (as by name); case/space-insensitive migration', () => {
  const p = [{ id: 'a1', name: 'Leads' }, { id: 'a2', name: ' leads ' }, { id: 'b', name: 'Other' }];
  const r = resolvePipelines({ pipelines: ['LEADS'] }, p);
  eq([...r.ids], ['a1', 'a2'], 'both'); eq(r.migrated, true, 'migrated'); eq(r.missing, [], 'none missing');
  const g = resolvePipelines({ pipelines: ['Leads'], pipelineIds: [{ id: 'zz', name: 'Leads' }] }, p);
  eq(g.missing, [{ id: 'zz', name: 'Leads' }], 'an id GHL lacks is missing even when the name exists');
});

test('Bell: "Pipeline not found · <firm>" counts in the badge, links to Edit mapping; Slack the same', () => {
  const now = Date.now(), at = new Date(now).toISOString();
  const s = updateStatus(null, { now, attempted: ['fx'], results: { fx: { slug: 'fx', ok: false, at, category: 'pipeline', detail: 'not-found', missing: 2 } }, runUrl: null });
  const i = s.open.find(x => x.id === 'fx:failed');
  eq([i.category, i.detail, i.missing], ['pipeline', 'not-found', 2], 'status file issue'); ok(inBadge(i), 'in the badge');
  const d = describeIssue(i, { now });
  eq(d.title, 'Pipeline not found', 'title'); ok(d.actions[0] === 'map' && /Edit mapping/.test(d.steps[0]) && /rather than show 0/.test(d.what) && /<b>2<\/b> pipelines/.test(d.what), 'text + Edit mapping first');
  ok(openIssues(s, { now, firms: [{ slug: 'fx' }] }).some(x => x.id === 'fx:failed'), 'listed');
  const t = startText(i, { firms: [{ slug: 'fx', name: 'Fx Law' }], now });
  ok(/^:warning: \*Pipeline not found · Fx Law\*/.test(t) && /#\/map\/fx\|Edit mapping →/.test(t), `Slack text: ${t}`);
});

test('Edit mapping: a renamed pipeline stays ticked (by id) and saves by id; an older config\'s unchanged save is byte-identical', () => {
  const cfg = { ...CFG, pipelineIds: [{ id: LEAD.id, name: 'Lead Stages' }] };
  const disc = { ...DISC, pipelines: renamed('Intake (renamed)') };
  const st = initialState({ discovery: disc, config: cfg, isNew: false });
  eq([...st.chosenPipes], [LEAD.id], 'still ticked after the rename');
  const next = applyMapping(JSON.parse(JSON.stringify(cfg)), buildMapping(st, disc));
  eq(next.pipelineIds, [{ id: LEAD.id, name: 'Intake (renamed)' }], 'saved by id with the new name');
  const old = JSON.parse(JSON.stringify(CFG)), st2 = initialState({ discovery: DISC, config: old, isNew: false });
  eq(JSON.stringify(applyMapping(JSON.parse(JSON.stringify(old)), buildMapping(st2, DISC))), JSON.stringify(old), 'unchanged save: byte-identical');
  // Dumas: the old name matches nothing → nothing ticked; ticking the pipeline saves it by id
  const dumas = { ...CFG, pipelines: ['GHL Build Out Stages (Andrew Cass)'] }, st3 = initialState({ discovery: DISC, config: dumas, isNew: false });
  eq(st3.chosenPipes.size, 0, 'nothing ticked'); st3.chosenPipes.add(LEAD.id);
  eq(applyMapping(JSON.parse(JSON.stringify(dumas)), buildMapping(st3, DISC)).pipelineIds, [{ id: LEAD.id, name: 'Lead Stages' }], 'fixed by id');
});

// v1.30.1: in GitHub each firm syncs in its own job and only data/ reaches the commit job: the ids go in a side file
test('sync.yml path: the ids travel in a side file and the commit job saves them in the latest config.json (only those two keys)', async () => {
  const dir = await repo(CFG), mock = await startMock({ pipelines: PIPES, opps: OPPS });
  try {
    const out = join(dir, 'out/_pipelines');
    const a = await sync(dir, mock, { PIPELINE_IDS_OUT: out });
    eq(a.code, 0, 'exit');
    const side = JSON.parse(await readFile(join(out, 'fx.json'), 'utf8'));
    eq([side.slug, side.pipelineIds, side.pipelines, side.from.pipelines], ['fx', [{ id: LEAD.id, name: 'Lead Stages' }], ['Lead Stages'], ['Lead Stages']], 'side file');
    // the commit job's checkout = the config as it was (the matrix job's change is gone), plus another key changed meanwhile
    const latest = { ...CFG, locationId: 'MOCKLOCATION0001', notice: { show: false } };
    await writeFile(join(dir, 'firms/fx/config.json'), jsonText(latest));
    eq(await applyPipelineIds(join(dir, 'out'), dir), [{ slug: 'fx', result: 'saved' }], 'saved');
    const c = await readJSON(join(dir, 'firms/fx/config.json'));
    eq(c.pipelineIds, [{ id: LEAD.id, name: 'Lead Stages' }], 'ids saved'); eq(c.notice, { show: false }, 'the other change kept');
    const rest = o => { const x = { ...o }; delete x.pipelineIds; return x; };
    eq(rest(c), latest, 'nothing else changed');
    // Edit mapping changed the pipelines meanwhile → the side file is skipped
    await writeFile(join(dir, 'firms/fx/config.json'), jsonText({ ...latest, pipelines: ['Onboarding'] }));
    eq(await applyPipelineIds(join(dir, 'out'), dir), [{ slug: 'fx', result: 'skipped (changed since)' }], 'skipped');
    eq((await readJSON(join(dir, 'firms/fx/config.json'))).pipelines, ['Onboarding'], 'Edit mapping wins');
    // kpis.json and other files in the artifact are never read as side files
    await mkdir(join(dir, 'out/fx'), { recursive: true }); await writeFile(join(dir, 'out/fx/kpis.json'), JSON.stringify({ slug: 'fx', pipelineIds: [{ id: 'x' }], pipelines: ['x'] }));
    await writeFile(join(dir, 'firms/fx/config.json'), jsonText(latest));
    await rm(join(out, 'fx.json'));
    eq(await applyPipelineIds(join(dir, 'out'), dir), [], 'only _pipelines/*.json');
  } finally { await mock.close(); await rm(dir, { recursive: true, force: true }); }
});
test('sync.yml: the sync job writes the side file; the commit job runs apply-pipeline-ids before the status and the commit', async () => {
  const y = await readFile(join(ROOT, '.github/workflows/sync.yml'), 'utf8');
  ok(/PIPELINE_IDS_OUT: \$\{\{ runner\.temp \}\}\/out\/_pipelines/.test(y), 'env in the sync job (inside the uploaded out/ folder)');
  const i = y.indexOf('node scripts/apply-pipeline-ids.mjs'), c = y.indexOf('name: Copy firm data'), st = y.indexOf('name: Update sync status'), cm = y.indexOf('git add -A firms status');
  ok(i > c && i < st && i < cm, 'after the data copy, before the status and the commit');
});

let pass = 0;
for (const t of tests) {
  const t0 = Date.now();
  try { await t.fn(); pass++; console.log(`PASS  ${t.name}  (${((Date.now() - t0) / 1000).toFixed(1)} s)`); }
  catch (e) { console.log(`FAIL  ${t.name}\n      ${e.message}`); }
}
console.log(`\n${pass} of ${tests.length} tests pass.`);
process.exit(pass === tests.length ? 0 : 1);
