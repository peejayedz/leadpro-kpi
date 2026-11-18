// Remove one firm's scorecard (v1.28.0). Run by .github/workflows/remove-firm.yml, started from the Builder's KPI tab
// ("Remove scorecard", typed-name confirm). The team site's server sets the "by" input from the signed-in Google name.
//
//   node scripts/remove-firm.mjs plan      checks, then outputs key / location / live / name (refuses → exit 1)
//   node scripts/remove-firm.mjs menu      LIVE firm only: removes its own "KPI Dashboard" GHL menu link (the exact reversal)
//   node scripts/remove-firm.mjs secrets   deletes GHL_TOKEN_<KEY> and PASSPHRASE_<KEY> (gh, value never seen)
//   node scripts/remove-firm.mjs files     deletes firms/<slug>/, its firms/index.json row, logs it in status/removed.json
//   node scripts/remove-firm.mjs notify    Slack DM "Scorecard removed · <firm>" (never fails the run)
//
// Refuses: an unknown slug; a LAW firm that wasn't made by the Builder (no Builder record: Mahdavi, LFMP, Hedayati,
// Emery…) unless RF_CONFIRM equals the slug exactly. Nothing else in the repo is touched.
// PUBLIC LOGS + status/removed.json: slug, firm name, time, first name of who removed it, what was removed. No secrets.
// Env: RF_SLUG, RF_CONFIRM, RF_BY, RF_MENU (the menu step's result), GHL_MENU_TOKEN, SECRETS_TOKEN, GITHUB_REPOSITORY,
//      RF_GH_BIN (tests), RF_ROOT (tests: another repo folder), GITHUB_OUTPUT.
import { readFile, writeFile, rm, mkdir, appendFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkSlug, secretKeyFor } from './firms.mjs';

const env = process.env;
const ROOT = env.RF_ROOT ? `${env.RF_ROOT.replace(/\/$/, '')}/` : fileURLToPath(new URL('../', import.meta.url));
const log = s => console.log(s);
const jsonText = o => `${JSON.stringify(o, null, 2)}\n`;
const readJSON = async (p, fallback = null) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };
const isLaw = (f, cfg) => !['medical', 'other'].includes(cfg?.practiceType || f?.practiceType);
export const REMOVED_KEEP = 50;

// ---------- pure ----------
// → { ok, slug, key, locationId, name, live, law, reason }
export function planRemove({ index, config, slug, confirm = '' }) {
  const bad = checkSlug(slug); if (bad) return { ok: false, reason: bad };
  const f = (index || []).find(x => x.slug === slug);
  if (!f) return { ok: false, reason: `"${slug}" isn't in the firm list. Nothing removed.` };
  const law = isLaw(f, config);
  if (law && f.createdBy !== 'builder' && confirm !== slug)
    return { ok: false, reason: `${slug} is a law firm with no Builder record. To remove it anyway, start the run with confirm = "${slug}". Nothing removed.` };
  // Live = published (no Draft / Needs mapping status). Only a live firm can have its menu link.
  const live = !f.status && ['created', 'exists'].includes(config?.menuLink?.status);
  return { ok: true, slug, key: f.secretKey || secretKeyFor(slug), locationId: config?.locationId || f.locationId, name: f.name || slug, live, law };
}
export function removedEntry({ slug, name, by, at, menu, secrets }) {
  return { slug, name: String(name || slug).slice(0, 120), at, by: String(by || 'someone').slice(0, 60), menu: menu || 'none', secrets: secrets || [] };
}

// ---------- commands ----------
const out = async pairs => { if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, Object.entries(pairs).map(([k, v]) => `${k}=${v}\n`).join('')); };
const firmFiles = async slug => ({ index: await readJSON(`${ROOT}firms/index.json`, []), config: await readJSON(`${ROOT}firms/${slug}/config.json`) });

