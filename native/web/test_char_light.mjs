// Character light 2 by chunk (worker 0216; area_stream.js, play.js setupCharLighting):
//   the slot table DAT_004e4c60 streamed by the area boxes (FUN_0026a0c0 -> FUN_002677a0, FUN_00267970)
//   and the light-2 pick over the loaded slots only (FUN_0026a710 -> FUN_00270ed8 -> FUN_00270d08).
// Run: node native/web/test_char_light.mjs [area_stream.js]   (the argument loads another copy: mutation checks)
// Reads data/vincent/light.json (gitignored game data; export_web_light.py); skips without it.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const lj = path.join(here, 'data/vincent/light.json');
if (!existsSync(lj)) { console.log('SKIP test_char_light: data/vincent/light.json missing'); process.exit(0); }
const L = JSON.parse(readFileSync(lj, 'utf8'));
if (!L.chunks) { console.log('FAIL light.json is v1 (no chunks): re-run export_web_light.py'); process.exit(1); }
const { AreaStream, pickLight, loadedGrids, Light2 } = await import(pathToFileURL(path.resolve(process.argv[2] ?? path.join(here, 'area_stream.js'))).href);

let bad = 0;
const ok = (c, m, info = '') => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}${info ? '  (' + info + ')' : ''}`); if (!c) bad++; };
const P = (x, y, z) => ({ x, y, z });
const lid = r => { for (const g of Object.values(L.chunks)) { const i = g.lights.indexOf(r); if (i >= 0) return `c${g.chunk}#${i}`; } return 'none'; };

// independent reference of FUN_00270d08 over a list of chunks (written from the decomp, not from area_stream.js)
function refPick(chunks, p) {
  let best = 1e6, hit = 'none';
  for (const c of chunks) {
    const g = L.chunks[c]; if (!g) continue;
    const ix = Math.min(Math.max(Math.trunc((p.x - g.x0) / g.size), 0), g.nx - 1);
    const iz = Math.min(Math.max(Math.trunc((p.z - g.z0) / g.size), 0), g.nz - 1);
    for (const li of g.cells[iz * g.nx + ix]) {
      const r = g.lights[li], d = [p.x - r.pos[0], p.y - r.pos[1], p.z - r.pos[2]];
      const q = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]) / r.k;
      if (!(q < best)) continue;
      if (r.type === 2 && (d[0] * r.spot[0] + d[1] * r.spot[1] + d[2] * r.spot[2]) / Math.hypot(...d) < r.spot[3]) continue;
      best = q; hit = `c${c}#${li}`;
    }
  }
  return hit;
}

// export: every chunk file with a grid (0680AA11, version >= 0x12, +0x98 count != 0), the 'eib' boxes, the start pair
ok(Object.keys(L.chunks).sort((a, b) => a - b).join() === '1,2,3,4,5,6,7,8,9,11', 'grids of chunks 1-9, 11 (00 / 0a / 0c have none)', Object.keys(L.chunks).join());
ok(L.areas.length === 28 && L.areas.every(r => r.type === 0 && r.flags === 0), "28 'eib' boxes, all type 0", `${L.areas.length}`);
ok(JSON.stringify(L.start_pair) === '[1,2]', 'start pair (1, 2): FUN_003ff7a8(0x80, 1, 2)');

// box test (FUN_00271aa8): the start point is in no box; a box's own centre is in it; the first box wins
const s0 = new AreaStream(L.areas, L.start_pair);
ok(s0.box(P(-1395.15, -98.64, -1111.01)) === null, 'save-state position (deck) is in no box');
const b3 = s0.box(P(-1517, -20, -695)), b21 = s0.box(P(-1498, -27, 1242));
ok(b3 && b3.a === 2 && b3.b === 3, 'box at (-1517,-20,-695) streams (2, 3)', b3 && `${b3.a},${b3.b}`);
ok(b21 && b21.a === 6 && b21.b === 8, 'box at (-1498,-27,1242) streams (6, 8)', b21 && `${b21.a},${b21.b}`);
ok(s0.box(P(-841, -143, -591))?.a === 1 && s0.box(P(-841, -67, -591))?.b === 3, 'the stacked ladder boxes: (1, 2) above, (2, 3) below');
ok(s0.box(P(-1517 + 241.8 / 2 + 1, -20, -695)) !== b3, 'just outside box 3 along its x size is not box 3');

