// Slack DM alert tests (v1.22.0).   Run:  node tests/alerts/run.mjs   (Node 20+, no dependencies)
//
// 1. scripts/slack.mjs: missing / bad webhook, Slack down (retry once), wrong webhook (no retry), timeout; never throws,
//    never logs the webhook URL.
// 2. scripts/kpi-alerts.mjs: the same issues as the admin bell (same functions, held = notice only); one DM when an issue
//    starts, never again while open, ONE "Resolved" DM when it clears; failed DMs are retried next time; exact text.
// 3. scripts/setup-alert.mjs: "step N of 9" = the Builder page's numbering (compares with the builder clone if present).
// 4. End to end: the real script in a temp copy against a mock Slack webhook and a mock GitHub API, run 4 times.
// Writes nothing in the repo.

import { readFile, writeFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { postSlack, slackEscape, excerpt, WEBHOOK_RE } from '../../scripts/slack.mjs';
import { bellIssues, plan, run as runAlerts, startText, resolvedText, emptyState, ADMIN_URL } from '../../scripts/kpi-alerts.mjs';
import { setupFailedText, KPI_STEPS, JOB_STEP } from '../../scripts/setup-alert.mjs';
import { updateStatus } from '../../scripts/sync-status.mjs';

const exec = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MIN = 60e3, T0 = Date.parse('2026-11-18T01:07:00Z');
const HOOK = 'https://hooks.slack.com/services/T0TEST/B0TEST/notARealSecret123';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m || 'not equal'}\n  got:  ${JSON.stringify(a)}\n  want: ${JSON.stringify(b)}`); };
const ok = (v, m) => { if (!v) throw new Error(m || 'expected true'); };

const fakeFetch = answers => { const calls = []; const f = async (url, o) => { calls.push({ url, o }); const a = answers.shift() ?? 200; if (a instanceof Error) throw a; return { ok: a >= 200 && a < 300, status: a }; }; f.calls = calls; return f; };
const logs = () => { const l = []; const f = s => l.push(String(s)); f.lines = l; return f; };

// ---------- 1. slack.mjs ----------
test('missing webhook: not sent, no request, never throws', async () => {
  const f = fakeFetch([]), log = logs();
  eq(await postSlack('hi', { env: {}, fetchImpl: f, log }), { ok: false, reason: 'missing' });
  eq(f.calls.length, 0); eq(log.lines, ['Slack: not sent (SLACK_WEBHOOK_URL is not set)']);
});
test('a value that is not a Slack webhook is refused (nothing sent there)', async () => {
  const f = fakeFetch([]);
  eq((await postSlack('hi', { env: { SLACK_WEBHOOK_URL: 'https://evil.example.com/hook' }, fetchImpl: f, log: () => {} })).reason, 'bad-url');
  eq(f.calls.length, 0);
  ok(WEBHOOK_RE.test(HOOK)); ok(!WEBHOOK_RE.test('http://hooks.slack.com/services/x/y/z'));
});
test('sent: one POST, JSON text, no unfurls; log never shows the URL', async () => {
  const f = fakeFetch([200]), log = logs();
  eq(await postSlack('hello', { env: { SLACK_WEBHOOK_URL: HOOK }, fetchImpl: f, log }), { ok: true });
  eq(f.calls.length, 1); eq(JSON.parse(f.calls[0].o.body), { text: 'hello', unfurl_links: false, unfurl_media: false });
  ok(!log.lines.join('\n').includes('hooks.slack.com') && !log.lines.join('\n').includes('notARealSecret'));
});
test('Slack down (500, then network error): tried twice, returns not sent, never throws', async () => {
  const f = fakeFetch([500, new TypeError('fetch failed')]), log = logs();
  eq(await postSlack('x', { env: { SLACK_WEBHOOK_URL: HOOK }, fetchImpl: f, log, waitMs: 1 }), { ok: false, reason: 'failed' });
  eq(f.calls.length, 2); eq(log.lines, ['Slack: not sent (HTTP 500)', 'Slack: not sent (network error)']);
});
test('revoked webhook (404): not retried', async () => {
  const f = fakeFetch([404]);
  eq(await postSlack('x', { env: { SLACK_WEBHOOK_URL: HOOK }, fetchImpl: f, log: () => {}, waitMs: 1 }), { ok: false, reason: 'http-404' });
  eq(f.calls.length, 1);
});
test('timeout: aborted, logged as timed out', async () => {
  const log = logs();
  const hang = (url, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  eq((await postSlack('x', { env: { SLACK_WEBHOOK_URL: HOOK }, fetchImpl: hang, log, timeoutMs: 20, tries: 1 })).ok, false);
  eq(log.lines, ['Slack: not sent (timed out)']);
});
test('escaping and excerpts', () => {
  eq(slackEscape('A & B <!channel> >'), 'A &amp; B &lt;!channel&gt; &gt;');
  eq(excerpt('  one\n two  '), 'one two');
  const long = excerpt('x'.repeat(300)); eq(long.length, 200); ok(long.endsWith('…'));
});
test('the builder copy of slack.mjs is byte-identical (if the clone is next to this repo)', async () => {
  const p = join(ROOT, '../ghl-subaccount-builder/scripts/lib/slack.mjs');
  if (!existsSync(p)) return 'skipped (no builder clone)';
  eq(await readFile(p, 'utf8'), await readFile(join(ROOT, 'scripts/slack.mjs'), 'utf8'), 'scripts/slack.mjs differs from the builder copy');
});

// ---------- 2. kpi-alerts.mjs ----------
const FIRMS = [{ slug: 'mahdavi', secretKey: 'MAHDAVI', name: 'The Mahdavi Law Firm' }, { slug: 'zz-test-2', secretKey: 'ZZ_TEST_2', name: 'ZZ TEST 2', tokenSource: 'app' }];
const keeperOk = now => ({ version: 1, lastRunAt: new Date(now).toISOString(), lastOkAt: new Date(now).toISOString(), problem: null, firms: {} });
const chainOn = { value: 'on', waiting: true };
const statusAt = (n, results, more) => updateStatus(null, { now: T0 + n * 30 * MIN, runUrl: 'https://github.com/peejayedz/leadpro-kpi/actions/runs/1', event: 'schedule', chained: true, attempted: Object.keys(results), results, ...more });
const bad = slug => ({ slug, ok: false, category: 'token', detail: 'rejected' });
const good = slug => ({ slug, ok: true });
const issuesAt = (now, status, extra = {}) => bellIssues({ status, keeper: keeperOk(now), firms: FIRMS, configs: {}, kpis: {}, chain: chainOn, now, ...extra });

test('the alert list is the admin bell\'s list (same functions, same filter)', async () => {
  // v1.29.1 moved the bell's list into admin/greet-count.mjs buildIssues() (index.html calls it); the alerts must be that
  // list with the badge filter (+ "stages not mapped", which is DMed too). Checked by behaviour, not by source text.
  const html = await readFile(join(ROOT, 'admin/index.html'), 'utf8');
  ok(/issues = GC\.buildIssues\(\{ keeperStatus, syncStatus, chain: chainInfo, firms, configs, kpis, now: Date\.now\(\) \}\)/.test(html), 'admin bell no longer uses greet-count.mjs buildIssues(): update scripts/kpi-alerts.mjs bellIssues()');
  ok(html.includes('const listed = () => issues.filter(inBadge);'), 'admin bell badge filter changed: update bellIssues()');
  ok(html.includes('const kpiSummary = GC.kpiSummary;'), 'admin kpiSummary no longer greet-count.mjs: update kpi-alerts kpiSummary()');
  const GC = await import('../../admin/greet-count.mjs');
  const { inBadge } = await import('../../scripts/sync-status.mjs');
  const now = T0 + 5 * 30 * MIN;
  const st = statusAt(1, { [FIRMS[0].slug]: bad(FIRMS[0].slug), [FIRMS[1].slug]: good(FIRMS[1].slug) });
  for (const args of [{ status: st, keeper: keeperOk(now), firms: FIRMS, configs: {}, kpis: {}, chain: chainOn, now }, { status: st, keeper: keeperOk(now), firms: FIRMS, configs: {}, kpis: {}, chain: { value: 'off' }, now }]) {
    const mine = bellIssues(args).map(i => `${i.kind}:${i.slug || ''}`);
    const bell = GC.buildIssues({ keeperStatus: args.keeper, syncStatus: args.status, chain: args.chain, firms: args.firms, configs: args.configs, kpis: args.kpis, now: args.now }).filter(i => inBadge(i) || i.kind === 'unmapped').map(i => `${i.kind}:${i.slug || ''}`);
    ok(JSON.stringify(mine) === JSON.stringify(bell), `alerts = the bell's listed issues (${mine.join(', ')} vs ${bell.join(', ')})`);
  }
});

