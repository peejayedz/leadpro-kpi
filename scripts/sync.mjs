// Pulls one firm's data from the GoHighLevel API v2 and writes, inside firms/<slug>/:
//   data/kpis.json         public: aggregate numbers only (no names/phones/emails)
//   data/details.enc.json  encrypted contact-level records for custom dates and drill-downs
// Usage: node scripts/sync.mjs <slug>
// Normally started per firm by scripts/sync-all.mjs from .github/workflows/sync.yml.
//
// Env: GHL_TOKEN (read-only Private Integration Token for this firm's sub-account),
//      GHL_LOCATION_ID (optional; config.json locationId wins),
//      DASHBOARD_PASSPHRASE (team passphrase that unlocks names, custom dates and drill-downs),
//      SYNC_RESULT_FILE (optional; sync.yml sets it): where to write this sync's result for the
//      admin page's notifications. Success, or the failure's category from scripts/sync-status.mjs
//      (token / scope / ghl / config / unknown). No error text, tokens or contact data go in it.

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { computeAll, encryptJSON, decryptJSON, tzOffsetMin } from './kpi-core.mjs';
import { checkSlug, loadFirmConfig } from './firms.mjs';
import { checkScopes, scopeForPath } from './scope-check.mjs';
import { areaForPath } from './sync-status.mjs';
import { pickNotInPipeline, breakdown, countedIn } from './not-in-pipeline.mjs';

const SLUG = process.argv[2];

// ---------- result for the admin page's notifications ----------
// Any error that stops the sync lands in the handler below, which sorts it into a category,
// writes SYNC_RESULT_FILE and exits 1. A finished sync (published or held) writes ok: true.
const RESULT_FILE = process.env.SYNC_RESULT_FILE || '';
let resultWritten = false;
let resultExtra = {};   // counts-only additions to a successful result (the came-in-by breakdown)
function writeResult(r) {
  if (!RESULT_FILE || resultWritten) return;
  resultWritten = true;
  mkdirSync(dirname(RESULT_FILE), { recursive: true });
  writeFileSync(RESULT_FILE, JSON.stringify({ slug: SLUG, at: new Date().toISOString(), ...r }) + '\n');
}
const failure = (category, detail, msg, extra = {}) => Object.assign(new Error(msg), { category, detail, ...extra });
process.on('exit', code => { if (code === 0) writeResult({ ok: true, ...resultExtra }); });
process.on('uncaughtException', e => {
  classify(e).catch(() => ({ category: 'unknown', detail: 'crash' })).then(c => {
    console.error(`Sync failed (${c.category}${c.detail ? `: ${c.detail}` : ''}${c.scopes?.length ? `: ${c.scopes.join(', ')}` : ''}): ${e.message}`);
    if (process.env.GITHUB_ACTIONS) console.log(`::error::${SLUG}: sync failed (${c.category}${c.scopes?.length ? `, missing ${c.scopes.join(', ')}` : ''}). See the admin page's notifications for what to do.`);
    if (c.category === 'unknown') console.error(e.stack);
    writeResult({ ok: false, ...c });
    process.exit(1);
  });
});

const slugErr = checkSlug(SLUG);
if (slugErr) throw failure('config', 'bad-slug', slugErr);
const firmDir = new URL(`../firms/${SLUG}/`, import.meta.url);
const dataDir = new URL('data/', firmDir);

