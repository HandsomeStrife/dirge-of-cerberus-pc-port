// Game over on the page (worker 0192): runs gameover.js once a game frame and draws its Restart / Quit box with
// pause_layer.js's PauseLayer (the same widget kit, textures and font: the box is layout 0x477c38 of the pause's
// menu system). Keys as the pause (pause_layer.js PAUSE_KEYS): ✕ Space, ○ Backspace, up / down.
// Not drawn: the GAME OVER title and its backdrop (FED 0x81840000; warned in gameover.js).
import { PauseLayer, PAUSE_KEYS } from './pause_layer.js';
import { GameOver, mergeData } from './gameover.js';

// setupGameOver({ output, onRequest, blocked }): returns { go, frame(dead, step), reset() }.
// frame() runs one game frame; its clock is 20 ms a game frame (GUESS: the HUD's clock stand-in, hud.js).
// onRequest('restart' | 'quit').
export async function setupGameOver({ output, onRequest = () => {}, blocked = () => false,
                                      pauseUrl = 'data/pause.json', url = 'data/gameover.json' }) {
  let D = null, layer = null;
  try {
    const [p, g] = await Promise.all([pauseUrl, url].map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); })));
    D = mergeData(p, g);
    layer = new PauseLayer(D);
  } catch (e) {
    console.warn('game over: no menu data (' + e.message + '; run export_web_pause.py and export_web_gameover.py): timing only');
    D = null;
  }
  const go = new GameOver(D);
  let clock = 0;
  const queued = [];                               // pad actions, seen by the next game frame (as the pad poll)
  const send = () => {
    if (!go.request) return;
    const r = go.request; go.request = null;
    if (r === 'quit') console.warn('game over: Quit; the page has no title screen (nothing done)');
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
    frame(dead, step) { clock += 20; for (const a of queued.splice(0)) go.input(a, clock, 0); go.frame(dead, step, clock); send(); },
    reset() { queued.length = 0; go.reset(); },
  };
}
