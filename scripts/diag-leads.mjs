// Diagnostic, read-only: are real leads missing from the "New leads" count?
// Counts opportunities by pipeline, new contacts, new contacts with no opportunity in any
// pipeline (by source, type, attribution and tag), and inbound calls / messages from contacts
// with no opportunity. Prints COUNTS ONLY: no names, phones, emails, ids or message content.
// Writes nothing and commits nothing.
//
// Usage: GHL_TOKEN=… node scripts/diag-leads.mjs <slug>
// Run from .github/workflows/diag-leads.yml so the firm's token never leaves GitHub.

import { checkSlug, loadFirmConfig } from './firms.mjs';

const SLUG = process.argv[2];
const err = checkSlug(SLUG); if (err) { console.error(err); process.exit(1); }
const TOKEN = process.env.GHL_TOKEN; if (!TOKEN) { console.error('GHL_TOKEN missing'); process.exit(1); }
const cfg = await loadFirmConfig(SLUG);
const LOC = cfg.locationId; if (!LOC) { console.error('No locationId'); process.exit(1); }
const API = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';
const DAY = 864e5, now = Date.now();
const d30 = now - 30 * DAY, d60 = now - 60 * DAY, d90 = now - 90 * DAY;
const norm = s => String(s ?? '').trim().toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t = v => Date.parse(v) || (Number.isFinite(Number(v)) ? Number(v) : 0);

