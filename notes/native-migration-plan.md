# Native migration plan: browser JS -> one C codebase (worker 0281, 2026-11-11)

Goal (Dan, 2026-11-09): a native C port that runs on Windows. The browser stays the test bench.

Short version: **yes to the proposed direction**, with three changes:

1. **Don't run half-JS, half-C inside play.html.** Each moved module is proven against the JS by the node tests, which
   run against the C through a small wasm adapter. The page switches to C in two steps: first a new page
   (`play_c.html`) for a vertical slice, then play.html once C plays as far as JS does. Wiring C modules one at a time
   into play.js would mean writing JS<->wasm glue for objects that are shared everywhere, and then throwing it away.
2. **Build a vertical slice early** (Vincent walking z128 with the camera, collision and room draw, on Windows and in the
   browser) before porting the remaining bulk logic. It tests the shell, the renderer seam and the data loading
   while there is still time to change them.
3. **The C reads the same exported data the page reads** (`native/web/data/`, built by `tools/byo/build_web.sh`). No exporter rewrite now.

Size: about **47 worker jobs** of porting, about **65-75 including reviews**. First step: **step 0, the build skeleton**
(section 3).

---

## 1. Inventory

### 1.1 native/web (the browser build)

The game code is 35.4k lines of JS in 71 modules. There are also 152 test files (96 node, 56 page) and two HTML
shells. three.js 0.169 comes from a CDN. Models are glTF (`.glb`); the rest is `.bin` / `.json` / `.rgba` / `.flac`
in `data/` (906 MB, gitignored).

"three" = number of `THREE.` uses. A module with none is plain logic and moves to C by straight translation.

| Group | Modules (lines) | What it does | Depends on | three |
|---|---|---|---|---|
| Frame / shell | play.js 1808, main.js 363, play.html, index.html | page shell: loading, the 50 Hz tick loop (`TICK` 1/50, up to 8 ticks per drawn frame), wiring of every subsystem, URL page aids | everything | yes (31 / 36) |
| Player | player.js 2287, jump_core.js 1065, aim_core.js 757, lock_on.js 192, actions/ladder.js 446, gun.js 89 | locomotion, follow camera (FUN_0032ace0), SpeedAnimator / poseLocal pose build, jumps, aiming, ladder | collision, obj_contact, game_state | player 6, gun 15 |
| Aim view | aim.js 493 | camera weapon views, reticle | player, aim_core, lock_on, enemy_hit | 18 |
| World | collision.js 645, obj_contact.js 347, room.js 449, room_occl.js 180, room_vis.js 106, chunk_anim.js 94, area_stream.js 178, areas.js 102, floor_shade.js 26, cloth.js 236 | room load and draw, occluder cull, visibility, streamed areas and lights, walk-polygon shade, cape cloth | room_occl | room 39 |
| Enemies | enemy_ai.js 5936, enemy_hit.js 222, enemies.js 424, path_mover.js 986, nav_graph.js 340, fly_mover.js 112, turn_mover.js 54, boss_z128.js 396, boss_io.js 138 | all enemy brains (soldiers, dogs, heli, boss), hit volumes, movers, nav graph | effects, game_state | enemies 13 |
| Events | event_vm.js 312, event_rt.js 362, event_actor_rt.js 474, event_actors.js 485, stage_controller.js 646, event_window.js 560, event_sound.js 466, event_fx.js 214, intro.js 92, stage_view.js 78 | the game's JVM-subset script VM and its natives, cutscene actors, stage program, message windows | audio, music, pcm_ring, menu_fx | event_actors 22 |
| Items / world objects | items.js 729, items_view.js 70, props.js 658, props_view.js 100, checkpoint.js 319, warp.js 153, shop.js 556 | pickups, use, barrels and props, checkpoints / restart, page warps, the Shop (decoded, not wired) | enemy_hit, pause | views 4 / 11 |
| Menus / HUD | hud_core.js 942, hud.js 359, pause.js 818, pause_layer.js 255, menu_layout.js 141, menu_fx.js 124, results.js 552, stage_info.js 553, gameover.js 259, gameover_layer.js 80, gameover_title.js 269 | HUD logic and draw, pause menu, menu boxes, results, stage info, game over | effects, audio | hud 18, pause_layer 17, title 32 |
| Effects | effects.js 2797, effects_ribbon.js 445, shot_fx.js 182 | FED effect channels (logic and draw), ribbons, tracers and impacts | area_stream | effects 34 |
| Audio | audio.js 1106, music.js 423, pcm_ring.js 101, ambient.js 451 | SPU ADPCM, SE sequencer at 240 Hz (rendered offline into a buffer, then played with WebAudio), BGM / voice through the decoded PCM ring, placed sounds | WebAudio | 0 |
| Output | output.js 283 | PCRTC merge (two read circuits one line / one VCK apart), native 432x512 mode | three | 22 |
| Debug / test aids | report.js 421, warp picker (in play.html), game_state.js 27, collision_stub.js 16, trace_pose.mjs 29 | R-key report (screenshot plus state to `/srv/shared/dirge-port/reports`), warps | DOM | report 14 |

