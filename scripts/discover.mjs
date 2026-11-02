// Reads one firm's GHL setup and writes firms/<slug>/discovery.json:
// a check of the nine token scopes (one lightweight read each; only scope names and pass/fail
// are recorded), plus pipelines + stages, calendars, contact and opportunity custom fields.
// Names and ids only (plus the sub-account's own name). No contact or staff data is requested or written (the repo is public).
//
// Usage: node scripts/discover.mjs <slug> [locationId]
// Location ID: the argument, else firms/<slug>/config.json, else firms/index.json.
// Token: GHL_TOKEN env (discover.yml sets it from GHL_TOKEN_<secretKey>). Never logged.
// SECRET_KEY env (optional, set by the workflow) must match the slug, so one firm's token
// can never write another firm's discovery.json.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { checkSlug, readIndex, secretKeyFor, tokenName } from './firms.mjs';
import { checkScopes } from './scope-check.mjs';

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

// ---------- scope check: one lightweight read per scope (scripts/scope-check.mjs) ----------
// Only the scope name and pass/fail are recorded. Response bodies are used for the
// pipeline/calendar/custom-field names below and nothing else.
console.log('Checking token scopes:');
const { bodies, scopes } = await checkScopes(probe, LOC, { log: line => console.log(line) });

// ---------- names and ids for the mapping panel ----------
const fieldsFor = async model => {
  const b = model === 'contact' ? bodies['locations/customFields.readonly'] : (await probe(`/locations/${LOC}/customFields?model=${model}`)).body;
  return (b?.customFields || []).map(f => ({ id: f.id, name: f.name, fieldKey: f.fieldKey || null, dataType: f.dataType || null }));
};
const out = {
  generatedAt: new Date().toISOString(),
  slug: SLUG,
  locationId: LOC,
  locationName: bodies['locations.readonly']?.location?.name || null,   // the GHL sub-account's name, shown on the admin page
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
