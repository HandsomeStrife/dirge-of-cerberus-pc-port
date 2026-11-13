// test_c_parity.mjs -- the C port against the JS module it replaces, value for value (native migration plan step 0).
// floor_shade: floorScale (FUN_005ae1f0) on every z128 walk polygon of the collision export, at its corners, its
// centroid and 8 seeded points around it. Inputs are f32, as the game's are (collision.js keeps Float32 verts).
// Run: node native/web/test_c_parity.mjs   (needs the wasm build and data/z128_*; else SKIP, exit 0)
// DIRGE_WASM=<dirge.mjs> runs another build (mutation runs).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
for (const f of ['data/z128_collision.bin', 'data/z128_walk_shade.bin'])
  if (!existsSync(path.join(here, f))) { console.log(`SKIP test_c_parity: ${f} missing (tools/byo/build_web.sh)`); process.exit(0); }
if (!process.env.DIRGE_WASM && !existsSync(path.join(here, 'wasm/dirge.mjs'))) { console.log('SKIP test_c_parity: no wasm build (docs/NATIVE.md)'); process.exit(0); }
const js = await import(pathToFileURL(path.join(here, 'floor_shade.js')).href);
const c = await import(pathToFileURL(path.join(here, 'c/floor_shade.mjs')).href);
const { Collision } = await import(pathToFileURL(path.join(here, 'collision.js')).href);
const col = new Collision(readFileSync(path.join(here, 'data/z128_collision.bin')));
const shade = new Uint32Array(readFileSync(path.join(here, 'data/z128_walk_shade.bin')).buffer.slice(0));
const f = Math.fround;
let seed = 1, n = 0, bad = 0, n4 = 0;
const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32 - 0.5;
const ex = [];
for (let i = 0; i < shade.length && i < col.polys.length; i++) {
  const w = shade[i], v = col.polys[i].v.map(p => p.map(f)), nv = (w << 28) >> 28;
  if (nv < 3) continue;
  if (nv >= 4) n4++;
  const cen = [0, 1, 2].map(k => f(v.slice(0, nv).reduce((s, p) => s + p[k], 0) / nv));
  const pts = [...v.slice(0, nv), cen];
  for (let k = 0; k < 8; k++) pts.push(cen.map(x => f(x + rnd() * 200)));
  for (const p of pts) {
    const a = js.floorScale(w, v, p), b = c.floorScale(w, v, p);
    n++;
    if (a !== b) { bad++; if (ex.length < 8) ex.push(`poly ${i} word ${w.toString(16)} at ${p.join(',')}: js ${a} c ${b}`); }
  }
}
console.log(`floor_shade: ${n - bad} / ${n} equal over ${shade.length} polygons (${n4} with 4 corners)`, ex.join('; '));
process.exit(bad || n < 1000 ? 1 : 0);
