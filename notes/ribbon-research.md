# FED channel types 59 / 60: path node and jagged ribbon (the EM barrier's beams)

Code: `native/web/effects_ribbon.js` (`T59`, `T60`; wire as `T[59] = T59`, `T[60] = T60` in effects.js).
Data: FED `07670c03` (`extract/_KEL/noPath/07670c03.bin`), emitter 0. Part 1 (tag 1) = channels 1 4 7 14 **59**
(type 59 data at FED +0xb80); part 2 (tag 2, a type 18 child of tag 3, life 8) = 3 4 7 16 14 **60** (type 60 data at
+0xd90, 0xd0 bytes, refs [[3,128],[0,0],[1,64],[2,96],[4,176]]).

Grades used below: **MEASURED** (checked against RAM), **L** (likely: read from code, not checked at run time),
**G** (guess).

## Vtables (RAM table DAT_0046c398)

| type | vtable | +0xc init | +0x14 trans | +0x1c eval | +0x24 draw | +0x2c destroy | +0x34 loop |
|---|---|---|---|---|---|---|---|
| 59 | 0x49ef98 | FUN_002d1970 | FUN_002d1a10 | FUN_002d1a30 | 0x2d5730 (no-op) | FUN_002d19e8 | 0x2d1a60 (returns 1) |
| 60 | 0x49ef20 | FUN_002d1638 | FUN_002d1760 | FUN_002d17c0 | FUN_002d17e0 | FUN_002d1708 | FUN_002d1790 |

Channel call registers: init / trans / eval / draw get (a0 handler, a1 mgr DAT_004ec058, a2 data, a3 value ptr).
The loop (FUN_002eb6b8 kind 5) gets (f12 t1, f13 t2, a0 handler, a1 mgr, a2 new data, a3 value ptr, t0 old data).
`mgr +0xa4` = the current emitter, `+0xa8` the current particle, `+0xac` the current descriptor.

## Type 59: a path node

Object (0x30, FUN_002a7fd0): **+0x10** point (qword), **+0x20** relative flag, **+0x24** next node (another type 59 / 60
value word). The value slot's word 0 points at it (the page: `p.ext[slot]`).

Data: +0 / +4 / +8 random ranges; s16 **+0xc** linked tag (< 0: none); s16 **+0xe** linked channel index; u8 **+0x1c**
relative flag; u8 **+0x1d** point mode; u8 **+0x1e** random kind; u8 **+0x1f** link kind. Barrier: all 0, +0xc = -1.

