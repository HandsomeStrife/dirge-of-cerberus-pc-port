# Enemy AI hook (worker 0122, 2026-10-29; review fixes worker 0125)

`native/web/enemy_ai.js` translates the wake path and the awake e027's combat AI (notes/enemy-research.md
§8 / §9). Data: `native/assets/models/export_web_triggers.py` -> `data/enemies/ai.json` (build step
`enemy_ai` in tools/byo/build_web.sh; format enemy-ai-2: + section-24 weapons and each record's
weapon index). Test: `node native/web/test_enemy_ai.mjs [enemy_ai.js]` (STRICT=1: known gaps fail).
**Applied by worker 0126 (2026-10-30)**, with: the HUD says `HP 780 (enemy damage off)` without
?enemydmg=1; ai.json loads whenever enemies are on, so records 44 / 45 are drawn with ?enemyai=0 too
(AI off); dead records (HP 0) get AI mode 0 in addActor (FUN_0055cac8 -> FUN_0035f728); 41 / 42 are
no longer drawn (dead in the save, notes/enemy-placement.md). The patches below are the original text.
The patches below hook it into play.js / enemies.js. The
first version was checked in the browser on a scratch copy (trigger 95 fires, #66 / #67 go to mode 2
and fire, the drawn soldiers switch to r_st_a / r_st_f); the 0125 changes were checked with
`git apply --check` and `node --check` only.

## Steps for the manager

1. Apply: `git apply play.patch enemies.patch` (both blocks below; written against the working tree of
   2026-10-29).
2. build_web.sh already exports the AI and reaction clips (r_gst, r_gst_lk, r_st_a, r_st_f, r_stlld0,
   r_stlaf0, r_stbf0) and checks ai.json. Rebuild data/enemies: an old ai.json (no weapons) turns
   off the AI only, with a console warning; the soldiers are still drawn.
3. Audit rows: notes/fidelity-audit.md, "Enemy AI".

## What the hook does

- play.js loads ai.json, adds records 44 / 45 (#66 / #67) to the drawn soldiers and to the AI.
  GUESS: they are active from the start, as in the save (their activation by cmd 0x108 is not on the page).
- Each game frame: the player's position before and after `ctrl.step`, then `enemyAI.tick(STEP, old, new)`,
  then `enemies.tick(enemyAI)` (the clip each AI body asked for).
- **Player damage** (worker 0168: on by default, decoded hit test; `?enemydmg=0` keeps the hits, drops the damage;
  the text below is the old state): bullets fly (decoded countdown + flight) but don't test Vincent.
  `?enemydmg=1` turns on the GUESS hit test (BULLET_R) and the decoded damage: `php.hp` (780 from the
  save state, P status +0x20) on the HUD, logged on change. No hit reaction or death for Vincent; at
  HP 0 nothing happens.
- LOS ray: `col.segment` (GUESS: probe set 3 of FUN_005449f0 not decoded).
- `?enemyai=0` turns the AI off. A stale ai.json or a createEnemyAI error turns off the AI only.

## Decoded in the 0125 fixes

- **Weapon W**: status +0xac = stage section 24 record (FUN_00318610 / FUN_00311600), index by
  FUN_00318718: status +0x0c (= section-1 record +0x40, FUN_00315050) bit 0x16 ? record +0x54 :
  parameter set +0x88. Records 44 / 45 -> W 2 (damage 45, interval 180, reload 100, magazine 6, hit
  value 12): the save's RAM values. Records 41 -> 2, 42 -> 0, 43 (e048) -> 3, 46 / 47 -> 0, 48 / 49 -> 2.
- **Bullet** (FUN_005409a8(mgr, muzzle, aim, W, status, 0, 0) -> FUN_00554568 -> FUN_00552dd8(b, 0)):
  dir = normalize(aim - muzzle); speed +0x12c = W+0x2c / 6 (50 u per 1.0 step); range +0x15c = W+0x18 x 10
  + 15; end +0xd0 = start + dir x range (the aim point only with W+4 bit 0x400000); **+0x142 = 0 + 2
  frames of countdown** before it moves (FUN_005549f0; FUN_00554970 when it reaches 0). Then each frame
  age += step, pos = start + dir x age x speed (FUN_00556068), test prev -> pos (FUN_00556870). So a
  shot 33 u away lands 3 frames after the shot frame: f786 -> f789, f1008 -> f1011 (trace).
- **Defence FUN_00318120** for Vincent, from the save state: no armour (+0xc0 0), his W+0x68 0, level 4
  -> FUN_0031ce90 = int(0.33 x 4 + 0.4 + 0.5) = 2 (G+0x60 = 20 >= 7: factors at G+0x14 table +0x270);
  +0x60 = 0x8233 (bit 2, no 0x100) -> difficulty cut: FUN_00312698 true, FUN_002419d8(0x11) 0,
  FUN_00242c28 = DAT_0046b328 = 1 -> index 0 -> table +0xaa = 0 -> no change. 45 -> int(45.5 x 0.98) = 44.
- Manager cmd 0x2f(n, v): manager short n = v (FUN_00545b20; 0x30 reads it).

## Not decoded (two attempts): the bullet hit test against Vincent

**Superseded (worker 0168): decoded and translated; see 'Bullets vs Vincent' at the end. The text below is the old state.**

FUN_005442d8 walks the objects along the bullet's segment, filters them (vt+0x1ac), and asks each
one's part test (vt+0x17c: for e027 FUN_0055bda8 -> FUN_005ad118, the model's per-part volumes against
the posed skeleton); the closest hit gets vt+0x1b4 (FUN_0055db50). With no object hit, FUN_00556870
probes the room (probe 0). Vincent's part test needs his per-part volumes and his animated pose,
which this module doesn't have, and the room probe set isn't decoded. #67's f875 bullet passes 2.6 u
from #66's axis at chest height, but #66 shows no hit or near miss (AI +0x70) and FUN_0055db50 has no
friendly-fire exit, so the filter skips soldiers (L); why it then misses Vincent (part test, or room
geometry between #67 on the higher deck and Vincent) is open. Stand-in: BULLET_R, off by default.

## GUESS stand-ins

All listed with what depends on them in notes/fidelity-audit.md, "Enemy AI".

## Trace match (test_enemy_ai.mjs)

Both traces, every frame, for #66 / #67: AI mode, brain state, interval, target, think time of all
seven AIs, the AI clock. engage8 also matches actor state, clip, rounds and the fire timer. Wake at f784,
#66 aims at f785 and fires at f786 (r_st_a at f788), #67 uses a round with no shot at f799 and
fires at f875, #66 fires again at f1008. With damage on: 44 per hit, HP drops at f789 and f1011 as
in the game. Plus defence() on fixed inputs and a synthetic sidestep / distance check of the bullet.
The test fits the queue's two untraced AIs and the clock phase, and takes the jitter random
numbers from the traced fire times (GameRandom's sequence is not checked; its twist step is, against
the save state's MT words, when the save is present).
Known gaps (fail with STRICT=1): #67's f875 shot hits in the sim at f879 (the game misses: hit test
GUESS); engage7 has no C+0x564 field, so #67's f799 'round used, no shot' isn't reproduced from it.

## play.patch
```diff
--- a/native/web/play.js
+++ b/native/web/play.js
@@ -15,7 +15,7 @@
 // the background after start (vincent_<pack>.glb).
 import * as THREE from 'three';
 import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
-import { TICK, PlayerController, SpeedAnimator, FollowCamera, cameraRays, KEY_WALK, KEY_RUN } from './player.js';
+import { TICK, STEP, PlayerController, SpeedAnimator, FollowCamera, cameraRays, KEY_WALK, KEY_RUN } from './player.js';
 import { attachGun } from './gun.js';
 import { loadActions } from './actions/index.js';
 import { initReport } from './report.js';
@@ -24,6 +24,7 @@
 import { createOutputStage } from './output.js';
 import { setupAim } from './aim.js';
 import { setupEnemies } from './enemies.js';
+import { createEnemyAI } from './enemy_ai.js';
 
 const params = new URLSearchParams(location.search);
 const hud = document.getElementById('hud');
@@ -32,6 +33,8 @@
 
 const SPAWN = { x: -1395.63, z: -1110.51 };
 const ENEMIES = params.get('enemies') !== '0';       // enemies.js: z128's stage-load soldiers, idle
+const ENEMY_AI = params.get('enemyai') !== '0';      // enemy_ai.js: wake trigger + awake soldier AI (?enemyai=0 = off)
+const ENEMY_DMG = params.get('enemydmg') === '1';    // enemy bullets hit Vincent (off by default: the hit test is a GUESS)
 const AIM = params.get('aim') !== '0';               // aim.js (aim_core.js): the weapon, its camera views, the reticle
 const PACKS = params.has('packs') ? params.get('packs').split(',').filter(Boolean) : (AIM ? ['ladder', 'jump', 'shoot'] : ['ladder', 'jump']);
 // Placement: the game draws the model with the motion player's matrix MP+0x10 (FUN_005ab8f0
@@ -608,8 +611,27 @@
     const prevHook = anim.drawHook;
     anim.drawHook = () => { if (prevHook) prevHook(); light.frame(actorPoint()); };
   }
-  const enemies = ENEMIES ? await setupEnemies({ root, litPatch, light })
+  // enemy AI data (export_web_triggers.py). GUESS: records 44 / 45 (#66 / #67) are active from
+  // the start, as in the sea-of-flames save (their activation by event cmd 0x108 is not on this page).
+  const AWAKE = [44, 45];
+  let aiData = ENEMIES && ENEMY_AI ? await fetch('data/enemies/ai.json').then(r => r.ok ? r.json() : null).catch(() => null) : null;
+  if (ENEMIES && ENEMY_AI && !aiData) console.warn('enemy AI off: data/enemies/ai.json missing');
+  // an old ai.json (no records 44 / 45 or no weapons) turns off the AI only, not the soldiers
+  if (aiData && !(AWAKE.every(k => aiData.records?.[k]) && Array.isArray(aiData.weapons))) {
+    console.warn('enemy AI off: data/enemies/ai.json is out of date (rebuild data/enemies)');
+    aiData = null;
+  }
+  const enemies = ENEMIES ? await setupEnemies({ root, litPatch, light, extra: aiData ? AWAKE.map(k => aiData.records[k]) : [] })
     .catch(e => { console.warn('enemies off:', e.message); return null; }) : null;
+  // Vincent's status for the enemy AI: HP 780 = P status +0x20 in the save state (k_enemy_engage8 p_hp)
+  const php = { pos: [ctrl.pos.x, ctrl.pos.y, ctrl.pos.z], hp: 780, id: 0x16, f118: 0, s64: 0 };
+  let enemyAI = null;
+  try {
+    enemyAI = aiData && enemies ? createEnemyAI({ data: aiData, player: php, log: m => console.log(m), damage: ENEMY_DMG,
+      // GUESS: FUN_005449f0 probe 3 = the page's collision triangle set (probe sets not decoded)
+      los: (a, b) => !!(col.segment && col.segment({ x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] })) }) : null;
+    if (enemyAI) for (const k of AWAKE) enemyAI.addActor({ rec: k });
+  } catch (e) { console.warn('enemy AI off:', e.message); enemyAI = null; }
   // test aids that move him (H, ?ladder=): the cloth restarts from the new pose (cloth.js reset)
   // and the camera resets as at spawn (player.js reset(): FUN_003285d0's snap; GUESS: the
   // angles are CAM_SPAWN, and whether the game resets the camera on a warp is not decoded)
@@ -772,13 +794,15 @@
       follow.tick({ pos: ctrl.pos, want: ctrl.C.dir, state: ctrl.P.state,
                     stick: moving ? (inp.run ? KEY_RUN : KEY_WALK) : 0, pad: null });
       const b = follow.basis();                    // re-aim the keys with this frame's matrix
+      const pOld = [ctrl.pos.x, ctrl.pos.y, ctrl.pos.z];
       ctrl.step(aim(inp, b));
       pressed.clear();                             // an edge is seen by one tick only
       // feet vs ground check (for the HUD / tests)
       const g = col.groundY(ctrl.pos.x, ctrl.pos.z, ctrl.pos.y);
       if (g != null) stats.groundErrMax = Math.max(stats.groundErrMax, Math.abs(g - ctrl.pos.y));
       stats.lastGroundErr = g == null ? null : g - ctrl.pos.y;
-      if (enemies) enemies.tick();
+      if (enemyAI) { php.pos = [ctrl.pos.x, ctrl.pos.y, ctrl.pos.z]; enemyAI.tick(STEP, pOld, php.pos); }
+      if (enemies) enemies.tick(enemyAI);
       acc -= TICK; n++; stats.ticks++;
     }
     if (n === 8) acc = 0;                          // fell far behind (tab hidden): drop time
@@ -805,12 +829,12 @@
       `clip ${anim.override ? 'action' : anim.current} (${anim.clipName()}) x${anim.rate.toFixed(2)}` +
       `${ctrl.active ? '   action ' + ctrl.active.name : ''}` +
       `   speed ${(ctrl.speed * 60).toFixed(1)} u/s\n` +
-      `onGround ${ctrl.onGround}${ctrl.hitWall ? '  WALL' : ''}` +
+      `onGround ${ctrl.onGround}${ctrl.hitWall ? '  WALL' : ''}` + (enemyAI ? `   HP ${php.hp}` : '') +
       (weapon ? `   weapon ${weapon.core.P.drawn ? 'out' : 'away'} st ${weapon.core.P.st} T ${weapon.core.P.T}  cam 0x${weapon.core.cam.type.toString(16)}` : '') + '\n' +
       `click: mouse look (drag works too)   WASD move (walk)   Shift run   ${actionHelp.join('   ')}   H respawn   R report`;
   }
   window.__play = { ctrl, anim, follow, aim: weapon, col, stats, camera, renderer, output, root, vin, light, spawnY: gy,
-                    playerState, camView, report, keys, pressed, motions, packsReady, actionHelp, cape, enemies };
+                    playerState, camView, report, keys, pressed, motions, packsReady, actionHelp, cape, enemies, enemyAI, php };
   requestAnimationFrame(frame);
 }
 
```

## enemies.patch
```diff
--- a/native/web/enemies.js
+++ b/native/web/enemies.js
@@ -69,9 +69,11 @@
   else dir.set(0, 0, 0);
 }
 
-export async function setupEnemies({ root, litPatch, light }) {
+export async function setupEnemies({ root, litPatch, light, extra = [] }) {
   const P = await json(DIR + 'placements.json');
-  const list = P.placements.filter(p => p.model === 'e027');
+  // extra: section-1 records the AI drives (enemy_ai.js; ai.json records, up = (0,-1,0) as every z128 placement)
+  const list = P.placements.filter(p => p.model === 'e027')
+    .concat(extra.map(r => ({ rec: r.rec, tag: 'rec' + r.rec, model: r.model, pos: r.pos, face: r.face, up: [0, -1, 0] })));
   if (!list.length) return null;
   const stem = VARIANT === 0 ? 'e027' : `e027_v${VARIANT}`;
   const [gltf, side, lpBuf] = await Promise.all([
@@ -81,7 +83,6 @@
   ]);
   const lp = side.local_pose;
   if (!lp || !lp.clips[CLIP]) throw new Error(`e027.json: no local pose for ${CLIP}`);
-  const frames = side.clips[CLIP].frames;                      // 200, looped (FUN_005aa2a8 resets at n)
   const s = SCALE_BYTE / 128;
   const Y = new THREE.Vector3(0, 1, 0);
   const actors = [];
@@ -112,7 +113,7 @@
     // FUN_005a9db0 through SpeedAnimator's own code (setLocalPose / poseLocal use only this.lp)
     const pose = Object.create(SpeedAnimator.prototype);
     pose.setLocalPose(lp, lpBuf, scn);
-    const a = { rec: pl.rec, tag: pl.tag, body, prims, pose, frame: 0 };   // GUESS: frame 0 at activation, all in phase
+    const a = { rec: pl.rec, tag: pl.tag, body, prims, pose, frame: 0, clip: CLIP };   // GUESS: frame 0 at activation, all in phase
     if (light && litPatch) {
       const p = new THREE.Vector3(...ACTOR_CENTRE).applyAxisAngle(Y, body.rotation.y).add(body.position);
       const dir = new THREE.Vector3(), col = new THREE.Vector3();
@@ -132,12 +133,18 @@
   }
   return {
     actors,
-    // one game frame: draw pose = this frame's clip frame, then FUN_005aa2a8's advance
-    tick() {
+    // one game frame: draw pose = this frame's clip frame, then FUN_005aa2a8's advance.
+    // ai (enemy_ai.js world, optional): the clip each AI-driven soldier's body asked for
+    // (C+0x570); a new clip starts at frame 0. GUESS: no blend between clips (flags 0x82 / 0x83
+    // of FUN_00345818 not translated), every clip loops at its frame count.
+    tick(ai) {
       for (const a of actors) {
-        a.pose.poseLocal(CLIP, a.frame, null, 0, 1);
+        const s = ai && ai.actors.find(x => x.rec === a.rec);
+        const want = s && lp.clips[s.C.clip] && side.clips[s.C.clip] ? s.C.clip : a.clip;
+        if (want !== a.clip) { a.clip = want; a.frame = 0; }
+        a.pose.poseLocal(a.clip, a.frame, null, 0, 1);
         a.frame = Math.fround(a.frame + Math.fround(Math.fround(RATE * 1.0) * STEP));
-        if (frames <= a.frame) a.frame = 0;
+        if (side.clips[a.clip].frames <= a.frame) a.frame = 0;
       }
     },
   };
```

## Other types (worker 0144, 2026-10-30)

**One class for every type (D).** The save state's object table (`*(DAT_0046e880+0x1164)`) holds 215
objects of vtable **0x58e1f8** (FUN_00558790): every e027, e048, e030, e036, e023, e024, e001, g001 and
n0xx placement (object +0x17c = status, +0x9c parameter set -> model name). So there is no per-type AI
class: the brain modes (FUN_0035f300), the layers, the part test vt+0x17c FUN_0055bda8 -> FUN_005ad118
and the damage path vt+0x1b4 FUN_0055db50 are shared code. What differs per type is data:

| what | where (decoded) | e027 | e048 | e030 |
|---|---|---|---|---|
| stance C+0x664 | FUN_00559748 -> **FUN_00564228** (switch on the model name) -> FUN_00340ac0 | no status / status +0x9c == 0 -> 0x1f; weapon class W+0x14 >> 2 & 7: 2 -> 0x1e, 0 / 1 / 3 / no weapon -> 0x1f, 4-7 stance kept | same rule as e027 (no case of its own) | 0x23 (+ C+0x568 \|= 0x200) |
| stance flags C+0x808 | FUN_0030fc38(n) = 'bmd' table flags[n] (06800009.bin, FUN_0030f688 -> FUN_0030fb78 -> G+0x84; file = save RAM byte for byte) | 0x872b (bit 0: brain 2 state 0 -> 3, shooter) | 0x872b | 0x8c44 (bit 0 clear -> states 7 / 8) |
| motion rows C+0x7fc | FUN_0030fc08(n): 229 x 8-byte clip names per stance | 0x1f: r_gst, 0x40 r_st_a, 0x57 r_st_f, ...; 0x1e: m_gst, m_st_a, m_st_f, ... | as e027 | st_a, look, stld0, stbf0, bl_0, jp0..4, rev_0 (no 0x40 / 0x57) |
| radius +0x2c / height +0x30 | **FUN_00563fc0**: zone header (status +0xa8) +0x20 x 0.5 (bit 0: max with +0x28) / +0x24 | 5 / 18 | 5 / 18 (sets 3 / 4) | 6 / 12 (set 8) |
| part boxes | model 'mkd' (FUN_0030baa0) | 13 | 13 (bones 6, 2, 3, ...) | 13 (head box at z 6.4: outside the 6 u cylinder) |
| zones / lock bone | section 19/20 (zone_set, lock_bone) | sets 6 / 7, bone 3 | sets 3 / 4 (head x60), bone 3 | set 8 (head x24), bone 3 |
| weapon | section 24 (FUN_00318718) | 0 / 2 / 4 / 5 / 7 | 1, 3 (class 3), 8 (class 2: interval 16) | none |

Save-state checks: +0x2c / +0x30 of every inactive actor equal FUN_00563fc0's values (e001 7.5 / 28, e023
90 / 40 with +0x28 bit 0x10000, e024 90 / 120); status +0x60 (less 0x41) / +0xc0 / +0x27 / +0x64 are 0 on
every e027 / e048 / e030, so ENEMY_STATUS (was E027_STATUS) holds for all three.

