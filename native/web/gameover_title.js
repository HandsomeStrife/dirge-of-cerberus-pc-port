// The GAME OVER title and its backdrop (worker 0198; notes/gameover-research.md "Title FED").
// The game draws it with the ordinary effect engine (effects.js), not a separate 2D runtime:
//   FUN_003fdf00 (game over, type 3) -> FUN_0037f2f0(stage, 0x61, 0x31000f5, 0x81840000, 0): queues stage request
//   0x18 -> FUN_00381a08: reads file 0x31000f5 (a0097.fed), FUN_002f1990 registers it, FUN_002e6290(0,
//   FUN_002f0878(), 0x81840000) spawns group 0 entry 0. FUN_002f0878: id >> 28 == 8 and (id >> 18) & 0x3ff = 0x61
//   -> the manager DAT_004ee4a0 (run after DAT_004ee2e0 in FUN_002efc78's list). Its emitter has category 5, so
//   emitter byte +1 = 1: camera 1 (the 2D camera, effects.js CAM2D) and FUN_002e7cd0's screen path.
//   Restart (FUN_00534a98, result 6) kills it: FUN_002f2098(0x81840000).
// Drawn here: the draw type 10 sprites (the letters, the grid), checked against the w198 GS dumps (f964 / f1046 /
// f1146: corners < 0.1 px, RGBA and ALPHA exact) and the particles against RAM (states f1046 / f1147).
// Not drawn (warned by effects.js): draw types 11 (FUN_0027a170, a mesh through FUN_002f2f08), 20 (FUN_0027b300),
// 35 (FUN_00278b50: the letter glow, rendered through frame-buffer pages), 103 (FUN_002aa120), 119 (FUN_002b4f70).
// The title's GS draws are depth-tested (TEST 0x5000d: ZTST GEQUAL, no Z write), but the game first clears the depth
// buffer: the title's emitter (category 5) draws in effect layer 5, and FUN_002f0250 (called by the frame loop
// FUN_00248110 after the 3D effects' FUN_002f00c0) does, when FUN_002e2398(5) finds a draw entry in layer 5's slots
// 0x12a..0x131 of DAT_004eb680: FUN_002ee990(0x4ec060, 0) -> FUN_002ee5c0: 8 GS SPRITEs over the whole 448 x 512 screen
// with TEST 0x32001 (alpha NEVER, AFAIL ZB_ONLY, ZTST ALWAYS) at Z 0 (the w198 dumps: 16 triangles just before the
// letters, in all five dumps; none in the gameplay dumps), then FUN_002e20f0(5) draws the layer. So every title draw
// passes its depth test. The page does the same: the title's group starts with a mesh that clears the depth buffer
// (TitleLayer below), and the title draws after the scene and the 3D effects, before the HUD pass (the dumps' order).
import { createEffects, EffectLayer, EffectRng, PROJ } from './effects.js';

// MEASURED (w198 states at counters 906 / 965 / 1046 / 1147, age 1.2 a frame): the title spawns in the 14th game
// frame after the game-over request's frame (request: page frame 880 = trace record 881; spawn: page frame 894 =
// state counter 895): the two file reads of FUN_003fdf00 / FUN_00381a08 on PCSX2's emulated disc. GUESS: the page
// reads nothing at that moment (the file is loaded with the page) and keeps the measured delay.
export const TITLE_DELAY = 14;
export const TITLE_ID = 0x81840000;