test('held numbers are a bell notice only: no DM; "may be incomplete" is a DM', () => {
  const st = updateStatus(null, { now: T0, attempted: ['mahdavi'], results: { mahdavi: good('mahdavi') }, syncFlags: { mahdavi: { holds: 1, heldSince: new Date(T0).toISOString(), reason: 'Call 63 → 16' } } });
  eq(issuesAt(T0, st).map(i => i.kind), []);
  const st2 = updateStatus(null, { now: T0, attempted: ['mahdavi'], results: { mahdavi: good('mahdavi') }, syncFlags: { mahdavi: { incomplete: true, incompleteSince: new Date(T0).toISOString(), reason: 'Call 63 → 16' } } });
  eq(issuesAt(T0, st2).map(i => i.id), ['mahdavi:incomplete']);
});

test('start → no repeats while open → ONE Resolved → nothing more (exact text)', async () => {
  const sent = [], send = async t => { sent.push(t); return { ok: true }; };
  const s1 = statusAt(0, { mahdavi: bad('mahdavi'), 'zz-test-2': good('zz-test-2') });
  const r1 = await runAlerts({ prev: null, issues: issuesAt(T0, s1), firms: FIRMS, now: T0, send, log: () => {} });
  eq(sent, [[
    '*KPI sync problem: The Mahdavi Law Firm*',
  ].map(x => `:rotating_light: ${x}`).concat(['GHL token rejected. The admin bell shows the fix.',`<${ADMIN_URL}|Open KPI admin →>`]).join('\n')]);
  ok(r1.changed); eq(Object.keys(r1.state.open), ['mahdavi:failed']);
  // next 3 checks, still failing: no DM
  let prev = r1.state, st = s1;
  for (let n = 1; n <= 3; n++) {
    st = updateStatus(st, { now: T0 + n * 30 * MIN, attempted: ['mahdavi', 'zz-test-2'], results: { mahdavi: bad('mahdavi'), 'zz-test-2': good('zz-test-2') } });
    const r = await runAlerts({ prev, issues: issuesAt(T0 + n * 30 * MIN, st), firms: FIRMS, now: T0 + n * 30 * MIN, send, log: () => {} });
    eq(sent.length, 1, `repeat on check ${n}`); ok(!r.changed); prev = r.state;
  }
  // it clears
  st = updateStatus(st, { now: T0 + 4 * 30 * MIN, attempted: ['mahdavi', 'zz-test-2'], results: { mahdavi: good('mahdavi'), 'zz-test-2': good('zz-test-2') } });
  const r5 = await runAlerts({ prev, issues: issuesAt(T0 + 120 * MIN, st), firms: FIRMS, now: T0 + 120 * MIN, send, log: () => {} });
  eq(sent.length, 2);
  eq(sent[1], ':white_check_mark: *Resolved: The Mahdavi Law Firm*\nGHL token rejected: cleared after 2 h.');
  eq(r5.state.open, {});
  const r6 = await runAlerts({ prev: r5.state, issues: issuesAt(T0 + 150 * MIN, st), firms: FIRMS, now: T0 + 150 * MIN, send, log: () => {} });
  eq(sent.length, 2, 'Resolved sent twice'); ok(!r6.changed);
});

