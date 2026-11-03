// Item pickups and drops (items.js in enemy_ai's world; notes/items-research.md) against the PCSX2 traces (tools/trace/out,
// game-derived, gitignored; TRACE_FIELDSET=items TRACE_ITEMS=13cec0):
//   w224_item22  w220_box's run into the placed item of section-15 record 22 (item 0x69300000)
//   w224_drop    from route state r02_barrier (soldier 45 dead, his drop 0x62300000 x 36 on the floor), stick forward
//   node --import ./native/web/test_hooks.mjs native/web/test_items.mjs
// Vincent's traced positions drive the world's tick (enemy_ai: 1a = FUN_00573c60's sweep); checked: the frame of each
// take, the inventory counts, zone flag 2 (script 246 event 0x3a: 7 for record 22, 8 for record 45's drop through cmd
// 0x1a4), the delete (+0x28 bit 0x80000) and +200 bit 4. Without traces: the stage-start set, the models, the drop
// rules (fixed / none / the RNG table), the effect 0x4800, the full-inventory refusal, the fall's settled speed and the
// spin / colour of the r02_barrier save RAM.
// MUTATE_ITEMS / MUTATE_AI = paths of mutated copies of items.js / enemy_ai.js.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const OUT = process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out');
const imp = (env, rel) => import(process.env[env] ? pathToFileURL(path.resolve(process.env[env])).href : './' + rel);
const I = await imp('MUTATE_ITEMS', 'items.js');
const { createEnemyAI } = await imp('MUTATE_AI', 'enemy_ai.js');
const { Areas } = await imp('MUTATE_AREAS', 'areas.js');
const SAVE_POS = [-1395.151611328125, -98.64443969726562, -1111.014892578125];   // Vincent C+0x30 in the save (areas.js)
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
const STEP = 1.1999999284744263;

const D = p => path.join(here, 'data', p);
const need = [D('enemies/ai.json'), D('items/items.json')];
if (need.some(p => !existsSync(p))) { console.log('SKIP: ' + need.filter(p => !existsSync(p)).join(', ') + ' missing (tools/byo/build_web.sh)'); done(); }
const json = p => JSON.parse(readFileSync(p, 'utf8'));
const aiData = json(D('enemies/ai.json'));

function world({ inv = null, pos = [0, 0, 0], rng = null, camera = null } = {}) {
  const data = json(D('items/items.json'));
  const fx = [], snd = [], warns = [], hud = [];
  const areas = new Areas(aiData.areas);
  const items = I.createItems({ data, warn: m => warns.push(m), effect: { spawn: (id, p) => fx.push({ id, p: p.slice() }) },
    camera, hud: m => hud.push(m), ground: null, areas });
  if (inv) items.inventory.slots = inv.map(e => e.slice());
  const ammo = { inv: items.inventory.count(I.AMMO_ID) - I.AMMO_OTHER_LOADED };
  items.inventory.ammo = ammo;
  const P = { pos: pos.slice(), face: [1, 0, 0], hp: 780, id: 0x16, f118: 0x20209, s64: 0 };
  const ai = createEnemyAI({ data: aiData, player: P, quiet: true, log: () => {}, items, damage: 0,
    rand: rng || undefined, sound: (n, p) => snd.push(n) });
  // the first frame's area switch at the save position (play.js: areas.frame -> onSwitch -> items.areaSwitch)
  areas.onSwitch = items.areaSwitch; areas.frame(SAVE_POS);
  return { ai, items, areas, P, fx, snd, warns, hud, ammo, data };
}
const flag = (ai, n) => ai.eventFlags[n] ?? 0;

