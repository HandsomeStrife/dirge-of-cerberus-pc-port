// test_room_vis.mjs -- the room's camera-driven visibility mask (worker 0225; room_vis.js, notes/room-blend-streaming.md
// 'Review fixes' 3a): FUN_00264ee0's probe (0x10f, 100 down from the eye) against DAT_004e86f0 in every save state of
// tools/trace/out/room_vis/states.json (tools/trace/room_vis_fixture.py: the start save, the route states, the chunk
// 06 / 09 / 0b teleports), hand cases of FUN_0026f8a0's rules, the shared mask in room.js showChunks and in the stage
// effects' cull (effects.js `mask`).
// Run: node --import ./native/web/test_hooks.mjs native/web/test_room_vis.mjs   (needs data/z128_vis.json from
// native/assets/collision/cidvis; the state and effect checks are skipped without their data)
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRoomVis, createVisMask } from './room_vis.js';
import { visibleRanges } from './room.js';

const here = dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const D = join(here, 'data');
const VIS = process.env.VIS_DATA || join(D, 'z128_vis.json');
if (!existsSync(VIS)) { console.log('SKIP: no data/z128_vis.json (build step room_vis)'); process.exit(0); }
const visData = JSON.parse(readFileSync(VIS, 'utf8'));
const vis = createRoomVis(visData);
const bitsOf = w => { const r = []; for (let b = 0; b < 128; b++) if (w[b >> 5] >>> (b & 31) & 1) r.push(b); return r; };

// 1. the data: class-0x80 packets of chunks 01 / 03 / 05 / 06 / 07 / 08 / 0b (worker 0213: 302 triangles)
{
  const n = visData.chunks.reduce((s, c) => s + c.tris.length, 0);
  const with_ = visData.chunks.filter(c => c.tris.length).map(c => c.chunk);
  ok(n === 302 && with_.join() === '1,3,5,6,7,8,11', `probe triangles: ${n} in chunks ${with_} (want 302 in 1,3,5,6,7,8,11)`);
  ok(visData.chunks.every(c => c.tris.every(t => (t[0] & ~0x10f) !== 0)), 'every exported packet passes FUN_0026f8a0\'s mask test');
}

// 2. the save states: probe from DAT_004e4800 (the eye FUN_00264ee0 stored) over the loaded slots = DAT_004e86f0
const SF = join(here, '../../tools/trace/out/room_vis/states.json');
let states = [];
if (!existsSync(SF)) console.log('  (no tools/trace/out/room_vis/states.json: run tools/trace/room_vis_fixture.py; state checks skipped)');
else {
  states = JSON.parse(readFileSync(SF, 'utf8'));
  for (const s of states) {
    const loaded = s.slots.filter(x => x.loaded && x.cid).map(x => x.chunk);
    const r = vis.probe(s.eye, loaded);
    ok(r.mask.join() === s.m86f0.join(), `${s.name}: probe in chunks ${loaded} hits ${r.hit ? `chunk ${r.hit.chunk} entry ${r.hit.index} t ${r.hit.t.toFixed(3)}` : 'nothing'} -> {${bitsOf(r.mask)}} (game {${bitsOf(s.m86f0)}})`);
    const m = createVisMask(); m.setCamera(r.mask); for (const b of bitsOf(s.m8700)) m.setScript(b, true);
    ok(m.words().join() === s.m8710.join(), `${s.name}: DAT_004e8710 = 86f0 | 8700 (FUN_00269410)`);
  }
  ok(states.length >= 8 && new Set(states.map(s => s.m86f0.join())).size >= 4, `${states.length} states, ${new Set(states.map(s => s.m86f0.join())).size} different masks`);
}

// 3. FUN_0026f8a0's rules on hand data: nearest hit (t <= 1, t < best), packet mask & ~0x10f, header[3] range
{
  const tri = (mask, idx, y) => [mask, idx, -10, y, -10, 10, y, -10, 0, y, 10];
  const mk = chunks => createRoomVis({ probe: { class: 0x10f, dy: 100 }, chunks });
  const A = [1, 0, 0, 0], B = [2, 0, 0, 0], C = [4, 0, 0, 0];
  const v = mk([{ chunk: 1, table: [A, B, C], tris: [tri(0x180, 0, 50), tri(0x180, 1, 20), tri(0x10f, 2, 10), tri(0x180, 7, 5)] },
                { chunk: 2, table: [A, B, C], tris: [tri(0x80, 2, 150)] }]);
  const e = [0, 0, 0];
  // nearest valid is t 0.2 (entry 1); t 0.1 is class 0x10f only (skipped); t 0.05 has index 7, out of range: best t
  // moves but DAT_004e8880 keeps entry 1 (only an in-range index copies)
  const r = v.probe(e, [1]);
  ok(r.mask.join() === B.join() && Math.abs(r.hit.t - 0.05) < 1e-9, `nearest hit wins, class-0x10f packet skipped, out-of-range index keeps the entry (${r.mask} t ${r.hit && r.hit.t})`);
  ok(v.probe(e, [2]).mask.join() === '0,0,0,0', 'a hit past t = 1 (150 below, ray 100): no hit, mask 0');
  ok(v.probe(e, []).mask.join() === '0,0,0,0', 'no loaded slot: mask 0 (FUN_00269400(0))');
  ok(v.probe([0, 60, 0], [1]).mask.join() === '0,0,0,0', 'the ray goes down (+y): a surface above the eye is not hit');
  ok(v.probe([30, 0, 0], [1]).mask.join() === '0,0,0,0', 'outside the triangles: no hit');
}

