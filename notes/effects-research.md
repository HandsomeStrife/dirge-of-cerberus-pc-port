# The effect engine (FED particles) on the page (worker 0179, 2026-11-01)

Status: the 3D effect engine is decoded and translated in `native/web/effects.js` (engine, channel
types 1 2 4 7 9 14 15 16 22 23 24, the sprite draw type 10 down to the VU1 program) and wired to
the bullet wall impacts and the soldiers' bullets hitting Vincent. Checked against five PCSX2 save
states and two GS dumps taken during w172_sound3: every translated particle's values and matrix
match RAM, every translated sprite's TEX0, ALPHA, ST and vertex RGBA equal the GS draw, corners
within 1 px. Worker 0188 (2026-11-01) added draw types 21 (burst) and 137 (sparks), the hit's param
+0x1d == 1 path and render categories 6 / 8 (see 'Types 21 / 137 (worker 0188)'). Not translated (warned,
not drawn): draw types 11 / 100 and a few channel types.

Data: `python3 -I native/assets/models/export_web_effects.py` -> `native/web/data/effects/`
(`r0001.fed`, `core_ef.bin` copied from the user's extract; `ids.json` from the ELF). The exporter
declares `"effects": "effects"` in data/scene.json (export_web_room.py keeps it); play.js fetches the
effect data only when it is declared, so a page without it logs one warning and no 404.
Test: `node native/web/test_effects.mjs` (146 checks; the game comparisons need
`tools/trace/out/w179_fx/`, see Evidence). Corrects parts of `native/assets/effects/FED-FORMAT.md` §3.

## Call sites
- Wall impact: FUN_0054ff50 (bullet end) -> FUN_00335f40(end, normal, bullet, 0): gate
  (+0x120 & 2) == 0 || FUN_003354b8(); FUN_00336478: bullet +0x140 bits 7-10 == 0 ->
  FUN_00336040(+0x138 & 0xf, FUN_00260c38(normal)) = table 0x4a0c68 [material x 2 + floor] (28
  words; floor = (int)(normal.y bits ^ 0x80000000) > 0x3f666666, i.e. y < -0.9f); else
  FUN_00310810(..)+0x20 (not translated). FUN_003366b8: FUN_002e6290(0, 0x4ee2e0, id) (the check
  against FED 0x80000 never fires for 0x40000 ids). Then FUN_002e7660(0x4ee2e0, em, {flag 1, pos}).
  Then the decal FUN_002e2840 (MISSING; only its RNG draws are on the page, worker 0173).
  z128's walls: materials 1 (51956 tris) -> 0x46400 (emitter 17), 2 (47195) -> 0x43400 (emitter 12),
  3 (24150) -> 0x45000 (emitter 13). The captures hit material 2 (Vincent's pellets) and 1 (#67's f875 shot).
- Hit on Vincent: FUN_005720c8 -> FUN_0055db50 -> FUN_003361b8(hit point, bullet, zone kind of
  P+0x19c = 0) -> FUN_003363d0(bullet): +0x140 bits 7-10 == 0 -> table 0x4a0cd8 [(+0x150 >> 16) & 3];
  +0x150 bits 16-17 = W+0x14 >> 2 & 3 (FUN_00552dd8), the weapon class: e027 = 3 -> 0x40c00
  (emitter 3; T: w174_pain_a / _m spawn 0x40c00, worker 0174). The page passes playerHandler's hit.point
  (the capsule contact, FUN_005442d8), as param_3. On the page the hit draws nothing yet: emitters 3 / 7 have param +0x1d = 1
  (FUN_002e7cd0's +0x1d != 0 path not decoded), so they simulate but are skipped by the draw guard. Also FUN_00336508 (id 0x1000, FED
  r0000, every 15 frames): see 'r0000 (worker 0200)'.
- Ids: FED by id & 0xfffc0000 (FUN_002e5c60; 0x40000 = resident r0001), table A (+0x60) index
  (id >> 10) & 0x7f, entry id & 0x1ff -> param record; group +8 = emitter index.

## Engine (manager DAT_004ee2e0)
- Frame FUN_00248110: FUN_002efc78 (FUN_002e9f98 per manager: FUN_002ea040 ages each emitter by
  the step, spawns its timeline, ages / kills particles, kills the emitter at its duration when id
  bit 0 is clear), FUN_002efe00 (list-0 particles: FUN_002ea5f0), the game logic (bullets spawn
  effects here: manager state 5), FUN_002efe98 (FUN_002ea6a0: per emitter FUN_002e7cd0 matrix,
  cull, FUN_002eacc8 on list 1: once list kind 7, keyframe events FUN_002eb1d0 -> FUN_002eb318,
  eval list kind 2), then the draw passes (FUN_002eaf70 kind 8; FUN_002e20f0 buckets ->
  FUN_002eadc0: each particle's draw list, vtable slot +0x24).
- Spawn FUN_002e63d0: emitter object 0x170 bytes; age = -(param +0x2c); apply flags 0x6002f
  (pos 0, rot 0, scale 1, colour 1); the tail by the manager state +0xb0: 5 / 9 / 1 age the new
  emitter at once (age -1, FUN_002ea040(1.0)): its first particles spawn in the spawn frame with
  dt 1.0. T: the type 10 clock (init -dt, + dt per draw) equals the age in RAM in all 21
  emitter-12 instances of the states, which only this path gives.
- Emitter matrix FUN_002e7cd0 (param +0x1d == 0): +0x80 = +0x120 + param+0x10, +0x90 = +0x130 +
  param+0x20, +0xa0 = +0x140 x param+0x30 (0.5 for emitter 12), E = S(+0xa0) Euler(+0x90, +0xd4) T(+0x80);
  colour +0xb0 = +0x150; FUN_002e84a8 picks the GS preset +0xc0.
- Particle FUN_002e8ea8: list (P+9 & 1) ^ 1, age = emitter age - schedule time, life P+6,
  value region +0x60 (P+2 bytes), init list FUN_002eb038. Dies when (int)age >= life (FUN_002e92c8).
- Particle definition P (pointers relative to P): +0x08 channel count, +0x0b render category,
  +0x0c descriptors, lists at +0x30 + 4k with counts at +0x20 + k: k0 init block (count +4,
  entries {u8 channel, u16 data offset} stride 8 from +8), k1 keyframe events (+0x34, records
  {s16 time, u8 count +4, entries {u8 channel, u16 data offset, s16 start, s16 duration}}), k2 eval
  (+0x38, slot +0x1c), k3 draw (+0x3c, slot +0x24), k4 death (+0x40, slot +0x2c), k5 loop (+0x44,
  slot +0x34), k7 once (+0x4c, slot +0x3c), k8 late (+0x50, slot +0x44).
- Descriptor: u16 type, u8 nref (+2; FUN_00273f40 reads it as a byte), u16 out slot (+4, byte offset into the value region), u16 ref
  channels[nref], u16 ref slots[nref].
- Keyframe event: per channel, slot +0x14 (transition) with the new data block, the old block, and
  t = the old segment's duration (or the age); eval time = age - segment start.
- Types: DAT_0046c398[type] -> a singleton whose vtable is static .data (read from the save RAM):
  init / transition / eval / draw / destroy / loop / once / late at vtable +0xc / +0x14 / ... / +0x44.
  1 position (FUN_00274430 / 488), 2 position + velocity (FUN_00274748 / 7e0 / 920), 4 rotation x
  11.377778 (FUN_00275850 / 8d0), 7 scale x 0.01 (FUN_002760d8 / 158), 9 scale quadratic
  (FUN_00276200 / 300 -> FUN_002ecf18 / 360), 15 colour (FUN_00272188 / 1e0), 16 colour linear
  (FUN_00272410 / 4a8 / 5c8), 17 colour quadratic (eval FUN_00272348; transition FUN_002eccc8 not
  translated), 22 / 23 / 24 random offsets for 1-3 / 4-6 / 7-9 (FUN_00274ec0 / FUN_00275228 /
  FUN_002755a0; enable / mode / range layout tables 0x46c0e8.. / 0x46c100.. / 0x46c118..),
  14 particle matrix +0x50 = S(ref 1) Euler(ref 2, order data[3]) + T(ref 0) (FUN_00273f40 /
  FUN_002740a0; data[2] == 1 velocity alignment FUN_002d93d0 not translated), 10 sprite.
- RNG: the LCG DAT_004e9400 (FUN_002d98c8: ((s & 0x7fff) - 0x4000) x 0x387fffd5 x r; FUN_002d9938:
  (s & 0x7fff) x 0x37fffec2 x r) and the VU0 R register (FUN_002d9880, type 10 flips). Neither is the
  shared twister (w173_rng: nothing draws between an impact's wall sound and its decal).
- Matrices: row vectors; FUN_002d8368(out, A, B) = B A; FUN_002d83e0 the 3x3 part keeping B's row 3;
  FUN_002d8578 v . M; FUN_002d82d0 order 0 = FUN_002d7ff0: in Rz Ry Rx + pos; angles 4096 a turn,
  truncated, sine table FUN_002f2740 (sinf(i x 3.141592 / 2048)).

## Sprite draw (type 10 -> VU1)
- FUN_002778b8: anim = FED table +0x70 [data +0xc] (entry +2 flags (0x80 loop), +7 length, frames
  from +8 stride 8 {s16 ?, s16 record offset, s16 end time}); clock += emitter dt; frame = first
  with end > clock x data+0x10; past the length: loop or no draw. Colour = particle colour (ref slot
  0) x emitter colour, clamped 0..255, truncated. Flip byte -> FUN_00276ed8 (Y / X 180).
- FUN_002e3498(0.1, .., mode = byte 0 of the type 14 channel): mode 1 (billboard): (P50 flip) x 0.1,
  rows x emitter scale, translation (t E) V; then x the projection. Mode 0: x 0.1 . E . VP.
- FUN_002e3948 (data +0x1d): the depth matrix, same with the translation + data +0 (0, 0, -3) in
  view space; the VU1 program takes only z / w from it. So the sprite is pulled 3 units toward the
  eye for the depth test (sprites within 3 units of the eye are dropped by the far test).
- FUN_00308028 -> record byte +0xf == 1 -> FUN_00309c68: VIF packet (UNPACK 11 qw: flags, colour,
  matrix, depth matrix, fog qw) + DMA ref to the record + MSCAL 0 / 2 / 4. The record is itself a VIF
  stream: V4-8 to +0x20 (count at +4, size at +8), V2-16 masked to +0x40 (per sprite 4 corners
  (x, y / 16) + 2 UV (/ 4096)), V4-8 to +0xa0 (per sprite RGBA bytes, GS ALPHA word), V2-32 to +0xc0
  (per sprite GS TEX0).
- VU1 micro memory is resident for the level (identical in all six states). MSCAL 4 = instr
  298-531: per sprite GIF tag (0x3f6 / 0x3f8: TEX0, A+D ALPHA, 4 x (ST, RGBAQ, XYZF2) strip), corner =
  M (x, y, 0, 1), Q from M's w, Z from the depth matrix, RGBA = record x particle / 128 x (1 - fade),
  fade = clamp((Z_main - 2^23) / 2^22, 0, 1) (0x3f5; the main matrix's Z: DIV latency), CLIP the
  screen box of the 4 corners: dropped when wholly outside +-256 of (2048, 2048) or any edge past
  +-1536 (FCAND 0x28514a), or behind the far plane (FCAND 0x810). Constants 0x3f0-0x3f5 from the
  save state's VU1 data memory.
- GS state (dumps): TEX0 T8 TCC 1 MODULATE, TEST ATE GREATER 0 / ZTST GEQUAL, Z write off; ALPHA
  0x44 = (Cs - Cd) As + Cd, 0x48 = Cs As + Cd.
- Textures: data/effect/core/core_ef.bin, resident in GS memory: 27 records at +0x70 (TEX0, +0xc w,
  +0xe h, +0x10 size), CLUT records at +0x3d0, CLUT k at 0xf80 + 0x400 k (CT32, CSM1 order),
  texture k at 0x7bf0 + sizes so far. MEASURED: equal to GS memory in the dumps (5 textures and 7
  CLUTs resident there); several records share a TBP and are swapped in on demand, so the page keys
  textures by the full TEX0.

## Evidence
- Captures: `tools/trace/grab_gs.py` runs w172_sound3 in the trace unit and presses Shift+F8 (GS dump),
  F1 (save state), F2 at frames 836 / 839 / 844 / 866 / 870; each dump stalls the emulator, so the
  grabs landed at 836, 874, 913, 955, 997 (grab_log.json). Fixtures: `python3 -I tools/trace/fx_fixture.py
  STATE.p2s tools/trace/out/w179_fx/stateN.json` and `python3 -I tools/trace/dumpfx.py DUMP.gs
  tools/trace/out/w179_fx/dumpN.json` (worker 0186: both reproduce the committed-to-disk fixtures byte for byte
  from 0179's captures). The GS dump frame is 4 game frames AFTER
  its save state (21 / 21 sprites exact at +4, 3-6 / 9-13 at +3 / +5).
- RAM layout of the evidence: manager 0x4ee2e0 +0x84 emitter list, emitter +0x60 / +0x64 particle
  lists, particle +0x44 value region, +0x50 matrix; camera DAT_0050b4f8[0] +0x150 view, +0x110
  projection (X = 300 x / z + 2037, Y = 450 y / z + 2048, Z = 16777256 / z - 255.0045).
- Seeds: the LCG keeps its low 15 bits to itself, so an emitter's seed follows from its particle 0's
  two random position offsets (test_effects `seedOf`).
- Results: test_effects.mjs; test_effects_page.mjs (the wiring on the real page). Review image: /srv/shared/dirge-port/review/w0179_impact.png (game frame
  vs the page drawing the same six impacts; the page's burst is smaller: types 21 / 137).

## Not done (fidelity-audit rows from 'Bullet wall impact effect')
Draw types 11 / 100 (21 / 137: worker 0188, above), channel types 3 / 5 / 6 / 8 / 26, rotation orders 1-5 (FUN_002d82d0 cases
FUN_002d8060 / 80d0 / 8150 / 81d0 / 8250: in four of them the first call reads the output matrix; not
translated, such particles / emitters are not drawn), render
categories 2 / 6-9 (+0x54 matrix copy), looping / child / list-0 particles, emitter fade, attached
emitters (param +0x1d != 0), the frustum cull, the draw buckets, the screen-space (title) path, the
decal, FUN_00336508, hit effects on soldiers. Next: type 21 (the burst, FUN_0027bda0 / FUN_0027cd68,
also a FUN_00308028 sprite) and type 137 (FUN_0027da78, own packets), then a GS dump of a hit on
Vincent.

## Types 21 / 137, param +0x1d, the hit (worker 0188, 2026-11-01)
Vtables from the save RAM (DAT_0046c398): 21 -> 0x49aa78 (init FUN_0027baa0, transition FUN_0027bba0 (not a
Ghidra function: asm), eval FUN_0027bda0, draw FUN_0027cd68, destroy FUN_0027bd70); 137 -> 0x49aad8 (init
FUN_0027d350, transition FUN_0027d5d0 = jr ra, eval FUN_0027d5d8, draw FUN_0027da78, destroy FUN_0027d5a0).
Ghidra drops `sq $0` stores (FUN_002d8490 is a real identity; type 137's direction vector is (0, -1, 0), not the
angles) and shows EE `madd` as `|` (record = pool + 0x30 + i x 0x90): check the asm (capstone + the EE opcodes,
VU0 macro fields decoded by hand: normalise = xyz, w = 0; cross = a x b).
- Type 21: a ring of 0x90-byte sub-sprites (layout in effects.js). Spawn amount = acc dt^2 / 2 + rate dt (data
  +0x3c / +0x2c) + carry; age of the n-th new one = dt / total x n - 1. Shapes (+0xfe) 0 / 2 box +-data[0..2],
  1 / 3 shell along a random cone (FUN_002d93d0 look-at: up (0, 1, 0) when dir.x | dir.z bits != 0, else (0, 0,
  1)); velocity along the cone (0 1 6 8) or radial (2 3 7 9); second direction data +0x20 normalised; scale x / y
  only (z = 100); rotation / colour in .w / own rows. Draw: b + r t + (a x 0.5) t^2, scale x 0.001 x emitter
  scale, flip, rotZ, position . P+0x50 . E (data +0xfb not 2 / 6 / 7) . view, depth offset data +0xec when +0x10e.
- Type 137: CPU side in effects.js `evalSparks`; GPU side = VU1 micro memory instr 649-785 (MSCAL 8 -> B 649;
  `port/vu/tools/vudis.py` on the save's vu1MicroMem; its I-bit immediates are 0.5 and 127.0, the second shown as
  a bogus BAL). Packet: UNPACK V4-32 11 qw to VU 0xf0 (main matrix, start / end colour / 16384, (32, L, ring
  size, frame index), (mask, newest time), GIF A+D ALPHA, LINE STRIP tag PRIM 0x4a); per 32-spark block REF to
  the spark shorts (V4-16 to TOPS+0x10) and the birth times (S-32 to TOPS+0x50); the time ring S-32 to 0x2f0.
  VU1 constants 0x3f0-0x3f4: (2048, 2048, 2^23), guard 1536, alpha cap 1.0.
- RNGs: sparks draw the effect twister FUN_002d9b18 (DAT_004e9408 / index DAT_004e9dc8: its own MT instance;
  only effect channel code draws it) and VU0 R (FUN_002d9828, life). export_web_effects.py --state writes the
  z128 save's twister into ids.json (no default: build_web.sh passes it).
- FUN_002e3498's mode is type 14 byte 1 (its 5th argument); the sparks are world-oriented (bytes 1, 0).
- Param +0x1d == 1 (emitters 3 / 7, the hits): FUN_002e7cd0 attaches only when emitter +0x30 is set; FUN_002e63d0
  clears it and the flag-1 spawn never sets it -> the mode-0 matrix.
- Render categories (FUN_002e9db0): 6 / 8 copy E to the particle's +0x54 (equal to E for a static emitter:
  MEASURED), 2 unit diagonal, 7 FUN_002d86e0, 9 identity; all are now simulated (their RNG draws), 2 / 7 / 9 not drawn.
- Evidence (w188 grabs of w172_sound3, `tools/trace/out/w188_fx/`, gitignored): A f787 (before the hit on Vincent),
  B f831 + dump f835 (before the pellet impacts f833-835), C f789 + dump (one frame after the hit), D f837 + dump
  f840 (after the impacts; this dump is state + 3, not + 4). fx_fixture.py now also writes the twister, each
  particle's data blocks and raw type 21 / 137 pools (the FED is relocated in RAM: absolute pointers) and the +0x54
  matrix; dumpfx.py --lines writes the line-strip segments. The camera of a dump frame is not in the save (the
  shot's recoil moves it by ~1.5 px): the test fits a screen shift from the sprites.
- The game's step varies (1.1999988 at D); the spark carry sits on a knife edge (0.99999809), so the replay takes
  each frame's step from the RAM time rings.
- Hit on Vincent (f789): the game spawns 0x40c00 (emitter 3) AND 0x41800 (emitter 6) at the point; the second's
  source is not found (FUN_005720c8 and FUN_0055db50 both call FUN_003361b8). Review (manager): the 0188 replay
  of the hit was off because (1) the hit's tags 4 / 5 have draw types 100 / 11 and were skipped whole, losing tag
  5's type 23 / 24 transition draws (6 LCG draws before tag 3's type 21 eval): now such particles are simulated,
  not drawn; and (2) every effect frame reseeds the LCG (below), which was the 'rewind' in frame 2 (emitter 8
  draws nothing there). Now the hit's type 21 records of both frames equal RAM, and dump C+4 has 13 / 17 sprites
  with the game's exact RGBA within 1.96 px (shift fitted on those; the dump frame's camera is not in the save).
- Per-frame reseed: FUN_002efc78 (the effect frame's begin) first calls FUN_002d97f8: DAT_004e9400 = rand()
  (FUN_00448910, newlib: state *(PTR_DAT_00495844) + 0x58 = state x 0x41c64e6d + 0x3039, returns & 0x7fffffff)
  and VRINIT R with that word. T: rand() advances exactly once a frame between the w188 states (A -> C 2, B -> D 6,
  C -> B 42: MEASURED; other rand() callers: FUN_002e0ca8 via FUN_002e28d8 (material-6 impacts) and FUN_003a1080
  (pointer only)), the impacts replay from state B's rand() alone (no recovered seeds), and every spark life equals
  RAM: the VU0 R reseed in FUN_002d9880 / FUN_002d9828 is R - 1.8872414 (constant 0x3ff19120; 0188 first used
  f(1.88725) = 0x3ff19168, which diverged after 3-5 draws; VSUBbc writes vf25.w, the decomp's 2R ignores lane masks).
  The page gets the z128 save's rand() state from ids.json `rand` (export --state); without it no effects spawn (warned).
- GS ALPHA 0x42 (DAT_0046c2a0 preset 2) = (0 - Cs) As + Cd: drawn with a reverse-subtract blend; any other ALPHA
  is not drawn (warned).
- Floor-hit normal: see 'Bullet end, floors, soldier hits (worker 0193)' below (MEASURED, wired).

## Bullet end, floors, soldier hits (worker 0193, 2026-11-02)
- Who spawns what: `TRACE_CALLLOG=fxsrc` (tools/trace/calllog.py, hook kind "sites") wraps every jal to FUN_002e62b0 /
  FUN_002e6290 / FUN_003366b8 / FUN_003365e0 (overlay site 0xaa4d80 left out) and logs the id and the caller (ra - 8);
  + FUN_00335f40's end / normal (site 0x54ffc8). Runs (gitignored out/): w193_fxsrc (w172_sound3 inputs), w193_fxhits
  (w172_hits), w193_floor (w172_sound3 route, pitched down then up, a shot after each).
- **Bullet end (0x41800)**: FUN_00554ea8 (the bullet's end, after the move and the room hit's vt+0x1b4) spawns the bullet
  record's end effect: +0x194 = FUN_00311600(+0x144) (FUN_00554850; +0x144 = W+0x7c from FUN_00554568, the soldiers'
  section-24 record: itself in z128); conditions W+0x78 bit 0x2000 clear, +0x120 bit 0x800000 clear, (0x40000000 clear
  or 0x1000000 or no room hit); G+0x64 (48) >= 0x28: room hit + W+0x80 != -1 + FUN_00260c38 floor -> FUN_00335960
  (W+0x80 at +0x110), else FUN_00335918 (W+0xb0 at +0xf0; W+0x78 bit 8 -> FUN_0054a720). FUN_00335020 = FUN_002e7660
  flag 1. z128: W+0xb0 = 0x41800, W+0x80 = -1. T: f789 0x40c00 (0x336230), 0x1000 (0x336510), 0x41800 (0x33593c) at one
  point; f884 wall 0x46400 then 0x41800; Vincent's pellets none (+0x194 = 0: FUN_00552850, never FUN_00554850).
  FUN_00556068 sets 0x800000 at the end point only without a room hit (the page set it always: fixed).
- State C: emitter 6 equals RAM (42 values, 1.7e-7) with 25 LCG draws before it: the r0000 0x1000 emitter's end-pass
  draws (list 8, 3, 0x1000, 6; the page's spawns draw nothing at the spawn). r0000.fed (FileCode 0, group 4 -> emitter 7,
  draw types 107 / 109 / 110) is not on the page: emitter 6 draws 25 values early. Dump C+4: 14 / 21 sprites exact RGBA
  (emitter 6 tag 0 yes, its tag 1 x 3 no).
- **Floors**: FUN_0026f8a0 stores the hit triangle (vf18-20) at DAT_004e8830.. next to the normal DAT_004e8810: in 7
  save states the normal = -normalize((v1 - v0) x (v2 - v0)); collision.js's is +, same vertex order. play.js roomRay
  negates; FUN_00260c38 = -n.y > 0.9f (effects.js floorHit). T: w193_floor f833-835 (0, -1, 0) -> 0x45400 (material 3
  floor); the page gives the same ids at all 6 logged impacts. DECODED (review 27, checked with vudis.py on the save's
  vu0MicroMem): _vcallms 0xa90, vf13 = v1 - v0 (368), vf25 = v2 - v0 (371), vf13 = vf13 x vf25 (375-376), vf22 = vf00 - vf13
  (420; quads 448 / 451 / 456-458 / 507), no branch on the sign. Open: its back-face culling (396-415) vs the page's
  double-sided test.
- **Soldier hits**: hitEnemy (FUN_0055db50) -> FUN_003361b8 with the zone record nibble (word bits 12-15, signed; ai.json
  zones `fx`): != 0 -> wall table [n x 2], else hit table [Vincent's class: weapon.json class & 3 = 1] = 0x41800.
  T: w193_fxhits f843 / f870 / f871. Also f871: FUN_00580410 -> FUN_003365e0(0x4800) (r0000; not followed).
- Tests: test_effects_hooks.mjs (new, hooked: 16 checks incl. the w193_floor impacts), test_effects 207, test_bullet_hit
  44 (bullet frame: hit effect then 0x41800 at one point), test_effects_page + the floor shot.

## Screen effects, looping, FED textures (worker 0198, 2026-11-02)
The GAME OVER title (notes/gameover-research.md "Title FED") brought: the emitter byte +1 == 1 path (category 5-8 / 0xb:
camera 1, FUN_002e7cd0's screen offset +0x40 / +0x44, FUN_002e3300), looping emitters and particles (FUN_002ea040,
FUN_002eb1d0, FUN_002eb6b8 kind 5, FUN_002e9b38, loop methods of types 1 2 3 4 7 9 17), channel type 3 (init FUN_00274558
asm, eval = FUN_00272348's bytes), a FED's own TIM2 textures (FUN_00309f28 offsets), `createEffects({ reseed })` for a
second manager. effects.js now warns on an untranslated draw type in the draw pass. Checked on the title only (the 3D
effects' tests unchanged).
Draw layers (review fix): the frame loop FUN_00248110 draws effect layers through FUN_002f00c0 (3, 4), FUN_002f0250 (5)
and FUN_002f0428 (6), each FUN_002e20f0(n) over DAT_004eb680 slots (layer 5: 0x12a..0x131). Before layers 4, 5 and 6 it
clears the depth buffer when FUN_002e2398(n) finds an entry: FUN_002ee990(0x4ec060, 0) -> FUN_002ee5c0 (8 SPRITEs,
TEST 0x32001, Z 0). The page has this only for the title (layer 5): gameover_title.js `TitleLayer.depthClear`.

## r0000 (worker 0200, 2026-11-02)
- **Load**: boot FUN_00244db0 -> FUN_002449e8 -> FUN_002448a0(0): table 0x4985e0 row 0 = files 0x3100038 / 0x3100039 /
  0x310003a (FILELIST: r0000.fed / r0001.fed / r0002.fez; row 1 = the _on files 0x3300000..2), each FUN_0024fe88 ->
  FUN_002f0ff0 into the manager's +0x78 FED list. MEASURED: z128 RAM holds r0000.fed (code 0) next to r0001.fed.
  FUN_002e5c60 matches id & 0xfffc0000 = FileCode, so ids 0..0x3ffff are r0000's.
- **FUN_00336508** = FUN_003366b8(0x1000) only (no FUN_002e7660): emitter 7 at position 0. Callers: FUN_005720c8 (a
  bullet hits Vincent; after FUN_0055db50 and FUN_00567c08: `DAT_0046ee28 (15) < DAT_0046e938+0x20 - P+0x280` ->
  spawn, P+0x280 = now; FUN_00571ee8 sets P+0x280 = -15), FUN_005725d8 (melee, no gate), FUN_00572418 (player
  vt+0x1cc: another damage path, b_dmg_2 / _3 vibration, FUN_00336338 effect; spawns when it did damage, no gate; not
  reachable on the page) and FUN_00570eb8 (FUN_005712c8's HP-loss branch; not on the page; never fired at the traced
  bullet hits: one 0x1000 per hit).
- **FUN_003365e0(id, pos)** = FUN_003366b8(id) + FUN_002e7660(flag 1, pos). FUN_00580410(obj) = FUN_003365e0(0x4800,
  FUN_0054a720(obj)); at f871 its caller is FUN_0055cac8 (site 0x55ce58, call log w200_4800): a soldier's death
  dropping an item (FUN_00316d70 / FUN_00541688), the effect at the item. Not on the page (no items).
- **Emitter 7 (0x1000)**: dur 11; tag 0: 1 4 7 17 14 107 (colour 128, 59.2, 15.9, 8.5 -> events), tag 1: 1 4 7 17 14 109 110.
  Vtables (save RAM): 107 0x49def8, 109 0x49d798, 110 0x49da80. 107 / 109 keep a 0x14 object (+4 value, +8 base, +0xc
  rate, +0x10 acc = DAT_0046c350 / DAT_0046c34c = 0.0). 110's init 0x2b4ab8 = "ref 2's object exists", trans / eval jr ra.
- **107 draw** (FUN_002c1bd8 -> FUN_002a3690, data +0x1a == 0): FUN_00286870 prim record, rect (0, 0, FUN_00285568(0),
  FUN_002855d8(0)) (or data +0..+0xc with +0x19), colour = FUN_002a4510 = particle +0x60 + ref slot 0, ALPHA index
  FUN_00284e20(data +0x18, 0, 1, 2) -> FUN_00284d30 (0x44 / 0x48 / 0x42), TEST FUN_00284c98(4) = 0x3000d; FUN_002849a8
  writes the GIF packet: x0 = ((x + 0x800) - w / 2) x 16 - 8, colour VMAX 0 / VMINI 255 / VFTOI0 (record +0x70 = 0: no
  emitter colour). T: dump C (f793): (1823.5, 1791.5)-(2271.5, 2303.5), RGBA (128, 30, 7, 24), 0x48, TEST 0x3000d.
- **110 draw** FUN_002b4b08 -> FUN_002a2610: frame-buffer zoom (MISSING, warned).
- **The 25 LCG draws of 'State C'** (call log w200_lcg: every jal to FUN_002d98c8 / FUN_002d9938 in 0x270000-0x2e0000
  with its caller, w172_sound3 f786-791): f789's order is 0x2a1998 x3, types 22 / 23 / 24, type 21 eval (emitter 3),
  **FUN_0029e688 x25** (type 100 eval 0x2cb3b8 -> FUN_0029e630, emitter 3 tag 4: 5 trail points x 5 draws), then
  emitter 6's 23 / 24 / 21. No draw inside the three spawns and none from r0000. So the r0000 work does not move
  emitter 6; translating type 100's eval would.
- Fixtures: `fx_fixture.py STATE OUT 0,0x40000` (3rd arg: FileCodes; adds 'code' and the 107 / 109 objects) ->
  tools/trace/out/w200_fx/stateC.json; `dumpfx.py DUMP OUT --flat FLAT.json` (untextured >= 400 px tris) ->
  w200_fx/dumpC_flat.json. Both from 0188's capC files (scratchpad 5b965574.../capC).
- Tests: test_effects (+17: r0000 ids, screen sprite, state C vs RAM, dump C), test_effects_hooks (+4: the gate, melee),
  test_effects_page (+3: page wiring, WebGL pixel of the screen sprite).
- Review fixes (worker 0200): one draw order over sprites / lines / screen sprites (EffectLayer `ord`: the flash draws
  between 0x40c00 and 0x41800, as spawned); the screen rectangle clipped by the scene SCISSOR 0-431 x 0-511 (effects.js
  `screenClip`; native view = 432 x 512); ids.json `feds` (exporter) so play.js requests r0000.fed only when exported.

## Title draw types 20 / 35 / 103 / 119 (worker 0202, 2026-11-02)
See notes/gameover-research.md "Title draw types". effects.js: T[20] (UV scroll + 6 LCG draws), T[35] (drawGlow: the
frame-buffer page glow, items { glow } handled by a layer with `glows()`, only TitleLayer), T[103] (strand points: 9 LCG +
1 VU0 R per point; lines not drawn), 119 simulated (DRAWN_ELSEWHERE); LOOP_NOOP + 11 / 35; `rz` (round toward zero for the
glow's last steps). EffectLayer.update routes `glow` items to `this.glows` (warned without one). Tools: calllog.py set
w202lcg (+ VU0 R spans), fields.py TRACE_FXTITLE, title_fixture.py 'vall' / 'pool', dumpfx.py --glow.

## FED models, draw order (worker 0206, 2026-11-02)
See notes/gameover-research.md "Model renderer, types 11 / 20, draw order". effects.js: `T[11]`, `T[20].draw`, `drawModel`
(FUN_002f5c50: kinds 2 / 4 / 6), `drawSlot` + the slot sort in `sprites()` (FUN_002e1ec8 / FUN_002e20f0), draw gets `t`
(segT); EffectLayer: an untextured material (`material(null, alpha)`) and 3-vertex items. Review fix: drawModel draws only
camera-1 (2D) emitters; gameplay (camera 0) type 11 / 20 models are warned and not drawn. T: the floor shot 0x45400 (E20 tag 2,
model 4) against a new grab (`tools/trace/out/w206_floor`: grab_gs.py on w193_floor, dump f834-835, state f836; fx_fixture
state1.json, dumpfx dump1.json): the page's 4 gouraud quads per impact (vertices fading to (0, 0, 0, 1)) vs the dump's 10
triangles of TEX0 0x4007bd06613137c0, flat (128, 40, 17, 153) / (128, 42, 8, 64), 7-70 px apart: not the same draw (and some
of those may be the muzzle flash E0's). Not decoded which part differs (colour path, the spawn frame, or whether E20's model
draws at all at f834). The 52-82 triangles of that TEX0 in the w188 dumps are the muzzle flashes E0 / E8 (the page never
spawns them; the reviewer matched E8 to w188 A / C, 68 / 68 triangles). fx_end 0x800 (r0000 E3) belongs to weapons 26 / 27,
which no z128 record uses: not reachable on the page.


## Stage effects: the z128 fire (worker 0208, 2026-11-03)
- **Where**: the level manager DAT_004ee3c0 (FUN_002f0878 case 2) holds z128's area FEDs, FileCode 0x20000000 | area << 18
  (FUN_00306408): noPath/06800014.bin (area 0), 06800114.bin (area 1: the fire), 06800214.bin (area 2). The z128 save's RAM
  has all three; 76 emitters (1 + 74 + 1). The 7 x 0x406c0000 emitters on DAT_004ee2e0 at (0.4, -1.5, 0) are something else
  (FED not found on the disc as a file; not on the page).
- **Placement**: FUN_002f15d0 (a stage FED's load) -> FUN_002e4d80 -> FUN_002e4e38: every param record of table A whose flag
  word +4 has bit 0, in group / record order, FUN_002e63d0 with age 0 and no position (the record's +0x10 is the place).
  All 76 records of the three FEDs with bit 0 are what RAM holds, in that order. Scripts can spawn more (FUN_00545b20 case
  0x17 = FUN_00336a18(id) + FUN_00336c10 scale, 0x18 = FUN_00336b28 stop; FUN_005823d8 / FUN_00582470 objects): not on the
  page (0x20000400, flag 2, is one such record). FUN_002e4fb0 (header +0x20 table): empty in these FEDs.
- **Cull** FUN_002ea6a0 (after FUN_002e7cd0, per emitter): clears +0x0a / +0x0e & 0x380; 0x100 when the param cell (+0x66,
  s16 >= 0) has its bit set in the manager's copy (+0x30) of DAT_004e8710 = DAT_004e86f0 | DAT_004e8700 (the room's hidden
  groups: 0 / 19 / 25 / 56 / 57 in the save, ids.json `hidden`; the page computes it per frame, room_vis.js, worker 0225); camera 1: no test; else by
  +0x1e: 1 / > 3 no test, 0 = box DAT_0046d280 (100) at the origin, 2 / 3 = box +0x40 at +0x50 (the stack copy of +0xe0 is
  48 bytes and the centre FUN_002d8578 writes lands on its row 3: MEASURED, only so do E15's flags / alpha match):
  FUN_002da928 (8 corners x M x camera +0x210 (= view x clip +0x250), VU0 CLIP, all outside one plane) -> 0x80; FUN_00269978
  occluders -> 0x200 (not translated); fade by +0x1f: 0 / 4 screen size FUN_002daae8 (corners x camera +0x1d0, extent, ends
  125 / 75 and 62.5 / 37.5), 2 / 3 eye distance FUN_002dac58 (+0x3c / +0x4c), 1 none; fade 0 -> 0x80; alpha +0xbc = +0x15c
  x +0xd0 x fade; then the angle fade (+0x06 = 2 / 3: s16 +0x60.. Euler, +0x68 / +0x70 band). FUN_002ea040: a culled looping
  emitter (fade +0x28 < 0) is not aged at all. All matched against RAM in 8 states (test_effects).
- **Draws used by the fire** (06800114): type 20 flame models (E0-E6), type 21 bursts (embers / smoke; E15's are in world
  space: data +0xfb = 7), type 11 glow models (E10-E14; E10-E12 with +0x15 -> FUN_002f93d8: not translated), type 10 (E3, E7,
  E8), lens flares 50 + 53 / 56 (E0 tag 3, E7, E16, E17: not translated, they read the GS depth buffer back), channel types 5
  / 6 / 61 / 62 (translated), 26 (E8 only, hidden), random 23.
- New in effects.js: the four channel types, loops of 15 / 16 / 21, type 21's alpha fade (asm 0x27d214), world-space spawn
  (FUN_002e3ee8 case 7: in . (P+0x50 . E)) and pool flag (cone x P+0x50 x E), model kinds 0 / 1 (20-byte untextured tris),
  the model depth matrix (FUN_002e3948's float scale arrives in $f12: the decomp's arguments are shifted by one), camera-0
  models on, header-only TIM2 pictures skipped (06800114's 4 pictures have no texels; 06800014 brings the same TEX0s).
- **Evidence** (tools/trace/out, gitignored): w208_fire (a_idle: dumps f20 / f70 + states: the start view, no fire in sight),
  w208_look (w208_fire_look: turning, f40..160: the burning window at f160), w208_still (w208_fire_still: turn, then still;
  dumps f201 / f245; **this dump = state + 3 frames**). Fixtures: `fx_fixture.py STATE OUT 0x20000000,0x20040000,0x20080000
  0x4ee3c0` (4th arg = the manager; adds +0x0a / +0x0e, the record, p150, d0, carry, fade, particle entries) and `dumpfx.py
  DUMP OUT --fed <the three .bin>`. w208_fire/save.json = the sea-of-flames save itself.
- **Check**: test_effects restores the level manager from w208_still RAM, replays 3 frames (rand() reseed from the state)
  and draws: every type 20 / 21 / 11 vertex lies on a dump vertex (<= 0.37 px) with its RGBA, model GS Z within 0.075 %;
  the dumps' only fire triangles the page does not draw are E10-E12's 4 FUN_002f93d8 ones.
- Open: FUN_002f93d8, the flares, the occluders, gameplay model fog (FUN_002f2d90, FOG register: not read from the dumps),
  script-spawned stage effects and hidden-cell changes, the start ages (page starts the fire at age 0).

## Menu-box effects: channel types 8 / 18, type 103's draw, the soft end (worker 0241, 2026-11-03)
See notes/message-research.md "Box effects" for the wiring (menu_fx.js). In effects.js:
- **Type 18** (vtable 0x499a30, save RAM): a child-particle spawner. init 0x272a60 / transition 0x272a70 zero the carry,
  eval 0x272a78 -> FUN_00272aa0(emitter dt +0x20), loop 0x272a98 returns 1, draw / destroy no-ops. Data: +0 rate, +4 offset
  range, +8 speed, +0xc acceleration, s16 +0x10 child tag (bit 0x1000: a tag group E +0x28, FUN_002e54b0 / 54e0, warned),
  u16 +0x12 carry back-off, s16 +0x14 (< 0 off), u8 +0x17 chance %. Per child: FUN_002d9880(100) chance (VU0 R) when < 100,
  3 LCG offsets, FUN_002e4180 (child category 1: pos = offset . (identity + row 3 = the ref-0 value), dir = pos - row 3;
  0 / 2-8: pos = dir = offset; normalised), vel / acc = dir x +8 / +0xc, FUN_002e9268 -> FUN_002e8ea8 with the spawner as
  parent and the spawn parameter { 7, pos, vel, acc } at mgr +0xb4.
- **The spawn parameter** (FUN_002eb038 sets mgr +0xb4 for each init): word 0 bits 1 pos (+4), 2 vel (+8), 4 acc (+0xc),
  8 / 0x10 rotation, 0x40 / 0x80 scale, 0x200 / 0x400 colour (asm of the inits 0x272190.., 0x274438.., 0x275858..,
  0x2760e0..). Translated: types 1 / 2 (replace, 4 words), 3 (VADD .xyz); other bits warned.
- **Parents** (FUN_002e8ea8 / FUN_002e92c8): parent +0x20 counts live children; a particle past its life with children
  gets flag 8 and stays; FUN_002eb6b8 runs no list (eval, draw, loop, once) for a flag-8 particle; P id bit 0 + children
  skips the death. A child's matrix (FUN_002e3dd8's per-category cases, jump table 0x49f740) is not translated: children
  are simulated, not drawn. During FUN_002ea6a0 the manager state is 6, so a child spawned in an eval gets no keyframe tail.
- **Type 8** (vtable 0x49a510): scale + rate x 0.01, the scale analogue of type 2 (init 0x276438, transition 0x2764f8,
  eval 0x2765f0 VU0 .xyzw, loop 0x276628).
- **Type 103's draw** FUN_002aa120 (asm 0x2aa120..0x2aa510; drawStrands): see the code comment. T: the GAME OVER title's 24
  lines = the w198 dumps (0.074 px, RGBA / ALPHA exact); the help box's strands have the dump's colours / ALPHA 0x48.
- **Soft end** FUN_002e7198 (`softEnd`): +0x28 < 0 -> +0x28 = age (+0x1c), or age < 0 -> +2 |= 0x20; E +0x1f == 3 ->
  +2 |= 0x10. **FUN_002ea040's fade** (ageEmitter): +0x28 >= 0 (or a looping emitter past E +0xc) -> by E +0x1f: 0 =
  30 frames, 1 = 15 (+0xd0 = 1 - (age - start) / length; removed at the length or when age < start), 2 = removed, 3+ = none.
  +0xbc = +0x15c x +0xd0 also without the cull (FUN_002ea6a0). `remove(em)` = FUN_002e6920(.., 0).
- T (test_effects): w220 open330 (help box, emitters age 124.8 = the dump's frame): picture 2 / 2 and panel models 14 / 14
  triangles exact; w232 rows dump = the state 321 + 3 frames: 162 / 162 triangles of the rank letters / evaluation (type 8)
  exact. Fixtures (gitignored): tools/trace/out/w220/fx330.json, w232/fx321.json, w232/fxrows.json, w198/lines3-5.json.
- Open: type 26 (FUN_002735f0, the Status panel's second spawner), type 119's draw, children's matrices, E15's model 0x21,
  type 113 (FUN_002d4250: frame-buffer passes, the title card's 0x818c0400).
