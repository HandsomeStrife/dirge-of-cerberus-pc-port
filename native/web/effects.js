// effects.js - the game's particle / effect engine (FED), translated. Worker 0179.
// notes/effects-research.md has the decode; every function cites its game address.
//
// Data (gitignored, from the user's disc): python3 -I native/assets/models/export_web_effects.py
//   data/effects/r0001.fed    the resident FED, FileCode 0x40000 (wall impacts, hits on Vincent)
//   data/effects/core_ef.bin  the effect texture pack resident in GS memory
//
// API
//   const fx = createEffects({ fed, core, warn })     fed / core: ArrayBuffer
//   fx.spawn(id, pos)          FUN_002e6290(0, 0x4ee2e0, id) + FUN_002e7660(flag 1, pos): an effect
//                              id (e.g. 0x43400) at a game-world point; returns the emitter or null
//   fx.begin(step), fx.end()   one game frame, split around the game logic as FUN_00248110 does:
//                              begin = FUN_002efc78 + FUN_002efe00, end = FUN_002efe98 (spawn between them)
//   fx.update(step)            begin + end (no spawns in between)
//   fx.sprites(view)           the draw pass (FUN_002e20f0 -> FUN_002eadc0 draw lists): a list of quads
//                              in game VIEW space; view = { toView(p) -> [x,y,z] game view space }
//   new EffectLayer(THREE, fx) a three.js group (layer.group) that draws fx.sprites(): layer.update(camera)
//                              once per game frame after fx.end(), with THIS game frame's camera (play.js fxCamera)
//
// Faithful parts: spawn, emitter / particle life, the spawn timeline, keyframe events, the channel
// types 1 2 4 7 9 14 15 16 17 22 23 24 (init / transition / eval), the sprite draw type 10 with its
// billboard / depth matrices (FUN_002e3498 / FUN_002e3948) and the VU1 sprite program at MSCAL 4
// (micro memory instr 298-531: corners, ST, colour x near fade, guard-band culling).
// Not on the page (warned once, listed in notes/fidelity-audit.md): draw types 11 / 21 / 100 / 137,
// channel types 3 / 5 / 6 / 8 / 26, render categories other than 0 / 1, rotation orders 1-5, emitter
// param +0x1d != 0, the emitter fade (those are simulated but not drawn), the emitter frustum cull
// (FUN_002da928), the draw buckets (FUN_002e1d88: depth-sorted order), looping particles.

const f = Math.fround;
const ANG = f(11.377778);          // FUN_00275850: degrees x 11.377778 = 4096 units per turn
const PCT = f(0.01);               // FUN_002760d8: scale percent x 0.01

// ---------------------------------------------------------------------------------------------
// Sine table: FUN_002f2740 fills DAT_004ee9a0[4096] at boot with sinf(i * 3.141592 / 2048), the
// argument wrapped by 6.283184 past 3.141592. L: libm sinf (FUN_0045b530) is Math.sin rounded to
// float (max 8.5e-7 from the game's table, read from the z128 save state).
const SIN = new Float32Array(4096);
for (let i = 0; i < 4096; i++) {
  let a = f(f(f(i) * f(3.141592)) / 2048);
  if (f(3.141592) < a) a = f(a - f(6.283184));
  SIN[i] = f(Math.sin(a));
}
// FUN_002d7c90 / 7d80 / 7e80: angle (4096 = turn) truncated to int (cvt.w.s), index & 0xfff,
// cos = table[+0x400]. Row-vector matrices, out = in . R.
function sincos(a) { const i = (Math.trunc(a) * 4) & 0x3ffc; return [SIN[i >> 2], SIN[((i + 0x1000) & 0x3ffc) >> 2]]; }
// 4x4 matrices: Float32Array(16), row r at [4r .. 4r+3] (the game stores rows as qwords)
const ident = () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
function mul44(a, b) {                       // FUN_002d8368(out, A, B): out = B . A (B first)
  const o = new Float32Array(16);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++)
    o[4 * i + j] = f(f(f(b[4 * i] * a[j]) + f(b[4 * i + 1] * a[4 + j])) + f(f(b[4 * i + 2] * a[8 + j]) + f(b[4 * i + 3] * a[12 + j])));
  return o;
}
function mul33(a, b) {                       // FUN_002d83e0(out, A, B): 3x3 out = B . A, row 3 = B row 3
  const o = new Float32Array(16);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++)
    o[4 * i + j] = f(f(f(b[4 * i] * a[j]) + f(b[4 * i + 1] * a[4 + j])) + f(b[4 * i + 2] * a[8 + j]));
  for (let j = 0; j < 4; j++) o[12 + j] = b[12 + j];
  return o;
}
function xform(m, v) {                       // FUN_002d8578(out, M, v): v . M with w = 1
  const o = [0, 0, 0, 0];
  for (let j = 0; j < 4; j++) o[j] = f(f(f(v[0] * m[j]) + f(v[1] * m[4 + j])) + f(f(v[2] * m[8 + j]) + m[12 + j]));
  return o;
}
function rotX(m, a) { const [s, c] = sincos(a); return mul44(new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, f(-s), c, 0, 0, 0, 0, 1]), m); }
function rotY(m, a) { const [s, c] = sincos(a); return mul44(new Float32Array([c, 0, f(-s), 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]), m); }
function rotZ(m, a) { const [s, c] = sincos(a); return mul44(new Float32Array([c, s, 0, 0, f(-s), c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]), m); }
function scaleM(v) { const m = new Float32Array(16); m[0] = v[0]; m[5] = v[1]; m[10] = v[2]; m[15] = 1; return m; }   // FUN_002d84f0
// FUN_002d82d0(out, in, rot, pos, order): jump table 0x49f4c0; order 0 = FUN_002d7ff0: Z, then Y,
// then X (FUN_002d7e80 / 7d80 / 7c90), then FUN_002d7fc0 adds pos to row 3. Orders 1-5 (FUN_002d8060 /
// 80d0 / 8150 / 81d0 / 8250) are not translated: null (the caller does not draw; notes/effects-research.md).
function eulerT(m, rot, pos, order) {
  if (order !== 0) return null;
  let o = rotZ(m, rot[2]); o = rotY(o, rot[1]); o = rotX(o, rot[0]);
  o[12] = f(o[12] + pos[0]); o[13] = f(o[13] + pos[1]); o[14] = f(o[14] + pos[2]);
  return o;
}

// ---------------------------------------------------------------------------------------------
// The two effect RNGs (neither is the shared twister; T: w173_rng draws nothing between an
// impact's wall sound and its decal draws).
// FUN_002d98c8 / FUN_002d9938: LCG DAT_004e9400 = s * 0x41c64e6d + 0x3039.
//   98c8: ((s & 0x7fff) - 0x4000) x 6.10351e-05 (0x387fffd5) x r   -> [-r, r)
//   9938: (s & 0x7fff) x 3.05176e-05 (0x37fffec2) x r              -> [0, r)
// FUN_002d9880: VU0 R (VRNEXT, then VRINIT with r.w - 1.88725); used only by type 10 flips.
const bitsF = u => new Float32Array(new Uint32Array([u]).buffer)[0];
const K98C8 = bitsF(0x387fffd5), K9938 = bitsF(0x37fffec2);
export class EffectRng {
  constructor(lcg = 0xdf887fd0, r = 0x3f800000) { this.s = lcg >>> 0; this.R = r >>> 0; }   // lcg: DAT_004e9400 in the z128 save state
  next() { this.s = (Math.imul(this.s, 0x41c64e6d) + 0x3039) >>> 0; return this.s; }
  signed(r) { const v = (this.next() & 0x7fff) - 0x4000; return f(f(v * K98C8) * f(r)); }
  unit(r) { const v = this.next() & 0x7fff; return f(f(v * K9938) * f(r)); }
  // GUESS: the VU0 R register's value at load (not in EE RAM); only the type 10 flip modes use it
  vrInt(n) {                                                  // FUN_002d9880(n)
    const x = (this.R >>> 4) & 1, y = (this.R >>> 22) & 1;    // PCSX2 AdvanceLFSR
    this.R = ((((this.R << 1) ^ x ^ y) & 0x7fffff) | 0x3f800000) >>> 0;
    const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, this.R, true);
    const r = b.getFloat32(0, true);
    const w = f(r - f(1.88725)); b.setFloat32(0, w, true);
    this.R = ((b.getUint32(0, true) & 0x7fffff) | 0x3f800000) >>> 0;   // VRINIT R, vf25w
    return Math.trunc(f(f(r - 1) * f(n)));
  }
}

