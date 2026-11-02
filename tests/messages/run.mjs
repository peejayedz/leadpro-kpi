// Call and message sync tests.   Run:  node tests/messages/run.mjs   (Node 20+, no dependencies)
//
// Runs the real scripts/sync.mjs (in a temp copy of the repo, Mahdavi's config and pipelines)
// against a mock GHL whose message export misbehaves the way the real one does: pulls that come
// back short with no sign of it, pages that fail with 500 or 429, a channel that doesn't exist,
// duplicate ids, unordered pages. Checks that the numbers don't dip, that held syncs keep the
// previous numbers, and what the message log stores. Writes nothing in the repo.

import { readFile, writeFile, mkdtemp, mkdir, cp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockGhl } from '../mapping/mock-ghl.mjs';
import { decryptJSON } from '../../scripts/kpi-core.mjs';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const readJSON = async p => JSON.parse(await readFile(p, 'utf8'));
const DAY = 864e5, MIN = 60e3;
const PASS = 'test passphrase #1';
const discovery = await readJSON(join(ROOT, 'firms/mahdavi/discovery.json'));
const only = process.argv[2] || '';

// ---------- a firm's messages ----------
// 30 calls, 8 SMS replies (+ a STOP and outbound texts), 6 email replies; all in the last 2 days,
// after the mock's leads were created (3 days ago), spread over the first 10 leads' contacts.
function world(now = Date.now()) {
  const t = i => new Date(now - 2 * DAY + i * 10 * MIN).toISOString();
  const Call = [];
  for (let i = 1; i <= 30; i++) {
    const inbound = i % 2 === 1;
    Call.push({ id: `k${i}`, contactId: `c${((i - 1) % 10) + 1}`, direction: inbound ? 'inbound' : 'outbound', dateAdded: t(i), userId: 'u1',
      status: inbound ? (i % 3 === 0 ? 'completed' : 'no-answer') : 'completed', meta: { call: { duration: inbound ? 90 : 30, status: inbound ? (i % 3 === 0 ? 'completed' : 'no-answer') : 'completed' } },
      body: `secret call note ${i}` });
  }
  const SMS = [];
  for (let i = 1; i <= 8; i++) SMS.push({ id: `s${i}`, contactId: `c${i}`, direction: 'inbound', status: 'delivered', dateAdded: t(i + 3), body: `secret body text ${i}` });
  SMS.push({ id: 'sStop', contactId: 'c9', direction: 'inbound', status: 'delivered', dateAdded: t(5), body: 'STOP' });
  for (let i = 1; i <= 5; i++) SMS.push({ id: `so${i}`, contactId: `c${i}`, direction: 'outbound', status: 'delivered', dateAdded: t(i), body: `secret outbound ${i}` });
  const Email = [];
  for (let i = 1; i <= 6; i++) Email.push({ id: `e${i}`, contactId: `c${i}`, direction: 'inbound', status: 'delivered', dateAdded: t(i + 1), subject: `secret subject ${i}`, body: `secret email ${i}` });
  return { Call, SMS, Email, WhatsApp: [] };
}
const old = (id, n, now = Date.now()) => ({ id, contactId: 'c1', direction: 'inbound', status: 'delivered', dateAdded: new Date(now - (500 + n) * DAY).toISOString(), body: 'old' });

