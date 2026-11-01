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

## Pause menu drawing (worker 0180, 2026-11-01): DONE, on the page

Blocker 2 is closed: `native/web/pause.js` (logic, emits GS-equivalent primitives) +
`pause_layer.js` (three.js, one draw call) + a hook at the end of play.js (Esc / Enter = Start).
Data: `python3 -I native/assets/models/export_web_pause.py [--dump pause.gs]` -> data/pause.json
(+ pause_ref.json for the test). Test: `node native/web/test_pause.mjs` (44 checks; all 84 pause
draws of the PCSX2 dump equal ours: xy, UV, RGBA, TEX0 / CLUT, CLAMP, TEX1). 14 mutants killed.

Decoded (beyond the code map above)
- Coordinates: layout units are a 512 x 448 grid. With script flag 0x1e (PAL; DAT_004f2258) every
  emitter (FUN_003d2e80 sprite, FUN_003d3098 strip, FUN_003d3880 scissor) maps x * 0x1b0 / 512
  (rounded toward zero, 1/16 px) and y * 512 / 0x1c0 into the 432 x 512 drawable.
- Image record DAT_0047bfc0: +0 slices (u, v, w, h signed; negative w/h = mirrored UVs), +4 page,
  +5 kind, +6 lit variant (0 / 2: the focused widget uses pieces [count, 2 count)), +7 repeat flags
  (bit 0 u, bit 1 v: the stretch piece gets CLAMP REGION_REPEAT with mask = slice size - 1, fix =
  slice u / v, FUN_003d3fb8), +8 four gradient colours (FUN_003c8dc0, untextured, under the pieces).
- Kind descriptor DAT_0047d180 (9 ints): lit offset, cols, stretch col, left / right margin piece,
  rows, stretch row, top / bottom margin piece. FUN_003ca160 makes the inner rect from the margins.
- Kind 4 (the root frame, image 0xa): FUN_003c9110 draws 5 gouraud quads per row from table
  0x47a6b0 (width index, slice, direction, colour offset): widths (w - mid) / 4, mid / 4, the rest;
  the outer quads fade to colour / 4 per channel; right / bottom edges + 15/16.
- Type 12 (text button): FUN_003d11c0 colours: focused frame = layout rgba, text 0x808a86ff;
  unfocused (image 6: FUN_003d1950) frame RGB / 2, text 0x80707070; disabled RGB / 4, text 0x80404040.
  FUN_003d75a0 then draws, for the focused one, the orb (image 7 piece 0 at x + w - 21, y + 8,
  colour 0x505092) and the highlight frame (image 8 at x + 2, y + 1, w + (img6.w0 - img8.w0),
  h - (img6.h0 - img8.h0)), both with alpha a = (750 - |750 - t % 1500|) x 0x60 / 750 + 0x20,
  t = FUN_0023c1f0 (ms) - DAT_004f55e8.
- Text: strings starting '$&' set widget +0x5e |= 0x480 and go through FUN_003cedf0: byte c is the
  glyph (ASCII - 0x1d); width = nibble (c - 3) of menudata.bin item 2 + 0x70, + 1 (c >= 0x62: 12;
  c = 3: space); cell u = ((c - 4) % 42) x 12, row r = (c - 4) / 42, v = ((r x 16 + 0x1d0) >> 5) x 16,
  CLUT 3 + ((r x 16 + 0x1d0) >> 4 & 1); per glyph a shadow sprite (w + 1, 15 tall, 0x60101010) and a
  14-tall quad, top = text colour, bottom 0x80ffffff. Spacing +0x65 = 0 (FUN_003e2760 true).
- Font page 1 'kelfnt0': TBP 0 PSMT4HH (bits 28..31), texels = the kelfnt0 TIM of fontdata1.bin
  (linear 4-bit, last 0x1c000 bytes of the image region). Two glyph sets share each texel: CLUT 3
  reads the low 2 bits, CLUT 4 the high 2 bits (alphas 0 / 0x1d / 0x53 / 0x8f, grey 0x80);
  FUN_003dcf58 uploads CLUTs 1..5 from 0x47d3c0 (flag 0x1e; 0x47d280 otherwise) to
  CBP 0x3fff - DAT_0047ad14 (4) - n.
- Pages 2 / 3 = 'menu3' / 'menu4', PSMT8 + 256-colour CLUT in menudata.bin (uk); the TIM tails
  equal the GS memory at TBP / CBP 10828 / 10824 and 10960 / 10956 word for word.
- Strings: kelstr.bin ("KelStr 1.1"), body XOR-ed with two 8-byte keys (FUN_003fd370); banks of
  1024 at +0x28 (offsets from +0x24), FUN_003fd578. Pause: 0x5c00 Tempsave, 0x5c01 Restart, 0x5c02
  Quit; box questions 0x5c06 (Restart: back to the checkpoint), 0x5c07 (Quit: to the title),
  0x5c08 (Tempsave: save, then the title); 0x3800 OK, 0x3801 CANCEL.
- TEX1: FUN_003d3830(1) (0x60, bilinear) around each type-12 draw and each text draw, (0) after the
  text, so the orb / highlight are nearest; FUN_003d58b8 sets widget flag 8 (bilinear) on the ids in
  list 0x477c18 = [6] (the "Pause" header).
- Screen timer (screen +0x28 end, +0x2c cur, +0x30 total, +0x10 flags): open FUN_003d5110 = 100 ms
  up (flag 0x10), close FUN_003d51c0 = 100 ms down (flag 0x20; closing mid-open mirrors the elapsed
  time), input locked by flag 2 (FUN_003d4780 / FUN_003d47b8). While cur < total every widget's
  alpha and the kind 0 / 4 heights scale by cur / total, the dimming (FUN_003d5c40: 512 x 448
  black, alpha 0x40) too, and the children are scissored at root inner y + inner h x cur / total.
- Input FUN_003de130: Start (action 0x24) opens screen 0x10 (table 0x47ab10 -> FUN_003bfd30) and,
  while open, closes it (FUN_003bfd70 -> FUN_003c04c8). FUN_003de568 actions (pad table DAT_004e1080,
  bytes swapped): 0 ✕ confirm, 1 ○ cancel, 2-5 up / down / left / right. Up / down with neighbour
  0xff: FUN_003cb018 walks siblings by focus order; wraps only for keyboard / mouse sources.
- Events FUN_003c0220 (id of the confirmed button): 3 Restart -> box 0x477a10 (0x25), 4 Tempsave ->
  0x477a50 (0x27), 5 Quit -> 0x477a30 (0x26). The boxes are type-8 widgets (FUN_003b65c0 ->
  FUN_003b66c0 -> FUN_003b7f38, layout 0x472ad8: root image 0xa 64,149 384x150, type-9 text
  widget, buttons OK id 6 / CANCEL id 7, CANCEL focused for kind 2). NOT drawn on the page: the
  type-9 text needs FUN_003cd7e8 (the non-'$&' renderer). Next job for the pause: that renderer +
  a PCSX2 capture of the open box.
- Freeze: the pause enters game state 0x17 (FUN_00241f40: script flag 0x12, FUN_00325490, sound
  volume FUN_003ed7d0(0x30)) and the destructor FUN_003c0110 leaves it, after the close.
