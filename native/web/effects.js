// effects.js - the game's particle / effect engine (FED), translated. Worker 0179.
// notes/effects-research.md has the decode; every function cites its game address.
//
// Data (gitignored, from the user's disc): python3 -I native/assets/models/export_web_effects.py
//   data/effects/r0001.fed    the resident FED, FileCode 0x40000 (wall impacts, hits on Vincent)
//   data/effects/r0000.fed    the resident FED, FileCode 0 (the hit on Vincent's screen flash 0x1000; worker 0200)
//   data/effects/core_ef.bin  the effect texture pack resident in GS memory
//
// API
//   const fx = createEffects({ fed, fed0, core, warn })   fed / fed0 (r0000, optional) / core: ArrayBuffer
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
// Also the burst (type 21) and the sparks (type 137, VU1 line strips), worker 0188; the screen sprite
// (type 107, items with `screen: true`) and the values of types 107 / 109, worker 0200.
// Not on the page (warned once, listed in notes/fidelity-audit.md): draw types 11 / 100 / 110 (frame-buffer
// filter), type 107's frame-buffer mode,
// channel types 3 / 5 / 6 / 8 / 26, render categories 2 / 7 / 9, rotation orders 1-5, emitter
// param +0x1d >= 2, the emitter fade (those are simulated but not drawn), the emitter frustum cull
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
const K3FF1 = bitsF(0x3ff19120);   // FUN_002d9880 / FUN_002d9828: lui 0x3ff1, ori 0x9120 (1.8872414; not f(1.88725) = 0x3ff19168)
export class EffectRng {
  // mt: the effect twister's state { s: 624 words (DAT_004e9408), i: index (DAT_004e9dc8) } from a save
  // state (the exporter writes the z128 one into data/effects/ids.json `twister`); without it the twister
  // draws (type 137 sparks) are left out with a warning
  // libc: newlib's rand() state (*(PTR_DAT_00495844) + 0x58). Each effect frame starts with FUN_002d97f8
  // (FUN_002efc78's first call): DAT_004e9400 = rand() (FUN_00448910: state = state x 0x41c64e6d + 0x3039,
  // returns state & 0x7fffffff) and VRINIT R with the same word. MEASURED, not decoded: rand() advances exactly
  // once a frame in the w188 windows (A -> C 2, B -> D 6, C -> B 42 steps). Two other rand() callers exist:
  // FUN_002e0ca8 (FUN_002e0db0 <- FUN_00305c78 <- FUN_002e28d8 <- FUN_00268f18, the material-6 wall impact, not on
  // the page) and FUN_003a1080 (reached only through a pointer; not found). The page assumes neither runs. Without it (null) the LCG is not reseeded (tests that set
  // a recovered seed).
  constructor(lcg = 0xdf887fd0, r = 0x3f800000, mt = null, libc = null) {   // lcg: DAT_004e9400 in the z128 save state
    this.s = lcg >>> 0; this.R = r >>> 0;
    this.mt = mt ? { s: Uint32Array.from(mt.s), i: mt.i } : null;
    this.libc = libc === null || libc === undefined ? null : libc >>> 0;
  }
  frame() {                                                    // FUN_002d97f8
    if (this.libc === null) return;                            // no rand(): createEffects warns (and spawns nothing unless the caller seeds the LCG)
    this.libc = (Math.imul(this.libc, 0x41c64e6d) + 0x3039) >>> 0;
    this.s = this.libc & 0x7fffffff;
    this.R = ((this.s & 0x7fffff) | 0x3f800000) >>> 0;          // VRINIT R, vf (the word as float bits)
  }
  // FUN_002d9b18: the effect Mersenne twister (624 words at DAT_004e9408, index DAT_004e9dc8; its own
  // instance, not enemy_ai's DAT_004fbe00): returns the tempered current word, then twists that word
  mtNext() {
    const S = this.mt.s, i = this.mt.i, n = i > 0x26e ? S[0] : S[i + 1];
    let y = S[i];
    y ^= y >>> 11; y ^= (y & 0x13a58ad) << 7; y ^= (y & 0x1df8c) << 15; y ^= y >>> 18;
    let t = ((S[i] & 0x80000000) | (n & 0x7fffffff)) >>> 1;
    if (n & 1) t ^= 0x9908b0df;
    S[i] = (t ^ (i < 0xe3 ? S[i + 397] : S[i - 227])) >>> 0;
    this.mt.i = i > 0x26e ? 0 : i + 1;
    return y >>> 0;
  }
  mtSigned(r) {                                               // FUN_002d9c30: (([1, 2) - 1) x 2 - 1) x r
    const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, (this.mtNext() & 0x7fffff) | 0x3f800000);
    return f(f(f(f(b.getFloat32(0) - 1) * 2) - 1) * f(r));
  }
  next() { this.s = (Math.imul(this.s, 0x41c64e6d) + 0x3039) >>> 0; return this.s; }
  signed(r) { const v = (this.next() & 0x7fff) - 0x4000; return f(f(v * K98C8) * f(r)); }
  unit(r) { const v = this.next() & 0x7fff; return f(f(v * K9938) * f(r)); }
  // VU0 R: set each frame by FUN_002d97f8 (above, when libc is given); r = the value without it.
  // GUESS (partly): from the frame's VRINIT the chain below reproduces the first 3-5 spark lives of each frame in
  // w188 state D, then diverges (something else in the frame moves R; not found)
  vrInt(n) {                                                  // FUN_002d9880(n)
    const x = (this.R >>> 4) & 1, y = (this.R >>> 22) & 1;    // PCSX2 AdvanceLFSR
    this.R = ((((this.R << 1) ^ x ^ y) & 0x7fffff) | 0x3f800000) >>> 0;
    const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, this.R, true);
    const r = b.getFloat32(0, true);
    const w = f(r - K3FF1); b.setFloat32(0, w, true);
    this.R = ((b.getUint32(0, true) & 0x7fffff) | 0x3f800000) >>> 0;   // VRINIT R, vf25w
    return Math.trunc(f(f(r - 1) * f(n)));
  }
  // FUN_002d9828(n): the same VU0 R step as FUN_002d9880, value ftoi0((R x 2 - 3) x n): (-n, n). The reseed is
  // R - 1.88725, not 2R - 1.88725 as the decomp reads: the asm's VMUL (x 2.0) and VSUB (- 3.0) write only .x,
  // while VSUBbc writes vf25.w = vf31.w (R from VRNEXT .xyzw) - vf27.x (0x3ff19120) and VRINIT reads vf25.w
  // (0x2d9854 / 0x2d9858 / 0x2d986c dest / fsf fields). T: w188 state D spark lives (test_effects).
  vrSpan(n) {
    const x = (this.R >>> 4) & 1, y = (this.R >>> 22) & 1;
    this.R = ((((this.R << 1) ^ x ^ y) & 0x7fffff) | 0x3f800000) >>> 0;
    const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, this.R, true);
    const r = b.getFloat32(0, true);
    const w = f(r - K3FF1); b.setFloat32(0, w, true);
    this.R = ((b.getUint32(0, true) & 0x7fffff) | 0x3f800000) >>> 0;
    return Math.trunc(f(f(f(r * 2) - 3) * f(n)));
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

// A FED's own textures (worker 0198): the header +0x68 table (count +0x44) of embedded TIM2 images, which
// FUN_002eba88 hands to the texture system (FUN_00309f28). Keyed by the picture header's GsTex0 (+0x18): the
// title FED a0097's sprites draw with exactly these TEX0 words in the GS dumps (MEASURED, w198 dumps). Only the
// formats the FEDs use here: PSMT8 (image type 5) with a 256 x CT32 CLUT (type 3, CSM1 order as core_ef.bin).
export function parseFedTextures(F) {
  const out = new Map(), t = F.u32(0x68), n = F.u16(0x44);
  for (let i = 0; i < n; i++) {
    const s = F.u32(t + 4 * i);
    if (!s) continue;
    const o = t + s, h = o + 0x10;
    if (F.u32(o) !== 0x324d4954) continue;                         // 'TIM2'
    const isz = F.u32(h + 8), ct = F.u8(h + 0x12), it = F.u8(h + 0x13);
    const w = F.u16(h + 0x14), hh = F.u16(h + 0x16), lo = F.u32(h + 0x18), hi = F.u32(h + 0x1c);
    if (it !== 5 || ct !== 3) { console.warn(`effects: FED texture ${i} type ${it} / CLUT ${ct} not translated`); continue; }
    // FUN_00309f28: the image at +0x40, or +0x60 when byte +0xc is 2 (a name block at +0x50, e.g. 'gmovr_01');
    // the CLUT right after the image (+ the image size +0x18). MEASURED: the CLUTs equal GS memory at their CBP (w198 f1050)
    const img = o + (F.u8(o + 0xc) === 2 ? 0x60 : 0x40), clutAt = img + isz;
    const tw = (lo >>> 26) & 0xf, th = ((lo >>> 30) | (hi << 2)) & 0xf, W = 1 << tw, H = 1 << th;
    const clut = new Uint32Array(256);
    for (let k = 0; k < 256; k++) clut[k] = F.u32(clutAt + 4 * ((k & 0xe7) | ((k & 0x08) << 1) | ((k & 0x10) >> 1)));
    const rgba = new Uint8Array(W * H * 4);
    for (let y = 0; y < Math.min(hh, H); y++) for (let x = 0; x < Math.min(w, W); x++) {
      const c = clut[F.u8(img + y * w + x)], p = 4 * (y * W + x);
      rgba[p] = c & 0xff; rgba[p + 1] = (c >>> 8) & 0xff; rgba[p + 2] = (c >>> 16) & 0xff; rgba[p + 3] = c >>> 24;
    }
    out.set(`${hi.toString(16)}:${lo.toString(16)}`, { k: `fed${F.code.toString(16)}:${i}`, W, H, rgba, tex0: [lo, hi], clut });
  }
  return out;
}

