// One login (v1.14): rules of admin/lfmp-login.js, the three copies being identical, and set-shared-password.mjs.
// Run: node tests/one-login/run.mjs   (Node 20+, no install)
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash, pbkdf2Sync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as L from '../../admin/lfmp-login.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`✓ ${name}`); } catch (e) { fail++; console.log(`✗ ${name}\n    ${e.message}`); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, m) => { if (!v) throw new Error(m); };

await t('wrong-password limit: 4 wrong = no pause, the 5th starts 2:00, the count restarts after it', () => {
  let g = { f: 0, u: 0 }; const now = 1_000_000;
  for (let i = 1; i <= 4; i++) { g = L.addFail(g, now); eq(g, { f: i, u: 0 }, `after ${i}`); eq(L.blockedFor(g, now), 0); }
  g = L.addFail(g, now); eq(g, { f: 0, u: now + 120000 }, '5th');
  eq(L.fmtCountdown(L.blockedFor(g, now + 1000)), '1:59');
  eq(L.fmtCountdown(L.blockedFor(g, now + 119500)), '0:01');
  eq(L.blockedFor(g, now + 120000), 0, 'over after 2 minutes');
  eq(L.addFail(g, now + 130000), { f: 1, u: 0 }, 'first wrong after the pause starts again at 1');
});
await t('guard storage is a count and an end time only, and bad JSON reads as clean', () => {
  eq(L.readGuard('{"f":3,"u":5}'), { f: 3, u: 5 }); eq(L.readGuard('nope'), { f: 0, u: 0 }); eq(L.readGuard(null), { f: 0, u: 0 });
  eq(L.readGuard('{"f":-2,"u":"x","pw":"secret"}'), { f: 0, u: 0 }, 'extra fields are ignored');
});
await t('session: good while active, ends after 30 min idle, after a Lock anywhere, or with another lock file', () => {
  const now = 10_000_000, s = { v: 1, k: 'AAAA', t: now - 60e3, s: now - 120e3, id: 'abc' };
  ok(L.sessionOk(s, { now, lockAt: 0, lockId: 'abc' }), 'fresh session');
  ok(!L.sessionOk({ ...s, t: now - 30 * 60e3 - 1 }, { now, lockAt: 0, lockId: 'abc' }), 'idle 30 min');
  ok(L.sessionOk({ ...s, t: now - 30 * 60e3 + 1000 }, { now, lockAt: 0, lockId: 'abc' }), 'just under 30 min');
  ok(!L.sessionOk(s, { now, lockAt: now - 1000, lockId: 'abc' }), 'locked after the session started');
  ok(L.sessionOk(s, { now, lockAt: now - 200e3, lockId: 'abc' }), 'a lock before the session started does not matter');
  ok(!L.sessionOk(s, { now, lockAt: 0, lockId: 'other' }), 'new password (other lock file)');
  ok(!L.sessionOk(null, { now, lockAt: 0, lockId: 'abc' }) && !L.sessionOk({ ...s, v: 2 }, { now, lockAt: 0, lockId: 'abc' }), 'missing or old format');
  eq(L.IDLE_MS, 30 * 60e3); eq(L.MAX_TRIES, 5); eq(L.COOLDOWN_MS, 120e3);
});
await t('vault: AES-GCM seal / open round trip; another key cannot open it; no plain text at rest', async () => {
  const raw = crypto.getRandomValues(new Uint8Array(32)), other = crypto.getRandomValues(new Uint8Array(32));
  const k = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const k2 = await crypto.subtle.importKey('raw', other, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const sealed = await L.seal(k, { gh: 'github_pat_TESTVALUE', reviewKey: 'review-TESTVALUE' });
  ok(!/TESTVALUE/.test(sealed), 'secret visible in the sealed blob');
  eq(await L.open(k, sealed), { gh: 'github_pat_TESTVALUE', reviewKey: 'review-TESTVALUE' });
  let threw = false; try { await L.open(k2, sealed); } catch { threw = true; } ok(threw, 'opened with the wrong key');
});
await t('lock file check and the key split match set-shared-password.mjs (PBKDF2-SHA256, 64 bytes)', () => {
  ok(L.validLock({ salt: 'a', verifier: 'b', iterations: 210000 }) && !L.validLock({ salt: 'a', verifier: 'b', iterations: 1000 }) && !L.validLock({}), 'validLock');
  eq(L.lockIdOf({ verifier: 'abcdefghijklmnopqrstuvwxyz' }), 'abcdefghijklmnop');
});
await t('the three copies of lfmp-login.js, lfmp-login.css and lfmp-ui.css are byte-identical', async () => {
  const sha = async p => createHash('sha256').update(await readFile(p)).digest('hex');
  for (const f of ['lfmp-login.js', 'lfmp-login.css', 'lfmp-ui.css']) {
    const h = [await sha(join(ROOT, 'admin', f)), await sha(join(ROOT, '../ghl-subaccount-builder/page', f)), await sha(join(ROOT, '../automation-review/admin', f))];
    ok(h[0] === h[1] && h[1] === h[2], `${f} differs: ${h.map(x => x.slice(0, 8)).join(' ')}`);
  }
});
await t('client-facing pages never load the login or read the vault', async () => {
  const files = ['app/dashboard.html', '../automation-review/index.html', '../automation-review/plan.html', '../automation-review/messages.html', '../automation-review/config.js'];
  for (const f of files) { const s = await readFile(join(ROOT, f), 'utf8'); ok(!/lfmp-login|lfmp-vault|lfmp-session/.test(s), `${f} mentions the login`); }
});
await t('set-shared-password.mjs: piped twice writes the same check value to every folder, never the password', async () => {
  const d1 = await mkdtemp(join(tmpdir(), 'lfmp-lock-a-')), d2 = await mkdtemp(join(tmpdir(), 'lfmp-lock-b-'));
  try {
    const pw = 'a long test password 123';
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/set-shared-password.mjs')], { input: `${pw}\n${pw}\n`, env: { ...process.env, LFMP_LOCK_TEST_DIRS: `${d1},${d2}` }, encoding: 'utf8' });
    eq(r.status, 0, `exit (${r.stderr})`);
    ok(!r.stdout.includes(pw) && !r.stderr.includes(pw), 'password printed');
    const a = await readFile(join(d1, 'lfmp-lock.json'), 'utf8'), b = await readFile(join(d2, 'lfmp-lock.json'), 'utf8');
    eq(a, b, 'same file');
    const l = JSON.parse(a); ok(L.validLock(l) && l.iterations === 210000 && !a.includes(pw), 'lock file');
    const v = pbkdf2Sync(pw, Buffer.from(l.salt, 'base64'), l.iterations, 64, 'sha256').subarray(0, 32).toString('base64');
    eq(v, l.verifier, 'verifier');
    const short = spawnSync(process.execPath, [join(ROOT, 'scripts/set-shared-password.mjs')], { input: 'y\nshort\nshort\n', env: { ...process.env, LFMP_LOCK_TEST_DIRS: d1 }, encoding: 'utf8' });
    ok(short.status === 1 && (await readFile(join(d1, 'lfmp-lock.json'), 'utf8')) === a, 'a too-short password changed the file');
    const nomatch = spawnSync(process.execPath, [join(ROOT, 'scripts/set-shared-password.mjs')], { input: `y\n${pw}x\n${pw}y\n`, env: { ...process.env, LFMP_LOCK_TEST_DIRS: d1 }, encoding: 'utf8' });
    ok(nomatch.status === 1 && (await readFile(join(d1, 'lfmp-lock.json'), 'utf8')) === a, 'mismatched passwords changed the file');
  } finally { await rm(d1, { recursive: true, force: true }); await rm(d2, { recursive: true, force: true }); }
});

console.log(`\n${pass}/${pass + fail} passed`);
process.exitCode = fail ? 1 : 0;
