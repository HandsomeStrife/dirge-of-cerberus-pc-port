// event_actors.js -- draws the opening event's actors (worker 0218; notes/event-vm-research.md "Event actors").
// The game state (slots, natives, the per-frame update) is event_actor_rt.js; this module loads the exported models
// (export_web_event_actors.py -> data/event/actors) and draws each live actor with the enemies' pipeline: the glb,
// SpeedAnimator's local pose (FUN_005a9db0) from the actor's event motion packs, program D lighting (play.js litPatch).
//
//   body world  = the actor matrix (actor +0x20, FUN_005a6f40 -> MP+0x10; rows axis 0-2, position: three's column-major
//                 read of the game's rows), the clip's bone 1 included (the packs keep the root motion)
//   attached    = FUN_005ab8f0: child MP+0x50 = socket x parent world, socket = FUN_005ad508 -> FUN_0030bef8
//                 (palette[marker bone] x T(marker xyz)); drawn by the parent's draw (FUN_005abec0) with
//                 world = child matrix x socket x parent world (row vectors). A hidden parent draws no child.
//   lights      = FUN_005ab0b0: with the event light set (event_actor_rt.js lights; DAT_004fcaf8 bit 36) lights 0 / 1
//                 and the ambient come from it, light 2 is the room light at the actor point (FUN_0026a710 +
//                 FUN_005ab608, area_stream.js Light2), colours x MP+0x450 / 128.
//   draw order  = FUN_005a7978 links a new MP after the list head: newer actors draw first.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { SpeedAnimator } from './player.js';
import { Light2 } from './area_stream.js';
import { texAnimKey } from './event_actor_rt.js';

const DIR = 'data/event/actors/';
// GUESS: MP+0x450 of the event's actors (not read: no trace of it yet); 128 = unscaled (notes/fidelity-audit.md
// 'GUESS: event actors' MP+0x450')
const SCALE_BYTE = 128;
// GUESS: the actor point for light 2 (FUN_005a72a8: MP+0x10 x the bbox centre) is the actor matrix's position
// (the bbox centre per model is not read; notes/fidelity-audit.md 'GUESS: event actors' light point')