// Export handler: pages of `pageSize`, cursor = page number. behave(channel, pull, page, items)
// may return { items } (a different page body), { status, message } (an error) or nothing.
function exporter(msgs, behave = () => null, pageSize = 100) {
  const pulls = {}, hits = [];
  const fn = q => {
    const ch = q.channel;
    if (['FB', 'IG', 'GMB', 'Live_Chat'].includes(ch)) { hits.push(`${ch}`); return { status: 400, body: { message: 'Invalid channel' } }; }
    if (!q.cursor) pulls[ch] = (pulls[ch] || 0) + 1;
    const page = Number(q.cursor || 0), pull = pulls[ch];
    hits.push(`${ch}#${pull}p${page}`);
    const all = msgs[ch] || [];
    let items = all.slice(page * pageSize, (page + 1) * pageSize);
    let next = (page + 1) * pageSize < all.length ? String(page + 1) : null;
    const b = behave(ch, pull, page, items, all);
    if (b?.status) return { status: b.status, body: { message: b.message || 'mock error' } };
    if (b?.items) items = b.items;
    if (b && 'next' in b) next = b.next;
    return { body: { messages: items, nextCursor: next } };
  };
  fn.hits = hits; fn.pulls = pulls;
  return fn;
}

// ---------- a temp repo with one firm ----------
async function makeRepo() {
  const tmp = await mkdtemp(join(tmpdir(), 'lpk-msg-'));
  await cp(join(ROOT, 'scripts'), join(tmp, 'scripts'), { recursive: true });
  await mkdir(join(tmp, 'firms', 'fx'), { recursive: true });
  await cp(join(ROOT, 'firms/_defaults.json'), join(tmp, 'firms/_defaults.json'));
  await cp(join(ROOT, 'firms/_defaults'), join(tmp, 'firms/_defaults'), { recursive: true });
  await cp(join(ROOT, 'firms/mahdavi/config.json'), join(tmp, 'firms/fx/config.json'));
  return tmp;
}
async function sync(tmp, handler, { pass = '' } = {}) {
  const mock = await startMockGhl(discovery, 0, { exportHandler: handler });
  let stdout = '', stderr = '', code = 0;
  try {
    ({ stdout, stderr } = await run(process.execPath, [join(tmp, 'scripts/sync.mjs'), 'fx'], {
      env: { PATH: process.env.PATH, GHL_API_BASE: mock.url, GHL_TOKEN: 'mock', DASHBOARD_PASSPHRASE: pass, GHL_BACKOFF_MS: '5' } }));
  } catch (e) { code = e.code || 1; stdout = e.stdout || ''; stderr = e.stderr || e.message; }
  finally { await mock.close(); }
  const kpis = await readJSON(join(tmp, 'firms/fx/data/kpis.json')).catch(() => null);
  return { code, out: stdout + stderr, kpis };
}
const details = async (tmp, pass) => decryptJSON(await readJSON(join(tmp, 'firms/fx/data/details.enc.json')), pass);
const nums = k => { const c = k.periods.last30.current; return { missedCalls: c.missedCalls, missedNotReturned: c.missedNotReturned, contacted: c.contacted, speedToLeadAvgMin: c.speedToLeadAvgMin, within5: c.within5 }; };
const shortOf = (n, field = 'Call') => (ch, pull, page, items) => (ch === field ? { items: items.slice(0, n), next: null } : null);

// ---------- the tests ----------
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, what) => { if (!v) throw new Error(what); };

test('Short pulls are combined (2 pulls, a 3rd when they differ)', async tmp => {
  const h = exporter(world(), (ch, pull, page, items) => (ch === 'Call' && pull === 1 ? { items: items.slice(0, 20), next: null } : null));
  const r = await sync(tmp, h);
  eq(r.code, 0, 'exit code'); eq(r.kpis.sync.counts.Call, 30, 'calls kept'); eq(h.pulls.Call, 3, 'Call pulls'); eq(h.pulls.SMS, 2, 'SMS pulls (identical, no 3rd)');
  eq(r.kpis.sync.counts.SMS, 8, 'SMS replies (no STOP, no outbound)'); eq(r.kpis.sync.counts.Email, 6, 'email replies');
  eq(r.kpis.periods.last30.current.missedCalls, 10, 'missed calls');
});

