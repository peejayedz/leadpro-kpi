// KPI sync problems → Slack DM to PJ (v1.22.0). Run by .github/workflows/alerts.yml.
//
// The SAME issues as the KPI admin bell: keeperIssues + reviewIssues + openIssues, counted in the badge (inBadge),
// built from the same files (status/sync-status.json, status/token-keeper.json, firms/index.json, each firm's
// config.json and kpis.json) and the same chain check (SYNC_CHAIN + chainAlive). So the DM and the bell always agree.
//
// One DM when an issue STARTS, one "Resolved" DM when it clears. Never repeated while it stays open.
// What was sent is kept in status/alerts.json (public: issue ids, kinds, slugs, firm names, titles and times only).
// A DM that couldn't be sent (no webhook, Slack down) is NOT recorded, so the next check tries again.
// Never fails because of Slack. Never prints the webhook.
//
//   node scripts/kpi-alerts.mjs            check, send, update status/alerts.json
//   SLACK_TEST=yes node scripts/kpi-alerts.mjs   send one test DM only (Actions → Slack alerts → Run workflow → test = yes)

import { readFile, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openIssues, inBadge, describeIssue, chainAlive, driftText } from './sync-status.mjs';
import { keeperIssues, reviewIssues } from './keeper-status.mjs';
import { postSlack, slackEscape, slackLink, duration, manilaTime } from './slack.mjs';

export const ADMIN_URL = 'https://lfmp-admin.pages.dev/leadpro-kpi/admin/';
export const STATE_FILE = 'status/alerts.json';
export const emptyState = () => ({ version: 1, updatedAt: null, open: {} });

// The admin page's kpiSummary(), the two fields openIssues reads.
export const kpiSummary = k => (k ? { generatedAt: k.generatedAt, sync: k.sync || null } : null);

// The bell's list (admin/index.html refreshIssues → listed()).
export function bellIssues({ status, keeper, firms, configs, kpis, chain, now }) {
  const rank = i => (i.slug ? 1 : 0);
  return [...keeperIssues(keeper, { now, firms }), ...reviewIssues(firms, configs), ...openIssues(status, { now, firms, kpis, chain })]
    .sort((a, b) => rank(a) - rank(b) || Date.parse(b.firstSeen) - Date.parse(a.firstSeen))
    .filter(i => inBadge(i) || i.kind === 'unmapped');   // v1.28.0: "stages not mapped" is a bell notice, but it's DMed too
}
const isCareCfg = c => ['medical', 'other'].includes(c?.practiceType);

const plain = s => String(s ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
export function issueTitle(i, firm, now) {
  return plain(describeIssue(i, { now, secretKey: firm?.secretKey, tokenSource: firm?.tokenSource, when: x => x }).title);
}
const who = (slug, firms) => (slug ? firms.find(f => f.slug === slug)?.name || slug : 'All firms');

export function startText(i, { firms, now, configs = {} }) {
  const name = who(i.slug, firms), title = issueTitle(i, firms.find(f => f.slug === i.slug), now);
  if (i.kind === 'unmapped') return [
    `:warning: *${slackEscape(driftText(i) || 'Mapping out of date')} · ${slackEscape(name)}*`,
    isCareCfg(configs[i.slug]) ? 'People in an unmapped stage count nowhere until it\'s mapped.' : 'Numbers are counted as before (warning only); check the mapping still matches GHL.',
    slackLink(`${ADMIN_URL}#/map/${encodeURIComponent(i.slug)}`, isCareCfg(configs[i.slug]) ? 'Map pipelines →' : 'Edit mapping →'),
  ].join('\n');
  // v1.30.0: a counted pipeline isn't in GHL (the dashboard keeps its last numbers, never 0)
  if (i.kind === 'failed' && i.category === 'pipeline') return [
    `:warning: *Pipeline not found · ${slackEscape(name)}*`,
    `${i.missing > 1 ? `${i.missing} counted pipelines aren't` : 'A counted pipeline isn\'t'} in GHL any more, so this firm wasn't synced. The dashboard keeps its last numbers.`,
    slackLink(`${ADMIN_URL}#/map/${encodeURIComponent(i.slug)}`, 'Edit mapping →'),
  ].join('\n');
  return [
    `:rotating_light: *KPI sync problem: ${slackEscape(name)}*`,
    `${slackEscape(title)}. The admin bell shows the fix.`,
    slackLink(ADMIN_URL, 'Open KPI admin →'),
  ].join('\n');
}
export function resolvedText(e, { now }) {
  const open = Date.parse(e.sentAt || e.firstSeen);
  return [
    `:white_check_mark: *Resolved: ${slackEscape(e.name)}*`,
    `${slackEscape(e.title)}: cleared${Number.isFinite(open) ? ` after ${duration(now - open)}` : ''}.`,
  ].join('\n');
}

