# The in-game HUD (worker 0175, 2026-11-01)

On the page: `native/web/hud_core.js` (the translated draw list), `native/web/hud.js` (GS stand-in +
play.js hook, `?gamehud=0` off; `?hud=0` hides only the page's debug text), data
`native/web/data/hud/hud.json` from `python3 -I native/assets/models/export_web_hud.py [--dump DUMP]`,
which also declares it in data/scene.json (`"hud"`; export_web_room.py keeps it): play.js fetches it
only when declared, so no 404 without the data. Tests: `node native/web/test_hud.mjs` (draw list vs
the hero dump), `node native/web/test_hud_page.mjs` (browser: blend, pixel centres, cost).

## Structure (all decoded)
- The HUD is a screen of the generic menu-widget system. Constructor FUN_003ad618 (vtable 0x4a52e8,
  object in DAT_00471380), per-frame update FUN_003add28. It builds 11 panels from layout byte code in
  the ELF (FUN_003d41e0 / FUN_003d43f8 / FUN_003d4478 -> FUN_003ddc18 -> FUN_003ca488): ops 1-13 create
  an element (ctor PTR_FUN_0047a6f0[op-1]; op 1 = group, its children follow), 0xe-0x21 set attributes
  (lengths DAT_0047a6c8: 0xe rect, 0xf rgba, 0x16 id, 0x17 sprite, 0x14 text flags, 0x20 corner colours),
  0xff ends. Slot i -> HUD+0x38+4i; tables 0x4718d8, 0x471898, 0x471938, 0x471910, 0x471810, **0x471390
  (slot 5, HP gauge)**, **0x4714d0 (slot 6, weapon / ammo / CHAIN / item)**, 0x471760, 0x471970 (slot 8,
  item list), 0x471c18, 0x471c50.
- Draw order: every top-level group is a sibling (+0x30) of the root (HUD+0x18, the reticle's group):
  root -> slot 1, 3, 4, 5, 6, 7, 8, 9, 10 -> other screens. Element: +2 flags (bit 0 hidden with its
  children, 2 selectable, 8 bilinear, 0x40 / 0x80 fade exemptions), +3 id, +6 x y w h (absolute HUD px),
  +0xe inner box, +0x16 rgba, +0x1a sprite, +0x24 first child, +0x34 owner (the HUD: fade +0x2c/+0x30,
  clip height +0x26), +0x38 vtable (type 1 0x4a64b0, 2 text 0x4a67b0, 4 sprite 0x4a66f0, 7 callback
  0x4a6630 (+0x3c = code), 10 0x4a6ac0, 13 corner-coloured 0x4a6570).
- The page draws the tree as the HUD code leaves it at the start (positions, colours, sprites, text:
  e.g. the PAL widening FUN_003cb450(+0x34), the slid-shut item list at y 370 h 0) and drives HP. Since
  worker 0195 the exporter builds that tree from the ELF (below); it used to read it from the save.

## Draw paths
- Sprites FUN_003c97a0 -> FUN_003c94e0 (frame kinds DAT_0047d180: cols, stretch col, rows, stretch
  row) -> FUN_003cac70 (9th arg = signed frame height, on the stack: 0x3c95d4) -> FUN_003d2e80.
  Sprite records DAT_0047bfc0[id]: frame list, texture (+4: menu1-4 = PTR_DAT_0047d500[+6]), kind,
  +7 repeat bits (FUN_003d3fb8 -> CLAMP_1 REGION_REPEAT), +8 corner colours of untextured sprites
  (FUN_003c8dc0). Type 13: FUN_003d5f68 via FUN_003d3330.
- HUD -> frame (DAT_004f2258 set): x (12.4) x 0x1b0 >> 9 toward zero, y << 9 / 0x1c0 (FUN_003d2e80,
  FUN_003d3098); FUN_003d3330 maps only the pixel part and keeps the 1/16 fraction. Scissor
  FUN_003d3880 (via FUN_003cada0 / FUN_003cae68). PRIM table DAT_0047ad30 (1 gouraud strip, 3 line
  strip, 5 textured strip). ALPHA (Cs-Cd)As+Cd, TFX modulate, TCC 1, no alpha test, flag 8 -> TEX1 0x60.
- Groups FUN_003d5ac0: +0x3c bit 0 clips the children to the box rows.
- Gauges: HP FUN_003ae938 (element 0x0a, 0x3ae910), MP FUN_003aea10 (element 9, 0x3ae9e8), both
  FUN_003aed60 (rows DAT_00471fa0: c0 left / c1 right, edge lines, lag segment alpha - 0x20); value set
  FUN_003aec10, 1000 ms drain FUN_003aec78. HP text: FUN_00339988 -> FUN_003adda8 -> FUN_003aed00 ->
  FUN_003cbb58 / FUN_003cba90 ("cur" 0x12 "max", digits 0x13+).
- CHAIN: callbacks 0x2e / 0x32 (LAB_003b4f50 / 003b4f78) -> FUN_003b4fa0: scissor to the gauge
  (HUD+0xbbc), glow pulse FUN_003d0ad0 (0x40..0xc0, half period 200 - 150 cur / max ms) into elements
  (lists 0x472948 / 50 / 58, FUN_003d5698) and sprite corners (FUN_003d10a8). The dump confirms the
  draw-order effect: CHAIN (before the callback) 88, pieces after it 103 = one 20 ms frame apart.
- Text FUN_003d7040 -> FUN_003cc0a8: flag 0x80 -> number font FUN_003cedf0 (cell (c-4)%42 at 12 px,
  v from row 16 + 464 masked = 224, widths at metrics +0x70, shadow sprite, gradient quad); +0x5c != 0 ->
  FUN_003cc208 (SJIS-style cell from ASCII, kelfnt0, 16 px cells, flag 2 = 4-copy outline); +0x5c == 0
  -> FUN_003cd7e8 (NOT translated; only off-screen text uses it at the save).
- Font: kelfnt0 = data/etc/locale/**uk**/fontdata1.bin TIM3 (linear 4-bit; equals GS memory at TBP 0 as
  PSMT4HH, 0 mismatches); each texel = two 2-bit glyph planes, CLUT n = FUN_003dd5b0(n) -> CBP 16379-n,
  colours static at 0x47d380 + 0x40 n. Metrics = menudata.bin entry 2 (FUN_003d2600 -> FUN_003d25c8(2));
  the save runs the UK locale (its table equals RAM). menu3 / menu4 are PSMT8 (export_web_hud
  menu_texture8; equal to GS memory, 0 texel / CLUT differences).

## GS stand-in (hud.js; review fixes, worker 0185)
- One vertex buffer per frame, uploaded only where it changed (bufferSubData of the used range). Batches
  break only where a primitive overlaps an earlier As > 1 primitive of the same batch (those take three
  passes: As <= 1, subtract, add the overflow), so every pixel sees the game's order. play.html,
  headless swiftshader, per HUD frame: 188 -> 115 draw calls, 101 MB -> 12 KiB uploaded, 67 -> 2.1 ms.
  The calls left are the text: shadow and glyph both reach As > 1 (CLUT alpha 0xb0) and overlap.
- Blend above 1: exact per channel (fidelity-audit 'As > 0x80 on an 8-bit target').
- Pixel centres: +0.5 frame px (the GS samples at integer coordinates). Ground truth: the walk dumps'
  freeze snapshot (GS memory at +0x1a9, FBP 112 PSMCT32 FBW 7) holds the previous displayed frame with
  the GS's HUD (HP 780 / 780); the hero dump's holds a cutscene frame.
- The edge lines stay a GUESS (quads one pixel thick).

## Evidence
- test_hud: all 88 on-screen HUD primitives of the hero dump (z128_hero_163235) equal ours: texture +
  CLUT, 4 vertices x y u v rgba, scissor. 18 / 18 mutants killed. Review: review/w0175_hud.png.

## Hit-direction ring (worker 0190, 2026-11-01)
On the page: hud_core.js `hitAngle` / `ringMatrix` / `HitRing` / `ringPrims`, HudState `hit` / `ringFrame`; hud.js
`hit()` (queued) and `tick()`; enemy_ai.js playerHandler -> `opts.hudHit(P.pos, b.start)` (also with ?enemydmg=0);
play.js passes it and `camYaw: () => follow.yaw`. On with the game HUD (?gamehud=0 off). Data: hud.json `ring`
(kind 5 from the ELF) and `values.ring` (the save's HUD +0x230..): **re-run export_web_hud.py**.
- Trigger: FUN_005720c8 (Vincent's bullet handler) -> FUN_00567c08(P, bullet +0xc0) unless bullet +0x140 bit 1;
  not after a deflect or with P+0x118 bit 0x20 (return 0). Melee doesn't (FUN_0055eac8). FUN_00570eb8 also calls
  it (an HP loss toward object +0x268 with P+0x28 bit 2): not reached on the page.
- Angle: d = from - P+0x90; FUN_00260e74(d, (1,0,0), (0,1,0)) = acos of the XZ-projected dot (FUN_00261040),
  negative when (d x X).y = d.z < 0 (VU0 opmula / opmsub = d x X); x 651.8986, truncated.
- FUN_003af6b8: HUD +0x230 != 0 -> sector s = (0x1000 - ((a + 0xb00) & 0xfff)) >> 9; s < 8 -> HUD +0x238 + 4s =
  clock + 2000; FUN_003b0680(HUD, 5) always (a = 0x500 mod 0x1000 gives s = 8: shown, no timer, and it stays up
  until some timer lapses: FUN_003af740 hides only when one lapses this frame and none is left).
- Kind 5 uses the reticle's phase arrays (the HUD and RET are one object, DAT_00471380): 0 -> 1 (fade in
  DAT_00472110[5] = 100 ms) -> 2; hide 2 -> 3 (100 ms) -> 0. FUN_003b0ac0 draws it after kinds 1-4, then
  HUD +0x234 += 1 unless the game state is 0x17 (pause).
- Matrix HUD +0x260 (FUN_003af580): S diag(2^-10) x rotX(-1.2217 rad, FUN_00259928) with row-3 z = 8 (+0x298) x
  FUN_00445218 = sceVu0ViewScreenMatrix(scrz 256 / tanf(0.43633), ax 1, ay 1.18, cx 256, cy 224, ...).
- Draw (FUN_003b1048 l.440-700, flag 0x2000 path): corners in 1/16 px rotated by i 2pi/8 - CAM+0x178 (exact
  cos / sin at 0, pi/2, pi, 3pi/2), x M, / w, ((int) << 16) >> 12 (whole HUD px), FUN_003d3098 PRIM 5 (mapA),
  menu1, bilinear (FUN_003d3830(1) for kinds >= 5). Piece 201 (grey 128,128,128 a 32; flag 0x4000 = a mirrored
  second half, u end - 1/2 texel) when the copy's timer is 0; piece 203 (arrow) when set, colour 0x4188c7 =
  (199,136,65) or its own (99,68,32) on HUD +0x234 bit 1 (blinks every 2 frames). While t != len: alpha t a / len
  (bit 1), x y w h x 1.5 -> x 1 (bit 0x400).
- Evidence: grab_gs.py on w174_pain_a (TRACE_FIELDSET=enemy TRACE_RNG=1 TRACE_LOG_AT=9E000; dumps + states in
  tools/trace/out/w190, gitignored): hits at ~f787 and ~f1009 (states f792: timer 2 = 1900 ms left, phase 2;
  f1013: 1920 ms, phase 1 t 80; f955: none). The dump is the 4th frame after its state (the blink's counter
  agrees on both). test_hud: f1013's 15 ring strips equal ours vertex for vertex with the state's yaw; f792's with
  a fitted yaw (the camera turned in between: any yaw in [1.63205, 1.63213]); the spent bullets' +0xc0 give
  a = 193 / 156 -> sector 2 = the lit timer. 25 / 25 hud_core mutants killed (direction: sign, sector offset,
  sector order, +yaw, copy order; timing: 2000, expiry compare, show length, hide rule, blink; placement: tilt, z,
  ay, cx, fov, corners, u end, rounding, mapA, alpha, 1.5x, bilinear, not drawn) + the hook in enemy_ai.js
  (test_hud_page). Comparison image: worker 0190's scratchpad w190_ring_compare.png.
- Angle sign: settled by code + camera geometry (review, worker 0190's fixes): every traced hit lies within
  sector 2, so the data can't tell the sign; test_hud checks that a shooter ahead of / right of / behind / left of
  the camera puts the arrow above / right / below / left at yaws 0, 1, 1.632, -2.5 (the flipped sign fails all four),
  and test_hud_page fires from +X and +Z (segments 2 and 0). Not tested by data: which frame's yaw the draw
  reads (this frame's vs the last; the f792 yaw was fitted, f1013's camera was still).
- Review fixes: the hook passes the frame's start position (enemy_ai pStart = P+0x90 during the bullet pass;
  P.pos can move in the hit-reaction redo); play.js declares gameHud before createEnemyAI (no try / catch); a
  direction with no XZ part gives angle 0 (GUESS, VU0 0/0 rules); the blink test checks one exact pattern.
- Open: the clock order within a frame (fidelity-audit GUESS row); FUN_00570eb8's ring.

## Not done
- FUN_003cd7e8 text, low-HP / MP pulses FUN_003af1e0, type-10 elements, the other callbacks (slots 3,
  4, 8, 9, 10), weapon icon / ammo / item / CHAIN value updates (static at the save values: the page
  has no ammo, items or CHAIN).

## Set-up from the disc (worker 0195, 2026-11-02)
export_web_hud.py `Setup` / `disc_tree` builds hud.json's `chain` and `values` without a save state;
`--state` keeps the old read as a cross-check (prints the differences: 0).
- Layout byte code FUN_003ca488: attribute block FUN_003ca9d8 (defaults: id 0xff, rgba 0x80 x 4, sprite -1,
  text colour 0x80808080, text x / y 0x7f, +0x3c = 0 on PAL else 4, corners 0x80808080), ops 0xe rect, 0xf
  rgba, 0x10 / 0x21 text (pointer / DAT_0047a6ac[i]), 0x12 text colour, 0x14 text flags, 0x15 +0x64, 0x16 id,
  0x17 sprite, 0x1e text x / y, 0x1f group +0x3f, 0x20 corners (0x11 focus, 0x18 / 0x19 / 0x1b / 0x1c: not
  exported). Op 1 recurses for the children and ends the level. Element init FUN_003c8910 copies the block
  (+2 flags, +3 id, +6 rect + the parent's x / y, +0x16 rgba, +0x1a sprite, +0x1c / +0x1e = the relative x / y),
  box FUN_003ca160; text FUN_003cbf18 (+0x4c = +0x58 = colour, +0x5c / +0x5e / +0x60 / +0x62 / +0x64, +0x65 =
  PAL ? 0 : 1) and FUN_003d03a0 / FUN_003d72e8 (width +0x44: FUN_003d0058 number font, FUN_003cf338 plain);
  type 13 FUN_003d6730 (corner colours per frame cell, bilinear FUN_003d6a48). Child lists FUN_003cab20
  (sorted by +5, the parent's at creation); FUN_003caab8 sets the top groups' priorities (-0x32; slots 0 / 2
  -0x37, so they sort before the root and are not in the draw chain). FUN_003cb0f8 = direct child by id, else
  the element itself (so lists naming ids a slot lacks write the group: e.g. 0x472940 on slot 4).
- Language 2 (UK) is PAL (FUN_003e2760) and has no per-language rect list (0x51fb40 / 0x51fb60 [2] = 0).
- FUN_003ad618's steps after the scripts, in order: bilinear lists 0x471e18 / 20 / 28 (DAT_004b8980 bit 30, set
  at run time: taken as on, the save's), FUN_003adeb0, priorities, the PAL widening of slot 8 and its 0x53,
  text buffers DAT_00471e08 (t5c 0x20), FUN_003ae418(0, 1), FUN_003b2600, FUN_003b33d0 (FUN_003b45c8: item
  list bottom / height, alpha 0 on 0x472910 in slots 8-10, clip, close state 3), FUN_003b4aa8, FUN_003daec8,
  FUN_003ae030(0, 0, -1), FUN_003ae138(0, 0, 0), FUN_003ae308(0x69300000, 9), FUN_003b2e30, FUN_003af7f0,
  FUN_003af580 (ring on, counter 0), FUN_003b0370, FUN_003b52c8, FUN_003afb10(1) (everything hidden),
  FUN_003afbf8(4 / 5 / 6, 1). Screen init FUN_003d5090: fade 100 / 100, clip height 0x1c0.
- Then (the start): the status setters with START (export_web_hud.py; Vincent's values from the save, hand-
  written; the weapon icon pair FUN_003db080 takes an 11th stack argument = slot 6 0x16 hidden, read from
  FUN_003ae030's code), hide FUN_003ad5b0 (slides out: panel 5 = slot 1 stays at +200, state 4), show
  FUN_003ad560 (FUN_003afb10(0), FUN_003b0128: slide in panels 0, 1, 8-10 and show their lists), the item list
  FUN_003b48b0 closes (y 370, h 0, sprite -1, alpha 0, the slide home y moved by FUN_003d5df8), the limit fade
  FUN_003ae5d8 ends (slot 5 0x11 = DAT_00471e38[0] = 0), the gauges drain (FUN_003aec78), and one draw at the
  start clock writes the CHAIN glow (FUN_003b4fa0: 175 at clock 232753) and FUN_003cc208's 'drawn' flag 0x200.
  Slides: FUN_003d0f08 (in) / FUN_003d0fd0 (out) / FUN_003d0d50 (sine ease FUN_0045b530 = sinf, 12-bit angle).
- Evidence: all 114 HUD elements and `values` equal the save's (`--state` reports 0 differences); the save's
  list has 88 more (other screens on the global root list after slot 10; none on screen, their texts use the
  untranslated FUN_003cd7e8). Page: hud_core over 200 frames (HP change at 50, a ring hit at 60) gives the same
  on-screen primitives from both files; the save's adds 16 off-screen ones per frame. test_hud passes on the
  disc file (the hero dump's 88 primitives). Mutants (scratch copies of the exporter vs the save tree + an
  HP 500 / 780 / ammo 7 / 18 spot check): 27 / 30 killed; survivors equivalent for this data (child offsets of
  groups that are moved later; the HP lag settled; slot 6 0x28 hidden at build is shown by the sync).
- GUESS / hand-written (fidelity-audit 'HUD start values', 'HUD start sequence'): START (weapon, ammo, Potion
  x 2, limit, MP, chain 2: one save session's progress state, not the disc's stage start (FUN_003b4ea8 resets
  the chain to 0); clock 232753 / ring counter 1304: arbitrary session values matching the save's phases); the
  hide -> show order; the build clock 1000.
- Review fixes (worker 0195, 2026-11-02): `--state` exits 1 on any difference (a disc build that raises counts
  as one and the save's hud.json is still written); new test `node native/web/test_hud_setup.mjs` (0
  differences, no .p2s opened without --state, chain / values equal; SKIP without the save); a 0x34 -> 0x30
  widening mutant exits 1 with 2 differences. native/web/data/hud/hud.json is now the disc build (test_hud,
  test_hud_page ok on it).
- Not translated (the build raises if reached): FUN_003b5378 (panel 4), FUN_003ae5d8's pulses (+0x2c9 / +0x2cb),
  mid-animation states, '$' codes / wrapping in FUN_003cf338, languages 3-6 (rect lists filled at boot).
