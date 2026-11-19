# Contributing to dirgin

This guide is for a person or a coding agent who wants to do faithful-port work: decode a game
function, translate it, and prove the translation against the real game. If you only want to build
and play, read [BROWSER.md](BROWSER.md) or [AGENT-SETUP.md](AGENT-SETUP.md) instead.

Read [CLAUDE.md](../CLAUDE.md) (the project rules) and [notes/START-HERE.md](../notes/START-HERE.md)
(the map) first.

You need your own legally-owned copy of the PAL disc, *Dirge of Cerberus: Final Fantasy VII*,
SLES-54185, as a plain `.iso`. No other disc or revision is supported. Nothing from the game is in
this repository, and nothing from the game may ever go into it (see "Repo hygiene" below).

Paths below are relative to the repository root. `/path/to/your.iso` is your image. Keep the quotes
around it: image names often contain spaces.

Commands marked **(not verified)** were not run when this guide was written. Everything else was run
on a Linux box (Ubuntu 22.04) on 2026-11-19.

---

## 1. Setup

What the work depends on, and how to make each piece from your own disc. All of it is gitignored.

| Piece | Where | Needed for | Section |
|---|---|---|---|
| Unpacked game files | `extract/_KEL/` | the exporters, research | 1.2 |
| The browser build's data | `native/web/data/` | the page, most tests | 1.2 |
| The ELF | `elf/SLES_541.85` | Ghidra, the exporters | 1.3 |
| Ghidra project | `ghidra-proj/DOC` | decoding | 1.4 |
| Decompiled C, one file per function | `analysis/decomp/` | decoding, grep | 1.4 |
| Function list | `analysis/funcs.csv` | finding hubs and callers | 1.4 |
| PCSX2 traces and GS dumps | `tools/trace/out/` | checking against the game | 1.5 |
| Node + Playwright | system | node tests, page tests | 1.6 |
| C toolchain | system, `native/third_party/` | the native build | 1.7 |

### 1.1 Check the disc

```
python3 -I tools/byo/disc.py check "/path/to/your.iso"
```

It prints `disc: SLES_541.85` and one line per file (SYSTEM.CNF, the ELF, FILELIST.BIN), each ending
in `ok`. It compares SHA-256 hashes of the files inside the image, so a rip that differs only in
padding still passes. Exit status 1 means a wrong or damaged disc. Run it with no arguments for the
full usage.

### 1.2 The extract and the browser build's data

```
tools/byo/build_web.sh "/path/to/your.iso"
```

This unpacks the game archive into `extract/_KEL/` and writes `native/web/data/`. It takes 5 to 10
minutes and needs about 4.5 GB free. Prerequisites, errors and options (`--help`) are in
[BROWSER.md](BROWSER.md) and at the top of the script. A second run reuses a verified extract.

`tools/byo/build_web.sh --help` was verified. A full build was not run for this guide (the last full
run from a fresh clone is recorded in `notes/byo-build.md`).

Some files in our own `native/web/data/` are **not** made by the disc build. They were made by hand
from PCSX2 captures: `room_sky.bin`, `pause_ref.json`, `pause_box_ref.json`, `pause_box_ok_ref.json`,
`hud/dump_*.json`, `hud/ring_*.json` (listed in `notes/byo-build.md`). Tests that read them will fail
for you until you make your own captures. See "Gaps" at the end.

### 1.3 The ELF

The build copies the ELF to a temporary folder and deletes it again. For Ghidra you want a kept copy:

```
python3 -I tools/byo/disc.py elf "/path/to/your.iso" elf/SLES_541.85
sha256sum elf/SLES_541.85
```

`disc.py elf` checks the hash itself and stops on a mismatch. The SHA-256 must be
`d51e59218891b61db4438824e04dcb8e19fe8468c7e034b2375856f771c21012` (the same value is in
`tools/byo/disc.py`, `KNOWN`). `elf/` is gitignored.

