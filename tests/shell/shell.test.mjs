// v2 SHELL tests (redesign v2, Nov 2026). This file is byte-identical in all three repos:
//   ghl-subaccount-builder/tests/unit/shell.test.mjs   (npm test)
//   leadpro-kpi/tests/shell/shell.test.mjs             (node tests/shell/shell.test.mjs)
//   automation-review/admin/tests/shell.test.mjs       (node admin/tests/shell.test.mjs)
// It finds the repo's lfmp-session.js / lfmp-ui.css itself. Part 1 is pure (no browser). Part 2 runs the shell in
// Chromium when playwright-core is found (the Builder's node_modules, or PLAYWRIGHT_CORE) and CHROMIUM_PATH if set.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = ['../../page', '../../admin', '..'].map(p => path.resolve(HERE, p)).find(d => fs.existsSync(path.join(d, 'lfmp-session.js')) && fs.existsSync(path.join(d, 'lfmp-ui.css')));
if (!DIR) throw new Error('lfmp-session.js not found next to this test');
const S = await import(pathToFileURL(path.join(DIR, 'lfmp-session.js')).href);
const CSS = fs.readFileSync(path.join(DIR, 'lfmp-ui.css'), 'utf8');
const V2 = CSS.slice(CSS.lastIndexOf('/*', CSS.indexOf('v2 SHELL')));
const me = { name: 'Pee Jay Edrozo', email: 'pj@example.com', lastSignIn: '2026-11-16T11:31:00Z' };
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- part 1: pure
// v2.10.0 Done moments (lfmp-done.js): settings, the lines, the greeting text, the Me row
const DN = await import(pathToFileURL(path.join(DIR, 'lfmp-done.js')).href);
const dnStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
test('Done moments: defaults (New popup, Sound + voice, Systems check, Guy, best voice, Commander style, "Commander", Commander line); voice greeting On only for PJ', () => {
  assert.deepEqual(DN.doneDefaults(), { enabled: true, animation: 'new', sound: 'all', style: 'syscheck', gender: 'guy', who: '', voice: 'commander', callme: 'Commander', custom: '', line: 'commander', greet: 'off' });
  assert.equal(DN.doneDefaults({ first: 'PJ', name: 'PJ' }).greet, 'on'); assert.equal(DN.doneDefaults({ first: 'Andy', name: 'Andy Cass' }).greet, 'off');
  assert.equal(DN.DONE_KEY, 'lfmp-done');
});
test('Done moments: saved in localStorage "lfmp-done"; a value that isn\'t a choice falls back; nothing stored = defaults; storage blocked = defaults, no error', () => {
  const st = dnStore();
  assert.deepEqual(DN.readDone(st), DN.doneDefaults());
  const saved = DN.saveDone({ ...DN.doneDefaults(), animation: 'classic', style: 'rain', callme: 'Custom', custom: 'PJ', greet: 'on' }, st);
  assert.equal(JSON.parse(st.m.get('lfmp-done')).style, 'rain'); assert.deepEqual(DN.readDone(st), saved);
  st.setItem('lfmp-done', JSON.stringify({ animation: 'loud', style: 'boom', sound: 'all', voice: 'x', line: 'short', custom: 'A'.repeat(99) }));
  const c = DN.readDone(st); assert.equal(c.animation, 'new'); assert.equal(c.style, 'syscheck'); assert.equal(c.voice, 'commander'); assert.equal(c.line, 'short'); assert.equal(c.custom.length, 40);
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(DN.readDone(blocked), DN.doneDefaults()); DN.saveDone(DN.doneDefaults(), blocked);
});
test('Done moments: the finish styles = the 7 picks + Surprise me; each comes with its own sound (no sound picker)', () => {
  assert.deepEqual(DN.STYLES.map(s => s[0]), ['lockon', 'core', 'syscheck', 'opsgrid', 'globe', 'rain', 'hud', 'random']);
  assert.deepEqual(DN.STYLES.slice(0, 7).map(s => s[1]), ['Suit HUD · Lock-on', 'Suit HUD · Power core', 'Suit HUD · Systems check', 'Command wall · Ops grid', 'Command wall · Global map', 'Gold rain', 'HUD scan']);
  for (const id of DN.STYLE_IDS) assert.ok(DN.SOUND_OF[id], `sound for ${id}`);
  assert.deepEqual(DN.CALL_ME, ['Nothing', 'Master', 'Commander', 'Boss', 'Chief', 'Captain', 'Sir', 'Team', 'Custom']);
  assert.deepEqual(DN.LINE_STYLES.map(l => l[0]), ['commander', 'report', 'mission', 'hype', 'short']); assert.deepEqual(DN.VOICE_STYLES.map(l => l[0]), ['commander', 'robot', 'control', 'announcer']);
});
test('Done moments: the voice line with every Call me (Nothing, the 7 names, Custom, empty Custom) and every Line, with the real client name', () => {
  const L = DN.linesFor('builder', 'Acme Law');
  const s = c => ({ ...DN.doneDefaults(), callme: c, custom: c === 'Custom' ? 'PJ' : '' });
  assert.equal(DN.lineText(L, 'commander', DN.callName(s('Commander'))), 'Build complete, Commander. Acme Law is ready.');
  assert.equal(DN.lineText(L, 'commander', DN.callName(s('Nothing'))), 'Build complete. Acme Law is ready.');
  assert.equal(DN.lineText(L, 'report', DN.callName(s('Custom'))), "PJ, the build is complete. Acme Law's sub-account is ready.");
  assert.equal(DN.lineText(L, 'report', DN.callName({ ...s('Custom'), custom: '  ' })), "The build is complete. Acme Law's sub-account is ready.");
  for (const c of ['Master', 'Boss', 'Chief', 'Captain', 'Sir', 'Team']) for (const [k] of DN.LINE_STYLES) { const t = DN.lineText(L, k, DN.callName(s(c))); assert.ok(t.includes(c) && !/[@^]/.test(t), `${c} / ${k}: ${t}`); }
  for (const tool of ['builder', 'kpi', 'review']) { const T = JSON.stringify(DN.linesFor(tool, 'Acme Law')); assert.ok(T.includes('Acme Law') && !/Boca|Mahdavi|Dumas|\{c\}|\{s\}/.test(T), tool); }
  assert.equal(DN.linesFor('kpi', 'The Mahdavi Law Firm').say.mission, 'Mission complete@. The Mahdavi Law Firm scorecard is deployed.', '"The …" is not doubled');
  assert.deepEqual(DN.linesFor('kpi', 'X', ['a', 'b']).steps, ['a', 'b'], 'the tool\'s real steps');
  assert.deepEqual(DN.linesFor('builder', 'X').mods, ['Fields', 'Pipelines', 'Calendars', 'Review']); assert.deepEqual(DN.linesFor('kpi', 'X').mods, ['Stages', 'Counts', 'Dashboard', 'Publish']); assert.deepEqual(DN.linesFor('review', 'X').mods, ['Workflows', 'Plan', 'Flows', 'Package']);
});
test('Voice greeting text: daypart, Call me or the first name, zeros and missing counts left out, "Everything is clear."', () => {
  const s = (c = 'Commander') => ({ ...DN.doneDefaults(), callme: c });
  assert.equal(DN.greetVoiceText({ hour: 15, settings: s(), counts: { reviews: 2, scorecards: 1, clients: 3 } }), 'Good afternoon, Commander. 2 reviews need you, 1 scorecard needs attention, and 3 clients are in progress.');
  assert.equal(DN.greetVoiceText({ hour: 9, settings: s('Nothing'), first: 'PJ', counts: { reviews: 0, scorecards: 0, clients: 1 } }), 'Good morning, PJ. 1 client is in progress.');
  assert.equal(DN.greetVoiceText({ hour: 20, settings: s(), counts: { reviews: 1, clients: 2 } }), 'Good evening, Commander. 1 review needs you, and 2 clients are in progress.');
  assert.equal(DN.greetVoiceText({ hour: 11, settings: s(), counts: { reviews: 0, scorecards: 0, clients: 0 } }), 'Good morning, Commander. Everything is clear.');
  assert.equal(DN.greetVoiceText({ hour: 12, settings: s(), counts: {} }), 'Good afternoon, Commander.', 'no count ready → no count sentence');
  assert.equal(DN.greetVoiceText({ hour: 18, settings: s('Nothing'), counts: { scorecards: 4 } }), 'Good evening. 4 scorecards need attention.');
  assert.equal(DN.greetVoiceText({ hour: 8, settings: { ...s('Custom'), custom: 'Boss Lady' }, counts: { reviews: 3, scorecards: 2 } }), 'Good morning, Boss Lady. 3 reviews need you, and 2 scorecards need attention.');
});
test('Done moments row in the name menu (after Theme: "New popup ›" / "Classic ›", one line) and on the phone Me screen (Settings group, after Theme: "New popup · Sound + voice ›")', () => {
  for (const compact of [true, false]) {
    const h = S.meHtml({ me }, { theme: 'auto', done: DN.doneDefaults() }, { compact });
    const t = text(h); assert.match(t, compact ? /Theme Light Dark Auto Done moments New popup › / : /Theme Light Dark Auto Done moments New popup · Sound \+ voice ›/, `compact ${compact}`);   // FIX 6.1: one line in the name menu
    assert.match(h, /data-lv="done" role="menuitem"/);
    assert.match(text(S.meHtml({ me }, { theme: 'auto', done: { ...DN.doneDefaults(), animation: 'classic' } }, { compact })), /Done moments Classic ›/);
    assert.match(text(S.meHtml({ me }, { theme: 'auto', done: { ...DN.doneDefaults(), sound: 'off' } }, { compact })), compact ? /Done moments New popup › / : /Done moments New popup · Off ›/);
  }
});
// v2.11.0 (queue item 10): Team sign-ins shows the Reports key changes when the server sends them
test('Team sign-ins (v2.11.0): changes [{ who, what, at }] → a second table "Reports key changes (last 90 days)" (Who / What / When, phone labels); missing or empty → nothing extra', () => {
  const people = [{ name: 'PJ', email: 'pj@example.com', last: '2026-11-24T08:00:00Z', count30: 4 }];
  const plain = S.signinsHtml({ people });
  assert.ok(!/Reports key changes|lfmp-keychanges/.test(plain), 'no changes → unchanged');
  assert.equal(S.signinsHtml({ people, changes: [] }), plain, 'empty changes → identical to before');
  assert.equal(S.signinsHtml({ people, changes: 'x' }), plain, 'not a list → ignored');
  const h = S.signinsHtml({ people, changes: [{ who: 'PJ', what: 'CallRail key saved (••••3f9a)', at: '2026-11-24T08:10:00Z', value: 'SECRET-MARKER-123' }, { who: 'PJ', what: '<b>x</b>', at: 'bad' }] });
  assert.match(text(h), /Reports key changes \(last 90 days\) Who What When PJ CallRail key saved \(••••3f9a\) /);
  assert.match(h, /<td data-l="Who"><b>PJ<\/b><\/td><td data-l="What">CallRail key saved \(••••3f9a\)<\/td><td data-l="When">[A-Z][a-z]{2} \d+ Nov, \d+:\d\d [AP]M<\/td>/);
  assert.ok(!h.includes('SECRET-MARKER-123'), 'nothing else from a change is shown');
  assert.ok(h.includes('&lt;b&gt;x&lt;/b&gt;') && !h.includes('<b>x</b>'), 'escaped');
  assert.equal((S.signinsHtml({ people, changes: Array.from({ length: 80 }, (_, i) => ({ who: 'PJ', what: `k${i}`, at: '2026-11-24T08:10:00Z' })) }).match(/data-l="Who"/g) || []).length, 50, 'at most 50 rows');
  assert.match(S.signinsHtml({ changes: [{ who: 'PJ', what: 'x', at: '2026-11-24T08:10:00Z' }] }), /No sign-ins recorded yet[\s\S]*Reports key changes/);
});
// v2.11.0 (queue item 10): the On / Off switch at the top of the panel
test('Done moments On / Off (v2.11.0): default On; saved as enabled: true | false in "lfmp-done"; anything else = On; Off overrides Classic; isQuiet = Off or Classic', () => {
  const st = dnStore();
  assert.equal(DN.readDone(st).enabled, true, 'default On');
  DN.saveDone({ ...DN.doneDefaults(), enabled: false }, st);
  assert.equal(JSON.parse(st.m.get('lfmp-done')).enabled, false); assert.equal(DN.readDone(st).enabled, false);
  for (const v of [true, 'off', 0, null, undefined]) { st.setItem('lfmp-done', JSON.stringify({ enabled: v })); assert.equal(DN.readDone(st).enabled, true, `enabled ${JSON.stringify(v)} → On`); }
  st.setItem('lfmp-done', JSON.stringify({ animation: 'new' })); assert.equal(DN.readDone(st).enabled, true, 'a saved setting from before 2.11.0 (no "enabled") = On');
  const off = { ...DN.doneDefaults(), enabled: false };
  assert.ok(DN.isOff(off) && DN.isQuiet(off) && !DN.isClassic(off));
  assert.ok(DN.isQuiet({ ...DN.doneDefaults(), animation: 'classic' }) && !DN.isOff({ ...DN.doneDefaults(), animation: 'classic' }));
  assert.ok(DN.isQuiet({ ...off, animation: 'classic' }), 'Off + Classic: quiet');
  assert.ok(!DN.isQuiet(DN.doneDefaults()));
  assert.equal(DN.doneRowValue(off), 'Off'); assert.equal(DN.doneRowShort(off), 'Off'); assert.equal(DN.doneRowValue({ ...off, animation: 'classic' }), 'Off', 'Off wins over Classic');
});
test('Done moments row: "Done moments · Off ›" in the name menu and on the phone Me screen when switched off', () => {
  for (const compact of [true, false]) assert.match(text(S.meHtml({ me }, { theme: 'auto', done: { ...DN.doneDefaults(), enabled: false } }, { compact })), /Done moments Off ›/, `compact ${compact}`);
});
test('Done moments panel (v2.11.0): the first switch is "Done moments: On | Off" with the hint; Off greys out everything below except the voice greeting, disables Play and Test voice, chip "Off"', () => {
  const on = DN.donePanelHtml(DN.doneDefaults()), off = DN.donePanelHtml({ ...DN.doneDefaults(), enabled: false });
  const fields = h => [...h.matchAll(/<div class="lv-dmp-f( off)?"><div class="lab">([^<]+)<\/div>/g)].map(m => [m[2], !!m[1]]);
  assert.deepEqual(fields(on).map(f => f[0]).slice(0, 2), ['Done moments', 'Animation'], 'On / Off first, then Animation');
  assert.ok(fields(on).every(f => !f[1]), 'On: nothing greyed');
  assert.match(on, /data-dm="enabled" data-v="on" aria-pressed="true"/); assert.match(off, /data-dm="enabled" data-v="off" aria-pressed="true"/);
  assert.ok(on.includes(DN.OFF_HINT.replace(/'/g, '&#39;')) || on.includes(DN.OFF_HINT), 'the hint from the preview');
  assert.deepEqual(fields(off).filter(f => f[1]).map(f => f[0]), ['Animation', 'Sound', 'Finish style', 'Voice', 'Which voice', 'Voice style', 'Call me', 'Line'], 'Off: everything below greyed, except the voice greeting');
  assert.ok(fields(off).some(f => f[0] === 'Voice greeting' && !f[1]), 'voice greeting keeps its own switch');
  assert.match(off, /data-dm-act="play" disabled/); assert.match(off, /data-dm-act="voice" disabled/);
  assert.match(text(off), /Done moments Off What plays/); assert.match(text(on), /Done moments On What plays/);
  const cl = DN.donePanelHtml({ ...DN.doneDefaults(), animation: 'classic' });
  assert.ok(fields(cl).find(f => f[0] === 'Animation')[1] === false && fields(cl).find(f => f[0] === 'Sound')[1] === true, 'Classic as before: Animation stays usable, the rest greys');
});
test('Done moments: no browser (the team site\'s server imports the shell) → the engine never runs; a job\'s moment is null', () => {
  assert.equal(DN.HAS_DOM, false); assert.equal(DN.openMoment({ tool: 'builder', client: 'X' }), null);
});
test('the three copies of lfmp-session.js, lfmp-ui.css, lfmp-done.js, lfmp-done.css and this test are byte-identical', () => {
  let code = HERE; while (code !== path.dirname(code) && !fs.existsSync(path.join(code, 'ghl-subaccount-builder'))) code = path.dirname(code);
  const sets = [
    ['ghl-subaccount-builder/page', 'leadpro-kpi/admin', 'automation-review/admin'].map(d => path.join(code, d)),
  ];
  const tests = ['ghl-subaccount-builder/tests/unit/shell.test.mjs', 'leadpro-kpi/tests/shell/shell.test.mjs', 'automation-review/admin/tests/shell.test.mjs'].map(f => path.join(code, f));
  if (!sets[0].every(d => fs.existsSync(d))) return test.skip?.('the other two repos are not next to this one');
  const md5 = f => crypto.createHash('md5').update(fs.readFileSync(f)).digest('hex');
  for (const f of ['lfmp-session.js', 'lfmp-ui.css', 'lfmp-done.js', 'lfmp-done.css']) assert.equal(new Set(sets[0].map(d => md5(path.join(d, f)))).size, 1, `${f} differs between the three repos`);
  const there = tests.filter(f => fs.existsSync(f));
  assert.equal(new Set(there.map(md5)).size, 1, 'shell.test.mjs differs between the repos');
});

test('initials: first letters of the first two words (the reference shows PJ for Pee Jay Edrozo)', () => {
  assert.equal(S.initials(me), 'PJ');
  assert.equal(S.initials({ name: 'PJ Tester' }), 'PT');
  assert.equal(S.initials({ name: 'PJ', email: 'pj@x.com' }), 'PJ');   // the live Google name is just "PJ"
  assert.equal(S.initials({ name: 'Sam' }), 'S');
  assert.equal(S.initials({ email: 'sam@x.com' }), 'S');
  assert.equal(S.initials({}), '·');
});

test('four tools in the same order everywhere: Clients · Scorecards · Reviews · Reports (v2.9.0)', () => {
  assert.deepEqual(S.SHELL_TOOLS.map(t => [t.id, t.label, t.path, t.plus]), [
    ['builder', 'Clients', '/ghl-subaccount-builder-page/', 'New sub-account'], ['kpi', 'Scorecards', '/leadpro-kpi/admin/', 'New firm'], ['review', 'Reviews', '/automation-review/admin/', null],
    ['reports', 'Reports', '/ghl-subaccount-builder-page/#reports', 'Add client']]);
});

// v2.4.0 (PJ's Greeting 1+9 preview): no name and no Sign out in the bar; the initials open the name menu. The hidden
// "Your menu ›" hint sits under the initials (shown ~2.6 s after the greeting, first 3 days).
const noHint = h => text(h.replace(/<span class="lv-mhint"[^>]*>[^<]*<\/span>/g, ''));
test('desktop top bar: icon + LFMP · nav (current = this tool) · [bell] · gold + · initials (no name, no Sign out)', () => {
  for (const t of S.SHELL_TOOLS) {
    const h = S.topBarHtml({ tool: t.id, me, bell: t.id === 'kpi', bellCount: 3, plus: t.plus ? { label: t.plus } : null });
    assert.equal(noHint(h), `LFMP Clients Scorecards Reviews Reports ${t.id === 'kpi' ? '🔔 3 ' : ''}${t.plus ? `+ ${t.plus} ` : ''}PJ`);
    assert.equal((h.match(/aria-current="page"/g) || []).length, 1);
    assert.match(h, new RegExp(`<a href="${t.path}" aria-current="page" data-lv-home>${t.label}</a>`));
    assert.match(h, /class="lv-mk"[^>]*><i><\/i><i><\/i><i><\/i><\/a>/, 'the 3-block LFMP icon');
    assert.doesNotMatch(h, /data-lv="signout"|Pee Jay Edrozo|Last signed in|data-me/, 'no Sign out and no name in the bar');
    assert.match(h, /data-lv="me" aria-haspopup="menu" aria-expanded="false"/);
    assert.match(h, /<div class="lv-pop" data-lv-pop role="menu" aria-label="Your menu" tabindex="-1" hidden><\/div><span class="lv-mhint" data-lv-mhint aria-hidden="true" hidden>Your menu ›<\/span>/);
  }
  const q = S.topBarHtml({ tool: 'kpi', me, bell: true, bellCount: 0 });
  assert.match(q, /data-lv-badge hidden>0</, 'no count = badge hidden');
});

test('phone top bar: icon · TITLE · [bell] · gold round + · initials (the same name menu as desktop)', () => {
  const b = S.phoneBarHtml({ tool: 'builder', me, plus: { label: 'New sub-account' } });
  assert.equal(noHint(b), 'Clients + PJ');
  assert.match(b, /class="lv-pplus lv-hit" data-lv="plus" aria-label="New sub-account">\+</);
  assert.match(b, /data-lv-avwrap="phone"><button type="button" class="lv-avbtn lv-hit" data-lv="me" aria-haspopup="menu"/);
  assert.match(b, /data-lv-pop role="menu"/);
  assert.equal(noHint(S.phoneBarHtml({ tool: 'kpi', me, bell: true, bellCount: 1, plus: { label: 'New firm' } })), 'Scorecards 🔔 1 + PJ');
  assert.equal(noHint(S.phoneBarHtml({ tool: 'review', me })), 'Reviews PJ', 'Reviews: no bell, no +');
  const ms = S.phoneBarHtml({ tool: 'kpi', me, bell: true, plus: {}, meScreen: true }, 'Me');
  assert.equal(text(ms), 'Me PJ', 'the Me screen: title and avatar only');
  assert.doesNotMatch(ms, /data-lv-pop|data-lv-mhint/, 'the Me screen has no second menu');
});

test('bottom tabs: Clients · Scorecards · Reviews · Reports · Me; the current one is gold (aria-current); Me while Me is open', () => {
  const t = S.tabsHtml({ tool: 'kpi' });
  assert.equal(text(t), 'Clients Scorecards Reviews Reports Me');
  assert.deepEqual([...t.matchAll(/href="([^"]+)"/g)].map(m => m[1]), S.SHELL_TOOLS.map(x => x.path));
  assert.match(t, /href="\/leadpro-kpi\/admin\/" aria-current="page" data-lv-home/);
  const m = S.tabsHtml({ tool: 'kpi' }, true);
  assert.match(m, /data-lv="metab" aria-current="page"/);
  assert.equal((m.match(/aria-current/g) || []).length, 1);
});

test('Me (identical in all three tools): avatar, name, Last signed in · SETTINGS · TEAM · red Sign out, in that order', () => {
  const h = S.meHtml({ tool: 'kpi', me, version: '1.23.0', showTests: { label: 'Show test clients' }, onRefresh() {},
    extras: { title: 'Scorecards', items: [{ label: 'Sync', value: 'every 30 min' }] } },   // extras are ignored: no tool-only section
    { theme: 'dark', showTests: true, updated: '4:57 PM', newsDot: true });
  assert.equal(text(h), `PJ Pee Jay Edrozo ${S.lastSignInText(me)} Settings Theme Light Dark Auto Done moments New popup · Sound + voice › Show test clients Refresh now updated 4:57 PM Team Team sign-ins › What's new v1.23.0 › Install the app › Sign out`);
  assert.match(h, /data-v="dark" aria-pressed="true"/); assert.match(h, /data-v="auto" aria-pressed="false"/);
  assert.match(h, /role="switch" data-lv="tests" aria-labelledby="lvTestsL" aria-checked="true"/);
  assert.match(h, /data-lv="news" role="menuitem"><span>What&#39;s new<\/span><span class="lv-v"><span class="lv-ndot"/, 'unseen What\'s new: the dot is on its row');
  assert.match(h, /class="lv-mi out" data-lv="signout"/);
  for (const t of S.SHELL_TOOLS) assert.doesNotMatch(S.topBarHtml({ tool: t.id, me, newsDot: true }) + S.phoneBarHtml({ tool: t.id, me, newsDot: true }), /lv-dot|lv-ndot/, 'no dot on the avatar');
  const same = S.SHELL_TOOLS.map(t => S.meHtml({ tool: t.id, me, version: '1', showTests: {}, onRefresh() {} }, {}));
  assert.equal(new Set(same).size, 1, 'Me is the same in every tool');
  const plain = S.meHtml({ tool: 'review', me }, {});
  assert.equal(text(plain), `PJ Pee Jay Edrozo ${S.lastSignInText(me)} Settings Theme Light Dark Auto Done moments New popup · Sound + voice › Team Team sign-ins › What's new › Install the app › Sign out`);
});
test('the name menu (v2.4.0, compact): name + Last signed in · Theme Light/Dark/Auto · [tests · Refresh] · What\'s new (version) · Team sign-ins · Install · Sign out', () => {
  const h = S.meHtml({ tool: 'kpi', me, version: '1.28.0', showTests: { label: 'Show test clients' }, onRefresh() {} }, { theme: 'auto', showTests: false, updated: '4:57 PM' }, { compact: true });
  assert.equal(text(h), `PJ Pee Jay Edrozo ${S.lastSignInText(me)} Theme Light Dark Auto Done moments New popup › Show test clients Refresh now updated 4:57 PM What's new v1.28.0 › Team sign-ins › Install the app › Sign out`);
  assert.match(h, /^<div class="lv-mh"><span class="lv-av">PJ<\/span><div><b class="lv-n">Pee Jay Edrozo<\/b><small class="lv-l">Last signed in /);
  assert.match(h, /<div class="lv-dv" role="separator"><\/div><button type="button" class="lv-mi out" data-lv="signout" role="menuitem">Sign out<\/button><\/div>$/);
  assert.doesNotMatch(h, /lv-gl/, 'no group labels in the compact menu');
  assert.match(h, /data-v="auto" aria-pressed="true"/);
  assert.equal(text(S.meHtml({ tool: 'review', me }, {}, { compact: true })), `PJ Pee Jay Edrozo ${S.lastSignInText(me)} Theme Light Dark Auto Done moments New popup › What's new › Team sign-ins › Install the app › Sign out`);
  assert.ok(!S.meHtml({ tool: 'review', me: { name: '<b>x</b>' } }, {}, { compact: true }).includes('<b>x</b>'), 'escaped');
});

// ---------------------------------------------------------------- v2.4.0 greeting (pure parts)
const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m }; };
test('greeting: once per person per day by the device date; a new day plays again; storage that fails = never plays', () => {
  const st = memStore();
  const d1 = new Date(2026, 10, 18, 8, 5), d1b = new Date(2026, 10, 18, 23, 59), d2 = new Date(2026, 10, 19, 0, 1);
  assert.equal(S.dayKey(d1), '2026-11-18');
  assert.equal(S.claimGreetingDay(st, d1), true, 'first load of the day');
  assert.equal(S.claimGreetingDay(st, d1b), false, 'not again that day (moving between Clients / Scorecards / Reviews)');
  assert.equal(S.claimGreetingDay(st, d2), true, 'next day');
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(S.claimGreetingDay(broken, d1), false, 'storage throws → no greeting');
  const noWrite = { getItem: () => null, setItem() {} };   // writes silently dropped (private mode) → can't remember → no greeting
  assert.equal(S.claimGreetingDay(noWrite, d1), false);
  assert.equal(S.claimGreetingDay(null, d1), false);
});
test('greeting: morning < 12, afternoon < 18, evening after (device time)', () => {
  assert.deepEqual([0, 11, 12, 17, 18, 23].map(S.greetingFor), ['Good morning', 'Good morning', 'Good afternoon', 'Good afternoon', 'Good evening', 'Good evening']);
});
test('greeting: the first name from the Google sign-in ("first"), else the same rule as the initials ("PJ" stays "PJ")', () => {
  assert.equal(S.firstName({ name: 'PJ', first: 'PJ', email: 'peejay@x.com' }), 'PJ');
  assert.equal(S.firstName({ name: 'Maria Lopez', first: 'Maria' }), 'Maria');
  assert.equal(S.firstName({ name: 'Maria Lopez' }), 'Maria');
  assert.equal(S.firstName({ email: 'sam.ortiz@x.com' }), 'Sam');
  assert.equal(S.firstName({}), '');
});
test('greeting HTML: date eyebrow, letters, gold name, numbers (0 = green All clear, missing = left out), skip line; escaped', () => {
  const date = new Date(2026, 10, 18, 15, 0);
  const h = S.greetingHtml({ hour: 15, date, name: 'PJ', counts: { reviews: 2, scorecards: 1, clients: 0 } });
  assert.match(h, /<div class="lv-gr-eb">Wednesday, November 18<\/div>/);
  assert.equal(text(h.replace(/<div class="lv-gr-st">[\s\S]*?<\/div><\/div>\n/, '')).replace(/ /g, ''), 'Wednesday,November18GOODAFTERNOON,PJTapanywheretoskip');
  assert.match(h, /aria-label="Good afternoon, PJ"/);
  assert.match(h, /<span class="lv-gr-wd"><span class="l" style="--i:0">G<\/span>/, 'letter by letter, words never break');
  assert.match(h, /<br class="lv-gr-br"><span class="lv-gr-wd"><span class="l nm" style="--i:16">P<\/span>/, 'name on its own line on phones, gold');
  assert.match(h, /<div class="r" data-k="reviews"><em data-to="2">0<\/em>reviews need you<\/div>/);
  assert.match(h, /<div class="a" data-k="scorecards"><em data-to="1">0<\/em>scorecard needs attention<\/div>/);
  assert.match(h, /<div class="ok" data-k="clients"><em>All clear<\/em>clients in progress<\/div>/, "All clear keeps the item's own label");
  const some = S.greetingHtml({ hour: 9, date, name: 'PJ', counts: { clients: 3 } });
  assert.match(some, /GOOD|G<\/span>/); assert.doesNotMatch(some, /data-k="reviews"|data-k="scorecards"/, 'missing counts are left out');
  assert.match(some, /<em data-to="3">0<\/em>clients in progress/);
  assert.doesNotMatch(S.greetingHtml({ hour: 20, date, name: 'PJ', counts: {} }), /lv-gr-st/, 'no numbers at all = no row');
  assert.match(S.greetingHtml({ hour: 20, date, name: 'PJ' }), /aria-label="Good evening, PJ"/);
  assert.ok(!S.greetingHtml({ hour: 9, date, name: '<i>x</i>' }).includes('<i>x</i>'), 'escaped');
});
test('greeting counts: the tool\'s own within ~1 s (never waits longer), the others from their last load (12 h), never throws', async () => {
  const now = Date.now();
  // v2.4.1: fresh counts are remembered, so each case starts from the same remembered set (its own store)
  const seed = () => { const s = memStore(); S.noteCount('reviews', 2, s, now - 3600e3); S.noteCount('scorecards', 1, s, now - 13 * 3600e3); S.noteCount('bogus', 5, s, now); return s; };
  assert.deepEqual(S.cachedCounts(seed(), now), { reviews: 2 }, 'scorecards too old, bogus ignored');
  assert.deepEqual(await S.greetCounts(() => Promise.resolve({ clients: 4 }), { store: seed(), now, wait: 50 }), { reviews: 2, clients: 4 });
  const t0 = Date.now();
  assert.deepEqual(await S.greetCounts(() => new Promise(() => {}), { store: seed(), now, wait: 60 }), { reviews: 2 }, 'own count late = left out');
  assert.ok(Date.now() - t0 < 400, 'no long wait');
  assert.deepEqual(await S.greetCounts(() => { throw new Error('x'); }, { store: seed(), now, wait: 50 }), { reviews: 2 });
  assert.deepEqual(await S.greetCounts(undefined, { store: { getItem() { throw new Error('no'); } }, now, wait: 20 }), {});
  assert.deepEqual(await S.greetCounts(() => ({ reviews: 0 }), { store: seed(), now, wait: 50 }), { reviews: 0 }, 'own count wins; 0 kept (All clear)');
});
// v2.4.1: Sign out replays the greeting; all three counts read fresh when it starts
test('greeting v2.4.1: Sign out forgets "greeted today" (next load plays again, same day); nothing else does; storage that fails = no greeting', () => {
  const st = memStore(), d1 = new Date(2026, 10, 19, 9), d1b = new Date(2026, 10, 19, 15);
  assert.equal(S.claimGreetingDay(st, d1), true);
  assert.equal(S.claimGreetingDay(st, d1b), false, 'tool switch / reload / app reopened / Access renewing the session: same page load rules, no replay');
  S.forgetGreetingDay(st);
  assert.equal(st.getItem(S.GREET_DAY_KEY), null, 'Sign out clears the mark');
  assert.equal(S.claimGreetingDay(st, d1b), true, 'signed back in the same day: plays again');
  assert.equal(S.claimGreetingDay(st, d1b), false, 'then once a day again');
  S.forgetGreetingDay({ removeItem() { throw new Error('blocked'); } });   // never throws
  S.forgetGreetingDay(null);
  assert.equal(S.claimGreetingDay({ getItem() { throw new Error('blocked'); }, setItem() {}, removeItem() {} }, d1), false, 'storage blocked: still no greeting');
  // signOut() is the only caller (the menu's Sign out and the tools' own Sign out buttons); toSignIn (expired session) is not
  const src = fs.readFileSync(path.join(DIR, 'lfmp-session.js'), 'utf8');
  assert.match(src, /export async function signOut\(\) \{\n {2}clearLegacy\(\); forgetGreetingDay\(\);/);
  assert.equal((src.match(/forgetGreetingDay\(\)/g) || []).length, 1, 'only signOut forgets the day');
  assert.doesNotMatch(src.slice(src.indexOf('export function toSignIn'), src.indexOf('export async function signOut')), /forgetGreetingDay/);
});
test('greeting v2.4.1: every count read at once; what is in by the deadline shows; slow = last known (12 h) or left out; failed = ignored; late ones are still noted', async () => {
  const st = memStore(), now = Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms));
  S.noteCount('reviews', 7, st, now - 3600e3);   // last known, 1 h old
  let late;
  const reads = [() => Promise.resolve({ clients: 4 }), () => sleep(10).then(() => ({ scorecards: 0 })), () => new Promise(r => { late = r; })];
  const t0 = Date.now();
  assert.deepEqual(await S.greetCounts(reads, { store: st, now, wait: 80 }), { clients: 4, scorecards: 0, reviews: 7 }, 'slow reviews read = the last known count');
  assert.ok(Date.now() - t0 < 300, 'never waits past the deadline');
  assert.deepEqual(S.cachedCounts(st), { clients: 4, scorecards: 0, reviews: 7 }, 'fresh counts noted');
  late({ reviews: 3 }); await sleep(5);
  assert.equal(S.cachedCounts(st).reviews, 3, 'a late read is still noted for next time');
  // a failed read: the other two still show; never throws
  const st2 = memStore();
  assert.deepEqual(await S.greetCounts([() => ({ clients: 1 }), () => Promise.reject(new Error('down')), () => { throw new Error('x'); }, () => ({ reviews: 2 })], { store: st2, now, wait: 50 }), { clients: 1, reviews: 2 });
  // all in early: resolves at once (no waiting for the deadline)
  const t1 = Date.now(); await S.greetCounts([() => ({ clients: 1 }), () => ({ reviews: 2 })], { store: st2, now, wait: 2000 }); assert.ok(Date.now() - t1 < 200);
  // junk answers are ignored
  assert.deepEqual(await S.greetCounts([() => ({ clients: null, reviews: 'x', scorecards: undefined }), () => null], { store: memStore(), now, wait: 30 }), {});
});
test('greeting v2.4.2: the team site\'s numbers first; a per-tool read only if it came in first; then last known (12 h); else left out', async () => {
  const now = Date.now(), sleep = ms => new Promise(r => setTimeout(r, ms));
  const seed = () => { const s = memStore(); S.noteCount('reviews', 5, s, now - 3600e3); return s; };
  // the team site answers at once with all three: used, and the greeting doesn't wait for the slower tool reads
  let st = seed(); const t0 = Date.now();
  assert.deepEqual(await S.greetCounts([() => sleep(300).then(() => ({ clients: 9 }))], { store: st, now, wait: 1000, server: () => ({ clients: 1, scorecards: 2, reviews: 3 }) }), { clients: 1, scorecards: 2, reviews: 3 });
  assert.ok(Date.now() - t0 < 200, 'resolves as soon as every number has an answer');
  // a per-tool read that came in before the team site wins (fresher); the team site fills the rest
  st = seed();
  assert.deepEqual(await S.greetCounts([() => ({ clients: 9 })], { store: st, now, wait: 300, server: () => sleep(40).then(() => ({ clients: 1, scorecards: 2 })) }), { clients: 9, scorecards: 2, reviews: 5 }, 'reviews: last known');
  assert.equal(S.cachedCounts(st).clients, 9, 'the fresher per-tool number is the one noted');
  // team site down: per-tool reads, then last known, else left out
  st = seed();
  assert.deepEqual(await S.greetCounts([() => ({ scorecards: 4 })], { store: st, now, wait: 80, server: () => Promise.reject(new Error('500')) }), { scorecards: 4, reviews: 5 });
  // team site slow (past the cut): same as down
  st = seed();
  assert.deepEqual(await S.greetCounts([() => ({ clients: 2 })], { store: st, now, wait: 80, server: () => sleep(500).then(() => ({ clients: 1, reviews: 1 })) }), { clients: 2, reviews: 5 });
  // nothing at all: nothing shown, never throws
  assert.deepEqual(await S.greetCounts([], { store: memStore(), now, wait: 30, server: () => { throw new Error('x'); } }), {});
});
test('greeting v2.4.2: the team site\'s answer is picked by each tool\'s own "Show test clients" in this browser; junk ignored', () => {
  const res = { counts: { clients: { hidden: 1, shown: 2, at: 0 }, scorecards: { hidden: 3, shown: 4, at: 0 }, reviews: { hidden: 0, shown: 6, at: 0 } } };
  const st = memStore();
  assert.deepEqual(S.pickServerCounts(res, st), { clients: 1, scorecards: 3, reviews: 0 }, 'test clients hidden everywhere (0 kept)');
  st.setItem('sab-show-tests', '1'); st.setItem('ar-admin-tests', '1');
  assert.deepEqual(S.pickServerCounts(res, st), { clients: 2, scorecards: 3, reviews: 6 }, 'per tool');
  assert.deepEqual(S.GREET_TESTS_KEYS, { clients: 'sab-show-tests', scorecards: 'leadpro-admin-tests', reviews: 'ar-admin-tests' });
  assert.deepEqual(S.pickServerCounts({ counts: { clients: { hidden: 'x' }, reviews: null } }, st), {});
  assert.deepEqual(S.pickServerCounts(null, { getItem() { throw new Error('blocked'); } }), {});
  assert.deepEqual(S.pickServerCounts(res, { getItem() { throw new Error('blocked'); } }), { clients: 1, scorecards: 3, reviews: 0 }, 'storage blocked = hidden');
});
test('loadBuilderRecords v2.4.2: another GitHub reader (the team site\'s server) gets its own read, never the page\'s cached one', async () => {
  const seen = [];
  const gh = async (m, p, b, o) => { seen.push([m, p]); if (p.endsWith('/contents/records?ref=main')) return Response.json([{ type: 'file', name: 'a1.json' }]); return new Response(JSON.stringify({ id: 'a1', businessName: 'Acme Law P.C', review: { code: 'acme' }, kpi: { slug: 'acme' } }), { status: 200 }); };
  const recs = await S.loadBuilderRecords({ gh });
  assert.deepEqual(recs, [{ id: 'a1', name: 'Acme Law P.C.', locationId: '', reviewCode: 'acme', kpiSlug: 'acme', linkSent: null, brand: 'LFMP' }]);   // v2.7.0: + brand (no brand on the record = LFMP)
  assert.ok(seen.every(([m]) => m === 'GET') && seen.length === 2);
  assert.equal(await S.loadBuilderRecords({ gh: async () => { throw new Error('down'); } }).then(r => r.length), 0, 'never throws');
});
test('greeting v2.4.1: each tool reads its own count from its list + the other two with their greet-count module on this site', async () => {
  assert.deepEqual(S.TOOL_KIND, { builder: 'clients', kpi: 'scorecards', review: 'reviews' });
  assert.deepEqual(S.GREET_SOURCES, { clients: '/ghl-subaccount-builder-page/greet-count.js', scorecards: '/leadpro-kpi/admin/greet-count.mjs', reviews: '/automation-review/admin/greet-count.mjs' });
  for (const [tool, mine] of Object.entries(S.TOOL_KIND)) {
    const asked = [], own = () => ({ [mine]: 1 });
    const reads = S.greetReads(tool, own, k => { asked.push(k); return Promise.resolve({ [k]: 0 }); });
    assert.equal(reads[0], own, `${tool}: its own count first`);
    await Promise.all(reads.slice(1).map(r => r()));
    assert.deepEqual(asked.sort(), S.GREET_KINDS.map(k => k[0]).filter(k => k !== mine).sort(), `${tool}: reads the other two only`);
  }
  assert.equal(S.greetReads('builder', undefined, () => ({})).length, 2, 'no own count (still loading) → just the other two');
});
test('"Your menu ›" hint: only in the first 3 days after this release (per device), never when storage fails', () => {
  const st = memStore();
  assert.equal(S.menuHintDue(st, new Date(2026, 10, 19, 9)), true);
  assert.equal(S.menuHintDue(st, new Date(2026, 10, 21, 23)), true, 'day 3');
  assert.equal(S.menuHintDue(st, new Date(2026, 10, 22, 0, 5)), false, 'day 4');
  assert.equal(S.menuHintDue({ getItem() { throw new Error('x'); } }), false);
});

test('page head: title + summary (desktop), search, filter; the "Needs …" label is red only when asked', () => {
  const h = S.pageHeadHtml({ title: 'Clients', summary: '12 sub-accounts · 1 setting up', search: { id: 'q', placeholder: 'Search 12 clients' }, active: 'all',
    segs: [{ key: 'all', label: 'All 12', phone: 'All' }, { key: 'needs', label: 'Needs you · 1', red: true }, { key: 'done', label: 'Done · 0', phone: 'Done', red: false }] });
  assert.match(h, /<h1 class="lv-h1">Clients<\/h1>/); assert.match(h, /data-lv-sum>12 sub-accounts · 1 setting up</);
  assert.match(h, /id="q" placeholder="Search 12 clients"/);
  assert.match(h, /data-lv-seg="all" aria-pressed="true"><span class="lv-d">All 12<\/span><span class="lv-p">All<\/span>/);
  assert.equal((h.match(/lv-red/g) || []).length, 1);
  assert.match(h, /<label class="lv-search lv-hit"><svg class="lv-ico"/, 'the whole search box (44px with its margin) focuses the input; one SVG magnifier first');
  assert.ok(!h.includes('⌕') && (h.match(/<svg/g) || []).length === 1, 'v1.16.0: the same SVG magnifier on desktop and phone, no "⌕" character');
  const a = S.pageHeadHtml({ title: 'T', segs: [{ key: 'x', label: 'Needs attention · 2', amber: true }], active: 'all' });
  assert.match(a, /<span class="lv-amber"><span class="lv-d">Needs attention · 2<\/span>/, 'amber = only notices');
  assert.ok(!a.includes('lv-red'));
  assert.match(S.pageHeadHtml({ title: 'Clients' }), /<div class="lv-sum" data-lv-sum><\/div>/, 'empty summary while loading: the element is there for the tool to fill');
});

test('row: name + sub-line · cells · Open › (desktop) / phone right + ›; text is escaped', () => {
  const h = S.rowHtml({ name: 'Smith & <b>Jones</b>', sub: 'Family Law · KPI setup failed at step 6 of 9', subPhone: 'Family Law · KPI setup failed', cells: [S.statusHtml('red', 'Needs you'), S.squaresHtml(['red', '', ''])], attrs: 'data-rec="x"' });
  assert.match(h, /^<div class="lv-row" role="button" tabindex="0" aria-label="Open Smith &amp; &lt;b&gt;Jones&lt;\/b&gt;" data-rec="x">/);
  assert.match(h, /<div class="lv-mt lv-d">Family Law · KPI setup failed at step 6 of 9<\/div><div class="lv-mt lv-p">Family Law · KPI setup failed<\/div>/);
  assert.match(h, /<div class="lv-c lv-op">Open ›<\/div><div class="lv-c lv-pr"><span class="lv-st red"><b><\/b>Needs you<\/span><\/div><span class="lv-chev" aria-hidden="true">›<\/span>/);
  assert.match(S.squaresHtml(['green', '', 'blue']), /<i class="green"><\/i><i class="o"><\/i><i class="blue"><\/i><em>KPI · Review · Forms<\/em>/);
  assert.match(S.bigHtml('—', 'leads · 90 days', true), /lv-big red">—<small>leads · 90 days/);
});

// colour tokens (approved 17 Nov 2026: reference + PJ's AA fixes)
const tokens = block => Object.fromEntries([...block.matchAll(/--([a-z-]+):(#[0-9a-f]{6})/g)].map(m => [m[1], m[2]]));
const LIGHT = tokens(V2.slice(V2.indexOf(':root.lfmp-v2{'), V2.indexOf('}', V2.indexOf(':root.lfmp-v2{'))));
const DARK = tokens(V2.slice(V2.indexOf(':root.lfmp-v2[data-theme="dark"]{'), V2.indexOf('}', V2.indexOf(':root.lfmp-v2[data-theme="dark"]{'))));
test('colours: one neutral set + gold/red/blue/green/amber, light and dark (approved values)', () => {
  assert.deepEqual([LIGHT.bg, LIGHT.panel, LIGHT.line, LIGHT.gold, LIGHT['gold-ink'], LIGHT.mut, LIGHT.sub, LIGHT.chev, LIGHT.red, LIGHT.green, LIGHT.blue, LIGHT.amber, LIGHT.ink],
    ['#f6f5f2', '#ffffff', '#e6e2da', '#a8741f', '#8e621a', '#6b6861', '#6a6863', '#949494', '#b8322b', '#2e8a58', '#3c6fb5', '#c58a1c', '#151515']);
  assert.deepEqual([DARK.bg, DARK.panel, DARK.line, DARK.gold, DARK.mut, DARK.red, DARK.green, DARK.blue, DARK.amber, DARK.ink],
    ['#0e0e10', '#16161a', '#26262b', '#d9a64e', '#8f8e94', '#ef5a52', '#46b37f', '#7aa7e6', '#e0a43a', '#f2f1ee']);
  // the auto-dark block is the same as the forced-dark one
  const auto = tokens(V2.slice(V2.indexOf('@media (prefers-color-scheme:dark){:root.lfmp-v2'), V2.indexOf('}}', V2.indexOf('@media (prefers-color-scheme:dark){:root.lfmp-v2'))));
  assert.deepEqual(auto, DARK);
  // no other accent: the tools' old --acc is neutral ink
  assert.equal(LIGHT.acc, LIGHT.ink); assert.equal(DARK.acc, DARK.ink);
});

const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
test('AA contrast: every text pair the shell uses passes 4.5:1 (icons 3:1)', () => {
  for (const [T, name] of [[LIGHT, 'light'], [DARK, 'dark']]) {
    const pairs = [['ink', 'bg'], ['ink', 'panel'], ['mut', 'panel'], ['mut', 'bg'], ['mut', 'seg'], ['sub', 'seg'], ['sub', 'panel'], ['gold-ink', 'panel'], ['gold-ink', 'soft'], ['red', 'panel'], ['red', 'seg'], ['gold-on', 'gold'], ['ink', 'segon'], ['amber-seg', 'seg'], ['amber-seg', 'segon']];
    for (const [f, b] of pairs) assert.ok(ratio(T[f], T[b]) >= 4.5, `${name}: ${f} ${T[f]} on ${b} ${T[b]} = ${ratio(T[f], T[b]).toFixed(2)}`);
    assert.ok(ratio(T.chev, T.panel) >= 3, `${name}: chevron`);
  }
});

test('gold only on: + button, current tab/nav, top line, initials, on-switches', () => {
  const rules = [...V2.matchAll(/([^{}]+)\{([^{}]*var\(--gold[^{}]*)\}/g)].map(m => m[1].trim().replace(/^.*\*\/\s*/s, ''));
  // v1.16.0: + the What's new card's small dot and its "See what's new" button (PJ: gold, primary)
  const allowed = [/^\.lv-av$/, /^\.lv-top$/, /^\.lv-plus$/, /^\.lv-tg\[aria-checked="true"\]$/, /^\.lv-band$/, /^\.lv-pplus$/, /^\.lv-tab\[aria-current="page"\]( svg)?$/, /^\.lv-note-dot$/, /^\.lv-note-go$/, /^\.lv-load-mk i:nth-child\(3\)$/,
    // v2.3.0 busy states (PJ's previews LFMP_Busy_Options_v2 option 1 "Gold fill", No Silent Clicks, Busy States): the top line,
    // the button fill / outline, the area bar, the progress card's bar and its running step (+ its pulse keyframe)
    /^\.lv-net$/, /^\.lv-work$/, /^\.lv-bz>\.lv-bz-fill$/,
    // v2.4.0 (PJ's Greeting 1+9): the ring on the initials (hover / menu open), the "Your menu ›" hint, and the greeting's
    // own pieces (glow, hairlines, base block, gold name, line, number separators, amber number)
    /^\.lfmp-v2 \.lv-avbtn:hover \.lv-av,\.lfmp-v2 \.lv-avbtn\[aria-expanded="true"\] \.lv-av$/, /^\.lfmp-v2 \.lv-mhint$/, /^\.lv-gr[\w\-:>.() ,\[\]="]*$/, /^(:root\.lfmp-v2(\.lfmp-v2)? (\.btn|button)?\.lv-bz,?\s*)+$/, /^:root\.lfmp-v2 \.btn\.lv-bz,:root\.lfmp-v2 button\.lv-bz$/, /^\.lv-area-bar i$/, /^\.lv-pc-bar i$/, /^\.lv-pc-s\.run \.lv-pc-d$/, /^50%$/,
    // v2.5.0 long jobs (PJ's Working Animation variation B + Done card): the working bar's fill, the bike frame, a running job's dot in the bell
    /^\.lv-job-bar i$/, /^\.lv-jk-gold$/, /^\.lv-jobs-d\.run$/,
    // v2.7.0 brand filter (PJ's brand-filter preview): "a filter is on" = the small dot on "WPP ▾" and the phone Filter badge
    /^\.lv-bfdot$/, /^\.lv-fbd$/];
  assert.ok(rules.length >= 7);
  for (const r of rules) assert.ok(allowed.some(a => a.test(r)), `gold used on ${r}`);
});

test('scoped: v2 rules only touch pages with <html class="lfmp-v2"> or the shell\'s own .lv-* elements (sign-in / Moved pages unchanged)', () => {
  const body = V2.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes\s+lv-[\w-]+\{(?:[^{}]*\{[^{}]*\})+\}/g, '').replace(/@media[^{]+\{/g, '');
  const sels = [...body.matchAll(/([^{}]+)\{[^{}]*\}/g)].flatMap(m => m[1].split(',').map(s => s.trim())).filter(Boolean);
  assert.ok(sels.length > 80);
  for (const s of sels) assert.ok(/^(:root\.lfmp-v2|\.lfmp-v2 |\.lv-|(body|div|a|button)\.lv-)/.test(s), `unscoped selector: ${s}`);
});

// ---------------------------------------------------------------- v1.16.0
test('What\'s new card: dot + "What\'s new · v1.16.0", title, one short line, See what\'s new · Got it; escaped; no ALL CAPS', () => {
  const h = S.newsCardHtml({ version: 'v1.16.0', title: 'A <calmer> look', line: 'Pop-ups match the lists.' });
  assert.match(h, /^<aside class="lv-note" role="status" aria-live="polite" aria-label="What's new" data-lv-news>/);
  assert.match(h, /<b class="lv-note-dot" aria-hidden="true"><\/b>What's new · v1\.16\.0<\/p>/);
  assert.match(h, /<p class="lv-note-t">A &lt;calmer&gt; look<\/p><p class="lv-note-l">Pop-ups match the lists\.<\/p>/);
  assert.match(h, /<button type="button" class="lv-note-go" data-lv-news-go>See what's new<\/button><button type="button" class="lv-note-ok" data-lv-news-ok>Got it<\/button>/);
  const rule = sel => (V2.match(new RegExp(`(^|\\n)${sel.replace(/[.[\]]/g, '\\$&')}\\{([^}]*)\\}`)) || [])[2] || '';
  for (const sel of ['.lv-note', '.lv-note-meta', '.lv-note-t', '.lv-note-go', '.lv-note-ok']) { assert.ok(rule(sel), `${sel} has a rule`); assert.ok(!/uppercase/.test(rule(sel)), `${sel}: no ALL CAPS`); }
  assert.match(rule('.lv-note'), /border-radius:14px/); assert.ok(!/border-top:3px/.test(rule('.lv-note')), 'no top bar');
  assert.ok(!/var\(--d\)/.test(rule('.lv-note-t')), 'title not in the display font');
  assert.equal(rule('.lv-note-ok').replace(/;$/, ''), rule('.lv-retry').replace(/;$/, ''), 'Got it looks like Sign out / Try again');
});
test('What\'s new one short line: own line > summary > first item, cut at a word', () => {
  assert.equal(S.newsLine({ line: 'L', summary: 'S', items: [{ text: 'I' }] }), 'L');
  assert.equal(S.newsLine({ summary: 'S', items: [{ text: 'I' }] }), 'S');
  assert.equal(S.newsLine({ items: [{ text: 'First item.' }] }), 'First item.');
  const long = S.newsLine({ items: [{ text: 'word '.repeat(60) }] });
  assert.ok(long.length <= 120 && long.endsWith('…') && !/\s…$/.test(long), long);
  assert.equal(S.newsLine(null), '');
});
test('display names: a lost last dot comes back (P.C / P.A / L.L.C / P.L.L.C); other names unchanged', () => {
  assert.equal(S.displayName('Hedayati Law Group, P.C'), 'Hedayati Law Group, P.C.');
  assert.equal(S.displayName('Hedayati Law Group, P.C.'), 'Hedayati Law Group, P.C.');
  assert.equal(S.displayName('Pardy & Rodriguez, P.A'), 'Pardy & Rodriguez, P.A.');
  assert.equal(S.displayName('Acme L.L.C'), 'Acme L.L.C.');
  assert.equal(S.displayName('Sralla Family Law, PLLC'), 'Sralla Family Law, PLLC');
  assert.equal(S.displayName('ZZ TEST 2'), 'ZZ TEST 2');
  assert.equal(S.displayName('  The   Mahdavi Law Firm '), 'The Mahdavi Law Firm');
  assert.equal(S.displayName('Plan B'), 'Plan B');
  assert.equal(S.displayName(null), '');
});
test('v2 components: buttons, chips, tags, filters, tabs, dialogs and form labels are sentence case and rounded (only under .lfmp-v2)', () => {
  const block = V2.slice(V2.indexOf('*/', V2.indexOf('v2 COMPONENTS')) + 2);
  const rules = [...block.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => [m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim(), m[2]]);
  const find = sel => rules.find(([s]) => s.split(',').map(x => x.trim()).includes(sel))?.[1] || '';
  for (const sel of [':root.lfmp-v2 .btn', ':root.lfmp-v2 .lfmp-out', ':root.lfmp-v2 .chip', ':root.lfmp-v2 .tag', ':root.lfmp-v2 .pill', ':root.lfmp-v2 .seg button', ':root.lfmp-v2 .dtabs button', ':root.lfmp-v2 .dptabs a', ':root.lfmp-v2 label.f', ':root.lfmp-v2 .dlg h3', ':root.lfmp-v2 .lfmp-dlg-h h2', ':root.lfmp-v2 .startopt b', ':root.lfmp-v2 .back']) {
    const r = find(sel); assert.ok(r, `${sel} has a rule`); assert.match(r, /text-transform:none/, `${sel}: sentence case`);
  }
  for (const sel of [':root.lfmp-v2 .btn', ':root.lfmp-v2 .chip', ':root.lfmp-v2 .seg', ':root.lfmp-v2 .panel', ':root.lfmp-v2 .dset', ':root.lfmp-v2 .vcard', ':root.lfmp-v2 .lfmp-dlg', ':root.lfmp-v2 select', ':root.lfmp-v2 .xbtn'])
    assert.match(find(sel), /border-radius:(8|10|12|14|99)px/, `${sel}: rounded`);
  assert.ok(!/border-top:3px/.test(block), 'no top bars in the components');
  // small group labels stay ALL CAPS like Me → SETTINGS (.lv-gl): same size, weight and spacing
  assert.match(find(':root.lfmp-v2 .lbl'), /font:600 12px\/1\.3 var\(--b\);letter-spacing:\.08em;text-transform:uppercase;color:var\(--mut\)/);
});

test('motion helpers: loading mark markup (escaped), 20 s limit, all keyframes are lv-*, reduced motion turns every animation off', async () => {
  const h = S.loadingHtml('reviews');
  assert.match(h, /role="status"/); assert.match(h, /aria-label="Loading reviews…"/);
  assert.equal((h.match(/<i><\/i>/g) || []).length, 3, 'three blocks');
  assert.match(text(h), /^Loading reviews$/, 'visible text (the dots are CSS)');
  assert.ok(!S.loadingHtml('<b>').includes('<b>'), 'escaped');
  assert.equal(S.LOAD_LIMIT_MS, 20000);
  const er = S.loadErrorHtml('Couldn\'t load <x>.', { attrs: 'data-act="reload"' });
  assert.match(er, /^<div class="lv-err" role="alert" data-lv-error><p class="lv-err-t"><b class="lv-err-dot" aria-hidden="true"><\/b><span>Couldn&#39;t load &lt;x&gt;\.<\/span><\/p><button type="button" class="lv-retry" data-lv-retry data-act="reload">Try again<\/button><\/div>$/);
  assert.match(CSS, /\.lv-retry\{font:600 13px\/normal var\(--b\);color:var\(--mut\);border:1px solid var\(--line\);padding:7px 12px;border-radius:8px;background:none;cursor:pointer/, 'Try again = Sign out style');
  assert.match(CSS, /\.lv-so\{font:600 13px\/normal var\(--b\);color:var\(--mut\);border:1px solid var\(--line\);padding:7px 12px;border-radius:8px;background:none;cursor:pointer/);
  assert.match(CSS, /\.lv-err\{margin-top:16px;background:var\(--panel\);border:1px solid var\(--line\);border-radius:14px/, 'card like the list');
  await assert.rejects(S.withLoadLimit(new Promise(() => {}), 30), e => e.code === 'slow' && /20 seconds/.test(e.message));
  assert.equal(await S.withLoadLimit(Promise.resolve(7), 30), 7);
  await assert.rejects(S.withLoadLimit(Promise.reject(new Error('boom')), 30), /boom/);
  // CSS: v1.16.0 loading mark = "LFMP_Loading_v2_Preview.html" option A (no tile; text-colour blocks, gold base)
  assert.match(CSS, /\.lv-load-mk\{display:flex;flex-direction:column;align-items:center;gap:5px;width:56px\}/, 'no tile: no background, no radius');
  assert.match(CSS, /\.lv-load-mk i\{display:block;height:9px;border-radius:3px;background:var\(--ink,#f2f1ee\);opacity:0;animation:2\.2s cubic-bezier\(\.2,\.8,\.2,1\) infinite\}/);
  assert.match(CSS, /\.lv-load-mk i:nth-child\(1\)\{width:55%;animation-name:lv-bl-top\}/);
  assert.match(CSS, /\.lv-load-mk i:nth-child\(3\)\{width:100%;background:var\(--gold,#d9a64e\);animation-name:lv-bl-base\}/);
  // drops start at 0 / 0.18 / 0.36 s of 2.2 s and last 0.4 s; all three hold to 70% and fade out together by 88%
  const kfs = Object.fromEntries([...CSS.matchAll(/@keyframes (lv-bl-\w+)\{(.*)\}\n/g)].map(m => [m[1], m[2]]));
  for (const [k, start] of [['lv-bl-base', 0], ['lv-bl-mid', 0.18], ['lv-bl-top', 0.36]]) {
    const b = kfs[k]; assert.ok(b, k);
    assert.match(b, /translateY\(-14px\)/, `${k} from -14px`);
    const pct = start ? Number(b.match(/0%,([\d.]+)%\{opacity:0/)[1]) : 0, inAt = Number(b.match(/([\d.]+)%,70%\{opacity:1;transform:none\}/)[1]);
    assert.ok(Math.abs(pct / 100 * 2.2 - start) < 0.005 && Math.abs((inAt - pct) / 100 * 2.2 - 0.4) < 0.005, `${k}: starts ${pct}% ends ${inAt}%`);
    assert.match(b, /88%,100%\{opacity:0;transform:none\}$/, `${k} fades with the others`);
  }
  assert.match(CSS, /\.lfmp-v2 \.lv-pm\.lv-pm-on\{transform:none;transition:transform \.5s cubic-bezier\(\.16,1,\.3,1\)/);
  assert.match(CSS, /\.lfmp-v2 \.lv-pm\{transform:translateX\(100%\);transition:transform \.4s cubic-bezier\(\.4,0,1,1\)/);
  assert.match(CSS, /\.lv-pm-sh\.lv-pm-on\{background-color:rgba\(0,0,0,\.55\);transition-duration:\.42s\}/);
  assert.match(CSS, /animation:lv-rise \.2s ease \.22s both/);
  assert.match(CSS, /animation:lv-fade \.3s ease both/);
  const kf = [...CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]);
  for (const k of kf.filter(k => /^lv-bl|^(lv-dt|lv-fade|lv-rise)$/.test(k))) assert.ok(k.startsWith('lv-'));
  const rm = CSS.slice(CSS.lastIndexOf('@media (prefers-reduced-motion:reduce){'));
  for (const sel of ['.lv-load-mk i{animation:none;opacity:1}', '.lv-fadein{animation:none}', '.lfmp-v2 .lv-pm,.lfmp-v2 .lv-pm-sh{transition:none !important}', '.lfmp-v2 .lv-pm.lv-pm-enter > *{animation:none}']) assert.ok(rm.includes(sel), `reduced motion: ${sel}`);
});

// ---------------------------------------------------------------- part 2: in a browser
const pwDir = process.env.PLAYWRIGHT_CORE || [path.resolve(HERE, '../../node_modules/playwright-core'), ...['../../../ghl-subaccount-builder', '../../ghl-subaccount-builder', '../../../../ghl-subaccount-builder'].map(p => path.resolve(HERE, p, 'node_modules/playwright-core'))].find(p => fs.existsSync(path.join(p, 'package.json')));
const tb = pwDir ? test : test.skip;
tb('in Chromium: Me items, bottom tabs, bell count, Sign out, Install the app, tap targets, no sideways scroll (390 + 1440)', { timeout: 120000 }, async () => {
  const { chromium } = createRequire(path.join(pwDir, 'package.json'))('./index.js');
  const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/lfmp-ui.css"></head><body><div id="app"><main class="lv-in" id="main"></main></div>
<script type="module">import * as S from '/lfmp-session.js'; const q = new URLSearchParams(location.search); window.log = [];
window.shell = S.mountShell({ tool: q.get('tool'), me: { name: 'Pee Jay Edrozo', email: 'pj@example.com', lastSignIn: '2026-11-16T11:31:00Z' }, root: document.getElementById('app'), version: '1.0.0',
 plus: q.get('tool') === 'review' ? null : { label: 'New', onClick: () => log.push('plus') }, bell: q.get('tool') === 'kpi' ? { label: 'Sync issues', onClick: () => log.push('bell') } : null,
 showTests: { on: false, onChange: v => log.push('tests:' + v) }, onRefresh: () => log.push('refresh'), onNews: () => log.push('news'), onHome: () => log.push('home'),
 newsDot: true, greet: q.get('greet') ? { count: () => new Promise(r => setTimeout(() => r({ clients: Number(q.get('greet')) }), Number(q.get('late') || 0))) } : false });
document.getElementById('main').innerHTML = S.pageHeadHtml({ title: 'X', search: { placeholder: 'Search' }, segs: [{ key: 'a', label: 'All' }, { key: 'b', label: 'B' }], active: 'a' }) + '<div class="lv-list">' + S.rowHtml({ name: 'A', sub: 'b', cells: [S.statusHtml('green', 'All set')] }) + '</div>';
document.querySelector('.lv-row').addEventListener('click', () => log.push('row'));</script></body></html>`;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/' || u.pathname.endsWith('/admin/') || u.pathname.endsWith('-page/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
    if (/^\/lfmp-(session|ui|done)\.(js|css)$/.test(u.pathname) && fs.existsSync(path.join(DIR, u.pathname.slice(1)))) { res.writeHead(200, { 'Content-Type': u.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' }); return res.end(fs.readFileSync(path.join(DIR, u.pathname.slice(1)))); }
    if (u.pathname === '/cdn-cgi/access/logout') { server.logouts = (server.logouts || 0) + 1; res.writeHead(200); return res.end(''); }
    if (u.pathname.startsWith('/signin/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<title>signed out</title>'); }
    if (u.pathname === '/api/signins') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ people: [{ name: 'PJ', email: 'pj@example.com', last: '2026-11-16T11:31:00Z', count30: 3 }] })); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    for (const [w, h] of [[390, 844], [1440, 900]]) {
      const phone = w < 880;
      for (const tool of ['builder', 'kpi', 'review']) {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        await page.goto(`${base}/?tool=${tool}`); await page.waitForSelector('.lv-row');
        // v2.4.0: the initials open the name menu on both bars; the phone's Me tab opens the Me screen
        const bar = phone ? '[data-lv-ptop]' : '[data-lv-top]', me = `${bar} [data-lv-pop]`;
        const log = () => page.evaluate(() => window.log.splice(0));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${tool} ${w}: no sideways scroll`);
        // + and bell
        assert.equal(await page.locator(`${bar} [data-lv="plus"]`).count(), tool === 'review' ? 0 : 1, `${tool}: + button`);
        assert.equal(await page.locator(`${bar} [data-lv="bell"]`).count(), 1, `${tool}: bell (v2.5.0: every tool; the Builder and Review admin get the shell's recent-jobs bell)`);
        if (tool !== 'review') { await page.click(`${bar} [data-lv="plus"]`); assert.deepEqual(await log(), ['plus']); }
        if (tool === 'kpi') {
          assert.equal(await page.isVisible(`${bar} [data-lv-badge]`), false, 'bell: no count = no badge');
          await page.evaluate(() => shell.setBell(2));
          assert.equal(await page.textContent(`${bar} [data-lv-badge]`), '2'); assert.equal(await page.isVisible(`${bar} [data-lv-badge]`), true);
          assert.equal(await page.getAttribute(`${bar} [data-lv="bell"]`, 'aria-label'), 'Sync issues: 2');
          assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(innerWidth < 880 ? '[data-lv-ptop] [data-lv-badge]' : '[data-lv-top] [data-lv-badge]')).backgroundColor), 'rgb(184, 50, 43)', 'red count');
          await page.click(`${bar} [data-lv="bell"]`); assert.deepEqual(await log(), ['bell']);
          await page.evaluate(() => shell.setBell(0)); assert.equal(await page.isVisible(`${bar} [data-lv-badge]`), false);
        }
        // the bar: no name, no Sign out (v2.4.0)
        assert.equal(await page.locator(`${bar} .lv-who, ${bar} .lv-so, ${bar} > [data-lv="signout"]`).count(), 0, 'no name block, no Sign out in the bar');
        // the name menu: items in order, each one works
        await page.click(`${bar} [data-lv="me"]`); await page.waitForSelector(`${me}:not([hidden]) .lv-mc`);
        assert.equal(await page.getAttribute(`${bar} [data-lv="me"]`, 'aria-expanded'), 'true');
        { const mh = await page.locator(`${me} .lv-mh`).innerText(); assert.ok(mh.includes('Pee Jay Edrozo') && mh.includes(S.lastSignInText({ lastSignIn: '2026-11-16T11:31:00Z' })), mh); }
        const items = await page.locator(`${me} .lv-mi`).evaluateAll(els => els.map(e => (e.firstElementChild || e).textContent.trim()));
        assert.deepEqual(items, ['Theme', 'Done moments', 'Show test clients', 'Refresh now', "What's new", 'Team sign-ins', 'Install the app', 'Sign out'], `${tool} ${w}: name menu items`);
        assert.equal(await page.locator(`${bar} .lv-av [data-lv-dot], ${bar} .lv-av .lv-dot`).count(), 0, 'no dot on the avatar');
        assert.equal(await page.locator(`${me} [data-lv="news"] .lv-ndot`).count(), 1, 'the new dot is on the What\'s new row');
        assert.equal(await page.evaluate(s => { const r = document.querySelector(s).getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0 && r.bottom <= innerHeight; }, me), true, `${tool} ${w}: the menu is fully on screen`);
        // review FIX 3.3: fully opaque from the first frame (no fade), a solid background, and on top: every item hit-tests
        // as the menu (nothing from the page shows through or sits above it)
        const op = await page.evaluate(s => { const p = document.querySelector(s), cs = getComputedStyle(p), bg = cs.backgroundColor.match(/[\d.]+/g).map(Number);
          return { opacity: [cs.opacity, ...p.getAnimations().map(a => getComputedStyle(p).opacity)], bgA: bg.length > 3 ? bg[3] : 1, z: Number(cs.zIndex),
            onTop: [...p.querySelectorAll('.lv-mi')].every(m => { const r = m.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width * 0.85, r.top + r.height / 2)?.closest('[data-lv-pop]') === p; }) }; }, me);
        assert.ok(op.opacity.every(o => o === '1') && op.bgA === 1 && op.z >= 70 && op.onTop, `${tool} ${w}: the menu is opaque and on top ${JSON.stringify(op)}`);
        // nothing clips it (a short page's body overflow cut the phone menu's bottom edge): its last 3px still hit-test as the menu
        assert.equal(await page.evaluate(s => { const p = document.querySelector(s), r = p.getBoundingClientRect(); return document.elementFromPoint(r.left + 30, r.bottom - 3)?.closest('[data-lv-pop]') === p; }, me), true, `${tool} ${w}: the menu's bottom edge isn't clipped`);
        // a click outside closes it; clicking the initials again closes it
        // v2.9.0: the five bottom tabs fill the width, so "outside" is empty page above them (not the bottom-left corner)
        await page.mouse.click(5, h - 120); assert.equal(await page.locator(`${me}:not([hidden])`).count(), 0, 'outside click closes the menu');
        await page.click(`${bar} [data-lv="me"]`); await page.click(`${bar} [data-lv="me"]`); assert.equal(await page.locator(`${me}:not([hidden])`).count(), 0, 'the initials toggle it');
        await page.click(`${bar} [data-lv="me"]`); await page.waitForSelector(`${me}:not([hidden]) .lv-mc`);
        if (phone) {
          // the Me tab still opens the Me screen (grouped), and closes the name menu
          await page.click('.lv-tabs [data-lv="metab"]'); await page.waitForSelector('[data-lv-me]:not([hidden]) .lv-mlist');
          assert.equal(await page.locator(`${me}:not([hidden])`).count(), 0, 'name menu closed');
          const sitems = await page.locator('[data-lv-me] .lv-mi').evaluateAll(els => els.map(e => (e.firstElementChild || e).textContent.trim()));
          assert.deepEqual(sitems, ['Theme', 'Done moments', 'Show test clients', 'Refresh now', 'Team sign-ins', "What's new", 'Install the app', 'Sign out'], `${tool}: Me screen items`);
          assert.equal(await page.getAttribute('.lv-tabs [data-lv="metab"]', 'aria-current'), 'page', 'Me tab gold while open');
          // a tool's toast (z-index 70, like the Builder's What's new) never covers Me; the bottom tabs stay on top of Me
          const covered = await page.evaluate(() => {
            const t = document.createElement('div'); t.id = 'fakeToast'; t.style.cssText = 'position:fixed;left:0;right:0;bottom:90px;height:420px;z-index:70;background:red'; document.body.append(t);
            const at = el => { const r = el.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); };
            const so = document.querySelector('[data-lv-me] [data-lv="signout"]'); so.scrollIntoView({ block: 'center' });
            const res = [at(so)?.closest('[data-lv="signout"]') === so, at(document.querySelector('.lv-tabs [data-lv="metab"]'))?.closest('[data-lv="metab"]') !== null];
            t.remove(); return res;
          });
          assert.deepEqual(covered, [true, true], 'Me above toasts, tabs above Me');
          await page.click('.lv-tabs [data-lv="metab"]'); assert.equal(await page.locator('[data-lv-me]:not([hidden])').count(), 0, 'the Me tab closes it');
          await page.click(`${bar} [data-lv="me"]`); await page.waitForSelector(`${me}:not([hidden]) .lv-mc`);   // back to the name menu
        }
        await page.click(`${me} [data-lv="theme"][data-v="dark"]`); assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
        await page.click(`${me} [data-lv="theme"][data-v="auto"]`); assert.equal(await page.getAttribute('html', 'data-theme'), null);
        await page.click(`${me} [data-lv="tests"]`); assert.equal(await page.getAttribute(`${me} [data-lv="tests"]`, 'aria-checked'), 'true');
        await page.click(`${me} [data-lv="refresh"]`); assert.deepEqual(await log(), ['tests:true', 'refresh']);
        if (phone) {   // tap targets ≥ 44px on phone (the visible control or its hit area)
          const small = await page.evaluate(() => [...document.querySelectorAll('[data-lv-ptop] button, [data-lv-ptop] a, .lv-tabs > *, [data-lv-me] button, [data-lv-me] a, .lv-seg button, .lv-search, .lv-row')].filter(e => e.offsetParent).map(e => {
            const r = e.getBoundingClientRect(), a = getComputedStyle(e, '::after'); const hit = e.classList.contains('lv-hit') ? [parseFloat(a.width), parseFloat(a.height)] : [0, 0];
            return [e.className || e.tagName, Math.max(r.width, hit[0]), Math.max(r.height, hit[1])]; }).filter(([, ww, hh]) => ww < 44 || hh < 44));
          assert.deepEqual(small, [], `${tool}: tap targets under 44px`);
        }
        await page.click(`${me} [data-lv="news"]`); assert.deepEqual(await log(), ['news']);
        assert.equal(await page.locator(`${me}:not([hidden])`).count(), 0, 'What\'s new closes Me');
        await page.click(`${bar} [data-lv="me"]`); await page.click(`${me} [data-lv="signins"]`);
        await page.waitForSelector('#lfmpSignins[open] .lfmp-signins'); await page.keyboard.press('Escape');
        await page.click(`${bar} [data-lv="me"]`); await page.click(`${me} [data-lv="install"]`);
        await page.waitForSelector('#lfmpInstall[open]'); assert.match(await page.textContent('#lfmpInstall'), /Install the app/); await page.keyboard.press('Escape');
        await page.evaluate(() => { window.LFMPApp = { openInstall: () => window.log.push('app-install') }; });
        await page.click(`${bar} [data-lv="me"]`); await page.click(`${me} [data-lv="install"]`); assert.deepEqual(await log(), ['app-install'], 'Install uses the app script when it is there');
        await page.click(`${bar} [data-lv="me"]`); await page.keyboard.press('Escape'); assert.equal(await page.locator(`${me}:not([hidden])`).count(), 0, 'Esc closes Me');
        // rows open with Enter too
        await page.focus('.lv-row'); await page.keyboard.press('Enter'); assert.deepEqual(await log(), ['row']);
        // home: this tool's own link goes home without a reload; another tool's tab/nav link navigates there
        await page.click(phone ? `.lv-tabs a[aria-current="page"]` : '.lv-nav a[aria-current="page"]'); assert.deepEqual(await log(), ['home']);
        const other = S.SHELL_TOOLS.find(t => t.id !== tool);
        await Promise.all([page.waitForURL(`${base}${other.path}`), page.click(phone ? `.lv-tabs a[href="${other.path}"]` : `.lv-nav a[href="${other.path}"]`)]);
        await page.goto(`${base}/?tool=${tool}`); await page.waitForSelector('.lv-row');
        // Sign out: Access logout, then /signin/?out=1
        const before = server.logouts || 0;
        await page.click(`${bar} [data-lv="me"]`); await page.click(`${me} [data-lv="signout"]`);   // v2.4.0: Sign out is in the name menu
        await page.waitForURL(`${base}/signin/?out=1`); assert.equal(server.logouts, before + 1, 'Access logout called');
        await page.close();
      }
    }
  } finally { await browser.close(); server.close(); }
});

tb('in Chromium: the greeting plays once a day, a click / key skips it (lift-away) and never blocks later clicks; late count left out; 0 = All clear; reduced motion / blocked storage = none; "Your menu ›" after it', { timeout: 120000 }, async () => {
  const { chromium } = createRequire(path.join(pwDir, 'package.json'))('./index.js');
  const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/lfmp-ui.css"></head><body><div id="app"><main class="lv-in" id="main"><button id="under">under</button></main></div>
<script type="module">import * as S from '/lfmp-session.js'; const q = new URLSearchParams(location.search); window.log = [];
document.getElementById('under').onclick = () => log.push('under');
window.shell = S.mountShell({ tool: 'builder', me: { name: 'PJ', first: 'PJ', email: 'pj@example.com' }, root: document.getElementById('app'), version: '1.0.0', plus: { label: 'New' },
 greet: { count: () => new Promise(r => setTimeout(() => r({ clients: Number(q.get('n') ?? 2) }), Number(q.get('late') || 0))),
  // v2.4.1: ?fresh=1 stands in for the other two tools' greet-count modules (slow=<kind> answers after 5 s, fail=<kind> fails)
  readOther: q.has('fresh') ? (k => q.get('fail') === k ? Promise.reject(new Error('down')) : new Promise(r => setTimeout(() => r({ [k]: Number(q.get(k) ?? 1) }), q.get('slow') === k ? 5000 : 60))) : undefined } });
window.played = shell.greeting; window.S = S;</script></body></html>`;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
    if (u.pathname === '/cdn-cgi/access/logout') { server.logouts = (server.logouts || 0) + 1; res.writeHead(200); return res.end(''); }
    if (u.pathname.startsWith('/signin/')) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<title>signed out</title>'); }
    if (/^\/lfmp-(session|ui|done)\.(js|css)$/.test(u.pathname) && fs.existsSync(path.join(DIR, u.pathname.slice(1)))) { res.writeHead(200, { 'Content-Type': u.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' }); return res.end(fs.readFileSync(path.join(DIR, u.pathname.slice(1)))); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const wait = ms => new Promise(r => setTimeout(r, ms));
  try {
    for (const [w, h] of [[1440, 900], [390, 844]]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      const page = await ctx.newPage();
      // first load of the day: it plays, with the count; the name on its own line on a phone
      await page.goto(`${base}/?n=2`); await page.waitForSelector('[data-lv-greet].play');
      const g = await page.evaluate(() => { const el = document.querySelector('[data-lv-greet]'); const br = getComputedStyle(el.querySelector('.lv-gr-br')).display;
        return { text: el.innerText.replace(/\s+/g, ' '), z: getComputedStyle(el).zIndex, br, fixed: getComputedStyle(el).position }; });
      assert.match(g.text, /GOOD (MORNING|AFTERNOON|EVENING), ?PJ/i); assert.equal(g.fixed, 'fixed');
      assert.equal(g.br, w < 880 ? 'inline' : 'none', 'name on its own line only on phones');
      await page.waitForFunction(() => document.querySelector('[data-lv-greet] [data-to]')?.textContent === '2', null, { timeout: 4000 });
      // it ends by itself (~3.75 s), then nothing is in the way
      assert.equal(await page.evaluate(() => played), true);
      assert.equal(await page.locator('[data-lv-greet]').count(), 0, 'gone');
      await page.click('#under'); assert.deepEqual(await page.evaluate(() => log.splice(0)), ['under'], 'clicks reach the page after it');
      // "Your menu ›" under the initials for ~2.6 s (first 3 days)
      const bar = w < 880 ? '[data-lv-ptop]' : '[data-lv-top]';
      assert.equal(await page.isVisible(`${bar} [data-lv-mhint]`), true, 'menu hint shows'); await wait(2800);
      assert.equal(await page.isVisible(`${bar} [data-lv-mhint]`), false, 'and goes');
      // same day again (moving between tools = a new page load): no greeting
      await page.goto(`${base}/?n=2`); await page.waitForSelector('.lv-in'); await wait(400);
      assert.equal(await page.locator('[data-lv-greet]').count(), 0, 'once a day');
      assert.equal(await page.evaluate(() => played), false);
      // a new day: plays again; a click anywhere skips it at once (lift-away), and the click doesn't reach the page
      await page.evaluate(() => localStorage.setItem('lfmp-greet-day', '2000-01-01'));
      await page.goto(`${base}/?n=0`); await page.waitForSelector('[data-lv-greet].play'); await wait(900);
      assert.match(await page.locator('[data-lv-greet] [data-k="clients"]').innerText(), /All clear/i, '0 = All clear');
      const t0 = Date.now(); await page.mouse.click(w / 2, h / 2);
      await page.waitForSelector('[data-lv-greet]', { state: 'detached', timeout: 1500 }); assert.ok(Date.now() - t0 < 1000, 'skip is quick');
      assert.deepEqual(await page.evaluate(() => log.splice(0)), [], 'the skip click did not press anything');
      await page.click('#under'); assert.deepEqual(await page.evaluate(() => log.splice(0)), ['under']);
      // a key skips it too; a late count (> ~1 s) with nothing remembered is left out (never waits, no spinner)
      // (v2.4.1: fresh counts are remembered, so forget the earlier ones here; the fallback is checked below)
      await page.evaluate(() => { localStorage.setItem('lfmp-greet-day', '2000-01-01'); localStorage.removeItem('lfmp-counts'); });
      const tl = Date.now(); await page.goto(`${base}/?n=5&late=3000`); await page.waitForSelector('[data-lv-greet].play', { timeout: 3000 });
      assert.ok(Date.now() - tl < 2500, 'starts within ~1 s even if the count is late');
      assert.equal(await page.locator('[data-lv-greet] .lv-gr-st').count(), 0, 'no number row');
      await page.keyboard.press('Escape'); await page.waitForSelector('[data-lv-greet]', { state: 'detached', timeout: 1500 });
      await ctx.close();
    }
    // v2.4.1: all three counts read fresh when it starts; whatever is in by the number row shows; nothing waits
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await ctx.newPage();
      const row = () => page.$$eval('[data-lv-greet] .lv-gr-st > div', els => els.map(e => [e.dataset.k, e.querySelector('[data-to]')?.dataset.to ?? 'clear']));
      const fresh = async qs => {
        await page.evaluate(() => localStorage.setItem('lfmp-greet-day', '2000-01-01'));
        const t0 = Date.now(); await page.goto(`${base}/?fresh=1&${qs}`); await page.waitForSelector('[data-lv-greet].play', { timeout: 3000 });
        assert.ok(Date.now() - t0 < 2500, 'starts at once');
        await wait(1700); return row();
      };
      await page.goto(base); await page.evaluate(() => { localStorage.removeItem('lfmp-counts'); });
      // one slow (reviews, 5 s) and one failed (scorecards), nothing remembered: the own count shows alone, on time
      assert.deepEqual(await fresh('n=4&slow=reviews&fail=scorecards'), [['clients', '4']]);
      await page.keyboard.press('Escape'); await wait(500);
      // all three in time: all three show, and they're noted for later
      assert.deepEqual(await fresh('n=4&scorecards=1&reviews=2'), [['reviews', '2'], ['scorecards', '1'], ['clients', '4']]);
      assert.deepEqual(Object.keys(JSON.parse(await page.evaluate(() => localStorage.getItem('lfmp-counts')))).sort(), ['clients', 'reviews', 'scorecards']);
      await page.keyboard.press('Escape'); await wait(500);
      // a failed read falls back to the last known count (≤ 12 h); the other two are fresh
      assert.deepEqual(await fresh('n=0&scorecards=3&fail=reviews'), [['reviews', '2'], ['scorecards', '3'], ['clients', 'clear']]);
      await page.keyboard.press('Escape'); await page.waitForSelector('[data-lv-greet]', { state: 'detached', timeout: 1500 });
      // Sign out in the name menu: the mark goes, so signing back in the same day plays it again
      await page.click('[data-lv-top] [data-lv="me"]'); await page.click('[data-lv-top] [data-lv-pop] [data-lv="signout"]');
      await page.waitForURL(/\/signin\/\?out=1$/);
      assert.equal(await page.evaluate(() => localStorage.getItem('lfmp-greet-day')), null, 'Sign out cleared the mark');
      await page.goto(`${base}/?n=2`); await page.waitForSelector('[data-lv-greet].play', { timeout: 3000 });
      await page.keyboard.press('Escape'); await wait(500);
      await page.reload(); await page.waitForSelector('.lv-in'); await wait(400);
      assert.equal(await page.locator('[data-lv-greet]').count(), 0, 'a reload after that: not again');
      // an expired session (sent to sign in, not a Sign out press) keeps the mark: no replay
      await page.evaluate(() => S.toSignIn()); await page.waitForURL(/\/signin\/\?next=/);
      assert.match(await page.evaluate(() => localStorage.getItem('lfmp-greet-day')), /^\d{4}-\d\d-\d\d$/);
      await page.goto(`${base}/?n=2`); await page.waitForSelector('.lv-in'); await wait(400);
      assert.equal(await page.locator('[data-lv-greet]').count(), 0, 'expired session: no replay');
      await ctx.close();
    }
    // Sign out on the phone (Me screen) clears it too
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await ctx.newPage();
      await page.goto(`${base}/?n=2`); await page.waitForSelector('[data-lv-greet].play'); await page.keyboard.press('Escape'); await wait(500);
      await page.click('[data-lv-tabs] [data-lv="metab"]'); await page.click('[data-lv-me] [data-lv="signout"]');
      await page.waitForURL(/\/signin\/\?out=1$/);
      assert.equal(await page.evaluate(() => localStorage.getItem('lfmp-greet-day')), null, 'phone Me → Sign out cleared the mark');
      await ctx.close();
    }
    // reduced motion: skipped entirely; blocked storage: never plays
    const rctx = await browser.newContext({ reducedMotion: 'reduce' }); const rp = await rctx.newPage();
    await rp.goto(base); await rp.waitForSelector('.lv-in'); await wait(400);
    assert.equal(await rp.locator('[data-lv-greet]').count(), 0, 'reduced motion: none'); await rctx.close();
    const sctx = await browser.newContext(); await sctx.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }); });
    const sp = await sctx.newPage(); await sp.goto(base); await sp.waitForSelector('.lv-in'); await wait(400);
    assert.equal(await sp.locator('[data-lv-greet]').count(), 0, 'storage blocked: none'); await sctx.close();
  } finally { await browser.close(); server.close(); }
});

tb('in Chromium: loading mark animates (still with reduced motion); panel slides in 0.50 s / out 0.40 s, shade dims, content rises, a press finishes the move, reopening swaps without a slide', { timeout: 120000 }, async () => {
  const { chromium } = createRequire(path.join(pwDir, 'package.json'))('./index.js');
  const PAGE = `<!doctype html><html lang="en" class="lfmp-v2"><head><meta charset="utf-8"><link rel="stylesheet" href="/lfmp-ui.css"><style>#sh{position:fixed;inset:0}#pn{position:fixed;top:0;right:0;bottom:0;width:400px;background:#fff}</style></head><body>
<div id="list">${'x'}</div><div id="sh" hidden></div><aside id="pn" hidden><h2>One</h2><p>Body</p></aside>
<script type="module">import * as S from '/lfmp-session.js'; window.S = S; document.getElementById('list').innerHTML = S.loadingHtml('clients');
const pn = document.getElementById('pn'), sh = document.getElementById('sh'); window.log = [];
window.open1 = () => { pn.hidden = false; sh.hidden = false; return S.panelOpen(pn, sh); };
window.close1 = () => S.panelClose(pn, sh, () => { pn.hidden = true; sh.hidden = true; log.push('done'); });</script></body></html>`;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
    if (/^\/lfmp-(session|ui|done)\.(js|css)$/.test(u.pathname) && fs.existsSync(path.join(DIR, u.pathname.slice(1)))) { res.writeHead(200, { 'Content-Type': u.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' }); return res.end(fs.readFileSync(path.join(DIR, u.pathname.slice(1)))); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const tx = p => p.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('pn')).transform).m41);
  try {
    for (const motion of ['no-preference', 'reduce']) {
      const ctx = await browser.newContext({ reducedMotion: motion, viewport: { width: 1000, height: 700 } });
      const page = await ctx.newPage(); await page.goto(base); await page.waitForSelector('.lv-load');
      const mk = await page.evaluate(() => { const i = document.querySelectorAll('.lv-load-mk i'); const cs = [...i].map(x => getComputedStyle(x)); const m = getComputedStyle(document.querySelector('.lv-load-mk'));
        return { names: cs.map(c => c.animationName), delays: cs.map(c => c.animationDelay), widths: [...i].map(x => Math.round(x.getBoundingClientRect().width)), bg: [m.backgroundColor, cs[0].backgroundColor, cs[2].backgroundColor], size: [m.width, m.borderRadius], label: document.querySelector('.lv-load').getAttribute('aria-label'), dots: getComputedStyle(document.querySelector('.lv-dots'), '::after').animationName }; });
      assert.deepEqual(mk.bg, ['rgba(0, 0, 0, 0)', 'rgb(21, 21, 21)', 'rgb(168, 116, 31)'], 'no tile; page text colour; gold base (light)');
      assert.deepEqual(mk.size, ['56px', '0px']); assert.equal(mk.label, 'Loading clients…');
      assert.deepEqual(mk.widths, [31, 45, 56], 'top 55% · middle 80% · base 100% of 56px');
      if (motion === 'reduce') { assert.deepEqual(mk.names, ['none', 'none', 'none'], 'icon still'); assert.equal(mk.dots, 'none'); }
      else { assert.deepEqual(mk.names, ['lv-bl-top', 'lv-bl-mid', 'lv-bl-base']); assert.deepEqual(mk.delays, ['0s', '0s', '0s'], 'one clock: the order is in the keyframes'); assert.equal(mk.dots, 'lv-dt'); }
      // panel
      assert.equal(await page.evaluate(() => open1()), true);
      if (motion === 'reduce') {
        assert.equal(await tx(page), 0, 'instant open'); await page.evaluate(() => close1());
        assert.deepEqual(await page.evaluate(() => [log, document.getElementById('pn').hidden]), [['done'], true], 'instant close');
      } else {
        await wait(120); const mid = await tx(page); assert.ok(mid > 5 && mid < 400, `sliding in (${mid})`);
        const tr = await page.evaluate(() => [getComputedStyle(pn).transitionDuration, getComputedStyle(pn).transitionTimingFunction, getComputedStyle(sh).backgroundColor]);
        assert.match(tr[0], /^0\.5s/); assert.match(tr[1], /cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
        assert.equal(await page.evaluate(() => getComputedStyle(pn.firstElementChild).animationName), 'lv-rise', 'content rises in');
        await wait(600); assert.equal(await tx(page), 0, 'open');
        assert.equal(await page.evaluate(() => getComputedStyle(sh).backgroundColor), 'rgba(0, 0, 0, 0.55)', 'dimmed');
        assert.equal(await page.evaluate(() => { pn.innerHTML = '<h2>Two</h2>'; return open1(); }), false, 'open again = swap, no slide');
        assert.equal(await tx(page), 0);
        await page.evaluate(() => close1()); await wait(100);
        const out = await page.evaluate(() => [getComputedStyle(pn).transitionDuration, getComputedStyle(pn).transitionTimingFunction, log.length]);
        assert.match(out[0], /^0\.4s/); assert.match(out[1], /cubic-bezier\(0\.4, 0, 1, 1\)/); assert.equal(out[2], 0, 'still closing');
        await wait(450); assert.deepEqual(await page.evaluate(() => [log.splice(0), pn.hidden]), [['done'], true], 'closed after 0.40 s');
        // a press while it moves finishes the move at once (input never blocked)
        await page.evaluate(() => open1()); await wait(60); await page.mouse.down(); await page.mouse.up();
        assert.equal(await tx(page), 0, 'press finished the slide in');
        await page.evaluate(() => close1()); await wait(60); await page.mouse.down(); await page.mouse.up();
        assert.deepEqual(await page.evaluate(() => [log.splice(0), pn.hidden]), [['done'], true], 'press finished the slide out');
        // reopen while closing: no done(), slides back
        await page.evaluate(() => open1()); await wait(600); await page.evaluate(() => close1()); await wait(80); await page.evaluate(() => open1());
        await wait(700); assert.deepEqual(await page.evaluate(() => [log.splice(0), pn.hidden]), [[], false], 'reopened while closing'); assert.equal(await tx(page), 0);
      }
      await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
});

// ---------------------------------------------------------------- v2.3.0 busy states: no silent clicks
test('busy helpers: action words, progress card (typical time, real steps, 30 s note, done line), escaped; CSS = option 1 "Gold fill"', () => {
  assert.deepEqual(S.busyWords('<svg></svg><span>Add to review package</span>'), { word: 'Adding…', done: '✓ Added' });
  assert.equal(S.busyWords('Save summary').word, 'Saving…');
  assert.equal(S.busyWords('↻ Re-sync').word, 'Syncing…');
  assert.equal(S.busyWords('Delete firm…').done, '✓ Deleted');
  assert.equal(S.busyWords('Frobnicate').word, 'Working…');
  assert.equal(S.BUSY_DELAY_MS, 150); assert.equal(S.LONG_NOTE_MS, 30000);
  assert.equal(S.fmtTypical(40000), 'Usually about 40 seconds'); assert.equal(S.fmtTypical(120000), 'Usually about 2 minutes');
  const steps = [['a', 'First <step>'], ['b', 'Second'], ['c', 'Third']];
  const h = S.progressCardHtml({ title: 'Publishing <x>', typicalMs: 40000, steps, states: { a: 'ok', b: 'run' }, elapsed: 1000 });
  assert.match(h, /<b>Publishing &lt;x&gt;<\/b><span>Usually about 40 seconds<\/span>/);
  assert.match(h, /lv-pc-s ok" data-k="a"><span class="lv-pc-d" aria-hidden="true">✓<\/span><span>First &lt;step&gt;/);
  assert.match(h, /lv-pc-s run" data-k="b"/); assert.match(h, /lv-pc-s todo" data-k="c"/);
  assert.match(h, /--lv-pc-delay:-1000ms/, 'a repaint carries on'); assert.doesNotMatch(h, /lv-pc-wait/); assert.doesNotMatch(h, /Still working/);
  assert.match(S.progressCardHtml({ title: 'X', steps, elapsed: 50 }), /lv-pc-wait"[^>]*style="--lv-pc-show:100ms"/, 'shown only after 150 ms');
  assert.match(S.progressCardHtml({ title: 'X', steps, elapsed: 31000 }), /<p class="lv-pc-long" role="status">Still working, usually under a minute\. You can close this panel; you&#39;ll get a bell notice when it&#39;s done\.<\/p>/);
  // the note uses the job's own typical time (review note FIX 6)
  assert.equal(S.longNote(120000), "Still working, usually about 2 minutes. You can close this panel; you'll get a bell notice when it's done.");
  assert.match(S.progressCardHtml({ title: 'Publishing', typicalMs: 120000, steps, elapsed: 31000 }), /Still working, usually about 2 minutes\./);
  const d = S.progressCardHtml({ title: 'X', steps, done: { result: 'Published', next: 'send link A' }, elapsed: 31000 });
  assert.match(d, /class="lv-pc is-done"/); assert.match(d, /<p class="lv-pc-ok" role="status">✓ Published\. Next: send link A<\/p>/); assert.doesNotMatch(d, /Still working/);
  assert.match(S.busyInnerHtml('<b>Add</b>', 'Adding <now>'), /^<span class="lv-bz-idle"><b>Add<\/b><\/span><span class="lv-bz-word" aria-live="polite">Adding &lt;now&gt;<\/span><span class="lv-bz-fill" aria-hidden="true"><span class="lv-bz-fw">Adding &lt;now&gt;<\/span><\/span>$/);
  assert.match(S.areaLoadingHtml('Loading review…'), /<span class="lv-area-bar" aria-hidden="true"><i><\/i><\/span><span class="lv-area-t"><b class="lv-area-pct" hidden><\/b><span>Loading review…<\/span>/);
  assert.match(CSS, /\.lv-bz>\.lv-bz-fill\{[^}]*background:var\(--gold\)[^}]*animation:lv-bz-fill var\(--lv-bz-ms,1500ms\) cubic-bezier\(\.3,\.6,\.4,1\) var\(--lv-bz-delay,\.15s\) forwards/);
  assert.match(CSS, /@keyframes lv-bz-fill\{from\{clip-path:inset\(0 100% 0 0\)\}to\{clip-path:inset\(0 10% 0 0\)\}\}/, 'reveals left → right, eases to ~90%');
  assert.match(CSS, /\.lv-bz>\.lv-bz-fill>\.lv-bz-fw\{[^}]*color:#151515/, 'near-black text on gold');
  assert.match(CSS, /\.lv-bz>\.lv-bz-word\{[^}]*color:var\(--ink\)/, 'the not-yet-filled part reads in the normal text colour');
  assert.match(CSS, /\.lv-net\{position:fixed;left:0;top:0;height:3px;width:0;background:var\(--gold\)/, '3px gold top line');
  assert.match(CSS, /:root\.lfmp-v2 button:active:not\(:disabled\),[^{]*\{transform:scale\(\.98\);filter:brightness\(\.94\)\}/, 'press feedback');
  const rm = CSS.slice(CSS.lastIndexOf('@media (prefers-reduced-motion:reduce){'));
  for (const s of ['.lv-bz>.lv-bz-fill{display:none}', '.lv-bz{box-shadow:inset 0 0 0 2px var(--gold)}', '.lv-pc-s.run .lv-pc-d{animation:none}']) assert.ok(rm.includes(s), `reduced motion: ${s}`);
});

tb('in Chromium: press feedback < 100 ms; a slow click (1.5 s network) shows the gold fill + "Adding…" within 150 ms, no double submit, "✓ Added" then the label; failure drains; top line; reduced motion = gold outline', { timeout: 120000 }, async () => {
  const { chromium } = createRequire(path.join(pwDir, 'package.json'))('./index.js');
  const PAGE = `<!doctype html><html lang="en" class="lfmp-v2"><head><meta charset="utf-8"><link rel="stylesheet" href="/lfmp-ui.css"></head><body>
<header class="lv-top" data-lv-top style="display:flex"><b>LFMP</b></header>
<div class="act" style="padding:40px;display:flex;gap:8px"><button class="btn primary" id="add" type="button">Add to review package</button><button class="btn" id="other" type="button">Remove</button></div>
<div style="padding:0 40px"><button class="btn" id="bad" type="button">Save summary</button></div>
<script type="module">import * as S from '/lfmp-session.js'; window.S = S; window.calls = 0;
document.getElementById('add').addEventListener('click', () => { calls++; S.lfmpFetch('/slow'); });
document.getElementById('other').addEventListener('click', () => { calls++; });
document.getElementById('bad').addEventListener('click', () => { S.lfmpFetch('/fail').catch(() => {}); });</script></body></html>`;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
    if (/^\/lfmp-(session|ui|done)\.(js|css)$/.test(u.pathname) && fs.existsSync(path.join(DIR, u.pathname.slice(1)))) { res.writeHead(200, { 'Content-Type': u.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' }); return res.end(fs.readFileSync(path.join(DIR, u.pathname.slice(1)))); }
    if (u.pathname === '/slow') return setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); }, 1500);
    if (u.pathname === '/fail') return setTimeout(() => { res.writeHead(500); res.end(''); }, 600);
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const st = p => p.evaluate(() => { const b = document.getElementById('add'), f = b.querySelector('.lv-bz-fill'), w = b.querySelector('.lv-bz-word'), o = document.getElementById('other');
    // filled width = the button width minus the clip-path's right inset (the gold layer is revealed left → right)
    const clip = f ? getComputedStyle(f).clipPath : '', right = (clip.match(/inset\(\S+ ([\d.]+)%/) || [])[1];
    const bw = b.getBoundingClientRect().width, fw = b.querySelector('.lv-bz-fw');
    return { busy: b.classList.contains('lv-bz'), ok: b.classList.contains('lv-bz-ok'), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true', fillW: f ? (right != null ? bw * (1 - Number(right) / 100) : (clip.startsWith('inset(0') ? bw : 0)) : 0, fillDisplay: f ? getComputedStyle(f).display : '', word: w && getComputedStyle(w).opacity === '1' ? w.textContent : '',
      text: b.textContent.trim(), width: bw, dim: getComputedStyle(o).pointerEvents === 'none', net: document.querySelector('.lv-net')?.classList.contains('on') || false, shadow: getComputedStyle(b).boxShadow, color: fw ? getComputedStyle(fw).color : '' }; });
  try {
    for (const motion of ['no-preference', 'reduce']) {
      const ctx = await browser.newContext({ reducedMotion: motion, viewport: { width: 900, height: 600 } });
      const page = await ctx.newPage(); await page.goto(base); await page.waitForFunction(() => window.S);
      const w0 = await page.evaluate(() => document.getElementById('add').getBoundingClientRect().width);
      // press feedback within 100 ms (scale .98)
      const bx = await page.locator('#add').boundingBox();
      await page.mouse.move(bx.x + 10, bx.y + 10); await page.mouse.down(); await wait(motion === 'reduce' ? 20 : 100);
      const tf = await page.evaluate(() => new DOMMatrix(getComputedStyle(document.getElementById('add')).transform).a);
      if (motion === 'reduce') assert.equal(tf, 1, 'reduced motion: no scale'); else assert.ok(tf < 0.99, `pressed scale ${tf}`);
      await page.mouse.up();
      await wait(60);
      let s = await st(page);
      assert.ok(s.busy && s.disabled && !s.word, `busy class at once, the word waits for 150 ms ${JSON.stringify(s)}`);
      await wait(180); s = await st(page);
      assert.equal(s.word, 'Adding…', 'the action word within 150 ms'); assert.ok(Math.abs(s.width - w0) < 1, 'width kept');
      assert.ok(s.dim, 'the other button in the group dims and can\'t be clicked');
      assert.ok(s.net, 'gold line under the top bar while the request is in flight');
      if (motion === 'reduce') { assert.equal(s.fillDisplay, 'none', 'no fill'); assert.match(s.shadow, /inset/, 'solid gold outline'); }
      else { await wait(500); const s2 = await st(page); assert.ok(s2.fillW > 0 && s2.fillW < s2.width * 0.95, `fills left → right ${s2.fillW}`); assert.equal(s2.color, 'rgb(21, 21, 21)', 'near-black text on gold'); }
      // no double submit
      await page.click('#add', { force: true }).catch(() => {}); await page.click('#other', { force: true }).catch(() => {});
      await page.evaluate(() => { document.getElementById('add').click(); document.getElementById('other').click(); });   // keyboard / script clicks too
      assert.equal(await page.evaluate(() => calls), 1, 'one request only');
      await page.waitForFunction(() => document.getElementById('add').classList.contains('lv-bz-ok'), null, { timeout: 4000 });
      s = await st(page); assert.equal(s.word, '✓ Added'); assert.ok(s.fillDisplay !== 'none', '✓ on gold');
      await wait(1400); s = await st(page);
      assert.ok(!s.busy && !s.disabled && s.text === 'Add to review package' && !s.dim, `back to the label ${JSON.stringify(s)}`);
      await wait(700); assert.equal((await st(page)).net, false, 'top line gone');
      // failure: the fill drains, the label comes back
      await page.click('#bad'); await wait(250);
      assert.equal(await page.evaluate(() => document.getElementById('bad').querySelector('.lv-bz-word')?.textContent), 'Saving…');
      await page.waitForFunction(() => document.getElementById('bad').classList.contains('lv-bz-bad'), null, { timeout: 3000 });
      await page.waitForFunction(() => !document.getElementById('bad').classList.contains('lv-bz') && document.getElementById('bad').textContent === 'Save summary', null, { timeout: 3000 });
      // progress card controller: shown after 150 ms, steps tick, done line
      await page.evaluate(() => { const el = document.createElement('div'); el.id = 'pc'; document.body.append(el); window.pc = S.progressCard(el, { title: 'Publishing', typicalMs: 40000, steps: [['a', 'One'], ['b', 'Two']] }); });
      assert.equal(await page.evaluate(() => document.getElementById('pc').innerHTML), '', 'nothing before 150 ms');
      await wait(200); await page.evaluate(() => pc.step('b'));
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('#pc .lv-pc-s')].map(x => x.className)), ['lv-pc-s ok', 'lv-pc-s run'], 'a done, b running');
      assert.match(await page.textContent('#pc'), /Usually about 40 seconds/);
      await page.evaluate(() => pc.done('Published', 'send link A')); assert.match(await page.textContent('#pc'), /✓ Published\. Next: send link A/);
      await page.evaluate(() => { window.pc2 = S.progressCard(document.getElementById('pc'), { title: 'X', steps: [['a', 'One']] }); pc2.fail('GitHub said 500.', () => { window.retried = true; }); });
      await page.click('#pc [data-lv-retry]'); assert.equal(await page.evaluate(() => window.retried), true, 'failure = error card + Retry');
      await ctx.close();
    }
  } finally { await browser.close(); server.close(); }
});

// ---------------------------------------------------------------- v2.5.0 long jobs (Part 2): working bar + Done popup
test('jobs: one list of witty lines per job (edited in one place), "<Client>" filled in, the slow line after a minute', () => {
  assert.deepEqual(Object.keys(S.JOB_LINES), ['reread', 'savemap', 'sync', 'create', 'kpi', 'menu', 'review', 'publish', 'remove', 'other']);
  assert.deepEqual(S.JOB_LINES.reread, ['Pedaling over to GHL…', 'Asking GHL nicely for your pipelines…', 'Counting your stages twice, just in case…', 'Legs burning. Nearly there…']);
  assert.deepEqual(S.JOB_LINES.savemap, ['Tightening the bolts on your mapping…', 'Double-checking every stage…']);
  assert.deepEqual(S.JOB_LINES.sync, ['Fetching the latest leads…', 'Rounding up the numbers…', 'Doing the math so you don\'t have to…']);
  assert.deepEqual(S.jobLines('create', 'Acme Law'), ['Building Acme Law\'s new home in GHL…', 'Moving the furniture in (snapshot)…', 'Hanging the pictures…']);
  assert.deepEqual(S.jobLines('kpi', 'Acme Law'), ['Lining up the numbers…', 'Wiring up Acme Law\'s dashboard…']);   // v2.8.0 (FIX 2.1): no line repeats the bar's title
  assert.deepEqual(S.JOB_LINES.menu, ['Hanging the KPI sign in GHL…']);
  assert.deepEqual(S.JOB_LINES.review, ['Photocopying the workflows…', 'Reading the fine print in every email…']);
  assert.deepEqual(S.JOB_LINES.publish, ['Delivering the new version to the client\'s page…', 'Wrapping it with a bow…']);
  assert.deepEqual(S.JOB_LINES.remove, ['Tidying up…', 'Putting things back where they were…']);
  assert.deepEqual(S.jobLines('nope'), ['Pedaling…', 'Almost there…']);
  assert.equal(S.JOB_SLOW_LINE, 'Uphill bit. Still pedaling.');
  const L = S.jobLines('reread');
  assert.equal(S.jobLineAt(L, 0), L[0]); assert.equal(S.jobLineAt(L, 3100), L[1]); assert.equal(S.jobLineAt(L, 12500), L[0]);   // every ~3 s, round
  assert.equal(S.jobLineAt(L, 59999), L[19 % 4]); assert.equal(S.jobLineAt(L, 60000), 'Uphill bit. Still pedaling.'); assert.equal(S.jobLineAt(L, 600000), 'Uphill bit. Still pedaling.');
});
test('jobs: the cyclist follows real progress, else eases toward ~90% and never reaches the end on its own', () => {
  assert.equal(S.jobPct({ elapsed: 1000, real: 0.5 }), 0.5); assert.equal(S.jobPct({ elapsed: 0, real: 2 }), 1); assert.equal(S.jobPct({ elapsed: 0, real: -1 }), 0);
  const at = ms => S.jobPct({ elapsed: ms, typicalMs: 40000 });
  assert.equal(at(0), 0); assert.ok(at(40000) > 0.6 && at(40000) < 0.8, `typical time ≈ 70% (${at(40000)})`);
  assert.ok(at(10 * 60e3) < 0.9 && at(10 * 60e3) > 0.89, 'never past 90% without a real result');
  for (let t = 0; t < 120000; t += 5000) assert.ok(at(t + 5000) >= at(t), 'only forwards');
});
test('jobs: working bar + popups are plain words only, escaped; Done = ✓ + "Done: …" + what changed; Didn\'t work = reason + Nothing changed + Try again', () => {
  const w = S.workBarHtml({ title: 'Reading <Dumas>\'s pipelines from GHL…', line: 'Pedaling over to GHL…' });
  assert.match(w, /data-lv-job .*role="status"/); assert.match(w, /Reading &lt;Dumas&gt;&#39;s pipelines/); assert.match(w, /usually under a minute/);
  assert.ok(!/in_progress|queued|completed/.test(w));
  // v2.8.0: the hint carries its base text for steps(): "usually under a minute · 6 of 9 steps"
  assert.match(w, /<span data-lv-job-hint data-base="usually under a minute">usually under a minute<\/span>/);
  for (const [k, l] of Object.entries(S.JOB_LINES)) for (const x of l) assert.ok(!/^Setting up /.test(x), `${k}: "${x}" reads like a job title`);
  const ok = S.resultPopupHtml({ title: 'Done: pipelines updated', lead: 'Read again.', items: [['Stages', '12 · all still mapped']], next: { label: 'Review mapping' } });
  assert.match(ok, /role="alertdialog" aria-modal="true"/); assert.match(ok, /lv-res-ic[^>]*>✓/); assert.match(ok, /Done: pipelines updated/); assert.match(ok, /<li>Stages<span>12 · all still mapped<\/span><\/li>/);
  assert.match(ok, /data-lv-res="close">Close</); assert.match(ok, /data-lv-res="next">Review mapping</);
  const bad = S.resultPopupHtml({ status: 'failed', reason: 'GHL took too long to answer.', nothingChanged: 'the mapping is the same as before.', retry: true });
  assert.match(bad, /class="lv-res bad"/); assert.match(bad, /Didn&#39;t work|Didn't work/); assert.match(bad, /GHL took too long to answer\. <b>Nothing changed:<\/b> the mapping is the same as before\./); assert.match(bad, /data-lv-res="retry">Try again</);
  assert.match(S.resultPopupHtml({ status: 'failed', reason: 'x', nothingChanged: true }), /<b>Nothing changed\.<\/b>/);
  assert.ok(!/Nothing changed/.test(S.resultPopupHtml({ status: 'failed', reason: 'x' })), 'only when true');
  const later = S.resultPopupHtml({ title: 'Done: mapping saved', when: 'Finished 4 min ago, while you were on Reviews' });
  assert.match(later, /Finished 4 min ago, while you were on Reviews/); assert.match(later, /class="lv-res-pri" data-lv-res="close">OK</);
});
test('jobs: the hint on the right is the job\'s own typical time', () => {
  assert.equal(S.jobHint(40000), 'usually under a minute'); assert.equal(S.jobHint(60000), 'usually under a minute');
  assert.equal(S.jobHint(120000), 'usually about 2 minutes'); assert.equal(S.jobHint(300000), 'usually about 5 minutes'); assert.equal(S.jobHint(), 'usually under a minute');
});
test('jobs: kept on this browser (shared by the three tools), newest 30 for 7 days; the bell lists one-line results, newest first', () => {
  const mem = new Map(), store = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  const now = Date.now();
  S.writeJobs([{ id: 'a', status: 'done', what: 'Sync now', client: 'Mahdavi', startedAt: now - 9 * 864e5, finishedAt: now - 8 * 864e5 }, ...Array.from({ length: 35 }, (_, i) => ({ id: `j${i}`, status: 'done', what: 'Save mapping', client: 'X', startedAt: now - 1000, finishedAt: now - 1000 + i }))], store, now);
  const kept = S.readJobs(store);
  assert.equal(kept.length, 30); assert.ok(!kept.some(j => j.id === 'a'), 'older than 7 days dropped');
  S.writeJobs([{ id: 'x1', tool: 'kpi', status: 'done', what: 'Re-read GHL', client: 'Dumas', startedAt: now - 5000, finishedAt: now - 4000, result: { title: 'Done: pipelines updated', line: 'Pipelines updated from GHL', detail: '12 stages' } },
    { id: 'x2', tool: 'kpi', status: 'failed', what: 'Re-read GHL', client: 'Palm Beach', startedAt: now - 3000, finishedAt: now - 2000, result: { reason: 'x', line: 'Couldn\'t read GHL' } }], store, now);
  const h = S.jobsListHtml(S.readJobs(store), now);
  assert.ok(h.indexOf('Couldn&#39;t read GHL') < h.indexOf('Pipelines updated from GHL'), 'newest first');
  assert.match(h, /Dumas · 12 stages · \d{1,2}:\d\d [AP]M/); assert.match(h, /lv-jobs-d bad/);
  assert.equal(S.unseenJobs(store).length, 2); assert.equal(S.newJobResults(store), 2);
  S.markJobsBellSeen(store, now + 1); assert.equal(S.newJobResults(store), 0, 'opening the bell clears its count');
  assert.equal(S.agoText(4 * 60000), '4 min ago'); assert.equal(S.agoText(20000), 'just now'); assert.equal(S.agoText(3 * 3600e3), '3 hours ago');
});
test('jobs: CSS = the previews (bar 4px gold on the track, rider above it, popup centred over a dimmed page); reduced motion: no animation', () => {
  assert.match(CSS, /\.lv-job-bar\{position:absolute;left:0;right:0;bottom:0;height:4px;background:var\(--soft\)/);
  assert.match(CSS, /\.lv-job-bar i\{[^}]*background:var\(--gold\)/);
  assert.match(CSS, /\.lv-jk-ink\{stroke:var\(--ink\)/); assert.match(CSS, /\.lv-jk-gold\{stroke:var\(--gold\)/);
  assert.match(CSS, /\.lv-res-shade\{position:fixed;inset:0;z-index:200;background:rgba\(10,10,12,\.55\);display:flex;align-items:center;justify-content:center/);
  assert.match(CSS, /\.lv-res-ic\{[^}]*background:var\(--green\)/); assert.match(CSS, /\.lv-res\.bad \.lv-res-ic\{background:var\(--red\)/);
  assert.match(CSS, /@media \(max-width:879\.98px\)\{\.lv-job-t\{flex-direction:column;gap:0\}\}/, 'phone: "usually under a minute" under the title');
  assert.match(CSS, /@media \(prefers-reduced-motion:reduce\)\{\s*\.lv-res-shade,\.lv-res,\.lv-cf\{animation:none\}[^\n]*\n\s*\.lv-job-sub\{transition:none\}/);
});
test('jobs: the three tools load this file; client-facing pages never do (dashboards, Link A / Link B, the old review page)', () => {
  let code = HERE; while (code !== path.dirname(code) && !fs.existsSync(path.join(code, 'ghl-subaccount-builder'))) code = path.dirname(code);
  const pages = ['leadpro-kpi/app/dashboard.html', 'automation-review/plan.html', 'automation-review/messages.html', 'automation-review/index.html'].map(p => path.join(code, p)).filter(p => fs.existsSync(p));
  if (!pages.length) return;   // only the one repo checked out
  for (const p of pages) { const t = fs.readFileSync(p, 'utf8'); assert.ok(!/lfmp-session|lv-job|startJob|lv-res/.test(t), `${path.basename(p)} must not load the admin job component`); }
});

// ---------------------------------------------------------------- v2.6.0 confirm first (Part 4)
test('confirm: "<Action> for <Client>?", what happens and where, what does not; Cancel first; removals red with the name typed; escaped', () => {
  const h = S.confirmHtml({ title: 'Publish <Acme>\'s review package?', will: [['Client pages', 'Link A / B show this version']], wont: ['Nothing in GHL changes'], ok: 'Publish' });
  assert.match(h, /role="dialog" aria-modal="true" aria-labelledby="lvCfT"/); assert.match(h, /Publish &lt;Acme&gt;&#39;s review package\?/);
  assert.match(h, /What happens<\/p><ul class="lv-cf-list"><li><b>Client pages<\/b><span>Link A \/ B show this version<\/span><\/li><\/ul>/);
  assert.match(h, /What does not happen<\/p><ul class="lv-cf-list lv-cf-wont"><li><span>Nothing in GHL changes<\/span><\/li>/);
  assert.ok(h.indexOf('data-lv-cf="cancel"') < h.indexOf('data-lv-cf="ok"'), 'Cancel first'); assert.match(h, /class="lv-res-pri" data-lv-cf="ok">Publish</); assert.ok(!/lvCfIn/.test(h), 'no name box');
  const r = S.confirmHtml({ title: 'Remove Acme\'s scorecard?', danger: true, typeName: 'Acme Law', will: [['GitHub', 'the dashboard']], wont: ['The GHL sub-account'], ok: 'Remove scorecard' });
  assert.match(r, /class="lv-cf danger"/); assert.match(r, /What goes/); assert.match(r, /What is kept/);
  assert.match(r, /<label class="lv-cf-type" for="lvCfIn"><span>Type <b>Acme Law<\/b> to confirm<\/span><input id="lvCfIn"/);
  assert.match(r, /class="lv-cf-red" data-lv-cf="ok" disabled>Remove scorecard</);
  assert.equal(S.typedMatch('  acme   LAW ', 'Acme Law'), true); assert.equal(S.typedMatch('Acme', 'Acme Law'), false); assert.equal(S.typedMatch('', 'Acme Law'), false);
  assert.match(CSS, /\.lv-cf \.lv-cf-red\{background:var\(--red\)/); assert.match(CSS, /\.lv-cf button\[disabled\]\{opacity:\.45/);
});

// v2.7.0: LFMP / WPP brand: one helper for the three tools; the list filter (menu, phone Filter button, chips, sheet)
test('brand: record brand → LFMP / WPP; no record → LFMP; one lookup by Builder id, review code, KPI slug or location', () => {
  assert.equal(S.brandOf({ brand: 'WPP' }), 'WPP'); assert.equal(S.brandOf({ brand: 'wpp ' }), 'WPP');
  assert.equal(S.brandOf({ brand: 'LFMP' }), 'LFMP'); assert.equal(S.brandOf({}), 'LFMP'); assert.equal(S.brandOf(null), 'LFMP'); assert.equal(S.brandOf({ brand: 'Other' }), 'LFMP');
  const rows = [{ id: 'boca-1', reviewCode: 'boca-e770de', kpiSlug: 'boca-dental', locationId: 'cUGbQORfR3Qp9nnzcgft', brand: 'WPP' }, { id: 'dumas-1', reviewCode: 'dumas-x', kpiSlug: 'dumas', locationId: 'uCEP', brand: 'LFMP' }];
  assert.equal(S.brandFor(rows, { kpiSlug: 'boca-dental' }), 'WPP'); assert.equal(S.brandFor(rows, { reviewCode: 'boca-e770de' }), 'WPP');
  assert.equal(S.brandFor(rows, { locationId: 'cUGbQORfR3Qp9nnzcgft' }), 'WPP'); assert.equal(S.brandFor(rows, { id: 'boca-1' }), 'WPP');
  assert.equal(S.brandFor(rows, { kpiSlug: 'dumas' }), 'LFMP'); assert.equal(S.brandFor(rows, { kpiSlug: 'mahdavi' }), 'LFMP', 'no Builder record = LFMP');
  assert.equal(S.brandFor([], { kpiSlug: 'x' }), 'LFMP'); assert.equal(S.brandFor(null, null), 'LFMP');
  assert.equal(S.brandWord('WPP'), 'WPP '); assert.equal(S.brandWord('all'), '');
  assert.equal(S.brandSub('WPP', 'all', 'Existing sub-account · Boca Raton, Florida'), 'WPP · Existing sub-account · Boca Raton, Florida');
  assert.equal(S.brandSub('WPP', 'WPP', 'Existing sub-account'), 'Existing sub-account', 'no prefix once a brand is picked');
  assert.deepEqual(S.brandCounts([{ brand: 'WPP' }, { brand: 'LFMP' }, { brand: 'LFMP' }]), { all: 3, LFMP: 2, WPP: 1 });
});
test('brand filter setting: one key for the three tools; bad values → All; storage blocked → All, never throws', () => {
  const mem = new Map(), ls = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) };
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true });
    assert.equal(S.getBrandFilter(), 'all'); assert.equal(S.setBrandFilter('WPP'), 'WPP'); assert.equal(mem.get(S.BRAND_KEY), 'WPP'); assert.equal(S.getBrandFilter(), 'WPP');
    assert.equal(S.setBrandFilter('nope'), 'all'); assert.equal(mem.has(S.BRAND_KEY), false); mem.set(S.BRAND_KEY, 'x'); assert.equal(S.getBrandFilter(), 'all');
    Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('blocked'); }, configurable: true });
    assert.equal(S.getBrandFilter(), 'all'); assert.equal(S.setBrandFilter('WPP'), 'WPP'); assert.equal(S.safeStorage(), null);
  } finally { if (had) Object.defineProperty(globalThis, 'localStorage', had); else delete globalThis.localStorage; }
});
test('brand filter HTML: "All clients ▾" menu (counts, ✓, hint), phone Filter badge, chips, red Needs you, sheet', () => {
  const m = S.brandMenuHtml({ value: 'all', counts: { all: 3, LFMP: 2, WPP: 1 }, open: true });
  assert.match(m, /data-lv-bf aria-haspopup="menu" aria-expanded="true"/); assert.match(m, />All clients<span class="lv-car"/);
  assert.match(m, /role="menuitemradio" aria-checked="true" data-lv-bfpick="all"><span class="lv-ck" aria-hidden="true">✓<\/span>All clients<span class="lv-n">3</);
  assert.match(m, /data-lv-bfpick="WPP"><span class="lv-ck" aria-hidden="true"><\/span>WPP<span class="lv-n">1</); assert.match(m, /Same choice on Clients, Scorecards and Reviews \(this device\)\./);
  assert.match(S.brandMenuHtml({ value: 'WPP', counts: {} }), /class="lv-bf lv-hit on"[^>]*><span class="lv-bfdot"[^>]*><\/span>WPP/);
  const segs = [{ key: 'all', label: 'All 3', phone: 'All', n: 3 }, { key: 'attention', label: 'Needs you · 1', n: 1, needs: true }, { key: 'progress', label: 'In progress · 0', phone: 'Active', n: 0 }];
  assert.doesNotMatch(S.filterBtnHtml({ brand: 'all', active: 'all', segs }), /lv-fbd/);
  assert.match(S.filterBtnHtml({ brand: 'WPP', active: 'progress', segs }), /<span class="lv-fbd" aria-hidden="true">2<\/span>/);
  const c = S.filterChipsHtml({ brand: 'WPP', active: 'progress', segs });
  assert.match(c, /data-lv-clr="brand"[^>]*>WPP <span aria-hidden="true">✕/); assert.match(c, /data-lv-clr="status"[^>]*>Active <span/); assert.match(c, /class="lv-needs lv-hit" data-lv-needs="attention">Needs you · 1 /);
  assert.doesNotMatch(S.filterChipsHtml({ brand: 'all', active: 'attention', segs }), /lv-needs/, 'no red chip when Needs you is already on');
  assert.doesNotMatch(S.filterChipsHtml({ brand: 'all', active: 'all', segs: segs.map(s => ({ ...s, n: 0 })) }), /lv-needs/, 'no red chip at 0');
  const sh = S.filterSheetHtml({ brand: 'WPP', active: 'all', brands: { all: 3, LFMP: 2, WPP: 1 }, segs, showN: 1 });
  assert.match(sh, /role="dialog" aria-modal="true" aria-labelledby="lvFsT"/); assert.match(sh, /data-lv-fb="WPP" aria-pressed="true">WPP · 1</);
  assert.match(sh, /data-lv-fs="attention" aria-pressed="false">Needs you · 1</); assert.match(sh, /data-lv-fs="progress" aria-pressed="false">Active · 0</);
  assert.match(sh, /data-lv-freset>Reset</); assert.match(sh, /data-lv-fapply>Show 1 client</);
  assert.match(S.filterSheetHtml({ segs, showN: 3, noun: 'firm' }), /Show 3 firms</);
  const head = S.pageHeadHtml({ title: 'Clients', segs, active: 'all', brand: { value: 'all', counts: { all: 3 } } });
  assert.match(head, /<div class="lv-srow"><label class="lv-search/); assert.match(head, /class="lv-seg lv-segb"/);
  assert.doesNotMatch(S.pageHeadHtml({ title: 'X', segs, active: 'all' }), /lv-srow|lv-segb|data-lv-bf/, 'without brand: exactly as before');
  assert.match(CSS, /\.lv-bf\{display:inline-flex;[^}]*background:var\(--seg\)[^}]*border-radius:10px/); assert.match(CSS, /\.lv-seg\.lv-segb\{display:none\}/);
  assert.ok(CSS.slice(CSS.lastIndexOf('@media (prefers-reduced-motion:reduce){')).includes('.lv-fsheet{animation:none}'), 'reduced motion: the sheet does not slide');
});

// v2.10.0 Done moments in Chromium, per tool (Builder / KPI admin / Review admin words), with a fixture job through the
// shell's startJob: the popup in its working state with the job's real step text, Hide → mini → back, finish = the style's
// sound + the voice line once each (stubbed), no second result popup, Open <client>; a failure closes it with no sound and
// shows the usual Didn't work popup; Classic = the working bar exactly as before, no popup, nothing played. Then the
// settings panel, the voice shortlist order, and the voice greeting (once with the right text; Off = never; never after it ends).
tb('in Chromium: Done moments per tool (popup, Hide → mini, finish = sound + voice once, failure = no sound, Classic = as before), settings panel, voices, voice greeting', { timeout: 180000 }, async () => {
  const { chromium } = createRequire(path.join(pwDir, 'package.json'))('./index.js');
  const PAGE = `<!doctype html><html lang="en" class="lfmp-v2"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/lfmp-ui.css"><link rel="stylesheet" href="/lfmp-done.css"></head><body>
<div id="app"><main class="lv-in"><div data-lv-jobhost="h"></div></main></div>
<script type="module">import * as S from '/lfmp-session.js'; import * as DN from '/lfmp-done.js'; window.S = S; window.DN = DN; window.calls = [];
window.__lfmpDoneHooks = { sound: id => calls.push(['sound', id]), speak: t => calls.push(['speak', t]) };
const tool = new URLSearchParams(location.search).get('tool') || 'builder';
window.shell = S.mountShell({ tool, me: { name: 'PJ', first: 'PJ', email: 'pj@example.com' }, root: document.getElementById('app'), version: '1.0.0' }); window.ready = true;</script></body></html>`;
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(PAGE); }
    if (/^\/lfmp-(session|ui|done)\.(js|css)$/.test(u.pathname)) { res.writeHead(200, { 'Content-Type': u.pathname.endsWith('.js') ? 'text/javascript' : 'text/css' }); return res.end(fs.readFileSync(path.join(DIR, u.pathname.slice(1)))); }
    res.writeHead(404); res.end();
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // a computer with these voices (the engine's shortlist() orders them: the best 4 of each kind)
  const VOICES = ['Samantha', 'Fred', 'Karen', 'Daniel', 'Moira', 'Google UK English Male', 'Alex', 'Zarvox'].map(name => ({ name, lang: 'en-US', default: false, localService: true, voiceURI: name }));
  const ctxFor = async (opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: opts.reduced ? 'reduce' : 'no-preference' });
    await ctx.addInitScript(([v, done, greet]) => {
      try { localStorage.setItem('lfmp-greet-day', greet ? '' : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`); if (!greet) localStorage.setItem('lfmp-greet-day', localStorage.getItem('lfmp-greet-day')); else localStorage.removeItem('lfmp-greet-day'); if (done) localStorage.setItem('lfmp-done', JSON.stringify(done)); } catch {}
      try { const list = v; Object.defineProperty(window, 'speechSynthesis', { value: { getVoices: () => list, speak() {}, cancel() {}, addEventListener() {}, removeEventListener() {} }, configurable: true }); } catch {}
    }, [VOICES, opts.done || null, !!opts.greet]);
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(e.message));
    return { ctx, page, errs };
  };
  try {
    for (const tool of ['builder', 'kpi', 'review']) {
      const { ctx, page, errs } = await ctxFor();
      await page.goto(`${base}/?tool=${tool}`); await page.waitForFunction(() => window.ready && window.DM);
      // ---- a job that finishes
      await page.evaluate(t => { window.j = S.startJob({ tool: t === 'review' ? 'builder' : t, kind: 'create', client: 'Acme Law', what: 'Fixture job', title: 'Building Acme Law…', host: 'h', moment: { tool: t, steps: ['Step one', 'Step two', 'Step three', 'Step four'], open: () => { window.opened = (window.opened || 0) + 1; } } }); window.j.line('Step two'); window.j.steps(1, 4); }, tool);
      await page.waitForSelector('.dm-pop.working.in');
      assert.equal(await page.locator('[data-lv-jobhost="h"] *').count(), 0, `${tool}: no working bar while the popup runs`);
      const sub = await page.locator('.dm-pop .job .s').textContent(), work = await page.locator('.dm-pop .job .t').textContent();
      assert.equal(sub, 'Step two · 1 of 4 steps', `${tool}: real step text`); assert.match(work, /Acme Law/, `${tool}: the real client name`);
      await page.click('.dm-pop .dm-hide'); assert.ok(await page.locator('.dm-pop.mini').count(), `${tool}: Hide → mini`);
      await page.click('.dm-pop .dm-card'); assert.equal(await page.locator('.dm-pop.mini').count(), 0, `${tool}: click the mini → back`);
      await page.click('.dm-pop .dm-hide');
      await page.evaluate(() => window.j.done({ title: 'Done: fixture' })); await wait(2600);
      assert.ok(await page.locator('.dm-pop:not(.mini):not(.working) .stage.done').count(), `${tool}: finish → back up full size, done state`);
      const calls = await page.evaluate(() => window.calls);
      assert.equal(calls.filter(c => c[0] === 'sound').length, 1, `${tool}: the style's sound once`); assert.equal(calls.filter(c => c[0] === 'speak').length, 1, `${tool}: the voice line once`);
      assert.equal(calls.find(c => c[0] === 'sound')[1], 'opsdone', `${tool}: Systems check = the Ops complete sound`);
      assert.match(calls.find(c => c[0] === 'speak')[1], tool === 'review' ? /^Review package ready, Commander\./ : /Commander.*Acme Law|Acme Law.*Commander/, `${tool}: the line with Call me (+ the client, where the engine's line names it)`);
      assert.equal(await page.locator('[data-lv-res-shade]').count(), 0, `${tool}: no second result popup`);
      await page.click('.dm-pop .dm-open'); assert.equal(await page.evaluate(() => window.opened), 1, `${tool}: Open <client>`);
      // ---- a job that fails: popup closes, no sound, the usual Didn't work popup
      await page.evaluate(t => { window.calls.length = 0; window.j2 = S.startJob({ tool: t === 'review' ? 'builder' : t, kind: 'create', client: 'Beta Firm', what: 'Fixture job', title: 'Building Beta Firm…', host: 'h', moment: { tool: t } }); }, tool);
      await page.waitForSelector('.dm-pop.working');
      await page.evaluate(() => window.j2.fail({ reason: 'GHL said no.' })); await wait(700);
      assert.equal(await page.locator('.dm-pop').count(), 0, `${tool}: a failure closes the popup`);
      assert.deepEqual(await page.evaluate(() => window.calls), [], `${tool}: no sound, no voice on a failure`);
      assert.match(await page.locator('[data-lv-res-shade]').innerText(), /GHL said no\./, `${tool}: the usual error popup`);
      assert.deepEqual(errs, [], `${tool}: no page errors`);
      await ctx.close();
      // ---- Classic: exactly as before
      const C = await ctxFor({ done: { ...DN.doneDefaults(), animation: 'classic' } });
      await C.page.goto(`${base}/?tool=${tool}`); await C.page.waitForFunction(() => window.ready);
      await C.page.evaluate(t => { window.j = S.startJob({ tool: t === 'review' ? 'builder' : t, kind: 'create', client: 'Acme Law', what: 'Fixture job', title: 'Building Acme Law…', host: 'h', moment: { tool: t } }); }, tool);
      await wait(300);
      assert.equal(await C.page.locator('.dm-pop').count(), 0, `${tool} Classic: no popup`);
      assert.ok(await C.page.locator('[data-lv-jobhost="h"] *').count() > 0, `${tool} Classic: the working bar as before`);
      assert.equal(await C.page.evaluate(() => window.j.moment), false);
      await C.page.evaluate(() => window.j.done({ title: 'Done: fixture' })); await wait(1500);
      assert.ok(await C.page.locator('[data-lv-res-shade]').count(), `${tool} Classic: the usual Done popup`);
      assert.deepEqual(await C.page.evaluate(() => window.calls), [], `${tool} Classic: no sound, no voice`);
      await C.ctx.close();
      // ---- v2.11.0 Off (and Off + Classic): the engine's popup / sound / voice are never called; today's flow exactly
      for (const extra of [{}, { animation: 'classic' }]) {
        const O = await ctxFor({ done: { ...DN.doneDefaults(), enabled: false, ...extra } });
        const lab = `${tool} Off${extra.animation ? ' + Classic' : ''}`;
        await O.page.goto(`${base}/?tool=${tool}`); await O.page.waitForFunction(() => window.ready && window.DM);
        await O.page.evaluate(() => { window.dmCalls = []; for (const k of ['play', 'speak', 'sound', 'configure']) { const f = window.DM[k]; window.DM[k] = (...a) => { window.dmCalls.push(k); return f.apply(window.DM, a); }; } });
        await O.page.evaluate(t => { window.j = S.startJob({ tool: t === 'review' ? 'builder' : t, kind: 'create', client: 'Acme Law', what: 'Fixture job', title: 'Building Acme Law…', host: 'h', moment: { tool: t, steps: ['a', 'b'] } }); }, tool);
        await wait(300);
        assert.equal(await O.page.locator('.dm-pop').count(), 0, `${lab}: no popup`);
        assert.ok(await O.page.locator('[data-lv-jobhost="h"] *').count() > 0, `${lab}: the working bar as today`);
        assert.equal(await O.page.evaluate(() => window.j.moment), false);
        await O.page.evaluate(() => window.j.done({ title: 'Done: fixture' })); await wait(1500);
        assert.ok(await O.page.locator('[data-lv-res-shade]').count(), `${lab}: the usual Done popup`);
        assert.deepEqual(await O.page.evaluate(() => window.calls), [], `${lab}: no sound, no voice`);
        assert.deepEqual(await O.page.evaluate(() => window.dmCalls), [], `${lab}: the engine is never called (no play, speak, sound)`);
        assert.deepEqual(O.errs, [], `${lab}: no page errors`);
        await O.ctx.close();
      }
    }
    // ---- the settings panel
    const P = await ctxFor();
    await P.page.goto(`${base}/?tool=builder`); await P.page.waitForFunction(() => window.ready && window.DM);
    await P.page.click('[data-lv-top] [data-lv="me"]'); await P.page.click('[data-lv-top] [data-lv="done"]'); await P.page.waitForSelector('.lv-dmp');
    assert.ok(await P.page.locator('.lv-dmp [data-dm-thumb] .stage').count(), 'the thumbnail = the real engine\'s finished frame');
    assert.deepEqual(await P.page.locator('.lv-dmp select[data-dm="who"] option').allTextContents(), ['Daniel', 'Alex', 'Google UK English Male', 'Fred'], 'Guy: the best 4 guy voices, best first (the engine\'s order)');
    await P.page.click('.lv-dmp [data-dm="gender"][data-v="girl"]');
    assert.deepEqual(await P.page.locator('.lv-dmp select[data-dm="who"] option').allTextContents(), ['Samantha', 'Karen', 'Moira'], 'Girl: the girl voices, best first');
    await P.page.selectOption('.lv-dmp select[data-dm="callme"]', 'Custom'); await P.page.fill('.lv-dmp input[data-dm="custom"]', 'PJ');
    await P.page.click('.lv-dmp [data-dm-act="voice"]'); await wait(100);
    assert.match((await P.page.evaluate(() => window.calls)).at(-1)[1], /^Build complete, PJ\./, 'Test voice: the line with the typed name');
    await P.page.click('.lv-dmp [data-dm="animation"][data-v="classic"]');
    assert.equal(await P.page.locator('.lv-dmp-f.off').count(), 7, 'Classic: every other Done moments setting greys out (Voice greeting stays)');
    assert.ok(await P.page.locator('.lv-dmp [data-dm-act="play"]').isDisabled());
    assert.equal(JSON.parse(await P.page.evaluate(() => localStorage.getItem('lfmp-done'))).animation, 'classic');
    await P.page.keyboard.press('Escape'); await P.page.click('[data-lv-top] [data-lv="me"]');
    assert.match(await P.page.locator('[data-lv-top] [data-lv="done"]').innerText(), /Classic ›/, 'the Me row says Classic');
    // v2.11.0: the On / Off switch at the top (first setting); Off greys everything below except the voice greeting, overrides Classic
    await P.page.click('[data-lv-top] [data-lv="done"]'); await P.page.waitForSelector('.lv-dmp');
    assert.equal(await P.page.locator('.lv-dmp-f .lab').first().textContent(), 'Done moments', 'On / Off is the first setting');
    await P.page.click('.lv-dmp [data-dm="enabled"][data-v="off"]');
    assert.equal(await P.page.locator('.lv-dmp-f.off').count(), 8, 'Off: Animation and every setting below grey out (Voice greeting stays)');
    assert.ok(await P.page.locator('.lv-dmp [data-dm-act="play"]').isDisabled() && await P.page.locator('.lv-dmp [data-dm-act="voice"]').isDisabled());
    assert.match(await P.page.locator('.lv-dmp .dmh .chip').innerText(), /Off/);
    assert.equal(JSON.parse(await P.page.evaluate(() => localStorage.getItem('lfmp-done'))).enabled, false, 'saved as enabled: false');
    await P.page.keyboard.press('Escape'); await P.page.click('[data-lv-top] [data-lv="me"]');
    assert.match(await P.page.locator('[data-lv-top] [data-lv="done"]').innerText(), /Done moments\s*Off ›/, 'the Me row says Off');
    await P.page.click('[data-lv-top] [data-lv="done"]'); await P.page.waitForSelector('.lv-dmp');
    await P.page.click('.lv-dmp [data-dm="enabled"][data-v="on"]');
    assert.equal(JSON.parse(await P.page.evaluate(() => localStorage.getItem('lfmp-done'))).enabled, true, 'back On');
    assert.equal(await P.page.locator('.lv-dmp-f.off').count(), 7, 'On again: Classic (still picked) greys as before');
    await P.ctx.close();
    // ---- the voice greeting: On = once, with the right text, after a click; Off = never; never after it ends
    for (const [greet, enabled] of [['on', true], ['off', true], ['on', false]]) {   // v2.11.0: Done moments Off doesn't touch the voice greeting
      const G = await ctxFor({ greet: true, done: { ...DN.doneDefaults(), greet, enabled } });
      await G.page.goto(`${base}/?tool=builder`); await G.page.waitForFunction(() => window.ready);
      await G.page.mouse.click(5, 5);   // a click before: Chrome lets the page speak
      await G.page.evaluate(() => { try { localStorage.removeItem('lfmp-greet-day'); localStorage.setItem('lfmp-counts', JSON.stringify({ reviews: { n: 2, at: Date.now() }, scorecards: { n: 1, at: Date.now() }, clients: { n: 3, at: Date.now() } })); } catch {} window.calls.length = 0; window.gp = S.playGreeting({ me: { name: 'PJ', first: 'PJ' }, reads: [] }); });
      await G.page.waitForFunction(() => window.gp.then ? true : false); await G.page.evaluate(() => window.gp); await wait(1200);
      const said = (await G.page.evaluate(() => window.calls)).filter(c => c[0] === 'speak');
      if (greet === 'on') { assert.equal(said.length, 1, 'On: spoken once'); assert.match(said[0][1], /^Good (morning|afternoon|evening), Commander\./, said[0][1]); }
      else assert.equal(said.length, 0, 'Off: never spoken');
      await G.page.mouse.click(5, 5); await wait(300);
      assert.equal((await G.page.evaluate(() => window.calls)).filter(c => c[0] === 'speak').length, greet === 'on' ? 1 : 0, 'nothing after the greeting has ended');
      await G.ctx.close();
    }
  } finally { await browser.close(); server.close(); }
});
