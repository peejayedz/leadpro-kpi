// Non-law scorecards (v1.28.0): practice types, pipeline mapping by stage ID, people counting.
// Imported by scripts/sync.mjs (Node), app/dashboard.html and admin/ (browser). No DOM, no Node APIs.
//
// Law firms (practiceType absent or "law") never reach this file's counting: their numbers come from
// kpi-core.mjs exactly as before. Medical & dental and Other firms are counted here:
//   - the mapping is stored by GHL stage ID and pipeline ID (names kept for display only), so renames in GHL
//     don't break it;
//   - several pipelines feed the same buckets;
//   - PEOPLE are counted, not opportunities: one person's opportunities are merged and their furthest stage wins;
//   - an opportunity in a stage that isn't mapped counts nowhere (the sync flags it: drift guard);
//   - funnel steps are cumulative, as for law firms: reaching a later step also counts in every earlier one.

const norm = s => String(s ?? '').trim().toLowerCase();
const inRange = (iso, from, to) => { const t = Date.parse(iso); return t >= from && t < to; };
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

// ---------- practice types ----------
export const PRACTICE_TYPES = [
  ['law', 'Law firm'],
  ['medical', 'Medical & dental'],
  ['other', 'Other'],
];
export const practiceTypeOf = cfg => (['medical', 'other'].includes(cfg?.practiceType) ? cfg.practiceType : 'law');
export const isCare = cfg => practiceTypeOf(cfg) !== 'law';
export const practiceLabel = t => (PRACTICE_TYPES.find(x => x[0] === t) || PRACTICE_TYPES[0])[1];
// Counts only (no names, emails or phones stored or shown): a per-firm setting, ON by default for Medical & dental.
export const countsOnly = cfg => (typeof cfg?.countsOnly === 'boolean' ? cfg.countsOnly : practiceTypeOf(cfg) === 'medical');
// How a person counts as Lost when they have several opportunities: 'all' = every counted opportunity is lost
// (someone still active or treated in another pipeline isn't lost); 'any' = any one is lost. A per-firm setting.
export const lostRule = cfg => (cfg?.lostWhen === 'any' ? 'any' : 'all');

// ---------- buckets ----------
// [key, label, funnel rank]. Lost and Ignore are not funnel steps.
export const BUCKETS = [
  ['newEnquiry', 'New enquiry', 1],
  ['contacted', 'Contacted', 2],
  ['consultBooked', 'Consult booked', 3],
  ['consultAttended', 'Consult attended', 4],
  ['yes', 'Yes', 5],
  ['done', 'Done', 6],
  ['lost', 'Lost', null],
  ['ignore', 'Ignore', null],
];
export const BUCKET_KEYS = BUCKETS.map(b => b[0]);
const RANK = Object.fromEntries(BUCKETS.map(([k, , r]) => [k, r]));
export const bucketLabel = k => (BUCKETS.find(b => b[0] === k) || [k, k])[1];
// What each bucket means, per practice type (chip tooltips in Map pipelines).
export const BUCKET_HINTS = {
  medical: { newEnquiry: 'A new patient enquiry', contacted: 'Someone reached them or is qualifying them', consultBooked: 'A consult is booked', consultAttended: 'The consult happened (quote or decision pending)',
    yes: 'Treatment accepted: deposit paid or procedure scheduled', done: 'Procedure or treatment completed', lost: 'Not going ahead', ignore: 'Not part of the patient journey (e.g. after-care); counts nowhere' },
  other: { newEnquiry: 'A new lead', contacted: 'Someone reached them', consultBooked: 'An appointment is booked', consultAttended: 'The appointment happened',
    yes: 'Won', done: 'Completed or delivered', lost: 'Not going ahead', ignore: 'Not part of the sales journey; counts nowhere' },
};

