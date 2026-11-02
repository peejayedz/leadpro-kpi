// Sync status and notification tests.   Run:  node tests/status/run.mjs   (Node 20+, no dependencies)
//
// 1. The real scripts/sync.mjs (temp copy of the repo, Mahdavi's config) against a mock GHL that
//    fails in each way the admin page reports: token rejected, missing scope, GHL server / rate
//    limit / network errors, config errors, a missing token secret, and an unexpected crash.
//    Checks the category in the result file, that the dashboard data is left alone, and that
//    the result file holds no token, passphrase, contact data or error text.
// 2. scripts/sync-status.mjs: how runs turn into open and resolved issues (status file), and
//    the issues the admin page shows (stale firms, chain off / stopped, no sync at all).
// Writes nothing in the repo.

import { readFile, writeFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockGhl } from '../mapping/mock-ghl.mjs';
import { updateStatus, openIssues, firmState, describeIssue, cleanResult, seenKey, inBadge, SCOPE_NAMES, CATEGORIES } from '../../scripts/sync-status.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readJSON = async p => JSON.parse(await readFile(p, 'utf8'));
const MIN = 60e3;
const TOKEN = 'pit-SECRET-token-value-123', PASS = 'secret passphrase #9';
const discovery = await readJSON(join(ROOT, 'firms/mahdavi/discovery.json'));
const only = process.argv[2] || '';

const tests = [];
const test = (name, fn, { repo = false } = {}) => tests.push({ name, fn, repo });
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, what) => { if (!v) throw new Error(what); };

// ---------- part 1: sync.mjs failure categories ----------
async function makeRepo() {
  const tmp = await mkdtemp(join(tmpdir(), 'lpk-status-'));
  await cp(join(ROOT, 'scripts'), join(tmp, 'scripts'), { recursive: true });
  await mkdir(join(tmp, 'firms', 'fx'), { recursive: true });
  await cp(join(ROOT, 'firms/_defaults.json'), join(tmp, 'firms/_defaults.json'));
  await cp(join(ROOT, 'firms/_defaults'), join(tmp, 'firms/_defaults'), { recursive: true });
  await cp(join(ROOT, 'firms/mahdavi/config.json'), join(tmp, 'firms/fx/config.json'));
  return tmp;
}
// Users and a calendar exist, so every scope can be tested.
const world = { users: [{ id: 'u1', name: 'Staff One' }], calendars: [{ id: 'cal1', name: 'Consultation' }] };
const base = (path) => {
  if (path === '/users/') return { body: { users: world.users } };
  if (path === '/calendars/') return { body: { calendars: world.calendars } };
  return null;
};
async function sync(tmp, intercept = () => null, { env = {}, slug = 'fx', api } = {}) {
  const hits = [];
  const mock = await startMockGhl(discovery, 0, { intercept: (path, q) => { hits.push(path); return intercept(path, q) || base(path); } });
  const resultFile = join(tmp, 'result', `${slug}.json`);
  await rm(resultFile, { force: true });
  let out = '', code = 0;
  try {
    const r = await run(process.execPath, [join(tmp, 'scripts/sync.mjs'), slug], {
      env: { PATH: process.env.PATH, GHL_API_BASE: api || mock.url, GHL_TOKEN: TOKEN, DASHBOARD_PASSPHRASE: PASS, GHL_BACKOFF_MS: '5', SYNC_RESULT_FILE: resultFile, ...env } });
    out = r.stdout + r.stderr;
  } catch (e) { code = e.code || 1; out = (e.stdout || '') + (e.stderr || e.message); }
  finally { await mock.close(); }
  const resultText = await readFile(resultFile, 'utf8').catch(() => null);
  const kpisText = await readFile(join(tmp, `firms/${slug}/data/kpis.json`), 'utf8').catch(() => null);
  return { code, out, result: resultText && JSON.parse(resultText), resultText, kpisText, hits };
}
const ALLOWED_RESULT_KEYS = ['slug', 'at', 'ok', 'category', 'detail', 'area', 'scopes', 'notInPipeline'];
function privateCheck(r) {
  ok(r.resultText, 'a result file was written');
  for (const k of Object.keys(r.result)) ok(ALLOWED_RESULT_KEYS.includes(k), `unexpected key "${k}" in the result file`);
  for (const bad of [TOKEN, PASS, 'Staff One', 'Lead ', 'GHL ', 'http']) ok(!r.resultText.includes(bad), `result file contains "${bad}"`);
}
const deny = (re, status = 401) => path => (re.test(path) ? { status, body: { message: status === 401 ? 'Invalid JWT' : 'The token is not authorized for this scope.' } } : null);

