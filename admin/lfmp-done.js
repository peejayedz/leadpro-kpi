// LFMP tools · Done moments (shared shell 2.10.0, queue item 6; PJ approved 21 Nov). Keep the three copies byte-identical:
// ghl-subaccount-builder page/, leadpro-kpi admin/, automation-review admin/ (with lfmp-done.css).
//
// What plays on YOUR computer when one of YOUR jobs finishes (Builder: new client / Add existing client; KPI admin: New
// firm; Review admin: package build): a popup that runs with the job's real progress, then a finish style with its own
// sound and a voice line. lfmp-session.js startJob({ ..., moment: {...} }) drives it; Animation = Classic turns all of it
// off (exactly what the tools did before: the setup card / working bar, no popup, no sound, no voice).
// Settings: localStorage "lfmp-done" (this computer, this person). The voice also reads the once-a-day greeting when
// "Voice greeting" is On (DM.speak).
//
// The engine below (from "Claude outputs/done-moments/engine/done-engine.js", the approved build) draws, plays and speaks;
// it is unchanged except: it runs only in a browser (the team site's server imports this file through lfmp-session.js),
// configure({ lines }) takes each tool's own words with the real client name, and thumb(id, host) draws a style's finished
// frame for the settings panel. All artwork, sounds and voice lines are our own.

export const DONE_KEY = 'lfmp-done';
export const HAS_DOM = typeof document !== 'undefined' && typeof window !== 'undefined' && typeof matchMedia === 'function';
export const STYLE_IDS = ['lockon', 'core', 'syscheck', 'opsgrid', 'globe', 'rain', 'hud'];
export const STYLES = [['lockon', 'Suit HUD · Lock-on'], ['core', 'Suit HUD · Power core'], ['syscheck', 'Suit HUD · Systems check'], ['opsgrid', 'Command wall · Ops grid'],
  ['globe', 'Command wall · Global map'], ['rain', 'Gold rain'], ['hud', 'HUD scan'], ['random', 'Surprise me (a different one each time)']];
export const SOUND_OF = { lockon: ['suitlock', 'Suit lock-on'], core: ['corecharge', 'Core charge'], syscheck: ['opsdone', 'Ops complete'], opsgrid: ['access', 'Access granted'], globe: ['opsdone', 'Ops complete'], rain: ['resolve', 'Digital resolve'], hud: ['radar', 'Radar lock'] };
export const ANIMATIONS = [['new', 'New popup'], ['classic', 'Classic']];
export const SOUND_MODES = [['all', 'Sound + voice'], ['sound', 'Sound only'], ['off', 'Off']];
export const GENDERS = [['guy', 'Guy'], ['girl', 'Girl']];
export const VOICE_STYLES = [['commander', 'Commander (deep)'], ['robot', 'Robot (flat, buzzy)'], ['control', 'Mission control (calm)'], ['announcer', 'Announcer (upbeat)']];
export const CALL_ME = ['Nothing', 'Master', 'Commander', 'Boss', 'Chief', 'Captain', 'Sir', 'Team', 'Custom'];
export const LINE_STYLES = [['commander', 'Commander'], ['report', 'Report'], ['mission', 'Mission'], ['hype', 'Hype'], ['short', 'Short']];
export const CLASSIC_HINT = 'Classic = exactly what you have today: the setup card and progress, no popup, no sound, no voice. The settings below grey out.';
export const GREET_HINT = 'When your once-a-day greeting plays, this voice reads it out.';

// PJ's account gets the voice greeting On by default (the team site's own name for him: first "PJ"); everyone else Off.
export const isPJ = me => String(me?.first || '').trim() === 'PJ' || /^PJ\b/.test(String(me?.name || '').trim());
export function doneDefaults(me = null) {
  return { animation: 'new', sound: 'all', style: 'syscheck', gender: 'guy', who: '', voice: 'commander', callme: 'Commander', custom: '', line: 'commander', greet: isPJ(me) ? 'on' : 'off' };
}
const pickFrom = (v, list, d) => (list.some(x => (Array.isArray(x) ? x[0] : x) === v) ? v : d);
// A saved value is used only when it's one of the choices (an old or edited value falls back to the default).
export function cleanDone(raw, me = null) {
  const d = doneDefaults(me), r = raw && typeof raw === 'object' ? raw : {};
  return {
    animation: pickFrom(r.animation, ANIMATIONS, d.animation), sound: pickFrom(r.sound, SOUND_MODES, d.sound), style: pickFrom(r.style, STYLES, d.style),
    gender: pickFrom(r.gender, GENDERS, d.gender), who: typeof r.who === 'string' ? r.who.slice(0, 120) : '', voice: pickFrom(r.voice, VOICE_STYLES, d.voice),
    callme: pickFrom(r.callme, CALL_ME, d.callme), custom: typeof r.custom === 'string' ? r.custom.replace(/[\u0000-\u001f]/g, '').slice(0, 40) : '',
    line: pickFrom(r.line, LINE_STYLES, d.line), greet: r.greet === 'on' || r.greet === 'off' ? r.greet : d.greet,
  };
}
const store0 = () => { try { return globalThis.localStorage || null; } catch { return null; } };
export function readDone(store = store0(), me = null) { try { return cleanDone(JSON.parse(store?.getItem(DONE_KEY) || 'null'), me); } catch { return doneDefaults(me); } }
export function saveDone(s, store = store0(), me = null) { const c = cleanDone(s, me); try { store?.setItem(DONE_KEY, JSON.stringify(c)); } catch {} return c; }
export const isClassic = s => s?.animation === 'classic';
// The name the voice uses: Nothing = none, Custom = what was typed (none if empty).
export const callName = s => (s.callme === 'Nothing' ? '' : s.callme === 'Custom' ? String(s.custom || '').trim() : s.callme);
// The Me row's value: "New popup · Sound + voice ›" / "Classic ›"
export const doneRowValue = s => (isClassic(s) ? 'Classic' : `New popup · ${(SOUND_MODES.find(m => m[0] === s.sound) || SOUND_MODES[0])[1]}`);
// FIX 6.1: the desktop name menu keeps it on one line ("New popup ›" / "Classic ›"); the phone Me screen has the full value
export const doneRowShort = s => (isClassic(s) ? 'Classic' : 'New popup');
// The engine's settings (its own names)
export const engineCfg = s => ({ mode: s.sound, gender: s.gender, who: s.who, voice: s.voice, callme: s.callme === 'Custom' ? '__custom' : s.callme === 'Nothing' ? '' : s.callme, custom: s.custom, style: s.line });

// ---------------------------------------------------------------- each tool's words (from the engine's LINES; {c} = client)
export const TOOL_LINES = {"builder": {"work": "Building {c}'s sub-account…", "steps": ["Copying the snapshot", "Adding custom fields", "Setting up pipelines", "Linking the review page"], "done": "Sub-account built · {c}", "name": "{c}", "say": {"commander": "Build complete@. {c} is ready.", "report": "^the build is complete. {c}'s sub-account is ready.", "mission": "Mission complete@. {c}'s sub-account is built and standing by.", "hype": "Boom@! {c} is built. Nice work.", "short": "Sub-account done@."}, "term": ["$ lfmp build \"{c}\" --plan custom", "→ reading snapshot: WPP Dental", "✓ custom fields (24)", "✓ pipelines (2)", "✓ calendars (1)", "→ linking the review page", "✓ tests 128/128", "$ lfmp deploy --draft"], "termDone": "✓ sub-account ready in 3.4s", "code": ["const client = await ghl.find(\"{c}\");", "const plan = await loadPlan(\"custom\");", "for (const step of plan.steps) {", "  await step.run(client); // fields, pipes", "}", "await reviewPage.link(client);", "builder.done({ draft: true });"], "file": "build.js", "mods": ["Fields", "Pipelines", "Calendars", "Review"], "nums": ["24", "2", "128"], "tag": "v1.31 · SHIPPED"}, "kpi": {"work": "Setting up {c}'s scorecard…", "steps": ["Reading the pipeline", "Mapping stages", "Building the dashboard", "Publishing the page"], "done": "Scorecard deployed · {c}", "name": "{c}", "say": {"commander": "Scorecard deployed@. {c} is online.", "report": "^the scorecard is deployed. {c} is online.", "mission": "Mission complete@. The {c} scorecard is deployed.", "hype": "Let's go@! {c}'s scorecard is up and running.", "short": "Scorecard done@."}, "term": ["$ kpi setup {s} --pipeline \"New Leads\"", "→ mapping 9 stages", "✓ counts match GHL", "✓ dashboard built", "✓ encrypted with passphrase", "→ checking light + dark", "✓ tests 96/96", "$ kpi publish --draft"], "termDone": "✓ scorecard deployed in 3.4s", "code": ["const firm = await ghl.find(\"{c}\");", "const stages = await mapStages(firm, 9);", "for (const tile of scorecard.tiles) {", "  tile.count = await countLeads(tile); // ok", "}", "await encrypt(scorecard, passphrase);", "kpi.publish({ draft: true });"], "file": "scorecard.js", "mods": ["Stages", "Counts", "Dashboard", "Publish"], "nums": ["9", "312", "96"], "tag": "scorecard · LIVE"}, "review": {"work": "Building {c}'s review package…", "steps": ["Reading the workflows", "Writing the plan", "Drawing the flows", "Saving the package"], "done": "Review package ready · {c}", "name": "{c}", "say": {"commander": "Review package ready@. Andy can take a look.", "report": "^the review package is ready for Andy.", "mission": "Mission complete@. The {c} review package is ready for inspection.", "hype": "Nailed it@! The {c} review package is ready for Andy.", "short": "Review package done@."}, "term": ["$ review build {s} --package", "→ reading 7 workflows", "✓ plan written", "✓ flows drawn", "✓ messages checked", "→ matching the brand", "✓ tests 64/64", "$ review save --draft"], "termDone": "✓ package ready for Andy", "code": ["const flows = await ghl.workflows(\"{c}\");", "const plan = writePlan(flows);", "for (const flow of flows) {", "  drawFlow(flow); // boxes + arrows", "}", "await checkMessages(plan);", "review.save({ for: \"Andy\" });"], "file": "review.js", "mods": ["Workflows", "Plan", "Flows", "Package"], "nums": ["7", "31", "64"], "tag": "package · READY"}};
export const TOOL_OF = { builder: 'builder', reports: 'builder', kpi: 'kpi', review: 'review' };
const fill = (t, c, s) => String(t).replace(/The \{c\}/g, /^the\s/i.test(c) ? c : `The ${c}`).replace(/\{c\}/g, c).replace(/\{s\}/g, s);
const walk = (o, c, s) => (typeof o === 'string' ? fill(o, c, s) : Array.isArray(o) ? o.map(x => walk(x, c, s)) : Object.fromEntries(Object.entries(o).map(([k, v]) => [k, walk(v, c, s)])));
export function linesFor(tool, client = '', steps = null) {
  const t = TOOL_LINES[TOOL_OF[tool] || 'builder'], c = String(client || '').trim() || 'the client';
  const s = c.toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 2).join('-') || 'client';
  const L = walk(t, c, s);
  if (Array.isArray(steps) && steps.length) L.steps = steps.map(String);
  return L;
}
// The voice line, the engine's rule: "@" = ", <name>" (or nothing); "^" = starts with the name ("Commander, the build…")
export function lineText(L, style, name) {
  const t = L.say[style] || L.say.commander;
  if (t[0] === '^') { const r = t.slice(1); return name ? `${name}, ${r}` : r[0].toUpperCase() + r.slice(1); }
  return t.replace('@', name ? `, ${name}` : '');
}

