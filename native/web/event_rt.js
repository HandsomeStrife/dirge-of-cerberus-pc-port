// event_rt.js -- the event runtime around the script VM: clock, commands, event cameras, fades (worker 0210;
// notes/event-vm-research.md). Translated from the game (PAL SLES_541.85); addresses cite the functions.
//
// The event object (DAT_004efba0):
//   clock     = +0x9848 - +0x9858: milliseconds. FUN_003798a0 adds the EE timer's ms (FUN_0023c1f0: count / 0x24000
//               x scale 1.0) since the last update; FUN_00379908 / FUN_00377c68 add paused time to +0x9858.
//   commands  = 32 slots of 0x80 at +0x520, bit mask +0x514 (FUN_00376040 allocates: handle = ++(+0x1520)).
//               wait(h) (FUN_0039c450 -> FUN_00379d48) blocks while a live slot has +0xc == h (FUN_00380a90).
//   cameras   = 6 of 0x90 at +0x30 + id x 0x90: +0x30 eye, +0x40 aim, +0x50 up point (eye + up), +0x60 fov,
//               +0x64 active flag, +0x74.. 9 splines + +0x98 the fov spline, +0xa0 / +0xa4 key time max / min.
// Per frame (FUN_00377c68, the main thread): the VM thread's window (FUN_003761a8(ev, 1) .. FUN_00376158(ev, 1);
// see event_vm.js), the clock update FUN_003798a0, the command slots in order 0..31, then the camera
// output FUN_00379148. `frame(dtMs)` does the same, in that order.

import { EventVM, block } from './event_vm.js';
import { soundNatives, sendEventSe, skipSound } from './event_sound.js';

const f32 = Math.fround;

// --- splines: FUN_002616f0 (build) / FUN_00261a90 (evaluate) -------------------------------------------------
// tangents: central differences of time and value (ends: one-sided); a segment whose value step is within
// DAT_0046be00 is linear, else cubic Hermite with slope dv/dt x |segment|.
export function buildSpline(ts, vs, eps) {
  let n = ts.length;
  if (n < 1) { ts = [0]; vs = [0]; n = 1; }
  const dt = new Array(n), dv = new Array(n);
  if (n === 1) { dt[0] = 1; dv[0] = 0; }
  else if (n === 2) { dt[0] = dt[1] = f32(ts[1] - ts[0]); dv[0] = dv[1] = f32(vs[1] - vs[0]); }
  else {
    for (let i = 1; i < n - 1; i++) { dt[i] = f32(ts[i + 1] - ts[i - 1]); dv[i] = f32(vs[i + 1] - vs[i - 1]); }
    dt[0] = f32(ts[1] - ts[0]); dv[0] = f32(vs[1] - vs[0]);
    dt[n - 1] = f32(ts[n - 1] - ts[n - 2]); dv[n - 1] = f32(vs[n - 1] - vs[n - 2]);
  }
  return { n, t: ts.map(f32), v: vs.map(f32), dt, dv, eps };
}

export function evalSpline(x, s) {
  const t = s.t, v = s.v;
  if (x < t[0]) return v[0];
  if (t[s.n - 1] < x) return v[s.n - 1];
  let hi = s.n - 1, lo = 0, m = hi;                          // the binary search as written (FUN_00261a90)
  if (0 < hi) {
    do { m = m >> 1; if (t[m] < x) { lo = m + 1; m = hi; } hi = m; m = lo + hi; } while (lo < hi);
  }
  const i = lo - (0 < lo ? 1 : 0);
  const v0 = v[i], v1 = v[i + 1], d = f32(v1 - v0);
  if (Math.abs(d) <= s.eps) return f32(v0 + f32(f32(d / f32(t[i + 1] - t[i])) * f32(x - t[i])));
  const h = f32(t[i + 1] - t[i]), u = f32(f32(x - t[i]) / h), w = f32(1 - u), ah = Math.abs(h);
  return f32(f32(f32(f32(f32(u + u) + 1) * w) * w * v0)
    + f32(f32(f32(u * w) * w) * f32(s.dv[i] / s.dt[i]) * ah)
    + f32(f32(f32(-u * u) * w) * f32(s.dv[i + 1] / s.dt[i + 1]) * ah)
    + f32(f32(u * u) * f32(3 - f32(u + u)) * v1));
}

// DAT_0046be00: the spline's "flat segment" threshold, read from the ELF by the exporter (data.splineEps)
const SPLINE_EPS_DEFAULT = null;

