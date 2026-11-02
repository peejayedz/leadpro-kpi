// The nine read-only GHL scopes, checked with one lightweight read each.
// Used by discover.mjs (writes the result to discovery.json) and by sync.mjs (when GHL refuses
// part of a sync, to name the missing scope or tell a rejected token apart from a missing scope).
// Only scope names and pass/fail come out of here; response bodies are handed back to the caller.

export const SCOPES = [
  'opportunities.readonly', 'contacts.readonly', 'users.readonly', 'locations.readonly', 'locations/customFields.readonly',
  'calendars.readonly', 'calendars/events.readonly', 'conversations.readonly', 'conversations/message.readonly',
];

// Which scope a GHL API path needs (for naming the scope behind a 401/403).
export function scopeForPath(path) {
  const p = String(path || '').split('?')[0];
  if (p.startsWith('/opportunities')) return 'opportunities.readonly';
  if (p.startsWith('/contacts')) return 'contacts.readonly';
  if (p.startsWith('/users')) return 'users.readonly';
  if (/^\/locations\/[^/]+\/customFields/.test(p)) return 'locations/customFields.readonly';
  if (p.startsWith('/locations')) return 'locations.readonly';
  if (p.startsWith('/calendars/events')) return 'calendars/events.readonly';
  if (p.startsWith('/calendars')) return 'calendars.readonly';
  if (p.startsWith('/conversations/messages')) return 'conversations/message.readonly';
  if (p.startsWith('/conversations')) return 'conversations.readonly';
  return null;
}

// probe(path) must never throw and returns { status, body?, error? } (error = GHL's short message).
// log(line) is optional. Returns { results, bodies, scopes } where scopes is what discovery.json stores.
export async function checkScopes(probe, LOC, { log = () => {}, now = Date.now() } = {}) {
  const day = 864e5;
  const results = {}, bodies = {};
  async function check(scope, path) {
    const r = await probe(path);
    results[scope] = r; bodies[scope] = r.body || null;
    const verdict = r.status >= 200 && r.status < 300 ? 'ok' : (r.status === 401 || r.status === 403) ? 'MISSING' : `unclear (${r.status || 'network'})`;
    log(`  ${verdict === 'ok' ? '✓' : verdict === 'MISSING' ? '✗' : '?'} ${scope.padEnd(32)} ${verdict}${verdict.startsWith('unclear') && r.error ? ` (GHL: ${r.error})` : ''}`);
  }
  await check('opportunities.readonly', `/opportunities/pipelines?locationId=${LOC}`);
  await check('contacts.readonly', `/contacts/?locationId=${LOC}&limit=1`);
  await check('users.readonly', `/users/?locationId=${LOC}`);
  await check('locations.readonly', `/locations/${LOC}`);
  await check('locations/customFields.readonly', `/locations/${LOC}/customFields?model=contact`);
  await check('calendars.readonly', `/calendars/?locationId=${LOC}`);
  { // events need a calendar or a user to ask about
    const calId = bodies['calendars.readonly']?.calendars?.[0]?.id, userId = bodies['users.readonly']?.users?.[0]?.id;
    if (calId || userId) await check('calendars/events.readonly', `/calendars/events?locationId=${LOC}&${calId ? `calendarId=${calId}` : `userId=${userId}`}&startTime=${now - day}&endTime=${now}`);
    else { results['calendars/events.readonly'] = { status: -1, error: 'no calendar or user to test with' }; log(`  ? ${'calendars/events.readonly'.padEnd(32)} not testable (no calendars or users visible)`); }
  }
  await check('conversations.readonly', `/conversations/search?locationId=${LOC}&limit=1`);
  // Same request the sync makes (GHL rejects smaller limits with 422).
  await check('conversations/message.readonly', `/conversations/messages/export?locationId=${LOC}&channel=SMS&limit=100`);

  const keys = Object.keys(results);
  const isOk = r => r.status >= 200 && r.status < 300;
  const isDenied = r => r.status === 401 || r.status === 403;
  const scopes = {
    checkedAt: new Date(now).toISOString(),
    ok: keys.filter(s => isOk(results[s])),
    missing: keys.filter(s => isDenied(results[s])),
    unchecked: keys.filter(s => !isOk(results[s]) && !isDenied(results[s])),
  };
  // Every check refused: the token itself is wrong (mistyped, revoked, or from another sub-account).
  scopes.tokenRejected = scopes.ok.length === 0 && scopes.missing.length > 0;
  if (scopes.tokenRejected) scopes.ghlMessage = Object.values(results).find(isDenied)?.error || '';
  return { results, bodies, scopes };
}