// Camera 1 (DAT_0050b4f8[1] = 0x4ea080, the 2D camera of the screen effects; worker 0198): FUN_002d9ec8(cam, PAL)
// + FUN_002da038 + FUN_002da5d0 -> sceVu0ViewScreenMatrix(scrz +0x30 = 512, ax = +0x34, ay = ax x 1.575, cx +0x38,
// cy +0x3c, zmin 1, zmax 0x4b7fffff, nearz 1, farz 65536) with the PAL flag (FUN_002413c0(0x1e) = 1 in this save,
// DAT_0050b4f0): +0x10 = 426, +0x14 = 512, ax = 426 / 512, cx 2037, cy 2048. Its view (+0x150) is the
// identity with z + 128 (RAM, w198 states 1-5: unchanged). FUN_002e3300 adds the emitter's +0x40 / +0x44 to
// the projection's centre, x 0.83203125 / 1.1428572 with the PAL flag.
const CAM2D = (() => {
  const ax = f(426 / 512), ay = f(ax * f(1.575));
  const zmin = 1, zmax = 16777215, nearz = 1, farz = 65536;
  return { fx: f(512 * ax), fy: f(512 * ay), cx: 2037, cy: 2048,
    zA: f(farz * nearz * (zmax - zmin) / (farz - nearz)), zB: f((zmin * farz - zmax * nearz) / (farz - nearz)) };
})();
export const CAM2D_VIEW = {
  toView: p => [p[0], p[1], f(p[2] + 128)],
  toViewMatrix: () => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 128, 1]),
};
export function cam2dProj(p40) {
  return { ...CAM2D, cx: f(CAM2D.cx + f(p40[0] * 0.83203125)), cy: f(CAM2D.cy + f(p40[1] * f(1.1428572))) };
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
// type 3 position, quadratic (worker 0198): FUN_00274558 init (asm: rows +0 / +0x10 / +0x20 -> value +0x10 /
// +0x20 / +0x30, out = base; the spawn parameter mgr +0xb4 is 0 on these paths), FUN_002745f0 -> FUN_002ecf18
// transition, FUN_00274680 eval (byte-identical to type 17's FUN_00272348)
T[3] = {
  init(X, a, o) { const v = X.p.v; put(v, o + 4, rd4(X.F, a)); put(v, o + 8, rd4(X.F, a + 16)); put(v, o + 12, rd4(X.F, a + 32)); put(v, o, v.slice(o + 4, o + 8)); },
  trans(X, t, a, o, old) { quadTrans(X, t, a, o, old); },
  eval(X, t, a, o) { quadEval(X.p.v, o, t, 1); },
};
// Loop methods (vtable +0x34; worker 0198), called by FUN_002eb6b8 kind 5 when a looping particle wraps:
// (t1 = loop start - the new segment's start, t2 = loop end - the old segment's start, new data, out slot,
// old data); each re-bases its channel so the curve is continuous across the wrap, then (2 / 3 / 9 / 17)
// runs its eval at t1. Types 10 / 14 have the no-op FUN_002d5740.
function loopQuad(X, t1, t2, a, o, old, lanes) {   // FUN_002ed3f8 (lanes 3) / FUN_002ed1e8 (lanes 4)
  const F = X.F, v = X.p.v, h2 = f(f(t2 * t2) * 0.5), h1 = f(f(t1 * t1) * 0.5);
  for (let i = 0; i < lanes; i++) {
    const b = v[o + 4 + i], r = v[o + 8 + i], ac = v[o + 12 + i];
    const r2 = f(F.f32(a + 16 + 4 * i) + f(f(f(ac * t2) + r) - f(f(F.f32(old + 32 + 4 * i) * t2) + F.f32(old + 16 + 4 * i))));
    const a2 = f(F.f32(a + 32 + 4 * i) + f(ac - F.f32(old + 32 + 4 * i)));
    v[o + 8 + i] = r2; v[o + 12 + i] = a2;
    v[o + 4 + i] = f(f(f(f(ac * h2) + f(r * t2)) + b) - f(f(a2 * h1) + f(r2 * t1)));
  }
}
T[1].loop = (X, t1, t2, a, o) => { const v = X.p.v; put(v, o + 4, v.slice(o, o + 4)); };          // FUN_00274548: base = out
T[2].loop = (X, t1, t2, a, o, old) => {                                                            // FUN_00274948
  const F = X.F, v = X.p.v;
  for (let i = 0; i < 3; i++) {
    const r = v[o + 8 + i], r2 = f(F.f32(a + 16 + 4 * i) + f(r - F.f32(old + 16 + 4 * i)));
    v[o + 8 + i] = r2;
    v[o + 4 + i] = f(f(f(r * t2) + v[o + 4 + i]) - f(r2 * t1));
  }
  T[2].eval(X, t1, a, o);
};
T[3].loop = (X, t1, t2, a, o, old) => { loopQuad(X, t1, t2, a, o, old, 3); T[3].eval(X, t1, a, o); };   // FUN_002746c0
T[4].loop = (X, t1, t2, a, o) => { const v = X.p.v; for (let i = 0; i < 3; i++) v[o + 4 + i] = f(v[o + i] * f(0.087890625)); };   // FUN_00275940 (0x3db40000)
T[7].loop = (X, t1, t2, a, o) => { const v = X.p.v; for (let i = 0; i < 3; i++) v[o + 4 + i] = f(v[o + i] * 100); };   // FUN_002761c8 (0x42c80000)
T[9].loop = (X, t1, t2, a, o, old) => { loopQuad(X, t1, t2, a, o, old, 3); T[9].eval(X, t1, a, o); };   // FUN_002763b0
T[17].loop = (X, t1, t2, a, o, old) => { loopQuad(X, t1, t2, a, o, old, 4); T[17].eval(X, t1, a, o); };  // FUN_00272388
const LOOP_NOOP = new Set([10, 14, 11, 35]);    // FUN_002d5740 (11 / 35: their vtable +0x34, save RAM; worker 0202)
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
// ---- the GAME OVER title's other channel types (worker 0202; notes/gameover-research.md "Title draw types").
// Vtables from the save RAM (DAT_0046c398[type], w198 s4): 20 -> 0x49a9b8, 35 -> 0x49a6f8, 103 -> 0x49d1c0,
// 119 -> 0x49db70 (init +0xc, transition +0x14, eval +0x1c, draw +0x24, destroy +0x2c, loop +0x34).
// Type 20 (data: +0xc model index into the FED's +0x6c table, +0x10 / +0x14 UV offset base, +0x18 / +0x1c rate,
// +0x20 / +0x24 acceleration, +0x28..+0x3c random ranges, +0x40 depth offset, +0x45 / +0x48 / +0x49 flags, +0x4a
// random on): a FED model drawn with a scrolling UV offset. Value (8 words): +0 / +8 = data +0x10, +0x10 = +0x18,
// +0x18 = +0x20 (FUN_0027b0f8). The transition FUN_0027b120 (asm) re-bases base / rate / acceleration so the curve
// is continuous, then (particle flag 2 clear, data +0x4a) adds six LCG draws (FUN_002d98c8) of the ranges +0x28..
// +0x3c to +8..+0x1c. T: w202_lcg call log (TRACE_CALLLOG=w202lcg): 6 draws at 0x27b270..0x27b2d4 per type 20
// particle, page frames 894 (tag 61) and 904 (tags 58, 59) = log frames 896 / 906.
// The draw FUN_0027b300 -> FUN_002f2f08 (flag 0x2100 -> FUN_002f93d8, the 35 KB model renderer) is not decoded:
// simulated, not drawn (warned).
T[20] = {
  init(X, a, o) {                                              // FUN_0027b0f8
    const F = X.F, v = X.p.v;
    v[o] = v[o + 2] = F.f32(a + 0x10); v[o + 1] = v[o + 3] = F.f32(a + 0x14);
    v[o + 4] = F.f32(a + 0x18); v[o + 5] = F.f32(a + 0x1c); v[o + 6] = F.f32(a + 0x20); v[o + 7] = F.f32(a + 0x24);
  },
  trans(X, t, a, o, old) {                                     // FUN_0027b120 (asm order)
    const F = X.F, v = X.p.v, N = k => F.f32(a + k), O = k => F.f32(old + k);
    const h = f(f(t * t) * 0.5);
    const V8 = v[o + 2], Vc = v[o + 3], V10 = v[o + 4], V14 = v[o + 5], V18 = v[o + 6], V1c = v[o + 7];
    const f3 = f(f(f(O(0x20) * h) + f(O(0x18) * t)) + O(0x10));
    const f0 = f(f(f(V18 * h) + f(V10 * t)) + V8);
    v[o + 2] = f(N(0x10) + f(f0 - f3));
    const f1 = f(f(f(V1c * h) + f(V14 * t)) + Vc), f2 = f(f(f(O(0x24) * h) + f(O(0x1c) * t)) + O(0x14));
    v[o + 3] = f(N(0x14) + f(f1 - f2));
    v[o + 4] = f(N(0x18) + f(f(f(V18 * t) + V10) - f(f(O(0x20) * t) + O(0x18))));
    v[o + 5] = f(N(0x1c) + f(f(f(V1c * t) + V14) - f(f(O(0x24) * t) + O(0x1c))));
    v[o + 6] = f(N(0x20) + f(V18 - O(0x20)));
    v[o + 7] = f(N(0x24) + f(V1c - O(0x24)));
    if ((X.p.flags & 2) || !F.u8(a + 0x4a)) return;
    for (let k = 0; k < 6; k++) v[o + 2 + k] = f(v[o + 2 + k] + X.rng.signed(F.f32(a + 0x28 + 4 * k)));
  },
  loop(X, t1, t2, a, o, old) {                                 // FUN_0027b680 (t1 = the loop start's segment time, t2 = the end's)
    const F = X.F, v = X.p.v, N = k => F.f32(a + k), O = k => F.f32(old + k);
    const V8 = v[o + 2], Vc = v[o + 3], V10 = v[o + 4], V14 = v[o + 5], V18 = v[o + 6], V1c = v[o + 7];
    const h2 = f(f(t2 * t2) * 0.5), h1 = f(f(t1 * t1) * 0.5);
    const r10 = f(N(0x18) + f(f(f(V18 * t2) + V10) - f(f(O(0x20) * t2) + O(0x18))));
    const r14 = f(N(0x1c) + f(f(f(V1c * t2) + V14) - f(f(O(0x24) * t2) + O(0x1c))));
    const r18 = f(N(0x20) + f(V18 - O(0x20))), r1c = f(N(0x24) + f(V1c - O(0x24)));
    v[o + 4] = r10; v[o + 5] = r14; v[o + 6] = r18; v[o + 7] = r1c;
    v[o + 2] = f(f(f(f(V18 * h2) + f(V10 * t2)) + V8) - f(f(r18 * h1) + f(r10 * t1)));
    v[o + 3] = f(f(f(f(V1c * h2) + f(V14 * t2)) + Vc) - f(f(r1c * h1) + f(r14 * t1)));
    // FUN_002d9208(x + 4096, 4096): x - 4096 trunc(x / 4096), when outside [0, 4096)
    const wrap = x => { const y = f(x + 4096); return f(y - f(4096 * Math.trunc(f(y / 4096)))); };
    if (v[o + 2] < 0 || v[o + 2] >= 4096) v[o + 2] = wrap(v[o + 2]);
    if (v[o + 3] < 0 || v[o + 3] >= 4096) v[o + 3] = wrap(v[o + 3]);
  },
  draw(X) { X.warn('effects: draw type 20 (FUN_0027b300 -> FUN_002f2f08: the FED model renderer FUN_002f93d8) not translated: not drawn'); },
};
// Type 35: the glow of a sprite through a frame-buffer page. Data: +0 anim (FED +0x70), +4 speed, +8 scale % (the
// repeat's growth), +0xc depth offset, bytes +0x10 page size index (DAT_0046c230 / 238 / 240 / 248), +0x11 frame
// buffer (FUN_002ef560(mgr, +0x11 != 0, 1)), +0x12 GS ALPHA index (DAT_0046c250), +0x13 repeats, +0x14 depth matrix.
// Value: +0 clock, u16 +4 frame index, s16 +6 the anim's extent. FUN_00278a68 (asm) init: clock = -emitter dt,
// frame 0; FUN_00278a88 transition: +6 = max |x|, |y| of FUN_00309828's box (the corners of every frame's sprite
// record, FUN_00309988); eval 0x278b48 is jr ra; loop 0x2d5740 (LOOP_NOOP). Draw FUN_00278b50 (drawGlow below).
T[35] = {
  init(X, a, o) { X.p.v[o] = f(-X.em.dt); X.p.i32[o + 1] &= ~0xffff; },
  trans(X, t, a, o) {
    const F = X.F, ai = F.s32(a), anim = ai >= 0 ? F.anim(ai) : 0;
    if (!anim) return;
    const b = animBox(X, anim);
    if (!b) return;
    const e = Math.max(...b.map(Math.abs));
    X.p.i32[o + 1] = (X.p.i32[o + 1] & 0xffff) | ((e & 0xffff) << 16);
  },
  eval() {},
  draw: drawGlow,
};
// FUN_00309828(anim, box): byte +1 == 1: byte +6 frames, record at anim + s16(anim + 8k + 10); else s16 +6 frames,
// record at anim + s16(anim + 0x10 + 8k). FUN_00309988(record): byte +0xf == 1 (the VIF sprite records): byte +4
// sprites, from +0x14 per sprite 4 corners (s16 x, y) + 4 s16, 24 bytes. Returns [minx, miny, maxx, maxy] (raw).
function animBox(X, anim) {
  const F = X.F;
  let x0 = 0x10000, y0 = 0x10000, x1 = -0x10000, y1 = -0x10000;
  const one = F.u8(anim + 1) === 1, n = one ? F.u8(anim + 6) : F.s16(anim + 6);
  for (let k = 0; k < n; k++) {
    const rec = anim + F.s16(anim + (one ? 8 * k + 10 : 0x10 + 8 * k));
    if (F.u8(rec + 0xf) !== 1) { X.warn('effects: sprite record kind != 1 (FUN_00309988) not translated'); return null; }
    for (let s = 0; s < F.u8(rec + 4); s++) for (let c = 0; c < 4; c++) {
      const x = F.s16(rec + 0x14 + 24 * s + 4 * c), y = F.s16(rec + 0x16 + 24 * s + 4 * c);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
  }
  return [x0, y0, x1, y1];
}
// Type 103: strands. Data: +0 / +0x10 velocity base / range, +0xc length cap, +0x1c rate (points a frame x dt),
// +0x20 / +0x30 acceleration base / range, u16 +0x2c pool size, u16 +0x2e life, u16 +0x3c life range, byte +0x3e
// the gap after a spawn (frames x rate), +0x3f GS ALPHA index, +0x40 position range, +0x50 / +0x60 head / tail
// colours. Value: +0 the pool (0x60-byte points), +4 the spawn accumulator. FUN_002a9bb8 init (pool via
// FUN_002f3068, FUN_002aa5e0 clears the live words +0x4c), transition 0x2a9d50 and loop 0x2a9d58 do nothing, eval
// FUN_002a9d60 (asm order): accumulator += rate x dt; at >= 1: n = trunc points, accumulator = frac - rate x gap;
// each new point (FUN_002aa610: the first free slot) draws 3 position, 3 velocity, 3 acceleration LCG values and a
// VU0 R span for its life; then every live point ages (life - 1: dead at 0; below half its life the fade +0x44
// drops by 2 / life), moves (pos += vel, vel += acc, VADD .xyz) and drags its tail: while the length +0x50 is under
// the cap it is |tail - pos| (VSQRT), else the tail is pulled to cap along tail - pos (VRSQRT). T: w202c call log,
// page frame 1011 on: 9 LCG + 1 VU0 R per point, the six particles of each schedule step together (log 1013..1047).
// GUESS: the eval's first test reads the channel context's word 0 bit 0 (a1 = DAT_004ec058-like context, not the
// particle; not decoded): taken as clear (the log shows the draws every time a point is due).
// The draw FUN_002aa120 (GS lines, head -> tail) is not translated: in the w198 dump g4 (f1050) its 24 lines come
// after the HUD (after layer 6's depth clear, seq 57216), so the draw entry's layer (FUN_002e1e40 / FUN_002e2048)
// would be needed too. Simulated, not drawn (warned).
T[103] = {
  init(X, a, o) {
    const F = X.F, n = F.u16(a + 0x2c);
    (X.p.ext ??= {})[o] = Array.from({ length: n }, () => ({ live: 0, pos: [0, 0, 0, 1], tail: [0, 0, 0, 1], vel: [0, 0, 0, 0], acc: [0, 0, 0, 0], life: 0, half: 0, fade: 0, rate: 0, len: 0 }));
    X.p.v[o + 1] = 0;
  },
  trans() {},
  loop() {},
  eval(X, t, a, o) {
    const F = X.F, v = X.p.v, pool = valObj(X, o), r = X.rng;
    if (!pool) return;
    const rate = F.f32(a + 0x1c);
    const acc = f(v[o + 1] + f(rate * X.em.dt));
    let n = 0;
    if (acc < 1) v[o + 1] = acc;
    else { n = Math.trunc(acc); v[o + 1] = f(f(acc - n) - f(rate * F.u8(a + 0x3e))); }
    const rx = f(F.f32(a + 0x40) * 0.5), ry = f(F.f32(a + 0x44) * 0.5), rz = f(F.f32(a + 0x48) * 0.5);
    for (let i = 0; i < n; i++) {
      const q = pool.find(p => !p.live);
      if (!q) break;
      q.pos = [r.signed(rx), r.signed(ry), r.signed(rz), 1];
      q.tail = q.pos.slice();
      q.vel = [0, 1, 2].map(k => f(F.f32(a + 4 * k) + r.signed(F.f32(a + 0x10 + 4 * k)))).concat(q.vel[3]);
      q.acc = [0, 1, 2].map(k => f(F.f32(a + 0x20 + 4 * k) + r.signed(F.f32(a + 0x30 + 4 * k)))).concat(q.acc[3]);
      const life = F.u16(a + 0x2e);
      q.life = (life + r.vrSpan(F.u16(a + 0x3c))) & 0xffff;
      q.fade = 1; q.half = life >> 1; q.live = 1; q.len = 0; q.rate = f(2 / life);
    }
    const cap = F.f32(a + 0xc);
    for (const q of pool) {
      if (!q.live) continue;
      q.life = (q.life - 1) & 0xffff;
      if (!q.life) { q.live = 0; continue; }
      if (q.life < q.half) { q.fade = f(q.fade - q.rate); if (q.fade < 0) q.fade = 0; }
      for (let k = 0; k < 3; k++) { q.pos[k] = f(q.pos[k] + q.vel[k]); q.vel[k] = f(q.vel[k] + q.acc[k]); }
      const d = [0, 1, 2].map(k => f(q.tail[k] - q.pos[k]));
      const s2 = f(f(f(d[0] * d[0]) + f(d[1] * d[1])) + f(d[2] * d[2]));   // VMUL .xyz, VADDy.x, VADDz.x
      if (q.len < cap) q.len = f(Math.sqrt(s2));
      else { const k = f(1 / Math.sqrt(s2)); for (let j = 0; j < 3; j++) q.tail[j] = f(q.pos[j] + f(f(d[j] * k) * cap)); }
    }
  },
  draw(X) { X.warn('effects: draw type 103 (strand lines FUN_002aa120, drawn after the HUD) not translated: not drawn'); },
};

// Screen channels of r0000.fed (worker 0200; the hit on Vincent's 0x1000, FUN_00336508). Vtables from the save RAM
// (DAT_0046c398): 107 -> 0x49def8, 109 -> 0x49d798, 110 -> 0x49da80. Types 107 / 109 keep a 0x14-byte object at their
// value slot (FUN_002a7fd0(0x14)): +4 value, +8 base, +0xc rate, +0x10 acceleration; the acceleration is read from
// DAT_0046c350 (107, FUN_002a3850) / DAT_0046c34c (109, FUN_002a2600), static .data words that are 0.0 in the ELF
// and in the save RAM. The page keeps the object in p.ext[slot]. T: w188 state C, emitter 7 of r0000 (age 1.2):
// 107's object (+4, +8, +0xc, +0x10) = (128, 128, 0, 0), 109's = (1.12, 1.0, 0.1, 0).
const ACC107 = 0, ACC109 = 0;
const valObj = (X, o) => ((X.p.ext ??= {})[o]);
// FUN_002a3258 (107) / FUN_002a21f8 (109): the transition; base / rate / acceleration re-based so the curve is
// continuous (new block n = {base, rate}, old block q = {base, rate}, acceleration constant k)
function valTrans(Q, t, nb, nr, qb, qr, k) {
  const h = f(f(t * t) * 0.5);
  const b = f(nb + f(f(f(f(Q.acc * h) + f(Q.rate * t)) + Q.base) - f(f(f(k * h) + f(qr * t)) + qb)));
  Q.rate = f(nr + f(f(f(Q.acc * t) + Q.rate) - f(f(k * t) + qr)));
  Q.acc = f(k + f(Q.acc - k));
  Q.base = b;
}
// FUN_002a35f0 (107) / FUN_002a2560 (109): value = acc t^2 / 2 + (the data block's rate) t + base
const valEval = (Q, t, r) => { Q.v = f(f(f(Q.acc * f(f(t * t) * 0.5)) + f(r * t)) + Q.base); };
// type 107 (data: +0x10 base, +0x14 rate, byte +0x18 GS ALPHA index, +0x19 own rectangle, +0x1a frame-buffer mode,
// +0x1b): FUN_002c1af0 -> FUN_002a3178 init, FUN_002c1b68 -> FUN_002a3258 transition (only when the new or the old
// block has +0x1a), FUN_002c1bb8 -> FUN_002a35f0 eval (only with +0x1a), FUN_002c1bd8 -> FUN_002a3690 draw
T[107] = {
  init(X, a, o) { const F = X.F; (X.p.ext ??= {})[o] = { v: F.f32(a + 0x10), base: F.f32(a + 0x10), rate: F.f32(a + 0x14), acc: ACC107 }; },
  trans(X, t, a, o, old) {
    const F = X.F, Q = valObj(X, o);
    if (Q && (F.u8(a + 0x1a) || F.u8(old + 0x1a))) valTrans(Q, t, F.f32(a + 0x10), F.f32(a + 0x14), F.f32(old + 0x10), F.f32(old + 0x14), ACC107);
  },
  eval(X, t, a, o) { const F = X.F, Q = valObj(X, o); if (Q && F.u8(a + 0x1a)) valEval(Q, t, F.f32(a + 0x14)); },
  draw: drawScreen,
};
// type 109 (data: +0 base, +4 rate): FUN_002b2910 -> FUN_002a2120 init, FUN_002b2988 -> FUN_002a21f8 transition,
// FUN_002b29d8 -> FUN_002a2560 eval; draw slot FUN_002d5730 (nothing). Its value drives type 110.
T[109] = {
  init(X, a, o) { const F = X.F; (X.p.ext ??= {})[o] = { v: F.f32(a), base: F.f32(a), rate: F.f32(a + 4), acc: ACC109 }; },
  trans(X, t, a, o, old) { const F = X.F, Q = valObj(X, o); if (Q) valTrans(Q, t, F.f32(a), F.f32(a + 4), F.f32(old), F.f32(old + 4), ACC109); },
  eval(X, t, a, o) { const F = X.F, Q = valObj(X, o); if (Q) valEval(Q, t, F.f32(a + 4)); },
};
// type 110: init 0x2b4ab8 (asm) = "the ref-2 channel's (type 109) object exists"; transition 0x2b4af0 / eval
// 0x2b4b00 are jr ra. Its draw FUN_002b4b08 -> FUN_002a2610(data, the 109 object) is a frame-buffer filter
// (the frame copied and redrawn scaled about a centre by the 109 value, iterated; FUN_00285d38 / FUN_002a2c40):
// not translated, the particle is simulated but not drawn (warned).
T[110] = { init() {}, trans() {}, eval() {},
  draw(X) { X.warn('effects: draw type 110 (frame-buffer zoom filter FUN_002a2610) not translated: not drawn'); } };

// FUN_002a3690 (type 107's draw, data +0x1a == 0): one untextured GS SPRITE through the 2D layer (FUN_00286870
// prim record, FUN_002868d0 -> FUN_002849a8 packet): the rectangle (0, 0, width, height) of display buffer 0
// (FUN_00285568(0) / FUN_002855d8(0)), or data +0 / +4 / +8 / +0xc (x, y, w, h) with +0x19; colour = the ref-0
// channel's value (FUN_002a44f8(.., 0) -> FUN_002a4510: particle +0x60 + ref slot 0) clamped to 0..255 and
// truncated (VMAX / VMINI I = 255 / VFTOI0; the record's +0x70 flag is 0, so no emitter colour); GS ALPHA
// FUN_00284d30(FUN_00284e20(data +0x18, 0, 1, 2)) = 0x44 / 0x48 / 0x42 (any other byte -> 0x44); TEST
// FUN_00284c98(4) = 0x3000d (ATE GREATER AREF 0, ZTE ZTST ALWAYS); Z 0. T: w188 dump C (f793, the hit + 4 frames):
// the sprite (1823.5, 1791.5)-(2271.5, 2303.5) = 448 x 512 (BUF0, MEASURED), RGBA (128, 30, 7, 24) = tag 0's type 17
// colour at age 6.0 truncated, ALPHA 0x48, TEST 0x3000d, drawn right after the hit's sprites.
// data +0x1a != 0 (FUN_00285d38 / FUN_00286248: the frame buffer blended with itself) is not translated (warned).
const BUF0 = { w: 448, h: 512 };
const SCISSOR = { w: 432, h: 512 };     // the scene's GS SCISSOR 0-431 x 0-511 (output.js FB_W / FB_H, every gameplay dump)
// A screen rectangle (display buffer 0's pixels, 448 wide) clipped by that SCISSOR as the GS does, in the view's clip
// space (the native view is the 432 x 512 target; full mode maps it onto its whole view): [X0, Y0, X1, Y1] or null
export function screenClip([x, y, w, h]) {
  const cl = (v, n) => Math.min(Math.max(v, 0), n);
  const x0 = cl(x, SCISSOR.w), x1 = cl(x + w, SCISSOR.w), y0 = cl(y, SCISSOR.h), y1 = cl(y + h, SCISSOR.h);
  if (!(x1 > x0 && y1 > y0)) return null;
  return [2 * x0 / SCISSOR.w - 1, 1 - 2 * y0 / SCISSOR.h, 2 * x1 / SCISSOR.w - 1, 1 - 2 * y1 / SCISSOR.h];
}
const ALPHA_IDX = [0x44, 0x48, 0x42];
function drawScreen(X, a, o, view, out) {
  const F = X.F, p = X.p, v = p.v;
  if (F.u8(a + 0x1a)) { X.warn('effects: type 107 frame-buffer mode (data +0x1a, FUN_00285d38 / FUN_00286248) not translated: not drawn'); return; }
  const c = D.refSlot(F, X.d, 0) / 4;
  const rgba = [0, 1, 2, 3].map(i => Math.trunc(Math.min(255, Math.max(0, v[c + i]))));
  const r = F.u8(a + 0x19) ? [F.s32(a), F.s32(a + 4), F.s32(a + 8), F.s32(a + 0xc)] : [0, 0, BUF0.w, BUF0.h];
  out.push({ screen: true, rect: r, buf: BUF0, rgba, alpha: ALPHA_IDX[F.u8(a + 0x18)] ?? 0x44, test: 0x3000d,
    emitter: X.em.ei, id: X.em.id, type: D.type(F, X.d), tag: p.tag });
}

// type 21, the burst: a ring of sub-sprites owned by the channel (vtable 0x49aa78: FUN_0027baa0 init,
// FUN_0027bba0 transition, FUN_0027bda0 eval, FUN_0027cd68 draw, FUN_0027bd70 destroy). The value
// slot holds the pool pointer (+0), the spawn carry (+4) and this frame's spawn amount (+8).
// Pool header (FUN_0027baa0): +4 spawn duration, +8 sub life, +0xc / +0x10 / +0x14 fade fields (set by
// the transition; nothing in the eval or draw reads them), +0x18 time since the transition, +0x1c
// capacity, +0x1e count, +0x20 start, +0x22 flag; then capacity records of 0x90 bytes from +0x30:
// +0x00 pos base (+0xc: sprite record offset), +0x10 velocity (+0x1c: age), +0x20 acceleration
// (+0x2c: u16 frame index, +0x2e: flip byte), +0x30 / +0x40 / +0x50 scale base / rate / acceleration
// (.w: rotation base / rate / acceleration, degrees), +0x60 colour, +0x70: animation clock, +0x80 colour rate.
// VU0 helpers of the spawn: FUN_00444ad0 / FUN_002d8808 normalise xyz (w = 0), FUN_00444a88 a x b.
function vnorm(v) {
  const s = f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]));
  const q = f(1 / f(Math.sqrt(s)));
  return Number.isFinite(q) ? [f(v[0] * q), f(v[1] * q), f(v[2] * q), 0] : [0, 0, 0, 0];   // L: VU DIV by 0 -> max float; 0 x max = 0
}
function vcross(a, b) { return [f(f(a[1] * b[2]) - f(b[1] * a[2])), f(f(a[2] * b[0]) - f(b[2] * a[0])), f(f(a[0] * b[1]) - f(b[0] * a[1])), 0]; }
const fbits = x => new Uint32Array(new Float32Array([x]).buffer)[0];
// FUN_002d93d0(out, origin, dir): rows side = |up x dir|, dir x side, |dir|, origin (+ the identity's row 3);
// up = (0, 1, 0) (0x46c700) when the bits of dir.x | dir.z are non-zero, else (0, 0, 1) (0x46c710)
function lookAt(dir) {
  const up = (fbits(dir[0]) | fbits(dir[2])) ? [0, 1, 0, 1] : [0, 0, 1, 1];
  const side = vnorm(vcross(up, dir)), fwd = vnorm(dir), mid = vcross(fwd, side);
  return new Float32Array([...side, ...mid, ...fwd, 0, 0, 0, 1]);
}
// FUN_002d8490 (identity) + FUN_002d7f68 (Z, then Y, then X)
const rotZYX = a => eulerT(ident(), a, [0, 0, 0], 0);
const SUB = 0x90;
function subRec() { const b = new ArrayBuffer(SUB); return { f: new Float32Array(b), i: new Int32Array(b), h: new Int16Array(b), u8: new Uint8Array(b) }; }
T[21] = {
  init(X, a, o) {                                              // FUN_0027baa0
    const F = X.F, p = X.p;
    p.ext ??= {}; p.ext[o] = null; p.i32[o] = 0;
    const ai = F.s32(a + 0xc);
    if (ai < 0 || !F.anim(ai)) return;
    const cap = F.u16(a + 0xf0);
    const pool = { dur: 0, life: 0, fade: [0, 0, 0], t18: 0, cap, count: 0, start: 0, flag: 0, recs: Array.from({ length: cap }, subRec) };
    p.v[o + 1] = 0; p.v[o + 2] = 0; p.i32[o + 3] = 0;           // +4, +8, the u16 at +0xc
    let c = p.cat;                                              // particle +0x58 = P +0xb (FUN_002e8ea8)
    if (c !== 0 && (c > 4 || c < 3)) c = -1; else c = F.u8(a + 0xfb);
    if (c === 7) pool.flag = 1;
    p.ext[o] = pool; p.i32[o] = 1;
  },
  trans(X, t, a, o) {                                          // FUN_0027bba0 (asm; not a Ghidra function)
    const F = X.F, pool = X.p.ext?.[o];
    if (!pool || (X.p.flags & 2)) return;
    const rate = F.f32(a + 0x2c), acc = F.f32(a + 0x3c);
    pool.dur = rate <= 0 ? 0 : (acc >= 0 ? -1 : f(rate / f(-acc)));   // the time the rate runs out; -1 never
    const life = F.u16(a + 0xf2);
    pool.t18 = 0; pool.life = f(life); X.p.v[o + 2] = rate;
    if (!F.u8(a + 0x110)) { pool.fade = [0, 1, 0]; return; }
    const fin = F.u8(a + 0x111), fout = F.u8(a + 0x112);
    if (fin + fout < life) pool.fade = [f(life - fout), fin ? f(1 / fin) : 1, fout ? f(1 / fout) : 0];
    else if (fout < life) { const d = f(life - fout); pool.fade = [d, f(1 / d), fout ? f(1 / fout) : 0]; }
    else pool.fade = [0, 0, f(1 / fout)];
  },
  eval(X, _t, a, o) { evalBurst(X, a, o); },
  draw(X, a, o, view, out, tex, proj) { drawBurst(X, a, o, view, out, tex, proj); },
};
function evalBurst(X, a, o) {                                  // FUN_0027bda0
  const F = X.F, p = X.p, em = X.em, v = p.v, rng = X.rng, pool = p.ext?.[o];
  const dt = em.dt;
  if (!pool || dt === 0) return;
  const ai = F.s32(a + 0xc), anim = ai >= 0 ? F.anim(ai) : 0;
  if (!anim) return;
  pool.t18 = f(pool.t18 + dt);
  const stop = pool.dur > 0 ? pool.dur < pool.t18 : pool.dur === 0;
  if (!stop) {
    const acc = F.f32(a + 0x3c);
    const amt = f(f(acc * f(f(dt * dt) * 0.5)) + f(F.f32(a + 0x2c) * dt));
    v[o + 2] = amt;
    if (amt > 0) {
      const tot = f(amt + v[o + 1]);
      if (tot < 1) v[o + 1] = tot;
      else {
        let n = Math.trunc(tot);
        const step = f(dt / tot), fc = F.u8(a + 0xfc);
        v[o + 1] = f(f(tot - n) - f(f(acc * f(f(fc * fc) * 0.5)) + f(amt * fc)));
        for (; n > 0; n--) {
          if (F.u8(a + 0xfd) < 100 && !(rng.vrInt(100) < F.u8(a + 0xfd))) continue;
          if (pool.count >= pool.cap) break;
          const r = pool.recs[(pool.count + pool.start) % pool.cap];
          pool.count++;
          spawnSub(X, a, o, pool, r, anim, f(f(step * n) - 1));
        }
      }
    }
  }
  // age the ring; the dead are counted and dropped from its front
  let dead = 0;
  for (let k = 0; k < pool.count; k++) {
    const r = pool.recs[(pool.start + k) % pool.cap];
    if (!(r.f[7] < pool.life)) { dead++; continue; }
    const len = F.u8(anim + 7);
    let c = f(r.f[28] * F.f32(a + 0x1c));
    if (f(len) <= c) {
      if (!(F.u16(anim + 2) & 0x80)) { dead++; continue; }
      r.h[22] = 0;
      const li = Math.trunc(f(len));
      c = f(c - f(li * Math.trunc(Math.trunc(c) / li)));
      r.f[28] = c;
    }
    let k2 = r.h[22] & 0xffff, e;
    if (k2 === 0) e = anim + 8;
    else { e = anim + 8 * k2; if (c < f(F.s16(e + 4))) { k2 = 0; e = anim + 8; } else e += 8; }
    while (f(F.s16(e + 4)) <= c) { k2++; e += 8; }
    r.h[22] = k2;
    r.f[7] = f(r.f[7] + dt); r.f[28] = f(r.f[28] + dt);
    r.i[3] = F.s16(e + 2);
  }
  pool.count -= dead;
  pool.start = (pool.start + dead) % pool.cap;
  if (pool.count < 0) pool.count = 0;
}
// one new sub-sprite (the body of FUN_0027bda0's spawn loop)
function spawnSub(X, a, o, pool, r, anim, age) {
  const F = X.F, p = X.p, rng = X.rng, R = r.f;
  r.h[22] = 0; R[7] = age; R[28] = age;
  r.i[3] = F.s16(anim + 0xa);
  const fl = F.u8(a + 0xfa);                                   // flip: as type 10 (VU0 R, FUN_002d9880)
  let flip = 0;
  if (fl === 1 || fl === 2) flip = rng.vrInt(0x100) < 0x80 ? 0 : fl;
  else if (fl === 3) { const q = rng.vrInt(0xff); flip = (q < 0 ? q + 0x3f : q) >> 6; }
  r.u8[0x2e] = flip;
  // FUN_0027b9b0(ctx, P+0x50, in, particle +0x58, data +0xfb, out, nrm): category 2 / 6-9 (or 0, 3, 4
  // with +0xfb == 7) go through FUN_002e3ee8 (world space; not translated), the rest copy in to out
  // and normalise it into nrm (FUN_00444ad0)
  const local = vec => {
    let c = p.cat; const fb = F.u8(a + 0xfb);
    if (fb !== 0xff && (c === 0 || (c > 2 && c < 5)) && fb === 7) c = 7;
    if (c === 2 || (c > 5 && c < 10)) { p.noDraw = 'type 21 world-space spawn (FUN_002e3ee8)'; }
    return { pos: vec, nrm: vnorm(vec) };
  };
  const shape = F.u8(a + 0xfe);
  let nrm = [0, 0, 0, 0];
  const cone = () => {                                         // a random turn of up to data +0xb0 degrees, then onto dir (data +0x10)
    const s = f(F.f32(a + 0xb0) * ANG);
    const ang = [rng.signed(s), rng.signed(s), rng.signed(s)];
    const Rr = rotZYX(ang);
    const dir = [0, 1, 2, 3].map(i => F.f32(a + 0x10 + 4 * i));
    if (dir[0] === 0 && dir[1] === 0) dir[0] = f(1e-6);
    return mul44(lookAt(dir), Rr);                               // FUN_002d8368(c40, c40, c00) = c00 . c40
  };
  if (shape === 0 || shape === 2) {                            // a box: +-data[0..2]
    const q = local([rng.signed(F.f32(a)), rng.signed(F.f32(a + 4)), rng.signed(F.f32(a + 8))]);
    R[0] = q.pos[0]; R[1] = q.pos[1]; R[2] = q.pos[2]; nrm = q.nrm;
  } else if (shape === 1 || shape === 3) {                     // a shell along the cone at radius r
    const M = cone(), d0 = F.f32(a), sw = F.u8(a + 0x100), mode = F.u8(a + 0x101);
    let rad = f(F.f32(a + 0xb0) * ANG);                          // f21 keeps the angle when +0x101 > 1
    if (!sw) { const h = f(d0 * 0.5); rad = f(rng.signed(h) + h); }
    else if (mode === 0) rad = f(d0 - f(d0 * rng.unit(f(F.u8(a + 0x102) * f(0.01)))));
    else if (mode === 1) rad = f(d0 * rng.unit(f(F.u8(a + 0x102) * f(0.01))));
    const q = local(xform(M, [0, 0, rad]));
    R[0] = q.pos[0]; R[1] = q.pos[1]; R[2] = q.pos[2]; nrm = q.nrm;
  } else if (shape !== 4 && shape !== 5) {
    X.warn(`effects: type 21 spawn shape ${shape} (FUN_0027bda0) not translated`); p.noDraw = `type 21 spawn shape ${shape}`;
  }
  for (const i of [4, 5, 6, 8, 9, 10]) R[i] = 0;
  let sp = 0, ac = 0;
  if (F.u8(a + 0x103)) { sp = F.f32(a + 0xb4); ac = F.f32(a + 0xb8); }
  if (F.u8(a + 0x104)) { sp = f(sp + rng.signed(F.f32(a + 0xbc))); ac = f(ac + rng.signed(F.f32(a + 0xc0))); }
  if (shape < 10) {
    if ([0, 1, 6, 8].includes(shape)) {                        // along the cone (1e-5, 0, 1)
      const M = cone();
      if (pool.flag) { X.warn('effects: type 21 pool flag +0x22 (FUN_002d83e0 x P+0x50, x E) not translated'); p.noDraw = 'type 21 pool flag'; }
      const d = xform(M, [f(1e-5), 0, 1]);
      for (let i = 0; i < 3; i++) { R[4 + i] = f(d[i] * sp); R[8 + i] = f(d[i] * ac); }
    } else if ([2, 3, 7, 9].includes(shape)) {                 // radial: along the spawn offset
      for (let i = 0; i < 3; i++) { R[8 + i] = f(nrm[i] * ac); R[4 + i] = f(nrm[i] * sp); }
    }
  }
  // the second direction (data +0x20, normalised) with its own speed / acceleration
  const g = [0, 1, 2].map(i => F.f32(a + 0x20 + 4 * i));
  let s2 = 0, a2 = 0;
  if (F.u8(a + 0x105)) { s2 = F.f32(a + 0xc4); a2 = F.f32(a + 0xc8); }
  if (F.u8(a + 0x106)) {
    for (let i = 0; i < 3; i++) g[i] = f(g[i] + rng.signed(F.f32(a + 0x30 + 4 * i)));
    s2 = f(s2 + rng.signed(F.f32(a + 0xcc))); a2 = f(a2 + rng.signed(F.f32(a + 0xd0)));
  }
  const gn = vnorm(g);
  for (let i = 0; i < 3; i++) { R[4 + i] = f(R[4 + i] + f(gn[i] * s2)); R[8 + i] = f(R[8 + i] + f(gn[i] * a2)); }
  // scale (percent; x / y only, z = 100), base / rate / acceleration
  R[12] = R[13] = 100; R[16] = R[17] = 0; R[20] = R[21] = 0; R[18] = 0; R[14] = 100; R[22] = 0;
  if (F.u8(a + 0x107)) for (let i = 0; i < 2; i++) { R[12 + i] = F.f32(a + 0x80 + 4 * i); R[16 + i] = F.f32(a + 0x88 + 4 * i); R[20 + i] = F.f32(a + 0x90 + 4 * i); }
  if (F.u8(a + 0x108)) {                                       // FUN_0027b820(.., mode +0x109, 2)
    const m = F.u8(a + 0x109);
    if (m === 0) {
      const r1 = rng.signed(F.f32(a + 0x98)), r2 = rng.signed(F.f32(a + 0xa0)), r3 = rng.signed(F.f32(a + 0xa8));
      for (let i = 0; i < 2; i++) { R[12 + i] = f(R[12 + i] + r1); R[16 + i] = f(R[16 + i] + r2); R[20 + i] = f(R[20 + i] + r3); }
    } else if (m === 1) for (let i = 0; i < 2; i++) {
      R[12 + i] = f(R[12 + i] + rng.signed(F.f32(a + 0x98 + 4 * i)));
      R[16 + i] = f(R[16 + i] + rng.signed(F.f32(a + 0xa0 + 4 * i)));
      R[20 + i] = f(R[20 + i] + rng.signed(F.f32(a + 0xa8 + 4 * i)));
    }
  }
  // rotation (degrees) base / rate / acceleration in the .w lanes
  R[15] = R[23] = R[19] = 0;
  if (F.u8(a + 0x10a)) { R[15] = F.f32(a + 0xd4); R[19] = F.f32(a + 0xd8); R[23] = F.f32(a + 0xdc); }
  if (F.u8(a + 0x10b)) { R[15] = f(R[15] + rng.signed(F.f32(a + 0xe0))); R[19] = f(R[19] + rng.signed(F.f32(a + 0xe4))); R[23] = f(R[23] + rng.signed(F.f32(a + 0xe8))); }
  // colour and its rate
  for (let i = 0; i < 4; i++) { R[24 + i] = 128; R[32 + i] = 0; }
  if (F.u8(a + 0x10c)) for (let i = 0; i < 4; i++) { R[24 + i] = F.f32(a + 0x40 + 4 * i); R[32 + i] = F.f32(a + 0x50 + 4 * i); }
  if (F.u8(a + 0x10d)) for (let i = 0; i < 4; i++) {
    R[24 + i] = f(R[24 + i] + rng.signed(F.f32(a + 0x60 + 4 * i)));
    R[32 + i] = f(R[32 + i] + rng.signed(F.f32(a + 0x70 + 4 * i)));
  }
}
// b + r t + (a x 0.5) t^2, lane by lane as the VU0 does it (FUN_0027cd68)
const quad = (b, r, a, t) => f(f(b + f(r * t)) + f(f(a * 0.5) * f(t * t)));
function drawBurst(X, a, o, view, out, tex, proj) {            // FUN_0027cd68
  const F = X.F, p = X.p, em = X.em, pool = p.ext?.[o];
  if (!pool) return;
  const ai = F.s32(a + 0xc), anim = ai >= 0 ? F.anim(ai) : 0;
  const depthOff = F.u8(a + 0x10e) && F.f32(a + 0xec) !== 0 ? F.f32(a + 0xec) : null;
  if (F.u8(a + 0x114)) X.warn('effects: type 21 flag +0x114 (packet flag 0x800) not translated');
  const fb = F.u8(a + 0xfb);
  for (let k = 0; k < pool.count; k++) {
    const r = pool.recs[(pool.start + k) % pool.cap], R = r.f, t = R[7];
    if (!(t < pool.life)) continue;
    const pos = [0, 1, 2].map(i => quad(R[i], R[4 + i], R[8 + i], t));
    const sc = [0, 1, 2].map(i => f(f(quad(R[12 + i], R[16 + i], R[20 + i], t) * f(0.001)) * em.scale[i]));
    const rot = f(f(f(f(f(f(R[23] * t) * t) * 0.5) + f(R[19] * t)) + R[15]) * ANG);
    let M = new Float32Array([sc[0], 0, 0, 0, 0, sc[1], 0, 0, 0, 0, sc[2], 0, 0, 0, 0, 1]);
    if (r.u8[0x2e]) M = mul33(flipMatrix(r.u8[0x2e]), M);      // FUN_00276ed8, FUN_002d83e0(c80, flip, c80)
    if (rot !== 0) M = rotZ(M, rot);                           // FUN_002d7e80
    let w = [...pos, 1];
    if (!(fb === 2 || (fb > 5 && fb < 8))) w = xform(em.m, xform(p.m50, w));   // . P+0x50 . E (no parent here)
    const vp = view.toView(w);                                  // . DAT_70003e00
    M[12] = vp[0]; M[13] = vp[1]; M[14] = vp[2]; M[15] = 1;
    let Dm = M;
    if (depthOff !== null) { Dm = M.slice(); Dm[14] = f(Dm[14] + depthOff); }
    // colour: (base + rate t) x emitter colour (+0xb0), clamped 0..255, truncated
    const rgba = [0, 1, 2, 3].map(i => Math.trunc(Math.min(255, Math.max(0, f(f(R[24 + i] + f(R[32 + i] * t)) * em.col[i])))));
    vuSprite(X, anim + r.i[3], rgba, M, Dm, out, tex, proj, em);   // FUN_00308028(anim + record offset)
  }
}
// type 137, the sparks: line strips computed by a VU1 program (vtable 0x49aad8: FUN_0027d350 init,
// FUN_0027d5d0 transition (no-op), FUN_0027d5d8 eval, FUN_0027da78 draw, FUN_0027d5a0 destroy). The CPU
// keeps a time ring (one float per frame) and per spark a 4.12 fixed-point velocity and acceleration, a
// life and its birth frame; the VU1 program (micro memory instr 649-785, entry MSCAL 8) draws each live
// spark as a line through its positions at the last L frames.
T[137] = {
  init(X, a, o) {                                              // FUN_0027d350
    const F = X.F, p = X.p;
    p.ext ??= {}; p.ext[o] = null; p.i32[o] = 0;
    let cap = (F.u16(a + 0x3c) + 0x1f) & ~0x1f;
    if (cap > 0x100) cap = 0x100;
    const blocks = cap >> 5;
    if (!blocks) return;
    const L = Math.min(F.u8(a + 0x42), 0x1e);
    let n = Math.max(cap, L);
    n = Math.max(n, Math.min(F.u16(a + 0x3e) + F.u16(a + 0x40), 0x100));
    let size = 1;                                                // the next power of two >= n (n > 1); mask = size - 1
    if (n > 1) { while ((size << 1) < n) size <<= 1; size <<= 1; }
    const mask = size - 1;
    // spark: shorts v x y z, life, a x y z, birth index (V4-16 x 2, unpacked by DAT_0046c280's VIF code)
    p.ext[o] = { cap, blocks, L, size, mask, idx: 0, carry: 0, start: 0, now: 0,
      ring: new Float32Array(size), spark: new Int16Array(cap * 8), birth: new Float32Array(cap).fill(-1000) };
    p.i32[o] = 1;
  },
  trans() {},                                                  // FUN_0027d5d0: jr ra
  eval(X, _t, a, o) { evalSparks(X, a, o); },
  draw(X, a, o, view, out, tex, proj) { drawSparks(X, a, o, view, out, proj); },
};
function evalSparks(X, a, o) {                                 // FUN_0027d5d8
  const F = X.F, em = X.em, rng = X.rng, S = X.p.ext?.[o];
  const dt = em.dt;
  if (!S || dt === 0) return;
  const i = S.idx, old = S.ring[i & S.mask];
  S.ring[(i + 1) & S.mask] = S.now = f(old + dt);
  S.idx = i + 1;
  const rate = F.f32(a + 0x34);
  let amt = f(f(rate * dt) + S.carry);
  if (amt < 1) { S.carry = amt; return; }
  const n = Math.trunc(amt), nf = f(n);
  S.carry = f(amt - f(nf * f(Math.trunc(f(amt / nf)))));            // FUN_002d9208
  S.carry = f(S.carry - f(f(F.u8(a + 0x43)) * rate));
  if (n > 0 && !rng.mt) { X.warn('effects: type 137 sparks need the effect twister state (DAT_004e9408; ids.json twister): not spawned'); X.p.noDraw = 'type 137 without the twister state'; }
  for (let j = 0; j < n && rng.mt; j++) {
    const slot = (S.start + j) % S.cap, q = slot * 8;
    S.birth[slot] = old;
    S.spark[q + 7] = i;                                        // the birth frame (short)
    S.spark[q + 3] = F.u16(a + 0x3e) + rng.vrSpan(F.u16(a + 0x40));   // life +- (FUN_002d9828)
    const s = f(F.f32(a + 0x38) * f(5.688889));
    const ang = [rng.mtSigned(s), rng.mtSigned(s), rng.mtSigned(s)];
    const d = xform(rotZYX(ang), [0, -1, 0]);                  // (0, -1, 0) turned (FUN_002d7f68, FUN_002d8578)
    const sp = f(F.f32(a + 0x28) + rng.mtSigned(F.f32(a + 0x2c)));
    let fv = f(F.f32(a + 0x20) + rng.mtSigned(F.f32(a + 0x24)));
    if (fv < -8) fv = -8; else if (f(7.9999) < fv) fv = f(7.9999);   // the 4.12 range of a short
    const acc = [0, 1, 2].map(k => f(d[k] * sp)), vel = [0, 1, 2].map(k => f(d[k] * fv));
    acc[1] = f(acc[1] + F.f32(a + 0x30));
    for (let k = 0; k < 3; k++) { S.spark[q + k] = ftoi12(vel[k]); S.spark[q + 4 + k] = ftoi12(acc[k]); }   // VFTOI12, PPACH (low halves)
  }
  S.start = (S.start + n) % S.cap;
}
const ftoi12 = x => (Math.max(-2147483648, Math.min(2147483647, Math.trunc(f(x * 4096)))) << 16) >> 16;
// The VU1 program at MSCAL 8 (instr 649-785) for one particle's sparks. Parameters (VU 0xf0-0xfa, from
// FUN_0027da78): the main matrix (FUN_002e3498 with scale 1.0), the start / end colours (data +0 / +0x10 x
// particle colour x emitter colour / 16384), L, the frame index, the ring mask, the newest time; GIF
// LINE STRIP (PRIM 0x4a: gouraud, alpha blend), ALPHA from DAT_0046c2a0[data +0x44] (0x44 / 0x48 / 0x42).
const SPARK_ALPHA = [0x44, 0x48, 0x42];
// module-level scratch for drawSparks (no per-spark / per-vertex arrays; the output keeps one object a vertex)
const SPK = { pc: new Float32Array(4), c0: new Float32Array(4), step: new Float32Array(4), v: new Float32Array(3), ac: new Float32Array(3),
  col: new Float32Array(4), pl: new Float32Array(3), pv: new Float32Array(3) };