async function ghl(path, { method = 'GET', body } = {}) {
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(2000 * attempt);
    let res;
    try {
      res = await fetch(API + path, { method, headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, Version: '2021-07-28' }, body: body ? JSON.stringify(body) : undefined });
    } catch (e) { last = new Error(`network error on ${path.split('?')[0]}`); continue; }
    if (res.status === 429 || res.status >= 500) { last = new Error(`HTTP ${res.status} on ${path.split('?')[0]}`); continue; }
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} on ${path.split('?')[0]}`), { status: res.status });
    return res.json();
  }
  throw last;
}

const tally = () => new Map();
const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);
const show = (title, m, top = 25) => {
  const rows = [...m].sort((a, b) => b[1] - a[1]);
  console.log(`  ${title}:${rows.length ? '' : ' (none)'}`);
  for (const [k, n] of rows.slice(0, top)) console.log(`    ${String(n).padStart(5)}  ${k}`);
  if (rows.length > top) console.log(`    … ${rows.length - top} more values`);
};
const pct = (a, b) => (b ? ` (${Math.round((100 * a) / b)}%)` : '');

// ---------- 1. Opportunities by pipeline ----------
const { pipelines = [] } = await ghl(`/opportunities/pipelines?locationId=${LOC}`);
const pName = Object.fromEntries(pipelines.map(p => [p.id, p.name]));
const opps = [];
{
  let page = 1, startAfter, startAfterId;
  for (let guard = 0; guard < 300; guard++) {
    const q = new URLSearchParams({ location_id: LOC, limit: '100' });
    if (startAfter) { q.set('startAfter', startAfter); q.set('startAfterId', startAfterId); } else q.set('page', String(page));
    const r = await ghl(`/opportunities/search?${q}`);
    const batch = r.opportunities || [];
    opps.push(...batch);
    if (batch.length < 100) break;   // all opportunities, any age: needed to know who has one
    if (r.meta?.startAfter && r.meta?.startAfterId) { startAfter = r.meta.startAfter; startAfterId = r.meta.startAfterId; } else page++;
  }
}
const oppContact = o => o.contactId || o.contact?.id || null;
const withOpp = new Set(opps.map(oppContact).filter(Boolean));
const leadPipes = new Set((cfg.pipelines || []).map(norm));
const inLeadPipe = o => !leadPipes.size || leadPipes.has(norm(pName[o.pipelineId]));
const withLeadOpp = new Set(opps.filter(inLeadPipe).map(oppContact).filter(Boolean));

console.log(`\n=== ${SLUG}: lead diagnostic, ${new Date(now).toISOString().slice(0, 16)}Z (rolling windows) ===`);
console.log(`Dashboard "New leads" counts opportunities created in: ${(cfg.pipelines || []).join(', ') || 'every pipeline'}\n`);
console.log(`1. Opportunities (all ${opps.length} pulled; ${withOpp.size} distinct contacts have one)`);
console.log(`  ${'Pipeline'.padEnd(40)} last30  prev30(31-60)  last90  all-time`);
const pids = [...new Set([...pipelines.map(p => p.id), ...opps.map(o => o.pipelineId)])];
for (const id of pids) {
  const os = opps.filter(o => o.pipelineId === id), c = a => os.filter(o => t(o.createdAt) >= a).length;
  console.log(`  ${(pName[id] || 'unknown pipeline').padEnd(40)} ${String(c(d30)).padStart(6)}  ${String(os.filter(o => t(o.createdAt) >= d60 && t(o.createdAt) < d30).length).padStart(13)}  ${String(c(d90)).padStart(6)}  ${String(os.length).padStart(8)}`);
}
const stat30 = tally(); for (const o of opps.filter(o => t(o.createdAt) >= d90)) bump(stat30, `${pName[o.pipelineId] || 'unknown'} / ${o.status || '?'}`);
show('Opportunities created in last 90 days by pipeline / status', stat30);

// ---------- 2. Contacts created in the last 90 days ----------
let contacts = [], contactsVia = '', contactsTotal = null;
try {
  for (let page = 1; page <= 100; page++) {
    const r = await ghl('/contacts/search', { method: 'POST', body: { locationId: LOC, page, pageLimit: 100, sort: [{ field: 'dateAdded', direction: 'desc' }] } });
    const batch = r.contacts || []; contactsTotal ??= r.total ?? null;
    contacts.push(...batch);
    if (batch.length < 100 || Math.min(...batch.map(c => t(c.dateAdded))) < d90) break;
  }
  contactsVia = 'POST /contacts/search (newest first)';
} catch (e) {
  console.log(`(contacts search unavailable: ${e.message}; falling back to GET /contacts)`);
  contacts = []; let startAfter, startAfterId;
  for (let guard = 0; guard < 200; guard++) {
    const q = new URLSearchParams({ locationId: LOC, limit: '100' });
    if (startAfterId) { q.set('startAfter', startAfter); q.set('startAfterId', startAfterId); }
    const r = await ghl(`/contacts/?${q}`);
    const batch = r.contacts || []; contactsTotal ??= r.meta?.total ?? null;
    contacts.push(...batch);
    if (batch.length < 100 || !r.meta?.startAfterId) break;
    startAfter = r.meta.startAfter; startAfterId = r.meta.startAfterId;
  }
  contactsVia = 'GET /contacts (all pages)';
}
const recent = contacts.filter(c => t(c.dateAdded) >= d90);
const r30 = recent.filter(c => t(c.dateAdded) >= d30);
const noOpp = c => !withOpp.has(c.id);
console.log(`\n2. Contacts (${contactsVia}; location total reported: ${contactsTotal ?? 'n/a'})`);
for (const [label, list] of [['last 30 days', r30], ['last 90 days', recent], ['previous 30 (31-60 days)', recent.filter(c => t(c.dateAdded) >= d60 && t(c.dateAdded) < d30)]]) {
  const no = list.filter(noOpp).length, otherOnly = list.filter(c => withOpp.has(c.id) && !withLeadOpp.has(c.id)).length;
  console.log(`  Created ${label.padEnd(26)} ${String(list.length).padStart(4)} | no opportunity in any pipeline: ${no}${pct(no, list.length)} | opportunity only outside ${[...leadPipes].join('/') || 'lead pipelines'}: ${otherOnly} | in lead pipeline: ${list.filter(c => withLeadOpp.has(c.id)).length}`);
}

// ---------- 3. New contacts without an opportunity: what are they? ----------
const describe = (label, list) => {
  console.log(`\n3. ${label}: ${list.length} contacts`);
  const src = tally(), typ = tally(), attr = tally(), created = tally(), tags = tally(), reach = tally();
  for (const c of list) {
    bump(src, c.source || '(no source)');
    bump(typ, c.type || '(no type)');
    const a = c.attributionSource || c.attributions?.[0] || {};
    bump(attr, [a.medium, a.sessionSource || a.utmSource].filter(Boolean).join(' / ') || '(no attribution)');
    bump(created, [c.createdBy?.source, c.createdBy?.channel].filter(Boolean).join(' / ') || '(not recorded)');
    for (const tg of c.tags || []) bump(tags, norm(tg));
    if (!(c.tags || []).length) bump(tags, '(no tags)');
    bump(reach, `${c.phone ? 'phone' : 'no phone'} + ${c.email ? 'email' : 'no email'}${c.dnd ? ' (DND on)' : ''}`);
  }
  show('By contact source', src); show('By contact type', typ); show('By attribution (medium / source)', attr);
  show('By created-by (source / channel)', created); show('By tag (top 25)', tags); show('Has phone / email', reach);
};
describe('Created in the last 30 days with no opportunity', r30.filter(noOpp));
describe('Created in the last 90 days with no opportunity', recent.filter(noOpp));

// ---------- 4. Inbound calls and messages, last 30 days ----------
// The export endpoint returns a different subset on each pull, so pull twice and combine (as the sync does).
const recentIds = new Set(recent.map(c => c.id)), r30Ids = new Set(r30.map(c => c.id));
console.log('\n4. Inbound in the last 30 days (export pulled twice per channel and combined)');
const noOppInbound = new Map();   // contactId -> Set(channels), for contacts with no opportunity
for (const channel of ['Call', 'SMS', 'Email', 'WhatsApp', 'Live_Chat', 'FB', 'IG']) {
  const got = new Map(); let state = 'ok';
  for (let pass = 0; pass < 2; pass++) {
    let cursor;
    for (let i = 0; i < 100; i++) {
      const q = new URLSearchParams({ locationId: LOC, channel, limit: '100' }); if (cursor) q.set('cursor', cursor);
      let r; try { r = await ghl(`/conversations/messages/export?${q}`); } catch (e) { state = e.status === 400 || e.status === 422 ? 'not offered' : `stopped (${e.message})`; break; }
      const batch = r.messages || []; let newest = -Infinity;
      for (const m of batch) { const at = t(m.dateAdded); newest = Math.max(newest, at); if (at >= d30) got.set(m.id ?? `${m.dateAdded}|${m.contactId}|${m.direction}`, m); }
      if (!r.nextCursor || !batch.length || newest < d30) break;
      cursor = r.nextCursor;
    }
    if (state === 'not offered') break;
  }
  if (state === 'not offered') { console.log(`  ${channel.padEnd(9)} channel not offered by the export`); continue; }
  const inbound = [...got.values()].filter(m => norm(m.direction) === 'inbound');
  const cs = new Set(inbound.map(m => m.contactId).filter(Boolean));
  const no = [...cs].filter(id => !withOpp.has(id));
  for (const id of no) (noOppInbound.get(id) || noOppInbound.set(id, new Set()).get(id)).add(channel);
  const noMsgs = inbound.filter(m => m.contactId && !withOpp.has(m.contactId));
  let extra = '';
  if (channel === 'Call') { const st = tally(); for (const m of noMsgs) bump(st, norm(m.meta?.call?.status || m.status) || '?'); extra = ` | their call statuses: ${[...st].map(([k, n]) => `${k} ${n}`).join(', ') || '—'}`; }
  console.log(`  ${channel.padEnd(9)} inbound ${String(inbound.length).padStart(4)} from ${cs.size} contacts | from contacts with NO opportunity: ${noMsgs.length} messages, ${no.length} contacts (${no.filter(id => r30Ids.has(id)).length} created in last 30d, ${no.filter(id => recentIds.has(id) && !r30Ids.has(id)).length} in 31-90d, ${no.filter(id => !recentIds.has(id)).length} older)${extra}${state !== 'ok' ? ` [${state}]` : ''}`);
}
const ids = [...noOppInbound.keys()];
console.log(`  Distinct contacts with NO opportunity who called or messaged in (any channel above): ${ids.length} (${ids.filter(id => r30Ids.has(id)).length} created in last 30d, ${ids.filter(id => recentIds.has(id) && !r30Ids.has(id)).length} in 31-90d, ${ids.filter(id => !recentIds.has(id)).length} older)`);
const combo = tally(); for (const s of noOppInbound.values()) bump(combo, [...s].sort().join(' + ')); show('Their channels', combo);
console.log('\nDone. Counts only; nothing written.');
