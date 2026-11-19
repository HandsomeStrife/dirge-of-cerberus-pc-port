# Start here

A short map of the project. Rules: [CLAUDE.md](../CLAUDE.md). Setup, testing and review:
[docs/CONTRIBUTING.md](../docs/CONTRIBUTING.md). The long, dated log is [HANDOFF.md](HANDOFF.md)
(see the last section for how to search it).

**Our tests are strict.** The gitignored marker `tools/trace/out/.require-data` exists on our machine,
so a test whose trace, GS dump, save state or `native/web/data/` file is missing FAILs (exit 1), in
every run, with no variable to set. Without the marker (an outside contributor's fresh clone) the
same miss prints `SKIP` and exits 0. `DIRGE_REQUIRE_DATA=0` / `=1` overrides the marker. Our save state
is found through the gitignored symlink `tools/trace/out/save-states` (docs/CONTRIBUTING.md 1.8, section 3).

## What this is

A faithful port of *Dirge of Cerberus: Final Fantasy VII*, PAL disc SLES-54185 (ELF `SLES_541.85`).
Every system is decoded from the game's own code and data, translated function by function with the
game address cited (`// FUN_005ae1f0`), and checked against the real game running in PCSX2 (per-frame
traces for gameplay, GS dumps for drawing). Nothing from the game is in the repository: you build
from your own disc.

## Goal

A **native C port that runs on Windows**. The **browser build** (`native/web`, JavaScript +
three.js) is the test bench: gameplay has been decoded and proven there first. The plan to move it
into one C codebase (Linux, Windows `.exe`, WebAssembly) is
[native-migration-plan.md](native-migration-plan.md).

## Current state (2026-11-19)

- **Browser build:** the first stage (Sea of Flames, room z128) plays from the opening to its boss:
  movement, camera, collision, ladders, jumping, aiming and shooting, enemies and their AI, the boss,
  event scripts and cutscenes, effects, HUD, pause and game over, results, items, checkpoints and
  Restart, sound and music. The last recorded whole-level bot run (2026-11-05) did not reach the boss
  on foot; the boss and results are tested from warps. 60 Hz NTSC timing by default; `?video=pal` for
  the 50 Hz timing the traces use ([frame-rate.md](frame-rate.md)).
- **Native C:** step 0 of the plan is done. One C tree builds Linux, Windows (MinGW) and wasm, runs
  the game's frame loop (`native/engine/core/frame_loop.c`, FUN_00248110) and has one moved module,
  floor shading (FUN_005ae1f0), equal to the JS on every tested point. It draws a cleared frame. See
  [docs/NATIVE.md](../docs/NATIVE.md).
- **Stand-ins:** `fidelity-audit.md` has roughly 150 to 180 rows marked GUESS and roughly 80 marked
  MISSING (2026-11-19; the tables label that column differently, so counts vary with how you read
  it). Each is a piece of work.

## Map: browser build (`native/web/`)

| File | What | Key addresses |
|---|---|---|
| `play.js` | the page's frame loop (the game's order: FUN_00323128), wiring, page aids | FUN_00323128 |
| `main.js`, `output.js`, `video_mode.js` | renderer setup, PCRTC output, frame timing | FUN_0040d478, FUN_0040d670, FUN_0040ce28, FUN_0040cb78 |
| `player.js` | Vincent: locomotion, FollowCamera, animation speed | FUN_0032ace0 (camera), FUN_0034c388 (movement modes), FUN_00333150 |
| `jump_core.js` | jump, hit and death motions | FUN_0055b8e0, FUN_00598f50 |
| `aim.js`, `aim_core.js`, `gun.js`, `lock_on.js` | aiming, reticle, firing, lock-on | FUN_005766c0, FUN_00579570, FUN_00329778 |
| `collision.js`, `obj_contact.js` | walk mesh, walls, object contact | FUN_00357d48, FUN_0054fc38, FUN_0035a440 |
| `cloth.js` | the cape | FUN_005b2550, FUN_005b0d30 |
| `floor_shade.js` | floor shade -> character light | FUN_005ae1f0 |
| `room.js`, `room_vis.js`, `room_occl.js`, `area_stream.js`, `chunk_anim.js` | room drawing, visibility, occluders, chunk streaming | FUN_0026ccc8, FUN_00264ee0, FUN_0026a710 |
| `enemy_ai.js`, `enemies.js`, `enemy_hit.js` | enemy brains, drawing, hits | FUN_00559748, FUN_00565480, FUN_0025c770 |
| `nav_graph.js`, `path_mover.js`, `fly_mover.js`, `turn_mover.js` | navigation and movers | FUN_00351928, FUN_00352a60, FUN_0034db80 |
| `boss_z128.js`, `boss_io.js` | the stage boss | FUN_00aa16f8, FUN_00569870 |
| `event_vm.js`, `event_rt.js`, `event_actor_rt.js`, `event_actors.js`, `event_window.js`, `event_fx.js`, `event_sound.js` | the event script VM, actors, subtitles | FUN_003a99f0, FUN_003798a0, FUN_00376308, FUN_003b8598 |
| `stage_controller.js`, `stage_info.js`, `stage_view.js`, `intro.js` | stage script `main`, stage messages, the opening | FUN_00324e70, FUN_003fdf00 |
| `effects.js`, `effects_ribbon.js`, `shot_fx.js`, `menu_fx.js` | FED particle effects, ribbons, shots | FUN_002ea6a0, FUN_002d8578, FUN_005534f0 |
| `hud.js`, `hud_core.js` | the HUD | FUN_003aec10, FUN_003d5a80 |
| `pause.js`, `pause_layer.js`, `menu_layout.js`, `shop.js` | pause menu, menu boxes, the Shop (not wired) | FUN_003c0220, FUN_003c3c50 |
| `gameover.js`, `gameover_title.js`, `gameover_layer.js`, `results.js` | game over, results screen | FUN_00334590, FUN_003fdb48 |
| `items.js`, `items_view.js`, `props.js`, `props_view.js`, `areas.js` | pickups, barrels and barriers, stage areas | FUN_0055f128, FUN_00584408, FUN_0054ef68 |
| `checkpoint.js`, `warp.js`, `game_state.js` | checkpoints and Restart, warps (page aid), game state | FUN_00344d68, FUN_00326068 |
| `audio.js`, `music.js`, `ambient.js`, `pcm_ring.js` | sound effects, 3D sound, music, ambience | FUN_003e9ed0, FUN_003e9220, FUN_003ed000 |
| `report.js` | the R report button (ours, not the game's) | none |
| `test_*.mjs` | node and page tests | |

Clip packs and actions: `native/web/ACTIONS.md`.

## Map: everything else

| Path | What |
|---|---|
| `native/engine/`, `native/platform/`, `native/game/` | the native C port: spine, SDL platform layer, moved modules |
| `native/web/c/` | node adapters that run the moved C modules (wasm) under the JS tests |
| `native/renderer/`, `native/gpu/`, `native/assets/*/` | older C renderers and the asset loader code |
| `native/assets/models/`, `tools/byo/` | the exporters and the disc build (`build_web.sh`, `disc.py`) |
| `port/` | KEL archive loader, the static recompiler (`recomp/`) and the oracle harness |
| `tools/trace/` | PCSX2 tracer, call logger, GS grabber, trace scripts |
| `tools/gsdump/` | GS dump reader and frame renderer |
| `tools/*.java` | Ghidra headless scripts |

## Research notes by area

| Area | Notes |
|---|---|
| Engine overview, file formats | engine-map.md, DECODER-STATUS.md, STATE-OF-THE-PORT.md, byo-build.md, zone-map.md, filecode-zone-map.md |
| Movement, jump, ladders, walls | actions-research.md, jump-research.md, wall-slide-research.md |
| Camera | battle-camera.md, death-camera.md, fidelity-audit.md (camera rows) |
| Aiming and shooting | aim-research.md |
| Enemies, AI, boss | enemy-research.md, enemy-model.md, enemy-placement.md, enemy-activation.md, enemy-ai-hook.md, other-types.md, boss-research.md |
| Room, streaming, lighting | room-blend-streaming.md, area-stream.md |
| Events and cutscenes | event-vm-research.md, stage-controller.md, stage-script-cmds.md, story-cutscenes.md, message-research.md |
| Effects | effects-research.md, ribbon-research.md, barrel-research.md |
| HUD, menus, game over, results, Shop | hud-research.md, menu-research.md, gameover-research.md, results-research.md, shop-research.md |
| Items, NPCs, checkpoints | items-research.md, npc-research.md, checkpoint-research.md |
| Sound and music | audio-research.md |
| Timing | frame-rate.md |
| The first stage as a whole | first-level-plan.md, route-states.md |
| Native port | native-migration-plan.md, docs/NATIVE.md |
| Tools | pcsx2-headless-setup.md, tools/trace/README.md, tools/gsdump/README.md, STATUS.md (Ghidra) |
| Every stand-in | fidelity-audit.md (DECODED / DATA / GUESS / INVENTED / MISSING rows) |

`session-2026-10-*.md`, `build-log.md`, `autonomy-journal.md` and `PLAN.md` are early history.

## Open items

- **Native migration**, steps 1 to 14 of [native-migration-plan.md](native-migration-plan.md): leaf
  logic, then the player, the renderer, input, the frame spine, events, audio, enemies, world
  objects, effects, HUD, and the Windows release.
- **The GUESS and MISSING rows** in `fidelity-audit.md`.
- **First stage gaps** in [first-level-plan.md](first-level-plan.md) and the newest HANDOFF entries:
  the Shop is decoded but not wired, effects in events, doors that Vincent can walk through, the
  whole-level bot run (`test_level_run_page`).
- **Tooling gaps for outside contributors:** see "Gaps" in docs/CONTRIBUTING.md.

## How to use HANDOFF.md

It is a dated log of about 280 entries, oldest first, with a few topic sections at the top. Don't
read it end to end. Each entry starts like `- <Title> (worker NNNN, YYYY-MM-DD; notes/<file>.md ...)`.
Search it:

```
grep -n "FUN_0032ace0" notes/HANDOFF.md            # everything about one function
grep -n "^- .*(worker" notes/HANDOFF.md | tail -20  # the newest entry titles
grep -n -i "ladder" notes/HANDOFF.md | cut -c1-200  # one topic
grep -n "test_death_camera" notes/HANDOFF.md        # who wrote a test and why
```

Newer entries correct older ones. When two disagree, trust the newer one, and check the code.
