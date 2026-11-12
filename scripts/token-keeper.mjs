// Token keeper for firms that use the "LFMP LeadPro Connector" app token (tokenSource "app" in firms/index.json).
// Run by .github/workflows/tokens.yml (hourly, after each scheduled/chained sync, and on demand).
//
//  1. Agency token: kept in GHL_APP_ACCESS ({ access_token, expiresAt }). Refreshed only when under
//     REFRESH_BEFORE_H hours are left. The refresh token is SINGLE USE, so the new one is saved to
//     GHL_APP_REFRESH_TOKEN FIRST (3 tries), before anything else uses the new access token.
//  2. For each app firm (or the one firm asked for): checks the app is installed on its location,
//     mints a location token and writes it to that firm's GHL_TOKEN_<KEY>. sync.yml is unchanged.
//     A firm WITHOUT tokenSource "app" (Private Integration firms) is never written to.
//  3. Writes status/token-keeper.json (slugs, times, codes only; see keeper-status.mjs).
//
// PUBLIC LOGS: prints step names, slugs and counts only. Never a token, secret or passphrase.
// Secrets are written with `gh secret set` (value on stdin; GitHub seals it), using SECRETS_TOKEN.
//
// Env: GHL_APP_CLIENT_ID, GHL_APP_CLIENT_SECRET, GHL_APP_REFRESH_TOKEN, GHL_APP_ACCESS, SECRETS_TOKEN,
//      GITHUB_REPOSITORY, RUN_URL, KEEPER_MODE (keep | check), KEEPER_SLUG (one firm),
//      KEEPER_LOCATION + KEEPER_SECRET_KEY (a new firm not yet in index.json: new-firm.yml),
//      KEEPER_DRY_RUN=1 (no secret writes, no refresh), KEEPER_GH_BIN (tests), KEEPER_STATUS_FILE, GHL_API_BASE (tests)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { refreshAgency, mintLocationToken, installedLocationIds, appIdFromClientId, AppError } from './ghl-app.mjs';
import { updateKeeper, REFRESH_BEFORE_H } from './keeper-status.mjs';
import { readIndex, secretKeyFor, tokenName, checkSlug } from './firms.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const log = s => console.log(s);
const fp = v => createHash('sha256').update(String(v), 'utf8').digest('hex').slice(0, 10);

// Writes one secret through the gh CLI. The value goes on stdin; gh's own output is not printed.
export function makeSecretWriter({ repo, token, bin = 'gh', dry = false }) {
  return async function setSecret(name, value) {
    if (!/^(GHL_APP_REFRESH_TOKEN|GHL_APP_ACCESS|GHL_TOKEN_[A-Z0-9_]{1,80})$/.test(name)) throw new Error(`Blocked: the keeper may not write the secret ${name}.`);
    if (!value) throw new Error(`Refusing to write an empty ${name}.`);
    if (dry) { log(`  (dry run) would update ${name}`); return; }
    await new Promise((resolve, reject) => {
      const p = spawn(bin, ['secret', 'set', name, '--repo', repo], { env: { ...process.env, GH_TOKEN: token }, stdio: ['pipe', 'ignore', 'pipe'] });
      let err = ''; p.stderr.on('data', d => { err += d; });
      p.on('error', e => reject(new Error(`couldn't run gh (${e.code || 'error'})`)));
      p.on('close', c => (c === 0 ? resolve() : reject(new Error(`gh secret set ${name} failed (exit ${c})${/40[134]/.test(err) ? ': GitHub refused (check SECRETS_TOKEN)' : ''}`))));
      p.stdin.end(value);
    });
  };
}
const sleep = ms => new Promise(r => setTimeout(r, Number(process.env.KEEPER_SLEEP_SCALE ?? 1) * ms));

