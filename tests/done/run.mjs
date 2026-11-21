// v1.38.0 Done moments (queue item 6): KPI admin's New firm setup runs in the Done moments popup (KPI words, its real steps,
// Open <firm> = the firm's page); every other KPI admin job keeps the working bar. Classic and the popup itself are tested
// in tests/shell/shell.test.mjs (the shared shell).   Run: node tests/done/run.mjs
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../../admin/index.html', import.meta.url), 'utf8');
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) { pass++; console.log(`✓ ${what}`); } else { fail++; console.log(`✗ ${what}`); } };
check(/const newFirmJob = \(name, slug\) => kpiJob\(\{ kind: 'kpi', client: name, what: 'New firm',[^]*?moment: \{ tool: 'kpi', steps: RUN_STEPS\.slice\(0, 5\),[^]*?open: slug \? \(\) => \{ location\.hash = `#\/firm\/\$\{slug\}`; \} : undefined \} \}\);/.test(html), 'New firm: moment with the KPI words, the real steps, Open <firm>');
check((html.match(/newFirmJob\((ctx|me\.ctx|myRun\.ctx)\.name, \1\.slug\)/g) || []).length === 3, 'the three New firm starts pass the slug');
check((html.match(/moment:/g) || []).length === 1, 'no other KPI admin job has a moment');
check(/<link rel="stylesheet" href="lfmp-done\.css\?v=2\.10\.0">/.test(html), 'the page loads lfmp-done.css (shell 2.10.0)');
console.log(`\n${pass} of ${pass + fail} Done moments checks pass.`);
process.exitCode = fail ? 1 : 0;
