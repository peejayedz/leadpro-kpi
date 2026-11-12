// Token keeper tests.   Run:  node tests/keeper/run.mjs [filter]   (Node 20+, no dependencies)
//
// Runs the real scripts/token-keeper.mjs (in a temp copy of the repo) against a mock GHL and a fake
// `gh` that reports every secret write back to the mock, so one ordered event log shows what
// happened when. Checks: refresh only when due, the new refresh token saved BEFORE the new access
// token is used, a failed save, a refused refresh, app missing on a firm, Private Integration firms
// never written, a new firm, dry run, check mode, and that no token or secret appears in the log or
// the public status file. Also keeper-status.mjs (bell issues) and the workflow guardrails.
// Writes nothing in the repo.

import { readFile, writeFile, mkdtemp, mkdir, cp, rm, chmod } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateKeeper, keeperIssues, emptyKeeper, tokenLabel, KEEPER_STALE_MIN } from '../../scripts/keeper-status.mjs';
import { describeIssue } from '../../scripts/sync-status.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const only = process.argv[2] || '';
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, what) => { if (!v) throw new Error(what); };
const sha = v => createHash('sha256').update(v).digest('hex');
const H = 36e5;

const CLIENT_ID = '66aa11bb22cc33dd44ee55ff-lm9x2k1q', CLIENT_SECRET = 'CLIENT-SECRET-VALUE-0123456789abcdef';
const OLD_REFRESH = 'OLDREFRESH'.repeat(30), NEW_REFRESH = 'NEWREFRESH'.repeat(30);
const OLD_ACCESS = 'OLDACCESS'.repeat(120), NEW_ACCESS = 'NEWACCESS'.repeat(120);
const LOC = { one: 'LOCappONE0000000001', two: 'LOCappTWO0000000002', mahdavi: 'INZKoa3nu45xtcZB0Yuq', fresh: 'LOCnewFIRM00000003' };
const SECRET_VALUES = [CLIENT_SECRET, OLD_REFRESH, NEW_REFRESH, OLD_ACCESS, NEW_ACCESS];
const INDEX = [
  { slug: 'mahdavi', secretKey: 'MAHDAVI', name: 'The Mahdavi Law Firm', locationId: LOC.mahdavi },
  { slug: 'app-one', secretKey: 'APP_ONE', name: 'App One', locationId: LOC.one, tokenSource: 'app' },
  { slug: 'app-two', secretKey: 'APP_TWO', name: 'App Two', locationId: LOC.two, tokenSource: 'app' },
];

// ---------- mock GHL (+ the fake gh reports here) ----------
async function startMock(opt = {}) {
  const events = [];
  const o = { refresh: 'ok', installed: [LOC.one, LOC.two, LOC.fresh], mint401Once: false, ...opt };
  let minted = 0, mint401 = o.mint401Once;
  const server = createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const u = new URL(req.url, 'http://x'), form = Object.fromEntries(new URLSearchParams(body));
    const send = (s, j) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (u.pathname === '/__gh') { const e = JSON.parse(body); events.push({ type: 'secret', name: e.name, sha: e.sha, fail: e.fail }); return send(200, {}); }
    const auth = (req.headers.authorization || '').replace('Bearer ', '');
    if (req.method === 'POST' && u.pathname === '/oauth/token') {
      events.push({ type: 'refresh', grant: form.grant_type, usedRefresh: form.refresh_token === OLD_REFRESH ? 'old' : 'other' });
      if (o.refresh === 'reject' || form.refresh_token !== OLD_REFRESH || form.client_secret !== CLIENT_SECRET) return send(400, { error: 'invalid_grant', error_description: `bad refresh ${form.refresh_token}` });
      return send(200, { access_token: NEW_ACCESS, refresh_token: NEW_REFRESH, expires_in: 86399, userType: 'Company' });
    }
    if (req.method === 'GET' && u.pathname === '/oauth/installed-locations') {
      events.push({ type: 'list', with: auth === NEW_ACCESS ? 'new' : auth === OLD_ACCESS ? 'old' : 'bad' });
      if (auth !== NEW_ACCESS && auth !== OLD_ACCESS) return send(401, { message: 'Invalid JWT' });
      return send(200, { items: o.installed.map(id => ({ _id: id, name: 'x', isInstalled: true })), pagination: { hasNextPage: false }, installToFutureLocations: true });
    }
    if (req.method === 'POST' && u.pathname === '/oauth/locationToken') {
      events.push({ type: 'mint', loc: form.locationId, with: auth === NEW_ACCESS ? 'new' : auth === OLD_ACCESS ? 'old' : 'bad' });
      if (mint401 && auth === OLD_ACCESS) { mint401 = false; return send(401, { message: 'Invalid JWT' }); }
      if (auth !== NEW_ACCESS && auth !== OLD_ACCESS) return send(401, { message: 'Invalid JWT' });
      minted++;
      return send(200, { access_token: `LOCTOKEN-${form.locationId}-${'z'.repeat(80)}`, userType: 'Location', locationId: form.locationId, expires_in: 86399 });
    }
    events.push({ type: 'unexpected', method: req.method, path: u.pathname });
    send(404, {});
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, events, close: () => new Promise(r => server.close(r)) };
}

