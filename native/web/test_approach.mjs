// Mover 3 (walk at the target: FUN_00353110 + FUN_0034edf0(C, 3), every frame FUN_003504b0) and the
// soldier's walk-mesh body (move mode 0xc, FUN_003590c8's velocity limits), path_mover.js; action layer 3
// (FUN_003667b0), enemy_ai.js (worker 0161).
//   1. hand cases: the speed scale and the end window of FUN_003504b0; the limits of FUN_003590c8 (body
//      flags bits 19 / 20 / 21); a walk from 40 u to the 20 u stop on a flat floor
//   2. the trace w161_chase (tools/trace/scripts/w161_chase.json; see test_nav_graph.mjs): FUN_003590c8's
//      velocity update (bits 19 + 21, set by mover 0xd) against the game's body+0x30 / +0x40, every frame
//      46 / 47 walk. (Mover 3 itself is not in the trace: Vincent is 260-310 u away, so the soldiers take
//      nav-graph paths; mover 3 needs him visible within 100 u.)
//   3. the AI world: a mode 5 soldier in state 7 with Vincent 40 u away and visible: action layer 3 starts
//      mover 3, he walks at Vincent and stops inside 20 u (brain state 8 -> 10 at d34 < 25).
//   node native/web/test_approach.mjs [path_mover.js]
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const PM = await import(pathToFileURL(path.resolve(process.argv[2] ?? path.join(here, 'path_mover.js'))).href);
const tracePath = path.join(process.env.TRACE_OUT ?? path.join(root, 'tools/trace/out'), 'w161_chase.jsonl');
const dataPath = path.join(here, 'data/enemies/ai.json');
const f = Math.fround;
let fail = 0;
const skipped = [];
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const skip = m => { console.log('SKIP ' + m); skipped.push(m); };
const done = () => {
  const sk = skipped.length ? ` (${skipped.length} SKIPPED: ${skipped.join('; ')})` : '';
  console.log(fail ? `${fail} FAILED${sk}` : `all ok${sk}`); process.exit(fail ? 1 : 0);
};
const DT = f(0.019999999552965164);
const mkB = () => ({ poly: 0, state: 0, vel: [0, 0, 0], want: [0, 0, 0], acc: 2.5, turn: f(4 * Math.PI), dt: DT });
const len = v => Math.hypot(v[0], v[1], v[2]);

