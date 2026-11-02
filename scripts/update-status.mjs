// Run by the "commit" job in .github/workflows/sync.yml after every sync run (after the
// firms' data has been copied in). Updates status/sync-status.json, which the admin page's
// notification bell reads. The rules live in scripts/sync-status.mjs.
//
// Env: MATRIX (the plan's [{ slug }]), PLAN_PROBLEMS ([{ slug, detail }]), RESULTS_DIR (one
//      <slug>.json per firm job, from SYNC_RESULT_FILE), RUN_URL, EVENT, CHAINED ("yes"),
//      SYNC_CHAIN (the repo variable). Reads no secrets; the file is public, see sync-status.mjs.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateStatus } from './sync-status.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const FILE = join(ROOT, 'status/sync-status.json');
const readJSON = async (p, fallback = null) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; } };
const parse = (v, fallback) => { try { return JSON.parse(v || ''); } catch { return fallback; } };

const matrix = parse(process.env.MATRIX, []);
const planProblems = parse(process.env.PLAN_PROBLEMS, []);
const attempted = (Array.isArray(matrix) ? matrix : []).map(m => m?.slug).filter(Boolean);
const results = {}, syncFlags = {};
for (const slug of attempted) {
  results[slug] = process.env.RESULTS_DIR ? await readJSON(join(process.env.RESULTS_DIR, `${slug}.json`)) : null;
  if (results[slug]?.ok) syncFlags[slug] = (await readJSON(join(ROOT, `firms/${slug}/data/kpis.json`)))?.sync || {};
}
const next = updateStatus(await readJSON(FILE), {
  now: Date.now(), runUrl: process.env.RUN_URL, event: process.env.EVENT, chained: process.env.CHAINED === 'yes',
  attempted, results, syncFlags, planProblems: Array.isArray(planProblems) ? planProblems : [], syncChain: process.env.SYNC_CHAIN || 'on',
});
await mkdir(join(ROOT, 'status'), { recursive: true });
await writeFile(FILE, JSON.stringify(next, null, 2) + '\n');
for (const slug of attempted) console.log(`${slug}: ${next.firms[slug]?.status}`);
const open = next.open.map(i => `${i.slug} ${i.kind}${i.category ? ` (${i.category})` : ''}`);
console.log(open.length ? `Open issues: ${open.join(', ')}` : 'No open issues.');
