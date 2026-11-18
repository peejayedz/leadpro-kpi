// v1.28.0 non-law scorecards test suite.   Run:  node tests/care/run.mjs   (Node 20+, no dependencies)
//
//  1. Pre-fill: PBPCS's pipelines (names as PJ read them from GHL on 18 Nov, made-up ids) pre-fill to exactly PJ's
//     mapping from the location preset, and the stage-name guesses alone get every non-Ignore stage right.
//  2. People counting (scripts/care-core.mjs): a contact in 2 pipelines counts once, furthest stage wins; Lost/Abandoned;
//     Won; unmapped and Ignore stages count nowhere; funnel steps are cumulative.
//  3. Real sync (temp copy of the repo, mock GHL), Medical & dental firm:
//     a. mapping by id survives a stage rename in GHL (identical numbers);
//     b. counts only: no contact is fetched, and neither kpis.json nor the decrypted details file holds a name, email or phone;
//     c. drift: a new stage → sync.drift + an "unmapped" bell notice (not in the badge) + a Slack DM with a Map pipelines link;
//        a new pipeline and a removed pipeline are flagged too; the new stage's opportunity counts nowhere;
//     d. a "needsMapping" firm isn't synced (and plan-matrix leaves it out); a "draft" firm's kpis.json says draft.
//  4. new-firm.mjs: a Medical firm gets practiceType, countsOnly, the pre-filled pipelineMap and status needsMapping.
// Law-firm numbers before/after: tests/care/law-identical.mjs. Prints ✓/✗ lines; exits 1 if anything fails.

