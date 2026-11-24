// v1.39.0 LeadPro Reports, Phase 2 (queue items 7–9): the ONE place that talks to CallRail (official API v3). Used by the
// nightly pull (scripts/reports-pull.mjs, GitHub Actions) and by the team site's /api/reports/catalog (Builder
// admin-site/lib/reports-catalog.mjs, Cloudflare). Plain fetch only, so it runs in both. READ ONLY: GET requests only.
//
// Auth: header  Authorization: Token token="<CALLRAIL_API_KEY>"  (the agency key; secret name CALLRAIL_API_KEY).
// Endpoints (https://api.callrail.com/v3):
//   GET /a.json                                   the accounts this key can read
//   GET /a/{account}/companies.json               companies (id, name, status)  → the Builder dropdown
//   GET /a/{account}/calls.json                   calls of one company in a date range (paged)
//   GET /a/{account}/form_submissions.json        form submissions of one company in a date range (paged)
//
// LFMP's CallRail is MANY accounts (one per law firm, e.g. "The Mahdavi Law Firm PLLC #600-164-333"; NOTE 7.1). One API key
// belongs to the CallRail user who made it and sees every account that user can switch to. So: /a.json (paged) → each
// account's companies; a firm's report stores BOTH accountId and companyId and every call goes to that firm's account.
//
// Rate limits (about 1,000 requests an hour / 10,000 a day per key): per-day counts BY SOURCE need either one summary call
// per day (400 for a first build) or the paged calls list (250 calls per request: Mahdavi's ~6,000 calls in 400 days ≈ 25
// requests; a nightly update = 1). So the list is used, with only the fields we count, and a 429 is retried after
// Retry-After (or 5 / 10 / 20 s), at most 3 times. `requests` counts every request for the log.
//
// NUMBERS ONLY. The calls list carries caller names / numbers / recordings; those rows are read here, folded into per-day
// counts in memory (dayCalls / dayForms) and dropped at once. Nothing from a row except its date, answered / first-time
// flags and source NAME reaches the caller of this module.

export const CR_BASE = 'https://api.callrail.com/v3';
export const PER_PAGE = 250, MAX_PAGES = 200;

export class CallRailError extends Error {
  constructor(message, { status = 0, kind = 'api' } = {}) { super(message); this.status = status; this.kind = kind; }
}

// CallRail source name → the report's labels (calls by source).
export const SOURCE_LABELS = { gbp: 'Google Business Profile', ads: 'Google Ads', organic: 'Google organic', direct: 'Direct', other: 'Other' };
export function sourceKey(name) {
  const s = String(name || '').toLowerCase();
  if (/business profile|my business|\bgmb\b|\bgbp\b|google maps|google local/.test(s)) return 'gbp';
  if (/google/.test(s) && /\bads?\b|adwords|paid|\bppc\b|\bcpc\b|search ads|lsa|local services/.test(s)) return 'ads';
  if (/google/.test(s) && /organic|seo/.test(s)) return 'organic';
  if (/^direct|direct traffic|\bdirect\b/.test(s)) return 'direct';
  return 'other';
}

// The date (YYYY-MM-DD) of a call in the company's own time zone: CallRail gives start_time with its offset
// ("2026-08-03T09:12:44.000-05:00"), so the first 10 characters are the local date.
const localDay = t => (/^\d{4}-\d{2}-\d{2}/.test(String(t || '')) ? String(t).slice(0, 10) : '');

