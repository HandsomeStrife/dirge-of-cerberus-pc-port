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

## Item use, the heal, the item buttons (worker 0243, 2026-11-03)
FUN_00335c40 is not the use path: nothing stores or calls its address (no pointer, no `jal`, no lui / addiu pair in the
ELF); it maps an item id to an effect id (0x69300000 -> 0x82400) for a caller not found. The use is **script-driven**:
- **Input** FUN_003320c0 (the player's control update, every state on foot): pad id 0x1d pressed -> FUN_00573db0; else
  0x1e -> FUN_00574058(P, 0) (next); else 0x29 -> FUN_00574058(P, 1) (previous). Pad table 0x46bae0 (6-byte rows:
  u16 mask in byte-swapped libpad order, ..., u8 id): **0x1d = D-pad right, 0x1e = D-pad left, 0x29 = mask 0** (no
  button). Gates: FUN_003242e8's mask (DAT_0046e290 +0x10 | +0x18; ~0 in game states 7 / 5) bit 0x2000 (use) /
  0x4000 (cycle), FUN_00574d30's result, the input object's +0x54 bit 8 (use). Page: E / Q (play.js help line).
- **FUN_00573db0**: HP != 0, the inventory's selection +0 != -1 -> manager request 0x1c (FUN_0053fbe8), +0xc = the slot.
- **FUN_0053fde8 case 0x1d -> FUN_00573eb0(P, slot)**: HP != 0; entry (FUN_0031e658) id != -1 and count != 0; bgd record
  flags bit 2 (usable); **FUN_0054e138(P, id, 0x68)** != 0 (the item's script, event 0x68); P+0x28 bit 5 (a linked
  object +0xbc: FUN_00bec9c0, overlay) not on Vincent; **FUN_00568ea0(P, id)**: Vincent's event 0x39 (r0 = id; vt+0x2f4;
  script 246 / 297 have none -> 0): 1 -> not used, 0 -> FUN_0054e138(P, id, 100), 2 -> used; P+0x28 bit 2 ->
  FUN_0031d668(4, 1) (section stat 4). Used -> FUN_0031eb60(inv, slot, 1). Then DAT_0046e54c |= 0x6e, FUN_00324440(0xd).
- **FUN_0054e138(P, id, ev)**: the bgd record +6 = the item's script: FUN_0031e208 -> FUN_00310718(n) = bgd section 9's
  base + section 8's u32[n] (DAT_0046dd68 +0x24 / +0x28; n out of range -> 0). FUN_0036fd58(VM DAT_0046f4dc, P+0x20,
  script): the host is Vincent, so target -2 is Vincent. Result an int (a float cell truncated, asm 0x54e1d8).
- **The Potion (0x69300000, script 0)**: event 0x68: cmd 0x172 (HP == max) -> sound msj_001, 0; else 1. Event 100:
  cmd 0x125 msj_010, **cmd 0x14b 0x82400** (the effect), **cmd 0x12d 200** (the heal), 1. Other usable items have their
  own scripts (bgd scripts 0-27; 32 usable items, kind 2 with flags bit 2).
- **Vincent's commands** (vt+0xc FUN_00571b60 -> FUN_005661e8): 0x12d: request 5 with +0xc = r0; 0x12e: +0xc = +4 -
  +0x20; 0x172: HP == max -> 1; 0x173: r0 < HP -> 1; 0x14b: FUN_00336658(r0, P+0x100, vt+0x26c model) -> FUN_00336748:
  the effect from **the model's FED** (MP +0x3e4; FUN_002dbc80) attached to the model (FUN_002e8d50 / FUN_002e77f8).
- **The heal**: request 5 -> FUN_0053fde8 case 6 -> vt+0x1f4 = **FUN_0055c910(P, n)**: FUN_003168e8 (0 < HP < max: HP
  += n, capped at max; else nothing), vt+0x32c FUN_00576b10 -> FUN_0055ca20 (FUN_00567d00: the number popup returns for
  Vincent) and vt+0x344 FUN_00576c28 (DAT_0046e54c |= 4: the HUD HP). No motion or state change.
- **FUN_0031eb60(inv, k, n)**: count -= n (all when fewer); an emptied entry whose record has flags bit 1 clear is cleared
  (FUN_0031eaf0 -> FUN_0031e858(k, -1): the selection -> -1 if it was k; the slot back to the pool FUN_0036e2c8, whose
  free list is LIFO: FUN_0036e6b0 pushes at the head, FUN_0036e2a8 takes it). FUN_0031e940 (add) ends by selecting a
  usable kind-2 item when nothing is selected.
