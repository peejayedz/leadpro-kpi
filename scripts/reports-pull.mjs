// v1.37.0 LeadPro Reports, Phase 1: the nightly BrightLocal pull (.github/workflows/reports.yml), in three steps like sync.yml.
//
//   node scripts/reports-pull.mjs plan     which firms: every firms/<slug>/reports-config.json that is enabled and has a
//                                          BrightLocal location (nightly / manual), or only the ones with a new "Build now"
//                                          request (push of a reports-config.json). No BRIGHTLOCAL_API_KEY → nothing, one
//                                          clear log line, no alert. Writes GITHUB_OUTPUT matrix / count.
//   node scripts/reports-pull.mjs pull     one firm (SLUG): BrightLocal → numbers → firms/<slug>/reports.json encrypted with
//                                          the firm's KPI passphrase (PASSPHRASE, same scheme as details.enc.json) into
//                                          OUT_DIR/<slug>/, and a result file (RESULT_FILE). Logs peak memory.
//   node scripts/reports-pull.mjs finish   copies every firm's reports.json into firms/, updates status/reports-status.json
//                                          (public: time, ok, keyword count, error kind + short reason, request id, run link).
//
// READ ONLY toward BrightLocal (scripts/brightlocal.mjs). Nothing here touches GHL.

import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { client, BrightLocalError } from './brightlocal.mjs';
import { pullable, wantsBuild, buildReport, configPath, dataPath, REPORTS_V, STATUS_PATH } from './reports-core.mjs';
export { reportsIssues } from './reports-core.mjs';
import { encryptJSON } from './kpi-core.mjs';

export const STATUS_FILE = STATUS_PATH;
export const emptyReportsStatus = () => ({ version: 1, updatedAt: null, firms: {} });
const readJSON = async (p, fallback = null) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };
const secretKeyOf = slug => slug.toUpperCase().replace(/-/g, '_');

// ---------------------------------------------------------------- plan
export async function plan({ root = '.', event = 'schedule', slug = '', hasKey = false, changed = [], log = console.log }) {
  if (!hasKey) { log('BrightLocal key not set yet (repo secret BRIGHTLOCAL_API_KEY): nothing pulled. Add it in Settings → Secrets and variables → Actions.'); return []; }
  const index = await readJSON(join(root, 'firms/index.json'), []);
  const status = await readJSON(join(root, STATUS_FILE), emptyReportsStatus());
  const out = [];
  for (const f of index) {
    if (slug && f.slug !== slug) continue;
    if (event === 'push' && changed.length && !changed.includes(configPath(f.slug))) continue;
    const cfg = await readJSON(join(root, configPath(f.slug)));
    if (!pullable(cfg)) continue;
    if (event === 'push' && !wantsBuild(cfg, status.firms?.[f.slug])) continue;   // a save without Build now waits for tonight
    out.push({ slug: f.slug, name: f.name || f.slug, secretKey: f.secretKey || secretKeyOf(f.slug), request: cfg.buildRequest?.id || '' });
  }
  log(out.length ? `Reports to build: ${out.map(x => x.slug).join(', ')}` : 'No reports to build.');
  return out;
}

// ---------------------------------------------------------------- pull (one firm)
export async function pull({ root = '.', slug, key, secret = '', pass, fetch: f = globalThis.fetch, outDir, now = new Date(), log = console.log }) {
  const cfg = await readJSON(join(root, configPath(slug)));
  if (!pullable(cfg)) throw new BrightLocalError(`${slug}: Reports isn't set up (no BrightLocal location in ${configPath(slug)}).`, { kind: 'config' });
  if (!pass) throw new BrightLocalError(`${slug}: the firm's KPI passphrase (PASSPHRASE_${secretKeyOf(slug)}) isn't set, so the numbers can't be encrypted.`, { kind: 'config' });
  const bl = client({ key, secret, fetch: f });
  const src = cfg.sources.brightlocal;
  const reports = await bl.reports(src.locationId);
  const report = (src.rankReportId && reports.find(r => r.id === String(src.rankReportId))) || reports[0];
  if (!report) throw new BrightLocalError(`${slug}: BrightLocal has no Rank Tracker report for location ${src.locationId}.`, { kind: 'no_report' });
  const [results, history] = await Promise.all([bl.results(report.id), bl.history(report.id)]);
  let location = null;
  try { location = (await bl.locations('')).find(l => l.id === String(src.locationId)) || null; } catch {}
  const rep = buildReport({ slug, location, report, results, history, now });
  const file = { v: REPORTS_V, generatedAt: rep.generatedAt, enc: await encryptJSON(rep, pass) };
  await mkdir(join(outDir, slug), { recursive: true });
  await writeFile(join(outDir, slug, 'reports.json'), `${JSON.stringify(file)}\n`);
  log(`${slug}: ${rep.summary.tracked} keywords read from BrightLocal (report ${report.id}, run ${rep.report.runAt || 'unknown'}).`);
  return { slug, ok: true, keywords: rep.summary.tracked };
}

