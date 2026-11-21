// v1.35.0 (queue item 2, part 3): "How we fill this in for you".   Run: node tests/map-how/run.mjs   (no dependencies)
//   - every "Stage names like…" example in the explainer is guessed as that bucket / step by the REAL rules
//     (scripts/care-core.mjs guessBucket, admin/mapping.mjs guessMapping); Ignore examples are never guessed
//   - guessMatch = guessBucket + the matched text (the "Guessed: “deposit”" tag), for every stage name in the fixtures
//   - a guessed stage keeps nothing extra in what Map pipelines SAVES (buildPipelineMap output unchanged)
//   - open the first time on a device, then remembered; storage blocked → closed
//   - the law "Showing:" line: saved (existing firm) · preset (LFMP template names) · guessed (other names)
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARE_ROWS, LAW_ROWS, CARE_ORDER, howOpen, rememberHow, careTag, showingHtml, careHowHtml, lawHowHtml, HOW_KEY } from '../../admin/map-how.mjs';
import { guessBucket, guessMatch, careInitialState, buildPipelineMap } from '../../scripts/care-core.mjs';
import { guessMapping, initialState, mappingSource } from '../../admin/mapping.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let pass = 0, fail = 0;
const check = (ok, what, extra = '') => { if (ok) { pass++; console.log(`✓ ${what}`); } else { fail++; console.log(`✗ ${what}${extra ? `\n    ${extra}` : ''}`); } };

