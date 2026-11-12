// New firm from the Sub-account Builder (new-firm.yml). The firm uses the LeadPro Connector app token.
//
//   node scripts/new-firm.mjs plan       inputs → slug, secret key, mode (new | resume | other-token)
//   node scripts/new-firm.mjs wait-app   waits (up to NEWFIRM_WAIT_MIN, default 15) for the app on the location
//   node scripts/new-firm.mjs write      after Discover: config.json (snapshot preset or auto-guess), stub, index.json
//   node scripts/new-firm.mjs menu       optional GHL "KPI Dashboard" menu link (only with GHL_MENU_TOKEN)
//
// Inputs (env, all non-secret): NF_NAME, NF_LOCATION, NF_SLUG, NF_PRACTICE, NF_TIMEZONE, NF_SNAPSHOT_ID, NF_REQUEST.
// PUBLIC LOGS: step names, slugs and counts only. Never a token, passphrase or contact data.
import { readFile, writeFile, mkdir, readdir, access } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkSlug, secretKeyFor } from './firms.mjs';
import { initialState, buildMapping, applyMapping } from '../admin/mapping.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const norm = s => String(s ?? '').trim().toLowerCase();
const LOC_RE = /^[A-Za-z0-9]{15,30}$/;
const jsonText = o => `${JSON.stringify(o, null, 2)}\n`;
const log = s => console.log(s);

// ---------- pure ----------
// What to do for this location. A location already in the list is never added twice.
export function planFirm({ index, name, locationId, slug }) {
  if (!String(name || '').trim()) return { error: 'No firm name.' };
  if (!LOC_RE.test(locationId || '')) return { error: 'No valid GHL location ID.' };
  const bad = checkSlug(slug); if (bad) return { error: bad };
  const same = index.find(f => f.locationId === locationId);
  if (same) return same.tokenSource === 'app'
    ? { mode: 'resume', slug: same.slug, key: same.secretKey }          // set up from the builder before: finish what's missing
    : { mode: 'other-token', slug: same.slug, key: same.secretKey };    // already a firm with a Private Integration token: leave it alone
  if (index.some(f => f.slug === slug)) return { error: `The name "${slug}" is already used by another firm.` };
  return { mode: 'new', slug, key: secretKeyFor(slug) };
}

