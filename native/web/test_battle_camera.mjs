// battle()'s camera (worker 0244): the rescue beat's battle() (ev0100 main, pc ~0x849) against PCSX2 trace
// w244_rescue_cam (TRACE_FIELDSET=cam; game-derived, gitignored: $BATTLE_CAM_TRACE or
// <repo>/tools/trace/out/w244_rescue_cam.jsonl; script tools/trace/scripts/w244_rescue_cam.json).
// The frame of battle() (T w244_rescue_calls): FUN_00324e70 -> FUN_00329f68 -> FUN_003285d0 + FUN_00337148 (in-place
// update), FUN_004012c0 case 9 -> FUN_00326da8 (FUN_0053d420 posts 0x7d5, FUN_0032a420(CAM, 1, 1, 1): ramp 1, update),
// the frame's update, then the message 0x7d5 (FUN_00337338(CAM, 0xc, -1, 0): ramp 0). The camera's rays test the loaded
// slots' chunks (FUN_0026a320): 0 / 3 / 2 there (T w244_rescue_slots).
// node --import ./test_hooks.mjs test_battle_camera.mjs [player.js path]
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
const P = process.argv[2] ? pathToFileURL(process.argv[2]).href : new URL('./player.js', import.meta.url).href;
const { FollowCamera, cameraRays, dirAngles } = await import(P);
const { WeaponSystem } = await import(new URL('./aim_core.js', import.meta.url).href);
const J = p => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const FILE = process.env.BATTLE_CAM_TRACE || fileURLToPath(new URL('../../tools/trace/out/w244_rescue_cam.jsonl', import.meta.url));
const buf = readFileSync(new URL('./data/z128_collision.bin', import.meta.url));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const F = (h, o) => Buffer.from(h, 'hex').readFloatLE(o);
const V3 = (h, o) => [F(h, o), F(h, o + 4), F(h, o + 8)];
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
let fails = 0;
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if (!ok) fails++; };

// main's Camera.set before battle() (ev0100, notes/stage-controller.md 'Battle actors'): FUN_003285d0's angles
const VIEW = { eye: [-1135.5, -31.8, -1275.1], aim: [-1134.75, -31.16, -1275.205] };

// run: chunks = the rays' loaded chunks; y = the player's y the page has at battle() (vinBattle.place lands him at
// once: -0.0623; the game's body is still at setpos's 0 for the in-place updates and lands over the next frames)
function run(R, chunks, y0 = null) {
  const i0 = R.findIndex(r => r.frame === 2125), r0 = R[i0], c0 = r0.cam_170, h = Buffer.from(c0, 'hex');
  const core = new WeaponSystem(J('./data/aim/weapon.json'), null);
  const c = core.cam;
  c.view = h.readInt32LE(0xac); c.type = 0xc; c.phase = Buffer.from(r0.cam_00, 'hex')[0x2c];
  c.ramp = F(c0, 0xc); c.flags = h.readUInt32LE(0x78); c.fade = h[0x70]; c.fov = F(c0, 0);
  const rays = cameraRays(ab);
  if (chunks) rays.chunks = () => chunks;
  const cam = new FollowCamera(null, rays);
  cam.weapon = core;
  // the game's camera before the frame: the old follow view behind Vincent's old place
  cam.eye = V3(r0.cam_60, 0x30); cam.M = [0, 1, 2].map(k => V3(r0.cam_60, 16 * k)); cam.dist = F(c0, 0x50);
  cam.yaw = F(c0, 8); cam.pitch = F(c0, 4); cam.snap = false; cam.base = r0.matrix[3].slice(0, 3);
  const g1 = R[i0 + 1], q = g1.matrix[3];
  const pAt = r => ({ pos: { x: r.matrix[3][0], y: r.matrix[3][1], z: r.matrix[3][2] }, want: { x: 0, y: 0, z: 0 },
                      state: Buffer.from(r.p_state, 'hex')[4], stick: 0, pad: null });
  const p = { pos: { x: q[0], y: y0 ?? q[1], z: q[2] }, want: { x: 0, y: 0, z: 0 }, state: Buffer.from(g1.p_state, 'hex')[4], stick: 0, pad: null };
  // the angles: render view 1's forward (the trace's; the notes' Camera.set numbers are rounded, checked below)
  const pitch = F(g1.cam_170, 4), yaw = F(g1.cam_170, 8);
  // play.js stageCameraReset, then the frame's follow.tick, then follow.messages()
  // T w244_rescue_calls: CAM+0x17c / +0x1c0 after each call of battle()'s frame (FUN_00337148 in FUN_00324e70; the enter +
  // update in FUN_00326da8; the frame's update; the message 0x7d5's enter)
  const steps = [];
  cam.battleReset(p, { yaw, pitch }); steps.push([c.ramp, cam.dist]);
  cam.battleHandBack(p); steps.push([c.ramp, cam.dist]);
  cam.tick(p); steps.push([c.ramp, cam.dist]);
  cam.messages(); steps.push([c.ramp, cam.dist]);
  const err = { eye: [0, 0], at: [0, 0], dist: [0, 0], ramp: [0, 0], ang: [0, 0] };
  const put = (k, v, f) => { if (v > err[k][0]) err[k] = [v, f]; };
  for (let i = i0 + 1; i < R.length; i++) {
    const g = R[i];
    if (i > i0 + 1) { cam.tick(pAt(R[i - 1])); cam.messages(); }
    put('eye', d3(cam.eye, V3(g.cam_60, 0x30)), g.frame);
    put('at', d3(cam.at, V3(g.cam_f0, 0)), g.frame);
    put('dist', Math.abs(cam.dist - F(g.cam_170, 0x50)), g.frame);
    put('ramp', Math.abs(c.ramp - F(g.cam_170, 0xc)), g.frame);
    put('ang', Math.max(Math.abs(cam.yaw - F(g.cam_170, 8)), Math.abs(cam.pitch - F(g.cam_170, 4))), g.frame);
  }
  return { err, n: R.length - i0 - 1, steps };
}