for (const [k, l, like] of CARE_ROWS) for (const n of like) {
  const g = guessBucket(n);
  check(k === 'ignore' ? g === null : g === k, `care: "${n}" → ${l}`, `got ${g}`);
}
for (const [k, l, like] of LAW_ROWS) for (const n of like) check(guessMapping([n])[k].length === 1, `law: "${n}" → ${l}`, JSON.stringify(guessMapping([n])));
check(guessBucket('Consult Completed – Not Interested') === 'lost' && guessBucket('Surgery Scheduled') === 'yes', 'the order line\'s two examples (Lost first; Surgery Scheduled = Yes)');
check(JSON.stringify(CARE_ORDER) === JSON.stringify(['Lost', 'Consult attended', 'Yes', 'Done', 'Consult booked', 'Contacted', 'New enquiry']), 'the order line = the order of GUESS in care-core.mjs');
const src = await readFile(join(ROOT, 'scripts/care-core.mjs'), 'utf8');
const order = [...src.slice(src.indexOf('const GUESS = ['), src.indexOf('];', src.indexOf('const GUESS = ['))).matchAll(/\['(\w+)'/g)].map(m => m[1]);
check(JSON.stringify(order) === JSON.stringify(['lost', 'consultAttended', 'yes', 'done', 'consultBooked', 'contacted', 'newEnquiry']), 'GUESS order in the code is the one the explainer describes', order.join(','));

// guessMatch = guessBucket + the text; across every stage name in the fixtures + the care presets
const names = new Set();
for (const f of await readdir(join(ROOT, 'tests/mapping/fixtures'))) for (const p of JSON.parse(await readFile(join(ROOT, 'tests/mapping/fixtures', f), 'utf8')).discovery?.pipelines || []) for (const s of p.stages) names.add(s.name);
for (const f of await readdir(join(ROOT, 'firms/_presets/care')).catch(() => [])) { const j = JSON.parse(await readFile(join(ROOT, 'firms/_presets/care', f), 'utf8')); for (const st of Object.values(j.pipelines || {})) for (const n of Object.keys(st)) names.add(n); }
let same = 0; for (const n of names) { const m = guessMatch(n); if ((m?.bucket ?? null) === guessBucket(n) && (!m || n.includes(m.word))) same++; }
check(same === names.size && names.size > 20, `guessMatch = guessBucket (+ the matched text) for ${names.size} stage names`);
check(JSON.stringify(guessMatch('Deposit Paid')) === JSON.stringify({ bucket: 'yes', word: 'Deposit' }), '"Deposit Paid" → Yes, Guessed: “Deposit”');

// tags + saved output unchanged
const disc = { pipelines: [{ id: 'p1', name: 'Patients', stages: [{ id: 's1', name: 'Deposit Paid' }, { id: 's2', name: 'Post-Op Care' }, { id: 's3', name: 'New Lead' }] }] };
const st = careInitialState({ discovery: disc, config: {}, preset: null });
check(careTag(st.pipelines[0].stages[0]) === 'Guessed: “Deposit”' && careTag(st.pipelines[0].stages[2]) === 'Guessed: “New”', 'tags show the matched word', st.pipelines[0].stages.map(careTag).join(' | '));
check(careTag({ source: 'preset' }) === 'Pre-filled' && careTag(st.pipelines[0].stages[1]) === '', 'preset = "Pre-filled"; nothing guessed = no tag (Choose shows)');
check(JSON.stringify(buildPipelineMap(st)) === JSON.stringify({ pipelines: [{ id: 'p1', name: 'Patients', use: true }], stages: { s1: { bucket: 'yes', name: 'Deposit Paid', pipelineId: 'p1' }, s3: { bucket: 'newEnquiry', name: 'New Lead', pipelineId: 'p1' } } }), 'what Map pipelines saves is unchanged (no matched word saved)');

// open / closed remembered per device
const mem = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
const s1 = mem();
check(howOpen(s1) === true, 'first time on a device: open');
rememberHow(false, s1); check(howOpen(s1) === false && s1.m.get(HOW_KEY) === 'closed', 'closed → remembered closed');
rememberHow(true, s1); check(howOpen(s1) === true, 'opened again → remembered open');
const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
check(howOpen(blocked) === false, 'storage blocked → closed (and no error)'); rememberHow(true, blocked);
check(/<details class="mh" data-mh open>/.test(careHowHtml({ open: true })) && /<details class="mh" data-mh>/.test(lawHowHtml({ open: false })), 'the open state is drawn as details[open]');
check(!/<script|on\w+=/i.test(careHowHtml() + lawHowHtml()), 'no script or handlers in the explainer');

// law "Showing:" line
const fx = async f => JSON.parse(await readFile(join(ROOT, 'tests/mapping/fixtures', f), 'utf8'));
for (const [f, want] of [['acme-template.json', 'preset'], ['different-wording.json', 'guessed'], ['no-match.json', 'guessed'], ['mahdavi.json', 'saved'], ['lfmp.json', 'saved']]) {
  const x = await fx(f), isNew = x.kind === 'new', config = isNew ? null : JSON.parse(await readFile(join(ROOT, `firms/${f.replace('.json', '')}/config.json`), 'utf8').catch(() => '{}'));
  const { chosenPipes } = initialState({ discovery: x.discovery, config, isNew });
  const got = mappingSource({ discovery: x.discovery, isNew, chosenPipes });
  check(got === want, `Showing: ${f} → ${want}`, got);
}
check(/Showing: <b>your saved mapping<\/b>/.test(showingHtml('saved')) && /Pre-filled from the LFMP template preset/.test(showingHtml('preset')) && /Guessed from the stage names: check every step/.test(showingHtml('guessed')), 'Showing: wording for the three cases');

// Q2.1: "last saved <date>" on the law Showing line once a save has written config.mappingSavedAt (display only)
{ const { showingHtml: sh } = await import('../../admin/map-how.mjs');
  check(/Showing: <b>your saved mapping<\/b> · last saved Nov 21, 2026/.test(sh('saved', '2026-11-21T15:00:00Z')), 'Showing: saved + "last saved Nov 21, 2026"');
  check(!/last saved/.test(sh('saved', null)) && !/last saved/.test(sh('saved', 'nonsense')) && !/last saved/.test(sh('preset', '2026-11-21T15:00:00Z')), 'no date known (older saves) or not a saved mapping: no "last saved"');
  const html = await readFile(join(ROOT, 'admin/index.html'), 'utf8');
  check((html.match(/mappingSavedAt = new Date\(\)\.toISOString\(\)/g) || []).length === 3 && (html.match(/if \(jsonText\(next\) !== before\) next\.mappingSavedAt/g) || []).length === 2, 'every mapping save that changes it (law, Map pipelines, New firm) writes mappingSavedAt; an unchanged save stays byte-identical');
}
console.log(`\n${pass} of ${pass + fail} map-how tests pass.`);
process.exitCode = fail ? 1 : 0;
