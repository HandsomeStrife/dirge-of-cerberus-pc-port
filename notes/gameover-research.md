# Game over (worker 0192, 2026-11-02)

What the game does after Vincent dies, decoded and (except the visuals noted below) on the page:
`native/web/gameover.js` (logic), `gameover_layer.js` (draw with pause_layer.js's PauseLayer, keys),
`native/assets/models/export_web_gameover.py` -> `data/gameover.json`, tests `test_gameover.mjs` /
`test_gameover_page.mjs`. Fidelity rows: notes/fidelity-audit.md "Game over".

## Captures (game-derived, gitignored)
- tools/trace/scripts/w192_gameover.json (w181 death route, HP poked to 1, ✕ on Restart f1250) and
  w192_quit.json (down f1230, ✕ on Quit f1250), with `TRACE_FIELDSET=gameover TRACE_LOG_AT=A5000
  TRACE_POKE=960660=1` -> tools/trace/out/w192_*.jsonl. The fieldset (tools/trace/fields.py) reads heap
  objects at the addresses of this run (world-mode object 0x94d560, sequence screen 0x2340a0, menu box 0x233ea0).
- GS dumps + states at f800 / 880 / 960 / 1050 / 1150 / 1240 (grab_gs.py with the HP poke; a scratch copy).
  The f1240 dump is tools/trace/out/w192/menu.gs (+ menu.p2s); `export_web_gameover.py --menu-dump` writes
  data/gameover_ref.json from it.
- Seen: f880 death camera looking down, HUD still up; f960 GAME OVER title animating in, HUD gone (slid off
  screen: the f1240 dump still draws it at y < 0 / > 512); f1050 title settled over a dim red grid; f1150 the
  Restart / Quit box under it.

## Chain (addresses)
1. **FUN_00334590** (vtable 0x4a0a78 slot, the world-mode object; +0x2c state, +0x2e s16 timer), per frame:
   case 2: FUN_00316cf8 (status +0x20 HP == 0) nonzero = dead -> FUN_0032a420(CAM, 1, 0, 0), FUN_00328720(CAM),
   timer 0xb4, state 3 (with FUN_0055f0e0(P, 3) / (P, 2) or FUN_00326068(0x14) the *state* is 5 / 7 instead). Case 3:
   timer < 0 -> FUN_00241760(0, 3, 0), FUN_00324ab0(1) (DAT_0046e290+0x4c = 1; 3 with P+0x2b0 bit 0),
   FUN_00324a40(e290, 1) (e290+0x48 |= 2), state 9; else timer -=
   max(1, (int)step). Tail: timer -= 1. So 179, 177, ... -1: the request comes 91 frames after the death frame.
   Traced: death frame f789 (killed f788), request f880.
2. **FUN_004012c0** (stage loop) state 9, after FUN_00322f88: FUN_00324a90() == 1, FUN_00403608 == 0, not
   DAT_0047dbb4 -> FUN_003dec80(0), FUN_003fdd58(), **FUN_003fdb48(3)**, DAT_0047dbb4 = 1.
3. **FUN_003fdb48(3)**: PTR_0047db6c = 3, FUN_00241760(1, 0, 0), FUN_00242938, FUN_003ad5b0 (HUD off),
   voice FUN_003eb250(0x15b, 0x15e) ('se_%04d' 347..349 picked by an MD5 of the clock; 0x15f with
   FUN_00321460; 0x1b7..0x1bb in other modes), DAT_0047db84 = clock.
4. **FUN_003fdf00** (FUN_00247508, first every frame): type 3 volume 0x7f - min((clock - db84) >> 5, 0x78) to
   FUN_003ea1d0 / FUN_003ed7d0 / FUN_003e62d0; loads file 0x31000fc (0x31000dd..e1 by language) and, with stage
   +0x1558 bit 44, FUN_0037f2f0(stage, 0x61, 0x31000f5, 0x81840000, 0) (the GAME OVER FED); then
   FUN_003b66c0(DAT_00472a80, DAT_004a8250[3] = 6) and waits (type 3) for its result 6 / 7 -> DAT_0047db88,
   FUN_003fdd58. The stage loop then returns 6 (6), 1 (8) or 4 (7: the title).
5. Box kind 6 = **FUN_003c52b0 -> FUN_003c5358** (sequence screen, vtable 0x4a5ee0); FUN_003c54f8 case 6 ->
   table **0x47a130**: { t 0, 3000, cmd 0xfd, arg 0x27 }, { t 4000, cmd 0xf0 }, { 0xff }. FUN_003c6050 runs a
   record when elapsed >= t: case = (cmd + 0x1d) & 0xff. Case 0x1a (kind 6): layout 0x479190 (transparent root,
   empty text, an image-less button: nothing visible). Case 0xd: FUN_003b66c0(.., 0x21) -> FUN_00534858 ->
   **FUN_005348c0** (layout 0x477c38; 0x477cb0 with FUN_002419d8(0x11)), screen mode 4.
6. Menu box (vtable 0x5373e8): ✕ **FUN_005349c0** (id 3 / 7 -> 6, 8 -> 8, else 7) + FUN_00534af8 (+0x50 = clock
   + 1000, DAT_004fcaa0 = 0x70, FUN_002420e0(0, 1, 0), FUN_00403460) + FUN_003d4780 (input lock); ○ FUN_00534a28 ->
   FUN_003e1d80 (menu sound id 0xff). vt+0x1c FUN_00534a48 -> FUN_00534a98 at +0x50 (6: DAT_004fcaa0 = 0,
   FUN_002f2098(0x81840000), FUN_003aff20(HUD)) -> FUN_003b7830(box, 0, result).
7. FUN_003c6050 mode 4 reads the result: 7 / 8 -> close the box, FUN_003b7830(seq, 0, r); 6 in story mode
   (FUN_002419d8(0xc / 10 / 0x11) == 0 and stage +0x1558 bits 47-48 != 1) -> the box goes and FUN_003c72f8 runs on
   (the 'Calculating Points' / stage result screens; not decoded).

Not the game over: DAT_0046e54c (the earlier lead) is the HUD's refresh mask (FUN_00339590: bit 2 redraws the HP
gauge, FUN_003adda8). FUN_003bf3c8 / FUN_003bf408 (layout 0x477470) is the memory card screen (FUN_00240678 KB free).