test('missing webhook / Slack down: nothing recorded, nothing thrown; sent once it works', async () => {
  const s1 = statusAt(0, { mahdavi: bad('mahdavi') });
  const down = async () => ({ ok: false, reason: 'missing' });
  const r1 = await runAlerts({ prev: null, issues: issuesAt(T0, s1), firms: FIRMS, now: T0, send: down, log: () => {} });
  eq(r1.state.open, {}); ok(!r1.changed);
  const sent = [];
  const r2 = await runAlerts({ prev: r1.state, issues: issuesAt(T0 + MIN, s1), firms: FIRMS, now: T0 + MIN, send: async t => { sent.push(t); return { ok: true }; }, log: () => {} });
  eq(sent.length, 1); eq(Object.keys(r2.state.open), ['mahdavi:failed']);
  // a Resolved DM that fails is kept and tried again (never lost, never doubled)
  const r3 = await runAlerts({ prev: r2.state, issues: [], firms: FIRMS, now: T0 + 2 * MIN, send: down, log: () => {} });
  eq(Object.keys(r3.state.open), ['mahdavi:failed']);
  const r4 = await runAlerts({ prev: r3.state, issues: [], firms: FIRMS, now: T0 + 3 * MIN, send: async t => { sent.push(t); return { ok: true }; }, log: () => {} });
  eq(sent.length, 2); ok(sent[1].startsWith(':white_check_mark: *Resolved: The Mahdavi Law Firm*')); eq(r4.state.open, {});
});

