// "New contacts not in pipeline" tests.   Run:  node tests/pipeline/run.mjs   (Node 20+, no dependencies)
//
// 1. scripts/not-in-pipeline.mjs: who counts (no opportunity anywhere, typed lead, inbound signal,
//    not a bulk add) and the admin bell notices.
// 2. scripts/kpi-core.mjs: the list and count follow the selected dates; older details files give null.
// 3. The real scripts/sync.mjs (temp copy of the repo) against a mock GHL with contacts: counts land
//    in kpis.json, the list only in the encrypted details file, and no name, phone or email reaches
//    kpis.json or the run log. A failing contact search leaves the count unknown, not 0.
// 4. Settings: showNotInPipeline is false in firms/_defaults.json and no firm turns it on.
// Writes nothing in the repo.

import { readFile, mkdtemp, mkdir, cp, rm, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockGhl } from '../mapping/mock-ghl.mjs';
import { pickNotInPipeline, pipelineNotices, DEFAULT_RULES } from '../../scripts/not-in-pipeline.mjs';
import { buildLists, summarize, decryptJSON } from '../../scripts/kpi-core.mjs';
import { mergeConfig } from '../../scripts/config-merge.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readJSON = async p => JSON.parse(await readFile(p, 'utf8'));
const DAY = 864e5, MIN = 60e3, NOW = Date.now();
const TOKEN = 'pit-test-token', PASS = 'test passphrase #1';
const iso = ms => new Date(ms).toISOString();

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, what) => { if (!v) throw new Error(what); };

const contact = (id, ageMs, extra = {}) => ({ id, firstName: 'Person', lastName: id, email: `${id}@example.test`, phone: `+1555000${id.replace(/\D/g, '').padStart(4, '0')}`, type: 'lead', dateAdded: iso(NOW - ageMs), ...extra });
const medium = m => ({ attributionSource: { medium: m, sessionSource: 'Organic Search' } });

// ---------- 1. selection rule ----------
test('Counts only lead-type contacts with no opportunity that came in by form, chat, booking, call, text or email', () => {
  const list = [
    contact('chat', 2 * DAY, medium('chat_widget')),
    contact('form', 3 * DAY, medium('form')),
    contact('cal', 4 * DAY, medium('calendar')),
    contact('called', 5 * DAY, medium('manual')),             // typed in by staff, then called in
    contact('typed', 6 * DAY, medium('manual')),              // typed in, never got in touch: no signal
    contact('other', 7 * DAY, medium('other')),               // "Other" (imports, API): no signal
    contact('none', 8 * DAY),                                 // no attribution at all
    contact('client', 9 * DAY, { ...medium('form'), type: 'customer' }),
    contact('offb', 10 * DAY, { ...medium('form'), type: 'offboarded' }),
    contact('blanktype', 11 * DAY, { ...medium('Chat Widget'), type: '' }),
    contact('hasopp', 12 * DAY, medium('chat_widget')),
  ];
  const { items, skipped } = pickNotInPipeline(list, { withOpp: new Set(['hasopp']), inbound: new Map([['called', new Set(['Call'])], ['other', new Set()]]) });
  eq(items.map(i => i.contactId), ['chat', 'form', 'cal', 'called', 'blanktype'], 'counted, newest first');
  eq(items.map(i => i.via), ['Chat widget', 'Form', 'Calendar booking', 'Called in', 'Chat widget'], 'came in by');
  eq(skipped, { hasOpportunity: 1, notLeadType: 2, bulk: 0, noInboundSignal: 3 }, 'skipped counts');
  eq(Object.keys(items[0]).sort(), ['contactId', 'createdAt', 'email', 'name', 'phone', 'via'], 'fields kept');
});

