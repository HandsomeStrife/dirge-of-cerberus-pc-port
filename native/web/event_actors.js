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

// The index at once; a model and its motion packs load when an event asks (worker 0261: the library is hundreds of MB, an event uses a few): Actor.load_l / loadmotion_l hold
// their handle until they're in (event_actor_rt.js), as the game's loads take time; `preload` { models: { name: [files] } } = before the first frame (the opening's, whose timing is traced with no waits).
// trim(keep): a model no slot uses goes (the game's unloads: battle()'s FUN_00376c80 frees them)
export async function loadEventActors(dir = DIR, { preload = null } = {}) {
  const index = await json(dir + 'actors.json');
  const models = {};
  const pack = (M, n) => {
    const P = M.packs[n];
    if (!P) return Promise.resolve();
    return P.ready ??= fetch(dir + P.info.file).then(r => { if (!r.ok) throw new Error(`${P.info.file}: HTTP ${r.status}`); return r.arrayBuffer(); }).then(b => { P.buf = b; })
      .catch(e => { P.failed = true; console.warn(`event actors: pack ${P.info.file} not loaded: ${e.message}`); });
  };
  for (const [m, info] of Object.entries(index.models)) {
    const packs = {};
    for (const [n, p] of Object.entries(info.packs)) packs[n] = { info: p, buf: null, ready: null };
    models[m] = { info, gltf: null, side: null, packs, tad: null, ready: null };
  }
  const ensure = (m) => {
    const M = models[m];
    if (!M) return Promise.resolve();
    return M.ready ??= Promise.all([new GLTFLoader().loadAsync(dir + M.info.glb), json(dir + M.info.side), M.info.texanim ? loadTexAnimImages(dir, M.info.texanim) : null, ...(M.info.resident || []).map(n => pack(M, n))])
      .then(([gltf, side, tad]) => { M.gltf = gltf; M.side = side; M.tad = tad; })
      .catch(e => { M.failed = true; console.warn(`event actors: ${m} not loaded: ${e.message}`); });
  };
  const ensurePack = (m, n) => (models[m] ? pack(models[m], n) : Promise.resolve());
  // keep: what a slot still holds; the opening's preload stays too (a Restart with no record replays it, and intro.js's runtime has no loads to wait on)
  const trim = (keep) => {
    for (const [m, M] of Object.entries(models)) {
      const held = keep.includes(m), open = preload && preload.models[m];
      for (const [n, P] of Object.entries(M.packs)) {
        if (held || (open && (open.includes(+n) || (M.info.resident || []).includes(n)))) continue;
        P.buf = null; P.ready = null; P.failed = false;
      }
      if (held || open) continue;
      M.failed = false;
      if (!M.gltf) { M.ready = null; continue; }
      M.gltf.scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
      M.gltf = null; M.side = null; M.tad = null; M.ready = null;
    }
  };
  const lib = { index, models, ensure, ensurePack, trim };
  if (preload) await Promise.all(Object.entries(preload.models).map(async ([m, files]) => { await ensure(m); if (models[m]) await Promise.all(files.map(n => pack(models[m], n))); }));
  return lib;
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
    if (M.failed) { warnOnce('failed ' + a.model, `event actor ${a.id}: model ${a.model} didn't load (left out)`); return null; }
    if (!M.gltf) { if (lib.ensure) lib.ensure(a.model); return null; }          // not in yet: next frame (a slot without its handle's wait)
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
    v.cape = capeOf(v, scn, U);
    // draw order (FUN_005a7978): in front of the older actors
    group.add(body);
    const c = group.children; c.splice(c.indexOf(body), 1); c.unshift(body);
    return v;
  }

  // ---- the cape (worker 0280; notes/story-cutscenes.md 'Vincent's cape in events')
  // FUN_005ab8f0 draws every MP, an event-loaded one too, through FUN_005b2ef8, which calls FUN_005b2550 for each smd list
  // entry of the MP's variant: FUN_005b06d0 (the cloth vertices' keyed targets, all influences) and FUN_005b0d30 (the cloth
  // step) run for any block whose cloth count (smd +0xe) is not 0. p000 (07700001.bin) has one such block, 0x19f70: the
  // cape, the same bytes as gameplay Vincent's (07703201.bin 0x19ed0; one relocated pointer differs), which is
  // data/vincent/cloth.json's source. The enemies' pipeline that exports the event models can't decode a cloth block
  // (no skin batches), so p000.glb has no cape; play.js lends vincent.glb's cape corners and materials (lib.cape) and
  // each body runs its own cloth.js CapeCloth, as the game keeps a cloth buffer per block. p005's cape is an ordinary
  // skinned block (+0xe = 0) and is in its glb. The skeletons are the same (93 joints, equal inverse binds), so
  // cloth.json's bind-model points skin on the event body as on Vincent's.
  const CLOTH_BLOCK = { p000: '0x19f70' };     // model -> the cloth block in its smd list (actors.json blocks)
  function capeOf(v, scn, U) {
    const blk = CLOTH_BLOCK[v.a.model], C = lib.cape;
    const list = v.model.info.blocks || [];
    if (!blk) {
      // p001 has cloth blocks of its own (07700041.bin 0xe910 / 0x17100 / 0x1dec0), not exported
      if (v.a.model === 'p001') warnOnce('cloth p001', `event actor ${v.a.id} (p001): its cloth blocks are not exported (not drawn)`);
      return null;
    }
    if (!C) { warnOnce('cape', `event actor ${v.a.id} (${v.a.model}): no cape source (play.js lib.cape; ?cloth=0 or no data/vincent/cloth.json): cape not drawn`); return null; }
    const skm = v.prims.find(o => o.isSkinnedMesh);
    const ci = list.indexOf(blk);
    if (!skm || ci < 0) { warnOnce('cape ' + v.a.model, `event actor ${v.a.id} (${v.a.model}): no skeleton / no block ${blk}: cape not drawn`); return null; }
    const cloth = new C.CapeCloth(C.data);
    const n = C.data.corner_vertex.length, N3 = cloth.N * 3;
    const geom = new THREE.BufferGeometry();
    for (const [k, at] of Object.entries(C.attributes)) geom.setAttribute(k, at);      // uv / colour: shared, read-only
    const posAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const nrmAttr = C.normals ? new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage) : null;
    geom.setAttribute('position', posAttr);
    if (nrmAttr) geom.setAttribute('normal', nrmAttr);
    // draw order: FUN_005b2ef8 walks the smd list from its last entry; the glb's triangles are in that order
    // (export_web_enemy.decode), so the cape goes after the triangles of the entries behind it in the list
    let before = 0;
    for (const g of v.model.side.groups) {
      const b = list.indexOf(g.name.slice(g.name.indexOf('@') + 1, g.name.lastIndexOf('.')));
      if (b > ci) before += g.triangles;
    }
    const parent = skm.parent;
    const at = parent.children.filter(o => v.prims.includes(o) && (o.geometry.userData?.firstTri ?? 0) < before).pop();
    let i = at ? parent.children.indexOf(at) + 1 : 0;
    const meshes = [];
    for (const m of C.materials()) {                  // pass 1, then the GS alpha-fail pass (play.js gsAlphaPasses)
      const o = new THREE.Mesh(geom, m);
      o.name = v.a.model + ' cape'; o.frustumCulled = false; o.userData = { cloth: true };
      if (U && litPatch) litPatch(m, U, true);       // program D with the cloth buffer's normals, the actor's own rig
      parent.children.splice(i++, 0, o); o.parent = parent;
      meshes.push(o);
    }
    const sk = skm.skeleton, bind = skm.bindMatrix, tmp = new THREE.Matrix4(), inv = new THREE.Matrix4();
    const bones = [...new Set(C.data.skin.map(r => r[1]))], mats = new Map();
    const nrm = new Float32Array(N3);
    return {
      cloth, meshes, geom, block: ci, req: undefined,
      // one game frame, after place() set the body's matrices: FUN_005b2550's FUN_005b06d0 + FUN_005b0d30 at the draw
      // pose, then FUN_005aa5b8's decrement and the facing check of the matrix the update set (cloth.js frame order)
      frame(fx) {
        for (const b of bones) mats.set(b, tmp.multiplyMatrices(sk.bones[b].matrixWorld, sk.boneInverses[b]).multiply(bind).toArray());
        const skinMat = b => mats.get(b);
        cloth.frame({ skinMat, fx });
        inv.copy(parent.matrixWorld).invert();
        const e = inv.elements, P = cloth.pos, out = posAttr.array, cv = C.data.corner_vertex;
        for (let k = 0; k < n; k++) {
          const j = 3 * cv[k], x = P[j], y = P[j + 1], z = P[j + 2];
          out[3 * k] = e[0] * x + e[4] * y + e[8] * z + e[12];
          out[3 * k + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          out[3 * k + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
        }
        posAttr.needsUpdate = true;
        if (nrmAttr) {                                // FUN_005b06d0's normal half: the keyed target's, never the cloth's
          cloth.skinNormals(skinMat, nrm);
          const o = nrmAttr.array;
          for (let k = 0; k < n; k++) {
            const j = 3 * cv[k], x = nrm[j], y = nrm[j + 1], z = nrm[j + 2];
            o[3 * k] = e[0] * x + e[4] * y + e[8] * z; o[3 * k + 1] = e[1] * x + e[5] * y + e[9] * z; o[3 * k + 2] = e[2] * x + e[6] * y + e[10] * z;
          }
          nrmAttr.needsUpdate = true;
        }
      },
    };
  }

  // a clip request seen at the draw (FUN_005a91c8 -> FUN_005a95f0): the window bytes of the clip's own pack
  // (actors.json clothWindows, export_web_event_actors.py), else cloth.json's (Vincent's gameplay clips). Armed at the
  // request, drawn or not (FUN_005a95f0 runs in the request, not in the draw). A lent actor's slot holds the object's own
  // MP (stage_controller.js getbattleactor), so the request arms that MP's window too: the gameplay cape's (a.lent.cloth,
  // play.js vinBattle), which the page keeps as a separate CapeCloth (worker 0280 review)
  function capeRequest(v) {
    const c = v.cape, mp = v.a.mp;
    if (c.req === mp.req) return;
    c.req = mp.req;
    if (!mp.clip) return;
    const h = rt.actors.findClip(v.a, mp.clip), p = h && v.model.packs[h.n];
    const w = p && p.info.clothWindows ? p.info.clothWindows[mp.clip] : undefined;
    if (!w && !c.cloth.windows[mp.clip]) warnOnce('window ' + mp.clip, `event actor ${v.a.id} (${v.a.model}): clip ${mp.clip} has no cloth window bytes (re-run export_web_event_actors.py); the window is left as it was`);
    c.cloth.clipStart(mp.clip, w || c.cloth.windows[mp.clip]);
    if (v.a.lent && v.a.lent.cloth) v.a.lent.cloth.clipStart(mp.clip, w || c.cloth.windows[mp.clip]);
  }

  // a body's own GPU objects: cloned materials and cloneSkinned's skeletons (their bone textures); the glb's
  // geometry / textures are shared with the library and stay
  function freeBody(v) {
    const sk = new Set();
    if (v.cape) { v.cape.geom.dispose(); for (const o of v.cape.meshes) o.material.dispose(); }
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
      if (p && p.failed) { warnOnce('pack ' + v.a.model + n, `event actor ${v.a.id} (${v.a.model}): motion file ${n} didn't load`); v.files.push(n); continue; }
      if (p && !p.buf) { if (lib.ensurePack) lib.ensurePack(v.a.model, n); return; }   // in order: this one's next frame
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

  // MP+0x180 (hide_model_l): FUN_005b2ef8 skips the smd list entries whose bit is set. The glb's corners are per triangle in
  // draw order, so a primitive's index gives each triangle's number; the sidecar's groups name their block (worker 0261)
  function applyMask(v) {
    const mask = v.a.partMask;
    if (mask === (v.mask || 0)) return;
    v.mask = mask;
    const info = v.model.info, tb = [];
    for (const g of v.model.side.groups) {
      const b = (info.blocks || []).indexOf(g.name.slice(g.name.indexOf('@') + 1, g.name.lastIndexOf('.')));
      if (b < 0) warnOnce('block ' + g.name, `event actor ${v.a.id} (${v.a.model}): group ${g.name}: no smd list entry (not hidden)`);
      for (let k = 0; k < g.triangles; k++) tb.push(b);
    }
    for (const o of v.prims) {
      const src = o.userData.fullGeometry || (o.userData.fullGeometry = o.geometry);
      if (!mask) { if (o.geometry !== src) { o.geometry.dispose(); o.geometry = src; } continue; }
      const I = src.index.array, keep = [];
      for (let i = 0; i < I.length; i += 3) { const b = tb[Math.floor(I[i] / 3)]; if (b < 0 || !((mask >>> b) & 1)) keep.push(I[i], I[i + 1], I[i + 2]); }
      if (o.geometry !== src) o.geometry.dispose();
      const g2 = new THREE.BufferGeometry();                             // the attributes are shared, only the index is the actor's
      for (const k of Object.keys(src.attributes)) g2.setAttribute(k, src.attributes[k]);
      g2.setIndex(keep);
      o.geometry = g2;
    }
  }

  // one game frame's pose (event_actor_rt draw step: before the advance)
  function pose(a) {
    // a battle actor (stage_controller.js getbattleactor): the slot holds the object's own MP. The page keeps two bodies, so until the event
    // gives it a clip the gameplay body stands for it; from then on the slot's body poses (worker 0262)
    if (a.lent && !a.mp.clip) return;
    let v = bodies.get(a);
    if (!v) { v = spawn(a); bodies.set(a, v); }
    if (a.lent && v) a.lent.show(false);             // every frame: the gameplay body can appear after the lend (its model still loading), and a setVisible before the clip shows it
    if (!v || v.weapon) return;
    syncPacks(v);
    applyMask(v);
    const mp = a.mp;
    // a set behind loadchr's mask (event_actor_rt.js findClip): its pack joins when asked for
    if (mp.clip && !v.pose.lp.clips[mp.clip]) { const h = rt.actors.findClip(a, mp.clip), p = h && (a.late || []).includes(h.n) ? v.model.packs[h.n] : null; if (p && p.buf) v.pose.addLocalPose(p.info, p.buf); }
    if (mp.clip && v.pose.lp.clips[mp.clip]) v.pose.poseLocal(mp.clip, mp.frame, null, 0, 1);
    if (v.cape) capeRequest(v);
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
        if (!pv || !mk || !pv.joints[mk[0]]) { shown = false; warnOnce('marker ' + pa.model + marker, `event actor ${a.id}: no marker ${marker} on ${pa.model}`); }
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
      if (v.cape) {
        // FUN_005b2ef8 skips a hidden list entry (MP+0x180, hide_model_l) and FUN_005abec0 a hidden MP: no draw, no cloth step
        const on = shown && !((v.a.partMask >>> v.cape.block) & 1);
        for (const o of v.cape.meshes) o.visible = on;
        const M = a.mp.M;                                              // FUN_005a6f40's facing check: the matrix's x axis (row 0)
        if (on) v.cape.frame(M ? [M[0], M[1], M[2]] : null);
      }
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
