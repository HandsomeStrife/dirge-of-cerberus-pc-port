// Stage areas (areas.js, worker 0223; notes/npc-research.md "Areas"): FUN_00542920 / FUN_00543f28 / FUN_0054f0d8
// against two PCSX2 RAM states. Run: node native/web/test_areas.mjs (needs data/enemies/ai.json with `areas`).
//   AREAS_JS=path  test another copy of areas.js (mutation checks)
import assert from 'assert';
import path from 'path';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { Areas } = await import(pathToFileURL(process.env.AREAS_JS || path.join(here, 'areas.js')).href);
const aiPath = path.join(here, 'data/enemies/ai.json');
if (!existsSync(aiPath)) { console.log('SKIP: data/enemies/ai.json missing (run tools/byo/build_web.sh)'); process.exit(0); }
const ai = JSON.parse(readFileSync(aiPath, 'utf8'));
if (!ai.areas) { console.log('FAIL: ai.json has no areas (re-export data/enemies: export_web_triggers.py)'); process.exit(1); }

let fails = 0;
const check = (name, fn) => { try { fn(); console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '-', e.message); } };
const onList = A => [...A.on].sort((a, b) => a - b);

// sea-of-flames.p2s: Vincent C+0x30 (-1395.15, -98.64, -1111.01); manager +0x14 = 105, area objects (vt 0x58c308) with
// +0x28 bit 0: 105 (id 2), 2 (id 3), 15 (id 7); the other 17 clear
const START = [-1395.151611328125, -98.64443969726562, -1111.014892578125];
check('save: current 105, on 2 / 15 / 105', () => {
  const A = new Areas(ai.areas);
  A.frame(START);
  assert.strictEqual(A.cur, 105);
  assert.deepStrictEqual(onList(A), [2, 15, 105]);
  A.frame(START);
  assert.strictEqual(A.changes, 1, 'no switch while the current area holds him');
});

// w223_npc96 (PCSX2 state at frame 120, Vincent's position copies poked to (-1511.6, -10, -1094) at load): manager
// +0x14 = 15; on: 15 (id 7), 105 (id 2), 53 (id 6); 2 (id 3) switched off; 87 / 1 / 6 off
check('poke into area 15: on 15 / 53 / 105, 2 off', () => {
  const A = new Areas(ai.areas);
  A.frame(START);
  A.frame([-1511.5999755859375, -10.0, -1094.0]);
  assert.strictEqual(A.cur, 15);
  assert.deepStrictEqual(onList(A), [15, 53, 105]);
});

// FUN_00542920's order (decoded): the current area first, then its neighbours in +0xa4 order, then the list
check('neighbour before list; outside every area -> none, all off', () => {
  const A = new Areas(ai.areas);
  A.frame(START);
  A.frame([-1511.6, -10.0, -1094.0]);
  assert.strictEqual(A.cur, 15);
  A.frame([1e6, 0, 1e6]);
  assert.strictEqual(A.cur, -1);
  assert.deepStrictEqual(onList(A), []);
});

// hand cases (boxes from the stage file, list order from the save's RAM: manager +0x1118 = the section-11 records in order)
check('stays in the current area while it holds him, even inside a neighbour (105 / 15 overlap)', () => {
  const A = new Areas(ai.areas);
  A.frame(START); A.frame([-1423, -84, -1125]);
  assert.strictEqual(A.cur, 105);
  assert.deepStrictEqual(onList(A), [2, 15, 105]);
});
check('a jump to a non-neighbour (87): the old area and its neighbours go off', () => {
  const A = new Areas(ai.areas);
  A.frame(START); A.frame([-1221, -121, -583]);
  assert.strictEqual(A.cur, 87);
  assert.deepStrictEqual(onList(A), [0, 6, 53, 87]);
});
check('list fallback: the last area of the list that holds him (87 / 6 overlap -> 6)', () => {
  const A = new Areas(ai.areas);
  A.frame(START); A.frame([-1519, -45, -521]);
  assert.strictEqual(A.cur, 6);
  assert.deepStrictEqual(onList(A), [6, 87, 88]);
});

check('the box test is the record box (+0x30 + lo .. +0x30 + hi), edges inclusive', () => {
  const A = new Areas(ai.areas);
  const a = A.byIdx.get(105);
  assert.ok(A.contains(a, a.bmin) && A.contains(a, a.bmax));
  assert.ok(!A.contains(a, [a.bmin[0] - 0.01, a.bmin[1], a.bmin[2]]));
  assert.ok(!A.contains(a, [a.bmin[0], a.bmax[1] + 0.01, a.bmin[2]]));
});

// FUN_0054ef68 calls the children only on a change, in FUN_00543f28's order (offs, then ons): 105 -> 15 switches off 2
// and on 53; 105 and 15 stay on and their children hear nothing
check('onSwitch: only the changes, offs before ons', () => {
  const A = new Areas(ai.areas), calls = [];
  A.frame(START);
  A.onSwitch = (k, on) => calls.push([k, on]);
  A.frame([-1511.5999755859375, -10.0, -1094.0]);
  assert.deepStrictEqual(calls, [[2, false], [53, true]]);
  calls.length = 0; A.reset(); A.frame(START);
  assert.deepStrictEqual(calls, [[105, true], [2, true], [15, true]], 'after reset (the Restart): the start set again, current first');
});

// the placed sounds as area children (ambient.js stageStart / areaSwitch): no parent -> on at the stage start; parented ->
// with their area, unless record +0xa4 bit 17 (FUN_00550ad8: records 27, 29-33 of area 13 stay off)
const ambPath = path.join(here, 'data/audio/ambient_z128.json');
if (existsSync(ambPath)) {
  const { PlacedSounds } = await import(pathToFileURL(process.env.AMBIENT_JS || path.join(here, 'ambient.js')).href);
  check('placed sounds follow their area; +0xa4 bit 17 ones do not', () => {
    const P = new PlacedSounds(JSON.parse(readFileSync(ambPath, 'utf8')), {});
    const A = new Areas(ai.areas);
    P.stageStart(k => A.has(k));
    const on = idx => P.objs.find(e => e.o.idx === idx).on;
    assert.ok(P.objs.filter(e => e.o.actor < 0).every(e => e.on), 'no parent: on');
    assert.ok(!on(28) && !on(0) && !on(27), 'parented: off before their area');
    A.onSwitch = (k, v) => P.areaSwitch(k, v);
    A.frame(START);
    assert.ok(on(28), 'record 28 (area 105) on with area 105');
    P.areaSwitch(13, true);
    assert.ok([27, 29, 30, 31, 32, 33].every(i => !on(i)), 'area 13 on: its bit-17 records stay off');
  });
}

console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