// ---------------------------------------------------------------------------------------------
// FED reader. Offsets in the file are relative to their container (FUN_002e4418): the header's
// table offsets to the file, a table slot to the table, a pointer inside a record to the record.
export function parseFed(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x08444546) throw new Error('effects: not a FED v8');
  const u8 = o => dv.getUint8(o), u16 = o => dv.getUint16(o, true), s16 = o => dv.getInt16(o, true);
  const u32 = o => dv.getUint32(o, true), s32 = o => dv.getInt32(o, true), f32 = o => dv.getFloat32(o, true);
  const code = u32(4);
  const tA = u32(0x60), tE = u32(0x64), t70 = u32(0x70);
  const nA = u16(0x40), nE = u16(0x42), n70 = u16(0x48);
  const rec = (base, slot) => (slot ? base + slot : 0);
  return {
    dv, u8, u16, s16, u32, s32, f32, code,
    // table A (FUN_002e62b0): record +6 count, +8 emitter index, +0x20 param records
    groupOf(i) { return i < nA ? rec(tA, u32(tA + 4 * i)) : 0; },
    emitter(i) { return i < nE ? rec(tE, u32(tE + 4 * i)) : 0; },
    anim(i) { return i >= 0 && i < n70 ? rec(t70, u32(t70 + 4 * i)) : 0; },
    // E: +0x10 schedule (entries rel E), +0x14 particle defs (entries rel E)
    sched(E, k) { const a = E + u32(E + 0x10); return rec(E, u32(a + 4 * k)); },
    part(E, k) { const a = E + u32(E + 0x14); return rec(E, u32(a + 4 * k)); },
    // P: +0x0c descriptors (entries rel P), +0x30.. lists (rel P)
    desc(P, i) { const a = P + u32(P + 0xc); return rec(P, u32(a + 4 * i)); },
    list(P, k) { return P + u32(P + 0x30 + 4 * k); },
    event(P, k) { const a = P + u32(P + 0x34); return rec(P, u32(a + 4 * k)); },
  };
}
// Descriptor: u16 type, u8 nref (+2; FUN_00273f40 reads a byte), u16 out slot (+4), u16 ref channel[nref], u16 ref slot[nref]
const D = {
  type: (F, d) => F.u16(d), nref: (F, d) => F.u8(d + 2), slot: (F, d) => F.u16(d + 4),
  ref: (F, d, k) => F.u16(d + 6 + 2 * k), refSlot: (F, d, k) => F.u16(d + 6 + 2 * (F.u8(d + 2) + k)),
};