**Ported.** export_web_triggers.py: records `stance` (stance_of = FUN_00564228 for z128's names), weapons
`cls`, `stances` (flags + rows of the used stances), `sizes`, part boxes of all 7 types, `model_clips`
(frames of the requested rows per model). enemy_ai.js: AI_TYPES {e027, e048, e030} get an actor at
activation; clip names from the actor's stance rows; brain 2 state 0 -> 3 / 7 by C+0x808 bit 0; cylinder,
eye, lock point from the actor's size; clip lengths per model. Inputs: 06800009, 07650c00 / 076506c0 (m000:
the m_* rows) in disc.py. e048: the whole e027 path (wake, aim, fire with its own W, bullets, hits, flinch,
death). e030: activated, stands in st_a, brain state 7 (warn), hit / flinch (stld0) / death (stbf0).

**Not done.** e030's brain states 7 / 8 (FUN_0035ff98 attack pick -> FUN_0055baa8(actor, 0x80 + i)) and
its attack motion classes; e036 / e023 / e024 / e001 have no actor (their stances 0x1e / 0x19 / 0x1a / 0x10
are exported). **No PCSX2 trace of an e048**: none is active in the save, the tracer logs only actors active
at load (fixed addresses, fields.find_enemies), and the e048 activations near the spawn don't help: trigger 56
(168 u away) names e048 records 28 / 29 only in its `c105(0,0) == 0` branch (on the save's settings it activates
e027 50 / 51, test_enemy_ai), and 28 / 29 stand ~1250 u off, beyond the 500 u range; the others are >= 478 u away. A trace needs the tracer to follow an actor activated
mid-run (pointer-chained fields) first.

**Flinch end (worker 0145, D).** Motion state 0x1e = factory 0x5a6c28 (FUN_00592918) case 0x1e ->
FUN_00598880, vt **0x5a5c70**, update vt+0x24 **FUN_00598950** (phase +4, done +8, timer +0xc):
- 0: FUN_00340bb8; motion by C+0x590 & 0xf (hit side): 2 -> 0x24, 3 -> 0x26, 4 -> 0x27, 5 -> 0x28, 6 -> 0x29, else 0x25; timer 0 -> 1.
- 1: when the motion is done (FUN_003460d8) or timer > 120 (timer += DAT_004eeb24, BSS): done bit, then
  motion **0x40** if C+0x590 bit 24, else motion **1** (flags 0x83) -> 2. (Off the ground, C+0x1c0 0x200
  clear: done bit only.)
- 2: C+0x1c0 &= ~0x20; returns FUN_00341b20: next state 6 (bit 24) or 3 (C+0x590 bits 16-19 == 1: 0x16 / 0x12).
C+0x590 bit 24 = 'gun out', written only by FUN_00565d78 (with actor +0x100 bit 44). **Writer DECODED (worker 0146):**
FUN_0055b8e0 runs the new state's enter (actor vt+0x2fc FUN_0055bbf8 -> state class vt+0xc, classes FUN_00537628);
state 3 FUN_005380a0 / 5 FUN_00538598 set it, 2 FUN_00537e70 / 7 FUN_005386f0 clear it (0 / 4 clear with +0x118 bit 0x10000
clear; also 6, 0xa-0xe, 0x12, 0x13, 0x15-0x17, 0x1a, 0x1b, 0x1d); no leave (vt+0x14) writes it. So activation (state 2) starts
it clear, the brain's state 3 sets it, death (7) clears it. FUN_0055f9d0's clear needs status bit 7 (FUN_0055f128 /
FUN_0055f338 kind 7: FUN_0056b4e0 from overlay code 0xbeb5d0.., event script FUN_005661e8, FUN_00570c10): left out.
e030 (no row 0x40, never in state 3) goes back to row 1 = st_a. e030's C+0x568 0x200 (FUN_00564228) is read only by FUN_00341a48:
C+0x1c0 |= 0x20000 when C+0x590 bits 16-19 < 2 (a body flag, not the flinch).

## Mode 1, crouch, fire blend (worker 0149, 2026-10-31)

**Dan's report 20261031T000852Z-9974** ("guard doesn't move or acknowledge Vincent"): the alley guard is
**record 51** (e027, stance 0x1e m_*, weapon 7, script 142), 40 u north of Vincent. Trigger 56 activated
50 / 51 in mode 0; trigger 90 (Vincent walking north up the alley) sends them message 2, and script 142
sets #51 **AI mode 1** (#50: mode 2; the corpse at his feet is likely #50, shot). Mode 1 had an empty
update on the page: a **port gap**, not the game. Trigger 76 (flags 0x20, event 0x12, condition not
decoded) would also wake them; the page still never runs event 0x12.

