// The stage controller on the real play.html (worker 0219; stage_controller.js, notes/stage-controller.md): ev0100 main
// runs from the page's start (?intro=0: the save's state), reaches the save's global flags and battle loop; when the
// current world's stage flag 0 becomes 2 (script 88: the start deck cleared) the next beat runs: load(128, 2, 3) ->
// area_stream.js request(2, 3), rv_matiawase, scene_save 1, back to battle. Worker 0248: rv_matiawase plays by default
// (stage_controller.js PLAYS): its event camera is the render camera, p000 / p005 are drawn (stage_view.js), the
// window MES_10201VN opens; Start, ✕ skips it through the game's Skip (eventSkip). ?stage=0 leaves the controller out.
//   node native/web/test_stage_page.mjs (needs playwright + data; else SKIP; network for the three.js CDN)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let fail = 0;
const ok = (c, m, info = '') => { console.log((c ? 'ok   ' : 'FAIL ') + m + (info ? '  (' + info + ')' : '')); if (!c) fail++; };
const done = () => { console.log(fail ? `${fail} FAILED` : 'all ok'); process.exit(fail ? 1 : 0); };
for (const f of ['event/ev0100_stage.json', 'enemies/ai.json'])
  if (!fs.existsSync(path.join(here, 'data', f))) { console.log('SKIP: no data/' + f); done(); }
let chromium;
try {
  const g = execSync('npm root -g', { encoding: 'utf8' }).trim();
  ({ chromium } = createRequire(path.join(g, '/'))('playwright'));
} catch { console.log('SKIP: playwright not installed (npm i -g playwright)'); done(); }

const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const srv = spawn('python3', ['-I', '-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', here], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
async function open(q = '', base = 'intro=0&') {
  const pg = await browser.newPage({ viewport: { width: 960, height: 540 } });
  // every follow.battleReset, from before the first game frame (the first battle() runs in the stage's first frames)
  await pg.addInitScript(() => { let v; window.__resets = []; window.__handBacks = 0;
    Object.defineProperty(window, '__play', { configurable: true, get: () => v, set: (x) => { v = x; const b = x.follow.battleReset, h = x.follow.battleHandBack;
      x.follow.battleReset = function (...a) { window.__resets.push(x.stage ? x.stage.rt.frameNo : -1); return b.apply(this, a); };
      x.follow.battleHandBack = function (...a) { window.__handBacks++; return h.apply(this, a); }; } }); });
  const errs = [], warns = [];
  pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); if (m.type() === 'warning') warns.push(m.text()); });
  pg.on('pageerror', e => errs.push(e.message));
  for (let i = 0; ; i++) {
    try { await pg.goto(`http://127.0.0.1:${port}/play.html?video=pal&${base}sound=0&enemydmg=0${q}`, { waitUntil: 'load' }); break; }
    catch (e) { if (i > 20) throw e; await new Promise(r => setTimeout(r, 250)); }
  }
  await pg.waitForFunction(() => window.__play && window.__play.stats.ticks > 30, null, { timeout: 120000 });
  await pg.evaluate(() => window.__play.packsReady);
  await pg.evaluate(() => { window.__instance = Math.random(); });
  return { pg, errs, warns };
}

const st = (pg) => pg.evaluate(() => { const s = window.__play.stage; if (!s) return null;
  return { g: [...s.globalFlags].map((v, i) => (v ? i + ':' + v : '')).filter(Boolean).join(' '), battle: s.battle,
           log: s.rt.log.map(([f, m]) => f + ' ' + m), where: s.rt.vm.where(), calls: s.rt.vm.calls.join(' ') }; });