// ---------------------------------------------------------------- stage start, models (no trace)
{
  const { items, ai } = world();
  const on = items.list.filter(o => o.f28 & 1).map(o => o.rec);
  ok(JSON.stringify(on) === '[22,24,26,27,28,123,141]', `stage start: active placed items [${on}] (the save RAM: 22 24 26 27 28 123 141)`);
  const o = items.list.find(x => x.rec === 22);
  ok(o.itemId === 0x69300000 && o.count === 1 && o.mdl && o.mdl.name === json(D('items/items.json')).models[1], 'record 22: item 0x69300000 x 1, the placed model (table index 1, FUN_0057f6f8 +200 bit 3)');
  ok((o.f200 & 8) && o.ce === 1, `record 22: +200 bit 3, +0xce = taken bit 1 (got ${o.ce})`);
  ok(ai.t.send(ai.objects.get(o.id), -1, 0x3e, [22, 0, 0, 0]) === o.id, 'cmd 0x3e(22) = record 22\'s object (manager +0x5b2)');
  ok(Object.keys(ai.eventFlags).every(k => !ai.eventFlags[k]), 'the save\'s zone flags are all 0 (SAVE_EVENT_FLAGS, w224_item22 record 180)');
}
{
  const M = json(D('items/items.json')).models;
  const mk = (id, f200 = 0) => I.modelIndex({ itemId: id, f200 }, json(D('items/items.json')).items[id.toString(16)]);
  ok(M[mk(0x62300000)] === M[5] && M[mk(0x62300001)] === M[7] && M[mk(0x62300002)] === M[6], 'FUN_0057f6f8: dropped ammo 0x62300000 / 1 / 2 -> table 5 / 7 / 6');
  ok(mk(0x69300000) === 0 && mk(0x67300000) === 2 && mk(0x6b300001) === 4 && mk(0x69300000, 8) === 1, 'FUN_0057f6f8: kind 2 -> 0, kind 4 -> 2, 0x6b300001 -> 4, placed -> 1');
}

// ---------------------------------------------------------------- drops (FUN_0055cac8 -> FUN_00316d70)
{
  let draws = 0;
  const { ai, items, fx } = world({ rng: () => { draws++; return 0.5; } });
  const a45 = { rec: 45, pos: [-951.52, -160.39, -1084.89], C: { f1c0: 0x200 }, f118: 0x10000200 };
  const d = items.drop(a45);
  ok(d && d.itemId === 0x62300000 && d.count === 36, `record 45 (status bit 23): fixed drop 0x62300000 x 36 (got ${d && d.itemId.toString(16)} x ${d && d.count})`);
  ok(draws === 1, `record 45: one RNG draw (FUN_00541688's yaw only; got ${draws})`);
  ok(d && d.ca === 45 && (d.f200 & 4) && ai.t.send(d, d.id, 0x1a4, [0, 0, 0, 0]) === 45, 'the drop: +200 bit 2, cmd 0x1a4 -> +0xca = 45 (FUN_00580d38)');
  ok(fx.length === 1 && fx[0].id === 0x4800, 'the drop spawns effect 0x4800 at its place (FUN_00580410)');
  ok(d && d.mdl && Math.abs(d.mdl.pos[1] - (d.pos[1] - 10)) < 1e-4, 'the dropped model starts 10 above its place (FUN_00580388)');
  draws = 0;
  ok(items.drop({ rec: 44, pos: [0, 0, 0], C: { f1c0: 0x200 } }) === null && draws === 0, 'record 44 (status bit 18): no drop, no draw');
  ok(items.drop({ rec: 45, flags28: 4, pos: [0, 0, 0], C: { f1c0: 0x200 } }) === null && draws === 0, 'actor +0x28 bit 2 (FUN_0055cac8): no drop, no draw');
  ok(items.drop({ rec: 151, pos: [0, 0, 0], C: { f1c0: 0x200 } }) === null && draws === 0, 'record 151 (status bit 18, chance 0): no drop, no draw (every record exported)');
  // record 53: chance 60, table (0x62300000 36 w60, 0x69300000 1 w30, 0x67300000 w10); the RNG decides
  const seq = v => { let k = 0; return () => v[k++] ?? 0; };
  const w2 = world({ rng: seq([0.1, 0.65, 0]) });
  const d2 = w2.items.drop({ rec: 53, pos: [0, 0, 0], C: { f1c0: 0x200 } });
  ok(d2 && d2.itemId === 0x69300000, `record 53, draws 0.1 / 0.65: (10 < 60) then 65 in [60, 90) -> 0x69300000 (got ${d2 && d2.itemId.toString(16)})`);
  const w3 = world({ rng: seq([0.7, 0.1, 0]) });
  ok(w3.items.drop({ rec: 53, pos: [0, 0, 0], C: { f1c0: 0x200 } }) === null, 'record 53, draw 0.7: 70 >= 60 -> no drop');
}