// ---------------------------------------------------------------- finish (one commit)
export async function finish({ root = '.', matrix = [], resultsDir, dataDir, runUrl = '', now = new Date(), log = console.log }) {
  const prev = await readJSON(join(root, STATUS_FILE), emptyReportsStatus());
  const next = { ...emptyReportsStatus(), ...prev, firms: { ...(prev.firms || {}) } };
  for (const m of matrix) {
    const res = await readJSON(join(resultsDir, `${m.slug}.json`)) || { slug: m.slug, ok: false, kind: 'crashed', message: 'The job stopped before it wrote a result.' };
    const src = join(dataDir, m.slug, 'reports.json');
    let copied = false;
    if (res.ok) { try { await writeFile(join(root, dataPath(m.slug)), await readFile(src, 'utf8')); copied = true; } catch {} }
    const was = prev.firms?.[m.slug];
    const ok = !!(res.ok && copied);
    next.firms[m.slug] = { ok, at: now.toISOString(), ...(m.request ? { request: m.request } : was?.request ? { request: was.request } : {}), ...(ok ? { keywords: res.keywords ?? null, lastOkAt: now.toISOString() } : { kind: res.kind || 'error', message: String(res.message || 'Unknown error').slice(0, 200), firstFailedAt: was && !was.ok ? was.firstFailedAt || was.at : now.toISOString(), ...(was?.lastOkAt ? { lastOkAt: was.lastOkAt } : {}) }), ...(runUrl ? { runUrl } : {}) };
    log(`${ok ? '✓' : '✗'} ${m.slug}${ok ? '' : ` (${next.firms[m.slug].kind}: ${next.firms[m.slug].message})`}`);
  }
  next.updatedAt = now.toISOString();
  await mkdir(join(root, 'status'), { recursive: true });
  await writeFile(join(root, STATUS_FILE), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

const peakMb = () => Math.round((process.resourceUsage().maxRSS || 0) / 1024);

async function main() {
  const cmd = process.argv[2], env = process.env;
  if (cmd === 'plan') {
    const changed = (env.CHANGED || '').split(/\s+/).filter(Boolean);
    const m = await plan({ event: env.EVENT || 'schedule', slug: env.SLUG || '', hasKey: env.HAS_KEY === 'true', changed });
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `matrix=${JSON.stringify(m)}\ncount=${m.length}\n`);
    return;
  }
  if (cmd === 'pull') {
    const slug = env.SLUG, resultFile = env.RESULT_FILE;
    let res;
    try { res = await pull({ slug, key: env.BRIGHTLOCAL_API_KEY, secret: env.BRIGHTLOCAL_API_SECRET || '', pass: env.PASSPHRASE, outDir: env.OUT_DIR || 'out' }); }
    catch (e) { res = { slug, ok: false, kind: e.kind || 'error', message: e.message }; console.error(`::error::${slug}: ${e.message}`); process.exitCode = 1; }
    console.log(`peak memory: ${peakMb()} MB`);
    if (resultFile) { await mkdir(join(resultFile, '..'), { recursive: true }); await writeFile(resultFile, JSON.stringify(res)); }
    return;
  }
  if (cmd === 'finish') {
    const matrix = JSON.parse(env.MATRIX || '[]');
    await finish({ matrix, resultsDir: env.RESULTS_DIR, dataDir: env.DATA_DIR, runUrl: env.RUN_URL || '' });
    console.log(`peak memory: ${peakMb()} MB`);
    return;
  }
  console.error('Use: node scripts/reports-pull.mjs plan | pull | finish'); process.exitCode = 2;
}
const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) await main();