function drawSparks(X, a, o, view, out, proj) {               // FUN_0027da78
  const F = X.F, p = X.p, em = X.em, S = p.ext?.[o], d = X.d;
  if (!S) return;
  const m14 = p.data[D.ref(F, d, 1)];
  const C = viewMatrix(X, p.m50, F.u8(m14 + 1), view, f(1), null);   // FUN_002e3498(1.0, .., mode = type 14 byte 1)
  if (!C) return;
  const ai = F.u8(a + 0x44), alpha = SPARK_ALPHA[ai];
  if (alpha === undefined) { X.warn(`effects: type 137 alpha preset ${ai} (DAT_0046c2a0) not translated`); return; }
  const cs = D.refSlot(F, d, 0) / 4, K = f(1 / 16384);         // FUN_002d8908(0x38800000)
  const Q = f(1 / f(S.L));
  const { pc, c0, step, v, ac, col, pl, pv } = SPK;
  for (let i = 0; i < 4; i++) {
    pc[i] = f(p.v[cs + i] * em.col[i]);
    c0[i] = f(f(F.f32(a + 4 * i) * pc[i]) * K);
    const c1 = f(f(F.f32(a + 0x10 + 4 * i) * pc[i]) * K);
    step[i] = f(f(c1 - c0[i]) * Q);
  }
  const nowIdx = S.idx & 0xffff, now = S.now;
  for (let s = 0; s < S.cap; s++) {
    const q = s * 8, life = f(S.spark[q + 3]);
    const age = f(now - S.birth[s]), rem = f(life - age);
    if (rem <= 0) continue;                                    // FSAND 3 (S | Z)
    const af = Math.min(f(rem / f(life * 0.5)), 1);            // MINIz with VU 0x3f4.z = 1.0
    let cnt = ((nowIdx - (S.spark[q + 7] & 0xffff)) << 16 >> 16) + 1;   // 16-bit VI maths
    if (cnt - S.L > 0) cnt = S.L;
    for (let k = 0; k < 3; k++) { v[k] = S.spark[q + k] / 4096; ac[k] = S.spark[q + 4 + k] / 4096; }   // ITOF12
    let verts = null;
    for (let k = 0; k < cnt; k++) {
      const t = f(S.ring[(nowIdx - k) & S.mask] - S.birth[s]), t2 = f(t * t);
      for (let i = 0; i < 4; i++) col[i] = f(c0[i] + f(step[i] * k));
      col[3] = f(col[3] * af);
      for (let i = 0; i < 3; i++) pl[i] = f(f(v[i] * t) + f(f(ac[i] * t2) * 0.5));
      for (let j = 0; j < 3; j++) pv[j] = f(f(f(pl[0] * C[j]) + f(pl[1] * C[4 + j])) + f(f(pl[2] * C[8 + j]) + C[12 + j]));   // xform: view space
      if (!(pv[2] > 0)) break;                                   // FMAND 0x11: w <= 0 ends the strip
      const sx = f(f(proj.fx * pv[0] / pv[2]) + proj.cx), sy = f(f(proj.fy * pv[1] / pv[2]) + proj.cy);
      if (Math.abs(sx - VU.cx) > 1536 || Math.abs(sy - VU.cy) > 1536) break;   // CLIP x2, FCAND 0x14a (guard 1536, VU 0x3f2.w)
      (verts ??= []).push({ pos: [pv[0], pv[1], pv[2]], gs: [sx, sy],
        rgba: [Math.trunc(f(col[0] * 127)), Math.trunc(f(col[1] * 127)), Math.trunc(f(col[2] * 127)), Math.trunc(f(col[3] * 127))] });   // MULi 127, FTOI0
    }
    if (verts && verts.length > 1) out.push({ line: true, verts, alpha, emitter: em.ei, id: em.id, type: 137, tag: p.tag, slot: s });
  }
}
// 119 (worker 0202): FUN_002b4de0 init picks a sub-object by data bytes +0x34 / +0x35 / +0x36 (FUN_002a49e8 /
// FUN_002a5268 / 0x49cc68) whose vtable runs its transition / eval; its draw FUN_002b4f70 (a frame-buffer mesh,
// 72 tris a particle: w198 g2 / g3, TEX0 the displayed frame 0xe00) is not decoded. MEASURED (w202_lcg): its own
// channel draws no LCG / VU0 R value in 0x270000..0x2e0000, so the particle is simulated without it (its type 24
// channel draws 1 LCG value at spawn: log 0x275684 at page frames 911..940 + 2).
const DRAWN_ELSEWHERE = { 11: 'FUN_0027a170', 100: 'FUN_002cb3f0', 119: 'FUN_002b4f70' };