// ---------------------------------------------------------------------------------------------
// Effect texture pack (core_ef.bin; layout MEASURED, see export_web_effects.py): TEX0 -> RGBA8
// image of 2^TW x 2^TH texels (the GS ST space), alpha kept raw (0..0x80).
export function parseCore(buf) {
  const dv = new DataView(buf), out = new Map();
  let off = 0x7bf0;
  for (let k = 0; k < 27; k++) {
    const o = 0x70 + 0x20 * k;
    const lo = dv.getUint32(o, true), hi = dv.getUint32(o + 4, true);
    const w = dv.getUint16(o + 0xc, true), h = dv.getUint16(o + 0xe, true), size = dv.getUint32(o + 0x10, true);
    const tw = (lo >>> 26) & 0xf, th = ((lo >>> 30) | (hi << 2)) & 0xf;
    const W = 1 << tw, H = 1 << th;
    // CLUT k: 256 x CT32 in CSM1 storage order (entries 8-15 and 16-23 of every 32 swapped)
    const clut = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      const j = (i & 0xe7) | ((i & 0x08) << 1) | ((i & 0x10) >> 1);
      clut[i] = dv.getUint32(0xf80 + 0x400 * k + 4 * j, true);
    }
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < Math.min(h, H); y++) for (let x = 0; x < Math.min(w, W); x++) {
      const c = clut[dv.getUint8(off + y * w + x)], p = 4 * (y * W + x);
      rgba[p] = c & 0xff; rgba[p + 1] = (c >>> 8) & 0xff; rgba[p + 2] = (c >>> 16) & 0xff; rgba[p + 3] = c >>> 24;
    }
    out.set(`${hi.toString(16)}:${lo.toString(16)}`, { k, W, H, rgba, tex0: [lo, hi] });
    off += size;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Channel evaluators (DAT_0046c398[type] -> vtable; slot +0xc init, +0x14 transition, +0x1c eval,
// +0x24 draw, +0x3c once). Each gets the context X = { F, em, p, d (descriptor), rng, warn } plus
// the data offset and the out slot (an index into p.v, the particle's value region at +0x60).
// v[o..o+3] is the current value, v[o+4..] the base / rate / acceleration the type keeps.
function rd4(F, a) { return [F.f32(a), F.f32(a + 4), F.f32(a + 8), F.f32(a + 12)]; }
function put(v, o, a) { for (let i = 0; i < a.length; i++) v[o + i] = a[i]; }
// The spawn parameter (mgr+0xb4) is always 0 here (FUN_002e8ea8 param_6 = 0 from the timeline).
const T = {};
// type 1 position: FUN_00274430 init, FUN_00274488 transition
T[1] = {
  init(X, a, o) { const v = X.p.v; put(v, o + 4, rd4(X.F, a)); put(v, o, v.slice(o + 4, o + 8)); },
  trans(X, t, a, o, old) {
    const F = X.F, v = X.p.v;
    for (let i = 0; i < 3; i++) v[o + 4 + i] = f(F.f32(a + 4 * i) + f(v[o + 4 + i] - F.f32(old + 4 * i)));
    put(v, o, v.slice(o + 4, o + 8));
  },
};
// type 2 position + velocity: FUN_00274748 init, FUN_002747e0 transition, FUN_00274920 eval
T[2] = {
  init(X, a, o) { const v = X.p.v; put(v, o + 4, rd4(X.F, a)); put(v, o + 8, rd4(X.F, a + 16)); put(v, o, v.slice(o + 4, o + 8)); },
  trans(X, t, a, o, old) {
    const F = X.F, v = X.p.v;
    for (let i = 0; i < 3; i++) {
      const pn = f(f(v[o + 8 + i] * t) + v[o + 4 + i]), po = f(f(F.f32(old + 16 + 4 * i) * t) + F.f32(old + 4 * i));
      v[o + 4 + i] = f(F.f32(a + 4 * i) + f(pn - po));
    }
    for (let i = 0; i < 3; i++) v[o + 8 + i] = f(F.f32(a + 16 + 4 * i) + f(v[o + 8 + i] - F.f32(old + 16 + 4 * i)));
    put(v, o, v.slice(o + 4, o + 8));
  },
  eval(X, t, a, o) { const v = X.p.v; for (let i = 0; i < 4; i++) v[o + i] = f(v[o + 4 + i] + f(v[o + 8 + i] * t)); },
};
// type 4 rotation (degrees -> 4096 units): FUN_00275850 init, FUN_002758d0 transition
T[4] = {
  init(X, a, o) { const v = X.p.v; put(v, o + 4, rd4(X.F, a)); for (let i = 0; i < 3; i++) v[o + i] = f(v[o + 4 + i] * ANG); },
  trans(X, t, a, o, old) {
    const F = X.F, v = X.p.v;
    for (let i = 0; i < 3; i++) { v[o + 4 + i] = f(F.f32(a + 4 * i) + f(v[o + 4 + i] - F.f32(old + 4 * i))); v[o + i] = f(v[o + 4 + i] * ANG); }
  },
};
// type 7 scale (percent): FUN_002760d8 init, FUN_00276158 transition
T[7] = {
  init(X, a, o) { const v = X.p.v; put(v, o + 4, rd4(X.F, a)); for (let i = 0; i < 3; i++) v[o + i] = f(v[o + 4 + i] * PCT); },
  trans(X, t, a, o, old) {
    const F = X.F, v = X.p.v;
    for (let i = 0; i < 3; i++) { v[o + 4 + i] = f(F.f32(a + 4 * i) + f(v[o + 4 + i] - F.f32(old + 4 * i))); v[o + i] = f(v[o + 4 + i] * PCT); }
  },
};
// quadratic base / rate / acceleration (rows +0x10/+0x20/+0x30): FUN_002ecf18 transition, lanes x y z
// (type 9), FUN_002eccc8 the same over lanes x y z w (type 17)
function quadTrans(X, t, a, o, old, lanes = 3) {
  const F = X.F, v = X.p.v, h = f(f(t * t) * 0.5);
  const L = [...Array(lanes).keys()];
  const n = L.map(i => [F.f32(a + 4 * i), F.f32(a + 16 + 4 * i), F.f32(a + 32 + 4 * i)]);
  const q = L.map(i => [F.f32(old + 4 * i), F.f32(old + 16 + 4 * i), F.f32(old + 32 + 4 * i)]);
  for (let i = 0; i < lanes; i++) {
    const p0 = v[o + 4 + i], v0 = v[o + 8 + i], a0 = v[o + 12 + i];
    v[o + 4 + i] = f(n[i][0] + f(f(f(f(a0 * h) + f(v0 * t)) + p0) - f(f(f(q[i][2] * h) + f(q[i][1] * t)) + q[i][0])));
    v[o + 8 + i] = f(n[i][1] + f(f(f(a0 * t) + v0) - f(f(q[i][2] * t) + q[i][1])));
    v[o + 12 + i] = f(n[i][2] + f(a0 - q[i][2]));
  }
}
function quadEval(v, o, t, k) {             // FUN_00276360 (k = 0.01) / FUN_00272348 (k = 1): (b + r t + a t^2 / 2) k
  const t2 = f(t * t);
  for (let i = 0; i < 4; i++) {
    const x = f(f(v[o + 4 + i] + f(v[o + 8 + i] * t)) + f(f(v[o + 12 + i] * 0.5) * t2));
    v[o + i] = k === 1 ? x : f(x * k);
  }
}
// type 9 scale, quadratic: FUN_00276200 init, FUN_00276300 transition, FUN_00276360 eval
T[9] = {
  init(X, a, o) { const v = X.p.v; put(v, o + 4, rd4(X.F, a)); put(v, o + 8, rd4(X.F, a + 16)); put(v, o + 12, rd4(X.F, a + 32)); for (let i = 0; i < 3; i++) v[o + i] = f(v[o + 4 + i] * PCT); },
  trans(X, t, a, o, old) { quadTrans(X, t, a, o, old); const v = X.p.v; for (let i = 0; i < 3; i++) v[o + i] = f(v[o + 4 + i] * PCT); },
  eval(X, t, a, o) { quadEval(X.p.v, o, t, PCT); },
};
// type 15 colour: FUN_00272188 init, FUN_002721e0 transition
T[15] = {
  init(X, a, o) { const v = X.p.v; put(v, o + 4, rd4(X.F, a)); put(v, o, v.slice(o + 4, o + 8)); },
  trans(X, t, a, o, old) {
    const F = X.F, v = X.p.v;
    for (let i = 0; i < 3; i++) v[o + 4 + i] = f(F.f32(a + 4 * i) + f(v[o + 4 + i] - F.f32(old + 4 * i)));
    put(v, o, v.slice(o + 4, o + 8));
  },
};
// type 16 colour, linear: FUN_00272410 init, FUN_002724a8 transition, FUN_002725c8 eval
T[16] = {
  init(X, a, o) { const v = X.p.v; put(v, o + 4, rd4(X.F, a)); put(v, o + 8, rd4(X.F, a + 16)); put(v, o, v.slice(o + 4, o + 8)); },
  trans(X, t, a, o, old) {
    const F = X.F, v = X.p.v;
    for (let i = 0; i < 4; i++) {
      const pn = f(f(v[o + 8 + i] * t) + v[o + 4 + i]), po = f(f(F.f32(old + 16 + 4 * i) * t) + F.f32(old + 4 * i));
      v[o + 4 + i] = f(F.f32(a + 4 * i) + f(pn - po));
    }
    for (let i = 0; i < 4; i++) v[o + 8 + i] = f(F.f32(a + 16 + 4 * i) + f(v[o + 8 + i] - F.f32(old + 16 + 4 * i)));
    put(v, o, v.slice(o + 4, o + 8));
  },
  eval(X, t, a, o) { const v = X.p.v; for (let i = 0; i < 4; i++) v[o + i] = f(v[o + 4 + i] + f(v[o + 8 + i] * t)); },
};
// type 17 colour, quadratic: FUN_00272248 init, FUN_00272320 -> FUN_002eccc8 transition, FUN_00272348 eval
// (no captured effect uses type 17: translated from the decomp, unchecked)
T[17] = {
  init(X, a, o) { const v = X.p.v; put(v, o + 4, rd4(X.F, a)); put(v, o + 8, rd4(X.F, a + 16)); put(v, o + 12, rd4(X.F, a + 32)); put(v, o, v.slice(o + 4, o + 8)); },
  trans(X, t, a, o, old) { quadTrans(X, t, a, o, old, 4); },     // FUN_00272320 -> FUN_002eccc8 (out is left to the eval)
  eval(X, t, a, o) { quadEval(X.p.v, o, t, 1); },
};
// Random modifiers 22 / 23 / 24 (role 1, transition only; the init FUN_00274eb8 etc. returns 1).
// Three vectors i = 0..2: enable byte +0xc/+0xe/+0x1c, mode byte +0xd/+0xf/+0x1d, range +0/+0x10/+0x20
// (tables 0x46c0e8.. / 0x46c100.. / 0x46c118..). Mode 1: [0, r), 2: [-r, 0), else [-r, r); x, y, z
// drawn in that order (FUN_002d98c8). Nothing happens while the particle has flag 2 (+2 & 2).
const EN = [0x0c, 0x0e, 0x1c], MD = [0x0d, 0x0f, 0x1d], RG = [0x00, 0x10, 0x20];
function draw3(X, a, i, one) {
  const F = X.F, r = X.rng, mode = F.u8(a + MD[i]), b = a + RG[i];
  const pick = k => {
    const R = F.f32(b + 4 * k);
    if (mode === 1) { const h = f(R * 0.5); return f(h + r.signed(h)); }
    if (mode === 2) { const h = f(R * 0.5); return f(r.signed(h) - h); }
    return r.signed(R);
  };
  const x = pick(0);
  if (one) return [x, x, x];
  const y = pick(1), z = pick(2);
  return [x, y, z];
}
function target(X) { return D.refSlot(X.F, X.d, 0) / 4; }   // the referenced channel's out slot
// type 22, FUN_00274ec0: position / velocity / acceleration of a type 1-3 channel
T[22] = {
  init() {},
  trans(X, t, a) {
    if (X.p.flags & 2) return;
    const v = X.p.v, o = target(X);
    for (let i = 0; i < 3; i++) {
      if (!X.F.u8(a + EN[i])) continue;
      const r = draw3(X, a, i, false);
      if (i === 0) for (let k = 0; k < 3; k++) { v[o + k] = f(v[o + 4 + k] + r[k]); v[o + 4 + k] = f(v[o + 4 + k] + r[k]); }
      else { const q = o + (i === 1 ? 8 : 12); for (let k = 0; k < 3; k++) v[q + k] = f(v[q + k] + r[k]); }
    }
  },
};
// type 23, FUN_00275228: rotation (degrees base += r; out = base x 11.377778) / rate / acceleration
T[23] = {
  init() {},
  trans(X, t, a) {
    if (X.p.flags & 2) return;
    const v = X.p.v, o = target(X);
    for (let i = 0; i < 3; i++) {
      if (!X.F.u8(a + EN[i])) continue;
      const r = draw3(X, a, i, false);
      if (i === 0) for (let k = 0; k < 3; k++) { v[o + 4 + k] = f(r[k] + v[o + 4 + k]); v[o + k] = f(v[o + 4 + k] * ANG); }
      else { const q = o + (i === 1 ? 8 : 12); for (let k = 0; k < 3; k++) v[q + k] = f(v[q + k] + r[k]); }
    }
  },
};
// type 24, FUN_002755a0: scale (one draw for all axes unless byte +0xc), same layout
T[24] = {
  init() {},
  trans(X, t, a) {
    if (X.p.flags & 2) return;
    const F = X.F, v = X.p.v, o = target(X);
    for (let i = 0; i < 3; i++) {
      if (!F.u8(a + [0x0d, 0x0f, 0x1d][i])) continue;       // 0x46c118: enable +0xd/+0xf/+0x1d
      const mode = F.u8(a + [0x0e, 0x1c, 0x1e][i]);         // 0x46c120
      const b = a + RG[i], r = X.rng;
      const pick = k => {
        const R = F.f32(b + 4 * k);
        if (mode === 1) { const h = f(R * 0.5); return f(h + r.signed(h)); }
        if (mode === 2) { const h = f(R * 0.5); return f(r.signed(h) - h); }
        return r.signed(R);
      };
      const x = pick(0); let y = x, z = x;
      if (F.u8(a + 0xc)) { y = pick(1); z = pick(2); }
      if (i === 0) {                                          // FUN_002755a0 case 0: base += r, out = base x 0.01
        v[o + 4] = f(v[o + 4] + x); v[o + 5] = f(v[o + 5] + y); v[o + 6] = f(v[o + 6] + z);
        for (let k = 0; k < 3; k++) v[o + k] = f(v[o + 4 + k] * PCT);
      } else { const q = o + (i === 1 ? 8 : 12); v[q] = f(v[q] + x); v[q + 1] = f(v[q + 1] + y); v[q + 2] = f(v[q + 2] + z); }
    }
  },
};
// type 14, the particle matrix (+0x50): FUN_00273f40 init, FUN_002740a0 eval, FUN_00274068 once.
// M = Scale(ref 1) . Euler(ref 2, order data[3]) + T(ref 0); data[2] == 1 aligns to a type 2
// velocity (FUN_002d93d0); then FUN_002e3dd8(1.0, ..): a top-level particle keeps M (cases need a parent).
function buildMatrix(X, a) {
  const F = X.F, v = X.p.v, d = X.d;
  const pos = D.refSlot(F, d, 0) / 4, scl = D.refSlot(F, d, 1) / 4, rot = D.refSlot(F, d, 2) / 4;
  if (F.u8(a + 2) === 1) X.warn('effects: type 14 velocity alignment (FUN_002d93d0) not translated');
  const order = F.u8(a + 3);
  const m = eulerT(scaleM([v[scl], v[scl + 1], v[scl + 2]]), [v[rot], v[rot + 1], v[rot + 2]], [v[pos], v[pos + 1], v[pos + 2]], order);
  if (X.p.parent) X.warn('effects: child particles (FUN_002e3dd8 parent cases) not translated');
  if (!m) { X.p.noDraw = `rotation order ${order} (FUN_002d82d0 case ${order})`; return; }
  X.p.m50 = m;
}
T[14] = { init(X, a) { buildMatrix(X, a); }, trans() {}, eval(X, t, a) { buildMatrix(X, a); }, once() {} };
// type 10, the sprite: FUN_002777b0 init, FUN_002778b8 draw (below)
T[10] = {
  init(X, a, o) {
    const F = X.F, v = X.p.v, I = X.p.i32;
    v[o] = f(-X.em.dt);
    if (F.u16(a + 0x18)) v[o] = f(v[o] + X.rng.unit(F.u16(a + 0x18)));
    const mode = F.u8(a + 0x1a); let flip = 0;
    if (mode === 1 || mode === 2) flip = X.rng.vrInt(0x100) < 0x80 ? 0 : mode;
    else if (mode === 3) { const r = X.rng.vrInt(0xff); flip = (r < 0 ? r + 0x3f : r) >> 6; }
    I[o + 1] = flip << 16;                                     // u16 frame index +4 = 0, byte +6 = flip
  },
  trans() {}, draw: drawSprite,
};
const DRAWN_ELSEWHERE = { 11: 'FUN_0027a170', 21: 'FUN_0027cd68', 100: 'FUN_002cb3f0', 137: 'FUN_0027da78' };

// ---------------------------------------------------------------------------------------------
// The engine. One manager (DAT_004ee2e0, the FED 0x40000 is linked into it).
export function createEffects({ fed, core, warn = console.warn, rng = new EffectRng(), proj = PROJ } = {}) {
  const F = parseFed(fed);
  const tex = core ? parseCore(core) : new Map();
  const warned = new Set();
  const warnOnce = m => { if (!warned.has(m)) { warned.add(m); warn(m); } };
  const emitters = [];                        // mgr +0x84 list
  let counter = 0;                            // mgr +0x8c
  let phase = 0xc;                            // mgr +0xb0 (0xc after the draw, 5 in the logic, 9 after FUN_002efe98)
  // one context object, refilled per channel call (no handler keeps it or calls back into ctx)
  const X0 = { F, em: null, p: null, d: 0, rng, warn: warnOnce };
  const ctx = (em, p, d) => { X0.em = em; X0.p = p; X0.d = d; return X0; };

  // FUN_002e62b0 (via FUN_002e6290, param_3 = id): FED by id & 0xfffc0000, group (id >> 10) & 0x7f,
  // entry id & 0x1ff -> FUN_002e63d0(age 0, mgr, fedobj, group +8, entry param record, 0)
  function spawn(id, pos) {
    if ((id & 0xfffc0000) >>> 0 !== F.code) { warnOnce(`effects: no FED for id 0x${id.toString(16)}`); return null; }
    if (id & 0x200) { warnOnce('effects: id bit 0x200 (FUN_002e8830) not translated'); return null; }
    const g = F.groupOf((id >> 10) & 0x7f);
    if (!g || (id & 0x1ff) >= F.u16(g + 6)) return null;      // -2 / -3
    const slot = F.u32(g + 0x20 + 4 * (id & 0x1ff));
    if (!slot) return null;
    const param = g + slot, ei = F.u16(g + 8), E = F.emitter(ei);
    if (!E) return null;
    // FUN_002e63d0
    if (0 >= F.s32(E + 4)) return null;
    const cat = F.u8(E + 0xe);
    const em = {
      E, ei, param, id, cat: (cat < 5) ? 0 : (cat < 9 || cat === 0xb) ? 1 : 0,
      flags: 0, f0a: 0, age: f(-F.s16(param + 0x2c)), dt: 0, carry: 0, fade: -1, d0: 1,
      sched: 0, n58: 0x8000, lists: [[], []],
      p120: [0, 0, 0, 0], p130: [0, 0, 0, 0], p140: [1, 1, 1, 1], p150: [1, 1, 1, 1], d4: 0,
      m: ident(), col: [1, 1, 1, 1], scale: [1, 1, 1, 1], c4: [0xff, 0xff], c8: 0, cc: 0,
    };
    if (cat >= 5 && !(cat < 9 || cat === 0xb)) warnOnce(`effects: emitter category ${cat}`);
    counter++;
    // spawn apply (flags 0x6002f): pos 0, rot 0, scale 1, colour 1, billboard byte 0; then the
    // caller's FUN_002e7660(flag 1): +0x120 = pos (FUN_00335f40 / FUN_003361b8)
    em.p120 = [f(pos[0]), f(pos[1]), f(pos[2]), 1];
    emitters.push(em);
    // FUN_002e63d0's tail by the manager state (+0xb0) at the call. Bullets end in the game logic
    // between FUN_002efe00 (state 5) and FUN_002efe98 (state 9); both run FUN_002ea040(1.0) on the
    // new emitter at once (age -1 -> 0, its first particles spawned with dt 1.0) and list 0
    // (FUN_002ea5f0); state 9 also runs FUN_002e7cd0 and FUN_002eacc8. T: the type 10 clock equals
    // the age in RAM (states w179 1-5: 1.2 .. 39.6), so the spawn frame ages and draws.
    if (phase === 5 || phase === 9) {
      em.age = f(em.age - 1);
      ageEmitter(em, 1);
      if (phase === 9) { emitterMatrix(em); list1(em); }
    } else if (phase !== 0xc && phase !== 0) warnOnce(`effects: spawn in manager state ${phase} not translated`);
    return em;
  }

  // FUN_002e8ea8(age, mgr, em, parent 0, tag, 0)
  function spawnParticle(em, age, tag) {
    if (tag < 0) return null;
    const P = F.part(em.E, tag & 0xfff);
    if (!P || !F.u8(P + 8)) return null;
    const size = (F.s16(P + 2) + 99) & ~3;                      // value region (+0x60) length
    const buf = new ArrayBuffer(Math.max(size, 16));
    const p = {
      P, tag: tag & 0xfff, flags: (tag & 0x2000) ? 0x40 : 0, list: (F.u8(P + 9) & 1) ^ 1, age: f(age),
      life: F.u16(P + 6), ev: F.u8(P + 0x21) ? 0 : -1, cat: F.u8(P + 0xb), parent: null,
      v: new Float32Array(buf), i32: new Int32Array(buf), data: [], entry: [], m50: ident(), skip: null,
    };
    if (tag & 0x2000) warnOnce('effects: spawn tag bit 0x2000 (child particles) not translated');
    // render categories 2 / 6-9 copy a matrix to +0x54 at spawn (FUN_002e9db0) that FUN_002e3498 then uses: not verified
    if (p.cat !== 0 && p.cat !== 1) p.skip = `render category ${p.cat} (FUN_002e9db0 +0x54 matrix)`;
    // FUN_002eb038: the init list (+0x30: count +4, entries from +8 stride 8: u8 channel, u16 data offset)
    const blk = F.list(P, 0);
    for (let j = 0; j < F.u8(blk + 4); j++) {
      const idx = F.u8(blk + 8 + 8 * j), a = blk + F.u16(blk + 8 + 8 * j + 2);
      const d = F.desc(P, idx), ty = D.type(F, d);
      p.data[idx] = a;
      const ev = T[ty];
      if (!ev) { if (!DRAWN_ELSEWHERE[ty]) p.skip = p.skip ?? `channel type ${ty}`; else p.skip = p.skip ?? `draw type ${ty} (${DRAWN_ELSEWHERE[ty]})`; continue; }
      ev.init(ctx(em, p, d), a, D.slot(F, d) / 4);
    }
    if (p.skip) warnOnce(`effects: particle with ${p.skip} not translated (emitter ${em.ei}): not drawn`);
    em.lists[p.list].push(p);
    em.n58 = em.n58 < 0xff00 ? em.n58 + 1 : 0x8000;
    return p;
  }

  // FUN_002eb318: keyframe events (+0x34 records: s16 time, u8 count +4, entries from +8 stride 8:
  // u8 channel, u16 data offset, s16 start +4, s16 duration +6) up to the particle's age
  function events(em, p, age) {
    if (p.ev < 0) return;
    const P = p.P, n = F.u8(P + 0x21);
    let ev = F.event(P, p.ev);
    if (!(F.s16(ev) <= age)) return;
    for (;;) {
      for (let j = 0; j < F.u8(ev + 4); j++) {
        const e = ev + 8 + 8 * j, idx = F.u8(e), a = ev + F.u16(e + 2);
        const prev = p.entry[idx], t = prev ? F.s16(prev + 6) : age;
        const d = F.desc(P, idx), old = p.data[idx];
        p.data[idx] = a; p.entry[idx] = e;
        const h = T[D.type(F, d)];
        if (h && h.trans && !p.skip) h.trans(ctx(em, p, d), f(t), a, D.slot(F, d) / 4, old);
      }
      p.ev++;
      if (p.ev >= n) break;
      ev = F.event(P, p.ev);
      if (age < F.s16(ev)) return;
    }
    p.ev = -1;
  }
  const segT = (p, idx) => { const e = p.entry[idx]; return e ? f(p.age - F.s16(e + 4)) : p.age; };
  // FUN_002eb6b8 kind 2 (eval list +0x38, slot +0x1c) and kind 7 (once list +0x4c, slot +0x3c)
  function runList(em, p, k, cnt, slot) {
    if (p.skip) return;
    const P = p.P, L = F.list(P, k);
    for (let j = 0; j < F.u8(P + 0x20 + k); j++) {
      const idx = F.u16(L + 2 * j), d = F.desc(P, idx), h = T[D.type(F, d)];
      if (h && h[slot]) h[slot](ctx(em, p, d), segT(p, idx), p.data[idx], D.slot(F, d) / 4);
    }
  }
  // FUN_002e92c8 (death list +0x40: slot +0x2c is a no-op for the translated types)
  function kill(em, p) { const L = em.lists[p.list]; L.splice(L.indexOf(p), 1); }

  // FUN_002ea040(dt, mgr, em): ages, deaths, the spawn timeline, the emitter's own end
  function ageEmitter(em, step) {
    if (em.flags & 0x20) return false;
    if (em.f0a & 0xfc7f) return true;
    let dt = f(step + em.carry); em.carry = 0;
    em.age = f(em.age + dt); em.dt = dt;
    if (!(em.fade < 0)) em.noDraw = 'emitter fade (+0x28)';       // not translated (nothing on the page sets it)
    for (const L of em.lists) for (const p of L.slice()) {
      p.age = f(p.age + dt);
      if (Math.trunc(p.age) >= p.life) kill(em, p);   // particle +4 bit 2 clear (P id) for these defs
    }
    if (em.age < 0) return true;
    const E = em.E, dur = F.s32(E + 4);
    if (em.age < dur) {
      let k = em.sched;
      if (k >= 0) {
        const ia = Math.trunc(em.age), n = F.u16(E + 8);
        for (; k < n; k++) {
          const r = F.sched(E, k);
          if (!r) { k = -1; break; }
          if (ia < F.s16(r)) break;
          const t0 = f(em.age - F.s16(r));
          for (let j = 0; j < F.s16(r + 2); j++) spawnParticle(em, t0, F.s16(r + 4 + 2 * j));
        }
        em.sched = k >= n ? -1 : k;
      }
      return true;
    }
    if (F.u16(E) & 2) { warnOnce('effects: emitter id bit 2 (looping emitter) not translated'); return true; }
    // bit 0 clear: FUN_002e6920 removes the emitter (and its particles) at its duration; bit 0 set:
    // it stays while either particle list is non-empty
    return !!(F.u16(E) & 1) && (em.lists[0].length + em.lists[1].length > 0);
  }
  // FUN_002e7cd0: the emitter matrix +0xe0 for a param record with +0x1d == 0 (cat 0)
  function emitterMatrix(em) {
    const r = em.param;
    // param +0x1d != 0 (attached emitters): another matrix path, not translated: the emitter is not drawn
    if (F.u8(r + 0x1d) !== 0) { em.noDraw = `param record mode +0x1d = ${F.u8(r + 0x1d)} (FUN_002e7cd0)`; return; }
    const p80 = [0, 1, 2].map(i => f(em.p120[i] + F.f32(r + 0x10 + 4 * i)));
    const r90 = [0, 1, 2].map(i => f(em.p130[i] + F.f32(r + 0x20 + 4 * i)));
    em.scale = [0, 1, 2].map(i => f(em.p140[i] * F.f32(r + 0x30 + 4 * i)));
    em.m = eulerT(scaleM(em.scale), r90, p80, em.d4);
    if (!em.m) { em.noDraw = `emitter rotation order ${em.d4} (FUN_002d82d0)`; em.m = ident(); }
    em.col = em.p150.slice();                                  // +0xb0 = +0x150
  }

  // FUN_002eacc8 on list 1: kind 7 (the once list +0x4c, flag 4), FUN_002eb1d0 (keyframe events),
  // kind 2 (the eval list +0x38)
  function list1(em) {
    for (const p of em.lists[1]) { if (p.flags & 4) continue; p.flags |= 4; runList(em, p, 7, 0x27, 'once'); }
    for (const p of em.lists[1]) events(em, p, Math.trunc(p.age));
    for (const p of em.lists[1]) runList(em, p, 2, 0x22, 'eval');
  }
  // The frame (FUN_00248110): begin() before the game logic, end() after it, then the draw.
  function begin(step = 1.2) {
    // FUN_002efc78 -> FUN_002e9f98: dt = step (emitter +0xc is 0), FUN_002ea040 per emitter
    for (const em of emitters.slice()) {
      const keep = ageEmitter(em, f(step));
      if (!keep) emitters.splice(emitters.indexOf(em), 1);
    }
    // FUN_002efe00 -> FUN_002ea588: list 0 (no translated particle uses it: P+9 bit 0 set)
    for (const em of emitters) if (em.lists[0].length) warnOnce('effects: list-0 particles (FUN_002ea5f0) not translated');
    phase = 5;
  }
  function end() {
    // FUN_002efe98 -> FUN_002ea6a0: emitter matrix (FUN_002e7cd0), then FUN_002eacc8 on list 1
    // GUESS: the emitter frustum cull (FUN_002da928 with param +0x40) is not decoded: never culled
    for (const em of emitters) {
      if (em.age < 0) continue;
      emitterMatrix(em);
      list1(em);
    }
    phase = 9;
  }
  const update = step => { begin(step); end(); };

  // The draw pass: FUN_002eadc0 runs each particle's draw list (+0x3c, slot +0x24).
  function sprites(view) {
    const out = [];
    for (const em of emitters) {
      if (em.age < 0) continue;
      if (em.noDraw) { warnOnce(`effects: emitter ${em.ei} with ${em.noDraw} not translated: not drawn`); continue; }
      for (const L of em.lists) for (const p of L) {
        if (p.skip) continue;
        if (p.noDraw) { warnOnce(`effects: particle with ${p.noDraw} not translated (emitter ${em.ei}): not drawn`); continue; }
        const P = p.P, Ld = F.list(P, 3);
        for (let j = 0; j < F.u8(P + 0x23); j++) {
          const idx = F.u16(Ld + 2 * j), d = F.desc(P, idx), h = T[D.type(F, d)];
          if (h && h.draw) h.draw(ctx(em, p, d), p.data[idx], D.slot(F, d) / 4, view, out, tex, proj);
        }
      }
    }
    return out;
  }
  return { spawn, begin, end, update, sprites, emitters, rng, fed: F, tex, warn: warnOnce };
}

// ---------------------------------------------------------------------------------------------
// The sprite. FUN_002778b8 (type 10 draw) -> FUN_00308028 -> FUN_00309c68 (record byte +0xf == 1)
// -> VU1 MSCAL 4 (flags 0x402 with the depth matrix | 1). The VU1 program (resident micro memory,
// instr 298-531) is translated per sprite here. Output: quads in game view space for the page.
// Game projection (cam+0x110, z128 save state): X = 300 x / z + 2037, Y = 450 y / z + 2048,
// Z = 16777256 / z - 255.0045 (GS units; only the cull box and the near fade read them).
export const PROJ = { fx: 299.972351, fy: 449.958527, cx: 2037, cy: 2048, zA: 16777256, zB: -255.004501 };
// VU1 data memory constants (0x3f1 .. 0x3f5, z128 save state): guard box 256, guard band 1536,
// screen centre (2048, 2048), near fade z from 2^23 over 2^22, colour max 255.
const VU = { box: 256, band: 1536, cx: 2048, cy: 2048, zFar: 2013265920, fade0: 8388608, fadeK: 2.38418579e-07 };
const flipMatrix = flip => {                        // FUN_00276ed8: 1 = Y 180, 2 = X 180, 3 = both
  let m = ident();
  if (flip === 2) m = rotX(m, 2048);
  else if (flip === 1) m = rotY(m, 2048);
  else if (flip === 3) { m = rotY(m, 2048); m = rotX(m, 2048); }
  return m;
};
function drawSprite(X, a, o, view, out, tex, proj) {
  const F = X.F, p = X.p, em = X.em, v = p.v, I = p.i32, d = X.d;
  const ai = F.s32(a + 0xc);
  const anim = ai >= 0 ? F.anim(ai) : 0;
  if (!anim) return;
  // the type 14 channel (ref 1) carries the billboard mode bytes; the colour slot is ref slot 0
  const m14 = p.data[D.ref(F, d, 1)];
  const mode = F.u8(m14), mode2 = F.u8(m14 + 1);
  const colSlot = D.refSlot(F, d, 0) / 4;
  const flip = (I[o + 1] >> 16) & 0xff;
  const M = mul33(flipMatrix(flip), p.m50);
  // frame clock: +0 += emitter dt; frame = clock x speed (+0x10)
  v[o] = f(v[o] + em.dt);
  let ft = f(v[o] * F.f32(a + 0x10));
  const nfr = F.u8(anim + 7);
  let k = I[o + 1] & 0xffff;
  if (nfr <= ft) {
    if (!(F.u16(anim + 2) & 0x80)) return;
    v[o] = f(Math.trunc(ft) % Math.trunc(f(nfr)));
    I[o + 1] = I[o + 1] & ~0xffff; k = 0;
    ft = f(v[o] * F.f32(a + 0x10));
  }
  while (f(F.s16(anim + 8 + 8 * k + 4)) <= ft) k++;
  I[o + 1] = (I[o + 1] & ~0xffff) | k;
  const rec = anim + F.s16(anim + 8 + 8 * k + 2);
  // colour: value x emitter colour (+0xb0), clamped to 0..255, truncated (FUN_002778b8)
  const rgba = [0, 1, 2, 3].map(i => Math.trunc(Math.min(255, Math.max(0, f(v[colSlot + i] * em.col[i])))));
  // FUN_002e3498(0.1, ..): the main matrix in game view space
  const C = viewMatrix(X, M, mode, view, f(0.1), null);
  if (!C) return;
  // FUN_002e3948(0.1, .., mode b1, data +0x1e, offset = data +0): the depth matrix (data +0x1d)
  const Dm = F.u8(a + 0x1d) ? depthMatrix(X, mode2, F.u8(a + 0x1e), a, view, f(F.f32(a + 0x14) * 0.1)) : C;
  if (!Dm) return;
  if (F.u8(a + 0x1c)) X.warn('effects: sprite flag +0x1c (packet flag 0x800) not translated');
  vuSprite(X, rec, rgba, C, Dm, out, tex, proj, em);
}
// FUN_002e3498 for a top-level particle (+0x1c == 0: the emitter matrix +0xe0). Returns the
// 4x4 that takes a corner to game view space (the game then multiplies the projection).
function viewMatrix(X, M, mode, view, s, _) {
  const em = X.em;
  let o = mul33(scaleM([s, s, s]), M);                        // FUN_002d84c0(0.1), FUN_002d83e0(out, S, M): M . S
  if (mode === 1) {                                           // billboard: rows x emitter scale (+0xa0),
    for (let r = 0; r < 3; r++) for (let j = 0; j < 4; j++) o[4 * r + j] = f(o[4 * r + j] * em.scale[r]);
    const t = view.toView(xform(em.m, [o[12], o[13], o[14]]));   // t . E, then . view (70003e00)
    o[12] = t[0]; o[13] = t[1]; o[14] = t[2]; o[15] = 1;
    return o;
  }
  if (mode === 0) {                                           // world-oriented: . E . view
    o = mul44(em.m, o);
    return view.toViewMatrix ? mul44(view.toViewMatrix(), o) : (X.warn('effects: world-oriented sprites need view.toViewMatrix'), null);
  }
  X.warn(`effects: billboard mode ${mode} (FUN_002e3498) not translated`);
  return null;
}
function depthMatrix(X, mode, sub, a, view, s) {
  const F = X.F, em = X.em, M = X.p.m50;
  if (mode !== 1 || sub !== 3) { X.warn(`effects: depth matrix mode ${mode}/${sub} (FUN_002e3948) not translated`); return null; }
  const o = mul33(scaleM([s, s, s]), M);                       // FUN_00444c70 (x 0.1), FUN_002d84f0, FUN_002d83e0: M . S
  for (let r = 0; r < 3; r++) for (let j = 0; j < 4; j++) o[4 * r + j] = f(o[4 * r + j] * em.scale[r]);
  const t = view.toView(xform(em.m, [o[12], o[13], o[14]]));
  for (let i = 0; i < 3; i++) o[12 + i] = f(t[i] + F.f32(a + 4 * i));   // + data offset, in view space
  o[15] = 1;
  return o;
}
// The VU1 sprite program (MSCAL 4). Record = a VIF stream: UNPACK V4-8 to +0x20 (count at +4),
// V2-16 (masked) to +0x40: per sprite 4 corners (x, y / 16) + 2 UVs (/ 4096), V4-8 to +0xa0: per
// sprite RGBA bytes + the GS ALPHA word, V2-32 to +0xc0: per sprite the GS TEX0.
function vuSprite(X, rec, rgba, C, Dm, out, tex, proj, em) {
  const F = X.F;
  const n = F.u8(rec + 4);
  // the record is static FED data: its unpacked VU memory is parsed once
  const vif = F.vif ??= new Map();
  let mem = vif.get(rec);
  if (mem === undefined) { mem = parseVif(F, rec, F.u16(rec + 8), X.warn); vif.set(rec, mem); }
  if (!mem) return;
  const col = rgba.map(c => f(c * f(1 / 128)));                // MULi vf02, I = 1/128
  for (let s = 0; s < n; s++) {
    const q = 0x40 + 6 * s;
    // GUESS: the masked V2-16 corners take z = 0.0, w = 1.0 from the VIF row registers (STROW is
    // set elsewhere in the effect pass; not decoded)
    const corners = [0, 1, 2, 3].map(c => [f(mem.i(q + c, 0) / 16), f(mem.i(q + c, 1) / 16), 0, 1]);
    const u0 = [f(mem.i(q + 4, 0) / 4096), f(mem.i(q + 4, 1) / 4096)], u1 = [f(mem.i(q + 5, 0) / 4096), f(mem.i(q + 5, 1) / 4096)];
    const uv = [[u0[0], u0[1]], [u1[0], u0[1]], [u0[0], u1[1]], [u1[0], u1[1]]];
    const recCol = [0, 1, 2, 3].map(i => mem.b(0xa0 + 2 * s, i));
    const alphaReg = mem.i(0xa1 + 2 * s, 0) & 0xff;               // GS ALPHA (A+D 0x42) bits 0-7 = qw x
    const tex0 = [mem.w(0xc0 + s, 0) >>> 0, mem.w(0xc0 + s, 1) >>> 0];
    const pts = corners.map(c => xform4(C, c)), dep = corners.map(c => xform4(Dm, c));
    // screen (game projection) for the guard tests; depth from the depth matrix
    const scr = pts.map((pv, i) => [f(proj.fx * pv[0] / pv[2]) + proj.cx - VU.cx, f(proj.fy * pv[1] / pv[2]) + proj.cy - VU.cy,
      f(proj.zA / dep[i][2] + proj.zB) - VU.zFar]);
    if (pts.some(pv => !(pv[2] > 0)) || dep.some(pv => !(pv[2] > 0))) continue;   // behind the eye: GS overflow, culled (L)
    const mx = [0, 1, 2].map(k => Math.max(...scr.map(c => c[k]))), mn = [0, 1, 2].map(k => Math.min(...scr.map(c => c[k])));
    if (mn[0] < -VU.band || mn[1] < -VU.band || mx[0] > VU.band || mx[1] > VU.band) continue;   // FCAND 0x28514a
    if (mn[0] > VU.box || mn[1] > VU.box || mx[0] < -VU.box || mx[1] < -VU.box) continue;
    if (mx[2] < -VU.zFar) continue;                                                            // FCAND 0x810
    const zgsD = i => f(proj.zA / dep[i][2] + proj.zB);
    const verts = pts.map((pv, i) => {
      // near fade (0x3f5) from the MAIN matrix's Z: the program reads vf28.z before the depth
      // matrix's Q lands (DIV latency), so only the GS Z comes from the depth matrix
      const zgs = f(proj.zA / pv[2] + proj.zB);
      const fade = Math.min(1, Math.max(0, f(f(zgs - VU.fade0) * VU.fadeK)));
      const c = col.map((x, j) => Math.trunc(Math.min(255, f(recCol[j] * f(x - f(x * fade))))));
      // the page draws the corner at the main matrix's screen position with the depth matrix's
      // view depth: same screen point, slid along the view ray
      const k = dep[i][2] / pv[2];
      return { pos: [pv[0] * k, pv[1] * k, dep[i][2]], uv: uv[i], rgba: c,
        gs: [scr[i][0] + VU.cx, scr[i][1] + VU.cy, zgsD(i)] };   // GS screen X, Y (pixels), Z (tests)
    });
    const t = tex.get(`${tex0[1].toString(16)}:${tex0[0].toString(16)}`);
    if (!t) { X.warn(`effects: TEX0 ${tex0[1].toString(16)}${tex0[0].toString(16).padStart(8, '0')} not in core_ef.bin`); continue; }
    out.push({ verts, tex: t, alpha: alphaReg, emitter: em.ei, id: em.id });
  }
}
function xform4(m, v) { const o = [0, 0, 0, 0]; for (let j = 0; j < 4; j++) o[j] = f(f(f(v[0] * m[j]) + f(v[1] * m[4 + j])) + f(f(v[2] * m[8 + j]) + f(v[3] * m[12 + j]))); return o; }
// VIF UNPACK (cmd 0x60-0x7f): vn = (cmd >> 2) & 3, vl = cmd & 3, m = cmd & 0x10, addr = imm & 0x3ff,
// usn = imm & 0x4000, TOPS-relative = imm & 0x8000 (the record's addresses are all TOPS-relative)
function parseVif(F, rec, size, warn) {
  const q = new Map();
  const put = (addr, k, val) => { const r = q.get(addr) ?? [0, 0, 0, 0]; r[k] = val; q.set(addr, r); };
  let o = rec;
  const end = rec + size;
  while (o < end) {
    const w = F.u32(o); o += 4;
    const cmd = (w >>> 24) & 0x7f;
    if (cmd === 0) continue;                                    // NOP
    if ((cmd & 0x60) !== 0x60) { warn(`effects: VIF cmd 0x${cmd.toString(16)} in a sprite record`); return null; }
    const num = (w >>> 16) & 0xff, imm = w & 0xffff, addr = imm & 0x3ff, usn = !!(imm & 0x4000);
    const vn = (cmd >> 2) & 3, vl = cmd & 3, bits = 32 >> vl, comps = vn + 1;
    for (let i = 0; i < num; i++) {
      for (let c = 0; c < comps; c++) {
        let x;
        if (bits === 32) { x = F.u32(o) | 0; o += 4; }
        else if (bits === 16) { x = usn ? F.u16(o) : F.s16(o); o += 2; }
        else { x = usn ? F.u8(o) : (F.u8(o) << 24) >> 24; o += 1; }
        put(addr + i, c, x);
      }
    }
    o = (o + 3) & ~3;
  }
  return {
    i: (a, k) => (q.get(a) ?? [0, 0, 0, 0])[k], b: (a, k) => (q.get(a) ?? [0, 0, 0, 0])[k] & 0xff,
    w: (a, k) => (q.get(a) ?? [0, 0, 0, 0])[k],
  };
}

// ---------------------------------------------------------------------------------------------
// three.js layer. GS state of the effect sprites (impact GS dumps): TEX0 TCC 1 TFX MODULATE
// (Cv = Ct Cf >> 7), TEST ATE GREATER AREF 0, ZTST GEQUAL, Z write off (ZBUF mask); ALPHA per sprite
// from its record: 0x44 = (Cs - Cd) As + Cd, 0x48 = (Cs - 0) As + Cd. Nearest texels (TEX1 0) at the
// page's resolution.
export class EffectLayer {
  constructor(THREE, fx) {
    this.THREE = THREE; this.fx = fx;
    this.group = new THREE.Group(); this.group.name = 'effects'; this.group.frustumCulled = false;
    this.textures = new Map(); this.pool = [];
  }
  texture(t) {
    const THREE = this.THREE;
    let g = this.textures.get(t.k);
    if (!g) {
      g = new THREE.DataTexture(t.rgba, t.W, t.H, THREE.RGBAFormat);
      g.magFilter = g.minFilter = THREE.NearestFilter; g.wrapS = g.wrapT = THREE.RepeatWrapping;
      g.flipY = false; g.needsUpdate = true;
      this.textures.set(t.k, g);
    }
    return g;
  }
  material(t, alpha) {
    const THREE = this.THREE, key = `${t.k}:${alpha}`;
    this.mats ??= new Map();
    let m = this.mats.get(key);
    if (m) return m;
    const A = alpha & 3, B = (alpha >> 2) & 3, Cc = (alpha >> 4) & 3, Dd = (alpha >> 6) & 3;
    let blend;
    if (A === 0 && B === 1 && Cc === 0 && Dd === 1) blend = [THREE.SrcAlphaFactor, THREE.OneMinusSrcAlphaFactor];
    else if (A === 0 && B === 2 && Cc === 0 && Dd === 1) blend = [THREE.SrcAlphaFactor, THREE.OneFactor];
    else { this.fx.warn(`effects: GS ALPHA 0x${alpha.toString(16)} not translated`); blend = [THREE.SrcAlphaFactor, THREE.OneMinusSrcAlphaFactor]; }
    m = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.texture(t) } },
      vertexShader: 'attribute vec4 rgba; varying vec4 vC; varying vec2 vUv; void main() { vC = rgba; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      // texels and vertex colour in GS units (0..255, alpha 0..128 = 1.0): modulate, clamp, alpha test
      fragmentShader: 'uniform sampler2D map; varying vec4 vC; varying vec2 vUv; void main() { vec4 t = floor(texture2D(map, vUv) * 255.0 + 0.5); vec4 c = min(floor(t * vC / 128.0), 255.0); if (c.a <= 0.0) discard; gl_FragColor = vec4(c.rgb / 255.0, c.a / 128.0); }',
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,   // the GS has no culling; game view -> three view flips the winding
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation, blendSrc: blend[0], blendDst: blend[1],
    });
    this.mats.set(key, m);
    return m;
  }
  // Once per game frame, after fx.end(): the draw pass (it advances the sprites' clocks, as the game's
  // draw does) through the page camera (game world, up = -y; game view = three view x (1, -1, -1)).
  // The quads are written in world space and stay until the next game frame.
  update(camera) {
    const THREE = this.THREE;
    this.camera = camera;                                             // the camera of the last draw pass (page tests)
    camera.updateMatrixWorld();
    const inv = camera.matrixWorldInverse.elements, w = camera.matrixWorld.elements;
    const toView = p => {
      const x = inv[0] * p[0] + inv[4] * p[1] + inv[8] * p[2] + inv[12];
      const y = inv[1] * p[0] + inv[5] * p[1] + inv[9] * p[2] + inv[13];
      const z = inv[2] * p[0] + inv[6] * p[1] + inv[10] * p[2] + inv[14];
      return [x, -y, -z];
    };
    // the same transform as a row-vector 4x4 (p . V), for world-oriented sprites
    const toViewMatrix = () => {
      const V = new Float32Array(16);
      for (let r = 0; r < 4; r++) { V[4 * r] = inv[4 * r]; V[4 * r + 1] = -inv[4 * r + 1]; V[4 * r + 2] = -inv[4 * r + 2]; V[4 * r + 3] = r === 3 ? 1 : 0; }
      return V;
    };
    const list = this.fx.sprites({ toView, toViewMatrix });
    while (this.pool.length < list.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8), 2));
      g.setAttribute('rgba', new THREE.BufferAttribute(new Float32Array(16), 4));
      g.setIndex([0, 1, 2, 2, 1, 3]);
      const mesh = new THREE.Mesh(g); mesh.frustumCulled = false;
      this.pool.push(mesh); this.group.add(mesh);
    }
    this.pool.forEach((m, i) => { m.visible = i < list.length; });
    list.forEach((s, i) => {
      const mesh = this.pool[i], g = mesh.geometry;
      const P = g.attributes.position.array, U = g.attributes.uv.array, C = g.attributes.rgba.array;
      s.verts.forEach((vx, j) => {
        const [x, y, z] = [vx.pos[0], -vx.pos[1], -vx.pos[2]];     // game view -> three view -> world
        P[3 * j] = w[0] * x + w[4] * y + w[8] * z + w[12];
        P[3 * j + 1] = w[1] * x + w[5] * y + w[9] * z + w[13];
        P[3 * j + 2] = w[2] * x + w[6] * y + w[10] * z + w[14];
        U[2 * j] = vx.uv[0]; U[2 * j + 1] = vx.uv[1];
        for (let k = 0; k < 4; k++) C[4 * j + k] = vx.rgba[k];
      });
      g.attributes.position.needsUpdate = g.attributes.uv.needsUpdate = g.attributes.rgba.needsUpdate = true;
      mesh.material = this.material(s.tex, s.alpha);
      mesh.renderOrder = 1000 + i;                                    // GUESS: draw buckets (FUN_002e1d88) not decoded: spawn order
    });
  }
}

