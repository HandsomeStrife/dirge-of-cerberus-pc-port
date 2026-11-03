# The level end and the Status results screen (worker 0232, 2026-11-03; plan P12)

Page: `native/web/results.js` (stats, play clock, calc runner, the Status box), hooks in stage_info.js (`onBegin`,
`makeBox`), stage_controller.js (Intermission natives `setSectionStat` / `calc`), play.js (`stageRes`), enemy_ai.js
(`statAdd`, `playerKill`, `playerBulletStats`). Data: `native/assets/models/export_web_results.py` ->
data/results.json (build step `results`; disc.py INPUTS + data/etc/KerberosIntermissionCalc.class). Tests:
`node native/web/test_results.mjs`, `node --import ./native/web/test_hooks.mjs native/web/test_results_counters.mjs`,
`node native/web/test_results_page.mjs`. Audit section 'Level end and the Status screen'.

## ev0100 main's level end (bytecode 10900..11218)
After heri_lasted / load(128, 10, 11) / kita_ev0145 (skipped when +0x156c): setVoiceBufferType(0), fadeout, chaos,
enable3Drender(0), sleep(100), **Event.setflag(13, 99)**, **Intermission.endSection()**, unsetSkipMode,
**displayStageInfo(2)**, sleep(500), **Zone.exit(181)**, sleep(5000), end. (Debug builds exit(-1) earlier.)
- displayStageInfo(I) / (ILString) are bytecode in the ELF's event library (fake/KerberosEvent): `Intermission.calc()`
  first, then displayStageInfo_l. So **every** stage-info box (the help boxes too) runs calc.
- Zone.exit(I) = exit_l(n, 0, 0).

## Natives (class registry DAT_004ef498, method +0x0c)
getTotalStat 0x3a5450 (FUN_0031d898), getSectionStat 0x3a5378 (FUN_0031d7b8), setTotalStat 0x3a54b8 (FUN_0031d6d8),
setSectionStat 0x3a53e0 (FUN_0031d698), getTotalTime 0x3a5588 (FUN_0031d6f8 = DAT_0046b308), getSectionTime 0x3a5528
(FUN_0031d718), getGameDifficultyLevel 0x3a26f0 (FUN_00242c28: DAT_0046b328, 1 in the save), calc 0x3a55e8,
endSection 0x3a26a8, clearTotalStatAll 0x3a2720 (FUN_0031dac0), clearSectionStatAll 0x3a2768, isGameOver 0x3a5350
(DAT_0047dbb4). Event.isTutorial 0x3a48f0 = FUN_002419d8(10) (0: DAT_004b8ac8 = 0 in the save).
- **calc** FUN_003a55e8 -> FUN_003a9b88(vm, "KerberosIntermissionCalc", "calc", ..): the registered script class
  (registry slot 23 in the z128 states; file data/etc/KerberosIntermissionCalc.class, 29380 bytes of bytecode) runs
  synchronously. It dispatches on global flag 0 (the stage: 1 here) and 13 (64 opening, 0 battle, **99 level end**):
  at 99 it writes the ranks / points (stats 16-45, 53, ...). The pause's Status page runs it through the loader
  (FUN_003c0f30: FUN_003e0538(7, 0, 1) -> FUN_003dfe78 case 1 -> FUN_003e0920; released by FUN_003e0600(1)).
- **endSection** FUN_003a26a8 -> FUN_003fdb00: if PTR_0047db90 == stat 14 (set by the stage load FUN_00400778 ->
  FUN_003fda68) -> FUN_0031dbf0 (totals += section, +4 end = DAT_0046b308, +0 = min, word 0xa5 = 1), PTR = -1.
  FUN_003fdb48(2) calls FUN_003fdb00 again (no-op then).
- **Zone.exit** FUN_0039df70: FUN_00241990(0xb, 0), stage number fix-ups only in modes 0x10 / 0x12, FUN_0037a368:
  event request 0x14 (+0x20 stage, +0x24, +0x28), then waits for +0x1558 bit 33. FUN_00377c68 case 0x14:
  FUN_00324ab0(0), FUN_00241ed8(181, 0, 0, 0) (DAT_004b8ba0 = next stage, DAT_004b8ba8 = 1); FUN_004012c0 returns 1
  (FUN_00241ea0) and FUN_00401b90 ends the stage program.

