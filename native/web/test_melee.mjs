// The soldiers' melee hit (enemy_ai.js makeAttack / attackObjUpdate: FUN_00569dc0 -> FUN_00541310, the
// attack object FUN_0057a330 / FUN_0057a428 / FUN_0057a830, sphere test FUN_0057b8b8 -> FUN_0055c5f8 ->
// FUN_0025db68, damage FUN_0055eac8) against the PCSX2 trace k_melee18 (tools/trace/out; game-derived,
// gitignored; TRACE_FIELDSET=path TRACE_MELEE=1 TRACE_CALLLOG=melee, see tools/trace/scripts/k_melee18.json):
// #66 (record 44) swings r_atk_0 at Vincent from 20 u (actor state 0x80 at f1455), the volume is made at
// f1460, tests Vincent's capsule at f1463 and hits: HP 560 -> 511.
// Plus hand cases that run without the trace: the sphere / capsule edges, the end caps, one hit per swing,
// the life, the repeat flag, the damage maths and the other types' records.
//   node native/web/test_melee.mjs [enemy_ai.js]       (STRICT=1: known gaps fail too)
// The lunge (r_atk_0's root motion, mover 8): a closed-loop replay from 20 u against the game's positions.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { modelPose, boneRows } from './enemy_hit.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const AI = await import(pathToFileURL(path.resolve(process.argv[2] ?? path.join(here, 'enemy_ai.js'))).href);
const OUT = process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out');
const D = p => path.join(here, 'data', p);
let fail = 0, gaps = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const gap = (c, m) => { if (c) return ok(c, m); console.log('gap  ' + m); gaps++; if (process.env.STRICT) fail++; };
const f = Math.fround;
const STEP_G = 1.1999999284744263;                                        // DAT_004eeb24 (every trace record)
const summary = () => { console.log((fail ? `${fail} FAILED` : 'all ok') + (gaps ? ` (${gaps} known gaps)` : '')); process.exit(fail ? 1 : 0); };

if (!existsSync(D('enemies/ai.json'))) { console.log('SKIP: no data/enemies/ai.json (game data, build it)'); process.exit(0); }
const data = JSON.parse(readFileSync(D('enemies/ai.json'), 'utf8'));
if (!data.markers || !data.attacks['7'] || !data.attacks['7'].volumes) { console.log('FAIL old ai.json (no markers / volumes): rebuild data/enemies'); process.exit(1); }
const e027 = JSON.parse(readFileSync(D('enemies/e027.json'), 'utf8')).local_pose;
const e027d = new Float32Array(readFileSync(D('enemies/e027_local.bin')).buffer.slice(0));
const { sphereCapsule, offence } = AI.createEnemyAI({ data, player: { pos: [0, 0, 0], hp: 780, id: 0x16, f118: 0 }, quiet: true }).t;

// ------------------------------------------------ data: the records op 2 builds from
{
  const v = data.attacks['7'].volumes[0];
  ok(v.shape === 1 && v.type === 1 && v.m5 === 0 && v.m6 === 15 && v.c1 === 8 && v.life === 16 && v.dmg === 50 && v.p[0] === 5 && v.off.join() === '0,0,3',
     `e027 zone 7 (r_atk_0) volume 0: shape ${v.shape} (1 sphere), r ${v.p[0]} (5), marker ${v.m6} (15), offset ${v.off} (0,0,3), +0xc1 ${v.c1} (8: follow, one target), life ${v.life} (16), damage ${v.dmg} (50) = the k_melee18 make record`);
  ok(data.markers.e027[15][3] === 26 && data.markers.e048[8][3] === 13, `markers: e027 15 -> bone ${data.markers.e027[15][3]} (26), e048 8 -> bone ${data.markers.e048[8][3]} (13)`);
}

// ------------------------------------------------ FUN_0025db68 hand cases (capsule (0,0,0)..(0,-18,0), rc 5, rs 5)
{
  const A = [0, 0, 0], B = [0, -18, 0];
  ok(sphereCapsule(5, 5, [9.99, -9, 0], A, B) && !sphereCapsule(5, 5, [10.0, -9, 0], A, B), 'side: hit at 9.99 from the axis, miss at 10.0 (|q - c| < rs + rc, strict)');
  // past the top end by 2.5: hit when the offset <= 5 + 5 cos(pi/4) = 8.5355
  ok(sphereCapsule(5, 5, [8.53, -20.5, 0], A, B) && !sphereCapsule(5, 5, [8.54, -20.5, 0], A, B), 'top cap, 2.5 past the end: hit at 8.53, miss at 8.54 (rc + rs cos(e pi / 2rs))');
  ok(sphereCapsule(5, 5, [8.53, 2.5, 0], A, B) && !sphereCapsule(5, 5, [8.54, 2.5, 0], A, B), 'bottom cap, 2.5 below the feet: the same bound');
  ok(sphereCapsule(5, 5, [0, -22.9, 0], A, B) && !sphereCapsule(5, 5, [0, -23.01, 0], A, B), 'on the axis: hit up to rs past the end (4.9), not beyond (5.01)');
  ok(!sphereCapsule(5, 5, [5.01, -23, 0], A, B), 'exactly rs past the end with an offset: cos(pi/2) = 0 -> needs offset <= rc');
}

