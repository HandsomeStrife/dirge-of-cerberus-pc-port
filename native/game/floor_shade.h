/* floor_shade.h -- an actor's MP+0x450 from the walk polygon it stands on.
 * C port of native/web/floor_shade.js (worker 0260): FUN_005ae1f0, called from FUN_00340e08 (Vincent) and
 * FUN_0055cac8 (the others). First module moved by the native migration plan (step 0's proof module). */
#ifndef DIRGE_FLOOR_SHADE_H
#define DIRGE_FLOOR_SHADE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* word0: the face record's word 0 (DCOL sidecar, cid.c): bits 0-3 corner count n, 6 bits of shade per
 * corner from bit 8. verts: n corners (3 or 4) as x,y,z. pos: the actor's position. Returns MP+0x450. */
int floor_scale(uint32_t word0, const float verts[][3], const float pos[3]);

#ifdef __cplusplus
}
#endif
#endif /* DIRGE_FLOOR_SHADE_H */
