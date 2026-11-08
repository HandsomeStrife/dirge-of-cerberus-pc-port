// worker 0269: the EM barriers (g048, class 8, vt 0x58c630; props.js) and FUN_0035a440's object pass (obj_contact.js).
//  1. objectPass against the game's FUN_0035a440 out (trace w269_bar2: r03_mid2, Vincent into barrier 57's face and round
//     its end; gitignored, skipped without it).
//  2. A walk into barrier 56 stops on its face (r + half-depth from the centre: T r03_mid2 z -355.67), and through it once
//     it is off.
//  3. Gate 1 (trigger 153, script 202 event 0x11) with the card: cmd 0x18e to records 56 / 57 -> state 2 (still a wall,
//     asj_631), delayed code -5 after 36 ticks -> state 0 (no wall); without the card they stay on. Records 139 / 140 / 143
//     start off (section-15 +0x50 bit 0, FUN_0054fa48).
// Run: node test_barrier.mjs
import { readFileSync, existsSync } from 'node:fs';
import { createEnemyAI } from './enemy_ai.js';
import { createItems } from './items.js';
import { createProps } from './props.js';
import { initWorld } from './checkpoint.js';
import { objectPass } from './obj_contact.js';
import { cylinderCross } from './enemy_hit.js';

const here = new URL('.', import.meta.url).pathname;
const data = JSON.parse(readFileSync(here + 'data/enemies/ai.json', 'utf8'));
const itemsData = JSON.parse(readFileSync(here + 'data/items/items.json', 'utf8'));
const propsData = JSON.parse(readFileSync(here + 'data/props/props.json', 'utf8'));
const KEY = 0x6b300001;
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

// 1. the trace
const TRACE = here + '../../tools/trace/out/w269_bar2.calls.jsonl';
if (!existsSync(TRACE)) console.log('skip  trace w269_bar2 missing (tools/trace/scripts/w269_bar2.json from route state r03_mid2)');
else {
  const objs = propsData.records.filter(r => r.model === 'g048').map(r => ({ half: propsData.types[r.type].size.map(v => Math.fround(v * 0.5)), m: r.m, f38: 0x72 }));
  const L = readFileSync(TRACE, 'utf8').trim().split('\n').slice(1).map(s => JSON.parse(s.replace(/\bNaN\b/g, 'null')));
  let pos = null, worst = 0, n = 0, hit = 0;
  for (const c of L) {
    if (c.a0 !== '0x919910') continue;                                    // Vincent's body (C+0x3b0)
    if (c.hook === 'body_step') { pos = c['a0+0x0'].f.slice(0, 3); continue; }
    if (c.hook !== 'push_out' || !pos) continue;
    const inn = c['a2+0x0'].f.slice(0, 3), out = c['a1+0x0'].f.slice(0, 3);
    const r = objectPass({ objs, pos, move: inn, air: false, cross: cylinderCross });
    worst = Math.max(worst, ...[0, 1, 2].map(i => Math.abs(r.out[i] - out[i])));
    n++; if (Math.abs(out[2] - inn[2]) > 1e-3) hit++;
  }
  ok(n > 90 && hit > 5 && worst < 1e-3, `FUN_0035a440 out = the game's over ${n} frames (${hit} against the barrier): worst ${worst.toExponential(2)} u`);
}

