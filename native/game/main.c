/* =====================================================================
 * main.c  --  dirge: the native shell (migration plan step 0).
 *
 * The same source runs as dirge (Linux), dirge.exe (Windows) and
 * dirge.wasm (browser, play_c.html). It opens the window / GL context /
 * audio through the platform layer, wires engine/core's FUN_00248110
 * frame (doc_engine_frame) to the SDL input backend, and runs game ticks
 * at the tick rate (frame_clock.h: 50 Hz default, --tick-hz to change),
 * drawing the latest tick at the display rate. Step 0 draws a cleared
 * frame: no game rendering, no gameplay yet.
 *
 *   dirge [--data DIR] [--tick-hz N] [--smoke N] [--hidden] [--no-audio]
 *     --data DIR   the BYO export tree (tools/byo/build_web.sh -> native/web/data);
 *                  default: ./data next to the exe (browser: "data/")
 *     --smoke N    run N ticks without waiting for the clock, print a state hash, exit 0
 *                  (exit 1 if GL, the data probe or the shader check failed)
 * ===================================================================== */
#include "platform.h"
#include "plat_gl.h"
#include "frame_clock.h"
#include "floor_shade.h"

#include "frame_loop.h"
#include "engine_state.h"
#include "input.h"

#define SDL_MAIN_HANDLED   /* our own main on every target: no SDL2main */
#include <SDL.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

/* the file the smoke run loads through fs_load: small, and written by every BYO build */
#define PROBE_FILE "pause.json"

typedef struct Game {
    DocEngine      eng;
    DocRenderer    rend;
    DocFrameHooks  hooks;
    EngineHooks    ehooks;
    DocRenderQueue queue;
    DocInputState  input;
    DirgeClock     clock;

    int      smoke;          /* ticks to run in --smoke mode, 0 = interactive */
    int      ticks;          /* game ticks run */
    int      running;
    int      failed;
    uint32_t fp_probe;       /* floor_scale over a fixed synthetic table (cross-target float check) */
    long     probe_len;      /* PROBE_FILE: -1 pending, -2 missing */
    uint32_t probe_fnv;
    uint32_t hash;
} Game;

static Game G;

/* ---- hashing (FNV-1a) ----------------------------------------------- */
static uint32_t fnv(uint32_t h, const void *p, size_t n)
{
    const uint8_t *b = p;
    for (size_t i = 0; i < n; i++) { h ^= b[i]; h *= 16777619u; }
    return h;
}
static uint32_t fnv_i32(uint32_t h, int32_t v) { return fnv(h, &v, 4); }

/* The state the smoke run hashes: the spine's state machine, the frame counters, the pads' held bits and the
 * float probe. Equal hashes on Linux, Windows and wasm mean the three builds ran the same ticks bit for bit. */
static uint32_t state_hash(const Game *g)
{
    const EngineState *s = &g->eng.state;
    uint32_t h = 2166136261u;
    h = fnv_i32(h, s->scene_state);
    h = fnv_i32(h, s->prev_scene_state);
    h = fnv_i32(h, (int32_t)s->mode_flags);
    h = fnv_i32(h, s->frame_counter);
    h = fnv_i32(h, g->eng.frame_counter);
    h = fnv_i32(h, g->ticks);
    for (int p = 0; p < DOC_INPUT_NUM_PORTS; p++) h = fnv_i32(h, g->input.pads[p].held);
    h = fnv_i32(h, (int32_t)g->fp_probe);
    return h;
}

/* floor_scale over pseudo-random synthetic polygons (an LCG; no game data). Single-precision rounding toward
 * zero is the case that differs if a compiler contracts or reorders float ops, so this is the cheap
 * cross-target check the plan asks for (2.3 "Floating point"). */