export async function loadPresets(dir = `${ROOT}firms/_presets/`) {
  const out = [];
  for (const f of (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.json'))) out.push({ file: f, ...JSON.parse(await readFile(dir + f, 'utf8')) });
  return out;
}
export const presetFor = (snapshotId, presets) => presets.find(p => (p.snapshots || []).some(s => s.id === snapshotId)) || null;

// The firm's config. Preset: names checked against discovery, saved as stage ids. Otherwise (or if any
// name is missing): the admin page's auto-guess by name, and mappingReview so the bell asks for a look.
export function buildConfig({ template, discovery, preset, name, practiceArea, locationId, timezone, now = new Date().toISOString() }) {
  const cfg = structuredClone(template);
  Object.assign(cfg, { locationName: name, practiceArea, locationId, title: '', timezone: timezone || cfg.timezone });
  const pipes = discovery?.pipelines || [];
  let review = null;
  if (preset) {
    const chosen = pipes.filter(p => (preset.pipelines || []).some(n => norm(n) === norm(p.name)));
    const idsOf = {};
    for (const p of chosen) for (const s of p.stages || []) (idsOf[norm(s.name)] ||= []).push(s.id);
    const names = [...Object.values(preset.stages || {}).flat(), ...(preset.turnedAway?.stages || [])];
    const missing = [...new Set(names.filter(n => !idsOf[norm(n)]))];
    if (chosen.length === (preset.pipelines || []).length && !missing.length) {
      const ids = list => [...new Set(list.flatMap(n => idsOf[norm(n)]))];
      cfg.stageMatch = 'id';
      cfg.pipelines = chosen.map(p => p.name);
      cfg.stages = Object.fromEntries(Object.entries(template.stages || {}).map(([k]) => [k, ids(preset.stages?.[k] || [])]));
      cfg.turnedAway = { ...(cfg.turnedAway || {}), stages: ids(preset.turnedAway?.stages || []),
        reasonLabels: Object.fromEntries(Object.entries(preset.turnedAway?.reasonLabels || {}).flatMap(([n, label]) => (idsOf[norm(n)] || []).map(id => [id, label]))) };
      cfg.booking = { ...(cfg.booking || {}), calendarKeywords: preset.calendarKeywords || [] };
      return { config: cfg, review: null, preset: preset.name };
    }
    review = { reason: 'missing-stages', preset: preset.name, missing: missing.length ? missing.length : (preset.pipelines || []).length - chosen.length, at: now };
  } else review = { reason: 'unknown-snapshot', at: now };
  const st = initialState({ discovery, config: template, isNew: true });
  applyMapping(cfg, buildMapping(st, discovery));
  cfg.mappingReview = review;
  return { config: cfg, review, preset: null };
}

// ---------- commands ----------
const env = process.env;
const input = () => ({ name: (env.NF_NAME || '').trim(), locationId: (env.NF_LOCATION || '').trim(), slug: (env.NF_SLUG || '').trim(), practiceArea: (env.NF_PRACTICE || '').trim(), timezone: (env.NF_TIMEZONE || '').trim(), snapshotId: (env.NF_SNAPSHOT_ID || '').trim() });
const readJSON = async (p, fallback = null) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };
async function output(pairs) {
  if (!env.GITHUB_OUTPUT) return;
  const { appendFile } = await import('node:fs/promises');
  await appendFile(env.GITHUB_OUTPUT, Object.entries(pairs).map(([k, v]) => `${k}=${v}\n`).join(''));
}

async function cmdPlan() {
  const i = input(), index = await readJSON(`${ROOT}firms/index.json`, []);
  const p = planFirm({ index, ...i });
  if (p.error) { log(`Can't set up this firm: ${p.error}`); return 1; }
  log(p.mode === 'new' ? `New firm: ${p.slug}.` : p.mode === 'resume' ? `${p.slug} was set up from the builder before; finishing what's missing.` : `${p.slug} already has a dashboard with a Private Integration token; nothing to do.`);
  await output({ slug: p.slug, key: p.key, mode: p.mode });
  return 0;
}

async function cmdWaitApp() {
  const { installedLocationIds, appIdFromClientId } = await import('./ghl-app.mjs');
  const i = input();
  let access = null; try { access = JSON.parse(env.GHL_APP_ACCESS || 'null'); } catch {}
  if (!access?.access_token || !(Date.parse(access.expiresAt) - Date.now() > 10 * 60e3)) { log('The saved agency token is missing or expired. The token keeper must run first (Actions → Token keeper).'); return 1; }
  const waitMs = Number(env.NEWFIRM_WAIT_MIN || 15) * 60e3, pollMs = Number(env.NEWFIRM_POLL_S || 30) * 1000, t0 = Date.now();
  for (let n = 1; ; n++) {
    try {
      const r = await installedLocationIds({ agencyToken: access.access_token, appId: appIdFromClientId(env.GHL_APP_CLIENT_ID) });
      if (r.ids.has(i.locationId)) { log(`The app is installed on the sub-account (check ${n}).`); return 0; }
      log(`Check ${n}: the app isn't on the sub-account yet (it's on ${r.ids.size}). Waiting…`);
    } catch (e) { log(`Check ${n}: couldn't ask GHL (${e.status || 'network'}). Waiting…`); }
    if (Date.now() - t0 + pollMs > waitMs) { log(`The app still isn't installed on the sub-account after ${Math.round(waitMs / 60e3)} minutes.`); return 2; }
    await new Promise(r => setTimeout(r, pollMs));
  }
}

async function cmdWrite() {
  const i = input(), slug = env.NF_SLUG, key = secretKeyFor(slug);
  const dir = `${ROOT}firms/${slug}/`;
  const discovery = await readJSON(`${dir}discovery.json`);
  if (!discovery || discovery.locationId !== i.locationId) { log('discovery.json is missing or for another location.'); return 1; }
  if (!discovery.pipelines?.length) { log('GHL returned no pipelines for this sub-account.'); return 1; }
  const index = await readJSON(`${ROOT}firms/index.json`, []);
  const existing = index.find(f => f.locationId === i.locationId);
  if (existing && existing.slug !== slug) { log(`This location already belongs to ${existing.slug}.`); return 1; }
  const exists = await access(`${dir}config.json`).then(() => true, () => false);
  if (!exists) {
    const template = await readJSON(`${ROOT}firms/_template/config.json`);
    const preset = presetFor(i.snapshotId, await loadPresets());
    const { config, review } = buildConfig({ template, discovery, preset, ...i });
    await mkdir(dir, { recursive: true });
    await writeFile(`${dir}config.json`, jsonText(config));
    await writeFile(`${dir}index.html`, await readFile(`${ROOT}firms/_template/index.html`, 'utf8'));
    const n = Object.values(config.stages).flat().length;
    log(review ? `Mapping: auto-guess (${review.reason === 'unknown-snapshot' ? 'no preset for this snapshot' : `${review.missing} preset stage(s) not found`}); flagged "Review mapping". ${n} stage selections.` : `Mapping: preset "${preset.name}", ${n} stage selections saved as stage ids.`);
    await output({ review: review ? review.reason : 'none' });
  } else log('config.json already exists (resumed run); kept as it is.');
  if (!existing) {
    index.push({ slug, secretKey: key, name: i.name, practiceArea: i.practiceArea, locationId: i.locationId, createdAt: new Date().toISOString(), tokenSource: 'app', createdBy: 'builder' });
    await writeFile(`${ROOT}firms/index.json`, jsonText(index));
    log(`Added ${slug} to the firm list (${index.length} firms).`);
  }
  return 0;
}

async function cmdMenu() {
  const { ensureMenuLink } = await import('./ghl-menu.mjs');
  const i = input(), slug = env.NF_SLUG;
  const cfgPath = `${ROOT}firms/${slug}/config.json`, cfg = await readJSON(cfgPath);
  if (cfg?.menuLink?.status === 'created' || cfg?.menuLink?.status === 'exists') { log('Menu link: already done.'); await output({ menu: cfg.menuLink.status }); return 0; }
  const res = await ensureMenuLink({ token: env.GHL_MENU_TOKEN, locationId: i.locationId, slug, passphrase: env.NF_PASSPHRASE });
  log({ created: 'Menu link: created "KPI Dashboard" on this sub-account (opens in a new tab).', exists: 'Menu link: a "KPI Dashboard" link is already on this sub-account; nothing created.',
    'skipped-no-token': 'Menu link: skipped (no GHL_MENU_TOKEN). Add it by hand with the link from the builder.', 'skipped-list-failed': 'Menu link: skipped (couldn\'t list the existing links, so a duplicate couldn\'t be ruled out). Add it by hand.' }[res] || `Menu link: not created (${res}). Add it by hand.`);
  if (cfg && (res === 'created' || res === 'exists')) { cfg.menuLink = { status: res, at: new Date().toISOString() }; await writeFile(cfgPath, jsonText(cfg)); }
  await output({ menu: res });
  return 0;   // never fails the setup: the builder shows the Copy link + clicks instead
}

const CMDS = { plan: cmdPlan, 'wait-app': cmdWaitApp, write: cmdWrite, menu: cmdMenu };
const isMain = () => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } };
if (process.argv[1] && isMain()) {
  const fn = CMDS[process.argv[2]];
  if (!fn) { console.error(`Usage: node scripts/new-firm.mjs ${Object.keys(CMDS).join('|')}`); process.exit(1); }
  fn().then(c => { process.exitCode = c; }, e => { console.error(`new-firm ${process.argv[2]}: ${e.message}`); process.exitCode = 1; });
}