// ---------- temp repo + fake gh ----------
async function makeRepo(index = INDEX) {
  const tmp = await mkdtemp(join(tmpdir(), 'lpk-keeper-'));
  await cp(join(ROOT, 'scripts'), join(tmp, 'scripts'), { recursive: true });
  await mkdir(join(tmp, 'firms'), { recursive: true });
  await writeFile(join(tmp, 'firms/index.json'), JSON.stringify(index));
  const gh = join(tmp, 'fake-gh.mjs');
  await writeFile(gh, `#!/usr/bin/env node
// Fake gh: "secret set NAME --repo R", value on stdin. Reports name + sha256 to the mock; never prints the value.
import { createHash } from 'node:crypto';
if (process.argv[2] === 'api') process.exit(process.env.FAKE_GH_API_FAIL ? 1 : 0);   // the "can write secrets" check
let v = ''; for await (const c of process.stdin) v += c;
const name = process.argv[4];
const fail = (process.env.FAKE_GH_FAIL || '').split(',').includes(name);
await fetch(process.env.MOCK + '/__gh', { method: 'POST', body: JSON.stringify({ name, sha: createHash('sha256').update(v).digest('hex'), fail }) });
process.exit(fail ? 1 : 0);
`);
  await chmod(gh, 0o755);
  return tmp;
}
function runKeeper(tmp, mock, env = {}) {
  const base = {
    PATH: process.env.PATH, HOME: process.env.HOME, GHL_API_BASE: mock.url, MOCK: mock.url, KEEPER_GH_BIN: join(tmp, 'fake-gh.mjs'), KEEPER_SLEEP_SCALE: '0',
    GITHUB_REPOSITORY: 'peejayedz/leadpro-kpi', SECRETS_TOKEN: 'GH-SECRETS-TOKEN-VALUE-xyz', RUN_URL: 'https://github.com/peejayedz/leadpro-kpi/actions/runs/123',
    GHL_APP_CLIENT_ID: CLIENT_ID, GHL_APP_CLIENT_SECRET: CLIENT_SECRET, GHL_APP_REFRESH_TOKEN: OLD_REFRESH,
    GHL_APP_ACCESS: JSON.stringify({ access_token: OLD_ACCESS, expiresAt: new Date(Date.now() + 20 * H).toISOString() }),
  };
  return new Promise(resolve => execFile(process.execPath, [join(tmp, 'scripts/token-keeper.mjs')], { env: { ...base, ...env }, cwd: tmp }, (e, stdout, stderr) =>
    resolve({ code: e ? e.code : 0, out: stdout + stderr })));
}
const accessIn = h => JSON.stringify({ access_token: OLD_ACCESS, expiresAt: new Date(Date.now() + h * H).toISOString() });
const statusOf = async tmp => { try { return JSON.parse(await readFile(join(tmp, 'status/token-keeper.json'), 'utf8')); } catch { return null; } };
const secrets = m => m.events.filter(e => e.type === 'secret');
function noLeaks(out, status) {
  for (const v of [...SECRET_VALUES, 'GH-SECRETS-TOKEN-VALUE', 'LOCTOKEN-']) {
    ok(!out.includes(v.slice(0, 30)), `log contains a secret (${v.slice(0, 8)}…)`);
    if (status) ok(!JSON.stringify(status).includes(v.slice(0, 30)), `status file contains a secret (${v.slice(0, 8)}…)`);
  }
}
async function scenario(fn, { index, mock: mopt } = {}) {
  const tmp = await makeRepo(index), mock = await startMock(mopt);
  try { await fn(tmp, mock); } finally { await mock.close(); await rm(tmp, { recursive: true, force: true }); }
}

