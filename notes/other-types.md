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
  the next step (code -4); < 1 ends it with event 0x1b). **Not translated**: which script +0x42 is (an object read through VM +0x20)
  and the function lookup FUN_00371490 (VM +0xc table) were not decoded in two attempts; no stage script has events 5 / 6.
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
- The helicopter's strafing (script 112 event 0x18 / script 180: 0x19d at 134-137, 0x191, 0x190 prop 124), its event motions
  (0x19b 'srch00'), its sounds (0x126), e001's routines (0x114).
- Corpse fade draw. (Done in the review round: every mgr +0x20 reader is on S.mgr20; see HANDOFF.)
