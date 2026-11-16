// LFMP one login: one admin password for the Sub-account Builder, the KPI admin and the Automation Review admin.
// Keep the three copies byte-identical: ghl-subaccount-builder page/, leadpro-kpi admin/, automation-review admin/
// (with lfmp-login.css next to it). All three pages live on the same site, so they share browser storage.
//
// How it works
// - lfmp-lock.json (next to this file, the same file in all three places) holds { salt, iterations, verifier }.
//   PBKDF2-SHA256(password, salt, iterations) -> 64 bytes: 0-31 = the public check value, 32-63 = the AES-GCM key.
//   The password itself is never stored anywhere. `node scripts/set-shared-password.mjs` (leadpro-kpi) writes the file.
// - The vault (localStorage "lfmp-vault") is one AES-GCM blob sealed with that key: the GitHub token ("gh") and the
//   Automation Review admin key ("reviewKey"). Client-facing pages never load this file and never read the vault.
// - Unlocking keeps the key (never the password) in sessionStorage "lfmp-session" for this tab / app window. Moving
//   between the three tools in the same tab never asks again. It ends on Lock (any tool), after 30 minutes without
//   activity, or when the tab closes. Lock also writes "lfmp-lock-at", which ends sessions in every other tab.
// - Wrong-password limit: 5 wrong in a row locks sign-in for 2 minutes in every tool and tab ("lfmp-login-guard":
//   a count and an end time only, never a password or hash). A speed bump in the browser, not the real protection.
// - No lfmp-lock.json (404) -> start() returns 'error' with a plain message (the per-page locks were removed on 15 Nov 2026).

export const LOCK_FILE = './lfmp-lock.json';
export const KEYS = { session: 'lfmp-session', vault: 'lfmp-vault', lockAt: 'lfmp-lock-at', guard: 'lfmp-login-guard' };
export const IDLE_MS = 30 * 60e3;
export const MAX_TRIES = 5;
export const COOLDOWN_MS = 2 * 60e3;
// Removed on every lock (manual, idle, other tab): the Automation Review page's own admin key copy.
const CLEAR_ON_LOCK = ['ar_admin_key'];
// Removed on a manual Lock only (PJ's v1.13.1 decision: the idle lock keeps remembered dashboard passphrases).
const CLEAR_ON_MANUAL_LOCK = ['leadpro-admin-firm-pass'];
// Left over from the per-page locks (sealed with the old page passwords, so useless now). Removed after every sign-in.
const LEGACY_KEYS = ['sab-gh-token', 'leadpro-admin-gh-token'];
const LEGACY_SESSION = 'leadpro-admin-session';
export const TOOLS = [
  { id: 'builder', name: 'Builder', path: '/ghl-subaccount-builder-page/' },
  { id: 'kpi', name: 'Scorecards', path: '/leadpro-kpi/admin/' },
  { id: 'review', name: 'Review', path: '/automation-review/admin/' },
];

const enc = new TextEncoder(), dec = new TextDecoder();
const toB64 = u8 => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
const fromB64 = b => Uint8Array.from(atob(String(b).replace(/\s/g, '')), c => c.charCodeAt(0));
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};
const ss = {
  get() { try { return JSON.parse(sessionStorage.getItem(KEYS.session)); } catch { return null; } },
  set(v) { try { v ? sessionStorage.setItem(KEYS.session, JSON.stringify(v)) : sessionStorage.removeItem(KEYS.session); } catch {} },
};

// ---------- pure helpers (unit-tested) ----------
export function readGuard(raw) {
  try { const g = JSON.parse(raw); return { f: Math.max(0, Number(g?.f) || 0), u: Math.max(0, Number(g?.u) || 0) }; } catch { return { f: 0, u: 0 }; }
}
export const blockedFor = (g, now) => (g.u > now ? g.u - now : 0);
// One more wrong password. The 5th in a row starts the 2-minute pause and the count starts again after it.
export function addFail(g, now) {
  const cur = g.u && g.u <= now ? { f: 0, u: 0 } : { ...g };
  cur.f += 1;
  return cur.f >= MAX_TRIES ? { f: 0, u: now + COOLDOWN_MS } : cur;
}
export function fmtCountdown(ms) { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
// A session is good when it's ours (same lock file), still active, and no Lock happened after it started.
export function sessionOk(s, { now, lockAt, lockId }) {
  return !!(s && s.v === 1 && typeof s.k === 'string' && s.id === lockId && now - s.t <= IDLE_MS && now - s.t >= -60e3 && !(lockAt > s.s));
}
export const lockIdOf = lock => String(lock?.verifier || '').slice(0, 16);
export function validLock(l) { return !!(l && typeof l.salt === 'string' && typeof l.verifier === 'string' && Number(l.iterations) >= 100000); }

// ---------- crypto ----------
async function derive(pw, lock) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64(lock.salt), iterations: Number(lock.iterations) }, base, 512));
  const verifier = bits.slice(0, 32), raw = bits.slice(32, 64);
  bits.fill(0);
  return { verifier, raw };
}
const importKey = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
function sameBytes(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
export async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj))));
  return JSON.stringify({ v: 1, alg: 'AES-GCM', iv: toB64(iv), ct: toB64(ct) });
}
export async function open(key, raw) {
  const { iv, ct } = JSON.parse(raw);
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ct))));
}

