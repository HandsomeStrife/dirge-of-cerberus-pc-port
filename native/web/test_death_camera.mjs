// The death camera (worker 0199): FUN_00334590 case 2 -> FUN_0032a420(CAM, 1, 0, 0) + FUN_00328720(CAM)
// (CAM+0x1e8 |= 0x400000, FUN_00328790(CAM, 1): CAM+0x230 = 1); FUN_0032ace0 then zeroes the left stick and
// replaces the look stick by (0, -0.3) (l.573, l.810-811): the pitch falls 0.3 x 0.05 x 1.2 = 0.018 rad a
// frame to the -54 deg clamp, the yaw holds (no auto turn-behind, no nudge), the eye rises and the
// distance eases as usual. player.js FollowCamera.startDeath / clearDeath, play.js (gameOver.frame before
// follow.tick, its 'deathCamera' event -> startDeath).
// Checked against PCSX2 traces (tools/trace/out/w199, game-derived, gitignored; scripts
// tools/trace/scripts/w199_deathcam*.json, TRACE_FIELDSET=cam TRACE_POKE=960660=1 TRACE_LOG_AT=A5000):
//   w199_deathcam: the w192 route, killed f788, death camera from f789, request f880, menu f1090, logged to f1247;
//   w199_deathcam_look: the same with the right stick and the left stick held during the death camera.
// Closed loop: the page's controller (death slide, clip root motion) + gameover.js + FollowCamera from the
// game's camera after frame 788; every record f790-... compared (eye CAM+0x90, look-at CAM+0xf0, yaw, pitch,
// flag 0x400000, CAM+0x230).
//   node --import ./native/web/test_hooks.mjs native/web/test_death_camera.mjs
import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const DIR = process.env.DEATHCAM_TRACES ?? path.join(root, 'tools/trace/out/w199');
const PL = await import(pathToFileURL(process.env.PLAYER_JS ?? path.join(here, 'player.js')).href);
const { GameOver } = await import(pathToFileURL(path.join(here, 'gameover.js')).href);
const { WeaponSystem } = await import(pathToFileURL(path.join(here, 'aim_core.js')).href);
const { Collision } = await import(pathToFileURL(path.join(here, 'collision.js')).href);
const { FollowCamera, cameraRays, padAxis, stickToWorld, PITCH_MIN } = PL;
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
const colPath = path.join(here, 'data/z128_collision.bin'), packPath = path.join(here, 'data/vincent/vincent_jump.json');
if (!existsSync(colPath) || !existsSync(packPath)) { console.log('SKIP: data/z128_collision.bin or data/vincent/vincent_jump.json missing'); done(); }
const cbuf = readFileSync(colPath), ab = cbuf.buffer.slice(cbuf.byteOffset, cbuf.byteOffset + cbuf.byteLength);
const col = new Collision(ab), rays = cameraRays(ab);
const pack = JSON.parse(readFileSync(packPath, 'utf8')).clips;
const J = p => JSON.parse(readFileSync(path.join(here, p), 'utf8'));
const hex = h => Buffer.from(h, 'hex');
const F = (h, o) => hex(h).readFloatLE(o);
const U = (h, o) => hex(h).readUInt32LE(o);
const V3 = (h, o) => [F(h, o), F(h, o + 4), F(h, o + 8)];
const d3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const newCore = () => new WeaponSystem(J('data/aim/weapon.json'), J('data/aim/reticle.json'));
const RATE = 0.3 * 0.05 * 1.2;                    // look y 0.3 x type 0xc +0x34 x step (LOOK_TABLE 1)

