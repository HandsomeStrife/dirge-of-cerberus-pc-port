// Pause menu on the page: draws pause.js's primitives into the frame (output.hud, after the HUD,
// as the game draws its menus after the HUD) and maps the page keys to the pad.
//
// GS state of the pause draws (dump pause.gs, every draw checked by test_pause.mjs):
//   TEX0 TFX 0 (modulate: Cv = Cf Ct >> 7, Av = Af At >> 7), TCC 1; ABE (Cs - Cd) As + Cd,
//   As = Av / 128; pages 2 / 3 = 'menu3' / 'menu4' PSMT8 (TBP 10828 / 10960), the font PSMT4HH
//   TBP 0 with CLUT 3 / 4 ('$&' glyphs) or CLUT 1 / 2 (FUN_003cd7e8 text); CLAMP REPEAT, or REGION_REPEAT on the stretched pieces (FUN_003c94e0);
//   TEX1 0 (nearest), but 0x60 (bilinear) for the type-12 buttons and their text
//   (FUN_003d75a0 -> FUN_003d3830(1), script flag 0x1e).
// Scale: the primitives are in the GS drawable (432 x 512, 1/16 px); output.js's hud() mapping puts
// them on the page like the reticle and the HUD (native: 1:1; full: the CRTC's 4:3 picture,
// texels sampled at the target resolution: nearest = sharp blocks, bilinear where the game uses it).
// Not reproduced: the GS's 8-bit blend rounding, and As > 1 (font CLUT alpha 0x8f): the blend
// uses min(As, 1), so a glyph core lacks the -(As - 1) Cd term (at most 12% of the colour under it).
// The dimming quad covers the whole target (in full mode the picture is wider than the 4:3 drawable).
import * as THREE from 'three';
import { loadPauseData, PauseFlow } from './pause.js';
import { MenuSound, latchMenuSound } from './audio.js';
import { CROSS_KEY } from './player.js';

const MAXV = 8192;                                // the pause + an open box: ~2.5k vertices

function idxTexture(w, h, hex, perTexel) {
  const a = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) a[i] = parseInt(hex.substr(i * perTexel, perTexel), 16);
  const t = new THREE.DataTexture(a, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false; t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}