// ------------------------------------------------ 1. hand cases
{
  // FUN_003504b0: scale 1 beyond lo + 25, 0.3 + (x - 20) 0.14 in (20, 25], 0.3 below; C+0xcc = C+0x1d4 x s / 60
  const at = d => {
    const a = { pos: [0, 0, 0], face: [0, 0, 1], C: { f1c0: 0x200, lo: 20, hi: 1000, spd: 50 }, B: mkB() };
    const r = PM.approachTest(a, [d, 5, 0]);
    return [r, a.C.wk, a.C.want];
  };
  const [r1, k1, w1] = at(100), [, k2] = at(42.5), [, k3] = at(30), [r4] = at(15), [r5] = at(1200);
  ok(r1 === 0 && k1 === f(f(50 * 1.0) * f(0.016666668)) && w1.join() === '1,0,0', `beyond lo + 25: scale 1, C+0xcc ${k1.toFixed(4)} (50 / 60), level direction ${w1}`);
  ok(Math.abs(k2 - 50 * (0.3 + 2.5 * 0.14) / 60) < 1e-6 && Math.abs(k3 - 50 * 0.3 / 60) < 1e-6, `22.5 past lo: scale 0.65 (${(k2 * 60 / 50).toFixed(3)}); 10 past: 0.3 (${(k3 * 60 / 50).toFixed(3)})`);
  ok(r4 === 1 && r5 === 1, 'ends inside lo (15 < 20) and beyond hi (1200 > 1000)');
  const [, k6] = at(50), [, k7] = at(45.01);
  ok(k6 === k1 && Math.abs(k7 - k1) < 1e-6, `30 past lo: scale 1 (${(k6 * 60 / 50).toFixed(3)}); just past 25: 1`);
  const a = { pos: [0, 0, 0], face: [0, 0, 1], C: { f1c0: 0, lo: 20, hi: 1000, spd: 50 }, B: { ...mkB(), state: 2 } };
  ok(PM.approachTest(a, [100, 0, 0]) === 0 && a.C.wk === undefined, 'airborne (C+0x1c0 bit 9 clear, body state != 6): no new direction');
  ok(PM.approachTest(a, null) === 1, 'no target: ends');
}
{
  // FUN_003590c8: bit 20 = speed change <= 2.5 x dt per frame (0.05), bit 21 = turn <= 4 pi x dt (14.4 deg)
  const B = mkB();
  PM.limitVel(B, 0x100020, [0.8, 0, 0], DT);
  ok(Math.abs(len(B.vel) - 0.05) < 1e-6 && B.vel[0] > 0, `bit 20 from rest: |v| 0.05 (${len(B.vel).toFixed(5)})`);
  B.vel = [0.5, 0, 0]; PM.limitVel(B, 0x200020, [0, 0, 0.5], DT);
  const ang = Math.atan2(B.vel[2], B.vel[0]);
  ok(Math.abs(ang - 4 * Math.PI * DT) < 1e-5 && Math.abs(len(B.vel) - 0.5) < 1e-6, `bit 21: 90 deg asked, ${(ang * 180 / Math.PI).toFixed(3)} deg turned (4 pi x dt = 14.4), |v| kept`);
  B.vel = [0.5, 0, 0]; PM.limitVel(B, 0x80020, [0.5, 0, 0.5], DT);
  ok(Math.abs(len([B.vel[0] - 0.5, 0, B.vel[2]]) - 0.05) < 1e-6 && Math.abs(B.vel[0] - 0.5) < 1e-6, 'bit 19: the vector moves 0.05 toward the wanted one');
  B.vel = [0.5, 0, 0]; PM.limitVel(B, 0x20, [0, 0, 0.5], DT);
  ok(B.vel.join() === '0,0,0.5', 'none of 19-21: the wanted velocity at once');
  B.vel = [0, 0, 0]; PM.limitVel(B, 0x200020, [0, 0, 0.5], DT);
  ok(B.vel.join() === '0,0,0.5', 'bit 21 from rest: no turn limit (angle to a zero vector is 0)');
}
{
  // mover 3 on a flat floor from 40 u: speeds up by 0.05 u / tick per frame, slows inside lo + 25, stops < 20
  const target = { pos: [0, 0, 0] };
  const a = { pos: [40, 0, 0], face: [-1, 0, 0], C: { f1c0: 0x200, f1c4: 0x104, mover: 0, mm: 0, spd: 50, f45c: 0x36, speed: 0, dir: [0, 0, 0] }, B: mkB() };
  const flat = (b, mv) => [f(b.pos[0] + mv[0]), b.pos[1], f(b.pos[2] + mv[2])];
  let placed = 0;
  PM.approachStart(a, target, 20, 1000, () => placed++);
  ok(a.C.mover === 3 && a.C.mm === 0xc && (a.C.f45c & 0x300000) === 0x300000 && (a.C.f1c0 & 0x6000) === 0x6000 && placed === 1,
     `start: mover 3, move mode 0xc, body flags |= 0x300000, C+0x1c0 |= 0x6000, body placed (${a.C.mover} ${a.C.mm} ${a.C.f45c.toString(16)})`);
  const xs = [];
  let end = -1, spdBefore = 0;
  for (let i = 0; i < 400 && end < 0; i++) {
    spdBefore = a.C.speed;
    if (PM.approachFrame(a, target.pos, 1.2, flat) === 'done') end = i;
    xs.push(a.pos[0]);
  }
  const v1 = 40 - xs[0];
  ok(Math.abs(v1 - 0.05 * 1.2) < 1e-5, `first frame: 0.05 u / tick x step 1.2 = ${v1.toFixed(5)}`);
  ok(end > 0 && a.pos[0] < 20 && a.pos[0] > 19 && a.C.mover === 0 && (a.C.f45c & 0x380000) === 0 && a.C.wk === 0,
     `stops just inside 20 u (frame ${end}, x ${a.pos[0].toFixed(3)}): mover 0, flags bits 19-21 clear, C+0xcc 0`);
  ok(spdBefore > 0 && a.C.dir[0] < -0.99, `C+0x1d8 = the measured speed the frame before the stop (${spdBefore.toFixed(2)} u/s), C+0x90 the move direction`);
  for (let i = 0; i < 5; i++) PM.approachFrame(a, target.pos, 1.2, flat);
  ok(a.C.speed === 0, `after the stop: no move, C+0x1d8 0 (${a.C.speed})`);
}

