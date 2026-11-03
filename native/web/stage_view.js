// stage_view.js -- shows ev0100 main's events on the page (worker 0248): the stage controller's (stage_controller.js)
// event camera, fade and actors, as intro.js shows the opening's. The game draws every event the same way: the event
// object's camera output FUN_00379148 (only out of battle mode, StageRuntime.frame), the fade particle, and the event
// actors' MPs (FUN_005a8e28's draw, then the actor update FUN_003772c8, after the event update FUN_00377c68 in the
// main loop FUN_00248110).
//
// What is on the page: the event cameras -> the render camera, the fade's level (intro.js's veil GUESS), the event
// actors (event_actors.js; models from data/event/actors) with their texture animations; the event's sound
// (event_sound.js) and windows (event_window.js) are given to the runtime by play.js. Left out (warned by the runtime):
// focus blur, effect sequences, shadows.

import { EventActors } from './event_actor_rt.js';

// the stage's EventActors (event +0x1800): the actor library's clips (FUN_005a7390) and texture animations
// (FUN_005a8850), FUN_0040b5c0 for the animations' waits
export function createStageActors({ lib = null, rand = null, weaponFrame = null, warn = (m) => console.warn(m) } = {}) {
  const clipFrames = lib ? (m, n, c) => { const p = lib.models[m] && lib.models[m].packs[n]; return p && p.info.clipFrames[c] != null ? p.info.clipFrames[c] : null; } : null;
  const texAnims = lib ? (m) => (lib.models[m] && lib.models[m].info.texanim ? lib.models[m].info.texanim.anims : null) : null;
  const residentFiles = lib ? (m) => (lib.models[m] && lib.models[m].info.resident) || [] : null;
  const A = new EventActors({ clipFrames, texAnims, rand, residentFiles, warn });
  A.weaponFrame = weaponFrame;
  return A;
}

export function createStageView({ rt, camera, output, canvas, lib = null, root = null, litPatch = null, light = null, weapon = null,
                                  warn = (m) => console.warn(m) }) {
  let view = null;
  if (lib && root) view = import('./event_actors.js').then(m => (view = m.createEventActorView({ root, lib, rt, litPatch, light, weapon, warn })));
  else warn('stage view: no event actor library (data/event/actors): the events\' actors are not drawn');
  // GUESS: the fade particle's draw as a black layer (intro.js's; notes/fidelity-audit.md 'GUESS: the event fade's draw')
  const veil = document.createElement('div');
  veil.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;background:#000;opacity:0;pointer-events:none;z-index:5';
  (canvas && canvas.parentNode ? canvas.parentNode : document.body).appendChild(veil);
  let lastFov = null, wasActive = false;
  const S = {
    rt,
    // the event camera is the render camera while one is active out of battle mode (FUN_00379148; StageRuntime.frame
    // sets rt.view = null in battle mode)
    get active() { return !!rt.view; },
    // one game frame after the stage tick: the MPs' draw, then FUN_003772c8
    step() { if (view && view.step) view.step(); else rt.actors.step(); },
    render() {
      const v = rt.view;
      if (v) {
        camera.position.set(v.eye[0], v.eye[1], v.eye[2]);
        camera.up.set(-v.upDir[0], -v.upDir[1], -v.upDir[2]);     // upDir = sceVu0CameraMatrix's y (screen down)
        camera.lookAt(v.aim[0], v.aim[1], v.aim[2]);
        if (v.fov !== lastFov) { lastFov = v.fov; output.fitCamera(camera, v.fov); }
        wasActive = true;
      } else if (wasActive) {                                        // back to gameplay's projection (play.js fits 73.5)
        wasActive = false; lastFov = null; output.fitCamera(camera);
      }
      veil.style.opacity = rt.fade ? String(Math.min(1, Math.max(0, rt.fade.level / 256))) : '0';
    },
    refit() { lastFov = null; },
    dispose() {
      veil.remove();
      if (view && view.dispose) view.dispose();
      if (wasActive) output.fitCamera(camera);
    },
  };
  return S;
}
