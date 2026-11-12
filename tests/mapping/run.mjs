// Stage-mapping test suite.   Run:  node tests/mapping/run.mjs   (Node 20+, no dependencies)
//
// For every fixture in tests/mapping/fixtures/:
//   1. Pre-selection: the mapping panel's starting state (admin/mapping.mjs, the same code the
//      admin page runs) is compared with an expected answer written by hand. Existing firms
//      (Mahdavi, LFMP) are pre-selected from their live config and must match it exactly; new
//      firms are guessed from their stage names.
//   2. Round trip: Edit mapping → save with no changes must leave config.json byte-identical.
//   3. Funnel: scripts/sync.mjs runs (in a temp copy of the repo) against a mock GHL with one
//      lead parked in every stage; every funnel count, no-shows and turned-away reasons must match
//      what the hand-written mapping says, computed by an independent rule set (oracle below).
// Prints a table and exits 1 if anything fails. Writes nothing in the repo.

import { readFile, writeFile, mkdtemp, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialState, buildMapping, applyMapping, guessMapping } from '../../admin/mapping.mjs';
import { mergeConfig } from '../../scripts/config-merge.mjs';
import { startMockGhl, leadsFor } from './mock-ghl.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const norm = s => String(s ?? '').trim().toLowerCase();
const readJSON = async p => JSON.parse(await readFile(join(ROOT, p), 'utf8'));
const jsonText = o => JSON.stringify(o, null, 2) + '\n';
const clone = o => JSON.parse(JSON.stringify(o));
const FUNNEL = ['contacted', 'qualified', 'consultBooked', 'consultHeld', 'agreementSent', 'signed'];
const ROWS = [...FUNNEL, 'noShow', 'turnedAway'];
const LABEL = { contacted: 'Contacted', qualified: 'Qualified', consultBooked: 'Consult booked', consultHeld: 'Consult held', agreementSent: 'Agreement sent', signed: 'Signed', noShow: 'No-show', turnedAway: 'Turned away' };
const only = process.argv[2] || '';

const sameSet = (a, b) => { const x = new Set((a || []).map(norm)), y = new Set((b || []).map(norm)); return x.size === y.size && [...x].every(v => y.has(v)); };
const sameList = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
const short = list => (list || []).length ? list.map(s => s.replace(/^Stage (\d+):.*/, 'S$1')).join(', ') : '—';

// ---------- the oracle: what the funnel SHOULD say, from the hand-written mapping ----------
// One lead per stage of the included pipelines. Each lead reaches the furthest funnel step any of
// its stage's mappings proves (cumulative: signed counts as every earlier step). A no-show stage
// proves the consult was booked but not held. A turned-away stage that isn't signed counts as
// turned away, with the config's label for that stage or else the stage name.
function oracle(fixture, discovery, config) {
  const X = fixture.expected;
  const included = p => !X.pipelines.length || X.pipelines.map(norm).includes(norm(p.name));
  const labels = config.turnedAway?.reasonLabels || {};
  const out = { totalLeads: 0, contacted: 0, qualified: 0, consultBooked: 0, consultHeld: 0, agreementSent: 0, signed: 0, noShows: 0, turnedAway: 0, reasons: {} };
  for (const p of discovery.pipelines) {
    if (!included(p)) continue;
    for (const s of p.stages) {
      out.totalLeads++;
      const has = k => (X[k] || []).map(norm).some(x => x === norm(s.name) || x === norm(s.id));   // stage name or stage id
      let reach = -1;
      FUNNEL.forEach((k, i) => { if (has(k)) reach = Math.max(reach, i); });
      const noShow = has('noShow') && reach < FUNNEL.indexOf('consultHeld');
      if (noShow) reach = Math.max(reach, FUNNEL.indexOf('consultBooked'));
      FUNNEL.forEach((k, i) => { if (reach >= i) out[k]++; });
      if (noShow) out.noShows++;
      if (has('turnedAway') && reach < FUNNEL.indexOf('signed')) {
        out.turnedAway++;
        const label = labels[Object.keys(labels).find(k => norm(k) === norm(s.name) || norm(k) === norm(s.id))] || s.name;
        out.reasons[label] = (out.reasons[label] || 0) + 1;
      }
    }
  }
  return out;
}

