// Proves the slim-message sync (scripts/message-slim.mjs, v1.21.0) publishes exactly what the previous sync did, on a
// real firm's real GHL data. Runs only in GitHub Actions, where the firm's token is: the workflow (verify-slim.yml) lived
// only on the temporary branch verify/slim-messages (commit 17097ee; get it with `git show 17097ee:.github/workflows/verify-slim.yml`),
// pushed to a verify/* branch to run. Result 17 Nov 2026: LFMP and Mahdavi IDENTICAL (kpis.json, details, sync result);
// LFMP peak memory 1,652 MB → 449 MB. Reuse it for any change that should not move the numbers.
//
//   GHL_TOKEN=… DASHBOARD_PASSPHRASE=… OLD_REF=origin/main node tests/slim-verify/run.mjs <slug>
//
// 1. Two temp copies of this checkout: OLD = scripts/sync.mjs from OLD_REF (the production version), NEW = this one.
// 2. OLD runs against GHL through a local proxy that RECORDS every response (to disk), at a frozen clock.
// 3. NEW runs against the same proxy in REPLAY mode: the same requests get the same responses, in the same order, at the
//    same frozen clock. GHL is queried once; its export gives a different subset on every pull, so this is the only fair
//    comparison.
// 4. Compares kpis.json, the decrypted details.enc.json and the sync result file, field by field.
// Prints only: identical yes/no, how many fields differ and in which top-level sections, request counts, peak memory and
// time. Never a value, a message, a contact or the token. Writes nothing in the repo and commits nothing.

import { createServer } from 'node:http';
import { mkdtemp, mkdir, cp, rm, readFile, writeFile } from 'node:fs/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decryptJSON } from '../../scripts/kpi-core.mjs';

const exec = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SLUG = process.argv[2];
const OLD_REF = process.env.OLD_REF || 'origin/main';
const PASS = process.env.DASHBOARD_PASSPHRASE || '';
const UPSTREAM = process.env.VERIFY_UPSTREAM || 'https://services.leadconnectorhq.com';   // VERIFY_UPSTREAM: a mock GHL (self-test)
const MAC = process.platform === 'darwin';   // BSD time: -l, bytes; GNU time: -v, kbytes
if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(SLUG || '')) { console.error('usage: node tests/slim-verify/run.mjs <slug>'); process.exit(2); }
if (!process.env.GHL_TOKEN) { console.error('GHL_TOKEN missing'); process.exit(2); }

const work = await mkdtemp(join(tmpdir(), 'slim-verify-'));
const store = join(work, 'responses'); await mkdir(store);
const FIXED = Math.floor(Date.now() / 60e3) * 60e3;

// ---- the recording / replaying proxy
let mode = 'record', seq = 0;
const queues = new Map();   // key → [file, …] in the order they came back
const stats = { recorded: 0, replayed: 0, missing: 0 };
const keyOf = (method, url, body) => `${method} ${url} ${createHash('sha256').update(body).digest('hex').slice(0, 16)}`;
const proxy = createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks), key = keyOf(req.method, req.url, body);
  if (mode === 'record') {
    let status = 599, type = 'application/json', retryAfter = null, out = Buffer.from('{"message":"proxy: upstream unreachable"}');
    try {
      const headers = {}; for (const h of ['authorization', 'accept', 'version', 'content-type']) if (req.headers[h]) headers[h] = req.headers[h];
      const r = await fetch(UPSTREAM + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      status = r.status; type = r.headers.get('content-type') || type; retryAfter = r.headers.get('retry-after');
      out = Buffer.from(await r.arrayBuffer());
    } catch {}
    const file = join(store, `${seq++}.bin`);
    await writeFile(file, out);
    await writeFile(`${file}.json`, JSON.stringify({ status, type, retryAfter }));
    if (!queues.has(key)) queues.set(key, []);
    queues.get(key).push(file); stats.recorded++;
    res.writeHead(status, { 'Content-Type': type, ...(retryAfter ? { 'Retry-After': retryAfter } : {}) }); return res.end(out);
  }
  const file = queues.get(key)?.shift();
  if (!file) { stats.missing++; res.writeHead(599, { 'Content-Type': 'application/json' }); return res.end('{"message":"replay: request not recorded"}'); }
  const meta = JSON.parse(await readFile(`${file}.json`, 'utf8'));
  stats.replayed++;
  res.writeHead(meta.status, { 'Content-Type': meta.type, ...(meta.retryAfter ? { 'Retry-After': meta.retryAfter } : {}) });
  res.end(await readFile(file));
});
await new Promise(r => proxy.listen(0, '127.0.0.1', r));
const PROXY = `http://127.0.0.1:${proxy.address().port}`;

// ---- a frozen clock for both runs (no code change in sync.mjs needed)
const fakeNow = join(work, 'fake-now.mjs');
await writeFile(fakeNow, `const FIXED = ${FIXED}; const RealDate = Date;
class FrozenDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(FIXED); } static now() { return FIXED; } }
globalThis.Date = FrozenDate;\n`);

