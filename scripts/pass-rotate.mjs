// v1.44.0 (queue item 15): Change a firm's dashboard passphrase (started only from the Builder, PJ only).
// pass-rotate.yml runs in the SAME concurrency group as the sync ("sync"), so no sync can write a file with the old
// passphrase while it runs, and it holds that group until the Builder says the secret has been swapped.
//   plan     → key (secret name part) + location for the firm (firms/index.json, or a Reports-only client's reportsOnly)
//   encrypt  → each encrypted file (data/details.enc.json, reports.json) is opened with PASSPHRASE_<KEY> (old) and locked with
//              PASSPHRASE_NEW_<KEY> (new); checked: opens with the new one and NOT the old one. Status "encrypted".
//   wait     → reads status/pass-rotate-<slug>.json (the Builder writes it) every 10 s for up to 15 minutes:
//              "finished" → "done" · "abort" → back · no answer: "swapped" → "done-unconfirmed" (keep the new files: the
//              secret already is the new one), anything else → back.
//   back     → the files are locked with the old passphrase again (opened with the new one), status "rolled-back", exit 1.
//   menu     → (menu-link.yml kind "pass") the firm's own "KPI Dashboard" / "Reports" links get the new passphrase in their
//              URL (ghl-menu.mjs updateLinkUrls: same ids, same settings). Result in status/menu-link-<slug>-pass.json.
// Passphrases come only from the environment (Actions secrets) and are never printed, written in the clear or committed.
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { realpathSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { encryptJSON, decryptJSON } from './kpi-core.mjs';
import { configPath, dataPath, reportsOnlyValue } from './reports-core.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const jsonText = o => `${JSON.stringify(o, null, 2)}\n`;
const readJSON = async (p, f = null) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch { return f; } };
export const statusPath = slug => `status/pass-rotate-${slug}.json`;
export const secretKeyOf = slug => String(slug).toUpperCase().replace(/-/g, '_');
// the encrypted files of a firm: { path, kind } (kind "details" = the envelope itself; "reports" = { v, generatedAt, enc })
export const filesOf = slug => [{ path: `firms/${slug}/data/details.enc.json`, kind: 'details' }, { path: dataPath(slug), kind: 'reports' }];
const envOf = (kind, j) => (kind === 'details' ? j : j?.enc);
const withEnv = (kind, j, env) => (kind === 'details' ? env : { ...j, enc: env });

export async function plan({ root = ROOT, slug }) {
  if (!SLUG_RE.test(slug || '')) return { error: 'No valid firm slug.' };
  const index = await readJSON(`${root}firms/index.json`, []), row = index.find(f => f.slug === slug);
  const ro = reportsOnlyValue((await readJSON(`${root}${configPath(slug)}`))?.reportsOnly);
  if (!row && !ro) return { error: `"${slug}" isn't a KPI firm or a Reports-only client.` };
  const kpi = await readJSON(`${root}firms/${slug}/config.json`);
  return { key: row?.secretKey || ro?.secretKey || secretKeyOf(slug), location: kpi?.locationId || row?.locationId || ro?.locationId || '' };
}

// re-lock every encrypted file from one passphrase to another, and check it. Returns the paths changed. Throws (nothing
// written) if a file doesn't open with `from` or the check fails.
export async function relock({ root = ROOT, slug, from, to, iter }) {
  if (!from || !to || from === to) throw new Error('Two different passphrases are needed.');
  const out = [];
  for (const f of filesOf(slug)) {
    const p = `${root}${f.path}`; if (!existsSync(p)) continue;
    const j = JSON.parse(await readFile(p, 'utf8')), env = envOf(f.kind, j);
    if (!env?.ct) continue;
    let plain; try { plain = await decryptJSON(env, from); } catch { throw new Error(`${f.path} doesn't open with the current passphrase: nothing was changed.`); }
    const next = await encryptJSON(plain, to, ...(iter ? [iter] : []));
    let ok = false; try { ok = JSON.stringify(await decryptJSON(next, to)) === JSON.stringify(plain); } catch {}
    let oldOpens = false; try { await decryptJSON(next, from); oldOpens = true; } catch {}
    if (!ok || oldOpens) throw new Error(`${f.path}: the check after re-locking failed: nothing was changed.`);
    out.push({ p, text: `${JSON.stringify(withEnv(f.kind, j, next))}\n`, path: f.path });
  }
  for (const x of out) await writeFile(x.p, x.text);   // only once every file passed
  return out.map(x => x.path);
}
export async function writeStatus(root, slug, o) { await mkdir(`${root}status`, { recursive: true }); await writeFile(`${root}${statusPath(slug)}`, jsonText({ slug, ...o, at: new Date().toISOString() })); }

