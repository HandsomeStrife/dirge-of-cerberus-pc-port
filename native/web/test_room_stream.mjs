// test_room_stream.mjs -- what the page draws at the first level's two reported room defects
// (worker 0213; notes/room-blend-streaming.md):
//   chunk 07 (-1780, -44, 1595): black panels = chunk 0c's stand-in walls, which the game never has
//     loaded there (area streaming: chunk 00 + the pair (6, 7)); room.js showChunks must hide them
//   chunk 09 (22, -40, 797): a flat orange wall = chunk 09's fire-glow chain 84 (texture 0680ff35,
//     vertex alpha 0..25), a bucketed blend-mode-0 chain; it must be a blended (alpha-tested) draw
//   + the decoded blend modes in scene.json (0680ff88 additive), and showChunks' ranges (worker 0225: one index
//   per draw over the loaded chunks' ranges whose visibility group is not hidden).
// Rays are cast on scene.json's vertex buffers over the ranges showChunks leaves drawn.
// Run: node --import ./native/web/test_hooks.mjs native/web/test_room_stream.mjs  (needs data/scene.json
// from export_web_room.py on an export_z128_room.py room with chunk ranges, and data/vincent/light.json)
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { showChunks } from './room.js';
import { createVisMask } from './room_vis.js';
import { AreaStream } from './area_stream.js';

const here = dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const D = process.env.ROOM_DATA || join(here, 'data');   // ROOM_DATA: another export (mutation checks)
if (!existsSync(join(D, 'scene.json')) || !existsSync(join(D, 'vincent/light.json'))) {
  console.log('SKIP: no data/scene.json or data/vincent/light.json'); process.exit(0);
}
const scene = JSON.parse(readFileSync(join(D, 'scene.json'), 'utf8'));
const L = JSON.parse(readFileSync(join(D, 'vincent/light.json'), 'utf8'));
const room = scene.draws.map((d, i) => [d, i]).filter(([d]) => d.kind === 'room');
ok(room.filter(([d]) => d.chunks).length > 0.9 * room.length, `room draws carry chunk ranges (${room.filter(([d]) => d.chunks).length}/${room.length})`);

// 1. ranges: in chunk order, contiguous, covering the draw
{
  let bad = 0;
  for (const [d] of room) {
    if (!d.chunks) continue;
    let at = d.first, prev = -1;
    for (const [c, f, n, g] of d.chunks) { if (f !== at || c < prev || n <= 0 || !(g >= -1 && g <= 255)) bad++; at += n; prev = c; }
    if (at !== d.first + d.count) bad++;
  }
  ok(bad === 0, `chunk ranges ascend, are contiguous, cover each draw and carry a group (${bad} bad)`);
}

// a fake three.js geometry: showChunks sets an index (Uint32 vertex list) and a draw range over it
const fakeGeom = (first, count) => ({ r: [first, count], index: null, userData: {},
  setDrawRange(a, b) { this.r = [a, b]; }, setIndex(ix) { this.index = ix; } });
const drawn = g => g.index ? [...g.index.array.slice(g.r[0], g.r[0] + g.r[1])] : Array.from({ length: g.r[1] }, (_, k) => g.r[0] + k);
// a fake three.js root built the way loadRoom builds it (one geometry per draw)
function fakeRoot() {
  const root = { userData: {}, children: [] };
  for (const [d, di] of room)
    root.children.push({ name: d.name, geometry: fakeGeom(d.first, d.count), userData: d.chunks ? { draw: di, mode: 0, chunks: d.chunks } : { draw: di, mode: 0 } });
  return root;
}
// 2. showChunks on hand ranges
{
  const runs = g => { const v = drawn(g), r = []; for (const x of v) { const l = r[r.length - 1]; if (l && l[0] + l[1] === x) l[1]++; else r.push([x, 1]); } return JSON.stringify(r); };
  const mk = ch => { const g = fakeGeom(0, 21); return [g, { userData: {}, children: [{ name: 'x', geometry: g, userData: { chunks: ch } }] }]; };
  const [g, r] = mk([[0, 0, 3, -1], [1, 3, 6, 5], [6, 9, 3, -1], [7, 12, 6, 0], [12, 18, 3, 255]]);
  showChunks(r, [0, 6, 7]);
  ok(runs(g) === '[[0,3],[9,9]]', `loaded {0,6,7}: runs [0,3) [9,18) (${runs(g)})`);
  showChunks(r, null);
  ok(runs(g) === '[[0,21]]', `null = every chunk in one run (${runs(g)})`);
  showChunks(r, [12, 1]);
  ok(runs(g) === '[[3,6],[18,3]]', `loaded {1,12} (${runs(g)})`);
  const m = createVisMask();
  m.setCamera([1, 0, 0, 0]);                       // group 0 hidden (DAT_004e86f0 bit 0)
  showChunks(r, null, m);
  ok(runs(g) === '[[0,12],[18,3]]', `group 0 hidden: chunk 7's range dropped (${runs(g)})`);
  m.setScript(5, true);                            // DAT_004e8700 bit 5 (stage-script cmd 0x55 half)
  showChunks(r, null, m);
  ok(runs(g) === '[[0,3],[9,3],[18,3]]', `+ script group 5: chunk 1's range dropped too (${runs(g)})`);
  m.setCamera([0, 0, 0, 0]); m.clearScript();
  m.setCamera([0, 0, 0, 0x80000000]);              // bit 127; group 255 is > 0x7f: never hidden (FUN_00269450)
  showChunks(r, null, m);
  ok(runs(g) === '[[0,21]]', `group 255 never hidden (${runs(g)})`);
}

