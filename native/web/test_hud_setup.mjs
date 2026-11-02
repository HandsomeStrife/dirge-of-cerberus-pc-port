// test_hud_setup.mjs -- the HUD built from the disc (export_web_hud.py disc_tree, FUN_003ad618 + the
// start setters) vs the sea-of-flames save's HUD tree: export_web_hud.py --state prints the field-by-field
// differences and exits 1 when there are any. Also checks the run without --state reads no save.
// Run: node native/web/test_hud_setup.mjs   (needs the ELF, extract/_KEL locale uk, the save; SKIP without)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const SAVE = process.env.HUD_STATE || '/srv/shared/dirge-port/save-states/sea-of-flames.p2s';
const ELF = path.join(root, 'elf/SLES_541.85');
const LOC = path.join(root, 'extract/_KEL/data/etc/locale/uk');
const EXP = path.join(root, 'native/assets/models/export_web_hud.py');
for (const f of [SAVE, ELF, path.join(LOC, 'kelstr.bin')]) {
  if (!existsSync(f)) { console.log('SKIP: no ' + f); process.exit(0); }
}
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const tmp = mkdtempSync(path.join(os.tmpdir(), 'hud_setup_'));
try {
  const r = spawnSync('python3', ['-I', EXP, '--elf', ELF, '--locale', LOC, '--state', SAVE, '-o', path.join(tmp, 's')], { encoding: 'utf8' });
  const line = (r.stdout.match(/save vs disc build: .*/) || [''])[0];
  ok(r.status === 0, `--state exits 0 (status ${r.status})`);
  ok(/114 HUD elements, 0 differences/.test(line), `save vs disc build: ${line || r.stderr.slice(-300)}`);
  // the disc build: no save opened (the audit hook lists every open()), and the same HUD elements
  const hook = `import sys, runpy\nseen = []\nsys.addaudithook(lambda e, a: seen.append(str(a[0])) if e == 'open' else None)\n` +
    `sys.argv = sys.argv[1:]\ntry:\n  runpy.run_path(sys.argv[0], run_name='__main__')\nfinally:\n  print('P2S', any(s.endswith('.p2s') for s in seen))\n`;
  const d = spawnSync('python3', ['-I', '-c', hook, EXP, '--elf', ELF, '--locale', LOC, '-o', path.join(tmp, 'd')], { encoding: 'utf8' });
  ok(d.status === 0 && /P2S False/.test(d.stdout), `the disc build opens no save state (status ${d.status})`);
  const S = JSON.parse(readFileSync(path.join(tmp, 's/hud.json'))), D = JSON.parse(readFileSync(path.join(tmp, 'd/hud.json')));
  ok(JSON.stringify(D.chain) === JSON.stringify(S.chain.slice(0, D.chain.length)) && D.chain.length === 114,
    `disc chain = the save's first ${D.chain.length} elements (the save's other ${S.chain.length - D.chain.length} are other screens)`);
  ok(JSON.stringify(D.values) === JSON.stringify(S.values), 'values equal');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