About 21k of the 35.4k lines touch neither three.js nor the DOM. Most of the rest use them in a few places
(`window.` hooks, a `fetch`); real three.js code sits in about ten files (play, main, room, effects, hud, pause_layer,
gameover_title, output, event_actors, aim, report).

Two things three.js does for us that the C must do itself:
- **Skeletal animation.** Action clips (ladder, aimed clips, crossfades) still go through `THREE.AnimationMixer`.
  That path is a GUESS row in `notes/fidelity-audit.md` (lines 173, 286, 449). Locomotion already uses the decoded
  pose build (`poseLocal`, FUN_005a9db0). In C we write only the decoded path, so the migration **removes** those
  GUESS rows instead of porting them.
- **Skinning with 4 influences** (glTF limit; GUESS row 333, the 5th influence is dropped). The C skinning can take
  all influences. That needs one exporter change: a `.bin` sidecar with the full weights.

### 1.2 The existing C (stopped 2026-10-16, except gpu/script/text touch-ups in early November)

| Path | Lines | Verdict | Why |
|---|---|---|---|
| engine/core: frame_loop, engine_state, input | ~1.6k | **Keep, update** | Translations of FUN_00248110 (frame loop), FUN_00247508 (state dispatch), the pad poll. They are the spine the JS doesn't have: play.js grew its own order. Input needs an SDL backend. |
| engine/math: dmath, vu0 | ~540 | **Keep** | Check f32 behaviour against the JS's `Math.fround` uses. |
| engine/scene: actor, object_list, scene_graph | ~1.2k | **Keep, update** | Actor pool (0x480 blocks, FUN_005a71b8..), object-list walk FUN_00408758. The JS has no actor pool; it keeps fields by their game offsets (`MP+0x450`) on JS objects. C structs with offset-commented fields fit the game better, so the ported modules should hang off this pool. |
| engine/scene: camera, light | ~1k | **Update** | camera.c is the view / projection build (FUN_00259928..). The follow camera is in player.js and moves over. light.c must be checked against area_stream's `Light2` / `pickLight`. |
| engine/scene: material, material_loader | ~600 | **Probably drop** | Built for raw game files; the runtime reads exports instead. Check before deleting. |
| engine/tests | ~4k | **Keep** | Runs on Linux gcc; fast. |
| gpu/ | 3.7k | **Reuse parts** | `renderer_gl.c` (GL 3.3 core, no platform code) is the base for the GL backend. The EGL headless context (`gfx_context_egl.c`) gives render-to-PNG on this box with no window, for GS-dump grading in CI. The demos (render_scene*, room_live, render_char, main.c) are dropped once the slice replaces them. |
| renderer/ | 471 | **Keep out of the build** | Software rasteriser. The GS dumps are the oracle now. |
| app/main.c | 741 | **Replace** | Logging-renderer shell; becomes the SDL shell. |
| script/ (jvm.c, classfile.c, dcc.c, bridge_*) | 2.9k | **Mostly replace** | An older JVM subset. event_vm.js is the later, fuller translation of FUN_003ad288 and is what's tested. Port event_vm.js; reuse classfile.c's parser if it passes parity. |
| text/ (doctext, docfont) | 600 | **Keep (pipeline)** | Text and font decoders; used by the data build. |
| common/doc_cipher | 150 | **Keep** | Reads cipher constants from the user's ELF. |
| assets/collision/cid.c | 750 | **Keep, check** | Shares 15 cited functions with collision.js; parity-test it against collision.js before reuse. |
| assets/effects/fed.c | 370 | **Keep, check** | Shares 10 functions with effects.js. |
| assets/audio (dirge_sound, dirge_wd, dirge_atdec) | 1.1k | **Keep (pipeline)** | ADPCM / bank / ATRAC decode used by the data build. The runtime SE sequencer is audio.js's, ported. |
| assets/models, assets/textures (C) | ~2k | **Keep (pipeline)** | Loaders used by exporters. |
| assets/*.py exporters | 17.7k | **Keep** | They make `data/`; both builds read it. |
| capstone/, gallery/, dashboard/ | 5k | **Drop** (archive in git history) | October milestone demos. |
| movie/ | Python | **Later** | FMV pipeline; not on the first-level path. |

How much overlaps: native/web cites 2,935 distinct game functions; native/engine cites 244, and 107 of those are also
cited by the JS (frame loop, state machine, stage flags, actor pool). So the C engine is a correct but thin spine, and
almost all the gameplay is in the JS.

**How the designs fit.** The C engine follows the game's own structure: one frame function in the game's order, a
state dispatch, an actor pool, render queues flagged by the object-list walk and handed to a renderer at one seam
(`renderer_submit_scene`). The JS follows the page's structure: play.js calls each subsystem in an order that was
checked piece by piece, and three.js owns the scene graph. The plan is to keep the C spine and move the JS logic
into it module by module. Each module keeps its API shape so the tests can drive both versions. The order inside
play.js's tick becomes the order of `DocFrameHooks` calls, and every place where play.js differs from FUN_00248110
gets written down while doing it (step 5). The renderer seam stays where frame_loop.h puts it: game code fills a
per-frame draw list, the renderer draws it. OpenGOAL uses the same design (section 5b).

---

## 2. Toolchain

### 2.1 What this box has (checked 2026-11-11)

| Tool | State |
|---|---|
| gcc 11.4, cmake 3.22, ninja, make | installed |
| MinGW-w64 x86_64 gcc 10 (win32 + posix threads), mingw zlib | installed |
| wine64 6.0.3, xvfb-run | installed (wine32 missing; not needed for a 64-bit exe) |
| node 22, playwright (global) | installed |
| SDL2 runtime (host) | installed; **dev headers missing** (`libsdl2-dev`) |
| SDL2 for MinGW | **missing**: the official `SDL2-devel-2.30.9-mingw.tar.gz` works without sudo |
| Emscripten | **missing**: emsdk 3.1.74 installs without sudo (1.5 GB) |
| clang | missing (not needed) |
| GPU | AMD Radeon gfx1103, Mesa 23.2: GL 4.6 core via EGL (gpu/README.md) |

### 2.2 Throwaway builds (scratchpad, nothing committed)

- **Windows:** one C file (SDL2 window, GL 3.3 core context, clear, swap, audio and pad init), built with
  `x86_64-w64-mingw32-gcc ... -lSDL2 -lopengl32`, run with `xvfb-run wine64 hello.exe`. Result:
  `GL 4.5 (Core Profile) Mesa ... llvmpipe`, 5 audio drivers. **The Windows build and wine smoke test work today.**
- **WebAssembly:** the same file with `emcc -sUSE_SDL=2 -sMIN_WEBGL_VERSION=2`, run in the headless Chromium the page
  tests already use (swiftshader). Result: `OpenGL ES 3.0 (WebGL 2.0)`, audio up. **The wasm build works in the
  page-test browser today.**

### 2.3 How each target will build and run

One CMake tree (`native/CMakeLists.txt`, extended) with three presets:

| Preset | Compiler | Output | Run |
|---|---|---|---|
| `linux` | gcc | `dirge` + C unit tests | `ctest`; headless render tests through EGL; the game itself through SDL on X if a display exists |
| `windows` | MinGW-w64 | `dirge.exe` + `SDL2.dll` | `xvfb-run wine64 dirge.exe --data <dir> --smoke 300` (300 ticks, then exit with a state hash) |
| `wasm` | emcc | `dirge.wasm` + `dirge.js` (MODULARIZE, `ENVIRONMENT=web,node`) | `play_c.html` in a browser; node tests load the same `.wasm` |

Pinned versions: SDL 2.30.x (MinGW: the official devel tarball, fetched by a script into a gitignored
`native/third_party/`; Linux: built from source by CMake FetchContent, so no sudo; wasm: `-sUSE_SDL=2`),
emsdk 3.1.74 in `~/emsdk` (not the repo).

Small vendored libraries, all permissive and single-file: cJSON (MIT) for the `.json` exports, cgltf (MIT) for `.glb`,
dr_flac (public domain / MIT-0) for BGM and voice, stb_image_write (public domain) for report screenshots, plus zlib
(text decode). Shaders are written once in the GLSL subset shared by `#version 330 core` and `#version 300 es`, with the
version line added at load time.

**Floating point.** The wasm test bench and the Windows exe must agree to the bit, or a parity pass in the browser proves
nothing about Windows. Build both with `-ffp-contract=off`, no `-ffast-math`, `float` for the game's f32 math (SSE2 on
x86-64, native f32 in wasm). A CI check runs the same input log on both and compares state hashes per tick.

### 2.4 Repo rules, carried over

- **No game data in the repo**, and nothing derived from it. Test fixtures stay in gitignored `tools/trace/out/`, the
  data in `native/web/data/`.
- **No recompiled game code in the port.** `port/recomp` stays an oracle only; nothing in the C game links it.
- **Bring your own disc.** `tools/byo/build_web.sh` already builds `native/web/data/`. The native build reads the same
  directory: `dirge.exe --data <path>`, default `./data` next to the exe. Step 7 adds an install step that copies
  or links data next to the Windows exe, and a `--check` mode that lists missing files.
- Decryption keys stay read from the user's ELF at run time (`doc_cipher.c`), same as now.

---

## 3. Order of migration

A "job" here = one worker session at today's pace: about 1,000-1,500 lines of JS logic ported with its tests passing
against C, or one renderer / platform piece. Reviews come on top (the project's rule: review, fix, re-review).

### How parity is checked (all steps)

- **Node tests run against C unchanged.** Many tests already take the module path as an argument (for example
  `test_jump.mjs [jump_core.js] [player.js]`, built for mutation testing). For each ported module, a small adapter
  `native/web/c/<module>.mjs` exports the same API backed by the wasm. Run the test with the adapter path:
  `IMPL=c node ... test_jump.mjs c/jump_core.mjs`. Of the 96 node tests, 83 read PCSX2 trace fixtures, so this re-runs
  the trace checks against the C at no extra cost.
- **Tick logs for the page.** A test-only hook in play.js records per tick the inputs plus a state digest
  (Vincent's position and angle, the camera, the HP / ammo / flags, each actor's position and brain state). The C replays
  the same input log and must match tick for tick. This covers wiring and frame order, which the per-module tests
  can't.
- **Rendering** is graded the way it is now: against the GS dumps (`test_room_grade` method: SSIM / edges plus one
  look, not mean colour), and side by side with the three.js page at the same tick.
- **When JS and C disagree,** the PCSX2 trace decides, not the JS. A C fix that the trace backs is fine; mark it in the
  audit and port it back to JS only if the JS is still in use.
- **The node test harness for C itself:** C unit tests (engine/tests style) for internals, ctest on Linux.

### Steps

| # | Step | Jobs | Checked against |
|---|---|---|---|
| **0** | **Build skeleton.** Three CMake presets; SDL platform layer (window, GL context, keyboard / mouse / pad, audio callback, file read with a sync native path and an async browser path through `fetch`); vendored libs; `play_c.html` loading the wasm; one node adapter plus the IMPL switch, proven on `game_state.js` + `floor_shade.js`; wine smoke script. | 2 | Both builds start and draw a cleared frame; one node test passes on JS and C; wine smoke prints a hash. |
| 1 | **Leaf logic:** jump_core, aim_core, lock_on, obj_contact, collision (check cid.c first), GameRandom, movers (path / nav / fly / turn). | 3 | test_jump, test_aim*, test_lock_on, test_collision, test_wall, test_push_out, test_nav_*, test_path_walk |
| 2 | **Player + animation runtime:** player.js (locomotion, FollowCamera, SpeedAnimator), the decoded pose build for *all* clips (replacing the mixer GUESS), skinning, ladder, cloth. | 4 | test_strafe_walk, test_cam_traces, test_camera*, test_approach, c_run_pose_blend and w101_aim_pose pose checks, test_cape_light |
| 3 | **Renderer core + vertical slice:** GL backend from gpu/renderer_gl.c; per-frame draw list at the frame_loop seam; room (room.js + main.js shader, occluder cull, area lights, floor shade); Vincent skinned with gun and cape; PCRTC output merge (output.js) and the full-HD default. `play_c.html` and `dirge.exe` walk z128 with camera and collision. | 4 | GS dumps (room grade, char light, floor light); tick log vs the page for a walk route; wine smoke |
| 4 | **Input** done properly: keyboard, mouse (MouseFeed, the direct-mouselook option), SDL GameController mapped to the PS2 pad bits; the pad poll in engine/core/input.c. | 1 | test_mouse_page logic, test_input (C), tick logs |
| 5 | **Frame spine:** play.js's tick order moved into frame_loop.c's hooks (FUN_00248110 order), stage-state dispatch, pause / restart / checkpoint / warp plumbing; note every place where play.js's order isn't the game's. | 2 | tick logs over intro-off start, restart, checkpoint, warp |
| 6 | **Events:** event_vm, event_rt, event_actor_rt, event_actors, stage_controller, event_window, intro, stage_view, event_fx. | 3 | test_event_vm, test_event_*, test_story_cutscenes, test_stage_controller, cmp_event_actors / cmp_event_cams |
| 7 | **Audio:** SPU ADPCM and the 240 Hz SE sequencer running live in the mixer (not rendered offline as the page does), PCM ring, music, voice, ambient. Driven from the SDL audio callback; the game thread hands blocks over a lock-free ring. | 3 | Sample-exact compare of one SE rendered by JS and C; test_voice_ring timings; test_music, test_audio*, test_combat_sound |
| 8 | **Enemies:** enemy_ai (5.9k: split by brain: soldiers, dogs, heli, boss), enemy_hit, enemies, boss_z128, boss_io. | 5 | test_enemy_ai, test_dog_ai, test_enemy_hits, test_boss_*, test_heli, test_hit_*, tick logs in the market and dog sections |
| 9 | **World objects:** items, props, checkpoint, warp, areas, area_stream, chunk_anim, room_vis, shop. | 2 | test_items, test_props, test_checkpoint, test_room_*, test_areas, test_warp_flags |
| 10 | **Effects:** effects (logic split from draw), effects_ribbon, shot_fx; GL draw of sprites, ribbons and blend modes. | 4 | test_effects*, test_tracer, test_barrier_fx; GS dumps of effect frames |
| 11 | **HUD and menus:** hud_core, pause, menu_layout, menu_fx, results, stage_info, gameover, gameover_title, plus their 2D draw (game font, boxes) and the widescreen HUD option. | 5 | test_hud*, test_pause*, test_results*, test_gameover*, test_menu_*; GS dumps of the HUD, pause and results screens |
| 12 | **Debug UI and reports** (section 3.2). | 2 | the R report flow on web and native; warp picker |
| 13 | **Page tests on C:** run the 56 page tests against `play_c.html` (most only need the page URL and the `__play` getters exported from wasm); then play.html switches to C and the JS gameplay modules are frozen. | 3 | the full suite green on C |
| 14 | **Windows release shape:** data location, `--check`, settings file, window / fullscreen / vsync, packaging the exe + SDL2.dll; a smoke test on real Windows (Dan's machine). | 2 | wine smoke + one real-Windows run |

Total porting: **47 jobs** (0: 2, 1: 3, 2: 4, 3: 4, 4: 1, 5: 2, 6: 3, 7: 3, 8: 5, 9: 2, 10: 4, 11: 5, 12: 2, 13: 3, 14: 2,
plus 2 spare for the BYO hook-up and exporter sidecars). With reviews and re-reviews at the project's usual
rate: **65-75**. Steps 1, 2, 6-11 are mostly mechanical translation of decoded, tested JS. That is work Sonnet can do
(Dan's delegation rule), with reviews kept on the default model. Steps 0, 3, 5, 13 are design work and stay on the
default model.

Parallel: after step 3, steps 6-11 are independent and can run 3-4 at a time (they share only the actor pool and the
draw-list API, which step 3 fixes).

### 3.1 The rule once something has moved

After step 3, gameplay fixes for a subsystem already in C go into the C; the JS copy gets the same fix only while
play.html still runs JS (until step 13). Not-yet-moved subsystems keep being fixed in JS. New features (for example
wiring the Shop) wait for their step or go straight into C. From step 13 on, the JS gameplay code is read-only
and is deleted once the C has passed a full level run.

### 3.2 Subsystem notes

- **Rendering.** three.js scene and materials become a draw list: each game subsystem pushes draw records (mesh,
  material state as the game's GS state: alpha / test / blend / depth bits, matrices, lights) in the order the game
  draws. One GL backend draws the list. The room and character shaders are already custom (`ShaderMaterial` in room.js,
  hud.js, effects.js, output.js) and port almost line by line to GLSL. The PCRTC merge (output.js) is one fullscreen
  pass. Full HD stays the default, native 432x512 stays `--res native` (Dan's choice, already recorded).
- **HUD.** hud_core.js is plain logic; hud.js draws with three's orthographic camera. Port to a 2D batch over the
  same GL backend, using the game's font from the exports.
- **Audio.** WebAudio becomes one SDL audio stream at 48 kHz. The page renders each SE offline then plays the buffer;
  C runs the decoded sequencer live, one 240 Hz driver tick (200 samples) at a time. That is how the IOP does it, and
  it removes the page's scheduling layer. The PCM ring's timing (decoded, FUN_003ed000) is driven by the mixer clock the way
  the page drives it by the AudioContext clock. BGM and voice are FLAC from the BYO build, decoded with dr_flac.
- **Input.** SDL keyboard / mouse / GameController, mapped to the 16 pad bits engine/core/input.c already reads.
  Current keys stay (WASD, Shift, Space, F, E, Q, Esc / Enter, R).
- **File loading.** One `fs_load(path, callback)` API. Native: synchronous read from `--data`. Browser: `fetch` into wasm
  memory, callback on arrival. The game's loading screens and stalls already gate on "loaded" in the JS, so the
  callback form maps directly. The 906 MB is never preloaded; areas load as the JS loads them.
- **Test harness.** (a) C unit tests under ctest. (b) The node tests through the per-module adapters and `IMPL=c`.
  (c) Tick-log replays (JS page records, C replays, native and wasm). (d) The page tests against `play_c.html`, then play.html.
  (e) The wine smoke run per commit that touches native/. Determinism: single-threaded game code like the JS (the
  event VM's yields stay as explicit frames, as event_vm.js does now), audio on its own thread behind a ring.
- **Debug UI.** In the browser, keep the HTML: the warp picker and the report button stay JS, calling exported wasm
  functions (`dirge_warp(name)`, `dirge_state_json()`). On native: command-line page aids matching the URL ones
  (`--warp market`, `--intro 0`, `--autoskip 1` ...), and the R key writes `reports/<id>/meta.json` + `plain.png`
  locally (same layout as `/srv/shared/dirge-port/reports`). No in-game GUI toolkit for now (open choice D5).

---

## 4. Risks and choices for Dan

| # | Choice / risk | Recommendation |
|---|---|---|
| D1 | **Licence.** The repo has no LICENSE file, so it is all-rights-reserved by default. That matters for anything we link: GPL code (PS2Recomp, m2c) forces GPL-3 on a shipped exe. | Pick a licence before step 0. Any permissive licence (MIT / zlib) or GPL-3 works with the libraries named above. Recommendation: MIT, and keep GPL code out of the build. |
| D2 | **Cut-over style:** module-by-module inside play.html (JS<->wasm glue) vs proving modules by tests and switching pages at the end (this plan). | Tests + slice + page switch. The glue would touch every shared object and be thrown away. |
| D3 | **Data:** the C reads the exports (`native/web/data/`) vs parsing the game's files directly. | Exports now. The 17.7k lines of Python exporters are decoding work we keep; rewriting them in C is a later, separate job, needed only if Windows users must build data without Python (D4). |
| D4 | **How a Windows user builds data.** build_web.sh needs bash, Python + numpy + Pillow, a C compiler, and ffmpeg dev libraries for music. | For now: run it under WSL, document it. Later, if wanted: port the exporters into a native `dirge-extract.exe` (rough size 10-15 jobs). |
| D5 | **Debug UI on native:** none (flags + keys + reports), Dear ImGui (C++, MIT, via cimgui), or own overlay with the game font. | Flags + keys + R reports. The browser stays the place for the warp picker. |
| D6 | **Graphics API:** OpenGL 3.3 / GLES 3.0 shared subset (tested here) vs a layer like sokol_gfx (D3D11 on Windows, WebGL2 on web). | GL 3.3. It's tested on both targets and gpu/ already has a GL core. Revisit only if Windows GL drivers cause trouble. |
| D7 | **SDL2 vs SDL3.** | SDL2 2.30.x: tested on both targets here. Moving to SDL3 later is a small platform-layer change. |
| D8 | **Display rate.** The game is 50 Hz PAL; most PC screens are 60 Hz+. The page now draws up to 8 ticks per rAF and shows the latest; no interpolation (it would be invented). | Same on native: fixed 50 Hz ticks, draw the latest tick, vsync on. Any frame interpolation is a later option, off by default. |
| R1 | **Floats differ between the builds** (FMA contraction, x87, fast-math), so a browser pass doesn't prove Windows. | `-ffp-contract=off`, no fast-math, SSE2; the per-tick hash compare between wasm and exe in CI (2.3). |
| R2 | **JS and C both correct but different** (JS uses double in places where the game uses f32). | The trace decides; accept C closer to the trace; widen no test tolerance without a note. |
| R3 | **play.js's order isn't the game's frame order**; moving to FUN_00248110's order can change behaviour that tests depend on. | Step 5 lists each difference and checks it against a trace before choosing. |
| R4 | **Two copies drift** while both are live (steps 3-13). | The rule in 3.1; keep the window short by running steps 6-11 in parallel. |
| R5 | **Test fixtures are local only** (gitignored traces), so CI elsewhere can't run the parity tests. | Same as today: the parity suite runs on this box. |
| R6 | **Wine is not Windows.** GL under wine uses Mesa llvmpipe here, not a Windows driver. | One real-Windows smoke run per milestone (Dan), from step 3 on. |

---

## 5. Outside projects

### 5a. PS2Recomp (github.com/ran-j/PS2Recomp)

What it is: an experimental static recompiler (R5900 -> literal C++, one line per instruction, e.g.
`ctx->r4 = ADD32(ctx->r4, 0x20)`) plus a runtime. GPL-3.0. Active (last push 2026-10-23), ~100k lines, mostly tested with MSVC.
Read from a shallow clone in the scratchpad.

Runtime completeness:
- **GS:** a software rasteriser (`gs_cpu_backend.cpp`, ~2k lines) behind a GIF arbiter; display through raylib. No
  GPU renderer.
- **VU1:** an interpreter (`ps2_vu1_core/upper/lower`, ~3k lines) and a VIF1 interpreter.
- **IOP / sound:** a real R3000A interpreter runs the game's IRX modules (`ps2xIOP`), with HLE fallbacks for MCSERV,
  LIBSD, DBCMAN. But there is **no SPU2 emulation**: audio is `ps2_audio.cpp` (328 lines, wraps PCM / VAG as WAV for
  raylib) and a 69-line LIBSD stub. Dirge's sound is its own `iopsound.irx` sequencer keying SPU2 voices, so it would
  run and stay silent.
- **DMA / kernel:** memory model, syscalls, threads (EeScheduler), SIF RPC, CD / memory card / pad stubs, MPEG stub.
  Per-game work is "game overrides" bound by address. Dirge is not in its games database.

Compared with our `port/recomp` + `port/oracle`: the same idea (our recompiled EE plus HLE boots to the game loop and
serves as a callable oracle). PS2Recomp has a much stronger IOP side and a debug panel. Ours is smaller and built
around calling single game functions on injected memory, which is what the oracle needs.

**Could a bring-your-own-disc flow carry untranslated game logic?** (The user's machine recompiles their ELF; nothing
derived is committed.) Not as part of the port, for four reasons:
1. **Different worlds.** Recompiled code runs on a 32 MB guest RAM image with guest pointers and the game's struct
   layouts. Our translated code uses native C structs. To call one untranslated function from translated code,
   the whole state it touches would have to live in guest memory. In effect that is the hybrid build the project
   already built and set aside (`port/recomp`).
2. **Project rules.** CLAUDE.md keeps recompiled code out of the port. A runtime-generated copy is still
   recompiled code running as the game.
3. **GPL-3.** Linking its runtime makes the shipped exe GPL-3. Without a licence decision (D1), it can't be shipped
   with our code.
4. **Not complete for this game.** No SPU2, a software GS, and stubbed MPEG / memory card. Filling the gaps is
   emulator work.

Possible use: **as an extra oracle,** not in the game. Its IOP interpreter could run `iopsound.irx` to check our SE
sequencer tick by tick without PCSX2. Low priority, since the PCSX2 traces already cover it. Don't vendor it; if
tried, build it in a scratch folder.

### 5b. OpenGOAL (open-goal/jak-project, ISC licence)

A model for structure, not for code. Layout: `decompiler/` (reads the user's ISO, extracts assets; BYO like
ours), `goal_src/` (the game logic, decompiled and hand-cleaned, then compiled with their own GOAL compiler),
`game/kernel` + `game/overlord` (the EE kernel and IOP side redone in C++), `game/sound/989snd` (the sound library
rewritten), `game/graphics/opengl_renderer/` (the PC renderer).

What to copy:
- **The renderer seam.** Game code still builds its per-frame DMA chains into **buckets**. The PC renderer
  has one `BucketRenderer` per bucket (`tfrag`, `tie`, `merc`, `sprite`, `sky`, `DirectRenderer` for raw GS packets)
  that does what the VU1 microprogram did, as C++ + GLSL. Our frame_loop.h seam and the draw list in step 3 are the
  same idea. Our draw records are the game's render queues, not raw DMA: the JS already decoded what each VU path
  computes, so we skip the DMA format.
- **Sound as its own rewritten library**, fed by the game's own calls: matches step 7.
- **Kept game logic, rewritten platform.** Same split as ours: everything above the seam is translated game code,
  everything below is new PC code.

What not to copy: OpenGOAL commits machine-assisted translations (`goal_src`, `game/mips2c` C++ made from MIPS asm).
Our rules allow hand translation only.

### 5c. The matching-decomp tools (splat, m2c, decomp.me, ee-gcc)

Used by sly1 (CC0), Himuro and the Ratchet & Clank decomps to rebuild byte-matching executables.

- **splat** (MIT): splits an ELF into asm / data files by a YAML map, for a matching build. We don't build a matching
  ELF, and Ghidra (`ghidra-proj/`, `analysis/decomp/`) already gives us functions and xrefs. **No gain.**
- **m2c** (GPL-3, tool only, so its licence doesn't reach our code): MIPS asm -> C. Its output is often closer to the
  source than Ghidra's for gcc code, but our bottleneck isn't reading functions any more: the 2,935 functions the JS cites are
  already decoded. For new decoding it is at most a second view next to Ghidra. **Optional; try it on one hard
  function if a worker gets stuck, no setup job.**
- **decomp.me** (MIT, website): shared matching scratches. Uploading game asm to a public site goes against the
  repo's hygiene rule. **Don't use.**
- **ee-gcc** (the original PS2 compiler): needed only for matching. **No gain.**

Bottom line: no outside tool makes this migration much faster. The fast path is that the hard part (decoding) is
done and tested in JS, and JS -> C translation of decoded code is mechanical work that cheaper models can do under
review.
