// Stage-mapping logic shared by the admin page (mapping panel) and tests/mapping.
// Pure: no DOM, no Node APIs.

const norm = s => String(s ?? '').trim().toLowerCase();

export const STEPS_MAP = [
  ['contacted', 'Contacted', 'Someone reached the lead'],
  ['qualified', 'Qualified', 'The lead fits the firm'],
  ['consultBooked', 'Consult booked', 'A consultation is on the calendar'],
  ['consultHeld', 'Consult held', 'The consultation happened'],
  ['agreementSent', 'Agreement sent', 'Retainer or agreement sent'],
  ['signed', 'Signed', 'Became a client'],
  ['noShow', 'No-show', 'Missed the consultation'],
  ['turnedAway', 'Turned away', 'Rejected, referred out or not a fit'],
];
// The ACME snapshot ("Lead Stages") stage names, as mapped for Mahdavi.
export const ACME = {
  contacted: ['Stage 3: Lead Contacted?'], qualified: ['Stage 4: Lead Qualified?'], consultBooked: ['Stage 5: Booked Consultation'],
  consultHeld: ['Stage 6: Consultation Showed - Agreement Sent', 'Stage 7: Consultation Showed - Lead Rejected', 'Stage 8: Consultation Showed - Lead Referred', 'Stage 9: Consultation Showed - Lead Thinking'],
  agreementSent: ['Stage 6: Consultation Showed - Agreement Sent'], signed: ['Stage 11: Agreement Signed'], noShow: ['Stage 10: Consultation No Show'],
  turnedAway: ['Stage 7: Consultation Showed - Lead Rejected', 'Stage 8: Consultation Showed - Lead Referred', 'Stage 12: Referred Lead Accepted?'],
};
const NEG = /\b(not|un|non|dis)[\s-]?(contacted|qualified|qualify)|\bno[\s-]?show/i;
const GUESS = {
  contacted: [/\bcontact(ed)?\b|\breached\b|initial contact|first contact/i, /attempt|\b(not|un|non)[\s-]?(contacted|reached)|no[\s-]?show/i],
  qualified: [/qualif/i, NEG],
  consultBooked: [/(book|schedul)\w*\W+(\w+\W+){0,2}(consult|appointment|meeting|call)|(consult|appointment|meeting)\w*\W+(\w+\W+){0,2}(book|schedul)|^scheduled$/i, /no[\s-]?show|cancel/i],
  consultHeld: [/(show(ed)?|held|attended|completed?)\w*\W+(\w+\W+){0,2}(consult|appointment|meeting)|(consult|appointment|meeting)\w*\W+(\w+\W+){0,2}(show(ed)?|held|attended|completed?)/i, /no[\s-]?show/i],
  agreementSent: [/(agreement|retainer|contract|proposal|engagement)\w*\W+(\w+\W+){0,2}sent|sent\W+(\w+\W+){0,2}(agreement|retainer|contract|proposal)/i, null],
  signed: [/\bsigned\b|\bretained\b|\bhired\b|closed[\s-]?won|^won$|new client/i, /\bnot\b|\bun/i],
  noShow: [/no[\s-]?show/i, null],
  turnedAway: [/reject|referr|declin|disqualif|turned away|not a fit|unqualified|not qualified|\blost\b/i, null],
};
export function guessMapping(stageNames) {
  const out = {};
  for (const [k] of STEPS_MAP) {
    const acme = stageNames.filter(n => ACME[k].some(a => norm(a) === norm(n)));
    if (acme.length) { out[k] = acme; continue; }
    const [yes, no] = GUESS[k];
    out[k] = stageNames.filter(n => yes.test(n) && !(no && no.test(n)));
  }
  return out;
}


// A firm whose config says "stageMatch": "id" lists stages by GHL stage id, so renaming a stage in
// GHL can't break its mapping. The panel still works with names; ids are swapped in on load and save.
const stageIdIndex = (discovery, chosenPipes) => {
  const nameOf = {}, idsOf = {};
  for (const p of discovery?.pipelines || []) for (const s of p.stages || []) {
    nameOf[s.id] = s.name;
    if (!chosenPipes || chosenPipes.has(p.id)) (idsOf[norm(s.name)] ||= []).push(s.id);
  }
  return { nameOf, idsOf };
};