test('A good sync writes ok: true', async tmp => {
  const r = await sync(tmp);
  eq(r.code, 0, 'exit code'); eq(r.result.ok, true, 'ok'); privateCheck(r);
}, { repo: true });

test('Token rejected: every request refused → "token / rejected"; dashboard data untouched', async tmp => {
  const good = await sync(tmp);
  const r = await sync(tmp, deny(/./));
  eq(r.code, 1, 'exit code'); eq([r.result.ok, r.result.category, r.result.detail], [false, 'token', 'rejected'], 'category');
  eq(r.kpisText, good.kpisText, 'kpis.json unchanged'); privateCheck(r);
  ok(/Sync failed \(token: rejected\)/.test(r.out), 'run log names the category');
}, { repo: true });

test('Missing scope (View Calendars): optional part refused → "scope", named, and nothing published', async tmp => {
  const good = await sync(tmp);
  const r = await sync(tmp, deny(/^\/calendars\/$/, 403));
  eq(r.code, 1, 'exit code'); eq([r.result.category, r.result.scopes], ['scope', ['calendars.readonly']], 'category + scope');
  eq(r.kpisText, good.kpisText, 'kpis.json unchanged'); privateCheck(r);
}, { repo: true });

test('Missing scope (View Conversation Messages): refused message export → "scope"', async tmp => {
  const r = await sync(tmp, deny(/^\/conversations\/messages\/export$/, 401));
  eq(r.code, 1, 'exit code'); eq([r.result.category, r.result.scopes], ['scope', ['conversations/message.readonly']], 'category + scope'); privateCheck(r);
}, { repo: true });

test('Two scopes missing (Users + Custom Fields) are both named', async tmp => {
  const r = await sync(tmp, p => deny(/^\/users\/$/, 403)(p) || deny(/customFields$/, 403)(p));
  eq(r.result.category, 'scope', 'category'); eq([...r.result.scopes].sort(), ['locations/customFields.readonly', 'users.readonly'], 'scopes');
}, { repo: true });

test('GHL server error (503 that never recovers) → "ghl / server" in opportunities, after 3 retries', async tmp => {
  const r = await sync(tmp, p => (p === '/opportunities/pipelines' ? { status: 503, body: { message: 'down' } } : null));
  eq(r.code, 1, 'exit code'); eq([r.result.category, r.result.detail, r.result.area], ['ghl', 'server', 'opportunities'], 'category');
  eq(r.hits.filter(p => p === '/opportunities/pipelines').length, 4, 'tries'); privateCheck(r);
}, { repo: true });

test('GHL rate limit that never lifts → "ghl / rate-limit"', async tmp => {
  const r = await sync(tmp, p => (p === '/opportunities/search' ? { status: 429 } : null));
  eq([r.result.category, r.result.detail, r.result.area], ['ghl', 'rate-limit', 'opportunities'], 'category');
}, { repo: true });

test('GHL unreachable → "ghl / network"', async tmp => {
  const r = await sync(tmp, undefined, { api: 'http://127.0.0.1:9' });
  eq([r.result.category, r.result.detail], ['ghl', 'network'], 'category'); privateCheck(r);
}, { repo: true });

test('Firm config errors: missing config, invalid JSON, no location ID', async tmp => {
  let r = await sync(tmp, undefined, { slug: 'nofirm' });
  eq([r.result.category, r.result.detail], ['config', 'no-config'], 'no config');
  await writeFile(join(tmp, 'firms/fx/config.json'), '{ "locationId": ');
  r = await sync(tmp);
  eq([r.result.category, r.result.detail], ['config', 'bad-config'], 'bad JSON');
  const cfg = await readJSON(join(ROOT, 'firms/mahdavi/config.json')); delete cfg.locationId;
  await writeFile(join(tmp, 'firms/fx/config.json'), JSON.stringify(cfg));
  r = await sync(tmp);
  eq([r.result.category, r.result.detail], ['config', 'no-location'], 'no location'); privateCheck(r);
}, { repo: true });