// ---------- keeper runs ----------
test('Not due (20 h left): no refresh; app firms get fresh tokens; Mahdavi (Private Integration) never written', () => scenario(async (tmp, m) => {
  const r = await runKeeper(tmp, m);
  eq(r.code, 0, 'exit code');
  ok(!m.events.some(e => e.type === 'refresh'), 'no refresh call');
  eq(secrets(m).map(e => e.name).sort(), ['GHL_TOKEN_APP_ONE', 'GHL_TOKEN_APP_TWO'], 'secrets written');
  ok(m.events.filter(e => e.type === 'mint').every(e => e.with === 'old'), 'mints use the saved agency token');
  const s = await statusOf(tmp);
  eq([s.firms['app-one'].problem, s.firms['app-two'].problem, s.problem], [null, null, null], 'status problems');
  ok(!s.firms.mahdavi, 'Mahdavi not in the keeper status');
  eq([s.appInstalls, s.installToFutureLocations], [3, true], 'install count + future flag');
  noLeaks(r.out, s);
}));

test('Due (3 h left): refresh; new refresh token saved FIRST, then access token, then the new token is used', () => scenario(async (tmp, m) => {
  const r = await runKeeper(tmp, m, { GHL_APP_ACCESS: accessIn(3) });
  eq(r.code, 0, 'exit code');
  const seq = m.events.map(e => e.type === 'secret' ? `secret:${e.name}` : e.type === 'mint' ? `mint:${e.with}` : e.type === 'list' ? `list:${e.with}` : e.type);
  eq(seq.slice(0, 3), ['refresh', 'secret:GHL_APP_REFRESH_TOKEN', 'secret:GHL_APP_ACCESS'], 'order');
  ok(!seq.slice(0, seq.indexOf('secret:GHL_APP_REFRESH_TOKEN')).some(x => x.endsWith(':new')), 'new access token used before the refresh token was saved');
  eq(secrets(m)[0].sha, sha(NEW_REFRESH), 'the NEW refresh token is what was saved');
  const acc = secrets(m).find(e => e.name === 'GHL_APP_ACCESS');
  ok(acc.sha !== sha(OLD_ACCESS), 'access secret updated');
  ok(m.events.filter(e => e.type === 'mint').every(e => e.with === 'new'), 'mints use the new token');
  const s = await statusOf(tmp);
  ok(s.lastRefreshAt && Date.parse(s.agencyExpiresAt) - Date.now() > 23 * H, 'status: refreshed + new expiry');
  noLeaks(r.out, s);
}));

test('Saving the new refresh token fails 3 times: re-connect needed, firms still updated with the new token, run fails', () => scenario(async (tmp, m) => {
  const r = await runKeeper(tmp, m, { GHL_APP_ACCESS: accessIn(1), FAKE_GH_FAIL: 'GHL_APP_REFRESH_TOKEN' });
  ok(r.code !== 0, 'run must fail');
  eq(secrets(m).filter(e => e.name === 'GHL_APP_REFRESH_TOKEN').length, 3, 'three tries');
  eq(m.events.filter(e => e.type === 'refresh').length, 1, 'refreshed once only (the old refresh token is spent)');
  ok(secrets(m).some(e => e.name === 'GHL_TOKEN_APP_ONE' && !e.fail), 'firm token still updated');
  const s = await statusOf(tmp);
  eq(s.problem?.category + '/' + s.problem?.detail, 'reconnect/save-failed', 'status problem');
  const iss = keeperIssues(s, { now: Date.now(), firms: INDEX });
  ok(iss.some(i => i.kind === 'keeper-reconnect'), 'bell shows re-connect');
  noLeaks(r.out, s);
}));

