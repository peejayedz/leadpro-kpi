// Sync status: what went wrong, where, and what to do about it.
// Shared by the sync workflow (scripts/update-status.mjs writes status/sync-status.json after
// every sync run) and the admin page (reads that file and shows the notification bell).
// No Node or browser APIs here, so both can import it.
//
// PRIVACY: status/sync-status.json is public (the repo and its Pages site are public). It holds
// only firm slugs, statuses, issue categories from the fixed lists below, GHL scope names,
// timestamps, counts and GitHub run links. cleanResult() and updateStatus() copy allow-listed
// fields only, so nothing else a sync script prints or returns can reach the file.

export const STALE_MIN = 45;                       // no successful sync for this long = an issue
export const SLOT_MIN = 30;                        // syncs run every 30 minutes
export const RESOLVED_KEEP = 50;                   // resolved issues kept in the file (the page shows 20)

// Failure categories. detail and area are short codes from fixed lists, never free text.
export const CATEGORIES = {
  token: 'GHL token rejected or expired',
  scope: 'Token missing a scope',
  ghl: 'GHL server or network error',
  config: 'Firm config error',
  unknown: 'Unknown error',
};
const DETAILS = {
  token: ['rejected', 'missing-secret'],
  scope: ['missing'],
  ghl: ['server', 'rate-limit', 'network', 'bad-response', 'request-refused'],
  config: ['no-config', 'bad-config', 'no-location', 'bad-slug', 'secret-key-mismatch'],
  unknown: ['crash', 'no-result'],
};
export const AREAS = ['opportunities', 'contacts', 'users', 'locations', 'custom fields', 'calendars', 'calendar events', 'conversations', 'messages'];
export const SCOPE_NAMES = {
  'opportunities.readonly': 'View Opportunities', 'contacts.readonly': 'View Contacts', 'users.readonly': 'View Users',
  'locations.readonly': 'View Locations', 'locations/customFields.readonly': 'View Custom Fields', 'calendars.readonly': 'View Calendars',
  'calendars/events.readonly': 'View Calendar Events', 'conversations.readonly': 'View Conversations', 'conversations/message.readonly': 'View Conversation Messages',
};
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RUN_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+(\/job\/\d+)?$/;
const REASON_RE = /^[A-Za-z_ ]{1,24} \d{1,6} → \d{1,6}(, [A-Za-z_ ]{1,24} \d{1,6} → \d{1,6}){0,7}$/;   // "Call 63 → 16, SMS 9 → 2"

// Which area of GHL a path belongs to (for "while reading calendars").
export function areaForPath(path) {
  const p = String(path || '').split('?')[0];
  if (p.startsWith('/opportunities')) return 'opportunities';
  if (p.startsWith('/contacts')) return 'contacts';
  if (p.startsWith('/users')) return 'users';
  if (/^\/locations\/[^/]+\/customFields/.test(p)) return 'custom fields';
  if (p.startsWith('/locations')) return 'locations';
  if (p.startsWith('/calendars/events')) return 'calendar events';
  if (p.startsWith('/calendars')) return 'calendars';
  if (p.startsWith('/conversations/messages')) return 'messages';
  if (p.startsWith('/conversations')) return 'conversations';
  return null;
}

// ---------- sanitising ----------
const isoOr = v => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v) ? v : null);
const intOr = (v, d = 0) => (Number.isInteger(v) && v >= 0 && v < 1e7 ? v : d);
const runOr = v => (typeof v === 'string' && RUN_RE.test(v) ? v : null);
// A sync result file (written by sync.mjs) reduced to the allowed fields and values.
export function cleanResult(raw, slug) {
  if (!raw || typeof raw !== 'object' || raw.slug !== slug) return null;
  if (raw.ok === true) return { slug, ok: true, at: isoOr(raw.at) };
  const category = Object.hasOwn(CATEGORIES, raw.category) ? raw.category : 'unknown';
  const detail = DETAILS[category].includes(raw.detail) ? raw.detail : DETAILS[category][0];
  const out = { slug, ok: false, at: isoOr(raw.at), category, detail };
  if (AREAS.includes(raw.area)) out.area = raw.area;
  if (category === 'scope') out.scopes = [...new Set((Array.isArray(raw.scopes) ? raw.scopes : []).filter(s => Object.hasOwn(SCOPE_NAMES, s)))];
  if (category === 'scope' && !out.scopes.length) { out.category = 'unknown'; out.detail = 'crash'; delete out.scopes; }
  return out;
}

