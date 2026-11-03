# Room blend modes and area streaming on the page (worker 0213, 2026-11-02)

First-level plan item P2 (notes/first-level-plan.md): chunk 09 showed a flat orange wall at
(22, -40, 797) looking +z, chunk 07 big black panels near (-1780, -44, 1595). Two separate causes,
both decoded and fixed in the room export + room.js.

## 1. Chunk 09's orange wall = a fire-glow volume drawn opaque

Ray cast from the reported view (scratch raycast.py over every 0680AA12 packet): the first surface is
chunk 09 chain 84 (packets 168-173, 49 tris, bbox (-25,-89,776)..(65,-40,880)), texture 0680ff35,
vertex colour (127, 70, 35) with vertex alpha 0..25. The view stands inside it. z128 has 25 such
glow chains (chunks 02-09, 0b). The room export drew every packet opaque unless its FileCode was in
the hand list ALPHA_TEST, so these became solid orange.

How the game draws a room chain (decoded):
- FUN_0026ce60: header +0x94 bit 1 set -> the chain is not sent in place; it is pushed on sort bucket
  +0x97 (list heads DAT_004e4778; bucket 0 means index 0x17).
- FUN_002661a8 drains buckets 0..0x17 (a second call, in_t0 != 0, drains 0x18..0x1f). Per chain:
  FUN_00265b80(ALPHA = DAT_0046bf60[m], TEST = DAT_0046bf78[m] | (+0xa8) << 4) with
  m = (+0x94 & 0xc) >> 2, then FUN_00265bf0 (the chain's DMA ref; +0xa9 second pass as before).
- Tables from save RAM: ALPHA 0x44 / 0x48 / 0x42, TEST 0x5300b / 0x51001 / 0x51001.
  - m 0: ALPHA 0x44 = (Cs - Cd) As + Cd; TEST ATE, ATST GEQUAL ref, AFAIL RGB_ONLY, Z GEQUAL
    -> blend everything, write depth only where As >= ref (the page's existing two-pass '@atest').
  - m 1: ALPHA 0x48 = Cs As + Cd; TEST ATST NEVER, AFAIL FB_ONLY -> additive, never writes depth.
  - m 2: ALPHA 0x42 = Cd - Cs As (subtractive): no z128 chain uses it (warned, opaque).
- +0xa8 = 96 on every bucketed chain (one non-bucketed chain has 18; it never reaches the TEST).
- In z128 a packet has PRIM ABE set exactly when its chain is bucketed: 3906 / 3906 (2692 m 0,
  1214 m 1). Non-bucketed chains never blend.

Checked against the hero GS dump (163235): m 0 textures (ff31 TBP 11220, ff30 10960, ff28 10828,
ff32 11288, ff54 11800, ff07 10792) are drawn with TEST 0x5360b (= 0x5300b | 96 << 4) and ALPHA 0x44;
TBP 11836 (944 tris a frame) and the sky TBP 11504 with TEST 0x51601 and ALPHA 0x48. The old
hand-measured ALPHA_TEST list (ref 96) is exactly the decoded m 0 rule; it stays in the exporter as a
check only. New: 1323 more packets get the m 0 blend, and 11 groups (0680ff88 the largest, 12k tris)
are additive.

Code: bmd_chains.chain_headers returns `aref` (+0xa8); export_z128_room.py `chain_blend` (BUCKET_ALPHA /
BUCKET_TEST), groups '@atest' (ref from the header) and '@add'; room.list col 6 'add';
export_web_room.py scene.json draws[].blend; room.js `makeMaterial` draws 'add' with
SrcAlpha / One, no depth write. Blended groups go after the opaque pass and the sky, ordered by the
bucket holding most of their triangles (GUESS: order inside a bucket, and when the second call
runs; audit 'Room blend order').

## 2. Chunk 07's black panels = chunk 0c, which the game never has loaded there

Ray cast from (-1820, -60, 1595) looking +x: the first surface is chunk 0c packet 144 (vertex colour
0, 0, 0), 2 units in front of chunk 07's real wall (pkt 1262). Chunk 0c is a set of coarse stand-in
walls (black windows, blurry lattice walls) over rooms that are not loaded.

The page drew all 13 chunks; the game holds three (worker 0216 decoded the slot table for light 2,
notes/area-stream.md, native/web/area_stream.js):
- DAT_004e4c60, 3 slots x 0x70: slot 0 = chunk 00, slots 1 / 2 = the streamed pair (+0x54 chunk,
  +0x5c loaded). Save state: chunks 0 / 1 / 2 (RAM search: only 0680{00,01,02}{11,12} are resident).
- FUN_0026a0c0 every frame: the first box of 06800011's 'eib' block (FUN_00269bd0 ->
  FUN_00258f20(res, 'eib'); FUN_00271b60 / FUN_00271aa8: p x M inside the unit cube) holding Vincent
  (FUN_003261e0 = DAT_0046e290 + 0x50 = his motion player, +0x40 = C+0x30 in the save) -> type 0:
  FUN_002677a0(+0x50, +0x51).
- The 28 boxes pair: (1,2) (2,3) (3,4) (4,5) (5,6) (6,7) (6,8) (6,12) (8,9) (9,11) (10,11) (11,10).
  Chunk 0c (12) is only ever loaded with 06, from one box at (-1510, -134, 1460). Chunk 07's room is
  in no box; the way in passes the (6, 7) boxes, so {00, 06, 07} is loaded there.

Code:
- export_z128_room.py: each group's triangles are already in chunk order; the manifest stores
  [chunk, first vertex, count] per group (`chunks`), scene.json draws[].chunks.
  Cross-chunk de-duplication and the 'covered' drop now only drop a copy when the chunk keeping it
  is ALWAYS loaded alongside (`co_loaded`: chunk 00 + the partner every pair shares); depth-tie
  marks (`@under`) are made against chunks that CAN be loaded alongside. Duplicates dropped
  6757 -> 901 tris, covered 4505 -> 466 (the game draws both copies when both are loaded).
  `--all-chunks` restores the old rule for a viewer that draws everything.
- room.js `showChunks(root, loaded)`: each chunked draw has CHUNK_SLOTS = 3 geometries sharing the
  attributes; their draw ranges are set to the runs of loaded chunks (count 0 when unused).
- play.js: after `light.stream.frame(ctrl.pos)` (FUN_0026a0c0's place in the frame), showChunks with
  `light.stream.loaded()`; at load with the stage-load pair. Without light.json areas: every chunk.

## Grading

Page captures (room only, the game's 432x512 projection; scratch capture.mjs) vs the old data:
hero view: 0.75% of pixels change at all (manager review; my first count, 0.26% / walk 0.07%, was at
320x240 with |d| > 30, which hid the change below); chunk 09 view: the orange wall
is a faint glow over the street; chunk 07: the black panels and the lattice stand-ins are gone and
the room's interior shows. Game evidence for chunks 07 / 09: see HANDOFF (worker 0213 entry).

Test: `node --import ./native/web/test_hooks.mjs native/web/test_room_stream.mjs` (rays over the
ranges showChunks leaves drawn: chunk 07 hits 07's wall, not 0c's panel; chunk 09's first surface is
the blended glow; ff88 additive; the six dump-measured ATE textures still alpha-tested).
`ROOM_DATA=<dir>` checks another export.

Chunk 06 (market, worker 0217's teleport state r06_tp, game slots 0 / 6 / 8): page from the game's camera
vs its GS dump, mean |d| 7.8 before -> 7.4 now (room only vs a frame with Vincent and the HUD); no
defect, the geometry, stall and lights line up (scratchpad w0213_chunk06_game_vs_page.png).

## Review fixes (2026-11-03, manager review of this work)

1. Additive As: the GS As reaches 0xff / 0x80 (ff88's vertex alpha goes to 192, As 1.5); a blend factor
   clamps it to 1. room.js now outputs Cs x As from the shader (uAdd) with blend factors One / One.
2. Pixel grade: `node native/web/test_room_grade.mjs`. (a) room.js materials vs the GS formulas, 108
   untextured cases (additive with alpha 16..255, blend + ATE): worst 1 level. (b) GS-dump fixtures in
   tools/trace/out/room_grade (room_grade_fixture.py; dumps and states in its src/): c09 = chunk 09's
   reported view (street |page - game| 7.9; control with the blended chains opaque 56.1); c0b = a new
   grab where ff88 shows (Vincent poked to (1103, -173.8, 1176.6); the game streamed 0 / 9 / 11; ff88
   adds light to 11% of the frame): coverage IoU 0.55, never darkens. Brightness not graded: the page's
   ff88 adds 0.44 of the game's light because ff88's UVs scroll per chain in the game (dump UV - file
   UV is constant per chain, e.g. du -0.41 / dv +3.66; FUN_00265560 sends (+0xa4, +0xa6) / 4096,
   which FUN_00265bf0 copies from the chain's material +0xdc / +0xde; the animator is decoded since: "Scrolling UVs" below).
   Blend mutants (scratch copy): additive dst 1-SrcAlpha, As capped at 1, untextured As = A / 255,
   ATE pass dst One: 4 / 4 killed; additive src SrcAlpha survives, equivalent (the shader writes
   alpha 1).
3. **Chunk 00's bright ff31 battlements (group 69) show on the start deck; the game does not send
   them.** Two room visibility systems, both DECODED here, NOT yet on the page:
   a. *The visibility mask follows the camera.* FUN_00264ee0 (every frame, from FUN_00264f68) casts
      FUN_0026a320(eye, eye + (0, 100, 0), 0x10f) from the camera eye (matrix 0x4fcb10) and, on a hit,
      FUN_00269400(FUN_0026f1f8()) = the hit's 16-byte entry DAT_004e8880; no hit -> 0. FUN_0026f8a0
      copies it from the hit cid's surface table (+0x24, count +0x20) at the index the VU0 test returns
      (vi3), which is the tag-2 packet header's 4th S-16 ([Ntri, nquad, mask, index, 0, QWC]; -1 =
      none). FUN_00269410: DAT_004e8710 = DAT_004e86f0 | DAT_004e8700 (the script half, cmds 0x54 /
      0x55). Checked against 8 save states (start, 5 route states of worker 0217, the chunk 06 and 09
      teleports): the probe from each state's CAM+0x90 over its loaded chunks gives DAT_004e86f0
      exactly ({0,19,25,56,57} on the deck, {0,1,2,19,25,56,57} at the deck end, {3,22,47,57,69} in
      chunk 09, {} in the market). Tables live in 0680{01,03,05,06,07,08,0b}11 'cid'. So
      export_z128_room.py's fixed HIDDEN_GROUPS (the start mask) is wrong away from the start: e.g. in
      chunk 09 the game hides 3 / 22 / 47 / 69 and shows 0 / 19 / 25 / 56. Port: export the class-0x80
      probe triangles with their header index + each chunk's table; keep hidden-group chains in the
      room export with [chunk, first, count, group] ranges; probe every frame after the camera, hide
      groups in showChunks. This also answers effects.js's 'hidden-cell mask' GUESS row.
      (Scratch: worker 0213 vis2.py, vistris.txt from a cidtool build that prints header[3].)
   b. *Occluders.* Group 69 is not in the hero mask; the chains are dropped by occluder culling:
      FUN_0026ccc8 skips a bone-tree child node (node +0x80, 8 pointers) when FUN_00269978(node, 8):
      all 8 points of the node's box lie inside one of DAT_0046bff8 (<= 15) occluder volumes
      (FUN_002698d0: 4 side planes + the occluder's own plane, 0x50 bytes at DAT_004e5db0). The volumes
      are rebuilt every frame (FUN_00269868 -> FUN_00268b58 per loaded slot -> FUN_0026c878 per entry of
      the slot's resource +0x20 list, each entry's +0x18 = count + quads): a quad passing the frustum
      test FUN_0040d6f8 and FUN_0026c728 gives planes through the camera and each edge (cross products
      of corner - eye), w = -dot(n, eye). Save state: 6 volumes. Chains inside a node are also
      box-culled per chain on VU0 (vcallms 0x6d8: 8 corners through matrix slot +0x96 + 1, CLIP AND).
      Not ported: needs the BMD node tree (child boxes, which chains hang under which node) and the
      occluder quad lists in the export, then a per-frame cull in room.js. Size L. Also answers
      effects.js's 'occluder test never hits' GUESS row (FUN_00269978).
   Until (b) lands, the deck shows those battlements ~8 levels brighter than the game in the
   y 64..191 band (before streaming, chunk 09's dark copy happened to cover them).
4. Blend order (audit row corrected): additive draws write no depth, so a later blended surface behind
   one still blends over it: order matters for every overlap. The game's order: buckets ascending
   (0 -> index 0x17, last), inside a bucket the chains newest-first as FUN_0026ce60 pushed them (slot
   order, then the bone-tree walk), per chain. With per-chain order the level has 2204 blended chains
   in 916 same-texture runs (822 in bucket 0x17). Not done: the page still orders texture groups by
   their majority bucket, then by triangle count (GUESS row). No visible error found in the checked
   views.
5. Not decoded: ABE draws with TEST 0x51000 (ATE off; hero dump TBP 10828 / 10960 / 10792, ~76 tris)
   and untextured ABE draws at the end of the frame. They come from another path than FUN_002661a8
   (not the room's bucketed chains); not on the page.
6. index.html / main.js (static viewer) now draws the room data without streaming: it shows the
   duplicate copies the export keeps (only exact copies in always-co-loaded chunks are dropped) and
   chunk 0c's stand-ins, and draws additive groups opaque.

## Open

- Load timing: a chunk shows the frame its slot is marked loaded (area_stream.js GUESS: the disc
  read time is not modelled), so the page swaps chunks with no delay.
- Blend order inside a bucket (the game's per-chain lists, newest first, across chunks) and the
  second FUN_002661a8 call's place in the frame (buckets 0x18..0x1f: 0x19 / 0x1a used by 160 chains).
- index.html / main.js (the static viewer) has its own material copy: no 'add' blend, all chunks.
- native/gpu/render_scene_textured reads 4 room.list columns: it draws the additive groups opaque.
- The detached `?cam=` view streams by Vincent's position, not the camera's.
- The page's collision, bullets' room probe and light grids are unchanged (all chunks / their own rules).

## Scrolling UVs (worker 0226, 2026-11-03)

DECODED, on the page (room.js `RoomUVAnim`; exporter `native/assets/models/bmd_uvanim.py`).

- **Data.** Each chunk has an animation file next to its BMD: `<level><chunk>10` (z128: 0680NN10; pointers
  are payload offsets). FUN_00266ae0 loads it into the slot's +0x38 state; FUN_002680e0 allocates the slot's
  time array (+0x40, one f32 per animation) and zeroes it; FUN_002681b0 frees it on unload.
- **Per frame.** FUN_00248110 -> FUN_00265350 (late in the frame, after the stream and the logic; it also runs
  during events) -> FUN_00263e90(slot) for each slot with +0x5c != 0 and +0x58 == 0 -> FUN_0026c198(BMD,
  slot+0x38, ..) per model. Per animation i with flags (+2) bit 0 set and +6 == 0, per track (+8 list; curves
  +0xc list): track +0x10 = node (BMD header +0x1c table; -1 none); track +0x26 -> node +0xdc =
  (short)(int)(u(t) * 4096); +0x28 -> node +0xde = (short)(int)(-v(t) * 4096); then time[i] +=
  DAT_004fc7e8 * 0.5 (1.2 * 0.5; 0 while DAT_004fc7e4 == 1). Loop = flags bit 1 clear (all z128 UV anims).
  (+0x14.. position, +0x1a.. rotation, +0x2a -> node +0xd8 x 0.01: the texture blend factor, see Open.)
- **Curves.** FUN_00262328 / FUN_002621c8: u16 key count, u16 done flag, keys (time, value, in tangent, out
  tangent). Loop: t = fmodf(t, last time); t <= first time -> first value; t >= last -> last value; else
  Hermite (DAT_0046be50 = 2 -2 1 1 / -3 3 -2 -1 / 0 0 1 0 / 1 0 0 0) of (p_i, p_i+1, out_i*dt, in_i+1*dt).
  All 581 z128 UV curves are 2-key linear ramps (tangent = slope).
- **To the GS.** Node +0xc4 indexes the BMD mesh table (+0x14); the mesh's +8 lists node +0xc8 chain draw
  objects (FUN_0026bc28). FUN_00265bf0 copies node +0xdc / +0xde to the chain (+0xa4 / +0xa6),
  FUN_00265560 sends them x 0.00024414062: GS UV = file UV + offset (sign +, measured).
- **Float detail.** The PS2 FPU add rounds toward zero: the RAM times (244.79793 after 408 frames, not
  244.80096) match only that; room.js `addRTZ`.
- **Which chains.** ff88 (fire glow: 40 / 35 / 12 / 59 / 45 / 25 / 40 / 30 nodes in chunks 01 / 03 / 04 / 05 /
  06 / 08 / 09 / 0b), the BMD sky chains ff35 (chunk 00), ff34 (chunk 01, 4 nodes), ff4a (chunk 04, 4 nodes).
  14 animations, 295 tracks. No other room group scrolls (water / smoke / signs: none in z128's files).
- **Checks.** test_uvanim (node): from load, the page's frames reach the RAM times exactly (c0b chunk 09 /
  0b: 408 / 337 frames; c09 chunk 08 / 09: 390 / 358) and the node offsets = RAM on 141 / 141 and 131 / 131
  nodes; chunk 00's time (1481.948 in both states) is not n x 0.6 from 0 (stage load / event frames), checked
  directly. GS dump tp0b frames 0..3: dump UV - file UV = the offsets on 21 ff88 nodes x 4 frames (worst
  5e-7; frame 0 = the state's RAM offsets, then 0.6 per frame). Hand cases: Hermite basis, (short) wrap
  (end values reach +-20 units), loop, reset on reload. test_room_grade c0b: ff88's added light correlates
  r 0.905 with the game's per pixel (0.539 without the scroll), IoU 0.55 -> 0.88, total 0.44 -> 0.61.
  Mutants (scratch copies): u sign, v sign, rate x2 / x0.5, round-to-nearest adds, advance before evaluate,
  no loop, round instead of trunc, offset scale, lerp instead of Hermite, no time reset: 11 / 11 killed
  (node test); (short) wrap removed: equivalent (the page's Int16Array does the cast).
- **Fixture.** `python3 -I tools/trace/uvanim_fixture.py STATE NAME [DUMP TBP ENTRY]` ->
  tools/trace/out/room_grade/uvanim_NAME.json (c0b: src/tp0b_450.p2s src/tp0b.bin 11808 88; c09 likewise,
  no ff88 in its view).

### Open

- **Texture alpha (fixed, 2026-11-03 follow-up).** The c0b dump's ff88 draws (frame 3: 672 tris, TEX0 PSMT8,
  CBP 11804, CPSM CT32, CSA 0, after the frame's 64 x 64 upload to TBP 11808; the 7 PSMT4 draws before it
  are 0680ff24, not ff88) decoded with their CLUT = dtex's 0680ff88 RGB exactly, but the CLUT alpha runs to
  0xff (29% of texels above 0x80; mean 83.8) and dtex rescaled it A * 255 / 128, clamped: the page capped
  At at 0x80 (texture light 0.60 .. 0.80 of the game's per channel). Now `dtex --raw-alpha` keeps the byte,
  export_web_room.py decodes room textures with it (scene.textures[].alpha 'ps2'), room.js / main.js scale
  it (uTexA = 255 / 128). Changes the additive groups ff88, ff74, ff1f, ff17 (texels above 0x80); ATE groups
  compare a capped alpha (unchanged), opaque groups ignore it. c0b: total 0.61 -> 0.83, r 0.954, IoU 0.92;
  mutant uTexA = 1: 0.42, killed.
- **ff88 is still 0.83 of the game's added light at c0b.** Ruled out: the scroll (r 0.954), mipmaps (no
  change without them), duplicate copies between chunks 09 / 0b (0 shared triangles), the texture RGB and
  alpha (= the dump's CLUT decode). Not checked: the vertex alpha / colour path (Av, As = At * Av >> 7
  rounding), the GS fragment clamp order. Nothing on the page depends on it.
- The +0x2a tracks (node +0xd8 = curve x 0.01, used by FUN_00265560 when the chain's +0x94 has bit 0x100:
  a 1 - f / f texture blend) on ff35 / ff1f / ff09 / ff77 / ff87 / ff71 / ff17 nodes: not on the page.
- Animations not playing at load (flags bit 0 clear: chunk 0b's position / rotation tracks, started by
  FUN_00268220 from scripts) and the node matrix tracks: not on the page.
- When a chunk loads is area_stream.js's GUESS (a chunk's times start the frame its slot is marked loaded).

## Back faces (worker 0227, 2026-11-03)

- **Program.** The room draws with VU1 **program A** (`port/vu/disasm/program_A.txt`): FUN_00265560 sends 9 qw
  to VU address 0 (A's vf01-vf09: screen matrix, clip matrix, 0x80 fog / UV bias) + 5 qw to 0x14, BASE 0x8d /
  OFFSET 0x190, then MSCAL 0 (instr 11), 4 (+0x94 bit 0x100: instr 359) or 6 (instr 799); each chain packet ends
  in MSCNT (instr 26 / 374 / 824). The sea-of-flames save's vu1MicroMem is program B (byte-identical), so A
  is uploaded for the room draws within the frame.
- **Test.** Per packet vi07 = 0x20 - (header qw0.w & 0xffff) (instr 29 / 36-37; 377 / 385; 829 / 841). Per
  triangle the screen-space cross (v0 - v1) x (v1 - v2) (post divide, GS coordinates, OPMULA / OPMSUB) sets
  the MAC sign-z flag 0x20 when negative; FMAND vi07 -> skip. Lists: instr 97-106 (skip -> 162). Strip
  quads (4-vertex groups, triangles (v0, v1, v2) / (v2, v1, v3)): both crosses (249-253), FMAND each (255 / 257),
  **IAND** (258): the quad is skipped (ADC on all 4 vertices, 343-346) only when both triangles are back-facing.
  The same at 473 / 673-681 / 915 / 1078-1086. The clipper (instr 1188.., quads with any vertex outside the
  clip volume, FCAND 0xffffff at 236) culls each triangle on its own (1370-1374, vf14 = +-1 for the strip's
  second triangle). Kept = cross z >= 0 = clockwise on the GS screen (y down) = a WebGL back face in the
  emitted order (the page's camera is a rotation, up (0, -1, 0); the page image is the game's, not mirrored).
- **Data.** z128: header w is 0 (17349 packets) or 0x20 (731), and 0x20 exactly on the chains with header
  +0x94 bit 0 (all 18080 packets): those are two-sided. 75152 strip quads, 6905 non-planar by > 2.5 deg,
  68 with a zero-area triangle (never culled: the flag is not set for a zero cross).
- **GS evidence.** The room's opaque quads (TEST 0x5000e) as sent to the GS, strip parity undone: tp09 721 / 727,
  tp0b 972 / 986, npc_g100 346 / 353 have both triangles clockwise; the few mixed ones are the IAND rule
  (a back-facing triangle drawn because its partner faces).
- **Page.** export_z128_room.py `cull_tag` / `build_flat_kept`: per vertex float32 x 5 (`room_gNN.cul`,
  scene.json meshes[].cul), the same on a triangle's three vertices: the strip partner's game-front plane
  (n, d) (NEVER (0, 0, 0, -1) for two-sided chains / zero-area partners, NO_PARTNER (0, 0, 0, 1) for lists),
  then the triangle's own game-front plane distance (its normal is vertex floats 3-5). room.js VS (review
  fix, 2026-11-03): both planes evaluated at the eye from uniforms + per-triangle constants only
  (-dot(normalMatrix n, modelViewMatrix[3].xyz) - d), so the three vertices agree bit for bit; a skipped
  triangle collapses to one point outside the clip volume (the plane-side test = the screen winding for w > 0).
  No fragment discard for the cull; the alpha-test discards compile only into the ATE passes (`#define ATEST`),
  so opaque room materials keep early z. `?cull=0` draws both sides (page aid). (First version: int16 partner
  normal + flat provoking-vertex varying + FS discard; replaced after the manager's review.)
- **Checks.** `python3 -I native/assets/models/test_cull_tag.py` (hand cases, z128 header vs +0x94 bit 0,
  the three dumps; mutants 6 / 6: no rotation, partner sign, wrong partner, two-sided ignored, zero-area
  partner culled, list as quad). test_room_grade: room.js vs the VU rule on 300 triangles of random non-planar
  quads; per-pixel at c09 / c0b / npc (the pixels the cull changes are nearer the game: npc 170673 px,
  |page - game| 10.2 -> 5.7; c0b 2245 px, 21.6 -> 18.9; c09 6 px). Mutants 6 / 6 (no discard, side flip,
  no partner rule, partner sign, mode 0 culled, uniform off). New fixture `npc` (worker 0223's grabview
  g100 dump + s100 state: room_grade_fixture.py ... npc).
- **Perf** (headless SwiftShader, the reviewer's perf.mjs + a fixed-view bench at 432 x 512 and 1920 x 1080): the
  differences (VS cull vs no cull vs discards forced on every material) stay inside run-to-run noise (the same
  variant moves 2x between repeats on this shared machine); not measurable here.
- **Raw alpha / TEXA (review fix).** `dtex --raw-alpha` gave CT24 / CT16 / 16-bit-CLUT texels 255 (As 1.99 in
  room.js's additive path). The GS expands them with TEXA; the room's draws in tp09 / tp0b / npc_g100 run with
  TEXA 0x8000000080 (TA0 = TA1 = 0x80, AEM 0; 0x8000008080 is only on non-room draws), so raw mode now gives
  0x80 (dtex `DTEX_RAW_TEXA`). No z128 room texture uses those formats (re-export: 0 textures changed).
  Test: `python3 -I native/assets/textures/test_raw_alpha.py` (hand-made TIM2s; 4 / 4 mutants killed).
- **Open.** The clipper path's per-triangle rule is not reproduced (a quad at the clip-volume edge with one
  back-facing triangle: the game drops that triangle, the page keeps it): fidelity-audit row. The sky
  (export_z128_sky.py) and main.js's own room copy draw both sides; the sky's packets were not checked.

## Visibility mask on the page (worker 0225, 2026-11-03)

'Review fixes' 3a is ported. Decoding additions:
- FUN_00264ee0 stores the probe's eye at DAT_004e4800 (fixture: tools/trace/room_vis_fixture.py reads it, the
  slot table and DAT_004e86f0 / 8700 / 8710 from a save state).
- FUN_0026a320 -> FUN_00271408 (best t = 10.0, class DAT_004e8898 = 0x10f | 0x100, DAT_004e8880 = 0) -> per loaded
  slot FUN_002714d0 -> FUN_00270088 (the +0x58 sub-tree): tag-0 leaves go to FUN_0026f750 (no mask test; moves the
  best t without touching DAT_004e8880; z128's +0x58 sub-trees have none), tag-2 leaves to FUN_0026f8a0 (packet mask
  & ~DAT_004e8898; hit t <= 1 and < best; DAT_004e8880 = table entry only when header[3] is in range).
- In z128 only class-0x80 packets pass (masks 0x80 / 0x8c / 0x8e / 0x180 / 0x184 / 0x188 / 0x18c): 302 triangles in
  chunks 01 / 03 / 05 / 06 / 07 / 08 / 0b, tables of 4 / 1 / 6 / 3 / 3 / 4 / 24 entries.
- FUN_0026ccc8 loads the group byte +0xaa with lbu (0x26cd94): 2118 chains have 255 and are never hidden.
- The effects' cull FUN_002ea6a0 copies FUN_00269498() = DAT_004e8710 at the cull (FUN_002efe98, after the room draw
  FUN_00264f68 in FUN_00248110): the fire sees this frame's probe.

Page: `native/assets/collision/cidvis` (cid.c now records each tag-2 packet's header[3] and the cid surface table;
cidweb's DCOL output is byte-identical) -> data/z128_vis.json (build step room_vis). export_z128_room.py keeps every
chain; scene.json ranges are [chunk, first, count, group]. room_vis.js: `createRoomVis(data).probe(eye, loaded)`,
`createVisMask()` (the two halves). play.js probes before the chunk stream with follow.eye (the event camera's eye
during the opening); the stage scripts' cmds 0x54 / 0x55 write the script half; room.js showChunks(root, loaded,
mask) draws each chunked draw through one index over its visible ranges (`visibleRanges`; root.userData.chunksShown
keeps the chunk list, visShown the mask); effects.js `createEffects({ mask })` culls by it.
Checks: test_room_vis (9 / 9 save states, FUN_0026f8a0's rules on hand data, chunk 09 hides 3 / 22 / 47 / 69 and
shows 56, the start deck hides 0 / 19 / 25 / 56 / 57, the fire's cull follows the mask); test_room_grade (the page
probe from the c09 / c0b eyes = their DAT_004e8710; grades unchanged: c09 street 7.9, c0b IoU 0.55);
test_room_stream. No dumped view (start, r02_climb, r06_tp, c09, c0b) has a group whose visibility changed on
screen: 0 pixels differ.
Still open: occluders (3b; group 69 on the deck), the VU0 ray test (GUESS row), the script half's start value.

### Review fixes (worker 0225, 2026-11-03, manager review)
1. The mask everywhere the room is drawn: `room_vis.js startMask(vis, eye)` = the probe from the start camera eye
   (scene.json camera = the save's DAT_004e4800) over the stage load's slots 0 / 1 / 2 (START_SLOTS; FUN_003ff7a8(0x80,
   1, 2)) = {0, 19, 25, 56, 57}. main.js applies it (room.js showChunks on its draws); play.js without area boxes probes
   every frame through every chunk's cid (it draws every chunk); report.js's CPU ray cast walks each geometry's index /
   draw range (hook `window.__rayCast`). Native: export_z128_room.py writes `@group MESH FIRST COUNT GROUP` lines in
   room.list (export_web_room.py skips them), render_scene_textured drops the ranges its mask hides: `-hide G,..`, or the
   same probe from `-vis-eye` / `-eye` through `-vis` (default ../web/data/z128_vis.json); at the hero camera it hides
   0 / 19 / 25 / 56 / 57 = 10361 triangles (the old baked mask: 10362), 65 px of the hero view.
2. Restart clears the script half in play.js restart() itself (fire or no fire).
3. test_room_vis: near-to-far and far-slot-first nearest-hit cases (removing `t < best` now fails).
4. showChunks: no allocation when the loaded set and the mask are unchanged (chunk bit set, 4 mask words); a geometry's
   index is rebuilt and uploaded (addUpdateRange: the used part) only when its drawn ranges changed (per-range flags).
New test: test_room_vis_page (the hidden-group triangle is neither drawn nor hit on play.html / play.html without area
boxes / index.html; Restart without the stage fire clears the script half).
