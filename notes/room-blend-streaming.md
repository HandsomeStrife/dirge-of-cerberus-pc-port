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
hero view 0.26% of pixels changed (|d| 0.07), walk 185126 view 0.07%; chunk 09 view: the orange wall
is a faint glow over the street; chunk 07: the black panels and the lattice stand-ins are gone and
the room's interior shows. Game evidence for chunks 07 / 09: see HANDOFF (worker 0213 entry).

Test: `node --import ./native/web/test_hooks.mjs native/web/test_room_stream.mjs` (rays over the
ranges showChunks leaves drawn: chunk 07 hits 07's wall, not 0c's panel; chunk 09's first surface is
the blended glow; ff88 additive; the six dump-measured ATE textures still alpha-tested).
`ROOM_DATA=<dir>` checks another export.

## Open

- Load timing: a chunk shows the frame its slot is marked loaded (area_stream.js GUESS: the disc
  read time is not modelled), so the page swaps chunks with no delay.
- Blend order inside a bucket (the game's per-chain lists, newest first, across chunks) and the
  second FUN_002661a8 call's place in the frame (buckets 0x18..0x1f: 0x19 / 0x1a used by 160 chains).
- index.html / main.js (the static viewer) has its own material copy: no 'add' blend, all chunks.
- native/gpu/render_scene_textured reads 4 room.list columns: it draws the additive groups opaque.
- The detached `?cam=` view streams by Vincent's position, not the camera's.
- The page's collision, bullets' room probe and light grids are unchanged (all chunks / their own rules).
