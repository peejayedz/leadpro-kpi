// One login, v1.19 (Google sign-in only): static rules for admin/ (the browser behaviour is in tests/admin-ui).
// - admin/lfmp-session.js is the shared copy (byte-identical with the Builder's page/ and the Review admin's admin/ when
//   those repos sit next to this one), and the old password login is gone (no lfmp-login.js, lfmp-lock.json,
//   set-shared-password.mjs, no password or token screen, no direct api.github.com call, no remembered-passphrase blob).
// Run: node tests/one-login/run.mjs   (Node 20+, no install)
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let pass = 0, fail = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log(`✓ ${name}`); } catch (e) { fail++; console.log(`✗ ${name}\n    ${e.message}`); } };
const ok = (v, m) => { if (!v) throw new Error(m); };
const exists = p => access(p).then(() => true, () => false);

const html = await readFile(join(ROOT, 'admin/index.html'), 'utf8');
const session = await readFile(join(ROOT, 'admin/lfmp-session.js'), 'utf8');

await t('the password login is gone: no lfmp-login.js, lfmp-lock.json or set-shared-password.mjs', async () => {
  for (const f of ['admin/lfmp-login.js', 'admin/lfmp-lock.json', 'scripts/set-shared-password.mjs']) ok(!(await exists(join(ROOT, f))), `${f} still there`);
  ok(await exists(join(ROOT, 'admin/lfmp-login.css')), 'admin/lfmp-login.css is still needed by admin/moved.html');
});

await t('admin/index.html: signs in with lfmp-session.js; no password, token screen, vault or direct GitHub call', () => {
  ok(/from '\.\/lfmp-session\.js'/.test(html), 'does not import lfmp-session.js');
  for (const [what, re] of [['lfmp-login', /lfmp-login\.js|createLogin/], ['token screen', /id="tokenView"|id="tokenIn"|Connect GitHub/], ['vault', /vaultSet|lfmp-vault|leadpro-admin-firm-pass|PASS_VAULT/],
    ['GitHub from the browser', /https:\/\/api\.github\.com/], ['the old token variable', /\bghToken\b/], ['Lock / Forget token', /data-act="lock"|data-act="forget"|Forget token/]])
    ok(!re.test(html), `still has: ${what}`);
  // v2 (redesign): the top bar, with the name and Sign out, is the shared shell's (lfmp-session.js mountShell)
  ok(/mountShell\(\{[\s\S]*?tool: 'kpi'/.test(html) && /data-lv="signout"/.test(session) && /class="lv-n" data-me>/.test(session), 'no Sign out or name in the top bar (mountShell)');
});

await t('lfmp-session.js: /api/ only, no secrets, wipes the old browser keys', () => {
  ok(/const API_BASE = '\/api\/'/.test(session), 'API base is not /api/');
  ok(!/fetch\(\s*['`"]https?:|Authorization|github_pat/.test(session), 'session module talks to GitHub');
  // the only thing it saves is the theme choice (v2 shell: Me → Theme), never a key or a token
  ok([...session.matchAll(/localStorage\.setItem\(([^,]+),/g)].every(m => m[1].trim() === "'lfmp-theme'"), 'session module stores something other than the theme');
  for (const k of ['lfmp-vault', 'ar_admin_key', 'leadpro-admin-firm-pass', 'lfmp-session']) ok(session.includes(`'${k}'`), `does not wipe ${k}`);
});

await t('the shared copies are byte-identical (when the sibling repos are here)', async () => {
  const others = ['../ghl-subaccount-builder/page/lfmp-session.js', '../automation-review/admin/lfmp-session.js'].map(p => join(ROOT, p));
  let compared = 0;
  for (const p of others) if (await exists(p)) { ok((await readFile(p, 'utf8')) === session, `${p} differs`); compared++; }
  console.log(`    (compared with ${compared} sibling cop${compared === 1 ? 'y' : 'ies'})`);
});

console.log(fail ? `\n${fail} failed, ${pass} passed` : `\nAll ${pass} one-login checks passed`);
process.exitCode = fail ? 1 : 0;
