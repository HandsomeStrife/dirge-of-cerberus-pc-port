// z128 room drawing shared by the web pages: loads data/scene.json (export_web_room.py)
// and builds one three.js mesh per draw (two for a GS alpha-test draw), drawn the way
// native/gpu/render_scene_textured does: prelit vertex colour, PS2 MODULATE
// (texel*vcol*2), per-vertex screen-linear GS fog, GS alpha test as two passes, the VU1
// back-face test per triangle / strip quad (worker 0227: meshes[].cul, export_z128_room.py cull_tag;
// ?cull=0 draws both sides, a page aid), draw order = scene.json order (the renderer needs
// sortObjects = false).
//
// Taken from main.js (which still has its own copy; it can switch to this module).
// play.js uses it, so the z-fight fixes live in one place:
//  zprio  - untextured room draws get polygon offset (1, 4): the unbound group shares
//           planes with textured faces (pale staircase on walls). ?zprio=0 turns it off.
//  zunder - draws with under: true (room.list col 5, export_z128_room.py UNDER_SUFFIX)
//           get the same offset: a later chunk's coarse copy of a surface an earlier
//           chunk already has on that plane loses the tie, as in the game.
//           ?zunder=0 turns it off.
import * as THREE from 'three';
import { createRoomOccl } from './room_occl.js';

export const VS = `
precision highp float;
in vec3 position;
in vec2 uv;
in vec4 color;
in float uvTrack;          // scrolling UVs: the chain's track (-1 none; bmd_uvanim.py)
in vec3 normal;            // the triangle's WebGL-front normal (export: (v1 - v0) x (v2 - v0))
in vec4 cullP;             // back faces: the strip partner's game-front plane (export_z128_room.py cull_tag)
in float cullD;            // back faces: the triangle's own game-front plane distance
uniform mat4 modelViewMatrix, projectionMatrix;
uniform mat3 normalMatrix;
uniform bool uFog, uUVAnim, uCull;
uniform sampler2D uUVOff;  // RoomUVAnim: (u, v) offset per track (FUN_00265560: node +0xdc / +0xde / 4096)
// the chain's env slot (header +0x96; FUN_00265560 / FUN_0026afe8): fog ramp (a, b, floor) and FOGCOL per slot
in float envSlot;
uniform vec3 uEnvFog[32], uEnvCol[32];
flat out vec3 vFogCol;   // one FOGCOL per chain
out vec2 vUV;
out vec4 vCol;
out float vFogW, vW;   // fog*w and w: their ratio interpolates screen-linearly (= native noperspective)
// a plane (n, d) of the mesh's space at the eye: dot(n, eye) - d, from the uniforms and the plane only, so a
// triangle's three vertices (which carry the same planes) agree bit for bit (rigid model-view: R n . -T - d)
float atEye(vec3 n, float d) { return -dot(normalMatrix * n, modelViewMatrix[3].xyz) - d; }
void main() {
  // VU1 program A back faces (export_z128_room.py cull_tag): a triangle is skipped when it faces away (the
  // screen cross z < 0: its game-front plane has the eye behind it) and so does its strip partner (instr
  // 255-260: IAND); the partner plane is 'always facing' for two-sided chains, 'never' for lists. Skipped
  // triangles collapse to one point outside the clip volume (no fragments). A zero cross is kept (>= 0).
  if (uCull && atEye(-normal, cullD) < 0.0 && atEye(cullP.xyz, cullP.w) < 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  int es = int(envSlot + 0.5); vec3 ef = uEnvFog[es]; vFogCol = uEnvCol[es];
  float f = uFog ? clamp(ef.x * clip.w + ef.y, ef.z, 1.0) : 1.0;
  vUV = uv; vCol = color;
  if (uUVAnim && uvTrack >= 0.0) vUV += texelFetch(uUVOff, ivec2(int(uvTrack), 0), 0).xy; vFogW = f * clip.w; vW = clip.w;
  gl_Position = clip;
}`;

