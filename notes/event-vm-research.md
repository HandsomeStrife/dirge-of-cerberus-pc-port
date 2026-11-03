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

## Event actors (worker 0218, 2026-11-03)
Decoded and on the page (event_actor_rt.js natives + update, event_actors.js drawing, export_web_event_actors.py data).
- **Slots**: 64 x 0x200 at event +0x1800 (FUN_00376308 creates, FUN_0037a600 finds by id at +0x18). +0x1c MP; +0x20..+0x5c the
  actor matrix (rows; identity at creation); +0xa8 bits 48 loop / 49 visible / 52 clip (49 and 52 set at creation); +0xb0 request
  flags 0x82 / 0x86; +0xb4 start x 2 (-1 none); +0xbc blend frames; +0xc0 4 attached actors, +0x1e5 their markers; +0xdc speed.
- **load_l(name, id, f)** FUN_0039e2f0 -> FUN_00379c68 (command 9, or FUN_00380370 at once when resident). **loadmotion_l(id, n)**
  FUN_003a13a8 -> FUN_0037b368: command 0x12 -> FUN_00382220 loads FileCode FUN_00250898(n, event) = 0x0c000400 + event x 0x1000 + n.
  scr001: e027 <- 0x402 / 0x404 (and 0x4c6 for e063), e048 <- 0x405, p005 / p014 <- 0x422, n013 <- 0x401, g000 <- 0x41d, p000 <- 0x4fe.
- **ms -> frames** FUN_003787e8: (int)(ms x 0.06). **setmotion2_l(id, clip, blendMs, startMs, z)** FUN_0039f6d0 -> FUN_0037af40:
  +0xbc blend, +0xb4 = start x 2, bit 48 cleared, flags 0x86 if z else 0x82. **setmotion3_l(id, clip, blendMs, z)** -> FUN_00381268
  (does NOT touch +0xb4: a setmotion3 right after a setmotion2 inherits its start; scr001's end puts 41-43's battle clips at their
  last frame this way). **setmotion_l(id, clip, loop, blendMs, z)** -> FUN_003811d8 (ignored while the same name is pending).
- **Update FUN_003772c8** (FUN_00247428, after the MP draw FUN_005a8e28 in the main loop FUN_00248110): visibility (FUN_005a85f8),
  attachments (FUN_003771e0 -> FUN_005a7698: parent MP +1000 + 4i = child MP, +0x45e + i marker), the request FUN_005a91c8(MP, clip,
  blend, flags | loop) (a 0x80 request of the clip already on top is dropped; children get it with | 2), then FUN_005a90f8 ->
  FUN_005a8fd0: head frame = min(max(+0xb4, 0), 2n - 1) x 0.5; +0xdc -> MP+0x40c = speed x 0.5; FUN_005a6f40 copies the matrix.
  The MP advances frame += rate x 1.2 a frame (FUN_005aa2a8; T: 0.6 at rate 0.5); default rate 0.5 (T).
- **setpos** FUN_0037abf8 (row 3), **setrot** FUN_00259bd0: rotX x rotY x rotZ (row vectors; FUN_0026125c(out, A, B) = B x A),
  degrees x 0.017453292; **setdirrot(id, deg, add)**: add 0 -> deg + 180 wrapped, FUN_00259990 rotY (180 -> identity).
- **Attached draw** FUN_005ab8f0: child MP+0x50 = socket x parent world, socket = palette[marker bone] x T(marker) (FUN_005ad508 ->
  FUN_0030bef8); a hidden parent draws no child.
- **Lights**: KerberosLight -> struct 0x4fc7d0 +0x630 / +0x6a0 / +0x6d0; FUN_0040c988 commits to the fixed rig and sets DAT_004fcaf8
  bit 36; FUN_005ab0b0 then uses it for lights 0 / 1 + ambient; light 2 stays the room light (FUN_0026a710).
- **T**: w218_act_a (slots, MPs at 0x14d4700 + 0x480 k from 0210's start1704 state), w218_mp_a (MPs 1 / 3 / 5, records 580-799;
  `TRACE_FIELDSET=evactor TRACE_EVMP=...`), GS dumps w218_gs f650 / 800 / 900 (`TRACE_STATE=` in grab_gs.py). test_event_actors.mjs.