## Traced frames (w192_gameover / w192_quit; record k = after logic k-1)
death seen f789 (timer 179), request + FUN_003fdb48 f880, file read f881-889, sequence ctor f890 (clock 250570),
menu f1090 (elapsed 4006 >= 4000; f1089 3988), ✕ f1250 -> box +0x58 = 6 / 7, result f1301 (clock >= +1000),
sequence f1302 (Restart: runs on, new start; Quit: its slot result 7), DAT_0047db88 = 7 + type cleared f1303. From
f1250 the world-mode timer stops (the world is no longer ticked after FUN_002420e0(0, 1, 0)).

## Pause hold (review fixes, corrected after the re-review)
FUN_00241760(on, kind, 0) is a reference count (DAT_0046b1dc, per kind DAT_0046b1e0[4]); count > 0 sets DAT_004f3044
0x100 (FUN_003e0c78), which makes FUN_003de130 return at once. Traced (w192_start): +1 kind 3 at the kill f788, -1 at the
request and +1 kind 0 in FUN_003fdb48 (f880), -1 in FUN_003fdf00 state 4 (f890, 0x100 clear).
After f890 the hold is the pad owner: FUN_003de130's Start test FUN_00254810(0x24) needs DAT_004e0ff8 == 1, and
FUN_003ddc18 sets it to 2 (FUN_00253fd8(2)) when a menu takes the focus (the sequence screen at f890); FUN_003ddd78 sets it
back to 1 when the focus goes (f1304 after Quit, a frame after FUN_003fdd58). Traced w192_start / w192_quit (fields
`pad_gate` / `pad_gate2` / `sflags`): DAT_004b8980 bit 20 (FUN_002413c0(0x14)) stays clear.
FUN_003e0cc8(1) (0x2000) is set from f880 and cleared by FUN_003fdd58 (DAT_0047db80 0) at f1303, but its reader is FUN_003de130's
other Start branch (FUN_003dfd18 != 0); Ghidra's C for FUN_003dfd18 is right (the asm's 0x0002280b is movn), and with stage
+0x1558 bit 37 set it returns 0 here, so 0x2000 is not a pause gate in this save.
After Quit the game leaves the stage (game state 0x15 -> 1 at f1304) and 0x100 is set again from f1305: Start at f1340 /
f1370 does nothing, but that is the game leaving the stage for the title (not on the page): these presses don't
test the page's pause after Quit (the page keeps HP 0 and blocks on it; only H gives the pause back, test_gameover_page).
Page clock: menu keys are queued and applied in the next game frame with its clock (as the pad poll).

