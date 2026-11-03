// The room's camera-driven visibility mask (worker 0225; decoded by worker 0213, notes/room-blend-streaming.md
// 'Review fixes' 3a). No three.js: node tests import it.
//
// FUN_00264ee0 (every frame, from the room draw FUN_00264f68, before the chunk stream FUN_0026a0c0):
//   eye = translation of the inverse of the camera matrix 0x4fcb10 (FUN_00444b50)
//   FUN_00269400(0)                                       DAT_004e86f0 = 0
//   if (FUN_0026a320(eye, eye + (0, 100, 0), 0x10f))      ray through every loaded slot's cid
//     FUN_00269400(FUN_0026f1f8())                        DAT_004e86f0 = DAT_004e8880 (16 bytes)
//   FUN_00269410()                                        DAT_004e8710 = DAT_004e86f0 | DAT_004e8700
// FUN_0026a320: FUN_00271408 (best t DAT_004e88a4 = 10.0, class DAT_004e8898 = 0x10f | 0x100, entry
// DAT_004e8880 = 0), then slots 0..2 of DAT_004e4c60 (loaded: +0x5c, cid +0x44) in order, each through
// FUN_002714d0 -> FUN_00270088 (the +0x58 sub-tree) -> FUN_0026f8a0 per tag-2 packet: tested only when the
// packet mask (pkt+0x08) has a bit outside DAT_004e8898; a hit with t <= 1 and t < best becomes best, and
// when the packet's header[3] (VU0 vi3) is in 0 .. table count - 1 the cid's surface table entry (+0x24,
// 16 bytes) is copied to DAT_004e8880. Data: native/assets/collision/cidvis -> data/z128_vis.json (the
// class-0x80 packets of z128 are the only ones the test passes; the +0x58 sub-trees hold no tag-0 faces,
// FUN_0026f750, which would also move the best t).
// The mask: 4 u32 words, bit b = word b >> 5, bit b & 31 (DAT_004e86f0 / f4 / f8 / fc; FUN_00269450).

// Ray (eye, eye + d) against triangle (a, b, c); returns t in [0, 1] or -1. Two-sided.
// GUESS: the VU0 micro routine at 0xa90 (FUN_0026f8a0's vcallms) is not translated; this test reproduces
// DAT_004e86f0 in the 9 save states (test_room_vis.mjs), its float rounding is not the VU's.
function rayTri(e, dy, T, o) {
  const ax = T[o + 2], ay = T[o + 3], az = T[o + 4];
  const e1x = T[o + 5] - ax, e1y = T[o + 6] - ay, e1z = T[o + 7] - az;
  const e2x = T[o + 8] - ax, e2y = T[o + 9] - ay, e2z = T[o + 10] - az;
  // h = d x e2 with d = (0, dy, 0)
  const hx = dy * e2z, hy = 0, hz = -dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  if (Math.abs(det) < 1e-9) return -1;
  const f = 1 / det;
  const sx = e[0] - ax, sy = e[1] - ay, sz = e[2] - az;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return -1;
  const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
  const v = f * (qy * dy);
  if (v < 0 || u + v > 1) return -1;
  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  return t >= 0 && t <= 1 ? t : -1;
}

// The stage load's slots: chunk 00 + the pair (1, 2) (FUN_003ff7a8(0x80, 1, 2) -> FUN_002673d8; worker 0213,
// area_stream.js start_pair). The start mask = the probe from the start camera's eye over these (startMask).
export const START_SLOTS = [0, 1, 2];

export function createRoomVis(data) {
  const byChunk = new Map();
  for (const c of data.chunks) {
    const T = new Float64Array(c.tris.length * 11);
    c.tris.forEach((t, i) => T.set(t, i * 11));     // [mask, index, ax, ay, az, bx, by, bz, cx, cy, cz]
    byChunk.set(c.chunk, { table: c.table, T, n: c.tris.length });
  }
  const cls = (data.probe?.class ?? 0x10f) | 0x100;  // FUN_00271408: param | 0x100
  const dy = data.probe?.dy ?? 100;                  // FUN_00264ee0: eye + (0, 100, 0)
  // FUN_00264ee0 for one frame: eye = the camera eye, loaded = the chunks of the loaded slots, in slot order
  // (AreaStream.loaded()). Returns DAT_004e86f0 as 4 words, plus the hit (for tests).
  function probe(eye, loaded) {
    let best = 10.0, entry = null, hit = null;          // DAT_004e88a4 = 0x41200000, DAT_004e8880 = 0
    for (const ch of loaded) {
      const c = byChunk.get(ch);
      if (!c) continue;
      for (let i = 0; i < c.n; i++) {
        const o = i * 11;
        if ((c.T[o] & ~cls) === 0) continue;          // FUN_0026f8a0: mask & ~DAT_004e8898
        const t = rayTri(eye, dy, c.T, o);
        if (t < 0 || !(t < best)) continue;           // fVar2 <= 1.0 && fVar2 < DAT_004e88a4
        best = t;
        const idx = c.T[o + 1];
        hit = { chunk: ch, index: idx, t };
        if (idx >= 0 && idx < c.table.length) entry = c.table[idx];
      }
    }
    return { mask: entry ? entry.slice() : [0, 0, 0, 0], hit };
  }
  return { probe, chunks: [...byChunk.keys()] };
}

// The mask at the stage start, for views that do not run the per-frame probe (main.js, play.js without area
// boxes, the native renderer's room.list): FUN_00264ee0 from `eye` over the stage load's slots.
export function startMask(vis, eye, slots = START_SLOTS) {
  const m = createVisMask();
  if (vis && eye) m.setCamera(vis.probe(eye, slots).mask);
  return m;
}

// The global mask DAT_004e8710 = DAT_004e86f0 (the probe) | DAT_004e8700 (stage scripts, cmds 0x54 / 0x55:
// FUN_00545b20 -> FUN_002693a8 / FUN_00269368). One object shared by the room (room.js showChunks) and the
// stage effects' cull (effects.js FUN_002ea6a0), as in the game.
export function createVisMask() {
  const cam = [0, 0, 0, 0], script = [0, 0, 0, 0];
  const word = b => b >> 5, bit = b => (1 << (b & 31)) >>> 0;
  return {
    cam, script,
    setCamera(m) { for (let k = 0; k < 4; k++) cam[k] = m[k] >>> 0; },              // FUN_00269400
    setScript(b, on) {                                                              // FUN_002693a8 / FUN_00269368
      if (b < 0 || b > 0x7f) return;
      if (on) script[word(b)] = (script[word(b)] | bit(b)) >>> 0; else script[word(b)] = (script[word(b)] & ~bit(b)) >>> 0;
    },
    clearScript() { script.fill(0); },
    word(k) { return (cam[k] | script[k]) >>> 0; },                                 // DAT_004e8710 word k
    // FUN_00269450: a byte > 0x7f is never hidden
    has(b) { return b >= 0 && b <= 0x7f && ((cam[word(b)] | script[word(b)]) & bit(b)) !== 0; },
    words() { return [0, 1, 2, 3].map(k => (cam[k] | script[k]) >>> 0); },
    bits() { const r = []; for (let b = 0; b < 128; b++) if (this.has(b)) r.push(b); return r; },
  };
}
