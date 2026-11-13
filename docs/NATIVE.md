# Native C build

The native port is one C codebase built three ways: **Linux** (tests, headless runs), **Windows** (`dirge.exe`,
the target) and **WebAssembly** (`play_c.html`, the browser test bench). The plan it follows is
[notes/native-migration-plan.md](../notes/native-migration-plan.md). It is at **step 0, the build skeleton**:
the window, GL context, input, audio device and file loading work on all three targets, and the game's frame spine
(`engine/core/frame_loop.c`, FUN_00248110) runs at the tick rate. It draws a cleared frame. Gameplay is still in
the browser build (`play.html`). One game module has moved so far: `floor_shade` (FUN_005ae1f0).

## What's where

| Path | What |
|---|---|
| `native/CMakeLists.txt`, `native/CMakePresets.json` | the build: presets `linux`, `windows`, `wasm` |
| `native/engine/` | the spine: frame loop, state dispatch, input decode, math, actor pool (C unit tests) |
| `native/platform/` | the SDL2 platform layer: window + GL context, keyboard / mouse / pad, audio, `fs_load`, clock |
| `native/game/` | `main.c` (the `dirge` shell), the tick clock, and the modules moved from `native/web` |
| `native/web/c/` | node adapters: the moved modules' JS API over the wasm build, so node tests run against the C |
| `native/web/play_c.html` | the wasm build in a page |
| `native/scripts/fetch_deps.sh` | fetches the pinned third-party code into `native/third_party/` (gitignored) |
| `native/scripts/wine_smoke.sh` | runs `dirge.exe` under wine and checks its state hash against the Linux build |

The build outputs (`native/build/<preset>/`, `native/web/wasm/`) and `native/third_party/` are gitignored.

## Prerequisites

All without sudo. Checked on Ubuntu 22.04.

- gcc, cmake 3.21+, ninja.
- **Third-party code:** `native/scripts/fetch_deps.sh` (needs network once). It downloads SDL2 2.30.9 (source and
  the official MinGW devel tarball), cJSON 1.7.18, cgltf 1.14, dr_flac and stb_image_write, all pinned by sha256.
  They are all permissive licences: zlib, MIT, MIT-0 or public domain. The port itself is MIT, and no GPL code
  goes into the build.
- **Windows build:** MinGW-w64 (`x86_64-w64-mingw32-gcc`). To run it on Linux you also need wine64 and xvfb-run.
- **wasm build:** emsdk 3.1.74 in `~/emsdk`:
  `git clone https://github.com/emscripten-core/emsdk ~/emsdk && ~/emsdk/emsdk install 3.1.74 && ~/emsdk/emsdk activate 3.1.74`.
  Before configuring or building the wasm preset, run `source ~/emsdk/emsdk_env.sh`. The first build downloads
  Emscripten's SDL2 port.
- **Data:** the BYO export tree `native/web/data/` that `tools/byo/build_web.sh` builds from your own disc. All
  three builds read the same files.

## Build and run

Run these from `native/`.

### Linux

```
cmake --preset linux && cmake --build --preset linux
ctest --preset linux
SDL_VIDEODRIVER=offscreen build/linux/game/dirge --data web/data --smoke 300 --no-audio
```

`--smoke N` runs N ticks as fast as it can, prints `dirge: SMOKE OK hash <h>` and exits. The hash covers the
spine's state, the pads and a float probe, so the same N gives the same hash on every target. If
`libsdl2-dev` is installed, CMake uses it and `dirge` opens a normal X11 / Wayland window. Without it, SDL is
built from source. On this box that SDL has no X11 support, because the Xext headers are missing: it runs on
the `offscreen` driver (EGL), which covers the tests and smoke runs but can't show a window.

### Windows

```
cmake --preset windows && cmake --build --preset windows
scripts/wine_smoke.sh            # xvfb-run wine64 dirge.exe --smoke 300; compares the hash with the Linux build
```