// ---- two copies of the checkout
async function copy(name) {
  const dir = join(work, name);
  await cp(ROOT, dir, { recursive: true, filter: src => !/[/\\](\.git|node_modules|test-results)([/\\]|$)/.test(src) });
  return dir;
}
const OLD = await copy('old'), NEW = await copy('new');
const { stdout: oldSync } = await exec('git', ['show', `${OLD_REF}:scripts/sync.mjs`], { cwd: ROOT, maxBuffer: 20e6 });
await writeFile(join(OLD, 'scripts/sync.mjs'), oldSync);
const oldIsSlim = /message-slim/.test(oldSync);

async function runSync(dir, label) {
  const resultFile = join(dir, 'result.json');
  const t0 = process.hrtime.bigint();
  const child = spawn('/usr/bin/time', [MAC ? '-l' : '-v', process.execPath, '--max-old-space-size=6144', '--import', fakeNow, 'scripts/sync.mjs', SLUG], {
    cwd: dir, env: { ...process.env, GHL_API_BASE: PROXY, SYNC_RESULT_FILE: resultFile, GITHUB_ACTIONS: '' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '', err = '';
  child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
  const code = await new Promise(r => child.on('close', r));
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  const rssKb = MAC ? Number((err.match(/(\d+)\s+maximum resident set size/) || [])[1] || 0) / 1024 : Number((err.match(/Maximum resident set size \(kbytes\): (\d+)/) || [])[1] || 0);
  console.log(`${label}: exit ${code}, ${secs.toFixed(0)} s, peak memory ${(rssKb / 1024).toFixed(0)} MB`);
  if (code !== 0) { console.log(`${label}: last lines of its log (the same lines a normal sync prints):`); console.log((out + err).split('\n').filter(l => !/resident set size|Command being timed|^\s+\d+\s+[a-z]|\t/.test(l)).slice(-15).join('\n')); }
  return { code, rssKb, resultFile };
}

// ---- field-by-field comparison: paths only, never values
function diffPaths(a, b, path = '', out = []) {
  if (out.length > 2000) return out;
  if (Object.is(a, b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diffPaths(a[k], b[k], `${path}/${Array.isArray(a) ? '#' : k}`, out);
    return out;
  }
  out.push(path || '/');
  return out;
}
const section = p => p.split('/').slice(1, 3).join('/');
async function compare(label, getA, getB) {
  let a, b;
  try { a = await getA(); b = await getB(); } catch (e) { console.log(`${label}: could not read (${e.code || e.name})`); return false; }
  const d = diffPaths(a, b);
  if (!d.length) { console.log(`${label}: IDENTICAL`); return true; }
  const by = {}; for (const p of d) by[section(p)] = (by[section(p)] || 0) + 1;
  console.log(`${label}: ${d.length} field(s) differ, in ${JSON.stringify(by)}`);
  return false;
}

let ok = false;
try {
  console.log(`Firm ${SLUG}; OLD = scripts/sync.mjs at ${OLD_REF}${oldIsSlim ? ' (WARNING: already the slim version)' : ''}; NEW = this checkout; clock frozen at ${new Date(FIXED).toISOString()}`);
  mode = 'record';
  const A = await runSync(OLD, 'OLD (records GHL)');
  console.log(`requests recorded: ${stats.recorded}`);
  mode = 'replay';
  const B = await runSync(NEW, 'NEW (replays the same answers)');
  const left = [...queues.values()].reduce((n, q) => n + q.length, 0);
  console.log(`requests replayed: ${stats.replayed}, not recorded: ${stats.missing}, recorded but not asked for: ${left}`);
  const data = d => join(d, `firms/${SLUG}/data`);
  const json = f => async () => JSON.parse(await readFile(f, 'utf8'));
  const dec = f => async () => decryptJSON(JSON.parse(await readFile(f, 'utf8')), PASS);
  const same = [
    A.code === B.code,
    await compare('kpis.json (the dashboard numbers)', json(join(data(OLD), 'kpis.json')), json(join(data(NEW), 'kpis.json'))),
    PASS ? await compare('details.enc.json (decrypted: contacts, calls, message log)', dec(join(data(OLD), 'details.enc.json')), dec(join(data(NEW), 'details.enc.json'))) : (console.log('details.enc.json: skipped (no passphrase)'), true),
    await compare('sync result (status file input)', json(A.resultFile), json(B.resultFile)),
    stats.missing === 0 && left === 0,
  ];
  ok = same.every(Boolean);
  console.log(ok ? `RESULT ${SLUG}: IDENTICAL. Memory ${(A.rssKb / 1024).toFixed(0)} MB → ${(B.rssKb / 1024).toFixed(0)} MB.` : `RESULT ${SLUG}: DIFFERENT (see above)`);
} finally {
  proxy.close();
  await rm(work, { recursive: true, force: true });
}
process.exit(ok ? 0 : 1);
