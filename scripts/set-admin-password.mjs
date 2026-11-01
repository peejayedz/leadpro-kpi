// Sets the admin page password. Run it in your own terminal:
//
//   node scripts/set-admin-password.mjs
//
// It asks for the password twice (typing is hidden) and writes admin/lock.json:
//   { salt, iterations, verifier }
// The password itself is never stored, printed or passed as an argument.
//
// How it works: PBKDF2-SHA256(password, random 16-byte salt, 210,000 iterations) -> 64 bytes.
// The first 32 bytes are the public verifier the page compares against. The last 32 bytes
// never leave the browser: they are the AES-GCM key that encrypts the saved GitHub token.
// Changing the password makes every saved token unreadable, so each device asks for it again.

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { writeFile, access } from 'node:fs/promises';
import { stdin, stdout } from 'node:process';

const ITERATIONS = 210000;
const MIN_LENGTH = 10;
const lockFile = new URL('../admin/lock.json', import.meta.url);

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

// Hidden prompt on a terminal; a plain line read when piped (for automated tests).
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

try {
  let exists = false;
  try { await access(lockFile); exists = true; } catch {}
  if (exists) {
    const ok = (await ask('admin/lock.json already exists. Replace the admin password? Saved GitHub tokens on every device will need re-entering. (y/N) ', { hidden: false })).trim().toLowerCase();
    if (ok !== 'y' && ok !== 'yes') { console.log('Left unchanged.'); process.exit(0); }
  }
  const pw = await ask(`New admin password (at least ${MIN_LENGTH} characters, typing is hidden): `);
  if (pw.length < MIN_LENGTH) { console.error(`Too short: use at least ${MIN_LENGTH} characters.`); process.exit(1); }
  const again = await ask('Type it again: ');
  if (pw !== again) { console.error("The two passwords don't match. Nothing was changed."); process.exit(1); }

  const salt = randomBytes(16);
  const bits = pbkdf2Sync(Buffer.from(pw, 'utf8'), salt, ITERATIONS, 64, 'sha256');
  const lock = { salt: salt.toString('base64'), iterations: ITERATIONS, verifier: bits.subarray(0, 32).toString('base64') };
  await writeFile(lockFile, JSON.stringify(lock, null, 2) + '\n');
  console.log('Wrote admin/lock.json. Commit and push it to switch the admin page to this password.');
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