The build writes `build/windows/game/dirge.exe` and `SDL2.dll`. On Windows, put them in one folder and run
`dirge.exe --data <path to the data folder>`. The default data path is `data\` next to the exe. The wine prefix
lives in `~/.cache/dirge-port/wine`.

### WebAssembly

```
source ~/emsdk/emsdk_env.sh
cmake --preset wasm && cmake --build --preset wasm      # -> build/wasm/game/dirge.{mjs,wasm}, copied to web/wasm/
```

To try it, serve `native/web` (for example `python3 -m http.server -d native/web 8000`) and open
`http://localhost:8000/play_c.html`. URL options: `?smoke=300`, `?tick_hz=60`, `?data=<url prefix>`.

## Command line (all targets)

| Option | Meaning |
|---|---|
| `--data DIR` | the export tree (default: `data` next to the exe; browser: `data/`) |
| `--tick-hz N` | game ticks per second (default 50; see "Tick rate") |
| `--smoke N` | run N ticks, print the state hash, exit (exit code 1 if GL, the shader check or the data probe failed) |
| `--hidden` | no visible window |
| `--no-audio` | don't open the audio device |

Keys so far: Esc / Enter = Start, Space = ✕, Backspace = ○, arrows = d-pad. This is the page's binding minus WASD
(`pause_layer.js`, which got it from FUN_00255220's table). An SDL game controller maps by button position
(south = ✕, east = ○, and so on). The full keyboard and mouse mapping is step 4 of the plan.

## Tick rate

The host clock (`game/frame_clock.c`) counts ticks the same way as `play.js`: it banks real time and runs whole ticks
(at most 8 per drawn frame, then drops the rest). play.js then draws the body and camera lerped between the last
two ticks by `acc / TICK` (`ctrl.lerp`, `follow.update`); the C shell doesn't yet (it draws only a cleared frame),
and the renderer step will add that. The tick rate is a
parameter: 50 Hz (PAL) by default, or `--tick-hz` / `?tick_hz`. Decision D8 (worker 0295, 2026-11-13): the
native build follows the page's video-mode setting (`native/web/video_mode.js`; notes/frame-rate.md): NTSC (60 Hz,
FUN_0040cb78's step scale 1.0) by default, PAL (50 Hz, 1.1999999) for the parity tests. Not wired in C yet: the
shell still takes `--tick-hz`; the step scale arrives with the first moved module that reads the step.

## Tests

| Test | Checks |
|---|---|
| `ctest --preset linux` | engine unit tests, plus `test_frame_clock` (50 Hz on 30 / 60 / 144 Hz displays, 60 Hz as a parameter, stall handling as play.js does it) and `test_platform_pad` (each bound key reaches engine/core/input.c as its pad button) |
| `node native/web/test_light_states.mjs native/web/area_stream.js native/web/c/floor_shade.mjs` | the existing floor-shade test run against the C: MP+0x450 against the game's RAM at the route states |
| `node native/web/test_c_parity.mjs` | floor_shade C vs JS on every z128 walk polygon (38,671 points) |
| `flock tools/trace/out/.browser.lock node native/web/test_play_c_page.mjs` | play_c.html headless: WebGL2, shader subset, `fs_load` via fetch, 300-tick hash equal to the Linux build's, 50 / 60 ticks per second, Space reaches the pad as ✕ (sandbox off) |
| `native/scripts/wine_smoke.sh` | dirge.exe under wine: smoke OK, hash equal to the Linux build's |

**Running a node test on the C.** A node test that takes its module path as an argument runs against the C if
you pass the adapter `native/web/c/<module>.mjs` instead of the JS file. The adapter loads the wasm build (or
the build named by `DIRGE_WASM=<dirge.mjs>`, used for mutation runs) and exports the JS module's API.

**Floats.** Every target is built with `-ffp-contract=off` and without fast-math. The smoke hash includes a
probe of floor_shade's round-toward-zero arithmetic. Linux, Windows and wasm give the same hash. A mutant
that rounds to nearest gives a different one.