// ---------------------------------------------------------------- a kill drops (enemy_ai enemyDeath -> items.drop)
{
  const { ai, items, fx } = world();
  const a = ai.addActor({ id: 67, rec: 45, pos: [-953.9, -160.4, -1084.8], face: [1, 0, 0], hp: 1, mode: 0 });
  {
    a.hp = 1;
    ai.blast.actor(a, { owner: -1, dmg: 9999, kind: 1, flags: 8 }, a.pos.slice(), [1, 0, 0]);
    const d = items.list.find(o => o.ca === 45);
    ok(a.hp === 0 && d && d.itemId === 0x62300000 && fx.some(e => e.id === 0x4800), `killing record 45 drops 0x62300000 x 36 with effect 0x4800 (got ${d ? d.itemId.toString(16) : 'none'})`);
  }
}

// ---------------------------------------------------------------- the fall settles, the spin / colour (save RAM r02_barrier)
{
  // a camera 50 units away (screen size 7 x 256 / (50 x 0.7467) = 48 >= 5: the spin runs)
  const { items, ai } = world({ camera: () => ({ pos: [-951.52, -160.39, -1034.89], tanHalf: 0.7467 }) });
  const d = items.drop({ rec: 45, pos: [-951.52, -160.39, -1084.89], C: { f1c0: 0x200 } });
  for (let i = 0; i < 200; i++) ai.tick(STEP, null, null);
  ok(Math.abs(d.mdl.vy - (-0.0461)) < 2e-4 && d.mdl.pos[1] === d.pos[1], `the fall settles on the place, +0xd8 ${d.mdl.vy.toFixed(4)} (save RAM -0.0461)`);
  // r02_barrier: frame 5954, +0xdc 3862 -> t 2091 (the update ran before the frame counter's step): colour 0xd4, row 0 (-0.493, 0, 0.87)
  const w = ai.S.frame;
  d.mdl.dc = w + I.FRAME0 - 2091;
  items.update(STEP);
  ok(d.mdl.col === 0xd4, `colour (table[2091 & 31] + 100) = 0x${d.mdl.col.toString(16)} (save RAM 0xd4)`);
  ok(Math.abs(Math.cos(d.mdl.yaw) - (-0.493)) < 2e-3 && Math.abs(-Math.sin(d.mdl.yaw) - 0.87) < 2e-3, `spin angle ${d.mdl.yaw.toFixed(4)}: row 0 (cos, -sin) = (${Math.cos(d.mdl.yaw).toFixed(3)}, ${(-Math.sin(d.mdl.yaw)).toFixed(3)}) (save RAM -0.493, 0.87)`);
}

// ---------------------------------------------------------------- full inventory (FUN_0031f0f0)
{
  const { items, P, snd, data } = world({ inv: [[0x69300000, 4], [I.AMMO_ID, 225]] });
  const o = items.list.find(x => x.rec === 22);
  P.pos = [o.pos[0], o.pos[1] + 7, o.pos[2]];
  const r = items.t.touch(o, [o.pos[0], o.pos[1], o.pos[2]], [o.pos[0] + 20, o.pos[1], o.pos[2]]);
  ok(r === 1 && items.inventory.count(0x69300000) === 4 && !(o.f28 & 0x80000) && (o.f200 & 0x10), 'item 0x69300000 at its max 4: refused, kept, +200 bit 4 set');
  ok(Math.abs(o.mdl.vy - (-1.1)) < 1e-6 && snd.includes(data.sounds.full), 'refused: the hop -1.1 (FUN_00580438) and the 0x58d938 sound');
}

