/* platform_sdl.c -- the SDL2 platform layer for all three targets (see platform.h). */
#include "platform.h"
#include "plat_gl.h"

#define SDL_MAIN_HANDLED
#include <SDL.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#endif

static SDL_Window   *g_win;
static SDL_GLContext g_gl;
static SDL_AudioDeviceID g_audio;
static Uint64 g_t0;
static int g_mouse_dx, g_mouse_dy;

static void SDLCALL plat_audio_pump(void *u, Uint8 *s, int n);

/* ---- window + GL ---------------------------------------------------- */

int plat_init(const PlatConfig *cfg, PlatInfo *info)
{
    PlatInfo dummy;
    if (!info) info = &dummy;
    memset(info, 0, sizeof *info);

    Uint32 sub = SDL_INIT_VIDEO | SDL_INIT_GAMECONTROLLER | SDL_INIT_EVENTS;
    if (cfg->audio) sub |= SDL_INIT_AUDIO;
    SDL_SetMainReady();
    if (SDL_Init(sub) != 0) {
        fprintf(stderr, "plat: SDL_Init: %s\n", SDL_GetError());
        return -1;
    }
    g_t0 = SDL_GetPerformanceCounter();

#ifdef __EMSCRIPTEN__
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_ES);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 0);
#else
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 3);
    SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 3);
#endif
    SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
    SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);

    Uint32 wflags = SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE | SDL_WINDOW_ALLOW_HIGHDPI;
    if (cfg->hidden) wflags |= SDL_WINDOW_HIDDEN;
    g_win = SDL_CreateWindow(cfg->title, SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED,
                             cfg->width, cfg->height, wflags);
    if (!g_win) {
        fprintf(stderr, "plat: SDL_CreateWindow: %s\n", SDL_GetError());
        return -1;
    }
    g_gl = SDL_GL_CreateContext(g_win);
    if (!g_gl) {
        fprintf(stderr, "plat: SDL_GL_CreateContext: %s\n", SDL_GetError());
        return -1;
    }
    SDL_GL_SetSwapInterval(cfg->vsync ? 1 : 0);
#ifndef __EMSCRIPTEN__
    if (gl_api_load((gl_getproc_fn)SDL_GL_GetProcAddress) != 0) {
        fprintf(stderr, "plat: GL entry points missing\n");
        return -1;
    }
#endif
    snprintf(info->gl_version, sizeof info->gl_version, "%s", (const char *)glGetString(GL_VERSION));
    snprintf(info->gl_renderer, sizeof info->gl_renderer, "%s", (const char *)glGetString(GL_RENDERER));
    snprintf(info->video_driver, sizeof info->video_driver, "%s", SDL_GetCurrentVideoDriver());

    if (cfg->audio) {
        SDL_AudioSpec want, have;
        SDL_zero(want);
        want.freq = 48000;           /* the mixer rate (plan 3.2 Audio: one 48 kHz stream) */
        want.format = AUDIO_S16SYS;
        want.channels = 2;
        want.samples = 1024;
        want.callback = plat_audio_pump;
        g_audio = SDL_OpenAudioDevice(NULL, 0, &want, &have, 0);
        if (g_audio) {
            info->audio_rate = have.freq;
            info->audio_channels = have.channels;
            info->audio_samples = have.samples;
            snprintf(info->audio_driver, sizeof info->audio_driver, "%s", SDL_GetCurrentAudioDriver());
            SDL_PauseAudioDevice(g_audio, 0);
        } else {
            fprintf(stderr, "plat: no audio device: %s\n", SDL_GetError());
        }
    }
    return 0;
}

void plat_shutdown(void)
{
    if (g_audio) SDL_CloseAudioDevice(g_audio);
    if (g_gl) SDL_GL_DeleteContext(g_gl);
    if (g_win) SDL_DestroyWindow(g_win);
    g_audio = 0; g_gl = NULL; g_win = NULL;
    SDL_Quit();
}

void plat_swap(void) { SDL_GL_SwapWindow(g_win); }

void plat_drawable_size(int *w, int *h) { SDL_GL_GetDrawableSize(g_win, w, h); }

double plat_time(void)
{
    return (double)(SDL_GetPerformanceCounter() - g_t0) / (double)SDL_GetPerformanceFrequency();
}

