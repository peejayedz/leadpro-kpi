// v1.39.0 LeadPro Reports, queue items 7–9: CallRail, Search Console, GA4, Business Profile, Google Ads. Run from
// tests/reports/run.mjs (no dependencies, no network): adapters with and without credentials, request shapes, the JWT,
// the nightly plan / pull / finish with every source, numbers only, encryption, tabs + Draft gating, the bell.
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as CR from '../../scripts/callrail.mjs';
import * as G from '../../scripts/google.mjs';
import * as RC from '../../scripts/reports-core.mjs';
import * as RP from '../../scripts/reports-pull.mjs';
import { decryptJSON } from '../../scripts/kpi-core.mjs';
import * as FX from './fixtures/sources.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

export async function run({ check, throwsKind }) {
  console.log('\n— CallRail · Google · six sources (v1.39.0)');
  const SA = await FX.fakeServiceAccount();
  const sumDays = (days, from, to, f) => RC.dayList(from, to).reduce((a, d) => a + (days[d] ? f(days[d]) : 0), 0);

  // ---------------------------------------------------------------- CallRail adapter
  check(await throwsKind(() => CR.client({ key: '' }), 'no_key'), 'CallRail: no key → "CallRail key not set yet" (kind no_key), nothing is called');
  { const f = FX.fakeApis(); const c = CR.client({ key: 'cr-test-key', fetch: f });
    const cos = await c.companies();
    const mh = cos.find(x => x.id === FX.IDS.mahdavi.crCompany);
    check(cos.length === 4 && new Set(cos.map(x => x.accountId)).size === 3 && mh.accountId === FX.IDS.mahdavi.crAccount && mh.accountName === 'The Mahdavi Law Firm PLLC' && mh.accountNumber === '600-164-333', 'CallRail catalog (NOTE 7.1): /a.json paged → 3 accounts (one per firm) → 4 companies; Mahdavi = "The Mahdavi Law Firm PLLC #600-164-333"');
    check(f.seen.filter(x => x.url.pathname === '/v3/a.json').length === 2 && f.seen.filter(x => x.url.pathname.endsWith('/companies.json')).map(x => x.url.pathname.split('/')[3]).join() === FX.ACCOUNTS.map(a => a[0]).join(), 'every account\'s companies are read with that account\'s id');
    check(f.seen.every(s => s.method === 'GET' && s.url.origin + '/v3' === CR.CR_BASE && s.headers.Authorization === 'Token token="cr-test-key"'), 'CallRail: GET only, official API v3, the agency key as Token header (never in the URL)');
    check(!f.seen.some(s => s.url.search.includes('cr-test-key')), 'CallRail: the key never appears in a URL (logs show URLs)'); }
  check(await throwsKind(() => CR.client({ key: 'bad', fetch: async () => new Response('{}', { status: 401 }) }).companies(), 'auth'), 'CallRail: refused key → kind auth (✗ broken + bell)');
  { const waits = []; const c = CR.client({ key: 'k', fetch: FX.fakeApis({ rateLimitOnce: true }), sleep: async ms => { waits.push(ms); } });
    const a = await c.accounts();
    check(a.length === 3 && waits.join() === '1000' && c.stats.retries === 1 && c.stats.requests === 3, 'rate limit: a 429 waits Retry-After (1 s) and tries again; requests are counted for the log'); }
  { const waits = []; const c = CR.client({ key: 'k', fetch: async () => new Response('{}', { status: 429 }), sleep: async ms => { waits.push(ms); } });
    check(await throwsKind(() => c.accounts(), 'server') && waits.join() === '5000,10000,20000', 'still limited after 3 waits (5 / 10 / 20 s) → kind server (retried next night)'); }
  { const c = CR.client({ key: 'k', fetch: FX.fakeApis() });
    check(await throwsKind(() => c.calls({ accountId: FX.IDS.sample.crAccount, companyId: FX.IDS.mahdavi.crCompany, from: '2026-08-01', to: '2026-08-09' }), 'gone'), 'calls go to the firm\'s own account: a company asked under another account → not found'); }
  check(await throwsKind(() => CR.client({ key: 'k', fetch: FX.fakeApis({ callrailGone: true }) }).calls({ accountId: FX.IDS.mahdavi.crAccount, companyId: FX.IDS.mahdavi.crCompany, from: '2026-08-01', to: '2026-08-09' }), 'gone'), 'CallRail: company gone (404) → kind gone');
  check(CR.sourceKey('Google My Business') === 'gbp' && CR.sourceKey('Google Business Profile') === 'gbp' && CR.sourceKey('Google Ads') === 'ads' && CR.sourceKey('Google Paid') === 'ads' && CR.sourceKey('Google Organic') === 'organic' && CR.sourceKey('Direct') === 'direct' && CR.sourceKey('Bing Organic') === 'other' && CR.sourceKey('') === 'other', 'CallRail source names → Google Business Profile · Google Ads · Google organic · Direct · Other');
  { const rows = []; const c = CR.client({ key: 'k', fetch: FX.fakeApis({ calls: rows, perPage: 25 }) });
    const days = await c.calls({ accountId: FX.IDS.mahdavi.crAccount, companyId: FX.IDS.mahdavi.crCompany, from: '2026-08-03', to: '2026-08-09' });
    const t = Object.values(days).reduce((a, x) => ({ t: a.t + x.t, a: a.a + x.a, m: a.m + x.m, f: a.f + x.f, gbp: a.gbp + x.s.gbp, ads: a.ads + x.s.ads, organic: a.organic + x.s.organic, direct: a.direct + x.s.direct }), { t: 0, a: 0, m: 0, f: 0, gbp: 0, ads: 0, organic: 0, direct: 0 });
    check(t.t === 107 && t.a === 93 && t.m === 14 && t.f === 40 && t.gbp === 69 && t.ads === 18 && t.organic === 8 && t.direct === 5, 'Mahdavi Aug 3–9 (real totals): 107 calls · 93 answered · 14 missed · 40 first-time · GBP 69 · Ads 18 · organic 8 · direct 5', JSON.stringify(t));
    check(rows.length === 107 && rows[0].customer_name === FX.PII.name && !JSON.stringify(days).includes(FX.PII.name) && !JSON.stringify(days).includes('7135550123'), 'call rows (25 per page, 5 pages) carry a name + number; the per-day counts keep neither');
    const forms = await c.forms({ accountId: FX.IDS.mahdavi.crAccount, companyId: FX.IDS.mahdavi.crCompany, from: '2026-08-03', to: '2026-08-09' });
    check(Object.values(forms).reduce((a, x) => a + x.n, 0) === 1 && Object.values(forms).reduce((a, x) => a + x.f, 0) === 0 && !JSON.stringify(forms).includes('@'), '1 form, 0 first-time; no form fields kept'); }

  // ---------------------------------------------------------------- Google: robot (JWT) + OAuth
  check(G.robotEmail(SA.json) === 'leadpro-reports@lfmp-reporting-test.iam.gserviceaccount.com' && G.robotEmail('') === '' && G.robotEmail('{not json') === '', 'robot email read from the key file\'s client_email (not a secret); none when not set');
  { const jwt = await G.signJwt(G.parseSa(SA.json), G.SCOPES.sa, 1_786_000_000);
    const [h, c, sig] = jwt.split('.'), dec = x => JSON.parse(Buffer.from(x, 'base64url').toString());
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', SA.publicKey, Buffer.from(sig, 'base64url'), new TextEncoder().encode(`${h}.${c}`));
    check(ok && dec(h).alg === 'RS256' && dec(c).scope === 'https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/webmasters.readonly' && dec(c).aud === G.TOKEN_URL && dec(c).exp - dec(c).iat === 3600, 'JWT: RS256 with Web Crypto, verifies with the made-up key; scopes analytics.readonly + webmasters.readonly; 1 h'); }
  check(await throwsKind(() => G.saClient({ saJson: '' }), 'no_key'), 'GA4 / Search Console: no GOOGLE_REPORTS_SA_JSON → no_key ("Google not set up yet")');
  { const f = FX.fakeApis(); const sa = G.saClient({ saJson: SA.json, fetch: f });
    const props = await sa.ga4Properties(), sites = await sa.scSites();
    check(props.length === 2 && props[0].id === FX.IDS.mahdavi.ga4 && sites.length === 2 && !sites.some(s => s.siteUrl.includes('nolonger')), 'catalog: GA4 properties (accountSummaries) + Search Console sites the robot can read (unverified ones left out)');
    const tok = f.seen.find(s => s.url.href === G.TOKEN_URL);
    check(tok.body.grant_type === 'urn:ietf:params:oauth:grant-type:jwt-bearer' && f.seen.filter(s => s.url.href === G.TOKEN_URL).length === 1, 'one token per run (JWT bearer), reused for every call'); }
  check(await throwsKind(() => G.oauthClient({}), 'no_key') && await throwsKind(() => G.oauthClient({ clientId: 'a', clientSecret: 'b' }), 'no_signin'), 'Business Profile / Ads: no OAuth client → no_key; no refresh token → no_signin ("Needs sign-in")');
  { const f = FX.fakeApis(); const o = G.oauthClient({ clientId: 'a', clientSecret: 'b', refreshToken: '1//gbp-refresh-test', fetch: f });
    const locs = await o.gbpLocations();
    check(locs.length === 2 && locs[0].name === FX.IDS.mahdavi.gbp && locs[0].title === 'The Mahdavi Law Firm', 'catalog: Business Profile locations (Account Management + Business Information)'); }
  check(await throwsKind(() => G.oauthClient({ clientId: 'a', clientSecret: 'b', refreshToken: 'r', fetch: FX.fakeApis({ gbpNotApproved: true }) }).gbpLocations(), 'not_approved_gbp'), 'Business Profile API not approved yet (quota 0) → not_approved_gbp ("Needs Google OK")');
  { const f = FX.fakeApis(); const o = G.oauthClient({ clientId: 'a', clientSecret: 'b', refreshToken: '1//ads-refresh-test', fetch: f });
    const acc = await o.adsCustomers(FX.IDS.mcc);
    check(acc.length === 2 && acc.some(a => a.id === FX.IDS.sample.ads && a.name === 'Sample Firm A'), 'catalog: Google Ads client accounts under the MCC (customer_client, not managers, enabled)');
    const call = f.seen.find(s => s.url.hostname === 'googleads.googleapis.com');
    const hd = Object.fromEntries(Object.entries(call.headers).map(([k, v]) => [k.toLowerCase(), v]));
    check(call.url.pathname === `/${G.ADS_API_VERSION}/customers/${FX.IDS.mcc}/googleAds:searchStream` && G.ADS_API_VERSION === 'v26' && hd['login-customer-id'] === FX.IDS.mcc && !('developer-token' in hd) && /^Bearer ya29\./.test(hd.authorization), 'Ads request: v26 searchStream, login-customer-id = the MCC, NO developer-token header');
    check(/customer_client\.manager = false AND customer_client\.status = 'ENABLED'/.test(call.body.query), 'Ads catalog query: the GAQL from the item'); }
  check(await throwsKind(() => G.oauthClient({ clientId: 'a', clientSecret: 'b', refreshToken: 'r', fetch: FX.fakeApis({ adsNotApproved: true }) }).adsCustomers(FX.IDS.mcc), 'not_approved'), 'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION → not_approved ("Needs Basic access")');
  check(await throwsKind(() => G.oauthClient({ clientId: 'a', clientSecret: 'b', refreshToken: 'r' }).adsCustomers(''), 'no_key'), 'no GOOGLE_ADS_MCC_ID → no_key');
  { let msg = ''; try { await G.oauthClient({ clientId: 'a', clientSecret: 'b', refreshToken: 'r', fetch: FX.fakeApis() }).ads({ customerId: FX.IDS.lost.ads, mccId: FX.IDS.mcc, from: '2026-08-01', to: '2026-08-09' }); } catch (e) { msg = `${e.kind}: ${e.message}`; }
    check(/^no_access/.test(msg) && !/ya29|1\/\//.test(msg), 'a lost MCC link → no_access; the error message holds no token', msg); }

  // ---------------------------------------------------------------- config: six sources, tabs, Draft gating
  const m = FX.configs.mahdavi(), s = FX.configs.sample();
  check(JSON.stringify(RC.tabsFor(m)) === JSON.stringify(['Overview', 'Calls', 'Website leads', 'Google Search', 'Website traffic', 'Google Business Profile', 'Rankings']) && JSON.stringify(RC.tabsFor(s)) === JSON.stringify(['Overview', 'Calls', 'Website leads', 'Google Search', 'Website traffic', 'Google Business Profile', 'Ads']), 'tabs only for linked sources (Mahdavi: no Ads; Sample: no Rankings)');
  check(JSON.stringify(RC.tabsFor(RC.withSource(m, 'callrail', { unused: true }))) === JSON.stringify(['Google Search', 'Website traffic', 'Google Business Profile', 'Rankings']), '"Not used by this client" → no Overview / Calls / Website leads');
  let bad = 0; for (const [k, v] of [['callrail', { companyId: 'x' }], ['ga4', { propertyId: 'abc' }], ['searchConsole', { siteUrl: 'mahdavi.com' }], ['gbp', { locationName: 'accounts/1' }], ['googleAds', { customerId: '123' }]]) { try { RC.withSource(m, k, v); } catch { bad++; } }
  check(bad === 5, 'every source id is checked (CallRail company, GA4 property, Search Console site, Business Profile location, 10-digit Ads id)');
  check(RC.withSource(m, 'googleAds', { customerId: '123-456-7890', name: 'X' }).sources.googleAds.customerId === '1234567890' && !('ga4' in RC.withSource(m, 'ga4', null).sources), 'Ads id dashes removed; null unlinks');
  let none = false; try { RC.newConfig({ slug: 'x', sources: {} }); } catch { none = true; }
  check(none && RC.pullable(RC.newConfig({ slug: 'x', sources: { callrail: { companyId: 'COM1234', companyName: 'X' } } })), 'a report needs at least one linked source (BrightLocal no longer required)');
  const live1 = { ...RC.newConfig({ slug: 'x', locationId: '3839215' }), status: 'live' };   // a Phase 1 Live report (no "published" yet)
  const live = RC.withSource(live1, 'callrail', { companyId: 'COM1234', companyName: 'X' });
  check(JSON.stringify(RC.visibleTabs(live)) === '["Rankings"]' && JSON.stringify(RC.draftTabs(live)) === '["Overview","Calls","Website leads"]', 'Live Phase 1 report + CallRail linked: client still sees Rankings only; Overview / Calls / Website leads are Draft');
  check(JSON.stringify(RC.visibleTabs(live, { drafts: true })) === '["Overview","Calls","Website leads","Rankings"]', 'Open report (with drafts) shows them');
  const pub = RC.withPublished(live, { by: 'PJ', at: '2026-11-24T10:00:00Z' });
  check(RC.draftTabs(pub).length === 0 && RC.visibleTabs(pub).length === 4 && pub.publishedBy === 'PJ', 'Publish new tabs → the client sees all 4; no drafts left');
  check(JSON.stringify(RC.visibleTabs({ ...m, status: 'draft' })) === JSON.stringify(RC.tabsFor(m)) && RC.withLive(m, { by: 'PJ' }).published.length === 7, 'a whole-report Draft works as in Phase 1 (every linked tab, Draft banner); going Live publishes what was reviewed');
  check(JSON.stringify(RC.withLive(live, { by: 'x' }).published) === '["Rankings"]' && RC.withLive(live, { by: 'x' }).liveAt === live.liveAt, 'the menu link added again on a Live report publishes nothing new (Draft tabs still need Publish new tabs)');
  check(RC.suggestMatch([{ id: '1', name: 'mahdavilawfirm.com - GA4' }, { id: '2', name: 'Other' }], { name: 'The Mahdavi Law Firm', website: 'https://mahdavilawfirm.com' })?.id === '1' && RC.suggestMatch([{ siteUrl: FX.IDS.mahdavi.sc }], { name: '', website: 'https://www.mahdavilawfirm.com/' }, { idOf: x => x.siteUrl, nameOf: () => '', urlOf: x => x.siteUrl })?.why === 'matched by website (mahdavilawfirm.com)', 'suggested matches by name / website for every dropdown (sc-domain too)');

  // ---------------------------------------------------------------- ranges
  const r7 = RC.rangeFor('7d', FX.THROUGH);
  check(r7.from === '2026-08-03' && r7.prevFrom === '2026-07-27' && RC.rangeLabel(r7) === 'Aug 3 – Aug 9, 2026', 'Last 7 days = Aug 3–9 vs Jul 27 – Aug 2 ("Aug 3 – Aug 9, 2026")');
  check(RC.rangeFor('lastMonth', FX.THROUGH).from === '2026-07-01' && RC.rangeFor('lastMonth', FX.THROUGH).prevTo === '2026-06-30' && RC.rangeFor('month', FX.THROUGH).prevTo === '2026-07-09' && RC.rangeFor('90d', FX.THROUGH).days === 90, 'This month / Last month / Last 90 days and their previous periods');
  check(RC.throughOf('2026-08-10T06:00:00Z') === '2026-08-09' && RC.money(1490) === '$1,490' && RC.money(null) === '–', 'last full day (ET); $1,490; no value → "–"');

  // ---------------------------------------------------------------- the nightly with every source
  const tmp = await mkdtemp(join(tmpdir(), 'reports-src-'));
  try {
    await mkdir(join(tmp, 'firms/mahdavi'), { recursive: true }); await mkdir(join(tmp, 'firms/sample-firm-a'), { recursive: true }); await mkdir(join(tmp, 'firms/lost'), { recursive: true });
    await writeFile(join(tmp, 'firms/index.json'), JSON.stringify([{ slug: 'mahdavi', name: 'The Mahdavi Law Firm', secretKey: 'MAHDAVI' }, { slug: 'sample-firm-a', name: 'Sample Firm A', secretKey: 'SAMPLE_FIRM_A' }, { slug: 'lost', name: 'Lost Access Firm', secretKey: 'LOST' }]));
    await writeFile(join(tmp, RC.configPath('mahdavi')), JSON.stringify(m));
    await writeFile(join(tmp, RC.configPath('sample-firm-a')), JSON.stringify(s));
    await writeFile(join(tmp, RC.configPath('lost')), JSON.stringify(RC.newConfig({ slug: 'lost', sources: { callrail: { companyId: FX.IDS.sample.crCompany, companyName: 'S', accountId: FX.IDS.sample.crAccount }, ga4: { propertyId: FX.IDS.lost.ga4, name: 'gone' }, googleAds: { customerId: FX.IDS.lost.ads, name: 'gone' } } })));
    const logs = []; const log = x => logs.push(x);
    const only = await RP.plan({ root: tmp, has: { callrail: true }, log });
    check(only.length === 3 && logs.some(l => /GA4 not set yet \(GOOGLE_REPORTS_SA_JSON\): skipped/.test(l)) && logs.some(l => /Google Ads not set up yet|Google Ads not set yet \(GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_MCC_ID\)/.test(l)), 'plan: only the sources whose secrets are set; one log line per missing source (names only)', logs.join(' | '));
    logs.length = 0;
    check((await RP.plan({ root: tmp, has: { brightlocal: true }, log })).map(x => x.slug).join() === 'mahdavi', 'plan: a firm runs only if one of its linked sources has its secrets (BrightLocal only → Mahdavi)');
    const env = RP.hasFromEnv({ HAS_KEY: 'false', HAS_CALLRAIL: 'true', HAS_GOOGLE_SA: 'true', HAS_GBP: 'false', HAS_ADS: 'true' });
    check(env.callrail && env.ga4 && env.searchConsole && !env.gbp && env.googleAds && !env.brightlocal, 'workflow flags HAS_CALLRAIL / HAS_GOOGLE_SA / HAS_GBP / HAS_ADS → sources');

    const out = join(tmp, 'out'), creds = FX.allCreds(SA.json), outLogs = [];
    const f1 = FX.fakeApis();
    const r1 = await RP.pull({ root: tmp, slug: 'mahdavi', creds, pass: 'mahdavi pass', fetch: f1, outDir: out, now: FX.NOW, log: x => outLogs.push(x) });
    check(r1.ok && Object.keys(r1.sources).join() === 'brightlocal,callrail,searchConsole,ga4,gbp' && r1.keywords === 88, 'Mahdavi: BrightLocal + CallRail + Search Console + GA4 + Business Profile pulled');
    const file = JSON.parse(await readFile(join(out, 'mahdavi/reports.json'), 'utf8'));
    check(Object.keys(file).join() === 'v,generatedAt,enc' && file.v === 2, 'reports.json: only { v, generatedAt, enc } in the clear');
    const rep = await decryptJSON(file.enc, 'mahdavi pass');
    let wrong = false; try { await decryptJSON(file.enc, 'sample pass'); } catch { wrong = true; }
    check(wrong, 'another firm\'s passphrase can\'t read it');
    check(Object.keys(rep.calls.days).length === RC.KEEP_DAYS && Object.keys(rep.calls.days)[0] === RC.addDays(FX.THROUGH, -399), 'first pull: 400 days by day (so any range and its previous period work)');
    const c7 = RC.callsIn(rep.calls, r7);
    check(c7.t === 107 && c7.prev.t === 83 && c7.f === 40 && c7.a === 93 && c7.m === 14 && c7.forms === 1 && c7.formsFirst === 0 && c7.chg.t === 29, 'Aug 3–9: 107 calls (83 before, ▲ 29%), 40 first-time, 93 / 14, 1 form (0 first-time)');
    check(JSON.stringify(c7.src.map(x => [x[0], x[1]])) === JSON.stringify([['Google Business Profile', 69], ['Google Ads', 18], ['Google organic', 8], ['Direct', 5], ['Other', 7]]), 'sources: GBP 69 · Ads 18 · organic 8 · direct 5 (+ 7 other)');
    const r30 = RC.rangeFor('30d', FX.THROUGH), c30 = RC.callsIn(rep.calls, r30);
    check(c30.t === sumDays(rep.calls.days, r30.from, r30.to, x => x.t) && c30.t > 107, `Last 30 days = the sum of the fixture days (${c30.t})`);
    const se = RC.searchIn(rep.search, r7), tr = RC.trafficIn(rep.traffic, r7), gb = RC.gbpIn(rep.gbp, r7);
    check(se.c === 312 && se.i === 11900 && se.pos === 14.2 && se.chg.c === 6, 'Search Console: clicks 312 (▲ 6%), impressions 11,900, position 14.2');
    check(rep.search.top.length === 25 && rep.search.top.every(q => q.length === 3 && typeof q[0] === 'string' && typeof q[1] === 'number' && typeof q[2] === 'number'), 'top 25 searches: query, clicks, position only');
    check(tr.s === 948 && tr.u === 739 && tr.dur === 102 && tr.chg.s === -3 && tr.leadRate === 3.5 && tr.fromGoogle === 71 && JSON.stringify(tr.channels) === JSON.stringify([['Organic search', 493], ['Google Business Profile', 180], ['Direct', 152], ['Paid search', 85], ['Referral', 38]]), 'GA4: 948 visits (▼ 3%), 739 visitors, 1:42, channels 493 · 180 · 152 · 85 · 38, lead rate 3.5% (key events)');
    check(gb.actions === 186 && gb.calls === 121 && gb.dir === 43 && gb.web === 22 && gb.views === 3534 && gb.vs === 2191 && gb.vm === 1343 && gb.chg.actions === 11, 'Business Profile: 186 actions (121 / 43 / 22, ▲ 11%), 3,534 views (2,191 Search / 1,343 Maps)');
    const all = JSON.stringify(rep) + outLogs.join('\n');
    check(![FX.PII.name, FX.PII.phone, '7135550123', FX.PII.recording, FX.PII.form, 'customer_name'].some(x => all.includes(x)), 'numbers only: no caller name / number / recording / form field in reports.json or the logs');
    check(!/ya29\.|1\/\/gbp-refresh|1\/\/ads-refresh|cr-test-key|PRIVATE KEY/.test(outLogs.join('\n')), 'no key or token in the logs');
    // no key events → the lead tile goes
    const r1b = await RP.pull({ root: tmp, slug: 'mahdavi', creds: { ...creds, callrail: null, brightlocal: null }, pass: 'mahdavi pass', fetch: FX.fakeApis({ gaNoKeyEvents: true }), outDir: join(tmp, 'out-nk'), now: FX.NOW, log: () => {} });
    const nk = await decryptJSON(JSON.parse(await readFile(join(tmp, 'out-nk/mahdavi/reports.json'), 'utf8')).enc, 'mahdavi pass');
    check(r1b.ok && r1b.sources.callrail.skipped === 'no_key' && RC.trafficIn({ ...nk.traffic, hasKeyEvents: false }, r7).leadRate === null, 'GA4 without key events → "Visits that became a lead" hidden; a source without its key is skipped, not broken');
    // the next night: only the new days are read; history stays
    await writeFile(join(tmp, RC.dataPath('mahdavi')), await readFile(join(out, 'mahdavi/reports.json'), 'utf8'));
    const f2 = FX.fakeApis();
    await RP.pull({ root: tmp, slug: 'mahdavi', creds, pass: 'mahdavi pass', fetch: f2, outDir: join(tmp, 'out2'), now: new Date('2026-08-11T06:00:00Z'), log: () => {} });
    const cr2 = f2.seen.find(x => x.url.pathname.endsWith('/calls.json'));
    const rep2 = await decryptJSON(JSON.parse(await readFile(join(tmp, 'out2/mahdavi/reports.json'), 'utf8')).enc, 'mahdavi pass');
    check(cr2.url.searchParams.get('start_date') === RC.addDays('2026-08-09', -RC.REPULL_DAYS) && cr2.url.searchParams.get('end_date') === '2026-08-10', `next night: reads only ${RC.addDays('2026-08-09', -RC.REPULL_DAYS)} → Aug 10 (the last ${RC.REPULL_DAYS} days again + the new day)`);
    check(RC.callsIn(rep2.calls, r7).t === 107 && rep2.calls.days['2026-08-10'] && Object.keys(rep2.calls.days).length === RC.KEEP_DAYS, 'history stays (Aug 3–9 still 107), the new day is added, still 400 days');
    // Sample Firm A: Google Ads
    const r3 = await RP.pull({ root: tmp, slug: 'sample-firm-a', creds, pass: 'sample pass', fetch: FX.fakeApis(), outDir: out, now: FX.NOW, log: () => {} });
    const ads = RC.adsIn((await decryptJSON(JSON.parse(await readFile(join(out, 'sample-firm-a/reports.json'), 'utf8')).enc, 'sample pass')).ads, r7);
    check(r3.ok && ads.cost === 1490 && ads.conv === 8 && Math.round(ads.cpl) === 186 && ads.clicks === 201 && ads.cplChange === -22 && ads.currency === 'USD', 'Google Ads: spend $1,490, 8 leads, $186 per lead (▼ $22), 201 clicks, USD');
    check(JSON.stringify(ads.campaigns.map(c => [c.name, c.cost, c.conv])) === JSON.stringify([['Personal injury · city', 849, 4], ['Car accidents', 402, 3], ['Truck accidents', 239, 1]]), 'campaigns: Personal injury · city $849 / 4 · Car accidents $402 / 3 · Truck accidents $239 / 1');
    const z = await RP.pull({ root: tmp, slug: 'sample-firm-a', creds, pass: 'sample pass', fetch: FX.fakeApis({ adsZero: true }), outDir: join(tmp, 'out-z'), now: FX.NOW, log: () => {} });
    const az = RC.adsIn((await decryptJSON(JSON.parse(await readFile(join(tmp, 'out-z/sample-firm-a/reports.json'), 'utf8')).enc, 'sample pass')).ads, r7);
    check(z.ok && az.conv === 0 && az.cpl === null && RC.money(az.cpl) === '–' && az.campaigns.every(c => c.cpl === null), '0 conversions → cost per lead "–"');
    // lost access: GA4 robot removed, Ads link gone → broken (the other sources still update), one alert each
    const r4 = await RP.pull({ root: tmp, slug: 'lost', creds, pass: 'lost pass', fetch: FX.fakeApis(), outDir: out, now: FX.NOW, log: () => {} });
    check(!r4.ok && r4.sources.callrail.ok && r4.sources.ga4.kind === 'no_access' && r4.sources.googleAds.kind === 'no_access', 'robot lost GA4 access + lost MCC link → those two no_access; CallRail still updated');
    const res = join(tmp, 'res'); await mkdir(res);
    for (const [k, v] of [['mahdavi', r1], ['sample-firm-a', r3], ['lost', r4]]) await writeFile(join(res, `${k}.json`), JSON.stringify(v));
    const matrix = [{ slug: 'mahdavi' }, { slug: 'sample-firm-a' }, { slug: 'lost' }];
    const st = await RP.finish({ root: tmp, matrix, resultsDir: res, dataDir: out, runUrl: 'https://github.com/x/actions/runs/2', now: new Date('2026-08-10T06:05:00Z'), log: () => {} });
    check(st.firms.mahdavi.ok && st.firms.mahdavi.sources.callrail.ok && !st.firms.lost.ok && st.firms.lost.sources.ga4.ok === false && st.firms.lost.sources.callrail.ok && (await readFile(join(tmp, RC.dataPath('lost')), 'utf8')).includes('"enc"'), 'status: per-source health; a firm with one broken source still gets its other numbers');
    const is1 = RC.reportsIssues(st, { firms: [{ slug: 'lost', name: 'Lost Access Firm' }] });
    check(is1.length === 2 && is1[0].id === 'reports:lost:ga4' && is1[0].title === 'Lost Access Firm: Reports · GA4 no access' && /Ask the client to add the robot email as a Viewer/.test(is1[0].detail) && is1[1].id === 'reports:lost:googleAds', 'bell + Slack: one issue per broken source ("GA4 no access" + the robot-email hint)', JSON.stringify(is1.map(i => [i.id, i.title, i.detail])));
    const st2 = await RP.finish({ root: tmp, matrix, resultsDir: res, dataDir: out, now: new Date('2026-08-11T06:05:00Z'), log: () => {} });
    const is2 = RC.reportsIssues(st2, { firms: [] });
    check(is2.find(i => i.id === 'reports:lost:ga4').firstSeen === '2026-08-10T06:05:00.000Z', 'still broken the next night: same issue id + first-seen time → alerts once (the bell\'s de-duplication), not every night');
    const pub = await readFile(join(tmp, RP.STATUS_FILE), 'utf8');
    check(!/\b107\b|312|948|mahdavi pass|ya29/.test(pub), 'status file (public): no numbers, no passphrase, no token');
  } finally { await rm(tmp, { recursive: true, force: true }); }

  // ---------------------------------------------------------------- the workflow passes the new secrets by name
  const yml = await readFile(join(ROOT, '.github/workflows/reports.yml'), 'utf8');
  check(['CALLRAIL_API_KEY', 'GOOGLE_REPORTS_SA_JSON', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_GBP_REFRESH_TOKEN', 'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_MCC_ID'].every(n => yml.includes(`${n}: \${{ secrets.${n} }}`)) && /HAS_CALLRAIL:/.test(yml) && /HAS_ADS:/.test(yml), 'reports.yml: the 7 new secrets by name to the pull job; HAS_* flags to the plan');
  const src = ['scripts/callrail.mjs', 'scripts/google.mjs'].map(p => readFile(join(ROOT, p), 'utf8'));
  const [crSrc, gSrc] = await Promise.all(src);
  check(!/method: '(PUT|PATCH|DELETE)'/.test(crSrc + gSrc) && !/developer-token/i.test(gSrc.replace(/\/\/.*$/gm, '')) && !/console\.log/.test(crSrc + gSrc), 'adapters: read only (no PUT / PATCH / DELETE), no developer-token header, no console logging');
}
