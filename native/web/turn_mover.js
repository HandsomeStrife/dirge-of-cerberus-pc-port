// turn_mover.js -- the body's turn mode 1 (a timed turn to a direction), as the z128 boss turns after its attacks
// (boss overlay FUN_00aa0d50(0.5, C, dir)); worker 0231, notes/boss-research.md "Turns". No three.js.
// The page keeps a body's orientation as its facing row (a.face = C+0x20) on an upright body, so the game's
// quaternion slerp (FUN_00262ff0) between the start and target matrices is a turn about the up axis by the same
// fraction of the angle. Mode 6 (face C+0x2b0) is enemy_ai.js turnBody; mode 5 is path_mover.js.

const f = Math.fround;
const unit = v => { const n = Math.hypot(v[0], v[1], v[2]); return n > 0 ? v.map(x => f(x / n)) : [0, 0, 0]; };

// FUN_00aa0d50(k, C, dir): FUN_0034ba30 (C+0x230..0x26f = the matrix now, translation 0), FUN_0034ba60(C, dir, 1)
// (target rows: +0x270 = up x dir, +0x290 = +0x270 x up = dir with its up part removed, +0x280 = up; normalised),
// FUN_0034bcf8(k) (C+0x21c = k), FUN_0034e960(C, 1) (C+0x214 = 1, +0x218 = 0, C+0x1c4 bit 1 on / bit 3 off) ->
// FUN_0034dc50 case 1: q0 / q1 = FUN_00263148 of both, q0 negated when q0.q1 < 0, C+0x228 = acos(q0.q1); C+0x1c0
// bit 3: the profile FUN_00349e98 sets +0x21c, bit 2: +0x21c = angle / C+0x220 (neither on the boss: warned).
export function turnStart(a, dir, k, warn = () => {}) {
  const C = a.C;
  const d = unit([dir[0], 0, dir[2]]);                                    // dir - (dir . up) up, normalised
  C.tq0 = a.face.slice(0, 3);
  C.tq1 = (d[0] || d[2]) ? d : a.face.slice(0, 3);
  C.t21c = f(k);                                                           // FUN_0034bcf8
  C.s214 = 1; C.s218 = 0;                                                 // FUN_0034e960
  C.f1c4 = ((C.f1c4 & ~8) | 2) >>> 0;
  if (C.f1c0 & 8) warn('turn_mover: turn mode 1 with C+0x1c0 bit 3 (the profile FUN_00349e98 on +0x2e0) not translated: time C+0x21c kept');
  else if (C.f1c0 & 4) warn('turn_mover: turn mode 1 with C+0x1c0 bit 2 (angle / C+0x220) not translated: time C+0x21c kept');
}

// the signed turn about up from u to v (both level, unit)
function yawBetween(u, v) {
  return Math.atan2(f(f(u[2] * v[0]) - f(u[0] * v[2])), f(f(u[0] * v[0]) + f(u[2] * v[2])));
}
const rotY = (v, t) => { const c = Math.cos(t), s = Math.sin(t); return [f(v[0] * c + v[2] * s), v[1], f(-v[0] * s + v[2] * c)]; };

// FUN_0034ea18's turn part for mode 1: FUN_0034de50 case 1 (bit 3 clear: u = clamp(+0x218 / +0x21c, 0, 1), the
// slerp q0 -> q1 by u, the matrix from it), +0x218 += dt (DAT_0046e290 +0xc); at +0x218 >= +0x21c (>= 0) ->
// FUN_0034e880(C, 0) case 1 (the matrix = the target rows +0x270..), C+0x214 = 0, +0x224 = 0,
// C+0x1c4 = (&~2) | 8 (the end bit the boss waits on), +0x218 -= +0x21c. The body listener's event 7 is not modelled.
export function turnStep(a, dt) {
  const C = a.C;
  if (C.s214 !== 1) return false;
  let u = C.t21c !== 0 ? f(C.s218 / C.t21c) : 1;
  if (u < 0) u = 0; else if (1 < u) u = 1;
  const ang = yawBetween(C.tq0, C.tq1);
  const v = rotY(C.tq0, ang * u);
  a.face = [v[0], a.face[1] ?? 0, v[2]];
  C.s218 = f(C.s218 + dt);
  if (C.t21c <= C.s218 && 0 <= C.t21c) {
    a.face = [C.tq1[0], a.face[1] ?? 0, C.tq1[2]];                          // FUN_0034e880 case 1
    C.s214 = 0; C.s224 = 0;
    C.f1c4 = ((C.f1c4 & ~2) | 8) >>> 0;
    C.s218 = f(C.s218 - C.t21c);
    return true;
  }
  return false;
}
