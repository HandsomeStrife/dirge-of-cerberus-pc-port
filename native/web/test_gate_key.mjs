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
// Gate 2 (trigger 152, script 199): it asks manager short 65. Key 2's pickup (placed record 50, script 200 event 0x47) sets it, flags 63 = 7, 50 = 1, global 58 + 1. T: short 65 0 in r05_key2, 1 in r05_key3, global 58 = 2 there
function mkG() { const player = { pos: [-1305, 0, 851], hp: 780, id: 0x16, f118: 0, s64: 0 }, gflags = new Uint8Array(64);
  const items = createItems({ data: itemsData, warn: () => {} });
  const W = initWorld(o => createEnemyAI({ data, player, items, globalFlags: () => gflags, quiet: true, log: () => {}, ...o }), { flags: {}, frame: 24, clock: {}, loadRecs: [] });
  W.tick(1.2, player.pos, player.pos); return { W, player, items, gflags }; }
const pressAt = (w, k, O) => { w.W.triggers[k].active = true; const c = w.W.gimmickChoose(O, [0, 0, 1]); ok(c && c.o === w.W.triggers[k], `✕ chooses trigger ${k}`); if (c) w.W.gimmickUse(c); w.W.tick(1.2, w.player.pos, w.player.pos); };
{ const w = mkG(), inv = w.items.inventory; inv.add(KEY, 1);
  pressAt(w, 152, [-1305, -7, 851]);
  ok(inv.count(KEY) === 1, `gate 2, short 65 = 0: refused, the key stays (${inv.count(KEY)})`);
  const o = w.items.list.find(x => x.rec === 50);
  ok(o && o.script === 200, `key 2 is placed record 50, script 200 (${o && o.script})`);
  ok(!!data.scripts['200'] && !!data.scripts['245'] && !!data.scripts['256'], 'ai.json has the placed items\' scripts 200, 245, 256');
  w.W.runEvent(o, 0x47);
  ok(w.W.mshort[65] === 1, `key 2's event 0x47: short 65 = 1 (${w.W.mshort[65]})`);
  ok((w.W.eventFlags[63] | 0) === 7 && (w.W.eventFlags[50] | 0) === 1, `flags 63 = 7, 50 = 1 (${w.W.eventFlags[63] | 0}, ${w.W.eventFlags[50] | 0})`);
  ok(w.gflags[58] === 1, `global 58 + 1 (${w.gflags[58]})`);
  pressAt(w, 152, [-1305, -7, 851]);
  ok(inv.count(KEY) === 0, `gate 2, short 65 = 1: takes the key (${inv.count(KEY)})`); }
// read commands: 0x176 / 0x177, 0xa1, 0x186 / 0x188, 0xa, 9 through the VM's send, as scripts see them
{ const w = mkG(), { W, player, gflags } = w, S = (o, c, r = [0, 0, 0, 0]) => W.t.send(o, -2, c, r), rec = W.objects.get(72 + 22), T = W.triggers[166];
  ok(S(rec, 0x176) === 0 && S(rec, 0x177) === 1, 'idle record: 0x176 0, 0x177 1');
  W.setActive(rec, 1); const a = W.objects.get(72 + 22);
  ok(S(a, 0x176) === 1 && S(a, 0x177) === 0, 'active soldier: 0x176 1, 0x177 0');
  ok(W.t.send(null, -2, 0xa1, [72, 0, 0, 0]) === 1, 'cmd 0xa1 record 72 alive: 1');
  a.hp = 0; ok(W.t.send(null, -2, 0xa1, [72, 0, 0, 0]) === 0, 'cmd 0xa1 record 72 dead: 0');
  ok(W.t.send(null, -2, 0xa1, [255, 0, 0, 0]) === 0, 'cmd 0xa1 no such record: 0');
  player.pos = [-990, -0.06, 444]; ok(S(T, 0x186) === 1, 'trigger 166: Vincent in the box (feet, 7 up): 0x186 1');
  player.pos = [-1100, -0.06, 444]; ok(S(T, 0x186) === 0, 'trigger 166: Vincent away: 0');
  ok(W.t.send(null, -2, 9, [58, 3, 0, 0]) === 0 && gflags[58] === 3 && W.t.send(null, -2, 0xa, [58, 0, 0, 0]) === 3, 'cmd 9 writes global 58, 0xa reads it');
  player.hp = 0; W.t.send(null, -2, 9, [58, 9, 0, 0]); ok(gflags[58] === 3, 'cmd 9 refused with Vincent finally dead (as cmd 0xb)'); }
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