### 1.4 Ghidra and `analysis/decomp/`

Our project was made with:

- **Ghidra 12.1.4** (`ghidra_12.1.4_PUBLIC`) and **JDK 21** (Temurin 21.0.12).
- The processor extension **ghidra-emotionengine-reloaded** (github.com/chaoticgd/ghidra-emotionengine-reloaded),
  the release built for Ghidra 12.1.4 (v2.1.38 in `notes/STATUS.md`). Install it in Ghidra
  (File > Install Extensions) or unzip it into `<ghidra>/Ghidra/Extensions/`. With it, Ghidra picks
  the language `r5900:LE:32:default` for the real ELF by itself. Without it you get plain MIPS, which
  does not decode the EE's 128-bit and VU0 instructions.

Put the JDK and Ghidra's `support/` folder on your PATH, so `analyzeHeadless` runs:

```
export JAVA_HOME=/path/to/jdk-21
export GHIDRA_INSTALL_DIR=/path/to/ghidra_12.1.4_PUBLIC
export PATH="$JAVA_HOME/bin:$GHIDRA_INSTALL_DIR/support:$PATH"
```

`notes/STATUS.md` (where our Ghidra setup is recorded) uses our server's paths. Substitute your own.

Ghidra 12 has no Jython, so our scripts are Java, in `tools/`:

| Script | What it does |
|---|---|
| `DisableEEAddr.java` | pre-script: lists the EE analysis options and turns off the `MIPS-R5900` analyzer |
| `DumpFuncs.java <csv>` | writes `addr,name,size,callers` for every function |
| `DumpAllDecomp.java <dir>` | decompiles every function to `<dir>/<addr>_<name>.c` |
| `DecompAt.java <addr> ...` | prints the decompiled C of the function(s) containing each address |

**Make the project.** Import and analyse once (about 2 minutes on our machine):

```
mkdir -p ghidra-proj analysis
analyzeHeadless ghidra-proj DOC -import elf/SLES_541.85 -scriptPath tools \
    -preScript DisableEEAddr.java -postScript DumpFuncs.java analysis/funcs.csv
```

`notes/STATUS.md` reports that the `MIPS-R5900` analyzer can still throw two
`AddressOutOfBoundsException`s during analysis. They are not fatal: analysis finishes and saves.
Our project has 13,089 functions. Apart from Ghidra's own names for a few library and syscall
functions, every function has its default `FUN_<address>` name, so a fresh import gives the same
names as ours.

**Dump the decompiled C** (all 13,089 functions; this is what `analysis/decomp/` is):

```
analyzeHeadless ghidra-proj DOC -process SLES_541.85 -noanalysis -scriptPath tools \
    -postScript DumpAllDecomp.java analysis/decomp
```

**One function at a time** (verified; about 10 seconds):

```
analyzeHeadless ghidra-proj DOC -process SLES_541.85 -noanalysis -readOnly -scriptPath tools \
    -postScript DecompAt.java 0x5ae1f0
```

`-readOnly` leaves the project unchanged, so it is safe while another process has it open in
read-only mode too. Search the dump with grep, for example `grep -l "FUN_005ae1f0" analysis/decomp/*.c`
for its callers.

All three commands were verified for this guide. The import and the dump were run into a new,
empty project from the hash-checked ELF. The result matched ours: the same 13,089 functions with the
same addresses, names and sizes in `funcs.csv`, and all 13,089 decompiles succeeded. Compared with
our `analysis/decomp/`, one file differed by a single type name (`undefined1 *` vs `undefined *`).
Our folder also has three functions that the import does not find (FUN_00330240, FUN_003614b0,
FUN_0056bdb8): they were added to our project by hand later. If you need one of them, create the
function at that address in Ghidra (Disassemble, then Create Function) and decompile it with
`DecompAt.java`.

Some functions have no decompile (Ghidra fails on them, or they are in code loaded at run time, not
in the ELF). Workers then disassemble them from RAM in a save state. `notes/HANDOFF.md` has examples:
search it for `capstone`.