export const FS = `
precision highp float;
in vec2 vUV;
in vec4 vCol;
in float vFogW, vW;
flat in vec3 vFogCol;
uniform sampler2D uTex;
uniform float uMXL;      // TEX1 MXL (record +0xc; 0 = bilinear level 0). FUN_002659b8: MMIN 4, L 0, K = DAT_004fcae0 = -96 / 16
uniform bool uTexOn, uFog, uOutAlpha, uAdd;
uniform float uARef;
uniform float uTexA;     // texel alpha scale: 255 / 128 for raw PS2 alpha (scene.textures[].alpha 'ps2'), else 1
uniform int uAMode;      // 0 none, 1 keep a>=ref, 2 keep a<ref
out vec4 fragColor;
void main() {
  vec4 c = vCol;
  float aS = vCol.a * 2.0;                      // GS As (128 == 1.0), not capped: up to 0xff / 0x80
  if (uTexOn) {
    // GS LOD with LCM 0: log2(1 / Q) + K, Q = 1 / w per pixel (the view depth, not the resolution); LINEAR_MIPMAP_NEAREST rounds to a level, up to MXL
    float lod = uMXL > 0.0 ? log2(1.0 / gl_FragCoord.w) - 6.0 : 0.0;
    vec4 t = uMXL > 0.0 ? textureLod(uTex, vUV, lod <= 0.0 ? 0.0 : min(floor(lod + 0.5), uMXL)) : texture(uTex, vUV);
    c.rgb = min(floor(t.rgb * 255.0 * vCol.rgb * 255.0 / 128.0) / 255.0, 1.0);   // PS2 MODULATE: (Ct * Cv) >> 7
    aS = t.a * uTexA * vCol.a * 2.0;              // At / 128 (raw PS2 byte: up to 0xff / 0x80, not capped)
  }
  c.a = min(aS, 1.0);                           // GS As = A / 128 (textured: At * Av / 128)
#ifdef ATEST                                    // only the alpha-test passes discard (keeps early z elsewhere)
  if (uAMode == 1 && c.a <  uARef) discard;
  if (uAMode == 2 && c.a >= uARef) discard;
#endif
  // GS fog: (F * C + (255 - F) * FOGCOL) >> 8
  if (uFog) { float F = floor(vFogW / vW * 255.0); c.rgb = floor((F * c.rgb * 255.0 + (255.0 - F) * vFogCol * 255.0) / 256.0) / 255.0; }
  // additive (ALPHA 0x48, Cs * As + Cd): the shader applies As itself (blend factors One, One),
  // because a blend factor would clamp As to 1 and ff88's vertex alpha reaches 192 (As 1.5)
  if (uAdd) { fragColor = vec4(c.rgb * aS, 1.0); return; }
  fragColor = vec4(c.rgb, uOutAlpha ? c.a : 1.0);
}`;

// The two depth-tie offsets and the back-face test, read from the page URL (all on unless =0).
export function roomOptions(params = new URLSearchParams(location.search)) {
  return { zprio: params.get('zprio') !== '0', zunder: params.get('zunder') !== '0', cull: params.get('cull') !== '0', mips: params.get('mips') === '1' };
}

// FUN_0026afe8 per env slot: F / 255 = clamp(a w + b, floor, 1), a = -1 / (far - near), b = far / (far - near). A slot with
// near = far (2, 5, 6, 27) has a = +max (255 / 0; DAT_004e62b0 + 0x100 in RAM), so F clamps to 255: no fog.
function envTable(scene) {
  if (scene.envTable) return scene.envTable;
  const slots = scene.env_fog || [scene.fog];
  const fog = [], col = [];
  for (let i = 0; i < 32; i++) {
    const e = slots[i] || slots[0];
    const none = !e || e.far === e.near;
    fog.push(new THREE.Vector3(none ? 0 : -1 / (e.far - e.near), none ? 1 : e.far / (e.far - e.near), none ? 0 : e.min));
    const c = e ? e.color : [0, 0, 0];
    col.push(new THREE.Vector3(...(scene.env_fog ? c.map(v => v / 255) : c)));
  }
  return (scene.envTable = { fog, col });
}