// ---------- the status file ----------
export const emptyStatus = () => ({ version: 1, updatedAt: null, lastRun: null, syncChain: { value: 'on', offSince: null }, lastAnySuccessAt: null, firms: {}, open: [], resolved: [] });

// Builds the next status file after a sync run.
//   prev        the previous status (or null)
//   attempted   slugs this run tried to sync (the matrix), plus planProblems' slugs
//   results     { slug: raw result | null }   null = the job left no result (crashed / cancelled)
//   syncFlags   { slug: kpis.json "sync" block }   for firms that synced (held / incomplete)
//   planProblems [{ slug, detail }]           firms the plan step skipped (config errors)
//   syncChain   'on' | 'off'                   the SYNC_CHAIN variable as this run saw it
export function updateStatus(prev, { now, runUrl, event, chained, attempted = [], results = {}, syncFlags = {}, planProblems = [], syncChain = 'on' }) {
  const at = new Date(now).toISOString();
  const s = prev && prev.version === 1 ? JSON.parse(JSON.stringify(prev)) : emptyStatus();
  const run = runOr(runUrl);
  const resolve = (issue, extra = {}) => s.resolved.unshift({ ...issue, ...extra, resolvedAt: at, resolvedRunUrl: run });
  const staleAfter = iso => new Date(Date.parse(iso) + STALE_MIN * 60e3).toISOString();
  const hadAnySuccess = s.lastAnySuccessAt;
  let anySuccess = false;

  const problems = new Map(planProblems.filter(p => SLUG_RE.test(p?.slug || '')).map(p => [p.slug, cleanResult({ slug: p.slug, ok: false, category: 'config', detail: p.detail }, p.slug)]));
  const slugs = [...new Set([...attempted, ...problems.keys()])].filter(x => SLUG_RE.test(x));
  for (const slug of slugs) {
    const res = problems.get(slug) || cleanResult(results[slug], slug) || { slug, ok: false, category: 'unknown', detail: 'no-result' };
    const f = s.firms[slug] || { status: 'ok', lastAttemptAt: null, lastSuccessAt: null, lastRunUrl: null, failStreak: 0 };
    const current = [];   // issues this run says the firm has
    if (!res.ok) {
      current.push({ kind: 'failed', category: res.category, detail: res.detail, ...(res.area ? { area: res.area } : {}), ...(res.scopes ? { scopes: res.scopes } : {}) });
    } else {
      const flags = syncFlags[slug] || {};
      if (intOr(flags.holds) > 0) current.push({ kind: 'held', count: intOr(flags.holds), since: isoOr(flags.heldSince), reason: REASON_RE.test(flags.reason || '') ? flags.reason : null });
      else if (flags.incomplete) current.push({ kind: 'incomplete', since: isoOr(flags.incompleteSince), reason: REASON_RE.test(flags.reason || '') ? flags.reason : null });
    }
    const mine = s.open.filter(i => i.slug === slug);
    s.open = s.open.filter(i => i.slug !== slug);
    for (const c of current) {
      const id = `${slug}:${c.kind}`, old = mine.find(i => i.id === id);
      const { since, ...fields } = c;
      s.open.push({
        id, slug, ...fields,
        firstSeen: old?.firstSeen || since || at, lastSeen: at,
        count: c.kind === 'held' ? c.count : (old?.count || 0) + 1,
        runUrl: run || old?.runUrl || null,
      });
    }
    for (const old of mine) if (!current.some(c => `${slug}:${c.kind}` === old.id)) resolve(old);
    if (res.ok) {
      // It had gone 45+ minutes without a good sync: record that it's over.
      if (f.lastSuccessAt && now - Date.parse(f.lastSuccessAt) > STALE_MIN * 60e3 && !mine.some(i => i.kind === 'failed'))
        resolve({ id: `${slug}:stale`, slug, kind: 'stale', firstSeen: staleAfter(f.lastSuccessAt), lastSeen: at, count: Math.floor((now - Date.parse(f.lastSuccessAt)) / (SLOT_MIN * 60e3)), runUrl: null });
      f.lastSuccessAt = at; f.failStreak = 0; anySuccess = true;
    } else f.failStreak = intOr(f.failStreak) + 1;
    f.status = !res.ok ? 'failed' : current.some(c => c.kind === 'held') ? 'held' : 'ok';
    f.lastAttemptAt = at; f.lastRunUrl = run || f.lastRunUrl || null;
    s.firms[slug] = { status: f.status, lastAttemptAt: f.lastAttemptAt, lastSuccessAt: isoOr(f.lastSuccessAt), lastRunUrl: runOr(f.lastRunUrl), failStreak: intOr(f.failStreak) };
  }

  // System-wide: the chain switch, and gaps with no sync at all.
  const chainOff = String(syncChain || '').trim().toLowerCase() === 'off';
  if (chainOff && s.syncChain.value !== 'off') s.syncChain = { value: 'off', offSince: at };
  else if (!chainOff && s.syncChain.value === 'off') { resolve({ id: 'system:chain-off', slug: null, kind: 'chain-off', firstSeen: s.syncChain.offSince, lastSeen: at, count: 0, runUrl: null }); s.syncChain = { value: 'on', offSince: null }; }
  if (anySuccess) {
    if (hadAnySuccess && now - Date.parse(hadAnySuccess) > STALE_MIN * 60e3)
      resolve({ id: 'system:no-sync', slug: null, kind: 'no-sync', firstSeen: staleAfter(hadAnySuccess), lastSeen: at, count: Math.floor((now - Date.parse(hadAnySuccess)) / (SLOT_MIN * 60e3)), runUrl: null });
    s.lastAnySuccessAt = at;
  }
  s.resolved = s.resolved.slice(0, RESOLVED_KEEP);
  s.updatedAt = at;
  s.lastRun = { at, url: run, event: ['schedule', 'workflow_dispatch'].includes(event) ? event : null, chained: !!chained };
  return s;
}

