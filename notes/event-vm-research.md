# The event VM and z128's opening event (worker 0210, 2026-11-02)

Goal: the page starts z128 with its opening event (ev0100 class scr001), as the game does, then hands Vincent and
soldiers 41-43 to play (worker 0205's hand-off, checkpoint.js).

## The VM (decoded)
- Event scripts are Java class files (major 0x2e) run by the game's own JVM subset. Dispatcher **FUN_003ad288**:
  one instruction through the handler table at 0x470b80 (8 bytes per opcode: s16 context offset, u16 flag, handler).
  Long ops -> stub 0x3aa048, double ops -> stub 0x3aa050 (the scripts use neither).
- **FUN_003a99f0** calls a bytecode method: depth +0xf018, locals = Code attribute +4 (max locals) 8-byte slots below
  +0xf010, arguments copied from the operand stack (+0xf014, grows down) (+1 for `this` unless static), runs
  FUN_003ad288 until the pc leaves the code, then pops the frame (C recursion: one C frame per Java frame).
- invokestatic / invokevirtual / invokespecial: **FUN_003aa7b8 / FUN_003aa998 / FUN_003aa8b0**. Resolution
  **FUN_003a6bb8**: the class by name in the 32-slot registry DAT_004ef498 (0x38 per slot; **FUN_003a6928**, name hash
  **FUN_003a8828**), the method by name + descriptor (**FUN_003a88b8**, a binary search on (hash(desc) << 16 |
  hash(name)) at method +0x10). Method **+0x0c != 0 -> a native C function**, called with the VM (it pops its own
  arguments: FUN_003a9f48 int / FUN_003a9e80 float, pushes with FUN_003a9ec8). A missing method (java/lang/Object's
  <init>: no such class is loaded) prints an error and goes on (FUN_003a9c58).
- **The native binding** (worker 0205's open question): the `fake/*` classes are an **event library of 15 encrypted
  class images compiled into the ELF** at 0x383f20 .. 0x39bfa0 (each image's byte length sits 0x10 before its "TTTT";
  FUN_003ff0c0 passes DAT_00383f10 for the first), loaded at boot by the same loader FUN_003a7700: KerberosGlobalMap,
  KerberosEvent, KerberosActor, KerberosZone, KerberosCamera, KerberosWindow, KerberosSound, KerberosEffect,
  KerberosNetLobby, KerberosLight, KerberosIntermission, base/KerberosVector, base/KerberosMatrix,
  base/KerberosSequence, base/KerberosMath. Most of their methods are bytecode wrappers (e.g. Camera.setdata walks its
  arrays and calls adddata_l per key); the `*_l` and a few others are native (access 0x10a / 0x109), with the C
  function at method +0x0c (read from the registry in RAM, state w201 reload0: e.g. KerberosEvent.wait 0x39c450,
  sleep 0x3a0e48, setTimer 0x3a4698, KerberosCamera.adddata_l 0x3a3008, move_l 0x39c978, active_l 0x39cac8).
  Names are not stored as strings in the ELF outside the encrypted images (hence the earlier failed string search).
- scr001's class name is **ev0101** (registry slot 1 in the reload state); ev0100's scr000 is the class "ev0100".
- monitorenter / monitorexit (**FUN_003aa3c8 / FUN_003aa470**) lock / unlock the event mutex +0x474 that the main
  loop also takes: a synchronized block's commands land in one frame.

## Threads, wait, frames (decoded)
- The VM runs on its own EE thread. Natives lock +0x3d4 (FUN_00376158) and unlock + RotateThreadReadyQueue
  (FUN_003761a8). The main thread's per-frame event update **FUN_00377c68** opens the window (FUN_003761a8(ev, 1),
  unlock +0x474 / relock, FUN_00376158(ev, 1)): the VM thread runs until it blocks again. Then **FUN_003798a0**
  (clock), the 32 command slots (+0x520, 0x80 each, mask +0x514), and the camera output **FUN_00379148**.
- **Clock** = +0x9848 - +0x9858, milliseconds: FUN_0023c1f0 = EE timer count / 0x24000 (147.456 MHz / 147456 = 1 ms)
  x DAT_0046b08c (1.0); FUN_003798a0 adds the delta (shifted by +0x9850 = 0) once a frame; paused time goes to
  +0x9858 (FUN_00379908, FUN_00377c68's tail). FUN_00373098 starts it at the absolute ms (only differences matter).
- **wait(h)** (FUN_0039c450 -> FUN_00379d48): loop while a live slot has +0xc == h (FUN_00380a90), yielding.
  **sleep(n)** (FUN_003a0e48): loop while clock - start < n (n = 0 loops until abort), FUN_00249088(200) between.
  **setTimer(n)** (FUN_003a4698 -> FUN_0037db48): command 0x1c with deadline clock + max(n, 0); FUN_00377c68 case 0x1c
  frees it when clock >= deadline. Handles = ++(+0x1520) (FUN_00376040, wraps at 0x7ffffffe to 1).
- Skip (+0x156c: 1 -> 2 in FUN_00377c68; with 2 moves jump to their end, timers end at once): not on the page (✕
  doesn't skip). setSkipMode (FUN_0039ea68) waits for load commands (types 2, 9, 0x12, 0x1a, 0x1b; DAT_004a3458).

## Event cameras (decoded)
- 6 slots of 0x90 at event +0x30: +0x30 eye, +0x40 aim, +0x50 up point (eye + up), +0x60 fov, +0x64 active,
  +0x65 flag, +0x74.. 9 spline pointers + +0x98 the fov spline, +0x9c key buffer, +0xa0 / +0xa4 key time max / min,
  +0xa8 key count. init_l (FUN_0039cde8 -> FUN_0037cae0): cleared, fov 65.0, +0xb4 12.0. KerberosCamera's <init> gives
  ids camera_id_idx % 6.
- setdata -> adddata_start_l (FUN_003a3100 -> FUN_003745b8: frees the old keys / splines, drops the camera's move
  commands), adddata_l per key (FUN_003a3008 -> **FUN_00374418**: t; eye; aim; eye + up; fov), adddata_end_l
  (FUN_003a2a80 -> **FUN_00374278**: 10 splines, FUN_002616f0 each).
- Spline **FUN_002616f0**: tangents dt / dv by central differences (ends one-sided; 2 keys: the one difference; 1 key:
  1 / 0). Evaluate **FUN_00261a90**: clamp outside the keys, binary search, a segment with |dv| <= DAT_0046be00 (0.5,
  read from the ELF) linear, else cubic Hermite with slopes (dv / dt) x |h|.
- move(from, to, rate) -> move_l (FUN_0039c978 -> **FUN_0037a440**): command 7 with the start clock; each frame
  **FUN_003779d0**: t = from + rate x (clock - start), clamped to [min, max] key time, FUN_00374a08(t, param 8 = 1)
  writes eye / aim / up point / fov; done when t >= to. Rates in scr001 are about 0.03 key units per ms.
- active(I) -> active_l (FUN_0039cac8 -> **FUN_0037c7b0**): this camera +0x64 = 1, all others 0; +0x65 = 0
  (active_l2: 1). set_l (FUN_0037a4d0): eye / aim / up point. setfov_l (FUN_003a2a30): +0x60.
- Output **FUN_00379148** (no bound actor): the first active camera: sceVu0CameraMatrix(eye, aim - eye, -(up point -
  eye) normalised) (FUN_00445040); fov -> render camera +0x40 -> **FUN_003edce0**: screen distance = 448 / 2 /
  tan(fov x 0.008726647) (DAT_004fcab8 = 448), the same projection as gameplay's 73.5.

## Fades (decoded in part)
- fadein / fadeout (FUN_003a22e0 / FUN_003a2420 -> FUN_003736c8): FUN_002f4480 (in) / FUN_002f4578 (out) spawn
  emitter (2 | 4) + b (tables 0x46d520 / 0x46d528) of the current system FED (FUN_002f3f08 -> FUN_002f3f50) and set its
  particle's +0x4c (level: in 256, out 0) and +0x6c (rate -/+ 256 / (seconds x 60); seconds <= 0: jump to the end).
- **Not decoded:** the particle's integration of +0x4c / +0x6c and the emitter's draw (colour, blend). Page: a black
  layer with opacity level / 256, level moved by rate x 1.2 a frame (GUESS rows).

## Not on the page (warned once each; left out)
Actors (load / loadchr / setpos / setrot / setmotion* / attach / setVisible / ...: the event's own models and clips:
p005, e027, g013, e048, e063, n013, g000, p014, p000, e056 / e057, w003 / w004), lights, focus blur, effect sequences
(playseq / setVisible / stop), windows (subtitles, open_l / close_l), voices, music (playMusic2 bgm_274 /
playMusic3), sound effects, the stage title card (displayStageInfo), Camera.load_l (camera files; not used by a
shown block). Loads complete at once on the page (the game waits for the disc).

## Checked against the game (T)
- States: scratch w210 restart drive (w201's death route + Restart, ✕ only to f1824, then no input; state saved at
  f1704, mid stage load, before the event). The reload after Restart plays ev0100 scr001; the stage loop starts at
  f3971. Traces w210_intro_a / b / c (`TRACE_FIELDSET=event TRACE_LOG_AT=B4000`, records 0-2399 from that state;
  fields.py: the event set skips the player bases, which don't exist mid-load).
- Event clock: 20 ms in 1971 of 2399 frames, 40 in 97 (dropped frames: the game's clock is real time), 19 / 21 jitter.
- Cameras: the game's 9 camera blocks = the page's 9, in order (ids differ: KerberosCamera's static id counter runs on
  from earlier events; 4 / 5 / 0 in the game, 1 / 2 / 3 on the page). Evaluated at the game's own clock with a fitted
  start (within ±40 ms): 1629 frames, max eye / aim error 0.014 u, fov 0.0000 (test_event_vm).
- Block starts: game record 353 / 373 / 376 / 385 / 419 / 428 / 524 / 539 / 559 frames after the page's: the page's
  loads take no time and the title card is left out (the game's first block starts 353 frames into the load).
- Record order (decoded): the hook logs at the pad read (FUN_002548d8 in FUN_00248110), before the event update, so
  record r holds frame r's window clock and the camera frame r - 1 left; a block's move starts at the clock of the record
  before its first. With that, no fitting: 8 of 9 blocks within 0.0006 u; block 2 is off by one frame from record 800
  on (a slow frame shifts the read against the update), matched at the next record's clock (51 records).
- Not checked: the fade levels (the particle pointer DAT_0050b504 is logged, its fields are not), GS dumps.