// ---------- the sign-in screen ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function screenHtml(tool) {
  return `<div class="lg" data-tool="${esc(tool)}">
  <aside class="lg-side">
    <div class="lg-brand"><span class="lg-mark" aria-hidden="true">LFMP</span><div><b>LFMP Builder</b><span>Law Firm Marketing Pros · internal</span></div></div>
    <div class="lg-hero">
      <p class="lg-ey">One login · three tools</p>
      <h1 class="lg-h">Every client. <span>One place.</span></h1>
      <p class="lg-sub">Create sub-accounts, run KPI scorecards and client automation reviews from one app.</p>
      <ul class="lg-chips" aria-label="Tools this login opens">${TOOLS.map(t => `<li class="t-${t.id}"${t.id === tool ? ' aria-current="true"' : ''}>${esc(t.name)}</li>`).join('')}</ul>
      <div class="lg-blocks" aria-hidden="true"><i></i><i></i><i></i></div>
    </div>
    <p class="lg-foot">Law Firm Marketing Pros</p>
  </aside>
  <main class="lg-main">
    <div class="lg-card">
      <form class="lg-form" id="lgForm" autocomplete="on" novalidate>
        <h2 class="lg-title">Sign in.</h2>
        <p class="lg-lead">Enter your admin password to unlock the Builder, Scorecards and Review.</p>
        <!-- Sign-in method. Later: swap this block for "Continue with Google" (Cloudflare Access). -->
        <div class="lg-method" data-method="password">
          <input type="text" name="username" value="lfmp-admin" autocomplete="username" hidden>
          <label class="lg-lbl" for="lgPw">Admin password</label>
          <div class="lg-pw"><input type="password" id="lgPw" name="password" autocomplete="current-password" spellcheck="false" required><button type="button" id="lgShow" aria-controls="lgPw" aria-pressed="false">Show</button></div>
          <p class="lg-err" id="lgErr" role="alert" aria-live="assertive"></p>
          <div class="lg-row"><button class="lg-go" id="lgGo" type="submit">Unlock <span aria-hidden="true">→</span></button><button class="lg-link" id="lgForgot" type="button">Forgot password?</button></div>
        </div>
        <p class="lg-note">Stays unlocked in this window for 30 minutes of activity. Lock on any tool locks all three.</p>
      </form>
      <section class="lg-help" id="lgHelp" aria-labelledby="lgHelpTitle" hidden>
        <h2 class="lg-title" id="lgHelpTitle" tabindex="-1">Forgot password?</h2>
        <p class="lg-lead">The password is never stored anywhere (only a check value), so it can't be emailed or reset with a link.</p>
        <ol class="lg-steps">
          <li><b>Check your password manager.</b> Look for the saved login “lfmp-admin” on lfmp-admin.pages.dev (older saves may be under dashboard.lawfirmmarketingpros.com or peejayedz.github.io).</li>
          <li><b>To set a new password,</b> open Terminal in the leadpro-kpi folder and run <code>node scripts/set-shared-password.mjs</code> (your typing stays hidden). Then publish the new lfmp-lock.json with the three tools.</li>
          <li><b>Sign in with the new password,</b> then reconnect GitHub (paste the token from your password manager) and re-add the Automation Review admin key on the Review page.</li>
        </ol>
        <button class="lg-link" id="lgBack" type="button">← Back to sign in</button>
      </section>
    </div>
    <p class="lg-legal">Law Firm Marketing Pros · Team members only</p>
  </main>
</div>`;
}