{
  // mover 3 from the air (C+0x1c0 bit 9 clear): FUN_003504b0 waits, the mode-0xc step sets bit 9 (on the
  // ground: body state 0), and the next frame walks
  const a = { pos: [0, 0, 0], face: [1, 0, 0], C: { f1c0: 0, f1c4: 0, f45c: 0x20, mover: 0, mm: 0, spd: 50, s214: 0, t: 0 }, B: mkB() };
  const tp = [0, 0, 60];
  const walk = (b, mv) => [f(b.pos[0] + mv[0]), b.pos[1], f(b.pos[2] + mv[2])];
  ok(PM.approachStart(a, { pos: tp }, 20, 1000, () => {}) && a.C.mover === 3 && a.C.mm === 0xc, 'approachStart: mover 3, move mode 0xc');
  PM.approachFrame(a, tp, 1.2, walk);
  const z1 = a.pos[2];
  ok((a.C.f1c0 & 0x200) && z1 === 0, `frame 1 airborne: no step, the body step sets C+0x1c0 bit 9 (${a.C.f1c0.toString(16)})`);
  PM.approachFrame(a, tp, 1.2, walk);
  ok(a.pos[2] > 0, `frame 2 on the ground: walks at the target (z ${a.pos[2].toFixed(4)})`);
  // turn mode 5 runs in move mode 0xc (FUN_0034ea18 turns after the move): the facing swings toward +z
  a.C.s214 = 5;
  for (let i = 0; i < 20; i++) PM.approachFrame(a, tp, 1.2, walk);
  ok(a.face[2] > 0.5, `turn mode 5 in move mode 0xc: the facing turns to the walk (face z ${a.face[2].toFixed(3)})`);
}