/* ---- events + input ------------------------------------------------- */

/* the first two game controllers become ports 0 / 1 (opened on SDL_CONTROLLERDEVICEADDED) */
static SDL_GameController *g_pad[2];

static void pad_attach(int device_index)
{
    for (int p = 0; p < 2; p++) {
        if (g_pad[p]) continue;
        g_pad[p] = SDL_GameControllerOpen(device_index);
        return;
    }
}

static void pad_detach(SDL_JoystickID id)
{
    for (int p = 0; p < 2; p++)
        if (g_pad[p] && SDL_JoystickInstanceID(SDL_GameControllerGetJoystick(g_pad[p])) == id) {
            SDL_GameControllerClose(g_pad[p]);
            g_pad[p] = NULL;
        }
}

int plat_poll_events(void)
{
    SDL_Event ev;
    int run = 1;
    while (SDL_PollEvent(&ev)) {
        switch (ev.type) {
        case SDL_QUIT: run = 0; break;
        case SDL_CONTROLLERDEVICEADDED: pad_attach(ev.cdevice.which); break;
        case SDL_CONTROLLERDEVICEREMOVED: pad_detach(ev.cdevice.which); break;
        case SDL_MOUSEMOTION: g_mouse_dx += ev.motion.xrel; g_mouse_dy += ev.motion.yrel; break;
        default: break;
        }
    }
    return run;
}

void plat_mouse_delta(int *dx, int *dy)
{
    *dx = g_mouse_dx; *dy = g_mouse_dy;
    g_mouse_dx = g_mouse_dy = 0;
}

/* Pad bits, active-high, in input.h's DocPadButton numbering (port/input/pad.h). Kept local so the
 * platform doesn't depend on the engine headers; test_platform_pad checks they agree. */
enum {
    B_SELECT = 1 << 0, B_L3 = 1 << 1, B_R3 = 1 << 2, B_START = 1 << 3,
    B_UP = 1 << 4, B_RIGHT = 1 << 5, B_DOWN = 1 << 6, B_LEFT = 1 << 7,
    B_L2 = 1 << 8, B_R2 = 1 << 9, B_L1 = 1 << 10, B_R1 = 1 << 11,
    B_TRIANGLE = 1 << 12, B_CIRCLE = 1 << 13, B_CROSS = 1 << 14, B_SQUARE = 1 << 15
};

/* Keyboard -> pad: the page's binding minus WASD (pause_layer.js PAUSE_KEYS, from FUN_00255220's table read from
 * RAM): Start = Esc / Enter, Cross = Space, Circle = Backspace, d-pad = arrows. The rest of the
 * keyboard (WASD stick, Shift, F, E, Q, mouse) is step 4 of the migration plan. */
static const struct { SDL_Scancode sc; uint16_t bit; } k_keys[] = {
    { SDL_SCANCODE_ESCAPE, B_START }, { SDL_SCANCODE_RETURN, B_START },
    { SDL_SCANCODE_SPACE, B_CROSS }, { SDL_SCANCODE_BACKSPACE, B_CIRCLE },
    { SDL_SCANCODE_UP, B_UP }, { SDL_SCANCODE_DOWN, B_DOWN },
    { SDL_SCANCODE_LEFT, B_LEFT }, { SDL_SCANCODE_RIGHT, B_RIGHT },
};

/* SDL's positional controller layout -> the DualShock 2 buttons in the same place. */
static const struct { SDL_GameControllerButton b; uint16_t bit; } k_btn[] = {
    { SDL_CONTROLLER_BUTTON_A, B_CROSS }, { SDL_CONTROLLER_BUTTON_B, B_CIRCLE },
    { SDL_CONTROLLER_BUTTON_X, B_SQUARE }, { SDL_CONTROLLER_BUTTON_Y, B_TRIANGLE },
    { SDL_CONTROLLER_BUTTON_BACK, B_SELECT }, { SDL_CONTROLLER_BUTTON_START, B_START },
    { SDL_CONTROLLER_BUTTON_LEFTSTICK, B_L3 }, { SDL_CONTROLLER_BUTTON_RIGHTSTICK, B_R3 },
    { SDL_CONTROLLER_BUTTON_LEFTSHOULDER, B_L1 }, { SDL_CONTROLLER_BUTTON_RIGHTSHOULDER, B_R1 },
    { SDL_CONTROLLER_BUTTON_DPAD_UP, B_UP }, { SDL_CONTROLLER_BUTTON_DPAD_DOWN, B_DOWN },
    { SDL_CONTROLLER_BUTTON_DPAD_LEFT, B_LEFT }, { SDL_CONTROLLER_BUTTON_DPAD_RIGHT, B_RIGHT },
};

