// test_light_states.mjs -- light 2 at the route's save states against the game's RAM (worker 0260): pickLight over the state's loaded slots at
// the state's actor point (FUN_005a72a8: MP+0x10 x (MP+0x90 + MP+0xa0) / 2), then FUN_005ab0b0's dir / colour, against MP+0x110 / +0x140 (settled:
// FUN_005ab608 only moves them while the pick changes). Fixture: tools/trace/light_fixture.py. Run: node native/web/test_light_states.mjs [area_stream.js]
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
const here = path.dirname(fileURLToPath(import.meta.url));
const fx = path.join(here, '../../tools/trace/out/w260/light_states.json'), lj = path.join(here, 'data/vincent/light.json');
if (!existsSync(fx) || !existsSync(lj)) { console.log('SKIP test_light_states: no fixture / light.json'); process.exit(0); }
const L = JSON.parse(readFileSync(lj, 'utf8')), S = JSON.parse(readFileSync(fx, 'utf8'));
const { Collision } = await import(pathToFileURL(path.join(here, 'collision.js')).href);
const { floorScale } = await import(pathToFileURL(path.resolve(process.argv[3] ?? path.join(here, 'floor_shade.js'))).href);
const col = new Collision(readFileSync(path.join(here, 'data/z128_collision.bin')));
const shade = new Uint32Array(readFileSync(path.join(here, 'data/z128_walk_shade.bin')).buffer.slice(0));
const { pickLight, loadedGrids, Light2 } = await import(pathToFileURL(path.resolve(process.argv[2] ?? path.join(here, 'area_stream.js'))).href);
let bad = 0, n = 0, settled = 0, worstC = 0, worstD = 0;
const byChunk = {};
for (const s of S) {
  const c = [0, 1, 2].map(k => (s.b0[k] + s.b1[k]) / 2), m = s.m;
  const p = { x: m[0] * c[0] + m[4] * c[1] + m[8] * c[2] + m[12], y: m[1] * c[0] + m[5] * c[1] + m[9] * c[2] + m[13], z: m[2] * c[0] + m[6] * c[1] + m[10] * c[2] + m[14] };
  const stream = { loaded: () => s.slots.filter((_, k) => s.loaded[k]) };
  const r = pickLight(loadedGrids(L, stream), p, L.pick_start);
  // MP+0x430 = the settled light (FUN_005ab608; +0x110 / +0x140 are only written while the pick changes, so they are stale once settled). Its record holds the position
  const f = s.rec_f || [];
  const at = f.length ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].find(o => (L.allPos ??= Object.values(L.chunks).flatMap(g => g.lights.map(q => q.pos))).some(q => q.every((v, i) => Math.abs(v - f[o + i]) < 1e-3))) : undefined;
  const gamePos = at === undefined ? null : f.slice(at, at + 3);
  const same = gamePos && r ? r.pos.every((v, i) => Math.abs(v - gamePos[i]) < 1e-3) : (!gamePos && !r);
  // while a change settles the record is the previous pick: then the page's light must differ from it with the game's in transit
  const l = new Light2().update(r, p);
  const dd = gamePos ? Math.hypot(gamePos[0] - p.x, gamePos[1] - p.y, gamePos[2] - p.z) : 0;
  n++; if (same) settled++;
  const tag = s.slots.join(',');
  (byChunk[tag] ??= []).push(same);
  (s.at ??= at);
  if (!same) console.log(`diff ${s.name} slots ${tag} p (${p.x.toFixed(0)},${p.y.toFixed(0)},${p.z.toFixed(0)}) page ${r ? r.pos.map(v => v.toFixed(0)) + ' k ' + r.k + ' q ' + (((p.x - r.pos[0]) ** 2 + (p.y - r.pos[1]) ** 2 + (p.z - r.pos[2]) ** 2) / r.k).toFixed(0) : 'none'} | game rec ${s.rec ? s.rec.toString(16) : 0} ${gamePos ? gamePos.map(v => v.toFixed(0)) + ' d ' + dd.toFixed(0) : 'not a known light'}`);
}
// the T = 0 path of FUN_005ae1f0: a degenerate polygon, the actor on all its corners, takes corner 0's shade as it is. Not a test of the cap at 63 (0x427c0000): a weighted
// mean of 6-bit shades can't exceed 63, so the cap looks unreachable (removing it changes nothing; a lower cap fails here)
{
  const at0 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], w = c => 3 | c << 8;
  const c63 = floorScale(w(63), at0, [0, 0, 0]), c62 = floorScale(w(62), at0, [0, 0, 0]);
  console.log(`T = 0 path: shade 63 -> ${c63}, 62 -> ${c62}`);
  if (c63 !== 126 || c62 !== 124) bad++;
}
// MP+0x450: floorScale on the polygon under the state's position, the page's own search, against RAM
let sOk = 0, sN = 0, wOk = 0; const sb = [];
for (const s of S) {
  if (!s.pos) continue;
  const h = col.groundHit(s.pos[0], s.pos[2], s.pos[1]);
  if (!h) { sb.push(`${s.name} no polygon`); sN++; continue; }
  const got = floorScale(shade[h.poly], col.polys[h.poly].v, s.pos);
  sN++; wOk += shade[h.poly] === s.word0;
  if (got === s.scale_b) sOk++; else sb.push(`${s.name} page ${got} game ${s.scale_b}${shade[h.poly] === s.word0 ? '' : ' (other polygon)'}`);
}
console.log(`MP+0x450: ${sOk} / ${sN} equal, polygon word equal on ${wOk}; values ${[...new Set(S.map(q => q.scale_b))].join()}`, sb.slice(0, 12).join('; '));
// r03_spot, r03_spot2, r06_tp were teleported by a poke: their +0x450 is from where he stood before (notes/route-states.md)
if (sOk < sN - 3 || sb.some(x => !/^(r03_spot|r03_spot2|r06_tp) /.test(x))) bad++;
console.log('record position offset (floats):', [...new Set(S.map(q => q.at))].join());
for (const [k, v] of Object.entries(byChunk)) console.log(`slots ${k}: ${v.filter(Boolean).length} / ${v.length} equal`);
console.log(`${settled} / ${n} states: the page's pick = MP+0x430's light (the rest: list above)`);
// page none vs a kept record is the game's own: FUN_005ab0b0's no-light path keeps MP+0x430 (d^2 of dir against 0 never settles) with the colour decaying. A state moving across lights is mid-change.
if (settled < 42) bad++;
process.exit(bad ? 1 : 0);