// mode: 0 = plain draw; 1 / 2 = GS ATE pass keeping alpha >= ref / < ref.
export function makeMaterial(scene, tex, draw, mode, opts = roomOptions()) {
  const fog = scene.fog, env = envTable(scene);
  const m = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: FS, defines: mode ? { ATEST: 1 } : {},
    side: THREE.DoubleSide, depthFunc: THREE.LessDepth,
    uniforms: {
      uTex: { value: tex }, uTexOn: { value: !!tex },
      uMXL: { value: !opts.mips && scene.textures?.[draw.tex]?.mips ? scene.textures[draw.tex].mips.length : 0 },
      uTexA: { value: scene.textures?.[draw.tex]?.alpha === 'ps2' ? 255 / 128 : 1 },
      uFog: { value: !!(fog && draw.fog) },
      uEnvFog: { value: env.fog }, uEnvCol: { value: env.col },
      uARef: { value: draw.aref }, uAMode: { value: mode }, uOutAlpha: { value: mode !== 0 },
      uAdd: { value: draw.blend === 'add' },
      uUVAnim: { value: !!(opts.uvOff && scene.meshes?.[draw.mesh]?.uvt) },
      uUVOff: { value: opts.uvOff || null },
      uCull: { value: !!scene.meshes?.[draw.mesh]?.cul && opts.cull !== false },
    },
  });
  // A few depth steps only: anything really in front still shows.
  if ((!tex && draw.kind === 'room' && opts.zprio) || (draw.under && opts.zunder)) {
    m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 4;
  }
  if (draw.blend === 'add') {
    // Bucketed chain, blend mode 1 (export_z128_room.py chain_blend; FUN_002661a8 with
    // ALPHA DAT_0046bf60[1] = 0x48: Cs*As + Cd, TEST DAT_0046bf78[1] = 0x51001: ATST NEVER,
    // AFAIL FB_ONLY, so colour is written and depth never).
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor;        // FS outputs Cs * As
    m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
    m.depthWrite = false;
  } else if (mode === 0) {
    m.blending = THREE.NoBlending;
  } else {
    // GS ATE, AFAIL=RGB_ONLY: every fragment blends by As; only passing ones write depth.
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation;
    m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
    m.depthWrite = mode === 1;
  }
  return m;
}

async function fetchBuf(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.arrayBuffer();
}

