// Shared KPI logic for the LFMP Intake & Signed Cases Scorecard.
// Imported by scripts/sync.mjs (Node) AND by index.html
// (browser), so a tile's number and its drill-down list always come from the
// same function: count = list.length, $ = sum of the list. No DOM, no Node APIs.

export const DAY = 864e5;
const norm = s => String(s ?? '').trim().toLowerCase();
const inRange = (iso, from, to) => { const t = Date.parse(iso); return t >= from && t < to; };
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const sum = rows => rows.reduce((t, r) => t + (Number(r.value) || 0), 0);

export const PERIOD_KEYS = ['today', 'yesterday', 'thisWeek', 'lastWeek', 'last7', 'last30', 'last90', 'thisMonth', 'lastMonth', 'thisQuarter', 'lastQuarter'];

// Calendar boundaries are computed in the business time zone offset given
// (minutes east of UTC, e.g. -240 for EDT) so "Today" means Indiana's today.
export function periodRange(key, now, tzOffsetMin = 0, timeZone = null) {
  const off = tzOffsetMin * 60000;
  const local = new Date(now + off);
  const y = local.getUTCFullYear(), m = local.getUTCMonth(), dd = local.getUTCDate();
  // Local midnight of a calendar date. With a time zone, each boundary uses its own UTC offset (daylight saving safe).
  const at = (yy, mo, d) => {
    let t = Date.UTC(yy, mo, d) - off;
    if (timeZone) t = Date.UTC(yy, mo, d) - tzOffsetMinFn(timeZone, t) * 60000;
    return t;
  };
  const dayStart = at(y, m, dd);
  const dow = (local.getUTCDay() + 6) % 7;                 // 0 = Monday; weeks run Monday–Sunday
  const weekStart = at(y, m, dd - dow);
  const qm = m - (m % 3);                                  // first month of this quarter
  const sinceMidnight = now - dayStart;
  const sameTime = (yy, mo, d, cap) => Math.min(at(yy, mo, d) + sinceMidnight, cap);   // same clock time on an earlier date
  // "This …" periods are compared with the same elapsed time of the previous period (a fair, partial-period comparison).
  switch (key) {
    case 'today': return { key, label: 'Today', from: dayStart, to: now, prevFrom: at(y, m, dd - 1), prevTo: sameTime(y, m, dd - 1, dayStart) };
    case 'yesterday': return { key, label: 'Yesterday', from: at(y, m, dd - 1), to: dayStart, prevFrom: at(y, m, dd - 2), prevTo: at(y, m, dd - 1) };
    case 'thisWeek': return { key, label: 'This week', from: weekStart, to: now, prevFrom: at(y, m, dd - dow - 7), prevTo: sameTime(y, m, dd - 7, weekStart) };
    case 'lastWeek': return { key, label: 'Last week', from: at(y, m, dd - dow - 7), to: weekStart, prevFrom: at(y, m, dd - dow - 14), prevTo: at(y, m, dd - dow - 7) };
    case 'last7': return { key, label: 'Last 7 days', from: now - 7 * DAY, to: now, prevFrom: now - 14 * DAY, prevTo: now - 7 * DAY };
    case 'last30': return { key, label: 'Last 30 days', from: now - 30 * DAY, to: now, prevFrom: now - 60 * DAY, prevTo: now - 30 * DAY };
    case 'last90': return { key, label: 'Last 90 days', from: now - 90 * DAY, to: now, prevFrom: now - 180 * DAY, prevTo: now - 90 * DAY };
    case 'thisMonth': { const s = at(y, m, 1), p = at(y, m - 1, 1); return { key, label: 'This month', from: s, to: now, prevFrom: p, prevTo: sameTime(y, m - 1, Math.min(dd, new Date(Date.UTC(y, m, 0)).getUTCDate()), s) }; }
    case 'lastMonth': { const s = at(y, m - 1, 1), e = at(y, m, 1), p = at(y, m - 2, 1); return { key, label: 'Last month', from: s, to: e, prevFrom: p, prevTo: s }; }
    case 'thisQuarter': { const s = at(y, qm, 1), p = at(y, qm - 3, 1); return { key, label: 'This quarter', from: s, to: now, prevFrom: p, prevTo: sameTime(y, m - 3, Math.min(dd, new Date(Date.UTC(y, m - 2, 0)).getUTCDate()), s) }; }
    case 'lastQuarter': { const s = at(y, qm - 3, 1), e = at(y, qm, 1), p = at(y, qm - 6, 1); return { key, label: 'Last quarter', from: s, to: e, prevFrom: p, prevTo: s }; }
    default: throw new Error('Unknown period ' + key);
  }
}