test('system issues: chain stopped; an unknown chain check neither starts nor resolves it', async () => {
  const st = statusAt(0, { mahdavi: good('mahdavi'), 'zz-test-2': good('zz-test-2') });
  const iss = issuesAt(T0, st, { chain: { value: 'on', waiting: false, lastLinkAt: new Date(T0 - 40 * MIN).toISOString() } });
  eq(iss.map(i => i.id), ['system:no-link']);
  eq(startText(iss[0], { firms: FIRMS, now: T0 }), `:rotating_light: *KPI sync problem: All firms*\nSync chain has stopped. The admin bell shows the fix.\n<${ADMIN_URL}|Open KPI admin →>`);
  eq(plan(null, iss, { firms: FIRMS, chainKnown: false }).starts, []);
  const prev = { version: 1, open: { 'system:no-link': { kind: 'no-link', slug: null, name: 'All firms', title: 'Sync chain has stopped', firstSeen: 'x', sentAt: new Date(T0).toISOString() } } };
  const p = plan(prev, [], { firms: FIRMS, chainKnown: false });
  eq(p.resolves, []); eq(Object.keys(p.keep), ['system:no-link']);
  eq(plan(prev, [], { firms: FIRMS, chainKnown: true }).resolves.map(r => r.id), ['system:no-link']);
});

test('keeper and mapping issues come through like the bell; a deleted firm is dropped quietly', () => {
  const st = statusAt(0, { mahdavi: good('mahdavi'), 'zz-test-2': good('zz-test-2') });
  const keeper = { ...keeperOk(T0), problem: { category: 'reconnect', detail: 'refresh-rejected', since: new Date(T0).toISOString() } };
  const iss = bellIssues({ status: st, keeper, firms: FIRMS, configs: { 'zz-test-2': { mappingReview: { reason: 'unknown-snapshot', at: new Date(T0).toISOString() } } }, kpis: {}, chain: chainOn, now: T0 });
  eq(iss.map(i => i.id).sort(), ['system:keeper-reconnect', 'zz-test-2:mapping-review']);
  const prev = { version: 1, open: { 'gone:failed': { kind: 'failed', slug: 'gone', name: 'Gone Firm', title: 'x', sentAt: 'y' } } };
  eq(plan(prev, [], { firms: FIRMS }).resolves, []);
});