// Load scene.json and build the room.
//   skip(draw)      - leave a draw out (play.js drops the static posed Vincent)
//   onProgress(done, total)
//   normals         - also bind the normal attribute on meshes without back-face data (the back-face
//                     test binds it anyway; main.js binds only position, uv and color)
//   opts            - roomOptions() unless given
// Returns { scene, root, lo, hi, floats, uvAnim }: uvAnim = RoomUVAnim (null without scene.uvanim); floats[mesh id] = the raw 12-float vertex
// buffer (report.js ray casts read it); each mesh's userData.draw indexes scene.draws.
export async function loadRoom({ skip = null, onProgress = null, normals = false, opts = roomOptions(), base = 'data/' } = {}) {
  const r = await fetch(base + 'scene.json');
  if (!r.ok) throw new Error(`scene.json: HTTP ${r.status}`);
  const scene = await r.json();
  const draws = scene.draws.map((d, i) => [d, i]).filter(([d]) => !(skip && skip(d)));
  const used = new Set(draws.map(([d]) => d.mesh));
  const texUsed = new Set(draws.map(([d]) => d.tex).filter(Boolean));
  const meshes = Object.entries(scene.meshes).filter(([id]) => used.has(id));
  const texs = Object.entries(scene.textures).filter(([id]) => texUsed.has(id));
  const files = [...meshes.map(e => e[1]), ...texs.map(e => e[1]), ...texs.flatMap(e => e[1].mips || []),
                 ...meshes.filter(e => e[1].uvt).map(e => ({ file: e[1].uvt })),
                 ...meshes.filter(e => e[1].cul).map(e => ({ file: e[1].cul })),
                 ...meshes.filter(e => e[1].env).map(e => ({ file: e[1].env }))];
  let done = 0;
  const bufs = {};
  await Promise.all(files.map(async f => {
    bufs[f.file] = await fetchBuf(base + f.file);
    if (onProgress) onProgress(++done, files.length);
  }));

  const textures = {};
  for (const [id, t] of texs) {
    const tx = new THREE.DataTexture(new Uint8Array(bufs[t.file]), t.w, t.h, THREE.RGBAFormat);
    tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
    // TEX1 per texture (FUN_002659b8): no levels -> MXL 0, bilinear; levels (only ff32, ff85 in z128) -> the file's own, MMIN 4, selected in the shader.
    // ?mips=1: NOT the game's mode (a page EXTRA, off): generated trilinear mips on every texture.
    tx.magFilter = THREE.LinearFilter;
    if (opts.mips) { tx.minFilter = THREE.LinearMipmapLinearFilter; tx.generateMipmaps = true; }
    else if (t.mips) {
      tx.minFilter = THREE.LinearMipmapNearestFilter; tx.generateMipmaps = false;
      tx.mipmaps = [{ data: new Uint8Array(bufs[t.file]), width: t.w, height: t.h }, ...t.mips.map(m => ({ data: new Uint8Array(bufs[m.file]), width: m.w, height: m.h }))];
    } else { tx.minFilter = THREE.LinearFilter; tx.generateMipmaps = false; }
    tx.flipY = false; tx.colorSpace = THREE.NoColorSpace;
    tx.needsUpdate = true;
    textures[id] = tx;
  }
  const attrs = {}, floats = {};
  for (const [id, m] of meshes) {
    floats[id] = new Float32Array(bufs[m.file]);
    const ib = new THREE.InterleavedBuffer(floats[id], 12);
    attrs[id] = {
      position: new THREE.InterleavedBufferAttribute(ib, 3, 0),
      normal: new THREE.InterleavedBufferAttribute(ib, 3, 3),
      uv: new THREE.InterleavedBufferAttribute(ib, 2, 6),
      color: new THREE.InterleavedBufferAttribute(ib, 4, 8),
    };
    if (m.uvt) attrs[id].uvTrack = new THREE.BufferAttribute(new Int16Array(bufs[m.uvt]), 1);
    if (m.env) attrs[id].envSlot = new THREE.BufferAttribute(new Uint8Array(bufs[m.env]), 1);   // absent: slot 0
    if (m.cul) {                                  // back faces: float32 x 5 per vertex (partner plane, own d)
      const cb = new THREE.InterleavedBuffer(new Float32Array(bufs[m.cul]), 5);
      attrs[id].cullP = new THREE.InterleavedBufferAttribute(cb, 4, 0);
      attrs[id].cullD = new THREE.InterleavedBufferAttribute(cb, 1, 4);
    }
  }
  // scrolling UVs (worker 0226): one offset texture for every room material
  const uvAnim = scene.uvanim ? new RoomUVAnim(scene.uvanim) : null;
  if (uvAnim) opts = { ...opts, uvOff: uvAnim.tex };

  const root = new THREE.Scene();
  const lo = new THREE.Vector3(...scene.bbox.min), hi = new THREE.Vector3(...scene.bbox.max);
  const sphere = new THREE.Sphere(lo.clone().add(hi).multiplyScalar(.5), lo.distanceTo(hi));
  for (const [d, di] of draws) {
    const a = attrs[d.mesh];
    const tex = d.tex ? textures[d.tex] : null;
    // a draw with per-chunk ranges ([chunk, first, count, visibility group]) is drawn through an index
    // that showChunks fills with the ranges of loaded chunks whose group is not hidden; until then
    // it draws everything
    {
      const g = new THREE.BufferGeometry();
      for (const n of normals || a.cullP ? ['position', 'normal', 'uv', 'color'] : ['position', 'uv', 'color']) g.setAttribute(n, a[n]);   // the back-face test reads the normal
      if (a.uvTrack) g.setAttribute('uvTrack', a.uvTrack);
      for (const n of Object.keys(a)) if (!['position', 'normal', 'uv', 'color'].includes(n)) g.setAttribute(n, a[n]);
      g.setDrawRange(d.first, d.count);
      if (d.chunks) g.userData.visIndex = new THREE.BufferAttribute(new Uint32Array(d.count), 1);   // showChunks fills it
      g.boundingSphere = sphere.clone();
      for (const mode of (d.aref >= 0 && tex ? [1, 2] : [0])) {
        const mesh = new THREE.Mesh(g, makeMaterial(scene, tex, d, mode, opts));
        mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
        mesh.name = d.name + (mode ? `#ate${mode}` : '');
        mesh.userData = d.chunks ? { draw: di, mode, chunks: d.chunks } : { draw: di, mode };
        root.add(mesh);
      }
    }
  }
  // occluder culling (worker 0233; room_occl.js): the bone trees and occluder quads, per chunk; showChunks' 4th argument
  const occl = scene.occl ? createRoomOccl(scene.occl) : null;
  return { scene, root, lo, hi, floats, uvAnim, occl };
}