test('GHL refuses the refresh token (expired agency token): re-connect needed, nothing minted or written', () => scenario(async (tmp, m) => {
  const r = await runKeeper(tmp, m, { GHL_APP_ACCESS: accessIn(-1) });
  ok(r.code !== 0, 'run must fail');
  eq(secrets(m).length, 0, 'no secret written');
  ok(!m.events.some(e => e.type === 'mint'), 'nothing minted');
  const s = await statusOf(tmp);
  eq(s.problem?.detail, 'refresh-rejected', 'problem');
  noLeaks(r.out, s);
}, { mock: { refresh: 'reject' } }));

test('Refresh due but KEEPER_GH_TOKEN missing: does NOT refresh (single-use token kept), still mints with the valid token', () => scenario(async (tmp, m) => {
  const r = await runKeeper(tmp, m, { GHL_APP_ACCESS: accessIn(3), SECRETS_TOKEN: '' });
  ok(r.code !== 0, 'run fails so it shows');
  ok(!m.events.some(e => e.type === 'refresh'), 'no refresh');
  const s = await statusOf(tmp);
  eq(s.problem?.detail, 'no-secrets-token', 'problem');
  ok(keeperIssues(s, { now: Date.now(), firms: INDEX }).some(i => i.kind === 'keeper-failed'), 'bell');
}));

test('Refresh due but KEEPER_GH_TOKEN no longer works (expired/revoked): does NOT refresh', () => scenario(async (tmp, m) => {
  const r = await runKeeper(tmp, m, { GHL_APP_ACCESS: accessIn(3), FAKE_GH_API_FAIL: '1' });
  ok(r.code !== 0, 'run fails');
  ok(!m.events.some(e => e.type === 'refresh'), 'no refresh');
  ok(/not working/.test(r.out), 'says the GitHub token isn\'t working');
  eq((await statusOf(tmp)).problem?.detail, 'no-secrets-token', 'problem');
}));

test('App not installed on one firm: that firm flagged app-missing, the other still updated', () => scenario(async (tmp, m) => {
  const r = await runKeeper(tmp, m);
  ok(r.code !== 0, 'run fails so GitHub shows it');
  eq(secrets(m).map(e => e.name), ['GHL_TOKEN_APP_ONE'], 'only app-one written');
  const s = await statusOf(tmp);
  eq(s.firms['app-two'].problem, 'app-missing', 'app-two problem');
  const iss = keeperIssues(s, { now: Date.now(), firms: INDEX });
  ok(iss.some(i => i.id === 'app-two:app-missing'), 'bell issue');
  eq(s.problem, null, 'no run-level problem');
  ok(Date.parse(s.lastOkAt) > Date.now() - 60e3, 'keeper itself still OK');
}, { mock: { installed: [LOC.one] } }));

test('Agency token refused when minting: refresh once (saved first), then mint again', () => scenario(async (tmp, m) => {
  const r = await runKeeper(tmp, m, {});
  eq(r.code, 0, 'exit code');
  const seq = m.events.map(e => e.type === 'secret' ? `secret:${e.name}` : e.type === 'mint' ? `mint:${e.with}` : e.type);
  const iRefresh = seq.indexOf('refresh'), iSave = seq.indexOf('secret:GHL_APP_REFRESH_TOKEN');
  ok(iRefresh > 0 && iSave === iRefresh + 1, `refresh then save first (${seq.join(' ')})`);
  ok(seq.slice(iSave).includes('mint:new'), 'retried with the new token');
}, { mock: { mint401Once: true } }));

test('Live state today: zero app firms, token not due → no refresh, no secret written, exit 0', () => scenario(async (tmp, m) => {
  const r = await runKeeper(tmp, m);
  eq(r.code, 0, 'exit code');
  eq(secrets(m).length, 0, 'no secrets');
  ok(!m.events.some(e => e.type === 'refresh' || e.type === 'mint'), 'no refresh or mint');
  ok(/Firms using the app token: 0/.test(r.out), 'log says 0 app firms');
  const s = await statusOf(tmp);
  ok(s.lastOkAt && s.problem === null, 'status OK');
  eq(keeperIssues(s, { now: Date.now(), firms: INDEX.slice(0, 1) }), [], 'no bell issues');
}, { index: INDEX.slice(0, 1) }));