## Title FED (worker 0198, 2026-11-02)
The GAME OVER title and its backdrop are one effect on the ordinary FED engine (effects.js), not a separate 2D runtime.
- Start: FUN_003fdf00 (after reading file 0x31000fc, a0093.fed = FileCode 0x81740000, registered by FUN_002f1ae8; nothing
  of it is spawned here) -> FUN_0037f2f0(stage, 0x61, 0x31000f5, 0x81840000, 0): a stage request (FUN_00376040 slot,
  type 0x18; +0x20 = 0x61 file number, +0x2c file 0x31000f5, +0x30 id) -> FUN_00381a08 (from FUN_00377c68 / FUN_003753e0):
  FUN_0024fe88 reads the file, FUN_002f1990 registers the FED, FUN_002e6290(0, FUN_002f0878(), 0x81840000).
  File 0x31000f5 = data/effect/anything/a0050/a0097/fer/a0097.fed (FILELIST.BIN; dd..e1 = a0277 / a0265 / a0253 / a0224).
- Manager: FUN_002f0878(id): id >> 28 == 8, (id >> 18) & 0x3ff = 0x61 -> DAT_004ee4a0 (list DAT_004ee8c0: 4ec7f0, 4ee2e0,
  4ee3c0, 4ee4a0, 4ee580, 4ee660; same step, same RNG reseed FUN_002d97f8 once a frame).
- One group, one emitter (E id 2: looping; duration 240; category 5 -> emitter byte +1 = 1), 91 particle defs, 3 TIM2
  textures (letters / grid ornaments / a caustic sheet). Camera 1 = DAT_0050b4f8[1] = 0x4ea080: FUN_002d9ec8(cam, PAL 1)
  + FUN_002da038 + FUN_002da5d0 -> sceVu0ViewScreenMatrix(512, 426/512, x1.575, 2037, 2048, 1, 0x4b7fffff, 1, 65536);
  view = identity, z + 128 (RAM). FUN_002e3300 adds emitter +0x40 / +0x44 (x 0.83203125 / 1.1428572 with PAL) to the
  projection centre; FUN_002e7cd0's byte-1 path puts the position there (+0x80 = 0).
- Loops: FUN_002ea040: emitter +4 bit 1 (E id) and particle +4 bit 1 (P id): no death at the life; at P +0x12 flag 0x10;
  FUN_002eb1d0 runs events to P+0x12 - 1, the loop list (FUN_002eb6b8 kind 5: list +0x44, count +0x25; FUN_002e9b38 data
  at P+0x10; vtable +0x34 re-bases), flags = (flags & ~0x10) | 2, age = (ia - P12) % (P12 - P10) + P10 + frac.
  Looping emitter stays (E +0xc == 0).
- Textures: FUN_002eba88 -> FUN_00309f28: image at TIM2 +0x40, or +0x60 when byte +0xc == 2 (a0097's: name 'gmovr_01'
  at +0x50; HeaderSize 0x30 does not count it), CLUT after the image; GsTex0 used as is.