function clutTexture(rows) {                       // rows: [[rgba x n] x m]
  const n = rows[0].length, m = rows.length;
  const a = new Uint8Array(n * m * 4);
  rows.forEach((r, j) => r.forEach((c, i) => a.set(c, (j * n + i) * 4)));
  const t = new THREE.DataTexture(a, n, m, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false; t.flipY = false; t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export class PauseLayer {
  constructor(D) {
    this.D = D;
    const T2 = D.textures['2'], T3 = D.textures['3'], F = D.font;
    this.size = { 2: [T2.w, T2.h], 3: [T3.w, T3.h] };
    this.pos = new Float32Array(MAXV * 3);
    this.uv = new Float32Array(MAXV * 2);
    this.col = new Float32Array(MAXV * 4);
    this.mode = new Float32Array(MAXV * 4);        // texture (0 none, 2, 3, 4 font), clut row, linear, -
    this.cl = new Float32Array(MAXV * 4);          // wms, wmt, umsk, ufix
    this.cl2 = new Float32Array(MAXV * 4);         // vmsk, vfix, -, -
    this.sc = new Float32Array(MAXV * 4);          // scissor in target px (x0, y0, x1, y1), y down
    const g = new THREE.BufferGeometry();
    const at = (n, a, k) => g.setAttribute(n, new THREE.BufferAttribute(a, k));
    at('position', this.pos, 3); at('uv', this.uv, 2); at('color', this.col, 4);
    at('mode', this.mode, 4); at('cl', this.cl, 4); at('cl2', this.cl2, 4); at('sc', this.sc, 4);
    this.geo = g;
    this.mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        idx2: { value: idxTexture(T2.w, T2.h, T2.idx, 2) }, clut2: { value: clutTexture([T2.clut]) },
        idx3: { value: idxTexture(T3.w, T3.h, T3.idx, 2) }, clut3: { value: clutTexture([T3.clut]) },
        idxF: { value: idxTexture(F.w, F.h, F.idx, 1) }, clutF: { value: clutTexture(F.cluts) },
        fontV0: { value: F.v0 }, fontH: { value: F.h }, targetH: { value: 1 },
      },
      vertexShader: `precision highp float;
        uniform mat4 projectionMatrix, modelViewMatrix;
        in vec3 position; in vec2 uv; in vec4 color; in vec4 mode; in vec4 cl; in vec4 cl2; in vec4 sc;
        out vec2 vUv; out vec4 vCol; flat out vec4 vMode; flat out vec4 vCl; flat out vec4 vCl2; flat out vec4 vSc;
        void main() { vUv = uv; vCol = color; vMode = mode; vCl = cl; vCl2 = cl2; vSc = sc;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `precision highp float;
        uniform sampler2D idx2, clut2, idx3, clut3, idxF, clutF; uniform int fontV0, fontH; uniform float targetH;
        in vec2 vUv; in vec4 vCol; flat in vec4 vMode; flat in vec4 vCl; flat in vec4 vCl2; flat in vec4 vSc;
        out vec4 o;
        // CLAMP: REPEAT on the texture size, REGION_REPEAT (3): (t & msk) | fix
        int wrap(int t, int size, int m, int msk, int fix) {
          if (m == 3) return (t & msk) | fix;
          return t & (size - 1);
        }
        vec4 texel(int tex, ivec2 p) {
          int u = wrap(p.x, tex == 2 ? 256 : tex == 3 ? 128 : 512, int(vCl.x), int(vCl.z), int(vCl.w));
          int v = wrap(p.y, tex == 4 ? 512 : 128, int(vCl.y), int(vCl2.x), int(vCl2.y));
          if (tex == 2) return texelFetch(clut2, ivec2(int(texelFetch(idx2, ivec2(u, v), 0).r * 255.0 + 0.5), 0), 0);
          if (tex == 3) return texelFetch(clut3, ivec2(int(texelFetch(idx3, ivec2(u, v), 0).r * 255.0 + 0.5), 0), 0);
          int fv = v - fontV0;
          if (fv < 0 || fv >= fontH) return vec4(0.0);
          return texelFetch(clutF, ivec2(int(texelFetch(idxF, ivec2(u, fv), 0).r * 255.0 + 0.5), int(vMode.y) - 1), 0);
        }
        void main() {
          float yd = targetH - gl_FragCoord.y;
          if (gl_FragCoord.x < vSc.x || gl_FragCoord.x >= vSc.z || yd < vSc.y || yd >= vSc.w) discard;
          vec4 c = floor(vCol + 0.5);
          int tex = int(vMode.x);
          if (tex != 0) {
            vec4 t;
            if (vMode.z > 0.5) {                       // TEX1 bilinear: the 4 texels around (u - 0.5, v - 0.5)
              vec2 q = vUv - 0.5; vec2 f = fract(q); ivec2 i0 = ivec2(floor(q));
              vec4 a = texel(tex, i0), b = texel(tex, i0 + ivec2(1, 0));
              vec4 d = texel(tex, i0 + ivec2(0, 1)), e = texel(tex, i0 + ivec2(1, 1));
              t = floor(mix(mix(a, b, f.x), mix(d, e, f.x), f.y) * 255.0 + 0.5);
            } else {
              t = floor(texel(tex, ivec2(floor(vUv))) * 255.0 + 0.5);
            }
            c = vec4(min(floor(c.rgb * t.rgb / 128.0), 255.0), floor(c.a * t.a / 128.0));
          }
          float as = c.a / 128.0;
          o = vec4(c.rgb / 255.0 * min(as, 1.0), min(as, 1.0));   // premultiplied: (Cs - Cd) As + Cd
        }`,
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,          // frame alpha kept
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
  }
  // prims: pause.js output; o: output.js hud() mapping
  draw(renderer, o, prims) {
    const tx = x => o.cx + (x / 16 - o.x0) * o.kx, ty = y => o.cy + (y / 16 - o.y0) * o.ky;
    const sx = px => o.cx + (px - o.x0) * o.kx, sy = py => o.cy + (py - o.y0) * o.ky;
    const full = [sx(0), sy(0), sx(432), sy(512)];                // the game's SCISSOR 0-431 x 0-511
    let n = 0;
    const put = (X, Y, p, pr, texId) => {
      this.pos.set([X, Y, 0], n * 3);
      this.uv.set([p.u / 16, p.v / 16], n * 2);
      this.col.set(p.c, n * 4);
      this.mode.set([texId, pr.clut || 0, pr.linear ? 1 : 0, 0], n * 4);
      const c = pr.clamp;
      this.cl.set(c ? [c.wms, c.wmt, c.umsk, c.ufix] : [0, 0, 0, 0], n * 4);
      this.cl2.set(c ? [c.vmsk, c.vfix, 0, 0] : [0, 0, 0, 0], n * 4);
      const s = pr.dim ? [0, 0, o.w, o.h] : pr.sc ? [sx(pr.sc[0]), sy(pr.sc[1]), sx(pr.sc[2] + 1), sy(pr.sc[3] + 1)] : full;
      this.sc.set(s, n * 4);
      n++;
    };
    for (const pr of prims) {
      if (n + 6 > MAXV) break;
      const texId = pr.tex === null || pr.tex === undefined ? 0 : pr.tex === 'font' ? 4 : pr.tex;
      let q;                                                    // corners TL, TR, BL, BR
      if (pr.kind === 'sprite') {
        const [a, b] = pr.v;
        q = [{ ...b, x: a.x, y: a.y, u: a.u, v: a.v }, { ...b, y: a.y, v: a.v }, { ...b, x: a.x, u: a.u }, b];
      } else q = pr.v;
      const P = pr.dim ? [[0, 0], [o.w, 0], [0, o.h], [o.w, o.h]] : q.map(p => [tx(p.x), ty(p.y)]);
      for (const i of [0, 1, 2, 1, 3, 2]) put(P[i][0], P[i][1], q[i], pr, texId);
    }
    if (!n) return;
    this.mat.uniforms.targetH.value = o.h;
    this.geo.setDrawRange(0, n);
    for (const a of ['position', 'uv', 'color', 'mode', 'cl', 'cl2', 'sc']) this.geo.attributes[a].needsUpdate = true;
    const c = this.cam;
    c.left = 0; c.right = o.w; c.top = 0; c.bottom = o.h; c.updateProjectionMatrix();
    renderer.render(this.scene, c);
  }
}

// Page keys -> the pad (FUN_00255220's binding table, read from RAM): Start = Esc / Enter,
// ✕ = Space (player.js CROSS_KEY, the page's ✕), ○ = Backspace, d-pad = arrows / WASD.
export const PAUSE_KEYS = { start: ['Escape', 'Enter'], cross: [CROSS_KEY], circle: ['Backspace'],
  up: ['ArrowUp', 'KeyW'], down: ['ArrowDown', 'KeyS'], left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'] };

// setupPause({ output, blocked, onPause, onRequest }): loads data/pause.json, chains output.hud,
// listens for keys. blocked(): true while the page must not take keys (the report).
// onPause(active): the world freezes / resumes. onRequest(name): 'restart' | 'tempsave' | 'quit', sent
// when the confirm box is answered OK (pause.js PauseFlow). Tempsave / Quit only warn here: the page has
// no memory card save and no title screen (fidelity-audit "Menus").
// sound: { audio: GameAudio, music: GameMusic } (play.js fills them in once loaded; null / missing = silent): the menu
// sounds (audio.js MenuSound, FUN_003e1d10 / FUN_003e1d90) and FUN_00241f40's pause side (audio setPaused, music
// setVolume 0x30 / 0x7f). notes/audio-research.md "Menu sounds".
export async function setupPause({ output, url = 'data/pause.json', blocked = () => false,
                                   onPause = () => {}, onRequest = () => {}, now = () => performance.now(), sound = null }) {
  let json;
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    json = await r.json();
  } catch (e) {
    console.warn('pause menu: no ' + url + ' (run native/assets/models/export_web_pause.py)');
    return null;
  }
  let D, layer;
  try {                                          // a malformed pause.json: run without the pause menu
    D = loadPauseData(json);
    layer = new PauseLayer(D);
  } catch (e) {
    console.warn('pause menu: bad ' + url + ', running without pause (re-run export_web_pause.py)', String(e));
    return null;
  }
  const t0 = now();
  // GUESS: the pulse phase base DAT_004f55e8 (set when the menu manager's fade FUN_003e0ed0 ends,
  // not on the pause path) = page start. Only the phase of the 1.5 s pulse depends on it.
  const flow = new PauseFlow(D, { pulseBase: 0 });
  const clock = () => Math.floor(now() - t0);    // FUN_0023c1f0: milliseconds
  let wasActive = false;
  // FUN_00241f40 at the pause's creation / destruction: FUN_003ed7d0(0x30 / 0x7f) (BGM volume), FUN_003e86e0 (SE hold)
  const sync = () => {
    if (flow.active === wasActive) return;
    wasActive = flow.active;
    if (sound && sound.music) sound.music.setVolume(wasActive ? 0x30 : 0x7f);
    if (sound && sound.audio) sound.audio.setPaused(wasActive);
    onPause(wasActive);
  };
  // the menu sound latch: what the flow's last action wrote (pause.js lastSE / lastSEW)
  const menuSnd = new MenuSound();
  const latch = () => {
    const id = flow.lastSE, w = flow.lastSEW;
    flow.lastSE = null; flow.lastSEW = null;
    latchMenuSound(menuSnd, id, w);
  };
  const has = (k, code) => PAUSE_KEYS[k].includes(code);
  addEventListener('keydown', e => {
    if (blocked() || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (has('start', e.code)) {
      e.preventDefault();
      if (!e.repeat) { flow.start(clock()); latch(); }
      sync();
      return;
    }
    if (!flow.active) return;
    e.preventDefault();
    e.stopImmediatePropagation();                // the paused game sees no keys
    if (e.repeat) return;                        // presses only: the menu's pad auto-repeat is not decoded (see notes)
    const a = has('cross', e.code) ? 0 : has('circle', e.code) ? 1 : has('up', e.code) ? 2
      : has('down', e.code) ? 3 : has('left', e.code) ? 4 : has('right', e.code) ? 5 : -1;
    if (a < 0) return;
    const r = flow.input(a, clock(), 0);           // kind 0: the pad (no wrap at the list ends)
    latch();
    if (r && r.request) {
      if (r.request !== 'restart') console.warn('pause: ' + r.request + ' confirmed; the page has no ' +
        (r.request === 'quit' ? 'title screen' : 'memory card save') + ' (box closed, nothing done)');
      onRequest(r.request);
    }
    sync();
  }, { capture: true });
  const prev = output ? output.hud : null;
  if (output) output.hud = o => {
    if (prev) prev(o);
    const t = clock();
    const prims = flow.frame(t);
    sync();
    // FUN_003e1d90, once a frame (the menu manager FUN_003dce38)
    const au = sound && sound.audio;
    if (au && !menuSnd.names && au.res && au.res.menu) menuSnd.names = au.res.menu;
    menuSnd.frame(t, au && au.ctx ? (n, x, y) => au.playMenu(n, x, y) : null);
    if (prims) layer.draw(o.renderer, o, prims);
  };
  return { flow, layer, menuSound: menuSnd, get active() { return flow.active; } };
}