test('Secrets not set up yet + zero app firms: exit 0, no bell issue', () => scenario(async (tmp, m) => {
  const r = await runKeeper(tmp, m, { GHL_APP_REFRESH_TOKEN: '', GHL_APP_CLIENT_SECRET: '' });
  eq(r.code, 0, 'exit code');
  const s = await statusOf(tmp);
  eq(s.problem?.detail, 'missing-secrets', 'recorded');
  eq(keeperIssues(s, { now: Date.now(), firms: INDEX.slice(0, 1) }), [], 'no bell issue without app firms');
}, { index: INDEX.slice(0, 1) }));

test('One firm on demand: a Private Integration firm is refused (nothing written)', () => scenario(async (tmp, m) => {
  const r = await runKeeper(tmp, m, { KEEPER_SLUG: 'mahdavi' });
  ok(r.code !== 0, 'refused');
  eq(secrets(m).length, 0, 'nothing written');
}));

test('One firm on demand: only that app firm', () => scenario(async (tmp, m) => {
  const r = await runKeeper(tmp, m, { KEEPER_SLUG: 'app-two' });
  eq(r.code, 0, 'exit');
  eq(secrets(m).map(e => e.name), ['GHL_TOKEN_APP_TWO'], 'only app-two');
}));

test('New firm (not in index yet): token written to its own secret; a location or name already used is refused', () => scenario(async (tmp, m) => {
  const r = await runKeeper(tmp, m, { KEEPER_SLUG: 'zz-test-2', KEEPER_LOCATION: LOC.fresh, KEEPER_SECRET_KEY: 'ZZ_TEST_2' });
  eq(r.code, 0, 'exit');
  eq(secrets(m).map(e => e.name), ['GHL_TOKEN_ZZ_TEST_2'], 'written');
  ok(!(await statusOf(tmp)).firms['zz-test-2'], 'not in the public status until committed');
  const r2 = await runKeeper(tmp, m, { KEEPER_SLUG: 'zz-other', KEEPER_LOCATION: LOC.mahdavi, KEEPER_SECRET_KEY: 'ZZ_OTHER' });
  ok(r2.code !== 0, 'Mahdavi\'s location refused');
  const r3 = await runKeeper(tmp, m, { KEEPER_SLUG: 'zz-x', KEEPER_LOCATION: LOC.fresh, KEEPER_SECRET_KEY: 'MAHDAVI' });
  ok(r3.code !== 0, 'mismatched secret key refused');
  eq(secrets(m).length, 1, 'still only one write');
}));

test('new-firm mode (KEEPER_NO_REFRESH): mints with the saved token even when a refresh is due; never refreshes; no status file', () => scenario(async (tmp, m) => {
  const r = await runKeeper(tmp, m, { KEEPER_NO_REFRESH: '1', KEEPER_NO_STATUS: '1', GHL_APP_ACCESS: accessIn(3), KEEPER_SLUG: 'zz-test-2', KEEPER_LOCATION: LOC.fresh, KEEPER_SECRET_KEY: 'ZZ_TEST_2' });
  eq(r.code, 0, `exit (${r.out})`);
  ok(!m.events.some(e => e.type === 'refresh'), 'no refresh');
  eq(secrets(m).map(e => e.name), ['GHL_TOKEN_ZZ_TEST_2'], 'only the new firm\'s token');
  eq(await statusOf(tmp), null, 'no status file');
  const r2 = await runKeeper(tmp, m, { KEEPER_NO_REFRESH: '1', KEEPER_NO_STATUS: '1', GHL_APP_ACCESS: accessIn(0.1), KEEPER_SLUG: 'zz-test-2', KEEPER_LOCATION: LOC.fresh, KEEPER_SECRET_KEY: 'ZZ_TEST_2' });
  ok(r2.code !== 0 && /token keeper must run first/.test(r2.out), 'expired: asks for the keeper');
  ok(!m.events.some(e => e.type === 'refresh'), 'still no refresh');
}));

test('Dry run: no refresh, no secret written, no status file', () => scenario(async (tmp, m) => {
  const r = await runKeeper(tmp, m, { KEEPER_DRY_RUN: '1', GHL_APP_ACCESS: accessIn(3) });
  eq(r.code, 0, 'exit');
  ok(!m.events.some(e => e.type === 'refresh'), 'no refresh');
  eq(secrets(m).length, 0, 'no secrets');
  ok(/would refresh/.test(r.out) && /would update GHL_TOKEN_APP_ONE/.test(r.out), 'says what it would do');
  eq(await statusOf(tmp), null, 'no status file');
}));

