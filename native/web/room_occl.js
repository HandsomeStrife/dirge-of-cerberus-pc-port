// room_occl.js -- the room's occluder culling (worker 0233; notes/room-blend-streaming.md 'Occluder culling').
//
// Every frame, in the room draw FUN_00264f68 after the visibility probe (FUN_00264ee0):
//   FUN_00269868: DAT_0046bff8 = 0; for each loaded slot (DAT_004e4c60, 3 x 0x70) FUN_00268b58 -> FUN_0026c878 per model:
//     for each occluder quad (model +0x18; bmd_occl.py) that passes
//       FUN_0040d6f8 (not all 4 corners outside one plane of the view-clip matrix 0x4fcbd0 x 0x4fcb10) and
//       FUN_0026c728 (corners 0, 1, 2 through view-screen 0x4fcb50 x 0x4fcb10: some w < 0.1, or the screen cross
//       |(p1 - p0) x (p1 - p2)|.z >= 4096 after the divide),
//     a volume of 5 planes (0x50 bytes at DAT_004e5db0, at most 15: the 16th quad ends the build): the four planes
//     through the eye and each edge, ring 0 -> 1 -> 3 -> 2, n = (a - b) x (a - eye), w = -n.eye; the quad's own plane
//     n = (c0 - c2) x (c0 - c1), w = -n.c0; all five negated when the eye is on or in front of the own plane
//     (n.eye + w >= 0). FUN_00444b08 transposes the first four for the test.
//   FUN_0026ccc8 (the bone-tree walk): a child node is skipped with its whole sub-tree when FUN_00269978(node, 8): all
//     8 box corners inside one volume. FUN_002698d0: inside = own plane >= 0 (w + x + y + z on VU0), then the four
//     side planes (x . col0 + y . col1 + z . col2 + col3) all >= 0 (MAC sign flags). The root is never tested.
// The frustum box tests of nodes and chains (FUN_0026cc80, VU0 micro 0x6d8) are not ported: they drop only what the
// page's renderer clips anyway (notes).
//
// The view: the camera matrix 0x4fcb10 of the frame's room draw (the last frame's camera, as the probe), as a
// row-vector world -> game view matrix (effects.js cameraView: x right, y down, z forward). The clip / screen matrices
// are FUN_00263a48 / FUN_00263c70 from the display struct 0x4fc7d0 (FUN_0040d478; z128 save values: scrz +0x304,
// ay +0x2f8 1.5, cx / cy +0x320 / +0x324 + 2048, near +0x2c 1, +0x308 1, far +0x30c 30000, screen +0x2e8 / +0x2ec
// 448 / 512).
//
// createRoomOccl(scene.occl) -> { frame(V, loaded), dropped(chunk), inside(pts, n), count, volumes, version }
//   frame: V = Float32Array(16) row-vector world -> view (cameraView(cam).toViewMatrix()), loaded = the chunks of the
//   loaded slots in slot order (AreaStream.loaded(), or every chunk), fov = the rendered camera's horizontal fov in degrees
//   (default the gameplay 73.5). Allocates nothing.
//   dropped(chunk): Uint8Array per tree node, 1 = not drawn (occluded or under an occluded node); null = no tree.
//   inside(pts, n): FUN_00269978 on n points (flat xyz) against this frame's volumes (the stage effects' cull).

const f = Math.fround;
const RING = [1, 0, 3, 1, 2, 3, 0, 2];       // the side planes' edges (a, b): ring 0 -> 1 -> 3 -> 2
const MAXV = 15;                                  // FUN_0026c878: if (0xe < DAT_0046bff8) return
// display struct 0x4fc7d0 (z128): FUN_0040d478's arguments
const SCR_W = 448, FOV = 73.5, AY = 1.5;          // +0x2e8, +0x300 (the gameplay fov), +0x2f8 (output.js uses the same)
const SCR_H = 512, NEAR = 1, FAR = 30000;          // +0x2ec, max(+0x2c, +0x308), +0x30c
const CLZ = f((FAR + NEAR) / (FAR - NEAR)), CLW = f((FAR * NEAR * -2) / (FAR - NEAR));

