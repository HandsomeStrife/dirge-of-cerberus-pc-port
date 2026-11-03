// test_room_occl.mjs -- the room's occluder culling (room_occl.js, worker 0233).
//   node --import ./native/web/test_hooks.mjs native/web/test_room_occl.mjs   (without the hook: no showChunks section)
// 1. Save states (tools/trace/out/room_occl/states.json from tools/trace/room_occl_fixture.py: the start save, the
//    route states, r06_tp, npc_s100, the room_grade tp09 / tp0b): from each state's camera matrix 0x4fcb10 and its
//    loaded slots, frame() builds DAT_0046bff8 volumes equal to the RAM's DAT_004e5db0 (FUN_0026c878; the first four
//    planes stored transposed). Then the tree: every node the page drops whose chains RAM marks (+0xa4 self pointer
//    kept = never drawn since load) at the start save's chunk 00 is never drawn; over all states, dropped nodes
//    marked 'seen' (drawn at some earlier frame) are counted; the chunks a teleport streamed in just before the save
//    (r06_tp 06 / 08, tp0b 0b) must have no dropped node drawn.
// 2. Hand cases: the inside test, the eye-side flip, the 15-volume cap, the size and clip skips, the root and the
//    sub-tree rule.
// The tree data: data/scene.json 'occl' (export_z128_room.py manifest 'occl'), ROOM_DATA=<web export dir>, or
// ROOM_OCCL=<room_manifest.json> (no range-tag / showChunks sections).
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRoomOccl } from './room_occl.js';

const here = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };

const SF = path.join(here, '../../tools/trace/out/room_occl/states.json');
const DATA = process.env.ROOM_DATA || path.join(here, 'data');       // ROOM_DATA=<dir>: another web export
const src = process.env.ROOM_OCCL || path.join(DATA, 'scene.json');
const occlData = existsSync(src) ? JSON.parse(readFileSync(src, 'utf8')).occl : null;

// 1. save states
if (!occlData) console.log(`SKIP state checks: no 'occl' in ${src} (export_z128_room.py / export_web_room.py)`);
else if (!existsSync(SF)) console.log('SKIP state checks: no tools/trace/out/room_occl/states.json (tools/trace/room_occl_fixture.py)');
else {
  const states = JSON.parse(readFileSync(SF, 'utf8'));
  const O = createRoomOccl(occlData);
  let worst = 0, counts = 0, seenDrop = 0, neverDrop = 0, startOk = null; const fresh = { never: 0, seen: 0 };
  for (const s of states) {
    const loaded = s.slots.filter(x => x.loaded).map(x => x.chunk);
    O.frame(Float32Array.from(s.view), loaded);
    if (O.count === s.count) counts++;
    else console.log(`  ${s.name}: ${O.count} volumes, RAM ${s.count}`);
    for (let k = 0; k < Math.min(O.count, s.count); k++) {
      const g = s.volumes[k], v = O.volumes.subarray(20 * k, 20 * k + 20);
      let mx = 0, d = 0;
      for (let p = 0; p < 4; p++) for (let j = 0; j < 4; j++) { mx = Math.max(mx, Math.abs(g[4 * j + p])); d = Math.max(d, Math.abs(g[4 * j + p] - v[4 * p + j])); }
      for (let j = 0; j < 4; j++) { mx = Math.max(mx, Math.abs(g[16 + j])); d = Math.max(d, Math.abs(g[16 + j] - v[16 + j])); }
      worst = Math.max(worst, d / mx);
    }
    for (const [ch, marks] of Object.entries(s.nodes)) {
      const D = O.dropped(+ch);
      if (!D) continue;
      let never = 0, seen = 0;
      marks.forEach((m, i) => { if (D[i] && m === 'never') never++; if (D[i] && m === 'seen') seen++; });
      neverDrop += never; seenDrop += seen;
      if (process.env.VERBOSE) console.log(`  ${s.name} chunk ${ch}: dropped never ${never} seen ${seen}`);
      if (s.name === 'sea-of-flames.p2s' && ch === '0') startOk = { never, seen };
      // chunks streamed in by a teleport just before the save: their marks are (nearly) this frame's
      if ((s.name === 'r06_tp.p2s' && (ch === '6' || ch === '8')) || (s.name === 'tp0b_450.p2s' && ch === '11')) { fresh.never += never; fresh.seen += seen; }
    }
  }
  ok(counts === states.length, `volume count = DAT_0046bff8 in ${counts} / ${states.length} states (incl. the 15 cap in tp0b)`);
  ok(worst < 1e-4, `volumes = DAT_004e5db0 (worst relative difference ${worst.toExponential(2)})`);
  ok(startOk && startOk.never >= 5 && startOk.seen === 0, `start save, chunk 00: the ${startOk && startOk.never} dropped nodes with chains are all never drawn in RAM (${startOk && startOk.seen} drawn)`);
  console.log(`info: over all states, dropped nodes with chains: ${neverDrop} never drawn, ${seenDrop} drawn at some earlier frame (the marks are not per frame)`);
  ok(fresh.never >= 20 && fresh.seen === 0, `chunks just streamed in (r06_tp 06 / 08, tp0b 0b): the ${fresh.never} dropped nodes with chains are all never drawn (${fresh.seen} drawn)`);
}

