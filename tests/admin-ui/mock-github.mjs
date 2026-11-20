// A mock GitHub API for the admin page (tests/admin-ui/run.mjs). Reads the repo's files from disk (read-only) and keeps every
// write (commits, secrets, workflow runs) in memory. Timestamps in kpis.json / status files are moved to "a few minutes ago"
// so the page looks like a healthy live repo. Nothing here touches GitHub or the working tree.
import { readFile, readdir, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
// GitHub object ids are 40 hex characters (the team site's server only accepts those).
const hex = label => createHash('sha1').update(String(label)).digest('hex');

export function createMockGitHub({ root, owner = 'peejayedz', repo = 'leadpro-kpi', stepMs = 600 }) {
  const P = `/repos/${owner}/${repo}`;
  const M = {
    scenario: 'ok',              // new-firm.yml: 'ok' | 'app-missing'
    overlay: new Map(),          // path -> content (string) | null (deleted)
    secrets: new Map([['GHL_TOKEN_MAHDAVI', '(set)'], ['PASSPHRASE_MAHDAVI', '(set)'], ['GHL_TOKEN_LFMP', '(set)'], ['PASSPHRASE_LFMP', '(set)'], ['GHL_TOKEN_ZZ_TEST_2', '(set)'], ['PASSPHRASE_ZZ_TEST_2', '(set)']]),
    secretPuts: [], secretDeletes: [], dispatches: [], commits: [], runs: [], blobs: new Map(), trees: new Map(), head: hex('c0'),
    calls: [],
  };
  // The repo's latest sync (from its status file), moved to "12 minutes ago" so syncs on disk look fresh whatever their date.
  const REF_TIME = (() => { try { return Date.parse(JSON.parse(readFileSync(join(root, 'status/sync-status.json'), 'utf8')).lastAnySuccessAt) || Date.parse('2026-11-14T16:40:00Z'); } catch { return Date.parse('2026-11-14T16:40:00Z'); } })();
  const shift = () => Date.now() - 12 * 60e3 - REF_TIME;   // the latest sync was 12 minutes ago
  const freshen = (path, text) => (/^firms\/[^/]+\/data\/kpis\.json$|^status\/.*\.json$|^firms\/[^/]+\/discovery\.json$/.test(path)
    ? text.replace(/"(20\d\d-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)"/g, (_, iso) => `"${new Date(Date.parse(iso) + shift()).toISOString()}"`) : text);

  async function fileText(path) {
    if (M.overlay.has(path)) return M.overlay.get(path);
    try { return freshen(path, await readFile(join(root, path), 'utf8')); } catch { return null; }
  }
  async function allFiles(dir = '') {
    const out = [];
    for (const e of await readdir(join(root, dir), { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = dir ? `${dir}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...await allFiles(p)); else out.push(p);
    }
    return out;
  }
  const b64 = s => Buffer.from(s, 'utf8').toString('base64');
  const run = (workflow, inputs, title) => {
    const r = { id: 1000 + M.runs.length, workflow, inputs, display_title: title, status: 'queued', conclusion: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), html_url: `https://github.com/${owner}/${repo}/actions/runs/${1000 + M.runs.length}`, t0: Date.now(), event: 'workflow_dispatch', jobs: [] };
    M.runs.push(r); return r;
  };
  const JOBS = ['prepare', 'token', 'setup', 'first-sync', 'menu-link'];
  async function advance(r) {
    if (r.status === 'completed') return;
    const n = Math.floor((Date.now() - r.t0) / stepMs);
    if (n < 1) return;
    r.status = 'in_progress'; r.updated_at = new Date().toISOString();
    const finish = conclusion => { r.status = 'completed'; r.conclusion = conclusion; r.updated_at = new Date().toISOString(); };
    if (r.workflow === 'sync.yml') {
      if (n < 3) return;
      const slug = r.inputs.slug;
      const k = JSON.parse(await fileText(`firms/${slug}/data/kpis.json`) || 'null') || { periods: { last90: { current: { totalLeads: 0 } }, last30: { current: { notInPipeline: 0 } } } };
      k.generatedAt = new Date().toISOString();
      M.overlay.set(`firms/${slug}/data/kpis.json`, JSON.stringify(k, null, 2) + '\n');
      return finish('success');
    }
    if (r.workflow === 'menu-link.yml') {   // v1.28.0: the menu link is added, the Draft goes live
      if (n < 3) return;
      const slug = r.inputs.slug, idx = JSON.parse(await fileText('firms/index.json')), row = idx.find(f => f.slug === slug);
      if (!row || row.status !== 'draft') return finish('failure');
      if (M.menuFail) {   // v1.32.1: GHL refuses the link → the run saves why (status/menu-link-<slug>.json) and fails at Go live
        M.overlay.set(`status/menu-link-${slug}.json`, JSON.stringify({ slug, request: r.inputs.request, at: new Date().toISOString(), result: 'failed', code: 'failed:422', reason: M.menuFail }, null, 2) + '\n');
        return finish('failure');
      }
      delete row.status; M.overlay.set('firms/index.json', JSON.stringify(idx, null, 2) + '\n');
      const c = JSON.parse(await fileText(`firms/${slug}/config.json`)); c.menuLink = { status: 'created', at: new Date().toISOString(), id: M.menuId ?? '86cac337-1c2d-4e5f-8a9b-0c1d2e3f4a5b' };   // v1.30.0: id kept
      M.overlay.set(`firms/${slug}/config.json`, JSON.stringify(c, null, 2) + '\n');
      return finish('success');
    }
    if (r.workflow === 'menu-css.yml') {   // v1.30.0: GET of the link (mock), its id kept in config.json; M.menuCss = 'none' → nothing found
      if (n < 3) return;
      const slug = r.inputs.slug;
      if (M.menuCss === 'none') return finish('failure');
      const c = JSON.parse(await fileText(`firms/${slug}/config.json`)); c.menuLink = { ...(c.menuLink || {}), id: 'b7cc0202-aaaa-bbbb-cccc-000000000001', idReadAt: new Date().toISOString() };
      M.overlay.set(`firms/${slug}/config.json`, JSON.stringify(c, null, 2) + '\n');
      return finish('success');
    }
    if (r.workflow === 'remove-firm.yml') {   // v1.28.0: firm files + list row gone (mock only; never against a real repo)
      if (n < 3) return;
      const slug = r.inputs.slug, idx = JSON.parse(await fileText('firms/index.json'));
      if (!idx.some(f => f.slug === slug)) return finish('failure');
      M.overlay.set('firms/index.json', JSON.stringify(idx.filter(f => f.slug !== slug), null, 2) + '\n');
      for (const p of ['config.json', 'discovery.json', 'index.html', 'data/kpis.json', 'data/details.enc.json']) M.overlay.set(`firms/${slug}/${p}`, null);
      M.removed = [...(M.removed || []), slug];
      return finish('success');
    }
    if (r.workflow === 'discover.yml') {
      if (n < 3) return;
      const p = `firms/${r.inputs.slug}/discovery.json`, d = JSON.parse(await fileText(p));
      d.generatedAt = new Date().toISOString(); M.overlay.set(p, JSON.stringify(d, null, 2) + '\n');
      return finish('success');
    }
    if (r.workflow === 'new-firm.yml') {
      const steps = name => (name === 'prepare' ? [{ name: 'Check the firm list', status: 'completed', conclusion: 'success' }, { name: 'Wait for the app on the sub-account', status: n >= 2 ? 'completed' : 'in_progress', conclusion: n >= 2 ? 'success' : null }] : []);
      r.jobs = JOBS.map((name, i) => ({ name, status: i + 1 < n ? 'completed' : i + 1 === n ? 'in_progress' : 'queued', conclusion: i + 1 < n ? 'success' : null, steps: steps(name) }));
      if (M.scenario === 'app-missing' && n >= 2) {
        r.jobs[0] = { name: 'prepare', status: 'completed', conclusion: 'failure', steps: [{ name: 'Check the firm list', conclusion: 'success' }, { name: 'Wait for the app on the sub-account', conclusion: 'failure' }] };
        for (let i = 1; i < JOBS.length; i++) r.jobs[i] = { name: JOBS[i], status: 'completed', conclusion: 'skipped', steps: [] };
        return finish('failure');
      }
      const { slug, location, name, practice_area: area } = r.inputs;
      // v1.28.0: a Medical & dental / Other firm stops at "Needs mapping" (first sync and menu link skipped), as new-firm.yml does
      if (['medical', 'other'].includes(r.inputs.practice_type) && n >= 4) {
        const idx = JSON.parse(await fileText('firms/index.json'));
        if (!idx.some(f => f.locationId === location)) {
          idx.push({ slug, secretKey: slug.toUpperCase().replace(/-/g, '_'), name, practiceArea: area, locationId: location, createdAt: new Date().toISOString(), tokenSource: 'app', createdBy: 'builder', practiceType: r.inputs.practice_type, status: 'needsMapping' });
          M.overlay.set('firms/index.json', JSON.stringify(idx, null, 2) + '\n');
          const tpl = JSON.parse(await fileText('firms/_template/config.json'));
          Object.assign(tpl, { locationName: name, practiceArea: area, locationId: location, title: '', practiceType: r.inputs.practice_type, countsOnly: r.inputs.counts_only !== 'no', pipelineMap: { pipelines: [], stages: {} } });
          M.overlay.set(`firms/${slug}/config.json`, JSON.stringify(tpl, null, 2) + '\n');
          M.overlay.set(`firms/${slug}/discovery.json`, M.careDiscovery || await fileText('firms/zz-test-2/discovery.json'));
        }
        r.jobs = JOBS.map(name => ({ name, status: 'completed', conclusion: ['first-sync', 'menu-link'].includes(name) ? 'skipped' : 'success', steps: steps(name) }));
        return finish('success');
      }
      if (n >= 4) {
        const idx = JSON.parse(await fileText('firms/index.json'));
        if (!idx.some(f => f.locationId === location)) {
          idx.push({ slug, secretKey: slug.toUpperCase().replace(/-/g, '_'), name, practiceArea: area, locationId: location, createdAt: new Date().toISOString(), tokenSource: 'app', createdBy: 'builder', status: 'draft' });
          M.overlay.set('firms/index.json', JSON.stringify(idx, null, 2) + '\n');
          const tpl = JSON.parse(await fileText('firms/_template/config.json'));
          Object.assign(tpl, { locationName: name, practiceArea: area, locationId: location, title: '' });
          if (!r.inputs.snapshot_id) tpl.mappingReview = { reason: 'unknown-snapshot', at: new Date().toISOString() };
          M.overlay.set(`firms/${slug}/config.json`, JSON.stringify(tpl, null, 2) + '\n');
          M.overlay.set(`firms/${slug}/discovery.json`, await fileText('firms/zz-test-2/discovery.json'));
        }
      }
      if (n >= 6) {
        M.overlay.set(`firms/${slug}/data/kpis.json`, JSON.stringify({ generatedAt: new Date().toISOString(), periods: { last90: { current: { totalLeads: 0 } }, last30: { current: { notInPipeline: 0 } } } }) + '\n');
        r.jobs.forEach(j => Object.assign(j, { status: 'completed', conclusion: j.name === 'menu-link' ? 'skipped' : 'success' }));   // v1.28.0: Draft, menu link skipped
        return finish('success');
      }
      return;
    }
    if (n >= 2) finish('success');
  }

  // (method, url, bodyText) -> { status, json }
  async function handle(method, url, bodyText) {
    const u = new URL(url), path = u.pathname, q = u.searchParams;
    const body = bodyText ? JSON.parse(bodyText) : null;
    M.calls.push(`${method} ${path}`);
    const ok = json => ({ status: 200, json });
    if (!path.startsWith(P)) return { status: 404, json: { message: 'Not Found' } };
    const p = path.slice(P.length);
    if (p === '' && method === 'GET') return ok({ full_name: `${owner}/${repo}` });
    if (p === '/actions/secrets/public-key') return ok({ key: Buffer.alloc(32, 7).toString('base64'), key_id: 'kid1' });
    let m;
    if ((m = /^\/actions\/secrets\/([A-Z0-9_]+)$/.exec(p))) {
      if (method === 'GET') return M.secrets.has(m[1]) ? ok({ name: m[1] }) : { status: 404, json: { message: 'Not Found' } };
      if (method === 'PUT') { M.secrets.set(m[1], body.encrypted_value); M.secretPuts.push({ name: m[1], value: body.encrypted_value }); return { status: 201, json: null }; }
      if (method === 'DELETE') { M.secrets.delete(m[1]); M.secretDeletes.push(m[1]); return { status: 204, json: null }; }
    }
    if (p === '/actions/workflows' && method === 'GET') return ok({ workflows: [] });
    if ((m = /^\/actions\/variables\/(\w+)$/.exec(p))) return ok({ name: m[1], value: 'on' });
    if ((m = /^\/actions\/workflows\/([\w.-]+)\/dispatches$/.exec(p)) && method === 'POST') {
      const wf = m[1], i = body.inputs || {};
      M.dispatches.push({ workflow: wf, inputs: i });
      const title = wf === 'sync.yml' ? (i.slug ? `Sync ${i.slug}` : 'Sync all firms') : wf === 'discover.yml' ? `Discover ${i.slug}` : wf === 'new-firm.yml' ? `New firm ${i.slug} [${i.request}]` : wf === 'menu-link.yml' ? `Menu link ${i.slug} [${i.request}]` : wf === 'remove-firm.yml' ? `Remove firm ${i.slug} [${i.request}]` : wf === 'menu-css.yml' ? `Menu CSS ${i.slug} [${i.request}]` : wf;
      run(wf, i, title);
      return { status: 204, json: null };
    }
    if ((m = /^\/actions\/workflows\/([\w.-]+)\/runs$/.exec(p))) {
      const list = M.runs.filter(r => r.workflow === m[1]);
      for (const r of list) await advance(r);
      return ok({ workflow_runs: list.slice().reverse().map(({ jobs, t0, inputs, workflow, ...r }) => r) });
    }
    if ((m = /^\/actions\/runs\/(\d+)$/.exec(p))) { const r = M.runs.find(x => x.id === Number(m[1])); await advance(r); const { jobs, t0, inputs, workflow, ...rest } = r; return ok(rest); }
    if ((m = /^\/actions\/runs\/(\d+)\/cancel$/.exec(p)) && method === 'POST') {   // v1.28.0: Stop setup
      const r = M.runs.find(x => x.id === Number(m[1])); if (!r) return { status: 404, json: { message: 'Not Found' } };
      M.cancels = [...(M.cancels || []), r.id];
      if (r.status !== 'completed') { r.status = 'completed'; r.conclusion = 'cancelled'; r.updated_at = new Date().toISOString(); r.jobs = (r.jobs || []).map(j => (j.status === 'completed' ? j : { ...j, status: 'completed', conclusion: 'cancelled' })); }
      return { status: 202, json: {} };
    }
    if ((m = /^\/actions\/runs\/(\d+)\/jobs$/.exec(p))) { const r = M.runs.find(x => x.id === Number(m[1])); await advance(r); return ok({ jobs: structuredClone(r.jobs) }); }
    if ((m = /^\/contents\/(.+)$/.exec(p)) && method === 'GET') {
      const fp = decodeURIComponent(m[1]);
      const t = await fileText(fp);
      if (t !== null) return ok({ type: 'file', path: fp, sha: hex(`sha-${fp}`), content: b64(t), encoding: 'base64' });
      try {
        if ((await stat(join(root, fp))).isDirectory()) return ok((await readdir(join(root, fp))).map(n => ({ type: 'file', name: n, path: `${fp}/${n}` })));
      } catch {}
      return { status: 404, json: { message: 'Not Found' } };
    }
    if (p === `/git/ref/heads/main`) return ok({ object: { sha: M.head } });
    if ((m = /^\/git\/commits\/(\w+)$/.exec(p)) && method === 'GET') return ok({ sha: m[1], tree: { sha: hex(`t-${m[1]}`) } });
    if (p === '/git/blobs' && method === 'POST') { const sha = hex(`b${M.blobs.size}`); M.blobs.set(sha, body.content); return { status: 201, json: { sha } }; }
    if (p === '/git/trees' && method === 'POST') { const sha = hex(`t${M.trees.size}x`); M.trees.set(sha, body.tree); return { status: 201, json: { sha } }; }
    if ((m = /^\/git\/trees\/([\w-]+)$/.exec(p)) && method === 'GET') {
      const files = new Set(await allFiles());
      for (const [k, v] of M.overlay) v === null ? files.delete(k) : files.add(k);
      return ok({ tree: [...files].map(f => ({ path: f, type: 'blob' })) });
    }
    if (p === '/git/commits' && method === 'POST') { const sha = hex(`c${M.commits.length + 1}`); M.commits.push({ sha, message: body.message, tree: body.tree, files: [] }); return { status: 201, json: { sha } }; }
    if (p === '/git/refs/heads/main' && method === 'PATCH') {
      const c = M.commits.find(x => x.sha === body.sha);
      for (const e of M.trees.get(c.tree)) { const content = e.sha === null ? null : M.blobs.get(e.sha); M.overlay.set(e.path, content); c.files.push({ path: e.path, content }); }
      M.head = c.sha; return ok({ object: { sha: c.sha } });
    }
    return { status: 404, json: { message: `mock: no route for ${method} ${p}` } };
  }
  return { M, handle, fileText };
}
