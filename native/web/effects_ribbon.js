// effects_ribbon.js - FED channel types 59 (a path node) and 60 (a jagged ribbon / beam), translated for the
// variants the EM barrier's beams use (FED 07670c03, emitter 0: part 1 = the node, part 2 = the beam). Decode and
// field list: notes/ribbon-research.md. Every function cites its game address.
//
// Channel objects in effects.js's form (wire as T[59] = T59, T[60] = T60):
//   init(X, a, o) / trans(X, t, a, o) / eval(X, t, a, o) / draw(X, a, o, view, out, tex, proj) / loop(...)
// X = { F, em, p, d, rng, warn } as effects.js; a = the channel's data; o = its value slot (p.v index). The heap objects
// the game hangs off the value slot are kept in p.ext[o] (as types 21 / 103 / 107 / 109 do).
//
// Type 59 (vtable 0x49ef98): a 0x30 object { +0x10 point, +0x20 relative flag, +0x24 next node }. Its draw is the
// shared no-op 0x2d5730, so T59 has no draw.
// Type 60 (vtable 0x49ef20): value word 0 = B (0xa0, FUN_0028b978, the draw side), word 1 = A (0xdc, FUN_002895c0, the
// path: vtable 0x49b7b0). Translated: curve 0x49b940 (data +0xc4 = 0), 0x8c object 0x49b778 (+0xc0 = 0), 0x90 object
// 0x49b758 (+0xbe = 0), no random widths (+0xb1 = 0), no width blend (+0xb2 = 0), no fixed-length nodes (+0xb3 = 0),
// rebuild without the kept path (+0xbd = 0), the draw FUN_0028d9b8 untextured (+0xb0 != 0, +0x40 != 0, +0xb7 = 0).
// Any other variant warns and the particle is not drawn (p.noDraw), or the init fails (p.skip) where the game's would.
//
// OUTPUT (draw): FUN_0028cf78 sends three GS TRIANGLE STRIPs (GIF tag PRIM 0x4c = TRISTRIP | IIP | ABE, PACKED, regs
// RGBAQ, XYZ2; untextured, gouraud, blended) after a packet setting COLCLAMP = 1 and ALPHA = data +0xba's (0x48 for the
// barrier). Each triangle the GS draws (a strip vertex k >= 2 whose ADC bit is clear) is pushed to `out` as one record
// in the form EffectLayer already draws for untextured model triangles (type 11):
//   { verts: [v0, v1, v2], tex: null, untextured: true, alpha, emitter, id, type: 60, tag, strip, prim: 0x4c }
//   v = { pos: [x, y, z] game view space, uv: [0, 0], rgba: [r, g, b, a] (the bytes the GS gets: VFTOI0 & 0xff),
//         gs: [X, Y, Z] (screen: X / Y in 1/16 px toward zero (VFTOI4), Z VFTOI0) }
// strip = 0 core (rows 2 -> 3), 1 / 2 the two glow bands (rows 0 -> 2, rows 3 -> 1). Vertex alpha can be 0xff (data
// +0x10 w = 255): the GS's As is up to 2.0 (x / 128) with COLCLAMP; EffectLayer's untextured material writes a / 128 as
// the fragment alpha, which WebGL clamps to 1.0 (see notes/ribbon-research.md "Layer side").

// Rounding: the EE FPU and VU0 round toward zero (PCSX2's default "chop", as the hardware). MEASURED: with Math.fround
// (nearest) the beams' built / drawn paths in r03_key2 RAM differ in the last bit; rounding toward zero (here and in
// the LCG's float step) reproduces them bit-exact (notes/ribbon-research.md "Checks"). effects.js uses Math.fround.
const _fb = new Float32Array(1), _fu = new Uint32Array(_fb.buffer);
const f = x => { const r = Math.fround(x); if (r === x || !Number.isFinite(r) || Math.abs(r) <= Math.abs(x)) return r; _fb[0] = r; _fu[0] -= 1; return _fb[0]; };
const bitsF = u => new Float32Array(new Uint32Array([u]).buffer)[0];
const K128 = f(1 / 128);                   // 0x3c000000 (FUN_0028e5a0)
const K09 = bitsF(0x3f666666);             // FUN_002a7ec0: 0.9
const K10 = bitsF(0x411ffffe);             // FUN_002a7ec0: 9.999998
const ALPHA_ABC = [0x44, 0x48, 0x42];
// FUN_002d98c8 / FUN_002d9938 on the effect LCG (X.rng's state, effects.js EffectRng.next): ((s & 0x7fff) - 0x4000) x
// 6.10351e-05 x r / (s & 0x7fff) x 3.05176e-05 x r, with the FPU's rounding (toward zero)
const K98C8 = bitsF(0x387fffd5), K9938 = bitsF(0x37fffec2);
const lcgSigned = (X, r) => f(f(((X.rng.next() & 0x7fff) - 0x4000) * K98C8) * f(r));
const lcgUnit = (X, r) => f(f((X.rng.next() & 0x7fff) * K9938) * f(r));      // FUN_00284d30 cases 0..2 (FUN_00284e20(i, 0, 1, 2) = i for 0..2, else 0)
// Camera 0's clip planes (camera +0x28 near, +0x2c far; MEASURED r03_key2 RAM 0x4ea5e0: 1.0 / 30000.0). Used when the
// projection passed to draw carries no near / far.
const NEAR0 = 1, FAR0 = 30000;

