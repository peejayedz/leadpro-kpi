// "New contacts not in pipeline": a safety net for leads that never reached "New leads".
// A contact counts when ALL of these hold:
//   1. it has no opportunity in ANY pipeline;
//   2. its contact type is "lead" (or blank), so existing customers, offboarded clients etc. are skipped;
//   3. it came in like a lead: its first-touch attribution medium is a form, survey, chat widget,
//      calendar booking or similar (rules.inboundMediums), OR it called, texted or emailed in;
//   4. it isn't part of a bulk add: rules.bulk.count or more contacts with no opportunity created
//      within rules.bulk.minutes of each other are treated as an import / bulk add and skipped.
// GHL has no reliable "imported" flag (createdBy is blank and source mostly empty on both firms
// checked on 3 Nov 2026), which is why 3 and 4 decide instead.
//
// Used by scripts/sync.mjs (selection), app/dashboard.html (via kpi-core's buildLists) and the
// admin page (pipelineNotices). No DOM, no Node APIs.

const norm = s => String(s ?? '').trim().toLowerCase();
const key = s => norm(s).replace(/[\s-]+/g, '_');

export const DEFAULT_RULES = {
  inboundMediums: ['form', 'survey', 'quiz', 'chat_widget', 'live_chat', 'calendar', 'appointment', 'booking', 'call', 'phone', 'sms', 'messenger', 'facebook_form', 'fb_lead_form', 'gmb', 'whatsapp'],
  leadTypes: ['lead', ''],
  bulk: { count: 5, minutes: 10 },
};

const MEDIUM_LABEL = { form: 'Form', survey: 'Survey', quiz: 'Survey', chat_widget: 'Chat widget', live_chat: 'Chat widget', calendar: 'Calendar booking', appointment: 'Calendar booking', booking: 'Calendar booking',
  call: 'Called in', phone: 'Called in', sms: 'Texted in', messenger: 'Messaged in', facebook_form: 'Facebook form', fb_lead_form: 'Facebook form', gmb: 'Google message', whatsapp: 'WhatsApp' };
const CHANNEL_LABEL = { Call: 'Called in', SMS: 'Texted in', Email: 'Emailed in', WhatsApp: 'WhatsApp', Live_Chat: 'Chat widget', FB: 'Messaged in', IG: 'Messaged in', GMB: 'Google message' };

export const mediumOf = c => (c.attributionSource || (Array.isArray(c.attributions) ? c.attributions[0] : null) || {}).medium || null;
const contactName = c => c.contactName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.companyName || c.phone || c.email || 'Unnamed';

// contacts: raw GHL contacts (from /contacts/search), already limited to the lookback window.
// withOpp: Set of contact ids with an opportunity in any pipeline.
// inbound: Map contactId -> Set of channels the contact called or messaged in on ('Call', 'SMS', …).
// Returns { items, skipped, tally }: items are what details.enc.json keeps; skipped holds counts only;
// tally has one row per contact with no opportunity ({ outcome, at, medium }, no names/phones/emails)
// for the came-in-by breakdown (see breakdown below).
export function pickNotInPipeline(contacts, { withOpp = new Set(), inbound = new Map(), rules = {} } = {}) {
  const R = { ...DEFAULT_RULES, ...rules, bulk: { ...DEFAULT_RULES.bulk, ...(rules.bulk || {}) } };
  const mediums = new Set((R.inboundMediums || []).map(key));
  const types = new Set((R.leadTypes || []).map(norm));
  const skipped = { hasOpportunity: 0, notLeadType: 0, bulk: 0, noInboundSignal: 0 };
  const at = c => Date.parse(c.dateAdded) || Number(c.dateAdded) || 0;

  const valid = contacts.filter(c => c?.id);
  const noOpp = valid.filter(c => !withOpp.has(c.id));
  skipped.hasOpportunity = valid.length - noOpp.length;
  // Bulk adds: a run of rules.bulk.count+ contacts (with no opportunity) inside rules.bulk.minutes.
  const bulk = new Set();
  if (R.bulk && R.bulk.count > 1) {
    const sorted = [...noOpp].sort((a, b) => at(a) - at(b)), span = R.bulk.minutes * 60e3;
    for (let i = 0, j = 0; i < sorted.length; i++) {
      if (j < i) j = i;
      while (j + 1 < sorted.length && at(sorted[j + 1]) - at(sorted[i]) <= span) j++;
      if (j - i + 1 >= R.bulk.count) for (let k = i; k <= j; k++) bulk.add(sorted[k].id);
    }
  }
  const items = [], tally = [];
  for (const c of noOpp) {
    const m = key(mediumOf(c)), row = (outcome, via) => tally.push({ outcome, via: via || null, at: at(c), medium: m || null });
    if (!types.has(norm(c.type))) { skipped.notLeadType++; row('notLeadType'); continue; }
    if (bulk.has(c.id)) { skipped.bulk++; row('bulk'); continue; }
    const ch = [...(inbound.get(c.id) || [])];
    if (!mediums.has(m) && !ch.length) { skipped.noInboundSignal++; row('noInboundSignal'); continue; }
    const via = mediums.has(m) ? (MEDIUM_LABEL[m] || m) : (CHANNEL_LABEL[[...ch].sort()[0]] || 'Messaged in');
    row('counted', via);
    items.push({
      contactId: c.id, name: contactName(c), email: c.email || null, phone: c.phone || null,
      createdAt: new Date(at(c)).toISOString(),
      via,
    });
  }
  items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return { items, skipped, tally };
}

// Came-in-by breakdown for the sync log and status/sync-status.json: counts only, fixed keys.
// Counted contacts split by how they came in, plus contacts with no opportunity that were left out.
export const BREAKDOWN_KEYS = ['form', 'survey', 'chat', 'booking', 'call', 'sms', 'email', 'other', 'bulk', 'notLeadType', 'noInboundSignal'];
const VIA_KEY = { Form: 'form', 'Facebook form': 'form', Survey: 'survey', 'Chat widget': 'chat', 'Calendar booking': 'booking', 'Called in': 'call', 'Texted in': 'sms', 'Emailed in': 'email' };
export function breakdown(tally, now, days) {
  const out = Object.fromEntries(BREAKDOWN_KEYS.map(k => [k, 0]));
  for (const r of tally || []) {
    if (!(r.at >= now - days * 864e5 && r.at <= now)) continue;
    out[r.outcome === 'counted' ? (VIA_KEY[r.via] || 'other') : r.outcome]++;
  }
  return out;
}
export const countedIn = b => ['form', 'survey', 'chat', 'booking', 'call', 'sms', 'email', 'other'].reduce((t, k) => t + (b[k] || 0), 0);

// Admin bell notices: firms with 1+ new contacts not in any pipeline in the last 30 days.
// kpis[slug].notInPipeline30 comes from the firm's public kpis.json (a count, no people).
export function pipelineNotices(firms = [], kpis = {}) {
  return firms.map(f => ({ slug: f.slug, name: f.name, count: kpis[f.slug]?.notInPipeline30 ?? null }))
    .filter(n => Number.isFinite(n.count) && n.count >= 1)
    .sort((a, b) => b.count - a.count);
}