## The stats block DAT_0046e228 (0x298 bytes, FUN_0031d3f8 / FUN_0031d470)
+0 section start (play seconds), +4 end, +8 KO counter at the start, +0x10 + 4k = section stat k (54), +0xe8 + 4k = the
totals, +0x1c0 4 area records x 0x34 (FUN_0031dc78; +0x290 current: mako bits), +0x294 totals-only, word 0xa5 ended.
Computed on read (FUN_0031d7b8): 9 = DAT_0046b304 - (+8) (KOs), 10 = pct(2, 1), 11 = pct(3, 1), 12 = pct(6, 7)
(FUN_0031dff0: 0 if either is 0, 100 if a >= b, else 1..99), 15 = end - start. FUN_0031d898 (totals) the same on
section + total (9 = DAT_0046b304, 15 = DAT_0046b308 + section time).
Clocks: DAT_0046b308 = play seconds (FUN_00242a50, every frame from FUN_00247428: + whole-second steps of the ms clock
while DAT_0046b310; FUN_00242980 sets it: stage load on, the system pause / event pause FUN_00376ee0 off);
DAT_0046b304 += 1 in FUN_00242938 (FUN_003fdb48(3): the game over).
Section start FUN_0031db30 (via FUN_003fdaa0 when stat 14 changed): clears all but stat 14, +0 = DAT_0046b308,
+8 = DAT_0046b304, stat 7 = 0. A Restart (FUN_00247508 0x13) does not reset them in story mode.
Save (sea-of-flames.p2s): block 0xa09b00, start 11, play 53 s, stats {0: 3, 1: 3, 2: 3, 7: 9, 14: 1, 52: 2}, PTR 1.

## The counters (T: w232 call log, TRACE_CALLLOG=results over w217_r02_barrier from r02_walkway)
| stat | row (label message, layout 0x4791d0) | where | page |
|---|---|---|---|
| 0 | row 0 (0xb82a) | Vincent's vt+0x31c FUN_005726e0 (from FUN_0055db50 / FUN_0055e498 when the victim is dead after the HP update) | enemy_ai playerKill |
| 1 | (shots) | FUN_00577480, once a trigger pull with bullets made (f190) | playerShot |
| 2 / 3 | (hits) / row 3 (0xb82d) | FUN_00554ea8 (bullet +0x120 bit 2, an object hit +0x14c != -1; hit nibble +0x140 bits 7-10 == 0; 3 with +0x120 0x40000 = zone flag 8) (f195, f301) | playerBulletStats |
| 8 | row 2 (0xb82c) | FUN_0055c7f8 (P+0x28 bit 2), after the clamps | the three HP sites |
| 9 | row 8 (0xb832) | DAT_0046b304 (FUN_00242938) | play.js game over |
| 10 | row 1 (0xb82b) | pct(2, 1) | computed |
| 52 | row 4 (0xb875) | FUN_005694a0 from FUN_005726e0, gate FUN_003b3538(HUD, 3) | not on the page |
| 4 / 5 (13) / 12 (6, 7) | Magic / Limit / Mako | FUN_00568ea0 / FUN_00572f98, FUN_00572b90 (5), FUN_00577e68 (13) / FUN_005606c8 (6), FUN_0031dca8 (7) | none on the page |
| 15 | Time | end - start | computed |
| 18 / 20-31 / ... | Gil, ranks, points | calc | runCalc |
Order per lethal shot in the game: stat 1 (f190) -> stat 0 (f192: the hit test kills) -> stat 2 (f195: the bullet's end
3 frames later). The page counts 2 / 3 at the hit frame (its bullets end there): L.
The Status rows show stat 13 in the Limit row and stat 24 for 25: FUN_003c54f8 copies +0x1024 -> +0x1004 and +0x1050
-> +0x1054 when FUN_003e2730() (DAT_0046b2fc != 0: true here).