function mk() {
  const player = { pos: [-1732, 0, -356], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const items = createItems({ data: itemsData, warn: () => {} });
  const sounds = [];
  const slots = new Map(); let next = 1;                                // the hum's slots (play.js: ambient.js SlotStreams)
  const hum = { open: (n, p, v, o) => { const h = next++; slots.set(h, { n, p, ...o }); return h; }, close: h => slots.delete(h) };
  const props = createProps({ data: propsData, hum, warn: () => {} });
  const W = initWorld(o => createEnemyAI({ data, player, items, props, quiet: true, log: () => {}, sound: (n) => sounds.push(n), ...o }), { flags: {}, frame: 24, clock: {}, loadRecs: [] });
  props.areaSwitch(1, true); props.areaSwitch(88, true); props.areaSwitch(16, true);
  W.tick(1.2, player.pos, player.pos);
  return { W, player, items, props, sounds, slots };
}
const rec = (w, k) => w.props.barrels.find(o => o.rec === k);
const walls = w => w.props.blockers().map(b => b.id);

// 2. a walk into barrier 56 (centre z -345.7, half-depth 5): 1.187 u a frame toward +z, the pass's out added as the walk would
function walk(w, frames = 40) {
  let p = [-1752, -0.064, -362];             // the middle of 56 (x -1763 .. -1740)
  for (let i = 0; i < frames; i++) {
    const r = objectPass({ objs: w.props.blockers(), pos: p, move: [0, 0, 1.187], air: false, cross: cylinderCross });
    p = [p[0] + r.out[0], p[1], p[2] + r.out[2]];
  }
  return p;
}
{ const w = mk();
  const o = rec(w, 56);
  ok(o && o.st === 1 && (o.flags28 & 1) && o.f38 === 0x72 && (o.flags28 & 0x200000), `record 56 on: state ${o && o.st}, +0x38 0x${o && o.f38.toString(16)} (RAM 0x72), +0x28 bit 0x200000`);
  ok(walls(w).includes('p56') && walls(w).includes('p57'), `56 / 57 are walls (${walls(w).join(',')})`);
  const p = walk(w);
  // the step that would cross the face is taken out whole (out . S < 0 -> FUN_00260e28): he stops within one step of the face
  // r away (T w269_bar2 f36: from z -356.885 the game's out z is 0; r03_mid2 rests at -355.67)
  ok(p[2] <= -355.66 && p[2] > -355.67 - 1.19, `a walk into it stops in front of its face: z ${p[2].toFixed(3)} (face - r = -355.67, one step 1.187)`);
  // standing 0.1 u inside the r shell (no move: the nearest-point test): depth 0.1 < body+0xb8 - 4.8 = 0.2 -> eased to 0.1^2 / 0.2
  const e = objectPass({ objs: w.props.blockers(), pos: [-1752, -0.064, -355.57], move: [0, 0, 0], air: false, cross: cylinderCross });
  ok(Math.abs(e.out[2] + 0.0501) < 2e-4, `a shallow contact is eased: out z ${e.out[2].toFixed(4)} (hand: depth 0.1001 -> -0.0501; unease -0.1001)`);
  for (const k of [139, 140, 143]) { const b = rec(w, k); ok(b && b.st === 0 && !(b.f38 & 0x30), `record ${k} starts off (+0x50 bit 0): state ${b && b.st}`); }
}

// the hum (FUN_0054f918 / vt+0x214 FUN_0054f4b0): asj_620 from each lit barrier within 80 of Vincent, range 80, not fixed
{ const w = mk(); const hs = [...w.slots.values()];
  ok(hs.length === 2 && hs.every(h => h.n === 'asj_620' && h.range === 80 && h.fixed === false), `two hums by gate 1 (56, 57 within 80): ${JSON.stringify(hs.map(h => [h.n, h.range, h.fixed]))}`);
  w.player.pos[2] = -500; w.W.tick(1.2, w.player.pos, w.player.pos);
  ok(w.slots.size === 0, `Vincent 150 u away: they stop (${w.slots.size})`);
  w.player.pos[2] = -356; w.W.tick(1.2, w.player.pos, w.player.pos);
  ok(w.slots.size === 2, `back in range: they start again (${w.slots.size})`);
  w.props.cmd(rec(w, 56), 0x18e, []);
  ok(w.slots.size === 1, `56 switched off (state 2): its hum stops (${w.slots.size})`);
  w.W.tick(1.2, w.player.pos, w.player.pos);
  ok(w.slots.size === 1, `and stays off in state 2 (${w.slots.size})`); }

// 3. gate 1 with the card, through script 202 event 0x11
function press(w) {
  const c = w.W.gimmickChoose([-1732, -7, -356], [0, 0, 1]);
  if (c) w.W.gimmickUse(c);
  w.W.tick(1.2, w.player.pos, w.player.pos);
}
{ const w = mk(); w.W.objects.get(147 + 22).hp = 0; press(w);
  ok(rec(w, 56).st === 1 && walls(w).includes('p56'), `no card: barrier 56 stays on (state ${rec(w, 56).st})`); }
{ const w = mk(); w.items.inventory.add(KEY, 1); w.W.objects.get(147 + 22).hp = 0; press(w);
  ok(rec(w, 56).st === 2 && rec(w, 57).st === 2, `the card: 0x18e -> 56 / 57 state 2 (${rec(w, 56).st}, ${rec(w, 57).st})`);
  ok(w.sounds.includes('asj_631'), `asj_631 at the switch-off (${w.sounds.filter(s => s.startsWith('asj_6')).join(',')})`);
  ok(walls(w).includes('p56'), 'state 2 still blocks (+0x38 0x70 kept until code -5)');
  let t = 0; while (rec(w, 56).st === 2 && t < 60) { w.W.tick(1.2, w.player.pos, w.player.pos); t++; }
  ok(rec(w, 56).st === 0 && Math.abs(t * 1.2 - 36) <= 1.2, `code -5 after 36 ticks: state 0 after ${t} frames (${(t * 1.2).toFixed(1)} ticks)`);
  ok(!walls(w).includes('p56') && !walls(w).includes('p57'), `off: no longer walls (${walls(w).join(',')})`);
  const p = walk(w, 30);
  ok(p[2] > -340, `the walk goes through: z ${p[2].toFixed(2)}`);
  // 0x18f (scripts 272 / 281): on again, asj_630
  w.props.cmd(rec(w, 56), 0x18f, []);
  ok(rec(w, 56).st === 1 && walls(w).includes('p56') && w.sounds.includes('asj_630'), `0x18f: on again, asj_630 (state ${rec(w, 56).st})`);
}
// 4. the beams' emitter matrices (FUN_002e80e0 via props.js modelAttach): r03_mid2 RAM, the 8 emitters 0x90c00000..3 of records
//    56 / 57 (+0xe0 row 3; rows 0-2 identity): hand constants read from the save state
{
  const FX = await import('./effects.js');
  const rd = n => { const b = readFileSync(here + 'data/effects/' + n); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
  const g = existsSync(here + 'data/effects/g048.fed') && existsSync(here + 'data/props/g048.json');
  if (!g) console.log('skip  data/effects/g048.fed or data/props/g048.json missing (export_web_effects.py, build_web.sh props step)');
  else {
    const { modelAttach } = await import('./props.js');
    const bind = JSON.parse(readFileSync(here + 'data/props/g048.json', 'utf8')).joints.bind_world_colmajor;
    const fx = FX.createEffects({ fed: rd('r0001.fed'), core: rd('core_ef.bin'), warn: () => {}, rng: new FX.EffectRng(1), models: [rd('g048.fed')] });
    const RAM = { 56: [[-1760.328, -0.063, -345.67], [-1754.328, -0.063, -345.67], [-1748.729, -0.063, -345.67], [-1742.729, -0.063, -345.67]],
                  57: [[-1737.294, 0.0, -345.698], [-1731.294, 0.0, -345.698], [-1725.694, 0.0, -345.698], [-1719.694, 0.0, -345.698]] };
    const w = mk(); let worst = 0, rot = 0;
    const ems = [];
    for (const k of [56, 57]) for (let i = 0; i < 4; i++) ems.push([k, i, fx.spawn(0x90c00000 + i, [0, 0, 0], null, modelAttach(rec(w, k), bind))]);
    fx.update(1.2); fx.update(1.2);
    for (const [k, i, em] of ems) {
      const m = em.m; worst = Math.max(worst, ...[0, 1, 2].map(j => Math.abs(m[12 + j] - RAM[k][i][j])));
      rot = Math.max(rot, Math.abs(m[0] - 1), Math.abs(m[5] - 1), Math.abs(m[10] - 1), Math.abs(m[1]), Math.abs(m[4]));
    }
    ok(ems.every(e => e[2] && !e[2].noDraw) && worst < 2e-3 && rot < 1e-5, `the beams' emitter matrices = RAM (r03_mid2): row 3 worst ${worst.toExponential(2)}, rotation ${rot.toExponential(2)}`);
    ok(ems.every(e => e[2].flags & 4), 'held after their first tick (descriptor +10 = 1: +2 |= 4)');
  }
}
// 2b. a soldier (e027: body 0x280036, r 5 / h 9) and the dog (e030: 0x2400b6, r 6 / h 6) walk into barrier 56 (enemy_ai walkBody ->
//     FUN_0035a440's object pass before FUN_00357d48; a flat stand-in floor for the walk mesh): stopped on its face, r away
{ const floor = { locate: () => [0], navMove: (poly, x, y, z, dx, dz) => [x + dx, y, z + dz, 0, false, false], polys: [{ flags: 0 }], wall45: false };
  const player = { pos: [-1700, 0, -400], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const items = createItems({ data: itemsData, warn: () => {} });
  const props = createProps({ data: propsData, warn: () => {} });
  const W = initWorld(o => createEnemyAI({ data, player, items, props, walkMesh: floor, quiet: true, log: () => {}, ...o }), { flags: {}, frame: 24, clock: {}, loadRecs: [] });
  props.areaSwitch(1, true);
  for (const [model, r] of [['e027', 5], ['e030', 6]]) {
    const a = W.actors.find(q => q.model === model) || (model === 'e030' ? W.addActor({ rec: 64 }) : null);   // dog 64 (record 64, e030)
    if (!a) { ok(false, `no ${model} actor in the world`); continue; }
    a.pos = [-1752, -0.064, -362]; const B = W.bodyOf(a); B.state = 0; B.poly = 0;
    for (let i = 0; i < 30; i++) a.pos = W.walkBody(a, [0, 0, 1.0]);
    ok(a.pos[2] <= -345.67 - 5 - r + 0.01 && a.pos[2] > -345.67 - 5 - r - 1.01, `${model} walking into 56 stops r = ${r} in front of its face: z ${a.pos[2].toFixed(3)}`);
  }
}

// 4. FUN_0054f358 sends a barrier's other commands to FUN_00588b78, not the barrel's FUN_00586520: the barrel's cases are not its own
{ const w = mk(), b = rec(w, 56), hp0 = b.hp;
  const res = [0x14a, 0x130, 0x138, 0x1a3, 0x172, 0x173, 0x174, 0x175].map(c => w.props.cmd(b, c, [5]));
  ok(res.every(v => v === undefined) && b.hp === hp0 && (b.flags28 & 1), `the barrel's cases are skipped for a barrier (${JSON.stringify(res)}, HP ${b.hp}, still on)`); }

// 2d. the sizes as the game computes them (FUN_003561c8: r below 6.4 else 6.4, h0 / 2): an e048 (27 records) takes the pass too; and a
//     dog in the air (airBody, FUN_003577c8: the centre r / 2 lower) leaping into 56
{ const floor = { locate: () => [0], navMove: (poly, x, y, z, dx, dz) => [x + dx, y, z + dz, 0, false, false], polys: [{ flags: 0 }], wall45: false };
  const player = { pos: [-1700, 0, -400], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const items = createItems({ data: itemsData, warn: () => {} });
  const props = createProps({ data: propsData, warn: () => {} });
  const W = initWorld(o => createEnemyAI({ data, player, items, props, walkMesh: floor, quiet: true, log: () => {}, ...o }), { flags: {}, frame: 24, clock: {}, loadRecs: [] });
  props.areaSwitch(1, true);
  const big = W.actors.find(q => q.model === 'e048') || W.addActor({ rec: data.records.findIndex(r => r && r.model === 'e048') });
  { const r = Math.min(big.size.r, 6.4); big.pos = [-1752, -0.064, -372]; const B = W.bodyOf(big); B.state = 0; B.poly = 0;
    for (let i = 0; i < 40; i++) big.pos = W.walkBody(big, [0, 0, 1.0]);
    ok(big.pos[2] <= -350.67 - r + 0.01 && big.pos[2] > -350.67 - r - 1.01, `e048 (size r ${big.size.r}: body r ${r}) stops r in front of 56: z ${big.pos[2].toFixed(3)}`); }
  { big.size = { r: 7.5, h: 28, h0: 28 };                                   // a zone set with r 7.5 (ai.json sizes 5): FUN_003561c8 caps it at 6.4
    big.pos = [-1752, -0.064, -372]; const B = W.bodyOf(big); B.state = 0; B.poly = 0;
    for (let i = 0; i < 40; i++) big.pos = W.walkBody(big, [0, 0, 1.0]);
    ok(big.pos[2] <= -350.67 - 6.4 + 0.01 && big.pos[2] > -350.67 - 6.4 - 1.01, `size r 7.5: the body radius is capped at 6.4: z ${big.pos[2].toFixed(3)}`); }
  { const soldier = W.actors.find(q => q.model === 'e027');                // +0xbc = h0 / 2 = 9: the head point 15.5 up meets an overhang at 14..20
    const keep = props.blockers;
    props.blockers = () => [{ half: [50, 3, 5], m: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, -17, 15, 1]], f38: 0x72 }];
    soldier.pos = [0, 0, 8]; const B = W.bodyOf(soldier); B.state = 0; B.poly = 0;
    const p0 = soldier.pos[2]; soldier.pos = W.walkBody(soldier, [0, 0, 0]);
    props.blockers = keep;
    ok(Math.abs(soldier.pos[2] - (p0 - 2.5)) < 1e-3, `a soldier under an overhang: its head test (h = h0 / 2 = 9) pushes 2.5: z ${soldier.pos[2].toFixed(3)}`); }
  const dog = W.actors.find(q => q.model === 'e030') || W.addActor({ rec: 64 });
  { const r = Math.min(dog.size.r, 6.4); dog.pos = [-1752, -2, -366]; const B = W.bodyOf(dog);
    Object.assign(B, { state: 2, poly: 0, y0: -2, dy: 0, v0: 0, t: 0, g: 0, rise: 99, gy: -0.064 });   // in the air, not landing (rise), no fall
    for (let i = 0; i < 20; i++) dog.pos = W.walkBody(dog, [0, 0, 1.0]);
    ok(B.state === 2 && dog.pos[2] <= -350.67 - r + 0.01 && dog.pos[2] > -350.67 - r - 1.01, `a dog in the air (r ${r}) is stopped by 56: z ${dog.pos[2].toFixed(3)} (state ${B.state})`); }
}

// 2c. the pass's C+0x1c0 bits on a soldier pathing into lit barrier 56 (FUN_0035a440 l.1264-1373) and action layer 2's answer
//     (FUN_00366390: 0x100000 -> stop; 0x80000 for 0x3c ticks -> stop, state 3). The bits clear each frame (moveStart).
{ const floor = { locate: () => [0], navMove: (poly, x, y, z, dx, dz) => [x + dx, y, z + dz, 0, false, false], polys: [{ flags: 0 }], wall45: false };
  const player = { pos: [-1700, 0, -400], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const items = createItems({ data: itemsData, warn: () => {} });
  const props = createProps({ data: propsData, warn: () => {} });
  const W = initWorld(o => createEnemyAI({ data, player, items, props, walkMesh: floor, quiet: true, log: () => {}, ...o }), { flags: {}, frame: 24, clock: {}, loadRecs: [] });
  props.areaSwitch(1, true);
  const a = W.actors.find(q => q.model === 'e027'), C = a.C, ai = a.ai;
  const into = (face, steps) => { a.pos = [-1752, -0.064, -361]; a.face = face; const B = W.bodyOf(a); B.state = 0; B.poly = 0;
    for (let i = 0; i < steps; i++) { C.f1c0 = (C.f1c0 & 0xffe3fbff) >>> 0; a.pos = W.walkBody(a, [0, 0, 1.0]); } };
  // facing the barrier (row 2 (0, 0, 1)): the push opposes the move and the normal opposes the facing
  into([0, 0, 1], 12);
  ok((C.f1c0 & 0x100000) && (C.f1c0 & 0x80000) && (C.f1c0 & 0x40000) && (C.f1c0 & 0x400) && C.fbc === 4,
    `facing it: C+0x1c0 0x100000 / 0x80000 / 0x40000 / 0x400 set, C+0xbc = 4 (0x${C.f1c0.toString(16)}, ${C.fbc})`);
  a.f118 = (a.f118 | 2) >>> 0; a.target = W.player;                         // a live target (FUN_0035eda0: owner +0x118 bit 1)
  ai.flags = (ai.flags | 0) & ~2;                                           // out of view
  ai.astate28 = 1; C.mover = 3; ai.atime = W.S.now;
  W.action2(ai);
  ok(ai.astate28 === 0 && C.mover === 0, `action layer 2 on 0x100000: stop, state 0 (state ${ai.astate28}, mover ${C.mover})`);
  // side-on (facing +x): the normal no longer opposes the facing (no 0x100000), the push still opposes the move (0x80000): state 1 -> 2,
  // then after 0x3c ticks the path is given up
  into([1, 0, 0], 12);
  ok(!(C.f1c0 & 0x100000) && (C.f1c0 & 0x80000), `side-on: 0x80000 without 0x100000 (0x${C.f1c0.toString(16)})`);
  ai.astate28 = 1; C.mover = 3; ai.atime = W.S.now; W.action2(ai);
  const s2 = ai.astate28; W.S.now += 0x3c; W.action2(ai);
  ok(s2 === 2 && ai.astate28 === 3 && C.mover === 0, `side-on: state 1 -> 2, after 0x3c ticks stop and state 3 (${s2} -> ${ai.astate28}, mover ${C.mover})`);
  // walking away: no bits
  into([0, 0, -1], 1); a.pos = [-1752, -0.064, -357]; C.f1c0 = (C.f1c0 & 0xffe3fbff) >>> 0; a.pos = W.walkBody(a, [0, 0, -1.0]);
  ok(!(C.f1c0 & 0x1c0000), `walking away from it: no bits (0x${C.f1c0.toString(16)})`);
}

// 5. hand cases of FUN_0035a440's object pass (obj_contact.js) on made-up boxes (rows identity, row 3 the centre; Vincent's r 5 / h 9;
//    -y up: a box at height k above the feet has y = -k). Each value worked out from the decode in the module's comments.
{
  const box = (c, half) => ({ half, m: [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [c[0], c[1], c[2], 1]], f38: 0x72 });
  const run = (objs, pos, move, air = false, push = null) => objectPass({ objs, pos, move, air, push, cross: cylinderCross });
  const near = (a, b, e = 2e-3) => a.every((x, i) => Math.abs(x - b[i]) < e);
  const wallZ = box([0, -30, 15], [50, 30, 5]);                         // a face at z = 10, heights 0..60
  // stuck inside (deeper than r): a box 20 deep (faces z 10 / 30), the centre at z 19: nearest face -z, 9 away; r - 9 <= 0 -> vt+0x194
  // inside -> depth = r + 9 = 14 (only r - 9 = -4 without that branch: no push)
  { const thick = box([0, -20, 20], [50, 40, 10]);                     // heights -20..60: the z face is the nearest
    const r = run([thick], [0, -0.064, 19], [0, 0, 0]);
    ok(r.applied && near(r.out, [0, 0, -14]), `inside the box (vt+0x194): pushed out by r + 9 = 14 along the nearest face: ${r.out.map(v => v.toFixed(3))}`); }
  // the air lowering: a kerb at heights 0..2.8 (face z 10), the body 1.5 u in front. Ground centre 8 up (r + 3): d to the kerb's top
  // edge |(5.2, 1.5)| = 5.41, none; air centre 7.5 up (r + r / 2): d = |(4.7, 1.5)| = 4.93, depth 0.066 eased to 0.0219, levelled
  { const kerb = box([0, -1.4, 15], [50, 1.4, 5]);
    const g = run([kerb], [0, 0, 8.5], [0, 0, 0], false), a = run([kerb], [0, 0, 8.5], [0, 0, 0], true);
    ok(!g.applied && a.applied && a.out[2] < -0.01 && a.out[2] > -0.04, `the lowering: in the air the kerb touches (out z ${a.out[2].toFixed(4)}), on the ground it does not (${g.applied})`); }
  // the head test (iStack_124 == 0, on the ground): an overhang at heights 14..20, face z 10, the body at z 8. The body sphere misses
  // (|(6, 2)| = 6.3); the head point (15.5 up) is 2.5 from the overhang's nearest point to the new centre -> a push of 2.5, levelled
  { const over = box([0, -17, 15], [50, 3, 5]);
    const r = run([over], [0, 0, 8], [0, 0, 0]);
    ok(r.applied && near(r.out, [0, 0, -2.5]), `the head test pushes when the body sphere does not: ${r.out.map(v => v.toFixed(3))}`); }
  // two boxes: a corner of faces z = 10 and x = 10, the body at (8, 8): each pushes 3 (r - 2); the mean (-1.5, 0, -1.5) at the longest
  // length 3 -> (-2.121, 0, -2.121)
  { const wallX = box([15, -30, 0], [5, 30, 50]);
    const r = run([wallZ, wallX], [8, 0, 8], [0, 0, 0]);
    ok(r.applied && near(r.out, [-2.1213, 0, -2.1213]), `two walls: the mean push at the longest one's length: ${r.out.map(v => v.toFixed(4))}`); }
  // the air levelling (FUN_003577c8): in the air the correction is made level, its length kept; here the actor push (1, 1, 1) alone
  { const far = box([0, -30, 500], [5, 5, 5]);
    const a = run([far], [0, 0, 0], [0, 0, 0], true, [1, 1, 1]), g = run([far], [0, 0, 0], [0, 0, 0], false, [1, 1, 1]);
    ok(near(a.out, [1.2247, 0, 1.2247]) && near(g.out, [1, 1, 1]), `the air levels the correction (${a.out.map(v => v.toFixed(4))}), the ground does not (${g.out.map(v => v.toFixed(4))})`); }
}

// 6. a Restart (a new world: FUN_00548348 rebuilds the barriers from the stage file; a scene_save record holds flags, not objects):
//    gate 1's barriers, opened, come back lit. No save falls before an opened gate on the way on (notes: saves 2-5 are past it).
{ const w = mk(); w.items.inventory.add(KEY, 1); w.W.objects.get(147 + 22).hp = 0; press(w);
  for (let t = 0; t < 40; t++) w.W.tick(1.2, w.player.pos, w.player.pos);
  const before = rec(w, 56).st;
  const w2 = mk();
  ok(before === 0 && rec(w2, 56).st === 1 && walls(w2).includes('p56'), `a rebuilt world: 56 lit again (was ${before}, now ${rec(w2, 56).st})`); }

// 7. a script's delete (cmd 0x10a -> FUN_0053e1e0 -> vt+0x1c FUN_0054f230 -> FUN_0054fa18): the barrier's beams and hum go
{ const w = mk();
  const removed = [], fx = { attached: (id) => ({ id }), remove: em => removed.push(em.id), softEnd: () => {} };
  const p2 = createProps({ data: propsData, effect: fx, models: { g048: { joints: { bind_world_colmajor: [] } } }, hum: { open: () => 7, close: h => removed.push('hum' + h) }, warn: () => {} });
  const w3 = initWorld(o => createEnemyAI({ data, player: w.player, items: w.items, props: p2, quiet: true, log: () => {}, ...o }), { flags: {}, frame: 24, clock: {}, loadRecs: [] });
  p2.areaSwitch(19, true);                                              // 70 / 71 / 88 / 89 wait for 0x108 (record +0x48 bit 2)
  const b = p2.barrels.find(o => o.rec === 56); p2.areaSwitch(1, true);
  ok(b.ems.length === 4, `56 lit: 4 beam emitters (${b.ems.length})`);
  p2.deleted(b);
  ok(b.ems.length === 0 && removed.filter(x => typeof x === 'number').length === 4 && removed.includes('hum7'), `deleted: its 4 emitters removed at once and its hum stopped (${JSON.stringify(removed)})`); }

console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
