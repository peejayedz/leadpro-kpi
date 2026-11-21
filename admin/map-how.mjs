// v1.35.0 (queue item 2, PJ's LFMP_Mapping_Explainer_Preview): "How we fill this in for you" on Map pipelines (Medical &
// dental / Other) and Edit mapping (law). It only DESCRIBES the rules the code uses: scripts/care-core.mjs GUESS (order
// and words) and admin/mapping.mjs ACME + GUESS. tests/admin-ui checks the examples below against those functions.
// Open the first time on a device, then remembered (localStorage "lfmp-map-how": "open" | "closed"); storage blocked →
// closed. No change to how anything is counted or saved.

export const HOW_KEY = 'lfmp-map-how';
export function howOpen(store = globalThis.localStorage) {
  try { const v = store.getItem(HOW_KEY); return v == null ? true : v === 'open'; } catch { return false; }
}
export function rememberHow(open, store = globalThis.localStorage) { try { store.setItem(HOW_KEY, open ? 'open' : 'closed'); } catch {} }

// [bucket, label, stage names like…, words we look for] — the "like" names are checked by the tests to guess that bucket.
export const CARE_ROWS = [
  ['newEnquiry', 'New enquiry', ['New Lead', 'Incoming', 'Open'], 'new, lead, enquiry / inquiry, incoming, or a stage called just "Open"'],
  ['contacted', 'Contacted', ['Contacted', 'Follow Up', 'Nurture'], 'contact, qualif…, connected, reached, follow up, nurture'],
  ['consultBooked', 'Consult booked', ['Consult Scheduled', 'Appointment Booked'], 'booked or scheduled after consult, appointment, meeting or call; or a stage called just "Booked" / "Scheduled"'],
  ['consultAttended', 'Consult attended', ['Consult Completed', 'Quote Sent'], 'completed, attended, held, showed or done after consult / appointment; quote, deciding, proposal'],
  ['yes', 'Yes', ['Deposit Paid', 'Surgery Scheduled'], 'deposit, paid, accepted, signed, won, travel confirmed; surgery / procedure / treatment scheduled or booked'],
  ['done', 'Done', ['Surgery Completed', 'Treatment Done'], 'surgery / procedure / treatment / service / job / work completed, done, finished or delivered; or a stage called just "Completed" / "Done"'],
  ['lost', 'Lost', ['Not Interested', 'Closed – Lost'], 'lost, not interested, disqualified, unqualified, dead, declined, no longer'],
  ['ignore', 'Ignore', ['Post-Op Care', 'After-care'], 'never guessed: only you choose it'],
];
export const CARE_ORDER = ['Lost', 'Consult attended', 'Yes', 'Done', 'Consult booked', 'Contacted', 'New enquiry'];
// [step, label, stage names like…, words we look for]
export const LAW_ROWS = [
  ['contacted', 'Contacted', ['Lead Contacted?', 'Reached'], 'contacted, reached, initial / first contact (not "attempting", "not contacted" or "no show")'],
  ['qualified', 'Qualified', ['Lead Qualified?'], 'qualif… (not "unqualified", "not qualified", "disqualified" or "no show")'],
  ['consultBooked', 'Consult booked', ['Booked Consultation', 'Appointment Scheduled'], 'booked or scheduled + consult / appointment / meeting / call, or just "Scheduled" (not "no show" or "cancel")'],
  ['consultHeld', 'Consult held', ['Consultation Showed - Lead Thinking', 'Consult Held'], 'showed, held, attended or completed + consult / appointment / meeting (not "no show")'],
  ['agreementSent', 'Agreement sent', ['Agreement Sent', 'Retainer Sent'], 'agreement / retainer / contract / proposal / engagement + sent'],
  ['signed', 'Signed', ['Agreement Signed', 'Retained'], 'signed, retained, hired, closed won, won, new client (not "not" or "un…")'],
  ['noShow', 'No-show', ['Consultation No Show'], 'no show'],
  ['turnedAway', 'Turned away', ['Lead Rejected', 'Lead Referred'], 'rejected, referred, declined, disqualified, turned away, not a fit, unqualified, not qualified, lost'],
];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const table = (head, rows) => `<div class="mh-tbl" role="table" aria-label="${esc(head)}"><div class="mh-th" role="row"><span role="columnheader">${esc(head)}</span><span role="columnheader">Stage names like…</span><span role="columnheader">Words we look for</span></div>
${rows.map(([k, l, like, w]) => `<div class="mh-tr${k === 'ignore' ? ' ign' : ''}" role="row"><b role="cell">${esc(l)}</b><span class="mh-like" role="cell">${like.map(esc).join(' · ')}</span><span class="mh-w" role="cell">${esc(w)}</span></div>`).join('\n')}</div>`;
const way = (cls, t, p, x = '') => `<div class="mh-way${cls ? ` ${cls}` : ''}"><div class="mh-wt">${t}</div><p>${p}</p>${x ? `<div class="mh-wx">${x}</div>` : ''}</div>`;
const facts = list => `<div class="mh-facts">${list.map(([b, t]) => `<div><b>${b}</b>${t}</div>`).join('')}</div>`;
const shell = (open, body) => `<details class="mh" data-mh${open ? ' open' : ''}><summary><span class="mh-car" aria-hidden="true">›</span> How we fill this in for you</summary><div class="mh-b">${body}</div></details>`;