async function beat(q) {
  const { pg, errs } = await open(q);
  await pg.waitForFunction(() => window.__play.stage && window.__play.stage.rt.frameNo > 20, null, { timeout: 60000 });
  let s = await st(pg);
  ok(s.g === '0:1 1:3', 'main from the save: global flags 0 = 1, 1 = 3 (the save\'s RAM)', s.g);
  ok(s.battle && /ev0100\.(main|deb_jump)/.test(s.where), 'in the battle loop', s.where);
  ok(s.log.some(m => / played elsewhere ev0101\.first_event/.test(m)), 'first_event left to intro.js');
  // the start deck cleared: script 88's flag writes into the current world, and record the stream's requests
  await pg.evaluate(() => {
    const P = window.__play, S = P.light.stream, r = S.request.bind(S);
    window.__req = []; S.request = (a, b) => { window.__req.push(a + ',' + b + (S.busy ? ' busy' : '')); return r(a, b); };
    P.enemyAI.eventFlags[0] = 2; P.enemyAI.eventFlags[63] = 6;
  });
  // during the event (worker 0248): the stage view's camera and actors, sampled each animation frame
  await pg.evaluate(() => { const P = window.__play; window.__ev = { cam: 0, bodies: new Set(), shown: new Set(), win: 0 };
    // worker 0257: the room's occluders from the camera rendered (FUN_0026c878: 0x4fcb10): at each occluder update while an event camera is out, the volumes' eye is that camera's
    const O = P.roomOccl, occlFrame = O.frame;
    O.frame = function (...a) { const r = occlFrame.apply(this, a), v = P.stageView; if (v && v.active) { const E = P.stage.rt.view.eye, D = Math.hypot(O.eye[0] - E[0], O.eye[1] - E[1], O.eye[2] - E[2]); window.__ev.occl = (window.__ev.occl || 0) + 1; window.__ev.occlFar = Math.max(window.__ev.occlFar || 0, D); } return r; };
    const f = () => { const v = P.stageView; if (v && v.active) { window.__ev.cam++;
        const c = P.camera, V = P.stage.rt.view, e = V.eye;
        // the render camera: the eye and its forward (camera.lookAt), up to the event's view
        const d = [V.aim[0] - e[0], V.aim[1] - e[1], V.aim[2] - e[2]], n = Math.hypot(...d) || 1, w = c.getWorldDirection(new c.position.constructor());
        if (Math.hypot(c.position.x - e[0], c.position.y - e[1], c.position.z - e[2]) < 1e-3 && Math.hypot(w.x - d[0] / n, w.y - d[1] / n, w.z - d[2] / n) < 1e-3) window.__ev.at = (window.__ev.at || 0) + 1;
      }
      const g = P.root.getObjectByName('event actors'); if (g) for (const a of P.stage.rt.actors.slots) if (a.drawn && a.drawn.shown && !a.lent) window.__ev.shown.add(a.model);
      if (P.stageWin && P.stageWin.drawAll(performance.now()).length) window.__ev.win++;
      if (!P.stage.battle || !window.__evDone) requestAnimationFrame(f); };
    requestAnimationFrame(f); });
  await pg.waitForFunction(() => window.__play.stage.rt.log.some(([, m]) => m === 'scene_save 1'), null, { timeout: 120000, polling: 250 });
  await pg.waitForFunction(() => window.__play.stage.battle, null, { timeout: 60000, polling: 250 });
  s = await st(pg);
  const req = await pg.evaluate(() => window.__req);
  ok(s.calls.includes('ev0101.rv_matiawase'), 'rv_matiawase ran', s.calls);
  const ev = await pg.evaluate(() => { window.__evDone = true; const e = window.__ev; return { cam: e.cam, at: e.at || 0, shown: [...e.shown], win: e.win, occl: e.occl || 0, occlFar: e.occlFar || 0 }; });
  {
    ok(!s.log.some(m => / skip /.test(m)), 'default: rv_matiawase plays (no Skip in it or in main after it)', s.log.filter(m => / skip/.test(m)).join(' | '));
    ok(ev.cam > 20 && ev.at === ev.cam, 'the event camera (eye and forward) is the render camera while it runs (FUN_00379148)', JSON.stringify(ev));
    ok(ev.occl > 20 && ev.occlFar < 0.5, 'the occluder volumes come from that camera, not the follow camera (FUN_0026c878)', `max ${ev.occlFar.toFixed(3)} u`);
    ok(ev.shown.includes('p000') && ev.shown.includes('p005') && ev.shown.includes('weapon'), 'p000, p005 and the weapon drawn (stage_view.js)', ev.shown.join(' '));
    ok(ev.win > 0, 'the window MES_10201VN drawn (event_window.js)', 'frames ' + ev.win);
    ok(s.log.some(m => / voice 10201vn$/.test(m)) && s.log.some(m => / fadein 1500$/.test(m)), 'playVoice 10201vn, then main\'s fadein 1500 unskipped');
  }
  ok(s.log.some(m => / zone 128,2,3$/.test(m)) && req.filter(x => x.startsWith('2,3')).length >= 2, 'load(128, 2, 3) -> FUN_002677a0(2, 3) twice', req.slice(0, 6).join(' | '));
  ok(s.g === '0:1 1:5', 'global flags after the beat (the game: 0 = 1, 1 = 5)', s.g);
  ok(s.battle, 'back in battle mode');
  { const n = await pg.evaluate(() => window.__resets.length); ok(n >= 1, 'a later battle() resets the camera (FUN_00324e70 -> FUN_00329f68)', `follow.battleReset ${n} times`); }
  ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
  await pg.close();
}
// mean luminance (0..255) of a canvas screenshot, and of its inner rectangle: what the player sees
async function lum(pg) {
  const b64 = (await pg.screenshot({ type: 'png' })).toString('base64');
  return pg.evaluate(async (d) => {
    const im = new Image(); im.src = 'data:image/png;base64,' + d; await im.decode();
    const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
    const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0);
    const D = x.getImageData(0, 0, c.width, c.height).data; let s = 0, m = 0;
    for (let i = 0; i < D.length; i += 4) { const v = (D[i] + D[i + 1] + D[i + 2]) / 3; s += v; if (v > m) m = v; }
    return { mean: s / (D.length / 4), max: m };
  }, b64);
}
// worker 0257: the opening's route (no ?intro=0): the stage runs alongside it, so main's first battle() reaches the camera reset. It leaves the camera alone (FUN_00324e70: DAT_0046e290 == 0)
async function firstBattle() {
  const { pg, errs } = await open('', '');
  await pg.waitForFunction(() => window.__play.stage && window.__play.stage.rt.frameNo > 2, null, { timeout: 120000, polling: 100 });
  // worker 0265's stage title card (first_event displayStageInfo(0)) holds the opening and takes no pause input (FUN_003fdb48 ->
  // FUN_00241760(1, 0, 0)): Enter only after the card's fadein
  await pg.waitForFunction(() => { const P = window.__play, r = P.intro && P.intro.rt, si = P.stageInfo; return r && r.log.some(x => /^fadein /.test(x[1])) && (!si || si.kind < 0); }, null, { timeout: 300000 });
  await pg.keyboard.press('Enter'); await pg.waitForTimeout(300); await pg.keyboard.press('Space');   // the opening's pause, then Skip
  const b = await pg.waitForFunction(() => window.__play.stage.battle, null, { timeout: 180000, polling: 100 }).then(() => true, () => false);
  const s = await pg.evaluate(() => ({ n: window.__resets.length, hb: window.__handBacks, log: window.__play.stage.rt.log.filter(([, m]) => /^battle/.test(m)).map(x => x.join(' ')) }));
  ok(b && s.hb > 0 && s.n === 0, 'the opening\'s route: the stage\'s first battle() hands back but does not reset the camera (play.js `first`)', JSON.stringify(s));
  ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
  await pg.close();
}
// worker 0257: dead during an event: FUN_003de130 takes no pause input while the game over's count is up (FUN_003e0cb0), and none during the Restart's load
async function deadInEvent() {
  const { pg, errs } = await open('');
  await pg.waitForFunction(() => window.__play.stage && window.__play.stage.rt.frameNo > 20, null, { timeout: 60000 });
  await pg.evaluate(() => { const P = window.__play; P.enemyAI.eventFlags[0] = 2; P.enemyAI.eventFlags[63] = 6; });
  await pg.waitForFunction(() => { const R = window.__play.stage.rt; return !R.battle && R.skippable() && R.vm.calls.includes('ev0101.rv_matiawase') && R.view; }, null, { timeout: 120000, polling: 100 });
  await pg.evaluate(() => { window.__play.php.hp = 0; });
  await pg.keyboard.press('Enter');                  // at once: HP 0, the page's count a frame later
  ok(await pg.evaluate(() => !window.__play.stagePaused), 'Start in the kill\'s frame: no event pause');
  await pg.waitForFunction(() => window.__play.gameOver.go.count > 0, null, { timeout: 20000, polling: 50 });
  await pg.keyboard.press('Enter');
  ok(await pg.evaluate(() => !window.__play.stagePaused), 'Start with the game over\'s count up: no event pause (FUN_003e0cb0)');
  let menu = await pg.waitForFunction(() => { const g = window.__play.gameOver.go; return g.menu && g.menu.focus && g.menu.focus.id === 3; }, null, { timeout: 60000, polling: 100 }).then(() => true, () => false);
  ok(menu, 'the game over goes on to its menu');
  if (menu) {
    // Start through the whole of the Restart's load (the hold is a few frames): it never takes the event pause, and the Restart goes on
    await pg.evaluate(() => { const P = window.__play; window.__heldPause = 0; window.__startT = setInterval(() => { if (P.restart.pending && P.restart.count === 0) { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' })); } if (P.stagePaused) { window.__heldPause++; window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' })); } }, 1); });
    await pg.keyboard.press('Space');
    const done = await pg.waitForFunction(() => window.__play.restart.count === 1, null, { timeout: 60000, polling: 50 }).then(() => true, () => false);
    const held = await pg.evaluate(() => { clearInterval(window.__startT); return window.__heldPause; });
    ok(done && held === 0 && await pg.evaluate(() => !window.__play.stagePaused), 'Start during the Restart\'s load: the Restart goes on, no event pause', `count ${done}, paused ${held} times`);
  }
  ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
  await pg.close();
}
// worker 0257: Start and ✕ in main's event; the fade under the menus; the faces' texture animation
async function eventKeys() {
  const { pg, errs } = await open('');
  await pg.waitForFunction(() => window.__play.stage && window.__play.stage.rt.frameNo > 20, null, { timeout: 60000 });
  await pg.evaluate(() => { const P = window.__play; P.enemyAI.eventFlags[0] = 2; P.enemyAI.eventFlags[63] = 6; });
  await pg.waitForFunction(() => { const R = window.__play.stage.rt; return !R.battle && R.frameNo > 0 && R.skippable() && R.vm.calls.includes('ev0101.rv_matiawase') && R.view; }, null, { timeout: 120000 });
  await pg.waitForFunction(() => { const R = window.__play.stage.rt; return R.log.some(([, m]) => / voice|voice /.test(m)) || R.frameNo > 200; }, null, { timeout: 120000 });
  const before = await pg.evaluate(() => window.__play.stage.rt.frameNo);
  // FUN_0054c308 reads the camera rendered: an item 300 from the event camera (spins, drawn) far from the follow camera; then 1000 from it: hidden past 800
  if (await pg.evaluate(() => !!window.__items)) {
    const it = await pg.evaluate(async () => { const P = window.__play, I = window.__items, o = I.list.find(x => (x.f28 & 1) && x.mdl), E = () => P.stage.rt.view.eye, wait = ms => new Promise(r => setTimeout(r, ms));
      if (!o) return null;
      const keep = o.pos; const at = d => { const e = E(); o.pos = [e[0] + d, e[1], e[2]]; };
      at(300); await wait(150); const near = { hidden: o.mdl.hidden, follow: Math.hypot(o.pos[0] - P.follow.eye[0], o.pos[1] - P.follow.eye[1], o.pos[2] - P.follow.eye[2]) };
      at(1000); await wait(150); const far = o.mdl.hidden; at(600); await wait(150); const mid = o.mdl.hidden; o.pos = keep; return { near, far, mid }; });
    if (it) { ok(!it.near.hidden && it.far && !it.mid, 'items: hidden past 800 from the event camera (FUN_0054c308: radius 7 x 256 / (distance x tan(fov / 2)) < 3)', JSON.stringify(it)); }
    else console.log('  (no active item for the distance check)');
  }
  // Start: the event pause, not the battle menu
  await pg.keyboard.press('Enter');
  await pg.waitForFunction(() => window.__play.stagePaused, null, { timeout: 5000 }).catch(() => null);
  const a = await pg.evaluate(() => { const P = window.__play; return { held: P.stagePaused, menu: P.pause.active, prompt: !!(P.stageWin && P.stageWin.prompt), f: P.stage.rt.frameNo, log: P.stage.rt.log.slice(-1)[0][1] }; });
  ok(a.held && !a.menu && a.prompt, 'Start in rv_matiawase: the event pause\'s screen, not the battle menu (FUN_003de130 -> FUN_003dfd58)', JSON.stringify(a));
  await pg.waitForTimeout(400);
  const f2 = await pg.evaluate(() => window.__play.stage.rt.frameNo);
  ok(f2 === a.f, 'the event is held while paused (FUN_00376ee0: +0x1558 bit 39)', a.f + ' -> ' + f2);
  // the fade: black over the world, under the menus (level poked while held: no frame integrates it)
  const clear = await lum(pg);
  await pg.evaluate(() => { window.__play.stage.rt.fade = { level: 256, rate: 0 }; window.__play.stageView.render(); });
  await pg.waitForTimeout(150);
  const black = await lum(pg);
  ok(clear.mean > 8 && black.mean < clear.mean * 0.4 && black.max > 40, 'fade level 256: the world goes black (output.js), the pause\'s screen still shows above it', `mean ${clear.mean.toFixed(1)} -> ${black.mean.toFixed(1)}, brightest ${black.max}`);
  await pg.evaluate(() => { window.__play.stage.rt.fade = null; window.__play.stageView.render(); });
  // Start again: resumes; the frames go on
  await pg.keyboard.press('Enter');
  await pg.waitForFunction(f => !window.__play.stagePaused && window.__play.stage.rt.frameNo > f + 5, a.f, { timeout: 15000 }).catch(() => null);
  const b = await pg.evaluate(() => ({ held: window.__play.stagePaused, f: window.__play.stage.rt.frameNo, skip: window.__play.stage.rt.skip }));
  ok(!b.held && b.f > a.f + 5 && b.skip === 0, 'Start again: the event goes on, no Skip (FUN_003dfd90)', JSON.stringify(b));
  // ✕ alone does nothing in the event (no Skip without the pause)
  await pg.keyboard.press('Space');
  await pg.waitForTimeout(150);
  ok(await pg.evaluate(() => window.__play.stage.rt.skip === 0 && !window.__play.stagePaused), '✕ without the pause: no Skip');
  ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
  await pg.close();
  await eventSkip();
}
// the faces change on the page (a DataTexture of the texanm targets gets more than one content). In its own event: rv_matiawase is too short to be sure of a blink
// (p000's first, event frames 2-18, comes before its body appears ~41 frames in, then @_eye waits 128-512 frames); first_encounter runs 2170 frames with faces on screen
async function eventFaces() {
  const { pg, errs } = await open('&warp=encounter');
  await pg.waitForFunction(() => window.__play && window.__play.stage && window.__play.stage.rt, null, { timeout: 240000 });
  await pg.evaluate(() => { const P = window.__play; window.__seen = new Map(); window.__inEv = 0; window.__moves = 0;
    const f = () => { const R = P.stage.rt;
      if (R.vm.frames.some(F => F.m.name === 'first_encounter')) window.__inEv++;
      const g = P.root.getObjectByName('event actors');
      if (g) g.traverse(o => { const t = o.material && o.material.map; if (t && t.isDataTexture && t.image && t.image.data) { const d = t.image.data; let h = 0; for (let i = 0; i < d.length; i += 64) h = (h * 31 + d[i]) | 0; const S = window.__seen.get(t) || { h: null, moves: 0 }; if (S.h !== null && S.h !== h) { S.moves++; window.__moves = Math.max(window.__moves, S.moves); } S.h = h; window.__seen.set(t, S); } });
      requestAnimationFrame(f); };
    requestAnimationFrame(f); });
  // two changes of one texture: the first apply alone (base -> first key) is not an animation
  await pg.waitForFunction(() => { const R = window.__play.stage.rt; return window.__moves > 1 || (window.__inEv > 0 && R.gflags[1] >= 22 && R.battle); }, null, { timeout: 500000, polling: 200 }).catch(() => null);
  const faces = await pg.evaluate(() => { const R = window.__play.stage.rt; return { moves: window.__moves, textures: window.__seen.size, inEv: window.__inEv, g1: R.gflags[1] }; });
  ok(faces.inEv > 0, 'first_encounter ran for the faces check', JSON.stringify(faces));
  ok(faces.moves > 1, 'the faces change: one texanm target\'s texture gets new pixels twice in the event (FUN_00259058 copies)', JSON.stringify(faces));
  ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
  await pg.close();
}
// Start, then ✕: Skip, on a fresh page (the checks above can outlast the 354-frame event)
async function eventSkip() {
  const { pg, errs } = await open('');
  await pg.waitForFunction(() => window.__play.stage && window.__play.stage.rt.frameNo > 20, null, { timeout: 60000 });
  await pg.evaluate(() => { const P = window.__play; P.enemyAI.eventFlags[0] = 2; P.enemyAI.eventFlags[63] = 6; });
  await pg.waitForFunction(() => { const R = window.__play.stage.rt; return !R.battle && R.frameNo > 0 && R.skippable() && R.vm.calls.includes('ev0101.rv_matiawase') && R.view; }, null, { timeout: 120000 });
  await pg.keyboard.press('Enter');
  await pg.waitForFunction(() => window.__play.stagePaused, null, { timeout: 5000 }).catch(() => null);
  await pg.keyboard.press('Space');
  await pg.waitForFunction(() => window.__play.stage.battle, null, { timeout: 60000 }).catch(() => null);
  const c = await pg.evaluate(() => { const R = window.__play.stage.rt; return { battle: R.battle, skipLog: R.log.filter(([, m]) => /^skip /.test(m)).map(x => x[1]), paused: window.__play.stagePaused, menu: window.__play.pause.active }; });
  ok(c.battle && c.skipLog.some(m => /rv_matiawase/.test(m)) && !c.paused, '✕ in the event pause: Skip (FUN_003dfdc8), main reaches battle()', JSON.stringify(c));
  // back in battle: Start is the battle menu again
  await pg.keyboard.press('Enter');
  await pg.waitForFunction(() => window.__play.pause.active, null, { timeout: 5000 }).catch(() => null);
  ok(await pg.evaluate(() => window.__play.pause.active), 'in battle mode Start is the pause menu');
  ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
  await pg.close();
}
try {
  if (process.env.STAGE_ONLY) { await (process.env.STAGE_ONLY === 'faces' ? eventFaces() : eventSkip()); await browser.close(); srv.kill(); done(); }   // one check alone (its mutant runs)
  await beat('');
  await eventKeys();
  await eventFaces();
  await deadInEvent();
  await firstBattle();
  // ?stage=0: no controller
  const o2 = await open('&stage=0');
  ok(await o2.pg.evaluate(() => window.__play.stage === null), '?stage=0: no stage controller');
  await o2.pg.close();
} catch (e) { ok(false, 'page run', String(e).slice(0, 300)); } finally {
  await browser.close(); srv.kill();
}
done();
