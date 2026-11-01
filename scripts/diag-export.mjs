// Diagnostic, read-only: pulls GHL's conversation-message export several times in a row and
// reports, page by page, what came back. Prints counts, dates, timings and rate-limit headers
// only: no message text, contact data or ids are printed or written.
//
// Usage: GHL_TOKEN=… node scripts/diag-export.mjs <slug> [passes=3] [channels=Call,SMS,Email,WhatsApp]
// Run from .github/workflows/diag-export.yml so the firm's token never leaves GitHub.

import { createHash } from 'node:crypto';
import { checkSlug, loadFirmConfig } from './firms.mjs';

const SLUG = process.argv[2];
const err = checkSlug(SLUG); if (err) { console.error(err); process.exit(1); }
const PASSES = Math.min(Math.max(Number(process.argv[3]) || 3, 1), 6);
const CHANNELS = (process.argv[4] || 'Call,SMS,Email,WhatsApp').split(',').map(s => s.trim()).filter(Boolean);
const TOKEN = process.env.GHL_TOKEN; if (!TOKEN) { console.error('GHL_TOKEN missing'); process.exit(1); }
const cfg = await loadFirmConfig(SLUG);
const LOC = cfg.locationId; if (!LOC) { console.error('No locationId'); process.exit(1); }
const API = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';
const now = Date.now(), since = now - cfg.lookbackDays * 864e5;
const MAX_PAGES = 120;   // sync uses 100 (messages) / 50 (calls)
const sleep = ms => new Promise(r => setTimeout(r, ms));
const day = t => (t ? new Date(t).toISOString().slice(0, 10) : '—');

async function get(path) {
  const t0 = Date.now(); let retries = 0;
  for (;;) {
    let res;
    try { res = await fetch(API + path, { headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}`, Version: '2021-07-28' } }); }
    catch (e) { return { status: 0, ms: Date.now() - t0, retries, error: e.message }; }
    const rl = { remaining: res.headers.get('x-ratelimit-remaining'), max: res.headers.get('x-ratelimit-max'), daily: res.headers.get('x-ratelimit-daily-remaining') };
    if (res.status === 429 && retries < 4) { retries++; await sleep(2000 * retries); continue; }
    const body = res.ok ? await res.json().catch(() => null) : null;
    return { status: res.status, ms: Date.now() - t0, retries, rl, body, error: res.ok ? null : (await res.text().catch(() => '')).slice(0, 120) };
  }
}

const h = s => createHash('sha256').update(s).digest('hex').slice(0, 10);
const results = {};   // channel -> [pass summaries]
for (let pass = 1; pass <= PASSES; pass++) {
  for (const channel of CHANNELS) {
    const pages = []; const ids = new Set(); let dupes = 0, cursor, syncStopPage = null, syncStopReason = null, stop = 'max pages';
    for (let i = 0; i < MAX_PAGES; i++) {
      const q = new URLSearchParams({ locationId: LOC, channel, limit: '100' }); if (cursor) q.set('cursor', cursor);
      const r = await get(`/conversations/messages/export?${q}`);
      if (r.status !== 200) { pages.push({ i, status: r.status, ms: r.ms, retries: r.retries, error: r.error }); stop = `HTTP ${r.status}`; break; }
      const batch = r.body?.messages || [];
      const times = batch.map(m => Date.parse(m.dateAdded)).filter(Number.isFinite);
      for (const m of batch) { if (ids.has(m.id)) dupes++; ids.add(m.id); }
      const oldest = times.length ? Math.min(...times) : null, newest = times.length ? Math.max(...times) : null;
      const ordered = times.every((t, j) => j === 0 || t <= times[j - 1]);
      pages.push({ i, status: 200, ms: r.ms, retries: r.retries, n: batch.length, newest, oldest, ordered, next: !!r.body?.nextCursor, inWindow: times.filter(t => t >= since).length, rl: r.rl });
      // where the SYNC would have stopped (same rule as scripts/sync.mjs)
      if (syncStopPage === null && (!r.body?.nextCursor || batch.length === 0 || (oldest ?? now) < since)) {
        syncStopPage = i; syncStopReason = !r.body?.nextCursor ? 'no nextCursor' : batch.length === 0 ? 'empty page' : 'oldest < window';
      }
      if (!r.body?.nextCursor || batch.length === 0) { stop = !r.body?.nextCursor ? 'no nextCursor' : 'empty page'; break; }
      cursor = r.body.nextCursor;
    }
    const inWindowAll = pages.reduce((n, p) => n + (p.inWindow || 0), 0);
    const inWindowSync = pages.filter(p => syncStopPage !== null && p.i <= syncStopPage).reduce((n, p) => n + (p.inWindow || 0), 0);
    const s = { pass, pages: pages.length, stop, unique: ids.size, dupes, inWindowAll, syncStopPage, syncStopReason, inWindowSync,
      unordered: pages.filter(p => p.ordered === false).length, short: pages.filter(p => p.status === 200 && p.n < 100 && p.next).length,
      retries: pages.reduce((n, p) => n + (p.retries || 0), 0), slowest: Math.max(...pages.map(p => p.ms)), errors: pages.filter(p => p.status !== 200).map(p => `${p.status} ${p.error || ''}`.trim()),
      idHash: h([...ids].sort().join(',')), minRemaining: Math.min(...pages.map(p => p.rl?.remaining).filter(v => v != null && v !== '').map(Number)), pageList: pages };
    (results[channel] ||= []).push(s);
    console.log(`pass ${pass} ${channel.padEnd(9)} pages=${s.pages} stop="${s.stop}" unique=${s.unique} dupes=${s.dupes} inWindow(all pages)=${s.inWindowAll} | sync would stop at page ${s.syncStopPage} (${s.syncStopReason}) keeping ${s.inWindowSync} | unordered pages=${s.unordered} short-but-more pages=${s.short} 429 retries=${s.retries} slowest=${s.slowest}ms minRemaining=${s.minRemaining} ids#${s.idHash}${s.errors.length ? ' errors=' + s.errors.join('|') : ''}`);
  }
}

console.log('\nPage detail (first pass that differs from the others, per channel):');
for (const [ch, list] of Object.entries(results)) {
  const counts = list.map(s => s.inWindowSync);
  const consistent = counts.every(c => c === counts[0]) && list.every(s => s.idHash === list[0].idHash);
  console.log(`\n${ch}: sync-equivalent counts per pass ${JSON.stringify(counts)}; all-pages counts ${JSON.stringify(list.map(s => s.inWindowAll))}; ${consistent ? 'CONSISTENT' : 'INCONSISTENT'}`);
  if (consistent) continue;
  for (const s of list) {
    console.log(`  pass ${s.pass}: ${s.pageList.map(p => p.status !== 200 ? `[${p.i}: HTTP ${p.status}]` : `[${p.i}: n=${p.n} ${day(p.newest)}→${day(p.oldest)}${p.next ? '' : ' END'}${p.ordered ? '' : ' UNORDERED'} ${p.ms}ms]`).join(' ')}`);
  }
}