const API = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';
let cfg;   // _defaults.json → practice-area defaults → firm config.json
try { cfg = await loadFirmConfig(SLUG); }
catch (e) { throw failure('config', /^No firms\//.test(e.message) ? 'no-config' : 'bad-config', `Firm config: ${e.message}`); }
const TOKEN = process.env.GHL_TOKEN;
const LOC = cfg.locationId || process.env.GHL_LOCATION_ID;
const PASS = process.env.DASHBOARD_PASSPHRASE || '';
if (!TOKEN) throw failure('token', 'missing-secret', `Missing GHL token for ${SLUG}`);
if (!LOC) throw failure('config', 'no-location', `Missing location ID for ${SLUG}`);

const QUAL = cfg.qualification || {};
const DAY = 864e5;
const now = Date.now();
const since = now - cfg.lookbackDays * DAY;
const norm = s => String(s ?? '').trim().toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = v => (v ? new Date(typeof v === 'number' || /^\d+$/.test(String(v)) ? Number(v) : v).toISOString() : null);

// A GitHub Actions warning annotation (shows on the run's summary page), or a plain line locally.
const warn = msg => console.log(process.env.GITHUB_ACTIONS ? `::warning::${msg}` : `Warning: ${msg}`);

// GET with retries: rate limits (429), GHL server errors (5xx) and network errors are retried up
// to 3 times with a growing pause; anything else fails at once. Errors carry the HTTP status.
const BACKOFF = Number(process.env.GHL_BACKOFF_MS ?? 2000);   // tests shorten this
async function ghl(path, { version = '2021-07-28', method = 'GET', body } = {}) {
  const where = path.split('?')[0], fail = (status, msg) => Object.assign(new Error(msg), { status, area: areaForPath(where) });
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(BACKOFF * attempt);
    let res;
    try { res = await fetch(API + path, { method, headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}`, Version: version, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
    catch (e) { last = fail(0, `GHL network error on ${where}: ${e.message}`); continue; }
    if (res.status === 429) { last = fail(429, `GHL rate limit on ${where}`); continue; }
    if (res.status >= 500) { last = fail(res.status, `GHL ${res.status} on ${where}: ${(await res.text().catch(() => '')).slice(0, 200)}`); continue; }
    if (res.status === 401 || res.status === 403) { authDenied.add(where); throw fail(res.status, `GHL ${res.status} on ${where}: token invalid or missing a scope`); }
    if (!res.ok) throw fail(res.status, `GHL ${res.status} on ${where}: ${(await res.text()).slice(0, 300)}`);
    try { return await res.json(); }
    catch (e) { last = fail(0, `GHL sent unreadable JSON on ${where}`); }
  }
  throw last;
}
// GHL refused these paths with 401/403. Optional parts of the sync carry on without them, but
// the sync then stops before publishing (stopOnAuthFailures) so no numbers go out with gaps.
const authDenied = new Set();

// Sorts an error that stopped the sync into a category for the admin page.
async function classify(e) {
  if (e.category) return { category: e.category, detail: e.detail, ...(e.area ? { area: e.area } : {}), ...(e.scopes ? { scopes: e.scopes } : {}) };
  const area = e.area ? { area: e.area } : {};
  if (e.status === 401 || e.status === 403) return authCategory([...authDenied]);
  if (e.status === 429) return { category: 'ghl', detail: 'rate-limit', ...area };
  if (e.status >= 500) return { category: 'ghl', detail: 'server', ...area };
  if (e.status === 0) return { category: 'ghl', detail: /unreadable/.test(e.message) ? 'bad-response' : 'network', ...area };
  if (e.status >= 400) return { category: 'ghl', detail: 'request-refused', ...area };
  return { category: 'unknown', detail: 'crash' };
}
// A refused request is either a token GHL won't accept at all, or a token without some scope.
// One quick read per scope tells them apart and names the missing ones.
async function authCategory(paths) {
  const probe = async path => {
    try {
      const res = await fetch(API + path, { headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}`, Version: '2021-07-28' } });
      return { status: res.status, body: res.ok ? await res.json().catch(() => ({})) : null };
    } catch { return { status: 0 }; }
  };
  const { scopes } = await checkScopes(probe, LOC);
  if (scopes.tokenRejected) return { category: 'token', detail: 'rejected' };
  const missing = [...new Set([...scopes.missing, ...paths.map(scopeForPath).filter(Boolean)])];
  return missing.length ? { category: 'scope', detail: 'missing', scopes: missing } : { category: 'token', detail: 'rejected' };
}
async function stopOnAuthFailures() {
  if (!authDenied.size) return;
  const c = await authCategory([...authDenied]);
  throw failure(c.category, c.detail, `GHL refused ${[...authDenied].join(', ')} (401/403)`, c.scopes ? { scopes: c.scopes } : {});
}

async function optional(label, fn) {
  try { return await fn(); } catch (e) { console.warn(`${label} skipped: ${e.message}`); return null; }
}

// ---------- Users (assigned-to names) ----------
const users = (await optional('users', async () => {
  const { users = [] } = await ghl(`/users/?locationId=${LOC}`);
  return Object.fromEntries(users.map(u => [u.id, u.name || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email]));
})) || {};

// ---------- Pipelines + opportunities ----------
const { pipelines = [] } = await ghl(`/opportunities/pipelines?locationId=${LOC}`);
const stageName = {}, pipelineName = {};
for (const p of pipelines) { pipelineName[p.id] = p.name; for (const s of p.stages || []) stageName[s.id] = s.name; }
// Printed in the Action log so the stage names in config.json can be matched exactly.
console.log('Pipelines and stages in GHL:');
for (const p of pipelines) console.log(`  • ${p.name}: ${(p.stages || []).map(s => s.name).join(' → ')}`);
const wanted = (cfg.pipelines || []).map(norm);
const pipelineOk = id => !wanted.length || wanted.includes(norm(pipelineName[id]));
if (wanted.length && !pipelines.some(p => wanted.includes(norm(p.name)))) console.warn(`None of config.pipelines (${cfg.pipelines.join(', ')}) match a GHL pipeline name.`);