// fed: ArrayBuffer of gameover_title.fed. rng: the 3D effects' EffectRng (shared global LCG DAT_004e9400) or null.
// The translated part of the title draws nothing from the effect RNG (test_gameover: 0 calls over 300 frames), so
// without one it gets a private EffectRng and the engine's no-rand() / no-twister warnings are dropped here.
export function createTitle(fed, { rng = null, warn = console.warn, id = TITLE_ID } = {}) {
  const own = !rng;
  const quiet = m => { if (own && /^effects: no (rand\(\)|effect twister)/.test(m)) return; warn(m); };
  const fx = createEffects({ fed, rng: rng ?? new EffectRng(), reseed: false, warn: quiet });
  let wait = -1, em = null, prevStarted = false;
  return {
    fx,
    get emitter() { return em; },
    get wait() { return wait; },
    // the frame's start (FUN_002efc78 -> FUN_002e9f98 for DAT_004ee4a0)
    begin(step) { fx.begin(step); },
    // after the game-over logic of the frame (gameover.js frame): started = DAT_0047dbb4 (FUN_003fdb48 ran)
    logic(started) {
      if (started && !prevStarted) wait = TITLE_DELAY;             // the request's frame
      else if (wait > 0 && --wait === 0) { em = fx.spawn(id, [0, 0, 0]); wait = -1; }
      prevStarted = started;
    },
    // after the frame's logic (FUN_002efe98)
    end() { fx.end(); },
    // FUN_002f2098(id): FUN_002e5c60 finds the emitter, FUN_002e4b70 removes it (Restart's answer; H on the page)
    kill() { fx.emitters.length = 0; em = null; wait = -1; },
    reset() { this.kill(); prevStarted = false; },
    // the draw (once a game frame): sprites with each corner moved from camera 1's screen to camera 0's view space
    // at the GS depth it has (z0 = zA / (Z - zB)), so the page camera puts it on the same screen point and depth
    sprites() {
      const out = fx.sprites({});
      for (const s of out) for (const v of s.verts ?? []) {        // type 35 glows carry GS boxes, not corners (TitleLayer)
        const [X, Y, Z] = v.gs, z0 = PROJ.zA / (Z - PROJ.zB);
        v.pos = [(X - PROJ.cx) * z0 / PROJ.fx, (Y - PROJ.cy) * z0 / PROJ.fy, z0];
      }
      return out;
    },
  };
}