// 4. the mask object (FUN_00269450: bit b of 86f0 | 8700; a byte > 0x7f never hidden)
{
  const m = createVisMask();
  m.setCamera([0, 0, 0x20, 0x80000000]);
  ok(m.has(69) && m.has(127) && !m.has(68) && !m.has(255) && !m.has(-1), 'camera half: bits 69 / 127 set, 255 never');
  m.setScript(3, true); ok(m.has(3) && m.words()[0] === 8, 'script half (cmd 0x55 -> FUN_00269368)');
  m.setCamera([0, 0, 0, 0]); ok(m.has(3) && !m.has(69), 'a new probe replaces only the camera half');
  m.setScript(3, false); ok(!m.has(3), 'cmd 0x54 clears it (FUN_002693a8)');
}

// 5. the room: scene.json ranges hidden by the chunk-09 state's mask (worker 0213's report: the game hides 3 / 22 / 47 / 69
// there and shows 0 / 19 / 25 / 56, which the export used to drop)
if (existsSync(join(D, 'scene.json')) && states.length) {
  const scene = JSON.parse(readFileSync(join(D, 'scene.json'), 'utf8'));
  const room = scene.draws.filter(d => d.kind === 'room' && d.chunks);
  const s = states.find(x => x.name.startsWith('tp09'));
  if (s) {
    const loaded = s.slots.map(x => x.chunk), want = new Set(loaded);
    const m = createVisMask(); m.setCamera(vis.probe(s.eye, loaded).mask);
    const verts = (g, mask) => room.reduce((n, d) => n + visibleRanges(d.chunks.filter(r => r[3] === g), want, mask).reduce((a, r) => a + r[1], 0), 0);
    const all = g => room.reduce((n, d) => n + d.chunks.filter(r => r[3] === g && want.has(r[0])).reduce((a, r) => a + r[2], 0), 0);
    const hidden = [3, 22, 47, 69].filter(g => all(g) > 0), shown = [0, 19, 25, 56].filter(g => all(g) > 0);
    ok(hidden.length >= 2 && hidden.every(g => verts(g, m) === 0), `chunk 09: groups ${hidden} have loaded vertices and none is drawn`);
    ok(shown.length >= 1 && shown.every(g => verts(g, m) === all(g)), `chunk 09: groups ${shown} (the old fixed mask) are drawn (${shown.map(g => all(g))} vertices)`);
    const st = states.find(x => x.name.startsWith('sea-of-flames'));
    const m0 = createVisMask(); m0.setCamera(vis.probe(st.eye, st.slots.map(x => x.chunk)).mask);
    ok([0, 19, 25, 56, 57].every(g => verts(g, m0) === 0) && verts(69, m0) === all(69), 'start deck: groups 0 / 19 / 25 / 56 / 57 hidden (the old fixed mask), 69 not (occluders, not ported)');
  }
}

// 6. the stage effects' cull reads the same mask (effects.js `mask`; FUN_002ea6a0 copies FUN_00269498() = DAT_004e8710)
{
  const ED = join(D, 'effects');
  const ids = existsSync(join(ED, 'ids.json')) ? JSON.parse(readFileSync(join(ED, 'ids.json'), 'utf8')) : null;
  if (!ids || !(ids.stage || []).length || !ids.stage.every(n => existsSync(join(ED, n)))) console.log('  (no stage FEDs in data/effects: effect checks skipped)');
  else {
    const { createEffects } = await import('./effects.js');
    const rd = p => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
    const stage = ids.stage.map(n => rd(join(ED, n))), core = rd(join(ED, 'core_ef.bin'));
    const m = createVisMask();
    const fx = createEffects({ fed: stage[0], stage, core, rand: ids.rand, cull: true, mask: m, models0: true, warn: () => {} });
    const ems = fx.stageLoad();
    const e = ems.find(x => x.ei === 15) ?? ems[0];
    const f = Math.fround, V = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1282.8, 56.8, 1024, 1]);
    const view = { toView: p => [0, 1, 2].map(j => f(f(f(p[0] * V[j]) + f(p[1] * V[4 + j])) + f(f(p[2] * V[8 + j]) + V[12 + j]))),
      toViewMatrix: () => V, eye: [0, 1, 2].map(i => -(V[12] * V[4 * i] + V[13] * V[4 * i + 1] + V[14] * V[4 * i + 2])) };
    const cell = 27;
    m.setCamera([0, cell >= 32 ? 1 << (cell - 32) : 0, 0, 0].map((x, k) => k === 0 && cell < 32 ? 1 << cell : x));
    fx.end(view); const hid = e.f0a & 0x100;
    m.setCamera([0, 0, 0, 0]); fx.end(view); const shown = e.f0a & 0x100;
    fx.cellMask(cell, true); const script = m.has(cell);
    fx.reset(); const cleared = !m.has(cell);
    ok(hid === 0x100 && shown === 0, `the camera half culls emitter ${e.ei}'s cell ${cell} (0x100), a probe without it shows it (${hid} ${shown})`);
    ok(script && cleared, 'cellMask writes the shared script half; reset clears it (GUESS start: empty)');
  }
}

console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