- Draws (GS dumps w198, f969 / 1050 / 1151): after the scene and the 3D effects, before the HUD; depth-tested (TEST
  0x5000d, Z 130818 = camera-0 view depth 128), but after a depth clear (review fix, 2026-11-02): the title is in effect
  layer 5, and the frame loop FUN_00248110 -> FUN_002f0250 runs, when FUN_002e2398(5) finds a draw entry in
  DAT_004eb680 slots 0x12a..0x131, FUN_002ee990(0x4ec060, 0) -> FUN_002ee5c0 (8 SPRITEs over 448 x 512, TEST 0x32001 =
  alpha NEVER + AFAIL ZB_ONLY + ZTST ALWAYS, Z 0) before FUN_002e20f0(5). In every w198 dump (g4: draws 13402-13417,
  letters from 13418), in no gameplay dump. So every title draw passes; the page clears depth before the title group
  (gameover_title.js `TitleLayer.depthClear`). FUN_002f00c0 (layer 4) and FUN_002f0428 (layer 6) do the same. Draw type 10 = the letters (tex 1, ALPHA 0x44) and the grid / ornaments
  (tex 2, 0x44 / 0x48): on the page. Not: type 11 (tex 0 mesh, 588 tris early, 44 settled), the dim quad (untextured,
  RGBA 24,8,8,64, 0x44; likely type 20), type 35's letter glow (per letter: tex 1 into a 64 x 64 page at 2016..2080, a
  copy from frame page 0x1ce00 (ALPHA FIX), the page drawn back red additive at the letter, a clear), types 103 / 119.
- Timing: spawn in page frame 894 = the request's (880) + 14 (state ages 13.2 @906, 84.0 @965, 181.2 @1046, 302.4 @1147).
- Captures: grab_gs.py + TRACE_POKE (scratch copy) on w192_gameover, TRACE_LOG_AT=A5000, grabs 905,925,956,1046,1146 ->
  tools/trace/out/w198 (g1-5.gs, s1-5.p2s, grab_log.json); fixtures: tools/trace/title_fixture.py sN.p2s ramN.json,
  tools/trace/dumpfx.py gN.gs dumpN.json --fed a0097.fed [--clut-out clutN.json].

## Title draw types (worker 0202, 2026-11-02)
Vtables (DAT_0046c398[type], w198 s4): 11 0x49a898, 20 0x49a9b8, 35 0x49a6f8, 103 0x49d1c0, 119 0x49db70 (+0xc init, +0x14
transition, +0x1c eval, +0x24 draw, +0x2c destroy, +0x34 loop). Which tags: 35 = tags 0 / 5 / .. / 35 (looping glows, life
120) and 3 / 8 / .. / 38 (one-shot, life 101); 119 = 4 / 9 / .. / 39; 11 = 40, 41; 20 = 58, 59, 61; 103 = 67..90.
- **Type 35, the letter glow** (FUN_00278b50; effects.js drawGlow): four GS draws a letter (w198 g4 56436..56499): the 64 x 64
  page at TBP 0x2a00 (FUN_002eec78 FRAME / SCISSOR / XYOFFSET 32256; FUN_002eea80 clear), the letter's record drawn into
  it with diag(512 / extent) + (2037, 2048, 400000) (PAL), the frame copied in with FBMSK 0xff000000 (RGB only) from TBP
  0xe00 = DISPFB 112 (the last displayed frame: the data byte +0x11 = 1 picks FUN_002ef560 buffer 1), ST = (box - XYOFFSET
  1824 / 1792) / 512, then the page drawn back over the box (C . S of (+-e/16, +-e/16), / w, VFTOI4), MODULATE (128, 0, 0,
  colour alpha), ALPHA 0x48: a red, additive halo of what was on screen under the letter, masked by the letter.
  TEX1 0x61 (bilinear) on all three textured draws, CLAMP 0. Tables (ELF): DAT_0046c230 sizes 256 / 128 / 64 / 32,
  238 XYOFFSET, 240 TBW, 248 TW, 250 ALPHA 0x48 / 0x42 / 0x88. Page: TitleLayer.glows renders the page in a 64 x 64
  render target per glow from output.prevFrame (output.js keeps the scene + HUD target of the last render while the title
  lives) and draws it back. Rounding: the EE / VU round toward zero (effects.js rz): boxes and ST exact in all three dumps.