// ------------------------------------------------ damage: FUN_00569dc0 / FUN_00317ef0 / FUN_00318120
{
  ok(offence({ f60: 0, armour: null, l12: 0, l13: 0 }, 50, 1) === 50, `offence, soldier status (+0x60 0, level 0): 50 -> ${offence({ f60: 0, armour: null, l12: 0, l13: 0 }, 50, 1)} (50: k_melee18 attack +0xc2)`);
  // +0x60 bit 1: level 4 x 0.75 + 0 + 0.5 -> 3; cut (FUN_00242c28 path: DAT_0046b2fc 2, option bit 17 clear -> 1 - 1 = 0 -> +0xa8 0) + 60
  const o2 = offence({ f60: 2, armour: null, l12: 4, l13: 0 }, 50, 1);
  ok(o2 === 82, `offence with +0x60 bit 1 and level 4: L = 3 + 0 + 60 -> (50.5 x 163 x 0.01) = ${o2} (82)`);
  ok(offence({ f60: 0, armour: null, l12: 0, l13: 0 }, 0, 1) === 0 && offence({ f60: 0x102, armour: null, l12: 200, l13: 0 }, 1, 1) === 3, 'offence: 0 stays 0; +0x60 0x100 skips the cut and FUN_003212a8 (L = 150: 1.5 x 250 x 0.01 = 3)');
  ok(AI.defence(AI.PLAYER_STATUS, 50, 1) === 49, `Vincent's defence, kind 1 (FUN_0057a218): 50 -> ${AI.defence(AI.PLAYER_STATUS, 50, 1)} (49: k_melee18 FUN_00318120)`);
}