// ---------- wording + metrics per practice type ----------
export const WORDS = {
  medical: {
    enquiries: 'Patient enquiries', enquiry: 'patient enquiry', people: 'patients', person: 'patient',
    contacted: 'Contacted', booked: 'Consults booked', attended: 'Consults attended', yes: 'Treatment accepted', done: 'Procedures completed', lost: 'Lost',
    value: 'Value', showRate: 'Show rate', noShowRate: 'No-show rate', hero: 'Enquiry → treatment accepted',
    heroLine: (y, n) => `${y} of ${n} patient enquir${n === 1 ? 'y' : 'ies'} accepted treatment`,
    funnelTitle: 'Where patients drop off',
  },
  other: {
    enquiries: 'Leads', enquiry: 'lead', people: 'people', person: 'person',
    contacted: 'Contacted', booked: 'Appointments', attended: 'Appointments held', yes: 'Won', done: 'Completed', lost: 'Lost',
    value: 'Value', showRate: 'Show rate', noShowRate: 'No-show rate', hero: 'Lead → won',
    heroLine: (y, n) => `${y} of ${n} lead${n === 1 ? '' : 's'} won`,
    funnelTitle: 'Where leads drop off',
  },
};
export const wordsFor = cfg => WORDS[practiceTypeOf(cfg)] || WORDS.other;
// Which metrics show. noShowRate only when the firm has no-show data at all (see summarizeCare / noShowTracked).
export const METRICS = {
  medical: ['enquiries', 'booked', 'showRate', 'yes', 'done', 'value', 'noShowRate'],
  other: ['enquiries', 'booked', 'yes', 'value'],
};
// Funnel rows: [label word key, list key]
export const FUNNEL = {
  medical: [['enquiries', 'enquiries'], ['contacted', 'contacted'], ['booked', 'booked'], ['attended', 'attended'], ['yes', 'yes'], ['done', 'done']],
  other: [['enquiries', 'enquiries'], ['booked', 'booked'], ['yes', 'yes']],
};

// ---------- the stored mapping ----------
// config.pipelineMap = {
//   pipelines: [{ id, name, use }],                       // every pipeline seen when mapping; use=false = left out on purpose
//   stages: { <stageId>: { bucket, name, pipelineId } }, // name/pipelineId are for display and drift checks only
// }
export const mapOf = cfg => ({ pipelines: cfg?.pipelineMap?.pipelines || [], stages: cfg?.pipelineMap?.stages || {} });
export const usedPipelineIds = cfg => new Set(mapOf(cfg).pipelines.filter(p => p.use !== false).map(p => p.id));

// Pre-fill by stage name. Never guesses Ignore (that's only ever an explicit choice). Order matters.
const GUESS = [
  ['lost', /\blost\b|not interested|disqualif|\bdead\b|declined|no longer|unqualified|closed[\s–-]*lost/i],
  ['consultAttended', /(consult|appointment|consultation)\w*\W+(\w+\W+){0,2}(completed?|attended|held|showed|done)|\bquote\b|deciding|proposal/i],
  ['yes', /deposit|(surgery|procedure|treatment)\W+(\w+\W+){0,1}(scheduled|booked|accepted)|travel confirmed|\bwon\b|closed[\s–-]*won|\bsigned\b|accepted|\bpaid\b/i],
  ['done', /(surgery|procedure|treatment|service|job|work)\W+(\w+\W+){0,1}(completed?|done|finished|delivered)|^completed?$|^done$/i],
  ['consultBooked', /(consult|appointment|consultation|meeting|call)\w*\W+(\w+\W+){0,2}(booked|scheduled)|^(booked|scheduled)$/i],
  ['contacted', /contact|qualif|connected|reached|follow[\s-]?up|nurtur/i],
  ['newEnquiry', /\bnew\b|\blead\b|enquir|inquir|incoming|^open$/i],
];
export function guessBucket(name) {
  for (const [k, re] of GUESS) if (re.test(String(name || ''))) return k;
  return null;
}