// ---------------------------------------------------------------------------------------------
// The engine. One manager (DAT_004ee2e0, the FED 0x40000 is linked into it).
// reseed (worker 0198): FUN_002efc78 reseeds once a frame (FUN_002d97f8) before every manager's FUN_002e9f98;
// a second manager sharing the rng (the 2D one, DAT_004ee4a0, runs after DAT_004ee2e0) passes false.
// fed0 (worker 0200): a second FED linked into the same manager, r0000.fed (FileCode 0: the ids 0x0..0x3ffff,
// FUN_00336508's 0x1000, FUN_003365e0's 0x4800). FUN_002e62b0 -> FUN_002e5c60 picks the FED by id & 0xfffc0000
// from the manager's +0x78 list; the emitters of both share the +0x84 list. `F` is the FED of the emitter being
// run: set from em.F where each pass enters an emitter (spawn, begin, end, sprites), so the code below reads it.
export function createEffects({ fed, fed0 = null, core, warn = console.warn, twister = null, rand = null, rng = null, proj = PROJ, reseed = true } = {}) {
  const rngGiven = !!rng;
  rng ??= new EffectRng(undefined, undefined, twister, rand);
  const F0 = parseFed(fed);
  let F = F0;
  const feds = new Map([[F0.code, F0]]);
  if (fed0) { const F1 = parseFed(fed0); feds.set(F1.code, F1); }
  const tex = core ? parseCore(core) : new Map();
  for (const [k, t] of parseFedTextures(F)) tex.set(k, t);    // FUN_002eba88: the FED's own TIM2 images
  const warned = new Set();
  const warnOnce = m => { if (!warned.has(m)) { warned.add(m); warn(m); } };
  // Without rand() the frame reseed (FUN_002d97f8) cannot run: every LCG / VU0 R draw would diverge from the
  // game's from the first frame, so the page's engine spawns nothing (warned). A caller that passes its own rng
  // (the tests, with a recovered seed) runs on unreseeded, warned too.
  const noRand = rng.libc === null;
  if (noRand) warnOnce(`effects: no rand() state (data/effects/ids.json "rand": export_web_effects.py --state sea-of-flames.p2s): FUN_002d97f8 cannot reseed the effect LCG / VU0 R each frame; ${rngGiven ? 'the given LCG runs on unreseeded' : 'effects are left out'}`);
  if (!rng.mt) warnOnce('effects: no effect twister state (data/effects/ids.json "twister": export_web_effects.py --state sea-of-flames.p2s): the type 137 sparks are left out');
  const emitters = [];                        // mgr +0x84 list
  let counter = 0;                            // mgr +0x8c
  let phase = 0xc;                            // mgr +0xb0 (0xc after the draw, 5 in the logic, 9 after FUN_002efe98)
  // one context object, refilled per channel call (no handler keeps it or calls back into ctx)
  const X0 = { F, em: null, p: null, d: 0, rng, warn: warnOnce };
  const ctx = (em, p, d) => { X0.F = F; X0.em = em; X0.p = p; X0.d = d; return X0; };

  // FUN_002e62b0 (via FUN_002e6290, param_3 = id): FED by id & 0xfffc0000, group (id >> 10) & 0x7f,
  // entry id & 0x1ff -> FUN_002e63d0(age 0, mgr, fedobj, group +8, entry param record, 0)
  function spawn(id, pos) {
    if (noRand && !rngGiven) return null;                      // no rand(): left out (warned at load)
    F = feds.get((id & 0xfffc0000) >>> 0) ?? null;                // FUN_002e5c60
    if (!F) { F = F0; warnOnce(`effects: no FED for id 0x${id.toString(16)}`); return null; }
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
      F, E, ei, param, id, cat: (cat < 5) ? 0 : (cat < 9 || cat === 0xb) ? 1 : 0,
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
      P, tag: tag & 0xfff, pid: F.u16(P), flags: (tag & 0x2000) ? 0x40 : 0, list: (F.u8(P + 9) & 1) ^ 1, age: f(age),
      life: F.u16(P + 6), ev: F.u8(P + 0x21) ? 0 : -1, cat: F.u8(P + 0xb), parent: null,
      v: new Float32Array(buf), i32: new Int32Array(buf), data: [], entry: [], m50: ident(), skip: null,
    };
    if (tag & 0x2000) warnOnce('effects: spawn tag bit 0x2000 (child particles) not translated');
    // FUN_002e9db0: render categories 2 / 6-9 give the particle its own +0x54 matrix (+0x1c = itself), which
    // FUN_002e3498 then uses instead of the emitter matrix +0xe0: 6 / 8 = a copy of +0xe0 (FUN_002d8528, no
    // parent), 2 = the copy with a unit diagonal, 7 = the copy through FUN_002d86e0, 9 = identity. Every page
    // emitter stays where it spawned, so the copy equals +0xe0 (MEASURED: w188 state C, the hit's tag 0) and
    // 6 / 8 draw as category 1. 2 / 7 / 9 are simulated (their channels draw the RNGs as the game) but not drawn.
    if (p.cat === 2 || p.cat === 7 || p.cat === 9) p.noDraw = `render category ${p.cat} (FUN_002e9db0 +0x54 matrix)`;
    else if (p.cat > 9) p.skip = `render category ${p.cat}`;
    // FUN_002eb038: the init list (+0x30: count +4, entries from +8 stride 8: u8 channel, u16 data offset)
    const blk = F.list(P, 0);
    for (let j = 0; j < F.u8(blk + 4); j++) {
      const idx = F.u8(blk + 8 + 8 * j), a = blk + F.u16(blk + 8 + 8 * j + 2);
      const d = F.desc(P, idx), ty = D.type(F, d);
      p.data[idx] = a;
      const ev = T[ty];
      // an untranslated draw type (11 / 100) leaves the particle simulated, so its other channels draw the RNGs
      // as in the game (worker 0188 review: tag 5's type 23 / 24 transitions are 6 LCG draws before tag 3's type 21
      // eval), but not drawn; an untranslated channel type still skips the particle. Type 11's init / transition
      // (0x27a160 / 0x27a168) are jr ra. CORRECTION (worker 0200, MEASURED w200_lcg): type 100's eval 0x2cb3b8 ->
      // FUN_0029e630 -> FUN_0029e688 DOES draw: per new trail point 4 signed + 1 unit LCG values and a VU0 R span
      // (FUN_002d9828). w172_sound3 f789: the hit's emitter 3 tag 4 draws 25 LCG values after its type 21 eval
      // (the 25 that emitter 6 is early by on the page). Not translated (the page runs no eval for type 100).
      if (!ev) { if (!DRAWN_ELSEWHERE[ty]) p.skip = p.skip ?? `channel type ${ty}`; else p.noDraw = p.noDraw ?? `draw type ${ty} (${DRAWN_ELSEWHERE[ty]})`; continue; }
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
    const E = em.E, loopE = !!(F.u16(E) & 2), Ec = F.u16(E + 0xc);   // emitter +4 = E id: bit 1 = looping
    if (loopE && em.fade < 0 && step > 10) step = 1;              // (FUN_002ea040: +0x0a & 0x380 == 0 path)
    let dt = f(step + em.carry); em.carry = 0;
    em.age = f(em.age + dt); em.dt = dt;
    if (!(em.fade < 0)) em.noDraw = 'emitter fade (+0x28)';       // not translated (nothing on the page sets it)
    if (loopE && Ec) warnOnce('effects: looping emitter with E +0xc (fade start) not translated');
    for (const L of em.lists) for (const p of L.slice()) {
      p.age = f(p.age + dt);
      // worker 0198: a looping particle (particle +4 = P id, bit 1) of a looping emitter is not killed at its
      // life: at P +0x12 it gets flag 0x10 and FUN_002eb1d0 wraps it (list1 below). Emitter +2 bit 0x10 is
      // never set on the page; E +0xc != 0 (fade mode 3) is warned above.
      if ((p.pid & 2) && loopE && !(em.flags & 0x10) && !(Ec && F.u8(E + 0x1f) === 3 && f(Ec) <= em.age)) {
        if (!(p.age < F.u16(p.P + 0x12))) p.flags |= 0x10;
        continue;
      }
      if (Math.trunc(p.age) >= p.life) kill(em, p);
    }
    if (em.age < 0) return true;
    const dur = F.s32(E + 4);
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
    // looping emitter (E id bit 1; worker 0198): stays while +2 bit 0x10 is clear and E +0xc is 0 or not reached
    if (loopE && !(em.flags & 0x10) && (Ec === 0 || em.age < Ec)) return true;
    if (loopE) return em.lists[0].length + em.lists[1].length > 0;
    // bit 0 clear: FUN_002e6920 removes the emitter (and its particles) at its duration; bit 0 set:
    // it stays while either particle list is non-empty
    return !!(F.u16(E) & 1) && (em.lists[0].length + em.lists[1].length > 0);
  }
  // FUN_002e7cd0: the emitter matrix +0xe0 (emitter byte +1 == 0: categories below 5)
  function emitterMatrix(em) {
    const r = em.param, mode = F.u8(r + 0x1d);
    // param +0x1d == 1: only an emitter with an attached object (+0x30) takes the attach path
    // (FUN_002e80e0, then FUN_002e84a8(.., 0)); FUN_002e63d0 clears +0x30 and the flag-1 spawn
    // (FUN_002e7660, FUN_00335f40 / FUN_003361b8) never sets it, so mode 1 falls through to the
    // mode-0 code below (0x2e7cd0 asm: bVar1 == 1 && +0x30 == 0 -> the iVar2 != 0 path).
    // Mode 2 (a bone matrix, FUN_00269530) and > 2 (the matrix is not updated) are not translated.
    if (em.cat === 1) {
      // emitter byte +1 == 1 (categories 5-8 / 0xb: camera DAT_0050b4f8[1], worker 0198): +0x80 = 0, the position
      // goes to the screen offset +0x40 / +0x44 = +0x120 / +0x124 + param +0x10 / +0x14 (FUN_002e3300 adds it to
      // the projection's centre); +0x90 / +0xa0 as below; FUN_002d84f0 + FUN_002d82d0(+0xe0, +0x90, +0x80, +0xd4).
      // Param +0x1d == 1 takes FUN_002e80e0 (attached): not translated.
      if (mode === 1) { em.noDraw = 'screen emitter with param +0x1d == 1 (FUN_002e80e0)'; return; }
      em.p40 = [f(em.p120[0] + F.f32(r + 0x10)), f(em.p120[1] + F.f32(r + 0x14))];
      const r90 = [0, 1, 2].map(i => f(em.p130[i] + F.f32(r + 0x20 + 4 * i)));
      em.scale = [0, 1, 2].map(i => f(em.p140[i] * F.f32(r + 0x30 + 4 * i)));
      em.m = eulerT(scaleM(em.scale), r90, [0, 0, 0], em.d4);
      if (!em.m) { em.noDraw = `emitter rotation order ${em.d4} (FUN_002d82d0)`; em.m = ident(); }
      em.col = em.p150.slice();
      return;
    }
    if (mode >= 2) { em.noDraw = `param record mode +0x1d = ${mode} (FUN_002e7cd0)`; return; }
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
    for (const p of em.lists[1]) {
      let ia = Math.trunc(p.age);
      if (p.flags & 0x10) {                                    // FUN_002eb1d0: the wrap of a looping particle
        const P = p.P, p12 = F.u16(P + 0x12), p10 = F.u16(P + 0x10);
        events(em, p, p12 - 1);
        loopList(em, p, f(p12));
        p.flags = (p.flags & ~0x10) | 2;
        p.age = f(f(f((ia - p12) % (p12 - p10)) + f(p10)) + f(p.age - ia));
        ia = Math.trunc(p.age);
      }
      events(em, p, ia);
    }
    for (const p of em.lists[1]) runList(em, p, 2, 0x22, 'eval');
  }
  // FUN_002e9b38(t = P +0x10, P, channel type): the data block (and its entry, event index) a channel of this
  // type has at time t: the last keyframe event with time <= t that has an entry of this type (its first
  // such entry), else the init list's entry (data offset 0xffff = none). The entry returned is the last one
  // the search looked at (later events without a match overwrite it, as in the game's loop)
  function loopData(P, ty, t) {
    let entry = 0, data = 0, k = 0;
    for (let i = 0; i < F.u8(P + 0x21); i++) {
      const ev = F.event(P, i);
      if (t < F.s16(ev)) break;
      for (let j = 0; j < F.u8(ev + 4); j++) {
        const e = ev + 8 + 8 * j;
        entry = e;
        if (D.type(F, F.desc(P, F.u8(e))) === ty) { data = ev + F.u16(e + 2); k = i; break; }
      }
    }
    if (!data) {
      const blk = F.list(P, 0);
      k = 0;
      for (let j = 0; j < F.u8(blk + 4); j++) {
        const e = blk + 8 + 8 * j;
        entry = e;
        if (D.type(F, F.desc(P, F.u8(e))) === ty) { data = F.u16(e + 2) !== 0xffff ? blk + F.u16(e + 2) : 0; break; }
      }
    }
    return { data, entry, k };
  }
  // FUN_002eb6b8 kind 5 (the loop list +0x44, count +0x25) at time tEnd = P +0x12: each channel takes the data
  // it has at the loop start P +0x10 and its loop method (vtable +0x34) re-bases it; the event index +0x36 restarts
  function loopList(em, p, tEnd) {
    if (p.skip) return;
    const P = p.P, L = F.list(P, 5), p10 = F.u16(P + 0x10);
    p.ev = 0;
    for (let j = 0; j < F.u8(P + 0x25); j++) {
      const idx = F.u16(L + 2 * j), d = F.desc(P, idx), ty = D.type(F, d), h = T[ty];
      const oldE = p.entry[idx], old = p.data[idx];
      const t2 = oldE ? f(tEnd - F.s16(oldE + 4)) : tEnd;
      const r = loopData(P, ty, p10);
      let k;
      if (!r.data) k = -1;
      else {
        const t1 = r.entry ? f(p10 - F.s16(r.entry + 4)) : 0;
        p.data[idx] = r.data; p.entry[idx] = r.entry;
        if (h && h.loop) h.loop(ctx(em, p, d), t1, t2, r.data, D.slot(F, d) / 4, old);
        else if (!LOOP_NOOP.has(ty)) warnOnce(`effects: loop method of channel type ${ty} not translated`);
        k = r.k + 1;
        if (F.u8(P + 0x21) <= k) k = -1;
        else if (k < p.ev) k = p.ev;
      }
      p.ev = k;
    }
  }
  // The frame (FUN_00248110): begin() before the game logic, end() after it, then the draw.
  function begin(step = 1.2) {
    if (reseed) rng.frame();                                   // FUN_002efc78 -> FUN_002d97f8: LCG and VU0 R from rand()
    // FUN_002efc78 -> FUN_002e9f98: dt = step (emitter +0xc is 0), FUN_002ea040 per emitter
    for (const em of emitters.slice()) {
      F = em.F;
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
      F = em.F;
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
      F = em.F;
      if (em.noDraw) { warnOnce(`effects: emitter ${em.ei} with ${em.noDraw} not translated: not drawn`); continue; }
      for (const L of em.lists) for (const p of L) {
        if (p.skip) continue;
        if (p.noDraw) { warnOnce(`effects: particle with ${p.noDraw} not translated (emitter ${em.ei}): not drawn`); continue; }
        const P = p.P, Ld = F.list(P, 3);
        // FUN_002e3300: emitter byte +1 picks the camera; camera 1 (2D) with the emitter's +0x40 / +0x44 added to
        // the projection's centre (worker 0198)
        const [V, Pj] = em.cat === 1 ? [CAM2D_VIEW, cam2dProj(em.p40 ?? [0, 0])] : [view, proj];
        for (let j = 0; j < F.u8(P + 0x23); j++) {
          const idx = F.u16(Ld + 2 * j), d = F.desc(P, idx), h = T[D.type(F, d)];
          if (h && h.draw) h.draw(ctx(em, p, d), p.data[idx], D.slot(F, d) / 4, V, out, tex, Pj);
          else if (!h) warnOnce(`effects: draw type ${D.type(F, d)} not translated: not drawn`);
        }
      }
    }
    return out;
  }
  // Restart (checkpoint.js, worker 0201). GUESS: the stage reload frees every emitter and zeroes mgr +0x8c (the manager's
  // teardown / rebuild across a reload is not decoded); the RNGs run on (no reseed found on the reload path)
  const reset = () => { emitters.length = 0; counter = 0; };
  return { spawn, begin, end, update, sprites, emitters, rng, fed: F0, feds, tex, warn: warnOnce, reset };
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
  // the type 14 channel (ref 1) carries the mode bytes: FUN_002e3498(.., a3 = byte 0, t0 = byte 1 (its mode),
  // t1 = byte 2, ..) and FUN_002e3948(.., a3 = byte 1, ..) (0x2778b8 asm; worker 0188: byte 0 was read before,
  // the same value in every type 10 particle of the impacts); the colour slot is ref slot 0
  const m14 = p.data[D.ref(F, d, 1)];
  const mode = F.u8(m14 + 1), mode2 = F.u8(m14 + 1);
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
    out.push({ verts, tex: t, alpha: alphaReg, emitter: em.ei, id: em.id, type: D.type(F, X.d), tag: X.p.tag });
  }
}
// FUN_00278b50 (type 35's draw; worker 0202), per particle, in the GS dumps' order (w198 g4: four draws a letter):
//  1. the anim frame as type 10 (clock += emitter dt, x speed +4, loop flag 0x80) -> sprite record rec;
//     FUN_002e3498(0.1, .., P +0x50, the type 14 bytes) -> C (the main matrix, as type 10, no flip).
//  2. FUN_002eec78(mgr, FUN_002ef560(mgr, 5, 0), PSMCT32, w = h = DAT_0046c230[+0x10], FBMSK 0, XYOFFSET
//     DAT_0046c238[+0x10] (12.4)): the frame target is the page (64 x 64 at TBP 0x2a00 here); FUN_002eea80 clears
//     it (RGBA 0); the record is drawn into it (FUN_00308028, packet colour 0x80808080) through the matrix
//     diag(s) + (2037 (PAL, DAT_0050b4f0) / 2048, 2048, 400000), s = (size << 3) / extent (value +6).
//  3. FUN_002eec78 again with FBMSK 0xff000000 (alpha kept); the screen box of (-e/16, -e/16)..(e/16, e/16)
//     through C (FUN_002d85e8: v . M, / w, VFTOI4) is copied from frame buffer FUN_002ef560(mgr, +0x11 != 0, 1) into
//     the whole page: FUN_002792f8 sprite, TEX0 | TBW (DAT_004ec41c >> 6) | 0x664000000 (CT32, 512 x 512, TCC),
//     TEST 0x30003, ALPHA 0x80000000a8 (= Cs), ST = (box - frame XYOFFSET DAT_004ec424 / 428) / 8192.
//  4. FUN_002ee228(mgr, 0) restores the scene target; the page is drawn at the box (TEX0 page | TBW DAT_0046c240 |
//     TW = TH DAT_0046c248 | TCC, TEST 0x5000d, ALPHA DAT_0046c250[+0x12], ST 0.01..0.99, colour = the ref-0
//     colour x emitter colour clamped 0..255, truncated), +0x13 times, the box growing by (scale % x 0.01 - 1) / 2
//     of its size on each side after each draw. Z: the depth matrix's (FUN_002e3948) with +0x14, else corner 0's.
// The item lists these pieces in GS units for the page's layer (gameover_title.js renders the page pass).
// T (w198 dump g4, f1050): see test_gameover ('glow'): page draws, the copy box, ST, colours.
// The VU / FPU round toward zero (worker 0202): a float32 of x, one ulp toward zero when round-to-nearest went outward.
// The glow's last steps use it (T: the w198 dumps' page corners / boxes; with round-to-nearest 1/16 px off at some edges).
function rz(x) {
  const r = Math.fround(x);
  if (!isFinite(r) || r === x || Math.abs(r) <= Math.abs(x)) return r;
  const b = new Float32Array([r]), u = new Uint32Array(b.buffer); u[0] -= 1; return b[0];
}
const GLOW = { size: [256, 128, 64, 32], xyoff: [30720, 31744, 32256, 32512], tbw: [4, 2, 1, 1], tw: [8, 7, 6, 5],
  alpha: [0x48, 0x42, 0x88], cx: 2037, cy: 2048, z: 400000, frame: [1824, 1792] };   // DAT_0046c230..0x46c250 (ELF; ALPHA FIX 0x80)
