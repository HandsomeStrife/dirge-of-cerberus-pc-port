// worker 0264: what a trigger volume tests. FUN_00573c60 -> FUN_005442a0 -> FUN_005517a8: both ends of Vincent's move, 7 up (y - 7).
// Found by the whole-level run (test_level_run_page): trigger 160 (-1101, -0.41, -593; script 165: stage flag 0 == 2 -> 4) has its floor
// above his feet (y -0.06), so with the feet alone it never fired and the story's flag 0 stayed 2. Game: route states r03_start (x -1033,
// flag 0 = 2) -> r03_predog (x -1254, flag 0 = 4), walked. Run: node test_trigger_point.mjs
import { readFileSync } from 'node:fs';
import { createEnemyAI } from './enemy_ai.js';
import { initWorld } from './checkpoint.js';

const here = new URL('.', import.meta.url).pathname;
const data = JSON.parse(readFileSync(here + 'data/enemies/ai.json', 'utf8'));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

function world(flag0) {
  const player = { pos: [-1033, -0.06, -590], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const W = initWorld(o => createEnemyAI({ data, player, quiet: true, log: () => {}, ...o }), { flags: { 0: flag0 }, frame: 24, clock: {}, loadRecs: [] });
  W.tick(1.2, player.pos, player.pos);
  W.eventFlags[0] = flag0;
  return { W, player };
}
// walk along z -590 at his run speed, feet on the floor
function walk(W, player, x0, x1) {
  let x = x0;
  while (x > x1) { const old = [x, -0.06, -590]; x -= 1.2; player.pos = [x, -0.06, -590]; W.tick(1.2, old, player.pos); }
}
const fired = (W, id) => W.events.some(e => e.startsWith(`event ${id} `));

{ const { W, player } = world(2);
  walk(W, player, -1085, -1120);
  ok((W.eventFlags[0] | 0) === 4, `walking through trigger 160 with feet at y -0.06: flag 0 2 -> 4 (${W.eventFlags[0] | 0})`); }
{ const { W, player } = world(3);                      // its script's own test: flag 0 == 2
  walk(W, player, -1085, -1120);
  ok((W.eventFlags[0] | 0) === 3, `flag 0 = 3: the script's test refuses (${W.eventFlags[0] | 0})`); }
{ const { W, player } = world(2);                      // beside the box: z -640 is outside its +-27.7
  let x = -1085; while (x > -1120) { const old = [x, -0.06, -640]; x -= 1.2; player.pos = [x, -0.06, -640]; W.tick(1.2, old, player.pos); }
  ok((W.eventFlags[0] | 0) === 2, `past the box at z -640: no event (${W.eventFlags[0] | 0})`); }
// the test point is 7 up, not higher: a floor walked well under a box 12 above his head stays quiet (trigger 160's top y -58.5: feet at y 0 reach it from the floor, a spot at y -60 does not)
{ const { W, player } = world(2);
  let x = -1085; while (x > -1120) { const old = [x, -60, -590]; x -= 1.2; player.pos = [x, -60, -590]; W.tick(1.2, old, player.pos); }
  ok((W.eventFlags[0] | 0) === 2, `feet above the box's top (y -60 - 7 < -58.5): no event (${W.eventFlags[0] | 0})`); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
