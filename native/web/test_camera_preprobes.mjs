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
console.log(fails ? `${fails} FAILED` : 'all ok');
process.exit(fails ? 1 : 0);