// ---------- one fixture ----------
async function check(name) {
  const fx = await readJSON(`tests/mapping/fixtures/${name}.json`);
  const discovery = clone(fx.discoveryFrom ? await readJSON(fx.discoveryFrom) : fx.discovery);
  // fx.renames { stageId: newName }: a stage renamed in GHL since the snapshot (the mock serves the new name).
  for (const p of discovery.pipelines || []) for (const st of p.stages || []) if (fx.renames?.[st.id]) st.name = fx.renames[st.id];
  const template = await readJSON('firms/_template/config.json');
  const res = { name, kind: fx.kind, steps: {}, notes: [], nameOf: Object.fromEntries((discovery.pipelines || []).flatMap(p => (p.stages || []).map(st => [st.id, st.name]))) };

  // 1. pre-selection
  const firmCfg = fx.kind === 'existing' ? await readJSON(fx.configFrom) : template;
  const state = initialState({ discovery, config: firmCfg, isNew: fx.kind === 'new' });
  const m = buildMapping(state, discovery);
  const got = { ...m.stages, turnedAway: m.turnedAway };
  const exact = fx.kind === 'existing';                       // existing firms: same names, same order as config
  for (const k of ROWS) res.steps[k] = { expected: fx.expected[k] || [], got: got[k] || [], pass: exact ? sameList(got[k], fx.expected[k]) : sameSet(got[k], fx.expected[k]) };
  res.pipelines = { expected: fx.expected.pipelines, got: m.pipelines, pass: exact ? sameList(m.pipelines, fx.expected.pipelines) : sameSet(m.pipelines, fx.expected.pipelines) };
  if (fx.kind === 'existing') {
    // also: the stored mapping itself must be exactly what the config says
    const c = firmCfg;
    const live = { ...c.stages, turnedAway: c.turnedAway?.stages || [] };
    for (const k of ROWS) if (!sameList(live[k] || [], fx.expected[k] || [])) res.notes.push(`expected ${k} differs from live config.json — update the fixture`);
  }
  if (fx.alsoGuess) {
    const g = buildMapping(initialState({ discovery, config: template, isNew: true }), discovery);
    const gg = { ...g.stages, turnedAway: g.turnedAway };
    const bad = ROWS.filter(k => !sameSet(gg[k], fx.expected[k]));
    res.guess = { pass: !bad.length && sameSet(g.pipelines, fx.expected.pipelines), bad };
  }
  if (name === 'different-wording') res.extra = { label: '"Attempted Contact" not Contacted', pass: !got.contacted.map(norm).includes('attempted contact') && !guessMapping(['Attempted Contact']).contacted.length };
  if (name === 'no-match') res.extra = { label: 'nothing pre-selected', pass: ROWS.every(k => !(got[k] || []).length) };

  // the config the admin page would hold after this mapping
  const config = fx.kind === 'existing' ? clone(firmCfg)
    : Object.assign(applyMapping(clone(template), m), { locationName: `Fixture ${name}`, practiceArea: 'Personal Injury', locationId: 'MOCKLOCATION0001', title: '', timezone: 'America/New_York' });

  // 2. round trip: Edit mapping, save unchanged
  const before = jsonText(config);
  const st2 = initialState({ discovery, config: JSON.parse(before), isNew: false });
  const after = jsonText(applyMapping(JSON.parse(before), buildMapping(st2, discovery)));
  res.roundTrip = { pass: before === after };
  if (!res.roundTrip.pass) {
    const a = before.split('\n'), b = after.split('\n'); const i = a.findIndex((l, j) => l !== b[j]);
    res.roundTrip.diff = `line ${i + 1}: "${(a[i] || '').trim()}" → "${(b[i] || '').trim()}"`;
  }

  // 3. funnel: real sync against the mock, in a temp copy of the repo
  const tmp = await mkdtemp(join(tmpdir(), 'lpk-map-'));
  try {
    await cp(join(ROOT, 'scripts'), join(tmp, 'scripts'), { recursive: true });
    await mkdir(join(tmp, 'firms', 'fx'), { recursive: true });
    await cp(join(ROOT, 'firms/_defaults.json'), join(tmp, 'firms/_defaults.json'));
    await cp(join(ROOT, 'firms/_defaults'), join(tmp, 'firms/_defaults'), { recursive: true });
    await writeFile(join(tmp, 'firms/fx/config.json'), jsonText({ ...config, locationId: config.locationId || 'MOCKLOCATION0001' }));
    const mock = await startMockGhl(discovery);
    try { await run(process.execPath, [join(tmp, 'scripts/sync.mjs'), 'fx'], { env: { ...process.env, GHL_API_BASE: mock.url, GHL_TOKEN: 'mock', DASHBOARD_PASSPHRASE: '' } }); }
    finally { await mock.close(); }
    const pubOut = JSON.parse(await readFile(join(tmp, 'firms/fx/data/kpis.json'), 'utf8'));
    const k = pubOut.periods.last30.current;
    // fx.expectFunnel: funnel rows shown (hidden steps left out), the sent-rate base, rates switched off, stage names published
    if (fx.expectFunnel) {
      const E = fx.expectFunnel, probs = [];
      const rows = (k.funnel || []).map(r => [r[0], r[3]]);
      if (JSON.stringify(rows) !== JSON.stringify(E.rows)) probs.push(`funnel rows ${JSON.stringify(rows)}`);
      const base = E.sentRateBase === 'qualified' ? k.qualified : k.consultHeld;
      const wantSent = base > 0 ? Math.round((k.agreementSent / base) * 1000) / 10 : null;
      if (k.sentRatePct !== wantSent) probs.push(`sentRatePct ${k.sentRatePct} ≠ ${wantSent}`);
      for (const [ck, cv] of Object.entries(E.counts || {})) if (k[ck] !== cv) probs.push(`${ck} ${k[ck]} ≠ ${cv}`);
      for (const r of E.nullRates || []) if (k[r] !== null) probs.push(`${r} should be null, got ${k[r]}`);
      for (const [sid, nm] of Object.entries(E.stageNames || {})) if (pubOut.stageNames?.[sid] !== nm) probs.push(`stageNames[${sid.slice(0, 8)}] = ${pubOut.stageNames?.[sid]}`);
      res.extra = { label: 'hidden steps, sent-rate base, stage names', pass: !probs.length, probs };
    }
    const want = oracle(fx, discovery, mergeConfig(await readJSON('firms/_defaults.json'), null, config));
    const gotF = { totalLeads: k.totalLeads, contacted: k.contacted, qualified: k.qualified, consultBooked: k.consultBooked, consultHeld: k.consultHeld, agreementSent: k.agreementSent, signed: k.signed, noShows: k.noShows, turnedAway: k.turnedAway, reasons: Object.fromEntries(k.turnedAwayReasons || []) };
    const keys = Object.keys(want).filter(x => x !== 'reasons');
    const bad = keys.filter(x => want[x] !== gotF[x]);
    const reasonsOk = JSON.stringify(Object.entries(want.reasons).sort()) === JSON.stringify(Object.entries(gotF.reasons).sort());
    res.funnel = { pass: !bad.length && reasonsOk, want, got: gotF, bad: [...bad, ...(reasonsOk ? [] : ['reasons'])], leads: leadsFor(discovery).length };
  } catch (e) { res.funnel = { pass: false, error: e.stderr?.toString().split('\n').find(l => /Error/.test(l)) || e.message }; }
  finally { await rm(tmp, { recursive: true, force: true }); }

  res.pass = Object.values(res.steps).every(s => s.pass) && res.pipelines.pass && res.roundTrip.pass && res.funnel.pass && (res.guess?.pass ?? true) && (res.extra?.pass ?? true) && !res.notes.length;
  return res;
}

