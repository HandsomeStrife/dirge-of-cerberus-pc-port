# Death camera (worker 0199, 2026-11-02)

When Vincent dies the follow camera pulls up and looks down at him. On the page: player.js
`FollowCamera.startDeath` / `clearDeath` / `low` / `d0`, `PlayerController.setStance`; play.js runs
`gameOver.frame` before `follow.tick` and starts the death camera on its 'deathCamera' event.
Test: `node --import ./native/web/test_hooks.mjs native/web/test_death_camera.mjs`.

## Chain (addresses)
1. **FUN_00334590** case 2 (world-mode object, the first frame he is seen dead): FUN_0032a420(CAM, 1, 0, 0)
   (view mode 1; same view + params 0 returns at once) and **FUN_00328720**(CAM): CAM+0x1e8 |= 0x400000,
   FUN_00328790(CAM, 1): CAM+0x230 = 1, CAM+0x234 = DAT_0046e880+0x20 (a world clock). It runs before the
   camera update in the same frame (traced: kill f788, flag and the first pitch step in record f790).
2. **FUN_0032ace0** with 0x400000 (and not FUN_00324258(10) / FUN_00326068(0xb)):
   - l.573: the left stick (fStack_1d0 / 1cc) = 0, so fVar31 = 0 (nudge, distance ease, FUN_0032a1d8).
   - the look stick is read (FUN_003256d8: the mouse latch still updates) then replaced: not LAB_0032b950
     (no ramp CAM+0x1ec, no deadzone bit 10). l.747: P+0x28 bit 0x20 (clear for Vincent, 0x20901f) can end the
     mode (0x800000). l.758: P+0x104 == 0x16 keeps the read look stick. Else, with 0x200000 clear: look =
     **(0, -0.3)** (l.810-811). With 0x200000 (event cameras) the CAM+0x230 phases 1-3 run (l.849): not used
     by the death camera.
   - caseD_0 -> l.1144: pitch < -0.9424779 -> CAM+0x1ac pull. Unreachable: the pitch is clamped to
     DAT_0046e3fc x 0.017453294, with DAT_0046e3fc = -54.0 (degrees; 0xc2580000 in the ELF), which gives the same f32
     as the literal (0xbf71463b). CAM+0x1ac stays 0 (traced).
   - l.1161: no auto turn-behind; the nudge needs a zero look, so it is off too. The pitch falls
     0.3 x 0.05 x 1.2 = 0.018 rad a frame to -54 deg (about 14 + 50 frames from +0.21: clamp at f853); yaw holds.
3. **The look point drops 4.6**: state 7's enter FUN_005386f0 -> FUN_00565bd0(P, 2) (P+0x100 bits 40-41 = 2),
   whose tail calls vt+0x34c = **FUN_00573608** (Vincent's vtable 0x58f128): stance 1 / 2 -> CAM+0x1e8 |= 2
   (unless FUN_00326500() and FUN_00317630(status) == 2; 0 here). FUN_0032ace0 l.1733: with bit 2 (or C+0x45c
   bit 17) CAM+0xe0 = the type's +0x40 (0xc: (0, 4.6, 0); 0xd: 4.05; 0xe: 6), else 0; CAM+0xd0 eases to it by
   DAT_0046e4bc (0.15) x step (FUN_002611f4). CAM+0xd0 is added to the pivot for the look-at (l.1806) and the
   distance reference (l.2264) only (not the near-eye test, the P+8 path or the ray start). The same bit is the
   crouch camera (FUN_00576110 state 0x12; cleared by FUN_00574d30).
4. Off again (review fix): two writers. **FUN_00328750** (CAM+0x1e8 &= 0xff3fffff: 0x400000 and 0x800000;
   FUN_00328790(CAM, 0): +0x230 = 0, +0x234 = the world clock) from FUN_00334590 case 1 (the world-mode start, l.43),
   case 4 (l.139) and the case 6 / 8 tail (l.242); it leaves bit 2 and CAM+0xd0 (those ease back only when the stance
   clears the bit). And the camera init **FUN_00328368** (CAM+0x1e8 = 0x2004, +0x230 / +0x234 / +0xd0 = 0; from the
   constructor FUN_00328010, made by the object factory FUN_003387f8 kind 0xe, and the camera vtable slot
   FUN_0032a940 at 0x4a0854). The mode is still on at the menu (traced to f1247).
   **The Restart's reload runs both**: worker 0201's reload state (f3984 of its w201 drive) has a new camera object
   (CAM 0x9491a0; it was 0x95efe0) with CAM+0x1e8 = 0x2c, CAM+0xd0 = 0, +0x230 = 0 and +0x234 = 10, a world clock that
   only FUN_00328790 writes after FUN_00328368 zeroed it: so FUN_00328368 (new object), then the new world-mode
   object's case 1 FUN_00328750. On the page: `clearDeath()` = those two (`endDeath()` = FUN_00328750).

## Traces (game-derived, gitignored: tools/trace/out/w199)
- scripts tools/trace/scripts/w199_deathcam.json (the w192 route, to f1247) and w199_deathcam_look.json (right
  stick f800-875, left stick f850-870), `TRACE_FIELDSET=cam TRACE_POKE=960660=1 TRACE_LOG_AT=A5000`; the cam
  set gained cam_230, p_hp, wmode (fields.py). trace.py needs `--scratch` = the pcsx2trace unit's scratch dir.
- The sticks change nothing (only CAM+0x1e8 0x20000, the raw-look bit, which the page does not keep).

## Page vs game
Closed loop (the page's controller + gameover.js + FollowCamera from the game's camera after f788), every
record f790-f1247: eye <= 3.3e-3 (f928; the death slide's own 0.0027), look-at <= 3.2e-3, yaw 0, pitch
<= 1.7e-6, flags 0x400000 / 2, CAM+0x230 and CAM+0xd0 (<= 2.5e-6) exact. Image: worker 0199 scratchpad
deathcam_compare.png.

## Restart (for worker 0201)
Call `follow.clearDeath()` then `follow.reset(ctrl.pos)` when Restart puts Vincent back (checkpoint.js does; play.js's
H does the same). Decoded from the reload state (section 4). The rest of FUN_00328368 (angles, FOV, ...) is not in
clearDeath: reset() / the checkpoint's angles cover the camera's start.
