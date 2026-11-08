// The menu boxes' effects (worker 0241; notes/message-research.md "Box effects"): the stage-info boxes' effect slots
// (stage_info.js StageBox, results.js's Status box) on the menu effect managers, drawn with the GAME OVER title's layer.
//   FUN_003c58b8 (slot spawn): FUN_003c5c50 first (the slot's old emitter goes: FUN_002e6920(.., 0)), the id through
//     FUN_003e27d0 (FUN_0051bdc0: a remap for languages 3..6; the page's language is 2: identity), the manager by
//     FUN_002f0878 (id >> 28 == 8: (id >> 18) & 0x3ff in {0x5d, 0xe0, 0xfd, 0x109, 0x115} -> DAT_004ee580, else
//     DAT_004ee4a0), FUN_002e62b0(0, mgr, id, { flag 1, position (x, y) }).
//   FUN_003c5a98 (a slot's life is over): FUN_002e7198, the soft end (effects.js softEnd: the emitter fades out).
//   FUN_003c5b00 (a slot moving, results' command 5): FUN_002e7660(flag 1, the interpolated position).
//   FUN_003c5cc0 (the box goes): every slot's emitter goes (FUN_003c5c50; soft-ended ones have left their slots and fade on).
//     FUN_003fdd58 -> FUN_003b6978 -> vt+0x34 FUN_003b7930 -> FUN_003d4588(box, 100, 0): +0x25 == 0 (RAM: w258 b40 / b120,
//     w220 open330) -> FUN_003d4630: only +0x10 |= 1, which also stops the box's update (FUN_003dd9f8). FUN_003c5428 (vt+0xc) ->
//     FUN_003c5cc0 runs from FUN_003de938 in the menu update: after FUN_002efe98, before the draw (state 9, the queue).
// The box code runs in the menu update (FUN_003dce38, after FUN_002efe98 in FUN_00248110), so the managers are in state
// 9 then: a spawn is aged at once by 1.0 and drawn in its first frame (effects.js spawn's tail). The page queues the
// box's slot operations of the frame (the box runs at the page's frame start, stage_info.js) and applies them after
// end(): the same state.
// Draw: every menu-box emitter here is camera 1 (categories 5 / 7: the 2D camera), drawn in effect layers 4 / 5 (slots
// 0x11a..0x121 / 0x12a..0x131: the panels, the item picture, the rank letters). The frame loop draws layers 3 / 4
// (FUN_002f00c0), the menus' pass 0 (FUN_003dcf58(0): the HUD and the box text), layer 5 (FUN_002f0250), pass 1, layer 6.
// GUESS: the page draws both layers in the 3D pass after the 3D effects, before the HUD pass (TitleLayer): layer 5
// draws under the box text instead of over it (notes/fidelity-audit.md 'Menu-box effects').
import { createEffects, EffectRng, PROJ } from './effects.js';
import { TitleLayer } from './gameover_title.js';

export const MGR_A = 0x4ee4a0, MGR_B = 0x4ee580;
// FUN_002f0878 for an id with id >> 28 == 8 (the menu / 2D FEDs)
export function menuManager(id) {
  const k = (id >>> 18) & 0x3ff;
  return (k === 0x5d || k === 0xe0 || k === 0xfd || k === 0x109 || k === 0x115) ? MGR_B : MGR_A;
}