async function cmdPlan() {
  const slug = (env.RF_SLUG || '').trim();
  const { index, config } = await firmFiles(slug);
  const p = planRemove({ index, config, slug, confirm: (env.RF_CONFIRM || '').trim() });
  if (!p.ok) { log(`Refused: ${p.reason}`); return 1; }
  log(`Removing ${p.slug} (${p.law ? 'law firm' : 'non-law firm'}, ${p.live ? 'live: its GHL menu link is removed too' : 'not live: no GHL menu link to remove'}).`);
  await out({ key: p.key, location: p.locationId || '', live: p.live ? 'yes' : 'no' });
  return 0;
}
async function cmdMenu() {
  const { removeMenuLink } = await import('./ghl-menu.mjs');
  const slug = env.RF_SLUG, { config } = await firmFiles(slug);
  const res = await removeMenuLink({ token: env.GHL_MENU_TOKEN, locationId: config?.locationId, slug });
  log({ removed: 'GHL menu link: removed this firm\'s "KPI Dashboard" link.', none: 'GHL menu link: none of ours on the sub-account; nothing removed.',
    'skipped-no-token': 'GHL menu link: NOT removed (no GHL_MENU_TOKEN). Remove "KPI Dashboard" by hand in GHL.', 'skipped-list-failed': 'GHL menu link: NOT removed (couldn\'t list the links). Remove it by hand in GHL.' }[res] || `GHL menu link: NOT removed (${res}). Remove it by hand in GHL.`);
  await out({ menu: res });
  return 0;   // never blocks removing the scorecard; the result is logged and shown
}
function ghSecretDelete(name, { repo, token, bin }) {
  return new Promise(resolve => {
    const p = spawn(bin, ['secret', 'delete', name, '--repo', repo], { env: { ...process.env, GH_TOKEN: token }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; p.stderr.on('data', d => { err += d; });
    p.on('error', () => resolve('error')); p.on('close', c => resolve(c === 0 ? 'deleted' : /not found|404/i.test(err) ? 'not-set' : 'error'));
  });
}
async function cmdSecrets() {
  const key = secretKeyFor(env.RF_SLUG);
  const names = [`GHL_TOKEN_${key}`, `PASSPHRASE_${key}`];
  if (!names.every(n => /^(GHL_TOKEN|PASSPHRASE)_[A-Z0-9_]{1,80}$/.test(n))) { log('Blocked: bad secret name.'); return 1; }
  const done = [];
  for (const n of names) {
    const r = await ghSecretDelete(n, { repo: env.GITHUB_REPOSITORY, token: env.SECRETS_TOKEN, bin: env.RF_GH_BIN || 'gh' });
    log(`${n}: ${r === 'deleted' ? 'deleted' : r === 'not-set' ? 'was not set' : 'NOT deleted (check KEEPER_GH_TOKEN)'}`);
    if (r !== 'error') done.push(n);
  }
  await out({ secrets: done.join(',') });
  return done.length === names.length ? 0 : 1;
}
async function cmdFiles() {
  const slug = env.RF_SLUG, { index, config } = await firmFiles(slug);
  const p = planRemove({ index, config, slug, confirm: (env.RF_CONFIRM || '').trim() });   // checked again: files are the point of no return
  if (!p.ok) { log(`Refused: ${p.reason}`); return 1; }
  await rm(`${ROOT}firms/${slug}`, { recursive: true, force: true });
  await writeFile(`${ROOT}firms/index.json`, jsonText(index.filter(f => f.slug !== slug)));
  await mkdir(`${ROOT}status`, { recursive: true });
  const prev = await readJSON(`${ROOT}status/removed.json`, { version: 1, removed: [] });
  const entry = removedEntry({ slug, name: p.name, by: env.RF_BY, at: new Date().toISOString(), menu: env.RF_MENU, });
  await writeFile(`${ROOT}status/removed.json`, jsonText({ version: 1, removed: [entry, ...(prev.removed || [])].slice(0, REMOVED_KEEP) }));
  log(`Removed firms/${slug}/ and its firm-list row (${index.length - 1} firms left). Logged in status/removed.json.`);
  return 0;
}
async function cmdNotify() {
  try {
    const { postSlack, slackEscape } = await import('./slack.mjs');
    const list = await readJSON(`${ROOT}status/removed.json`, { removed: [] }), e = (list.removed || []).find(x => x.slug === env.RF_SLUG);
    const r = await postSlack(`:wastebasket: *Scorecard removed · ${slackEscape(e?.name || env.RF_SLUG)}*\nBy ${slackEscape(e?.by || env.RF_BY || 'someone')} from the Builder.${e?.menu === 'removed' ? ' Its "KPI Dashboard" link was taken out of the GHL menu.' : ''}`);
    log(r.ok ? 'Slack: sent.' : `Slack: not sent (${r.reason}).`);
  } catch (e) { log(`Slack: not sent (${e.message}).`); }
  return 0;
}

const CMDS = { plan: cmdPlan, menu: cmdMenu, secrets: cmdSecrets, files: cmdFiles, notify: cmdNotify };
const isMain = () => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } };
if (process.argv[1] && isMain()) {
  const fn = CMDS[process.argv[2]];
  if (!fn) { console.error(`Usage: node scripts/remove-firm.mjs ${Object.keys(CMDS).join('|')}`); process.exit(1); }
  fn().then(c => { process.exitCode = c; }, e => { console.error(`remove-firm ${process.argv[2]}: ${e.message}`); process.exitCode = 1; });
}
