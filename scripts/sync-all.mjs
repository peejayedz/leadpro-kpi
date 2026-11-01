// LOCAL USE ONLY. GitHub Actions does not use this file: sync.yml runs scripts/sync.mjs
// once per firm in a matrix, each job with only that firm's two secrets.
//
// Syncs every firm in firms/index.json (or just the slug given) by running scripts/sync.mjs
// once per firm in its own process. Keeps going when a firm fails, prints a per-firm
// summary, exits 1 if any failed.
//
// Usage: GHL_TOKEN=… [DASHBOARD_PASSPHRASE=…] node scripts/sync-all.mjs [slug]
// The same GHL_TOKEN / DASHBOARD_PASSPHRASE go to every firm, so in practice pass one slug:
// a token only works for its own sub-account (other firms fail with 401/403 and are skipped).

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { checkSlug, readIndex } from './firms.mjs';

const only = process.argv[2] || '';
let slugs;
if (only) {
  const err = checkSlug(only);
  if (err) { console.error(err); process.exit(1); }
  try { await access(new URL(`../firms/${only}/config.json`, import.meta.url)); }
  catch { console.error(`No firms/${only}/config.json`); process.exit(1); }
  slugs = [only];
} else {
  slugs = (await readIndex()).map(f => f.slug).filter(s => !checkSlug(s));
}
if (!process.env.GHL_TOKEN) { console.error('Set GHL_TOKEN in the environment first.'); process.exit(1); }

const syncScript = fileURLToPath(new URL('./sync.mjs', import.meta.url));

function runOne(slug) {
  const t0 = Date.now();
  let lastLine = '', errLine = '';
  return new Promise(resolve => {
    const child = spawn(process.execPath, [syncScript, slug], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const relay = stream => chunk => {
      for (const line of chunk.toString().split('\n')) if (line.trim()) {
        stream.write(`[${slug}] ${line}\n`);
        lastLine = line.trim();
        if (/^\w*Error: /.test(lastLine)) errLine = lastLine;
      }
    };
    child.stdout.on('data', relay(process.stdout));
    child.stderr.on('data', relay(process.stderr));
    child.on('close', code => resolve({ slug, ok: code === 0, ms: Date.now() - t0, note: code === 0 ? lastLine : `exit ${code}: ${errLine || lastLine}` }));
  });
}

if (!slugs.length) console.log('No firms in firms/index.json yet. Nothing to sync.');
const results = [];
for (const slug of slugs) {
  console.log(`\n=== ${slug} ===`);
  results.push(await runOne(slug));
}
if (results.length) {
  console.log('\nSummary');
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} ${r.slug.padEnd(24)} ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.note}`);
}
const failed = results.filter(r => !r.ok).length;
console.log(`\n${results.length - failed} synced, ${failed} failed.`);
process.exit(failed ? 1 : 0);
