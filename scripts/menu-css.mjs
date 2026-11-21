// v1.30.0: the agency Custom CSS rule that puts a firm's "KPI Dashboard" menu link at order -92 (PJ's SOP).
// Pure functions, no GHL calls: used by the sync scripts (Node), the KPI admin Setup tab and the Builder's KPI tab
// (browser, copied to the team site by the Builder's assemble.mjs). The link id is not secret (it is GHL's id for the
// sidebar item); the link's URL (which holds the passphrase) never comes here.
//
//   /* KPI Dashboard · <Client name> */
//   #<id> { order: -92 !important; }
//
// CSS ids can't start with a digit: a leading digit d is written as the escape "\3d " (e.g. 86cac337-… → #\38 6cac337-…).
// A leading letter is used as it is.

export const MENU_ORDER = -92;
export const MENU_CSS_WHERE = 'Paste into Agency → Settings → Company → White Label → Custom CSS, then Save.';
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{5,63}$/;

export const validMenuId = id => typeof id === 'string' && ID_RE.test(id);

export function cssMenuId(id) {
  if (!validMenuId(id)) throw new Error('Not a GHL menu link id.');
  return /^[0-9]/.test(id) ? `\\3${id[0]} ${id.slice(1)}` : id;
}

// One line of the comment: no "*/" (it would end the comment early) and no line breaks.
const cleanName = name => String(name || '').replace(/\*\//g, '* /').replace(/[\r\n]+/g, ' ').trim() || 'this firm';

export function menuCssRule({ id, name, order = MENU_ORDER, label = 'KPI Dashboard' }) {
  if (!validOrder(order)) throw new Error('The menu position must be a whole number from -999 to 999.');
  return `/* ${cleanName(label)} · ${cleanName(name)} */\n#${cssMenuId(id)} { order: ${order} !important; }`;
}

// ---------------------------------------------------------------- v1.36.0 (queue item 3): "Menu position in GHL"
// GHL has no official API for the agency Custom CSS or a menu link's position (REPORT 3.0), so the Builder / KPI admin
// generate the lines, PJ pastes them, and "I've pasted it" records who / when (GHL serves the CSS only after a login, so
// nothing can check it by itself). Stored with the firm: config.menuLink = { id, order?, cssPasted?: { order, by, at } }.
export const REPORTS_ORDER = -91;   // LeadPro Reports (v1.37.0): the "Reports" link, right under KPI Dashboard
export const ORDER_MIN = -999, ORDER_MAX = 999;
export const validOrder = n => Number.isInteger(n) && n >= ORDER_MIN && n <= ORDER_MAX;
// "-92" / " -92 " / "+5" → number; anything else (decimals, words, out of range) → null
export function parseOrder(text) {
  const t = String(text ?? '').trim();
  if (!/^[-+]?\d{1,3}$/.test(t)) return null;
  const n = Number(t);
  return validOrder(n) ? n : null;
}
export const GHL_CUSTOM_CSS_URL = 'https://app.lawfirmmarketingpros.com/settings/company?tab=whitelabel';   // agency → Settings → Company → White Label (Custom CSS is lower on that tab)
// The agency Custom CSS order scheme as read on 21 Nov 2026 (it can't be read from GHL without a login). Shown as a preview.
export const MENU_SCHEME_AS_OF = '21 Nov';
export const MENU_SCHEME = [['Dashboard', -100], ['Contacts', -99], ['Opportunities', -98], ['LeadPro Training', -96]];
export const MENU_REST = ['Launchpad and the rest', 50];
// Rules PJ pasted by hand before this existed (read in the agency Custom CSS on 21 Nov 2026): in GHL already.
export const HAND_PASTED = {
  'b7cc0202-2178-4fae-b69e-c8713df0f793': { order: -92, firm: 'Dumas & Sanclemente' },
  '93865fae-fd84-453b-b263-147080863a5f': { order: -91, firm: 'Boca Dental' },
};
export const SAME_NUMBER_LINE = 'Lower = higher in the menu. The same number can be used for every client: each line only moves that client\'s own link in their own sub-account.';
export const PASTE_STEPS = [
  'Paste it on a new line at the end of the Custom CSS box (don\'t replace what\'s there).',
  'Click Save in GHL and wait for "saved".',
  'Come back and press I\'ve pasted it.',
];
// The firm's menu position: { id, order, pasted, hand, needsPaste, replaces }. needsPaste = there is a link id and GHL
// doesn't have a line for the current number yet (never pasted, or pasted with another number: then `replaces` = the old one).
// v1.37.0 (LeadPro Reports): { defaultOrder } for a link that isn't KPI Dashboard (Reports: REPORTS_ORDER -91).
export function menuState(cfg, { defaultOrder = MENU_ORDER } = {}) {
  const ml = cfg?.menuLink || {}, id = validMenuId(ml.id) ? ml.id : null, hand = id ? HAND_PASTED[id] || null : null;
  const pasted = ml.cssPasted && validOrder(ml.cssPasted.order) ? { order: ml.cssPasted.order, by: String(ml.cssPasted.by || ''), at: String(ml.cssPasted.at || '') }
    : hand ? { order: hand.order, by: 'PJ, by hand', at: '2026-11-21', hand: true } : null;
  const order = validOrder(ml.order) ? ml.order : pasted ? pasted.order : defaultOrder;
  return { id, order, pasted, hand: !!hand, needsPaste: !!id && (!pasted || pasted.order !== order), replaces: pasted && pasted.order !== order ? pasted.order : null };
}
// Config edits (a copy; nothing else in the config changes)
export function withMenuOrder(cfg, order) {
  if (!validOrder(order)) throw new Error('The menu position must be a whole number from -999 to 999.');
  return { ...cfg, menuLink: { ...(cfg?.menuLink || {}), order } };
}
export function withPasted(cfg, { by, at = new Date().toISOString(), defaultOrder = MENU_ORDER }) {
  const s = menuState(cfg, { defaultOrder });
  if (!s.id) throw new Error('There is no menu link id yet.');
  return { ...cfg, menuLink: { ...(cfg.menuLink || {}), order: s.order, cssPasted: { order: s.order, by: String(by || '').slice(0, 60), at } } };
}
// The menu as it will read: the fixed scheme + this link, by number (ties keep the scheme first), then the rest.
export function menuPreview(order, label = 'KPI Dashboard') {
  const rows = MENU_SCHEME.map(([l, n]) => ({ label: l, order: n }));
  if (validOrder(order)) rows.push({ label, order, mine: true });
  rows.sort((a, b) => a.order - b.order || (a.mine ? 1 : 0) - (b.mine ? 1 : 0));
  return [...rows, { label: MENU_REST[0], order: MENU_REST[1], rest: true }];
}
// The plain-words status line under the box.
export function pastedLine(s) {
  if (!s.id) return '';
  if (!s.pasted) return 'Not in GHL yet: paste the lines below.';
  const when = /^\d{4}-\d{2}-\d{2}/.test(s.pasted.at) ? new Date(s.pasted.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  if (s.replaces != null) return `GHL has the line for ${s.replaces}. Replace it with the new line below (delete the old ${s.replaces} line).`;
  return s.pasted.hand ? `In GHL at ${s.pasted.order} (pasted by hand; seen in GHL's Custom CSS on ${MENU_SCHEME_AS_OF}).` : `Pasted at ${s.pasted.order} by ${s.pasted.by}${when ? ` · ${when}` : ''}.`;
}
