# Chunk slots and area streaming (worker 0216, 2026-11-02)

First-level plan P10: light 2 outside chunks 01 / 02. Code: `native/web/area_stream.js`; export:
`export_web_light.py` (light.json v2). Audit rows: fidelity-audit.md "Character lighting".

## The slot table DAT_004e4c60 (3 slots, stride 0x70)
- +0x20 / +0x28 / +0x30: resource ids of files 0680AA10 / 11 / 14 (FUN_00266ae0), +0x44 the 'cid' block of
  0680AA11 (FUN_00258f20(res, 0x646963)), +0x54 chunk, +0x5c loaded (0 at unload FUN_002688f0 and at load
  start; 1 at FUN_00266ae0 case 10).
- Stage load FUN_002673d8(zone, a, b): slot 0 = chunk 0 (case 7), slot 1 = a (case 8), slot 2 = b (case 9).
  z128: FUN_003ff7a8(0x80, 1, 2), then FUN_002677a0(1, 2) (case 3).
- Save state: slots 0 / 1 / 2 = chunks 0 / 1 / 2, all loaded; DAT_0046bfb0/b4 = 1, 2; DAT_0046bfb8/bc = 0;
  DAT_004e4c50 = 0; DAT_004fc7d4 = DAT_0046bfd0 = DAT_0046bfc8 = 1.

## Per frame (FUN_00248110: FUN_00267970, then FUN_0026a0c0, both before the game-state dispatch)
- FUN_0026a0c0: position = DAT_0046e290+0x50 (= Vincent's MP; FUN_003261e0) +0x10 matrix translation
  (FUN_005a70c8). FUN_00271b60 over the 'eib' block of slot 0's file 06800011 (FUN_00269bd0): the first box
  whose matrix (FUN_0026135c: r0 x + r1 y + r2 z + r3) puts the point inside [-0.5, 0.5]^3 (FUN_00271aa8).
  Type 0 -> FUN_002677a0(+0x50, +0x51) unless +0x44 bit 0; type 1 -> callback DAT_0046bfcc (none in z128).
  DAT_0046bfc8 / DAT_004fc7d8 only draw the boxes (FUN_00271a18 / FUN_00271a10).
- FUN_002677a0(a, b): busy (FUN_00267358: DAT_004e4c50) -> keep (a, b) in DAT_0046bfb8/bc and return.
  Else: pending = 0, current = (a, b); unload slots 1 / 2 whose chunk is neither; then for a, b (non-zero)
  not in any slot, the first free slot 1 / 2 gets a load job (DAT_004e4c50 = 1, slot, chunk) and it returns.
- FUN_00267970: runs FUN_00266ae0 on the job; on 1 (done) busy = 0, then FUN_002677a0(pending) if non-zero
  and FUN_002677a0(current) (re-read after the first call).
- FUN_0026a710 (light 2) scans slots 0..2 with +0x5c and +0x44 set: so the pick sees only loaded chunks.

## eib block (06800011 entry 'z128_m00' / 'eib')
i32 n (28), i32, n u32 offsets from the entry data; box 0x70: 4x4 f32, +0x40 type, +0x44 flags, +0x48 /
+0x4c / +0x54 type-1 args, +0x50 / +0x51 chunks. All 28 are type 0. They sit at the chunk seams and ladders
(e.g. (1, 2) above and (2, 3) below the ladder at (-841, y, -591)); the deck start is in none.

## On the page (after the manager review)
- The table also decides which chunks the ROOM DRAWS (room.js showChunks, worker 0213, called from play.js each game
  frame with `light.stream.loaded()`). Collision still uses every chunk.
- Box test at ctrl.prev (the matrix last frame's draw used = MP+0x10), not ctrl.pos.
- Page aids (not the game): H -> `reset()`; the ?ladder= warp -> `everyChunk()` (every chunk until a box's pair loads).
- Light 2 for every MP (Vincent, soldiers, props) through `Light2`, every game frame.

## Load timing, traced (worker 0247, 2026-11-03)
- Trace w247_rescue_load (tools/trace/scripts; state s826.p2s + TRACE_POKE=a06338=91379f02, worker 0244's rescue
  inputs, f0-600; fields.py `TRACE_SLOTS=1 TRACE_STREAMJOB=1`: DAT_004e4c50 job, DAT_0046bf94 case): the rescue's
  load(128, 2, 3) requests at f15; slot 1 (chunk 01) is unloaded THE SAME FRAME (FUN_002677a0 -> FUN_002688f0); the
  cases run f15 0, f16 1, f17 2, f23 3, f24 4, f31 5, f32 6, f43 7, f49 8, f55 9 (FUN_00266780: the 0680ff texture
  files) .. f83 10; slot 1 = chunk 03 loaded at f84: **69 frames**. Case 2/4/6/7/8/9 wait on a file's status +0x23a
  == 3 (disc), so the count is disc time. The game never keeps the old pair drawn during a load.
- The page keeps its next-frame stand-in (GUESS row): it shows the new chunk earlier than the game, never later.

## Dan's "texture deloading" report (worker 0247, 2026-11-03; reports/20261103T092417Z-7bd8)
- Feet (-1507.3, -0.06, -573.5), chunk 03 square, box pair (2, 3): only floor, banners, a barrel and actors drawn.
- Not the stream: the slots were right (0 / 2 / 3). Cause: the follow camera's rays tested chunks 0 / 1 / 2 only
  (player.js CAM_COL_FILES), so the eye went through chunk 03's camera wall at z -542.75 to z -538.83, behind chunk
  03's occluder quad 2 (x -1662..-553, y -125..159, plane z -540): FUN_0026ccc8 dropped most of chunks 02 / 03.
  Fixed by worker 0244's decode (FUN_0054c848 -> FUN_0054fc38 -> FUN_0026a320: the rays test the LOADED slots;
  play.js `camRays.chunks`): the eye stops at z -543.6 and the square draws. Test: test_market_cam_page.mjs.

## Open
- No GS dump outside chunks 01 / 02 (no save state past the start deck); the chunk-06 pick is checked against
  the decoded rule only. Needs a state on the route (shared with P2's chunk 07 / 09 dumps).
- Events' load(128, a, b) is not wired (no stage controller, P3).
- Camera collision's DCOL files [1, 2] (player.js GUESS) equal the start slots; the map object
  FUN_0053bb58 may follow this table (not checked).
