// props_view.js -- draws props.js's barrels (gimmick model e057) on play.html, as enemies.js draws the soldiers.
// Data (gitignored, tools/byo/build_web.sh): data/props/e057.glb / e057.json (export_web_enemy.py --clips '': the
// model's one smd group 'kan1Shap', 48 triangles, one joint; texture e057_1 64x128).
//
// Model matrix: FUN_00583848 makes the barrel's motion player (by the type's model name) and FUN_005842c8 places it:
// with type flag bit 4 (e057: set) the object matrix gets a local translate (0, size / 2, 0) first (shape 2: +0x1c x 0.5
// = 7.5), so the model (y 0 .. -15, its base at the origin) stands on the floor under the centre (+0x90). FUN_005a6f40
// -> MP+0x10. Save RAM, record 17: object +0x90 y -147.5, MP+0x10 row 3 y -140.0 (the floor).
// Lighting: the motion player's rig as the soldiers' (VU1 program D via play.js litPatch, env slot MP+0x44e = 0,
// MP+0x450 = 128 -> x 1.0; save RAM). GUESS: drawn with program D like every motion player (its draw path for this
// MP is not traced), light 2 picked at the MP bbox centre (MP+0x90 .. +0xa0 = (-15,-30,-15) .. (15,0,15) in the save:
// model (0, -15, 0)), as enemies.js. GUESS: THREE.BackSide, as every model measured so far (no GS dump draws a barrel).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { Light2 } from './area_stream.js';

const DIR = 'data/props/';
const SCALE_BYTE = 128;                       // MP+0x450 (save RAM, record 17's barrel)
const LIGHT_POINT = { e057: [0, -15, 0] };   // MP bbox centre in model space (save RAM, the barrel)

// light 2 (FUN_005ab0b0 + FUN_005ab608, area_stream.js Light2) at the MP bbox centre, at creation and every game frame
// in sync() (worker 0216; was once, at creation)
function light2(light, l2, body, U) {
  const p = body.userData.lightPoint.clone().applyMatrix4(body.matrix);
  l2.update(light.pick(p), p);
  U.uL2.value.set(...l2.dir); U.uC2.value.set(...l2.col);
}

// FUN_005842c8: T(0, h / 2, 0) x the object matrix (rows, row 3 = +0x90), as a three.js column-major matrix
function place(o, body) {
  const [r0, r1, r2] = o.m, r3 = o.pos, hh = (o.type.flags >> 4) & 1 ? o.h * 0.5 : 0;
  const t = [r3[0] + r1[0] * hh, r3[1] + r1[1] * hh, r3[2] + r1[2] * hh];
  body.matrix.set(r0[0], r1[0], r2[0], t[0], r0[1], r1[1], r2[1], t[1], r0[2], r1[2], r2[2], t[2], 0, 0, 0, 1);
  body.matrixWorldNeedsUpdate = true;
}

export async function setupPropsView({ root, props, litPatch, light }) {
  const models = {};
  const load = m => models[m] ??= new GLTFLoader().loadAsync(DIR + m + '.glb').catch(e => { console.warn(`props: ${m}.glb not drawn:`, e.message); return null; });
  const meshes = new Map();                   // barrel object -> group
  const s = SCALE_BYTE / 128;
  async function make(o) {
    const g = await load(o.model);
    if (!g) return null;
    const scn = cloneSkinned(g.scene);
    const prims = [];
    scn.traverse(n => {
      if (!n.isMesh) return;
      n.frustumCulled = false;
      n.material = n.material.clone();
      if (n.material.map) { n.material.map.colorSpace = THREE.NoColorSpace; n.material.map.needsUpdate = true; }
      n.material.side = THREE.BackSide;
      prims.push(n);
    });
    const flip = new THREE.Group(); flip.rotation.x = Math.PI; flip.add(scn);   // glb Y-up -> game -Y-up (enemies.js)
    const body = new THREE.Group(); body.add(flip);
    body.matrixAutoUpdate = false;
    // GUESS: a model without a measured MP bbox (g048, the EM barrier base: worker 0269) takes its glb's box centre
    // (game axes: y negated by the flip) for light 2 (not read from RAM; notes/fidelity-audit.md)
    if (LIGHT_POINT[o.model]) body.userData.lightPoint = new THREE.Vector3(...LIGHT_POINT[o.model]);
    else { const c = new THREE.Box3().setFromObject(scn).getCenter(new THREE.Vector3()); body.userData.lightPoint = new THREE.Vector3(c.x, -c.y, -c.z); }
    place(o, body);
    if (light && litPatch) {
      const dir = new THREE.Vector3(), col = new THREE.Vector3();
      const E = light.env;
      const U = {
        uL0: { value: new THREE.Vector3(...E.dir0) }, uC0: { value: new THREE.Vector3(...E.col0).multiplyScalar(s) },
        uL1: { value: new THREE.Vector3() }, uC1: { value: new THREE.Vector3() },
        uL2: { value: dir }, uC2: { value: col },
        uAmb: { value: new THREE.Vector3(...E.ambient).multiplyScalar(s) },
      };
      for (const n of prims) litPatch(n.material, U);          // a skinned mesh (one joint), as the soldiers' bodies
      body.userData.light2 = { l2: new Light2(), U };
      light2(light, body.userData.light2.l2, body, U);
    }
    return body;
  }
  // FUN_00583848 makes the model at activation; 0x10a / FUN_0053fa08 destroys the object and its model
  async function sync() {
    // a Restart rebuilds the barrels (props.attach): the old objects' models go
    for (const [o, b] of meshes) if (!props.barrels.includes(o)) { if (b) root.remove(b); meshes.delete(o); }
    for (const o of props.barrels) {
      const want = o.drawn && !o.gone;
      let b = meshes.get(o);
      if (want && b === undefined) {
        meshes.set(o, null);                  // loading
        b = await make(o);
        meshes.set(o, b);
        if (b) root.add(b);
      }
      if (b) {
        b.visible = o.drawn && !o.gone; place(o, b);
        if (b.userData.light2) { light2(light, b.userData.light2.l2, b, b.userData.light2.U); }
      }   // (a moved barrel: the page tests' aid; cmd 0x121 re-runs FUN_005842c8)
    }
  }
  await sync();
  return { sync, meshes };
}
