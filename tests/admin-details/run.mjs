// Admin v1.13 helpers (admin/firm-details.mjs) + a public-data check.   Run:  node tests/admin-details/run.mjs
// Checks: attention reasons and their order, the not-in-pipeline list (30 days, no emails/phones), GHL contact links, the
// Performance numbers against each firm's real kpis.json, the goal rules (identical to app/dashboard.html's GOALS), and that
// no public file in the repo (kpis.json, config, discovery, status, firm list) holds contact IDs, names, emails or phones.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmReasons, notInPipelineList, ghlContactUrl, perfView, GOALS, SYNC_PROBLEMS } from '../../admin/firm-details.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let failed = 0, passed = 0;
const check = (v, what) => { if (v) { passed++; console.log(`✓ ${what}`); } else { failed++; console.log(`✗ ${what}`); } };
const json = async p => JSON.parse(await readFile(join(ROOT, p), 'utf8'));

// ---- reasons ----
const k0 = { periods: { last30: { current: { notInPipeline: 0 } } } };
const k2 = { periods: { last30: { current: { notInPipeline: 2 } } } };
check(firmReasons('a', k0, []).length === 0, 'clean firm: no reasons');
check(JSON.stringify(firmReasons('a', null, []).map(r => r.kind)) === '["nodata"]', 'no kpis.json: "No data yet"');
const rs = firmReasons('a', k2, [
  { slug: 'a', kind: 'mapping-review' }, { slug: 'a', kind: 'held', count: 1 }, { slug: 'a', kind: 'failed' }, { slug: 'b', kind: 'failed' }, { slug: null, kind: 'no-link' },
]);
check(JSON.stringify(rs.map(r => r.kind)) === '["failed","held","mapping-review","not-in-pipeline"]', `order: most urgent first, only this firm (${rs.map(r => r.kind).join(', ')})`);
check(rs[3].short === '2 leads not in a pipeline' && firmReasons('a', { periods: { last30: { current: { notInPipeline: 1 } } } }).at(0).short === '1 lead not in a pipeline', 'reason wording: "1 lead / 2 leads not in a pipeline"');
check(SYNC_PROBLEMS.has('failed') && SYNC_PROBLEMS.has('stale') && !SYNC_PROBLEMS.has('not-in-pipeline') && !SYNC_PROBLEMS.has('held'), 'sync problems: failed/stale/token/no data, not pipeline or holds');

// ---- not in pipeline list ----
const now = Date.parse('2026-11-15T12:00:00Z');
const list = notInPipelineList({ notInPipeline: [
  { contactId: 'c1', name: 'A', email: 'a@x', phone: '1', createdAt: '2026-11-10T00:00:00Z', via: 'Form' },
  { contactId: 'c2', name: 'B', createdAt: '2026-11-14T00:00:00Z', via: 'Called in' },
  { contactId: 'c3', name: 'Old', createdAt: '2026-09-01T00:00:00Z' },
  { name: 'No id', createdAt: '2026-11-14T00:00:00Z' },
] }, now);
check(JSON.stringify(list.map(c => c.contactId)) === '["c2","c1"]', 'list: last 30 days, newest first, rows without an ID dropped');
check(list.every(c => !('email' in c) && !('phone' in c)), 'list: no emails or phones');
check(notInPipelineList(null, now).length === 0 && notInPipelineList({}, now).length === 0, 'list: missing data → empty');
check(ghlContactUrl('https://app.lawfirmmarketingpros.com', 'sQ2VSMkR7cLHb46Wdemi', 'abc') === 'https://app.lawfirmmarketingpros.com/v2/location/sQ2VSMkR7cLHb46Wdemi/contacts/detail/abc', 'Open in GHL link');

// ---- performance against the real public numbers ----
const defaults = await json('firms/_defaults.json');
for (const slug of (await json('firms/index.json')).map(f => f.slug)) {
  let k; try { k = await json(`firms/${slug}/data/kpis.json`); } catch { continue; }
  const cfg = { ...defaults, ...(await json(`firms/${slug}/config.json`)) };
  for (const key of ['last7', 'last30', 'last90']) {
    const v = perfView(k, cfg, key), c = k.periods[key].current, p = k.periods[key].previous;
    const ok = v && v.tiles[0].value === String(c.totalLeads) && v.tiles[3].value === String(c.signed)
      && v.funnel.length === c.funnel.length && v.funnel.every((r, i) => r.label === c.funnel[i][0] && r.value === c.funnel[i][1])
      && (!p || v.tiles[0].sub.includes(String(Math.abs(c.totalLeads - p.totalLeads))));
    check(ok, `${slug} ${key}: tiles and funnel = kpis.json (${c.totalLeads} leads, ${c.signed} signed)`);
  }
  const hidesConsults = !k.periods.last30.current.funnel.some(r => r[2] === 'consultBooked');
  check(perfView(k, cfg, 'last30').tiles[2].label === (hidesConsults ? 'Qualified' : 'Consults booked'), `${slug}: third tile ${hidesConsults ? 'Qualified (consult steps hidden)' : 'Consults booked'}`);
}
const synth = { generatedAt: '2026-11-15T00:00:00Z', targets: { within5Pct: 80, leadToSignedPct: 8, contactRatePct: 80 }, periods: { last30: {
  current: { totalLeads: 20, within5: 18, within5Pct: 90, contactRatePct: 50, contacted: 10, signed: 3, leadToSignedPct: 15, consultBooked: 5, qualified: 8, funnel: [['New leads', 20, 'newLeads'], ['Contacted', 10, 'contacted'], ['Consult booked', 5, 'consultBooked'], ['Signed', 3, 'signed']] },
  previous: { totalLeads: 30, signed: 1 } } } };
