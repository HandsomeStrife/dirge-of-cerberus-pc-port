// shot_fx.js - what the game draws for a shot with a model: Dragonfly's rockets and the z128 boss's missiles (worker 0270;
// notes/other-types.md 'The rockets drawn'). enemy_ai.js calls start / move / end (opts.shotFx) at the game's points:
//   start  FUN_00554568's tail: FUN_00554850 -> FUN_00553f48 (bullet +400 = FUN_00408b30(record +0x84), the model by name;
//          record +0xc8, a motion, is empty for every z128 record) and FUN_005534f0 (+0x140 nibble 0, a record: with a model
//          and record +0x78 bit 0x20 clear, or without a model, +0x188 = FUN_003358b8(record, 0) = FUN_003366b8(record +0xac),
//          the trail; then FUN_00557e40)
//   move   FUN_005549f0's tail after a moved update (the end frame too): FUN_00554058 sets the model's matrix (FUN_0054a5e8 =
//          the bullet's rows +0x60 .. +0x90, rows 0 and 2 negated, +0x9c = 1; FUN_005a6f40), FUN_00557e40 -> FUN_00557c68 ->
//          FUN_003350c0(+0x188, the rows: 0 and 2 negated) -> FUN_002e7660(flag 0x10) (effects.js setMatrix)
//   end    FUN_005529a8 (the delete): FUN_00335210(+0x188) = FUN_002e7198 (effects.js softEnd), FUN_00553fe0 frees the model
//          and FUN_0033cf00(+0x18c) stops the flight sound (enemy_ai stops it at the delete; here for clear(): a Restart)
// Not translated (warned): record +0x78 bit 0x20 (the trail on the model, FUN_00336748: no record here has it), bullet +0x120
// bit 2 (FUN_00335020 placing instead).
// The tracer (worker 0278; notes/effects-research.md 'Bullet tracers'): FUN_005534f0 with +0x140 nibble 0 and no record (Vincent's
// bullets: FUN_005408e8 -> FUN_00553630 leaves +0x194 = 0), or a record with no trail (+0x188 == -1: record +0xac == -1) and no
// model name (+0x84): +0x198 = FUN_002d77c0(0, (+0x120 & 0x400) == 0) (the soldiers' records 0-11, 13-16, 21, 24). Pool DAT_004e8e00
// (32 slots; full: the dummy &_gp_11, not in the draw list), draw list DAT_0050b528 in spawn order (FUN_002d78a0 closes the gap).
// Set by FUN_00557e40 -> FUN_00557d70(bullet, +0x90, +0xe0) at the spawn and after each moved update (FUN_005549f0's tail), freed
// by FUN_005529a8 -> FUN_002d7678 -> FUN_002d78a0 at the delete; drawn by effects.js drawTracer (fx.addDraw).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Light2 } from './area_stream.js';
import { drawTracer } from './effects.js';

const DIR = 'data/event/actors/';             // w011.glb: the cutscene export (export_web_event_actors; heri_taijou holds w011)
// GUESS: the model's MP+0x450 light scale and its light-2 point (FUN_005ab0b0 at the MP bbox centre) are not read for w011:
// 128 (props_view's) and the glb's bounding-box centre (notes/fidelity-audit.md 'Rocket model light')
const SCALE_BYTE = 128;
const f = Math.fround;

// the game's 16-float rows (row r at [4r .. 4r + 3]) -> a three.js matrix (columns = the game's rows)
function setRows(m, M) {
  m.set(M[0], M[4], M[8], M[12], M[1], M[5], M[9], M[13], M[2], M[6], M[10], M[14], 0, 0, 0, 1);
}
// rows 0 and 2 negated (FUN_00554058 and FUN_003350c0 both: pxor with the sign bit), row 3's w = 1
function flip02(M) {
  const o = M.slice();
  for (const k of [0, 1, 2, 3, 8, 9, 10, 11]) o[k] = -o[k];
  o[15] = 1;
  return o;
}

