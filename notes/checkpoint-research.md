# Restart -> the checkpoint (worker 0201, 2026-11-02)

Code: `native/web/checkpoint.js` (`CHECKPOINT`, `restoreCheckpoint`), play.js `restart` / `rebuildEnemies` (run at the
start of the next game frame after either Restart). Tests: `test_checkpoint.mjs` (hooked), `test_checkpoint_page.mjs`.
Fidelity rows: notes/fidelity-audit.md "Restart -> the checkpoint", "Game over Restart (result 6)".

## Chain (decoded)
1. Game over ✕ Restart -> 6 (FUN_005349c0) -> FUN_003fdf00 -> DAT_0047db88 = 6. Stage loop FUN_004012c0 default case:
   FUN_003fdd00() == 6 -> FUN_002574a0 (clears DAT_004e18b8 x 8, two bytes of FUN_002578b8(0)), FUN_0031dbc8
   (FUN_0031d9c0 on DAT_0046e228: zeroes 0x39 words), FUN_003fdd10, FUN_003fded0, returns 6.
   Pause OK on Restart: FUN_003c0a20 (FUN_00380b00 = FUN_003e7f60(-1, -1, -1); stage +0x1558 bit 51) + FUN_003dee40(0xf)
   -> FUN_004012c0 reads DAT_004fadd8 = 0xf: FUN_00241990(0xe, 1), returns 6. Same path from here.
2. Stage program FUN_00401b90, cmd 6 (the stage loop): a nonzero return ends the program (FUN_00254628(0),
   FUN_003dee60(0), FUN_00400270, FUN_003ffbb8) and hands 6 to the game-state machine FUN_00247508 (state 0x15).