test('Earlier syncs carry forward: a short GHL answer changes nothing', async tmp => {
  const w = world();
  const a = await sync(tmp, exporter(w), { pass: PASS });
  const b = await sync(tmp, exporter(w, (ch, pull, page, items) => (['Call', 'SMS', 'Email'].includes(ch) ? { items: items.slice(0, 5), next: null } : null)), { pass: PASS });
  eq(b.code, 0, 'exit code');
  eq(b.kpis.sync.counts, a.kpis.sync.counts, 'counts');
  eq(nums(b.kpis), nums(a.kpis), 'call/contact KPIs');
  ok(b.kpis.generatedAt !== a.kpis.generatedAt, 'published (not held)');
  ok(/carried forward/.test(b.out), 'log mentions carried forward');
});

test('A call deleted in GHL stays counted until it leaves the window', async tmp => {
  const w = world();
  await sync(tmp, exporter(w), { pass: PASS });
  const w2 = { ...w, Call: w.Call.filter(k => k.id !== 'k1') };
  const r = await sync(tmp, exporter(w2), { pass: PASS });
  eq(r.kpis.sync.counts.Call, 30, 'still counted');
  const d = await details(tmp, PASS);
  ok(d.calls.some(k => k.id === 'k1'), 'k1 still in calls');
});

test('Message log stores only ids, channel, direction, status, duration and time', async tmp => {
  await sync(tmp, exporter(world()), { pass: PASS });
  const d = await details(tmp, PASS);
  const allowed = { Call: ['id', 'contactId', 'channel', 'direction', 'status', 'durationSec', 'at'], other: ['id', 'contactId', 'channel', 'direction', 'status', 'at'] };
  for (const e of d.messageLog.items) eq(Object.keys(e).sort(), [...(e.channel === 'Call' ? allowed.Call : allowed.other)].sort(), `fields of ${e.id}`);
  ok(!/secret/.test(JSON.stringify(d)), 'no message bodies or subjects anywhere in the details file');
  eq(d.messageLog.items.length, 30 + 8 + 6, 'log size (calls + inbound replies; no STOP, no outbound)');
});

