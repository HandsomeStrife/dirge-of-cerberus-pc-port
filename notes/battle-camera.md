# battle()'s camera and the camera collision chunks (worker 0244, 2026-11-03)

Question (from worker 0229): after the rescue beat's battle() the game's eye is ~21 u from the look point, the page's 36.1 u,
same direction.

## Answer: two pieces, both decoded

### 1. The camera's rays test the loaded chunk slots

FUN_00544f90 -> FUN_0054c848(map object, probe 6) -> map object vt+0x17c. The map object is FUN_0053bb58(mgr):
FUN_0053e040(mgr, mgr+0x1c) (= mgr+0x1164 table) then vt+0xb4. In RAM (s826): mgr 0x128380, index 1, object 0x1cd9c0,
vt 0x58c9e0; vt+0xb4 = 0x550220 (`jr ra; move v0, a0`: the stage object itself); vt+0x17c = **FUN_0054fc38** ->
**FUN_0026a320**, which loops DAT_004e4c60's three slots (stride 0x70): slot +0x5c loaded, +0x44 the slot's collision,
+0x54 the chunk. The DCOL's input file k is chunk 0680{k}11 (FORMAT.md: the 13 chunk files merged in order), so the
rays test the files of the loaded slots' chunks. The old GUESS [1, 2] was exactly the save's slots (0 / 1 / 2; chunk 00
has no collision).

T w244_rescue_slots (`TRACE_SLOTS=1`, new in fields.py): slots 0 / 3 / 2 at the rescue (request pair 2 / 3).
With chunk 3 the page measures 21.652 there; the game eases toward ~21.656 (fit of CAM+0x1c0 over f2160-2390).

FUN_00544f90's second cast and FUN_005449f0: 'The pre-probes and probe 6' below (worker 0257).

### 2. battle()'s frame: an in-place update, a type re-enter with ramp 1, then a message re-enter with ramp 0

Call log w244_rescue_calls (set `w244` in calllog.py), one frame:

| call | CAM+0x17c after | CAM+0x1c0 after |
|---|---|---|
| FUN_00324e70 -> FUN_00329f68 -> FUN_003285d0 (angles, snap, 1000) | 0.9495 | 1000 |
| FUN_00337148 -> type vt+0x14 = FUN_00330478 (in place) | 0.9512 | 21.3024 |
| FUN_004012c0 case 9 (event +0x1528, set by FUN_0037cf30) -> FUN_00326da8: FUN_0053d420 posts 0x7d5, FUN_0032a420(CAM, view, 1, 1) -> FUN_00337338(CAM, 0xc, 1, 0) -> FUN_00330240 -> FUN_0032aaf8(.., 1) | 1 | |
| FUN_00326da8's FUN_00337148 | 1 | 21.3034 |
| the frame's own update | 1 | 21.3045 |
| message 0x7d5 -> FUN_0032a820 -> FUN_00337338(CAM, CAM+0x28, -1, 0) -> enter -> FUN_0032aaf8(.., -1) | 0 | |

Camera type 0xc's vtable 0x4a07a8: +0xc enter FUN_00330240, +0x14 update FUN_00330478, +0x2c FUN_0032a7e8
(FUN_00329dc8 = copy to the render view, clear 0x400), +0x5c FUN_0032aaf8. FUN_00337338 writes the phase CAM+0x2c = 0
after the enter (so ramp 1 + phase 0 settles to phase 1 in the next update).

