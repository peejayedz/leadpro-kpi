// Admin v1.13 helpers (admin/firm-details.mjs) + a public-data check.   Run:  node tests/admin-details/run.mjs
// Checks: attention reasons and their order, the not-in-pipeline list (30 days, name/email/phone/source, no "Unknown"), GHL contact links, the
// Performance numbers against each firm's real kpis.json, the goal rules (identical to app/dashboard.html's GOALS), and that
// no public file in the repo (kpis.json, config, discovery, status, firm list) holds contact IDs, names, emails or phones.
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firmReasons, notInPipelineList, ghlContactUrl, perfView, GOALS, SYNC_PROBLEMS, severity, leadTrend, sortFirms, staleLine, forDuration } from '../../admin/firm-details.mjs';
import { isMinor, cardVersion } from '../../admin/news.mjs';

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

// ---- v1.25.0: one colour per meaning (bell, row, details, filter) ----
const ALERTS = ['failed', 'app-missing', 'app-token', 'stale', 'no-sync', 'chain-off', 'no-link', 'keeper-failed', 'keeper-reconnect', 'keeper-stale'];
const NOTICES = ['held', 'incomplete', 'mapping-review', 'nodata', 'not-in-pipeline'];
check(ALERTS.every(k => severity(k) === 'alert'), `alerts (red): ${ALERTS.join(', ')}`);
check(NOTICES.every(k => severity(k) === 'notice'), `notices (amber): ${NOTICES.join(', ')}`);
check(severity('something-new') === 'alert', 'an unknown kind is an alert (safer)');
// every kind the bell can raise has a severity on purpose (the lists above cover all of them)
{
  const srcs = await Promise.all(['scripts/sync-status.mjs', 'scripts/keeper-status.mjs'].map(p => readFile(join(ROOT, p), 'utf8')));
  const kinds = new Set(srcs.flatMap(s => [...s.matchAll(/kind: '([a-z-]+)'/g)].map(m => m[1])));
  const missing = [...kinds].filter(k => !ALERTS.includes(k) && !NOTICES.includes(k));
  check(kinds.size >= 12 && !missing.length, `every bell kind is listed as alert or notice (${kinds.size} kinds${missing.length ? `; missing ${missing.join(', ')}` : ''})`);
}
// ---- v1.25.0: leads trend, last 90 days vs the 90 days before ----
// v1.26.0: only when the 90 days before (days 91–180) are fully covered: the firm's start (index.json createdAt) at or before
// periods.last90.from − 90 days. Never "▲ from 0", never a % from a partial period.
const NOW90 = Date.parse('2026-11-19T00:00:00Z'), FROM90 = NOW90 - 90 * 864e5, PREV_START = FROM90 - 90 * 864e5;
const kt = (cur, prev) => ({ periods: { last90: { from: FROM90, to: NOW90, current: { totalLeads: cur }, previous: prev === undefined ? undefined : { totalLeads: prev } } } });
const OLD = { since: '2025-01-01T00:00:00Z' };   // a firm on the scorecards long before day 180 = covered
check(JSON.stringify(leadTrend(kt(112, 100), OLD)) === JSON.stringify({ dir: 'up', text: '▲ 12%', label: 'up 12% on the 90 days before' }), 'covered, trend up: ▲ 12%');
check(leadTrend(kt(92, 100), OLD).text === '▼ 8%' && leadTrend(kt(92, 100), OLD).dir === 'down', 'covered, trend down: ▼ 8%');
check(leadTrend(kt(50, 50), OLD).text === '— same' && leadTrend(kt(1001, 1000), OLD).text === '— same', 'covered, trend same (also under 0.5%): — same');
check(leadTrend(kt(5, 0), OLD) === null, 'covered but the 90 days before had 0: no trend (never "▲ from 0")');
check(leadTrend(kt(5), OLD) === null && leadTrend(null, OLD) === null && leadTrend({ periods: {} }, OLD) === null, 'no previous number in the data: no trend');
check(leadTrend(kt(100, 11), { since: new Date(PREV_START).toISOString() })?.text === '▲ 809%', 'start exactly at day 180 = covered (▲ 809% for 100 vs 11)');
check(leadTrend(kt(100, 11), { since: new Date(PREV_START + 60e3).toISOString() }) === null, 'start one minute after day 180 = partial: no trend');
check(leadTrend(kt(100, 11), { since: '2026-11-02T00:00:00.000Z' }) === null, 'Mahdavi-like (started 2 Nov 2026, 100 vs 11): no trend, no "▲ 809%"');
check(leadTrend(kt(100, 11)) === null && leadTrend(kt(100, 11), { since: 'not a date' }) === null, 'no start date (or not a date) = not covered: no trend');
check(leadTrend({ periods: { last90: { current: { totalLeads: 9 }, previous: { totalLeads: 10 } } } }, OLD) === null, 'no period start in the data = not covered');
check(leadTrend({ periods: { last90: { ...kt(9, 10).periods.last90, from: new Date(FROM90).toISOString() } } }, OLD)?.text === '▼ 10%', 'period start as an ISO date works too');
{
  // The real files: every firm today started in Nov 2026, so none is covered → the rows show just "leads · 90 days".
  const firmsIdx = await json('firms/index.json');
  for (const slug of ['mahdavi', 'lfmp']) {
    const m = await json(`firms/${slug}/data/kpis.json`), f = firmsIdx.find(x => x.slug === slug), c = m.periods.last90.current.totalLeads, p = m.periods.last90.previous.totalLeads;
    const covered = Date.parse(f.createdAt) <= m.periods.last90.from - 90 * 864e5, t = leadTrend(m, { since: f.createdAt });
    check(covered ? (p > 0 ? !!t && !/from 0/.test(t.text) : t === null) : t === null, `real data (${slug}): ${c} vs ${p}, scorecard since ${f.createdAt.slice(0, 10)} → ${t?.text || `no trend (${covered ? 'previous 0' : 'days 91–180 not covered'})`}`);
  }
}
// ---- v1.26.0: firm list A–Z (every filter and search use the same sort) ----
{
  const fs = [{ slug: 'z', name: 'ZZ TEST 2' }, { slug: 'm', name: 'The Mahdavi Law Firm' }, { slug: 'l', name: 'Law Firm Marketing Pros (LFMP)' },
    { slug: 'h', name: 'Hedayati Law Group, P.C' }, { slug: 'e', name: 'emery Law Office' }, { slug: 'a', name: 'Acme Law' }];
  const nm = f => f.name, names = list => sortFirms(list, nm).map(f => f.slug).join('');
  check(names(fs) === 'aehlmz', `All: A–Z by shown name, "The Mahdavi" under M, lower-case "emery" under E (${names(fs)})`);
  check(names(fs.filter(f => /law/i.test(f.name))) === 'aehlm', 'search "law": results A–Z');
  check(names(fs.filter(f => ['z', 'm', 'h'].includes(f.slug))) === 'hmz', 'Needs attention subset: A–Z (not by urgency)');
  check(names(fs.filter(f => f.slug === 'z')) === 'z' && names([]) === '', 'Test firms / empty');
  check(JSON.stringify(fs.map(f => f.slug)) === '["z","m","l","h","e","a"]', 'sortFirms returns a copy (the firm list itself keeps index.json order)');
  check(names([{ slug: 'x', name: 'zed' }, { slug: 'b', name: 'Beta' }, { slug: 'a', name: 'alpha' }, { slug: 'c', name: 'Charlie' }]) === 'abcx', 'case-insensitive: alpha, Beta, Charlie, zed');
}
// ---- v1.26.0: "No successful sync for …" on the firm row ----
{
  const N = Date.parse('2026-11-19T12:00:00Z'), back = min => new Date(N - min * 60e3).toISOString();
  check(staleLine(N, back(45)) === 'No successful sync for 45 min', staleLine(N, back(45)));
  check(staleLine(N, back(182)) === 'No successful sync for 3 h', staleLine(N, back(182)));
  check(staleLine(N, back(2 * 1440 + 30)) === 'No successful sync for 2 days', staleLine(N, back(2 * 1440 + 30)));
  check(forDuration(N, back(119)) === '119 min' && forDuration(N, back(47 * 60)) === '47 h', 'units as the bell: minutes under 2 h, hours under 2 days');
  const html = await readFile(join(ROOT, 'admin/index.html'), 'utf8');
  check(/staleLine\(Date\.now\(\), r\.issue\.lastGood/.test(html) && !/No successful sync in \$\{/.test(html), 'the row uses staleLine (no "in 3 hours 2 h ago")');
}
// ---- v1.26.0: What's new cards only for minor releases ----
{
  check(isMinor('1.26.0') && !isMinor('1.25.1') && !isMinor('1.26.10') && !isMinor(''), 'isMinor: x.Y.0 only');
  check(cardVersion('1.26.0') === '1.26.0' && cardVersion('1.26.3') === '1.26.0' && cardVersion('nope') === null, 'cardVersion: a patch shows its minor release\'s card, never its own');
  const html = await readFile(join(ROOT, 'admin/index.html'), 'utf8');
  const toast = html.match(/async function showNewsToast\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  check(/cardVersion\(latest\)/.test(toast) && /isMinor\(v\)/.test(toast) && /loadPlainNews\(\)\)\[v\]/.test(toast) && !/buildCards|guessItem|loadChangelog/.test(toast), 'the card uses whats-new.json for the minor release only (no CHANGELOG fallback wording)');
  const plain = await json('admin/whats-new.json');
  const latest = (await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8')).match(/^## v(\d+\.\d+\.\d+)/m)[1];
  check(plain[cardVersion(latest)]?.title, `the card for v${latest} = whats-new.json "${cardVersion(latest)}" with a title`);
}

// ---- not in pipeline list ----
const now = Date.parse('2026-11-15T12:00:00Z');
const list = notInPipelineList({ notInPipeline: [
  { contactId: 'c1', name: 'A', email: 'a@x', phone: '1', createdAt: '2026-11-10T00:00:00Z', via: 'Form' },
  { contactId: 'c2', name: 'B', createdAt: '2026-11-14T00:00:00Z', via: 'Called in' },
  { contactId: 'c3', name: 'Old', createdAt: '2026-09-01T00:00:00Z' },
  { name: 'No id', createdAt: '2026-11-14T00:00:00Z' },
  { contactId: 'c4', name: 'Unnamed', email: 'only@mail.test', phone: '+15550001', createdAt: '2026-11-12T00:00:00Z', via: 'Chat widget' },
  { contactId: 'c5', name: '+15550002', email: null, phone: '+15550002', createdAt: '2026-11-11T00:00:00Z', via: 'Texted in' },
  { contactId: 'c6', name: 'Unknown', createdAt: '2026-11-09T00:00:00Z', via: 'Calendar booking' },
] }, now);
check(JSON.stringify(list.map(c => c.contactId)) === '["c2","c4","c5","c1","c6"]', 'list: last 30 days, newest first, rows without an ID dropped');
const byId = id => list.find(c => c.contactId === id);
check(byId('c1').email === 'a@x' && byId('c1').phone === '1' && byId('c1').named && byId('c1').source === 'Form', 'list: name, email, phone and source kept (from the encrypted file)');
check(byId('c4').name === 'only@mail.test' && !byId('c4').named && byId('c5').name === '+15550002' && !byId('c5').named, 'list: no name → email, then phone (never "Unnamed")');
check(byId('c6').name === 'No name, email or phone' && !list.some(c => /^Unknown$|^Unnamed$/.test(c.name)), 'list: nothing at all → "No name, email or phone", never "Unknown"');
check(['c2', 'c4', 'c5', 'c6'].map(id => byId(id).source).join() === 'Call,Chat,Text,Booking', 'list: source in short words (Call, Chat, Text, Booking)');
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
// v1.13.1: also look at the VALUES. Any email address or phone number in any unencrypted data file (every .json under
// firms/, status/ and admin/, except details.enc.json) fails, whatever key it's under.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, PHONE_RE = /(?:\+\d{10,15}\b|\(\d{3}\)\s?\d{3}-\d{4}|\b\d{3}-\d{3}-\d{4}\b)/;
const allJson = async dir => (await readdir(join(ROOT, dir), { withFileTypes: true, recursive: true }))
  .filter(d => d.isFile() && d.name.endsWith('.json') && d.name !== 'details.enc.json')
  .map(d => join(d.parentPath || d.path, d.name).slice(ROOT.length));
const plainFiles = [...await allJson('firms'), ...await allJson('status'), ...await allJson('admin')];
const pii = [];
// The one exception: custom-field LABELS in discovery.json (a form question can name the firm's own inbox, e.g.
// "grant CRM access to info@…"). They're field names the sub-account defines, never a lead's details.
const strip = (p, o) => { if (p.endsWith('discovery.json') && o?.customFields) for (const list of Object.values(o.customFields)) if (Array.isArray(list)) for (const f of list) if (f) delete f.name; return o; };
for (const p of plainFiles) { const t = JSON.stringify(strip(p, JSON.parse(await readFile(join(ROOT, p), 'utf8')))); const m = t.match(EMAIL_RE) || t.match(PHONE_RE); if (m) pii.push(`${p}: ${m[0].replace(/./g, (c, i) => (i < 2 ? c : '•'))}`); }
check(plainFiles.length >= 15 && !pii.length, `no email address or phone number in ${plainFiles.length} unencrypted data files${pii.length ? `: ${pii.slice(0, 5).join(', ')}` : ''}`);
const admin = await readFile(join(ROOT, 'admin/index.html'), 'utf8');
check(!/console\.(log|info|warn|error|debug)\([^)]*(nip|notInPipeline|email|phone|\.name\b|pass)/i.test(admin), 'the admin page never logs contacts or passphrases to the console');
// v1.19.0: remembered passphrases live on the team site's server (/api/kpi-pass, encrypted there), never in this browser
check(/api\('kpi-pass'/.test(admin) && !/PASS_VAULT_KEY|leadpro-admin-firm-pass/.test(admin) && !/(store\.set|localStorage\.setItem|sessionStorage\.setItem)\([^)]*(pass|typed)\b/i.test(admin), 'remembered passphrases go to the server only, never into browser storage');
check(!/localStorage\.setItem\([^)]*(nip|notInPipeline)/i.test(admin) && !/sessionStorage\.setItem\([^)]*(nip|notInPipeline)/i.test(admin), 'the admin page never stores the decrypted list');

console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nAll ${passed} admin details checks passed`);
process.exitCode = failed ? 1 : 0;