export function createRoomOccl(data) {
  const byChunk = new Map();
  for (const c of (data && data.chunks) || []) {
    const n = c.parent.length;
    byChunk.set(c.chunk, {
      parent: Int32Array.from(c.parent), box: Float32Array.from(c.box), quads: Float32Array.from(c.quads),
      nq: c.quads.length / 12, drop: new Uint8Array(n), n,
    });
  }
  const vol = new Float32Array(MAXV * 20);        // per volume: 4 side planes (nx, ny, nz, w), the own plane
  const t = new Float32Array(16);                 // scratch: view-space corners / edge vectors
  const st = { count: 0, version: 0 };
  const eye = new Float32Array(3);
  // FUN_003ee1d8 (the rendered view) -> FUN_0040d470: +0x300 = view +0x40, the live fov (CAM+0x170 or the event camera's); the
  // display's frame FUN_0040ce28: +0x304 = 448 / 2 / tan(+0x300 x 0.008726647) (save 299.97235), then FUN_0040d478's matrices.
  // FUN_00263a48: view -> clip (x, y scales; z row) and FUN_00263c70: view -> screen (x, y scales; w = z)
  let lastFov = null, CLX = 0, CLY = 0, SX = 0, SY = 0;   // screen: x' = SX x + cx z, y' = SY y + cy z, w = z (cx, cy cancel)
  function setFov(fov) {
    if (fov === lastFov) return;
    lastFov = fov;
    const SCRZ = f(SCR_W * 0.5 / Math.tan(fov * 0.008726647));
    CLX = f(SCRZ / SCR_W); CLY = f(SCRZ / SCR_H); SX = SCRZ; SY = f(AY * SCRZ);
  }
  setFov(FOV);

  // a world point through V (row vector), view space into t[o..o+2]
  function toView(V, x, y, z, o) {
    t[o] = f(f(f(f(V[0] * x) + f(V[4] * y)) + f(V[8] * z)) + V[12]);
    t[o + 1] = f(f(f(f(V[1] * x) + f(V[5] * y)) + f(V[9] * z)) + V[13]);
    t[o + 2] = f(f(f(f(V[2] * x) + f(V[6] * y)) + f(V[10] * z)) + V[14]);
  }
  // FUN_0040d6f8: the AND of the corners' CLIP flags through the view-clip matrix (x: CLX x, y: CLY y,
  // z: CLZ z + CLW, w = z); true = all four outside one plane (skip the quad)
  function clipOut(V, q, o) {
    let all = 0x3f;
    for (let k = 0; k < 4; k++) {
      toView(V, q[o + 3 * k], q[o + 3 * k + 1], q[o + 3 * k + 2], 0);
      const X = f(t[0] * CLX), Y = f(t[1] * CLY), Z = f(f(t[2] * CLZ) + CLW), W = Math.abs(t[2]);
      all &= (X > W ? 1 : 0) | (X < -W ? 2 : 0) | (Y > W ? 4 : 0) | (Y < -W ? 8 : 0) | (Z > W ? 0x10 : 0) | (Z < -W ? 0x20 : 0);
    }
    return all !== 0;
  }
  // FUN_0026c728: false (build the volume) when a corner's w < 0.1; else true when the screen triangle 0, 1, 2 is small
  function tooSmall(V, q, o) {
    for (let k = 0; k < 3; k++) {
      toView(V, q[o + 3 * k], q[o + 3 * k + 1], q[o + 3 * k + 2], 4 * k);
      if (t[4 * k + 2] < f(0.1)) return false;
    }
    for (let k = 0; k < 3; k++) {                 // x 1 / w (cx, cy drop out of the differences below)
      const r = f(1 / t[4 * k + 2]);
      t[4 * k] = f(f(SX * t[4 * k]) * r); t[4 * k + 1] = f(f(SY * t[4 * k + 1]) * r);
    }
    const ax = f(t[4] - t[0]), ay = f(t[5] - t[1]), bx = f(t[4] - t[8]), by = f(t[5] - t[9]);
    return Math.abs(f(f(ax * by) - f(ay * bx))) < 4096;
  }
  // one plane: n = (a - b) x (a - c), w = -n . p; into vol[o..o+3]
  function plane(o, ax, ay, az, bx, by, bz, cx, cy, cz, px, py, pz) {
    const ux = f(ax - bx), uy = f(ay - by), uz = f(az - bz), vx = f(ax - cx), vy = f(ay - cy), vz = f(az - cz);
    const nx = f(f(uy * vz) - f(uz * vy)), ny = f(f(uz * vx) - f(ux * vz)), nz = f(f(ux * vy) - f(uy * vx));
    vol[o] = nx; vol[o + 1] = ny; vol[o + 2] = nz;
    vol[o + 3] = -f(f(f(nx * px) + f(ny * py)) + f(nz * pz));
  }
  // FUN_0026c878 for one quad (corners at q[o..o+11]) into volume slot k
  function buildVolume(k, q, o) {
    const b = k * 20, E = eye;
    for (let p = 0; p < 4; p++) {
      const a = o + 3 * RING[2 * p], bb = o + 3 * RING[2 * p + 1];
      plane(b + 4 * p, q[a], q[a + 1], q[a + 2], q[bb], q[bb + 1], q[bb + 2], E[0], E[1], E[2], E[0], E[1], E[2]);
    }
    const c0 = o, c1 = o + 3, c2 = o + 6;
    // own plane: n = (c0 - c2) x (c0 - c1), w = -n . c0
    plane(b + 16, q[c0], q[c0 + 1], q[c0 + 2], q[c2], q[c2 + 1], q[c2 + 2], q[c1], q[c1 + 1], q[c1 + 2], q[c0], q[c0 + 1], q[c0 + 2]);
    const s = f(f(f(f(vol[b + 16] * E[0]) + f(vol[b + 17] * E[1])) + f(vol[b + 18] * E[2])) + vol[b + 19]);
    if (s >= 0) for (let i = 0; i < 20; i++) vol[b + i] = -vol[b + i];
  }
  // FUN_002698d0 on one point: inside volume k
  function insideOne(k, x, y, z) {
    const b = k * 20;
    // own plane (vmul.xyz, then w + x, + y, + z)
    if (f(f(f(vol[b + 19] + f(x * vol[b + 16])) + f(y * vol[b + 17])) + f(z * vol[b + 18])) < 0) return false;
    for (let p = 0; p < 4; p++) {                 // ACC = col0 x + col1 y + col2 z + col3 (the transposed planes)
      const o = b + 4 * p;
      if (f(f(f(f(vol[o] * x) + f(vol[o + 1] * y)) + f(vol[o + 2] * z)) + vol[o + 3]) < 0) return false;
    }
    return true;
  }
  // FUN_00269978(pts, n): true when all n points are inside one volume
  function inside(pts, n, off = 0) {
    for (let k = 0; k < st.count; k++) {
      let all = true;
      for (let i = 0; i < n && all; i++) all = insideOne(k, pts[off + 3 * i], pts[off + 3 * i + 1], pts[off + 3 * i + 2]);
      if (all) return true;
    }
    return false;
  }

  function frame(V, loaded, fov = FOV) {
    setFov(fov);
    // FUN_002610e0: the eye = row 3 of the inverse of the rigid V = -(R t)
    for (let j = 0; j < 3; j++) eye[j] = -f(f(f(V[4 * j] * V[12]) + f(V[4 * j + 1] * V[13])) + f(V[4 * j + 2] * V[14]));
    // FUN_00269868
    let n = 0;
    build: for (const ch of loaded) {
      const c = byChunk.get(ch);
      if (!c) continue;
      for (let i = 0; i < c.nq; i++) {
        const o = 12 * i;
        if (clipOut(V, c.quads, o) || tooSmall(V, c.quads, o)) continue;
        if (n >= MAXV) break build;
        buildVolume(n++, c.quads, o);
      }
    }
    st.count = n;
    // FUN_0026ccc8: node flags (pre-order: a parent comes before its children)
    let changed = false;
    for (const ch of loaded) {
      const c = byChunk.get(ch);
      if (!c) continue;
      const P = c.parent, B = c.box, D = c.drop;
      for (let i = 1; i < c.n; i++) {
        const d = P[i] > 0 && D[P[i]] ? 1 : (n && inside(B, 8, 24 * i) ? 1 : 0);
        if (D[i] !== d) { D[i] = d; changed = true; }
      }
    }
    if (changed) st.version++;
  }
  return {
    frame, inside,
    dropped: ch => (byChunk.get(ch) || null)?.drop ?? null,
    get count() { return st.count; }, get version() { return st.version; }, volumes: vol, eye, chunks: [...byChunk.keys()],
  };
}

// A three.js camera as the camera matrix 0x4fcb10 (row-vector world -> game view: x right, y down, z forward), into
// `out` (Float32Array(16)): the same matrix as effects.js cameraView(camera).toViewMatrix(), without allocating.
export function viewOf(camera, out) {
  camera.updateMatrixWorld();
  const inv = camera.matrixWorldInverse.elements;
  for (let r = 0; r < 4; r++) { out[4 * r] = inv[4 * r]; out[4 * r + 1] = -inv[4 * r + 1]; out[4 * r + 2] = -inv[4 * r + 2]; out[4 * r + 3] = r === 3 ? 1 : 0; }
  return out;
}