export async function runKeeper(env = process.env) {
  const now = Date.now(), at = new Date(now).toISOString();
  const run = { at, ok: false, runUrl: env.RUN_URL, problem: null, firms: {} };
  const dry = env.KEEPER_DRY_RUN === '1', mode = env.KEEPER_MODE === 'check' ? 'check' : 'keep';
  const setSecret = makeSecretWriter({ repo: env.GITHUB_REPOSITORY, token: env.SECRETS_TOKEN, bin: env.KEEPER_GH_BIN || 'gh', dry });
  const clientId = env.GHL_APP_CLIENT_ID, clientSecret = env.GHL_APP_CLIENT_SECRET;
  let refreshToken = env.GHL_APP_REFRESH_TOKEN;
  let access = null;
  try { access = JSON.parse(env.GHL_APP_ACCESS || 'null'); } catch { access = null; }

  if (mode === 'check') {
    // Fingerprints (first 10 hex of sha256) so the move script can compare without seeing values.
    log('Check mode: no refresh, no writes.');
    for (const [n, v] of [['GHL_APP_CLIENT_ID', clientId], ['GHL_APP_CLIENT_SECRET', clientSecret], ['GHL_APP_REFRESH_TOKEN', refreshToken], ['GHL_APP_ACCESS', env.GHL_APP_ACCESS]])
      log(`fingerprint ${n} ${v ? fp(v) : 'MISSING'}`);
    if (access?.access_token && clientId) {
      try { const r = await installedLocationIds({ agencyToken: access.access_token, appId: appIdFromClientId(clientId) }); log(`Agency token works: app on ${r.ids.size} sub-accounts, future installs ${r.installToFutureLocations === true ? 'on' : r.installToFutureLocations === false ? 'OFF' : 'unknown'}.`); }
      catch (e) { log(`Agency token check failed: ${e.message}`); return { exit: 1 }; }
    }
    return { exit: 0, skipStatus: true };
  }

  // Which firms
  const index = await readIndex();
  let targets = index.filter(f => f.tokenSource === 'app');
  if (env.KEEPER_SLUG) {
    const slug = env.KEEPER_SLUG, bad = checkSlug(slug); if (bad) throw new Error(bad);
    const listed = index.find(f => f.slug === slug);
    if (listed && listed.tokenSource !== 'app') { log(`${slug} uses a Private Integration token; the keeper never touches it.`); return { exit: 1, skipStatus: true }; }
    if (listed) targets = [listed];
    else {
      // A new firm that new-firm.yml hasn't committed yet.
      const key = env.KEEPER_SECRET_KEY, loc = env.KEEPER_LOCATION;
      if (key !== secretKeyFor(slug) || !/^[A-Za-z0-9]{15,30}$/.test(loc || '')) throw new Error('A new firm needs KEEPER_LOCATION and KEEPER_SECRET_KEY matching its slug.');
      if (index.some(f => f.secretKey === key || f.locationId === loc)) throw new Error('That secret name or location already belongs to a firm in firms/index.json.');
      targets = [{ slug, secretKey: key, locationId: loc, tokenSource: 'app', isNew: true }];
    }
  }
  log(`Firms using the app token: ${index.filter(f => f.tokenSource === 'app').length}${env.KEEPER_SLUG ? ` (this run: ${env.KEEPER_SLUG})` : ''}.`);

  if (!clientId || !clientSecret || !refreshToken) {
    log('App secrets are not set up (GHL_APP_CLIENT_ID / GHL_APP_CLIENT_SECRET / GHL_APP_REFRESH_TOKEN).');
    run.problem = { category: 'reconnect', detail: 'missing-secrets' };
    return { exit: targets.length ? 1 : 0, run };
  }

  // Proves KEEPER_GH_TOKEN can write secrets (reads the repo's secrets public key, which needs the same
  // Secrets permission) before the single-use refresh token is spent.
  const canWriteSecrets = () => new Promise(resolve => {
    const p = spawn(env.KEEPER_GH_BIN || 'gh', ['api', `repos/${env.GITHUB_REPOSITORY}/actions/secrets/public-key`, '--silent'], { env: { ...process.env, GH_TOKEN: env.SECRETS_TOKEN }, stdio: 'ignore' });
    p.on('error', () => resolve(false)); p.on('close', c => resolve(c === 0));
  });
  let refreshedThisRun = false;
  async function refresh(reason) {
    if (dry) { log(`  (dry run) would refresh the agency token (${reason})`); return false; }
    // Never spend the single-use refresh token without a way to save the new one.
    if (!env.SECRETS_TOKEN || !(await canWriteSecrets())) { run.problem = { category: 'github', detail: 'no-secrets-token' }; log(`Refresh needed (${reason}) but KEEPER_GH_TOKEN is ${env.SECRETS_TOKEN ? 'not working (expired, revoked or missing the Secrets permission)' : 'not set'}, so the new refresh token couldn't be saved. Not refreshing.`); return false; }
    log(`Refreshing the agency token (${reason}).`);
    let t;
    try { t = await refreshAgency({ clientId, clientSecret, refreshToken }); }
    catch (e) {
      if (e instanceof AppError && [400, 401, 403].includes(e.status)) { run.problem = { category: 'reconnect', detail: 'refresh-rejected' }; log(`GHL refused the refresh token (${e.status}). Re-connect needed.`); }
      else { run.problem = { category: 'ghl', detail: e.code === 'network' ? 'network' : 'server' }; log(`Refresh failed: ${e.message}`); }
      return false;
    }
    if (!t.access_token || !t.refresh_token) { run.problem = { category: 'ghl', detail: 'server' }; log('GHL answered without tokens.'); return false; }
    // 1. Save the new (single-use) refresh token FIRST.
    let saved = false;
    for (let i = 0; i < 3 && !saved; i++) {
      try { await setSecret('GHL_APP_REFRESH_TOKEN', t.refresh_token); saved = true; }
      catch (e) { log(`Saving the new refresh token failed (try ${i + 1} of 3): ${e.message}`); await sleep(3000 * (i + 1)); }
    }
    refreshToken = t.refresh_token; refreshedThisRun = true;
    access = { access_token: t.access_token, expiresAt: new Date(Date.now() + (Number(t.expires_in) || 86399) * 1000).toISOString() };
    run.refreshedAt = new Date().toISOString();
    if (!saved) { run.problem = { category: 'reconnect', detail: 'save-failed' }; log('The new refresh token could NOT be saved. This run still updates firm tokens; then a re-connect is needed.'); return true; }
    log('New refresh token saved.');
    // 2. Then the access token (if this fails, the next run simply refreshes again).
    try { await setSecret('GHL_APP_ACCESS', JSON.stringify(access)); log('Agency token saved.'); }
    catch (e) { run.problem = { category: 'github', detail: 'access-save-failed' }; log(`Saving the agency token failed: ${e.message}`); }
    return true;
  }

  const left = access?.access_token ? Date.parse(access.expiresAt) - Date.now() : -1;
  if (!(left > REFRESH_BEFORE_H * 36e5)) { if (!(await refresh(left > 0 ? `${Math.floor(left / 36e5)} h left` : 'no valid agency token saved')) && !(left > 0)) return { exit: 1, run }; }
  else log(`Agency token valid for ${Math.floor(left / 36e5)} h ${Math.floor(left / 6e4) % 60} min; no refresh needed.`);
  run.agencyExpiresAt = access?.expiresAt;

  // Where the app is installed (one list call), then each firm.
  let installed = null;
  try {
    const r = await installedLocationIds({ agencyToken: access.access_token, appId: appIdFromClientId(clientId) });
    installed = r.ids; run.appInstalls = r.ids.size; run.installToFutureLocations = r.installToFutureLocations;
    log(`App installed on ${r.ids.size} sub-accounts; future installs ${r.installToFutureLocations === true ? 'on' : r.installToFutureLocations === false ? 'OFF' : 'unknown'}.`);
  } catch (e) {
    if (e.status === 401 && !refreshedThisRun && await refresh('agency token refused')) {
      try { const r = await installedLocationIds({ agencyToken: access.access_token, appId: appIdFromClientId(clientId) }); installed = r.ids; run.appInstalls = r.ids.size; run.installToFutureLocations = r.installToFutureLocations; run.agencyExpiresAt = access.expiresAt; }
      catch (e2) { log(`Listing installs failed: ${e2.message}`); }
    } else log(`Listing installs failed: ${e.message}`);
    if (!installed) { run.problem ||= { category: 'ghl', detail: 'list-failed' }; return { exit: 1, run }; }
  }

  let firmFail = 0;
  for (const f of targets) {
    if (f.secretKey !== secretKeyFor(f.slug)) { log(`${f.slug}: secret name doesn't match the slug; skipped.`); run.firms[f.slug] = { ok: false, problem: 'mint-failed' }; firmFail++; continue; }
    if (!installed.has(f.locationId)) { log(`${f.slug}: the app is NOT installed on its sub-account.`); run.firms[f.slug] = { ok: false, problem: 'app-missing' }; firmFail++; continue; }
    let t = null;
    try { t = await mintLocationToken({ agencyToken: access.access_token, locationId: f.locationId }); }
    catch (e) {
      if (e.status === 401 && !refreshedThisRun && await refresh('agency token refused')) { try { t = await mintLocationToken({ agencyToken: access.access_token, locationId: f.locationId }); } catch (e2) { log(`${f.slug}: minting failed: ${e2.message}`); } }
      else log(`${f.slug}: minting failed: ${e.message}`);
    }
    if (!t?.access_token || (t.locationId && t.locationId !== f.locationId)) { run.firms[f.slug] = { ok: false, problem: 'mint-failed' }; firmFail++; continue; }
    try { await setSecret(tokenName(f.secretKey), t.access_token); run.firms[f.slug] = { ok: true }; log(`${f.slug}: token updated.`); }
    catch (e) { run.firms[f.slug] = { ok: false, problem: 'save-failed' }; firmFail++; log(`${f.slug}: saving the token failed: ${e.message}`); }
  }
  run.agencyExpiresAt = access.expiresAt;
  run.ok = !run.problem || run.problem.detail === 'access-save-failed';   // the next run simply refreshes again
  // The first-time new firm isn't listed yet: keep its row out of the public file until it's committed.
  for (const f of targets) if (f.isNew) delete run.firms[f.slug];
  if (dry) log('Dry run: nothing was written.');
  return { exit: run.problem && run.problem.detail !== 'access-save-failed' ? 1 : firmFail ? 1 : 0, run, newFirmOk: targets.some(f => f.isNew) ? firmFail === 0 : undefined };
}

