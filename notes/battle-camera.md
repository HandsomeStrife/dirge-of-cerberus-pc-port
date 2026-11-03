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

Still left out: FUN_00544f90's second cast, FUN_005449f0 (objects in the manager grid +0x1170 with probe bit 6 in
+0x38, each with its own vt+0x17c; probes 1-2 subtract the object's +0x2c).

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
- FUN_005449f0's object casts.
