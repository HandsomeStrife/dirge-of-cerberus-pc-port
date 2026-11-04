# Route save states along the first level (workers 0217, 0221, 0253; 2026-11-03/04)

Goal (plan P2 / P4 / P6 / P8 / P10): PCSX2 save states, each with a GS dump, along the walking route 02 -> 03 -> 04
-> 05 -> 06 -> 07/08 -> 09 -> 0b. **Result (worker 0253): every chunk on the route has a walked state and a dump, from
the save, playing the story beats (no teleports).** Start with the table below; the older sections keep 0217 / 0221's
findings.

## Walked states, best one per chunk (worker 0253)

Chain: sea-of-flames -> r02_walkway -> r02_barrier -> r02_deckend -> r02_climb -> r02_stairs -> ... -> r0b_walk. Files as below
(`tools/trace/out/route/`), contact sheet `tools/trace/out/w253/route_contact_sheet.png` (the 9 PNGs below, each looked at).
Chunk = the walk polygon's DCOL file under the state's position (page collision). Stage flags 0 / 1, global flag 1.

| chunk | state | pos | pair | st0 / st1 / g1 | what |
|---|---|---|---|---|---|
| 02 | r02_stairs3 | (-842, -28, -574) | 2, 3 | 2 / - / - | alley stairwell; trigger 15 just fired (no event yet) |
| 03 | r03_start | (-1033, 0, -590) | 2, 3 | 2 / - / - | after rv_matiawase + the save box |
| 04 | r04_east | (-728, 0, -37) | 4, 5 | 4 / 7 / 7 | after the first laser gate |
| 05 | r05_west | (-1420, 0, 684) | 4, 5 | 11 / 8 / 8 | |
| 06 | r06_market | (-1579, 0, 1240) | 6, 7 | 13 / 8 / 13 | market after heri_toujou; Dragonfly (31) up |
| 07 | r07_beat | (-1753, -44, 1571) | 6, 7 | 20 / 8 / 22 | in chunk 07's fight, e036 (80) up with HP 252 |
| 08 | r08_walk | (-501, 0, 792) | 8, 9 | 24 / 32 / 26 | at the third gate, "Use Cardkey" |
| 09 | r09_walk | (-80, -40, 606) | 8, 9 | 24 / 32 / 26 | |
| 0b | r0b_walk | (394, -100, 1468) | 9, 11 | 24 / 32 / 26 | just before the boss trigger |

