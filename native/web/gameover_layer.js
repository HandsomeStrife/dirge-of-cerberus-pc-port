// Game over on the page (worker 0192): runs gameover.js once a game frame and draws its Restart / Quit box with
// pause_layer.js's PauseLayer (the same widget kit, textures and font: the box is layout 0x477c38 of the pause's
// menu system). Keys as the pause (pause_layer.js PAUSE_KEYS): ✕ Space, ○ Backspace, up / down.
// The GAME OVER title (FED 0x81840000): gameover_title.js (worker 0198), when gameover.json declares "title" and
// play.js passes THREE / root: begin at the frame start, spawn in the frame's logic, end + draw via endFrame(camera).
import { PauseLayer, PAUSE_KEYS } from './pause_layer.js';
import { GameOver, mergeData } from './gameover.js';
import { frameMs } from './video_mode.js';
import { createTitle, TitleLayer } from './gameover_title.js';

// setupGameOver({ output, onRequest, blocked }): returns { go, frame(dead, step), reset() }.
// frame() runs one game frame; its clock is one frame's ms a game frame (video_mode frameMs: 20 PAL, 16 / 17 / 17 NTSC) (GUESS: the HUD's clock stand-in, hud.js).
// onRequest('restart' | 'quit').
// THREE / root / fxRng (worker 0198): the title's EffectLayer goes into root; fxRng = the 3D effects' EffectRng.
export async function setupGameOver({ output, onRequest = () => {}, blocked = () => false,
                                      pauseUrl = 'data/pause.json', url = 'data/gameover.json',
                                      THREE = null, root = null, fxRng = null }) {
  let D = null, layer = null, G = null;
  try {
    const [p, g] = await Promise.all([pauseUrl, url].map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); })));
    G = g;
    D = mergeData(p, g);
    layer = new PauseLayer(D);
  } catch (e) {
    console.warn('game over: no menu data (' + e.message + '; run export_web_pause.py and export_web_gameover.py): timing only');
    D = null;
  }
  const go = new GameOver(D);
  let title = null, titleLayer = null;
  if (G && G.title && THREE && root) {
    try {
      const u = url.replace(/[^/]*$/, '') + G.title.fed;
      const r = await fetch(u);
      if (!r.ok) throw new Error(u + ' ' + r.status);
      title = createTitle(await r.arrayBuffer(), { rng: fxRng, id: G.title.id });
      titleLayer = new TitleLayer(THREE, title, { output });   // output: the glow's renderer / previous frame (worker 0202)
      root.add(titleLayer.group);
    } catch (e) { console.warn('game over: the GAME OVER title is not drawn (' + e.message + ')'); title = null; }
  } else if (G && !G.title) console.warn('game over: gameover.json has no "title" (re-run export_web_gameover.py): the GAME OVER title is not drawn');
  let clock = 0;
  const clockMs = frameMs();                     // its ms a frame (video_mode frameMs)
  const queued = [];                               // pad actions, seen by the next game frame (as the pad poll)
  const send = () => {
    if (!go.request) return;
    const r = go.request; go.request = null;
    if (r === 'quit') console.warn('game over: Quit; the page has no title screen (nothing done)');
    if (r === 'restart' && title) title.kill();     // FUN_00534a98 (result 6): FUN_002f2098(0x81840000)
    onRequest(r);
  };
  const has = (k, code) => PAUSE_KEYS[k].includes(code);
  addEventListener('keydown', e => {
    if (!go.menu || blocked() || /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
    const a = has('cross', e.code) ? 0 : has('circle', e.code) ? 1 : has('up', e.code) ? 2
      : has('down', e.code) ? 3 : has('left', e.code) ? 4 : has('right', e.code) ? 5 : -1;
    if (a < 0) return;
    e.preventDefault();
    e.stopImmediatePropagation();                  // the menu has the pad (DAT_004f3034 is in the box)
    if (!e.repeat) queued.push(a);
  }, { capture: true });
  const prev = output ? output.hud : null;
  if (output && layer) output.hud = o => {
    if (prev) prev(o);
    const prims = go.draw(clock);
    if (prims) layer.draw(o.renderer, o, prims);
  };
  return {
    go,
    get clock() { return clock; },
    // the frame's pad first (FUN_003de130 / the box's handlers run in the frame, with its clock), then the frame
    frame(dead, step) {
      // GUESS: the logic step; the game ages the title by its emitter's own +0x20 dt (not decoded; fidelity-audit 'the title's effect step')
      if (title) title.begin(step);                  // FUN_002efc78: every manager ages at the frame start
      clock += clockMs(); for (const a of queued.splice(0)) go.input(a, clock, 0); go.frame(dead, step, clock);
      if (title) title.logic(go.started);            // FUN_00381a08's spawn: stage request 0x18, in the frame's logic
      send();
    },
    // after the frame's logic (play.js, with the 3D effects' end): FUN_002efe98, then the draw pass
    endFrame(camera) { if (title) { title.end(); titleLayer.update(camera); } },
    title, titleLayer,
    reset() { queued.length = 0; go.reset(); if (title) title.reset(); },
  };
}