// ------------------------------------------------ hand cases
{
  const cam = new FollowCamera(null, null); cam.weapon = newCore();
  cam.reset({ x: 0, y: 0, z: 0 }, { pitch: 0.2, yaw: 1.0 });
  for (let i = 0; i < 3; i++) cam.tick({ pos: { x: 0, y: 0, z: 0 }, want: { x: 0, y: 0, z: 1 }, state: 7, stick: 0, pad: [0, 0] });
  const p0 = cam.pitch, y0 = cam.yaw;
  cam.startDeath();
  ok(cam.death && cam.phase230 === 1, 'startDeath: CAM+0x1e8 0x400000 and CAM+0x230 = 1 (FUN_00328720 -> FUN_00328790(CAM, 1))');
  cam.tick({ pos: { x: 0, y: 0, z: 0 }, want: { x: 1, y: 0, z: 0 }, state: 7, stick: 0, pad: [0, 0] });
  ok(Math.abs(cam.pitch - (p0 - RATE)) < 1e-6 && cam.yaw === y0, `one frame: pitch ${(cam.pitch - p0).toFixed(5)} (-0.018), yaw held`);
  ok(cam.look190[0] === 0 && Math.abs(cam.look190[1] + 0.3) < 1e-9 && cam.flags14 === 0, 'CAM+0x190 / +0x194 = (0, -0.3); no deadzone bit (not LAB_0032b950)');
  for (let i = 0; i < 80; i++) cam.tick({ pos: { x: 0, y: 0, z: 0 }, want: { x: 1, y: 0, z: 0 }, state: 7, stick: 0, pad: [0, 0] });
  ok(cam.pitch === PITCH_MIN && cam.yaw === y0, `held at the -54 deg clamp (${cam.pitch.toFixed(4)}), yaw held`);
  cam.reset({ x: 0, y: 0, z: 0 });
  ok(cam.death, 'reset() (FUN_003285d0) keeps the death camera');
  cam.low = true; cam.d0 = [0, 4.6, 0];
  cam.endDeath();
  ok(!cam.death && cam.phase230 === 0 && cam.low && cam.d0[1] === 4.6, 'endDeath (FUN_00328750): 0x400000 / +0x230 cleared, bit 2 and CAM+0xd0 kept');
  cam.startDeath();
  cam.clearDeath();
  ok(!cam.death && cam.phase230 === 0 && !cam.low && cam.d0.every(v => v === 0),
     'clearDeath (new camera FUN_00328368 + case 1 FUN_00328750): 0x400000, +0x230, bit 2 and CAM+0xd0 cleared');
}
{
  // l.573: the left stick is zeroed for FUN_0032ace0 in death mode. Where it would act: the distance ease-out in a slow
  // state (2) with the base moving toward the eye (r x (|left| x 0.9 + 0.1)). Base moving, stick held vs none: same camera
  const run = stick => {
    const cam = new FollowCamera(null, null);
    cam.reset({ x: 0, y: 0, z: 0 }, { pitch: 0.2, yaw: 0 }); cam.startDeath();
    for (let i = 0; i < 5; i++) cam.tick({ pos: { x: 0, y: 0, z: 0 }, want: { x: 0, y: 0, z: 1 }, state: 2, stick: 0, pad: [0, 0] });
    cam.dist = 25;                                // pulled in: it eases out
    const outs = [];
    for (let i = 1; i <= 20; i++) {
      cam.tick({ pos: { x: 0, y: 0, z: -0.5 * i }, want: { x: 0, y: 0, z: 1 }, state: 2, stick, pad: [0, 0] });
      outs.push(cam.dist, ...cam.eye);
    }
    return outs;
  };
  const a = run(0), b = run(1);
  ok(a.every((v, i) => v === b[i]), 'death camera, base moving toward the eye, left stick held: same distance / eye as with no stick (l.573)');
}
{
  // input during the death camera: the pad's look stick, the left stick, mouse counts and the direct-mouse
  // option give the same camera as no input; the mouse latch DAT_004e17d0 still follows FUN_003256d8 / FUN_00254ac8
  const run = (inp) => {
    const cam = new FollowCamera(null, rays); cam.weapon = newCore();
    const pos = { x: -1085.27, y: -141.44, z: -1106.0 };
    cam.reset(pos, { pitch: 0.2, yaw: 1.64 });
    cam.startDeath();
    if (inp.direct) cam.mouseDirect = { sens: 0.01 };
    for (let i = 0; i < 40; i++) {
      if (inp.mouse) cam.addMouse(7, -5);
      cam.tick({ pos, want: { x: 0.3, y: 0, z: 0.9 }, state: 7, stick: inp.stick || 0, pad: inp.pad || [0, 0] });
    }
    return cam;
  };
  const a = run({}), b = run({ pad: [1, 0.8], stick: 1 }), c = run({ mouse: true }), d = run({ mouse: true, direct: true });
  const same = x => d3(x.eye, a.eye) === 0 && x.yaw === a.yaw && x.pitch === a.pitch;
  ok(same(b) && same(c) && same(d), 'look stick + left stick / mouse / mouselook=direct during the death camera: no effect');
  ok(c.mouseActive && !a.mouseActive, 'the mouse counts still set the mouse latch');
}
{
  // FUN_0032a420(CAM, 1, 0, 0): dead with the gun aimed (view 2) -> view mode 1
  const cam = new FollowCamera(null, null); const core = newCore(); cam.weapon = core;
  core.setView(2);
  cam.startDeath();
  ok(core.cam.view === 1 && core.cam.type === 0xc, `view mode ${core.cam.view}, type 0x${core.cam.type.toString(16)} after startDeath (FUN_0032a420(CAM, 1))`);
}
{
  // P+0x104 == 0x16 (l.758): the read look stick, unramped
  const cam = new FollowCamera(null, null);
  cam.reset({ x: 0, y: 0, z: 0 }, { pitch: 0, yaw: 0 }); cam.startDeath();
  cam.tick({ pos: { x: 0, y: 0, z: 0 }, want: { x: 0, y: 0, z: 1 }, state: 0x16, stick: 0, pad: [1, 0] });
  ok(cam.look190[0] === 1 && cam.look190[1] === 0 && cam.ramp === 0, `state 0x16: look (${cam.look190}) = the stick, ramp untouched`);
}

