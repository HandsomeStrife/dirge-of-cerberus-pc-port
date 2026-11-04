# Story cutscenes: every event in ev0100 `main`, and how to make one play (worker 0261, 2026-11-04)

The list, in the order the story reaches each event (main's code order; beats and places: notes/stage-controller.md 'Beats').
"Plays" = in `PLAYS` (stage_controller.js) or played elsewhere. Everything else is auto-skipped (GUESS, audit 'GUESS: auto-skip').
Class = the export's name; scrNNN = the file's script (ev0100 scrNNN). pc = main's call site.

| # | event | class | pc | runs when | plays? | story path it changes |
|---|---|---|---|---|---|---|
| 1 | first_event | ev0101 (scr001) | 745 | stage 0 = 0, global 1 < 3 | yes, the opening (intro.js) | isSkip -> kalm_ld(100) |
| 2 | rv_matiawase | ev0101 (scr001) | 1216 | stage 0 = 2, global 1 < 5 | yes (0248) | none (no isSkip test) |
| 3 | roji01_01 | ev0143 (scr005) | 1932 | stage 1 sub-beat | no | |
| 4 | roji02_01 | ev0143 (scr005) | 2276 | stage 1 = 5, flag 12 < 1 (the rescue) | no | |
| 5 | beast_ev01 | ev0143 (scr005) | 2668 | stage 1 sub-beat | no | |
| 6 | beast_ev02 | ev0143 (scr005) | 3101 | stage 1 sub-beat | no | |
| 7 | heri_tobi | ev0143 (scr005) | 3426 | stage 1 sub-beat | no | |
| 8 | help_people01 | ev0143 (scr005) | 3833 | stage 1 sub-beat | no | |
| 9 | help_orei01 | ev0143 (scr005) | 3974 | stage 1 sub-beat | no | |
| 10 | help_orei02 | ev0143 (scr005) | 4401 | stage 1 sub-beat (3 args) | no | |
| 11 | heri_toujou | ev0103 (scr002) | 5162 | stage 0 = 13 | **yes (0262)** | |
| 12 | heri_dgsol | ev0103 (scr002) | 5438 | stage 0 = 14 | **yes (0262)** | |
| 13 | heri_taijou | ev0103 (scr002) | 5756 | stage 0 = 16 | **yes (0261)** | **Skip in it: main's pc 6355 jumps past sk_mituketa2** |
| 14 | sk_mituketa2 | ev0101 (scr001) | 6366 | right after 13, only if not skipped | **yes (0261)** | never played before |
| 15 | first_encounter | ev0141 (scr003) | 6887 | stage 0 = 20 | no | |
| 16 | rv_toujou | ev0141 (scr003) | 7152 | stage 0 = 24 | no | |
| 17 | help_orei04 | ev0143 (scr005) | 8938 | stage 1 = 28.. | no | |
| 18 | help_people03 | ev0143 (scr005) | 9302 | stage 1 = 29.. | no | |
| 19 | help_orei03 | ev0143 (scr005) | 9771 | stage 1 = 30.. | no | |
| 20 | wro_kaisetu | ev0141 (scr003) | 10226 | stage 1 = 32 | no | |
| 21 | heri_lastst | ev0103 (scr002) | 10609 | stage 0 = 36 | **yes (0262)** | |
| 22 | heri_lasted | ev0103 (scr002) | 10949 | stage 0 = 40 | **yes (0262)** | **Skip in it: main's pc 11079 jumps past kita_ev0145** |
| 23 | kita_ev0145 | ev0145 (scr006) | 11082 | right after 22, only if not skipped | **yes (0262)** | plays when 22 is not Skipped |

Not called by anything in the stage's classes: run_people02, run_people03 (ev0143), private_ev (ev0142). Only three isSkip tests exist,
all in main (pcs 754, 6355, 11079); no event tests it itself.

## The pattern: making an event play (what to do, what to check)

Do these per event, in this order; `heri_taijou` / `sk_mituketa2` / `roji02_01` are the worked examples. Scratch tools: a JVM disassembler is easy
(the export's `classes[..].cp` + `methods[..].code`); `tools/trace/cmp_event_cams.mjs`, `cmp_event_actors.mjs` compare.
1. **Read it.** Disassemble the event. List its models (`load`), motion files (`loadmotion`), cameras (`Camera.load`), voices (`loadVoice2`), natives.
   Natives missing: run it headless (`new StageRuntime(data, { autoSkip: false, warn })`, `vm.start(cls, name, desc, [])`): the warnings list them.
   C addresses: class registry DAT_004ef498 in any state, 32 slots of 0x38 (+0x10 method count, +0x30 methods of 0x18: +0x0c C function, +0x10 hash
   (FUN_003a8828(desc) << 16 | FUN_003a8828(name))).
2. **Data.** Models and motion files: `export_web_event_actors.py` FILES / MODELS (reads the stage classes' strings, `--stage`) + tools/byo/disc.py INPUTS.
   Voices: tools/audio/voice.py default `--names` + build_web.sh's keep list + disc.py. Subtitles and voice lengths are already all in the stage export.
3. **Natives.** Translate with the citation; a native that can't be done now warns and is listed in fidelity-audit.
4. **Skip branches and press points.** `PLAYS` in stage_controller.js. Check main's code around the event: what an unplayed event before it does to it
   (`isSkip`), and `nextEvent` (auto-skip stops at main's wait when the next event plays).
5. **Trace it unskipped** from a walked state (notes/route-states.md), TRACE_FIELDSET=event (cameras, clock), then TRACE_FIELDSET=evactor with TRACE_EVMP (actors).
   `TRACE_LOG_AT` so the log fits: the error message says what fits; split long events into windows of the same run. Route skipped most events: replay the
   route's script up to its Start press, then no input. scene_save's box needs its answers: hold (+0x1558 bit 39) + 300 right, + 320 ✕, + 380 left, + 400 ✕, + 500 ✕, + 600 ✕.
6. **Check:** `node tools/trace/cmp_event_cams.mjs CLS.METHOD TRACE --from F`: same shot count, errors per shot by event clock. Then actors. Then the page:
   `test_story_cutscenes_page.mjs` shows the shape (warp aid, what's drawn, Vincent hidden, position after), and one game-vs-page image.
7. **Add it to** `PLAYS`, this table, test_story_cutscenes.mjs (a user's path through main), the audit, and turn its auto-skip off.

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

## Open

- **Block starts drift.** Inside a block the event clock is exact, but the game's blocks start later than the page's: per shot 0-9 frames (sk_mituketa2: 856 frames against 819).
  The game loses a frame somewhere at waits and synchronized blocks. Two tries in a scratch copy, neither right: monitorenter costs one frame (closer, still 1-8 short); plus every wait one frame (most shots exact, heri shots 0 / 3 two over, sk 2-6 short). Not shipped. Needs FUN_00379d48 / FUN_003a0e48 / FUN_00249088's timing against the VM thread's window, one wait at a time.
  **It moves the music against the picture:** playMusic2 starts once and runs on real time, so by the end of sk_mituketa2 the music is up to 37 frames ahead of where the game has it against the shots (0.74 s).
- **Effects in events**: Effect.load / playseqstr / play / setVisible / stop2 / enableloop / unload are left out (warned). The events show no leaves, sparks, muzzle flashes or screen effects. Their FEDs (a0026, a0028, f0001 ..) are not exported. The biggest visible gap. Also focus blur, shadows, pad vibration, Actor.fog_l (FUN_003a1180 -> slot +0x1e8), setdirofbattle.
- **Chunk animations**: start_anim_l isn't drawn (above).
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
- **The page loads the whole actor library at start** (loadEventActors): now 36+ models, 463 MB on disk. test_warp_page's renderer crashed once at its boss place ("Target crashed"). Loading per event as the game does (load_l) is the fix; not done here.
- **e_para_1..6 in heri_dgsol:** under the flag poke they have no object (T w262_dgac: no slots), so neither game nor page draws them. In real play script 29's event 0x16 drops them first, so they would be lent; that path is not traced. Flag 14's real way (event 0x16's last leg) did not fire in w259_heli's 1420 frames.
- **km0701dj** (kita_ev0145, w003): 4 bones' tracks on the 5-bone w003; how the game reads it is not decoded. Left out, warned: that gun keeps its last pose.
- **A hidden MP's frame stops in the game** (T w262_kmp_a: e048 stays at 178.2 from its setVisible(0)); the page's goes on. No visible effect in these events: kita_ev0145 restarts the clips with setmotion2 when it shows them again. Not changed (shared by every event).
- Page tests start the beats from aids (`?warp=heritoujou`, `heridgsol`, `chunk0b`, `herilasted` + the trigger's event or a flag): not walked.
- Left out with their warnings, as agreed: effects, chunk animations (start_anim in heri_lasted), focus blur, flash_in, cblur_in, setshadow_l, Effect.changeTargetActor, pad vibration, the event SE bank (loadSoundEffectEx_l).
