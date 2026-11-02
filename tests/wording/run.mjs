// "New leads" wording tests.   Run:  node tests/wording/run.mjs   (Node 20+, no dependencies)
//
// 1. scripts/wording.mjs: the line under New leads and its hover text for one, two, three or more,
//    and no mapped pipelines; GHL list numbers ("01. ") dropped; no "Pipeline pipeline".
// 2. Every firm's real config gives sensible wording.
// 3. app/dashboard.html uses the same wording in the New leads hover, the "Where leads drop off"
//    New leads row, the "Lead → signed client" hover and "How this works", and opens hovers on tap.
// Writes nothing.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipelineWording } from '../../scripts/wording.mjs';
import { mergeConfig } from '../../scripts/config-merge.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readJSON = async p => JSON.parse(await readFile(p, 'utf8'));
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}:\n        expected ${JSON.stringify(b)}\n        got      ${JSON.stringify(a)}`); };
const ok = (v, what) => { if (!v) throw new Error(what); };

test('One pipeline: "From your Lead Stages pipeline" and the hover text, word for word', () => {
  const w = pipelineWording(['Lead Stages']);
  eq(w.sub, 'From your Lead Stages pipeline', 'sub');
  eq(w.hover, "Leads added to your Lead Stages pipeline during the selected dates. Someone who called, texted or filled in a form but was never added to this pipeline isn't counted here.", 'hover');
  eq(w.leadToSigned, "Of the leads added to your Lead Stages pipeline during the selected dates, the share that signed. Someone who called, texted or filled in a form but was never added to this pipeline isn't counted here.", 'lead → signed');
});

test('A name that already ends in "pipeline", or starts with a GHL list number, reads naturally', () => {
  eq(pipelineWording(['01. Sales Pipeline']).sub, 'From your Sales Pipeline', 'numbered + ends in Pipeline');
  eq(pipelineWording(['Intake pipeline']).sub, 'From your Intake pipeline', 'ends in pipeline');
  eq(pipelineWording(['2) PI Leads']).sub, 'From your PI Leads pipeline', 'other numbering');
  eq(pipelineWording(['Lead Stages', 'lead stages ', 'Lead Stages']).sub, 'From your Lead Stages pipeline', 'duplicates count once');
});

test('Two pipelines: "From your X and Y pipelines"; hover says "these pipelines"', () => {
  const w = pipelineWording(['PI Intake', '02. Workers Comp Pipeline']);
  eq(w.sub, 'From your PI Intake and Workers Comp pipelines', 'sub');
  eq(w.hover, "Leads added to your PI Intake and Workers Comp pipelines during the selected dates. Someone who called, texted or filled in a form but was never added to these pipelines isn't counted here.", 'hover');
});

test('Three or more: "From N pipelines"; the hover still names them', () => {
  const w = pipelineWording(['PI', 'Family Law', 'Criminal Defense', 'Immigration']);
  eq(w.sub, 'From 4 pipelines', 'sub');
  ok(w.hover.startsWith('Leads added to your PI, Family Law, Criminal Defense and Immigration pipelines during the selected dates.'), `hover: ${w.hover}`);
});

test('No mapped pipelines (config counts every pipeline)', () => {
  for (const p of [[], null, undefined, ['  ']]) {
    const w = pipelineWording(p);
    eq(w.sub, 'From all your pipelines', `sub for ${JSON.stringify(p)}`);
    eq(w.hover, "Leads added to any of your pipelines during the selected dates. Someone who called, texted or filled in a form but was never added to a pipeline isn't counted here.", 'hover');
  }
});

test('Every firm: wording from its real config', async () => {
  const d = await readJSON(join(ROOT, 'firms/_defaults.json'));
  const expect = { mahdavi: 'From your Lead Stages pipeline', lfmp: 'From your Sales Pipeline' };
  for (const f of await readJSON(join(ROOT, 'firms/index.json'))) {
    const cfg = mergeConfig(d, null, await readJSON(join(ROOT, `firms/${f.slug}/config.json`)));
    const w = pipelineWording(cfg.pipelines);
    if (expect[f.slug]) eq(w.sub, expect[f.slug], f.slug);
    ok(!/pipeline pipeline/i.test(w.sub + w.hover), `${f.slug}: doubled word`);
    ok(/^From /.test(w.sub) && w.hover.includes("isn't counted here."), `${f.slug}: shape`);
  }
});

test('Dashboard: same wording in all four places, and hovers open on tap', async () => {
  const html = await readFile(join(ROOT, 'app/dashboard.html'), 'utf8');
  ok(html.includes('<span class="leadsub" data-tip="${esc(W().hover)}">${esc(W().sub)}</span>'), 'line under New leads with hover');
  ok(html.includes('get totalLeads() { return W().hover; }'), 'New leads label hover');
  ok(html.includes("const def = i === 0 ? W().hover : '';") && html.includes('class="ftip" data-tip="${esc(def)}"'), 'funnel New leads row hover (row and label)');
  ok(html.includes('get leadToSigned() { return W().leadToSigned; }'), 'Lead → signed client hover');
  ok(html.includes('<li><b>New leads</b> are leads added to ${esc(W().your)} during the selected dates. ${esc(W().notCounted)}'), 'How this works');
  ok(html.includes('get def() { return W().hover; }'), 'New leads list description');
  ok(!/Every opportunity created in the selected dates|Opportunities created in the selected dates\. Every other/.test(html), 'old wording gone');
  ok(html.includes("document.addEventListener('pointerdown'") && /if \(pointer === 'mouse'\) return;[\s\S]{0,200}closest\('\[data-tip\]'\)/.test(html), 'tap opens hovers');
});

const results = [];
for (const t of tests) {
  try { await t.fn(); results.push({ name: t.name, pass: true }); }
  catch (e) { results.push({ name: t.name, pass: false, error: e.message }); }
}
console.log('\nNew leads wording tests\n');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.error ? `\n      ${r.error}` : ''}`);
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed} of ${results.length} tests pass.`);
process.exit(failed ? 1 : 0);