// The descriptor fields (as effects.js's D)
const D = {
  type: (F, d) => F.u16(d), slot: (F, d) => F.u16(d + 4),
  ref: (F, d, k) => F.u16(d + 6 + 2 * k), refSlot: (F, d, k) => F.u16(d + 6 + 2 * (F.u8(d + 2) + k)),
};
const warnOnce = (X, msg) => { const s = (X.F.ribbonWarned ??= new Set()); if (!s.has(msg)) { s.add(msg); X.warn(msg); } };

// ---- VU0 helpers (asm field masks noted where they matter) -------------------------------------------------------
const sub4 = (a, b) => [0, 1, 2, 3].map(i => f(a[i] - b[i]));                    // FUN_00444c40(out, a, b): VSUB.xyzw
const scale4 = (a, k) => a.map(x => f(x * k));                                     // FUN_00444c70(out, in, k): VMULx.xyzw
const addXYZ = (a, b) => [f(a[0] + b[0]), f(a[1] + b[1]), f(a[2] + b[2]), a[3]];   // VADD.xyz (w kept)
const subXYZ = (a, b) => [f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2]), a[3]];   // VSUB.xyz (w kept)
const dot3 = v => f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]));          // VMUL.xyz, VADDy.x, VADDz.x
const vsqrt = x => f(Math.sqrt(x));                                                // VSQRT + VADDq.x vf0 (length)
const vrsqrt = x => f(1 / f(Math.sqrt(x)));                                        // VRSQRT vf0.w / sqrt
const unitXYZ = v => { const q = vrsqrt(dot3(v)); return [f(v[0] * q), f(v[1] * q), f(v[2] * q), 0]; };   // VSUB vf6 = 0, VMULq.xyz
// FUN_002d8578(out, M, v): VMULAx / VMADDAy / VMADDAz / VMADDw vf0.w (w taken as 1). Rows are M[4r .. 4r + 3].
const xformVU = (M, v) => [0, 1, 2, 3].map(j => f(f(f(f(v[0] * M[j]) + f(v[1] * M[4 + j])) + f(v[2] * M[8 + j])) + M[12 + j]));
// The 4x4 / 3x3 products as effects.js's mul44 / mul33 (FUN_002d8368 / FUN_002d83e0: out = B . A)
function mul44(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++)
    o[4 * i + j] = f(f(f(b[4 * i] * a[j]) + f(b[4 * i + 1] * a[4 + j])) + f(f(b[4 * i + 2] * a[8 + j]) + f(b[4 * i + 3] * a[12 + j])));
  return o;
}
function mul33(a, b) {
  const o = new Float32Array(16);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++)
    o[4 * i + j] = f(f(f(b[4 * i] * a[j]) + f(b[4 * i + 1] * a[4 + j])) + f(b[4 * i + 2] * a[8 + j]));
  for (let j = 0; j < 4; j++) o[12 + j] = b[12 + j];
  return o;
}

// FUN_0028f3f0 / FUN_0028b680's search: the first particle of the CURRENT emitter (mgr +0xa4) whose part tag (P +4) is
// tag & 0xfff, over the emitter lists DAT_0049b9f8 / DAT_0049b928 = { 2, 1 } (+0x68, then +0x64). The page keeps one
// live list (em.lists[1], the game's +0x64: MEASURED r03_mid2, the barrier's particles all hang off emitter +0x64).
// L: the game's list 2 (+0x68) holds nothing for these effects (empty in every r03 state read); not searched here.
function findTagged(X, tag) {
  const F = X.F;
  for (const q of X.em.lists[1] ?? []) if (F.u16(q.P + 4) === (tag & 0xfff)) return q;
  return null;
}
// The value word of channel `idx` of particle q: (q +0x60 + desc(idx) +4). For a type 59 / 60 channel that word is its
// heap object (p.ext[slot]); anything else would be a float read as a pointer in the game: warned, taken as none.
function valueWord(X, q, idx) {
  const F = X.F, d = F.desc(q.P, idx);
  const obj = d ? q.ext?.[D.slot(F, d) / 4] : undefined;
  if (!obj) { warnOnce(X, `effects: type 59 / 60 link to particle tag ${F.u16(q.P + 4)} channel ${idx} (no object there) not translated`); return null; }
  return obj;
}

