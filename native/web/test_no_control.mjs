// node test_no_control.mjs -- FUN_00331f08's game-state bit 11 branch on the weapon side (worker 0246): aim_core.js
// WeaponSystem.noControl. AIM_CORE_JS=<path> tests another copy (mutation runs).
//   - FUN_00574b98 (the R1 release) runs only for an auto weapon (W+4 bit 0): state 3 -> 0, 4 -> 2, others kept;
//   - no input this frame: no 'shot' / 'reload' events, and a pressed R1 starts nothing (FUN_003320c0 skipped).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { WeaponSystem } = await import(pathToFileURL(process.env.AIM_CORE_JS || path.join(here, 'aim_core.js')).href);
const J = p => JSON.parse(readFileSync(path.join(here, p)));
const W0 = J('data/aim/weapon.json'), RET = J('data/aim/reticle.json');
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

for (const [auto, st, want] of [[1, 3, 0], [1, 4, 2], [1, 1, 1], [1, 9, 9], [0, 3, 3], [0, 4, 4]]) {
  const w = new WeaponSystem({ ...W0, flags: auto ? (W0.flags | 1) : (W0.flags & ~1) }, RET);
  w.P.drawn = true; w.P.st = st; w.events.push({ type: 'reload' });
  w.noControl({ P: { state: 3 } });
  ok(w.P.st === want && w.events.length === 0, `${auto ? 'auto' : 'semi'} weapon, state ${st} -> ${w.P.st} (want ${want}), events cleared`);
}
{ // the frame's buttons go nowhere: compare with input() taking the same R1 press
  const a = new WeaponSystem({ ...W0 }, RET), b = new WeaponSystem({ ...W0 }, RET);
  for (const w of [a, b]) { w.P.drawn = true; w.P.st = 0; }
  a.input({ r1Pressed: true, r1Held: true }, true, { x: 0, y: 0, z: 10 }, null);
  b.noControl({ P: { state: 3 } });
  ok(a.P.st !== 0 && b.P.st === 0, `R1 press: input() starts a shot (state ${a.P.st}), noControl does not (state ${b.P.st})`);
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