function drawGlow(X, a, o, view, out, tex, proj) {
  const F = X.F, p = X.p, em = X.em, v = p.v, I = p.i32, d = X.d;
  const ai = F.s32(a), anim = ai >= 0 ? F.anim(ai) : 0;
  if (!anim) return;
  const m14 = p.data[D.ref(F, d, 1)], mode = F.u8(m14 + 1);
  const C = viewMatrix(X, p.m50, mode, view, f(0.1), null);
  if (!C) return;
  v[o] = f(v[o] + em.dt);
  let ft = f(v[o] * F.f32(a + 4));
  const nfr = F.u8(anim + 7);
  let k = I[o + 1] & 0xffff;
  if (nfr <= ft) {
    if (!(F.u16(anim + 2) & 0x80)) return;
    v[o] = f(Math.trunc(ft) % Math.trunc(f(nfr)));
    I[o + 1] &= ~0xffff; k = 0;
    ft = f(v[o] * F.f32(a + 4));
  }
  while (f(F.s16(anim + 8 + 8 * k + 4)) <= ft) k++;
  I[o + 1] = (I[o + 1] & ~0xffff) | k;
  const rec = anim + F.s16(anim + 8 + 8 * k + 2);
  const si = F.u8(a + 0x10), size = GLOW.size[si], ext = (I[o + 1] >>> 16) & 0xffff;
  if (si > 3) return;
  // 2. the record into the page (VU1 with the 0x102 packet: no projection, Z from the matrix)
  const vif = F.vif ??= new Map();
  let mem = vif.get(rec);
  if (mem === undefined) { mem = parseVif(F, rec, F.u16(rec + 8), X.warn); vif.set(rec, mem); }
  if (!mem) return;
  const s = rz((size << 3) / ext), off = GLOW.xyoff[si] / 16;
  const page = [];
  for (let j = 0; j < F.u8(rec + 4); j++) {
    const q = 0x40 + 6 * j;
    const ftoi4 = x => Math.trunc(x * 16) / 16;                   // the VU1 program's FTOI4 (GS 12.4)
    // GUESS (rounding only): the VU1 accumulate taken as rounding toward zero at each step; T: dumps 3-5, 24 / 32 glows' page
    // rectangles exact, the rest 1/16 px off at the page's bottom edge (2080 vs 2079.9375; round-to-nearest: 8 / 32 exact).
    // Two attempts, not closed
    const xs = [0, 1, 2, 3].map(c => ftoi4(rz(rz(rz(mem.i(q + c, 0) / 16) * s) + GLOW.cx)) - off);
    const ys = [0, 1, 2, 3].map(c => ftoi4(rz(rz(rz(mem.i(q + c, 1) / 16) * s) + GLOW.cy)) - off);
    const tex0 = [mem.w(0xc0 + j, 0) >>> 0, mem.w(0xc0 + j, 1) >>> 0];
    const t = tex.get(`${tex0[1].toString(16)}:${tex0[0].toString(16)}`);
    if (!t) { X.warn('effects: glow sprite TEX0 not in the FED / core_ef.bin'); continue; }
    page.push({ x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)],
      uv0: [f(mem.i(q + 4, 0) / 4096), f(mem.i(q + 4, 1) / 4096)], uv1: [f(mem.i(q + 5, 0) / 4096), f(mem.i(q + 5, 1) / 4096)],
      rgba: [0, 1, 2, 3].map(i => mem.b(0xa0 + 2 * j, i)), alpha: mem.i(0xa1 + 2 * j, 0) & 0xff, tex: t });
  }
  // 3. the box (12.4): the two corners through 0x70003c30 = C . S (S: the camera's view-screen matrix, sceVu0ViewScreenMatrix
  // layout: x fx, y fy, z row (cx, cy, zB, 1), w row (0, 0, zA, 0)), FUN_002d85e8: VMULA / VMADDA (the corner's x, y, 0, 1),
  // VDIV Q = 1 / w, VMULq, VFTOI4 (truncation). T: the w198 dumps' draw-back XY, exact (C . S then / w; fx x / z + cx was
  // a 12.4 unit off at one corner in two dumps)
  const e16 = f(ext * 0.0625);
  const S = new Float32Array([proj.fx, 0, 0, 0, 0, proj.fy, 0, 0, proj.cx, proj.cy, proj.zB, 1, 0, 0, proj.zA, 0]);
  const M = mul44(S, C);
  const scr = [[-e16, -e16], [e16, e16]].map(([x, y]) => {
    const pv = [0, 1, 2, 3].map(j => rz(rz(rz(x * M[j]) + rz(y * M[4 + j])) + M[12 + j]));   // ACC = x m0 + y m1 (+ 0 m2) + m3
    const q = rz(1 / pv[3]);
    return [Math.trunc(rz(pv[0] * q) * 16), Math.trunc(rz(pv[1] * q) * 16), pv[3]];
  });
  if (!(scr[0][2] > 0)) return;
  let [x0, y0] = scr[0], [x1, y1] = scr[1];
  const w = x1 - x0, h = y1 - y0;
  const copy = { box: [x0, y0, w, h], frame: F.u8(a + 0x11) !== 0 ? 1 : 0,
    st: [f((x0 - GLOW.frame[0] * 16) * 0.00012207031), f((y0 - GLOW.frame[1] * 16) * 0.00012207031),
         f(f((x0 - GLOW.frame[0] * 16) * 0.00012207031) + f(w * 0.00012207031)), f(f((y0 - GLOW.frame[1] * 16) * 0.00012207031) + f(h * 0.00012207031))] };
  // 4. the draw-back boxes and the colour
  const colSlot = D.refSlot(F, d, 0) / 4;
  const rgba = [0, 1, 2, 3].map(i => Math.trunc(Math.min(255, Math.max(0, f(v[colSlot + i] * em.col[i])))));
  if (F.u8(a + 0x14)) X.warn('effects: type 35 depth matrix (data +0x14, FUN_002e3948) not translated: corner 0 depth');
  const grow = f(f(f(F.f32(a + 8) * 0.01) - 1) * 0.5), boxes = [];
  for (let r = 0; r < F.u8(a + 0x13); r++) {
    boxes.push([x0, y0, x1, y1]);
    const dx = Math.trunc(f(w * grow)), dy = Math.trunc(f(h * grow));
    x1 += dx; x0 -= dx; y1 += dy; y0 -= dy;
  }
  const ai2 = F.u8(a + 0x12);
  out.push({ glow: true, size, page, copy, boxes, rgba, z: scr[0][2], alpha: GLOW.alpha[ai2] ?? -1,
    tbw: GLOW.tbw[si], tw: GLOW.tw[si], emitter: em.ei, id: em.id, type: 35, tag: p.tag });
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
    if (m !== undefined) return m;
    const A = alpha & 3, B = (alpha >> 2) & 3, Cc = (alpha >> 4) & 3, Dd = (alpha >> 6) & 3;
    // GS ALPHA (A - B) x C + D (FIX 0x80): 0x44 (Cs - Cd) As + Cd, 0x48 Cs As + Cd, 0x42 (0 - Cs) As + Cd = Cd - Cs As
    let blend;
    if (A === 0 && B === 1 && Cc === 0 && Dd === 1) blend = [THREE.SrcAlphaFactor, THREE.OneMinusSrcAlphaFactor, THREE.AddEquation];
    else if (A === 0 && B === 2 && Cc === 0 && Dd === 1) blend = [THREE.SrcAlphaFactor, THREE.OneFactor, THREE.AddEquation];
    else if (A === 2 && B === 0 && Cc === 0 && Dd === 1) blend = [THREE.SrcAlphaFactor, THREE.OneFactor, THREE.ReverseSubtractEquation];
    else { this.fx.warn(`effects: GS ALPHA 0x${alpha.toString(16)} not translated: not drawn`); this.mats.set(key, null); return null; }
    m = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.texture(t) } },
      vertexShader: 'attribute vec4 rgba; varying vec4 vC; varying vec2 vUv; void main() { vC = rgba; vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      // texels and vertex colour in GS units (0..255, alpha 0..128 = 1.0): modulate, clamp, alpha test
      fragmentShader: 'uniform sampler2D map; varying vec4 vC; varying vec2 vUv; void main() { vec4 t = floor(texture2D(map, vUv) * 255.0 + 0.5); vec4 c = min(floor(t * vC / 128.0), 255.0); if (c.a <= 0.0) discard; gl_FragColor = vec4(c.rgb / 255.0, c.a / 128.0); }',
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,   // the GS has no culling; game view -> three view flips the winding
      blending: THREE.CustomBlending,
      blendEquation: blend[2], blendSrc: blend[0], blendDst: blend[1],
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
    const all = this.last = this.fx.sprites({ toView, toViewMatrix });   // .last: the page tests
    const list = [], lines = [];
    const screens = [], glows = [];
    for (const s of all) (s.glow ? glows : s.screen ? screens : s.line ? lines : list).push(s);
    // one draw order over the sprites, lines and screen sprites: the draw pass's (worker 0200 review)
    this.ord = new Map(all.map((s, i) => [s, i]));
    this.lines(lines, w);
    this.screens(screens, all);
    // type 35 (worker 0202): drawn by a layer with a frame source (gameover_title.js TitleLayer.glows)
    if (this.glows) this.glows(glows, camera); else if (glows.length) this.fx.warn('effects: type 35 glow needs a layer with the previous frame (TitleLayer): not drawn');
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
      const mat = this.material(s.tex, s.alpha);
      if (!mat) { mesh.visible = false; return; }
      mesh.material = mat;
      mesh.renderOrder = 1000 + (this.ord?.get(s) ?? i);              // GUESS: draw buckets (FUN_002e1d88) not decoded: spawn order
    });
  }
  // the type 137 sparks: GS LINE STRIPs, gouraud, untextured: the vertex colour as is (alpha 0x80 = 1.0;
  // the VU1 program can give alpha above 0x80, so the colour is premultiplied here and blended with
  // factor 1, as the GS computes Cs x As)
  lineMaterial(alpha) {
    const THREE = this.THREE;
    this.lmats ??= new Map();
    let m = this.lmats.get(alpha);
    if (m !== undefined) return m;
    let src = THREE.OneFactor, dst, eq = THREE.AddEquation;
    if (alpha === 0x48) dst = THREE.OneFactor;                                     // Cs As + Cd
    else if (alpha === 0x44) dst = THREE.OneMinusSrcAlphaFactor;                   // (Cs - Cd) As + Cd
    else if (alpha === 0x42) { dst = THREE.OneFactor; eq = THREE.ReverseSubtractEquation; }   // Cd - Cs As
    else { this.fx.warn(`effects: GS ALPHA 0x${alpha.toString(16)} for lines not translated: not drawn`); this.lmats.set(alpha, null); return null; }
    m = new THREE.ShaderMaterial({
      vertexShader: 'attribute vec4 rgba; varying vec4 vC; void main() { vC = rgba; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec4 vC; void main() { float a = vC.a / 128.0; gl_FragColor = vec4(vC.rgb / 255.0 * a, min(a, 1.0)); }',
      transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendEquation: eq, blendSrc: src, blendDst: dst,
    });
    this.lmats.set(alpha, m);
    return m;
  }
  // type 107's screen sprites (worker 0200): flat colour over the rectangle of display buffer 0 (the game's whole
  // frame = the page's whole 3D view), TEST ATE GREATER AREF 0 (alpha 0 not drawn), ZTST ALWAYS (no depth test),
  // ALPHA as the lines (premultiplied, factor 1). Drawn in clip space.
  screenMaterial(alpha) {
    const THREE = this.THREE;
    this.smats ??= new Map();
    let m = this.smats.get(alpha);
    if (m !== undefined) return m;
    const l = this.lineMaterial(alpha);
    if (!l) { this.smats.set(alpha, null); return null; }
    m = new THREE.ShaderMaterial({
      uniforms: { rgba: { value: new THREE.Vector4() } },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform vec4 rgba; void main() { float a = rgba.a / 128.0; gl_FragColor = vec4(rgba.rgb / 255.0 * a, min(a, 1.0)); }',
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,   // the GS has no culling
      blending: THREE.CustomBlending, blendEquation: l.blendEquation, blendSrc: l.blendSrc, blendDst: l.blendDst,
    });
    this.smats.set(alpha, m);
    return m;
  }
  screens(list, all) {
    const THREE = this.THREE;
    this.spool ??= [];
    while (this.spool.length < list.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
      g.setIndex([0, 1, 2, 2, 1, 3]);
      const mesh = new THREE.Mesh(g); mesh.frustumCulled = false;
      this.spool.push(mesh); this.group.add(mesh);
    }
    this.spool.forEach((m, i) => { m.visible = i < list.length; });
    list.forEach((s, i) => {
      const mesh = this.spool[i], P = mesh.geometry.attributes.position.array;
      const c = screenClip(s.rect);
      if (!c) { mesh.visible = false; return; }
      const [X0, Y0, X1, Y1] = c;
      P.set([X0, Y0, 0, X1, Y0, 0, X0, Y1, 0, X1, Y1, 0]);
      mesh.geometry.attributes.position.needsUpdate = true;
      const proto = this.screenMaterial(s.alpha);
      if (!proto || !(s.rgba[3] > 0)) { mesh.visible = false; return; }    // ATE GREATER AREF 0
      mesh.material = mesh.userData.alpha === s.alpha ? mesh.material : proto.clone();
      mesh.userData.alpha = s.alpha;
      mesh.material.uniforms.rgba.value.set(...s.rgba);
      mesh.renderOrder = 1000 + (this.ord?.get(s) ?? i);              // GUESS: draw buckets not decoded (as the sprites)
    });
  }
  lines(list, w) {
    const THREE = this.THREE;
    this.lpool ??= [];
    while (this.lpool.length < list.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 30), 3));
      g.setAttribute('rgba', new THREE.BufferAttribute(new Float32Array(4 * 30), 4));
      const line = new THREE.Line(g); line.frustumCulled = false;
      this.lpool.push(line); this.group.add(line);
    }
    this.lpool.forEach((l, i) => { l.visible = i < list.length; });
    list.forEach((s, i) => {
      const line = this.lpool[i], g = line.geometry;
      const P = g.attributes.position.array, C = g.attributes.rgba.array;
      s.verts.forEach((vx, j) => {
        const [x, y, z] = [vx.pos[0], -vx.pos[1], -vx.pos[2]];
        P[3 * j] = w[0] * x + w[4] * y + w[8] * z + w[12];
        P[3 * j + 1] = w[1] * x + w[5] * y + w[9] * z + w[13];
        P[3 * j + 2] = w[2] * x + w[6] * y + w[10] * z + w[14];
        for (let k = 0; k < 4; k++) C[4 * j + k] = vx.rgba[k];
      });
      g.setDrawRange(0, s.verts.length);
      g.attributes.position.needsUpdate = g.attributes.rgba.needsUpdate = true;
      const mat = this.lineMaterial(s.alpha);
      if (!mat) { line.visible = false; return; }
      line.material = mat;
      line.renderOrder = 1000 + (this.ord?.get(s) ?? i);              // GUESS: draw buckets not decoded (as the sprites)
    });
  }
}