// mesh buffers (12 floats a vertex: pos, normal, uv, rgba)
const buf = {};
for (const [d] of room) if (!buf[d.mesh]) buf[d.mesh] = new Float32Array(readFileSync(join(D, scene.meshes[d.mesh].file)).buffer.slice(0));
function cast(root, eye, dir) {
  const n = Math.hypot(...dir), v = dir.map(x => x / n);
  let best = null;
  for (const m of root.children) {
    const d = scene.draws[m.userData.draw], f = buf[d.mesh], vs = drawn(m.geometry);
    for (let k = 0; k < vs.length; k += 3) {
      const i = vs[k];
      const A = [f[i * 12], f[i * 12 + 1], f[i * 12 + 2]], B = [f[i * 12 + 12], f[i * 12 + 13], f[i * 12 + 14]], C = [f[i * 12 + 24], f[i * 12 + 25], f[i * 12 + 26]];
      const e1 = B.map((x, k) => x - A[k]), e2 = C.map((x, k) => x - A[k]);
      const p = [v[1] * e2[2] - v[2] * e2[1], v[2] * e2[0] - v[0] * e2[2], v[0] * e2[1] - v[1] * e2[0]];
      const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
      if (Math.abs(det) < 1e-9) continue;
      const s = eye.map((x, k) => x - A[k]), u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
      if (u < 0 || u > 1) continue;
      const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
      const w = (v[0] * q[0] + v[1] * q[1] + v[2] * q[2]) / det;
      if (w < 0 || u + w > 1) continue;
      const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
      if (t > 0.5 && (!best || t < best.t)) best = { t, draw: d, col: [f[i * 12 + 8], f[i * 12 + 9], f[i * 12 + 10], f[i * 12 + 11]].map(x => Math.round(x * 255)) };
    }
  }
  return best;
}
const opaque = d => !(d.aref >= 0) && !d.blend;

// 3. chunk 07: walk in from chunk 06 through the (6, 7) boxes, then stand in the room
{
  const st = new AreaStream(L.areas, L.start_pair);
  for (const p of [[-1611, -27, 1357], [-1524, -27, 1646], [-1780, -44, 1595]]) { st.frame({ x: p[0], y: p[1], z: p[2] }); st.frame({ x: p[0], y: p[1], z: p[2] }); }
  const loaded = st.loaded().slice().sort((a, b) => a - b);
  ok(JSON.stringify(loaded) === '[0,6,7]', `in chunk 07's room the stream holds chunks ${JSON.stringify(loaded)} (want [0,6,7])`);
  const eye = [-1820, -60, 1595];
  const rAll = fakeRoot(); showChunks(rAll, null);
  const rStr = fakeRoot(); showChunks(rStr, loaded);
  for (const dir of [[1, 0.1, 0], [1, 0.1, -0.15]]) {
    const a = cast(rAll, eye, dir), b = cast(rStr, eye, dir);
    ok(a && a.col.slice(0, 3).join() === '0,0,0', `control, every chunk drawn: ray ${dir} hits chunk 0c's black panel first (${a && a.col})`);
    ok(b && b.col.slice(0, 3).some(x => x > 20) && b.t > (a ? a.t : 0), `streamed: the ray hits chunk 07's wall behind it (col ${b && b.col}, t ${b && b.t.toFixed(1)} vs ${a && a.t.toFixed(1)})`);
  }
}
// 4. chunk 09: the first surface the reported view meets is a blended glow, not an opaque wall
{
  const st = new AreaStream(L.areas, L.start_pair);
  for (let f = 0; f < 4; f++) st.frame({ x: 22, y: -40, z: 797 });   // one chunk load per frame (area_stream.js)
  const r = fakeRoot(); showChunks(r, st.loaded());
  ok(JSON.stringify(st.loaded().slice().sort((a, b) => a - b)) === '[0,8,9]', `at (22, -40, 797) the stream holds ${JSON.stringify(st.loaded())} (box pair 8, 9)`);
  const h = cast(r, [22, -50, 797], [0, 0.2, 1]);
  ok(h && h.draw.tex === 't_0680ff35' && !opaque(h.draw) && h.draw.aref > 0.7 && h.draw.aref < 0.76,
     `chunk 09 view: first hit = glow 0680ff35, blended with ATE ref 96 (tex ${h && h.draw.tex}, aref ${h && h.draw.aref}, blend ${h && h.draw.blend}, col ${h && h.col})`);
  ok(h && h.col[3] <= 26, `the glow's vertex alpha is low (${h && h.col[3]} <= 25 + rounding): it can't hide the street`);
}
// 5. decoded blend modes (export_z128_room.py chain_blend)
{
  const add = new Set(room.filter(([d]) => d.blend === 'add').map(([d]) => d.tex));
  ok(add.has('t_0680ff88'), `0680ff88 (TBP 11836 in the hero dump: ALPHA 0x48, TEST 0x51601) is additive`);
  ok([...room].filter(([d]) => d.blend === 'add' && d.aref >= 0).length === 0, 'no draw is both additive and alpha-tested');
  const at = new Set(room.filter(([d]) => d.aref >= 0).map(([d]) => d.tex));
  const known = ['t_0680ff31', 't_0680ff30', 't_0680ff28', 't_0680ff32', 't_0680ff54', 't_0680ff07'];
  ok(known.every(t => at.has(t)), `the six dump-measured ATE textures are still alpha-tested (${known.filter(t => !at.has(t))} missing)`);
}
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
