# Story cutscenes: every event in ev0100 `main`, and how to make one play (worker 0261, 2026-11-04)

The list, in the order the story reaches each event (main's code order; beats and places: notes/stage-controller.md 'Beats').
"Plays" = in `PLAYS` (stage_controller.js) or played elsewhere. Main calls nothing else: an event outside them is a console.error (StageVM.invoke). There is no auto-skip any more.
Class = the export's name; scrNNN = the file's script (ev0100 scrNNN). pc = main's call site.

| # | event | class | pc | runs when | plays? | story path it changes |
|---|---|---|---|---|---|---|
| 1 | first_event | ev0101 (scr001) | 745 | stage 0 = 0, global 1 < 3 | yes, the opening (intro.js) | isSkip -> kalm_ld(100) |
| 2 | rv_matiawase | ev0101 (scr001) | 1216 | stage 0 = 2, global 1 < 5 | yes (0248) | none (no isSkip test) |
| 3 | roji01_01 | ev0143 (scr005) | 1932 | stage 1 = 4 (script 16 ev 2) | **yes (0261)** | |
| 4 | roji02_01 | ev0143 (scr005) | 2276 | stage 1 = 5, flag 12 < 1 (the rescue) | no | |
| 5 | beast_ev01 | ev0143 (scr005) | 2668 | stage 0 = 11, global 1 < 8 | **yes (0261)** | |
| 6 | beast_ev02 | ev0143 (scr005) | 3101 | stage 1 = 11 (script 217 ev 1) | **yes (0261)** | |
| 7 | heri_tobi | ev0143 (scr005) | 3426 | stage 1 = 7 (trigger, script 139) | **yes (0261)** | |
| 8 | help_people01 | ev0143 (scr005) | 3833 | stage 1 = 8 (trigger 59, script 17) | **yes (0261)** | |
| 9 | help_orei01 | ev0143 (scr005) | 3974 | stage 1 = 10 (script 13 ev 0x17) | **yes (0261)** | |
| 10 | help_orei02 | ev0143 (scr005) | 4401 | stage 1 = 12 (script 47 ev 0x17), 3 lent actors | **yes (0261)** | |
| 11 | heri_toujou | ev0103 (scr002) | 5162 | stage 0 = 13 | **yes (0262)** | |
| 12 | heri_dgsol | ev0103 (scr002) | 5438 | stage 0 = 14 | **yes (0262)** | |
| 13 | heri_taijou | ev0103 (scr002) | 5756 | stage 0 = 16 | **yes (0261)** | **Skip in it: main's pc 6355 jumps past sk_mituketa2** |
| 14 | sk_mituketa2 | ev0101 (scr001) | 6366 | right after 13, only if not skipped | **yes (0261)** | never played before |
| 15 | first_encounter | ev0141 (scr003) | 6887 | stage 0 = 20 | **yes (0263)** | |
| 16 | rv_toujou | ev0141 (scr003) | 7152 | stage 0 = 24 | **yes (0263)** | |
| 17 | help_orei04 | ev0143 (scr005) | 8938 | stage 1 = 28 (script 60 ev 2) | **yes (0261)** | |
| 18 | help_people03 | ev0143 (scr005) | 9302 | stage 1 = 29 (trigger 64, script 37) | **yes (0261)** | |
| 19 | help_orei03 | ev0143 (scr005) | 9771 | stage 1 = 30 (script 62 ev 2) | **yes (0261)** | |
| 20 | wro_kaisetu | ev0141 (scr003) | 10226 | stage 1 = 32 | **yes (0263)** | a choice box: the player's keys |
| 21 | heri_lastst | ev0103 (scr002) | 10609 | stage 0 = 36 | **yes (0262)** | |
| 22 | heri_lasted | ev0103 (scr002) | 10949 | stage 0 = 40 | **yes (0262)** | **Skip in it: main's pc 11079 jumps past kita_ev0145** |
| 23 | kita_ev0145 | ev0145 (scr006) | 11082 | right after 22, only if not skipped | **yes (0262)** | plays when 22 is not Skipped |

Not called by anything in the stage's classes: run_people02, run_people03 (ev0143), private_ev (ev0142). Only three isSkip tests exist,
all in main (pcs 754, 6355, 11079); no event tests it itself.

## The pattern: making an event play (what to do, what to check)

Do these per event, in this order; `heri_taijou` / `sk_mituketa2` / `roji02_01` are the worked examples. Scratch tools: a JVM disassembler is easy
(the export's `classes[..].cp` + `methods[..].code`); `tools/trace/cmp_event_cams.mjs`, `cmp_event_actors.mjs` compare.
1. **Read it.** Disassemble the event. List its models (`load`), motion files (`loadmotion`), cameras (`Camera.load`), voices (`loadVoice2`), natives.
   Natives missing: run it headless (`new StageRuntime(data, { warn })`, `vm.start(cls, name, desc, [])`): the warnings list them.
   C addresses: class registry DAT_004ef498 in any state, 32 slots of 0x38 (+0x10 method count, +0x30 methods of 0x18: +0x0c C function, +0x10 hash
   (FUN_003a8828(desc) << 16 | FUN_003a8828(name))).
2. **Data.** Models and motion files: `export_web_event_actors.py` FILES / MODELS (reads the stage classes' strings, `--stage`) + tools/byo/disc.py INPUTS.
   Voices: tools/audio/voice.py default `--names` + build_web.sh's keep list + disc.py. Subtitles and voice lengths are already all in the stage export.
3. **Natives.** Translate with the citation; a native that can't be done now warns and is listed in fidelity-audit.
4. **Skip branches and press points.** `PLAYS` in stage_controller.js. Check main's code around the event: what an unplayed event before it does to it
   (`isSkip`).
5. **Trace it unskipped** from a walked state (notes/route-states.md), TRACE_FIELDSET=event (cameras, clock), then TRACE_FIELDSET=evactor with TRACE_EVMP (actors).
   `TRACE_LOG_AT` so the log fits: the error message says what fits; split long events into windows of the same run. Route skipped most events: replay the
   route's script up to its Start press, then no input. scene_save's box needs its answers: hold (+0x1558 bit 39) + 300 right, + 320 ✕, + 380 left, + 400 ✕, + 500 ✕, + 600 ✕.
6. **Check:** `node tools/trace/cmp_event_cams.mjs CLS.METHOD TRACE --from F`: same shot count, errors per shot by event clock. Then actors. Then the page:
   `test_story_cutscenes_page.mjs` shows the shape (warp aid, what's drawn, Vincent hidden, position after), and one game-vs-page image.
7. **Add it to** `PLAYS`, this table, test_story_cutscenes.mjs (a user's path through main), and the audit.

## Decoded here (worker 0261)

- **Camera file type 10** FUN_00374720 / FUN_00373908 group 4: roll channel, up point built per key (event_rt.js `rollUpSplines`). 27 of 51 files have it; every
  event of scr002, scr003, scr006 crashed the page before this (they were always auto-skipped first, so nobody saw). Non-zero roll only in files 139-143 (heri_lasted): sign from the code, not traced.
- **hide_model_l** FUN_003a11d0 -> FUN_0037aa20: MP+0x180 bit n, b 0 sets, b != 0 clears; FUN_005b2ef8 skips smd list entry n when its bit is set (event_actors.js `applyMask`, actors.json `blocks`).
- **setVisibleAll** FUN_0039d118 -> FUN_00380048 mode 0: every MP (FUN_00408900 -> FUN_005a85f8(MP, b ? 0 : 2)): enemies, items, Vincent. Modes 1-5 decoded, not used by the stage; warned.
- **setVisibleModelGroup** FUN_0039dc88: DAT_004e8700 bit n - 1 (as stage script cmds 0x54 / 0x55). **start_anim_l** FUN_0039dbe0 -> FUN_00269668 -> FUN_00268220: restarts a chunk animation that isn't playing at load: not exported, warned.
- **waitVoiceFinish** FUN_003a09b8, **isVoicePlaying** FUN_003a0a38, FUN_003eaea8: a voice channel holds the name, from its load to the end of its stream (`data.voiceMs`, sdb row +0x14).
- **Event.stop** FUN_0039fca8: polls bits 40 / 39: nothing to do on the page.
- Vincent's body: aim.js's render set `vin.body.visible` every frame, so hiding him in an event did nothing (rv_matiawase too). Now `vin.eventHidden`.

## Results against the game

Traces in tools/trace/out/w261 (gitignored). State w261_preheri = r06_heli4 + w217_r06_heli5's first 1260 frames (Dragonfly beaten, stage flag 0 = 16).
Cameras, largest error by event clock (u):
| event | trace | shots | eye | aim | up point | fov |
|---|---|---|---|---|---|---|
| heri_taijou | w261_heri_a | 8 / 8 | 0.427 (shot 2, start) | 0.215 | 0.427 | 0.065 |
| sk_mituketa2 | w261_sk_a, _b | 7 / 7 | 0.002 | 0.005 | 0.002 | 0.010 |
| roji02_01 | w261_rescue (w229's route) | 2 / 2 | 0.001 | 0.001 | 0.001 | 0 |
heri_taijou's largest are the first frames of its fast moves (a few ms of clock is a fraction of a u there); from f190 on the rest are under 0.04.
Actors (`cmp_event_actors.mjs`, TRACE_EVMP), by event clock: actor matrix row 3 error 0.000 in all three (compared every frame; the events' actors sit at their setpos with the motion in the clip);
clip frame error: sk_mituketa2 2.38 frames at f1736 (the frame of a speed change, block start drift), else under 0.6; heri_taijou 1.20 (f454, a shot's start; p000, e023, w011); roji02_01 0.60. Traced for 400 frames per actor window, not whole events: sk_mituketa2 two windows (f1622-2040, f2332-2750), heri_taijou f150-555, roji02_01 f1440-1845.
MP+0x180 (T w261_skact0, f1640-1650): n013 0x800, e050 0, g000 0: the script's hide_model(11, 0) and nothing by default, as the page.
Image: tools/trace/out/w261/w261_game_vs_page.png (left game, right page). Bottom: sk_mituketa2 f3328, same framing and subtitle. Top: heri_taijou, same shot, not the same instant. Differences seen: no focus blur, Vincent's event body has no cape (top; notes/event-vm-research.md), a third lock of Shelke's hair at the right edge on the page only (bottom; not explained: every list entry but 11 is drawn in both).

## scr005 (ev0143, worker 0261)

**All 10 in PLAYS.** Traces tools/trace/out/w261/w261_s5_* (tools/trace/out/w261/s5*.py, gitignored). "Walked" = a route state replayed up to its Skip, then no input. "Poked" = a route state with stage flag 1 poked (no walked state reaches it unskipped: the route takes other branches): the event is the game's, the way into it is not.
Cameras: `cmp_event_cams.mjs`, largest over the event, by event clock; shots game / page.
| event | way in | shots | eye | aim | up | fov | notes |
|---|---|---|---|---|---|---|---|
| roji01_01 | poked, r03_start | 2 / 2 | 0.016 | 0.001 | 0.016 | 0 | actors below |
| heri_tobi | walked, r03_mid | 2 / 2 | 0.087 | 0.069 | 0.087 | 0 | |
| beast_ev01 | walked, r04_east | 11 / 11 (--jump 5) | 0.795 | 4.414 | 0.795 | 0.011 | largest on one frame, f850, the first of a fast pan; the next largest is 0.163 / 1.186 at f847. Elsewhere under 0.12 / 0.07 |
| beast_ev02 | poked, r05_west | 1 / 1 | 0.000 | 0.000 | 0.000 | 0 | n028's walk below |
| help_people01 | walked, r04_east | 2 / 2 | 0.001 | 0.001 | 0.001 | 0 | |
| help_orei01 | poked, r05_west | 2 / 2 | 0.001 | 0.001 | 0.001 | 0 | |
| help_orei02 | poked, r05_west | 1 / 1 | 0.001 | 0.001 | 0.001 | 0 | flags 39-41 poked; the townspeople weren't up in the game's run (trigger 58 not walked), so nothing of theirs is checked |
| help_orei04 | poked, r07_toujou | 2 / 2 | 0.000 | 0.000 | 0.000 | 0 | window starts mid-shot 0 |
| help_people03 | poked, r07_toujou | 2 / 2 | 0.035 | 0.000 | 0.035 | 0 | |
| help_orei03 | poked, r07_toujou | 1 / 1 | 0.000 | 0.000 | 0.000 | 0 | one branch only (flag 30): the 158-frame stretch; the flags 35-38 branches (n029, n030, n032, n025) not traced |

Actors (TRACE_EVMP) only for: roji01_01 (p000, n033: position 0.000, clip frame 0.60); beast_ev02 (p000 position 0.000; n028's walk ends 0.10 u from the game's (-963.83, 463.48), up to 7.1 u off on the way by event clock, block start drift; the trace window starts after the walk began, so the walk isn't aligned frame for frame). The other 8 events: cameras only, no actor trace.
The page test runs help_orei02 with them up, via trigger 58's event.
No game-vs-page image for scr005: the page's contact sheet is tools/trace/out/w261/scr005_page.png (looked at: each shows its actors and subtitle; nothing compared to a GS dump).

Decoded for it: **getposx / y / z_l** FUN_0037a580 (main's setpos(getpos()): Vincent went to the origin after help_orei02), **get_battle_camera_l** FUN_0037da58 + FUN_00377c68's copy of the view's matrix (main keeps the follow camera through an event: it was all zeros), **isPlayerReadyGun** FUN_003a4420 (game-state bit 8; no page writer found, so 0: the aiming branch isn't reached), **start_anim_l** -> chunk_anim.js, __sv_lock / unlock. Left out, warned: Sound.playBgSound (FUN_003e6d70, help_orei02's end), Actor.set_footnoise_l, the Effect natives, focus blur, pad vibration.
The actor library is now loaded **on demand** (event_actors.js `loadEventActors`: a model on load_l, a pack on loadmotion_l, their handles busy until in, `trim` at battle()): it is 463 MB and an event uses a few models. The opening's are preloaded (its timing is traced with no waits). Exporter: `--only m1,m2` for a partial run; PAIRS / PAIR_MODELS as 0262's.

## Open
- **Flags 35-38 (help_orei03's branches) and 30:** who sets them in a normal run isn't traced.

- **The pause (review fix):** voices hold on the event pause (FUN_003ea9f0 / FUN_003eaa78).
- **Block starts drift.** Inside a block the event clock is exact, but the game's blocks start later than the page's: per shot 0-9 frames (sk_mituketa2: 856 frames against 819).
  The game loses a frame somewhere at waits and synchronized blocks. Two tries in a scratch copy, neither right: monitorenter costs one frame (closer, still 1-8 short); plus every wait one frame (most shots exact, heri shots 0 / 3 two over, sk 2-6 short). Not shipped. Needs FUN_00379d48 / FUN_003a0e48 / FUN_00249088's timing against the VM thread's window, one wait at a time.
  **It moves the music against the picture:** playMusic2 starts once and runs on real time, so by the end of sk_mituketa2 the music is up to 37 frames ahead of where the game has it against the shots (0.74 s).
- **Effects in events**: Effect.load / playseqstr / play / setVisible / stop2 / enableloop / unload are left out (warned). The events show no leaves, sparks, muzzle flashes or screen effects. Their FEDs (a0026, a0028, f0001 ..) are not exported. The biggest visible gap. Also focus blur, shadows, pad vibration, Actor.fog_l (FUN_003a1180 -> slot +0x1e8), setdirofbattle.
- **rv_matiawase's hold + memory-card box**: decoded in checkpoint-research (FUN_003bf250); the box is the checkpoint worker's. Page goes straight on.
- **113 / 114 "reappearing far away"**: T w229_rescue_pos: their +0x28 bit 0 stays clear to the trace's end (f2399), only bit 0x40 changes at the hand-back, so they are off and not drawn; test_npc_page checks them off. Their status position / clip change at f2126 (status not decoded), nothing a player sees. Not a gap.

## scr002 and scr006: heri_toujou, heri_dgsol, heri_lastst, heri_lasted, kita_ev0145 (worker 0262)

All five are in `PLAYS`. Traces in tools/trace/out/w262 (gitignored). Scripts tools/trace/scripts/w262_*.json; states: heri_toujou r06_door3 + w253_box2's answers; heri_dgsol r06_heli + **poke** stage flag 0 = 14 (`TRACE_POKE=a06338=9131920e`); heri_lastst r0b_save, no input (no box comes up); heri_lasted + kita_ev0145 r0b_fight + **poke** flag 0 = 40 (`a06338=9133ba28`), chained windows out/w262/ld1..ld8.p2s (new `TRACE_SAVE=<path>` in trace.py; a few frames are lost between windows). New `TRACE_EVSLOTS` (fields.py; kita_ev0145 has 30 slots), cmp_event_cams `--jump` (fast shots move over 5 u a frame), cmp_event_actors `--lend`, `--mp MODEL#ID`.

Cameras, largest error by event clock (u). Shot counts equal in all five; the game's extra last "shot" is main's own Camera.set.
| event | trace | shots | eye | aim | up point | fov |
|---|---|---|---|---|---|---|
| heri_toujou | w262_ht_0, _a, _b | 6 / 6 | 0.762 | 0.792 | 0.762 | 0 |
| heri_dgsol | w262_dg_a, _b | 9 / 9 | 0.276 | 0.164 | 0.276 | 0.017 |
| heri_lastst | w262_ls_a | 6 / 6 | 0.728 | 0.694 | 0.727 | 0.152 |
| heri_lasted | w262_ld_a, _2, _3 | 24 / 24 | 0.922 | 0.541 | 0.922 | 0.231 |
| kita_ev0145 | w262_ld_3 .. _8 | 20 / 20 | 0.057 | 0.255 | 0.057 | 0.016 |
heri_lasted's shot 12 reads 5.7 eye / 18.9 aim in cmp_event_cams: not real. A window gap falls on its start; aligned by hand inside the shot it is 0.007 / 0.041 / 0.007. **The roll's sign holds:** shots 18-23 (files 139-143) have up point errors 0.001-0.136.
Shots run longer in the game than on the page where it loads from disc (kita_ev0145 shot 1: 306 frames against 275; heri_toujou's last: 350 against 290, the e027 load before its end): the known drift (Open), larger at loads.

Actors (`cmp_event_actors.mjs`, windows of about 390 frames, not whole events): actor matrix row 3 error 0.000 for every actor compared. Clip frame error: heri_toujou e023, p000 3.60; heri_dgsol e023 0.60; heri_lastst e024 0.60, p000 3.00; heri_lasted p000 3.60; kita_ev0145 e027, e048, e024 7.80 on the window's first record, p000 0.60. Compared: e_Heri, p000, g013, g071 / e_Heri, p_Vin, g013, g033 / e_HobH, p000, g013 / e024, p000 / e027, e048, e024, p000, n000, n043. The rest were not traced.

**Lent actors now draw on the page.** getbattleactor hands the object's own MP to the slot, so the event's loadmotion_l / setmotion_l pose it (FUN_00376b00 -> FUN_0056a5e0). The page keeps two bodies: until the slot has a clip the gameplay body stands for it; from the first clip on the slot's body draws (`obj.model`, event_actors.js) and the gameplay body is held off every frame. The hand-back moves enemies now (`place`, FUN_003157b0's status +0x30 / +0x40). T w262_htpos: e_Heri at (0, 0, 0) facing (0, 0, 1) after heri_toujou, up to its flight in battle().

**Export:** `PAIRS` / `PAIR_MODELS` in export_web_event_actors.py: the size filter `fits` let every townsperson's skeleton take every townsperson's file (335 MB and rising), so these events' files go only to the models that load them. Worker 0263's later files still use the size filter.

Open:
- Actor library: no longer loaded whole; worker 0261's on-demand loader (above) replaced it, and test_heri_kita_page passes with it (34 ok, rerun at wind-down). test_warp_page was not rerun after that change, so its earlier "Target crashed" at the boss place and its "room is drawn 3%" fails (places where an event plays at once) are unconfirmed either way.
- **Game-vs-page image is not a same-moment comparison:** tools/trace/out/w262/w262_game_vs_page.png (gitignored). heri_toujou shows different shots (game: Dragonfly over the moon; page: Vincent standing); kita_ev0145 the same beat from a nearby view. Stopped at wind-down with no new grabs, so the numbers above are the evidence, not this image. heri_dgsol, heri_lastst, heri_lasted have page shots only (tools/trace/out/w262/shots).
- **e_para_1..6 in heri_dgsol:** under the flag poke they have no object (T w262_dgac: no slots), so neither game nor page draws them. In real play script 29's event 0x16 drops them first, so they would be lent; that path is not traced. Flag 14's real way (event 0x16's last leg) did not fire in w259_heli's 1420 frames.
- **km0701dj** (kita_ev0145, w003): in file 0x56, tracks for 4 bones on the 5-bone w003 (`fits`); how the game reads it is not decoded. Left out, warned. No clip comes before it, so that gun is in its bind pose.
- **A hidden MP's frame stops in the game** (T w262_kmp_a: e048 stays at 178.2 from its setVisible(0)); the page's goes on. No visible effect in these events: kita_ev0145 restarts the clips with setmotion2 when it shows them again. Not changed (shared by every event).
- Page tests start the beats from aids (`?warp=heritoujou`, `heridgsol`, `chunk0b`, `herilasted` + the trigger's event or a flag): not walked.
- Left out with their warnings, as agreed: effects, chunk animations (start_anim in heri_lasted), focus blur, flash_in, cblur_in, setshadow_l, Effect.changeTargetActor, pad vibration, the event SE bank (loadSoundEffectEx_l).

Review fixes (worker 0262, 2026-11-04):
- **Auto-skip is gone.** Every event main calls is in `PLAYS` (first_event: `PLAYED_ELSEWHERE`); `requestSkip`, the player's Skip, stays. StageVM.invoke does console.error if main calls an event not in PLAYS, and plays it (a stuck stage is worse than a wrong one, and every page test fails on console errors); test_story_cutscenes 3d also reads main's call sites from the data. The tests that want a Skip have their own player (test_stage_controller `make`).
- **Restart at the boss:** a record's reload sends 0x23 after main's first battle() (T w240_init), once, instead of before main with the plug-in off; see the audit row.
- **A lent body stands** until the stage pass (FUN_00344ec0, FUN_00343160's first test, FUN_00558f68 -> FUN_0056a790).
- pause.js left / right read nav4[2] / [3] (FUN_003cbc38 param_3[2] / [3]).

## scr003: first_encounter, rv_toujou, wro_kaisetu (worker 0263)

Decoded and on the page (native -> C function, from the class registry 0x4ef498):
- **move_l** FUN_0039eef8 -> FUN_0037b5b0, command 0xc; slot loop case 0xc (`EventActors.walk`), FUN_00383d10 (`lookRows`). Length = FUN_0037b5b0's five-step sum x 0.1; the 0.1 is confirmed by the trace (below).
- **setmotion4_l** (setmotionChain) FUN_0039f7a8 -> FUN_0037ae98, command 0x22, FUN_00382768 (`EventActors.chain`). **setqt_l** FUN_0039f340 -> FUN_0037b9c8, FUN_00262de0 (`quatRows`, from its VU words). **Light.reset** FUN_003a5200 -> FUN_00269a08.
- **The choice box, window kind 27** (event_window.js `EventChoiceScreen`, layout 0x472c98 'window27'): open_l_str FUN_0039ed48 -> FUN_0037c510, FUN_003d7bd8 (rows), FUN_003da9f8 (cursor bar), FUN_003d9238 / FUN_003d9228 (wrap), getstate_l FUN_003a06b8 -> FUN_00378f10, getvalue_l FUN_003a0398 -> FUN_00378e48, FUN_003b9420 / FUN_003b9450. play.js gives it ✕ ○ up down.
- **Before this, wro_kaisetu under auto-skip hung for ever** (getstate_l missing): the talk polls it until it isn't 0. Skip now answers 2 (kind 0x1b), so it ends.
- **Marker tables with an 'mkd' header**: the exporter's assert took them for no markers, so 24 models had no sockets: n043's rifle (attach marker 15, wro_kaisetu) never drew. No tag test in the game; `export_web_triggers.markers` is used now. A marker with bone -1 is treated as absent (warned).
- `tools/trace/cmp_event_cams.mjs` / `cmp_event_actors.mjs`: `--answers cross,down,..` answers a choice box.

Results, largest by event clock (traces tools/trace/out/w263, gitignored; states r07_walk, r07_e036, r07_toujou; rv_toujou in 11 chained TRACE_SAVE windows, wro_kaisetu from a state grabbed at the open box, gs/s2420):
- **first_encounter:** 10 of 10 shots, eye 0.007, aim 0.008, up 0.007, fov 0.000 (shot 3, f1090). Shot lengths: 0-16 frames short on the page, shots 8 and 9 37 and 39 short. **Corrected (review, 2026-11-04): load waits don't explain shot 8.** Its window opens at +36 (page +25) and the next command comes at +154 (the page's voice ends at +130), so at most the last 13 of the 37 frames can be loads. Shot 5 (no loads in question) is also 15 short, so a general voice or wait drift looks likely; see 'Open'. Shot 9 is roughly a load wait, but the 286 ms hitch at f2546 is near loadSoundEffectEx, which the earlier list left out. The review's frame numbers were not re-measured by this worker.
- **rv_toujou:** 39 of 39 shots, eye 0.053 (shot 18), aim 0.036, up 0.053, fov 0.122 (shot 26). Where these errors come from was not looked into. Shot 16's length is 154 frames short and shot 17's 111. **Corrected (review, 2026-11-04):** load waits hold up after the fadeout's sleep, a voice stream does not, and about 20 of shot 17's 111 frames come before its first load handle: unexplained.
- **wro_kaisetu, answering Nothing:** game 8 shots, page 7: the game's eighth is one frame at the trace's end (f670). Eye, aim, up 0.001, fov 0.000. Down + ✕ (Supplies, w263_wro_supplies): the first three shots agree (0.001), then **the game opens the Shop** (displayStageInfo(4), box kind 32 = 0x20; gssup/g400.png: Buy / Sell / Modify, Vital Rations, Spirit Rations) and waits; traced to 868 frames without input.
- **Actors:** rv_toujou n000 (km0502rv) position 0.000, clip frame 0.60. p000 (km0502vn) position 0.000; the frame stops at 1141.8 when the script hides it (the known 'hidden MP' difference; the script restarts the clip with setmotion, so nothing shows). first_encounter's chain on Vincent: game bv002vn then h_st, clip frame 0.60 (weapon frame 1).
- **Walk:** four runners in wro_kaisetu, row 3 by clock inside each block: 0.85, 3.06, 0.87, 0.19 u, then 1.57, 3.97, 0.16, 0.14 u. The largest (n029) are about 4 frames of walk at about 1 u a frame: probably the known block start drift ('Open'), not confirmed. Stop positions within 0.9 u.
- **The box:** game-vs-page tools/trace/out/w263/w263_wro_box_game_vs_page.png (game f2420 left): same position, title, rows, colours, cursor bar at the last row, by eye; no pixel compare. GS dumps gs/g2330, g2420 kept, not parsed. Keys and row marking are traced only as far as their shots (above): the game's box state isn't in the event fieldset.

Open here:
- **The Shop is not on the page.** After Supplies, stage-info kind 4 has no box kind 0x20 data: stage_info.js warns and closes it at once, so the talk goes straight on and the box comes back with Supplies marked. No buying, selling or modifying. Decoded so far, and an unwired translation: notes/shop-research.md.
- **Voice length: a real difference, cause not found.** One trace (w263_fe_v, TRACE_FIELDSET=event TRACE_EVVOICE=1: the six voice channels DAT_004f7c38 per frame), first_encounter shot 5. Channel from play (+0x1c bit 1) to freed (+4 = 0), by the event clock, against data.voiceMs (row +0x14): 10406sk game 1778 ms (f1469-1558), page 1612, **166 ms long**; 10408sk game 2298 ms (f1593-1708), page 2272, **26 ms long** (a frame's sampling is 20 ms). So not a fixed ratio or a fixed delay: two voices only. It explains about 9 of shot 5's 15 short frames; the rest is unexplained (block start drift above?). The channel is freed in FUN_003ed000's stream code, which was not read; 10406sk and 10408sk's channels were mapped by play order. Other events not measured. Page unchanged.
- The page's Vincent (lent body) has no cape in events and is darker than the game's (the image shows both; 0261 saw the same).
- Effects, chunk animations, focus blur, shadows (setshadow_l, set_shadowalpha, dir -1), pad vibration left out with warnings, as agreed.
- `playBgSound` (FUN_0039de38 -> FUN_003e6d70, wro_kaisetu's last call, an 8-slot positional ambient): left out, unknown native warning. The event SE bank (loadSoundEffectEx_l FUN_003a0be8, asj_154.., asj_334..): not exported, silent.
- first_encounter and rv_toujou actors were traced in windows only (f980-1299, f2340-2559; rv one window of 330 frames); wro_kaisetu's cast by slots, walks only. e050 and n013's clips in first_encounter not compared (their MPs were not identified in the window traced).

## Review fixes on scr005 (worker 0261, 2026-11-04)

- **Actors re-exported in full** (51 models, 470 MB): e048, n017, n018 gain rb, p000 r11; then `--only` e001, e027, n017. `test_event_clips.mjs`: every clip of the 22 PLAYS events resolves, stage flags clear and all 1, keyed by event, except km0701dj in kita_ev0145. **e001:st**: the file (k 0xc) wasn't in disc.py INPUTS: fixed. **e027:r_stlaf0**: `fits` was too strict for a character's own file (22 bytes short with all 46 bones read; the same file has 24 and 38): allowed; L: checked only by a GS dump fit (enemy-placement.md, RMS 1.52 u at f15). **n112:st2**: not a bind pose: play.js battleObject gives no object without an AI actor and n112 isn't in AI_TYPES / NPC_TYPES, so e_Shc gets no slot and is left out (warned); the test now uses that rule.
- **Motion sets behind loadchr:** p000's k 0x11 holds a different copy of bv002vn, bv000vn0, bv003vn than file 13 (same frame counts, bytes differ). loadchr's bytecode builds mask |= 1 << k -> FUN_00409460 -> FUN_0030bf90. event_actor_rt.js findClip gates k >= 0xe on that mask (bit k - 0xa), character sets before event files (FUN_005a7390). k < 0xe aren't gated: the stage's own loads of them aren't all in the scripts.
- **Lent actors:** getbattleactor asks for the model, loadmotion_l holds until model and pack are in, the gameplay body hides only once the slot's body exists. A clip with no loadmotion (resident) can still start while the model loads, as the game has no handle there.
- **Restart with no record:** the opening's models and files stay through `trim`. They stay resident (37 MB).
- **isPlayerReadyGun:** bit 8 set / cleared in aim_core.js draw / holsterCore (FUN_00576548). A stage reload clears both: weapon.reset() the drawn state, FUN_00325a50 -> FUN_0036b560 the bits.
- **Skip:** under Skip the page's load_l (mode bit 1, FUN_003837d0) and loadmotion_l (skip 2 with bit 0, FUN_00382220) are passed by, with no fetch or hold.
- **A failed pack** is marked, warned once and skipped; `trim` clears failed marks, so the next event retries.
- **FUN_00261d88:** flags 1 with b != 0, 3 with b 0 (bit 1 clear = loop), as chunk_anim.js `play`; it also zeroes each track's +2. chunk_anim.js keeps no per-track flag to clear: read, not traced.
- Tests: test_scr005_page checks real bodies with triangles in the scene, and models freed after battle(); page mutants noensure, notrim, keepopen. test_story_cutscenes: load holds, getbattleactor's ensure, bit 8 (mutants loadhold, motionhold, lentensure, gunbit). **Not tested:** the gameplay body staying visible while a lent model loads, the failed-pack path, Restart replaying the opening end to end (only the models staying in).

## Effects in events: not done, nothing on the page (worker 0261, 2026-11-04; wound down at Dan's request)

All wiring was taken out; the natives still warn as left out. A scratch copy of the draft native module is in this session's scratchpad only, and was never verified on the page. What the code says:
- **Natives -> C:** load 3a2580 -> FUN_0037f2f0 (command 0x18 -> FUN_00381a08; skip != 0: 0x7fffffff), unload 3a24c0 -> FUN_0037f568, strid2numid 3a1e58 -> FUN_002f5238, playseqstr_l 3a1ea8 -> FUN_0037fb88 -> FUN_0037f728, playseq_l 3a1f78, setVisible_l 3a21c0 -> FUN_00379760, stop2_l 3a1638 -> FUN_00379808, enableloop_l 3a2038 -> FUN_00379680, play_l 3a2640 -> FUN_00375f98 -> FUN_00380ca0 -> FUN_002e29b8 (play_screen: not read), setFocusBlur 3a2090.
- **Data:** Effect.load(n) = data/effect/anything/a(n // 50 x 50)/aNNNN/fer/aNNNN.fed, base id 0x80000000 | n << 18. Called with n = 1, 4, 5, 6, 12, 15, 26, 27, 28, 38, 51, 84, 111, 114, 136, 288-299, 304-307, 314. All 32 total 6.8 MB. first_event's 288 .. 294 and beast_ev01's 289 .. 295 are variants of a language pick that wasn't read.
- **Names:** 'FEDEF_' + letter + 4 digits (FUN_002df168: a 8, e 4, f 2, g 9, l 10, m 7, n 5, o 1, p 3, r 0, w 6, x << 28 | n << 18) + '_' + the FED's table: header +0x18 -> u16 +4 count, entries of 12 at +8: id, u16 sum, u16 length, name offset from the table.
- **Managers (FUN_002f0878):** id >> 28 = 8 -> DAT_004ee4a0 (a separate manager, on the page another createEffects on the shared rng), 2 -> the level's (fxStage), 0, 3-6, 9, 10 -> fx. The E FEDs (E0023, E0024) aren't on the page.
- **Lists:** an id with bit 0x200 (most LEAVES_*) is a list: header +0x20 table, +8 + 4 k = record rel table, record +6 count, +8 ids rel the FED (FUN_002e62b0, FUN_002e8830).
- **Sequences (FUN_00382cd8):** times in 1/60 s (ms x 0.06, FUN_003787d0) since the item before. Types via the jump table 0x4a3520: 0 play (FUN_00375db8 on the actor, FUN_0037f400 without), 1 stop (FUN_002e6be0), 2 / 3 loop on / off, 4 / 5 show / hide (FUN_002ebfb8, +0x0a bit 2), 6-9 FUN_00255180 / FUN_00255170, 10 FUN_003826d8; 0xb .. 0x1c FUN_00382a48 (the pad). Under Skip only the types in DAT_0046f588 (0-5, 10) with ids in the two resident managers.
- **Attaching (FUN_002e80e0, FUN_002e7cd0 mode 1):** param +8 -> bind record (rel the param): u16 +0 flags, +6 bone spec (FUN_002db448: >> 12: 0 skeleton bone, 1 marker), +0xa frame limit. M = scale x euler + place, then by param +4 bits 0x20 / 0x40 through the bone / MP matrices; a kid goes through its parent's socket (FUN_00375ce0). Mode 2 is a chunk node (FUN_00269530).
- **Stop / hide:** FUN_002ed768 and FUN_002ed828 queue to FUN_002edd28 (2 = remove at once, 3 = visibility bit).
- **The engine's gaps** (headless scan of those FEDs, effects.js warnings): channel types 26, 46, 54, 58, 63, 106, 111, 113, 121; render category 255; type 21 spawn shapes 7, 8; type 11 data +0x15 (FUN_002f93d8); draw type 110; camera-1 emitters need a screen layer as menu_fx.js. a0028 (sk_mituketa2) has the fewest. So even wired, many event effects won't draw until these are decoded. None of this was compared with PCSX2.

## Block start drift: not done (worker 0261)

Findings stand as in 'Open' (two scratch tries failed). Added by the review: beast_ev01's camera 2 shot (f793-917) runs 125 frames in the game against 90 on the page, which `--jump 5` split into pieces: its last stretch holds 35 frames longer in the game (f850-917 against 33). Not explained. Its f850 aim error (4.4 u) is a fast pan (25-30 u a frame) with the clock off by a fraction: not a defect.

## Event sounds and mouths vs voices (worker 0266, 2026-11-08)

Dan's reports: "some sounds are missing from the cutscenes" and "dialogue still doesn't line up with the mouth movement".

**Event SEs (the main gap).** Every event's foley track (asj_041 .., asj_154 .., asj_181 .., asj_246 .., asj_301 .., 162
setSoundEffect calls in the stage's classes) was silent: the names have rows in the zone's sdb (asj_154 = id 50026), but
their programs are not in the zone's sep.bin. loadSoundEffectEx_l(a, b, c) (FUN_003a0be8 -> FUN_00378d40: command 0x10 ->
FUN_003825e8) loads them: a 0 -> FUN_002508b0(b) + c = 0x0c000800 + b x 0x1000 + c; every event passes (0, 100) at its start
= file **0x0c064800** (177 programs, bank 0), and (1, 100) at its end = FUN_00250970(zone) = the zone's sep.bin; a 2 ->
FUN_00250a48 (unused here). FUN_003e78a8(mgr, 1, code, 0) = request 4 -> FUN_003e79a8: the file **replaces SE block slot 1**
(the zone's, loaded there by FUN_00402220); slot 0 is the resident block (FUN_00244db0). So inside an event the zone's
gameplay SEs are not found, as in the game. Page: extract.py se_ev100.json, audio.js `seBlock1` / `program`.
- setSoundEffect (release 1) frees the slot at once and the SE plays to its end (rows 0x20); setSoundEffectLoop (release 0,
  wro_kaisetu's asj_335 .. 339, rows 0x28 with bit 3 = stop on release) keeps it until unsetSoundEffect (FUN_0039ff08 ->
  FUN_003e90d0 -> FUN_003e9830: request 0x12, the fade). Skip (FUN_00372f70) stops none of them (FUN_003e9950 = stream slots,
  flag 0x4000). The event SEs run up to 14 s, so the page streams them (event_sound.js `EventSeSlots`, SeStream).
- **playBgSound(name, vol)** FUN_0039de38: the position is zeroed by `sq zero, 0(a1)` at 0x39de78 (Ghidra drops it) ->
  FUN_003e6d70(name, origin, no object, vol): an entry of the placed-sound table DAT_004f5920, no pan (|pos| 0 -> flag 0x8000),
  volume fixed at vol (FUN_003e6ec8 keeps entry +8 for an entry without an object). The next event start (FUN_0037e048 with
  mode bit 0 clear) releases the whole table (FUN_003e6538), the stage's placed sounds included. wro_kaisetu ends with asj_030,
  help_orei02 with asj_031 (zone programs, played after the (1, 100)).
- **set_footnoise_l(id, b)** FUN_0039e2a0 -> FUN_0037ed60: MP+0x428 bit 3, the gate of the footfall test FUN_005ae828. Event-
  loaded models start with it clear (FUN_00380370), lent actors keep their gameplay MP's (set at hand-back, FUN_00376938).
  help_orei04 only turns it off; the page plays no event actor's footfalls, so nothing changes. **Open:** lent actors' footfalls
  in events (Vincent / soldiers walking in an event clip) are not played on the page.
- flushSoundEffect (main pc 10975, after heri_lasted) FUN_0039dd10 -> FUN_003e6fc8 (the area / surface sound re-send): still
  left out (unknown native warning).
- Natives addresses from the registry in RAM (method entry +0xc, hash +0x10; state w263 rv10): set_footnoise_l 0x39e2a0,
  playBgSound 0x39de38, loadSoundEffectEx_l 0x3a0be8, unsetSoundEffect 0x39ff08, flushSoundEffect 0x39dd10, playVoice2 0x3a0880.

**Mouths vs voices.** Only first_event (the opening: startanim "00" on g000, 10110sk) and sk_mituketa2 (startanim "00", never
stopped; 10401sk .. 10404sk) animate mouths (texanm flipbooks, drawn at once). The voices go out through the PCM ring:
FUN_003ed000 mixes a 1024-sample block (21.3 ms) into the EE ring DAT_0047d754 (8 slots, 7 queued when full), FUN_003ed8e0
sends the oldest into the IOP's 16-slot buffer unless the slot is playing (FUN_0041ad50; DAT_0047d768). FUN_003eab20 mixes
nothing for a voice's offset-0 frame. Traces (TRACE_FIELDSET=lipsync, TRACE_CALLLOG=lipsync; scripts w266_open, w266_sk):
| | startanim 00 | playVoice | EE queued at the voice's first block | IOP slots ahead |
|---|---|---|---|---|
| T w266_open (first_event) | f1365 | 10110sk f1388 (+23) | 7 | 15.25 .. 16 |
| T w266_sk (sk_mituketa2) | f1587 | 10401sk f1991 (+404), 10402sk f2376 (+789) | 7 | 15.25 .. 16 |
| page (node, sk_mituketa2) | f879 | +372, +736 | - | - |
Every frame of both windows has the EE ring full and the IOP 15.25 .. 16 slots ahead, so a voice is heard **6 + 15.5 + 1 =
22.5 blocks = 480 ms** after playVoice, while its mouths start at once. The page played the voice at once (plus its decode):
the voice came **about 480 ms early** against the mouths (less the browser's decode time). Fixed: event_sound.js `VOICE_PIPE_S` (start, the event pause's hold and
Skip's stop all act through the queue: what was mixed plays on for 480 ms).
**Still off (largest errors):** the event clock between the mouth and the voice: opening +19 frames on the page vs +23 (the
loadchrs(1, 5) before `sleep(393)` waits for its load in the game: the known 'event loads' row); sk_mituketa2 +372 / +736 vs
+404 / +789 (32 and 53 frames short: the known short shots / block start drift, not looked into here). Not compared against
PCSX2 audio output: the delay is read from the ring state, the SPU2's own buffering is not counted.