import { readFile, writeFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CC from '../../scripts/care-core.mjs';
import { decryptJSON } from '../../scripts/kpi-core.mjs';
import { updateStatus, openIssues, describeIssue, inBadge } from '../../scripts/sync-status.mjs';
import { bellIssues, startText } from '../../scripts/kpi-alerts.mjs';
import { buildConfig } from '../../scripts/new-firm.mjs';
import { startMock } from './mock-ghl.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DAY = 864e5;
let fails = 0;
const check = (ok, label, extra = '') => { console.log(`${ok ? '✓' : '✗'} ${label}${!ok && extra ? `\n    ${extra}` : ''}`); if (!ok) fails++; };
const jsonText = o => JSON.stringify(o, null, 2) + '\n';
const preset = JSON.parse(await readFile(join(ROOT, 'firms/_presets/care/palm-beach-plastic.json'), 'utf8'));

// ---------- PBPCS pipelines as PJ listed them (ids made up) ----------
const PIPES = [
  ['Marketing Pipeline', ['New Lead', 'Attempting Contact', 'Connected / Qualifying', 'Closed – Lost']],
  ['Surgical Patients', ['Qualified', 'Consult Booked (In-person / Virtual)', 'Consult Completed', 'Quote Sent / Deciding', 'Deposit Paid / Surgery Scheduled', 'Surgery Completed']],
  ['BII / Explant', ['Qualified', 'Consult Booked (In-person / Virtual)', 'Consult Completed', 'Quote Sent / Deciding', 'Deposit Paid / Surgery Scheduled', 'Travel Confirmed', 'Surgery Completed']],
  ['Non-Surgical / Med Spa', ['Qualified', 'Appointment Booked', 'Treatment Completed', 'Rebook Due']],
  ['Post-Op & Retention', ['1-Week Check', '3-Month Check', 'Review Requested', 'Review Left', 'Referral / Next Procedure']],
];
const discovery = { locationId: 'ZccxN6Zevq1UkgUuOphV', pipelines: PIPES.map(([name, stages], i) => ({ id: `p${i + 1}`, name, stages: stages.map((s, j) => ({ id: `p${i + 1}s${j + 1}`, name: s, position: j })) })) };
const sid = (pipe, stage) => discovery.pipelines.find(p => p.name === pipe).stages.find(s => s.name === stage).id;
const pid = pipe => discovery.pipelines.find(p => p.name === pipe).id;

// ---------- 1. pre-fill ----------
{
  const st = CC.careInitialState({ discovery, config: {}, preset });
  const got = Object.fromEntries(st.pipelines.map(p => [p.name, Object.fromEntries(p.stages.map(s => [s.name, s.bucket]))]));
  const want = preset.pipelines;
  const diffs = Object.entries(want).flatMap(([p, ss]) => Object.entries(ss).filter(([s, b]) => got[p]?.[s] !== b).map(([s, b]) => `${p} · ${s}: ${got[p]?.[s]} ≠ ${b}`));
  check(!diffs.length, 'PBPCS pre-fill from the preset = PJ\'s mapping, every stage (26)', diffs.join('; '));
  check(CC.unchosen(st).length === 0, 'PBPCS: nothing left to choose after the pre-fill');
  const g = CC.careInitialState({ discovery, config: {}, preset: null });
  const wrong = g.pipelines.flatMap(p => p.stages.filter(s => want[p.name][s.name] !== 'ignore' && s.bucket !== want[p.name][s.name]).map(s => `${p.name} · ${s.name}: ${s.bucket}`));
  check(!wrong.length, 'name guesses alone get every non-Ignore PBPCS stage right', wrong.join('; '));
  const ignored = g.pipelines.flatMap(p => p.stages).filter(s => s.bucket === 'ignore');
  check(!ignored.length, 'guesses never pick Ignore (explicit choice only)');
  check(CC.presetBucket(preset, 'marketing pipeline', 'Closed - Lost') === 'lost' && CC.presetBucket(preset, 'Marketing Pipeline', 'Closed—Lost') === 'lost', 'preset names match with any dash style and case');
}
const pipelineMap = CC.buildPipelineMap(CC.careInitialState({ discovery, config: {}, preset }));
const careCfg = { practiceType: 'medical', pipelineMap };
check(Object.keys(pipelineMap.stages).length === 26 &&pipelineMap.pipelines.length === 5 && Object.values(pipelineMap.stages).every(s => s.name && s.pipelineId), 'pipelineMap is stored by stage id, with names kept for display');

// ---------- 2. people counting ----------
const now = Date.now(), ago = d => new Date(now - d * DAY - 3 * 3600e3).toISOString();
const o = (id, cid, pipe, stage, extra = {}) => ({ oppId: id, contactId: cid, pipelineId: pid(pipe), stageId: sid(pipe, stage), status: 'open', value: 0, createdAt: ago(5), ...extra });
{
  const opps = [
    o('a1', 'A', 'Marketing Pipeline', 'Connected / Qualifying'), o('a2', 'A', 'Surgical Patients', 'Deposit Paid / Surgery Scheduled', { value: 9000 }),   // 2 pipelines → 1 person, Yes
    o('b1', 'B', 'Marketing Pipeline', 'Closed – Lost'),                                                                                                   // Lost stage
    o('c1', 'C', 'Marketing Pipeline', 'Attempting Contact', { status: 'abandoned' }),                                                                     // Abandoned = Lost
    o('d1', 'D', 'Marketing Pipeline', 'New Lead', { status: 'lost' }), o('d2', 'D', 'Non-Surgical / Med Spa', 'Appointment Booked'),                   // lost in one, active in another
    o('e1', 'E', 'Post-Op & Retention', 'Review Left'),                                                                                                    // Ignore → nowhere
    { oppId: 'f1', contactId: 'F', pipelineId: 'p1', stageId: 'p1sNEW', status: 'open', value: 0, createdAt: ago(5) },                                   // unmapped stage → nowhere
    o('g1', 'G', 'Non-Surgical / Med Spa', 'Qualified', { status: 'won', value: 500 }),                                                                  // Won → Yes
    o('h1', 'H', 'BII / Explant', 'Surgery Completed', { value: 12000 }),                                                                                 // Done
  ];
  const people = CC.buildPeople(opps, careCfg), by = Object.fromEntries(people.map(p => [p.contactId, p]));
  check(people.length === 6 && !by.E && !by.F, 'counts people: 9 opportunities → 6 people (Ignore and unmapped count nowhere)', JSON.stringify(people.map(p => p.contactId)));
  check(by.A.rank === 5 && by.A.oppIds.length === 2 && by.A.value === 9000, 'a contact in 2 pipelines counts once; furthest stage (Yes) wins');
  check(by.B.lost && by.C.lost, 'Lost = a stage mapped to Lost, or status Abandoned');
  check(!by.D.lost && by.D.rank === 3, 'lost in one pipeline but consult booked in another: not lost (default rule "all")');
  check(CC.buildPeople(opps, { ...careCfg, lostWhen: 'any' }).find(p => p.contactId === 'D').lost, 'lostWhen "any" (a per-firm setting): lost in any pipeline = lost');
  check(by.G.rank === 5 && by.G.value === 500, 'an opportunity marked Won counts as Yes');
  const L = CC.buildCareLists({ people }, careCfg, now - 30 * DAY, now), s = CC.summarizeCare(L, { tracked: false });
  // contacted 5: C was contacted, then abandoned; reaching a step still counts even if they're lost later (as for law firms)
  check(s.enquiries === 6 && s.contacted === 5 && s.booked === 4 && s.attended === 3 && s.yes === 3 && s.done === 1 && s.lost === 2 && s.value === 21500,
    'funnel is cumulative, as for law firms (6 → 5 → 4 → 3 → 3 → 1; lost 2; value $21,500)', JSON.stringify(s));
  check(s.noShowPct === null, 'no-show rate hidden (null) when the firm has no no-show data');
}

// ---------- 3. real sync against the mock ----------
const contacts = { A: { firstName: 'Alice', lastName: 'Secret', email: 'alice@example.com', phone: '+15550001' }, B: { firstName: 'Bob', email: 'bob@example.com', phone: '+15550002' } };
const ghlOpp = (id, cid, pipe, stage, extra = {}) => ({ id, contactId: cid, pipelineId: pid(pipe), pipelineStageId: sid(pipe, stage), status: 'open', monetaryValue: 0, createdAt: ago(4), updatedAt: ago(4), name: `${cid} opp`, ...extra });
const OPPS = [
  ghlOpp('o1', 'A', 'Marketing Pipeline', 'Connected / Qualifying'), ghlOpp('o2', 'A', 'Surgical Patients', 'Consult Completed', { monetaryValue: 8000 }),
  ghlOpp('o3', 'B', 'Marketing Pipeline', 'New Lead'), ghlOpp('o4', 'C', 'Surgical Patients', 'Deposit Paid / Surgery Scheduled', { monetaryValue: 15000 }),
  ghlOpp('o5', 'D', 'Non-Surgical / Med Spa', 'Treatment Completed', { monetaryValue: 900 }), ghlOpp('o6', 'E', 'Post-Op & Retention', '1-Week Check'),
];
async function firmRepo({ cfg, status = null, disc = discovery }) {
  const tmp = await mkdtemp(join(tmpdir(), 'lpk-care-'));
  await cp(join(ROOT, 'scripts'), join(tmp, 'scripts'), { recursive: true });
  await mkdir(join(tmp, 'firms', 'fx'), { recursive: true });
  await cp(join(ROOT, 'firms/_defaults.json'), join(tmp, 'firms/_defaults.json'));
  await cp(join(ROOT, 'firms/_defaults'), join(tmp, 'firms/_defaults'), { recursive: true });
  const template = JSON.parse(await readFile(join(ROOT, 'firms/_template/config.json'), 'utf8'));
  await writeFile(join(tmp, 'firms/fx/config.json'), jsonText({ ...template, locationName: 'Fixture Clinic', practiceArea: 'Plastic & Cosmetic Surgery', locationId: 'MOCKLOCATION0001', ...cfg }));
  await writeFile(join(tmp, 'firms/fx/discovery.json'), jsonText(disc));
  await writeFile(join(tmp, 'firms/index.json'), jsonText([{ slug: 'fx', secretKey: 'FX', name: 'Fixture Clinic', locationId: 'MOCKLOCATION0001', ...(status ? { status } : {}) }]));
  return tmp;
}
async function sync(tmp, mock, pass = '') {
  const r = await run(process.execPath, [join(tmp, 'scripts/sync.mjs'), 'fx'], { env: { ...process.env, GHL_API_BASE: mock.url, GHL_TOKEN: 'mock', DASHBOARD_PASSPHRASE: pass, GHL_BACKOFF_MS: '10', SYNC_RESULT_FILE: join(tmp, 'result.json') } });
  let kpis = null; try { kpis = JSON.parse(await readFile(join(tmp, 'firms/fx/data/kpis.json'), 'utf8')); } catch {}
  return { out: r.stdout + r.stderr, kpis };
}
const numbers = k => JSON.stringify(Object.fromEntries(Object.entries(k.periods).map(([key, p]) => [key, { c: p.current, p: p.previous }])));
const cfgMed = { practiceType: 'medical', countsOnly: true, pipelineMap };
{
  // a. rename survives + b. counts only
  const tmp = await firmRepo({ cfg: cfgMed });
  const mock = await startMock({ pipelines: discovery.pipelines, opps: OPPS, contacts, events: [] });
  try {
    const first = await sync(tmp, mock, 'test-passphrase-123');
    const c = first.kpis?.periods?.last30?.current || {};
    check(c.enquiries === 4 && c.contacted === 3 && c.booked === 3 && c.attended === 3 && c.yes === 2 && c.done === 1 && c.value === 15900,
      'sync: PBPCS-shaped firm counts 4 people from 6 opportunities (A once, E is after-care)', JSON.stringify(c));
    check(first.kpis?.practiceType === 'medical' && first.kpis?.countsOnly === true && !('status' in first.kpis), 'kpis.json: practice type + counts only; no Draft flag for a live firm');
    check(!mock.paths.some(p => /^\/contacts\/[^/]+$/.test(p) && p !== '/contacts/search'), 'counts only: the sync never fetches a contact');
    const pubText = await readFile(join(tmp, 'firms/fx/data/kpis.json'), 'utf8');
    const det = await decryptJSON(JSON.parse(await readFile(join(tmp, 'firms/fx/data/details.enc.json'), 'utf8')), 'test-passphrase-123');
    const detText = JSON.stringify(det);
    const pii = ['Alice', 'Secret', 'alice@example.com', '+15550001', 'Bob', 'bob@example.com'];
    check(!pii.some(x => pubText.includes(x) || detText.includes(x)) && !/"(name|email|phone)"/.test(detText) && !det.contacts, 'counts only: no name, email or phone in kpis.json or the decrypted details file');
    check(Array.isArray(det.opps) && det.opps.every(x => Object.keys(x).sort().join() === 'contactId,createdAt,oppId,pipelineId,stageId,status,value'), 'details file holds ids, stage, status, value and dates only');
    // rename every stage and pipeline in GHL (same ids)
    mock.set({ pipelines: discovery.pipelines.map(p => ({ ...p, name: `${p.name} (renamed)`, stages: p.stages.map(s => ({ ...s, name: `${s.name} v2` })) })) });
    const second = await sync(tmp, mock, 'test-passphrase-123');
    check(numbers(first.kpis) === numbers(second.kpis), 'mapping by id survives renaming every stage and pipeline in GHL (identical numbers)');
    check(!second.kpis.sync?.drift, 'a rename is not drift (same ids)');
    check(second.kpis.pipelines?.[0]?.name?.endsWith('(renamed)'), 'the dashboard shows the current GHL pipeline names');
  } finally { await mock.close(); await rm(tmp, { recursive: true, force: true }); }

  // counts only OFF: names fetched and kept (encrypted) for drill-downs
  const tmp2 = await firmRepo({ cfg: { ...cfgMed, countsOnly: false } });
  const mock2 = await startMock({ pipelines: discovery.pipelines, opps: OPPS, contacts, events: [] });
  try {
    await sync(tmp2, mock2, 'test-passphrase-123');
    const det = await decryptJSON(JSON.parse(await readFile(join(tmp2, 'firms/fx/data/details.enc.json'), 'utf8')), 'test-passphrase-123');
    check(det.contacts?.A?.name === 'Alice Secret' && det.countsOnly === false, 'counts only off (setting): names are fetched and stored encrypted');
  } finally { await mock2.close(); await rm(tmp2, { recursive: true, force: true }); }
}
{
  // c. drift: new stage, new pipeline, gone pipeline
  const tmp = await firmRepo({ cfg: cfgMed });
  const withNew = discovery.pipelines.map(p => p.id === 'p2' ? { ...p, stages: [...p.stages, { id: 'p2sNEW', name: 'Financing Pending' }] } : p);
  const mock = await startMock({ pipelines: withNew, opps: [...OPPS, ghlOpp('o9', 'Z', 'Marketing Pipeline', 'New Lead', { pipelineId: 'p2', pipelineStageId: 'p2sNEW' })], events: [] });
  try {
    const r = await sync(tmp, mock);
    const d = r.kpis?.sync?.drift;
    check(d?.stages === 1 && !d.pipelinesNew && !d.pipelinesGone, 'drift: a new stage in GHL → sync.drift { stages: 1 }', JSON.stringify(d));
    check(r.kpis.periods.last30.current.enquiries === 4, 'drift: the opportunity in the unmapped stage counts nowhere');
    check(/1 stage\(s\) not mapped/.test(r.out) && /Surgical Patients: Financing Pending/.test(r.out), 'drift: the sync log names the stage');
    // bell + Slack
    const st = updateStatus(null, { now: Date.now(), attempted: ['fx'], results: { fx: { slug: 'fx', ok: true, at: new Date().toISOString() } }, syncFlags: { fx: r.kpis.sync } });
    const firms = [{ slug: 'fx', name: 'Fixture Clinic' }], configs = { fx: cfgMed };
    const issue = openIssues(st, { now: Date.now(), firms, kpis: { fx: { generatedAt: r.kpis.generatedAt, sync: r.kpis.sync } }, chain: { value: 'on', waiting: true } }).find(i => i.kind === 'unmapped');
    check(issue && !inBadge(issue), 'bell: an "unmapped" notice (amber, not counted in the badge)');
    check(describeIssue(issue, { care: true }).title === '1 stage not mapped' && describeIssue(issue, { care: true }).actions[0] === 'map', 'bell title "1 stage not mapped" with a Map pipelines button');
    const bell = bellIssues({ status: st, keeper: null, firms, configs, kpis: { fx: { generatedAt: r.kpis.generatedAt, sync: r.kpis.sync } }, chain: { value: 'on', waiting: true }, now: Date.now() });
    const dm = bell.find(i => i.kind === 'unmapped') ? startText(bell.find(i => i.kind === 'unmapped'), { firms, now: Date.now(), configs }) : '';
    check(/1 stage not mapped · Fixture Clinic/.test(dm) && /#\/map\/fx\|Map pipelines/.test(dm), 'Slack: "1 stage not mapped · <firm>" with a Map pipelines link', dm);
    // mapped later → clears
    const cfgFixed = { ...cfgMed, pipelineMap: { ...pipelineMap, stages: { ...pipelineMap.stages, p2sNEW: { bucket: 'consultAttended', name: 'Financing Pending', pipelineId: 'p2' } } } };
    await writeFile(join(tmp, 'firms/fx/config.json'), jsonText({ ...JSON.parse(await readFile(join(tmp, 'firms/fx/config.json'), 'utf8')), ...cfgFixed }));
    const r2 = await sync(tmp, mock);
    check(!r2.kpis.sync?.drift && r2.kpis.periods.last30.current.enquiries === 5, 'drift clears once the stage is mapped, and that person then counts');
    // pipelines: one new in GHL, one gone from GHL
    mock.set({ pipelines: [...discovery.pipelines.filter(p => p.id !== 'p4'), { id: 'p9', name: 'Hair Restoration', stages: [{ id: 'p9s1', name: 'New' }] }] });
    const r3 = await sync(tmp, mock);
    check(r3.kpis.sync?.drift?.pipelinesNew === 1 && r3.kpis.sync?.drift?.pipelinesGone === 1, 'drift: a new pipeline and a disappeared pipeline are both flagged', JSON.stringify(r3.kpis.sync?.drift));
  } finally { await mock.close(); await rm(tmp, { recursive: true, force: true }); }
}
{
  // d. needsMapping isn't synced; draft is marked
  const tmp = await firmRepo({ cfg: cfgMed, status: 'needsMapping' });
  const mock = await startMock({ pipelines: discovery.pipelines, opps: OPPS, events: [] });
  try {
    const r = await sync(tmp, mock);
    check(!r.kpis && !mock.paths.includes('/opportunities/search'), 'a "Needs mapping" firm is not synced (no opportunities read, no kpis.json)');
    const pm = await run(process.execPath, [join(tmp, 'scripts/plan-matrix.mjs')], { env: { ...process.env, GITHUB_OUTPUT: '' } });
    check(/No firms to sync/.test(pm.stdout), 'plan-matrix leaves a "Needs mapping" firm out of the schedule');
    await writeFile(join(tmp, 'firms/index.json'), jsonText([{ slug: 'fx', secretKey: 'FX', name: 'Fixture Clinic', locationId: 'MOCKLOCATION0001', status: 'draft' }]));
    const r2 = await sync(tmp, mock);
    check(r2.kpis?.status === 'draft', 'a Draft firm syncs, and its kpis.json says "draft" (dashboard banner)');
  } finally { await mock.close(); await rm(tmp, { recursive: true, force: true }); }
}
{
  // no-show rate only when no-shows are marked in GHL
  const tmp = await firmRepo({ cfg: cfgMed });
  const mock = await startMock({ pipelines: discovery.pipelines, opps: [...OPPS, ghlOpp('o7', 'N', 'Surgical Patients', 'Consult Booked (In-person / Virtual)')], events: [{ contactId: 'N', appointmentStatus: 'noshow', startTime: ago(2) }] });
  try {
    const r = await sync(tmp, mock), c = r.kpis.periods.last30.current;
    check(r.kpis.noShowTracked === true && c.noShows === 1 && c.noShowPct === 25, 'no-show rate appears once an appointment is marked No-show (1 of 4 booked = 25%)', JSON.stringify({ t: r.kpis.noShowTracked, n: c.noShows, p: c.noShowPct, b: c.booked }));
  } finally { await mock.close(); await rm(tmp, { recursive: true, force: true }); }
}

// ---------- 4. new-firm.mjs ----------
{
  const template = JSON.parse(await readFile(join(ROOT, 'firms/_template/config.json'), 'utf8'));
  const { config, review } = buildConfig({ template, discovery, preset: null, carePreset: preset, name: 'Palm Beach Plastic and Cosmetic Surgery', practiceArea: 'Plastic & Cosmetic Surgery', locationId: discovery.locationId, timezone: 'America/New_York', practiceType: 'medical' });
  check(config.practiceType === 'medical' && config.countsOnly === true && review.reason === 'needs-mapping' && Object.keys(config.pipelineMap.stages).length === 26, 'new-firm: Medical firm → practiceType, counts only on, pre-filled map, Needs mapping');
  const law = buildConfig({ template, discovery: { pipelines: [] }, preset: null, name: 'X', practiceArea: 'Personal Injury', locationId: 'L', timezone: 'America/New_York' });
  check(!law.config.practiceType && !law.config.pipelineMap, 'new-firm: a law firm\'s config has no practice type or pipeline map (unchanged)');
}

console.log(fails ? `\n${fails} failed` : '\nAll non-law scorecard tests passed');
process.exit(fails ? 1 : 0);