// EffectLayer for the title: the sprites from title.sprites(), drawn after the 3D effects' meshes.
// output (worker 0202): the output stage (output.js), for the type 35 glows: its renderer and the previous frame.
// screen (worker 0258): the output stage for the screen-fixed draw alone (the menu boxes, menu_fx.js: no glows, no kept frame).
// FUN_002e3300: camera 1's draws use the 2D camera's own view and projection, nothing of camera 0, so they are fixed on the
// screen. The quads are written once a game frame in the view space of a fixed camera (view2d: the identity) and drawn through
// the gameplay projection of the current output mode (proj2d), not the render camera's matrices: those interpolate between
// game frames (follow.update), the death camera moves them and an event camera replaces them, fov included.
export class TitleLayer extends EffectLayer {
  constructor(THREE, title, { output = null, screen = output } = {}) {
    super(THREE, { sprites: () => title.sprites(), warn: m => title.fx.warn(m) });
    this.group.name = 'gameover-title';
    this.title = title;
    this.output = output;
    this.view2d = new THREE.Camera();
    this.proj2d = { value: new THREE.Matrix4() };
    this.fit = new THREE.PerspectiveCamera();
    this.fitOutput = screen;
    this.vp = new THREE.Vector4();
    // the glows draw after every title sprite (w198 g4: all type-10 sprites, then the glows; sortObjects = false, so
    // scene-graph order): their own group, moved to the end of the title's group each update (the sprite pool grows)
    this.glowGroup = new THREE.Group(); this.glowGroup.name = 'gameover-title-glows';
    // FUN_002f0250 -> FUN_002ee990(0x4ec060, 0): the depth clear before layer 5. The renderer draws in scene-graph
    // order (sortObjects = false; transparent after opaque), so this transparent mesh, the group's first child,
    // draws just before the title's sprites. It draws no pixel: its onBeforeRender clears the depth buffer (three's
    // clear depth 1 = the far plane, as the GS's Z 0 with GEQUAL).
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    const clear = this.depthClear = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      transparent: true, depthTest: false, depthWrite: false, colorWrite: false }));
    clear.name = 'gameover-title-depth-clear'; clear.frustumCulled = false; clear.visible = false;
    clear.onBeforeRender = (renderer, scene, camera) => { this.fitProj(renderer, camera); renderer.state.buffers.depth.setMask(true); renderer.clearDepth(); };
    this.group.add(clear);
  }
  // the title's textures draw bilinear (TEX1 0x61 on every title TEX0 in w198 g4: 2e00 / 3000 / 2f00 / 37c0); the 3D
  // effects' EffectLayer stays nearest
  texture(t) { return this.linearTexture(t); }
  // the gameplay projection (fitCamera(.., null)) of the page camera (output.gameCam). Full mode: the game draws these and the
  // menus into one frame buffer, so the x scale is the menu draw's (output.js drawHud's kx, h / 319.125 for a GS column; the
  // fov's is h / 341.33, 1.0695 less); y is already its ky. camera: only without an output stage (its projection as is).
  fitProj(renderer, camera) {
    const out = this.fitOutput;
    if (!out) { if (camera) this.proj2d.value.copy(camera.projectionMatrix); return; }
    const c = this.fit, g = out.gameCam;
    c.userData.fov0 = g.userData.fov0; c.near = g.near; c.far = g.far;
    out.fitCamera(c);
    this.proj2d.value.copy(c.projectionMatrix);
    if (!out.native) {
      renderer.getCurrentViewport(this.vp);
      this.proj2d.value.elements[0] = 2 * (4 / 3) * this.vp.w / out.cols * PROJ.fx / this.vp.z;
    }
  }
  screenFixed(m) {
    if (m && !m.uniforms.proj2d) {
      m.uniforms.proj2d = this.proj2d;
      m.vertexShader = 'uniform mat4 proj2d; ' + m.vertexShader.replace('projectionMatrix * modelViewMatrix', 'proj2d');
    }
    return m;
  }
  material(t, alpha) { return this.screenFixed(super.material(t, alpha)); }
  lineMaterial(alpha) { return this.screenFixed(super.lineMaterial(alpha)); }
  update() {
    // before the draw pass: the frame copy has to be on from the title's first frame (output.js keep runs in render)
    if (this.output) this.output.keepFrame = this.title.fx.emitters.length > 0;
    super.update(this.view2d);
    this.group.remove(this.glowGroup); this.group.add(this.glowGroup);
    // GUESS: FUN_002e2398(5) tests layer 5's draw entries (FUN_002e1e40 / FUN_002e2048); which of the title's
    // particles registers one is not traced, so the page clears while the title's emitter lives (see
    // notes/fidelity-audit.md).
    this.depthClear.visible = this.title.fx.emitters.length > 0;
  }
  // Type 35 (effects.js drawGlow, FUN_00278b50), once a game frame. Per glow, as the GS does it (w198 dump g4, four
  // draws a letter): a size x size page (WebGLRenderTarget; the game's 64 x 64 at TBP 0x2a00) gets in one pass
  //   RGB = the previous frame (output.prevFrame = FBP 112) at the copy's ST (bilinear: TEX1 0x61), every texel;
  //   A = the record's texel alpha x its vertex alpha / 128 inside the record's page rectangle, else 0 (the clear;
  //       ALPHA 0x48 writes As; the copy's FBMSK 0xff000000 keeps it),
  // then the page is drawn at each box (ST 0.01 .. 0.99, bilinear, REPEAT: CLAMP 0), MODULATE with the glow's RGBA
  // (texel x colour / 128), alpha test GREATER 0, the GS ALPHA blend. Texel centres: page pixel p samples at p + 0.5
  // (output.js GUESS: GS sample point = GL pixel centre). The title's draws all pass the depth test after layer 5's
  // clear (TitleLayer.depthClear), so the glow is drawn without one. Screen points go through proj2d at the glow's view depth
  // (as title.sprites()): the draw-back lands where the sprites do and the copy reads the prev frame at that same pixel.
  glows(list, camera) {
    const THREE = this.THREE, out = this.output, prev = out && out.prevFrame && out.prevProj ? out.prevFrame : null;
    this.gpool ??= [];
    if (list.length && !(out && out.renderer)) this.title.fx.warn('game over: the GAME OVER glow needs the output stage (TitleLayer output): not drawn');
    while (this.gpool.length < list.length) this.gpool.push(this.glowMeshes());
    this.gpool.forEach((G, i) => { G.mesh.visible = i < list.length && !!prev && !!(out && out.renderer); });
    if (!prev || !out || !out.renderer) return;
    camera.updateMatrixWorld();
    const v3 = new THREE.Vector3();
    // GS screen (X, Y) at view depth z (camera-0 projection PROJ, as title.sprites) -> world / prev-frame UV
    this.fitProj(out.renderer);
    const world = (X, Y, z) => v3.set((X - PROJ.cx) * z / PROJ.fx, -(Y - PROJ.cy) * z / PROJ.fy, -z).applyMatrix4(camera.matrixWorld).clone();
    // the copy's texel: the game copies FBP 112 at the same screen pixels it draws at, so the copy is tied to the screen,
    // not the world: the GS screen point as a view-space point (camera-0 projection PROJ, as title.sprites) through proj2d,
    // the same place in the kept frame (fbRT in native mode, the canvas in full mode) as the draw-back on the screen, whatever
    // camera or fov drew that frame
    const uvOf = (X, Y, z) => { const w = v3.set((X - PROJ.cx) * z / PROJ.fx, -(Y - PROJ.cy) * z / PROJ.fy, -z).applyMatrix4(this.proj2d.value); return [(w.x + 1) / 2, (w.y + 1) / 2]; };
    const r = out.renderer, rt0 = r.getRenderTarget(), ac = r.autoClear;
    list.forEach((s, i) => {
      const G = this.gpool[i], z = s.z;
      if (G.rt.width !== s.size) G.rt.setSize(s.size, s.size);
      // the page pass
      const U = G.page.material.uniforms, st = s.copy.st, F = [1824, 1792];   // ST x 512 = frame px; + the frame's XYOFFSET = GS
      const a0 = uvOf(st[0] * 512 + F[0], st[1] * 512 + F[1], z), a1 = uvOf(st[2] * 512 + F[0], st[3] * 512 + F[1], z);
      U.frame.value = prev;
      U.fuv0.value.set(a0[0], a0[1]); U.fuvd.value.set((a1[0] - a0[0]) / s.size, (a1[1] - a0[1]) / s.size);
      const q = s.page[0];
      if (q) {
        U.letter.value = this.linearTexture(q.tex); U.la.value = q.rgba[3];
        U.lp0.value.set(q.x[0], q.y[0]); U.lp1.value.set(q.x[1], q.y[1]);
        U.luv0.value.set(q.uv0[0], q.uv0[1]); U.luv1.value.set(q.uv1[0], q.uv1[1]);
      } else U.la.value = 0;
      if (s.page.length > 1) this.title.fx.warn('game over: glow records with more than one sprite: only the first drawn into the page');
      r.autoClear = false; r.setRenderTarget(G.rt); r.render(G.page.scene, G.page.cam);
      // the draw-back (the first box; more repeats: warned)
      if (s.boxes.length !== 1) this.title.fx.warn(`game over: glow with ${s.boxes.length} repeats: only the first drawn`);
      const [X0, Y0, X1, Y1] = s.boxes[0].map(x => x / 16), P = G.mesh.geometry.attributes.position.array;
      [[X0, Y0], [X1, Y0], [X0, Y1], [X1, Y1]].forEach(([X, Y], j) => { const w = world(X, Y, z); P[3 * j] = w.x; P[3 * j + 1] = w.y; P[3 * j + 2] = w.z; });
      G.mesh.geometry.attributes.position.needsUpdate = true;
      const m = this.glowMaterial(s.alpha);
      if (!m) { G.mesh.visible = false; return; }
      G.mesh.material = m.get(G);
      G.mesh.material.uniforms.page.value = G.rt.texture;
      G.mesh.material.uniforms.tint.value.set(...s.rgba);
      G.mesh.renderOrder = 1000 + (this.ord?.get(s) ?? i);
    });
    r.setRenderTarget(rt0); r.autoClear = ac;
  }
  linearTexture(t) {
    const THREE = this.THREE;
    this.ltex ??= new Map();
    let g = this.ltex.get(t.k);
    if (!g) {
      g = new THREE.DataTexture(t.rgba, t.W, t.H, THREE.RGBAFormat);
      g.magFilter = g.minFilter = THREE.LinearFilter; g.wrapS = g.wrapT = THREE.RepeatWrapping;   // TEX1 0x61, CLAMP 0
      g.flipY = false; g.needsUpdate = true;
      this.ltex.set(t.k, g);
    }
    return g;
  }
  glowMeshes() {
    const THREE = this.THREE;
    const rt = new THREE.WebGLRenderTarget(64, 64, { depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, type: THREE.UnsignedByteType });
    const pm = new THREE.ShaderMaterial({
      uniforms: { frame: { value: null }, fuv0: { value: new THREE.Vector2() }, fuvd: { value: new THREE.Vector2() },
        letter: { value: null }, la: { value: 0 }, lp0: { value: new THREE.Vector2() }, lp1: { value: new THREE.Vector2() },
        luv0: { value: new THREE.Vector2() }, luv1: { value: new THREE.Vector2() } },
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `uniform sampler2D frame, letter; uniform vec2 fuv0, fuvd, lp0, lp1, luv0, luv1; uniform float la;
        void main() {
          vec2 pc = gl_FragCoord.xy;                     // page pixel centre, page row y = GL row y
          vec3 rgb = texture2D(frame, fuv0 + pc * fuvd).rgb;
          float a = 0.0;
          if (la > 0.0 && pc.x >= lp0.x && pc.x < lp1.x && pc.y >= lp0.y && pc.y < lp1.y) {
            vec2 uv = luv0 + (pc - lp0) / (lp1 - lp0) * (luv1 - luv0);
            a = floor(floor(texture2D(letter, uv).a * 255.0 + 0.5) * la / 128.0);
          }
          gl_FragColor = vec4(rgb, a / 255.0);
        }`,
      depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    const pq = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), pm); pq.frustumCulled = false;
    const page = { scene: new THREE.Scene(), cam: new THREE.Camera(), material: pm };
    page.scene.add(pq);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0.01, 0.01, 0.99, 0.01, 0.01, 0.99, 0.99, 0.99]), 2));   // ST 0.01 .. 0.99
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const mesh = new THREE.Mesh(g); mesh.frustumCulled = false; mesh.name = 'gameover-title-glow';
    this.glowGroup.add(mesh);
    return { rt, page, mesh };
  }
  // the draw-back: MODULATE (texel x colour / 128, GS units), alpha test GREATER 0, premultiplied (Cs x As) with the
  // GS ALPHA blend: 0x48 Cs As + Cd, 0x44 (Cs - Cd) As + Cd, 0x42 Cd - Cs As; others warned
  glowMaterial(alpha) {
    const THREE = this.THREE;
    this.gmats ??= new Map();
    if (this.gmats.has(alpha)) return this.gmats.get(alpha);
    let dst, eq = THREE.AddEquation;
    if (alpha === 0x48) dst = THREE.OneFactor;
    else if (alpha === 0x44) dst = THREE.OneMinusSrcAlphaFactor;
    else if (alpha === 0x42) { dst = THREE.OneFactor; eq = THREE.ReverseSubtractEquation; }
    else { this.title.fx.warn(`game over: glow GS ALPHA 0x${(alpha >>> 0).toString(16)} not translated: not drawn`); this.gmats.set(alpha, null); return null; }
    const proto = new THREE.ShaderMaterial({
      uniforms: { page: { value: null }, tint: { value: new THREE.Vector4() } },
      vertexShader: 'varying vec2 vSt; void main() { vSt = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D page; uniform vec4 tint; varying vec2 vSt;
        void main() {
          vec4 t = floor(texture2D(page, vSt) * 255.0 + 0.5), c = min(floor(t * tint / 128.0), 255.0);
          if (c.a <= 0.0) discard;
          float a = c.a / 128.0;
          gl_FragColor = vec4(c.rgb / 255.0 * a, min(a, 1.0));
        }`,
      transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: eq, blendSrc: THREE.OneFactor, blendDst: dst,
    });
    const per = new WeakMap(), m = { get: G => { let x = per.get(G); if (!x) { x = this.screenFixed(proto.clone()); per.set(G, x); } return x; } };
    this.gmats.set(alpha, m);
    return m;
  }
}