// 1b. the exporter's range tags (export_z128_room.py: [chunk, first, count, group, node]): every vertex of a range lies in
// its node's box (the node boxes bound their chains' geometry; FUN_0026cc80 culls by them). Needs data/scene.json's meshes.
if (occlData && !process.env.ROOM_OCCL && existsSync(src)) {
  const scene = JSON.parse(readFileSync(src, 'utf8'));
  const byC = new Map(occlData.chunks.map(c => [c.chunk, c]));
  let n = 0, bad = 0, tagged = 0, untagged = 0, worst = 0;
  const bufs = {};
  for (const d of scene.draws) {
    if (!d.chunks) continue;
    const mf = path.join(DATA, scene.meshes[d.mesh].file);
    if (!existsSync(mf)) continue;
    const f = bufs[d.mesh] || (bufs[d.mesh] = (q => new Float32Array(q.buffer.slice(q.byteOffset, q.byteOffset + q.byteLength)))(readFileSync(mf)));
    for (const [c, first, count, , nd = -1] of d.chunks) {
      if (nd < 0) { untagged++; continue; }
      tagged++;
      const B = byC.get(c).box, lo = [1e30, 1e30, 1e30], hi = [-1e30, -1e30, -1e30];
      for (let k = 0; k < 8; k++) for (let j = 0; j < 3; j++) { const v = B[24 * nd + 3 * k + j]; lo[j] = Math.min(lo[j], v); hi[j] = Math.max(hi[j], v); }
      for (let v = first; v < first + count; v++) {
        n++;
        let out = 0;
        for (let j = 0; j < 3; j++) out = Math.max(out, lo[j] - f[v * 12 + j], f[v * 12 + j] - hi[j]);
        worst = Math.max(worst, out);
        if (out > 1) bad++;
      }
    }
  }
  ok(tagged > 1000 && bad === 0, `range tags: ${n} vertices of ${tagged} node-tagged ranges lie in their node's box (worst ${worst.toFixed(3)} u outside; ${bad} > 1 u; ${untagged} ranges untagged: the +0x1c objects' chains)`);
}

// 1c. room.js showChunks with the occluder state (needs the three.js stub: node --import ./native/web/test_hooks.mjs):
// a range under a dropped node is not in its geometry's index; a camera change that flips nodes rebuilds the index
if (occlData && existsSync(SF) && !process.env.ROOM_OCCL) {
  let room = null;
  try { room = await import('./room.js'); } catch (e) { console.log(`SKIP showChunks checks: room.js needs three (run with --import ./native/web/test_hooks.mjs): ${e.message.slice(0, 80)}`); }
  if (room) {
    const scene = JSON.parse(readFileSync(src, 'utf8')), states = JSON.parse(readFileSync(SF, 'utf8'));
    const O = createRoomOccl(occlData), L = [0, 1, 2];
    const root = { userData: {}, children: [] };
    for (const d of scene.draws) if (d.chunks) root.children.push({ userData: { chunks: d.chunks }, geometry: { userData: {}, setIndex(ix) { this.index = ix; }, setDrawRange(a, n) { this.n = n; }, index: null } });
    const drawn = () => {          // per (draw, first vertex): in the index?
      const set = new Set();
      root.children.forEach((m, di) => { const ix = m.geometry.userData.visIndex; for (let k = 0; k < m.geometry.n; k++) set.add(di * 1e7 + ix.array[k]); });
      return set;
    };
    const check = st => {
      O.frame(Float32Array.from(st.view), L); room.showChunks(root, L, null, O);
      const on = drawn(); let wrong = 0, dropped = 0;
      root.children.forEach((m, di) => { for (const [c, first, , , nd = -1] of m.userData.chunks) {
        if (!L.includes(c)) continue;
        const D = nd > 0 ? O.dropped(c) : null, want = !(D && D[nd]);
        if (!want) dropped++;
        if (on.has(di * 1e7 + first) !== want) wrong++;
      } });
      return { wrong, dropped };
    };
    const a1 = check(states[0]), b1 = check(states.find(x => x.name === 'r02_climb.p2s')), a2 = check(states[0]);
    ok(a1.dropped > 0 && a1.wrong === 0 && b1.wrong === 0 && a2.wrong === 0 && a1.dropped !== b1.dropped,
      `showChunks: dropped ranges leave the index (start camera ${a1.dropped}, r02_climb ${b1.dropped}, back ${a2.dropped}; wrong ${a1.wrong} / ${b1.wrong} / ${a2.wrong})`);
  }
}