static uint8_t axis_byte(Sint16 v) { return (uint8_t)((v >> 8) + 0x80); }

/* pressure channel (input.h DocPadPressure order) for each pressure-sensitive button */
static const uint16_t k_pres_bit[12] = {
    B_RIGHT, B_LEFT, B_UP, B_DOWN, B_TRIANGLE, B_CIRCLE, B_CROSS, B_SQUARE, B_L1, B_R1, B_L2, B_R2
};

uint16_t plat_keys_to_pad(const uint8_t *ks)
{
    uint16_t held = 0;
    for (size_t i = 0; i < sizeof k_keys / sizeof k_keys[0]; i++)
        if (ks[k_keys[i].sc]) held |= k_keys[i].bit;
    return held;
}

/* the libpad buffer (port/input/pad.h): +1 mode, +2/+3 active-low buttons, +4..7 sticks, +8.. pressures */
void plat_pad_pack(uint16_t held, uint8_t rx, uint8_t ry, uint8_t lx, uint8_t ly, uint8_t out[32])
{
    uint16_t raw = (uint16_t)~held;
    memset(out, 0, 32);
    out[1] = 0x79;                       /* DualShock 2 analog */
    out[2] = (uint8_t)(raw & 0xff);
    out[3] = (uint8_t)(raw >> 8);
    out[4] = rx; out[5] = ry; out[6] = lx; out[7] = ly;
    for (int i = 0; i < 12; i++) out[8 + i] = (held & k_pres_bit[i]) ? 0xff : 0;
}

int plat_read_pad(void *ctx, int port, uint8_t out[32])
{
    (void)ctx;
    uint16_t held = 0;
    uint8_t rx = 0x80, ry = 0x80, lx = 0x80, ly = 0x80;
    SDL_GameController *gc = (port >= 0 && port < 2) ? g_pad[port] : NULL;
    int connected = (port == 0) || gc != NULL;   /* port 0 is always the keyboard */

    memset(out, 0, 32);
    if (!connected) return 0;
    if (port == 0) held |= plat_keys_to_pad(SDL_GetKeyboardState(NULL));
    if (gc) {
        for (size_t i = 0; i < sizeof k_btn / sizeof k_btn[0]; i++)
            if (SDL_GameControllerGetButton(gc, k_btn[i].b)) held |= k_btn[i].bit;
        /* analog triggers -> the digital L2 / R2 at half travel */
        if (SDL_GameControllerGetAxis(gc, SDL_CONTROLLER_AXIS_TRIGGERLEFT) > 16384) held |= B_L2;
        if (SDL_GameControllerGetAxis(gc, SDL_CONTROLLER_AXIS_TRIGGERRIGHT) > 16384) held |= B_R2;
        rx = axis_byte(SDL_GameControllerGetAxis(gc, SDL_CONTROLLER_AXIS_RIGHTX));
        ry = axis_byte(SDL_GameControllerGetAxis(gc, SDL_CONTROLLER_AXIS_RIGHTY));
        lx = axis_byte(SDL_GameControllerGetAxis(gc, SDL_CONTROLLER_AXIS_LEFTX));
        ly = axis_byte(SDL_GameControllerGetAxis(gc, SDL_CONTROLLER_AXIS_LEFTY));
    }
    plat_pad_pack(held, rx, ry, lx, ly, out);
    return 1;
}

/* ---- audio ---------------------------------------------------------- */

static PlatAudioFn g_audio_fn;
static void *g_audio_user;

void plat_audio_set_callback(PlatAudioFn fn, void *user)
{
    if (g_audio) SDL_LockAudioDevice(g_audio);
    g_audio_fn = fn; g_audio_user = user;
    if (g_audio) SDL_UnlockAudioDevice(g_audio);
}

