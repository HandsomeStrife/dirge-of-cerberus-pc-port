// hud.js -- the in-game HUD drawn into the frame (output.js `hud`, before the PCRTC merge, as the
// game draws it into its framebuffer): the HP gauge, the weapon / ammo / CHAIN / item panel and the
// rest of the HUD's draw list as the save state has it. The draw list itself is hud_core.js
// (translated from the menu-widget code, checked against the hero GS dump by test_hud.mjs); this file
// is the GS stand-in: textures, CLUTs, the blend, and the 432 x 512 frame -> canvas mapping.
//
// Scaling to the canvas: hud_core gives frame pixels (the game's own HUD -> frame mapping, x 432/512,
// y 512/448, FUN_003d2e80); output.js maps frame px to the target (native: identity; full HD: the
// CRTC's 4:3 picture, the same mapping as the scene and the reticle). Texels are fetched by integer
// coordinates at the target resolution (TEX1 nearest = crisp texels when scaled up); elements with
// +2 flag 8 get the GS's bilinear (TEX1 0x60, FUN_003d3830 -> FUN_003d2dc0).
import * as THREE from 'three';
import { HudState, hexBytes, restartedHud } from './hud_core.js';

// GS stand-in: Cv = Cf Ct >> 7, Av = Af At >> 7 (TFX modulate, TCC 1), then ((Cs - Cd) As >> 7) + Cd
// with COLCLAMP (0..255). An 8-bit target clamps the blend factor at 1 and the source at 255, so a
// fragment with As > 1 (As = Av / 128; the font CLUTs reach 0xb0 = 1.375) takes two more passes:
//   pass 1 (subtract):  min(Cs As, 255) - Cd (As - 1), clamped at 0      (= the GS result when Cs As <= 255)
//   pass 2 (add):       + max(Cs As - 255, 0), clamped at 255
// where Cs As > 255, pass 1 left 255 - Cd (As - 1) (never below 0: As - 1 <= 0.99), so pass 2 gives
// min(255, Cs As - Cd (As - 1)), the GS value; per channel, so mixed channels are exact too. Pixel
// test: test_hud_page.mjs. Not reproduced: the GS's >> 7 floor (the GPU rounds: within 1 level).
const VS = `precision highp float;
  uniform mat4 projectionMatrix, modelViewMatrix;
  in vec3 position; in vec2 uv; in vec4 color; in vec4 tw; in vec4 wr; in vec4 sc; in vec2 fbp;
  out vec2 vUv; out vec4 vCol; out vec2 vFb; flat out vec4 vTw; flat out vec4 vWr; flat out vec4 vSc;
  void main() { vUv = uv; vCol = color; vTw = tw; vWr = wr; vSc = sc; vFb = fbp;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS = `precision highp float; precision highp int;
  uniform sampler2D t0, t1, t2, t3, f1, f2, f3, f4; uniform int pass;
  in vec2 vUv; in vec4 vCol; in vec2 vFb; flat in vec4 vTw; flat in vec4 vWr; flat in vec4 vSc; out vec4 o;
  vec4 fetch(int id, ivec2 p) {
    if (id == 0) return texelFetch(t0, p & (textureSize(t0, 0) - 1), 0);
    if (id == 1) return texelFetch(t1, p & (textureSize(t1, 0) - 1), 0);
    if (id == 2) return texelFetch(t2, p & (textureSize(t2, 0) - 1), 0);
    if (id == 3) return texelFetch(t3, p & (textureSize(t3, 0) - 1), 0);
    ivec2 s = textureSize(f1, 0); p = ivec2(p.x & 511, p.y % s.y);    // kelfnt0 512 x 448 (TW 512, TH 512: rows past 448 unused)
    if (id == 4) return texelFetch(f1, p, 0);
    if (id == 5) return texelFetch(f2, p, 0);
    if (id == 6) return texelFetch(f3, p, 0);
    return texelFetch(f4, p, 0);
  }
  ivec2 wrapT(ivec2 p) {                       // CLAMP_1 REGION_REPEAT: (t & MIN) | MAX
    if (vWr.x >= 0.0) p.x = (p.x & int(vWr.x)) | int(vWr.y);
    if (vWr.z >= 0.0) p.y = (p.y & int(vWr.z)) | int(vWr.w);
    return p;
  }
  void main() {
    vec2 f = floor(vFb);                       // SCISSOR_1 (frame px, inclusive): x0 x1 y0 y1
    if (f.x < vSc.x || f.x > vSc.y || f.y < vSc.z || f.y > vSc.w) discard;
    int id = int(floor(vTw.x + 0.5));          // -1 = untextured
    vec4 c = floor(vCol + 0.5);
    vec4 t = vec4(128.0);
    if (id >= 0) {
      if (vTw.y > 0.5) {                       // bilinear: the 4 texels around (u - 0.5, v - 0.5)
        vec2 q = vUv - 0.5; vec2 f = fract(q); ivec2 b = ivec2(floor(q));
        vec4 a = fetch(id, wrapT(b)), bb = fetch(id, wrapT(b + ivec2(1, 0)));
        vec4 cc = fetch(id, wrapT(b + ivec2(0, 1))), d = fetch(id, wrapT(b + ivec2(1, 1)));
        t = floor(mix(mix(a, bb, f.x), mix(cc, d, f.x), f.y) * 255.0 + 0.5);
      } else t = floor(fetch(id, wrapT(ivec2(floor(vUv)))) * 255.0 + 0.5);
      c = vec4(min(floor(c.rgb * t.rgb / 128.0), 255.0), min(floor(c.a * t.a / 128.0), 255.0));
    }
    float k = c.a / 128.0;
    if (pass == 0) { if (k > 1.0) discard; o = vec4(c.rgb / 255.0, k); return; }
    if (k <= 1.0) discard;
    if (pass == 1) { o = vec4(min(c.rgb * k / 255.0, 1.0), k - 1.0); return; }
    vec3 over = max(c.rgb * k - 255.0, 0.0);          // pass 2: the part above 255
    if (max(over.r, max(over.g, over.b)) <= 0.0) discard;
    o = vec4(over / 255.0, 0.0);
  }`;

function rgbaTexture(w, h, px) {
  const t = new THREE.DataTexture(px, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false; t.flipY = false; t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
// menu1 / menu2: PSMT4 (idx hex digits, 16 colours); menu3 / menu4: PSMT8 (idx8 hex bytes, 256 colours)
function menuTexture(T) {
  const px = new Uint8Array(T.w * T.h * 4);
  if (T.idx8) {
    const ix = hexBytes(T.idx8);
    for (let i = 0; i < T.w * T.h; i++) px.set(T.clut[ix[i]], i * 4);
  } else for (let i = 0; i < T.w * T.h; i++) px.set(T.clut[parseInt(T.idx[i], 16)], i * 4);
  return rgbaTexture(T.w, T.h, px);
}
// kelfnt0: 4-bit linear (even x = low nibble) through CLUT n (the two 2-bit planes per CLUT pair)
function fontTexture(F, clut) {
  const a = hexBytes(F.atlas), px = new Uint8Array(F.w * F.h * 4);
  for (let i = 0; i < F.w * F.h; i++) {
    const b = a[i >> 1];
    px.set(clut[(i & 1) ? b >> 4 : b & 15], i * 4);
  }
  return rgbaTexture(F.w, F.h, px);
}

const TEX_ID = { menu1: 0, menu2: 1, menu3: 2, menu4: 3 };
const FULL_SC = [0, 431, 0, 511];

// OPTION widehud (not in the game): in full mode the HUD's panels move out to the canvas edges. ON by
// default at Dan's request (review board 2026-11-02); ?widehud=0 gives the game's 4:3 layout.
// The unit that moves is a panel: one top-level group of the HUD tree (a layout table, slot i ->
// HUD+0x38+4i, or the root = the reticle's group), so a widget never splits. Its anchor comes from
// its x extent in HUD px (0..512): the group's own rect, or, where the group covers the whole HUD
// (0, 0, 512, 448), the union of its descendants' rects with a width; centre < 512/3 -> -1 (left),
// > 2*512/3 -> +1 (right), else 0 (stays centred; also a panel with no extent). Read once from the
// tree as built, so a panel's anchor does not change while its contents slide or fade.
// List: notes/hud-research.md 'Widescreen HUD option'.
export function panelAnchors(chain) {
  const W = 0x200, H = 0x1c0, a = {};
  for (let i = 0; i < chain.length; i++) {
    const g = chain[i];
    if (g.depth !== 0) continue;
    const r = g.rect;
    let x0 = Infinity, x1 = -Infinity;
    if (!(r[0] <= 0 && r[1] <= 0 && r[2] >= W && r[3] >= H) && r[2] > 0) { x0 = r[0]; x1 = r[0] + r[2]; }
    else for (let j = i + 1; j < chain.length && chain[j].depth > 0; j++) {
      const c = chain[j].rect;
      if (c[2] > 0) { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0] + c[2]); }
    }
    const m = (x0 + x1) / 2;
    a[i] = !(x1 > x0) ? 0 : m < W / 3 ? -1 : m > 2 * W / 3 ? 1 : 0;
  }
  return a;
}

export class HudLayer {
  constructor(data) {
    this.state = new HudState(data);
    this.anchors = panelAnchors(this.state.chain);   // OPTION widehud
    const u = {};
    ['menu1', 'menu2', 'menu3', 'menu4'].forEach((n, i) => { u['t' + i] = { value: menuTexture(data.textures[n]) }; });
    for (const n of [1, 2, 3, 4]) u['f' + n] = { value: fontTexture(data.font, data.font.cluts[String(n)]) };
    u.pass = { value: 0 };
    this.uniforms = u;
    this.max = 6 * 2048;
    const g = new THREE.BufferGeometry();
    this.attr = {};
    for (const [n, k] of [['position', 3], ['uv', 2], ['color', 4], ['tw', 4], ['wr', 4], ['sc', 4], ['fbp', 2]]) {
      this.attr[n] = new Float32Array(this.max * k);
      g.setAttribute(n, new THREE.BufferAttribute(this.attr[n], k));
    }
    this.geo = g;
    const common = { glslVersion: THREE.GLSL3, uniforms: u, vertexShader: VS, fragmentShader: FS,
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      blendEquationAlpha: THREE.AddEquation };
    this.matA = new THREE.RawShaderMaterial({ ...common, blendEquation: THREE.AddEquation,
      blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
    this.matB = new THREE.RawShaderMaterial({ ...common, blendEquation: THREE.SubtractEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor });
    this.matC = new THREE.RawShaderMaterial({ ...common, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });
    this.matA.uniforms = { ...u, pass: { value: 0 } };
    this.matB.uniforms = { ...u, pass: { value: 1 } };
    this.matC.uniforms = { ...u, pass: { value: 2 } };
    // per texture: the largest texel alpha and colour channel (the batching below needs to know which
    // primitives can reach As > 1 and Cs As > 255)
    this.texMax = {};
    const mx = (cl) => [Math.max(...cl.map(c => c[3])), Math.max(...cl.map(c => Math.max(c[0], c[1], c[2])))];
    for (const n of ['menu1', 'menu2', 'menu3', 'menu4']) this.texMax[n] = mx(data.textures[n].clut);
    for (const n of [1, 2, 3, 4]) this.texMax['font' + n] = mx(data.font.cluts[String(n)]);
    this.prev = {};
    this.uploads = 0; this.uploadBytes = 0;          // headless measurements (test_hud_page)
    this.pixelCentre = 0.5;                          // see emit()
    this.mesh = new THREE.Mesh(g, this.matA);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
  }
  // one primitive -> triangles (target px); returns the vertex count written.
  // Pixel centres: the GS samples a primitive at integer pixel coordinates (a pixel is drawn when its
  // integer x, y lies inside the edges, top-left rule; the texture coordinates are the ones at that
  // point), and frame pixel x shows as the area x .. x + 1. WebGL samples at pixel centres (x + 0.5),
  // so every vertex moves by +0.5 frame px (texture coordinates unchanged): pixel x of the target
  // then sees exactly what the GS computes at integer x. fbp (the scissor's frame coordinate) moves
  // with it, so floor(fbp) at a fragment is the frame pixel it shows. Checked against a GS-drawn HUD
  // (test_hud_page.mjs).
  emit(p, n, tx, ty, wide = false) {
    const A = this.attr, h = this.pixelCentre;
    let sc = p.scissor || FULL_SC;
    // OPTION widehud: a shifted panel's full-frame scissor (frame x 0..431) would cut it at the 4:3 picture's edge moved
    // by the shift (a panel sliding out stops at canvas x ~1200 on 1600 x 900); there the canvas is the frame, so the
    // x bounds go (narrower clips, e.g. slot 8's rows, stay)
    if (wide && sc[0] <= FULL_SC[0] && sc[1] >= FULL_SC[1]) sc = [-1e6, 1e6, sc[2], sc[3]];
    const put = (x, y, u, v, c, id, bil, wr) => {
      A.position.set([tx(x + h), ty(y + h), 0], n * 3); A.uv.set([u, v], n * 2); A.color.set(c, n * 4);
      A.tw.set([id, bil, 0, 0], n * 4); A.wr.set(wr, n * 4); A.sc.set(sc, n * 4); A.fbp.set([x + h, y + h], n * 2); n++;
    };
    const id = p.tex == null ? -1 : p.tex === 'font' ? 3 + p.clut : TEX_ID[p.tex];
    const bil = p.bilinear ? 1 : 0;
    const wr = [p.wrap?.u ? p.wrap.u[0] : -1, p.wrap?.u ? p.wrap.u[1] : 0, p.wrap?.v ? p.wrap.v[0] : -1, p.wrap?.v ? p.wrap.v[1] : 0];
    if (p.kind === 'sprite') {                   // GS sprite: corners, flat colour, UV linear in screen space
      const [[x0, y0, u0, v0], [x1, y1, u1, v1]] = p.v;
      const q = [[x0, y0, u0, v0], [x1, y0, u1, v0], [x0, y1, u0, v1], [x1, y1, u1, v1]];
      for (const i of [0, 1, 2, 2, 1, 3]) put(...q[i], p.c, id, bil, wr);
    } else if (p.kind === 'strip') {             // 4-vertex triangle strip, gouraud
      for (const i of [0, 1, 2, 2, 1, 3]) { const v = p.v[i]; put(v[0], v[1], v[2], v[3], p.c[i], id, bil, wr); }
    } else if (p.kind === 'line') {              // GS line strip (PRIM 3, the gauge edge lines)
      // GUESS: each segment as a quad one frame pixel thick across its minor axis, gouraud along it
      // (the GS's line rasteriser, which pixels a line lights and where it ends, is not decoded; see
      // notes/fidelity-audit.md 'HUD edge lines')
      for (let s = 0; s + 1 < p.v.length; s++) {
        const [xa, ya] = p.v[s], [xb, yb] = p.v[s + 1];
        const horiz = Math.abs(xb - xa) >= Math.abs(yb - ya);
        const ox = horiz ? 0 : 0.5, oy = horiz ? 0.5 : 0;
        const q = [[xa - ox, ya - oy, p.c[s]], [xb - ox, yb - oy, p.c[s + 1]], [xa + ox, ya + oy, p.c[s]], [xb + ox, yb + oy, p.c[s + 1]]];
        for (const i of [0, 1, 2, 2, 1, 3]) put(q[i][0], q[i][1], 0, 0, q[i][2], -1, 0, [-1, 0, -1, 0]);
      }
    }
    return n;
  }
  // 0: As <= 1 on every fragment; 1: As > 1 possible; 2: also Cs As > 255 possible (the vertex
  // colours times the texture's largest texel, Cv = Cf Ct >> 7 clamped)
  overOne(p) {
    const cs = p.kind === 'sprite' ? [p.c] : p.c;
    const [ta, tc] = p.tex == null ? [128, 128] : this.texMax[p.tex === 'font' ? 'font' + p.clut : p.tex];
    const a = Math.min(Math.floor(Math.max(...cs.map(c => c[3])) * ta / 128), 255);
    if (a <= 128) return 0;
    const c = Math.min(Math.floor(Math.max(...cs.map(c => Math.max(c[0], c[1], c[2]))) * tc / 128), 255);
    return c * a / 128 > 255 ? 2 : 1;
  }
  // o: output.js hud() mapping (frame px -> target px; o.side: the widehud shift)
  draw(renderer, o) {
    const prims = this.state.prims();
    const tx = x => o.cx + (x - o.x0) * o.kx, ty = y => o.cy + (y - o.y0) * o.ky;
    const c = this.cam;
    c.left = 0; c.right = o.w; c.top = 0; c.bottom = o.h; c.updateProjectionMatrix();
    // All primitives go into one vertex buffer, in the game's order. Pass 0 draws the As <= 1
    // fragments, passes 1 and 2 the As > 1 ones (see the shader), so a batch's passes keep the game's
    // order on every pixel unless a primitive overlaps an earlier As > 1 primitive of the same batch:
    // that starts a new batch. Most batches are one pass-0 draw.
    const batches = [];
    let n = 0, b = null;
    for (const p of prims) {
      const need = p.kind === 'line' ? 6 * (p.v.length - 1) : 6;
      if (n + need > this.max) { console.warn('hud: more than ' + this.max + ' vertices, rest not drawn'); break; }
      const xs = p.v.map(v => v[0]), ys = p.v.map(v => v[1]);
      const bx = [Math.min(...xs) - 1, Math.min(...ys) - 1, Math.max(...xs) + 1, Math.max(...ys) + 1];
      if (!b || b.hiBoxes.some(a => a[0] < bx[2] && bx[0] < a[2] && a[1] < bx[3] && bx[1] < a[3])) {
        b = { start: n, count: 0, hi: 0, hiBoxes: [] }; batches.push(b);
      }
      const hi = this.overOne(p);
      // OPTION widehud: o.side = the canvas's margin beside the 4:3 picture (0 when off / native)
      const d = o.side ? (this.anchors[p.panel] || 0) * o.side : 0;
      const m = this.emit(p, n, d ? x => tx(x) + d : tx, ty, d !== 0);
      b.count += m - n; n = m;
      if (hi) { b.hiBoxes.push(bx); b.hi = Math.max(b.hi, hi); }
    }
    // upload only what changed since the last frame (one bufferSubData per changed attribute)
    for (const [name, a] of Object.entries(this.geo.attributes)) {
      const len = n * a.itemSize, cur = this.attr[name], prev = this.prev[name];
      let same = prev && prev.length === len;
      for (let i = 0; same && i < len; i++) same = prev[i] === cur[i];
      if (same) continue;
      this.prev[name] = cur.slice(0, len);
      a.clearUpdateRanges(); a.addUpdateRange(0, len); a.needsUpdate = true;
      this.uploads++; this.uploadBytes += len * 4;
    }
    for (const bt of batches) {
      this.geo.setDrawRange(bt.start, bt.count);
      this.mesh.material = this.matA; renderer.render(this.scene, c);
      if (bt.hi) { this.mesh.material = this.matB; renderer.render(this.scene, c); }
      if (bt.hi === 2) { this.mesh.material = this.matC; renderer.render(this.scene, c); }
    }
    this.lastBatches = batches.length;
  }
}

// play.js hook: draws after the reticle (the reticle's group is the root of the game's draw list) and
// follows Vincent's HP (FUN_00339988 -> FUN_003adda8 when the status HP changes).
// weapon: aim_core's WeaponSystem (its hudMask = DAT_0046e54c, ammo = the slot's rounds; worker 0214)
export async function setupHud({ output, player, url = 'data/hud/hud.json', camYaw = null, weapon = null }) {
  let data;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
    data = await r.json();
  } catch (e) {
    console.warn('hud: no ' + url + ' (run native/assets/models/export_web_hud.py): ' + e.message);
    return null;
  }
  if (!data.chain) { console.warn('hud: old hud.json (no draw chain): rebuild data/hud'); return null; }
  const layer = new HudLayer(data);
  let st = layer.state;
  const prev = output ? output.hud : null;
  if (output) output.hud = o => { if (prev) prev(o); layer.draw(o.renderer, o); };
  let lastHp = player ? player.hp : null;
  const hits = [];
  let hide = false, pausedAt = null;
  if (!camYaw) console.warn('hud: no camera yaw (CAM+0x178) given: the hit-direction ring turns with yaw 0');
  return {
    layer, get state() { return st; },
    // a soldier's bullet hit Vincent this game frame (enemy_ai playerHandler -> FUN_00567c08): his P+0x90 and
    // the bullet's +0xc0 (where it was fired from); applied in tick()
    hit(vpos, from) { hits.push([vpos, from]); },
    // Restart (checkpoint.js, worker 0201): the stage program's end destroys the HUD (FUN_003ad5e0: vt+0xc) and game
    // state 0x13 builds a new one (FUN_003ad530 -> FUN_003ad618). GUESS: the new HUD's values = hud.json's (the save's
    // RAM; FUN_003ad618's own initial values not translated); the HUD clock (DAT_004f58ec, a system clock: L) runs on.
    // Then the stage loop's state 8 slides the new HUD in (hud_core restartedHud, worker 0203). The page's H aid does the same.
    reset() {
      layer.state = st = restartedHud(data, st.now, st.mnow);
      hits.length = 0; hide = false; lastHp = player ? player.hp : null;
      if (player && player.hp !== st.hp[0]) st.setHP(player.hp, st.hp[1]);
    },
    // FUN_003fdb48(3) at the game over request -> FUN_003ad5b0 (HUD off): the panels slide out (hud_core hideAll);
    // applied in tick() with this frame's clock (as the hits). Called by play.js on gameover.js's 'begin'.
    hideAll() { hide = true; },
    // the page's pause (play.js onPause): no game frames run, but FUN_0023c1f0 (the slides' clock) is real time and
    // runs on through the game's pause (state 0x17 stops only DAT_004f58ec, FUN_003e23f8), so the pause's length is
    // added to mnow when it closes. GUESS: the HUD's group step (FUN_003d5a80) during the pause is not traced; the page
    // steps on the next game frame (fidelity-audit 'HUD slide-in after Restart').
    pause(on) {
      const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (on) pausedAt = t;
      else if (pausedAt != null) { st.mnow = (st.mnow + Math.round(t - pausedAt)) >>> 0; pausedAt = null; }
    },
    // once per game frame, after the frame's damage (enemy_ai tick). GUESS: the HUD clock FUN_0023c1f0
    // advances 20 ms per frame (the same stand-in as aim.js's HUD clock; notes/fidelity-audit.md). The
    // frame's hits (FUN_003af6b8) see this frame's clock, as the ring's update (FUN_003af740, HUD update
    // FUN_003add28) and its draw (FUN_003b0ac0: phase step, then the draw's inputs; +0x234 += 1) do.
    // GUESS: the clock advancing before the frame's game logic (not decoded; it moves a hit's 2 s by one frame at most).
    tick() {
      st.now += 20; st.mnow += 20;                 // both HUD clocks (hud_core HudState: now / mnow)
      if (player && player.hp !== lastHp) { lastHp = player.hp; st.setHP(player.hp, st.hp[1]); }
      // FUN_00339590 (FUN_00323128, once a frame after the objects): DAT_0046e54c bit 1 -> FUN_003ae138 with the
      // slot's rounds, W+0x48 and the reserve, then the mask is cleared (traced w214_dry: the HUD text changes in the
      // same frame as R+0x30)
      if (weapon && (weapon.hudMask & 2)) st.setAmmo(...weapon.ammo.hud());
      if (weapon) weapon.hudMask = 0;
      for (const [p, from] of hits.splice(0)) st.hit(p, from);
      if (hide) { hide = false; st.hideAll(); }
      // the screen update's group step (FUN_003d5a80 -> FUN_003d5d10); its order against the stage loop's hide is
      // not decoded but not visible either (both see this frame's clock; at the start t = 0 is the start position)
      st.slideFrame();
      st.ringFrame(camYaw ? camYaw() : 0);
    },
  };
}
