// Pulls one firm's data from the GoHighLevel API v2 and writes, inside firms/<slug>/:
//   data/kpis.json         public: aggregate numbers only (no names/phones/emails)
//   data/details.enc.json  encrypted contact-level records for custom dates and drill-downs
// Usage: node scripts/sync.mjs <slug>
// Normally started per firm by scripts/sync-all.mjs from .github/workflows/sync.yml.
//
// Env: GHL_TOKEN (read-only Private Integration Token for this firm's sub-account),
//      GHL_LOCATION_ID (optional; config.json locationId wins),
//      DASHBOARD_PASSPHRASE (team passphrase that unlocks names, custom dates and drill-downs)

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { computeAll, encryptJSON, tzOffsetMin } from './kpi-core.mjs';
import { checkSlug, loadFirmConfig } from './firms.mjs';

const SLUG = process.argv[2];
const slugErr = checkSlug(SLUG);
if (slugErr) { console.error(slugErr); process.exit(1); }
const firmDir = new URL(`../firms/${SLUG}/`, import.meta.url);

const API = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';
const cfg = await loadFirmConfig(SLUG);   // _defaults.json → practice-area defaults → firm config.json
const TOKEN = process.env.GHL_TOKEN;
const LOC = cfg.locationId || process.env.GHL_LOCATION_ID;
const PASS = process.env.DASHBOARD_PASSPHRASE || '';
if (!TOKEN || !LOC) { console.error(`Missing ${!TOKEN ? 'GHL token' : 'location ID'} for ${SLUG}`); process.exit(1); }

const QUAL = cfg.qualification || {};
const DAY = 864e5;
const now = Date.now();
const since = now - cfg.lookbackDays * DAY;
const norm = s => String(s ?? '').trim().toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const iso = v => (v ? new Date(typeof v === 'number' || /^\d+$/.test(String(v)) ? Number(v) : v).toISOString() : null);

async function ghl(path, { version = '2021-07-28' } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, { headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}`, Version: version } });
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (res.status === 401 || res.status === 403) throw new Error(`GHL ${res.status} on ${path.split('?')[0]}: token invalid or missing a scope`);
    if (!res.ok) throw new Error(`GHL ${res.status} on ${path.split('?')[0]}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  throw new Error(`GHL rate limit on ${path}`);
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

// ---------- Conversation messages (calls + inbound replies) ----------
const diag = {};
async function exportChannel(channel, maxPages = 100) {
  const out = [];
  let cursor;
  for (let guard = 0; guard < maxPages; guard++) {
    const q = new URLSearchParams({ locationId: LOC, channel, limit: '100' });
    if (cursor) q.set('cursor', cursor);
    const r = await ghl(`/conversations/messages/export?${q}`);
    const batch = r.messages || [];
    out.push(...batch);
    if (guard === 0 && batch[0]) diag[channel + '_keys'] = Object.keys(batch[0]).sort().join(',');
    const oldest = Math.min(...batch.map(m => Date.parse(m.dateAdded) || now));
    if (!r.nextCursor || batch.length === 0 || oldest < since) break;
    cursor = r.nextCursor;
  }
  const kept = out.filter(m => (Date.parse(m.dateAdded) || 0) >= since);
  const tally = {};
  for (const m of kept) { const k = `${norm(m.direction)}/${norm(m.meta?.call?.status || m.status)}`; tally[k] = (tally[k] || 0) + 1; }
  diag[channel] = { count: kept.length, byDirectionStatus: tally };
  return kept;
}
const OPT_OUT = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*[.!]?\s*$/i;
const replies = [];
for (const [channel, label] of [['SMS', 'SMS reply'], ['Email', 'Email reply'], ['FB', 'Facebook reply'], ['IG', 'Instagram reply'], ['GMB', 'Google message reply'], ['Live_Chat', 'Chat reply'], ['WhatsApp', 'WhatsApp reply']]) {
  const msgs = await optional(`${channel} messages`, () => exportChannel(channel));
  for (const m of msgs || []) {
    if (norm(m.direction) !== 'inbound' || !m.contactId) continue;
    if (OPT_OUT.test(String(m.body ?? m.message ?? ''))) continue;   // a STOP is not a conversation
    replies.push({ contactId: m.contactId, at: iso(m.dateAdded), method: label });
  }
}

// ---------- Calls ----------
const calls = await optional('calls', async () => {
  const out = [];
  let cursor;
  for (let guard = 0; guard < 50; guard++) {
    const q = new URLSearchParams({ locationId: LOC, channel: 'Call', limit: '100' });
    if (cursor) q.set('cursor', cursor);
    const r = await ghl(`/conversations/messages/export?${q}`);
    const batch = r.messages || [];
    for (const m of batch) {
      const status = norm(m.meta?.call?.status || m.status);
      out.push({ id: m.id, contactId: m.contactId, direction: norm(m.direction), status, answered: ['completed', 'answered'].includes(status),
        at: iso(m.dateAdded), assignedTo: m.userId || null, durationSec: Number(m.meta?.call?.duration ?? m.meta?.duration ?? m.duration ?? NaN) });
    }
    const oldest = Math.min(...batch.map(m => Date.parse(m.dateAdded) || now));
    if (!r.nextCursor || batch.length === 0 || oldest < since) break;
    cursor = r.nextCursor;
  }
  return out.filter(k => Date.parse(k.at) >= since);
});
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

// ---------- Compute + write ----------
const records = {
  generatedAt: new Date(now).toISOString(), locationId: LOC, ghlBase: cfg.ghlAppBase, users, leads, appointments, calls,
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
  let prevGrad = null;
  try { prevGrad = JSON.parse(await readFile(new URL('data/kpis.json', firmDir), 'utf8')).notice?.graduatedAt || null; } catch {}
  const moved = A ? (periods[A.window || 'last90']?.current?.stageMoved ?? 0) : 0;
  const graduatedAt = prevGrad || (A && moved >= A.minLeadsMoved ? records.generatedAt : null);
  out.notice = { graduatedAt };
  if (graduatedAt && !prevGrad) console.log(`Testing period ended: ${moved} leads moved in the last 90 days (threshold ${A.minLeadsMoved}).`);
}

const dataDir = new URL('data/', firmDir);
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
