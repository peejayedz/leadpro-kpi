// Config layering, shared by the sync (Node), the dashboard and the admin page (browser).
// No DOM, no Node APIs.
//
// Effective config = firms/_defaults.json
//                  → firms/_defaults/<practice-area>.json   (optional; listed in firms/_defaults/index.json)
//                  → firms/<slug>/config.json               (firm-specific values and overrides)
//
// Objects merge key by key; arrays and plain values replace. A firm can switch a default
// off by setting it to null (e.g. "notice": { "autoHide": null }).

export const SHARED_KEYS = ['targets', 'notice', 'recommendedFocus', 'channels', 'attributionDisclaimer', 'qualification', 'speedToLead'];

// "Personal Injury" -> "personal-injury" (file name under firms/_defaults/)
export const practiceSlug = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function deepMerge(...layers) {
  let out = {};
  for (const layer of layers) {
    if (!isObj(layer)) continue;
    for (const [k, v] of Object.entries(layer)) {
      out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : clone(v);
    }
  }
  return out;
}

export const mergeConfig = (defaults, practice, firm) => deepMerge(defaults || {}, practice || {}, firm || {});

// The smallest override that turns `base` into `target`: changed values, plus null for anything
// `target` lacks that `base` has. Used to slim a full config down to its firm-specific part.
export function minimalOverride(base, target) {
  if (!isObj(base) || !isObj(target)) return JSON.stringify(base) === JSON.stringify(target) ? undefined : clone(target);
  const out = {};
  for (const k of Object.keys(target)) {
    const d = k in base ? minimalOverride(base[k], target[k]) : clone(target[k]);
    if (d !== undefined && !(isObj(d) && !Object.keys(d).length && isObj(base[k]))) out[k] = d;
  }
  for (const k of Object.keys(base)) if (!(k in target) && base[k] !== null) out[k] = null;
  return Object.keys(out).length ? out : undefined;
}