// ------------------------------------------------ the attack object in a world (stub pose)
// boneWorld stub: every bone at `at` with identity rows, so the volume's centre = at + (0, 0, 3) (marker 15 offset 0)
function world({ ppos = [0, 0, 0], at = [0, -9, -3], c1, every, rec = 44, mutVol = null, pst = null } = {}) {
  const player = { pos: ppos.slice(), hp: 780, id: 0x16, f118: 0 };
  // a private copy whenever a record changes (the shared ai.json object must stay as loaded for later cases)
  const d2 = mutVol || c1 != null || every != null ? JSON.parse(JSON.stringify(data)) : data;
  if (mutVol) mutVol(d2);
  const W = AI.createEnemyAI({ data: d2, player, quiet: true, rand: () => 0.5, ...(pst ? { playerStatus: pst } : {}) });
  const a = W.addActor({ rec, mode: 0, pos: [0, 0, -40], face: [0, 0, 1], clip: 'r_st_a' });
  const pose = { at: at.slice() };
  W.boneWorld = () => () => [[1, 0, 0], [0, 1, 0], [0, 0, 1], pose.at];
  const T = d2.attacks[String(d2.records[rec].zones)];
  if (c1 != null) T.volumes[0].c1 = c1;
  if (every != null) T.volumes[0].every = every;
  return { W, a, player, T, pose, data: d2 };
}
{
  // one hit per swing: the centre on Vincent for the whole life -> one HP drop, object gone on the hit frame
  const { W, a, player, T } = world();
  W.t.makeAttack(a, T, 0);
  const hp = [], n = [];
  for (let i = 0; i < 20; i++) { W.tick(1.2, player.pos, player.pos); hp.push(player.hp); n.push(W.attackObjs.length); }
  ok(hp[0] === 731 && hp.every(x => x === 731) && n[0] === 0 && a.ai.f7a === 1 && !a.ai.f76, `centre on Vincent: HP 780 -> ${hp[0]} on the first update (731), then ${[...new Set(hp)]}; object gone that frame (${n[0]}); AI +0x7a ${a.ai.f7a} (1), +0x76 ${a.ai.f76 ?? 0} (0)`);
}
{
  // a miss: life 16 - 1.2 x k < 0 at the 14th update (16 - 15.6 = 0.4 at the 13th)
  const { W, a, player, T } = world({ at: [0, -9, -30] });
  W.t.makeAttack(a, T, 0);
  let end = null;
  for (let i = 0; i < 20 && end == null; i++) { const ev = W.tick(1.2, player.pos, player.pos); if (ev.some(x => x.startsWith('attack object end'))) end = i + 1; }
  ok(end === 14 && player.hp === 780 && a.ai.f76 === 1 && !a.ai.f7a, `no target: ends at update ${end} (14: life 16, step 1.2), HP ${player.hp}, AI +0x76 ${a.ai.f76} (1)`);
}
{
  // the edge in a world: horizontal 9.99 from the axis at mid height hits, 10.0 misses (centre = at + (0,0,3))
  const hit = dz => { const { W, a, player, T } = world({ at: [0, -9, -3 + dz] }); W.t.makeAttack(a, T, 0); W.tick(1.2, player.pos, player.pos); return player.hp < 780; };
  ok(hit(9.99) && !hit(10.0), `world edge: centre 9.99 from Vincent's axis -> hit ${hit(9.99)}, 10.0 -> ${hit(10.0)}`);
  // the candidate pre-test is horizontal: centre 30 u above Vincent's head but on his axis: candidate, no hit
  const { W, a, player, T } = world({ at: [0, -60, -3] });
  W.t.makeAttack(a, T, 0); W.tick(1.2, player.pos, player.pos);
  ok(W.attackObjs[0] && W.attackObjs[0].cand.length === 1 && player.hp === 780, `candidate test is xz only (FUN_0057aed8 vaddz.x): centre 42 above the feet -> listed ${W.attackObjs[0]?.cand.length} (1), no hit`);
  const far = world({ at: [13.7, -9, -3] }); far.W.t.makeAttack(far.a, far.T, 0); far.W.tick(1.2, far.player.pos, far.player.pos);
  const near = world({ at: [13.6, -9, -3] }); near.W.t.makeAttack(near.a, near.T, 0); near.W.tick(1.2, near.player.pos, near.player.pos);
  ok(far.W.attackObjs[0].cand.length === 0 && near.W.attackObjs[0].cand.length === 1, `candidate radius sqrt(3) x 5 + 5 = 13.66: 13.7 -> ${far.W.attackObjs[0].cand.length} (0), 13.6 -> ${near.W.attackObjs[0].cand.length} (1)`);
}
{
  // +0xc1 bit 3 clear: placed once at the make (the pose moves away afterwards, the volume stays)
  const { W, a, player, T, pose } = world({ c1: 0, at: [0, -9, -3 + 20] });
  W.t.makeAttack(a, T, 0);
  pose.at = [0, -9, -3];
  W.tick(1.2, player.pos, player.pos);
  const fixedMiss = player.hp === 780;
  const g = world({ c1: 8, at: [0, -9, -3 + 20] }); g.W.t.makeAttack(g.a, g.T, 0); g.pose.at = [0, -9, -3]; g.W.tick(1.2, g.player.pos, g.player.pos);
  ok(fixedMiss && g.player.hp === 731, `follow bit (+0xc1 bit 3): clear -> placed at the make (no hit after the pose moves onto Vincent: ${fixedMiss}); set -> follows (HP ${g.player.hp})`);
}
{
  // every target (+0xc1 bit 0) without repeat: the object lives on after its hit, but an entry already hit
  // (flags bit 0) is skipped: one HP drop over the whole life
  const { W, player, a, T } = world({ c1: 8 | 1 });
  W.t.makeAttack(a, T, 0);
  const hp = [], live = [];
  for (let i = 0; i < 16; i++) { W.tick(1.2, player.pos, player.pos); hp.push(player.hp); live.push(W.attackObjs.length); }
  ok(hp.every(x => x === 731) && live[12] === 1 && live[13] === 0, `every-target bit 0: one hit (HP ${[...new Set(hp)]}), the object lives to update 14 (${live.lastIndexOf(1) + 1})`);
}
{
  // life 16 at step 1.0: 16 updates leave 0 (not < 0), the 17th ends it
  const { W, a, player, T } = world({ at: [0, -9, -30] });
  W.t.makeAttack(a, T, 0);
  let end = null;
  for (let i = 0; i < 20 && end == null; i++) { const ev = W.tick(1.0, player.pos, player.pos); if (ev.some(x => x.startsWith('attack object end'))) end = i + 1; }
  ok(end === 17, `life 16 at step 1.0: ends at update ${end} (17: life < 0, strict)`);
}
{
  // repeat (+0xc1 bit 2, every n frames): the object lives on and hits again once the frame byte moved on n
  const { W, player, a, T } = world({ c1: 8 | 4, every: 5 });
  W.t.makeAttack(a, T, 0);
  const drops = [];
  let last = player.hp;
  for (let i = 0; i < 13; i++) { W.tick(1.2, player.pos, player.pos); if (player.hp !== last) drops.push(i); last = player.hp; }
  // worker 0230: the frame byte is the manager clock mgr +0x20 (ticks, 1.2 a PAL frame): 5 ticks after the save's +0x24 0.5999
  // are 4 frames (+1 +1 +2 +1), so the hits come at updates 0, 4, 8
  ok(drops.join() === '0,4,8', `repeat bit 2, +0x13c 5: hits at updates ${drops} (0,4,8: every 5 ticks), life 16 ends it at 14`);
}
{
  // +0x13c is a signed char (FUN_0057a428): 0xfb = -5, so a repeat entry hits again on the very next update
  const { W, player, a, T } = world({ c1: 8 | 4, every: 0xfb });
  W.t.makeAttack(a, T, 0);
  let hits = 0;
  for (let i = 0; i < 16; i++) { const ev = W.tick(1.2, player.pos, player.pos); hits += ev.filter(x => x.startsWith('melee hit player')).length; }
  ok(hits === 14 && player.hp === 780 - 14 * 49, `repeat with +0x13c 0xfb (signed -5): a hit on each of the 14 updates (${hits}), HP ${player.hp} (${780 - 14 * 49})`);
}
{
  // FUN_0055eac8: a dead Vincent (FUN_00316cf8, HP 0) is no candidate (FUN_0055e878 first): no hit is counted
  const { W, a, player, T } = world();
  player.hp = 0;
  W.t.makeAttack(a, T, 0);
  const ev = W.tick(1.2, player.pos, player.pos);
  ok(!a.ai.f7a && !ev.some(x => x.startsWith('melee hit player')) && W.attackObjs[0]?.cand.length === 0, `dead Vincent: not a candidate (${W.attackObjs[0]?.cand.length}), AI +0x7a ${a.ai.f7a ?? 0} (0)`);
}
{
  // FUN_0055c7f8: with P+0x118 bit 31 (< 0) a blow that would kill leaves 1 HP
  const { W, a, player, T } = world();
  player.hp = 30; player.f118 = 0x80000000 | 0;
  W.t.makeAttack(a, T, 0); W.tick(1.2, player.pos, player.pos);
  const g = world(); g.player.hp = 30; g.W.t.makeAttack(g.a, g.T, 0); g.W.tick(1.2, g.player.pos, g.player.pos);
  ok(player.hp === 1 && a.ai.f7a === 1 && g.player.hp === 0, `P+0x118 bit 31: 49 on 30 HP leaves ${player.hp} (1); without it ${g.player.hp} (0)`);
}
{
  // player status +0x64 bits 0 / 1 (FUN_0055f0e0(P, 0 / 1)). At the candidate test (FUN_0055e878): set -> not listed,
  // no hit counted. At the damage (FUN_0055eac8): a candidate listed before the bit was set is hit (counted) but
  // takes no damage, unless the object's type (+0xc0 bits 0-1, FUN_00579ef0: type > 3 -> 0) is 3.
  const pst = () => ({ ...AI.PLAYER_STATUS });
  for (const bit of [1, 2]) {
    const P1 = pst(); P1.f64 = bit;
    const { W, a, player, T } = world({ pst: P1 });
    W.t.makeAttack(a, T, 0); W.tick(1.2, player.pos, player.pos);
    ok(W.attackObjs[0]?.cand.length === 0 && !a.ai.f7a && player.hp === 780, `status +0x64 = ${bit} at the candidate test: not listed (${W.attackObjs[0]?.cand.length}), no hit (+0x7a ${a.ai.f7a ?? 0}), HP ${player.hp}`);
  }
  // listed on a first update out of reach (the candidate pre-test is xz only: centre 42 above), then the bit
  const late = (type, bit = 1) => {
    const P1 = pst();
    const w = world({ pst: P1, at: [0, -60, -3], mutVol: d => { d.attacks['7'].volumes[0].type = type; } });
    w.W.t.makeAttack(w.a, w.T, 0); w.W.tick(1.2, w.player.pos, w.player.pos);
    const listed = w.W.attackObjs[0]?.cand.length;
    P1.f64 = bit; w.pose.at = [0, -9, -3];
    w.W.tick(1.2, w.player.pos, w.player.pos);
    return { listed, hits: w.a.ai.f7a | 0, hp: w.player.hp };
  };
  const t1 = late(1), t3 = late(3), t7 = late(7), t1b = late(1, 0);
  ok(t1.listed === 1 && t1.hits === 1 && t1.hp === 780 && t1b.hp === 731,
     `status +0x64 bit 0 set after the listing: hit counted (${t1.hits}), no damage (HP ${t1.hp}; bit clear: ${t1b.hp})`);
  ok(t3.hits === 1 && t3.hp === 731 && t7.hits === 1 && t7.hp === 780,
     `... type 3 is damaged anyway (HP ${t3.hp}); type 7 -> 0 (FUN_00579ef0), not 7 & 3 = 3: no damage (HP ${t7.hp})`);
}
{
  // attackCentre (FUN_0057a428's centre): marker xyz + the record's local offset, through the bone's rows
  const { W, a, T, pose } = world({ mutVol: d => { d.markers.e027[15] = [1, 2, 3, d.markers.e027[15][3]]; } });
  W.boneWorld = () => () => [[0, 0, 1], [0, 1, 0], [-1, 0, 0], pose.at];
  W.t.makeAttack(a, T, 0);
  const c = W.t.attackCentre(W.attackObjs[0]), want = [-6 + 0, 2 - 9, 1 - 3];   // p = (1, 2, 3 + 3): 1 r0 + 2 r1 + 6 r2 + at
  ok(c && c.every((x, k) => Math.abs(x - want[k]) < 1e-6), `attackCentre with marker offset (1,2,3) + (0,0,3) on a turned bone: ${c} (${want})`);
}
{
  // other types: e048 (record 28, zone set 4: m_atk, marker 8 = bone 13) builds the same sphere; e030's shape-2
  // volumes (zone set 8, 1 / 2) are not translated (warned, no object)
  const e48 = world({ rec: 28 });
  e48.W.t.makeAttack(e48.a, e48.T, 0); e48.W.tick(1.2, e48.player.pos, e48.player.pos);
  ok(e48.player.hp === 731, `e048 m_atk volume (zone set ${data.records[28].zones}, marker 8): hit, HP ${e48.player.hp}`);
  const e30 = world({ rec: 7 });
  e30.W.t.makeAttack(e30.a, e30.T, 1);
  ok(e30.W.attackObjs.length === 0, `e030 volume 1 (shape 2, FUN_0057bc00): not built (${e30.W.attackObjs.length})`);
  e30.W.t.makeAttack(e30.a, e30.T, 0);
  ok(e30.W.attackObjs.length === 1 && e30.W.attackObjs[0].marker === 4 && e30.W.attackObjs[0].dmg === 100, `e030 volume 0 (shape 1, marker 4, damage ${e30.W.attackObjs[0]?.dmg} (100)): built`);
}
{
  // W+0x56 scales the record's damage: (50 + 0.5) x 0.01 x 120 = 60.6 -> 60 -> Vincent's defence
  const { W, a, player, T } = world({ mutVol: d => { for (const w of d.weapons) w.w56 = 20; } });
  W.t.makeAttack(a, T, 0);
  ok(W.attackObjs[0].dmg === 60, `W+0x56 = 20: attack damage ${W.attackObjs[0].dmg} (60)`);
}
{
  // Vincent's no-damage flags: P+0x118 bit 5 (FUN_005725d8) and bit 6 (FUN_0055eac8 -> 0)
  for (const fl of [0x20, 0x40]) {
    const { W, a, player, T } = world(); player.f118 = fl;
    W.t.makeAttack(a, T, 0); W.tick(1.2, player.pos, player.pos);
    ok(player.hp === 780 && a.ai.f7a === 1, `P+0x118 0x${fl.toString(16)}: hit counted (+0x7a ${a.ai.f7a}), no damage (HP ${player.hp})`);
  }
}