// ================================================================================================================
// Type 59, a path node. Data: +0 / +4 / +8 random ranges, s16 +0xc linked tag (< 0: none), s16 +0xe linked channel,
// u8 +0x1c relative flag (-> obj +0x20), u8 +0x1d point mode (0: the particle's origin), u8 +0x1e random kind,
// u8 +0x1f link kind (!= 0: FUN_0028f790).
// FUN_0028f4d8(obj, data): obj +0x10 = a point through the CURRENT particle's matrix (mgr +0xa8 -> +0x50 = p.m50):
// +0x1d == 0: FUN_002d8578(M, 0x49cf00 = (0, 0, 0, 0)) = the matrix's row 3; else +0x1e: 0 = three FUN_002d98c8
// (signed) draws of +0 / +4 / +8, 1 = three FUN_002d9938 (unit) draws, 2 = three negated unit draws (x, y, z order),
// w 1, through FUN_002d8578; other kinds write nothing. (The w == 1 checks after it are FUN_002a8070 asserts.)
function nodePoint(X, obj, a) {
  const F = X.F, M = X.p.m50;
  if (!F.u8(a + 0x1d)) { obj.pt = xformVU(M, [0, 0, 0, 0]); return; }
  const k = F.u8(a + 0x1e);
  let v;
  if (k === 0) v = [lcgSigned(X, F.f32(a)), lcgSigned(X, F.f32(a + 4)), lcgSigned(X, F.f32(a + 8))];
  else if (k === 1) v = [lcgUnit(X, F.f32(a)), lcgUnit(X, F.f32(a + 4)), lcgUnit(X, F.f32(a + 8))];
  else if (k === 2) v = [-lcgUnit(X, F.f32(a)), -lcgUnit(X, F.f32(a + 4)), -lcgUnit(X, F.f32(a + 8))];
  else return;
  obj.pt = xformVU(M, [v[0], v[1], v[2], 1]);
}
// FUN_0028f3f0(mgr, data): the linked node (the value word of channel +0xe of the particle tagged +0xc), read once at init
function nodeLink(X, a) {
  const F = X.F;
  if (F.u8(a + 0x1f)) { warnOnce(X, 'effects: type 59 link kind +0x1f != 0 (FUN_0028f790) not translated: no link'); return null; }
  const tag = F.s16(a + 0xc);
  if (tag < 0) return null;
  const q = findTagged(X, tag);
  return q ? valueWord(X, q, F.s16(a + 0xe)) : null;
}
export const T59 = {
  // FUN_002d1970: obj = 0x30 bytes (FUN_002a7fd0); obj +0x24 = FUN_0028f3f0; FUN_0028f3b0(obj, data)
  init(X, a, o) {
    const obj = { pt: [0, 0, 0, 0], rel: 0, next: null };
    obj.next = nodeLink(X, a);
    T59.trans(X, 0, a, o, 0, obj);
    (X.p.ext ??= {})[o] = obj;
  },
  // FUN_002d1a10 -> FUN_0028f3b0(obj, data): FUN_0028f4d8, then obj +0x20 = (data +0x1c != 0)
  trans(X, t, a, o, old, obj = X.p.ext?.[o]) {
    if (!obj) return;
    nodePoint(X, obj, a);
    obj.rel = X.F.u8(a + 0x1c) ? 1 : 0;
  },
  // FUN_002d1a30: FUN_0028f4d8 unless mgr word 0 bit 0. L: that bit is clear in play (effects.js type 103 reads the
  // same word the same way)
  eval(X, t, a, o) { const obj = X.p.ext?.[o]; if (obj) nodePoint(X, obj, a); },
  loop() { return 1; },                                         // 0x2d1a60: returns 1
  // destroy FUN_002d19e8 (frees the object): the page lets the particle's p.ext go with it
};