// ---------------------------------------------------------------- the voice greeting text
export const daypart = hour => (hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening');
const GREET_COUNT = [['reviews', 'review needs you', 'reviews need you'], ['scorecards', 'scorecard needs attention', 'scorecards need attention'], ['clients', 'client is in progress', 'clients are in progress']];
// counts: { reviews, scorecards, clients }; a count that isn't ready (undefined / null) is left out, a 0 is left out of the
// sentence; all known counts 0 → "Everything is clear." Name = Call me, or the first name when Call me is Nothing.
export function greetVoiceText({ hour = new Date().getHours(), settings, first = '', counts = {} }) {
  const name = callName(settings) || String(first || '').trim();
  const known = GREET_COUNT.filter(([k]) => Number.isFinite(counts?.[k]));
  const parts = known.filter(([k]) => counts[k] > 0).map(([k, one, many]) => `${counts[k]} ${counts[k] === 1 ? one : many}`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}` : parts[0] || '';
  const tail = parts.length ? ` ${list[0].toUpperCase()}${list.slice(1)}.` : known.length ? ' Everything is clear.' : '';
  return `${daypart(hour)}${name ? `, ${name}` : ''}.${tail}`;
}

// ---------------------------------------------------------------- the popup for a job (null = Classic / no browser / no engine)
// o: { tool, client, steps?, workSub?, sub?, onOpen? }. Returns { progress(p, label), finish(sub?), fail() }.
let testHooks = null;   // tests: { sound(id), speak(text) } replace the real ones (or window.__lfmpDoneHooks in a browser test)
export const _setDoneHooks = h => { testHooks = h; };
const hooks = () => testHooks || (HAS_DOM ? window.__lfmpDoneHooks || null : null);
export function openMoment(o, { store = store0(), me = null } = {}) {
  const s = readDone(store, me);
  if (isClassic(s) || !HAS_DOM || !window.DM) return null;
  const DM = window.DM, L = linesFor(o.tool, o.client, o.steps);
  DM.configure({ ...engineCfg(s), tool: TOOL_OF[o.tool] || 'builder', lines: L });
  DM.configure({ hooks: hooks() });
  const style = s.style === 'random' ? STYLE_IDS[Math.floor(Math.random() * STYLE_IDS.length)] : s.style;
  let done = false;
  const h = DM.play(style, { manual: true, workSub: o.workSub || 'Working… you can hide this and keep using the site.', sub: o.sub || 'Just now',
    openLabel: o.client ? `Open ${o.client}` : 'Open', onOpen: o.onOpen });
  return {
    progress: (p, label) => { if (!done) h.progress(p, label); },
    finish: sub => { if (done) return; done = true; if (sub) DM.configure({ doneSub: sub }); h.finish(); },
    fail: () => { if (done) return; done = true; h.close({ quiet: true }); },
    style,
  };
}
// The settings' "Play my done moment" (a quick run) and "Test voice"
export function playSample(s, tool = 'builder') {
  if (!HAS_DOM || !window.DM) return;
  const DM = window.DM; DM.unlock(); DM.configure({ ...engineCfg(s), tool: TOOL_OF[tool] || 'builder', lines: linesFor(tool, 'Boca Dental') });
  DM.configure({ hooks: hooks() });
  DM.play(s.style === 'random' ? STYLE_IDS[Math.floor(Math.random() * STYLE_IDS.length)] : s.style, { work: 2400, openLabel: 'Close', sub: 'A quick run of your done moment' });
}
export function testVoice(s) {
  if (!HAS_DOM || !window.DM) return;
  const DM = window.DM; DM.unlock(); DM.configure({ ...engineCfg(s), lines: linesFor('builder', 'Boca Dental'), tool: 'builder' });
  DM.configure({ hooks: hooks() });
  DM.speak(lineText(linesFor('builder', 'Boca Dental'), s.line, callName(s)));
}
export function speakText(s, text) {
  if (!HAS_DOM || !window.DM) return false;
  const DM = window.DM; DM.configure({ ...engineCfg(s), mode: 'all' });
  DM.configure({ hooks: hooks() });
  DM.speak(text); return true;
}
export const voiceList = () => (HAS_DOM && window.DM ? window.DM.voices() : []);
export function thumb(id, host, tool = 'builder') {
  if (!HAS_DOM || !window.DM || !host) return;
  window.DM.configure({ tool: TOOL_OF[tool] || 'builder', lines: linesFor(tool, 'Boca Dental') });
  window.DM.thumb(id === 'random' ? 'syscheck' : id, host);
}


// ---------------------------------------------------------------- the settings panel (Me → Done moments)
const escH = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sw = (key, label, opts, on) => `<div class="lv-sw" role="group" aria-label="${escH(label)}">${opts.map(([k, l]) => `<button type="button" class="lv-hit" data-dm="${key}" data-v="${k}" aria-pressed="${k === on}">${escH(l)}</button>`).join('')}</div>`;
const sel = (key, label, opts, on) => `<select data-dm="${key}" aria-label="${escH(label)}">${opts.map(([k, l]) => `<option value="${escH(k)}"${k === on ? ' selected' : ''}>${escH(l)}</option>`).join('')}</select>`;
const fld = (label, ctrl, hint = '', off = false) => `<div class="lv-dmp-f${off ? ' off' : ''}"><div class="lab">${escH(label)}</div>${ctrl}${hint ? `<p class="hint">${hint}</p>` : ''}</div>`;
export function donePanelHtml(s, { voices = [], phone = false } = {}) {
  const C = isClassic(s), name = callName(s), sample = linesFor('builder', 'Boca Dental');
  const st = STYLES.find(x => x[0] === s.style) || STYLES[2], snd = SOUND_OF[s.style === 'random' ? 'syscheck' : s.style];
  const vs = voices.length ? voices : [''];
  const who = s.who && vs.includes(s.who) ? s.who : vs[0];
  const voiceName = who ? who.replace(/ \(.*\)$/, '') : 'the computer\'s voice';
  const lines = LINE_STYLES.map(([k, l]) => [k, `${l} · "${lineText(sample, k, name)}"`]);
  return `<div class="lv-dmp-shade" data-dm-close></div><aside class="lv-dmp" role="dialog" aria-modal="true" aria-labelledby="lvDmpT">
  <div class="lv-dmp-head"><div><p class="ey">Your settings</p><h2 id="lvDmpT">Done moments</h2></div><button type="button" class="lv-dmp-x lv-hit" data-dm-close aria-label="Close"><span class="x" aria-hidden="true">×</span><span class="bk">‹ Me</span></button></div>
  <div class="lv-dmp-body"><section class="lv-dmp-card">
    <div class="dmh"><h4>Done moments</h4><span class="chip${C ? ' off' : ''}"><span class="dot"></span>${C ? 'Classic' : 'On'}</span></div>
    <p class="dmlead">What plays on your computer when one of your jobs finishes in the Builder, KPI admin or Review admin. Only you hear it, and only for jobs you started.</p>
    <div class="lv-dmp-prev${C ? ' off' : ''}"><div class="dm-pop dm-thumb" data-dm-thumb aria-hidden="true"></div><div><b>${escH(st[1])}</b><small>${s.style === 'random' ? 'A different style and sound each time' : `${escH(snd[1])} sound`} · ${escH(voiceName)}, ${escH((VOICE_STYLES.find(v => v[0] === s.voice) || VOICE_STYLES[0])[1].replace(/ \(.*\)$/, ''))} style</small></div></div>
    <div class="lv-dmp-btns"><button class="btn primary" type="button" data-dm-act="play"${C ? ' disabled' : ''}>▶ Play my done moment</button><button class="btn" type="button" data-dm-act="voice"${C || s.sound !== 'all' ? ' disabled' : ''}>Test voice</button></div>
    ${fld('Animation', sw('animation', 'Animation', ANIMATIONS, s.animation), escH(CLASSIC_HINT))}
    ${fld('Sound', sw('sound', 'Sound', SOUND_MODES, s.sound), '', C)}
    ${fld('Finish style', sel('style', 'Finish style', STYLES, s.style), '', C)}
    ${fld('Voice', sw('gender', 'Voice', GENDERS, s.gender), '', C)}
    ${fld('Which voice', sel('who', 'Which voice', vs.map(v => [v, v || 'The computer\'s voice']), who), `The ${s.gender === 'girl' ? 'girl' : 'guy'} voices on this computer, best first. Switch to ${s.gender === 'girl' ? 'Guy' : 'Girl'} for the ${s.gender === 'girl' ? 'guy' : 'girl'} voices.`, C)}
    ${fld('Voice style', sel('voice', 'Voice style', VOICE_STYLES, s.voice), '', C)}
    ${fld('Call me', `${sel('callme', 'Call me', CALL_ME.map(k => [k, k === 'Custom' ? 'Custom…' : k]), s.callme)}${s.callme === 'Custom' ? `<input type="text" data-dm="custom" maxlength="40" value="${escH(s.custom)}" placeholder="e.g. PJ" aria-label="Your name for the voice">` : ''}`, 'Custom lets you type any name, e.g. PJ.', C)}
    ${fld('Line', sel('line', 'Line', lines, s.line), '', C)}
    ${fld('Voice greeting', sw('greet', 'Voice greeting', [['on', 'On'], ['off', 'Off']], s.greet), `${escH(GREET_HINT)} <button class="lv-dmp-link" type="button" data-dm-act="greet">Hear it</button>`)}
  </section>
  <p class="lv-dmp-note">Saved for you on this computer. Plays at your computer's volume. If "Reduce motion" is on, you get the finished frame at once instead of the animation.</p></div></aside>`;
}
// Opens the panel; onChange(settings) after every change (the Me row's value follows).
let panelOpen = null;
export function openDonePanel({ me = null, store = store0(), onChange, greetSample } = {}) {
  if (!HAS_DOM) return;
  closeDonePanel();
  const host = document.createElement('div'); host.className = 'lv-dmp-host'; document.body.append(host);
  const prev = document.activeElement;
  let s = readDone(store, me);
  const voices = () => { try { window.DM?.configure({ gender: s.gender }); } catch {} return voiceList(); };   // the engine lists the voices of the chosen kind
  const paint = () => {
    const keep = host.querySelector('.lv-dmp')?.scrollTop || 0, focusKey = document.activeElement?.dataset?.dm, focusV = document.activeElement?.dataset?.v;
    host.innerHTML = donePanelHtml(s, { voices: voices() });
    host.querySelector('.lv-dmp').scrollTop = keep;
    const th = host.querySelector('[data-dm-thumb]');
    if (th) { thumb(s.style, th); const fit = () => { const st = th.querySelector('.stage'); if (st) st.style.transform = `scale(${th.clientWidth / 440})`; }; fit(); requestAnimationFrame(fit); }
    if (focusKey) (host.querySelector(`[data-dm="${focusKey}"]${focusV ? `[data-v="${focusV}"]` : ''}`))?.focus();
  };
  const set = patch => { s = saveDone({ ...s, ...patch }, store, me); paint(); onChange?.(s); };
  host.addEventListener('click', e => {
    if (e.target.closest('[data-dm-close]')) { closeDonePanel(); return; }
    const b = e.target.closest('button[data-dm]'); if (b) { const k = b.dataset.dm, v = b.dataset.v; set(k === 'gender' ? { gender: v, who: '' } : { [k]: v }); return; }
    const a = e.target.closest('[data-dm-act]'); if (!a || a.disabled) return;
    if (a.dataset.dmAct === 'play') playSample(s);
    else if (a.dataset.dmAct === 'voice') testVoice(s);
    else if (a.dataset.dmAct === 'greet') speakText(s, greetSample ? greetSample(s) : greetVoiceText({ settings: s, counts: { reviews: 2, scorecards: 1, clients: 3 } }));
  });
  host.addEventListener('change', e => { const el = e.target.closest('select[data-dm]'); if (el) set({ [el.dataset.dm]: el.value }); });
  host.addEventListener('input', e => { const el = e.target.closest('input[data-dm="custom"]'); if (el) { s = saveDone({ ...s, custom: el.value }, store, me); onChange?.(s); } });
  const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.dm-pop:not(.dm-thumb)')) { e.preventDefault(); closeDonePanel(); } };
  document.addEventListener('keydown', onKey, true);
  const onVoices = () => paint();
  try { speechSynthesis.addEventListener('voiceschanged', onVoices); } catch {}
  panelOpen = () => { document.removeEventListener('keydown', onKey, true); try { speechSynthesis.removeEventListener('voiceschanged', onVoices); } catch {} host.remove(); panelOpen = null; try { prev?.focus?.({ preventScroll: true }); } catch {} };
  paint(); host.querySelector('.lv-dmp-x')?.focus();
}
export function closeDonePanel() { panelOpen?.(); }

// ================================================================= the engine (approved build; see the header)
if (HAS_DOM) {
window.DM_EMBED = true;
(()=>{
const $=s=>document.querySelector(s);
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
const LINES={
  builder:{work:"Building Boca Dental's sub-account…",steps:["Copying the snapshot","Adding custom fields","Setting up pipelines","Linking the review page"],done:"Sub-account built · Boca Dental",name:"Boca Dental",
    say:{commander:"Build complete@. Boca Dental is ready.",report:"^the build is complete. Boca Dental's sub-account is ready.",mission:"Mission complete@. Boca Dental's sub-account is built and standing by.",hype:"Boom@! Boca Dental is built. Nice work.",short:"Sub-account done@."},
    term:['$ lfmp build "Boca Dental" --plan custom','→ reading snapshot: WPP Dental','✓ custom fields (24)','✓ pipelines (2)','✓ calendars (1)','→ linking the review page','✓ tests 128/128','$ lfmp deploy --draft'],termDone:'✓ sub-account ready in 3.4s',
    code:['const client = await ghl.find("Boca Dental");','const plan = await loadPlan("custom");','for (const step of plan.steps) {','  await step.run(client); // fields, pipes','}','await reviewPage.link(client);','builder.done({ draft: true });'],
    file:'build.js',mods:['Fields','Pipelines','Calendars','Review'],nums:['24','2','128'],tag:'v1.31 · SHIPPED'},
  kpi:{work:"Setting up The Mahdavi Law Firm's scorecard…",steps:["Reading the pipeline","Mapping stages","Building the dashboard","Publishing the page"],done:"Scorecard deployed · Mahdavi",name:"Mahdavi Law",
    say:{commander:"Scorecard deployed@. The Mahdavi Law Firm is online.",report:"^the scorecard is deployed. Mahdavi is online.",mission:"Mission complete@. The Mahdavi scorecard is deployed.",hype:"Let's go@! Mahdavi's scorecard is up and running.",short:"Scorecard done@."},
    term:['$ kpi setup mahdavi --pipeline "New Leads"','→ mapping 9 stages','✓ counts match GHL','✓ dashboard built','✓ encrypted with passphrase','→ checking light + dark','✓ tests 96/96','$ kpi publish --draft'],termDone:'✓ scorecard deployed in 3.4s',
    code:['const firm = await ghl.find("Mahdavi Law");','const stages = await mapStages(firm, 9);','for (const tile of scorecard.tiles) {','  tile.count = await countLeads(tile); // ok','}','await encrypt(scorecard, passphrase);','kpi.publish({ draft: true });'],
    file:'scorecard.js',mods:['Stages','Counts','Dashboard','Publish'],nums:['9','312','96'],tag:'scorecard · LIVE'},
  review:{work:"Building Dumas & Sanclemente's review package…",steps:["Reading the workflows","Writing the plan","Drawing the flows","Saving the package"],done:"Review package ready · Dumas",name:"Dumas & Sanclemente",
    say:{commander:"Review package ready@. Andy can take a look.",report:"^the review package is ready for Andy.",mission:"Mission complete@. The Dumas review package is ready for inspection.",hype:"Nailed it@! The Dumas review package is ready for Andy.",short:"Review package done@."},
    term:['$ review build dumas --package','→ reading 7 workflows','✓ plan written','✓ flows drawn','✓ messages checked','→ matching the brand','✓ tests 64/64','$ review save --draft'],termDone:'✓ package ready for Andy',
    code:['const flows = await ghl.workflows("Dumas");','const plan = writePlan(flows);','for (const flow of flows) {','  drawFlow(flow); // boxes + arrows','}','await checkMessages(plan);','review.save({ for: "Andy" });'],
    file:'review.js',mods:['Workflows','Plan','Flows','Package'],nums:['7','31','64'],tag:'package · READY'}
};
let tool='builder';
const EMBED=!!window.DM_EMBED,CFG={voice:'commander',style:'commander',callme:'Commander',custom:'PJ',who:''};
function setting(k){if(EMBED)return CFG[k];const el=$('#'+k);return el?el.value:CFG[k]}
function addr(){const v=setting('callme');return v==='__custom'?String(setting('custom')||'').trim():v}
function lineText(){const t=LINES[tool].say[setting('style')],a=addr();if(t[0]==='^'){const r=t.slice(1);return a?a+', '+r:r[0].toUpperCase()+r.slice(1)}return t.replace('@',a?', '+a:'')}

/* ================= AUDIO ================= */
let AC,OUT;
function ac(){if(!AC){AC=new (window.AudioContext||window.webkitAudioContext)();OUT=AC.createGain();OUT.gain.value=1;OUT.connect(AC.destination)}if(AC.state==='suspended')AC.resume();return AC}

function echoNode(c){const d=c.createDelay(1);d.delayTime.value=.3;const fb=c.createGain();fb.gain.value=.38;d.connect(fb);fb.connect(d);d.connect(OUT);return d}
function tone({type='sine',f=440,f2,t=0,d=.3,g=.2,a=.005,lp,echo}){const c=ac(),n=c.currentTime+t,o=c.createOscillator(),v=c.createGain();o.type=type;o.frequency.setValueAtTime(f,n);if(f2)o.frequency.exponentialRampToValueAtTime(f2,n+d);v.gain.setValueAtTime(.0001,n);v.gain.exponentialRampToValueAtTime(g,n+a);v.gain.exponentialRampToValueAtTime(.0001,n+d);let node=o;if(lp){const fl=c.createBiquadFilter();fl.type='lowpass';fl.frequency.value=lp;o.connect(fl);node=fl}node.connect(v);v.connect(OUT);if(echo)v.connect(echoNode(c));o.start(n);o.stop(n+d+.05)}
function noise({t=0,d=.4,g=.2,type='bandpass',f=800,f2,q=1}){const c=ac(),n=c.currentTime+t,len=Math.max(1,Math.ceil(c.sampleRate*d)),b=c.createBuffer(1,len,c.sampleRate),ch=b.getChannelData(0);for(let i=0;i<len;i++)ch[i]=Math.random()*2-1;const s=c.createBufferSource();s.buffer=b;const fl=c.createBiquadFilter();fl.type=type;fl.frequency.setValueAtTime(f,n);if(f2)fl.frequency.exponentialRampToValueAtTime(f2,n+d);fl.Q.value=q;const v=c.createGain();v.gain.setValueAtTime(.0001,n);v.gain.exponentialRampToValueAtTime(g,n+Math.min(.02,d/2));v.gain.exponentialRampToValueAtTime(.0001,n+d);s.connect(fl);fl.connect(v);v.connect(OUT);s.start(n);s.stop(n+d)}
const SOUNDS={
  mech:{name:'Mech clunk',desc:'Servo whirr, two heavy clunks, low hum, two-note chime.',at:1.3,play(){noise({d:.55,f:300,f2:2600,g:.22,q:.8});tone({type:'sawtooth',f:90,f2:240,t:.05,d:.35,g:.07,lp:900});tone({type:'sawtooth',f:120,f2:320,t:.42,d:.3,g:.06,lp:900});tone({f:95,f2:38,t:.78,d:.32,g:.55});noise({t:.78,d:.09,type:'lowpass',f:1800,g:.3});tone({f:72,f2:34,t:1,d:.38,g:.5});noise({t:1,d:.1,type:'lowpass',f:1400,g:.28});tone({f:55,t:1.2,d:1.1,g:.22,a:.08});tone({type:'triangle',f:659,t:1.22,d:.6,g:.12});tone({type:'triangle',f:988,t:1.36,d:1,g:.1})}},
  resolve:{name:'Digital resolve',desc:'Fast digital chirps, then four rising notes and a shimmer.',at:1.3,play(){for(let i=0;i<14;i++)tone({type:'square',f:1000+Math.random()*1800,t:i*.055,d:.04,g:.025});[523,659,784,1047].forEach((f,i)=>tone({f,t:.85+i*.1,d:i==3?1:.5,g:.12}));noise({t:.85,d:.7,type:'highpass',f:6000,g:.04})}},
  radar:{name:'Radar lock',desc:'Three pings, a beep-beep-beep lock-on, deep bass hit.',at:1.3,play(){[0,.32,.64].forEach(t=>{tone({f:1500,t,d:.35,g:.11});tone({f:3000,t,d:.15,g:.025})});tone({type:'square',f:880,t:.95,d:.06,g:.05});tone({type:'square',f:880,t:1.05,d:.06,g:.05});tone({type:'square',f:1320,t:1.16,d:.12,g:.05});tone({f:62,f2:40,t:1.25,d:.75,g:.55});noise({t:1.25,d:.45,type:'lowpass',f:420,g:.25})}},
  warp:{name:'Warp jump',desc:'Rising whoosh, big boom, sparkle.',at:1.5,play(){noise({d:1,f:200,f2:6000,g:.18,q:.7});tone({type:'sawtooth',f:80,f2:900,d:1,g:.07,lp:1200});tone({f:70,f2:28,t:1.02,d:.8,g:.6});noise({t:1.02,d:.5,type:'lowpass',f:600,g:.35});[1568,2093,2637].forEach((f,i)=>tone({type:'triangle',f,t:1.15+i*.06,d:.5,g:.05}))}},
  powerup:{name:'Power-up',desc:'Rising sweep that lands on a bright chord.',at:1.3,play(){tone({type:'triangle',f:220,f2:1760,d:.9,g:.1});tone({f:330,f2:2640,d:.9,g:.04});[523,659,784,1047].forEach(f=>tone({type:'triangle',f,t:.9,d:1.1,g:.07}))}},
  sonar:{name:'Deep sonar',desc:'Two deep pings that echo away.',at:1.7,play(){tone({f:420,f2:400,d:1.2,g:.25,echo:true});tone({f:840,d:.5,g:.05,echo:true});tone({f:520,t:.9,d:1.2,g:.22,echo:true})}},
  glitch:{name:'Glitch fix',desc:'Broken digital crackle that snaps clean into two tones.',at:1.3,play(){for(let i=0;i<18;i++){const t=i*.04;if(Math.random()<.55)tone({type:'square',f:200+Math.random()*2800,t,d:.02+Math.random()*.03,g:.05});else noise({t,d:.03,type:'highpass',f:2000,g:.12})}tone({f:880,t:.8,d:.4,g:.1});tone({f:1320,t:.88,d:.6,g:.08})}},
  vault:{name:'Vault open',desc:'Ratchet clicks, a heavy thunk, then a hiss of air.',at:1.5,play(){for(let i=0;i<8;i++){noise({t:i*.07,d:.025,f:3200,q:4,g:.28});tone({type:'square',f:1800,t:i*.07,d:.012,g:.02})}tone({f:65,f2:30,t:.7,d:.5,g:.6});noise({t:.7,d:.2,type:'lowpass',f:500,g:.35});noise({t:.85,d:.9,type:'highpass',f:2500,g:.07})}},
  braam:{name:'Cinema horn',desc:'Big low brass swell, movie-trailer style.',at:1.2,play(){[55,82.4,110].forEach(f=>tone({type:'sawtooth',f,d:2,g:.12,a:.25,lp:700}));tone({f:41,d:2,g:.25,a:.2})}},
  laser:{name:'Charge & zap',desc:'A charging whine, then a sharp zap.',at:1.4,play(){tone({type:'sawtooth',f:150,f2:2400,d:.9,g:.06,lp:3000});tone({type:'square',f:1800,f2:90,t:.92,d:.28,g:.1});noise({t:.92,d:.2,type:'highpass',f:4000,g:.1})}},
  arcade:{name:'Level up',desc:'Quick 8-bit arpeggio, retro game style.',at:1,play(){[523,659,784,1047,1319].forEach((f,i)=>tone({type:'square',f,t:i*.07,d:.08,g:.06}));tone({type:'square',f:1568,t:.4,d:.35,g:.06});tone({type:'triangle',f:262,t:.4,d:.35,g:.1})}},
  victory:{name:'Victory stab',desc:'Two bright brass chords: da-DAAA.',at:1.3,play(){[262,330,392,523].forEach(f=>tone({type:'sawtooth',f,d:.18,g:.05,a:.01,lp:2200}));[349,440,523,698].forEach(f=>tone({type:'sawtooth',f,t:.22,d:.9,g:.05,a:.01,lp:2200}))}},
  glass:{name:'Soft glass',desc:'Gentle glass chime.',office:true,at:1,play(){[1318,1976,2637].forEach((f,i)=>tone({f,t:i*.09,d:1.6,g:.06}))}},
  bell:{name:'Success bell',desc:'Classic two-tone ding.',office:true,at:1,play(){tone({type:'triangle',f:880,d:.9,g:.12});tone({f:1760,d:.5,g:.03});tone({type:'triangle',f:1320,t:.18,d:1.2,g:.1});tone({f:2640,t:.18,d:.6,g:.03})}},
  shipit:{name:'Ship it',desc:'Three rising beeps, a whoosh, and a bright finish chord.',at:1.4,play(){[660,880,1100].forEach((f,i)=>tone({type:'square',f,t:i*.1,d:.07,g:.05}));noise({t:.35,d:.5,f:800,f2:5000,g:.12});[392,494,587,784].forEach(f=>tone({type:'sawtooth',f,t:.85,d:1,g:.045,a:.02,lp:2400}))}},
  suitlock:{name:'Suit lock-on',desc:'Servo sweep, three quick beeps, a heavy lock and a bright shimmer.',at:1.3,play(){tone({f:300,f2:1200,d:.5,g:.06});[.5,.58,.66].forEach(t=>tone({type:'square',f:1760,t,d:.04,g:.04}));tone({f:90,f2:45,t:.8,d:.5,g:.55});noise({t:.8,d:.15,type:'lowpass',f:900,g:.3});noise({t:.82,d:.8,type:'highpass',f:7000,g:.05});[523,784,1047].forEach(f=>tone({f,t:.86,d:1.2,g:.05}))}},
  corecharge:{name:'Core charge',desc:'A deep power-up that builds and builds, then a blast and a ringing tone.',at:1.5,play(){tone({type:'sawtooth',f:60,f2:620,d:1.1,g:.07,lp:1400});tone({f:120,f2:1240,d:1.1,g:.04});noise({d:1.1,f:300,f2:4000,g:.08,q:.6});tone({f:70,f2:30,t:1.12,d:.8,g:.6});noise({t:1.12,d:.4,type:'lowpass',f:700,g:.35});tone({type:'triangle',f:1318,t:1.2,d:1.2,g:.06})}},
  opsdone:{name:'Ops complete',desc:'Computer data chirps, a two-tone confirm, then a warm chord.',at:1.4,play(){for(let i=0;i<10;i++)tone({type:'triangle',f:900+Math.random()*1100,t:i*.05,d:.05,g:.04});tone({type:'square',f:1046,t:.6,d:.1,g:.05});tone({type:'square',f:1568,t:.72,d:.14,g:.05});[262,392,523,659].forEach(f=>tone({type:'sawtooth',f,t:.85,d:1.4,g:.035,a:.1,lp:1500}));tone({f:65,t:.85,d:1,g:.2,a:.05})}},
  access:{name:'Access granted',desc:'Rapid code-crack ticks, a lock release, and a low confirm tone.',at:1.4,play(){for(let i=0;i<20;i++)tone({type:'square',f:600+i*60,t:i*.035,d:.02,g:.03});noise({t:.75,d:.08,f:1800,q:5,g:.3});tone({f:110,t:.85,d:.9,g:.3,a:.02});tone({type:'triangle',f:440,t:.85,d:.9,g:.08});tone({type:'triangle',f:660,t:.95,d:.9,g:.07})}}
};

/* ================= VOICE ================= */
let voices=[],gender='guy';
function loadVoices(){try{voices=speechSynthesis.getVoices()}catch(e){voices=[]}}
if('speechSynthesis' in window){loadVoices();try{speechSynthesis.addEventListener('voiceschanged',loadVoices)}catch(e){speechSynthesis.onvoiceschanged=loadVoices}($('#vnote')||{}).textContent=''}else{($('#vnote')||{}).textContent='This browser has no built-in speech, so the preview plays the sounds only.'}
const MALE=/daniel|alex\b|fred|aaron|arthur|\bguy\b|david|ralph|bruce|mark|google uk english male|\bmale\b/i,FEMALE=/samantha|karen|serena|moira|google us english|google uk english female|zira|aria|jenny|female/i;
const GUY_ORDER=['daniel','aaron','arthur','alex','google uk english male','microsoft guy','microsoft david','microsoft mark','microsoft ryan','fred','ralph','albert','reed','eddy','rocko','junior'],GIRL_ORDER=['samantha','karen','moira','tessa','google us english','google uk english female','microsoft aria','microsoft jenny','microsoft zira','victoria','fiona'];
function shortlist(){try{const fresh=speechSynthesis.getVoices();if(fresh.length)voices=fresh}catch(e){}const en=voices.filter(v=>/^en/i.test(v.lang)),order=gender==='girl'?GIRL_ORDER:GUY_ORDER,out=[];for(const k of order){const v=en.find(x=>x.name.toLowerCase().startsWith(k)&&!out.includes(x));if(v)out.push(v);if(out.length>=4)break}return out}
function fillWho(){const sel=$('#who');if(!sel)return;const cur=sel.value,L=shortlist();sel.innerHTML=L.length?L.map(v=>`<option value="${v.name.replace(/"/g,'&quot;')}">${v.name.replace(/ \(.*\)$/,'')}</option>`).join(''):'<option value="">Default voice</option>';if([...sel.options].some(o=>o.value===cur))sel.value=cur}
setTimeout(fillWho,300);try{speechSynthesis.addEventListener('voiceschanged',fillWho)}catch(e){}
function pick(){const chosen=setting('who');if(chosen){const v=speechSynthesis.getVoices().find(x=>x.name===chosen);if(v)return v}try{const fresh=speechSynthesis.getVoices();if(fresh.length)voices=fresh}catch(e){}const en=voices.filter(v=>/^en/i.test(v.lang));if(!en.length)return null;const order=gender==='girl'?GIRL_ORDER:GUY_ORDER;for(const k of order){const v=en.find(x=>x.name.toLowerCase().startsWith(k)||x.name.toLowerCase().includes(k+' '));if(v)return v}return en.find(v=>gender==='girl'?FEMALE.test(v.name):(MALE.test(v.name)&&!/female/i.test(v.name)))||en[0]}
function say(text){if(CFG.hooks&&CFG.hooks.speak){if(setting('voice')==='off')return;CFG.hooks.speak(text);return}const mode=setting('voice');if(mode==='off'||!('speechSynthesis' in window))return;try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text),v=pick();if(v){u.voice=v;u.lang=v.lang;const vn=document.getElementById('vname');if(vn)vn.textContent='Speaking with: '+v.name}
  const P={commander:[.55,.82],robot:[.4,1.1],control:[1,.98],announcer:[1.2,1.08]}[mode];u.pitch=P[0];u.rate=P[1];
  if(mode==='commander'){tone({f:48,d:2.4,g:.07,a:.2});tone({type:'sawtooth',f:96,d:2.4,g:.012,a:.2,lp:300})}
  if(mode==='robot'){tone({type:'sawtooth',f:140,d:2,g:.012,a:.1,lp:900});tone({type:'square',f:70,d:2,g:.008,a:.1,lp:400})}
  u.volume=1;speechSynthesis.speak(u)}catch(e){}}
let doneMode='all';
function playSound(id,force){if(CFG.hooks&&CFG.hooks.sound){if(doneMode==='off'&&!force)return;CFG.hooks.sound(id);if((doneMode==='all'||force)&&CFG.hooks.speak)CFG.hooks.speak(lineText());return}if(doneMode==='off'&&!force)return;const s=SOUNDS[id];ac();s.play();if(doneMode==='all'||force)setTimeout(()=>say(lineText()),s.at*1000)}

/* ================= DRAW HELPERS ================= */
function colors(el){const cs=getComputedStyle(el||document.documentElement),v=n=>cs.getPropertyValue(n).trim();return{bg2:v('--panel2'),panel:v('--panel'),line:v('--line'),fg:v('--fg'),mut:v('--mut'),gold:v('--gold'),gold2:v('--gold2'),ok:v('--ok'),hud:v('--hud'),steel:v('--steel')}}
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const easeOut=x=>1-Math.pow(1-x,3);
function bounce(x){const n=7.5625,d=2.75;if(x<1/d)return n*x*x;if(x<2/d)return n*(x-=1.5/d)*x+.75;if(x<2.5/d)return n*(x-=2.25/d)*x+.9375;return n*(x-=2.625/d)*x+.984375}
function check(ctx,cx,cy,r,prog,col){prog=clamp(prog);if(prog<=0)return;ctx.save();ctx.lineWidth=Math.max(3,r*.14);ctx.strokeStyle=col;ctx.lineCap='round';ctx.lineJoin='round';
  ctx.beginPath();ctx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.min(1,prog*1.6));ctx.stroke();
  const q=clamp((prog-.45)/.55);if(q>0){const a=[cx-r*.42,cy+r*.02],b=[cx-r*.1,cy+r*.34],c=[cx+r*.45,cy-r*.3];ctx.beginPath();ctx.moveTo(a[0],a[1]);
    if(q<.4){const k=q/.4;ctx.lineTo(a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k)}else{ctx.lineTo(b[0],b[1]);const k=(q-.4)/.6;ctx.lineTo(b[0]+(c[0]-b[0])*k,b[1]+(c[1]-b[1])*k)}ctx.stroke()}ctx.restore()}
const AREA=h=>h-84; /* drawable height above the job card */

/* canvas animation controller */
function canvasCtrl(stage,def){const cv=document.createElement('canvas');cv.className='cv';cv.setAttribute('aria-hidden','true');stage.prepend(cv);const ctx=cv.getContext('2d');let S=null,raf=0,C=colors(stage);
  function size(){const w=stage.clientWidth||stage.getBoundingClientRect().width,h=stage.clientHeight||stage.getBoundingClientRect().height,sc=Math.max(1,(stage.getBoundingClientRect().width/(w||1))||1),dpr=(devicePixelRatio||1)*sc;cv.width=Math.max(1,w*dpr);cv.height=Math.max(1,h*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);return[w,h]}
  function fresh(){C=colors(stage);const[w,h]=size();S={w,h,p:0,t:0,d:-1,t0:performance.now(),doneAt:null};def.init&&def.init(S,w,h,C);return S}
  function loop(now){S.t=(now-S.t0)/1000;S.d=S.doneAt?(now-S.doneAt)/1000:-1;ctx.clearRect(0,0,S.w,S.h);def.draw(ctx,S.w,S.h,S,C);if(S.d<0||S.d<(def.tail||3.4))raf=requestAnimationFrame(loop)}
  return{reset(){cancelAnimationFrame(raf);fresh();S.idle=true;def.draw(ctx,S.w,S.h,S,C);S.idle=false},
    start(){cancelAnimationFrame(raf);fresh();if(reduce){def.draw(ctx,S.w,S.h,S,C);return}raf=requestAnimationFrame(loop)},
    progress(p){if(S)S.p=p},
    done(){if(!S)return;S.p=1;S.doneAt=performance.now();if(reduce){S.d=6;S.t=6;ctx.clearRect(0,0,S.w,S.h);def.draw(ctx,S.w,S.h,S,C)}}}}

/* ================= ANIMATIONS ================= */
const ANIMS=[];

/* 1 · Mech unfold (SVG) */
ANIMS.push({id:'mech',name:'Mech unfold',tag:'Robot',sound:'mech',desc:'Metal plates drift while it works, then slam together into a badge with a green check.',
  setup(stage){stage.classList.add('mech');stage.insertAdjacentHTML('afterbegin',`<svg viewBox="-100 -100 200 200" aria-hidden="true"><defs><linearGradient id="metal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3d79a"/><stop offset=".45" stop-color="#c4913a"/><stop offset=".55" stop-color="#9a6d24"/><stop offset="1" stop-color="#e3b965"/></linearGradient><linearGradient id="steelg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfd3dc"/><stop offset="1" stop-color="#6c717d"/></linearGradient></defs><circle class="ring" r="92"/><g class="spin"></g><circle class="core" r="27"/><path class="chk" d="M-13 1 L-4 10 L14 -9"/></svg>`);
    const P=stage.querySelector('.spin'),R=80,ri=33,pt=(r,a)=>(r*Math.cos(a)).toFixed(1)+','+(r*Math.sin(a)).toFixed(1);
    for(let k=0;k<6;k++){const a1=(-90+60*k)*Math.PI/180,a2=(-90+60*(k+1))*Math.PI/180,am=(a1+a2)/2,g=.035;const el=document.createElementNS('http://www.w3.org/2000/svg','polygon');
      el.setAttribute('points',[pt(R,a1+g),pt(R,a2-g),pt(ri,a2-g*2.2),pt(ri,a1+g*2.2)].join(' '));el.setAttribute('class','plate');el.setAttribute('fill',k%2?'url(#steelg)':'url(#metal)');el.setAttribute('stroke','#2a2420');el.setAttribute('stroke-width','1.5');
      el.style.setProperty('--dx',(Math.cos(am)*58).toFixed(1)+'px');el.style.setProperty('--dy',(Math.sin(am)*58).toFixed(1)+'px');el.style.setProperty('--r',(k%2?-1:1)*(70+k*12)+'deg');el.style.setProperty('--dl',(k*.06).toFixed(2)+'s');P.appendChild(el)}
    return{reset(){},start(){},progress(){},done(){}}}});

/* 2 · Gold rain */
const GLYPH='LFMP0123456789ABCDEF§$#%+=<>KPI';
ANIMS.push({id:'rain',name:'Gold rain',tag:'Code',sound:'resolve',desc:'Gold code falls while it works, then freezes and decodes into the client name.',
  setup(stage){const nm=document.createElement('div');nm.className='rname';nm.setAttribute('aria-live','polite');stage.appendChild(nm);
    const c=canvasCtrl(stage,{init(S,w){S.cols=Array.from({length:Math.ceil(w/14)},()=>Math.random()*-200)},
      draw(ctx,w,h,S,C){if(!S.trail){S.trail=document.createElement('canvas')}const T=S.trail;if(T.width!==ctx.canvas.width){T.width=ctx.canvas.width;T.height=ctx.canvas.height}const tc=T.getContext('2d');tc.setTransform(ctx.getTransform());
        tc.globalAlpha=S.d<0?.16:.08;tc.fillStyle=C.bg2;tc.fillRect(0,0,w,h);tc.globalAlpha=1;tc.font='600 13px "JetBrains Mono",monospace';
        if(S.d<0&&!S.idle){S.cols.forEach((y,i)=>{tc.fillStyle=C.gold2;tc.fillText(GLYPH[Math.random()*GLYPH.length|0],i*14,y);tc.fillStyle=C.gold;tc.globalAlpha=.5;tc.fillText(GLYPH[Math.random()*GLYPH.length|0],i*14,y-14);tc.globalAlpha=1;S.cols[i]=y>h+Math.random()*300?Math.random()*-40:y+13})}
        ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.drawImage(T,0,0);ctx.restore()}});
    let tok=0;
    return{reset(){tok++;nm.textContent='';c.reset()},start(){tok++;nm.textContent='';c.start()},progress:c.progress,
      async done(L){c.done();const my=++tok;nm.textContent='';const tx=document.createTextNode('');nm.append(tx);const sm=document.createElement('small');sm.textContent='READY';nm.append(sm);
        const txt=L.name,t0=performance.now(),dur=reduce?1:900,set='LFMP#$%0123456789';(function step(now){if(my!==tok)return;const p=Math.min(1,(now-t0)/dur),n=Math.floor(p*txt.length);tx.nodeValue=txt.slice(0,n)+Array.from(txt.slice(n)).map(ch=>ch===' '?' ':set[Math.random()*set.length|0]).join('');if(p<1)requestAnimationFrame(step)})(t0)}}}});

/* 3 · HUD scan (DOM) */
ANIMS.push({id:'hud',name:'HUD scan',tag:'Sci-fi',sound:'radar',desc:'A scan line sweeps and readouts tick up, then the brackets lock and SYSTEM READY stamps in.',
  setup(stage){stage.insertAdjacentHTML('afterbegin',`<div class="hudw"><i class="br a"></i><i class="br b"></i><i class="br c"></i><i class="br d"></i><div class="scan"></div><svg class="gauge" viewBox="0 0 150 150" aria-hidden="true"><circle class="bg" cx="75" cy="75" r="65"/><circle class="fg" cx="75" cy="75" r="65"/><text x="75" y="77">0%</text></svg><div class="read l">SYNC <span data-r="sync">000</span><br>STEP <span data-r="step">0/9</span><br>LINK <span data-r="link">----</span></div><div class="read r">GHL <span data-r="ghl">WAIT</span><br>TEST <span data-r="test">--</span><br>MS <span data-r="ms">000</span></div><div class="stamp">SYSTEM READY</div></div>`);
    const g=stage.querySelector('.gauge'),r=k=>stage.querySelector(`[data-r="${k}"]`);
    function set(p){g.querySelector('.fg').style.strokeDashoffset=(408*(1-p)).toFixed(1);g.querySelector('text').textContent=Math.round(p*100)+'%';r('sync').textContent=String(Math.round(p*100)).padStart(3,'0');r('step').textContent=Math.round(p*9)+'/9';r('link').textContent=p>.5?'OK':'....'.slice(0,1+(performance.now()/200|0)%4);r('ghl').textContent=p>.3?'READ':'WAIT';r('test').textContent=p>.8?'PASS':'--';r('ms').textContent=String(80+Math.random()*60|0).padStart(3,'0')}
    return{reset(){set(0);r('link').textContent='----';r('ms').textContent='000'},start(){set(0)},progress:set,done(){set(1)}}}});

/* 4 · Warp jump */
ANIMS.push({id:'warp',name:'Warp jump',tag:'Space',sound:'warp',desc:'Stars stretch faster and faster, then a flash drops you out of warp onto a green check.',
  setup(stage){return canvasCtrl(stage,{init(S,w,h){S.stars=Array.from({length:170},()=>({a:Math.random()*6.283,r:Math.random()*Math.max(w,h)*.6,s:.5+Math.random()}))},
    draw(ctx,w,h,S,C){const cx=w/2,cy=AREA(h)/2+6;let sp=S.d<0?.6+S.p*S.p*15:(S.d<.35?32:Math.max(.3,32*Math.exp(-(S.d-.35)*5)));if(S.idle)sp=0;
      ctx.strokeStyle=C.gold2;ctx.lineCap='round';for(const st of S.stars){const r0=st.r;st.r+=sp*st.s*(1+st.r/120);const len=Math.max(1.5,st.r-r0);const x1=cx+Math.cos(st.a)*(st.r-len*2.5),y1=cy+Math.sin(st.a)*(st.r-len*2.5),x2=cx+Math.cos(st.a)*st.r,y2=cy+Math.sin(st.a)*st.r;
        ctx.globalAlpha=Math.min(1,st.r/120);ctx.lineWidth=Math.min(3,.7+st.r/150);ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();if(st.r>Math.max(w,h)){st.r=Math.random()*20;st.a=Math.random()*6.283}}
      ctx.globalAlpha=1;if(S.d>=0){if(S.d<.6){ctx.fillStyle=C.gold2;ctx.globalAlpha=S.d<.3?S.d/.3*.9:Math.max(0,.9-(S.d-.3)*3);ctx.fillRect(0,0,w,h);ctx.globalAlpha=1}check(ctx,cx,cy,38,(S.d-.4)/.6,C.ok)}}})}});

/* 5 · Circuit trace */
ANIMS.push({id:'circuit',name:'Circuit trace',tag:'Tech',sound:'powerup',desc:'Gold circuit lines race in from the edges to a chip; it lights up and pulses run along the traces.',
  setup(stage){return canvasCtrl(stage,{init(S,w,h){const g=14,cx=w/2,cy=AREA(h)/2+4,hu=AREA(h);S.paths=[];
      for(let i=0;i<12;i++){const side=i%4;let x,y;if(side===0){x=Math.round(Math.random()*w/g)*g;y=0}else if(side===1){x=w;y=Math.round(Math.random()*hu/g)*g}else if(side===2){x=Math.round(Math.random()*w/g)*g;y=hu}else{x=0;y=Math.round(Math.random()*hu/g)*g}
        const pts=[[x,y]];let guard=0,horiz=Math.random()<.5;while((Math.abs(x-cx)>34||Math.abs(y-cy)>34)&&guard++<40){const steps=g*(1+(Math.random()*3|0));if(horiz&&Math.abs(x-cx)>34)x+=Math.sign(cx-x)*Math.min(steps,Math.abs(x-cx)-30);else if(Math.abs(y-cy)>34)y+=Math.sign(cy-y)*Math.min(steps,Math.abs(y-cy)-30);else x+=Math.sign(cx-x)*Math.min(steps,Math.abs(x-cx)-30);pts.push([x,y]);horiz=!horiz}
        const seg=[];let tot=0;for(let k=1;k<pts.length;k++){const l=Math.hypot(pts[k][0]-pts[k-1][0],pts[k][1]-pts[k-1][1]);seg.push(l);tot+=l}S.paths.push({pts,seg,tot})}},
    draw(ctx,w,h,S,C){const cx=w/2,cy=AREA(h)/2+4;const at=(P,L)=>{let k=0;while(k<P.seg.length&&L>P.seg[k]){L-=P.seg[k];k++}if(k>=P.seg.length)return P.pts[P.pts.length-1];const a=P.pts[k],b=P.pts[k+1],f=P.seg[k]?L/P.seg[k]:0;return[a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f]};
      ctx.lineWidth=2;ctx.lineCap='round';ctx.lineJoin='round';S.paths.forEach((P,i)=>{ctx.strokeStyle=C.line;ctx.beginPath();P.pts.forEach((q,k)=>k?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]));ctx.stroke();
        const fr=S.idle?0:clamp(S.p*1.25-i*.025);if(fr>0){const L=P.tot*fr;ctx.strokeStyle=S.d>=0?C.ok:C.gold;ctx.beginPath();let acc=0;ctx.moveTo(P.pts[0][0],P.pts[0][1]);for(let k=1;k<P.pts.length;k++){if(acc+P.seg[k-1]<=L){ctx.lineTo(P.pts[k][0],P.pts[k][1]);acc+=P.seg[k-1]}else{const e=at(P,L);ctx.lineTo(e[0],e[1]);break}}ctx.stroke();
          if(S.d<0){const e=at(P,L);ctx.fillStyle=C.gold2;ctx.beginPath();ctx.arc(e[0],e[1],3,0,7);ctx.fill()}}
        if(S.d>=0){const e=at(P,P.tot*((S.d*.9+i*.13)%1));ctx.fillStyle=C.ok;ctx.beginPath();ctx.arc(e[0],e[1],3,0,7);ctx.fill()}});
      ctx.save();if(S.d>=0){ctx.shadowColor=C.ok;ctx.shadowBlur=18*clamp(S.d*3)}ctx.fillStyle=C.panel;ctx.strokeStyle=S.d>=0?C.ok:C.gold;ctx.lineWidth=2.5;ctx.beginPath();ctx.roundRect?ctx.roundRect(cx-30,cy-30,60,60,8):ctx.rect(cx-30,cy-30,60,60);ctx.fill();ctx.stroke();ctx.restore();
      ctx.strokeStyle=C.steel;ctx.lineWidth=2;for(let k=-2;k<=2;k++){const o=k*10;[[cx+o,cy-30,cx+o,cy-36],[cx+o,cy+30,cx+o,cy+36],[cx-30,cy+o,cx-36,cy+o],[cx+30,cy+o,cx+36,cy+o]].forEach(l=>{ctx.beginPath();ctx.moveTo(l[0],l[1]);ctx.lineTo(l[2],l[3]);ctx.stroke()})}
      if(S.d>=0&&S.d>.15)check(ctx,cx,cy,17,(S.d-.15)/.5,C.ok);else{ctx.fillStyle=C.gold;ctx.font='700 12px "JetBrains Mono",monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('LFMP',cx,cy)}}})}});

/* 6 · Sonar sweep */
ANIMS.push({id:'sonar',name:'Sonar sweep',tag:'Radar',sound:'sonar',desc:'A radar arm sweeps and finds each step as a blip; when done every blip goes green and rings pulse out.',
  setup(stage){return canvasCtrl(stage,{init(S){S.b=Array.from({length:9},(_,i)=>({a:Math.random()*6.283,r:.25+Math.random()*.7,th:.05+i*.1}))},
    draw(ctx,w,h,S,C){const cx=w/2,cy=AREA(h)/2+6,R=Math.min(w*.4,AREA(h)*.46);ctx.strokeStyle=C.line;ctx.lineWidth=1.5;[1,.66,.33].forEach(k=>{ctx.beginPath();ctx.arc(cx,cy,R*k,0,7);ctx.stroke()});ctx.beginPath();ctx.moveTo(cx-R,cy);ctx.lineTo(cx+R,cy);ctx.moveTo(cx,cy-R);ctx.lineTo(cx,cy+R);ctx.stroke();
      if(S.d<.5&&!S.idle){const A=S.t*2.6;for(let k=0;k<22;k++){ctx.strokeStyle=C.hud;ctx.globalAlpha=(1-k/22)*.55;ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(A-k*.04)*R,cy+Math.sin(A-k*.04)*R);ctx.stroke()}ctx.globalAlpha=1}
      S.b.forEach(b=>{if(S.p>=b.th||S.d>=0){const x=cx+Math.cos(b.a)*b.r*R,y=cy+Math.sin(b.a)*b.r*R,col=S.d>=0?C.ok:C.hud;ctx.fillStyle=col;ctx.beginPath();ctx.arc(x,y,4,0,7);ctx.fill();ctx.strokeStyle=col;ctx.globalAlpha=.5;ctx.beginPath();ctx.arc(x,y,7+3*Math.sin(S.t*6),0,7);ctx.stroke();ctx.globalAlpha=1}});
      if(S.d>=0){for(let j=0;j<3;j++){const rr=(S.d-j*.18)*R*1.6;if(rr>0&&rr<R*1.5){ctx.strokeStyle=C.ok;ctx.lineWidth=3;ctx.globalAlpha=1-rr/(R*1.5);ctx.beginPath();ctx.arc(cx,cy,rr,0,7);ctx.stroke();ctx.globalAlpha=1}}ctx.fillStyle=C.bg2;ctx.beginPath();ctx.arc(cx,cy,30,0,7);ctx.fill();check(ctx,cx,cy,24,(S.d-.35)/.6,C.ok)}}})}});

/* 7 · Glitch reveal */
ANIMS.push({id:'glitch',name:'Glitch reveal',tag:'Digital',sound:'glitch',desc:'BUILDING flickers with colour-split glitches, then snaps clean into the client name.',
  setup(stage){let L=LINES[tool];const c=canvasCtrl(stage,{draw(ctx,w,h,S,C){const cy=AREA(h)/2;const set='#$%&@!?01LFMP';let txt,sub;
      if(S.d<0){txt='BUILDING'+'.'.repeat(1+(S.t*3|0)%3);sub=Math.round(S.p*100)+'% · DO NOT UNPLUG'}else{const nm=L.name.toUpperCase();const k=clamp(S.d/.5);txt=nm.split('').map((ch,i)=>ch===' '||i/nm.length<k?ch:set[Math.random()*set.length|0]).join('');sub=S.d>.5?'COMPLETE':''}
      const fs=Math.min(44,w/(txt.length*.56));ctx.font=`800 ${fs}px "Barlow Condensed","Arial Narrow",sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
      const inten=S.idle?0:S.d<0?(Math.random()<.22?.9:.12):Math.max(0,1-S.d*2);const off=inten*9;
      if(inten>0){ctx.globalAlpha=.75;ctx.fillStyle='#ff3b6b';ctx.fillText(txt,w/2-off,cy);ctx.fillStyle='#29d3ff';ctx.fillText(txt,w/2+off,cy);ctx.globalAlpha=1}
      ctx.fillStyle=S.d>.5?C.ok:C.fg;ctx.fillText(txt,w/2,cy);
      for(let k=0;k<Math.round(inten*6);k++){const y=cy-fs/2+Math.random()*fs,hb=3+Math.random()*10,o=(Math.random()-.5)*40*inten;ctx.save();ctx.beginPath();ctx.rect(0,y,w,hb);ctx.clip();ctx.fillStyle=C.bg2;ctx.fillRect(0,y,w,hb);ctx.fillStyle=C.fg;ctx.fillText(txt,w/2+o,cy);ctx.restore()}
      ctx.font='600 11px "JetBrains Mono",monospace';ctx.fillStyle=S.d>.5?C.ok:C.mut;ctx.fillText(sub,w/2,cy+fs/2+14)}});
    return{reset:c.reset,start(){L=LINES[tool];c.start()},progress:c.progress,done(){L=LINES[tool];c.done()}}}});

/* 8 · Vault door */
ANIMS.push({id:'vault',name:'Vault door',tag:'Heavy',sound:'vault',desc:'A vault dial spins while it works; at the end the bolts pull back and the door swings open on a check.',
  setup(stage){return canvasCtrl(stage,{draw(ctx,w,h,S,C){const cx=w/2,cy=AREA(h)/2+6,R=Math.min(w*.36,AREA(h)*.45);const o=S.d>=0?easeOut(clamp((S.d-.45)/.4)):0;
      if(S.d>=0)check(ctx,cx,cy,R*.55,(S.d-.55)/.5,C.ok);
      if(o<1){ctx.save();ctx.translate(cx-R*o*.9,cy);ctx.scale(1-o*.92,1);ctx.fillStyle=C.panel;ctx.strokeStyle=C.steel;ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,R,0,7);ctx.fill();ctx.stroke();
        const b=S.d>=0?clamp(S.d/.3)*14:0;ctx.fillStyle=C.steel;for(let k=0;k<12;k++){ctx.save();ctx.rotate(k*Math.PI/6);ctx.fillRect(R-12+b,-4,14,8);ctx.restore()}
        const ang=S.d>=0?S.p*4+S.d*14*Math.exp(-S.d*2):Math.sin(S.t*1.4)*2.4+S.p*5;ctx.rotate(ang);ctx.strokeStyle=C.gold;ctx.lineWidth=3;ctx.fillStyle=C.bg2;ctx.beginPath();ctx.arc(0,0,R*.5,0,7);ctx.fill();ctx.stroke();
        ctx.lineWidth=1.5;for(let k=0;k<24;k++){ctx.save();ctx.rotate(k*Math.PI/12);ctx.beginPath();ctx.moveTo(R*.5-2,0);ctx.lineTo(R*.5-(k%6?6:11),0);ctx.stroke();ctx.restore()}
        ctx.lineWidth=5;ctx.lineCap='round';for(let k=0;k<3;k++){ctx.save();ctx.rotate(k*2.094);ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(0,-R*.32);ctx.stroke();ctx.restore()}ctx.fillStyle=C.gold;ctx.beginPath();ctx.arc(0,0,7,0,7);ctx.fill();ctx.restore()}}})}});

/* 9 · Hologram cube */
ANIMS.push({id:'holo',name:'Hologram',tag:'3D',sound:'braam',desc:'A wireframe hologram spins and fills in; at the end it turns solid gold with a pulse.',
  setup(stage){const V=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]],F=[[0,1,2,3],[4,5,6,7],[0,1,5,4],[2,3,7,6],[1,2,6,5],[0,3,7,4]],E=[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
    return canvasCtrl(stage,{draw(ctx,w,h,S,C){const cx=w/2,cy=AREA(h)/2+4,s=Math.min(w,AREA(h))*.21;const tt=S.idle?.6:S.t,ay=tt*1.1,ax=tt*.7+.4;
      const P=V.map(([x,y,z])=>{let X=x*Math.cos(ay)+z*Math.sin(ay),Z=-x*Math.sin(ay)+z*Math.cos(ay),Y=y*Math.cos(ax)-Z*Math.sin(ax);Z=y*Math.sin(ax)+Z*Math.cos(ax);const f=3.4/(3.4+Z);return[cx+X*s*f,cy+Y*s*f,Z]});
      const done=S.d>=0;F.map(f=>({f,z:f.reduce((a,i)=>a+P[i][2],0)/4})).sort((a,b)=>b.z-a.z).forEach(({f,z})=>{ctx.beginPath();f.forEach((i,k)=>k?ctx.lineTo(P[i][0],P[i][1]):ctx.moveTo(P[i][0],P[i][1]));ctx.closePath();
        if(done){ctx.fillStyle=C.gold;ctx.globalAlpha=clamp(S.d*3)*(.55+.45*(1-(z+1.4)/2.8))}else{ctx.fillStyle=C.hud;ctx.globalAlpha=.05+.22*S.p}ctx.fill();ctx.globalAlpha=1});
      ctx.strokeStyle=done?C.gold2:C.hud;ctx.lineWidth=2;ctx.globalAlpha=done?1:(Math.random()<.06?.3:.9);E.forEach(([a,b])=>{ctx.beginPath();ctx.moveTo(P[a][0],P[a][1]);ctx.lineTo(P[b][0],P[b][1]);ctx.stroke()});ctx.globalAlpha=1;
      if(!done&&!S.idle){ctx.fillStyle=C.hud;ctx.globalAlpha=.07;for(let y=(S.t*40)%5;y<AREA(h);y+=5)ctx.fillRect(cx-s*1.6,y,s*3.2,1.5);ctx.globalAlpha=1}
      if(done){const rr=S.d*s*3;if(rr<s*3){ctx.strokeStyle=C.ok;ctx.lineWidth=3;ctx.globalAlpha=1-rr/(s*3);ctx.beginPath();ctx.arc(cx,cy,s*.8+rr,0,7);ctx.stroke();ctx.globalAlpha=1}
        ctx.fillStyle=C.ok;ctx.font='700 11px "JetBrains Mono",monospace';ctx.textAlign='center';ctx.globalAlpha=clamp((S.d-.4)*3);ctx.fillText('ASSEMBLED',cx,cy+s*1.55);ctx.globalAlpha=1}}})}});

/* 10 · Energy charge */
ANIMS.push({id:'energy',name:'Energy charge',tag:'Power',sound:'laser',desc:'Electric arcs charge a battery segment by segment; at 100% it flashes and throws sparks.',
  setup(stage){return canvasCtrl(stage,{draw(ctx,w,h,S,C){const cx=w/2,cy=AREA(h)/2+8,bw=Math.min(w*.62,280),bh=50,x0=cx-bw/2,y0=cy-bh/2;const done=S.d>=0;
      ctx.strokeStyle=C.fg;ctx.globalAlpha=.75;ctx.lineWidth=3;ctx.beginPath();ctx.roundRect?ctx.roundRect(x0,y0,bw,bh,8):ctx.rect(x0,y0,bw,bh);ctx.stroke();ctx.fillStyle=C.fg;ctx.fillRect(x0+bw+3,cy-10,7,20);ctx.globalAlpha=1;
      const n=10,gap=4,sw=(bw-10-gap*(n-1))/n,lit=S.idle?0:Math.floor(S.p*n+(done?1:0));for(let i=0;i<n;i++){ctx.fillStyle=i<lit?(done?C.ok:C.gold):C.line;ctx.fillRect(x0+5+i*(sw+gap),y0+5,sw,bh-10)}
      ctx.beginPath();ctx.fillStyle=C.steel;ctx.arc(x0-30,cy,7,0,7);ctx.fill();
      if(!done&&!S.idle){const ex=x0+5+Math.max(1,lit)*(sw+gap)-gap;ctx.strokeStyle=C.hud;ctx.lineWidth=1.6;ctx.shadowColor=C.hud;ctx.shadowBlur=8;for(let a=0;a<2;a++){ctx.beginPath();ctx.moveTo(x0-30,cy);const segs=7;for(let k=1;k<=segs;k++){const x=x0-30+(ex-x0+30)*k/segs,y=cy+(k<segs?(Math.random()-.5)*34:(Math.random()-.5)*bh*.6);ctx.lineTo(x,y)}ctx.stroke()}ctx.shadowBlur=0}
      ctx.font='700 12px "JetBrains Mono",monospace';ctx.textAlign='center';ctx.fillStyle=done?C.ok:C.mut;ctx.fillText(done?'100% · CHARGED':'CHARGING '+Math.round(S.p*100)+'%',cx,y0-14);
      if(done){if(!S.sp){S.sp=Array.from({length:46},()=>({x:x0+bw,y:cy,vx:(Math.random()*.9-.2)*7,vy:(Math.random()-.75)*7,l:1}))}if(S.d<.35){ctx.fillStyle=C.gold2;ctx.globalAlpha=Math.max(0,.8-S.d*2.3);ctx.fillRect(0,0,w,h);ctx.globalAlpha=1}
        ctx.strokeStyle=C.gold2;ctx.lineWidth=2;S.sp.forEach(p=>{if(p.l<=0)return;ctx.globalAlpha=p.l;ctx.beginPath();ctx.moveTo(p.x,p.y);p.x+=p.vx;p.y+=p.vy;p.vy+=.25;p.l-=.022;ctx.lineTo(p.x,p.y);ctx.stroke()});ctx.globalAlpha=1}}})}});

/* 11 · Pixel build */
const PIX=["..........#",".........##","........##.","#......##..","##....##...",".##..##....","..####.....","...##......"];
ANIMS.push({id:'pixel',name:'Pixel build',tag:'Retro',sound:'arcade',desc:'8-bit blocks drop in and stack into a check mark, then flash green with a CLEAR! pop.',
  setup(stage){const cells=[];PIX.forEach((row,r)=>[...row].forEach((ch,c)=>{if(ch==='#')cells.push([c,r])}));cells.sort((a,b)=>b[1]-a[1]||a[0]-b[0]);
    return canvasCtrl(stage,{draw(ctx,w,h,S,C){const cs=Math.min(16,(w*.52)/11),ox=w/2-11*cs/2,oy=AREA(h)/2-8*cs/2+10,n=cells.length,done=S.d>=0;
      ctx.fillStyle=C.line;for(let r=0;r<8;r++)for(let c=0;c<11;c++)ctx.fillRect(ox+c*cs+cs/2-1,oy+r*cs+cs/2-1,2,2);
      cells.forEach(([c,r],i)=>{const s=i/n*.88,f=S.idle?0:done?1:clamp((S.p-s)/.12);if(f<=0)return;const ty=oy+r*cs,y=oy-90+(ty-oy+90)*bounce(f),x=ox+c*cs;
        ctx.fillStyle=done?C.ok:C.gold;ctx.fillRect(x+1,y+1,cs-2,cs-2);ctx.fillStyle='rgba(255,255,255,.35)';ctx.fillRect(x+1,y+1,cs-2,3);ctx.fillStyle='rgba(0,0,0,.22)';ctx.fillRect(x+1,y+cs-4,cs-2,3)});
      if(done){if(S.d<.25){ctx.fillStyle=C.ok;ctx.globalAlpha=.35*(1-S.d*4);ctx.fillRect(0,0,w,h);ctx.globalAlpha=1}const k=clamp((S.d-.15)/.5),sc=k<1?bounce(k):1;
        ctx.save();ctx.translate(w/2,oy-14);ctx.scale(sc,sc);ctx.font='800 22px "JetBrains Mono",monospace';ctx.textAlign='center';ctx.fillStyle=C.ok;ctx.fillText('CLEAR!',0,0);ctx.restore()}}})}});

/* 12 · Rocket launch */
ANIMS.push({id:'launch',name:'Liftoff',tag:'Celebrate',sound:'victory',desc:'A rocket rumbles on the pad while it works, then blasts off and fireworks burst.',
  setup(stage){return canvasCtrl(stage,{init(S){S.ex=[];S.fw=[]},
    draw(ctx,w,h,S,C){const gy=AREA(h)-4,cx=w/2,done=S.d>=0;ctx.strokeStyle=C.line;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(cx-60,gy);ctx.lineTo(cx+60,gy);ctx.stroke();
      const shake=done||S.idle?0:(Math.random()-.5)*S.p*3,x=cx+shake,y=gy-26-(done?S.d*S.d*700:0);
      const fire=!S.idle&&(S.p>.1||done);if(fire&&y>-80){const k=done?8:1+Math.round(S.p*3);for(let i=0;i<k;i++)S.ex.push({x:x+(Math.random()-.5)*8,y:y+22,vx:(Math.random()-.5)*1.6,vy:1.5+Math.random()*2,l:1})}
      S.ex.forEach(p=>{p.x+=p.vx;p.y+=p.vy;if(p.y>gy){p.y=gy;p.vy=0;p.vx*=2.2}p.l-=.025});S.ex=S.ex.filter(p=>p.l>0);ctx.fillStyle=C.mut;S.ex.forEach(p=>{ctx.globalAlpha=p.l*.5;ctx.beginPath();ctx.arc(p.x,p.y,3+(1-p.l)*7,0,7);ctx.fill()});ctx.globalAlpha=1;
      if(y>-80){if(fire){const fl=12+S.p*16+(done?24:0)+Math.random()*6;ctx.fillStyle=C.gold2;ctx.beginPath();ctx.moveTo(x-8,y+20);ctx.lineTo(x,y+20+fl);ctx.lineTo(x+8,y+20);ctx.fill();ctx.fillStyle=C.gold;ctx.beginPath();ctx.moveTo(x-4,y+20);ctx.lineTo(x,y+20+fl*.6);ctx.lineTo(x+4,y+20);ctx.fill()}
        ctx.fillStyle=C.gold;ctx.beginPath();ctx.moveTo(x-14,y+4);ctx.lineTo(x-24,y+24);ctx.lineTo(x-14,y+20);ctx.fill();ctx.beginPath();ctx.moveTo(x+14,y+4);ctx.lineTo(x+24,y+24);ctx.lineTo(x+14,y+20);ctx.fill();
        const gr=ctx.createLinearGradient(x-14,0,x+14,0);gr.addColorStop(0,'#9aa0ab');gr.addColorStop(.5,'#f1efe9');gr.addColorStop(1,'#8a909b');ctx.fillStyle=gr;ctx.beginPath();ctx.moveTo(x,y-42);ctx.quadraticCurveTo(x+16,y-24,x+14,y-8);ctx.lineTo(x+14,y+20);ctx.lineTo(x-14,y+20);ctx.lineTo(x-14,y-8);ctx.quadraticCurveTo(x-16,y-24,x,y-42);ctx.fill();
        ctx.fillStyle=C.hud;ctx.strokeStyle=C.steel;ctx.lineWidth=2;ctx.beginPath();ctx.arc(x,y-14,5.5,0,7);ctx.fill();ctx.stroke()}
      if(done&&S.d>.5&&!S.fwDone){S.fwDone=1;const cols=[C.gold2,C.ok,C.hud,C.gold];for(let b=0;b<3;b++){const bx=w*(.25+b*.25),by=AREA(h)*(.3+Math.random()*.15),col=cols[b];for(let i=0;i<52;i++){const a=Math.random()*6.283,v=1+Math.random()*3;S.fw.push({x:bx,y:by,vx:Math.cos(a)*v,vy:Math.sin(a)*v,l:1,c:i%5?col:cols[3],dl:b*.18})}}}
      S.fw.forEach(p=>{if(p.dl>0){p.dl-=1/60;return}p.x+=p.vx;p.y+=p.vy;p.vy+=.045;p.vx*=.985;p.l-=.013;if(p.l>0){ctx.fillStyle=p.c;ctx.globalAlpha=p.l;ctx.fillRect(p.x-1.5,p.y-1.5,3,3)}});ctx.globalAlpha=1}})}});

/* ================= BUILDING & CODING ================= */
function rr(ctx,x,y,w,h,r){ctx.beginPath();if(ctx.roundRect){ctx.roundRect(x,y,w,h,r)}else{ctx.rect(x,y,w,h)}}
function rectPart(ctx,x,y,w,h,f){const pts=[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]];let L=2*(w+h)*clamp(f);ctx.beginPath();ctx.moveTo(x,y);for(let k=1;k<5&&L>0;k++){const a=pts[k-1],b=pts[k],seg=Math.hypot(b[0]-a[0],b[1]-a[1]),t=Math.min(1,L/seg);ctx.lineTo(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t);L-=seg}ctx.stroke()}
function winChrome(ctx,w,A,C,title){ctx.fillStyle=C.panel;rr(ctx,6,6,w-12,A-2,8);ctx.fill();ctx.fillStyle=C.line;ctx.fillRect(6,6,w-12,18);['#ff5f57','#febc2e','#28c840'].forEach((col,i)=>{ctx.fillStyle=col;ctx.beginPath();ctx.arc(18+i*12,15,3.5,0,7);ctx.fill()});ctx.fillStyle=C.mut;ctx.font='600 10px "JetBrains Mono",monospace';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(title,w/2,15);ctx.textBaseline='alphabetic';ctx.textAlign='left'}
const MONO=(px,wt=500)=>`${wt} ${px}px "JetBrains Mono",ui-monospace,monospace`;
function withTool(make){return stage=>{let L=LINES[tool];const c=canvasCtrl(stage,make(()=>L));return{reset(){L=LINES[tool];c.reset()},start(){L=LINES[tool];c.start()},progress:c.progress,done(){c.done()}}}}

/* ================= MOVIE-STYLE (original, genre-inspired) ================= */
/* Access granted (heist / hacker screen trope) */
ANIMS.push({id:'access',group:'fx',name:'Access granted',tag:'Movie style',sound:'access',desc:'Heist-movie style: code columns crack one digit at a time, then a big ACCESS GRANTED banner.',
  setup:withTool(get=>({init(S){S.code=Array.from({length:8},()=>'0123456789ABCDEF'[Math.random()*16|0])},draw(ctx,w,h,S,C){const L=get(),A=AREA(h),cy=A*.42,done=S.d>=0,n=8,bw=Math.min(30,(w-60)/n),gx=w/2-n*(bw+6)/2+3;
    ctx.strokeStyle=C.line;ctx.lineWidth=1;ctx.strokeRect(gx-12,cy-34,n*(bw+6)+18,68);ctx.font=MONO(9,600);ctx.fillStyle=C.mut;ctx.textAlign='left';ctx.fillText('DECRYPTING · '+L.name.toUpperCase(),gx-12,cy-42);
    for(let i=0;i<n;i++){const locked=done||(!S.idle&&S.p>(i+1)/(n+1));const x=gx+i*(bw+6);ctx.fillStyle=locked?(done?C.ok:C.gold):C.bg2;ctx.strokeStyle=locked?(done?C.ok:C.gold):C.line;ctx.lineWidth=1.5;rr(ctx,x,cy-20,bw,40,4);ctx.globalAlpha=locked?.18:1;ctx.fill();ctx.globalAlpha=1;ctx.stroke();
      ctx.fillStyle=locked?(done?C.ok:C.gold2):C.fg;ctx.font=MONO(20,700);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(locked?S.code[i]:S.idle?'•':'0123456789ABCDEF'[Math.random()*16|0],x+bw/2,cy+1)}ctx.textBaseline='alphabetic';
    const bar=S.idle?0:S.p;ctx.fillStyle=C.line;ctx.fillRect(gx-12,cy+44,n*(bw+6)+18,4);ctx.fillStyle=done?C.ok:C.gold;ctx.fillRect(gx-12,cy+44,(n*(bw+6)+18)*bar,4);
    if(done&&S.d>.2){const k=clamp((S.d-.2)/.25),sc=1+(1-k)*.6;ctx.save();ctx.translate(w/2,cy);ctx.scale(sc,sc);ctx.globalAlpha=k;ctx.fillStyle=C.bg2;ctx.strokeStyle=C.ok;ctx.lineWidth=3;rr(ctx,-118,-22,236,44,6);ctx.fill();ctx.stroke();ctx.fillStyle=C.ok;ctx.font='800 26px "Barlow Condensed",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('ACCESS GRANTED',0,2);ctx.restore();ctx.textBaseline='alphabetic';if(S.d<.5&&(S.d*12|0)%2){ctx.fillStyle=C.ok;ctx.globalAlpha=.08;ctx.fillRect(0,0,w,A);ctx.globalAlpha=1}}}}))});

/* Holo table (command-centre trope) */
ANIMS.push({id:'holotable',group:'fx',name:'Holo table',tag:'Movie style',sound:'braam',desc:'Command-centre style: a hologram grid rises off a table into a 3D bar city of the job, then locks green.',
  setup:withTool(get=>({init(S){S.hts=Array.from({length:25},()=>.2+Math.random()*.8)},draw(ctx,w,h,S,C){const A=AREA(h),cx=w/2,base=A-18,done=S.d>=0,a=Math.min(13,w/34),hx=a*.87*1.6,hy=a*.5*1.6,rot=S.idle?0:S.t*.25;
    ctx.fillStyle=C.line;ctx.beginPath();ctx.ellipse(cx,base,w*.38,16,0,0,7);ctx.fill();ctx.strokeStyle=done?C.ok:C.hud;ctx.lineWidth=1.5;ctx.globalAlpha=.6;ctx.beginPath();ctx.ellipse(cx,base,w*.36,14,0,0,7);ctx.stroke();ctx.globalAlpha=1;
    const grow=S.idle?.05:done?1:S.p,cells=[];for(let i=0;i<5;i++)for(let j=0;j<5;j++){const u=i-2,v=j-2,ru=u*Math.cos(rot)-v*Math.sin(rot),rv=u*Math.sin(rot)+v*Math.cos(rot);cells.push({X:cx+(ru-rv)*hx*.75,Y:base-46+(ru+rv)*hy*.75,z:ru+rv,h:S.hts[i*5+j]*60*clamp(grow*1.4-(i+j)*.05)})}
    cells.sort((p,q)=>p.z-q.z).forEach(c=>{const col=done?C.ok:C.hud,bw=a*.55;ctx.fillStyle=col;ctx.globalAlpha=.16+(done?.25:0);ctx.fillRect(c.X-bw,c.Y-c.h,bw*2,c.h);ctx.globalAlpha=.9;ctx.strokeStyle=col;ctx.lineWidth=1.2;ctx.strokeRect(c.X-bw,c.Y-c.h,bw*2,c.h);ctx.globalAlpha=1});
    ctx.fillStyle=done?C.ok:C.hud;ctx.globalAlpha=.06;for(let y=(S.t*30)%4;y<base;y+=4)ctx.fillRect(cx-w*.36,y,w*.72,1.2);ctx.globalAlpha=.12;ctx.beginPath();ctx.moveTo(cx-w*.36,base);ctx.lineTo(cx-w*.3,base-120);ctx.lineTo(cx+w*.3,base-120);ctx.lineTo(cx+w*.36,base);ctx.fill();ctx.globalAlpha=1;
    if(done){ctx.fillStyle=C.ok;ctx.font=MONO(10,700);ctx.textAlign='center';ctx.globalAlpha=clamp((S.d-.3)*3);ctx.fillText('MODEL LOCKED · '+get().name.toUpperCase(),cx,14);ctx.globalAlpha=1}}}))});

/* ================= SUPERHERO HUD & COMMAND CENTRE (original, film-style) ================= */
const HC={cy:'#4fd8ff',go:'#ffb547',gr:'#3ef0a0',wh:'#e8fbff'};
const glow=(ctx,col,b)=>{ctx.shadowColor=col;ctx.shadowBlur=b},noGlow=ctx=>{ctx.shadowBlur=0};
function arc(ctx,cx,cy,r,a0,a1){ctx.beginPath();ctx.arc(cx,cy,Math.max(.1,r),a0,a1);ctx.stroke()}
function brackets(ctx,x,y,w,h,s,col){ctx.strokeStyle=col;ctx.beginPath();ctx.moveTo(x,y+s);ctx.lineTo(x,y);ctx.lineTo(x+s,y);ctx.moveTo(x+w-s,y);ctx.lineTo(x+w,y);ctx.lineTo(x+w,y+s);ctx.moveTo(x+w,y+h-s);ctx.lineTo(x+w,y+h);ctx.lineTo(x+w-s,y+h);ctx.moveTo(x+s,y+h);ctx.lineTo(x,y+h);ctx.lineTo(x,y+h-s);ctx.stroke()}
function dotsBg(ctx,w,A){ctx.fillStyle=HC.cy;ctx.globalAlpha=.07;for(let y=8;y<A;y+=16)for(let x=8+((y/16)%2)*8;x<w;x+=16)ctx.fillRect(x,y,1.5,1.5);ctx.globalAlpha=1}
function sphere(nl,nm){const P=[];for(let i=1;i<nl;i++){const lat=-Math.PI/2+Math.PI*i/nl,cnt=Math.max(4,Math.round(nm*Math.cos(lat)));for(let j=0;j<cnt;j++)P.push([lat,2*Math.PI*j/cnt])}return P}
function proj(lat,lon,rot,tilt,R,cx,cy){const x=Math.cos(lat)*Math.sin(lon+rot),y=Math.sin(lat),z=Math.cos(lat)*Math.cos(lon+rot),y2=y*Math.cos(tilt)-z*Math.sin(tilt),z2=y*Math.sin(tilt)+z*Math.cos(tilt);return[cx+x*R,cy-y2*R,z2]}
const SPH=sphere(14,30),SPH2=sphere(9,18);
const GEO={builder:[26.4,-80.1],kpi:[29.8,-95.4],review:[28.2,-82.5]};
const cine=make=>stage=>{stage.classList.add('cine');return withTool(make)(stage)};

/* Suit HUD · Lock-on */
ANIMS.push({id:'lockon',group:'cine',name:'Suit HUD · Lock-on',tag:'Superhero',sound:'suitlock',desc:'Layered rings spin in opposite directions, side panels fly in with live readouts, then the reticle snaps shut and ALL SYSTEMS ONLINE flashes up.',
  setup:cine(get=>({draw(ctx,w,h,S){const L=get(),A=AREA(h),cx=w/2,cy=A/2+4,R=Math.min(w*.29,A*.43),done=S.d>=0,t=S.idle?.4:S.t,p=S.idle?0:S.p,col=done?HC.gr:HC.cy;
    dotsBg(ctx,w,A);ctx.lineCap='round';
    ctx.save();ctx.translate(cx,cy);ctx.rotate(t*.25);ctx.strokeStyle=col;ctx.globalAlpha=.55;ctx.lineWidth=1;for(let k=0;k<72;k++){const a=k/72*Math.PI*2,l=k%6?3:7;ctx.beginPath();ctx.moveTo(Math.cos(a)*R,Math.sin(a)*R);ctx.lineTo(Math.cos(a)*(R-l),Math.sin(a)*(R-l));ctx.stroke()}ctx.restore();
    ctx.save();ctx.translate(cx,cy);ctx.rotate(-t*.15);ctx.fillStyle=col;ctx.globalAlpha=.45;ctx.font=MONO(7,600);ctx.textAlign='center';const mt=('LFMP · '+L.name.toUpperCase()+' · SYS 0'+(1+(t|0)%9)+' · ').repeat(4).slice(0,84);for(let k=0;k<mt.length;k++){ctx.save();ctx.rotate(k/mt.length*Math.PI*2);ctx.fillText(mt[k],0,-R-6);ctx.restore()}ctx.restore();ctx.globalAlpha=1;
    ctx.lineWidth=4;glow(ctx,col,9);ctx.strokeStyle=col;for(let k=0;k<3;k++){const a=-t*.7+k*2.094;arc(ctx,cx,cy,R*.83,a,a+1.1)}noGlow(ctx);
    ctx.setLineDash([2,6]);ctx.lineWidth=2;ctx.strokeStyle=done?HC.gr:HC.go;ctx.save();ctx.translate(cx,cy);ctx.rotate(t*1.1);arc(ctx,0,0,R*.66,0,7);ctx.restore();ctx.setLineDash([]);
    ctx.lineWidth=6;ctx.strokeStyle='rgba(79,216,255,.14)';arc(ctx,cx,cy,R*.48,0,7);glow(ctx,col,14);ctx.strokeStyle=col;arc(ctx,cx,cy,R*.48,-Math.PI/2,-Math.PI/2+Math.PI*2*(done?1:p));noGlow(ctx);
    ctx.strokeStyle=col;ctx.globalAlpha=.6;ctx.lineWidth=1;[[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy])=>{ctx.beginPath();ctx.moveTo(cx+dx*R*.22,cy+dy*R*.22);ctx.lineTo(cx+dx*R*.36,cy+dy*R*.36);ctx.stroke()});ctx.globalAlpha=1;
    ctx.textAlign='center';ctx.textBaseline='middle';glow(ctx,col,10);ctx.fillStyle=done?HC.gr:HC.wh;if(done){noGlow(ctx);check(ctx,cx,cy,R*.2,S.d/.35,HC.gr)}else{ctx.font=MONO(Math.round(R*.19),700);ctx.fillText(Math.round(p*100)+'%',cx,cy+1)}noGlow(ctx);ctx.textBaseline='alphabetic';
    const sn=done?easeOut(clamp(S.d/.22)):0,r0=R*.98-(R*.98-R*.3)*sn,bx=cx-r0+(done?0:Math.sin(t*2)*6),by=cy-r0+(done?0:Math.cos(t*1.7)*4);ctx.lineWidth=2;glow(ctx,done?HC.gr:HC.go,8);brackets(ctx,bx,by,r0*2,r0*2,12,done?HC.gr:HC.go);noGlow(ctx);
    const sl=S.idle?1:easeOut(clamp(t/.5)),pw=Math.min(78,w*.2),lx=8-(1-sl)*90,rx=w-8-pw+(1-sl)*90;ctx.lineWidth=1;ctx.globalAlpha=.9;brackets(ctx,lx,14,pw,A-30,6,col);brackets(ctx,rx,14,pw,A-30,6,col);
    ctx.font=MONO(7,700);ctx.textAlign='left';ctx.fillStyle=col;ctx.fillText('SYS LOAD',lx+6,26);ctx.fillText('TELEMETRY',rx+6,26);
    L.mods.forEach((m,i)=>{const y=42+i*19,v=done?1:clamp(p*1.3-i*.12)*(.75+.25*Math.sin(t*3+i));ctx.fillStyle='rgba(79,216,255,.18)';ctx.fillRect(lx+6,y,pw-12,4);ctx.fillStyle=done?HC.gr:HC.cy;ctx.fillRect(lx+6,y,(pw-12)*v,4);ctx.fillStyle=HC.wh;ctx.globalAlpha=.65;ctx.fillText(m.toUpperCase().slice(0,10),lx+6,y-3);ctx.globalAlpha=.9});
    ['ALT','VEL','PWR','LNK','SYN','OPS'].forEach((k,i)=>{const y=42+i*13;ctx.textAlign='left';ctx.fillStyle=HC.wh;ctx.globalAlpha=.55;ctx.fillText(k,rx+6,y);ctx.globalAlpha=.9;ctx.fillStyle=done?HC.gr:i%2?HC.go:HC.cy;ctx.textAlign='right';ctx.fillText(done?'OK':String(Math.round((Math.sin(t*2.3+i*1.7)*.5+.5)*999)).padStart(3,'0'),rx+pw-6,y)});ctx.globalAlpha=1;
    if(done){if(S.d<.8){ctx.strokeStyle=HC.gr;ctx.lineWidth=3;ctx.globalAlpha=1-S.d/.8;arc(ctx,cx,cy,R*.5+S.d*R*1.4,0,7);ctx.globalAlpha=1}
      ctx.font=MONO(8.5,700);ctx.textAlign='center';ctx.fillStyle=HC.gr;ctx.globalAlpha=clamp((S.d-.3)*3);ctx.fillText('BUILD COMPLETE · '+L.name.toUpperCase(),cx,A-6);ctx.globalAlpha=1;
      if(S.d>.3){const k=clamp((S.d-.3)/.3),sc=1+(1-k)*.35,bw=Math.min(w-40,262);ctx.save();ctx.translate(cx,cy);ctx.scale(sc,sc);ctx.globalAlpha=k;ctx.fillStyle='rgba(5,8,12,.9)';ctx.strokeStyle=HC.gr;ctx.lineWidth=1.5;rr(ctx,-bw/2,-17,bw,34,4);ctx.fill();ctx.stroke();glow(ctx,HC.gr,12);ctx.fillStyle=HC.gr;ctx.font='800 22px "Barlow Condensed",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('ALL SYSTEMS ONLINE',0,1);noGlow(ctx);ctx.restore();ctx.textBaseline='alphabetic'}}}}))});

/* Suit HUD · Power core */
ANIMS.push({id:'core',group:'cine',name:'Suit HUD · Power core',tag:'Superhero',sound:'corecharge',desc:'Energy spirals into a glowing core as a segmented ring charges up; at 100% the core flares and blasts a shockwave.',
  setup:cine(get=>({init(S){S.pt=[]},draw(ctx,w,h,S){const A=AREA(h),cx=w/2,cy=A/2+4,R=Math.min(w*.3,A*.47),done=S.d>=0,t=S.idle?.4:S.t,p=S.idle?0:S.p,col=done?HC.gr:HC.cy;
    dotsBg(ctx,w,A);
    if(!S.idle&&!done){const k=1+Math.round(p*4);for(let i=0;i<k;i++)S.pt.push({a:Math.random()*6.283,r:R*1.3,v:.03+Math.random()*.03,c:Math.random()<.3?HC.go:HC.cy})}
    if(done&&!S.burst){S.burst=1;for(let i=0;i<90;i++)S.pt.push({a:Math.random()*6.283,r:R*.3,v:.05+Math.random()*.09,c:i%4?HC.gr:HC.wh,out:1})}
    ctx.globalCompositeOperation='lighter';S.pt.forEach(q=>{if(q.out)q.r+=R*q.v;else{q.r-=R*.012+q.v*14;q.a+=q.v*2}const x=cx+Math.cos(q.a)*q.r,y=cy+Math.sin(q.a)*q.r;ctx.fillStyle=q.c;ctx.globalAlpha=q.out?clamp(1-q.r/(R*1.7)):clamp((R*1.3-q.r)/(R*.35));ctx.fillRect(x-1.1,y-1.1,2.2,2.2)});ctx.globalAlpha=1;S.pt=S.pt.filter(q=>q.out?q.r<R*1.7:q.r>R*.28);
    const pulse=.85+.15*Math.sin(t*8),cr=R*.26*(done?1+.35*Math.exp(-S.d*3):1),br=done?1:.25+.75*p,g=ctx.createRadialGradient(cx,cy,0,cx,cy,cr*1.9);g.addColorStop(0,done?'#effff8':'#eefaff');g.addColorStop(.35,(done?'rgba(62,240,160,':'rgba(79,216,255,')+(.9*br*pulse).toFixed(2)+')');g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(cx,cy,cr*1.9,0,7);ctx.fill();ctx.globalCompositeOperation='source-over';
    const n=24,lit=done?n:Math.floor(p*n);for(let k=0;k<n;k++){const a0=-Math.PI/2+k/n*Math.PI*2+.03,a1=a0+Math.PI*2/n-.06;ctx.strokeStyle=k<lit?col:'rgba(79,216,255,.13)';ctx.lineWidth=R*.1;ctx.lineCap='butt';if(k<lit)glow(ctx,col,8);arc(ctx,cx,cy,R*.56,a0,a1);noGlow(ctx)}ctx.lineCap='round';
    ctx.lineWidth=1.5;ctx.strokeStyle=col;ctx.globalAlpha=.7;for(let k=0;k<3;k++){const a=t*.5+k*2.094;arc(ctx,cx,cy,R*.78,a,a+1.7)}ctx.globalAlpha=1;
    ctx.fillStyle=done?HC.gr:HC.go;for(let k=0;k<3;k++){const a=-t*.8+k*2.094;ctx.save();ctx.translate(cx+Math.cos(a)*R*.9,cy+Math.sin(a)*R*.9);ctx.rotate(a+Math.PI/2);ctx.beginPath();ctx.moveTo(0,-5);ctx.lineTo(4,3);ctx.lineTo(-4,3);ctx.closePath();ctx.fill();ctx.restore()}
    ctx.font=MONO(9,700);ctx.textAlign='left';ctx.fillStyle=done?HC.gr:HC.wh;ctx.fillText(done?'CORE ONLINE':'CORE '+Math.round(p*100)+'%',12,18);ctx.textAlign='right';ctx.fillStyle=HC.go;ctx.fillText('FLUX '+(done?'STABLE':(p*3.2).toFixed(2)+' TW'),w-12,18);
    if(done){for(let j=0;j<2;j++){const d=S.d-j*.15;if(d>0&&d<.9){ctx.strokeStyle=HC.gr;ctx.lineWidth=3-j;ctx.globalAlpha=1-d/.9;arc(ctx,cx,cy,R*.3+d*R*1.6,0,7);ctx.globalAlpha=1}}if(S.d<.25){ctx.fillStyle=HC.gr;ctx.globalAlpha=.25*(1-S.d/.25);ctx.fillRect(0,0,w,A);ctx.globalAlpha=1}}}}))});

/* Suit HUD · Systems check */
ANIMS.push({id:'syscheck',group:'cine',name:'Suit HUD · Systems check',tag:'Superhero',sound:'opsdone',desc:'Each part of the job runs a diagnostic gauge while a scan sweeps a 3D globe; then ALL SYSTEMS ONLINE.',
  setup:cine(get=>({draw(ctx,w,h,S){const L=get(),A=AREA(h),done=S.d>=0,t=S.idle?.4:S.t,p=S.idle?0:S.p;dotsBg(ctx,w,A);
    const rows=[...L.mods,'Tests'],lx=14,top=16,rh=Math.min(28,(A-26)/rows.length),endX=Math.max(lx+150,w*.54);
    rows.forEach((m,i)=>{const y=top+i*rh,s=i/rows.length*.9,f=S.idle?0:done?1:clamp((p-s)/(.9/rows.length)),ok=f>=1,gc=ok?HC.gr:HC.cy;
      ctx.lineWidth=2.5;ctx.strokeStyle='rgba(79,216,255,.18)';arc(ctx,lx+9,y+9,8,0,7);if(f>0){glow(ctx,gc,6);ctx.strokeStyle=gc;arc(ctx,lx+9,y+9,8,-Math.PI/2,-Math.PI/2+f*Math.PI*2);noGlow(ctx)}
      ctx.font=MONO(9,700);ctx.textAlign='left';ctx.fillStyle=HC.wh;ctx.globalAlpha=f>0?.95:.4;ctx.fillText(m.toUpperCase(),lx+24,y+12);ctx.globalAlpha=1;
      ctx.textAlign='right';ctx.fillStyle=ok?HC.gr:f>0?HC.go:'rgba(232,251,255,.35)';ctx.fillText(ok?'ONLINE':f>0?'CHECK '+Math.round(f*100)+'%':'STANDBY',endX,y+12);
      ctx.fillStyle='rgba(79,216,255,.12)';ctx.fillRect(lx+24,y+16,endX-lx-24,1)});
    const R=Math.min(w*.2,A*.4),cx=w-R-18,cy=A/2+2,rot=t*.6,scanY=cy-R+((t*.7)%1)*2*R;
    SPH.forEach(([la,lo])=>{const[x,y,z]=proj(la,lo,rot,.4,R,cx,cy);if(z<-.1)return;const near=!done&&!S.idle&&Math.abs(y-scanY)<5;ctx.fillStyle=done?HC.gr:near?HC.go:HC.cy;ctx.globalAlpha=Math.min(1,(z+.25)*(near?1.2:.75));const s=near?2.6:1.8;ctx.fillRect(x-s/2,y-s/2,s,s)});ctx.globalAlpha=1;
    ctx.strokeStyle=done?HC.gr:HC.cy;ctx.lineWidth=1;ctx.globalAlpha=.45;arc(ctx,cx,cy,R+6,0,7);ctx.setLineDash([3,5]);arc(ctx,cx,cy,R+12,t*.4,t*.4+4);ctx.setLineDash([]);ctx.globalAlpha=1;
    if(!done&&!S.idle){ctx.strokeStyle=HC.go;ctx.globalAlpha=.7;ctx.beginPath();ctx.moveTo(cx-R-12,scanY);ctx.lineTo(cx+R+12,scanY);ctx.stroke();ctx.globalAlpha=1}
    if(done&&S.d>.25){const k=clamp((S.d-.25)/.3),bw=Math.min(w-30,250);ctx.save();ctx.globalAlpha=k;ctx.fillStyle='rgba(5,8,12,.88)';ctx.strokeStyle=HC.gr;ctx.lineWidth=1.5;rr(ctx,w/2-bw/2,A/2-17,bw,34,4);ctx.fill();ctx.stroke();glow(ctx,HC.gr,10);ctx.fillStyle=HC.gr;ctx.font='800 21px "Barlow Condensed",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('ALL SYSTEMS ONLINE',w/2,A/2+1);noGlow(ctx);ctx.restore();ctx.textBaseline='alphabetic'}}}))});

/* Command wall · Ops grid */
ANIMS.push({id:'opsgrid',group:'cine',name:'Command wall · Ops grid',tag:'Command centre',sound:'opsdone',desc:'Nine live panels (map, radar, feeds, counters, logs) update at once; when done they flip to green one by one.',
  setup:cine(get=>({init(S){S.sd=Array.from({length:60},()=>Math.random())},draw(ctx,w,h,S){const L=get(),A=AREA(h),done=S.d>=0,t=S.idle?.4:S.t,p=S.idle?0:S.p,g=6,pw=(w-12-g*2)/3,ph=(A-6-g*2)/3,sd=S.sd;
    const NAMES=['MAP','FEED','RADAR','COUNT','STATUS','LOAD','LOG','GLOBE','SIGNAL'];
    for(let i=0;i<9;i++){const x=6+(i%3)*(pw+g),y=3+(i/3|0)*(ph+g),fl=done?clamp((S.d-i*.06)/.18):0,fp=fl>=.5,sy=done&&fl<1?Math.abs(Math.cos(fl*Math.PI)):1,col=fp?HC.gr:HC.cy;
      ctx.save();ctx.translate(x+pw/2,y+ph/2);ctx.scale(1,Math.max(.03,sy));ctx.translate(-pw/2,-ph/2);ctx.beginPath();ctx.rect(0,0,pw,ph);ctx.clip();
      ctx.fillStyle=fp?'rgba(62,240,160,.06)':'rgba(79,216,255,.05)';ctx.fillRect(0,0,pw,ph);ctx.lineWidth=1;ctx.globalAlpha=.4;ctx.strokeStyle=col;ctx.strokeRect(.5,.5,pw-1,ph-1);ctx.globalAlpha=1;ctx.lineWidth=1.5;brackets(ctx,1,1,pw-2,ph-2,6,col);
      ctx.font=MONO(6.5,700);ctx.fillStyle=col;ctx.textAlign='left';ctx.globalAlpha=.75;ctx.fillText(NAMES[i]+' 0'+(i+1),5,10);ctx.globalAlpha=1;
      const iw=pw-10,ih=ph-16,ox=5,oy=13,mx=ox+iw/2,my=oy+ih/2;
      if(fp&&i!==4){check(ctx,mx,my,Math.min(iw,ih)*.28,(S.d-i*.06-.09)/.35,HC.gr)}
      else if(i===0){ctx.fillStyle=HC.cy;ctx.globalAlpha=.25;for(let k=0;k<40;k++)ctx.fillRect(ox+sd[k]*iw,oy+sd[k+10]*ih,1.5,1.5);ctx.globalAlpha=1;for(let k=0;k<4;k++){const px=ox+sd[k+20]*iw,py=oy+sd[k+30]*ih,r=((t*.9+k*.25)%1)*10;ctx.strokeStyle=HC.go;ctx.globalAlpha=1-r/10;arc(ctx,px,py,r,0,7);ctx.globalAlpha=1;ctx.fillStyle=HC.go;ctx.fillRect(px-1.5,py-1.5,3,3)}}
      else if(i===1){ctx.strokeStyle=HC.cy;ctx.lineWidth=1.5;ctx.beginPath();for(let k=0;k<=24;k++){const xx=ox+iw*k/24,yy=my+Math.sin(t*3+k*.55)*ih*.25+Math.sin(t*7+k*1.3)*ih*.08;k?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy)}ctx.stroke()}
      else if(i===2){const r=Math.min(iw,ih)*.45;ctx.strokeStyle='rgba(79,216,255,.35)';ctx.lineWidth=1;arc(ctx,mx,my,r,0,7);arc(ctx,mx,my,r*.5,0,7);const a=t*3;ctx.strokeStyle=HC.cy;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(mx,my);ctx.lineTo(mx+Math.cos(a)*r,my+Math.sin(a)*r);ctx.stroke();ctx.fillStyle=HC.go;ctx.fillRect(mx+r*.4-1.5,my-r*.3-1.5,3,3)}
      else if(i===3){ctx.fillStyle=HC.wh;ctx.font=MONO(Math.min(20,ih*.45),700);ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(Math.round((+L.nums[2]||100)*p)).padStart(3,'0'),mx,my);ctx.textBaseline='alphabetic';ctx.font=MONO(6,700);ctx.fillStyle=HC.cy;ctx.fillText(L.mods[0].toUpperCase(),mx,oy+ih-1)}
      else if(i===4){ctx.textAlign='center';ctx.textBaseline='middle';if(fp){glow(ctx,HC.gr,10);ctx.fillStyle=HC.gr;const fs=Math.min(16,iw/5.2);ctx.font='800 '+fs+'px "Barlow Condensed",sans-serif';ctx.fillText('MISSION',mx,my-fs*.55);ctx.fillText('COMPLETE',mx,my+fs*.45);noGlow(ctx);ctx.font=MONO(6,700);ctx.fillText(L.name.toUpperCase().slice(0,18),mx,my+fs*1.25)}else{const r=Math.min(iw,ih)*.36;ctx.lineWidth=4;ctx.strokeStyle='rgba(79,216,255,.15)';arc(ctx,mx,my,r,0,7);glow(ctx,HC.cy,10);ctx.strokeStyle=HC.cy;arc(ctx,mx,my,r,-Math.PI/2,-Math.PI/2+p*Math.PI*2);noGlow(ctx);ctx.fillStyle=HC.wh;ctx.font=MONO(11,700);ctx.fillText(Math.round(p*100)+'%',mx,my)}ctx.textBaseline='alphabetic'}
      else if(i===5){const n=7,bw=iw/n-3;for(let k=0;k<n;k++){const v=(.35+.65*Math.abs(Math.sin(t*2.5+k*.9)))*(.3+.7*p);ctx.fillStyle=k%3?HC.cy:HC.go;ctx.fillRect(ox+k*(bw+3),oy+ih-v*ih,bw,v*ih)}}
      else if(i===6){ctx.font=MONO(6.5,500);ctx.textAlign='left';const lines=Math.floor(ih/9),off=(t*12)|0;for(let k=0;k<lines;k++){const s=sd[(k+off)%60];ctx.fillStyle=s>.8?HC.go:'rgba(232,251,255,.6)';ctx.fillText('> '+(s*0xffffff|0).toString(16).padStart(6,'0')+' '+(['ok','sync','read','map','push'][(s*5)|0]),ox,oy+8+k*9)}}
      else if(i===7){const r=Math.min(iw,ih)*.45;SPH2.forEach(([la,lo])=>{const[xx,yy,z]=proj(la,lo,t*.8,.35,r,mx,my);if(z<0)return;ctx.fillStyle=HC.cy;ctx.globalAlpha=z*.9+.1;ctx.fillRect(xx-.8,yy-.8,1.6,1.6)});ctx.globalAlpha=1}
      else if(i===8){ctx.strokeStyle=HC.go;ctx.lineWidth=1.2;ctx.beginPath();for(let k=0;k<=40;k++){const xx=ox+iw*k/40,env=Math.sin(Math.PI*k/40),yy=my+Math.sin(k*.9+t*10)*env*ih*.35*(.4+.6*p);k?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy)}ctx.stroke()}
      ctx.restore()}}}))});

/* Command wall · Global map */
ANIMS.push({id:'globe',group:'cine',name:'Command wall · Global map',tag:'Command centre',sound:'radar',desc:'A dotted globe turns while data links arc in from around the world to the client; when done the target pulses green.',
  setup:cine(get=>({init(S){S.src=Array.from({length:9},()=>[(Math.random()*100-35)*Math.PI/180,(Math.random()*300-150)*Math.PI/180])},draw(ctx,w,h,S){const L=get(),A=AREA(h),cx=w/2,cy=A/2+3,R=Math.min(w*.3,A*.46),done=S.d>=0,t=S.idle?.4:S.t,p=S.idle?0:S.p,[tla,tlo]=GEO[tool].map(v=>v*Math.PI/180);
    const e=done?1:easeOut(p),rot=-tlo-1.7*(1-e),tilt=.47*e+.15*(1-e);
    const gg=ctx.createRadialGradient(cx,cy,R*.2,cx,cy,R*1.15);gg.addColorStop(0,'rgba(79,216,255,.10)');gg.addColorStop(1,'rgba(79,216,255,0)');ctx.fillStyle=gg;ctx.beginPath();ctx.arc(cx,cy,R*1.15,0,7);ctx.fill();
    ctx.strokeStyle=done?HC.gr:HC.cy;ctx.globalAlpha=.4;ctx.lineWidth=1;arc(ctx,cx,cy,R,0,7);ctx.globalAlpha=1;
    SPH.forEach(([la,lo])=>{const[x,y,z]=proj(la,lo,rot,tilt,R,cx,cy);if(z<0)return;ctx.fillStyle=done?HC.gr:HC.cy;ctx.globalAlpha=.15+z*.7;ctx.fillRect(x-.9,y-.9,1.8,1.8)});ctx.globalAlpha=1;
    S.src.forEach((s,i)=>{const st=i/S.src.length*.8,f=S.idle?0:done?1:clamp((p-st)/.22);if(f<=0)return;ctx.strokeStyle=done?HC.gr:HC.go;ctx.lineWidth=1.5;ctx.beginPath();let on=false,hx=null,hy=null;const N=44;for(let k=0;k<=Math.round(N*f);k++){const u=k/N,[x,y,z]=proj(s[0]+(tla-s[0])*u,s[1]+(tlo-s[1])*u,rot,tilt,R*(1+.3*Math.sin(Math.PI*u)),cx,cy);if(z<0){on=false;continue}on?ctx.lineTo(x,y):ctx.moveTo(x,y);on=true;hx=x;hy=y}ctx.globalAlpha=.85;glow(ctx,done?HC.gr:HC.go,6);ctx.stroke();noGlow(ctx);ctx.globalAlpha=1;if(f<1&&hx!==null){ctx.fillStyle=HC.wh;ctx.beginPath();ctx.arc(hx,hy,2.2,0,7);ctx.fill()}});
    const[tx,ty,tz]=proj(tla,tlo,rot,tilt,R,cx,cy);if(tz>0){const c=done?HC.gr:HC.go,r=((t*1.2)%1)*14;ctx.strokeStyle=c;ctx.lineWidth=1.5;ctx.globalAlpha=1-r/14;arc(ctx,tx,ty,r+3,0,7);ctx.globalAlpha=1;glow(ctx,c,10);ctx.fillStyle=c;ctx.beginPath();ctx.arc(tx,ty,3.5,0,7);ctx.fill();noGlow(ctx);
      if(done){for(let j=0;j<3;j++){const d=S.d-j*.2;if(d>0&&d<1){ctx.strokeStyle=HC.gr;ctx.lineWidth=2;ctx.globalAlpha=1-d;arc(ctx,tx,ty,6+d*R*.9,0,7);ctx.globalAlpha=1}}
        if(S.d>.35){const k=clamp((S.d-.35)/.3),label=L.name.toUpperCase()+' · ONLINE';ctx.font=MONO(8.5,700);const lw=ctx.measureText(label).width+14,lx=Math.min(w-lw-8,tx+14),ly=ty-24;ctx.globalAlpha=k;ctx.fillStyle='rgba(5,8,12,.85)';ctx.strokeStyle=HC.gr;ctx.lineWidth=1;rr(ctx,lx,ly-9,lw,18,3);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(lx,ly);ctx.stroke();ctx.fillStyle=HC.gr;ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(label,lx+7,ly+.5);ctx.textBaseline='alphabetic';ctx.globalAlpha=1}}}
    ctx.font=MONO(7.5,700);ctx.textAlign='left';ctx.fillStyle=HC.cy;ctx.globalAlpha=.75;ctx.fillText('TRACKING · '+Math.round((S.idle?0:done?1:p)*9)+'/9 LINKS',10,14);ctx.textAlign='right';ctx.fillText('LAT '+GEO[tool][0].toFixed(1)+'  LON '+GEO[tool][1].toFixed(1),w-10,14);ctx.globalAlpha=1}}))});


/* ================= EMBED API (team site popup) ================= */
if(EMBED){
 const css=document.createElement('style');css.textContent=window.DM_CSS||'';document.head.appendChild(css);
 let open=null;
 window.DM={anims:ANIMS.filter(A=>['lockon','core','syscheck','opsgrid','globe','rain','hud'].includes(A.id)).map(A=>({id:A.id,name:A.name})),
  configure(o){Object.assign(CFG,o);if(o.lines)LINES[o.tool||tool]=o.lines;if(o.tool)tool=o.tool;if(o.gender)gender=o.gender;if(o.mode)doneMode=o.mode},
  unlock(){ac();try{speechSynthesis.getVoices()}catch(e){}},
  voices(){return shortlist().map(v=>v.name)},
  close(){if(open)open()},
  speak(text){ac();say(text)},
  thumb(id,host){const A=ANIMS.find(x=>x.id===id)||ANIMS.find(x=>x.id==='syscheck'),L=LINES[tool];host.innerHTML='<div class="stage"><div class="job"><div class="t"></div><div class="s"></div><div class="track"><div class="fill"></div></div></div></div>';const stage=host.firstElementChild,ctrl=A.setup(stage);ctrl.reset(L);stage.querySelector('.job .t').textContent=L.done;stage.querySelector('.job .s').textContent='Done · just now';stage.querySelector('.fill').style.width='100%';stage.classList.add('done');ctrl.start(L);ctrl.progress(1);ctrl.done(L);return stage},
  sound(id){const ids=this.anims.map(a=>a.id);if(!id||id==='random')id=ids[Math.random()*ids.length|0];const A=ANIMS.find(x=>x.id===id)||ANIMS.find(x=>x.id==='syscheck');playSound(A.sound)},
  play(id,opt={}){if(open)open();const ids=this.anims.map(a=>a.id);if(id==='random')id=ids[Math.random()*ids.length|0];const A=ANIMS.find(x=>x.id===id)||ANIMS.find(x=>x.id==='syscheck');const L=LINES[tool];
   const el=document.createElement('div');el.className='dm-pop working';el.setAttribute('role','dialog');el.setAttribute('aria-label',L.work);
   el.innerHTML=`<div class="dm-back"></div><div class="dm-card"><div class="dm-fit"><div class="stage"><div class="job"><div class="t"></div><div class="s"></div><div class="track"><div class="fill"></div></div></div></div></div>
    <div class="dm-foot"><div class="dm-txt"><small></small></div><div class="dm-btns"><button type="button" class="dm-b dm-hide">Hide · keep working</button><button type="button" class="dm-b dm-open"></button><button type="button" class="dm-b dm-x">Close</button></div></div><div class="dm-timer"><i></i></div></div>`;
   document.body.appendChild(el);const stage=el.querySelector('.stage'),fit=el.querySelector('.dm-fit'),card=el.querySelector('.dm-card'),small=el.querySelector('.dm-txt small');
   const scale=()=>{const k=Math.min(1.75,(Math.min(innerWidth,900)*.92)/440,(innerHeight*.62)/275);fit.style.width=440*k+'px';fit.style.height=275*k+'px';stage.style.transform=`scale(${k})`};scale();addEventListener('resize',scale);
   stage.querySelector('.job .t').textContent=L.work;small.textContent=opt.workSub||'Working… you can keep using the site.';el.querySelector('.dm-open').textContent=opt.openLabel||('Open '+L.name);
   const ctrl=A.setup(stage);ctrl.reset(L);requestAnimationFrame(()=>el.classList.add('in'));
   let closeT=null,closed=false,finished=false;
   const close=()=>{if(closed)return;closed=true;clearTimeout(closeT);removeEventListener('resize',scale);el.classList.remove('in');el.classList.add('out');setTimeout(()=>el.remove(),350);open=null;opt.onClose&&opt.onClose()};open=close;
   const mini=on=>{el.classList.toggle('mini',on)};
   el.querySelector('.dm-hide').onclick=e=>{e.stopPropagation();mini(true)};
   card.addEventListener('click',()=>{if(el.classList.contains('mini'))mini(false)});
   el.querySelector('.dm-x').onclick=close;el.querySelector('.dm-back').onclick=()=>{finished?close():mini(true)};el.querySelector('.dm-open').onclick=()=>{close();opt.onOpen&&opt.onOpen()};
   addEventListener('keydown',function k(e){if(e.key==='Escape'){finished?close():mini(true);if(finished)removeEventListener('keydown',k)}});
   const fill=stage.querySelector('.fill'),sub=stage.querySelector('.job .s');stage.classList.add('working');ctrl.start(L);
   const setP=(p,label)=>{if(closed||finished)return;p=Math.max(0,Math.min(1,p));fill.style.width=(p*100).toFixed(1)+'%';sub.textContent=label||(L.steps[Math.min(L.steps.length-1,Math.floor(p*L.steps.length))]+' · '+Math.round(p*100)+'%');ctrl.progress(p)};
   const finish=()=>{if(closed||finished)return;finished=true;setP(1);mini(false);el.classList.remove('working');el.setAttribute('aria-label',L.done);stage.classList.remove('working');stage.classList.add('done');stage.querySelector('.job .t').textContent=L.done;sub.textContent='Done · just now';small.textContent=opt.sub||'Just now';ctrl.done(L);card.classList.add('hit');playSound(A.sound);
     const life=opt.life||9000,bar=el.querySelector('.dm-timer i');bar.style.transition=`width ${life}ms linear`;requestAnimationFrame(()=>bar.style.width='0%');closeT=setTimeout(close,life)};
   if(!opt.manual){const WORKP=opt.work||1800,t0=performance.now();(function tick(now){if(closed)return;const p=Math.min(1,(now-t0)/WORKP);setP(p);if(p<1)requestAnimationFrame(tick);else finish()})(t0)}
   return{progress:setP,finish,close}}};
}

if(!EMBED){
/* ================= BUILD UI ================= */
const sndOpts=Object.entries(SOUNDS).map(([k,s])=>`<option value="${k}">${s.name}${s.office?' (office friendly)':''}</option>`).join('');

const tiles=[];const ORDER=[...ANIMS.filter(A=>A.group==='cine'),...ANIMS.filter(A=>A.group!=='cine')];
ORDER.forEach((A,i)=>{const grid=A.group==='cine'?$('#gridCode'):$('#grid');const sec=document.createElement('section');sec.className='opt';sec.innerHTML=`<header><h3><span>${String(i+1).padStart(2,'0')}</span>${A.name}</h3><span class="tag">${A.tag}</span></header><p class="what">${A.desc}</p>
  <div class="stage"><div class="job"><div class="t"></div><div class="s"></div><div class="track"><div class="fill"></div></div></div></div>
  <div class="ctrls"><button class="btn go" type="button">Run it</button><select id="snd-${A.id}" aria-label="Sound for ${A.name}">${sndOpts}</select></div>`;
  grid.appendChild(sec);const stage=sec.querySelector('.stage'),sel=sec.querySelector('select');sel.value=A.sound;const ctrl=A.setup(stage);const T={A,sec,stage,sel,ctrl,btn:sec.querySelector('.btn.go')};tiles.push(T);T.btn.addEventListener('click',()=>run(T))});
function setup(T){const s=T.stage,L=LINES[tool];s.classList.remove('working','done');s.querySelector('.job .t').textContent=L.work;s.querySelector('.job .s').textContent='Waiting · press Run it';s.querySelector('.fill').style.width='0%';T.ctrl.reset(L)}
const WORK=3400;
function run(T){const s=T.stage,L=LINES[tool];ac();setup(T);T.btn.disabled=true;s.classList.add('working');T.ctrl.start(L);const fill=s.querySelector('.fill'),sub=s.querySelector('.job .s'),t0=performance.now();
  (function tick(now){const p=Math.min(1,(now-t0)/WORK);fill.style.width=(p*100).toFixed(1)+'%';sub.textContent=L.steps[Math.min(L.steps.length-1,Math.floor(p*L.steps.length))]+' · '+Math.round(p*100)+'%';T.ctrl.progress(p);
    if(p<1)requestAnimationFrame(tick);else{s.classList.remove('working');s.classList.add('done');s.querySelector('.job .t').textContent=L.done;sub.textContent='Done · just now';T.ctrl.done(L);playSound(T.sel.value);setTimeout(()=>T.btn.disabled=false,2600)}})(t0)}


const board=$('#board');Object.entries(SOUNDS).forEach(([k,s])=>{const b=document.createElement('button');b.type='button';b.className='snd';b.innerHTML=`${s.office?'<i>Office friendly</i>':''}<b>${s.name}</b><span>${s.desc}</span>`;
  b.addEventListener('click',()=>{playSound(k,true);b.classList.add('playing');setTimeout(()=>b.classList.remove('playing'),1800)});board.appendChild(b)});

function showLine(){$('#line').innerHTML='Voice line: <b>"'+lineText()+'"</b>'}
$('#tool').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;tool=b.dataset.v;$('#tool').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));tiles.forEach(setup);showLine()});
$('#style').addEventListener('change',showLine);
$('#mode').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;doneMode=b.dataset.v;$('#mode').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b))});
const PICKED=['lockon','core','syscheck','opsgrid','globe','rain','hud'];
$('#finish').innerHTML=tiles.filter(T=>PICKED.includes(T.A.id)).map(T=>`<option value="${T.A.id}">${T.A.name}</option>`).join('')+'<option value="random">Surprise me (a different one each time)</option>';$('#finish').value='syscheck';
tiles.forEach(T=>{if(PICKED.includes(T.A.id)){T.sec.classList.add('picked');T.sec.querySelector('header').insertAdjacentHTML('beforeend','<span class="tag pk">PJ picked</span>')}});
$('#playmine').addEventListener('click',()=>{let id=$('#finish').value;if(id==='random')id=PICKED[Math.random()*PICKED.length|0];const T=tiles.find(x=>x.A.id===id);if(!T)return;T.sec.scrollIntoView({behavior:reduce?'auto':'smooth',block:'center'});setTimeout(()=>run(T),reduce?0:450)});
$('#gender').addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;gender=b.dataset.v;$('#gender').querySelectorAll('button').forEach(x=>x.setAttribute('aria-pressed',x===b));fillWho()});
$('#testv').addEventListener('click',()=>{try{ac();speechSynthesis.cancel();const v=pick(),u=new SpeechSynthesisUtterance('This is '+(v?v.name.replace(/ \(.*\)$/,''):'the default voice')+'. Build complete, Commander.');if(v){u.voice=v;u.lang=v.lang}u.volume=1;speechSynthesis.speak(u);const vn=$('#vname');if(vn)vn.textContent='Speaking with: '+(v?v.name:'default')}catch(e){}});
$('#who').addEventListener('change',()=>{const vn=$('#vname');if(vn)vn.textContent=''});
$('#callme').addEventListener('change',e=>{$('#custom').hidden=e.target.value!=='__custom';showLine()});$('#custom').addEventListener('input',showLine);
requestAnimationFrame(()=>{tiles.forEach(setup);showLine()});
let rz;addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(()=>tiles.forEach(T=>{if(!T.stage.classList.contains('working')&&!T.stage.classList.contains('done'))T.ctrl.reset(LINES[tool])}),200)});

}
})();
}
