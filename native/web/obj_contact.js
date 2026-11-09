// obj_contact.js -- FUN_0035a440's object pass: Vincent's physics body (mode 0xc) against placed objects whose +0x38 has
// bit 4 (worker 0269). On z128 those are the EM barriers (g048, class 8, vt 0x58c630) and the door boxes (class 3,
// vt 0x591890): both answer the pass with the same slots (vt+0x16c FUN_0054c610 = 1, vt+0x184 FUN_005861a8, vt+0x3c
// FUN_00585dc0, vt+0x194 FUN_00584900, vt+0xdc FUN_00587690 = self, vt+0x124 FUN_0054ec18 = 0, vt+0x84 FUN_0054eb78 = 0),
// all shape 0 (a box) with +0x28 bit 0x200000 (FUN_00583d70: shape < 4, type flag bit 2 clear).
//
//   objectPass({ objs, pos, move, air, push }) -> { out, applied }   FUN_0035a440 0x35a440..0x35c108's object terms
//
// objs: [{ half: [hx, hy, hz], m: rows (row 3 = the centre), f38, vt13c, vt84 }] (props.js blockers(); vt13c / vt84: whether the
// object's vt+0x13c / vt+0x84 answer non-zero: the barrier's FUN_0054fb70 returns itself, FUN_0054eb78 0, ELF 0x58c76c / 0x58c6b4). pos: the body point (feet, the
// game's -y up), move: this step's displacement (body+0x30), air: FUN_003577c8 (body state 2..5), push: body+0x80 or null,
// r / h: body+0xb8 / +0xbc (Vincent's by default; the soldiers' and dogs': enemy_ai.js).
// T: w269_bar1 (r03_mid2, Vincent into barrier record 56): body+0xb8 = 5, +0xbc = 9; DAT_0046f4d0 = 1 (the pass off)
// lets him 5.7 u further, to the walk mesh's edge (w269_bar1_noobj).
//
// Not translated (warned): the stand-on-top branch (+0x38 bit 5: vt+0x17c mode 5, a normal within 35 degrees of up),
// the ceiling flag iStack_124 (a normal more than 160 degrees from up) and its body-state change, the objects without
// +0x28 bit 0x200000 (the nearest-point branch with the distance from the new centre, l.855) and the 'moving' sum (vt+0xdc's
// type flag bit 2 or vt+0x124: auStack_310, rejected against the static sum, l.1300): z128's explosive barrels (e057, type flags
// 0x80157: +0x38 bits 4 / 5, cylinders through FUN_0025d1b8, whose normal is not decoded) are such objects and are left out
// (props.js blockers warns), the platform frame (body flag bit 12: clear for 0x236). C+0x1c0's 0x80000 / 0x40000 | 0x400 /
// 0x100000 and C+0xbc come back as `bits` / `kind` (enemy_ai.js sets them on the soldiers; nothing on the page reads Vincent's).
// Also not translated (warned when an object answers vt+0x84): l.905-913 / l.1454 (iStack_10c), an object whose vt+0x84 owner
// is a type-10 body (FUN_00550778) with owner +0xd4 +0xb4 bit 2 and FUN_00550a20(owner, move): the corrected move is slid
// along that object's matrix row 2 when it runs against it; and C+0xbc 3 / 5 for such objects. The barriers answer vt+0x84 0.
// T (soldiers / dogs): none. Traces a271_objpass / a271_objpass2 (r03_mid2, Vincent at barrier 56 while the r 6 chaser closes
// in) logged every body's FUN_0035a440: only Vincent's touched a barrier, so the enemy path (bodyRH, the air branch for
// them, the 0x100000 test) is read from the code, not traced.

const f = Math.fround;
const sub3 = (a, b) => [f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2])];
const add3 = (a, b) => [f(a[0] + b[0]), f(a[1] + b[1]), f(a[2] + b[2])];
const mul3 = (a, k) => [f(a[0] * k), f(a[1] * k), f(a[2] * k)];
const dot3 = (a, b) => f(f(f(a[0] * b[0]) + f(a[1] * b[1])) + f(a[2] * b[2]));
const len3 = a => f(Math.sqrt(dot3(a, a)));
const unit3 = v => { const l = len3(v); return l > 0 ? v.map(x => f(x / l)) : [0, 0, 0]; };   // vrsqrt / vmulq

