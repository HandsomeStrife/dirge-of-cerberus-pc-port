# First level (Sea of Flames) — what it is and what the page still lacks (worker 0211, 2026-11-02)

Scouting only; no game code changed. Scratch scripts (gitignored, worker 0211 scratchpad): `evscan.py` / `evdis.py`
(ev0100 class list + JVM disassembler on kel_class.py), `reach2.mjs` (walk-mesh reachability), `recbin.mjs`
(records / triggers per chunk), `walk_page.mjs` / `trig_page.mjs` (headless play.html walk and trigger pass).

## 1. What "the first level" is (decoded)

- **One stage, one zone.** Stage 0x80 (FUN_003ff0c0 stage byte = 0x80) runs the stage program file **06800000**
  (FUN_00402220: file id FUN_00250940(stage) = 0x06000000 | stage << 16; 16 commands of 16 B, interpreter
  **FUN_00401b90**). Title "カームの街"; commands 0xd, 0xc, 5, 1 (e027), 0x11 x7 (event 100 scripts 1..7),
  4 / 0xa (event 100), **0 = area load FUN_003ff7a8(0x80, 1, 2)**, **6 = the stage loop FUN_004012c0**. There is no
  second area-load command: the whole chapter is zone **z128**. When the loop returns 1/3/4/5 the index moves past
  the last command and the program ends (stage cleared); 6 = restart (worker 0201), 7 = loop again.
  Which stage comes next is not decoded (FUN_00247508 / the request below); by the stage files' own titles the
  next story stage is likely 0x82 (06820000, 荒野); 0x81 (06810000) is the tutorial.
- **Sub-areas = z128's 13 chunks** (0680AA10/11/12/14, AA = 00..0c). The event controller streams them with
  `load(128, a, b)` (FUN_002673d8(zone, a, b) under FUN_003ff7a8): (1, 2) at the start (first_event, kalm_ld),
  (2, 3) in rv_matiawase, (6, 7) twice mid-level, (10, 11) before the ending event. Area streaming between those
  points (FUN_002677a0) is not traced.
- **Route** (walk mesh, DCOL file index = chunk): **02 → 03 → 04 → 05 → 06 → 07 / 08 → 09 → 0b**, linked by the
  0x02 chunk-crossing polygons at about (-828,-16,-604), (-1380,0,-190), (-1009,0,594), (-1335,-40,1078),
  (-1739,0,1577) / (-937,0,962), (-202,-40,522), (207,-100,1467). Chunks 00, 01, 0a, 0c have no walk polygons
  (likely: 01 = start-deck geometry with its walk mesh in 02; 0a = the ending event's area, by the (10, 11)
  load; neither checked).
- **Story order** = ev0100 scr000 `main` (0c064000; JVM bytecode, decrypted by kel_class.py). It is a state
  machine on event flags 0 (major) and 1 (minor). Each beat: `set_usercontrol(0)`, an event method,
  `chaos` + `set_usercontrol(1)` + `battle` (wait for the flags), `peace`, `playMusic3`. Order:
  1. first_event (scr001, opening; **worker 0210**) → battle on the start deck
  2. rv_matiawase (scr001) → scene_save → chaos/battle → kalm_ld(0)
  3. roji01_01, roji02_01 (scr005, alleys) → battles
  4. beast_ev01, beast_ev02 (scr005) → battles
  5. heri_tobi (scr005) → battle; help_people01, help_orei01, help_orei02 (scr005) → battles, displayStageInfo
  6. kalm_ld → scene_save → heri_toujou, heri_dgsol, heri_taijou (scr002, the helicopter) → battles
  7. sk_mituketa2 (scr001) → battle; first_encounter (scr003) → battle; rv_toujou (scr003) → scene_save
  8. help_orei04, help_people03, help_orei03 (scr005), wro_kaisetu (scr003) → battles
  9. kalm_ld → scene_save → heri_lastst (scr002) → **boss** (camera at (551.1,-108.6,1451.3), bgm_014, asj_034)
  10. **Level end**: peace, fadeout, heri_lasted (scr002), load(128, 10, 11), kita_ev0145 (scr006),
      setflag(13, 99), **endSection**, displayStageInfo(2). Then the stage loop returns and the program ends.
- **Flags come from the stage scripts.** Manager cmd **0xb** = FUN_003ff658(stage, N, v): event flag N = v (stored
  XOR DAT_0047dbf0, skipped when the player is dead or for flag 10 under mode 0x11). 06800001 scripts send it on
  triggers (event 0xd), deaths (0x17) and activations (3): e.g. script 15 ev 0xd flag 1 = 6, script 13 ev 0x17
  flag 1 = 10, script 0 ev 0x22 / 0x23 flag 63. `tools/stage_events.py 06800001.bin --cmds 0xb` lists all.
