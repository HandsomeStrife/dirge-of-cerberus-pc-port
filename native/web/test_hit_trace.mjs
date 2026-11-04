// test_hit_trace.mjs (worker 0259): FUN_0055c7f8 + FUN_00565480 on the page's actors against the game's, hit for hit. T: TRACE_HIT with a target (tools/trace/trace.py;
// the same two calls, no FUN_0055d390, so C+0x590's area stays 0): w259_hit_npc (route r02_npcfire: 114 and 113), w259_hit_soldier (soldiers 69 / 70, flags 2, 4, 8, a kill).
// The numbers below are read from those traces (gitignored; the run compares against them when they're present).
//   node --import ./native/web/test_hooks.mjs native/web/test_hit_trace.mjs     (ENEMY_AI_JS=path: another enemy_ai.js copy)
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const AI = await import(pathToFileURL(process.env.ENEMY_AI_JS || path.join(here, 'enemy_ai.js')).href);
if (!existsSync(path.join(here, 'data/enemies/ai.json'))) { console.log('SKIP: data/enemies missing (run tools/byo/build_web.sh)'); process.exit(0); }
const data = JSON.parse(readFileSync(path.join(here, 'data/enemies/ai.json'), 'utf8'));
let fails = 0;
const KNOCKED = new Set([0x33, 0x34, 0x1b, 0x38, 0x39, 0x35, 0x3a, 0x37]);
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const ID = r => r + 22;
const trig = k => data.triggers.find(t => t.idx === k).m[3].slice(0, 3);
function wake() {
  const player = { pos: [-1395, -99, -1110], hp: 9999, id: 0x16, f118: 0, s64: 0 };
  const W = AI.createEnemyAI({ data, player, rand: () => 0.5, quiet: true, log: () => {}, deadRecs: [41, 42, 43] });
  const [x, y, z] = trig(96), a = [x - 40, y - 5, z], b = [x + 40, y - 5, z];
  player.pos = a; W.tick(1.2, a, a);
  player.pos = b; W.tick(1.2, a, b);                 // enters trigger 96: script 23
  for (let i = 0; i < 40; i++) W.tick(1.2, b, b);
  return { W, b };
}
const hit = (W, a, dmg, flags) => { const alive = !(a.hp <= 0); W.t.enemyHP(a, dmg); W.t.react(a, flags, [0, 0, 1], a.pos.slice(), alive ? 1 : 0); };

