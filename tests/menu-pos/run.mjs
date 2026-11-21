// v1.36.0 (queue item 3): "Menu position in GHL".   Run: node tests/menu-pos/run.mjs   (no dependencies)
// The lines the Builder / KPI admin generate, the number check, the pasted / changed states, the config edits.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as M from '../../scripts/menu-css.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let pass = 0, fail = 0;
const check = (ok, what, extra = '') => { if (ok) { pass++; console.log(`✓ ${what}`); } else { fail++; console.log(`✗ ${what}${extra ? `\n    ${extra}` : ''}`); } };

// The working rules in the agency Custom CSS on 21 Nov 2026 (read in GHL, REPORT 3.0)
const GHL_BOCA = '/* KPI Dashboard · Boca Dental */\n#\\39 3865fae-fd84-453b-b263-147080863a5f { order: -91 !important; }';
const GHL_DUMAS = '/* KPI Dashboard · Dumas & Sanclemente */\n#b7cc0202-2178-4fae-b69e-c8713df0f793 {\n    order: -92 !important;\n}';
const GHL_TRAINING = [['#\\35 373443b-c0b7-43ab-aedf-3e16d810cf41', '5373443b-c0b7-43ab-aedf-3e16d810cf41'], ['#\\37 18fe952-4e3c-4c3e-8815-04d9b3305a3a', '718fe952-4e3c-4c3e-8815-04d9b3305a3a'], ['#\\30 038eddf-0367-4279-b987-35bf4d381888', '0038eddf-0367-4279-b987-35bf4d381888'], ['#e4467638-6e4f-4029-b371-15705adce098', 'e4467638-6e4f-4029-b371-15705adce098']];

// escape rule
for (const [sel, id] of GHL_TRAINING) check(`#${M.cssMenuId(id)}` === sel, `escape: ${id.slice(0, 8)}… → ${sel.slice(0, 14)}…`);
check(M.cssMenuId('93865fae-fd84-453b-b263-147080863a5f') === '\\39 3865fae-fd84-453b-b263-147080863a5f', 'a leading digit d becomes "\\3d " (digit, space)');
check(M.cssMenuId('b7cc0202-2178-4fae-b69e-c8713df0f793') === 'b7cc0202-2178-4fae-b69e-c8713df0f793', 'a leading letter is kept');
let threw = false; try { M.cssMenuId('x; } body { display:none'); } catch { threw = true; } check(threw, 'a non-id is refused (nothing can be injected into the CSS)');

// lines vs today's working rules
check(M.menuCssRule({ id: '93865fae-fd84-453b-b263-147080863a5f', name: 'Boca Dental', order: -91 }) === GHL_BOCA, 'Boca: byte-for-byte the rule in GHL today');
const dumas = M.menuCssRule({ id: 'b7cc0202-2178-4fae-b69e-c8713df0f793', name: 'Dumas & Sanclemente', order: -92 });
const flat = t => t.replace(/\s+/g, ' ').replace(/\{ /g, '{').replace(/ \}/g, '}');
check(flat(dumas) === flat(GHL_DUMAS), 'Dumas: same comment, selector and value as GHL (GHL has it over 3 lines; spacing only)', `${flat(dumas)} vs ${flat(GHL_DUMAS)}`);
check(M.menuCssRule({ id: 'b7cc0202-2178-4fae-b69e-c8713df0f793', name: 'X' }) === '/* KPI Dashboard · X */\n#b7cc0202-2178-4fae-b69e-c8713df0f793 { order: -92 !important; }', 'default -92, the v1.30.0 format unchanged');
check(M.menuCssRule({ id: 'b7cc0202-2178-4fae-b69e-c8713df0f793', name: 'A */ b', label: 'LeadPro Reports', order: M.REPORTS_ORDER }).startsWith('/* LeadPro Reports · A * / b */'), 'Reports label, -91; a "*/" in a name can\'t end the comment');

// numbers
for (const [t, want] of [['-92', -92], [' -92 ', -92], ['+5', 5], ['0', 0], ['-999', -999], ['999', 999], ['-1000', null], ['1000', null], ['-9.5', null], ['abc', null], ['', null], ['--9', null], ['9e1', null]]) check(M.parseOrder(t) === want, `parseOrder("${t}") = ${want}`);
let bad = false; try { M.menuCssRule({ id: 'b7cc0202-2178-4fae-b69e-c8713df0f793', name: 'X', order: 1.5 }); } catch { bad = true; } check(bad, 'a non-whole number never reaches the CSS');

