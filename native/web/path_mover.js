// Stage path walking: script cmd 0x131 puts a soldier on a stage path (worker 0159).
// A direct translation of the game's body mover 1 and move mode 9; notes/enemy-ai-hook.md 'Path walking'.
//
//   cmd 0x131 -> FUN_0055a6d8(a, path, 0, -1): FUN_00352cb8 (path, first / last node), the turn mode
//   (FUN_0034e960(C, 5 / 6)), FUN_0034edf0(C, 1) (mover 1) -> FUN_0034f178 -> FUN_0034f4a0 (the segment's
//   four spline points) -> FUN_0034db80(C, 9) -> FUN_0034bd10 (polyline + duration, FUN_00353480).
//   Every frame the body update FUN_0034ea18: the mover FUN_0034f8c0 -> FUN_0034fad0 (next node on
//   arrival), the move FUN_0034c388 (mode 9: position along the polyline by time, direction = spline
//   slope), time += dt, FUN_0034d870 at the segment's end, then the turn FUN_0034de50 (mode 5: face the
//   move direction).
//
// State lives on the actor's body object a.C under the game's field offsets (named below); the
// position C+0x30 and the facing row C+0x20 are a.pos / a.face (the page's actor fields).
//   C.f1c0 / C.f1c4  move flags        C.mm   +0x1c8 move mode       C.t    +0x1cc segment time
//   C.dur  +0x1d0 segment duration     C.spd  +0x1d4 constant speed  C.speed +0x1d8 ground speed
//   C.seg  +0x1dc chord length         C.cp   +0x100..+0x13f spline points
//   C.i200 / C.n204 polyline index / count   C.arc +0x208   C.arcLen +0x20c   C.tension +0x210
//   C.poly / C.arcs  the polyline C+0x3a0 and its cumulative lengths C+0x3a4
//   C.s214 turn mode, C.t2c0 +0x2c0 turn target   C.dir +0x90 move direction
//   C.mover +0x300   C.path +0x310   C.node +0x314   C.last +0x318   C.p31c..C.p32c +0x31c..+0x32c
import * as NG from './nav_graph.js';
import { DT } from './video_mode.js';
const f = Math.fround;

// FUN_00310c40 = G+0x64: 48 in the save (the gate in FUN_0034f4a0: > 8 sets the spline's points C+0x100..)
export const G64 = 48;
// DAT_0046e290 +0xc: the time a body's move clock C+0x1cc gains per frame (FUN_0034ea18), seconds.
// T: w159_walk95 (every frame of 46 / 47's walk: C+0x1cc gains 0.02 = 1.2 ticks / 60)
export const MOVE_DT = DT;                  // DAT_004eeb28 (video_mode.js: f32 0.02 PAL, 0.016666668 NTSC)

// FUN_00311120: section 9 entry i (null when i >= the count; the exporter checks the layout)
export function pathOf(paths, i) {
  return paths && i >= 0 && i < paths.length ? paths[i] : null;
}
// FUN_003217e0: node i of path p. Not looped: i < 0 -> node 1 (0 for a 1-node path), i >= n -> n - 2.
// Looped (flags bit 0): i mod n. FUN_00311180 = section 10 [first + i].
export function nodeOf(p, i) {
  const n = p.n;
  if (n < 1) return null;
  if (p.flags & 1) { i = i % n; if (i < 0) i += n; }
  else if (i < 0) i = n > 1 ? 1 : 0;
  else if (i >= n) i = n > 1 ? n - 2 : 0;
  return p.nodes[i] || null;
}
// FUN_0025fcc8: cardinal spline weights of the four points at u (tension k)
export function splineBasis(u, k) {
  const u2 = f(u * u), u3 = f(u2 * u);
  return [
    f(f(f(f(-k) * u3) + f(f(k + k) * u2)) - f(k * u)),
    f(f(f(f(2.0 - k) * u3) + f(f(k - 3.0) * u2)) + 1.0),
    f(f(f(f(k - 2.0) * u3) + f(f(3.0 - f(k + k)) * u2)) + f(k * u)),
    f(f(k * u3) - f(k * u2)),
  ];
}
// FUN_0025fd58: their slopes (d/du)
export function splineSlope(u, k) {
  const u2 = f(u * u);
  return [
    f(f(f(k * u2) * -3.0) + f(f(k * u) * 4.0)) - k,
    f(f(f(6.0 - f(k * 3.0)) * u2) + f(f(f(k + k) - 6.0) * u)),
    f(f(f(f(k * 3.0) - 6.0) * u2) + f(f(6.0 - f(k * 4.0)) * u)) + k,
    f(f(f(k * u2) * 3.0) - f(f(k + k) * u)),
  ].map(f);
}
// FUN_0026138c: p0 b.x + p1 b.y + p2 b.z + p3 b.w (VU ACC chain)
function comb(cp, b) {
  const o = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    let s = f(cp[0][c] * b[0]);
    s = f(s + f(cp[1][c] * b[1]));
    s = f(s + f(cp[2][c] * b[2]));
    o[c] = f(s + f(cp[3][c] * b[3]));
  }
  return o;
}
const len3 = v => f(Math.sqrt(f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]))));
const dist3 = (a, b) => len3([f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2])]);
const unit3 = v => { const l = len3(v); return l ? [f(v[0] / l), f(v[1] / l), f(v[2] / l)] : v.slice(0, 3); };   // vrsqrt x vmulq
const lerp4 = (a, b, t) => [0, 1, 2, 3].map(c => f(a[c] + f(f(b[c] - a[c]) * t)));                     // FUN_002611f4

// the move state a body starts with (save state: 46 / 47 idle, trace w159_walk95 f770)
export function bodyInit(C, spd) {
  Object.assign(C, {
    f1c4: C.f1c4 ?? 0x104, mm: 0, t: 0, dur: 1.0, spd: f(spd), seg: 0, cp: [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]],
    poly: [], arcs: [], i200: 0, n204: 0, arc: 0, arcLen: 0, tension: f(0.4), dir: [0, 0, 0],
    path: 0, node: 0, last: 0, p31c: 0, p320: 0, p324: 0, p328: 0, p32c: 0, s218: 0, s21c: 0, t2c0: null,
  });
  return C;
}

// FUN_0034e960(C, mode): turn mode C+0x214, C+0x218 = 0, C+0x1c4 bit 1 set / bit 3 clear, then FUN_0034dc50:
// mode 5 -> C+0x2c0 = (facing row, w 1.0) and C+0x21c = -1 (FUN_0034bcf8); mode 6 -> C+0x21c = -1.
export function setTurn(a, mode) {
  const C = a.C;
  C.s214 = mode; C.s218 = 0;
  C.f1c4 = ((C.f1c4 & ~8) | 2) >>> 0;
  if (mode === 5) C.t2c0 = [a.face[0], a.face[1], a.face[2], 1.0];
  if (mode === 4 || mode === 5 || mode === 6 || mode === 7 || mode === 8) C.s21c = -1.0;
}

// FUN_0055a6d8(a, path, 0, -1) after its body check; turnMode = 5 / 6 as the caller found it (FUN_0035eda0
// target and C+0x590 bit 24), or null for 'unchanged' (no AI and actor +0xe4 bit 0). Returns false when
// nothing started (no path, or the path's mover 0xe branch).
// first / last: FUN_0055a6d8's node range (cmd 0x131 passes 0, -1; cmd 0x13a its r1 / r2).
export function pathStart(a, paths, idx, turnMode, warn = () => {}, first = 0, last = -1) {
  const C = a.C, p = pathOf(paths, idx);
  if (!p) return false;
  if ((p.flags >> 3) & 1) {
    // FUN_0034e960(C, 0), FUN_0034db80(C, 0, 0), FUN_00352d70, FUN_0034edf0(C, 0xe): not translated
    warn(`path_mover: path ${idx} flags bit 3 (mover 0xe, FUN_00352d70) not translated: the soldier stands`);
    return false;
  }
  // FUN_00352cb8(C, idx, first, last): C+0x314 = first < n ? first : n - 1; C+0x318 = last when last != -1 and
  // last < n, else path +8 bit 0 ? -1 : n - 1 (signed compares)
  C.path = idx;
  C.node = first < p.n ? first : p.n - 1;
  C.last = (last !== -1 && last < p.n) ? last : ((p.flags & 1) ? -1 : p.n - 1);
  if (turnMode != null) setTurn(a, turnMode);
  return moverStart(a, paths, warn);
}