// Area streaming (worker 0213): the game draws chunk 00 and the pair in slots 1 / 2 of its chunk
// table DAT_004e4c60 only (FUN_002673d8 / FUN_002677a0, streamed by FUN_0026a0c0's area boxes;
// area_stream.js keeps that table). Visibility groups (worker 0225): FUN_0026ccc8 skips a chain whose
// group byte +0xaa has its bit set in DAT_004e8710 (FUN_00269450; > 0x7f never). export_z128_room.py
// stores each draw's triangles in chunk order with [chunk, first, count, group] ranges (scene.json
// draws[].chunks; group -1 = never hidden). loaded: iterable of chunk numbers (AreaStream.loaded()), or
// null = every chunk. hidden: the mask (room_vis.js createVisMask: has(group)), or null = none hidden.
// Timing is area_stream.js's GUESS (fidelity-audit): a chunk shows the frame its slot is marked loaded.
export function visibleRanges(chunks, want, hidden) {
  const runs = [];
  for (const [c, first, count, group = -1] of chunks) {
    if (want && !want.has(c)) continue;
    if (hidden && group >= 0 && hidden.has(group)) continue;
    const r = runs[runs.length - 1];
    if (r && r[0] + r[1] === first) r[1] += count; else runs.push([first, count]);
  }
  return runs;
}
// occl (worker 0233): room_occl.js's per-frame state, or null: a range whose bone-tree node (5th element; -1 = none, the
// +0x1c objects' chains, which FUN_0026d018 draws without the occluder test) FUN_0026ccc8 skips is not drawn.
export function showChunks(root, loaded, hidden = null, occl = null) {
  // called every game frame: no allocation unless the loaded set or the mask changed. Chunks as a bit set
  // (z128: 00..0c), the mask as its 4 words (DAT_004e8710).
  const ru = root.userData;
  let bits = 0;
  if (loaded == null) bits = -1;
  else for (const c of loaded) bits |= c >= 0 && c < 31 ? 1 << c : 0;
  let same = ru.chunkBits === bits && ru.visOn === !!hidden && ru.occlVer === (occl ? occl.version : -1);
  if (hidden) {
    const w = ru.visWords || (ru.visWords = new Uint32Array(4));
    for (let k = 0; k < 4; k++) { const x = hidden.word(k); if (w[k] !== x) { w[k] = x; same = false; } }
  }
  if (same) return;
  if (ru.chunkBits !== bits) ru.chunksShown = loaded == null ? '*' : [...new Set(loaded)].sort((x, y) => x - y).join(',');
  ru.chunkBits = bits; ru.visOn = !!hidden; ru.occlVer = occl ? occl.version : -1;
  ru.visShown = hidden ? Array.from(ru.visWords).join(',') : '-';      // the mask the ranges were cut with
  const stamp = ru.visStamp = (ru.visStamp | 0) + 1;
  for (const m of root.children) {
    const u = m.userData, g = m.geometry;
    if (!u.chunks || g.userData.visStamp === stamp) continue;          // shared by the ATE passes: once
    g.userData.visStamp = stamp;
    // which ranges are drawn: their chunk loaded and their group (-1 = never) not hidden (FUN_00269450)
    const ch = u.chunks;
    let fl = g.userData.visFlags, changed = false;
    if (!fl) { fl = g.userData.visFlags = new Uint8Array(ch.length).fill(2); }
    for (let i = 0; i < ch.length; i++) {
      const r = ch[i], c = r[0], grp = r.length > 3 ? r[3] : -1, nd = r.length > 4 ? r[4] : -1;
      let on = (bits === -1 || (c >= 0 && c < 31 && (bits >>> c & 1))) && !(hidden && grp >= 0 && hidden.has(grp)) ? 1 : 0;
      if (on && occl && nd > 0) { const D = occl.dropped(c); if (D && D[nd]) on = 0; }   // FUN_0026ccc8: under a skipped node
      if (fl[i] !== on) { fl[i] = on; changed = true; }
    }
    if (!changed) continue;                       // this geometry draws the same triangles: no re-upload
    // one indexed draw over the drawn ranges (the same triangles in the same order)
    let ix = g.userData.visIndex;
    if (!ix) {                                    // a geometry not built by loadRoom (tests): a bare index
      let total = 0;
      for (const r of ch) total += r[2];
      ix = g.userData.visIndex = { array: new Uint32Array(total), needsUpdate: false };
    }
    let k = 0;
    for (let i = 0; i < ch.length; i++) if (fl[i]) { const first = ch[i][1], count = ch[i][2]; for (let v = 0; v < count; v++) ix.array[k++] = first + v; }
    if (ix.addUpdateRange) { ix.clearUpdateRanges(); ix.addUpdateRange(0, k); }   // upload the used part only
    ix.needsUpdate = true;
    if (g.index !== ix) g.setIndex(ix);
    g.setDrawRange(0, k);
  }
}