const opps = [];
{
  let page = 1, startAfter, startAfterId;
  for (let guard = 0; guard < 200; guard++) {
    const q = new URLSearchParams({ location_id: LOC, limit: '100' });
    if (startAfter) { q.set('startAfter', startAfter); q.set('startAfterId', startAfterId); } else q.set('page', String(page));
    const r = await ghl(`/opportunities/search?${q}`);
    const batch = r.opportunities || [];
    opps.push(...batch);
    const oldest = Math.min(...batch.map(o => Date.parse(o.createdAt) || now));
    if (batch.length < 100 || oldest < since) break;
    if (r.meta?.startAfter && r.meta?.startAfterId) { startAfter = r.meta.startAfter; startAfterId = r.meta.startAfterId; } else page++;
  }
}
const recentOpps = opps.filter(o => (Date.parse(o.createdAt) || 0) >= since && pipelineOk(o.pipelineId));

// Lost reasons: names from config.turnedAway.lostReasons ({ id: name }) if given; ids are logged so they can be mapped.
const lostReasonNames = cfg.turnedAway?.lostReasons || {};
const lostIds = [...new Set(recentOpps.map(o => o.lostReasonId).filter(Boolean))];
if (lostIds.length) console.log('Lost reason ids seen:', lostIds.map(id => `${id}${lostReasonNames[id] ? ` (${lostReasonNames[id]})` : ''}`).join(', '));

// ---------- Contact custom fields ----------
const fieldIds = (await optional('customFields', async () => {
  const { customFields = [] } = await ghl(`/locations/${LOC}/customFields?model=contact`);
  const find = name => customFields.find(f => norm(f.name) === norm(name))?.id || null;
  return {
    stl: find(cfg.fields.speedToLead), firstContacted: find(cfg.fields.firstContacted), method: find(cfg.fields.contactMethod),
    qual: (QUAL.contactFields || []).map(find).filter(Boolean),
  };
})) || {};
const oppQualIds = (await optional('opportunity customFields', async () => {
  const { customFields = [] } = await ghl(`/locations/${LOC}/customFields?model=opportunity`);
  const names = (QUAL.opportunityFields || []).map(norm);
  return customFields.filter(f => names.includes(norm(f.name))).map(f => f.id);
})) || [];
const fieldVal = f => f?.fieldValueString ?? f?.fieldValue ?? f?.value ?? null;

// First-touch marketing attribution, as GHL records it on the contact.
// attributionSource = first touch, lastAttributionSource = most recent. We keep first touch
// (where the lead originally came from) and carry the fields the channel rules need.
function pickAttribution(c) {
  const a = c.attributionSource || (Array.isArray(c.attributions) ? c.attributions[0] : null) || {};
  const pick = (...keys) => { for (const k of keys) if (a[k]) return String(a[k]); return null; };
  const out = {
    referrer: pick('referrer', 'url'),
    utmSource: pick('utmSource', 'utm_source', 'sessionSource'),
    utmMedium: pick('utmMedium', 'utm_medium', 'medium'),
    campaign: pick('campaign', 'utmCampaign', 'utm_campaign'),
    gclid: pick('gclid'), msclkid: pick('msclkid'), fbclid: pick('fbclid'),
  };
  return Object.values(out).some(Boolean) ? out : null;
}

const contacts = {};
async function loadContacts(ids) {
  const todo = [...new Set(ids)].filter(id => id && !contacts[id]);
  for (let i = 0; i < todo.length; i += 5) {
    await Promise.all(todo.slice(i, i + 5).map(async id => {
      const c = (await optional(`contact ${id}`, () => ghl(`/contacts/${id}`)))?.contact;
      if (!c) { contacts[id] = { id }; return; }
      const cf = fid => (fid ? c.customFields?.find(f => f.id === fid)?.value ?? null : null);
      contacts[id] = {
        id,
        name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.companyName || c.phone || 'Unnamed',
        company: c.companyName || null, email: c.email || null, phone: c.phone || null, tags: c.tags || [], source: c.source || null,
        attribution: pickAttribution(c),
        stl: cf(fieldIds.stl), firstContacted: cf(fieldIds.firstContacted), method: cf(fieldIds.method),
        qualValues: (fieldIds.qual || []).map(cf).filter(v => v !== null && v !== ''),
      };
    }));
    await sleep(250);
  }
}
await loadContacts(recentOpps.map(o => o.contactId || o.contact?.id));

