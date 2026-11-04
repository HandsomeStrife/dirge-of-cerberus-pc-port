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
  if (lib && lib.ensure) { A.ensure = (m) => lib.ensure(m); A.ensurePack = (m, n) => lib.ensurePack(m, n); }   // worker 0261: loads on demand (event_actors.js)
  return A;
}

export function createStageView({ rt, camera, output, canvas, lib = null, root = null, litPatch = null, light = null, weapon = null,
                                  warn = (m) => console.warn(m) }) {
  let view = null;
  if (lib && root) view = import('./event_actors.js').then(m => (view = m.createEventActorView({ root, lib, rt, litPatch, light, weapon, warn })));
  else warn('stage view: no event actor library (data/event/actors): the events\' actors are not drawn');
  let lastFov = null, wasActive = false, wasBattle = true;
  const S = {
    rt,
    // the event camera is the render camera while one is active out of battle mode (FUN_00379148; StageRuntime.frame
    // sets rt.view = null in battle mode)
    get active() { return !!rt.view; },
    // one game frame after the stage tick: the MPs' draw, then FUN_003772c8
    step() {
      if (view && view.step) view.step(); else rt.actors.step();
      // back in battle: the event's models go (FUN_0037cf30's slot loop frees them; worker 0261), what a named slot still holds stays
      if (rt.battle && !wasBattle && lib && lib.trim) lib.trim(rt.actors.slots.map(a => a.model));
      wasBattle = rt.battle;
    },
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
      // GUESS: the fade particle's draw as a black layer (output.js fade, before the menus; notes/fidelity-audit.md 'GUESS: the event fade's draw')
      output.fade = rt.fade ? Math.min(1, Math.max(0, rt.fade.level / 256)) : 0;
    },
    refit() { lastFov = null; },
    // the event pause (FUN_003de130's event branch -> FUN_003dfd58 -> FUN_00376ee0(ev, 1, 1); FUN_003dfd90 / FUN_003dfdc8 -> (ev, 0, 1)):
    // +0x1558 bit 39, the voices (FUN_003ea9f0 / FUN_003eaa78), the SEs, the effects, the BGM volume (FUN_003ed7d0(0) / (0x7f)).
    // play.js holds the event by not running game frames.
    pause(on) {
      rt.log.push([rt.frameNo, on ? 'event pause' : 'event resume']);
      const s = rt.sound, m = s && s.music && s.music(), vo = s && s.voices && s.voices();
      if (m && m.setVolume) m.setVolume(on ? 0 : 0x7f);
      const au = s && s.audio && s.audio();
      if (au && au.setPaused) au.setPaused(on);                      // FUN_003e86e0(.., on)
      if (vo && vo.pause) vo.pause(on);                              // FUN_003ea9f0 / FUN_003eaa78
    },
    dispose() {
      output.fade = 0;
      if (view && view.dispose) view.dispose();
      if (wasActive) output.fitCamera(camera);
    },
  };
  return S;
}
