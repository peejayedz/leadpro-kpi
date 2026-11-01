// Small shared helpers for the per-firm scripts: slug rules, secret names, the firm list.
// Never logs a secret value.

import { readFile } from 'node:fs/promises';

export const RESERVED = ['admin', 'app', 'scripts', '_template'];

// Returns an error message, or null when the slug is valid.
export function checkSlug(slug) {
  if (!slug) return 'Missing firm slug (usage: node scripts/<script>.mjs <slug>)';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return `Invalid slug "${slug}": lowercase letters, digits and single hyphens only`;
  if (RESERVED.includes(slug)) return `"${slug}" is a reserved name`;
  return null;
}

// GHL_TOKEN_<SLUG> / PASSPHRASE_<SLUG>, e.g. "law-group" -> GHL_TOKEN_LAW_GROUP
export const secretSuffix = slug => slug.toUpperCase().replace(/-/g, '_');
export const tokenName = slug => `GHL_TOKEN_${secretSuffix(slug)}`;
export const passName = slug => `PASSPHRASE_${secretSuffix(slug)}`;

// The workflow passes every repo secret as one JSON env var (ALL_SECRETS). Parse it once.
let allSecrets;
export function secrets() {
  if (allSecrets) return allSecrets;
  try { allSecrets = JSON.parse(process.env.ALL_SECRETS || '{}') || {}; } catch { allSecrets = {}; }
  return allSecrets;
}
export const firmSecrets = slug => ({
  token: secrets()[tokenName(slug)] || '',
  passphrase: secrets()[passName(slug)] || '',
  dispatchToken: secrets().DISPATCH_TOKEN || '',
});

export async function readIndex() {
  try {
    const list = JSON.parse(await readFile(new URL('../firms/index.json', import.meta.url), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}