// streaming (FUN_002677a0 / FUN_00267970): start = slots 0 / 1 / 2 loaded with chunks 0 / 1 / 2
ok(s0.loaded().join() === '0,1,2', 'start: loaded 0,1,2', s0.loaded().join());
const route = [   // box centres along the walk route 02 -> 03 -> 04 -> 05 -> 06, loaded slots in table order after 3 frames
  [P(-1395, -99, -1111), '0,1,2'], [P(-841, -143, -591), '0,1,2'], [P(-841, -67, -591), '0,3,2'],
  [P(-801, 0, -109), '0,3,4'], [P(-662, 0, 32), '0,5,4'], [P(-1268, -16, 920), '0,5,6'], [P(-1498, -27, 1242), '0,8,6'],
];
const s = new AreaStream(L.areas, L.start_pair);
let seq = true; const got = [];
for (const [p, want] of route) { for (let k = 0; k < 3; k++) s.frame(p); got.push(s.loaded().join('')); if (s.loaded().join() !== want) seq = false; }
ok(seq, 'route 02 -> 06: the freed slot takes the new chunk (slot order kept)', got.join(' '));

// one load at a time; both chunks new: unload both, then 4 into slot 1, then 5 into slot 2
const s2 = new AreaStream(L.areas, L.start_pair), q = P(-1267, -16, 733), steps = [];
for (let k = 0; k < 3; k++) { s2.frame(q); steps.push(s2.loaded().join('')); }
ok(steps.join() === '0,04,045', 'entering (4, 5) from (1, 2): unload both, load 4, then 5 (one per FUN_00267970)', steps.join());
// a request made during a load waits (DAT_0046bfb8 / bc) and is applied when it completes
const s3 = new AreaStream(L.areas, L.start_pair);
s3.request(3, 4); s3.request(6, 8);
ok(s3.busy === 1 && s3.pend.join() === '6,8', 'request during a load is kept pending', `busy ${s3.busy} pend ${s3.pend}`);
s3.progress(); s3.progress(); s3.progress();
ok(s3.loaded().join() === '0,6,8', 'after the load: the pending (6, 8) is applied', s3.loaded().join());
s.reset(L.start_pair);
ok(s.loaded().join() === '0,1,2' && s.busy === 0, 'reset (stage reload) -> 0,1,2');

// light 2 by chunk: the pick scans the loaded slots only
const at = (p, st) => lid(pickLight(loadedGrids(L, st), p, L.pick_start));
const sR = new AreaStream(L.areas, L.start_pair);
const hits = [];
let same = true;
for (const [p] of route) {
  for (let k = 0; k < 3; k++) sR.frame(p);
  const a = at(p, sR), r = refPick(sR.loaded(), p);
  hits.push(a); if (a !== r) same = false;
}
ok(same, 'pick = reference FUN_00270d08 over the loaded chunks at every route point', hits.join(' '));
ok(hits[0] === 'c1#0', 'start deck: chunk 01 light 0 (the hero-dump light, k 5.5)', hits[0]);
ok(hits[6] === 'c6#7', 'chunk 06 (-1498,-27,1242): chunk 06 light 7', hits[6]);
ok(refPick([1, 2], route[6][0]) !== hits[6], 'chunk 06: differs from the old pick over chunks 1 / 2 only', refPick([1, 2], route[6][0]));
// where scanning every chunk would differ from the loaded pair (the game has no light there)
const s4 = new AreaStream(L.areas, L.start_pair), p4 = P(-1267, -16, 733);
for (let k = 0; k < 3; k++) s4.frame(p4);
const all = Object.keys(L.chunks).map(Number);
ok(at(p4, s4) === 'none' && refPick(all, p4) !== 'none', '(-1267,-16,733) with 4 / 5 loaded: no light 2 (every-chunk scan would find one)', `${at(p4, s4)} vs all ${refPick(all, p4)}`);

// page aid everyChunk (the ?ladder= warp): every chunk until a box's pair has loaded; reset() ends it too
const s5 = new AreaStream(L.areas, L.start_pair);
s5.everyChunk();
ok(s5.loaded().length === 13, 'everyChunk: loaded() = all 13 chunks');
const lad = P(-1503, -10, 1499);
s5.frame(lad); s5.frame(lad);
ok(s5.box(lad) === null && s5.loaded().length === 13, 'ladder 1 warp point is in no box: the aid stays');
const st5 = []; for (let k = 0; k < 4; k++) { s5.frame(route[6][0]); st5.push(s5.loaded().length === 13 ? 'all' : s5.loaded().join('')); }
ok(st5.join() === 'all,all,086,086' || st5.join() === 'all,all,068,068', 'then the (6, 8) box: the aid ends when both are loaded (not before)', st5.join());
s5.everyChunk(); s5.reset(L.start_pair);
ok(s5.loaded().join() === '0,1,2', 'reset() ends the aid (H / Restart)');