// ---- Scrolling UVs (worker 0226; native/assets/models/bmd_uvanim.py, notes/room-blend-streaming.md
// "Scrolling UVs"). Each chunk's animation file scrolls the UVs of some chains (z128: the fire glow ff88,
// the sky ff35, ff34, ff4a). FUN_00248110 -> FUN_00265350 -> FUN_00263e90 per loaded slot ->
// FUN_0026c198: per playing animation, each track's curves set node +0xdc = (short)(int)(u(t) * 4096) and
// +0xde = (short)(int)(-v(t) * 4096), then time += DAT_004fc7e8 * 0.5. FUN_00265bf0 copies them to the
// chain (+0xa4 / +0xa6) and FUN_00265560 sends them / 4096 (0.00024414062): the GS UV = file UV + offset.
// The times are zeroed when the chunk loads (FUN_00266ae0 -> FUN_002680e0) and freed when it unloads.

// PS2 FPU: float adds round toward zero (the RAM times match only that: 408 x 0.6 = 244.79793).
const f32 = new Float32Array(1), i32 = new Int32Array(f32.buffer);
function addRTZ(a, b) {
  const x = a + b;                       // exact in double for these magnitudes
  f32[0] = x;
  if (Math.abs(f32[0]) > Math.abs(x)) i32[0] -= 1;   // one step toward zero (same sign, non-zero)
  return f32[0];
}
const fr = Math.fround;