// FUN_0034edf0(C, 1)
export function moverStart(a, paths, warn = () => {}) {
  const C = a.C;
  if (C.mover !== 0) moverStop(a, warn);
  C.f1c4 = (C.f1c4 & ~0x80) >>> 0;
  const p = pathOf(paths, C.path);
  if (!p) return false;
  if (C.node < 0 || p.n <= C.node) C.node = 0;
  C.tension = f(p.tension);                                                  // C+0x210 = path +0xc
  let lo = C.node, hi = C.last, len = 0;
  if (hi === lo) { lo = 0; hi = p.n; }
  for (let i = lo; i < hi; i++) { const nd = nodeOf(p, i); if (nd) len = f(len + f(nd.seg)); }
  if (C.f1c0 & 2) warn('path_mover: C+0x1c0 bit 1 speed profile (FUN_00349e98) not translated');
  C.p328 = len; C.p32c = C.dur; C.p320 = 0; C.p31c = 0; C.t = 0;
  C.mover = 1;
  C.f1c4 = ((C.f1c4 & ~0x100) | 0x20) >>> 0;
  // FUN_0034f178 case 1
  C.f1c4 = (C.f1c4 | 0x10) >>> 0;
  segStart(a, p, C.node, warn);
  return true;
}

// FUN_00352a60, mover 1: C+0x1d0 = C+0x32c; mover 0; C+0x1c4 bit 5 clear / bit 8 set; move mode 0
// (C+0x1c8 0xc -> FUN_0034b110 instead: not a path walker's)
export function moverStop(a, warn = () => {}) {
  const C = a.C;
  if (C.mover >= 3 && C.mover <= 0xb) { approachStop(a); return; }          // cases 3-0xb (and the tail)
  if (C.mover === 0xd) { navStop(a); return; }                              // case 0xd (and the tail)
  if (C.mover === 1) C.dur = C.p32c;
  else if (C.mover) warn(`path_mover: stop of mover ${C.mover} (FUN_00352a60) not translated`);
  C.mover = 0;
  C.f1c4 = ((C.f1c4 & ~0x20) | 0x100) >>> 0;
  if (C.mm === 0xc) wantFace(a, 0); else C.mm = 0;                          // FUN_0034b110(0, C) in mode 0xc
}

// FUN_003533e0 (FUN_0055a828's stop): FUN_0034d870(C, 0) (move mode 0xc: FUN_0034bcc8(-1): C+0x1d0 = -1,
// FUN_0034b110(0); modes 0 / 9 (the default case): mode 0, C+0x1c4 bit 0 clear / bit 2 set), FUN_00352a60,
// mover 0. Other move modes: not translated (warned).
export function stopAll(a, warn = () => {}) {
  const C = a.C;
  if (C.mm === 0xc) { C.dur = -1.0; wantFace(a, 0); }
  else if (C.mm === 0 || C.mm === 9) { C.mm = 0; C.f1c4 = ((C.f1c4 & ~1) | 4) >>> 0; }
  else warn(`path_mover: FUN_0034d870 for move mode ${C.mm} not translated`);
  moverStop(a, warn);
  C.mover = 0;
}

// FUN_0034f4a0(C, p, i): the segment from node i to node i + 1
function segStart(a, p, i, warn) {
  const C = a.C, fl = p.flags;
  let straight;
  if (!((fl >> 1) & 1) || !((fl >> 2) & 1)) straight = ((fl >> 2) & 1) ^ 1;
  else straight = (nodeOf(p, i).flags & 1) !== 0 ? 1 : 0;
  if (!straight) {
    const n0 = nodeOf(p, i - 1), n1 = nodeOf(p, i), n2 = nodeOf(p, i + 1), n3 = nodeOf(p, i + 2);
    // FUN_0034aea8: C+0x100..0x13f = the four nodes' +0x50 (positions). FUN_0034aed0 / FUN_0034aef8 copy
    // their +0x40 / +0x30 rows to C+0x140.. / C+0x180..: move mode 9 doesn't read them (not exported).
    if (G64 > 8) C.cp = [n0.pos, n1.pos, n2.pos, n3.pos].map(v => v.map(f));
    C.p31c = f(n1.seg);
    moveMode(a, 9, warn);
  } else {
    // FUN_0034ad30 / FUN_0034ae00 + FUN_0034db80(C, 8): a straight segment (move mode 8, FUN_002611f4 and
    // the ground drop FUN_00356d98). No z128 path takes it (flags 4 / 6 with node flags 0).
    warn('path_mover: straight path segment (move mode 8) not translated: the soldier stops');
    C.p31c = f(nodeOf(p, i).seg);
    C.mm = 0;
  }
}

// FUN_0034db80(C, mode, 0)
function moveMode(a, mode, warn) {
  const C = a.C;
  // FUN_00326298(0xd) (script flag bit 13) only changes modes 10 / 11
  const old = C.f1c4;
  C.mm = mode;
  C.f1c4 = ((old & ~4) | 1) >>> 0;
  if (!(old & 0x10)) C.t = 0;
  if (!segSetup(a, warn)) { C.t = 0; segEnd(a, 0); }
  C.f1c0 = (C.f1c0 & ~0x800) >>> 0;
}

// FUN_0034bd10, move mode 9 (constant speed: C+0x1c0 bit 0)
function segSetup(a, warn) {
  const C = a.C;
  C.poly = [C.cp[1].slice()]; C.arcs = [0];
  const d = dist3(C.cp[1], C.cp[2]);
  C.seg = d;
  if (!(0.001 <= d)) return false;
  C.n204 = d < 3.0 ? Math.trunc(f(d * 10.0)) + 2 : 0x20;
  const arc = polyline(C);
  C.p31c = arc;                                                              // mode 9
  if (C.f1c0 & 2) warn('path_mover: C+0x1c0 bit 1 speed profile (FUN_0034a0c8) not translated');
  else if (C.f1c0 & 1) C.dur = f(arc / C.spd);
  else C.dur = f(C.p32c * f(C.p31c / C.p328));
  C.arcLen = arc; C.arc = 0; C.i200 = 0;
  return true;
}

// FUN_00353480: C+0x204 points of the spline from C+0x110 to C+0x120, cumulative lengths in C+0x3a4
function polyline(C) {
  let L = 0;
  const n = C.n204;
  for (let i = 1; i < n; i++) {
    const u = f(f(i) / f(n - 1));
    const P = comb(C.cp, splineBasis(u, C.tension));
    if (C.f1c0 & 0x80) P[1] = f(C.cp[1][1] + f(u * f(C.cp[2][1] - C.cp[1][1])));   // byte C+0x1c0 < 0
    C.poly[i] = P;
    L = f(L + dist3(P, C.poly[i - 1]));
    C.arcs[i] = L;
  }
  return L;
}

// FUN_0034d870(C, flag), move mode 9 (the default case): the segment is done -> mode 0, C+0x1c4 bit 0
// clear / bit 2 set (the mover's arrival bit). Returns 1.
function segEnd(a, _flag) {
  const C = a.C;
  C.mm = 0;
  C.f1c4 = ((C.f1c4 & ~1) | 4) >>> 0;
  return 1;
}

// FUN_0034fad0 (mover 1, per frame): on arrival the next node; 1 = the path is done
function moverTick(a, paths, warn) {
  const C = a.C;
  let done = 0;
  if (C.f1c4 & 4) {
    const p = pathOf(paths, C.path);
    C.node++;
    C.p320 = f(C.p320 + C.p31c);
    // the body listener C+0x540 gets event 3 (the new node index): an actor's FUN_005690c8 case 3 -> FUN_00588550 case 3
    // (manager event 0x10 -> script event 0x14, r0 = the node) and FUN_00563970(a, -1) (worker 0228: enemy_ai a.listen)
    if (a.listen) a.listen(3, C.node);
    if (C.node === C.last) done = 1;
    else if ((p.flags & 1) && p.n <= C.node) C.node = 0;
    if (!done) segStart(a, p, C.node, warn);
  }
  return done;
}