- init FUN_002d1970: alloc; obj +0x24 = FUN_0028f3f0(mgr, data); FUN_0028f3b0(obj, data).
- FUN_0028f3f0: +0x1f != 0 -> FUN_0028f790 (**not translated**, warned). Else search the current emitter's particle
  lists in the order DAT_0049b9f8 = {2, 1} (emitter +0x68, +0x64; `+0x40` = part def, part +4 = tag) for the first
  particle whose part tag == +0xc & 0xfff; return that particle's value word of channel +0xe (`p + 0x60 +
  desc[+0xe] +4`).
- FUN_0028f3b0 = FUN_0028f4d8, then obj +0x20 = (data +0x1c != 0). trans FUN_002d1a10 = FUN_0028f3b0.
- FUN_0028f4d8(obj, data), M = current particle +0x50 (p.m50): +0x1d == 0 -> obj +0x10 = FUN_002d8578(M, 0x49cf00 =
  (0,0,0,0)) = M row 3. Else +0x1e: 0 -> (FUN_002d98c8(+0), (+4), (+8), 1), 1 -> FUN_002d9938 x 3, 2 -> negated
  FUN_002d9938 x 3; through FUN_002d8578 (w = 1). Other kinds: nothing written.
- eval FUN_002d1a30: FUN_0028f4d8 unless mgr word 0 bit 0 (**L**: clear in play; effects.js reads type 103's the same way).

## Type 60: the ribbon

Value slot: word 0 = **B** (0xa0, FUN_0028b978), word 1 = **A** (0xdc, FUN_002895c0). The page: `p.ext[slot] = {A, B}`.

### A (FUN_002895c0, vtable 0x49b7b0 at A +0x10: +0xc 0x289b00 dtor, +0x14 0x289c20, +0x1c 0x289ca8 eval, +0x24
0x28b1a8 count, +0x2c 0x28b090 drawn path)

| off | meaning |
|---|---|
| +0x14 | mgr |
| +0x18 | curve: A +0x1c (vtable 0x49b940, data +0xc4 == 0) or A +0x54 (0x49b618, else) |
| +0x1c.. | curve 0x49b940: +0x24 cap 8, +0x28 end, +0x2c begin, +0x30.. inline vector of node pointers |
| +0x8c | helper: 0x49b778 (data +0xc0 == 0; methods +0x14/+0x1c/+0x24/+0x2c = `jr ra`) or FUN_00288b70 |
| +0x90 | helper: 0x49b758 (data +0xbe == 0; +0x14 = 0x28b268 `jr ra`) or FUN_0028b2d0 |
| +0x94 | built path {+0x98 cap, +0x9c end, +0xa0 begin}, 16-byte points |
| +0xa8 | kept path {+0xac, +0xb0, +0xb4} (used with data +0xbd) |
| +0xbc | drawn path {+0xc0, +0xc4 end, +0xc8 begin} |
| +0xd0 / +0xd4 | head / tail length |
| +0xd8 | rebuild counter |

Each path holds (nodes + 1) x 0x10 points (FUN_002f3068 on the mgr +0x1c pool). Points are relative to the beam
particle's origin.

- Curve init 0x28b680 (vt +0x14): the particle tagged s16 data **+0x8a** (lists {2, 1} = DAT_0049b928), its channel
  s16 **+0x8c**'s value word = the first node; then each node's +0x24. None -> 0 -> A init fails -> FUN_002d1638
  returns false -> FUN_002eb038 destroys the inited channels and drops the spawn (page: `p.skip`).
- FUN_00289c40 (end of init; also A vt +0x14 = the transition FUN_002d1760, and the loop FUN_002d1790 which calls
  its own transition): if particle +2 & 2 (wrapped) and FUN_002e95d0 == 0 (the channel's current keyframe entry
  start is <= keyframe event 0's time, FUN_002e9570), reset +0xd0 = +0xd4 = 0 and empty the built / kept paths.

### B (FUN_0028b978)

+4 mgr, +8 A, **+0xc** = the ref-0 channel's value (particle +0x60 + refSlot 0: the type 16 colour), +0x14..+0x38
width tables (data +0xb1 / +0xb2), +0x80.. TEX0 / UV rect (data +0xb7, FUN_0028bbb0), **+0x40 / +0x50 / +0x60 / +0x70**
colours (eval).

### Data (0xd0 bytes; barrier values in brackets)

| off | meaning |
|---|---|
| +0x00 | glow colour RGBA, x channel colour / 128 -> B +0x40 [32 64 128 64]; B +0x50 = the same, alpha 0 |
| +0x10 | core colour -> B +0x60 [128 128 128 255] |
| +0x20 | tip colour: the first strip vertex takes it raw, the last B +0x70 (= it x channel colour / 128) [32 96 128 0] |
| +0x30..+0x38 | [100 100 100] not read on the translated path |
| +0x3c | outer width (half = glow band) [2.0] |
| +0x40 | core width; 0 selects draw FUN_0028d7d0 [0.1] |
| +0x44 / +0x48 / +0x4c | width random range / blend (+0xb1 / +0xb2) [0.5 1.0 1.0] |
| +0x50 | node offset length (+0xb3) [100] |
| +0x54 | length cap (+0xb4) [100] |
| +0x58 | head growth per eval [8.0] |
| +0x5c | jaggedness divisor: displacement = segment length / +0x5c [8.0] |
| +0x60 | texture (+0xb7, FUN_002ebb18) [-1] |
| +0x64 | end-cap fraction [0.9] |
| +0x68 | kept-path blend (+0xbd) [0.5] |
| +0x6c | passed to the +0x90 helper [1.0] |
| +0x70..+0x78, +0x96, +0x98, +0xbf | FUN_0028b2d0's parameters (+0xbe) |
| u16 +0x88 | width refresh period (+0xb1) [0] |
| s16 +0x8a / +0x8c | node particle tag / channel [1 / 4] |
| u16 +0x8e..+0x94 | texture UV rect (+0xb7) |
| u8 +0xb0 | draw: 0 FUN_0028d678, else by +0x40 [1] |
| u8 +0xb1 / +0xb2 / +0xb3 | random widths / width blend / fixed node offset [0 0 0] |
| u8 +0xb4 / +0xb5 | length cap on / cap the head instead of moving the tail [0 1] |
| u8 +0xb6 | subdivision depth (2^n segments per node) [2] |
| u8 +0xb7 | textured [0] |
| u8 +0xba | GS ALPHA index (FUN_00284e20 / FUN_00284d30: 0 0x44, 1 0x48, 2 0x42) [1] |
| u8 +0xbb / +0xbc / +0xbd | rebuild on / every n evals / keep previous path [1 1 0] |
| u8 +0xbe / +0xc0 / +0xc4 / +0xc5 | helper / curve variants [0 0 0 0] |

### Eval: FUN_002d17c0 -> FUN_0028bce0(B, data)

```
if !(mgr word0 & 1): FUN_00289ca8(A)          # L: bit clear
    FUN_0028a3d0: rebuild = both paths empty; if +0xbb: if ++d8 >= +0xbc: d8 = 0, rebuild
                  (+0xbd branches not translated)
        FUN_0028a740: origin = m50 . (0,0,0,1); path = [(0,0,0,1)]   (+0xc4 == 0)
                      prev = origin
                      for node: s = prev - origin, e = node.pt - origin   (VSUB.xyz, w kept)
                                FUN_0028ae28(|s - e| / +0x5c, s, e, +0xb6); push e; prev = node.pt
        FUN_0028ae28(dist, s, e, depth): if depth: mid = s + (e - s) * 0.5 (xyz, w = s.w)
                      r = (FUN_002d98c8(1), (1), (1)); mid += r / |r| * dist (VRSQRT)
                      recurse(dist/2, s, mid); push mid; recurse(dist/2, mid, e)
    FUN_00289dc8: d0 += +0x58; [+0xb4 cap]; drawn = [p0]; rem = d0
                  per segment: L = |next - prev|; rem -= L
                     rem <= 0: push prev + unit(next - prev) * (rem + L); stop
                     else push next
                  (the tail cut with +0xb4 && !+0xb5 is translated too)
    then helpers +0x90 / +0x8c vt +0x14: jr ra