export function createShotFx({ root, fx = null, world = () => null, litPatch = null, light = null, stopSound = null, loadModel = null, warn = m => console.warn(m) }) {
  const warned = new Set();
  const warnOnce = m => { if (!warned.has(m)) { warned.add(m); warn(m); } };
  const models = {};
  // the export's index (actors.json): a model it doesn't list is warned, not fetched (no 404: w010 / w024 are in no cutscene)
  // loadModel (tests): name -> a gltf-like { scene } in place of the export
  const index = loadModel ? null : fetch(DIR + 'actors.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
  const load = name => models[name] ??= (loadModel ? Promise.resolve(loadModel(name)) : index.then(ix => {
    if (!ix || !ix.models || !ix.models[name]) { warnOnce(`shots: model ${name} not exported (data/event/actors/actors.json): its shots drawn without it`); return null; }
    return new GLTFLoader().loadAsync(DIR + name + '.glb');
  })).then(g => {
    if (!g) return null;
    const box = new THREE.Box3().setFromObject(g.scene), c = box.getCenter(new THREE.Vector3());
    return { g, centre: [c.x, -c.y, -c.z] };                   // glb Y-up -> the model's axes (the flip below)
  }).catch(e => { warnOnce(`shots: model ${name} not drawn (${e.message}; export the event actors)`); return null; });
  const live = new Map();                                     // bullet -> { body, em, U, l2, centre, tr }
  const tracers = [];                                         // DAT_0050b528[0 .. DAT_0046c6f0)
  const TRACERS = 32;                                         // DAT_004e8e00: 0x20 slots of 0x30
  // FUN_002d77c0(model, colour): +8 = 1.0, +0x28 = -1.0, the rest 0 (FUN_0030ae48(0x4ec8d0, 7): the texture's use count)
  function tracerNew(colour) {
    const t = { model: 0, colour, len: 1, pos: [0, 0, 0], dir: [0, 0, -1] };
    if (tracers.length < TRACERS) tracers.push(t);           // full: the dummy (written, never drawn)
    return t;
  }
  // FUN_00557d70(bullet, a = +0x90, b = +0xe0): v = a - b; L = 0.01 with +0x120 bit 0x400000 (set by FUN_00552dd8, cleared by
  // FUN_005549f0 before its FUN_00557e40: only the spawn's call has it), else |v|; +0x10 = a (FUN_002d7698), +0x20 = -(v x
  // VRSQRT) (FUN_002d76a8), +8 = L x 0.1 (FUN_002d76d8)
  function tracerSet(t, a, b, spawn) {
    const v = [f(a[0] - b[0]), f(a[1] - b[1]), f(a[2] - b[2])], l = f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]));
    const L = spawn ? f(0.01) : f(Math.sqrt(l)), q = l ? f(1 / Math.sqrt(l)) : 3.4028234663852886e38;
    t.pos = a.slice(0, 3);
    t.dir = v.map(x => -f(x * q));
    t.len = f(L * f(0.1));
  }
  if (fx && fx.addDraw) fx.addDraw((view, out, proj) => { for (const t of tracers) drawTracer(fx.core, fx.tex, t, view, proj, out, warnOnce); });
  const s = SCALE_BYTE / 128;

  function makeBody(v, M) {
    const scn = cloneSkinned(M.g.scene);
    const prims = [];
    scn.traverse(n => {
      if (!n.isMesh) return;
      n.frustumCulled = false;
      n.material = n.material.clone();
      if (n.material.map) { n.material.map.colorSpace = THREE.NoColorSpace; n.material.map.needsUpdate = true; }
      n.material.side = THREE.BackSide;                        // as enemies.js / props_view.js (GUESS for w011, not measured)
      prims.push(n);
    });
    const flip = new THREE.Group(); flip.rotation.x = Math.PI; flip.add(scn);   // glb Y-up -> game -Y-up (enemies.js)
    const body = new THREE.Group(); body.add(flip);
    body.matrixAutoUpdate = false;
    body.name = 'shot ' + v.name;
    if (light && litPatch) {
      const E = light.env;
      v.U = {
        uL0: { value: new THREE.Vector3(...E.dir0) }, uC0: { value: new THREE.Vector3(...E.col0).multiplyScalar(s) },
        uL1: { value: new THREE.Vector3() }, uC1: { value: new THREE.Vector3() },
        uL2: { value: new THREE.Vector3() }, uC2: { value: new THREE.Vector3() },
        uAmb: { value: new THREE.Vector3(...E.ambient).multiplyScalar(s) },
      };
      for (const n of prims) litPatch(n.material, v.U);
      v.l2 = new Light2();
    }
    v.centre = M.centre;
    v.prims = prims;
    v.body = body;
    root.add(body);
  }

  function place(v, M) {
    if (!v.body) return;
    const W = flip02(M);
    setRows(v.body.matrix, W);
    v.body.matrixWorldNeedsUpdate = true;
    if (v.l2) {
      const p = new THREE.Vector3(...v.centre).applyMatrix4(v.body.matrix);
      v.l2.update(light.pick(p), p);
      v.U.uL2.value.set(...v.l2.dir); v.U.uC2.value.set(...v.l2.col);
    }
  }

  function start(b) {
    const R = b.rec;
    if (R && R.model == null) { warnOnce('shots: ai.json weapons have no model / fx_trail (rebuild data/enemies): rockets and tracers not drawn'); return; }
    const v = { name: R ? R.model : '', body: null, em: null, M: null, gone: false, tr: null };
    live.set(b, v);
    if (!R) {                                                 // FUN_005534f0 with +0x194 == 0: the tracer only
      v.tr = tracerNew((b.f120 & 0x400) ? 0 : 1);
      tracerSet(v.tr, b.pos, b.prev, true);                   // FUN_00557e40 (bit 0x400000 still set)
      return;
    }
    if (R.model) {
      load(R.model).then(M => { if (M && !v.gone) { makeBody(v, M); if (v.M) place(v, v.M); } });
      if (R.f78 & 0x20) warnOnce('shots: record +0x78 bit 0x20 (the trail on the model, FUN_00336748) not translated');
    }
    // FUN_005534f0: the trail (record +0xac != -1); none on the model path with bit 0x20 (above)
    if (fx && R.fx_trail !== -1 && !(R.model && (R.f78 & 0x20))) {
      v.em = fx.spawn(R.fx_trail >>> 0, b.pos);
      if (!v.em) warnOnce(`shots: trail 0x${(R.fx_trail >>> 0).toString(16)} not spawned (its FED not loaded: export_web_effects.py)`);
    }
    if (b.f120 & 2) warnOnce('shots: bullet +0x120 bit 2 (FUN_00557c68 places the trail by FUN_00335020) not translated');
    // no trail (record +0xac == -1, so +0x188 == -1) and no model name: the tracer
    if (!R.model && R.fx_trail === -1) { v.tr = tracerNew((b.f120 & 0x400) ? 0 : 1); tracerSet(v.tr, b.pos, b.prev, true); return; }
    move(b);                                                  // FUN_005534f0 ends with FUN_00557e40
  }

  function move(b) {
    const v0 = live.get(b);
    if (v0 && v0.tr) { tracerSet(v0.tr, b.pos, b.prev, false); return; }   // FUN_00557e40: +0x198 != -1 -> FUN_00557d70 only
    const v = v0, w = world();
    if (!v || !w || !w.bulletMatrix) return;
    const M = w.bulletMatrix(b);
    v.M = M;
    place(v, M);                                              // FUN_00554058
    if (v.em && fx) fx.setMatrix(v.em, flip02(M));           // FUN_003350c0 -> FUN_002e7660(flag 0x10)
  }

  function end(b) {
    const v = live.get(b);
    if (!v) return;
    live.delete(b);
    v.gone = true;
    if (v.tr) { const i = tracers.indexOf(v.tr); if (i >= 0) tracers.splice(i, 1); }   // FUN_005529a8 -> FUN_002d7678 -> FUN_002d78a0
    if (b.snd && stopSound) { stopSound(b.snd); b.snd = null; }       // FUN_005529a8 -> FUN_0033cf00(+0x18c): the flight sound (asj_354)
    if (v.em && fx) fx.softEnd(v.em);                         // FUN_00335210 -> FUN_002e7198
    if (v.body) {                                             // FUN_00553fe0 -> FUN_005a7d88(model, 3)
      root.remove(v.body);
      for (const n of v.prims) { n.material.dispose(); if (n.skeleton) n.skeleton.dispose(); }   // cloneSkinned's own skeletons (bone textures)
    }
  }

  // a new world (Restart): the old bullets' models go with it (their trails go with the effect manager's reset)
  // A Restart: the flight sounds are ended before the reload by its IOP command 0x23 (FUN_00380b00 = FUN_003e7f60(-1, -1, -1);
  // audio.js restartSe: every SE playing finishes its release). Whether the reload then frees the bullets through FUN_005529a8 ->
  // FUN_0033cf00 is not decoded, and changes nothing heard: a stop request on an ended SE does nothing (GameAudio.fade)
  function clear() { for (const b of [...live.keys()]) end(b); }

  return { start, move, end, clear, live, tracers, preload: name => load(name) };
}
