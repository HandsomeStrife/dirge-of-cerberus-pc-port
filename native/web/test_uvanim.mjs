// test_uvanim.mjs -- the room's scrolling UVs (worker 0226; room.js RoomUVAnim, bmd_uvanim.py,
// notes/room-blend-streaming.md "Scrolling UVs"):
//   1. RAM: for each save state fixture (tools/trace/uvanim_fixture.py -> tools/trace/out/room_grade/uvanim_NAME.json),
//      the page's frame loop from a chunk's load (time 0, 0.6 per frame, PS2 round-toward-zero adds) reaches the
//      slot's RAM time exactly, and its node offsets then equal the RAM's node +0xdc / +0xde (s16) on every node
//      of every loaded chunk. Chunks whose time is not a whole number of steps from 0 (chunk 00: the stage load /
//      opening event) are checked with the RAM time put into the page's slot directly.
//   3. hand cases: Hermite basis, the (short) wrap, the loop, the time reset on reload (section 3 below).
//   4. the key layout against the decomp (needs elf/SLES_541.85): every track's curves evaluated the way
//      FUN_00262328 addresses a key (byte offsets in the curve: value +8 + 16 i, key i's tangent +16 + 16 i, key i+1's
//      +12 + 16 (i + 1); bmd_uvanim.read_curve keeps a key's 4 floats in file order) with the Hermite rows read
//      from the ELF at DAT_0046be50, at the middle of every segment, = room.js evalCurve; z128's tangents have
//      in = out within 4e-9, so a synthetic curve with in != out checks the order.
//   2. GS dump (c0b, frames 0..3): dump UV - file UV of each matched ff88 node = the page's offset (frame 0 = the
//      RAM state's offsets; frame k = the k-th page frame after it).
// Run: node --import ./native/web/test_hooks.mjs native/web/test_uvanim.mjs (needs data/scene.json with uvanim)
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RoomUVAnim, evalCurve } from './room.js';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = process.env.ROOM_GRADE || join(here, '../../tools/trace/out/room_grade');
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const scene = JSON.parse(readFileSync(join(here, 'data/scene.json'), 'utf8'));
if (!scene.uvanim) { console.log('FAIL scene.json has no uvanim (re-run export_web_room.py)'); process.exit(1); }
const { anims, tracks } = scene.uvanim;
ok(tracks.length > 0, `scene.uvanim: ${anims.length} animations, ${tracks.length} tracks`);
const trackOf = (c, node) => tracks.findIndex(t => anims[t.anim].chunk === c && t.node === node);