// for the tests: the matrix helpers
export const _internals = { eulerT, scaleM, sincos, T };

// Effect ids at the game's call sites, read from the user's ELF by the exporter (data/effects/ids.json):
// FUN_00336040 table 0x4a0c68 [material * 2 + floor]; FUN_003363d0 table 0x4a0cd8 [(bullet +0x150 >> 16) & 3].
//
// FUN_00260c38(normal): (int)(normal.y bits ^ 0x80000000) > 0x3f666666 (0.9f), i.e. -n.y > 0.9f: the hit faces up
// (the game's y points down). `normal` is the game's hit normal (bullet +0x100 = DAT_004e8810, FUN_0026f8a0:
// normalize(VU0 vf22)). DECODED: the VU0 micro program (_vcallms 0xa90; port/vu/tools/vudis.py on a save's
// vu0MicroMem) builds vf13 = v1 - v0 (instr 368), vf25 = v2 - v0 (371), OPMULA / OPMSUB vf13 = vf13 x vf25 (375-376)
// and vf22 = vf00 - vf13 (420): -(v1 - v0) x (v2 - v0), no branch on the sign, so a back-face hit has the same sign
// (quads: 448 / 451, 456 / 458, 507). T: 7 save states (DAT_004e8810 vs the triangle at DAT_004e8830..). collision.js's
// normal is +(v1 - v0) x (v2 - v0) in the same vertex order, so play.js's roomRay hands the negated page normal.
// Open: the program's back-face culling (instr 396-415) vs the page's double-sided segment test.
export function floorHit(normal) {
  return f(-normal[1]) > f(0.9);
}