// Location presets (firms/_presets/care-*.json): { locationId, pipelines: { <pipeline name>: { <stage name>: bucket } } }.
// Matched by name (case-insensitive) at mapping time only; what's saved is always by id.
// Names compare with case, dash style (– — -) and spacing ignored ("Closed – Lost" = "closed-lost").
const loose = s => norm(s).replace(/[‐-―-]/g, '-').replace(/\s*([-/&()])\s*/g, '$1').replace(/\s+/g, ' ');
export function presetBucket(preset, pipelineName, stageName) {
  if (!preset?.pipelines) return null;
  const p = Object.entries(preset.pipelines).find(([n]) => loose(n) === loose(pipelineName));
  if (!p) return null;
  const s = Object.entries(p[1]).find(([n]) => loose(n) === loose(stageName));
  return s && BUCKET_KEYS.includes(s[1]) ? s[1] : null;
}

// The Map pipelines step's starting state, from discovery.json (pipelines + stages, read-only from GHL).
// Each stage: { id, name, bucket, source } with source 'saved' | 'preset' | 'guess' | null (nothing chosen yet).
// A pipeline is ticked when it's in the saved map with use=true; for a firm never mapped: every pipeline.
export function careInitialState({ discovery, config, preset = null }) {
  const saved = mapOf(config), savedPipes = new Map(saved.pipelines.map(p => [p.id, p]));
  const neverMapped = !saved.pipelines.length;
  const pipelines = (discovery?.pipelines || []).map(p => ({
    id: p.id, name: p.name,
    use: neverMapped ? true : savedPipes.has(p.id) ? savedPipes.get(p.id).use !== false : false,
    isNew: !neverMapped && !savedPipes.has(p.id),
    stages: (p.stages || []).map(s => {
      const sv = saved.stages[s.id];
      if (sv && BUCKET_KEYS.includes(sv.bucket)) return { id: s.id, name: s.name, bucket: sv.bucket, source: 'saved', renamedFrom: sv.name && sv.name !== s.name ? sv.name : null };
      const pb = presetBucket(preset, p.name, s.name);
      if (pb) return { id: s.id, name: s.name, bucket: pb, source: 'preset' };
      const g = guessBucket(s.name);
      return { id: s.id, name: s.name, bucket: g, source: g ? 'guess' : null };
    }),
  }));
  // Pipelines in the saved map that GHL no longer has.
  const gone = saved.pipelines.filter(p => p.use !== false && !pipelines.some(x => x.id === p.id)).map(p => ({ id: p.id, name: p.name }));
  return { pipelines, gone };
}
// Stages that still need a choice (in ticked pipelines). Save is blocked until this is empty.
export const unchosen = state => state.pipelines.filter(p => p.use).flatMap(p => p.stages.filter(s => !s.bucket).map(s => ({ pipeline: p.name, ...s })));
// What Map pipelines saves into config.pipelineMap.
export function buildPipelineMap(state) {
  const stages = {};
  for (const p of state.pipelines) if (p.use) for (const s of p.stages) if (s.bucket) stages[s.id] = { bucket: s.bucket, name: s.name, pipelineId: p.id };
  return { pipelines: state.pipelines.map(p => ({ id: p.id, name: p.name, use: !!p.use })), stages };
}
// Writes the mapping and practice settings into a firm config. Law keys (stages, pipelines…) are left alone, so a
// firm switched back to Law firm keeps its old law mapping.
export function applyCare(cfg, { practiceType, pipelineMap, countsOnly: co }) {
  cfg.practiceType = practiceType;
  if (typeof co === 'boolean') cfg.countsOnly = co;
  cfg.pipelineMap = pipelineMap;
  delete cfg.mappingReview;
  return cfg;
}

