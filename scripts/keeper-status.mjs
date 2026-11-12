// Token keeper status: status/token-keeper.json (written by scripts/token-keeper.mjs after every run)
// and the admin bell's keeper issues. No Node or browser APIs, so both can import it.
//
// PRIVACY: the file is public. It holds only firm slugs, timestamps, counts, GitHub run links and
// short codes from the fixed lists below. updateKeeper() copies allow-listed fields only.

export const KEEPER_STALE_MIN = 180;          // no good keeper run for 3 h = an issue
export const REFRESH_BEFORE_H = 6;            // refresh the agency token when under 6 h are left

// Run-level problems. 'reconnect' needs PJ (re-open the install link + connect script).
export const KEEPER_PROBLEMS = {
  reconnect: ['refresh-rejected', 'save-failed', 'missing-secrets'],
  ghl: ['server', 'network', 'list-failed'],
  github: ['access-save-failed', 'no-secrets-token'],
  unknown: ['crash'],
};
// Firm-level problems.
export const FIRM_PROBLEMS = ['app-missing', 'mint-failed', 'save-failed'];

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RUN_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+(\/job\/\d+)?$/;
const isoOr = v => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);
const intOr = (v, d = null) => (Number.isInteger(v) && v >= 0 && v < 1e6 ? v : d);
const runOr = v => (typeof v === 'string' && RUN_RE.test(v) ? v : null);
const cleanProblem = p => {
  if (!p || !Object.hasOwn(KEEPER_PROBLEMS, p.category)) return null;
  return { category: p.category, detail: KEEPER_PROBLEMS[p.category].includes(p.detail) ? p.detail : KEEPER_PROBLEMS[p.category][0] };
};

export const emptyKeeper = () => ({ version: 1, updatedAt: null, lastRunAt: null, lastOkAt: null, lastRunUrl: null, lastRefreshAt: null, agencyExpiresAt: null, appInstalls: null, installToFutureLocations: null, problem: null, firms: {} });

// run: { at, ok, runUrl, refreshedAt, agencyExpiresAt, appInstalls, installToFutureLocations, problem: {category, detail} | null,
//        firms: { slug: { ok, problem } } }   (firms = the ones this run handled)
export function updateKeeper(prev, run) {
  const k = prev && prev.version === 1 ? JSON.parse(JSON.stringify(prev)) : emptyKeeper();
  const at = isoOr(run.at) || new Date().toISOString();
  const problem = cleanProblem(run.problem);
  k.updatedAt = at; k.lastRunAt = at; k.lastRunUrl = runOr(run.runUrl) || k.lastRunUrl;
  if (run.ok && !problem) k.lastOkAt = at;
  if (isoOr(run.refreshedAt)) k.lastRefreshAt = run.refreshedAt;
  if (isoOr(run.agencyExpiresAt)) k.agencyExpiresAt = run.agencyExpiresAt;
  if (intOr(run.appInstalls) !== null) k.appInstalls = run.appInstalls;
  if (typeof run.installToFutureLocations === 'boolean') k.installToFutureLocations = run.installToFutureLocations;
  k.problem = problem ? { ...problem, since: k.problem?.category === problem.category && k.problem?.detail === problem.detail ? k.problem.since : at } : null;
  for (const [slug, f] of Object.entries(run.firms || {})) {
    if (!SLUG_RE.test(slug)) continue;
    const old = k.firms[slug] || {};
    const p = FIRM_PROBLEMS.includes(f?.problem) ? f.problem : (f?.ok ? null : 'mint-failed');
    k.firms[slug] = {
      lastMintAt: f?.ok ? at : isoOr(old.lastMintAt),
      problem: p, since: p ? (old.problem === p ? isoOr(old.since) || at : at) : null,
    };
  }
  return k;
}

// Bell issues from the keeper. firms: firms/index.json entries; only tokenSource "app" firms get firm issues.
// A keeper problem only counts once at least one firm uses the app token (before that it's set-up noise).
export function keeperIssues(keeper, { now, firms = [] }) {
  const appFirms = firms.filter(f => f.tokenSource === 'app');
  if (!appFirms.length) return [];
  const out = [], nowIso = new Date(now).toISOString();
  const k = keeper && keeper.version === 1 ? keeper : null;
  if (!k || !k.lastRunAt) {
    out.push({ id: 'system:keeper-stale', slug: null, kind: 'keeper-stale', firstSeen: nowIso, lastSeen: nowIso, count: 0, lastGood: null, runUrl: null });
    return out;
  }
  if (k.problem?.category === 'reconnect') out.push({ id: 'system:keeper-reconnect', slug: null, kind: 'keeper-reconnect', detail: k.problem.detail, firstSeen: k.problem.since || k.lastRunAt, lastSeen: k.lastRunAt, count: 0, runUrl: k.lastRunUrl });
  else if (k.problem) out.push({ id: 'system:keeper-failed', slug: null, kind: 'keeper-failed', category: k.problem.category, detail: k.problem.detail, firstSeen: k.problem.since || k.lastRunAt, lastSeen: k.lastRunAt, count: 0, runUrl: k.lastRunUrl });
  const lastOk = Date.parse(k.lastOkAt || '') || null;
  if (!lastOk || now - lastOk > KEEPER_STALE_MIN * 60e3) out.push({ id: 'system:keeper-stale', slug: null, kind: 'keeper-stale', firstSeen: lastOk ? new Date(lastOk + KEEPER_STALE_MIN * 60e3).toISOString() : k.lastRunAt, lastSeen: nowIso, count: 0, lastGood: k.lastOkAt || null, runUrl: k.lastRunUrl });
  for (const f of appFirms) {
    const s = k.firms?.[f.slug];
    if (s?.problem === 'app-missing') out.push({ id: `${f.slug}:app-missing`, slug: f.slug, kind: 'app-missing', firstSeen: s.since || k.lastRunAt, lastSeen: k.lastRunAt, count: 0, runUrl: k.lastRunUrl });
    else if (s?.problem) out.push({ id: `${f.slug}:app-token`, slug: f.slug, kind: 'app-token', detail: s.problem, firstSeen: s.since || k.lastRunAt, lastSeen: k.lastRunAt, count: 0, lastGood: s.lastMintAt || null, runUrl: k.lastRunUrl });
  }
  return out;
}

// "Review mapping": firms set up from the builder whose stage mapping was auto-guessed (no preset for the
// snapshot, or preset stages missing). configs: { slug: config.json }. Cleared by saving Edit mapping.
export function reviewIssues(firms, configs = {}) {
  return firms.filter(f => configs[f.slug]?.mappingReview).map(f => {
    const r = configs[f.slug].mappingReview, at = isoOr(r.at) || new Date(0).toISOString();
    return { id: `${f.slug}:mapping-review`, slug: f.slug, kind: 'mapping-review', detail: r.reason === 'unknown-snapshot' ? 'unknown-snapshot' : 'missing-stages', firstSeen: at, lastSeen: at, count: 0, runUrl: null };
  });
}

// Short label for the admin firm list.
export const tokenLabel = f => (f?.tokenSource === 'app' ? 'App' : 'Private Integration');