// ------------------------------------------------ 2. the trace: FUN_003590c8's velocity update
if (!existsSync(tracePath)) skip(`no trace ${tracePath}`);
else {
  const recs = readFileSync(tracePath, 'utf8').trim().split('\n').map(l => JSON.parse(l)).filter(r => 'frame' in r);
  const hex = h => Buffer.from(h, 'hex');
  const v4 = (b, o) => [b.readFloatLE(o), b.readFloatLE(o + 4), b.readFloatLE(o + 8)];
  // FUN_003590c8 limits body+0x40, then FUN_00357d48 may rewrite it to the walk's corrected move scaled to
  // that speed (FUN_0035a440 returned 1: contacts, not translated; player.js pushIn). So: |body+0x40| on
  // every frame, the whole vector on the frames without that rewrite.
  let n = 0, spd = 0, vec = 0, worst = 0, at = null;
  for (let i = 1; i < recs.length; i++) for (const e of ['e0', 'e1']) {
    const st = hex(recs[i][e + '_bst']), fl = st.readUInt32LE(4);
    if (st.readUInt32LE(0) !== 0 || !(fl & 0x20) || !(fl & 0x280000)) continue;
    if (hex(recs[i][e + '_mv']).readUInt32LE(8) !== 0xc) continue;
    if (recs[i][e + '_c430'].slice(0, 3).some(x => x !== 0)) continue;     // the actor push enters too
    const prev = v4(hex(recs[i - 1][e + '_bvel']), 0x10), want = v4(hex(recs[i][e + '_bvel']), 0), got = v4(hex(recs[i][e + '_bvel']), 0x10);
    const B = { ...mkB(), vel: prev };
    PM.limitVel(B, fl, want, DT);
    const ds = Math.abs(len(B.vel) - len(got));
    n++;
    if (ds < 1e-4) spd++;
    if (len([B.vel[0] - got[0], B.vel[1] - got[1], B.vel[2] - got[2]]) < 1e-4) vec++;
    if (ds > worst) { worst = ds; at = `f${recs[i].frame} ${e}`; }
  }
  ok(n > 300 && spd / n > 0.99, `|body+0x40| = |FUN_003590c8(body+0x40 before, body+0x30, flags 0x280036: bits 19 + 21)|: ${spd}/${n} frames within 1e-4 (worst ${worst.toExponential(2)} at ${at})`);
  ok(vec / n > 0.6, `the whole vector on ${vec}/${n} frames (the rest: FUN_00357d48's contact rewrite)`);
}