test('Resolved text with a duration; firm names are escaped', () => {
  eq(resolvedText({ name: 'A & B <Law>', title: 'Sync failed (unknown error)', sentAt: new Date(T0).toISOString() }, { now: T0 + 95 * MIN }),
    ':white_check_mark: *Resolved: A &amp; B &lt;Law&gt;*\nSync failed (unknown error): cleared after 1 h 35 min.');
});

// ---------- 3. setup-alert.mjs ----------
const jobs = (failName, conclusion = 'failure') => ['prepare', 'token', 'setup', 'first-sync', 'menu-link'].map(n => ({ name: n, conclusion: n === failName ? conclusion : (['prepare', 'token', 'setup', 'first-sync', 'menu-link'].indexOf(n) < ['prepare', 'token', 'setup', 'first-sync', 'menu-link'].indexOf(failName) ? 'success' : 'skipped') }));
test('KPI setup failed at the first sync: exact DM, Builder step numbering', () => {
  eq(setupFailedText({ name: 'Acme Law', location: 'Po7mOmrwAAslMJZAwIeA', jobs: jobs('first-sync') }),
    ':warning: *Builder needs you: Acme Law*\nKPI dashboard setup failed at step 7 of 9 (First sync).\nNothing is lost — Retry in the Builder.\n<https://lfmp-admin.pages.dev/ghl-subaccount-builder-page/?client=Po7mOmrwAAslMJZAwIeA|Open Acme Law in the Builder →>');
  ok(setupFailedText({ name: 'X', location: 'Po7mOmrwAAslMJZAwIeA', jobs: jobs('prepare', 'cancelled') }).includes('was stopped by GitHub at step 4 of 9 (Waiting for the LeadPro Connector app).'));
  ok(setupFailedText({ name: 'X', location: 'Po7mOmrwAAslMJZAwIeA', jobs: jobs('setup') }).includes('step 6 of 9 (Reading GHL and setting up the dashboard)'));
  const noJobs = setupFailedText({ name: 'X', location: 'bad id!', jobs: [] });
  ok(noJobs.includes('KPI dashboard setup failed.') && noJobs.includes('<https://lfmp-admin.pages.dev/ghl-subaccount-builder-page/|Open X in the Builder →>'));
});
test('the steps match the Builder page (page/kpi.js), if the builder clone is present', async () => {
  const p = join(ROOT, '../ghl-subaccount-builder/page/kpi.js');
  if (!existsSync(p)) return 'skipped (no builder clone)';
  const src = await readFile(p, 'utf8');
  const keys = [...src.match(/export const KPI_STEPS = \[([\s\S]*?)\n\];/)[1].matchAll(/\['(\w+)', '((?:[^'\\]|\\.)*)'/g)].map(m => [m[1], m[2].replace(/\\'/g, "'")]);
  eq(KPI_STEPS, keys, 'KPI_STEPS differ from the Builder');
  eq(JSON.stringify(JOB_STEP), JSON.stringify(Function(`return ${src.match(/const JOB_STEP = (\{[^}]*\})/)[1]}`)()), 'JOB_STEP differs from the Builder');
});
test('new-firm.yml: the alert job runs only after a failure or cancel, and the Builder ignores it', async () => {
  const y = await readFile(join(ROOT, '.github/workflows/new-firm.yml'), 'utf8');
  ok(/\n  alert:\n    needs: \[prepare, token, setup, first-sync, menu-link\]\n    if: \$\{\{ failure\(\) \|\| cancelled\(\) \}\}/.test(y));
  ok(!Object.keys(JOB_STEP).includes('alert'));
  ok(/continue-on-error: true\n        env:\n          SLACK_WEBHOOK_URL: \$\{\{ secrets\.SLACK_WEBHOOK_URL \}\}/.test(y));
  const s = await readFile(join(ROOT, '.github/workflows/sync.yml'), 'utf8');
  ok(/\n  alerts:\n    needs: commit\n    if: \$\{\{ always\(\) \}\}[\s\S]*continue-on-error: true[\s\S]*gh workflow run alerts\.yml/.test(s), 'sync.yml must start alerts.yml without risking the sync');
});