const leads = recentOpps.map(o => {
  const cid = o.contactId || o.contact?.id;
  const c = contacts[cid] || {};
  const stl = c.stl === null || c.stl === undefined || c.stl === '' ? null : Number(c.stl);
  return {
    oppId: o.id, contactId: cid,
    name: c.name || o.contact?.name || o.name, company: c.company || o.contact?.companyName || null,
    email: c.email || o.contact?.email || null, phone: c.phone || o.contact?.phone || null,
    source: o.source || c.source || 'Unknown', createdAt: iso(o.createdAt),
    assignedTo: o.assignedTo || null, pipeline: pipelineName[o.pipelineId] || '—', stage: stageName[o.pipelineStageId] || '—',
    status: o.status, value: Number(o.monetaryValue) || 0,
    lostReason: o.lostReasonId ? lostReasonNames[o.lostReasonId] || null : null,
    stageChangedAt: iso(o.lastStageChangeAt || o.updatedAt), statusChangedAt: iso(o.lastStatusChangeAt || o.updatedAt),
    tags: c.tags || o.contact?.tags || [],
    qualValues: [...(c.qualValues || []), ...(o.customFields || []).filter(f => oppQualIds.includes(f.id)).map(fieldVal)].filter(v => v !== null && v !== '').map(String),
    stlMin: Number.isNaN(stl) ? null : stl, firstContactedAt: c.firstContacted ? iso(c.firstContacted) : null, contactMethod: c.method || null,
    attribution: c.attribution || null,
  };
});

// ---------- Appointments (consults) ----------
const appointments = await optional('appointments', async () => {
  const { calendars = [] } = await ghl(`/calendars/?locationId=${LOC}`);
  const keys = (cfg.booking?.calendarKeywords || []).map(norm);
  const isConsult = c => !keys.length || keys.some(k => norm(c.name).includes(k));
  console.log('Calendars:', calendars.map(c => `${c.name}${isConsult(c) ? ' [consult]' : ''}`).join(', ') || 'none');
  const out = [];
  for (const cal of calendars) {
    const q = new URLSearchParams({ locationId: LOC, calendarId: cal.id, startTime: String(since), endTime: String(now + 60 * DAY) });
    const { events = [] } = await ghl(`/calendars/events?${q}`);
    for (const e of events) out.push({
      id: e.id, contactId: e.contactId, calendar: cal.name, consult: isConsult(cal),
      assignedTo: e.assignedUserId || null, startTime: iso(e.startTime), bookedAt: iso(e.dateAdded), status: e.appointmentStatus || e.status || '—',
      title: e.title || null,
    });
  }
  return out;
});
if (appointments) {
  await loadContacts(appointments.map(a => a.contactId));
  for (const a of appointments) { const c = contacts[a.contactId] || {}; Object.assign(a, { name: c.name || a.title || 'Unknown', email: c.email || null, phone: c.phone || null }); }
}

// ---------- Conversation messages: calls + inbound replies ----------
// GHL's message export is unreliable: the same request returns a different subset of messages
// from one pull to the next (with no sign that anything is missing), a long pull can stop early,
// and deep pages sometimes fail with HTTP 500. So that the dashboard doesn't dip:
//   1. each channel is pulled twice, three times if the two disagree, and the pulls are combined;
//   2. that is combined with the message log the previous sync kept in details.enc.json, so a
//      call or reply seen once stays counted until it leaves the lookback window (a message
//      deleted in GHL therefore also stays counted until then);
//   3. if a channel still comes in clearly lower than last sync, the previous numbers stay up
//      ("hold", below) for up to HOLD.maxHolds syncs, then publish with an "incomplete" note.
// The log keeps only what the KPIs need: message and contact ids, channel, direction, status,
// call duration and time. No message bodies or subjects.
const CHANNELS = [['Call', 'Call'], ['SMS', 'SMS reply'], ['Email', 'Email reply'], ['FB', 'Facebook reply'], ['IG', 'Instagram reply'], ['GMB', 'Google message reply'], ['Live_Chat', 'Chat reply'], ['WhatsApp', 'WhatsApp reply']];
const REPLY_LABEL = Object.fromEntries(CHANNELS);
const MAX_PAGES = 100;
const HOLD = { dropPct: 10, minDrop: 5, maxHolds: 3, noteHours: 24 };
const OPT_OUT = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*[.!]?\s*$/i;
const diag = {};

