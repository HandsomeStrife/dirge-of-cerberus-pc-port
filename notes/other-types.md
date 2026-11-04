# Other enemy types: e036, e023, e001 (worker 0230, 2026-11-03; plan P6 part 1)

Code: enemy_ai.js (`AI_TYPES`, `send` cases, `combat1`, the delayed list, drainManager types 9 / 0x16), export_web_triggers.py
`AI_TYPES`, build_web.sh (`E036_CLIPS`, `E001_CLIPS`), disc.py (+0765004b). Test: `node --import ./native/web/test_hooks.mjs
native/web/test_other_types.mjs` (29 checks; 13 / 13 mutants), test_enemies_page step 6b. Audit rows 'Other enemy types (worker 0230)'.
D = decoded from the code, T = seen in a trace, L = left as is (reason given).

## What each type is

| record | model | stance (FUN_00564228) | what it is | script | woken by |
|---|---|---|---|---|---|
| 80 | e036 | none of its own: falls through to the weapon-class rule (weapon 8, class 2) -> 0x1e, flags 0x872b (D) | a soldier with the m_* set (HP 750) | 198 | script 104 event 0x20 (below) |
| 87 | e023 | 0x19 (row 0 / 1 'idle'), actor +0x118 \|= 0x80801c (D) | **the helicopter**, not a beast: radius 90 / height 40, rotor loop asj_011 (cmd 0x126, 500 / 1500 u), 'srch00' (searchlight), weapon 11 (damage 68, mag 999, interval 4) | 112 | trigger 71 (-919, 0, -591; script 86): flies path 74 at speed 95; trigger 137 (script 180): path 104 prop + strafing |
| 31 | e023 | as 87 | the same helicopter model for the early beats (HP 22800, weapon 24) | 29 | trigger 14 (script 87, flag 0 < 13), script 0 event 0x22 (flag 0 == 13); deleted at flag 0 == 16 |
| 1 | e001 | 0x10 (the a_* rows, motion file m001 0765004b) | an event actor (HP 9999): its event 3 clears +0x38 bits 0 / 2 (no bullets, no lock-on) and starts routines | 111 | trigger 18 (-1949, -44, 1594; script 102, flag 0 < 20) with 2, 72-74 |

The plan's 'beast_ev beasts' for e023 was a guess; what the ev0100 beast_ev events (stage controller, workers 0219 / 0229) do
was not checked here.

## Chunk 07's fight (records 1, 72-80)
Trigger 18 activates 1, 2 (n112), 72-74 and triggers 27 / 28 (flag 0 = 20). Soldiers 72-79 (script 104) count deaths in manager
short 12 (event 0x17). Event 0x20 (the corpse removal, below) of any of them with short 12 == 8 sets it to 9, activates record 80
and posts it message 1; e036's event 2 (var1 0) sets var1 = 1 and starts path 84. e036's death (event 0x17) sets e001's timer 0 =
140; e001's event 1 then sets flag 0 = 24, and script 0 event 0x24 deletes 1 and 80.

