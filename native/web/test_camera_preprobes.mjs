// test_camera_preprobes.mjs -- FUN_0032ace0's pre-probes (l.1820-1990) and FUN_00544f90's second cast (worker 0257;
// notes/battle-camera.md 'The pre-probes'): player.js FollowCamera.preProbes, place(), cameraRays probe6.
//   node --import ./native/web/test_hooks.mjs native/web/test_camera_preprobes.mjs [player.js path]
// 1. Hand cases with one wall (plane x = X): the shoulder camera 0xd's side ray pulls the pivot in, the map probe pushes a look
//    point out of a wall by the depth + 0.1, an object in front of the eye stops it nearer than the map, FUN_005449f0's
//    nearest wins. 2. The game: route state r03_spot2 (type 0xd, gun out, chunk 03's wall behind the eye): eye / look point /
//    distance from RAM. The traced wall runs (w257_wall_aim / w257_wall_look) are replayed by test_aim_camera.mjs.
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
const P = process.argv[2] ? pathToFileURL(process.argv[2]).href : new URL('./player.js', import.meta.url).href;
const { FollowCamera, cameraRays } = await import(P);
const { WeaponSystem } = await import(new URL('./aim_core.js', import.meta.url).href);
const { boxRay, createProps } = await import(new URL('./props.js', import.meta.url).href);
const { createEnemyAI } = await import(new URL('./enemy_ai.js', import.meta.url).href);
const J = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const near = (a, b, e) => a.every((v, i) => Math.abs(v - b[i]) <= e);

// a double-sided wall x = X (normal -x): the page's ray API
const wallRays = (X, objects = null) => {
  const segment = (a, b) => {
    if ((a[0] - X) * (b[0] - X) > 0 || a[0] === b[0]) return null;
    const t = (X - a[0]) / (b[0] - a[0]);
    return { point: [X, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], normal: [-1, 0, 0] };
  };
  const nearest = (a, ...H) => H.filter(Boolean).sort((p, q) => Math.hypot(...p.point.map((v, i) => v - a[i])) - Math.hypot(...q.point.map((v, i) => v - a[i])))[0] || null;
  return { chunks: () => [], segment, objects, probe6: (a, b) => nearest(a, segment(a, b), objects ? objects(a, b) : null) };
};
const newCam = (rays, type) => {
  const core = new WeaponSystem(J('./data/aim/weapon.json'), null);
  Object.assign(core.cam, { type, view: type === 0xd ? 2 : 1, fov: 73.5, e: 1, ramp: 1, phase: 1 });
  const c = new FollowCamera(null, rays); c.weapon = core;
  return c;
};
const POS = { x: 0, y: 0, z: 0 };
const place = (rays, type, yaw = 0, pitch = 0) => { const c = newCam(rays, type); c.reset(POS, { yaw, pitch }); return c; };

