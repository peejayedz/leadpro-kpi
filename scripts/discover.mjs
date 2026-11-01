// Reads one firm's GHL setup and writes firms/<slug>/discovery.json:
// a check of the nine token scopes (one lightweight read each; only scope names and pass/fail
// are recorded), plus pipelines + stages, calendars, contact and opportunity custom fields.
// Names and ids only. No contact or staff data is requested or written (the repo is public).
//
// Usage: node scripts/discover.mjs <slug> [locationId]
// Location ID: the argument, else firms/<slug>/config.json, else firms/index.json.
// Token: GHL_TOKEN env (discover.yml sets it from GHL_TOKEN_<secretKey>). Never logged.
// SECRET_KEY env (optional, set by the workflow) must match the slug, so one firm's token
// can never write another firm's discovery.json.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { checkSlug, readIndex, secretKeyFor, tokenName } from './firms.mjs';

const SLUG = process.argv[2];
const slugErr = checkSlug(SLUG);
if (slugErr) { console.error(slugErr); process.exit(1); }
const firmDir = new URL(`../firms/${SLUG}/`, import.meta.url);
const KEY = process.env.SECRET_KEY || secretKeyFor(SLUG);
if (KEY !== secretKeyFor(SLUG)) { console.error(`secretKey ${KEY} does not belong to slug ${SLUG} (expected ${secretKeyFor(SLUG)})`); process.exit(1); }

let LOC = (process.argv[3] || '').trim();
if (!LOC) { try { LOC = JSON.parse(await readFile(new URL('config.json', firmDir), 'utf8')).locationId || ''; } catch {} }
if (!LOC) LOC = (await readIndex()).find(f => f.slug === SLUG)?.locationId || '';
if (!/^[A-Za-z0-9]{10,40}$/.test(LOC)) { console.error(`No valid GHL location ID for ${SLUG}`); process.exit(1); }

const TOKEN = process.env.GHL_TOKEN;
if (!TOKEN) { console.error(`Secret ${tokenName(KEY)} is not set`); process.exit(1); }