// ------------------------------------------------ root motion hand cases (synthetic root tracks, a flat walk mesh)
// The swing's op 0 byte 6 picks the axes: bit 0 -> horizontal (mirrored along the delta's row 0, then negated
// with C's rows by FUN_00351418), bit 1 -> vertical (C+0x370). The delta is inverse(last sample) x this sample.
{
  const PMm = await import(pathToFileURL(path.join(here, 'path_mover.js')).href);
  const flat = { locate: () => [0, 0], navMove: (pi, x, y, z, dx, dz) => [x + dx, y, z + dz, pi, false, false] };
  const rotY = th => [0, Math.sin(th / 2), 0, Math.cos(th / 2)];
  const qrot = (q, v) => {                                                 // independent of enemy_ai's: v' = v + 2w (u x v) + 2 u x (u x v)
    const u = q.slice(0, 3), w = q[3], cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const c1 = cr(u, v), c2 = cr(u, c1);
    return [0, 1, 2].map(k => v[k] + 2 * w * c1[k] + 2 * c2[k]);
  };
  const mat = (q, t) => [[...qrot(q, [1, 0, 0]), 0], [...qrot(q, [0, 1, 0]), 0], [...qrot(q, [0, 0, 1]), 0], [...t, 1]];
  const mul = (A, B) => A.map(r => [0, 1, 2, 3].map(c => r.reduce((s, x, k) => s + x * B[k][c], 0)));   // row vectors: p A B
  const rigidInv = M => { const R = [0, 1, 2].map(i => [M[0][i], M[1][i], M[2][i]]); const t = M[3]; const ti = [0, 1, 2].map(i => -(t[0] * R[0][i] + t[1] * R[1][i] + t[2] * R[2][i])); return [[...R[0], 0], [...R[1], 0], [...R[2], 0], [...ti, 1]]; };
  const swing = (track, b6, face = [0, 0, 1]) => {
    const d2 = JSON.parse(JSON.stringify(data));
    d2.attacks['7'].entries[0].kf[0].cmds[0][3] = b6;
    const player = { pos: [0, 0, 100], hp: 780, id: 0x16, f118: 0 };
    const W = AI.createEnemyAI({ data: d2, player, quiet: true, rand: () => 0.5, walkMesh: flat, rootTrack: () => track });
    const a = W.addActor({ rec: 44, mode: 0, pos: [0, 0, 0], face, clip: 'r_st_a' });
    W.boneWorld = () => () => [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 500]];
    W.t.setActorState(a, 0x80);
    const pos = [a.pos.slice()];
    for (let i = 0; i < 3; i++) { W.tick(STEP_G, player.pos, player.pos); pos.push(a.pos.slice()); }
    return { a, pos };
  };
  // the game's sequence: frame 0 then 0.5 (head frame 0, 0.59999996); identity before the first sample
  const tr = { n: 3, t: [[0, 0, 2], [0, 0, 4], [0, 0, 4]], q: [[0, 0, 0, 1], rotY(0.4), rotY(0.4)] };
  const R = swing(tr, 3), M0 = mat(tr.q[0], tr.t[0]), Mh = mat(rotY(0.2), [0, 0, 3]);
  const move = D => {                                                      // FUN_00343160 bit 6 + FUN_00351418 (y dropped)
    const t = D[3].slice(0, 3), u0 = D[0].slice(0, 3), l = Math.hypot(...u0), u = u0.map(x => x / l), d = t[0] * u[0] + t[1] * u[1] + t[2] * u[2];
    const m = t.map((x, k) => x - 2 * d * u[k]), fc = [0, 0, 1], r0 = [-fc[2], 0, fc[0]];
    return [-(m[0] * r0[0] + m[2] * fc[0]), -(m[0] * r0[2] + m[2] * fc[2])];
  };
  const e1 = move(mul(rigidInv(mat([0, 0, 0, 1], [0, 0, 0])), M0)), e2 = move(mul(rigidInv(M0), Mh));
  const g1 = [R.pos[1][0] - R.pos[0][0], R.pos[1][2] - R.pos[0][2]], g2 = [R.pos[2][0] - R.pos[1][0], R.pos[2][2] - R.pos[1][2]];
  ok(Math.hypot(g1[0] - e1[0], g1[1] - e1[1]) < 1e-4 && Math.hypot(g2[0] - e2[0], g2[1] - e2[1]) < 1e-4 && Math.hypot(...e2) > 0.5,
     `rotating root (0.4 rad over a frame): moves (${g1.map(x => x.toFixed(4))}) / (${g2.map(x => x.toFixed(4))}) = inverse(previous) x sample, mirrored, through C (${e1.map(x => x.toFixed(4))}) / (${e2.map(x => x.toFixed(4))})`);
  // byte 6 = 2: vertical only (bit 0 clear: the delta's x / z are zeroed), so mover 8 runs and he stays put
  const V = swing({ n: 3, t: [[0, 0, 2], [0, 0, 4], [0, 0, 6]], q: [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]] }, 2);
  ok(V.a.C.mover === 8 && (V.a.C.f568 & 0x140) === 0x100 && V.pos.every(p => Math.abs(p[0]) < 1e-6 && Math.abs(p[2]) < 1e-6),
     `byte 6 = 2 (vertical only): mover ${V.a.C.mover} (8), C+0x568 bits 0x40 / 0x100 = 0x${(V.a.C.f568 & 0x140).toString(16)} (0x100), no horizontal move (${V.pos[3].map(x => x.toFixed(3))})`);
  // FUN_00351418 on its own: a move over 0.01 hands it to the body and clears C+0x370; a still delta keeps it
  const mk = (t, r370) => ({ face: [0, 0, 1], B: { a0: 0 }, C: { m310: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [...t, 1]], r370, f45c: 0, want: null, wk: null } });
  const A1 = mk([0, 0, 1.2], 5); PMm.rootTick(A1, STEP_G);
  const A2 = mk([0, 0, 0.0012], 5); PMm.rootTick(A2, STEP_G);
  ok(Math.abs(A1.C.wk - 1.0) < 1e-6 && A1.C.want[2] === -1 && A1.C.r370 === 0 && A1.B.a0 === 5 && A2.C.wk === 0 && A2.C.r370 === 5,
     `FUN_00351418: delta z 1.2 -> wanted move ${A1.C.want} x ${A1.C.wk?.toFixed(4)} (1 a tick), body+0xa0 ${A1.B.a0} (C+0x370 5) then C+0x370 ${A1.C.r370} (0); 0.0012 (< 0.01 a tick): no move, C+0x370 kept (${A2.C.r370})`);
}

