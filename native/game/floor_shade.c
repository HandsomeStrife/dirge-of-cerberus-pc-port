/* floor_shade.c -- an actor's MP+0x450 from the walk polygon it stands on (port of native/web/floor_shade.js).
 * FUN_005ae1f0, from FUN_00340e08 (Vincent), FUN_0055cac8 (others).
 * Each corner weighs (T - d^2), T = sum of the squared distances to the corners; the sum over T / (n - 1) is
 * truncated, capped at 63 and doubled. MP+0x450 / 128 scales lights 0, 1 and the ambient (FUN_005ab0b0).
 * The EE's single-precision rounding toward zero matters: three corners of shade 62 give 61.99.. and MP+0x450
 * 122, not 124 (RAM at the route states). The host FPU can't be switched to round-toward-zero in wasm, so,
 * as the JS does, each operation is done exactly in double and then rounded to a single toward zero. */
#include "floor_shade.h"

#include <math.h>
#include <string.h>

/* x (a double, exact for a product or sum of two singles) to a single, toward zero */
static float rz(double x)
{
    float f = (float)x;
    if (fabs((double)f) > fabs(x)) {
        uint32_t b;
        memcpy(&b, &f, 4);
        b -= 1;
        memcpy(&f, &b, 4);
    }
    return f;
}
static float add(float a, float b) { return rz((double)a + (double)b); }
static float sub(float a, float b) { return rz((double)a - (double)b); }
static float mul(float a, float b) { return rz((double)a * (double)b); }
static float dvd(float a, float b) { return rz((double)a / (double)b); }

/* FUN_005ae1f0 */
int floor_scale(uint32_t word0, const float verts[][3], const float pos[3])
{
    int n = (int32_t)(word0 << 28) >> 28;
    float d[4] = { 0, 0, 0, 0 };
    for (int i = 0; i < 3 || (i == 3 && n >= 4); i++) {
        const float *v = verts[i];
        float x = sub(pos[0], v[0]), y = sub(pos[1], v[1]), z = sub(pos[2], v[2]);
        d[i] = add(add(mul(x, x), mul(y, y)), mul(z, z));
    }
    float T = add(add(add(d[0], d[1]), d[2]), d[3]);
#define C(i) ((float)((word0 >> (8 + 6 * (i))) & 0x3f))
    float f = add(add(mul(C(0), sub(T, d[0])), mul(C(1), sub(T, d[1]))), mul(C(2), sub(T, d[2])));
    if (n > 3) f = add(f, mul(C(3), sub(T, d[3])));
    f = T == 0 ? C(0) : mul(dvd(f, T), dvd(1, (float)(n - 1)));
#undef C
    /* the game's cap; a mean of 6-bit shades can't pass 63, so it looks unreachable. A NaN (n < 2, no such
     * walk face) gives 0 here, NaN in the JS. */
    return (f >= 63 ? 63 : (f == f ? (int)truncf(f) : 0)) * 2;
}