// ================================================================================================================
// Type 60. A = the path (FUN_002895c0, 0xdc): +0x18 curve (A +0x1c, vtable 0x49b940: +0x24.. a vector of up to 8 node
// pointers), +0x8c / +0x90 helper objects, three point vectors of 16-byte points ((nodes + 1) x 0x10 entries each, from
// the mgr +0x1c pool): +0x94 {cap +0x98, end +0x9c, begin +0xa0} = the built path, +0xa8 {+0xac, +0xb0, +0xb4} = the
// kept path (+0xbd), +0xbc {+0xc0, +0xc4, +0xc8} = the drawn path; +0xd0 head length, +0xd4 tail length, +0xd8 rebuild
// counter. Points are relative to the particle's origin (m50 row 3). B = the draw side (FUN_0028b978, 0xa0): +4 mgr, +8 A,
// +0xc the colour channel (ref 0's value), +0x40 / +0x50 / +0x60 / +0x70 the eval's colours.
function makeA(X, a) {
  const F = X.F;
  if (F.u8(a + 0xc4)) { warnOnce(X, 'effects: type 60 curve 0x49b618 (data +0xc4 != 0) not translated'); return null; }
  if (F.u8(a + 0xc0)) { warnOnce(X, 'effects: type 60 helper FUN_00288b70 (data +0xc0 != 0) not translated'); return null; }
  if (F.u8(a + 0xbe)) { warnOnce(X, 'effects: type 60 helper FUN_0028b2d0 (data +0xbe != 0) not translated'); return null; }
  // FUN_0028b680 (curve init): the node object of channel s16 +0x8c of the particle tagged s16 +0x8a, then each obj +0x24
  // in turn (the vector holds 8; more is an FUN_002a8070 assert). Not found: 0 -> the A init fails.
  const tag = F.s16(a + 0x8a);
  if (tag < 0) return null;
  const q = findTagged(X, tag);
  let n = q ? valueWord(X, q, F.s16(a + 0x8c)) : null;
  if (!n) return null;
  const nodes = [];
  for (; n; n = n.next) { nodes.push(n); if (nodes.length > 64) break; }   // (a cycle would hang the game; guard)
  const A = { nodes, pts: [], kept: [], out: [], d0: 0, d4: 0, d8: 0 };
  resetOnWrap(X, A);                                             // FUN_002895c0's tail: FUN_00289c40
  return A;
}
// FUN_00289c40(A): when the particle has wrapped (+2 & 2) and FUN_002e95d0(mgr, particle, descriptor) == 0 (this channel's
// current keyframe entry starts at or before the first keyframe event: FUN_002e9570), the path restarts: +0xd0 = +0xd4 =
// 0, the kept and built paths emptied.
function resetOnWrap(X, A) {
  const F = X.F, p = X.p, P = p.P;
  if (!(p.flags & 2)) return;
  let idx = -1;
  for (let i = 0; i < F.u8(P + 8); i++) if (F.desc(P, i) === X.d) { idx = i; break; }
  const e = idx < 0 ? 0 : p.entry?.[idx];
  if (!e) return;                                                // FUN_002e95d0: no entry -> -1
  const t = F.s16(e + 4), n = F.u8(P + 0x21);
  let k = n - 1;                                                 // FUN_002e9570: the first event i with t <= its time
  for (let i = 0; i < n; i++) if (t <= F.s16(F.event(P, i))) { k = i; break; }
  if (k !== 0) return;
  A.d0 = 0; A.d4 = 0; A.kept = []; A.pts = [];
}
// FUN_0028ae28(dist, A, list, s, e, depth): midpoint displacement. mid = s + (e - s) x 0.5 (xyz; w = s.w), plus a random
// unit vector (three FUN_002d98c8(1.0), x y z, VRSQRT) x dist; recurse on (s, mid) with dist x 0.5, push mid, recurse on
// (mid, e). Pre-order draws.
function subdivide(X, dist, list, s, e, depth) {
  if (!depth) return;
  const h = scale4(sub4(e, s), f(0.5));
  const mid0 = addXYZ(s, h);
  const rv = [lcgSigned(X, 1), lcgSigned(X, 1), lcgSigned(X, 1), 1];
  const u = scale4(unitXYZ(rv), dist);
  const mid = addXYZ(mid0, u);
  const d2 = f(dist * f(0.5));
  subdivide(X, d2, list, s, mid, depth - 1);
  list.push(mid);
  subdivide(X, d2, list, mid, e, depth - 1);
}
// FUN_0028a740(A, data): rebuild the path. origin = FUN_002d8578(m50, (0, 0, 0, 1)); +0xc4 == 0 -> the path starts with
// (0, 0, 0, 1) (0x49cef0); per node (its point obj +0x10): s = prev - origin, e = node - origin (VSUB.xyz, w kept),
// FUN_0028ae28(|s - e| / data +0x5c, .., s, e, data +0xb6), push e; prev = the node's point (prev starts at origin).
function rebuild(X, A, a) {
  const F = X.F;
  const origin = xformVU(X.p.m50, [0, 0, 0, 1]);
  const pts = [[0, 0, 0, 1]];
  let prev = origin;
  for (const n of A.nodes) {
    if (n.rel === 1) { warnOnce(X, 'effects: type 60 relative node (type 59 data +0x1c) not translated: not drawn'); X.p.noDraw ??= 'type 60 relative node'; }
    if (F.u8(a + 0xb3)) { warnOnce(X, 'effects: type 60 fixed-length nodes (data +0xb3) not translated: not drawn'); X.p.noDraw ??= 'type 60 data +0xb3'; }
    const s = subXYZ(prev, origin), e = subXYZ(n.pt, origin);
    const L = vsqrt(dot3(subXYZ(s, e)));                         // VSUB.xyz vf31 = s - e
    subdivide(X, f(L / F.f32(a + 0x5c)), pts, s, e, F.u8(a + 0xb6));
    pts.push(e.slice());
    prev = n.pt;
  }
  A.pts = pts;
}
// FUN_0028a3d0(A, data): when to rebuild. Both paths empty -> rebuild. With +0xbb: the counter +0xd8 counts evals and
// rebuilds at +0xbc (then 0). The +0xbd branches (the kept path +0xa8 blended in by +0x68) are not translated.
function maybeRebuild(X, A, a) {
  const F = X.F;
  if (F.u8(a + 0xbd)) { warnOnce(X, 'effects: type 60 kept path (data +0xbd, FUN_0028a3d0) not translated: not drawn'); X.p.noDraw ??= 'type 60 data +0xbd'; return; }
  let go = !A.kept.length && !A.pts.length;
  if (F.u8(a + 0xbb)) { A.d8 = (A.d8 + 1) >>> 0; if (F.u8(a + 0xbc) <= A.d8) { A.d8 = 0; go = true; } }
  if (go) rebuild(X, A, a);
}
// FUN_00289dc8(A, data): the drawn path = the built path cut to [tail, head]: head +0xd0 += data +0x58; with +0xb4: +0xb5
// == 0 -> the tail +0xd4 follows at data +0x54 behind, else the head stops at +0x54. Walk the segments: cut points
// prev + unit(next - prev) x remaining (VSUB.xyzw, VRSQRT, x .xyzw, VADD.xyz).
function trim(A, a, F) {
  A.d0 = f(A.d0 + F.f32(a + 0x58));
  const b4 = F.u8(a + 0xb4), b5 = F.u8(a + 0xb5), cap = F.f32(a + 0x54);
  if (b4) {
    if (!b5) { if (cap < f(A.d0 - A.d4)) A.d4 = f(A.d0 - cap); }
    else A.d0 = A.d0 < cap ? A.d0 : cap;
  }
  const out = [], pts = A.pts;
  const e0 = !b4 || b5 || A.d4 <= 0;
  if (e0) out.push(pts[0].slice());
  let rem = A.d0, cut = A.d4;
  const cutAt = (prev, next, len) => addXYZ(prev, scale4(unitXYZ(sub4(next, prev)), len));
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1], next = pts[i];
    const L = vsqrt(dot3(subXYZ(next, prev)));
    rem = f(rem - L);
    let c9 = cut;
    if (!e0) {
      c9 = f(cut - L);
      if (c9 > 0) { cut = c9; continue; }
      if (0 < cut) out.push(cutAt(prev, next, f(c9 + L)));
    }
    if (rem <= 0) { out.push(cutAt(prev, next, f(rem + L))); break; }
    out.push(next.slice());
    cut = c9;
  }
  if (!out.length) out.push(pts[0].slice());
  A.out = out;
}
// FUN_0028e5a0(B, out, colour): out = clamp(channel colour (B +0xc) x (colour x 1/128), 0, 255) (VMUL.xyzw, VMAX / VMINI)
function colourOf(X, a) {
  const v = X.p.v, cs = D.refSlot(X.F, X.d, 0) / 4;
  return [0, 1, 2, 3].map(i => Math.min(255, Math.max(0, f(v[cs + i] * f(X.F.f32(a + 4 * i) * K128)))));
}

