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

## The beast alley: the child's abduction and rescue (worker 0276, 2026-11-09; Dan's "save the abducted girl")
Records: e_BeastB 8 / e_BestB2 9 (e030, script 217), e_Beast 7 (e030, script 222, area 88), n_Child 112 (n028, script 153),
n_Mother 115 (n026, script 30, area 88), o_nui 151 (g001, the child's toy, no script). Manager shorts (cmd 0x2f / 0x30, mgr +0x28):
69 rescue open, 71 Vincent in trigger 166, 72 the child seen, 73-76 marker / step states. Scripts read with tools/stage_events.py
(--dis) and the routines by index from ai.json script_fns (cmd 0x114 runs function r0 of the host's script, not an event).
- **beast_ev01** (main, stage flag 0 = 11) ends with 8 and 112 active at their placements (T: +0x28 0x840b / 0x9403 at f593).
- **Trigger 163** (-655.5, 241.7), script 216 event 0xd: 74 = 1, 76 = 2; 0x108 on 8, 112, 151 (+ 0x14c bits 3 4 2 6 5 13) and
  **cmd 0x19b 'kidnap'** to each; trigger 185 and e_Beast 7 on; routine 216/1 (0x114(1)).
  'kidnap' is in each model's motion file k = 0xb (m001): e030 0765078b (rn_b, kidnap, kidnap2), n028 076e070b (kuwa, kidnap), g001
  0767004b (and its 0 / 0xa files). Class 0x42 (FUN_0059e730): bone 1 carries the world path. **T w276_beastpos** (r04_east +
  w217_r05_west, walked): beast 8's C+0x30 creeps (-819, 483) -> (-857, 465) in 200 frames, holds, runs to (-1043, -3, 417) by +380;
  the child's C+0x30 stays (1.66e-6, 0, -4.8e-7) = her clip's root (drawn on the clip's bones, carried).
- **Routine 216/1** (delays 55, 410, 426, 430, 550, 600, 820): the child's cry (0x125), trigger 165 0x18d(0); beast 8 0x16e(0) /
  0x11a(1) (T: +0x28 bit 0x1000 at f1108); voices on record 186; stage flag 1 = 13 (T f1224); step 7: **69 = 1, trigger 165
  0x18d(1)** (✕ usable), beast 8 off (0x109) (T f1449 = trigger + 684; page + 683).
- **Trigger 165** (-1010.5, 434.1, shape 8, flags 0x10018), script 219 event 0x11 (✕): with 69 == 1 and its bit 7 clear: 76 = 0,
  voice asj_634, timer 160 -> event 1: 74 = 2, markers (0x17 / 0x18), routine 219/2 (the child to locator 19 (0x40 / 0x10e), 0x141,
  voices, **trigger 166 0x113(2)**), the child's 0x113(2) (her event 0x18: cmd 0xab on manager +0x260 -> short 72).
- **Trigger 166** (-989.7, 443.7), script 220: 0xd / 0xe set 71; event 0x18 (period 2): 71 == 1, 72 == 1, bit 0 clear -> 0x104(0,
  1), trigger 168 off, message 0 to 8 (difficulty 2, cmd 0xa6) else 9 -> script 217 event 2: locator 20, 0x10e, 0x193, 0x108,
  0x16e(1), 0x11a(0), 0x143(3) (attack). Trigger 177 (script 234, 320-tick poll) counts 8 and 152-163 dead -> stage flag 1 = 11
  (beast_ev02), shorts 56 += 2, 57 = 1.
- On the walked route (no ✕ at trigger 165) nobody fights in the game either: 72 never 1, 7 / 115 stay at their placements (T f1500).

## Open
- No PCSX2 trace of any of these fights: route states stop in chunk 02 (route-states.md); trigger 71 is at the chunk 02 -> 03
  stairs top (r02_climb is at their foot), trigger 18 in chunk 07. A trace needs a walk up from r02_climb (route.py) or a
  teleport + chunk stream.
- The helicopter's strafing in the later beats (script 112 event 0x18 / script 180: 0x19d at 134-137, 0x191, 0x190 prop 124), its sounds (0x126). Script 29's fight: done, below.
- Corpse fade draw. (Done in the review round: every mgr +0x20 reader is on S.mgr20; see HANDOFF.)

## The helicopter's fight (worker 0259, 2026-11-04; D + T)

Traces (`tools/trace/out/`, gitignored): **w259_heli** (r06_market, Vincent stands, f0-759; `TRACE_POKE=960660=270f TRACE_FIELDSET=enemy TRACE_ERECS=31 TRACE_ENEMIES=1 TRACE_EVARS=1 TRACE_LOG_AT=a0000`), **w259_heli2** (same, f820-1419, `TRACE_LOG_AT=b6000`).

**What ends it (decoded; route-states.md's open question).** Script 29 event 8 (a hit that did damage): HP (cmd 0x138) <= 20000 (0x4e20) with var 1 != 3 -> var 1 = 3, **timer 0 = 240**, bits 3 / 5 / 0xd on +0x118, the gauge at 0, a sound, routine 39. Event 1 (timer 0's end, manager event 0xd) -> flag 0 = 16 (`0xb(0, 0x10)`) and the gauge out. The death event 0x17 takes the same way. HP starts at 21600 with a gauge of max 1600 (event 0x23, flag 0 == 13), so the fight is **1600 points of damage, not 21600**; the two earlier "13 -> 16 at HP 172" runs had HP poked to 200, under the line from the first hit. Easy / hard (0xa6 / 0xa7): gauge 2800. Timer: FUN_0053e868 takes the whole part of the step, 1 a frame on PAL (T: e001's timer 140 -> 102 in 38 frames, w259_e036), so 240 frames.

**T (w259_heli_end, w259_heli_hp; r06_heli4 replay, gitignored):** with this run's Dragonfly at HP 200 (poked state, already under 20000), the hit logged at f947 takes it to 172 and flag 0 goes 13 -> 16 in the f1186 record: 239 records later, against timer 0 = 240 at one per PAL frame (a record holds the previous frame's state). So 172 in route-states.md is just the HP of the hit that started the timer, not a threshold. Not seen in a trace: the crossing from above 20000 itself (the poked HP starts below it); that branch is D. Then flag 0 = 18 at f1711 (the next beat, not traced further).


**Flight: motion class 0x42 (cmd 0x19b).** FUN_005661e8 case 0x19b: FUN_00344840(C, r0, 0, 0), FUN_00341780(C, 0x42, 0), actor state 1. Class 0x42 = FUN_00592918 (the compare tree) -> vtable 0x5a4970: enter FUN_0059e640 (C+0x564 |= 0x4000 | 0x200000, C+0x568 |= 0x80000), leave FUN_0059e6a0, update FUN_0059e730: phase 0 the matrix = identity with rows 1 and 2 negated at the origin, FUN_00341750(C, 1) (0x400000), no blend, FUN_003448c0(C, 0, 0) plays C+0x640 once; phase 1 FUN_003460d8 -> done bit. FUN_003449a0 -> FUN_00340c00 copies 0x400000 to C+0x564 bit 4, and FUN_00343160 then takes the matrix from the root bone (FUN_005ad9c0, FUN_0034aae0). **The clips hold the path in world space (bone 1).** T: C+0x30 within 1.21 u of bone 1 at frame 13.05 + 0.6 x f over 760 frames; C+0x20 = minus the bone's row 2 (within 0.012). The clip list: `E023_CLIPS` (076505cb.bin, 21 clips).

**The next leg: script event 0x16.** The done bit -> FUN_00343160: C+0x564 bit 0x20 clear -> set, FUN_00341af0 -> FUN_00341988 (listener C+0x7d4, code 0) -> FUN_005887a0 -> event 0x16 (T: sp0_4 -> ms4_0 at f861; C+0x30 reads 0 for that one frame, phase 0's matrix). Event 0x16 picks by var 0 (the place), rand and var 2: clips, routines 6.. and 0x21.. (`0x114`), combat layer 2 (0x19e), the drop of records 81-86 (messages 0 / 1).

**Timed routines: cmd 0x114, the part worker 0230 could not decode.** FUN_0054cd70 case 0x114 -> FUN_0053fb80 (manager event 2) -> FUN_0054ddf8 -> FUN_0054dec0. r0 is a function **index**: FUN_00371490 = table end (VM +0x14) + [VM +0xc][r0] x 8, VM +0xc = script + [+4], the area stage_events.py calls globals. Scripts hold functions past their event table. ai.json `script_fns` (script -> index -> function; export_web_triggers.py). A routine runs with r0 = step; its result is the next step's clock from the start (+0x48), < 1 ends it (event 0x1b), except 0 at step 0; delayed code -4 -> manager event 0x17 -> FUN_0054dec0. enemy_ai `routineStart`, `routineStep`. **This switches on every script's routines (24 scripts)**, e001's included.

**Other commands translated:** 0x138 (HP), manager 0xa2 (record's HP == 0), manager 4 (an effect at manager +0x260), 0x14b (an effect at the body: L), 0x19d (a weapon shot, FUN_00569870 through shootMarker), 0x1aa (C+0x568 bit 0x100000, reader not looked at).

**Rockets.** Routine 6 / 7: `0x19d(25, 1, 4, 0xf / 0x10)`, from markers 15 / 16 (the pods); weapon 25: damage 80, homing bit. T w259_heli2: Vincent -78 at about f1340 (the game's zone scaling not compared).

**The paratroopers (records 81-86, scripts 159-164).** Event 2: `0x40(3)`, 0x10e, 0x108, 0x19b r_para*, 0x1aa. These clips land them in the market in world space through the same class; event 0x16 then gives brain mode 5. Clips added: 076506cd.bin (disc.py INPUTS, build_web.sh). Not checked against a trace: no drop was logged (rand in event 0x16). See HANDOFF.

**Left out, warned:** 0x126 / 0x127 (FUN_00341458 / FUN_00341518: a looping sound on the body, the rotor: the page's `sound` has one-shots at a fixed place and no stop), 0x1a9 (FUN_00340de0 -> FUN_00340d30, the C+0x7e0 object). Effect attachment: at the body's position (L).

## The rockets drawn, and how they hit (worker 0270, 2026-11-08; D + T)

Dan: "dragonfly boss fight missiles don't fire". They did fire on the page (routine 6 / 7, `0x19d(25, 1, 4, 15 / 16)`), but
nothing drew a bullet with a model and its hit test was the thin one, so a rocket that reached Vincent flew past him.

**The bullet record** (+0x194 = section 24 [W+0x7c], FUN_00554850; ai.json weapons, new fields): +0x84 the model's name
(`model`), +0xac the trail effect (`fx_trail`), +0xb0 the end effect, +0x9c the end sound (`se_end`), +0xb6 (char) the radius
(`f2c`), +0x78 flags. Weapons 20 / 22 / 25 (Dragonfly): w011, trail 0x405c0400, end 0x405c0800, asj_374, +0x78 0x12. Weapons
17-19 (the z128 boss's missiles): w011, 0x40600400 / 0x40600800. 23: w010 (0x40780800). The soldiers' records: none (their
+0x198 tracer, FUN_002d77c0: drawn since worker 0278, notes/effects-research.md 'Bullet tracers').
- FUN_00554850: +0x78 bit 2 -> bullet +0x2c = (char)+0xb6 (6), +0x120 |= 0x800, +0x28 |= 0x200000; bit 0x10 -> +0x120 |= 0x10000.
  T w270_rockets / w259_rockets: +0x120 0x10a00 on all 306 rocket steps; w235_missile 0x10800 on all 649 boss missile steps.
- **Model:** FUN_00553f48: +400 = FUN_00408b30(+0x84) (+0xc8, a motion: empty for every z128 record). Placed each moved update by
  FUN_00554058: the bullet's rows (FUN_0054a5e8: +0x60 / +0x70 / +0x80 / +0x90) with rows 0 and 2 negated, +0x9c = 1 ->
  FUN_005a6f40. Freed by FUN_005529a8 -> FUN_00553fe0. FUN_00558050 (show / hide by distance to the player, 15 / 5 / -18) only runs
  for W+4 bit 0x200000 (FUN_00552b48): not the rockets.
- **Rows** (FUN_00552dd8): +0x80 = dir; h = the axis of dir's smallest component (|y| <= |x| or |z| <= |x|: y if |y| < |z|, else z;
  otherwise x); +0x70 = unit(dir x h); +0x60 = +0x70 x dir. FUN_00556218 after a turn: +0x60 = unit(+0x70 x dir), +0x70 =
  unit(dir x +0x60). (Ghidra's `_vopmula(a, b); _vopmsub(b, a)` = a x b.)
- **Trail:** FUN_005534f0 (+0x140 nibble 0, a record, no model or +0x78 bit 0x20 clear): +0x188 = FUN_003358b8(record, 0) =
  FUN_003366b8(+0xac) (record +0xac == -1: none). Moved by FUN_00557e40 -> FUN_00557c68 -> FUN_003350c0(+0x188, rows; rows 0 and 2
  negated) -> FUN_002e7660(flag 0x10): +0xe0 = M, FUN_002d86e0 (rows to unit length), FUN_002d9cd0(+0x130, M) = the angles (x =
  -atan2(m9, m10), y = asin(m8), z = -asin(m4 / cos y), pi - z for m0 < 0; c == 0: x = -atan2(m6, m5), z = 0; x 651.8988),
  +0x120 = row 3. Ended by FUN_005529a8 -> FUN_00335210 -> FUN_002e7198 (soft end).
- **The FEDs:** FileCode 0x40000000 | model << 18: 0x405c0000 = noPath/076505c3.bin (e023), 0x40600000 = 07650603.bin (e024),
  linked in the global manager 0x4ee2e0 (FUN_003366b8 finds an id by FileCode). Also needed by routine 39's blasts (0x405c2400 ..).
- **End:** FUN_00554ea8, then FUN_0033d760(record, +0xf0): +0x9c -> FUN_0033cc48(name, +0xf0, 1) (range 400) in the same branch
  as the end effect. The page took the end effect from the *shooter's* W; the marker shots pass their own (FUN_00569870), so
  the rockets' end now comes from weapon 25's record.
- **The hit (FUN_005442d8, +0x120 bit 0x800):** the segment prev -> pos, if longer than 0.1, grows by unit x +0x2c at both ends
  (A', B'). For an object with +0x28 bit 0x200000 (Vincent: 0x20901f) and |A' - B'| > +0x2c: vt+0x184 (radius +0x2c; half with
  bullet bit 0x80000000 and vt+0x8c); else vt+0x19c (a sphere at B') then vt+0x3c. Vincent's vtable 0x58f128: +0x184 =
  **FUN_0055c480**: the capsule FUN_0055bc90 (feet .. 18 up) padded by +0x2c at both ends, FUN_0025c0f8(R 5 + 6, A', B'); else
  FUN_0025c770(5, A') or (5, B') -> the point FUN_0025d1b8(5, A') (nearest point of the capsule). No part boxes. Hit distance
  |A' - point|. (+0x184 and +0x19c / +0x3c are the same functions in every actor vtable found: 0x58e1f8, 0x58e600, 0x58e9f0,
  0x58f128, 0x58f4b0.)
- **T w270_rockets** (r06_market, w259_heli2's run, `TRACE_CALLLOG=missile`, f1210-1419): the rockets' object tests return a
  hit once, at f1313 (Vincent 9991 -> 9913, motion c_st_bl0 next record). A call in frame N runs between records N - 1 and N.
  Replayed with record N - 1's position: the fat test hits on that step and no other of 306; the thin test never (the rocket
  passes 10.5 u from his axis).
- **Range:** T +0x15c = 2020 for the rockets (and the boss's missiles): FUN_00321e20 true. Decoded: W+4 & 0x3a0000 clear and
  FUN_00312698 (DAT_0046b2fc != 0: 2 on SLES) -> FUN_00253fb8() = DAT_004e1078 (the auto-lock option) in 1..2; else W+4 bit
  0x20. So +20 vs +15 is the player's auto-lock option: the route states have it on, the sea-of-flames save the soldier traces
  came from off. The page keeps +15 (GUESS row): an options value it doesn't model.

- **The trail vs a GS dump (review follow-up):** grab_gs of w270_rockets at f1300 (tools/trace/out/w270: dump1300.json = dumpfx.py
  --fed e023.fed, state1300.json = fx_fixture.py with FileCodes 0x405c0000,0x40000 and manager 0x4ee2e0). The rocket's trail is
  e023 emitter 1 (age 246, 5 particles: tags 0 / 1 / 3 type 21 bursts, tag 2 type 10, tag 4 types 17 / 14 / 106 / 105). Restored
  from RAM, moved along T's rocket path, 4 frames, drawn with the state's camera: **45 sprites, 180 / 180 vertices within 4.5 px of
  a game vertex (worst 4.02), 176 with the game's RGBA**; the near-rocket draws left over are the 3 youngest sub-sprites of the
  replay (spawned during it) and none else. **Tag 4's draw type 105 adds no triangle in this frame.** Type 105 = vtable 0x49d6b8
  (init FUN_002ac058 -> FUN_002ab198, eval 0x2ac0b8, draw **FUN_002ac1e8**: two iterators over the type 106 channel's history,
  wrapped by data +0x52 / +0x53 / +0x54 in one of three adapters (0x49d640, 0x49d690 + FUN_002a6ed8, 0x49d668 + FUN_002a5a10),
  strip out of FUN_002ab2f8); type 106 = vtable 0x49f178 (init FUN_002d30d8, eval FUN_002d3190, loop FUN_002d3188). Not translated,
  warned (effects.js 'draw type 105 not translated'). The small pale trail in the first page image was its age (a few frames,
  against the game's 246): the aged page image shows the smoke column. **Not on the page, seen in the dump:** Dragonfly's own
  model effects (11 more e023 emitters at position 0: 4, 9, 10, 13, 14, model-attached: FUN_00336748 / MP+0x3e4).
- **The boss's missiles (review follow-up):** T w270_boss_missiles (route r0b_box4, w259_boss_box4c's run, f2125-2199): 198
  missile steps, the game's one hit on Vincent f2190 = the fat test's step; thin none; 137 HP (weapon 18 nwe024mn, 140) and the
  knock-down c_jp_fa0, both the same on the page (?warp=boss, missiles injected at T's f2186 state relative to Vincent). Their
  trails against the f2186 dump (tools/trace/out/w270b): **not aligned** (the grab run's missiles are not where the call-log run's
  are at that frame; no RAM fixture of the bullets was taken), so the e024 trail is only checked by eye.

Page: enemy_ai.js `bulletRows`, `bulletMatrix`, `playerFatTest`, `endEffect` (own W, `se_end`), hooks `opts.shotFx` (start at the
spawn, move after each moved update, end at the delete); enemy_hit.js `fatCapsuleHit`, `cylinderCross`, `insideCylinder`,
`capsulePoint`; effects.js `models` (model FEDs), `setMatrix`; new **shot_fx.js** (model + trail); play.js wiring.

## e036's fight (worker 0259; D + T)

**w259_e036** (r07_beat, replay of w217_r07_e036, f0-309; `TRACE_POKE=960660=270f TRACE_FIELDSET=enemy TRACE_ERECS=80,1 TRACE_ENEMIES=2 TRACE_EVARS=1`). Before: page vs T with the page's old rule: clip wrong on every flinch and the kill; position off by up to 16 u when a coin flip differs (see below).

**The hit area (FUN_0055d390), the reaction rows.** From FUN_0055db50 while the victim lives. C+0x590 low 4 bits: with C+0x564 bit 0x10000 clear, the zone record's word bits 8-11 + 1 (ai.json `zones[].area`), or by height with no zone (> 0.7 h: 2; > 0.3 h: 3 / 4 by x, else 1; lower 5 / 6). With the bit set (the flinch's FLINCH_BITS): by side and old area. T: e036's area per hit 1, 5, 1 | 1, 4, 1, 4, 1, 5 matches this table with the hit sides inferred. **The flinch's row** = FUN_00598950's jump table 0x5a3b10: 1 -> 0x25, 2 -> 0x24, 3 -> 0x26, 4 -> 0x27, 5 -> 0x28, 6 -> 0x29, else 0x25. Its blend: previous class == this class -> FUN_00340bb8(C, 1, 5), else none; FUN_00340bb8(C, 1, -1) after. **The death row: the same table + 6: L**, the writer was not found in two attempts (the class's own row 0xac is not it; no code has an immediate 0x2e). Three T points: #66 area 3 r_stlaf0, #67 area 1 (5 -> 1 under the flinch) r_stbf0, e036 area 5 m_stllf0. **Clean head kill (area 2 -> row 0x2a *_sthf0): no T.** All the rows are exported now (AI_MOTIONS, build_web.sh lists).

**Largest errors now** (node replay of T's hits, positions from the page's own flinches): flinch and death clips equal when the side matches (the replay has no real hit point: the hit side x is unknown, so areas under bit 0x10000 are not compared in the replay; the table is tested against T's sequence in test_other_types); flinch coin flips differ (one FUN_0040b5c0 draw, no shared RNG state): 16 u after 7 extra flinches at worst. Brain mode 5 fire times: T m_st_f f87, f99; page f79, f84, f93 in the same stretch (RNG), not compared further.

Tests: new test_heli (node, 30+), test_heli_page, test_other_types block 7, test_enemy_hits (expectations by area). Mutants: 19 / 19 killed but one equivalent ('event 0x16 every frame': every 0x19b script replaces the class in the event, or clears var 2; killed in no test). Baseline `test_death`, `test_hit_reaction`, `test_knock` crash on a missing `ladderHit` in player.js: another worker's work in progress, not this.

## Knock-downs and big hits on soldiers (worker 0259, 2026-11-04)

**TRACE_HIT takes a target now** (tools/trace/trace.py, fifth field: the actor's address): FUN_0055c7f8 + FUN_00565480 on any actor, so no route has to bring Vincent into firing range. It skips FUN_0055d390 (hit area) and script event 0x12. Address = object table (DAT_0046e880 -> +0x1164) [record + 22].

T (gitignored): w259_hit_soldier (route r02_npcfire; soldiers 69 / 70 have **no** walk polygon there), w259_hit_poly (route r02_walkway; 45 / 46 on the floor), w259_hit_npc.

- **Flags 2** T f120: m_stbd0 in state 3, 49 frames, m_st_a (FUN_00561570, as before).
- **Flags 4** T f200 / r02_walkway f40: **FUN_00562898**: state 0x18 -> class 0x3f -> row 0x3e (m_stbd0 / r_stbd0), 49 frames (FUN_003460d8), then state 3 with the gun, motion 5 (FUN_00539b48). C+0x564 |= 0x1c000 while it runs. On the page, flags 4 comes from the stagger chain (FUN_0055d950: 0x44 at the chain's second step) or a weapon's react flag (W+0xc); **Vincent's melee is not on the page yet** (aim_core.js input: no melee), so it doesn't reach this. Before this round a live soldier ignored those flags 4 hits.
- **Flags 8** on a polygon: **FUN_005618d0**. From the front (state 0xf): r_stbl0, r_bl_0, lands state 0x11, r_bl_1, state 2, r_rev_0. From within 130 degrees of behind (state 0x10): r_jp_dm0, r_fl_0, state 0x11, r_fl_1, state 2, r_rev_0, r_gst, r_st_a. Dead: the same, held in state 0x11. Without a polygon (FUN_005618d0's first test) it falls to FUN_00562898 alive, FUN_00560fc8 dead: why w259_hit_soldier's flags 8 looks like flags 4.
- **Mover 10 is FUN_003515e8:** the move at +0x320, then **on the ground** capped at the end value 0.5 and down by DAT_0046f480 (0.0125) x step to 0; off the ground down by +0x324 x step to 0.5. T's first frame takes the ground branch: 260.8 -> 29.1 -> 30.0 u/s, z 5.21 then 0.6 a frame. (Vincent's own T shows 255 down by 27 a frame, so he takes the other branch from the start; why they differ was not looked at.)
- **Class 0x38 (r_bl_ht0) is not reached** by a soldier 16.8 u up, though Vincent takes it above 15. Page: left out on soldiers.
- **An air kill is FUN_00561270 = FUN_005618d0, not mover 0xb.** react's stand-in killed a dog in the air with FUN_00560fc8's slide; test_dog_ai's three blocks had that expectation and now assert the knock-down. No dog trace.

**Page vs T (test_hit_trace):** state 0xf -> r_bl_0 15 (T 14), lands 46 (46-47), state 2 r_rev_0 121 (124), arc 19.0 u at rand 0.5 (T 16.8: the rise is a draw, not shared), first move 5.14 (5.21), then 0.58 / 0.60 (0.59 / 0.60), at the landing 32.7 u (30.4). From behind: r_fl_0 28 (27), then 24 and 100 frames (24-25, 100). **Largest error: r_bl_1's state 0x11 runs 74-75 frames against 77.**

**Page errors the replay found, both fixed:** a townsperson killed at area 0 played dead2 (T dead1): deathMotion's rule by part is gone, area 0 is table default + 6 = 0x2b (T #70 with part 10: m_stbf0). State 0x18 ended 2 frames late on the page's own clock: it asks FUN_003460d8 now.

**Left out, warned:** big hit in posture 1 / state 0x1d (motion 0x1f / state 0x1c). State 0x10 after a big hit off the ground. L: which of FUN_00562898's slide applies under `f118 & 0x1800` isn't traced (45 kept walking through its r_stbd0, moved 17 u on -x, no slide along +z). Vincent's roll, FUN_005ae618 and the cues are not on the soldier.

## Shots at townspeople (worker 0259, 2026-11-04)

T w259_hit_npc (r02_npcfire, TRACE_HIT 27 on 114, then 27 + 40 on 113): 114 HP 58 -> 31 -> 4 keeps 'fear', no flinch (flags 0). The third: f180 dead1, state 7, +0x28 0x20c40b -> 0x20c00b. **113 answers at once: state 2 in the same record, 'rn' 2 frames later.** Page (test_hit_trace): all of it. Real bullets don't reach them on this route: Vincent stands on the roof at (-1070, -146, -1106), and 340 frames of aimed fire at 113 landed no hit (w259_npc_shot; line of sight or range not looked at). So FUN_005ad118's part test on a townsperson has no T, only the page's.

## The rescue beat (stopped, two attempts; worker 0259, 2026-11-04)

Not reached in a trace. Attempt 1 (r02_npc2): Vincent's position poked inside trigger 24 ((-1125, -1, -1255), box +-52), then TRACE_HIT killed 69-71: no flag change in 500 records (flag 1 stays). Attempt 2 (r02_npc3): manager short 19 (manager 0x128380 + 0x28 + 2 x 19) poked to 1 before the teleport, so script 138's event 0xd has its condition at the moment he enters: flag 1 still not 5, 113 only loses HP to soldiers' shots (55 -> 39 -> 31 -> 25: 'fear' throughout). In both Vincent hangs in h_jp3 with C+0x4c0 cleared: worker 0256 saw a frozen Vincent run no trigger test, which fits; not shown here. **The page's rescue stays D:** test_npc_page drives it, no trace behind it.

## WRO men (not translated; worker 0259, 2026-11-04)

T w259_wro_a / b (r06_back, no input; records 103-108, 144, 145 awake there). 103: r_grn along its path, then r_gst, state 2. 108: state 3, r_st_a / r_st_f bursts (f213, f353), target an object id with low bytes 0x76 (their +0x6c2: a DG soldier, not Vincent), r_strad0 when shot: HP 230 -> 224, area 4's row. So they are soldiers with the same rows, and **they shoot other actors.**

What it takes: `candidate()` is a GUESS (= the player), and it's the soldiers' one too. FUN_005608e8 -> **FUN_00543780(-1, manager, 0, actor, 0, 0)**: mode 0: FUN_00563288(actor) -> FUN_00543638 = a side mask (0 -> no target); walks the object list at manager +0x1274, each by vt+0x8c, skipping the dead (FUN_0055a370, FUN_00316cf8), itself and ... the mask's test (FUN_00315738(status, 0x11), +0x40 bit 12) is where this read stopped; result nearest, table DAT_004ef1f8. Then: bullets between actors (enemyBulletHit is written for Vincent), FUN_0035fec0's switch FUN_0054a9d0 (MISSING in `retarget`), n017 / n018 / n022 in AI_TYPES with r_grn, r_gst, r_st_a, r_st_f and the rows exported, soldiers' side of it (they target WRO men too; 45 and 46 aren't near Vincent in those traces). It changes every soldier's target choice, so it wants its own job and traces, not the tail of this one. **Not done: the WRO men stay body-only on the page.**

**Review fixes to the above (worker 0259, 2026-11-04).** FUN_00565480's FUN_0055aa88 block is in react (states 8, 9, 0xf, 0x10, 0x1f-0x21): a live bullet in the air does nothing, flags 4 / 8 k 2, a kill k 0; the +0x118 bit 0x800 flag rewrite too. State 0x11 enters lying (stance 2, FUN_00539458; FUN_00565bd0(a, 2)'s height not on the page: L); its defaults reach FUN_00537aa0, so flags 4 lying is state 0x18 / class 0x3f; a flinch lying is FUN_00561718's same-state no-op. A re-hit during class 0x3f is class 0x1e (FUN_00562b30) and its end goes to state 0x18's handler. Movers 9 / 0xb walk the mesh (FUN_0034f178): the flat step only remains without the page's collision. FUN_00562898 tests C+0x4c0 / +0x118 bit 0x2000000. FUN_00561138 has its own function (`bigDeath`: turn, no FUN_003533e0). knock's order is the game's: mover 10, then FUN_0055b8e0, so mid-swing the attack leave stops it and the body falls alone. Off the ground at state 0x18's end: state 0x10. Dead at class 0x35 / 0x3a's end: C+0x664 7..9 -> state 7, else class 0x36: stop, 10 ticks, then +0x118 bit 0x100 (FUN_00539570). **L:** FUN_00565480's other way into the air block (attack states / state 1 / above 2 u with +0x100 bits 46-47): the page's actors don't write those bits. **Open, when melee arrives:** kills need FUN_0055d678's hit area.

**Second re-review (worker 0259, 2026-11-04).** `enterBody`: slide / knock re-place the body outside mode 0xc when not airborne (FUN_0034f178 -> FUN_00356d98): a script walk left B.poly stale, and navMove clamped him 61 u in a tick. No row or no kept frames counts as done in the knock-down's classes and class 0x3f (FUN_003460d8): townspeople have empty rows 0xa8-0xb1 and no model_clips; state confirmed by injected flags 8, real reach (a blast) unverified. Table: 0xf -> 0x10 class 0x38 (row 0xad, clip end 0x39), 0x11 -> 3 class 0x37. **Killed lying** is class 0xd, row DAT_005a39f0[C+0x590 & 0xf] = 0x37, 0x37, 0x36, 0x38 .. 0x3b (FUN_00595ea8): plausible for a soldier, traced on Vincent only, where T shows c_fl_1 staying on the head (jump_core's note): **if a soldier's trace disagrees the row request is what to drop.** Its C+0x564 bits are L (as class 0xb), its cue (FUN_00341330) isn't on the page. +0x118 bit 8 with flags 2 on a kill runs FUN_00560fc8. The 0x800 rewrite doesn't test flag 8 on its second arm. A re-hit's class 0x1e leaves state 0x18 at phase 1's end. A flinch lying writes +0x144, returns 1. AI_MOTIONS + 0xad, 0x36-0x3b and clips in build_web.sh: **re-run tools/byo/build_web.sh.**

