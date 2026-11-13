# Frame rate: 50 Hz PAL vs 60 Hz (worker 0293, 2026-11-12)

Research only, no code changed. Question: can the native port run at 60 fps and stay faithful?

**Answer: yes. The game's own engine has a 60 Hz mode.** The SLES ELF holds both video modes. It
picks PAL from its own file name at boot, and every gameplay system takes a time step in
1/60 s ticks. A 60 fps port is the game's NTSC branch (mode 1): **1.0 tick per frame instead
of 1.2**. That branch is decoded code in this ELF, not invented behaviour. No interpolation is
needed for 60 fps.

Confidence: **D** = decoded from code, **T** = confirmed in PCSX2 / save-state RAM, **L** = likely.

## 1. Video mode: chosen once at boot, from the ELF name (no menu)

| item | value | where | conf |
|---|---|---|---|
| region scan | FUN_00248528 (start-up, argv) calls FUN_00242650(argv[0]). The scan looks for `S?ES` (e.g. `SLES`); a match calls FUN_00242490(2) and sets **script flag 0x1e** (DAT_004b8980 bit 30, FUN_00241378(0x1e,1)). `S?US` gives FUN_00242490(1) and leaves the flag clear. | FUN_00242650 | D |
| mode pick | FUN_00244c38 (called once from boot FUN_00244db0): flag 0x1e set -> FUN_0040c078(0x4fc7d0, **2**), else (0x4fc7d0, **1**) | FUN_00244c38 | D |
| mode 1 (NTSC) | sceGsResetGraph-style FUN_00440468(0,1,**2**,0) = GS CRT NTSC; framebuffer 0x200 x **0x1c0** (512 x 448) | FUN_0040c078 | D |
| mode 2 (PAL) | FUN_00440468(0,1,**3**,0) = GS CRT PAL; framebuffer 0x1c0 x **0x200** (448 x 512; struct +0x2e8 / +0x2ec) | FUN_0040c078 | D, T |
| mode stored | `0x4fc7d0 + 0x2dc` | FUN_0040c078 | D, T (save state: 2) |
| other callers | FUN_0040c078 has no other caller (jal scan of the ELF); flag 0x1e is never cleared (the only FUN_00241378(0x1e, ..) is the boot scan). There is **no 50/60 Hz menu or prompt**. The ELF has no "50Hz"/"60Hz"/"NTSC" strings; the only "PAL" string (0x499190) is a 3-byte suffix in the save-data ID (FUN_00250368). | ELF scan | D |

So on a real PS2 this disc always runs PAL 50 Hz. The 60 Hz branch is the code the NTSC
release runs; in this ELF it is reachable only under a non-`SES` file name. (The NTSC disc
itself was not checked: we have only the SLES.)

## 2. Timing: a variable step in 1/60 s ticks