export const BODY_R = 5.0;           // body+0xb8 (T: w269_bar1)
export const BODY_H = 9.0;           // body+0xbc (T: w269_bar1)
export const SWEEP_MIN = 0.05;       // DAT_0046f4d4: a move this short takes the nearest-point test, not the sweep
const SOFT = 4.8;                    // fVar48 = body+0xb8 - 4.8: a depth under it is eased to depth^2 / fVar48
const UP = [0, 1, 0];                // DAT_004a2008 (uStack_380)
const VERT = 0.98;                   // |N . DAT_004a2008| above it: FUN_00260e28, else FUN_0035a320

// FUN_00260e28(k, out, v, n): v without its n part, + k n (k = 0 at every call here)
export const reject = (v, n) => { const u = unit3(n); return sub3(v, mul3(u, dot3(v, u))); };
// FUN_0035a320(0, out, v, n): v without its n part, rescaled to |v| when longer than 0.001
function rejectKeep(v, n) {
  const L = len3(v), o = reject(v, n), l = len3(o);
  return 0.001 < l ? mul3(unit3(o), L) : o;
}

// the object matrix (FUN_0054a5e8: rows, row 3 = the centre) and its rigid inverse (FUN_002610e0 / FUN_0026138c)
const toLocal = (p, m) => { const v = sub3(p, m[3]); return [0, 1, 2].map(i => f(f(f(v[0] * m[i][0]) + f(v[1] * m[i][1])) + f(v[2] * m[i][2]))); };
const toWorld = (q, m) => [0, 1, 2].map(j => f(f(f(f(q[0] * m[0][j]) + f(q[1] * m[1][j])) + f(q[2] * m[2][j])) + m[3][j]));
const dirWorld = (n, m) => [0, 1, 2].map(j => f(f(f(n[0] * m[0][j]) + f(n[1] * m[1][j])) + f(n[2] * m[2][j])));
// FUN_00261218(p, lo, hi): every component of p - lo and hi - p of one sign
const inBox = (p, lo, hi) => [0, 1, 2].every(i => (p[i] - lo[i] < 0) === (hi[i] - p[i] < 0));

// FUN_0025af18(P, N, a, b, ext, 0): the segment against the box +-ext (local). As props.js boxRay (FUN_0025a8f0): the
// bounding test, a and b over ext, VCLIP flags of both, +1 faces z, y, x then -1 faces z, y, x, each t <= the best so far
// with the point inside the other faces; the point clamped to +-1 (DAT_004992b0 / c0) and scaled back.
export function slabRay(a, b, ext) {
  const mid = [0, 1, 2].map(j => f(f(a[j] + b[j]) * 0.5));
  if (!(len3(mid) <= f(len3(sub3(mid, a)) + len3(ext)))) return null;
  const A = [0, 1, 2].map(i => f(a[i] / ext[i])), B = [0, 1, 2].map(i => f(b[i] / ext[i]));
  const clip = p => { let r = 0; for (let i = 0; i < 3; i++) { if (p[i] > 1) r |= 1 << (2 * i); if (p[i] < -1) r |= 2 << (2 * i); } return r; };
  const cross = clip(A) ^ clip(B);
  if (!(cross & 0x3f)) return null;
  const D = sub3(B, A);
  let best = 1, P = null, N = null;
  for (const s of [1, -1]) for (let i = 2; i >= 0; i--) {
    const bit = 2 * i + (s < 0 ? 1 : 0);
    if (!((cross >> bit) & 1) || !(0 < Math.abs(D[i]))) continue;
    const t = f(f(s - A[i]) / D[i]);
    if (!(t <= best)) continue;
    const p = [0, 1, 2].map(j => f(A[j] + f(D[j] * t)));
    if (clip(p) & ~(1 << bit) & 0x3f) continue;
    P = p; N = [0, 0, 0]; N[i] = s; best = t;
  }
  if (!P) return null;
  return { P: P.map((v, i) => f(Math.max(-1, Math.min(1, v)) * ext[i])), N };
}