static void SDLCALL plat_audio_pump(void *u, Uint8 *s, int n)
{
    (void)u;
    if (g_audio_fn) g_audio_fn(g_audio_user, (int16_t *)s, n / 4);
    else memset(s, 0, (size_t)n);
}

/* ---- files ---------------------------------------------------------- */

static char g_root[1024];
static int g_pending;

void fs_set_root(const char *root) { snprintf(g_root, sizeof g_root, "%s", root ? root : ""); }
const char *fs_root(void) { return g_root; }
int fs_pending(void) { return g_pending; }

static void join(char *dst, size_t n, const char *path)
{
    size_t l = strlen(g_root);
    int w = snprintf(dst, n, "%s%s%s", g_root, (l && g_root[l - 1] != '/') ? "/" : "", path);
    if (w < 0 || (size_t)w >= n) dst[0] = 0;   /* too long: load fails rather than opening a cut path */
}

#ifdef __EMSCRIPTEN__
typedef struct FsReq { FsLoadFn cb; void *user; char path[512]; } FsReq;

static void fs_onload(void *arg, void *buf, int size)
{
    FsReq *r = arg;
    g_pending--;
    r->cb(r->user, r->path, buf, (size_t)size);
    free(r);
}

static void fs_onerror(void *arg)
{
    FsReq *r = arg;
    g_pending--;
    r->cb(r->user, r->path, NULL, 0);
    free(r);
}

void fs_load(const char *path, FsLoadFn cb, void *user)
{
    FsReq *r = calloc(1, sizeof *r);
    char url[1024];
    r->cb = cb; r->user = user;
    snprintf(r->path, sizeof r->path, "%s", path);
    join(url, sizeof url, path);
    g_pending++;
    emscripten_async_wget_data(url, r, fs_onload, fs_onerror);
}
#else
void fs_load(const char *path, FsLoadFn cb, void *user)
{
    char full[1024];
    join(full, sizeof full, path);
    FILE *f = fopen(full, "rb");
    if (!f) { cb(user, path, NULL, 0); return; }
    fseek(f, 0, SEEK_END);
    long len = ftell(f);
    fseek(f, 0, SEEK_SET);
    uint8_t *buf = malloc(len > 0 ? (size_t)len : 1);
    size_t got = buf ? fread(buf, 1, (size_t)len, f) : 0;
    fclose(f);
    if (!buf || got != (size_t)len) { free(buf); cb(user, path, NULL, 0); return; }
    cb(user, path, buf, (size_t)len);
    free(buf);
}
#endif

/* ---- shaders -------------------------------------------------------- */

const char *plat_gl_glsl_header(void)
{
#ifdef __EMSCRIPTEN__
    return "#version 300 es\nprecision highp float;\nprecision highp int;\n";
#else
    return "#version 330 core\n";
#endif
}

static GLuint compile(GLenum kind, const char *body)
{
    const char *src[2] = { plat_gl_glsl_header(), body };
    GLuint s = glCreateShader(kind);
    GLint ok = 0;
    glShaderSource(s, 2, src, NULL);
    glCompileShader(s);
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[1024];
        glGetShaderInfoLog(s, sizeof log, NULL, log);
        fprintf(stderr, "plat: shader: %s\n", log);
        glDeleteShader(s);
        return 0;
    }
    return s;
}

GLuint plat_gl_program(const char *vs_body, const char *fs_body)
{
    GLuint vs = compile(GL_VERTEX_SHADER, vs_body), fs = compile(GL_FRAGMENT_SHADER, fs_body);
    GLuint p = 0;
    GLint ok = 0;
    if (vs && fs) {
        p = glCreateProgram();
        glAttachShader(p, vs);
        glAttachShader(p, fs);
        glLinkProgram(p);
        glGetProgramiv(p, GL_LINK_STATUS, &ok);
        if (!ok) {
            char log[1024];
            glGetProgramInfoLog(p, sizeof log, NULL, log);
            fprintf(stderr, "plat: link: %s\n", log);
            glDeleteProgram(p);
            p = 0;
        }
    }
    if (vs) glDeleteShader(vs);
    if (fs) glDeleteShader(fs);
    return p;
}
