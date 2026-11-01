# The effect engine (FED particles) on the page (worker 0179, 2026-11-01)

Status: the 3D effect engine is decoded and translated in `native/web/effects.js` (engine, channel
types 1 2 4 7 9 14 15 16 22 23 24, the sprite draw type 10 down to the VU1 program) and wired to
the bullet wall impacts and the soldiers' bullets hitting Vincent. Checked against five PCSX2 save
states and two GS dumps taken during w172_sound3: every translated particle's values and matrix
match RAM, every translated sprite's TEX0, ALPHA, ST and vertex RGBA equal the GS draw, corners
within 1 px. Not translated (warned, not drawn): draw types 11 / 21 / 100 / 137 and a few channel
types, so each impact shows its flash sprites but not its burst (type 21) or small sparks (type 137).

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
  r0000, every 15 frames): MISSING.
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
Draw types 11 / 21 / 100 / 137, channel types 3 / 5 / 6 / 8 / 26, rotation orders 1-5 (FUN_002d82d0 cases
FUN_002d8060 / 80d0 / 8150 / 81d0 / 8250: in four of them the first call reads the output matrix; not
translated, such particles / emitters are not drawn), render
categories 2 / 6-9 (+0x54 matrix copy), looping / child / list-0 particles, emitter fade, attached
emitters (param +0x1d != 0), the frustum cull, the draw buckets, the screen-space (title) path, the
decal, FUN_00336508, hit effects on soldiers. Next: type 21 (the burst, FUN_0027bda0 / FUN_0027cd68,
also a FUN_00308028 sprite) and type 137 (FUN_0027da78, own packets), then a GS dump of a hit on
Vincent.