export class EventRuntime {
  constructor(data, opts = {}) {
    this.warn = opts.warn || ((m) => console.warn(m));
    this.zoneLoad = opts.zoneLoad || null;
    this.actors = opts.actors || null;          // event_actor_rt.js EventActors (worker 0218): the KerberosActor natives
    this.sound = opts.sound || null;            // event_sound.js back ends (worker 0222): music, area, audio, voices
    this.windows = opts.windows || null;        // event_window.js (worker 0222): KerberosWindow open_l / close_l
    this.skip = 0;                              // +0x156c: 1 at FUN_00372f70 (the Skip choice), 2 from the next frame
    this.skipMode = 0;                          // +0x9860 (setSkipMode bits; read by the load / window commands)
    this.lang = opts.lang ?? 2;                 // FUN_00242450 = PTR_0046b2dc: 2 in the z128 save (the page's language)
    this.eps = data.splineEps ?? SPLINE_EPS_DEFAULT;
    if (this.eps == null) throw new Error('event data: no splineEps (re-run export_web_event.py)');
    this.clock = 0;                             // +0x9848 - +0x9858 (FUN_00373098 sets both to 0 / now at the start)
    this.slots = [];                            // live commands, in slot order
    this.handle = 0;                            // +0x1520
    this.cams = Array.from({ length: 6 }, () => this.newCam());
    this.view = null;                           // FUN_00379148's output: { eye, aim, upDir, fov, cam }
    this.fade = null;                           // { level, rate } (FUN_002f4480 / FUN_002f4578)
    this.state = { usercontrol: null, battlecontrol: null, battlemode: null, skip: 0, zone: null };
    this.log = [];                              // (frame, what) for tests
    this.frameNo = 0;
    this.vm = new EventVM(data, this.natives(), { warn: this.warn });
    this.data = data;
  }

  newCam() {
    return { eye: [0, 0, 0], aim: [0, 0, 0], up: [0, 0, 0], fov: 65, active: false, keys: null, spl: null, tmin: 0, tmax: 0, t: 0 };
  }

  start() { this.vm.start(this.data.main, 'main', '([Ljava/lang/String;)V', [{ $arr: true, kind: 'L', a: [] }]); }

  get done() { return this.vm.done; }

  // a command slot (FUN_00376040): 32 at most; the game spins until one frees (never reached by scr001)
  cmd(type, extra) {
    if (this.slots.length >= 32) throw new Error('event: all 32 command slots busy');
    this.handle = this.handle + 1 > 0x7ffffffd ? 1 : this.handle + 1;
    const c = Object.assign({ type, h: this.handle }, extra);
    this.slots.push(c);
    return c.h;
  }

  busy(h) { return this.slots.some(c => c.h === h); }

  frame(dtMs = 20) {
    this.frameNo++;
    // FUN_003e9ed0: last frame's event SEs go out (event_sound.js)
    if (this.sePending && this.sePending.length) this.seSent = sendEventSe(this, this.sound && this.sound.audio ? this.sound.audio() : null);
    if (!this.vm.done) this.vm.run();                                   // the VM thread's window
    this.clock = (this.clock + dtMs) >>> 0;                              // FUN_003798a0
    for (const c of this.slots.slice()) {                                // FUN_00377c68's slot loop
      let fin = false;
      if (c.type === 0x1c) fin = this.skip !== 0 || this.clock >= c.until;   // case 0x1c: timer (Skip ends it)
      else if (c.type === 7) fin = this.camMove(c);                      // case 7: FUN_003779d0
      if (fin) this.slots.splice(this.slots.indexOf(c), 1);
    }
    if (this.windows) this.windows.frame(this);                          // the event windows' state (event_window.js)
    if (this.skip === 1) this.skip = 2;                                  // FUN_00377c68's tail
    this.camOutput();                                                    // FUN_00379148
    if (this.fade) {                                                     // the fade particle (see fadeTo)
      // GUESS: the level moves by the rate once per tick, 1.2 ticks per PAL frame (FUN_00322f88's step);
      // the particle's integration of +0x4c / +0x6c is not decoded (notes/event-vm-research.md)
      const f = this.fade; f.level = f32(f.level + f32(f.rate * 1.2));
      if (f.level <= 0) { f.level = 0; } else if (f.level >= 256) f.level = 256;
    }
  }

  // case 7 / FUN_003779d0: key time t = from + rate x (clock - start), clamped to the keys, FUN_00374a08(t, 1)
  camMove(c) {
    const cam = this.cams[c.cam];
    if (this.skip === 2) {                                               // +0x156c == 2: the key time is the move's end
      let tc = cam.tmin <= c.to ? c.to : cam.tmin;
      if (cam.tmax < tc) tc = cam.tmax;
      if (cam.spl) this.camEval(cam, tc);
      return true;
    }
    const t = f32(c.from + f32(c.rate * (this.clock - c.start)));
    let tc = cam.tmin <= t ? t : cam.tmin;
    if (cam.tmax < tc) tc = cam.tmax;
    if (cam.spl) this.camEval(cam, tc);
    return !(t < c.to);
  }

