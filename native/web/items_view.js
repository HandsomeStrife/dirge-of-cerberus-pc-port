// items_view.js -- draws items.js's pickups and drops on play.html (worker 0224), as props_view.js draws the barrels.
// Data (gitignored, tools/byo/build_web.sh): data/items/<model>.glb (export_web_enemy.py --clips ''; names from the ELF
// table FUN_0057f6f8 reads, items.json `models`).
//
// Model matrix (FUN_0057ff80): rotation about y by the item's spin angle (FUN_005a7018 -> FUN_005a7040(0, yaw, 0); save
// RAM r02_barrier: the drop's MP+0x10 row 0 = (cos, 0, -sin) of its angle) at the model's place (FUN_005a7008). Hidden
// while +200 bit 8 (FUN_005a85f8(model, 2)).
// GUESS: the colour FUN_005a86a0 writes (MP+0x41c = (c, c, c, 0x80)) multiplies the texture as the GS's modulate
// (c / 128), unlit as the glb's material; the item models' draw path (VU1 program, lighting) is not traced.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const DIR = 'data/items/';

function place(M, body) {
  const c = Math.cos(M.yaw), s = Math.sin(M.yaw), t = M.pos;
  // rows: r0 (c, 0, -s), r1 (0, 1, 0), r2 (s, 0, c), r3 = t (row vectors, as the game's matrices)
  body.matrix.set(c, 0, s, t[0], 0, 1, 0, t[1], -s, 0, c, t[2], 0, 0, 0, 1);
  body.matrixWorldNeedsUpdate = true;
}

export async function setupItemsView({ root, items }) {
  const models = {};
  const load = m => models[m] ??= new GLTFLoader().loadAsync(DIR + m + '.glb').catch(e => { console.warn(`items: ${m}.glb not drawn:`, e.message); return null; });
  const meshes = new Map();                   // item object -> group
  async function make(o) {
    const g = await load(o.mdl.name);
    if (!g) return null;
    const scn = cloneSkinned(g.scene);
    const mats = [];
    scn.traverse(n => {
      if (!n.isMesh) return;
      n.frustumCulled = false;
      n.material = n.material.clone();
      if (n.material.map) { n.material.map.colorSpace = THREE.NoColorSpace; n.material.map.needsUpdate = true; }
      n.material.side = THREE.BackSide;        // as every model measured so far (props_view.js)
      mats.push(n.material);
    });
    const flip = new THREE.Group(); flip.rotation.x = Math.PI; flip.add(scn);   // glb Y-up -> game -Y-up (enemies.js)
    const body = new THREE.Group(); body.add(flip);
    body.matrixAutoUpdate = false;
    body.userData.mats = mats;
    return body;
  }
  function sync() {
    for (const [o, b] of meshes) if (!items.list.includes(o) || !o.mdl) { if (b) root.remove(b); meshes.delete(o); }
    for (const o of items.list) {
      if (!o.mdl) continue;
      let b = meshes.get(o);
      if (b === undefined) {
        meshes.set(o, null);
        make(o).then(x => { if (meshes.get(o) === null && x) { meshes.set(o, x); root.add(x); upd(o, x); } });
        continue;
      }
      if (b) upd(o, b);
    }
  }
  function upd(o, b) {
    const M = o.mdl;
    if (!M) return;
    b.visible = !M.hidden && !o.gone && !view.hideAll;   // hideAll: setVisibleAll (FUN_00408900; worker 0261)
    place(M, b);
    const k = (M.col || 0) / 128;
    for (const m of b.userData.mats) m.color.setRGB(k, k, k);
  }
  sync();
  const view = { sync, meshes, hideAll: false };
  return view;
}
