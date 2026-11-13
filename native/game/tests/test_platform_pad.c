/* test_platform_pad.c -- a key press reaches the engine as the pad button the page binds it to.
 * Keyboard state -> plat_keys_to_pad -> plat_pad_pack (the libpad buffer) -> engine/core/input.c's decode and
 * edge detection (FUN_00254638 / FUN_002553e8), i.e. the path dirge's input_poll hook runs every tick.
 * Bindings: pause_layer.js PAUSE_KEYS (FUN_00255220's table): Start = Esc / Enter, Cross = Space,
 * Circle = Backspace, d-pad = arrows. */
#define SDL_MAIN_HANDLED
#include <SDL.h>
#include "platform.h"
#include "input.h"
#include <stdio.h>
#include <string.h>

static int fail;
#define CHECK(c, ...) do { if (!(c)) { printf("FAIL " __VA_ARGS__); printf("\n"); fail++; } } while (0)

static uint8_t ks[SDL_NUM_SCANCODES];
static int fake_read(void *ctx, int port, uint8_t out[32])
{
    (void)ctx;
    if (port != 0) { memset(out, 0, 32); return 0; }
    plat_pad_pack(plat_keys_to_pad(ks), 0x80, 0x80, 0x80, 0x80, out);
    return 1;
}

static DocInputState in;
static void tick(void) { doc_input_begin(&in); doc_input_latch(&in); }

static void key(SDL_Scancode sc, uint16_t want, const char *name)
{
    memset(ks, 0, sizeof ks);
    tick();
    ks[sc] = 1;
    tick();
    CHECK(doc_input_pressed(&in, 0, want) && in.pads[0].held == want, "%s: held %04x want %04x", name, in.pads[0].held, want);
    ks[sc] = 0;
    tick();
    CHECK(doc_input_released(&in, 0, want) && in.pads[0].held == 0, "%s release: held %04x", name, in.pads[0].held);
}

int main(void)
{
    DocInputBackend b = { NULL, fake_read, NULL };
    doc_input_init(&in, &b);
    key(SDL_SCANCODE_SPACE, DOC_PAD_CROSS, "Space");
    key(SDL_SCANCODE_BACKSPACE, DOC_PAD_CIRCLE, "Backspace");
    key(SDL_SCANCODE_ESCAPE, DOC_PAD_START, "Esc");
    key(SDL_SCANCODE_RETURN, DOC_PAD_START, "Enter");
    key(SDL_SCANCODE_UP, DOC_PAD_UP, "Up");
    key(SDL_SCANCODE_DOWN, DOC_PAD_DOWN, "Down");
    key(SDL_SCANCODE_LEFT, DOC_PAD_LEFT, "Left");
    key(SDL_SCANCODE_RIGHT, DOC_PAD_RIGHT, "Right");
    /* unbound keys press nothing; port 0 stays connected, analog, sticks centred */
    memset(ks, 0, sizeof ks); ks[SDL_SCANCODE_Z] = 1; tick();
    CHECK(in.pads[0].held == 0, "Z pressed %04x", in.pads[0].held);
    CHECK(in.pads[0].current.connected && in.pads[0].current.status == DOC_PAD_MODE_ANALOG, "port 0 state");
    CHECK(in.pads[0].current.lstick_x == 0x80 && in.pads[0].current.rstick_y == 0x80, "sticks centred");
    CHECK(!in.pads[1].current.connected, "port 1 disconnected without a controller");
    /* two keys at once: both bits, and the pressure bytes of pressure buttons */
    memset(ks, 0, sizeof ks); ks[SDL_SCANCODE_SPACE] = ks[SDL_SCANCODE_LEFT] = 1; tick();
    CHECK(in.pads[0].held == (DOC_PAD_CROSS | DOC_PAD_LEFT), "Space+Left %04x", in.pads[0].held);
    CHECK(in.pads[0].current.pressures[DOC_PAD_PRES_CROSS] == 0xff && in.pads[0].current.pressures[DOC_PAD_PRES_LEFT] == 0xff
          && in.pads[0].current.pressures[DOC_PAD_PRES_CIRCLE] == 0, "pressures");
    printf(fail ? "test_platform_pad: %d FAILED\n" : "test_platform_pad: all ok\n", fail);
    return fail != 0;
}