test('Token secret not set → "token / missing-secret"', async tmp => {
  const r = await sync(tmp, undefined, { env: { GHL_TOKEN: '' } });
  eq([r.result.category, r.result.detail], ['token', 'missing-secret'], 'category'); privateCheck(r);
}, { repo: true });

test('Unexpected crash → "unknown / crash" (and the stack is in the run log)', async tmp => {
  const r = await sync(tmp, p => (p === '/opportunities/pipelines' ? { body: { pipelines: 5 } } : null));
  eq(r.code, 1, 'exit code'); eq([r.result.category, r.result.detail], ['unknown', 'crash'], 'category');
  ok(/TypeError/.test(r.out), 'stack in log'); privateCheck(r);
}, { repo: true });

// ---------- part 2: status file ----------
const T0 = Date.parse('2026-11-02T10:07:00Z');
const RUN = n => `https://github.com/peejayedz/leadpro-kpi/actions/runs/${1000 + n}`;
const okRes = slug => ({ slug, ok: true, at: new Date(T0).toISOString() });
const failRes = (slug, category, detail, extra = {}) => ({ slug, ok: false, category, detail, ...extra });
const step = (prev, n, results, more = {}) => updateStatus(prev, { now: T0 + n * 30 * MIN, runUrl: RUN(n), event: 'workflow_dispatch', chained: true, attempted: Object.keys(results), results, ...more });

test('One firm failing never affects another firm in the same run', () => {
  const s = step(null, 0, { a: failRes('a', 'token', 'rejected'), b: okRes('b') });
  eq([s.firms.a.status, s.firms.b.status], ['failed', 'ok'], 'statuses');
  eq(s.open.map(i => i.id), ['a:failed'], 'open issues');
  eq(s.firms.b.lastSuccessAt, new Date(T0).toISOString(), 'b synced');
});

test('A failure repeats: first seen kept, last seen + count + run link move; next success resolves it', () => {
  let s = step(null, 0, { a: failRes('a', 'scope', 'missing', { scopes: ['calendars.readonly'] }) });
  s = step(s, 1, { a: failRes('a', 'scope', 'missing', { scopes: ['calendars.readonly'] }) });
  const i = s.open[0];
  eq([i.firstSeen, i.lastSeen, i.count, i.runUrl, s.firms.a.failStreak], [new Date(T0).toISOString(), new Date(T0 + 30 * MIN).toISOString(), 2, RUN(1), 2], 'repeat');
  eq(i.scopes, ['calendars.readonly'], 'scope kept');
  s = step(s, 2, { a: okRes('a') });
  eq(s.open, [], 'no open issues'); eq(s.resolved[0].id, 'a:failed', 'resolved'); eq(s.resolved[0].resolvedAt, new Date(T0 + 60 * MIN).toISOString(), 'resolved time');
  eq(s.firms.a.status, 'ok', 'status');
});

test('A Re-sync of one firm leaves the other firms\' issues alone', () => {
  let s = step(null, 0, { a: failRes('a', 'ghl', 'server'), b: failRes('b', 'token', 'rejected') });
  s = step(s, 1, { a: okRes('a') });
  eq(s.open.map(i => i.id), ['b:failed'], 'b still open');
  eq(s.open[0].count, 1, 'b not counted again');
});

test('Held, then incomplete, then clear: each opens and resolves', () => {
  const flags = f => ({ syncFlags: { a: f } });
  let s = step(null, 0, { a: okRes('a') }, flags({ holds: 1, heldSince: '2026-11-02T10:07:00.000Z', reason: 'Call 63 → 16' }));
  eq([s.firms.a.status, s.open[0].kind, s.open[0].count, s.open[0].reason], ['held', 'held', 1, 'Call 63 → 16'], 'held 1');
  s = step(s, 1, { a: okRes('a') }, flags({ holds: 2, heldSince: '2026-11-02T10:07:00.000Z', reason: 'Call 63 → 16' }));
  eq(s.open[0].count, 2, 'held 2');
  s = step(s, 2, { a: okRes('a') }, flags({ holds: 0, incomplete: true, incompleteSince: '2026-11-02T11:07:00.000Z', reason: 'Call 63 → 16' }));
  eq([s.firms.a.status, s.open.map(i => i.kind), s.resolved[0].kind], ['ok', ['incomplete'], 'held'], 'incomplete');
  s = step(s, 3, { a: okRes('a') }, flags({ holds: 0, incomplete: false }));
  eq([s.open.length, s.resolved[0].kind], [0, 'incomplete'], 'cleared');
});