test('Check mode: fingerprints match, nothing written, no refresh', () => scenario(async (tmp, m) => {
  const r = await runKeeper(tmp, m, { KEEPER_MODE: 'check', GHL_APP_ACCESS: accessIn(1) });
  eq(r.code, 0, 'exit');
  ok(r.out.includes(`fingerprint GHL_APP_REFRESH_TOKEN ${sha(OLD_REFRESH).slice(0, 10)}`), 'refresh fingerprint');
  ok(r.out.includes(`fingerprint GHL_APP_CLIENT_SECRET ${sha(CLIENT_SECRET).slice(0, 10)}`), 'secret fingerprint');
  ok(/app on 3 sub-accounts/.test(r.out), 'token works');
  eq(secrets(m).length, 0, 'no writes');
  ok(!m.events.some(e => e.type === 'refresh' || e.type === 'mint'), 'no refresh or mint');
  eq(await statusOf(tmp), null, 'no status file');
  noLeaks(r.out, null);
}));

// ---------- guards ----------
test('ghl-app.mjs: only GET + POST /oauth/token + /oauth/locationToken; secret writer only app + GHL_TOKEN_ names', async () => {
  process.env.GHL_API_BASE = 'http://127.0.0.1:9';
  const { app, guard } = await import('../../scripts/ghl-app.mjs');
  for (const [m, p] of [['DELETE', '/oauth/token'], ['PUT', '/locations/x'], ['POST', '/contacts/'], ['POST', '/custom-menus/'], ['PATCH', '/x'], ['POST', '/oauth/tokenx'], ['POST', '/locations/']])
    await app(m, p).then(() => { throw new Error(`${m} ${p} allowed`); }, e => ok(/Blocked/.test(e.message), `${m} ${p}: ${e.message}`));
  guard('GET', '/oauth/installed-locations'); guard('POST', '/oauth/token'); guard('POST', '/oauth/locationToken');
  const { makeSecretWriter } = await import('../../scripts/token-keeper.mjs');
  const w = makeSecretWriter({ repo: 'x/y', token: 't', bin: '/nonexistent', dry: true });
  for (const n of ['PASSPHRASE_MAHDAVI', 'GHL_APP_CLIENT_SECRET', 'KEEPER_GH_TOKEN', 'ghl_token_x', 'GHL_TOKEN_']) await w(n, 'v').then(() => { throw new Error(`${n} allowed`); }, e => ok(/Blocked/.test(e.message), n));
  await w('GHL_TOKEN_APP_ONE', 'v'); await w('GHL_APP_REFRESH_TOKEN', 'v'); await w('GHL_APP_ACCESS', 'v');
});