// ---- lead classification (one place, used by every KPI) ----
// Every funnel step is judged per lead and is cumulative: a signed client was also
// sent an agreement, held a consult, booked one, was qualified and contacted.
const hasAny = (list, vals) => (list || []).map(norm).some(x => vals.includes(x));
export function classify(lead, cfg, consultsByContact = {}, nowMs = Date.now()) {
  const S = cfg.stages || {}, T = cfg.tags || {}, Q = cfg.qualification || {}, TA = cfg.turnedAway || {};
  const stage = norm(lead.stage);
  const st = k => (S[k] || []).map(norm).includes(stage);
  const tags = (lead.tags || []).map(norm);
  const tag = k => hasAny(T[k], tags);
  const vals = (lead.qualValues || []).map(norm);
  const t0 = Date.parse(lead.createdAt) - DAY;
  const appts = (consultsByContact[lead.contactId] || []).filter(a => Date.parse(a.startTime) >= t0 && !['cancelled', 'invalid'].includes(norm(a.status)));
  const marked = (a, re) => re.test(norm(a.status).replace(/[_\s-]/g, ''));
  const pastAppt = appts.some(a => Date.parse(a.startTime) <= nowMs);

  const signed = lead.status === 'won' || st('signed') || tag('signed');
  const agreementSent = signed || st('agreementSent') || tag('agreementSent');
  const held = agreementSent || st('consultHeld') || tag('consultHeld') || appts.some(a => marked(a, /^showed$/));
  // A no-show stage or tag also proves a consult was booked (it just didn't happen).
  const booked = held || st('consultBooked') || tag('consultBooked') || st('noShow') || tag('noShow') || appts.length > 0;
  const markedNo = hasAny(Q.notTags, tags) || vals.some(v => (Q.noValues || []).map(norm).includes(v));
  const markedYes = hasAny(Q.tags, tags) || vals.some(v => (Q.yesValues || []).map(norm).includes(v));
  const qualified = booked || (!markedNo && (markedYes || st('qualified')));
  const contacted = qualified || !!lead.firstContactedAt || st('contacted') || tag('contacted');
  // No-show: a consult that should have happened by now but didn't (marked, tagged, stage, or simply not held).
  const bookedPast = held || (booked && (pastAppt || st('noShow') || tag('noShow')));
  const noShow = bookedPast && !held;
  const noShowBy = !noShow ? null : appts.some(a => marked(a, /noshow/)) ? 'Appointment marked No-show' : tag('noShow') ? 'Tagged no show'
    : st('noShow') ? 'Card in No Show stage' : 'Consult time passed, not marked held';
  // Turned away: lost, marked not qualified, or in a turned-away stage, and never signed.
  const prefix = norm(TA.tagPrefix || '');
  const reasonTag = prefix ? (lead.tags || []).find(x => norm(x).startsWith(prefix)) : null;
  const turnedAway = !signed && (lead.status === 'lost' || markedNo || hasAny(TA.stages, [stage]) || !!reasonTag);
  const turnedAwayReason = !turnedAway ? null
    : reasonTag ? cap1(String(reasonTag).slice(prefix.length).replace(/^[\s:–-]+/, ''))
    : lead.lostReason ? lead.lostReason
    : hasAny(TA.stages, [stage]) ? ((TA.reasonLabels || {})[Object.keys(TA.reasonLabels || {}).find(k => norm(k) === stage)] || lead.stage)
    : markedNo ? 'Not qualified' : 'No reason recorded';
  // A card someone actually moved: it sits in any mapped stage (or a turned-away stage), or was marked Won/Lost.
  const mapped = Object.values(S).flat().concat(TA.stages || []).map(norm);
  const stageMoved = mapped.includes(stage) || lead.status === 'won' || lead.status === 'lost';
  const step = signed ? 'Signed' : agreementSent ? 'Agreement sent' : held ? 'Consult held' : booked ? 'Consult booked' : qualified ? 'Qualified' : contacted ? 'Contacted' : 'New';
  return { contacted, qualified, consultBooked: booked, consultHeld: held, bookedPast, noShow, noShowBy, agreementSent, signed, turnedAway, turnedAwayReason, step, stageMoved,
    nextConsult: appts.map(a => a.startTime).sort().pop() || null };
}
const cap1 = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

