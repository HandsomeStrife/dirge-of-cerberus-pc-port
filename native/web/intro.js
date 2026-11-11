// intro.js -- z128's opening event (ev0100 scr001) played on the page before play (worker 0210;
// notes/event-vm-research.md). event_rt.js runs the script; this drives it once per game frame and shows its
// camera and fades. At the script's end play.js runs the Restart path (checkpoint.js), as the game hands Vincent
// and soldiers 41-43 to play at the event's end.
//
// What is on the page: the event VM and its timing (wait / sleep / setTimer), the event cameras (keys, splines,
// move, active, set, setfov), the fades' levels, the event's actors and their clips (event_actor_rt.js / event_actors.js,
// worker 0218; Vincent's own event actor p000 left out). The subtitle windows and the event pause's screen are
// event_window.js (worker 0239; drawn by play.js). The stage title card is stage_info.js's (worker 0265). Left out (warned
// once by event_rt.js / event_vm.js): focus blur, the effect sequences. Music, the area sound, the event SEs and the voices
// (event_sound.js) and ✕ skip (event_rt.js requestSkip) are on (worker 0222). The page's gameplay bodies
// are hidden while it plays.

import { EventRuntime } from './event_rt.js';
import { EventActors } from './event_actor_rt.js';

// The event clock's step per game frame. The game's is real time: FUN_003798a0 adds the EE timer's milliseconds
// (FUN_0023c1f0) once per frame, 20 at 50 fps and 40 when a frame drops (T w210_intro: 20 in 1971 of 2399 frames,
// 40 in 97, 19 / 21 jitter). GUESS: the page steps a fixed 20 per game frame (its frames are fixed 1 / 50 s ticks),
// as the HUD clock does (notes/fidelity-audit.md 'GUESS: the event clock's step').
export const FRAME_MS = 20;

export function createIntro({ data, camera, output, canvas, zoneLoad = null, warn = (m) => console.warn(m),
                              actorLib = null, root = null, litPatch = null, light = null, sound = null, windows = null, rand = null,
                              stageInfo = null, stageInfoWait = null, effects = null }) {
  // the event's actors (worker 0218): their natives and update (event_actor_rt.js), drawn by event_actors.js
  let view = null, clipFrames = null;
  if (actorLib && root) clipFrames = (m, n, c) => { const p = actorLib.models[m] && actorLib.models[m].packs[n]; return p && p.info.clipFrames[c] != null ? p.info.clipFrames[c] : null; };
  // worker 0248: the models' texture animations (the faces) and resident motion packs (export_web_event_actors.py)
  const actors = clipFrames ? new EventActors({ clipFrames, warn,
    texAnims: (m) => (actorLib.models[m] && actorLib.models[m].info.texanim ? actorLib.models[m].info.texanim.anims : null),
    residentFiles: (m) => (actorLib.models[m] && actorLib.models[m].info.resident) || [], rand }) : null;
  // sound (event_sound.js back ends: music / area / audio / voices) and windows (event_window.js), worker 0222
  // stageInfo: () -> stage_info.js, the stage title card (displayStageInfo(0) at first_event pc 884; worker 0265)
  // effects: event_fx.js (worker 0275), the KerberosEffect natives and the effect sequences (the scanner)
  const rt = new EventRuntime(data, { warn, zoneLoad, actors, sound, windows, stageInfo, stageInfoWait, effects });
  rt.start();
  if (actors) view = import('./event_actors.js').then(m => (view = m.createEventActorView({ root, lib: actorLib, rt, litPatch, light, warn })));
  // GUESS: the fade particle's draw (system-FED emitters 2..5, not decoded) as a black layer with opacity
  // level / 256 over the picture (notes/fidelity-audit.md 'GUESS: the event fade's draw')
  let lastFov = null, paused = false;
  const I = {
    rt,
    frames: 0,
    get done() { return rt.done; },
    get paused() { return paused; },
    tick() {
      if (rt.done || paused) return;
      rt.frame(FRAME_MS);
      // FUN_005a8e28 (the MPs' draw + advance), then FUN_003772c8 (the event actor update)
      if (view && view.step) view.step(); else if (actors) actors.step();
      I.frames++;
    },
    // the event camera -> the render camera (FUN_00379148: sceVu0CameraMatrix(eye, aim - eye, up), fov FUN_003edce0)
    render() {
      const v = rt.view;
      if (v) {
        camera.position.set(v.eye[0], v.eye[1], v.eye[2]);
        // upDir is sceVu0CameraMatrix's y axis (the screen's down); three.js wants the screen's up
        camera.up.set(-v.upDir[0], -v.upDir[1], -v.upDir[2]);
        camera.lookAt(v.aim[0], v.aim[1], v.aim[2]);
        if (v.fov !== lastFov) { lastFov = v.fov; output.fitCamera(camera, v.fov); }
      }
      output.fade = rt.fade ? Math.min(1, Math.max(0, rt.fade.level / 256)) : 0;   // output.js: drawn before the menus
    },
    // after a resize (play.js fits the gameplay projection): the event fov again at the next render
    refit() { lastFov = null; },
    // the pause's Skip (FUN_003c0520 -> FUN_003c0110 -> FUN_003dfdc8 -> FUN_00372f70; worker 0222): +0x156c = 1
    skip() { return rt.done ? false : rt.requestSkip(); },
    // the event pause (worker 0222): FUN_00376ee0(ev, 1, 1) holds the event (+0x1558 bit 39, the clock's paused time
    // from +0x9854), pauses the voices (FUN_003ea9f0), the SEs (FUN_003e86e0(1)) and the effects (FUN_002f24b0(1, 1, 1)),
    // sets the BGM volume to 0 (FUN_003ed7d0(0)); (ev, 0, 1) undoes it (FUN_003eaa78, FUN_003ed7d0(0x7f)). The page holds
    // the event by not ticking it (the effects with it); music.js setVolume is FUN_003ed7d0.
    pause(on) {
      if (rt.done || on === paused) return;
      paused = on;
      rt.log.push([rt.frameNo, on ? 'event pause' : 'event resume']);
      const m = sound && sound.music && sound.music();
      if (m && m.setVolume) m.setVolume(on ? 0 : 0x7f);
      const v = sound && sound.voices && sound.voices();
      if (v && v.pause) v.pause(on);                                  // FUN_003ea9f0 / FUN_003eaa78 (worker 0261)
    },
    get skipped() { return rt.skip !== 0; },
    finish() {
      output.fade = 0;
      if (view && view.dispose) view.dispose();
      output.fitCamera(camera);
      lastFov = null;
    },
  };
  return I;
}