// ---------- drift guard ----------
// pipelines: GHL's current pipelines [{ id, name, stages: [{ id, name }] }]. Returns counts plus names for logs/admin.
//   unmappedStages: stages in a used pipeline that have no bucket (new or never mapped). They count nowhere.
//   newPipelines:   pipelines GHL has that the map has never seen (neither used nor left out on purpose).
//   gonePipelines:  used pipelines in the map that GHL no longer has.
export function careDrift(cfg, pipelines) {
  const M = mapOf(cfg), used = usedPipelineIds(cfg), known = new Set(M.pipelines.map(p => p.id));
  const unmappedStages = [], newPipelines = [], gonePipelines = [];
  for (const p of pipelines || []) {
    if (!known.has(p.id)) { newPipelines.push({ id: p.id, name: p.name }); continue; }
    if (!used.has(p.id)) continue;
    for (const s of p.stages || []) if (!M.stages[s.id]) unmappedStages.push({ id: s.id, name: s.name, pipeline: p.name });
  }
  const live = new Set((pipelines || []).map(p => p.id));
  for (const p of M.pipelines) if (p.use !== false && !live.has(p.id)) gonePipelines.push({ id: p.id, name: p.name });
  return { unmappedStages, newPipelines, gonePipelines };
}
// Law firms (warning only; their counting is unchanged): stages they list (by id or name) that GHL no longer has,
// stages GHL has in the counted pipelines that weren't there when the mapping was last read (discovery.json),
// and counted pipelines (by name) that disappeared. Returns the same shape as careDrift.
export function lawDrift(cfg, pipelines, discovery) {
  const counted = (cfg.pipelines || []).map(norm);
  const inUse = (pipelines || []).filter(p => !counted.length || counted.includes(norm(p.name)));
  const ids = new Set(), names = new Set();
  for (const p of pipelines || []) for (const s of p.stages || []) { ids.add(s.id); names.add(norm(s.name)); }
  const listed = [...new Set([...Object.values(cfg.stages || {}).flat(), ...(cfg.turnedAway?.stages || [])].map(String))];
  const missing = listed.filter(x => !ids.has(x) && !names.has(norm(x)));
  const seen = new Set((discovery?.pipelines || []).flatMap(p => (p.stages || []).map(s => s.id)));
  const fresh = discovery ? inUse.flatMap(p => (p.stages || []).filter(s => !seen.has(s.id)).map(s => ({ id: s.id, name: s.name, pipeline: p.name }))) : [];
  const gonePipelines = counted.filter(n => !(pipelines || []).some(p => norm(p.name) === n)).map(n => ({ id: null, name: n }));
  return { unmappedStages: [...fresh, ...missing.map(x => ({ id: x, name: null, pipeline: null, missing: true }))], newPipelines: [], gonePipelines };
}
// The counts that go into kpis.json sync.drift (public: numbers only), or null when there's nothing to flag.
export function driftCounts(d) {
  const c = { stages: d.unmappedStages.length, pipelinesNew: d.newPipelines.length, pipelinesGone: d.gonePipelines.length };
  return c.stages || c.pipelinesNew || c.pipelinesGone ? c : null;
}

// ---------- people ----------
// opps: [{ oppId, contactId, pipelineId, stageId, status, value, createdAt }] (details file; no names in counts-only mode).
// Returns one row per person: { id, contactId, createdAt, rank, lost, value, oppIds, stageIds, pipelineIds, furthestStageId }.
export function buildPeople(opps, cfg) {
  const M = mapOf(cfg), used = usedPipelineIds(cfg), rule = lostRule(cfg);
  const by = new Map();
  for (const o of opps || []) {
    if (!used.has(o.pipelineId)) continue;
    const b = M.stages[o.stageId]?.bucket;
    if (!b || b === 'ignore') continue;                        // unmapped (drift) or after-care: counts nowhere
    const st = norm(o.status);
    const won = st === 'won';
    let rank = RANK[b] || 1;                                   // a Lost stage still means they were an enquiry
    if (won) rank = Math.max(rank, RANK.yes);
    const lost = !won && (b === 'lost' || st === 'lost' || st === 'abandoned');
    const key = o.contactId || `opp:${o.oppId}`;
    const p = by.get(key) || { id: key, contactId: o.contactId || null, createdAt: o.createdAt, rank: 0, lostCount: 0, opps: 0, value: 0, oppIds: [], stageIds: [], pipelineIds: [], furthestStageId: null };
    p.opps++; p.oppIds.push(o.oppId); p.stageIds.push(o.stageId); if (!p.pipelineIds.includes(o.pipelineId)) p.pipelineIds.push(o.pipelineId);
    if (Date.parse(o.createdAt) < Date.parse(p.createdAt)) p.createdAt = o.createdAt;
    if (rank > p.rank) { p.rank = rank; p.furthestStageId = o.stageId; }
    if (lost) p.lostCount++;
    if (rank >= RANK.yes) p.value += Number(o.value) || 0;
    by.set(key, p);
  }
  return [...by.values()].map(({ lostCount, opps: n, ...p }) => ({ ...p, lost: p.rank < RANK.yes && (rule === 'any' ? lostCount > 0 : lostCount === n) }));
}