test('Bulk adds are skipped: 5+ contacts with no opportunity within 10 minutes, even with a form medium', () => {
  const batch = Array.from({ length: 6 }, (_, i) => contact(`b${i}`, 3 * DAY + i * MIN, medium('form')));
  const four = Array.from({ length: 4 }, (_, i) => contact(`f${i}`, 9 * DAY + i * MIN, medium('form')));      // 4 in 10 min: not bulk
  const spread = Array.from({ length: 6 }, (_, i) => contact(`s${i}`, 20 * DAY + i * 11 * MIN, medium('form')));  // 11 min apart: not bulk
  const { items, skipped } = pickNotInPipeline([...batch, ...four, ...spread, contact('chat', DAY, medium('chat_widget'))]);
  eq(skipped.bulk, 6, 'bulk skipped');
  eq(items.length, 11, 'the 4, the 6 spread out and the chat contact count');
  // A batch where some contacts already have an opportunity: only those without one form the batch.
  const mixed = Array.from({ length: 6 }, (_, i) => contact(`m${i}`, 2 * DAY + i * MIN, medium('form')));
  const r = pickNotInPipeline(mixed, { withOpp: new Set(['m0', 'm1']) });
  eq([r.skipped.bulk, r.items.length], [0, 4], '4 left without an opportunity is under the bulk threshold');
  eq(pickNotInPipeline(mixed, { rules: { bulk: { count: 3 } } }).skipped.bulk, 6, 'bulk.count is configurable');
});

test('Rules come from config (inboundMediums), and defaults match firms/_defaults.json', async () => {
  const d = await readJSON(join(ROOT, 'firms/_defaults.json'));
  eq(d.notInPipeline, DEFAULT_RULES, '_defaults.json notInPipeline = DEFAULT_RULES');
  const r = pickNotInPipeline([contact('x', DAY, medium('manual'))], { rules: { inboundMediums: ['manual'] } });
  eq(r.items.length, 1, 'a firm can add a medium');
});

test('Admin bell notices: firms with 1+ in the last 30 days, biggest first; 0 and unknown are left out', () => {
  const firms = [{ slug: 'a', name: 'A firm' }, { slug: 'b', name: 'B firm' }, { slug: 'c', name: 'C firm' }, { slug: 'd', name: 'D firm' }];
  const kpis = { a: { notInPipeline30: 2 }, b: { notInPipeline30: 0 }, c: { notInPipeline30: 5 }, d: { notInPipeline30: null } };
  eq(pipelineNotices(firms, kpis), [{ slug: 'c', name: 'C firm', count: 5 }, { slug: 'a', name: 'A firm', count: 2 }], 'notices');
  eq(pipelineNotices(firms, {}), [], 'no data, no notices');
});

test('Admin page: count on the firm list, amber notice with what to do, not in the badge', async () => {
  const html = await readFile(join(ROOT, 'admin/index.html'), 'utf8');
  ok(html.includes("notInPipeline30: k.periods?.last30?.current?.notInPipeline ?? null"), 'reads the 30-day count from kpis.json');
  ok(/not in pipeline<\/span> last 30 days/.test(html) && html.includes('0 new contacts outside the pipeline (30 days)'), 'firm row shows the count, 0 included');
  ok(html.includes('<b>New contacts not in pipeline</b>') && html.includes('warnbox nnotice') && html.includes("What to do: check the firm's lead intake"), 'amber notice with what to do');
  ok(!/paintBell[\s\S]{0,400}pipelineNotices/.test(html), 'the badge and tab title don\'t count it');
});

// ---------- 2. kpi-core ----------
test('Dashboard list and count follow the selected dates; an older details file gives null (line hidden)', () => {
  const records = { generatedAt: iso(NOW), leads: [], calls: [], appointments: [], notInPipeline: [
    { contactId: 'x1', createdAt: iso(NOW - 2 * DAY) }, { contactId: 'x2', createdAt: iso(NOW - 20 * DAY) }, { contactId: 'x3', createdAt: iso(NOW - 50 * DAY) }] };
  const L7 = buildLists(records, {}, NOW - 7 * DAY, NOW), L30 = buildLists(records, {}, NOW - 30 * DAY, NOW);
  eq([L7.notInPipeline.map(c => c.contactId), summarize(L7).notInPipeline], [['x1'], 1], 'last 7');
  eq(summarize(L30).notInPipeline, 2, 'last 30');
  eq(summarize(buildLists({ ...records, notInPipeline: undefined }, {}, NOW - 30 * DAY, NOW)).notInPipeline, null, 'not checked');
  eq(summarize(buildLists({ ...records, notInPipeline: null }, {}, NOW - 30 * DAY, NOW)).notInPipeline, null, 'search failed');
});

