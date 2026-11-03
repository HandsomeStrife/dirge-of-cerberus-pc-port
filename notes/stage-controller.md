# The stage controller: ev0100 scr000 `main` (worker 0219, 2026-11-03; plan P3b)

Code: `native/web/stage_controller.js` (StageRuntime extends 0210's EventRuntime, StageVM extends EventVM; neither
file edited), play.js `startStage` + one `stage.tick(20)` per game frame, exporter
`native/assets/models/export_web_stage.py` -> data/event/ev0100_stage.json (build step `stage`; disc.py INPUTS: 0c064000,
0c064002..7, the 51 camera files 0c0642xx). Tests: `node --import ./native/web/test_hooks.mjs
native/web/test_stage_controller.mjs` (54; MUTATE=getflag|setflag|skip|sleep|preempt|opening|skipinit|bit6|card|wait:
10 / 10 killed),
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
- Game-state bits: bit 11 (play.js neutral input) and bit 6 (enemy_ai AI pause) are read on the page; bit 2 (the stick in
  the event camera's frame, FUN_00333150) and bit 10 (FUN_005728d8's hit gate) are not;
  the skipped events' actor / camera / window / voice natives are left out (warned); Vincent is not moved by an event.
- scene_save -> checkpoint.js (P?), endSection / Zone.exit -> P12, displayStageInfo -> 0220's stage_info.js.
- Only the first beat is traced; later beats (chunks 6 / 7, 10 / 11, the bosses) need route states (worker 0217).

## Review fixes (2026-11-03, manager review)
- Auto-skip is a GUESS (audit 'GUESS: auto-skip'): at the event's first wait (vm.pending), off with `?autoskip=0`.
- skippable() includes the stage-info card's DAT_004f3044 bit 0x2000 (FUN_003fdb48 saves and sets it, FUN_003fdd58
  clears it unless it was set before); requestSkip calls event_rt.js's (guard, event sounds, windows; worker 0222).