// the wait loop's decision for one read of the status file
export function decide(st, request, { timedOut = false } = {}) {
  if (!st || st.request !== request) return timedOut ? 'back' : 'wait';
  if (st.state === 'finished') return 'done';
  if (st.state === 'abort') return 'back';
  if (timedOut) return st.state === 'swapped' ? 'done-unconfirmed' : 'back';
  return 'wait';
}

const git = (...a) => execFileSync('git', a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const push = msg => { git('config', 'user.name', 'kpi-sync-bot'); git('config', 'user.email', 'kpi-sync-bot@users.noreply.github.com'); git('add', '-A', 'firms', 'status'); try { git('commit', '-m', msg); } catch { return; } for (let i = 0; i < 3; i++) { try { git('pull', '--rebase', '--quiet', 'origin', 'main'); git('push', 'origin', 'HEAD:main'); return; } catch {} } throw new Error('push failed'); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const env = process.env, cmd = process.argv[2], slug = (env.NF_SLUG || '').trim(), request = String(env.NF_REQUEST || '').slice(0, 60);
  if (cmd === 'plan') {
    const p = await plan({ slug });
    if (p.error) { console.log(`Refused: ${p.error}`); process.exitCode = 1; return; }
    if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, `key=${p.key}\nlocation=${p.location}\n`);
    console.log(`${slug}: ready.`); return;
  }
  if (cmd === 'encrypt') {
    const changed = await relock({ slug, from: env.PASS_OLD, to: env.PASS_NEW });
    await writeStatus(ROOT, slug, { request, state: 'encrypted', files: changed });
    push(`Passphrase change for ${slug}: files re-locked [${request}]`);
    console.log(`${slug}: ${changed.length} file(s) re-locked with the new passphrase (checked).`); return;
  }
  if (cmd === 'wait') {
    const t0 = Date.now();
    for (;;) {
      await sleep(10000);
      try { git('pull', '--rebase', '--quiet', 'origin', 'main'); } catch {}
      const d = decide(await readJSON(`${ROOT}${statusPath(slug)}`), request, { timedOut: Date.now() - t0 > 15 * 60e3 });
      if (d === 'wait') continue;
      if (d === 'done' || d === 'done-unconfirmed') { await writeStatus(ROOT, slug, { request, state: d }); push(`Passphrase change for ${slug}: ${d} [${request}]`); console.log(`${slug}: ${d}.`); return; }
      const back = await relock({ slug, from: env.PASS_NEW, to: env.PASS_OLD });
      await writeStatus(ROOT, slug, { request, state: 'rolled-back', files: back });
      push(`Passphrase change for ${slug}: rolled back [${request}]`);
      console.log(`${slug}: rolled back to the old passphrase.`); process.exitCode = 1; return;
    }
  }
  if (cmd === 'menu') {
    const { updateLinkUrls } = await import('./ghl-menu.mjs');
    const r = await updateLinkUrls({ token: env.GHL_MENU_TOKEN, locationId: env.NF_LOCATION, slug, passphrase: env.NF_PASSPHRASE });
    await mkdir(`${ROOT}status`, { recursive: true });
    await writeFile(`${ROOT}status/menu-link-${slug}-pass.json`, jsonText({ slug, request, at: new Date().toISOString(), kpi: r.kpi, reports: r.reports }));
    console.log(`Menu links: KPI Dashboard ${r.kpi}, Reports ${r.reports}.`);
    if (/^failed/.test(r.kpi) || /^failed/.test(r.reports)) process.exitCode = 1;
    return;
  }
  console.error('Use: node scripts/pass-rotate.mjs plan | encrypt | wait | menu'); process.exitCode = 2;
}
const isMain = (() => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (isMain) await main();