test('Repo: only scripts/ghl-app.mjs calls /oauth/*; only token-keeper.mjs writes secrets from Actions', async () => {
  const { readdir } = await import('node:fs/promises');
  const files = (await readdir(join(ROOT, 'scripts'))).filter(f => f.endsWith('.mjs'));
  for (const f of files) {
    const t = await readFile(join(ROOT, 'scripts', f), 'utf8');
    if (f !== 'ghl-app.mjs') ok(!/['"`]\/oauth\//.test(t), `${f} calls /oauth`);
    // Code that runs a secret write (gh args or the Secrets API), not help text that tells a person to.
    if (!['token-keeper.mjs'].includes(f)) ok(!/\[\s*'secret',\s*'set'|actions\/secrets\/[^'"`]*['"`]\s*,\s*\{?\s*method:\s*'PUT'|'PUT'[^\n]*actions\/secrets/.test(t), `${f} writes secrets`);
  }
});

test('Workflows: one keeper at a time; sync.yml untouched by the keeper; after scheduled/chained syncs only', async () => {
  const k = await readFile(join(ROOT, '.github/workflows/tokens.yml'), 'utf8');
  ok(/concurrency:\s*\n\s*group: ghl-app-tokens\s*\n\s*cancel-in-progress: false/.test(k), 'concurrency lock');
  ok(/cron: "23 \* \* \* \*"/.test(k), 'hourly');
  ok(/workflows: \["Sync KPIs from GoHighLevel"\]/.test(k) && /workflow_run\.event == 'schedule'/.test(k) && /\(chain\)/.test(k), 'after scheduled/chained syncs');
  ok(!/GHL_APP_CLIENT_SECRET[^\n]*echo|echo[^\n]*\$GHL_APP/.test(k), 'never echoes a secret');
  const s = await readFile(join(ROOT, '.github/workflows/sync.yml'), 'utf8');
  ok(!/GHL_APP|KEEPER|tokens\.yml/.test(s), 'sync.yml has nothing of the keeper');
});

// ---------- status + bell ----------
test('Status file: allow-listed fields only', () => {
  const k = updateKeeper(null, { at: new Date().toISOString(), ok: true, runUrl: 'https://github.com/a/b/actions/runs/1', agencyExpiresAt: new Date().toISOString(), appInstalls: 3, problem: { category: 'ghl', detail: 'server', message: OLD_ACCESS }, firms: { 'app-one': { ok: true, token: NEW_ACCESS }, 'BAD SLUG': { ok: true } }, token: OLD_REFRESH });
  noLeaks('', k);
  eq(Object.keys(k.firms), ['app-one'], 'bad slug dropped');
  eq(Object.keys(k.firms['app-one']).sort(), ['lastMintAt', 'problem', 'since'], 'firm fields');
  eq(Object.keys(k).sort(), Object.keys(emptyKeeper()).sort(), 'top-level fields');
});

test('Bell: keeper stale after 3 h, never-run, reconnect, app-token; nothing when no firm uses the app', () => {
  const now = Date.now(), iso = t => new Date(t).toISOString();
  const base = { ...emptyKeeper(), lastRunAt: iso(now - 10 * 60e3), lastOkAt: iso(now - 10 * 60e3) };
  eq(keeperIssues(base, { now, firms: INDEX }), [], 'fresh keeper');
  eq(keeperIssues({ ...base, lastOkAt: iso(now - (KEEPER_STALE_MIN + 5) * 60e3) }, { now, firms: INDEX }).map(i => i.kind), ['keeper-stale'], 'stale');
  eq(keeperIssues(null, { now, firms: INDEX }).map(i => i.kind), ['keeper-stale'], 'never ran');
  eq(keeperIssues(null, { now, firms: INDEX.slice(0, 1) }), [], 'no app firms: no issues');
  const k2 = { ...base, firms: { 'app-one': { problem: 'mint-failed', since: iso(now), lastMintAt: iso(now - H) } } };
  eq(keeperIssues(k2, { now, firms: INDEX }).map(i => i.id), ['app-one:app-token'], 'firm issue');
  for (const kind of ['keeper-stale', 'keeper-reconnect', 'keeper-failed', 'app-missing', 'app-token']) {
    const d = describeIssue({ kind, detail: 'refresh-rejected', lastGood: iso(now - 4 * H), firstSeen: iso(now) }, { now, when: x => x });
    ok(d.title && d.title !== 'Unknown issue' && d.steps.length && d.actions.includes('keeper'), `${kind} text`);
  }
  const t = describeIssue({ kind: 'failed', category: 'token', detail: 'rejected' }, { tokenSource: 'app', now });
  ok(t.actions.includes('keeper') && !t.actions.includes('token') && !t.actions.includes('ghl'), 'app firms: Run token keeper, not Update token / Fix in GHL');
  const p = describeIssue({ kind: 'failed', category: 'token', detail: 'rejected' }, { now });
  ok(p.actions.includes('token'), 'Private Integration firms unchanged');
  eq([tokenLabel(INDEX[0]), tokenLabel(INDEX[1])], ['Private Integration', 'App'], 'labels');
});

// ---------- run ----------
const results = [];
for (const t of tests) {
  if (only && !t.name.toLowerCase().includes(only.toLowerCase())) continue;
  const t0 = Date.now();
  try { await t.fn(); results.push({ name: t.name, pass: true, ms: Date.now() - t0 }); }
  catch (e) { results.push({ name: t.name, pass: false, error: e.message, ms: Date.now() - t0 }); }
}
console.log('\nToken keeper tests\n');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${(r.ms / 1000).toFixed(1)} s)${r.error ? `\n      ${r.error}` : ''}`);
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed} of ${results.length} tests pass.`);
process.exit(failed ? 1 : 0);