export function careHowHtml({ open = howOpen(), patient = true } = {}) {
  return shell(open, `<p class="mh-lead">We fill in every stage for you, then <b>you check it</b>. Each stage gets one of three things:</p>
<div class="mh-ways">${way('', '✓ Kept from before', `You (or this ${patient ? 'practice' : 'business'}'s preset) already chose it. We keep it, even if the stage was renamed in GHL.`, '<span class="mh-eg">Shows: nothing extra</span>')}${way('', '✎ Guessed from the name', 'The stage name has a word we recognise. The tag shows which word.', '<span class="mh-eg">"Deposit Paid" → <b>Yes</b></span><span class="mh-tag">Guessed: “Deposit”</span>')}${way('warn', '? Left for you', 'No word we recognise. You pick the bucket. We never guess <b>Ignore</b>.', '<span class="mh-eg">"Post-Op Care" → you choose</span><span class="mh-tag warn">Choose</span>')}</div>
${table('Bucket', CARE_ROWS)}
<p class="mh-small">Names are checked in this order and the first that fits wins: ${CARE_ORDER.map(x => `<b>${x}</b>`).join(', ')}. So "Consult Completed – Not Interested" is <b>Lost</b>, and "Surgery Scheduled" is <b>Yes</b>, not Consult booked.</p>
${facts([['1 patient = 1 count.', ` Each ${patient ? 'patient' : 'person'} counts once, at the furthest step they reached.`], ['Later steps include earlier ones.', ' Done also counts as Yes, Consult attended, and so on.'], ['Always check the guesses.', ' A name can mislead. Clicking a bucket replaces the guess.']])}`);
}
export function lawHowHtml({ open = howOpen() } = {}) {
  return shell(open, `<p class="mh-lead">The stages above each step are filled in for you, then <b>you check them</b>. They come from one of three places:</p>
<div class="mh-ways">${way('', '✓ Saved mapping', 'A firm that\'s already set up shows exactly what was saved. A renamed pipeline stays ticked.')}${way('', '★ LFMP template', 'A new firm built from our template gets the standard <b>Lead Stages</b> mapping (exact stage names): Stage 3 → Contacted, Stage 5 → Consult booked, Stage 11 → Signed…')}${way('warn', '✎ Guessed from names', 'Anything else is guessed from the stage names below. The bell shows <b>Review mapping</b> until someone saves.')}</div>
${table('Step', LAW_ROWS)}
<p class="mh-small">One stage can count for more than one step ("Consultation Showed – Agreement Sent" is both Consult held and Agreement sent).</p>
${facts([['New leads', ' = every opportunity in the ticked pipelines. No stage needed.'], ['Pick the stage that first proves a step.', ' Signed also counts as Consult held, Booked, Qualified and Contacted.'], ['Consult calendars:', ' an appointment is a consult when its calendar name has one of the keywords below.']])}`);
}
export const SHOWING = {
  saved: 'your saved mapping',
  preset: 'Pre-filled from the LFMP template preset',
  guessed: 'Guessed from the stage names: check every step',
};
// v1.36.1 (Q2.1): "your saved mapping · last saved Nov 21, 2026" when config.mappingSavedAt is known (saves from 21 Nov on)
export const savedWhen = iso => { const d = new Date(iso || ''); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }); };
export const showingHtml = (source, savedAt = null) => `<p class="hint mh-showing" data-showing="${esc(source)}">Showing: <b>${esc(SHOWING[source] || SHOWING.saved)}</b>${source === 'saved' && savedWhen(savedAt) ? ` · last saved ${esc(savedWhen(savedAt))}` : ''}</p>`;
// The care tag for a pre-filled stage: "Guessed: “deposit”" (the text the rule matched) or "Pre-filled" (preset).
export const careTag = s => (s.source === 'guess' ? `Guessed: “${s.word || ''}”` : s.source === 'preset' ? 'Pre-filled' : s.source === 'saved' ? 'Saved' : '');
// Remembers open / closed when the reader toggles it.
export function wireHow(root) { root?.querySelectorAll?.('details[data-mh]').forEach(d => d.addEventListener('toggle', () => rememberHow(d.open))); }