// ---------- open issues, as the admin page shows them ----------
// status: the file (or null); firms: firms/index.json; kpis: { slug: kpis.json summary { generatedAt, sync } };
// chain: { value: 'on'|'off', waiting: true|false|null (null = unknown), lastLinkAt, lastLinkUrl }
export function openIssues(status, { now, firms = [], kpis = {}, chain = {} }) {
  const st = status && status.version === 1 ? status : emptyStatus();
  const known = new Set(firms.map(f => f.slug));
  const out = st.open.filter(i => known.has(i.slug)).map(i => ({ ...i }));
  const has = (slug, kind) => out.some(i => i.slug === slug && i.kind === kind);
  const lastGood = {};
  for (const f of firms) {
    const k = kpis[f.slug], fs = st.firms[f.slug];
    // Firms the status file hasn't seen yet (or older data): fall back to the published kpis.json.
    if (k?.sync?.holds > 0 && !has(f.slug, 'held') && !has(f.slug, 'failed')) out.push({ id: `${f.slug}:held`, slug: f.slug, kind: 'held', count: k.sync.holds, firstSeen: k.sync.heldSince || k.sync.checkedAt, lastSeen: k.sync.checkedAt, reason: k.sync.reason || null, runUrl: fs?.lastRunUrl || null });
    else if (k?.sync?.incomplete && !k?.sync?.holds && !has(f.slug, 'incomplete') && !has(f.slug, 'failed')) out.push({ id: `${f.slug}:incomplete`, slug: f.slug, kind: 'incomplete', count: 1, firstSeen: k.sync.incompleteSince || k.sync.checkedAt, lastSeen: k.sync.checkedAt, reason: k.sync.reason || null, runUrl: fs?.lastRunUrl || null });
    const times = [fs?.lastSuccessAt, k?.sync?.checkedAt, k?.generatedAt].map(t => Date.parse(t)).filter(Number.isFinite);
    lastGood[f.slug] = times.length ? Math.max(...times) : null;
  }
  const goods = Object.values(lastGood).filter(Number.isFinite);
  const lastAny = Math.max(Date.parse(st.lastAnySuccessAt) || 0, ...(goods.length ? goods : [0]));
  const stale = t => t && now - t > STALE_MIN * 60e3;
  const slots = t => Math.floor((now - t) / (SLOT_MIN * 60e3));
  const isoAt = t => new Date(t).toISOString();
  const nowIso = isoAt(now);

  // System-wide
  if (chain.value === 'off') out.push({ id: 'system:chain-off', slug: null, kind: 'chain-off', firstSeen: st.syncChain?.offSince || nowIso, lastSeen: nowIso, count: 0, runUrl: null, source: chain.source || null });
  else if (chain.waiting === false) out.push({ id: 'system:no-link', slug: null, kind: 'no-link', firstSeen: chain.lastLinkAt || nowIso, lastSeen: nowIso, count: 0, runUrl: chain.lastLinkUrl || null });
  const noSync = firms.length && lastAny && stale(lastAny);
  if (noSync) out.push({ id: 'system:no-sync', slug: null, kind: 'no-sync', firstSeen: isoAt(lastAny + STALE_MIN * 60e3), lastSeen: nowIso, count: slots(lastAny), lastGood: isoAt(lastAny), runUrl: st.lastRun?.url || null });
  // Per firm: no good sync in 45 minutes (unless it's already listed as failing, or nothing synced at all)
  if (!noSync) for (const f of firms) {
    const t = lastGood[f.slug];
    if (t && stale(t) && !has(f.slug, 'failed')) out.push({ id: `${f.slug}:stale`, slug: f.slug, kind: 'stale', firstSeen: isoAt(t + STALE_MIN * 60e3), lastSeen: nowIso, count: slots(t), lastGood: isoAt(t), runUrl: st.firms[f.slug]?.lastRunUrl || null });
  }
  const rank = i => (i.slug ? 1 : 0);   // system issues first, then newest first
  return out.sort((a, b) => rank(a) - rank(b) || Date.parse(b.firstSeen) - Date.parse(a.firstSeen));
}

