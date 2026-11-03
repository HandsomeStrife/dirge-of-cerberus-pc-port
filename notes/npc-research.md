# Townspeople, WRO men and the stage areas (worker 0223, 2026-11-03; plan P4)

D = decoded from code / data, T = matches a PCSX2 trace or RAM state, L = likely, G = guess.
Traces / states (gitignored): `tools/trace/out/w223_npc95.jsonl` (per frame, records 113 / 114), the PCSX2 states and GS dumps
in the worker 0223 scratchpad (grab95/s800, s826; grabview/s100 + g100.gs.zst). Scripts: `tools/trace/scripts/w223_npc95.json`
(w212_flag95's route with trigger 95 poked to run script 23: `TRACE_POKE=9540a4=17,10a2140=17`), `w223_npcview.json`
(from the s826 state, Vincent's five position copies poked to (-1125, -1, -1255) with C+0x4c0 = 0, as r06_tp).

## 1. The records

Stage section 1 has 38 n0xx records: n017 x13 (records 103-107, 109, 110, 144-146, 218-220; tags f_WRO_*), n018 (108), n022
(124, wro_11), the townspeople n023-n034 (111-123, 125, 126, 131-137) and n112 (2, e_Shc, not an NPC). The WRO men carry
weapon 9 (HP 80-400); the townspeople have no weapon (HP 1-1000). All are actor class 0x58e1f8 like the soldiers (save RAM).

**Save state (T):** every n0xx record's actor is **inactive**: +0x28 0x209400 (WRO: bit 0x1000) or 0x208400, no body, no AI.
That includes record 105: the "record 105 = active" of worker 0215 was manager +0x2b4[105], the **area** table (section 2).

## 2. Areas (section 11) (D, T)

- FUN_00547bc8 (stage load): one object per section-11 record (0xb0 B; z128: 20), class 4, vt 0x58c308 (ctor FUN_0054ed78,
  init FUN_0054ee88: +0xe4 = record k, +0xe8 = the record), and manager **+0x2b4[record +0xa0] = its object id** (first wins).
  Record: +0x30 position, +0x80 / +0x90 box lo / hi (no rotation in z128), +0xa0 area index, **+0xa4..+0xa7 neighbour area
  indices** (s8, -1 none). FUN_0053b920(mgr, k) is the lookup (script cmd 0x3b; no z128 script uses it).
- Children: gimmicks (section 15 +0x4c, FUN_00548348) and placed sounds (section 22 +0xa8, FUN_00548788) join an area's +0xc0
  list (FUN_0054c550); FUN_0054ef68 (the area's +0x28 bit 0 change) calls vt+0x14c on each child.
- **Which areas are on:** the player's update FUN_00573c60 (player vt 0x58f128 +0x234; gate: manager +0x12a0 != 0 and
  DAT_0046f4dc +0x60 bit 0 clear) -> **FUN_00542920(mgr, his matrix row 3)**: nothing while the current area (mgr +0x14) holds
  him (FUN_0054f0d8: [+0x30 + lo, +0x30 + hi], FUN_00261218); else the first neighbour in +0xa4 order that holds him; else the
  last area of the manager's list +0x1118 (the section-11 records in order, RAM) that does; else -1. On a change
  **FUN_00543f28**: the old area's neighbours that are not the new area or its neighbours go off, the old area too unless it
  is a neighbour of the new one, then the new area and its neighbours on (FUN_00544138(mgr, k, v) -> FUN_0054ef68; also
  FUN_00326130(3, k) / (2): a status bit on the game manager +0x68..+0x74, not on the page).
- T: the save: current 105 (record 0, Vincent's start), on 105 / 2 / 15 (= its neighbours), the other 17 off. A state with
  Vincent poked into record 5 (area 15): current 15, on 15 / 105 / 53, area 2 off.
- Page: `native/web/areas.js` (Areas), ai.json `areas` (export_web_triggers.py `areas`), play.js runs `areas.frame` after
  Vincent's step; the placed sounds read `areas.isOn(+0xa8)`. This replaces the AMB_SAVE_ACTIVE GUESS. Open: the barrels'
  `SAVE_ACTIVE_AREAS` GUESS (export_web_props.py) is the same table and can use areas.js.

## 3. Stances (D, T)

FUN_00564228's name cases (the parameter set's model name): n017 / n018 / n020-n022 -> the weapon rule (LAB_005649f0: class
0 / 1 / 3 -> 0x1f, 2 -> 0x1e); n023 n025 n029 n031 -> **0xd**; n024 n026 n030 n032 -> **0xc**; n027 n028 n033 n034 n058 -> **0xe**.
bmd rows: 0xc / 0xd / 0xe row 0 / 1 = `st`, 2 `look`, 9 / 0xf `wk` (0xe: `wk2`), 0x10 `rn`, 0x2a.. `dead1-3`, 0xe row 0xb7
`fear`; flags 0. T: w223_npc95 C+0x664 111 / 113 / 114 = 0xe / 0xd / 0xc, C+0x808 0.

## 4. Wake (D, T)

- Only cmd 0x108 wakes them (no z128 NPC is a stage-load event actor). Triggers and their scripts (`stage_events.py
  --activations`): 96 (script 23: 111 / 113 / 114 + soldiers 69-71), 129 (169: 113 / 114 / 111 / 125), 63 (34: 131-133), 64
  (37: 103-105, 116-119), 58 (31: 120-122), 59 (17: 123), 88 (134: 109 / 110), ... the WRO groups 103-108 / 124 / 144-146 also
  from scripts gated on manager var 0x105.
- Script 23 sets each NPC up before the 0x108: 0x40 + 0x10e (move to locator 4 / 5 / 6), 0x14a (revive), 0x104 var4 = 1; then
  0x131 path 96 for 113. Manager event 7 runs their **event 3**: var4 == 1 -> **cmd 0x141 'fear'** (+ 0x16a(1) for 113 / 114).
- FUN_005661e8 case 0x141: needs the body (+0xe8); skipped if FUN_00566198 (status dead and not flag 1) and r2 == 0;
  FUN_00344840(C, r0 name, 0, 0) stores the name at C+0x640, FUN_00341780(C, 2, 0) plays it; MP object +0x80 = r1.
- T (w223_npc95, per frame): 113 and 114 wake on **f783** (+0x28 0x20c40b, actor state 1, AI mode 0) in **`st`** (stance row 0),
  **`fear` from f784**; 114 at locator 5, 111 at locator 6 (facing = placement); MP rate 0.5, `st` blends out over ~11 frames.
  113 slides along path 96 at speed 50 (move mode 9, ~1 u / frame) **in 'fear'** (no walk clip) and stops at f791,
  (-1081.11, -0.01, -1280.13), facing (-0.411, 0, 0.911). At f800 / f826 / later all three stand in 'fear' (113 re-requests it).
- Page: enemy_ai sends 0x141 for body-only records (t.motion), body-only records are built at +0x90 (0x10e), enemies.js draws
  n0xx bodies with IDLE = stance row 0 and switches to t.motion (blend as an AI request, L).

## 5. Behaviour not on the page (MISSING)

- The NPC brain (AI mode 0 at +8 for all but 109 = 1; scripts set 144-146 to 3, 218-220 to 0 / 2, WRO 103-105 to 5 with
  var7) and their move layers; the townspeople's script events 0x13 (rescued? var6 = 2, 0x16a, 0x109 + manager counter 56),
  0x14 (HP thresholds: 0x155 speeds, 0x193 + 0x143 to nearby soldiers), 0x17 (death: 0x125 scream, counters), 0x2 (wake n:
  0x142, 0x131 path 33 / 44). 113's slide along path 96 (9.3 u) is the visible gap at trigger 96.
- WRO men: rifles (weapon 9: no weapon map exported), their soldier brain on DG soldiers (target choice not decoded).
- n028 (record 112): LOD variant 1 stops export_web_enemy.py (render_skinned.sub_tris gets no index list); not exported.

## 6. Check image

worker 0223 scratchpad `npc_game_vs_page.png`: PCSX2 w223_npcview f100 | the page with the game's camera (CAM+0x90 eye, +0x80
forward -> ?cam=-1162.73,-11.40,-1250.42,96.92,8.13; fov 59.27 as the page's, from the GS dumps), Vincent back at the poked
spot, the page's soldiers 69-71 hidden (they walked up to him on the page; the game's took another route), room drawn with
back faces only (`test_npc_page` NPC_SIDE=1). Framing matches; 113 stands at locator 4 on the page (its path slide is
missing). **The grey surface** of the first images is a room face the page draws because room.js draws DoubleSide: with
front faces only the view is grey, with back faces only it is the game's view. For the room owner (P2).

## 7. Review round (worker 0223, same day)

- Area children wired (areas.js `onSwitch`, only on a change, offs before ons): barrels (props.js `areaSwitch`, vt+0x14c
  FUN_00584220), items (items.js, FUN_00580348), placed sounds (ambient.js, FUN_00550ad8: +0xa4 bit 17 kept off). Stage
  start FUN_0053ced8 (from FUN_003245e8): vt+0x14c(1) on objects without a parent area, classes DAT_0058b090 = 2 1 10 15 16
  19 3 14 11 8 18 (not 4: areas start off). Item area 69 (and 10) has no area object (manager +0x2b4 slot 0xffff): no parent.
  The exporters' SAVE_ACTIVE_AREAS are gone. Restart: areas.reset() in rebuildEnemies.
- NPC bodies (RAM +0x38 0x391) in enemy_ai's push-out and lock-on list (never lockable); bullet hits on them: MISSING.
- cmd 0x141: body gate (t.body, set by FUN_00559748 / cleared by FUN_00588330), the FUN_00566198 r2 gate, the trailing
  FUN_0055b8e0(actor, 1, 0, 0) (t.astate = 1).
- n028 exported: export_web_enemy.py skips a sub-packet without an index run (n028 variant 1 @0xd470: a colour stream only).

## 8. The townspeople's behaviour (worker 0228, 2026-11-03)

**They are actors (D, T).** Same class 0x58e1f8 as the soldiers, so an activation builds the actor and its AI (FUN_00559748 ->
FUN_00365c50; T: w223_npc95 AI mode 0, +0x28 0x20c40b). Brain mode 0 (section-1 +8 for every townsperson) = class 0x4a2430,
update **FUN_003614b0 = `jr ra`**: no brain logic. Everything they do is their scripts plus the shared body / hit / death code.
Page: enemy_ai `NPC_TYPES` (n023-n034) build actors; the WRO men (n017 / n018 / n022) stay body-only (rifles not exported).

**cmd 0x141 on an actor (D, T).** FUN_005661e8 case 0x141: FUN_00344840 (C+0x640 = r0), FUN_00341780(C, 2, 0), MP object +0x80
= r1, FUN_0055b8e0(a, 1, 0, 0). Body motion **class 2** (factory FUN_00592918 case 2 -> vt **0x5a6b28**, from the ELF): enter
0x593c20 C+0x564 |= 0x4000 | 0x200000, C+0x568 |= 0x1000000; leave 0x593c60 clears the 0x564 bits; update **FUN_00593c90**:
phase 0 FUN_00340bb8(C, 1, -1), FUN_003448c0(C, 0, 1) = the C+0x640 clip, FUN_003449a0 flags 3 (looped), rate 1.0; phase 1
counts finished loops against +0x80 (z128's 0x141s all pass r1 = 0: the clip loops on). Actor state 2 -> 1: FUN_00537d58 'other'
-> FUN_00537aa0 jump table 0x589e70 entry 1 = 0x537ac4 (`return 0`): no body motion, so 'fear' stays. T: 'st' on the wake frame,
'fear' from the next (w223_npc95).

**Event 0x14 is the path node event, not an HP threshold (D).** FUN_0034fad0 (mover 1, per node): C+0x314 + 1, then the body
listener C+0x540 vt+0xc(3, &node) -> FUN_005690c8 case 3 -> FUN_00588550 jump table 0x591ef0 case 3 (0x588694): FUN_0053fbe8(mgr,
**0x10**, id) with +0xc = the node; then FUN_00563970(a, -1). FUN_0053fde8 case 0x11: script event **0x14** (r0 = node). Scripts
73 / 74 / 170 use it to set run speeds (0x155) and alert soldiers per node when var4 != 1. Case 2 (0x588678) = manager 0xf ->
event 0x13 at the path end (already on the page). Applies to the soldiers' paths too (same listener).

**cmd 0x16a (D).** FUN_0054cd70 case 0x16a: vt+0x8c (actor: 0x56bda8 returns the object) -> r0 == 1: +0x38 |= 0x210, else
&= 0xfdef. Bit 9 = the push-out. T: 0x391 after event 3's 0x16a(1). The page keeps +0x38 only for townspeople (a.f38; the
soldiers' is still the PROBE_BITS stand-in). GUESS: a.f38 starts at 0x391 (the activation's writer not read).

**Hits and death (D, shared code).** Part boxes: the townspeople's model 'mkd' chunks carry tag `mkd\0` instead of `mk2\0`;
FUN_0030baa0 has no tag test (count +6, boxes +0xc, 32 B), so export_web_triggers.py now exports n023-n034 boxes, markers and zone
sets (15-24, 26). Then FUN_005ad118 / FUN_0055db50 / FUN_0055c7f8 / FUN_00565480 / FUN_0055cac8 as for the soldiers: flinch
(stance 0xc / 0xd / 0xe have no row 0x28: the flinch keeps the current clip, the soldiers' fallback), death rows 0x2a-0x35 dead1-3,
script event 0x17: 0x16a(0), 0x125 scream (se_0494 for 114), var4 == 1 -> var5 = 1 + message 1 to the partner (113 <-> 114),
0x193 / 0x143(5) to soldiers 55-57. A partner's event 2 with r0 != 0: var6 = 1, 0x142(2), 0x131 path 33 (113) / 44 (114): it
runs (state 2 -> motion 3 -> 'rn') and gets a 0x14 per node.

**The rescue at trigger 24 (D, page).** Trigger 24 ((-1090.7, 0, -1273.2), box +-52, script 138). Soldiers 69-71 (scripts
24-26, woken by script 23 with the NPCs) count deaths in manager short 13; at 3 their event 0x17 messages trigger 24 -> short 19
= 1. Vincent entering it: message 0 to 113, the trigger deletes itself; 113 event 2 (r0 0) -> message 0 to 114 -> 114 event 2:
counter 56 += 2, short 79 = 1, **flag 1 = 5**. With r0 0 neither runs a path. Event 0x13 (path end) with var4 != 1 is the other
"rescued" exit (counter 56 + 1, 0x109); none of trigger 96's NPCs takes it (var4 = 1).

**113's slide (T).** Page ticks 1-9 = w223_npc95 f783-791 to 0.0007 u, stop (-1081.11, -0.01, -1280.13) facing (-0.411, 0,
0.911), path end on the f792 tick (speed 0), then event 0x13 re-requests 'fear'. One frame offset as test_path_walk (the game's
trigger runs before the bodies in its frame).
