// Sync chain tests.   Run:  node tests/chain/run.mjs   (Node 20+, no dependencies)
// Checks the slot maths, the "already covered" rule, the script against a mock GitHub API, and
// that the workflows keep the guardrails (who chains, concurrency, SYNC_CHAIN, backup cron).

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { nextSlot, coveredBy } from '../../scripts/sync-chain.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const T = s => Date.parse(`2026-11-02T${s}:00Z`);
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, what) => { if (!v) throw new Error(what); };
const iso = t => new Date(t).toISOString();

test('Next slot is the next :07 or :37, at least 2 minutes away', () => {
  eq(iso(nextSlot(T('07:10'))), iso(T('07:37')), 'after :07');
  eq(iso(nextSlot(T('07:36'))), iso(T('08:07')), '1 min before :37 → next one');
  eq(iso(nextSlot(T('07:34'))), iso(T('07:37')), '3 min before :37');
  eq(iso(nextSlot(T('07:50'))), iso(T('08:07')), 'after :37');
  eq(iso(nextSlot(Date.parse('2026-11-02T23:55:00Z'))), '2026-11-03T00:07:00.000Z', 'across midnight');
});

test('A scheduled or chained run near the slot covers it; admin and manual runs do not', () => {
  const slot = T('07:37');
  eq(coveredBy([{ event: 'schedule', created_at: iso(T('07:39')) }], slot)?.event, 'schedule', 'late cron');
  eq(coveredBy([{ event: 'workflow_dispatch', display_title: 'Sync all firms (chain)', created_at: iso(T('07:37')) }], slot)?.event, 'workflow_dispatch', 'chained');
  eq(coveredBy([{ event: 'workflow_dispatch', display_title: 'Sync mahdavi', created_at: iso(T('07:38')) }], slot), null, 'admin Re-sync');
  eq(coveredBy([{ event: 'workflow_dispatch', display_title: 'Sync all firms', created_at: iso(T('07:38')) }], slot), null, 'manual run');
  eq(coveredBy([{ event: 'schedule', created_at: iso(T('07:07')) }], slot), null, 'the previous slot\'s run');
});

