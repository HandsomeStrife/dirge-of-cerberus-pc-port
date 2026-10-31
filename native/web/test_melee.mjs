// The soldiers' melee hit (enemy_ai.js makeAttack / attackObjUpdate: FUN_00569dc0 -> FUN_00541310, the
// attack object FUN_0057a330 / FUN_0057a428 / FUN_0057a830, sphere test FUN_0057b8b8 -> FUN_0055c5f8 ->
// FUN_0025db68, damage FUN_0055eac8) against the PCSX2 trace k_melee18 (tools/trace/out; game-derived,
// gitignored; TRACE_FIELDSET=path TRACE_MELEE=1 TRACE_CALLLOG=melee, see tools/trace/scripts/k_melee18.json):
// #66 (record 44) swings r_atk_0 at Vincent from 20 u (actor state 0x80 at f1455), the volume is made at
// f1460, tests Vincent's capsule at f1463 and hits: HP 560 -> 511.
// Plus hand cases that run without the trace: the sphere / capsule edges, the end caps, one hit per swing,
// the life, the repeat flag, the damage maths and the other types' records.
//   node native/web/test_melee.mjs [enemy_ai.js]       (STRICT=1: known gaps fail too)
// Known gap: the game's #66 lunges ~7 u during r_atk_0 (clip root motion, mover 8: not ported), so the
// page's swing from 20 u can't reach Vincent; the trace replay feeds the game's soldier position.
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
function world({ ppos = [0, 0, 0], at = [0, -9, -3], c1, every, rec = 44, mutVol = null } = {}) {
  const player = { pos: ppos.slice(), hp: 780, id: 0x16, f118: 0 };
  const d2 = mutVol ? JSON.parse(JSON.stringify(data)) : data;
  if (mutVol) mutVol(d2);
  const W = AI.createEnemyAI({ data: d2, player, quiet: true, rand: () => 0.5 });
  const a = W.addActor({ rec, mode: 0, pos: [0, 0, -40], face: [0, 0, 1], clip: 'r_st_a' });
  const pose = { at: at.slice() };
  W.boneWorld = () => () => [[1, 0, 0], [0, 1, 0], [0, 0, 1], pose.at];
  const T = d2.attacks[String(d2.records[rec].zones)];
  if (c1 != null) T.volumes[0].c1 = c1;
  if (every != null) T.volumes[0].every = every;
  return { W, a, player, T, pose };
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
  ok(drops.join() === '0,5,10', `repeat bit 2, +0x13c 5: hits at updates ${drops} (0,5,10), life 16 ends it at 14`);
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
  // k - 1: the soldier there and r_atk_0 at clip frame (k - 1 - 1455) x 0.6 (FUN_005aa2a8: rate 0.5 x step 1.2)
  let cur = byF.get(1455);
  W.boneWorld = () => bb => { const s = soldier(cur), P = modelPose(e027, e027d, 'r_atk_0', f((cur.frame - 1455) * 0.6)); return boneRows(P.R[bb], P.S[bb], P.P[bb], s.pos, s.face); };
  W.t.setActorState(a, 0x80);
  let madeAt = null, hitAt = null, hpAt = {}, lifeAt1462 = null;
  for (let fr = 1455; fr <= 1470; fr++) {
    cur = byF.get(fr - 1) || byF.get(fr);
    const s = soldier(cur); a.pos = s.pos; a.face = s.face;        // open loop: the lunge (root motion) is not ported
    player.pos = vinc(cur);
    const ev = fr === 1455 ? [] : W.tick(1.2, player.pos, player.pos);
    if (madeAt == null && ev.some(x => x.startsWith(`attack object ${a.id}`))) madeAt = fr;
    if (fr === 1462) lifeAt1462 = W.attackObjs[0]?.life;
    if (hitAt == null && ev.some(x => x.startsWith(`melee hit player ${a.id}`))) hitAt = fr;
    hpAt[fr] = player.hp;
  }
  ok(madeAt === 1460 && Math.abs(lifeAt1462 - 13.6) < 1e-5, `page: volume made f${madeAt} (1460), life ${lifeAt1462} after f1462 (13.6 as the game: first update the frame after the make)`);
  ok(hitAt === 1463 && hpAt[1462] === 560 && hpAt[1463] === 511 && hpAt[1470] === 511, `page (game's positions fed in): hit f${hitAt} (1463), HP ${hpAt[1462]} -> ${hpAt[1463]} (560 -> 511), one hit (${hpAt[1470]} at f1470)`);
  // the centre at f1463 against the game's (FUN_0025db68 a0): marker 15 / bone 26 + (0, 0, 3) through the page's pose
  cur = byF.get(1462);
  const B = W.boneWorld(a)(26), c = [0, 1, 2].map(k => 3 * B[2][k] + B[3][k]), g = sph[0]['a0+0x0'].f;
  const dc = Math.hypot(c[0] - g[0], c[1] - g[1], c[2] - g[2]);
  ok(dc < 0.01, `page volume centre f1463 (${c.map(x => x.toFixed(3))}) vs game (${g.slice(0, 3)}): ${dc.toFixed(4)} u (< 0.01: marker 15 / bone 26 + (0, 0, 3), r_atk_0 frame 4.2)`);
  const ga = sph[0]['a1+0x0'].f, gb = sph[0]['a2+0x0'].f, pv = vinc(byF.get(1462));
  ok(Math.hypot(ga[0] - pv[0], ga[1] - pv[1], ga[2] - pv[2]) < 1e-3 && Math.abs(gb[1] - (ga[1] - 18)) < 1e-3, `Vincent's capsule = feet .. feet - 18 y (game a ${ga.slice(0, 3)}, b y ${gb[1]})`);
}
// the soldier lunges in the game: 20.0 u at f1454 -> 12.9 u at f1462 (r_atk_0 root motion, mover 8): MISSING on the page
{
  const d = fr => { const r = byF.get(fr), s = soldier(r), p = vinc(r); return Math.hypot(s.pos[0] - p[0], s.pos[2] - p[2]); };
  gap(false, `attack clip root motion (op 0 byte 6 bits 0-2 -> mover 8, C+0x310): game #66 closes ${d(1454).toFixed(1)} -> ${d(1462).toFixed(1)} u during the swing; the page soldier stands, so its swing from 20 u misses`);
}
summary();
