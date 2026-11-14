// New firm → "Use the LeadPro app": the same path the Sub-account Builder uses (its page/kpi.js).
//   1. check the firm list (never two firms for one location: a location that already has a firm is refused),
//   2. save the dashboard passphrase (made in the browser) into PASSPHRASE_<KEY>, sealed; never re-made on a Retry,
//   3. start new-firm.yml with NON-SECRET inputs and follow its jobs (app on the sub-account → token → setup → first sync → menu link).
// Retry finishes only what's missing: a firm already in the list only gets its first sync (if it has no numbers yet)
// and the menu-link check; otherwise new-firm.yml is started again, and it resumes (it never adds a second firm).
// No DOM here: the admin page passes its GitHub helpers in (deps), and tests/admin-app/run.mjs passes mocks.
// Never logs, shows or sends the passphrase anywhere except deps.putPassphrase.

export const slugify = name => String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
export const secretKeyFor = slug => slug.toUpperCase().replace(/-/g, '_');
const RESERVED = ['admin', 'app', 'scripts', '_template', '_defaults', '_presets'];

// [key, title, hint while waiting]
export const APP_STEPS = [
  ['check', 'Check the firm list'],
  ['pass', 'Save the dashboard passphrase'],
  ['start', 'Start the setup on GitHub', 'GitHub usually starts in 10–60 seconds.'],
  ['app', 'Check the LeadPro app is on the sub-account', 'GHL adds the app to new sub-accounts by itself, usually within a few minutes.'],
  ['token', 'Make a read-only GHL token (no paste)'],
  ['setup', 'Read pipelines and stages, set up the dashboard'],
  ['sync', 'First sync', 'Pulls the numbers from GHL (a new sub-account shows zeros).'],
  ['menu', 'Add "KPI Dashboard" to the firm\'s GHL menu'],
];
export const JOB_STEP = { prepare: 'app', token: 'token', setup: 'setup', 'first-sync': 'sync', 'menu-link': 'menu' };
// new-firm.yml step name → plain message (same wording as the builder).
export const STEP_ERRORS = {
  'Check the firm list': 'The setup refused this firm: the dashboard name or the location is already used by another firm. Check the firm list, then Retry.',
  'Check the passphrase was saved': 'The dashboard passphrase didn\'t reach GitHub. Retry.',
  'Wait for the app on the sub-account': 'The LeadPro Connector app isn\'t on this sub-account (GitHub waited 15 minutes), or the app\'s agency token had expired. In GHL (agency view) → Marketplace → LFMP LeadPro Connector, check it\'s installed on all sub-accounts, and check the bell for token keeper issues. Then Retry.',
  'Get the firm\'s GHL token': 'GitHub couldn\'t get a GHL token for this sub-account from the app. Check the bell (token keeper), then Retry.',
  'Read the sub-account\'s pipelines and stages': 'GitHub couldn\'t read this sub-account\'s pipelines from GHL. Retry in a few minutes.',
  'Set up the dashboard': 'GitHub couldn\'t set up the dashboard files. Retry.',
  'Save the firm': 'GitHub couldn\'t save the new dashboard to the repo. Retry.',
  'First sync': 'The dashboard was created, but its first sync failed. Retry (it only runs the sync again).',
};
export function errorFor(jobs) {
  const job = (jobs || []).find(j => ['failure', 'cancelled', 'timed_out'].includes(j.conclusion));
  if (!job) return null;
  if (job.conclusion === 'cancelled') return { step: JOB_STEP[job.name] || 'start', message: 'GitHub cancelled the setup. Retry is safe: it never creates the firm twice.' };
  const st = (job.steps || []).find(s => s.conclusion === 'failure');
  return { step: JOB_STEP[job.name] || 'start', message: STEP_ERRORS[st?.name] || `The setup stopped at "${st?.name || job.name}". Retry, or open the GitHub run for details.` };
}

// A slug no firm or saved passphrase uses ("smith-law", then "smith-law-2", …).
export async function chooseSlug(name, taken) {
  const base = slugify(name) || 'firm';
  for (let n = 1; n < 50; n++) {
    const s = n === 1 ? base : `${base.slice(0, 45)}-${n}`;
    if (!RESERVED.includes(s) && !(await taken(s))) return s;
  }
  throw new Error('Couldn\'t find a free dashboard name.');
}

export class StepError extends Error { constructor(step, message, extra = {}) { super(message); Object.assign(this, { step }, extra); } }

const DONE = { app: 'The app is on the sub-account.', token: 'Made from the app; the token keeper refreshes it every hour.', setup: 'Pipelines read; stage mapping applied; dashboard saved.', sync: 'Done.' };

