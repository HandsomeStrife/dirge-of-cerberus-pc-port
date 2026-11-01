# Title screen, main menu and pause menu (worker 0176, 2026-11-01)

Status: the flow, the menu layouts and the layout interpreter are decoded; the interpreter is
translated (`native/web/menu_layout.js`, test `node native/web/test_menu_layout.mjs`, 27 checks
against the game's live widget tree). **Nothing is drawn yet.** Both screens need one more big
decode before a faithful page is possible (see "Blockers"). No page was added, rather than
faking the visuals.

Data: `python3 -I native/assets/models/export_web_menu.py` writes `native/web/data/menu.json`
(gitignored) from the user's ELF: opcode lengths, layout scripts, title item tables.

## What the game shows (PCSX2, cold boot, PAL)

1. Boot -> opening FMV with staff credits (an FMV; skipped here). Start skips it.
2. Logo burn-in: black screen, "Dirge of Cerberus / Final Fantasy VII" logo flares in, white
   flash. It is a FED effect (a0086, emitter 0: 210 frames, spawns at 0/30/60/72/80 frames).
3. Title = main menu, no "press start" screen: background art (Vincent, moon), logo top right,
   items bottom left in a staircase: **Game Start / Tutorial Menu / Extra Features**, a cursor
   emblem left of the lit item, ember particles, copyright strip at the bottom.
4. Idle on the menu returns to the attract FMV (seen; the timer was not decoded).
5. Pause (Start in play): the scene keeps drawing behind a small framed panel "Pause" with
   **Restart / Tempsave / Quit**, first item lit.

Captures (game-derived, scratchpad only): title_menu.gs/.png, pause.gs/.png, EE RAM at pause.

## Code map

### Widget framework (shared by every menu)
- Screen base FUN_003d4040; screen +0x18 = root widget, +0x34 = vtable.
- Layout load FUN_003d41e0(screen, script, group, focusId, ., langTable) -> FUN_003ddc18 ->
  **FUN_003ca488** (the interpreter, translated). FUN_003d4160 / FUN_003d4198 = load + FUN_003d5110.
- Script: opcodes 1..0xd create a widget through `PTR_FUN_0047a6f0[op-1]` (sizes: 1 0x58,
  2 0x68, 3 0x8c button, 4 0x3c image, 5 0x2c8, 6 0xc4, 7 0x40, 8 FUN_003b65c0, 9 0x74,
  10 0x44, 11 0x8c, 12 0x9c text button, 13 0x7c); 0x0e..0x21 set fields of a 0x58-byte
  parameter block (defaults FUN_003ca9d8); length per opcode DAT_0047a6c8; 0xff ends. A type-1
  widget takes the rest of the script as its children (recursion). Field meanings are in
  menu_layout.js `paramDefaults()`.
- Language rect overrides: FUN_003ca488 param_7 = langTable[FUN_00242450()] when the language
  is < 7 and FUN_003e2760() != 0; each op 0x0e then takes 4 shorts from it. Pause table
  0x51fc00: languages 0-2 none, 3-6 have one.
- Widget fields (FUN_003c8910): +2 flags (bit 1 focused), +3 id, +4 focus order, +6..+0xc rect
  (made absolute: + parent x, y), +0x16 rgba, +0x1a image id, +0x20 parent, +0x24 first
  child, +0x30 next sibling, +0x38 vtable. FUN_003c8ab0 copies +0x1c/+0x1e; FUN_003ca160 sets
  the inner rect +0xe..+0x14 from the image's frame margins (not translated).
- Focused widget DAT_004f3034 (FUN_003dcc58); focus change FUN_003dde80 (via FUN_003dd6c8);
  root manager DAT_004f3030. Screen "has input" test FUN_003d5480.
- Drawing: base draw FUN_003c97a0 (image id -> table DAT_0047bfc0, 16 bytes per image: +0
  slice data, +4 texture page (FUN_003dd4a8(page + 6) binds 'menuN' from menudata.bin, as for
  the reticle), +5 slice kind -> 0x24-byte descriptors DAT_0047d180 (piece count, step);
  pieces FUN_003c9110 / FUN_003c94e0 / FUN_003c8dc0). Type 4 draw FUN_003d6ec0.
- Open animation: FUN_003d5c08(root, mode, ms?, 0x40) (pause: (2, 200, 0x40)); not decoded.

### Title (.kel_title overlay, 0xaa0000-0xaa8550, part of the ELF file)
- Main menu screen ctor **FUN_00aa3c98** (vtable 0xaa7280, global DAT_00aa6228). Layout:
  DAT_00aa6450 normal, DAT_00aa64c0 when script flag 0x19 is set (FUN_002413c0(0x19): one more
  item), 0xaa6550 when FUN_003e2730() != 0. Root 16,16 480x416; buttons (type 3, 160x24) at
  120,305 / 329 / 353 (/377), ids 0x17-0x19 (0x1b-0x1e, 0x20-0x22), focus order 0,1,3(,3).
- Item visuals FUN_00aa5050, table DAT_00aa6820 (normal) / DAT_00aa68e8 (flag 0x19), 0x28
  bytes per item: slot, widget id, two cursor positions, button rect (overwrites the layout
  rect: 70,310 110x24 / 82,334 / 94,358 124x24), four FED sprite-id lists (lit pair, unlit
  pair), position. Cursor sprites 0x81580400 / 0x81588000 (slots 0x14 / 0x15); 0x81580800 in
  slot 0x16 when flag 0x15 is set (FUN_00aa4b80). Sprite slots: FUN_00aa4d50 (spawn),
  FUN_00aa4c88, FUN_00aa4e30 (position, FUN_002e7660), FUN_00aa4ec8 (show/hide, FUN_002ec488).
- Per frame FUN_00aa4100: focus change -> FUN_00aa52e8(new id) swaps the lit/unlit sprites and
  sends sound/event 0x1c (FUN_003e1d10).
- Events FUN_00aa3e30: ignored until FUN_0023c1f0() >= ctor time + 0x5dc. 0x17/0x1b/0x20
  (Game Start) -> FUN_00aa44e0(1); 0x18/0x1d/0x22 (Tutorial) -> state 0xd or FUN_00aa44e0(4);
  0x19/0x1e/0x21 (Extra) -> FUN_0023c670, FUN_00aa44e0(3); 0x1c (cleared menu only); flags
  0x15 / 3 / 0xc open message boxes (layouts 0xaa63b0, 0xaa63d0, 0xaa63f0, 0xaa6370). Then
  FUN_003e1d10(0x1b) (confirm sound). Exit path FUN_00aa56f0.
- Save-list screen (FUN_00aa0078, 0x27cc bytes, 64 slots of 0x948): FUN_00aa0b30 builds the
  grid, FUN_00aa02d0 is its update; created from FUN_00aa56f0 -> FUN_00aa0000.
- **All title art is FED effect a0086** (`data/effect/anything/a0050/a0086/fer/a0086.fed`,
  FileCode 0x81580000; `a0086_on.fed` is the online variant). Sprite id -> FUN_002f0878
  queue (top nibble 8 -> 0x4ee4a0), FUN_002e6290 -> FUN_002e62b0: FED by id & 0xfffc0000
  (FUN_002e5c60), table A index (id >> 10) & 0x7f, entry id & 0x1ff -> spawn FUN_002e63d0.
  The GS dump confirms: background, logo, every menu letter (one quad each, plus additive glow
  copies) and the embers are FED particles; only the copyright strip is a plain sprite.

### Pause (FUN_003bfe28, vtable 0x4a5ab0, global DAT_00477670; dtor FUN_003c0110)
- Layout 0x477678 (normal), 0x477858 (FUN_002419d8(10)), 0x4778f8 (FUN_002419d8(0x11)),
  0x4779c0 (param 1), lang table 0x51fc00 (/20/40/60). Focus-order list 0x477c18 etc. ->
  FUN_003d58b8. Opens with FUN_003d5c08(root, 2, 200, 0x40); FUN_003caab8(root, 100).
- Tree (checked against RAM): root type 1 at 167,167 178x114 image 0xa; panel type 4
  167,175 178x96 rgba 80,80,80,1e image 0x34; three type-12 text buttons 176,194/220/246
  160x24, rgba 92,50,50,80, frame image 6, text offset 18,4, messages 0x80005c01 Restart,
  0x80005c00 Tempsave, 0x80005c02 Quit; header image 0x106 at 202,177; lines image 0x107.
  Unfocused buttons read 49,28,28,80 in RAM (colour halved after the build; not decoded).
- GS: panel/frames from tbp 10960 and 10828 (menu textures), text from a 4-bit font at tbp 0
  (PSMT4HL, CLUTs 16375-16378).

## FED evaluators (closes FED-FORMAT.md §7 item 1 in part)
The channel evaluator table DAT_0046c398 holds pointers to singletons at 0x4e8a68 + 8*k that
are built at boot, but each singleton is just a vtable pointer into **static .data**
(0x4996d0-0x49ef98). Read from EE RAM at the title: e.g. type 1 -> vtable 0x499d30 (methods
0x2d5730, 0x2d5738, 0x274548, 0x2744e0), type 21 -> 0x49aa78 (0x27cd68, 0x27bd70, 0x27d348).
Types 0-63 were read (0, 42-45 empty); the table is longer (the corpus uses codes up to ~320).
So the type -> evaluator mapping is recoverable: read u32 at 0x46c398 + 4*type from a RAM
snapshot, then its first word; the methods are ordinary .text functions in the decomp.

## Blockers (why there is no page yet)
1. **Title: the FED 2D runtime.** Spawn FUN_002e63d0, update FUN_002ea040 / FUN_002eadc0,
   apply FUN_002e7660 / FUN_002e7cd0, the per-type evaluators (above) and the particle draw.
   Even the settled frame goes through the evaluators. Too big for this job; it also unblocks
   the MISSING hit / impact effects (fidelity-audit rows by workers 0173 / 0174).
2. **Pause: widget drawing and focus.** Image table DAT_0047bfc0 / slice kinds DAT_0047d180
   and FUN_003c97a0's piece loop, the type-12 button draw (frame + text, colour per focus),
   the font path (message id -> string: text bins, native/text; glyphs PSMT4HL), focus
   movement FUN_003dde80, FUN_003d5c08 open animation, the pause event handler (vtable
   0x4a5ab0 slots), and the screen dimming. Mid-sized, decodable.
Suggested order: 2 first (smaller, gives a real pause menu over play.html), then 1.