// ---------- report ----------
const names = (await readdir(join(ROOT, 'tests/mapping/fixtures'))).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')).filter(n => !only || n === only).sort();
const results = [];
for (const n of names) results.push(await check(n));
const mark = ok => (ok ? 'PASS' : 'FAIL');
const pad = (s, n) => String(s).padEnd(n);
console.log('\nPre-selected mapping vs expected (existing firms: exact; new firms: same stages in any order)\n');
console.log(`${pad('Fixture', 18)}${pad('Step', 16)}${pad('Expected', 46)}${pad('Pre-selected', 46)}Result`);
console.log('-'.repeat(132));
for (const r of results) {
  console.log(`${pad(r.name, 18)}${pad('Pipelines', 16)}${pad(short(r.pipelines.expected).slice(0, 44), 46)}${pad(short(r.pipelines.got).slice(0, 44), 46)}${mark(r.pipelines.pass)}`);
  const nm = l => (l || []).map(x => r.nameOf[x] || x);   // ids shown by stage name
  for (const k of ROWS) { const s = r.steps[k]; console.log(`${pad('', 18)}${pad(LABEL[k], 16)}${pad(short(nm(s.expected)).slice(0, 44), 46)}${pad(short(nm(s.got)).slice(0, 44), 46)}${mark(s.pass)}`); }
  console.log('-'.repeat(132));
}
console.log('\nPer fixture\n');
console.log(`${pad('Fixture', 18)}${pad('Kind', 10)}${pad('Pre-select', 12)}${pad('Round trip', 12)}${pad('Funnel', 10)}Other`);
for (const r of results) {
  const pre = Object.values(r.steps).every(s => s.pass) && r.pipelines.pass;
  const other = [r.guess ? `new-firm guess ${mark(r.guess.pass)}${r.guess.bad.length ? ` (${r.guess.bad.join(', ')})` : ''}` : '', r.extra ? `${r.extra.label} ${mark(r.extra.pass)}` : '', ...r.notes].filter(Boolean).join('; ');
  console.log(`${pad(r.name, 18)}${pad(r.kind, 10)}${pad(mark(pre), 12)}${pad(mark(r.roundTrip.pass), 12)}${pad(mark(r.funnel.pass), 10)}${other}`);
  if (!r.roundTrip.pass) console.log(`${pad('', 18)}round trip changed ${r.roundTrip.diff}`);
  if (r.extra?.probs?.length) console.log(`${pad('', 18)}${r.extra.probs.join('; ')}`);
  if (!r.funnel.pass) console.log(`${pad('', 18)}funnel ${r.funnel.error || `mismatch on ${r.funnel.bad.join(', ')}: expected ${JSON.stringify(r.funnel.want)} got ${JSON.stringify(r.funnel.got)}`}`);
}
console.log('\nFunnel counts from the sync (one lead per stage)\n');
console.log(`${pad('Fixture', 18)}${['Leads', 'Contacted', 'Qualified', 'Booked', 'Held', 'Agreement', 'Signed', 'No-show', 'Turned away'].map(h => pad(h, 11)).join('')}Reasons`);
for (const r of results) if (r.funnel.got) {
  const g = r.funnel.got, w = r.funnel.want;
  const cell = k => pad(g[k] === w[k] ? g[k] : `${g[k]}≠${w[k]}`, 11);
  console.log(`${pad(r.name, 18)}${['totalLeads', 'contacted', 'qualified', 'consultBooked', 'consultHeld', 'agreementSent', 'signed', 'noShows', 'turnedAway'].map(cell).join('')}${Object.entries(g.reasons).map(([k, v]) => `${k} ${v}`).join('; ') || '—'}`);
}
const failed = results.filter(r => !r.pass);
console.log(`\n${results.length - failed.length} of ${results.length} fixtures pass${failed.length ? `; failing: ${failed.map(r => r.name).join(', ')}` : ''}.`);
process.exit(failed.length ? 1 : 0);
