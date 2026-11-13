// The NTSC video mode (video_mode.js, worker 0295) against NTSC-timing PCSX2 traces.
//   node --import ./native/web/test_hooks.mjs native/web/test_ntsc_traces.mjs
//   DIRGE_VIDEO=pal node --import ./native/web/test_hooks.mjs native/web/test_ntsc_traces.mjs   (the same checks on the PAL traces)
// Traces (game-derived, gitignored, tools/trace/out/w295): the sea-of-flames state with FUN_0040cb78's scale
// (0x4fc7d0+0x20) patched to 1.0 = mode 1's step (notes/frame-rate.md), tools/trace/out/sof_scale1.p2s, scripts
// tools/trace/scripts/w295_ntsc_{run,turn,jump}.json (c_run / d_turn_circle / j_stand's input). PCSX2 still runs 50
// vblanks / s, so each record is one NTSC game frame (step 1.0, dt 0.016666668).
// Checks, every frame: the player's position, ground speed C+0x1d8 and head clip / clip frame (player.js), and the
// cape's settle window MP+0x434 / +0x438 (cloth.js: armed by the clip starts the page chose, counting down once a
// frame, re-armed by the facing). Then test_jump.mjs and test_wall.mjs run on the NTSC traces in this mode.
import { readFileSync, existsSync, mkdirSync, symlinkSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (!process.env.DIRGE_VIDEO) process.env.DIRGE_VIDEO = 'ntsc';
const WEB = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(WEB, '../..');
const OUT = process.env.TRACE_OUT ?? path.join(ROOT, 'tools/trace/out');
const VM = await import(path.join(WEB, 'video_mode.js'));
const { PlayerController, SpeedAnimator, padAxis, stickToWorld, STEP, DT, TICK } = await import(path.join(WEB, 'player.js'));
const { Collision } = await import(path.join(WEB, 'collision.js'));
const { CapeCloth } = await import(path.join(WEB, 'cloth.js'));
const NTSC = !VM.PAL;

let fail = 0, ran = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const load = p => readFileSync(p, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const headOf = d => d.mp_layers[Buffer.from(d.mp_head, 'hex')[8] & 7];
const win = d => { const b = Buffer.from(d.mp_cloth, 'hex'); return [b.readInt32LE(4), b.readInt32LE(8)]; };   // MP+0x434 total, +0x438 remaining

// ---- the mode's constants (FUN_0040cb78, FUN_00322f88, FUN_00254490, FUN_0040c078)
ok(VM.MODE === (NTSC ? 1 : 2) && STEP === (NTSC ? 1.0 : Math.fround(1.1999999)) && DT === Math.fround(STEP * Math.fround(0.016666668)) &&
   TICK === 1 / (NTSC ? 60 : 50) && VM.MOUSE === (NTSC ? 1.0 : Math.fround(1.2)) && VM.FB_H === (NTSC ? 448 : 512),
   `video mode ${VM.NAME}: mode ${VM.MODE}, STEP ${STEP}, DT ${DT}, TICK 1/${1 / TICK}, mouse ${VM.MOUSE}, framebuffer ${VM.FB_W} x ${VM.FB_H}`);

const buf = readFileSync(path.join(WEB, 'data/z128_collision.bin'));
const col = new Collision(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const cloth = JSON.parse(readFileSync(path.join(WEB, 'data/vincent/cloth.json'), 'utf8'));
const KEY = { h_st: 'idle', h_wk: 'walk', h_rn: 'run' }, CLIP = { idle: 'h_st', walk: 'h_wk', run: 'h_rn' };
const POS_TOL = 0.03;          // as test_wall (navMove's double vs the PS2's f32 drift)
const SPD_TOL = 0.05;          // u/s (C+0x1d8)
const FRAME_TOL = 1e-3;        // clip frames

function replay(name) {
  const file = path.join(OUT, name + '.jsonl');
  if (!existsSync(file)) { console.log(`skip ${name}: no trace (${file})`); return; }
  ran++;
  const [meta, ...R] = load(file);
  const r0 = R[0], p0 = r0.matrix[3], f0 = r0.matrix[2];
  // the trace's own step: record 0 holds the saved state's step (1.2), every later record the patched one
  const steps = new Set(R.slice(1).filter(d => d.step !== 0).map(d => d.step));
  ok(steps.size === 1 && [...steps][0] === STEP, `${name}: the game's step DAT_004eeb24 = ${[...steps].join(', ')} in records 1-${R.length - 1} (the page's STEP ${STEP})`);
  const ctrl = new PlayerController(col, { pos: { x: p0[0], y: p0[1], z: p0[2] }, heading: Math.atan2(f0[0], f0[2]) });
  ctrl.C.face = { x: f0[0], y: f0[1], z: f0[2] };
  const anim = Object.create(SpeedAnimator.prototype);
  const h0 = headOf(r0);
  Object.assign(anim, { frames: { idle: 160, walk: 40, run: 20 }, head: { key: KEY[h0.clip], frame: h0.frame, prevFrame: h0.frame },
                        out: null, blend: { len: 0, rem: 0, w: 1 }, installed: false, cur: -1, override: null,
                        rate: 0.5, current: KEY[h0.clip], actions: {}, names: {} });
  ctrl.attach({ anim });
  // the cape window (cloth.js FUN_005a95f0 / FUN_005aa5b8 / FUN_005a6f40), from record 0's state
  const cape = Object.create(CapeCloth.prototype);
  [cape.total, cape.remaining] = win(r0);
  Object.assign(cape, { windows: cloth.clip_windows, mpFlag100000: false, cloth_on: true, lastFacing: [f0[0], f0[1], f0[2]] });
  let pe = 0, pf = null, se = 0, sf = null, ce = 0, cf = null, we = 0, wf = null, arms = 0, rearms = 0, dist = 0, runF = 0;
  let key = anim.head.key;
  for (let i = 0; i + 1 < R.length; i++) {
    const d = R[i], g = R[i + 1], pad = d.pad_in;
    const sx = padAxis(pad.lx - 128, pad.ly - 128), sy = padAxis(pad.ly - 128, pad.lx - 128);
    const cm = g.cam_matrix, w = stickToWorld(sx, sy, cm[0], cm[2]);
    const before = { ...ctrl.pos };
    ctrl.step({ x: w.x, z: w.z, stick: w.mag, run: false, keys: new Set(), pressed: new Set() });
    const gp = g.matrix[3];
    const e = Math.hypot(ctrl.pos.x - gp[0], ctrl.pos.z - gp[2]);
    if (e > pe) { pe = e; pf = g.frame; }
    const s = Math.abs(ctrl.C.spd * 60 - g.ground_speed);
    if (g.ground_speed > 0 && ctrl.C.spd > 0 && s > se) { se = s; sf = g.frame; }
    const gh = headOf(g), ph = anim.head;
    if (CLIP[ph.key] !== gh.clip || Math.abs(ph.frame - gh.frame) > FRAME_TOL) { ce++; cf ??= `${g.frame} ${CLIP[ph.key]}:${ph.frame.toFixed(2)} vs ${gh.clip}:${gh.frame.toFixed(2)}`; }
    if (g.frame >= 22 && g.frame <= 34) { dist += Math.hypot(ctrl.pos.x - before.x, ctrl.pos.z - before.z); runF++; }   // full run, before the deck edge (0293's window)
    // the window: a clip request this frame arms it, the decrement, then the facing test (cloth.js frame())
    if (ph.key !== key) { cape.clipStart(CLIP[ph.key]); key = ph.key; arms++; }
    const rem0 = cape.remaining;
    cape.decrement(STEP);
    const f = ctrl.C.face;
    cape.facing([f.x, f.y, f.z]);
    if (cape.remaining > rem0) rearms++;
    const [gt, gr] = win(g);
    if (cape.total !== gt || cape.remaining !== gr) { we++; wf ??= `${g.frame} page ${cape.total}/${cape.remaining} game ${gt}/${gr}`; }
  }
  ok(pe <= POS_TOL, `${name}: position max err ${pe.toExponential(2)} (frame ${pf}) over ${R.length - 1} frames`);
  ok(se <= SPD_TOL, `${name}: ground speed C+0x1d8 max err ${se.toExponential(2)} u/s (frame ${sf})`);
  ok(ce === 0, `${name}: head clip and clip frame every frame (${ce} off${cf ? ', first ' + cf : ''})`);
  ok(we === 0, `${name}: cape window MP+0x434 / +0x438 every frame (${we} off${wf ? ', first ' + wf : ''}; ${arms} clip arms, ${rearms} facing re-arms)`);
  if (runF && dist > 0) console.log(`info ${name}: ${(dist / runF).toFixed(4)} u per frame (frames 22-34) = ${(dist / runF / TICK).toFixed(2)} u/s at the mode's ${1 / TICK} Hz`);
  return { runPerFrame: runF ? dist / runF : 0 };
}
const run = replay(NTSC ? 'w295/w295_ntsc_run' : 'c_run');
replay(NTSC ? 'w295/w295_ntsc_turn' : 'd_turn_circle');
// real-time speed: the run is 60 u/s in both modes (1.0 u a 1/60 s frame, 1.2 u a 1/50 s frame)
if (run && run.runPerFrame) ok(Math.abs(run.runPerFrame / TICK - 60) < 0.05, `run speed in real time ${(run.runPerFrame / TICK).toFixed(3)} u/s (60 in both modes)`);

// ---- test_jump / test_wall on the NTSC traces, in this mode (their trace names linked to the w295 ones)
if (NTSC) {
  const tmp = path.join(OUT, 'w295', 'as_pal_names');
  rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
  for (const [a, b] of [['j_stand', 'w295_ntsc_jump'], ['c_run', 'w295_ntsc_run']]) {
    if (existsSync(path.join(OUT, 'w295', b + '.jsonl'))) symlinkSync(path.join(OUT, 'w295', b + '.jsonl'), path.join(tmp, a + '.jsonl'));
  }
  for (const t of ['test_jump.mjs', 'test_wall.mjs']) {
    const r = spawnSync(process.execPath, ['--import', path.join(WEB, 'test_hooks.mjs'), path.join(WEB, t)],
                        { env: { ...process.env, DIRGE_VIDEO: 'ntsc', TRACE_OUT: tmp }, encoding: 'utf8' });
    const lines = (r.stdout + r.stderr).trim().split('\n').filter(l => !/^skip /.test(l));
    for (const l of lines) console.log('  ' + t + ': ' + l);
    ok(r.status === 0, `${t} on the NTSC traces in NTSC mode (exit ${r.status})`);
  }
  rmSync(tmp, { recursive: true, force: true });
}
if (!ran) { console.log('no traces found'); process.exit(1); }
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