// FUN_00336478 (bullet +0x140 bits 7-10 == 0): the wall impact id for a material and the hit normal.
export function wallImpactId(ids, mat, normal, warn) {
  if (!normal) {
    if (warn) warn('effects: wall impact without a hit normal (old roomRay): FUN_00260c38 cannot run; no effect');
    return -1;
  }
  const t = ids && ids.wall;
  return t ? t[(mat & 0xf) * 2 + (floorHit(normal) ? 1 : 0)] ?? -1 : -1;
}

// FUN_003361b8(point, bullet, kind): a bullet hitting a character (FUN_0055db50, FUN_005720c8, FUN_0056c3f0 pass
// kind = (*(actor +0x19c) << 16) >> 28, the hit zone record's nibble; 0 without a record). kind != 0 ->
// FUN_00336040(kind, 0) = the wall table [kind x 2]; else FUN_003363d0 (bullet +0x140 bits 7-10 == 0 on the page's
// bullets) = the hit table [cls], cls = bullet +0x150 bits 16-17 = the shooter's W+0x14 >> 2 & 3 (FUN_00552dd8).
// T: w193_fxhits (Vincent, class 1, hits #66 / #67: 0x41800 = hit[1]); w174_pain_a (#66, class 3: 0x40c00).
export function hitImpactId(ids, kind, cls, warn) {
  if (kind < 0) {
    // FUN_00336040 indexes its stack copy of the table with a negative index (not data)
    if (warn) warn(`effects: hit zone effect nibble ${kind} < 0 (FUN_00336040 reads off its table); no effect`);
    return -1;
  }
  const t = kind ? ids && ids.wall : ids && ids.hit;
  return t ? t[kind ? kind * 2 : cls & 3] ?? -1 : -1;
}
