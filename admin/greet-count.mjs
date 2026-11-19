// The greeting's "scorecards need attention" (v1.29.1, shell v2.4.1): the firm list's "Needs attention" filter as ONE
// function that the list (index.html) and the greeting both use, so the greeting's number always equals the filter.
// readCount() is what the other two tools' greetings call (lfmp-session.js readOtherCount): the same read-only GitHub
// reads this page makes for the list and the bell (firms/index.json, each firm's config.json and data/kpis.json,
// status/sync-status.json, status/token-keeper.json, the SYNC_CHAIN variable and the last chain/sync runs), through the
// team site's /api/gh, then the same count. No writes, no GHL, no DOM (the caller passes its ghFetch), never on screen.
import { openIssues, chainAlive } from '../scripts/sync-status.mjs';
import { keeperIssues, reviewIssues } from '../scripts/keeper-status.mjs';
import { firmReasons } from './firm-details.mjs';

export const TESTS_KEY = 'leadpro-admin-tests';   // Me → "Show test clients" (per browser), as the list
const R = '/repos/peejayedz/leadpro-kpi', BRANCH = 'main';

export const isTestFirm = f => /(^|[-\s])test\b|^zz[-\s]/i.test(f.slug) || /\btest\b|^zz\b/i.test(f.name || '');
// Needs attention (v1.13): any reason from firm-details.mjs (most urgent first). kpiFull: slug → kpis.json; issues: the bell's.
export const reasonsOf = (f, kpiFull = {}, issues = []) => firmReasons(f.slug, kpiFull[f.slug], issues, { status: f.status || null });
export const needsAttention = (f, kpiFull, issues) => reasonsOf(f, kpiFull, issues).length > 0;
// The firms shown (test firms left out unless "Show test clients" is on) that need attention.
export const attentionCount = (firms, { showTests = false, kpiFull = {}, issues = [] } = {}) =>
  (firms || []).filter(f => showTests || !isTestFirm(f)).filter(f => needsAttention(f, kpiFull, issues)).length;
// The bell's issues, most firm-wide first then newest (index.html refreshIssues).
export function buildIssues({ keeperStatus, syncStatus, chain = {}, firms = [], configs = {}, kpis = {}, now = Date.now() }) {
  const rank = i => (i.slug ? 1 : 0);
  return [...keeperIssues(keeperStatus, { now, firms }), ...reviewIssues(firms, configs), ...openIssues(syncStatus, { now, firms, kpis, chain })]
    .sort((a, b) => rank(a) - rank(b) || Date.parse(b.firstSeen) - Date.parse(a.firstSeen));
}
export const kpiSummary = k => ({ generatedAt: k.generatedAt, leads90: k.periods?.last90?.current?.totalLeads ?? null, sync: k.sync || null,
  notInPipeline30: k.periods?.last30?.current?.notInPipeline ?? null });   // null until the firm's first sync with the contact check
const norm = s => String(s ?? '').trim().toLowerCase();
// The sync chain's state for the bell. gh(method, path, body, { allow404 }) → parsed JSON (null on an allowed 404).
export async function readChain(gh, repo, syncStatus) {
  const out = { value: 'on', source: 'variable', waiting: null, lastLinkAt: null, lastLinkUrl: null };
  try { const v = await gh('GET', `${repo}/actions/variables/SYNC_CHAIN`, null, { allow404: true }); out.value = norm(v?.value) === 'off' ? 'off' : 'on'; }
  catch { out.value = syncStatus?.syncChain?.value === 'off' ? 'off' : 'on'; out.source = 'status'; }   // token can't read variables: use what the last sync saw
  try {
    const [links, syncs] = await Promise.all([gh('GET', `${repo}/actions/workflows/sync-chain.yml/runs?per_page=5`), gh('GET', `${repo}/actions/workflows/sync.yml/runs?per_page=10`)]);
    const L = links.workflow_runs || [], S = syncs.workflow_runs || [], last = L[0];
    out.lastLinkAt = last?.status === 'completed' ? last.updated_at : null; out.lastLinkUrl = last?.html_url || null;
    // a waiting link, a link that just ended, or the last sync still queued / running on GitHub (≤ 2 h): scripts/sync-status.mjs
    out.waiting = chainAlive({ links: L, syncs: S, now: Date.now() });
  } catch { out.waiting = null; }
  return out;
}
// A file's text through the contents API (files over 1 MB come back without content: read the blob). gh as above.
const fromB64 = b => Uint8Array.from(atob(b.replace(/\s/g, '')), c => c.charCodeAt(0));
export async function readText(gh, repo, path, ref = BRANCH) {
  const f = await gh('GET', `${repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`, null, { allow404: true });
  if (!f) return null;
  const b64 = f.content || (await gh('GET', `${repo}/git/blobs/${f.sha}`)).content;
  return new TextDecoder().decode(fromB64(b64));
}

// readCounts (v1.29.2): the list's load + the bell's check, read only, then the count with test firms hidden and shown
// (the team site's /api/greet-counts keeps both; each browser picks by its own "Show test clients").
export const KIND = 'scorecards';
export async function readCounts({ ghFetch } = {}) {
  const gh = async (method, path, body, { allow404 = false } = {}) => {
    const r = await ghFetch(method, path, body);
    if (r.status === 404 && allow404) return null;
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    const t = r.status === 204 ? '' : await r.text();
    return t ? JSON.parse(t) : {};
  };
  const getJSON = async p => { const t = await readText(gh, R, p); return t === null ? null : JSON.parse(t); };
  const firms = (await getJSON('firms/index.json')) || [];
  const configs = {}, kpis = {}, kpiFull = {};
  const [syncStatus, keeperStatus] = await Promise.all([
    getJSON('status/sync-status.json').catch(() => null),
    getJSON('status/token-keeper.json').catch(() => null),
    ...firms.map(async f => {
      try { configs[f.slug] = await getJSON(`firms/${f.slug}/config.json`); } catch { configs[f.slug] = null; }
      try { const k = await getJSON(`firms/${f.slug}/data/kpis.json`); kpis[f.slug] = k ? kpiSummary(k) : null; kpiFull[f.slug] = k; } catch { kpis[f.slug] = null; kpiFull[f.slug] = null; }
    }),
  ]);
  const chain = await readChain(gh, R, syncStatus);
  const issues = buildIssues({ keeperStatus, syncStatus, chain, firms, configs, kpis, now: Date.now() });
  return { hidden: attentionCount(firms, { showTests: false, kpiFull, issues }), shown: attentionCount(firms, { showTests: true, kpiFull, issues }) };
}
export async function readCount({ ghFetch, store = globalThis.localStorage } = {}) {
  const c = await readCounts({ ghFetch });
  let showTests = false; try { showTests = store?.getItem(TESTS_KEY) === '1'; } catch {}
  return { scorecards: showTests ? c.shown : c.hidden };
}