// ---------- 3. the real sync ----------
const discovery = await readJSON(join(ROOT, 'firms/mahdavi/discovery.json'));
async function makeRepo() {
  const tmp = await mkdtemp(join(tmpdir(), 'lpk-nip-'));
  await cp(join(ROOT, 'scripts'), join(tmp, 'scripts'), { recursive: true });
  await mkdir(join(tmp, 'firms', 'fx'), { recursive: true });
  await cp(join(ROOT, 'firms/_defaults.json'), join(tmp, 'firms/_defaults.json'));
  await cp(join(ROOT, 'firms/_defaults'), join(tmp, 'firms/_defaults'), { recursive: true });
  await cp(join(ROOT, 'firms/mahdavi/config.json'), join(tmp, 'firms/fx/config.json'));
  return tmp;
}
async function sync(tmp, { contacts = [], intercept = () => null, exportHandler } = {}) {
  const mock = await startMockGhl(discovery, 0, { contacts, intercept, exportHandler });
  let out = '', code = 0;
  try {
    const r = await run(process.execPath, [join(tmp, 'scripts/sync.mjs'), 'fx'], { env: { PATH: process.env.PATH, GHL_API_BASE: mock.url, GHL_TOKEN: TOKEN, DASHBOARD_PASSPHRASE: PASS, GHL_BACKOFF_MS: '5' } });
    out = r.stdout + r.stderr;
  } catch (e) { code = e.code || 1; out = (e.stdout || '') + (e.stderr || e.message); }
  finally { await mock.close(); }
  const kpisText = await readFile(join(tmp, 'firms/fx/data/kpis.json'), 'utf8');
  const details = await decryptJSON(await readJSON(join(tmp, 'firms/fx/data/details.enc.json')), PASS);
  return { code, out, kpisText, kpis: JSON.parse(kpisText), details };
}
// The mock puts one opportunity per stage on contacts c1, c2, …
const world = () => [
  contact('n1', 1 * DAY, medium('chat_widget')),
  contact('c1', 2 * DAY, medium('chat_widget')),                    // has an opportunity
  contact('n2', 3 * DAY, medium('form')),
  contact('n3', 4 * DAY, medium('manual')),                         // called in (see the export below)
  contact('n4', 5 * DAY, medium('manual')),                         // no signal
  ...Array.from({ length: 5 }, (_, i) => contact(`b${i}`, 6 * DAY + i * MIN, medium('form'))),   // bulk add
  contact('n5', 7 * DAY, { ...medium('form'), type: 'customer' }),
  contact('n6', 40 * DAY, medium('chat_widget')),                   // in the last 90 days, not the last 30
  contact('old', 500 * DAY, medium('chat_widget')),                 // older than the 400-day window
];
const callFrom = id => q => (q.channel === 'Call' ? { body: { messages: [{ id: `m-${id}`, contactId: id, direction: 'inbound', status: 'completed', meta: { call: { status: 'completed', duration: 90 } }, dateAdded: iso(NOW - 4 * DAY + 3600e3) }] } } : { body: { messages: [] } });