- **Selection** FUN_0031f3c8(inv, k): +0 = k, +0x10 = the id, +0xc = the last id (k out of range: +0 / +0x10 = -1).
  **Cycle** FUN_0031f520(inv, dir): every slot with an id, a count and a usable kind-2 record -> {id, record +0xa, slot};
  more than one and no selection: +0xc's id joins as slot -1; one entry (or no selection and no +0xc entry): the first,
  unchanged -> 0; else sorted (FUN_003203c0, comparator 0x31f4e0: +0xa then the id) and +1 / -1 with wrap.
  FUN_00574058: moved -> FUN_0054b158(P, 0x58ee70 = msj_012, 1); FUN_003320c0 then DAT_0046e54c |= 0x6e, FUN_00324440(0xe).
- **HUD**: FUN_00339590 bit 3 -> FUN_0031f448 (the selection's entry, or -1) -> FUN_003ae308(HUD, id, count): slot 6
  0x1b = FUN_003fd690(id) (kelstr's item table; -1: the empty text 0x4a5220), 0x1c = digits (count < 1: code 0x10).
- **T: w243_potion** (TRACE_FIELDSET=items TRACE_CALLLOG=w243 TRACE_POKE=960660=258: HP 600 / 780). Record 21 (the
  logic after the frame-20 press): use_req, event 0x68 = 1, msj_010, effect 0x82400, event 100 = 1, FUN_00568ea0 = 1,
  remove(slot 0, 1), heal(200): HP 780, HUD HP 780 / 780, HUD item (0x69300000, 1), count text 0x15 -> 0x14. Frames 91 /
  201 (full HP): msj_001, event 0x68 = 0, nothing else. Frame 151 (left): FUN_00574058 -> 0, no sound. Inventory header:
  +0 = 0, +0xc = +0x10 = 0x69300000, +0x26 = 60.
- Page: items.js `input` / `useSlot` / `playerCmd` / `heal`, Inventory `setSel` / `selected` / `remove` / `cycle`;
  enemy_ai.js (the request queue's types 0x1c / 5, runEvent with an object's own script table, Vincent's command hook,
  world.postManager); hud_core `setItem`, hud.js bit 3; export_web_items.py (all bgd items + `script` / `key`, `scripts`,
  sounds.cycle) and export_web_hud.py (`item_names`): **re-run both**. Tests: test_item_use (hooked, the trace; mutants
  18 / 19, the survivor equivalent: Vincent's parameter-set script has only event 0x25), test_item_use_page.

## The HUD notices and the text logs (decoded, not on the page)
- FUN_003b3538(HUD, kind, id, n): kind 0 (pickup, from FUN_00560098): text = sprintf(kelstr message DAT_00472820, the
  item's name (FUN_003d24c8 / FUN_003fd690), n) (FUN_00248e98); it goes to **log 1** (and opens it:
  FUN_003b47d0(HUD, min(lines + 1, 4) << 4 | 8), FUN_003b4670(HUD, 0x14b4) = 5.3 s) when the item is kind 10, kind 2
  NOT usable (flags bit 2 clear), or kind 3 without an ammo part; else **log 0**. So the Potion's and the ammo's pickups
  go to log 0. Kind 1: message DAT_00472824 (n); kind 2 ("can't carry", from FUN_00560110): DAT_00472828, log 0; kind 3:
  FUN_003b4b68 / FUN_003b4c20 (log 2); FUN_003b2dd8 = HUD+0x538's vt+0x7c (another panel).
- FUN_003b3cd0 -> FUN_003b3a20(HUD, text, style, log, lines, cap): four ring-buffered logs: +0x578 (8 lines, log 0),
  +0x85c (4, log 1), +0x9d0 (4, log 2), +0xb44 (1, log 3); 0x5c bytes a line (text +8, width / height +0x54 / +0x56 via
  HUD+0xba4's vt+0xdc, colour from table 0x472864 by style, position from 0x4728f0 by log, its life byte 0x472868, start
  clock FUN_003e2450). FUN_003b3d68 (per frame, from FUN_003b41d8 in the HUD update FUN_003add28): life end -> drop the
  oldest; phases from the style's table PTR_DAT_00472860 (fade in / slide / blink kinds 1-5); the scroll when a line is
  added. FUN_003b41d8 resizes the item list (FUN_003b47d0) when log 1's count changes. The draw (FUN_003b48b0) and the
  message texts are not read yet. **Not on the page** (items.js warns as before).

## Open
- The use effect 0x82400 (Vincent's model FED, MP +0x3e4: which file, and attaching an effect to a model in effects.js).
- The HUD text logs above (draw, phase tables, the formats), and the item list (slot 8) that log 1 opens.
- FUN_00324440(0xd / 0xe) (DAT_0046e290 +0x14 request bits; their reader not decoded).
- Drop life timers and the fade, the object rays, area activation, key items (bits 9 / 10), weapon items (bit 1).
- The items' draw path (VU1 program, lighting): GUESS unlit, texture x c / 128.
- Restart: the inventory and taken bits are kept across a Restart (L: the save data block is not reloaded on the page).