async function json(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

// everything resident before the event starts (the page's loads are at once: event_rt.js 'event loads')
export async function loadEventActors(dir = DIR) {
  const index = await json(dir + 'actors.json');
  const models = {};
  for (const [m, info] of Object.entries(index.models)) {
    const [gltf, side] = await Promise.all([new GLTFLoader().loadAsync(dir + info.glb), json(dir + info.side)]);
    const packs = {};
    for (const [n, p] of Object.entries(info.packs)) {
      const r = await fetch(dir + p.file);
      if (!r.ok) throw new Error(`${p.file}: HTTP ${r.status}`);
      packs[n] = { info: p, buf: await r.arrayBuffer() };
    }
    models[m] = { info, gltf, side, packs, tad: info.texanim ? await loadTexAnimImages(dir, info.texanim) : null };
  }
  return { index, models };
}

// a texture's RGBA texels (row 0 = texel row 0: the glb / PNG images are not flipped, flipY false)
function texels(img) {
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  return { w: img.width, h: img.height, data: g.getImageData(0, 0, img.width, img.height).data };
}

// the texanm source images (export_web_event_actors.py texanims: each the source entry decoded with the target's CLUT)
async function loadTexAnimImages(dir, ta) {
  const out = {};
  for (const [k, f] of Object.entries(ta.images)) {
    const r = await fetch(dir + f);
    if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`);
    out[k] = texels(await createImageBitmap(await r.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }));
  }
  return out;
}

// GUESS: the MP's variant (MP+0x44b) of the event's actors is 0, as their export (notes/fidelity-audit.md 'GUESS:
// event actors' variant'): FUN_00414290 skips a target whose entry +0x22 mask has that bit
const VARIANT = 0;

// worker 0248: an actor's texture animations (FUN_005a9938 -> FUN_005aa9e8 -> FUN_00414290 / FUN_00414568). Each draw
// the game uploads the model's textures (FUN_00259058), then for each animation that is on with wait 0 copies its
// current key's w x h rect at (sx, sy) of the source entry to (dx, dy) of the target entry (GS local -> local,
// BITBLTBUF / TRXPOS / TRXREG / TRXDIR 2), in animation order. Here: each target texture of the actor is its own
// DataTexture = the glb image, then those copies, rebuilt when the set of (animation, key) changes.
function texAnimView(M, prims, warnOnce) {
  const ta = M.info.texanim;
  if (!ta || !M.tad) return null;
  const targets = new Map();                     // target entry -> { tex, base, mats }
  for (const [d, t] of Object.entries(ta.targets)) {
    if ((t.mask >> VARIANT) & 1) continue;       // FUN_00414290: (+0x22 >> variant) & 1 -> no copy
    const mats = prims.map(o => o.material).filter(m => m.map && m.map.name === t.name);
    if (!mats.length) { warnOnce('tadtarget ' + M.info.glb + t.name, `event actors: ${M.info.glb}: texanm target ${t.name} is not one of the model's drawn textures (left out)`); continue; }
    const m0 = mats[0].map;
    M.tadBase ??= {};
    const base = M.tadBase[d] ??= texels(m0.image);
    const tex = new THREE.DataTexture(new Uint8Array(base.data), base.w, base.h, THREE.RGBAFormat);
    tex.colorSpace = THREE.NoColorSpace; tex.flipY = false;
    tex.wrapS = m0.wrapS; tex.wrapT = m0.wrapT; tex.magFilter = m0.magFilter; tex.minFilter = m0.minFilter;
    tex.generateMipmaps = false; tex.needsUpdate = true;
    for (const m of mats) m.map = tex;
    targets.set(+d, { tex, base });
  }
  let sig = '';
  return {
    targets,
    // tex = a.drawn.tex: [animation index, frame] of the copies this draw makes (event_actor_rt.js draw)
    apply(tex) {
      const keys = tex.map(([i, f]) => [i, texAnimKey(ta.anims[i].keys, f)]);
      const s2 = keys.map(x => x.join(':')).join(',');
      if (s2 === sig) return;
      sig = s2;
      for (const t of targets.values()) t.tex.image.data.set(t.base.data);       // FUN_00259058: the textures again
      for (const [i, k] of keys) {
        const an = ta.anims[i], t = targets.get(an.dst), src = M.tad[an.src + '_' + an.dst];
        if (!t || !src) continue;
        const [sx, sy] = an.keys[k], [dx, dy] = an.d, [w, h] = an.wh, D = t.tex.image;
        for (let y = 0; y < h; y++) {
          const ys = sy + y, yd = dy + y;
          if (ys < 0 || ys >= src.h || yd < 0 || yd >= D.height) continue;
          for (let x = 0; x < w; x++) {
            const xs = sx + x, xd = dx + x;
            if (xs < 0 || xs >= src.w || xd < 0 || xd >= D.width) continue;
            const o = (ys * src.w + xs) * 4, q = (yd * D.width + xd) * 4;
            D.data[q] = src.data[o]; D.data[q + 1] = src.data[o + 1]; D.data[q + 2] = src.data[o + 2]; D.data[q + 3] = src.data[o + 3];
          }
        }
      }
      for (const t of targets.values()) t.tex.needsUpdate = true;
    },
    dispose() { for (const t of targets.values()) t.tex.dispose(); },
  };
}

// clipFrames for event_actor_rt.js EventActors
export function clipFramesOf(lib) {
  return (m, n, c) => {
    const M = lib && lib.models[m], p = M && M.packs[n];
    return p && p.info.clipFrames[c] != null ? p.info.clipFrames[c] : null;
  };
}

// weapon: () => a new Object3D of Vincent's weapon (gun.js loadGun's mesh; loadVincentWeapon_l's model 'weapon', worker 0248)
export function createEventActorView({ root, lib, rt, litPatch, light, weapon = null, warn = (m) => console.warn(m) }) {
  const group = new THREE.Group();
  group.name = 'event actors';
  root.add(group);
  const bodies = new Map();                     // actor slot object -> view
  const warned = new Set();
  const warnOnce = (k, m) => { if (!warned.has(k)) { warned.add(k); warn(m); } };
  const s = SCALE_BYTE / 128;
  const mat = new THREE.Matrix4();

  function spawn(a) {
    if (a.lent) return null;                    // a battle actor: the gameplay object draws its own model (stage_controller.js)
    if (a.model === 'weapon') {                 // loadVincentWeapon_l (event_actor_rt.js): the gun mesh, no skeleton
      const g = weapon && weapon();
      if (!g) { warnOnce('weapon', `event actor ${a.id}: Vincent's weapon model not available (left out)`); return null; }
      g.traverse(o => { o.frustumCulled = false; });
      const body = new THREE.Group(); body.add(g); body.matrixAutoUpdate = false;
      group.add(body);
      const c = group.children; c.splice(c.indexOf(body), 1); c.unshift(body);
      return { a, body, pose: null, joints: [], prims: [], U: null, l2: null, files: [], model: { info: { markers: [] } }, tad: null, weapon: true };
    }
    const M = lib.models[a.model];
    if (!M) { warnOnce('model ' + a.model, `event actor ${a.id}: model ${a.model} not exported (left out)`); return null; }
    const scn = cloneSkinned(M.gltf.scene);
    const prims = [];
    scn.traverse(o => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      o.material = o.material.clone();
      const m = o.material;
      if (m.map) { m.map.colorSpace = THREE.NoColorSpace; m.map.needsUpdate = true; }
      m.side = THREE.BackSide;                  // as enemies.js (measured on e027 / e048); GUESS for the other models
      prims.push(o);
    });
    const flip = new THREE.Group(); flip.rotation.x = Math.PI; flip.add(scn);   // glb root Rx 180 undone (enemies.js)
    const body = new THREE.Group(); body.add(flip);
    body.matrixAutoUpdate = false;
    const pose = Object.create(SpeedAnimator.prototype);
    pose.setLocalPose({ bones: M.info.bones, parent: M.info.parent, clips: {} }, new ArrayBuffer(0), scn);
    const joints = pose.lp.joints;
    let U = null, l2 = null;
    if (litPatch) {
      U = {
        uL0: { value: new THREE.Vector3() }, uC0: { value: new THREE.Vector3() },
        uL1: { value: new THREE.Vector3() }, uC1: { value: new THREE.Vector3() },
        uL2: { value: new THREE.Vector3() }, uC2: { value: new THREE.Vector3() },
        uAmb: { value: new THREE.Vector3() },
      };
      for (const o of prims) litPatch(o.material, U);
      l2 = new Light2();
    }
    const v = { a, body, pose, joints, prims, U, l2, files: [], model: M, tad: texAnimView(M, prims, warnOnce) };
    // draw order (FUN_005a7978): in front of the older actors
    group.add(body);
    const c = group.children; c.splice(c.indexOf(body), 1); c.unshift(body);
    return v;
  }

  // a body's own GPU objects: cloned materials and cloneSkinned's skeletons (their bone textures); the glb's
  // geometry / textures are shared with the library and stay
  function freeBody(v) {
    const sk = new Set();
    for (const o of v.prims) { o.material.dispose(); if (o.isSkinnedMesh && o.skeleton) sk.add(o.skeleton); }
    for (const s of sk) s.dispose();
    if (v.tad) v.tad.dispose();
  }

  // the actor's motion packs, in its loadmotion order (FUN_005a7390 takes the first file holding the name)
  function syncPacks(v) {
    const fs = v.a.files;
    if (fs.length === v.files.length && fs.every((n, i) => n === v.files[i])) return;
    if (fs.length < v.files.length || fs.some((n, i) => i < v.files.length && n !== v.files[i])) {
      // an unloadmotion: rebuild the table from the files left
      v.pose.setLocalPose({ bones: v.model.info.bones, parent: v.model.info.parent, clips: {} }, new ArrayBuffer(0), v.body.children[0].children[0]);
      v.files = [];
    }
    for (const n of fs.slice(v.files.length)) {
      const p = v.model.packs[n];
      if (p) v.pose.addLocalPose(p.info, p.buf);
      else warnOnce('pack ' + v.a.model + n, `event actor ${v.a.id} (${v.a.model}): motion file ${n} not exported for this model`);
      v.files.push(n);
    }
  }

  function lightRig(v, p) {
    const L = rt.actors.lights, U = v.U;
    if (!U) return;
    if (L) {
      for (let i = 0; i < 2; i++) {
        const d = L.dir[i], m = Math.hypot(d[0], d[1], d[2]) || 1;
        U['uL' + i].value.set(-d[0] / m, -d[1] / m, -d[2] / m);          // FUN_004450f0: -normalize(dir)
        U['uC' + i].value.set(...L.col[i]).multiplyScalar(s);
      }
      U.uAmb.value.set(...L.amb).multiplyScalar(s);
    } else if (light && light.env) {                                     // not set yet: the env rig (gameplay)
      const E = light.env;
      U.uL0.value.set(...E.dir0); U.uC0.value.set(...E.col0).multiplyScalar(s);
      U.uL1.value.set(0, 0, 0); U.uC1.value.set(0, 0, 0);
      U.uAmb.value.set(...E.ambient).multiplyScalar(s);
    }
    if (light && light.pick && v.l2) {                                   // light 2: the room light (FUN_0026a710)
      v.l2.update(light.pick(p), p);
      U.uL2.value.set(...v.l2.dir); U.uC2.value.set(...v.l2.col);
    }
  }

  // one game frame's pose (event_actor_rt draw step: before the advance)
  function pose(a) {
    let v = bodies.get(a);
    if (!v) { v = spawn(a); bodies.set(a, v); }
    if (!v || v.weapon) return;
    syncPacks(v);
    const mp = a.mp;
    if (mp.clip && v.pose.lp.clips[mp.clip]) v.pose.poseLocal(mp.clip, mp.frame, null, 0, 1);
  }

  // place every body after the update (the MP matrices), attached ones through their parent's socket
  function place() {
    for (const [a, v] of bodies) {
      if (!v) continue;
      if (!rt.actors.slots.includes(a)) {                                // finalize_l: the slot is gone
        group.remove(v.body);
        freeBody(v);
        bodies.delete(a);
      }
    }
    // everything from the draw-time snapshot (event_actor_rt.js draw: a.drawn), not from this frame's update
    const parentOf = new Map();
    for (const a of rt.actors.slots) if (a.drawn) a.drawn.kids.forEach((k, i) => { const c = rt.actors.get(k); if (c) parentOf.set(c, [a, a.drawn.marker[i]]); });
    const placed = new Set();
    group.updateMatrixWorld(true);
    const Ginv = new THREE.Matrix4().copy(group.matrixWorld).invert();
    const placeOne = (a) => {
      if (placed.has(a)) return;
      placed.add(a);
      const v = bodies.get(a);
      if (!v) return;
      if (!a.drawn) { v.body.visible = false; return; }
      mat.fromArray(a.drawn.M);                                        // game rows -> three's column-major
      const par = parentOf.get(a);
      let shown = a.drawn.shown;
      if (par) {
        const [pa, marker] = par;
        placeOne(pa);
        const pv = bodies.get(pa);
        const mk = pv && pv.model.info.markers[marker];
        if (!pv || !mk) { shown = false; warnOnce('marker ' + pa.model + marker, `event actor ${a.id}: no marker ${marker} on ${pa.model}`); }
        else {
          // world = child matrix x socket x parent world (row vectors) = J . T(marker) . C here; body.matrix is
          // relative to the group
          const S = new THREE.Matrix4().makeTranslation(mk[1], mk[2], mk[3]).premultiply(pv.joints[mk[0]].matrixWorld);
          mat.premultiply(S).premultiply(Ginv);
          shown = shown && pv.body.visible;
        }
      }
      v.body.matrix.copy(mat);
      v.body.visible = shown;
      if (v.tad && a.drawn.tex) v.tad.apply(a.drawn.tex);               // the texture animations (worker 0248)
      v.body.updateMatrixWorld(true);                                  // the joints' world for children and light
      lightRig(v, new THREE.Vector3().setFromMatrixPosition(v.body.matrixWorld));
    };
    for (const a of rt.actors.slots) placeOne(a);
  }

  return {
    group, bodies,
    step() { rt.actors.step(pose); place(); },
    dispose() {
      for (const v of bodies.values()) if (v) freeBody(v);
      bodies.clear();
      root.remove(group);
    },
  };
}