The 21.30: the in-place update blends the eye from the OLD follow eye (285 u away, Vincent's previous place) by
FUN_00260d44(0.9495) and measures the distance from that blended eye (CAM+0x1c0 = 1000: the in branch). The later
updates keep it (the eye stays where it is while the ramp 0 -> 1 blends from it, and CAM+0x1c0 eases out at x 0.1:
21.29 -> 21.48 by f2399, toward the collision distance 21.66).

## Page

- player.js `cameraRays`: triangles by file; `rays.chunks()` (default `CAM_COL_FILES` = [0, 1, 2]).
- play.js: `camRays.chunks` = the area stream's loaded slots (not `everyChunk()`, the drawing aid).
- player.js FollowCamera: `resetAngles` (FUN_003285d0 alone; `reset()` uses it), `battleReset(p, s)`,
  `battleHandBack(p)`, `messages()`; aim_core.js `setView(mode, p3, p4)` (forced same view) and `enterType(old, p3)`
  (ramp 1 when p3 = 1).
- play.js `stageCameraReset` = battleReset + battleHandBack; `follow.messages()` right after the frame's follow.tick.

Checks: `node --import ./native/web/test_hooks.mjs native/web/test_battle_camera.mjs` (from the game's state at f2125:
the four calls' ramp / distance, then 274 frames: eye 1.1e-3, look-at 4.1e-5, CAM+0x1c0 2.8e-4, ramp 1.2e-6; the
start slots miss by 14.7; play.js wiring). Mutants 10 / 10 killed. test_cam_traces 30 / 30, test_aim_camera unchanged.
test_npc_page: the page's own route reaches the rescue with slots 0 / 3 / 2 and CAM+0x1c0 21.65 three frames on.

## Open

- The page's route differs before battle(): the game's ramp was 0.9495 there (the type re-entered ~110 frames before,
  inside the unskipped roji02_01); the page auto-skips that event, so its blend starts elsewhere and its distance is
  the collision one (21.65 vs the game's 21.29, converging). Lead: the event native setBattleCameraInterpolationTime
  (warned as not translated: "the follow camera's blend from the event camera").
- The base y: the game's body is still at setpos's y 0 in battle()'s frame (the look point shows it) and lands over
  ~30 frames; the page lands it at once (vinBattle.place), so the look point starts 0.06 off.
- The in-place updates get no stick on the page (keys are read after the stage tick).

## The pre-probes and probe 6 (worker 0257, 2026-11-03)

FUN_0032ace0 l.1820-1990 moves the look point's rotated pivot `pr` before the eye rays (gate FUN_00326500 = DAT_0046b2fc, the
region: 2 on SLES). With v = eye offset + pr, S = base + v - forward x f23:
1. side = v projected on M row 0 (FUN_0025a778 with f12 = 0; both call sites checked in the asm). If |side| >= 2.5 (DAT_0046e4e4):
   FUN_005449f0(mgr, 6, hit, n, S - side, S + unit(side) x 1). d = |hit - (S - side)|; d < |side| + 1 -> pr.x / z += unit(side) x max(d - 1, 0) - side.
2. Map only (stage object vt+0x17c, probe 6): from (base.x, base.y + pr.y, base.z) to base + pr: on a hit, e = n (n . (hit - end)); if |e| > 0.001, pr += unit(e) x (|e| + 0.1).

**FUN_005449f0 probe 6** walks the grid +0x1170: objects with +0x28 bit 0 and +0x38 bit 6, the nearest by their vt+0x17c. From route RAM
(TRACE-free: grid walk of r03_start / r06_tp): the **stage object itself is in cell 0** (+0x38 0x44a), so "object probe" includes the
map; the others are the gimmicks (vt 0x5914e8 etc, 0x47b ...), box triggers (section 8 shape 3, vt 0x58fd90 FUN_0057c530, +0x38 0x1db;
vt+0x17c FUN_00550da0 = FUN_0025e400 on the box) and e_Heri (record 31, 0x250, off in every state). Soldiers (0x387) have no bit 6.
FUN_00544f90 casts it S -> eye after the 5 rays and keeps it when strictly nearer S.

Results: test_camera_preprobes. **r03_spot2** (a walked state + teleport): page 1e-3 from the game's eye, look point and CAM+0x1c0 with camera type 0xd:
the reviewer's "same wall stop but not the same view" was the state's gun-out type (view 2), not yaw drift. The 30 cam traces and aim traces
never fire the pre-probes (0 of 5471 updates); w257_wall_look / w257_wall_aim at the spawn's back wall do not either, in the game or on the page
(look point 1.2e-3 / 5e-4; wall_aim's eye only compares after its draw settles, its log starts mid-draw, so it is not in test_aim_camera's list).
**w257_ladder_side** (TRACE_FIELDSET=cam, TRACE_LOG_AT=9F000 for its 1305 script frames; copy to out/cam/l_ladder_side.jsonl, replay `CAM_ONLY=l_ladder_side:open` in test_cam_traces):
on the ladder, full yaw sweeps looking down (pitch -0.94) and up (+0.87). Open loop, 492 frames: eye 1.6e-2 (f1100, CAM+0x1c0 at distance 37.7), look point 1.0e-3, yaw 1.7e-5, pitch 5e-7;
one frame-by-frame look: no frame above 0.05 u. The page's pre-probes moved 0 of 496 updates, and the game's look point agrees, so **no trace has yet caught them firing**: the firing
branches are checked by test_camera_preprobes's hand cases and the asm only. Eye and yaw are over test_cam_traces's open limits (1e-2, 1e-5), so it is not in the default list.
**Run-time checks:** DAT_0046b2fc = 2 and the stage object in grid cell 0 in all 58 route states. **Class 3 boxes (vt 0x591890):** FUN_00584408 is the vt+0x17c of all four gimmick classes; shape 0 half-sizes the type's +0x18 (y + fRam0046ef60 = 3 only with +0x110 set: none for class 3) and calls FUN_0025a8f0. r06_door2 is the case: 1.69 against RAM's 1.54 with them, 34.7 without. They move with a room node (FUN_005877e8): 'The doors' below.
(A first take had the stick already held at log_from: the game's yaw ramp was 11 steps in, the replay's 0, a constant 0.402 rad and 26 u of eye error. Trace artefact, not a page defect.)

## The doors (worker 0257, 2026-11-04)

✕ (FUN_00333150 -> FUN_00544200 -> vt+0x15c FUN_005516f0) on the trigger chosen by FUN_005513c8 (a ray of 7 along the facing, flags bit 3, +0x40 bit 2, not opening or closing; shape 3: the first face hit must be z) runs
script event 0x11 with r0 = the face. Script 149: flag 0 < 13, manager short 78 == 1 -> 0x101(self, 1 for face 4, 0 for face 5) -> next frame event 2 -> var 0 = that side, 0x168(15) -> manager type 10 -> vt+0x28c FUN_0057c728:
+0xe0 = 2, event 0x50 (cmds 0x51 .. 0x50: chunk 6, animation 6 or 8), code -5 after 15 -> vt+0x294 FUN_0057c7e8: +0xe0 = 1, +0x38 = 0, event 0x51. Closing: 0x169 -> FUN_0057c850, state 3, event 0x52, code -6 -> FUN_0057c920.

Animations: FUN_0026c198 writes the node's matrix (position x 10, y and z negated; degrees, y and z negated), time += 0.6 a frame, stopped when no curve runs. FUN_005877e8: the class 3 box = record +0x50 x the node, read at the object update, so 2 frames behind the time.
The room keeps a moved node's chains in the node's space, so the page used to draw these doors at the origin: now they go through the node (room.js createRoomNodes).

**T w257_door2** (w217_r06_door3's pad from r06_door2, TRACE_RAW; replays in test_doors): ✕ f426, state 2 f427, time 0.6 f427 .. 6.0 f436, box moves from f429, state 1 and +0x38 0 at f440, Vincent through by f445. All equal frame by frame; box worst 3e-4 u;
camera through the doorway f440 to f456 worst eye 1e-3 u. From about f458 the save box holds the game's camera base, 2.7 u behind this replay, which has no box: not a door matter, not checked on the page.