test("Previous file can't be decrypted: starts fresh, warns, doesn't fail", async tmp => {
  await sync(tmp, exporter(world()), { pass: PASS });
  const r = await sync(tmp, exporter(world()), { pass: 'a different passphrase' });
  eq(r.code, 0, 'exit code'); ok(/couldn't be decrypted/.test(r.out), 'warning logged'); eq(r.kpis.sync.counts.Call, 30, 'calls from this pull');
  const d = await details(tmp, 'a different passphrase'); eq(d.messageLog.items.length, 44, 'new log written with the new passphrase');
});

test('Previous file missing: starts fresh, warns, doesn\'t fail', async tmp => {
  const r = await sync(tmp, exporter(world()), { pass: PASS });
  eq(r.code, 0, 'exit code'); ok(/no previous details file/.test(r.out), 'warning logged'); eq(r.kpis.sync.counts.Call, 30, 'calls');
});

test('First sync after the upgrade seeds the log from the previous calls', async tmp => {
  const a = await sync(tmp, exporter(world()), { pass: PASS });
  const d = await details(tmp, PASS); delete d.messageLog;          // what an older sync left behind
  const { encryptJSON } = await import('../../scripts/kpi-core.mjs');
  await writeFile(join(tmp, 'firms/fx/data/details.enc.json'), JSON.stringify(await encryptJSON(d, PASS)));
  const r = await sync(tmp, exporter(world(), shortOf(10)), { pass: PASS });
  eq(r.kpis.sync.counts.Call, 30, 'calls carried from the old file'); eq(nums(r.kpis), nums(a.kpis), 'KPIs');
});

test('Hold: a short pull with nothing to carry keeps the previous numbers, then publishes after 3 holds', async tmp => {
  const w = world();
  const a = await sync(tmp, exporter(w));                            // no passphrase: nothing carried forward
  const states = [];
  for (let i = 1; i <= 4; i++) {
    const r = await sync(tmp, exporter(w, shortOf(10)));
    states.push({ held: r.kpis.generatedAt === a.kpis.generatedAt, holds: r.kpis.sync.holds, incomplete: r.kpis.sync.incomplete, calls: r.kpis.sync.counts.Call });
    if (i <= 3) { eq(r.kpis.periods, a.kpis.periods, `hold ${i}: numbers unchanged`); ok(/held \(\d of 3\)/.test(r.out), `hold ${i} logged`); }
  }
  eq(states, [{ held: true, holds: 1, incomplete: false, calls: 30 }, { held: true, holds: 2, incomplete: false, calls: 30 }, { held: true, holds: 3, incomplete: false, calls: 30 }, { held: false, holds: 0, incomplete: true, calls: 10 }], 'hold sequence');
  const back = await sync(tmp, exporter(w));
  eq([back.kpis.sync.incomplete, back.kpis.sync.counts.Call], [false, 30], 'clears at the next full sync');
});

test('The "may be incomplete" note stays while counts are short, then clears when they recover', async tmp => {
  const w = world();
  await sync(tmp, exporter(w));
  for (let i = 1; i <= 4; i++) await sync(tmp, exporter(w, shortOf(10)));     // 3 holds, then published as incomplete
  const still = await sync(tmp, exporter(w, shortOf(12)));                     // still short of the pre-hold 30
  eq([still.kpis.sync.incomplete, still.kpis.sync.holds, still.kpis.sync.baseline?.Call], [true, 0, 30], 'note stays, no new hold');
  ok(/note stays up/.test(still.out), 'logged');
  const near = await sync(tmp, exporter(w, shortOf(28)));                      // within 10% of 30
  eq([near.kpis.sync.incomplete, near.kpis.sync.baseline], [false, null], 'cleared once back near the pre-hold count');
});

test('The note clears after 24 hours even if counts stay short', async tmp => {
  const w = world();
  await sync(tmp, exporter(w));
  for (let i = 1; i <= 4; i++) await sync(tmp, exporter(w, shortOf(10)));
  const f = join(tmp, 'firms/fx/data/kpis.json'), k = await readJSON(f);
  k.sync.incompleteSince = new Date(Date.now() - 25 * 36e5).toISOString();
  await writeFile(f, JSON.stringify(k));
  const r = await sync(tmp, exporter(w, shortOf(10)));
  eq([r.kpis.sync.incomplete, r.kpis.sync.holds], [false, 0], 'cleared, not held');
  ok(/cleared after 24 hours/.test(r.out), 'logged');
});

test('A small real drop is published, not held', async tmp => {
  const w = world();
  await sync(tmp, exporter(w));
  const r = await sync(tmp, exporter({ ...w, Call: w.Call.slice(0, 26) }));   // 4 fewer: under the 5-message minimum
  eq([r.kpis.sync.holds, r.kpis.sync.counts.Call], [0, 26], 'published');
});

test('A page that keeps failing marks the channel incomplete, not zero', async tmp => {
  const w = world(); w.Email = Array.from({ length: 250 }, (_, i) => ({ id: `em${i}`, contactId: `c${(i % 10) + 1}`, direction: 'inbound', status: 'x', dateAdded: new Date(Date.now() - DAY - i * MIN).toISOString(), body: 'secret' }));
  const h = exporter(w, (ch, pull, page) => (ch === 'Email' && page === 1 ? { status: 500, message: "Cannot read properties of undefined (reading 'thread_id')" } : null));
  const r = await sync(tmp, h);
  eq(r.code, 0, 'exit code'); eq(r.kpis.sync.channels.Email, 'incomplete', 'state'); eq(r.kpis.sync.counts.Email, 100, 'kept page 1');
  eq(h.hits.filter(x => /^Email#1p1$/.test(x)).length, 4, 'page retried 3 times');
  ok(/Email pull incomplete/.test(r.out), 'warning logged');
});

test('A one-off 500 and a 429 are retried and the pull completes', async tmp => {
  let n500 = 0, n429 = 0;
  const h = exporter(world(), ch => (ch === 'Call' && n500++ < 1 ? { status: 500 } : ch === 'SMS' && n429++ < 2 ? { status: 429 } : null));
  const r = await sync(tmp, h);
  eq([r.kpis.sync.channels.Call, r.kpis.sync.channels.SMS, r.kpis.sync.counts.Call, r.kpis.sync.counts.SMS], ['complete', 'complete', 30, 8], 'complete');
  ok(!/incomplete/.test(r.out), 'no warning');
});

test("A channel GHL doesn't offer (400) is unavailable: pulled once, no hold, no warning", async tmp => {
  const h = exporter(world());
  const r = await sync(tmp, h);
  eq(r.kpis.sync.counts.FB, null, 'FB count'); eq(r.kpis.sync.channels.FB, 'unavailable', 'FB state'); eq(h.hits.filter(x => x === 'FB').length, 1, 'FB requests');
});

test('A call listed twice is counted once', async tmp => {
  const w = world(); w.Call = [...w.Call, w.Call[0]];
  const r = await sync(tmp, exporter(w));
  eq([r.kpis.sync.counts.Call, r.kpis.periods.last30.current.missedCalls], [30, 10], 'calls, missed');
});

test('Unordered pages: paging stops only once a whole page is older than the window', async tmp => {
  const w = world(), now = Date.now();
  const inWin = (i) => ({ id: `u${i}`, contactId: `c${(i % 10) + 1}`, direction: 'inbound', status: 'x', dateAdded: new Date(now - DAY - i * MIN).toISOString() });
  // page 0: 60 in window + 40 old; page 1: 30 in window + 70 old; page 2: all old
  w.Email = [...Array.from({ length: 60 }, (_, i) => inWin(i)), ...Array.from({ length: 40 }, (_, i) => old(`o${i}`, i)),
    ...Array.from({ length: 30 }, (_, i) => inWin(100 + i)), ...Array.from({ length: 70 }, (_, i) => old(`p${i}`, i)),
    ...Array.from({ length: 100 }, (_, i) => old(`q${i}`, i))];
  const r = await sync(tmp, exporter(w));
  eq(r.kpis.sync.counts.Email, 90, 'in-window replies across both mixed pages');
});

test('An error past the window edge is not "incomplete"', async tmp => {
  const w = world(), now = Date.now();
  w.Email = [...Array.from({ length: 50 }, (_, i) => ({ id: `v${i}`, contactId: 'c1', direction: 'inbound', status: 'x', dateAdded: new Date(now - DAY - i * MIN).toISOString() })),
    ...Array.from({ length: 50 }, (_, i) => old(`w${i}`, i)), ...Array.from({ length: 100 }, (_, i) => old(`y${i}`, i))];
  const r = await sync(tmp, exporter(w, (ch, pull, page) => (ch === 'Email' && page === 1 ? { status: 500 } : null)));
  eq([r.kpis.sync.channels.Email, r.kpis.sync.counts.Email], ['complete', 50], 'complete');
});

// ---------- run ----------
const results = [];
for (const t of tests.filter(t => !only || t.name.toLowerCase().includes(only.toLowerCase()))) {
  const tmp = await makeRepo();
  const t0 = Date.now();
  try { await t.fn(tmp); results.push({ name: t.name, pass: true, ms: Date.now() - t0 }); }
  catch (e) { results.push({ name: t.name, pass: false, ms: Date.now() - t0, error: e.message }); }
  finally { await rm(tmp, { recursive: true, force: true }); }
}
console.log('\nCall and message sync tests\n');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  (${(r.ms / 1000).toFixed(1)} s)${r.error ? `\n      ${r.error}` : ''}`);
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed} of ${results.length} tests pass.`);
process.exit(failed ? 1 : 0);