const API = process.env.GHL_API_BASE || 'https://services.leadconnectorhq.com';
const sleep = ms => new Promise(r => setTimeout(r, ms));
// One request; never throws. Returns { status, body } (body only for 2xx).
async function probe(path, { version = '2021-07-28' } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try { res = await fetch(API + path, { headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}`, Version: version } }); }
    catch (e) { return { status: 0, error: e.message }; }
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (res.ok) return { status: res.status, body: await res.json().catch(() => ({})) };
    let message = '';
    try { const j = await res.json(); message = String(j.message || j.error || '').slice(0, 160); } catch {}
    return { status: res.status, error: message };
  }
  return { status: 429, error: 'rate limited' };
}

// ---------- scope check: one lightweight read per scope ----------
// Only the scope name and pass/fail are recorded. Response bodies are used for the
// pipeline/calendar/custom-field names below and nothing else.
const day = 864e5, now = Date.now();
const results = {};          // scope -> { status, error }
const bodies = {};
async function check(scope, path) {
  const r = await probe(path);
  results[scope] = r; bodies[scope] = r.body || null;
  const verdict = r.status >= 200 && r.status < 300 ? 'ok' : (r.status === 401 || r.status === 403) ? 'MISSING' : `unclear (${r.status || 'network'})`;
  console.log(`  ${verdict === 'ok' ? '✓' : verdict === 'MISSING' ? '✗' : '?'} ${scope.padEnd(32)} ${verdict}${verdict.startsWith('unclear') && r.error ? ` (GHL: ${r.error})` : ''}`);
}
console.log('Checking token scopes:');
await check('opportunities.readonly', `/opportunities/pipelines?locationId=${LOC}`);
await check('contacts.readonly', `/contacts/?locationId=${LOC}&limit=1`);
await check('users.readonly', `/users/?locationId=${LOC}`);
await check('locations.readonly', `/locations/${LOC}`);
await check('locations/customFields.readonly', `/locations/${LOC}/customFields?model=contact`);
await check('calendars.readonly', `/calendars/?locationId=${LOC}`);
{ // events need a calendar or a user to ask about
  const calId = bodies['calendars.readonly']?.calendars?.[0]?.id, userId = bodies['users.readonly']?.users?.[0]?.id;
  if (calId || userId) await check('calendars/events.readonly', `/calendars/events?locationId=${LOC}&${calId ? `calendarId=${calId}` : `userId=${userId}`}&startTime=${now - day}&endTime=${now}`);
  else { results['calendars/events.readonly'] = { status: -1, error: 'no calendar or user to test with' }; console.log(`  ? ${'calendars/events.readonly'.padEnd(32)} not testable (no calendars or users visible)`); }
}
await check('conversations.readonly', `/conversations/search?locationId=${LOC}&limit=1`);
// Same request the sync makes (GHL rejects smaller limits with 422).
await check('conversations/message.readonly', `/conversations/messages/export?locationId=${LOC}&channel=SMS&limit=100`);

const SCOPES = Object.keys(results);
const isOk = r => r.status >= 200 && r.status < 300;
const isDenied = r => r.status === 401 || r.status === 403;
const scopes = {
  checkedAt: new Date().toISOString(),
  ok: SCOPES.filter(s => isOk(results[s])),
  missing: SCOPES.filter(s => isDenied(results[s])),
  unchecked: SCOPES.filter(s => !isOk(results[s]) && !isDenied(results[s])),
};
// Every check refused: the token itself is wrong (mistyped, revoked, or from another sub-account).
scopes.tokenRejected = scopes.ok.length === 0 && scopes.missing.length > 0;
if (scopes.tokenRejected) scopes.ghlMessage = Object.values(results).find(isDenied)?.error || '';

// ---------- names and ids for the mapping panel ----------
const fieldsFor = async model => {
  const b = model === 'contact' ? bodies['locations/customFields.readonly'] : (await probe(`/locations/${LOC}/customFields?model=${model}`)).body;
  return (b?.customFields || []).map(f => ({ id: f.id, name: f.name, fieldKey: f.fieldKey || null, dataType: f.dataType || null }));
};
const out = {
  generatedAt: new Date().toISOString(),
  slug: SLUG,
  locationId: LOC,
  scopes,
  pipelines: (bodies['opportunities.readonly']?.pipelines || []).map(p => ({ id: p.id, name: p.name, stages: (p.stages || []).map(s => ({ id: s.id, name: s.name, position: s.position ?? null })) })),
  calendars: (bodies['calendars.readonly']?.calendars || []).map(c => ({ id: c.id, name: c.name, active: c.isActive !== false })),
  customFields: {
    contact: await fieldsFor('contact'),
    opportunity: scopes.missing.includes('locations/customFields.readonly') ? [] : await fieldsFor('opportunity'),
  },
};

await mkdir(firmDir, { recursive: true });
await writeFile(new URL('discovery.json', firmDir), JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote firms/${SLUG}/discovery.json: ${out.pipelines.length} pipelines, ${out.pipelines.reduce((n, p) => n + p.stages.length, 0)} stages, ` +
  `${out.calendars.length} calendars, ${out.customFields.contact.length} contact fields, ${out.customFields.opportunity.length} opportunity fields.`);
for (const p of out.pipelines) console.log(`  • ${p.name}: ${p.stages.map(s => s.name).join(' → ')}`);
if (scopes.tokenRejected) console.log(`::warning::GHL refused every check: the token is mistyped, revoked, or belongs to another sub-account.`);
else if (scopes.missing.length) console.log(`::warning::Token is missing ${scopes.missing.length} scope(s): ${scopes.missing.join(', ')}`);
if (scopes.unchecked.length) console.log(`Not testable: ${scopes.unchecked.join(', ')}`);