// FUN_0025c830(r, P, N, a, b, c): the segment against the sphere c, r. u = unit(b - a); rejected when the segment's middle
// is further than r + |b - a| / 2 + 0.1 or the line (FUN_00261498) further than r; FUN_0025cad0 / FUN_00260b7c: the roots
// m -+ h of |a + t u - c| = r, P the one of smaller |t|, P2 the other. a inside: b inside too -> none; P behind a
// (FUN_00260700 < 0) -> P2. Else P outside a..b -> none. N = unit(P - c).
export function sphereSeg(r, a, b, c) {
  const u = unit3(sub3(b, a)), mid = [0, 1, 2].map(j => f(f(a[j] + b[j]) * 0.5));
  if (!(len3(sub3(mid, c)) <= f(f(r + f(len3(sub3(a, b)) * 0.5)) + 0.1))) return null;
  const w = sub3(c, a), along = dot3(w, u);
  if (!(len3(sub3(w, mul3(u, along))) <= r)) return null;
  const ac = sub3(a, c), A = dot3(u, u), Bq = f(dot3(u, ac) * 2), C = f(dot3(ac, ac) - f(r * r));
  const disc = f(f(Bq * Bq) - f(f(A * 4) * C));
  if (disc < 0) return null;
  const m = f(-Bq / f(A * 2)), h = f(f(Math.sqrt(disc)) / f(A * 2));
  const tn = Math.abs(f(m - h)) < Math.abs(f(m + h)) ? f(m - h) : f(m + h), tf = tn === f(m - h) ? f(m + h) : f(m - h);
  let P = add3(a, mul3(u, tn));
  const param = p => { const ab = sub3(b, a), ap = sub3(p, a), t = f(len3(ap) / len3(ab)); return dot3(ap, ab) < 0 ? -t : t; };   // FUN_00260700
  if (dot3(ac, ac) < f(r * r)) {
    const bc = sub3(b, c);
    if (dot3(bc, bc) < f(r * r)) return null;
    if (param(P) < 0) P = add3(a, mul3(u, tf));
  } else {
    const t = param(P);
    if (t < 0 || 1 < t) return null;
  }
  return { P, N: unit3(sub3(P, c)) };
}

