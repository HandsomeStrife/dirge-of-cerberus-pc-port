/* test_frame_clock.c -- the host tick accumulator (frame_clock.c, after play.js frame()).
 * What a player sees: at a 60 Hz display a 50 Hz game runs 50 ticks a second, never two draws' worth of
 * catch-up after a stall beyond 8, and a 60 Hz tick rate (D8, open) is only a parameter away. */
#include "frame_clock.h"
#include <stdio.h>

static int fail;
#define CHECK(c, ...) do { if (!(c)) { printf("FAIL " __VA_ARGS__); printf("\n"); fail++; } } while (0)

static int run(int tick_hz, double display_hz, double seconds)
{
    DirgeClock c;
    int ticks = 0, frames = (int)(seconds * display_hz + 0.5);
    dirge_clock_init(&c, tick_hz);
    for (int i = 0; i < frames; i++) ticks += dirge_clock_advance(&c, 1.0 / display_hz);
    return ticks;
}

int main(void)
{
    /* 50 Hz game on 60 / 144 / 30 Hz displays: 50 ticks per second (+-1 for the banked remainder) */
    int t60 = run(50, 60, 10), t144 = run(50, 144, 10), t30 = run(50, 30, 10);
    CHECK(t60 >= 499 && t60 <= 500, "50 Hz on 60 Hz: %d ticks in 10 s", t60);
    CHECK(t144 >= 499 && t144 <= 500, "50 Hz on 144 Hz: %d ticks in 10 s", t144);
    CHECK(t30 >= 499 && t30 <= 500, "50 Hz on 30 Hz: %d ticks in 10 s", t30);
    /* the tick rate is a parameter: 60 Hz runs 60 a second */
    int t6060 = run(60, 60, 10);
    CHECK(t6060 >= 599 && t6060 <= 600, "60 Hz on 60 Hz: %d ticks in 10 s", t6060);
    /* default when unset */
    DirgeClock c;
    dirge_clock_init(&c, 0);
    CHECK(c.tick_hz == DIRGE_TICK_HZ_DEFAULT, "default tick rate %d", c.tick_hz);
    /* a 2 s stall: dt is capped at 8 ticks; 8 x (1/50) in doubles leaves 7 ticks and just under one banked,
     * exactly as play.js (node: acc = min(2, 8 TICK); ... -> 7, 0.019999999999999993) */
    dirge_clock_init(&c, 50);
    int n = dirge_clock_advance(&c, 2.0);
    CHECK(n == 7 && c.acc > 0.0199 && c.acc < 0.02, "stall: %d ticks, acc %.17g", n, c.acc);
    /* a second stall right after reaches 8: then the time is dropped (no spiral of catch-up) */
    n = dirge_clock_advance(&c, 2.0);
    CHECK(n == 8 && c.acc == 0, "second stall: %d ticks, acc %.17g", n, c.acc);
    CHECK(dirge_clock_advance(&c, 0.0) == 0, "after a drop nothing is banked");
    /* 7 ticks' worth runs 7 and keeps the remainder */
    dirge_clock_init(&c, 50);
    n = dirge_clock_advance(&c, 7.5 / 50);
    CHECK(n == 7 && c.acc > 0.009 && c.acc < 0.011, "7.5 ticks: %d, acc %f", n, c.acc);
    dirge_clock_reset(&c);
    CHECK(c.acc == 0 && dirge_clock_advance(&c, 0.019) == 0, "reset drops banked time");
    printf(fail ? "test_frame_clock: %d FAILED\n" : "test_frame_clock: all ok\n", fail);
    return fail != 0;
}