// ------------------------------------------------ 3. the AI world: action layer 3 -> mover 3
if (!existsSync(dataPath)) { skip('data/enemies/ai.json missing (build_web.sh)'); done(); }
{
  const AI = await import(pathToFileURL(path.join(here, 'enemy_ai.js')).href);
  const data = JSON.parse(readFileSync(dataPath, 'utf8'));
  const rec = data.records[46];
  // a flat walk mesh at the soldier's height (locate / navMove as collision.js)
  const mesh = { locate: () => [0, rec.pos[1]], navMove: (pi, x, y, z, dx, dz) => [x + dx, y, z + dz, pi, false, false] };
  const player = { pos: [rec.pos[0] + 40, rec.pos[1], rec.pos[2]], hp: 780, id: 0x16, f118: 0, s64: 0 };
  const W = AI.createEnemyAI({ data, player, rand: () => 0.5, quiet: true, log: () => {}, walkMesh: mesh });   // los default: nothing blocks the view
  const a = W.addActor({ rec: 46, astate: 3, f118: 0, face: [1, 0, 0] });
  W.t.setTarget(a.ai, player);
  W.t.setMode(a.ai, 5);
  a.ai.bstate = 7;
  const log = [];
  let moved = null, stop = null, prevMover = 0;
  for (let i = 0; i < 600; i++) {
    const ev = W.tick(1.2, player.pos, player.pos);
    const d = Math.hypot(player.pos[0] - a.pos[0], player.pos[2] - a.pos[2]);
    if (moved == null && a.C.mover === 3) moved = i;
    // the walk-in ends with mover 3's own end inside 20 u, or earlier with the swing: the attack pick inside 22 u
    // (d34) while mover 3 still runs, whose op 0 (FUN_003481e0 case 0 -> FUN_0034edf0(C, 8)) replaces mover 3
    // with mover 8 (the game: k_inview17d #66, mover 0xd -> 8 at f1803). rand 0.5: the swing, at 21.4 u.
    if (!stop && (ev.some(e => e === `approach end ${a.id}`) || (a.astate >= 0x80 && a.astate < 0xc0 && prevMover === 3 && a.C.mover === 8)))
      stop = [i, d, a.C.mover];
    prevMover = a.C.mover;
    log.push([a.ai.bstate, a.ai.amode, a.ai.astate28, a.C.mover, d, a.pos[1]]);
  }
  const d = Math.hypot(player.pos[0] - a.pos[0], player.pos[2] - a.pos[2]);
  ok(moved != null, `mode 5 state 7 -> action layer 3 -> mover 3 with Vincent 40 u away and in view (frame ${moved})`);
  ok(stop && (stop[2] === 8 ? stop[1] < 22.0 && stop[1] > 20.0 : stop[1] < 20.0 && stop[1] > 19.0),
     `walks in; mover 3 ends ${stop && stop[2] === 8 ? 'with the swing (mover 8) inside 22 u' : 'just inside 20 u'} (frame ${stop && stop[0]}, ${stop && stop[1].toFixed(2)} u)`);
  // after the stop he stays where he stopped (inside 22 u) until brain 5 hands him to layer 5 (away from the target, mode 3) or 6
  // (reposition, mode 2): any later walk is mover 0xd under one of those, never mover 3 again from outside
  // (until his own bullets cross trigger 77, whose script 127 puts him on stage path 5: mover 1, the path's heights)
  const after0 = stop ? log.slice(stop[0] + 1) : [];
  const wake = after0.findIndex(x => x[3] === 1);
  const after = wake < 0 ? after0 : after0.slice(0, wake);
  const out = after.findIndex(x => x[4] > 22.5);
  ok(stop && (out < 0 || after.slice(0, out + 1).some(x => (x[1] === 5 || x[1] === 6) && x[3] === 0xd)) && after.every(x => Math.abs(x[5] - rec.pos[1]) < 1e-4),
     `after the stop: inside 22 u until layer 5 / 6 move him (mover 0xd; layers seen ${[...new Set(after.map(x => x[1]))]} over ${after.length} frames${wake < 0 ? '' : ', then trigger 77 wakes him onto path 5'}; the walk mesh keeps his height)`);
  // with the attack table: the pick inside 22 u during the walk-in; the swing's mover 8 takes over mover 3
  {
    const pl = { pos: player.pos.slice(), hp: 780, id: 0x16, f118: 0, s64: 0 };
    const Wa = AI.createEnemyAI({ data, player: pl, rand: () => 0.5, quiet: true, log: () => {}, walkMesh: mesh });
    const b = Wa.addActor({ rec: 46, astate: 3, f118: 0, face: [1, 0, 0] });
    Wa.t.setTarget(b.ai, pl); Wa.t.setMode(b.ai, 5); b.ai.bstate = 7;
    let swap = null, prev = 0;
    for (let i = 0; i < 200 && !swap; i++) {
      Wa.tick(1.2, pl.pos, pl.pos);
      if (b.astate >= 0x80 && b.astate < 0xc0) swap = { before: prev, now: b.C.mover, d: Math.hypot(pl.pos[0] - b.pos[0], pl.pos[2] - b.pos[2]) };
      prev = b.C.mover;
    }
    ok(swap && swap.before === 3 && swap.now === 8 && swap.d < 22, `with the attack table: the swing starts at ${swap?.d?.toFixed(1)} u (< 22) during mover ${swap?.before} (3) and replaces it with mover ${swap?.now} (8: the root motion)`);
  }
  // case 3 sees the mover end (C+0x300 = 0) -> state 0 -> 1 -> 4 (inside 22 u)
  ok(stop && log.slice(stop[0]).some(x => x[1] === 3 && (x[2] === 0 || x[2] === 4)), `after the stop: case 3 -> state 0 (mover ended) -> 4 (states ${[...new Set(log.slice(stop ? stop[0] : 0).filter(x => x[1] === 3).map(x => x[2]))]})`);
  ok(log.some(x => x[0] === 10 || x[0] === 0xb || x[0] === 0xe), `brain 5 leaves state 8 once d34 < 25 (states seen ${[...new Set(log.map(x => x[0]))].join(',')})`);
  // hits during / after mover 3, with and without a spline left over from a path walk (records 46 / 47
  // walk one at the wake): the slide runs (mode 0xc stays, FUN_0034f178 cases 9 / 0xb), no bodyFrame, no snap
  const P = [rec.pos[0] - 500, rec.pos[1], rec.pos[2]];
  for (const when of ['during', 'after']) for (const left of [false, true]) for (const hit of ['flinch', 'die']) {
    const pl = { pos: [rec.pos[0] + (when === 'during' ? 60 : 40), rec.pos[1], rec.pos[2]], hp: 780, id: 0x16, f118: 0, s64: 0 };
    const W3 = AI.createEnemyAI({ data, player: pl, rand: () => 0.5, quiet: true, log: () => {}, walkMesh: mesh });
    const b = W3.addActor({ rec: 46, astate: 3, f118: 0, face: [1, 0, 0] });
    W3.t.setTarget(b.ai, pl); W3.t.setMode(b.ai, 5); b.ai.bstate = 7;
    if (left) Object.assign(b.C, { poly: [P, P], arcs: [0, 1], n204: 2, cp: [P, P, P, P], arcLen: 1, dur: 1, t: 0, i200: 0, seg: 1, tension: 0 });
    let n = 0;
    for (; n < 600; n++) { W3.tick(1.2, pl.pos, pl.pos); if (when === 'during' ? b.C.mover === 3 : (b.C.mover === 0 && b.C.mm === 0xc && b.ai.astate28 !== 3 && n > 30)) break; }
    const tag = `hit ${when} the approach${left ? ', spline left' : ''}, ${hit}`;
    if (n === 600) { ok(false, `${tag}: setup never reached`); continue; }
    const st = { f45c: b.C.f45c, f1c4: b.C.f1c4 };
    const p0 = b.pos.slice();
    let err = null, maxStep = 0, last = p0;
    try {
      W3.t[hit](b, [-1, 0, 0]);
      for (let i = 0; i < 60; i++) {
        W3.tick(1.2, pl.pos, pl.pos);
        maxStep = Math.max(maxStep, Math.hypot(b.pos[0] - last[0], b.pos[2] - last[2])); last = b.pos.slice();
      }
    } catch (e) { err = e.message; }
    const moved = Math.hypot(b.pos[0] - p0[0], b.pos[2] - p0[2]);
    ok(!err && maxStep < 5 && moved < 40 && b.C.mm === 0xc, `${tag}: no throw, slide only (max ${maxStep.toFixed(2)} u/frame, ${moved.toFixed(2)} u, mode ${b.C.mm}${err ? ', ' + err : ''})`);
    if (when === 'during' && hit === 'flinch' && !left)
      ok((st.f45c & 0x300000) === 0x300000 && !(b.C.f45c & 0x380000) && (b.C.f1c4 & 0x100), `flinch slide ends mover 3 through FUN_00352a60 (body flags ${b.C.f45c.toString(16)}, C+0x1c4 bit 8)`);
  }

  // Vincent out of view beyond 100 u during mover 3: case 3 -> state 1; the nav branch's FUN_0055a628 ends
  // mover 3 and starts mover 0xd (a nav-graph path toward Vincent's node), state 2
  {
    const pl = { pos: [rec.pos[0] + 60, rec.pos[1], rec.pos[2]], hp: 780, id: 0x16, f118: 0, s64: 0 };
    let blocked = false;
    const W4 = AI.createEnemyAI({ data, player: pl, rand: () => 0.5, quiet: true, log: () => {}, walkMesh: mesh, los: () => blocked });
    const b = W4.addActor({ rec: 46, astate: 3, f118: 0, face: [1, 0, 0] });
    W4.t.setTarget(b.ai, pl); W4.t.setMode(b.ai, 5); b.ai.bstate = 7;
    for (let i = 0; i < 15; i++) W4.tick(1.2, pl.pos, pl.pos);
    const on = b.C.mover === 3;
    b.C.f1c0 = (b.C.f1c0 & ~0x10) >>> 0;
    blocked = true; pl.pos = [rec.pos[0] + 300, rec.pos[1], rec.pos[2] + 50];
    const p0 = b.pos.slice(), seen = new Set();
    for (let i = 0; i < 400; i++) { W4.tick(1.2, pl.pos, pl.pos); if (b.ai.amode === 3) seen.add(b.ai.astate28); }
    const walked = Math.hypot(b.pos[0] - p0[0], b.pos[2] - p0[2]);
    ok(on && seen.has(1) && seen.has(2), `out of view at 300 u: state 3 -> 1 -> 2 (states ${[...seen]})`);
    ok(b.C.mover === 0xd || walked > 5, `mover 3 ended, mover 0xd follows the graph (mover ${b.C.mover}, ${walked.toFixed(2)} u walked)`);
  }
  // FUN_00563d20 draws once per nav-branch run when Vincent's node has a free neighbour; Vincent's node is
  // tracked each frame (FUN_00573c60 -> FUN_00563970). Far from every node (no node within 40 u): no draw
  if (data.nav) {
    const NG = await import(pathToFileURL(path.join(here, 'nav_graph.js')).href);
    const G = NG.makeGraph(data.nav);
    const vp = [rec.pos[0] + 60, rec.pos[1], rec.pos[2] + 120];
    const vn = NG.nearestNode(G, vp);
    const run = far => {
      const pl = { pos: far ? [1e5, 0, 1e5] : vp.slice(), hp: 780, id: 0x16, f118: 0, s64: 0 };
      const W5 = AI.createEnemyAI({ data, player: pl, rand: () => 0.5, quiet: true, log: () => {}, walkMesh: mesh, los: () => true });
      const b = W5.addActor({ rec: 46, astate: 3, f118: 0, face: [1, 0, 0] });
      W5.t.setTarget(b.ai, pl); W5.t.setMode(b.ai, 5); b.ai.bstate = 7;
      for (let i = 0; i < 100 && !b.C.nreq; i++) W5.tick(1.2, pl.pos, pl.pos);
      return [pl.node108, b.C.nreq ? b.C.nreq.goal : null];
    };
    const [nn, g0] = run(true), [vn1, g1] = run(false);
    const nbs = new Set(Array.from({ length: G.nodes[vn][3] }, (_, k) => NG.neighbour(G, vn, k)));
    ok(vn1 === vn && nbs.has(g1), `Vincent's node tracked (${vn1}); the request's goal ${g1} is a neighbour of it (FUN_00563d20)`);
    ok(nn === -1 && g0 === -1, `far from every node: no node, goal -1 (${nn}, ${g0})`);
  } else skip('ai.json has no nav block');
  // FUN_00360aa8 busy (C+0x564 bit 14 here): any state -> 0
  {
    const pl = { pos: [rec.pos[0] + 60, rec.pos[1], rec.pos[2]], hp: 780, id: 0x16, f118: 0, s64: 0 };
    const W6 = AI.createEnemyAI({ data, player: pl, rand: () => 0.5, quiet: true, log: () => {}, walkMesh: mesh });
    const b = W6.addActor({ rec: 46, astate: 3, f118: 0, face: [1, 0, 0] });
    W6.t.setTarget(b.ai, pl); W6.t.setActionLayer(b.ai, 3);
    b.ai.astate28 = 3; b.C.f564 = (b.C.f564 | 0x4000) >>> 0;
    W6.t.action3(b.ai);
    ok(b.ai.astate28 === 0, `busy (C+0x564 bit 14): state 3 -> 0 (${b.ai.astate28})`);
    b.C.f564 = (b.C.f564 & ~0x4000) >>> 0;
    // state 3 with the mover ended (C+0x300 = 0), Vincent in view at 50 u: -> 0
    b.ai.flags |= 2; b.ai.d34 = 50; b.ai.d38 = 50; b.C.mover = 0; b.ai.astate28 = 3;
    W6.t.action3(b.ai);
    ok(b.ai.astate28 === 0, `state 3, mover ended: -> 0 (${b.ai.astate28})`);
    // state 4 waits 0x3d ticks from the layer time (FUN_0035eb68)
    W6.t.setActionLayer(b.ai, 3); b.ai.astate28 = 4;
    W6.t.action3(b.ai);
    ok(b.ai.astate28 === 4, `state 4 at 0 ticks: waits (${b.ai.astate28})`);
    // state 1, out of view at 300 u: the nav branch's mode 1 request sets C+0x1c0 bit 4
    b.ai.flags &= ~2; b.ai.d34 = 300; b.ai.d38 = 300; b.ai.astate28 = 1; b.C.f1c0 = (b.C.f1c0 & ~0x10) >>> 0;
    W6.t.action3(b.ai);
    ok((b.C.f1c0 & 0x10) !== 0 || b.ai.astate28 === 2, `state 1 nav branch: a path (mode 1 sets C+0x1c0 bit 4), state ${b.ai.astate28}, mover ${b.C.mover}`);
  }
  // state 4 waits 0x3d ticks (FUN_0035eb68) before state 1
  {
    const pl = { pos: [rec.pos[0] + 15, rec.pos[1], rec.pos[2]], hp: 780, id: 0x16, f118: 0, s64: 0 };
    const W7 = AI.createEnemyAI({ data, player: pl, rand: () => 0.5, quiet: true, log: () => {}, walkMesh: mesh });
    const b = W7.addActor({ rec: 46, astate: 3, f118: 0, face: [1, 0, 0] });
    W7.t.setTarget(b.ai, pl); W7.t.setMode(b.ai, 5); b.ai.bstate = 7;
    let t4 = null, gap = null, tk = 0;
    for (let i = 0; i < 200 && gap == null; i++) {
      W7.tick(1.2, pl.pos, pl.pos); tk += 1.2;
      if (b.ai.amode !== 3) continue;
      if (b.ai.astate28 === 4 && t4 == null) t4 = tk;
      if (b.ai.astate28 === 1 && t4 != null) gap = tk - t4;
    }
    ok(gap != null && gap >= 0x3d - 1.2, `state 4 holds ${gap && gap.toFixed(1)} ticks (>= 0x3d) before state 1`);
  }
  // the same at 15 u (state 4: no mover) and at 40 u out of view (the nav-graph branch: state 2, mover 0xd)
  for (const [dist, los, want] of [[15, undefined, 4], [40, () => true, 2]]) {
    const pl = { pos: [rec.pos[0] + dist, rec.pos[1], rec.pos[2]], hp: 780, id: 0x16, f118: 0, s64: 0 };
    const W2 = AI.createEnemyAI({ data, player: pl, rand: () => 0.5, quiet: true, log: () => {}, walkMesh: mesh, los });
    const b = W2.addActor({ rec: 46, astate: 3, f118: 0, face: [1, 0, 0] });
    W2.t.setTarget(b.ai, pl); W2.t.setMode(b.ai, 5); b.ai.bstate = 7;
    const seen = new Set();
    let mv = false;
    // an approach mover (3 / 0xd); his swing at 15 u runs mover 8, which has no root track here (no lunge)
    for (let i = 0; i < 40; i++) { W2.tick(1.2, pl.pos, pl.pos); if (b.ai.amode === 3) seen.add(b.ai.astate28); mv ||= b.C.mover === 3 || b.C.mover === 0xd; }
    // (the swing's move mode 0xc stores his position as the game's f32, rounded toward zero: compare within 1e-3)
    if (want === 4) ok(!mv && seen.has(want) && Math.abs(b.pos[0] - rec.pos[0]) < 1e-3, `${dist} u: action layer 3 state 4, no approach mover (states ${[...seen]})`);
    else ok(seen.has(want) && b.C.mover === 0xd, `${dist} u, out of view: action layer 3 state 2 on mover 0xd (states ${[...seen]}, mover ${b.C.mover})`);
  }
}
done();