- **Open**: p000 (Vincent's own event actor, the last block) and his gun; hide_model_l / setanim_l (eye / face texture animation) /
  setshadow_l; blended requests; setLOD; the effect sequences on actors (the e063 visor glow is FEDEF HEAD02_ENEMY_HEAD, playseqstr_l).

## Event sound, Skip, the event pause, windows (worker 0222, 2026-11-03)
Natives (method +0x0c, class registry DAT_004ef498 in the w210 start1704 state). Code: native/web/event_sound.js,
event_rt.js (skip), intro.js (pause / skip), play.js (wiring, the Start / ✕ keys); tools/audio/voice.py; build steps
music (+ bgm_274) and voice.
- **Sound natives**: setVoiceBufferType 0x3a0ac8 (-> FUN_0037fc88: load waits, buffer sizes; no page effect),
  loadVoice2 0x3a0968 -> FUN_00378c88 (skip 0: command 0x11 with the 7-char name; skip != 0: 0x7fffffff), playVoice
  0x3a0900 -> FUN_003eaf10(pi / 4, name, 0) -> FUN_003ead30 -> FUN_003eacb8 (gains (short)(cos / sin x 4096) = 2896),
  setSoundEffect2_l 0x39ff68 (name, p1, p2, at, vol, release; skip 0 only: at 0 -> the active event camera's eye,
  slot bit 18 = 0x40000 (FUN_003e8a30), fixed volume (FUN_003e8b70); FUN_003e97f8 request; release -> FUN_003e8ff8),
  playMusic2 0x3a02b8 (skip 0 or FUN_003eb930 -> FUN_003ec500(name, 0); FUN_003ebb18 polls <= 1000 x 200 us for the
  stream), playMusic3 0x3a0198, playBgAreaSound_l 0x39dd80. **FUN_003eb930(name)** = the sdb row's +0xc & 0x84 == 0x84
  (bgm_001 0x94 yes, bgm_274 0x04 no: a skipped opening never starts bgm_274). Other KerberosSound / Window / Effect /
  Light natives' addresses: the table below.
- **Voices**: rows 10109vn / 10109v2 / 10110sk = streams (+0xc bit 1), FileCode 0x0c064502.. (disc
  data/event/scene/ev0100/sound/*.at2), +0x14 = length in ms (scr001 sleeps that long). FUN_003ed000 per 1024-sample
  frame of the 48 kHz music ring, for each of 6 channels: FUN_003eaf90 -> FUN_003eab20 decodes one 0x60-byte ATRAC3
  frame (libat3dec, mono, not scrambled; the frame at offset 0 is never returned) and FUN_003eb330 adds x gain >> 12
  to L and R (pmulth / psraw / paddsh), after the music's crossfade mix. So 48 kHz sample for sample, no resampling
  (the row lengths agree: 59 frames = 1.26 s for a 1292 ms row; 44.1 kHz would be 1.37 s). With no music stream the
  ring is zeroed and the voices still go out. The music's decoder offset (changeMusicVol) does not reach them.
- **Skip** FUN_00372f70: +0x156c = 1, bit 36, FUN_003e9950 (stream SEs), FUN_003ea5f0 -> FUN_003ea3d0 ->
  FUN_003ea2c0 x 6 (voice channels **freed**: a later playVoice plays nothing), FUN_003b7118 for each open window
  (+0x9804, 5 x 0xc); also FUN_00380ca0(0xb4), FUN_002420e0, FUN_002f47e0, FUN_002574a0, FUN_003e6fc8, event effects
  FUN_002ebdb8(.., 2) (not on the page, warned). Under skip: sleeps / timers end, moves jump (2), fades do nothing
  (FUN_003736c8: skip != 0 and not _noskip), SEs and voice loads are refused, window commands open closed
  (FUN_00383408: FUN_003b75b0 + FUN_003b7118). setSkipMode bits (+0x9860): bit 0 read by the actor update
  FUN_003772c8 and the motion load FUN_00382220; bit 1 by the window / voice commands (FUN_00381658, FUN_00381860,
  FUN_003837d0) under skip.
- **The event pause**: the pause object in its event state (+0x44 = 1, FUN_003bf550 on messages 9 / 0xb) with
  FUN_00376ee0(ev, 1, 1) (+0x1558 bit 39, +0x9854 = clock, voices FUN_003ea9f0, SEs FUN_003e86e0(1), effects
  FUN_002f24b0(1, 1, 1), BGM volume FUN_003ed7d0(0)). FUN_003c0520 state 1 draws widgets 0x23 / 0x22 pulsing
  (FUN_003d0a90(w, clock - 0x100, 0x200, 0x20, 0x80)) and on ✕ (FUN_003de918(0, 3)) with FUN_003e0d00() == 0 sets
  +0x48 = 1 and closes; FUN_003c0110 then calls FUN_003dfdc8 (skip + FUN_00376ee0(ev, 0, 1)); a close without ✕ ->
  FUN_003dfd90 (resume only). The layout holding widgets 0x22 / 0x23 is not exported (the draw is left out).
- **Windows (subtitles), decoded, not on the page**: open_l 0x39ec20 (pops: unused last int, the key -> FUN_003a6698
  in the event's message file, then h, w, y, x, kind, id) -> FUN_0037c3c8: command 10 {id +0x20, x +0x24, y +0x26,
  w +0x28, h +0x2a, kind +0x34, text +0x2c}; FUN_00377c68 case 10 -> FUN_00383408: FUN_003b66c0(DAT_00472a80, kind
  4, 0, 1, 0, -1) -> PTR_FUN_00472d68[4] = FUN_003b84a8 -> FUN_003b8598 (layout script **0x472c48**, text widget 0x14,
  widget 0x13; the 0x472d28 variant with a 300 ms start is param_7 != 0), FUN_003b6c10(x, y), FUN_003b6c98(w, h),
  FUN_003b6ab8(text) (a string, not an id); the id goes into +0x9804's 5 entries. close_l 0x39e6c0 -> FUN_00378b00
  (entry -> -1, the pending command freed by FUN_003789b8). scr001: kind 4 at (0, 380) size (512, 448), keys
  MES_10109VN1 / MES_10109VN2 / MES_10110SK. To do: export 0x472c48 (export_web_pause.py LAYOUTS), the kind-4 resize,
  the string text through pause.js type-9 text, the keys through 0220's message export, GS dumps at the windows.
- **Fade draw, partly**: FUN_003736c8 -> FUN_002f21d8 / FUN_002f21f8 -> FUN_002f4480 / FUN_002f4578: FUN_002f3f08
  spawns emitter table[a] + b of the FED in DAT_0050d310[DAT_0050d718] on the manager DAT_0050d710 (not one of the
  three managers on the page); FUN_002f2238(0x373690) -> FUN_002f4698. The FED file and its emitter's draw (an
  effects.js emitter) are the next step; the veil stays GUESS.

- **Native -> C table** (method +0x0c, start1704 registry):
  KerberosWindow: enableMenuSe 3a04b0, getstate_l 3a06b8, close_l 39e6c0, unload_l 39e4b8, resetstate_l 39e400, getvalue_l 3a0398, select_l 39e5e0, closeall 39e710, load_l 39e648, hide_l 39e450, isExist 3a0478, isBackToPreviousState 3a0680, move_l 39e508, open_l_str 39ed48, open_l 39ec20, addChatLog_l 3a05e0, addHelpMessage 3a0508.
  KerberosSound: enableDucking 39f9f8, enableSoundEffectEarCamera 39faa8, enableSoundControl 39fa40, loadVoice 3a07d8, loadMusic 3a0750, loadSoundEffect 3a0b90, loadSoundEffectBySituationId 3a0c68, loadOnlineQuestSoundEffect 3a0b38, loadWave 3a07a0, setReverb 3a0b08, playMusic 3a0378, setVoiceBufferType 3a0ac8, setBgSoundVolume 39deb8, setDatabaseZoneNum 39fa20, changeSoundEffectVol 39dd58, loadSoundEffectEx_l 3a0be8, changeMusicVol 3a5308, stopMusic 3a0148, stopBgAreaSound 39ddf0, flushSoundEffect 39dd10, isCrossfadeBusy 3a0168, setSoundEffectEarPos_l 39fb00, setSoundEffect_l 39fd60, setSoundEffect2_l 39ff68, playBgSound 39de38, playBgAreaSound_l 39dd80, playVoiceWithPanning 3a0808, playMusic3 3a0198, playVoice2 3a0880, isVoicePlaying 3a0a38, playVoice 3a0900, stopVoice 3a0aa0, playMusic2 3a02b8, waitVoiceFinish 3a09b8, unsetSoundEffect 39ff08, loadVoice2 3a0968.
  KerberosEffect: workaround_problem 3a1510, load 3a2580, loadPadVibData 3a1598, stop_l 3a28d8, unload 3a24c0, playEventEffect_l 3a2548, test 3a2978, isPlayingEventEffect 3a24f8, setFocusBlur 3a2090, fadeout 3a2420, fadein 3a22e0, shake 3a2140, cblur_out 3a1bf8, playActor 3a25d8, flash_out 3a1810, fadein_noskip 3a2380, setVisible_l 3a21c0, stop2_l 3a1638, changeTargetActor 3a15e8, cblur_off 3a1bb0, shake_off 3a2118, flash_off 3a17c8, reset_field 3a2890, stopfadeinout 3a2228, unloadPadVibData 3a1538, deleteBulletMark 3a2958, play_l 3a2640, enableloop_l 3a2038, setPadVibration 3a28e0, isfadeinout 3a2278, playseq_l 3a1f78, cblur_in 3a1a70, flash_in 3a1688, cblur_smooth 3a1ca0, flash_smooth 3a18b8, playseqstr_l 3a1ea8, playPadVibration 3a1560, strid2numid 3a1e58.
  KerberosLight: set_shadowalpha 3a5048, set_ambientcolor 3a50a8, set_directionvector_l 3a5248, set_directioncolor 3a5140, reset 3a5200.

## Event windows (subtitles), the event pause's screen, fade / title card findings (worker 0239, 2026-11-03)
Code: native/web/event_window.js (new), stage_info.js (`$h` in renderCodes, `speakerCode`, `MENU_CONFIG_BITS`),
play.js (`introMenuDraw`, the keydown's `pausePrompt`), exporters export_web_event.py (`messages`) and
export_web_pause.py (layouts `window4` / `eventpause`, images 0x10c / 0x35 / 0x36, `speakers`). Tool:
tools/trace/window_ref.py; script tools/trace/scripts/w239_sub.json; dumps / states in tools/trace/out/w239 (gitignored).
- **open_l**'s last int is not unused: FUN_0039ec20 pops it first (s6) and stores it as FUN_0037c3c8's 9th argument
  (sw s6, 0(sp) at 0x39ecf0) = command +0x38 = t. FUN_00383408: t != 0 -> FUN_003b66c0 param_6 -> FUN_003b72b8 ->
  FUN_003d50b8: the box opens over t ms. scr001 passes 0 (args id, 4, 0, 380, 512, 448, key, 0).
- **Box kind 4** (FUN_003b8598, param_7 0): layout 0x472c48 = root 0x13 (type 1, no image) + type-9 text 0x14 (flags
  0x212); FUN_003e1d80 drops the open sound; param_6 = (FUN_003e15c0() == 0); FUN_003e15c0 = DAT_004f3044 bit 11 (story
  mode) = 1 in the states -> flags & 0xfffd | 0x4000 (the 11-sprite outline; T: the dump's glyphs have 11 shadows + 1).
  FUN_003d0a70(0x13, 1): no clip while opening; FUN_003d4720 screen flag 0x200. vtable DAT_004a5550: +0x1c
  FUN_003b8850 (text flag 0x200 -> result 5), +0x34 FUN_003b88d8 (close 100 ms, silent).
- **Text**: FUN_003b6ab8 -> vt+0xd4 = FUN_003d03a0 with a string (not an id) -> FUN_003cf338. **'$h' + two letters**
  (FUN_003d1d98 code 8): FUN_003d1c08 looks the letters up in PTR_DAT_0047a8c8 (24 rows, kelstr ids 0x2800..0x2812,
  0x282d..0x2831; the speakers' names) -> length 4; no row -> length 2 (3 when the first letter is '$'), the letters are
  then text. FUN_003cd7e8 case 8 (and FUN_003cf338) draw the name when FUN_003e1550() (DAT_004f3044 bit 10), then return
  to the string with the line start moved to the x after the name (iStack_128 / iStack_104: a hanging indent); the
  measure's width adds half that start. DAT_004f3044 = 0xc00 (both bits) in w218 / w239 states; FUN_003e1770 sets them
  from the config, FUN_003dd810 / FUN_003e1668 by language.
- **The event pause's screen**: FUN_003bfe28(param 1) builds layout 0x4779c0 (root 0x21 0..512 x 0..448; 0x22 type 4
  image 0x10c at (236, 217); 0x23 type 4 image 0x35 at (224, 217); 0x24 type 3, nothing drawn), language override
  0x51fc60[2] = 0; FUN_003e2790() (DAT_0046b2fc = 2) -> 0x23 +0x1a (image) = 0x36; dim FUN_003d5c08(root, 2, 200, 0x60);
  bilinear ids 0x477c30. FUN_003c0520 state 1 pulses both with FUN_003d0ad0(+0x60, 0x200, 0x20, 0x80, now).
- **T** (GS dumps w239, grab_gs.py from 0210's start1704, TRACE_FIELDSET=event TRACE_LOG_AT=B4000; grabs at 596, 1400,
  1453; Start at f1420): VN2 264 / SK 108 glyph sprites and the pause's 3 draws equal the page's (test_event_vm). The
  old w218_gs dumps show no subtitle (their bottom font line at y 523 is an off-screen options help text).
- **Fade draw (stopped after two attempts)**: DAT_0050d310[DAT_0050d718 = 0] = 0x2df5f0, inside the ELF and not a
  FED v8 (no header; FUN_002f55d0 indexes +0x8 / +0xc / +0x18 tables); it runs on the manager DAT_0050d710 through
  FUN_002f3f50 (FUN_00306cd8, FUN_002f3c98, particle rows DAT_0050b500) and draws via FUN_002f2238 -> FUN_002f4698 ->
  FUN_002f4270. effects.js does not run this system; the black veil stays a GUESS. Next: FUN_002f4270 + the manager.
- **Title card**: scr001 calls displayStageInfo(0) at frame 1 and isDisplayStageInfo(0) once. Kind 0 -> box kind
  DAT_004a8250[0] = 0x1e, step table 0x47a028: [0, 0, -26, 16], effect slot 0 = FED 0x818c0000 (3000 ms), slot 2 =
  0x818c0400 (3000 ms), [500, 3000, -3, 0x27], [4000, 0, -2] end. Not on the page (FED effects, as 0220's boxes).
- Not started: the scope view (SCOPE01 sequences) and the actors' effect sequences.

## Texture animations (the faces' eyes / mouths), worker 0248 (2026-11-03)
Dan's report "the mouths are out of sync in the cutscene": the page drew no face animation at all (the faces held the
uploaded texture while the voices played). The game's mouths are not voice-synced data: they are texture flipbooks that
the script turns on and off around a line. Code: event_actor_rt.js (`texAnimSetup` / `texAnimMatch` / `texAnimKey` /
`texAnimAdvance`, native setanim_l, the draw snapshot `a.drawn.tex`), event_actors.js (`texAnimView`: a DataTexture per
target), export_web_event_actors.py `texanims` (MODEL_tad_S_D.png). Test: test_texanim.mjs.
- **Natives**: KerberosActor.startanim(name) / stopanim(name) (bytecode wrappers) -> setanim_l(id, name, 1 / 0) 0x39cfe0
  -> FUN_00376510 (slot by id) -> FUN_00381168: slot +0x10 = the name (8 bytes, FUN_00258590), +0xa8 bit 53 (start) or
  bit 54 (stop). The actor update FUN_003772c8 (after the visibility, before the attachments): bit 53 -> FUN_005aab10,
  else FUN_005aabf8 (the MP, the name), then both bits cleared. Those set / clear entry +1 of every animation whose name
  BEGINS with the given one (FUN_00414210 compares up to the query's length, at most 8).
- **Data**: the model container's `texanm` entry, type 'tad' (0x646174). Payload +8 count, +0xc offset table (from the
  payload): per animation +0 u8 source texture entry, +1 u8 target entry (indices of the texture container,
  FUN_00253370(.., MP+0x3d8) +0x14), +4 s16 x 2 target corner, +8 s16 x 2 size, +0xc u16 frames, +0xe s16 key count,
  +0x10 name, +0x18 / +0x1a s16 the random wait range, +0x20 keys (8 bytes: s16 source x, y, the frame the key runs to).
- **MP state** (FUN_005a8850 at set-up): MP+0x400 entries of 0x10 (+1 on, +2 frames, +4 frame f32, +8 wait f32, +0xc /
  +0xe the range), MP+0x404 count; on at set-up when the name starts '@'.
- **Per draw** (FUN_005abec0 -> FUN_005a9938, skipped for a hidden MP: +0x440 & 0xf00 == 0x200): the textures upload
  (FUN_00259058), then FUN_005aa9e8: each animation on with wait 0 -> FUN_00414290: key k (key[k-1].t <= (int)frame <
  key[k].t; key 0 again from the last key's end), skipped if the target entry's +0x22 mask has the MP's variant bit
  (+0x44b), -> FUN_00414568: a GS local -> local copy (BITBLTBUF source = the source entry's TBP / TBW, SPSM = DPSM =
  the source's PSM; TRXPOS (sx, sy) -> (dx, dy); TRXREG w x h; TRXDIR 2). Then FUN_005aa838: a wait runs down by
  DAT_004fc7e8 (1.2) first; else frame += 1.2 and at (int)frame >= frames: wait = min + (max - min) x FUN_0040b5c0()
  when max >= 1, frame = 0.
- The copy moves T8 indices, so the target's CLUT colours them: the exporter writes each source image decoded with the
  target's CLUT. z128's event models: g000 (00_ue / 00_sita / 00_naka: upper / lower / middle mouth, 20 frames, 4 keys,
  no wait; 01_eye 665 frames), e063 (@_eye, 275 frames), p000 (@_eye blink 19 frames, wait 128..512; eye_clo; ang).
  The opening: startanim("00") on g000 (slot 12) at its line, 10110sk's playVoice 19 frames later, the mouths run until
  stopanim("00") / the slot's finalize (page frames 947..1425). The eyes ("eye" on slot 5, "01_eye" on g000) too.
- **Not checked against a GS dump yet** (the copies' result in VRAM at a talking frame); the gameplay Vincent's own
  '@_eye' blink (his MP has the same tad) is not on the page either.

## The stage's events played: rv_matiawase, worker 0248 (2026-11-03)
Dan's report "the cutscene trigger on the stairs: Vincent stuck a moment, then at the bottom of the stairs": that was
the page's auto-skip (the GUESS stand-in) skipping rv_matiawase (main's beat after the start deck, stage flag 0 = 2) at
its first wait; the skipped event's setpos (-889.2, 0, -599) is the bottom of the stairs. Now it plays.
- rv_matiawase (class ev0101 = the opening's scr001 class): Zone.load(128, 2, 3); loads p005 (Vincent's event model,
  146 bones) and p000 (93 bones), motion files 13 / 123 (0x0c06440d: bv002..4vn, bv000vn0..2, km0201vn; 0x0c06447b:
  km0202vn), loadVincentWeapon twice (FUN_0039e060 -> FUN_00379af8: a slot with the weapon model FUN_004099b0(frame,
  barrel)), Camera.set + active, Zone.event, fadein 100, getbattleactor p_Vin (hidden), the lights, shot 1 p000
  km0201vn, loadVoice2 10201vn, shot 2 (camera setdata 4 keys, move 0 -> 190.98 at 0.032) p005 km0202vn, setTimer 6000,
  playVoice 10201vn + window MES_10201VN 2000 ms, fadeout 1000, getweaponframe -> bv000vn0..2 on p_Vin, displayStageInfo
  / exit branches, Camera.set + setfov 73.5, setmotionofbattle bv002..4vn, unloads, setbattlename p_Vin.
- getweaponframe (0x3a3330 -> FUN_00376618 -> FUN_00312478: DAT_0046dd68 +0x80, 0 -> 1) = 1 and getmorphstate (0x39d090 ->
  FUN_00321460: DAT_0046e248 +0xc) = 0 in the route state r02_climb.
- Page: stage_controller.js takes opts.actors / sound / windows (as intro.js gives the opening) and runs the event SE
  send, the windows and the fade level in its frame (as event_rt.js); stage_view.js draws the stage's event camera,
  fade veil and actors (event_actors.js); play.js wires it (startStage, the frame loop, the render camera, the window
  draw in the HUD chain). The stage data has the messages now (export_web_stage.py). Auto-skip: opts.autoSkip
  'unplayed' (play.js default) skips only waits inside events not in PLAYS (= rv_matiawase only); ?autoskip=1 every
  event, ?autoskip=0 none.
- T: w248_rv_a / b (TRACE_FIELDSET=event): game camera 1 at f896 (Zone.event f897), camera 2 at f959, fade particle at
  f1219, the last camera (fov 73.5) at f1269, asj_033 f1468, scene_save f1476. Page: the same order and values (shot 2
  within 0.003 u); its blocks are shorter by the load waits (voice load, e030 / SE loads at once on the page). GS dump
  w248_gs f1100: no HUD -> set_usercontrol's FUN_003b01b0(HUD, b) is now on the page (hud.js control).
- Left out (warned): p_Vin's own clips bv000vn0 / bv002vn at the end (the gameplay body's MP; the page's Vincent is
  not an MP), the weapon on p_Vin's marker 15, focus blur, shadows, loadSoundEffectEx, setdirofbattle,
  unload_residentmotion, p000 / p005's cloth (an event actor of the enemies' pipeline has no cape cloth).