// feds: ArrayBuffers of the menu FEDs (data/stage_info.fed = a0211, data/results.fed = a0093). rng: the 3D effects'
// EffectRng (the shared LCG DAT_004e9400 / VU0 R; reseeded by the 3D manager's begin) or null (a private one).
export function createMenuFx(feds, { rng = null, warn = console.warn } = {}) {
  const own = !rng;
  rng ??= new EffectRng();
  const quiet = m => { if (own && /^effects: no (rand\(\)|effect twister)/.test(m)) return; warn(m); };
  const by = new Map();
  for (const b of feds) {
    if (!b) continue;
    const code = new DataView(b).getUint32(4, true) >>> 0, m = menuManager(code);
    if (!by.has(m)) by.set(m, []);
    by.get(m).push(b);
  }
  // GUESS: the two managers' order in DAT_004ee8c0 (FUN_002efc78 / FUN_002efe98's walk) is taken as A then B (only the
  // order of their draws from the shared LCG depends on it; one menu box runs at a time)
  const mgrs = new Map();
  for (const m of [MGR_A, MGR_B]) {
    const L = by.get(m);
    if (L) mgrs.set(m, createEffects({ fed: L[0], stage: L.slice(1), rng, reseed: false, warn: quiet }));
  }
  const slots = new Map();                          // box slot -> emitter
  const queue = [];
  let warned = new Set();
  const warnOnce = m => { if (!warned.has(m)) { warned.add(m); quiet(m); } };
  const kill = k => { const em = slots.get(k); if (em) { mgrs.get(em.mgr)?.remove(em); slots.delete(k); } };
  const apply = op => {
    if (op.clear) { for (const k of [...slots.keys()]) kill(k); return; }
    if (op.remove !== undefined) { kill(op.remove); return; }
    if (op.end !== undefined) { const em = slots.get(op.end); if (em) { mgrs.get(em.mgr).softEnd(em); slots.delete(op.end); } return; }
    if (op.move !== undefined) { const em = slots.get(op.move); if (em) em.p120 = [Math.fround(op.x), Math.fround(op.y), em.p120[2], em.p120[3]]; return; }
    if (op.spawn !== undefined) {
      kill(op.spawn);
      const id = op.id >>> 0, m = menuManager(id), fx = mgrs.get(m);
      if (!fx) { warnOnce(`menu fx: no FED for id 0x${id.toString(16)} (export_web_stageinfo.py / export_web_results.py)`); return; }
      // FUN_003c58b8's position block holds x, y as floats; its third word is stack data (not written there): the
      // page's z is 0. Only camera-0 emitters would read it: they are spawned (their channels draw the RNGs) but not drawn.
      const em = fx.spawn(id, [op.x, op.y, 0]);
      if (!em) return;                                            // FUN_002e62b0 < 0: the slot keeps no emitter
      em.mgr = m;
      if (em.cat !== 1) em.noDraw = 'a camera-0 menu effect (FUN_003c58b8: the position\'s z is stack data)';
      slots.set(op.spawn, em);
    }
  };
  const all = () => { const out = []; for (const fx of mgrs.values()) out.push(...fx.emitters); return out; };
  return {
    mgrs, slots,
    op(o) { queue.push(o); },
    // FUN_002efc78 (the frame's start): the managers' FUN_002e9f98
    begin(step) { for (const fx of mgrs.values()) fx.begin(step); },
    // FUN_002efe98, then the menu update's slot operations of this frame (state 9)
    end() { for (const fx of mgrs.values()) fx.end(); for (const o of queue.splice(0)) apply(o); },
    reset() { queue.length = 0; slots.clear(); for (const fx of mgrs.values()) fx.reset(); },
    // what TitleLayer reads: fx.emitters / fx.warn, sprites() with camera-1 corners moved to camera 0's view space at
    // their GS depth (as gameover_title.js createTitle)
    title: {
      fx: { get emitters() { return all(); }, warn: warnOnce },
      sprites() {
        const out = [];
        for (const fx of mgrs.values()) out.push(...fx.sprites({}));
        for (const s of out) for (const v of s.verts ?? []) {
          if (!v.gs || v.gs.length < 3) continue;
          const [X, Y, Z] = v.gs, z0 = PROJ.zA / (Z - PROJ.zB);
          v.pos = [(X - PROJ.cx) * z0 / PROJ.fx, (Y - PROJ.cy) * z0 / PROJ.fy, z0];
        }
        return out;
      },
    },
  };
}

// The layer (a TitleLayer over the menu managers, its screen-fixed draw): add layer.group to the 3D scene after the 3D effects;
// update() once a game frame after end()
export function menuFxLayer(THREE, mfx, { output = null } = {}) {
  const L = new TitleLayer(THREE, mfx.title, { screen: output });
  L.group.name = 'menu-box-effects';
  // worker 0265: the event fade (output.fade; GUESS row 'the event fade's draw') is a particle of the effect managers, which draw
  // before the menu managers (FUN_002efe98's order), so these effects (the stage title card over the opening's black) are drawn
  // over it: the veil is drawn here, first in the group, and output.js skips its own for that frame
  if (output) {
    const veil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { a: { value: 0 } }, transparent: true, depthTest: false, depthWrite: false,
      vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform float a; void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, a); }' }));
    veil.frustumCulled = false; veil.name = 'event-fade';
    veil.onBeforeRender = () => { veil.material.uniforms.a.value = Math.min(1, Math.max(0, output.fade)); output.fadeDrawn = true; };
    L.group.add(veil); L.group.children.unshift(L.group.children.pop());
  }
  return L;
}
