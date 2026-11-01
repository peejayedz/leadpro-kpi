// Used by the "plan" job in .github/workflows/sync.yml. Builds the per-firm matrix
// [{ slug, secretKey }] from firms/index.json, or from the one slug given, and writes
// `matrix` and `count` to $GITHUB_OUTPUT. Reads no secrets.
//
// Usage: node scripts/plan-matrix.mjs [slug]

import { access, appendFile } from 'node:fs/promises';
import { checkSlug, readIndex, secretKeyFor } from './firms.mjs';

const only = (process.argv[2] || '').trim();
const index = await readIndex();
const problems = [];
const rows = [];

for (const f of only ? [index.find(x => x.slug === only) || { slug: only }] : index) {
  const err = checkSlug(f.slug);
  if (err) { problems.push(err); continue; }
  const expected = secretKeyFor(f.slug);
  const secretKey = f.secretKey || expected;
  // secretKey must belong to this slug, so a bad index entry can never borrow another firm's secrets.
  if (secretKey !== expected) { problems.push(`${f.slug}: secretKey "${secretKey}" should be "${expected}"`); continue; }
  try { await access(new URL(`../firms/${f.slug}/config.json`, import.meta.url)); }
  catch { problems.push(`${f.slug}: no firms/${f.slug}/config.json`); continue; }
  rows.push({ slug: f.slug, secretKey });
}

for (const p of problems) console.log(`::warning::Skipped ${p}`);
console.log(rows.length ? `Firms to sync: ${rows.map(r => r.slug).join(', ')}` : 'No firms to sync.');
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(rows)}\ncount=${rows.length}\n`);
}
// A specific slug that can't be synced is an error; an empty firm list is not.
if (only && !rows.length) process.exit(1);
