# Explosive barrels in z128 (worker 0209, 2026-11-02)

Code: `native/assets/models/export_web_props.py` (-> data/props/props.json), `native/web/props.js` (logic, in
enemy_ai's world), `native/web/props_view.js` (draw), hooks in enemy_ai.js (`opts.props`), effects.js (`spawn` scale),
play.js (`?props=0` = off). Tests: test_props.mjs (node, hooked + trace), test_props_page.mjs (page).
D = decoded from code / data, T = matches the trace w209_barrel, L = likely, G = guess.

## 1. Where they are (D)

- **Stage section 15** (146 x 0x90) = placed gimmicks, built by FUN_00548348 at stage load: +0x00 matrix (row 3 =
  the object's **centre**), +0x40 index into section 14, +0x44 script, +0x48 flags, +0x4c parent area (manager table
  +0x2b4, cmd 0x3b), +0x4e. Manager +0x5b2 [k] = the object id (script cmd 0x3e).
- **Section 14** (54 x 0x48) = gimmick types: +0x00 model name, +0x0a hit material, +0x10 flags, +0x12 flags,
  +0x14 class (0 -> object type 10 = class vt **0x5914e8**, FUN_00583708; 2 -> type 8, 3 -> 0xf, 4 -> 0x10, 7 -> 0x12,
  8 -> 0x13), +0x15 shape (0 box, 1 sphere, 2 cylinder, 3 cube), +0x16 HP, +0x18.. sizes.
- The barrel is type 3, model **e057** ("kan1Shap", kan = can): cylinder r 5.5, h 15, **HP 1**, material 3, flags
  0x80157. 13 section-15 records use it (17, 18, 19, 20, 60-66, 87, 138). The e056 boxes (HP 90 / 280) are breakable
  crates that drop items (scripts 154-158: cmd 0x2d item, no explosion); not on the page.
- **Active at the save**: only record 17 (object 479, (-916.3, -147.5, -832.1), among soldiers 46-49). RAM:
  +0x28 0x8003 (bit 0), HP 1. Rule: FUN_00584220 (vt+0x14c) activates a gimmick unless +0x48 bit 2 (records 20, 62-66,
  87, 138 wait for a script), and a gimmick sits in a parent area (FUN_00548348: FUN_0053b920(+0x4c) -> FUN_0054c550,
  +0x40 |= 0x100); only areas 2 and 15 (objects 3, 7) are active in the save, so 18 / 19 (area 18) and 60 / 61 (area 1)
  are off. What switches an area on is **not decoded** (GUESS `SAVE_ACTIVE_AREAS`, export_web_props.py). Script 0's
  stage start (event 0x22) swaps 17 for 138 (cmd 0x10a / 0x108) on difficulty 3 only.

## 2. The barrel object (D)

- FUN_00583b10: +0x104 HP = type +0x16, +0x2c bound radius (cylinder: |(r, h/2)| = 9.30, RAM), FUN_0054b7c8 matrix,
  script = +0x44 (record 17: **196**). FUN_00583d70 maps type flags to +0x38 / +0x40 / +0x28 bits (bit 0 -> bullets
  test it, bit 8 -> +0x40 bit 5 = explosion target, bit 11 clear -> +0x38 bit 2 = lockable).
- Model: FUN_00583848 makes a motion player by the model name; FUN_005842c8 puts it at T(0, h/2, 0) x the object
  matrix when type flag bit 4 is set (RAM: +0x90 y -147.5, MP+0x10 y -140.0 = the floor). MP+0x450 = 128, +0x44e = 0.
- Activation FUN_00584018 (vt+0x144): event 3 with param_3. Script 196 event 3: unless difficulty 2: cmd 0x16e(1)
  (+0x38 bit 2) and 0x11a(0) (+0x28 bit 0x1000 clear).
- Bullet filter FUN_00584f40 (vt+0x1ac): kind 0 / 1 (FUN_00554738) -> type flag bit 0, 2 / 3 -> bit 19.
- Hit test FUN_00584408 (vt+0x17c, mode 0), shape 2: the closed cylinder centre +- row 1 x h/2, radius r, through
  FUN_0025c0f8 (the soldiers' cylinder code).
- Bullet hit FUN_00585000 (vt+0x1b4): event 0x12; material +0x0a != 0 -> FUN_003361b8 (hit effect) and
  FUN_0033d528(mat, rand, pos) (impact sound, one shared-RNG draw); **type flag bit 6 -> only a bullet with +0x120 bit 2
  breaks it**: FUN_005405b0 sets +0x120 |= 0x100004 when the shooter's status +0x60 has bit 1 (Vincent 0x8233; the
  soldiers' 0 / 1), so **soldiers' bullets stop on a barrel but never break it**. Damage = bullet +0x134 (flag bit 15
  clear). FUN_00585bf0 -> vt+0x1ec FUN_00585cd8: HP -= dmg; <= 0 -> HP 0 and script **event 0x17**, else event 8.
- Script 196 event 0x17: if manager short 64 == 0: cmd 0x104(var 0 = 1) to records 46-49 (the soldiers next to it);
  0x10f (FUN_0053d960: manager +0x260 = the barrel's position); **0x2a(65.0, 120)** (300 on difficulty 2); 0x10a
  (FUN_0053fa08: the barrel is destroyed; nothing is left).
- Script 259 (records 60-62): 0x10f, manager 4 (effect 0x6001 scale 3.5), **0x2b(65.0, 200)** (no sound / effect),
  0x125 sound, 0x10a. Script 260 / 290: other barrels (not active at the save).

## 3. The explosion (D; object type 7, vt 0x5906c0)

- Manager 0x2a / 0x2b -> FUN_00540b90(radius, mgr, 0, mgr+0x260, damage, owner -1, fx = 0x2a) -> FUN_0057f040:
  +0x90 pos, +0xd4 radius, +0xd8 radius x 0.2, +0xd0 0, +0xc8 0, +0xcc **60.0**, +0xdc damage, +0xe0 owner, +0xc4 = 0
  then |= 0xa0 (bit 2 only when the owner has +0x28 bit 2). With fx: FUN_0033d6b0 = FUN_0033cc48("**bsj_065**", pos, 1)
  and FUN_00336280 = FUN_003366b8(**0x800**) (FED r0000 emitter 3) + FUN_002e7660(flags 5: pos, scale = radius x
  DAT_0046e534 (0.1) = 6.5).
- Update FUN_0057e638 (vt+0x214): first call FUN_0057ed98 gathers up to 32 targets: active, +0x40 bit 5, filter
  vt+0x1c4, inside (vt+0x194) or nearest cylinder point (vt+0x3c, FUN_0025d1b8) within the radius. Then each frame
  +0xd0 grows by +0xd8 (max +0xd4), +0xc8 += step, and FUN_0057e7d0 handles **one target per frame**: the ray from the
  centre toward the target's middle (FUN_0054ae78: +0x40 bit 7 -> matrix x (0, h/2, 0)) x radius; a wall more than 10
  units in front of it blocks; else FUN_00541b08 and the target's **vt+0x1cc**. No target left -> FUN_0057ebb8 (one
  sphere ray a frame, 32 directions: only material-6 walls react, FUN_0057e6f0 -> FUN_00550098). At 60 ticks it is
  removed.
- Characters, vt+0x1cc: soldiers FUN_0055e498, Vincent FUN_00572418 -> FUN_0055e498 (his +0x28 bit 0x20 is clear).
  Damage FUN_0055e240 = FUN_00318120(status, +0xdc, kind FUN_0057f0e8 = 1) (the bullets' defence), cap 9999, 0 with
  +0x118 bits 0x20 / 0x40; HP through vt+0x1ec; reaction FUN_00565480(actor, **8**, dir, centre, alive before); event
  0x15. Soldiers credit Vincent (+0x188 byte 1, FUN_00563288). Vincent's returns 0: no screen flash FUN_00336508.
- Barrels, vt+0x1cc FUN_00585448: type flag bit 6 needs the explosion's +0xc4 bit 2 (an owner with +0x28 bit 2): a
  barrel's own explosion has owner -1, so **no chain reaction** (and no z128 barrels are within 65 of each other).

## 4. Check against the game (trace w209_barrel, T)

Script `tools/trace/scripts/w209_barrel.json` (pokes in its doc): w204_t56's run east into trigger 56; the pokes move
object 479's +0x90 onto the walkway's shot line and turn script 91 event 0xd's first 0x101 into `send 0x121` to object
479, so the game itself re-registers the barrel in the object grid (FUN_0054b770 -> FUN_00584268 -> FUN_0054b6c8) and
moves its model (FUN_005842c8; trace field b_mp = centre + 7.5 down). New tools: call-log set `barrel` (calllog.py;
`barrel_b` has the hooks that did not fit), `TRACE_BARREL=1` (fields.py), `TRACE_POKE` in grab_gs.py.
- f231 gun up (bsj_018), f271 R1: fire sound bsj_051; the lock-on had taken the barrel (P+0x2b0 = its +0x90).
- **f273** (2 frames after the shot, the pellet countdown): FUN_00585000 with bullet +0x120 = 0x502485 (bit 2 set),
  +0x134 = **49** -> FUN_00585cd8(49) -> HP 0. Impact sound bsj_027 at the hit point first, then (inside event 0x17)
  FUN_0057f040(65.0, dmg 120, owner -1) at the barrel centre, bsj_065 there, FUN_003366b8(0x800).
- Same frame: the explosion's first update gathers **[Vincent 0x160016, the barrel 0x1df01df]** (+0x16a = 2; the barrel
  is still listed: FUN_0053fa08 only marks +0x28 |= 0x80000 and queues the delete), and handles Vincent: FUN_0055e240 =
  **118**, p_damage 118 (HP **780 -> 662**), FUN_00565480(P, **8**, dir (-0.9849, 0.1442, 0.0955), centre); Vincent is
  shoved 5.0 u that frame. f274: the barrel (FUN_00585448 returns at type flag bit 6). No soldier in range.
- +0xd0 13, 26, 39, 52, 65, 65...; +0xc8 += 1.1999999 with the EE's **round-toward-zero** add (59.9999 after 50
  updates), so **51 updates** (f273-f323); the sphere-ray index +0x169 counts 1..32 over f275-f305.
- Page vs game (test_props.mjs): every value above matches (clock and radius bit-exact over 50 updates); 14 / 14
  mutants killed (radius use and value, damage, both bit-6 guards, the deferred delete, growth, one target per frame,
  the 10-unit wall clearance, round-toward-zero, Vincent's bullet flag 0x100004, the blast defence, flags 8, the credit).

## 5. Open
- Area activation (which gimmicks come on as Vincent moves); barrels other than record 17 never appear on the page.
- Effect 0x800 (r0000 emitter 3): it draws now (channel types 5 / 53 came with worker 0208's effects work), but
  the particles with channel type 46 are still warned and not drawn; not graded against the f276 GS dump yet
  (tools/trace/out/w209_gs: dumps at f262 and f276, PCSX2 shots next to them).
- The explosion's wall ray: probe 7 / 0xd (FUN_002419d8) taken as the bullets' probe set (GUESS).
- The lock-on lists barrels (props.js lockTargets, lock_on.js r2 / cyl / dR overrides; T: the trace's aim = the barrel's +0x90).
- dtex's PSMT8 deswizzle selector (descriptor +0x11) is OBSERVED, not decoded; the PSMT4 rule (rst.c) contradicts it for
  339 wide PSMT4 images and is left alone until a dump shows one.
- The knock-down reaction to flag 8 (FUN_005618d0 / FUN_00562898) is not translated (enemy_ai react warns).
