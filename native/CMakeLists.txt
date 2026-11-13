# =====================================================================
# native/  --  top-level CMake for the native C port (docs/NATIVE.md).
#
# One tree, three presets (CMakePresets.json): linux (gcc), windows (MinGW-w64, SDL2, OpenGL 3.3 core) and wasm
# (Emscripten, WebGL2). Builds the engine spine (engine/), the platform layer (platform/) and the game shell +
# moved modules (game/). The asset tools (native/assets/), gpu demos and renderer/ keep their own Makefiles
# and stay out of this build.
# =====================================================================
cmake_minimum_required(VERSION 3.16)
project(dirge_native C)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)

# Floats must agree to the bit on every target (the browser is the test bench for the Windows exe; plan 2.3):
# no fused multiply-add, no fast-math. x86-64 does f32 in SSE2, wasm natively.
add_compile_options(-ffp-contract=off -fno-fast-math)

option(DIRGE_GAME "Build the dirge shell (needs native/scripts/fetch_deps.sh)" ON)
if(CMAKE_CROSSCOMPILING OR EMSCRIPTEN)
    set(DOC_ENGINE_TESTS OFF CACHE BOOL "" FORCE)
endif()

enable_testing()
add_subdirectory(engine)
if(DIRGE_GAME)
    add_subdirectory(game)
endif()