- **RNG** (TRACE_CALLLOG=w202lcg: every LCG / VU0 R draw in 0x270000..0x2e0000 with its caller; out/w202, w202b, w202c, w202d,
  frames 893..1150): the title DOES draw: type 20's transition 6 LCG a particle (0x27b270..), type 24 inside the 119
  particles 1 each (0x275684), type 103's eval 9 LCG + 1 VU0 R span per strand point (0x2a9eb4..0x2a9f64). Type 119's own
  channel: none. The 3 draws at 0x2a1b68 every 10 frames are a level effect (also in 0200's gameplay log), not the title.
  Log frame = page frame + 2. Page: all simulated (T[20], T[35], T[103]; 119 in DRAWN_ELSEWHERE): the draws equal the
  game's frame by frame (test_gameover replays the logged reseed and the other callers' draws).
- **Effect step**: the title emitter (heap 0xd15820 in every w198 state; TRACE_FXTITLE=d15820 -> out/w202_fxtitle.jsonl)
  ages by its own +0x20 dt (1.1999969 / 1.1999988 / 1.2000008), not the logic step 1.1999999; its age is not always
  age + dt to the ulp (84 / 350 frames). Not decoded; on the page the emitter age drifts <= 1e-3, one schedule step
  (f1019) lands a frame late.
- **Types 11 / 20**: FED models (header +0x6c, 5 models; +0x18 scale, +0x28 TEX0, colours) through FUN_002f2f08 -> flag 0x2000
  -> FUN_002f93d8 (35 KB, not decoded; type 20 sets 0x2100) or FUN_002f5c50. Type 20's UV scroll is translated (init /
  transition / loop), the draw is not. **Type 119**: FUN_002b4de0 picks a sub-object (data +0x34: FUN_002a49e8, +0x35:
  FUN_002a5268, +0x36: 0x49cc68); draw FUN_002b4f70 via FUN_00284fd0 / FUN_00285d38 (frame-buffer, 576 tris = 8 x 72 in g2 /
  g3, TEX0 0xe00, TEST 0x31001). **Type 103's lines** (FUN_002aa120) come after the HUD (seq 57216, after layer 6's clear).
- a0093.fed (file 0x31000fc, FileCode 0x81740000): no emitter of it on any of the six managers (DAT_004ee8c0 list:
  4ec7f0 / 4ee2e0 / 4ee3c0 / 4ee4a0 / 4ee580 / 4ee660, +0x84 lists, the emitters' FED +0x70 -> +4) in the five w198 states
  (f906..1147): 4ee2e0 holds 9 x 0x406c0000, 4ee3c0 0x20000000 + 0x20040000s (level), 4ee4a0 only 0x81840000. Nothing is
  spawned from it during the game over (as 0198 found); what it is for is not traced.
- Evidence: glowN.json (dumpfx.py --glow), ramN.json with 'vall' / 'pool' (title_fixture.py), the call logs, w202_fxtitle.
  The last dump (g5) is page frame 1149 (state + 3), not 1150: the glow's alpha ramp shows it.

## Open
- GAME OVER title: the draws of types 11 / 20 (FUN_002f93d8), 103 (lines, layer 6), 119 (FUN_002b4f70); the effect step; the death camera (FUN_0032ace0's CAM+0x1e8 0x400000 branch, CAM+0x230
  phases), HUD slide-out (FUN_003aff20: done, worker 0203, notes/hud-research.md 'Slide-out at game over'), the voice (stream SE), the volume ramp hooks, the world stop after the
  answer, menu sounds through audio.js MenuSound, the Restart path (done: worker 0201, notes/checkpoint-research.md), Quit ->
  title.