const MAXF = 20000;
for (const name of ['c0b', 'c09']) {
  const f = join(FIX, `uvanim_${name}.json`);
  if (!existsSync(f)) { console.log(`SKIP ${name}: no ${f} (tools/trace/uvanim_fixture.py)`); continue; }
  const fx = JSON.parse(readFileSync(f, 'utf8'));
  const ua = new RoomUVAnim(scene.uvanim);
  const chunks = fx.slots.map(s => s.chunk);
  // the RAM time of each animation the page plays
  const want = new Map();
  for (const s of fx.slots) for (const ai of ua.byChunk.get(s.chunk) || []) want.set(ai, Math.fround(s.times[anims[ai].index]));
  // run frames from load until each chunk's first animation reaches its RAM time
  const reached = new Map(), stepsTo = new Map();
  ua.frame(chunks);
  let n = 1;
  for (; n < MAXF && reached.size < chunks.length; n++) {
    for (const c of chunks) {
      const T = ua.time.get(c), list = ua.byChunk.get(c);
      if (!T || reached.has(c)) { if (!T) reached.set(c, null); continue; }
      if (T[0] === want.get(list[0])) { reached.set(c, ua.node.slice()); stepsTo.set(c, n); }
    }
    ua.frame(chunks);
  }
  const direct = new RoomUVAnim(scene.uvanim);     // the unreached chunks: RAM time minus one step, put in directly
  direct.frame(chunks, 0);
  for (const c of chunks) {
    if (reached.get(c) !== undefined) continue;
    const T = direct.time.get(c);
    if (!T) continue;
    direct.byChunk.get(c).forEach((ai, k) => { T[k] = Math.fround(want.get(ai) - Math.fround(0.6)); });
    console.log(`     ${name} chunk ${c}: RAM time ${want.get(direct.byChunk.get(c)[0])} is not n x 0.6 from load; checked directly`);
  }
  direct.frame(chunks);
  for (const c of chunks) if (stepsTo.has(c)) console.log(`     ${name} chunk ${c}: RAM time reached after ${stepsTo.get(c)} frames`);
  let good = 0, bad = [];
  for (const nd of fx.nodes) {
    const ti = trackOf(nd.chunk, nd.node);
    if (ti < 0) { bad.push(`${nd.chunk}/${nd.node}: no track`); continue; }
    const node = reached.get(nd.chunk) || direct.node;
    for (const [k, v] of [[0, nd.u], [1, nd.v]]) {
      if (v == null) continue;
      if (node[2 * ti + k] === v) good++; else bad.push(`${nd.chunk}/${nd.node}${'uv'[k]}: page ${node[2 * ti + k]} RAM ${v}`);
    }
  }
  ok(bad.length === 0, `${name}: node offsets = RAM: ${good} / ${good + bad.length}${bad.length ? ' ' + bad.slice(0, 6).join(', ') : ''}`);
  ok([...stepsTo.values()].length >= 1, `${name}: at least one chunk's RAM time reached by stepping from load (${[...stepsTo].map(([c, k]) => c + ':' + k).join(' ')})`);

  // 2. the dump's frames: the RAM state's offsets, then one page frame each
  if (fx.dump.length && fx.dump.some(fr => fr.length)) {
    const ud = new RoomUVAnim(scene.uvanim);
    ud.frame(chunks, 0);
    for (const c of chunks) { const T = ud.time.get(c); if (T) ud.byChunk.get(c).forEach((ai, k) => { T[k] = want.get(ai); }); }
    let worst = 0, cnt = 0, nf = 0;
    for (let k = 0; k < fx.dump.length; k++) {
      const off = k === 0 ? null : (ud.frame(chunks), ud.off);
      for (const m of fx.dump[k]) {
        const ti = trackOf(m.chunk, m.node);
        let pu, pv;
        if (k === 0) {
          const r = fx.nodes.find(x => x.chunk === m.chunk && x.node === m.node);
          pu = (r.u ?? 0) * 0.00024414062; pv = (r.v ?? 0) * 0.00024414062;
        } else { pu = off[2 * ti]; pv = off[2 * ti + 1]; }
        worst = Math.max(worst, Math.abs(m.du - pu), Math.abs(m.dv - pv)); cnt++;
      }
      nf++;
    }
    ok(worst < 1e-3, `${name}: dump UV - file UV = the offsets on ${cnt} node-frames over ${nf} frames (worst ${worst.toExponential(2)})`);
  }
}
// 3. hand cases for paths the save states do not reach (one synthetic chunk 5, one track):
//    u: keys (0, 0, 0, 0), (10, 1, 0, 0) (flat tangents: the Hermite basis, DAT_0046be50, not a lerp)
//    v: 0 -> -15 over 300 (the stored -v * 4096 passes 32767: FUN_0026c198's (short) cast wraps it)
{
  const ua = new RoomUVAnim({ anims: [{ index: 0, loop: true, chunk: 5 }],
    tracks: [{ anim: 0, node: 0, u: [[0, 0, 0, 0], [10, 1, 0, 0]], v: [[0, 0, -0.05, -0.05], [300, -15, -0.05, -0.05]] }] });
  const T = () => ua.time.get(5);
  ua.frame([5], 0); T()[0] = 2.5; ua.frame([5], 0);
  ok(ua.node[0] === Math.trunc(Math.fround(0.15625 * 4096)), `Hermite: u(2.5) = 3s^2 - 2s^3 at s 0.25 (0.15625 x 4096 = 640; page ${ua.node[0]})`);
  T()[0] = 250; ua.frame([5], 0);
  ok(ua.node[1] === -14336 && Math.abs(ua.off[1] + 3.5) < 1e-6, `short wrap: v(250) = -12.5 -> (short)51200 = -14336 (page ${ua.node[1]}, offset ${ua.off[1]})`);
  T()[0] = 310; ua.frame([5], 0);
  ok(ua.node[1] === 2048, `loop: t 310 = fmodf(310, 300) = 10 -> v -0.5 -> 2048 (page ${ua.node[1]})`);
  ua.frame([], 1.2); ua.frame([5], 1.2);
  ok(ua.node[1] === 0 && T()[0] === Math.fround(0.6), `reload: an unloaded chunk's time is freed (FUN_002681b0) and zeroed on load (FUN_002680e0): v ${ua.node[1]}, t ${T()[0]}`);
}
// 4. key layout vs the decomp
{
  const ELF = process.env.DIRGE_ELF || join(here, '../../elf/SLES_541.85');   // DIRGE_ELF: for a copy of this test (mutation runs)
  if (!existsSync(ELF)) console.log('SKIP key layout: no elf/SLES_541.85');
  else {
    const e = readFileSync(ELF), dv = new DataView(e.buffer, e.byteOffset, e.byteLength);
    const phoff = dv.getUint32(0x1c, true), phsz = dv.getUint16(0x2a, true), phn = dv.getUint16(0x2c, true);
    const at = va => { for (let k = 0; k < phn; k++) { const h = phoff + k * phsz, off = dv.getUint32(h + 4, true), v = dv.getUint32(h + 8, true), sz = dv.getUint32(h + 16, true);
      if (va >= v && va < v + sz) return off + va - v; } throw new Error('vaddr 0x' + va.toString(16) + ' not in the ELF'); };
    const M = [0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => dv.getFloat32(at(0x46be50 + 16 * r + 4 * c), true)));
    ok(M.flat().join() === '2,-2,1,1,-3,3,-2,-1,0,0,1,0,1,0,0,0', `DAT_0046be50 from the ELF: ${M.map(r => r.join(' ')).join(' / ')}`);
    // FUN_00262328: (curve +8 + 16 i, curve +8 + 16 (i + 1), (curve +16 + 16 i) x dt, (curve +12 + 16 (i + 1)) x dt)
    // . (M0 s^3 + M1 s^2 + M2 s + M3); keys start at curve +4, 16 bytes each -> float index (byte - 4 - 16 k) / 4
    const F = (K, byte) => { const k = Math.floor((byte - 4) / 16); return K[k][(byte - 4 - 16 * k) / 4]; };
    const decomp = (K, i, t) => {
      const dt = Math.fround(F(K, 4 + 16 * (i + 1)) - F(K, 4 + 16 * i)), s = Math.fround(Math.fround(t - F(K, 4 + 16 * i)) / dt);
      const b = [0, 1, 2, 3].map(c => M[0][c] * s * s * s + M[1][c] * s * s + M[2][c] * s + M[3][c]);
      const x = [F(K, 8 + 16 * i), F(K, 8 + 16 * (i + 1)), Math.fround(F(K, 16 + 16 * i) * dt), Math.fround(F(K, 12 + 16 * (i + 1)) * dt)];
      return b[0] * x[0] + b[1] * x[1] + b[2] * x[2] + b[3] * x[3];
    };
    let n = 0, worst = 0, differ = 0;
    for (const tr of tracks) for (const K of [tr.u, tr.v]) {
      if (!K) continue;
      for (let i = 0; i + 1 < K.length; i++) {
        if (!(K[i + 1][0] > K[i][0])) continue;
        differ += K[i][2] !== K[i][3];
        for (const f of [0.3, 0.5, 0.7]) {
          const t = Math.fround(K[i][0] + f * (K[i + 1][0] - K[i][0]));
          worst = Math.max(worst, Math.abs(evalCurve(K, t, false) - decomp(K, i, t))); n++;
        }
      }
    }
    ok(n > 1000 && differ > 100 && worst < 1e-4, `key layout: evalCurve = the decomp's key addressing at ${n} mid-segment times (${differ} keys with in != out; worst ${worst.toExponential(2)})`);
    // z128's in / out tangents differ by float noise only (<= 4e-9), so a swap is invisible on its data: a synthetic
    // curve with in != out, through the same decomp addressing
    const H = [[0, 0, 7, -3], [10, 1, -5, 4], [16, -2, 2, 9]];
    let hw = 0, hn = 0;
    for (let i = 0; i < 2; i++) for (const f of [0.25, 0.5, 0.75]) { const t = Math.fround(H[i][0] + f * (H[i + 1][0] - H[i][0])); hw = Math.max(hw, Math.abs(evalCurve(H, t, false) - decomp(H, i, t))); hn++; }
    ok(hw < 1e-5, `key layout: a curve with in != out tangents (key [time, value, in, out]) = the decomp at ${hn} times (worst ${hw.toExponential(2)})`);
  }
}
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
