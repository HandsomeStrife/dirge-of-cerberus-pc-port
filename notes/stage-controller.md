# The stage controller: ev0100 scr000 `main` (worker 0219, 2026-11-03; plan P3b)

Code: `native/web/stage_controller.js` (StageRuntime extends 0210's EventRuntime, StageVM extends EventVM; neither
file edited), play.js `startStage` + one `stage.tick(20)` per game frame, exporter
`native/assets/models/export_web_stage.py` -> data/event/ev0100_stage.json (build step `stage`; disc.py INPUTS: 0c064000,
0c064002..7, the 51 camera files 0c0642xx). Tests: `node --import ./native/web/test_hooks.mjs
native/web/test_stage_controller.mjs` (37; MUTATE=getflag|setflag|skip|sleep|preempt: 5 / 5 killed),
`node native/web/test_stage_page.mjs` (9; the play.js tick hook mutant killed). Audit section 'Stage controller'.

## Classes
The stage program 06800000 loads event 100 scripts 1..7 (cmd 0x11) and runs scr000 (cmd 0xa). Class names: scr000
ev0100 (main, kalm_ld, gumin_set, vin_mset, deb_jump), scr001 ev0101 (first_event, rv_matiawase, sk_mituketa2), scr002
ev0103 (heri_*), scr003 ev0141 (first_encounter, rv_toujou, wro_kaisetu), scr004 ev0142, scr005 ev0143 (heri_tobi,
run_people*, beast_ev*, roji*, help_people*, help_orei*), scr006 ev0145 (kita_ev0145), scr007 ev0148 (kashitani_dummy:
an empty method main calls in its polls).

## Natives (method +0x0c, read from the class registry DAT_004ef498 in the save; slot = 0x38-byte class header:
+0x10 method count, +0x18 constants, +0x20 name, +0x30 methods of 0x18, method +0x0c = C function)
- Event.getflag / setflag 0x3a3268 / 0x3a31e8 -> FUN_0037cea0 / FUN_0037ce60: **global flags** DAT_0050db20[64] XOR
  DAT_0046f608. Zone.getflag / setflag 0x39c898 / 0x39c840 -> FUN_003ff738 / FUN_003ff658: **stage flags** (zone object
  +0x38 XOR DAT_0047dbf0; enemy_ai's eventFlags). Both keys are runtime RAM (tools/trace/stage_keys.py). The save's RAM:
  stage flags all 0, global {0: 1, 1: 3}; on w212's route by f770: stage {2: 7, 46: 1}, global + 55 = 7 (the x -1186
  help box, deb_jump). A fresh stage load (w210 start1704): both empty; during the opening: global {0: 1, 1: 3, 13: 64}.
- Zone.battle() = battle2(0) 0x39c618, battle3 0x39c650 -> **FUN_0037cf30** (battle mode: load waits, frame sync
  FUN_0037e4e0, cameras off, +0x156c = 0, +0x1558 bit 37, game-state bit 2 off); battle(n, v) = battle1 0x39c7e8 ->
  FUN_0037e3c0 (battle, poll until stage flag n == v, then event mode); Zone.event() = event2 0x39c690 / event3 0x39c6b8
  -> **FUN_0037e048** (event mode: bit 37 off, game-state bit 2 on). peace / chaos 0x39def0 / 0x39df18 -> FUN_00380290.
- set_usercontrol 0x39bf80 -> FUN_0037e5e8 (game-state bit 11 = off); free_usercontrol 0x3a4768; set_battlecontrol
  0x39c3a8 -> FUN_0037e588 (FUN_00403470, frame sync).
- Zone.load_l 0x39c8e8 -> FUN_0037a3b8: command 4 -> FUN_00377c68 case 4 -> FUN_00381518: full stage load
  FUN_002673d8 only when no zone is loaded (FUN_00269bb0 < 0), else FUN_002677a0(a, b), again when the stream is idle
  (FUN_00267358), done when idle.
- Sound: playMusic3 0x3a0198, playMusic2 0x3a02b8, changeMusicVol 0x3a5308 -> FUN_003ed740, stopMusic 0x3a0148,
  playBgAreaSound_l 0x39dd80 -> FUN_003e6c88 (the 1-argument wrapper passes 127), stopBgAreaSound 0x39ddf0.