// ------------------------------------------------ trace replay: k_melee18
const TF = path.join(OUT, 'k_melee18.jsonl'), TC = path.join(OUT, 'k_melee18.calls.jsonl');
if (!existsSync(TF) || !existsSync(TC)) { console.log('SKIP trace part: no tools/trace/out/k_melee18 (run tools/trace/scripts/k_melee18.json)'); summary(); }
const recs = readFileSync(TF, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.frame != null);
const calls = readFileSync(TC, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(e => e.hook);
const byF = new Map(recs.map(r => [r.frame, r]));
const fl = (h, i) => Buffer.from(h, 'hex').readFloatLE(4 * i);
const soldier = r => ({ pos: [12, 13, 14].map(i => fl(r.e0_cmat, i)), face: [8, 9, 10].map(i => fl(r.e0_cmat, i)) });
const vinc = r => [12, 13, 14].map(i => fl(r.p_pos, i));
const make = calls.find(e => e.hook === 'make'), sph = calls.filter(e => e.hook === 'sph_capsule'), hitc = calls.find(e => e.hook === 'hit');
const upd = calls.filter(e => e.hook === 'update'), pd = calls.find(e => e.hook === 'p_damage');
const start = recs.find(r => r.e0_a100.slice(8, 10) === '80');   // actor +0x104 = 0x80 (attack 0)
ok(start && start.frame === 1455 && make && make.frame === 1460 && sph.length === 1 && sph[0].frame === 1463 && hitc && hitc.frame === 1463,
   `game: attack state 0x80 at f${start?.frame} (1455), volume made f${make?.frame} (1460, keyframe 6 at 1.2 a frame), first sphere test f${sph[0]?.frame} (1463), hit f${hitc?.frame}`);
ok(upd.map(e => e['a0+0xd0'].f[4]).join() === '14.8,13.6,12.4' && upd.length === 3 && pd && pd.a1 === 49,
   `game: life after each update ${upd.map(e => e['a0+0xd0'].f[4])} (14.8, 13.6, 12.4; then gone), Vincent's damage ${pd?.a1} (49)`);
ok(byF.get(1462).p_hp === 560 && byF.get(1463).p_hp === 511, `game: HP ${byF.get(1462).p_hp} -> ${byF.get(1463).p_hp} at f1463 (560 -> 511)`);
// page attack timing from the same start: attack state at f1455, keyframe 6 reached after 5 steps of 1.2 -> made f1460
{
  const player = { pos: vinc(byF.get(1455)), hp: 560, id: 0x16, f118: 0 };
  const W = AI.createEnemyAI({ data, player, quiet: true, rand: () => 0.5 });
  const s0 = soldier(byF.get(1455));
  const a = W.addActor({ rec: 44, mode: 0, pos: s0.pos, face: s0.face, clip: 'r_st_a' });
  // A call tagged frame k runs in the step from record k - 1 to k (tools/trace/README.md), so tick k sees record
  // k - 1: the soldier there and r_atk_0 at clip frame (k - 1 - 1455) x 0.6 (FUN_005aa2a8: rate 0.5 x step 1.2).
  // The attack state is set before tick 1455 (record 1455 is the first with state 0x80 and the first lunge move).
  let cur = byF.get(1455);
  W.boneWorld = () => bb => { const s = soldier(cur), P = modelPose(e027, e027d, 'r_atk_0', f((cur.frame - 1455) * 0.6)); return boneRows(P.R[bb], P.S[bb], P.P[bb], s.pos, s.face); };
  W.t.setActorState(a, 0x80);
  let madeAt = null, hitAt = null, hpAt = {}, lifeAt1462 = null;
  for (let fr = 1455; fr <= 1470; fr++) {
    cur = byF.get(fr - 1) || byF.get(fr);
    const s = soldier(cur); a.pos = s.pos; a.face = s.face;        // open loop: the game's positions are fed in (the lunge itself is checked below, k_lunge166)
    player.pos = vinc(cur);
    const ev = W.tick(byF.get(1455).step, player.pos, player.pos);       // the game's step (1.1999999), from the step that makes record 1455
    if (madeAt == null && ev.some(x => x.startsWith(`attack object ${a.id}`))) madeAt = fr;
    if (fr === 1462) lifeAt1462 = W.attackObjs[0]?.life;
    if (hitAt == null && ev.some(x => x.startsWith(`melee hit player ${a.id}`))) hitAt = fr;
    hpAt[fr] = player.hp;
  }
  ok(madeAt === 1460 && Math.abs(lifeAt1462 - 13.6) < 1e-5, `page: volume made f${madeAt} (1460), life ${lifeAt1462} after f1462 (13.6 as the game: first update the frame after the make)`);
  ok(hitAt === 1463 && hpAt[1462] === 560 && hpAt[1463] === 511 && hpAt[1470] === 511, `page (game's positions fed in): hit f${hitAt} (1463), HP ${hpAt[1462]} -> ${hpAt[1463]} (560 -> 511), one hit (${hpAt[1470]} at f1470)`);
  // the centre at f1463 against the game's (FUN_0025db68 a0): marker 15 / bone 26 + (0, 0, 3) through the page's pose
  cur = byF.get(1462);
  W.t.makeAttack(a, data.attacks['7'], 0);                                // a fresh object for its centre
  const c = W.t.attackCentre(W.attackObjs[W.attackObjs.length - 1]), g = sph[0]['a0+0x0'].f;
  const dc = Math.hypot(c[0] - g[0], c[1] - g[1], c[2] - g[2]);
  ok(dc < 0.01, `page volume centre f1463 (${c.map(x => x.toFixed(3))}) vs game (${g.slice(0, 3)}): ${dc.toFixed(4)} u (< 0.01: marker 15 / bone 26 + (0, 0, 3), r_atk_0 frame 4.2)`);
  const ga = sph[0]['a1+0x0'].f, gb = sph[0]['a2+0x0'].f, pv = vinc(byF.get(1462));
  ok(Math.hypot(ga[0] - pv[0], ga[1] - pv[1], ga[2] - pv[2]) < 1e-3 && Math.abs(gb[1] - (ga[1] - 18)) < 1e-3, `Vincent's capsule = feet .. feet - 18 y (game a ${ga.slice(0, 3)}, b y ${gb[1]})`);
}
// ------------------------------------------------ the lunge: r_atk_0's root motion (op 0 byte 6 = 3 -> mover 8)
// Closed loop: #66 starts at record 1454 (20.0 u from Vincent), the attack state is set before the step that
// makes record 1455 (where the game's state 0x80 and first move show); every later position is the page's own
// (FUN_00343160 root sample -> C+0x310 -> FUN_00351418 -> the mode-0xc walk on z128's walk mesh). The facing
// is fed from the game (the turn is not under test: FUN_0034ea18 turns after the move, so step k uses record
// k - 1's), and the step is the game's DAT_004eeb24 (1.1999999: with f32(1.2) the head frame reaches 3.0 at the
// fifth step and the samples differ from the game's).
{
  const { rootTrack } = await import('./enemy_hit.js');
  const side = JSON.parse(readFileSync(D('enemies/e027.json'), 'utf8'));
  const tracks = {}, rootTrackOpt = (m, c) => tracks[c] ??= rootTrack(e027, e027d, side.clips[c], c);
  let Col = null;
  try { ({ Collision: Col } = await import(pathToFileURL(path.join(here, 'collision.js')).href)); } catch (e) { /* none */ }
  const colPath = D('z128_collision.bin');
  if (!Col || !existsSync(colPath)) { console.log('SKIP lunge: collision.js / data/z128_collision.bin missing'); summary(); }
  const cb = readFileSync(colPath), col = new Col(cb.buffer.slice(cb.byteOffset, cb.byteOffset + cb.byteLength));
  const STEP = byF.get(1455).step;                                       // 1.1999999284744263
  const run = ({ feedFace = true, startRec = 1454, poseOff = 0 } = {}) => {
    const r0 = byF.get(startRec), s0 = soldier(r0);
    const player = { pos: vinc(r0), hp: 560, id: 0x16, f118: 0 };
    const W = AI.createEnemyAI({ data, player, quiet: true, rand: () => 0.5, walkMesh: col, rootTrack: rootTrackOpt });
    const a = W.addActor({ rec: 44, mode: 0, pos: s0.pos, face: s0.face, clip: 'r_st_a' });
    // the game's C+0x1c0 at f1454 (0x5016311; the page's standing soldier has the C1C0_STAND stand-in 0x10301):
    // bit 26 gives the body its turn limit at the attack's leave (the coast f1510-1512)
    a.C.f1c0 = Buffer.from(r0.e0_mv, 'hex').readUInt32LE(0);
    let k = 0;
    // the attack object reads the skeleton posed last frame (as the open-loop replay above): clip frame (fr - 1 - 1455) x 0.6
    W.boneWorld = () => bb => { const P = modelPose(e027, e027d, 'r_atk_0', f(Math.max(0, k - 2) * f(0.5 * STEP))); return boneRows(P.R[bb], P.S[bb], P.P[bb], a.pos, a.face); };
    W.t.setActorState(a, 0x80);
    const out = { pos: {}, hp: {}, want: {}, hitAt: null, a, W };
    for (let fr = startRec + 1; fr <= 1529 && byF.get(fr); fr++) {
      k++;
      if (feedFace) a.face = soldier(byF.get(fr - 1)).face;
      player.pos = vinc(byF.get(fr - 1));
      const ev = W.tick(STEP, player.pos, player.pos);
      if (out.hitAt == null && ev.some(x => x.startsWith(`melee hit player ${a.id}`))) out.hitAt = fr;
      out.pos[fr] = a.pos.slice(); out.hp[fr] = player.hp;
      out.want[fr] = { d: a.C.want.slice(), k: a.C.wk, fl: a.C.f45c >>> 0, mover: a.C.mover, frame: a.C.mp && a.C.mp.frame };
    }
    return out;
  };
  const R = run();
  let worst = 0, wAt = 0, worstY = 0;
  for (let fr = 1455; fr <= 1512; fr++) {
    const g = soldier(byF.get(fr)).pos, p = R.pos[fr];
    const d = Math.hypot(p[0] - g[0], p[2] - g[2]);
    if (d > worst) { worst = d; wAt = fr; }
    worstY = Math.max(worstY, Math.abs(p[1] - g[1]));
  }
  const d1 = (fr, p) => { const v = vinc(byF.get(fr)); return Math.hypot(p[0] - v[0], p[2] - v[2]); };
  ok(worst < 0.01 && worstY < 0.01, `lunge closed loop f1455-1512 (forward f1455-1464, still, back f1491-1509 with the clip's frames 22-32, end f1510, coast): #66's position vs the game's, worst ${worst.toFixed(5)} u (f${wAt}), y ${worstY.toFixed(5)} (< 0.01)`);
  ok(Math.abs(d1(1462, R.pos[1462]) - 12.89) < 0.05 && Math.abs(d1(1454, soldier(byF.get(1454)).pos) - 20.0) < 0.01,
     `lunge: 20.0 u at f1454 -> ${d1(1462, R.pos[1462]).toFixed(2)} u at f1462 (game 12.89)`);
  const g1 = soldier(byF.get(1455)).pos, g0 = soldier(byF.get(1454)).pos, p1 = R.pos[1455];
  ok(Math.hypot(p1[0] - g0[0], p1[2] - g0[2]) > 0.3 && Math.hypot(p1[0] - g1[0], p1[2] - g1[2]) < 1e-3, `first step (root frame 0 vs the identity C+0x6d0): moved ${Math.hypot(p1[0] - g0[0], p1[2] - g0[2]).toFixed(4)} u (game 0.3376)`);
  ok(R.hitAt === 1463 && R.hp[1462] === 560 && R.hp[1463] === 511 && R.hp[1494] === 511, `swing from 20 u with the page's own lunge: hit f${R.hitAt} (1463), HP ${R.hp[1462]} -> ${R.hp[1463]} (560 -> 511), one hit (${R.hp[1494]})`);
  // k_lunge166 (k_melee18's run again with TRACE_PATH_BODY / TRACE_PATH_LAYERS): mover 8's output C+0xc0 / +0xcc
  // (FUN_0034af98), body+0xac and the MP head frame per frame, against the page's after the same step
  const TL = path.join(OUT, 'k_lunge166.jsonl');
  if (!existsSync(TL)) console.log('SKIP k_lunge166 part: no tools/trace/out/k_lunge166.jsonl (tools/trace/scripts/k_lunge166.json)');
  else {
    const lr = new Map(readFileSync(TL, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => r.frame != null).map(r => [r.frame, r]));
    let n = 0, okW = 0, okF = 0, okH = 0, bad = '';
    for (let fr = 1455; fr <= 1512; fr++) {
      const g = lr.get(fr), p = R.want[fr];
      if (!g || !p) continue;
      n++;
      const gw = [0, 1, 2, 3].map(i => fl(g.e0_want, i)), gf = Buffer.from(g.e0_bst, 'hex').readUInt32LE(4);
      const gh = g.e0_mp_layers[parseInt(g.e0_mp_head.slice(16, 18), 16)].frame;
      const wOk = Math.abs(gw[3] - p.k) < 1e-4 && (gw[3] === 0 || Math.hypot(gw[0] - p.d[0], gw[2] - p.d[2]) < 1e-4);
      if (wOk) okW++; else if (!bad) bad = `f${fr} game ${gw.map(x => x.toFixed(4))} page ${p.d.map(x => x.toFixed(4))} ${p.k.toFixed(4)}`;
      if (gf === p.fl) okF++; else if (!bad) bad = `f${fr} body+0xac game ${gf.toString(16)} page ${p.fl.toString(16)}`;
      if (fr >= 1511 || Math.fround(gh) === p.frame) okH++; else if (!bad) bad = `f${fr} head frame game ${gh} page ${p.frame}`;
    }
    ok(n === 58 && okW === n && okF === n && okH === n, `k_lunge166 f1455-1512: wanted move C+0xc0 / +0xcc ${okW}/${n}, body+0xac (0x400b6 swinging, 0x200036 after) ${okF}/${n}, MP head frame (rounded toward zero) ${okH}/${n}${bad ? ': first miss ' + bad : ''}`);
  }
  // the attack's end (record 1510: state 2): GUESS (the 'Attack end' row): the leave FUN_0059e938 runs before
  // the body move on that step, so it stops the movers first. The game's soldier then coasts (0.054 -> 0.02 u a frame, f1511-1525): the
  // body's velocity under the next state's movers, not this test's (no brain here).
  ok(R.a.C.mover !== 8 && !(R.a.C.f568 & 0x20) && R.a.C.motion?.cls !== 0x1000, `after the attack: mover ${R.a.C.mover} (not 8), C+0x568 bit 5 ${R.a.C.f568 & 0x20 ? 'set' : 'clear'}, motion 0x${(R.a.C.motion?.cls ?? 0).toString(16)}`);
}
summary();
