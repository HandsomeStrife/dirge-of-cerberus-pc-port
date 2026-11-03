# Route save states along the first level (worker 0217, 2026-11-03)

Goal (plan P2 / P4 / P6 / P8 / P10): PCSX2 save states, each with a GS dump, along the walking route 02 -> 03 -> 04
-> 05 -> 06 -> 07/08 -> 09 -> 0b. **Result: walking reached only chunk 02.** The real game stops Vincent at two places
on the start deck that the page lets him through, and neither stop is in the collision data (see "Blockers").
Chunk 06 has one **teleport** state (r06_tp: Vincent hangs in the air, the game streams chunks 6 / 8 itself; method
from worker 0213, who has chunk-09 states the same way in their scratchpad grab/tp09/). 03-05, 07, 0b: none.

## The states (all in chunk 02, slots 0 / 1 / 2 = chunks 0 / 1 / 2 loaded, current pair (1, 2))

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

- Walk on from r02_climb (wp 106 -> 108, up the stairs to chunk 03). Leg 2's first run stuck there: the walker's
  fight mode could not aim up at the two soldiers at the top (pitch error stayed 0.44; check aim_stick's pitch sign
  or the camera pitch clamp), and the walk up was blocked while they stood there. Chunks 0/1/2 are still the loaded
  set at r02_climb; in the story (2, 3) loads in rv_matiawase, so chunk 03 may need that beat first.
- Keep legs <= ~1000 frames: an 1800-frame leg overflowed the hook log at save time ("log record 0 corrupt").
- Decode the RAM walk-polygon layout (cid loader under FUN_00266ae0) for teleports (above). Seen so far: 32-byte
  records, word 0 low nibble = vertex count, u16 +4 = flags (0x80 on some deck polygons), u16 vertex indices at
  +8.., neighbour pointers at +0x10 + 4 * edge.