// ---------- 4. end to end ----------
async function mockServer() {
  const hooks = [];
  let runs = { links: [{ status: 'queued', updated_at: new Date().toISOString(), html_url: 'https://github.com/x/y/actions/runs/9' }], syncs: [] };
  const srv = createServer((req, res) => {
    let body = ''; req.on('data', c => { body += c; });
    req.on('end', () => {
      if (req.url === '/hook') { hooks.push(JSON.parse(body)); res.writeHead(200); return res.end('ok'); }
      if (req.url.includes('/sync-chain.yml/runs')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ workflow_runs: runs.links })); }
      if (req.url.includes('/sync.yml/runs')) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ workflow_runs: runs.syncs })); }
      res.writeHead(404); res.end();
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}`, hooks, close: () => srv.close() };
}
test('end to end: real script, mock Slack + GitHub: alert once, no repeat, Resolved once; missing webhook exits 0', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kpi-alerts-'));
  const m = await mockServer();
  try {
    await cp(join(ROOT, 'scripts'), join(dir, 'scripts'), { recursive: true });
    await mkdir(join(dir, 'firms/mahdavi/data'), { recursive: true }); await mkdir(join(dir, 'status'), { recursive: true });
    await writeFile(join(dir, 'firms/index.json'), JSON.stringify([FIRMS[0]]));
    await writeFile(join(dir, 'firms/mahdavi/config.json'), '{}');
    const now = Date.now();
    const write = async res => writeFile(join(dir, 'status/sync-status.json'), JSON.stringify(updateStatus(null, { now, attempted: ['mahdavi'], results: { mahdavi: res } })));
    const go = async (env = {}) => exec(process.execPath, [join(dir, 'scripts/kpi-alerts.mjs')], { env: { PATH: process.env.PATH, GITHUB_API: m.url, GH_TOKEN: 'gh-test-token', GITHUB_REPOSITORY: 'peejayedz/leadpro-kpi', SLACK_WEBHOOK_URL: `${m.url}/hook`, SLACK_ALLOW_TEST_URL: '1', ...env } });
    await write(bad('mahdavi'));
    const a = await go({ SLACK_WEBHOOK_URL: '' });                 // no webhook yet: nothing sent, exit 0, nothing saved
    eq(m.hooks.length, 0); ok(!existsSync(join(dir, 'status/alerts.json'))); ok(a.stdout.includes('SLACK_WEBHOOK_URL is not set'));
    const b = await go();                                          // alert
    eq(m.hooks.length, 1); ok(m.hooks[0].text.startsWith(':rotating_light: *KPI sync problem: The Mahdavi Law Firm*\nGHL token rejected.'));
    await go();                                                    // still open: no repeat
    eq(m.hooks.length, 1);
    await write(good('mahdavi'));
    await go(); await go();                                        // cleared: Resolved exactly once
    eq(m.hooks.length, 2); ok(m.hooks[1].text.startsWith(':white_check_mark: *Resolved: The Mahdavi Law Firm*'));
    const saved = await readFile(join(dir, 'status/alerts.json'), 'utf8');
    eq(JSON.parse(saved).open, {});
    const out = a.stdout + b.stdout + saved;
    for (const secret of ['gh-test-token', '/hook', 'hooks.slack.com', 'notARealSecret']) ok(!out.includes(secret), `"${secret}" leaked into the log or alerts.json`);
    const t = await go({ SLACK_TEST: 'yes' });                     // the test DM
    eq(m.hooks.length, 3); ok(m.hooks[2].text.startsWith(':white_check_mark: *Test alert from LeadPro KPI*')); ok(t.stdout.includes('Slack: sent'));
  } finally { m.close(); await rm(dir, { recursive: true, force: true }); }
});

// ---------- runner ----------
let pass = 0, fail = 0;
for (const t of tests) {
  try { const r = await t.fn(); pass++; console.log(`✓ ${t.name}${typeof r === 'string' ? ` (${r})` : ''}`); }
  catch (e) { fail++; console.log(`✗ ${t.name}\n  ${e.stack || e.message}`); }
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
