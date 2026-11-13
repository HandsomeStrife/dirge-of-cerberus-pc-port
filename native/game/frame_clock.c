/* frame_clock.c -- see frame_clock.h. Mirrors the tick accumulator of native/web/play.js frame(). */
#include "frame_clock.h"

void dirge_clock_init(DirgeClock *c, int tick_hz)
{
    c->tick_hz = tick_hz > 0 ? tick_hz : DIRGE_TICK_HZ_DEFAULT;
    c->tick = 1.0 / (double)c->tick_hz;
    c->acc = 0;
}

int dirge_clock_advance(DirgeClock *c, double dt)
{
    double cap = DIRGE_MAX_TICKS_PER_DRAW * c->tick;
    int n = 0;
    if (dt < 0) dt = 0;
    c->acc += dt < cap ? dt : cap;
    while (c->acc >= c->tick && n < DIRGE_MAX_TICKS_PER_DRAW) {
        c->acc -= c->tick;
        n++;
    }
    if (n == DIRGE_MAX_TICKS_PER_DRAW) c->acc = 0;   /* fell far behind: drop time */
    return n;
}

void dirge_clock_reset(DirgeClock *c) { c->acc = 0; }