export const T60 = {
  // FUN_002d1638: value word 1 = A (FUN_002895c0), word 0 = B (FUN_0028b978). A failed init (no node found) makes the
  // game's FUN_002eb038 destroy the inited channels and drop the spawn: the page marks the particle skipped.
  init(X, a, o) {
    const A = makeA(X, a);
    if (!A) { X.p.skip ??= 'type 60 init failed (FUN_002d1638: no path node)'; return false; }
    // FUN_0028b978: B +0xc = the ref-0 channel's value (read live by colourOf); +0xb1 random widths (FUN_0028c318's
    // tables from FUN_002f3068) and +0xb7 texture (FUN_0028bbb0) not translated
    if (X.F.u8(a + 0xb1) || X.F.u8(a + 0xb2)) { warnOnce(X, 'effects: type 60 random / blended widths (data +0xb1 / +0xb2, FUN_0028c318) not translated: not drawn'); X.p.noDraw ??= 'type 60 data +0xb1'; }
    const B = { c40: [0, 0, 0, 0], c50: [0, 0, 0, 0], c60: [0, 0, 0, 0], c70: [0, 0, 0, 0] };
    (X.p.ext ??= {})[o] = { A, B };
    return true;
  },
  // FUN_002d1760 -> A vtable +0x14 (0x289c20) -> FUN_00289c40
  trans(X, t, a, o) { const R = X.p.ext?.[o]; if (R) resetOnWrap(X, R.A); },
  // FUN_002d1790: calls its own transition (vtable +0x14) with the new data; returns 1
  loop(X, t1, t2, a, o) { T60.trans(X, t2, a, o); return 1; },
  // FUN_002d17c0 -> FUN_0028bce0(B, data): A vtable +0x1c (FUN_00289ca8) unless mgr word 0 bit 0 (L: clear in play, as
  // type 59), FUN_0028c318 (+0xb1 == 0: returns), the colours +0x40 / +0x60 / +0x70 (FUN_0028e5a0 of data +0 / +0x10 /
  // +0x20), +0x50 = +0x40 with w = 0
  eval(X, t, a, o) {
    const R = X.p.ext?.[o];
    if (!R) return;
    const { A, B } = R, F = X.F;
    // FUN_00289ca8: FUN_0028a3d0, FUN_00289dc8; then the +0x90 / +0x8c helpers' +0x14 (0x28b268 / 0x28b218: jr ra)
    maybeRebuild(X, A, a);
    if (A.pts.length) trim(A, a, F);
    B.c40 = colourOf(X, a);
    B.c60 = colourOf(X, a + 0x10);
    B.c70 = colourOf(X, a + 0x20);
    B.c50 = [B.c40[0], B.c40[1], B.c40[2], 0];
  },
  draw: drawRibbon,
  // destroy FUN_002d1708 (FUN_0028bb20(B, 3), A vtable +0xc): the page lets p.ext go with the particle
};