// client({ key, fetch }) → { accounts(), companies(), calls(...), forms(...) }
export const RETRIES = 3;
const pause = ms => new Promise(r => setTimeout(r, ms));
export function client({ key, fetch: f = globalThis.fetch, base = CR_BASE, sleep = pause } = {}) {
  if (!key) throw new CallRailError('CallRail key not set yet', { kind: 'no_key' });
  const stats = { requests: 0, retries: 0 };
  async function get(path, params = {}) {
    const url = `${base}${path}${Object.keys(params).length ? `?${new URLSearchParams(params)}` : ''}`;
    let r;
    for (let attempt = 0; ; attempt++) {
      stats.requests++;
      try { r = await f(url, { headers: { Authorization: `Token token="${key}"`, Accept: 'application/json' } }); }
      catch (e) { throw new CallRailError(`CallRail didn't answer (${e.message})`, { kind: 'network' }); }
      if (r.status !== 429 || attempt >= RETRIES) break;
      const wait = Number(r.headers?.get?.('Retry-After')) || 5 * 2 ** attempt;
      stats.retries++; await r.text().catch(() => ''); await sleep(Math.min(wait, 120) * 1000);
    }
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch {}
    if (r.status === 401) throw new CallRailError('CallRail refused the key (check CALLRAIL_API_KEY)', { status: 401, kind: 'auth' });
    if (r.status === 403) throw new CallRailError('CallRail says this key has no access to that company', { status: 403, kind: 'no_access' });
    if (r.status === 404) throw new CallRailError('CallRail can\'t find that company any more (removed or moved?)', { status: 404, kind: 'gone' });
    if (r.status === 429) throw new CallRailError('CallRail rate limit: try again later', { status: 429, kind: 'server' });
    if (!r.ok) throw new CallRailError(`CallRail answered ${r.status}`, { status: r.status, kind: r.status >= 500 ? 'server' : 'api' });
    if (!j) throw new CallRailError('CallRail answered something that isn\'t JSON', { status: r.status, kind: 'api' });
    return j;
  }
  // Every page of a list (page / total_pages), handing each page's rows to `each` and keeping nothing.
  async function paged(path, params, listKey, each) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const j = await get(path, { ...params, page: String(page), per_page: String(PER_PAGE) });
      for (const row of j[listKey] || []) each(row);
      const total = Number(j.total_pages || 1);
      if (page >= total) return;
    }
  }
  async function accounts() {
    const out = [];
    await paged('/a.json', {}, 'accounts', a => { const num = String(a.numeric_id ?? '').replace(/\D/g, ''); out.push({ id: String(a.id ?? a.numeric_id ?? ''), name: String(a.name ?? ''), number: num.length === 9 ? `${num.slice(0, 3)}-${num.slice(3, 6)}-${num.slice(6)}` : num }); });
    return out.filter(a => a.id);
  }
  return {
    stats,
    accounts,
    // Every company in every account the key can read (the Builder dropdown: "Account name · Company name").
    async companies() {
      const out = [];
      for (const a of await accounts()) {
        await paged(`/a/${encodeURIComponent(a.id)}/companies.json`, { status: 'active' }, 'companies', c => out.push({ id: String(c.id ?? ''), name: String(c.name ?? ''), accountId: a.id, accountName: a.name, accountNumber: a.number, website: String(c.website ?? c.site ?? (Array.isArray(c.websites) ? c.websites[0] : '') ?? '') }));
      }
      return out.filter(c => c.id).sort((x, y) => x.accountName.localeCompare(y.accountName) || x.name.localeCompare(y.name));
    },
    // Calls per local day for one company: { 'YYYY-MM-DD': { t, a, m, f, s: { gbp, ads, organic, direct, other } } }.
    async calls({ accountId, companyId, from, to }) {
      const days = {};
      await paged(`/a/${encodeURIComponent(accountId)}/calls.json`, { company_id: companyId, start_date: from, end_date: to, fields: 'first_call,source', sort: 'start_time', order: 'asc' }, 'calls', row => {
        const d = localDay(row.start_time); if (!d) return;
        const x = days[d] ||= { t: 0, a: 0, m: 0, f: 0, s: { gbp: 0, ads: 0, organic: 0, direct: 0, other: 0 } };
        x.t++; if (row.answered === true) x.a++; else x.m++;
        if (row.first_call === true) x.f++;
        x.s[sourceKey(row.source_name ?? row.source)]++;
      });
      return days;
    },
    // Form submissions per local day: { 'YYYY-MM-DD': { n, f } } (f = first-time submissions). No form fields are kept.
    async forms({ accountId, companyId, from, to }) {
      const days = {};
      await paged(`/a/${encodeURIComponent(accountId)}/form_submissions.json`, { company_id: companyId, start_date: from, end_date: to, fields: 'first_form' }, 'form_submissions', row => {
        const d = localDay(row.submitted_at ?? row.created_at); if (!d) return;
        const x = days[d] ||= { n: 0, f: 0 };
        x.n++; if (row.first_form === true) x.f++;
      });
      return days;
    },
  };
}