// VRSQRT / VMULq.xyz: v x 1 / sqrt(v . v)
const vunit = v => { const q = f(1 / f(Math.sqrt(dot3(v, v)))); return mul3(v, q); };
// FUN_00261498(p, q, u): the distance from p to the line q + t u (VDIV t = ((q - p) . u) / (u . u))
const lineDist = (p, q, u) => { const t = f(dot3(sub3(q, p), u) / dot3(u, u)); return len3(sub3(sub3(q, mul3(u, t)), p)); };
// FUN_00260700(p, a, b): |p - a| / |b - a|, negative when (p - a) . (b - a) < 0
const segParam = (p, a, b) => { const v = sub3(p, a), w = sub3(b, a), t = f(len3(v) / len3(w)); return dot3(v, w) < 0 ? -t : t; };
// FUN_0025a778(0, out, v, n): v's part along n (unit(n) x (unit(n) . v))
const along = (v, n) => { const u = vunit(n); return mul3(u, dot3(u, v)); };
// FUN_00259680(a, u, c, v, outA, outB): the closest points of the lines a + s u and c + t v (outA, outB) and their distance.
// uu vv - uv^2 <= 0.0001 (0x38d1b717): s = (c . u - a . u) / uu, t = 0.
function lineLine(a, u, c, v) {
  const w = sub3(c, a), uu = dot3(u, u), vv = dot3(v, v), wu = dot3(w, u), wv = dot3(w, v), uv = dot3(u, v);
  const den = f(f(uu * vv) - f(uv * uv));
  let s, t;
  if (den <= f(0.0001)) { s = f(f(dot3(c, u) - dot3(a, u)) / uu); t = 0; }
  else { t = f(f(f(uv * wu) - f(uu * wv)) / den); s = f(f(f(vv * wu) - f(uv * wv)) / den); }
  const A = add3(mul3(u, s), a), B = add3(mul3(v, t), c);
  return { A, B, d: len3(sub3(B, A)) };
}
// FUN_0025c0f8(r, P, N, a, b, e0, e1) 0x25c0f8..0x25c768 (read from the MIPS; the decomp drops most call arguments): the
// segment a..b against the cylinder e0..e1, radius r. Rejects: the axis middle (FUN_002611f4(0.5, e1, e0)) further from the
// line a + t u than sqrt(|e1 - e0|^2 / 4 + r^2); the segment middle further from the axis line than r + |a - b| / 2 + 0.1;
// the two lines (FUN_00259680) further apart than r. Then the end discs before the side:
//   e0's plane (FUN_0025fed0: axis, -axis . e0) with a on or behind it (plane . (a, 1) <= 0): P = the line's crossing
//   (FUN_00260628), |P - e0| <= r and FUN_00260700(P, a, b) in [0, 1] -> N = -axis;
//   then e1's plane with plane . (a, 1) >= 0, |P - e1| <= r, the same range -> N = +axis.
//   The side: k = sqrt(r^2 - d^2) / |u without its axis part|; P = C - k u, then C + k u (C: the closest point on a's line),
//   each kept when FUN_00260700(P, a, b) and the axis coordinate (FUN_0025a778 of P - e0, + e0: FUN_00260700 against
//   e0, e1) are in [0, 1]; the first fails over to the second, the second's failure returns 0. N = unit(FUN_00260e28(0,
//   P - e0, axis)). L: a's w is taken as 1 (the local points are positions).
export function cylSeg(r, a, b, e0, e1) {
  const u = vunit(sub3(b, a));
  const m1 = add3(e1, mul3(sub3(e0, e1), 0.5));                  // FUN_002611f4(0.5, out, e1, e0)
  if (f(Math.sqrt(f(f(dot3(sub3(e1, e0), sub3(e1, e0)) * 0.25) + f(r * r)))) < lineDist(m1, a, u)) return null;
  const ax = vunit(sub3(e1, e0));
  const m2 = add3(a, mul3(sub3(b, a), 0.5));                      // FUN_002611f4(0.5, out, a, b)
  if (f(f(r + f(len3(sub3(a, b)) * 0.5)) + f(0.1)) < lineDist(m2, e1, ax)) return null;
  const L = lineLine(a, u, e0, ax);
  if (r < L.d) return null;
  for (const [e, sg] of [[e0, -1], [e1, 1]]) {                     // 0x25c31c (e0) / 0x25c408 (e1)
    const pw = f(-dot3(e, ax)), side = f(dot3(ax, a) + pw);
    if (sg < 0 ? !(side <= 0) : !(0 <= side)) continue;
    const t = f(f(-side) / dot3(ax, u)), P = add3(a, mul3(u, t));  // FUN_00260628
    if (!(len3(sub3(P, e)) <= r)) continue;
    const s = segParam(P, a, b);
    if (!(0 <= s && s <= 1)) continue;
    return { P, N: mul3(ax, sg) };
  }
  const k = f(f(Math.sqrt(f(f(r * r) - f(L.d * L.d)))) / len3(reject(u, ax)));
  for (const kk of [f(-k), k]) {                                   // 0x25c54c / 0x25c620
    const P = add3(mul3(u, kk), L.A), s = segParam(P, a, b);
    if (!(0 <= s && s <= 1)) { if (kk < 0) continue; return null; }
    const N0 = sub3(P, e0), h = segParam(add3(along(N0, ax), e0), e0, e1);
    if (!(0 <= h && h <= 1)) { if (kk < 0) continue; return null; }
    return { P, N: vunit(reject(N0, ax)) };                        // LAB_0025c6f0
  }
  return null;
}