static uint32_t fp_probe(void)
{
    uint32_t h = 2166136261u, r = 12345u;
#define RND() (r = r * 1103515245u + 12345u, (float)((int32_t)(r >> 8) % 20000) / 7.0f)
    for (int k = 0; k < 4096; k++) {
        float v[4][3], p[3];
        for (int i = 0; i < 4; i++) for (int j = 0; j < 3; j++) v[i][j] = RND();
        for (int j = 0; j < 3; j++) p[j] = RND();
        r = r * 1103515245u + 12345u;
        uint32_t word0 = (uint32_t)(3 + (k & 1)) | (r & 0xffffff00u);
        if (k & 2) {   /* every corner the same shade: the mean is exact only with nearest rounding (61.99.. -> 122) */
            uint32_t c = (r >> 8) & 0x3f;
            word0 = (word0 & 0xffu) | c << 8 | c << 14 | c << 20 | c << 26;
        }
        h = fnv_i32(h, floor_scale(word0, (const float (*)[3])v, p));
    }
#undef RND
    return h;
}

/* ---- the frame-loop seam: input + renderer -------------------------- */
static void hk_input_poll(void *c)  { doc_input_begin(&((Game *)c)->input); }   /* FUN_002548d8 */
static void hk_input_latch(void *c) { doc_input_latch(&((Game *)c)->input); }   /* FUN_002548f8 */

/* present (FUN_0040ce28, the vblank wait + flip) is per game tick; the host swaps once per displayed frame
 * after its ticks (frame_clock.h), so present itself only marks the tick done. */
static void rd_present(void *c, int mode) { (void)mode; ((Game *)c)->ticks++; }

static void game_init(Game *g)
{
    static DocInputBackend backend;
    backend.ctx = g;
    backend.read_pad = plat_read_pad;
    backend.set_actuator = NULL;
    doc_input_init(&g->input, &backend);

    g->ehooks = engine_hooks_default();
    g->rend = doc_renderer_default();
    g->rend.ctx = g;
    g->rend.present = rd_present;
    g->hooks = doc_frame_hooks_default();
    g->hooks.ctx = g;
    g->hooks.input_poll = hk_input_poll;
    g->hooks.input_latch = hk_input_latch;
    doc_engine_init(&g->eng, &g->ehooks, &g->rend, &g->hooks, &g->queue);
    doc_engine_frame_preamble(&g->eng);
    g->ticks = 0;   /* the preamble's present(mode 1) is not a tick */
}

static void draw(void)
{
    int w, h;
    plat_drawable_size(&w, &h);
    glViewport(0, 0, w, h);
    glClearColor(0, 0, 0, 1);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    plat_swap();
}

static void on_probe(void *user, const char *path, const uint8_t *data, size_t len)
{
    Game *g = user;
    if (!data) {
        fprintf(stderr, "dirge: data probe: %s%s%s missing (build it: tools/byo/build_web.sh)\n",
                fs_root(), *fs_root() ? "/" : "", path);
        g->probe_len = -2;
        return;
    }
    g->probe_len = (long)len;
    g->probe_fnv = fnv(2166136261u, data, len);
}

static void finish_smoke(Game *g)
{
    g->hash = state_hash(g);
    printf("dirge: smoke ticks %d tick_hz %d fp_probe %08x data %s %ld bytes fnv %08x\n",
           g->ticks, g->clock.tick_hz, g->fp_probe, PROBE_FILE, g->probe_len, g->probe_fnv);
    printf("dirge: SMOKE %s hash %08x\n", g->failed || g->probe_len < 0 ? "FAIL" : "OK", g->hash);
    fflush(stdout);
    g->running = 0;
}

/* One displayed frame: events, the ticks the clock says are due (all of them in --smoke), draw. */
static double g_last;
static void frame(void)
{
    Game *g = &G;
    if (!g->running) return;
    if (!plat_poll_events()) g->running = 0;

    int n;
    if (g->smoke) {
        if (g->probe_len == -1) return;                   /* wait for the async load (browser) */
        n = g->smoke - g->ticks;
    } else {
        double now = plat_time();
        n = dirge_clock_advance(&g->clock, now - g_last);
        g_last = now;
    }
    for (int i = 0; i < n && g->running; i++)
        if (doc_engine_frame(&g->eng) == DOC_FRAME_STOP) g->running = 0;
    draw();
    if (g->smoke && g->ticks >= g->smoke) finish_smoke(g);
#ifdef __EMSCRIPTEN__
    if (!g->running) emscripten_cancel_main_loop();
#endif
}