// ------------------------------------------------ bigHit's stance write (state 0x18's enter FUN_00539b20 -> FUN_00565bd0(P, 0))
{
  // Entering 0x18 runs FUN_00565bd0(P, 0) -> FUN_00573608: CAM+0x1e8 bit 2 cleared. A re-hit already in 0x18 enters
  // nothing (FUN_0055b8e0: same state, no enter), so the bit is not written. Nothing on the page sets bit 2 while he
  // stays in 0x18 (only state 7's enter does), so the bit is preset here by hand to tell the two apart.
  const AT = [-1070.912, -146.066, -1105.614], FACE = [0.912, 0, -0.409];
  const c = new PL.PlayerController(col, { pos: { x: AT[0], y: AT[1], z: AT[2] }, heading: Math.atan2(FACE[0], FACE[2]) });
  c.locate(); c.pos = { x: AT[0], y: AT[1], z: AT[2] }; c.C.face = { x: FACE[0], y: 0, z: FACE[2] };
  Object.assign(c.ctx.motions, pack);
  const cam = new FollowCamera(null, null); c.ctx.cam = cam;
  c.step({ x: 0, z: 0, stick: 0, keys: new Set(), pressed: new Set() }); c.cSnap = null;
  cam.low = true;
  const r1 = c.hitReact({ flags: 4, dir: [-1, 0, 0], aliveBefore: true, deadNow: false });
  const in18 = c.P.state === 0x18, low1 = cam.low;
  cam.low = true;
  const r2 = c.hitReact({ flags: 4, dir: [-1, 0, 0], aliveBefore: true, deadNow: false });
  ok(in18 && r1 === 'big' && !low1, `big hit from state 2 enters 0x18 (${r1}): stance 0 clears CAM+0x1e8 bit 2`);
  ok(c.P.state === 0x18 && cam.low, `re-hit in 0x18 (${r2}): no enter, bit 2 untouched`);
}