// 1. T w259_hit_npc: 114 HP 58: two 27s: no flinch, 'fear' stays. The third kills: dead1, state 7, +0x28 bit 0x400 clear; 113 (the partner) state 2 at once, 'rn' 2 frames on.
{
  const { W, b } = wake();
  const o114 = W.objects.get(ID(114)), o113 = W.objects.get(ID(113));
  ok(o114.hp === 58 && o113.hp === 55, `HP ${o114.hp} / ${o113.hp}`);
  const c0 = o114.C.clip;
  hit(W, o114, 27, 0); for (let i = 0; i < 70; i++) W.tick(1.2, b, b);
  ok(o114.hp === 31 && o114.C.clip === c0 && o114.astate !== 7, `114 at HP 31 keeps ${o114.C.clip} (T fear, no flinch)`);
  hit(W, o114, 27, 0); for (let i = 0; i < 70; i++) W.tick(1.2, b, b);
  ok(o114.hp === 4 && o114.C.clip === c0, `114 at HP 4 keeps ${o114.C.clip}`);
  hit(W, o114, 27, 0);
  W.tick(1.2, b, b);
  ok(o114.hp === 0 && o114.astate === 7 && o114.C.clip === 'dead1', `the kill: state ${o114.astate}, ${o114.C.clip} (T state 7, dead1)`);
  ok(!(o114.flags28 & 0x400), `+0x28 bit 0x400 clear (T 0x20c40b -> 0x20c00b): ${o114.flags28.toString(16)}`);
  for (let i = 0; i < 3; i++) W.tick(1.2, b, b);
  ok(o113.astate === 2 && o113.C.clip === 'rn', `113 runs: state ${o113.astate}, ${o113.C.clip} (T state 2, rn 2 frames after the kill)`);
  hit(W, o113, 27, 0); hit(W, o113, 40, 0); W.tick(1.2, b, b);
  ok(o113.hp === 0 && o113.astate === 7 && o113.C.clip === 'dead1', `113 killed on the run: state ${o113.astate}, ${o113.C.clip} (T state 7, dead1)`);
}
// 2. T w259_hit_soldier: a soldier in state 3 (r_st_a's row, stance 30: m_st_a)
{
  const { W, b } = wake();
  const a = W.objects.get(ID(69)), c = W.objects.get(ID(70));
  for (const s of [a, c]) { s.C.f1c0 |= 0x200; s.C.gun = 1; W.t.setActorState(s, 3); }
  for (let i = 0; i < 20; i++) W.tick(1.2, b, b);
  let after3 = null;
  const clipRun = (flagsWanted, state, n) => {
    const seen = [];
    for (let i = 0; i < n; i++) { const was = a.astate; W.tick(1.2, b, b); if (was === 0x18 && a.astate === 3) after3 = a.C.motion && a.C.motion.cls; const s = `${a.astate}/${a.C.clip}`; if (seen.at(-1)?.[0] !== s) seen.push([s, i + 1]); }
    return seen;
  };
  const hp0 = a.hp;
  hit(W, a, 1, 4);
  const s4 = clipRun(4, 0x18, 80);
  ok(a.hp === hp0 - 1, `flags 4: HP ${a.hp}`);
  ok(s4[0][0] === '24/m_stbd0', `flags 4: state 0x18, row 0x3e m_stbd0 (T f200; page ${s4[0][0]})`);
  const b3 = s4.find(x => x[0].startsWith('3/'));
  ok(b3 && Math.abs(b3[1] - 49) <= 1, `state 3 again after 49 frames (T f249; page ${b3 && b3[1]})`);
  const st = s4.find(x => x[0] === '3/m_st_a');
  ok(st && st[1] - b3[1] <= 1, `then m_st_a, the next frame (T f250; page ${st && st[1]})`);
  ok(!(a.C.f564 & 0x1c000), `C+0x564 bits 0x1c000 are gone with the class: ${a.C.f564.toString(16)}`);
  ok(after3 === 5, `state 0x18 -> 3: motion 5 (FUN_00539b48): class ${after3 && after3.toString(16)}`);
  // flags 2: T f120: m_stbd0 in state 3, 49 frames (FUN_00561570's flinch, row 0x25 at area 0)
  a.f144 = -1000;
  hit(W, a, 1, 2);
  const s2 = clipRun(2, 3, 60);
  ok(s2[0][0] === '3/m_stbd0', `flags 2: state 3 keeps, m_stbd0 (T f120; page ${s2[0][0]})`);
  const back = s2.find(x => x[0] === '3/m_st_a');
  ok(back && Math.abs(back[1] - 49) <= 2, `m_st_a after 49 frames (T f169; page ${back && back[1]})`);
  // the kill, flags 4: T f360: state 7, m_stbf0 (area 0 -> row 0x2b)
  hit(W, c, 999, 4); W.tick(1.2, b, b);
  ok(c.hp === 0 && c.astate === 7 && c.C.clip === 'm_stbf0', `flags 4 kill: state ${c.astate}, ${c.C.clip} (T state 7, m_stbf0)`);
}
// 2b. Class 0x3f's row is 0x3e, not the flinch's table (the two name one clip in these stances: the row is told apart with a marked copy)
{
  const { W, b } = wake();
  const a = W.objects.get(ID(69));
  a.C.f1c0 |= 0x200; W.t.setActorState(a, 3);
  a.C.rows = Object.assign([], a.C.rows || data.stances[String(data.records[69].stance)].motions); a.C.rows[0x3e] = 'm_stlad0';
  W.t.enemyHP(a, 1); W.t.react(a, 4, [0, 0, 1], a.pos.slice(), 1); W.tick(1.2, b, b);
  ok(a.C.clip === 'm_stlad0', `class 0x3f asks for row 0x3e (FUN_0059df28): ${a.C.clip}`);
}
// 3. T w259_hit_poly (route r02_walkway: soldiers with a walk polygon): the knock-down. A flat floor stands in for the collision (locate, navMove), so the height is the body's.
function floorWorld() {
  const FLOOR = -140.16;
  const walkCol = { locate: () => [0], polys: [{ flags: 0 }], wall45: false, navMove: (p, x, y, z, dx, dz, air) => [x + dx, FLOOR, z + dz, 0, 0, 0] };
  const pp = [0, FLOOR, 0];
  const player = { pos: pp.slice(), hp: 9999, id: 0x16, f118: 0, s64: 0 };
  const W = AI.createEnemyAI({ data, player, rand: () => 0.5, quiet: true, log: () => {}, deadRecs: [], walkMesh: walkCol });
  W.t.send(W.objects.get(ID(46)), -2, 0x108, [0, 0, 0, 0]);
  W.tick(1.2, pp, pp);
  const a = W.objects.get(ID(46));
  a.pos = [-913.14, FLOOR, -892.35]; a.face = [-0.73, 0, -0.68]; a.C.f1c0 |= 0x200; a.C.gun = 0;
  W.t.setActorState(a, 2);
  return { W, a, pp, FLOOR };
}
{
  // 46: flags 8, the hit from its front (face -z, dir +z): T f80 state 0xf
  const { W, a, pp, FLOOR } = floorWorld();
  W.t.enemyHP(a, 1); W.t.react(a, 8, [0, 0, 1], a.pos.slice(), 1);
  ok(a.astate === 0xf && a.C.motion.cls === 0x33, `flags 8, in front: state ${a.astate.toString(16)}, class ${a.C.motion.cls.toString(16)} (T state 0xf)`);
  const log = [], z0 = a.pos[2]; let peak = 0, zAt = {};
  for (let i = 1; i <= 210; i++) {
    W.tick(1.2, pp, pp);
    const s = `${a.astate}/${a.C.clip}`;
    if (log.at(-1)?.[0] !== s) log.push([s, i]);
    peak = Math.max(peak, FLOOR - a.pos[1]); zAt[i] = a.pos[2] - z0;
  }
  const at = n => (log.find(x => x[0] === n) || [null, null])[1];
  console.log('  ' + log.map(x => x.join('@')).join(' '));
  ok(at('15/r_stbl0') != null, 'r_stbl0 first (T f80)');
  ok(Math.abs(at('15/r_bl_0') - 14) <= 2, `r_bl_0 (T 14 frames on; page ${at('15/r_bl_0')})`);
  ok(Math.abs(at('17/r_bl_1') - 46) <= 3, `landed, state 0x11, r_bl_1 (T 46-47 frames on; page ${at('17/r_bl_1')})`);
  ok(Math.abs(at('2/r_rev_0') - 124) <= 4, `state 2, r_rev_0 (T 124 frames on; page ${at('2/r_rev_0')})`);
  ok(Math.abs(peak - 17) < 2, `the arc's top ${peak.toFixed(1)} u (T 16.8; rise DAT_004ef388[n])`);
  ok(Math.abs(zAt[1] - 5.2) < 0.6, `the first frame's move ${zAt[1].toFixed(2)} (T 5.21)`);
  ok(Math.abs(zAt[2] - zAt[1] - 0.59) < 0.05 && Math.abs(zAt[10] - zAt[9] - 0.6) < 0.02, `then 30 u/s: ${(zAt[2] - zAt[1]).toFixed(2)}, ${(zAt[10] - zAt[9]).toFixed(2)} a frame (T 0.59, 0.6)`);
  ok(Math.abs(zAt[46] - 30.4) < 3, `at the landing ${zAt[46].toFixed(1)} u (T 30.4)`);
  ok(Math.abs(a.face[2] + 1) < 0.02, `turned to face the hit: ${a.face.map(v => v.toFixed(2))} (T -0.0, -1.0)`);
}
{
  // 45: flags 8, from behind (face +z-ish, dir +z): T f160 state 0x10, r_jp_dm0, r_fl_0 27 on, state 0x11 r_fl_1 42 on, state 2 r_rev_0 66 on, r_gst 166 on
  const { W, a, pp } = floorWorld();
  a.face = [-1, 0, 0.03];
  W.t.enemyHP(a, 1); W.t.react(a, 8, [0, 0, 1], a.pos.slice(), 1);
  ok(a.astate === 0x10, `flags 8, within 130 deg: state ${a.astate.toString(16)} (T 0x10; face (-1, 0, 0.03), the hit +z)`);
  const log = [];
  for (let i = 1; i <= 190; i++) { W.tick(1.2, pp, pp); const s = `${a.astate}/${a.C.clip}`; if (log.at(-1)?.[0] !== s) log.push([s, i]); }
  const at = n => (log.find(x => x[0] === n) || [null, null])[1];
  console.log('  ' + log.map(x => x.join('@')).join(' '));
  ok(Math.abs(at('16/r_fl_0') - 27) <= 2, `r_fl_0 (T 27; page ${at('16/r_fl_0')})`);
  // the landing depends on the rise (FUN_0040b5c0's draw, not shared): T lands at 42 from a lower rise. What follows the landing doesn't:
  ok(at('17/r_fl_1') >= 38 && at('17/r_fl_1') <= 48, `state 0x11, r_fl_1 (T 42; page ${at('17/r_fl_1')}, its rise from rand 0.5)`);
  ok(Math.abs(at('2/r_rev_0') - at('17/r_fl_1') - 24) <= 1, `state 2, r_rev_0 after the landing (T 24-25; page ${at('2/r_rev_0') - at('17/r_fl_1')})`);
  ok(Math.abs(at('2/r_gst') - at('2/r_rev_0') - 100) <= 1, `r_gst after r_rev_0 (T 100; page ${at('2/r_gst') - at('2/r_rev_0')})`);
  // dead: T f360: state 0x10, r_jp_dm0, r_fl_0, state 0x11 r_fl_1, stays
}
{
  const { W, a, pp } = floorWorld();
  a.face = [-1, 0, 0.03];
  W.t.enemyHP(a, 999); W.t.react(a, 8, [0, 0, 1], a.pos.slice(), 1);
  for (let i = 1; i <= 200; i++) W.tick(1.2, pp, pp);
  ok(a.hp === 0 && a.astate === 0x11 && a.C.clip === 'r_fl_1', `flags 8, the kill: holds in state 0x11 ${a.C.clip} (T f407 on: r_fl_1, state 0x11)`);
}
{
  // a second knock within 15 ticks of the first does nothing (DAT_0046ed98)
  const { W, a, pp } = floorWorld();
  a.face = [-1, 0, 0.03];                                                     // state 0x10 (FUN_00565480 returns at state 0xf)
  W.t.react(a, 8, [0, 0, 1], a.pos.slice(), 1);
  W.tick(1.2, pp, pp);
  const was = a.astate, f164 = a.f164;
  W.t.react(a, 8, [0, 0, 1], a.pos.slice(), 1);
  ok(a.astate === was && a.f164 === f164 && a.C.slide.first === false, 'under 15 ticks: FUN_005618d0 returns 0 (no new mover, no new stamp)');
  for (let i = 0; i < 16; i++) W.tick(1.2, pp, pp);
  W.t.react(a, 8, [0, 0, 1], a.pos.slice(), 1);
  ok(a.C.slide.first === true, 'past 15 ticks a hit knocks him again (FUN_005618d0 off the ground, k 2)');
}
// 4. Hits during the reactions (FUN_00565480's branches, FUN_0055aa88 first)
{
  const hitF = (W, a, dmg, flags) => { W.t.enemyHP(a, dmg); W.t.react(a, flags, [0, 0, 1], a.pos.slice(), 1); };
  const run = (W, pp, n) => { for (let i = 0; i < n; i++) W.tick(1.2, pp, pp); };
  const frontKnock = () => { const w = floorWorld(); w.W.t.react(w.a, 8, [0, 0, 1], w.a.pos.slice(), 1); return w; };
  const backKnock = () => { const w = floorWorld(); w.a.face = [-1, 0, 0.03]; w.W.t.react(w.a, 8, [0, 0, 1], w.a.pos.slice(), 1); return w; };
  // the review's lock-out: flags 4 on a soldier lying in state 0x11
  {
    const { W, a, pp } = frontKnock();
    run(W, pp, 60);
    ok(a.astate === 0x11 && a.stance === 2, `lying: state ${a.astate.toString(16)}, stance ${a.stance} (FUN_00539458)`);
    hitF(W, a, 1, 4);
    ok(a.astate === 0x18 && a.C.motion.cls === 0x3f && a.stance === 0, `flags 4 lying: state 0x18, class 0x3f (FUN_005394d8's default), stance 0: ${a.astate.toString(16)} / ${a.C.motion.cls.toString(16)} / ${a.stance}`);
    run(W, pp, 3000);
    ok(a.astate !== 0x18 && a.astate !== 0x11 && !(a.C.f564 & 0xc000), `3000 ticks on he's up: state ${a.astate.toString(16)}, class ${a.C.motion && a.C.motion.cls.toString(16)}, C+0x564 ${a.C.f564.toString(16)}`);
  }
  // a live bullet lying: FUN_00561718 at stance 2: nothing happens to the class (same state), he gets up as before
  {
    const { W, a, pp } = frontKnock();
    run(W, pp, 60);
    a.f144 = -1000;
    const cls = a.C.motion.cls;
    hitF(W, a, 1, 2);
    ok(a.astate === 0x11 && a.C.motion.cls === cls, `flags 2 lying: state ${a.astate.toString(16)}, class ${a.C.motion.cls.toString(16)} unchanged`);
    run(W, pp, 3000);
    ok(a.astate !== 0x11, `and he still gets up: state ${a.astate.toString(16)}`);
  }
  // a live bullet (flags 2, stagger's 0x42) in the air: nothing
  for (const [name, mk] of [['0x10', backKnock], ['0xf', frontKnock]]) {
    const { W, a, pp } = mk();
    run(W, pp, 20);
    const st = a.astate, y = a.B.t, f164 = a.f164;
    hitF(W, a, 1, 0x42);
    ok(a.astate === st && a.f164 === f164 && a.B.t === y && a.C.slide.first === false, `a live bullet in state ${name}: no new knock-down (state ${a.astate.toString(16)})`);
  }
  {
    const { W, a } = floorWorld();
    W.t.setActorState(a, 8);
    const m0 = a.C.mover;
    W.t.react(a, 0x42, [0, 0, 1], a.pos.slice(), 1);                          // (react alone: record 46's script answers the damage itself)
    ok(a.astate === 8 && a.C.mover === m0, `a live bullet in state 8: nothing (state ${a.astate}, mover ${a.C.mover})`);
    W.t.setActorState(a, 0x21);
    W.t.react(a, 0x42, [0, 0, 1], a.pos.slice(), 1);
    ok(a.astate === 0x21 && a.C.mover === m0, `nor in state 0x21 (${a.astate.toString(16)})`);
  }
  // flags 8 / 4 in the air, alive: FUN_005618d0(a, dir, 0, 2): a fresh, low one, past the 15 ticks
  {
    const { W, a, pp } = frontKnock();
    run(W, pp, 20);
    ok(a.astate === 0xf, 'still in state 0xf');
    const f0 = a.f164;
    hitF(W, a, 1, 8);
    ok(a.f164 !== f0 && a.C.slide.first === true && a.C.mover === 10 && a.B.rise < 0.2, `flags 8 in state 0xf: k 2 (rise 4: ${a.B.rise.toFixed(3)} s; before the review: ignored)`);
  }
  // a kill in the air: FUN_00561270(a, dir, 0, 0) (k 0); k 2 from six air hits (DAT_0046ed9c)
  {
    const { W, a, pp } = frontKnock();
    run(W, pp, 20);
    a.f156 = 0;
    hitF(W, a, 999, 0);
    const k0 = a.C.slide.v;
    ok(a.hp === 0 && a.C.slide.first === true && Math.abs(k0 - (2 * 27.5 / 11.5 - 0.5)) < 0.01, `a kill in state 0xf: k 0, speed ${k0.toFixed(2)} (before the review: ignored)`);
  }
  {
    const { W, a, pp } = frontKnock();
    run(W, pp, 20);
    a.f156 = 5;
    hitF(W, a, 999, 0);
    ok(a.f156 === 6 && Math.abs(a.C.slide.v - (2 * 17.5 / 11.5 - 0.5)) < 0.01, `the sixth hit off the ground: k 2, speed ${a.C.slide.v.toFixed(2)} (DAT_0046ed9c)`);
  }
  // a re-hit during state 0x18 / class 0x3f: FUN_00562b30: C+0x564 bit 0x10000 -> motion 0x1e; he still comes out of 0x18
  {
    const { W, a, pp } = floorWorld();
    hitF(W, a, 1, 4);
    run(W, pp, 10);
    ok(a.astate === 0x18 && a.C.motion.cls === 0x3f, 'state 0x18, class 0x3f');
    hitF(W, a, 1, 4);
    ok(a.astate === 0x18 && a.C.motion.cls === 0x1e, `flags 4 again: class ${a.C.motion.cls.toString(16)} (FUN_00562b30)`);
    let n = 0;
    for (; n < 200 && a.C.motion.cls === 0x1e; n++) W.tick(1.2, pp, pp);
    ok(n < 200 && a.astate !== 0x18 && !(a.C.f564 & 0x1c000), `and out of it as the class ends (its event, FUN_00539b88; the brain isn't what frees him): frame ${n}, state ${a.astate.toString(16)}`);
  }
  // off the ground at state 0x18's end: FUN_00539b88 -> 0x10
  {
    const { W, a, pp } = floorWorld();
    hitF(W, a, 1, 4);
    run(W, pp, 3);
    a.C.f1c0 &= ~0x200; a.C.slide = null; a.C.mover = 0;
    run(W, pp, 3);
    ok(a.astate === 0x10 && a.C.motion.cls === 0x1b, `off the ground in state 0x18: state ${a.astate.toString(16)}, class ${a.C.motion.cls.toString(16)}`);
  }
  // FUN_00562898 with a polygon: the walk-mesh body takes the slide (a wall stops it); without one no slide, no turn (FUN_00562898's C+0x4c0 test)
  {
    const { W, a, pp } = floorWorld();
    const p0 = a.pos.slice(), f0 = a.face.slice();
    hitF(W, a, 1, 4);
    run(W, pp, 16);
    ok(Math.abs(a.pos[2] - p0[2] - 8) < 1.5 && a.face[2] < -0.9, `with a polygon: ${(a.pos[2] - p0[2]).toFixed(2)} u along the hit (FUN_003531e0(8, 12)), turned ${a.face.map(v => v.toFixed(2))}`);
    const { W: W2, b } = wake();
    const c = W2.objects.get(ID(69));
    c.C.f1c0 |= 0x200; W2.t.setActorState(c, 3);
    for (let i = 0; i < 5; i++) W2.tick(1.2, b, b);
    const p1 = c.pos.slice(), f1 = c.face.slice();
    W2.t.enemyHP(c, 1); W2.t.react(c, 4, [0, 0, 1], c.pos.slice(), 1);
    ok(c.astate === 0x18 && !c.C.kturn && c.C.mover !== 9 && !c.C.slide, `no polygon: state 0x18, no turn, no mover 9 (mover ${c.C.mover})`);
  }
  {
    const FLOOR = -140.16;
    const walkCol = { locate: () => [0], polys: [{ flags: 0 }], wall45: false, navMove: (p, x, y, z) => [x, FLOOR, z, 0, 0, 0] };   // a wall on every side
    const pp = [0, FLOOR, 0], player = { pos: pp.slice(), hp: 9999, id: 0x16, f118: 0, s64: 0 };
    const W = AI.createEnemyAI({ data, player, rand: () => 0.5, quiet: true, log: () => {}, deadRecs: [], walkMesh: walkCol });
    W.t.send(W.objects.get(ID(46)), -2, 0x108, [0, 0, 0, 0]); W.tick(1.2, pp, pp);
    const a = W.objects.get(ID(46));
    a.pos = [-913.14, FLOOR, -892.35]; a.face = [0, 0, -1]; a.C.f1c0 |= 0x200; a.C.gun = 0; W.t.setActorState(a, 2);
    for (const [name, fl, dmg] of [['big hit', 4, 1], ['knock-down', 8, 1], ['big death', 4, 999]]) {
      const z = a.pos[2];
      if (name === 'big death') { a.f164 = -1000; for (let i = 0; i < 400 && a.astate !== 2 && a.astate !== 3; i++) W.tick(1.2, pp, pp); }
      W.t.enemyHP(a, dmg); W.t.react(a, fl, [0, 0, 1], a.pos.slice(), 1);
      for (let i = 0; i < 40; i++) W.tick(1.2, pp, pp);
      ok(Math.abs(a.pos[2] - z) < 1e-3, `${name}: a wall stops the slide (moved ${(a.pos[2] - z).toFixed(3)}; movers 9 / 0xb / 10 walk the mesh, FUN_0034f178)`);
      for (let i = 0; i < 200 && name !== 'big death'; i++) W.tick(1.2, pp, pp);
    }
  }
  // FUN_00561138: the turn and no FUN_003533e0 (a running path mover goes by FUN_00352a60 inside FUN_00353340 only); class 0x36's bit 0x100 waits its 10 ticks (FUN_00539570)
  {
    const { W, a, pp } = floorWorld();
    W.t.enemyHP(a, 999); W.t.react(a, 4, [0, 0, 1], a.pos.slice(), 1);
    ok(a.astate === 7 && a.C.kturn && Math.abs(a.C.kturn.dir[2] + 1) < 1e-6 && a.C.mover === 0xb, `FUN_00561138: state 7, the turn to -dir, mover 0xb (${a.C.mover})`);
  }
  {
    const { W, a, pp } = floorWorld();
    a.face = [-1, 0, 0.03];
    W.t.enemyHP(a, 999); W.t.react(a, 8, [0, 0, 1], a.pos.slice(), 1);
    let nAt = null, was = null;
    for (let i = 1; i <= 200 && nAt === null; i++) { W.tick(1.2, pp, pp); if (a.C.motion.cls === 0x36 && was === null) was = i; if (a.f118 & 0x100) nAt = i; }
    ok(was !== null && nAt - was >= 8 && nAt - was <= 10, `a dead knock-down: class 0x36 from frame ${was}, +0x118 bit 0x100 ${nAt - was} frames later (timer 10 at 1.2)`);
  }
}
// 5. Second re-review
{
  const run = (W, pp, n) => { for (let i = 0; i < n; i++) W.tick(1.2, pp, pp); };
  // (1) a stale polygon: outside mode 0xc, slide / knock re-place the body (FUN_0034f178 -> FUN_00356d98); in mode 0xc and in the air they don't
  for (const [name, fl] of [['knock', 8], ['slide', 4]]) {
    const { W, a } = floorWorld();
    a.B = { poly: 9, state: 0, vel: [0, 0, 0], want: [0, 0, 0], acc: 2.5, turn: 12.566, dt: 0.02 }; a.C.mm = 0;                                                 // (a body left behind on polygon 9)
    W.t.react(a, fl, [0, 0, 1], a.pos.slice(), 1);
    ok(a.B.poly === 0, `${name} after a script walk: the body re-placed (polygon ${a.B.poly}, was a stale 9)`);
    const w2 = floorWorld(), b = w2.a;
    b.B = { poly: 9, state: 0, vel: [0, 0, 0], want: [0, 0, 0], acc: 2.5, turn: 12.566, dt: 0.02 }; b.C.mm = 0xc;
    w2.W.t.react(b, fl, [0, 0, 1], b.pos.slice(), 1);
    ok(b.B.poly === 9, `${name} in mode 0xc: the body keeps its polygon (${b.B.poly})`);
  }
  // (2) townspeople: stances without rows 0xa8-0xb1 and no model_clips: no row counts as done
  const npcWorld = () => {
    const FLOOR = 0;
    const walkCol = { locate: () => [0], polys: [{ flags: 0 }], wall45: false, navMove: (p, x, y, z, dx, dz) => [x + dx, FLOOR, z + dz, 0, 0, 0] };
    const pp = [0, FLOOR, 0], player = { pos: pp.slice(), hp: 9999, id: 0x16, f118: 0, s64: 0 };
    const W = AI.createEnemyAI({ data, player, rand: () => 0.5, quiet: true, log: () => {}, deadRecs: [], walkMesh: walkCol });
    W.t.send(W.objects.get(ID(114)), -2, 0x108, [0, 0, 0, 0]); W.tick(1.2, pp, pp);
    const a = W.objects.get(ID(114));
    a.pos = [100, FLOOR, 100]; a.C.f1c0 |= 0x200; a.C.gun = 0; W.t.setActorState(a, 2); a.hp = 58;
    return { W, a, pp };
  };
  for (const [name, face] of [['from the front', [0, 0, -1]], ['from behind', [-1, 0, 0.03]]]) {
    const { W, a, pp } = npcWorld();
    a.face = face;
    W.t.react(a, 8, [0, 0, 1], a.pos.slice(), 1);
    run(W, pp, 400);
    ok(![0xf, 0x10, 0x11].includes(a.astate) && !KNOCKED.has(a.C.motion && a.C.motion.cls) && !(a.C.f564 & 0xc000), `townsperson, flags 8 ${name}: up again (state ${a.astate.toString(16)}, class ${a.C.motion && a.C.motion.cls.toString(16)}, C+0x564 ${a.C.f564.toString(16)})`);
  }
  {
    const { W, a, pp } = npcWorld();
    a.face = [-1, 0, 0.03];
    W.t.enemyHP(a, 999); W.t.react(a, 8, [0, 0, 1], a.pos.slice(), 1);
    run(W, pp, 300);
    ok(a.hp === 0 && (a.f118 & 0x100), `townsperson, flags 8 kill: settles (+0x118 ${a.f118.toString(16)}, state ${a.astate.toString(16)})`);
  }
  // (3) the table: 0xf -> 0x10 is class 0x38, 0x11 -> 3 class 0x37
  {
    const { W, a, pp } = floorWorld();
    W.t.react(a, 8, [0, 0, 1], a.pos.slice(), 1);
    run(W, pp, 20);
    a.face = [0, 0, 1]; W.t.react(a, 8, [0, 0, 1], a.pos.slice(), 1);
    ok(a.astate === 0x10 && a.C.motion.cls === 0x38, `0xf -> 0x10: class ${a.C.motion.cls.toString(16)} (FUN_005392e0: 0x38)`);
    run(W, pp, 3);
    ok(a.C.clip === 'r_bl_ht0' || a.C.clip === 'm_bl_ht0', `class 0x38 plays row 0xad: ${a.C.clip}`);
    const w = floorWorld();
    w.W.t.react(w.a, 8, [0, 0, 1], w.a.pos.slice(), 1); run(w.W, w.pp, 60);
    ok(w.a.astate === 0x11, 'lying');
    w.W.t.setActorState(w.a, 3);
    ok(w.a.C.motion.cls === 0x37, `0x11 -> 3: class ${w.a.C.motion.cls.toString(16)} (FUN_005394d8: 0x37)`);
  }
  // (4) killed lying: class 0xd, the stance-2 row (DAT_005a39f0[area]), not a standing clip
  {
    const { W, a, pp } = floorWorld();
    W.t.react(a, 8, [0, 0, 1], a.pos.slice(), 1); run(W, pp, 60);
    ok(a.astate === 0x11 && a.stance === 2, 'lying again');
    a.C.f590 = (a.C.f590 & ~0xf) | 0;
    W.t.enemyHP(a, 999); W.t.react(a, 0, [0, 0, 1], a.pos.slice(), 1);
    const rows = a.C.rows;
    ok(a.astate === 7 && a.C.motion.cls === 0xd && a.C.clip === rows[0x37], `killed lying: state 7, class ${a.C.motion.cls.toString(16)}, ${a.C.clip} (row 0x37 ${rows[0x37]})`);
    run(W, pp, 400);
    ok(a.f118 & 0x100, 'and it settles');
  }
  // (5) +0x118 bit 8 with flags 2, a kill: FUN_00560fc8
  {
    const { W, a } = floorWorld();
    a.f118 |= 8;
    W.t.enemyHP(a, 999); W.t.react(a, 2, [0, 0, 1], a.pos.slice(), 1);
    ok(a.hp === 0 && a.astate === 7, `+0x118 bit 8, flags 2, a kill: state ${a.astate} (FUN_00560fc8)`);
    const w = floorWorld();
    w.a.f118 |= 8; const st = w.a.astate;
    w.W.t.react(w.a, 2, [0, 0, 1], w.a.pos.slice(), 1);
    ok(w.a.astate === st && !w.a.C.slide, 'alive: nothing');
  }
  // (6) flags 0xc with +0x118 bits 0x810: the rewrite to 2, no knock-down (FUN_00565480)
  {
    const { W, a, pp } = floorWorld();
    a.f118 |= 0x810; a.f144 = -1000;
    W.t.react(a, 0xc, [0, 0, 1], a.pos.slice(), 1);
    ok(a.astate !== 0xf && a.astate !== 0x10 && a.astate !== 0x18 && a.C.mover !== 10, `flags 0xc, +0x118 0x810: rewritten to 2: state ${a.astate.toString(16)}, mover ${a.C.mover}`);
  }
  // (7) a re-hit's class 0x1e in state 0x18: the done bit at phase 1's end, no frame in phase 2
  {
    const { W, a, pp } = floorWorld();
    W.t.react(a, 4, [0, 0, 1], a.pos.slice(), 1); run(W, pp, 10);
    W.t.react(a, 4, [0, 0, 1], a.pos.slice(), 1);
    let late = false;
    for (let i = 0; i < 200 && a.astate === 0x18; i++) { W.tick(1.2, pp, pp); if (a.astate === 0x18 && a.C.motion.cls === 0x1e && a.C.motion.phase === 2) late = true; }
    ok(!late && a.astate !== 0x18, `class 0x1e's end in state 0x18: out at phase 1's end (FUN_00598950; state ${a.astate.toString(16)})`);
  }
  // (8) a flinch lying writes +0x144 (FUN_00561718)
  {
    const { W, a, pp } = floorWorld();
    W.t.react(a, 8, [0, 0, 1], a.pos.slice(), 1); run(W, pp, 60);
    a.f144 = -1000;
    W.t.react(a, 2, [0, 0, 1], a.pos.slice(), 1);
    ok(a.f144 >= 0, `flinch lying: +0x144 = the clock (${a.f144})`);
  }
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