## The Status box (box kind DAT_004a8250[2] = 0x1d)
FUN_003fdf00 -> FUN_003b66c0 -> FUN_003c52b0 -> FUN_003c5358; FUN_003c54f8: stats -> +0xff0 (totals when stat 14 ==
0x10: title message 0xb878 instead of 0xb800), the four point rows packed (DAT_0047a315 / 0x47a338), step table 0x479650 (126 records to
0x47a028), FUN_003c6d70: rank effect ids (DAT_0047a4f8 triples: stat < 5 -> slot ids DAT_0047a4c8 / 0x47a4e0; positions
0x51d0e0 with script flag 0x1e), slot 27 = 0x81744800.
Commands (FUN_003c6600, op + 0x1d): 0 / 2 skip the close unless totals / tutorial; 1 totals lives; 3 sound; 5 effect
slot move; 6 skip the rest of the section when the row's stat is 0; 7 auto-advance (+0x48f); 8 title 0xb842 (layout
0x479190 widget 4); 9 points layout 0x479420 (override 0x51f980) + FUN_003c7318; 10 wait for ✕; 0xb hold (✕ jumps to
the hold time); 0xc / 0xf FUN_003c73f0's screen (layout 0x4795c8, mode 5 / 2); 0x10-0x15 value rows (FUN_003c5db0:
stat pair DAT_0047a300, FUN_003c7068 200 ms count FUN_003d0d08, formats 0xb837 %d, 0xb838 %3d%%, 0xb839 h:mm:ss,
0xb83a %d/%d); 0x16 label; 0x17 / 0x18 text by value (DAT_0047a428 / 0x47a388); 0x19 rows layout 0x4791d0 (override
0x51f960) + widget 0xe = 0xb82f (FUN_003e2730) + FUN_003c7318 (section name DAT_0047a340[stat 14] in widget 7, rows
hidden); 0x1a title 0xb800 / 0xb878; 0x1b close.
Layout widgets are type 2 text (FUN_003d6f88; the layout's op 0x10 id is the string, FUN_003cbf18).
Parts: A (0-3 s: title, panel effects), auto -> B (rows every 500 ms from 1.5 s, the evaluation effects at 6.5 / 8.5 s,
hold 9.5 s, ✕), C (the points: title 0xb842, the Gil rows; hold 9.1 s, ✕), D (title 0xb842, 4 s auto), FUN_003c73f0's screen
(the EXP -> gil exchange prompt: layout 0x4795c8, text 0xb83e (with a %d) + an option widget type 6 0xb83f; a
FUN_003dae10(0x1bc) menu, input; not decoded, left out on the page), close.
T w232_status (frames from the save): kind 2 f41, file read, box f49 (8 frames: stage_info.js READ_FRAMES holds), part B
f200, hold 9501 f275, ✕ f300 -> step 65 mode 1 f301, ✕ f330 -> part C f331, hold 9100 f431, ✕ f450 -> f451, ✕ f480 ->
part D f481, auto f681, FUN_003c73f0 mode 2 f732 .. (still waiting at f850). The page's box matches step / mode frame by
frame (test_results; 1 frame at the box's first frame).

## After displayStageInfo(2)
FUN_0039e8e8 returns once the box is requested (its wait is on event command 0x20, which FUN_00380788 does not make), so
main's sleep(500) runs with the box up and Zone.exit(181) follows ~0.5 s into part A; FUN_004012c0's default case then
returns 1 at once (FUN_00241ea0) and the stage program ends while the box runs on in the menu manager. The page: after
the exit the world stops and only the stage-info box runs until it closes, then the page stops (GUESS row).
The Gil row reads box fields past the stats: +0x10c8 / +0x10cc / +0x10d0 (= v[54..56]): FUN_003c54f8 sets -1 / stat 18 - 1
/ -1 and posts requests 0x13 / 0x16 (and 0x15 with the reward) through FUN_003e0b10 (FUN_00312b38) with the callback
0x3c57d0 -> FUN_003c5800: 0x13's answer a -> +0x10c8 = a, +0x10cc = a + stat 18 (capped 99999999); 0x16 -> +0x10d0.
enable3Drender(b) = FUN_003a27d0 -> FUN_00374c58 -> FUN_002420e0(b): the world stop (not on the page).

## The "Now loading" card
FUN_00242a50: while DAT_0046b1e4 and loads are pending (FUN_002418c8: DAT_0046b1e8 > 0, counted by FUN_00241900 =
drawNowLoading FUN_003a2770 and the loaders) the FED effect 0x70040200 is spawned (FUN_002e6290, callback 0x2429c0) and
removed (FUN_002e7198) 1500 ms after the last load. The next stage's title card is part of the next stage's load
(FUN_00247508 / FUN_00400778): not decoded (the next stage is not on the page).

## Captures (game-derived, gitignored; tools/trace/out/w232)
- r02_barrier.calls.jsonl: TRACE_CALLLOG=results (new set: every FUN_0031d668 / 0x31d698 / 0x31d6d8 call + ra).
- w232_status.jsonl: tools/trace/scripts/w232_status.json from the save; TRACE_CALLS (new in hook.py: the hook calls
  game functions at frame k) runs the level end's C calls: FUN_003fdb00 (f30), FUN_003e0538(7, 0, 1) (f31: calc) +
  FUN_003e0600(0) (f33: release), FUN_003fdb48(2) (f40); TRACE_POKE global flag 13 = 99 (XOR key). TRACE_FIELDSET=results
  (new) TRACE_SIBOX=2340a0.