- scene_save 0x39c728 (-> FUN_0023d690(0, n, 0) -> FUN_003bf250), wait_save 0x39c6f0, endSection 0x3a26a8,
  setSectionStat 0x3a53e0, displayStageInfo_l 0x39e8e8 / isDisplayStageInfo 0x39e9c8 (worker 0220's P11).
- Skip: setSkipMode 0x39ea68, unsetSkipMode 0x39ea18, isSkip 0x3a0d88 (+0x156c != 0), enableSkip 0x3a4898
  (FUN_003e0cc8: DAT_004f3044 bit 0x2000 = no Skip), abortSkip 0x39c350.

## Threads
The VM thread FUN_00372dd8 (FUN_00373098, priority 0x5a) is below the main thread; the interpreter (FUN_003a99f0 /
FUN_003ad288) never yields, so main's polls (`while (!flag) deb_jump()`, `kashitani_dummy`) spin in the frame's idle
time. StageVM.run: a step budget per frame (GUESS amount), then on next frame.

## Skip (decoded, then traced)
Offered by the pause menu while an event program runs in event mode: FUN_003c0520 (button 3 with FUN_003e0d00 == 0 ->
+0x48 = 1) -> FUN_003c0110 -> FUN_003dfdc8 -> FUN_003dfd18 (+0x1558 & 0x102000000000 == 0x100000000000) ->
FUN_00372f70 (+0x156c = 1, bit 36). FUN_00377c68's tail 1 -> 2. Effects: sleep FUN_003a0e48 ends, timers (case 0x1c)
end, moves (FUN_003779d0) jump to `to`, waits FUN_00379d48 poll faster, playMusic3 / 2 take their skip branch.
FUN_0037cf30 clears it. T w219_skip: Start f920, ✕ f960 -> FUN_00372f70 at f961, +0x156c 1 at f961, 2 at f962.
**Skip branches:** rv_matiawase has no isSkip test (Skip only shortens it). main's own: after first_event (skipped ->
kalm_ld(100)), after heri_taijou (pc 6352: skipped -> sk_mituketa2 not played), after heri_lasted (pc 11076: skipped ->
kita_ev0145 not played). Events with setSkipMode: first_event, heri_toujou, first_encounter, roji01_01, roji02_01.

## The beat traced (start deck cleared -> rv_matiawase -> chunk 03)
Scripts tools/trace/scripts/w219_beat.json (no skip) / w219_skip.json; env `TRACE_POKE=9540a4=58,10a2140=58
TRACE_FIELDSET=stage TRACE_CALLLOG=stage TRACE_LOG_AT=A6000` (fields.py / calllog.py set `stage`). Game (both runs):
stage flag 0 = 2 / 63 = 6 at f783 -> musicvol(3, 2500) f790 -> FUN_002677a0(2, 3) f798, f856 -> event mode f898 ->
asj_033 127 -> global 1 = 5, 18 = 1 -> scene_save(1) -> global 18 = 0, musicvol(0, 2500). No playMusic3 (bgm_001 goes
on). Unskipped: asj_033 at f1468; skipped: f999. The page's order is the same (test_stage_controller). The page runs
the skipped beat in ~10 frames (its loads are at once); the game's 7 frames before musicvol are main's loadchr waits.

## Open
- After scene_save(1) the game holds its event loop (+0x1558 bit 39, one command live) 600+ frames (to f1600): likely
  the checkpoint save itself (FUN_0023d690 / FUN_003bf250), not translated. The page goes back to battle at once.
- Nothing on the page consumes usercontrol / battlecontrol / the game-state bits yet (worker 0220's game_state.js);
  the skipped events' actor / camera / window / voice natives are left out (warned); Vincent is not moved by an event.
- scene_save -> checkpoint.js (P?), endSection / Zone.exit -> P12, displayStageInfo -> 0220's stage_info.js.
- Only the first beat is traced; later beats (chunks 6 / 7, 10 / 11, the bosses) need route states (worker 0217).