// One pull of one channel. Stops once a whole page is older than the window. An error before the
// pull reaches the window's edge makes it "incomplete" (what it got is still used); a 4xx on the
// first page means the channel isn't available to this token or sub-account.
async function pullOnce(channel) {
  const got = new Map();
  let cursor, pastEdge = false;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ locationId: LOC, channel, limit: '100' });
    if (cursor) q.set('cursor', cursor);
    let r;
    try { r = await ghl(`/conversations/messages/export?${q}`); }
    catch (e) {
      if (page === 0 && e.status >= 400 && e.status < 500 && e.status !== 429) return { state: 'unavailable', reason: e.message, got };
      return { state: pastEdge ? 'complete' : 'incomplete', reason: e.message, got };
    }
    const batch = r.messages || [];
    if (page === 0 && batch[0] && !diag[channel + '_keys']) diag[channel + '_keys'] = Object.keys(batch[0]).sort().join(',');
    let newest = -Infinity;
    for (const m of batch) {
      const t = Date.parse(m.dateAdded) || 0;
      newest = Math.max(newest, t);
      if (t >= since) got.set(m.id ?? `${m.dateAdded}|${m.contactId}|${m.direction}`, m); else pastEdge = true;
    }
    if (!r.nextCursor || !batch.length || newest < since) return { state: 'complete', got };
    cursor = r.nextCursor;
  }
  return { state: pastEdge ? 'complete' : 'incomplete', reason: `stopped after ${MAX_PAGES} pages`, got };
}
async function pullChannel(channel) {
  const first = await pullOnce(channel);
  if (first.state === 'unavailable') return { state: 'unavailable', reason: first.reason, got: new Map(), sizes: [] };
  const pulls = [first, await pullOnce(channel)];
  const ids = p => [...p.got.keys()].sort().join('\n');
  if (ids(pulls[0]) !== ids(pulls[1]) || pulls.some(p => p.state !== 'complete')) pulls.push(await pullOnce(channel));
  const got = new Map();
  for (const p of pulls) for (const [id, m] of p.got) got.set(id, m);   // the latest pull's copy wins
  return { state: pulls.some(p => p.state === 'complete') ? 'complete' : 'incomplete', reason: pulls.find(p => p.reason)?.reason || null, got, sizes: pulls.map(p => p.got.size) };
}
// The log entry kept for a message, or null if the KPIs don't use it (outbound messages, opt-outs).
function toLog(channel, id, m) {
  const direction = norm(m.direction), at = iso(m.dateAdded);
  if (channel === 'Call') {
    const d = Number(m.meta?.call?.duration ?? m.meta?.duration ?? m.duration ?? NaN);
    return { id, contactId: m.contactId || null, channel, direction, status: norm(m.meta?.call?.status || m.status), durationSec: Number.isFinite(d) ? d : null, at };
  }
  if (direction !== 'inbound' || !m.contactId) return null;
  if (OPT_OUT.test(String(m.body ?? m.message ?? ''))) return null;   // a STOP is not a conversation
  return { id, contactId: m.contactId, channel, direction, status: norm(m.status) || null, at };
}

// What the previous sync published and kept.
let prevPub = null, prevRecords = null;
try { prevPub = JSON.parse(await readFile(new URL('kpis.json', dataDir), 'utf8')); } catch {}
if (PASS) {
  let env = null;
  try { env = JSON.parse(await readFile(new URL('details.enc.json', dataDir), 'utf8')); } catch {}
  if (!env) warn(`${SLUG}: no previous details file, so no earlier calls or messages to carry forward; starting fresh from this pull.`);
  else {
    try { prevRecords = await decryptJSON(env, PASS); }
    catch { warn(`${SLUG}: the previous details file couldn't be decrypted (passphrase changed?); starting fresh from this pull.`); }
  }
}
const prevLog = prevRecords?.messageLog?.items
  // first sync after this change: the previous file has calls but no log yet
  || (prevRecords?.calls || []).filter(k => k.id).map(k => ({ id: k.id, contactId: k.contactId || null, channel: 'Call', direction: k.direction, status: k.status, durationSec: Number.isFinite(k.durationSec) ? k.durationSec : null, at: k.at }));
const prevAssigned = Object.fromEntries((prevRecords?.calls || []).map(k => [k.id, k.assignedTo || null]));

const pulled = {}, chState = {};
for (const [ch] of CHANNELS) {
  pulled[ch] = await pullChannel(ch);
  chState[ch] = pulled[ch].state;
  if (pulled[ch].state === 'incomplete') warn(`${SLUG}: ${ch} pull incomplete (${pulled[ch].reason}); using what came back plus earlier syncs.`);
}
const log = new Map();
for (const e of prevLog) {
  if (!e?.id || !chState[e.channel] || chState[e.channel] === 'unavailable' || !(Date.parse(e.at) >= since)) continue;
  log.set(e.id, e);
}
const fromPrev = new Set(log.keys());
const rawCall = {};
for (const [ch] of CHANNELS) for (const [id, m] of pulled[ch].got) {
  const e = toLog(ch, id, m);
  if (!e) continue;
  log.set(id, e); fromPrev.delete(id);              // the newest copy wins
  if (ch === 'Call') rawCall[id] = m;
}
const counts = {};
for (const [ch] of CHANNELS) {
  const n = [...log.values()].filter(e => e.channel === ch).length;
  counts[ch] = chState[ch] === 'unavailable' ? null : n;
  if (chState[ch] === 'unavailable') { diag[ch] = { unavailable: pulled[ch].reason }; continue; }
  const tally = {};
  for (const m of pulled[ch].got.values()) { const k = `${norm(m.direction)}/${norm(m.meta?.call?.status || m.status)}`; tally[k] = (tally[k] || 0) + 1; }
  diag[ch] = { pulls: pulled[ch].sizes, combined: pulled[ch].got.size, kept: n, carried: [...fromPrev].filter(id => log.get(id).channel === ch).length, state: chState[ch], byDirectionStatus: tally };
}
console.log('Calls and replies kept per channel:', JSON.stringify(counts), `(${fromPrev.size} carried forward from earlier syncs)`);

