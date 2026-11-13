/* =====================================================================
 * platform.h  --  the SDL platform layer (native migration plan, step 0).
 *
 * Everything below the game that differs per target lives behind this
 * header: window + GL context, keyboard / mouse / pad, the audio device,
 * file loading and the clock. Three targets build it from one source
 * (platform_sdl.c): Linux (gcc, SDL2 from source), Windows (MinGW,
 * SDL2.dll, OpenGL 3.3 core) and wasm (Emscripten, -sUSE_SDL=2, WebGL2).
 *
 * The game code above it never includes SDL. It sees:
 *   - a GL context in the shared GLSL subset (plat_gl.h);
 *   - the 32-byte libpad buffer per port (plat_read_pad), which is what
 *     engine/core/input.c's DocInputBackend already consumes;
 *   - an audio callback that fills interleaved s16 stereo at 48 kHz;
 *   - fs_load(path, cb): sync on native (read under --data), async in the
 *     browser (fetch); the callback form is the same on both.
 * ===================================================================== */
#ifndef DIRGE_PLATFORM_H
#define DIRGE_PLATFORM_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct PlatConfig {
    const char *title;
    int width, height;      /* window size (the browser: canvas size) */
    int vsync;              /* 1 = swap on vblank */
    int hidden;             /* 1 = no visible window (smoke runs) */
    int audio;              /* 1 = open the audio device */
} PlatConfig;

typedef struct PlatInfo {
    char gl_version[128];   /* GL_VERSION of the context we got */
    char gl_renderer[128];
    int  audio_rate;        /* 0 if no audio device */
    int  audio_channels;
    int  audio_samples;     /* device buffer, frames */
    char audio_driver[32];
    char video_driver[32];
} PlatInfo;

/* 0 on success. Fills *info (may be NULL). */
int  plat_init(const PlatConfig *cfg, PlatInfo *info);
void plat_shutdown(void);

/* Drain the OS event queue (keyboard, mouse, pads, window). Returns 0 once
 * the user closed the window / asked to quit, else 1. */
int  plat_poll_events(void);
void plat_swap(void);
void plat_drawable_size(int *w, int *h);

/* Seconds since plat_init, from the high-resolution counter. */
double plat_time(void);

/* ---- input ---------------------------------------------------------- */
/* Fills the 32-byte libpad buffer (port/input/pad.h layout, active-low
 * buttons, 0x80-centred sticks) for `port` from the keyboard (port 0) and
 * the first SDL game controllers. Returns 1 if the port is connected.
 * Shape matches DocInputBackend.read_pad (engine/core/input.h). */
int  plat_read_pad(void *ctx, int port, uint8_t out[32]);
/* The two halves of plat_read_pad, exposed for tests: the keyboard binding (ks = SDL_GetKeyboardState,
 * indexed by SDL scancode) to active-high pad bits, and the 32-byte buffer from bits + sticks. */
uint16_t plat_keys_to_pad(const uint8_t *ks);
void plat_pad_pack(uint16_t held, uint8_t rx, uint8_t ry, uint8_t lx, uint8_t ly, uint8_t out[32]);
/* Mouse motion since the last call (window pixels). */
void plat_mouse_delta(int *dx, int *dy);

/* ---- audio ---------------------------------------------------------- */
/* Called on the audio thread (native) / the audio worklet's pull (web)
 * to fill `frames` interleaved stereo s16 frames. */
typedef void (*PlatAudioFn)(void *user, int16_t *out, int frames);
void plat_audio_set_callback(PlatAudioFn fn, void *user);

/* ---- files ---------------------------------------------------------- */
/* Data root: the BYO export tree tools/byo/build_web.sh writes
 * (native/web/data). Native: a directory (--data, default ./data next to
 * the exe). Browser: a URL prefix (default "data/"). */
void        fs_set_root(const char *root);
const char *fs_root(void);

/* data == NULL on failure (len 0). The buffer is only valid during the
 * callback. Native calls back before fs_load returns; the browser calls
 * back later from the event loop. */
typedef void (*FsLoadFn)(void *user, const char *path, const uint8_t *data, size_t len);
void fs_load(const char *path, FsLoadFn cb, void *user);

/* Loads still in flight (always 0 on native). */
int  fs_pending(void);

#ifdef __cplusplus
}
#endif
#endif /* DIRGE_PLATFORM_H */
