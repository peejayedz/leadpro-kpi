// The sync chain: keeps syncs running every 30 minutes when GitHub skips scheduled runs.
// Run by .github/workflows/sync-chain.yml, which a scheduled or chained sync starts when it ends.
// It waits for the next :07 or :37 (UTC), then starts "Sync all firms (chain)", unless a scheduled
// or chained sync already started for that slot. That run starts the chain again when it ends.
//
// Only one chain exists: sync-chain.yml's concurrency group cancels an older waiting run when a
// newer one starts. Repo variable SYNC_CHAIN=off stops it (the 7,37 cron keeps running alone).
//
// Env: GITHUB_TOKEN (actions: write), GITHUB_REPOSITORY, GITHUB_API_URL, SYNC_CHAIN,
//      CHAIN_NO_WAIT=1 (tests: don't sleep)

import { pathToFileURL } from 'node:url';

export const SLOTS = [7, 37];            // minutes past the hour, same as the sync.yml cron
export const MIN_LEAD_MS = 2 * 60e3;     // never start the next sync less than 2 minutes from now
export const RECENT_MS = 10 * 60e3;      // a scheduled/chained run this close to the slot counts for it

// The next :07 or :37 at least MIN_LEAD_MS from now.
export function nextSlot(now) {
  const hour = Math.floor(now / 36e5) * 36e5;
  for (let h = 0; h < 3; h++) for (const m of SLOTS) {
    const t = hour + h * 36e5 + m * 60e3;
    if (t >= now + MIN_LEAD_MS) return t;
  }
  throw new Error('no slot found');
}

// A run already covers this slot if it was scheduled or chained and created from RECENT_MS before the slot on.
export const isChainOrSchedule = r => r.event === 'schedule' || / \(chain\)$/.test(r.display_title || '');
export function coveredBy(runs, slot) {
  return runs.find(r => isChainOrSchedule(r) && Date.parse(r.created_at) >= slot - RECENT_MS) || null;
}

async function main() {
  if ((process.env.SYNC_CHAIN || '').trim().toLowerCase() === 'off') { console.log('SYNC_CHAIN is off: the chain stops here; the cron carries on.'); return; }
  const API = process.env.GITHUB_API_URL || 'https://api.github.com';
  const REPO = process.env.GITHUB_REPOSITORY, TOKEN = process.env.GITHUB_TOKEN;
  if (!REPO || !TOKEN) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  const gh = async (method, path, body) => {
    const r = await fetch(API + path, { method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${TOKEN}`, 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`GitHub ${r.status} on ${method} ${path}: ${(await r.text()).slice(0, 200)}`);
    return r.status === 204 ? null : r.json();
  };
  const slot = nextSlot(Date.now());
  const hhmm = new Date(slot).toISOString().slice(11, 16);
  console.log(`Next sync at ${hhmm} UTC; waiting ${Math.round((slot - Date.now()) / 60e3)} min.`);
  if (!process.env.CHAIN_NO_WAIT) await new Promise(r => setTimeout(r, Math.max(0, slot - Date.now())));
  const since = new Date(slot - RECENT_MS).toISOString();
  const { workflow_runs: runs = [] } = await gh('GET', `/repos/${REPO}/actions/workflows/sync.yml/runs?per_page=20&created=${encodeURIComponent('>=' + since)}`);
  const cover = coveredBy(runs, slot);
  if (cover) { console.log(`A ${cover.event === 'schedule' ? 'scheduled' : 'chained'} sync already started at ${cover.created_at.slice(11, 16)} UTC for this slot; it continues the chain.`); return; }
  const ref = process.env.GITHUB_REF_NAME || 'main';
  await gh('POST', `/repos/${REPO}/actions/workflows/sync.yml/dispatches`, { ref, inputs: { chain: 'yes' } });
  console.log(`Started "Sync all firms (chain)" for ${hhmm} UTC.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exit(1); });