// FUN_0034c388, move mode 9 (C+0x1c0 bit 1 clear): position by time along the polyline, direction =
// the spline's slope there, ground speed = C+0x1d4 (bit 0) or chord / duration
function moveEval(a) {
  const C = a.C;
  C.speed = (C.f1c0 & 1) ? C.spd : f(C.seg / C.dur);
  C.arc = f(C.arcLen * f(C.t / C.dur));
  for (let i = C.i200; i < C.n204 && C.arcs[i] < C.arc; i++) C.i200 = i;
  const i = C.i200, a0 = C.arcs[i];
  let u = f(f(C.arc - a0) / f(C.arcs[i + 1] - a0));
  if (u < 0) u = 0; else if (u > 1.0) u = 1.0;
  const P = lerp4(C.poly[i], C.poly[i + 1], u);
  a.pos = [P[0], P[1], P[2]];
  // FUN_0025fdf0: slope at (i + u) / (n - 1); zero -> again 0.001 further along (or back)
  const U = f(f(i + u) / f(C.n204 - 1));
  let d = comb(C.cp, splineSlope(U, C.tension));
  if (f(f(f(d[0] * d[0]) + f(d[1] * d[1])) + f(d[2] * d[2])) === 0)
    d = comb(C.cp, splineSlope(U <= 0.001 ? f(U + 0.001) : f(U - 0.001), C.tension));
  C.dir = len3(d) === 0 ? a.face.slice(0, 3) : unit3(d);
}

// FUN_00323318: a per-tick blend factor over the frame's step (DAT_0046e290 +4)
export function stepFactor(w, step) {
  if (!(1.0 < step)) return f(w * step);
  let r = 1.0, i = 1;
  do { i++; r = f(r * f(1.0 - w)); } while (i <= step);
  return f(1.0 - r);
}

// FUN_0034de50, turn mode 5: with ground speed, the facing takes the move direction (blend factor
// FUN_00323318(C+0x2cc): 1.0, or 0.25 with C+0x1c0 bit 15), then FUN_0034a5a8(C, 1) keeps it upright
// (C+0x1c0 bit 8: face = (up x face) x up, up = (0, -1, 0))
// FUN_0034de50's end (0x34e7xx): C+0x224 = FUN_00260fe8(new, old row 2, (0, -1, 0)) x 60 / *(DAT_0046e290 + 4) (the step, 1.2 in
// the save RAM); |rate| <= 0.2 -> 0. FUN_00260fe8: the angle, negative when (old x new) . up < 0: a rising atan2(x, z) is negative.
export function turnRate(old, now, step) {
  const c = f(f(f(old[2] * now[0]) - f(old[0] * now[2])) * -1.0);             // (old x new) . (0, -1, 0)
  const d = f(f(f(old[0] * now[0]) + f(old[1] * now[1])) + f(old[2] * now[2])), ang = f(Math.acos(d < -1 ? -1 : d > 1 ? 1 : d));
  const r = f(f(f(c < 0 ? -ang : ang) * 60.0) / step);
  return Math.abs(r) <= 0.2 ? 0 : r;
}
function turnMode5(a, step, warn) {
  const C = a.C;
  if (C.speed === 0) return;
  C.t2c0 = [C.dir[0], C.dir[1], C.dir[2], (C.f1c0 & 0x8000) ? 0.25 : 1.0];
  let tg = C.t2c0;
  if (len3(tg) === 0) tg = [...a.face.slice(0, 3), C.t2c0[3]];
  const face = a.face;
  const dot = f(f(f(face[0] * tg[0]) + f(face[1] * tg[1])) + f(face[2] * tg[2]));
  if (C.f45c & 0x200000) warn('path_mover: C+0x45c bit 21 rate-limited turn not translated');
  const k = stepFactor(C.t2c0[3], step);
  if (!(-0.97 < dot)) {
    // row 0 (up x face; C+0x1c0 bit 6 picks its sign by the camera: not set on the soldiers)
    if (C.f1c0 & 0x40) warn('path_mover: C+0x1c0 bit 6 turn-around by the camera not translated');
    tg = [f(-face[2]), 0, f(face[0])];
  }
  let v = unit3([0, 1, 2].map(c => f(face[c] + f(f(tg[c] - face[c]) * k))));
  if (C.f1c0 & 0x100) v = unit3([v[0], 0, v[2]]);
  else warn('path_mover: FUN_0034a5a8 without C+0x1c0 bit 8 not translated');
  C.f224 = turnRate(face, v, step);                                           // C+0x224 (enemy_ai turnRate)
  a.face = v;
}

// ------------------------------------------------ mover 3: walk at an object (worker 0161)
// Action layer 3 (FUN_003667b0) starts it with FUN_00353110(20, 1000, C, target) + FUN_0034edf0(C, 3).
// The soldier walks the stage walk mesh as a physics body (move mode 0xc), so the body object
// a.B (C+0x3b0) is a walk-mesh body as player.js's: B.poly (body polygon), B.vel body+0x40, B.want
// body+0x30, B.flags body+0xac, B.acc / B.turn body+0xc4 / +0xc8.
//   C.tgt  +0x310 target (the object; the game keeps its id +0x4c << 16 | +0x20)
//   C.lo / C.hi  +0x314 / +0x318 distance window   C.want / C.wk  +0xc0 move direction / +0xcc per frame

// FUN_0034b110(k, C): C+0xc0 = the facing row C+0x20, C+0xcc = k (C+0xd0 = the last non-zero C+0xc0)
export function wantFace(a, k) {
  const C = a.C;
  C.want = [a.face[0], a.face[1], a.face[2]];
  C.wk = f(k);
}
// FUN_0034af98(k, C, d): C+0xc0 = d (no parent frame: C+0x54c vt+0x34 = 0 for the stage's soldiers),
// C+0xcc = k. FUN_0034b200(s, C, d) = FUN_0034af98(C+0x1d4 x s / 60, C, d); FUN_0034b230 = FUN_0034b110.
function wantDir(a, s, d) {
  const C = a.C;
  C.want = [d[0], d[1], d[2]];
  C.wk = f(f(f(C.spd * s) * 0.016666668));
}

