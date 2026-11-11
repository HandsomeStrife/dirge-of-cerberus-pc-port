// Dirge z128, playable: Vincent (data/vincent/vincent.glb) walking the room with
// third-person controls, the game's follow camera (player.js, FUN_0032ace0) and collision (collision.js,
// or the stub). Gameplay is the game's locomotion (player.js) and the ladder action;
// invented behaviour was removed by worker 0078 (notes/fidelity-audit.md).
//
// The room comes from room.js (main.js's loader and shader, with its z-fight fixes).
// Game space, -Y up. URL params: hud=0 (this page's debug text), gamehud=0 (the game's HUD, hud.js), aa=1, dpr=N, col=stub (force the stub),
// cam=ex,ey,ez,yaw,pitch (detached camera at that view; H re-attaches it),
// actions=0 (no action modules), packs=a,b (clip packs to load; default ladder, jump, shoot,
// packs= loads none), zprio=0 / zunder=0 (room.js depth-tie offsets off), cloth=0 (cape
// cloth off: the keyed glb cape), gun=0 (no gun mesh), ladder=N (test aid: start at
// ladder N's bottom), warp=<name> / warp=list (PAGE AID, warp.js: a later place in the level), outblur=1/0 (PS2 output merge on/off, output.js; default: on only with res=native), res=native (the game's
// 432x512 framebuffer shown 4:3; default = canvas-resolution render filling the canvas, Dan's choice), aim=0 (no
// weapon: aim.js / aim_core.js, the camera's weapon views and the reticle). Packs load in
// the background after start (vincent_<pack>.glb).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TICK, STEP, PlayerController, SpeedAnimator, FollowCamera, cameraRays, KEY_WALK, KEY_RUN, MouseFeed, MOUSE_SENS_DEFAULT, CROSS_KEY, dirAngles } from './player.js';
import { warpRequest, applyWarp, applyWarpLate, warpPair, warpHelp } from './warp.js';   // PAGE AID ?warp= (worker 0249)
import { attachGun } from './gun.js';
import { loadActions } from './actions/index.js';
import { initReport } from './report.js';
import { loadRoom, showChunks, createRoomNodes } from './room.js';
import { ChunkAnims } from './chunk_anim.js';
import { viewOf } from './room_occl.js';
import { CapeCloth } from './cloth.js';
import { createOutputStage } from './output.js';
import { setupAim } from './aim.js';
import { setupHud } from './hud.js';
import { setupEnemies } from './enemies.js';
import { createProps } from './props.js';
import { setupPropsView } from './props_view.js';
import { createItems } from './items.js';
import { setupItemsView } from './items_view.js';
import { createEnemyAI, GameRandom } from './enemy_ai.js';
import { createEffects, EffectLayer, wallImpactId, hitImpactId, cameraView } from './effects.js';
import { boneRows } from './enemy_hit.js';
import { restoreCheckpoint, initWorld, sceneSave, loadedPair } from './checkpoint.js';
import { createShotFx } from './shot_fx.js';
import { AreaStream, pickLight, loadedGrids, Light2 } from './area_stream.js';
import { floorScale } from './floor_shade.js';
import { Areas } from './areas.js';
import { createRoomVis, createVisMask } from './room_vis.js';

const params = new URLSearchParams(location.search);
const hud = document.getElementById('hud');
const msg = document.getElementById('msg');
if (params.get('hud') === '0') hud.style.display = 'none';

const SPAWN = { x: -1395.63, z: -1110.51 };
const ENEMIES = params.get('enemies') !== '0';       // enemies.js: z128's e027 soldiers (the AI's, and stage-load ones alive in the save)
const ENEMY_AI = params.get('enemyai') !== '0';      // enemy_ai.js: wake trigger + awake soldier AI (?enemyai=0 = off)
const ITEMS = params.get('items') !== '0';           // items.js: pickups and drops in the AI's world (?items=0 = off; worker 0224)
const PROPS = params.get('props') !== '0';           // props.js: z128's explosive barrels in the AI's world (?props=0 = off; worker 0209)
// OPTION mouselook: the camera turns by mouse pixels (not in the game). ON by default at Dan's request
// (review board 2026-10-30); ?mouselook=game gives the game's USB-mouse path (FUN_00254ac8)
const MOUSE_DIRECT = params.get('mouselook') !== 'game';
const MOUSE_SENS = params.has('mousesens') && +params.get('mousesens') > 0 ? +params.get('mousesens') : MOUSE_SENS_DEFAULT;   // degrees per pixel
const FX = params.get('fx') !== '0';               // the effect engine (effects.js, data/effects): wall impacts, hits on Vincent; ?fx=0 off
const ENEMY_DMG = params.get('enemydmg') !== '0';    // enemy bullets damage Vincent (decoded hit test, on by default; ?enemydmg=0: they hit, no damage); melee always does
const AIM = params.get('aim') !== '0';               // aim.js (aim_core.js): the weapon, its camera views, the reticle
// OPTION widehud: in full mode the HUD's left / right panels move out to the canvas edges (hud.js panelAnchors;
// not in the game). ON by default at Dan's request (review board 2026-11-02); ?widehud=0 gives the game's 4:3 layout
const WIDEHUD = params.get('widehud') !== '0';
const GAMEHUD = params.get('gamehud') !== '0';      // hud.js (hud_core.js): the game's HUD (HP gauge, weapon panel), ?gamehud=0 off (?hud=0 hides only the debug text)
// game sound effects (audio.js; notes/audio-research.md): on by default, ?sound=0 off. Browsers start audio only after
// a user gesture: the AudioContext is made on the first key / click (the page's existing click-to-look); sounds
// requested before that are dropped (no extra UI).
const SOUND = params.get('sound') !== '0';
// the opening event (intro.js, worker 0210): z128 starts with ev0100 scr001, then the Restart path's hand-off; ?intro=0
// skips it (test aid) and starts from the save state as before
// PAGE AID (worker 0249, warp.js; not the game): ?warp=<name> puts Vincent at a later place once main has settled; a warp
// starts from the save (no opening, as ?intro=0). ?warp=list prints the names
const WARP = warpRequest(params);
let warpPending = WARP && WARP !== 'list' ? WARP : null;
let warpLate = null;                              // worker 0265: a warp waiting for its pair (warp.js applyWarpLate)
const INTRO = params.get('intro') !== '0' && !warpPending;
const PACKS = params.has('packs') ? params.get('packs').split(',').filter(Boolean) : (AIM ? ['ladder', 'jump', 'shoot'] : ['ladder', 'jump']);
// Placement: the game draws the model with the motion player's matrix MP+0x10 (FUN_005ab8f0
// -> view x MP+0x10), a copy of the character matrix (FUN_00343de8 -> FUN_005a6f40 ->
// FUN_005a6ea8). Its rows are unit length (save state) and its origin is the character
// position, which is at his feet: the game's cape_target is that matrix x the skinned bones
// at ratio 1.000 (worker 0083, tools/trace TRACE_FIELDSET=pose). So no scale, no pivot and
// no sole offset: the glb's model origin goes on ctrl.pos (export_web_vincent.py rootT = 0).

// ------------------------------------------------------------ room (room.js)
// the static posed Vincent in scene.json is replaced by the animated glb
const loadRoomPlay = () => loadRoom({
  skip: d => d.kind === 'char',
  onProgress: (n, t) => { msg.textContent = `loading room ${n}/${t}`; },
});

// ------------------------------------------------------------ Vincent
// The game draws Vincent's flag-bit-1 groups (hair cards, some cloth edges; material
// 'alpha') with ABE (Cs-Cd)*As+Cd and ATE GEQUAL ref, AFAIL = RGB_ONLY: EVERY fragment
// blends by its alpha, and only those with As >= ref write depth (HANDOFF "Uncaptured-model
// render"; render_scene_textured -charatest does the same). Two passes per primitive, as
// room.js does for the room: pass 1 keeps a >= ref (blend + depth write), pass 2 keeps
// a < ref (blend, no depth write). The game draws the groups in one fixed order (glb
// primitive extras.drawOrder, opaque and alpha runs interleaved). The renderer runs with
// sortObjects = false, which ignores renderOrder and draws every `transparent` material
// after all opaque ones, so these stay non-transparent and the meshes are put in
// drawOrder in the scene graph instead.
const CHAR_AREF = 0.77734;                         // placement.json char_alpha_ref (glb alphaCutoff)
function gsBlend(m) {
  m.transparent = false;
  m.blending = THREE.CustomBlending;
  m.blendEquation = THREE.AddEquation;
  m.blendSrc = THREE.SrcAlphaFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
}
function gsAlphaPasses(prims) {
  // glb primitive extras.drawOrder: GLTFLoader puts primitive extras on the geometry
  const order = (o, i) => {
    const d = o.geometry.userData?.drawOrder ?? o.userData?.drawOrder;
    return Number.isFinite(d) ? d : i;
  };
  const below = new Map();                         // pass-1 material -> pass-2 material
  const afail = [];
  for (const o of prims) {
    const m = o.material;
    if (!(m.name === 'alpha' || m.alphaTest > 0)) continue;
    const ref = m.alphaTest > 0 ? m.alphaTest : CHAR_AREF;
    m.alphaTest = ref; m.depthWrite = true; gsBlend(m);
    let m2 = below.get(m);
    if (!m2) {
      m2 = m.clone(); m2.alphaTest = ref; m2.depthWrite = false; gsBlend(m2);
      m2.onBeforeCompile = sh => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>',
          'if ( diffuseColor.a >= alphaTest ) discard;   // GS AFAIL pass: keep a < ref');
      };
      m2.customProgramCacheKey = () => 'gs-afail';
      below.set(m, m2);
    }
    const o2 = new THREE.SkinnedMesh(o.geometry, m2);
    o2.bind(o.skeleton, o.bindMatrix);
    o2.frustumCulled = false; o2.name = (o.name || 'prim') + '#afail';
    o2.userData = { ...o.userData, afail: true };
    afail.push([o, o2]);
  }
  // scene-graph order = draw order: each parent's primitives by drawOrder, pass 2
  // right after its pass 1 (other children, e.g. joint nodes, keep their places)
  const idx = new Map(prims.map((o, i) => [o, order(o, i)]));
  for (const parent of new Set(prims.map(o => o.parent))) {
    const kids = parent.children.filter(c => idx.has(c)).sort((a, b) => idx.get(a) - idx.get(b));
    const seq = kids.flatMap(c => [c, ...afail.filter(([o]) => o === c).map(([, o2]) => o2)]);
    let k = 0;
    parent.children = parent.children.flatMap(c => (idx.has(c) ? (k++ === 0 ? seq : []) : [c]));
    for (const c of seq) c.parent = parent;
  }
  return afail.map(([, o2]) => o2);
}

async function loadVincent() {
  msg.textContent = 'loading vincent…';
  const gltf = await new GLTFLoader().loadAsync('data/vincent/vincent.glb');
  const prims = [];
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;                       // skinned: the bind-pose bounds lie
    prims.push(o);
    const m = o.material;
    if (m.map) { m.map.colorSpace = THREE.NoColorSpace; m.map.needsUpdate = true; }  // raw texel, like the room
    // Back-face cull. The game sends every Vincent triangle whose screen winding is
    // counter-clockwise (y down, strip parity applied) as XYZ3 with ADC=1, so it is
    // not drawn. Hero dump 163235: 1299 of 1303 ADC triangles are ccw, 1195 of 1198
    // drawn ones are cw (body, hair, cape). The glb keeps both sides of the two-sided
    // cards as separate triangles. The ones the game draws are clockwise on screen
    // in glb index order: WebGL back faces. Drawn sets match the dump: hair alpha
    // 135/135, hair opaque 84/81, cape 56/56, body 932/926.
    m.side = THREE.BackSide;
  });
  // The glb shares one material per kind; the prims that stay prelit (the cape, extras
  // lit = false) get their own copy so the program-D patch (setupCharLighting) skips them.
  for (const o of prims) if (o.geometry.userData?.lit === false) o.material = o.material.clone();
  const afail = gsAlphaPasses(prims);
  // gltf.scene is Y-up (root node 0 flips the game's -Y-up model). Flip back with
  // Rx(pi) so it sits in game space; glb +Z forward becomes game -Z.
  const flip = new THREE.Group();
  flip.rotation.x = Math.PI;
  flip.add(gltf.scene);
  const body = new THREE.Group();                  // MP+0x10: position = feet, rotation.y from heading, unit scale
  body.add(flip);
  const clip = n => {
    const c = gltf.animations.find(a => a.name === n);
    if (!c) throw new Error(`vincent.glb has no clip ${n}`);
    return c;
  };
  return { body, mixRoot: gltf.scene, clips: { idle: clip('h_st'), walk: clip('h_wk'), run: clip('h_rn') }, prims, afail };
}

// ------------------------------------------------------------ character lighting
// VU1 program D (port/vu/RENDER-MATH.md §1) per vertex, from the skinned normal:
//   rgb = min(vcol * (C0*max(L0.n,0) + C1*max(L1.n,0) + C2*max(L2.n,0) + A), 255), FTOI0
// then GS MODULATE (COLOR_0 = vcol/128, so the shader keeps /128). The rig is rebuilt
// once per drawn frame as FUN_005ab0b0 does (data/vincent/light.json, export_web_light.py):
//   L0/C0  env slot 0 light (toward the light), colour x MP+0x450/128
//   L1/C1  effect point lights (DAT_004eea50 / MP+0x160, FUN_0030e208): none on this page
//   L2/C2  room light from the BMD light grids (FUN_0026a710 -> FUN_00270d08), colour
//          rgb*k*100/d^2, smoothed by FUN_005ab608 while the chosen light changes
//   A      env slot 0 ambient x MP+0x450/128
// Not ported (inactive in z128: save state): the fixed rig behind DAT_004fcaf8 bit 36,
// the MP+0x41c / +0x420 ambient tints, the env-slot blend FUN_005ab738.
// Hero dump 163235 vs this model at h_st f91: vertices whose triangle matches the dump
// pose (<2 deg) are within 1 level at the median (body, opaque and alpha hair).
// The cape (cloth meshes, not skinned) takes the same program D with the cloth buffer's
// normals (cloth.js skinNormals, FUN_005b06d0), written per render in its parent's space.
const LIGHT_VS = `
  #if ( defined( USE_SKINNING ) || defined( PROGRAM_D_CLOTH ) ) && defined( USE_COLOR_ALPHA )
  {
    #ifdef PROGRAM_D_CLOTH
    vec3 n = mat3( modelMatrix ) * normal;                // cape: cloth normal (MeshBasic has no objectNormal unskinned)
    #else
    vec3 n = mat3( modelMatrix ) * objectNormal;          // world (= game world) normal, unit-scale MP+0x10
    #endif
    vec3 lit = uC0 * max( dot( uL0, n ), 0.0 ) + uC1 * max( dot( uL1, n ), 0.0 )
             + uC2 * max( dot( uL2, n ), 0.0 ) + uAmb;     // MULA/MADDA L, MAX 0, MULA/MADD C + A
    vColor.rgb = floor( min( vColor.rgb * 128.0 * lit, 255.0 ) ) / 128.0;   // MUL vcol, MINIi 255, FTOI0
  }
  #endif`;
function litPatch(m, U, cloth = false) {
  const prev = m.onBeforeCompile, prevKey = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev.call(m, sh, r);
    Object.assign(sh.uniforms, U);
    sh.vertexShader = (cloth ? '#define PROGRAM_D_CLOTH\n' : '') + 'uniform vec3 uL0, uC0, uL1, uC1, uL2, uC2, uAmb;\n' +
      sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>' + LIGHT_VS);
  };
  m.customProgramCacheKey = () => prevKey.call(m) + (cloth ? '|programD-cloth' : '|programD');
  m.needsUpdate = true;
}

async function setupCharLighting(vin, cape) {
  let L;
  try {
    const r = await fetch('data/vincent/light.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    L = await r.json();
  } catch (e) {
    console.warn('character lighting off (data/vincent/light.json):', e.message);
    return null;
  }
  const lit = [...vin.prims, ...vin.afail].filter(o => o.geometry.userData?.lit === true);
  if (!lit.length) { console.warn('character lighting off: vincent.glb has no extras.lit (old export)'); return null; }
  const V = (...a) => new THREE.Vector3(...a);
  const s = L.scale_byte / 128;                                // MP+0x450 * 0.0078125
  const U = {
    uL0: { value: V(...L.env.dir0) }, uC0: { value: V(...L.env.col0).multiplyScalar(s) },
    uL1: { value: V() }, uC1: { value: V() },
    uL2: { value: V() }, uC2: { value: V() },
    uAmb: { value: V(...L.env.ambient).multiplyScalar(s) },
  };
  for (const m of new Set(lit.map(o => o.material))) litPatch(m, U);
  // the cape: lit only on the cloth meshes, which carry the game's normals (with ?cloth=0 the
  // glb cape keeps its geometric normals, not the game's, and stays prelit)
  if (cape) for (const m of cape.materials) litPatch(m, U, true);

  // which chunks are loaded (area_stream.js: slot table DAT_004e4c60, streamed by the area boxes)
  const stream = new AreaStream(L.areas, L.start_pair);
  if (!L.chunks) console.warn('character lighting: light.json v1 (no chunks / areas): light 2 from its grids only; re-run export_web_light.py');
  // FUN_0026a710: DAT_004e88a4 = 1e6, then every loaded slot's grid in slot order (FUN_00270ed8 ->
  // FUN_00270d08); the threshold carries over, so the result is the global least d^2/k.
  const pick = p => pickLight(L.chunks ? loadedGrids(L, stream) : L.grids, p, L.pick_start);
  // FUN_005ab0b0 light 2 + FUN_005ab608 smoothing (area_stream.js Light2; MP+0x110 / +0x140 / +0x430)
  const l2 = new Light2();
  // p = the actor point, MP+0x10 x (MP+0x90 + MP+0xa0)/2 (FUN_005a72a8, FUN_0026138c)
  function frame(p) {
    l2.update(pick(p), p);
    U.uL2.value.set(...l2.dir); U.uC2.value.set(...l2.col);   // light 2: not x MP+0x450
  }
  const centre = V(...L.actor_center);
  // MP+0x450 from the walk polygon (FUN_00340e08 -> FUN_005ae1f0; floor_shade.js): light 0 and the ambient scale with it. No polygon: kept
  let shade = null, byte = L.scale_byte;
  fetch('data/z128_walk_shade.bin').then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error(`HTTP ${r.status}`))).then(b => { shade = new Uint32Array(b.byteLength % 4 ? b.slice(0, b.byteLength & ~3) : b); })
    .catch(e => console.warn('floor shade off (data/z128_walk_shade.bin):', e.message));
  function floor(col, poly, pos) {
    if (!shade || poly == null) return;
    if (shade.length !== col.npolys) {     // a short sidecar or a server's 200 HTML page: keep the byte, or poly indexes nothing and Vincent goes unlit
      console.warn(`floor shade off (data/z128_walk_shade.bin: ${shade.length} words, ${col.npolys} polygons): MP+0x450 stays ${byte}`);
      shade = null; return;
    }
    const b = floorScale(shade[poly], col.polys[poly].v, pos);
    if (b === byte) return;
    byte = b;
    U.uC0.value.set(...L.env.col0).multiplyScalar(b / 128);
    U.uAmb.value.set(...L.env.ambient).multiplyScalar(b / 128);
  }
  return { U, frame, floor, scaleByte: () => byte, centre, pick, stream, startPair: L.start_pair, env: L.env };       // env: unscaled, for enemies.js
}

