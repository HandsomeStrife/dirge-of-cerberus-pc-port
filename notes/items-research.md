# Item pickups and drops (worker 0224, 2026-11-03)

Plan item P5, the drops / pickups half. Page: native/web/items.js (logic, joins the enemy AI world), items_view.js
(draw); data: native/assets/models/export_web_items.py -> data/items/items.json + the item models (build step "item
pickups and drops"); tests: `node --import ./native/web/test_hooks.mjs native/web/test_items.mjs`, `node
native/web/test_items_page.mjs`. Items are named by id only (game text comes from the disc).

## The item object (type 8, class vt 0x590a68, constructor via FUN_0053db98(mgr, 8, -1))
- vt base 0x590a68 (entries: s16 adjust at +n-4, pointer at +n). +0xc FUN_00580d38 (cmd 0x1a4 -> +0xca, else
  FUN_0054cd70), +0x144 FUN_00580298 (activation), +0x164 FUN_00580870 (touch), +0x214 FUN_0057ff80 (update),
  +0x234 FUN_00580a58 (after a move: FUN_00580388 places the model).
- Fields: +0x90 place, +0xc0 item id, +0xc4 count (FUN_00580590), +200 u16 flags (bit 0 wait for a script, 2 dropped,
  3 placed, 4 Vincent inside, 5 kind 10, 8 hidden (small on screen), 9 key items 0x6b300002/3, 10 other pickup window,
  12, 14 life timer), +0xca dropper's actor +0x100 (its section-1 record), +0xcc / +0xce placed record / taken bit
  (FUN_00580718), +0xd0 model (MP), +0xd8 fall speed, +0xdc spin clock, +0xe4 life start.
- Placed items: section-15 gimmicks whose section-14 type has class byte +0x14 = 2 (FUN_00548348 case 2). Type +0x28
  id, +0x2c u16 count. Skipped when taken (FUN_0031e1a8(k): bit k of *(DAT_0046e228+0x290)+0x24, k = the class-2
  counter +0x10f3). Record +0x48 bit 2 -> +200 bit 0. Active at the save (gimmick +0x28 bit 0, save RAM): records 22,
  24, 26, 27, 28, 123, 141 = areas 105 / 69 / -1. What activates an area (FUN_00542920, from Vincent's position) is not
  translated: GUESS export_web_items.py SAVE_ACTIVE_AREAS, as props.

## The model and the update (FUN_0057f6f8, FUN_0057ff80, FUN_0054c308)
- Model by item (FUN_0057f6f8), index into the ELF table 0x5909c0 (18 x 5-byte names): special ids first (0x6931001a /
  0x6932000b -> 0x11, 0x69310013 -> 9, 0x69310000 -> 8, 0x69310003 -> 10, 0x69310017 -> 0xd, 0x69310019 / 0x6932000c ->
  0x10, 0x6b300000 -> 0xc, 0x6b300001 -> 4, 0x6b300002 -> 0xf, 0x6b300003 -> 0xe); placed (bit 3) -> 1; else by kind
  (bgd item +0xc): 3 with an ammo part (section 5 +0x10 & 0xf0000 == 0x50000): 0x62300001 -> 7, 0x62300002 -> 6,
  0x62300003 -> 0xb, else 5; kinds 4 / 9 -> 2; 10 -> 0xc; else 0. Files: FUN_00249cb8's id scheme (export_web_enemy).
- FUN_0054c308 screen size = +0x30 (7) x 256 / (|camera +0x30 - place| x camera +0xd0); camera +0xd0 = 0.7467 in the
  save = tan of half the 73.5 fov (+0x4c) = 1 / the projection x scale. < 3: +200 bit 8, FUN_005a85f8(model, 2)
  (hidden, no update); >= 3 shown; >= 5 the spin clock runs (t = frame - +0xdc), else +0xdc = frame (t = 0).
- Colour (FUN_005a86a0, MP+0x41c) = (c, c, c, 0x80), c = ELF table 0x590a48 [t & 31] + 100. Spin: rotation about y,
  (t & 0xff) x 0.024543693 - pi (FUN_005a7018). Fall: +0xd8 += step x 0.1; model y + speed >= place -> on the place,
  speed x -0.624649; at 15 above at most. Settles at -0.0461 (save RAM). T: r02_barrier RAM: frame 5954, +0xdc 3862
  -> colour 0xd4 and row 0 (-0.493, 0, 0.87): t = 2091 (the update runs before the frame counter's step).
- FUN_00580388: a dropped item's model (bits 3 and 7 clear) is placed 10 above the place, so it falls.

## The pickup (FUN_00573c60 -> FUN_005442a0 -> FUN_00589a78 -> FUN_00549598 -> vt+0x164 FUN_00580870)
- Vincent's vt+0x234 FUN_00573c60 (after his move): if he moved (distance^2 > 0) and +0x28 bit 2, both the new
  position and the previous one (body +0x50) 7 up -> the object grid walk along the move; each object with +0x40 bit 3
  and active gets vt+0x164(new, old). L: the page tests every active item (the grid only narrows the candidates).
- FUN_00580730 (q): xz distance (VADDz: x + z of the squares) < 8 and -18 < q.y - place.y < 5 (bit 10: DAT_0046ef48,
  -13 .. 13; not translated). FUN_00580870: new out -> clear bit 4; new in, bit 4 clear -> take; new in, bit 4 set ->
  old in: nothing, old out: clear bit 4. The take's result: 1 -> FUN_0053fa08 (delete) and placed: FUN_0031e0e0(k, 1);
  2 -> vt+0x144(0, 1); >= 0 -> bit 4 set. Activation (FUN_00580298) sets bit 4 when Vincent is already inside.
- FUN_00560110(P, item): status +0x20 (HP) 0 -> no. FUN_0031f0f0 on the inventory (status +0x80): can't -> [sound
  0x58d938], +0xd8 = -1.1 (FUN_00580438), HUD notices FUN_003b2dd8 / FUN_003b3538(2) (not translated). Then the item's
  script event 0x47 and Vincent's event 0x3a (r0 = item id, r1 = the item object) through vt+0x2f4; the result is the
  VM's stack top (FUN_00371318 -> FUN_0036fe20; no event: DAT_004ef400 = 0). Mode 0 -> FUN_005740c0 (add) and
  FUN_00580450 (effect 0x4800 at the place); 2 -> taken, no add; 3 -> add, deactivate. Sound by item (0x58d940 /
  0x58d948 / FUN_0031e2c8 -> 0x58d950, else dropped 0x58d958 / placed 0x58d960); FUN_00560098 -> FUN_003b3538(0):
  the HUD notice (not translated: a formatted text log that may also open the item list FUN_003b47d0).
- Script 246 event 0x3a ends `push 0; ret`: mode 0. It compares r1 with cmd 0x3e(22) (record 22's object) -> flag 2 = 7,
  and with cmd 0x1a4 to the item (= the dropper's record) 45 -> 8, 122 -> 5, 125 -> 2, etc.
- T: w224_item22 (w220_box's inputs, TRACE_FIELDSET=items TRACE_ITEMS=13cec0): record 205: count 2 -> 3, flag 2 = 7,
  +0x28 0x8860b (delete queued), +200 0x18. Vincent 7.97 from the place (radius 8). w224_drop (from r02_barrier, stick
  forward): record 47: 0x62300000 219 -> 255, flag 2 = 8. The page takes both at the same record.

## The inventory (FUN_0031e940, FUN_0031f0f0, FUN_005740c0)
- *(status +0x80): +0x26 slots (60), +0x34 entries of 12 bytes (u32 id, u32 count, u32). bgd.bin item (FUN_00310560,
  sections 3 / 0): +8 flags (bit 0 stacks), +0xc kind, +0xe stack max, +0x10 value. Stack: count + n capped at max; at
  max: -1. Kind 4: FUN_003213d8 adds value x n to DAT_0046e248 +8 (cap 99999999). A success with DAT_0046e290 +0x30
  set: DAT_0046e54c |= 0x6e (the HUD's ammo text, hud.js).
- Save RAM: 0x69300000 x 2, 0x62300000 x 225, 0x62300001 / 2 x 0, 0x70300000 / 0x70310000 x 1, gil 0. The ammo
  item's count = aim_core's Ammo.inv + 27 (the other slots' loaded rounds; worker 0214), so a pickup raises the reserve.

## Drops (FUN_0055cac8 -> FUN_00316d70 -> FUN_00541688)
- Gates: actor +0x28 bit 2 clear, bit 5 clear, +0x118 bit 22 clear. FUN_00316d70(status): from save version 0x1d on
  (FUN_00310c40 = FUN_00312248 of the save's "bzdNNN": 48): status +0xc (= section-1 +0x40) bit 18 -> none, bit 23 ->
  (section-1 +0x5c id, +0x60 count); else two RNG draws r1, r2: (int)(r1 x 100) < parameter set +0x70 -> table at +0x1d0
  (5 x {u32 id, s32 count, s16 weight}) by (int)(r2 x 100). Status +0xc bit 14 -> life -1 (and FUN_00518968, not
  translated), else 0xe10 frames (FUN_0053e9e0 timers -7 / -3, FUN_0057fe78, FUN_00580c10: not translated, warned).
- FUN_00541688: an item at FUN_005636b0 (the actor's +0x90) with a random yaw (one draw), activated; +200 bit 2, +0xca.
  Place: a grounded actor (body +0x3b0 polygon, C+0x1c0 bit 0x200) -> its body position; else FUN_0057fb38: the room
  ray from 5 up to 300 down (FUN_0035cca0; flags 0x112 refuse it) and the object rays FUN_005449f0 (not translated).
  Then FUN_00580410: effect 0x4800 at the place.
- z128: record 45 (page actor #67) drops 0x62300000 x 36 (bit 23, no timer); record 44 none (bit 18). Save RAM
  r02_barrier: the drop at (-951.52, -160.39, -1084.89), +200 0x4, +0xca 45.

## Open
- Item use (the item list and its input; the use effect FUN_00335c40 -> FUN_00336748, reached through a pointer, not
  found in two searches) and the heal: not decoded.
- The HUD pickup / full notices (FUN_003b3538 / FUN_003b2dd8) and the item list (slot 8, FUN_003b47d0, FUN_003b4670).
- Drop life timers and the fade, the object rays, area activation, key items (bits 9 / 10), weapon items (bit 1).
- The items' draw path (VU1 program, lighting): GUESS unlit, texture x c / 128.
- Restart: the inventory and taken bits are kept across a Restart (L: the save data block is not reloaded on the page).