## The corpse chain (D + T)
- FUN_0055cac8 (death) tail: status +0x60 bit 1 clear, +0x28 bit 0x20 clear, status +0xc bit 1 clear -> FUN_0053e9e0(mgr, id, -11,
  300, -1, 0). (Other branches: +0xbc linked object -> code -14 at 0x1a4, FUN_0055f0e0 / FUN_0056baa8: not on z128's soldiers.)
- FUN_0053e9e0: the manager's delayed list +0x1254, due = mgr +0x20 + delay; FUN_0053f040 (after FUN_0053e868, before FUN_0053fde8)
  takes entries with due - now < 1; code >= 0 -> manager event 0x19 (the 0x101 messages; still the page's mailbox), code < 0 ->
  switch on code + 0xd3.
- case 200 (-11): FUN_00342360(0.0, C, 180) (fade target C+0x6b8 = 0, rate C+0x6bc = -C+0x6b4 / 180, C+0x564 bit 0x800000; FUN_00343160
  steps it by DAT_004eeb24; the draw alpha is C+0x6b4 x 128 through FUN_00343de8 -> MP FUN_005a86a8), the weapon MP's FUN_005a78d8,
  +0xe4 \|= 2, then code -10 at 180.
- case 0xc9 (-10): manager event 9 -> FUN_0053fde8 case 10: vt+0x144(0, 1) (off), the matrix set upright, script event 0x20; status
  +0x60 bit 0x40000 -> freed.
- **mgr +0x20 counts ticks**: FUN_0053b500's end adds the integer part of +0x24 (+= the step, 1.2 on PAL). So 300 + 180 ticks =
  400 frames. T: w230_corpse (k_hits12's inputs to f1400; `TRACE_LOG_AT=9f400 TRACE_FIELDSET=enemy TRACE_ENEMIES=2`, logged
  f1200-1399): #66 (dead f843) +0x28 0x20c00b -> 0x20c00a at f1243, #67 (f871) at f1271. The page: 400 frames in all five phases.
- Page: the body goes at the deactivation (enemies.js remove). The fade is computed but not drawn (MISSING).

## Commands decoded here
- FUN_0054cd70: 0x16b / 0x16c / 0x16d / 0x16e / 0x16f / 0x167 = +0x38 bits 3 / 0 (+ +0x40 bit 4) / 1 / 2 / 6 / 8 (+ +0x40 bit 6);
  0x11a = FUN_0054b508 (+0x28 bit 12); 0x113 = +0x36 period: code -2 -> case 0xd1 -> manager event 0x16 -> FUN_0053fde8 case 0x17
  -> vt+0x22c FUN_0054cca8 = script event 0x18, again while it returns 0; 0x114 -> FUN_0053fb80 -> manager event 2 -> FUN_0054ddf8
  -> FUN_0054dec0 (a timed routine: script function r0 of the script at +0x42, called with the step count; it returns the delay to
  the next step (code -4); < 1 ends it with event 0x1b). Decoded by worker 0259: see 'The helicopter's fight'.
- FUN_005661e8: 0x19e = FUN_0035f9a0 (combat layer r0), 0x19f = FUN_0035f540 (action layer), 0x1a0 = FUN_0035fc10, 0x1a3 =
  FUN_00317420 (HP = (short) r0 clamped to [0, max]), 0x19b / 0x19a = FUN_00344840(C, clip) + FUN_00341780(C, 0x42 / 0x41) (an
  event motion), 0x19d = FUN_00569870 (a weapon object at the actor: weapon r0, r1 > 0 -> bone r2 / r3), 0x1a9 = FUN_00340de0.
- FUN_00588b78 0x126 = FUN_00341458(range r1 or 400, C, sound r0): a sound on the body.
- Combat layer 1 (vt 0x4a23a0): start FUN_00360da8 = FUN_003607a8(ai, -1); update FUN_00360dc8 = magazine not empty ->
  FUN_003607a8(ai, -1), else FUN_00360718 (reload); vt+0x24 FUN_00360e10 = FUN_00360820 (stop); free FUN_00361180.

## Open
- No PCSX2 trace of any of these fights: route states stop in chunk 02 (route-states.md); trigger 71 is at the chunk 02 -> 03
  stairs top (r02_climb is at their foot), trigger 18 in chunk 07. A trace needs a walk up from r02_climb (route.py) or a
  teleport + chunk stream.
- The helicopter's strafing in the later beats (script 112 event 0x18 / script 180: 0x19d at 134-137, 0x191, 0x190 prop 124), its sounds (0x126). Script 29's fight: done, below.
- Corpse fade draw. (Done in the review round: every mgr +0x20 reader is on S.mgr20; see HANDOFF.)

## The helicopter's fight (worker 0259, 2026-11-04; D + T)

Traces (`tools/trace/out/`, gitignored): **w259_heli** (r06_market, Vincent stands, f0-759; `TRACE_POKE=960660=270f TRACE_FIELDSET=enemy TRACE_ERECS=31 TRACE_ENEMIES=1 TRACE_EVARS=1 TRACE_LOG_AT=a0000`), **w259_heli2** (same, f820-1419, `TRACE_LOG_AT=b6000`).

**What ends it (decoded; route-states.md's open question).** Script 29 event 8 (a hit that did damage): HP (cmd 0x138) <= 20000 (0x4e20) with var 1 != 3 -> var 1 = 3, **timer 0 = 240**, bits 3 / 5 / 0xd on +0x118, the gauge at 0, a sound, routine 39. Event 1 (timer 0's end, manager event 0xd) -> flag 0 = 16 (`0xb(0, 0x10)`) and the gauge out. The death event 0x17 takes the same way. HP starts at 21600 with a gauge of max 1600 (event 0x23, flag 0 == 13), so the fight is **1600 points of damage, not 21600**; the two earlier "13 -> 16 at HP 172" runs had HP poked to 200, under the line from the first hit. Easy / hard (0xa6 / 0xa7): gauge 2800. Timer: FUN_0053e868 takes the whole part of the step, 1 a frame on PAL (T: e001's timer 140 -> 102 in 38 frames, w259_e036), so 240 frames.

**Flight: motion class 0x42 (cmd 0x19b).** FUN_005661e8 case 0x19b: FUN_00344840(C, r0, 0, 0), FUN_00341780(C, 0x42, 0), actor state 1. Class 0x42 = FUN_00592918 (the compare tree) -> vtable 0x5a4970: enter FUN_0059e640 (C+0x564 |= 0x4000 | 0x200000, C+0x568 |= 0x80000), leave FUN_0059e6a0, update FUN_0059e730: phase 0 the matrix = identity with rows 1 and 2 negated at the origin, FUN_00341750(C, 1) (0x400000), no blend, FUN_003448c0(C, 0, 0) plays C+0x640 once; phase 1 FUN_003460d8 -> done bit. FUN_003449a0 -> FUN_00340c00 copies 0x400000 to C+0x564 bit 4, and FUN_00343160 then takes the matrix from the root bone (FUN_005ad9c0, FUN_0034aae0). **The clips hold the path in world space (bone 1).** T: C+0x30 within 1.21 u of bone 1 at frame 13.05 + 0.6 x f over 760 frames; C+0x20 = minus the bone's row 2 (within 0.012). The clip list: `E023_CLIPS` (076505cb.bin, 21 clips).

**The next leg: script event 0x16.** The done bit -> FUN_00343160: C+0x564 bit 0x20 clear -> set, FUN_00341af0 -> FUN_00341988 (listener C+0x7d4, code 0) -> FUN_005887a0 -> event 0x16 (T: sp0_4 -> ms4_0 at f861; C+0x30 reads 0 for that one frame, phase 0's matrix). Event 0x16 picks by var 0 (the place), rand and var 2: clips, routines 6.. and 0x21.. (`0x114`), combat layer 2 (0x19e), the drop of records 81-86 (messages 0 / 1).

**Timed routines: cmd 0x114, the part worker 0230 could not decode.** FUN_0054cd70 case 0x114 -> FUN_0053fb80 (manager event 2) -> FUN_0054ddf8 -> FUN_0054dec0. r0 is a function **index**: FUN_00371490 = table end (VM +0x14) + [VM +0xc][r0] x 8, VM +0xc = script + [+4], the area stage_events.py calls globals. Scripts hold functions past their event table. ai.json `script_fns` (script -> index -> function; export_web_triggers.py). A routine runs with r0 = step; its result is the next step's clock from the start (+0x48), < 1 ends it (event 0x1b), except 0 at step 0; delayed code -4 -> manager event 0x17 -> FUN_0054dec0. enemy_ai `routineStart`, `routineStep`. **This switches on every script's routines (24 scripts)**, e001's included.

**Other commands translated:** 0x138 (HP), manager 0xa2 (record's HP == 0), manager 4 (an effect at manager +0x260), 0x14b (an effect at the body: L), 0x19d (a weapon shot, FUN_00569870 through shootMarker), 0x1aa (C+0x568 bit 0x100000, reader not looked at).

**Rockets.** Routine 6 / 7: `0x19d(25, 1, 4, 0xf / 0x10)`, from markers 15 / 16 (the pods); weapon 25: damage 80, homing bit. T w259_heli2: Vincent -78 at about f1340 (the game's zone scaling not compared).

**The paratroopers (records 81-86, scripts 159-164).** Event 2: `0x40(3)`, 0x10e, 0x108, 0x19b r_para*, 0x1aa. These clips land them in the market in world space through the same class; event 0x16 then gives brain mode 5. Clips added: 076506cd.bin (disc.py INPUTS, build_web.sh). Not checked against a trace: no drop was logged (rand in event 0x16). See HANDOFF.

**Left out, warned:** 0x126 / 0x127 (FUN_00341458 / FUN_00341518: a looping sound on the body, the rotor: the page's `sound` has one-shots at a fixed place and no stop), 0x1a9 (FUN_00340de0 -> FUN_00340d30, the C+0x7e0 object). Effect attachment: at the body's position (L).

## e036's fight (worker 0259; D + T)

**w259_e036** (r07_beat, replay of w217_r07_e036, f0-309; `TRACE_POKE=960660=270f TRACE_FIELDSET=enemy TRACE_ERECS=80,1 TRACE_ENEMIES=2 TRACE_EVARS=1`). Before: page vs T with the page's old rule: clip wrong on every flinch and the kill; position off by up to 16 u when a coin flip differs (see below).

**The hit area (FUN_0055d390), the reaction rows.** From FUN_0055db50 while the victim lives. C+0x590 low 4 bits: with C+0x564 bit 0x10000 clear, the zone record's word bits 8-11 + 1 (ai.json `zones[].area`), or by height with no zone (> 0.7 h: 2; > 0.3 h: 3 / 4 by x, else 1; lower 5 / 6). With the bit set (the flinch's FLINCH_BITS): by side and old area. T: e036's area per hit 1, 5, 1 | 1, 4, 1, 4, 1, 5 matches this table with the hit sides inferred. **The flinch's row** = FUN_00598950's jump table 0x5a3b10: 1 -> 0x25, 2 -> 0x24, 3 -> 0x26, 4 -> 0x27, 5 -> 0x28, 6 -> 0x29, else 0x25. Its blend: previous class == this class -> FUN_00340bb8(C, 1, 5), else none; FUN_00340bb8(C, 1, -1) after. **The death row: the same table + 6: L**, the writer was not found in two attempts (the class's own row 0xac is not it; no code has an immediate 0x2e). Three T points: #66 area 3 r_stlaf0, #67 area 1 (5 -> 1 under the flinch) r_stbf0, e036 area 5 m_stllf0. **Clean head kill (area 2 -> row 0x2a *_sthf0): no T.** All the rows are exported now (AI_MOTIONS, build_web.sh lists).

**Largest errors now** (node replay of T's hits, positions from the page's own flinches): flinch and death clips equal when the side matches (the replay has no real hit point: the hit side x is unknown, so areas under bit 0x10000 are not compared in the replay; the table is tested against T's sequence in test_other_types); flinch coin flips differ (one FUN_0040b5c0 draw, no shared RNG state): 16 u after 7 extra flinches at worst. Brain mode 5 fire times: T m_st_f f87, f99; page f79, f84, f93 in the same stretch (RNG), not compared further.

Tests: new test_heli (node, 30+), test_heli_page, test_other_types block 7, test_enemy_hits (expectations by area). Mutants: 19 / 19 killed but one equivalent ('event 0x16 every frame': every 0x19b script replaces the class in the event, or clears var 2; killed in no test). Baseline `test_death`, `test_hit_reaction`, `test_knock` crash on a missing `ladderHit` in player.js: another worker's work in progress, not this.