// prev: status/alerts.json; issues: bellIssues(...). chainKnown=false: the chain check couldn't run (GitHub API
// error), so a "chain stopped" alert is neither started nor resolved this time.
// Returns { starts: [issue], resolves: [entry], keep: {id: entry} } (keep = entries that stay open, unchanged).
export function plan(prev, issues, { firms, chainKnown = true }) {
  const st = prev?.version === 1 ? prev : emptyState();
  const now = new Map(issues.map(i => [i.id, i]));
  const known = new Set(firms.map(f => f.slug));
  const starts = [], resolves = [], keep = {};
  for (const [id, e] of Object.entries(st.open || {})) {
    if (now.has(id)) { keep[id] = e; continue; }
    if (!chainKnown && e.kind === 'no-link') { keep[id] = e; continue; }
    if (e.slug && !known.has(e.slug)) continue;   // firm deleted: drop quietly
    resolves.push({ id, ...e });
  }
  for (const i of issues) {
    if (st.open?.[i.id]) continue;
    if (!chainKnown && i.kind === 'no-link') continue;
    starts.push(i);
  }
  return { starts, resolves, keep };
}

// Sends the DMs and returns the next state. A DM that fails leaves its entry as it was, so it's tried again.
export async function run({ prev, issues, firms, configs = {}, chainKnown = true, now = Date.now(), send = postSlack, log = console.log }) {
  const { starts, resolves, keep } = plan(prev, issues, { firms, chainKnown });
  const open = { ...keep };
  let sent = 0, failed = 0;
  for (const e of resolves) {
    const r = await send(resolvedText(e, { now }));
    if (r.ok) { sent++; log(`Resolved DM sent: ${e.id}`); } else { failed++; open[e.id] = { kind: e.kind, slug: e.slug, name: e.name, title: e.title, firstSeen: e.firstSeen, sentAt: e.sentAt }; }
  }
  for (const i of starts) {
    const r = await send(startText(i, { firms, now, configs }));
    if (r.ok) {
      sent++; log(`Alert DM sent: ${i.id}`);
      open[i.id] = { kind: i.kind, slug: i.slug || null, name: who(i.slug, firms), title: issueTitle(i, firms.find(f => f.slug === i.slug), now), firstSeen: i.firstSeen, sentAt: new Date(now).toISOString() };
    } else failed++;
  }
  log(`KPI alerts: ${issues.length} open on the bell · ${starts.length} new · ${resolves.length} cleared · ${sent} DM sent · ${failed} not sent`);
  const changed = JSON.stringify(open) !== JSON.stringify(prev?.open || {});
  return { state: { version: 1, updatedAt: changed ? new Date(now).toISOString() : prev?.updatedAt ?? null, open }, changed, sent, failed };
}

// ---------- the bell's chain check, from GitHub Actions (admin/index.html chainState) ----------
async function chainState({ repo, token, syncChain, fetchImpl = fetch }) {
  const out = { value: String(syncChain || '').trim().toLowerCase() === 'off' ? 'off' : 'on', source: 'variable', waiting: null, lastLinkAt: null, lastLinkUrl: null };
  try {
    const get = async p => { const r = await fetchImpl(`${process.env.GITHUB_API || 'https://api.github.com'}/repos/${repo}${p}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };
    const [links, syncs] = await Promise.all([get('/actions/workflows/sync-chain.yml/runs?per_page=5'), get('/actions/workflows/sync.yml/runs?per_page=10')]);
    const L = links.workflow_runs || [], S = syncs.workflow_runs || [], last = L[0];
    out.lastLinkAt = last?.status === 'completed' ? last.updated_at : null; out.lastLinkUrl = last?.html_url || null;
    out.waiting = chainAlive({ links: L, syncs: S, now: Date.now() });
  } catch (e) { console.log(`Chain check skipped (${e.message})`); }
  return out;
}

const readJSON = async p => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return null; } };

async function main() {
  const ROOT = fileURLToPath(new URL('../', import.meta.url));
  if (process.env.SLACK_TEST === 'yes') {
    const r = await postSlack([':white_check_mark: *Test alert from LeadPro KPI*', `KPI sync DMs are working. Sent ${manilaTime()} (Manila).`, slackLink(ADMIN_URL, 'Open KPI admin →')].join('\n'));
    if (!r.ok) { console.log(`::error::Test DM not sent (${r.reason}). Check the SLACK_WEBHOOK_URL secret on this repo.`); process.exitCode = 1; }
    return;
  }
  const list = await readJSON(join(ROOT, 'firms/index.json'));
  const firms = Array.isArray(list) ? list : [];
  const configs = {}, kpis = {};
  for (const f of firms) {
    configs[f.slug] = await readJSON(join(ROOT, 'firms', f.slug, 'config.json'));
    kpis[f.slug] = kpiSummary(await readJSON(join(ROOT, 'firms', f.slug, 'data/kpis.json')));
  }
  const status = await readJSON(join(ROOT, 'status/sync-status.json'));
  const keeper = await readJSON(join(ROOT, 'status/token-keeper.json'));
  const chain = await chainState({ repo: process.env.GITHUB_REPOSITORY || 'peejayedz/leadpro-kpi', token: process.env.GH_TOKEN || '', syncChain: process.env.SYNC_CHAIN });
  const issues = bellIssues({ status, keeper, firms, configs, kpis, chain, now: Date.now() });
  const prev = await readJSON(join(ROOT, STATE_FILE));
  const { state, changed } = await run({ prev, issues, firms, configs, chainKnown: chain.value === 'off' || chain.waiting !== null });
  if (changed) await writeFile(join(ROOT, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
}

const isMain = () => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } };
if (process.argv[1] && isMain()) {
  main().catch(e => { console.log(`::warning::KPI alerts check stopped: ${e.message}`); });
}
