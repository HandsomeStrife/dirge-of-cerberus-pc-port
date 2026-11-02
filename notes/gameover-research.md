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

## Open
- GAME OVER title / backdrop (FED 2D runtime), the death camera (FUN_0032ace0's CAM+0x1e8 0x400000 branch, CAM+0x230
  phases), HUD slide-out (FUN_003aff20), the voice (stream SE), the volume ramp hooks, the world stop after the
  answer, menu sounds through audio.js MenuSound, the Restart path (FUN_003c72f8 -> results -> checkpoint), Quit ->
  title.