// FUN_0025b4d8(r, P, N, a, b, e0, e1): an edge of the expanded box = the capsule e0..e1: the sphere at e0 when P's
// FUN_0025e258 parameter along e1 - e0 is <= 0, the sphere at e1 when >= 1, else the cylinder
function edgeSeg(r, a, b, e0, e1) {
  const d = sub3(e1, e0), dd = dot3(d, d);
  const t = P => f(f(-dot3(sub3(e0, P), d)) / dd);                // FUN_0025e258
  let h = sphereSeg(r, a, b, e0);
  if (h && t(h.P) <= 0) return h;
  h = sphereSeg(r, a, b, e1);
  if (h && 1 <= t(h.P)) return h;
  return cylSeg(r, a, b, e0, e1);
}

// FUN_0025b6f8(r, P, N, a, b, half): a sphere of radius r swept a -> b against the box +-half (local). The box grown by r
// (FUN_0025af18); missed and a already in the grown box but not in the box: again from a + unit(a - b) r. A hit with P
// strictly inside the box's slab on two axes or more is a face; on one axis, that edge (FUN_0025b4d8); on none, the
// corner's three edges in x, y, z order.
export function sweptBox(r, a, b, half) {
  const ext = half.map(v => f(v + r));
  let a2 = a, h = slabRay(a, b, ext);
  if (!h) {
    const nx = ext.map(v => -v), nh = half.map(v => -v);
    if (inBox(a, nx, ext) && !inBox(a, nh, half)) {
      a2 = add3(a, mul3(unit3(sub3(a, b)), r));
      h = slabRay(a2, b, ext);
    }
  }
  if (!h) return null;
  const P = h.P, prod = [0, 1, 2].map(i => f(f(P[i] - half[i]) * f(P[i] + half[i])));
  const n = prod.filter(v => v < 0).length;
  if (n >= 2) return h;
  const sg = i => (P[i] < 0 ? -half[i] : half[i]);
  if (n === 1) {
    const i = prod[0] < 0 ? 0 : prod[1] < 0 ? 1 : 2;
    const e1 = [sg(0), sg(1), sg(2)]; e1[i] = half[i];
    const e0 = e1.slice(); e0[i] = -half[i];
    return edgeSeg(r, a2, b, e0, e1);
  }
  const c0 = [sg(0), sg(1), sg(2)];
  for (let i = 0; i < 3; i++) {
    const e1 = c0.slice(); e1[i] = -c0[i];
    const e = edgeSeg(r, a2, b, c0, e1);
    if (e) return e;
  }
  return null;
}

// FUN_00585dc0 shape 0 -> FUN_0025cf00(P, N, q, -half, half) (local): outside, q clamped (the clamped axes give N =
// unit(q - P) over them); inside, the nearest of the six faces (the - faces first; on a tie the earlier), N its axis.
// Returns { P, N, ret } in world; ret = more than one axis inside (outside), true (inside).
export function nearestBox(q, half, m) {
  const L = toLocal(q, m), lo = half.map(v => -v);
  let P, N, ret;
  if (!inBox(L, lo, half)) {
    let k = 0; P = [0, 0, 0]; const mask = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      if (L[i] < lo[i]) { P[i] = lo[i]; mask[i] = 1; }
      else if (half[i] < L[i]) { P[i] = half[i]; mask[i] = 1; }
      else { P[i] = L[i]; k++; }
    }
    N = unit3(sub3(L, P).map((v, i) => f(v * mask[i])));
    ret = 1 < k;
  } else {
    let best = Infinity, bi = 0, bs = 0;
    for (const s of [0, 1]) for (let i = 0; i < 3; i++) {
      const d = Math.abs(f(L[i] - (s ? half[i] : lo[i])));
      if (!(best <= d)) { best = d; bi = i; bs = s; }
    }
    P = L.slice(); P[bi] = bs ? half[bi] : lo[bi];
    N = [0, 0, 0]; N[bi] = bs ? 1 : -1;
    ret = true;
  }
  return { P: toWorld(P, m), N: dirWorld(N, m), ret };
}
// FUN_00584900 shape 0 -> FUN_0025f450(q, half, M): q inside the box (L: the local test, as FUN_00261218)
export const insideBox = (q, half, m) => inBox(toLocal(q, m), half.map(v => -v), half);

