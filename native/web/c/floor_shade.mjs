// c/floor_shade.mjs -- floor_shade.js's API over the C port (native/game/floor_shade.c, FUN_005ae1f0).
// Run a floor_shade test on the C: node native/web/test_light_states.mjs native/web/area_stream.js native/web/c/floor_shade.mjs
// The C takes the game's single floats: verts and pos go in as f32 (the JS takes them as JS numbers).
import { M, floats } from './dirge.mjs';

const v = floats(12), p = floats(3);
export function floorScale(word0, verts, pos) {
  const nv = Math.min(verts.length, 4);
  for (let i = 0; i < nv; i++) for (let k = 0; k < 3; k++) v.set(i * 3 + k, verts[i][k]);
  for (let k = 0; k < 3; k++) p.set(k, pos[k]);
  return M._dirge_floor_scale(word0 >>> 0, v.ptr, p.ptr);
}