// Hold: a channel more than HOLD.dropPct % (and at least HOLD.minDrop) below last sync is far more
// likely a short answer from GHL than a real drop, so the previous numbers stay up. After
// HOLD.maxHolds holds in a row the new numbers publish anyway, flagged as possibly incomplete,
// so a real drop can't stay hidden. The flag (the dashboard's "may be incomplete" note) stays on
// until every channel is back near its pre-hold count, or for HOLD.noteHours at most.
const checkedAt = new Date(now).toISOString();
const prevSync = prevPub?.sync || null;
// Channels clearly below the given counts, as "Call 64 → 40".
const shortAgainst = base => Object.entries(base || {}).filter(([ch, before]) => {
  if (typeof before !== 'number' || !(ch in counts)) return false;
  const after = counts[ch] ?? 0;
  return before - after >= HOLD.minDrop && after < before * (1 - HOLD.dropPct / 100);
}).map(([ch, before]) => `${ch} ${before} → ${counts[ch] ?? 0}`);
const drops = shortAgainst(prevSync?.counts);
const holdsSoFar = prevSync?.holds || 0;
await stopOnAuthFailures();
if (drops.length && holdsSoFar < HOLD.maxHolds && prevPub?.periods) {
  prevPub.sync = { ...prevSync, checkedAt, holds: holdsSoFar + 1, heldSince: prevSync.heldSince || checkedAt, reason: drops.join(', ') };
  await writeFile(new URL('kpis.json', dataDir), JSON.stringify(prevPub, null, 2) + '\n');
  warn(`${SLUG}: held (${holdsSoFar + 1} of ${HOLD.maxHolds}). GHL returned fewer calls or messages than last sync (${drops.join(', ')}); the dashboard keeps the numbers from ${prevPub.generatedAt}.`);
  console.log('Message export diagnostics:', JSON.stringify(diag));
  process.exit(0);
}
let incomplete = null;   // { since, baseline, reason }
if (drops.length) {
  incomplete = { since: checkedAt, baseline: prevSync.counts, reason: drops.join(', ') };
  warn(`${SLUG}: still lower after ${HOLD.maxHolds} holds (${drops.join(', ')}); publishing, marked as possibly incomplete.`);
} else if (prevSync?.incomplete && prevSync.baseline && prevSync.incompleteSince) {
  const still = shortAgainst(prevSync.baseline);
  const hours = (now - Date.parse(prevSync.incompleteSince)) / 36e5;
  if (still.length && hours < HOLD.noteHours) {
    incomplete = { since: prevSync.incompleteSince, baseline: prevSync.baseline, reason: still.join(', ') };
    warn(`${SLUG}: still below the pre-hold counts (${still.join(', ')}); the "may be incomplete" note stays up.`);
  } else console.log(still.length ? `"May be incomplete" note cleared after ${HOLD.noteHours} hours (${still.join(', ')}).` : 'Counts are back near their pre-hold level; "may be incomplete" note cleared.');
}
const syncInfo = { checkedAt, counts, channels: chState, holds: 0, heldSince: null, incomplete: !!incomplete,
  incompleteSince: incomplete?.since || null, baseline: incomplete?.baseline || null, reason: incomplete?.reason || null };

const byTimeDesc = (a, b) => Date.parse(b.at) - Date.parse(a.at);
const messageLog = { items: [...log.values()].sort(byTimeDesc) };
const replies = messageLog.items.filter(e => e.channel !== 'Call').map(e => ({ contactId: e.contactId, at: e.at, method: REPLY_LABEL[e.channel] }));

// ---------- Calls ----------
const calls = chState.Call === 'unavailable' ? null : messageLog.items.filter(e => e.channel === 'Call').map(e => ({
  id: e.id, contactId: e.contactId, direction: e.direction, status: e.status, answered: ['completed', 'answered'].includes(e.status),
  at: e.at, assignedTo: rawCall[e.id]?.userId || prevAssigned[e.id] || null, durationSec: e.durationSec ?? NaN,
}));
if (calls) {
  await loadContacts(calls.map(k => k.contactId));
  for (const k of calls) { const c = contacts[k.contactId] || {}; Object.assign(k, { name: c.name || 'Unknown caller', phone: c.phone || null }); }
}

