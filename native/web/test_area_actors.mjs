// worker 0251: the actors' area switch (enemy_ai areaSwitch = FUN_0055a0d8 via areas.js onSwitch; FUN_00547ce0's parent
// area = record +0x3e). Checked against the game's RAM in route states (active actors = object +0x28 bit 0, ENEMY_VT):
//   r02_deckend (-885.0, -137.5, -932.0) and r02_climb (-860.1, -142.1, -607.1): 46-54 and 66 active;
//   r03_spot2 (-1507.3, -0.06, -573.5): 50-54 and 66 active, 46-49 off; 57 / 61-64: no object (script 0 ev 0x22, normal).
// (41-43 / 45 are dead on that route; 50 / 51 / 66 come from triggers / script 0, not areas.) Run: node test_area_actors.mjs
import { readFileSync } from 'node:fs';
import { createEnemyAI } from './enemy_ai.js';
import { initWorld } from './checkpoint.js';
import { Areas } from './areas.js';

const here = new URL('.', import.meta.url).pathname;
const data = JSON.parse(readFileSync(here + 'data/enemies/ai.json', 'utf8'));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

ok(data.records[52].area === 0 && data.records[52].ov5 === 0 && data.records[46].area === 2 && data.records[50].ov5 === 1,
  'ai.json records carry area / ov5 (52: area 0 bit 5 clear; 46: area 2; 50: bit 5 set)');

function world() {
  const player = { pos: [-1395, -99, -1110], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const W = initWorld(o => createEnemyAI({ data, player, quiet: true, log: () => {}, ...o }), { flags: {}, frame: 24, clock: {}, loadRecs: [41, 42, 43] });
  W.tick(1.2, player.pos, player.pos);               // the first manager frame drains the init's queued deletes (57, 61-64)
  const A = new Areas(data.areas);
  const sw = [];
  A.onSwitch = (k, on) => { sw.push([k, on]); W.areaSwitch(k, on); };
  return { W, A, sw };
}
const active = (W, r) => { const o = W.objects.get(r + 22); return !!o && !!(o.flags28 & 1); };
const list = (W, rs) => rs.filter(r => active(W, r));

// areas only (no world tick, so no trigger volumes): the switch alone drives these records
{
  const { W, A } = world();
  A.frame([-1395, -99, -1110]);                       // the save's spot: 105 / 2 / 15 on
  ok(list(W, [46, 47, 48, 49]).length === 4, 'start: area 2 on -> 46-49 active');
  ok(list(W, [41, 42, 43, 45]).length === 4, 'start: area 105 on -> 41-43 / 45 active');
  ok(list(W, [52, 53, 54]).length === 0, 'start: area 0 off -> 52-54 not active');
  A.frame([-885.0, -137.5, -932.0]);                   // r02_deckend
  ok(list(W, [52, 53, 54]).length === 3, 'r02_deckend: area 0 on -> 52-54 active (game RAM: active)');
  ok(W.actors.some(a => a.rec === 52) && W.events.some(e => e === 'event 74 script 40 ev 3 r 0,0,0,0'), 'r02_deckend: 52 built as an actor with script event 3 (vt+0x144(1, 1))');
  A.frame([-860.09, -142.12, -607.09]);                // r02_climb
  ok(list(W, [46, 47, 48, 49, 52, 53, 54]).length === 7, 'r02_climb: 46-49 and 52-54 active (game RAM)');
  A.frame([-1300, 0, -600]); A.frame([-1507.3, -0.06, -573.5]);   // r03_spot2
  ok(list(W, [46, 47, 48, 49]).length === 0, 'r03_spot2: area 2 off -> 46-49 off (game RAM)');
  ok(list(W, [52, 53, 54]).length === 3, 'r03_spot2: area 0 still on (87\'s neighbour) -> 52-54 active (game RAM)');
  ok(!W.objects.has(62 + 22) && !W.objects.has(63 + 22), '62 / 63 (area 53, deleted at stage init): skipped, no object');
  ok(!active(W, 59) && !active(W, 60), 'bit-5 actors 59 / 60 (area 53 on): left alone');
}
// a dead actor stays off when its area comes back (FUN_00559748: status dead)
{
  const { W, A } = world();
  A.frame([-860.09, -142.12, -607.09]);
  const a = W.actors.find(x => x.rec === 52);
  a.hp = 0;
  A.frame([-1395, -99, -1110]);                        // area 0 off
  ok(!active(W, 52), 'area 0 off -> 52 deactivated');
  A.frame([-860.09, -142.12, -607.09]);
  ok(!active(W, 52), 'area 0 on again -> dead 52 stays off');
  ok(active(W, 53), '... while 53 comes back');
}
// a soldier switched off stands where he was when he comes back, with his HP and facing (FUN_00559748's off path leaves +0x60..+0x9c,
// FUN_00588270 -> FUN_00588430 builds the body from them; T: route RAM below). 46 is off at r03_spot2 at the +0x90 and row 2 it had
// at r02_climb, not the placement.
{
  const { W, A } = world();
  A.frame([-860.09, -142.12, -607.09]);
  const a = W.actors.find(x => x.rec === 46);
  a.pos = [-835.85, -148.89, -936.55]; a.face = [-0.07, 0, 1.0]; a.hp = 77;
  A.frame([-1300, 0, -600]); A.frame([-1507.3, -0.06, -573.5]);
  const off = W.objects.get(46 + 22);
  ok(off.kind === 'record' && off.p90[0] === -835.85, `46 off: +0x90 kept (${off.p90})`);
  A.frame([-860.09, -142.12, -607.09]);
  const b = W.actors.find(x => x.rec === 46);
  ok(b && b !== a && b.pos[0] === -835.85 && b.pos[2] === -936.55 && b.face[0] === -0.07 && b.face[2] === 1.0, `46 back: a new actor at ${b && b.pos}, facing ${b && b.face} (not the placement ${data.records[46].pos})`);
  ok(b && b.hp === 77, `46 back: HP ${b && b.hp} (77)`);
  ok(b && b.C.t2b0[0] === Math.fround(-835.85 - 0.07), `46 back: no turn queued (C+0x2b0 = facing + position, ${b && b.C.t2b0})`);
  // a second round: the move survives a new off / on
  b.pos = [-840, -148, -930];
  A.frame([-1300, 0, -600]); A.frame([-1507.3, -0.06, -573.5]); A.frame([-860.09, -142.12, -607.09]);
  const c = W.actors.find(x => x.rec === 46);
  ok(c && c.pos[0] === -840 && c.pos[2] === -930, `46 again: at ${c && c.pos}`);
}
// a record moved while off (cmd 0x10e) is built there, and keeps that through an off / on
{
  const { W } = world();
  const t = W.objects.get(46 + 22);
  W.setActive(t, 1, 1);
  W.setActive(W.objects.get(46 + 22), 0, 1);
  const r = W.objects.get(46 + 22);
  r.p90 = [-800, -140, -800]; r.p90set = true; r.face80 = null;
  W.setActive(r, 1, 1);
  const a = W.objects.get(46 + 22);
  ok(a.kind === 'actor' && a.pos[0] === -800 && a.face[0] === data.records[46].face[0], `moved record built at ${a.pos}, placement facing`);
  W.setActive(a, 0, 1);
  W.setActive(W.objects.get(46 + 22), 1, 1);
  ok(W.objects.get(46 + 22).pos[0] === -800, 'the move survives an off / on');
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