- **Level-end path in the ELF:** event VM request type 0x14 in FUN_00377c68 → FUN_00241ed8(stage, a, b, 0)
  (next stage request; DAT_004b8ba8) → FUN_004012c0's default case returns 1 (FUN_00241ea0) → FUN_00401b90
  ends the program. The results "Status" screen (seen at f1508 in worker 0201's trace) and the next stage's
  "Now loading" title follow (FUN_00247508).

## 2. Per chunk: what the game has (section-1 records, trigger volumes) and what the page shows

Records binned by the walk polygon under them (`~` = nearest, off-mesh). Page = play.html, headless, this checkout.

| chunk | records (model x count) | triggers | page |
|---|---|---|---|
| 02 start deck | p000, e027 18, e048 5 | 32 | the only area the page was built and tested for |
| 03 | e027 23, e030 9, e048 6, e023 1, NPCs n023/024/025/026/031/033 x 12 | 43 | walkable; soldiers wake (see below) |
| 04 | e027 29, e030 11, e048 3, g001 1, NPCs 2 | 36 | walkable; soldiers wake |
| 05 | e027 12, e048 2, e030 1, NPCs 4 | 24 | walkable |
| 06 (market) | e027 22, e048 8, NPCs n017 x8 + 6 others | 36 | walkable |
| 07 | e027 14, e001 1, e036 1, n112 (~) | 19 | walkable; **big black panels** in view |
| 08 | e027 4, e048 3, e030 2, n017 3 | 17 | walkable |
| 09 | e027 4, n017 2, e023 (~) | 13 | walkable; **a flat orange wall fills the view** at (22,-40,797) |
| 0b (boss) | e024 1 (HP 30000, rec 32) | 12 | walkable; boss not on the page |

Headless results (scratchpad walk_montage.png, 9 views): Vincent stands and runs in every chunk, collision
holds, textures load everywhere. Calling the page's own trigger test (enemy_ai `tick(1, far, centre)`) on each
entry volume woke records 3-8, 15-32, 50-61, 64-74, 87-102 (about 60 bodies by the end). So the stage scripts
already run on the page beyond the start deck; what stops the level is everything around them (below).
Console warnings in that pass: manager cmds **0xb, 0x6, 0x40** and object cmds **0x10a, 0x10e, 0x113, 0x133,
0x141, 0x142 (to an inactive record), 0x14a, 0x155** not translated; NPC record 113 (n023) activated with no
body and no AI.

## 3. Work items, prioritised (what a player notices first)

Sizes: S = under a session, M = one worker-night, L = several. "Files" = what the item edits (for parallel runs).

### P1. Stage-script commands the page skips (event flags first) — S/M
- Missing: manager **0xb** (flag write; without it flags 0/1 never move, so script 0's flag-0 branches and every
  flag-gated wake are dead), 0x6 (FUN_003e6c88 / FUN_003e8708: sound), 0x40 (FUN_0053c088 → FUN_0053d960);
  object 0x10a, 0x10e, 0x113, 0x133, 0x141, 0x142, 0x14a, 0x155.
- Leads: FUN_00545b20 (manager), FUN_0054cd70 / FUN_005661e8 (object), FUN_003ff658 / FUN_003ff738 (flags).
- Evidence: a trace with `TRACE_FIELDSET=enemy` (evt_flags / evt_key fields exist) running from the save into
  trigger 15's volume (sets flag 1 = 6) and killing record 41-class soldiers (ev 0x17 writes).
- Files: enemy_ai.js (manager / object dispatch), test_enemy_ai.mjs. **Conflicts with P6, P8.**

### P2. Visual defects outside the start deck — M
- Missing / wrong: chunk 09 shows a flat orange wall across the view at (22,-40,797) looking +z; chunk 07 has
  large black panels near (-1780,-44,1595). Likely unbound or wrongly bound packets (the binding is dump-grown
  from start-deck GS dumps; nothing past chunk 02 was ever graded), or visibility-group surfaces (+0xaa, mask
  near EE 0x004e87..) that the game hides.
- Leads: export_z128_room.py (EXCLUDE_PACKETS, BIND_OVERRIDE), chain header +0x98 texture slot (worker 0051),
  +0xaa visibility group; page Report (R) picks give chunk / packet per pixel.
- Evidence: a PCSX2 GS dump in chunk 09 and 07 (needs a save state there: play the route, or poke flags and
  teleport), graded with gsrender2 as for z128_hero.
- Files: native/assets/models/export_z128_room.py, room data. Independent of everything else.

### P3. The stage controller (ev0100 scr000 `main`) — L (split it)
- Missing: no story beats, music changes, checkpoints, objectives or level end. The JVM VM (FUN_003ad288,
  table 0x470b80) and the natives it calls: getflag / setflag, battle / peace / chaos, set_usercontrol,
  set_battlecontrol, load / kalm_ld / loadchr(s), playMusic3 / changeMusicVol / playBgAreaSound, scene_save /
  wait_save, displayStageInfo, setSkipMode / isSkip, endSection.
- **In progress (2026-11-02): worker 0210 is writing the JS event VM** (native/web/event_vm.js, event_rt.js,
  notes/event-vm-research.md, uncommitted): FUN_003ad288 dispatch, FUN_003a99f0 calls, and the native binding
  (the `fake/*` Kerberos* library of 15 class images in the ELF at 0x383f20..0x39bfa0). P3 should build on it,
  after 0210 lands, not start a second VM.
- **Older work:** native/script/ also has a C JVM subset (`jvm.c`, `jvmrun`, `jvmbatch`: 220/268
  scripts run clean), the class reader (`classfile.c`, `dcc`) and the bridge list of 281 natives in 11 Kerberos
  classes (`bridge.c`, `bridge_engine.c`, `engine_bridge_api.txt`; STATE-OF-THE-PORT 'SCRIPTS'). The page needs a
  JS (or wasm) twin of that VM, with the natives translated from the game (not the C bridge's stand-ins).
- Split: (a) interpreter + native binding (method +0x0c binding in FUN_003a9c58; worker 0205 found the natives
  are not bound by name) — M; (b) the beat loop with every event method run as **skipped** (the game's own ✕-skip
  path: setSkipMode / isSkip), so the level progresses without cutscenes — M; (c) cutscenes, see P9.
- Evidence: trace the flags 0 / 1 / 13 / 18 / 19 and the music name across one beat (start deck cleared →
  rv_matiawase → chunk 03) from the save; check which ✕-skip branch each event takes.
- Files: 0210's event_vm.js / event_rt.js + a new stage_controller.js, a new exporter (reads 0c0640xx at build time; add to
  build_web.sh / disc.py INPUTS), small play.js hook. **Coordinate with 0210** (kel_class.py, export_web_event.py,
  the opening event). Depends on P1 for flags to move.

### P4. NPCs (townspeople) — M
- Missing: 30-odd n0xx records (n017 x13, n023-n034) get no body and no AI; the help_people / help_orei beats
  are about rescuing them. Models n0xx are not exported.
- Leads: export_web_enemy.py (model export), enemies.js `add`, section-0 parameter sets (n0xx names, HP),
  their scripts (`stage_events.py --dis N` on each record's +0x04 script), AI mode at section-1 +8.
- Evidence: one GS dump with townspeople in view (chunk 03 or 06) for placement / colour; a trace of one NPC's
  actor state after its wake.
- Files: export_web_enemy.py, enemies.js, enemy_ai.js (no-AI body path). Conflicts with P1 / P6 in enemy_ai.js.

### P5. Ammo, reload, items and the HUD item list — M/L
- Missing: the HUD shows static 18/18 180 and "Potion 2"; no magazine count, no reload (aim_core states 5-11 not
  on the page), no item use, no pickups, no drops (fidelity-audit 'Item drop effect 0x4800': FUN_0055cac8 →
  FUN_00316d70 → FUN_00541688, 3600-frame life FUN_00580c10), no "MES_ITEM_xx" message (displayStageInfo(6)).
  Section-1 +0x58..+0x60 hold per-record drop items.
- Leads: FUN_00579570 (weapon states), FUN_003320c0 (input: L1 / materia / reload), bgd.bin sections 5 / 12
  (ammo item, actions-research.md), HUD slots 6 / 8 (hud-research.md), FUN_00316d70.
- Evidence: traces: fire a magazine dry + reload; kill a soldier and pick up the drop (HP / ammo / item fields).
- Files: aim_core.js, aim.js, hud.js, hud_core.js, new items.js, enemy_ai.js (drop on death). Split ammo/reload
  (aim + hud) from drops/pickups (items + enemy_ai).

### P6. Other enemy types and the boss — L
- Missing: e023 (records 31, 87; HP 22800 / 30000; likely the beast_ev beasts), e036 (rec 80), e001 (rec 1,
  HP 9999, event actor), **e024 boss** (rec 32 at (517,-100,1231), HP 30000; heri_* events, kita_ev0145 loads
  it), and the event-spawned e056 / e057 / heli soldiers (kalm_ld loads them; spawners FUN_0053d610 /
  FUN_0053d888). The page has glbs for e001 / e023 / e024 / e036 but no AI actor (audit MISSING rows).
- Leads: stances 0x1e / 0x19 / 0x1a / 0x10 (enemy-ai-hook.md 'Other types'), FUN_00558790 class, the boss method
  in scr000 (`boss` on the camera object).
- Evidence: traces at each fight (needs save states there: P3 or flag pokes).
- Files: enemy_ai.js (new brains), enemies.js. Conflicts with P1 / P4.

### P7. Music, area ambience and positioned sounds — S/M
- Missing: only bgm_001 plays; main switches bgm_012 / bgm_013 / bgm_014 (boss) / bgm_018 (kita_ev0145) and
  area sounds asj_033 / asj_034; the music crossfade (FUN_003ec0d8) is not translated (music.js warns). Stage
  section 22 (34 x 0xc0) holds positioned ambient sounds asj_029..asj_045 / se_003 — not read by the page.
  Section 26 (11 x 0x3f8) = footstep sound sets (fsj_xxx; audit MISSING 'footstep fsj_057').
- Leads: playMusic3 → FUN_003a0198 (music.js), changeMusicVol → FUN_003ed740, section 22 reader (manager
  table +0xfac, FUN_00548788), section 26.
- Evidence: an audio trace (existing w172-style call log) walking past one section-22 emitter.
- Files: music.js, audio.js, new export step (section 22 / 26). Independent (the bgm switch itself needs P3).

### P8. Mid-level checkpoints and Restart — S/M
- Missing: scene_save / wait_save at each beat (flag 18) write the checkpoint record; the page always restarts at
  the stage start (checkpoint.js CHECKPOINT).
- Leads: FUN_003ff028 / DAT_004b2680 (checkpoint record: stage, program index, flags +0xc0), FUN_0023dc48.
- Evidence: trace a death after rv_matiawase and read DAT_004b2680.
- Files: checkpoint.js, play.js restart. Needs P3.

### P9. Mid-level cutscenes — L each
- Missing: ~20 events after the opening (list in §1). Reuse 0210's opening-cutscene player once it lands.
- Files: whatever 0210 builds; one worker per event class (scr001 / 002 / 003 / 005 / 006) can run in parallel
  after that.

### P10. Character lighting outside chunks 01 / 02 — S
- Missing: the light-2 grid pick reads only 06800111 / 06800211 (HANDOFF 'Character lighting'); other chunks'
  grids (0680AA11) are not exported, so Vincent and the soldiers are lit with the start deck's light everywhere.
  Events also call set_ambientcolor / set_directioncolor / fog (event natives).
- Leads: FUN_0026a710 → FUN_00270d08, export_web_light.py.
- Evidence: one GS dump in chunk 06 (vertex colours on Vincent), as for the hero dump.
- Files: export_web_light.py, play.js light update. Independent.
- **Done (worker 0216, 2026-11-02):** slot table + area boxes decoded and on the page (notes/area-stream.md). Open: the
  chunk-06 GS dump (no save state there), the load time (GUESS), events' load(128, a, b) (P3), set_ambientcolor etc.

### P11. Help / objective messages — M
- Missing: the stage's message boxes (the x -1186 box closed with two ✕, game-state bit 6 pauses the AI:
  enemy-research.md §7) and displayStageInfo(1) objective text with flag 13.
- Leads: FUN_0037def0 / FUN_0037cf30 (event VM), FUN_00325b10, the second text renderer (worker 0189).
- Files: new message layer, pause_layer.js style. Independent of P1-P6.

### P12. Level end and the results screen — M (after P3, P6)
- Missing: endSection, displayStageInfo(2), the Status results screen, the next-stage request (FUN_00241ed8,
  FUN_00377c68 type 0x14), the "Sea of Flames" / next "Now loading" title.
- Evidence: a save state near the boss, then a trace through the end (game state 0x15 → results).
- Files: new results module, gameover_layer-like overlay. 

### P13. Small checks — S each
- Ladders 2 (-930,-60,-1075) and 3 (1430,-188,1380): no walk polygon found under their origins (ladders 0 / 1
  link fine). Check with `play.html?ladder=2/3`.
- Area streaming: the page draws all 13 chunks at once; the game has only the loaded pair (load(128, a, b)). Check
  whether far chunks show through the fog (far 810) anywhere, e.g. chunk 0a from 0b.
- g001 (rec 151, chunk 04, HP 1000) and stage section 15 (146 props) / 16 (37) / 11 (20): unmapped placed
  objects; scout them for destructibles other than 0209's barrels.

## 4. Parallel groups (no shared files)
- **A (enemy_ai.js):** P1 → then P4 or P6 (one at a time).
- **B (room exporter):** P2.
- **C (0210's event_vm.js / event_rt.js + a stage_controller.js + play.js hook):** P3a/b, after 0210 lands.
- **D (aim / hud / items):** P5 (ammo/reload half); the drop half touches enemy_ai.js (group A).
- **E (audio):** P7.
- **F (lighting export):** P10.
- **G (messages):** P11.
P8, P9, P12 wait for P3.