// FUN_00353110(lo, hi, C, target) then FUN_0034edf0(C, 3) and its FUN_0034f178 case 3. place(B, pos) =
// FUN_00356d98(C+0x3b0, C+0x30, 1, 1, 0) (body at the position, FUN_00356740 finds its walk polygon).
export function approachStart(a, target, lo, hi, place, warn = () => {}) {
  const C = a.C;
  if (C.mover !== 0) moverStop(a, warn);                                    // FUN_00353110
  C.tgt = target || null;
  C.lo = f(lo); C.hi = f(hi); C.p320 = 1.0; C.p31c = 0;
  if (C.mover !== 0) moverStop(a, warn);                                    // FUN_0034edf0
  C.f1c4 = (C.f1c4 & ~0x80) >>> 0;
  if (!C.tgt) return false;                                                 // case 3: FUN_0053e068 finds nothing
  C.f1c0 = (C.f1c0 | 0x6000) >>> 0;
  C.mover = 3;
  C.f1c4 = ((C.f1c4 & ~0x100) | 0x20) >>> 0;
  if (C.mm !== 0xc) {                                                       // FUN_0034f178 case 3
    wantFace(a, 0);                                                         // FUN_0034b230(0, C)
    place(a);                                                               // FUN_00356d98(body, C+0x30, 1, 1, 0)
    setMode0xc(a);                                                          // FUN_0034db80(C, 0xc, 0)
  }
  C.f45c = (C.f45c | 0x300000) >>> 0;                                      // body+0xac: speed and turn limits
  return true;
}
// FUN_0034db80(C, 0xc, 0) (FUN_00326298(0xd) = script flag 13, set in z128): C+0x1c8 = 0xc, C+0x1c4 bit 2
// clear / bit 0 set, C+0x1cc = 0 unless C+0x1c4 bit 4, FUN_0034bd10 case 0xc (C+0x1d8 = 0, C+0xf0 = C+0xc0),
// C+0x1c0 bit 11 clear
function setMode0xc(a) {
  const C = a.C;
  C.mm = 0xc;
  C.f1c4 = ((C.f1c4 & ~4) | 1) >>> 0;
  if (!(C.f1c4 & 0x10)) C.t = 0;
  C.speed = 0;
  C.f1c0 = (C.f1c0 & ~0x800) >>> 0;
  C.f1c0 = ((C.f1c0 & 0xffe3fbff) | 0x200) >>> 0;                             // FUN_0034bd10 entering mode 0xc: bits 0x400, 0x40000, 0x80000, 0x100000 clear
}
// FUN_00352a60 cases 3-0xb: turn mode 8 -> 0, C+0x45c bits 19-21 clear; then mover 0, C+0x1c4 bit 5
// clear / bit 8 set, and in move mode 0xc FUN_0034b110(0, C) (else move mode 0)
export function approachStop(a) {
  const C = a.C;
  if (C.s214 === 8) C.s214 = 0;
  C.f45c = (C.f45c & 0xffc7ffff) >>> 0;
  C.mover = 0;
  C.f1c4 = ((C.f1c4 & ~0x20) | 0x100) >>> 0;
  if (C.mm === 0xc) wantFace(a, 0); else C.mm = 0;
}
// ------------------------------------------------ mover 8: the attack clip's root motion (worker 0166)
// Started by op 0 of an attack keyframe (enemy_ai attackCommands, FUN_003481e0 case 0); FUN_00343160 writes
// the root delta into C+0x310 each frame (enemy_ai rootSample), FUN_00351418 turns it into the body's wanted
// move. C.m310 = C+0x310 (4 rows, a union with the other movers' fields, kept apart here), C.r370 = C+0x370.
export const IDENT4 = () => [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
// FUN_0034edf0(C, 8) and FUN_0034f178 case 8. place = FUN_00356d98(C+0x3b0, C+0x30, 0, 0, 0) (placeBody)
export function rootStart(a, place, warn = () => {}) {
  const C = a.C;
  if (C.mover !== 0) moverStop(a, warn);                                    // FUN_00352a60
  C.f1c4 = (C.f1c4 & ~0x80) >>> 0;
  C.f1c0 = (C.f1c0 & ~0x4000) >>> 0;                                        // case 8
  C.f1c4 = (C.f1c4 | 0x80) >>> 0;
  C.mover = 8;
  C.f1c4 = ((C.f1c4 & ~0x100) | 0x20) >>> 0;
  if (C.mm !== 0xc) { wantFace(a, 0); place(a); setMode0xc(a); }            // FUN_0034f178 case 8
  C.m310 = IDENT4();                                                        // FUN_002613b8(C+0x310)
  C.r370 = 0;
}
// FUN_00351418 (mover 8, every frame; FUN_0034f8c0 case 8, never ends by itself): the delta's translation
// row through C's rotation (FUN_0026125c(out, C rows 0-2 with row 3 = vf0, C+0x310) = C+0x310 x C), times
// -1 / DAT_004eeb24 (the frame step), y 0; FUN_00356278(C+0x370, body); a horizontal length over 0.01 ->
// FUN_0034af98(len, C, unit) and C+0x370 = 0, else FUN_0034b110(0, C). C's rows: FUN_0055a168's
// (up x face, up, face) with up (0, -1, 0) (enemies.js; T: k_melee18 e0_cmat).
export function rootTick(a, step) {
  const C = a.C, D = C.m310 || IDENT4(), fc = a.face;
  const R = [[f(-fc[2]), 0, fc[0]], [0, -1, 0], [fc[0], fc[1], fc[2]]];
  const t = D[3];
  const w = [0, 1, 2].map(c => f(f(f(t[0] * R[0][c]) + f(t[1] * R[1][c])) + f(t[2] * R[2][c])));
  const k = f(-1.0 / step);
  const v = [f(w[0] * k), 0, f(w[2] * k)];
  const s = f(Math.sqrt(f(f(v[0] * v[0]) + f(v[2] * v[2]))));
  bodyRootY(a, C.r370);                                                     // FUN_00356278(C+0x370, C+0x3b0)
  if (0.01 < s) {
    C.want = [f(v[0] / s), 0, f(v[2] / s)];                                 // FUN_0034af98(s, C, v / |v|)
    C.wk = s;
    C.r370 = 0;
  } else wantFace(a, 0);
}
// FUN_00356248(B, n): n -> body+0xac |= 0x80; else +0xa0 = 0, +0xc0 = +4 (not modelled), bit 7 clear.
// FUN_00356278(y, B): +0xa0 = y, except with +0xac bits 18 and 8 both set, where only a y above +0xa4 is
// taken. body+0xac is C+0x45c (C.f45c); B.a0 = body+0xa0 (the vertical root offset). Its reader (the body's
// height under bit 7) is not translated: enemy_ai warns when a clip's root y is not 0 (z128's e027
// r_atk_0: 0 on every frame).
export function bodyRootOn(a, n) {
  const C = a.C, B = a.B;
  if (n) { C.f45c = ((C.f45c | 0) | 0x80) >>> 0; return; }
  if (B) B.a0 = 0;
  C.f45c = ((C.f45c | 0) & ~0x80) >>> 0;
}
export function bodyRootY(a, y) {
  const C = a.C, B = a.B, ac = C.f45c | 0;
  if (!B) return;
  if (!((ac >> 18) & 1) || !((ac >> 8) & 1)) B.a0 = y;
  else if (B.a4 != null && B.a4 < y) B.a0 = y;     // +0xa4 is not modelled (bits 18 / 8: clear on z128's soldiers)
}

// FUN_003504b0 (mover 3, every frame). tpos = FUN_0054a720(target) (its position C+0x30); the body's
// own point = C+0x54c vt+0x1c = C+0x30. Horizontal distance d to the target; speed scale 1 beyond lo + 25,
// 0.3 + (x - 20) 0.14 between lo + 20 and lo + 25, else 0.3 (x = d - lo); FUN_0034b200(scale, C, dir).
// Returns 1 (the mover ends) when the target is gone or d leaves [lo, hi]. With C+0x1c0 bit 9 clear
// (airborne) it waits for body state 6 (FUN_00357850: not a state the page's bodies take) and does nothing.
function approachTick(a, tpos) {
  const C = a.C;
  if (!tpos) return 1;
  if (!(C.f1c0 & 0x200) && a.B.state !== 6) return 0;
  const v = [f(tpos[0] - a.pos[0]), 0, f(tpos[2] - a.pos[2])];
  const d = len3(v);
  const dir = unit3(v);
  let s = f(d - C.lo);
  if (25.0 < s) s = 1.0;
  else if (20.0 < s) s = f(f(f(s - 20.0) * 0.14) + 0.3);
  else s = 0.3;
  wantDir(a, s, dir);
  return (C.lo <= d && d <= C.hi) ? 0 : 1;
}
export const approachTest = approachTick;

// FUN_00261038: the angle between a and b (acos of the cosine; 0 at >= 1, pi at <= -1)
function angle(a, b) {
  const aa = f(f(f(a[0] * a[0]) + f(a[1] * a[1])) + f(a[2] * a[2]));
  const bb = f(f(f(b[0] * b[0]) + f(b[1] * b[1])) + f(b[2] * b[2]));
  const ab = f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
  // VRSQRT: Q = ab / sqrt(aa bb); by zero the VU gives +-max float with the numerator's sign (no NaN), so a zero
  // vector with a -0 dot product is pi apart (T: k_lunge166 #66 f1510-1512, the velocity x (1 - 0.2513 / pi)
  // toward the wanted -0 vector after the attack under body bit 21)
  const den = f(Math.sqrt(f(aa * bb)));
  const c = den === 0 ? ((ab < 0 || Object.is(ab, -0)) ? -3.4028235e38 : 3.4028235e38) : f(ab / den);
  if (!(c < 1.0)) return 0;
  if (!(-1.0 < c)) return f(Math.PI);
  return f(Math.acos(c));
}
// FUN_0025a560(t, out, a, b): a turned toward b by t x their angle about a x b (FUN_00259f60 axis-angle,
// FUN_0026138c), length lerped |a| -> |b|; under 0.0001 rad the lerp FUN_002611f4 of the unit vectors
function slerp(t, a, b) {
  const la = len3(a), lb = len3(b);
  const L = f(f(f(lb - la) * t) + la);
  const ua = unit3(a), ub = unit3(b);
  const th = angle(ua, ub);
  let r;
  if (th < 0.0001) r = lerp4([...ua, 0], [...ub, 0], t).slice(0, 3);
  else {
    // > 3.1414928: axis (0, -1, 0) (the up axis); else ua x ub (vopmula / vopmsub)
    let k = th > 3.1414928 ? [0, -1, 0]
      : unit3([f(f(ua[1] * ub[2]) - f(ua[2] * ub[1])), f(f(ua[2] * ub[0]) - f(ua[0] * ub[2])), f(f(ua[0] * ub[1]) - f(ua[1] * ub[0]))]);
    const g = f(th * t), cs = Math.cos(g), sn = Math.sin(g);
    const kd = k[0] * ua[0] + k[1] * ua[1] + k[2] * ua[2];
    const kx = [k[1] * ua[2] - k[2] * ua[1], k[2] * ua[0] - k[0] * ua[2], k[0] * ua[1] - k[1] * ua[0]];
    // GUESS (rounding only): Rodrigues in doubles for FUN_00259f60's matrix (its float order not traced)
    r = [0, 1, 2].map(c => f(ua[c] * cs + kx[c] * sn + k[c] * kd * (1 - cs)));
  }
  return unit3(r).map(c => f(c * L));
}
// FUN_003590c8's velocity update for flags bit 5 (body states 0 / 2): bit 19 -> the velocity vector moves
// toward the wanted one by at most body+0xc4 x DAT_004eeb28 per frame; else bit 20 -> the speed changes by
// at most that (direction = the wanted one); neither -> the wanted velocity at once. Then bit 21 ->
// the direction turns by at most body+0xc8 x DAT_004eeb28 from the last velocity (FUN_0025a560 when
// both are non-zero, else FUN_002611f4). dt = DAT_004eeb28.
export function limitVel(B, flags, want, dt) {
  let n = want.slice(0, 3);
  if ((flags >> 19) & 1) {
    // bit 19: the velocity moves toward the wanted one by at most body+0xc4 x dt (as a vector)
    const lim = f(B.acc * dt);
    const dv = [f(want[0] - B.vel[0]), f(want[1] - B.vel[1]), f(want[2] - B.vel[2])];
    if (lim < len3(dv)) { const u = unit3(dv); n = [0, 1, 2].map(c => f(B.vel[c] + f(u[c] * lim))); }
  } else if ((flags >> 20) & 1) {
    const lim = f(B.acc * dt);
    const lv = len3(B.vel), dl = f(len3(want) - lv);
    if (lim < Math.abs(dl)) {
      const u = unit3(want);
      const L = 0.0 < dl ? f(lv + lim) : f(lv - lim);
      n = u.map(c => f(c * L));
    }
  }
  if ((flags >> 21) & 1) {
    const lim = f(B.turn * dt);
    const th = angle(n, B.vel);
    if (lim < th) {
      const t = f(lim / th);
      const sv = f(f(f(B.vel[0] * B.vel[0]) + f(B.vel[1] * B.vel[1])) + f(B.vel[2] * B.vel[2]));
      const sn = f(f(f(n[0] * n[0]) + f(n[1] * n[1])) + f(n[2] * n[2]));
      n = (0.0 < sv && 0.0 < sn) ? slerp(t, B.vel, n) : lerp4([...B.vel, 0], [...n, 0], t).slice(0, 3);
    }
  }
  B.vel = n;
  return n;
}

// FUN_0034c388, move mode 0xc, for a soldier (C+0x1c0 bit 22 clear): body+0x30 = C+0xc0 x C+0xcc
// (FUN_00358fb8; y = 0 when airborne), the body step FUN_003590c8 (walk(B, move) = its walk-mesh part:
// collision.js navMove from B.poly by move = body+0x40 x step, returns the new position), C+0x30 = the body's
// position. C+0x1c0 bit 13 (set by mover 3): C+0x1d8 = the measured speed (0 below 0.001 u; 0.1 when under
// 0.1 u and not moving back against the wanted direction, or with no push), else C+0xcc x 60. Bit 14 (set):
// C+0x90 = the measured direction when it moved more than 0.05 u and within 80 deg of C+0xc0 (or with no
// push), else C+0xc0 with C+0x1d8 = 0; under 0.05 u C+0x90 stays. Bit 9 = on the ground.
function mode0xc(a, step, walk, warn) {
  const C = a.C, B = a.B;
  if (C.f1c0 & 0x400000) warn('path_mover: move mode 0xc with C+0x1c0 bit 22 not translated');
  const k = C.wk;
  const w = [f(C.want[0] * k), B.state === 2 ? 0 : f(C.want[1] * k), f(C.want[2] * k)];
  B.want = w;
  const old = a.pos.slice();
  if (B.state !== 0 && B.state !== 2) warn(`path_mover: soldier body state ${B.state} (FUN_003590c8) not translated`);
  else if (C.f45c & 0x20) limitVel(B, C.f45c, w, B.dt);
  else warn('path_mover: body flags without bit 5 (FUN_003590c8 acceleration) not translated');
  if (B.state === 2) gravityStep(B);                                        // FUN_003579a8
  const p = walk(a, [f(B.vel[0] * step), f(B.vel[1] * step), f(B.vel[2] * step)]);
  a.pos = p;
  const dv = [f(p[0] - old[0]), f(p[1] - old[1]), f(p[2] - old[2])];
  const dl = len3(dv);
  const noPush = !(C.c430 && len3(C.c430) !== 0);
  if (!(C.f1c0 & 0x2000)) C.speed = f(C.wk * 60.0);
  else if (0.001 <= dl) {
    if (0.1 < dl) C.speed = f(f(dl * 60.0) / step);
    else {
      const dt = f(f(f(C.want[0] * dv[0]) + f(C.want[1] * dv[1])) + f(C.want[2] * dv[2]));
      C.speed = (0.0 <= dt || noPush) ? f(0.1) : 0;
    }
  } else C.speed = 0;
  if (!(C.f1c0 & 0x4000)) C.dir = unit3(C.want);
  else if (0.05 < dl) {
    // FUN_00259d18: the signed angle C+0xc0 -> move (wrapped to [-pi, pi])
    const h = Math.atan2(dv[0], dv[2]) - Math.atan2(C.want[0], C.want[2]);
    let g = f(h);
    while (g < -Math.PI) g = f(g + 6.2831855);
    while (Math.PI < g) g = f(g - 6.2831855);
    if (Math.abs(g) < 1.3962635 || noPush) C.dir = unit3(dv);
    else { C.dir = unit3(C.want); C.speed = 0; }
  }
  if (B.state === 2) C.f1c0 = (C.f1c0 & ~0x200) >>> 0; else C.f1c0 = (C.f1c0 | 0x200) >>> 0;
}

// FUN_00357168(h, body): the take-off (attack op 8 through FUN_0034a8e0; player.js startFall, the same function). t 0, +0xd8 = y,
// +0xdc = 0; h > 0: v0 = -sqrt(2 g h), rise = |v0 / g| (DAT_0046f4a4 = 0 in the save RAM); else 0. Then FUN_00357860(body, 2). g = body+0xd0.
export function bodyTakeoff(a, h) {
  const B = a.B, g = B.g ?? BODY_G;
  B.t = 0; B.y0 = a.pos[1]; B.dy = 0; B.gy = a.pos[1];
  if (h <= 0) { B.rise = 0; B.v0 = 0; }
  else { B.v0 = f(-Math.sqrt(f(f(2 * g) * h))); B.rise = f(Math.abs(f(B.v0 / g))); }
  B.state = 2;
}
// FUN_003579a8 (FUN_00326500 true: player.js gravityStep): rising v0 t + g t^2 / 2; past the apex the rise plus 0.8 g (DAT_0046f4a0)
// from the apex; + 0.01, t += dt. The new height is body+0xd8 + body+0xdc.
export function gravityStep(B) {
  const g = B.g ?? BODY_G, t = B.t;
  let dy;
  if (t < B.rise) dy = f(f(B.v0 * t) + f(f(f(g * t) * 0.5) * t));
  else { const r = B.rise, u = f(t - r); dy = f(f(f(B.v0 * r) + f(f(f(g * r) * 0.5) * r)) + f(f(f(f(g * 0.8) * 0.5) * u) * u)); }
  B.dy = f(dy + 0.01);
  B.t = f(t + B.dt);
}
const BODY_G = 235.2;                                                         // C+0xb4 / body+0xd0, T: r03_dogawake dog 65 (cfg+0xcc 1.2 x 196)
// FUN_0034db80(C, 0xc, 0) from op 8 / op 9, after FUN_0034b110(0, C)
export function enterMode0xc(a) { if (a.C.mm !== 0xc) { wantFace(a, 0); setMode0xc(a); } }

// FUN_0034c388's start (0x34c3e4..0x34c408; the move, after the mover tick, which reads them: path_mover stuckTest): C+0x1c0 bits 0x400, 0x40000, 0x80000, 0x100000 clear
export function moveStart(C) { C.f1c0 = (C.f1c0 & 0xffe3fbff) >>> 0; }

// FUN_0034ea18 for a soldier in move mode 0xc: the mover (FUN_0034f8c0 -> FUN_003504b0 for mover 3; at its end
// FUN_00352a60), the move (mode 0xc), then the turn (FUN_0034de50: turn mode 5). tpos = the target's position
// or null; walk = the walk-mesh step. sliding = a slide mover (9 / 0xb) runs: in the game its FUN_0034f178
// case only enters mode 0xc too, but the page keeps the slides' flat step (enemy_ai slide GUESS), so the
// mode-0xc body step is skipped then, except in the air (body state 2: the slide has no flat step there, enemy_ai moverUpdate). Returns 'done' on the frame mover 3 ends (no listener event for it).
export function approachFrame(a, tpos, step, walk, warn = () => {}, sliding = false, nav = null) {
  const C = a.C;
  if (C.f1c0 & 0x20) return null;
  if (!(step > 0)) return null;
  let ev = null;
  if (C.mover === 3 && approachTick(a, tpos)) { approachStop(a); ev = 'done'; }
  else if (C.mover === 0xd) {
    // FUN_0034f8c0 case 0xd: FUN_00351928; on a non-zero return FUN_00352a60, then the listener's event 4
    // with list[C+0x310 - 1] (read after the stop set list[0] = -1)
    if (!nav) warn('path_mover: mover 0xd without the nav graph');
    else if (navTick(a, nav)) {
      navStop(a, nav);
      const n = C.nlen - 1;
      if (nav.event) nav.event(4, n >= 0 && n < C.list.length ? C.list[n] : -1);
      ev = 'nav end';
    }
  } else if (C.mover === 8) rootTick(a, step);                              // FUN_0034f8c0 case 8: FUN_00351418
  moveStart(C);
  if (C.mm === 0xc && (!sliding || a.B.state === 2)) mode0xc(a, step, walk, warn);
  if (C.s214 === 5) turnMode5(a, step, warn);
  return ev;
}

// ------------------------------------------------ mover 0xd: follow a nav-graph path (worker 0163)
// FUN_0055a628 / FUN_0055a590 copy a search request into C+0x330 (FUN_00353080 / FUN_00352f18) and start the
// mover with FUN_0034edf0(C, 0xd); every frame FUN_00351928 runs the search, then walks the node list as a
// mode-0xc body (steering only: C+0xc0 / C+0xcc through FUN_0034b200, the body step is mode0xc's).
// nav = { G (nav_graph makeGraph), svc (makeService), rng, warn, event(ev, node) = the body listener C+0x540
// (FUN_005690c8 cases 4 / 5) }. Fields (C+0x310.. is a union with mover 1's path fields, kept apart here):
//   C.nreq  +0x330 request   C.list *(C+0x3a8) node list, -1 ended   C.nlen +0x310 list length   C.nidx +0x312
//   C.nst  +0x314 follow state   C.qslot +0x315 low nibble (queue slot, 0xf none)   C.climb +0x315 high nibble
//   C.n316 +0x316 the actor's node as last checked   C.n318 +0x318 stuck clock   C.stuck +0x320 stuck point
//   C.n398 +0x398 the actor's node (FUN_00563a50)
const npos = (G, n) => { const q = NG.node(G, n); return q ? [q[0], q[1], q[2], 1.0] : null; };   // FUN_00310f50 + vitof12 x 16
const sub4 = (a, b) => [f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2]), 0];
const sq3 = v => f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]));                             // VADDy + VADDz
const sqxz = v => f(f(v[0] * v[0]) + f(v[2] * v[2]));                                               // VMUL.xz + VADDz
// FUN_0033f650(a, b): a == b, or the link a -> b exists with flags & 0x11 clear
function linkOpen(G, a, b) {
  if (a === b) return true;
  const l = NG.linkTo(G, a, b);
  return !!l && (l[2] & 0x11) === 0;
}
// FUN_0033f6a0(a, b): a node x linked from a (link flags 1 / 2 clear), x != b, whose link to b has flags 1 / 2 clear
function detour(G, a, b) {
  const q = NG.node(G, a);
  if (!q || !NG.node(G, b)) return -1;
  for (let k = 0; k < q[3]; k++) {
    const x = NG.neighbour(G, a, k);
    if (!NG.node(G, x) || x === b) continue;
    const l = G.links[q[4] + k];
    if ((l[2] & 2) || (l[2] & 1)) continue;
    const r = NG.node(G, x);
    for (let m = 0; m < r[3]; m++) {
      if (NG.neighbour(G, x, m) !== b) continue;
      const fl = G.links[r[4] + m][2];
      if (!(fl & 2) && !(fl & 1)) return x;
    }
  }
  return -1;
}
// FUN_0033f850(link, a, b): the link is closed (flags 1), or marked (flags 2) with a way round through detour
function blocked(G, l, a, b) {
  if (l[2] & 1) return true;
  if (!(l[2] & 2)) return false;
  if (!NG.node(G, a) || !NG.node(G, b)) return false;
  return detour(G, a, b) !== -1;
}
// FUN_002614f4(out, p, a, d): the point a - d x q, q = ((a - p) . d) / (d . d) (VDIV), returns -q (VSUBq vf0.x - Q)
function project(p, a, d) {
  const v = sub4(a, p);
  const q = f(f(f(f(v[0] * d[0]) + f(v[1] * d[1])) + f(v[2] * d[2])) / sq3(d));
  return [[f(a[0] - f(d[0] * q)), f(a[1] - f(d[1] * q)), f(a[2] - f(d[2] * q)), 1.0], f(-q)];
}
const limitsFrom1c0 = C => {                    // C+0x1c0 bits 24 / 25 / 26 -> body flags C+0x45c bits 19 / 20 / 21
  if (C.f1c0 & 0x1000000) C.f45c = (C.f45c | 0x80000) >>> 0;
  if (C.f1c0 & 0x2000000) C.f45c = (C.f45c | 0x100000) >>> 0;
  if (C.f1c0 & 0x4000000) C.f45c = (C.f45c | 0x200000) >>> 0;
};
function navClear(C) {                          // the follow fields FUN_00353080 / FUN_00352f18 reset
  C.nidx = 0; C.nlen = 0; C.nst = 0; C.climb = 0;
  if (!C.list) C.list = [];
  C.list[0] = -1;
}
// FUN_00353080(C) + FUN_0055a628's copy: the mover stopped, C+0x330 = req with start = the actor's node
export function navRequest(a, req, start, warn = () => {}) {
  const C = a.C;
  if (C.mover !== 0) moverStop(a, warn);
  C.nreq = { ...req, start };                    // FUN_00369040 first, then the whole 16 bytes are copied
  navClear(C);
  C.n316 = -1;
}
// FUN_00352f18(C, start, goal) (FUN_0055a590's request): mode 0 to the goal, flags 6 | f40 (FUN_0035ef18's
// 0x60 / 0x40 through C+0x54c), +4 = 2, cap 0x80, c = 0 (FUN_00369040)
export function navRequestTo(a, start, goal, f40, warn = () => {}) {
  const C = a.C;
  if (C.mover !== 0) moverStop(a, warn);
  C.nreq = { start, goal, s4: 2, max: 0x80, mode: 0, flags: 6 | f40, c: 0 };
  navClear(C);
}
// FUN_0034edf0(C, 0xd) and FUN_0034f178 case 0xd. place = FUN_00356d98(C+0x3b0, C+0x30, 0, 0, 0) (the page's
// placeBody: the body's polygon; its two flags (1, 1 for mover 3) are not modelled). False without a graph.
export function navStart(a, nav, place) {
  const C = a.C;
  if (C.mover !== 0) moverStop(a, nav.warn);
  C.f1c4 = (C.f1c4 & ~0x80) >>> 0;
  if (!nav.G) return false;
  C.nav = nav;
  if (!C.list) C.list = [];
  C.list[0] = -1; C.n318 = 0; C.t = 0; C.qslot = 0xf; C.nlen = 0;
  C.f1c0 = (C.f1c0 | 0x6000) >>> 0;
  C.climb = 0; C.n316 = -1;
  C.mover = 0xd;
  C.f1c4 = ((C.f1c4 & ~0x100) | 0x20) >>> 0;
  C.nst = 0;                                                                // FUN_0034f178 case 0xd
  if (C.mm !== 0xc) { wantFace(a, 0); place(a); setMode0xc(a); }
  limitsFrom1c0(C);
  return true;
}
// FUN_00352a60 case 0xd (and the tail): each list node's +0x1d count back down, a queued search still
// running is dropped (FUN_00368398), list[0] = -1, the body limits from C+0x1c0 bits 24-26 set again
export function navStop(a) {
  const C = a.C, nav = C.nav || null, G = nav ? nav.G : null;
  const L = C.list || [-1];
  if (G && L[0] !== -1) {
    for (let i = 0; ;) {
      const n = L[i];
      i++;
      if (NG.node(G, n)) G.occ1d[n] = (G.occ1d[n] - 1) & 0xff;
      if (0xff < i || L[i] === -1 || L[i] === undefined) break;
    }
  }
  if (C.qslot !== 0xf && L[0] === -1) {
    if (nav) NG.cancel(nav.svc, C.qslot);
    C.qslot = 0xf;
  }
  L[0] = -1; C.list = L;
  limitsFrom1c0(C);
  C.mover = 0;
  C.f1c4 = ((C.f1c4 & ~0x20) | 0x100) >>> 0;
  if (C.mm === 0xc) wantFace(a, 0); else C.mm = 0;
}
// FUN_003528d8(C, link): with C+0x1c0 bit 18 (the walk's contact bit, FUN_00357d48), a clock C+0x318 from a
// point C+0x320; past 60 frames still within 1.5 u (3D) of it -> the link gets flags 2 (FUN_0033e660: +100,
// FUN_0033f850) and the mover ends; else the clock restarts. Without bit 18 the clock is 0.
function stuckTest(a, link) {
  const C = a.C;
  if (!(C.f1c0 & 0x40000)) { C.n318 = 0; return 0; }
  if (C.n318 === 0) C.stuck = [a.pos[0], a.pos[1], a.pos[2], 1.0];
  C.n318 = (C.n318 + 1) << 16 >> 16;
  if (0x3c < C.n318) {
    if (f(Math.sqrt(sq3(sub4(C.stuck, a.pos)))) < 1.5) {
      wantFace(a, 0);
      if (link) link[2] |= 2;
      return 1;
    }
    C.n318 = 0;
  }
  return 0;
}
// FUN_00352788(C, p, q): a vertical link (flags 0x10) on the ground. While the count C+0x315 >> 4 is under 2:
// FUN_0034a8e0(dy + DAT_0046f484 when p is below q's height (dy = p.y - q.y > 0), else DAT_0046f484) = a
// jump, the parent's FUN_0056ab30(.., 1), count + 1; then the mover ends (FUN_0034b230(0), 1).
// MISSING: the jump FUN_0034a8e0 and FUN_0056ab30 are not translated (warned): the count still runs, so a
// soldier on a vertical link stands two frames and his path ends, as when the game's jump fails twice.
function climb(a, p, q, nav) {
  const C = a.C;
  if (((C.climb << 28) >> 28) < 2) {
    nav.warn('path_mover: mover 0xd vertical link: the jump (FUN_00352788 -> FUN_0034a8e0) not translated');
    C.climb = (C.climb + 1) & 0xf;
    return 0;
  }
  wantFace(a, 0);
  return 1;
}
// FUN_00353700: each list node's +0x1d count up (paths holding it)
function holdNodes(G, L) {
  if (L[0] === -1) return;
  for (let i = 0; ;) {
    const n = L[i];
    i++;
    if (NG.node(G, n)) G.occ1d[n] = (G.occ1d[n] + 1) & 0xff;
    if (0xff < i || L[i] === -1 || L[i] === undefined) return;
  }
}
// FUN_00351928 (mover 0xd, every frame). Returns 1 when the mover ends.
export function navTick(a, nav) {
  const C = a.C, G = nav.G;
  let ret = 0;
  // FUN_003577c8: body states 2 / 3 / 6 / 7 use the body's own position (body+0x10); the page's soldier
  // bodies take state 0 only (mode0xc warns otherwise), so C+0x30
  if ([2, 3, 6, 7].includes(a.B && a.B.state)) nav.warn('path_mover: mover 0xd in body state 2/3/6/7 (body+0x10 position) not translated');
  const p = [a.pos[0], a.pos[1], a.pos[2], 1.0];
  const s = (C.f1c0 & 0x10) ? f(0.3) : 1.0;
  const toward = q => wantDir(a, s, unit3(sub4(q, p)));                     // FUN_0034b200(s, C, unit(q - p))
  const L = () => C.list;
  switch (C.nst) {
    case 0:
      if (!(C.nreq.flags & 1)) {
        const k = NG.enqueue(nav.svc, G, C.nreq, C, nav.rng, nav.warn);      // FUN_00368250
        if (k === -1) return 0;
        C.qslot = k & 0xf; C.nst = 1;
        return 0;
      }
      {
        const l = NG.search(G, C.nreq, nav.rng, nav.warn, nav.svc);         // FUN_003682e8
        if (!l) return 0;
        C.list = l;
      }
      C.qslot = 0xf; C.nst = 2;
      break;
    case 1:
      if (L()[0] === -1) return 0;
      C.nst = 2;
      break;
    case 2: break;
    case 3: return navLeg0(a, nav, p, s, toward);
    case 4: return navLeg(a, nav, p, s, toward);
    case 5: return navLast(a, nav, p, s, toward);
    default: return 0;
  }
  // the list's length (< 0xff), list[0xff] = -1, state 3, FUN_00353700
  const l = L();
  C.nlen = 0;
  if (l[0] !== -1) { let n = 0; do { n++; } while (!(l[n] === -1 || l[n] === undefined || 0xfe < n)); C.nlen = n; }
  if (l.length > 0xff) l[0xff] = -1;
  C.nst = 3; C.nidx = 0; C.n318 = 0; C.qslot = 0xf; C.climb = 0; C.n316 = -1;
  holdNodes(G, l);
  return navLeg0(a, nav, p, s, toward);
}
// state 3: one node -> walk at it (state 5, index 1); else at the midpoint of nodes 0 / 1 (state 4), and the
// mover ends at once when the first link is blocked (FUN_0033f850)
function navLeg0(a, nav, p, s, toward) {
  const C = a.C, G = nav.G, l = C.list;
  if (C.nlen < 2) {
    const A = npos(G, l[0]);
    if (!A) { wantFace(a, 0); return 1; }
    toward(A);
    C.nidx = 1; C.nst = 5;
    return 0;
  }
  const A = npos(G, l[0]), B = npos(G, l[1]);
  if (!A || !B) { wantFace(a, 0); return 1; }
  toward(lerp4(A, B, 0.5));                                                  // FUN_002611f4(0.5)
  let r = 0;
  const lk = NG.linkTo(G, l[0], l[1]);
  if (lk && blocked(G, lk, l[0], l[1])) { r = 1; wantFace(a, 0); }
  C.nidx = 0; C.nst = 4;
  return r;
}
// state 4: on the leg list[i] -> list[i + 1]
function navLeg(a, nav, p, s, toward) {
  const C = a.C, G = nav.G, l = C.list, i = C.nidx;
  const A = npos(G, l[i]), B = npos(G, l[i + 1]);
  const N = C.nlen - 2 <= i ? B : npos(G, l[i + 2]);
  if (!A || !B || !N) { nav.warn('path_mover: mover 0xd: a list node is not in the graph'); wantFace(a, 0); return 1; }
  const lk = NG.linkTo(G, l[i], l[i + 1]);                                   // FUN_0033f608
  let r = 0;
  if (C.f1c0 & 0x200) {
    if (!lk || !(lk[2] & 0x10) || (C.f1c0 & 0x400000)) r = stuckTest(a, lk) ? 1 : 0;
    else r = climb(a, p, B, nav);
  }
  if (r) return r;
  // the actor's node C+0x398 must be one of the leg's nodes or linked open to one (else the mover ends)
  if (C.n316 !== C.n398) {
    if (linkOpen(G, C.n398, l[i]) || linkOpen(G, C.n398, l[i + 1])) C.n316 = C.n398;
    else { wantFace(a, 0); return 1; }
  }
  const last = C.nlen - 2 <= i;
  const vA = sub4(A, p), vB = sub4(B, p), vN = sub4(N, p);
  let near = false;
  const dB = f(Math.sqrt(sq3(vB)));
  const free = !(C.f1c0 & 0x40000) || C.speed !== 0;
  let tg;
  if (angle(vA, vB) < 0.7853982) tg = free ? lerp4(A, B, 0.5) : B;          // FUN_00261038: A and B seen in one direction
  else if (!free) tg = B;
  else {
    const dA = f(Math.sqrt(sq3(vA)));
    const fr = f(dA / f(dA + dB));                                           // how far along A -> B
    if (fr < 0.5) tg = lerp4(A, B, f(fr + 0.5));
    else if (fr < 1.0) tg = lerp4(B, N, f(fr - 0.5));
    else tg = N.slice();
    if (0.5 < fr) {
      if (1.0 <= f(Math.sqrt(sqxz(sub4(tg, p))))) {
        const [e, t] = project(p, B, vB);                                    // FUN_002614f4
        if (t < 0.0 && f(Math.sqrt(sqxz(sub4(e, p)))) < 1.0) near = true;
      } else near = true;
    }
  }
  toward(tg);
  // next node: within 5 u of B (x / z), or past the corner (N nearer than A, and B nearer than A), or near
  if (25.0 <= sqxz(vB) && !near) {
    if (last) return 0;
    if (sqxz(vA) <= sqxz(vN)) return 0;
    if (sqxz(vA) <= sqxz(vB)) return 0;
  }
  if (!(Math.abs(vB[1]) < 10.0)) return 0;
  if (nav.event) nav.event(5, l[i]);                                         // listener event 5 (node)
  if (lk && (lk[2] & 2)) lk[2] &= 0xfd;
  const j = C.nidx = i + 1;
  const l2 = NG.linkTo(G, l[j], l[j + 1]);
  if (l2) { r = blocked(G, l2, l[j], l[j + 1]) ? 1 : 0; if (r) wantFace(a, 0); }
  if (j < C.nlen - 1) {
    // FUN_002611f4(0.5, out, B, list[j]) with list[j] = B: the midpoint is B itself
    toward(lerp4(B, npos(G, l[j]), 0.5));
    C.nst = 4;
  } else {
    toward(B);
    C.nst = 5;
  }
  C.climb = 0; C.n316 = -1;
  return r;
}
// state 5: at the last node: within 3 u (x / z) and 10 u of height -> done
function navLast(a, nav, p, s, toward) {
  const C = a.C, G = nav.G, l = C.list, n = C.nlen;
  const P = n >= 1 ? npos(G, l[n - 1]) : null;
  if (1 < n && C.n316 !== C.n398) {
    if (linkOpen(G, C.n398, l[n - 2]) || linkOpen(G, C.n398, l[n - 1])) C.n316 = C.n398;
    else { wantFace(a, 0); return 1; }
  }
  if (!P) { wantFace(a, 0); return 1; }
  if (9.0 < sqxz(sub4(p, P)) || 10.0 <= Math.abs(f(p[1] - P[1]))) toward(P);
  else { wantFace(a, 0); return 1; }
  if (1 < n) {
    const lk = NG.linkTo(G, l[n - 2], l[n - 1]);
    if (!lk) return 0;
    if (!(C.f1c0 & 0x200)) return 0;
    if ((lk[2] & 0x10) && !(C.f1c0 & 0x400000)) return climb(a, p, P, nav);
    return stuckTest(a, lk) ? 1 : 0;
  }
  if (!NG.node(G, C.n398)) return 0;
  if (l[n - 1] === C.n398) return 1;
  const lk = NG.linkTo(G, C.n398, l[n - 1]);
  return lk ? (lk[2] & 1) : 1;
}
// FUN_0034aa28: the path's last node (mover 2 / 0xd, a list, state > 1), else -1
export function navGoal(C) {
  if (C.mover !== 2 && C.mover !== 0xd) return -1;
  if (!C.list || C.list[0] === -1 || !(1 < C.nst)) return -1;
  return C.list[C.nlen - 1];
}