// ---------- Speed to lead + first contact, computed from the logs ----------
// Speed to lead = lead created -> first OUTBOUND call to that contact (answered or not).
// First contact  = earliest of: inbound reply on any channel, a connected call of
//                  >= 60 s (either direction), or an appointment booked after the lead came in.
// A GHL custom field value, if a workflow ever fills it, takes priority.
const STL = cfg.speedToLead || {};
const businessMinutes = (fromMs, toMs) => {
  const bh = STL.businessHours;
  if (!STL.useBusinessHours || !bh) return Math.round((toMs - fromMs) / 60000);
  let total = 0;
  for (let day = Math.floor(fromMs / DAY) * DAY - DAY; day <= toMs + DAY; day += DAY) {
    const off = tzOffsetMin(cfg.timezone, day + 12 * 3600e3) * 60000;
    const localMidnight = Math.floor((day + off) / DAY) * DAY - off;
    const dow = new Date(localMidnight + off).getUTCDay();
    if (!bh.days.includes(dow)) continue;
    const open = localMidnight + bh.start * 3600e3, close = localMidnight + bh.end * 3600e3;
    const a = Math.max(open, fromMs), b = Math.min(close, toMs);
    if (b > a) total += b - a;
  }
  return Math.round(total / 60000);
};
const byContact = (rows, key = 'contactId') => { const m = {}; for (const r of rows || []) (m[r[key]] ||= []).push(r); for (const l of Object.values(m)) l.sort((x, y) => Date.parse(x.at) - Date.parse(y.at)); return m; };
const callsBy = byContact(calls), repliesBy = byContact(replies);
const apptsBy = byContact((appointments || []).map(a => ({ ...a, at: a.bookedAt })));
const minCallSec = STL.connectedCallSeconds ?? 60;
let stlComputed = 0, contactComputed = 0;
for (const l of leads) {
  const t0 = Date.parse(l.createdAt);
  const after = list => (list || []).filter(x => Date.parse(x.at) >= t0 - 60000);
  const cl = after(callsBy[l.contactId]);
  const firstOut = cl.find(k => k.direction === 'outbound' && Date.parse(k.at) - t0 <= (STL.maxDays ?? 7) * DAY);
  const events = [];
  for (const k of cl) {
    const connected = k.answered && (Number.isNaN(k.durationSec) || k.durationSec >= minCallSec);
    if (connected) events.push({ at: k.at, method: k.direction === 'inbound' ? 'Inbound call' : 'Answered call' });
  }
  for (const r of after(repliesBy[l.contactId])) events.push({ at: r.at, method: r.method });
  for (const a of after(apptsBy[l.contactId])) events.push({ at: a.at, method: 'Booked appointment' });
  events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const first = events[0];
  if (l.stlMin === null) {
    if (firstOut) { l.stlMin = businessMinutes(t0, Date.parse(firstOut.at)); l.firstCallAt = firstOut.at; stlComputed++; }
    else if (first && first.method === 'Inbound call') { l.stlMin = 0; l.firstCallAt = first.at; stlComputed++; }   // they called us and we answered
  }
  if (!l.firstContactedAt && first) { l.firstContactedAt = first.at; l.contactMethod = first.method; contactComputed++; }
}
console.log(`Derived speed-to-lead for ${stlComputed} leads and first contact for ${contactComputed} leads (of ${leads.length}).`);
console.log('Message export diagnostics:', JSON.stringify(diag));