// No-show data exists for this firm at all (an appointment marked no-show in the lookback window).
const isNoShow = a => /no[\s_-]?show/.test(norm(a?.status).replace(/[_\s-]/g, ''));
export const noShowTracked = appointments => (appointments || []).some(isNoShow);

// Lists for one period. A person belongs to the period their first counted opportunity was created in (a cohort,
// as for law firms), so each funnel step is part of the one before.
export function buildCareLists(records, cfg, from, to) {
  const people = (records.people || buildPeople(records.opps, cfg)).filter(p => inRange(p.createdAt, from, to))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const noShowBy = new Set();
  for (const a of records.appointments || []) if (isNoShow(a)) noShowBy.add(a.contactId);
  const at = r => people.filter(p => p.rank >= r);
  const booked = at(3);
  return {
    from, to,
    enquiries: people, contacted: at(2), booked, attended: at(4), yes: at(5), done: at(6),
    lost: people.filter(p => p.lost),
    // A booked person with an appointment marked no-show who never got to Consult attended.
    noShows: booked.filter(p => p.rank < 4 && p.contactId && noShowBy.has(p.contactId)),
  };
}
export function summarizeCare(L, { tracked = false } = {}) {
  const n = L.enquiries.length;
  const value = L.yes.reduce((t, p) => t + (p.value || 0), 0);
  const out = {
    totalLeads: n, enquiries: n, contacted: L.contacted.length, booked: L.booked.length, attended: L.attended.length,
    yes: L.yes.length, done: L.done.length, lost: L.lost.length, value,
    showRatePct: pct(L.attended.length, L.booked.length),
    noShows: tracked ? L.noShows.length : null, noShowPct: tracked ? pct(L.noShows.length, L.booked.length) : null,
    yesPct: pct(L.yes.length, n),
    // Admin list + testing banner use these, as for law firms.
    stageMoved: L.enquiries.filter(p => p.rank >= 2 || p.lost).length,
  };
  return out;
}
export function computeCareAll(records, cfg, now, { PERIOD_KEYS, periodRange, tzOffsetMin }) {
  const periods = {}, tz = cfg.timezone || 'UTC', off = tzOffsetMin(tz, now);
  const people = buildPeople(records.opps, cfg), R = { ...records, people };
  const tracked = noShowTracked(records.appointments);
  for (const key of PERIOD_KEYS) {
    const r = periodRange(key, now, off, cfg.timezone || null);
    periods[key] = { label: r.label, from: r.from, to: r.to,
      current: summarizeCare(buildCareLists(R, cfg, r.from, r.to), { tracked }),
      previous: summarizeCare(buildCareLists(R, cfg, r.prevFrom, r.prevTo), { tracked }) };
  }
  return { periods, noShowTracked: tracked, people: people.length };
}
// Per pipeline and stage, how many of these people sit there at their furthest point (counts only, for drill-downs).
export function stageBreakdown(people, cfg) {
  const M = mapOf(cfg), pipeName = Object.fromEntries(M.pipelines.map(p => [p.id, p.name]));
  const rows = new Map();
  for (const p of people) {
    const s = M.stages[p.furthestStageId] || {}, key = p.furthestStageId || '—';
    const r = rows.get(key) || { pipeline: pipeName[s.pipelineId] || '—', stage: s.name || '—', bucket: s.bucket || null, count: 0 };
    r.count++; rows.set(key, r);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || a.pipeline.localeCompare(b.pipeline));
}
// GHL's opportunities board for the location (where "Open in GHL" goes in counts-only lists).
export const ghlOpportunitiesUrl = (base, loc) => `${base || 'https://app.lawfirmmarketingpros.com'}/v2/location/${encodeURIComponent(loc || '')}/opportunities/list`;