// OK / Held / Failed for a firm's row.
export function firmState(issues, slug) {
  if (issues.some(i => i.slug === slug && i.kind === 'failed')) return 'failed';
  if (issues.some(i => i.slug === slug && i.kind === 'held')) return 'held';
  return 'ok';
}

// Counts in the bell's badge and the tab title? A hold is only a notice (it usually clears on the
// next sync); it counts once it becomes the published "may be incomplete" note.
export const inBadge = i => i.kind !== 'held';

// The key "Mark as seen" remembers: a new occurrence of the same problem shows again.
export const seenKey = i => `${i.id}@${i.firstSeen}`;

// ---------- plain-English text ----------
// Returns { title, what, steps: [html], actions: [codes] }. esc() escapes text for HTML.
// ctx: { firm: { name, locationId }, subAccount, lastGood (ISO), when(iso) -> "2:15 PM, Nov 2", repo }
export function describeIssue(i, ctx = {}) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = ctx.when || (x => x);
  const sub = ctx.subAccount ? `<b>${esc(ctx.subAccount)}</b>` : 'the firm\'s sub-account';
  const key = ctx.secretKey ? `<span class="mono">GHL_TOKEN_${esc(ctx.secretKey)}</span>` : 'the firm\'s token secret';
  const last = ctx.lastGood ? when(ctx.lastGood) : null;
  const keeps = last ? `The dashboard still shows the numbers from ${esc(last)}.` : 'The dashboard keeps its last numbers.';
  const scopeNames = (i.scopes || []).map(s => SCOPE_NAMES[s] || s);
  const list = names => names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0] || '';
  const fixGhl = `Press <b>Fix in GHL</b>. It opens Settings → Private Integrations in ${sub}.`;
  const resyncClears = 'Press <b>Re-sync</b>. This issue clears as soon as a sync succeeds.';
  const area = i.area ? ` while reading ${esc(i.area)}` : '';
  switch (i.kind) {
    case 'failed':
      switch (i.category) {
        case 'token':
          if (i.detail === 'missing-secret') return {
            title: 'GHL token not set',
            what: `The GitHub secret ${key} is empty or missing, so the sync couldn't start. ${keeps}`,
            steps: [fixGhl, 'Open the <b>LeadPro KPI Scorecard</b> integration and copy its token, or create a new one with the 9 read-only scopes.', 'Press <b>Update token</b> and paste it. A sync starts straight away and this issue clears when it succeeds.'],
            actions: ['ghl', 'token', 'run', 'firm'] };
          return {
            title: 'GHL token rejected',
            what: `GoHighLevel refused this firm's token on every check, so the sync stopped. The token was probably deleted, regenerated or revoked in GHL, or it belongs to a different sub-account. ${keeps}`,
            steps: [fixGhl, 'Create a new private integration token called <b>LeadPro KPI Scorecard</b> with the 9 read-only scopes (or regenerate the existing one) and copy it.', 'Press <b>Update token</b> and paste the new token. A sync starts straight away and this issue clears when it succeeds.'],
            actions: ['ghl', 'token', 'resync', 'run', 'firm'] };
        case 'scope':
          return {
            title: `Token missing a scope: ${list(scopeNames)}`,
            what: `GHL refused part of the sync because the token doesn't have <b>${esc(list(scopeNames))}</b>. The sync stopped so the dashboard doesn't publish numbers with gaps. ${keeps}`,
            steps: [fixGhl, `Edit the <b>LeadPro KPI Scorecard</b> integration and tick <b>${esc(list(scopeNames))}</b>. The token stays the same, so nothing needs updating here.`, resyncClears],
            actions: ['ghl', 'resync', 'run', 'firm'] };
        case 'ghl': {
          const how = { server: 'kept returning server errors', 'rate-limit': 'kept rate-limiting the sync', network: "couldn't be reached", 'bad-response': 'sent responses the sync couldn\'t read', 'request-refused': 'refused a request' }[i.detail] || 'kept failing';
          return {
            title: 'GHL server or network error',
            what: `GoHighLevel ${how}${area}, even after 3 retries. The firm's setup is probably fine; this is usually temporary. ${keeps}`,
            steps: ['Nothing to do if the next sync (every 30 minutes) succeeds. This issue clears by itself.', 'If it keeps happening for more than an hour, press <b>Re-sync</b>, then <b>View run on GitHub</b> and read the red step.', 'If every firm shows this, GHL is probably having an outage. Wait and check again later.'],
            actions: ['resync', 'run', 'firm'] };
        }
        case 'config': {
          const what = {
            'no-config': `The firm's settings file <span class="mono">firms/${esc(i.slug)}/config.json</span> is missing.`,
            'bad-config': `The firm's settings file <span class="mono">firms/${esc(i.slug)}/config.json</span> isn't valid JSON.`,
            'no-location': 'The firm\'s settings have no GHL location ID.',
            'bad-slug': 'The firm\'s folder name in <span class="mono">firms/index.json</span> isn\'t valid.',
            'secret-key-mismatch': 'The secret name in <span class="mono">firms/index.json</span> doesn\'t match this firm, so it was skipped (a safety check: a firm can never use another firm\'s token).',
          }[i.detail] || 'The firm\'s settings have a problem.';
          return {
            title: 'Firm config error',
            what: `${what} The sync skipped this firm. ${keeps}`,
            steps: ['Press <b>View run on GitHub</b> and read the warning at the top of the run.', `Fix the file in the repo (<b>Edit mapping</b> rewrites <span class="mono">config.json</span>; the location ID is in <span class="mono">firms/index.json</span>).`, resyncClears],
            actions: ['run', 'resync', 'firm'] };
        }
        default:
          return {
            title: 'Sync failed (unknown error)',
            what: `The sync stopped with an error this page doesn't recognise${i.detail === 'no-result' ? ' (the job ended without reporting back, e.g. it was cancelled or timed out)' : ', probably a bug in the sync script'}. ${keeps}`,
            steps: ['Press <b>View run on GitHub</b> and read the log of the red step.', 'Press <b>Re-sync</b> once to rule out a one-off.', 'If it fails again, send the run link to whoever maintains the scorecards.'],
            actions: ['run', 'resync', 'firm'] };
      }
    case 'held':
      return {
        title: 'Holding previous numbers',
        what: `GHL returned clearly fewer calls or messages than the last sync${i.reason ? ` (${esc(i.reason)})` : ''}, so the dashboard keeps showing the previous numbers. Hold ${i.count} of 3.`,
        steps: ['Nothing to do: the next sync usually brings the full numbers back and this clears by itself.', 'After 3 holds the new numbers publish anyway, and the dashboard shows a "may be incomplete" note.', 'To try again sooner, press <b>Re-sync</b>.'],
        actions: ['resync', 'run', 'firm'] };
    case 'incomplete':
      return {
        title: 'Dashboard shows the "may be incomplete" note',
        what: `Numbers published after 3 holds${i.reason ? ` (${esc(i.reason)})` : ''}, so the dashboard tells the firm that call and message numbers may read low.`,
        steps: ['Nothing to do: the note clears once counts are back near their earlier level, or after 24 hours.', 'To try for a complete pull sooner, press <b>Re-sync</b>.'],
        actions: ['resync', 'run', 'firm'] };
    case 'stale':
      return {
        title: `No successful sync in ${fmtMinutes(ctx.now, i.lastGood)}`,
        what: `This firm's last successful sync was ${esc(when(i.lastGood))}. Syncs should run every 30 minutes.`,
        steps: ['Check the system issues at the top of this list first, if there are any.', 'Press <b>Re-sync</b>.', 'If the Re-sync fails, press <b>View run on GitHub</b> and read the red step.'],
        actions: ['resync', 'run', 'firm'] };
    case 'chain-off':
      return {
        title: 'Sync chain is off (SYNC_CHAIN = off)',
        what: `The repo variable <span class="mono">SYNC_CHAIN</span> is <b>off</b>, so syncs only run when GitHub's backup schedule fires, which it often skips. Dashboards may go hours without updating.${i.source === 'status' ? ' (As recorded by the last sync run.)' : ''}`,
        steps: ['If you didn\'t turn it off on purpose, press <b>Open variables</b> and set <span class="mono">SYNC_CHAIN</span> to <b>on</b> (or run <span class="mono">gh variable set SYNC_CHAIN --body on</span>).', 'Press <b>Restart chain</b>. It waits for the next :07 or :37 and syncs every firm, then keeps going every 30 minutes.'],
        actions: ['variables', 'restart'] };
    case 'no-link':
      return {
        title: 'Sync chain has stopped',
        what: `No link of the sync chain is waiting for the next :07 or :37 slot, and no chained sync is running, so the next sync depends on GitHub's backup schedule, which it often skips.${i.firstSeen ? ` The last link ended ${esc(when(i.firstSeen))}.` : ''}`,
        steps: ['Press <b>Restart chain</b>. It starts a new link that waits for the next slot.', 'If it stops again, press <b>View run on GitHub</b> to see why the last link ended.'],
        actions: ['restart', 'run'] };
    case 'no-sync':
      return {
        title: `No firm has synced in ${fmtMinutes(ctx.now, i.lastGood)}`,
        what: `The last successful sync of any firm was ${esc(when(i.lastGood))}. Syncs should run every 30 minutes, so every dashboard is out of date.`,
        steps: ['Fix any other system issue in this list first (chain off or stopped).', 'Press <b>Sync all firms now</b>.', 'If that fails too, press <b>View run on GitHub</b>. If GitHub Actions is having an outage, wait and try again.'],
        actions: ['sync-all', 'restart', 'run'] };
    default:
      return { title: 'Unknown issue', what: '', steps: [], actions: [] };
  }
}
export function fmtMinutes(now, iso) {
  const m = Math.max(0, Math.round(((now ?? Date.now()) - Date.parse(iso)) / 60e3));
  return m < 120 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} hours` : `${Math.round(m / 1440)} days`;
}