- **Brain mode 1** (class 0x4a2588: start FUN_003628f8, update FUN_00362998) translated: mode 2's
  shooter plus a posture change in state 4 (stance flag C+0x808 bit 3; e027 / e048 0x872b): once 0x79
  ticks have passed since the last change, each run draws FUN_0040b5c0; < 0.2 -> actor state 5 (crouch)
  or 3 (stand), combat layer off, 0x1f ticks later combat on again. No target -> state 6 / 7 (mode 2's 5 / 6).
  States 8 / 9 = the non-shooter attack (e030): warn, not translated.
- **Actor state -> body motion** (FUN_0055b8e0: old state's class vt+0x24(new) -> FUN_005641c0): 3 -> 5
  motion 0x18, 5 -> 3 motion 0x19, 2 -> 3 motion 5 (FUN_00538120 / FUN_005385f8 / FUN_00538340 ->
  FUN_00537d58). Classes from the factory 0x5a6c28's compare tree (FUN_00592918 is not a Ghidra
  function; walked from the ELF): 5 FUN_005945e8 (update FUN_005946a0), 6 FUN_00594898 (FUN_00594978),
  0xf vt 0x5a6300 (FUN_00597c60), 0x16 FUN_00597108 (FUN_005971d8), 0x18 FUN_005977e8 (FUN_005978e8),
  0x19 vt 0x5a5df0 (FUN_00597ae8). Update = vt+0x24, enter vt+0x14, leave vt+0x1c.
- **Crouch** (actor state 5 enter FUN_00538598 -> FUN_00565bd0(a, 1)): stance 1, height +0x174 = 0.6 x
  +0x170 (FUN_00563fc0). Clips m_sq_a / m_sq_f (rows 0x78 / 0x7b) now exported for e027 / e048.
- **Fire clip** (Dan's point 2): the clips were right (row 0x57 = r_st_f / m_st_f) but the page cut
  clips hard. New trace **k_fire_emp15** (engage8's inputs to f830, `TRACE_FIELDSET=enemy TRACE_ENEMIES=2
  TRACE_EMP=1`: each enemy's MP head + layers): every request pushes a head layer, the old head blends
  out over 11 clip ticks (+0x24: 9.8 -> 0 by 1.2) and only the head and blend-out layer advance. #66
  pushes r_st_a (loop) f785, r_st_f (no loop, partner r_st_fd) f786, r_st_a (loop) f788: so r_st_f
  plays as the blend-out layer at full weight, fading over ~9 frames (frame 1.8 -> 7.2). enemies.js now
  does exactly that (head + blend-out, as Vincent's SpeedAnimator). test_enemy_ai checks both soldiers'
  pushes (frame, clip, loop) against the trace; test_enemies_page step 7 checks #51's fade on the page.
  **Missing:** the up / down partner rows (r_st_fu / r_st_fd, picked by the aim pitch C+0x680 in
  FUN_00345818): not exported; the middle row plays.
- **Melee** (Dan's point 3), decoded, **not ported**: the attack pick FUN_0035ff98 -> FUN_00347bd8 scans
  the attack table C+0x7e8 (= zone header +0x34, FUN_00340760; +2 count, entries FUN_00347978, flags
  +6, conditions FUN_00347af0 from FUN_003479c0) and starts actor state 0x80 + i (FUN_0055baa8). Gate
  FUN_00310c40 = G+0x64 = 48 in the save (>= 0x18). Save RAM: e027 / e048 have 1 attack, e030 7.
  Shooters (C+0x808 bit 0) never reach the pick in brain modes 1 / 2; modes 3 (FUN_00361690), 5
  (FUN_003639d0 state 10) and 6 (FUN_00364558) call it without that check. Next: the 0x80+ actor state
  classes (FUN_00537628) -> attack motions, hit window and damage to Vincent; mode 5 (most soldiers'
  hit reaction, e.g. records 69 / 70 on wake) and mode 3 (e030s) are also untranslated, so those still
  stand. Survey (scripts' 0x143 per wake n / hit): 13 records activate in mode 1, ~30 branches set
  mode 1, ~40 mode 2, ~35 mode 5, ~32 mode 3 (mostly e030), 1 mode 6.

## Review fixes (worker 0150, 2026-10-31)

- **State -> motion tables** read from the ELF (FUN_00537628 classes' vt+0x24): states 0 / 1 use
  FUN_00537aa0 (jump table 0x589e70: new 2 -> motion 3, 3 -> 6, 5 -> 0x16); 2 FUN_00537d58; 3 FUN_00538120;
  5 FUN_005385f8. #66's 1 -> 3 = motion 6 (the old r_st_a GUESS is gone; k_fire_emp15 pushes still match).
  FUN_005641c0's same-motion no-restart holds for every class when FUN_0055b8e0's param_3 is 0 (the brains);
  activation passes 1 (old class = state 0's, always restarts).
- **Activation** (FUN_00559748 plain placement): FUN_0055b8e0(a, 2, 1, 0) -> state 2, motion 3 (class 3 not
  ported). The page's 44 / 45 start in the save's states 1 / 2 (play.js AWAKE_STATE, T engage8 f760), so #67's
  wake is 2 -> 3 = motion 5 (r_st_a:0, then r_st_a:1 8 frames later, as the trace).
- **Blend length** per request: FUN_00344608 uses C+0x591 (0 with C+0x564 bit 2); FUN_00340bb8 loads it
  (motions 0x18 / 0x19: 10; 6 / 0x16 phase 0: C+0x6c0, default 10 from FUN_0033ff18). Flinch's 5 / none is a GUESS.
- **Brain 1 states 8 / 9** translated around the attack pick (FUN_0035ff98 stand-in: none).
- **Found:** the game's flinch sets C+0x564 0x8000 (busy; k_hits12 f870), which the page lacks. G+0x64: 48
- **Ported (worker 0151):** flinch class 0x1e (vtable 0x5a5c70) enter 0x5988b8 = C+0x564 |= 0x8000|0x4000|0x10000; leave 0x5988f0 clears those and C+0x1c0 bit 0x20 (disassembled from the ELF). Effect on the page: a soldier woken from state 2 by a hit finishes the flinch (row 1, gun bit still clear) before the brain enters state 3. Death frame (k_hits12 f871) shows 0x4000c000: the death motion's enter sets 0x8000|0x4000 again (not read).
  here vs '< 27' in stagger()'s comment.
- No mode-1 trace exists (the tracer can't follow actors activated mid-run): the mode-1 timing test checks
  the decoded waits (0x79 / 0x1f rounded up to the 5-tick brain run), not game frames.

## Modes 5 / 6, melee (worker 0152, 2026-10-31)

**Brain mode 5** (class 0x4a2770, FUN_003638f8): start 0x363988 (ELF; not a Ghidra function): AI +0x20
interval 10, C+0x1c0 |= 0x1000000 | 0x4000000 (mode 3's 0x361648: the same with 5; mode 6's 0x364548:
interval 5). Update FUN_003639d0, translated in `brain5` (states 0-0x12). Summary: 0 -> 5 (actor state 3,
combat layer 2, action layer 2, +0x74 / +0x70 cleared) -> 6: visible and d34 < 22 -> 10 (attack pick ->
0xb -> 0xe); < 3 hits taken: < 3 misses -> after 0x79 ticks FUN_0035f7c0(ai, 0) -> 0xc (action 6) / 7
(+0x78 > 3) / 0xe; >= 3 misses -> 7 / 0xe; >= 3 hits -> 0xc. 7 -> 8 (action 3 = approach) waits for
C+0x1c0 0x100000 (move ended) or d34 < 25. FUN_0035f7c0 / FUN_0035f8b0 = odds from AI +0x98 / +0x99 =
section-1 record +0x4c / +0x4d (now exported: records[].b98 / b99; z128 soldiers 100 / 0 -> p 1.0).
AI +0x74 / +0x78 = the AI's bullets that ended on nothing / on something (FUN_00554ea8 -> FUN_00568e20 /
FUN_00568df8). **Mode 6** FUN_00364558 in `brain6`. Records 69 / 70 (scripts 24 / 25) set mode 5 in events
2, 3, 8 (hit) and 0x13.

**Action layers** (FUN_0035f540 -> FUN_0035f590, vtables 0x4a2a28 (1) .. 0x4a2908 (7), 0x4a28d8 (0xb);
update vt+0x1c: 2 FUN_00366390, 3 FUN_003667b0, 5 FUN_003670e8, 6 FUN_003672d8, 7 FUN_00367508) are
**not ported**: they ask for paths on the stage's node graph (FUN_00563970 / FUN_00563d20 node of an
object, FUN_0033e118 node record (+0xe area byte), FUN_00368120, request FUN_0055a628 with a 16-byte
struct / FUN_0055a590) or approach directly (FUN_00353110(20, 1000, C, target) + mover 3). That graph and
the mover are the next decode for enemy movement. Mode 3 (FUN_00361690) is mostly these calls.

**Melee.** Attack table T = zone header + u32 header +0x18 (FUN_0030fc68, version >= 0x16), relocated by
FUN_0030fd08: +2 count, +0x10 entries (16 B: +0 length, +2 / +4 keyframes, +6 flags, +8 / +0xa distance,
+0xc yaw, +0xd tolerance, +0xe pitch nibbles), +0x14 keyframes (frame, first command, count), +0x18
commands (4 x s16), +0x1c names (8 B: clips and sounds), +0x24 hit volumes (64 B), +0x28 projectile
records (16 B). Pick FUN_00347bd8 (see the audit row). Start FUN_0055baa8 -> actor state 0x80 + i (class
0x80 for 0x80-0xbf, FUN_00537490) -> body motion 0x1000 + i (FUN_00537aa0 table 0x589e70: 0x537bf4 =
st + 0xf80) = factory 0x5a6c28's vtable 0x5a4270: enter FUN_0059e830, update FUN_0059eb18 (timer += step;
keyframes whose frame <= (int)timer run their commands FUN_00348138 -> FUN_003481e0; done once all ran
and timer >= length), leave FUN_0059e938. Commands go on to the owner through FUN_00341988(C, 4, cmd) ->
the actor's handler (jump table 0x58de60 [4] -> 0x56a1c8, per-op table 0x58de90): op 0 / 1 -> actor
state 1 when not attacking; op 2 -> FUN_00569dc0 (melee hit volume: FUN_00541310 builds an attack object
from the 64-byte record, placed on a bone FUN_0054a768 / FUN_0054a7d0, damage +0xc2 scaled by status
+0x56); op 3 -> FUN_00311600 (section-24 record: e030's projectile); 6 -> 0x56a2c4, 7 -> 0x56a2b0, 0xc ->
0x56a320 (not read). e027 zone sets 6 / 7: m_atk / r_atk_0 (1-40 / 1-30, hit at keyframe 9 / 13, length
66); e048 3 / 4: r_atk / m_atk; e030 set 8: 7 entries (atk_0..3, jp0..2, b_stp, st_btl). **Not found:**
who leaves the attack state (class vt+0x1c = 0x539ea0 gives the state; its caller is not in the decomp:
GUESS stand-in). **Next:** the attack object class of FUN_00541278 / FUN_00541310 (its update and overlap
test against Vincent) for melee damage behind ?enemydmg=1.

**Worker 0153 fixes (review of 0152).** Mode 5 state 0xe: C+0x1c0 |= 0x10 when FUN_0035f890 (=
FUN_0035f7c0 ^ 1) returns 0, i.e. when the odds pass (was inverted). AI +0x20 is the scheduler interval
in every write (mode 1 state 9, mode 6 state 6, the starts). Actor states 6 / 0x1b (vtables 0x58ae00 /
0x58add0): enters FUN_00538218 / FUN_005382e0 = FUN_00565bd0(a, 0), FUN_00565d78(a, 0) (gun bit clear),
+0x118 |= 0x200; leaves 0x538260 / 0x538328 clear +0x118 bit 0x200; vt+0x24 FUN_00538278 / FUN_00538340
(same state 0, 8 / 0x1f 0x20, 9 0x22, 0x20 / 0x21 0x59, else FUN_00537d58). State 5's other rows go
FUN_00538420 -> FUN_00537aa0, so 0x80 + i from 5 / 6 / 0x1b is motion 0x1000 + i. Mode 6 states 2-5
re-pick unconditionally (FUN_0035fe80 -> FUN_005608e8, FUN_0035fec0, FUN_0035fc98): translated with the
candidate GUESS (the player); FUN_0035fec0's two-target switch (FUN_0054aa50 -> FUN_0054a9d0) warns.

## Dan's play report: melee, push-out, platform soldiers (worker 0154, 2026-10-31)

New trace **k_push16** (`TRACE_FIELDSET=enemy TRACE_ENEMIES=2 TRACE_PUSH=1`; engage8's route, stick held to
f900 so Vincent runs on into #66 along the ladder-top railing, no shots). New opt-in fields (fields.py
TRACE_PUSH): actor +0x28, +0x2c..+0x3b (radius, height, +0x38), +0x118, +0x130 for Vincent and the soldiers,
Vincent's C+0x430 / C+0x1c0.

- **No melee (point 1): the game doesn't either.** e027 / e048 are shooters (C+0x808 bit 0), and modes 1 / 2
  reach the attack pick FUN_0035ff98 only in their non-shooter states (FUN_00362ef8 state 7, FUN_00362998
  state 8). k_push16: #66 woken (mode 2, f784) with Vincent 4-7 u from him for ~200 frames stays in actor
  state 3; no 0x80+ state. Melee happens from modes 3 / 5 / 6 only (most soldiers' scripts switch to 5 when
  hit; worker 0152's page test step 8 sets that up by the hit event). test_push_out checks the trace and the
  page AI on the same path (0 attack frames; an invented mode-2 swing is caught: 216).
- **Push-out (point 2): FUN_00542ab8**, from the manager frame FUN_0053b500 before the actors move. Actors
  on list +0x1274 with +0x38 bit 9 (Vincent 0x381, live soldiers 0x387; a corpse's 0x183 leaves it). Clears
  each +0x130; for each pair with horizontal distance <= r_i + r_j: i's low point (feet + r_i up) against
  j's cylinder (FUN_0025d508: flat end at the feet, round end at the top), overlap = r_i - |surface - low|,
  push_i += normal x overlap^2 / r_i x 0.25 (DAT_0046e90c; x1 with j's +0x118 bit 0x4000000), skipped
  while i attacks (FUN_0055bb40) unless +0x28 bit 2, not added with i's +0x118 bit 0x10000000 (#67 has it);
  then the same for j. Matches k_push16 to 7e-5. FUN_00343160 copies +0x130 to C+0x430; the code that
  adds it to the move was **not found** (three attempts). The trace fits "ground move = walk x step +
  push, then the walk-mesh slide" to 0.002 u (player.js, GUESS row). #66's push is never applied (he
  stands still), so the page applies none to soldiers.
- **Platform soldiers (point 3):** the save has seven live soldiers, records 44-49 and 66 (k_enemy_engage8
  f760: active, HP > 0, actor states 1 2 1 1 2 2 1); the page only spawned 44 / 45. play.js AWAKE now has
  all seven (46-49 on the raised floor north-east of the ladder top, 66 by the west walkway). Triggers
  89 / 77 / 76 / 78 already name them; 77 / 76 / 78 are event-0x12 volumes the page still doesn't run.

## Platform soldiers' wake, push-out tests (worker 0155, 2026-10-31)

- **Event 0x12 = a bullet crossing the volume (D).** Trigger vtable 0x58cdf8 +0x1b4 = FUN_005511e8, called
  only from the bullet ray test FUN_005442d8 (FUN_00556870 <- the bullet update). FUN_005503e8 gives shape
  0 / 8 triggers with flags +0xa4 bit 5 (0x20): +0x40 |= 0x10 (FUN_005511e8 runs the event), +0x38 |= 1
  (bullets test it) and +0x28 |= 0x100 (see-through: listed, never the closest hit). Filters for a trigger:
  vt+0x1ac 0x552838 returns 1 (every bullet, the soldiers' too), vt+0x8c / +0xb4 / +0xbc return 0. Ray test
  vt+0x17c FUN_00550da0(o, 0, ..): segment to the box frame, FUN_0025e400(end, start) (clip; returns the face
  where its 2nd point was clipped), and if -1, FUN_0025e400(start, end): entry point, else exit point when
  the start is inside, nothing when both ends are inside. A listed volume nearer the segment start than the
  closest solid hit gets event 0x12 with r0 = bullet +0x128 (owner id), r1 = that object's +0x20 (or -1).
  Scripts 98-101 don't read r0 / r1. Walking into 75-78 fires nothing (bits 0 / 1 clear); trigger 89
  (ev 0xd, on the lower floor east, x -788 z -966) is the walk-in wake of 46-49.
- enemy_ai.js `shotVolumes` (both Vincent's and the soldiers' bullets), `clipSeg` = FUN_0025e400,
  `inBoxBut` = FUN_0025f638. test_shot_volumes.mjs; test_enemies_page step 9 (fresh page: R1 over the
  platform from the deck -> 77 -> 46-49 woken: 48 / 49 mode 1; 46 / 47 mode 0 + a script sub-routine the
  VM stops at, op 37 / 39 / 40 + cmds 0x142 / 0x131: not translated).
- Consequence: #51 stands inside trigger 76 (script 99, not once): each of his shots wakes 46-50. In the
  page test this brought his next shot forward through the shared RNG, so step 7 disarms 76 for its
  blend comparison (test aid).
- **Push-out step (test gap, not decoded).** player.js integrate per frame with pushOut (test_push_out):
  the step along the game's path matches (0.005 u) but the position is 0.81 u off sideways. The game's
  steps fit walk + (push . walk direction) x walk direction to ~0.005 u, and standing next to #66
  (f909-f1020, push 0.58) he only jitters +-0.03 u. So the push does not enter as a displacement the way
  the page's stand-in adds it. Not ported (a fit, not a decode); the reader of C+0x430 is the next decode.
- MISSING / GUESS labels in pushOut: FUN_0054b3a0 +0x28 bit 0x10000 offset (warns), +0x38 bit 9 stand-in.
  Pair skip (both +0x28 0x20 and both +0x118 0x20000) translated. #67's +0x118 0x10000000 (never pushed in
  the game) has no setter on the page.

## Push into the step, shot-volume gaps, #51's re-wakes (worker 0156, 2026-10-31)

- **Where C+0x430 enters the move: still not decoded** (attempts 4-5). REA's rizin backend isn't installed
  (`rizin` ENOENT), so the same scan was done by hand: every lw / lwc1 / lq / lqc2 / ld with offset
  0x430-0x438 in the ELF hits only stack slots (FUN_0035a440's r29 0x430 / 0x438 are locals) and
  FUN_0034c388's zero test (via `addiu r2, 0x430(r21)`); FUN_00358fb8 / FUN_003590c8 / FUN_00357d48 /
  FUN_0035a440 never read body (C+0x3b0) + 0x80. player.js now uses worker 0155's fit (GUESS row):
  move = w + (push . w_hat) w_hat, nothing while idle. k_push16: full position 0.005 u (f809-f826), idle
  0.000 u, closest approach 3.996 vs 3.999 u.
- **The f827 stop is not the push.** The stick is held to f900 (lx 204, ly 0; facing 113.5 deg, travel 87.9 deg
  along the railing from f796, before any contact). At f827 the game cuts his step to 0.35 u and from f828
  holds him 6.55 u past #66 (+-0.1 u alternating), with the push (0.49, -0.34) pointing along his walk.
  C+0x1c0 stays 0xd0f04 (0x10f04 only at f825 / f826). The page's walk mesh has nothing there; he walks
  ~3 u on. Unknown blocker (object primitive in FUN_0035a440?): test_push_out `gap` line.
- shotVolumes: MISSING label for +0x120 bit 0x800 bullets (FUN_005442d8's radius path, vt+0x184 /
  vt+0x19c); skipped with a warning.
- #51 / trigger 76: script 99 re-runs on every one of his shots, but the targets' event-2 scripts (126 / 127
  / 128 / 141 / 142) open with `cmd 0x105 (var 0) == 0`, then `cmd 0x104 var 0 = 1`: the wake is run-once per
  soldier, and later shots rebuild no brain (test_shot_volumes 7; mutant 0x105 -> 0 caught). No PCSX2 trace
  (#51 must first be woken by trigger 90; not in the save). Open: 46-49 were active at the save, so their
  var 0 may already be 1 there, while the page starts it at 0.

## Wake ops, manager events, #67's no-push bit, the save's soldiers (worker 0157, 2026-10-31)

Dan on e3480ee: "Does this match exactly how the game manages it?" The three enemy-side stand-ins:

- **Ops 37 / 39 / 40 (D).** Handler table 0x4a2f60 (8-byte pointer-to-member entries): 37 = FUN_00370af0
  pushes (function data + imm x 8, type 3); 39 = FUN_00370cb8 pops (FUN_0036fe98) then FUN_00326298(7);
  40 = FUN_00370ce0 = FUN_00326298(7). FUN_00326298 only reads DAT_0046e298 bit 7 (MIPS checked), the
  result is dropped: a debug print compiled out. Script 127 event 2's data block holds "path_Sol31".
  Translated (runEvent); op 37 pushes `{ ref: imm }` (ai.json has no data blocks; only cmd 0x141, not
  translated, consumes one: script 108 event 3).
- **Cmd 0x142 (D)** FUN_005661e8 (MIPS 0x566818): skip when FUN_00566198 (dead, status +0xc bit 1 clear)
  and r1 == 0, or when actor state 0xf-0x11 (unsigned) and r0 in 2 / 3 and r1 == 0; r0 >= 0x100 -> 2;
  FUN_0055b8e0(a, r0, 0, 0). enemy_ai `cmd142`.
- **Cmd 0x131 (D, not ported).** Unless FUN_00566198 and r1 == 0: FUN_0055a6d8(a, r0, 0, -1). With a body:
  path = FUN_00311120(r0) = stage section 9 (stride 0x20: +0 node count, +4 first node, +8 flags (bit 0
  loop, bit 3 -> mover 0xe path instead), +0xc speed, +0x10 length). FUN_00352cb8: C+0x310 = path,
  +0x314 = start node, +0x318 = last node (or -1 when looped). Then turn mode 6 if targeted with
  C+0x590 bit 24 else 5 (FUN_0034e960), and FUN_0034edf0(C, 1): C+0x210 = path speed, C+0x328 = summed
  segment length (FUN_003217e0 node +0x18), mover C+0x300 = 1. Per frame FUN_0034f8c0 case 1 =
  FUN_0034fad0: on arrival (C+0x1c4 bit 2) node++, done at the last node, else FUN_0034f4a0 aims at the
  next node. Records 46 / 47: path 5 (9 nodes, flags 4, speed 0.4) / path 8 (8 nodes, 0.4). The page has
  no stage paths and no soldier locomotion (same gap as the action layers), so they stand: warned.
  Next job if wanted: export section 9, port FUN_0034edf0 case 1 / FUN_0034fad0 / FUN_0034f4a0 / the
  path branch of FUN_0034c388 and the walk motion, and trace a shot over trigger 77 with
  TRACE_ENEMIES=7 to check 46 / 47 per frame (no such trace exists: in k_enemy_engage8 46-49 / 66 stay in
  mode 0, mover 0).
- **Manager events (D).** FUN_0053fbe8(mgr, type, id) appends to manager +0x1268 / +0x126c; FUN_0053fde8
  (last call of the manager frame FUN_0053b500) drains it, switch on type + 1. Type 7 (cmd 0x108, if the
  object is now active) -> script event 3, then +0x28 &= ~0x100000 (FUN_00559748 sets that bit on every
  activation). Type 8 (0x109 / 0x130) -> script event 4, then FUN_0053be88(0) if the object is manager
  +0x10ac. This was the "manager event 7, consumer not decoded" gap. enemy_ai `postManager` /
  `drainManager` (end of tick). Every 0x108 activation on the page now runs event 3 that frame.
- **#67's +0x118 bit 0x10000000 (D).** Script 109 (record 45) event 3: cmd 0x1a5(1), then cmd 0x14c(28) =
  FUN_005661e8 case 0x14c (+0x118 |= 1 << r0, r0 < 0x20; 0x14d clears). Also in scripts 132 / 133.
  Translated; record objects keep +0x118 into their activation.
- **The save's seven (D values).** Read straight from sea-of-flames.p2s (object table
  *(DAT_0046e880+0x1164)[rec + 22]): +0x104 = 1 2 1 1 2 2 1 (44-49, 66), +0x118 = 0, 0x10000200, 0, 0, 0x200,
  0x200, 0, vars +0xa0 all 0, +0x28 = 0x208403 (0x100000 clear: event 3 done). play.js `AWAKE_F118`;
  the vars default already matched, so the first wake of 46-49 is the game's (not a re-run). What
  activated 45-49 / 66 before the save: still open after a second attempt (FUN_0053d888 activates a
  record with event 3 via vt+0x144(1, 1), called from FUN_00518760; not tied to these records).
- Tests: test_enemy_ai (46 / 47 wake, ops 37 / 39 / 40, 0x142 rules, 0x14c / 0x14d, manager events,
  0x108 on record 45), test_enemies_page step 1 (page = save for +0x118 / vars; #67 not pushed). 20 mutants,
  19 killed; survivor = 0x142's own >= 0x100 clamp (equivalent: FUN_0055b8e0's translation clamps too).

## Where the push enters the step, and the f827 stop (worker 0158, 2026-10-31)

- **Decoded at runtime.** FUN_0034c388 mode 0xc passes the step to FUN_00358fb8(body, &step) (Ghidra drops
  a1) -> body+0x30; FUN_003590c8 case 0: disp = body+0x40 x step -> FUN_00357d48(body, disp), which calls
  FUN_0035a440(body, out, in) at 0x357e30 when body+0xac bit 1 or 2. Near its end (0x35bdb0) FUN_0035a440
  does `if (flags bit 4 && |body+0x80| > 0) correction += body+0x80` (with wall / object contacts, through
  FUN_00260e28 first), then `out = in + correction` and returns 1. body+0x80 = C+0x430 = FUN_00343160's copy
  of actor +0x130. Ghidra writes it as `pauVar41 + 8` (16-byte units), so the 0x80 / 0x430 offset searches
  could never hit it. FUN_00357d48 then caps |out| at 10 (bit 0x200, no platform body+0x180) and sets
  body+0x30 / +0x40 = out (scaled to |body+0x40| when longer). player.js `pushIn`.
- Runtime evidence (k_push17, call log `pushstep`): out - in - push <= 1e-4 on every frame f800-f960, standing
  included (in 0 -> out = push 0.58). Poking the push scale DAT_0046e90c = 0 removes the slow-down near #66
  (up to 5.9 u) but not the stop; FUN_0035a440's object pass off (DAT_0046f4d0 = 1) changes nothing.
- **The f827 stop is the walk mesh's 0x80 edges.** FUN_00357d48 l.396 makes a 0x80 neighbour a wall when body
  flag bit 9 (0x200) is set, and Vincent's flags are 0x236. The page walked him as a non-block80 body: 0.5 u off
  along the railing (z -1104.8) from the game's position with the game's step, and ~3 u past the stop. With
  block80 the page's step from the game's position is within 0.0008 u on f801-f960.
- For play.js / test_enemies_page (worker 0157's files): **test 1c ("idle beside #66 ... game: held in place")
  now fails by design**. Under the decoded rule an idle Vincent overlapping a soldier is pushed until the
  overlap ends (the page: 0.99 u, then push 0); in k_push16 only the 0x80 wall east of him held him. 1c should
  expect that (e.g. moved > 0 and the final push ~0, or the centres >= r_i + r_j apart), or idle him against
  a wall as k_push16 does. No play.js change is needed (ctrl.push is set before ctrl.step as before).

## Path walking (worker 0159, 2026-10-31)

Dan: "go ahead with soldier walking". Part 1 = the stage-path walk of cmd 0x131 (pathfinding is a later job).

- **Data.** Section 9 = paths (0x20 B: +0 s16 node count, +2 s16 (not read by mover 1), +4 first node, +8 flags,
  +0xc spline TENSION, +0x10 length), section 10 = nodes (0x60 B: +0x14 flags, +0x18 segment length, +0x20..+0x4f
  rows, +0x50 position). export_web_triggers.py writes ai.json `paths` (all 136) and per record `speed` (status
  +0x70 = parameter set +0x38 x 10, FUN_003153d0; 50 for every z128 e027). Worker 0157's "speed 0.4" is the
  tension (FUN_0034edf0 copies +0xc to C+0x210, which only FUN_0025fcc8 / FUN_0025fd58 read).
- **Start** (FUN_0055a6d8, not path flag bit 3): FUN_00352cb8 (C+0x310 path, +0x314 node 0, +0x318 last = n - 1 or -1
  looped), turn mode 6 when the AI has a target and C+0x590 bit 24, else 5 (FUN_0034e960 -> FUN_0034dc50 case 5:
  C+0x2c0 = facing, C+0x21c = -1), FUN_0034edf0(C, 1): C+0x210 tension, C+0x328 = sum of node +0x18, C+0x32c =
  C+0x1d0, t = 0, mover 1, then FUN_0034f178 (C+0x1c4 bit 4) -> FUN_0034f4a0.
- **Segment** (FUN_0034f4a0): path flags 4 (bit 2 set, bit 1 clear) -> always a spline: C+0x100..0x13f = node
  positions i-1, i, i+1, i+2 through FUN_003217e0 (not looped: -1 -> node 1, >= n -> n - 2), gated on
  FUN_00310c40 = G+0x64 = 48 > 8; then FUN_0034db80(C, 9) -> FUN_0034bd10 case 9: chord |P1 - P2|, polyline
  count 0x20 (or chord x 10 + 2 below 3 u), FUN_00353480 samples FUN_0025fcc8 (cardinal basis) into C+0x3a0 and
  cumulative lengths C+0x3a4; duration = arc / C+0x1d4 (C+0x1c0 bit 0). The clock keeps its remainder across
  segments (C+0x1c4 bit 4 set by FUN_0034f178).
- **Every frame** (FUN_0034ea18): FUN_0034f8c0 -> FUN_0034fad0 (on arrival bit C+0x1c4 bit 2: node++, done at the
  last node) -> FUN_0034c388 mode 9 (arc = length x t / duration, lerp on the polyline, direction = the spline
  slope FUN_0025fdf0 normalised, ground speed = C+0x1d4) -> t += DAT_0046e290 +0xc (0.02 s, T) -> FUN_0034d870
  at t >= duration (mode 0, arrival bit) -> FUN_0034de50 case 5 (facing := move direction: FUN_00323318(1.0) = 1
  at step 1.2, then FUN_0034a5a8(C, 1) keeps it level with C+0x1c0 bit 8). No ground drop in mode 9: the walk
  follows the path's own heights (T: y matches).
- **End.** The last arrival stops the mover (FUN_00352a60) before the move, so the soldier stays at the last
  evaluated point (46: 0.65 u, 47: 0.58 u short of the last node, T). FUN_0034f8c0 sends the body listener
  (C+0x540 = actor +0xc0, vtable 0x58e1e0 -> FUN_005690c8) event 2 -> FUN_00588550 jump table 0x591ef0 case 2
  (0x588678) -> FUN_0053fbe8(manager, 0xf, id) -> FUN_0053fde8 case 0x10 -> script event 0x13. Scripts 127 / 128
  event 19: cmd 0x193 (target the player), 0x143(1) (AI mode 1), ... so they turn on Vincent and fire (brain1).
- **Motion.** State 2's motion 3 (FUN_00593e70) requests row 1 (r_gst) on its first update and, once C+0x1d8 > 0,
  returns 8. Motion 8 (FUN_00594f98) installs the table rows 1 / 9 / 0x10 (r_gst / r_gwk / r_grn), thresholds 0 /
  30 u/s, root speeds of entries 1 / 2; FUN_00343160 runs FUN_00346860 (choice: 50 u/s -> r_grn, flags 0x87) and
  FUN_00346c10 (rate s / root clamped [0.9, 1.0] for the run: 50 / 49.35 -> 1.0 -> MP+0x40c 0.5). Standing again ->
  blend 0x14, back to 3. T: r_gst at the wake, r_grn two frames later, r_gst after the end (both soldiers).
  The flinch's phase 2 now returns FUN_00341b20 (3 / 6 / 0x16) instead of ending the motion, so a soldier hit on
  his walk picks up r_grn again (test_enemy_hits 'hits on the path walk'; worker 0160).
- **Trace.** The intended wake (a shot over trigger 77 from the ladder top) can't happen in the game: in four runs
  every shot's aim ray (CAM+0xa0) hit a wall ~95 u out at (-1036, -163, -1056), whatever the pitch. The page's bullet
  from the same spot does reach 77 (test_enemies_page 9): a page collision / aim gap, not chased. Instead
  `TRACE_POKE=9540a4=6e,10a2140=6e` gives trigger 95 (crossed at f783 on k_lock14's route) trigger 89's walk-in
  script 110 (object +0x34 and record +0xa0), which wakes 46 / 47 with the same commands. Script
  tools/trace/scripts/w159_walk95.json, `TRACE_FIELDSET=path TRACE_ERECS=46,47 TRACE_ENEMIES=2` (new field set:
  mover / move / clock / turn per soldier). New opt-in `TRACE_LOG_AT=<hex>` moves the log start for scripts over
  1024 frames.
- **Pathfinding notes for the next job** (mover 2 / 0xd, FUN_0055a628 / FUN_00353110): FUN_0034edf0 case 2 / 0xd
  needs DAT_0046e878 +0x10 (a nav graph) and keeps a node list at C+0x3a8 (u16, -1 ended; C+0x316 / +0x318 indices);
  FUN_00352a60 case 2 walks that list decrementing each node's +0x1d byte (FUN_00310f50: an occupancy count?) and
  calls FUN_00368398(DAT_0046e290 +100, C+0x310 bits 44-47) once; FUN_0034f8c0 sends the listener event 4 with the
  node from that list at the end; FUN_005690c8 case 4 / 5 -> FUN_00563a50(node). Mover 2 per frame = FUN_0034fbb0.
- **Review fixes (worker 0160).** Per frame FUN_00343160: motion update (vt+0x24, returns the next class) -> body
  FUN_0034ea18 -> the table step FUN_00346860 / FUN_00346c10 only when it returned 0, else FUN_00341780 (leave, FUN_00345678,
  enter). Motion 8: vtable 0x5a6790 (enter 0x594f30 empty, leave FUN_00594f38 = FUN_00345b58(C, 0, 0, 0) + clear C+0x564
  8 / 0x10); motion 3: enter 0x593dd0 (C+0x564 &= ~0x4000, FUN_003419e0(C, 0)), leave 0x593e08. So at the path end
  (f897) the body stops after motion 8's update, the table picks r_gst (pushed, MP+0x448 T), f898 8 -> 3, f899 3's row-1
  request is dropped by the MP: FUN_005a91c8 skips a flags-0x80 request whose clip is on the top layer; the aimed
  FUN_005a9398 also compares the partner (+0x208; plain layers store 0), which is why k_fire_emp15 #67 pushes r_st_a twice.
  Rate clamps C+0x768..0x774 = 0.1 / 1.1 / 0.9 / 1.0 (FUN_0033ff18). FUN_00565bd0 resets C+0x1d4 by gait (0: status
  +0x70, 1: x 0.4 FUN_00317660, 2: x 0.2) and C+0x45c bit 3.
- Tests: test_path_walk.mjs (mover alone and the AI world vs w159_walk95, MP pushes vs MP+0x448, hand cases), test_enemy_ai
  '46 / 47 wake' (path start events), test_enemy_hits 'hits on the path walk', test_enemies_page 9 (46 / 47 walk, stop
  within 0.01 u of the game's stops (measured 0.005 / 0.007), r_grn drawn at 0.6 frames / game frame, AI mode 1 after;
  its wake through trigger 77 is page-only, see the audit).

## Nav graph and search, mover 3, action layer 3 (worker 0161, 2026-10-31)

Part 2 of soldier walking. **What the game does here** (trace w161_chase: w159_walk95's wake with scripts 127 / 128
event 19 putting 46 / 47 in brain mode 5, `TRACE_POKE=...,1005350=5,10060dc=5` = the cmd 0x143 argument 1 -> 5;
`TRACE_PATH_BODY=1`): within 10 frames of mode 5, action layer 2 sends both on **mover 0xd** (nav-graph path) at
50 x 0.3 = 15 u/s (FUN_00351928's C+0x1c0 bit 4 scale), body flags 0x280036 (bits 19 / 21 from C+0x1c0
0x1000000 / 0x4000000, mode 5's start); ~100 frames later state 6 -> 7 (Vincent not in view) -> action layer 3,
again mover 0xd (Vincent 260-310 u away). Every request is mode 1 (flags 0x77 / 0xef, max 10, c 100) and is
re-made each AI run (interval 10) while the layer stays in its state.

- **Graph** (FUN_0033ef48 -> FUN_0033d918; needs G+0x64 >= 0x13): section 7 header (+2 count), 5 nodes (0x20 B:
  words 0-2 low 24 bits / 256 = x y z (EE psllw / psraw 8, vitof12, x16), +7 s8 link count, +0xc u16 first link,
  +0xe area, +0x10..+0x1b cover masks, +0x1d paths holding it, +0x1e actors on it), 6 links (8 B: +2 neighbour, +4
  cost x 100, +5 flags: 1 closed, 2 +100, 0x10 vertical). z128: 4237 nodes, 24900 links (72 closed). Graph vtable
  0x4a18b0: +0x14 0x33e540 neighbour, +0x1c FUN_0033e5d0 open (flags & 1; 0x11 below G+0x64 0x2c), +0x24 0x33ee38
  goal test, +0x2c FUN_0033e660 cost, +0x34 0x33ec98 heuristic (the three hex ones are not Ghidra functions).
- **Search** (service DAT_0046e290 +100: pool 3000 records, queue 1): FUN_003682e8 sync / FUN_00368250 queued ->
  FUN_00369d88, then states FUN_003692e0 (start record, goal test at depth 1) / FUN_003693c0 (current = open head) /
  FUN_003693f0 (one link per call: closed list skip, g = g + cost, better g in the open list re-sorts, else a new
  record with depth + 1 under the cap max - 1, goal test **when generated**; at the cap the test runs on the
  current record) -> FUN_00369f40 (list start..record, -1). Open list FUN_00369788: by g + h, a new record after
  equal ones. Request (C+0x330): +0 start (actor +0x108), +2 goal, +4, +6 max, +8 mode, +0xa flags, +0xc c.
  Mode 0 (and >= 7): to the goal, h = distance; 1-6: goal test = further than c from the start after 3 links, or
  the cap; h 0 for 1 / 2 / 5, -distance for 3 / 4, distance for 6. Cost: link cost / 100, flags 2 / 4 x20 / x10
  the neighbour's +0x1e / +0x1d, link flag 1 +1000 / 2 +100, vertical links +1 with flags 0x20 (up) / 0x40 (down)
  else +1000, 0x80 climbing away from the goal +10 / +100 (+30 vertical), modes: 1 + rand x 10 (FUN_0040b5c0), 2
  | |goal - n| - c | x 0.1, 3 -|goal - n| x 0.1 (+20 nearer), 4 / 5 | |goal - n| - |start - n| | x 0.05, 6 +5
  further from the goal. **MISSING:** flags 8 / 0x10 = FUN_0033fa58 (both nodes' cover masks by yaw sector,
  FUN_0033fc50 / FUN_003724b0).
- **Nodes of actors.** FUN_00563970(a, -1): FUN_0033daf0(40, G, pos, 0, 1) (nearest within 40; grid branch over
  section 12 not decoded) or FUN_0033dda8 from the last node; FUN_00563a50 moves the +0x1e count and sets
  C+0x398. Goal nodes: FUN_00563d20(target, 1, 1) = a random free neighbour of the target's node (FUN_0040b5c0).
- **Callers.** Action layer 2 (FUN_00366390) / 3 (FUN_003667b0): same area (+0xe) -> FUN_00368120 (queue free) ?
  FUN_0055a590 -> FUN_00352f18 (mode 0, max 0x80, flags 6 | 0x60, queued) : FUN_0055a628 (mode 6, max 7); else
  FUN_0055a628 (mode 1, max 10). FUN_0055a628: FUN_00316cf8 alive, FUN_00563970, copy the request + start,
  FUN_0055a4e0 (turn 5 / 6), FUN_0034edf0(C, 0xd) (C+0x1c0 |= 0x6000, list cleared) -> FUN_0034f178 case 0xd
  (move mode 0xc, body flags from C+0x1c0 bits 24-26).
- **Mover 0xd per frame (FUN_00351928), decode notes, not translated:** follow states in C+0x314: 0 request (sync
  if +0xa bit 0), 1 wait for the queue, 2 list length -> FUN_00353700, 3 first leg (one node: walk at it; else at
  the midpoint of nodes 0 / 1, FUN_002611f4 0.5), 4 per frame: steer at the corner blend of the current / next
  nodes (< 45 deg FUN_00261038: midpoint; else by the fraction along), FUN_0034b200(1.0 or 0.3 with C+0x1c0 bit 4),
  next node when within 5 u (and the next leg not longer), listener event 5 (node), 0x10 links (FUN_00352788 /
  FUN_003528d8: climbs / drops), 5 last node: within 3 u and |dy| < 10 -> done (listener event 4). The VU
  values the decompiler drops there are the node positions read just before (FUN_00310f50).
- **Mover 3** (FUN_003504b0; started by action layer 3 with Vincent in view within 100 u, d34 >= 20):
  FUN_00353110(20, 1000, C, target), FUN_0034edf0(C, 3) (C+0x1c0 |= 0x6000), FUN_0034f178 case 3 (FUN_0034b230(0),
  FUN_00356d98 body at C+0x30, move mode 0xc, body flags |= 0x300000). Per frame: horizontal direction to the
  target, scale 1 beyond lo + 25 / 0.3 + (x - 20) 0.14 / 0.3, FUN_0034b200 (C+0xcc = C+0x1d4 x s / 60); ends outside
  [lo, hi] -> FUN_00352a60 case 3 (body flags &= ~0x380000, turn mode 8 -> 0, FUN_0034b110(0)). Move mode 0xc
  (FUN_0034c388): body+0x30 = C+0xc0 x C+0xcc, FUN_003590c8, C+0x1d8 measured (bit 13), C+0x90 measured (bit 14).
- **Body step limits** (FUN_003590c8, flags bit 5): bit 19 vector change <= body+0xc4 dt, else bit 20 speed change
  <= that; bit 21 turn <= body+0xc8 dt (FUN_0025a560 slerp, FUN_002611f4 when a vector is 0). Soldiers: +0xc4 2.5,
  +0xc8 4 pi (T). Then FUN_00357d48 may rewrite body+0x40 to the contact-corrected move at that speed.
- **Action layer 3** (FUN_003667b0) translated except its nav-graph branch / state 2 (the request is left out, so
  the layer stays in state 1, as when the game's request fails). Layer vtable 0x4a29c8: end 0x367ac0 = free, start
  0x3667a8 empty, update FUN_003667b0; FUN_00365110 runs brain, action layer (+0xe4), combat layer (+0xe8).
- **Page effect:** a mode 5 soldier in state 7 / 8 with Vincent in view within 100 u now walks at him (walk mesh,
  15-50 u/s) and stops inside 20 u; brain 5 then goes to the melee pick at d34 < 25. Beyond that, or out of view,
  he still stands (mover 0xd). No aimed-walk clip yet (r_wk_a family not decoded).
- **Review fixes (worker 0162, 2026-10-31).** (1) Move mode 0xc never runs bodyFrame (move mode 9's polyline):
  FUN_00352a60 leaves mode 0xc after mover 3, and a later flinch / death slide crashed (no spline) or snapped back
  onto a leftover path spline. Slides in mode 0xc now take the page's slide stand-in (GUESS: the game walks them
  on the mesh through mode 0xc), the body takes the slide's velocity and the polygon under it. Turn mode 5 now runs
  after the mode-0xc move as in FUN_0034ea18. (2) The nav branch of state 1: FUN_00563970 (soldier's node),
  FUN_00563d20 (goal, one FUN_0040b5c0 draw when the target's node has a free neighbour), the area test and
  C+0x1c0 |= 0x10 (mode 1 path, set even when the request fails) are translated. Where FUN_0055a628 / FUN_0055a590
  would succeed (alive, has a node) it starts mover 0xd through FUN_0034edf0, whose FUN_00352a60 ends mover 3:
  the page ends the mover (MISSING: mover 0xd) and stays in state 1, so a soldier no longer walks at Vincent out
  of view. MISSING: Vincent's node (+0x108) is not tracked on the page, so the goal is -1 and the draw never happens
  (the random stream drifts). (3) The page never reaches state 2 (mover 0xd). There the game re-approaches only
  with Vincent visible in the 30 / 40 deg cone with d38 < 150 and dy > -25, or d38 < 10 with bit 18 clear; the page's
  state 1 rule (visible and d34 < 100, any direction) starts mover 3 in cases where the game would keep walking
  its path. (7) moverStop's `a.face` condition is gone (FUN_00352a60 has none).
- Tests: test_nav_graph.mjs (hand A* cases, the trace's 40 requests), test_approach.mjs (FUN_003504b0 / limit hand
  cases, |body+0x40| vs the trace, the AI world walk-in, 15 u and out-of-view cases). Trace fields:
  tools/trace/README.md 'Soldier path walk' (TRACE_PATH_BODY).
- **Next:** mover 0xd (FUN_00351928 + FUN_00353700 + the 0x10-link helpers), the queued search budget (FUN_00368250
  service update), FUN_0033fa58, then action layers 2 / 5 / 6 / 7 on top. Exact list checks need a mode-0 request
  (FUN_00352f18: no random term) or the RNG logged in the trace.

## Mover 0xd, action layers 2 / 3, nodes (worker 0163, 2026-10-31)

Part 3 of soldier walking: the nav-graph path follower, wired to action layers 2 and 3.

- **Frame order** (FUN_00323128): the search service FUN_00368420, the AI FUN_00365008, the actors FUN_0053b500
  (the player tick sets Vincent's position), the bodies FUN_00348fe8 (movers). enemy_ai.js tick follows it.
- **Nodes.** FUN_00563970 runs when an actor's position is set (vt+0x234; soldiers FUN_0055ef78 with +0x28 bit
  0x10, Vincent's FUN_00573c60 (vtable 0x58f128) calls it first; his +0x28 = 0x20901f in the save). Known node ->
  FUN_0033dda8: the node and its neighbours (every link) scored by sqrt(dx2 + dz2) + 2 |dy| (one VADDz), under 40
  -> best, else FUN_0033daf0, else the old node. T: 558/558 soldier frames. Spawn (FUN_00559748 tail):
  FUN_0033daf0(50). Vincent's node in w161_chase = 111. GUESS (when): every frame for all.
- **Requests.** Layer 3 state 1 (0x366908): same area -> queue room (FUN_00368120) ? FUN_0055a590 (FUN_00352f18:
  mode 0, +4 2, cap 0x80, flags 6 | 0x60, c 0, queued) : FUN_0055a628 mode 6 (+4 4, cap 7, flags 0x87 | 0x60);
  else C+0x1c0 |= 0x10 and mode 1 (+4 6, cap 10, flags 0x8f | 0x60 = 0xef; +4 / cap are immediates at 0x366a6c / 0x366ad8, not the floats Ghidra shows); c 100; started -> state 2. Layer 2
  state 0 (target out of view): same area -> queued / mode 6 (+4 4, cap 7, flags 7 | 0x60), state 1; else mode 1
  (+4 6, cap 10, flags 0x17 | 0x60 = 0x77: the trace's) and the state stays 0. FUN_0055a628: alive, node ->
  FUN_00353080 (stop, FUN_00369040, clear), copy (start = node), FUN_0055a4e0 (turn 6 with target + gun, else 5 +
  C+0x1c0 0x8000), FUN_0034edf0(C, 0xd) (list[0] -1, C+0x318 0, clock 0, slot 0xf, len 0, C+0x1c0 |= 0x6000,
  climb 0, C+0x316 -1) -> FUN_0034f178 case 0xd (state 0; enter mode 0xc; C+0x45c bits 19-21 from C+0x1c0 24-26).
- **Search service** (DAT_0046e290 +100, save RAM): +0 40 steps per update, +4 1 slot, pool 3000. Queued
  (FUN_00368250 -> FUN_00368900 slot, FUN_00369d88 list[0] = -1); FUN_00369e40 per frame: up to 40 calls, a call
  that finds the search done writes the list, frees records and slot. Mode 1 / 0xef / 0x77 have bit 0: sync.
- **FUN_00351928** (C+0x314): 0 search (sync -> 2, queued -> slot, 1); 1 wait for list[0] != -1; 2 length (< 0xff),
  state 3, FUN_00353700 (+0x1d up); 3 one node: walk at it (state 5) else at mid(0, 1) (state 4; FUN_0033f850 on
  link 0 -> end); 4 leg list[i] -> list[i+1]: on the ground, vertical link (0x10, no bit 22) -> FUN_00352788 else
  FUN_003528d8 (stuck: bit 18, 61 frames within 1.5 u -> link flags |= 2, end); the actor's node C+0x398 must be
  a leg node or openly linked (FUN_0033f650) else end; target: FUN_00261038(A - p, B - p) < 45 deg -> mid(A, B)
  (B with bit 18 and C+0x1d8 = 0), else by fr = |A-p| / (|A-p| + |B-p|): < 0.5 lerp(A, B, fr + 0.5), < 1
  lerp(B, N, fr - 0.5), else N; next node when |B - p|xz < 5, or past the corner (|A-p|xz > |N-p|xz and > |B-p|xz),
  or fr > 0.5 (the FUN_002614f4 test: returns -Q = -1, always true), and |dy| < 10: event 5 (list[i]), clear link
  bit 2, i++, FUN_0033f850 on the next link (end), steer at B (mid(B, B)), state 4 or 5 at the last leg; 5 last
  node: within 3 u xz and 10 u dy -> end. Steering FUN_0034b200(1.0 or 0.3 with C+0x1c0 bit 4, 3D unit). Every
  "end" returns 1: FUN_0034f8c0 -> FUN_00352a60 case 0xd (+0x1d down, pending queue job cancelled, list[0] -1,
  C+0x45c bits from C+0x1c0 24-26) and listener event 4 with list[len - 1] (read after the stop).
- **Listener** (FUN_005690c8): 5 -> FUN_00563a50(node) + manager 0x12 -> script event 0x27 (node); 4 ->
  FUN_00563a50 unless -1, manager 0x11 -> script event 0x26 (FUN_00588550 cases 0x5886c0 / 0x5886d4).
- **Layer 3 state 2**: cone (FUN_0035e9b0: |yaw| < 30, |pitch| < 40 deg) with d38 < 150 and dy > -25, or d38 < 10;
  bit 18 clear; in view when d38 >= 50 -> mover 3, state 3. Else within 0x709 ticks or while the path has a last
  node (FUN_0034aa28): mover 0 -> state 0; target > 30 u from that node and d38 < 60 -> turn 6, state 1. Else
  time reset, state 0. C+0x1c0 bit 20 -> FUN_0055a828 (FUN_003533e0: mode 0xc C+0x1d0 = -1 + FUN_0034b110(0),
  FUN_00352a60, mover 0), turn 6, state 4.
- **Layer 2** (FUN_00366390; vtable 0x4a29f8): see enemy_ai.js `action2`.
- **Also fixed:** FUN_00352a60's tail keeps move mode 0xc (FUN_0034b110(0)); the page zeroed it. The heuristic
  skips the distance for modes 1 / 2 / 5 (a mode-1 request may carry goal -1).
- **Numbers vs the game (w161_chase):** node tracking 558/558; follow state 518/518; wanted move 516/518 (2 frames
  where the game's move is 0 after the mover: writer not found); closed loop with the game's lists fed in worst
  1.45 / 4.37 u (46 / 47): FUN_00357d48's body+0x40 rewrite (not translated) makes the page's body turn faster.
- **Page:** record 70 (damage script -> mode 5) shot with Vincent 251 u away walks 246 u on the graph (layer 2 /
  mover 0xd, then layer 3 / mover 3 in view) and starts his melee (actor state 0x80) at 19.9 u. Whether the swing
  connects needs the hit volume (FUN_00541310, not decoded). Record 69 is placed at y 0 (no walk polygon): he
  cannot walk on the page (placement question, not chased).
- **Layers 5 / 6** (FUN_003670e8 / FUN_003672d8, both small): no target / busy -> 0; state 0: soldier node + the
  target's node (+0x108 as is) -> one request, +4 3; state 1 waits for the mover to end -> 0. 5: mode 3 (away from
  the target), c 150, flags 0xe | 0x60, queue room -> cap 0x14 + (int)(r x 11) queued, else | 1, cap 7 + (int)(r x 3);
  state 1 only if started. 6: C+0x1c0 bit 4 cleared, mode 2 (cost | |goal - n| - c | x 0.1: keep the distance),
  c = d34, flags 0xe, queue room -> cap 10 + (int)(r x 6) else | 1 cap 5; then (int)(r x 11) < 8 -> bit 4 set (0.3
  speed); state 1 always. So in view at range brain 5 fires and repositions (states 6 / 12 / 13 / 5); it closes in
  only through states 7 / 8 (layer 3) and melees inside 22 u. Node sim (page LOS), record 70: from 177 u melee at
  frame ~550; from 218 u he drifts out to ~325 u first and swings at ~1450-1490.
- **Fixed on the way:** enemy_ai.js already used C.req as the motion-request counter; the nav request is C.nreq.
- MISSING: the vertical-link jump (FUN_00352788 -> FUN_0034a8e0), FUN_0035fe08, layers 1 / 4 / 7 / 0xb, the cover
  cost (FUN_0033fa58), a trace of the in-view case. GUESS: FUN_0035ef18 = 0x60.
- Tests: test_nav_walk.mjs (new: hand cases, node tracking, open / closed loop vs w161_chase), test_approach
  (updated: out of view -> mover 0xd; Vincent's tracked node and the goal; after the approach layers 5 / 6 move
  him), test_enemies_page 10 / 10b. Flake: step 10 required HP to drop; a hit's damage / flinch are random (one run
  had HP unchanged and no flinch), now it checks the mode change. 26/26 mutants killed.
- **In-view trace k_inview17a-e** (worker 0163). k_enemy_engage8's route without shots, f784 wake of #66 / #67
  (records 44 / 45) with TRACE_POKE turning every 'AI mode 2' in scripts 108 / 109 into 5 (ffbab0, ffbd90, ffbea8,
  ffc428, ffca08, ffcc58, ffcd70, ffd2b0: argument words found by matching each event's bytecode in save RAM; the
  same method gives 0161's 0x1005350). Vincent stands in view: #66 31 u, #67 118 u. Five 299-frame windows
  (f780-2278; env in the scripts' doc). Game: both cycle 6 -> 12 -> 13 (layer 6) -> 5 -> 6; layer 6 requests (12)
  all mode 2, +4 3, flags 0xe, cap 10-15, goal 111 (Vincent's node), c = AI +0x34 exactly; bit 4 / 0.3 speed on
  most walks, full speed on some; aimed walk clips r_wk_a / r_lwk_a / r_rwk_a / r_bwk_a / r_rrn_a (not ported).
  #66: 7 -> 8 at ~60 u (f1323), layer 3: one mode-6 request (+4 4, cap 7, flags 0xe7, c 100), then mover 3, state
  10 at 20.0 u, melee r_atk_0 at f1455 and again f1803, then 14 -> 16 (layer 5: mode 3, +4 3, flags 0x6e, c 150,
  cap 20-27; 5-frame paths, re-requested every ~12 frames) -> 5 -> 6. #67 stays 70-120 u for all 1500 frames: his
  layer-6 paths toward Vincent's node cross an 11 u drop (nodes 133 -> 136); he turns back and the node check
  ends the path (f1545 / f1652). Page vs game: the follower on the game's own list reproduces this (node changes
  f1576 / 1601 / 1639 vs 1576 / 1606 / 1651, end f1640 vs f1652, 0.37 u); the port's search gives 13 / 21 of the
  game's mode-2 / 3 lists exactly (empty occupancy, no cover cost); the others part at one near-tie, which the
  occupancy (flags 2 / 4) and cover (flags 8, MISSING) terms decide. A node sim from the same start reproduces
  the cycle and requests; its #67 took the other branch and walked in to melee (f1208). The page also re-ran the
  soldiers' wake when their own bullets crossed trigger 75 (FUN_0035f268 resets the brain state, as the game's);
  the game run's bullets didn't cross it. Fixed from the trace: layer 3's request +4 is 4 (mode 6) / 6 (mode 1).
  test_nav_walk section 6.

## Review fixes: nodes given back on hit / death / switch-off (worker 0164, 2026-10-31)

- **Hit / death during mover 0xd leaked the path's nodes.** slide() / die() stopped only movers 1 / 3, then
  overwrote C.mover, so mover 0xd never ran its stop: each list node kept its +0x1d count (+10 cost in every later
  search with flags 4) and a queued search kept the single service slot and later wrote into C.list. Fixed as the
  game: FUN_0034edf0 calls FUN_00352a60 for any non-zero C+0x300 (slide: PM.moverStop for every mover), and
  FUN_00560fc8 runs FUN_003533e0 (die: PM.stopAll). Both reach navStop (counts back, FUN_00368398 cancel).
- **Switch-off (FUN_00559748 off path):** decoded that it calls FUN_00563a50(a, -1) before FUN_00558bb8, so the
  actor's +0x1e count goes back (enemy_ai `setActive`: setNode(-1)); each 0x108 / 0x109 cycle used to add one.
  The held path: FUN_00558bb8 -> FUN_00588330 only detaches the body (actor +0xe8 = 0, C+0x564 bit 24, which no
  function in the decomp reads); FUN_0054c430 / FUN_00347250 / FUN_00340680 / FUN_00340488 don't touch the mover.
  Where the game gives a detached body's list back was not found in two passes, so the page stops the mover there
  (PM.stopAll): GUESS, audit 'Actor deactivation: everything else'.
- navLeg: a malformed list (list[i + 2] not in the graph) now takes the missing-node warning path (was a throw).
- Cone comment: FUN_00260f54's out[0] / out[1] are compared with 40 / 30 deg; which one is the yaw is guessed.
- Tests (test_nav_walk, new hand cases): flinch / death on a walking path and with a queued search pending
  (counts back, slot free, C.list untouched by later service updates), switch-off + 3 on / off cycles, per-frame
  tracking, event 5's node, closed first link (flags 1), the corner `near` test, the 40-step budget, layer 2's
  queue-room branch and its 'mover ended -> 0', layers 5 / 6 sync caps (8 / 5), layer 3 state 2's bit-20 stop, the
  malformed list. Mutants: the review's 9 survivors + 6 new (slide / die / switch-off stops, setNode(-1), the null
  check, the cancel): 15/15 red. Hooks: world.t gains action2 / navOf.

## Melee hit volume (worker 0165, 2026-10-31)

**Decoded and translated** (enemy_ai.js `makeAttack` .. `attackDamagePlayer`; audit 'Melee hit volume').
- Op 2 -> FUN_003481e0 case 2: record = T +0x24 + arg 2 x 64 (ai.json `attacks[set].volumes`,
  export_web_triggers.hit_volume) -> owner event 4 (0x56a214) -> FUN_00569dc0 -> FUN_00541310 -> attack object
  class 0xd (FUN_0053db98 case 0xd, constructor FUN_00579d00, vtable 0x58f9f0; update vt+0x214 FUN_0057a330).
- Record: +0 type (reaction flags +0xec 2 / 4 / 8 / 0), +1 shape (1 = sphere, vtable 0x58f970), +2 / +3 local axes
  (DAT_0058bab0), +5 / +6 attach (+6 >= 0, +5 0: marker +6 = the model 'mkd' marker table: T(xyz) x bone palette),
  +7 repeat interval, +8 -> +0xc1 (bit 0 every target, 2 repeat, 3 follow the marker), +0xa life (x step), +0x10
  damage, +0x20 local offset, +0x30 radius. z128: e027 zone 7 (r_atk_0): r 5, marker 15 (bone 26 = the rifle) +
  (0,0,3), life 16, damage 50; zone 6 (m_atk): marker 8 (bone 13), life 8; e048 zone sets 3 / 4: marker 8; e030
  set 8: volumes 0 / 3 / 4 spheres (marker 4 / 0), 1 / 2 shape 2 (not translated).
- Damage at the make: (dmg + 0.5) x 0.01 x (W+0x56 + 100) (W+0x56 = 0 for every z128 weapon, ai.json `w56`), then the
  owner's offence FUN_00317ef0 (soldiers: +0x60 0 -> bonus 0; save RAM). At the hit Vincent's defence (kind 1): 49.
- Each update: FUN_0057a428 (first: candidates fresh, FUN_0057a9b8; then FUN_0057aed8 adds new ones): objects with
  +0x28 bit 0, +0x40 bit 6, filter FUN_0055e878 and a horizontal distance from the volume < sqrt(3) x r + their
  radius (13.66 for r 5); then the sphere vs the target's capsule (FUN_0025db68: feet .. feet - 18 y, r 5; past an
  end by e the reach is rc + rs cos(e pi / 2rs)). A hit without bits 0 / 2 ends the object (one hit per swing);
  else life -= step, < 0 ends it. AI +0x7a / +0x60 count hits, +0x76 / +0x58 misses (no reader on the page's path).
  Soldiers are never candidates: +0x188 bit 39 (save RAM) and faction 1 -> 1 is not hostile (DAT_004a0290).
- ?enemydmg: not used. It exists because the bullets' hit test is a GUESS (BULLET_R); the melee path is decoded,
  so a melee hit always damages Vincent. The HUD now says 'bullet damage off'.
- Trace k_melee18 (tools/trace/scripts/k_melee18.json; call-log set `melee`, TRACE_MELEE=1): #66 swings at f1455,
  volume made f1460, life 14.8 / 13.6 / 12.4, hit f1463, HP 560 -> 511. The page reproduces it with the game's
  positions fed in (test_melee.mjs; centre 0.0002 u). A call tagged k runs in the step from record k - 1 to k.
- **MISSING, found on the way:** (1) the lunge: #66 moves 20.0 -> 12.9 u during r_atk_0 (clip root motion, op 0
  bits 0-2 -> mover 8, C+0x310 written in FUN_00343160; audit 'Attack clip root motion'), so on the page a swing
  started at 20 u misses; from 12 u it hits (test_enemies_page 8). (2) Vincent's reaction (FUN_00565480 flags 4:
  state 0x18, pushed back ~0.8 u a frame). (3) shape 2 (e030).
- Tests: `node native/web/test_melee.mjs` (hand cases, data, trace replay; 23/25 mutants killed, the two survivors
  equivalent on z128: test-before-decrement with no growth, P+0x118 bit 5 zeroes the damage either way);
  test_enemies_page 8 (a swing lowers Vincent's HP by 49); test_enemy_ai's mode-5 check without a pose.

## The lunge: attack clip root motion, mover 8 (worker 0166, 2026-11-01)

**Decoded and translated** (enemy_ai.js `rootOn` / `rootSample` / `rootLeave`, path_mover.js `rootStart` / `rootTick`;
audit 'Attack clip root motion').
- Op 0 (FUN_003481e0 case 0), byte 6 bits 0-2 and body mover != 0xe: C+0x568 |= 0x20 (FUN_00340b28(C, 1)); bit 0 ->
  0x40, bit 1 -> 0x100 + FUN_00356248(body, 1) (body+0xac bit 7), bit 2 -> 0x80 (+ FUN_0034e960(C, 8), not translated);
  FUN_0034edf0(C, 8) (stops any mover, C+0x1c4 bit 7) -> FUN_0034f178 case 8 (move mode 0xc, C+0x310 identity,
  C+0x370 0); C+0x568 |= 0x1000. e027 r_atk_0 and m_atk: byte 6 = 3.
- Each frame, FUN_00343160 after the motion update: head layer frame h (MP+0x218 + 0x30 x head), s = (int)(2h) x 0.5
  while (int)(2h) < 2n; root sample M = bone 1's q / t at s (FUN_005ad730 -> FUN_005af980, t / 256); delta D =
  inverse(C+0x6d0) x M (FUN_0026125c(out, A, B) = B x A; FUN_00261144 = affine inverse), C+0x6d0 = M (identity
  from the constructor FUN_0033ff18). Movers 8 / 0xb: bit 6 -> D's translation mirrored along D's row 0
  (FUN_00260e28(-1, t, t, row 0): t - 2 (t.u) u), else x / z 0; bit 7 clear -> rows 0-2 zeroed; bit 8 clear -> y 0;
  FUN_003513c8 -> C+0x310.
- Mover 8 (FUN_00351418, VU from the ELF): w = t x C's rotation (rows (up x face, up, face)), v = w x -1 / DAT_004eeb24,
  y 0; FUN_00356278(C+0x370, body); |v| > 0.01 -> FUN_0034af98(|v|, C, v / |v|) (C+0xc0 / +0xcc) and C+0x370 = 0,
  else FUN_0034b110(0, C). The mode-0xc walk then moves him |v| x step = the world delta.
- Attack motion enter FUN_0059e830: C+0x45c bit 18 set, bit 8 clear, FUN_0034b110(0), FUN_00356278(0). Leave
  FUN_0059e938: C+0x568 bit 5 clear, C+0x310 identity, body bit 7 / +0xa0 cleared, C+0x45c &= ~0x40100; with bit 12:
  FUN_003533e0 (every mover stops), FUN_0034b110(0); C+0x1c0 bit 26 -> C+0x45c |= 0x200000 (the turn limit that
  makes the post-swing coast).
- Rounding: the MP head frame and the attack timer add toward zero (EE FPU). k_lunge166 MP+0x218 = 23.999971 after
  40 frames (nearest: 24.00001); with nearest the double samples land a frame early from f1495 and the attack ends
  at f1509 instead of f1510. enemies.js's layer advance now chops too; player.js's (Vincent) still rounds to nearest
  (audit finding).
- FUN_00261038 (angle, VRSQRT): a zero vector with a -0 dot product gives cos = -max float -> pi; that is what makes
  the turn limit shrink the velocity x (1 - 0.2513 / pi) = 0.92 a frame after the swing (path_mover `angle`).
- The page keeps the MP head as enemies.js plays it in C.mp (set by playClip with the same drop / carry rules,
  advanced at the end of the AI tick); the root track comes from opts.rootTrack (enemies.js -> enemy_hit.js
  rootTrack: local_pose bone 1 + the sidecar's root_motion_per_frame_glb).

**Trace k_lunge166** (tools/trace/scripts/k_lunge166.json = k_melee18's run with TRACE_PATH_LAYERS=1 TRACE_PATH_BODY=1,
f1450-1529). #66 from 20.0 u (record 1454): moves 0.338, 0.409, 0.409, 0.593, 0.593, 1.309, 2.652, 1.345 u (samples 0,
0.5, 1, 1.5, 2, 2.5, 3.5, 4: 3.0 skipped since 5 x 0.59999996 = 2.9999998), a small step back at 4.5 / 5, still,
back with clip frames 22-32 (f1491-1509), then the coast. Page closed loop (game facing fed, walk mesh): bit-exact
x / z, hit f1463, HP 560 -> 511.

**GUESS**: the leave's root part runs at the attack end, before that step's body move (the page's motion switch is
otherwise after the move): k_lunge166 f1510 needs it (audit row). C1C0_STAND lacks C+0x1c0 bits 24 / 26, so on the
page the soldier stops dead after a swing (no coast); test_melee feeds the game's 0x5016311.
**Consequences found:** (1) the swing replaces a running approach mover (3 / 0xd) at the attack pick (< 22 u), as
in k_inview17d f1803 (0xd -> 8); test_approach 3 now expects that. (2) A soldier hit mid-swing loses the flinch
push-back (FUN_00561570 starts mover 9, FUN_00561718's motion switch runs the attack leave, which stops it): decoded
order, not traced. (3) e027 m_atk has no root motion: record 70's swing (test_enemies_page 10) doesn't lunge and hits
from 19.9 u by its own reach (marker 8, bone 13).
**Review fixes for fce6d19**: type > 3 -> 0 (FUN_00579ef0) before FUN_0055eac8's type-3 test; +0x13c signed; the
FUN_00325b40 pause gate cited (GUESS not paused); ENEMY_OFFENCE marked GUESS; tests for dead(P), the P+0x118 bit 31
clamp, both PST.f64 sites, attackCentre with a marker offset, the HUD text, test_enemy_ai's no-pose volume (made,
runs out its life); test_melee's world() no longer edits the shared ai.json.
- Tests: test_melee (lunge replay, k_lunge166 per-frame fields, root hand cases, review cases; 30/30 mutants killed),
  test_enemies_page 10 (mover 8, distance as the clip's root, HP -49), test_approach 3, test_enemy_hits mid-attack.

## Dan's report "they aren't attacking": records 46 / 47 at their path ends (worker 0167, 2026-11-01)

Report 20261101T140820Z-316b: Vincent idle at (-846.75, -144.45, -950.64), a rifle-raised soldier 10-20 u away
that never swings. **The game doesn't swing there either; no code change.**

- **Who.** Path 8 (record 47, script 128) ends 0.7 u from Vincent's reported feet and path 5 (record 46,
  script 127) 18 u from them. Trace w167_timer puts them at (-846.0, -144.6, -950.4) / (-835.9, -148.9, -936.5)
  after the walk. Path end = manager event 0xf -> script event 0x13: 0x193 (target Vincent), 0x143(1).
- **Mode 1 never melees a shooter.** FUN_00362998 calls the attack pick FUN_0035ff98 only in state 8, entered
  from state 0 only when C+0x808 bit 0 is clear (non-shooter). e027 r_* is a shooter, so it runs states 3 / 4 / 5
  (combat layer 2 fire, stand <-> crouch) and never attacks. Same rule as worker 0154's k_push16 (mode 2).
- **Never shot.** Page (headless probe, trigger 77's event 0x12 wake, Vincent put at the reported spot): 46 / 47
  in mode 1, brain states 3-5, r_st_a / r_sq_a, firing, no 0x80+ state. Game (w167_timer = w159_walk95 run to
  f1680, log f1120-1679): mode 1 the whole window, motions r_st_a / r_sq_a only, positions fixed.
- **Shot once.** Script event 8 of 127 / 128 does its work only while var 0 == 0. The wake (event 2) has
  already set var 0 = 1, so a hit after the wake only flinches. A hit before any wake sets var 0, wakes
  46-49 and walks the path, which ends in mode 1 again. Page: flinch (r_stlld0, 105 -> 81), back to
  mode 1, keeps firing.
- **What would make them melee.** Mode 5 (FUN_003639d0: attack pick at d34 < 22). Scripts 127 / 128 set it
  (a) in event 0x29, posted by the big / knock-down reactions FUN_005618d0 / FUN_00561f78 / FUN_00562898
  (stagger 0x44 = the 8th hit inside 60-tick gaps; 46 / 47 have 105 HP and take ~24 a pellet, so they die
  first), or (b) in events 1 / 3 when manager 0xa7 (difficulty 3) is true. The save's difficulty is 1.
  Event 0x13 also sends cmd 0x106 (600; 300 on hard), not translated (audit row). w167_timer shows no
  effect from it by f1679.
- Trace: `TRACE_POKE=9540a4=6e,10a2140=6e TRACE_FIELDSET=path TRACE_ERECS=46,47 TRACE_ENEMIES=2
  TRACE_LOG_AT=A0D80`, script tools/trace/scripts/w167_timer.json (1680 frames; the log start bounds the script length).

## Bullets vs Vincent: decoded, damage on by default (worker 0168, 2026-11-01)

**Decoded and translated** (enemy_ai.js `spreadAim`, `bulletFlags`, `roomProbe`, `enemyBulletHit`, `playerFilter`,
`playerPartTest`, `deflects`, `playerHandler`, `targetPoint`; audit rows 'Soldiers' bullets vs Vincent', 'Soldier
shot cone', 'Bullet room probe', 'C update order', 'Deflect window'). Replaces BULLET_R. Research: enemy-research.md
§11 (worker 0127) had most of the path; what was missing was Vincent's part boxes, his pose, and the cone.
- **The f875 miss** was never a hit-test question: the shot's cone (FUN_005405b0 -> FUN_0025a058, 24.39 deg for e027)
  tilts #67's bullet 9.8 deg (draws 0.0966 / 0.7922), 19 u wide of Vincent's capsule. The page had no cone on the
  soldiers' shots. `spreadAim` is now shared with Vincent's pellets; ai.json weapons carry `spread` (W+0x1c..0x24).
- **Aim point** vt+0x5c = FUN_00563720: bone C+0x765 (3) of Vincent's skeleton. Pose = *(MP+0x3f8) (model space;
  row 3's w slot is not 1), model -> world = C+0x00 with rows 1 and 2 negated. Bones are last frame's (rebuilt at the
  draw); the matrix is the start-of-frame one until his C update in FUN_00348fe8, whose list order (save RAM: #66,
  #88, Vincent, ..., #67-#71) decides what a soldier's bit-30 aim (FUN_00342650) sees. T: #66's f786 aim = record
  785 bones and matrix; #67's k_bullet1 f875 aim = record 874 bones with record 875's matrix (1e-4 u; 0.11 u the
  other way).
- **Room probe** (once, at the countdown end; bullet bit 0x2000 = no homing, so every bullet incl. Vincent's):
  FUN_00553808 -> FUN_0026a320(start, end + 0.1 dir, 0x18d), sub-tree +0x58 packets with (0x18d & ~(flags | 0x100))
  != 0. collision.js `probeSet(flags)` filters `segment()` by the info word. T: k_bullet2 f875 stops at 362.31 u.
- **Per frame** (FUN_00556870 -> FUN_005442d8): filter FUN_0055d100 (soldiers fail: same side; Vincent passes unless
  dead / bullet 0x4000 / 0x8000 / his own), capsule at his start-of-frame position (5, 18), then FUN_005ad118 on his
  13 'mkd' boxes (07703201 = 07700001; ai.json `hitboxes.p000`), FUN_005720c8 -> FUN_0055db50. The deflect window
  (vt+0x18c) only opens with his own melee: not on the page (warns if it ever opens).
- **Page**: play.js `playerBoneWorld(after)` = the drawn joints (j00..j92) placed with boneRows at his start-of-frame
  position / heading (after = the controller after ctrl.step), `roomRay` = col.segment with probeFlags(0x18d).
  `?enemydmg=0` keeps the test (bullets hit and stop, AI counts the hit) but not the damage; HUD says so.
- **Traces** (new, all gitignored output; scripts in tools/trace/scripts): w168_b1_a / _b (k_bullet1 inputs) and
  w168_e8_a / _b, w168_e8_pose760..980 (engage8 inputs), TRACE_FIELDSET=pose; w168_e8_spread / w168_e8_bullet
  (engage8 to f1015, TRACE_FIELDSET=enemy TRACE_LOG_AT=9E000 TRACE_CALLLOG=spread / bullet, frames 1000:1015).
- **Tests**: `node native/web/test_bullet_hit.mjs` (31 checks: aim, cone, room probe, every logged hit test with part,
  guards); test_enemy_ai's engage8 replay now feeds the traced pose (trace_pose.mjs) and cone draws: HP drops f789 /
  f1011 only (the old f879 extra hit is gone; HEAD's enemy_ai.js fails this check). Synthetic shots use h_st.
- Not done: Vincent's hit reaction (vt+0x324), the hit effects, P.motionClass (FUN_0055d100 immunity), friendly fire
  (bullet bit 0x200: warns), homing bullets (W+4 0x2000: warns), the order of later-activated soldiers in the C list.


## Vincent's hit reaction (worker 0169, 2026-11-01)

**Decoded and translated** (player.js `hitReact` / `hitBranch` / `bigHit` / `slideTick` / `runC` / `saveC` / `loadC`, jump_core.js `HitMotion`; audit
'Vincent's hit reaction').
- Callers: FUN_0055eac8 (melee) -> FUN_00565480(P, attack +0xec (type 1: 4), dir, point, alive-before); dir =
  FUN_0057b1b0 case 4 (+0xc0 bits 4-7 = 0xc in k_melee18): P's position less the owner's, flattened along the
  owner's row 1 (k_melee18 call: flags 4, dir (-0.887, 0, -0.4618) = from #66 to him). FUN_0055db50 (bullets):
  flags = bullet +0x148 (W+0xc: 0 on every weapon z128's records carry) | FUN_0055d950(P, +0x153 = W+0x4a).
- FUN_00565480 for Vincent (P+0x28 0x20901f, P+0x118 0x20209, C+0x1c8 0xc, C+0x4c0 set, P+0x110 nibbles 0): air
  states (or > 2 u above the ground with take-off bits) -> FUN_005618d0 / FUN_00561270 for flags 4 / 8 (not
  translated); ladder states -> nothing; flags 8 -> knock-down (not translated); flags 4 on the ground ->
  FUN_00562898; flags 2 -> nothing (P+0x118 bit 3). Every bullet hit in k_bullet1 / k_bullet2 / engage8 keeps
  state 2 / 3, as this says.
- FUN_00562898: FUN_0034b638(0.25, C, -dir); C+0x1c0 |= 0x200; DAT_0046e298 bit 13 (0x2000) -> FUN_003531e0(5 (P+0x28
  bit 4), 12, C, dir) + FUN_0034edf0(C, 9) (C+0x7e4 record +0x10 = 0x180: no override), FUN_0034e960(C, 4);
  FUN_00562b30 -> FUN_0055b8e0(P, 0x18, 0, 0) -> motion jumptable 0x589e70[0x18] = 0x3f; camera view 4 (scope) ->
  FUN_0032a420(CAM, 2).
- Class 0x3f (factory 0x592918 case 0x3f -> FUN_005a37b8, vtable 0x5a4b70, update FUN_0059df28): c_std (row 0x3e
  of C+0x7fc, save RAM), blend 2, done at its end or after 120 ticks. State 0x18 (class 0x58a9e0): enter FUN_00539b20
  (stance 0), done FUN_00539b88 (dead 7, air 0x10, else 2 / 3 by the gun), motion FUN_00539b48 (3 -> 5, else the
  jumptable: 2 -> 3).
- Mover 9 (FUN_00351550): speed v = 2d / T, then v -= v0 / T x step: 10 moving frames, 5.5 u on open floor. In
  k_lunge166 the walk mesh slides him along the railing (0.9 of each step): 4.97 u; the page's walker gives the
  same to 0.0007 u.
- Order: FUN_00343160 runs the class update, FUN_0034ea18 (mover, move, turn), then the clip advance, after the
  object lists (and after his input / intent: the hit frame's 0.25 turn survives in k_lunge166). The page's
  enemyAI.tick runs after ctrl.step, so `hitReact` puts the whole frame back to the start of its C update
  (`saveC` / `loadC`: controller, P, C, body, the jump's motion and clip clock (same object), the animator's
  layers), decides there, and on a big hit folds the hit into that start and runs the C update again (`runC`,
  without the draw). A hit with no reaction leaves the frame as it was. So two hits in one frame (melee + a
  bullet's stagger, two soldiers) act in order before one C update, as in the game. (Worker 0171; before, the
  redo restored only position / body / facing and ran the motion update and clip advance a second time.)
- Re-hit in state 0x18 (worker 0171, decoded): FUN_00565480 takes the same branch (0x18 is not an air state
  (FUN_0055aa88) nor in FUN_0055a410's list), so FUN_00562898 runs again: turn, C+0x1c0 |= 0x200, a new slide
  FUN_003531e0 + mover 9, FUN_0034e960(C, 4). FUN_00562b30 -> FUN_0055b8e0(P, 0x18, 0, 0): the state is already
  0x18 and param_3 = 0, so it returns 0 with no state write and no FUN_005641c0 (the hit motion is not restarted:
  c_std runs on and 0x18 ends when it would have); its tail FUN_00565df8(P, 0) still runs. A hit on the frame
  the motion ends is such a re-hit (the game sees 0x18 before the C update): the C update then ends 0x18 (-> 2 / 3)
  and the new slide runs in state 2. Not traced (no trace has two hits in one 0x18).
- The hit frame's draw: the game draws c_std at blend weight 0 (the old head alone) and then advances; the page's
  draw ran before the hit (the old head, same pose) and is not run again, so the cloth sees the c_std start
  (play.js clipStarted) one frame late, and a locomotion blend in progress on the hit frame is drawn blended
  (the game drops it). aim.js's clip classes (gun drawn) ran once on the hit frame before the hit: their layer
  writes are undone, their own counters (stand-fire timer, move flag, quadrant) are not (L: the game runs no
  such class in 0x18).
- Clip clock: c_std ends on the 26th chopped advance (EE FPU); rounded to nearest it ended a frame early
  (f1488). jump_core ClipClock now chops; jump / camera / aim traces unchanged.
- Sounds / effects (not on the page; for the audio work): FUN_0055c978 C cues 0x44 / 0x4c (FUN_00341330 /
  FUN_003412d0) and script event 8; vt+0x324 FUN_00576ac8 -> vt+0x344 FUN_00576c28 and FUN_003b4ea8(DAT_00471380);
  voice FUN_0055ea50 ('h_dmg_N', P+0x28 bit 2); HUD FUN_00567fe8 (melee) / FUN_00567f10 (bullets); hit effect
  FUN_003361b8 (bullets, zone nibble), FUN_00567c08 / pad FUN_00336508 (FUN_005720c8); FUN_00562898's script event
  0x29.