// The panel's starting state. Existing firm: from its config. New firm: guessed from the stage names.
export function initialState({ discovery, config, isNew }) {
  const pipelines = discovery?.pipelines || [];
  const cfgPipes = (config?.pipelines || []).map(norm);
  let chosenPipes;
  if (!isNew) chosenPipes = new Set(pipelines.filter(p => !cfgPipes.length || cfgPipes.includes(norm(p.name))).map(p => p.id));
  else {
    const allNames = pipelines.flatMap(p => p.stages.map(s => s.name));
    const g = guessMapping(allNames); const hit = new Set(Object.values(g).flat().map(norm));
    const scored = pipelines.map(p => ({ id: p.id, n: p.stages.filter(s => hit.has(norm(s.name))).length }));
    // Every pipeline with at least 3 recognised funnel stages (a firm can have one intake pipeline per
    // practice area); otherwise the best-scoring one; otherwise the first, so it can be mapped by hand.
    const best = Math.max(0, ...scored.map(s => s.n));
    const strong = scored.filter(s => s.n >= 3);
    chosenPipes = new Set(strong.length ? strong.map(s => s.id) : best > 0 ? scored.filter(s => s.n === best).map(s => s.id) : pipelines.slice(0, 1).map(p => p.id));
  }
  const fromCfg = k => k === 'turnedAway' ? (config?.turnedAway?.stages || []) : (config?.stages?.[k] || []);
  const initial = isNew ? guessMapping(stageList(discovery, chosenPipes)) : Object.fromEntries(STEPS_MAP.map(([k]) => [k, fromCfg(k)]));
  const idMode = !isNew && config?.stageMatch === 'id';
  // In id mode an id is shown by its stage name; an id not in discovery.json is kept as written.
  const { nameOf } = stageIdIndex(discovery);
  const shown = v => (idMode && nameOf[v]) || v;
  const sel = {};
  for (const [k] of STEPS_MAP) sel[k] = new Map((initial[k] || []).map(v => [norm(shown(v)), shown(v)]));   // normName -> name as written
  return { chosenPipes, sel, keywords: [...(config?.booking?.calendarKeywords || [])], allByDefault: !isNew && !cfgPipes.length, idMode };
}

// Stage names of the chosen pipelines, in pipeline order, de-duplicated (case-insensitive).
export function stageList(discovery, chosenPipes) {
  const seen = new Set(), out = [];
  for (const p of discovery?.pipelines || []) if (chosenPipes.has(p.id)) for (const s of p.stages) if (!seen.has(norm(s.name))) { seen.add(norm(s.name)); out.push(s.name); }
  return out;
}

// What the panel saves: { pipelines, stages, turnedAway, calendarKeywords }.
export function buildMapping(state, discovery) {
  const pipelines = discovery?.pipelines || [];
  const chosen = pipelines.filter(p => state.chosenPipes.has(p.id)).map(p => p.name);
  const { idsOf } = stageIdIndex(discovery, state.chosenPipes);
  // Id mode: each picked name becomes the id of every chosen-pipeline stage with that name (ids not found stay as they are).
  const pick = k => { const names = [...state.sel[k].values()]; return state.idMode ? [...new Set(names.flatMap(n => idsOf[norm(n)] || [n]))] : names; };
  return {
    // A config that said "every pipeline" ([]) keeps saying so while every pipeline is still ticked.
    pipelines: state.allByDefault && chosen.length === pipelines.length ? [] : chosen,
    stages: Object.fromEntries(STEPS_MAP.filter(([k]) => k !== 'turnedAway').map(([k]) => [k, pick(k)])),
    turnedAway: pick('turnedAway'),
    calendarKeywords: state.keywords,
  };
}

// Writes a mapping into a firm config. Keys the config doesn't have are only added when they hold
// something, so saving an unchanged mapping leaves config.json byte-identical.
export function applyMapping(cfg, m) {
  cfg.pipelines = m.pipelines;
  cfg.stages = { ...(cfg.stages || {}) };
  for (const [k, v] of Object.entries(m.stages)) if (k in cfg.stages || v.length) cfg.stages[k] = v;
  const ta = { ...(cfg.turnedAway || {}), stages: m.turnedAway };
  if (ta.reasonLabels) ta.reasonLabels = Object.fromEntries(Object.entries(ta.reasonLabels).filter(([k]) => m.turnedAway.some(s => norm(s) === norm(k))));
  cfg.turnedAway = ta;
  cfg.booking = { ...(cfg.booking || {}), calendarKeywords: m.calendarKeywords };
  return cfg;
}