test('A firm job that leaves no result counts as an unknown failure', () => {
  const s = step(null, 0, { a: null });
  eq([s.open[0].category, s.open[0].detail], ['unknown', 'no-result'], 'category');
});

test('Firms the plan skipped become config issues', () => {
  const s = step(null, 0, { b: okRes('b') }, { planProblems: [{ slug: 'a', detail: 'secret-key-mismatch' }] });
  eq([s.open[0].id, s.open[0].category, s.open[0].detail], ['a:failed', 'config', 'secret-key-mismatch'], 'issue');
});

test('Gaps are recorded as resolved: a firm stale for 90 min, no sync at all, SYNC_CHAIN off then on', () => {
  let s = step(null, 0, { a: okRes('a') });
  s = step(s, 1, { a: okRes('a') }, { syncChain: 'off' });
  eq(s.syncChain, { value: 'off', offSince: new Date(T0 + 30 * MIN).toISOString() }, 'chain off recorded');
  s = step(s, 4, { a: okRes('a') }, { syncChain: 'on' });   // 90 minutes later
  const kinds = s.resolved.map(r => r.kind).sort();
  eq(kinds, ['chain-off', 'no-sync', 'stale'], 'resolved kinds');
  const stale = s.resolved.find(r => r.kind === 'stale');
  eq([stale.firstSeen, stale.count], [new Date(T0 + 75 * MIN).toISOString(), 3], 'stale since 45 min after the last good sync');
});

test('Resolved history is capped at 50', () => {
  let s = null;
  for (let n = 0; n < 20; n++) s = step(s, n, { a: n % 2 ? okRes('a') : failRes('a', 'ghl', 'server') });
  eq(s.resolved.filter(r => r.id === 'a:failed').length, 10, '10 failures resolved after 20 runs');
  ok(s.resolved.length <= 50, 'never more than 50');
  for (let n = 20; n < 130; n++) s = step(s, n, { a: n % 2 ? okRes('a') : failRes('a', 'ghl', 'server') });
  eq(s.resolved.length, 50, 'capped');
});

const ALLOWED_STATUS_KEYS = new Set(['version', 'updatedAt', 'lastRun', 'at', 'url', 'event', 'chained', 'syncChain', 'value', 'offSince', 'lastAnySuccessAt', 'firms',
  'status', 'lastAttemptAt', 'lastSuccessAt', 'lastRunUrl', 'failStreak', 'open', 'resolved', 'id', 'slug', 'kind', 'category', 'detail', 'area', 'scopes',
  'count', 'reason', 'firstSeen', 'lastSeen', 'runUrl', 'resolvedAt', 'resolvedRunUrl']);
test('Privacy: junk in results and flags never reaches the status file', () => {
  const junk = { token: TOKEN, passphrase: PASS, message: 'GHL said: Invalid JWT for jane@example.com', phone: '+15551234567', contactName: 'Jane Doe' };
  let s = step(null, 0, {
    a: { ...failRes('a', 'scope', 'missing', { scopes: ['calendars.readonly', TOKEN] }), ...junk, detail: 'Jane Doe', area: 'jane@example.com' },
    b: { ...okRes('b'), ...junk },
    c: { ...failRes('c', 'evil', 'x'), ...junk },
  }, { syncFlags: { b: { holds: 1, heldSince: 'Jane Doe', reason: 'Jane Doe called +15551234567', ...junk } }, runUrl: `https://evil.example/${TOKEN}` });
  const text = JSON.stringify(s);
  for (const bad of [TOKEN, PASS, 'Jane', 'jane@', '+1555', 'evil', 'Invalid JWT']) ok(!text.includes(bad), `status file contains "${bad}"`);
  // every key is from the allow-list, except the firm slugs under "firms"
  const walk = o => { if (Array.isArray(o)) return o.forEach(walk); if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { ok(ALLOWED_STATUS_KEYS.has(k) || o === s.firms, `unexpected key "${k}"`); walk(v); } };
  walk(s);
  eq(s.open.find(i => i.slug === 'a').scopes, ['calendars.readonly'], 'only real scope names');
  eq(s.open.find(i => i.slug === 'c').category, 'unknown', 'unknown category');
  eq(cleanResult({ slug: 'x', ok: false, category: 'scope', scopes: ['nope'] }, 'x').category, 'unknown', 'scope with no real scope → unknown');
});