const sv = perfView(synth, {}, 'last30');
check(sv.tiles[0].sub === '−10 vs prior 30 days' && sv.tiles[2].value === '5' && sv.tiles[2].sub === '25% of leads' && sv.tiles[3].sub === '15% · goal 8%', `tiles: ${sv.tiles.map(t => `${t.label} ${t.value} (${t.sub})`).join('; ')}`);
check(sv.funnel[0].width === 100 && sv.funnel[3].width === 15, 'funnel bars scaled to new leads');
check(sv.good[0].startsWith('3 new signed clients, up from 1') && sv.good.some(g => /Contacted within 5 minutes is 90%, above the 80% goal/.test(g)), `going well: ${sv.good.join(' | ')}`);
check(sv.bad.some(b => /Contact rate is 50% \(goal 80%\)/.test(b)) && sv.bad.some(b => /Lead flow is down 33%/.test(b)), `needs attention: ${sv.bad.join(' | ')}`);
{ const few = perfView(synth, { minSample: 50 }, 'last30'); check(few.bad.length === 0 && few.good.length === 1 && few.badEmpty === 'Not enough data yet to judge any metric against its goal.', 'minSample: too few leads → goals not scored'); }
check(perfView({ periods: {} }, {}, 'last30') === null, 'no data → null');

// ---- the goal list matches the client dashboard's ----
const dash = await readFile(join(ROOT, 'app/dashboard.html'), 'utf8');
const block = dash.slice(dash.indexOf('const GOALS = ['), dash.indexOf('];', dash.indexOf('const GOALS = [')));
const dashGoals = [...block.matchAll(/\[('[^']*'(?:, [^\]]*)?)\]/g)].map(m => Function(`return [${m[1]}]`)()).map(([k, l, gk, low, , u, d]) => [k, l, gk, low, u, d]);
check(dashGoals.length === 9 && JSON.stringify(dashGoals) === JSON.stringify(GOALS), `GOALS identical to app/dashboard.html (${dashGoals.length} goals)`);

// ---- no contact data in any public file ----
const BAD_KEYS = new Set(['contactId', 'email', 'phone', 'contactName', 'firstName', 'lastName']);
const badKeys = (o, path = '') => (Array.isArray(o) ? o.flatMap((x, i) => badKeys(x, `${path}[${i}]`)) : o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => [...(BAD_KEYS.has(k) && (typeof v === 'string' || k === 'contactId') ? [`${path}.${k}`] : []), ...badKeys(v, `${path}.${k}`)]) : []);
const publicFiles = ['firms/index.json', ...(await readdir(join(ROOT, 'status'))).filter(f => f.endsWith('.json')).map(f => `status/${f}`)];
for (const d of await readdir(join(ROOT, 'firms'), { withFileTypes: true })) {
  if (!d.isDirectory() || d.name.startsWith('_')) continue;
  for (const f of ['config.json', 'discovery.json', 'data/kpis.json']) publicFiles.push(`firms/${d.name}/${f}`);
}
let scanned = 0; const found = [];
for (const p of publicFiles) { let o; try { o = await json(p); } catch { continue; } scanned++; found.push(...badKeys(o).map(x => `${p}${x}`)); }
check(scanned >= 10 && !found.length, `no contact IDs, names, email addresses or phone numbers in ${scanned} public files${found.length ? `: ${found.slice(0, 5).join(', ')}` : ''}`);
const admin = await readFile(join(ROOT, 'admin/index.html'), 'utf8');
check(!/localStorage\.setItem\([^)]*(nip|notInPipeline)/i.test(admin) && !/sessionStorage\.setItem\([^)]*(nip|notInPipeline)/i.test(admin), 'the admin page never stores the decrypted list');

console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nAll ${passed} admin details checks passed`);
process.exitCode = failed ? 1 : 0;