// states
const id = 'abcd1234-0000-4000-8000-000000000001';
const s0 = M.menuState({ menuLink: { status: 'created', id } });
check(s0.order === -92 && s0.needsPaste && !s0.pasted && M.pastedLine(s0) === 'Not in GHL yet: paste the lines below.', 'new link: -92, needs the paste');
check(!M.menuState({}).needsPaste && !M.menuState({ menuLink: { status: 'created' } }).needsPaste, 'no link id: nothing to paste yet ("Read link id")');
const c1 = M.withPasted({ a: 1, menuLink: { status: 'created', id } }, { by: 'PJ', at: '2026-11-21T09:00:00Z' });
check(JSON.stringify(c1) === JSON.stringify({ a: 1, menuLink: { status: 'created', id, order: -92, cssPasted: { order: -92, by: 'PJ', at: '2026-11-21T09:00:00Z' } } }), 'I\'ve pasted it: only menuLink changes (order + cssPasted)');
const s1 = M.menuState(c1); check(!s1.needsPaste && /^Pasted at -92 by PJ · Nov 21\.$/.test(M.pastedLine(s1)), `pasted → not amber: "${M.pastedLine(s1)}"`);
const c2 = M.withMenuOrder(c1, -90), s2 = M.menuState(c2);
check(s2.needsPaste && s2.replaces === -92 && /Replace it with the new line below \(delete the old -92 line\)/.test(M.pastedLine(s2)), 'a new number → amber again, says to replace the old line');
check(M.menuState(M.withPasted(c2, { by: 'PJ' })).needsPaste === false, '… and clears after I\'ve pasted it');
const boca = M.menuState({ menuLink: { status: 'created', id: '93865fae-fd84-453b-b263-147080863a5f' } });
check(boca.order === -91 && !boca.needsPaste && boca.pasted.hand && /pasted by hand/.test(M.pastedLine(boca)), 'Boca (hand-pasted -91): in GHL, not amber; nothing to delete');
check(M.menuState({ menuLink: { id: 'b7cc0202-2178-4fae-b69e-c8713df0f793' } }).order === -92 && !M.menuState({ menuLink: { id: 'b7cc0202-2178-4fae-b69e-c8713df0f793' } }).needsPaste, 'Dumas (hand-pasted -92) once its id is read: in GHL, not amber');
let e1 = false; try { M.withMenuOrder({}, 1000); } catch { e1 = true; } check(e1, 'withMenuOrder refuses -999…999 overflow');

// preview
check(M.menuPreview(-92).map(x => `${x.label} ${x.order}`).join(' · ') === 'Dashboard -100 · Contacts -99 · Opportunities -98 · LeadPro Training -96 · KPI Dashboard -92 · Launchpad and the rest 50', 'preview: the 21 Nov order with this link at -92');
check(M.menuPreview(-99).map(x => x.label).slice(0, 3).join(',') === 'Dashboard,Contacts,KPI Dashboard', 'a tie keeps GHL\'s item first');
check(M.GHL_CUSTOM_CSS_URL === 'https://app.lawfirmmarketingpros.com/settings/company?tab=whitelabel' && M.MENU_SCHEME_AS_OF === '21 Nov', 'the Custom CSS address and the "as of" date');

// New firm keeps a chosen position when it makes the link again
const nf = await readFile(join(ROOT, 'scripts/new-firm.mjs'), 'utf8');
check(/cfg\.menuLink = \{ status: res, at: new Date\(\)\.toISOString\(\), \.\.\.\(id \? \{ id \} : \{\}\), \.\.\.\(Number\.isInteger\(cfg\.menuLink\?\.order\) \? \{ order: cfg\.menuLink\.order \} : \{\}\) \}; await writeFile\(cfgPath/.test(nf), 'new-firm.mjs keeps menuLink.order and still writes the config (a new link needs a new paste)');
const { execFileSync } = await import('node:child_process'); let syntaxOk = true; try { execFileSync(process.execPath, ['--check', join(ROOT, 'scripts/new-firm.mjs')]); } catch { syntaxOk = false; } check(syntaxOk, 'new-firm.mjs parses');

console.log(`\n${pass} of ${pass + fail} menu-pos tests pass.`);
process.exitCode = fail ? 1 : 0;