// ---------- part 3: what the admin page shows ----------
const NOW = Date.parse('2026-11-02T12:00:00Z');
const ago = m => new Date(NOW - m * MIN).toISOString();
const firms = [{ slug: 'a', name: 'Firm A' }, { slug: 'b', name: 'Firm B' }];
const fresh = { a: { generatedAt: ago(10), sync: { checkedAt: ago(10) } }, b: { generatedAt: ago(10), sync: { checkedAt: ago(10) } } };
const live = (status, { kpis = fresh, chain = { value: 'on', waiting: true } } = {}) => openIssues(status, { now: NOW, firms, kpis, chain });

test('Everything fine → no issues, every firm OK', () => {
  eq(live(null), [], 'issues'); eq(firmState([], 'a'), 'ok', 'state');
});

test('A firm with no good sync in 45+ min is an issue; not when it already shows as failed', () => {
  const kpis = { ...fresh, a: { generatedAt: ago(50), sync: { checkedAt: ago(50) } } };
  let issues = live(null, { kpis });
  eq(issues.map(i => [i.id, i.count]), [['a:stale', 1]], 'stale');
  const st = step(null, 0, { a: failRes('a', 'token', 'rejected') });
  st.firms.a.lastSuccessAt = ago(50);
  issues = live(st, { kpis });
  eq(issues.map(i => i.id), ['a:failed'], 'failed only');
  eq(firmState(issues, 'a'), 'failed', 'state');
});

test('Nothing synced in 45+ min → one system issue (not one per firm)', () => {
  const kpis = { a: { generatedAt: ago(70) }, b: { generatedAt: ago(95) } };
  const issues = live(null, { kpis });
  eq(issues.map(i => [i.id, i.slug, i.count]), [['system:no-sync', null, 2]], 'system only');
});

test('SYNC_CHAIN off → "chain off" (and not also "chain stopped")', () => {
  const st = step(null, 0, { a: okRes('a') }, { syncChain: 'off' });
  const issues = live(st, { chain: { value: 'off', waiting: false } });
  eq(issues.map(i => i.id), ['system:chain-off'], 'issues');
  eq(issues[0].firstSeen, st.syncChain.offSince, 'since');
});

test('Chain on but no waiting link → "chain stopped"; unknown → no issue', () => {
  eq(live(null, { chain: { value: 'on', waiting: false, lastLinkAt: ago(40), lastLinkUrl: RUN(9) } }).map(i => [i.id, i.runUrl]), [['system:no-link', RUN(9)]], 'stopped');
  eq(live(null, { chain: { value: 'on', waiting: null } }), [], 'unknown');
});

test('Held / incomplete fall back to kpis.json before the status file knows them', () => {
  const kpis = { ...fresh, a: { generatedAt: ago(40), sync: { checkedAt: ago(5), holds: 2, heldSince: ago(40), reason: 'Call 63 → 16' } }, b: { generatedAt: ago(5), sync: { checkedAt: ago(5), incomplete: true, incompleteSince: ago(20) } } };
  const issues = live(null, { kpis });
  eq(issues.map(i => i.id).sort(), ['a:held', 'b:incomplete'], 'issues');
  eq(firmState(issues, 'a'), 'held', 'state');
});

test('A hold is a notice (not in the badge); the published "may be incomplete" note counts', () => {
  eq(['held', 'incomplete', 'failed', 'stale', 'chain-off', 'no-link', 'no-sync'].map(kind => inBadge({ kind })), [false, true, true, true, true, true, true], 'inBadge');
});

