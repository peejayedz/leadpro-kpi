// Reads one firm's GHL setup and writes firms/<slug>/discovery.json:
// pipelines + stages, calendars, contact and opportunity custom fields.
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
async function ghl(path, { version = '2021-07-28' } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(API + path, { headers: { Accept: 'application/json', Authorization: `Bearer ${TOKEN}`, Version: version } });
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (res.status === 401 || res.status === 403) throw new Error(`GHL ${res.status} on ${path.split('?')[0]}: token invalid, for another sub-account, or missing a scope`);
    if (!res.ok) throw new Error(`GHL ${res.status} on ${path.split('?')[0]}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  throw new Error(`GHL rate limit on ${path.split('?')[0]}`);
}
const warnings = [];
async function optional(label, fn) {
  try { return await fn(); } catch (e) { warnings.push(`${label}: ${e.message}`); console.warn(`${label} skipped: ${e.message}`); return null; }
}

// Pipelines are required: without them there is nothing to map.
const { pipelines = [] } = await ghl(`/opportunities/pipelines?locationId=${LOC}`);
const out = {
  generatedAt: new Date().toISOString(),
  slug: SLUG,
  locationId: LOC,
  pipelines: pipelines.map(p => ({ id: p.id, name: p.name, stages: (p.stages || []).map(s => ({ id: s.id, name: s.name, position: s.position ?? null })) })),
  calendars: (await optional('calendars', async () => {
    const { calendars = [] } = await ghl(`/calendars/?locationId=${LOC}`);
    return calendars.map(c => ({ id: c.id, name: c.name, active: c.isActive !== false }));
  })) ?? [],
  customFields: {
    contact: (await optional('contact custom fields', async () => {
      const { customFields = [] } = await ghl(`/locations/${LOC}/customFields?model=contact`);
      return customFields.map(f => ({ id: f.id, name: f.name, fieldKey: f.fieldKey || null, dataType: f.dataType || null }));
    })) ?? [],
    opportunity: (await optional('opportunity custom fields', async () => {
      const { customFields = [] } = await ghl(`/locations/${LOC}/customFields?model=opportunity`);
      return customFields.map(f => ({ id: f.id, name: f.name, fieldKey: f.fieldKey || null, dataType: f.dataType || null }));
    })) ?? [],
  },
  warnings,
};

await mkdir(firmDir, { recursive: true });
await writeFile(new URL('discovery.json', firmDir), JSON.stringify(out, null, 2) + '\n');
console.log(`Wrote firms/${SLUG}/discovery.json: ${out.pipelines.length} pipelines, ${out.pipelines.reduce((n, p) => n + p.stages.length, 0)} stages, ` +
  `${out.calendars.length} calendars, ${out.customFields.contact.length} contact fields, ${out.customFields.opportunity.length} opportunity fields.`);
for (const p of out.pipelines) console.log(`  • ${p.name}: ${p.stages.map(s => s.name).join(' → ')}`);
if (warnings.length) console.log(`${warnings.length} optional section(s) skipped; see "warnings" in the file.`);