test('Sync: counts in kpis.json, list only in the encrypted details, nothing personal in kpis.json or the log', async () => {
  const tmp = await makeRepo();
  try {
    const contacts = world();
    const r = await sync(tmp, { contacts, exportHandler: callFrom('n3') });
    eq(r.code, 0, `exit code (log: ${r.out.slice(-400)})`);
    eq([r.kpis.periods.last7.current.notInPipeline, r.kpis.periods.last30.current.notInPipeline, r.kpis.periods.last90.current.notInPipeline], [3, 3, 4], 'last 7 / 30 / 90');
    eq(r.details.notInPipeline.map(c => [c.contactId, c.via]), [['n1', 'Chat widget'], ['n2', 'Form'], ['n3', 'Called in'], ['n6', 'Chat widget']], 'encrypted list');
    ok(r.details.notInPipeline.every(c => c.name && c.email && c.phone), 'list has names, emails and phones for the drill-down');
    for (const c of contacts) for (const v of [c.email, c.phone, `Person ${c.id}`]) {
      ok(!r.kpisText.includes(v), `kpis.json contains "${v}"`);
      ok(!r.out.includes(v), `run log contains "${v}"`);
    }
    ok(/New contacts not in any pipeline: 4 of 12 contacts created in the window \(skipped: 1 have an opportunity, 1 not typed lead, 5 added in bulk, 1 no inbound signal\)/.test(r.out), 'log has counts only');
    const files = await readdir(join(tmp, 'firms/fx/data'));
    eq(files.sort(), ['details.enc.json', 'kpis.json'], 'no other files written');
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('Sync: a failing contact search leaves the count unknown (null), and the rest publishes', async () => {
  const tmp = await makeRepo();
  try {
    const r = await sync(tmp, { contacts: world(), intercept: p => (p === '/contacts/search' ? { status: 500, body: { message: 'down' } } : null) });
    eq(r.code, 0, 'exit code');
    eq(r.kpis.periods.last30.current.notInPipeline, null, 'count unknown');
    eq(r.details.notInPipeline, null, 'no list');
    ok(r.kpis.periods.last30.current.totalLeads > 0, 'New leads still published');
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

test('Sync: a refused contact search (403) stops the sync before publishing, like any missing scope', async () => {
  const tmp = await makeRepo();
  try {
    const before = await sync(tmp, { contacts: world() });
    const r = await sync(tmp, { contacts: world(), intercept: p => (p === '/contacts/search' ? { status: 403, body: { message: 'not authorized' } } : null) });
    eq(r.code, 1, 'exit code');
    eq(r.kpisText, before.kpisText, 'kpis.json unchanged');
  } finally { await rm(tmp, { recursive: true, force: true }); }
});

// ---------- 4. settings ----------
test('showNotInPipeline is off by default and no firm turns it on', async () => {
  const d = await readJSON(join(ROOT, 'firms/_defaults.json'));
  eq(d.showNotInPipeline, false, '_defaults.json');
  for (const f of await readJSON(join(ROOT, 'firms/index.json'))) {
    const cfg = mergeConfig(d, null, await readJSON(join(ROOT, `firms/${f.slug}/config.json`)));
    eq(cfg.showNotInPipeline, false, `${f.slug} effective setting`);
  }
  const html = await readFile(join(ROOT, 'app/dashboard.html'), 'utf8');
  ok(html.includes("if (cfg.showNotInPipeline !== true || v === null || v === undefined) return '';"), 'dashboard line is behind the setting');
});

// ---------- run ----------
const only = process.argv[2] || '';
const results = [];
for (const t of tests) {
  if (only && !t.name.toLowerCase().includes(only.toLowerCase())) continue;
  const t0 = Date.now();
  try { await t.fn(); results.push({ name: t.name, pass: true, ms: Date.now() - t0 }); }
  catch (e) { results.push({ name: t.name, pass: false, error: e.message, ms: Date.now() - t0 }); }
}
console.log('\nNew contacts not in pipeline tests\n');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${(r.ms / 1000).toFixed(1)} s)${r.error ? `\n      ${r.error}` : ''}`);
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed} of ${results.length} tests pass.`);
process.exit(failed ? 1 : 0);