// ---------------------------------------------------------------- the pickup window (FUN_00580730) and the sweep (FUN_00573c60)
{
  const { items, ai, P } = world();
  const o = items.list.find(x => x.rec === 22), [x, y, z] = o.pos;
  const at = dy => items.t.inRange(o, [x + 7.9, y + dy, z]);
  ok(at(4.9) && !at(5) && at(-17.9) && !at(-18) && !items.t.inRange(o, [x + 8, y, z]), 'FUN_00580730: xz < 8, -18 < dy < 5');
  // feet 11.9 below the item's place: swept point 4.9 below -> taken; 12 below: 5 -> not
  const w1 = world(), o1 = w1.items.list.find(q => q.rec === 22);
  w1.items.sweep([o1.pos[0], o1.pos[1] + 12, o1.pos[2]], [o1.pos[0] + 30, o1.pos[1] + 12, o1.pos[2]]);
  const w2 = world(), o2 = w2.items.list.find(q => q.rec === 22);
  w2.items.sweep([o2.pos[0], o2.pos[1] + 11.9, o2.pos[2]], [o2.pos[0] + 30, o2.pos[1] + 11.9, o2.pos[2]]);
  ok(w1.items.inventory.count(0x69300000) === 2 && w2.items.inventory.count(0x69300000) === 3, 'the sweep lifts both ends 7: feet 12 below the place -> not taken, 11.9 -> taken');
}
// ---------------------------------------------------------------- the inventory (FUN_0031e940)
{
  const inv = new I.Inventory(json(D('items/items.json')).items, [[0x69300000, 3]]);
  ok(inv.add(0x69300000, 2) === 0 && inv.count(0x69300000) === 4, 'a stack adds up to its max (3 + 2 -> 4)');
  ok(inv.add(0x69300000, 1) === -1 && inv.count(0x69300000) === 4, 'at its max: -1, unchanged');
}
// ---------------------------------------------------------------- the latch (+200 bit 4): no second take while inside
{
  const { items, snd, data } = world({ inv: [[0x69300000, 4], [I.AMMO_ID, 225]] });
  const o = items.list.find(x => x.rec === 22), p = o.pos.slice();
  items.t.touch(o, p, [p[0] + 20, p[1], p[2]]);
  const n = snd.filter(x => x === data.sounds.full).length;
  const r = items.t.touch(o, [p[0] + 1, p[1], p[2]], p);
  ok(r === 0 && snd.filter(x => x === data.sounds.full).length === n, 'still inside after a refusal: no second take (FUN_00580870 bit 4)');
  items.t.touch(o, [p[0] + 1, p[1], p[2]], [p[0] + 20, p[1], p[2]]);
  ok(!(o.f200 & 0x10), 'from outside into the window with the bit set: it clears (the next frame takes again)');
}

// ---------------------------------------------------------------- the Restart (review): a new Ammo, the checkpoint's inventory
{
  const data = json(D('items/items.json'));
  const areas = new Areas(aiData.areas);
  const items = I.createItems({ data, warn: () => {}, effect: null, areas });
  areas.onSwitch = items.areaSwitch;
  let cur = { inv: 198 };                               // aim_core START_AMMO: 180 + 18
  items.inventory.ammo = () => cur;                     // read live (play.js)
  const P = { pos: [0, 0, 0], face: [1, 0, 0], hp: 780, id: 0x16, f118: 0x20209, s64: 0 };
  let ai = createEnemyAI({ data: aiData, player: P, quiet: true, log: () => {}, items, damage: 0 });
  areas.frame(SAVE_POS);
  const o = items.list.find(x => x.rec === 22);
  items.sweep([o.pos[0], o.pos[1] + 7, o.pos[2]], [o.pos[0] + 30, o.pos[1] + 7, o.pos[2]]);
  ai.tick(STEP, null, null);
  ok(items.inventory.count(0x69300000) === 3 && items.taken.has(1) && items.inventory.count(I.AMMO_ID) === 225, 'before the Restart: record 22 taken (count 3, taken bit 1), ammo item 225');
  // the Restart: aim_core's reset makes a new Ammo (START_AMMO), play.js rebuildEnemies calls items.restart() then the new world
  cur = { inv: 198 };
  items.restart();
  areas.reset();                                        // play.js rebuildEnemies (worker 0223)
  ai = createEnemyAI({ data: aiData, player: P, quiet: true, log: () => {}, items, damage: 0 });
  areas.frame(SAVE_POS);
  ok(items.inventory.count(0x69300000) === 2 && items.inventory.count(I.AMMO_ID) === 234 && items.list.some(x => x.rec === 22),
     `after the Restart: 0x69300000 x ${items.inventory.count(0x69300000)} (2), ammo item ${items.inventory.count(I.AMMO_ID)} (234), record 22 back (reload state f3984)`);
  const d = items.drop({ rec: 45, pos: [-951.52, -160.39, -1084.89], C: { f1c0: 0x200 } });
  items.sweep([d.pos[0], d.pos[1] + 7, d.pos[2]], [d.pos[0] + 30, d.pos[1] + 7, d.pos[2]]);
  ok(cur.inv === 198 + 36 && items.inventory.count(I.AMMO_ID) === 270, `after the Restart an ammo pickup reaches the new Ammo (inv ${cur.inv}, count ${items.inventory.count(I.AMMO_ID)})`);
}

