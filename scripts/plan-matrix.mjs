// Used by the "plan" job in .github/workflows/sync.yml. Builds the per-firm matrix
// [{ slug, secretKey, name }] from firms/index.json, or from the one slug given, and writes
// `matrix`, `count` and `problems` ([{ slug, detail }]: firms skipped for a config error,
// shown on the admin page) to $GITHUB_OUTPUT. Reads no secrets.
//
// Usage: node scripts/plan-matrix.mjs [slug]

import { access, appendFile } from 'node:fs/promises';
import { checkSlug, readIndex, secretKeyFor } from './firms.mjs';

const only = (process.argv[2] || '').trim();
const index = await readIndex();
const problems = [];   // [{ slug, detail, msg }]
const rows = [];

for (const f of only ? [index.find(x => x.slug === only) || { slug: only }] : index) {
  const err = checkSlug(f.slug);
  if (err) { problems.push({ slug: f.slug, detail: 'bad-slug', msg: err }); continue; }
  const expected = secretKeyFor(f.slug);
  const secretKey = f.secretKey || expected;
  // secretKey must belong to this slug, so a bad index entry can never borrow another firm's secrets.
  if (secretKey !== expected) { problems.push({ slug: f.slug, detail: 'secret-key-mismatch', msg: `${f.slug}: secretKey "${secretKey}" should be "${expected}"` }); continue; }
  try { await access(new URL(`../firms/${f.slug}/config.json`, import.meta.url)); }
  catch { problems.push({ slug: f.slug, detail: 'no-config', msg: `${f.slug}: no firms/${f.slug}/config.json` }); continue; }
  // name only labels the job ("Sync · <firm name>") so GitHub's emails and run pages say which firm.
  rows.push({ slug: f.slug, secretKey, name: String(f.name || f.slug).replace(/[\r\n]+/g, ' ').slice(0, 80) });
}

for (const p of problems) console.log(`::warning::Skipped ${p.msg}`);
console.log(rows.length ? `Firms to sync: ${rows.map(r => r.slug).join(', ')}` : 'No firms to sync.');
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(rows)}\ncount=${rows.length}\nproblems=${JSON.stringify(problems.map(({ slug, detail }) => ({ slug, detail })))}\n`);
}
// A specific slug that can't be synced is an error; an empty firm list is not.
if (only && !rows.length) process.exit(1);
