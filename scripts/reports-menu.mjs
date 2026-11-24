// v1.37.0 LeadPro Reports: the "Reports" GHL menu link (menu-link.yml with kind "reports" or "reports-remove"; the KPI
// "KPI Dashboard" path in new-firm.mjs is untouched). Started only by the Builder's Reports tab, after asking:
//   kind reports         Add to GHL menu (after Andy's review): a Draft report gets its "Reports" link (ghl-menu.mjs
//                        ensureReportsLink: one sub-account, inside GHL, both allow flags false), then goes Live.
//   kind reports-remove  Remove reports for a Live report: deletes exactly that link (removeReportsLink), then the report's
//                        files (reports-config.json, reports.json, reports.html). The KPI dashboard is never touched.
//   node scripts/reports-menu.mjs plan | menu | go-live | remove      (env NF_SLUG, NF_KIND, NF_REQUEST; menu/remove: GHL_MENU_TOKEN,
//                                                                       NF_LOCATION, NF_PASSPHRASE for menu)
import { readFile, writeFile, mkdir, rm, appendFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { configPath, dataPath, stubPath, withLive, reportsOnlyValue } from './reports-core.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const env = process.env, log = m => console.log(m);
const jsonText = o => `${JSON.stringify(o, null, 2)}\n`;
const readJSON = async (p, f = null) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return f; } };
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const output = async o => { if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, Object.entries(o).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'); };
const statusFile = slug => `status/menu-link-${slug}-reports.json`;

// Which firm, and is it in the right state? Returns { key, location } or { error }.
export async function planReports({ root = ROOT, slug, kind }) {
  if (!SLUG_RE.test(slug || '')) return { error: 'No valid firm slug.' };
  const index = await readJSON(`${root}firms/index.json`, []), cfg = await readJSON(`${root}${configPath(slug)}`);
  // v1.42.0 (queue item 13): a Reports-only client (no KPI dashboard) isn't in firms/index.json; its config says who it is
  const ro = reportsOnlyValue(cfg?.reportsOnly), row = index.find(f => f.slug === slug) || (ro ? { slug, secretKey: ro.secretKey, locationId: ro.locationId } : null);
  if (!row) return { error: `"${slug}" isn't in the firm list.` };
  const kpi = await readJSON(`${root}firms/${slug}/config.json`);
  if (!cfg?.enabled) return { error: `${slug} has no Reports set up.` };
  if (kind === 'reports' && cfg.status === 'live') return { error: `${slug}'s report is already Live (in its GHL menu).` };
  if (kind === 'reports-remove' && cfg.status !== 'live') return { error: `${slug}'s report is a Draft: the Builder removes it without touching GHL.` };
  const location = kpi?.locationId || row.locationId;
  if (!/^[A-Za-z0-9]{15,30}$/.test(location || '')) return { error: `${slug} has no GHL location id.` };
  return { key: row.secretKey || slug.toUpperCase().replace(/-/g, '_'), location };
}

async function cmdPlan() {
  const slug = (env.NF_SLUG || '').trim(), kind = env.NF_KIND;
  const p = await planReports({ slug, kind });
  if (p.error) { log(`Refused: ${p.error}`); return 1; }
  log(kind === 'reports' ? `${slug}: Draft report → adding "Reports" to its GHL menu.` : `${slug}: removing its "Reports" GHL link and the report.`);
  await output({ key: p.key, location: p.location });
  return 0;
}
async function cmdMenu() {
  const { ensureReportsLink, menuReason } = await import('./ghl-menu.mjs');
  const slug = env.NF_SLUG, cfgPath = `${ROOT}${configPath(slug)}`, cfg = await readJSON(cfgPath);
  if (['created', 'exists'].includes(cfg?.menuLink?.status)) { log('Reports link: already there.'); return 0; }
  const { result: res, id, ghl } = await ensureReportsLink({ token: env.GHL_MENU_TOKEN, locationId: env.NF_LOCATION, slug, passphrase: env.NF_PASSPHRASE });
  const ok = res === 'created' || res === 'exists', reason = ok ? '' : menuReason(res, ghl);
  await mkdir(`${ROOT}status`, { recursive: true });
  await writeFile(`${ROOT}${statusFile(slug)}`, jsonText({ slug, request: String(env.NF_REQUEST || '').slice(0, 60), at: new Date().toISOString(), result: ok ? res : 'failed', ...(ok ? {} : { code: res, reason }) }));
  log(ok ? `Reports link: ${res === 'created' ? 'created "Reports" on this sub-account (opens inside GHL)' : 'a "Reports" link is already on this sub-account; nothing created'}.` : `Reports link: not added. ${reason}`);
  if (cfg && ok) { cfg.menuLink = { status: res, at: new Date().toISOString(), ...(id ? { id } : {}), ...(Number.isInteger(cfg.menuLink?.order) ? { order: cfg.menuLink.order } : {}) }; await writeFile(cfgPath, jsonText(cfg)); }
  return ok ? 0 : 1;
}
async function cmdGoLive() {
  const slug = env.NF_SLUG, cfgPath = `${ROOT}${configPath(slug)}`, cfg = await readJSON(cfgPath);
  if (!['created', 'exists'].includes(cfg?.menuLink?.status)) { log('The Reports link wasn\'t added, so the report stays a Draft.'); return 1; }
  await writeFile(cfgPath, jsonText(withLive(cfg, { by: 'Sub-account Builder' })));
  log(`${slug}'s report is Live: "Reports" is in its GHL menu.`);
  return 0;
}
async function cmdRemove() {
  const { removeReportsLink, menuReason } = await import('./ghl-menu.mjs');
  const slug = env.NF_SLUG;
  const res = await removeReportsLink({ token: env.GHL_MENU_TOKEN, locationId: env.NF_LOCATION, slug });
  const ok = res === 'removed' || res === 'none';
  await mkdir(`${ROOT}status`, { recursive: true });
  await writeFile(`${ROOT}${statusFile(slug)}`, jsonText({ slug, request: String(env.NF_REQUEST || '').slice(0, 60), at: new Date().toISOString(), result: ok ? res : 'failed', ...(ok ? {} : { code: res, reason: menuReason(res) }) }));
  if (!ok) { log(`Reports link not removed: ${menuReason(res)} The report was kept.`); return 1; }
  for (const p of [configPath(slug), dataPath(slug), stubPath(slug)]) await rm(`${ROOT}${p}`, { force: true });
  log(res === 'removed' ? `${slug}: "Reports" link removed from GHL; the report files are deleted.` : `${slug}: no "Reports" link of ours in GHL; the report files are deleted.`);
  return 0;
}

const CMDS = { plan: cmdPlan, menu: cmdMenu, 'go-live': cmdGoLive, remove: cmdRemove };
const isMain = () => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } };
if (process.argv[1] && isMain()) {
  const fn = CMDS[process.argv[2]];
  if (!fn) { console.error(`Usage: node scripts/reports-menu.mjs ${Object.keys(CMDS).join('|')}`); process.exit(1); }
  fn().then(c => { process.exitCode = c; }, e => { console.error(`reports-menu ${process.argv[2]}: ${e.message}`); process.exitCode = 1; });
}
