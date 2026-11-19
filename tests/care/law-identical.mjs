// Law firms' numbers must not change (v1.28.0).   Run:  node tests/care/law-identical.mjs [base-ref]   (default origin/main)
//
// For every firm in firms/index.json that is a law firm (all of them today): its REAL config.json and discovery.json
// (real pipeline + stage ids), and a rich made-up data set over those stages: several opportunities per stage, open /
// won / lost / abandoned, contacts with opportunities in two pipelines, values, created 1–120 days ago, consult
// appointments marked showed / no-show / confirmed. The sync from <base-ref> (before this change) and the sync in this
// working tree run against the same mock GHL, and their kpis.json must be identical apart from timestamps (generatedAt,
// sync.checkedAt, period from/to, which move with the clock). Exits 1 on any difference.

import { readFile, writeFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { execFile, execSync } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMock } from './mock-ghl.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = process.argv[2] || 'origin/main';
const DAY = 864e5;
const jsonText = o => JSON.stringify(o, null, 2) + '\n';
const readJSON = async p => JSON.parse(await readFile(p, 'utf8'));

// deterministic pseudo-random
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
function dataFor(discovery) {
  const now = Date.now(), opps = [], events = [];
  const at = d => new Date(now - d * DAY - 5 * 3600e3).toISOString();
  let n = 0;
  for (const p of discovery.pipelines || []) for (const s of p.stages || []) for (let k = 0; k < 4; k++) {
    n++;
    const status = ['open', 'open', 'won', 'lost', 'abandoned'][Math.floor(rnd() * 5)];
    const cid = n % 7 === 0 ? `c${n - 1}` : `c${n}`;            // every 7th contact also has the previous opportunity (2 pipelines/stages)
    const d = 1 + Math.floor(rnd() * 120);
    opps.push({ id: `o${n}`, contactId: cid, pipelineId: p.id, pipelineStageId: s.id, status, monetaryValue: Math.floor(rnd() * 5000), createdAt: at(d), updatedAt: at(d - 0.5), lastStageChangeAt: at(d - 0.5), source: ['Web form', 'Google Ads', 'Referral'][n % 3], name: `Opp ${n}` });
    if (rnd() < 0.3) events.push({ contactId: cid, appointmentStatus: ['showed', 'noshow', 'confirmed', 'cancelled'][Math.floor(rnd() * 4)], startTime: at(d - 2) });
  }
  return { opps, events };
}

async function repo(dir, fromRef, slug, cfg, disc, entry) {
  await mkdir(dir, { recursive: true });
  if (fromRef) execSync(`git -C "${ROOT}" archive ${fromRef} scripts firms/_defaults.json firms/_defaults | tar -x -C "${dir}"`);
  else { await cp(join(ROOT, 'scripts'), join(dir, 'scripts'), { recursive: true }); await cp(join(ROOT, 'firms/_defaults.json'), join(dir, 'firms/_defaults.json')); await cp(join(ROOT, 'firms/_defaults'), join(dir, 'firms/_defaults'), { recursive: true }); }
  await mkdir(join(dir, 'firms', slug), { recursive: true });
  await writeFile(join(dir, 'firms', slug, 'config.json'), jsonText(cfg));
  await writeFile(join(dir, 'firms', slug, 'discovery.json'), jsonText(disc));
  await writeFile(join(dir, 'firms/index.json'), jsonText([entry]));
}
const strip = k => {
  const x = JSON.parse(JSON.stringify(k));
  delete x.generatedAt; if (x.sync) delete x.sync.checkedAt;
  if (x.notice?.graduatedAt) x.notice.graduatedAt = 'set';   // = generatedAt on the sync that ends the testing period (a timestamp)
  for (const p of Object.values(x.periods || {})) { delete p.from; delete p.to; }
  return x;
};

const firms = (await readJSON(join(ROOT, 'firms/index.json'))).filter(f => !['medical', 'other'].includes(f.practiceType));
let fails = 0;
for (const f of firms) {
  const cfg = await readJSON(join(ROOT, 'firms', f.slug, 'config.json'));
  if (['medical', 'other'].includes(cfg.practiceType)) continue;
  const disc = await readJSON(join(ROOT, 'firms', f.slug, 'discovery.json')).catch(() => null);
  if (!disc?.pipelines?.length) { console.log(`- ${f.slug}: no discovery.json, skipped`); continue; }
  const { opps, events } = dataFor(disc);
  const tmp = await mkdtemp(join(tmpdir(), 'lpk-law-'));
  const mock = await startMock({ pipelines: disc.pipelines, opps, events });
  try {
    const out = {};
    for (const [which, ref] of [['before', BASE], ['after', null]]) {
      const dir = join(tmp, which);
      await repo(dir, ref, f.slug, { ...cfg, locationId: 'MOCKLOCATION0001' }, disc, { ...f, locationId: 'MOCKLOCATION0001' });
      const resultFile = join(dir, 'result.json');
      try { await run(process.execPath, [join(dir, 'scripts/sync.mjs'), f.slug], { env: { ...process.env, GHL_API_BASE: mock.url, GHL_TOKEN: 'mock', DASHBOARD_PASSPHRASE: '', GHL_BACKOFF_MS: '10', SYNC_RESULT_FILE: resultFile }, maxBuffer: 64e6 }); }
      catch (e) { out[`${which}Failed`] = await readJSON(resultFile).catch(() => ({ category: 'crash' })); }
      out[which] = await readJSON(join(dir, 'firms', f.slug, 'data/kpis.json')).catch(() => null);
    }
    // v1.30.0: the one intended difference. A counted pipeline name that matches nothing in GHL used to count 0 leads;
    // now the sync stops with "Pipeline not found" (the dashboard keeps its last numbers). Allowed only when the old
    // sync really counted 0 leads (so it can never hide a real change in numbers).
    if (out.afterFailed?.category === 'pipeline' && out.before && out.before.periods.last90.current.totalLeads === 0 && Object.values(out.before.periods).every(p => !p.current?.totalLeads)) {
      console.log(`✓ ${f.slug}: counted pipeline name not in GHL → before: 0 leads; after: "Pipeline not found" (last numbers kept) · intended v1.30.0 change`);
      continue;
    }
    if (out.afterFailed || out.beforeFailed) { fails++; console.log(`✗ ${f.slug}: sync failed (${JSON.stringify(out.afterFailed || out.beforeFailed)})`); continue; }
    const a = JSON.stringify(strip(out.before)), b = JSON.stringify(strip(out.after));
    const c = out.after.periods.last90.current;
    const same = a === b;
    console.log(`${same ? '✓' : '✗'} ${f.slug}: ${opps.length} opportunities, ${events.length} appointments → last 90 days ${c.totalLeads} leads, ${c.contacted} contacted, ${c.consultBooked} booked, ${c.signed} signed, ${c.turnedAway} turned away · ${same ? 'identical before/after' : 'DIFFERENT'}`);
    if (!same) {
      fails++;
      const A = strip(out.before), B = strip(out.after);
      for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) console.log(`    differs: ${k}`);
    }
  } finally { await mock.close(); await rm(tmp, { recursive: true, force: true }); }
}
console.log(fails ? `\n${fails} firm(s) changed` : `\nAll ${firms.length} law firms: identical numbers before (${BASE}) and after`);
process.exit(fails ? 1 : 0);