// ------------------------------------------------------------ cape cloth (cloth.js)
// The game simulates the cape's 82 cloth vertices (not bones): one cloth step per drawn
// frame, 50/s on PAL (FUN_005ab8f0 -> FUN_005b2ef8 -> FUN_005b2550 -> FUN_005b0d30), on
// targets skinned with all of each vertex's influences (FUN_005b06d0; the glb keeps 4).
// The cape primitive (and its GS alpha-fail twin) is swapped for plain meshes whose
// corners are written from the cloth buffer. Outside a settle window the cloth output IS
// the keyed target, so the cape looks as before except for the 5th influences.
//
// Timing: one cloth.frame() per game frame, from the SpeedAnimator's draw hook (player.js
// gameFrame: after the clip choice, before the clip advance FUN_005aa5b8), in the order
// FUN_005ab8f0 runs it: a clip request arms the window (FUN_005a95f0), the cloth step
// (FUN_005b2ef8, line 143), the countdown (FUN_005aa5b8, line 218), the turn re-arm
// (FUN_005a6f40). It is skinned from the game's draw pose: the character matrix after this
// frame's movement and the clip frames before this frame's advance (pose(), from main).
async function setupCapeCloth(vin, anim, pose) {
  let data;
  try {
    const r = await fetch('data/vincent/cloth.json');
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    console.warn('cape cloth off (data/vincent/cloth.json):', e.message);
    return null;
  }
  const src = vin.prims.find(o => o.isSkinnedMesh && o.geometry.userData?.firstTri === data.cape_first_tri);
  if (!src || !src.geometry.index || src.geometry.index.count !== data.corner_vertex.length) {
    console.warn('cape cloth off: cape primitive not found or corner count differs');
    return null;
  }
  const twin = vin.afail.find(o => o.geometry === src.geometry);
  // unindexed copy of the cape corners; position is written from the cloth each render
  const idx = src.geometry.index.array, n = idx.length;
  const geom = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(src.geometry.attributes)) {
    if (name === 'position' || name === 'skinIndex' || name === 'skinWeight') continue;
    const out = new Float32Array(n * a.itemSize);
    for (let i = 0; i < n; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(idx[i], k);
    geom.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize, a.normalized));
  }
  const posAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('position', posAttr);
  // lighting normals: the cloth buffer's (FUN_005b06d0 -> FUN_005b1260), replacing the glb's
  // geometric ones; written with the positions each render
  const nrmAttr = data.skin[0]?.length >= 12 ? new THREE.BufferAttribute(new Float32Array(n * 3), 3) : null;
  if (nrmAttr) { nrmAttr.setUsage(THREE.DynamicDrawUsage); geom.setAttribute('normal', nrmAttr); }
  else console.warn('cape lighting off: cloth.json has no skin normals (old export)');
  const parent = src.parent;
  const materials = [];
  for (const o of [src, twin].filter(Boolean)) {      // same scene-graph slot = same draw order
    const m = new THREE.Mesh(geom, o.material);
    materials.push(o.material);
    m.name = o.name + '#cloth'; m.frustumCulled = false; m.userData = { ...o.userData, cloth: true };
    const p = o.parent, i = p.children.indexOf(o);
    p.children[i] = m; m.parent = p; o.parent = null;
  }
  // worker 0280: the same cape for the events' p000 bodies (event_actors.js capeOf; lib.cape): the corners' uv / colour
  // attributes and fresh copies of the two passes' materials as gsAlphaPasses left them (before the program-D patch;
  // Material.clone drops onBeforeCompile, so the alpha-fail pass's is carried over)
  const shared = Object.fromEntries(Object.entries(geom.attributes).filter(([k]) => k !== 'normal'));
  const passes = [src, twin].filter(Boolean).map(o => [o.material, o.material.onBeforeCompile, o.material.customProgramCacheKey]);
  const eventSource = { CapeCloth, data, attributes: shared, normals: !!nrmAttr,
    materials: () => passes.map(([m, f, k]) => { const c = m.clone(); if (m !== src.material) { c.onBeforeCompile = f; c.customProgramCacheKey = k; } return c; }) };
  const cloth = new CapeCloth(data);
  const sk = src.skeleton, bind = src.bindMatrix;
  const mats = new Map(), tmp = new THREE.Matrix4(), inv = new THREE.Matrix4();
  const bones = [...new Set(data.skin.map(r => r[1]))];
  const skinMat = b => mats.get(b);
  const fx = new THREE.Vector3();
  const N3 = cloth.N * 3;
  const off = new Float32Array(N3);                   // cloth pos - target at the last game frame, parent space
  const tgt = new Float32Array(N3);
  const rskin = { N: cloth.N, skinRec: cloth.skinRec, target: new Float32Array(N3) };   // render targets (world)
  const rnrm = new Float32Array(N3), nrm = new Float32Array(N3);                        // render normals (world, parent)
  let lastKey = undefined;
  function skinNow() {                                // targets at the pose the scene graph holds now
    vin.body.updateMatrixWorld(true);
    for (const b of bones) mats.set(b, tmp.multiplyMatrices(sk.bones[b].matrixWorld, sk.boneInverses[b]).multiply(bind).toArray());
  }
  // world -> the cape meshes' parent space (o += M x)
  function toParent(src3, dst, sub = null) {
    inv.copy(parent.matrixWorld).invert();
    const e = inv.elements;
    for (let j = 0; j < N3; j += 3) {
      const x = src3[j], y = src3[j + 1], z = src3[j + 2];
      dst[j] = e[0] * x + e[4] * y + e[8] * z + e[12];
      dst[j + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      dst[j + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      if (sub) { dst[j] -= sub[j]; dst[j + 1] -= sub[j + 1]; dst[j + 2] -= sub[j + 2]; }
    }
  }
  // the clip that is playing now, as an identity: a new play() / gait change is a new clip
  // request (FUN_005a91c8 -> FUN_005a95f0); a loop keeps the key (no re-arm)
  const clipKey = () => anim.override || anim.current;
  // one game frame (anim.drawHook)
  function gameFrame() {
    pose();
    skinNow();
    const key = clipKey();
    const started = key !== lastKey ? anim.clipName() : null;
    lastKey = key;
    // GUESS: (traced, not decoded; see notes/fidelity-audit.md) character x axis for the turn re-arm (FUN_005a6f40): THIS frame's facing. Traced: the
    // game's window re-arms on the frame our current facing turns (cw_turn / cw_run arm
    // frames equal), although its skin uses the previous matrix (logicPose). Not decoded why.
    pose.facing(fx);
    cloth.frame({ clipStarted: started, skinMat, fx: [fx.x, fx.y, fx.z] });
    toParent(cloth.target, tgt);
    toParent(cloth.pos, off, tgt);
  }
  anim.drawHook = gameFrame;
  return {
    cloth,
    // Draw: the cloth's offset from its target at the last game frame, added to the target
    // at the pose being rendered (the render interpolates between game frames, ctrl.lerp),
    // so the pinned edge stays on the body. Rendered at a game frame's own pose this is
    // cloth.pos exactly. GUESS: display interpolation, a port convenience (see
    // notes/fidelity-audit.md "Web frame loop and cape cloth").
    render() {                                      // before the first game frame: off = 0, keyed
      skinNow();
      cloth.skin.call(rskin, skinMat);                // FUN_005b06d0 into a render-only buffer
      const out = posAttr.array, cv = data.corner_vertex;
      toParent(rskin.target, tgt);
      for (let i = 0; i < n; i++) {
        const j = 3 * cv[i];
        out[3 * i] = tgt[j] + off[j]; out[3 * i + 1] = tgt[j + 1] + off[j + 1]; out[3 * i + 2] = tgt[j + 2] + off[j + 2];
      }
      posAttr.needsUpdate = true;
      // Normals at the rendered (interpolated) pose, not the game frame's pose: part of the
      // display-interpolation GUESS above (notes/fidelity-audit.md "Web frame loop and cape
      // cloth", row "Cape drawn between game frames"). At a game frame's own pose they are the game's.
      if (nrmAttr) {                                  // world -> parent (rotation)
        cloth.skinNormals.call(rskin, skinMat, rnrm);
        const e = inv.copy(parent.matrixWorld).invert().elements, o = nrmAttr.array;
        for (let j = 0; j < N3; j += 3) {
          const x = rnrm[j], y = rnrm[j + 1], z = rnrm[j + 2];
          nrm[j] = e[0] * x + e[4] * y + e[8] * z; nrm[j + 1] = e[1] * x + e[5] * y + e[9] * z; nrm[j + 2] = e[2] * x + e[6] * y + e[10] * z;
        }
        for (let i = 0; i < n; i++) {
          const j = 3 * cv[i];
          o[3 * i] = nrm[j]; o[3 * i + 1] = nrm[j + 1]; o[3 * i + 2] = nrm[j + 2];
        }
        nrmAttr.needsUpdate = true;
      }
    },
    materials: nrmAttr ? materials : [],
    eventSource,
    state: () => ({ total: cloth.total, remaining: cloth.remaining, k: +cloth.k().toFixed(4) }),
  };
}

// clip sidecars: vincent.json + each pack's json -> { clip name: entry }
async function loadMotions(name) {
  const r = await fetch(`data/vincent/${name}.json`);
  if (!r.ok) throw new Error(`${name}.json: HTTP ${r.status}`);
  return (await r.json()).clips || {};
}

// SHA-1 hex of an ASCII string (crypto.subtle needs a secure context; the page is plain http).
function sha1Hex(str) {
  const b = Array.from(str, c => c.charCodeAt(0) & 0xff), ml = b.length * 8;
  b.push(0x80); while (b.length % 64 !== 56) b.push(0);
  for (let i = 7; i >= 0; i--) b.push(i >= 4 ? 0 : (ml >>> (i * 8)) & 0xff);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Array(80), rol = (x, n) => (x << n) | (x >>> (32 - n));
  for (let o = 0; o < b.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = (b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3];
    for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, bb = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      const [f, k] = i < 20 ? [(bb & c) | (~bb & d), 0x5a827999] : i < 40 ? [bb ^ c ^ d, 0x6ed9eba1]
        : i < 60 ? [(bb & c) | (bb & d) | (c & d), 0x8f1bbcdc] : [bb ^ c ^ d, 0xca62c1d6];
      const t = (rol(a, 5) + f + e + k + w[i]) | 0;
      e = d; d = c; c = rol(bb, 30); bb = a; a = t;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0;
  }
  return [h0, h1, h2, h3, h4].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

// The locomotion clips' local TRS (export_web_vincent.py local_pose): SpeedAnimator then
// builds the pose the game's way (FUN_005a9db0). Without it (an old export) the three.js
// mixer's model-space mix is used, with a warning.
async function loadLocalPose(anim, root) {
  let side;
  try {
    const r0 = await fetch('data/vincent/vincent.json');
    if (!r0.ok) throw new Error(`HTTP ${r0.status}`);
    side = await r0.json();
  } catch (e) { console.warn(`vincent.json: ${e.message}: mixer pose`); return; }
  const lp = side.local_pose;
  if (!lp) { console.warn('vincent.json has no local_pose (old export): mixer pose'); return; }
  const r = await fetch('data/vincent/' + lp.file);
  if (!r.ok) { console.warn(`${lp.file}: HTTP ${r.status}: mixer pose`); return; }
  anim.setLocalPose(lp, await r.arrayBuffer(), root);
}

// The main rig's skeleton signature, in export_web_vincent.py's parent_sha1 form:
// sha1 of the parent list as compact JSON ([-1,0,1,...]). null if vincent.json has none.
async function rigSignature() {
  const r = await fetch('data/vincent/vincent.json');
  if (!r.ok) throw new Error(`vincent.json: HTTP ${r.status}`);
  const parent = (await r.json()).joints?.parent;
  if (!Array.isArray(parent)) return null;
  return { bone_count: parent.length, parent_sha1: sha1Hex(JSON.stringify(parent.map(x => Math.trunc(x)))) };
}

// Why a pack can't be used with this rig, or null. A pack built for another skeleton
// would bind its tracks by joint name onto the wrong bones, so a mismatch skips it.
// A pack without the fields (exported before they existed) or a rig we couldn't read
// can't be checked: those load with a warning, as before the check.
function packMismatch(name, side, rig) {
  if (!rig) { console.warn(`clip pack ${name}: main rig signature unavailable, loaded unchecked`); return null; }
  if (side.bone_count == null || side.parent_sha1 == null) {
    console.warn(`clip pack ${name}: no bone_count/parent_sha1 (old export), loaded unchecked`); return null;
  }
  if (side.bone_count !== rig.bone_count) return `bone_count ${side.bone_count} != rig ${rig.bone_count}`;
  if (side.parent_sha1 !== rig.parent_sha1) return `parent_sha1 ${side.parent_sha1} != rig ${rig.parent_sha1}`;
  return null;
}

// Animation-only clip packs (export_web_vincent.py --pack). Their tracks use the same
// joint node names as vincent.glb, so the main mixer binds them directly; each pack's
// bone_count / parent_sha1 must match vincent.json's skeleton (packMismatch).
async function loadPacks(names, anim, motions) {
  const loader = new GLTFLoader();
  const got = [];
  const rig = await rigSignature().catch(e => { console.warn('rig signature:', e.message); return null; });
  await Promise.all(names.map(async n => {
    try {
      const r = await fetch(`data/vincent/vincent_${n}.json`);
      if (!r.ok) throw new Error(`vincent_${n}.json: HTTP ${r.status}`);
      const side = await r.json();
      const bad = packMismatch(n, side, rig);
      if (bad) { console.warn(`clip pack ${n} skipped (built for another skeleton): ${bad}`); return; }
      const g = await loader.loadAsync(`data/vincent/vincent_${n}.glb`);
      // the pack clips' local TRS (player.js addLocalPose), registered before the clips so a
      // pack clip never starts on the mixer pose; without it they use the mixer pose
      if (side.local_pose && anim.lp) {
        const rl = await fetch('data/vincent/' + side.local_pose.file);
        if (!rl.ok) console.warn(`${side.local_pose.file}: HTTP ${rl.status}: pack ${n} uses the mixer pose`);
        else {
          try { anim.addLocalPose(side.local_pose, await rl.arrayBuffer()); }
          catch (e) { console.warn(`clip pack ${n}: ${e.message}: mixer pose`); }
        }
      } else if (!side.local_pose) console.warn(`clip pack ${n}: no local_pose (old export): mixer pose`);
      anim.addClips(g.animations, side.clips);
      Object.assign(motions, side.clips || {});
      got.push(`${n} (${g.animations.length})`);
    } catch (e) {
      console.warn(`clip pack ${n} not loaded:`, e.message);
    }
  }));
  return got;
}

// body.rotation.y for a heading h (dir = (sin h, cos h)): forward in body space is
// (0,0,-1); Ry(t) sends it to (-sin t, 0, -cos t), so t = h + pi.
const bodyYaw = h => h + Math.PI;

async function loadCol() {
  if (params.get('col') !== 'stub') {
    try {
      const m = await import('./collision.js');
      const r = await fetch('data/z128_collision.bin');
      if (!r.ok) throw new Error(`collision: HTTP ${r.status}`);
      const buf = await r.arrayBuffer();
      const col = await m.loadCollision(buf);
      return { col, name: 'collision.js', camRays: cameraRays(buf) };
    } catch (e) {
      console.warn('collision.js unavailable, using the stub:', e.message);
    }
  }
  const m = await import('./collision_stub.js');
  return { col: await m.loadCollision(), name: 'stub (flat y=-98.44)' };
}

// ------------------------------------------------------------ main
async function main() {
  const [{ scene, root, lo, hi, floats, uvAnim, occl: roomOccl }, { col, name: colName, camRays }] = await Promise.all([loadRoomPlay(), loadCol()]);
  const vin = await loadVincent();
  msg.style.display = 'none';
  root.add(vin.body);

  const renderer = new THREE.WebGLRenderer({ antialias: params.get('aa') === '1', alpha: false });
  renderer.setPixelRatio(params.has('dpr') ? +params.get('dpr') : Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.sortObjects = false;                    // keep the game's draw order: scene-graph order (enemies.js: actors after Vincent)
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.setClearColor(new THREE.Color().setRGB(...scene.clear, THREE.LinearSRGBColorSpace), 1);
  document.body.appendChild(renderer.domElement);
  const canvas = renderer.domElement;
  // PS2 output (output.js): the game's 432x512 framebuffer, its projection (FUN_0040d478),
  // the PCRTC merge (FUN_0040d228) and the 4:3 display window, with ?res=native.
  // Default: the sharp canvas-resolution render filling the canvas (Dan's choice, 2026-10-28);
  // ?outblur=1 / 0 = merge on / off
  // Output merge: on in native mode (the game's look), off in the full-res default (sharp, Dan's
  // choice 2026-10-28); ?outblur=1 / 0 forces it.
  const nativeRes = params.get('res') === 'native';
  const output = createOutputStage(renderer, { enabled: params.has('outblur') ? params.get('outblur') !== '0' : nativeRes,
                                               msaa: params.get('aa') === '1', native: nativeRes, wideHud: WIDEHUD });

  const c0 = new THREE.Vector3(...scene.camera.eye);
  const far = Math.max(c0.distanceTo(lo.clone().add(hi).multiplyScalar(.5)) + lo.distanceTo(hi) + 1, 1);
  const camera = new THREE.PerspectiveCamera(scene.camera.fov, innerWidth / innerHeight, 1, far);
  output.fitCamera(camera);                        // the game's projection (native) or the canvas aspect (full)

  // spawn: feet on the first floor at or below the scene's placement height
  let gy = col.groundY(SPAWN.x, SPAWN.z, scene.char.y);
  if (gy == null) gy = col.groundY(SPAWN.x, SPAWN.z, scene.char.y - 40);
  if (gy == null) { console.warn('no ground at spawn'); gy = scene.char.y; }
  // start facing along the hero camera's view, with the camera behind him
  const heroDir = new THREE.Vector3(...scene.camera.at).sub(c0);
  const heading0 = Math.atan2(heroDir.x, heroDir.z);

  const ctrl = new PlayerController(col, {
    pos: { x: SPAWN.x, y: gy, z: SPAWN.z }, heading: heading0, radius: 3.5, height: 19, scale: 1,   // MP+0x10 unit scale
  });
  const anim = new SpeedAnimator(vin.mixRoot, vin.clips);
  await loadLocalPose(anim, vin.mixRoot);
  anim.mixer.update(0);                            // h_st frame 0
  // the game's draw pose for the cloth (anim.drawHook, inside ctrl.step): MP+0x10 as the
  // draw sees it, i.e. the character matrix from BEFORE this frame's move (ctrl.prev /
  // prevHeading), and the clip frames before this frame's advance (alpha 1 = head.frame).
  // Traced, not decoded: per record the game's cape_target is the previous record's
  // character matrix x the skinned bones (0.000; this record's: 0.94 in run). Where
  // FUN_00343de8 runs relative to the move (FUN_0034c388) isn't decoded.
  const logicPose = () => {
    vin.body.position.set(ctrl.prev.x, ctrl.prev.y, ctrl.prev.z);
    vin.body.rotation.y = bodyYaw(ctrl.prevHeading);
    const a = ctrl.alpha; ctrl.alpha = 1; anim.update(ctrl.speed, 0); ctrl.alpha = a;
  };
  logicPose.facing = v => {                        // x axis of the body at this frame's heading
    const r = vin.body.rotation.y;
    vin.body.rotation.y = bodyYaw(ctrl.heading); vin.body.updateMatrixWorld(true);
    v.setFromMatrixColumn(vin.body.matrixWorld, 0).normalize();
    vin.body.rotation.y = r; vin.body.updateMatrixWorld(true);
  };
  const cape = params.get('cloth') === '0' ? null : await setupCapeCloth(vin, anim, logicPose);
  // character lighting (setupCharLighting): FUN_005ab0b0 runs in the draw, once per game
  // frame, with the draw's MP+0x10 (the logic pose: ctrl.prev, prevHeading), after the cloth
  const light = await setupCharLighting(vin, cape);
  // the room shows only the loaded chunks (room.js showChunks; worker 0213): the stage-load pair now
  // (light.json without area boxes: every chunk stays drawn)
  // the room's visibility mask DAT_004e8710 (room_vis.js, worker 0225): DAT_004e86f0 from FUN_00264ee0's probe at the
  // camera eye each frame, DAT_004e8700 from the stage scripts (cmds 0x54 / 0x55); room.js hides the chain groups it
  // sets, the stage effects' cull (fxStage) reads it too
  const visMask = createVisMask();
  const roomVis = await fetch('data/z128_vis.json').then(r => r.ok ? r.json() : null).catch(() => null).then(d => d && createRoomVis(d));
  if (!roomVis) console.warn('room: no data/z128_vis.json (build step room_vis, native/assets/collision/cidvis): the visibility probe is off, every chain group is drawn');
  // FUN_00264f68 (the room draw, before the chunk stream FUN_0026a0c0): FUN_00264ee0 probes from the eye of the camera
  // matrix 0x4fcb10 (the last frame's camera) through the slots loaded before this frame's stream
  // (light.json without area boxes: every chunk is drawn, so the probe looks through every chunk's cid)
  const streamed = () => !!light?.stream.areas.length;
  // then FUN_00269868: the occluder volumes from the same camera (room_occl.js, worker 0233); cam: that camera (three.js)
  const occlV = new Float32Array(16);
  const roomProbe = (eye, cam, fov) => {
    if (roomVis && eye) visMask.setCamera(roomVis.probe(eye, streamed() ? light.stream.loaded() : roomVis.chunks).mask);
    if (roomOccl && cam) roomOccl.frame(viewOf(cam, occlV), streamed() ? light.stream.loaded() : roomOccl.chunks, fov);
  };
  const roomShow = () => { if (streamed()) showChunks(root, light.stream.loaded(), roomVis ? visMask : null, roomOccl); else if (roomVis || roomOccl) showChunks(root, null, roomVis ? visMask : null, roomOccl); };
  roomShow();
  if (light) {
    const ap = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
    const actorPoint = () => ap.copy(light.centre).applyAxisAngle(Y, bodyYaw(ctrl.prevHeading)).add(ctrl.prev);
    light.frame(actorPoint());
    const prevHook = anim.drawHook;
    anim.drawHook = () => { if (prevHook) prevHook(); light.floor(col, ctrl.active ? null : ctrl.body?.poly, [ctrl.pos.x, ctrl.pos.y, ctrl.pos.z]); light.frame(actorPoint()); };
  }
  {
    // Vincent's footsteps (ambient.js Footsteps, worker 0215): FUN_005ae828 in the MP update after the pose, i.e. on the
    // game frame's draw pose (the cape's logicPose: alpha 1, MP+0x10 = ctrl.prev). Name (FUN_003466a8): the floor
    // material = the walk polygon's +6 byte (FUN_00340e08: C+0x4c0 face +6 = the DCOL word6; no polygon (ladder) -> 0) and
    // the gait C+0x590 (FUN_00346650: the locomotion choice FUN_00346860; 0 after any other motion class, FUN_00341780).
    // GUESS: C+0x520 / C+0x530 (FUN_00340e08's other sources) taken as 0, as in the save. T: w215_ambfoot / routeA / routeB.
    const prevFoot = anim.drawHook;
    const jy = (b) => { const j = vinJoints[b]; return j ? j.position.y : NaN; };
    anim.drawHook = () => {
      if (prevFoot) prevFoot(); else logicPose();
      if (!amb.foot) return;
      const mk = amb.data.foot.p000.markers, poly = ctrl.active ? null : ctrl.body.poly;
      const mat = poly == null || !col.polys ? 0 : (col.polys[poly].word6 & 0xff);
      const tab = anim.table || null, n = tab ? tab.length : 3;
      const loco = !anim.override && !(ctrl.jump && ctrl.jump.head) && anim.installed && anim.cur >= 0 && !ctrl.active;
      const gait = !loco || anim.cur === 0 ? 0 : n < 2 ? 2 : anim.cur === 1 ? 1 : 2;
      amb.foot.setGround(mat, gait);
      // the request's position: GUESS (traced, not decoded): the previous game frame's MP+0x10 (w215_*: 57 / 57 footstep
      // volumes exact with record f - 1's MP+0x10, 56 / 57 with record f's)
      const here = [ctrl.prev.x, ctrl.prev.y, ctrl.prev.z];
      amb.foot.frame([jy(mk['7'][3]) + mk['7'][1], jy(mk['8'][3]) + mk['8'][1]], amb.footPrev || here);
      amb.footPrev = here;
    };
  }
  // enemy AI data (export_web_triggers.py). The save's live soldiers: records 44-49 and 66 (objects
  // #66-#71, #88), active, HP > 0 (T: k_enemy_engage8 f760, every e<k>_flags bit 0 set; the hero dump
  // draws 44-47 / 66). GUESS: they are active from the start, as in the save (what activated 45-49 / 66
  // before it is not decoded, notes/enemy-activation.md §1; records 41-43 are the save's dead).
  const AWAKE = [44, 45, 46, 47, 48, 49, 66];
  // ai.json also places them (section-1 records), so it loads with ?enemyai=0 too: the soldiers stay, the AI is off
  let aiData = ENEMIES ? await fetch('data/enemies/ai.json').then(r => r.ok ? r.json() : null).catch(() => null) : null;
  if (ENEMIES && !aiData) console.warn('enemy AI off: data/enemies/ai.json missing');
  // an old ai.json (no records 44 / 45 or no weapons) turns off the AI only, not the soldiers
  if (aiData && !(AWAKE.every(k => aiData.records?.[k]) && Array.isArray(aiData.weapons))) {
    console.warn('enemy AI off: data/enemies/ai.json is out of date (rebuild data/enemies)');
    aiData = null;
  }
  // the game's twister (DAT_004fbe00), one for every enemy_ai world: seeded only at boot (FUN_00248528 from the entry;
  // FUN_00248a70), never on the stage reload path, so it runs on through a Restart (GUESS: seed 0, as enemy_ai's default)
  const aiRng = new GameRandom(0);
  const enemies = ENEMIES ? await setupEnemies({ root, litPatch, light, extra: aiData ? AWAKE.map(k => aiData.records[k]) : [] })
    .catch(e => { console.warn('enemies off:', e.message); return null; }) : null;
  // Vincent's status for the enemy AI: HP 780 = P status +0x20 in the save state (k_enemy_engage8 p_hp)
  const php = { pos: [ctrl.pos.x, ctrl.pos.y, ctrl.pos.z], face: [ctrl.C.face.x, ctrl.C.face.y, ctrl.C.face.z], hp: 780, hpMax: 780, id: 0x16, f118: 0x20209, s64: 0 };   // hpMax: status +4 (worker 0243, T w243_potion)   // f118 = P+0x118 from the save's RAM (0x20209; player.js hitBranch)
  ctrl.rng = () => (enemyAI && enemyAI.rng ? enemyAI.rng() : 0.5);   // FUN_0040b5c0 (the knock-down's FUN_005618d0; L: the page's stream)
  ctrl.hpZero = () => php.hp === 0;               // FUN_005786e8's FUN_00316cf8: no intent / weapon at HP 0 (worker 0181)
  let gameOver = null;                            // gameover_layer.js, set up after the pause (worker 0192)
  // Vincent's joints j00..j92 (flat under the glb root: model-space TRS) and his start-of-frame placement (tick)
  const vinJoints = [], vinStart = { pos: null, h: 0 };
  vin.mixRoot.traverse(n => { const m = /^j(\d\d)$/.exec(n.name); if (m && !vinJoints[+m[1]]) vinJoints[+m[1]] = n; });
  // the sound emitters (audio.js SoundEmitters, the EE side: FUN_003e8bc8 slots, FUN_003e9ed0 once a frame); null
  // until the zone's SE data has loaded. snd(name, pos, range): the game's FUN_0033cc48 / FUN_0033ce10; pos null =
  // FUN_0033cbd8 (at the sound camera = the listener position when sent).
  let sfx = null;
  // placed sounds (stage section 22) + Vincent's footsteps (ambient.js, worker 0215; notes/audio-research.md "Placed sounds",
  // "Footsteps"); null until data/audio/ambient_z128.json and the SE data have loaded. sndL: this frame's listener.
  const amb = { placed: null, foot: null, slots: null, data: null, sndL: null };
  // the stage areas (section 11; areas.js, worker 0223): the player's update switches them on / off by his position
  // (FUN_00573c60 -> FUN_00542920 / FUN_00543f28); a placed sound's +0xa8 names an area (manager +0x2b4, FUN_0053b920)
  const areaList = aiData ? aiData.areas : (await fetch('data/enemies/ai.json').then(r => r.ok ? r.json() : null).catch(() => null))?.areas;
  const areas = areaList ? new Areas(areaList) : null;
  if (!areas) console.warn('stage areas off: data/enemies/ai.json has no areas (re-export data/enemies); area children (barrels, items, placed sounds) stay off');
  const placedHas = k => (areas ? areas.has(k) : k >= 0);      // FUN_0053b920: the child has a parent area
  let musicRestart = null;                         // checkpoint.js: the zone music / ambience again (set below)
  let seRestart = null;                            // the Restart's IOP command 0x23, once per Restart (audio.js RestartSound; set below)
  // GUESS (worker 0210): the zone music / ambience stay silent while the opening event plays; the event's own cue
  // (playMusic2 bgm_274, FUN_003a02b8; ambience asj_036) is not translated (notes/fidelity-audit.md 'event music')
  let soundProbe = null, soundStop = null;           // tests: what's playing, stop it
  const introGate = { on: false, event: false, handing: false, heard: () => true };
  // worker 0222: with the opening on the page, its own natives (event_sound.js) start the music / ambience: ev0101's
  // playBgAreaSound("asj_036", 127), playMusic2("bgm_274"), playMusic3("bgm_001", 0, 4000). introGate.event: the
  // load-time start below stays off. introGate.handing: the hand-off (not a stage reload) keeps them playing.
  let areaSoundHook = null;                        // stage-script manager cmd 6 -> FUN_003e6c88 (AreaSound.play; worker 0212)
  const pauseSound = { audio: null, music: null };   // pause_layer.js: menu sounds + the pause's SE hold / BGM volume
  const snd = (name, pos, range = 400.0) => (sfx ? sfx.play(name, pos, range) : null);   // worker 0270: the slot (FUN_0033d788's +0x18c handle)
  const sndStop = slot => { if (sfx && sfx.stop) sfx.stop(slot); };                       // worker 0270: FUN_0033cf00
  // worker 0277: the jump classes' sounds (jump_core.js JumpMotion / BackJumpMotion / LandMotion phase 0). A named one is
  // FUN_00341268 -> FUN_0054b158(P, name, 1): FUN_0054ae78 (P+0x40 bit 7: (0, P+0x30 x 0.5, 0) through P's matrix = 9 above
  // his feet; T w277_jump: body y - 9 at f11 / f141) -> FUN_0033cc48 (positioned; T: pan 65, vol 116 for both take-off sounds).
  // foot(kind) = FUN_00341410(C, kind) -> FUN_003415d8 (ambient.js kindCue: the floor material C+0x6c1, as the footsteps).
  // cue = FUN_003412d0 in the AI world (his cue table, its 15-frame gate C+0x810 shared with the hit voice).
  const jumpAt = () => [ctrl.pos.x, Math.fround(ctrl.pos.y - Math.fround(18 * 0.5)), ctrl.pos.z];   // P+0x30 = 18 (H_PLAYER)
  ctrl.jumpSound = {
    // GUESS: bVar1 (FUN_00326500() and the status record's +0xae == 5 through C+0x54c) taken false: its inputs are not on the
    // page; false in z128 (T w277_jump: the second jump played bsj_520, not bsj_525). See notes/fidelity-audit.md
    wet: false,
    name: (n) => { if (n) snd(n, jumpAt()); },
    foot(kind) {
      if (!amb.data || !amb.AM) return;
      const poly = ctrl.active ? null : ctrl.body.poly;
      const mat = poly == null || !col.polys ? 0 : (col.polys[poly].word6 & 0xff);   // FUN_00340e08 (as the footsteps above)
      const k = amb.AM.kindCue(amb.data.foot, mat, kind, amb.data.version);
      if (k !== null) this.name(amb.data.foot.cues[k] || '');
    },
    cue(c, force) {
      if (enemyAI && enemyAI.playerCue) enemyAI.playerCue(c, force);
      else if (!this.warned) { this.warned = true; console.warn('jump: no enemy AI world: Vincent\'s cue ' + c.toString(16) + ' (FUN_003412d0) not played'); }
    },
  };
  if (SOUND) import('./audio.js').then(({ GameAudio, SoundEmitters, RestartSound }) => {
    const au = new GameAudio();
    pauseSound.audio = au;
    au.load(128).then(() => { sfx = new SoundEmitters(au); window.__play && (window.__play.sfx = sfx); })
      .catch((e) => console.warn('audio: no SE data (tools/audio/extract.py)', e));
    au.ready.then(() => Promise.all([import('./ambient.js'), import('./music.js'), import('./audio.js'),
        fetch('data/audio/ambient_z128.json').then((r) => { if (!r.ok) throw new Error('ambient_z128.json ' + r.status); return r.json(); })]))
      .then(([AM, MU, AU, data]) => {
        amb.data = data; amb.AM = AM; amb.sfx = sfx;      // (tests: window.__play.sfx is set only when __play exists first)
        amb.slots = new AM.SlotStreams(au, { emitterVolPan: AU.emitterVolPan, SeStream: MU.SeStream, hexBytes: AU.hexBytes });
        amb.slots.areaFn = (n, v) => { if (areaSoundHook) areaSoundHook(n, v); };      // FUN_003e6c88 (music.js AreaSound)
        amb.placed = new AM.PlacedSounds(data, amb.slots);
        amb.placed.stageStart(placedHas, k => !!areas && areas.isOn(k));   // FUN_0053ced8 + the areas already on (worker 0223)
        // FUN_003e9c38 into the MP's slot (FUN_005a8bc8: opened at a zero position -> flag 0x8000, pan 0x40; range 400).
        // T: w215_* 56 / 56 footstep requests pan 0x40, vol from the distance
        amb.foot = new AM.Footsteps(data.foot, data.version, (n, pos) => {
          const sl = sfx ? sfx.play(n, pos) : null;
          if (sl && sl !== -1) sl.flags |= AU.SLOT_FLAGS.NOPOS;
        });
      })
      .catch((e) => console.warn('ambient: placed sounds / footsteps off (export_web_ambient.py)', String(e)));
    ['keydown', 'pointerdown'].forEach((e) => addEventListener(e, () => { try { au.resume(); } catch (e2) { /* no AudioContext */ } }));
    // zone music bgm_001 + area ambience asj_033 (music.js; notes/audio-research.md "Music and ambience")
    // GUESS: started at the first gesture from frame 0 (browser rule; the game's runs from zone load; notes/fidelity-audit.md)
    import('./music.js').then(({ GameMusic, AreaSound }) => {
      const mu = new GameMusic(au), area = new AreaSound(au); let areaOn = false, muOn = false;
      pauseSound.music = mu; introGate.heard = () => !!(au.ctx && au.se); soundProbe = () => ({ music: mu.name, area: area.name, on: introGate.on, event: introGate.event }); soundStop = () => { mu.stopMusic(); area.stop(); };
      // ev0100 playBgAreaSound("asj_033"); ev0101 playMusic3("bgm_001", 0, 4000) (no stream open: starts at once)
      const go = () => {
        if (!au.ctx || !au.se) return;
        // the opening's requests made before the browser's first gesture (no AudioContext): the last ones start now (L)
        if (introGate.event) {
          const r = introRt;
          if (r && r.lastArea && area.name === null) area.play(r.lastArea[0], r.lastArea[1]);
          if (r && r.lastMusic && mu.name === null && mu.meta) mu.open(r.lastMusic[0], r.lastMusic[1]).catch((e) => console.warn('music:', e));
          if (!intro) introGate.event = false;     // the opening is over: this was the one late start
          return;
        }
        if (introGate.on) return;
        if (!areaOn) { areaOn = true; area.play('asj_033'); }
        if (!muOn && mu.meta) { muOn = true; mu.playMusic3('bgm_001', 0, 4000).catch((e) => console.warn('music:', e)); }
      };
      mu.load(128).then(go, (e) => console.warn('music: no BGM data (tools/audio/bgm.py)', String(e))); au.ready.then(go, () => {});
      // Restart (checkpoint.js). GUESS: the stage reload stops the BGM / ambience and its ev0100 / ev0101 start them again
      // (the teardown is not decoded)
      // record (worker 0254): a scene_save's reload: main's flag-18 branch starts them (areaOn / muOn: the gesture's go() stays out)
      seRestart = new RestartSound(() => ({ au, slots: amb.slots }));
      musicRestart = (record = false) => { if (introGate.handing) areaOn = muOn = true;   // the opening's sounds go on: a key doesn't start the stage's over them
        else { mu.stopMusic(); area.stop(); areaOn = muOn = record; if (!record) go(); }
        // the stage reload makes the section-22 objects again (FUN_00548788): their sounds stop, the new ones start from scratch
        // worker 0271: their SEs are ended by the Restart's IOP command 0x23, once: at the pause's OK, else here (RestartSound.reload),
        // then the slot table is freed
        if (!introGate.handing) { if (au.zoneCode !== undefined) au.seBlock1(au.zoneCode); seRestart.reload(); }
        if (amb.slots) { if (introGate.handing) amb.slots.stopAll(); amb.placed = new amb.AM.PlacedSounds(amb.data, amb.slots); amb.placed.stageStart(placedHas); }
        // a new MP for Vincent: no feet up (MP+0x440 bits 16-19), no name yet, no previous position
        if (amb.foot) { amb.foot.test.bits = 0; amb.foot.mat = amb.foot.gait = -1; amb.foot.name = ''; }
        amb.footPrev = null;
        // the stage reload loads the zone's sep.bin into SE block slot 1 again (FUN_00402220): an event's block doesn't outlive a
        // Restart (worker 0266). The Restart's OK (FUN_003c0a20 -> FUN_00380b00 = FUN_003e7f60(-1, -1, -1) -> IOP command 0x23)
        // ends every SE playing but 0x461 .. 0x463: event SEs, kept loops, shots' sounds finish their release (audio.js restartSe;
        // worker 0271, was a cut). GUESS: a scene_save's reload (record) does the same (its teardown not decoded; see
        // notes/fidelity-audit.md 'Restart: the SEs playing'). Not on the opening's hand-off (no stage reload: an event SE such as
        // scr001's 50017 plays on; the events' own loadSoundEffectEx_l(1, 100) restores the slot)
        // (both done above, before the new placed sounds: seBlock1, RestartSound.reload)
      };
      // a stage script's cmd 6 (enemy_ai opts.areaSound): FUN_003e6c88(name, vol). L: before the first gesture it is lost
      areaSoundHook = (n, v) => { if (au.ctx && au.se) { areaOn = true; area.play(n, v); } };
      ['keydown', 'pointerdown'].forEach((e) => addEventListener(e, () => setTimeout(go, 0)));
    });
  }).catch((e) => console.warn('audio: off', e));
  // FUN_003e9ed0's listener on frame k is the game state of two pad polls before (audio.js soundListener)
  const sndHist = [];
  // the game's effect engine (effects.js; data from export_web_effects.py): the bullet wall impacts and the hits on Vincent
  let fx = null, fxLayer = null, fxIds = null;
  let fxStage = null, fxStageLayer = null;          // worker 0208: the level manager DAT_004ee3c0 (z128's fire, smoke, embers)
  // this game frame's camera (follow.update(1): the eye, up -y, along CAM+0x80) for the effect draw pass
  const fxCam = new THREE.PerspectiveCamera();
  const fxCamera = () => {
    const e = follow.eye, d = follow.M[2];
    fxCam.position.set(e[0], e[1], e[2]); fxCam.up.set(0, -1, 0); fxCam.lookAt(e[0] + d[0], e[1] + d[1], e[2] + d[2]);
    return fxCam;
  };
  // fetched only when scene.json declares it (export_web_effects.py writes "effects"): no 404 without the data
  if (FX && !scene.effects) console.warn('effects: not exported (run native/assets/models/export_web_effects.py)');
  if (FX && scene.effects) try {
    const get = n => fetch('data/' + scene.effects + '/' + n).then(r => { if (!r.ok) throw new Error(`${n}: HTTP ${r.status}`); return n.endsWith('.json') ? r.json() : r.arrayBuffer(); });
    const [fed, core, ids] = await Promise.all(['r0001.fed', 'core_ef.bin', 'ids.json'].map(get));
    // r0000.fed (FileCode 0, worker 0200): the hit on Vincent's 0x1000; fetched only when ids.json lists it (an older
    // export has no "feds": warned, left out, no 404)
    const fed0 = (ids.feds || []).includes('r0000.fed') ? await get('r0000.fed')
      : (console.warn('effects: data/effects has no r0000.fed (re-run export_web_effects.py): effect 0x1000 left out'), null);
    // worker 0270: the model FEDs (e023 / e024: their rockets' trails and blasts), linked into the same manager
    const models = ids.models ? await Promise.all(ids.models.map(get))
      : (console.warn('effects: ids.json lists no model FEDs (re-run export_web_effects.py): rocket trails and blasts left out'), []);
    fx = createEffects({ fed, fed0, core, warn: m => console.warn(m), twister: ids.twister, rand: ids.rand, models, models0Feds: [0x90c00000] }); fxIds = ids;   // worker 0269: the EM barriers' beam models (= the w269 dumps)
    fxLayer = new EffectLayer(THREE, fx); fxLayer.deferred = true; root.add(fxLayer.group);
    // worker 0208: z128's area FEDs in the level manager DAT_004ee3c0 (its own engine on the same LCG / VU0 R, reseeded
    // once a frame by the impacts' engine, which FUN_002efc78 runs first): FUN_002f15d0's load spawns their auto-start
    // records (stageLoad); FUN_002ea6a0 culls them by the hidden cells (DAT_004e8710: the shared visMask, worker 0225),
    // the camera and their fade
    // without rand() (no --state export) the impacts' engine spawns nothing (createEffects); the stage engine, which shares
    // its RNG, is left out the same way rather than run on an unseeded LCG
    if ((ids.stage || []).length && (ids.rand === undefined || !roomVis)) console.warn('effects: no rand() state in ids.json (re-run export_web_effects.py --state) or no room visibility probe (data/z128_vis.json): the z128 fire is left out');
    else if ((ids.stage || []).length) {
      const stage = await Promise.all(ids.stage.map(get));
      fxStage = createEffects({ fed: stage[0], stage, core, rng: fx.rng, reseed: false, cull: true, mask: visMask, occl: roomOccl, hiddenScript: ids.hidden_script || [], models0: true, warn: m => console.warn(m) });
      fxStage.stageLoad();
      fxStageLayer = new EffectLayer(THREE, fxStage); fxStageLayer.orderBase = 3000; fxStageLayer.deferred = true; root.add(fxStageLayer.group);
    } else console.warn('effects: data/effects has no stage FEDs (re-run export_web_effects.py): the z128 fire is left out');
    window.__fx = { fx, layer: fxLayer, ids, stage: fxStage, stageLayer: fxStageLayer };   // for the page tests
  } catch (e) { console.warn(`effects: off (${e.message}; run export_web_effects.py)`); fx = null; }
  let enemyAI = null, aiOpts = null, wakeSave = null;
  // worker 0270: the shots' models and trails (Dragonfly's rockets, the boss's missiles; shot_fx.js)
  const shotFx = createShotFx({ root, fx, world: () => enemyAI, litPatch, light, stopSound: sndStop });
  if (aiData) for (const m of new Set(aiData.weapons.map(w => w.model).filter(Boolean))) shotFx.preload(m);
  // worker 0209: the barrels (data/props/props.json, export_web_props.py): their logic joins each AI world (props.attach)
  const propsData = PROPS && ENEMY_AI && aiData ? await fetch('data/props/props.json').then(r => r.ok ? r.json() : null).catch(() => null) : null;
  if (PROPS && ENEMY_AI && aiData && !propsData) console.warn('props: data/props/props.json missing (run export_web_props.py): no barrels');
  // worker 0257: the room's node animations, the doors (chunk_anim.js): the vertices follow (room.js createRoomNodes)
  const roomNodes = createRoomNodes(root);
  if (propsData && !propsData.chunkAnims) console.warn('props: props.json has no chunkAnims (re-export data/props, export_web_props.py): the doors do not open');
  const chunkAnims = propsData && propsData.chunkAnims ? new ChunkAnims(propsData.chunkAnims, { onNode: (c, n, M) => roomNodes.move(c, n, M) }) : null;
  const g048Json = propsData ? await fetch('data/props/g048.json').then(r => r.ok ? r.json() : null).catch(() => null) : null;   // worker 0269: the beams' bone (bind pose)
  const props = propsData ? createProps({ data: propsData, weapons: aiData.weapons, areas,
    effect: fx ? { spawn: (id, p, sc) => fx.spawn(id, p, sc), hit: (kind, cls, p) => { const id = hitImpactId(fxIds, kind, cls, fx.warn); if (id >= 0) fx.spawn(id, p); },
                   attached: (id, att) => fx.spawn(id, [0, 0, 0], null, att), softEnd: em => fx.softEnd(em), remove: em => fx.remove(em) } : null,   // worker 0269: the barriers' beams
    models: { g048: g048Json },
    // worker 0269: the EM barriers' hum (asj_620) in the placed sounds' slots (ambient.js SlotStreams; none before the audio loads)
    hum: { open: (n, p, v, o) => (amb.slots ? amb.slots.open(n, p, v, o) : null), close: h => { if (amb.slots) amb.slots.close(h); } } }) : null;
  let propsView = null;
  // worker 0224: the item pickups and drops (data/items/items.json, export_web_items.py); they join each AI world (items.attach)
  const itemsData = ITEMS && ENEMY_AI && aiData ? await fetch('data/items/items.json').then(r => r.ok ? r.json() : null).catch(() => null) : null;
  if (ITEMS && ENEMY_AI && aiData && !itemsData) console.warn('items: data/items/items.json missing (run export_web_items.py): no pickups');
  let itemsView = null, itemsWeapon = null;
  const items = itemsData ? createItems({ data: itemsData, areas,
    effect: fx ? { spawn: (id, p) => fx.spawn(id, p) } : null,                 // FUN_003365e0(0x4800, ..)
    // FUN_0057fb38's room ray: the first walk polygon from 5 above to 300 below; flags 0x112 refuse it (L: FUN_0026a668
    // -> FUN_00270ff8 walks the same polygons as collision.js findPoly)
    ground: p => { const h = col && col.findPoly ? col.findPoly(p[0], p[2], p[1] - 5, p[1] + 300, true) : null;
      return h && !(col.polys[h[0]].flags & 0x112) ? h[1] : null; },
    // FUN_0054c308's camera (FUN_003ee608: the camera rendered, an event camera's too): the eye (camera +0x30) and +0xd0 = tan of half the
    // horizontal fov (save RAM 0.7467 at 73.5 = 1 / the projection's x scale 1.3391, effects.js CULL)
    camera: () => ({ pos: cameraView(renderFxCamera()).eye, tanHalf: Math.tan((renderFov() ?? 73.5) * 0.008726647) }),
    stats: (k, n) => { if (stageRes) stageRes.stats.add(k, n); },              // FUN_0031d668 (worker 0243: the item use's stat 4)
    hud: m => { if (itemsWeapon) itemsWeapon.hudMask |= m; } }) : null;         // FUN_005740c0: DAT_0046e54c |= 0x6e
  // FUN_0054ef68 -> vt+0x14c on the area's children (worker 0223): barrels, items, placed sounds
  // worker 0251: and the actors (enemy_ai areaSwitch, FUN_0055a0d8); the current world, as a Restart replaces it
  if (areas) areas.onSwitch = (k, on) => { if (props) props.areaSwitch(k, on); if (items) items.areaSwitch(k, on); if (amb.placed) amb.placed.areaSwitch(k, on); if (enemyAI && enemyAI.areaSwitch) enemyAI.areaSwitch(k, on); };
  const bodyRecs = new Set();                        // records the AI activated (onActivate): their bodies go at a Restart
  const startBodies = new Set(enemies ? enemies.actors.map(a => a.rec) : []);   // the bodies drawn at the start   // aiOpts / wakeSave: rebuilt by the Restart (checkpoint.js)
  let gameHud = null;                                // the game's HUD (hud.js), set up below; enemyAI's hudHit reads it
  let stage = null, stageData = null, createStage = null, stageGs = null, stageSi = null;
  let stageSiLoading = params.get('stage') !== '0';   // worker 0265: stage_info.js and its data still loading (the opening's title card waits)
  let stagePaused = false;                        // worker 0257: main's events' event pause (stageEventKey)
  let stageRes = null;                            // results.js (worker 0232): the section stats, the level end's Status screen
  try {
    if (enemies) enemies.mpHead = vin.body;            // newer actors draw before older ones (enemies.js add)
    aiOpts = ENEMY_AI && aiData && enemies ? { data: aiData, player: php, rand: () => aiRng.rand(), log: m => console.log(m), damage: ENEMY_DMG, chunkAnims,
      globalFlags: () => (stage ? stage.globalFlags : null),   // manager cmds 9 / 0xa (FUN_0037ce60 / FUN_0037cea0)
      viewCam: () => { const v = cameraView(renderFxCamera()); return { eye: follow.eye.slice(), toView: v.toView, fov: renderFov() ?? 73.5 }; },   // manager cmd 0xab (FUN_0053da98)
      sound: snd,
      soundStop: sndStop,                                      // worker 0270: a bullet's own sound (+0x18c) stopped at its delete
      stats: { add: (k, n) => { if (stageRes) stageRes.stats.add(k, n); } },   // FUN_0031d668: the section stats (results.js, worker 0232)
      areaSound: (n, v) => { if (areaSoundHook) areaSoundHook(n, v); },   // stage-script cmd 6 (worker 0212)
      cellMask: (bit, on) => visMask.setScript(bit, on),   // stage-script cmds 0x54 / 0x55 (worker 0208) -> DAT_004e8700 (worker 0225)
      // FUN_00335f40 / FUN_003361b8: the impact and hit effects (effects.js)
      effect: fx ? { wall: (mat, n, p) => { const id = wallImpactId(fxIds, mat, n, fx.warn); if (id >= 0) fx.spawn(id, p); },
        hit: (kind, cls, p) => { const id = hitImpactId(fxIds, kind, cls, fx.warn); if (id >= 0) fx.spawn(id, p); },   // FUN_003361b8
        spawn: (id, p) => fx.spawn(id, p) } : null,           // FUN_003366b8(id) + FUN_00335020(pos): the bullet-end effect
      props,                                                   // worker 0209: the barrels (props.js)
      shotFx,                                                  // worker 0270: rocket / missile models and trails (shot_fx.js)
      items,                                                   // worker 0224: the item pickups and drops (items.js)
      // FUN_00567c08: a bullet's hit on Vincent -> the HUD's hit-direction ring (hud.js; gameHud is set up below)
      hudHit: (p, from) => { if (gameHud) gameHud.hit(p, from); },
      // worker 0237: manager 0x6e / 0x6f / 0x70 and the boss brain's FUN_00aa11b8 -> the HUD's top-right gauge (hud.js gauge)
      hudGauge: (cmd, g) => { if (gameHud) gameHud.gauge(cmd, g); },
      // the walk mesh for soldiers' physics bodies (mover 3, move mode 0xc; body flags 0x36: not a block80 body)
      walkMesh: col,
      // the save's dead records (41-43): FUN_00559748 refuses to activate them
      deadRecs: enemies.deadRecs,
      // cmd 0x108 / 0x109 / 0x130 on a section-1 record: its body appears / goes (enemies.js add / remove)
      onActivate: rec => { bodyRecs.add(rec.rec); enemies.add(rec); },
      onDeactivate: rec => { enemies.remove(rec); },
      // the locomotion table's root speeds (FUN_00345e58, motion state 8; enemies.js rootSpeed)
      rootSpeed: (model, clip) => enemies.rootSpeed(model, clip),
      rootTurn: (model, clip) => enemies.rootTurn(model, clip),
      // the attack clips' root bone track (the lunge: FUN_00343160 root sample, mover 8; enemies.js rootTrack)
      rootTrack: (model, clip) => enemies.rootTrack(model, clip),
      // GUESS: FUN_005449f0 probe 3 = the page's collision triangle set (probe sets not decoded)
      los: (a, b) => !!(col.segment && col.segment({ x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] })),
      // manager cmd 0xab's map ray: FUN_0054fc38's probe 3 word, 0x187 (RAM 0x58c990[3])
      viewRay: col.segment && col.probeFlags ? (a, b) => !!col.segment({ x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] }, col.probeFlags(0x187)) : null,
      // the bullets' room probe FUN_00553808 -> FUN_0026a320(a, b, 0x18d): sub-tree 1 packets of probe set 0x18d
      roomRay: col.segment && col.probeFlags ? (a, b) => {
        const h = col.segment({ x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] }, col.probeFlags(0x18d));
        if (!h) return null;
        const r = [h.point.x, h.point.y, h.point.z];
        r.surface = h.surface;                     // the hit polygon's surface word (FUN_00553660 material)
        r.normal = h.normal.map(v => -v);          // the game's hit normal (+0x100): the page's negated (MEASURED; effects.js floorHit)
        return r;
      } : null,
      // Vincent's hit reaction FUN_00565480 (player.js hitReact): his C update for this frame runs again
      // with the hit (the game runs it after the object lists); php.pos follows in place
      react: h => { const r = ctrl.hitReact(h); php.pos[0] = ctrl.pos.x; php.pos[1] = ctrl.pos.y; php.pos[2] = ctrl.pos.z; php.face = [ctrl.C.face.x, ctrl.C.face.y, ctrl.C.face.z]; return r; },
      // C+0x590 & 0xf, the hit side (FUN_0055d678 writes it, the death class reads it): on his C
      hitSide: { get: () => ctrl.C.hitSide ?? 0, set: s => ctrl.setHitSide(s) },
      // Vincent's skeleton for the bullets (vt+0x5c bone 3, the part boxes): the drawn joints (the last drawn pose,
      // as the game's MP buffer when the bullets update) placed at his start-of-frame position and facing
      // (after: his C after this frame's update = the controller now, the tick runs after ctrl.step)
      playerBoneWorld: after => {
        const pos = after ? [ctrl.pos.x, ctrl.pos.y, ctrl.pos.z] : vinStart.pos, h = after ? ctrl.heading : vinStart.h;
        if (!pos) return null;
        return b => {
          const j = vinJoints[b];
          if (!j) return null;
          const q = j.quaternion, sc = j.scale, t = j.position;
          return boneRows([q.x, q.y, q.z, q.w], [sc.x, sc.y, sc.z], [t.x, t.y, t.z], pos, [Math.sin(h), 0, Math.cos(h)]);
        };
      } } : null;
    enemyAI = aiOpts ? createEnemyAI(aiOpts) : null;
    if (props && enemyAI) propsView = await setupPropsView({ root, props, litPatch, light }).catch(e => { console.warn('props: not drawn:', e.message); return null; });
    if (props) { window.__props = props; window.__propsView = propsView; }   // for the page tests
    if (items && enemyAI) itemsView = await setupItemsView({ root, items }).catch(e => { console.warn('items: not drawn:', e.message); return null; });
    if (items) { window.__items = items; window.__itemsView = itemsView; }   // for the page tests
    // The save's soldiers, as stored in sea-of-flames.p2s (object table *(DAT_0046e880+0x1164)[rec + 22]):
    // actor state +0x104 (also T: k_enemy_engage8 f760) and +0x118. Their script vars +0xa0 are all 0
    // there (the page's default), and +0x28 = 0x208403 (bit 0x100000 clear: their activation's script
    // event 3 has run, FUN_0053fde8 case 8), so event 3 is not rerun here. Record 45's 0x10000000 is
    // that event 3's cmd 0x14c(28) (script 109); 0x200 is not read on the page. GUESS: what activated
    // them before the save is not decoded (notes/enemy-activation.md §1), so FUN_00559748 is not rerun.
    const AWAKE_STATE = { 44: 1, 45: 2, 46: 1, 47: 1, 48: 2, 49: 2, 66: 1 };
    const AWAKE_F118 = { 44: 0, 45: 0x10000200, 46: 0, 47: 0, 48: 0x200, 49: 0x200, 66: 0 };
    wakeSave = (ai, ks = AWAKE) => { for (const k of ks) ai.addActor({ rec: k, astate: AWAKE_STATE[k], f118: AWAKE_F118[k] }); };
    if (enemyAI) wakeSave(enemyAI);
  } catch (e) { console.warn('enemy AI off:', e.message); enemyAI = null; aiOpts = null; }
  // test aids that move him (H, ?ladder=): the cloth restarts from the new pose (cloth.js reset)
  // and the camera resets as at spawn (player.js reset(): FUN_003285d0's snap; GUESS: the
  // angles are CAM_SPAWN, and whether the game resets the camera on a warp is not decoded)
  // Warp (ladder test aid): FUN_003285d0 takes the angles from render view 1's forward. GUESS:
  // that is the current view (not decoded; notes/fidelity-audit.md), so the warp keeps yaw/pitch.
  ctrl.onTeleport = () => {
    if (cape) cape.cloth.started = false; follow.reset(ctrl.pos, { yaw: follow.yaw, pitch: follow.pitch });
    if (light) light.stream.everyChunk();          // PAGE AID (area_stream.js): every chunk until a box's pair has loaded
  };
  attachGun(vin.mixRoot);                          // static gun under j56 (gun.js), loads in the background
  // the game's follow camera (player.js, FUN_0032ace0); its ray tests the camera collision
  // class (null with the stub: no pull-in). Starts at the save state's camera values (GUESS
  // for the page's spawn, player.js CAM_SPAWN).
  const follow = new FollowCamera(camera, camRays || null);
  // the camera's rays test the chunks in the loaded slots (FUN_0054fc38 -> FUN_0026a320 over DAT_004e4c60; worker 0244):
  // the area stream's slot table, not its everyChunk() page aid (that one is for drawing and light 2 only)
  if (camRays && light) camRays.chunks = () => light.stream.slots.filter(sl => sl.loaded).map(sl => sl.chunk);
  // FUN_005449f0 probe 6's other objects (worker 0257): the current world's box triggers, barrels and class 3 boxes. The other gimmicks with +0x38
  // bit 6 (crates, g0xx: classes 0x5914e8 / 0x591bc8 / 0x58c630, section 15 records other than e057) are not on the page
  if (camRays) { camRays.objects = (a, b) => (enemyAI && enemyAI.cameraObjects ? enemyAI.cameraObjects(a, b) : null); console.warn('camera: FUN_005449f0 probe 6: the gimmicks other than the barrels and class 3 (not on the page) do not stop the camera'); }
  if (MOUSE_DIRECT) follow.mouseDirect = { sens: MOUSE_SENS * Math.PI / 180 };   // OPTION mouselook
  follow.reset(ctrl.pos);
  // the room's mask before the first game frame (worker 0225): the probe from the start camera
  roomProbe(follow.eye, fxCamera()); roomShow();

  // ---- actions (player.js header / ACTIONS.md)
  const motions = {};
  loadMotions('vincent').then(m => Object.assign(motions, m)).catch(e => console.warn(e.message));
  ctrl.attach({ anim, motions });
  ctrl.ctx.cam = follow;                           // the ladder's FUN_00328640 (CAM+0x1c8, actions/ladder.js)
  let actionHelp = [];
  if (params.get('actions') !== '0') {
    for (const a of await loadActions()) { ctrl.addAction(a.action); if (a.help) actionHelp.push(a.help); }
    // worker 0257: FUN_00333150's choice of a non-ladder trigger (a door): enemy_ai, the current world's
    { const L = ctrl.actions.find(a => a.name === 'ladder'); if (L) L.doors = { choose: (o, d) => (enemyAI && enemyAI.gimmickChoose ? enemyAI.gimmickChoose(o, d) : null), use: (c) => { if (enemyAI) enemyAI.gimmickUse(c); } }; }
  }
  let packsLoaded = [];
  // the game frame waits for the packs: the game never runs a level before its motion data is in
  // memory. Without this a ✕ pressed while the jump pack was still downloading played the whole
  // jump on a frozen idle pose (jumpFrame keeps the head when the clip is missing).
  let packsDone = false;
  const packsReady = loadPacks(PACKS, anim, motions).then(g => { packsLoaded = g; packsDone = true; return g; });
  // the weapon (aim.js): FUN_00579570 in ctrl.step, the camera's weapon views (follow.weapon), the
  // reticle in the frame (output.hud). isFrozen: the report freeze or the pause menu (both declared below;
  // false until then), so a click while paused can't leave an R1 press that fires on resume
  const weapon = AIM ? await setupAim({ ctrl, anim, motions, col, follow, output, vin, canvas,
                                     isFrozen: () => { try { return frozen || paused; } catch (_) { return false; } } }) : null;
  actionHelp.push('Space jump (✕; the ladder takes it first)');
  if (weapon) actionHelp.push(weapon.help);
  if (items) actionHelp.push('E use item (D-pad →)   Q next item (D-pad ←)');   // worker 0243: pad table 0x46bae0 ids 0x1d / 0x1e
  // Vincent's bullets vs the soldiers (aim.js onShot -> enemy_ai playerShot, FUN_00577480), fired in
  // enemyAI.tick after the AI scheduler (the game's frame order, FUN_00323128)
  if (weapon && enemyAI) weapon.onShot = (...shot) => enemyAI.queueShot(...shot);
  // the draw / holster sounds (weapon.json se_draw / se_holster (aim_core.js): FUN_005766c0 at Vincent's C+0x90)
  if (weapon) weapon.core.sound = (name) => snd(name, [ctrl.pos.x, ctrl.pos.y, ctrl.pos.z]);
  // the lock-on's soldiers (FUN_00328968 in aim.js aimRay; lock_on.js)
  // the ammo item's count is aim_core's Ammo, read live (its reset makes a new one; worker 0224)
  if (items && weapon) { itemsWeapon = weapon.core; items.inventory.ammo = () => weapon.core.ammo; }
  if (weapon && enemyAI) weapon.targets = () => props ? enemyAI.lockTargets().concat(props.lockTargets()) : enemyAI.lockTargets();   // + the barrels (worker 0209)
  // the game's HUD in the frame (hud.js, after the reticle in output.hud); follows php.hp each game frame
  // fetched only when scene.json declares it (export_web_hud.py writes "hud"): no 404 without the data
  gameHud = GAMEHUD && scene.hud ? await setupHud({ output, player: php, url: 'data/' + scene.hud, camYaw: () => follow.yaw, weapon: weapon ? weapon.core : null, items: items ? items.inventory : null }) : null;
  if (GAMEHUD && !scene.hud) console.warn('hud: not exported (run native/assets/models/export_web_hud.py)');

  // detached debug camera (?cam=), same format as main.js
  let detached = null;
  function setCam(str) {
    const v = String(str).split(',').map(Number);
    if (v.length !== 5 || !v.every(Number.isFinite)) return false;
    const y = v[3] * Math.PI / 180, p = v[4] * Math.PI / 180;
    const dir = new THREE.Vector3(Math.sin(y) * Math.cos(p), -Math.sin(p), Math.cos(y) * Math.cos(p));
    detached = { pos: new THREE.Vector3(v[0], v[1], v[2]), dir };
    return true;
  }
  if (params.has('cam')) setCam(params.get('cam'));

  // ---- input
  const keys = new Set();
  const pressed = new Set();                       // key-down edges not yet seen by a tick
  let frozen = false;                              // report mode: no input, no simulation
  const typing = e => /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
  addEventListener('keydown', e => {
    if (typing(e) || frozen) return;
    keys.add(e.code);
    if (!e.repeat) pressed.add(e.code);
    // H: back to the spawn (debug aid, not a game feature)
    // page aid (worker 0181): H also puts HP back to the save's 780, so a dead Vincent (state 7, FUN_005786e8's
    // HP gate) can play on. Not the game's retry: that goes game over -> Restart -> the points tally -> the
    // stage-result Status screen -> (not traced further); the soldiers keep their target-dead state.
    // H also rebuilds the HUD and slides it in as after a Restart (hud.js reset; page aid, not the game's: even while
    // Vincent is alive).
    if (e.code === 'KeyH') { php.hp = 780; if (gameOver) gameOver.reset(); if (gameHud) gameHud.reset(); follow.clearDeath(); ctrl.reset(); if (cape) cape.cloth.started = false; if (weapon) weapon.reset(); if (weapon && weapon.core) weapon.core.hudMask = 0xffffffff; php.s64 = 0; follow.reset(ctrl.pos); detached = null; if (light) light.stream.reset(light.startPair); }   // respawn (PAGE AID: the stream back to the start pair, area_stream.js): spawn angles (ctrl.reset cancels the ladder: its exit() clears CAM+0x1c8; the reset FUN_00329f68 -> FUN_003285d0 leaves CAM+0x1c4 / +0x1c8)
    if (e.code === 'KeyR') { e.preventDefault(); report.open(); }
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });
  addEventListener('keyup', e => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());
  canvas.addEventListener('click', () => { try { canvas.requestPointerLock?.(); } catch (_) { /* drag fallback */ } });
  // Chrome can report one huge movementX/Y right after locking: skip that first
  // event and clamp spikes so the camera doesn't spin.
  let skipMove = false;
  const mouse = new MouseFeed();                   // mouse counts until the next game frame(s)
  // a camera reset (H respawn, teleport, ladder warp) also drops mouse counts banked for later game frames
  { const reset = follow.reset.bind(follow); follow.reset = (...r) => { mouse.dx = mouse.dy = 0; return reset(...r); }; }
  document.addEventListener('pointerlockchange', () => { skipMove = true; });
  const clampMv = v => Math.max(-150, Math.min(150, v));   // GUESS: browser input spike clamp (port convenience, not game logic)
  addEventListener('mousemove', e => {
    if (document.pointerLockElement !== canvas) return;
    if (skipMove) { skipMove = false; return; }
    if (!frozen && !detached) mouse.add(clampMv(e.movementX), clampMv(e.movementY));   // the game's USB-mouse look (player.js MOUSE_SCALE, MouseFeed)
  });
  let drag = null;
  canvas.addEventListener('pointerdown', e => { if (!document.pointerLockElement) drag = [e.clientX, e.clientY]; });
  addEventListener('pointerup', () => { drag = null; });
  addEventListener('pointermove', e => {
    if (!drag || document.pointerLockElement || frozen || detached) return;
    mouse.add(e.clientX - drag[0], e.clientY - drag[1]); drag = [e.clientX, e.clientY];
  });
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    output.fitCamera(camera);
    if (intro) intro.refit();                      // the event camera's fov again at the next render (intro.js)
    if (stageView) stageView.refit();              // the same for main's events (stage_view.js, worker 0248)
  });

  // keys -> camera-relative world direction through the camera matrix (rows 2 / 0)
  function aim(inp, { f, r }) {
    const x = inp.fwd * f.x + inp.side * r.x, z = inp.fwd * f.z + inp.side * r.z;
    return { ...inp, x, z };
  }
  function readInput() {
    let fwd = 0, side = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) fwd += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) fwd -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) side += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) side -= 1;
    return aim({ fwd, side, run: keys.has('ShiftLeft') || keys.has('ShiftRight'), keys, pressed }, follow.basis());
  }

  // ---- Report button (report.js, shared with the main viewer)
  const toastEl = document.getElementById('toast');
  let toastT = 0;
  function toast(text, ms = 3000) {
    toastEl.textContent = text; toastEl.style.display = 'block';
    clearTimeout(toastT); toastT = setTimeout(() => { toastEl.style.display = 'none'; }, ms);
  }
  const r4 = v => +v.toFixed(4);
  // camera in main.js's ?cam= convention: dir = (sin y cos p, -sin p, cos y cos p), degrees
  function camView() {
    const d = camera.getWorldDirection(new THREE.Vector3());
    const yaw = Math.atan2(d.x, d.z) * 180 / Math.PI, pitch = Math.asin(Math.max(-1, Math.min(1, -d.y))) * 180 / Math.PI;
    const cam = [...camera.position.toArray().map(v => v.toFixed(2)), yaw.toFixed(3), pitch.toFixed(3)].join(',');
    const link = new URL(location.href);
    link.search = ''; link.searchParams.set('cam', cam);
    return { eye: camera.position.toArray().map(r4), dir: d.toArray().map(r4), up: camera.up.toArray().map(r4),
             yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3), fov: camera.fov, aspect: +camera.aspect.toFixed(5),
             near: r4(camera.near), far: +camera.far.toFixed(2), cam,
             link: link.toString().replace(/%2C/gi, ','), detached: !!detached };
  }
  function playerState() {
    const p = ctrl.pos;
    const g = col.groundHit ? col.groundHit(p.x, p.z, p.y) : null;
    return {
      feet: [p.x, p.y, p.z].map(r4), heading_deg: +(ctrl.heading * 180 / Math.PI).toFixed(2),
      onGround: ctrl.onGround, vy: r4(ctrl.vy || 0), hitWall: ctrl.hitWall,
      speed_per_tick: r4(ctrl.speed), clip: anim.override ? 'action' : anim.current,
      clipName: anim.clipName(), rate: r4(anim.rate),
      clipTime: r4(anim.time()),
      action: ctrl.active ? ctrl.active.name : null, packs: packsLoaded,
      ground: g && { y: r4(g.y), feetError: r4(g.y - p.y), tri: g.tri, subtree: g.subtree,
                     mask: g.mask === undefined ? null : '0x' + g.mask.toString(16).padStart(4, '0'),
                     normal: g.normal.map(r4), surface: g.surface },
      collision: colName, spawn: [ctrl.spawn.x, ctrl.spawn.y, ctrl.spawn.z].map(r4),
    };
  }
  const report = initReport({
    renderer, camera, root, scene, attrs: floats, toast, view: camView, output,
    setFrozen(f) { frozen = f; keys.clear(); pressed.clear(); drag = null; if (!f) { clock.getDelta(); acc = 0; } },
    extraMeta: () => ({ page: 'play', player: playerState() }),
  });
  document.getElementById('btn-report').addEventListener('click', e => { e.stopPropagation(); report.open(); });

  // ---- loop: one ctrl.step per PAL game frame (TICK = 1/50 s), interpolated render.
  // GUESS: the catch-up cap (8 frames, then drop the time) is a port convenience; the game
  // caps its step at 5 ticks (FUN_00322f88).
  const clock = new THREE.Clock();
  let acc = 0, frames = 0, fpsAcc = 0, fps = 0;
  const stats = { ticks: 0, groundErrMax: 0, colName };
  function frame() {
    requestAnimationFrame(frame);
    const dt = (frozen || paused || stagePaused) ? 0 : Math.min(clock.getDelta(), 8 * TICK);   // GUESS: same cap as below (port convenience)
    acc += dt;
    if (!packsDone) { acc = 0; pressed.clear(); mouse.dx = mouse.dy = 0; }   // clip packs still loading: draw only, no game frame (no mouse banked)
    // Restart: rebuild the bodies first; no game frame runs until they are attached (the new world never ticks without them)
    if (restartPending && !restartHold) {
      restartPending = false;
      restartHold = swapBodies().catch(e => console.warn('restart: bodies:', e && e.message)).then(() => { restartHold = null; restartReady = true; });
    }
    if (restartHold) { acc = 0; pressed.clear(); mouse.dx = mouse.dy = 0; }
    let n = 0;
    const due = Math.min(Math.floor(acc / TICK), 8);   // game frames this rendered frame runs (MouseFeed)
    while (acc >= TICK && n < 8) {
      if (restartReady) { restartReady = false; restart(); }   // Restart: the checkpoint, before this game frame (bodies attached)
      // worker 0232: after Zone.exit (FUN_00241ed8) FUN_004012c0 returns 1 and the stage program ends, while the Status box
      // (displayStageInfo(2), 0.5 s earlier) runs on in the menu manager. GUESS: the world stops and only the stage-info
      // box runs until it closes; then the page stops (report mode: the next stage is not on the page). The game's states
      // between the program's end and the next stage (FUN_00401b90 / FUN_00247508) are not decoded (notes/fidelity-audit.md)
      if (stageRes && stageRes.exit) {
        if (stageSi && stageSi.kind >= 0) { stageSi.fxBegin(STEP); stageSi.frame(pressed.has(CROSS_KEY)); stageSi.sounds(); stageSi.events.length = 0; stageSi.fxEnd(fxCamera()); }
        else { frozen = true; keys.clear(); console.info('results: the Status box closed after Zone.exit: the page stops here'); }
        pressed.clear(); mouse.dx = mouse.dy = 0;
        acc -= TICK; n++; stats.ticks++; continue;
      }
      if (intro) {                                 // the opening event: its frame instead of play's (intro.js)
        pressed.clear(); mouse.dx = mouse.dy = 0;
        // GUESS: the placed sounds (ambient.js) and the sound emitters' sends do not run during the opening event (this branch
        // continues before them); the game's frame loop is not traced for them during events (notes/fidelity-audit.md
        // 'Placed sounds during the opening event')
        if (!intro.done && !intro.paused) {         // the event pause holds it (FUN_00376ee0; worker 0222)
          // FUN_00248110 runs on during events: the chunk stream at Vincent's MP+0x10 (FUN_0026a0c0; the page's player
          // holds still while the event runs) and the effect managers (FUN_002efc78 / FUN_002efe00 / FUN_002efe98), the
          // level fire included (worker 0208's fxStage), drawn with the event camera
          roomProbe(renderEye(), renderFxCamera(), renderFov()); if (light) light.stream.frame(ctrl.prev); roomShow();
          // FUN_00265350 (late in FUN_00248110; reads only the slot table): the chunks' scrolling UVs (room.js RoomUVAnim)
          if (uvAnim) uvAnim.frame(light && light.stream.areas.length ? light.stream.loaded() : null, STEP);
          // worker 0265: the stage title card (stage_info.js, first_event's displayStageInfo(0)): FUN_003fdf00 first in the frame, the
          // menu managers' effects (FUN_002efc78 / FUN_002efe98) with the others, as in play's frame. No ✕ reaches it here (the card has
          // no mode-1 step). events.length = 0: PAGE ONLY, the page's per-frame queue (frame() already applied its fx ops, sounds() its
          // SEs), drained as the gameplay frames' calls do; no game state
          if (stageSi) { stageSi.frame(false); stageSi.sounds(); stageSi.events.length = 0; }
          if (fx) fx.begin(STEP);
          if (fxStage) fxStage.begin(STEP);
          if (stageSi) stageSi.fxBegin(STEP);
          if (introFx) introFx.begin(STEP);         // worker 0275: the event effects' manager (FUN_002efc78: FUN_002e9f98, then FUN_002edcc0's queue)
          // FUN_003e9ed0's 0x10000 pass over the event SE slots: once a page frame, before the event runtimes' sends (event_sound.js eventSeFrame)
          if (pauseSound.audio && pauseSound.audio.eventSe && pauseSound.audio.eventSe.frame) pauseSound.audio.eventSe.frame();
          if (stage) stage.tick(20);               // main (stage_controller.js): its prelude, then first_event's wait
          intro.tick();
          if (chunkAnims) chunkAnims.frame(light && light.stream.areas.length ? light.stream.loaded() : null, STEP);   // FUN_00265350: the nodes (chunk_anim.js)
          if (fx) { const c = renderFxCamera(), fov = renderFov(); fx.end(null, fov); if (fxStage) fxStage.end(cameraView(c), fov); fxLayer.update(c); if (fxStage) fxStageLayer.update(c); }
          if (stageSi) stageSi.fxEnd(renderFxCamera());   // worker 0265: the title card's effects (menu_fx.js)
          if (introFx) { introFx.end(); introFxLayer.update(); }   // worker 0275: FUN_002efe98 on the event effects, their draw
          if (intro.done) endIntro();
        }
        acc -= TICK; n++; continue;                // ended: held (still hidden, the event's last view) until the hand-off
      }
      mouse.feed(follow, due - n);                 // this game frame's share of the mouse counts
      // FUN_003e9ed0: last frame's sound requests go out with the listener of two frames back (sndHist)
      if (sfx && follow.eye && follow.M) {
        sfx.setListener(sfx.listenerOf(sndHist, follow.eye, follow.M[2], ctrl.pos));
        sfx.update();
        amb.sndL = sfx.listener;                   // FUN_003e9ed0 also sends the placed sounds' slots (ambient.js SlotStreams)
        if (amb.slots) amb.slots.update(amb.sndL);
      }
      // PAGE AID ?warp= (warp.js, worker 0249; not the game): once, when main is in battle() (settled) and the world is up
      if (warpPending && stage && stage.battle && enemyAI && packsDone) {
        const name = warpPending; warpPending = null;
        applyWarp(name, { ctrl, follow, stream: light ? light.stream : null, flags: enemyAI.eventFlags, gflags: stage.globalFlags, cape });
        detached = null; pressed.clear(); mouse.dx = mouse.dy = 0;
        window.__play.warp = { name, tick: stats.ticks };
        warpLate = name;
      }
      // worker 0265: the warp's trigger and late flags once its chunk pair is in (warp.js applyWarpLate). GUESS (page aid, no game
      // counterpart): the wait, 2 ticks after the warp and then the stream idle with both of the pair's chunks in a slot (walking in, the
      // game has them loaded before he reaches the trigger). notes/fidelity-audit.md 'GUESS: when a cutscene warp fires its trigger'
      if (warpLate && enemyAI && stats.ticks > window.__play.warp.tick + 1) {
        const s = light ? light.stream : null, pr = warpPair(warpLate);
        if (!s || !pr || (!s.busy && pr.every(c => [0, 1, 2].some(i => s.slotChunk(i) === c)))) {
          applyWarpLate(warpLate, { flags: enemyAI.eventFlags,
            trigger: t => { const o = enemyAI.triggers.find(x => x.t.idx === t); if (o) enemyAI.runEvent(o, 0xd, [0, 0]); else console.warn('warp: no trigger ' + t); } });
          warpLate = null;
        }
      }
      // the camera runs first in the game frame: it follows the player as the last frame
      // left him, and this frame's stick-to-world uses its new matrix (player.js camera notes)
      // FUN_00248110: FUN_00267970 + FUN_0026a0c0 before the game logic, at MP+0x10's translation: the matrix
      // last frame's draw used, which the page models as ctrl.prev (logicPose; not ctrl.pos, the moved position)
      // FUN_00264ee0 / FUN_0026c878 read 0x4fcb10 = the camera last rendered: an event camera while one is out (FUN_00379148)
      roomProbe(renderEye(), renderFxCamera(), renderFov()); if (light) light.stream.frame(ctrl.prev); roomShow();
      // FUN_00265350 (late in FUN_00248110; reads only the slot table): the chunks' scrolling UVs (room.js RoomUVAnim)
      if (uvAnim) uvAnim.frame(light && light.stream.areas.length ? light.stream.loaded() : null, STEP);
      // the stage controller (stage_controller.js, worker 0219): ev0100 main's frame (FUN_00377c68). GUESS: its place in
      // FUN_00248110's frame (after the chunk stream, before the logic; notes/fidelity-audit.md 'Stage controller')
      // stage_info.js (worker 0220): FUN_003fdf00 runs first in the game's frame (FUN_00247508), the box's update with it
      // (GUESS: order, notes/fidelity-audit.md 'Stage-info boxes'); its ✕ is the frame's edge (FUN_003de918(0, 1))
      if (stageSi) { stageSi.frame(pressed.has(CROSS_KEY)); stageSi.sounds(); stageSi.events.length = 0; }
      if (pauseSound.audio && pauseSound.audio.eventSe && pauseSound.audio.eventSe.frame) pauseSound.audio.eventSe.frame();   // FUN_003e9ed0's 0x10000 pass, once a frame
      if (stage) stage.tick(20);
      if (stageView) stageView.step();             // the events' actors: FUN_005a8e28's draw, then FUN_003772c8 (worker 0248)
      if (stageRes) stageRes.frame(stageSi ? stageSi.now : 0);   // FUN_00242a50 (FUN_00247428): the play clock (results.js)
      // FUN_00331f08: the player's control update (vt+0x5c) is skipped while game-state bit 11 is set (set_usercontrol(0)
      // / free_usercontrol(1), game_state.js): no stick or button reaches him (the box's ✕ above does not jump)
      const noControl = !!(stageGs && stageGs.test(11));
      const inp = noControl ? aim({ fwd: 0, side: 0, run: false, keys: new Set(), pressed: new Set(), noControl: true }, follow.basis()) : readInput();
      // FUN_0032ace0's no-look test (worker 0246): bit 11 or FUN_00324258(10) = game-state bit 7 / 5 (L: its FUN_00324a78(G, 2)
      // and DAT_0046e290 +0x10 / +0x18 masks are not on the page: 0)
      const noUser = noControl || !!(stageGs && (stageGs.test(7) || stageGs.test(5)));
      const moving = Math.hypot(inp.x, inp.z) > 1e-6;
      // gameover.js: FUN_003fdf00 / FUN_00334590 / FUN_004012c0 on last frame's HP (worker 0192). Before the camera:
      // FUN_00334590 case 2 starts the death camera and FUN_0032ace0 looks down in the same frame (T: w199_deathcam
      // f789 -> record f790, worker 0199)
      // FUN_002efc78 / FUN_002efe00 (before the game logic): the reseed, then every manager in DAT_004ee8c0's order: the
      // impacts' DAT_004ee2e0, the stage's DAT_004ee3c0, then the title's DAT_004ee4a0 (gameOver.frame's title.begin)
      if (fx) fx.begin(STEP);
      if (fxStage) fxStage.begin(STEP);
      if (stageSi) stageSi.fxBegin(STEP);          // worker 0241: the menu managers DAT_004ee4a0 / 4ee580 (the boxes' effects)
      if (gameOver) {
        gameOver.frame(php.hp === 0, STEP);
        if (gameOver.go.events.includes('deathCamera')) follow.startDeath();   // FUN_0032a420(CAM, 1, 0, 0) + FUN_00328720(CAM)
        // worker 0255: FUN_00334590 cases 5 / 6 with the Phoenix Down's status (gameover.js). L: camera message 0x7d3 (FUN_003287b0, the
        // recentre CAM+0x180: fidelity-audit row 'Camera paths not translated') is left out
        if (gameOver.go.events.includes('revive')) { if (items) items.reviveStart(); ctrl.revive(); }
        if (gameOver.go.events.includes('reviveEnd')) { if (items) items.reviveEnd(); follow.endDeath(); }
        if (gameHud && gameOver.go.events.includes('begin')) gameHud.hideAll();  // FUN_003fdb48(3) -> FUN_003ad5b0: the HUD slides out
        if (stageSi && gameOver.go.events.includes('begin')) stageSi.stop();     // FUN_004012c0: FUN_003fdd58 before FUN_003fdb48(3)
        if (stageRes && gameOver.go.events.includes('begin')) stageRes.gameOver();   // FUN_003fdb48(3) -> FUN_00242938 (the KO count)
      }
      // on the ladder the camera reads the ladder's P+0x104 (ladder.js camState) and the facing C+0x20
      follow.tick({ pos: ctrl.pos, want: ctrl.C.dir, state: ctrl.active?.camState ?? ctrl.P.state, facing: ctrl.C.face,
                    stick: moving ? (inp.run ? KEY_RUN : KEY_WALK) : 0, pad: null, noUser });
      follow.messages();                           // the camera messages posted this frame (0x7d5: battle()'s hand-back)
      const b = follow.basis();                    // re-aim the keys with this frame's matrix
      const pOld = [ctrl.pos.x, ctrl.pos.y, ctrl.pos.z];
      vinStart.pos = pOld; vinStart.h = ctrl.heading;
      // FUN_0053b500 -> FUN_00542ab8 (actor push-out) runs before the actors move (T: k_push16, the push of
      // frame f comes from the positions it starts with and moves Vincent in the same frame)
      ctrl.push = enemyAI ? enemyAI.pushOut(pOld) : null;
      ctrl.contacts = props && enemyAI ? props.blockers : null;           // worker 0269: FUN_0035a440's object pass (the EM barriers)
      ctrl.step(aim(inp, b));
      // worker 0243: FUN_003320c0's item buttons (id 0x1d = D-pad right -> the use request, 0x1e = D-pad left -> the next item;
      // page keys E / Q). The control update is skipped while game-state bit 11 is set (noControl), as for the other buttons.
      if (items && !noControl) items.input({ use: pressed.has('KeyE'), next: pressed.has('KeyQ') });
      pressed.clear();                             // an edge is seen by one tick only
      // feet vs ground check (for the HUD / tests)
      const g = col.groundY(ctrl.pos.x, ctrl.pos.z, ctrl.pos.y);
      if (g != null) stats.groundErrMax = Math.max(stats.groundErrMax, Math.abs(g - ctrl.pos.y));
      stats.lastGroundErr = g == null ? null : g - ctrl.pos.y;
      // FUN_00573c60 (the player's update, after his move) -> FUN_00542920: the stage areas by his position (areas.js;
      // L: the matrix row FUN_0054a5e8 reads = the page's post-step position)
      if (areas && !areaHold) areas.frame([ctrl.pos.x, ctrl.pos.y, ctrl.pos.z]);
      php.motionClass = ctrl.jump.motionId(ctrl);     // FUN_003419c0 for the AI (enemy_ai playerFilter, the blast filter, boss_io; worker 0255)
      if (enemyAI) { php.pos = [ctrl.pos.x, ctrl.pos.y, ctrl.pos.z]; php.face = [ctrl.C.face.x, ctrl.C.face.y, ctrl.C.face.z]; enemyAI.tick(STEP, pOld, php.pos); if (propsView) propsView.sync(); if (itemsView) itemsView.sync(); }
      // the section-22 sound objects (FUN_0057d4f8 -> FUN_0057d550): Vincent's frame-start position + (0, -7, 0), T: w215_routeA
      // start / stop frames; their volume from the listener +0x3850 of this frame (FUN_003e6ec8). A linked object's state:
      // its area's +0x28 bit 0 (worker 0223: record +0xa8 indexes manager +0x2b4, the area table, FUN_0053b920 -> FUN_0054c550;
      // FUN_0054ef68 passes the area's state on to its children, vt+0x14c), from areas.js
      if (amb.placed && amb.sndL) amb.placed.frame([pOld[0], pOld[1] - 7.0, pOld[2]], amb.sndL.alt);
      // FUN_002efe98, then the effect draw pass (once a game frame) with this frame's camera: follow.tick ran at
      // the start of this game frame, as the game's camera does before the draw (the render camera lags a frame)
      // FUN_002efe98 runs every manager (worker 0208: the level manager's cull FUN_002ea6a0 with this frame's camera), then the draw passes
      if (chunkAnims) chunkAnims.frame(light && light.stream.areas.length ? light.stream.loaded() : null, STEP);   // FUN_00265350: the nodes (chunk_anim.js)
          if (fx) { const c = renderFxCamera(), fov = renderFov(); fx.end(null, fov); if (fxStage) fxStage.end(cameraView(c), fov); fxLayer.update(c); if (fxStage) fxStageLayer.update(c); }
      if (gameOver) gameOver.endFrame(renderFxCamera());   // the GAME OVER title's manager DAT_004ee4a0 (gameover_title.js)
      if (stageSi) stageSi.fxEnd(renderFxCamera());      // worker 0241: the boxes' effects (menu_fx.js), then their slot operations
      if (gameHud) gameHud.tick();
      if (enemies) enemies.tick(enemyAI);
      acc -= TICK; n++; stats.ticks++;
    }
    if (n === 8) acc = 0;                          // fell far behind (tab hidden): drop time
    const pose = ctrl.lerp(acc / TICK);
    vin.body.position.set(pose.x, pose.y, pose.z);
    vin.body.rotation.y = bodyYaw(pose.heading);
    anim.update(ctrl.speed, dt);
    if (cape) cape.render();

    if (intro) {                                   // the event camera (a ?cam= view applies after the hand-off)
      hideForIntro(); intro.render();
    } else if (stageView && stageView.active) {    // main's event camera (FUN_00379148 out of battle mode; worker 0248)
      stageView.render();
    } else if (detached) {
      camera.position.copy(detached.pos); camera.up.set(0, -1, 0);
      camera.lookAt(detached.pos.clone().add(detached.dir));
    } else {
      follow.update(acc / TICK);                   // between the last two game frames, as the body
    }
    if (stageView && !intro && !stageView.active) stageView.render();   // the fade's veil, the projection back
    if (weapon && !intro) weapon.render();         // Vincent's first-person fade (not while the opening event hides him); the reticle draws in output.render
    if (fxLayer) fxLayer.flush(); if (fxStageLayer) fxStageLayer.flush();   // the effect meshes once per drawn frame (worker 0208)
    output.render(root, camera);

    frames++; fpsAcc += dt;
    if (fpsAcc >= 0.5) { fps = frames / fpsAcc; frames = 0; fpsAcc = 0; }
    const p = ctrl.pos;
    hud.textContent = `${fps.toFixed(0)} fps   collision: ${colName}${packsDone ? '' : '   loading clips…'}\n` +
      `pos  ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}\n` +
      `clip ${anim.override ? 'action' : anim.current} (${anim.clipName()}) x${anim.rate.toFixed(2)}` +
      `${ctrl.active ? '   action ' + ctrl.active.name : ''}` +
      `   speed ${(ctrl.speed * 60).toFixed(1)} u/s\n` +
      `onGround ${ctrl.onGround}${ctrl.hitWall ? '  WALL' : ''}` + (enemyAI ? `   HP ${php.hp}${ENEMY_DMG ? '' : ' (bullet damage off: ?enemydmg=0)'}` : '') +
      (weapon ? `   weapon ${weapon.core.P.drawn ? 'out' : 'away'} st ${weapon.core.P.st} T ${weapon.core.P.T}  cam 0x${weapon.core.cam.type.toString(16)}` : '') + '\n' +
      `click: mouse look (drag works too)   WASD move (walk)   Shift run   ${actionHelp.join('   ')}   H respawn   R report   ${warpHelp()}`;
  }
  // ---- Restart -> the checkpoint (checkpoint.js, worker 0201): both Restarts (game over, pause OK) make the stage loop
  // return 6 and the game reloads the stage from its start (FUN_00247508 0x15 -> 0x13 FUN_003ff0c0 -> 0x14 -> 0x15). The
  // page resets its systems in place at the next game frame's start (the request comes inside a frame).
  // restartPending: a Restart was answered (inside a game frame); restartHold: the bodies are being rebuilt (no game frame
  // runs, as while the clip packs load: the game is loading the stage); restartReady: run the restore at the next frame start
  let restartPending = false, restartHold = null, restartReady = false, restarts = 0, restartViaPause = false;   // restartViaPause: mode bit 0xe (FUN_004012c0 case 0xf)
  // the stage reload frees every actor and builds the stage's again. GUESS (the actor teardown / rebuild order is not
  // decoded): every body the new world doesn't own goes (the save's soldiers, every record activated since, with or
  // without an AI, loading or drawn), then every start body that is gone is built again (the save's soldiers 44-49 / 66:
  // T w201_reload, equal to the save; with ?enemies=all also a start body a script had activated); the start's other
  // placements stay. Resolves when the new bodies are attached (L: they draw in the newer-actor order, enemies.js add).
  const swapBodies = () => {
    if (!enemies || !aiData) return Promise.resolve();
    const recs = new Set([...AWAKE, ...bodyRecs, ...(enemyAI ? enemyAI.actors.map(a => a.rec) : [])]);
    for (const a of [...enemies.actors]) if (recs.has(a.rec) || !startBodies.has(a.rec)) enemies.remove({ rec: a.rec });
    for (const k of bodyRecs) enemies.remove({ rec: k });   // still loading: never drawn (enemies.js remove clears pending)
    bodyRecs.clear();
    const adds = [];
    // worker 0254: with a scene_save's record nothing is drawn but what the new world activates (onActivate; FUN_00400778 skips
    // the stage start), so the start's bodies and 41-43's go too
    if (checkpointRec) { for (const a of [...enemies.actors]) enemies.remove({ rec: a.rec }); return Promise.resolve(); }
    for (const k of startBodies) if (!enemies.actors.some(a => a.rec === k) && aiData.records[k]) adds.push(enemies.add(aiData.records[k]));
    // the stage load's statuses (41-43, enemies.js loadRecs): the reload loads their models (FUN_00319190) before the
    // pass activates them (enemy_ai stageLoad in rebuildEnemies; its onActivate add is then a no-op), so their bodies are
    // attached before the new world's first frame too (worker 0204)
    if (aiOpts) for (const k of enemies.loadRecs || []) if (aiData.records[k]) adds.push(enemies.add(aiData.records[k]));
    return Promise.all(adds);
  };
  // the new enemy_ai world, built as at the start with the checkpoint's flags and frame counter (bodies: swapBodies)
  const rebuildEnemies = (flags, frame, clock, rec = null) => {
    if (areas) areas.reset();                       // the stage reload: the areas again, all off (worker 0223)
    if (!aiOpts) return null;
    // the reload rebuilds every status (FUN_0030f3d8 / the stage load): nothing is dead (T w204_reload: 41-43 HP 10 / 28 / 24);
    // from a record the dead words come back (FUN_0031d4d8) and FUN_00547ce0 zeroes those HPs (T w254)
    if (items) items.restart(rec, restartViaPause);  // the checkpoint's inventory, taken bits cleared (worker 0224; before attach); a record's own (worker 0242)
    // worker 0240 (checkpoint.js initWorld): the stage init's pass FUN_0053ca50(mgr, 1) (event 0x22: script 0 activates
    // 44 / 66; event 0x23) at clock 0, the placement's clocks and frame, then 41-43 (stand-in) and 45-49 (GUESS (0201):
    // the save's states, wakeSave) as at record 10 (T w204_reload / w240_act)
    // worker 0242: after a scene_save the stage-start stand-ins (41-43's loadPass, wakeSave) are not run (RECORD_WAKE below)
    shotFx.clear();                                            // worker 0270: the old world's shots go with it
    enemyAI = initWorld(o => createEnemyAI({ ...aiOpts, ...o }), { flags, frame, clock, reload: !!rec, deadRecs: rec ? rec.dead : [], loadRecs: rec ? [] : enemies ? enemies.loadRecs || [] : [],
      wake: rec ? null : w => wakeSave(w, AWAKE.filter(k => k !== 44 && k !== 66)) });
    if (window.__play) window.__play.enemyAI = enemyAI;
    return enemyAI;
  };
  // the opening event's hand-off (export_web_checkpoint.py; checkpoint.js handOff, worker 0205): fetched now, used at a Restart
  let handoff = null;
  fetch('data/checkpoint.json').then(r => r.ok ? r.json() : null).then(j => { handoff = j; }).catch(() => {});
  const restart = () => {
    const handing = introHandoff;
    const rec = checkpointRec;                           // worker 0242: the last scene_save's record (checkpoint.js sceneSave)
    if (handing) finishIntro();                    // the event's hiding / view end in the hand-off's own frame
    else if (introData && !rec) introGate.on = true;   // a replay follows: restoreCheckpoint's music restart stays silent
    // main's setVisibleAll hid them; the reload builds the objects again, visible (play.js allVisible)
    vin.eventHidden = false; if (itemsView) itemsView.hideAll = false;
    if (stageRes) { if (handing) stageRes.exit = null; else stageRes.reload(rec ? rec.stats : null); }   // worker 0254: checkpoint.js 'The Restart invariant'
    if (!handing && introVoices) introVoices.stopAll();  // worker 0254: FUN_003ffbb8 -> FUN_003ea5f0, the program's end: the voice channels freed
    // the stage reload: FUN_003ff7a8(0x80, 1, 2) again; after a scene_save FUN_00400778 loads the record's chunks (+1 / +2)
    if (light) light.stream.reset(rec && rec.pair ? rec.pair : light.startPair);
    // the script half DAT_004e8700 starts empty again (GUESS, notes/fidelity-audit.md 'the hidden-cell mask's script half
    // at start'; worker 0225), with or without the stage fire; the camera half is the next frame's probe
    visMask.clearScript(); for (const b of (fxIds && fxIds.hidden_script) || []) visMask.setScript(b, true);
    if (introHandoff) introHandoff = false; else restarts++;
    // worker 0208: the stage reload reloads the area FEDs (FUN_002f15d0 spawns their records again; GUESS as fx.reset's)
    const fxAll = fx ? { reset: () => { fx.reset(); if (fxStage) { fxStage.reset(); fxStage.stageLoad(); } } } : null;
    restoreCheckpoint({ record: rec, ctrl, groundY: (x, z, y) => col.groundY(x, z, y), follow, php, gameOver, weapon, cape, fx: fxAll,
                        hud: gameHud, sfx, rebuildEnemies, handoff, music: record => { introGate.handing = handing; if (musicRestart) musicRestart(record); introGate.handing = false; } });
    detached = null; pressed.clear(); mouse.dx = mouse.dy = 0;
    // the stage reload runs the stage program from its start, so the opening event plays again (T: w210 restart drive,
    // the reload after the game over's Restart plays ev0100 scr001); its end hands off again (uncounted, above)
    if (!handing && introData && !rec) startIntro();     // a record's reload resumes at main (no opening; checkpoint.js restoreRecord)
    // the stage reload runs ev0100 main from its start (stage_controller.js), with the replayed opening as first_event; the
    // hand-off releases the main already waiting there. The global flags DAT_0050db20 start empty (T: w210 start1704)
    // worker 0220: a stage reload starts with no stage-info box and the game-state bits clear (game_state.js reset)
    if (stageSi) stageSi.reset();
    if (stageGs) stageGs.reset();
    // worker 0251: GUESS (part of checkpoint.js restoreRecord's 'Vincent at the page spawn until main hands him back'): the
    // game's Vincent is at the reloaded status's own matrix, not at the deck, so the area pass (FUN_00542920, which now
    // also switches actors) waits for the hand-back (vinBattle.place); else the placeholder spawn would switch areas 105 / 2
    // on and wake 41-49 (T w242: not active after the record reload)
    if (rec) areaHold = true;
    if (rec) startStage(false, 0, rec.gflags);           // main from its top with the record's global flags (FUN_00400778 case 0xb)
    else if (!handing) startStage(!!introData); else if (!stage) startStage(false, introRt ? introRt.skip : 0);
    restartViaPause = false;
  };

  // ---- pause menu (pause_layer.js / pause.js; Start = Esc or Enter). While it is open the world is frozen
  // (FUN_00241f40: game state 0x17) and the game sees no input; Restart goes to the checkpoint (checkpoint.js).
  let paused = false;
  const pause = await (await import('./pause_layer.js')).setupPause({
    // worker 0257: FUN_003de130: with an event program in event mode (FUN_003dfd18) Start takes the event branch, not this menu
    // the kill's own frame: FUN_00576b48 -> FUN_00241760(1, 3, 0); then gameover.js's FUN_00241760 count / the pad given to the menus (FUN_00253fd8(2))
    // worker 0242: after Zone.exit the stage program has ended (FUN_004012c0 returned 1), so its pause (case 0xf) is gone
    // worker 0277: FUN_003e0d50 (DAT_004f3044 bit 0x10000, set by the stage script's peace, cleared by chaos: stage_controller.js
    // noPause): e.g. deb_jump's item help box after a pickup
    output, blocked: () => frozen || !!intro || stageEventMode() || php.hp === 0 || !!(gameOver && gameOver.go.pauseBlocked) || !!(stageRes && stageRes.exit) || !!(stage && stage.rt.noPause), sound: pauseSound,
    onPause(on) { paused = on; if (gameHud) gameHud.pause(on); pressed.clear(); mouse.dx = mouse.dy = 0; drag = null; if (!on) { clock.getDelta(); acc = 0; } },
    // Sent when the confirm box (pause.js openBox, layout 0x472ad8) is answered OK. Restart: FUN_003c0a20 +
    // FUN_003dee40(0xf) -> FUN_004012c0 case 0xf returns 6 -> the checkpoint (restart above). Tempsave / Quit:
    // warn only (pause_layer.js; no memory card / title on the page)
    // worker 0271: FUN_003c0a20 -> FUN_00380b00 sends IOP command 0x23 at the OK, while the pause holds the SEs (seRestart: the
    // held ones end silent); the menu's unpause (sync) comes after. restart()'s musicRestart sends it again (a no-op by then;
    // the game over's Restart goes only through that one)
    onRequest(r) { const mark = () => { restartPending = true; restartViaPause = true; }; if (seRestart) seRestart.pauseRequest(r, mark); else if (r === 'restart') mark(); },
  });
  actionHelp.push('Enter pause (Esc too, but with the pointer locked the browser takes Esc to unlock it)');
  // game over (gameover_layer.js): Restart (result 6) -> the checkpoint (restart above); Quit warns (no title)
  gameOver = await (await import('./gameover_layer.js')).setupGameOver({ output, blocked: () => frozen, THREE, root, fxRng: fx ? fx.rng : null,
    onRequest(r) { if (r === 'restart') restartPending = true; } });
  // worker 0255: what FUN_00334590 reads for the revive
  if (gameOver) gameOver.go.status = { s64: () => php.s64 ?? 0, settled: () => !!ctrl.P.settled, state: () => ctrl.P.state };
  window.__play = { shotFx, ctrl, anim, follow, aim: weapon, col, stats, amb, areas, camera, renderer, output, root, vin, light, spawnY: gy,
                    playerState, camView, report, keys, pressed, motions, packsReady, actionHelp, cape, enemies, enemyAI, php, pause, gameHud, pauseSound, gameOver,
                    sound: () => (soundProbe ? soundProbe() : null), soundStop: () => { if (soundStop) soundStop(); }, restart: { get count() { return restarts; }, get pending() { return restartPending || !!restartHold || restartReady; }, get record() { return checkpointRec; } },
                    intro: { get active() { return !!intro; }, get rt() { return introRt; }, get windows() { return introWin; }, get hudParked() { return !!intro && output.hud !== introHud; }, get ended() { return introEnded; }, get paused() { return !!intro && intro.paused; }, get fx() { return introFx; }, get fxLayer() { return introFxLayer; } },
                    get stage() { return stage; }, get stageLib() { return stageLib; }, get stageView() { return stageView; }, get stageWin() { return stageWin; }, get stagePaused() { return stagePaused; }, get stageInfo() { return stageSi; }, get gameState() { return stageGs; }, get viewRay() { return aiOpts && aiOpts.viewRay; }, get results() { return stageRes; }, get voices() { return introVoices; }, visMask, roomOccl };
  // ---- the opening event (intro.js): played before play on a fresh load; at its end the Restart path (checkpoint.js)
  // places Vincent and soldiers 41-43 as the event's end hands them to play. The page's gameplay bodies and HUD are
  // hidden while it runs (the event's own actors are left out, see intro.js)
  let intro = null, introRt = null, introEnded = 0, introHandoff = false, introHidden = [], introHud = null;
  // worker 0222: Start during the opening = the event pause: the pause object in its event state (+0x44 = 1, set by
  // FUN_003bf550) and FUN_00376ee0(ev, 1, 1) (intro.js pause). ✕ there = Skip (FUN_003c0520: button 3 with
  // FUN_003e0d00() == 0 -> +0x48 = 1, the pause closes -> FUN_003c0110 -> FUN_003dfdc8 -> FUN_00372f70 (intro.js skip),
  // then FUN_00376ee0(ev, 0, 1)); Start again resumes (FUN_003dfd90). The pause's screen in this state (layout 0x4779c0,
  // widgets 0x22 / 0x23 pulsing, FUN_003d0a90) is event_window.js EventPauseScreen (worker 0239).
  const { PAUSE_KEYS } = await import('./pause_layer.js');
  addEventListener('keydown', (e) => {
    if (e.repeat || restartPending || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (!intro && stageEventMode()) { stageEventKey(e); return; }
    if (!intro || intro.done) return;
    if (PAUSE_KEYS.start.includes(e.code)) {
      e.preventDefault();
      // worker 0265: while a stage-info card is up FUN_003fdb48's FUN_00241760(1, 0, 0) sets DAT_004f3044 0x100: FUN_003de130 takes no
      // pause input (and FUN_003e0cc8(1): no Skip)
      if (!intro.paused && stageSi && stageSi.kind >= 0) return;
      intro.pause(!intro.paused);
      if (introWin) introWin.pausePrompt(intro.paused, performance.now());   // the pause's screen (event_window.js, worker 0239)
    } else if (intro.paused && PAUSE_KEYS.cross.includes(e.code)) {
      e.preventDefault();
      intro.skip(); intro.pause(false);
      if (introWin) introWin.pausePrompt(false, performance.now());
    }
  });
  actionHelp.push('During the opening: Enter = the event pause, then Space (✕) = Skip');
  // worker 0257: main's events take the same pause (FUN_003de130's event branch, T w219_skip: ✕ 63 frames into rv_matiawase).
  // FUN_003dfd18 (+0x1558 & 0x102000000000 == 0x100000000000): the event program runs, out of battle mode
  function stageEventMode() { return !!(stage && stage.rt.running && !stage.rt.battle) || stagePaused; }
  // Start needs FUN_003e0d00() == 0 and no Skip yet (bit 36, +0x156c) (rt.skippable + skip): else it does nothing. The event pause
  // is message 0x10 param 1 (FUN_003dfd58 -> FUN_00376ee0(ev, 1, 1)): ✕ = FUN_003c0520 (FUN_003e0d00 == 0) -> FUN_003dfdc8 (Skip,
  // then (ev, 0, 1)), Start again = FUN_003dfd90. L: the page holds the whole frame (as its pause menu); the game holds the event
  // (bit 39) and the effects (FUN_002f24b0), and the world is under set_usercontrol / the AI pause in these events
  function stageEventKey(e) {
    // FUN_003de130 takes no pause input while FUN_003e0cb0 (DAT_004f3044 0x100, FUN_00241760 -> FUN_003e0c78: the game over's count, set in
    // the kill's own frame; the page sees that a frame later, so HP 0 as well, as the pause menu's `blocked`); restartHold / restartReady: the Restart is loading
    if (php.hp === 0 || (gameOver && gameOver.go.pauseBlocked) || restartHold || restartReady) return;
    const R = stage.rt, isStart = PAUSE_KEYS.start.includes(e.code);
    // an open choice box (wro_kaisetu; event_window.js, worker 0263): it holds the menu focus, Start still opens the event pause
    if (!stagePaused && !isStart && stageWin && !e.repeat) {
      const a = ['cross', 'circle', 'up', 'down', 'left', 'right'].find(k => PAUSE_KEYS[k].includes(e.code));
      if (a && stageWin.choiceKey(a)) { e.preventDefault(); return; }
    }
    if (stagePaused) {
      if (!isStart && !PAUSE_KEYS.cross.includes(e.code)) return;
      e.preventDefault();
      if (!isStart) R.requestSkip();
      stageEventPause(false);
    } else if (isStart && R.skippable() && R.skip === 0) {
      e.preventDefault();
      stageEventPause(true);
    }
  }
  function stageEventPause(on) {
    stagePaused = on;
    if (stageView) stageView.pause(on);
    if (stageWin) stageWin.pausePrompt(on, performance.now());     // the pause's screen (event_window.js EventPauseScreen)
    pressed.clear(); mouse.dx = mouse.dy = 0; drag = null;
    if (!on) { clock.getDelta(); acc = 0; }
  }
  // opening: main runs alongside it (first_event waits for the hand-off, then main reads the opening's +0x156c);
  // else from the save / a hand-off already past (skip: that +0x156c)
  let stagePassWarned = false;
  let checkpointRec = null;                       // worker 0242: DAT_004b2680 (checkpoint.js sceneSave); null = the stage start
  function startStage(opening = false, skip = 0, gflags = null) {
    if (!createStage) return;
    // worker 0248: main's events drawn (stage_view.js): the event actors (the actor library's clips and texture
    // animations, FUN_0040b5c0 = the shared twister), the opening's sound back ends and new event windows
    if (stageView) { stageView.dispose(); stageView = null; }
    stageWin = stageWinMod && stageWinData ? stageWinMod.createEventWindows({ D: stageWinData, se: (id) => { if (pause && pause.menuSound) pause.menuSound.set(id); } }) : null;
    const stageActors = stageViewMod ? stageViewMod.createStageActors({ lib: stageLib, rand: () => aiRng.rand(), warn: (m) => console.warn(m) }) : undefined;
    // the hand-off's +0x156c: the opening's (intro.js / event_rt.js skip, worker 0222); 0 from the save
    stage = createStage({ data: stageData, warn: (m) => console.warn(m), skip, actors: stageActors, sound: introSound, windows: stageWin,
      // worker 0242: a record's reload: its global flags, and main runs in game frames (no settling before the first)
      ...(gflags ? { globalFlags: Uint8Array.from(gflags), settle: false } : {}),
      // scene_save(n) (FUN_0039c728 -> FUN_0023d690(0, n, 0)): the checkpoint record
      onSceneSave: n => { checkpointRec = sceneSave(n, { gflags: stage ? stage.globalFlags : null, sflags: enemyAI ? enemyAI.eventFlags : null,
        pair: loadedPair(light && light.stream), hp: php.hp, inventory: items ? items.inventory : null, taken: items ? items.taken : null, stats: stageRes ? stageRes.stats : null, dead: enemyAI ? enemyAI.deadBits : null }); },
      openingDone: opening ? () => !intro : undefined, openingSkip: opening ? () => (introRt ? introRt.skip : 0) : undefined,
      flags: () => (enemyAI ? enemyAI.eventFlags : null),             // the current world's (a Restart replaces it)
      bossOverlay: on => { if (enemyAI && enemyAI.setBossPlugin) enemyAI.setBossPlugin(on); },   // worker 0231: Zone.boss (FUN_0037fe18)
      // worker 0240: battle()'s FUN_00324e70 -> FUN_005453b0 (enemy_ai stageLoad): the loop activates statuses with +0x28
      // bit 0x40 or status +0x60 bit 0 (and turns off +0x118 bit 0x400 ones); the page does not track those bits on its
      // statuses, so the loop gets none (warned); then FUN_005459d8 = event 0x23 to every object. Its tail (FUN_00325818,
      // FUN_0055f0e0 / FUN_0055f338, FUN_0053d510 / FUN_0053d590 / FUN_0053c4c8) is left out (warned)
      stagePass: () => {
        // FUN_00324e70: DAT_0046e290 +0x30 (the HUD) set -> DAT_0046e54c = 0xffffffff; FUN_00339590 re-reads the ammo and the selected item
        if (weapon && weapon.core) weapon.core.hudMask = 0xffffffff;
        if (!enemyAI) return;
        if (!stagePassWarned) { stagePassWarned = true; console.warn('stage: battle()\'s stage-load pass: the per-status loop (+0x28 bit 0x40 / status +0x60 bit 0 / +0x118 bit 0x400) and its tail (FUN_00325818, FUN_0055f338, FUN_0053d510, FUN_0053d590, FUN_0053c4c8) left out; event 0x23 sent'); }
        enemyAI.stageLoad([]);
      },
      reloadPass: () => { if (enemyAI) enemyAI.stageLoad([]); },       // a record's reload: the stage init's 0x23 (stage_controller.js enterBattle)
      stream: () => (light ? light.stream : null),                     // area_stream.js: FUN_002677a0
      music: () => pauseSound.music,                                   // music.js GameMusic (worker 0215)
      area: () => ({ play: (n, v) => { if (areaSoundHook) areaSoundHook(n, v); }, stop: () => console.warn('stage: stopBgAreaSound not wired') }),
      gameState: () => stageGs, stageInfo: () => stageSi,
      // worker 0232 (results.js): Intermission's stats / calc, endSection, Zone.exit (the next stage is not on the page:
      // the page stops there, report mode)
      stats: () => (stageRes ? stageRes.stats : null), calc: vm => { if (stageRes) stageRes.calc(vm); },
      onEndSection: () => { if (stageRes) stageRes.endSection(); },
      onExit: (z, a, b) => { if (stageRes) stageRes.onExit(z, a, b); },   // the frame loop below stops the world
      hudControl: (b) => { if (gameHud && gameHud.control) gameHud.control(b); },   // set_usercontrol -> FUN_003b01b0 (worker 0248)
      // worker 0265: event mode's FUN_0033c1a8 (reticle off) and battle()'s FUN_0033c060 (the kind from the mode); null without the weapon
      // (DAT_0046e290 +0x44 == 0)
      reticle: weapon ? { off: () => weapon.core.reticleOff(), sync: () => weapon.core.reticleSync() } : null,
      // worker 0261: setVisibleAll(0, b) -> FUN_00408900 on every model; setVisibleModelGroup -> DAT_004e8700 (as stage script cmds 0x54 / 0x55)
      allVisible: (v) => { vin.eventHidden = !v; if (enemies) for (const da of enemies.actors) if (da.body) da.body.visible = v; if (itemsView) itemsView.hideAll = !v; },
      cellMask: (bit, on) => visMask.setScript(bit, on),
      // FUN_003ee608's matrix (the camera last rendered): rows 1 (screen down), 2 (forward), 3 (eye), as sceVu0CameraMatrix; +0x40 its fov (worker 0261)
      viewMatrix: () => { const v = renderView(); if (v) { const n = Math.hypot(v.aim[0] - v.eye[0], v.aim[1] - v.eye[1], v.aim[2] - v.eye[2]) || 1; return { eye: v.eye, fwd: v.aim.map((x, k) => (x - v.eye[k]) / n), down: v.upDir, fov: v.fov }; }
        const e = camera.matrixWorld.elements; return { eye: [e[12], e[13], e[14]], fwd: [-e[8], -e[9], -e[10]], down: [-e[4], -e[5], -e[6]], fov: renderFov() }; },
      chunkAnim: (c, an, loop) => { if (chunkAnims) chunkAnims.play(c, an, loop); },   // Zone.start_anim_l (worker 0261)
      battleObject, cameraReset: (view, first) => { if (stage) stageCameraReset(view, first); } });   // main's battle actors (worker 0229)
    if (stageViewMod) stageView = stageViewMod.createStageView({ rt: stage.rt, camera, output, canvas: renderer.domElement, lib: stageLib,
      root, litPatch, light, weapon: stageGun ? () => stageGun.clone() : null, warn: (m) => console.warn(m) });
  }
  // ev0100 main's battle actors (stage_controller.js, worker 0229): the gameplay object whose status has that 8-char name
  // (FUN_003193c0 / FUN_00316d40: section-1 record +0x44, ai.json records[k].tag; record 0 = p_Vin = Vincent)
  function battleObject(name) {
    const k = aiData && aiData.records ? aiData.records.findIndex(r => r.tag === name) : -1;
    if (k < 0) { if (aiData && aiData.records && !aiData.records.some(r => r.tag)) console.warn('stage: ai.json records have no tag (re-export data/enemies: export_web_triggers.py)'); return null; }
    if (k === 0) return vinBattle;
    const wa = enemyAI && enemyAI.actors.find(a => a.rec === k);
    if (!wa) return null;
    return {
      tag: name,
      model: aiData.records[k].model,
      // the model's rows: row 2 = -facing (FUN_003157b0 reads -row 2), row 1 = (0, -1, 0) (the y-down frame of the traced
      // matrices; FUN_00383d10's row 2 does not depend on its sign)
      matrix: () => [-wa.face[2], 0, wa.face[0], 0, 0, -1, 0, 0, -wa.face[0], 0, -wa.face[2], 0, wa.pos[0], wa.pos[1], wa.pos[2], 1],
      // looked up per call: a body activated just before the lend may still be loading (worker 0262)
      // FUN_0056a5e0 -> FUN_00344ec0(C, 1): the body stops (enemy_ai bodyUpdate) until the stage pass's FUN_0056a790
      lend() { if (wa.C) wa.C.f564 |= 0x80000000; }, show(v) { const d = enemies && enemies.actors.find(a => a.rec === k); if (d && d.body) d.body.visible = v; }, release() { const d = enemies && enemies.actors.find(a => a.rec === k); if (d && d.body) d.body.visible = true; },
      // FUN_003157b0(status, 0): status +0x30 = the position, +0x40 = the facing (+0x50 = (0, -1, 0)); the actor's own copies follow (worker 0262)
      place(p, f) { wa.pos = [p[0], p[1], p[2]]; wa.face = [f[0], f[1], f[2]]; if (wa.C) wa.C.t2b0 = wa.pos.map((x, i) => Math.fround(x + wa.face[i])); },
    };
  }
  // Vincent as a battle actor: his model goes to a slot while lent (shown / hidden by it); FUN_003157b0(status, 0) puts his
  // status at the slot's place and writes only status +0x30 (root row 3: the position), +0x40 (-row 2: the facing) and +0x50
  // (0, -1, 0). Worker 0230: so no teleport path (no camera reset: that is battle()'s FUN_003285d0, stageCameraReset; no
  // cloth restart, no stream aid, velocity kept). The walk-mesh search stays (the body lands on the ground: T w229_rescue_pos
  // y 0 -> -0.0623). L: ctrl.prev / prevHeading (the page's record of the last frame, its trigger segment) follow the place.
  let areaHold = false;                              // worker 0251: see restart() (record reload GUESS)
  const vinBattle = {
    tag: 'p_Vin', model: 'p000',
    matrix: () => { const f = ctrl.C.face; return [-f.z, 0, f.x, 0, 0, -1, 0, 0, -f.x, 0, -f.z, 0, ctrl.pos.x, ctrl.pos.y, ctrl.pos.z, 1]; },
    lend() {}, show(v) { vin.eventHidden = !v; }, release() { vin.eventHidden = false; },   // applied by the aim view's render (worker 0261)
    cloth: cape ? cape.cloth : null,                 // the MP's cape window: the slot's clip requests arm it (event_actors.js capeRequest)
    place(p, f) {
      ctrl.pos = { x: p[0], y: p[1], z: p[2] };                                       // status +0x30
      ctrl.heading = Math.atan2(f[0], f[2]);                                          // +0x40 (facing)
      ctrl.C.face = { x: Math.sin(ctrl.heading), y: 0, z: Math.cos(ctrl.heading) };
      ctrl.locate();
      ctrl.prev = { ...ctrl.pos }; ctrl.prevHeading = ctrl.heading;
      areaHold = false;
    },
  };
  // battle()'s camera reset (FUN_00324e70 -> FUN_00329f68 -> FUN_003285d0): the angles of render view 1's forward
  // (FUN_00260f54) = the event camera's while one was active (view), else the follow camera's own
  // battle()'s camera (worker 0244; T w244_rescue_calls): FUN_00324e70's reset + in-place update (follow.battleReset),
  // then FUN_004012c0 case 9's FUN_00326da8 for battle()'s event +0x1528 (follow.battleHandBack); its message 0x7d5 runs
  // after this frame's follow.tick (follow.messages()). L: the page's keys are read after the stage tick, so these two
  // updates get no stick (the beats that end in battle() run under set_usercontrol(0))
  // first: the battle() before the stage init (T w240_init f2264): DAT_0046e290 == 0, so no FUN_00324e70 reset; only case 9's FUN_00326da8
  function stageCameraReset(view, first = false) {
    let s = { yaw: follow.yaw, pitch: follow.pitch };
    if (view) { const [pitch, yaw] = dirAngles(view.aim[0] - view.eye[0], view.aim[1] - view.eye[1], view.aim[2] - view.eye[2]); s = { yaw, pitch }; }
    // noUser: FUN_0032ace0 l.437-441 as in the frame's own update, these updates read the frame's mouse counts too (fed before
    // stage.tick). main's battle()s so far come after set_usercontrol(1), so it is false there; stick 0: the keys are read later
    const noUser = !!(stageGs && (stageGs.test(11) || stageGs.test(7) || stageGs.test(5)));
    const p = { pos: ctrl.pos, want: ctrl.C.dir, state: ctrl.active?.camState ?? ctrl.P.state, facing: ctrl.C.face, stick: 0, pad: null, noUser };
    if (!first) follow.battleReset(p, s);
    follow.battleHandBack(p);
  }
  function hideForIntro() {
    for (const o of [vin.body, ...(enemies ? enemies.actors.map(a => a.body) : [])]) if (o && o.visible) { o.visible = false; introHidden.push(o); }
  }
  // the event's end: the Restart path (uncounted) runs the hand-off; until restart() runs it, the page keeps the event's
  // last view, hidden bodies and no HUD (no frame shows the world as it was before the hand-off)
  function endIntro() {
    introEnded++;
    introHandoff = true; restartPending = true;
  }
  function finishIntro() {
    intro.finish();
    // GUESS: the event effects go with the event (worker 0275; notes/fidelity-audit.md 'Event effects: freed at the event's end')
    if (introFx) { introFx.reset(); introFxLayer.update(); }
    for (const o of introHidden) o.visible = true;
    introHidden = [];
    output.hud = introHud;
    intro = null; introGate.on = false;
    if (introGate.heard()) introGate.event = false;   // the opening's own start, kept only for a first gesture still to come (go)
  }
  // the camera the frame renders: the event view while an event camera is out (FUN_00379148's matrix: the opening's, or main's
  // out of battle mode), else the follow camera. The room's probe and occluders and the effect pass all read it (0x4fcb10)
  function renderView() { return (intro && intro.rt.view) || (stageView && stageView.active ? stageView.rt.view : null); }
  function renderEye() { const v = renderView(); return v ? v.eye : follow.eye; }
  // its live fov: view +0x40 (FUN_003ee1d8 -> display +0x300 -> FUN_0040ce28's +0x304): CAM+0x170 (aim_core) or the event camera's
  function renderFov() { const v = renderView(); return v ? v.fov : weapon ? weapon.core.cam.fov : undefined; }
  function renderFxCamera() {
    const v = renderView();
    if (!v) return fxCamera();
    fxCam.position.set(v.eye[0], v.eye[1], v.eye[2]); fxCam.up.set(-v.upDir[0], -v.upDir[1], -v.upDir[2]); fxCam.lookAt(v.aim[0], v.aim[1], v.aim[2]);
    return fxCam;
  }
  // worker 0248: main's events on the page (stage_view.js): the view, its actor library / gun, the event windows
  let stageView = null, stageViewMod = null, stageLib = null, stageGun = null, stageWin = null, stageWinMod = null, stageWinData = null;
  { const prev = output.hud; output.hud = (o) => { if (prev) prev(o); if (stageWin && pause && pause.layer) { const p = stageWin.drawAll(performance.now()); if (p.length) pause.layer.draw(o.renderer, o, p); } }; }
  let introData = null, createIntro = null, introActors = null, introVoices = null;
  let introWin = null, introWinMod = null, introWinData = null;      // event_window.js (worker 0239): the subtitles, the event pause's screen
  let introFx = null, introFxLayer = null;                           // event_fx.js (worker 0275): the opening's effects (the scanner)
  // the opening's sound back ends (event_sound.js): music.js GameMusic, the area sound hook, audio.js GameAudio, the voices
  const introSound = {
    music: () => pauseSound.music,
    area: () => ({ play: (n, v) => { if (areaSoundHook) areaSoundHook(n, v); } }),
    audio: () => pauseSound.audio,
    voices: () => introVoices,
    bg: () => amb.placed,                                            // playBgSound / FUN_003e6538: the placed-sound table (ambient.js; worker 0266)
    bgmRow: (n) => { const m = pauseSound.music, r = m && m.meta && m.meta[n]; return r ? parseInt(r.flags, 16) : null; },
  };
  function startIntro() {
    // the event's Zone.load(128, a, b) is the stage load FUN_002673d8 (slots 1 / 2 = a / b; area_stream.js reset)
    intro = createIntro({ data: introData, camera, output, canvas: renderer.domElement,
                          zoneLoad: (z, a, b) => { if (light) light.stream.reset([a, b]); },
                          actorLib: introActors, root, litPatch, light,       // the event's actors (event_actors.js, worker 0218)
                          rand: () => aiRng.rand(),                            // FUN_0040b5c0: the face animations' waits (worker 0248)
                          sound: introSound,                                   // its music / SEs / voices (event_sound.js, worker 0222)
                          windows: introWin = introWinMod ? introWinMod.createEventWindows({ D: introWinData }) : null,   // subtitles (worker 0239)
                          stageInfo: () => stageSi, stageInfoWait: () => stageSiLoading,   // the stage title card (stage_info.js, worker 0265)
                          effects: introFx });                                 // Effect.load / playseqstr_l ... (event_fx.js, worker 0275)
    if (introFx) { introFx.reset(); introFxLayer.update(); }
    introGate.event = true;
    introGate.on = true;
    introRt = intro.rt;
    // the menu draw while the opening plays (the gameplay HUD is parked): the event windows and the event pause's screen
    // (event_window.js), with the pause's PauseLayer
    introHud = output.hud;
    // FUN_003e9ed0 runs every frame in the opening too: the menu-sound queue's count back to 0 (pause_layer.js's hud does it after)
    output.hud = function introMenuDraw(o) { if (pauseSound.audio) pauseSound.audio.menuN = 0; if (!introWin) return; const p = introWin.drawAll(performance.now()); if (p.length && pause && pause.layer) pause.layer.draw(o.renderer, o, p); };
  }
  if (INTRO) {
    introData = await fetch('data/event/ev0100_scr001.json').then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (!introData) console.warn('intro: data/event/ev0100_scr001.json missing (tools/byo/build_web.sh step event); starting from the save');
    else {
      ({ createIntro } = await import('./intro.js'));
      introWinMod = await import('./event_window.js');
      introWinData = await introWinMod.loadEventWindowData().catch(e => { console.warn('intro: subtitles not drawn:', e && e.message); return null; });
      if (SOUND) { const { VoicePlayer } = await import('./event_sound.js'); introVoices = new VoicePlayer({ get ctx() { return pauseSound.audio && pauseSound.audio.ctx; } }); }
      // the event's actors, resident before it starts (data/event/actors: build step event_actors)
      // (scr001's models and motion files for first_event: export_web_event_actors.py's older FILES; worker 0261: the rest load on demand)
      const openFiles = [1, 2, 4, 5, 0x1d, 0x22, 0xc6, 0xfe], open = {};
      for (const m of ['e027', 'e048', 'e063', 'g000', 'g013', 'n013', 'p000', 'p005', 'p014', 'w003']) open[m] = openFiles;
      introActors = await (await import('./event_actors.js')).loadEventActors(undefined, { preload: { models: open } })
        .catch(e => { console.warn('intro: the event\'s actors not drawn (data/event/actors: build step event_actors):', e.message); return null; });
      if (introActors) introActors.cape = cape ? cape.eventSource : null;    // the p000 bodies' cape (event_actors.js capeOf)
      // worker 0275: the event effects (event_fx.js) on a menu-manager layer (gameover_title.js TitleLayer on the screen projection, as
      // menu_fx.js menuFxLayer without its veil; the FEDs from data/event/fx, build step eventfx). The page draws in scene-graph order
      // (sortObjects = false): added here, before stage_info's layer (loaded after this block), whose veil then draws over these sprites,
      // (the fade's draw FUN_002f4270 is not decoded; the dumps do not settle this order, and the card keeps the opposite one).
      // GUESS: notes/fidelity-audit.md 'Event effects: under the event fade'
      try {
        const [EF, MF, GT] = await Promise.all([import('./event_fx.js'), import('./menu_fx.js'), import('./gameover_title.js')]);
        introFx = EF.createEventFx({ createMenuFx: MF.createMenuFx, rng: fx ? fx.rng : null,
          fetchFed: n => fetch(`data/event/fx/a${String(n).padStart(4, '0')}.fed`).then(r => (r.ok ? r.arrayBuffer() : null)).catch(() => null) });
        introFxLayer = new GT.TitleLayer(THREE, introFx.title, { screen: output });
        introFxLayer.group.name = 'event-effects';
        root.add(introFxLayer.group);
      } catch (e) { console.warn('intro: event effects off:', e && e.message); introFx = null; }
      startIntro();
    }
  }
  // ---- the stage controller (stage_controller.js, worker 0219): ev0100 scr000 main, the level's story (beats, chunk
  // loads, music, checkpoints), every event in it skipped through the game's own Skip; ?stage=0 leaves it out
  if (params.get('stage') !== '0') {
    // with the opening: loaded alongside its first frames (an await here changed the start-up order of the HUD and the
    // opening); from the save (?intro=0): awaited, so main is settled before the first game frame
    const stageReady = Promise.all([fetch('data/event/ev0100_stage.json').then(r => (r.ok ? r.json() : null)).catch(() => null), import('./stage_controller.js'),
                 import('./game_state.js'), import('./stage_info.js'), import('./results.js').catch(e => { console.warn('results: module off:', e && e.message); return null; }),
                 // worker 0248: the events' view (stage_view.js), actors (data/event/actors), gun mesh (gun.js), windows, voices
                 import('./stage_view.js').catch(e => { console.warn('stage view: module off:', e && e.message); return null; }),
                 introActors ? introActors : import('./event_actors.js').then(A => A.loadEventActors()).catch(e => { console.warn('stage: the events\' actors not drawn (data/event/actors):', e && e.message); return null; }),
                 import('./gun.js').then(G => G.loadGun()).catch(e => { console.warn('stage: the events\' weapon not drawn:', e && e.message); return null; }),
                 import('./event_window.js').then(async W => ({ W, D: introWinData || await W.loadEventWindowData() })).catch(e => { console.warn('stage: the events\' windows not drawn:', e && e.message); return null; }),
                 SOUND && !introVoices ? import('./event_sound.js').then(E => { introVoices = new E.VoicePlayer({ get ctx() { return pauseSound.audio && pauseSound.audio.ctx; } }); }).catch(() => null) : null])
      .then(([d, m, GS, SI, RS, SV, LIB, GUN, WIN]) => {
        stageViewMod = SV; stageLib = LIB; stageGun = GUN;
        if (LIB) LIB.cape = cape ? cape.eventSource : null;               // the p000 bodies' cape (event_actors.js capeOf)
        if (WIN) { stageWinMod = WIN.W; stageWinData = WIN.D; }
        if (!d) { stageSiLoading = false; console.warn('stage: data/event/ev0100_stage.json missing (tools/byo/build_web.sh step stage): no story beats'); return; }
        stageData = d; createStage = m.createStageController;
        // worker 0220: the game-state bits (game_state.js) and the stage-info boxes (stage_info.js: FUN_0039e8e8 / FUN_003fdb48)
        stageGs = GS;
        stageSi = SI.createStageInfo({ output, pause, flags: { event: n => (stage && stage.globalFlags ? stage.globalFlags[n] : 0), stat: k => (stageRes ? (stageRes.stats.get(14) === 0x10 ? stageRes.stats.getTotal(k) : stageRes.stats.get(k)) : 0) },
                                       THREE, root, fxRng: fx ? fx.rng : null });   // worker 0241: the box effects (menu_fx.js)
        // worker 0232: the section stats from the save (results.js) and the Status box (stage-info kind 2 -> box 0x1d)
        if (RS) stageRes = RS.createResults({ stageInfo: stageSi, gil: () => (items ? items.inventory.gil : 0) });
        if (!stage) startStage(!!intro, intro ? 0 : (introRt ? introRt.skip : 0));   // with the opening, or from the save / a hand-off
        if (stageSi) stageSi.ready.then(() => { stageSiLoading = false; }); else stageSiLoading = false;   // worker 0265
      }).catch(e => { stageSiLoading = false; console.warn('stage: controller off:', e && e.message); });
    if (!intro) await stageReady;
  }
  requestAnimationFrame(frame);
}

main().catch(e => { msg.textContent = 'error: ' + e.message; console.error(e); });