Others on the chain, usable as parents (all with dumps unless noted; a few dumps are fades, see "Traps"):
r02_stairs, r02_stairs2; r03_predog (before trigger 63), r03_dogwalk (no dump), r03_dogawake, r03_mid, r03_mid2 (first gate),
r03_card, r03_alcove, r03_key, r03_key2 (key 1); r05_next (second gate), r05_back, r05_key (chunk 04), r05_key2, r05_key3 (key 2);
r06_gate, r06_mid, r06_door, r06_door2 (no dump), r06_door3 (save box up: don't parent from it without w253_box2), r06_heli .. 5;
r07_walk, r07_e036 (stage flag 0 = 24), r07_toujou, r06_back (actually chunk 08, pair 6, 8); r08_key .. r08_key4 (key 3), r08_box (no
dump); r0b_save (stage flag 0 = 36 just set, black "SAVING" frame). Replays: `tools/trace/scripts/w217_<name>.json`.

## What each stretch needs (worker 0253)

Each run pokes HP 9999 (PS+0x20, 0x960660), put back to 780 just before the save. **Pokes beyond that, on the 0b chain:** Dragonfly's HP
21600 -> 200 (0x961f90, r06_heli) and the ammo item 27 -> 300 (0xa096d0, r06_heli5). Anything else is pad input.

- **Stairs (02).** A stairwell of flights from y -160 to y -16, not one flight, then chunk 03 at (-828, -16, -604). 0217's route
  stepped off the landing (an off-edge step dropping 142 u), which is why r03_market stalled; soldiers were not the cause. The pair goes
  (1, 2) -> (2, 3) by an area box near (-840, -98, -577), before any beat.
- **rv_matiawase.** Trigger 15 (seen at (-842, -28, -574)): stage flag 0 = 2, 63 = 6. w253_matiawase: Start + ✕ skip, the save box
  (right ✕, left ✕, map ✕ ✕). Vincent ends at main's setpos (-889, 0, -599) by about f720.
- **Dogs.** Below.
- **Gate 1 (-1739, 0, -351; script 202 event 0x11).** Needs item 0x6b300001 (Cardkey) x 1. Key 1: soldier 147 (section-1 +0x5c drop, flag
  bit 23). Standing east at the door alcove (-1672, -407) woke 147 in this run (the waking script was not traced; triggers 186 / 187's
  scripts 240 / 241 send 147 too, they are past the gate); `--hunt 147` shot it and walked onto the drop. ✕ at the gate.
- **Gate 2 (-1305, 0, 851; script 199).** Key 2: placed item at (-1889, 0, 1084), south of chunk 05 (active once you are near).
- **Door (-1327.5, 0, 1140; trigger 12, script 149 event 0x11, flag 0 < 13).** ✕ only worked **facing the door**: the camera looked back
  at the soldiers and the walker was backing into it. w253_door turns the camera first. Then trigger 14: stage flag 0 = 13, scene_save(2), heri_toujou.
- **Dragonfly (31).** Script 29: flag 0 = 16 at event 1. Hits land only inside about 340 u (none seen beyond) and the tent over the first
  spot blocks them; stand in the open, (-1591, 0, 1364). Flag 0 went 13 -> 16 at HP 172 in both runs that hit it: **decoded (worker 0259, notes/other-types.md)**: a hit leaving HP <= 20000 starts timer 0 = 240, and event 1
  sets the flag. The 200 poke put it under the line from the first hit. Then flag 18, scene_save(3), sk_mituketa2 (moves him to (-1762, 0, 1578), pair 6, 7).
- **Chunk 07.** Trigger 18: flag 0 = 20, first_encounter. Soldiers 72-79, then e036 (80); its death -> flag 0 = 24 about 150 frames later, then
  rv_toujou, scene_save(4).
- **Market to 08.** Flag 1 = 32 on the way (help_* events), global 1 = 26 at about (-1039, 0, 956).
- **Gate 3 (-478, 0, 801; script 211).** Key 3: placed item (-700.8, 0, 858.5), inside box prop 72 (-703, -6, 857.5): shoot the box first
  (`--aim-at`). The key at (-224, -24, 934) is behind gate 4 (-258, 941; script 244), off the route, so a player has a spare.
- **09, 0b.** Nothing else in the way. Stage flag 0 = 36 fires at about (407, -100, 1471) (script 35), then its event and save (r0b_save). Not played past that.

## Awake dogs (worker 0253; for the dog worker)

Traces (`tools/trace/out/w253/`, gitignored). **w253_dog**: r03_predog, walks through trigger 63, then stands; `TRACE_EPIN=59:91eec0:9316d0,60:91f6e0:9317e0,65:91ff00:9318f0
TRACE_POKE=960660=270f TRACE_FIELDSET=enemy TRACE_ERECS=59,60,65 TRACE_ENEMIES=3 TRACE_LOG_AT=9b000`, f40-539. **w253_dog2**: from r03_dogawake, Vincent standing, f0-499, same
without EPIN. Fields e2 = dog 65: `e2_face_pos` = C+0x20 facing, C+0x30 position; `e2_ai` byte 16 = brain state (AI +0x24); `e2_ai_mode`, `e2_motion`, `e2_speed`; Vincent `matrix`, `motion`, `p_hp`.
- Wake: bodies appear at f90, as Vincent crosses (-1346, 0, -600) (59 / 60 r_gst -> brain 1 from f228). Dog 65 stands in `st_a`, brain mode 0, until **f478**
  (mode 3; 388 frames, no shot at it), then rhtn f492, wk_a f495, rn_a f502.
- w253_dog2, dog 65: state 4 rn_a at 64.7 u/s from d 150 -> state 5 at d 24 (71.3 u/s) -> st_a at d 12.5 (f110) -> rhtn, states 2 / 6 -> **atk_2, state 7, f135, at d 12.5**, length 57 frames
  (f135-192; also f234-291, f306-363, f373-430, f439-496). Between attacks state 5 wk_a at 12 u/s (f200-220, d 22.9 -> 12.5). It attacked at d up to 20 without moving.
  The page's "stops at 12.4 u and never bites in 3 of 4 runs" can be checked against this. Vincent's HP loss here includes 59 / 60's fire.
  Checked (worker 0256): test_dog_ai 11 / 12 replay both; bites are -29 at atk_2 +16, -39 at +27, Vincent thrown back about 5.5 u each (c_std); r03_dogawake's AI queue has 16 entries (records in notes/enemy-ai-hook.md).

## Tools (worker 0253)

- `tools/trace/route_plan.mjs` (0217's planner, fixed): off-edge steps only within MAXDY 12 u. `out/route/wps2.json` .. `wps9.json` = this run's plans (game-derived, gitignored).
- route.py: walks on a carrot on the path line; only same-floor segments count; `--beats` (Start + ✕ on an event, FUN_003dfd18's test; save-box answers at the hold, +0x1558 bit 39), `--stop-flag`,
  `--stop-item`, `--hunt REC`, `--aim-at`, `--fire-range`, stuck order ✕ first. Right stick signs from w253_cal (rx > 0 lowers atan2(fz, fx); ry > 0 raises forward y).
  **The "log overflow" was not one:** steering writes 3 frames ahead, and on a run that used up its frames that landed on the log's first record. Now gapped; runs of 2500 frames kept full logs.

## Traps

- Machine memory: **earlyoom SIGTERMs PCSX2** when free memory falls under 10% (log: "Received CTRL+C", then `PINE command failed`). Seen about 8 times on 2026-11-04 with the worker fleet up. Not a
  game crash, no other worker. Start runs with >= 4.5 GB free and retry.
- Dumps at a fade or event: r0b_save is black; r07_walk, r07_e036, r08_key4 are small (2-3 MB), probably the same (not looked at).
- A state saved mid stage load has no player object and `fields.resolve_bases` fails on it; `--stop-flag` now waits for the event to end.
- The `--beats` box answer also fires on any event hold (bit 39), so an event may get stray ✕ / d-pad presses. rv_toujou took 2073 frames with three rounds of them. Harmless so far; these are not the game's timings.
- Runs from the same parent are not repeatable when steered (Dragonfly's first and second attempts differed). The recorded w217 scripts did replay once (w253_dog woke the dogs); not checked further.
- Walked by a bot with HP 9999: soldiers may be left alive behind him, and items and flags differ from a normal play.

## The states (workers 0217 / 0221) (all in chunk 02, slots 0 / 1 / 2 = chunks 0 / 1 / 2 loaded, current pair (1, 2))

Files: `tools/trace/out/route/<name>.p2s` (+ `.gs.zst`, `.png` = PCSX2's frame for the dump, `.json` = metadata).
Game-derived, gitignored. Frames count from the parent state's load (the hook's frame index).

| name | parent | pos (x, y, z) | frame (state / GS) | flags | pokes | in view |
|---|---|---|---|---|---|---|
| r02_walkway | sea-of-flames.p2s | (-1004.0, -160.4, -1084.4) | 1720 / 1728 | 2 = 7, 46 = 1 | HP 9999 | top of the stairs past ladder 0, looking +x along the walkway at soldier 45 (alive) |
| r02_barrier | r02_walkway | (-1004.6, -160.4, -1083.1) | 2041 / 2054 | 2 = 7, 46 = 1 | HP 9999 | same spot; soldier 45 killed by the run (aimed R1 shots) |
| r06_tp | r02_corridor | (-1328.1, -1.0, 1205.5) | 353 / 393 | 2 = 8, 46 = 1, 47 = 1 | HP 9999, teleport + C+0x4c0 = 0 | **chunk 06 market** (slots 0 / 6 / 8, pair (6, 8)): Vincent, cobbles, a stall; for P10 lighting. He floats 1 u up and can't move (no polygon) |
| r02_corridor | r02_barrier | (-868.1, -160.0, -1092.2) | 2002 / 2085 | 2 = 8, 46 = 1, 47 = 1 | HP 9999, **teleport** (-980, -160.45, -1078) | end of the walkway, facing a brick wall where the walk mesh continues NE |
| r02_deckend | r02_barrier | (-885.0, -137.5, -932.0) | 750 / - | 2 = 8, 46 = 1, 47 = 1 | HP 9999 | worker 0221, walked (no teleport): past both old "blockers" and the x -954 pause (✕), up to waypoint 60. No GS dump |
| r02_climb | r02_deckend | (-860.1, -142.1, -607.1) | 518 / 533 | 2 = 8, 46 = 1, 47 = 1 | HP 9999 | worker 0221, walked: foot of the brick-alley stairs at wp 106 (chunk 03 crossing near (-828, -16, -604) is up them); two soldiers fire from the top |

- Flags = event flags (DAT_0047dbb0 +0x38 XOR DAT_0047dbf0, FUN_003ff738), non-zero only. The base save has all 64 at 0.
- HP: every run pokes PS+0x20 (P+0x17c = 0x960640, so 0x960660) = 9999 so the soldiers can't kill Vincent; just
  before the save it is written back to 780 (the state holds 780; the HUD in the dump PNG still shows 99xx, it lags).
- Teleport (r02_corridor only): the five copies of Vincent's position in the state (C+0x30, C+0x60, body C+0x3b0 and
  C+0x3c0, MP+0x40; C = 0x919560, MP = 0x14d8180) moved 24 u forward **within his current walk polygon** (page poly 74,
  RAM 0x1142220, C+0x4c0 kept), past the first blocker. Not game-set state: anything that depends on how he got
  there is suspect.

## How to load one

- Trace from it: `python3 -I tools/trace/trace.py SCRIPT.json --state tools/trace/out/route/r02_corridor.p2s` (or
  grab_gs.py with the same state). The states still carry the pad hook from the run; `hook.patch_memory` now removes
  it first (call site back to scePadRead, 0x96000-0xfffff zeroed), so trace.py / grab_gs.py patch them as usual.
  Fields resolve the same (P 0x1339e0, C 0x919560, CAM 0x95efe0).
- Plain PCSX2: `-statefile <p2s>` (the unit's STATEFILE). With no script armed the hook passes the real pad through.
- Replay: `tools/trace/scripts/w217_<name>.json` = the pad bytes the game read (hook log), from the parent state, with
  the HP poke (and the teleport for r02_corridor; route.py `--teleport=-980,-160.45,-1078`). r02_walkway's first 880
  frames are k_enemy_engage7's inputs (east run, message box closed with two ✕, ladder 0 climbed).

## Tool: tools/trace/route.py

Closed-loop walker. Loads a parent state with the pad hook and N neutral frames, then over PINE reads Vincent's
position (C+0x30) and the camera basis (CAM+0x60 right, +0x80 forward) every frame and writes the next frames' stick
into the hook's script table (world = forward × (-ly) + right × lx, calibrated by w217_cal). Only the script table
is written while the game runs, so the recorded pad bytes replay the run exactly. Ends with PINE save state (slot 9,
moved to OUTDIR), optional GS dump (Shift+F8 via xdotool on :97).
- Route: waypoints `tools/trace/out/route/wps.json` = walk-mesh path start -> chunk 0b (page DCOL, Dijkstra over
  polygon neighbours + chunk-crossing edges + ladders; 523 edge midpoints, ~10.5k u). Planner script in the worker
  0217 scratchpad (plan.mjs); 0211's chunk waypoints.
- Stuck handling (< 3 u in 40 frames): cycle back-up 3 waypoints / sidestep left / right / ✕ / fight.
- Fight: nearest live enemy actor (object table, vtable 0x58e1f8, +0x28 bit 0, status +0x20 > 0) within 90 u;
  right stick onto its chest (signs found by trial; stick dead zone 0x30 of 0x80, FUN_00258218, so corrections are
  >= 0.5), R1 when on target. Killed soldier 45 in r02_barrier's run.
- Options: `--prefix SCRIPT:K`, `--teleport x,y,z`, `--drop-poly`, `--fight-first`, `--shots DIR` (screenshot when
  stuck), `--poke a=w`. Run under `flock tools/trace/out/.pcsx2.lock` with TRACE_SCRATCH = the pcsx2trace unit's dir.

## Blockers: not in the game (worker 0221, 2026-11-03)

Both stops were **route.py's walker**, not the game. The old target rule took the nearest *waypoint* of the next 40,
then the first one >= `look` (7 u) away. On a long segment (wp 25 (-1009.5) -> 26 (-935.2), 74 u; wp 40 (-872.8,
-1089.5) -> 41 (-782.7, -998.8), 128 u), once Vincent stood 7 u past waypoint i, i was still the nearest waypoint
and became the target again; under 7 u the target went back to i+1. The stick swapped between "toward i+1" and
"toward i" every 1-3 frames (w217_r02_walkway.json ends with (lx 0.28, ly -1) / (lx 0.05, ly +1) pairs), and
the stuck detector (< 3 u in 40 frames) fired. x -1009.5 + 7 = -1002.5 and -872.8 + 5..7 = the two "blockers".
- Game checks (PCSX2, tools/trace/scripts/w221_*.json): from r02_walkway, stick up: through x -1001 to -940
  (w221_walk1x). From r02_barrier, stick up: through x -1001 (w221_stop1). From r02_corridor, stick toward wp 41:
  straight NE through the "brick wall" view to (-770.8, -160, -979) (w221_ne). TRACE_CALLLOG=pushstep: FUN_00357d48's
  input move and result match collision.js navMove every frame (native/web/test_walkway_stops.mjs).
- No story gate and no event flag is involved, so the stage controller has nothing to open here.
- Fix: route.py now takes the nearest path *segment* (i -> i+1, point-to-segment in xz + 0.3 |dy|) and aims at
  i+1 or later. With it, the walker went r02_barrier -> wp 60 (-885, -137.5, -932) in 710 frames, and on to wp 106.
- A **real pause** on the way, from r02_barrier only: at (-954.2, -160.5, -1079.7) (frame ~50) the mover stops
  being called and the motion and camera freeze while the step keeps running (a message box or event; not decoded,
  passed to worker 0220 / P11). ✕ releases it (w221_stop1x: ✕ at 70 and 100, moving again at ~155). The
  walker's stuck cycle reaches "cross" on its 4th try. From r02_walkway (soldier 45 alive) there is no pause.
- Open: w221_walk1x frames 51-58, sliding along page poly 65's edge (x -957..-949): the game's per-frame slide
  differs from navMove's by up to 0.017 u, with the same input and the same hit. Not decoded.

**Teleport across polygons only half works** (worker 0217) (r06_tp is the usable half): moving the position to another polygon keeps C+0x4c0 (the RAM
   polygon), and the game slides him along the polygon chain instead (a test ended at (-806, -157, -933));
   clearing C+0x4c0 freezes him in the air, but the eib boxes (FUN_0026a0c0) still stream the chunks around
   him, so the frame renders correctly for dumps (`route.py --teleport=x,y,z --drop-poly --wp k:k --settle 350`). RAM polygon records are not in the page's order (74 -> 0x1142220,
   75 -> 0x1142460, 108 -> 0x11429c0, 121 -> 0x1142be0; neighbours stored as pointers), so a teleport needs that
   map decoded first.

## Next

- (Done by worker 0253, above: the stairs, the aim signs, the log.)
- Decode the RAM walk-polygon layout (cid loader under FUN_00266ae0) for teleports (above). Seen so far: 32-byte
  records, word 0 low nibble = vertex count, u16 +4 = flags (0x80 on some deck polygons), u16 vertex indices at
  +8.., neighbour pointers at +0x10 + 4 * edge.

**Boss arena (worker 0259, 2026-11-04):** `r0b_fight` (parent r0b_save, no global flag 19: Vincent really moves, unlike r0b_boss2) and `r0b_box4` (walked into btbox4 at (734, -100, 1461), f273). Boss brain 0x9a75c0 on this path; notes/boss-research.md 'The walked arena'.

