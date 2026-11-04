// floor_shade.js -- an actor's MP+0x450 from the walk polygon it stands on (worker 0260). FUN_005ae1f0, from FUN_00340e08 (Vincent), FUN_0055cac8 (others).
// Face record word 0 (DCOL sidecar z128_walk_shade.bin, cid.c): bits 0-3 corner count n, 6 bits per corner from bit 8. Each corner weighs (T - d^2), T = sum of the
// squared distances to the corners; the sum over T / (n - 1) is truncated, capped at 63 and doubled. MP+0x450 / 128 scales lights 0, 1 and the ambient (FUN_005ab0b0); the page's light 1 colour is 0.
// The EE's single-precision rounding toward zero matters: three corners of shade 62 give 61.99.. and MP+0x450 122, not 124 (RAM at the route states).
const buf = new Float32Array(1), bits = new Int32Array(buf.buffer);
function rz(x) {                     // x (a double, exact for a product or sum of two singles) to a single, toward zero
  buf[0] = x;
  if (Math.abs(buf[0]) > Math.abs(x)) bits[0] -= 1;
  return buf[0];
}
const add = (a, b) => rz(a + b), sub = (a, b) => rz(a - b), mul = (a, b) => rz(a * b), div = (a, b) => rz(a / b);

export function floorScale(word0, verts, pos) {
  const n = (word0 << 28) >> 28;
  const d = [0, 0, 0, 0];
  for (let i = 0; i < 3 || (i === 3 && n >= 4); i++) {
    const v = verts[i], x = sub(pos[0], v[0]), y = sub(pos[1], v[1]), z = sub(pos[2], v[2]);
    d[i] = add(add(mul(x, x), mul(y, y)), mul(z, z));
  }
  const T = add(add(add(d[0], d[1]), d[2]), d[3]);
  const c = i => (word0 >>> (8 + 6 * i)) & 0x3f;
  let f = add(add(mul(c(0), sub(T, d[0])), mul(c(1), sub(T, d[1]))), mul(c(2), sub(T, d[2])));
  if (n > 3) f = add(f, mul(c(3), sub(T, d[3])));
  f = T === 0 ? c(0) : mul(div(f, T), div(1, n - 1));
  return (f >= 63 ? 63 : Math.trunc(f)) * 2;      // the game's cap; a mean of 6-bit shades can't pass 63, so it looks unreachable
}