- Event mode and set_usercontrol(0) set bit 6 (the AI paused), as FUN_0037def0 does; peace / chaos keep FUN_003809a8's count.
- With the opening, main starts with it (play.js startStage(true) in startIntro's wake, ticked in the opening branch):
  the prelude runs in its first frames, first_event waits for the hand-off (opts.openingDone), then main reads the
  opening's +0x156c (opts.openingSkip). From the save (?intro=0) the stage load is awaited before the first frame and
  main settles there (no synchronous work mid-play).

## Battle actors and the hand-back by name (worker 0229, 2026-11-03)
Natives (method +0x0c, registry DAT_004ef498, read from out/route/r02_climb.p2s): getbattleactor_l 0x39e1a8, setbattlename_l
0x39d430, setpos_l 0x39d170, setdir_l 0x39f038, setVisible_l 0x3a3478, finalize_l 0x3a3410, getmorphstate 0x39d090,
getweaponframe 0x3a3330, setdirofbattle_l 0x3a3448, getposx/y/z_l 0x39d488 / 0x39e108 / 0x39e158, get_battle_camera_l 0x3a29c8.
- **getbattleactor(name)** -> FUN_00376b00: the status by 8-char name (FUN_003193c0; the name = status +0xa0 record +0x44,
  FUN_00316d40; record 0 = p_Vin, 113 = n_CupM, 114 = n_CupW), its object (FUN_0053bd50 -> FUN_0053b978(status +10));
  FUN_0056a5e0 takes the object's model (+0x180 = 0, +0x28 |= 0x40, FUN_00315758(status, 1): +0x88 = 0, +0x60 |= 4); a
  new slot FUN_00376308(ev, model, 0, id), slot matrix = the model's; p_Vin: FUN_00380858(0).
- **setbattlename** -> FUN_003765a0: frame sync FUN_0037e4e0, slot +0xa5 = name. **setdir_l** (bool unused) -> FUN_0037c300
  -> FUN_00383d10: d = row 3 - target (y 0); row 0 = row 1 x d, row 2 = row 0 x row 1, row 1 = row 2 x row 0, normalised.
- **Hand-back**: FUN_00376938(name) releases the slot named `name` (FUN_003771e0 / FUN_00376890 / FUN_00376c80(.., 0))
  and returns its model; FUN_003157b0(status, 0): +0x30 = root row 3 (+ bone 1, y 0), +0x40 = -row 2. Callers: the status
  update FUN_003159b8 when +0x88 == 0 (a lent object: the frame after setbattlename), and FUN_00319190 for every status in
  battle()'s FUN_00324e70 (branch with DAT_004b8ac8 bit 5 clear), which then resets the camera FUN_00329f68 -> FUN_003285d0
  (angles from render view 1's forward). battle() first finalizes unnamed slots (FUN_00376c80(.., 1): FUN_005a7d88 frees a
  lent model; the object's FUN_003159b8 other branch builds a new one).
- Beats seen: after rv_matiawase main loads p000 into a slot, setpos (-889.2, 0, -599), setdir (-929.2, 0, -599),
  setbattlename p_Vin, battle(1500); the rescue (pc 0x849, flag 1 = 5, flag 12 < 1): getbattleactor p_Vin / n_CupM / n_CupW,
  hide them, roji02_01, flag 12 = 1, Vincent setVisible / setpos (-1120.2, 0, -1277.3) / setdir (-1118.2, 0, -1277.6),
  Camera.set eye (-1135.5, -31.8, -1275.1) aim (-1134.75, -31.16, -1275.205) fov 73.5, active, setbattlename p_Vin, battle().
- **T** (tools/trace/scripts/w229_rescue.json / w229_rescue_pos.json; state = worker 0223's grab95/s826.p2s, poke
  `TRACE_POKE=a06338=91379f02` = stage flags 0 = 2, 1 = 5): rv_matiawase event f126, scene_save f702, then the memory-card
  box (right + ✕ = CANCEL, left + ✕ = continue without saving) and the map screen (✕): **this is the 600-frame hold** noted
  above (input, not the save). battle(1500) f1231, event f1320, roji02_01 unskipped to ~f2100, battle f2128 (call log).
  Fields (TRACE_FIELDSET=enemy TRACE_ERECS=113,114 TRACE_ENEMIES=2 TRACE_LOG_AT=a5800): f1850 Vincent (-889.2, -0.064, -599)
  facing -x; record 2126 Vincent (-1120.2, -0.0623, -1277.3) facing (0.98894, 0, -0.14831), CAM+0x80 (0.75641, 0.64547,
  -0.10588) = main's event camera, eye (-1136.096, -31.009, -1275.074); 113 / 114 at (-913.1, -140.2, -892.4) 'r_gst_lk' /
  (-953.9, -160.4, -1084.8) 'r_gst', +0x28 bit 0x40 cleared.
- Page: stage_controller.js (EventActors slot state + the natives + `lentUpdate` / `handBackAll` / camera reset in
  `enterBattle`), play.js `battleObject` / `vinBattle` / `stageCameraReset`, ai.json records' `tag`. Tests:
  test_stage_controller section 5 (+ trace checks; MUTATE=setpos|camset|setdir|bname), test_npc_page (the two beats on the page).
- **Open**: where the townspeople are after the rescue (not main; roji02_01 / scripts on flag 12?) and whether they are
  drawn; the camera's distance after the reset (T 21.05 u, page 36.1 u: FollowCamera at pitch -0.70); bone 1's offset
  (GUESS 0); the slot's own drawing while lent (setpos / setmotion not shown during the auto-skipped beat); who clears
  Vincent's +0x88 for the p000 hand-back; getmorphstate / getweaponframe / setdirofbattle / loadVincentWeapon,
  getpos / get_battle_camera, the other events' natives.