**The recompiler** (`port/recomp/`) is a second source of truth: it turns the ELF into C that runs. Its
`Makefile` and `port/recomp/tools/recompile.py` (its `csvpath` default) have our absolute paths for
the ELF and for `analysis/ee_boundaries.csv` written in. Pass your own (`make ELF=... CSV=...`) **(not verified)**. The
script that made `ee_boundaries.csv` (`name,start,end,size` for each function) is not in the
repository; see "Gaps".

### 1.5 PCSX2, traces and GS dumps

These are how we check the port against the real game. Read `tools/trace/README.md` (how the tracer
works, the script format, the systemd unit file) and `notes/pcsx2-headless-setup.md` (the headless
setup) before you start. Both use our server's paths (install folders, save-state and dump
locations). Substitute your own.

What you need:

- **PCSX2 2.9.127** (the AppImage, extracted). Ours runs headless under Xvfb with the OpenGL renderer
  on Mesa llvmpipe.
- **A PS2 BIOS dumped from your own console.** We don't supply one.
- **A systemd user unit** `pcsx2trace`, which starts PCSX2. The Claude Code Bash tool kills a PCSX2
  that a command starts directly, so PCSX2 runs as a user unit. The unit file text is at the end of
  `tools/trace/README.md`. It has our absolute paths in it: change them to your clone.
- Its environment in `tools/trace/out/env/` (gitignored): `cfg/` (PCSX2.ini with
  `EnablePINE = true`, your BIOS folder, memory cards), `pcsx2/squashfs-root/` (the extracted
  AppImage) and `trace.env` (`PCSX2_DIR`, `ISO`, `STATEFILE`, `LOG`).
- **Save states.** Every trace starts from a save state, not from boot. Ours is the start of the
  sea-of-flames stage (room z128) plus several mid-level "route states". They are not in the
  repository: you make your own by playing to that point in PCSX2 and saving. `trace.py` has our
  path as its default, so always pass `--state your.p2s`.

Commands (`--help` verified; the runs were not):

```
python3 -I tools/trace/trace.py --help
flock tools/trace/out/.pcsx2.lock python3 -I tools/trace/trace.py tools/trace/scripts/b_walk.json --state your.p2s   (not verified)
python3 -I tools/trace/summarize.py tools/trace/out/b_walk.jsonl --from 0 --to 60                                   (not verified)
```

Always run PCSX2 work under `flock tools/trace/out/.pcsx2.lock`: there is one PCSX2.

The trace scripts are in `tools/trace/scripts/*.json` (committed: they are only pad input). `fields.py`
lists what is logged each frame; `calllog.py` logs calls to chosen functions; `grab_gs.py` takes GS
dumps at chosen frames; `route.py` and `ckpt_drive.py` drive longer routes.

GS dumps (the exact primitive stream the game sends to the GS) are read by `tools/gsdump/src/`; see
`tools/gsdump/README.md`. `gsrender2.py ... --native` renders the frame we grade the page against.

### 1.6 Node and Playwright

- **Node.js** 18 or newer (we use 22).
- **Playwright** with Chromium, for the page tests. The tests find Playwright in the local
  `node_modules`, or else in the global one (`npm root -g`). For example:
  `npm install -g playwright && npx playwright install chromium` **(not verified here; we already had
  Playwright 1.58)**. The page tests run Chromium headless with SwiftShader WebGL, so no GPU is needed.
- **Python 3.8+** with numpy and Pillow (also needed by the build).

### 1.7 The C toolchain

See [NATIVE.md](NATIVE.md): gcc, cmake 3.21+, ninja, `native/scripts/fetch_deps.sh`, and for the other
targets MinGW-w64 + wine64 + xvfb-run, and emsdk 3.1.74.

---

## 2. How to work

The rules are in [CLAUDE.md](../CLAUDE.md). In practice:

1. **Find the function.** Start from the area's research note (`notes/START-HERE.md` lists them) and
   `notes/fidelity-audit.md`. Read the decompiled C in `analysis/decomp/`, or run `DecompAt.java`.
2. **Translate it, keeping its structure.** Same branches, same constants, same order of operations,
   same float precision. Put the address next to the code: `// FUN_005ae1f0`. Name the game's
   fields by their offsets (`MP+0x450`, `C+0x1d8`) when we don't know more.
3. **Check it against the game.** A unit test that replays a PCSX2 trace and compares every frame,
   or a GS-dump comparison for anything drawn. Report the largest error, not the mean. "Looks
   right" is not a check.
4. **Don't invent.** No tuning, smoothing, blends, timers or camera moves the game doesn't have.
5. **Undecoded parts.** If you need a stand-in, keep it small, mark it in the code as
   `// GUESS: <what> (not decoded; see <notes>)`, and add a row to `notes/fidelity-audit.md` with
   source `GUESS`. Nothing should depend on it. Leaving a feature out (with a console warning) is
   often better.
6. **Two attempts, then stop.** If a decode fails twice, write down what you found (addresses, what
   you ruled out) in the area's note and stop. Don't ship a made-up fix.
7. **Mutation-test it.** Break the translation on purpose (flip a comparison, change a constant,
   drop a branch), run the test, and see it fail. Restore it. Do this on a copy or with `git stash`,
   and not while anything else is editing the tree. Report the score ("12 / 13 mutants killed, 1
   equivalent").
8. **Write it down.** Add a dated entry to `notes/HANDOFF.md`: what was decoded (addresses), what the
   page now does, the trace and its largest error, the tests and the mutation score, and what is
   still open. Update the area's research note and the audit row.

Improvements that the game doesn't have (widescreen, better filtering) go behind an option that is
off by default, and only after the faithful version exists.

### Worked example: floor shading (FUN_005ae1f0)

The game scales a character's lighting by the shade of the floor polygon under its feet. This is in
`native/web/floor_shade.js`, and it was the first module moved to C (`native/game/floor_shade.c`).

The header says where it comes from and what it writes:

```js
// floor_shade.js -- an actor's MP+0x450 from the walk polygon it stands on (worker 0260). FUN_005ae1f0, from FUN_00340e08 (Vincent), FUN_0055cac8 (others).
```

The game does this in single-precision floats with the EE's round-toward-zero. Rounding to nearest
gives 124 where the game has 122 for one real polygon, so the translation rounds every operation
the way the EE does:

```js
function rz(x) {                     // x (a double, exact for a product or sum of two singles) to a single, toward zero
  buf[0] = x;
  if (Math.abs(buf[0]) > Math.abs(x)) bits[0] -= 1;
  return buf[0];
}
```

The body follows the decompile line by line, including a cap that looks unreachable (it is kept,
with a comment, because the game has it):

```js
  f = T === 0 ? c(0) : mul(div(f, T), div(1, n - 1));
  return (f >= 63 ? 63 : Math.trunc(f)) * 2;      // the game's cap; a mean of 6-bit shades can't pass 63, so it looks unreachable
```

How it was checked: `test_light_states.mjs` compares `MP+0x450` with the game's RAM at the route
save states, and `test_c_parity.mjs` runs the JS and the C on every z128 walk polygon (38,671 points,
all equal). A mutant that rounds to nearest changes the result, and the C smoke hash includes a
probe for it (see [NATIVE.md](NATIVE.md), "Floats").

---

## 3. How to test

All commands run from the repository root.

### Node tests (`native/web/test_*.mjs` without `_page`)

```
node --import ./native/web/test_hooks.mjs native/web/test_jump.mjs
```

`test_hooks.mjs` stubs the `three` import so modules like `player.js` load in node. It is harmless for
tests that don't need it, so always pass it. Most tests print `ok` / `FAIL` lines; check for `FAIL`,
`FAILED` or `Error:` in the output.

Run them all (the single test above was verified; the full loop takes over ten minutes and was
not run for this guide):

```
for t in native/web/test_*.mjs; do case $t in *_page.mjs) continue;; esac
  r=$(timeout 600 node --import ./native/web/test_hooks.mjs $t 2>&1)
  n=$(echo "$r" | grep -cE '^FAIL|^ *[1-9][0-9]* FAILED|Error:'); [ "$n" != 0 ] && echo "$(basename $t): $n"; done
node --import ./native/web/test_hooks.mjs native/web/test_jump_page.mjs   # a node test despite its name
```

### Page tests (`native/web/test_*_page.mjs`)

Each one starts its own `python3 -m http.server` on a free port, opens `play.html` in headless
Chromium, drives it through `window.__play`, and prints `ok` lines and `all ok` at the end. A blank
result usually means it crashed. They take one to fifteen minutes each and are heavy, so run one
browser at a time, under a lock:

```
mkdir -p tools/trace/out
flock tools/trace/out/.browser.lock timeout 900 node native/web/test_barrier_page.mjs
```

(Not run for this guide; the form is the one in each page test's header comment.)

The whole set takes well over an hour. Some are flaky under load (wall-clock checks); rerun a
failure once on a quiet machine before you believe it. The current list of known flaky tests and
known gaps is in the newest suite entry of `notes/HANDOFF.md` (search for "suite").

### Python tests

```
python3 -I native/assets/models/test_cull_tag.py
python3 -I native/assets/textures/test_raw_alpha.py
```

`test_raw_alpha.py` needs the disc build: it runs the `dtex` texture tool that `build_web.sh`
compiles (`native/assets/textures/dtex`; without it the test crashes). `test_cull_tag.py` prints
`all ok` either way, but without `extract/` it skips its z128 part (`SKIP z128 packets`), and it
prints `SKIP GS dumps` when `tools/trace/out/room_grade/src` has no dumps (yours won't, at first).

### C tests

From `native/` (see [NATIVE.md](NATIVE.md)). Fetch the pinned third-party code first (needs the
network once):

```
scripts/fetch_deps.sh
cmake --preset linux && cmake --build --preset linux
ctest --preset linux
```

Verified: 13 / 13 pass. Then the JS-vs-C checks, from the root:

```
node native/web/test_c_parity.mjs
```

Verified: `floor_shade: 38671 / 38671 equal`. It needs the wasm build: `native/web/wasm/dirge.mjs`,
which the `wasm` preset writes (emsdk; see [NATIVE.md](NATIVE.md), "WebAssembly"). Without that
file, or without the disc build's data, it prints `SKIP` and exits 0, so a pass that says `SKIP`
checked nothing. `DIRGE_WASM=<path to dirge.mjs>` points it (and the `native/web/c/*.mjs` adapters) at
another wasm build, which is how C mutants are tested.

### Which tests need what

| Needs | Tests |
|---|---|
| nothing but the repo | the C unit tests (`ctest`) |
| `native/web/data/` from your disc | almost all node and page tests (about 146 of 157 read it) |
| PCSX2 traces in `tools/trace/out/` | about 87 tests. Some skip a missing trace, some count it as a failure. Ours are not shared: you have to record them. |
| a save state | `test_hud_setup`, `test_enemy_ai`, `test_enemies_page` (set `HUD_STATE` / `SAVE_STATE`; the default path is ours) |
| hand-made reference files in `data/` (1.2) | the HUD, pause and sky tests that read them |
| the wasm build | `test_c_parity`, `test_play_c_page` (skip or fail without it) |

So on a fresh clone with only the disc build, expect many trace-based tests to skip or fail. That
is a missing input, not a broken port. Before you change a module, run its tests on the unchanged
tree and keep that output: compare against it, not against "all green".

---

## 4. Review routine

Every piece of work gets a review before it is committed:

1. **Read-only review.** A second person or agent reads the change and its claims without editing
   anything. They check the decode against `analysis/decomp/` (does the code match the function it
   cites?), run the tests, mutate a scratch copy to see whether the tests catch it, and rank what
   they find.
2. **Fix** what the review found.
3. **Review again.** A fix is a new change, and it is often where the next bug is. Repeat until a
   round finds nothing serious.
4. **Run the full suite** (node, page, Python, C) before you commit. Compare it with the suite on
   the tree before your change. Don't commit with a red test unless the commit message says which
   one and why.

Don't edit the tree while a reviewer or another agent is changing files in it: `git stash` and
`git checkout --` (used to restore mutants) will eat edits made at the same time.

---

## 5. Repo hygiene

The repository is public. `.gitignore` is **default-deny**: it ignores everything, then lets back in
only our own source and doc file types (`.c`, `.h`, `.py`, `.md`, `.java`, `.sh`, the web client's
`.js` / `.mjs` / `.html`, CMake files and a few named files), then excludes the folders that hold
game data or anything made from it again.

Never commit:

- the disc image, the ELF, or anything from `extract/`, `elf/`, `analysis/`, `ghidra-proj/`,
  `native/web/data/`, `native/assets/models/out/`, `native/movie/out/`, `downloads-ref/`;
- the decompiled or recompiled game code (`analysis/decomp/`, `**/generated/**`,
  `**/generated_all/**`, `eetu_*.c`, `ee_funcs.c`, `function_table.c`);
- PCSX2 traces, GS dumps, save states, screenshots of the game (`tools/trace/out/` and any `out/`);
- tables or bulk data copied from game files, and keys or cipher constants: the code reads those
  from your ELF at run time.

Allowed: small hand-written constants and addresses in code and notes, and quoting the game's
text (names, messages, menu lines).

Rules that keep this working:

- Don't edit `.gitignore` to let something in, and never `git add -f`.
- Before a commit, read `git status --short` and the staged file list. Anything under the folders
  above is a mistake.
- Check that a new file is ignored when it should be: `git check-ignore -v <path>`.
- A new tracked file type (say, a `.json` test script) needs its own narrow line in `.gitignore`
  section 3. Look at how `tools/trace/scripts/*.json` is let in.
- `python3 -I tools/hygiene_text.py` looks for exported game messages in tracked files. It is
  optional: quoting game text is allowed. It needs `native/web/data/` (exit status 2 without it).

---

## Gaps: what we have that you can't reproduce from this repository

- **Our PCSX2 traces, GS dumps and save states are not shared.** They are game-derived. You have to
  record your own: play to the point, save a state, then run the trace scripts on it. The scripts
  in `tools/trace/scripts/` assume the save state each one was written for; which one is not always
  written down (search `notes/HANDOFF.md` for the script's name). Tests that compare against
  exact frames of our traces may not match traces you record from a slightly different state.
- **Several tests and tools have our absolute paths written in** as defaults: `trace.py`'s save
  state, three tests' save state, the `pcsx2trace` unit file, `port/recomp/Makefile`, and the
  `csvpath` default in `port/recomp/tools/recompile.py` (also in
  `port/oracle/tools/recompile_keldraw.py`). The notes (`notes/STATUS.md`,
  `notes/pcsx2-headless-setup.md`, HANDOFF entries) use our server's paths too. Pass your
  own paths with the documented options or environment variables.
- **Hand-made reference files in `native/web/data/`** (1.2) come from our captures, not from the disc
  build. The tests that read them fail without them.
- **`analysis/ee_boundaries.csv`** (for the recompiler) was made by a script that is not in the
  repository. It has one row per function, `name,start,end,size`; you can probably derive it from a
  `DumpFuncs.java` export, but that has not been tried.
- **The Ghidra project** has three hand-made functions that a fresh import lacks (see 1.4). Any
  other hand edits in our project (comments, types) are not exported anywhere.
- **No CI.** The suite runs only on a contributor's machine.