// ------------------------------------------------ play.js wiring (the page's game frame)
{
  const src = readFileSync(path.join(here, 'play.js'), 'utf8');
  const blk = /if \(gameOver\) \{\s*gameOver\.frame\(php\.hp === 0, STEP\);\s*if \(gameOver\.go\.events\.includes\('deathCamera'\)\) follow\.startDeath\(\);/.exec(src);
  const iGo = blk ? blk.index : -1, iStart = blk ? blk.index + blk[0].length - 1 : -1;
  const iTick = src.indexOf('follow.tick({ pos: ctrl.pos'), iStep = src.indexOf('ctrl.step(aim(inp, b))');
  ok(iGo > 0 && iStart > iGo && iTick > iStart && iStep > iTick,
     'play.js: gameOver.frame -> deathCamera -> follow.startDeath, then follow.tick, then ctrl.step (FUN_00334590 before FUN_0032ace0)');
  ok(/ctrl\.ctx\.cam = follow/.test(src) && /follow\.clearDeath\(\)/.test(src), 'play.js: ctrl.ctx.cam = follow (setStance), H calls follow.clearDeath()');
}

// ------------------------------------------------ traces: the page's frame, closed loop
const IDLE = () => ({ x: 0, z: 0, stick: 0, keys: new Set(), pressed: new Set() });
function closedLoop(name, { mouse = false } = {}) {
  const file = path.join(DIR, name + '.jsonl');
  if (!existsSync(file)) { ok(false, 'missing ' + file); return null; }
  const recs = new Map();
  for (const l of readFileSync(file, 'utf8').split('\n')) { if (!l) continue; const r = JSON.parse(l); if (r.frame !== undefined) recs.set(r.frame, r); }
  // the player: test_death's closed loop (the f788 bullet kills; its direction from the f799-802 slide)
  const r0 = recs.get(788), m = r0.matrix;
  const c = new PL.PlayerController(col, { pos: { x: m[3][0], y: m[3][1], z: m[3][2] }, heading: Math.atan2(m[2][0], m[2][2]) });
  c.locate(); c.pos = { x: m[3][0], y: m[3][1], z: m[3][2] };
  c.C.face = { x: m[2][0], y: 0, z: m[2][2] }; c.heading = Math.atan2(m[2][0], m[2][2]);
  Object.assign(c.ctx.motions, pack);
  let sx = 0, sz = 0;
  for (let f = 799; f <= 802; f++) { const a = recs.get(f).matrix[3], b = recs.get(f - 1).matrix[3]; sx += a[0] - b[0]; sz += a[2] - b[2]; }
  const dir = [sx / Math.hypot(sx, sz), 0, sz / Math.hypot(sx, sz)];
  let hp = 1;
  c.hpZero = () => hp === 0;
  const go = new GameOver(null);
  const cam = new FollowCamera(null, rays); const core = newCore(); cam.weapon = core;
  c.ctx.cam = cam;                                // play.js: ctrl.ctx.cam = follow (setStance -> CAM+0x1e8 bit 2)
  go.frame(false, 1.2, 0);                        // frame 788: alive at its start
  c.step(IDLE(), cc => { hp = 0; cc.hitReact({ flags: 0x42, dir, deadNow: true }); });
  // the camera as the game left it after frame 788 (record 789); base CAM+0x130 = look-at - the rotated pivot
  // (CAM+0xd0 still 0 there)
  const g0 = recs.get(789), k = g0.cam_170;
  const lowAt789 = cam.low;
  const pitch = F(k, 4), yaw = F(k, 8), at = V3(g0.cam_f0, 0);
  cam.reset({ x: 0, y: 0, z: 0 }, { pitch, yaw });
  const pz = (pitch > 0 ? -4.0 : -3.0) * pitch, cy = Math.cos(yaw), sy = Math.sin(yaw);
  cam.base = [at[0] - pz * sy, at[1] + 17, at[2] - pz * cy];
  cam.eye = V3(g0.cam_60, 0x30); cam.M = [0, 1, 2].map(i => V3(g0.cam_60, 16 * i)); cam.at = at;
  cam.dist = F(k, 0x50); cam.hit = (U(k, 0x78) & 0x80) !== 0;
  cam.gain = F(k, 0x38); cam.idle = hex(k).readInt8(0x72); cam.ramp = F(k, 0x7c); cam.rampDir = [F(k, 0x80), F(k, 0x84)];
  cam.snap = false;
  const err = { eye: [0, 0], at: [0, 0], yaw: [0, 0], pitch: [0, 0] };
  const put = (key, v, f) => { if (v > err[key][0]) err[key] = [v, f]; };
  let flagOff = 0, lowOff = 0, d0Err = 0, phaseOff = 0, startF = null, requestF = null, n = 0, last = 0, clampF = null, moved = 0;
  for (let f = 789; recs.has(f + 1); f++) {
    const r = recs.get(f), g = recs.get(f + 1), pad = r.pad_in;
    const lx = padAxis(pad.lx - 128, pad.ly - 128), ly = padAxis(pad.ly - 128, pad.lx - 128);
    const rx = padAxis(pad.rx - 128, pad.ry - 128), ry = padAxis(pad.ry - 128, pad.rx - 128);
    // play.js order: gameOver.frame (last frame's HP) -> 'deathCamera' -> startDeath, then follow.tick, then ctrl.step
    go.frame(hp === 0, 1.2, 20 * f);
    if (go.events.includes('deathCamera')) { cam.startDeath(); startF ??= f; }
    if (go.events.includes('request')) requestF ??= f;
    if (mouse && f >= 800 && f < 860) cam.addMouse(9, 6);
    cam.tick({ pos: c.pos, want: c.C.dir, state: c.P.state, facing: c.C.face, stick: Math.hypot(lx, ly), pad: [rx, ry] });
    if (rx || ry || lx || ly) moved++;
    const w = stickToWorld(lx, ly, cam.M[0], cam.M[2]);
    c.step({ x: w.x, z: w.z, stick: w.mag, run: false, keys: new Set(), pressed: new Set() });
    const gc = g.cam_170;
    put('eye', d3(cam.eye, V3(g.cam_60, 0x30)), g.frame);
    put('at', d3(cam.at, V3(g.cam_f0, 0)), g.frame);
    put('yaw', Math.abs(wrap(cam.yaw - F(gc, 8))), g.frame);
    put('pitch', Math.abs(cam.pitch - F(gc, 4)), g.frame);
    if (cam.death !== ((U(gc, 0x78) & 0x400000) !== 0)) flagOff++;
    if (cam.phase230 !== U(g.cam_230, 0)) phaseOff++;
    if (cam.low !== ((U(gc, 0x78) & 2) !== 0)) lowOff++;
    d0Err = Math.max(d0Err, d3(cam.d0, V3(g.cam_60, 0x70)));
    if (clampF === null && Math.abs(F(gc, 4) - PITCH_MIN) < 1e-6) clampF = g.frame;
    last = g.frame; n++;
  }
  console.log(`  ${name}: records f790-f${last} (${n}), stick frames ${moved}; worst ` +
              Object.keys(err).map(key => `${key} ${err[key][0].toExponential(2)} (f${err[key][1]})`).join(', '));
  return { err, flagOff, lowOff, d0Err, lowAt789, phaseOff, startF, requestF, last, clampF, moved };
}
// eye: the page's death slide puts him up to 0.0027 u off (test_death), and the base follows him
const LIM = { eye: 0.01, at: 0.005, yaw: 1e-5, pitch: 1e-5 };
const within = (R, s) => Object.keys(LIM).every(key => R.err[key][0] <= LIM[key] * (s || 1));
const A = closedLoop('w199_deathcam');
if (A) {
  ok(A.startF === 789, `death camera starts in frame ${A.startF} (789: dead at its start; record 790 shows it)`);
  ok(A.requestF === 880, `game-over request in frame ${A.requestF} (880, 91 frames on)`);
  ok(A.last >= 1100, `compared to f${A.last} (past the menu f1090)`);
  ok(A.flagOff === 0 && A.phaseOff === 0, `flag 0x400000 / CAM+0x230 per record (${A.flagOff} / ${A.phaseOff} off)`);
  ok(A.lowAt789 && A.lowOff === 0, `CAM+0x1e8 bit 2 from the kill's state 7 enter (FUN_00565bd0 -> FUN_00573608), per record (${A.lowOff} off)`);
  ok(A.d0Err < 1e-5, `CAM+0xd0 (eased to the type's +0x40 = 4.6 at 0.15 x step) per record: worst ${A.d0Err.toExponential(1)}`);
  ok(A.clampF >= 850 && A.clampF <= 856, `pitch reaches the -54 deg clamp at f${A.clampF}`);
  ok(within(A), 'eye / look-at / yaw / pitch per record within ' + JSON.stringify(LIM));
}
const B = closedLoop('w199_deathcam_look');
if (B) {
  ok(B.moved > 60 && B.flagOff === 0, `right + left stick during the death camera (${B.moved} frames): flag per record`);
  ok(within(B), 'w199_deathcam_look: same bounds (the sticks change nothing)');
}
const Cm = closedLoop('w199_deathcam', { mouse: true });
if (Cm) ok(within(Cm), 'w199_deathcam + mouse counts f800-859 on the page: same bounds');
done();
