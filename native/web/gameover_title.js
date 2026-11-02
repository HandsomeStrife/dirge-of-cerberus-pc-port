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
      for (const s of out) for (const v of s.verts) {
        const [X, Y, Z] = v.gs, z0 = PROJ.zA / (Z - PROJ.zB);
        v.pos = [(X - PROJ.cx) * z0 / PROJ.fx, (Y - PROJ.cy) * z0 / PROJ.fy, z0];
      }
      return out;
    },
  };
}

// EffectLayer for the title: the sprites from title.sprites(), drawn after the 3D effects' meshes.
export class TitleLayer extends EffectLayer {
  constructor(THREE, title) {
    super(THREE, { sprites: () => title.sprites(), warn: m => title.fx.warn(m) });
    this.group.name = 'gameover-title';
    this.title = title;
    // FUN_002f0250 -> FUN_002ee990(0x4ec060, 0): the depth clear before layer 5. The renderer draws in scene-graph
    // order (sortObjects = false; transparent after opaque), so this transparent mesh, the group's first child,
    // draws just before the title's sprites. It draws no pixel: its onBeforeRender clears the depth buffer (three's
    // clear depth 1 = the far plane, as the GS's Z 0 with GEQUAL).
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    const clear = this.depthClear = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      transparent: true, depthTest: false, depthWrite: false, colorWrite: false }));
    clear.name = 'gameover-title-depth-clear'; clear.frustumCulled = false; clear.visible = false;
    clear.onBeforeRender = renderer => { renderer.state.buffers.depth.setMask(true); renderer.clearDepth(); };
    this.group.add(clear);
  }
  update(camera) {
    super.update(camera);
    // GUESS: FUN_002e2398(5) tests layer 5's draw entries (FUN_002e1e40 / FUN_002e2048); which of the title's
    // particles registers one is not traced, so the page clears while the title's emitter lives (see
    // notes/fidelity-audit.md).
    this.depthClear.visible = this.title.fx.emitters.length > 0;
  }
}