// ---------- New contacts not in any pipeline (safety net; see scripts/not-in-pipeline.mjs) ----------
// Contacts created in the lookback window, newest first, checked against opportunities in EVERY
// pipeline (not just the mapped ones). The list (names, phones, emails) goes only into the encrypted
// details file; kpis.json gets counts and the log gets counts only. null = couldn't check.
const notInPipeline = await optional('contacts search', async () => {
  const found = [];
  let reachedEdge = false;
  for (let page = 1; page <= 100 && !reachedEdge; page++) {
    const r = await ghl('/contacts/search', { method: 'POST', body: { locationId: LOC, page, pageLimit: 100, sort: [{ field: 'dateAdded', direction: 'desc' }] } });
    const batch = r.contacts || [];
    for (const c of batch) { if ((Date.parse(c.dateAdded) || 0) >= since) found.push(c); else reachedEdge = true; }
    if (batch.length < 100) reachedEdge = true;
  }
  if (!reachedEdge) warn(`${SLUG}: contact search stopped after 10,000 contacts; older contacts aren't checked for "not in pipeline".`);
  const withOpp = new Set(opps.map(o => o.contactId || o.contact?.id).filter(Boolean));
  const inbound = new Map();
  for (const e of messageLog.items) if (e.direction === 'inbound' && e.contactId) (inbound.get(e.contactId) || inbound.set(e.contactId, new Set()).get(e.contactId)).add(e.channel);
  const { items, skipped, tally } = pickNotInPipeline(found, { withOpp, inbound, rules: cfg.notInPipeline || {} });
  console.log(`New contacts not in any pipeline: ${items.length} of ${found.length} contacts created in the window (skipped: ${skipped.hasOpportunity} have an opportunity, ${skipped.notLeadType} not typed lead, ${skipped.bulk} added in bulk, ${skipped.noInboundSignal} no inbound signal).`);
  // Came-in-by breakdown (counts only) for the log and status/sync-status.json.
  const bd = { last30: breakdown(tally, now, 30), last90: breakdown(tally, now, 90) };
  for (const [w, b] of Object.entries(bd)) console.log(`Not in pipeline, ${w}: ${countedIn(b)} counted (form ${b.form}, survey ${b.survey}, chat widget ${b.chat}, booking ${b.booking}, inbound call ${b.call}, inbound SMS ${b.sms}, inbound email ${b.email}, other ${b.other}); left out: ${b.bulk} bulk-added, ${b.notLeadType} not typed lead, ${b.noInboundSignal} no inbound signal.`);
  const emailed = tally.filter(r => r.via === 'Emailed in' && r.at >= now - 90 * DAY), byMedium = {};
  for (const r of emailed) { const m = /^[a-z0-9_]{1,30}$/.test(r.medium || '') ? r.medium : '(none)'; byMedium[m] = (byMedium[m] || 0) + 1; }
  if (emailed.length) console.log(`Emailed-in only (last 90 days) by first-touch medium: ${Object.entries(byMedium).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} ${n}`).join(', ')}.`);
  resultExtra = { notInPipeline: bd };
  return items;
});

// ---------- Compute + write ----------
const records = {
  generatedAt: new Date(now).toISOString(), locationId: LOC, ghlBase: cfg.ghlAppBase, users, leads, appointments, calls,
  messageLog,   // carried into the next sync (see "Conversation messages")
  notInPipeline,
};
const periods = computeAll(records, cfg, now);
// Public file: numbers only (bySource and turned-away reasons are names + counts, no people).
const out = {
  generatedAt: records.generatedAt, location: cfg.locationName, targets: cfg.targets,
  dataNotes: {
    speedToLead: `Lead created to first outbound call${STL.useBusinessHours ? ' (business hours only)' : ''}, from GHL call logs`,
    appointments: appointments ? 'Consult calendars, by the lead\'s consult appointments' : 'Calendar scope missing',
    calls: calls ? 'Inbound calls from conversation messages' : 'Conversation message scope missing',
  },
  detailsAvailable: !!PASS,
  periods,
};

// Testing banner: remember the first time the firm reached the activity threshold, carried forward
// from the previous data/kpis.json. Before that date the banner is "Testing period"; if activity
// later drops below the threshold, the page shows a low-activity notice instead.
{
  const A = cfg.notice?.autoHide;
  const prevGrad = prevPub?.notice?.graduatedAt || null;
  const moved = A ? (periods[A.window || 'last90']?.current?.stageMoved ?? 0) : 0;
  const graduatedAt = prevGrad || (A && moved >= A.minLeadsMoved ? records.generatedAt : null);
  out.notice = { graduatedAt };
  if (graduatedAt && !prevGrad) console.log(`Testing period ended: ${moved} leads moved in the last 90 days (threshold ${A.minLeadsMoved}).`);
}

out.sync = syncInfo;
await stopOnAuthFailures();

await mkdir(dataDir, { recursive: true });
await writeFile(new URL('kpis.json', dataDir), JSON.stringify(out, null, 2) + '\n');
if (PASS) {
  await writeFile(new URL('details.enc.json', dataDir), JSON.stringify(await encryptJSON(records, PASS)) + '\n');
} else {
  await rm(new URL('details.enc.json', dataDir), { force: true });
  console.warn('DASHBOARD_PASSPHRASE not set: custom dates and drill-downs disabled, no contact data written.');
}
const withAttr = leads.filter(l => l.attribution).length;
console.log(`Attribution coverage: ${withAttr} of ${leads.length} leads have marketing source data${leads.length ? ` (${Math.round((withAttr / leads.length) * 100)}%)` : ''}`);
console.log(`Wrote firms/${SLUG}/data/kpis.json (${leads.length} leads, ${appointments?.length ?? 'n/a'} appointments, ${calls?.length ?? 'n/a'} calls)`);