// the turn alone (tests: hand-built facing / direction / ground speed)
export const turnTest = (a, step, warn = () => {}) => turnMode5(a, step, warn);

// FUN_0034ea18 for a path walker: mover, move, clock, segment end, turn. step = the frame's step
// (DAT_0046e290 +4, 1.2), dt = DAT_0046e290 +0xc. Returns 'done' on the frame the path ends.
export function bodyFrame(a, paths, step, dt = MOVE_DT, warn = () => {}) {
  const C = a.C;
  if (C.f1c0 & 0x20) return null;
  if (!(step > 0)) return null;
  let ev = null;
  if (C.mover === 1) {
    if (moverTick(a, paths, warn)) {
      // FUN_0034f8c0: FUN_00352a60, then the listener's events 2 and 0, C+0x1c4 bit 6. Event 2 = the path end
      // (enemy_ai moverUpdate). Event 0 (FUN_005690c8 case 0): its ground drop FUN_00356d98 runs only with
      // C+0x300 == 1 or motion class 0x42; the mover is already 0 here and the class is 8, so it doesn't.
      // Not read: its FUN_00588550 case 0 and FUN_00563970 (actor +0x108 != -1).
      moverStop(a, warn);
      C.f1c4 = (C.f1c4 | 0x40) >>> 0;
      ev = 'done';
    }
  }
  if (C.mm === 0) {
    C.speed = 0;
  } else {
    moveEval(a);
    C.t = f(C.t + dt);
    if (!(C.t < C.dur) && !(C.dur < 0.0)) {
      if (segEnd(a, 1) && C.mm === 0) C.t = f(C.t - C.dur);
    }
  }
  // MISSING: FUN_0034ea18 sends the body listener event 1 on each frame of a turn (FUN_005690c8 case 1 ->
  // FUN_00588550, jump table 0x591ef0 case 1: not read; nothing on the page depends on it).
  if (C.s214 === 5) turnMode5(a, step, warn);
  return ev;
}
