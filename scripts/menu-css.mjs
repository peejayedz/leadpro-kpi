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

export function menuCssRule({ id, name }) {
  return `/* KPI Dashboard · ${cleanName(name)} */\n#${cssMenuId(id)} { order: ${MENU_ORDER} !important; }`;
}