// deps: readIndex() → firms list · secretExists(name) · putPassphrase(key, value) · dispatchNewFirm(inputs) → t0 ·
//   listNewFirmRuns() → [{ id, display_title, status, conclusion, html_url, created_at }] · getRun(id) · getJobs(id) → { jobs } ·
//   readConfig(slug) · hasKpis(slug) · runSync(slug, say) (starts sync.yml and waits for it) ·
//   newRequestId() · sleep(ms) · pollMs · onStep(key, state, detail) · onRun(url)
export function createAppRun(deps) {
  const S = { slug: null, key: null, passSaved: false, running: null, done: null, runUrl: null };
  let cur = 'check';    // the step running now, so an unexpected error is shown on the right line
  const step = (k, st, d) => { if (st === 'run') cur = k; deps.onStep?.(k, st, d); };

  async function check(ctx, retry) {
    step('check', 'run');
    const index = await deps.readIndex();
    const same = index.find(f => f.locationId === ctx.locationId);
    if (same && !(retry && same.slug === S.slug)) throw new StepError('check', `This location already has a firm: ${same.name} (${same.slug}). Use its row in the firm list instead.`, { refused: true });
    if (!S.slug) S.slug = await chooseSlug(ctx.name, async s => index.some(f => f.slug === s) || await deps.secretExists(`PASSPHRASE_${secretKeyFor(s)}`));
    S.key = secretKeyFor(S.slug);
    step('check', 'ok', same ? `Finishing the setup of ${S.slug}.` : `Not in the list yet. Dashboard name: ${S.slug}.`);
    return same || null;
  }
  async function pass(ctx) {
    step('pass', 'run');
    if (S.passSaved && await deps.secretExists(`PASSPHRASE_${S.key}`)) { step('pass', 'ok', 'Saved earlier (kept as it is).'); return; }
    await deps.putPassphrase(S.key, ctx.passphrase);
    S.passSaved = true;
    step('pass', 'ok', `Sealed in this browser and saved as PASSPHRASE_${S.key}.`);
  }
  // Follows the new-firm.yml run for this slug: an unfinished one already running (another tab, a double click) or a new one.
  async function runWorkflow(ctx) {
    step('start', 'run');
    const prefix = `New firm ${S.slug} [`;
    let run = (await deps.listNewFirmRuns()).find(r => r.display_title?.startsWith(prefix) && r.status !== 'completed') || null;
    let title = run?.display_title, t0 = Date.now();
    if (!run) {
      const request = deps.newRequestId();
      title = `${prefix}${request}]`;
      t0 = await deps.dispatchNewFirm({ name: ctx.name, location: ctx.locationId, slug: S.slug, practice_area: ctx.practiceArea || '', timezone: ctx.timezone || 'America/New_York', snapshot_id: ctx.snapshotId || '', request });
    }
    for (;;) {
      if (!run) {
        await deps.sleep(deps.pollMs);
        run = (await deps.listNewFirmRuns()).find(r => r.display_title === title) || null;
        if (!run) { if (Date.now() - t0 > 3 * 60e3) throw new StepError('start', 'GitHub didn\'t start the setup within 3 minutes. Retry is safe.'); continue; }
      }
      S.runUrl = run.html_url; deps.onRun?.(run.html_url);
      step('start', 'ok', 'GitHub started the setup.');
      const [r2, jobs] = await Promise.all([deps.getRun(run.id), deps.getJobs(run.id)]);
      run = r2 || run;
      for (const j of jobs.jobs || []) {
        const k = JOB_STEP[j.name]; if (!k) continue;
        const st = j.status !== 'completed' ? (j.status === 'in_progress' ? 'run' : 'pending') : j.conclusion === 'success' ? 'ok' : j.conclusion === 'skipped' ? 'pending' : 'fail';
        let d = st === 'ok' ? DONE[k] : undefined;
        if (k === 'app' && st === 'run' && (j.steps || []).some(s => s.status === 'in_progress' && s.name === 'Wait for the app on the sub-account')) d = 'Waiting for the app on this sub-account (checks every 30 seconds, up to 15 minutes)…';
        if (k === 'sync' && st === 'run') d = 'Syncing (a few minutes; it may wait for a sync already running).';
        if (k === 'menu') continue;   // read from config.json at the end
        if (st !== 'fail') step(k, st, d);
      }
      if (run.status === 'completed') {
        const err = errorFor(jobs.jobs);
        if (err && err.step !== 'menu') throw new StepError(err.step, err.message);
        return;
      }
      await deps.sleep(deps.pollMs);
    }
  }
  async function finish() {
    const cfg = await deps.readConfig(S.slug);
    const menu = ['created', 'exists'].includes(cfg?.menuLink?.status) ? cfg.menuLink.status : 'manual';
    step('menu', menu === 'manual' ? 'warn' : 'ok', menu === 'created' ? '"KPI Dashboard" added to this sub-account\'s menu (opens in a new tab).' : menu === 'exists' ? 'This sub-account already had a "KPI Dashboard" link.' : 'Not added automatically. Copy the link below and add it by hand.');
    S.done = { slug: S.slug, key: S.key, review: cfg?.mappingReview?.reason || 'none', menu };
    return S.done;
  }

  const label = e => { if (e && typeof e === 'object' && !e.step) e.step = cur; throw e; };
  async function go(ctx, retry) {
    const firm = await check(ctx, retry);
    await pass(ctx);
    if (firm && firm.tokenSource === 'app') {
      // Already in the list: only the first sync (if it has no numbers yet) and the menu-link check can be missing.
      for (const k of ['start', 'app', 'token', 'setup']) step(k, 'ok', 'Done earlier.');
      if (!(await deps.hasKpis(S.slug))) {
        step('sync', 'run', 'Running the first sync again…');
        try { await deps.runSync(S.slug, d => step('sync', 'run', d)); } catch (e) { throw new StepError('sync', `The first sync failed again: ${e.message}`); }
        step('sync', 'ok', DONE.sync);
      } else step('sync', 'ok', 'Done earlier.');
    } else await runWorkflow(ctx);
    return finish();
  }

  return {
    state: S,
    // Double Create (two clicks, Enter + click) returns the same run: one dispatch, one firm.
    start(ctx) { return (S.running ||= go(ctx, false).catch(label).finally(() => { S.running = null; })); },
    retry(ctx) { return (S.running ||= go(ctx, true).catch(label).finally(() => { S.running = null; })); },
  };
}

// The mapping preset to use: firms/_presets/*.json → [{ name, snapshotId }]. The first snapshot id of a preset picks it in new-firm.yml.
export const presetChoices = presets => (presets || []).filter(p => p?.snapshots?.length).map(p => ({ name: p.name, snapshotId: p.snapshots[0].id }));