// ---------------------------------------------------------------- traces
function trace(name) {
  const p = path.join(OUT, name + '.jsonl');
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.frame != null).map(r => {
    const inv = Buffer.from(r.inv, 'hex'), ev = Buffer.from(r.evt_flags, 'hex'), ky = Buffer.from(r.evt_key, 'hex'), it = Buffer.from(r.it0, 'hex');
    const m = r.matrix, pos = Array.isArray(m[0]) ? m[3].slice(0, 3) : m.slice(12, 15);
    return { frame: r.frame, pos, inv: [0, 1, 2].map(k => [inv.readUInt32LE(12 * k), inv.readInt32LE(12 * k + 4)]),
      flag2: ev[2] ^ ky[2], f28: it.readUInt32LE(8), f200: it.readUInt16LE(200 - 0x20) };
  });
}
function replay(T, w, key) {
  let got = null;
  for (let i = 1; i < T.length; i++) {
    const before = w.items.inventory.count(key);
    w.P.pos = T[i].pos.slice();
    w.ai.tick(STEP, T[i - 1].pos.slice(), T[i].pos.slice());
    if (got === null && w.items.inventory.count(key) !== before) got = { i, frame: T[i].frame, n: w.items.inventory.count(key) };
  }
  return got;
}
{
  const T = trace('w224_item22');
  if (!T) console.log('SKIP w224_item22: tools/trace/out/w224_item22.jsonl missing');
  else {
    const gi = T.findIndex(r => r.inv[0][1] === 3);
    const w = world({ inv: [[0x69300000, 2], [I.AMMO_ID, 225], [0x62300001, 0]] });
    const got = replay(T, w, 0x69300000);
    ok(gi > 0 && T[gi].frame === 205 && T[gi].flag2 === 7, `trace: item 0x69300000 2 -> 3 and flag 2 = 7 at record ${T[gi].frame}`);
    ok(got && got.frame === T[gi].frame && got.n === 3, `page: taken at record ${got && got.frame} (game ${T[gi].frame}), count ${got && got.n}`);
    ok(flag(w.ai, 2) === 7, `page: zone flag 2 = ${flag(w.ai, 2)} after the take (script 246 event 0x3a; game 7)`);
    const o = w.items.list.find(x => x.rec === 22);
    ok(!o && w.items.taken.has(1), 'page: record 22 deleted (FUN_0053fa08 -> FUN_0053e1e0) and its taken bit 1 set');
    ok((T[gi].f28 & 0x80000) && (T[gi].f200 & 0x10), `trace: +0x28 bit 0x80000 (0x${T[gi].f28.toString(16)}), +200 bit 4 (0x${T[gi].f200.toString(16)})`);
  }
}
{
  const T = trace('w224_drop');
  if (!T) console.log('SKIP w224_drop: tools/trace/out/w224_drop.jsonl missing');
  else {
    const gi = T.findIndex(r => r.inv[1][1] !== T[0].inv[1][1]);
    const w = world({ inv: T[0].inv.map(e => e.slice()) });
    w.items.taken.add(1);                                 // record 22 was taken in the route
    // the drop as the state holds it (object 0x13cec0: +0x90, +200 0x4, +0xca 45)
    const d = w.items.drop({ rec: 45, pos: [-951.52, -160.39, -1084.89], C: { f1c0: 0x200 } });
    w.ammo.inv -= 10;                                     // ten rounds shot before (the binding follows aim_core's count)
    const ammo0 = w.ammo.inv;
    const got = replay(T, w, I.AMMO_ID);
    ok(w.items.inventory.count(I.AMMO_ID) === T[gi].inv[1][1] - 10, `page: the inventory count follows aim_core's Ammo (${w.items.inventory.count(I.AMMO_ID)})`);
    ok(gi > 0 && T[gi].inv[1][1] - T[0].inv[1][1] === 36 && T[gi].flag2 === 8, `trace: ammo ${T[0].inv[1][1]} -> ${T[gi].inv[1][1]} and flag 2 = ${T[gi].flag2} at record ${T[gi].frame}`);
    ok(got && got.frame === T[gi].frame && got.n === T[gi].inv[1][1] - 10, `page: taken at record ${got && got.frame} (game ${T[gi].frame}), count ${got && got.n}`);
    ok(w.ammo.inv - ammo0 === 36, `page: aim_core's Ammo.inv +${w.ammo.inv - ammo0} (the reserve the HUD shows)`);
    ok(flag(w.ai, 2) === 8, `page: zone flag 2 = ${flag(w.ai, 2)} (script 246: cmd 0x1a4 to the item = 45 -> 8)`);
    ok(w.hud.includes(0x6e), 'page: the HUD refresh mask 0x6e (FUN_005740c0)');
    ok(d.gone, 'page: the drop deleted');
  }
}
done();