3. FUN_00247508 0x15, result 6: FUN_003ea1d0(-1) (PTR_0047d730) and FUN_003e62d0(-1) (PTR_0047d6b0); with mode bit 10
   clear FUN_00241990(0xd, 1); then DAT_0046b0b8 (FUN_0023d598) == 1: with bit 0xe (the pause's) FUN_0023cf18(0),
   FUN_0030f3d8 (status / stage-record reset: FUN_00312650, FUN_00320848, FUN_0031dae8, FUN_003202e8, FUN_0031c2f8,
   FUN_00312558, FUN_00312408) and bit 5; else (save +0x41881 set) FUN_0023dc48 (copy save +0x41840.. to DAT_004b2680)
   and bit 3. -> state 0x13.
4. 0x13: FUN_00312c68(0), (bits 4 / 10: FUN_0030f3d8 ...), FUN_003ff0c0(alloc, FUN_00241e78() = DAT_004b8ba0 = 0x80,
   FUN_00241e88(0 / 1) = 0, 0) -> 0x14 FUN_00402220 (load) -> 0x15 the stage program again.
5. FUN_003ff0c0: with mode bit 3 the checkpoint record DAT_004b2680 (FUN_003ff028: stage byte, program index +4, flags
   +0xc0, difficulty +0x40, ...); with a save block (bits 3 / 5 / 0 / 4 / 7 / 8) and +0x1c4 == 0 the record at save
   +0xc0; else the stage from the argument, **program index 0** and FUN_004039d0 (all 64 event flags 0) or
   FUN_00403a48(save +0x180). In the z128 save: DAT_004b2680 and save +0x41840 are all zero, +0x1c4 = 1, +0x180 flags 0.
   Whichever branch ran, the trace shows program index 0's outcome: flags all 0, the stage's start.
6. The stage program (save RAM, stage object DAT_0047dbb0 +0x14, 16 commands): 0xd, 0xc, 5, 1, 0x11 x 7, 4, 0xa,
   **0 = area load FUN_003ff7a8(0x80, 1, 2)**, 6 = the stage loop. The save was at index 15 (in the loop).

## Traced (PCSX2; gitignored states / traces)
- `tools/trace/scripts/w201_restart_grab.json`: the w192 death route (HP poked 1, `TRACE_POKE=960660=1`,
  `TRACE_LOG_AT=C0000`), ✕ on Restart f1250, then ✕ every 60 frames to f3940 (through the screens). Driven by a
  scratch driver (grab_gs-like: PINE watches DAT_004b8b2c / DAT_0047dbcc, F1 saves states): game state 0x15 -> 0x14
  at f1653, 0x15 at f1668 with the stage program from 0; the stage loop in play at **f3984**. Seen on the way
  (screenshots): the stage-result Status screen (f1508), the 'Sea of Flames' load title (f1828), the opening
  cutscenes (f2145-3358; ✕ skips), play from ~f3967.
- `tools/trace/scripts/w201_reload.json` (`TRACE_FIELDSET=enemy TRACE_ERECS=44,66`), run from the state saved at
  f3984 (hook area zeroed, the pad `jal` restored) -> `tools/trace/out/w201_reload.jsonl`, 270 records, no input.

## The checkpoint vs the page's start
| | game after the reload (T) | the save state (the page's start) | the page before this work |
|---|---|---|---|
| Vincent position | record 10: (-1395.1516, -98.34 -> ground -98.6444, -1111.0149) | the same, bit for bit | spawn (-1395.63, ground, -1110.51) |
| facing | (0.0008, 0, 1.0), drifting to 0.012 rad (gun aim) | (0.1753, 0, 0.9845) | from the hero camera |
| weapon | drawn (h_st_a, P+0x104 0x337f1403) | holstered (h_st, 0x337f2002) | holstered |
| HP / P+0x118 | 780 / 0x20209 (736 at record 100: 41-43's fire) | 780 / 0x20209 | 780 / 0x20209 |
| event flags | all 0 | all 0 in RAM | {2: 7, 46: 1} (a later trace's values) |
| soldiers 44-49 / 66 | state, +0x118, HP, position, clip = the save's (44 / 66 still to record 270) | | AWAKE tables = the save |
| soldiers 41-43 | alive, attacking (astate 3, HP 10 / 28 / 24, y -141.45) | dead | dead (refused) |
| records 81-86 | +0x104 0 / +0x118 3 at +60 frames, 84-86 back to 2 / 0x203 by +200 | 2 / 0x203 | — |
| camera | eye (-1390.5, -99.9, -1144.3), fwd (-0.0005, -0.4247, 0.9054) (the gun view) | (0.7879, 0.0383, 0.6146) | CAM_SPAWN |

So the z128 save is the stage start seen a little later: Vincent had not moved, and 41-43 (the opening ambush) were
already dead. Where the start position is stored was not found: the floats are in neither the stage files nor any
extracted file (two searches); the page takes the traced values (`CHECKPOINT`, = the save's C+0x30).

## On the page
`restoreCheckpoint`: game over reset; HP 780, P+0x118, s64; Vincent built at `CHECKPOINT` (ctrl.reset with the
checkpoint as a temporary spawn; H keeps the page spawn); weapon reset; cloth restart; camera `clearDeath()` (worker
0199) + `reset(pos)` (the page start angles; see review fixes); effects freed; a new enemy_ai world (`createEnemyAI({...opts,
eventFlags: {}})` + the save's soldiers; old bodies removed, re-added); music / ambience restarted. Warned: the screens
in between, the holstered gun, 41-43.

## Review fixes (worker 0201, manager review)
- Vincent's frame stamps (enemy_ai `??=` on php) no longer survive a Restart. Decoded: the stage loop's exit tears the
  world down (FUN_003249d0 -> FUN_003236c8 -> FUN_0053a618) and the reload builds a new object manager (FUN_00322bc8 ->
  FUN_0053a560 -> FUN_0053a750, frame counter +0x20 = 0) and a new Vincent: FUN_00571ee8 (+0x27c -40, +0x280 -15) ->
  FUN_0056f928 -> FUN_00558790 (+0x142 0xff) -> FUN_005596a0 (+0x148 counter - 0x78, +0x150 / +0x152 / phase 0); his C
  FUN_0033ff18 (C+0x810 -15). T: the state saved at the reload holds exactly these with the counter at 14, so at the
  placement (record 10) the counter is 24: the new world starts at S.frame 24 (`CHECKPOINT.frame`). The opening
  cutscenes don't advance the counter. Test: a late death (stamps near frame 3000), Restart, one hit = a first life's
  (grunt, stagger sums, gate stamps).
- Bodies: every body activated since the start goes (play.js `bodyRecs` from onActivate, and anything not in the start's
  set); the start's non-AI placements stay.
- HUD: destroyed at the stage program's end (FUN_003ad5e0, vt+0xc) and built by game state 0x13 (FUN_003ad530 ->
  FUN_003ad618). hud.js `reset()` builds the state again from hud.json (GUESS: the save's values for the constructor's);
  the HUD clock runs on.
- Camera: the page's start angles (GUESS), not the gun view's.
- Twister: FUN_0040b398 is called only by FUN_00248528 (boot, from the entry) and FUN_00248a70, so the game's twister
  runs on through a reload; play.js now passes one GameRandom (`aiRng`) to every world on purpose.
- effects.js `reset()` (emitters, mgr +0x8c; GUESS), SoundEmitters' unsent requests dropped (GUESS).
- enemy_ai world exposes `eventFlags` (tests).

## Re-review fixes (worker 0201)
- Camera: FUN_00328368 (the reload's new camera, FUN_003387f8 kind 0xe -> FUN_00328010) zeroes CAM+0x1c4 / +0x1c8 /
  +0x1a8 and sets +0x1e2 = -20; reset() (FUN_003285d0) keeps them, so checkpoint.js clears them after it (T: 0 / 0 / 0 /
  -12 in the reload state). Not clearDeath (worker 0199's). +0x17c / +0x1a0 / +0x1a4: aim_core's holstered rest (GUESS).
- Bodies: play.js holds the game frames (as while the clip packs load) until swapBodies' new bodies are attached, then
  runs the restore at the next frame start: the new world's first tick has every start body (page test).
  `?enemies=all`: every start body that is gone is added again. enemy_ai's no-pose warnings now say whether boneWorld
  is unset or the record has no posed body yet.
- AI clock: T w201_reload ai_now 14 at record 0, 26 at record 10 (the rebuilt scheduler runs before the placement):
  the new world starts at now 26, acc 0.3 (all of [0.2001, 0.4] reproduce the 270 records); test: S.now = ai_now
  records 11-110.
- Effects: test on the real manager (a live wall impact 0x46400 and the 0x1000 flash, Restart, freed, spawn again).

## 41-43 at the checkpoint (worker 0204, 2026-11-02)
**Not script 0.** Script 0 event 0x22 never activates 41-43 (it only switches them off at flag0 == 2); script 88 (trigger
15, far east) sends them 0x10a. They are **stage-load placements**: section-1 +0x40 = 8 (bit 3) and tags e_Sol_11 / 12 /
13 in the event-actor table (the reload state's table = the save's, plus w_Gun_00), the rule worker 0116 decoded
(FUN_00319190 / FUN_003159b8 / FUN_005453b0 -> FUN_00558f68; placements.json load_flag_records + event_actors).
- FUN_00558f68 (newly flagged, inactive): +0x144(1, 1) -> FUN_00559748 with param_3 = 1: builds body + AI (FUN_00365c50,
  FUN_0035ee08(ai, a, 1) -> FUN_00360418(ai, 1): magazine + trunc(((mag >> 1) + 1) x rand)), and at its end runs script
  event 3 (vt+0x2f4, zero args) and clears +0x28 bit 0x100000. Then FUN_00558cc0 (placed at the status matrix), and
  the tail: C+0x1d8 0, C+0x564 |= 0x20000000 (the next clip's blend = FUN_00312678 = DAT_0046dd68+0x7c, 0 here; cleared
  by FUN_00344608), C+0x1c0 |= 0x200, FUN_0055b8e0(a, 3, 1, 0) (C+0x808 bit 0 set for stance 0x1f), +0x118 &= ~0x40000.
- Scripts 105 (41) / 107 (43) event 3: 0x193 (target Vincent), var 7 = 1, 0x142(3), **0x106(1, 80 / 150)**; 106 (42):
  0x193, 0x143(1). Event 1 with r0 = 1 (105 / 107): 0x193, 0x143(2 on normal, 1 on diff 2) / 107's own.
- **Cmd 0x106** (FUN_0054cd70): object timers +0x3c / +0x3e; FUN_0053e6e8 / FUN_0053e7a8 keep a list (manager
  +0x1244..+0x124c); **FUN_0053e868** (in FUN_0053b500 just before FUN_0053fde8) subtracts (int) of the frame step and,
  at <= 0, posts manager event 0xd -> FUN_0053fde8 case 0xe -> **script event 1 (timer index, 0)**. 0x107 reads a timer.
- T `w204_reload` (TRACE_FIELDSET=enemy TRACE_ERECS=41,42,43 TRACE_ENEMIES=3 TRACE_EPIN=41:904760:91af00,42:904f80:91b010,
  43:9057a0:91b120, from 0201's reload state; new fields.py TRACE_EPIN pins bodies built during the run): 41-43
  inactive to record 9, active at record 10 (Vincent's placement frame), state 3, HP 10 / 28 / 24, rounds 8 / 6 / 0xffff,
  42 brain mode 1; 41 mode 2 at record 90 (= 10 + 80), 43 mode 1 at record 160; 42's first shot record 12; 41's at 96,
  Vincent hit at record 100 (780 -> 736); 42 / 43 crouch (state 5) at records 184 / 273. Only 44 / 66 are active in the
  reload state; 45-49 become active at record 10 too, in the save's states (2 / 1 / 1 / 2 / 2).
- **Record 24: the hand-off.** All three jump (41 9.65 u to x -1394.98, 42 8.58 u to -1404.25, 43 4.84 u to -1386.16;
  y -141.45; new facings; +0x28 |= 8 by FUN_0054b6c8). Call log (scratch set on vt+0x234 of classes 0x58e1f8 / 0x58f128):
  both Vincent's placement (frame 10) and theirs (frame 24) come from 0x558d60 = **FUN_00558cc0**, the actor at its
  status matrix (+0x30 / +0x40 / +0x50). The status matrix is written by **FUN_003157b0** from the loaded event actor's
  model (status +0x88: its root transform + a bone offset), called from FUN_003159b8 / FUN_00319190: the opening
  cutscene's final pose. In the reload state the soldiers' status matrices still hold the placements, Vincent's holds
  facing (0.0008, 0, 1). That is also where Vincent's start position comes from (0201's open question): it needs the
  cutscene (event) runtime. Two attempts (float search, call log); stopped there.
- **The drawn gun** is not a stage-start command: in the reload state (before the loop's first frame) P+0x104 is state 3
  and the clip h_st_a already. The event VM's game interface (FUN_00326660 cases 0x64-0x7a, FUN_003262b8: player placed by
  FUN_00558cc0 / FUN_0054b1a0, FUN_00578548, FUN_005764d0 = state 2 / 3 by P+0x2a8 bit 0) and the event file's last
  commands would be needed. Left out (warned).
- Page: enemy_ai `stageLoad` + timers + the activation magazine; play.js rebuildEnemies (deadRecs [], 44 / 66, the pass,
  45-49); swapBodies attaches 41-43's bodies before the first frame. 41-43 stay at their placements (warned): records
  11-23 equal the game's, later they stand 5-10 u off, and their fire differs (the page's 41 fires a frame early and
  misses in the hooked run; on the real page one of them hit Vincent before +60 frames).
- **Fresh page load: not changed.** The save state (the page's start) is later than the stage start: 41-43 dead
  (shot: corpses settled), flags {2: 7, 46: 1}. Running the stage-load pass there would revive them; starting the page
  from the stage start instead would need the cutscene's hand-off too (positions, the gun). So the page keeps the save.

## Review fixes (worker 0204, manager review)
- 0x108's magazine draw against the game's twister: new trace w204_t56rng (k_enemy_engage2's run into trigger 56,
  `TRACE_RNG=1 TRACE_CALLLOG=w204rng TRACE_CALLLOG_FRAMES=158:175 TRACE_FIELDSET=enemy TRACE_ERECS=44 TRACE_ENEMIES=1`):
  the only draws in 158-174 are FUN_00360418's for 50 / 51 (frame 163, rounds 6 / 21); the page matches word for word.
  The bVar1 gate of FUN_00559748 translated (bits 4 / 0x20 of +0x28; never set on z128).
- Timers in normal play: w204_167 (`TRACE_EVARS=1`, new fields.py opt-in) for 46 / 47 past their path ends: timers, modes,
  vars equal f1400-1679; event 1 re-arms 200 and keeps mode 1 because script 110 set manager short 0 = 1. Impact list
  in the audit row. Route w204_t56 (50 / 51, `TRACE_EPIN=50:91adc0:930e50,51:91b5e0:930f60`): they stay idle, no timer.
- stageLoad: only loaded statuses get the pass (44 / 66 don't qualify in the reload state); an already-active one gets
  the tail without a state change.
- Tests read HP / state / position on the first tick (after the restore, after H).

## Open
- The opening cutscene's hand-off (41-43's and Vincent's positions via FUN_003157b0, the gun drawn, the gun-view camera);
  the Status / load screens.
- What activates 45-49 at record 10 (not bit 3).
- The start position's source; records 81-86 (not actors on the page).
- The page's own start uses event flags {2: 7, 46: 1} where the save's RAM has 0 (not changed here).

## The opening cutscene's hand-off (worker 0205, 2026-11-02)
The positions are the opening event's battle clips' last frames (not cutscene keyframes on the page).
- The event script: ev0100's class scr001 (FileCode 0x0c064001 = 0x0c000000 | event << 12 | script). Classes are
  encrypted ("TTTT"): FUN_003a7700 -> FUN_003a8320 -> FUN_0041c1d8 (key schedule FUN_0041bb38; per block FUN_0041c010
  -> FUN_0041bf78 (byte chain through an ELF table) + FUN_0041bf08 (u64 mix); a checksum block last). Python:
  `native/assets/models/kel_class.py` (decrypt + class reader; every constant and the table are read from the user's
  ELF instructions at run time; layout FUN_003a71c0: constant table of 16-byte cells, method table, Code attribute;
  the code is standard JVM bytecode). Checked: equal to the recompiled FUN_003a8320 run on port/oracle
  (`oracle-cli --call 0x3a8320`) for all 268 "TTTT" files of the disc, all checksums pass. T: scr001's image sits in
  RAM in 0201's reload state.
- The shape of first_event()'s end: per actor (Vincent and the three soldiers) setpos / setdir / setmotionofbattle
  (clips km01vnw2, km01daw / km01dbw / km01dcw), then setbattlename (the event-actor tags p_Vin, e_Sol_11-13, which
  answers worker 0116's question of what fills that table) and set_battlemode. The setpos points are the event-actor
  models' roots in the reload state (identity rotation).
- The release (T w205_reload, call-log set `w205`): FUN_00324e70 / FUN_00319190 do NOT run after the reload; all four
  placements (Vincent record 10, 41-43 record 24) come from **FUN_00344d68** (ra 0x344e60): the body's update
  FUN_00343de8 sees C+0x564 bit 0x10000000 (the battle clip) and FUN_00346150() == 0 (it ended) -> C+0x564 &=
  ~0x18000000, FUN_003157b0(status, 1), FUN_00558cc0.
- **Composition GUESS (matches T):** FUN_00344d68 passes param 1 (root only) and FUN_003157b0 returns early when status
  +0x88 is 0, as it is for the soldiers in the reload state; so the bone-1 offset gets into the status matrix some
  other way. Pinned further (T w205_3157b0, call-log set `w205b`): at frame 10 FUN_003159b8 (ra 0x315ab0) calls
  FUN_003157b0(status, 0), setting +0x88 = the event model (matrix at the mid-clip pose); at the release FUN_00344d68's
  param-1 call copies the model root, which by then equals origin x the last frame's bone 1 (Vincent's too). So the
  bone-1 offset is moved into the model root at the clip's end; that writer is not found. The page uses FUN_003157b0's param-0 form (root x bone 1 of the clip's last frame, bone y
  zeroed; +0x30 = row 3, +0x40 = -row 2): it gives Vincent's record-10 position bit for bit (facing 4.9e-5 rad off)
  and 41-43's record-24 positions to the float.
- Page: `export_web_checkpoint.py` -> data/checkpoint.json (build step `checkpoint`; disc.py INPUTS + 0c064001,
  0c064400-05); checkpoint.js `handOff` (FUN_003157b0's param-0 form + FUN_00558cc0's rows), Vincent placed there at
  the restore (CHECKPOINT.pos / face removed), 41-43 scheduled at S.frame 24 + 14 (enemy_ai `scheduleHandOff`, tick
  step 3b, after the turn: T record 24 holds the hand-off facing).
- **GUESS rows:** the composition (above); setdir's value = identity root (natives unknown; T: identity in the reload
  RAM); SOLDIER_RELEASE = 14 (T; a fixed frame stands in for the whole clip-end condition); the stage start's class =
  ev0100 scr001 (T); the exporter's straight-line pass over first_event.
- **Not decoded (two attempts, stopped):** the drawn gun (state 3, h_st_a) and the gun-view camera. FUN_005764d0 acts
  only from states >= 8; FUN_00326660 cases 0x78 / 0x79 and FUN_003262b8 are not called in the hand-off (T w205); the
  event natives (set_battlemode, setmotionofbattle) are not bound by name in the ELF (FUN_003a9c58's method+0x0c binding
  not followed). Page: holstered + start camera (GUESS rows).
- **First hit (T w205_rng, TRACE_RNG=1):** the game's 41 fires at record 96 and hits Vincent at 100 (44 damage). The
  page's 41 fires from the hand-off at record 95 (worker 0204's one-frame-early fire); its twister is off by then and
  the hooked run has no body poses, so the shot misses there (even with the game's words forced). Not reproduced.