// The script against a mock GitHub API (CHAIN_NO_WAIT: no sleeping).
async function script(runs, env = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', d => { body += d; });
    req.on('end', () => {
      calls.push({ method: req.method, path: req.url, body: body ? JSON.parse(body) : null, auth: req.headers.authorization });
      if (req.method === 'GET') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ workflow_runs: runs })); }
      res.writeHead(204); res.end();
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const { stdout } = await run(process.execPath, [join(ROOT, 'scripts/sync-chain.mjs')], { env: { PATH: process.env.PATH, GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`, GITHUB_REPOSITORY: 'o/r', GITHUB_TOKEN: 'test', GITHUB_REF_NAME: 'main', CHAIN_NO_WAIT: '1', ...env } });
    return { out: stdout, calls };
  } finally { server.close(); }
}

test('Starts "Sync all firms (chain)" when nothing covers the slot', async () => {
  const r = await script([]);
  const post = r.calls.find(c => c.method === 'POST');
  ok(post, 'dispatched'); eq(post.path, '/repos/o/r/actions/workflows/sync.yml/dispatches', 'path'); eq(post.body, { ref: 'main', inputs: { chain: 'yes' } }, 'body');
  ok(/created=%3E%3D/.test(r.calls[0].path), 'asks only for recent runs');
  const posts = r.calls.filter(c => c.method === 'POST').map(c => c.path);
  eq(posts, ['/repos/o/r/actions/workflows/sync.yml/dispatches', '/repos/o/r/actions/workflows/tokens.yml/dispatches'], 'sync first, then the token keeper');
});

test('Skips the sync when a scheduled run already started for the slot (still starts the token keeper)', async () => {
  const r = await script([{ event: 'schedule', created_at: iso(nextSlot(Date.now()) + 60e3) }]);   // the cron fired a minute late
  ok(!r.calls.some(c => c.method === 'POST' && /sync\.yml/.test(c.path)), 'no sync dispatch'); ok(/continues the chain/.test(r.out), 'logged');
  ok(r.calls.some(c => c.method === 'POST' && /tokens\.yml/.test(c.path)), 'keeper started');
});

test('SYNC_CHAIN=off stops the chain without calling GitHub', async () => {
  const r = await script([], { SYNC_CHAIN: 'off' });
  eq(r.calls.length, 0, 'GitHub calls'); ok(/SYNC_CHAIN is off/.test(r.out), 'logged');
});

test('Workflows keep the guardrails', async () => {
  const sync = await readFile(join(ROOT, '.github/workflows/sync.yml'), 'utf8');
  const chain = await readFile(join(ROOT, '.github/workflows/sync-chain.yml'), 'utf8');
  ok(/cron: "7,37 \* \* \* \*"/.test(sync), 'backup cron 7,37');
  ok(/concurrency:\s*\n\s*group: sync\s*\n\s*cancel-in-progress: false/.test(sync), 'syncs never run twice at once');
  const cond = sync.match(/\n  chain:[\s\S]*?\n    if: (.*)/)?.[1] || '';
  ok(/github\.event_name == 'schedule'/.test(cond) && /inputs\.chain == 'yes'/.test(cond) && /vars\.SYNC_CHAIN != 'off'/.test(cond) && !/workflow_dispatch/.test(cond), 'only scheduled and chained runs chain, and SYNC_CHAIN=off stops it');
  ok(/needs: commit/.test(sync.split('\n  chain:')[1] || ''), 'chains after the commit');
  ok(/run-name: .*inputs\.chain == 'yes' && ' \(chain\)'/.test(sync), 'chained runs are titled "(chain)"');
  ok(/concurrency:\s*\n\s*group: sync-chain\s*\n\s*cancel-in-progress: true/.test(chain), 'one waiting link at a time');
  ok(/if: vars\.SYNC_CHAIN != 'off'/.test(chain), 'chain workflow obeys SYNC_CHAIN');
  ok(!/schedule:/.test(chain) && /workflow_dispatch:/.test(chain), 'chain workflow only starts on dispatch');
});

// GitHub skips a job whose needs failed unless its `if` uses a status function. !cancelled()
// runs it after a failure; success() (the default) would not. So a failed firm (or a failed
// commit) must still reach the commit job and the chain job.
test('A failed sync still commits the other firms, updates the status and starts the next link', async () => {
  const sync = await readFile(join(ROOT, '.github/workflows/sync.yml'), 'utf8');
  const job = name => sync.split(`\n  ${name}:`)[1]?.split(/\n  [a-z]+:\n/)[0] || '';
  const ifOf = name => job(name).match(/\n    if: (.*)/)?.[1] || '';
  ok(/fail-fast: false/.test(job('sync')), 'matrix: one firm failing never cancels the others');
  ok(/!cancelled\(\)/.test(ifOf('commit')) && !/success\(\)|needs\.sync\.result/.test(ifOf('commit')), 'commit runs after a failed firm job');
  ok(/!cancelled\(\)/.test(ifOf('chain')) && !/success\(\)|needs\.commit\.result|needs\.sync\.result/.test(ifOf('chain')), 'chain runs after a failed sync or commit');
  ok(/needs: commit/.test(job('chain')), 'chain waits for the commit');
  ok(/name: Upload sync result\s*\n\s*if: \$\{\{ !cancelled\(\) \}\}/.test(job('sync')), 'a failed firm still uploads its result');
  ok(/node scripts\/update-status\.mjs/.test(job('commit')), 'commit job updates status/sync-status.json');
  ok(/git add -A firms status/.test(job('commit')), 'status file is committed');
  ok(/name: "Sync · \$\{\{ matrix\.firm\.name/.test(job('sync')), 'per-firm jobs are named "Sync · <firm name>"');
});

const results = [];
for (const t of tests) { try { await t.fn(); results.push({ name: t.name, pass: true }); } catch (e) { results.push({ name: t.name, pass: false, error: e.message }); } }
console.log('\nSync chain tests\n');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.error ? `\n      ${r.error}` : ''}`);
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed} of ${results.length} tests pass.`);
process.exit(failed ? 1 : 0);