// 1a. the side ray: type 0xd, yaw 0: the pivot's +5 is along +x (M row 0). No wall: look point x = 5.
{
  const free = place(wallRays(1e6), 0xd);
  ok(Math.abs(free.at[0] - 5) < 1e-3, `0xd, no wall: look point x ${free.at[0].toFixed(3)} (pivot x 5)`);
  // an object (not the map) 3 from the axis: the pivot's side comes in to 3 - 1 = 2. Its map probe from x = 0 to x = 2 stays clear
  const objWall = a => (a, b) => wallRays(3).segment(a, b);
  const c = place(wallRays(1e6, objWall()), 0xd);
  ok(Math.abs(c.at[0] - 2) < 1e-3, `side ray on an object at x = 3: look point x ${c.at[0].toFixed(3)} (hit - DAT_0046e4e0 = 2)`);
  // the map through the same ray: FUN_005449f0 lists the stage object too
  const m = place(wallRays(3), 0xd);
  ok(Math.abs(m.at[0] - 2) < 1e-3, `side ray on the map at x = 3 (the stage object in the grid): look point x ${m.at[0].toFixed(3)}`);
  // past side + margin (x = 6.5, 5 + 1 < 6.5): untouched
  const far = place(wallRays(6.5), 0xd);
  ok(Math.abs(far.at[0] - 5) < 1e-3, `wall past the margin (x = 6.5): look point x ${far.at[0].toFixed(3)} unmoved`);
  // type 0xc: the side is 0 (< 2.5): no side ray; pivot x 0
  const zero = place(wallRays(3), 0xc);
  ok(Math.abs(zero.at[0]) < 1e-3, `0xc: no side offset, no side ray: look point x ${zero.at[0].toFixed(3)}`);
}
// 1b. the map probe: a look point past the wall from the base point (a pitched view: pivot z = 4 x -pitch; camera 0xc, yaw 90 deg
// puts z along +x). Wall between base and look point: pushed out to the wall - 0.1 along the normal
{
  const pitch = 0.6, yaw = Math.PI / 2;
  const free = place(wallRays(1e6), 0xc, yaw, pitch);
  const lx = free.at[0];
  ok(Math.abs(lx) > 0.5, `0xc, pitched: the look point leaves the base point sideways (x ${lx.toFixed(3)})`);
  const X = lx / 2;
  const c = place(wallRays(X), 0xc, yaw, pitch);
  ok(Math.abs(c.at[0] - (X - Math.sign(lx) * 0.1)) < 1e-3, `look point behind the wall x = ${X.toFixed(3)}: pushed out to ${c.at[0].toFixed(3)} (wall - 0.1 along the normal)`);
  ok(Math.abs((c.eye[0] - free.eye[0]) - (c.at[0] - free.at[0])) < 1e-3, `the eye moves with the look point (${(c.eye[0] - free.eye[0]).toFixed(3)})`);
}
// 1c. FUN_00544f90's second cast: an object on the ray S -> eye, nearer than the map, pulls the eye; none = the map's result
{
  const yaw = 0;
  const base = place(wallRays(1e6), 0xc, yaw, 0);
  const zw = (Z) => (a, b) => {
    if ((a[2] - Z) * (b[2] - Z) > 0 || a[2] === b[2]) return null;
    const t = (Z - a[2]) / (b[2] - a[2]);
    return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Z], normal: [0, 0, 1] };
  };
  const Z = base.eye[2] * 0.5;
  const c = place(wallRays(1e6, zw(Z)), 0xc, yaw, 0);
  ok(Math.abs(c.eye[2] - Z) < 1e-3, `an object across the eye ray at z = ${Z.toFixed(2)}: eye z ${c.eye[2].toFixed(3)} (free ${base.eye[2].toFixed(2)})`);
  ok(c.hit === true && place(wallRays(1e6), 0xc).hit === false, 'the object hit counts as the frame\'s hit (CAM+0x1e8 0x80)');
}
// 1d. preProbes on its own (base 0, M identity, eye offset 0, f23 0, so the rays start from the pivot): probe 6 is an object wall x = X, the map is silent
{
  const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const objOnly = X => ({ segment: () => null, probe6: (a, b) => wallRays(X).segment(a, b) });
  const run = (rays, pr, M = I3) => { const c = new FollowCamera(null, rays); c.preProbes([0, 0, 0], pr, [0, 0, 0], M, 0); return pr; };
  let p = run(objOnly(5.5), [5, 0, 0]);
  ok(Math.abs(p[0] - 4.5) < 1e-5, `side 5, wall at 5.5 (nearer than side + 1): x ${p[0].toFixed(3)} = hit - 1`);
  p = run(objOnly(0.5), [5, 0, 0]);
  ok(Math.abs(p[0]) < 1e-5, `side 5, wall at 0.5: x ${p[0].toFixed(3)} = 0 (max(d - 1, 0), never past the axis)`);
  p = run(objOnly(1.4), [2.4, 0, 0]);
  ok(p[0] === 2.4, `side 2.4 (under DAT_0046e4e4 = 2.5): no side ray, x ${p[0]}`);
  p = run(objOnly(1.5), [2.5, 0, 0]);
  ok(Math.abs(p[0] - 0.5) < 1e-5, `side 2.5 (the gate, inclusive): the ray runs, x ${p[0].toFixed(3)}`);
  // a tilted M row 0: the side is (3.5, 3.5, 0), the pull is x / z only, y as it was
  const s = Math.SQRT1_2, Pl = 3 * s;
  const tilted = { segment: () => null, probe6: (a, b) => ({ point: [a[0] + Pl, a[1] + Pl, a[2]], normal: [-s, -s, 0] }) };
  p = run(tilted, [3.5, 3.5, 0], [[s, s, 0], [-s, s, 0], [0, 0, 1]]);
  ok(Math.abs(p[1] - 3.5) < 1e-5 && Math.abs(p[0] - (2 * s)) < 1e-5, `the side ray's pull keeps y (FUN_0032ace0): ${p.map(v => v.toFixed(3))}`);
  // the map's push on a sloped wall (a non-unit normal, (0.6, 0.8, 0) x 2): by depth + 0.1 along the normal, y included
  const slope = (P) => ({ probe6: () => null, segment: () => ({ point: P, normal: [1.2, 1.6, 0] }) });
  p = run(slope([1.5, 1, 0]), [2, 1, 0]);
  ok(near(p, [1.76, 0.68, 0], 1e-5), `sloped normal: (2, 1, 0) pushed to ${p.map(v => v.toFixed(3))} (depth 0.3 + 0.1 along the normal)`);
  p = run(slope([2.0003, 1.0004, 0]), [2, 1, 0]);
  ok(near(p, [2.0003, 1.0004, 0], 1e-5), `depth under 0.001: no + 0.1 (${p.map(v => v.toFixed(4))})`);
}
// 1e. the second cast keeps probe 6's hit only when strictly nearer S (the five rays' best can be a nearer corner of the map)
{
  const zw = (Z) => (a, b) => {
    if ((a[2] - Z) * (b[2] - Z) > 0 || a[2] === b[2]) return null;
    const t = (Z - a[2]) / (b[2] - a[2]);
    return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Z], normal: [0, 0, 1] };
  };
  const E = place(wallRays(1e6), 0xc).eye[2];
  const rays = Zo => ({ chunks: () => [], segment: zw(E * 0.25), objects: null, probe6: zw(Zo) });
  const far = place(rays(E * 0.5), 0xc), nearer = place(rays(E * 0.125), 0xc);
  ok(Math.abs(far.eye[2] - E * 0.25) < 1e-3, `map at ${(E * 0.25).toFixed(2)}, object further at ${(E * 0.5).toFixed(2)}: the map's stop stays (eye z ${far.eye[2].toFixed(3)})`);
  ok(Math.abs(nearer.eye[2] - E * 0.125) < 1e-3, `object nearer at ${(E * 0.125).toFixed(2)}: its stop (eye z ${nearer.eye[2].toFixed(3)})`);
}
// 1f. FUN_0025a8f0: a rotated box (a quarter turn about y), each of its six faces from outside, from inside, and the misses
{
  const m = [[0, 0, -1, 0], [0, 1, 0, 0], [1, 0, 0, 0], [100, 0, 50, 1]], half = [5, 10, 2], c = m[3];
  const at = (s, i, k) => [0, 1, 2].map(j => c[j] + s * k * m[i][j]);
  let faces = 0;
  for (const s of [1, -1]) for (let i = 0; i < 3; i++) {
    const h = boxRay(at(s, i, 40), c.slice(0, 3), half, m);
    if (h && near(h.point, at(s, i, half[i]), 1e-3) && near(h.normal, [0, 1, 2].map(j => s * m[i][j]), 1e-6)) faces++;
    else console.log('  face', s, i, JSON.stringify(h));
  }
  ok(faces === 6, `box: the six faces from outside: point on the face, outward normal (${faces} / 6)`);
  const out = boxRay(c.slice(0, 3), at(1, 0, 40), half, m);
  ok(out && near(out.point, at(1, 0, 5), 1e-3) && near(out.normal, m[0].slice(0, 3), 1e-6), 'box: from inside out: the exit face (only the end outside)');
  const through = boxRay(at(-1, 0, 40), at(1, 0, 40), half, m), back = boxRay(at(1, 0, 40), at(-1, 0, 40), half, m);
  ok(through && near(through.point, at(-1, 0, 5), 1e-3) && back && near(back.point, at(1, 0, 5), 1e-3), 'box: right through, both ways: the face nearer the start (t <= the best)');
  ok(boxRay(c.slice(0, 3), at(1, 0, 3), half, m) === null, 'box: both ends inside: no hit');
  const pass = [0, 1, 2].map(j => c[j] + 15 * m[1][j]);
  ok(boxRay([pass[0] - 40 * m[0][0], pass[1], pass[2] - 40 * m[0][2]], [pass[0] + 40 * m[0][0], pass[1], pass[2] + 40 * m[0][2]], half, m) === null, 'box: crosses the x planes above the box: no hit (the other faces\' clip)');
  ok(boxRay(at(1, 0, 40), at(1, 0, 20), half, m) === null, 'box: stops short: no hit');
}
// 1g. the page's objects through props.js and enemy_ai.js: class 3 boxes follow their area (or are on from the start), barrels have the ends' margin, box triggers
{
  const pd = J('./data/props/props.json'), ai = J('./data/enemies/ai.json');
  const props = createProps({ data: pd, areas: { has: k => k >= 0 }, warn: () => {} });
  props.attach({ objects: new Map(), events: [], runEvent() {} });
  const D = pd.camBoxes.find(b => b.rec === 14), Dp = D.m[3];
  ok(pd.camBoxes.length === 22 && Math.abs(Dp[0] + 1313.09) < 0.01 && Math.abs(Dp[2] + 159.53) < 0.01, `22 class 3 records; record 14 at (${Dp[0].toFixed(1)}, ${Dp[1].toFixed(1)}, ${Dp[2].toFixed(1)}) (RAM: 0x591890 at -1313.1, -12.3, -159.5)`);
  const h = props.cameraProbe([Dp[0], Dp[1], Dp[2] - 30], [Dp[0], Dp[1], Dp[2]]);
  ok(h && Math.abs(h.point[2] - (Dp[2] - D.size[2] / 2)) < 1e-2 && h.normal[2] < -0.99, `record 14 (no area): stops the ray on its face (z ${h && h.point[2].toFixed(2)})`);
  const A = pd.camBoxes.find(b => b.area >= 0), Ap = A.m[3], thru = [[Ap[0] - 60 * A.m[2][0], Ap[1], Ap[2] - 60 * A.m[2][2]], [Ap[0], Ap[1], Ap[2]]];
  ok(!props.cameraProbe(...thru), `record ${A.rec} (area ${A.area}, off): nothing`);
  props.areaSwitch(A.area, true);
  ok(!!props.cameraProbe(...thru), `area ${A.area} on: it stops the ray`);
  props.areaSwitch(A.area, false);
  ok(!props.cameraProbe(...thru), `area ${A.area} off: nothing`);
  // a barrel: both ends + 3 (fRam0046ef60); the side at its radius
  const R = pd.records.find(r => r.rec === 17);
  props.areaSwitch(R.f4c, true);
  const B = props.barrels.find(o => o.rec === 17), up = B.m[1];
  const tip = props.cameraProbe([0, 1, 2].map(j => B.pos[j] + 40 * up[j]), B.pos);
  const dTip = Math.hypot(...[0, 1, 2].map(j => tip.point[j] - B.pos[j]));
  ok(Math.abs(dTip - (B.h / 2 + 3)) < 1e-2, `barrel: the end at h / 2 + 3 = ${(B.h / 2 + 3).toFixed(2)} (${dTip.toFixed(2)})`);
  // a box trigger through enemy_ai.cameraObjects (FUN_00550da0): its area, the face, the normal; props' answer when nearer
  const T = ai.triggers.find(t => t.shape === 3 && t.area >= 0 && t.hi[0] - t.lo[0] > 4 && !((t.flags >>> 17) & 1));
  const xf = (p) => [0, 1, 2].map(j => p[0] * T.m[0][j] + p[1] * T.m[1][j] + p[2] * T.m[2][j] + T.m[3][j]);
  const mid = [0, 1, 2].map(j => (T.lo[j] + T.hi[j]) / 2), P0 = xf([T.hi[0] + 10, mid[1], mid[2]]), P1 = xf(mid), Pf = xf([T.hi[0], mid[1], mid[2]]);
  let stub = null;
  const W = createEnemyAI({ data: ai, player: { pos: [0, 0, 0], hp: 780, id: 0x16, f118: 0, s64: 0 }, rand: () => 0.5, quiet: true, props: { attach() {}, update() {}, cameraProbe: () => stub } });
  ok(!W.cameraObjects(P0, P1), `box trigger ${T.idx} (area ${T.area} off): nothing`);
  const other = ai.triggers.find(t => t.shape === 3 && t.area >= 0 && t.area !== T.area).area;
  W.areaSwitch(other, true);
  ok(!W.cameraObjects(P0, P1), `area ${other} on: box trigger ${T.idx} stays off (its own area, +0xa8)`);
  W.areaSwitch(T.area, true);
  const bh = W.cameraObjects(P0, P1);
  ok(bh && near(bh.point, Pf, 1e-2) && near(bh.normal, T.m[0].slice(0, 3), 1e-5), `box trigger ${T.idx}, area on: the +x face, normal row 0 (${bh && bh.point.map(v => v.toFixed(2))})`);
  const bl = W.cameraObjects(xf([T.lo[0] - 10, mid[1], mid[2]]), P1);
  ok(bl && near(bl.point, xf([T.lo[0], mid[1], mid[2]]), 1e-2) && near(bl.normal, T.m[0].slice(0, 3).map(x => -x), 1e-5), `box trigger ${T.idx}: the -x face, normal -row 0`);
  stub = { point: P0.slice(), normal: [0, 1, 0], d: 0.5 };
  ok(W.cameraObjects(P0, P1) === stub, 'a nearer prop wins over the box');
  stub = { point: P1.slice(), normal: [0, 1, 0], d: 99 };
  ok(W.cameraObjects(P0, P1) !== stub, 'a further prop does not');
}
// the real rays: probe6 = the nearest of the map and rays.objects
const buf = readFileSync(new URL('./data/z128_collision.bin', import.meta.url));
const mk = () => cameraRays(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
{
  const r = mk(); r.chunks = () => [0, 3, 2];
  const a = [-1511.5, -17, -560], b = [-1511.5, -17, -530];
  const m = r.segment(a, b);
  ok(!!m && Math.abs(m.point[2] + 542.75) < 0.01, `chunk 03's wall on the map: z ${m ? m.point[2].toFixed(2) : 'none'}`);
  r.chunks = () => [0, 1, 2];
  ok(!r.segment(a, b), 'the same ray with chunk 3 not loaded: no hit (rays.chunks)');
  r.chunks = () => [0, 3, 2];
  r.objects = () => ({ point: [-1511.5, -17, -550], normal: [0, 0, -1] });
  ok(r.probe6(a, b).point[2] === -550, 'probe6: an object nearer than the map wins');
  r.objects = () => ({ point: [-1511.5, -17, -535], normal: [0, 0, -1] });
  ok(Math.abs(r.probe6(a, b).point[2] + 542.75) < 0.01, 'probe6: the map when nearer');
}
// 2. the game: r03_spot2 (route.py, walking state + teleport; RAM CAM 0x95efe0: type 0xd, view 2, yaw / pitch / base / eye / look point)
{
  const r = mk(); r.chunks = () => [0, 3, 2];
  const c = newCam(r, 0xd), pos = { x: -1507.300048828125, y: -0.06, z: -573.4999 };
  c.reset(pos, { yaw: 3.00130987, pitch: -0.128742914 });
  for (let i = 0; i < 3; i++) c.tick({ pos, want: { x: 0, y: 0, z: 0 }, state: 0, stick: 0, pad: null, facing: { x: 0, y: 0, z: 1 } });
  ok(near(c.eye, [-1516.5105, -20.3042, -544.0315], 0.002) && near(c.at, [-1512.1969, -16.31, -574.5815], 0.002) && Math.abs(c.dist - 30.7275) < 0.002,
     `r03_spot2: eye ${c.eye.map(v => v.toFixed(3))}, look point ${c.at.map(v => v.toFixed(3))}, distance ${c.dist.toFixed(3)} (RAM -1516.511, -20.304, -544.032 / -1512.197, -16.310, -574.581 / 30.727)`);
}
// 3. the game: r06_door2 (walked state, slots 0 / 5 / 6, type 0xd, Vincent's back to the door with class 3 record 6, area 13 on): the camera stops on that box
{
  const pd = J('./data/props/props.json'), props = createProps({ data: pd, areas: { has: k => k >= 0 }, warn: () => {} });
  props.attach({ objects: new Map(), events: [], runEvent() {} }); props.areaSwitch(13, true);
  const go = (objs) => {
    const r = mk(); r.chunks = () => [0, 5, 6]; if (objs) r.objects = (a, b) => props.cameraProbe(a, b);
    const c = newCam(r, 0xd), pos = { x: -1328.29931640625, y: 0, z: 1134.1036376953125 };
    c.reset(pos, { yaw: -2.650653600692749, pitch: -0.10331715643405914 });
    for (let i = 0; i < 3; i++) c.tick({ pos, want: { x: 0, y: 0, z: 0 }, state: 0, stick: 0, pad: null, facing: { x: 0, y: 0, z: 1 } });
    return c;
  };
  const c = go(true), o = go(false), E = [-1331.9867, -16.4402, 1137.8107];
  ok(near(c.at, [-1332.8549, -16.25, 1136.1875], 0.002), `r06_door2: look point ${c.at.map(v => v.toFixed(3))} (RAM -1332.855, -16.250, 1136.188)`);
  ok(near(c.eye, E, 0.2) && Math.abs(c.dist - 1.5426) < 0.2, `r06_door2: eye ${c.eye.map(v => v.toFixed(3))}, distance ${c.dist.toFixed(3)} (RAM -1331.987, -16.440, 1137.811 / 1.543)`);
  ok(Math.abs(o.dist - 1.5426) > 30, `r06_door2 without the class 3 boxes: distance ${o.dist.toFixed(2)}, through the door`);
}
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