// 2. hand cases: a camera at the origin looking down +z (game view = world), a 200 x 200 wall at z = 100
{
  const V = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const quad = (z, h = 100, x0 = 0, y0 = 0) => [x0 - h, y0 - h, z, x0 + h, y0 - h, z, x0 - h, y0 + h, z, x0 + h, y0 + h, z];
  const boxAt = (cx, cy, cz, r) => { const b = []; for (const [sx, sy, sz] of [[-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1], [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]]) b.push(cx + sx * r, cy + sy * r, cz + sz * r); return b; };
  // tree: root 0 -> 1 (behind the wall) -> 2 (child of 1, anywhere); root -> 3 (in front of the wall); root -> 4 (half out)
  const data = (quads) => ({ chunks: [{ chunk: 0, parent: [-1, 0, 1, 0, 0], quads: quads.flat(),
    box: [...boxAt(0, 0, 0, 1000), ...boxAt(0, 0, 300, 20), ...boxAt(500, 0, 50, 5), ...boxAt(0, 0, 50, 20), ...boxAt(280, 0, 300, 50)] }] });
  let O = createRoomOccl(data([quad(100)]));
  O.frame(V, [0]);
  const D = O.dropped(0);
  ok(O.count === 1, `one wall: one volume (${O.count})`);
  ok(D[0] === 0 && D[1] === 1 && D[2] === 1 && D[3] === 0 && D[4] === 0,
    `root never tested; behind the wall dropped with its sub-tree (its child is in front: ${D[2]}); in front kept; half out kept (${[...D]})`);
  ok(O.inside(boxAt(0, 0, 300, 20), 8) && !O.inside(boxAt(0, 0, 50, 20), 8), 'inside(): behind the wall yes, in front no');
  // the own plane counts 0 as inside, a side plane too (MAC sign flag on >= 0)
  ok(O.inside([0, 0, 100], 1) && !O.inside([0, 0, 99.9], 1), 'a point on the wall plane is inside, just in front is not');
  // the eye on the other side: the flip keeps "behind" = away from the eye
  const V2 = Float32Array.from([-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, 0, 0, 0, 400, 1]);   // eye at (0, 0, 400) looking -z
  O.frame(V2, [0]);
  ok(O.count === 1 && O.inside([0, 0, 0], 1) && !O.inside([0, 0, 300], 1), 'eye behind the wall: the volume flips (z 0 hidden, z 300 not)');
  // 16 walls: 15 volumes (the 16th ends the build)
  O = createRoomOccl(data(Array.from({ length: 16 }, (_, i) => quad(100 + i))));
  O.frame(V, [0]);
  ok(O.count === 15, `16 walls -> ${O.count} volumes (cap 15)`);
  // a far small wall: screen cross < 4096 -> no volume; the same wall nearer -> a volume
  O = createRoomOccl(data([quad(20000, 100)])); O.frame(V, [0]);
  const far = O.count;
  O = createRoomOccl(data([quad(500, 100)])); O.frame(V, [0]);
  ok(far === 0 && O.count === 1, `a 200-unit wall: none at z 20000 (screen cross < 4096: ${far}), one at z 500 (${O.count})`);
  // a wall behind the camera: all corners outside the clip near plane -> none; a wall through the near plane -> built
  O = createRoomOccl(data([quad(-100)])); O.frame(V, [0]);
  const behind = O.count;
  O = createRoomOccl(data([[-100, -100, -50, 100, -100, -50, -100, 100, 200, 100, 100, 200]])); O.frame(V, [0]);
  ok(behind === 0 && O.count === 1, `wall behind the eye: none (${behind}); a wall crossing w = 0.1: built (${O.count})`);
  // a wall off to the side (all corners right of the clip x plane): none
  O = createRoomOccl(data([quad(100, 50, 2000)])); O.frame(V, [0]);
  ok(O.count === 0, `wall outside the frustum's right plane: none (${O.count})`);
  // unloaded chunks build nothing
  O = createRoomOccl(data([quad(100)])); O.frame(V, [5]);
  ok(O.count === 0, 'a chunk not loaded gives no volume');
  // frame() allocates nothing: the same arrays after many frames
  const vol = O.volumes, dr = O.dropped(0); for (let i = 0; i < 100; i++) O.frame(V, [0]);
  ok(O.volumes === vol && O.dropped(0) === dr, 'frame() keeps its arrays');
}

console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