FUN_0028c318: +0xb1 == 0 -> return
B+0x40 = clamp(chan * data+0x00/128, 0, 255) (FUN_0028e5a0: VMUL.xyzw, VMAXx / VMINIx)
B+0x60 = .. data+0x10, B+0x70 = .. data+0x20; B+0x50 = B+0x40 with w = 0
```

So the barrier beam is a lightning bolt: from the beam particle to the tag-1 node, 4 segments of midpoint
displacement, re-randomised every eval, growing 8 units per eval from the origin (life 8).

### Draw: FUN_002d17e0 -> FUN_0028bd90(B, data, M)

- M = FUN_002e3708(1.0, mgr, particle, m50, type-14 bytes 0/1/2 (descriptor ref 4's data), out). Byte 1 = mode:
  0 (barrier) = (m50 . S(1)) . E . V (E = emitter +0xe0 or particle +0x1c's +0x54; V = 0x70003e00); 1 = rows 0-2 x
  emitter +0xa0, row 3 through E then V; 2 not translated. Same as FUN_002e3498 (effects.js `viewMatrix`).
- A vt +0x24 (0x28b1a8: built path count) != 0; the drawn path (0x28b090) needs >= 2 points. Scratch (mgr +0x24,
  0x10000 bytes): five lists of n qwords: +0x00 row0, +0x10 row1, +0x20 row2, +0x30 row3, +0x40 points through M
  (FUN_002d8578).
- +0xb0 == 0 -> FUN_0028d678; +0x40 == 0 -> FUN_0028d7d0; else **FUN_0028d9b8**; +0xb7 == 0 -> untextured (barrier).
- FUN_0028dc08 (+0xb1 == 0): w1 = +0x3c / 2, w2 = +0x40 / 2; FUN_002a7ec0 at each point with (prev, next) =
  (p0, p1) / (p[i-1], p[i+1]) / (p[n-2], p[n-1]).
- **FUN_002a7ec0**: d = next - prev; a = **|vf7 - cur|** (VSUB then VABS.xyzw); n = **|d x a|** (VOPMULA / VOPMSUB
  .xyz, then VABS.xyzw); dot = |unit(d) . unit(a)|; dot > 0.9 -> w1, w2 x (1 - dot) x 9.999998; row0/1 = cur -/+
  unit(n) w1, row2/3 = cur -/+ unit(n) w2. (Both VABS are in the code: raw words 0x4be949fd etc.; the recompiler names
  them vabs too.)
- FUN_0028e608: a GS packet: COLCLAMP (0x46) = 1, ALPHA = 0x48 for +0xba = 1. FUN_00281f30(ctx, I, emitter +0xb0):
  ctx +0x10 = S (*0x70003e04, view -> screen), ctx +0x50 = emitter colour, ctx +0x70 = clip matrix from camera
  DAT_0050b4f8[em +1]: k = near x 1024 / fx, m00 = m11 = 2near / 2k, m22 = (far + near) / (far - near), m23 = 1,
  m32 = far x near x -2 / (far - near), m33 = 0 (camera 0: near 1, far 30000, fx 299.97: MEASURED r03_key2).
- Three **FUN_0028cf78** strips: (row2, row3; B+0x60, B+0x60), (row0, row2; B+0x50, B+0x40), (row3, row1; B+0x40,
  B+0x50). FUN_0028c9c8 caps: c0 = p0, c3 = p[n-1], c1 = A0 + unit(A1 - A0) x |A0 - A1| x +0x64, c2 same on B, c4 =
  A[n-1] + unit(A[n-2] - A[n-1]) x |..| x +0x64, c5 same on B. Vertex order:
  `c0 (data+0x20 raw), c1 (colA), c2 (colB), A[i] (colA), B[i] (colB) for i = 1..n-2, c4 (colA), c5 (colB), c3 (B+0x70)`.
  Then FUN_00281e88 flushes: one GIF packet per strip.
- FUN_00282fa8 per vertex: VCLIP.xyz of ctx +0x70 . p against w; FUN_00282e68: RGBAQ = VFTOI0(colour x ctx +0x50);
  XYZ2 = S . (p, 1), Q = 1/w (VDIV), x y z x Q, VFTOI4 x y, VFTOI0 z; ADC (bit 15 of word 3) = CF & 0x3ffff (this
  vertex or the previous two outside). 190 vertices per packet (then a flush with GIF PRE 0: the strip continues).
- FUN_00281d78 GIF packet: VIF DIRECT (0x51000000 | n), GIF tag NLOOP n, EOP, PRE 1, **PRIM 0x4c** (TRISTRIP, IIP,
  ABE; not TME, not FST, context 1), FLG PACKED, NREG 2, REGS 0x51 (RGBAQ, XYZ2); sent with FUN_002e14b8(0x4eb500)
  (the particle's draw slot, as type 103). Afterwards FUN_0028e670 sets ALPHA back to 0x49b280's 0x44.

### Output records (effects_ribbon.js)

One record per triangle the GS draws (strip vertex k >= 2 with ADC clear), in the form EffectLayer already draws for
type 11's untextured triangles:
`{ verts: [3 x { pos (game view space), uv [0,0], rgba (GS bytes), gs [X, Y, Z] }], tex: null, untextured: true,
alpha, emitter, id, type: 60, tag, strip (0 core, 1 / 2 glow bands), prim: 0x4c }`.

**Layer side:** EffectLayer's untextured material outputs `a / 128` as the fragment alpha; WebGL clamps it to 1.0
before blending, but the core's vertex alpha is 0xff, i.e. As = 1.99 on the GS (ALPHA 0x48: Cs x As + Cd, COLCLAMP
on). To match, the layer should premultiply (`rgb x a / 128`, factor 1) as `lineMaterial` does. The GS interpolates
colour and alpha separately and multiplies per pixel; premultiplying per vertex gives the same result wherever the
vertices of a triangle share their RGB (the core: B+0x60 everywhere; the glow bands: B+0x40 / B+0x50 differ only in
alpha). Only the first / last triangle of each strip differ slightly (the tips c0 / c3 carry the tip colour).

## vf7 (the eye vector), G

FUN_002a7ec0 reads vf7 but nothing on the draw path writes it first (checked: FUN_002d17e0, FUN_002e3708 and its
callees, FUN_002d8578, FUN_0028bd90, FUN_0028d9b8, FUN_0028dc08 contain no vf7 write). So it is what the last VU0
code left. The vertex emitter FUN_00282e68 loads the screen matrix into vf4-vf7 for every vertex, so right after any
draw of this primitive library (0x2828b8..0x283258) vf7 = S row 3 = (0, 0, zA, 0) (zA = 16777256 for camera 0).
**GUESS:** the module uses that row (`RIBBON.eye` overrides it). About 40 other functions load vf7 (e.g. 0x2610e0,
0x2698d0, 0x29adc0); whether one runs between two beam draws was not traced. For a beam that is near vertical on
screen the choice barely matters: with a = (|x|, |y|, ~zA) or a = |cur| the perpendicular is close to view x either
way. Needs a PCSX2 run (a breakpoint at 0x2a7ec0 reading vf7) to settle; list it in notes/fidelity-audit.md.

## Rounding, MEASURED

PS2 EE FPU and VU0 round toward zero (PCSX2's "chop"). With `Math.fround` the RAM paths differed in the last bit (up to
6 ulp in the cut point); with round-toward-zero in every float step, including the LCG's `(s & 0x7fff) - 0x4000) x
6.10351e-05 x r`, both beams reproduce bit-exact. The module therefore rounds toward zero and computes FUN_002d98c8 /
FUN_002d9938 from `X.rng.next()` itself (same LCG state, same order as `X.rng.signed / unit`). effects.js uses
`Math.fround`; that difference is at most an ulp per step.

## Checks (scratchpad rib_check.mjs, r03_key2 save state)

r03_mid2 has no live beam (the tag-2 spawner fires at 6 % a frame); `r03_key2.p2s` has two: emitters 0xd47490
(particle 0xcd8150, head 8) and 0xd4b360 (0xcd3b60, head 24). All bit-exact:

- type 59 obj +0x10 = (0, -25, 0, 1) from the tag-1 particle's m50; +0x20 = 0, +0x24 = 0;
- type 60 A finds that node (A +0x30 in RAM);
- built path (A +0xa0..+0x9c, 5 points) from origin and node: some LCG low 15 bits (0x6955, 0x261; the low 15 bits of
  an LCG step depend only on the low 15 bits of the state) reproduce every point exactly, which confirms the
  pre-order draw order, the half-distance per level and the displacement scale (segment length / +0x5c);
- drawn path (A +0xc8..+0xc4): 3 points (head 8: the cut point inside segment 2) and 5 points (head 24);
- B +0x40 / +0x50 / +0x60 / +0x70.

Not checked: the draw. No GS dump holds a beam (route dumps r02_barrier, r03_key, r03_mid, r03_mid2, r08_key,
r08_key2 and r03_key2 (frame 254, 24 frames after the save) have no PRIM 0x4c draw). The script runs the draw on
the RAM drawn path through the RAM's view / screen matrices: 18 and 30 triangles, all kicked, about 6 px wide and 35 /
93 px tall on screen above the centre: plausible, not verified.

## Left out (warned; the particle is not drawn, or its init fails as the game's would)

- curve 0x49b618 (+0xc4), helpers FUN_00288b70 (+0xc0) / FUN_0028b2d0 (+0xbe);
- random / blended widths FUN_0028c318 and the width tables (+0xb1 / +0xb2), fixed node offset (+0xb3), relative
  nodes (type 59 +0x1c), the kept path (+0xbd branches of FUN_0028a3d0 / FUN_0028a740);
- draws FUN_0028d678 (+0xb0 == 0), FUN_0028d7d0 (+0x40 == 0), the textured FUN_0028d180 / FUN_0028e6a8 / FUN_002826c8
  path (+0xb7), FUN_002e3708 mode 2;
- type 59 link kind FUN_0028f790 (+0x1f);
- destroy (FUN_002d19e8, FUN_002d1708): the page drops the objects with the particle. A node particle that dies
  before the beam leaves the game with a dangling pointer; the page keeps the old object (its last point).

## Assumptions

- L: the game's emitter list 2 (+0x68) is empty for these effects; only `em.lists[1]` (= +0x64) is searched.
- L: mgr word 0 bit 0 (FUN_002d1a30, FUN_0028bce0) is clear in play.
- L: camera near / far from `proj.near / proj.far`, else camera 0's 1 / 30000 (MEASURED r03_key2 0x4ea5e0 +0x28 / +0x2c).
- G: vf7 (above).
