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

## Open
- 41-43's stage-start activation (script 0 event 0x22 / 0x23; notes/enemy-activation.md) - with it the restart's
  ambush; the page start would also gain them if the page started from the stage start instead of the save.
- The opening cutscene's hand-off (gun drawn, the gun-view camera); the Status / load screens.
- The start position's source; records 81-86 (not actors on the page).
- The page's own start uses event flags {2: 7, 46: 1} where the save's RAM has 0 (not changed here).
