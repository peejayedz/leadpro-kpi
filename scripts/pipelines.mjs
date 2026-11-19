// v1.30.0: which GHL pipelines a LAW firm counts, by pipeline ID (renaming a pipeline in GHL no longer drops the firm to
// 0 leads; that happened to Dumas & Sanclemente on 19 Nov 2026). Pure: no Node or browser APIs (sync.mjs, the admin's
// Edit mapping, tests).
//
//   config.pipelines   = [name, …]          what it has always been; kept for display and the client wording ([] = every pipeline)
//   config.pipelineIds = [{ id, name }, …]  v1.30.0: what is counted. Set by Edit mapping / New firm, or by the sync's
//                                            one-time migration: each name in config.pipelines matched against GHL's
//                                            current names ONCE, then the ids are saved and names never matter again.
//
// A counted pipeline GHL no longer has (or a name the migration can't find) is "Pipeline not found": the sync stops for
// that firm (the dashboard keeps its last numbers, never 0) and the bell + Slack say so, with a link to Edit mapping.
// Non-law firms (config.pipelineMap) were already by id and aren't handled here.

const norm = s => String(s ?? '').trim().toLowerCase();
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const validRefs = refs => Array.isArray(refs) && refs.length > 0 && refs.every(r => r && ID_RE.test(String(r.id || '')));

// pipelines: GHL's current [{ id, name, stages }]. Returns:
//   ids       Set of counted pipeline ids, or null = every pipeline (config.pipelines empty and no pipelineIds)
//   missing   [{ id|null, name }] counted pipelines GHL doesn't have (non-empty = "Pipeline not found")
//   migrated  true when pipelineIds were made from the names this time (the caller saves them)
//   refs      the pipelineIds to keep in config (current GHL names for display), or null when nothing is by id
//   names     config.pipelines to keep (current GHL names), or null for "every pipeline"
//   changed   true when refs/names differ from the config (a migration, or a pipeline renamed in GHL)
export function resolvePipelines(cfg, pipelines) {
  const live = new Map((pipelines || []).map(p => [p.id, p]));
  const had = validRefs(cfg?.pipelineIds) ? cfg.pipelineIds.map(r => ({ id: String(r.id), name: String(r.name ?? '') })) : null;
  let refs, migrated = false;
  const missing = [];
  if (had) refs = had;
  else {
    const names = (cfg?.pipelines || []).map(String);
    if (!names.length) return { ids: null, missing: [], migrated: false, refs: null, names: null, changed: false };
    refs = [];
    for (const n of names) {
      const hits = (pipelines || []).filter(p => norm(p.name) === norm(n));
      if (!hits.length) missing.push({ id: null, name: n });
      for (const p of hits) if (!refs.some(r => r.id === p.id)) refs.push({ id: p.id, name: p.name });
    }
    if (missing.length) return { ids: new Set(refs.map(r => r.id)), missing, migrated: false, refs: null, names: names, changed: false };
    migrated = true;
  }
  for (const r of refs) if (!live.has(r.id)) missing.push({ id: r.id, name: r.name });
  const now = refs.map(r => ({ id: r.id, name: live.get(r.id)?.name ?? r.name }));
  const names = [...new Set(now.map(r => r.name))];
  const changed = migrated || JSON.stringify(now) !== JSON.stringify(had) || JSON.stringify(names) !== JSON.stringify(cfg?.pipelines || []);
  return { ids: new Set(refs.map(r => r.id)), missing, migrated, refs: now, names, changed };
}

// Writes the result into a config (only when something changed): pipelineIds by id, pipelines = current names.
export function applyResolved(cfg, r) {
  if (!r.changed || !r.refs) return false;
  cfg.pipelineIds = r.refs;
  cfg.pipelines = r.names;
  return true;
}

// Edit mapping / New firm: the chosen pipelines → config. [] (every pipeline) removes pipelineIds.
export function refsFor(chosen) {
  return (chosen || []).map(p => ({ id: String(p.id), name: String(p.name ?? '') }));
}
