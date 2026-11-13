# =====================================================================
# native/game  --  the dirge shell + game modules moved from native/web (migration plan step 0).
#
#   dirge_platform  platform/ (SDL2: window, GL, input, audio, files)
#   dirge_vendor    cJSON, cgltf, dr_flac, stb_image_write (native/third_party/vendor, fetched)
#   dirge_game      game modules ported from native/web (floor_shade, frame_clock)
#   dirge           the executable: dirge / dirge.exe / dirge.mjs + dirge.wasm
#
# SDL2 per target:
#   Linux    native/third_party/SDL2-src built static (no libsdl2-dev, no sudo)
#   Windows  native/third_party/SDL2-mingw (official MinGW devel tarball); SDL2.dll copied next to dirge.exe
#   wasm     Emscripten's port (-sUSE_SDL=2)
# Run native/scripts/fetch_deps.sh first (docs/NATIVE.md).
# =====================================================================
set(DIRGE_TP ${CMAKE_CURRENT_SOURCE_DIR}/../third_party)
set(DIRGE_PLATFORM_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../platform)
set(DIRGE_WEB_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../web)

if(NOT EXISTS ${DIRGE_TP}/vendor/cJSON.c)
    message(FATAL_ERROR "native/third_party is missing: run native/scripts/fetch_deps.sh")
endif()

# ---- SDL2 ------------------------------------------------------------
add_library(dirge_sdl2 INTERFACE)
if(EMSCRIPTEN)
    target_compile_options(dirge_sdl2 INTERFACE -sUSE_SDL=2)
    target_link_options(dirge_sdl2 INTERFACE -sUSE_SDL=2)
elseif(WIN32)
    set(_sdl ${DIRGE_TP}/SDL2-mingw)
    target_include_directories(dirge_sdl2 INTERFACE ${_sdl}/include/SDL2)
    target_link_libraries(dirge_sdl2 INTERFACE ${_sdl}/lib/libSDL2.dll.a)
else()
  find_package(SDL2 CONFIG QUIET)          # a system libsdl2-dev, when installed, gives X11 / Wayland windows
  if(TARGET SDL2::SDL2)
    target_link_libraries(dirge_sdl2 INTERFACE SDL2::SDL2)
  else()
    # From source. This box has no libxext-dev / wayland headers, so that build has no X11 / Wayland window:
    # the offscreen driver (EGL) runs the smoke test and the C tests; a desktop window needs libsdl2-dev.
    find_path(DIRGE_XEXT_H X11/extensions/Xext.h)
    if(NOT DIRGE_XEXT_H)
      set(SDL_X11 OFF CACHE BOOL "" FORCE)
    endif()
    set(SDL_SHARED OFF CACHE BOOL "" FORCE)
    set(SDL_STATIC ON CACHE BOOL "" FORCE)
    set(SDL_TEST OFF CACHE BOOL "" FORCE)
    set(SDL2_DISABLE_INSTALL ON CACHE BOOL "" FORCE)
    set(SDL2_DISABLE_UNINSTALL ON CACHE BOOL "" FORCE)
    add_subdirectory(${DIRGE_TP}/SDL2-src ${CMAKE_BINARY_DIR}/SDL2 EXCLUDE_FROM_ALL)
    target_link_libraries(dirge_sdl2 INTERFACE SDL2::SDL2-static)
  endif()
endif()

# ---- vendored single-file libraries -----------------------------------
add_library(dirge_vendor STATIC ${DIRGE_TP}/vendor/cJSON.c vendor_impl.c)
target_include_directories(dirge_vendor PUBLIC ${DIRGE_TP}/vendor)
target_compile_options(dirge_vendor PRIVATE -w)
find_library(DIRGE_LIBM m)
if(DIRGE_LIBM)
    target_link_libraries(dirge_vendor PUBLIC ${DIRGE_LIBM})
endif()

# ---- platform ----------------------------------------------------------
set(_plat_src ${DIRGE_PLATFORM_DIR}/platform_sdl.c)
if(NOT EMSCRIPTEN)
    list(APPEND _plat_src ${CMAKE_CURRENT_SOURCE_DIR}/../gpu/gl_api.c)   # GL 3.3 core loader (gpu/)
endif()
add_library(dirge_platform STATIC ${_plat_src})
target_include_directories(dirge_platform PUBLIC ${DIRGE_PLATFORM_DIR} ${CMAKE_CURRENT_SOURCE_DIR}/../gpu)
target_link_libraries(dirge_platform PUBLIC dirge_sdl2)
target_compile_options(dirge_platform PRIVATE -Wall -Wextra)

# ---- game modules (no SDL, no GL: the node adapters and C tests use them directly) ----
add_library(dirge_game STATIC floor_shade.c frame_clock.c)
target_include_directories(dirge_game PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_options(dirge_game PRIVATE -Wall -Wextra)
if(DIRGE_LIBM)
    target_link_libraries(dirge_game PUBLIC ${DIRGE_LIBM})
endif()

# ---- the executable ------------------------------------------------------
add_executable(dirge main.c)
target_link_libraries(dirge PRIVATE dirge_game dirge_platform dirge_vendor doc_engine)
target_compile_options(dirge PRIVATE -Wall -Wextra)

if(EMSCRIPTEN)
    # ES module factory (createDirge) that runs in the page and in node: play_c.html calls callMain, the node
    # adapters (native/web/c/*.mjs) call the exports without running main.
    set_target_properties(dirge PROPERTIES SUFFIX ".mjs")
    target_link_options(dirge PRIVATE
        -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2
        -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createDirge
        -sENVIRONMENT=web,node -sINVOKE_RUN=0 -sALLOW_MEMORY_GROWTH=1
        -sEXPORTED_FUNCTIONS=_main,_malloc,_free
        -sEXPORTED_RUNTIME_METHODS=callMain,HEAPF32,HEAPU8)
    # the pages are served from native/web: copy the module next to them (native/web/wasm, gitignored)
    add_custom_command(TARGET dirge POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E make_directory ${DIRGE_WEB_DIR}/wasm
        COMMAND ${CMAKE_COMMAND} -E copy $<TARGET_FILE_DIR:dirge>/dirge.mjs $<TARGET_FILE_DIR:dirge>/dirge.wasm
                ${DIRGE_WEB_DIR}/wasm/)
elseif(WIN32)
    target_link_options(dirge PRIVATE -static-libgcc)
    add_custom_command(TARGET dirge POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy ${DIRGE_TP}/SDL2-mingw/bin/SDL2.dll $<TARGET_FILE_DIR:dirge>/)
endif()

# ---- C tests (host build only) ---------------------------------------------
if(NOT CMAKE_CROSSCOMPILING AND NOT EMSCRIPTEN)
    add_executable(test_frame_clock tests/test_frame_clock.c)
    target_link_libraries(test_frame_clock PRIVATE dirge_game)
    add_test(NAME test_frame_clock COMMAND test_frame_clock)

    add_executable(test_platform_pad tests/test_platform_pad.c)
    target_link_libraries(test_platform_pad PRIVATE dirge_platform doc_engine)
    add_test(NAME test_platform_pad COMMAND test_platform_pad)
    set_tests_properties(test_platform_pad PROPERTIES ENVIRONMENT "SDL_VIDEODRIVER=dummy")
endif()
