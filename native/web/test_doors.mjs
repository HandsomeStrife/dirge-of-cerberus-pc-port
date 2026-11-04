// test_doors.mjs -- the doors (worker 0257; notes/battle-camera.md 'The doors'): script 149 / trigger 12's state, chunk 6's animation, class 3 record 6's box, the room's ranges.
//   node --import ./native/web/test_hooks.mjs native/web/test_doors.mjs
// Against w257_door2 (tools/trace/out, game-derived; TRACE_RAW of the door's anim times, record 6, trigger 12) when it is there: the page's state and box frame by frame.
import { readFileSync, existsSync } from 'node:fs';
const J = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const { ChunkAnims } = await import(new URL('./chunk_anim.js', import.meta.url).href);
const { createProps } = await import(new URL('./props.js', import.meta.url).href);
const { createEnemyAI } = await import(new URL('./enemy_ai.js', import.meta.url).href);
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const pd = J('./data/props/props.json'), ai = J('./data/enemies/ai.json');
const newWorld = (P = [-1328.9, 0, 1134.0]) => {
  const anims = new ChunkAnims(pd.chunkAnims);
  const props = createProps({ data: pd, areas: { has: k => k >= 0 }, warn: () => {} });
  const W = createEnemyAI({ data: ai, player: { pos: P, hp: 780, id: 0x16, f118: 0, s64: 0 }, rand: () => 0.5, quiet: true, props, chunkAnims: anims });
  props.areaSwitch(13, true); W.areaSwitch(13, true);
  W.mshort[78] = 1;                      // manager short 78 (script 149 event 0x11; T: its value at the door)
  return { anims, props, W, P };
};
const frame = (w) => { w.W.tick(1.2, w.P, w.P); w.anims.frame([0, 5, 6, 11], 1.2); };
const T12 = w => w.W.triggers[12], B6 = w => w.props.camBoxes.find(b => b.rec === 6);
// the box at rest equals its record, every class 3 box whose chunk is loaded
{
  const anims = new ChunkAnims(pd.chunkAnims); anims.frame(null, 1.2);
  let worst = 0, n = 0;
  for (const b of pd.camBoxes) {
    const N = anims.node(b.chunk, b.node); if (!N) continue;
    n++; for (let j = 0; j < 3; j++) worst = Math.max(worst, Math.abs(b.rec50[3][0] * N[0][j] + b.rec50[3][1] * N[1][j] + b.rec50[3][2] * N[2][j] + N[3][j] - b.m[3][j]));
  }
  ok(n >= 5 && worst < 0.01, `record +0x50 x the node's file matrix = the record's matrix, ${n} moved-node boxes (worst ${worst.toFixed(4)} u)`);
}
// choosing: facing the door from the near side, a z face; facing away, none
{
  const w = newWorld(), O = [-1328.9, -7, 1134.5];
  const c = w.W.gimmickChoose(O, [0, 0, 1]);
  ok(c && c.o === T12(w) && c.face === 4, `facing +z at the door: trigger 12, face ${c && c.face} (T: +0xd0 bits 4)`);
  { const c2 = w.W.gimmickChoose([-1327.45 - 7.46 - 3, -7, 1140.36], [1, 0, 0]); ok(!c2 || c2.o !== T12(w), 'facing its end (an x face): shape 3 takes z faces only'); }
  ok(!w.W.gimmickChoose(O, [0, 0, -1]) || w.W.gimmickChoose(O, [0, 0, -1]).o !== T12(w), 'facing away: not trigger 12');
  ok(!w.W.gimmickChoose([-1328.9, -7, 1120], [0, 0, 1]) || w.W.gimmickChoose([-1328.9, -7, 1120], [0, 0, 1]).o !== T12(w), 'out of the 7 unit reach: not trigger 12');
}
// the state: ✕ -> mail -> event 2 -> 0x168(15) -> FUN_0057c728 -> open after 15 ticks; camera, bullets by state
{
  const w = newWorld();
  ok(T12(w).e0 === 0 && T12(w).use, 'trigger 12 starts shut, takes ✕');
  const sh = (a, b) => w.W.cameraObjects(a, b);
  const A = [-1328, -12, 1125], Bp = [-1328, -12, 1155];
  ok(!!sh(A, Bp), 'shut: the camera stops on the door');
  w.W.gimmickUse({ o: T12(w), face: 4 });
  const seq = [];
  for (let f = 1; f <= 20; f++) { frame(w); seq.push(T12(w).e0); }
  const first2 = seq.indexOf(2) + 1, first1 = seq.indexOf(1) + 1;
  ok(first2 === 1, `state 2 the frame after ✕ (T f426 -> f427): frame ${first2}`);
  ok(first1 - first2 === 13, `state 1 ${first1 - first2} frames after state 2 (T f427 -> f440: 13)`);
  ok(T12(w).vars[0] === 1, `face 4 -> the side var 1 -> animation 6 (T): ${T12(w).vars[0]}`);
  const pos = B6(w).m[3];
  ok(Math.abs(pos[0] + 1334.37) < 0.02 && Math.abs(pos[2] - 1146.66) < 0.02, `open: record 6's box at (${pos[0].toFixed(2)}, ${pos[2].toFixed(2)}) (T -1334.37, 1146.66)`);
  ok(!w.props.cameraProbe(A, Bp), 'open: a ray through the doorway passes (the box swung with the door, the trigger off)');
}
// the review's walk: r06_door2 -> r06_door3 with the door open: the look-through ray from z 1142 and z 1154 is free
{
  const w = newWorld(); w.W.gimmickUse({ o: T12(w), face: 4 });
  for (let f = 0; f < 20; f++) frame(w);
  for (const z of [1142, 1154]) ok(!w.W.cameraObjects([-1328.5, -16, z], [-1328.5, -16, z - 30]), `open: from z ${z} back through the door: no stop`);
}
// the other doors: their last pose = route RAM (r07_toujou, r06_back, r0b_walk), through FUN_00327a30(-1, ..), then FUN_00263e90's frame
{
  const check = (chunk, anim, rec, X, Z, st) => {
    const anims = new ChunkAnims(pd.chunkAnims); anims.frame([chunk], 1.2); anims.pose(-1, chunk, anim); anims.frame([chunk], 1.2);
    const b = pd.camBoxes.find(q => q.rec === rec), N = anims.node(b.chunk, b.node);
    const x = b.rec50[3][0] * N[0][0] + b.rec50[3][2] * N[2][0] + N[3][0], z = b.rec50[3][0] * N[0][2] + b.rec50[3][2] * N[2][2] + N[3][2];
    ok(Math.hypot(x - X, z - Z) < 0.2, `record ${rec}, chunk ${chunk} animation ${anim}'s end: (${x.toFixed(1)}, ${z.toFixed(1)}) (RAM ${st}: ${X}, ${Z})`);
  };
  check(6, 2, 5, -1745.2, 1570.5, 'r07_toujou');
  check(6, 1, 7, -1138.2, 1132.9, 'r06_back');
  check(11, 1, 10, 467.7, 1435.2, 'r0b_walk');
  check(11, 1, 11, 467.6, 1498.0, 'r0b_walk');
}
// a Restart (a new world): the nodes back in their files, the list empty
{
  const w = newWorld(); w.W.gimmickUse({ o: T12(w), face: 4 });
  for (let f = 0; f < 20; f++) frame(w);
  const w2 = { ...w, props: createProps({ data: pd, areas: { has: k => k >= 0 }, warn: () => {} }) };
  w2.W = createEnemyAI({ data: ai, player: { pos: w.P, hp: 780, id: 0x16, f118: 0, s64: 0 }, rand: () => 0.5, quiet: true, props: w2.props, chunkAnims: w.anims });
  w.anims.frame([0, 5, 6], 1.2);
  const N = w.anims.node(6, 1);
  ok(Math.abs(N[0][0] - 1) < 1e-5 && w.anims.list.length === 0, `Restart: door node at rest, list ${w.anims.list.length}`);
}
// bullets: a shut door and a class 3 box stop them; the open door doesn't
{
  const w = newWorld(), b = { prev: [-1328, -12, 1125], pos: [-1328, -12, 1155], f120: 4, shooter: 0x16, age: 1 };
  const d = w.W.doorBullet(b);
  ok(d && d.o === T12(w) && Math.abs(d.point[2] - 1139.104) < 0.01, `a bullet stops on the shut door (z ${d && d.point[2].toFixed(2)})`);
  const r = pd.camBoxes.find(q => q.rec === 14), p = r.m[3];
  w.anims.frame([0, 5, 6], 1.2);
  const h = w.props.bulletTest({ prev: [p[0], p[1], p[2] - 30], pos: [p[0], p[1], p[2]], f120: 4, shooter: 0x16, age: 1 });
  ok(h && h.o.rec === 14 && Math.abs(h.point[2] - (p[2] - r.size[2] / 2)) < 0.01, `a bullet stops on class 3 record 14 (z ${h && h.point[2].toFixed(2)})`);
  ok(w.props.bulletHit(h, { prev: [0, 0, 0], pos: [0, 0, 0], f120: 4, shooter: 0x16, age: 1, kind: 0, damage: 100 }) === 1 && h.o.hp === 1, 'it ends the bullet, no damage (type flag bit 2 clear)');
  w.W.gimmickUse({ o: T12(w), face: 4 }); for (let f = 0; f < 20; f++) frame(w);
  ok(!w.W.doorBullet(b), 'open: the bullet passes the door box');
}
// the card gates: flags bit 4, no bit 3: ✕ with the origin in the box (FUN_005503e8 l.51, FUN_005513c8)
{
  const w = newWorld();
  for (const k of [152, 153, 157, 192]) {
    const t = ai.triggers[k], c = t.m[3], mid = [0, 1, 2].map(j => (t.lo[j] + t.hi[j]) / 2), O = [0, 1, 2].map(j => c[j] + mid[0] * t.m[0][j] + mid[1] * t.m[1][j] + mid[2] * t.m[2][j]);
    const o = w.W.triggers[k]; o.active = true;
    const h = w.W.gimmickChoose(O, [0, 0, 1]);
    ok(h && h.o === o && h.face === -1, `gate trigger ${k} (flags ${t.flags}): origin in the box: chosen, r0 = -1`);
    const out = [O[0] + t.m[0][0] * (t.hi[0] - t.lo[0]), O[1], O[2] + t.m[0][2] * (t.hi[0] - t.lo[0])];
    const g = w.W.gimmickChoose(out, [0, 0, 1]);
    ok(!g || g.o !== o, `gate trigger ${k}: origin outside: no`);
  }
  // FUN_00544960: the lower +0x4f wins whatever the distance: shape 3 over shape 0
  const A = w.W.triggers[153], D = T12(w);
  ok(A.f4f === 2 && D.f4f === 1, `+0x4f: gate ${A.f4f}, door ${D.f4f}`);
  // two at the same origin: the same +0x4f, the nearer; a lower +0x4f, the farther
  const g = w.W.triggers[152], g2 = w.W.triggers[157], t = g.t, O = [0, 1, 2].map(j => t.m[3][j] + (t.lo[0] + t.hi[0]) / 2 * t.m[0][j] + (t.lo[1] + t.hi[1]) / 2 * t.m[1][j] + (t.lo[2] + t.hi[2]) / 2 * t.m[2][j]);
  g.active = g2.active = true; g2.t = { ...t, m: [t.m[0], t.m[1], t.m[2], [t.m[3][0] + 3, t.m[3][1], t.m[3][2], 1]] };
  ok(w.W.gimmickChoose(O, [0, 0, 1]).o === g, 'FUN_00544960: the same +0x4f: the nearer');
  { const g0 = g.t; g.t = { ...t, m: [t.m[0], t.m[1], t.m[2], [t.m[3][0] + 6, t.m[3][1], t.m[3][2], 1]] };
    ok(w.W.gimmickChoose(O, [0, 0, 1]).o === g2, 'FUN_00544960: the same +0x4f: the nearer, the later in the list'); g.t = g0; }
  g2.f4f = 1; ok(w.W.gimmickChoose(O, [0, 0, 1]).o === g2, 'FUN_00544960: the lower +0x4f wins, farther');
  g2.f4f = 2; g2.t = ai.triggers[157];
  // FUN_005513c8: a ray only with bit 3, the origin in the box only with bit 4
  { const gt = ai.triggers[153], m = gt.m, n = [0, 1, 2].map(j => m[3][j] + (gt.lo[0] + gt.hi[0]) / 2 * m[0][j] + (gt.lo[1] + gt.hi[1]) / 2 * m[1][j] + (gt.lo[2] - 2) * m[2][j]);
    w.W.triggers[153].active = true; const h = w.W.gimmickChoose(n, [m[2][0], m[2][1], m[2][2]]);
    ok(!h || h.o !== w.W.triggers[153], 'gate 153 (bit 4 only): 2 u outside, facing it: the ray is not asked'); }
  { const dt = T12(w).t, m = dt.m, n = [0, 1, 2].map(j => m[3][j] + (dt.lo[0] + dt.hi[0]) / 2 * m[0][j] + (dt.lo[1] + dt.hi[1]) / 2 * m[1][j] + (dt.lo[2] + dt.hi[2]) / 2 * m[2][j]);
    const h = w.W.gimmickChoose(n, [m[0][0], m[0][1], m[0][2]]);
    ok(!h || h.o !== T12(w), 'door 12 (bit 3 only): origin in its box, the 7 u ray inside it: not chosen'); }
}
// manager cmd 0xab (script 209 event 0x18, FUN_0053da98): soldier 149 on the screen and in clear sight: short 66 = 1 (the routine that sends him through door 150)
{
  const run = (eye, { los = false, view = null } = {}) => {
    const anims = new ChunkAnims(pd.chunkAnims), props = createProps({ data: pd, areas: { has: k => k >= 0 }, warn: () => {} });
    const W = createEnemyAI({ data: ai, player: { pos: [0, 0, 0], hp: 780, id: 0x16, f118: 0, s64: 0 }, rand: () => 0.5, quiet: true, props, chunkAnims: anims, viewRay: () => los,
      viewCam: () => (view ? { eye, ...view } : { eye, fov: 73.5, toView: p => [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]] }) });
    const o = [...W.objects.values()].find(x => x.rec === 149);
    const r = W.runEvent(o, 0x18);
    return W.mshort[66];
  };
  const p = ai.records[149].pos;
  ok(run([p[0], p[1], p[2] - 100]) === 1, '149 ahead and clear: true');
  ok(run([p[0], p[1], p[2] + 100]) === 0, '149 behind the camera: false (the clip test)');
  ok(run([p[0] + 400, p[1], p[2] - 100]) === 0, '149 far to the side, off the screen: false');
  ok(run([p[0] + 95, p[1], p[2] - 100]) === 0, '149 inside the clip test but beyond the 512 wide screen: false');
  ok(run([p[0] + 60, p[1], p[2] - 100]) === 1, '149 near the side, on the screen: true');
  ok(run([p[0], p[1], p[2] - 100], { los: true }) === 0, '149 ahead with a wall on the ray: false');
  { // a shut door on the ray (cameraObjects): from the far side of door 150's box; the view is a stub that has him ahead
    const c = ai.triggers[150].m[3], mid = [c[0], c[1] - 12, c[2]], d = [0, 1, 2].map(j => mid[j] - p[j]), l = Math.hypot(...d), eye = mid.map((v, j) => v + d[j] / l * 20);
    const see = { fov: 73.5, toView: () => [0, 0, 100] };
    ok(run(p.map((v, j) => v - d[j] / l * 20), { view: see }) === 1, 'the near side of 149, no door between: clear');
    ok(run(eye, { view: see }) === 0, 'door 150 shut on the ray: false');
  }
}
// against the game
const F = new URL('../../tools/trace/out/w257_door2.jsonl', import.meta.url);
if (existsSync(F)) {
  const fl = (h, o) => new DataView(Uint8Array.from(h.match(/../g), x => parseInt(x, 16)).buffer).getFloat32(o, true);
  const R = readFileSync(F, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l));
  const w = newWorld(); let worst = 0, wf = 0, tBad = 0, stBad = 0, n = 0;
  const i0 = R.findIndex(r => r.frame === 426);
  w.anims.frame([0, 5, 6], 1.2);
  for (let i = i0; i < R.length - 1; i++) {
    const g = R[i + 1];
    if (i === i0) w.W.gimmickUse({ o: T12(w), face: 4 });
    frame(w);
    const b = g.trig ? parseInt(g.trig.slice(0xe0 * 2, 0xe0 * 2 + 2), 16) : -1;
    if (b !== T12(w).e0) stBad++;
    const t = fl(g.times6, 24), s = w.anims.st(6, 6);
    if (s && Math.abs(t - s.time) > 1e-3) tBad++;
    const pos = [fl(g.rec6, 0x90), fl(g.rec6, 0x94), fl(g.rec6, 0x98)], m = B6(w).m[3], d = Math.hypot(pos[0] - m[0], pos[1] - m[1], pos[2] - m[2]);
    if (d > worst) { worst = d; wf = g.frame; } n++;
  }
  ok(stBad === 0, `w257_door2: trigger 12's +0xe0 frame by frame (${n} frames, ${stBad} off)`);
  ok(tBad === 0, `w257_door2: animation 6's time frame by frame (${tBad} off)`);
  ok(worst < 0.01, `w257_door2: record 6's box frame by frame: worst ${worst.toFixed(4)} u at f${wf}`);
  // the camera through the doorway, each frame from the game's last (test_cam_traces 'tick'), the map and the page's objects: the review's 0.3 at z 1142 and 2.2 at z 1154 with the box shut
  const { FollowCamera, cameraRays, padAxis: pa } = await import(new URL('./player.js', import.meta.url).href);
  const { WeaponSystem } = await import(new URL('./aim_core.js', import.meta.url).href);
  const buf = readFileSync(new URL('./data/z128_collision.bin', import.meta.url));
  const rays = cameraRays(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)); rays.chunks = () => [0, 5, 6]; rays.objects = (a, b) => w.W.cameraObjects(a, b);
  const core = new WeaponSystem(J('./data/aim/weapon.json'), null); Object.assign(core.cam, { type: 0xd, view: 2, fov: 73.5, e: 1, ramp: 1, phase: 1 });
  const cam = new FollowCamera(null, rays); cam.weapon = core;
  const V3 = (h, o) => [fl(h, o), fl(h, o + 4), fl(h, o + 8)];
  const r0 = R[i0];
  cam.reset({ x: r0.matrix[3][0], y: r0.matrix[3][1], z: r0.matrix[3][2] }, { pitch: fl(r0.cam_170, 4), yaw: fl(r0.cam_170, 8) });
  let cw = 0, cf = 0, cn = 0;
  const w3 = newWorld(); w3.anims.frame([0, 5, 6], 1.2); rays.objects = (a, b) => w3.W.cameraObjects(a, b);
  // up to the save box of scene_save(2) (from about f458: the game's camera base holds, 2.7 u behind the page's here; this replay has no box)
  for (let i = i0; i < R.length - 1 && R[i + 1].frame <= 456; i++) {
    const r = R[i], g = R[i + 1];
    if (i === i0) w3.W.gimmickUse({ o: T12(w3), face: 4 });
    frame(w3);
    cam.eye = V3(r.cam_60, 0x30); cam.M = [0, 1, 2].map(k => V3(r.cam_60, 16 * k)); cam.dist = fl(r.cam_170, 0x50); cam.yaw = fl(r.cam_170, 8); cam.pitch = fl(r.cam_170, 4); cam.back = fl(r.cam_170, 0x54);
    const q = r.want_dir_speed || [0, 0, 0];
    cam.tick({ pos: { x: r.matrix[3][0], y: r.matrix[3][1], z: r.matrix[3][2] }, want: { x: q[0], y: q[1], z: q[2] }, facing: { x: r.matrix[2][0], y: r.matrix[2][1], z: r.matrix[2][2] }, state: 2, stick: 0, pad: null });
    const d = Math.hypot(...cam.eye.map((v, k) => v - V3(g.cam_60, 0x30)[k]));
    if (g.frame >= 440) { if (d > cw) { cw = d; cf = g.frame; } cn++; }        // open: this replay feeds no stick, so the turn before it isn't compared (0.29 u at f427)
  }
  ok(cw < 0.05, `w257_door2: the camera through the door, ${cn} frames: worst eye ${cw.toFixed(3)} u at f${cf} (the review, box shut: distance 0.3 at z 1142)`);
} else console.log('  (no tools/trace/out/w257_door2.jsonl: the trace comparison is skipped)');
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
