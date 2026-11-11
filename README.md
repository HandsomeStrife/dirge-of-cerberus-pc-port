# dirgin

A from-scratch **native PC port** of *Dirge of Cerberus: Final Fantasy VII* (PS2),
in the decompilation/reauthor tradition — **no emulation, no game data included**.

> **Bring your own disc.** This repository contains only original port code,
> reverse-engineering tooling, and research notes. It contains **no** copyrighted
> game assets, no game executable, and no decompiled or machine-recompiled game
> code. To build or run anything here you must supply your own legally-owned copy
> of the game and extract its data yourself.

## Goal and current state

The goal is a **native PC port in C that runs on Windows**, built from the decoded game.

Today the playable version is a **browser build** (`native/web`, JavaScript + three.js). It
is the test bench: every system in it (movement, camera, collision, enemies and their AI,
event scripts and cutscenes, effects, sound) is translated function by function from the
game's code, with the game address cited next to the code, and checked against PCSX2
recordings and GS dumps. The first stage plays from the opening through to its boss.

The native C side (`native/engine`, `native/renderer`, `native/gpu`) has the room loader
and renderer but not yet the gameplay. The next step is moving the browser build's
translated code into C, so one C codebase builds both the Windows program and (through
WebAssembly) the browser test page. The plan is in
[notes/native-migration-plan.md](notes/native-migration-plan.md).

## Try the browser build

Built from your own disc: `tools/byo/build_web.sh /path/to/your.iso`. The supported disc,
prerequisites, controls and limitations are in [docs/BROWSER.md](docs/BROWSER.md). If you'd
rather have a coding agent set it up for you, see [docs/AGENT-SETUP.md](docs/AGENT-SETUP.md).

## What's here

| Path | What it is |
|------|------------|
| `port/` | Low-level reference layer: KEL.DAT archive loader (`src/`), the static-recompilation + hardware-HLE harness kept as a validation *oracle* (`oracle/`, `recomp/`, `hle/`, `gs/`, `vu/`, `cop2/`, `sif/`, `boot/`). |
| `native/web/` | The browser build (the current test bench): gameplay, AI, events, effects, sound, and their tests against PCSX2 traces. |
| `native/` | The native reauthor: `engine/` (math, scene graph, material, camera, actor, …), software + OpenGL renderers (`renderer/`, `gpu/`), `script/` (JVM subset), `text/`, `movie/` pipeline, and asset **loader** code under `assets/*/` (the code, not the data it reads). |
| `tools/` | Reverse-engineering tooling: KEL unpacker, GS-dump toolkit, Ghidra scripts. |
| `notes/` | Research notes, format write-ups (`FORMAT.md`), status, and session logs. |

## Approach

The game ships its own asset parsers; each format was reversed *from the game's
own code*, reauthored as clean native C, and validated by **oracle-parity diff +
mutation testing** against the recompiled original. The static-recomp hybrid boots
to the game loop and is retained only as ground truth. Gameplay has been developed in
the browser build so far; the native C layer is the target it moves to.

See `notes/STATE-OF-THE-PORT.md` for the full status and `notes/PLAN.md` for direction.

## Legal

*Dirge of Cerberus: Final Fantasy VII* and all its assets are © Square Enix. This
project is an unaffiliated, non-commercial reverse-engineering effort for
interoperability and preservation. No copyrighted game data is distributed here.