// FUN_0035a440's object pass and the sums after it.
// FUN_00261038(a, b): the angle between a and b (L: acos of the unit dot; a zero vector gives NaN, no bit)
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, f(dot3(unit3(a), unit3(b))))));
const OPPOSE = 2.3561945;            // 135 degrees (0x4016cbe4, asm 0x35b6a4..)
// face: the character's matrix row 2 for the 0x100000 test (l.1013: FUN_00261038(N, copy +0x20)); null: not computed (Vincent:
// no page reader). Decoded from the ELF: a live body's C+0x54c = 0x4a1bf0 (FUN_0033ff18; 0x4a1fb0 is only FUN_00340360's
// teardown), whose +0x20 this-adjust is 0 and +0x24 FUN_00347868 copies C+0x00..+0x3f as it is when C+0x7dc == 0 (else that
// parent's matrix (FUN_0054a698) times it, FUN_0026125c: not on the page), so row 2 = C+0x20 = enemy_ai's a.face (enemies.js /
// test_strafe_walk read it from C+0x20). Its sign is the game's own row; only the angle's 135-degree limit is applied. Returns bits = C+0x1c0's 0x80000 / 0x40000 / 0x100000 (worker 0269, review), kind = C+0xbc for 0x400.
export function objectPass({ objs, pos, move, air, push = null, warn = () => {}, r = BODY_R, h = BODY_H, face = null }) {
  const soft = r > SOFT ? f(r - SOFT) : 0;
  // FUN_003562d0: the body point; + the move (auStack_340); both lowered by r, then by 3 on the ground or r / 2 in the air
  const low = air ? f(r * 0.5) : 3.0;
  const cur = [pos[0], f(f(pos[1] - r) - low), pos[2]];                       // uStack_330
  const nw = [f(pos[0] + move[0]), f(f(f(pos[1] + move[1]) - r) - low), f(pos[2] + move[2])];   // uStack_430
  const head = [nw[0], f(f(f(pos[1] + move[1]) - r) + f(f(h * -2.0) + f(r * 1.5))), nw[2]];   // auStack_420
  let S = [0, 0, 0], nS = 0, maxLen = 0, contacts = 0, applied = false, oppose = false, kind = 0;
  for (const o of objs) {
    if (!(o.f38 & 0x10) && !(o.f38 & 0x20)) continue;                      // +0x38 bit 4 or 5
    let P = null, N = null, ret = 0, depth;
    // +0x28 bit 0x200000: a move longer than DAT_0046f4d4 is swept (vt+0x184 FUN_005861a8 -> FUN_0025b608, the type's
    // size / 2, radius body+0xb8): depth = |(new - P) along N| (FUN_0025a778(0, ..)); otherwise, or with no hit, the
    // nearest point to the current centre (vt+0x3c): depth = r - |cur - P|, and inside the box (vt+0x194) r + |cur - P|
    if (len3(sub3(cur, nw)) > SWEEP_MIN) {
      const h = sweptBox(r, toLocal(cur, o.m), toLocal(nw, o.m), o.half);
      if (h) {
        P = toWorld(h.P, o.m); N = dirWorld(h.N, o.m);
        const v = sub3(nw, P), u = unit3(N);
        depth = len3(mul3(u, dot3(u, v)));
      }
    }
    if (!P) {
      const h = nearestBox(cur, o.half, o.m);
      P = h.P; N = h.N; ret = h.ret;
      depth = f(r - len3(sub3(cur, P)));
    }
    if (depth <= 0 && insideBox(cur, o.half, o.m)) {                       // 0x35b330: vt+0x194, then vt+0x3c from the current centre
      const h = nearestBox(cur, o.half, o.m);
      P = h.P; N = h.N; ret = h.ret;
      depth = f(r + len3(sub3(cur, P)));
    }
    // decomp l.1013 (0x35b644): depth > -1, +0x28 bit 0x200000 (every blocker) and a character: the normal more than 135 degrees
    // from its matrix row 2 -> iStack_110 (C+0x1c0 0x100000)
    if (face && -1 < depth && OPPOSE < angle(N, face)) oppose = true;
    let pushed = null;
    if (0 < depth) {
      if (depth < soft) depth = f(f(depth * depth) / soft);
      let p = mul3(unit3(N), depth);
      p = Math.abs(dot3(unit3(N), UP)) > VERT ? reject(p, UP) : rejectKeep(p, UP);
      pushed = p; applied = true; contacts++;
      if ((o.f38 & 0x20) && ret && Math.abs(dot3(unit3(N), UP)) > Math.cos(0.6108653)) warn('obj_contact: standing on an object (FUN_0035a440 +0x38 bit 5, vt+0x17c mode 5) not translated');
    }
    // iStack_124 == 0: a second test (vt+0x3c). On the ground (0x35b840) the nearest point to the new centre, its depth
    // from the head point (auStack_420), the push through FUN_0035a320 (body flag bit 18 clear); in the air the nearest point
    // to the head point, the push as it is. Either pushes only when the first did not.
    {
      const h = nearestBox(air ? head : nw, o.half, o.m);
      const d2 = f(r - len3(sub3(head, h.P)));
      if (0 < d2) {
        if (!pushed) {
          const e = d2 < soft ? f(f(d2 * d2) / soft) : d2;
          const p = mul3(unit3(h.N), e);
          pushed = air ? p : rejectKeep(p, UP); applied = true; contacts++;
        }
        // FUN_00261038(body+0x50, N) > 2.792527 (160 degrees): body+0x50 = up, the game's (0, -1, 0)
        if (Math.acos(Math.max(-1, Math.min(1, dot3([0, -1, 0], unit3(h.N))))) > 2.792527) warn('obj_contact: ceiling contact (FUN_0035a440 iStack_124) not translated');
      }
    }
    if (!pushed) continue;
    // static (vt+0xdc self, type flag bit 2 clear, vt+0x124 = 0): auStack_360 += push, fVar49 = the longest
    S = nS ? add3(S, pushed) : pushed;
    // uStack_138 (l.1223, the last pushing object's): vt+0x13c non-zero -> 4; else vt+0x84 non-zero -> 3 when it is a type-10
    // body (FUN_00550778), else 5
    if (o.vt84) warn('obj_contact: an object answering vt+0x84 (FUN_0035a440 iStack_10c slide l.905, C+0xbc 3 / 5) not translated');
    kind = o.vt13c ? 4 : 5;
    maxLen = nS ? Math.max(maxLen, len3(pushed)) : len3(pushed);
    nS++;
  }
  const bits = {};
  // l.1264: the static sum (before its mean) more than 135 degrees from the move -> C+0x1c0 |= 0x80000; l.1272: iStack_110 -> 0x100000
  if (dot3(S, S) > 0 && OPPOSE < angle(move, S)) bits[0x80000] = true;
  bits[0x100000] = oppose;
  if (nS > 0) {                                                             // the mean, at the longest push's length
    const avg = mul3(S, f(1.0 / nS));
    const L = Math.max(maxLen, len3(avg));
    S = mul3(unit3(avg), L);
  }
  if (push && f(f(f(push[0] * push[0]) + f(push[1] * push[1])) + f(push[2] * push[2])) > 0) {   // body flag bit 4: body+0x80
    S = nS === 0 ? add3(S, push) : add3(S, reject(push, S));
    applied = true;
  }
  // l.1361: the whole correction more than 135 degrees from the move -> 0x40000, and 0x400 with C+0xbc = uStack_138 if 0x400 was clear
  if (dot3(S, S) > 0 && OPPOSE < angle(move, S)) bits[0x40000] = true;
  if (air && S[0] !== 0 && S[2] !== 0) {                                    // FUN_003577c8: the push made level, its length kept
    const L = len3(S); S = mul3(unit3([S[0], 0, S[2]]), L);
  }
  if (!applied) return { out: move.slice(), applied: false, contacts, bits, kind };
  let out = add3(move, S);                                                  // body flag bit 12 clear: out = in + S
  if (dot3(out, S) < 0 && 0 < contacts) out = reject(out, S);
  return { out, applied: true, contacts, bits, kind };
}