// FUN_00262328 (with FUN_002621c8): keys [time, value, in tangent, out tangent]; loop = fmodf.
export function evalCurve(K, t, loop) {
  const n = K.length;
  if (n === 0) return 0;
  const last = K[n - 1][0];
  t = loop ? fr(t % last) : Math.min(t, last);
  if (!(K[0][0] < t)) return K[0][1];
  if (!(t < last)) return K[n - 1][1];   // FUN_002621c8 returns n: the last key's value
  let lo = 0, hi = n - 1;                // the binary search's result: the key at or before t
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (K[m][0] < t) lo = m; else hi = m; }
  const i = lo, dt = fr(K[i + 1][0] - K[i][0]), s = fr(fr(t - K[i][0]) / dt);
  const s2 = s * s, s3 = s2 * s;         // Hermite matrix DAT_0046be50
  return (2 * s3 - 3 * s2 + 1) * K[i][1] + (-2 * s3 + 3 * s2) * K[i + 1][1]
       + (s3 - 2 * s2 + s) * fr(K[i][3] * dt) + (s3 - s2) * fr(K[i + 1][2] * dt);
}
// (short)(int)(x * 4096.0)
export const toS16 = x => (Math.trunc(fr(fr(x) * 4096)) << 16) >> 16;

export class RoomUVAnim {
  constructor({ anims, tracks }) {
    this.anims = anims; this.tracks = tracks;
    this.n = tracks.length;
    this.off = new Float32Array(2 * Math.max(1, this.n));
    this.tex = new THREE.DataTexture(this.off, Math.max(1, this.n), 1, THREE.RGFormat, THREE.FloatType);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false; this.tex.flipY = false; this.tex.needsUpdate = true;
    this.byChunk = new Map();            // chunk -> anim positions
    anims.forEach((a, i) => { if (!this.byChunk.has(a.chunk)) this.byChunk.set(a.chunk, []); this.byChunk.get(a.chunk).push(i); });
    this.time = new Map();               // loaded chunk -> Float32Array (one time per anim position)
    this.node = new Int16Array(2 * Math.max(1, this.n));   // the nodes' +0xdc / +0xde
    // per track: its animation's chunk and slot in that chunk's time array (precomputed: frame() allocates nothing)
    this.trChunk = tracks.map(t => anims[t.anim].chunk);
    this.trPos = tracks.map(t => this.byChunk.get(anims[t.anim].chunk).indexOf(t.anim));
    this.trLoop = tracks.map(t => anims[t.anim].loop);
    this.allChunks = [...this.byChunk.keys()];
  }
  // One game frame (FUN_00265350, late in FUN_00248110). loaded: the loaded chunks (AreaStream.loaded(): an
  // array), or null = every chunk. advance: DAT_004fc7e8 (1.2; 0 while DAT_004fc7e4 == 1).
  frame(loaded, advance = 1.2) {
    const want = loaded == null ? this.allChunks : loaded;
    for (const c of this.time.keys()) if (!want.includes(c)) this.time.delete(c);   // FUN_002681b0
    for (const c of want) {
      const list = this.byChunk.get(c);
      if (list && !this.time.has(c)) this.time.set(c, new Float32Array(list.length));   // FUN_002680e0 (on load only)
    }
    const step = fr(fr(advance) * 0.5);
    for (let ti = 0; ti < this.n; ti++) {
      const T = this.time.get(this.trChunk[ti]);
      if (!T) continue;                  // chunk not loaded: its chains are not drawn
      const tr = this.tracks[ti], t = T[this.trPos[ti]], loop = this.trLoop[ti];
      if (tr.u) this.node[2 * ti] = toS16(evalCurve(tr.u, t, loop));
      if (tr.v) this.node[2 * ti + 1] = toS16(-evalCurve(tr.v, t, loop));
      this.off[2 * ti] = this.node[2 * ti] * 0.00024414062;
      this.off[2 * ti + 1] = this.node[2 * ti + 1] * 0.00024414062;
    }
    for (const T of this.time.values()) for (let k = 0; k < T.length; k++) T[k] = addRTZ(T[k], step);
    this.tex.needsUpdate = true;
  }
}