/* ---- exports for play_c.html and the node adapters (native/web/c) ----- */
EXPORT int dirge_ticks(void) { return G.ticks; }
EXPORT int dirge_tick_hz(void) { return G.clock.tick_hz; }
EXPORT uint32_t dirge_state_hash(void) { return state_hash(&G); }
EXPORT int dirge_smoke_done(void) { return G.smoke && !G.running; }
EXPORT int dirge_failed(void) { return G.failed || G.probe_len < 0; }
/* port's held pad bits after the last tick (input.h DocPadButton): the page test presses a key and reads it here */
EXPORT int dirge_pad_held(int port) { return (port >= 0 && port < DOC_INPUT_NUM_PORTS) ? G.input.pads[port].held : 0; }
/* floor_shade.js floorScale(word0, verts, pos): verts = nverts x 3 floats, pos = 3 floats */
EXPORT int dirge_floor_scale(uint32_t word0, const float *verts, const float *pos)
{
    return floor_scale(word0, (const float (*)[3])verts, pos);
}

static const char *k_vs =
    "in vec2 a_pos;\n"
    "void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }\n";
static const char *k_fs =
    "out vec4 o_col;\n"
    "void main() { o_col = vec4(0.0, 0.0, 0.0, 1.0); }\n";

int main(int argc, char **argv)
{
    Game *g = &G;
    PlatConfig cfg = { "Dirge of Cerberus (native)", 960, 540, 1, 0, 1 };
    PlatInfo info;
    int tick_hz = DIRGE_TICK_HZ_DEFAULT;
    const char *data = NULL;

    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--data") && i + 1 < argc) data = argv[++i];
        else if (!strcmp(argv[i], "--tick-hz") && i + 1 < argc) tick_hz = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--smoke") && i + 1 < argc) g->smoke = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--hidden")) cfg.hidden = 1;
        else if (!strcmp(argv[i], "--no-audio")) cfg.audio = 0;
        else { fprintf(stderr, "dirge: unknown argument %s\n", argv[i]); return 2; }
    }
    if (g->smoke) cfg.vsync = 0;

    if (plat_init(&cfg, &info) != 0) return 1;
    printf("dirge: GL %s | %s | video %s\n", info.gl_version, info.gl_renderer, info.video_driver);
    if (info.audio_rate)
        printf("dirge: audio %s %d Hz %d ch %d frames\n", info.audio_driver, info.audio_rate,
               info.audio_channels, info.audio_samples);
    else
        printf("dirge: audio off\n");

    GLuint prog = plat_gl_program(k_vs, k_fs);
    printf("dirge: shared GLSL subset %s\n", prog ? "compiles" : "FAILED");
    if (!prog) g->failed = 1;

#ifdef __EMSCRIPTEN__
    fs_set_root(data ? data : "data/");
#else
    if (data) fs_set_root(data);
    else {
        char *base = SDL_GetBasePath(), buf[1024];
        snprintf(buf, sizeof buf, "%sdata", base ? base : "./");
        SDL_free(base);
        fs_set_root(buf);
    }
#endif
    printf("dirge: data %s | tick %d Hz\n", fs_root(), tick_hz);

    dirge_clock_init(&g->clock, tick_hz);
    game_init(g);
    g->fp_probe = fp_probe();
    g->probe_len = -1;
    fs_load(PROBE_FILE, on_probe, g);
    g->running = 1;
    g_last = plat_time();
    fflush(stdout);

#ifdef __EMSCRIPTEN__
    emscripten_set_main_loop(frame, 0, 0);   /* requestAnimationFrame; main returns, the runtime stays */
    return 0;
#else
    while (g->running) frame();
    plat_shutdown();
    return g->smoke ? (g->failed || g->probe_len < 0) : 0;
#endif
}