The main loop is FUN_004012c0 (stage program, case 9) -> FUN_00322f88(DAT_0046e290, 0) ->
FUN_00323128 (the frame's game logic). FUN_003245e8 also calls FUN_00322f88(.., 1) on two paths.

| item | value | where | conf |
|---|---|---|---|
| vblank count | INTC vblank handler FUN_002431a8: `DAT_004fcaa4++` (= 0x4fc7d0 + 0x2d4) | FUN_002431a8 | D |
| frame pacing | the loop blocks in WaitSema on the vblank semaphore (DAT_004b8ad0[0], FUN_00241ad0(0,1) from the flip); no VSync() syscall | FUN_0040ce28, FUN_00241ad0 | D |
| step at flip | `0x4fc7d0+0x18` (= **DAT_004fc7e8**) = vblanks since the last flip x scale (+0x20); the count is then zeroed. Flag bit 32 of +0x328 skips the multiply (step = scale). | FUN_0040ce28 | D |
| scale | FUN_0040cb78(base): scale = base x **1.1999999 if mode == 2**, else base. Boot passes base 1.0 (f21 = 0x3f800000 at 0x40c5a0, call at 0x40c7ac). FUN_00242c70(base) can reset it (stores base in DAT_0046b32c); no jal or pointer to it was found. | FUN_0040cb78, FUN_0040c078 | D, T (save state: scale 1.1999999, DAT_0046b32c 1.0) |
| logic step | FUN_00322f88: step = DAT_004fc7e8 (0 while paused, DAT_004fc7e4 == 1), **capped at 5.0**; `DAT_004eeb24` = step, `DAT_004eeb28` = step x 0.016666668 s; `DAT_0046e290+4` / `+0xc` hold the same | FUN_00322f88 | D |
| trace evidence | 222 PAL traces, 65,305 frames: step 1.2 in 63,403, 0.0 (paused) in 1,891, **2.4 in 6** (a dropped vblank), **5.0 in 5** (cap, after loads) | tools/trace/out/*.jsonl | T |
| users | DAT_004eeb24 is read in 80 decomp files, DAT_004eeb28 in 13, DAT_004fc7e8 in 15 | grep | D |

**What scales with the step (runs at the same real-time speed at 50 or 60 Hz):**
velocities are per tick or per second and scaled by step / dt (ground speed C+0x1d8 =
distance x 60 / step, FUN_0034c388; jump speed x 1/60, FUN_00575768); clip playback
`frame += rate x weight/128 x DAT_004fc7e8` (FUN_005aa2a8); airborne physics **sub-steps**
the step into slices of at most 1 tick (FUN_003543b8: `while step > 0.01: s = step < 0.99 ? step : 1.0`),
so gravity 0.07 u/tick² gives the same arc at any step; camera / aim blends use
`1 - (1 - r)^n` per whole tick (player.js note at FUN_00322f88's users).

**What is counted per drawn frame (runs 20% faster in real time at 60 Hz, as on an NTSC PS2):**
- Cape cloth: one cloth step per drawn frame (FUN_005ab8f0 -> FUN_005b2ef8), and the settle
  window counts down 1 per frame (FUN_005aa5b8, `MP+0x449 -= 1`; h_wk 60, h_rn 28, turn 100 frames).
- The pad is read once per frame (FUN_00257de0); edge-triggered input is per frame.
- Pointer (cursor/mouse) delta: FUN_00256b08 / FUN_00256b60 return delta x sensitivity x
  DAT_004fc7e8 x **DAT_0046baac**, and DAT_0046baac = **1.2 in PAL, 1.0 in NTSC** (FUN_00254490).
- Not surveyed: other integer frame counters in effects, AI and events. Most of the code reads
  the step, but a full list of per-frame counters was not made.

**Audio is independent of the video rate.** The IOP sound driver runs on its own 240 Hz timer
(notes/audio-research.md, FUN_00000dfc / FUN_00007224). Music tempo and SE timing don't change.

### PCSX2 check (T): the NTSC scale on the real engine

Method: a copy of the sea-of-flames save state with `0x4fc7d0+0x20` (scale) set from
1.1999999 to **1.0**, which is FUN_0040cb78's mode-1 result. Then trace c_run (full stick
from frame 10 to 160) on both states (`flock .pcsx2.lock`; outputs in the worker's scratchpad,
not kept). PCSX2 still shows 50 vblanks/s, so the patched run is the NTSC game's per-frame
logic at 5/6 speed.

| | PAL (scale 1.2) | patched (scale 1.0) |
|---|---|---|
| step / dt per record | 1.2 / 0.02 | 1.0 / 0.016667 (record 0 holds the state's old 1.2) |
| run distance per frame (f22-34) | 1.2002 | 1.0002 (ratio 0.8334 = 1/1.2) |
| ground speed C+0x1d8 | 60.0 u/s | 60.0 u/s |
| stop after release | frame 162 | frame 161 |

The PAL rerun matches the stored out/c_run.jsonl bit for bit (all 230 frames, all 38 shared fields).

At 60 frames/s the patched logic gives 60 u/s, the same real speed as PAL. The engine needs
nothing else to run at step 1.0.

## 3. What else differs in mode 1 (all uses of flag 0x1e)

Flag 0x1e is tested in 33 functions. Read here:

| kind | functions | difference |
|---|---|---|
| **timing** | FUN_0040cb78 | step scale 1.2 vs 1.0 (above) |
| **input** | FUN_00254490 -> FUN_00256b08 / 60 | pointer factor DAT_0046baac 1.2 vs 1.0 |
| framebuffer | FUN_0040c078, FUN_0033bc70, FUN_00243b20 | 448x512 vs 512x448; boot / loading screen layout |
| projection / aim | FUN_0032ace0 | aspect constants DAT_0046e370..37c (PAL) vs DAT_0046e360..36c (NTSC): 0.875 / 1.0 / 0.00223 / 0.00195 swapped. Same picture, different line count. |
| HUD / 2D layout | FUN_0033c868 (x 1.1428572 + 11, y x 0.875), FUN_00328968 / FUN_0055bda8 (on-screen cull rects), FUN_003c58b8, FUN_003c6d70, FUN_003d75a0, FUN_003dcf58, FUN_00aa2418 (FUN_003d3830(1)), FUN_003d2600 (DAT_004f2258) | screen-space positions for 512 lines |
| effects framebuffer | FUN_002ef958 -> DAT_0050b4f0 (FUN_00286570 etc.: 0x1c0 / 0x200, 0xe0 / 0x100) | effect render target size |
| save data | FUN_00250368 | "PAL" in the save ID |

The rest (003b8af8, 003c6f98, 003cc0a8, 003d28c8, 003d58b8, 003e1250, 003e1770, 003e1978,
00568148, ...) were not read. A scan of the lines after each test found no step / 1.2 / 50 / 60
constant in them (L: layout only).

**So a faithful 60 fps = mode 1 timing:** STEP 1.0 (not 1.1999999), DT 0.016666668, the
pointer factor 1.0, one game frame per 1/60 s. Per-frame counters stay per frame. The display
branches only adapt the 2D layout to 448 vs 512 lines. The port draws at full HD and maps the
game's screen space itself, so it can keep the PAL layout (already decoded and on the page) or
switch to the NTSC branch. Neither changes gameplay. Keeping PAL layout with NTSC timing is a
mix the real game never ran; it should be stated as such, but it affects only HUD placement.

## 4. Options and their cost

**A. Mode-1 timing (recommended).** One `video mode` setting (PAL 2 / NTSC 1), as
`0x4fc7d0+0x2dc`, feeding FUN_0040cb78's scale and DAT_0046baac:
- Fixed loop at 1/60 s, STEP = f32(1.0), DT = f32(1.0 x 0.016666668). The game runs at the
  same real speed. Cape cloth, the settle window and pad edges run 60x/s, which is exactly
  what the NTSC game does.
- Cost: the 1.2 constant is copied in about 13 page files (player.js TICK/STEP/DT/CSTEP,
  jump_core, aim_core, event_actor_rt, checkpoint, props, path_mover MOVE_DT 0.02, pcm_ring
  FRAME_S, intro, music, boss_io, enemy_ai, play.js). Each must read one source. In the native
  C plan this is one `g_step` set at boot (D8 change).
- Faithfulness checks: the PAL traces stay the parity oracle (mode 2 is the default for tests).
  For mode 1, record **NTSC-timing traces** with the patched-scale save state above (or a state
  patched before boot: flag 0x1e clear). Each record is then the NTSC game's frame. Page tests
  can run in both modes against the matching traces.
- Known gap: the mode-1 path was never seen running at a real 60 Hz vblank on this disc. Only
  the step was patched. Anything that reads the CRT mode outside the 33 flag users (e.g. GS
  register setup, FMV playback rate) was not checked. **FMVs**: PAL movies may be encoded at
  25 fps; not checked, and they play at their own rate either way.
- The page's 60 Hz action accumulator (fidelity-audit row "Actions timed by a 60 Hz
  accumulator") becomes exactly one action tick per frame in mode 1.

**B. 60 Hz ticks with PAL constants (step 1.2 at 60 frames/s).** Everything that reads the
step runs **20% fast**: 72 u/s runs, faster clips and timers. Not faithful; reject.

**C. 50 Hz ticks + display interpolation (the current D8 plan, as an option).** Not needed for
60 fps now that A exists. It is only useful above 60 Hz (120/144 Hz screens) or to keep PAL
logic on a 60 Hz screen. Cost if wanted later, as an option that is off by default:
- Keep two snapshots (previous / current tick) and draw at alpha = acc / TICK, one tick late
  (+20 ms input latency at 50 Hz).
- State to interpolate: every object's world transform (position lerp, rotation slerp from the
  matrix); the camera (eye, target, FOV; cuts must snap, i.e. the event camera's cut flag and
  warps); skinning (lerp the bone palettes or the final bone matrices, per character); the cape
  (cloth vertices; snap on window re-arm); particles / tracers / effect quads (positions; spawns
  and deaths must not lerp from the origin); UV scroll and texture animation (step or lerp);
  the HUD (2D values usually snap).
- Every new subsystem would need its own snapshot rule. That is invented behaviour on the
  game's frames, and it has to snap correctly on teleports, restarts, checkpoint loads and
  event cuts. Large cost, and visible errors when a snap is missing.
- Above 60 Hz the game's own variable step (D: the step is vblanks x scale, min 1 vblank) does not
  go below 1.0 tick. Running step 0.5 at 120 Hz would break the per-frame counters (cloth 120x/s).
  So past 60 Hz, interpolation over mode-1 ticks is the only option.

## Recommendation

1. Change D8: the port gets a **video-mode setting with mode 1 (60 Hz, step 1.0) on by default**,
   since Dan asked for 60 fps. Mode 2 (PAL, 50 Hz, step 1.2) stays available and is the
   mode the parity tests use. Both are the game's own code paths (FUN_0040cb78, FUN_00254490).
2. Gather the 1.2 / 1/50 constants into one source before or during native step 1.
3. Record a small set of NTSC-timing traces (patched scale) to check mode 1 on the page:
   c_run, a jump (sub-steps 1.0 vs 1.0+0.2), the cape settle window.
4. Leave interpolation out. Revisit only for >60 Hz screens, as an option that is off by default.

## 5. Implemented on the page (worker 0295, 2026-11-13)

**`native/web/video_mode.js`** holds the mode and everything it sets; every page file reads it (no 1.2 / 1/50 copies
left in game logic). `play.html?video=pal|ntsc`; **default NTSC** on the page (Dan: 60 fps), **default PAL in node**
(the node tests are the PAL parity bench; `DIRGE_VIDEO=ntsc` for NTSC). All page tests now load `?video=pal`.

| setting | PAL (mode 2) | NTSC (mode 1) | source |
|---|---|---|---|
| HZ / TICK | 50 / 0.02 s | 60 / 1/60 s (GUESS: not 59.94) | FUN_0040c078 (GS CRT mode 3 / 2) |
| STEP (DAT_004eeb24) | f32(1.1999999) | 1.0 | FUN_0040cb78(1.0), FUN_0040ce28, FUN_00322f88 |
| DT (DAT_004eeb28) | f32(STEP x f32(0.016666668)) = 0.0199999996 | 0.0166666675 | FUN_00322f88 |
| MOUSE (DAT_0046baac) | 0x3f99999a | 1.0 | FUN_00254490 (not applied yet: fidelity-audit 'OPEN: the mouse's DAT_004e1230 scaling') |
| FB_W x FB_H | 448 x 512 | 512 x 448 | FUN_0040c078 +0x2e8 / +0x2ec |
| screen centre | (224, 256) | (256, 224) | FUN_0040d7f0 |
| aspect (KY, KX, 1/H, 1/W) | 1.1428572, 1.0, 1/512, 1/448 | 0.875, 1.0, 1/448, 1/512 | FUN_0032ace0 l.517-535, DAT_0046e370..37c / 360..36c (ELF) |
| lock keep box | x (-60, 508), y (-110, 622) | x (-60, 572), y (-110, 558) | FUN_00328968 |
| probe-2 box | x (-50, 498), y (-100, 612) | x (-50, 562), y (-100, 548) | FUN_0055bda8 |

Readers: player.js (TICK / STEP / DT, the camera's CSTEP: was a literal 1.2, now STEP, PAL camera traces unchanged),
jump_core.js (JUMP.STEP), aim_core.js (WeaponSystem step), event_actor_rt.js, path_mover.js (MOVE_DT = DT), enemy_ai.js
(the body's dt), pcm_ring.js (FRAME_S = TICK), event_rt.js / stage_controller.js (the fade GUESS: rate x STEP),
chunk_anim.js / room.js / effects.js (default advance), the ms clocks (GUESS rows; worker 0298): video_mode `frameMs()` steps whole ms
(20 PAL; 16 / 17 / 17 NTSC) for the event clock (event_rt.js / stage_controller.js / intro.js, play.js `stage.tick`), the HUD clocks
(hud.js, aim.js reticle, hud_core.js restart lead), stage_info.js, event_window.js and gameover_layer.js; `FRAME_MS` is the mean,
lock_on.js (screen grid, boxes). play.js takes TICK / STEP from player.js.

**The other ~20 flag-0x1e users, read** (all 2D layout, none touches timing): FUN_003d2600 / FUN_003d28c8 set
DAT_004f2258 = flag (the 2D scale of FUN_003d2e80 / FUN_003d3098); FUN_003d3830(1) bilinear around text in FUN_003cc0a8,
FUN_003d75a0, FUN_003b8af8, FUN_00535ba0, FUN_00aa2238, FUN_00aa2418, FUN_003dcf58, FUN_00aa0b30 (flag 8 on sprites);
PAL slot positions +0x60 / +0x62 in FUN_003c58b8, FUN_003c6d70, FUN_003c6f98 (+0x7c zeroed); FUN_003e1250 (+3.0 y);
FUN_003e1770 / FUN_003e1978 (two config bytes kept across a reload); FUN_003e6198 (x 0x1b0 / 0x1aa); FUN_00531368 (a glyph
id +1 for 0xcd / 0x10c / 0x152); FUN_00568148 (a screen clamp box DAT_0058ddc0 vs DAT_0058ddd0); FUN_00528628 (tables
0x51ced0 / 0x51ceb0 vs 0x51cef0 / 0x51ced8); FUN_0040d110 (+ DAT_0047e210); FUN_00aa1780 (a printf path); FUN_003d58b8
(flag 8 on listed ids). **The page keeps the PAL branch of these in both modes** (stage_info.js SCRIPT_FLAG_1E, the 432 x
512 drawable): a mix the game never ran, HUD / menus only (fidelity-audit 'NTSC timing with the PAL 2D layout').

**NTSC-timing traces** (T, gitignored, tools/trace/out/w295; scripts tools/trace/scripts/w295_ntsc_{run,turn,jump}.json on
`--state tools/trace/out/sof_scale1.p2s`, 0293's state with +0x20 = 1.0): step 1.0 in every record after 0. They found two
page errors that PAL could not show:
1. The locomotion table install GUESS (`C+0x1d8 >= 5.0`): NTSC installs at 4.79 (the third frame of stick, as PAL's 5.55),
   so the bound is in (3.70, 4.79) (open above: 4.79 itself misses); now 4.0 (player.js `LOCO_INSTALL`, also aim.js's aimed move class). Still a GUESS (writer of C+0x658 not found).
2. The jump clip queue take-over: decoded now. FUN_005aa2a8's one-shot branch ends at `n - 1.0 <= frame`; the page used
   `>` (PAL's 8.999998 never hit 9.0 exactly; NTSC's 8.5 + 0.5 does: h_jp1 8.5 -> h_jp2 0.0).
`test_ntsc_traces.mjs` checks, per frame in NTSC: position (2.8e-3 run, 1.6e-2 turn walk), C+0x1d8 (7e-6), head clip and
frame (0 off), the cape window MP+0x434 / +0x438 (0 off; clip arms and a facing re-arm), 60.01 u/s real time; then
test_jump (j_stand) and test_wall (c_run) on the NTSC traces in NTSC mode. `DIRGE_VIDEO=pal` runs the same replay on c_run /
d_turn_circle. The per-frame cape countdown can't be told from a per-tick one in NTSC (step 1.0); the PAL run checks that.
Not checked in NTSC: the camera (no cam-fieldset NTSC trace), enemies, events, effects.
