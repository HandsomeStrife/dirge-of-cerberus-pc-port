/* frame_clock.h -- how many game ticks a displayed frame runs.
 *
 * The game runs one FUN_00248110 frame per PAL vblank (50 Hz). A PC screen refreshes at its own rate, so,
 * as the page does (play.js frame(): acc += min(dt, 8 TICK); while acc >= TICK && n < 8 ...; if n == 8 acc = 0),
 * the host accumulates real time and runs whole game ticks. play.js then draws the body and camera lerped
 * between the last two ticks by acc / TICK (ctrl.lerp, follow.update); the C shell doesn't yet (step 0 draws a
 * cleared frame); the renderer step will.
 *
 * The tick rate is a parameter, not a constant: 50 Hz now; migration-plan decision D8 is open (Dan wants 60 fps
 * if the game has a 60 Hz mode; worker 0293 is researching it). Nothing else in the build assumes 50.
 */
#ifndef DIRGE_FRAME_CLOCK_H
#define DIRGE_FRAME_CLOCK_H

#ifdef __cplusplus
extern "C" {
#endif

#define DIRGE_TICK_HZ_DEFAULT 50     /* PAL vblank (SLES_541.85) */
#define DIRGE_MAX_TICKS_PER_DRAW 8   /* play.js: at most 8 game frames per drawn frame, then drop time */

typedef struct DirgeClock {
    int    tick_hz;
    double tick;     /* seconds per tick = 1 / tick_hz */
    double acc;      /* real time not yet run as ticks */
} DirgeClock;

void dirge_clock_init(DirgeClock *c, int tick_hz);
/* Add dt seconds of real time; returns the number of ticks to run now (0..DIRGE_MAX_TICKS_PER_DRAW). */
int  dirge_clock_advance(DirgeClock *c, double dt);
/* Forget banked time (pause / unfreeze, as play.js does with clock.getDelta(); acc = 0). */
void dirge_clock_reset(DirgeClock *c);

#ifdef __cplusplus
}
#endif
#endif /* DIRGE_FRAME_CLOCK_H */