if (!existsSync(FILE)) {
  console.log('SKIP (no trace) ' + FILE);
} else {
  const R = readFileSync(FILE, 'utf8').trim().split('\n').slice(1).map(l => JSON.parse(l));
  const fmt = e => Object.entries(e).map(([k, [v, f]]) => `${k} ${v.toExponential(1)} (f${f})`).join('  ');
  // the game's body is still at setpos's y 0 in battle()'s frame (the look point's y shows it) and lands over the next
  // frames; with that base everything is the traced value
  const a = run(R, [0, 3, 2], 0);
  console.log('     slots 0 / 3 / 2, base y 0: frames ' + a.n + ': ' + fmt(a.err));
  check(a.err.eye[0] < 2e-3 && a.err.at[0] < 1e-3, 'eye / look-at = the game after battle() (blend from the old eye, ramp 0 -> 1)');
  check(a.err.dist[0] < 3e-3, 'CAM+0x1c0: 21.30 at battle(), then eases out as the game (page was 36.4)');
  check(a.err.ramp[0] < 1e-5, 'CAM+0x17c: 0.9512 in battle(), 1 after FUN_00326da8, 0 after the message 0x7d5, then the ramp');
  check(a.err.ang[0] < 1e-6, 'angles held');
  const CALLS = [[0.9512, 21.3024], [1, 21.3034], [1, 21.3045], [0, 21.3045]];   // the call log's values (4 decimals)
  check(a.steps.every(([r, d], k) => Math.abs(r - CALLS[k][0]) < 1e-4 && Math.abs(d - CALLS[k][1]) < 2e-4),
        'battle()\'s frame call by call (ramp, CAM+0x1c0): ' + a.steps.map(([r, d]) => r.toFixed(4) + ' / ' + d.toFixed(4)).join(', '));
  // the page lands him at once (vinBattle.place: y -0.0623): the look point starts up to 0.06 off and the distance 0.015
  const a2 = run(R, [0, 3, 2]);
  console.log('     slots 0 / 3 / 2, page y: ' + fmt(a2.err));
  check(a2.err.eye[0] < 0.08 && a2.err.at[0] < 0.07 && a2.err.dist[0] < 0.02, 'with the page\'s landed y: within the landing (0.06)');
  const [vp, vy] = dirAngles(VIEW.aim[0] - VIEW.eye[0], VIEW.aim[1] - VIEW.eye[1], VIEW.aim[2] - VIEW.eye[2]);
  const g1 = R.find(r => r.frame === 2126);
  check(Math.abs(vp - F(g1.cam_170, 4)) < 1e-4 && Math.abs(vy - F(g1.cam_170, 8)) < 1e-4, 'main\'s Camera.set view gives the reset angles (to its 0.05 rounding)');
  // the decoded ray rule: chunks 1 / 2 (the save's slots) miss chunk 3's geometry here
  const b = run(R, null);
  check(b.err.dist[0] > 0.3, 'without chunk 3 (the start slots) the distance is off (' + b.err.dist[0].toFixed(3) + ')');
  const tail = R[R.length - 1];
  check(Math.abs(F(tail.cam_170, 0x50) - 21.48) < 0.01, 'the trace still eases out at its end (21.48)');
}

// hand case: FUN_003285d0's CAM+0x1c0 = 1000 makes battle()'s update take the measured distance at once (the in
// branch) even when the old distance is shorter (here 5: without the 1000 it would ease out from 5)
{
  const rays = cameraRays(ab); rays.chunks = () => [0, 3, 2];
  const cam = new FollowCamera(null, rays);
  const p = { pos: { x: -1120.2, y: 0, z: -1277.3 }, want: { x: 0, y: 0, z: 0 }, state: 0, stick: 0, pad: null };
  cam.reset(p.pos, { yaw: 1.7099, pitch: -0.7016 });
  const d = cam.dist;
  cam.dist = 5;
  cam.battleReset(p, { yaw: 1.7099, pitch: -0.7016 });
  check(Math.abs(cam.dist - d) < 1e-3, 'battleReset: CAM+0x1c0 = 1000 -> the measured distance at once (' + cam.dist.toFixed(3) + ' / ' + d.toFixed(3) + ')');
}

// play.js wiring: stageCameraReset = battleReset then battleHandBack; follow.messages() right after the frame's follow.tick;
// the rays take the area stream's slots
{
  const src = readFileSync(new URL('./play.js', import.meta.url), 'utf8');
  const f = src.slice(src.indexOf('function stageCameraReset'), src.indexOf('function hideForIntro'));
  const iR = f.indexOf('follow.battleReset('), iH = f.indexOf('follow.battleHandBack(');
  check(iR > 0 && iH > iR && !/follow\.reset\(/.test(f), 'play.js stageCameraReset: battleReset -> battleHandBack (no plain reset)');
  const t = src.indexOf("follow.tick({ pos: ctrl.pos"), mm = /^\s*follow\.messages\(\);/m.exec(src.slice(t)), m = mm ? t + mm.index : -1;
  check(t > 0 && m > t && !src.slice(t, m).includes('ctrl.step('), 'play.js: follow.messages() after the frame\'s follow.tick, before ctrl.step');
  check(/camRays\.chunks = \(\) => light\.stream\.slots\.filter\(sl => sl\.loaded\)\.map\(sl => sl\.chunk\)/.test(src), 'play.js: the camera rays test the stream\'s loaded slots');
}
console.log(fails ? fails + ' FAILED' : 'all ok');
process.exit(fails ? 1 : 0);