// ---------- the login controller ----------
// createLogin({ tool: 'builder' | 'kpi' | 'review', onUnlock({ vault, resumed, reset }), onLock(why), mount })
export function createLogin({ tool, onUnlock, onLock, mount } = {}) {
  let lockFile = null, key = null, vaultCache = null, root = null, lastTouch = 0, tick = null, busy = false, gen = 0;   // gen: +1 on every lock
  const $ = id => root?.querySelector('#' + id);
  const lockId = () => lockIdOf(lockFile);
  const lockAt = () => Number(ls.get(KEYS.lockAt)) || 0;
  const guard = () => readGuard(ls.get(KEYS.guard));

  function build() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'lfmpLogin'; root.hidden = true;
    root.innerHTML = screenHtml(tool);
    (mount || document.body).prepend(root);
    $('lgShow').addEventListener('click', () => {
      const pw = $('lgPw'), shown = pw.type === 'text';
      pw.type = shown ? 'password' : 'text';
      $('lgShow').textContent = shown ? 'Show' : 'Hide'; $('lgShow').setAttribute('aria-pressed', String(!shown));
      pw.focus();
    });
    $('lgForgot').addEventListener('click', () => { $('lgForm').hidden = true; $('lgHelp').hidden = false; $('lgHelpTitle').focus(); });
    $('lgBack').addEventListener('click', () => { $('lgHelp').hidden = true; $('lgForm').hidden = false; $('lgPw').focus(); });
    $('lgForm').addEventListener('submit', e => { e.preventDefault(); submit(); });
  }

  function paintGuard() {
    const left = blockedFor(guard(), Date.now());
    const pw = $('lgPw'), go = $('lgGo'), err = $('lgErr');
    if (!pw) return left;
    if (left) {
      pw.disabled = true; go.disabled = true; err.dataset.kind = 'wait';
      err.textContent = `Too many tries. Try again in ${fmtCountdown(left)}`;
      if (!tick) tick = setInterval(paintGuard, 250);
    } else {
      if (tick) { clearInterval(tick); tick = null; }
      if (err.dataset.kind === 'wait') { err.textContent = 'You can try again now.'; err.dataset.kind = ''; }
      if (!busy) { pw.disabled = false; go.disabled = false; }
    }
    return left;
  }

  function showLogin(why) {
    build();
    root.hidden = false; $('lgHelp').hidden = true; $('lgForm').hidden = false;
    $('lgPw').value = ''; $('lgPw').type = 'password'; $('lgShow').textContent = 'Show'; $('lgShow').setAttribute('aria-pressed', 'false');
    const err = $('lgErr'); err.dataset.kind = why ? 'info' : ''; err.textContent = why || '';
    if (!paintGuard()) $('lgPw').focus();
  }
  function hideLogin() { if (root) { root.hidden = true; $('lgPw').value = ''; } if (tick) { clearInterval(tick); tick = null; } }

  async function readVault() {
    if (!key) throw new Error('Locked');
    if (vaultCache) return { ...vaultCache };
    const raw = ls.get(KEYS.vault);
    let v = {}, reset = false;
    if (raw) { try { v = await open(key, raw); if (!v || typeof v !== 'object') v = {}; } catch { v = {}; reset = true; ls.set(KEYS.vault, null); } }
    vaultCache = v;
    return reset ? { ...v, __reset: true } : { ...v };
  }

  async function finishUnlock(resumed) {
    hideLogin();
    for (const k of LEGACY_KEYS) ls.set(k, null);
    try { sessionStorage.removeItem(LEGACY_SESSION); } catch {}
    const v = await readVault();
    const reset = !!v.__reset; delete v.__reset;
    await onUnlock?.({ vault: v, resumed, reset });
  }

  async function submit() {
    if (busy || paintGuard()) return;
    const pw = $('lgPw').value;
    const err = $('lgErr');
    if (!pw) { err.dataset.kind = ''; err.textContent = 'Enter the admin password.'; $('lgPw').focus(); return; }
    const g0 = gen;
    busy = true; $('lgGo').disabled = true; $('lgPw').disabled = true; $('lgGo').firstChild.textContent = 'Checking… ';
    err.dataset.kind = ''; err.textContent = '';
    try {
      const { verifier, raw } = await derive(pw, lockFile);
      if (!sameBytes(verifier, fromB64(lockFile.verifier))) {
        raw.fill(0);
        const g = addFail(guard(), Date.now()); ls.set(KEYS.guard, JSON.stringify(g));
        if (!blockedFor(g, Date.now())) {
          const left = MAX_TRIES - g.f;
          err.textContent = `That password didn't work. Check caps lock and try again.${left <= 2 ? ` ${left} ${left === 1 ? 'try' : 'tries'} left before a 2-minute pause.` : ''}`;
        }
        return;
      }
      ls.set(KEYS.guard, null);
      key = await importKey(raw); vaultCache = null;
      const now = Date.now();
      ss.set({ v: 1, k: toB64(raw), t: now, s: Math.max(now, lockAt() + 1), id: lockId() });
      raw.fill(0);
      await finishUnlock(false);
    } catch (e) {
      console.error(e);   // no secrets in here: the password and key are never part of an error
      // Locked again while the page was still opening (e.g. Lock pressed during loading): keep the lock message.
      if (gen === g0) err.textContent = `Couldn't unlock: ${e.message}`;
    } finally {
      busy = false;
      if ($('lgGo')) { $('lgGo').firstChild.textContent = 'Unlock '; }
      if (root && !root.hidden) { if (!paintGuard()) { $('lgPw').select(); } }
      else if ($('lgGo')) { $('lgGo').disabled = false; $('lgPw').disabled = false; }
    }
  }

  async function resume() {
    const s = ss.get();
    if (!sessionOk(s, { now: Date.now(), lockAt: lockAt(), lockId: lockId() })) { if (s) ss.set(null); return false; }
    try {
      key = await importKey(fromB64(s.k)); vaultCache = null;
      s.t = Date.now(); ss.set(s); lastTouch = s.t;
      const g0 = gen;
      try { await finishUnlock(true); } catch (e) { console.error(e); if (gen === g0) throw e; }
      return true;
    } catch { if (key) { key = null; ss.set(null); } return false; }
  }

  // Lock. manual = Lock pressed (also clears remembered dashboard passphrases); broadcast = lock every tab too.
  function lock(why, { manual = true, broadcast = true } = {}) {
    gen++; ss.set(null); key = null; vaultCache = null;
    if (broadcast) ls.set(KEYS.lockAt, String(Date.now()));
    for (const k of CLEAR_ON_LOCK) ls.set(k, null);
    if (manual) for (const k of CLEAR_ON_MANUAL_LOCK) ls.set(k, null);
    try { onLock?.(typeof why === 'string' ? why : ''); } finally { showLogin(typeof why === 'string' ? why : ''); }
  }
  const idleLock = () => lock('Locked after 30 minutes without activity.', { manual: false, broadcast: false });

  // Every interaction checks the session (so an expired one locks on the next click); the time is written at most every 20 s.
  function touch() {
    if (!key) return;
    const now = Date.now(), s = ss.get();
    if (!sessionOk(s, { now, lockAt: lockAt(), lockId: lockId() })) return check();
    if (now - lastTouch < 20e3) return;
    lastTouch = now; s.t = now; ss.set(s);
  }
  function check() {
    if (!key) return;
    const s = ss.get();
    if (sessionOk(s, { now: Date.now(), lockAt: lockAt(), lockId: lockId() })) return;
    if (s && lockAt() > s.s) return lock('Locked from another tab.', { manual: false, broadcast: false });
    idleLock();
  }

  const api = {
    mode: null,
    // 'shared' (one login on) | 'error' (no lfmp-lock.json, an old browser, or a bad file: message in .error)
    async start() {
      if (!window.crypto?.subtle) { api.mode = 'error'; api.error = "This browser can't run the admin tools. Use an up-to-date Chrome, Safari, Edge or Firefox."; return api.mode; }
      try {
        const r = await fetch(`${LOCK_FILE}?t=${Date.now()}`, { cache: 'no-store' });
        if (r.status === 404) { api.mode = 'error'; api.error = "The shared admin password isn't set up here (lfmp-lock.json is missing). Run node scripts/set-shared-password.mjs in the leadpro-kpi folder, then publish the three tools."; return api.mode; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const l = await r.json();
        if (!validLock(l)) throw new Error('lfmp-lock.json is incomplete');
        lockFile = l;
      } catch (e) { api.mode = 'error'; api.error = `Couldn't read lfmp-lock.json (${e.message}).`; return api.mode; }
      api.mode = 'shared';
      build();
      ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, touch, { passive: true, capture: true }));
      setInterval(check, 15e3);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
      addEventListener('pageshow', check);
      addEventListener('storage', e => {
        if (e.key === KEYS.lockAt && key) lock('Locked from another tab.', { manual: false, broadcast: false });
        else if (e.key === KEYS.guard && root && !root.hidden) paintGuard();
        else if (e.key === KEYS.vault) vaultCache = null;
      });
      if (!(await resume())) showLogin();
      return api.mode;
    },
    lock,
    showLogin,
    unlocked: () => !!key,
    key: () => key,
    vault: readVault,
    // Merge into the vault; a null value removes that entry. A new or forgotten GitHub token drops the old per-page tokens.
    async vaultSet(patch) {
      const v = await readVault(); delete v.__reset;
      for (const [k, val] of Object.entries(patch)) { if (val == null) delete v[k]; else v[k] = val; }
      vaultCache = v;
      ls.set(KEYS.vault, Object.keys(v).length ? await seal(key, v) : null);
      return { ...v };
    },
  };
  return api;
}
