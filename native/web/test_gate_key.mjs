// worker 0264: a card gate takes the key, through its real script on the real inventory. The whole-level run pressed ✕ six times at gates 1 and 2 with a key in hand: manager cmd 0x33 was
// skipped (returned 0), so every gate read no key. FUN_00545b20 case 0x33 (count), 0x32 (take); script 202 event 0x11 (gate 1, trigger 153): soldier 147 dead (0xa2) and a key -> take it (r1 -1 = all),
// stage flag 63 = 1, the box and record 149 go; else message 293. Route state r03_key2 has the key, r04_east is past the gate. Run: node test_gate_key.mjs
import { readFileSync } from 'node:fs';
import { createEnemyAI } from './enemy_ai.js';
import { createItems } from './items.js';
import { initWorld } from './checkpoint.js';

const here = new URL('.', import.meta.url).pathname;
const data = JSON.parse(readFileSync(here + 'data/enemies/ai.json', 'utf8'));
const itemsData = JSON.parse(readFileSync(here + 'data/items/items.json', 'utf8'));
const KEY = 0x6b300001;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
function mk() {
  const player = { pos: [-1732, 0, -356], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const items = createItems({ data: itemsData, warn: () => {} });
  const W = initWorld(o => createEnemyAI({ data, player, items, quiet: true, log: () => {}, ...o }), { flags: {}, frame: 24, clock: {}, loadRecs: [] });
  W.tick(1.2, player.pos, player.pos);
  return { W, player, items };
}
// the page's ✕ in the gate's box: the choice with feet + 7 up as origin (actions/ladder.js), then FUN_005516f0
function press(w) {
  const c = w.W.gimmickChoose([-1732, -7, -356], [0, 0, 1]);
  ok(c && c.o === w.W.triggers[153], `✕ in the box chooses trigger 153 (${c && c.o.id})`);
  if (c) w.W.gimmickUse(c);
  w.W.tick(1.2, w.player.pos, w.player.pos);
}
const dead147 = w => { const o = w.W.objects.get(147 + 22); o.hp = 0; };

{ const w = mk(); const n0 = w.items.inventory.count(KEY);
  ok(n0 === 0, `no key at the start (${n0})`);
  dead147(w); press(w);
  ok((w.W.eventFlags[63] | 0) !== 1 && w.W.triggers[153].active !== false, `no key: refused (flag 63 = ${w.W.eventFlags[63] | 0})`); }
{ const w = mk(); w.items.inventory.add(KEY, 1);
  ok(w.items.inventory.count(KEY) === 1, 'a key in hand');
  press(w);
  ok(w.items.inventory.count(KEY) === 1, `147 alive: the key stays (0xa2 false) (${w.items.inventory.count(KEY)})`); }
{ const w = mk(); w.items.inventory.add(KEY, 1); dead147(w); press(w);
  ok(w.items.inventory.count(KEY) === 0, `147 dead, a key: taken (0x32 r1 -1) (${w.items.inventory.count(KEY)})`);
  ok((w.W.eventFlags[63] | 0) === 1, `stage flag 63 = 1 (${w.W.eventFlags[63] | 0})`); }
{ const w = mk(); const inv = w.items.inventory; inv.add(KEY, 3); dead147(w); press(w);
  ok(inv.count(KEY) === 0, `r1 -1 takes them all (3 -> ${inv.count(KEY)})`); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
