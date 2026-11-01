// Syncs every firm in firms/index.json (or just the slug given) by running
// scripts/sync.mjs once per firm in its own process, with only that firm's secrets.
// Keeps going when a firm fails, prints a per-firm summary, exits 1 if any failed.
//
// Usage: node scripts/sync-all.mjs [slug]
// Env:   ALL_SECRETS = JSON of every repo secret (from the workflow). Never logged.

import { spawn } from 'node:child_process';
import { access, appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { checkSlug, firmSecrets, readIndex, tokenName } from './firms.mjs';

const only = process.argv[2] || '';
const index = await readIndex();
let slugs;
if (only) {
  const err = checkSlug(only);
  if (err) { console.error(err); process.exit(1); }
  try { await access(new URL(`../firms/${only}/config.json`, import.meta.url)); }
  catch { console.error(`No firms/${only}/config.json`); process.exit(1); }
  slugs = [only];
} else {
  slugs = index.map(f => f.slug).filter(s => !checkSlug(s));
}

const syncScript = fileURLToPath(new URL('./sync.mjs', import.meta.url));
// Child env: everything except the bundle of all secrets, plus this firm's three values.
const { ALL_SECRETS: _omit, GHL_TOKEN: _t, DASHBOARD_PASSPHRASE: _p, DISPATCH_TOKEN: _d, ...baseEnv } = process.env;

function runOne(slug) {
  const s = firmSecrets(slug);
  if (!s.token) return Promise.resolve({ slug, ok: false, ms: 0, note: `secret ${tokenName(slug)} is not set` });
  const env = { ...baseEnv, GHL_TOKEN: s.token };
  if (s.passphrase) env.DASHBOARD_PASSPHRASE = s.passphrase;
  if (s.dispatchToken) env.DISPATCH_TOKEN = s.dispatchToken;
  const t0 = Date.now();
  let lastLine = '', errLine = '';
  return new Promise(resolve => {
    const child = spawn(process.execPath, [syncScript, slug], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const relay = stream => chunk => {
      const text = chunk.toString();
      for (const line of text.split('\n')) if (line.trim()) { stream.write(`[${slug}] ${line}\n`); lastLine = line.trim(); if (/^\w*Error: /.test(lastLine)) errLine = lastLine; }
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
const okCount = results.filter(r => r.ok).length;
const failed = results.length - okCount;
console.log(`\n${okCount} synced, ${failed} failed.`);

// Commit label for the workflow: the one slug, or "<n> firms".
if (process.env.GITHUB_OUTPUT) {
  const label = only ? only : `${okCount} firm${okCount === 1 ? '' : 's'}`;
  await appendFile(process.env.GITHUB_OUTPUT, `label=${label}\n`);
}
process.exit(failed ? 1 : 0);