test('System issues come first, then newest first; "Mark as seen" key changes on a new occurrence', () => {
  let st = step(null, 0, { a: failRes('a', 'ghl', 'server') });
  st = step(st, 1, { b: failRes('b', 'token', 'rejected') });
  const issues = openIssues(st, { now: T0 + 60 * MIN, firms, kpis: {}, chain: { value: 'off' } });
  eq(issues.map(i => i.id), ['system:chain-off', 'b:failed', 'a:failed'], 'order');
  const k1 = seenKey(issues[2]);
  st = step(st, 2, { a: okRes('a') }); st = step(st, 3, { a: failRes('a', 'ghl', 'server') });
  const again = openIssues(st, { now: T0 + 120 * MIN, firms, kpis: {}, chain: { value: 'on', waiting: true } }).find(i => i.id === 'a:failed');
  ok(seenKey(again) !== k1, 'new occurrence, new key');
});

test('Every issue type has a title, an explanation, steps and the right buttons', () => {
  const cases = [
    [{ kind: 'failed', category: 'token', detail: 'rejected' }, ['ghl', 'token', 'resync', 'run', 'firm'], /token rejected/i],
    [{ kind: 'failed', category: 'token', detail: 'missing-secret' }, ['ghl', 'token', 'run', 'firm'], /not set/],
    [{ kind: 'failed', category: 'scope', detail: 'missing', scopes: ['calendars.readonly', 'users.readonly'] }, ['ghl', 'resync', 'run', 'firm'], /View Calendars and View Users/],
    [{ kind: 'failed', category: 'ghl', detail: 'server', area: 'opportunities' }, ['resync', 'run', 'firm'], /server or network/],
    [{ kind: 'failed', category: 'config', detail: 'no-location' }, ['run', 'resync', 'firm'], /config/],
    [{ kind: 'failed', category: 'unknown', detail: 'crash' }, ['run', 'resync', 'firm'], /unknown/],
    [{ kind: 'held', count: 2 }, ['resync', 'run', 'firm'], /Holding/],
    [{ kind: 'incomplete' }, ['resync', 'run', 'firm'], /may be incomplete/],
    [{ kind: 'stale', lastGood: ago(50) }, ['resync', 'run', 'firm'], /50 min/],
    [{ kind: 'chain-off' }, ['variables', 'restart'], /SYNC_CHAIN = off/],
    [{ kind: 'no-link' }, ['restart', 'run'], /stopped/],
    [{ kind: 'no-sync', lastGood: ago(70) }, ['sync-all', 'restart', 'run'], /70 min/],
  ];
  for (const [i, actions, title] of cases) {
    const d = describeIssue({ slug: 'a', ...i }, { now: NOW, subAccount: 'Sub One', secretKey: 'A', lastGood: ago(50) });
    ok(title.test(d.title), `${i.kind}/${i.category}: title "${d.title}"`);
    ok(d.what.length > 40 && d.steps.length >= 2, `${i.kind}/${i.category}: explanation and steps`);
    eq(d.actions, actions, `${i.kind}/${i.category} buttons`);
  }
  const scope = describeIssue({ kind: 'failed', category: 'scope', scopes: ['calendars.readonly'] }, { subAccount: 'Sub One' });
  ok(scope.steps.join(' ').includes('tick <b>View Calendars</b>') && scope.steps[0].includes('Sub One'), 'scope steps name the scope and sub-account');
  eq(Object.keys(CATEGORIES), ['token', 'scope', 'ghl', 'config', 'unknown'], 'categories');
  eq(Object.keys(SCOPE_NAMES).length, 9, 'nine scopes');
});

// ---------- run ----------
const results = [];
for (const t of tests) {
  if (only && !t.name.toLowerCase().includes(only.toLowerCase())) continue;
  const tmp = t.repo ? await makeRepo() : null;
  const t0 = Date.now();
  try { await t.fn(tmp); results.push({ name: t.name, pass: true, ms: Date.now() - t0 }); }
  catch (e) { results.push({ name: t.name, pass: false, error: e.message, ms: Date.now() - t0 }); }
  finally { if (tmp) await rm(tmp, { recursive: true, force: true }); }
}
console.log('\nSync status tests\n');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${(r.ms / 1000).toFixed(1)} s)${r.error ? `\n      ${r.error}` : ''}`);
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed} of ${results.length} tests pass.`);
process.exit(failed ? 1 : 0);