// for the tests: the matrix helpers
export const _internals = { eulerT, scaleM, sincos, T };

// Effect ids at the game's call sites, read from the user's ELF by the exporter (data/effects/ids.json):
// FUN_00336040 table 0x4a0c68 [material * 2 + floor] (floor = FUN_00260c38: (int)(normal.y bits ^
// 0x80000000) > 0x3f666666, i.e. y < -0.9f); FUN_003363d0 table 0x4a0cd8 [(C+0x150 >> 16) & 3].
// FUN_00336478 (bullet +0x140 bits 7-10 == 0): the wall impact id for a material and hit normal.
// The page's collision normal is not known to have the sign of the game's hit normal (not decoded), so a hit with
// |n.y| > 0.9 (floor or ceiling) gets no effect (-1) rather than a guessed floor / wall pick; the walls (|n.y| <=
// 0.9) take the wall id either way.
export function wallImpactId(ids, mat, normal, warn) {
  if (normal && Math.abs(normal[1]) > 0.9) {
    if (warn) warn('effects: floor / ceiling hit (|n.y| > 0.9): the hit normal\'s sign (FUN_00260c38) is not decoded; no effect');
    return -1;
  }
  const t = ids && ids.wall;
  return t ? t[(mat & 0xf) * 2] ?? -1 : -1;
}