// ---- draw ------------------------------------------------------------------------------------------------------
// FUN_002e3708(1.0, mgr, particle, m50, the type 14 bytes 0 / 1 / 2, out): mode = byte 1. 0: (m50 . S(1)) . E . V;
// 1: rows 0-2 x the emitter scale (+0xa0), row 3 = (row 3 . E) . V; 2 not translated. E = the emitter matrix +0xe0
// (particle +0x1c's +0x54 for categories 2 / 6-9: effects.js does not draw those). Same as effects.js's viewMatrix
// (FUN_002e3498).
function ribbonMatrix(X, mode, view) {
  const em = X.em;
  let o = mul33(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), X.p.m50);   // FUN_002d84c0(1.0), FUN_002d83e0
  if (mode === 0) {
    if (!view.toViewMatrix) { warnOnce(X, 'effects: type 60 world-oriented draw needs view.toViewMatrix'); return null; }
    return mul44(view.toViewMatrix(), mul44(em.m, o));          // FUN_002d8368 x 2: . E, . V (0x70003e00)
  }
  if (mode === 1) {
    for (let r = 0; r < 3; r++) for (let j = 0; j < 4; j++) o[4 * r + j] = f(o[4 * r + j] * em.scale[r]);
    const t = view.toView(xformVU(em.m, [o[12], o[13], o[14], 1]));
    o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
    return o;
  }
  warnOnce(X, `effects: type 60 matrix mode ${mode} (FUN_002e3708) not translated: not drawn`);
  return null;
}
// FUN_002a7ec0(w1, w2, r0, r1, r2, r3, prev, next, cur): the four edge points at cur. d = next - prev; a = |vf7 - cur|
// (VSUB.xyzw then VABS.xyzw: vf7 is NOT set here, see EYE); n = |d x a| (VOPMULA / VOPMSUB .xyz, w = 0, then VABS
// .xyzw); when |unit(d) . unit(a)| (VABS) > 0.9 both widths x (1 - dot) x 9.999998; r0 / r1 = cur -/+ unit(n) x w1,
// r2 / r3 = cur -/+ unit(n) x w2 (VMULx.xyzw, VSUB / VADD .xyzw).
function edges(w1, w2, prev, next, cur, eye) {
  const d = sub4(next, prev);
  const a = sub4(eye, cur).map(x => Math.abs(x));
  const qd = vrsqrt(dot3(d));
  const n = [f(f(d[1] * a[2]) - f(a[1] * d[2])), f(f(d[2] * a[0]) - f(a[2] * d[0])), f(f(d[0] * a[1]) - f(a[0] * d[1])), 0].map(x => Math.abs(x));
  const ud = [f(d[0] * qd), f(d[1] * qd), f(d[2] * qd)];
  const qa = vrsqrt(dot3(a));
  const ua = [f(a[0] * qa), f(a[1] * qa), f(a[2] * qa)];
  const dt = Math.abs(f(f(f(ua[0] * ud[0]) + f(ua[1] * ud[1])) + f(ua[2] * ud[2])));
  if (K09 < dt) { const k = f(f(1 - dt) * K10); w2 = f(w2 * k); w1 = f(w1 * k); }
  const un = unitXYZ(n);                                          // VRSQRT of |n|^2, VMULq.xyz, w 0
  const o1 = un.map(x => f(x * w1)), o2 = un.map(x => f(x * w2));
  return [sub4(cur, o1), [0, 1, 2, 3].map(i => f(cur[i] + o1[i])), sub4(cur, o2), [0, 1, 2, 3].map(i => f(cur[i] + o2[i]))];
}
// The eye FUN_002a7ec0 reads from vf7: no function on the draw path writes vf7 before it (FUN_002d17e0, FUN_002e3708,
// FUN_002d8578, FUN_0028bd90, FUN_0028d9b8, FUN_0028dc08), so it holds what the last VU0 code left. The vertex emitter
// FUN_00282e68 loads the screen matrix's row 3 into vf7 for every vertex, so after any draw of this primitive library
// vf7 = (0, 0, zA, 0) (screen matrix row 3; zA = 16777256 for camera 0).
// GUESS: vf7 at the beam's FUN_0028dc08 = that row (not decoded: other VU0 code between two draws may load vf7; see
// notes/ribbon-research.md "vf7"). Settable for tests: RIBBON.eye = [x, y, z, w].
export const RIBBON = { eye: null };
// FUN_0028dc08(B, rows, data), +0xb1 == 0: w1 = data +0x3c x 0.5, w2 = data +0x40 x 0.5; FUN_002a7ec0 at point 0 with
// (prev, next) = (p0, p1), at i = 1..n-2 with (p[i-1], p[i+1]), at n-1 with (p[n-2], p[n-1]).
function rowsOf(F, a, P, eye) {
  const w1 = f(F.f32(a + 0x3c) * f(0.5)), w2 = f(F.f32(a + 0x40) * f(0.5)), n = P.length;
  const rows = [[], [], [], []];
  const put = r => r.forEach((q, k) => rows[k].push(q));
  put(edges(w1, w2, P[0], P[1], P[0], eye));
  for (let i = 1; i < n - 1; i++) put(edges(w1, w2, P[i - 1], P[i + 1], P[i], eye));
  put(edges(w1, w2, P[n - 2], P[n - 1], P[n - 1], eye));
  return rows;
}
// FUN_0028c9c8(B, caps, data, rowA, rowB, points): the strip's end caps. caps[0] = p[0], caps[3] = p[n-1];
// caps[1] = A0 + unit(A1 - A0) x (|A0 - A1| x data +0x64), caps[2] the same on B; caps[4] = A[n-1] + unit(A[n-2] -
// A[n-1]) x (|A[n-2] - A[n-1]| x +0x64), caps[5] the same on B (VADD.xyz: w of the row point)
function caps(F, a, A, B, P) {
  const k = F.f32(a + 0x64), n = A.length;
  const cap = (p0, p1) => addXYZ(p0, scale4(unitXYZ(sub4(p1, p0)), f(vsqrt(dot3(subXYZ(p0, p1))) * k)));
  return [P[0].slice(), cap(A[0], A[1]), cap(B[0], B[1]), P[n - 1].slice(), cap(A[n - 1], A[n - 2]), cap(B[n - 1], B[n - 2])];
}
// VCLIP.xyz v, v.w: the six "outside" flags of one vertex
const clipFlags = c => { const w = Math.abs(c[3]); return (c[0] > w) | ((c[0] < -w) << 1) | ((c[1] > w) << 2) | ((c[1] < -w) << 3) | ((c[2] > w) << 4) | ((c[2] < -w) << 5); };
// FUN_00281f30's matrices: ctx +0x10 = I . S (S = *0x70003e04, the view -> screen matrix: rows (fx 0 0 0) (0 fy 0 0)
// (cx cy zB 1) (0 0 zA 0), MEASURED r03_key2 scratchpad 0x70003f80, = effects.js PROJ); ctx +0x70 = the clip matrix
// from the emitter's camera (DAT_0050b4f8[em +1]): n = +0x28, fr = +0x2c, k = n x 1024 / +0x30 (fx): m00 = m11 =
// 2n / 2k, m22 = (fr + n) / (fr - n), m23 = 1, m32 = (fr x n x -2) / (fr - n), m33 = 0 (FUN_00444d30 identity, then
// FUN_00444a40(.., I)).
function screenM(proj) {
  return new Float32Array([proj.fx, 0, 0, 0, 0, proj.fy, 0, 0, proj.cx, proj.cy, proj.zB, 1, 0, 0, proj.zA, 0].map(f));
}
function clipM(proj) {
  const n = f(proj.near ?? NEAR0), fr = f(proj.far ?? FAR0), k = f(f(n * 1024) / f(proj.fx));
  const m = new Float32Array(16);
  m[0] = m[5] = f(f(n + n) / f(k + k));
  m[10] = f(f(fr + n) / f(fr - n)); m[11] = 1;
  m[14] = f(f(f(fr * n) * -2) / f(fr - n)); m[15] = 0;
  return m;
}
// FUN_00282fa8(ctx, p, colour) + FUN_00282e68: RGBAQ = VFTOI0(colour x ctx +0x50 (the emitter colour +0xb0)); XYZ2 =
// S . (p, 1), Q = 1 / w (VDIV), x y z x Q, VFTOI4 x y, VFTOI0 z; ADC (bit 15 of the 4th word) = any VCLIP flag of this
// vertex or the previous two (CF & 0x3ffff) of ctx +0x70 . p. A packet holds 190 vertices before FUN_00281d78 flushes
// it (the strip continues: GIF tag PRE 0); the beam's strips stay far below that.
function vertex(p, col, emCol, S, C) {
  const s = xformVU(S, [p[0], p[1], p[2], 1]);
  const q = f(1 / s[3]);
  const X = f(s[0] * q), Y = f(s[1] * q), Z = f(s[2] * q);
  const c = xformVU(C, p);                                        // VMADDw by p.w: the beam's points all have w = 1
  const rgba = [0, 1, 2, 3].map(i => Math.trunc(f(col[i] * emCol[i])) & 0xff);
  return { pos: [p[0], p[1], p[2]], uv: [0, 0], rgba, gs: [Math.trunc(X * 16) / 16, Math.trunc(Y * 16) / 16, Math.trunc(Z)], clip: clipFlags(c) };
}
// FUN_0028cf78(B, data, ctx, rowA, rowB, points, colA, colB): one strip: caps[0] (colour data +0x20, as read: not the
// particle-coloured B +0x70), caps[1] (colA), caps[2] (colB), rowA[i] / rowB[i] for i = 1..n-2, caps[4] (colA), caps[5]
// (colB), caps[3] (B +0x70); then FUN_00281e88 flushes it as its own GIF packet (PRE 1: the strip starts afresh).
function strip(X, a, A, B, P, colA, colB, B70, S, C, alpha, out, idx) {
  const F = X.F, em = X.em, c = caps(F, a, A, B, P), n = P.length;
  const raw = [F.f32(a + 0x20), F.f32(a + 0x24), F.f32(a + 0x28), F.f32(a + 0x2c)];
  const seq = [[c[0], raw], [c[1], colA], [c[2], colB]];
  for (let i = 1; i < n - 1; i++) seq.push([A[i], colA], [B[i], colB]);
  seq.push([c[4], colA], [c[5], colB], [c[3], B70]);
  const vs = seq.map(([p, col]) => vertex(p, col, em.col, S, C));
  for (let k = 2; k < vs.length; k++) {
    if (vs[k].clip | vs[k - 1].clip | vs[k - 2].clip) continue;  // ADC set: the GS does not draw this triangle
    const verts = [vs[k - 2], vs[k - 1], vs[k]].map(({ pos, uv, rgba, gs }) => ({ pos, uv, rgba, gs }));
    out.push({ verts, tex: null, untextured: true, alpha, emitter: em.ei, id: em.id, type: 60, tag: X.p.tag, strip: idx, prim: 0x4c });
  }
}
// FUN_002d17e0: M = FUN_002e3708(1.0, .., the type 14 channel's bytes (descriptor ref 4)), FUN_0028bd90(B, data, M):
// A vtable +0x24 (0x28b1a8: the built path's count) != 0, the drawn path (0x28b090) has >= 2 points; each through M
// (FUN_002d8578) into the scratch +0x40 list; data +0xb0 == 0 -> FUN_0028d678, +0x40 == 0 -> FUN_0028d7d0, else
// FUN_0028d9b8: +0xb7 == 0 -> FUN_0028dc08 (rows), FUN_0028e608 (COLCLAMP 1, ALPHA FUN_00284d30(FUN_00284e20(+0xba,
// 0, 1, 2))), FUN_00281f30, three FUN_0028cf78: (rows 2, 3; B +0x60, B +0x60), (rows 0, 2; B +0x50, B +0x40),
// (rows 3, 1; B +0x40, B +0x50), FUN_0028e670 (ALPHA back to 0x49b280's 0x44), FUN_00281ee0.
function drawRibbon(X, a, o, view, out, tex, proj) {
  const F = X.F, p = X.p, R = p.ext?.[o];
  if (!R) return;
  const { A, B } = R;
  if (!A.pts.length || A.out.length < 2) return;
  if (!F.u8(a + 0xb0)) { warnOnce(X, 'effects: type 60 draw FUN_0028d678 (data +0xb0 == 0) not translated: not drawn'); return; }
  if (F.f32(a + 0x40) === 0) { warnOnce(X, 'effects: type 60 draw FUN_0028d7d0 (data +0x40 == 0) not translated: not drawn'); return; }
  if (F.u8(a + 0xb7)) { warnOnce(X, 'effects: type 60 textured draw (data +0xb7, FUN_0028d180 / FUN_0028e6a8) not translated: not drawn'); return; }
  const m14 = p.data[D.ref(F, X.d, 4)];
  const M = ribbonMatrix(X, F.u8(m14 + 1), view);
  if (!M) return;
  const P = A.out.map(q => xformVU(M, q));
  const S = screenM(proj), C = clipM(proj);
  const eye = RIBBON.eye ?? [S[12], S[13], S[14], S[15]];
  const rows = rowsOf(F, a, P, eye);
  const v = F.u8(a + 0xba), alpha = ALPHA_ABC[v <= 2 ? v : 0];
  strip(X, a, rows[2], rows[3], P, B.c60, B.c60, B.c70, S, C, alpha, out, 0);
  strip(X, a, rows[0], rows[2], P, B.c50, B.c40, B.c70, S, C, alpha, out, 1);
  strip(X, a, rows[3], rows[1], P, B.c40, B.c50, B.c70, S, C, alpha, out, 2);
}

// for the self-checks
export const _internals = { subdivide, rebuild, trim, edges, rowsOf, caps, vertex, screenM, clipM, xformVU, ribbonMatrix, findTagged };