export function contactStatus(lead, callsByContact) {
  if (lead.contacted) return String(lead.contactMethod || '').toLowerCase().includes('reply') ? 'Lead replied' : 'Successfully contacted';
  const calls = callsByContact[lead.contactId] || [];
  if (calls.some(k => k.direction === 'inbound' && !k.answered)) return 'Missed call';
  if (calls.some(k => k.direction === 'outbound')) return 'Attempted, no response';
  return 'Not attempted yet';
}

// Ad spend for [from, to): monthly amounts from config, spread evenly over each month's days.
export function adSpendFor(cfg, from, to) {
  const A = cfg.adSpend || {}, monthly = A.monthly || {};
  if (!Object.keys(monthly).length && !A.defaultMonthly) return null;
  let total = 0, any = false;
  for (let t = from; t < to; t += DAY) {
    const d = new Date(t + 12 * 3600e3), key = d.toISOString().slice(0, 7);
    const m = monthly[key] ?? A.defaultMonthly;
    if (m === undefined || m === null) continue;
    any = true;
    const days = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    total += (Number(m) / days) * Math.min(1, (to - t) / DAY);
  }
  return any ? Math.round(total) : null;
}

// ---- marketing channel (one place, used by the sync and the page) ----
// Turns GHL's raw first-touch attribution into one named channel. Rules come from
// config.channels so a new channel is a config edit, not a code change. First match wins.
export function channelOf(lead, cfg) {
  const a = lead.attribution;
  const rules = (cfg.channels && cfg.channels.rules) || [];
  const C = cfg.channels || {};
  if (!a) return C.unknownLabel || 'Unknown';
  const src = norm(a.utmSource), med = norm(a.utmMedium), ref = norm(a.referrer);
  const host = (() => { try { return new URL(a.referrer).hostname.replace(/^www\./, ''); } catch { return ref; } })();
  const ids = { gclid: !!a.gclid, msclkid: !!a.msclkid, fbclid: !!a.fbclid };
  const paid = (C.paidMediums || ['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'display', 'video']).map(norm);
  const isPaid = paid.some(p => med.replace(/[\s_-]/g, '') === p.replace(/[\s_-]/g, ''));
  const any = (list, hay) => (list || []).some(x => hay.includes(norm(x)));
  for (const r of rules) {
    const needPaid = r.paidMedium === true;
    if (needPaid && !isPaid && !(r.clickIds || []).some(k => ids[k])) continue;
    if ((r.clickIds || []).some(k => ids[k])) return r.name;
    if (r.sources && any(r.sources, src) && (!needPaid || isPaid)) return r.name;
    if (r.referrerHosts && any(r.referrerHosts, host)) return r.name;
  }
  if (isPaid || src || host) {
    const organic = (C.organic || []).find(o => any(o.referrerHosts, host) || any(o.sources || [], src));
    if (organic && !isPaid) return organic.name;
    if (host) return C.referralLabel || 'Referral';
    if (src) return `${a.utmSource}`;
  }
  return C.directLabel || 'Direct';
}

// Builds every drill-down list for one period. Tiles are derived from these.
// Funnel numbers follow the leads that came in during the dates (a cohort), so each step is a subset of the one before.
export function buildLists(records, cfg, from, to) {
  const nowMs = Date.parse(records.generatedAt) || Date.now();
  const callsByContact = {};
  for (const k of records.calls || []) (callsByContact[k.contactId] ||= []).push(k);
  for (const list of Object.values(callsByContact)) list.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const consultsByContact = {};
  for (const a of records.appointments || []) if (a.consult) (consultsByContact[a.contactId] ||= []).push(a);

  const leads = records.leads
    .filter(l => inRange(l.createdAt, from, to))
    .map(l => { const c = { ...l, ...classify(l, cfg, consultsByContact, nowMs) }; c.contactStatus = contactStatus(c, callsByContact); c.channel = channelOf(c, cfg); return c; })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const withStl = leads.filter(l => l.stlMin !== null && l.stlMin !== undefined);

  let missed = null, inboundCalls = null;
  if (records.calls) {
    inboundCalls = records.calls.filter(k => k.direction === 'inbound' && inRange(k.at, from, to));
    missed = inboundCalls.filter(k => !k.answered).map(k => {
      const back = (callsByContact[k.contactId] || []).find(o => o.direction === 'outbound' && Date.parse(o.at) > Date.parse(k.at));
      const lead = records.leads.find(l => l.contactId === k.contactId);
      return { ...k, calledBack: !!back, callbackAt: back?.at || null, callbackMin: back ? Math.round((Date.parse(back.at) - Date.parse(k.at)) / 60000) : null,
        leadStage: lead?.stage || '—', assignedTo: k.assignedTo || lead?.assignedTo || null };
    }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }
  return {
    from, to, adSpend: adSpendFor(cfg, from, to),
    newLeads: leads,
    contacted: leads.filter(l => l.contacted),
    speed: [...leads].sort((a, b) => (b.stlMin ?? 1e12) - (a.stlMin ?? 1e12)),
    speedMeasured: withStl,
    within5: withStl.filter(l => l.stlMin <= 5),
    qualified: leads.filter(l => l.qualified),
    turnedAway: leads.filter(l => l.turnedAway),
    consultBooked: leads.filter(l => l.consultBooked),
    bookedPast: leads.filter(l => l.bookedPast),
    consultHeld: leads.filter(l => l.consultHeld),
    noShows: leads.filter(l => l.noShow),
    agreementSent: leads.filter(l => l.agreementSent),
    signed: leads.filter(l => l.signed),
    inboundCalls,
    missed,
    missedNotReturned: missed ? missed.filter(k => !k.calledBack) : null,
  };
}

// The only place numbers are produced. Every number = a length of a list.
export function summarize(L) {
  const n = L.newLeads.length;
  const avg = L.speedMeasured.length ? Math.round((L.speedMeasured.reduce((t, l) => t + l.stlMin, 0) / L.speedMeasured.length) * 10) / 10 : null;
  const src = {};
  for (const l of L.newLeads) { const s = l.source || 'Unknown'; (src[s] ||= [s, 0, 0]); src[s][1]++; if (l.signed) src[s][2]++; }
  const ch = {};
  for (const l of L.newLeads) { const c = l.channel || 'Unknown'; (ch[c] ||= [c, 0, 0]); ch[c][1]++; if (l.signed) ch[c][2]++; }
  const attributed = L.newLeads.filter(l => l.attribution).length;
  const reasons = {};
  for (const l of L.turnedAway) reasons[l.turnedAwayReason] = (reasons[l.turnedAwayReason] || 0) + 1;
  return {
    totalLeads: n,
    contacted: L.contacted.length,
    contactRatePct: pct(L.contacted.length, n),
    speedToLeadAvgMin: avg,
    speedMeasured: L.speedMeasured.length,
    within5: L.within5.length,
    within5Pct: pct(L.within5.length, n),
    missedCalls: L.missed ? L.missed.length : null,
    missedNotReturned: L.missedNotReturned ? L.missedNotReturned.length : null,
    qualified: L.qualified.length,
    qualifiedPct: pct(L.qualified.length, L.contacted.length),
    turnedAway: L.turnedAway.length,
    turnedAwayReasons: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
    consultBooked: L.consultBooked.length,
    bookRatePct: pct(L.consultBooked.length, L.qualified.length),
    bookedPast: L.bookedPast.length,
    consultHeld: L.consultHeld.length,
    showRatePct: pct(L.consultHeld.length, L.bookedPast.length),
    noShows: L.noShows.length,
    noShowPct: pct(L.noShows.length, L.bookedPast.length),
    agreementSent: L.agreementSent.length,
    sentRatePct: pct(L.agreementSent.length, L.consultHeld.length),
    signed: L.signed.length,
    signRatePct: pct(L.signed.length, L.agreementSent.length),
    leadToSignedPct: pct(L.signed.length, n),
    adSpend: L.adSpend,
    costPerSigned: L.adSpend !== null && L.adSpend !== undefined && L.signed.length ? Math.round(L.adSpend / L.signed.length) : null,
    bySource: Object.values(src).sort((a, b) => b[1] - a[1] || b[2] - a[2]),
    byChannel: Object.values(ch).sort((a, b) => b[1] - a[1] || b[2] - a[2]),
    attributedLeads: attributed,
    stageMoved: L.newLeads.filter(l => l.stageMoved).length,
    attributionPct: pct(attributed, n),
    funnel: [
      ['New leads', n, 'newLeads', null], ['Contacted', L.contacted.length, 'contacted', 'of leads'],
      ['Qualified', L.qualified.length, 'qualified', 'of contacted'], ['Consult booked', L.consultBooked.length, 'consultBooked', 'of qualified'],
      ['Consult held', L.consultHeld.length, 'consultHeld', 'of booked'], ['Agreement sent', L.agreementSent.length, 'agreementSent', 'of held'],
      ['Signed', L.signed.length, 'signed', 'of sent'],
    ],
  };
}

// What the selected range is compared against.
//   prev   = the previous period of the same length; for "This …" periods, up to the same point in time (default)
//   full   = the whole previous period (only differs for Today / This week / This month / This quarter)
//   custom = two dates picked by the user
//   off    = no comparison
const FULL_PREV = { today: 'yesterday', thisWeek: 'lastWeek', thisMonth: 'lastMonth', thisQuarter: 'lastQuarter' };
export function compareRange(range, mode, now, tzOffsetMin = 0, custom = null, timeZone = null) {
  if (mode === 'off') return null;
  if (mode === 'custom' && custom?.from && custom?.to) { const r = customRange(custom.from, custom.to, now, tzOffsetMin, timeZone); return { mode, from: r.from, to: r.to }; }
  if (mode === 'full' && FULL_PREV[range.key]) { const k = FULL_PREV[range.key], r = periodRange(k, now, tzOffsetMin, timeZone); return { mode, from: r.from, to: r.to, periodKey: k }; }
  return { mode: 'prev', from: range.prevFrom, to: range.prevTo };
}
export const hasFullPrev = key => !!FULL_PREV[key];

// Local-midnight day boundaries covering [from, to) in an IANA zone (handles daylight saving).
export function dayStarts(from, to, timeZone) {
  const out = [];
  const startOf = t => { const l = new Date(t + tzOffsetMin(timeZone, t) * 60000); const base = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate()); let g = base - tzOffsetMin(timeZone, t) * 60000; return base - tzOffsetMin(timeZone, g) * 60000; };
  for (let d = startOf(from), guard = 0; d < to && guard < 400; guard++) {
    out.push(d);
    let next = startOf(d + DAY + 3 * 3600e3);       // jump past the next midnight, then snap back to it
    if (next <= d) next = d + DAY;
    d = next;
  }
  return out;
}

// Custom range from two calendar dates 'YYYY-MM-DD' (inclusive) in the business zone.
export function customRange(fromDate, toDate, now, tzOffsetMin = 0, timeZone = null) {
  const off = tzOffsetMin * 60000;
  const d = s => { const [y, m, dd] = s.split('-').map(Number); let t = Date.UTC(y, m - 1, dd) - off; if (timeZone) t = Date.UTC(y, m - 1, dd) - tzOffsetMinFn(timeZone, t) * 60000; return t; };
  const [ty, tm, td] = toDate.split('-').map(Number);
  const next = new Date(Date.UTC(ty, tm - 1, td + 1)).toISOString().slice(0, 10);
  const from = d(fromDate), to = Math.min(d(next), now);
  const [fy, fm, fd] = fromDate.split('-').map(Number);
  const nDays = Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY) + 1;
  const prevStart = new Date(Date.UTC(fy, fm - 1, fd - nDays)).toISOString().slice(0, 10);
  const fmt = s => new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return { key: 'custom', label: fromDate === toDate ? fmt(fromDate) : `${fmt(fromDate)} – ${fmt(toDate)}`, from, to, prevFrom: d(prevStart), prevTo: from };
}

// Minutes east of UTC for an IANA zone at a moment (handles daylight saving).
function tzOffsetMinFn(timeZone, now) { return tzOffsetMin(timeZone, now); }
export function tzOffsetMin(timeZone, now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(now)).map(p => [p.type, p.value]));
  const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUTC - Math.floor(now / 1000) * 1000) / 60000);
}

export function computeAll(records, cfg, now) {
  const periods = {};
  const off = tzOffsetMin(cfg.timezone || 'UTC', now);
  for (const key of PERIOD_KEYS) {
    const r = periodRange(key, now, off, cfg.timezone || null);
    periods[key] = {
      label: r.label, from: r.from, to: r.to,
      current: summarize(buildLists(records, cfg, r.from, r.to)),
      previous: summarize(buildLists(records, cfg, r.prevFrom, r.prevTo)),
    };
  }
  return periods;
}

// ---- encryption (AES-GCM 256, key from passphrase via PBKDF2-SHA256) ----
const b64 = {
  enc: buf => { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); },
  dec: str => Uint8Array.from(atob(str), c => c.charCodeAt(0)),
};
async function deriveKey(pass, salt, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function encryptJSON(obj, pass, iter = 210000) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt, iter);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, alg: 'AES-GCM-256/PBKDF2-SHA256', iter, salt: b64.enc(salt), iv: b64.enc(iv), ct: b64.enc(ct) };
}
export async function decryptJSON(env, pass) {
  const key = await deriveKey(pass, b64.dec(env.salt), env.iter);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(env.iv) }, key, b64.dec(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