// hand cases the z128 data can't reach: a box with flags bit 0 (done) is skipped; type 1 makes no request
const unit = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];         // the unit box at the origin
const s6 = new AreaStream([{ m: unit, type: 0, flags: 1, a: 5, b: 6 }], [1, 2]);
s6.frame(P(0, 0, 0)); s6.frame(P(0, 0, 0));
ok(s6.loaded().join() === '0,1,2', 'hand box with +0x44 bit 0: no request', s6.loaded().join());
const s7 = new AreaStream([{ m: unit, type: 1, flags: 0, a: 5, b: 6 }], [1, 2]);
s7.frame(P(0, 0, 0)); s7.frame(P(0, 0, 0));
ok(s7.loaded().join() === '0,1,2', 'hand box of type 1: no stream request', s7.loaded().join());
const s8 = new AreaStream([{ m: unit, type: 0, flags: 0, a: 5, b: 6 }, { m: unit, type: 0, flags: 0, a: 7, b: 8 }], [1, 2]);
for (let k = 0; k < 3; k++) s8.frame(P(0.5, -0.5, 0));                  // on the faces (inside: |c| <= 0.5); first box wins
ok(s8.loaded().join() === '0,5,6', 'hand: a point on the box face is inside, and the first box wins', s8.loaded().join());
// q < best tie: two lights at the same d^2/k, the first one in scan order is kept (strict <)
const lt = (x, k) => ({ pos: [x, 0, 0], type: 0, spot: [0, 0, 0, 0], rgb: [1, 1, 1], k });
const gA = { size: 50, x0: -100, z0: -100, nx: 4, nz: 4, cells: Array(16).fill([0, 1]), lights: [lt(10, 1), lt(-10, 1)] };
const gB = { size: 50, x0: -100, z0: -100, nx: 4, nz: 4, cells: Array(16).fill([0]), lights: [lt(20, 4)] };
ok(pickLight([gA], P(0, 0, 0)) === gA.lights[0], 'hand: tie inside a cell keeps the first light');
ok(pickLight([gA, gB], P(0, 0, 0)) === gA.lights[0] && pickLight([gB, gA], P(0, 0, 0)) === gB.lights[0], 'hand: tie across slots keeps the earlier slot');
ok(pickLight([gA], P(0, 0, 0), 100.01) === gA.lights[0] && pickLight([gA], P(0, 0, 0), 100) === null, 'hand: q = 100 against the start threshold: 100.01 picks, 100 does not (strict <)');

// Light2 (FUN_005ab0b0 colour / dir + FUN_005ab608): settled start, smoothing at 0.1 / 0.2, settle, no light
const A = { pos: [0, -10, 0], rgb: [0.5, 0.25, 0.125], k: 2 }, B = { pos: [10, 0, 0], rgb: [0.25, 0.5, 0.125], k: 2 };
const o = P(0, 0, 0), l2 = new Light2().update(A, o);
const near = (a, b, e = 1e-12) => a.every((v, i) => Math.abs(v - b[i]) < e);
ok(near(l2.dir, [0, -1, 0]) && near(l2.col, [0.5 * 2, 0.25 * 2, 0.125 * 2]) && l2.s430 === A, 'Light2 first frame: settled on A, colour rgb x k x 100 / d^2', l2.col.join());
l2.update(B, o);
const c1 = [1 + (0.5 - 1) * 0.1, 0.5 + (1 - 0.5) * 0.1, 0.25];
const d1 = [0.2, -0.8, 0].map(v => v / Math.hypot(0.2, 0.8));
ok(near(l2.col, c1) && near(l2.dir, d1) && l2.s430 === A, 'Light2 switch to B: colour 0.1 and dir 0.2 of the way (renormalised), MP+0x430 still A', `${l2.col.map(v => v.toFixed(3))} / ${l2.dir.map(v => v.toFixed(3))}`);
let n = 1; while (l2.s430 !== B && n < 200) { l2.update(B, o); n++; }
ok(l2.s430 === B && n > 10 && n < 100, 'Light2 settles on B after a few dozen frames', `${n} frames`);
l2.update(null, o);
ok(l2.s430 === B && l2.col.some(v => v > 0.1), 'Light2 to no light: smoothed toward 0, not cut', l2.col.map(v => v.toFixed(3)).join());

process.exit(bad ? 1 : 0);
