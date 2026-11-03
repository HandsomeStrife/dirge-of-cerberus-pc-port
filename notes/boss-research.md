# The z128 boss (e024) and the "event-spawned soldiers" (worker 0231, 2026-11-03; plan P6 part 2)

Code: `native/web/boss_z128.js` (the brain, translated; engine calls go through an `io` object), test
`node native/web/test_boss_z128.mjs` (38 checks; mutants via `BOSS_MOD=<copy>`: 6 / 6 killed). Not wired
into play.html (see Open).

## 1. The boss is the helicopter (e024, record 32)

- Record 32: model e024, stance 0x1a (FUN_00564228 case 'e024': FUN_00340ac0(C, 0x1a), actor +0x118 |= 0x80801c),
  AI mode 0 in the record, object script 242, weapon 15, HP 30000 in the record, at (516.9, -100.4, 1231.3).
  31 bones, radius 90 / height 120 (FUN_00563fc0), markers at (27, -1, +-65) (the missile pods, marker 15 / 16).
  The heri_* events (scr002 ev0103: heri_toujou, heri_dgsol, heri_taijou, heri_lastst, heri_lasted) are its
  scenes; there is no separate helicopter actor class.
- **Script 242** (06800001, `tools/stage_events.py ... --dis 242`):
  - event 3 (activation): cmd 0x143(256) = AI mode 0x100; cmd 0x156(120, 600, 60); cmd 0x157(1).
  - event 0x23 (stage start / restart), only when stage flag 0 == 36: HP by difficulty, manager 0xa7 (diff 3)
    or 0xa6 (diff 2) -> 22000, else 17000: cmd 0x1a3(HP), manager 0x6e(13, HP-10000, HP-10000, 1) (gauge 13; the pops give r0 = 13),
    manager 0x2f(99, HP) (manager short 99 = the bar's top), manager 0x6f, then 0x108 (activate itself).
  - event 0x17 (death): manager 0x70 (gauge off), manager 0xb(0, 40) = stage flag 0 = 40 (main's boss loop waits for it).
- **Modes 0x100..0x1ff** (FUN_0035f300): brain = plug-in DAT_0046e590 vt+0x14(mode). DAT_0046e590 is 0 in the
  save (no overlay loaded); then mode 0x100 gets no brain.

## 2. The boss overlay kel_boss_z128.ovl

- Loader: `Zone.boss(Z)` (ev0100 cp 334) -> FUN_0039c510 (1 argument: zone = *DAT_0047dbb0) / FUN_0039c568 ->
  **FUN_0037fe18**: on true, clears 0xaa0000..0xbf7eff (FUN_0044c790), reads file FUN_00249ca0(zone)
  (kel_boss_z<zone>), runs FUN_0023bf90(0xaa0000) (entry 0xaa0080 = j FUN_00aa30c8); on false unloads. Skipped
  in mode bit 0 (FUN_002419d8(0)). The stage +0x1570 / +0x1574 = load range.
- Of the five files (.ovl, .dvl, .pex, .pex.enc, _rel.pex.enc), **.ovl is the PAL ELF's**: 196 of its 197
  outside calls land on known function starts (the .dvl, a debug build with class-name strings
  "KelAppAiControlBossZ128_0", matches 16). Plain MIPS at 0xaa0000, 0x35b0 bytes. Decompiled headless (raw
  import, r5900, base 0xaa0000; 41 functions); not kept in the repo.
- FUN_00aa30c8(n): n >= 0 creates the plug-in (8 bytes, FUN_00aa3018: vtable 0xaa3560) = DAT_00aa3204 and calls
  FUN_00325a80; n < 0 deletes it. Plug-in vt+0x14 = **FUN_00aa3090**: mode 0x100 -> brain FUN_00aa1220 (0x7c
  bytes), others 0.
- Brain vtable 0xaa3508: +0xc FUN_00aa1350 (dtor), +0x14 **FUN_00aa1690** (enter), +0x1c **FUN_00aa16f8**
  (update), +0x24 FUN_00aa2fe8 (empty), +0x2c FUN_003612d8, +0x34 returns 0x38, +0x3c returns +0x1c,
  +0x44 FUN_00aa1658 (setup again; on failure mode 0).
- Unreferenced in the file: FUN_00aa01b8, FUN_00aa0a40 (-> FUN_00aa03c0), FUN_00aa0db8, FUN_00aa1070 (no caller,
  no pointer to them in the overlay): not translated.

### Setup FUN_00aa13a8 (enter FUN_00aa1690: AI +0x20 = 1, +0x14 |= 1, state 0)
Locators by name (FUN_00311c98 -> object FUN_0053ba48): btbox4 (required), btbox5 (else btbox4), btbox0..3
(required). Weapons by FUN_00aa0088 = min(FUN_00242c28(), 2): nwe024ge / me, gn / mn, gh / mh (g = gun, also set
as the status weapon FUN_00318610; m = missiles). +0x54 = 0xb4, or stage value "bshv0" (FUN_00aa08e8). Anything
missing -> FUN_0035f268(ai, 0).

### Update FUN_00aa16f8 (AI +0x24 = state, AI +0x26 = state timer on clock *DAT_0046f4e4; brain timers t0..t2
on *DAT_0046f4ec)
- Before: busy (FUN_0055ab08) -> state 10; motion class 1 done -> motion request 3.
- **0** init: actor +0x118 |= 0x80000000 and 0x1c, C+0x568 |= 0x1000000, body mode 6, C+0x1c0 bit 1, mover
  rates x3 (FUN_0034ad00(120k, 600k, 100k)), placed at btbox0, C+0x765 = 7, C+0x77c |= 0x80, bsj_291 (800) -> 1.
- **1** wait 61 frames -> 2.
- **2** decide: player dead -> wait; **HP < 10001 -> 9** (FUN_00aa2c30, on the last frame's HP); **damage
  counter >= 400 and hit this frame -> 8** (stagger); not at the box (C+0x1c4 bit 2) -> wait. Ready
  (FUN_00aa2bb8: no own shot alive, the player's motion not 0x34-0x37 / 0x39 / 0x3a, t0 > 59):
  player in btbox4 (FUN_00552330): count < 2 -> 3, else 4 / 6 by the alternation bit; outside: AI +0x14 bit 1
  clear -> 5, else 5 / 3 by the bit; the bit toggles. Not ready: up to 3 moves to the box opposite the player
  (FUN_00aa2ac8 nearest box, +2 mod 4), l_trn / r_trn, rates x3; then -> 3.
- **3** gun: W+0x48 shots, one each W+0x44 frames (FUN_00aa2ea0; kind 0x12 when the player is >= 60 u above,
  else 0x11; weapon g from the muzzle C+0x670); then rest W+0x46 -> 2 (count + 1). A stagger hit -> 8.
- **4** atk_sp1: bsj_292, a class-0xd attack volume on the boss (FUN_00541278: +0xe0 200, +0xd0 40, effect
  0x40603400, sound bsj_293, +0x54); at frame 84 body mode 0, dive to 60 u short of the player (FUN_00aa00b0),
  rates x5; arrived -> turn (0.5); turned -> mode 6 -> 2.
- **5** volley (FUN_00aa2c40): missiles from markers 16 / 15, 50 u up, 4 (8 after a stagger), speed x (0.8..1.2),
  asj_017; homing on after 44 frames (FUN_00aa2dd8); 120 frames -> 2 (after a stagger the damage counter resets).
- **6** atk_sp3: at frame 228 four homing missiles (+0x154 = pi) from the muzzle; done -> turn -> 2.
- **7** atk_sp2 (only after a stagger at <= 30 %, FUN_00aa2f78 = (HP - 10000) / (short 99 - 10000) x 100 <= 30):
  volley, 45 frames, climb 200 (rates x2), homing at frame 45, at 192 a pass 120 u from the player clamped to
  btbox5 (FUN_00aa0538) at y -110 (rates x6) firing the gun; done and arrived -> 2 (counter reset).
- **8** stagger: FUN_0055a828, idl_lean, effect 0x40602c00; frame 160 C+0x765 = 3, C+0x77c bit 7 off; lean
  (motion 2, effect 0x40603800) 180 frames; lean_idl (effect off), frame 230 back to 7 / bit 7; turn; then
  -> 9 (beaten) / 7 (<= 30 %) / 5.
- **9** beaten: body mode 0, 180 frames, FUN_00341518, actor vt+0x334.
- **10** busy: -> 2 when free.
- After: live missiles with +0x154 > 0 steer to the player + (sin, cos)(i x 45 deg) x 40..60 u (10..20 for 0 / 4),
  off within 80 u; dead ids -> -1. Beaten: actor +0x118 |= 0x207c, FUN_0054b508(a, 0), an effect
  0x40602400 + rand x 8 every 21 frames, bsj_294 once. Damage counter += last HP - HP; on a change the HUD
  gauge 0xd = (HP - 10000, >= 0) of (short 99 - 10000) (FUN_00aa11b8 -> FUN_003b58e0).

## 3. The boss beat in main (ev0100 scr000, pc ~10560-10930)
fadeout(500), scene_save(5) (not demo), sleep 500, changeMusicVol(30, 5000), setSkipMode(0), **heri_lastst**,
unsetSkipMode, global flag 1 = 29, loadchr n000 / n043 / p005, camera set (551.1, -108.6, 1451.3) /
(552.07, -108.78, 1451.43) / (551.1, -109.6, 1451.3), fov 73.5, active; **playMusic3("bgm_014", 0, 3000)**,
**playBgAreaSound("asj_034")**, **Zone.boss(true)**, wait_save, chaos, setBattleCameraInterpolationTime(1000),
set_usercontrol(1), set_battlecontrol(1), fadein(3000), Zone.battle(1500); loop (deb_jump / kashitani_dummy)
until **stage flag 0 >= 40** (the boss's death event); then peace, fadeout(300), **Zone.boss(false)**,
setVisibleAll, setSkipMode, heri_lasted. Main's locals: 79 = 36 (the flag record 32's event 0x23 tests),
80 = 29, 81 = 40, 82 = 33.

## 4. kalm_ld and the spawners: no event-spawned soldiers in story z128
- **kalm_ld(n)** (ev0100) only preloads models (Actor.loadchr / loadchrs, then Event.wait on each, and
  unload_residentmotion "e048"). Branches by n: 0 (e023 e027 e030 e048 e056 e057 + NPCs n023-n033, w004), and
  others; the e024 branch loads e024 e027 e056 e057 p000 w007. **e056 = breakable crates, e057 = explosive
  barrels** (gimmicks, notes/barrel-research.md), not soldiers. On the page all models are preloaded, so
  kalm_ld has nothing to place.
- **FUN_0053d610** (create an enemy from a record by name / weapon flags) is called only from FUN_00beac78 (the
  0xbe.. code, online mode). **FUN_0053d888** is called only from FUN_00518760 (spawn a record at a spawn
  point), whose callers are manager cmd **0x5d** (FUN_00545b20; no z128 script sends it:
  `stage_events.py --cmds 0x5d` is empty) and FUN_00549c38 (the wave spawner FUN_0054a268, object
  DAT_0046e930, made only when FUN_002419d8(0x11), which is 0 in story mode).
- So the helicopter soldiers are placed records activated by 0x108 like the others (already on the page).

## Open
- **Not wired**: no AI actor for e024 on the page (AI_TYPES), its clips (atk_sp1 / 2 / 3, l_trn, r_trn,
  idl_lean, lean, lean_idl) and the named weapons nwe024* (section 24 by name, FUN_00311c98) are not exported,
  the flying mover (FUN_005889c8 / FUN_0034ad00 / FUN_0034e960 modes 0 / 6, C+0x1c4 bits 2 / 3), missiles
  (FUN_00569870 kinds 0xf / 0x10 / 0x11 / 0x12, +0x154 homing, +0xd0 target), FUN_00541278's volume, the
  effects 0x406024xx..0x406038xx, the HUD gauge 0xd, and commands 0x156 / 0x157 / 0x1a3 / 0x70 and manager
  0x6e / 0x6f are not translated. The stage controller does not reach this beat on the page yet.
- **No trace**: no save state near the boss (route states end in chunk 02; the beat needs flag 0 = 36, event
  0x23, kalm_ld's e024 load and Zone.boss(true)). The brain is checked against the decode only.
- Unchecked readings: FUN_00aa00b0's operand order (VU macro code; read as player + norm(body - player) x k);
  *DAT_0046f4ec read as a frame clock (FUN_00aa2a10 uses it as one); AI +0x14 bit 1's meaning.

## Wiring, part 1 (worker 0231, 2026-11-03, manager follow-up)

Done (tests: `node --import ./native/web/test_hooks.mjs native/web/test_boss_wiring.mjs`, 31 checks; mutants 7 / 7):
- **Name dictionary** (section 0x11, FUN_00311c98 -> FUN_00311078 / FUN_0036f450: 929 sorted 16-byte entries from +0x10,
  name = bytes 0..7 last character first, +8 = section << 24 | index) exported as ai.json `names`; section 0x20 words
  as `values32` (FUN_00311a80 -> FUN_00311a18). btbox0..5 = triggers 195..200, nwe024ge / gn / gh / me / mn / mh =
  weapons 14..19 (record 32's own weapon 15 = nwe024gn), bshv0 = values32[0] = 0xc3.
- **Clips**: build_web.sh exports e024's idle, l_trn, r_trn, atk_sp1 / 2 / 3, idl_lean, lean, lean_idl (all in 07650600,
  already a disc input).
- **enemy_ai.js**: cmd 0x156 (FUN_00588b78 -> FUN_0034ad00: C+0x1e4 / 0x1e0 / 0x1e8 = r0 / r1 / r2), cmd 0x157 (r0 0 / 1 / 2:
  C+0x1c0 bits 0 / 1), manager 0x6e / 0x6f / 0x70 (FUN_003b58e0 / FUN_003b5378 / FUN_003b53c0: the gauge request kept in
  world.hudGauge(), opts.hudGauge hook; not drawn), AI modes 0x100..0x1ff (FUN_0035f300: no plug-in -> no brain, mode 0;
  with it mode 0x100 gets a brain record, its update not wired: warned). cmd 0x1a3 was already translated.
- **Zone.boss(Z)** (stage_controller.js; play.js `bossOverlay` -> world.setBossPlugin): FUN_0039c510 -> FUN_0037fe18 ->
  overlay entry FUN_00aa30c8.
- **fly_mover.js** = move mode 1 (FUN_005889c8): start FUN_0034add8 / FUN_0034ae00 / FUN_0034db80(C, 1, 1) ->
  FUN_0034bd10 case 1 (length +0x1dc, direction +0x90; C+0x1c0 bit 1: profile FUN_00349e98 -> duration +0x1fc; bit 0:
  constant speed +0x1d4); frame FUN_0034ea18 -> FUN_0034c388 case 1 (fraction = FUN_00349fb8(t) / length, speed
  FUN_0034a208, position = FUN_002611f4 lerp), t += dt, end FUN_0034d870(C, 1) case 1: snap to the target, mode 0,
  C+0x1c4 = (&~1) | 4 (the arrival bit the brain waits on). Left out: the mode-1 ground drop FUN_00356d98 (body +0x3b0),
  the body listener's event 6, FUN_0034bd10's path-timing branch (warned). L: FUN_0034bd10's return for a length under
  0.001.

Not done (needed before the boss can fight on the page; the brain would wait forever on these):
- **Turns**: the brain's FUN_0034e960(C, 0 / 6) and FUN_00aa0d50's FUN_0034ba30 / FUN_0034ba60(C, dir, 1) / FUN_0034bcf8(0.5)
  / FUN_0034e960(C, 1). Turn update FUN_0034de50 (468 lines): mode 1 = blend the facing C+0x2c0 -> +0x2d0 by +0x218 /
  +0x21c (or the profile FUN_00349fb8 on +0x2e0 / +0x2f0 with C+0x1c0 bit 3), FUN_00262ff0 / FUN_00262de0 build the matrix;
  done (FUN_0034e880) -> C+0x1c4 = (&~2) | 8. Only mode 5 is on the page (path_mover.js turnMode5).
- **Motion done / frame**: FUN_003460d8 is a GUESS on the page (enemy_ai.js); FUN_00346108(f, C) = C+0x7c8 == 0 or
  FUN_005a9120() >= f. The brain's phases use both.
- **Shots**: FUN_00569870 (223 lines; kinds 0xf / 0x10 missiles, 0x11 / 0x12 bullets), their object update (+0x154 homing,
  +0xd0 target, +0x12c speed), FUN_00569340 muzzle. The page's soldier bullets go through FUN_005409a8 instead.
- **atk_sp1's volume** FUN_00541278 (class 0xd; enemy_ai.js makeAttack has the class for melee), effects 0x406024xx-
  0x406038xx, the HUD gauge drawing (FUN_003b58e0), e024 in AI_TYPES and an io adapter for boss_z128.js.

## Trace attempts (worker 0231)
1. w231_boss (tools/trace/scripts): the save with stage flag 0 poked to 36 (TRACE_POKE=a06338=91309a24: zone object
   0xa06300 +0x38, key byte 0 = 0 in this save), no input, TRACE_FIELDSET=stage TRACE_CALLLOG=boss (new call-log set:
   the stage set + Zone.boss's FUN_0037fe18 site). **main falls through to the boss beat**: scene_save(5) at f186
   (main's 8664 loop exits at flag 0 >= 36, then flag 0 == 36 and global 1 = 3 < 29). Then the game's step stays 0 to
   f2000 (no musicvol, no heri_lastst): the checkpoint save holds, as worker 0219 saw after scene_save(1).
2. w231_boss2: the same with cross taps f300-900 (in case the save waits on a prompt): trace.py timed out (600 s) before
   2400 frames; no logs. Stopped after two attempts.
Next try: make scene_save return early (game-state bits 0xc / 0x10 / 0x14, or Event.isDemo true) or start from a later
state; heri_lastst and Zone.boss(true) should then follow.

## Trace of the fight and part 2 (worker 0231, 2026-11-03, second manager follow-up)

**Reaching the fight in PCSX2** (no fake overlay load):
- w231_boss3 (stage flag 0 = 36; the save box answered as w229_rescue at f400-700): scene_save(5) f186, changeMusicVol f529,
  heri_lastst f537 (zone (10, 11) loads f559 / f661), playMusic3 bgm_014 f1581, asj_034 f1582, **Zone.boss(true) f1598**
  (FUN_0037fe18 a1 = -1, a2 = 1), battle f1645. But the boss's brain never runs: actor +0x180 (status +0x88, the model)
  is 0, and FUN_00365110 runs a brain only with owner vt+0x26c (FUN_0056bdb8 = actor +0x180) set. The flag poke skipped
  the kalm_ld that loads e024.
- **w231_boss4 / route state r0b_boss2** (tools/trace/out/route, gitignored): stage flag 0 = 36 **and global flag 19 = 1**
  (TRACE_POKE a06338=91309a24, 50db30=98cc32cf): main's boss block takes its restart path (fadeout, **kalm_ld(3)** = e024,
  no scene_save), then heri_lastst, Zone.boss, battle. State at f1800 (route.py --prefix w231_boss4.json:1800; needs
  --frames >= the prefix; trace.py needs TRACE_LOG_AT for scripts over 1024 frames): actor +0x180 set, brain 0x8da900
  (vtable 0xaa3508 = the decode), AI mode 0x100, DAT_0046e590 = DAT_00aa3204, HP 17000 (difficulty 1), body
  C+0x1e0 / 0x1e4 / 0x1e8 = 600 / 120 / 60 (cmd 0x156 as decoded). HUD gauge (the boss gauge's name) on screen.
- **w231_fight2** (from r0b_boss2, 660 frames, TRACE_FIELDSET=enemy TRACE_ENEMIES=1 TRACE_ERECS=32 TRACE_BOSS_BRAIN=8da900,
  the new fields.py option): state 3 (rest) -> 2 at f84 (aiTime 240 = W+0x46), 2 -> 5 at f135 (timer 0 > 59), volley of 4
  (slots 0, 1, 4, 5: prev != 8), 5 -> 2 at f236 (120 ticks), then 2 to the end: slots 0 / 1 stay alive, so ready()
  re-stamps timer 0. Vincent (no input) stays at the save's spot. Both brain clocks = the AI scheduler clock (+1.2 / frame,
  PAL); a frame's update reads the clock already advanced (the next record's ai_now).
- **test_boss_trace.mjs**: boss_z128.js from the game's brain bytes, the game's clock and shot lives: **all 659 frames
  match** (state, sub-state, count, moves, alternation, shots, timer 0, shot slots); mutants 6 / 6 (ready 60 ticks, gun rest,
  volley 120, the alternation pick, the volley size, dropping dead shots).
- Not reached in 660 frames: moves (the boss stays at its box: the player is at the save's spot), states 4 / 6 / 7 / 8 / 9.

**Turn mode 1** (native/web/turn_mover.js; FUN_00aa0d50 = FUN_0034ba30 / FUN_0034ba60(C, dir, 1) / FUN_0034bcf8(k) /
FUN_0034e960(C, 1) -> FUN_0034dc50 case 1; frame FUN_0034de50 case 1 + FUN_0034ea18's +0x218 timer; end FUN_0034e880 case 1
-> C+0x1c4 = (&~2) | 8): the quaternion slerp as a yaw turn on the page's upright facing. C+0x1c0 bits 2 / 3 (angle speed /
profile) warned. Turn mode 6 is enemy_ai.js turnBody (C+0x2b0 via setAim), already on the page. Not traced (no turn in
w231_fight2).

**Motion done / frame** (enemy_ai.js motionDone / motionPast): FUN_003460d8 = 1 without an MP, else !FUN_005a9860:
MP+0x440 bit 20 (set only when the MP's model failed to load, FUN_005a8c40) -> 0; layer count +0x449 < 1 -> 0, >= 2 -> 1;
1 -> FUN_005aa200(head): a clip that does not loop with frame +0x18 >= count +0x1c - 1 -> 0 (clamped). FUN_00346108(f) =
2 x head frame (FUN_005a9120) >= f. Queue: FUN_005a9398 (flags bit 2 resets it: z128's requests), FUN_005aa5b8 / FUN_005aa2a8
pop the head when it ends. **Used** for one-clip requests (the raise-gun phase 1, motion 0x8a). **Not** for three-clip aim
requests FUN_00345818 (0x57-0x59 / 0x40-0x42): the game reads the shot's motion done on phase 2's first update (T k_fire_emp15
#66 r_st_f f786 -> r_st_a f788; r_st_f has 10 frames), which this does not explain; two attempts (the layer queue, MP+0x440
bit 20): stopped, those sites keep their GUESS (labelled).

**Shots** (decoded, not translated): FUN_00569870(-1, actor, W, aim C+0x670, 4, marker, -1) = from the body's marker
(FUN_003461a0: 0xf / 0x10 = the pods at (27, -1, +-65), 0x11 / 0x12 = the gun bones 28 / 26) to the aim point ->
FUN_005409a8 (the soldiers' bullet spawner too; W+4 0x400000: end = aim, else start + dir x W+0x2c / 6); FUN_00552ac0 =
the bullet's target id. FUN_00569340 fires the status weapon as well (FUN_005694f8). Homing lives in the bullet update
FUN_005549f0: +0x150 bits 20-23 pick FUN_00556068 / FUN_00556218 (1, reads +0x154 / 60) / FUN_00556528 (2): not translated
(enemy_ai.js bulletFlags warns on W+4 bit 0x2000).

**atk_sp1's volume** (decoded, not wired): FUN_00541278 = FUN_0053db98(mgr, 0xd) + activate (enemy_ai.js makeAttack's class):
FUN_00579ef0(2) type 2 (+0xec 8), FUN_00579f70(1) sphere (+0x140 = DAT_0046ef3c), +0xc0 bits 4-7 = 0xc, FUN_00579ff8 damage
= bshv0 = 195 (cap 9999), FUN_0057a018(owner id) (offence via FUN_0057a248), +0xe0 = 200, +0xd0 = 40 (radius), FUN_0054bf48
= attached to the owner's matrix (FUN_0054b9b0; makeAttack attaches to markers only), +0x130 effect 0x40603400, +0x134
sound bsj_293.

Still open: the page hookup (e024 in AI_TYPES, the io adapter), homing shots, the volume's owner attach, the gauge drawing (the aim-request
motion done: closed by worker 0236, below), a page image of the fight.

## Three-clip motion done (worker 0236, 2026-11-03)

Closes "the aim-request motion done" above. The shot's early end is not a "done" read:
- **FUN_00596460 phase 2** (asm 0x596550-0x5965b0): `jal FUN_003460d8`; done -> request; not done: `c.olt.s 30, timer`,
  `bc1fl 0x5965a4` (timer <= 30 skips the request); 0x5965a4 = `+8 |= 1`, return 6. So phase 2 always ends on its first
  update; FUN_00345818(C, 0x40, 0x41, 0x42, 0x83) runs first only when done or timer > 30. FUN_00597c60 (0x78-0x7a, 0x16)
  is identical. T k_fire_emp15 #66: r_st_f f786, phase 2 f787 (not done: frame 0.5 of 10, no request), r_st_a f788 from
  motion 6's first update.
- **Three-clip request**: FUN_00345818 by C+0x590 bits 25-26: 1 -> clips (p2, p3), 2 -> (p2, p4) through FUN_003456f0 ->
  FUN_00344608 (second clip != 0: C+0x564 |= 0x400) -> FUN_00344bd0 -> FUN_005a9398(w, MP, A, B, blend, flags): one layer
  at MP+0x200 + 0x30 x slot: +0x200 A, +0x208 B, +0x210 = count B / count A, +0x214 w, +0x218 frame 0, +0x21e flags,
  +0x21f 0x80 (speed); 0 (or the C+0x79c bit 3 angle case) -> FUN_003456c0 one clip (FUN_003449a0 -> FUN_005a91c8). Same
  queue rules as one clip (bit 2 resets, bit 0x80 drops a same-clip(s) repeat).
- **Done** FUN_003460d8 -> FUN_005a9860 -> FUN_005aa200(head layer): `ld a1, 0(s0)` (0x5aa218) = clip A; its count +0x1c.
  The frame advance FUN_005aa2a8 likewise (MP+0x40c x +0x1f / 128 x step). So motionDone (clip A, frame >= count - 1)
  holds for both. Motions 0x18 / 0x19 (FUN_005978e8 / FUN_00597ae8) phase 1: timer > 20, or timer >= 10 and done.
- On z128 the done branches never fire in the traces (r_st_f is at 0.5 on phase 2, m_sq_a 60 / m_st_a 160 frames); test
  'three-clip motion done' in test_enemy_ai.mjs sets a finished head clip. Mutants 5 / 5 (always / never request, drop
  timer > 30, crouch without / with any-time done).

## Hookup: the fight on the page (worker 0235, 2026-11-03)

**On the page now** (play.html, from the save with stage flag 0 = 36 and global flag 19 = 1 set at run time: the page's own stage
controller takes main's boss block and calls Zone.boss(true); its stage-load pass sends event 0x23): record 32 is an e024
actor with HP 17000, gauge 13 = 7000 / 7000; AI mode 0x100 gets the overlay brain (boss_z128.js through new
**native/web/boss_io.js**), it is drawn (enemies.js), flies between its boxes (move mode 1), fires gun bullets and homing
missiles from its markers, takes damage from Vincent's shots (its part boxes), staggers, and at HP < 10001 is beaten:
180 ticks later vt+0x334 -> script event 0x17 -> stage flag 0 = 40. Vincent takes the gun hits (HP 780 -> 175 in the page test).

Decoded / translated:
- **Homing** (enemy_ai.js `homingStep`, `homingRoom`): FUN_005549f0 dispatches on bullet +0x150 bits 20-23 (FUN_00552dd8: W+4 bit
  0x2000 -> mode 1 and +0x154 = W+0x3c deg -> rad; otherwise bit 0x2000 in +0x120 and mode 0). Mode 1 = **FUN_00556218**: target
  FUN_00557f38 (+0x12a set: the object's vt+0x5c; -1: +0xd0), axis = dir x unit(target - pos) **not normalised**, angle
  FUN_00260fe8 / FUN_00261038 (acos; 0 at cos >= 1, pi at <= -1; sign of (dir x d) . axis, so never negative), clamp +0x154 / 60,
  above 0.001 FUN_00259f60(angle, axis) (Rodrigues with the raw axis) x dir (FUN_0026135c), renormalised; pos += dir x (+0x12c x
  step), +0x158 += the same; ends past +0x15c or (no +0x120 bit 0x2000000) speed <= 0 / age > 1800 / +0x158 > 3000. Mode 2
  (FUN_00556528) is the ballistic one (grenades), not used by the boss. Without +0x120 bit 0x2000 FUN_00556870 tests the room
  on every segment (stage vt+0x17c), after the objects.
- **Marker shots** (`shootMarker`): FUN_00569870(k, actor, W, aim, n = 4, marker, -1): start FUN_003461a0 (marker on its bone,
  `markerWorld`), W+4 0x400000 aim = start + unit x (W+0x2c / 6), then FUN_005409a8 (`spawnShot`, now with its own W), target =
  FUN_005630c0 (the actor's). The boss's gun shot = FUN_00569340(actor, C+0x670) (the status weapon, FUN_005694f8: W+0x78 bit
  0x800 clear) **plus** FUN_00569870 from marker 0x11 / 0x12; a volley = FUN_00569870 from marker 0x10 / 0xf aimed 50 u above
  the marker. Overlay FUN_00aa2ea0 / FUN_00aa2c40 (0231's decompile).
- **atk_sp1's volume** (`bossVolume`): FUN_0054bf48(o, owner, **1**) parents it to the owner's **marker 1** (71.9, -8.5, 0 on
  bone 2, the nose), not the bare matrix: +0x3a = 1, +0x3b = -1, followed every frame (attackCentre). Constructor FUN_00579d00:
  +0xc1 = 1 (every target). FUN_0057a830 plays +0x130 (effect) and +0x134 (sound) at the hit (attackApply).
- **Motion class 1** (`motion1`): FUN_00341780(C, n) -> FUN_00341918 -> the motion object; the class's vtable from FUN_00592918
  case 1 = **0x5a6ba8**: enter 0x593b08 (C+0x564 |= 0x4000 | 0x200000), leave 0x593b30, update **FUN_00593b60** (slot clips
  C+0x640 / +0x648 / +0x650 once each, done when a slot is empty or after the third). Class 2 = 0x5a6b28 (cmd141Motion), class 3
  = FUN_00593d90 (loco3). FUN_00344840(C, a, b, c) = the three slots.
- **AI +0x20 = the scheduler interval**: the brain's enter sets it to 1 (T w231_fight2: due = last + 1), so the brain runs every tick.
- **FUN_005459d8** (`event23`): script event 0x23 to every object of the manager's type lists, at the end of FUN_005453b0 (the
  stage-load pass) and FUN_0053ca50. Now at the end of the page's stageLoad.
- FUN_00aa0538 (clamp to btbox5's local x / z, back to world) and FUN_00341518 (stop the C+0x80c sound) in boss_io.js.
- **The gauge** (not drawn, warned): FUN_003b58e0 id 13 = case 0xc: label = string 0x4729f8[f] (FUN_003fd578), FUN_003aec10 on HUD
  +0x7c (|v|, lag), +0x7e = max; FUN_003b56f0 widens the slot-4 elements by 0x3c for id 13; FUN_003b5378 = panel 4 in
  (FUN_003afcf8); the bar is FUN_003b5d58 (callback 0x46 of slot 4): FUN_003aed60 rows 0xb (HUD +0x88), 9 / 0xf (+0x7c),
  FUN_003af1e0 rows 10 / 0x10 below a quarter; the label is DAT_00471384's text object (FUN_002f51d8, FUN_003b5488). Needs bar
  rows 9-0x10 and slot 4's elements in hud.json and the text object: open.

Checks against the game:
- **w235_missile** (new; r0b_boss2, no input, `TRACE_CALLLOG=missile` (calllog.py, new set) frames 130-330): every bullet at
  FUN_00556870's object test (position, direction, +0xd0, +0x150..+0x15c). **homingStep matches all 645 missile steps (505
  turning): position within 1.2e-4 u, direction within 2.4e-7** (test_boss_trace.mjs). Range +0x15c = 2020 for nwe024mn = W+0x18 x 10
  + 20: FUN_00321e20 is true here (the page's GUESS takes +15; see fidelity-audit).
- **w235_move** (new; r0b_boss2, the left stick held in a square, records 531-1189, `TRACE_LOG_AT=9e100`): the brain still
  matches every frame (one 30-shot gun burst, record 985). **Vincent does not move in this route state**: P+0x90 stays at the
  save's spot (-1395, -99, -1111) while his run clips play (fields.py `TRACE_PPOS=1`, w235_ppos); poking P+0x90 / C+0x30 into the
  arena is undone the next frame. So no trace has the boss in states 4 / 6-9 or a missile reaching Vincent: that needs a real
  route to the boss (three attempts: stopped).
- trace.py needs `TRACE_SCRATCH` = the pcsx2trace unit's scratch dir (its EnvironmentFile) when the default /tmp/dirge-trace has no
  trace.env.

Tests: test_boss_trace (+ w235_move, + the homing check), test_boss_wiring (+ 12 hookup checks), new **test_boss_page.mjs**.
Mutants 17 / 17 killed (homing 5: turn limit, renormalise, axis order, the 0.001 gate, speed x step; hookup 12: brain update,
body step, motion class 1, gauge, marker start, the 0x23 pass, AI_TYPES, homing mode, placeAt, volume marker, turn start, motion
request).

Open: the gauge drawing; FUN_00340de0(C, 3) (state 0's body flag); FUN_003367e0 (effect end); the effects' attachment to the model
(placed at the body position, L); the muzzle effects FUN_00335a68 / FUN_00335b60; a trace with Vincent moving in the arena; the
drop model g058 (404 at the boss's death: items.json lists it, data/items has no g058.glb).