  // FUN_00374a08 with param_8 = 1: the 9 splines -> eye, aim, up point; fov from its spline (or kept)
  camEval(cam, t) {
    cam.t = t;
    if (t < cam.tmin || cam.tmax < t) return false;
    const s = cam.spl;
    for (let k = 0; k < 3; k++) {
      cam.eye[k] = evalSpline(t, s[k]);
      cam.aim[k] = evalSpline(t, s[3 + k]);
      cam.up[k] = evalSpline(t, s[6 + k]);
    }
    if (s[9]) cam.fov = evalSpline(t, s[9]);
    return true;
  }

  // FUN_00379148 (no bound actor, no flags): the first active camera -> sceVu0CameraMatrix(eye, aim - eye,
  // -(up point - eye) normalised) (FUN_00445040); fov -> the render camera +0x40 -> FUN_003edce0
  camOutput() {
    const i = this.cams.findIndex(c => c.active);
    if (i < 0) { this.view = null; return; }
    const c = this.cams[i];
    const u = [f32(-(c.up[0] - c.eye[0])), f32(-(c.up[1] - c.eye[1])), f32(-(c.up[2] - c.eye[2]))];
    const r = 1 / Math.sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]);
    this.view = { cam: i, eye: c.eye.slice(), aim: c.aim.slice(), upDir: u.map(x => f32(x * r)), fov: c.fov };
  }

  // fadein / fadeout (FUN_003a22e0 / FUN_003a2420 -> FUN_003736c8): ms -> s; FUN_002f4480 (in): level 256 falling
  // by 256 / (s x 60) per tick (s <= 0: level 0 at once); FUN_002f4578 (out): level 0 rising (s <= 0: 256 at once).
  // The particle is emitter (2 | 4) + b of the system FED (tables 0x46d520 / 0x46d528); its draw is not decoded.
  fadeTo(isIn, ms, a, b) {
    // FUN_003736c8: with +0x156c != 0 a fade (not the _noskip one) does nothing
    if (this.skip !== 0) { this.log.push([this.frameNo, (isIn ? 'fadein ' : 'fadeout ') + ms + ' (skip)']); return; }
    const s = f32(ms * 0.001);
    if (isIn) this.fade = s > 0 ? { level: 256, rate: f32(-(256 / f32(s * 60))), b, a } : { level: 0, rate: -256, a, b };
    else this.fade = s > 0 ? { level: 0, rate: f32(256 / f32(s * 60)), a, b } : { level: 256, rate: 256, a, b };
    this.log.push([this.frameNo, (isIn ? 'fadein ' : 'fadeout ') + ms]);
  }

  // FUN_00372f70 (the Skip choice; offered by FUN_003c0520 while an event runs out of battle mode, stage-controller.md):
  // +0x156c = 1, +0x1558 bit 36, then FUN_003e9950 / FUN_003ea5f0 (stream SEs and the voice channels stop) and
  // FUN_003b7118(DAT_00472a80, id, 1) for each open event window (+0x9804 / +0x9808, 5 of 0xc).
  requestSkip() {
    if (this.skip !== 0) return false;
    this.skip = 1;
    this.log.push([this.frameNo, 'skip']);
    if (this.sound) skipSound(this.sound);
    if (this.windows) this.windows.skip(this);
    this.vm.warnOnce('skip-rest', 'event: FUN_00372f70\'s FUN_00380ca0(0xb4), FUN_002420e0, FUN_002f47e0, FUN_002574a0, FUN_003e6fc8 and the event effects\' stop (FUN_002ebdb8) left out');
    return true;
  }

  natives() {
    const R = this;
    const pop = (o, k) => o.f[k] ?? 0;
    const N = {
      // ---- fake/KerberosEvent ----
      // wait (FUN_0039c450 -> FUN_00379d48): poll until no live command has the handle
      'fake/KerberosEvent.wait(I)V': (vm, [h]) => (R.busy(h) ? block(() => !R.busy(h)) : undefined),
      // sleep (FUN_003a0e48): poll until clock - start >= n (n = 0: returns at once? no: the loop runs while
      // n == 0 too, until the abort bit; the scripts never pass 0)
      // (worker 0219, stage-controller.md "Skip"): the loop also ends when +0x156c != 0
      'fake/KerberosEvent.sleep(I)V': (vm, [n]) => {
        const t0 = R.clock, u = n >>> 0;
        if (u === 0) R.warn('event: sleep(0) blocks forever in the game (FUN_003a0e48); not reached by scr001');
        return block(() => R.skip !== 0 || ((R.clock - t0) >>> 0 >= u && u !== 0));
      },
      // setTimer (FUN_003a4698 -> FUN_0037db48): command 0x1c, done when clock >= now + max(n, 0)
      'fake/KerberosEvent.setTimer(I)I': (vm, [n]) => R.cmd(0x1c, { until: (R.clock + Math.max(n, 0)) >>> 0 }),
      'fake/KerberosEvent.getLang()I': () => R.lang,                       // FUN_0039fbe8
      'fake/KerberosEvent.isdebugmode()Z': () => 0,                        // FUN_003a4928: retail
      'fake/KerberosEvent.isSabotenViewer()Z': () => 0,                    // FUN_0039e7d0: retail
      'fake/KerberosEvent.set_usercontrol(Z)V': (vm, [v]) => { R.state.usercontrol = v; R.log.push([R.frameNo, 'usercontrol ' + v]); },
      'fake/KerberosEvent.set_battlecontrol(Z)V': (vm, [v]) => { R.state.battlecontrol = v; R.log.push([R.frameNo, 'battlecontrol ' + v]); },
      'fake/KerberosEvent.set_battlemode(I)V': (vm, [v]) => { R.state.battlemode = v; R.log.push([R.frameNo, 'battlemode ' + v]); },
      // setSkipMode (FUN_0039ea68): +0x9860 |= 1 << n after the load commands (types 2, 9, 0x12, 0x1a, 0x1b) are
      // under way; the page has no load commands. unsetSkipMode (FUN_0039ea18) clears it.
      'fake/KerberosEvent.setSkipMode(I)V': (vm, [n]) => { R.skipMode |= 1 << (n & 31); R.state.skip = R.skipMode; },
      'fake/KerberosEvent.unsetSkipMode()V': () => { R.skipMode = 0; R.state.skip = 0; },
      'fake/KerberosEvent.isSkip()Z': () => (R.skip !== 0 ? 1 : 0),        // FUN_003a0d88: +0x156c != 0
      'fake/KerberosEvent.useZone(I)V': (vm, [z]) => { R.state.zone = z; },
      // the stage title card (FUN_0039e8e8 / FUN_003fdb48; FUN_003fdd30): not on the page -> never showing
      'fake/KerberosEvent.displayStageInfo_l(ILjava/lang/String;)V': () => { R.warn('event: displayStageInfo (the stage title card) left out'); },
      'fake/KerberosEvent.isDisplayStageInfo(I)Z': () => 0,
      'fake/KerberosIntermission.calc()V': () => {},
      // Zone.load_l (method +0x0c of KerberosZone): the stage load FUN_002673d8(zone, a, b): chunk slots 1 / 2 = a / b
      // (worker 0216's area_stream.js; the page's load is at once, its GUESS row). The handle is never busy here.
      'fake/KerberosZone.load_l(III)I': (vm, [z, a, b]) => { if (R.zoneLoad) R.zoneLoad(z, a, b); R.log.push([R.frameNo, 'zone ' + [z, a, b]]); return 0; },
      // ---- fake/KerberosCamera ----
      'fake/KerberosCamera.init_l(I)V': (vm, [id]) => {                 // FUN_0039cde8 -> FUN_0037cae0
        if (id >>> 0 < 6) R.cams[id] = R.newCam();
      },
      'fake/KerberosCamera.adddata_start_l(I)V': (vm, [id]) => {        // FUN_003a3100 -> FUN_003745b8
        if (id >>> 0 >= 6) return;
        R.slots = R.slots.filter(c => !(c.type === 7 && c.cam === id));
        R.cams[id].spl = null; R.cams[id].keys = null;
      },
      // FUN_003a3008 -> FUN_00374418: one key: t, eye, aim, eye + up (the third vector is stored as a point), fov
      'fake/KerberosCamera.adddata_l(IFFFFFFFFFFFI)V': (vm, [id, t, ex, ey, ez, ax, ay, az, ux, uy, uz, fov]) => {
        const c = R.cams[id];
        if (!c.keys) c.keys = [];
        c.keys.push({ t, e: [ex, ey, ez], a: [ax, ay, az], u: [f32(ux + ex), f32(uy + ey), f32(uz + ez)], fov });
      },
      // FUN_003a2a80 -> FUN_00374278: 9 splines + the fov spline; +0xa0 / +0xa4 = the keys' max / min time
      'fake/KerberosCamera.adddata_end_l(II)V': (vm, [id]) => {
        const c = R.cams[id];
        if (!c.keys) return;
        const ts = c.keys.map(k => k.t), ch = [];
        for (const v of ['e', 'a', 'u']) for (let k = 0; k < 3; k++) ch.push(buildSpline(ts, c.keys.map(x => x[v][k]), R.eps));
        ch.push(buildSpline(ts, c.keys.map(x => x.fov), R.eps));
        c.spl = ch; c.tmax = Math.max(...ts.map(f32)); c.tmin = Math.min(...ts.map(f32)); c.keys = null;
      },
      // move_l (FUN_0039c978 -> FUN_0037a440): command 7 (from, to, rate per ms, start clock)
      'fake/KerberosCamera.move_l(IFFF)I': (vm, [id, from, to, rate]) => R.cmd(7, { cam: id, from, to, rate, start: R.clock }),
      // active_l (FUN_0039cac8 -> FUN_0037c7b0): this camera on, the others off
      'fake/KerberosCamera.active_l(II)V': (vm, [id]) => {
        if (id >>> 0 >= 6) return;
        R.cams.forEach((c, i) => { c.active = i === id; });
        R.log.push([R.frameNo, 'camera ' + id]);
      },
      'fake/KerberosCamera.active_l2(II)V': (vm, [id]) => { if (id >>> 0 < 6) R.cams.forEach((c, i) => { c.active = i === id; }); },
      // set_l (FUN_0039cce0 -> FUN_0037a4d0): eye, aim, up point straight into the slot
      'fake/KerberosCamera.set_l(IFFFFFFFFF)V': (vm, [id, ex, ey, ez, ax, ay, az, ux, uy, uz]) => {
        const c = R.cams[id]; c.eye = [ex, ey, ez]; c.aim = [ax, ay, az]; c.up = [ux, uy, uz];
      },
      'fake/KerberosCamera.setfov_l(IF)V': (vm, [id, fov]) => { R.cams[id].fov = fov; },   // FUN_003a2a30
      // load_l (FUN_0039ca10 -> FUN_0037a538): command 8 (FUN_003838b8) reads the camera file FUN_00250838(n, event)
      // and FUN_00374720 builds the camera from it: FUN_003745b8 (old keys and moves go), per channel FUN_00373908:
      // its keys' (time, value) -> FUN_002616f0 (FUN_00261a88, the threshold setter, is empty: DAT_0046be00 stays);
      // types 0-8 -> eye / aim / up point x / y / z, 9 -> the fov spline; +0xa0 / +0xa4 = max / min key time.
      // The page's file is resident: the camera is built at the call and the handle is never busy (the game's load
      // takes disc time; see notes/fidelity-audit.md 'event loads')
      'fake/KerberosCamera.load_l(II)I': (vm, [id, n]) => {
        const f = R.data.cameraFiles && R.data.cameraFiles[n];
        if (!f) { R.warn('event: camera file ' + n + ' not exported (left out)'); return 0; }
        if (id >>> 0 >= 6 || f.hdr8 !== 0) return 0;
        R.slots = R.slots.filter(c => !(c.type === 7 && c.cam === id));
        const c = R.cams[id], ch = new Array(10).fill(null);
        let lo = f.channels[0] && f.channels[0].keys.length ? f32(f.channels[0].keys[0][0]) : 0, hi = lo;
        for (const k of f.channels) {
          for (const [t] of k.keys) { const x = f32(t); if (x < lo) lo = x; if (hi < x) hi = x; }
          if (k.type === 10) { R.warn('event: camera file channel type 10 (FUN_00373908 group 4) not translated'); continue; }
          if (k.type >= 0 && k.type < 10) ch[k.type] = buildSpline(k.keys.map(x => x[0]), k.keys.map(x => x[1]), R.eps);
        }
        if (ch.slice(0, 9).some(x => !x)) R.warn('event: camera file ' + n + ' lacks a channel');
        c.spl = ch; c.keys = null; c.tmin = lo; c.tmax = hi;
        return 0;
      },
      // ---- fake/KerberosEffect ----
      'fake/KerberosEffect.fadein(FII)V': (vm, [ms, a, b]) => R.fadeTo(true, ms, a, b),
      'fake/KerberosEffect.fadeout(FII)V': (vm, [ms, a, b]) => R.fadeTo(false, ms, a, b),
    };
    if (R.actors) Object.assign(N, R.actors.natives(R));
    if (R.sound) Object.assign(N, soundNatives(R, R.sound));
    if (R.windows) Object.assign(N, R.windows.natives(R));
    return N;
  }
}