async function main() {
  let res;
  try { res = await runKeeper(); }
  catch (e) { console.error(`Keeper error: ${e.message}`); res = { exit: 1, run: { at: new Date().toISOString(), ok: false, runUrl: process.env.RUN_URL, problem: { category: 'unknown', detail: 'crash' }, firms: {} } }; }
  if (res.run && !res.skipStatus && process.env.KEEPER_DRY_RUN !== '1') {
    const file = process.env.KEEPER_STATUS_FILE || `${ROOT}status/token-keeper.json`;
    let prev = null; try { prev = JSON.parse(await readFile(file, 'utf8')); } catch {}
    const next = updateKeeper(prev, res.run);
    // Fewer commits: skip the write when only the run times changed and the saved "last OK" is under an hour old.
    const strip = k => JSON.stringify({ ...k, updatedAt: 0, lastRunAt: 0, lastOkAt: 0, lastRunUrl: 0, agencyExpiresAt: 0, firms: Object.fromEntries(Object.entries(k?.firms || {}).map(([s, f]) => [s, { ...f, lastMintAt: 0 }])) });
    const fresh = prev?.lastOkAt && Date.now() - Date.parse(prev.lastOkAt) < 60 * 60e3;
    // (With an ongoing problem "last OK" doesn't move, so nothing new would be written either.)
    if (prev && strip(prev) === strip(next) && ((fresh && next.lastOkAt) || (next.problem && next.lastOkAt === prev.lastOkAt))) { console.log('Status unchanged; not rewritten.'); }
    else { await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(next, null, 2) + '\n'); }
  }
  process.exitCode = res.exit;
}

const isMain = () => { try { return import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; } catch { return false; } };
if (process.argv[1] && isMain()) main();
