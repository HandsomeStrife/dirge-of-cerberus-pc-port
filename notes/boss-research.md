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
