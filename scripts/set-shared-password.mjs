// Sets the ONE admin password for the Sub-account Builder, the KPI admin and the Automation Review admin.
// Run it in your own Terminal, in the leadpro-kpi folder:
//
//   node scripts/set-shared-password.mjs
//
// It asks for the password twice (typing is hidden) and writes the same lfmp-lock.json { salt, iterations, verifier }
// into each tool's folder it finds next to this repo:
//   leadpro-kpi/admin/   ../ghl-subaccount-builder/page/   ../automation-review/admin/
// The password itself is never stored, printed or passed as an argument. Then publish each tool (commit + push the
// file, and copy page/lfmp-lock.json into the builder's page repo) to switch it to the one login.
//
// PBKDF2-SHA256(password, random 16-byte salt, 210,000 iterations) -> 64 bytes: the first 32 are the public check value,
// the last 32 never leave the browser (they seal the vault: GitHub token + Automation Review admin key).
// A new password makes every browser's vault unreadable: sign in, paste the GitHub token again and re-add the review key.
// Also the reset: if the password is lost, run this again.

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { stdin, stdout } from 'node:process';

const ITERATIONS = 210000;
const MIN_LENGTH = 12;
const TARGETS = process.env.LFMP_LOCK_TEST_DIRS   // automated tests only: comma-separated folders instead of the real ones
  ? process.env.LFMP_LOCK_TEST_DIRS.split(',').map((d, i) => [`test ${i + 1}`, new URL(`file://${d.replace(/\/?$/, '/')}`)])
  : [
    ['KPI admin', new URL('../admin/', import.meta.url)],
    ['Sub-account Builder', new URL('../../ghl-subaccount-builder/page/', import.meta.url)],
    ['Automation Review admin', new URL('../../automation-review/admin/', import.meta.url)],
  ];

// Piped input (automated tests): read stdin once, hand out one line per prompt.
let piped = null;
function pipedLines() {
  return piped ||= new Promise((resolve, reject) => {
    let buf = '';
    stdin.setEncoding('utf8');
    stdin.on('data', d => { buf += d; });
    stdin.on('end', () => resolve(buf.split(/\r?\n/)));
    stdin.on('error', reject);
  });
}
// Hidden prompt on a terminal; a plain line read when piped.
function ask(question, { hidden = true } = {}) {
  return new Promise((resolve, reject) => {
    stdout.write(question);
    if (!stdin.isTTY) { pipedLines().then(lines => { stdout.write('\n'); resolve(lines.shift() ?? ''); }, reject); return; }
    let value = '';
    stdin.setRawMode(true); stdin.setEncoding('utf8'); stdin.resume();
    const onKey = key => {
      for (const ch of key) {
        if (ch === '\u0003') { stdin.setRawMode(false); stdout.write('\n'); reject(new Error('Cancelled')); return; }
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onKey); stdout.write('\n'); resolve(value); return; }
        if (ch === '\u007f' || ch === '\b') { if (value) { value = value.slice(0, -1); if (!hidden) stdout.write('\b \b'); } continue; }
        if (ch >= ' ') { value += ch; if (!hidden) stdout.write(ch); }
      }
    };
    stdin.on('data', onKey);
  });
}
const exists = async u => { try { await access(u); return true; } catch { return false; } };

try {
  const found = [];
  for (const [name, dir] of TARGETS) if (await exists(dir)) found.push([name, dir]);
  if (!found.length) { console.error('No tool folders found next to this repo. Nothing was changed.'); process.exit(1); }
  console.log(`This sets one admin password for: ${found.map(f => f[0]).join(', ')}.`);
  const replacing = [];
  for (const [name, dir] of found) if (await exists(new URL('lfmp-lock.json', dir))) replacing.push(name);
  if (replacing.length) {
    const ok = (await ask(`A shared password is already set (${replacing.join(', ')}). Replace it? Every browser will need the GitHub token and review key re-added. (y/N) `, { hidden: false })).trim().toLowerCase();
    if (ok !== 'y' && ok !== 'yes') { console.log('Left unchanged.'); process.exit(0); }
  }
  const pw = await ask(`New admin password (at least ${MIN_LENGTH} characters, typing is hidden): `);
  if (pw.length < MIN_LENGTH) { console.error(`Too short: use at least ${MIN_LENGTH} characters. Nothing was changed.`); process.exit(1); }
  const again = await ask('Type it again: ');
  if (pw !== again) { console.error("The two passwords don't match. Nothing was changed."); process.exit(1); }

  const salt = randomBytes(16);
  const bits = pbkdf2Sync(Buffer.from(pw, 'utf8'), salt, ITERATIONS, 64, 'sha256');
  const lock = { salt: salt.toString('base64'), iterations: ITERATIONS, verifier: bits.subarray(0, 32).toString('base64') };
  bits.fill(0);
  const text = JSON.stringify(lock, null, 2) + '\n';
  for (const [name, dir] of found) {
    await writeFile(new URL('lfmp-lock.json', dir), text);
    console.log(`Wrote ${fileURLToPath(new URL('lfmp-lock.json', dir)).split('/').slice(-3).join('/')} (${name})`);
  }
  console.log('Done. Ask Claude to publish the three tools; until then each page keeps its current password.');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
