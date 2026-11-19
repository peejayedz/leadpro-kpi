// v1.30.1: saves the pipeline ids a sync found (law firms counted by ID, scripts/pipelines.mjs) into the LATEST
// firms/<slug>/config.json, in sync.yml's commit job. Each firm syncs in its own job and only its data/ folder reaches
// the commit job, so sync.mjs leaves a side file <dir>/<slug>.json = { slug, from, pipelineIds, pipelines }.
// Only pipelineIds and pipelines change, and only when config.json still says what the sync started from (an Edit
// mapping saved in the meantime wins). Usage: node scripts/apply-pipeline-ids.mjs <dir with *.json, searched 3 deep>
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validRefs } from './pipelines.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

async function files(dir, depth = 3) {
  const out = [];
  let list = []; try { list = await readdir(dir); } catch { return out; }
  for (const n of list) {
    const p = join(dir, n), s = await stat(p);
    if (s.isDirectory() && depth > 0) out.push(...await files(p, depth - 1));
    else if (/^[a-z0-9-]+\.json$/.test(n) && dir.split(/[\\/]/).pop() === '_pipelines') out.push(p);   // only the side files
  }
  return out;
}

export async function applyPipelineIds(dir, root = ROOT) {
  const done = [];
  for (const f of await files(dir)) {
    let x; try { x = JSON.parse(await readFile(f, 'utf8')); } catch { continue; }
    if (!x || !SLUG_RE.test(x.slug || '') || !validRefs(x.pipelineIds) || !Array.isArray(x.pipelines) || !x.pipelines.every(n => typeof n === 'string')) continue;
    const p = join(root, 'firms', x.slug, 'config.json');
    let cfg; try { cfg = JSON.parse(await readFile(p, 'utf8')); } catch { continue; }
    if (!same(cfg.pipelines || [], x.from?.pipelines || []) || !same(cfg.pipelineIds || null, x.from?.pipelineIds || null)) { done.push({ slug: x.slug, result: 'skipped (changed since)' }); continue; }
    cfg.pipelines = x.pipelines;
    cfg.pipelineIds = x.pipelineIds.map(r => ({ id: String(r.id), name: String(r.name ?? '') }));
    await writeFile(p, JSON.stringify(cfg, null, 2) + '\n');
    done.push({ slug: x.slug, result: 'saved' });
  }
  return done;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await applyPipelineIds(process.argv[2] || '.');
  for (const x of r) console.log(`Pipeline ids for ${x.slug}: ${x.result}`);
  if (!r.length) console.log('No pipeline ids to save.');
}
